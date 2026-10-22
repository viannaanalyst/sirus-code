//! Scheduled tasks (ADR-142): a prompt that runs by itself at a time, in local time. Each
//! run either starts a new conversation in its own worktree (through `launch.rs`, as
//! delegation does) or continues one bound conversation (through `send_prompt`, as the
//! Send button does). One native timer sleeps until the earliest run (at most a minute,
//! so wall-clock changes and Mac sleep are noticed) and is woken early by any change.
//! Runs more than ten minutes late are recorded as missed instead of bursting at launch,
//! a run never overlaps the previous one of the same task, and three failed runs in a row
//! pause the task. Agents reach the same engine through the `sirus_*` scheduled-task tools.
//! A `webhook` task never runs on the clock: it runs when another service posts to its URL
//! (`scheduled_webhooks.rs`, ADR-161), and a delivery that arrives while its previous run
//! still works waits as one follow-up (the latest).

use std::collections::{HashMap, HashSet};
use std::sync::{Arc, OnceLock};
use std::time::Duration;

use crate::runtime::{AppHandle, Emitter, Manager, State};
use chrono::{DateTime, Datelike, Duration as Span, Local, NaiveDate, NaiveTime, TimeZone};
use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tokio::sync::Notify;
use uuid::Uuid;

use crate::commands::{native_task, AppState};
use crate::error::{Error, Result};
use crate::launch::{launch, Launch};
use crate::models::{
    AgentProviderId, AppData, ApprovalMode, ExecutionOptions, SendPromptRequest, Session,
};

pub const CHANGED: &str = "scheduled-tasks-changed";
const MAX_TASKS: usize = 50;
const TITLE_LIMIT: usize = 200;
const PROMPT_LIMIT: usize = 64 * 1024;
const MIN_INTERVAL_MINUTES: u32 = 15;
const MAX_INTERVAL_MINUTES: u32 = 7 * 24 * 60;
/// A run later than this (app closed, Mac asleep) is recorded as missed.
const MISSED_AFTER_MS: i64 = 10 * 60 * 1000;
/// A busy bound conversation is retried every minute for this long.
const BUSY_RETRY_MS: i64 = 30 * 60 * 1000;
const FAILURES_BEFORE_PAUSE: u32 = 3;
/// The timer re-reads the wall clock at least this often: its sleep is monotonic and
/// does not advance while the Mac sleeps.
const MAX_SLEEP: Duration = Duration::from_secs(60);

const BUSY: &str = "The conversation was busy.";
const MISSING: &str = "The conversation no longer exists.";
const MISSED: &str = "Missed while Sirus Code was closed or the Mac was asleep.";
const OVERLAP: &str = "Skipped a run: the previous one was still working.";
const INTERRUPTED: &str = "Interrupted when Sirus Code closed.";

/// When a task runs, in local time.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum Schedule {
    /// Unix milliseconds.
    Once {
        at: i64,
    },
    /// `HH:MM`.
    Daily {
        time: String,
    },
    /// `days`: 0 = Sunday … 6 = Saturday, at least one.
    Weekly {
        days: Vec<u8>,
        time: String,
    },
    Interval {
        minutes: u32,
    },
    /// Runs on each accepted POST to `/hooks/<id>/<secret>` (ADR-161).
    Webhook {
        #[serde(default)]
        filters: Vec<crate::scheduled_webhooks::Filter>,
        #[serde(default = "crate::scheduled_webhooks::default_dedupe_minutes")]
        dedupe_minutes: u32,
    },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Status {
    Never,
    Running,
    Succeeded,
    Failed,
    Missed,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum CreatedBy {
    Person,
    Agent,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScheduledTask {
    pub id: String,
    pub title: String,
    pub prompt: String,
    pub project_id: String,
    pub agent: AgentProviderId,
    #[serde(default)]
    pub model: Option<String>,
    pub schedule: Schedule,
    /// `None`: each run starts a new conversation in its own worktree.
    #[serde(default)]
    pub session_id: Option<String>,
    pub approval: ApprovalMode,
    pub enabled: bool,
    pub created_by: CreatedBy,
    pub created_at: i64,
    pub updated_at: i64,
    #[serde(default)]
    pub next_run_at: Option<i64>,
    #[serde(default)]
    pub last_run_at: Option<i64>,
    pub last_status: Status,
    #[serde(default)]
    pub last_error: Option<String>,
    #[serde(default)]
    pub last_session_id: Option<String>,
    #[serde(default)]
    pub run_count: u32,
    /// Failed runs in a row; stored, never sent to the renderer.
    #[serde(default)]
    pub failure_streak: u32,
    /// A webhook task's URL secret; stored, never sent to the renderer except once when made.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub webhook_secret: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ScheduledTaskInput {
    #[serde(default)]
    pub id: Option<String>,
    pub title: String,
    pub prompt: String,
    pub project_id: String,
    pub agent: AgentProviderId,
    pub model: Option<String>,
    pub schedule: Schedule,
    pub session_id: Option<String>,
    pub approval: ApprovalMode,
    pub enabled: bool,
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
    Upsert {
        task: ScheduledTaskInput,
    },
    Delete {
        id: String,
    },
    SetEnabled {
        id: String,
        enabled: bool,
    },
    RunNow {
        id: String,
    },
    /// A webhook task gets a new secret; the old URL stops working.
    RotateWebhook {
        id: String,
    },
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    pub tasks: Vec<Value>,
    /// A webhook URL made by this action (a new webhook task or a rotation): its only showing.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub webhook: Option<WebhookReveal>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WebhookReveal {
    pub task_id: String,
    /// `/hooks/<id>/<secret>`.
    pub path: String,
    /// The path on the public route (`remote-public.json`) when there is one, then on this computer.
    pub urls: Vec<String>,
    /// The first URL is on the public route.
    pub public: bool,
    /// Remote access is serving now; without it the URL answers nothing.
    pub serving: bool,
}

fn reveal(task: &ScheduledTask) -> Option<WebhookReveal> {
    let secret = task.webhook_secret.as_deref()?;
    let path = format!("/hooks/{}/{secret}", task.id);
    let bases = crate::remote::webhook_bases();
    Some(WebhookReveal {
        task_id: task.id.clone(),
        urls: bases
            .urls
            .iter()
            .map(|base| format!("{base}{path}"))
            .collect(),
        path,
        public: bases.public,
        serving: bases.serving,
    })
}

static WAKE: OnceLock<Arc<Notify>> = OnceLock::new();
static APP: OnceLock<AppHandle> = OnceLock::new();
/// Tasks whose run is being admitted right now (memory only).
static STARTING: Mutex<Option<HashSet<String>>> = Mutex::new(None);
/// Bound runs waiting for a busy conversation: task id → first attempt (Unix ms).
static WAITING: Mutex<Option<HashMap<String, i64>>> = Mutex::new(None);
/// Webhook deliveries that arrived while the task's run still worked: task id → the latest
/// delivery's prompt (one follow-up per task, ADR-161).
static PENDING: Mutex<Option<HashMap<String, String>>> = Mutex::new(None);

fn wake() {
    if let Some(notify) = WAKE.get() {
        notify.notify_one();
    }
}

fn now_ms() -> i64 {
    Local::now().timestamp_millis()
}

fn local(ms: i64) -> Option<DateTime<Local>> {
    Local.timestamp_millis_opt(ms).single()
}

pub fn snapshot(data: &AppData) -> Snapshot {
    Snapshot {
        tasks: data
            .scheduled_tasks
            .iter()
            .map(|task| {
                let mut value = serde_json::to_value(task).unwrap_or(Value::Null);
                if let Some(fields) = value.as_object_mut() {
                    fields.remove("failureStreak");
                    fields.remove("webhookSecret");
                }
                value
            })
            .collect(),
        webhook: None,
    }
}

fn emit(app: &AppHandle, state: &AppState) {
    let view = snapshot(&state.data.lock());
    let _ = app.emit(CHANGED, view);
}

/// Announces a change made outside this module (a removed project) and re-arms the timer.
pub fn announce(state: &AppState) {
    wake();
    if let Some(app) = APP.get() {
        emit(app, state);
    }
}

#[cfg_attr(feature = "desktop", tauri::command)]
pub async fn scheduled_task_action(
    app: AppHandle,
    state: State<'_, Arc<AppState>>,
    action: Action,
) -> Result<Snapshot> {
    let state = state.inner().clone();
    match action {
        Action::List => Ok(snapshot(&state.data.lock())),
        Action::RunNow { id } => {
            run(&app, &state, &id, true).await?;
            Ok(snapshot(&state.data.lock()))
        }
        action => {
            let worker = state.clone();
            let view = native_task(move || mutate(&worker, action)).await?;
            wake();
            let _ = app.emit(CHANGED, view.clone());
            Ok(view)
        }
    }
}

fn mutate(state: &AppState, action: Action) -> Result<Snapshot> {
    let mut data = state.data.lock();
    state.ensure_running()?;
    let now = Local::now();
    let mut shown = None;
    match action {
        Action::Upsert { task } => {
            let before = task.id.as_deref().and_then(|id| {
                data.scheduled_tasks
                    .iter()
                    .find(|task| task.id == id)
                    .and_then(|task| task.webhook_secret.clone())
            });
            let id = upsert(&mut data, task, now, CreatedBy::Person)?;
            let saved = find(&mut data, &id)?;
            if saved.webhook_secret.is_some() && saved.webhook_secret != before {
                shown = reveal(saved);
            }
        }
        Action::Delete { id } => delete(&mut data, &id)?,
        Action::SetEnabled { id, enabled } => set_enabled(&mut data, &id, enabled, now)?,
        Action::RotateWebhook { id } => {
            let task = find(&mut data, &id)?;
            if !matches!(task.schedule, Schedule::Webhook { .. }) {
                return Err(invalid("Only webhook tasks have a URL."));
            }
            task.webhook_secret = Some(crate::scheduled_webhooks::new_secret());
            task.updated_at = now.timestamp_millis();
            crate::scheduled_webhooks::forget(&id);
            shown = reveal(task);
        }
        Action::List | Action::RunNow { .. } => unreachable!("handled before mutate"),
    }
    let mut view = snapshot(&data);
    view.webhook = shown;
    drop(data);
    state.persist()?;
    Ok(view)
}

pub(crate) fn find<'a>(data: &'a mut AppData, id: &str) -> Result<&'a mut ScheduledTask> {
    data.scheduled_tasks
        .iter_mut()
        .find(|task| task.id == id)
        .ok_or_else(|| Error::not_found("scheduled task not found"))
}

