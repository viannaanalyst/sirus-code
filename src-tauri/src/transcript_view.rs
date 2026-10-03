//! The renderer's view of sessions without full transcripts (ADR-048):
//! metadata-only state, turn-windowed session events and the closed
//! read-only `transcript_action` (load one transcript, search candidates,
//! prompt activity).

use std::collections::HashSet;

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter};

use crate::error::{Error, Result};
use crate::models::{AppData, Message, MessageRole, Session};

/// Search candidates are bounded in count and bytes; the renderer applies its
/// exact matching and its own 200-hit limit to them.
const MAX_SEARCH_QUERY: usize = 256;
const MAX_CANDIDATES: usize = 400;
const MAX_CANDIDATE_BYTES: usize = 8 * 1024 * 1024;

/// User/assistant messages: what views treat as a started conversation.
fn conversation_length(session: &Session) -> usize {
    session
        .messages
        .iter()
        .filter(|message| message.role != MessageRole::System)
        .count()
}

/// One session without its transcript. `messages` stays present and empty so the
/// shared Session shape holds; `transcriptLength` says whether it has content.
pub fn session_meta(session: &Session) -> Result<Value> {
    let mut value = crate::persist::without_transcripts(|| serde_json::to_value(session))?;
    value["messages"] = json!([]);
    value["transcriptLength"] = json!(conversation_length(session));
    Ok(value)
}

/// `load_state` payload: every session as metadata only.
pub fn state_meta(data: &AppData) -> Result<Value> {
    let mut value = crate::persist::without_transcripts(|| serde_json::to_value(data))?;
    if let Some(entries) = value.get_mut("sessions").and_then(Value::as_array_mut) {
        for (entry, session) in entries.iter_mut().zip(&data.sessions) {
            entry["messages"] = json!([]);
            entry["transcriptLength"] = json!(conversation_length(session));
        }
    }
    Ok(value)
}

/// Index of the current turn: the last user message, or the whole transcript.
pub fn current_turn(session: &Session) -> usize {
    session
        .messages
        .iter()
        .rposition(|message| message.role == MessageRole::User)
        .unwrap_or(0)
}

/// A session event carries only `messages[from..]` plus the window, so a long
/// transcript is not re-sent for every activity change. A renderer that holds
/// fewer than `from` messages reloads the transcript instead of splicing.
pub fn session_event(session: &Session, from: usize) -> Result<Value> {
    let from = from.min(session.messages.len());
    let mut value = session_meta(session)?;
    value["messages"] = serde_json::to_value(&session.messages[from..])?;
    value["transcriptWindow"] = json!({ "from": from, "total": session.messages.len() });
    Ok(value)
}

/// Publishes a lifecycle change whose message edits are within the current turn.
pub fn emit(app: &AppHandle, session: &Session) {
    emit_from(app, session, current_turn(session));
}

/// Publishes a change that also touched an earlier message (`from` covers it).
pub fn emit_from(app: &AppHandle, session: &Session, from: usize) {
    match session_event(session, from) {
        Ok(value) => {
            let _ = app.emit("session-updated", value);
        }
        Err(error) => tracing::error!(%error, "cannot publish a session update"),
    }
}

#[derive(Debug, Deserialize)]
#[serde(
    tag = "type",
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum Action {
    /// One owned session's full transcript, when the renderer opens it.
    Load { session_id: String },
    /// Messages that may contain `query` (case-insensitive literal), for the
    /// renderer's exact all-conversations search.
    Search { query: String },
    /// Owned user prompts (ID and time) for the local Profile activity.
    Activity,
}

