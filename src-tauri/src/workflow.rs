//! Claude workflows (ADR-115). A workflow run is a task with
//! `task_type: "local_workflow"`; each `task_progress` of it carries a full
//! `workflow_progress` snapshot of its phases and member agents. Snapshots are merged so a
//! late or partial frame never moves a member backwards or drops a phase. A running member's
//! answer so far is read from its own transcript (`LiveTranscripts`).
use crate::activity::ActivityItem;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

const MAX_PHASES: usize = 64;
const MAX_AGENTS: usize = 256;
const MAX_LABEL: usize = 120;
const MAX_RESULT: usize = 400;

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Workflow {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    #[serde(default)]
    pub phases: Vec<Phase>,
    #[serde(default)]
    pub agents: Vec<Agent>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Phase {
    pub index: u32,
    pub title: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Agent {
    pub index: u32,
    pub label: String,
    /// `queued`, `running`, `completed` or `failed`.
    pub state: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub phase_index: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub model: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub attempt: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tokens: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tool_calls: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub duration_ms: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub result: Option<String>,
    /// The member's own id, which names its transcript (`agent-<id>.jsonl`). Never sent or kept.
    #[serde(skip)]
    pub agent_id: Option<String>,
    /// While it runs: the end of its latest answer so far, read from its own transcript. Live
    /// only (sent to the renderer, never written to a transcript file); the result replaces it.
    #[serde(
        default,
        skip_deserializing,
        skip_serializing_if = "crate::activity::live_only"
    )]
    pub partial: Option<String>,
}

fn short(text: &str, limit: usize) -> String {
    text.chars().take(limit).collect()
}

fn count(value: &Value) -> Option<u64> {
    value.as_u64().filter(|n| *n <= 9_007_199_254_740_991)
}

/// `queued→queued`, `start→running`, `done→completed`, `error→failed`. Unknown states read as
/// running: a wrong "running" corrects itself on the next frame, a wrong "completed" would not.
fn state(value: &Value) -> &'static str {
    match value.as_str() {
        Some("queued") => "queued",
        Some("done") => "completed",
        Some("error") => "failed",
        _ => "running",
    }
}

/// The snapshot in a `task_progress` frame; `None` when the frame has none.
pub fn snapshot(frame: &Value) -> Option<Workflow> {
    let entries = frame["workflow_progress"]
        .as_array()
        .filter(|entries| !entries.is_empty())?;
    let mut workflow = Workflow::default();
    for entry in entries {
        let Some(index) = entry["index"].as_u64().and_then(|n| u32::try_from(n).ok()) else {
            continue;
        };
        match entry["type"].as_str() {
            Some("workflow_phase") if workflow.phases.len() < MAX_PHASES => {
                if let Some(title) = entry["title"].as_str() {
                    workflow.phases.push(Phase {
                        index,
                        title: short(title, MAX_LABEL),
                    });
                }
            }
            Some("workflow_agent") if workflow.agents.len() < MAX_AGENTS => {
                let Some(label) = entry["label"].as_str() else {
                    continue;
                };
                workflow.agents.push(Agent {
                    index,
                    label: short(label, MAX_LABEL),
                    state: state(&entry["state"]).into(),
                    phase_index: entry["phaseIndex"]
                        .as_u64()
                        .and_then(|n| u32::try_from(n).ok()),
                    model: entry["model"].as_str().map(|model| short(model, MAX_LABEL)),
                    attempt: entry["attempt"]
                        .as_u64()
                        .and_then(|n| u32::try_from(n).ok()),
                    tokens: count(&entry["tokens"]),
                    tool_calls: count(&entry["toolCalls"]),
                    duration_ms: count(&entry["durationMs"]),
                    result: entry["resultPreview"]
                        .as_str()
                        .map(|text| short(text, MAX_RESULT)),
                    agent_id: entry["agentId"]
                        .as_str()
                        .filter(|id| valid_agent_id(id))
                        .map(str::to_owned),
                    partial: None,
                });
            }
            _ => {}
        }
    }
    Some(workflow)
}

fn settled(state: &str) -> bool {
    matches!(state, "completed" | "failed")
}

