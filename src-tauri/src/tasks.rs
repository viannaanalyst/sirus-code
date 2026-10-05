//! Tasks (ADR-052): a bounded personal to-do list. A task can be handed to an
//! agent with one explicit click, which starts a normal session through the
//! same admission as Send and links it; the task's status is that session's.

use std::sync::Arc;

use chrono::{Local, NaiveDate};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, State};
use uuid::Uuid;

use crate::automations::{launch, Launch};
use crate::commands::{native_task, AppState};
use crate::error::{Error, Result};
use crate::models::{AgentProviderId, AppData, ApprovalMode};

const MAX_TASKS: usize = 500;
const TITLE_LIMIT: usize = 500;
const NOTES_LIMIT: usize = 10_000;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Priority {
    None,
    Low,
    Medium,
    High,
    Urgent,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Task {
    pub id: String,
    pub title: String,
    #[serde(default)]
    pub notes: String,
    pub priority: Priority,
    #[serde(default)]
    pub project_id: Option<String>,
    /// `YYYY-MM-DD`.
    #[serde(default)]
    pub due_date: Option<String>,
    /// The session the task was handed to.
    #[serde(default)]
    pub session_id: Option<String>,
    #[serde(default)]
    pub completed_at: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TaskInput {
    pub id: Option<String>,
    pub title: String,
    pub notes: String,
    pub priority: Priority,
    pub project_id: Option<String>,
    pub due_date: Option<String>,
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
        task: TaskInput,
    },
    Delete {
        id: String,
    },
    SetDone {
        id: String,
        done: bool,
    },
    Unlink {
        id: String,
    },
    /// Starts a session on the task's project with its title and notes.
    Delegate {
        id: String,
        agent: AgentProviderId,
        model: Option<String>,
        approval: ApprovalMode,
        planning: bool,
        isolated_worktree: bool,
    },
}

#[tauri::command]
pub async fn task_action(
    app: AppHandle,
    state: State<'_, Arc<AppState>>,
    action: Action,
) -> Result<Vec<Task>> {
    let state = state.inner().clone();
    if let Action::Delegate {
        id,
        agent,
        model,
        approval,
        planning,
        isolated_worktree,
    } = action
    {
        let request = {
            let data = state.data.lock();
            state.ensure_running()?;
            let task = data
                .tasks
                .iter()
                .find(|task| task.id == id)
                .ok_or_else(|| Error::not_found("task not found"))?;
            if task.session_id.as_ref().is_some_and(|session_id| {
                data.sessions
                    .iter()
                    .any(|session| session.id == *session_id && session.status.is_active())
            }) {
                return Err(Error::agent("This task's agent is still working."));
            }
            let project_id = task
                .project_id
                .clone()
                .filter(|project| data.projects.iter().any(|item| item.id == *project))
                .ok_or_else(|| Error::new("invalid", "Choose a project for this task first."))?;
            if data.settings.disabled_providers.contains(&agent) {
                return Err(Error::agent("Enable this provider in Settings first."));
            }
            if model
                .as_deref()
                .is_some_and(|model| !crate::automations::valid_model(model))
            {
                return Err(Error::new("invalid", "Invalid model."));
            }
            if approval == ApprovalMode::Full && planning {
                return Err(Error::new(
                    "invalid",
                    "Full access cannot combine with planning.",
                ));
            }
            let prompt = if task.notes.trim().is_empty() {
                task.title.clone()
            } else {
                format!("{}\n\n{}", task.title, task.notes.trim())
            };
            Launch {
                project_id,
                title: task.title.clone(),
                agent,
                model,
                isolated_worktree,
                prompt,
                approval,
                planning,
            }
        };
        let (session_id, error) = launch(&app, &state, request).await;
        let mut data = state.data.lock();
        if let Some(task) = data.tasks.iter_mut().find(|task| task.id == id) {
            if session_id.is_some() {
                task.session_id = session_id;
                task.completed_at = None;
                task.updated_at = Local::now().to_rfc3339();
            }
        }
        let tasks = data.tasks.clone();
        drop(data);
        state.persist()?;
        return match error {
            Some(message) => Err(Error::agent(message)),
            None => Ok(tasks),
        };
    }
    native_task(move || mutate(&state, action)).await
}

fn mutate(state: &AppState, action: Action) -> Result<Vec<Task>> {
    let mut data = state.data.lock();
    state.ensure_running()?;
    let now = Local::now().to_rfc3339();
    match action {
        Action::List => return Ok(data.tasks.clone()),
        Action::Upsert { task } => upsert(&mut data, task, &now)?,
        Action::Delete { id } => {
            let before = data.tasks.len();
            data.tasks.retain(|task| task.id != id);
            if data.tasks.len() == before {
                return Err(Error::not_found("task not found"));
            }
        }
        Action::SetDone { id, done } => {
            let task = find(&mut data, &id)?;
            task.completed_at = done.then(|| now.clone());
            task.updated_at = now;
        }
        Action::Unlink { id } => {
            let task = find(&mut data, &id)?;
            task.session_id = None;
            task.updated_at = now;
        }
        Action::Delegate { .. } => unreachable!("handled before mutate"),
    }
    let tasks = data.tasks.clone();
    drop(data);
    state.persist()?;
    Ok(tasks)
}

fn find<'a>(data: &'a mut AppData, id: &str) -> Result<&'a mut Task> {
    data.tasks
        .iter_mut()
        .find(|task| task.id == id)
        .ok_or_else(|| Error::not_found("task not found"))
}

