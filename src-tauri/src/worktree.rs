use std::fs;
use std::path::{Path, PathBuf};

use crate::error::{Error, Result};
use crate::git;
use crate::models::Worktree;
use crate::paths::{display_path, slug};

pub fn create_isolated(
    project_root: &Path,
    worktree_parent: &Path,
    session_id: &str,
    title: &str,
    branch_pattern: &str,
) -> Result<Worktree> {
    create_isolated_at(
        project_root,
        worktree_parent,
        session_id,
        title,
        branch_pattern,
        "HEAD",
    )
}

/// Same as `create_isolated`, starting the new branch at `start` (a verified commit or `HEAD`).
pub fn create_isolated_at(
    project_root: &Path,
    worktree_parent: &Path,
    session_id: &str,
    title: &str,
    branch_pattern: &str,
    start: &str,
) -> Result<Worktree> {
    let identity = git::identity(project_root)?;
    if !identity.is_repo {
        return Err(Error::git("isolated worktrees require a Git repository"));
    }
    let slug_title = slug(title);
    let short_id = session_id.chars().take(8).collect::<String>();
    let branch = branch_pattern
        .replace("{session-name}", &slug_title)
        .replace("{id}", &short_id);
    let mut branch = if branch.trim().is_empty() {
        format!("sirus/{slug_title}-{short_id}")
    } else {
        branch
    };
    if !branch_pattern.contains("{id}") && !branch.ends_with(&short_id) {
        branch = format!("{branch}-{short_id}");
    }
    git::run_ok(project_root, &["check-ref-format", "--branch", &branch])?;
    fs::create_dir_all(worktree_parent)?;
    let dest = unique_dir(worktree_parent, &slug_title)?;
    git::run_ok(
        project_root,
        &[
            "worktree",
            "add",
            "-b",
            &branch,
            &display_path(&dest),
            start,
        ],
    )?;
    Ok(Worktree {
        path: display_path(&dest),
        branch,
        isolated: true,
    })
}

pub fn remove(project_root: &Path, worktree: &Worktree, confirm: bool) -> Result<()> {
    if !worktree.isolated {
        return Ok(());
    }
    if !confirm {
        return Err(Error::confirmation_required(
            "removing a worktree deletes that working copy. confirm explicitly.",
        ));
    }
    if git::status(Path::new(&worktree.path))?.dirty {
        return Err(Error::git(
            "worktree contains uncommitted or untracked changes; preserve them before removal",
        ));
    }
    let output = git::run(project_root, &["worktree", "remove", "--", &worktree.path])?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(Error::git(format!(
            "worktree remove refused (no force flags are used automatically): {stderr}"
        )));
    }
    tidy(project_root, Path::new(&worktree.path));
    Ok(())
}

/// After a removal: drops stale Git worktree metadata and the project folder under
/// the worktree base once it is empty (ADR-078). Never deletes anything else.
pub fn tidy(project_root: &Path, removed: &Path) {
    let _ = git::run(project_root, &["worktree", "prune"]);
    if let Some(parent) = removed.parent() {
        // `remove_dir` only succeeds on an empty folder.
        let _ = fs::remove_dir(parent);
    }
}

/// Why an isolated worktree cannot be released without losing work, if anything:
/// uncommitted or untracked changes, or a HEAD no other branch or remote contains.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Unsafe {
    Uncommitted,
    Unmerged,
}

pub fn release_blocker(tree: &Path, branch: &str) -> Result<Option<Unsafe>> {
    if git::status(tree)?.dirty {
        return Ok(Some(Unsafe::Uncommitted));
    }
    let head = git::run_ok(tree, &["rev-parse", "--verify", "HEAD"])?;
    let refs = git::run_ok(
        tree,
        &[
            "for-each-ref",
            "--contains",
            &head,
            "--format=%(refname)",
            "refs/heads",
            "refs/remotes",
        ],
    )?;
    let own = format!("refs/heads/{branch}");
    let elsewhere = refs
        .lines()
        .any(|name| name != own && !name.ends_with("/HEAD"));
    Ok((!elsewhere).then_some(Unsafe::Unmerged))
}

