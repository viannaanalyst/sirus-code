//! Automatic pull of the default branch (ADR-130). Every
//! five minutes, while the setting is on, each project checkout that sits on origin's default
//! branch with no local changes (untracked files included), no conversation running in it, no
//! commits of its own and something new on origin is fast-forwarded (`merge --ff-only`). It
//! never merges, rebases or touches a dirty tree; the fetch follows the same network-helper
//! and hook refusals as push and pull.

use std::path::Path;
use std::sync::Arc;
use std::time::Duration;

use crate::runtime::{AppHandle, Manager};

use crate::commands::AppState;
use crate::error::Result;
use crate::git;

const PASS: Duration = Duration::from_secs(5 * 60);
const FIRST_PASS: Duration = Duration::from_secs(90);

/// What the guard needs to know about a checkout before fetching.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Checkout {
    pub branch: Option<String>,
    pub default_branch: Option<String>,
    pub dirty: bool,
    /// A conversation is running in this checkout.
    pub busy: bool,
}

/// Fetch and maybe pull only on the default branch of a clean, idle checkout.
pub fn may_pull(checkout: &Checkout) -> bool {
    !checkout.busy
        && !checkout.dirty
        && checkout.branch.is_some()
        && checkout.branch == checkout.default_branch
}

/// Fast-forward only: nothing of its own (`ahead`) and something new (`behind`).
pub fn fast_forward(ahead: u32, behind: u32) -> bool {
    ahead == 0 && behind > 0
}

/// `git rev-list --left-right --count HEAD...upstream` → (ahead, behind).
fn counts(text: &str) -> Option<(u32, u32)> {
    let mut parts = text.split_whitespace();
    let ahead = parts.next()?.parse().ok()?;
    let behind = parts.next()?.parse().ok()?;
    Some((ahead, behind))
}

/// Any change at all, untracked files included; unknown counts as dirty.
fn dirty(path: &Path) -> bool {
    git::bounded_run(path, &["status", "--porcelain", "--untracked-files=normal"])
        .map(|output| !output.status.success() || !output.stdout.is_empty())
        .unwrap_or(true)
}

/// Pulls one checkout when the guard allows it. True when it moved.
pub fn pull_checkout(path: &Path, busy: bool) -> Result<bool> {
    let identity = git::identity(path)?;
    if !identity.is_repo || identity.detached {
        return Ok(false);
    }
    let checkout = Checkout {
        branch: identity.branch,
        default_branch: git::origin_default_branch(path),
        dirty: dirty(path),
        busy,
    };
    if !may_pull(&checkout) {
        return Ok(false);
    }
    let Some(branch) = checkout.branch else {
        return Ok(false);
    };
    git::fetch_origin_branch(path, &branch)?;
    let upstream = format!("refs/remotes/origin/{branch}");
    let output = git::bounded_run(
        path,
        &[
            "rev-list",
            "--left-right",
            "--count",
            &format!("HEAD...{upstream}"),
        ],
    )?;
    let Some((ahead, behind)) = counts(&String::from_utf8_lossy(&output.stdout)) else {
        return Ok(false);
    };
    // The fetch took a while: look at the tree again right before moving it.
    if !fast_forward(ahead, behind) || dirty(path) {
        return Ok(false);
    }
    let output = git::bounded_run(path, &["merge", "--ff-only", "--quiet", &upstream])?;
    Ok(output.status.success())
}

pub fn start(app: AppHandle) {
    crate::runtime::async_runtime::spawn(async move {
        let state = app.state::<Arc<AppState>>().inner().clone();
        tokio::time::sleep(FIRST_PASS).await;
        loop {
            if state.ensure_running().is_err() {
                return;
            }
            let projects = {
                let data = state.data.lock();
                if data.settings.git_auto_pull {
                    data.projects
                        .iter()
                        .map(|project| {
                            let busy = data.sessions.iter().any(|session| {
                                !session.worktree.isolated
                                    && session.worktree.path == project.path
                                    && session.status.is_active()
                            });
                            (project.path.clone(), busy)
                        })
                        .collect::<Vec<_>>()
                } else {
                    Vec::new()
                }
            };
            for (path, busy) in projects {
                let shown = path.clone();
                let result = tokio::task::spawn_blocking(move || {
                    crate::process_priority::background(|| pull_checkout(Path::new(&path), busy))
                })
                .await;
                match result {
                    Ok(Ok(true)) => tracing::info!(path = %shown, "pulled the default branch"),
                    Ok(Err(error)) => {
                        tracing::debug!(%error, path = %shown, "automatic pull skipped")
                    }
                    _ => {}
                }
            }
            tokio::time::sleep(PASS).await;
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::git::tests::Repo;

    fn checkout(branch: &str, default: &str, dirty: bool, busy: bool) -> Checkout {
        Checkout {
            branch: Some(branch.into()),
            default_branch: Some(default.into()),
            dirty,
            busy,
        }
    }

    #[test]
    fn the_guard_wants_a_clean_idle_default_branch_and_only_fast_forwards() {
        assert!(may_pull(&checkout("main", "main", false, false)));
        assert!(!may_pull(&checkout("feature", "main", false, false)));
        assert!(!may_pull(&checkout("main", "main", true, false)));
        assert!(!may_pull(&checkout("main", "main", false, true)));
        assert!(!may_pull(&Checkout {
            branch: Some("main".into()),
            default_branch: None,
            dirty: false,
            busy: false
        }));
        assert!(fast_forward(0, 2));
        assert!(!fast_forward(0, 0));
        assert!(!fast_forward(1, 2), "local commits: never merge or rebase");
        assert_eq!(counts("0\t3\n"), Some((0, 3)));
        assert_eq!(counts("x"), None);
    }

    #[test]
    fn a_clean_checkout_is_fast_forwarded_and_a_dirty_one_is_left_alone() {
        let origin = Repo::new();
        let clone = crate::worktree::tests::clone_of(&origin);
        std::fs::write(origin.cwd().join("file.txt"), "after\n").unwrap();
        git::run_ok(&origin.cwd(), &["commit", "-qam", "upstream work"]).unwrap();
        let upstream = git::run_ok(&origin.cwd(), &["rev-parse", "HEAD"]).unwrap();

        std::fs::write(clone.join("notes.txt"), "mine\n").unwrap();
        assert!(!pull_checkout(&clone, false).unwrap(), "untracked file");
        std::fs::remove_file(clone.join("notes.txt")).unwrap();
        assert!(
            !pull_checkout(&clone, true).unwrap(),
            "a conversation runs here"
        );
        assert!(pull_checkout(&clone, false).unwrap());
        assert_eq!(
            git::run_ok(&clone, &["rev-parse", "HEAD"]).unwrap(),
            upstream
        );
        assert!(!pull_checkout(&clone, false).unwrap(), "already current");
    }
}
