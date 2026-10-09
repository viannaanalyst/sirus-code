//! Claude's native stream-json adapter. Renderer responses never contain wire/tool input.
use crate::codex::{Event, Run, Wire};
use crate::error::{Error, Result};
use crate::models::*;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::process::Stdio;
use std::time::Duration;
#[cfg(test)]
use tokio::process::Command;
use tokio::sync::{mpsc, watch};

pub fn validate_binding(session: &Session, cwd: &str) -> Result<()> {
    if let Some(identity) = &session.native_thread {
        if session.agent != AgentProviderId::Claude
            || identity.session_id != session.id
            || identity.project_id != session.project_id
            || identity.cwd != cwd
            || identity.model != session.model
            || identity.provider_account_id != session.provider_account_id
            || identity.thread_id.is_empty()
        {
            return Err(Error::agent(
                "Claude native session does not match session, project, workspace or model",
            ));
        }
    }
    Ok(())
}

pub fn validate_response(pending: &PendingRequest, response: &AgentResponse) -> Result<()> {
    if !matches!(
        (&pending.kind, response),
        (
            PendingRequestKind::Tool { .. },
            AgentResponse::Approval { .. }
        ) | (
            PendingRequestKind::UserInput { .. },
            AgentResponse::UserInput { .. } | AgentResponse::Approval { .. }
        )
    ) {
        return Err(Error::agent(
            "Claude accepts only a typed decision for this native tool request",
        ));
    }
    Ok(())
}

pub async fn start(
    session: Session,
    cwd: String,
    prompt: String,
    overrides: HashMap<AgentProviderId, String>,
    account_home: Option<std::path::PathBuf>,
) -> Result<(crate::agent::AgentProcess, crate::agent::StartedAgent)> {
    validate_binding(&session, &cwd)?;
    if (session.provider_account_id == "default") != account_home.is_none() {
        return Err(Error::agent("Account profile does not match this session."));
    }
    let install = crate::detect::resolve_with_overrides(&AgentProviderId::Claude, &overrides)
        .ok_or_else(|| Error::agent("Unknown provider"))?;
    if !install.installed {
        return Err(Error::agent("Claude Code is not installed"));
    }
    let mut command = crate::detect::command(install.path.unwrap_or(install.binary));
    crate::provider_accounts::apply(&mut command, &session.agent, account_home.as_deref());
    if let Some(config) = crate::browser_mcp::claude_mcp_config(&session.id) {
        command.arg("--mcp-config").arg(config);
        // The browser tools are fixed and bounded; approve them up front so the
        // stdio permission bridge never sees an unsupported MCP prompt.
        command.args(["--allowedTools", "mcp__sirus_browser"]);
        // Computer tools are gated by the app's per-app approval, not per call.
        if crate::computer_mcp::endpoint(&session.id).is_some() {
            command.args(["--allowedTools", "mcp__sirus_computer"]);
        }
    }
    command.args([
        "-p",
        "--input-format",
        "stream-json",
        "--output-format",
        "stream-json",
        "--verbose",
        "--include-partial-messages",
        // Echoes consumed user input, so a steered instruction is known to be read.
        "--replay-user-messages",
        "--permission-mode",
        crate::execution::claude_permission_mode(&session.execution),
        "--permission-prompts",
        "host",
        "--permission-prompt-tool",
        "stdio",
    ]);
    command.args([
        "--settings",
        &serde_json::json!({"fastMode":session.execution.fast}).to_string(),
    ]);
    if let Some(effort) = &session.execution.effort {
        command.arg(format!("--effort={effort}"));
    }
    if let Some(model) = &session.model {
        command.arg(format!("--model={model}"));
    }
    if let Some(identity) = &session.native_thread {
        command.arg(format!("--resume={}", identity.thread_id));
    }
    command
        .current_dir(&cwd)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    #[cfg(unix)]
    command.process_group(0);
    let child = command
        .spawn()
        .map_err(|_| Error::agent("Cannot start Claude native protocol"))?;
    let generation = uuid::Uuid::new_v4().to_string();
    let (cancel, receiver) = watch::channel(false);
    let (sender, replies) = mpsc::channel(16);
    Ok((
        crate::agent::AgentProcess {
            cancel,
            replies: Some(sender),
            generation: Some(generation.clone()),
            #[cfg(unix)]
            pid: child.id(),
        },
        crate::agent::StartedAgent {
            review: None,
            child,
            cancel: receiver,
            codex: Some(Run {
                session,
                cwd,
                prompt,
                attachments: Vec::new(),
                generation,
                replies,
            }),
        },
    ))
}

fn id(value: &Value) -> Result<String> {
    value
        .as_str()
        .filter(|value| !value.is_empty() && value.len() <= 1024)
        .map(str::to_owned)
        .ok_or_else(|| Error::agent("Claude native identity is invalid"))
}
fn response(vendor_id: &str, payload: Value) -> Value {
    json!({"type":"control_response","response":{"subtype":"success","request_id":vendor_id,"response":payload}})
}
fn deny(vendor_id: &str, message: &str, interrupt: bool) -> Value {
    response(
        vendor_id,
        json!({"behavior":"deny","message":message,"interrupt":interrupt}),
    )
}
fn unsupported(vendor_id: &str) -> Value {
    json!({"type":"control_response","response":{"subtype":"error","request_id":vendor_id,"error":"Unsupported native control request"}})
}
/// The text of an echoed user message: its string content or first text block.
fn echoed_text(value: &Value) -> Option<&str> {
    let content = &value["message"]["content"];
    content.as_str().or_else(|| {
        content
            .as_array()?
            .iter()
            .find(|block| block["type"] == "text")?["text"]
            .as_str()
    })
}

/// Claude's AskUserQuestion becomes the app's question card: at most 16 questions, each
/// with its options and a free answer.
fn question_kind(request: &Value) -> Option<PendingRequestKind> {
    if request["subtype"] != "can_use_tool"
        || request["tool_name"] != "AskUserQuestion"
        || request["input"].to_string().len() > 128 * 1024
    {
        return None;
    }
    let items = request["input"]["questions"].as_array()?;
    if items.is_empty() || items.len() > 16 {
        return None;
    }
    let questions = items
        .iter()
        .enumerate()
        .map(|(index, item)| {
            let question = item["question"].as_str()?.trim();
            if question.is_empty() {
                return None;
            }
            let options = item["options"].as_array().map(|options| {
                options
                    .iter()
                    .filter_map(|option| {
                        Some(crate::models::InputOption {
                            label: option["label"].as_str()?.to_owned(),
                            description: option["description"].as_str().unwrap_or("").to_owned(),
                        })
                    })
                    .collect::<Vec<_>>()
            });
            Some(crate::models::InputQuestion {
                id: format!("q{index}"),
                header: item["header"].as_str().unwrap_or("").to_owned(),
                question: question.to_owned(),
                is_other: true,
                is_secret: false,
                options: options.filter(|options| !options.is_empty()),
            })
        })
        .collect::<Option<Vec<_>>>()?;
    Some(PendingRequestKind::UserInput { questions })
}

/// The answers Claude expects back: each question's text with the chosen labels.
fn question_answers(
    questions: &[crate::models::InputQuestion],
    answers: &std::collections::BTreeMap<String, Vec<String>>,
) -> Value {
    let mut map = serde_json::Map::new();
    for question in questions {
        if let Some(chosen) = answers
            .get(&question.id)
            .filter(|chosen| !chosen.is_empty())
        {
            map.insert(question.question.clone(), json!(chosen.join(", ")));
        }
    }
    Value::Object(map)
}

fn tool_kind(request: &Value) -> Option<PendingRequestKind> {
    if request["tool_name"] == "AskUserQuestion" {
        return question_kind(request);
    }
    let name = request["tool_name"].as_str()?;
    // Built-in reviewable tools and questions only. Secrets, grants, auth, config and MCP callbacks are unsupported.
    if request["subtype"] != "can_use_tool"
        || !matches!(
            name,
            "Bash" | "Read" | "Write" | "Edit" | "MultiEdit" | "Glob" | "Grep"
        )
        || !request["input"].is_object()
        || request["input"].to_string().len() > 128 * 1024
    {
        return None;
    }
    if request["decision_reason"]
        .as_str()
        .is_some_and(|reason| reason.len() > 8192)
        || request["tool_use_id"]
            .as_str()
            .is_some_and(|id| id.len() > 1024)
    {
        return None;
    }
    Some(PendingRequestKind::Tool {
        name: name.into(),
        input: request["input"].clone(),
        reason: request["decision_reason"].as_str().map(str::to_owned),
    })
}

