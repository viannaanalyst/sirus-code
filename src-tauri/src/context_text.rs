use crate::error::{Error, Result};
use crate::models::AppData;

const MAX_UNITS: usize = 16_384;

fn bounded(value: &str) -> bool {
    value.len() <= 64 * 1024 && value.encode_utf16().count() <= MAX_UNITS
}

pub fn has_owner(data: &AppData, key: &str) -> bool {
    if key.len() > 256 {
        return false;
    }
    if let Some(id) = key.strip_prefix("project:") {
        return data.projects.iter().any(|project| project.id == id);
    }
    if let Some(id) = key.strip_prefix("session:") {
        return data.sessions.iter().any(|session| {
            session.id == id
                && data
                    .projects
                    .iter()
                    .any(|project| project.id == session.project_id)
        });
    }
    false
}

pub fn apply(data: &mut AppData, key: &str, value: String) -> Result<()> {
    if !has_owner(data, key) {
        return Err(Error::not_found("Context owner no longer exists"));
    }
    if !bounded(&value) {
        return Err(Error::new(
            "invalid",
            "Notes exceed the 16,384 character limit",
        ));
    }
    if value.is_empty() {
        data.context_texts.remove(key);
    } else {
        data.context_texts.insert(key.to_owned(), value);
    }
    Ok(())
}

pub fn prune(data: &mut AppData) {
    let owners: std::collections::HashSet<_> = data
        .context_texts
        .keys()
        .filter(|key| has_owner(data, key))
        .cloned()
        .collect();
    data.context_texts
        .retain(|key, value| owners.contains(key) && bounded(value) && !value.is_empty());
}

#[cfg(test)]
mod tests {
    use super::*;
    fn fixture() -> AppData {
        serde_json::from_value(serde_json::json!({"projects":[{"id":"p","name":"Project","path":"/fixture","addedAt":"time","lastOpenedAt":"time"}],"settings":{},"sessions":[{"id":"s","title":"Session","projectId":"p","agent":"codex","status":"idle","createdAt":"time","lastActivityAt":"time","worktree":{"path":"/fixture","branch":"main","isolated":false},"messages":[]}]})).unwrap()
    }
    #[test]
    fn reference_text_survives_reload_without_becoming_a_prompt_or_execution() {
        let repo = crate::git::tests::Repo::new();
        let path = repo.0.join("state.json");
        let mut data = fixture();
        let original = serde_json::to_value(&data.sessions).unwrap();
        apply(&mut data, "session:s", "A local note\n🙂".into()).unwrap();
        apply(&mut data, "project:p", "Project conventions".into()).unwrap();
        crate::persist::save(&path, &data).unwrap();
        let restored = crate::persist::load_or_create(&path).unwrap();
        assert_eq!(restored.context_texts["session:s"], "A local note\n🙂");
        assert_eq!(restored.context_texts["project:p"], "Project conventions");
        assert_eq!(serde_json::to_value(&restored.sessions).unwrap(), original);
        assert!(restored.composer_drafts.is_empty());
        assert!(serde_json::from_str::<AppData>(
            "{\"projects\":[],\"sessions\":[],\"settings\":{}}"
        )
        .unwrap()
        .context_texts
        .is_empty());
    }
    #[test]
    fn text_is_bounded_owned_and_cannot_resurrect_removed_metadata() {
        let mut data = fixture();
        for key in [
            "session:missing",
            "project:missing",
            "path:/fixture",
            "project:p/../other",
        ] {
            assert!(apply(&mut data, key, "foreign".into()).is_err());
        }
        assert!(apply(&mut data, "session:s", "🙂".repeat(8193)).is_err());
        assert!(apply(&mut data, "project:p", "x".repeat(16385)).is_err());
        apply(&mut data, "session:s", "🙂".repeat(8192)).unwrap();
        apply(&mut data, "project:p", "shared".into()).unwrap();
        apply(&mut data, "session:s", "".into()).unwrap();
        assert!(!data.context_texts.contains_key("session:s"));
        apply(&mut data, "session:s", "local".into()).unwrap();
        data.sessions.clear();
        prune(&mut data);
        assert!(!data.context_texts.contains_key("session:s"));
        assert!(apply(&mut data, "session:s", "late".into()).is_err());
        assert_eq!(data.context_texts["project:p"], "shared");
        data.context_texts
            .insert("project:foreign".into(), "unowned".into());
        data.projects.clear();
        prune(&mut data);
        assert!(data.context_texts.is_empty());
    }
}