/// Merges a new snapshot into what is known: phases are only added; a member never goes
/// back (finished to anything else, running to queued) unless a new attempt restarted it,
/// and a stale attempt is dropped.
pub fn merge(prior: &Workflow, next: Workflow) -> Workflow {
    let mut merged = prior.clone();
    if next.name.is_some() {
        merged.name = next.name;
    }
    for phase in next.phases {
        if let Some(known) = merged
            .phases
            .iter_mut()
            .find(|known| known.index == phase.index)
        {
            *known = phase;
        } else if merged.phases.len() < MAX_PHASES {
            merged.phases.push(phase);
        }
    }
    for agent in next.agents {
        let Some(known) = merged
            .agents
            .iter_mut()
            .find(|known| known.index == agent.index)
        else {
            if merged.agents.len() < MAX_AGENTS {
                merged.agents.push(agent);
            }
            continue;
        };
        let attempt = agent.attempt.unwrap_or(1);
        let previous = known.attempt.unwrap_or(1);
        if attempt < previous {
            continue;
        }
        let restarted = attempt > previous;
        let regressed = !restarted
            && ((settled(&known.state) && agent.state != known.state)
                || (known.state == "running" && agent.state == "queued"));
        if regressed {
            continue;
        }
        let phase_index = if restarted { known.phase_index } else { None };
        let result = agent.result.clone().or(known.result.take());
        // The answer so far lasts while the same attempt runs; the result replaces it.
        let partial = if restarted || agent.state != "running" {
            None
        } else {
            agent.partial.clone().or(known.partial.take())
        };
        let agent_id = agent.agent_id.clone().or(known.agent_id.take());
        *known = Agent {
            phase_index: agent.phase_index.or(phase_index).or(known.phase_index),
            result,
            partial,
            agent_id,
            ..agent
        };
    }
    merged.phases.sort_by_key(|phase| phase.index);
    merged.agents.sort_by_key(|agent| agent.index);
    merged
}

/// A running member re-reads its transcript at most this often (snapshots arrive about every
/// 12 seconds, and only they trigger a read).
pub(crate) const LIVE_READ_INTERVAL: Duration = Duration::from_secs(10);
/// Bytes read from the end of a member's transcript.
const TRANSCRIPT_TAIL: u64 = 64 * 1024;
/// Characters of the answer so far that are shown (its end).
const MAX_PARTIAL: usize = 600;
/// Workflow runs and running members tracked per turn.
const MAX_RUNS: usize = 16;
const MAX_TRACKED: usize = MAX_AGENTS * 2;
/// Transcripts read per snapshot; the rest wait for the next one.
const MAX_READS: usize = 8;

/// A member id names a file, so it is a plain token.
fn valid_agent_id(id: &str) -> bool {
    (1..=128).contains(&id.len())
        && id
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_'))
}

#[derive(Debug, PartialEq, Eq)]
enum Due {
    Read,
    Wait,
    /// A new attempt: its window starts now, with nothing read yet.
    Restart,
}

/// Whether a running member's transcript is read now, given its last read and attempt.
fn due(last: Option<&(Instant, u32)>, attempt: u32, now: Instant) -> Due {
    match last {
        None => Due::Read,
        Some((_, known)) if attempt > *known => Due::Restart,
        Some((at, known)) if attempt < *known || now.duration_since(*at) < LIVE_READ_INTERVAL => {
            Due::Wait
        }
        Some(_) => Due::Read,
    }
}

/// Where a member's transcript is: `agent-<id>.jsonl` in the run's transcript folder. Nothing
/// is opened here; `read_partial` keeps the read inside the Claude config folder.
fn transcript_path(dir: &str, agent_id: &str) -> Option<PathBuf> {
    let dir = Path::new(dir);
    (dir.is_absolute() && valid_agent_id(agent_id))
        .then(|| dir.join(format!("agent-{agent_id}.jsonl")))
}