#[derive(Default)]
struct Text {
    current: String,
    total: usize,
}
impl Text {
    fn parse(&mut self, value: &Value) -> Result<Option<String>> {
        if value["parent_tool_use_id"].as_str().is_some() {
            return Ok(None);
        }
        if value["type"] == "stream_event" && value["event"]["type"] == "message_start" {
            self.current.clear();
        }
        let chunk = if value["type"] == "stream_event" {
            value
                .pointer("/event/delta/text")
                .and_then(Value::as_str)
                .unwrap_or("")
                .to_owned()
        } else if value["type"] == "assistant" {
            let text = value
                .pointer("/message/content")
                .and_then(Value::as_array)
                .map(|blocks| {
                    blocks
                        .iter()
                        .filter(|block| block["type"] == "text")
                        .filter_map(|block| block["text"].as_str())
                        .collect::<String>()
                })
                .unwrap_or_default();
            if !text.starts_with(&self.current) {
                return Err(Error::agent("Claude final text does not match stream"));
            }
            let chunk = text[self.current.len()..].to_owned();
            self.current.clear();
            chunk
        } else {
            String::new()
        };
        self.total += chunk.len();
        if self.total > 8 * 1024 * 1024 {
            return Err(Error::agent("Claude output exceeds limit"));
        }
        if value["type"] == "stream_event" {
            self.current.push_str(&chunk);
        }
        Ok((!chunk.is_empty()).then_some(chunk))
    }
}

/// Longest a turn keeps its process for background subagents after its own answer (ADR-097).
pub(crate) const BACKGROUND_LIMIT: Duration = Duration::from_secs(30 * 60);
/// How long the CLI may take to start the follow-up turn it runs when a background task settles.
const FOLLOW_UP_GRACE: Duration = Duration::from_secs(20);

#[derive(Clone, Copy)]
struct Limits {
    background: Duration,
    grace: Duration,
}

/// Subagents this turn launched with `run_in_background` (ADR-097). Claude runs them inside
/// the turn's own `claude` process, so the turn keeps that process until none remains.
#[derive(Default)]
struct Background {
    /// Task ids the CLI still reports as running.
    running: std::collections::BTreeSet<String>,
    /// Each tracked task's description, for the marker where it finishes (ADR-101).
    labels: HashMap<String, String>,
    /// Tasks that settled on the last frame, with their reported status, to be marked.
    finished: Vec<(String, Value)>,
    /// Any background subagent was seen this turn.
    seen: bool,
    /// When our prompt's answer arrived while background work remained.
    since: Option<tokio::time::Instant>,
    /// A follow-up turn is expected (a task settled between turns, the CLI queued one, or an
    /// instruction was sent): since when, and whether it began.
    follow_up: Option<(tokio::time::Instant, bool)>,
}
impl Background {
    /// Reads task lifecycle frames; true when a tracked task settled.
    fn observe(&mut self, value: &Value) -> bool {
        if value["type"] != "system" || !value["parent_tool_use_id"].is_null() {
            return false;
        }
        let settled = match value["subtype"].as_str() {
            Some("task_started") if crate::activity::is_background_task(value) => {
                if let Some(id) = value["task_id"].as_str() {
                    self.running.insert(id.to_owned());
                    if self.labels.len() < 256 {
                        let label = value["description"].as_str().unwrap_or("");
                        self.labels.insert(id.to_owned(), label.to_owned());
                    }
                    self.seen = true;
                }
                false
            }
            Some("task_notification" | "task_updated") => {
                let status = value
                    .get("status")
                    .unwrap_or(&value["patch"]["status"])
                    .as_str()
                    .unwrap_or("");
                let done = !matches!(status, "" | "running" | "pending" | "in_progress");
                match value["task_id"].as_str() {
                    Some(id) if done && self.running.remove(id) => {
                        self.finished.push((id.to_owned(), json!(status)));
                        true
                    }
                    _ => false,
                }
            }
            // The CLI's own list of what still runs is authoritative.
            Some("background_tasks_changed") => {
                let Some(tasks) = value["tasks"].as_array() else {
                    return false;
                };
                let listed: std::collections::HashSet<&str> = tasks
                    .iter()
                    .filter_map(|task| task["task_id"].as_str())
                    .collect();
                let before = self.running.len();
                let gone: Vec<String> = self
                    .running
                    .iter()
                    .filter(|id| !listed.contains(id.as_str()))
                    .cloned()
                    .collect();
                for id in gone {
                    self.running.remove(&id);
                    // Settled without a status: the marker says it ended.
                    self.finished.push((id, Value::Null));
                }
                self.running.len() < before
            }
            _ => false,
        };
        if settled && self.since.is_some() {
            self.expect_follow_up();
        }
        settled
    }
    /// Markers for the tasks that settled on the last frame (ADR-101).
    fn take_finished(&mut self) -> Vec<crate::activity::ActivityItem> {
        std::mem::take(&mut self.finished)
            .into_iter()
            .map(|(id, status)| {
                let label = self.labels.get(&id).map_or("", String::as_str);
                crate::activity::background_finished(&id, label, &status)
            })
            .collect()
    }
    fn expect_follow_up(&mut self) {
        self.follow_up = Some((tokio::time::Instant::now(), false));
    }
    /// The CLI began a turn of its own (its `init`, or main-agent output).
    fn turn_began(&mut self, value: &Value) {
        let began = (value["type"] == "system" && value["subtype"] == "init")
            || (value["parent_tool_use_id"].is_null()
                && matches!(value["type"].as_str(), Some("assistant" | "stream_event")));
        if let Some((_, started)) = self.follow_up.as_mut() {
            *started |= began;
        }
    }
    /// A follow-up turn ended; the CLI may still have others queued.
    fn turn_ended(&mut self, value: &Value) {
        if value["queued_turn_count"].as_u64().unwrap_or(0) > 0 {
            self.expect_follow_up();
        } else {
            self.follow_up = None;
        }
    }
    fn waiting(&self) -> bool {
        !self.running.is_empty() || self.follow_up.is_some()
    }
    /// The next moment the turn must act without a frame: the background limit, or a follow-up
    /// turn that never began.
    fn wake(&self, limits: Limits) -> Option<tokio::time::Instant> {
        let limit = self.since.map(|since| since + limits.background);
        let grace = self
            .follow_up
            .filter(|(_, started)| !started)
            .map(|(at, _)| at + limits.grace);
        match (limit, grace) {
            (Some(a), Some(b)) => Some(a.min(b)),
            (a, b) => a.or(b),
        }
    }
}

pub(crate) async fn execute(
    wire: &mut Wire,
    run: &mut Run,
    cancel: &mut watch::Receiver<bool>,
    emit: &mut impl FnMut(Event) -> Result<()>,
) -> Result<bool> {
    run_turn(
        wire,
        run,
        cancel,
        emit,
        Limits {
            background: BACKGROUND_LIMIT,
            grace: FOLLOW_UP_GRACE,
        },
    )
    .await
}

