//! Auto-archive (ADR-130): conversations whose own pull request
//! was merged, or that have been inactive for N days, join `archivedSessionIds` on their own.
//! Running, waiting, pinned, snoozed and side-chat conversations are never touched, nor
//! those whose own `autoArchiveDisabled` flag is on (set from the phone's row menu). With
//! "Release the worktree when a session is archived" on, the worktree goes the same way a
//! manual archive takes it (`worktree_cleanup::release_archived`, which keeps unsafe trees).

use std::collections::{HashMap, HashSet};
use std::sync::Arc;
use std::time::{Duration, Instant};

use crate::runtime::{AppHandle, Emitter, Manager, State};
use chrono::{DateTime, Utc};

use crate::commands::{native_task, AppState};
use crate::error::{Error, Result};
use crate::models::{AppData, Session};

/// One pass every five minutes; the first a minute after launch.
const PASS: Duration = Duration::from_secs(5 * 60);
const FIRST_PASS: Duration = Duration::from_secs(60);
/// A conversation's pull request is looked up at most every 30 minutes, and at most four
/// lookups run per pass (each is a few `gh api` calls).
const RECHECK: Duration = Duration::from_secs(30 * 60);
const LOOKUPS_PER_PASS: usize = 4;

/// Whether a conversation may be archived automatically at all.
fn eligible(data: &AppData, session: &Session) -> bool {
    let settings = &data.settings;
    !settings.archived_session_ids.contains(&session.id)
        && !settings.pinned_session_ids.contains(&session.id)
        && !session.status.is_active()
        && session.pending_requests.is_empty()
        && session.snoozed_until.is_none()
        && !session.is_auxiliary()
        && session.team_worker.is_none()
        && !session.auto_archive_disabled
}

/// Turns auto-archive on (`enabled`, following the global rules) or off for one
/// conversation. Replies with the session's metadata.
#[cfg_attr(feature = "desktop", tauri::command)]
pub async fn set_session_auto_archive(
    app: AppHandle,
    state: State<'_, Arc<AppState>>,
    session_id: String,
    enabled: bool,
) -> Result<serde_json::Value> {
    let state = state.inner().clone();
    native_task(move || {
        let mut data = state.data.lock();
        state.ensure_running()?;
        let session = data
            .sessions
            .iter_mut()
            .find(|session| session.id == session_id)
            .ok_or_else(|| Error::not_found("session not found"))?;
        let previous = session.auto_archive_disabled;
        session.auto_archive_disabled = !enabled;
        if let Err(error) = crate::persist::save(&state.data_path, &data) {
            if let Some(session) = data.sessions.iter_mut().find(|item| item.id == session_id) {
                session.auto_archive_disabled = previous;
            }
            return Err(error);
        }
        let session = data
            .sessions
            .iter()
            .find(|session| session.id == session_id)
            .ok_or_else(|| Error::not_found("session not found"))?;
        // Other windows (a paired phone) learn of it like any session change.
        crate::transcript_view::emit(&app, session);
        crate::transcript_view::session_meta(session)
    })
    .await
}

/// Conversations whose pull request is worth a lookup now: eligible ones in their own
/// worktree (a checkout's branch is not the conversation's), most recently active first,
/// skipping those checked within `RECHECK`.
pub fn lookup_candidates(
    data: &AppData,
    checked: &HashMap<String, Instant>,
    now: Instant,
) -> Vec<String> {
    if !data.settings.auto_archive_merged {
        return Vec::new();
    }
    let mut sessions = data
        .sessions
        .iter()
        .filter(|session| session.worktree.isolated && eligible(data, session))
        .filter(|session| {
            checked
                .get(&session.id)
                .is_none_or(|at| now.saturating_duration_since(*at) >= RECHECK)
        })
        .collect::<Vec<_>>();
    sessions.sort_by(|a, b| b.last_activity_at.cmp(&a.last_activity_at));
    sessions
        .into_iter()
        .take(LOOKUPS_PER_PASS)
        .map(|session| session.id.clone())
        .collect()
}

