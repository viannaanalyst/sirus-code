//! Agents manage sessions (ADR-076): the `sirus_*` tools on the per-session MCP
//! bridge (ADR-030) let any session list, read, start and continue sessions.
//! They are listed only while Settings → "Let agents manage sessions" is on and
//! every call checks the setting again. Starting and messaging reuse the Astro
//! delegation path (ADR-069): new work inherits the caller's approval mode, a
//! planning (read-only) caller cannot start or message anything, and fan-out
//! and nesting are bounded.

use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use parking_lot::Mutex;
use serde_json::{json, Value};
use tauri::{AppHandle, Manager};

use crate::commands::AppState;
use crate::models::{AppData, MessageRole, Session};

/// Set in the MCP child's environment while the tools are enabled.
pub const ENV: &str = "SIRUS_SESSION_TOOLS";
const LIST_LIMIT: usize = 40;
const READ_DEFAULT: usize = 6;
const READ_LIMIT: usize = 20;
const MESSAGE_CHARS: usize = 2000;
const PROMPT_CHARS: usize = 32 * 1024;
/// Sessions one caller turn may start, and messages it may send.
const STARTS_PER_TURN: u8 = 4;
const SENDS_PER_TURN: u8 = 8;
/// Sessions started by agents may start one more level, no deeper.
const MAX_DEPTH: u8 = 2;

static ENABLED: AtomicBool = AtomicBool::new(false);

#[derive(Default)]
struct Ledger {
    /// Session id → how many agent hops started it (memory only).
    depth: HashMap<String, u8>,
    /// (caller, turn) → (started, sent).
    turns: HashMap<(String, String), (u8, u8)>,
}
static LEDGER: Mutex<Option<Ledger>> = Mutex::new(None);

pub fn set_enabled(value: bool) {
    ENABLED.store(value, Ordering::SeqCst);
}

/// The variable passed to the MCP child so it lists the tools.
pub fn child_env() -> Option<(&'static str, &'static str)> {
    ENABLED.load(Ordering::SeqCst).then_some((ENV, "1"))
}

pub fn tool_definitions() -> Vec<Value> {
    if std::env::var(ENV).as_deref() != Ok("1") {
        return vec![];
    }
    let id = || json!({ "type": "object", "properties": { "sessionId": { "type": "string" } }, "required": ["sessionId"] });
    vec![
        json!({ "name": "sirus_list_sessions", "description": "Sirus Code: the projects and recent sessions in the app (id, title, project, provider, model, status, branch), newest first. Your own session is marked self.", "inputSchema": { "type": "object", "properties": { "project": { "type": "string", "description": "Optional project name or id." } } } }),
        json!({ "name": "sirus_read_session", "description": "Sirus Code: a session's status and its last messages (user and assistant text only, each shortened to 2,000 characters).", "inputSchema": { "type": "object", "properties": { "sessionId": { "type": "string" }, "limit": { "type": "integer", "description": "Messages to return, 1–20 (default 6)." } }, "required": ["sessionId"] } }),
        json!({ "name": "sirus_session_status", "description": "Sirus Code: a session's status (idle, running, waiting for the person, completed, failed, stopped), title and last error.", "inputSchema": id() }),
        json!({ "name": "sirus_create_session", "description": "Sirus Code: start a new visible session in a project with a first prompt. It runs on its own with your approval mode (so it may wait for the person's approval in its own tab) and returns at once; check it later with sirus_session_status. At most 4 per turn.", "inputSchema": { "type": "object", "properties": { "project": { "type": "string", "description": "Project name or id." }, "prompt": { "type": "string", "description": "The task: objective, context, constraints, what it may change and the result you expect." }, "title": { "type": "string" }, "provider": { "type": "string", "description": "Optional provider id (claude, codex, opencode, …); defaults to yours." }, "model": { "type": "string" }, "newWorktree": { "type": "boolean", "description": "Default true: an isolated worktree, so parallel sessions never mix files." } }, "required": ["project", "prompt"] } }),
        json!({ "name": "sirus_send_to_session", "description": "Sirus Code: continue another idle session with a message, using your approval mode. Returns at once.", "inputSchema": { "type": "object", "properties": { "sessionId": { "type": "string" }, "prompt": { "type": "string" } }, "required": ["sessionId", "prompt"] } }),
    ]
}