pub(crate) fn delete(data: &mut AppData, id: &str) -> Result<()> {
    let before = data.scheduled_tasks.len();
    data.scheduled_tasks.retain(|task| task.id != id);
    if data.scheduled_tasks.len() == before {
        return Err(Error::not_found("scheduled task not found"));
    }
    if let Some(waiting) = WAITING.lock().as_mut() {
        waiting.remove(id);
    }
    if let Some(pending) = PENDING.lock().as_mut() {
        pending.remove(id);
    }
    crate::scheduled_webhooks::forget(id);
    Ok(())
}

fn parse_time(value: &str) -> Option<NaiveTime> {
    if value.len() != 5 {
        return None;
    }
    NaiveTime::parse_from_str(value, "%H:%M").ok()
}

fn invalid(message: &str) -> Error {
    Error::new("invalid", message)
}

/// Checks a schedule and puts weekly days in order without repeats.
fn validate_schedule(schedule: Schedule) -> Result<Schedule> {
    match schedule {
        Schedule::Once { at } => local(at)
            .map(|_| Schedule::Once { at })
            .ok_or_else(|| invalid("Pick a valid time.")),
        Schedule::Daily { time } => parse_time(&time)
            .map(|_| Schedule::Daily { time })
            .ok_or_else(|| invalid("Times are HH:MM.")),
        Schedule::Weekly { mut days, time } => {
            days.sort_unstable();
            days.dedup();
            if days.is_empty() || days.iter().any(|day| *day > 6) {
                return Err(invalid("Pick at least one day of the week."));
            }
            parse_time(&time)
                .map(|_| Schedule::Weekly { days, time })
                .ok_or_else(|| invalid("Times are HH:MM."))
        }
        Schedule::Interval { minutes } => {
            if (MIN_INTERVAL_MINUTES..=MAX_INTERVAL_MINUTES).contains(&minutes) {
                Ok(Schedule::Interval { minutes })
            } else {
                Err(invalid("Intervals are 15 minutes to 7 days."))
            }
        }
        Schedule::Webhook {
            filters,
            dedupe_minutes,
        } => {
            let filters: Vec<_> = filters
                .into_iter()
                .map(|filter| crate::scheduled_webhooks::Filter {
                    path: filter.path.trim().to_owned(),
                    equals: filter.equals,
                })
                .collect();
            crate::scheduled_webhooks::validate(&filters, dedupe_minutes).map_err(invalid)?;
            Ok(Schedule::Webhook {
                filters,
                dedupe_minutes,
            })
        }
    }
}

fn past_once(schedule: &Schedule, now: DateTime<Local>) -> bool {
    matches!(schedule, Schedule::Once { at } if *at <= now.timestamp_millis())
}

const PAST: &str = "Pick a time in the future.";

/// Validates and saves a task; returns its id. An edit keeps the run state and
/// recomputes the next run only when the schedule or `enabled` changed.
pub(crate) fn upsert(
    data: &mut AppData,
    input: ScheduledTaskInput,
    now: DateTime<Local>,
    created_by: CreatedBy,
) -> Result<String> {
    let title = input.title.trim();
    if title.is_empty()
        || title.chars().count() > TITLE_LIMIT
        || title.chars().any(char::is_control)
    {
        return Err(invalid("Titles need 1 to 200 characters."));
    }
    let prompt = input.prompt.trim();
    if prompt.is_empty() || prompt.len() > PROMPT_LIMIT || prompt.contains('\0') {
        return Err(invalid("The prompt must have 1 to 65,536 bytes."));
    }
    if !data
        .projects
        .iter()
        .any(|project| project.id == input.project_id)
    {
        return Err(Error::not_found("project not found"));
    }
    if !data.provider_enabled(&input.agent) {
        return Err(Error::agent("Enable this provider in Settings first."));
    }
    if input
        .model
        .as_deref()
        .is_some_and(|model| !crate::launch::valid_model(model))
    {
        return Err(invalid("Invalid model."));
    }
    crate::execution::approval_for(&input.agent, input.approval)?;
    if let Some(session_id) = &input.session_id {
        let session = data
            .sessions
            .iter()
            .find(|session| session.id == *session_id && !session.is_auxiliary())
            .ok_or_else(|| Error::not_found(MISSING))?;
        if session.project_id != input.project_id {
            return Err(invalid(
                "The conversation must belong to the task's project.",
            ));
        }
    }
    let schedule = validate_schedule(input.schedule)?;
    let stamp = now.timestamp_millis();
    let next = |enabled: bool, schedule: &Schedule| {
        enabled
            .then(|| next_run(schedule, now).map(|at| at.timestamp_millis()))
            .flatten()
    };
    match input.id {
        Some(id) => {
            let task = find(data, &id)?;
            let rescheduled = task.schedule != schedule || task.enabled != input.enabled;
            if rescheduled && input.enabled && past_once(&schedule, now) {
                return Err(invalid(PAST));
            }
            if input.enabled && !task.enabled {
                task.failure_streak = 0;
            }
            if rescheduled {
                task.next_run_at = next(input.enabled, &schedule);
            }
            task.title = title.to_owned();
            task.prompt = prompt.to_owned();
            task.project_id = input.project_id;
            task.agent = input.agent;
            task.model = input.model;
            if !matches!(schedule, Schedule::Webhook { .. }) {
                task.webhook_secret = None;
            } else if task.webhook_secret.is_none() {
                task.webhook_secret = Some(crate::scheduled_webhooks::new_secret());
            }
            task.schedule = schedule;
            task.session_id = input.session_id;
            task.approval = input.approval;
            task.enabled = input.enabled;
            task.updated_at = stamp;
            Ok(id)
        }
        None => {
            if past_once(&schedule, now) {
                return Err(invalid(PAST));
            }
            if data.scheduled_tasks.len() >= MAX_TASKS {
                return Err(invalid("At most 50 scheduled tasks."));
            }
            let id = Uuid::new_v4().to_string();
            let webhook_secret = matches!(schedule, Schedule::Webhook { .. })
                .then(crate::scheduled_webhooks::new_secret);
            data.scheduled_tasks.push(ScheduledTask {
                id: id.clone(),
                title: title.to_owned(),
                prompt: prompt.to_owned(),
                project_id: input.project_id,
                agent: input.agent,
                model: input.model,
                next_run_at: next(input.enabled, &schedule),
                schedule,
                session_id: input.session_id,
                approval: input.approval,
                enabled: input.enabled,
                created_by,
                created_at: stamp,
                updated_at: stamp,
                last_run_at: None,
                last_status: Status::Never,
                last_error: None,
                last_session_id: None,
                run_count: 0,
                failure_streak: 0,
                webhook_secret,
            });
            Ok(id)
        }
    }
}