/// The conversations to archive now: eligible ones with a merged pull request (when that
/// rule is on) or without activity for the configured number of days.
pub fn select(data: &AppData, now: DateTime<Utc>, merged: &HashSet<String>) -> Vec<String> {
    let settings = &data.settings;
    let cutoff = settings
        .auto_archive_inactive_days
        .map(|days| now - chrono::Duration::days(i64::from(days)));
    data.sessions
        .iter()
        .filter(|session| eligible(data, session))
        .filter(|session| {
            let merged = settings.auto_archive_merged && merged.contains(&session.id);
            let inactive = cutoff.is_some_and(|cutoff| {
                DateTime::parse_from_rfc3339(&session.last_activity_at)
                    .is_ok_and(|at| at.with_timezone(&Utc) < cutoff)
            });
            merged || inactive
        })
        .map(|session| session.id.clone())
        .collect()
}

fn archive(data: &mut AppData, ids: &[String]) {
    for id in ids {
        if !data.settings.archived_session_ids.contains(id) {
            data.settings.archived_session_ids.push(id.clone());
        }
    }
}

/// Starts the background pass. It does nothing while both rules are off.
pub fn start(app: AppHandle) {
    crate::runtime::async_runtime::spawn(async move {
        let state = app.state::<Arc<AppState>>().inner().clone();
        tokio::time::sleep(FIRST_PASS).await;
        let mut checked = HashMap::new();
        let mut merged = HashSet::new();
        loop {
            if state.ensure_running().is_err() {
                return;
            }
            pass(&app, &state, &mut checked, &mut merged).await;
            tokio::time::sleep(PASS).await;
        }
    });
}

