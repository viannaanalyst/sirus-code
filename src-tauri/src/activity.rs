//! Read-only turn presentation. Never grants authority or retains raw tool arguments/reasoning.
use crate::models::{AgentProviderId, MessageRole, Session, SessionStatus};
use serde::{Deserialize, Serialize};
use serde_json::Value;

const MAX_ITEMS: usize = 128;
/// Newest steps kept per child; older ones only count toward `hidden_steps`.
const MAX_CHILD_STEPS: usize = 20;
/// Retained child steps across one turn.
const MAX_TURN_STEPS: usize = 400;
/// Child work that arrived before its child row (bounded, oldest dropped).
const MAX_PENDING: usize = 32;
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum ItemKind {
    Read,
    Edit,
    Command,
    Tool,
    Agent,
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum ItemState {
    Running,
    Completed,
    Failed,
    Stopped,
    Unknown,
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ActivityItem {
    pub id: String,
    pub kind: ItemKind,
    pub label: String,
    pub state: ItemState,
    pub model: Option<String>,
    /// Child rows only: native observation window, never inferred from the parent.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub started_at: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ended_at: Option<i64>,
    /// Child rows only: the child's own observed work, with generic labels like the parent's.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub steps: Vec<ActivityStep>,
    #[serde(default, skip_serializing_if = "is_zero")]
    pub hidden_steps: u32,
    /// Live routing only: the native delegation call that owns this child (Claude tool use).
    #[serde(skip)]
    pub source: Option<String>,
    /// Observation routing only: this work belongs to the child identified by `parent`.
    #[serde(skip)]
    pub parent: Option<String>,
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ActivityStep {
    pub id: String,
    pub kind: ItemKind,
    pub label: String,
    pub state: ItemState,
}
fn is_zero(v: &u32) -> bool {
    *v == 0
}
fn settled(state: &ItemState) -> bool {
    matches!(
        state,
        ItemState::Completed | ItemState::Failed | ItemState::Stopped
    )
}
/// A finished child or turn does not establish success for work still shown as running.
fn close_steps(steps: &mut [ActivityStep], stopped: bool) {
    for step in steps {
        if step.state == ItemState::Running {
            step.state = if stopped {
                ItemState::Stopped
            } else {
                ItemState::Unknown
            };
        }
    }
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TurnActivity {
    pub provider: AgentProviderId,
    pub model: Option<String>,
    pub started_at: i64,
    pub ended_at: Option<i64>,
    pub waiting_since: Option<i64>,
    pub paused_ms: i64,
    pub status: SessionStatus,
    pub items: Vec<ActivityItem>,
    pub truncated: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub review: Option<crate::turn_review::TurnReview>,
    #[serde(skip)]
    pending: Vec<ActivityItem>,
}
impl TurnActivity {
    pub fn new(provider: AgentProviderId, model: Option<String>) -> Self {
        Self {
            provider,
            model,
            started_at: now(),
            ended_at: None,
            waiting_since: None,
            paused_ms: 0,
            status: SessionStatus::Starting,
            items: vec![],
            truncated: false,
            review: None,
            pending: vec![],
        }
    }
    fn sync_at(&mut self, status: SessionStatus, at: i64) {
        let at = at.max(self.started_at);
        if self.ended_at.is_some() {
            return;
        }
        if status == SessionStatus::Waiting {
            self.waiting_since.get_or_insert(at);
        } else if let Some(start) = self.waiting_since.take() {
            self.paused_ms = self
                .paused_ms
                .saturating_add(at.saturating_sub(start).max(0));
        }
        if !status.is_active() {
            self.ended_at = Some(at);
            // A parent finishing does NOT establish success for an unfinished child/tool.
            let stopped = status == SessionStatus::Stopped;
            for item in &mut self.items {
                if item.state == ItemState::Running {
                    item.state = if stopped {
                        ItemState::Stopped
                    } else {
                        ItemState::Unknown
                    };
                }
                if item.kind == ItemKind::Agent {
                    item.ended_at.get_or_insert(at);
                    close_steps(&mut item.steps, stopped);
                }
            }
            self.pending.clear();
        }
        self.status = status;
    }
    pub fn observe(&mut self, mut item: ActivityItem) -> bool {
        if self.ended_at.is_some() || item.id.is_empty() || item.id.len() > 256 {
            return false;
        }
        item.label = short(&item.label, 100);
        item.model = item
            .model
            .as_deref()
            .map(|v| short(v, 100))
            .filter(|v| !v.is_empty());
        if let Some(parent) = item.parent.take() {
            return self.observe_step(parent, item);
        }
        // The delegation call that owns a child row is that child, not a separate tool row.
        if item.kind != ItemKind::Agent {
            if let Some(child) = self.items.iter_mut().find(|child| {
                child.kind == ItemKind::Agent && child.source.as_deref() == Some(item.id.as_str())
            }) {
                if child.model.is_none() && item.model.is_some() {
                    child.model = item.model;
                    return true;
                }
                return false;
            }
        }
        if let Some(index) = self.items.iter().position(|old| old.id == item.id) {
            let old = &self.items[index];
            // Update envelopes can omit metadata; retain known nickname/model.
            if item.label.is_empty() {
                item.label.clone_from(&old.label);
                item.kind = old.kind.clone();
            }
            if item.kind != ItemKind::Agent
                && old.state != ItemState::Running
                && old.state != ItemState::Unknown
                && item.state == ItemState::Running
            {
                return false;
            }
            if item.state == ItemState::Unknown {
                item.state = old.state.clone();
            }
            if item.model.is_none() {
                item.model.clone_from(&old.model);
            }
            if item.source.is_none() {
                item.source.clone_from(&old.source);
            }
            item.steps.clone_from(&old.steps);
            item.hidden_steps = old.hidden_steps;
            item.started_at = old.started_at;
            if item.kind == ItemKind::Agent {
                // Children can work again; only a settled native state closes the window.
                item.ended_at = settled(&item.state).then(|| old.ended_at.unwrap_or_else(now));
                if settled(&item.state) {
                    close_steps(&mut item.steps, item.state == ItemState::Stopped);
                }
            }
            if *old == item {
                return false;
            }
            self.items[index] = item;
        } else if self.items.len() < MAX_ITEMS {
            if item.kind == ItemKind::Agent {
                let at = now();
                item.started_at = Some(at);
                item.ended_at = settled(&item.state).then_some(at);
                if let Some(source) = item.source.clone() {
                    if let Some(index) = self.items.iter().position(|old| old.id == source) {
                        let call = self.items.remove(index);
                        if item.model.is_none() {
                            item.model = call.model;
                        }
                    }
                }
                self.items.push(item);
                // Replay child work that arrived before this child row.
                for early in std::mem::take(&mut self.pending) {
                    self.observe(early);
                }
            } else {
                self.items.push(item);
            }
        } else {
            let changed = !self.truncated;
            self.truncated = true;
            return changed;
        }
        true
    }
    fn observe_step(&mut self, parent: String, mut item: ActivityItem) -> bool {
        let retained: usize = self.items.iter().map(|child| child.steps.len()).sum();
        let Some(child) = self.items.iter_mut().find(|child| {
            child.kind == ItemKind::Agent
                && (child.id == parent || child.source.as_deref() == Some(parent.as_str()))
        }) else {
            if self.pending.len() >= MAX_PENDING {
                self.pending.remove(0);
            }
            item.parent = Some(parent);
            self.pending.push(item);
            return false;
        };
        // Nested delegation inside a child is shown as one of its steps, never as a new row.
        let (kind, label) = if item.kind == ItemKind::Agent {
            (ItemKind::Tool, "Delegate task".to_owned())
        } else {
            (item.kind, item.label)
        };
        if let Some(step) = child.steps.iter_mut().find(|step| step.id == item.id) {
            let mut next = step.clone();
            if !label.is_empty() {
                next.label = label;
                next.kind = kind;
            }
            if item.state != ItemState::Unknown
                && !(settled(&step.state) && item.state == ItemState::Running)
            {
                next.state = item.state;
            }
            if *step == next {
                return false;
            }
            *step = next;
            return true;
        }
        // Completions for steps never seen (or already folded away) are not new work.
        if label.is_empty() || (item.state != ItemState::Running && child.hidden_steps > 0) {
            return false;
        }
        if settled(&child.state) {
            return false;
        }
        if retained >= MAX_TURN_STEPS {
            child.hidden_steps = child.hidden_steps.saturating_add(1);
            return true;
        }
        if child.steps.len() >= MAX_CHILD_STEPS {
            child.steps.remove(0);
            child.hidden_steps = child.hidden_steps.saturating_add(1);
        }
        child.steps.push(ActivityStep {
            id: item.id,
            kind,
            label,
            state: item.state,
        });
        true
    }
}
fn now() -> i64 {
    chrono::Utc::now().timestamp_millis()
}
fn short(v: &str, n: usize) -> String {
    v.chars().filter(|c| !c.is_control()).take(n).collect()
}
fn identifier(v: &Value) -> Option<String> {
    v.as_str()
        .filter(|v| !v.is_empty() && v.len() <= 192)
        .map(str::to_owned)
}
fn item(
    id: String,
    kind: ItemKind,
    label: &str,
    state: ItemState,
    model: Option<&str>,
) -> ActivityItem {
    ActivityItem {
        id,
        kind,
        label: short(label, 100),
        state,
        model: model.map(|v| short(v, 100)),
        started_at: None,
        ended_at: None,
        steps: vec![],
        hidden_steps: 0,
        source: None,
        parent: None,
    }
}
fn native_state(v: &Value) -> ItemState {
    match v.as_str() {
        Some("running" | "inProgress" | "in_progress" | "pending") => ItemState::Running,
        Some("completed" | "succeeded") => ItemState::Completed,
        Some("failed" | "errored" | "error") => ItemState::Failed,
        Some("interrupted" | "cancelled" | "killed" | "shutdown") => ItemState::Stopped,
        _ => ItemState::Unknown,
    }
}
pub fn sync(session: &mut Session) {
    let status = session.status.clone();
    session.last_activity_at = chrono::Utc::now().to_rfc3339();
    if let Some(activity) = current(session) {
        activity.sync_at(status, now());
    }
}
fn current(session: &mut Session) -> Option<&mut TurnActivity> {
    session
        .messages
        .iter_mut()
        .rev()
        .find(|m| m.role == MessageRole::Agent)?
        .activity
        .as_mut()
}
/// An interrupted restart closes at the last observed native timestamp, never at reopen time.
pub fn recover(session: &mut Session) {
    let status = session.status.clone();
    let at = chrono::DateTime::parse_from_rfc3339(&session.last_activity_at)
        .ok()
        .map(|v| v.timestamp_millis());
    if let Some(activity) = current(session) {
        activity.sync_at(status, at.unwrap_or(activity.started_at));
    }
}
pub fn observe(session: &mut Session, observation: ActivityItem) -> bool {
    // Claude completion frames can describe shell tasks; only an observed local_agent start owns a child row.
    if session.agent == AgentProviderId::Claude
        && observation.kind == ItemKind::Agent
        && observation.label.is_empty()
        && !current(session).is_some_and(|a| a.items.iter().any(|i| i.id == observation.id))
    {
        return false;
    }
    current(session).is_some_and(|activity| activity.observe(observation))
}
pub fn model(session: &mut Session, model: &str) {
    if let Some(activity) = current(session).filter(|a| a.ended_at.is_none()) {
        if !model.is_empty() && model.len() <= 256 {
            activity.model = Some(short(model, 100));
        }
    }
}
/// Caller already checked parent thread AND active turn. Ignore all raw args, output and reasoning.
pub fn codex(v: &Value, started: bool) -> Vec<ActivityItem> {
    let Some(id) = identifier(&v["id"]) else {
        return vec![];
    };
    let state = if started {
        ItemState::Running
    } else {
        native_state(&v["status"])
    };
    match v["type"].as_str() {
        Some("commandExecution") => {
            let read = v["commandActions"].as_array().is_some_and(|a| {
                !a.is_empty()
                    && a.iter().all(|x| {
                        matches!(x["type"].as_str(), Some("read" | "listFiles" | "search"))
                    })
            });
            vec![item(
                id,
                if read {
                    ItemKind::Read
                } else {
                    ItemKind::Command
                },
                if read { "Read / search" } else { "Command" },
                if !started && v["exitCode"].as_i64().is_some_and(|c| c != 0) {
                    ItemState::Failed
                } else {
                    state
                },
                None,
            )]
        }
        Some("fileChange") => vec![item(id, ItemKind::Edit, "File changes", state, None)],
        Some("mcpToolCall" | "dynamicToolCall") => {
            vec![item(id, ItemKind::Tool, "Tool call", state, None)]
        }
        Some("webSearch") => vec![item(
            id,
            ItemKind::Read,
            "Web search",
            if started { state } else { ItemState::Completed },
            None,
        )],
        Some("subAgentActivity") => {
            let Some(child) = identifier(&v["agentThreadId"]) else {
                return vec![];
            };
            let state = match v["kind"].as_str() {
                Some("started") => ItemState::Running,
                Some("completed") => ItemState::Completed,
                Some("interrupted") => ItemState::Stopped,
                _ => return vec![],
            };
            vec![item(
                format!("agent:{child}"),
                ItemKind::Agent,
                v["agentPath"].as_str().unwrap_or(""),
                state,
                None,
            )]
        }
        Some("collabAgentToolCall") => {
            let mut result = vec![];
            // An actual successful spawn may offer an identity before child lifecycle arrives.
            // The collaboration call finishing does not prove the child is running/completed.
            if !started && v["tool"] == "spawnAgent" && v["status"] == "completed" {
                if let Some(receivers) = v["receiverThreadIds"].as_array().filter(|a| a.len() == 1)
                {
                    if let Some(child) = identifier(&receivers[0]) {
                        result.push(item(
                            format!("agent:{child}"),
                            ItemKind::Agent,
                            "",
                            ItemState::Unknown,
                            v["model"].as_str(),
                        ));
                    }
                }
            }
            // Wait/send bookkeeping does not create a new child. Only explicit child identities.
            if let Some(states) = v["agentsStates"].as_object() {
                for (child, data) in states.iter().take(MAX_ITEMS + 1) {
                    if child.is_empty() || child.len() > 192 {
                        continue;
                    }
                    let name = data["agentNickname"].as_str().unwrap_or("");
                    result.push(item(
                        format!("agent:{child}"),
                        ItemKind::Agent,
                        name,
                        native_state(&data["status"]),
                        data["model"].as_str().or_else(|| {
                            (v["tool"] == "spawnAgent" && states.len() == 1)
                                .then(|| v["model"].as_str())
                                .flatten()
                        }),
                    ));
                }
            }
            result
        }
        _ => vec![],
    }
}
fn tool_kind(name: &str) -> (ItemKind, &'static str) {
    match name {
        "Read" | "Glob" | "Grep" => (ItemKind::Read, "Read / search"),
        "Write" | "Edit" | "MultiEdit" => (ItemKind::Edit, "File changes"),
        "Bash" => (ItemKind::Command, "Command"),
        "Agent" | "Task" => (ItemKind::Tool, "Delegate task"),
        _ => (ItemKind::Tool, "Tool call"),
    }
}
/// Parent tools, local agent tasks and their children's tool steps. Text, reasoning and raw
/// tool arguments are excluded; only a delegation call's model choice is read.
pub fn claude(v: &Value) -> Vec<ActivityItem> {
    // Child messages carry the delegation call that spawned them; their tools become that child's steps.
    let parent = v["parent_tool_use_id"].as_str();
    if parent.is_some() && identifier(&v["parent_tool_use_id"]).is_none() {
        return vec![];
    }
    if parent.is_none()
        && v["type"] == "system"
        && matches!(
            v["subtype"].as_str(),
            Some("task_started" | "task_notification" | "task_updated")
        )
    {
        let Some(id) = identifier(&v["task_id"]) else {
            return vec![];
        };
        if v["subtype"] == "task_started" && v["task_type"] != "local_agent" {
            return vec![];
        }
        let state = if v["subtype"] == "task_started" {
            ItemState::Running
        } else {
            native_state(v.get("status").unwrap_or(&v["patch"]["status"]))
        };
        let mut child = item(
            format!("agent:{id}"),
            ItemKind::Agent,
            if v["subtype"] == "task_started" {
                v["description"].as_str().unwrap_or("Subagent")
            } else {
                ""
            },
            state,
            None,
        );
        child.source = identifier(&v["tool_use_id"]);
        return vec![child];
    }
    let content = if parent.is_none()
        && v["type"] == "stream_event"
        && v["event"]["type"] == "content_block_start"
    {
        vec![&v["event"]["content_block"]]
    } else if matches!(v["type"].as_str(), Some("assistant" | "user")) {
        v["message"]["content"]
            .as_array()
            .map(|a| a.iter().collect())
            .unwrap_or_default()
    } else {
        vec![]
    };
    content
        .into_iter()
        .take(MAX_ITEMS)
        .filter_map(|block| {
            let mut observed = if block["type"] == "tool_use" {
                let name = block["name"].as_str()?;
                let (kind, label) = tool_kind(name);
                // The delegation's model choice names its child; no other input is read.
                let model = matches!(name, "Agent" | "Task")
                    .then(|| block["input"]["model"].as_str())
                    .flatten();
                item(
                    identifier(&block["id"])?,
                    kind,
                    label,
                    ItemState::Running,
                    model,
                )
            } else if block["type"] == "tool_result" {
                item(
                    identifier(&block["tool_use_id"])?,
                    ItemKind::Tool,
                    "",
                    if block["is_error"] == true {
                        ItemState::Failed
                    } else {
                        ItemState::Completed
                    },
                    None,
                )
            } else {
                return None;
            };
            observed.parent = parent.map(str::to_owned);
            Some(observed)
        })
        .collect()
}
/// Items from a child thread the turn spawned become that child's steps; nested children stay inside it.
pub fn codex_child(v: &Value, started: bool, thread: &str) -> Vec<ActivityItem> {
    let Some(thread) = identifier(&Value::from(thread)) else {
        return vec![];
    };
    codex(v, started)
        .into_iter()
        .filter(|observed| observed.kind != ItemKind::Agent)
        .map(|mut observed| {
            observed.parent = Some(format!("agent:{thread}"));
            observed
        })
        .collect()
}
pub fn opencode(v: &Value) -> Vec<ActivityItem> {
    if !matches!(
        v["sessionUpdate"].as_str(),
        Some("tool_call" | "tool_call_update")
    ) {
        return vec![];
    }
    let Some(id) = identifier(&v["toolCallId"]) else {
        return vec![];
    };
    let (kind, label) = match v["kind"].as_str() {
        Some("read" | "search" | "fetch") => (ItemKind::Read, "Read / search"),
        Some("edit" | "delete" | "move") => (ItemKind::Edit, "File changes"),
        Some("execute") => (ItemKind::Command, "Command"),
        // OpenCode reports its `task` delegation as `think`. Only the short description names the
        // child; its prompt is never read, and ACP does not forward the child's own tools.
        Some("think") => (
            ItemKind::Agent,
            v["rawInput"]["description"]
                .as_str()
                .filter(|d| !d.trim().is_empty())
                .unwrap_or("Subagent"),
        ),
        _ => (ItemKind::Tool, "Tool call"),
    };
    vec![item(
        id,
        kind,
        if v["sessionUpdate"] == "tool_call_update" && v["kind"].is_null() {
            ""
        } else {
            label
        },
        native_state(&v["status"]),
        None,
    )]
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    #[test]
    fn clock_pauses_and_finalization_does_not_invent_success() {
        let mut a = TurnActivity::new(AgentProviderId::Codex, None);
        a.started_at = 100;
        a.observe(item(
            "x".into(),
            ItemKind::Agent,
            "Worker",
            ItemState::Running,
            None,
        ));
        a.sync_at(SessionStatus::Waiting, 200);
        a.sync_at(SessionStatus::Waiting, 250);
        a.sync_at(SessionStatus::Running, 400);
        a.sync_at(SessionStatus::Completed, 500);
        assert_eq!(a.paused_ms, 200);
        assert_eq!(a.ended_at, Some(500));
        assert_eq!(a.items[0].state, ItemState::Unknown);
        a.sync_at(SessionStatus::Stopped, 900);
        assert_eq!(a.ended_at, Some(500));
    }
    #[test]
    fn updates_dedupe_keep_metadata_and_bound_retention() {
        let mut a = TurnActivity::new(AgentProviderId::Claude, None);
        a.observe(item(
            "x".into(),
            ItemKind::Read,
            "Read",
            ItemState::Running,
            Some("model"),
        ));
        a.observe(item(
            "x".into(),
            ItemKind::Tool,
            "",
            ItemState::Completed,
            None,
        ));
        assert_eq!(a.items.len(), 1);
        assert_eq!(a.items[0].label, "Read");
        for n in 0..200 {
            a.observe(item(
                n.to_string(),
                ItemKind::Tool,
                "Call",
                ItemState::Running,
                None,
            ));
        }
        assert_eq!(a.items.len(), MAX_ITEMS);
        assert!(a.truncated);
    }
    #[test]
    fn parses_observed_child_states_without_wait_phantom_or_raw_arguments() {
        assert!(codex(
            &json!({"id":"wait","type":"collabAgentToolCall","receiverThreadIds":["x"]}),
            false
        )
        .is_empty());
        let entries = codex(
            &json!({"id":"wait","type":"collabAgentToolCall","model":"m","prompt":"secret","agentsStates":{"x":{"status":"completed","agentNickname":"Review","message":"private"},"y":{"status":"errored"}}}),
            false,
        );
        assert_eq!(entries.len(), 2);
        assert_eq!(entries[0].state, ItemState::Completed);
        let encoded = serde_json::to_string(&entries).unwrap();
        assert!(!encoded.contains("secret"));
        assert!(!encoded.contains("private"));
        assert!(codex(&json!({"id":"r","type":"reasoning","text":"hidden"}), true).is_empty());
    }
    #[test]
    fn claude_top_level_tools_and_local_tasks_only() {
        let v = json!({"type":"stream_event","event":{"type":"content_block_start","content_block":{"type":"tool_use","id":"t","name":"Read","input":{"file_path":"secret"}}}});
        assert_eq!(claude(&v)[0].kind, ItemKind::Read);
        let mut child = v;
        child["parent_tool_use_id"] = json!("parent");
        // Streaming deltas from a child are not observed; complete child messages are.
        assert!(claude(&child).is_empty());
        assert_eq!(claude(&json!({"type":"system","subtype":"task_started","task_id":"a","task_type":"local_agent"}))[0].state, ItemState::Running);
        assert!(claude(
            &json!({"type":"system","subtype":"task_started","task_id":"a","task_type":"shell"})
        )
        .is_empty());
    }

    #[test]
    fn v2_child_activity_and_spawn_identity_are_observed_without_inventing_work() {
        let result = codex(
            &json!({"id":"i","type":"subAgentActivity","agentThreadId":"child","agentPath":"root/review","kind":"started"}),
            true,
        );
        assert_eq!(result[0].state, ItemState::Running);
        assert_eq!(result[0].label, "root/review");
        assert!(codex(&json!({"id":"i","type":"subAgentActivity","agentThreadId":"child","kind":"interacted"}), false).is_empty());
        let result = codex(
            &json!({"id":"i","type":"collabAgentToolCall","tool":"spawnAgent","status":"completed","receiverThreadIds":["child"],"model":"selected"}),
            false,
        );
        assert_eq!(result[0].state, ItemState::Unknown);
        assert_eq!(result[0].model.as_deref(), Some("selected"));
        let mut a = TurnActivity::new(AgentProviderId::Codex, None);
        for observation in result {
            a.observe(observation);
        }
        for kind in ["started", "completed"] {
            let v = serde_json::json!({"id":"activity","type":"subAgentActivity","agentThreadId":"child","agentPath":"Review","kind":kind});
            for started in [true, false] {
                for observation in codex(&v, started) {
                    a.observe(observation);
                }
            }
        }
        assert_eq!(a.items.len(), 1);
        assert_eq!(a.items[0].model.as_deref(), Some("selected"));
        assert_eq!(a.items[0].state, ItemState::Completed);
    }

    #[test]
    fn children_can_work_again_but_wait_models_do_not_overwrite_spawn_metadata() {
        let mut a = TurnActivity::new(AgentProviderId::Codex, None);
        for state in [
            ItemState::Completed,
            ItemState::Running,
            ItemState::Completed,
        ] {
            a.observe(item(
                "agent:x".into(),
                ItemKind::Agent,
                "",
                state.clone(),
                None,
            ));
            assert_eq!(a.items[0].state, state);
        }
        let result = codex(
            &json!({"id":"wait","type":"collabAgentToolCall","tool":"wait","model":"unrelated","agentsStates":{"x":{"status":"running"}}}),
            false,
        );
        assert_eq!(result[0].model, None);
    }

    #[test]
    fn metadata_updates_keep_status_and_finished_tools_ignore_replay() {
        let mut a = TurnActivity::new(AgentProviderId::OpenCode, None);
        a.observe(item(
            "x".into(),
            ItemKind::Read,
            "Read",
            ItemState::Completed,
            None,
        ));
        a.observe(item(
            "x".into(),
            ItemKind::Tool,
            "",
            ItemState::Unknown,
            None,
        ));
        assert_eq!(a.items[0].state, ItemState::Completed);
        assert_eq!(a.items[0].kind, ItemKind::Read);
        a.observe(item(
            "x".into(),
            ItemKind::Read,
            "Read",
            ItemState::Running,
            None,
        ));
        assert_eq!(a.items[0].state, ItemState::Completed);
    }
    #[test]
    fn reload_caps_work_at_last_native_observation_and_ignores_shell_task_completion() {
        let mut s: Session = serde_json::from_value(json!({"id":"s","projectId":"p","title":"Task","agent":"claude","status":"stopped","createdAt":"2020-01-01T00:00:00Z","lastActivityAt":"2020-01-01T00:00:08Z","lastError":null,"worktree":{"path":"/fixture","branch":"main","isolated":false},"messages":[{"id":"m","sessionId":"s","role":"agent","content":"","createdAt":"2020-01-01T00:00:00Z","streaming":false}]})).unwrap();
        let mut a = TurnActivity::new(AgentProviderId::Claude, None);
        a.started_at = 1_577_836_800_000;
        s.messages[0].activity = Some(a);
        recover(&mut s);
        assert_eq!(
            s.messages[0].activity.as_ref().unwrap().ended_at,
            Some(1_577_836_808_000)
        );
        let mut a = TurnActivity::new(AgentProviderId::Claude, None);
        a.status = SessionStatus::Running;
        s.messages[0].activity = Some(a);
        s.status = SessionStatus::Running;
        for i in claude(
            &json!({"type":"system","subtype":"task_notification","task_id":"shell","status":"completed","description":"Shell"}),
        ) {
            observe(&mut s, i);
        }
        assert!(s.messages[0].activity.as_ref().unwrap().items.is_empty());
    }

    #[test]
    fn acp_closed_tools_ignore_thoughts_and_output() {
        assert!(opencode(&json!({"sessionUpdate":"agent_thought_chunk"})).is_empty());
        let items = opencode(
            &json!({"sessionUpdate":"tool_call","toolCallId":"a","kind":"edit","status":"failed","rawInput":{"secret":true}}),
        );
        assert_eq!(items[0].kind, ItemKind::Edit);
        assert_eq!(items[0].state, ItemState::Failed);
    }

    #[test]
    fn claude_children_own_their_steps_and_absorb_the_delegation_call() {
        let mut a = TurnActivity::new(AgentProviderId::Claude, None);
        let call = json!({"type":"assistant","message":{"content":[{"type":"tool_use","id":"call","name":"Agent","input":{"description":"Write tests","prompt":"secret brief","model":"haiku"}}]}});
        for observed in claude(&call) {
            a.observe(observed);
        }
        for observed in claude(
            &json!({"type":"system","subtype":"task_started","task_id":"t1","tool_use_id":"call","description":"Write tests","task_type":"local_agent"}),
        ) {
            a.observe(observed);
        }
        // Child tools arrive as complete messages tagged with the delegation call.
        let read = json!({"type":"assistant","parent_tool_use_id":"call","message":{"content":[{"type":"tool_use","id":"r","name":"Read","input":{"file_path":"/private/key"}}]}});
        let done = json!({"type":"user","parent_tool_use_id":"call","message":{"content":[{"type":"tool_result","tool_use_id":"r","content":"private output"}]}});
        for observed in claude(&read).into_iter().chain(claude(&done)) {
            assert!(a.observe(observed));
        }
        // The call's own result is the child's, not a new tool row.
        for observed in claude(
            &json!({"type":"user","message":{"content":[{"type":"tool_result","tool_use_id":"call"}]}}),
        ) {
            a.observe(observed);
        }
        assert_eq!(a.items.len(), 1);
        let child = &a.items[0];
        assert_eq!(child.kind, ItemKind::Agent);
        assert_eq!(child.label, "Write tests");
        assert_eq!(child.model.as_deref(), Some("haiku"));
        assert!(child.started_at.is_some());
        assert_eq!(child.steps.len(), 1);
        assert_eq!(child.steps[0].kind, ItemKind::Read);
        assert_eq!(child.steps[0].state, ItemState::Completed);
        let encoded = serde_json::to_string(&a).unwrap();
        for secret in [
            "secret brief",
            "/private/key",
            "private output",
            "\"source\"",
            "\"parent\"",
        ] {
            assert!(!encoded.contains(secret), "{secret}");
        }
        for observed in claude(
            &json!({"type":"system","subtype":"task_notification","task_id":"t1","status":"completed"}),
        ) {
            a.observe(observed);
        }
        assert_eq!(a.items[0].state, ItemState::Completed);
        assert!(a.items[0].ended_at.is_some());
    }

    #[test]
    fn opencode_task_delegation_is_a_child_row_without_its_prompt() {
        let mut a = TurnActivity::new(AgentProviderId::OpenCode, None);
        let start = json!({"sessionUpdate":"tool_call","toolCallId":"t","kind":"think","status":"pending","title":"task","rawInput":{"description":"List txt files","prompt":"secret brief","subagent_type":"explore"}});
        let done = json!({"sessionUpdate":"tool_call_update","toolCallId":"t","status":"completed","rawOutput":{"output":"private"}});
        for observed in opencode(&start).into_iter().chain(opencode(&done)) {
            a.observe(observed);
        }
        assert_eq!(a.items.len(), 1);
        assert_eq!(a.items[0].kind, ItemKind::Agent);
        assert_eq!(a.items[0].label, "List txt files");
        assert_eq!(a.items[0].state, ItemState::Completed);
        assert!(a.items[0].ended_at.is_some());
        let encoded = serde_json::to_string(&a).unwrap();
        assert!(!encoded.contains("secret brief") && !encoded.contains("private"));
    }
    #[test]
    fn child_steps_are_bounded_and_settle_with_the_turn() {
        let mut a = TurnActivity::new(AgentProviderId::Codex, None);
        a.observe(item(
            "agent:c".into(),
            ItemKind::Agent,
            "Worker",
            ItemState::Running,
            None,
        ));
        for n in 0..(MAX_CHILD_STEPS + 10) {
            let v = json!({"id":format!("s{n}"),"type":"fileChange","status":"inProgress"});
            for observed in codex_child(&v, true, "c") {
                a.observe(observed);
            }
        }
        assert_eq!(a.items[0].steps.len(), MAX_CHILD_STEPS);
        assert_eq!(a.items[0].hidden_steps, 10);
        assert_eq!(a.items[0].steps[0].id, "s10");
        // A completion for a folded-away step does not come back as new work.
        let old = json!({"id":"s0","type":"fileChange","status":"completed"});
        for observed in codex_child(&old, false, "c") {
            assert!(!a.observe(observed));
        }
        a.sync_at(SessionStatus::Stopped, a.started_at + 10);
        let child = &a.items[0];
        assert_eq!(child.state, ItemState::Stopped);
        assert!(child.ended_at.is_some());
        assert!(child
            .steps
            .iter()
            .all(|step| step.state == ItemState::Stopped));
    }

    #[test]
    fn codex_child_work_waits_for_its_row_and_nested_children_stay_inside() {
        let mut a = TurnActivity::new(AgentProviderId::Codex, None);
        let early = json!({"id":"cmd","type":"commandExecution","status":"inProgress","command":"cat secret"});
        for observed in codex_child(&early, true, "child") {
            assert!(!a.observe(observed));
        }
        assert!(a.items.is_empty());
        let nested = json!({"id":"spawn","type":"collabAgentToolCall","tool":"spawnAgent","status":"completed","receiverThreadIds":["grandchild"]});
        assert!(codex_child(&nested, false, "child").is_empty());
        for observed in codex(
            &json!({"id":"i","type":"subAgentActivity","agentThreadId":"child","agentPath":"Review","kind":"started"}),
            true,
        ) {
            a.observe(observed);
        }
        assert_eq!(a.items.len(), 1);
        assert_eq!(a.items[0].steps.len(), 1);
        assert_eq!(a.items[0].steps[0].kind, ItemKind::Command);
        assert!(!serde_json::to_string(&a).unwrap().contains("cat secret"));
        // Work from a thread that never became a child row is never shown.
        for observed in codex_child(&early, true, "stranger") {
            assert!(!a.observe(observed));
        }
        assert_eq!(a.items.len(), 1);
    }
}