pub(crate) fn set_enabled(
    data: &mut AppData,
    id: &str,
    enabled: bool,
    now: DateTime<Local>,
) -> Result<()> {
    let task = find(data, id)?;
    if task.enabled == enabled {
        return Ok(());
    }
    if enabled && past_once(&task.schedule, now) {
        return Err(invalid(PAST));
    }
    task.enabled = enabled;
    task.updated_at = now.timestamp_millis();
    task.next_run_at = if enabled {
        task.failure_streak = 0;
        next_run(&task.schedule, now).map(|at| at.timestamp_millis())
    } else {
        None
    };
    Ok(())
}

fn at_local(date: NaiveDate, time: NaiveTime) -> Option<DateTime<Local>> {
    // A nonexistent local time (DST gap) resolves to the next valid instant; a repeated
    // one (DST fold) to its first occurrence.
    Local
        .from_local_datetime(&date.and_time(time))
        .earliest()
        .or_else(|| {
            Local
                .from_local_datetime(&(date.and_time(time) + Span::hours(1)))
                .earliest()
        })
}

/// The first run strictly after `after`, or `None` for a `once` already past.
pub fn next_run(schedule: &Schedule, after: DateTime<Local>) -> Option<DateTime<Local>> {
    let today = after.date_naive();
    let on_days = |accept: &dyn Fn(u32) -> bool, time: NaiveTime| {
        (0..9).find_map(|offset| {
            let date = today + Span::days(offset);
            if !accept(date.weekday().num_days_from_sunday()) {
                return None;
            }
            at_local(date, time).filter(|at| *at > after)
        })
    };
    match schedule {
        Schedule::Once { at } => local(*at).filter(|at| *at > after),
        Schedule::Daily { time } => on_days(&|_| true, parse_time(time)?),
        Schedule::Weekly { days, time } => on_days(
            &|day| days.iter().any(|wanted| u32::from(*wanted) == day),
            parse_time(time)?,
        ),
        Schedule::Interval { minutes } => Some(after + Span::minutes(i64::from(*minutes))),
        Schedule::Webhook { .. } => None,
    }
}

/// One pass of the timer over the tasks: runs more than ten minutes late are recorded as
/// missed (an `interval` runs once instead), due ones move to their next occurrence before
/// they start, so nothing fires twice. Returns the tasks to run now and whether anything changed.
pub(crate) fn sweep(tasks: &mut [ScheduledTask], now: DateTime<Local>) -> (Vec<String>, bool) {
    let now_ms = now.timestamp_millis();
    let mut due = vec![];
    let mut changed = false;
    for task in tasks.iter_mut().filter(|task| task.enabled) {
        let Some(at) = task.next_run_at else {
            continue;
        };
        if at > now_ms {
            continue;
        }
        changed = true;
        let once = matches!(task.schedule, Schedule::Once { .. });
        let interval = matches!(task.schedule, Schedule::Interval { .. });
        if once {
            task.enabled = false;
            task.next_run_at = None;
        } else {
            task.next_run_at = next_run(&task.schedule, now).map(|at| at.timestamp_millis());
        }
        if now_ms - at > MISSED_AFTER_MS && !interval {
            task.last_status = Status::Missed;
            task.last_error = Some(MISSED.into());
        } else {
            due.push(task.id.clone());
        }
    }
    (due, changed)
}

/// Records one failed run; the third in a row pauses the task.
fn record_failure(task: &mut ScheduledTask, error: &str) {
    task.failure_streak += 1;
    task.last_status = Status::Failed;
    if task.failure_streak >= FAILURES_BEFORE_PAUSE {
        task.enabled = false;
        task.next_run_at = None;
        task.last_error = Some(format!(
            "Paused after {FAILURES_BEFORE_PAUSE} failed runs: {error}"
        ));
    } else {
        task.last_error = Some(error.to_owned());
    }
}

/// Whether a bound conversation can take a turn now: its provider, or why not.
fn bound_ready(
    data: &AppData,
    session_id: &str,
) -> std::result::Result<AgentProviderId, &'static str> {
    let session = data
        .sessions
        .iter()
        .find(|session| session.id == session_id && !session.is_auxiliary())
        .ok_or(MISSING)?;
    if session.status.is_active() || !session.pending_requests.is_empty() {
        return Err(BUSY);
    }
    Ok(session.agent.clone())
}

fn active(data: &AppData, session_id: Option<&str>) -> bool {
    session_id.is_some_and(|id| {
        data.sessions
            .iter()
            .any(|session: &Session| session.id == id && session.status.is_active())
    })
}

enum Plan {
    New(Box<Launch>),
    Bound {
        session_id: String,
        prompt: String,
        approval: Option<ApprovalMode>,
    },
    /// Recorded without a start (a failure or a skip).
    Recorded,
    /// Nothing to record (waiting for a busy conversation).
    Quiet,
}

fn waiting_since(id: &str) -> Option<i64> {
    WAITING
        .lock()
        .as_ref()
        .and_then(|waiting| waiting.get(id).copied())
}

fn stop_waiting(id: &str) {
    if let Some(waiting) = WAITING.lock().as_mut() {
        waiting.remove(id);
    }
}

/// Starts one run. `manual` (Run now) refuses with an error where a scheduled run would
/// skip or wait, and leaves the next run where it is.
pub async fn run(app: &AppHandle, state: &Arc<AppState>, id: &str, manual: bool) -> Result<()> {
    run_with(app, state, id, manual, None).await
}

/// Runs a webhook task's accepted delivery (ADR-161). While its previous run still works it
/// waits as the task's one follow-up (a later delivery replaces it), started by the timer.
pub async fn run_delivery(app: &AppHandle, state: &Arc<AppState>, id: &str, prompt: String) {
    if let Err(error) = run_with(app, state, id, false, Some(prompt)).await {
        tracing::warn!(%error, "a webhook delivery did not run");
    }
}

fn hold_follow_up(id: &str, prompt: String) {
    PENDING
        .lock()
        .get_or_insert_with(HashMap::new)
        .insert(id.to_owned(), prompt);
    wake();
}

/// Follow-ups whose task is free again, taken off the queue.
fn ready_follow_ups(data: &AppData) -> Vec<(String, String)> {
    let mut guard = PENDING.lock();
    let Some(pending) = guard.as_mut() else {
        return vec![];
    };
    let starting = STARTING.lock();
    let ready: Vec<String> = pending
        .keys()
        .filter(|id| !starting.as_ref().is_some_and(|set| set.contains(*id)))
        .filter(|id| {
            data.scheduled_tasks
                .iter()
                .find(|task| task.id == **id)
                .is_none_or(|task| match &task.session_id {
                    Some(session) => bound_ready(data, session) != Err(BUSY),
                    None => !active(data, task.last_session_id.as_deref()),
                })
        })
        .cloned()
        .collect();
    ready
        .into_iter()
        .filter_map(|id| pending.remove(&id).map(|prompt| (id, prompt)))
        .collect()
}