fn unique_dir(parent: &Path, base: &str) -> Result<PathBuf> {
    let mut index = 0u32;
    loop {
        let name = if index == 0 {
            base.to_string()
        } else {
            format!("{base}-{index}")
        };
        let candidate = parent.join(name);
        if !candidate.exists() {
            return Ok(candidate);
        }
        index += 1;
        if index > 1000 {
            return Err(Error::new(
                "worktree",
                "could not allocate a unique worktree path",
            ));
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::git::tests::Repo;
    #[test]
    fn same_title_creates_distinct_branches_and_paths() {
        let repo = Repo::new();
        let parent = repo.0.join("worktrees");
        let first = create_isolated(
            &repo.cwd(),
            &parent,
            "11111111-a",
            "Fix tabs",
            "sirus/{session-name}",
        )
        .unwrap();
        let second = create_isolated(
            &repo.cwd(),
            &parent,
            "22222222-b",
            "Fix tabs",
            "sirus/{session-name}",
        )
        .unwrap();
        assert_ne!(first.branch, second.branch);
        assert_ne!(first.path, second.path);
    }
    #[test]
    fn removal_requires_confirmation_and_preserves_dirty_tree() {
        let repo = Repo::new();
        let tree = create_isolated(
            &repo.cwd(),
            &repo.0.join("worktrees"),
            "11111111-a",
            "Fix",
            "sirus/{session-name}-{id}",
        )
        .unwrap();
        assert!(remove(&repo.cwd(), &tree, false).is_err());
        fs::write(Path::new(&tree.path).join("important.txt"), "user work").unwrap();
        assert!(remove(&repo.cwd(), &tree, true).is_err());
        assert_eq!(
            fs::read_to_string(Path::new(&tree.path).join("important.txt")).unwrap(),
            "user work"
        );
    }
    #[test]
    fn release_needs_a_clean_tree_whose_commits_live_elsewhere() {
        let repo = Repo::new();
        let parent = repo.0.join("worktrees").join("project");
        let tree = create_isolated(
            &repo.cwd(),
            &parent,
            "11111111-a",
            "Fix",
            "sirus/{session-name}-{id}",
        )
        .unwrap();
        let path = PathBuf::from(&tree.path);
        // Fresh branch: its HEAD is still on the project's branch.
        assert_eq!(release_blocker(&path, &tree.branch).unwrap(), None);
        fs::write(path.join("new.txt"), "work").unwrap();
        assert_eq!(
            release_blocker(&path, &tree.branch).unwrap(),
            Some(Unsafe::Uncommitted)
        );
        git::run_ok(&path, &["add", "--", "new.txt"]).unwrap();
        git::run_ok(&path, &["commit", "-qm", "work"]).unwrap();
        assert_eq!(
            release_blocker(&path, &tree.branch).unwrap(),
            Some(Unsafe::Unmerged)
        );
        git::run_ok(&repo.cwd(), &["merge", "-q", "--ff-only", &tree.branch]).unwrap();
        assert_eq!(release_blocker(&path, &tree.branch).unwrap(), None);
        // Removal prunes metadata and the emptied project folder, keeping the branch.
        remove(&repo.cwd(), &tree, true).unwrap();
        assert!(!path.exists());
        assert!(!parent.exists());
        assert!(git::run_ok(&repo.cwd(), &["rev-parse", "--verify", &tree.branch]).is_ok());
    }
    #[test]
    fn invalid_branch_is_rejected_before_directory_creation() {
        let repo = Repo::new();
        let parent = repo.0.join("worktrees");
        assert!(create_isolated(&repo.cwd(), &parent, "11111111-a", "Fix", "../bad").is_err());
        assert!(!parent.exists());
    }
}
