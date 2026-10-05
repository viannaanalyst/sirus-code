//! Undo a settled turn's file changes (ADR-061). Each retained turn diff is
//! applied in reverse with `git apply -R`, one file at a time, after a
//! `--check`: a file changed again afterwards in the same lines is refused and
//! left untouched, never overwritten. The index, commits and other files stay
//! as they are. Paths come only from the native review, never from the renderer.
use std::path::{Path, PathBuf};
use std::sync::Arc;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, State};

use crate::commands::{session_cwd, AppState};
use crate::error::{Error, Result};
use crate::models::{ChangeKind, MessageRole, SessionStatus};
use crate::turn_review::{allowed_name, ReviewFile};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct UndoRequest {
    pub session_id: String,
    pub message_id: String,
    /// Files of that turn to undo; `None` undoes every file that can be.
    #[serde(default)]
    pub paths: Option<Vec<String>>,
    pub confirm: bool,
}

#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct UndoOutcome {
    pub undone: Vec<String>,
    /// Files left as they are: changed again since the turn, or no retained diff.
    pub refused: Vec<String>,
}

#[tauri::command]
pub async fn undo_turn_changes(
    app: AppHandle,
    state: State<'_, Arc<AppState>>,
    request: UndoRequest,
) -> Result<UndoOutcome> {
    if !request.confirm {
        return Err(Error::confirmation_required(
            "Confirm undoing this turn's changes first.",
        ));
    }
    let state = state.inner().clone();
    let worker = state.clone();
    let (session_id, message_id) = (request.session_id.clone(), request.message_id.clone());
    let outcome = crate::commands::native_task(move || {
        let (cwd, files) = plan(&worker, &request)?;
        let outcome = undo_files(&cwd, files);
        record(&worker, &request, &outcome.undone)?;
        Ok(outcome)
    })
    .await?;
    let data = state.data.lock();
    if let Some(session) = data.sessions.iter().find(|s| s.id == session_id) {
        let from = session
            .messages
            .iter()
            .position(|message| message.id == message_id)
            .unwrap_or_else(|| crate::transcript_view::current_turn(session));
        crate::transcript_view::emit_from(&app, session, from);
    }
    Ok(outcome)
}

/// The owned, idle session's workspace and the requested files of a settled turn
/// that are not undone yet.
fn plan(state: &AppState, request: &UndoRequest) -> Result<(PathBuf, Vec<ReviewFile>)> {
    let data = state.data.lock();
    state.ensure_running()?;
    let session = data
        .sessions
        .iter()
        .find(|s| s.id == request.session_id)
        .ok_or_else(|| Error::not_found("session not found"))?;
    if matches!(
        session.status,
        SessionStatus::Starting | SessionStatus::Running | SessionStatus::Waiting
    ) {
        return Err(Error::new(
            "invalid",
            "Wait for the agent to finish before undoing changes.",
        ));
    }
    let review = session
        .messages
        .iter()
        .find(|m| {
            m.id == request.message_id
                && m.session_id == session.id
                && m.role == MessageRole::Agent
                && !m.streaming
        })
        .and_then(|m| m.activity.as_ref())
        .filter(|activity| activity.ended_at.is_some())
        .and_then(|activity| activity.review.as_ref())
        .ok_or_else(|| Error::not_found("turn review not available"))?;
    if let Some(paths) = &request.paths {
        if paths.is_empty()
            || paths.len() > review.files.len()
            || paths
                .iter()
                .any(|path| !review.files.iter().any(|file| &file.path == path))
        {
            return Err(Error::new(
                "invalid",
                "Those files are not part of this turn.",
            ));
        }
    }
    let files = review
        .files
        .iter()
        .filter(|file| file.undone_at.is_none())
        .filter(|file| {
            request
                .paths
                .as_ref()
                .is_none_or(|paths| paths.contains(&file.path))
        })
        .cloned()
        .collect();
    Ok((session_cwd(&data, session)?, files))
}

