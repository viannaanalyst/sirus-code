//! Codex app-server's typed, native-owned subset. No arbitrary renderer protocol messages.
use crate::error::{Error, Result};
use crate::models::*;
use serde_json::{json, Value};
use std::collections::HashMap;

pub fn validate_binding(session: &Session, cwd: &str) -> Result<()> {
    if let Some(identity) = &session.native_thread {
        if session.agent != AgentProviderId::Codex
            || identity.session_id != session.id
            || identity.project_id != session.project_id
            || identity.cwd != cwd
            || identity.model != session.model
            || identity.provider_account_id != session.provider_account_id
            || identity.thread_id.is_empty()
        {
            return Err(Error::agent(
                "Codex thread does not match this session, project, workspace or model",
            ));
        }
    }
    Ok(())
}

pub fn answer(pending: &PendingRequest, response: &AgentResponse) -> Result<Value> {
    match (&pending.kind, response) {
        (
            PendingRequestKind::Command { .. } | PendingRequestKind::FileChange { .. },
            AgentResponse::Approval { decision },
        ) => {
            let decision = match decision {
                ApprovalDecision::Accept => "accept",
                ApprovalDecision::Decline => "decline",
                ApprovalDecision::Cancel => "cancel",
            };
            Ok(json!({"decision": decision}))
        }
        (PendingRequestKind::UserInput { questions }, AgentResponse::UserInput { answers }) => {
            if answers.len() != questions.len() {
                return Err(Error::agent("Answer every native question exactly once"));
            }
            let mut result = serde_json::Map::new();
            for question in questions {
                let values = answers
                    .get(&question.id)
                    .ok_or_else(|| Error::agent("Unknown question identity"))?;
                if question.is_secret {
                    return Err(Error::agent(
                        "Secret input is not supported; use the provider CLI",
                    ));
                }
                if values.len() != 1 || values[0].trim().is_empty() || values[0].len() > 8192 {
                    return Err(Error::agent(
                        "Question requires one non-empty answer of at most 8 KiB",
                    ));
                }
                if let Some(options) = &question.options {
                    if !question.is_other && !options.iter().any(|option| option.label == values[0])
                    {
                        return Err(Error::agent("Answer is not a native offered option"));
                    }
                }
                result.insert(question.id.clone(), json!({"answers": values}));
            }
            Ok(json!({"answers": result}))
        }
        _ => Err(Error::agent(
            "Response does not match the native pending request",
        )),
    }
}

struct PendingLedger {
    session_id: String,
    generation: String,
    turn_id: String,
    requests: HashMap<String, (Value, PendingRequest)>,
}
impl PendingLedger {
    fn resolve(&mut self, vendor_id: &Value) -> Option<String> {
        let opaque = self
            .requests
            .iter()
            .find(|(_, (id, _))| id == vendor_id)
            .map(|(opaque, _)| opaque.clone())?;
        self.requests.remove(&opaque);
        Some(opaque)
    }

    fn take(&mut self, response: &RespondAgentRequest) -> Result<(Value, Value)> {
        if response.session_id != self.session_id
            || response.generation != self.generation
            || response.turn_id != self.turn_id
        {
            return Err(Error::agent("Stale or foreign Codex response"));
        }
        let (id, pending) = self
            .requests
            .get(&response.request_id)
            .ok_or_else(|| Error::agent("Codex request already answered or no longer pending"))?;
        let result = answer(pending, &response.response)?;
        let id = id.clone();
        self.requests.remove(&response.request_id);
        Ok((id, result))
    }
}

use std::process::Stdio;
use std::time::Duration;
use tokio::io::{AsyncWriteExt, BufReader};
#[cfg(test)]
use tokio::process::Command;
use tokio::process::{Child, ChildStdin, ChildStdout};
use tokio::sync::{mpsc, oneshot, watch};

pub struct Reply {
    pub request: RespondAgentRequest,
    pub result: oneshot::Sender<Result<()>>,
}
/// What a running native turn accepts from the person: an answer to a pending
/// request, or an instruction steered into the running reply.
pub enum Inbound {
    Answer(Reply),
    Steer {
        text: String,
        result: oneshot::Sender<Result<()>>,
    },
    /// Stop one background task of the running turn (Claude's `stop_task`, ADR-097).
    StopTask {
        task_id: String,
        result: oneshot::Sender<Result<()>>,
    },
}
pub struct Run {
    pub session: Session,
    pub cwd: String,
    pub prompt: String,
    pub attachments: Vec<std::sync::Arc<crate::attachments::PreparedAttachment>>,
    pub generation: String,
    pub replies: mpsc::Receiver<Inbound>,
}
pub enum Event {
    Identity(NativeThread),
    Delta(String),
    Pending(PendingRequest),
    Answered(String),
    Activity(Vec<crate::activity::ActivityItem>),
    Model(String),
    /// Context-window reading reported by the provider (ADR-057).
    Context(crate::models::ContextUsage),
    /// The turn hit the account's usage limit; the reset time when the provider reported it.
    UsageLimit(Option<i64>),
}

