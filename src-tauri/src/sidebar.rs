use std::collections::HashSet;

use crate::error::{Error, Result};
use crate::models::{AppData, AppSettings, Project, Session};

pub fn validate(settings: &AppSettings) -> Result<()> {
    for ids in [
        &settings.sidebar_project_order,
        &settings.pinned_project_ids,
        &settings.pinned_session_ids,
        &settings.archived_session_ids,
    ] {
        if ids.len() > 4096 || ids.iter().any(|id| id.is_empty() || id.len() > 64) {
            return Err(Error::new(
                "invalid",
                "sidebar references exceed their bounds",
            ));
        }
    }
    if settings.done_sessions.len() > 4096
        || settings.done_sessions.iter().any(|row| {
            row.id.is_empty()
                || row.id.len() > 64
                || row.at.is_empty()
                || row.at.len() > 40
                || !row
                    .at
                    .bytes()
                    .all(|byte| byte.is_ascii_alphanumeric() || b"-:.+".contains(&byte))
        })
    {
        return Err(Error::new("invalid", "done sessions exceed their bounds"));
    }
    Ok(())
}

pub fn normalize(settings: &mut AppSettings, projects: &[Project], sessions: &[Session]) {
    let project_ids: HashSet<_> = projects.iter().map(|row| row.id.as_str()).collect();
    let session_ids: HashSet<_> = sessions
        .iter()
        .filter(|row| project_ids.contains(row.project_id.as_str()))
        .map(|row| row.id.as_str())
        .collect();
    retain_unique(&mut settings.sidebar_project_order, &project_ids);
    retain_unique(&mut settings.pinned_project_ids, &project_ids);
    retain_unique(&mut settings.archived_session_ids, &session_ids);
    retain_unique(&mut settings.pinned_session_ids, &session_ids);
    settings
        .pinned_session_ids
        .retain(|id| !settings.archived_session_ids.contains(id));
    let mut seen = HashSet::new();
    settings
        .done_sessions
        .retain(|row| session_ids.contains(row.id.as_str()) && seen.insert(row.id.clone()));
    settings.done_sessions.truncate(4096);
    // Rail items removed from the closed set (the old drafts filter) drop out of saved settings.
    let rail: HashSet<&str> = crate::models::RAIL_ITEMS.into_iter().collect();
    retain_unique(&mut settings.rail_item_order, &rail);
    retain_unique(&mut settings.hidden_rail_items, &rail);
}

fn retain_unique(ids: &mut Vec<String>, owned: &HashSet<&str>) {
    let mut seen = HashSet::new();
    ids.retain(|id| owned.contains(id.as_str()) && seen.insert(id.clone()));
    ids.truncate(4096);
}

pub fn prune(data: &mut AppData) {
    normalize(&mut data.settings, &data.projects, &data.sessions);
}

