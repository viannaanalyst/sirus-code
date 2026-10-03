use crate::error::{Error, Result};
use crate::models::AppData;

fn has_owner(data: &AppData, key: &str) -> bool {
    if let Some(id) = key.strip_prefix("session:") {
        return data.sessions.iter().any(|session| session.id == id);
    }
    if let Some(id) = key.strip_prefix("project:") {
        return data.projects.iter().any(|project| project.id == id);
    }
    false
}

pub fn apply(data: &mut AppData, key: &str, value: String) -> Result<()> {
    if key.len() > 256 || !has_owner(data, key) {
        return Err(Error::not_found("Draft owner no longer exists"));
    }
    if value.len() > 64 * 1024 {
        return Err(Error::new("invalid", "Draft exceeds the 64 KiB limit"));
    }
    if value.is_empty() {
        data.composer_drafts.remove(key);
    } else {
        data.composer_drafts.insert(key.into(), value);
    }
    Ok(())
}

pub fn prune(data: &mut AppData) {
    let retained: std::collections::HashSet<_> = data
        .composer_drafts
        .keys()
        .filter(|key| has_owner(data, key))
        .cloned()
        .collect();
    data.composer_drafts.retain(|key, _| retained.contains(key));
}

#[cfg(test)]
mod tests {
    use super::*;
    fn fixture() -> AppData {
        serde_json::from_value(serde_json::json!({"projects":[{"id":"p","name":"Project","path":"/fixture","addedAt":"time","lastOpenedAt":"time"}],"settings":{},"sessions":[{"id":"s","title":"Session","projectId":"p","agent":"codex","status":"idle","createdAt":"time","lastActivityAt":"time","worktree":{"path":"/fixture","branch":"main","isolated":false},"messages":[]}]})).unwrap()
    }
    #[test]
    fn draft_is_persisted_without_becoming_a_message_or_running_session() {
        let repo = crate::git::tests::Repo::new();
        let path = repo.0.join("state.json");
        let mut data = fixture();
        apply(&mut data, "session:s", "Unsent task".into()).unwrap();
        crate::persist::save(&path, &data).unwrap();
        let restored = crate::persist::load_or_create(&path).unwrap();
        assert_eq!(restored.composer_drafts["session:s"], "Unsent task");
        assert!(restored.sessions[0].messages.is_empty());
        assert!(!restored.sessions[0].status.is_active());
    }
    #[test]
    fn draft_refuses_unknown_owners_and_utf8_byte_overflow() {
        let mut data = fixture();
        for key in [
            "session:missing",
            "project:missing",
            "path:/fixture",
            "project:p/../x",
        ] {
            assert!(apply(&mut data, key, "text".into()).is_err());
        }
        assert!(apply(&mut data, "session:s", "🙂".repeat(16385)).is_err());
        assert!(data.composer_drafts.is_empty());
        apply(&mut data, "project:p", "text".into()).unwrap();
        apply(&mut data, "project:p", "".into()).unwrap();
        assert!(data.composer_drafts.is_empty());
    }
    #[test]
    fn removed_metadata_cannot_retain_or_resurrect_its_draft() {
        let mut data = fixture();
        apply(&mut data, "session:s", "session text".into()).unwrap();
        apply(&mut data, "project:p", "project text".into()).unwrap();
        data.sessions.clear();
        prune(&mut data);
        assert!(!data.composer_drafts.contains_key("session:s"));
        assert!(apply(&mut data, "session:s", "late save".into()).is_err());
        assert_eq!(data.composer_drafts["project:p"], "project text");
        data.projects.clear();
        prune(&mut data);
        assert!(data.composer_drafts.is_empty());
    }
}
