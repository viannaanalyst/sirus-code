//! Scheduled automations (ADR-051): a project, a prompt, a provider/model and a
//! schedule. While Sirus Code is open, a single native timer starts each due run
//! as a normal session through the same `send_prompt` admission as the Send
//! button. Runs use the automation's approval profile (Ask by default, so tool
//! approvals wait for the person) and an isolated worktree by default.
//!
//! The standalone Automations page was removed on 2026-10-07: every automation
//! is now an Astro habit (ADR-069). Older standalone ones are kept but paused
//! on load and cannot be resumed, run or created.

use std::sync::{Arc, OnceLock};
use std::time::Duration;

use chrono::{DateTime, Datelike, Duration as Span, Local, NaiveTime, TimeZone, Timelike, Weekday};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, State};
use tokio::sync::Notify;
use uuid::Uuid;

use crate::commands::{native_task, AppState};
use crate::error::{Error, Result};
use crate::models::{
    AgentProviderId, AppData, ApprovalMode, CreateSessionRequest, ExecutionOptions,
    SendPromptRequest,
};

pub const CHANGED: &str = "automations-changed";
const MAX_AUTOMATIONS: usize = 50;
const RUNS_PER_AUTOMATION: usize = 50;
const NAME_LIMIT: usize = 200;
const PROMPT_LIMIT: usize = 64 * 1024;
/// Refusal for standalone automations, which no longer have a page.
const HABITS_ONLY: &str = "Scheduled work now lives in Astro habits.";
const MIN_INTERVAL_MINUTES: u32 = 15;
const MAX_INTERVAL_MINUTES: u32 = 7 * 24 * 60;
/// Runs missed while the app was closed start once if they are this recent.
const MISSED_GRACE: Span = Span::minutes(60);
const FAILURES_BEFORE_PAUSE: usize = 3;
/// The timer re-reads the clock at least this often (wall-clock changes, sleep).
const MAX_SLEEP: Duration = Duration::from_secs(60 * 60);

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum Schedule {
    Manual,
    Once {
        at: String,
    },
    Hourly {
        minute: u32,
    },
    Daily {
        time: String,
    },
    Weekdays {
        time: String,
    },
    /// `weekday`: 0 = Monday … 6 = Sunday.
    Weekly {
        weekday: u32,
        time: String,
    },
    Interval {
        minutes: u32,
    },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Workspace {
    /// A new isolated worktree per run.
    Worktree,
    /// The project checkout.
    Local,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Automation {
    pub id: String,
    pub name: String,
    pub prompt: String,
    pub project_id: String,
    pub agent: AgentProviderId,
    #[serde(default)]
    pub model: Option<String>,
    pub approval: ApprovalMode,
    #[serde(default)]
    pub planning: bool,
    pub workspace: Workspace,
    pub schedule: Schedule,
    pub enabled: bool,
    pub created_at: String,
    pub updated_at: String,
    #[serde(default)]
    pub next_run_at: Option<String>,
    #[serde(default)]
    pub last_run_at: Option<String>,
    #[serde(default)]
    pub last_error: Option<String>,
    /// A habit of this Astro (ADR-069): runs carry its context and report to its conversation.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub astro_id: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum RunStatus {
    /// A session was created and its first turn admitted; its status is the session's.
    Started,
    Skipped,
    Failed,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Run {
    pub id: String,
    pub automation_id: String,
    #[serde(default)]
    pub session_id: Option<String>,
    pub started_at: String,
    pub manual: bool,
    pub status: RunStatus,
    #[serde(default)]
    pub note: Option<String>,
    /// A habit run's answer was handled (posted or quiet).
    #[serde(default)]
    pub reported: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AutomationInput {
    pub id: Option<String>,
    pub name: String,
    pub prompt: String,
    pub project_id: String,
    pub agent: AgentProviderId,
    pub model: Option<String>,
    pub approval: ApprovalMode,
    pub planning: bool,
    pub workspace: Workspace,
    pub schedule: Schedule,
    pub enabled: bool,
    /// Full access needs this explicit acknowledgment on every save.
    #[serde(default)]
    pub acknowledge_full_access: bool,
    /// Makes this automation a habit of that Astro.
    #[serde(default)]
    pub astro_id: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(
    tag = "type",
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum Action {
    List,
    Upsert { automation: AutomationInput },
    Delete { id: String },
    SetEnabled { id: String, enabled: bool },
    RunNow { id: String },
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    pub automations: Vec<Automation>,
    pub runs: Vec<Run>,
}

static WAKE: OnceLock<Arc<Notify>> = OnceLock::new();

fn wake() {
    if let Some(notify) = WAKE.get() {
        notify.notify_one();
    }
}

fn snapshot(data: &AppData) -> Snapshot {
    Snapshot {
        automations: data.automations.clone(),
        runs: data.automation_runs.clone(),
    }
}

fn changed(app: &AppHandle) {
    let _ = app.emit(CHANGED, ());
}

#[tauri::command]
pub async fn automation_action(
    app: AppHandle,
    state: State<'_, Arc<AppState>>,
    action: Action,
) -> Result<Snapshot> {
    let state = state.inner().clone();
    match action {
        Action::List => Ok(snapshot(&state.data.lock())),
        Action::RunNow { id } => {
            start_run(&app, &state, &id, true).await?;
            Ok(snapshot(&state.data.lock()))
        }
        action => {
            let worker = state.clone();
            let result = native_task(move || mutate(&worker, action)).await?;
            wake();
            changed(&app);
            Ok(result)
        }
    }
}

fn mutate(state: &AppState, action: Action) -> Result<Snapshot> {
    let mut data = state.data.lock();
    state.ensure_running()?;
    let now = Local::now();
    match action {
        Action::Upsert { automation } => upsert(&mut data, automation, now)?,
        Action::Delete { id } => {
            let before = data.automations.len();
            data.automations.retain(|item| item.id != id);
            if data.automations.len() == before {
                return Err(Error::not_found("automation not found"));
            }
            data.automation_runs.retain(|run| run.automation_id != id);
        }
        Action::SetEnabled { id, enabled } => {
            let automation = data
                .automations
                .iter_mut()
                .find(|item| item.id == id)
                .ok_or_else(|| Error::not_found("automation not found"))?;
            if enabled && automation.astro_id.is_none() {
                return Err(Error::new("invalid", HABITS_ONLY));
            }
            automation.enabled = enabled;
            automation.updated_at = now.to_rfc3339();
            automation.next_run_at = if enabled {
                automation.last_error = None;
                next_run(&automation.schedule, now).map(|at| at.to_rfc3339())
            } else {
                None
            };
        }
        Action::List | Action::RunNow { .. } => unreachable!("handled before mutate"),
    }
    let view = snapshot(&data);
    drop(data);
    state.persist()?;
    Ok(view)
}

fn printable(value: &str, limit: usize, what: &str) -> Result<String> {
    let value = value.trim();
    if value.is_empty() || value.chars().count() > limit || value.chars().any(char::is_control) {
        return Err(Error::new("invalid", format!("Invalid automation {what}.")));
    }
    Ok(value.to_owned())
}

pub(crate) fn valid_model(model: &str) -> bool {
    !model.is_empty()
        && model.len() <= 200
        && !model.starts_with('-')
        && model.bytes().all(|b| {
            b.is_ascii_alphanumeric() || matches!(b, b'.' | b'_' | b':' | b'/' | b'@' | b'+' | b'-')
        })
}

fn parse_time(value: &str) -> Option<NaiveTime> {
    if value.len() != 5 {
        return None;
    }
    NaiveTime::parse_from_str(value, "%H:%M").ok()
}

fn validate_schedule(schedule: &Schedule, now: DateTime<Local>) -> Result<()> {
    let ok = match schedule {
        Schedule::Manual => true,
        Schedule::Once { at } => DateTime::parse_from_rfc3339(at).is_ok_and(|at| at > now),
        Schedule::Hourly { minute } => *minute < 60,
        Schedule::Daily { time } | Schedule::Weekdays { time } => parse_time(time).is_some(),
        Schedule::Weekly { weekday, time } => *weekday < 7 && parse_time(time).is_some(),
        Schedule::Interval { minutes } => {
            (MIN_INTERVAL_MINUTES..=MAX_INTERVAL_MINUTES).contains(minutes)
        }
    };
    if ok {
        Ok(())
    } else {
        Err(Error::new(
            "invalid",
            "Invalid schedule. One-time runs must be in the future and intervals 15 minutes to 7 days.",
        ))
    }
}

fn upsert(data: &mut AppData, input: AutomationInput, now: DateTime<Local>) -> Result<()> {
    if input.astro_id.is_none() {
        return Err(Error::new("invalid", HABITS_ONLY));
    }
    let name = printable(&input.name, NAME_LIMIT, "name")?;
    let prompt = input.prompt.trim().to_owned();
    if prompt.is_empty() || prompt.len() > PROMPT_LIMIT || prompt.contains('\0') {
        return Err(Error::new(
            "invalid",
            "The prompt must have 1 to 65,536 bytes.",
        ));
    }
    if !data
        .projects
        .iter()
        .any(|project| project.id == input.project_id)
    {
        return Err(Error::not_found("project not found"));
    }
    if data.settings.disabled_providers.contains(&input.agent) {
        return Err(Error::agent("Enable this provider in Settings first."));
    }
    if input
        .model
        .as_deref()
        .is_some_and(|model| !valid_model(model))
    {
        return Err(Error::new("invalid", "Invalid model."));
    }
    if input.approval == ApprovalMode::Full && (!input.acknowledge_full_access || input.planning) {
        return Err(Error::new(
            "confirmation_required",
            "Full access needs explicit acknowledgment and cannot combine with planning.",
        ));
    }
    validate_schedule(&input.schedule, now)?;
    if let Some(astro_id) = &input.astro_id {
        let astro = data
            .astros
            .iter()
            .find(|astro| astro.id == *astro_id)
            .ok_or_else(|| Error::not_found("Astro not found"))?;
        if !astro.project_ids.contains(&input.project_id) {
            return Err(Error::new(
                "invalid",
                "A habit runs in one of its Astro's projects.",
            ));
        }
    }
    let stamp = now.to_rfc3339();
    let next = if input.enabled {
        next_run(&input.schedule, now).map(|at| at.to_rfc3339())
    } else {
        None
    };
    match input.id {
        Some(id) => {
            let existing = data
                .automations
                .iter_mut()
                .find(|item| item.id == id)
                .ok_or_else(|| Error::not_found("automation not found"))?;
            existing.name = name;
            existing.prompt = prompt;
            existing.project_id = input.project_id;
            existing.agent = input.agent;
            existing.model = input.model;
            existing.approval = input.approval;
            existing.planning = input.planning;
            existing.workspace = input.workspace;
            existing.schedule = input.schedule;
            existing.enabled = input.enabled;
            existing.updated_at = stamp;
            existing.next_run_at = next;
            existing.last_error = None;
            existing.astro_id = input.astro_id;
        }
        None => {
            if data.automations.len() >= MAX_AUTOMATIONS {
                return Err(Error::new("invalid", "At most 50 automations."));
            }
            data.automations.push(Automation {
                id: Uuid::new_v4().to_string(),
                name,
                prompt,
                project_id: input.project_id,
                agent: input.agent,
                model: input.model,
                approval: input.approval,
                planning: input.planning,
                workspace: input.workspace,
                schedule: input.schedule,
                enabled: input.enabled,
                created_at: stamp.clone(),
                updated_at: stamp,
                next_run_at: next,
                last_run_at: None,
                last_error: None,
                astro_id: input.astro_id,
            });
        }
    }
    Ok(())
}

fn at_local(date: chrono::NaiveDate, time: NaiveTime) -> Option<DateTime<Local>> {
    // A nonexistent local time (DST gap) resolves to the next valid instant.
    Local
        .from_local_datetime(&date.and_time(time))
        .earliest()
        .or_else(|| {
            Local
                .from_local_datetime(&(date.and_time(time) + Span::hours(1)))
                .earliest()
        })
}

/// The first run strictly after `after`, or None for manual/finished schedules.
pub fn next_run(schedule: &Schedule, after: DateTime<Local>) -> Option<DateTime<Local>> {
    let today = after.date_naive();
    let days = |accept: &dyn Fn(Weekday) -> bool, time: NaiveTime| {
        (0..8).find_map(|offset| {
            let date = today + Span::days(offset);
            if !accept(date.weekday()) {
                return None;
            }
            at_local(date, time).filter(|at| *at > after)
        })
    };
    match schedule {
        Schedule::Manual => None,
        Schedule::Once { at } => DateTime::parse_from_rfc3339(at)
            .ok()
            .map(|at| at.with_timezone(&Local))
            .filter(|at| *at > after),
        Schedule::Hourly { minute } => {
            let base = after
                .with_minute(*minute)?
                .with_second(0)?
                .with_nanosecond(0)?;
            Some(if base > after {
                base
            } else {
                base + Span::hours(1)
            })
        }
        Schedule::Daily { time } => days(&|_| true, parse_time(time)?),
        Schedule::Weekdays { time } => days(
            &|day| !matches!(day, Weekday::Sat | Weekday::Sun),
            parse_time(time)?,
        ),
        Schedule::Weekly { weekday, time } => {
            let wanted = Weekday::try_from(*weekday as u8).ok()?;
            days(&|day| day == wanted, parse_time(time)?)
        }
        Schedule::Interval { minutes } => Some(after + Span::minutes(i64::from(*minutes))),
    }
}

fn record(data: &mut AppData, run: Run) {
    data.automation_runs.push(run);
    // Newest runs win; each automation keeps a bounded history.
    let mut counts = std::collections::HashMap::<String, usize>::new();
    let mut keep = vec![true; data.automation_runs.len()];
    for (index, run) in data.automation_runs.iter().enumerate().rev() {
        let count = counts.entry(run.automation_id.clone()).or_default();
        *count += 1;
        keep[index] = *count <= RUNS_PER_AUTOMATION;
    }
    let mut index = 0;
    data.automation_runs.retain(|_| {
        index += 1;
        keep[index - 1]
    });
}

fn short(value: &str) -> String {
    value
        .lines()
        .next()
        .unwrap_or("")
        .chars()
        .filter(|c| !c.is_control())
        .take(200)
        .collect()
}

/// Whether the latest `FAILURES_BEFORE_PAUSE` started runs all ended in failure.
fn failing(data: &AppData, automation_id: &str) -> bool {
    let recent: Vec<_> = data
        .automation_runs
        .iter()
        .rev()
        .filter(|run| run.automation_id == automation_id && run.status != RunStatus::Skipped)
        .take(FAILURES_BEFORE_PAUSE)
        .collect();
    recent.len() == FAILURES_BEFORE_PAUSE
        && recent.iter().all(|run| {
            run.status == RunStatus::Failed
                || run.session_id.as_ref().is_some_and(|id| {
                    data.sessions.iter().any(|session| {
                        session.id == *id && session.status == crate::models::SessionStatus::Failed
                    })
                })
        })
}

enum Plan {
    Start(Box<Automation>, String),
    Skip,
}

/// Starts one run: checks, then a new session admitted through `send_prompt`.
pub async fn start_run(
    app: &AppHandle,
    state: &Arc<AppState>,
    id: &str,
    manual: bool,
) -> Result<()> {
    let plan = {
        let mut data = state.data.lock();
        state.ensure_running()?;
        let now = Local::now();
        let automation = data
            .automations
            .iter()
            .find(|item| item.id == id)
            .cloned()
            .ok_or_else(|| Error::not_found("automation not found"))?;
        if automation.astro_id.is_none() {
            return Err(Error::new("invalid", HABITS_ONLY));
        }
        let run_id = Uuid::new_v4().to_string();
        let previous_active = data
            .automation_runs
            .iter()
            .rev()
            .filter(|run| run.automation_id == id)
            .filter_map(|run| run.session_id.as_ref())
            .any(|session_id| {
                data.sessions
                    .iter()
                    .any(|session| session.id == *session_id && session.status.is_active())
            });
        let pause = !manual && failing(&data, id);
        let entry = data
            .automations
            .iter_mut()
            .find(|item| item.id == id)
            .expect("found above");
        if !manual {
            entry.next_run_at = if matches!(entry.schedule, Schedule::Once { .. }) {
                entry.enabled = false;
                None
            } else {
                next_run(&entry.schedule, now).map(|at| at.to_rfc3339())
            };
        }
        let plan = if !manual && !automation.enabled {
            Plan::Skip
        } else if pause {
            entry.enabled = false;
            entry.next_run_at = None;
            entry.last_error = Some(format!(
                "Paused after {FAILURES_BEFORE_PAUSE} failed runs in a row."
            ));
            Plan::Skip
        } else if previous_active {
            record(
                &mut data,
                Run {
                    id: run_id,
                    automation_id: id.into(),
                    session_id: None,
                    started_at: now.to_rfc3339(),
                    manual,
                    status: RunStatus::Skipped,
                    note: Some("The previous run is still working.".into()),
                    reported: false,
                },
            );
            Plan::Skip
        } else {
            entry.last_run_at = Some(now.to_rfc3339());
            Plan::Start(Box::new(automation), run_id)
        };
        plan
    };
    let _ = state.persist();
    let Plan::Start(automation, run_id) = plan else {
        changed(app);
        return Ok(());
    };
    let started_at = Local::now().to_rfc3339();
    let outcome = launch(
        app,
        state,
        Launch {
            project_id: automation.project_id.clone(),
            title: automation.name.clone(),
            agent: automation.agent.clone(),
            model: automation.model.clone(),
            isolated_worktree: automation.workspace == Workspace::Worktree,
            prompt: match &automation.astro_id {
                Some(_) => crate::astros::habit_prompt(&automation.name, &automation.prompt),
                None => automation.prompt.clone(),
            },
            astro: automation.astro_id.clone(),
            delegation: None,
            approval: automation.approval,
            planning: automation.planning,
        },
    )
    .await;
    {
        let mut data = state.data.lock();
        let (session_id, error) = outcome;
        if let Some(entry) = data
            .automations
            .iter_mut()
            .find(|item| item.id == automation.id)
        {
            entry.last_error = error.clone();
        }
        record(
            &mut data,
            Run {
                id: run_id,
                automation_id: automation.id.clone(),
                session_id,
                started_at,
                manual,
                status: if error.is_some() {
                    RunStatus::Failed
                } else {
                    RunStatus::Started
                },
                note: error,
                reported: false,
            },
        );
    }
    let _ = state.persist();
    changed(app);
    Ok(())
}

/// One explicit or scheduled start: a new session admitted through `send_prompt`.
pub struct Launch {
    pub project_id: String,
    pub title: String,
    pub agent: AgentProviderId,
    pub model: Option<String>,
    pub isolated_worktree: bool,
    pub prompt: String,
    pub approval: ApprovalMode,
    pub planning: bool,
    /// Marks the session as this Astro's (a habit run).
    pub astro: Option<String>,
    /// The Astro that started it and wants its result (ADR-069).
    pub delegation: Option<crate::astros::Delegation>,
}

/// Creates the session (announced to the renderer) and admits its first turn.
/// Returns the session ID (when created) and a short error (when anything failed).
pub async fn launch(
    app: &AppHandle,
    state: &Arc<AppState>,
    request: Launch,
) -> (Option<String>, Option<String>) {
    let created = {
        let state = state.clone();
        let astro = request.astro.clone();
        let delegation = request.delegation.clone();
        let session_request = CreateSessionRequest {
            project_id: request.project_id.clone(),
            title: Some(request.title.chars().take(200).collect()),
            agent: request.agent.clone(),
            isolated_worktree: request.isolated_worktree,
            model: request.model.clone(),
        };
        native_task(move || {
            let mut data = state.data.lock();
            let mut session =
                crate::commands::create_session_locked(&state, &mut data, session_request, "HEAD")?;
            session.astro = astro;
            session.delegation = delegation;
            if let Some(stored) = data.sessions.iter_mut().find(|item| item.id == session.id) {
                stored.astro = session.astro.clone();
                stored.delegation = session.delegation.clone();
            }
            drop(data);
            state.persist()?;
            Ok(session)
        })
        .await
    };
    match created {
        Ok(session) => {
            crate::transcript_view::emit(app, &session);
            let send = SendPromptRequest {
                queued_after: None,
                debugging: false,
                goal: None,
                session_id: session.id.clone(),
                attachment_ids: vec![],
                attachment_owner: String::new(),
                prompt: request.prompt,
                execution: ExecutionOptions {
                    approval: Some(request.approval),
                    planning: request.planning,
                    ..Default::default()
                },
                team: false,
            };
            let sent =
                crate::commands::send_prompt(app.clone(), app.state::<Arc<AppState>>(), send).await;
            (
                Some(session.id),
                sent.err().map(|error| short(&error.to_string())),
            )
        }
        Err(error) => (None, Some(short(&error.to_string()))),
    }
}

/// Starts the single scheduler timer. Missed runs older than the grace window
/// are skipped (and rescheduled) instead of all firing at launch.
pub fn start(app: AppHandle) {
    let notify = WAKE.get_or_init(|| Arc::new(Notify::new())).clone();
    tauri::async_runtime::spawn(async move {
        let state = app.state::<Arc<AppState>>().inner().clone();
        let mut first = true;
        loop {
            if state.ensure_running().is_err() {
                return;
            }
            let now = Local::now();
            let mut due = vec![];
            let mut next: Option<DateTime<Local>> = None;
            {
                let mut data = state.data.lock();
                let mut stale = false;
                for automation in data.automations.iter_mut().filter(|item| item.enabled) {
                    let Some(at) = automation
                        .next_run_at
                        .as_deref()
                        .and_then(|at| DateTime::parse_from_rfc3339(at).ok())
                        .map(|at| at.with_timezone(&Local))
                    else {
                        continue;
                    };
                    if at > now {
                        next = Some(next.map_or(at, |current| current.min(at)));
                    } else if first && now - at > MISSED_GRACE {
                        automation.next_run_at =
                            next_run(&automation.schedule, now).map(|at| at.to_rfc3339());
                        if matches!(automation.schedule, Schedule::Once { .. }) {
                            automation.enabled = false;
                        }
                        automation.last_error = Some("Missed while Sirus Code was closed.".into());
                        stale = true;
                    } else {
                        due.push(automation.id.clone());
                    }
                }
                drop(data);
                if stale {
                    let _ = state.persist();
                    changed(&app);
                }
            }
            first = false;
            for id in due {
                let _ = start_run(&app, &state, &id, false).await;
            }
            if !due_is_empty_after_runs(&state) {
                continue;
            }
            let wait = next
                .and_then(|at| (at - Local::now()).to_std().ok())
                .unwrap_or(MAX_SLEEP)
                .min(MAX_SLEEP);
            tokio::select! {
                _ = tokio::time::sleep(wait) => {}
                _ = notify.notified() => {}
            }
        }
    });
}

/// True when nothing became due while the previous batch was starting.
fn due_is_empty_after_runs(state: &AppState) -> bool {
    let now = Local::now();
    !state.data.lock().automations.iter().any(|item| {
        item.enabled
            && item
                .next_run_at
                .as_deref()
                .and_then(|at| DateTime::parse_from_rfc3339(at).ok())
                .is_some_and(|at| at.with_timezone(&Local) <= now)
    })
}

/// Pauses standalone automations (no `astroId`) left from the removed
/// Automations page, keeping their definitions and runs. Returns whether
/// anything changed so the load checkpoints it once.
pub fn retire_standalone(data: &mut AppData) -> bool {
    let mut changed = false;
    for automation in data
        .automations
        .iter_mut()
        .filter(|item| item.astro_id.is_none() && (item.enabled || item.next_run_at.is_some()))
    {
        automation.enabled = false;
        automation.next_run_at = None;
        changed = true;
    }
    changed
}

/// Drops automations (and their runs) whose project was removed.
pub fn prune(data: &mut AppData) {
    let projects: std::collections::HashSet<_> = data
        .projects
        .iter()
        .map(|project| project.id.clone())
        .collect();
    data.automations
        .retain(|automation| projects.contains(&automation.project_id));
    let kept: std::collections::HashSet<_> = data
        .automations
        .iter()
        .map(|automation| automation.id.clone())
        .collect();
    data.automation_runs
        .retain(|run| kept.contains(&run.automation_id));
}

#[cfg(test)]
mod tests {
    use super::*;

    fn local(y: i32, m: u32, d: u32, h: u32, min: u32) -> DateTime<Local> {
        Local
            .with_ymd_and_hms(y, m, d, h, min, 0)
            .earliest()
            .unwrap()
    }

    #[test]
    fn next_runs_follow_each_schedule() {
        // 2026-10-05 is a Monday.
        let now = local(2026, 10, 5, 10, 30);
        let time = |at: DateTime<Local>| (at.day(), at.hour(), at.minute());
        assert_eq!(next_run(&Schedule::Manual, now), None);
        assert_eq!(
            time(next_run(&Schedule::Hourly { minute: 15 }, now).unwrap()),
            (5, 11, 15)
        );
        assert_eq!(
            time(next_run(&Schedule::Hourly { minute: 45 }, now).unwrap()),
            (5, 10, 45)
        );
        assert_eq!(
            time(
                next_run(
                    &Schedule::Daily {
                        time: "09:00".into()
                    },
                    now
                )
                .unwrap()
            ),
            (6, 9, 0)
        );
        assert_eq!(
            time(
                next_run(
                    &Schedule::Daily {
                        time: "18:00".into()
                    },
                    now
                )
                .unwrap()
            ),
            (5, 18, 0)
        );
        let friday = local(2026, 10, 9, 20, 0);
        assert_eq!(
            time(
                next_run(
                    &Schedule::Weekdays {
                        time: "09:00".into()
                    },
                    friday
                )
                .unwrap()
            ),
            (12, 9, 0)
        );
        assert_eq!(
            time(
                next_run(
                    &Schedule::Weekly {
                        weekday: 2,
                        time: "08:00".into()
                    },
                    now
                )
                .unwrap()
            ),
            (7, 8, 0)
        );
        assert_eq!(
            time(next_run(&Schedule::Interval { minutes: 90 }, now).unwrap()),
            (5, 12, 0)
        );
        let past = Schedule::Once {
            at: local(2026, 10, 5, 9, 0).to_rfc3339(),
        };
        assert_eq!(next_run(&past, now), None);
    }

    #[test]
    fn schedules_and_inputs_are_validated() {
        let now = local(2026, 10, 5, 10, 30);
        assert!(validate_schedule(&Schedule::Interval { minutes: 5 }, now).is_err());
        assert!(validate_schedule(&Schedule::Interval { minutes: 15 }, now).is_ok());
        assert!(validate_schedule(&Schedule::Hourly { minute: 60 }, now).is_err());
        assert!(validate_schedule(
            &Schedule::Daily {
                time: "25:00".into()
            },
            now
        )
        .is_err());
        assert!(validate_schedule(
            &Schedule::Daily {
                time: "9:00".into()
            },
            now
        )
        .is_err());
        assert!(validate_schedule(
            &Schedule::Weekly {
                weekday: 7,
                time: "09:00".into()
            },
            now
        )
        .is_err());
        assert!(validate_schedule(
            &Schedule::Once {
                at: "2020-01-01T00:00:00Z".into()
            },
            now
        )
        .is_err());
        assert!(valid_model("gpt-5.1") && valid_model("anthropic/claude-sonnet"));
        assert!(!valid_model("--dangerously") && !valid_model("a b") && !valid_model("x[fast]"));
        assert!(serde_json::from_str::<Action>(r#"{"type":"runNow","id":"a","extra":1}"#).is_err());
        assert!(serde_json::from_str::<Schedule>(r#"{"kind":"cron","expr":"* * * * *"}"#).is_err());
    }

    fn data_with_project() -> AppData {
        let mut data = AppData::default();
        data.projects.push(
            serde_json::from_value(serde_json::json!({
                "id": "p", "name": "P", "path": "/fixture", "addedAt": "t", "lastOpenedAt": "t"
            }))
            .unwrap(),
        );
        data.astros.push(
            serde_json::from_value(serde_json::json!({
                "id": "astro", "name": "Vega", "icon": "estrela", "style": "metal",
                "color": "#8c9bff", "background": "liso", "projectIds": ["p"], "createdAt": "t"
            }))
            .unwrap(),
        );
        data
    }

    fn input(approval: ApprovalMode, acknowledge: bool) -> AutomationInput {
        AutomationInput {
            id: None,
            name: "Nightly triage".into(),
            prompt: "Check failing tests".into(),
            project_id: "p".into(),
            agent: AgentProviderId::Codex,
            model: None,
            approval,
            planning: false,
            workspace: Workspace::Worktree,
            schedule: Schedule::Daily {
                time: "02:00".into(),
            },
            enabled: true,
            acknowledge_full_access: acknowledge,
            astro_id: Some("astro".into()),
        }
    }

    #[test]
    fn full_access_needs_acknowledgment_and_new_automations_get_a_next_run() {
        let now = local(2026, 10, 5, 10, 30);
        let mut data = data_with_project();
        assert!(upsert(&mut data, input(ApprovalMode::Full, false), now).is_err());
        upsert(&mut data, input(ApprovalMode::Ask, false), now).unwrap();
        let created = &data.automations[0];
        assert_eq!(created.approval, ApprovalMode::Ask);
        assert!(created
            .next_run_at
            .as_deref()
            .unwrap()
            .starts_with("2026-10-06T02:00"));
        let mut foreign = input(ApprovalMode::Ask, false);
        foreign.project_id = "missing".into();
        assert!(upsert(&mut data, foreign, now).is_err());
        let mut standalone = input(ApprovalMode::Ask, false);
        standalone.astro_id = None;
        assert!(upsert(&mut data, standalone, now).is_err());
        data.projects.clear();
        prune(&mut data);
        assert!(data.automations.is_empty());
    }

    #[test]
    fn run_history_is_bounded_per_automation_and_failures_pause() {
        let mut data = data_with_project();
        for index in 0..(RUNS_PER_AUTOMATION + 5) {
            record(
                &mut data,
                Run {
                    id: index.to_string(),
                    automation_id: "a".into(),
                    session_id: None,
                    started_at: "t".into(),
                    manual: false,
                    status: RunStatus::Failed,
                    note: None,
                    reported: false,
                },
            );
        }
        assert_eq!(data.automation_runs.len(), RUNS_PER_AUTOMATION);
        assert_eq!(
            data.automation_runs.last().unwrap().id,
            (RUNS_PER_AUTOMATION + 4).to_string()
        );
        assert!(failing(&data, "a"));
        assert!(!failing(&data, "b"));
    }

    #[test]
    fn standalone_automations_are_paused_on_load_and_kept() {
        let now = local(2026, 10, 5, 10, 30);
        let mut data = data_with_project();
        upsert(&mut data, input(ApprovalMode::Ask, false), now).unwrap();
        let mut legacy = data.automations[0].clone();
        legacy.id = "legacy".into();
        legacy.astro_id = None;
        data.automations.push(legacy);
        assert!(retire_standalone(&mut data));
        assert!(!retire_standalone(&mut data));
        assert_eq!(data.automations.len(), 2);
        let habit = &data.automations[0];
        assert!(habit.enabled && habit.next_run_at.is_some());
        let paused = &data.automations[1];
        assert!(!paused.enabled && paused.next_run_at.is_none());
        assert_eq!(paused.prompt, "Check failing tests");
    }
}