pub fn rename_project(data: &mut AppData, project_id: &str, name: &str) -> Result<Project> {
    let name = name.trim();
    if name.is_empty() || name.chars().count() > 200 || name.chars().any(char::is_control) {
        return Err(Error::new(
            "invalid",
            "project name must contain 1–200 printable characters",
        ));
    }
    let project = data
        .projects
        .iter_mut()
        .find(|row| row.id == project_id)
        .ok_or_else(|| Error::not_found("project not found"))?;
    // Display metadata only: never rename a directory, worktree or native thread.
    project.name = name.to_owned();
    Ok(project.clone())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fixture() -> AppData {
        serde_json::from_value(serde_json::json!({
            "settings": {},
            "projects": [{"id":"p","name":"Project","path":"/owned","addedAt":"time","lastOpenedAt":"time"}],
            "sessions": [{"id":"s","title":"Task","projectId":"p","agent":"codex","status":"running","createdAt":"time","lastActivityAt":"time","worktree":{"path":"/owned","branch":"main","isolated":false},"lastError":null,"messages":[]}]
        })).unwrap()
    }

    #[test]
    fn archive_and_pin_references_are_bounded_owned_and_do_not_change_execution() {
        let mut data = fixture();
        data.settings.pinned_project_ids = vec!["p".into(), "foreign".into(), "p".into()];
        data.settings.pinned_session_ids = vec!["s".into(), "missing".into()];
        data.settings.archived_session_ids = vec!["s".into(), "missing".into(), "s".into()];
        data.settings.done_sessions = ["s", "missing", "s"]
            .map(|id| crate::models::DoneSession {
                id: id.into(),
                at: "2026-10-04T12:00:00.000Z".into(),
            })
            .to_vec();
        prune(&mut data);
        assert_eq!(data.settings.pinned_project_ids, ["p"]);
        assert_eq!(data.settings.archived_session_ids, ["s"]);
        assert_eq!(data.settings.done_sessions.len(), 1);
        assert!(data.settings.pinned_session_ids.is_empty());
        assert!(data.sessions[0].status.is_active());
        assert_eq!(data.sessions[0].worktree.path, "/owned");
        data.settings.pinned_project_ids = vec!["p".into(); 4097];
        assert!(validate(&data.settings).is_err());
        data.settings.pinned_project_ids = vec!["x".repeat(65)];
        assert!(validate(&data.settings).is_err());
    }

    #[test]
    fn removed_rail_items_drop_out_of_saved_settings() {
        let mut data = fixture();
        data.settings.rail_item_order = vec!["drafts".into(), "inbox".into(), "inbox".into()];
        data.settings.hidden_rail_items = vec!["drafts".into(), "pulls".into()];
        prune(&mut data);
        assert_eq!(data.settings.rail_item_order, ["inbox"]);
        assert_eq!(data.settings.hidden_rail_items, ["pulls"]);
        assert!(data.settings.validate_controls().is_ok());
    }

    #[test]
    fn metadata_removal_prunes_pins_and_archives() {
        let mut data = fixture();
        data.settings.sidebar_project_order = vec!["p".into()];
        data.settings.pinned_project_ids = vec!["p".into()];
        data.settings.archived_session_ids = vec!["s".into()];
        data.projects.clear();
        prune(&mut data);
        assert!(data.settings.sidebar_project_order.is_empty());
        assert!(data.settings.pinned_project_ids.is_empty());
        assert!(data.settings.archived_session_ids.is_empty());
    }

    #[test]
    fn old_settings_and_round_trip_preserve_sidebar_organization() {
        let legacy: AppSettings = serde_json::from_str("{}").unwrap();
        assert!(legacy.sidebar_project_order.is_empty());
        assert!(legacy.pinned_session_ids.is_empty());
        let mut data = fixture();
        data.settings.sidebar_project_order = vec!["p".into()];
        data.settings.pinned_project_ids = vec!["p".into()];
        data.settings.archived_session_ids = vec!["s".into()];
        let restored: AppData =
            serde_json::from_slice(&serde_json::to_vec(&data).unwrap()).unwrap();
        assert_eq!(restored.settings.sidebar_project_order, ["p"]);
        assert_eq!(restored.settings.pinned_project_ids, ["p"]);
        assert_eq!(restored.settings.archived_session_ids, ["s"]);
    }

    #[test]
    fn manual_order_retains_owned_order_and_rejects_oversized_lists() {
        let mut data = fixture();
        let mut other = data.projects[0].clone();
        other.id = "second".into();
        data.projects.push(other);
        data.settings.sidebar_project_order = vec![
            "second".into(),
            "foreign".into(),
            "p".into(),
            "second".into(),
        ];
        prune(&mut data);
        assert_eq!(data.settings.sidebar_project_order, ["second", "p"]);
        data.settings.sidebar_project_order = vec!["p".into(); 4097];
        assert!(validate(&data.settings).is_err());
        data.settings.sidebar_project_order = vec!["x".repeat(65)];
        assert!(validate(&data.settings).is_err());
    }

    #[test]
    fn rename_only_changes_owned_project_display_name() {
        let mut data = fixture();
        assert!(rename_project(&mut data, "foreign", "Name").is_err());
        for name in ["", "   ", "line\nline", &"x".repeat(201)] {
            assert!(rename_project(&mut data, "p", name).is_err());
        }
        let renamed = rename_project(&mut data, "p", "  New name  ").unwrap();
        assert_eq!(renamed.name, "New name");
        assert_eq!(renamed.path, "/owned");
        assert_eq!(data.sessions[0].project_id, "p");
        assert_eq!(data.sessions[0].worktree.path, "/owned");
    }
}