/// Each turn owns one server process. Follow-ups resume the exact persisted thread.
/// No idle process remains after a completed turn; pending callbacks are generation-local.
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
    let install = crate::detect::resolve_with_overrides(&AgentProviderId::Codex, &overrides)
        .ok_or_else(|| Error::agent("Unknown provider"))?;
    if !install.installed {
        return Err(Error::agent("Codex is not installed on this machine"));
    }
    let mut cmd = crate::detect::command(install.path.unwrap_or(install.binary));
    crate::provider_accounts::apply(&mut cmd, &session.agent, account_home.as_deref());
    if let Some(endpoint) = crate::browser_mcp::ensure_endpoint(&session.id) {
        if let Ok(exe) = std::env::current_exe() {
            let values = [
                (
                    "mcp_servers.sirus_browser.command",
                    format!("{:?}", exe.to_string_lossy()),
                ),
                (
                    "mcp_servers.sirus_browser.args",
                    "[\"--mcp-browser\"]".to_string(),
                ),
                (
                    "mcp_servers.sirus_browser.env.SIRUS_BROWSER_SOCKET",
                    format!("{:?}", endpoint.socket.to_string_lossy()),
                ),
                (
                    "mcp_servers.sirus_browser.env.SIRUS_BROWSER_TOKEN",
                    format!("{:?}", endpoint.token),
                ),
                // Integrated browser tools are fixed and bounded; no per-call
                // prompt (the app already interrupts on human page input).
                (
                    "mcp_servers.sirus_browser.default_tools_approval_mode",
                    "\"approve\"".to_string(),
                ),
                // A private secret card waits up to five minutes for the person (ADR-077).
                (
                    "mcp_servers.sirus_browser.tool_timeout_sec",
                    "330".to_string(),
                ),
            ];
            for (key, value) in values {
                cmd.arg("-c").arg(format!("{key}={value}"));
            }
            if let Some((key, value)) = crate::sirus_tools::child_env() {
                cmd.arg("-c")
                    .arg(format!("mcp_servers.sirus_browser.env.{key}={value:?}"));
            }
            for value in crate::computer_mcp::codex_overrides(&session.id) {
                cmd.arg("-c").arg(value);
            }
        }
    }
    cmd.args(["app-server", "--stdio"])
        .current_dir(&cwd)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    #[cfg(unix)]
    cmd.process_group(0);
    let child = cmd
        .spawn()
        .map_err(|_| Error::agent("Cannot start Codex app-server"))?;
    let generation = uuid::Uuid::new_v4().to_string();
    let (cancel, receiver) = watch::channel(false);
    let (sender, replies) = mpsc::channel(16);
    Ok((
        crate::agent::AgentProcess {
            cancel,
            #[cfg(unix)]
            pid: child.id(),
            replies: Some(sender),
            generation: Some(generation.clone()),
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

pub(crate) struct Wire {
    input: ChildStdin,
    output: BufReader<ChildStdout>,
    sequence: u64,
    deferred: std::collections::VecDeque<Value>,
    deferred_bytes: usize,
    line: Vec<u8>,
}
impl Wire {
    pub(crate) fn new(input: ChildStdin, output: ChildStdout) -> Self {
        Self {
            input,
            output: BufReader::new(output),
            sequence: 0,
            deferred: Default::default(),
            deferred_bytes: 0,
            line: Vec::new(),
        }
    }
    pub(crate) async fn send(&mut self, value: Value) -> Result<()> {
        let mut bytes = serde_json::to_vec(&value)?;
        bytes.push(b'\n');
        tokio::time::timeout(Duration::from_secs(5), self.input.write_all(&bytes))
            .await
            .map_err(|_| Error::agent("Native protocol write timed out"))??;
        Ok(())
    }
    pub(crate) async fn read(&mut self) -> Result<Value> {
        use tokio::io::AsyncBufReadExt;
        loop {
            let buffer = self.output.fill_buf().await?;
            if buffer.is_empty() {
                return Err(Error::agent("Native protocol closed its output"));
            }
            let end = buffer.iter().position(|byte| *byte == b'\n');
            let count = end.map_or(buffer.len(), |index| index + 1);
            if self.line.len() + count > 8 * 1024 * 1024 {
                return Err(Error::agent("Native protocol line exceeds limit"));
            }
            self.line.extend_from_slice(&buffer[..count]);
            self.output.consume(count);
            if end.is_some() {
                let line = std::mem::take(&mut self.line);
                return serde_json::from_slice(&line)
                    .map_err(|_| Error::agent("Native protocol sent invalid JSON"));
            }
        }
    }

    async fn request(
        &mut self,
        method: &str,
        params: Value,
        cancel: &mut watch::Receiver<bool>,
    ) -> Result<Value> {
        self.sequence += 1;
        let id = format!("sirus-{}", self.sequence);
        self.send(json!({"id":id,"method":method,"params":params}))
            .await?;
        tokio::time::timeout(Duration::from_secs(30), async {
            loop {
                let value = tokio::select! {
                    value = self.read() => value?,
                    _ = cancel.changed() => return Err(Error::agent("Codex startup cancelled")),
                };
                if value["id"] == id {
                    if value.get("error").is_some() { return Err(Error::agent(format!("Codex rejected {method}; check CLI compatibility and native thread availability"))); }
                    return value.get("result").cloned().ok_or_else(|| Error::agent("Codex response lacks result"));
                }
                if matches!(method, "turn/start" | "thread/compact/start" | "turn/steer") && value.get("method").is_some() {
                    let size=value.to_string().len();
                    if self.deferred.len() >= 256 || self.deferred_bytes + size > 8*1024*1024 {return Err(Error::agent("Too many early Codex turn events"));}
                    self.deferred_bytes+=size;
                    self.deferred.push_back(value);
                    continue;
                }
                // Startup never authorizes callbacks or displays account/configuration metadata.
                if value.get("id").is_some() && value.get("method").is_some() {
                    self.send(json!({"id":value["id"],"error":{"code":-32601,"message":"Unsupported during initialization"}})).await?;
                }
            }
        }).await.map_err(|_| Error::agent("Codex initialization timed out"))?
    }
}

fn string(value: &Value, name: &str) -> Result<String> {
    value
        .get(name)
        .and_then(Value::as_str)
        .filter(|v| !v.is_empty() && v.len() < 16 * 1024)
        .map(str::to_owned)
        .ok_or_else(|| Error::agent("Codex protocol identity is invalid"))
}
fn pending_kind(method: &str, params: &Value) -> Result<Option<PendingRequestKind>> {
    Ok(match method {
        "item/commandExecution/requestApproval" => {
            // Stdin/network variants and permission amendments are not generic command approvals.
            if params
                .get("kind")
                .and_then(Value::as_str)
                .is_some_and(|kind| kind != "command")
                || params
                    .get("networkApprovalContext")
                    .is_some_and(|v| !v.is_null())
            {
                return Ok(None);
            }
            Some(PendingRequestKind::Command {
                command: string(params, "command")?,
                cwd: params["cwd"].as_str().map(str::to_owned),
                reason: params["reason"].as_str().map(str::to_owned),
            })
        }
        "item/fileChange/requestApproval" => {
            if params["grantRoot"].as_str().is_some() {
                return Ok(None);
            }
            let Some(changes) = params["changes"]
                .as_array()
                .filter(|changes| !changes.is_empty() && changes.len() <= 256)
            else {
                return Ok(None);
            };
            let changes = changes
                .iter()
                .map(|change| {
                    Ok(ProposedFileChange {
                        path: string(change, "path")?,
                        kind: string(&change["kind"], "type")?,
                        diff: change["diff"]
                            .as_str()
                            .ok_or_else(|| Error::agent("Invalid native file diff"))?
                            .into(),
                        move_path: change["kind"]["move_path"].as_str().map(str::to_owned),
                    })
                })
                .collect::<Result<Vec<_>>>()?;
            Some(PendingRequestKind::FileChange {
                reason: params["reason"].as_str().map(str::to_owned),
                changes,
            })
        }
        "item/tool/requestUserInput" => {
            let questions: Vec<InputQuestion> = serde_json::from_value(params["questions"].clone())
                .map_err(|_| Error::agent("Invalid native questions"))?;
            let unique: std::collections::HashSet<_> =
                questions.iter().map(|question| &question.id).collect();
            if questions.is_empty()
                || questions.len() > 16
                || unique.len() != questions.len()
                || questions.iter().any(|q| q.is_secret)
            {
                return Ok(None);
            }
            Some(PendingRequestKind::UserInput { questions })
        }
        _ => None,
    })
}

async fn execute(
    wire: &mut Wire,
    run: &mut Run,
    cancel: &mut watch::Receiver<bool>,
    emit: &mut impl FnMut(Event) -> Result<()>,
) -> Result<bool> {
    wire.request("initialize", json!({"clientInfo":{"name":"sirus","title":"Sirus Code","version":env!("CARGO_PKG_VERSION")},"capabilities":{"experimentalApi":true}}),cancel).await?;
    wire.send(json!({"method":"initialized"})).await?;
    let (sandbox, approval, reviewer) = crate::execution::codex_policy(&run.session.execution);
    let mut params = json!({"cwd":run.cwd,"sandbox":sandbox,"approvalPolicy":approval,"approvalsReviewer":reviewer});
    if let Some(model) = &run.session.model {
        params["model"] = json!(model);
    }
    let method = if let Some(identity) = &run.session.native_thread {
        params["threadId"] = json!(identity.thread_id);
        params["excludeTurns"] = json!(true);
        "thread/resume"
    } else {
        "thread/start"
    };
    let thread = wire.request(method, params, cancel).await?;
    let thread_id = string(&thread["thread"], "id")?;
    if thread["cwd"].as_str() != Some(&run.cwd)
        || thread["approvalPolicy"] != approval
        || thread["approvalsReviewer"] != reviewer
        || thread["sandbox"]["type"]
            != if sandbox == "danger-full-access" {
                "dangerFullAccess"
            } else {
                "workspaceWrite"
            }
    {
        return Err(Error::agent(
            "Codex did not honor the selected approval and sandbox policy",
        ));
    }
    if run
        .session
        .native_thread
        .as_ref()
        .is_some_and(|identity| identity.thread_id != thread_id)
    {
        return Err(Error::agent("Codex resumed a different native thread"));
    }
    emit(Event::Identity(NativeThread {
        provider_account_id: run.session.provider_account_id.clone(),
        thread_id: thread_id.clone(),
        session_id: run.session.id.clone(),
        project_id: run.session.project_id.clone(),
        cwd: run.cwd.clone(),
        model: run.session.model.clone(),
    }))?;
    if let Some(model) = thread["model"].as_str() {
        emit(Event::Model(model.into()))?;
    }
    // `/compact` on an existing thread compacts its context instead of starting a turn (ADR-057).
    let compact = is_compact(&run.prompt)
        && run.session.native_thread.is_some()
        && run.attachments.is_empty();
    let turn_id = if compact {
        wire.request(
            "thread/compact/start",
            json!({"threadId":thread_id}),
            cancel,
        )
        .await?;
        compaction_turn(wire, &thread_id, cancel).await?
    } else {
        let mut turn_params = json!({"threadId":thread_id,"cwd":run.cwd,"approvalPolicy":"on-request","approvalsReviewer":"user","sandboxPolicy":{"type":"workspaceWrite","writableRoots":[run.cwd],"networkAccess":false,"excludeTmpdirEnvVar":true,"excludeSlashTmp":true},"input":[{"type":"text","text":run.prompt,"text_elements":[]} ]});
        turn_params["input"] = crate::attachments::codex_input(&run.prompt, &run.attachments);
        crate::execution::codex_turn(
            &mut turn_params,
            &run.session.execution,
            run.session.model.as_deref(),
        )?;
        let turn = wire.request("turn/start", turn_params, cancel).await?;
        string(&turn["turn"], "id")?
    };
    let mut ledger = PendingLedger {
        session_id: run.session.id.clone(),
        generation: run.generation.clone(),
        turn_id: turn_id.clone(),
        requests: HashMap::new(),
    };
    let mut items: HashMap<String, String> = HashMap::new();
    let mut item_key_bytes = 0;
    // Separate consecutive assistant message items in the one transcript message.
    let mut last_text_item: Option<String> = None;
    // Usage-limit refusal and the latest exhausted window's reset (`account/rateLimits/updated`).
    let mut usage_limited = false;
    let mut exhausted_reset: Option<i64> = None;
    let mut file_changes: HashMap<String, Value> = HashMap::new();
    let mut file_change_bytes = 0;
    let mut seen_requests = std::collections::HashSet::new();
    loop {
        let value = if let Some(value) = wire.deferred.pop_front() {
            wire.deferred_bytes = wire.deferred_bytes.saturating_sub(value.to_string().len());
            value
        } else {
            tokio::select! {
                value = wire.read() => value?,
                reply = run.replies.recv() => {
                    let Some(reply) = reply else { return Err(Error::agent("Codex response channel closed")); };
                    let reply = match reply {
                        Inbound::Answer(reply) => reply,
                        Inbound::Steer { text, result } => {
                            // `turn/steer` adds the person's input to this same turn; its events wait in the queue.
                            let params = json!({"threadId":thread_id,"input":crate::attachments::codex_input(&text, &[]),"expectedTurnId":turn_id});
                            let delivered = wire.request("turn/steer", params, &mut cancel.clone()).await.map(|_| ()).map_err(|_| Error::agent("Codex did not accept the instruction for this turn"));
                            let _ = result.send(delivered);
                            continue;
                        }
                        Inbound::StopTask { result, .. } => {
                            let _ = result.send(Err(Error::agent("Codex has no background tasks to stop")));
                            continue;
                        }
                    };
                    match ledger.take(&reply.request) {
                        Ok((id,result)) => {
                            let sent = wire.send(json!({"id":id,"result":result})).await;
                            if sent.is_ok() { emit(Event::Answered(reply.request.request_id))?; }
                            let failed = sent.is_err(); let _ = reply.result.send(sent);
                            if failed { return Err(Error::agent("Codex approval response could not be delivered")); }
                        }
                        Err(error) => { let _ = reply.result.send(Err(error)); }
                    }
                    continue;
                }
                _ = cancel.changed() => {
                    // Native interruption first, bounded fallback cleanup is performed by monitor.
                    wire.sequence += 1;
                    wire.send(json!({"id":format!("sirus-{}",wire.sequence),"method":"turn/interrupt","params":{"threadId":thread_id,"turnId":turn_id}})).await?;
                    let _ = tokio::time::timeout(Duration::from_secs(2), async {
                        while let Ok(value) = wire.read().await {
                            if value["method"] == "turn/completed" && value["params"]["turn"]["id"] == turn_id { break; }
                        }
                    }).await;
                    return Ok(true);
                }
            }
        };
        let Some(method) = value["method"].as_str() else {
            continue;
        };
        let params = &value["params"];
        if value.get("id").is_some() {
            if params["threadId"] != thread_id || params["turnId"] != turn_id {
                return Err(Error::agent(
                    "Codex callback belongs to another thread or turn",
                ));
            }
            let original = value["id"].clone();
            if !(original
                .as_str()
                .is_some_and(|id| !id.is_empty() && id.len() <= 1024)
                || original.is_i64())
                || seen_requests.len() >= 1024
                || !seen_requests.insert(original.to_string())
            {
                return Err(Error::agent("Invalid or duplicate Codex callback"));
            }
            if ledger.requests.len() >= 16 {
                return Err(Error::agent("Too many pending Codex callbacks"));
            }
            let mut details = params.clone();
            if method == "item/fileChange/requestApproval" {
                if let Some(changes) = params["itemId"]
                    .as_str()
                    .and_then(|item| file_changes.get(item))
                {
                    details["changes"] = changes.clone();
                }
            }
            if let Some(kind) = pending_kind(method, &details)? {
                let pending = PendingRequest {
                    request_id: uuid::Uuid::new_v4().to_string(),
                    generation: run.generation.clone(),
                    turn_id: turn_id.clone(),
                    item_id: string(params, "itemId")?,
                    kind,
                };
                ledger
                    .requests
                    .insert(pending.request_id.clone(), (original, pending.clone()));
                emit(Event::Pending(pending))?;
            } else {
                let result = match method {
                    "item/commandExecution/requestApproval" | "item/fileChange/requestApproval" => {
                        Some(json!({"decision":"decline"}))
                    }
                    "item/permissions/requestApproval" => {
                        Some(json!({"permissions":{},"scope":"turn"}))
                    }
                    "item/tool/requestUserInput" => Some(json!({"answers":{}})),
                    _ => None,
                };
                wire.send(match result {
                    Some(result) => json!({"id":original,"result":result}),
                    None => json!({"id":original,"error":{"code":-32601,"message":"Unsupported native request"}}),
                }).await?;
            }
            continue;
        }
        if params["threadId"] != thread_id {
            // This turn's server only hosts its own thread and the children it spawns. Child work is
            // display-only and attaches to an observed child row; unknown threads are discarded.
            if let Some(thread) = params["threadId"].as_str() {
                if matches!(method, "item/started" | "item/completed") {
                    let items = crate::activity::codex_child(
                        &params["item"],
                        method == "item/started",
                        thread,
                    );
                    if !items.is_empty() {
                        emit(Event::Activity(items))?;
                    }
                }
            }
            continue;
        }
        if params["turnId"] == turn_id && matches!(method, "item/started" | "item/completed") {
            let items = crate::activity::codex(&params["item"], method == "item/started");
            if !items.is_empty() {
                emit(Event::Activity(items))?;
            }
        }
        match method {
            "serverRequest/resolved" => {
                if let Some(opaque) = ledger.resolve(&params["requestId"]) {
                    emit(Event::Answered(opaque))?;
                }
            }
            "item/started"
                if params["turnId"] == turn_id && params["item"]["type"] == "fileChange" =>
            {
                if file_changes.len() >= 256 {
                    return Err(Error::agent("Too many native file change proposals"));
                }
                let item = string(&params["item"], "id")?;
                let changes = params["item"]["changes"].clone();
                if let Some(previous) = file_changes.remove(&item) {
                    file_change_bytes -= previous.to_string().len();
                }
                file_change_bytes += changes.to_string().len();
                if file_change_bytes > 8 * 1024 * 1024 {
                    return Err(Error::agent(
                        "Codex file proposals exceeded the 8 MiB limit",
                    ));
                }
                file_changes.insert(item, changes);
            }
            "item/completed"
                if params["turnId"] == turn_id && params["item"]["type"] == "fileChange" =>
            {
                if let Some(previous) = params["item"]["id"]
                    .as_str()
                    .and_then(|item| file_changes.remove(item))
                {
                    file_change_bytes -= previous.to_string().len();
                }
            }
            "item/agentMessage/delta" if params["turnId"] == turn_id => {
                let item = string(params, "itemId")?;
                let delta = params["delta"]
                    .as_str()
                    .ok_or_else(|| Error::agent("Invalid Codex text delta"))?;
                if delta.is_empty() {
                    continue;
                }
                let separator = item_separator(&mut last_text_item, &item);
                let text = bounded_item(&mut items, &mut item_key_bytes, item)?;
                if text.len() + delta.len() > 8 * 1024 * 1024 {
                    return Err(Error::agent("Codex output exceeded the 8 MiB limit"));
                }
                text.push_str(delta);
                emit(Event::Delta(format!("{separator}{delta}")))?;
            }
            "item/completed"
                if params["turnId"] == turn_id && params["item"]["type"] == "agentMessage" =>
            {
                let item = string(&params["item"], "id")?;
                let text = params["item"]["text"]
                    .as_str()
                    .ok_or_else(|| Error::agent("Invalid Codex assistant text"))?;
                let separator = if text.len() > items.get(&item).map_or(0, String::len) {
                    item_separator(&mut last_text_item, &item)
                } else {
                    ""
                };
                let previous = bounded_item(&mut items, &mut item_key_bytes, item)?;
                if let Some(rest) = text.strip_prefix(previous.as_str()) {
                    if !rest.is_empty() {
                        emit(Event::Delta(format!("{separator}{rest}")))?;
                    }
                } else {
                    return Err(Error::agent(
                        "Codex final text did not match streamed output",
                    ));
                }
                *previous = text.into();
            }
            "account/rateLimits/updated" => {
                if let Some(reset) = exhausted_window_reset(&params["rateLimits"]) {
                    exhausted_reset = Some(reset);
                }
            }
            "error" if params["turnId"] == turn_id => {
                usage_limited |= is_usage_limit(&params["error"]);
            }
            "thread/tokenUsage/updated" => {
                if let Some(usage) = context_usage(params) {
                    emit(Event::Context(usage))?;
                }
            }
            "turn/completed" if params["turn"]["id"] == turn_id => {
                return match params["turn"]["status"].as_str() {
                    Some("completed") => Ok(false),
                    Some("interrupted") => Ok(true),
                    _ if usage_limited || is_usage_limit(&params["turn"]["error"]) => {
                        emit(Event::UsageLimit(exhausted_reset))?;
                        Err(Error::new("usage_limit", "Usage limit reached."))
                    }
                    _ => Err(Error::agent("Codex turn failed; see CLI diagnostics")),
                };
            }
            _ => {}
        }
    }
}

/// Codex marks a spent account limit with `codexErrorInfo: "usageLimitExceeded"`.
fn is_usage_limit(error: &Value) -> bool {
    match &error["codexErrorInfo"] {
        Value::String(kind) => kind == "usageLimitExceeded",
        Value::Object(kinds) => kinds.contains_key("usageLimitExceeded"),
        _ => false,
    }
}

/// The latest reset (UTC ms) among rate-limit windows at or over 100%.
pub(crate) fn exhausted_window_reset(snapshot: &Value) -> Option<i64> {
    ["primary", "secondary"]
        .iter()
        .filter_map(|key| {
            let window = &snapshot[*key];
            (window["usedPercent"].as_f64()? >= 100.0)
                .then(|| window["resetsAt"].as_i64())
                .flatten()
        })
        .max()
        .map(|seconds| seconds.saturating_mul(1000))
}

/// The standalone `/compact` command.
pub(crate) fn is_compact(prompt: &str) -> bool {
    prompt.trim() == "/compact"
}

/// `thread/tokenUsage/updated`: the last request's total is what the context holds now;
/// the running total keeps growing across compactions and is ignored.
fn context_usage(params: &Value) -> Option<crate::models::ContextUsage> {
    let usage = &params["tokenUsage"];
    Some(crate::models::ContextUsage {
        used: usage["last"]["totalTokens"].as_u64()?,
        window: usage["modelContextWindow"]
            .as_u64()
            .filter(|window| *window > 0),
    })
}

/// A compaction runs as its own turn; its id arrives with `turn/started`.
/// Other early events stay queued for the turn loop, within the same bounds.
async fn compaction_turn(
    wire: &mut Wire,
    thread_id: &str,
    cancel: &mut watch::Receiver<bool>,
) -> Result<String> {
    let started = |value: &Value| {
        (value["method"] == "turn/started" && value["params"]["threadId"] == thread_id)
            .then(|| value["params"]["turn"]["id"].as_str().map(str::to_owned))
            .flatten()
    };
    if let Some(id) = wire.deferred.iter().find_map(started) {
        return Ok(id);
    }
    tokio::time::timeout(Duration::from_secs(30), async {
        loop {
            let value = tokio::select! {
                value = wire.read() => value?,
                _ = cancel.changed() => return Err(Error::agent("Codex compaction cancelled")),
            };
            let id = started(&value);
            let size = value.to_string().len();
            if wire.deferred.len() >= 256 || wire.deferred_bytes + size > 8 * 1024 * 1024 {
                return Err(Error::agent("Too many early Codex turn events"));
            }
            wire.deferred_bytes += size;
            wire.deferred.push_back(value);
            if let Some(id) = id {
                return Ok(id);
            }
        }
    })
    .await
    .map_err(|_| Error::agent("Codex did not start the compaction"))?
}

/// A blank line before the first text of a new assistant message item, so
/// consecutive Codex messages in one turn do not run together.
fn item_separator(last: &mut Option<String>, item: &str) -> &'static str {
    let separator = match last.as_deref() {
        Some(previous) if previous != item => "\n\n",
        _ => "",
    };
    if last.as_deref() != Some(item) {
        *last = Some(item.to_owned());
    }
    separator
}

fn bounded_item<'a>(
    items: &'a mut HashMap<String, String>,
    bytes: &mut usize,
    item: String,
) -> Result<&'a mut String> {
    if !items.contains_key(&item) {
        if items.len() >= 4096 || *bytes + item.len() > 1024 * 1024 {
            return Err(Error::agent("Too many Codex output item identities"));
        }
        *bytes += item.len();
    }
    Ok(items.entry(item).or_default())
}