/// The latest assistant answer in transcript lines. Lines of one API message share a
/// `message.id` and join into one answer; `isMeta` lines and a line cut by the tail read are
/// skipped. Masked and bounded to its last `MAX_PARTIAL` characters.
fn latest_answer(contents: &str) -> Option<String> {
    let mut latest: Option<(Option<String>, String)> = None;
    for line in contents.lines() {
        let Ok(entry) = serde_json::from_str::<Value>(line) else {
            continue;
        };
        if entry["type"] != "assistant" || entry["isMeta"] == true {
            continue;
        }
        let Some(blocks) = entry["message"]["content"].as_array() else {
            continue;
        };
        let body = blocks
            .iter()
            .filter(|block| block["type"] == "text")
            .filter_map(|block| block["text"].as_str())
            .filter(|text| !text.trim().is_empty())
            .collect::<Vec<_>>()
            .join("\n\n");
        if body.is_empty() {
            continue;
        }
        let id = entry["message"]["id"].as_str().map(str::to_owned);
        match latest.as_mut() {
            Some((known, text)) if id.is_some() && *known == id => {
                text.push_str("\n\n");
                text.push_str(&body);
            }
            _ => latest = Some((id, body)),
        }
    }
    let text = crate::redact::mask(latest?.1.trim()).into_owned();
    let count = text.chars().count();
    Some(if count > MAX_PARTIAL {
        let end: String = text.chars().skip(count - MAX_PARTIAL + 1).collect();
        format!("…{}", end.trim_start())
    } else {
        text
    })
}

/// Reads the end of a member's transcript, only when the resolved file is a regular `.jsonl`
/// inside `root` (the Claude config folder's `projects`), without following a final link.
fn read_partial(root: &Path, path: &Path) -> Option<String> {
    use std::io::{Read, Seek, SeekFrom};
    let resolved = crate::paths::ensure_within(root, path).ok()?;
    if resolved.extension().and_then(|ext| ext.to_str()) != Some("jsonl") {
        return None;
    }
    let mut file = crate::paths::open_regular_within(root, &resolved).ok()?;
    let start = file.metadata().ok()?.len().saturating_sub(TRANSCRIPT_TAIL);
    file.seek(SeekFrom::Start(start)).ok()?;
    let mut bytes = Vec::new();
    file.take(TRANSCRIPT_TAIL).read_to_end(&mut bytes).ok()?;
    // A tail starts mid-line (maybe mid-character): drop that first line.
    let whole = if start > 0 {
        bytes
            .iter()
            .position(|byte| *byte == b'\n')
            .map_or(&[][..], |at| &bytes[at + 1..])
    } else {
        &bytes[..]
    };
    latest_answer(&String::from_utf8_lossy(whole))
}

/// What a running workflow member has answered so far, read from its own transcript (the
/// member streams nothing else). Driven only by the frames of the turn that runs the workflow;
/// each member is read at most every `LIVE_READ_INTERVAL` while it runs, and never outside
/// `<Claude config folder>/projects`.
pub(crate) struct LiveTranscripts {
    root: Option<PathBuf>,
    /// Workflow task id → the tool call that launched it.
    calls: HashMap<String, String>,
    /// Launching tool call → the run's transcript folder, as the launch acknowledgement reports.
    dirs: HashMap<String, String>,
    /// (workflow task, member index) → last read (or restart) and its attempt.
    reads: HashMap<(String, u32), (Instant, u32)>,
}

impl LiveTranscripts {
    /// `config_dir` is the folder the session's Claude CLI uses (`CLAUDE_CONFIG_DIR` or
    /// `~/.claude`); without one nothing is ever read.
    pub(crate) fn new(config_dir: Option<PathBuf>) -> Self {
        Self {
            root: config_dir.map(|dir| dir.join("projects")),
            calls: HashMap::new(),
            dirs: HashMap::new(),
            reads: HashMap::new(),
        }
    }

    /// Learns a workflow's launching call (`task_started`) and transcript folder (the launch
    /// acknowledgement's `tool_use_result`, the only place the CLI reports it).
    fn learn(&mut self, frame: &Value) {
        if !frame["parent_tool_use_id"].is_null() {
            return;
        }
        if crate::activity::is_workflow_task(frame) {
            if let (Some(task), Some(call)) =
                (frame["task_id"].as_str(), frame["tool_use_id"].as_str())
            {
                if self.calls.len() < MAX_RUNS {
                    self.calls.insert(task.into(), call.into());
                }
            }
        } else if frame["type"] == "user"
            && frame["tool_use_result"]["taskType"] == "local_workflow"
        {
            let dir = frame["tool_use_result"]["transcriptDir"]
                .as_str()
                .filter(|dir| dir.len() <= 4096 && Path::new(dir).is_absolute());
            let call = frame["message"]["content"].as_array().and_then(|blocks| {
                blocks
                    .iter()
                    .find(|block| block["type"] == "tool_result")
                    .and_then(|block| block["tool_use_id"].as_str())
            });
            if let (Some(dir), Some(call)) = (dir, call) {
                if self.dirs.len() < MAX_RUNS || self.dirs.contains_key(call) {
                    self.dirs.insert(call.into(), dir.into());
                }
            }
        }
    }