async fn run_with(
    app: &AppHandle,
    state: &Arc<AppState>,
    id: &str,
    manual: bool,
    delivery: Option<String>,
) -> Result<()> {
    let plan = {
        let mut data = state.data.lock();
        state.ensure_running()?;
        let now = now_ms();
        let task = data
            .scheduled_tasks
            .iter()
            .find(|task| task.id == id)
            .cloned()
            .ok_or_else(|| Error::not_found("scheduled task not found"))?;
        if !manual && delivery.is_none() && matches!(task.schedule, Schedule::Webhook { .. }) {
            return Ok(());
        }
        if manual && matches!(task.schedule, Schedule::Webhook { .. }) {
            return Err(Error::agent("Webhook tasks run when their URL is called."));
        }
        if STARTING
            .lock()
            .as_ref()
            .is_some_and(|starting| starting.contains(id))
        {
            if let Some(prompt) = delivery {
                hold_follow_up(id, prompt);
                return Ok(());
            }
            return if manual {
                Err(Error::agent("This task is already starting."))
            } else {
                Ok(())
            };
        }
        let prompt = delivery.clone().unwrap_or_else(|| task.prompt.clone());
        let plan = match &task.session_id {
            None if active(&data, task.last_session_id.as_deref()) && delivery.is_some() => {
                hold_follow_up(id, prompt.clone());
                Plan::Quiet
            }
            None if active(&data, task.last_session_id.as_deref()) => {
                if manual {
                    return Err(Error::agent("The previous run is still working."));
                }
                find(&mut data, id)?.last_error = Some(OVERLAP.into());
                Plan::Recorded
            }
            None => Plan::New(Box::new(Launch {
                project_id: task.project_id.clone(),
                title: task.title.clone(),
                agent: task.agent.clone(),
                model: task.model.clone(),
                isolated_worktree: true,
                prompt: prompt.clone(),
                approval: task.approval,
                planning: false,
                delegated_by: None,
                share_worktree: None,
            })),
            Some(session_id) => match bound_ready(&data, session_id) {
                Err(BUSY) if manual => return Err(Error::agent("The conversation is busy.")),
                Err(BUSY) if delivery.is_some() => {
                    hold_follow_up(id, prompt.clone());
                    Plan::Quiet
                }
                Err(BUSY) => {
                    let since = waiting_since(id).unwrap_or(now);
                    if now - since >= BUSY_RETRY_MS {
                        stop_waiting(id);
                        record_failure(find(&mut data, id)?, BUSY);
                        Plan::Recorded
                    } else {
                        WAITING
                            .lock()
                            .get_or_insert_with(HashMap::new)
                            .insert(id.to_owned(), since);
                        Plan::Quiet
                    }
                }
                Err(error) => {
                    stop_waiting(id);
                    record_failure(find(&mut data, id)?, error);
                    Plan::Recorded
                }
                Ok(agent) => {
                    stop_waiting(id);
                    match crate::execution::approval_for(&agent, task.approval) {
                        Ok(approval) => Plan::Bound {
                            session_id: session_id.clone(),
                            prompt: prompt.clone(),
                            approval,
                        },
                        Err(error) => {
                            record_failure(find(&mut data, id)?, &error.to_string());
                            Plan::Recorded
                        }
                    }
                }
            },
        };
        if matches!(plan, Plan::New(_) | Plan::Bound { .. }) {
            let entry = find(&mut data, id)?;
            entry.last_status = Status::Running;
            entry.last_error = None;
            entry.last_run_at = Some(now);
            entry.run_count = entry.run_count.saturating_add(1);
            STARTING
                .lock()
                .get_or_insert_with(HashSet::new)
                .insert(id.to_owned());
        }
        plan
    };
    if matches!(plan, Plan::Quiet) {
        return Ok(());
    }
    let _ = state.persist();
    emit(app, state);
    let (session_id, error) = match plan {
        Plan::New(request) => launch(app, state, *request).await,
        Plan::Bound {
            session_id,
            prompt,
            approval,
        } => {
            let request = SendPromptRequest {
                queued_after: None,
                debugging: false,
                goal: None,
                session_id: session_id.clone(),
                attachment_ids: vec![],
                attachment_owner: String::new(),
                prompt,
                execution: ExecutionOptions {
                    approval,
                    ..Default::default()
                },
                team: false,
                client_request_id: None,
            };
            let sent =
                crate::commands::send_prompt(app.clone(), app.state::<Arc<AppState>>(), request)
                    .await;
            (
                Some(session_id),
                sent.err().map(|error| short(&error.to_string())),
            )
        }
        Plan::Recorded | Plan::Quiet => return Ok(()),
    };
    {
        let mut data = state.data.lock();
        if let Some(task) = data.scheduled_tasks.iter_mut().find(|task| task.id == id) {
            if session_id.is_some() {
                task.last_session_id = session_id;
            }
            match error {
                Some(error) => record_failure(task, &error),
                None => {
                    task.last_status = Status::Succeeded;
                    task.last_error = None;
                    task.failure_streak = 0;
                }
            }
        }
    }
    if let Some(starting) = STARTING.lock().as_mut() {
        starting.remove(id);
    }
    let _ = state.persist();
    emit(app, state);
    Ok(())
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

/// A removed project removes its scheduled tasks. Returns whether any went.
pub fn prune(data: &mut AppData) -> bool {
    let projects: HashSet<&str> = data
        .projects
        .iter()
        .map(|project| project.id.as_str())
        .collect();
    let before = data.scheduled_tasks.len();
    let kept: Vec<ScheduledTask> = std::mem::take(&mut data.scheduled_tasks)
        .into_iter()
        .filter(|task| projects.contains(task.project_id.as_str()))
        .collect();
    data.scheduled_tasks = kept;
    data.scheduled_tasks.len() != before
}

/// A run cut by a quit or crash before its turn was admitted reads as failed.
fn settle_interrupted(data: &mut AppData) -> bool {
    let mut changed = false;
    for task in &mut data.scheduled_tasks {
        if task.last_status == Status::Running {
            task.last_status = Status::Failed;
            task.last_error = Some(INTERRUPTED.into());
            changed = true;
        }
    }
    changed
}

/// Starts the single scheduler timer (desktop and host).
pub fn start(app: AppHandle) {
    let _ = APP.set(app.clone());
    let notify = WAKE.get_or_init(|| Arc::new(Notify::new())).clone();
    crate::runtime::async_runtime::spawn(async move {
        let state = app.state::<Arc<AppState>>().inner().clone();
        {
            let mut data = state.data.lock();
            let changed = prune(&mut data) | settle_interrupted(&mut data);
            drop(data);
            if changed {
                let _ = state.persist();
            }
        }
        loop {
            if state.ensure_running().is_err() {
                return;
            }
            let (due, changed) = {
                let mut data = state.data.lock();
                sweep(&mut data.scheduled_tasks, Local::now())
            };
            if changed {
                if let Err(error) = state.persist() {
                    tracing::warn!(%error, "scheduled tasks were not saved");
                }
                emit(&app, &state);
            }
            let retries: Vec<String> = WAITING
                .lock()
                .as_ref()
                .map(|waiting| waiting.keys().cloned().collect())
                .unwrap_or_default();
            for id in due
                .iter()
                .chain(retries.iter().filter(|id| !due.contains(id)))
            {
                if let Err(error) = run(&app, &state, id, false).await {
                    tracing::warn!(%error, "a scheduled task did not run");
                    stop_waiting(id);
                }
            }
            let follow_ups = ready_follow_ups(&state.data.lock());
            for (id, prompt) in follow_ups {
                run_delivery(&app, &state, &id, prompt).await;
            }
            let earliest = {
                let data = state.data.lock();
                data.scheduled_tasks
                    .iter()
                    .filter(|task| task.enabled)
                    .filter_map(|task| task.next_run_at)
                    .min()
            };
            let wait = earliest
                .map(|at| Duration::from_millis(at.saturating_sub(now_ms()).max(0) as u64))
                .unwrap_or(MAX_SLEEP)
                .min(MAX_SLEEP);
            tokio::select! {
                _ = tokio::time::sleep(wait) => {}
                _ = notify.notified() => {}
            }
        }
    });
}

// Agent tools (ADR-142), dispatched from `sirus_tools.rs` behind its setting and checks.

pub const TOOLS: [&str; 5] = [
    "sirus_schedule_task",
    "sirus_list_scheduled_tasks",
    "sirus_update_scheduled_task",
    "sirus_delete_scheduled_task",
    "sirus_run_scheduled_task_now",
];

pub fn tool_definitions() -> Vec<Value> {
    let schedule = json!({
        "type": "object",
        "description": "When it runs, in the person's local time: {\"kind\":\"once\",\"at\":\"2026-10-20T09:00\"} (ISO 8601 or Unix ms), {\"kind\":\"daily\",\"time\":\"09:00\"}, {\"kind\":\"weekly\",\"days\":[1,3,5],\"time\":\"09:00\"} (0 = Sunday … 6 = Saturday) or {\"kind\":\"interval\",\"minutes\":60} (15 to 10080).",
        "properties": {
            "kind": { "type": "string", "enum": ["once", "daily", "weekly", "interval"] },
            "at": { "type": ["string", "integer"] },
            "time": { "type": "string" },
            "days": { "type": "array", "items": { "type": "integer" } },
            "minutes": { "type": "integer" }
        },
        "required": ["kind"]
    });
    let id = json!({ "type": "object", "properties": { "id": { "type": "string" } }, "required": ["id"] });
    vec![
        json!({ "name": "sirus_schedule_task", "description": "Sirus Code: schedule a prompt to run by itself later or repeatedly, for example when the person asks to check something every morning. By default every run continues this conversation; with bindToThisConversation false each run starts a new conversation in its own worktree. Runs use your provider, model and approval mode. Returns the task with its next run.", "inputSchema": { "type": "object", "properties": { "title": { "type": "string", "description": "A short name; defaults to the prompt's first line." }, "prompt": { "type": "string", "description": "What each run is asked to do, self-contained." }, "schedule": schedule, "bindToThisConversation": { "type": "boolean", "description": "Default true." }, "project": { "type": "string", "description": "Project name or id for new-conversation runs; defaults to yours." }, "model": { "type": "string" }, "enabled": { "type": "boolean", "description": "Default true." } }, "required": ["prompt", "schedule"] } }),
        json!({ "name": "sirus_list_scheduled_tasks", "description": "Sirus Code: the scheduled tasks (id, title, schedule, enabled, next run, last status).", "inputSchema": { "type": "object", "properties": { "project": { "type": "string", "description": "Only tasks of this project (name or id)." } } } }),
        json!({ "name": "sirus_update_scheduled_task", "description": "Sirus Code: change a scheduled task's title, prompt or schedule, or turn it on or off. Omitted fields stay as they are.", "inputSchema": { "type": "object", "properties": { "id": { "type": "string" }, "title": { "type": "string" }, "prompt": { "type": "string" }, "schedule": schedule, "enabled": { "type": "boolean" } }, "required": ["id"] } }),
        json!({ "name": "sirus_delete_scheduled_task", "description": "Sirus Code: delete a scheduled task.", "inputSchema": id.clone() }),
        json!({ "name": "sirus_run_scheduled_task_now", "description": "Sirus Code: run a scheduled task once now; its schedule stays as it is.", "inputSchema": id }),
    ]
}

/// The tool's schedule: the stored shape, with `once.at` also as ISO 8601 (local when
/// it carries no offset).
pub(crate) fn parse_schedule(value: &Value) -> std::result::Result<Schedule, String> {
    if value.get("kind").and_then(Value::as_str) == Some("webhook") {
        return Err(
            "webhook tasks are made by the person in Tasks → Scheduled, where the URL is shown"
                .into(),
        );
    }
    let mut value = value.clone();
    if value.get("kind").and_then(Value::as_str) == Some("once") {
        if let Some(text) = value.get("at").and_then(Value::as_str) {
            let at = parse_instant(text).ok_or(
                "schedule.at must be ISO 8601 (for example 2026-10-20T09:00) or Unix milliseconds",
            )?;
            value["at"] = json!(at);
        }
    }
    serde_json::from_value(value).map_err(|error| format!("invalid schedule: {error}"))
}

fn parse_instant(text: &str) -> Option<i64> {
    let text = text.trim();
    if let Ok(at) = DateTime::parse_from_rfc3339(text) {
        return Some(at.timestamp_millis());
    }
    [
        "%Y-%m-%dT%H:%M:%S",
        "%Y-%m-%dT%H:%M",
        "%Y-%m-%d %H:%M:%S",
        "%Y-%m-%d %H:%M",
    ]
    .iter()
    .find_map(|format| chrono::NaiveDateTime::parse_from_str(text, format).ok())
    .and_then(|naive| at_local(naive.date(), naive.time()))
    .map(|at| at.timestamp_millis())
}

const DAY_NAMES: [&str; 7] = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

pub(crate) fn schedule_label(schedule: &Schedule) -> String {
    match schedule {
        Schedule::Once { at } => match local(*at) {
            Some(at) => format!("once at {}", at.format("%Y-%m-%d %H:%M")),
            None => "once".into(),
        },
        Schedule::Daily { time } => format!("daily at {time}"),
        Schedule::Weekly { days, time } => format!(
            "weekly on {} at {time}",
            days.iter()
                .filter_map(|day| DAY_NAMES.get(usize::from(*day)))
                .copied()
                .collect::<Vec<_>>()
                .join(", ")
        ),
        Schedule::Interval { minutes } => format!("every {minutes} minutes"),
        Schedule::Webhook { .. } => "when its webhook URL is called".into(),
    }
}

fn iso(ms: Option<i64>) -> Option<String> {
    ms.and_then(local).map(|at| at.to_rfc3339())
}

pub(crate) fn tool_row(data: &AppData, task: &ScheduledTask) -> Value {
    json!({
        "id": task.id,
        "title": task.title,
        "schedule": schedule_label(&task.schedule),
        "project": data.projects.iter().find(|project| project.id == task.project_id).map(|project| project.name.clone()),
        "conversation": task.session_id,
        "enabled": task.enabled,
        "nextRunAt": iso(task.next_run_at),
        "lastRunAt": iso(task.last_run_at),
        "lastStatus": task.last_status,
        "lastError": task.last_error,
    })
}

/// An agent may only change tasks that run with no broader access than its own.
fn within(task: &ScheduledTask, caller: ApprovalMode) -> std::result::Result<(), String> {
    if crate::execution::approval_rank(task.approval) > crate::execution::approval_rank(caller) {
        return Err(
            "that task runs with broader access than this conversation; only the person can change it"
                .into(),
        );
    }
    Ok(())
}

/// The arguments of `sirus_schedule_task` as an input (validated again by `upsert`).
pub(crate) fn schedule_input(
    data: &AppData,
    caller: &Session,
    args: &Value,
) -> std::result::Result<ScheduledTaskInput, String> {
    let text = |key: &str| {
        args.get(key)
            .and_then(Value::as_str)
            .map(str::trim)
            .unwrap_or_default()
            .to_owned()
    };
    let prompt = text("prompt");
    if prompt.is_empty() {
        return Err("prompt is required".into());
    }
    let schedule = parse_schedule(args.get("schedule").ok_or("schedule is required")?)?;
    let bound = args
        .get("bindToThisConversation")
        .and_then(Value::as_bool)
        .unwrap_or(true);
    let project_id = match text("project") {
        wanted if wanted.is_empty() => caller.project_id.clone(),
        wanted => data
            .projects
            .iter()
            .find(|project| project.id == wanted || project.name.eq_ignore_ascii_case(&wanted))
            .map(|project| project.id.clone())
            .ok_or("no project with that name or id")?,
    };
    if bound && project_id != caller.project_id {
        return Err("a task bound to this conversation runs in its project; set bindToThisConversation to false for another project".into());
    }
    let title = match text("title") {
        title if !title.is_empty() => title,
        _ => prompt
            .lines()
            .next()
            .unwrap_or_default()
            .chars()
            .take(60)
            .collect(),
    };
    let model = match text("model") {
        model if !model.is_empty() => Some(model),
        _ => caller.model.clone(),
    };
    Ok(ScheduledTaskInput {
        id: None,
        title,
        prompt,
        project_id,
        agent: caller.agent.clone(),
        model,
        schedule,
        session_id: bound.then(|| caller.id.clone()),
        approval: crate::launch::inherited_approval(caller),
        enabled: args.get("enabled").and_then(Value::as_bool).unwrap_or(true),
    })
}

/// Runs one scheduled-task tool for `caller` (already allowed and not read-only).
pub fn execute_tool(
    app: &AppHandle,
    state: &Arc<AppState>,
    caller: &Session,
    tool: &str,
    args: &Value,
) -> std::result::Result<Value, String> {
    let id = args
        .get("id")
        .and_then(Value::as_str)
        .map(str::trim)
        .unwrap_or_default()
        .to_owned();
    let approval = crate::launch::inherited_approval(caller);
    let result = match tool {
        "sirus_list_scheduled_tasks" => {
            let data = state.data.lock();
            let project = args
                .get("project")
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|wanted| !wanted.is_empty())
                .map(|wanted| {
                    data.projects
                        .iter()
                        .find(|project| {
                            project.id == wanted || project.name.eq_ignore_ascii_case(wanted)
                        })
                        .map(|project| project.id.clone())
                        .ok_or("no project with that name or id")
                })
                .transpose()?;
            let rows: Vec<Value> = data
                .scheduled_tasks
                .iter()
                .filter(|task| project.as_ref().is_none_or(|id| task.project_id == *id))
                .map(|task| tool_row(&data, task))
                .collect();
            return Ok(json!({ "tasks": rows }));
        }
        "sirus_run_scheduled_task_now" => {
            {
                let data = state.data.lock();
                let task = data
                    .scheduled_tasks
                    .iter()
                    .find(|task| task.id == id)
                    .ok_or("scheduled task not found")?;
                within(task, approval)?;
            }
            crate::runtime::async_runtime::block_on(run(app, state, &id, true))
                .map_err(|error| error.to_string())?;
            let data = state.data.lock();
            let task = data
                .scheduled_tasks
                .iter()
                .find(|task| task.id == id)
                .ok_or("scheduled task not found")?;
            return Ok(json!({ "ran": tool_row(&data, task), "sessionId": task.last_session_id }));
        }
        "sirus_schedule_task" => {
            let mut data = state.data.lock();
            let input = schedule_input(&data, caller, args)?;
            let id = upsert(&mut data, input, Local::now(), CreatedBy::Agent)
                .map_err(|error| error.to_string())?;
            let task = data
                .scheduled_tasks
                .iter()
                .find(|task| task.id == id)
                .ok_or("scheduled task not saved")?;
            json!({ "scheduled": tool_row(&data, task) })
        }
        "sirus_update_scheduled_task" => {
            let mut data = state.data.lock();
            let existing = data
                .scheduled_tasks
                .iter()
                .find(|task| task.id == id)
                .cloned()
                .ok_or("scheduled task not found")?;
            within(&existing, approval)?;
            let text = |key: &str, fallback: &str| {
                args.get(key)
                    .and_then(Value::as_str)
                    .map(str::to_owned)
                    .unwrap_or_else(|| fallback.to_owned())
            };
            let schedule = match args.get("schedule") {
                Some(value) => parse_schedule(value)?,
                None => existing.schedule.clone(),
            };
            let input = ScheduledTaskInput {
                id: Some(existing.id.clone()),
                title: text("title", &existing.title),
                prompt: text("prompt", &existing.prompt),
                project_id: existing.project_id.clone(),
                agent: existing.agent.clone(),
                model: existing.model.clone(),
                schedule,
                session_id: existing.session_id.clone(),
                approval: existing.approval,
                enabled: args
                    .get("enabled")
                    .and_then(Value::as_bool)
                    .unwrap_or(existing.enabled),
            };
            upsert(&mut data, input, Local::now(), CreatedBy::Agent)
                .map_err(|error| error.to_string())?;
            let task = data
                .scheduled_tasks
                .iter()
                .find(|task| task.id == id)
                .ok_or("scheduled task not saved")?;
            json!({ "updated": tool_row(&data, task) })
        }
        "sirus_delete_scheduled_task" => {
            let mut data = state.data.lock();
            let existing = data
                .scheduled_tasks
                .iter()
                .find(|task| task.id == id)
                .ok_or("scheduled task not found")?;
            within(existing, approval)?;
            delete(&mut data, &id).map_err(|error| error.to_string())?;
            json!({ "deleted": true, "id": id })
        }
        _ => return Err("unknown Sirus tool".into()),
    };
    state.persist().map_err(|error| error.to_string())?;
    wake();
    emit(app, state);
    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn at(date: &str, time: &str) -> DateTime<Local> {
        let date = NaiveDate::parse_from_str(date, "%Y-%m-%d").unwrap();
        at_local(date, parse_time(time).unwrap()).unwrap()
    }

    fn data() -> AppData {
        let mut data: AppData = serde_json::from_value(json!({
            "settings": {},
            "projects": [
                { "id": "p", "name": "Site", "path": "/fixture", "addedAt": "t", "lastOpenedAt": "t" },
                { "id": "q", "name": "Other", "path": "/other", "addedAt": "t", "lastOpenedAt": "t" }
            ],
            "sessions": []
        }))
        .unwrap();
        data.sessions.push(session("s", "p"));
        data
    }

    fn session(id: &str, project: &str) -> Session {
        serde_json::from_value(json!({
            "id": id, "title": id, "projectId": project, "agent": "claude", "status": "completed",
            "createdAt": "t", "lastActivityAt": "t", "worktree": { "path": "/tmp", "branch": "main", "isolated": false },
            "messages": [],
            "execution": { "approval": "auto" }
        }))
        .unwrap()
    }

    fn input(schedule: Schedule) -> ScheduledTaskInput {
        ScheduledTaskInput {
            id: None,
            title: "Morning check".into(),
            prompt: "  Look at the CI.  ".into(),
            project_id: "p".into(),
            agent: AgentProviderId::Claude,
            model: None,
            schedule,
            session_id: None,
            approval: ApprovalMode::Ask,
            enabled: true,
        }
    }

    fn daily(time: &str) -> Schedule {
        Schedule::Daily { time: time.into() }
    }

    #[test]
    fn daily_runs_later_today_or_tomorrow() {
        // 2026-10-14 is a Wednesday.
        let now = at("2026-10-14", "08:00");
        assert_eq!(
            next_run(&daily("09:30"), now),
            Some(at("2026-10-14", "09:30"))
        );
        assert_eq!(
            next_run(&daily("08:00"), now),
            Some(at("2026-10-15", "08:00"))
        );
        assert_eq!(
            next_run(&daily("07:00"), now),
            Some(at("2026-10-15", "07:00"))
        );
        assert_eq!(next_run(&daily("25:00"), now), None);
    }

    #[test]
    fn weekly_counts_from_sunday_and_wraps_the_week() {
        let wednesday = at("2026-10-14", "10:00");
        let weekly = |days: Vec<u8>, time: &str| Schedule::Weekly {
            days,
            time: time.into(),
        };
        // Sunday is 0.
        assert_eq!(
            next_run(&weekly(vec![0], "09:00"), wednesday),
            Some(at("2026-10-18", "09:00"))
        );
        // Wednesday later today, and earlier today wraps to next week.
        assert_eq!(
            next_run(&weekly(vec![3], "11:00"), wednesday),
            Some(at("2026-10-14", "11:00"))
        );
        assert_eq!(
            next_run(&weekly(vec![3], "09:00"), wednesday),
            Some(at("2026-10-21", "09:00"))
        );
        // Saturday (6) then Monday (1).
        let saturday_night = at("2026-10-17", "23:00");
        assert_eq!(
            next_run(&weekly(vec![1, 6], "08:00"), saturday_night),
            Some(at("2026-10-19", "08:00"))
        );
    }

    #[test]
    fn interval_and_once() {
        let now = at("2026-10-14", "10:00");
        assert_eq!(
            next_run(&Schedule::Interval { minutes: 90 }, now),
            Some(now + Span::minutes(90))
        );
        let later = at("2026-10-15", "12:00").timestamp_millis();
        assert_eq!(
            next_run(&Schedule::Once { at: later }, now).map(|at| at.timestamp_millis()),
            Some(later)
        );
        assert_eq!(
            next_run(&Schedule::Once { at: later }, at("2026-10-16", "00:00")),
            None
        );
    }

    #[test]
    fn local_times_hold_across_days() {
        // Every daily run lands on its wall-clock time, whatever the offset that day.
        let mut cursor = at("2026-01-01", "00:00");
        for _ in 0..400 {
            let next = next_run(&daily("12:00"), cursor).unwrap();
            assert_eq!(next.format("%H:%M").to_string(), "12:00");
            assert!(next > cursor);
            cursor = next;
        }
    }

    #[test]
    fn inputs_are_validated() {
        let mut data = data();
        let now = at("2026-10-14", "10:00");
        let id = upsert(&mut data, input(daily("09:00")), now, CreatedBy::Person).unwrap();
        let task = &data.scheduled_tasks[0];
        assert_eq!(task.id, id);
        assert_eq!(task.prompt, "Look at the CI.");
        assert_eq!(task.last_status, Status::Never);
        assert_eq!(
            task.next_run_at,
            Some(at("2026-10-15", "09:00").timestamp_millis())
        );
        let bad = |change: &dyn Fn(&mut ScheduledTaskInput)| {
            let mut value = input(daily("09:00"));
            change(&mut value);
            upsert(&mut data.clone(), value, now, CreatedBy::Person)
                .unwrap_err()
                .to_string()
        };
        assert!(bad(&|i| i.title = " ".into()).contains("Titles"));
        assert!(bad(&|i| i.title = "a\u{7}b".into()).contains("Titles"));
        assert!(bad(&|i| i.title = "x".repeat(201)).contains("Titles"));
        assert!(bad(&|i| i.prompt = "x".repeat(PROMPT_LIMIT + 1)).contains("prompt"));
        assert!(bad(&|i| i.prompt = "a\0b".into()).contains("prompt"));
        assert!(bad(&|i| i.project_id = "missing".into()).contains("project"));
        assert!(bad(&|i| i.model = Some("--bad".into())).contains("model"));
        assert!(bad(&|i| i.schedule = daily("9:00")).contains("HH:MM"));
        assert!(bad(&|i| i.schedule = Schedule::Interval { minutes: 10 }).contains("15"));
        assert!(bad(&|i| i.schedule = Schedule::Weekly {
            days: vec![],
            time: "09:00".into()
        })
        .contains("day"));
        assert!(bad(&|i| i.schedule = Schedule::Weekly {
            days: vec![7],
            time: "09:00".into()
        })
        .contains("day"));
        assert!(bad(&|i| i.schedule = Schedule::Once {
            at: now.timestamp_millis() - 1
        })
        .contains("future"));
        assert!(bad(&|i| i.session_id = Some("gone".into())).contains("no longer exists"));
        assert!(bad(&|i| {
            i.session_id = Some("s".into());
            i.project_id = "q".into();
        })
        .contains("project"));
        // Droid only offers auto: Ask cannot be stepped down further.
        assert!(!bad(&|i| i.agent = AgentProviderId::Droid).is_empty());
        let mut weekly = input(Schedule::Weekly {
            days: vec![5, 1, 5],
            time: "09:00".into(),
        });
        weekly.session_id = Some("s".into());
        upsert(&mut data, weekly, now, CreatedBy::Agent).unwrap();
        assert_eq!(
            data.scheduled_tasks[1].schedule,
            Schedule::Weekly {
                days: vec![1, 5],
                time: "09:00".into()
            }
        );
        for _ in 2..MAX_TASKS {
            upsert(&mut data, input(daily("09:00")), now, CreatedBy::Person).unwrap();
        }
        assert!(upsert(&mut data, input(daily("09:00")), now, CreatedBy::Person).is_err());
    }

    #[test]
    fn edits_keep_run_state_and_reschedule_only_on_schedule_or_enabled() {
        let mut data = data();
        let now = at("2026-10-14", "10:00");
        let id = upsert(&mut data, input(daily("09:00")), now, CreatedBy::Agent).unwrap();
        {
            let task = &mut data.scheduled_tasks[0];
            task.last_run_at = Some(1);
            task.last_status = Status::Succeeded;
            task.run_count = 4;
            task.last_session_id = Some("s".into());
            task.next_run_at = Some(42);
        }
        let mut edit = input(daily("09:00"));
        edit.id = Some(id.clone());
        edit.title = "Renamed".into();
        upsert(&mut data, edit.clone(), now, CreatedBy::Person).unwrap();
        let task = &data.scheduled_tasks[0];
        assert_eq!(task.title, "Renamed");
        assert_eq!(task.created_by, CreatedBy::Agent);
        assert_eq!(
            (task.run_count, task.last_status, task.last_run_at),
            (4, Status::Succeeded, Some(1))
        );
        assert_eq!(
            task.next_run_at,
            Some(42),
            "same schedule keeps the next run"
        );
        edit.schedule = daily("11:00");
        upsert(&mut data, edit.clone(), now, CreatedBy::Person).unwrap();
        assert_eq!(
            data.scheduled_tasks[0].next_run_at,
            Some(at("2026-10-14", "11:00").timestamp_millis())
        );
        edit.enabled = false;
        upsert(&mut data, edit, now, CreatedBy::Person).unwrap();
        assert_eq!(data.scheduled_tasks[0].next_run_at, None);
        set_enabled(&mut data, &id, true, now).unwrap();
        assert!(data.scheduled_tasks[0].next_run_at.is_some());
        // A finished one-time task keeps its past time through a rename.
        let soon = (now + Span::hours(1)).timestamp_millis();
        let once = upsert(
            &mut data,
            input(Schedule::Once { at: soon }),
            now,
            CreatedBy::Person,
        )
        .unwrap();
        let later = now + Span::minutes(61);
        let (due, _) = sweep(&mut data.scheduled_tasks, later);
        assert!(due.contains(&once));
        let mut rename = input(Schedule::Once { at: soon });
        rename.id = Some(once.clone());
        rename.enabled = false;
        rename.title = "Again".into();
        upsert(&mut data, rename.clone(), later, CreatedBy::Person).unwrap();
        rename.enabled = true;
        assert!(upsert(&mut data, rename, later, CreatedBy::Person).is_err());
        assert!(set_enabled(&mut data, &once, true, later).is_err());
    }

    #[test]
    fn late_runs_are_missed_except_intervals_and_never_burst() {
        let mut data = data();
        let created = at("2026-10-14", "08:00");
        upsert(&mut data, input(daily("09:00")), created, CreatedBy::Person).unwrap();
        upsert(
            &mut data,
            input(Schedule::Interval { minutes: 60 }),
            created,
            CreatedBy::Person,
        )
        .unwrap();
        let soon = at("2026-10-14", "09:00").timestamp_millis();
        upsert(
            &mut data,
            input(Schedule::Once { at: soon }),
            created,
            CreatedBy::Person,
        )
        .unwrap();
        // Five minutes late: everything due runs.
        let mut on_time = data.scheduled_tasks.clone();
        let (due, changed) = sweep(&mut on_time, at("2026-10-14", "09:05"));
        assert!(changed);
        assert_eq!(due.len(), 3);
        assert_eq!(
            on_time[0].next_run_at,
            Some(at("2026-10-15", "09:00").timestamp_millis())
        );
        assert!(!on_time[2].enabled && on_time[2].next_run_at.is_none());
        assert!(
            sweep(&mut on_time, at("2026-10-14", "09:06")).0.is_empty(),
            "no second fire"
        );
        // Two days late (the app was closed): daily and once are missed, interval runs once.
        let mut late = data.scheduled_tasks.clone();
        let wake = at("2026-10-16", "12:00");
        let (due, _) = sweep(&mut late, wake);
        assert_eq!(due, vec![late[1].id.clone()]);
        assert_eq!(late[0].last_status, Status::Missed);
        assert_eq!(
            late[0].next_run_at,
            Some(at("2026-10-17", "09:00").timestamp_millis())
        );
        assert_eq!(
            late[1].next_run_at,
            Some((wake + Span::minutes(60)).timestamp_millis())
        );
        assert_eq!(late[2].last_status, Status::Missed);
        assert!(!late[2].enabled && late[2].next_run_at.is_none());
        assert!(sweep(&mut late, wake).0.is_empty());
    }

    #[test]
    fn three_failures_in_a_row_pause_the_task() {
        let mut data = data();
        upsert(
            &mut data,
            input(daily("09:00")),
            at("2026-10-14", "08:00"),
            CreatedBy::Person,
        )
        .unwrap();
        let task = &mut data.scheduled_tasks[0];
        record_failure(task, "boom");
        record_failure(task, "boom");
        assert!(task.enabled);
        assert_eq!(task.last_error.as_deref(), Some("boom"));
        record_failure(task, "boom");
        assert!(!task.enabled && task.next_run_at.is_none());
        assert_eq!(task.last_status, Status::Failed);
        assert_eq!(
            task.last_error.as_deref(),
            Some("Paused after 3 failed runs: boom")
        );
        let id = task.id.clone();
        set_enabled(&mut data, &id, true, at("2026-10-14", "08:00")).unwrap();
        assert_eq!(data.scheduled_tasks[0].failure_streak, 0);
    }

    #[test]
    fn bound_conversations_must_be_free_and_present() {
        let mut data = data();
        assert_eq!(bound_ready(&data, "s"), Ok(AgentProviderId::Claude));
        data.sessions[0].status = crate::models::SessionStatus::Running;
        assert_eq!(bound_ready(&data, "s"), Err(BUSY));
        assert_eq!(bound_ready(&data, "gone"), Err(MISSING));
    }

    #[test]
    fn the_snapshot_and_actions_follow_the_contract() {
        let mut data = data();
        upsert(
            &mut data,
            input(daily("09:00")),
            at("2026-10-14", "08:00"),
            CreatedBy::Person,
        )
        .unwrap();
        let view = serde_json::to_value(snapshot(&data)).unwrap();
        let task = &view["tasks"][0];
        assert!(task.get("failureStreak").is_none());
        assert_eq!(
            task["schedule"],
            json!({ "kind": "daily", "time": "09:00" })
        );
        assert_eq!(task["lastStatus"], "never");
        assert_eq!(task["createdBy"], "person");
        assert!(task["nextRunAt"].is_i64());
        assert!(serde_json::from_str::<Action>(r#"{"type":"runNow","id":"x"}"#).is_ok());
        assert!(
            serde_json::from_str::<Action>(r#"{"type":"setEnabled","id":"x","enabled":true}"#)
                .is_ok()
        );
        assert!(serde_json::from_str::<Action>(r#"{"type":"upsert","task":{"title":"a","prompt":"b","projectId":"p","agent":"codex","model":null,"schedule":{"kind":"interval","minutes":15},"sessionId":null,"approval":"ask","enabled":true}}"#).is_ok());
        assert!(serde_json::from_str::<Action>(r#"{"type":"upsert","task":{"title":"a","prompt":"b","projectId":"p","agent":"codex","model":null,"schedule":{"kind":"hourly","minute":5},"sessionId":null,"approval":"ask","enabled":true}}"#).is_err());
        assert!(serde_json::from_str::<Action>(r#"{"type":"pause","id":"x"}"#).is_err());
        data.projects.retain(|project| project.id != "p");
        assert!(prune(&mut data));
        assert!(data.scheduled_tasks.is_empty());
    }

    #[test]
    fn webhook_tasks_hold_a_hidden_secret_and_never_run_on_the_clock() {
        let mut data = data();
        let now = at("2026-10-14", "08:00");
        let webhook: Schedule =
            serde_json::from_value(json!({ "kind": "webhook", "filters": [{ "path": " body.action ", "equals": "created" }] }))
                .unwrap();
        let id = upsert(&mut data, input(webhook.clone()), now, CreatedBy::Person).unwrap();
        let task = data.scheduled_tasks[0].clone();
        let secret = task
            .webhook_secret
            .clone()
            .expect("a webhook task has a secret");
        assert_eq!(task.next_run_at, None);
        assert_eq!(
            task.schedule,
            Schedule::Webhook {
                filters: vec![crate::scheduled_webhooks::Filter {
                    path: "body.action".into(),
                    equals: Some("created".into())
                }],
                dedupe_minutes: crate::scheduled_webhooks::DEFAULT_DEDUPE_MINUTES,
            }
        );
        let view = serde_json::to_value(snapshot(&data)).unwrap();
        assert!(view["tasks"][0].get("webhookSecret").is_none());
        assert!(!view.to_string().contains(&secret));
        // An edit keeps the secret; leaving the webhook schedule drops it.
        let mut edit = input(webhook);
        edit.id = Some(id.clone());
        upsert(&mut data, edit, now, CreatedBy::Person).unwrap();
        assert_eq!(
            data.scheduled_tasks[0].webhook_secret.as_deref(),
            Some(secret.as_str())
        );
        let mut edit = input(daily("09:00"));
        edit.id = Some(id);
        upsert(&mut data, edit, now, CreatedBy::Person).unwrap();
        assert_eq!(data.scheduled_tasks[0].webhook_secret, None);
        let bad: Schedule =
            serde_json::from_value(json!({ "kind": "webhook", "filters": [{ "path": "action" }] }))
                .unwrap();
        assert!(upsert(&mut data, input(bad), now, CreatedBy::Person).is_err());
        assert!(parse_schedule(&json!({ "kind": "webhook" })).is_err());
        assert!(serde_json::from_str::<Action>(r#"{"type":"rotateWebhook","id":"x"}"#).is_ok());
    }

    #[test]
    fn deliveries_during_a_run_coalesce_into_one_follow_up() {
        let mut data = data();
        let now = at("2026-10-14", "08:00");
        let webhook: Schedule = serde_json::from_value(json!({ "kind": "webhook" })).unwrap();
        let mut bound = input(webhook);
        bound.session_id = Some("s".into());
        let id = upsert(&mut data, bound, now, CreatedBy::Person).unwrap();
        data.sessions[0].status = crate::models::SessionStatus::Running;
        hold_follow_up(&id, "first".into());
        hold_follow_up(&id, "second".into());
        assert!(ready_follow_ups(&data).iter().all(|(task, _)| task != &id));
        data.sessions[0].status = crate::models::SessionStatus::Completed;
        let ready = ready_follow_ups(&data);
        let mine: Vec<_> = ready.iter().filter(|(task, _)| task == &id).collect();
        assert_eq!(mine, vec![&(id.clone(), "second".to_owned())]);
        assert!(ready_follow_ups(&data).iter().all(|(task, _)| task != &id));
    }

    #[test]
    fn tool_arguments_parse() {
        let data = data();
        let caller = data.sessions[0].clone();
        let input = schedule_input(
            &data,
            &caller,
            &json!({ "prompt": "Check the build\nand report", "schedule": { "kind": "once", "at": "2030-01-02T09:30" } }),
        )
        .unwrap();
        assert_eq!(input.title, "Check the build");
        assert_eq!(input.session_id.as_deref(), Some("s"));
        assert_eq!(input.approval, ApprovalMode::Auto);
        assert_eq!(input.agent, AgentProviderId::Claude);
        assert!(input.enabled);
        assert_eq!(
            input.schedule,
            Schedule::Once {
                at: at("2030-01-02", "09:30").timestamp_millis()
            }
        );
        assert_eq!(
            parse_schedule(&json!({ "kind": "once", "at": "2030-01-02T09:30:00Z" })).unwrap(),
            Schedule::Once {
                at: 1_893_576_600_000
            }
        );
        assert_eq!(
            parse_schedule(&json!({ "kind": "once", "at": 5 })).unwrap(),
            Schedule::Once { at: 5 }
        );
        assert!(parse_schedule(&json!({ "kind": "once", "at": "tomorrow" })).is_err());
        assert!(parse_schedule(&json!({ "kind": "cron", "expr": "* * * * *" })).is_err());
        let other = schedule_input(
            &data,
            &caller,
            &json!({ "prompt": "x", "schedule": { "kind": "daily", "time": "09:00" }, "bindToThisConversation": false, "project": "other" }),
        )
        .unwrap();
        assert_eq!((other.project_id.as_str(), other.session_id), ("q", None));
        assert!(schedule_input(&data, &caller, &json!({ "prompt": "x", "schedule": { "kind": "daily", "time": "09:00" }, "project": "other" })).is_err());
        assert!(schedule_input(
            &data,
            &caller,
            &json!({ "schedule": { "kind": "daily", "time": "09:00" } })
        )
        .is_err());
        let mut task: ScheduledTask = serde_json::from_value(json!({
            "id": "t", "title": "t", "prompt": "p", "projectId": "p", "agent": "claude",
            "schedule": { "kind": "weekly", "days": [0, 6], "time": "08:15" }, "approval": "full",
            "enabled": true, "createdBy": "person", "createdAt": 0, "updatedAt": 0, "lastStatus": "never"
        }))
        .unwrap();
        assert_eq!(
            schedule_label(&task.schedule),
            "weekly on Sun, Sat at 08:15"
        );
        assert!(within(&task, ApprovalMode::Auto).is_err());
        task.approval = ApprovalMode::Auto;
        assert!(within(&task, ApprovalMode::Auto).is_ok());
    }
}