/// Sessions these tools may see: not Astro conversations or side chats.
fn visible(session: &Session) -> bool {
    session.astro.is_none() && session.side_chat.is_none()
}

fn project_name(data: &AppData, id: &str) -> Option<String> {
    data.projects
        .iter()
        .find(|project| project.id == id)
        .map(|project| project.name.clone())
}

fn list(data: &AppData, caller: &str, filter: &str) -> Value {
    let project = |session: &Session| {
        filter.is_empty()
            || session.project_id == filter
            || project_name(data, &session.project_id)
                .is_some_and(|name| name.eq_ignore_ascii_case(filter))
    };
    let mut sessions: Vec<&Session> = data
        .sessions
        .iter()
        .filter(|session| visible(session) && project(session))
        .collect();
    sessions.sort_by(|a, b| b.last_activity_at.cmp(&a.last_activity_at));
    let rows: Vec<Value> = sessions
        .iter()
        .take(LIST_LIMIT)
        .map(|session| {
            let mut row = crate::astros::session_row(data, session);
            if session.id == caller {
                row["self"] = json!(true);
            }
            row
        })
        .collect();
    json!({
        "projects": data.projects.iter().map(|project| json!({ "id": project.id, "name": project.name })).collect::<Vec<_>>(),
        "sessions": rows,
        "truncated": sessions.len() > LIST_LIMIT,
    })
}

fn find<'a>(data: &'a AppData, id: &str) -> Result<&'a Session, String> {
    data.sessions
        .iter()
        .find(|session| session.id == id && visible(session))
        .ok_or_else(|| "no session with that id".to_string())
}

fn status(data: &AppData, session: &Session) -> Value {
    let mut row = crate::astros::session_row(data, session);
    row["lastError"] = json!(session.last_error);
    row["waitingForPerson"] = json!(session.status == crate::models::SessionStatus::Waiting);
    row
}

fn read(data: &AppData, session: &Session, limit: usize) -> Value {
    let limit = limit.clamp(1, READ_LIMIT);
    let messages: Vec<&crate::models::Message> = session
        .messages
        .iter()
        .filter(|message| {
            matches!(message.role, MessageRole::User | MessageRole::Agent)
                && !message.content.trim().is_empty()
        })
        .collect();
    let start = messages.len().saturating_sub(limit);
    let mut row = status(data, session);
    row["messages"] = json!(messages[start..]
        .iter()
        .map(|message| json!({
            "role": if message.role == MessageRole::User { "user" } else { "assistant" },
            "text": crate::astros::bounded(&message.content, MESSAGE_CHARS),
            "streaming": message.streaming,
            "at": message.created_at,
        }))
        .collect::<Vec<_>>());
    row["earlierMessages"] = json!(start);
    row
}

fn resolve_project(data: &AppData, wanted: &str) -> Result<String, String> {
    data.projects
        .iter()
        .find(|project| project.id == wanted || project.name.eq_ignore_ascii_case(wanted))
        .map(|project| project.id.clone())
        .ok_or_else(|| "no project with that name or id".to_string())
}

/// The caller's current turn: its latest user message.
fn turn(caller: &Session) -> String {
    caller
        .messages
        .iter()
        .rev()
        .find(|message| message.role == MessageRole::User)
        .map(|message| message.id.clone())
        .unwrap_or_default()
}

/// Reserves one start (or send) for the caller's turn; refuses past the bounds.
fn reserve(ledger: &mut Ledger, caller: &str, turn: &str, start: bool) -> Result<u8, String> {
    let depth = ledger.depth.get(caller).copied().unwrap_or(0);
    if start && depth >= MAX_DEPTH {
        return Err("sessions started this deep by agents cannot start more".into());
    }
    let used = ledger
        .turns
        .entry((caller.to_string(), turn.to_string()))
        .or_default();
    if start {
        if used.0 >= STARTS_PER_TURN {
            return Err(format!(
                "at most {STARTS_PER_TURN} sessions can be started per turn"
            ));
        }
        used.0 += 1;
    } else {
        if used.1 >= SENDS_PER_TURN {
            return Err(format!(
                "at most {SENDS_PER_TURN} messages can be sent per turn"
            ));
        }
        used.1 += 1;
    }
    Ok(depth + 1)
}