async fn run_turn(
    wire: &mut Wire,
    run: &mut Run,
    cancel: &mut watch::Receiver<bool>,
    emit: &mut impl FnMut(Event) -> Result<()>,
    limits: Limits,
) -> Result<bool> {
    wire.send(json!({"type":"control_request","request_id":"sy_init","request":{"subtype":"initialize","hooks":null}})).await?;
    tokio::time::timeout(Duration::from_secs(30),async {
        loop {
            let value=tokio::select! {value=wire.read()=>value?,_=cancel.changed()=>return Err(Error::agent("Claude initialization cancelled"))};
            if value["type"]=="control_response" && value["response"]["request_id"]=="sy_init" {
                if value["response"]["subtype"]!="success" {return Err(Error::agent("Claude initialization rejected; check CLI compatibility"));}
                if run.session.execution.fast && value["response"]["response"]["fast_mode_state"] != "on" { return Err(Error::agent("Claude Fast mode is unavailable in the CLI account; no prompt was sent.")); }
                return Ok(());
            }
            if value["type"]=="control_request" {let vendor_id=id(&value["request_id"])?;wire.send(unsupported(&vendor_id)).await?;}
        }
    }).await.map_err(|_|Error::agent("Claude initialization timed out"))??;
    if !run.session.execution.planning
        && matches!(
            run.session.execution.approval,
            Some(crate::models::ApprovalMode::Auto | crate::models::ApprovalMode::Full)
        )
    {
        let mode = crate::execution::claude_permission_mode(&run.session.execution);
        wire.send(json!({"type":"control_request","request_id":"sy_mode","request":{"subtype":"set_permission_mode","mode":mode}})).await?;
        tokio::time::timeout(Duration::from_secs(30), async {
            loop {
                let value = tokio::select! { value=wire.read()=>value?, _=cancel.changed()=>return Err(Error::agent("Claude approval selection cancelled")) };
                if value["type"] == "control_response" && value["response"]["request_id"] == "sy_mode" {
                    if value["response"]["subtype"] != "success" { return Err(Error::agent("Claude rejected the selected approval mode; no prompt was sent.")); }
                    return Ok(());
                }
                if value["type"] == "control_request" { let vendor_id = id(&value["request_id"])?; wire.send(unsupported(&vendor_id)).await?; }
            }
        }).await.map_err(|_| Error::agent("Claude approval selection timed out; no prompt was sent."))??;
    }
    let turn = uuid::Uuid::new_v4().to_string();
    let native = run
        .session
        .native_thread
        .as_ref()
        .map(|identity| identity.thread_id.as_str())
        .unwrap_or("default");
    wire.send(json!({"type":"user","message":{"role":"user","content":crate::attachments::claude_input(&run.prompt, &run.attachments)?},"parent_tool_use_id":null,"session_id":native,"uuid":turn,"client_composed":true})).await?;
    // The CLI took the prompt: a handoff recap it carried is spent (ADR-101).
    emit(Event::Activity(vec![crate::activity::delivered()]))?;
    let mut pending: HashMap<String, (String, PendingRequest)> = HashMap::new();
    // Whether the CLI echoed this turn's prompt, and whether it ran a prompt of its own first.
    let mut prompt_seen = false;
    let mut foreign_prompt = false;
    // AskUserQuestion's own question list, echoed back with the answers.
    let mut questions_input: HashMap<String, Value> = HashMap::new();
    let mut seen = std::collections::HashSet::new();
    let mut identity = None;
    let mut text = Text::default();
    let mut interrupted = false;
    // `rate_limit_event` refused requests (no extra usage paying): the reset, when reported.
    let mut usage_limit: Option<Option<i64>> = None;
    let mut deadline = None;
    // Instructions steered into this turn that Claude has not echoed back yet.
    let mut unread_steers: Vec<String> = vec![];
    let mut background = Background::default();
    // A continuation after our answer starts on its own paragraph.
    let mut separate = false;
    loop {
        let wake = background.wake(limits);
        let value = tokio::select! {
            _=async {if let Some(wake)=wake {tokio::time::sleep_until(wake).await;}else{std::future::pending::<()>().await;}},if !interrupted && wake.is_some()=>{
                if background.since.is_some_and(|since| since + limits.background <= tokio::time::Instant::now()) {
                    // The limit stops what still runs; the turn ends as answered (ADR-097).
                    let _=wire.send(json!({"type":"control_request","request_id":"sy_background_limit","request":{"subtype":"interrupt"}})).await;
                    let items: Vec<_>=background.running.iter().map(|id| crate::activity::background_timed_out(id)).collect();
                    if !items.is_empty() {emit(Event::Activity(items))?;}
                    return Ok(false);
                }
                // The CLI did not start the follow-up turn it was expected to run.
                background.follow_up=None;
                if background.since.is_some() && !background.waiting() && unread_steers.is_empty() {return Ok(false);}
                continue;
            },
            value=wire.read()=>value?,
            _=cancel.changed(),if !interrupted=>{
                interrupted=true;pending.clear();
                wire.send(json!({"type":"control_request","request_id":"sy_interrupt","request":{"subtype":"interrupt"}})).await?;
                deadline=Some(tokio::time::Instant::now()+Duration::from_secs(2));continue;
            },
            _=async {if let Some(deadline)=deadline {tokio::time::sleep_until(deadline).await;}else{std::future::pending::<()>().await;}},if interrupted=>return Ok(true),
            Some(inbound)=run.replies.recv(),if !interrupted=>{
                let reply=match inbound {
                    crate::codex::Inbound::Answer(reply)=>reply,
                    crate::codex::Inbound::Steer{text,result}=>{
                        // Claude reads input sent during a turn at its next step, in the same turn.
                        let sent=wire.send(json!({"type":"user","message":{"role":"user","content":[{"type":"text","text":text}]},"parent_tool_use_id":null,"session_id":native,"uuid":uuid::Uuid::new_v4().to_string()})).await;
                        if sent.is_ok() {
                            unread_steers.push(text);
                            // After our answer, an instruction runs as a turn of its own.
                            if background.since.is_some() {background.expect_follow_up();}
                        }
                        let _=result.send(sent);
                        continue;
                    }
                    crate::codex::Inbound::StopTask{task_id,result}=>{
                        // The CLI stops one background task; its notification settles the row.
                        let sent=if background.running.contains(&task_id) {
                            wire.send(json!({"type":"control_request","request_id":format!("sy_stop_{}",uuid::Uuid::new_v4()),"request":{"subtype":"stop_task","task_id":task_id}})).await
                        } else {Err(Error::agent("This background task is not running."))};
                        let _=result.send(sent);
                        continue;
                    }
                };
                let request=&reply.request;
                let mut delivery_failed=false;
                let result=if request.session_id!=run.session.id || request.generation!=run.generation || request.turn_id!=turn {Err(Error::agent("Stale or foreign Claude response"))}
                else if let Some((vendor_id,entry))=pending.get(&request.request_id) {
                    match validate_response(entry,&request.response) {
                        Err(error)=>Err(error),
                        Ok(())=>{
                            let payload=match (&entry.kind,&request.response) {
                                (PendingRequestKind::Tool{input,..},AgentResponse::Approval{decision:ApprovalDecision::Accept})=>response(vendor_id,json!({"behavior":"allow","updatedInput":input})),
                                (PendingRequestKind::UserInput{questions},AgentResponse::UserInput{answers})=>{
                                    let original=questions_input.get(&request.request_id).cloned().unwrap_or(Value::Null);
                                    response(vendor_id,json!({"behavior":"allow","updatedInput":{"questions":original,"answers":question_answers(questions,answers)}}))
                                },
                                (_,AgentResponse::Approval{decision})=>deny(vendor_id,"User declined",matches!(decision,ApprovalDecision::Cancel)),
                                _=>unreachable!(),
                            };
                            pending.remove(&request.request_id);
                            let result=wire.send(payload).await;
                            delivery_failed=result.is_err();
                            emit(Event::Answered(request.request_id.clone()))?;
                            if matches!(request.response,AgentResponse::Approval{decision:ApprovalDecision::Cancel}) {interrupted=true;deadline=Some(tokio::time::Instant::now()+Duration::from_secs(2));}
                            result
                        }
                    }
                }else{Err(Error::agent("Claude request already answered or cancelled"))};

                let _=reply.result.send(result);
                if delivery_failed {return Err(Error::agent("Claude response was rejected or delivery failed"));}
                continue;
            }
        };
        if let Some(native) = value["session_id"]
            .as_str()
            .filter(|value| !value.is_empty())
        {
            let native = id(&json!(native))?;
            if run
                .session
                .native_thread
                .as_ref()
                .is_some_and(|old| old.thread_id != native)
                || identity.as_ref().is_some_and(|old| old != &native)
            {
                return Err(Error::agent("Claude returned a different native session"));
            }
            if identity.is_none() {
                identity = Some(native.clone());
                emit(Event::Identity(NativeThread {
                    provider_account_id: run.session.provider_account_id.clone(),
                    thread_id: native,
                    session_id: run.session.id.clone(),
                    project_id: run.session.project_id.clone(),
                    cwd: run.cwd.clone(),
                    model: run.session.model.clone(),
                }))?;
            }
        }
        let items = crate::activity::claude(&value);
        if !items.is_empty() {
            emit(Event::Activity(items))?;
        }
        background.observe(&value);
        // Where each background subagent finished, so its follow-up reads as its own answer.
        let finished = background.take_finished();
        if !finished.is_empty() {
            emit(Event::Activity(finished))?;
        }
        background.turn_began(&value);
        // A manual compaction's result reports the summarizer call, not the rebuilt context.
        if !(value["type"] == "result" && crate::codex::is_compact(&run.prompt)) {
            if let Some(usage) = context_usage(&value) {
                emit(Event::Context(usage))?;
            }
        }
        if value["type"] == "system" && value["subtype"] == "init" {
            if let Some(model) = value["model"].as_str() {
                emit(Event::Model(model.into()))?;
            }
        }
        match value["type"].as_str() {
            Some("control_request") => {
                let vendor_id = id(&value["request_id"])?;
                if seen.len() >= 4096 {
                    return Err(Error::agent("Too many Claude callbacks"));
                }
                if !seen.insert(vendor_id.clone()) {
                    return Err(Error::agent("Duplicate Claude callback identity"));
                }
                if value["request"]["subtype"] != "can_use_tool" {
                    wire.send(unsupported(&vendor_id)).await?;
                    continue;
                }
                if interrupted {
                    wire.send(deny(&vendor_id, "Turn cancelled", true)).await?;
                    continue;
                }
                let Some(kind) = tool_kind(&value["request"]) else {
                    wire.send(deny(
                        &vendor_id,
                        "Unsupported tool or secret input request; use the provider CLI",
                        false,
                    ))
                    .await?;
                    continue;
                };
                if pending.len() >= 32 {
                    return Err(Error::agent("Too many pending Claude callbacks"));
                }
                let opaque = uuid::Uuid::new_v4().to_string();
                let request = PendingRequest {
                    request_id: opaque.clone(),
                    generation: run.generation.clone(),
                    turn_id: turn.clone(),
                    item_id: value["request"]["tool_use_id"]
                        .as_str()
                        .unwrap_or("native-tool")
                        .into(),
                    kind,
                };
                if matches!(request.kind, PendingRequestKind::UserInput { .. }) {
                    questions_input.insert(
                        opaque.clone(),
                        value["request"]["input"]["questions"].clone(),
                    );
                }
                pending.insert(opaque, (vendor_id, request.clone()));
                emit(Event::Pending(request))?;
            }
            Some("control_cancel_request") => {
                let vendor_id = id(&value["request_id"])?;
                if let Some(opaque) = pending
                    .iter()
                    .find(|(_, entry)| entry.0 == vendor_id)
                    .map(|(key, _)| key.clone())
                {
                    pending.remove(&opaque);
                    emit(Event::Answered(opaque))?;
                }
            }
            Some("rate_limit_event") => {
                let info = &value["rate_limit_info"];
                usage_limit = (info["status"] == "rejected" && info["isUsingOverage"] != true)
                    .then(|| epoch_ms(&info["resetsAt"]));
            }
            Some("user") if value["parent_tool_use_id"].is_null() => {
                let echoed = echoed_text(&value);
                if value["uuid"].as_str() == Some(turn.as_str())
                    || echoed.is_some_and(|text| text.trim() == run.prompt.trim())
                {
                    prompt_seen = true;
                } else if let Some(echoed) = echoed {
                    if let Some(index) = unread_steers.iter().position(|steer| steer == echoed) {
                        unread_steers.remove(index);
                    } else if !prompt_seen
                        && (value["origin"]["kind"].is_string()
                            || (value["isSynthetic"] != true
                                && echoed.trim_start().starts_with('<')))
                    {
                        // The CLI's own queued prompt (a `<task-notification>` about a background
                        // task the last turn left), answered with a result of its own.
                        foreign_prompt = true;
                    }
                }
            }
            // After our answer, results close the CLI's own follow-up turns (task notifications,
            // instructions); the turn ends when no background work or follow-up remains.
            Some("result") if !interrupted && background.since.is_some() => {
                foreign_prompt = false;
                separate = true;
                background.turn_ended(&value);
                if !background.waiting() && unread_steers.is_empty() {
                    return Ok(false);
                }
            }
            // Another prompt's result is not this turn's end: keep reading until ours answers.
            Some("result")
                if !interrupted && answers_other_prompt(&value, &turn, foreign_prompt) =>
            {
                foreign_prompt = false;
            }
            // An instruction that arrived as the turn ended runs as its continuation.
            Some("result")
                if !interrupted && !unread_steers.is_empty() && value["is_error"] != true => {}
            Some("result") => {
                if identity.is_none() {
                    return Err(Error::agent("Claude completed without native identity"));
                }
                if interrupted {
                    return Ok(true);
                }
                if value["is_error"] == true || value["subtype"] != "success" {
                    if usage_limit.is_some() || usage_limit_text(&value) {
                        emit(Event::UsageLimit(usage_limit.flatten()))?;
                        return Err(Error::new("usage_limit", "Usage limit reached."));
                    }
                    return Err(Error::agent("Claude turn failed; see CLI diagnostics"));
                }
                // Background subagents still run in this process: keep it, and read the
                // follow-up turns the CLI runs as they report (ADR-097).
                if background.seen && value["queued_turn_count"].as_u64().unwrap_or(0) > 0 {
                    background.expect_follow_up();
                }
                if !background.waiting() {
                    return Ok(false);
                }
                background.since = Some(tokio::time::Instant::now());
                separate = true;
            }
            _ => {
                if let Some(chunk) = text.parse(&value)? {
                    let chunk = if std::mem::take(&mut separate) {
                        format!("\n\n{chunk}")
                    } else {
                        chunk
                    };
                    emit(Event::Delta(chunk))?;
                }
            }
        }
    }
}