async fn pass(
    app: &AppHandle,
    state: &Arc<AppState>,
    checked: &mut HashMap<String, Instant>,
    merged: &mut HashSet<String>,
) {
    let lookups = {
        let data = state.data.lock();
        if !data.settings.auto_archive_merged && data.settings.auto_archive_inactive_days.is_none()
        {
            return;
        }
        lookup_candidates(&data, checked, Instant::now())
    };
    for id in lookups {
        checked.insert(id.clone(), Instant::now());
        let (owned, session_id) = (state.clone(), id.clone());
        let context = tokio::task::spawn_blocking(move || {
            crate::commands::pull_request_context(&owned, &session_id)
        })
        .await;
        let Ok(Ok(context)) = context else { continue };
        let snapshot = crate::pull_requests::load(id.clone(), &context).await;
        if snapshot
            .pull_request
            .is_some_and(|pull| pull.state == "merged")
        {
            merged.insert(id);
        }
    }
    let (archived, settings, release) = {
        let mut data = state.data.lock();
        let ids = select(&data, Utc::now(), merged);
        archive(&mut data, &ids);
        (
            ids,
            data.settings.clone(),
            data.settings.release_worktree_on_archive,
        )
    };
    if archived.is_empty() {
        return;
    }
    if let Err(error) = state.persist() {
        tracing::warn!(%error, "auto-archive was not saved");
        return;
    }
    tracing::info!(count = archived.len(), "auto-archived conversations");
    let _ = app.emit("settings-changed", &settings);
    if !release {
        return;
    }
    for id in archived {
        merged.remove(&id);
        let owned = state.clone();
        let isolated = {
            let data = state.data.lock();
            data.sessions
                .iter()
                .any(|session| session.id == id && session.worktree.isolated)
        };
        if isolated {
            let _ = tokio::task::spawn_blocking(move || {
                crate::worktree_cleanup::release_archived(&owned, &id)
            })
            .await;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::SessionStatus;

    fn session(id: &str, last: &str, isolated: bool) -> Session {
        serde_json::from_value(serde_json::json!({
            "id": id, "title": "Work", "projectId": "p", "agent": "codex", "status": "idle",
            "createdAt": last, "lastActivityAt": last,
            "worktree": {"path": format!("/trees/{id}"), "branch": format!("sirus/{id}"), "isolated": isolated},
            "lastError": null
        }))
        .unwrap()
    }

    fn data() -> AppData {
        let mut data = AppData {
            sessions: vec![
                session("old", "2026-10-01T00:00:00Z", true),
                session("fresh", "2026-10-12T00:00:00Z", true),
                session("running", "2026-10-01T00:00:00Z", true),
                session("waiting", "2026-10-01T00:00:00Z", false),
                session("pinned", "2026-10-01T00:00:00Z", true),
                session("snoozed", "2026-10-01T00:00:00Z", true),
                session("archived", "2026-10-01T00:00:00Z", true),
                session("checkout", "2026-10-01T00:00:00Z", false),
                session("opted-out", "2026-10-01T00:00:00Z", true),
            ],
            ..AppData::default()
        };
        data.sessions[2].status = SessionStatus::Running;
        data.sessions[3].status = SessionStatus::Waiting;
        data.sessions[5].snoozed_until = Some("2026-10-20T00:00:00Z".into());
        data.settings.pinned_session_ids = vec!["pinned".into()];
        data.settings.archived_session_ids = vec!["archived".into()];
        data.sessions[8].auto_archive_disabled = true;
        data
    }

    fn now() -> DateTime<Utc> {
        DateTime::parse_from_rfc3339("2026-10-13T00:00:00Z")
            .unwrap()
            .with_timezone(&Utc)
    }

    #[test]
    fn nothing_is_archived_while_both_rules_are_off() {
        let data = data();
        let merged = HashSet::from(["fresh".to_string()]);
        assert!(select(&data, now(), &merged).is_empty());
        assert!(lookup_candidates(&data, &HashMap::new(), Instant::now()).is_empty());
    }

    #[test]
    fn inactive_conversations_go_but_never_running_waiting_pinned_or_snoozed_ones() {
        let mut data = data();
        data.settings.auto_archive_inactive_days = Some(3);
        assert_eq!(
            select(&data, now(), &HashSet::new()),
            vec!["old".to_string(), "checkout".to_string()]
        );
        // A side chat follows its main conversation, never on its own.
        data.sessions[0].side_chat = Some(crate::side_chat::SideChatOrigin {
            parent_session_id: "fresh".into(),
        });
        assert_eq!(
            select(&data, now(), &HashSet::new()),
            vec!["checkout".to_string()]
        );
        data.settings.auto_archive_inactive_days = Some(30);
        assert!(select(&data, now(), &HashSet::new()).is_empty());
    }

    #[test]
    fn a_conversation_with_auto_archive_off_is_never_archived_or_looked_up() {
        let mut data = data();
        data.settings.auto_archive_inactive_days = Some(1);
        data.settings.auto_archive_merged = true;
        let merged = HashSet::from(["opted-out".to_string()]);
        assert!(!select(&data, now(), &merged).contains(&"opted-out".to_string()));
        assert!(!lookup_candidates(&data, &HashMap::new(), Instant::now())
            .contains(&"opted-out".to_string()));
        // The flag is saved with the session only when on.
        let value = serde_json::to_value(&data.sessions[8]).unwrap();
        assert_eq!(value["autoArchiveDisabled"], true);
        assert!(serde_json::to_value(&data.sessions[0]).unwrap()["autoArchiveDisabled"].is_null());
    }

    #[test]
    fn merged_pull_requests_archive_only_with_their_rule_on() {
        let mut data = data();
        let merged = HashSet::from([
            "fresh".to_string(),
            "running".to_string(),
            "pinned".to_string(),
            "opted-out".to_string(),
        ]);
        data.settings.auto_archive_merged = true;
        assert_eq!(select(&data, now(), &merged), vec!["fresh".to_string()]);
        archive(&mut data, &["fresh".into(), "fresh".into()]);
        assert_eq!(
            data.settings.archived_session_ids,
            vec!["archived".to_string(), "fresh".to_string()]
        );
    }

    #[test]
    fn pull_requests_are_looked_up_for_own_worktrees_newest_first_and_not_too_often() {
        let mut data = data();
        data.settings.auto_archive_merged = true;
        let start = Instant::now();
        assert_eq!(
            lookup_candidates(&data, &HashMap::new(), start),
            vec!["fresh".to_string(), "old".to_string()]
        );
        let checked = HashMap::from([("fresh".to_string(), start)]);
        assert_eq!(
            lookup_candidates(&data, &checked, start + Duration::from_secs(60)),
            vec!["old".to_string()]
        );
        assert_eq!(lookup_candidates(&data, &checked, start + RECHECK).len(), 2);
    }
}