    /// The reads a snapshot makes due: (row, member index, transcript path). Members that are
    /// not running stop being tracked; a restarted member starts a fresh window.
    fn plan(&mut self, items: &[ActivityItem], now: Instant) -> Vec<(usize, u32, PathBuf)> {
        let mut planned = vec![];
        for (row, item) in items.iter().enumerate() {
            let Some(workflow) = item.workflow.as_ref() else {
                continue;
            };
            let Some(task) = item.id.strip_prefix("agent:") else {
                continue;
            };
            let call = item
                .source
                .as_deref()
                .or(self.calls.get(task).map(String::as_str));
            let dir = call.and_then(|call| self.dirs.get(call));
            for agent in &workflow.agents {
                let key = (task.to_owned(), agent.index);
                if agent.state != "running" {
                    self.reads.remove(&key);
                    continue;
                }
                let (Some(dir), Some(id)) = (dir, agent.agent_id.as_deref()) else {
                    continue;
                };
                let attempt = agent.attempt.unwrap_or(1);
                match due(self.reads.get(&key), attempt, now) {
                    Due::Wait => continue,
                    Due::Restart => {
                        self.reads.insert(key, (now, attempt));
                        continue;
                    }
                    Due::Read => {}
                }
                if planned.len() >= MAX_READS
                    || (self.reads.len() >= MAX_TRACKED && !self.reads.contains_key(&key))
                {
                    continue;
                }
                if let Some(path) = transcript_path(dir, id) {
                    self.reads.insert(key, (now, attempt));
                    planned.push((row, agent.index, path));
                }
            }
        }
        planned
    }