fn undo_files(cwd: &Path, files: Vec<ReviewFile>) -> UndoOutcome {
    let prefix = repo_prefix(cwd);
    let mut outcome = UndoOutcome {
        undone: vec![],
        refused: vec![],
    };
    for file in files {
        let patch = (!file.binary && allowed_name(&file.path))
            .then(|| file.diff.as_deref().and_then(|diff| patch(&file, diff)))
            .flatten();
        if patch.is_some_and(|patch| reverse(cwd, prefix.as_deref(), &patch)) {
            outcome.undone.push(file.path);
        } else {
            outcome.refused.push(file.path);
        }
    }
    outcome
}

/// Inside a repository `git apply` reads patch paths from the repository root;
/// the review's paths are relative to the session workspace.
fn repo_prefix(cwd: &Path) -> Option<String> {
    let output = crate::git::bounded_probe(cwd, &["rev-parse", "--show-prefix"]).ok()?;
    let prefix = String::from_utf8(output.stdout).ok()?.trim().to_owned();
    (output.status.success() && !prefix.is_empty()).then_some(prefix)
}

/// A git patch for one reviewed file: its retained hunks under headers that say
/// whether the turn created, deleted or changed it.
fn patch(file: &ReviewFile, diff: &str) -> Option<String> {
    // Names Git would quote (quotes, backslashes) are left as they are.
    if file.path.contains(['"', '\\']) {
        return None;
    }
    let hunks = &diff[diff.find("\n@@")? + 1..];
    let name = &file.path;
    let header = match file.kind {
        ChangeKind::Added => {
            format!(
                "diff --git a/{name} b/{name}\nnew file mode 100644\n--- /dev/null\n+++ b/{name}\n"
            )
        }
        ChangeKind::Deleted => format!(
            "diff --git a/{name} b/{name}\ndeleted file mode 100644\n--- a/{name}\n+++ /dev/null\n"
        ),
        _ => format!("diff --git a/{name} b/{name}\n--- a/{name}\n+++ b/{name}\n"),
    };
    Some(format!(
        "{header}{hunks}{}",
        if hunks.ends_with('\n') { "" } else { "\n" }
    ))
}

/// `git apply -R` after a successful `--check`; the working tree only.
fn reverse(cwd: &Path, prefix: Option<&str>, patch: &str) -> bool {
    let directory = prefix.map(|prefix| format!("--directory={prefix}"));
    let run = |check: bool| {
        let mut args = vec!["apply", "-R", "--whitespace=nowarn"];
        if check {
            args.push("--check");
        }
        if let Some(directory) = &directory {
            args.push(directory);
        }
        args.push("-");
        crate::git::run_input(cwd, &args, patch.as_bytes())
            .is_ok_and(|output| output.status.success())
    };
    run(true) && run(false)
}