/// Whether a `result` answers a prompt other than this turn's. The CLI names the prompts a
/// result answers (`user_message_uuids`); a turn it queued itself names none of ours. Older
/// CLIs name nothing, so a queued prompt it echoed decides instead.
fn answers_other_prompt(value: &Value, turn: &str, foreign_prompt: bool) -> bool {
    let mut named = value["user_message_uuids"]
        .as_array()
        .into_iter()
        .flatten()
        .chain(std::iter::once(&value["user_message_uuid"]))
        .filter_map(Value::as_str)
        .peekable();
    if named.peek().is_some() {
        return !named.any(|uuid| uuid == turn);
    }
    // A turn the CLI started itself names its origin (`task-notification`, …).
    foreign_prompt
        || value["origin"]["kind"]
            .as_str()
            .is_some_and(|kind| !matches!(kind, "human" | "user"))
}

/// Claude also ends a limited turn with the limit as its error text.
fn usage_limit_text(value: &Value) -> bool {
    let limited = |text: &str| {
        let text = text.to_ascii_lowercase();
        text.contains("hit your limit")
            || text.contains("hit your usage limit")
            || text.contains("usage limit reached")
    };
    value["result"].as_str().is_some_and(limited)
        || value["errors"]
            .as_array()
            .is_some_and(|errors| errors.iter().filter_map(Value::as_str).any(limited))
}

/// Seconds or milliseconds since the epoch, or an RFC 3339 time, as UTC milliseconds.
fn epoch_ms(value: &Value) -> Option<i64> {
    let number = value.as_f64().or_else(|| {
        value
            .as_str()
            .and_then(|text| text.trim().parse::<f64>().ok())
    });
    if let Some(number) = number.filter(|number| number.is_finite() && *number > 0.0) {
        return Some(if number < 1e10 {
            number * 1000.0
        } else {
            number
        } as i64);
    }
    chrono::DateTime::parse_from_rfc3339(value.as_str()?)
        .ok()
        .map(|time| time.timestamp_millis())
}