pub fn monitor(
    mut started: crate::agent::StartedAgent,
    mut run: Run,
    app: tauri::AppHandle,
    state: std::sync::Arc<crate::commands::AppState>,
    session_id: String,
) {
    use tauri::Emitter;
    let Some(input) = started.child.stdin.take() else {
        return;
    };
    let Some(output) = started.child.stdout.take() else {
        return;
    };
    let (provider_error_sender, mut provider_errors) = tokio::sync::mpsc::channel(4);
    let opencode = run.session.agent == AgentProviderId::OpenCode;
    let diagnostics = started.child.stderr.take().map(|reader| {
        if opencode {
            crate::opencode::watch_logs(reader, provider_error_sender)
        } else {
            crate::agent::spawn_reader(
                app.clone(),
                state.clone(),
                session_id.clone(),
                "stderr",
                reader,
            )
        }
    });
    tokio::spawn(async move {
        let mut wire = Wire::new(input, output);
        let mut cursor = crate::agent::OutputCursor::default();
        let mut emit = |event| -> Result<()> {
            let mut data = state.data.lock();
            let session = data
                .sessions
                .iter_mut()
                .find(|session| session.id == session_id)
                .ok_or_else(|| Error::agent("Session removed during native turn"))?;
            if session.status == SessionStatus::Stopped {
                return Ok(());
            }
            if session.status == SessionStatus::Failed {
                return Err(Error::agent("Native turn cancelled"));
            }
            let mut publish = true;
            let mut persist_immediately = true;
            // Tool rows, subagent steps and context readings change many times a
            // second in a busy turn; they are published together (ADR-048 events).
            let mut coalesce = false;
            match event {
                Event::Identity(identity) => session.native_thread = Some(identity),
                Event::Activity(items) => {
                    publish = false;
                    persist_immediately = false;
                    coalesce = true;
                    for item in items {
                        publish |= crate::activity::observe(session, item);
                    }
                }
                Event::Model(model) => crate::activity::model(session, &model),
                Event::UsageLimit(resets_at) => {
                    session.usage_limit = Some(crate::models::UsageLimit { resets_at })
                }
                Event::Context(usage) => {
                    // A reading without a window keeps the last window known for this model.
                    let window = usage
                        .window
                        .or(session.context_usage.and_then(|known| known.window));
                    let next = crate::models::ContextUsage {
                        used: usage.used,
                        window,
                    };
                    publish = session.context_usage != Some(next);
                    persist_immediately = false;
                    coalesce = true;
                    session.context_usage = Some(next);
                }
                Event::Delta(chunk) => {
                    if let Some(event) =
                        crate::agent::record_output(session, &mut cursor, "stdout", chunk)?
                    {
                        let _ = app.emit("agent-output", event);
                    }
                    publish = false;
                    persist_immediately = false;
                }
                Event::Pending(pending) => {
                    session.pending_requests.push(pending);
                    session.status = SessionStatus::Waiting;
                    crate::notifications::publish(&app, &state, session);
                }
                Event::Answered(id) => {
                    session
                        .pending_requests
                        .retain(|request| request.request_id != id);
                    if session.pending_requests.is_empty() {
                        session.status = SessionStatus::Running;
                    }
                }
            }
            crate::activity::sync(session);
            // Identity, requests and answers are saved now; streamed text and activity
            // use the coalesced checkpoint written outside the lock.
            if persist_immediately {
                crate::persist::save(&state.data_path, &data)?;
            } else {
                crate::persist::checkpoint_soon(&state, &session_id);
            }
            if publish && coalesce {
                crate::transcript_view::emit_soon(&app, &session_id);
            } else if publish {
                if let Some(session) = data
                    .sessions
                    .iter()
                    .find(|session| session.id == session_id)
                {
                    crate::transcript_view::emit(&app, session);
                }
            }
            Ok(())
        };
        let outcome = if run.session.agent == AgentProviderId::Claude {
            crate::claude::execute(&mut wire, &mut run, &mut started.cancel, &mut emit).await
        } else if run.session.agent == AgentProviderId::OpenCode {
            crate::opencode::execute(
                &mut wire,
                &mut run,
                &mut started.cancel,
                &mut provider_errors,
                &mut emit,
            )
            .await
        } else {
            execute(&mut wire, &mut run, &mut started.cancel, &mut emit).await
        };
        // Completion invalidates callbacks before the server's bounded cleanup window.
        // Closing the reply receiver also rejects IPC queued after the turn has settled.
        drop(run);
        {
            let mut data = state.data.lock();
            if let Some(session) = data
                .sessions
                .iter_mut()
                .find(|session| session.id == session_id)
            {
                if !session.pending_requests.is_empty() {
                    session.pending_requests.clear();
                    crate::transcript_view::emit(&app, session);
                }
            }
        }
        drop(wire); // EOF requests app-server shutdown after turn completion.
        stop_owned(&mut started.child).await;
        let protocol_failed =
            crate::agent::drain_output_readers(diagnostics).await || outcome.is_err();
        let review =
            crate::turn_review::finish(started.review.take(), state.clone(), session_id.clone())
                .await;
        let mut data = state.data.lock();
        // Admission and unregistering stay ordered; no stale signal handle survives reap.
        state.agents.lock().remove(&session_id);
        let _ = started.child.try_wait();
        if let Some(session) = data
            .sessions
            .iter_mut()
            .find(|session| session.id == session_id)
        {
            let cancelled = *started.cancel.borrow()
                || outcome.as_ref().is_ok_and(|interrupted| *interrupted)
                || session.status == SessionStatus::Stopped;
            if let Err(error) = &outcome {
                if !cancelled {
                    session.last_error = Some(error.to_string());
                }
            }
            crate::agent::finalize_session(
                session,
                Some(if outcome.is_ok() { 0 } else { 1 }),
                cancelled,
                protocol_failed,
                state.closing.load(std::sync::atomic::Ordering::Acquire),
                None,
            );
            session.pending_requests.clear();
            crate::turn_review::attach(session, review);
            crate::transcript_view::emit(&app, session);
            crate::notifications::publish(&app, &state, session);
        }
        if let Err(error) = crate::persist::save(&state.data_path, &data) {
            tracing::error!(%error,"cannot persist native completion");
        }
        crate::team::settled(&app, &state, &session_id);
        crate::astros::settled(&app, &state, &session_id);
        crate::ci_autofix::settled(&state, &session_id);
        crate::project_scripts::settled(&app, &state, &session_id);
        let _ = app.emit(
            "agent-exit",
            AgentExitEvent {
                session_id,
                code: outcome.is_ok().then_some(0),
            },
        );
    });
}