/// Marks undone files on the same settled turn and persists.
fn record(state: &AppState, request: &UndoRequest, undone: &[String]) -> Result<()> {
    if undone.is_empty() {
        return Ok(());
    }
    let mut data = state.data.lock();
    let now = crate::paths::now_rfc3339();
    if let Some(review) = data
        .sessions
        .iter_mut()
        .find(|s| s.id == request.session_id)
        .and_then(|session| {
            session
                .messages
                .iter_mut()
                .find(|m| m.id == request.message_id)
        })
        .and_then(|m| m.activity.as_mut()?.review.as_mut())
    {
        for file in &mut review.files {
            if undone.contains(&file.path) {
                file.undone_at.get_or_insert_with(|| now.clone());
            }
        }
    }
    crate::persist::save(&state.data_path, &data)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn file(path: &str, kind: ChangeKind, diff: &str) -> ReviewFile {
        ReviewFile {
            path: path.into(),
            kind,
            additions: 0,
            deletions: 0,
            binary: false,
            diff: Some(diff.into()),
            undone_at: None,
        }
    }

    fn git(cwd: &Path, args: &[&str]) {
        assert!(std::process::Command::new("git")
            .args(args)
            .current_dir(cwd)
            .output()
            .unwrap()
            .status
            .success());
    }

    #[test]
    fn reverse_patches_restore_only_unchanged_turn_edits() {
        let repo = tempfile::tempdir().unwrap();
        let root = repo.path();
        git(root, &["init", "-q"]);
        let cwd = root.join("app");
        std::fs::create_dir(&cwd).unwrap();
        std::fs::write(cwd.join("edit.txt"), "a\nB\nc\n").unwrap();
        std::fs::write(cwd.join("new file.txt"), "fresh\n").unwrap();
        std::fs::write(cwd.join("later.txt"), "x\nPERSON\nz\n").unwrap();
        let files = vec![
            file(
                "edit.txt",
                ChangeKind::Modified,
                "--- a/edit.txt\n+++ b/edit.txt\n@@ -1,3 +1,3 @@\n a\n-b\n+B\n c\n",
            ),
            file(
                "new file.txt",
                ChangeKind::Added,
                "--- a/new file.txt\n+++ b/new file.txt\n@@ -0,0 +1 @@\n+fresh\n",
            ),
            file(
                "gone.txt",
                ChangeKind::Deleted,
                "--- a/gone.txt\n+++ b/gone.txt\n@@ -1,2 +0,0 @@\n-one\n-two\n",
            ),
            // The person edited the same line after the turn: refused, left as is.
            file(
                "later.txt",
                ChangeKind::Modified,
                "--- a/later.txt\n+++ b/later.txt\n@@ -1,3 +1,3 @@\n x\n-y\n+AGENT\n z\n",
            ),
            file(
                "../outside.txt",
                ChangeKind::Modified,
                "--- a/x\n+++ b/x\n@@ -1 +1 @@\n-a\n+b\n",
            ),
        ];
        let outcome = undo_files(&cwd, files);
        assert_eq!(outcome.undone, ["edit.txt", "new file.txt", "gone.txt"]);
        assert_eq!(outcome.refused, ["later.txt", "../outside.txt"]);
        assert_eq!(
            std::fs::read_to_string(cwd.join("edit.txt")).unwrap(),
            "a\nb\nc\n"
        );
        assert!(!cwd.join("new file.txt").exists());
        assert_eq!(
            std::fs::read_to_string(cwd.join("gone.txt")).unwrap(),
            "one\ntwo\n"
        );
        assert_eq!(
            std::fs::read_to_string(cwd.join("later.txt")).unwrap(),
            "x\nPERSON\nz\n"
        );
    }

    #[test]
    fn workspaces_outside_git_and_missing_diffs() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("f.txt"), "new\n").unwrap();
        let mut binary = file("bin", ChangeKind::Modified, "");
        binary.binary = true;
        let outcome = undo_files(
            dir.path(),
            vec![
                file(
                    "f.txt",
                    ChangeKind::Modified,
                    "--- a/f.txt\n+++ b/f.txt\n@@ -1 +1 @@\n-old\n+new\n",
                ),
                binary,
            ],
        );
        assert_eq!(outcome.undone, ["f.txt"]);
        assert_eq!(outcome.refused, ["bin"]);
        assert_eq!(
            std::fs::read_to_string(dir.path().join("f.txt")).unwrap(),
            "old\n"
        );
    }

    #[test]
    fn requests_are_closed_and_confirmed() {
        assert!(serde_json::from_value::<UndoRequest>(
            serde_json::json!({"sessionId":"s","messageId":"m","confirm":true})
        )
        .is_ok());
        assert!(serde_json::from_value::<UndoRequest>(
            serde_json::json!({"sessionId":"s","messageId":"m","confirm":true,"cwd":"/"})
        )
        .is_err());
    }
}