    /// Adds the answers so far of running members to this frame's workflow rows. Reads happen
    /// off the async runtime and only for the members `plan` made due.
    pub(crate) async fn refresh(&mut self, frame: &Value, items: &mut [ActivityItem]) {
        self.learn(frame);
        let Some(root) = self.root.clone() else {
            return;
        };
        let planned = self.plan(items, Instant::now());
        if planned.is_empty() {
            return;
        }
        let Ok(answers) = tokio::task::spawn_blocking(move || {
            planned
                .into_iter()
                .filter_map(|(row, index, path)| {
                    read_partial(&root, &path).map(|text| (row, index, text))
                })
                .collect::<Vec<_>>()
        })
        .await
        else {
            return;
        };
        for (row, index, text) in answers {
            let agent = items
                .get_mut(row)
                .and_then(|item| item.workflow.as_mut())
                .and_then(|workflow| workflow.agents.iter_mut().find(|a| a.index == index));
            if let Some(agent) = agent {
                agent.partial = Some(text);
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn frame(agents: Value) -> Value {
        json!({"type":"system","subtype":"task_progress","task_id":"w1","workflow_progress": agents})
    }

    #[test]
    fn snapshots_read_phases_and_members_with_bounded_fields() {
        let workflow = snapshot(&frame(json!([
            {"type":"workflow_phase","index":1,"title":"Alpha"},
            {"type":"workflow_agent","index":1,"label":"alpha:one","state":"start","phaseIndex":1,"model":"claude-opus-5","attempt":2,"tokens":71141,"toolCalls":3,"durationMs":1277,"resultPreview":"A1"},
            {"type":"workflow_agent","index":2,"label":"alpha:two","state":"mystery"},
            {"type":"workflow_agent","label":"no index"}
        ])))
        .unwrap();
        assert_eq!(
            workflow.phases,
            vec![Phase {
                index: 1,
                title: "Alpha".into()
            }]
        );
        assert_eq!(workflow.agents.len(), 2);
        assert_eq!(workflow.agents[0].state, "running");
        assert_eq!(workflow.agents[0].tokens, Some(71141));
        assert_eq!(
            workflow.agents[1].state, "running",
            "unknown reads as running"
        );
        assert!(snapshot(&json!({"type":"system","subtype":"task_progress","usage":{}})).is_none());
    }

    #[test]
    fn a_workflow_task_becomes_a_child_row_that_merges_its_snapshots() {
        let start = json!({"type":"system","subtype":"task_started","task_id":"w1","tool_use_id":"call","description":"Review","task_type":"local_workflow","workflow_name":"probe-wf"});
        assert!(crate::activity::is_workflow_task(&start));
        let mut activity =
            crate::activity::TurnActivity::new(crate::models::AgentProviderId::Claude, None);
        for item in crate::activity::claude(&start) {
            activity.observe(item);
        }
        let progress = frame(json!([
            {"type":"workflow_phase","index":1,"title":"Alpha"},
            {"type":"workflow_agent","index":1,"label":"one","state":"done","phaseIndex":1}
        ]));
        for item in crate::activity::claude(&progress) {
            activity.observe(item);
        }
        let later =
            frame(json!([{"type":"workflow_agent","index":1,"label":"one","state":"start"}]));
        for item in crate::activity::claude(&later) {
            activity.observe(item);
        }
        let row = &activity.items[0];
        assert_eq!(row.label, "probe-wf");
        let workflow = row.workflow.as_ref().unwrap();
        assert_eq!(workflow.phases.len(), 1);
        assert_eq!(workflow.agents[0].state, "completed");
    }

    #[test]
    fn merging_never_moves_members_back_or_drops_phases() {
        let first = snapshot(&frame(json!([
            {"type":"workflow_phase","index":1,"title":"Alpha"},
            {"type":"workflow_phase","index":2,"title":"Beta"},
            {"type":"workflow_agent","index":1,"label":"one","state":"done","phaseIndex":1,"resultPreview":"ok"},
            {"type":"workflow_agent","index":2,"label":"two","state":"start","phaseIndex":2}
        ])))
        .unwrap();
        let late = snapshot(&frame(json!([
            {"type":"workflow_phase","index":1,"title":"Alpha"},
            {"type":"workflow_agent","index":1,"label":"one","state":"start"},
            {"type":"workflow_agent","index":2,"label":"two","state":"queued"},
            {"type":"workflow_agent","index":3,"label":"three","state":"queued"}
        ])))
        .unwrap();
        let merged = merge(&first, late);
        assert_eq!(merged.phases.len(), 2, "a phase is never dropped");
        assert_eq!(
            merged.agents[0].state, "completed",
            "a finished member stays finished"
        );
        assert_eq!(
            merged.agents[1].state, "running",
            "running never goes back to queued"
        );
        assert_eq!(merged.agents[2].state, "queued");
        let retry = snapshot(&frame(json!([
            {"type":"workflow_agent","index":1,"label":"one","state":"start","attempt":2}
        ])))
        .unwrap();
        let merged = merge(&merged, retry);
        assert_eq!(
            merged.agents[0].state, "running",
            "a new attempt restarts it"
        );
        assert_eq!(merged.agents[0].phase_index, Some(1), "and keeps its phase");
        let stale = snapshot(&frame(json!([
            {"type":"workflow_agent","index":1,"label":"one","state":"error","attempt":1}
        ])))
        .unwrap();
        assert_eq!(
            merge(&merged, stale).agents[0].state,
            "running",
            "a stale attempt is dropped"
        );
    }

    fn line(id: &str, text: &str) -> String {
        json!({"type":"assistant","message":{"role":"assistant","id":id,"content":[{"type":"text","text":text}]}}).to_string() + "\n"
    }

    #[test]
    fn transcript_paths_are_named_by_a_plain_member_id_in_an_absolute_folder() {
        assert_eq!(
            transcript_path("/c/projects/wf", "a1"),
            Some(PathBuf::from("/c/projects/wf/agent-a1.jsonl"))
        );
        assert_eq!(transcript_path("relative/wf", "a1"), None);
        for id in ["", "../x", "a/b", "a.b", &"x".repeat(129)] {
            assert_eq!(transcript_path("/c/projects/wf", id), None, "{id}");
        }
        let workflow = snapshot(&frame(json!([
            {"type":"workflow_agent","index":1,"label":"one","state":"start","agentId":"a1"},
            {"type":"workflow_agent","index":2,"label":"two","state":"start","agentId":"../../etc"}
        ])))
        .unwrap();
        assert_eq!(workflow.agents[0].agent_id.as_deref(), Some("a1"));
        assert_eq!(workflow.agents[1].agent_id, None);
    }

    #[test]
    fn reads_stay_inside_the_config_folder_and_never_follow_links_out() {
        let config = tempfile::tempdir().unwrap();
        let outside = tempfile::tempdir().unwrap();
        let root = config.path().join("projects");
        let dir = root.join("wf");
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("agent-a1.jsonl"), line("m1", "inside")).unwrap();
        std::fs::write(outside.path().join("agent-a2.jsonl"), line("m1", "outside")).unwrap();
        std::fs::write(dir.join("agent-a3.txt"), line("m1", "wrong kind")).unwrap();
        assert_eq!(
            read_partial(&root, &dir.join("agent-a1.jsonl")).as_deref(),
            Some("inside")
        );
        assert_eq!(
            read_partial(&root, &outside.path().join("agent-a2.jsonl")),
            None
        );
        assert_eq!(
            read_partial(&root, &dir.join("../../../agent-a2.jsonl")),
            None
        );
        assert_eq!(read_partial(&root, &dir.join("agent-a3.txt")), None);
        assert_eq!(read_partial(&root, &dir.join("missing.jsonl")), None);
        #[cfg(unix)]
        {
            std::os::unix::fs::symlink(
                outside.path().join("agent-a2.jsonl"),
                dir.join("agent-a4.jsonl"),
            )
            .unwrap();
            assert_eq!(read_partial(&root, &dir.join("agent-a4.jsonl")), None);
        }
    }

    #[test]
    fn the_tail_yields_the_latest_answer_bounded_and_masked() {
        let mut contents = String::from("{\"type\":\"assistant\",\"message\":{\"id\":\"cut");
        contents.push('\n');
        contents += &line("m1", "First turn");
        contents += &json!({"type":"assistant","isMeta":true,"message":{"id":"meta","content":[{"type":"text","text":"bookkeeping"}]}}).to_string();
        contents.push('\n');
        contents +=
            &json!({"type":"user","message":{"content":[{"type":"text","text":"tool output"}]}})
                .to_string();
        contents.push('\n');
        contents += &line("m2", "Second");
        contents += &json!({"type":"assistant","message":{"id":"m2","content":[{"type":"tool_use","name":"Read"}]}}).to_string();
        contents.push('\n');
        contents += &line("m2", "turn");
        contents += "{\"type\":\"assistant\",\"mess";
        assert_eq!(latest_answer(&contents).as_deref(), Some("Second\n\nturn"));
        assert_eq!(latest_answer(""), None);

        let long = latest_answer(&line("m1", &format!("{}end", "é".repeat(2000)))).unwrap();
        assert_eq!(long.chars().count(), MAX_PARTIAL);
        assert!(long.starts_with('…') && long.ends_with("end"));

        let secret = latest_answer(&line(
            "m1",
            "key sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123456789",
        ))
        .unwrap();
        assert!(
            !secret.contains("abcdefghijklmnopqrstuvwxyz0123456789"),
            "{secret}"
        );
    }

    #[test]
    fn a_large_transcript_is_read_from_its_end_only() {
        let config = tempfile::tempdir().unwrap();
        let root = config.path().join("projects");
        std::fs::create_dir_all(&root).unwrap();
        let path = root.join("agent-a1.jsonl");
        let mut contents = line("old", &"x".repeat(TRANSCRIPT_TAIL as usize));
        contents += &line("new", "the end, ünicode");
        std::fs::write(&path, contents).unwrap();
        assert_eq!(
            read_partial(&root, &path).as_deref(),
            Some("the end, ünicode")
        );
    }

    #[test]
    fn a_member_is_read_at_most_every_interval_and_a_restart_waits() {
        let now = Instant::now();
        assert_eq!(due(None, 1, now), Due::Read);
        let last = (now, 1);
        assert_eq!(due(Some(&last), 1, now + Duration::from_secs(9)), Due::Wait);
        assert_eq!(due(Some(&last), 1, now + LIVE_READ_INTERVAL), Due::Read);
        assert_eq!(due(Some(&last), 2, now), Due::Restart);
        assert_eq!(
            due(Some(&(now, 2)), 1, now + LIVE_READ_INTERVAL),
            Due::Wait,
            "a stale attempt reads nothing"
        );
    }

    #[test]
    fn the_answer_so_far_lasts_while_the_member_runs_and_is_never_kept() {
        let mut running = snapshot(&frame(json!([
            {"type":"workflow_agent","index":1,"label":"one","state":"start","agentId":"a1"}
        ])))
        .unwrap();
        running.agents[0].partial = Some("so far".into());
        let quiet = snapshot(&frame(json!([
            {"type":"workflow_agent","index":1,"label":"one","state":"start"}
        ])))
        .unwrap();
        let merged = merge(&running, quiet);
        assert_eq!(merged.agents[0].partial.as_deref(), Some("so far"));
        assert_eq!(merged.agents[0].agent_id.as_deref(), Some("a1"));
        let live = serde_json::to_string(&merged).unwrap();
        assert!(live.contains("\"partial\":\"so far\"") && !live.contains("a1"));
        assert!(
            !crate::activity::persisting(|| serde_json::to_string(&merged).unwrap())
                .contains("so far")
        );
        let done = snapshot(&frame(json!([
            {"type":"workflow_agent","index":1,"label":"one","state":"done","resultPreview":"final"}
        ])))
        .unwrap();
        let merged_done = merge(&merged, done);
        assert_eq!(
            merged_done.agents[0].partial, None,
            "the result replaces it"
        );
        let retry = snapshot(&frame(json!([
            {"type":"workflow_agent","index":1,"label":"one","state":"start","attempt":2}
        ])))
        .unwrap();
        assert_eq!(merge(&merged, retry).agents[0].partial, None);
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn running_members_show_their_answer_so_far_from_snapshots_only() {
        let config = tempfile::tempdir().unwrap();
        let dir = config.path().join("projects").join("wf");
        std::fs::create_dir_all(&dir).unwrap();
        let transcript = dir.join("agent-a1.jsonl");
        std::fs::write(&transcript, line("m1", "A1 so far")).unwrap();
        let mut live = LiveTranscripts::new(Some(config.path().to_path_buf()));
        let start = json!({"type":"system","subtype":"task_started","task_id":"w1","tool_use_id":"call","task_type":"local_workflow","workflow_name":"wf"});
        live.refresh(&start, &mut crate::activity::claude(&start))
            .await;
        let ack = json!({"type":"user","parent_tool_use_id":null,"message":{"role":"user","content":[{"type":"tool_result","tool_use_id":"call","content":"Workflow launched."}]},"tool_use_result":{"taskType":"local_workflow","transcriptDir":dir}});
        live.refresh(&ack, &mut []).await;
        let progress = |state: &str| {
            json!({"type":"system","subtype":"task_progress","task_id":"w1","tool_use_id":"call","workflow_progress":[
                {"type":"workflow_agent","index":1,"label":"one","agentId":"a1","state":state},
                {"type":"workflow_agent","index":2,"label":"two","agentId":"a2","state":"queued"}
            ]})
        };
        let partial = |items: &[ActivityItem]| {
            items[0].workflow.as_ref().unwrap().agents[0]
                .partial
                .clone()
        };
        let frame = progress("start");
        let mut items = crate::activity::claude(&frame);
        live.refresh(&frame, &mut items).await;
        assert_eq!(partial(&items).as_deref(), Some("A1 so far"));
        assert!(items[0].workflow.as_ref().unwrap().agents[1]
            .partial
            .is_none());

        // Inside the window a snapshot reads nothing.
        std::fs::write(&transcript, line("m2", "A1 more")).unwrap();
        let mut items = crate::activity::claude(&frame);
        live.refresh(&frame, &mut items).await;
        assert_eq!(partial(&items), None);

        // After the window it reads again.
        let key = ("w1".to_owned(), 1);
        let (at, attempt) = live.reads[&key];
        live.reads
            .insert(key.clone(), (at - LIVE_READ_INTERVAL, attempt));
        let mut items = crate::activity::claude(&frame);
        live.refresh(&frame, &mut items).await;
        assert_eq!(partial(&items).as_deref(), Some("A1 more"));

        // A finished member stops being read.
        let done = progress("done");
        let mut items = crate::activity::claude(&done);
        live.refresh(&done, &mut items).await;
        assert_eq!(partial(&items), None);
        assert!(!live.reads.contains_key(&key));

        // Without a config folder nothing is read.
        let mut blind = LiveTranscripts::new(None);
        blind.refresh(&start, &mut []).await;
        blind.refresh(&ack, &mut []).await;
        let mut items = crate::activity::claude(&frame);
        blind.refresh(&frame, &mut items).await;
        assert_eq!(partial(&items), None);
    }
}