/// Context reading from stream-json (ADR-057). Main-agent `assistant` events report
/// what the request carried; `result` adds the window the CLI knows for the model.
fn context_usage(value: &Value) -> Option<crate::models::ContextUsage> {
    let total = |usage: &Value| -> Option<u64> {
        let field = |name: &str| usage[name].as_u64().unwrap_or(0);
        usage["input_tokens"].as_u64()?;
        Some(
            field("input_tokens")
                + field("cache_creation_input_tokens")
                + field("cache_read_input_tokens")
                + field("output_tokens"),
        )
    };
    match value["type"].as_str()? {
        "assistant" if value["parent_tool_use_id"].is_null() => Some(crate::models::ContextUsage {
            used: total(&value["message"]["usage"])?,
            window: None,
        }),
        "result" if value["subtype"] == "success" => {
            let usage = value["usage"]["iterations"]
                .as_array()
                .and_then(|rows| rows.last())
                .unwrap_or(&value["usage"]);
            let window = value["modelUsage"]
                .as_object()?
                .values()
                .filter_map(|model| model["contextWindow"].as_u64())
                .max();
            Some(crate::models::ContextUsage {
                used: total(usage)?,
                window,
            })
        }
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn usage_limits_are_read_from_results_and_reset_times() {
        assert!(usage_limit_text(
            &json!({"is_error":true,"result":"Claude AI usage limit reached|1790000000"})
        ));
        assert!(usage_limit_text(
            &json!({"is_error":true,"errors":["You've hit your limit · resets 3pm"]})
        ));
        assert!(!usage_limit_text(
            &json!({"is_error":true,"result":"Tool failed"})
        ));
        assert_eq!(epoch_ms(&json!(1790000000)), Some(1_790_000_000_000));
        assert_eq!(epoch_ms(&json!(1790000000123_i64)), Some(1_790_000_000_123));
        assert_eq!(
            epoch_ms(&json!("2026-10-05T12:00:00Z")),
            Some(1_791_201_600_000)
        );
        assert_eq!(epoch_ms(&json!(null)), None);
    }

    #[test]
    fn results_for_queued_prompts_do_not_end_the_turn() {
        // A notification turn the CLI queued names no prompt of ours, even after our echo.
        let queued = json!({"type":"result","subtype":"success","num_turns":0,"result":""});
        assert!(answers_other_prompt(&queued, "ours", true));
        assert!(!answers_other_prompt(&queued, "ours", false));
        let theirs = json!({"type":"result","user_message_uuids":["other"]});
        assert!(answers_other_prompt(&theirs, "ours", false));
        let ours =
            json!({"type":"result","user_message_uuid":"ours","user_message_uuids":["x","ours"]});
        assert!(!answers_other_prompt(&ours, "ours", true));
        // The 2.1.294 CLI names a notification turn's origin instead of echoing its prompt.
        let notification = json!({"type":"result","origin":{"kind":"task-notification"}});
        assert!(answers_other_prompt(&notification, "ours", false));
    }

    #[test]
    fn context_readings_follow_the_main_agent_and_the_result_window() {
        let assistant = json!({"type":"assistant","parent_tool_use_id":null,"message":{"usage":{"input_tokens":10,"cache_read_input_tokens":1000,"cache_creation_input_tokens":5,"output_tokens":20}}});
        assert_eq!(
            context_usage(&assistant),
            Some(crate::models::ContextUsage {
                used: 1035,
                window: None
            })
        );
        let child = json!({"type":"assistant","parent_tool_use_id":"tool","message":{"usage":{"input_tokens":10}}});
        assert_eq!(context_usage(&child), None);
        let result = json!({"type":"result","subtype":"success","usage":{"input_tokens":1,"iterations":[{"input_tokens":50,"output_tokens":7}]},"modelUsage":{"a":{"contextWindow":200000},"b":{"contextWindow":1000000}}});
        assert_eq!(
            context_usage(&result),
            Some(crate::models::ContextUsage {
                used: 57,
                window: Some(1000000)
            })
        );
        assert_eq!(
            context_usage(&json!({"type":"result","subtype":"error"})),
            None
        );
    }
    #[test]
    fn ask_user_question_becomes_a_question_card_and_answers_by_text() {
        let request = json!({"subtype":"can_use_tool","tool_name":"AskUserQuestion","input":{"questions":[
            {"question":"Which database?","header":"DB","multiSelect":false,"options":[{"label":"Postgres","description":"relational"},{"label":"SQLite","description":""}]},
            {"question":"Name it?","header":"Name","options":[]}
        ]}});
        let Some(PendingRequestKind::UserInput { questions }) = tool_kind(&request) else {
            panic!("expected a question card");
        };
        assert_eq!(questions.len(), 2);
        assert_eq!(questions[0].options.as_ref().map(Vec::len), Some(2));
        assert!(questions[1].options.is_none() && questions[1].is_other);
        let answers = std::collections::BTreeMap::from([
            ("q0".to_string(), vec!["SQLite".to_string()]),
            ("q1".to_string(), vec!["notes".to_string()]),
        ]);
        assert_eq!(
            question_answers(&questions, &answers),
            json!({"Which database?":"SQLite","Name it?":"notes"})
        );
        assert!(tool_kind(&json!({"subtype":"can_use_tool","tool_name":"AskUserQuestion","input":{"questions":[]}})).is_none());
    }
    #[test]
    fn rejects_secret_questions_and_permission_mutation_tools() {
        for name in ["ExitPlanMode", "mcp__auth", "unknown"] {
            assert!(
                tool_kind(&json!({"subtype":"can_use_tool","tool_name":name,"input":{}})).is_none()
            );
        }
        assert!(tool_kind(&json!({"subtype":"can_use_tool","tool_name":"Write","input":{"file_path":"/fixture/test.txt","content":"native"}})).is_some());
    }
    #[test]
    fn stream_reconciliation_preserves_multiple_assistant_messages() {
        let mut text = Text::default();
        for word in ["first", "second"] {
            text.parse(&json!({"type":"stream_event","event":{"type":"message_start"}}))
                .unwrap();
            assert_eq!(
                text.parse(&json!({"type":"stream_event","event":{"delta":{"text":word}}}))
                    .unwrap(),
                Some(word.into())
            );
            assert_eq!(
                text.parse(
                    &json!({"type":"assistant","message":{"content":[{"type":"text","text":word}]}})
                )
                .unwrap(),
                None
            );
        }
    }
    fn session(cwd: &str) -> Session {
        serde_json::from_value(json!({"id":"s","projectId":"p","title":"fixture","agent":"claude","status":"running","createdAt":"time","lastActivityAt":"time","worktree":{"path":cwd,"branch":"main","isolated":false},"messages":[]})).unwrap()
    }
    #[tokio::test]
    async fn selected_approval_mode_requires_native_acknowledgment_before_user_input() {
        for mode in ["auto", "full"] {
            for accepted in [true, false] {
                let script = r#"
import json,sys,select
def read(): return json.loads(sys.stdin.readline())
def send(v): print(json.dumps(v),flush=True)
assert read()['request']['subtype']=='initialize'
send({'type':'control_response','response':{'subtype':'success','request_id':'sy_init','response':{}}})
request=read()
assert request['request']=={'subtype':'set_permission_mode','mode':sys.argv[1]}
assert not select.select([sys.stdin],[],[],.05)[0], 'input arrived before permission confirmation'
accepted=sys.argv[2]=='yes'
send({'type':'control_response','response':{'subtype':'success' if accepted else 'error','request_id':'sy_mode'}})
if accepted:
    assert read()['type']=='user'
    send({'type':'system','subtype':'init','session_id':'native'})
    send({'type':'result','subtype':'success','is_error':False,'session_id':'native'})
else:
    assert sys.stdin.read()==''
"#;
                let options = serde_json::from_value(json!({"approval":mode})).unwrap();
                let cli_mode = crate::execution::claude_permission_mode(&options);
                let mut child = Command::new("python3")
                    .args([
                        "-u",
                        "-c",
                        script,
                        cli_mode,
                        if accepted { "yes" } else { "no" },
                    ])
                    .stdin(Stdio::piped())
                    .stdout(Stdio::piped())
                    .spawn()
                    .unwrap();
                let (_sender, replies) = mpsc::channel(16);
                let (_cancel_sender, mut cancel) = watch::channel(false);
                let mut run = Run {
                    session: Session {
                        execution: options,
                        ..session("/fixture")
                    },
                    cwd: "/fixture".into(),
                    prompt: "fixture".into(),
                    attachments: Vec::new(),
                    generation: "g".into(),
                    replies,
                };
                let mut wire = Wire::new(child.stdin.take().unwrap(), child.stdout.take().unwrap());
                let mut delivered = false;
                let result = execute(&mut wire, &mut run, &mut cancel, &mut |event| {
                    delivered |= matches!(&event, Event::Activity(items) if items.iter().any(|item| item.delivered));
                    Ok(())
                })
                .await;
                assert_eq!(result.is_ok(), accepted);
                // A rejected mode never sent the prompt: a handoff recap stays (ADR-101).
                assert_eq!(delivered, accepted);
                drop(wire);
                assert!(tokio::time::timeout(Duration::from_secs(3), child.wait())
                    .await
                    .unwrap()
                    .unwrap()
                    .success());
            }
        }
    }
    #[test]
    fn exact_resume_refuses_foreign_bindings() {
        let mut session = session("/fixture");
        session.native_thread = Some(NativeThread {
            provider_account_id: "default".into(),
            thread_id: "native".into(),
            session_id: "s".into(),
            project_id: "p".into(),
            cwd: "/fixture".into(),
            model: None,
        });
        assert!(validate_binding(&session, "/fixture").is_ok());
        session.provider_account_id = "foreign".into();
        assert!(validate_binding(&session, "/fixture").is_err());
        session.provider_account_id = "default".into();
        assert!(validate_binding(&session, "/foreign").is_err());
        session.model = Some("foreign".into());
        assert!(validate_binding(&session, "/fixture").is_err());
    }
    #[tokio::test]
    async fn host_response_is_bound_consumed_once_and_echoes_only_native_input() {
        let script = r#"import sys,json,time
read=lambda:json.loads(sys.stdin.readline())
send=lambda value:print(json.dumps(value),flush=True)
assert read()['request']['subtype']=='initialize'
send({'type':'control_response','response':{'subtype':'success','request_id':'sy_init','response':{}}})
assert read()['type']=='user'
send({'type':'system','subtype':'init','session_id':'native'})
send({'type':'control_request','request_id':'vendor','request':{'subtype':'can_use_tool','tool_name':'Write','tool_use_id':'tool','input':{'file_path':'/fixture/test','content':'original'}}})
reply=read()
assert reply['response']['request_id']=='vendor'
assert reply['response']['response']=={'behavior':'allow','updatedInput':{'file_path':'/fixture/test','content':'original'}}
time.sleep(.1)
send({'type':'result','subtype':'success','is_error':False,'session_id':'native'})
"#;
        let mut child = Command::new("python3")
            .args(["-u", "-c", script])
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .spawn()
            .unwrap();
        let (sender, replies) = mpsc::channel(16);
        let (_cancel_sender, mut cancel) = watch::channel(false);
        let mut run = Run {
            session: session("/fixture"),
            cwd: "/fixture".into(),
            prompt: "fixture".into(),
            attachments: Vec::new(),
            generation: "g".into(),
            replies,
        };
        let mut wire = Wire::new(child.stdin.take().unwrap(), child.stdout.take().unwrap());
        let mut acknowledgements = Vec::new();
        let mut callback = |event| {
            if let Event::Pending(pending) = event {
                let request = RespondAgentRequest {
                    session_id: "s".into(),
                    generation: pending.generation,
                    turn_id: pending.turn_id,
                    request_id: pending.request_id,
                    response: AgentResponse::Approval {
                        decision: ApprovalDecision::Accept,
                    },
                };
                for kind in ["foreign", "valid", "duplicate"] {
                    let mut request = request.clone();
                    if kind == "foreign" {
                        request.generation = "foreign".into();
                    }
                    let (result, receiver) = tokio::sync::oneshot::channel();
                    sender
                        .try_send(crate::codex::Inbound::Answer(crate::codex::Reply {
                            request,
                            result,
                        }))
                        .unwrap();
                    acknowledgements.push((kind, receiver));
                }
            }
            Ok(())
        };
        assert!(!execute(&mut wire, &mut run, &mut cancel, &mut callback)
            .await
            .unwrap());
        for (kind, receiver) in acknowledgements {
            assert_eq!(receiver.await.unwrap().is_ok(), kind == "valid");
        }
        assert!(child.wait().await.unwrap().success());
    }
    #[tokio::test]
    async fn native_cancellation_invalidates_callback_without_answering_it() {
        let script = r#"import sys,json,select
read=lambda:json.loads(sys.stdin.readline())
send=lambda value:print(json.dumps(value),flush=True)
read();send({'type':'control_response','response':{'subtype':'success','request_id':'sy_init','response':{}}})
read();send({'type':'system','subtype':'init','session_id':'native'})
send({'type':'control_request','request_id':'vendor','request':{'subtype':'can_use_tool','tool_name':'Write','input':{'file_path':'/fixture/test','content':'original'}}})
send({'type':'control_cancel_request','request_id':'vendor'})
assert not select.select([sys.stdin],[],[],.15)[0]
send({'type':'result','subtype':'success','is_error':False,'session_id':'native'})
"#;
        let mut child = Command::new("python3")
            .args(["-u", "-c", script])
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .spawn()
            .unwrap();
        let (sender, replies) = mpsc::channel(16);
        let (_cancel_sender, mut cancel) = watch::channel(false);
        let mut run = Run {
            session: session("/fixture"),
            cwd: "/fixture".into(),
            prompt: "fixture".into(),
            attachments: Vec::new(),
            generation: "g".into(),
            replies,
        };
        let mut wire = Wire::new(child.stdin.take().unwrap(), child.stdout.take().unwrap());
        let mut request = None;
        let mut acknowledgement = None;
        let mut callback = |event| {
            match event {
                Event::Pending(pending) => {
                    request = Some(RespondAgentRequest {
                        session_id: "s".into(),
                        generation: pending.generation,
                        turn_id: pending.turn_id,
                        request_id: pending.request_id,
                        response: AgentResponse::Approval {
                            decision: ApprovalDecision::Accept,
                        },
                    })
                }
                Event::Answered(_) => {
                    let (result, receiver) = tokio::sync::oneshot::channel();
                    sender
                        .try_send(crate::codex::Inbound::Answer(crate::codex::Reply {
                            request: request.take().unwrap(),
                            result,
                        }))
                        .unwrap();
                    acknowledgement = Some(receiver);
                }
                _ => {}
            }
            Ok(())
        };
        assert!(!execute(&mut wire, &mut run, &mut cancel, &mut callback)
            .await
            .unwrap());
        assert!(acknowledgement.unwrap().await.unwrap().is_err());
        assert!(child.wait().await.unwrap().success());
    }
    /// Fixture prelude: initialize, read our prompt, report the session and launch one
    /// background subagent (frames as the 2.1.294 CLI sends them).
    const BACKGROUND_PRELUDE: &str = r#"import sys,json,select,time
read=lambda:json.loads(sys.stdin.readline())
send=lambda value:print(json.dumps(value),flush=True)
read();send({'type':'control_response','response':{'subtype':'success','request_id':'sy_init','response':{}}})
prompt=read();ours=prompt['uuid']
send({'type':'system','subtype':'init','session_id':'native'})
send({'type':'system','subtype':'background_tasks_changed','tasks':[{'task_id':'bg1','task_type':'local_agent','description':'Audit queries'}],'session_id':'native'})
send({'type':'system','subtype':'task_started','task_id':'bg1','tool_use_id':'tool1','description':'Audit queries','subagent_type':'Explore','is_backgrounded':True,'task_type':'local_agent','session_id':'native'})
send({'type':'assistant','parent_tool_use_id':None,'session_id':'native','message':{'content':[{'type':'text','text':'Launched.'}]}})
send({'type':'result','subtype':'success','is_error':False,'session_id':'native','user_message_uuids':[ours],'queued_turn_count':0})
"#;

    async fn background_turn(
        body: &str,
        limits: Limits,
        cancel_after: Option<Duration>,
        stop_task: Option<&str>,
    ) -> (Result<bool>, Vec<Event>) {
        let script = format!("{BACKGROUND_PRELUDE}{body}");
        let mut child = Command::new("python3")
            .args(["-u", "-c", &script])
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .spawn()
            .unwrap();
        let (sender, replies) = mpsc::channel(16);
        let (cancel_sender, mut cancel) = watch::channel(false);
        let mut run = Run {
            session: session("/fixture"),
            cwd: "/fixture".into(),
            prompt: "fixture".into(),
            attachments: Vec::new(),
            generation: "g".into(),
            replies,
        };
        let mut wire = Wire::new(child.stdin.take().unwrap(), child.stdout.take().unwrap());
        let mut events = Vec::new();
        let mut stop_result = None;
        let outcome = {
            let mut callback = |event: Event| {
                // Once the background child shows, the person may stop it alone.
                if let (Event::Activity(items), Some(task)) = (&event, stop_task) {
                    if stop_result.is_none() && items.iter().any(|item| item.background) {
                        let (result, receiver) = tokio::sync::oneshot::channel();
                        sender
                            .try_send(crate::codex::Inbound::StopTask {
                                task_id: task.into(),
                                result,
                            })
                            .unwrap();
                        stop_result = Some(receiver);
                    }
                }
                events.push(event);
                Ok(())
            };
            let turn = run_turn(&mut wire, &mut run, &mut cancel, &mut callback, limits);
            match cancel_after {
                Some(after) => {
                    tokio::pin!(turn);
                    tokio::select! {
                        outcome = &mut turn => outcome,
                        _ = tokio::time::sleep(after) => {
                            cancel_sender.send(true).unwrap();
                            turn.await
                        }
                    }
                }
                None => turn.await,
            }
        };
        if let Some(receiver) = stop_result {
            assert!(receiver.await.unwrap().is_ok(), "stop_task is delivered");
        }
        drop(wire);
        let _ = tokio::time::timeout(Duration::from_secs(3), child.wait()).await;
        (outcome, events)
    }

    fn quick() -> Limits {
        Limits {
            background: Duration::from_secs(20),
            grace: Duration::from_secs(5),
        }
    }

    fn reply(events: &[Event]) -> String {
        events
            .iter()
            .filter_map(|event| match event {
                Event::Delta(text) => Some(text.as_str()),
                _ => None,
            })
            .collect()
    }

    fn turn_activity(events: Vec<Event>) -> crate::activity::TurnActivity {
        let mut activity = crate::activity::TurnActivity::new(AgentProviderId::Claude, None);
        for event in events {
            if let Event::Activity(items) = event {
                for item in items {
                    activity.observe(item);
                }
            }
        }
        activity
    }

    #[tokio::test]
    async fn background_subagents_keep_the_turn_until_their_follow_up_answers() {
        // Our answer arrives while the child runs; the CLI later runs a notification turn
        // of its own, whose text continues the same reply, and only then the turn ends.
        let body = r#"assert not select.select([sys.stdin],[],[],.3)[0], 'the turn stays open without input'
send({'type':'system','subtype':'task_progress','task_id':'bg1','tool_use_id':'tool1','description':'Running npm test','session_id':'native'})
send({'type':'system','subtype':'task_updated','task_id':'bg1','patch':{'status':'completed'},'session_id':'native'})
send({'type':'system','subtype':'task_notification','task_id':'bg1','tool_use_id':'tool1','status':'completed','summary':'done','session_id':'native'})
send({'type':'system','subtype':'background_tasks_changed','tasks':[],'session_id':'native'})
send({'type':'system','subtype':'init','session_id':'native'})
send({'type':'assistant','parent_tool_use_id':None,'session_id':'native','message':{'content':[{'type':'text','text':'All three audits are in.'}]}})
send({'type':'result','subtype':'success','is_error':False,'session_id':'native','origin':{'kind':'task-notification'},'queued_turn_count':0})
assert sys.stdin.read()==''
"#;
        let (outcome, events) = background_turn(body, quick(), None, None).await;
        assert!(!outcome.unwrap(), "the turn completes, not interrupted");
        assert_eq!(reply(&events), "Launched.\n\nAll three audits are in.");
        // The prompt was taken (a handoff recap is spent), and the marker where the child
        // finished comes before its follow-up reply, once (ADR-101).
        let position = |found: &dyn Fn(&Event) -> bool| events.iter().position(found).unwrap();
        let delivered = position(
            &|event| matches!(event, Event::Activity(items) if items.iter().any(|item| item.delivered)),
        );
        let marker = position(
            &|event| matches!(event, Event::Activity(items) if items.iter().any(|item| item.finished_task)),
        );
        let follow_up =
            position(&|event| matches!(event, Event::Delta(text) if text.contains("All three")));
        assert!(delivered < marker && marker < follow_up);
        let activity = turn_activity(events);
        let markers: Vec<_> = activity
            .items
            .iter()
            .filter(|item| item.finished_task)
            .collect();
        assert_eq!(markers.len(), 1);
        assert_eq!(
            (markers[0].label.as_str(), &markers[0].state),
            ("Audit queries", &crate::activity::ItemState::Completed)
        );
        let child = activity
            .items
            .iter()
            .find(|item| item.id == "agent:bg1")
            .unwrap();
        assert!(child.background);
        assert_eq!(child.label, "Audit queries");
        assert_eq!(child.detail, "Running npm test");
        assert_eq!(child.state, crate::activity::ItemState::Completed);
    }

    #[tokio::test]
    async fn a_queued_follow_up_keeps_the_turn_until_the_last_answer() {
        // Two notification turns: the first reports another one queued.
        let body = r#"send({'type':'system','subtype':'task_notification','task_id':'bg1','status':'completed','session_id':'native'})
send({'type':'system','subtype':'init','session_id':'native'})
send({'type':'assistant','parent_tool_use_id':None,'session_id':'native','message':{'content':[{'type':'text','text':'One.'}]}})
send({'type':'result','subtype':'success','is_error':False,'session_id':'native','origin':{'kind':'task-notification'},'queued_turn_count':1})
time.sleep(.3)
send({'type':'system','subtype':'init','session_id':'native'})
send({'type':'assistant','parent_tool_use_id':None,'session_id':'native','message':{'content':[{'type':'text','text':'Two.'}]}})
send({'type':'result','subtype':'success','is_error':False,'session_id':'native','origin':{'kind':'task-notification'},'queued_turn_count':0})
assert sys.stdin.read()==''
"#;
        let (outcome, events) = background_turn(body, quick(), None, None).await;
        assert!(!outcome.unwrap());
        assert_eq!(reply(&events), "Launched.\n\nOne.\n\nTwo.");
    }

    #[tokio::test]
    async fn stopping_a_background_turn_interrupts_and_leaves_children_interrupted() {
        let body = r#"request=read()
assert request['request']['subtype']=='interrupt', request
send({'type':'control_response','response':{'subtype':'success','request_id':request['request_id'],'response':{}}})
assert sys.stdin.read()==''
"#;
        let (outcome, events) =
            background_turn(body, quick(), Some(Duration::from_millis(400)), None).await;
        assert!(outcome.unwrap(), "a stop reports the turn as interrupted");
        let mut activity = turn_activity(events);
        activity.sync_at(SessionStatus::Stopped, i64::MAX);
        assert_eq!(activity.items[0].state, crate::activity::ItemState::Stopped);
        assert!(
            activity.items[0].background,
            "shown as interrupted, not finished"
        );
        assert!(!activity.items.iter().any(|item| item.finished_task));
        // A turn that ends any other way while a background child runs also interrupted it.
        let mut activity = crate::activity::TurnActivity::new(AgentProviderId::Claude, None);
        activity.observe(
            crate::activity::claude(&json!({"type":"system","subtype":"task_started","task_id":"bg1","description":"Audit","is_backgrounded":true,"task_type":"local_agent"}))
                .remove(0),
        );
        activity.sync_at(SessionStatus::Failed, i64::MAX);
        assert_eq!(activity.items[0].state, crate::activity::ItemState::Stopped);
    }

    #[tokio::test]
    async fn one_background_task_stops_alone_through_the_cli() {
        let body = r#"request=read()
assert request['request']=={'subtype':'stop_task','task_id':'bg1'}, request
send({'type':'control_response','response':{'subtype':'success','request_id':request['request_id'],'response':{}}})
send({'type':'system','subtype':'task_notification','task_id':'bg1','status':'stopped','session_id':'native'})
send({'type':'system','subtype':'background_tasks_changed','tasks':[],'session_id':'native'})
send({'type':'system','subtype':'init','session_id':'native'})
send({'type':'result','subtype':'success','is_error':False,'session_id':'native','origin':{'kind':'task-notification'},'queued_turn_count':0})
assert sys.stdin.read()==''
"#;
        let (outcome, events) = background_turn(body, quick(), None, Some("bg1")).await;
        assert!(!outcome.unwrap());
        let activity = turn_activity(events);
        assert_eq!(activity.items[0].state, crate::activity::ItemState::Stopped);
    }

    #[tokio::test]
    async fn background_work_is_bounded_by_its_limit() {
        let body = r#"request=read()
assert request['request']['subtype']=='interrupt', request
assert sys.stdin.read()==''
"#;
        let limits = Limits {
            background: Duration::from_millis(400),
            grace: Duration::from_secs(5),
        };
        let (outcome, events) = background_turn(body, limits, None, None).await;
        assert!(!outcome.unwrap(), "the limit ends the turn as answered");
        let activity = turn_activity(events);
        assert_eq!(activity.items[0].state, crate::activity::ItemState::Stopped);
        assert!(activity.items[0].timed_out);
    }

    #[tokio::test]
    async fn a_follow_up_that_never_starts_ends_the_turn_after_its_grace() {
        let body = r#"send({'type':'system','subtype':'task_notification','task_id':'bg1','status':'failed','session_id':'native'})
assert sys.stdin.read()==''
"#;
        let limits = Limits {
            background: Duration::from_secs(20),
            grace: Duration::from_millis(300),
        };
        let (outcome, events) = background_turn(body, limits, None, None).await;
        assert!(!outcome.unwrap());
        assert_eq!(
            turn_activity(events).items[0].state,
            crate::activity::ItemState::Failed
        );
    }

    #[test]
    fn only_main_agent_background_subagents_hold_the_turn() {
        let mut background = Background::default();
        // A shell task, a foreground child and a subagent's own task do not hold the turn.
        for frame in [
            json!({"type":"system","subtype":"task_started","task_id":"b","task_type":"local_bash","is_backgrounded":true}),
            json!({"type":"system","subtype":"task_started","task_id":"f","task_type":"local_agent","is_backgrounded":false}),
            json!({"type":"system","subtype":"task_started","task_id":"n","task_type":"local_agent","is_backgrounded":true,"parent_task_id":"x"}),
        ] {
            background.observe(&frame);
        }
        assert!(!background.waiting());
        background.observe(&json!({"type":"system","subtype":"task_started","task_id":"a","task_type":"local_agent","is_backgrounded":true}));
        assert!(background.waiting());
        // The CLI's list of running tasks settles a child whose notification never came.
        assert!(background
            .observe(&json!({"type":"system","subtype":"background_tasks_changed","tasks":[]})));
        assert!(!background.waiting());
    }

    async fn live_turn(
        session: &Session,
        prompt: &str,
        allow: bool,
    ) -> (NativeThread, String, usize) {
        let (process, mut started) = start(
            session.clone(),
            session.worktree.path.clone(),
            prompt.into(),
            HashMap::new(),
            None,
        )
        .await
        .unwrap();
        let sender = process.replies.as_ref().unwrap().clone();
        let mut run = started.codex.take().unwrap();
        let stderr = started.child.stderr.take().unwrap();
        let diagnostics = tokio::spawn(async move {
            let mut reader = tokio::io::BufReader::new(stderr);
            while crate::agent::bounded_line(&mut reader)
                .await
                .is_ok_and(|line| line.is_some())
            {}
        });
        let mut wire = Wire::new(
            started.child.stdin.take().unwrap(),
            started.child.stdout.take().unwrap(),
        );
        let mut native = None;
        let mut output = String::new();
        let mut approvals = 0;
        let mut callback = |event| {
            match event {
                Event::Identity(identity) => native = Some(identity),
                Event::Delta(chunk) => output.push_str(&chunk),
                Event::Pending(pending) => {
                    approvals += 1;
                    if allow
                        && !matches!(&pending.kind,PendingRequestKind::Tool{name,input,..} if name=="Write" && input["file_path"].as_str().is_some_and(|path|path.ends_with("/sirus-claude.txt")))
                    {
                        return Err(Error::agent("Unexpected tool in harmless fixture"));
                    }
                    let (result, _receiver) = tokio::sync::oneshot::channel();
                    sender
                        .try_send(crate::codex::Inbound::Answer(crate::codex::Reply {
                            request: RespondAgentRequest {
                                session_id: session.id.clone(),
                                generation: pending.generation,
                                turn_id: pending.turn_id,
                                request_id: pending.request_id,
                                response: AgentResponse::Approval {
                                    decision: if allow {
                                        ApprovalDecision::Accept
                                    } else {
                                        ApprovalDecision::Decline
                                    },
                                },
                            },
                            result,
                        }))
                        .map_err(|_| Error::agent("Fixture response unavailable"))?;
                }
                Event::Answered(_)
                | Event::Activity(_)
                | Event::Model(_)
                | Event::Context(_)
                | Event::UsageLimit(_) => {}
            }
            Ok(())
        };
        let outcome = tokio::time::timeout(
            Duration::from_secs(120),
            execute(&mut wire, &mut run, &mut started.cancel, &mut callback),
        )
        .await;
        drop(wire);
        process.stop().unwrap();
        let _ = started.child.wait().await;
        diagnostics.abort();
        let _ = diagnostics.await;
        assert!(
            matches!(outcome, Ok(Ok(false))),
            "Claude native turn failed: {outcome:?}; native metadata omitted"
        );
        (native.expect("native identity"), output, approvals)
    }
    #[tokio::test]
    #[ignore = "real existing Claude CLI login; harmless isolated disposable fixture"]
    async fn live_claude_write_and_exact_followup() {
        let repo = crate::git::tests::Repo::new();
        let tree = crate::worktree::create_isolated(
            &repo.cwd(),
            &repo.0.join("workspaces"),
            "claudenative",
            "Claude native test",
            "sirus/{session-name}-{id}",
        )
        .unwrap();
        let mut session = session(&tree.path);
        let (native,output,approvals)=live_turn(&session,"This is a disposable integration test. Remember the exact phrase SIRUS_CLAUDE_REMEMBER_751. Use only the Write tool to create exactly one file sirus-claude.txt in the current workspace containing SIRUS_CLAUDE_OK followed by a newline. Do not read other files, run shell commands, use network tools, install anything, or inspect configuration/authentication. Reply SIRUS_CLAUDE_OK.",true).await;
        assert!(approvals > 0);
        assert!(output.contains("SIRUS_CLAUDE_OK"));
        assert_eq!(
            std::fs::read_to_string(std::path::Path::new(&tree.path).join("sirus-claude.txt"))
                .unwrap(),
            "SIRUS_CLAUDE_OK\n"
        );
        assert!(!repo.cwd().join("sirus-claude.txt").exists());
        session.native_thread = Some(native.clone());
        let (resumed,output,_)=live_turn(&session,"Without tools or filesystem access, repeat the exact phrase I asked you to remember in the previous turn. Reply with that phrase only.",false).await;
        assert_eq!(native.thread_id, resumed.thread_id);
        assert!(output.contains("SIRUS_CLAUDE_REMEMBER_751"));
    }
    #[tokio::test]
    #[ignore = "real existing Claude CLI login; native host tool denial"]
    async fn live_claude_declines_native_write() {
        let repo = crate::git::tests::Repo::new();
        let mut session = session(&repo.cwd().to_string_lossy());
        session.worktree.path = repo.cwd().to_string_lossy().into();
        let (_,output,approvals)=live_turn(&session,"This is a disposable approval test. Request the Write tool to create denied.txt in the current workspace with the word harmless. The host will decline. Do not retry or use alternatives. After denial reply SIRUS_CLAUDE_DENIED_OK. Do not read other files, use shell/network tools, inspect authentication/configuration, or change permissions.",false).await;
        assert!(approvals > 0);
        assert!(!repo.cwd().join("denied.txt").exists());
        assert!(output.contains("SIRUS_CLAUDE_DENIED_OK"));
    }
}
