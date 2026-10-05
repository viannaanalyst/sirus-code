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
        command.args(["--allowedTools", "mcp__switchyard_browser"]);
        // Computer tools are gated by the app's per-app approval, not per call.
        if crate::computer_mcp::endpoint(&session.id).is_some() {
            command.args(["--allowedTools", "mcp__switchyard_computer"]);
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
fn tool_kind(request: &Value) -> Option<PendingRequestKind> {
    let name = request["tool_name"].as_str()?;
    // Built-in reviewable tools only. Questions, secrets, grants, auth, config and MCP callbacks are unsupported.
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

pub(crate) async fn execute(
    wire: &mut Wire,
    run: &mut Run,
    cancel: &mut watch::Receiver<bool>,
    emit: &mut impl FnMut(Event) -> Result<()>,
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
    let mut pending: HashMap<String, (String, PendingRequest)> = HashMap::new();
    let mut seen = std::collections::HashSet::new();
    let mut identity = None;
    let mut text = Text::default();
    let mut interrupted = false;
    // `rate_limit_event` refused requests (no extra usage paying): the reset, when reported.
    let mut usage_limit: Option<Option<i64>> = None;
    let mut deadline = None;
    // Instructions steered into this turn that Claude has not echoed back yet.
    let mut unread_steers: Vec<String> = vec![];
    loop {
        let value = tokio::select! {
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
                        if sent.is_ok() {unread_steers.push(text);}
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
                if let Some(echoed) = value["message"]["content"]
                    .as_array()
                    .and_then(|blocks| blocks.iter().find(|block| block["type"] == "text"))
                    .and_then(|block| block["text"].as_str())
                {
                    if let Some(index) = unread_steers.iter().position(|steer| steer == echoed) {
                        unread_steers.remove(index);
                    }
                }
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
                return Ok(false);
            }
            _ => {
                if let Some(chunk) = text.parse(&value)? {
                    emit(Event::Delta(chunk))?;
                }
            }
        }
    }
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
    fn rejects_secret_questions_and_permission_mutation_tools() {
        for name in ["AskUserQuestion", "ExitPlanMode", "mcp__auth", "unknown"] {
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
                let result = execute(&mut wire, &mut run, &mut cancel, &mut |_| Ok(())).await;
                assert_eq!(result.is_ok(), accepted);
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
                        && !matches!(&pending.kind,PendingRequestKind::Tool{name,input,..} if name=="Write" && input["file_path"].as_str().is_some_and(|path|path.ends_with("/switchyard-claude.txt")))
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
            "switchyard/{session-name}-{id}",
        )
        .unwrap();
        let mut session = session(&tree.path);
        let (native,output,approvals)=live_turn(&session,"This is a disposable integration test. Remember the exact phrase SWITCHYARD_CLAUDE_REMEMBER_751. Use only the Write tool to create exactly one file switchyard-claude.txt in the current workspace containing SWITCHYARD_CLAUDE_OK followed by a newline. Do not read other files, run shell commands, use network tools, install anything, or inspect configuration/authentication. Reply SWITCHYARD_CLAUDE_OK.",true).await;
        assert!(approvals > 0);
        assert!(output.contains("SWITCHYARD_CLAUDE_OK"));
        assert_eq!(
            std::fs::read_to_string(std::path::Path::new(&tree.path).join("switchyard-claude.txt"))
                .unwrap(),
            "SWITCHYARD_CLAUDE_OK\n"
        );
        assert!(!repo.cwd().join("switchyard-claude.txt").exists());
        session.native_thread = Some(native.clone());
        let (resumed,output,_)=live_turn(&session,"Without tools or filesystem access, repeat the exact phrase I asked you to remember in the previous turn. Reply with that phrase only.",false).await;
        assert_eq!(native.thread_id, resumed.thread_id);
        assert!(output.contains("SWITCHYARD_CLAUDE_REMEMBER_751"));
    }
    #[tokio::test]
    #[ignore = "real existing Claude CLI login; native host tool denial"]
    async fn live_claude_declines_native_write() {
        let repo = crate::git::tests::Repo::new();
        let mut session = session(&repo.cwd().to_string_lossy());
        session.worktree.path = repo.cwd().to_string_lossy().into();
        let (_,output,approvals)=live_turn(&session,"This is a disposable approval test. Request the Write tool to create denied.txt in the current workspace with the word harmless. The host will decline. Do not retry or use alternatives. After denial reply SWITCHYARD_CLAUDE_DENIED_OK. Do not read other files, use shell/network tools, inspect authentication/configuration, or change permissions.",false).await;
        assert!(approvals > 0);
        assert!(!repo.cwd().join("denied.txt").exists());
        assert!(output.contains("SWITCHYARD_CLAUDE_DENIED_OK"));
    }
}