async fn stop_owned(child: &mut Child) {
    #[cfg(unix)]
    {
        let observed = tokio::time::timeout(
            Duration::from_secs(2),
            crate::agent::observe_owned_exit(child),
        )
        .await;
        // Never signal a reaped/reused identity if observation failed.
        if !matches!(observed, Ok(Err(_))) {
            crate::agent::kill_owned_group(child);
            let _ = crate::agent::observe_owned_exit(child).await;
        }
    }
    #[cfg(not(unix))]
    if tokio::time::timeout(Duration::from_secs(2), child.wait())
        .await
        .is_err()
    {
        let _ = child.start_kill();
        let _ = child.wait().await;
    }
}

#[cfg(test)]
async fn cleanup(child: &mut Child) {
    stop_owned(child).await;
    let _ = child.wait().await;
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn usage_limits_and_their_reset_come_from_codex_reports() {
        assert!(is_usage_limit(
            &json!({"message":"limit","codexErrorInfo":"usageLimitExceeded"})
        ));
        assert!(is_usage_limit(
            &json!({"codexErrorInfo":{"usageLimitExceeded":{}}})
        ));
        assert!(
            !is_usage_limit(&json!({"codexErrorInfo":"other"})) && !is_usage_limit(&Value::Null)
        );
        let snapshot = json!({"primary":{"usedPercent":100,"resetsAt":1790000000},"secondary":{"usedPercent":40,"resetsAt":1790500000}});
        assert_eq!(exhausted_window_reset(&snapshot), Some(1_790_000_000_000));
        assert_eq!(
            exhausted_window_reset(&json!({"primary":{"usedPercent":99,"resetsAt":1}})),
            None
        );
    }

    #[test]
    fn context_usage_reads_the_last_request_and_window() {
        let params = json!({"threadId":"t","turnId":"u","tokenUsage":{"last":{"totalTokens":176000,"inputTokens":1,"cachedInputTokens":0,"outputTokens":0,"reasoningOutputTokens":0},"total":{"totalTokens":900000,"inputTokens":1,"cachedInputTokens":0,"outputTokens":0,"reasoningOutputTokens":0},"modelContextWindow":256000}});
        assert_eq!(
            context_usage(&params),
            Some(crate::models::ContextUsage {
                used: 176000,
                window: Some(256000)
            })
        );
        assert_eq!(context_usage(&json!({"tokenUsage":{"last":{}}})), None);
        assert!(is_compact(" /compact ") && !is_compact("/compact now"));
    }
    #[test]
    fn consecutive_assistant_items_are_separated_once() {
        let mut last = None;
        assert_eq!(item_separator(&mut last, "a"), "");
        assert_eq!(item_separator(&mut last, "a"), "");
        assert_eq!(item_separator(&mut last, "b"), "\n\n");
        assert_eq!(item_separator(&mut last, "b"), "");
    }
    #[test]
    fn empty_output_items_have_count_and_retained_key_bounds() {
        let mut items = HashMap::new();
        let mut bytes = 0;
        for index in 0..4096 {
            bounded_item(&mut items, &mut bytes, index.to_string()).unwrap();
        }
        assert!(bounded_item(&mut items, &mut bytes, "overflow".into()).is_err());
        let mut items = HashMap::new();
        let mut bytes = 0;
        for index in 0..64 {
            bounded_item(
                &mut items,
                &mut bytes,
                format!("{index:04}{}", "x".repeat(16 * 1024 - 4)),
            )
            .unwrap();
        }
        assert!(bounded_item(&mut items, &mut bytes, "overflow".into()).is_err());
        let existing = items.keys().next().unwrap().clone();
        assert!(bounded_item(&mut items, &mut bytes, existing).is_ok());
    }
    #[tokio::test]
    async fn protocol_read_preserves_split_frame_across_cancelled_select() {
        let mut child = Command::new("sh")
            .args([
                "-c",
                "printf '{\"type\":'; read -r release; printf '\"complete\"}\\n'",
            ])
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .spawn()
            .unwrap();
        let mut wire = Wire::new(child.stdin.take().unwrap(), child.stdout.take().unwrap());
        tokio::io::AsyncBufReadExt::fill_buf(&mut wire.output)
            .await
            .unwrap();
        assert!(
            tokio::time::timeout(Duration::from_millis(100), wire.read())
                .await
                .is_err()
        );
        assert!(!wire.line.is_empty());
        wire.input.write_all(b"release\n").await.unwrap();
        assert_eq!(wire.read().await.unwrap(), json!({"type":"complete"}));
        child.wait().await.unwrap();
    }
    fn session() -> Session {
        serde_json::from_value(json!({"id":"s","projectId":"p","title":"Task","agent":"codex","status":"running","createdAt":"time","lastActivityAt":"time","worktree":{"path":"/fixture","branch":"main","isolated":false},"messages":[],"nativeThread":{"threadId":"native","sessionId":"s","projectId":"p","cwd":"/fixture","model":null}})).unwrap()
    }
    #[tokio::test]
    async fn exact_resume_confirms_approval_profiles_before_sending_input() {
        use crate::models::ApprovalMode;
        let script = r#"
import sys,json
def read(): return json.loads(sys.stdin.readline())
def send(v): print(json.dumps(v),flush=True)
approval,reviewer,sandbox,kind,accepted=sys.argv[1:]
r=read();assert r['method']=='initialize';send({'id':r['id'],'result':{}})
assert read()['method']=='initialized'
r=read();assert r['method']=='thread/resume'
p=r['params'];assert p['threadId']=='native' and p['excludeTurns'] is True
assert (p['approvalPolicy'],p['approvalsReviewer'],p['sandbox'])==(approval,reviewer,sandbox)
send({'id':r['id'],'result':{'thread':{'id':'native'},'cwd':'/fixture','approvalPolicy':approval,'approvalsReviewer':reviewer,'sandbox':{'type':kind if accepted=='true' else 'wrong'}}})
if accepted=='true':
 r=read();assert r['method']=='turn/start';p=r['params']
 assert (p['approvalPolicy'],p['approvalsReviewer'],p['sandboxPolicy']['type'])==(approval,reviewer,kind)
 if kind=='workspaceWrite':
  assert p['sandboxPolicy']['writableRoots']==['/fixture'] and p['sandboxPolicy']['networkAccess'] is False
 assert p['input'][0]['text']=='fixture input'
 send({'id':r['id'],'result':{'turn':{'id':'turn'}}})
 for thread,turn in [('foreign','turn'),('native','stale')]:
  send({'method':'item/started','params':{'threadId':thread,'turnId':turn,'item':{'id':'foreign','type':'commandExecution','status':'inProgress'}}})
 for method,status in [('item/started','inProgress'),('item/completed','completed')]:
  send({'method':method,'params':{'threadId':'native','turnId':'turn','item':{'id':'owned','type':'commandExecution','status':status,'exitCode':0,'command':'private argument'}}})
 send({'method':'turn/completed','params':{'threadId':'native','turn':{'id':'turn','status':'completed'}}})
else:
 assert sys.stdin.readline()==''
"#;
        for mode in [ApprovalMode::Full, ApprovalMode::Ask, ApprovalMode::Auto] {
            for accepted in [true, false] {
                let mut session = session();
                session.execution.approval = Some(mode);
                let (sandbox, approval, reviewer) =
                    crate::execution::codex_policy(&session.execution);
                let kind = if mode == ApprovalMode::Full {
                    "dangerFullAccess"
                } else {
                    "workspaceWrite"
                };
                let mut child = Command::new("python3")
                    .args([
                        "-c",
                        script,
                        approval,
                        reviewer,
                        sandbox,
                        kind,
                        if accepted { "true" } else { "false" },
                    ])
                    .stdin(Stdio::piped())
                    .stdout(Stdio::piped())
                    .kill_on_drop(true)
                    .spawn()
                    .unwrap();
                let mut wire = Wire::new(child.stdin.take().unwrap(), child.stdout.take().unwrap());
                let (_sender, replies) = mpsc::channel(16);
                let (_cancel, mut cancel) = watch::channel(false);
                let mut run = Run {
                    session,
                    cwd: "/fixture".into(),
                    prompt: "fixture input".into(),
                    attachments: Vec::new(),
                    generation: "generation".into(),
                    replies,
                };
                let mut observations = vec![];
                let result = tokio::time::timeout(
                    Duration::from_secs(3),
                    execute(&mut wire, &mut run, &mut cancel, &mut |event| {
                        if let Event::Activity(items) = event {
                            observations.extend(items);
                        }
                        Ok(())
                    }),
                )
                .await
                .unwrap();
                if accepted {
                    assert!(matches!(result, Ok(false)), "{result:?}");
                    // Child observations are display-only; without an owned child row they
                    // must never enter the retained turn. Stale parent turns stay excluded.
                    let mut activity = crate::activity::TurnActivity::new(
                        crate::models::AgentProviderId::Codex,
                        None,
                    );
                    for observed in observations {
                        activity.observe(observed);
                    }
                    assert_eq!(activity.items.len(), 1);
                    assert_eq!(activity.items[0].id, "owned");
                    assert_eq!(
                        activity.items[0].state,
                        crate::activity::ItemState::Completed
                    );
                    // The command's first line is the row's detail (ADR-070); output never is.
                    assert_eq!(activity.items[0].detail, "private argument");
                } else {
                    assert!(result.is_err());
                }
                drop(wire);
                assert!(tokio::time::timeout(Duration::from_secs(3), child.wait())
                    .await
                    .unwrap()
                    .unwrap()
                    .success());
            }
        }
    }
    #[tokio::test]
    #[ignore = "real Codex app-server; existing CLI login, disposable isolated worktree only"]
    async fn live_codex_native_write_and_exact_followup() {
        let repo = crate::git::tests::Repo::new();
        let tree = crate::worktree::create_isolated(
            &repo.cwd(),
            &repo.0.join("workspaces"),
            "codexnative",
            "Native Codex smoke",
            "sirus/{session-name}-{id}",
        )
        .unwrap();
        let mut session = session();
        session.native_thread = None;
        session.worktree = tree.clone();
        session.model = std::env::var("SIRUS_SMOKE_MODEL").ok();
        let prompts = [
            "This is a disposable Sirus Code integration test. Remember the exact phrase SIRUS_NATIVE_REMEMBER_741. Create exactly one file sirus-native.txt in the current workspace containing SIRUS_NATIVE_OK followed by a newline. Do not change other files, use network tools, install dependencies, or read authentication/configuration files. Reply SIRUS_NATIVE_OK.",
            "Without any tools or filesystem access, repeat the exact phrase I asked you to remember in the previous turn. Reply with that phrase only.",
        ];
        let mut first_thread = None;
        for (index, prompt) in prompts.into_iter().enumerate() {
            let (process, mut started) = start(
                session.clone(),
                tree.path.clone(),
                prompt.into(),
                HashMap::new(),
                None,
            )
            .await
            .unwrap();
            let mut run = started.codex.take().unwrap();
            let err = started.child.stderr.take().unwrap();
            let diagnostics = tokio::spawn(async move {
                let mut reader = BufReader::new(err);
                while crate::agent::bounded_line(&mut reader)
                    .await
                    .is_ok_and(|line| line.is_some())
                {}
            });
            let mut wire = Wire {
                input: started.child.stdin.take().unwrap(),
                output: BufReader::new(started.child.stdout.take().unwrap()),
                sequence: 0,
                deferred: Default::default(),
                deferred_bytes: 0,
                line: Vec::new(),
            };
            let mut output = String::new();
            let mut native = None;
            let mut callback = |event| {
                match event {
                    Event::Identity(identity) => native = Some(identity),
                    Event::Delta(text) => output.push_str(&text),
                    Event::Pending(_) => {
                        return Err(Error::agent("Unexpected approval in harmless native smoke"))
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
            cleanup(&mut started.child).await;
            let _ = tokio::time::timeout(Duration::from_secs(2), diagnostics).await;
            assert!(
                matches!(outcome, Ok(Ok(false))),
                "Native Codex turn failed: {outcome:?}; vendor initialization/account data omitted"
            );
            let identity = native.expect("native thread identity");
            if index == 0 {
                first_thread = Some(identity.thread_id.clone());
                assert!(output.contains("SIRUS_NATIVE_OK"));
                assert_eq!(
                    std::fs::read_to_string(
                        std::path::Path::new(&tree.path).join("sirus-native.txt")
                    )
                    .unwrap(),
                    "SIRUS_NATIVE_OK\n"
                );
                assert!(!repo.cwd().join("sirus-native.txt").exists());
            } else {
                assert_eq!(Some(&identity.thread_id), first_thread.as_ref());
                assert!(
                    output.contains("SIRUS_NATIVE_REMEMBER_741"),
                    "Native follow-up did not remember prior turn"
                );
            }
            session.native_thread = Some(identity);
        }
    }

    #[tokio::test]
    #[ignore = "real Codex host approval callback; harmless command is declined"]
    async fn live_codex_declines_native_command_approval() {
        let repo = crate::git::tests::Repo::new();
        let tree = crate::worktree::create_isolated(
            &repo.cwd(),
            &repo.0.join("workspaces"),
            "codexapproval",
            "Codex approval smoke",
            "sirus/{session-name}-{id}",
        )
        .unwrap();
        let mut session = session();
        session.native_thread = None;
        session.worktree = tree.clone();
        let prompt="This is a disposable host-approval integration test. Request one-time host approval using sandbox_permissions=require_escalated to execute exactly /usr/bin/true, with justification: harmless host approval routing test. Do not execute without requesting approval. The host will decline; do not retry or choose alternatives. After denial reply SIRUS_DENIED_OK. Do not read or write files, use network tools, inspect authentication/configuration, or change permissions.";
        let (process, mut started) = start(
            session.clone(),
            tree.path.clone(),
            prompt.into(),
            HashMap::new(),
            None,
        )
        .await
        .unwrap();
        let sender = process.replies.as_ref().unwrap().clone();
        let mut run = started.codex.take().unwrap();
        let mut wire = Wire {
            input: started.child.stdin.take().unwrap(),
            output: BufReader::new(started.child.stdout.take().unwrap()),
            sequence: 0,
            deferred: Default::default(),
            deferred_bytes: 0,
            line: Vec::new(),
        };
        let err = started.child.stderr.take().unwrap();
        let diagnostics = tokio::spawn(async move {
            let mut reader = BufReader::new(err);
            while crate::agent::bounded_line(&mut reader)
                .await
                .is_ok_and(|line| line.is_some())
            {}
        });
        let mut acknowledgements = Vec::new();
        let mut output = String::new();
        let mut callback = |event| {
            match event {
                Event::Pending(pending) => {
                    if !matches!(&pending.kind,PendingRequestKind::Command {command,..} if command.contains("/usr/bin/true"))
                    {
                        return Err(Error::agent("Unexpected native callback in approval test"));
                    }
                    let (result, receiver) = oneshot::channel();
                    sender
                        .try_send(crate::codex::Inbound::Answer(Reply {
                            request: RespondAgentRequest {
                                session_id: session.id.clone(),
                                generation: pending.generation,
                                request_id: pending.request_id,
                                turn_id: pending.turn_id,
                                response: AgentResponse::Approval {
                                    decision: ApprovalDecision::Decline,
                                },
                            },
                            result,
                        }))
                        .map_err(|_| Error::agent("Approval test queue unavailable"))?;
                    acknowledgements.push(receiver);
                }
                Event::Delta(text) => output.push_str(&text),
                _ => {}
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
        cleanup(&mut started.child).await;
        let _ = tokio::time::timeout(Duration::from_secs(2), diagnostics).await;
        assert!(
            matches!(outcome, Ok(Ok(false))),
            "Native declined turn did not complete: {outcome:?}"
        );
        assert!(
            !acknowledgements.is_empty(),
            "Provider did not request native command approval"
        );
        for receiver in acknowledgements {
            assert!(receiver.await.unwrap().is_ok());
        }
        assert!(output.contains("SIRUS_DENIED_OK"));
        assert!(
            !crate::git::status(std::path::Path::new(&tree.path))
                .unwrap()
                .dirty,
            "Declined approval test must not edit workspace"
        );
    }

    #[test]
    fn vendor_resolution_invalidates_pending_callback_before_user_response() {
        let pending = PendingRequest {
            request_id: "opaque".into(),
            generation: "g".into(),
            turn_id: "t".into(),
            item_id: "i".into(),
            kind: PendingRequestKind::FileChange {
                reason: None,
                changes: vec![],
            },
        };
        let mut ledger = PendingLedger {
            session_id: "s".into(),
            generation: "g".into(),
            turn_id: "t".into(),
            requests: [("opaque".into(), (json!(17), pending))].into(),
        };
        assert_eq!(ledger.resolve(&json!(17)).as_deref(), Some("opaque"));
        let request = RespondAgentRequest {
            session_id: "s".into(),
            generation: "g".into(),
            turn_id: "t".into(),
            request_id: "opaque".into(),
            response: AgentResponse::Approval {
                decision: ApprovalDecision::Accept,
            },
        };
        assert!(ledger.take(&request).is_err());
    }
    #[test]
    fn file_approval_requires_reviewable_native_change_details() {
        assert!(pending_kind(
            "item/fileChange/requestApproval",
            &json!({"itemId":"file","reason":"Apply edits"})
        )
        .unwrap()
        .is_none());
    }
    #[test]
    fn response_is_consumed_once_and_bound_to_session_generation_and_turn() {
        let pending = PendingRequest {
            request_id: "opaque".into(),
            generation: "generation".into(),
            turn_id: "turn".into(),
            item_id: "item".into(),
            kind: PendingRequestKind::FileChange {
                reason: None,
                changes: vec![],
            },
        };
        let mut ledger = PendingLedger {
            session_id: "session".into(),
            generation: "generation".into(),
            turn_id: "turn".into(),
            requests: [("opaque".into(), (json!(42), pending))].into(),
        };
        let response = RespondAgentRequest {
            session_id: "session".into(),
            generation: "generation".into(),
            request_id: "opaque".into(),
            turn_id: "turn".into(),
            response: AgentResponse::Approval {
                decision: ApprovalDecision::Decline,
            },
        };
        for field in ["sessionId", "generation", "turnId", "requestId"] {
            let mut raw = serde_json::to_value(&response).unwrap();
            raw[field] = json!("foreign");
            assert!(ledger.take(&serde_json::from_value(raw).unwrap()).is_err());
            assert_eq!(ledger.requests.len(), 1);
        }
        assert_eq!(
            ledger.take(&response).unwrap(),
            (json!(42), json!({"decision":"decline"}))
        );
        assert!(ledger.take(&response).is_err());
    }
    #[test]
    fn resume_refuses_foreign_workspace_session_project_or_model() {
        let original = session();
        assert!(validate_binding(&original, "/fixture").is_ok());
        assert!(validate_binding(&original, "/different").is_err());
        for field in ["sessionId", "projectId", "model", "providerAccountId"] {
            let mut raw = serde_json::to_value(&original).unwrap();
            raw["nativeThread"][field] = json!("foreign");
            let changed: Session = serde_json::from_value(raw).unwrap();
            assert!(validate_binding(&changed, "/fixture").is_err());
        }
    }
    #[test]
    fn approval_is_one_request_only_and_question_answers_match_native_options() {
        let mut pending = PendingRequest {
            request_id: "r".into(),
            generation: "g".into(),
            turn_id: "t".into(),
            item_id: "i".into(),
            kind: PendingRequestKind::Command {
                command: "echo harmless".into(),
                cwd: None,
                reason: None,
            },
        };
        assert_eq!(
            answer(
                &pending,
                &AgentResponse::Approval {
                    decision: ApprovalDecision::Accept
                }
            )
            .unwrap(),
            json!({"decision":"accept"})
        );
        pending.kind = PendingRequestKind::UserInput {
            questions: vec![InputQuestion {
                id: "q".into(),
                header: "Pick".into(),
                question: "Pick one".into(),
                is_other: false,
                is_secret: false,
                options: Some(vec![InputOption {
                    label: "A".into(),
                    description: "Option A".into(),
                }]),
            }],
        };
        let response = |id: &str, value: &str| AgentResponse::UserInput {
            answers: [(id.into(), vec![value.into()])].into(),
        };
        assert_eq!(
            answer(&pending, &response("q", "A")).unwrap(),
            json!({"answers":{"q":{"answers":["A"]}}})
        );
        assert!(answer(&pending, &response("foreign", "A")).is_err());
        assert!(answer(&pending, &response("q", "unoffered")).is_err());
        assert!(answer(
            &pending,
            &AgentResponse::Approval {
                decision: ApprovalDecision::Accept
            }
        )
        .is_err());
    }
}
