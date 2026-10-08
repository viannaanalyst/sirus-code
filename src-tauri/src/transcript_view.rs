//! The renderer's view of sessions without full transcripts (ADR-048):
//! metadata-only state, turn-windowed session events and the closed
//! read-only `transcript_action` (load one transcript, search candidates).

use std::collections::{HashMap, HashSet};
use std::hash::{DefaultHasher, Hash, Hasher};
use std::sync::LazyLock;

use parking_lot::Mutex;

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

/// A session as a command reply: metadata plus its messages from the last agent reply on.
/// Callers read the new turn's state and that reply; a whole transcript would make every
/// send from a paired phone carry megabytes it never uses.
pub fn session_tail(session: &Session) -> Result<Value> {
    let from = session
        .messages
        .iter()
        .rposition(|message| message.role == crate::models::MessageRole::Agent)
        .unwrap_or(session.messages.len());
    let mut value = session_meta(session)?;
    value["messages"] = serde_json::to_value(&session.messages[from..])?;
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

/// Per session, a fingerprint of the current turn's user message as last published.
static SENT_TURNS: LazyLock<Mutex<HashMap<String, u64>>> = LazyLock::new(Default::default);

/// Everything a renderer shows of a user message. Older embedded thumbnails could make
/// it megabytes, so it is hashed field by field instead of serialized.
fn fingerprint(message: &Message) -> u64 {
    let mut hasher = DefaultHasher::new();
    if let Ok(bytes) = serde_json::to_vec(&(
        &message.id,
        &message.role,
        &message.content,
        &message.created_at,
        message.streaming,
        &message.activity,
        &message.steers,
        &message.launched,
        &message.documents,
    )) {
        bytes.hash(&mut hasher);
    }
    for attachment in &message.attachments {
        attachment.id.hash(&mut hasher);
        attachment.name.hash(&mut hasher);
        attachment.kind.hash(&mut hasher);
        attachment.mime_type.hash(&mut hasher);
        attachment.size.hash(&mut hasher);
        attachment.thumbnail.hash(&mut hasher);
        attachment.has_thumbnail.hash(&mut hasher);
    }
    message.attachments.len().hash(&mut hasher);
    hasher.finish()
}

/// Where a live event's window starts. The turn's user message (with its image
/// thumbnails) is sent once; while it stays unchanged, later events of the same
/// turn start at the reply after it. A renderer that missed that first event holds
/// fewer than `from` messages and reloads the transcript instead of splicing.
fn live_from(sent: &mut HashMap<String, u64>, session: &Session, from: usize) -> usize {
    let turn = current_turn(session);
    let Some(user) = session
        .messages
        .get(turn)
        .filter(|message| message.role == MessageRole::User)
    else {
        return from;
    };
    if from > turn {
        return from;
    }
    let print = fingerprint(user);
    if from == turn && sent.get(&session.id) == Some(&print) {
        return turn + 1;
    }
    sent.insert(session.id.clone(), print);
    from
}

/// Publishes a lifecycle change whose message edits are within the current turn.
pub fn emit(app: &AppHandle, session: &Session) {
    emit_from(app, session, current_turn(session));
}

/// Publishes a change that also touched an earlier message (`from` covers it).
pub fn emit_from(app: &AppHandle, session: &Session, from: usize) {
    let from = live_from(&mut SENT_TURNS.lock(), session, from);
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
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CandidateSession {
    pub session_id: String,
    pub messages: Vec<Message>,
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

/// Clones what a search needs under the lock; the scan runs after release.
pub fn search_snapshot(data: &AppData) -> (Vec<Session>, HashSet<String>) {
    (
        // Side chats are hidden from session lists, so search does not open them.
        owned(data)
            .filter(|session| session.side_chat.is_none())
            .cloned()
            .collect(),
        data.projects
            .iter()
            .map(|project| project.id.clone())
            .collect(),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn command_replies_carry_only_the_latest_reply_on() {
        let data = data();
        let session = &data.sessions[0];
        let tail = session_tail(session).unwrap();
        let ids: Vec<_> = tail["messages"]
            .as_array()
            .unwrap()
            .iter()
            .map(|message| message["id"].as_str().unwrap().to_string())
            .collect();
        assert_eq!(ids, ["a2", "a3"], "from the last agent reply on");
        assert_eq!(tail["title"], "A");
        assert_eq!(session_meta(session).unwrap()["messages"], json!([]));
    }

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
    fn live_events_send_the_user_message_once_per_turn() {
        let mut data = data();
        let session = &mut data.sessions[0];
        let mut sent = HashMap::new();
        let turn = current_turn(session);
        assert_eq!(turn, 1);
        assert_eq!(
            live_from(&mut sent, session, turn),
            1,
            "first event carries it"
        );
        assert_eq!(
            live_from(&mut sent, session, turn),
            2,
            "later events skip it"
        );
        assert_eq!(
            live_from(&mut sent, session, 0),
            0,
            "explicit earlier windows stay"
        );
        assert_eq!(live_from(&mut sent, session, turn), 2);
        let event = session_event(session, live_from(&mut sent, session, turn)).unwrap();
        assert_eq!(event["transcriptWindow"], json!({"from": 2, "total": 4}));
        // An edited user message is sent again.
        session.messages[1].content.push_str(" now");
        assert_eq!(live_from(&mut sent, session, turn), 1);
        assert_eq!(live_from(&mut sent, session, turn), 2);
        // A new turn starts at its own user message.
        let mut next = session.messages[1].clone();
        next.id = "a4".into();
        session.messages.push(next);
        assert_eq!(live_from(&mut sent, session, current_turn(session)), 4);
        assert_eq!(live_from(&mut sent, session, current_turn(session)), 5);
        // Without a user message the window is unchanged.
        session
            .messages
            .retain(|message| message.role != MessageRole::User);
        assert_eq!(live_from(&mut sent, session, current_turn(session)), 0);
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
    fn load_returns_only_owned_transcripts() {
        let data = data();
        assert!(load(&data, "missing").is_err());
        assert!(
            matches!(load(&data, "a"), Ok(Response::Transcript { messages, .. }) if messages.len() == 4)
        );
    }
}
