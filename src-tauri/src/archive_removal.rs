//! One-time removal of archived conversations (ADR-173). Archiving was removed from the
//! product, so the conversations that were archived are deleted when the state loads: each
//! one goes through the same code as the "Delete conversation" action
//! (`commands::delete_session_native`), which removes its row, transcript, attachments and
//! every other per-session record.
//!
//! The worktree follows the safety rules of that action and of the old opt-in release:
//! it is removed only when the old "release worktrees" setting was on and nothing would be
//! lost (no uncommitted or untracked changes, HEAD contained in another branch or remote);
//! otherwise it stays, and the worktree cleanup in Settings lists it. Branches are never
//! deleted.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::OnceLock;

use parking_lot::Mutex;

use crate::commands::{delete_session_native, AppState};
use crate::models::SessionStatus;
use crate::worktree;

/// What the older state file said about archiving, read before the fields are dropped.
#[derive(Debug, Default, PartialEq, Eq)]
pub(crate) struct Legacy {
    ids: Vec<String>,
    release_worktrees: bool,
}

/// Read per state path by `persist::load_from`, consumed once the app state exists.
static PENDING: OnceLock<Mutex<HashMap<PathBuf, Legacy>>> = OnceLock::new();

/// The archived conversations a saved state still lists.
pub(crate) fn legacy_of(state: &serde_json::Value) -> Legacy {
    let settings = state.get("settings");
    let ids = settings
        .and_then(|settings| settings.get("archivedSessionIds"))
        .and_then(|ids| ids.as_array())
        .map(|ids| {
            ids.iter()
                .filter_map(|id| id.as_str().map(str::to_owned))
                .collect()
        })
        .unwrap_or_default();
    let release_worktrees = settings
        .and_then(|settings| settings.get("releaseWorktreeOnArchive"))
        .and_then(|flag| flag.as_bool())
        .unwrap_or(false);
    Legacy {
        ids,
        release_worktrees,
    }
}

/// Remembers the archived conversations of a state just loaded from `path`.
pub(crate) fn note(path: &Path, legacy: Legacy) {
    let mut all = PENDING.get_or_init(Mutex::default).lock();
    if legacy.ids.is_empty() {
        all.remove(path);
    } else {
        all.insert(path.to_path_buf(), legacy);
    }
}

/// Deletes the conversations noted for this state; call it right after the state is built,
/// before anything resumes work. A conversation that cannot be deleted stays as it is.
pub fn delete_archived(state: &AppState) {
    let Some(legacy) = PENDING
        .get_or_init(Mutex::default)
        .lock()
        .remove(&state.data_path)
    else {
        return;
    };
    for id in &legacy.ids {
        let remove_worktree = {
            let mut data = state.data.lock();
            let Some(session) = data.sessions.iter_mut().find(|session| &session.id == id) else {
                continue;
            };
            // Nothing runs yet at start-up; a turn a crash cut is not a live agent.
            if session.status.is_active() {
                session.status = SessionStatus::Stopped;
            }
            let tree = Path::new(&session.worktree.path);
            legacy.release_worktrees
                && session.worktree.isolated
                && tree.exists()
                && matches!(
                    worktree::release_blocker(tree, &session.worktree.branch),
                    Ok(None)
                )
        };
        let mut deleted = delete_session_native(state, id.clone(), remove_worktree, true);
        if deleted.is_err() && remove_worktree {
            // A shared or side-chat workspace is not ours to remove: delete the conversation only.
            deleted = delete_session_native(state, id.clone(), false, false);
        }
        if let Err(error) = deleted {
            tracing::warn!(%error, session = %id, "kept a conversation that was archived");
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::git::tests::Repo;
    use crate::models::AppData;

    fn session(id: &str, status: &str) -> serde_json::Value {
        serde_json::json!({"id":id,"projectId":"p","title":"T","agent":"codex","status":status,
            "createdAt":"t","lastActivityAt":"t","lastError":null,
            "worktree":{"path":"/w","branch":"main","isolated":false}})
    }

    #[test]
    fn archived_conversations_are_deleted_on_load_and_the_rest_stay() {
        let repo = Repo::new();
        let path = repo.0.join("state.json");
        let saved = serde_json::json!({
            "projects":[{"id":"p","name":"Fixture","path":crate::paths::display_path(&repo.cwd()),"addedAt":"t","lastOpenedAt":"t"}],
            "settings":{"archivedSessionIds":["old","cut","missing"],"releaseWorktreeOnArchive":true,"confirmArchive":true},
            "sessions":[session("old","completed"),session("cut","running"),session("keep","completed")],
        });
        let data: AppData = serde_json::from_value(saved.clone()).unwrap();
        crate::persist::save(&path, &data).unwrap();
        let state = AppState::new(path.clone(), repo.0.join("trees"), data);
        note(&path, legacy_of(&saved));
        delete_archived(&state);
        let ids = |data: &AppData| {
            data.sessions
                .iter()
                .map(|session| session.id.clone())
                .collect::<Vec<_>>()
        };
        assert_eq!(ids(&state.data.lock()), ["keep"]);
        assert_eq!(
            ids(&crate::persist::load_or_create(&path).unwrap()),
            ["keep"]
        );
        // Consumed once.
        delete_archived(&state);
    }

    #[test]
    fn a_worktree_with_work_in_it_survives_and_a_clean_one_is_released() {
        let repo = Repo::new();
        let path = repo.0.join("state.json");
        let base = repo.0.join("trees").join("p");
        let make = |id: &str| {
            crate::worktree::create_isolated(
                &repo.cwd(),
                &base,
                id,
                id,
                "sirus/{session-name}-{id}",
            )
            .unwrap()
        };
        let clean = make("11111111-a");
        let dirty = make("22222222-b");
        std::fs::write(Path::new(&dirty.path).join("work.txt"), "keep me").unwrap();
        let owned = |id: &str, tree: &crate::models::Worktree| {
            let mut value = session(id, "completed");
            value["worktree"] = serde_json::to_value(tree).unwrap();
            value
        };
        let saved = serde_json::json!({
            "projects":[{"id":"p","name":"Fixture","path":crate::paths::display_path(&repo.cwd()),"addedAt":"t","lastOpenedAt":"t"}],
            "settings":{"archivedSessionIds":["clean","dirty"],"releaseWorktreeOnArchive":true},
            "sessions":[owned("clean", &clean), owned("dirty", &dirty)],
        });
        let data: AppData = serde_json::from_value(saved.clone()).unwrap();
        crate::persist::save(&path, &data).unwrap();
        let state = AppState::new(path.clone(), repo.0.join("trees"), data);
        note(&path, legacy_of(&saved));
        delete_archived(&state);
        assert!(state.data.lock().sessions.is_empty());
        assert!(
            !Path::new(&clean.path).exists(),
            "a clean, merged worktree is released"
        );
        assert_eq!(
            std::fs::read_to_string(Path::new(&dirty.path).join("work.txt")).unwrap(),
            "keep me"
        );
        assert!(
            crate::git::run_ok(&repo.cwd(), &["rev-parse", "--verify", &clean.branch]).is_ok(),
            "branches are kept"
        );
    }

    #[test]
    fn a_state_without_archived_conversations_notes_nothing() {
        let legacy = legacy_of(&serde_json::json!({"settings":{}}));
        assert_eq!(legacy, Legacy::default());
    }
}