pub fn execute(
    app: &AppHandle,
    session_id: &str,
    tool: &str,
    args: &Value,
) -> Result<Value, String> {
    let state = app.state::<Arc<AppState>>().inner().clone();
    let arg = |key: &str| {
        args.get(key)
            .and_then(Value::as_str)
            .map(str::trim)
            .unwrap_or_default()
            .to_string()
    };
    let caller = {
        let data = state.data.lock();
        if !data.settings.agents_manage_sessions {
            return Err(
                "the person has not allowed agents to manage sessions (Settings → MCP servers)"
                    .into(),
            );
        }
        data.sessions
            .iter()
            .find(|session| session.id == session_id)
            .cloned()
            .ok_or("session not found")?
    };
    let mutating = matches!(tool, "sirus_create_session" | "sirus_send_to_session");
    if mutating && caller.execution.planning {
        return Err("planning is read-only: sessions cannot be started or messaged".into());
    }
    match tool {
        "sirus_list_sessions" => Ok(list(&state.data.lock(), session_id, &arg("project"))),
        "sirus_session_status" => {
            let data = state.data.lock();
            Ok(status(&data, find(&data, &arg("sessionId"))?))
        }
        "sirus_read_session" => {
            let limit = args
                .get("limit")
                .and_then(Value::as_u64)
                .map(|limit| limit as usize)
                .unwrap_or(READ_DEFAULT);
            let data = state.data.lock();
            Ok(read(&data, find(&data, &arg("sessionId"))?, limit))
        }
        "sirus_create_session" => {
            let prompt = arg("prompt");
            if prompt.is_empty() || prompt.chars().count() > PROMPT_CHARS {
                return Err("a prompt of up to 32,000 characters is required".into());
            }
            let project_id = resolve_project(&state.data.lock(), &arg("project"))?;
            let title = match arg("title") {
                title if !title.is_empty() => title,
                _ => prompt
                    .lines()
                    .next()
                    .unwrap_or_default()
                    .chars()
                    .take(60)
                    .collect(),
            };
            let depth = {
                let mut guard = LEDGER.lock();
                reserve(
                    guard.get_or_insert_with(Ledger::default),
                    session_id,
                    &turn(&caller),
                    true,
                )?
            };
            let id = crate::astros::start_from(
                app,
                &caller,
                crate::astros::StartRequest {
                    project_id,
                    title,
                    prompt,
                    provider: arg("provider"),
                    model: arg("model"),
                    new_worktree: args
                        .get("newWorktree")
                        .and_then(Value::as_bool)
                        .unwrap_or(true),
                    delegation: None,
                },
            )?;
            LEDGER
                .lock()
                .get_or_insert_with(Ledger::default)
                .depth
                .insert(id.clone(), depth);
            Ok(json!({ "started": true, "sessionId": id }))
        }
        "sirus_send_to_session" => {
            let prompt = arg("prompt");
            if prompt.is_empty() || prompt.chars().count() > PROMPT_CHARS {
                return Err("a prompt of up to 32,000 characters is required".into());
            }
            let target = {
                let data = state.data.lock();
                let target = find(&data, &arg("sessionId"))?;
                if target.id == session_id {
                    return Err("a session cannot message itself".into());
                }
                if target.status.is_active() {
                    return Err("that session is still working".into());
                }
                target.id.clone()
            };
            {
                let mut guard = LEDGER.lock();
                reserve(
                    guard.get_or_insert_with(Ledger::default),
                    session_id,
                    &turn(&caller),
                    false,
                )?;
            }
            crate::astros::send_from(app, &caller, &target, prompt)
        }
        _ => Err("unknown Sirus tool".into()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn session(id: &str, project: &str, activity: &str) -> Session {
        serde_json::from_value(json!({
            "id": id, "title": id, "projectId": project, "agent": "claude", "status": "completed",
            "createdAt": "t", "lastActivityAt": activity, "worktree": { "path": "/tmp", "branch": "main", "isolated": false },
            "messages": []
        }))
        .unwrap()
    }

    fn data() -> AppData {
        let mut data = AppData::default();
        data.projects.push(
            serde_json::from_value(
                json!({ "id": "p1", "name": "Site", "path": "/tmp/site", "addedAt": "t", "lastOpenedAt": "t" }),
            )
            .unwrap(),
        );
        data.sessions.push(session("a", "p1", "2026-01-01"));
        data.sessions.push(session("b", "p1", "2026-02-01"));
        let mut astro = session("astro", "p1", "2026-03-01");
        astro.astro = Some("x".into());
        data.sessions.push(astro);
        data
    }

    #[test]
    fn tools_are_listed_only_with_the_child_flag() {
        std::env::remove_var(ENV);
        assert!(tool_definitions().is_empty());
        std::env::set_var(ENV, "1");
        let tools = tool_definitions();
        std::env::remove_var(ENV);
        assert_eq!(tools.len(), 5);
        assert!(tools
            .iter()
            .all(|tool| tool["name"].as_str().unwrap().starts_with("sirus_")));
    }

    #[test]
    fn listing_hides_astro_conversations_sorts_and_marks_self() {
        let data = data();
        let listed = list(&data, "a", "");
        let ids: Vec<&str> = listed["sessions"]
            .as_array()
            .unwrap()
            .iter()
            .map(|row| row["id"].as_str().unwrap())
            .collect();
        assert_eq!(ids, vec!["b", "a"]);
        assert_eq!(listed["sessions"][1]["self"], true);
        assert_eq!(listed["projects"][0]["name"], "Site");
        assert_eq!(
            list(&data, "a", "site")["sessions"]
                .as_array()
                .unwrap()
                .len(),
            2
        );
        assert!(list(&data, "a", "other")["sessions"]
            .as_array()
            .unwrap()
            .is_empty());
        assert!(find(&data, "astro").is_err());
        assert_eq!(resolve_project(&data, "SITE").unwrap(), "p1");
        assert!(resolve_project(&data, "nope").is_err());
    }

    #[test]
    fn reading_is_bounded() {
        let mut data = data();
        for index in 0..30 {
            data.sessions[0].messages.push(serde_json::from_value(json!({
                "id": format!("m{index}"), "sessionId": "a", "role": if index % 2 == 0 { "user" } else { "agent" },
                "content": "x".repeat(3000), "createdAt": "t", "streaming": false
            })).unwrap());
        }
        let session = data.sessions[0].clone();
        let row = read(&data, &session, 100);
        let messages = row["messages"].as_array().unwrap();
        assert_eq!(messages.len(), READ_LIMIT);
        assert_eq!(row["earlierMessages"], 10);
        assert!(messages[0]["text"].as_str().unwrap().chars().count() <= MESSAGE_CHARS + 1);
        assert_eq!(
            read(&data, &session, 0)["messages"]
                .as_array()
                .unwrap()
                .len(),
            1
        );
    }

    #[test]
    fn fan_out_and_depth_are_bounded() {
        let mut ledger = Ledger::default();
        for _ in 0..STARTS_PER_TURN {
            assert_eq!(reserve(&mut ledger, "a", "t1", true).unwrap(), 1);
        }
        assert!(reserve(&mut ledger, "a", "t1", true).is_err());
        assert!(reserve(&mut ledger, "a", "t2", true).is_ok());
        for _ in 0..SENDS_PER_TURN {
            reserve(&mut ledger, "a", "t1", false).unwrap();
        }
        assert!(reserve(&mut ledger, "a", "t1", false).is_err());
        ledger.depth.insert("child".into(), 1);
        assert_eq!(reserve(&mut ledger, "child", "t", true).unwrap(), 2);
        ledger.depth.insert("grandchild".into(), MAX_DEPTH);
        assert!(reserve(&mut ledger, "grandchild", "t", true).is_err());
        // Deep sessions may still message others.
        assert!(reserve(&mut ledger, "grandchild", "t", false).is_ok());
    }
}
