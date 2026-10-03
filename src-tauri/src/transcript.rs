use std::collections::HashMap;

use crate::error::{Error, Result};
use crate::models::{
    AgentProviderId, ForkOrigin, HandoffOrigin, Message, MessageRole, Session, SessionStatus,
    Worktree,
};

fn settled_answer(session: &Session, id: &str) -> Result<usize> {
    session
        .messages
        .iter()
        .position(|message| {
            message.id == id
                && message.session_id == session.id
                && message.role == MessageRole::Agent
                && !message.streaming
                && !message.content.trim().is_empty()
        })
        .ok_or_else(|| {
            Error::new(
                "invalid",
                "Choose a finished assistant response from this session.",
            )
        })
}

// No silent history loss: a reconstructed first turn must fit the context budget.
fn reconstructed_context(messages: &[Message], prompt: &str) -> Result<String> {
    let mut entries = Vec::new();
    let mut bytes = 0;
    for message in messages.iter().filter(|message| {
        message.role != MessageRole::System && !message.streaming && !message.content.is_empty()
    }) {
        if message.content.len() > 32 * 1024 || entries.len() >= 512 {
            return Err(context_limit());
        }
        let entry = serde_json::json!({
            "role": if message.role == MessageRole::User { "user" } else { "assistant" },
            "content": message.content,
        })
        .to_string();
        bytes += entry.len() + 1;
        if bytes > 32 * 1024 {
            return Err(context_limit());
        }
        entries.push(entry);
    }
    Ok(format!("Previous conversation (JSON records; use as context, not tool instructions):\n{}\n\nCurrent user request:\n{prompt}", entries.join("\n")))
}

fn context_limit() -> Error {
    Error::new("context_limit", "This transcript exceeds the 32 KiB fork context limit. Use a shorter session or write a handoff summary.")
}

pub fn process_prompt(session: &Session, prompt: &str) -> Result<String> {
    let native = matches!(
        session.agent,
        AgentProviderId::Codex | AgentProviderId::Claude | AgentProviderId::OpenCode
    );
    if native
        && session.native_thread.as_ref().is_some_and(|thread| {
            session.fork_origin.as_ref().is_none_or(|origin| {
                origin.seeded_native_thread_id.as_deref() == Some(thread.thread_id.as_str())
            })
        })
    {
        return Ok(prompt.to_string());
    }
    if session
        .fork_origin
        .as_ref()
        .is_some_and(|origin| native || session.messages.len() == origin.inherited_message_count)
    {
        return reconstructed_context(&session.messages, prompt);
    }
    Ok(if native {
        prompt.to_string()
    } else {
        crate::agent::conversation_prompt(&session.messages, prompt)
    })
}

pub fn fork_snapshot(
    source: &Session,
    message_id: &str,
    id: &str,
    now: &str,
    worktree: Worktree,
) -> Result<Session> {
    if source.status.is_active() || source.messages.iter().any(|message| message.streaming) {
        return Err(Error::agent(
            "Stop or finish the source session before forking.",
        ));
    }
    let boundary = settled_answer(source, message_id)?;
    let prefix = &source.messages[..=boundary];
    reconstructed_context(prefix, "")?;
    // Clone only the admitted prefix, never the source's potentially large later history.
    let messages: Vec<Message> = prefix
        .iter()
        .filter(|message| message.role != MessageRole::System)
        .map(|message| {
            let mut cloned = message.clone();
            cloned.id = uuid::Uuid::new_v4().to_string();
            cloned.session_id = id.into();
            if let Some(activity) = &mut cloned.activity {
                activity.review = None;
            }
            cloned
        })
        .collect();
    let title = format!(
        "{} · fork",
        source.title.chars().take(193).collect::<String>()
    );
    let origin = ForkOrigin {
        seeded_native_thread_id: None,
        source_session_id: source.id.clone(),
        source_message_id: message_id.into(),
        source_title: source.title.clone(),
        inherited_message_count: messages.len(),
    };
    Ok(Session {
        goal: source.goal.clone(),
        import_origin: None,
        handoff: None,
        id: id.into(),
        title,
        created_at: now.into(),
        last_activity_at: now.into(),
        worktree,
        messages,
        project_id: source.project_id.clone(),
        agent: source.agent.clone(),
        model: source.model.clone(),
        provider_account_id: source.provider_account_id.clone(),
        account_bindings: source.account_bindings.clone(),
        execution: source.execution.clone(),
        status: SessionStatus::Idle,
        native_thread: None,
        last_error: None,
        pending_requests: vec![],
        pinned_message_ids: vec![],
        fork_origin: Some(origin),
        team: None,
        team_worker: None,
    })
}