#[derive(Debug, Serialize)]
#[serde(
    tag = "type",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum Response {
    Transcript {
        session_id: String,
        messages: Vec<Message>,
    },
    Candidates {
        sessions: Vec<CandidateSession>,
        truncated: bool,
    },
    Activity {
        sessions: Vec<SessionPrompts>,
    },
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CandidateSession {
    pub session_id: String,
    pub messages: Vec<Message>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionPrompts {
    pub session_id: String,
    pub prompts: Vec<PromptTime>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PromptTime {
    pub id: String,
    pub created_at: String,
}

/// Sessions whose project still exists, in state order.
fn owned(data: &AppData) -> impl Iterator<Item = &Session> {
    let projects = data
        .projects
        .iter()
        .map(|project| project.id.as_str())
        .collect::<HashSet<_>>();
    data.sessions
        .iter()
        .filter(move |session| projects.contains(session.project_id.as_str()))
}

pub fn load(data: &AppData, session_id: &str) -> Result<Response> {
    let session = data
        .sessions
        .iter()
        .find(|session| session.id == session_id)
        .ok_or_else(|| Error::not_found("session not found"))?;
    Ok(Response::Transcript {
        session_id: session.id.clone(),
        messages: session.messages.clone(),
    })
}

/// Runs on a cloned snapshot so a long scan never holds the state lock.
pub fn search(sessions: &[Session], projects: &HashSet<String>, query: &str) -> Result<Response> {
    let needle = query.trim();
    if needle.is_empty() || needle.chars().count() > MAX_SEARCH_QUERY {
        return Err(Error::new(
            "invalid",
            "Search text must be 1 to 256 characters.",
        ));
    }
    let needle = needle.to_lowercase();
    let (mut found, mut bytes, mut truncated) = (Vec::<CandidateSession>::new(), 0usize, false);
    'sessions: for session in sessions
        .iter()
        .filter(|session| projects.contains(&session.project_id))
    {
        let mut messages = Vec::new();
        for message in &session.messages {
            if message.role == MessageRole::System
                || message.session_id != session.id
                || !message.content.to_lowercase().contains(&needle)
            {
                continue;
            }
            let count = found
                .iter()
                .map(|entry| entry.messages.len())
                .sum::<usize>()
                + messages.len();
            if count >= MAX_CANDIDATES || bytes + message.content.len() > MAX_CANDIDATE_BYTES {
                truncated = true;
                if !messages.is_empty() {
                    found.push(CandidateSession {
                        session_id: session.id.clone(),
                        messages,
                    });
                }
                break 'sessions;
            }
            bytes += message.content.len();
            messages.push(message.clone());
        }
        if !messages.is_empty() {
            found.push(CandidateSession {
                session_id: session.id.clone(),
                messages,
            });
        }
    }
    Ok(Response::Candidates {
        sessions: found,
        truncated,
    })
}

/// Owned user prompts after any fork-inherited prefix, deduplicated by ID.
pub fn activity(data: &AppData) -> Response {
    let sessions = owned(data)
        .map(|session| {
            let inherited = session
                .fork_origin
                .as_ref()
                .map_or(0, |origin| origin.inherited_message_count)
                .min(session.messages.len());
            let mut seen = HashSet::new();
            let prompts = session.messages[inherited..]
                .iter()
                .filter(|message| {
                    message.role == MessageRole::User
                        && message.session_id == session.id
                        && seen.insert(message.id.clone())
                })
                .map(|message| PromptTime {
                    id: message.id.clone(),
                    created_at: message.created_at.clone(),
                })
                .collect();
            SessionPrompts {
                session_id: session.id.clone(),
                prompts,
            }
        })
        .collect();
    Response::Activity { sessions }
}

/// Clones what a search needs under the lock; the scan runs after release.
pub fn search_snapshot(data: &AppData) -> (Vec<Session>, HashSet<String>) {
    (
        owned(data).cloned().collect(),
        data.projects
            .iter()
            .map(|project| project.id.clone())
            .collect(),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    fn data() -> AppData {
        let message = |id: &str, session: &str, role: &str, content: &str| json!({"id":id,"sessionId":session,"role":role,"content":content,"createdAt":format!("2026-10-0{}T10:00:00Z", id.len() % 9 + 1),"streaming":false});
        let mut value = serde_json::to_value(AppData::default()).unwrap();
        value["projects"] =
            json!([{"id":"p","name":"p","path":"/fixture","addedAt":"t","lastOpenedAt":"t"}]);
        value["sessions"] = json!([
            {"id":"a","title":"A","projectId":"p","agent":"codex","status":"completed","createdAt":"t","lastActivityAt":"t","worktree":{"path":"/fixture","branch":"main","isolated":false},"lastError":null,
             "forkOrigin":{"sourceSessionId":"z","sourceMessageId":"m","sourceTitle":"Z","inheritedMessageCount":1},
             "messages":[message("a0","a","user","inherited Rate limit"), message("a1","a","user","Add a RATE limit"), message("a2","a","agent","Done: rate limited"), message("a3","a","system","rate warning")]},
            {"id":"orphan","title":"O","projectId":"gone","agent":"codex","status":"completed","createdAt":"t","lastActivityAt":"t","worktree":{"path":"/fixture","branch":"main","isolated":false},"lastError":null,
             "messages":[message("o1","orphan","user","rate")]}
        ]);
        serde_json::from_value(value).unwrap()
    }

    #[test]
    fn metadata_state_and_events_never_carry_whole_transcripts() {
        let data = data();
        let state = state_meta(&data).unwrap();
        assert_eq!(state["sessions"][0]["messages"], json!([]));
        assert_eq!(state["sessions"][0]["transcriptLength"], json!(3));
        let event = session_event(&data.sessions[0], current_turn(&data.sessions[0])).unwrap();
        assert_eq!(event["transcriptWindow"], json!({"from": 1, "total": 4}));
        assert_eq!(event["messages"].as_array().unwrap().len(), 3);
        let earlier = session_event(&data.sessions[0], 0).unwrap();
        assert_eq!(earlier["messages"].as_array().unwrap().len(), 4);
        assert_eq!(
            session_event(&data.sessions[0], 99).unwrap()["transcriptWindow"]["from"],
            json!(4)
        );
        // Memory and persistence keep the inline transcript unaffected.
        assert_eq!(
            serde_json::to_value(&data.sessions[0]).unwrap()["messages"]
                .as_array()
                .unwrap()
                .len(),
            4
        );
    }

    #[test]
    fn search_returns_bounded_owned_literal_candidates() {
        let data = data();
        let (sessions, projects) = search_snapshot(&data);
        let Response::Candidates {
            sessions: found,
            truncated,
        } = search(&sessions, &projects, "  RATE ").unwrap()
        else {
            panic!()
        };
        assert!(!truncated);
        assert_eq!(found.len(), 1, "orphaned projects are excluded");
        assert_eq!(
            found[0]
                .messages
                .iter()
                .map(|m| m.id.as_str())
                .collect::<Vec<_>>(),
            ["a0", "a1", "a2"],
            "system text is excluded"
        );
        assert!(search(&sessions, &projects, "   ").is_err());
        assert!(search(&sessions, &projects, &"x".repeat(257)).is_err());
        assert!(
            matches!(search(&sessions, &projects, ".*"), Ok(Response::Candidates { sessions, .. }) if sessions.is_empty())
        );
    }

    #[test]
    fn activity_skips_inherited_foreign_and_duplicate_prompts() {
        let mut data = data();
        let duplicate = data.sessions[0].messages[1].clone();
        data.sessions[0].messages.push(duplicate);
        let Response::Activity { sessions } = activity(&data) else {
            panic!()
        };
        assert_eq!(sessions.len(), 1);
        assert_eq!(
            sessions[0]
                .prompts
                .iter()
                .map(|p| p.id.as_str())
                .collect::<Vec<_>>(),
            ["a1"]
        );
        assert!(load(&data, "missing").is_err());
        assert!(
            matches!(load(&data, "a"), Ok(Response::Transcript { messages, .. }) if messages.len() == 5)
        );
    }
}