fn upsert(data: &mut AppData, input: TaskInput, now: &str) -> Result<()> {
    let title = input.title.trim();
    if title.is_empty()
        || title.chars().count() > TITLE_LIMIT
        || title.chars().any(char::is_control)
    {
        return Err(Error::new(
            "invalid",
            "Task titles need 1 to 500 characters.",
        ));
    }
    let notes = input.notes.trim();
    if notes.chars().count() > NOTES_LIMIT || notes.contains('\0') {
        return Err(Error::new(
            "invalid",
            "Notes are limited to 10,000 characters.",
        ));
    }
    if input
        .project_id
        .as_ref()
        .is_some_and(|id| !data.projects.iter().any(|project| project.id == *id))
    {
        return Err(Error::not_found("project not found"));
    }
    if input.due_date.as_deref().is_some_and(|date| {
        date.len() != 10 || NaiveDate::parse_from_str(date, "%Y-%m-%d").is_err()
    }) {
        return Err(Error::new("invalid", "Invalid due date."));
    }
    match input.id {
        Some(id) => {
            let task = find(data, &id)?;
            task.title = title.to_owned();
            task.notes = notes.to_owned();
            task.priority = input.priority;
            task.project_id = input.project_id;
            task.due_date = input.due_date;
            task.updated_at = now.to_owned();
        }
        None => {
            if data.tasks.len() >= MAX_TASKS {
                return Err(Error::new("invalid", "At most 500 tasks."));
            }
            data.tasks.push(Task {
                id: Uuid::new_v4().to_string(),
                title: title.to_owned(),
                notes: notes.to_owned(),
                priority: input.priority,
                project_id: input.project_id,
                due_date: input.due_date,
                session_id: None,
                completed_at: None,
                created_at: now.to_owned(),
                updated_at: now.to_owned(),
            });
        }
    }
    Ok(())
}

/// A removed project leaves its tasks without a project; removed sessions unlink.
pub fn prune(data: &mut AppData) {
    let projects: std::collections::HashSet<_> = data
        .projects
        .iter()
        .map(|project| project.id.clone())
        .collect();
    let sessions: std::collections::HashSet<_> = data
        .sessions
        .iter()
        .map(|session| session.id.clone())
        .collect();
    for task in &mut data.tasks {
        if task
            .project_id
            .as_ref()
            .is_some_and(|id| !projects.contains(id))
        {
            task.project_id = None;
        }
        if task
            .session_id
            .as_ref()
            .is_some_and(|id| !sessions.contains(id))
        {
            task.session_id = None;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn data() -> AppData {
        let mut data = AppData::default();
        data.projects.push(
            serde_json::from_value(serde_json::json!({
                "id": "p", "name": "P", "path": "/fixture", "addedAt": "t", "lastOpenedAt": "t"
            }))
            .unwrap(),
        );
        data
    }

    fn input(title: &str) -> TaskInput {
        TaskInput {
            id: None,
            title: title.into(),
            notes: "  details  ".into(),
            priority: Priority::High,
            project_id: Some("p".into()),
            due_date: Some("2026-10-10".into()),
        }
    }

    #[test]
    fn tasks_are_validated_and_pruned() {
        let mut data = data();
        upsert(&mut data, input("Fix login"), "t").unwrap();
        assert_eq!(data.tasks[0].notes, "details");
        assert!(upsert(&mut data, input("  "), "t").is_err());
        let mut bad = input("x");
        bad.due_date = Some("10/10/2026".into());
        assert!(upsert(&mut data, bad, "t").is_err());
        let mut foreign = input("x");
        foreign.project_id = Some("missing".into());
        assert!(upsert(&mut data, foreign, "t").is_err());
        data.tasks[0].session_id = Some("gone".into());
        data.projects.clear();
        prune(&mut data);
        assert_eq!(data.tasks[0].project_id, None);
        assert_eq!(data.tasks[0].session_id, None);
    }

    #[test]
    fn actions_are_closed() {
        assert!(serde_json::from_str::<Action>(r#"{"type":"list"}"#).is_ok());
        assert!(serde_json::from_str::<Action>(
            r#"{"type":"delegate","id":"t","agent":"codex","model":null,"approval":"ask","planning":false,"isolatedWorktree":true,"prompt":"x"}"#
        )
        .is_err());
        assert!(serde_json::from_str::<Action>(r#"{"type":"upsert","task":{"id":null,"title":"a","notes":"","priority":"critical","projectId":null,"dueDate":null}}"#).is_err());
    }
}