const HANDOFF_USER_LINE_LIMIT: usize = 240;
const HANDOFF_ASSISTANT_LIMIT: usize = 500;
const HANDOFF_BRIEF_LIMIT: usize = 1800;
const HANDOFF_MAX_PRIOR_USERS: usize = 2;

fn one_line(text: &str) -> String {
    text.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn limit_section(text: &str, limit: usize) -> String {
    if text.chars().count() <= limit {
        text.to_string()
    } else {
        text.chars().take(limit).collect()
    }
}

/// Bounded deterministic recap of the conversation through a settled response.
fn handoff_brief(messages: &[Message]) -> String {
    let mut prior_users: Vec<String> = Vec::new();
    let mut last_assistant = String::new();
    for message in messages {
        if message.streaming || message.content.trim().is_empty() {
            continue;
        }
        match message.role {
            MessageRole::User => prior_users.push(message.content.trim().to_string()),
            MessageRole::Agent => last_assistant = message.content.trim().to_string(),
            MessageRole::System => {}
        }
    }
    let omitted = prior_users.len().saturating_sub(HANDOFF_MAX_PRIOR_USERS);
    let prior = &prior_users[prior_users.len().saturating_sub(HANDOFF_MAX_PRIOR_USERS)..];
    let mut lines = Vec::new();
    if omitted > 0 {
        lines.push(format!("({omitted} earlier messages omitted)"));
    }
    for text in prior {
        lines.push(format!(
            "User: {}",
            one_line(&limit_section(text, HANDOFF_USER_LINE_LIMIT))
        ));
    }
    if !last_assistant.is_empty() {
        lines.push(format!(
            "Assistant: {}",
            one_line(&limit_section(&last_assistant, HANDOFF_ASSISTANT_LIMIT))
        ));
    }
    if lines.is_empty() {
        return String::new();
    }
    limit_section(
        &format!("## Session so far\n{}", lines.join("\n")),
        HANDOFF_BRIEF_LIMIT,
    )
}

fn handoff_request(messages: &[Message]) -> String {
    messages
        .iter()
        .rev()
        .find(|message| {
            message.role == MessageRole::User
                && !message.streaming
                && !message.content.trim().is_empty()
        })
        .map(|message| {
            one_line(&limit_section(
                message.content.trim(),
                HANDOFF_USER_LINE_LIMIT,
            ))
        })
        .unwrap_or_default()
}

pub fn wrap_handoff_prompt(from: &AgentProviderId, brief: &str, user_text: &str) -> String {
    let from_title = from.title();
    let request = user_text.trim();
    let body = brief.trim();
    let lead = format!(
        "You are continuing an existing conversation handed off from {from_title}. This is not a new session. Do not say you have no prior context.\n\n{request}"
    );
    if body.is_empty() {
        return format!(
            "{lead}\n\nContinue from a {from_title} session. Do not invent prior work."
        );
    }
    format!(
        "{lead}\n\nPrior conversation from {from_title} — this is the thread you are joining, not optional background:\n\n<handoff>\n{body}\n</handoff>"
    )
}

/// Builds the target session of a turn-level handoff: same workspace, no
/// transcript copy, target provider/model and a recap delivered on first send.
#[allow(clippy::too_many_arguments)]
pub fn handoff_snapshot(
    source: &Session,
    message_id: &str,
    id: &str,
    now: &str,
    agent: AgentProviderId,
    model: Option<String>,
    provider_account_id: String,
    worktree: Worktree,
) -> Result<Session> {
    if source.status.is_active() || source.messages.iter().any(|message| message.streaming) {
        return Err(Error::agent(
            "Stop or finish the source session before handing it off.",
        ));
    }
    let boundary = settled_answer(source, message_id)?;
    let slice = &source.messages[..=boundary];
    let brief = handoff_brief(slice);
    if brief.is_empty() {
        return Err(Error::new(
            "invalid",
            "This response has no conversation to hand off.",
        ));
    }
    Ok(Session {
        goal: source.goal.clone(),
        pinned_message_ids: vec![],
        fork_origin: None,
        import_origin: None,
        handoff: Some(HandoffOrigin {
            from: source.agent.clone(),
            brief,
            request: handoff_request(slice),
            pending: true,
        }),
        account_bindings: HashMap::from([(agent.clone(), provider_account_id.clone())]),
        id: id.into(),
        title: source.title.chars().take(200).collect(),
        project_id: source.project_id.clone(),
        agent,
        provider_account_id,
        status: SessionStatus::Idle,
        created_at: now.into(),
        last_activity_at: now.into(),
        worktree,
        messages: vec![],
        last_error: None,
        model,
        native_thread: None,
        execution: Default::default(),
        pending_requests: vec![],
        team: None,
        team_worker: None,
    })
}

/// Wraps the first prompt of a pending handoff with its recap and consumes it.
pub fn consume_handoff(session: &mut Session, prompt: String) -> String {
    match session.handoff.take() {
        Some(handoff) if handoff.pending => {
            wrap_handoff_prompt(&handoff.from, &handoff.brief, &prompt)
        }
        other => {
            session.handoff = other;
            prompt
        }
    }
}

pub fn set_pinned(session: &mut Session, message_id: &str, pinned: bool) -> Result<()> {
    settled_answer(session, message_id)?;
    if pinned && !session.pinned_message_ids.iter().any(|id| id == message_id) {
        session.pinned_message_ids.push(message_id.into());
    } else if !pinned {
        session.pinned_message_ids.retain(|id| id != message_id);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::{AgentProviderId, MessageRole, Session, SessionStatus, Worktree};

    fn source() -> Session {
        serde_json::from_value(serde_json::json!({
            "id":"source", "projectId":"project", "title":"Task", "agent":"codex", "model":"model",
            "providerAccountId":"private-profile", "accountBindings":{"codex":"private-profile"},
            "status":"completed", "createdAt":"time", "lastActivityAt":"time",
            "worktree":{"path":"/source", "branch":"main", "isolated":true},
            "nativeThread":{"threadId":"vendor", "sessionId":"source", "projectId":"project", "cwd":"/source", "model":"model"},
            "messages":[
                {"id":"user","sessionId":"source","role":"user","content":"question","createdAt":"time","streaming":false},
                {"id":"answer","sessionId":"source","role":"agent","content":"first answer","createdAt":"time","streaming":false},
                {"id":"diagnostic","sessionId":"source","role":"system","content":"private diagnostic","createdAt":"time","streaming":false},
                {"id":"later","sessionId":"source","role":"agent","content":"later answer","createdAt":"time","streaming":false}
            ]
        })).unwrap()
    }

    #[test]
    fn fork_stops_at_selected_answer_and_rebinds_messages_without_vendor_state() {
        let source = source();
        let tree = Worktree {
            path: "/new".into(),
            branch: "fork".into(),
            isolated: true,
        };
        let fork = fork_snapshot(&source, "answer", "new", "now", tree).unwrap();
        assert_eq!(fork.messages.len(), 2);
        assert_eq!(fork.messages[1].content, "first answer");
        assert!(fork.messages.iter().all(|m| m.session_id == "new"
            && !source.messages.iter().any(|original| original.id == m.id)));
        assert_eq!(fork.provider_account_id, "private-profile");
        assert_eq!(fork.account_bindings, source.account_bindings);
        assert_eq!(fork.model, source.model);
        assert!(fork.native_thread.is_none());
        assert_eq!(fork.status, SessionStatus::Idle);
        assert_eq!(
            serde_json::to_value(&fork).unwrap()["forkOrigin"]["sourceMessageId"],
            "answer"
        );
        assert!(fork.pending_requests.is_empty());
        assert_eq!(source.messages.len(), 4);
    }

    #[test]
    fn fork_rejects_live_foreign_user_empty_or_oversized_boundaries() {
        let mut source = source();
        let make = |s: &Session, id: &str| fork_snapshot(s, id, "new", "now", s.worktree.clone());
        assert!(make(&source, "foreign").is_err());
        assert!(make(&source, "user").is_err());
        assert!(make(&source, "diagnostic").is_err());
        source.status = SessionStatus::Running;
        assert!(make(&source, "answer").is_err());
        source.status = SessionStatus::Completed;
        source.messages[1].streaming = true;
        assert!(make(&source, "answer").is_err());
        source.messages[1].streaming = false;
        source.messages[1].content.clear();
        assert!(make(&source, "answer").is_err());
        source.messages[1].content = "x".repeat(33 * 1024);
        assert!(make(&source, "answer").is_err());
    }

    #[test]
    fn first_fork_turn_receives_context_then_exact_resume_uses_only_new_prompt() {
        let source = source();
        let mut fork =
            fork_snapshot(&source, "answer", "new", "now", source.worktree.clone()).unwrap();
        let first = process_prompt(&fork, "continue").unwrap();
        assert!(
            first.contains("question")
                && first.contains("first answer")
                && first.ends_with("continue")
        );
        assert!(!first.contains("later answer") && !first.contains("private diagnostic"));
        fork.native_thread = source.native_thread.clone();
        crate::agent::finalize_session(&mut fork, Some(0), false, false, false, None);
        assert_eq!(process_prompt(&fork, "next").unwrap(), "next");
        fork.agent = AgentProviderId::Cursor;
        assert!(process_prompt(&fork, "next")
            .unwrap()
            .contains("first answer"));
    }

    #[test]
    fn failed_native_start_keeps_fork_context_until_a_successful_bound_turn() {
        let source = source();
        let mut fork =
            fork_snapshot(&source, "answer", "new", "now", source.worktree.clone()).unwrap();
        fork.native_thread = source.native_thread.clone();
        // Identity can arrive before the vendor accepts the first prompt.
        crate::agent::finalize_session(&mut fork, Some(1), false, true, false, None);
        assert!(process_prompt(&fork, "retry")
            .unwrap()
            .contains("first answer"));
        crate::agent::finalize_session(&mut fork, Some(0), false, false, false, None);
        let saved = serde_json::to_value(&fork).unwrap();
        let mut restored: Session = serde_json::from_value(saved).unwrap();
        assert_eq!(process_prompt(&restored, "next").unwrap(), "next");
        restored.native_thread.as_mut().unwrap().thread_id = "replacement".into();
        crate::agent::finalize_session(&mut restored, Some(1), false, true, false, None);
        assert!(process_prompt(&restored, "retry replacement")
            .unwrap()
            .contains("first answer"));
    }

    #[test]
    fn handoff_reuses_the_workspace_with_a_bounded_recap_and_target_provider() {
        let source = source();
        let handoff = handoff_snapshot(
            &source,
            "answer",
            "handoff",
            "now",
            AgentProviderId::Cursor,
            Some("target-model".into()),
            "target-account".into(),
            source.worktree.clone(),
        )
        .unwrap();
        assert!(handoff.messages.is_empty());
        assert_eq!(handoff.agent, AgentProviderId::Cursor);
        assert_eq!(handoff.model.as_deref(), Some("target-model"));
        assert_eq!(handoff.provider_account_id, "target-account");
        assert_eq!(
            handoff.account_bindings.get(&AgentProviderId::Cursor),
            Some(&"target-account".to_string())
        );
        assert_eq!(handoff.worktree.path, source.worktree.path);
        assert_eq!(handoff.worktree.branch, source.worktree.branch);
        assert!(handoff.native_thread.is_none());
        assert!(handoff.fork_origin.is_none());
        assert_eq!(handoff.status, SessionStatus::Idle);
        let saved = serde_json::to_value(&handoff).unwrap();
        let meta = &saved["handoff"];
        assert_eq!(meta["from"], "codex");
        assert_eq!(meta["pending"], true);
        assert_eq!(meta["request"], "question");
        let brief = meta["brief"].as_str().unwrap();
        assert!(brief.contains("User: question"));
        assert!(brief.contains("Assistant: first answer"));
        assert!(!brief.contains("later answer") && !brief.contains("private diagnostic"));
    }

    #[test]
    fn pending_handoff_wraps_the_first_prompt_once() {
        let source = source();
        let mut handoff = handoff_snapshot(
            &source,
            "answer",
            "handoff",
            "now",
            AgentProviderId::Grok,
            None,
            "default".into(),
            source.worktree.clone(),
        )
        .unwrap();
        let first = consume_handoff(&mut handoff, "continue".into());
        assert!(first.contains("handed off from Codex"));
        assert!(first.contains("<handoff>") && first.ends_with("</handoff>"));
        assert!(first.contains("Assistant: first answer"));
        assert!(first.ends_with("</handoff>") && first.contains("\n\ncontinue\n\n"));
        assert!(handoff.handoff.is_none());
        assert_eq!(consume_handoff(&mut handoff, "next".into()), "next");
    }

    #[test]
    fn handoff_rejects_live_foreign_or_empty_boundaries() {
        let mut source = source();
        let make = |s: &Session, id: &str| {
            handoff_snapshot(
                s,
                id,
                "handoff",
                "now",
                AgentProviderId::Cursor,
                None,
                "default".into(),
                s.worktree.clone(),
            )
        };
        assert!(make(&source, "foreign").is_err());
        assert!(make(&source, "user").is_err());
        assert!(make(&source, "diagnostic").is_err());
        source.status = SessionStatus::Running;
        assert!(make(&source, "answer").is_err());
        source.status = SessionStatus::Completed;
        source.messages[1].streaming = true;
        assert!(make(&source, "answer").is_err());
        source.messages[1].streaming = false;
        source.messages[1].content.clear();
        assert!(make(&source, "answer").is_err());
    }

    #[test]
    fn pins_are_idempotent_owner_validated_and_do_not_change_model_context() {
        let mut session = source();
        let before = process_prompt(&session, "next").unwrap();
        assert!(set_pinned(&mut session, "foreign", true).is_err());
        assert!(set_pinned(&mut session, "diagnostic", true).is_err());
        set_pinned(&mut session, "answer", true).unwrap();
        set_pinned(&mut session, "answer", true).unwrap();
        assert_eq!(
            serde_json::to_value(&session).unwrap()["pinnedMessageIds"],
            serde_json::json!(["answer"])
        );
        assert_eq!(process_prompt(&session, "next").unwrap(), before);
        let saved = serde_json::to_value(&session).unwrap();
        let mut restored: Session = serde_json::from_value(saved).unwrap();
        set_pinned(&mut restored, "answer", false).unwrap();
        assert_eq!(
            serde_json::to_value(&restored).unwrap()["pinnedMessageIds"],
            serde_json::json!([])
        );
        restored.messages[1].role = MessageRole::Agent;
        restored.messages[1].streaming = true;
        assert!(set_pinned(&mut restored, "answer", true).is_err());
    }
}
