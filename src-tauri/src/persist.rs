use std::collections::HashMap;
use std::fs;
use std::io::Write;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, OnceLock};
use std::time::Duration;

use parking_lot::Mutex;

use crate::commands::AppState;
use crate::error::{Error, Result};
use crate::models::AppData;

pub fn load_or_create(path: &PathBuf) -> Result<AppData> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    if !path.exists() {
        let data = AppData::default();
        save(path, &data)?;
        return Ok(data);
    }
    let raw = fs::read_to_string(path)?;
    if raw.trim().is_empty() {
        return Err(Error::new(
            "persist",
            "state file is empty; refusing to overwrite it",
        ));
    }
    let value: serde_json::Value = serde_json::from_str(&raw)
        .map_err(|err| Error::new("persist", format!("invalid state: {err}")))?;
    let original_settings = value.get("settings").cloned();
    let mut data: AppData = serde_json::from_value(value)
        .map_err(|err| Error::new("persist", format!("invalid state: {err}")))?;
    crate::sidebar::prune(&mut data);
    crate::profile::normalize(&mut data.settings.profile);
    crate::context_text::prune(&mut data);
    crate::appearance::normalize(&mut data.settings);
    // Closed enum migration (legacy System → Dark), defaults and numeric bounds
    // are checkpointed once so retained preferences already use the new schema.
    let mut recovered = original_settings.as_ref() != Some(&serde_json::to_value(&data.settings)?);
    for session in &mut data.sessions {
        if session.status.is_active() {
            session.status = crate::models::SessionStatus::Stopped;
            session.last_error = Some("Execution was interrupted when Switchyard closed.".into());
            recovered = true;
        }
        crate::activity::recover(session);
        for message in &mut session.messages {
            if message.streaming {
                message.streaming = false;
                recovered = true;
            }
        }
    }
    recovered |= crate::team::recover(&mut data);
    if recovered {
        save(path, &data)?;
    }
    crate::diagnostics::observe(path, &data);
    Ok(data)
}

/// Snapshot order. Taken while the caller holds the state lock, so a higher
/// generation is always a newer state.
static GENERATION: AtomicU64 = AtomicU64::new(0);
/// Last generation written per state file. Its lock also serializes writers.
static WRITTEN: OnceLock<Mutex<HashMap<PathBuf, u64>>> = OnceLock::new();

/// Saves synchronously; callers hold the state lock and may roll back on error.
pub fn save(path: &PathBuf, data: &AppData) -> Result<()> {
    let (generation, encoded) = encode(data)?;
    write(path, generation, &encoded)?;
    crate::diagnostics::observe(path, data);
    Ok(())
}

fn encode(data: &AppData) -> Result<(u64, Vec<u8>)> {
    let generation = GENERATION.fetch_add(1, Ordering::SeqCst) + 1;
    // Compact JSON: smaller and faster to encode than the old pretty output; both load.
    Ok((generation, serde_json::to_vec(data)?))
}

/// Atomic temp-file write. A snapshot older than what is already on disk is
/// dropped, so a delayed checkpoint can never replace a newer synchronous save.
fn write(path: &PathBuf, generation: u64, encoded: &[u8]) -> Result<()> {
    let mut written = WRITTEN.get_or_init(Mutex::default).lock();
    if written.get(path).is_some_and(|last| *last > generation) {
        return Ok(());
    }
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    let tmp = path.with_extension("json.tmp");
    let mut file = fs::File::create(&tmp)?;
    file.write_all(encoded)?;
    file.sync_all()?;
    drop(file);
    fs::rename(tmp, path)?;
    // Production has one state file; keep disposable test roots bounded.
    if !written.contains_key(path) && written.len() >= 64 {
        written.clear();
    }
    written.insert(path.clone(), generation);
    Ok(())
}

/// Coalesced, best-effort checkpoint for streaming output: at most one write per
/// second across every stream. The state is encoded under the lock; the file
/// write and fsync happen outside it. Final states keep using [`save`].
pub fn checkpoint_soon(state: &Arc<AppState>) {
    if state.checkpoint_pending.swap(true, Ordering::AcqRel) {
        return;
    }
    let state = state.clone();
    std::thread::spawn(move || {
        std::thread::sleep(CHECKPOINT_DELAY);
        // Cleared before the snapshot, so later output schedules another checkpoint.
        state.checkpoint_pending.store(false, Ordering::Release);
        let encoded = encode(&state.data.lock());
        match encoded.and_then(|(generation, bytes)| write(&state.data_path, generation, &bytes)) {
            Ok(()) => {}
            Err(error) => tracing::error!(%error, "cannot checkpoint streamed output"),
        }
    });
}

const CHECKPOINT_DELAY: Duration = Duration::from_secs(1);

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn a_delayed_older_snapshot_never_replaces_a_newer_save() {
        let temp = crate::git::tests::Repo::new();
        let path = temp.0.join("state.json");
        let older = encode(&AppData::default()).unwrap();
        let mut newer_data = AppData::default();
        newer_data
            .composer_drafts
            .insert("session:s".into(), "newer".into());
        save(&path, &newer_data).unwrap();
        write(&path, older.0, &older.1).unwrap();
        let loaded = load_or_create(&path).unwrap();
        assert_eq!(loaded.composer_drafts["session:s"], "newer");
    }
    #[test]
    fn general_preferences_survive_native_save_and_reload() {
        let temp = crate::git::tests::Repo::new();
        let path = temp.0.join("state.json");
        let settings = serde_json::from_value(serde_json::json!({
            "defaultAgent": "pi", "defaultModel": "pi::fixture",
            "sidebarProjectSortOrder": "created_at", "sidebarThreadSortOrder": "updated_at",
            "showEnvironmentUsage": false, "showEnvironmentRepository": false,
            "showEnvironmentEditor": false, "locale": "en", "uiFontSize": 14
        }))
        .unwrap();
        let data = AppData {
            settings,
            ..AppData::default()
        };
        save(&path, &data).unwrap();
        let loaded = load_or_create(&path).unwrap();
        assert_eq!(
            serde_json::to_value(loaded.settings).unwrap(),
            serde_json::to_value(data.settings).unwrap()
        );
        assert!(!path.with_extension("json.tmp").exists());
    }
    #[test]
    fn appearance_choices_survive_save_reload_and_legacy_values_checkpoint() {
        let temp = crate::git::tests::Repo::new();
        let path = temp.0.join("state.json");
        let settings = serde_json::from_value(serde_json::json!({
            "theme": "system", "darkWindowTranslucent": true, "lightWindowTranslucent": false,
            "darkWindowOpacity": 70, "lightWindowOpacity": 92, "darkSidebarTranslucent": true,
            "lightSidebarTranslucent": true, "darkSidebarOpacity": 25,
            "lightSidebarOpacity": 100, "translucentOpacity": 70,
            "systemUiFont": false, "uiFont": "dmSans", "uiFontSize": 18,
            "codeFont": "sfMono", "codeFontSize": 22,
            "terminalFont": "jetbrains", "terminalFontSize": 10,
            "fontSmoothing": false, "dockIcon": "smokedGlass"
        }))
        .unwrap();
        let data = AppData {
            settings,
            ..AppData::default()
        };
        save(&path, &data).unwrap();
        assert_eq!(
            serde_json::to_value(load_or_create(&path).unwrap().settings).unwrap(),
            serde_json::to_value(data.settings).unwrap()
        );
        fs::write(&path, r#"{"projects":[],"sessions":[],"settings":{"theme":"system","uiFontSize":100,"codeFontSize":1,"terminalFontSize":999,"darkSidebarOpacity":1,"lightSidebarOpacity":999,"translucentOpacity":0}}"#).unwrap();
        let migrated = load_or_create(&path).unwrap();
        assert_eq!(migrated.settings.theme, crate::models::ThemePref::System);
        assert_eq!(migrated.settings.ui_font_size, 13);
        assert_eq!(migrated.settings.code_font_size, 13);
        assert_eq!(migrated.settings.terminal_font_size, 13);
        assert_eq!(migrated.settings.dark_sidebar_opacity, 72);
        assert_eq!(migrated.settings.light_sidebar_opacity, 38);
        assert_eq!(migrated.settings.translucent_opacity, 85);
        migrated.settings.validate_controls().unwrap();
        let checkpoint: serde_json::Value =
            serde_json::from_str(&fs::read_to_string(&path).unwrap()).unwrap();
        assert_eq!(checkpoint["settings"]["theme"], "system");
        assert_eq!(checkpoint["settings"]["translucentOpacity"], 85);
        assert_eq!(checkpoint["settings"]["dockIcon"], "default");
        fs::write(&path, r#"{"projects":[],"sessions":[],"settings":{"theme":"translucent","translucentOpacity":43,"lightSidebarTranslucent":true}}"#).unwrap();
        let glass = load_or_create(&path).unwrap();
        assert_eq!(glass.settings.theme, crate::models::ThemePref::Dark);
        assert!(glass.settings.dark_window_translucent && glass.settings.light_sidebar_translucent);
        assert_eq!(glass.settings.dark_window_opacity, 43);
        let checkpoint: serde_json::Value =
            serde_json::from_str(&fs::read_to_string(&path).unwrap()).unwrap();
        assert_eq!(checkpoint["settings"]["theme"], "dark");
        assert_eq!(checkpoint["settings"]["darkWindowOpacity"], 43);
    }

    #[test]
    fn native_thread_survives_restart_but_pending_approval_does_not() {
        let mut session: crate::models::Session = serde_json::from_value(serde_json::json!({
            "id":"s","title":"Task","projectId":"p","agent":"codex","status":"waiting",
            "createdAt":"time","lastActivityAt":"time","worktree":{"path":"/fixture","branch":"main","isolated":false},"messages":[],
            "nativeThread":{"threadId":"exact-vendor-thread","sessionId":"s","projectId":"p","cwd":"/fixture","model":null},
            "pendingRequests":[{"requestId":"stale","generation":"old","turnId":"turn","itemId":"item","kind":{"type":"command","command":"echo hi","cwd":"/fixture","reason":null}}]
        })).unwrap();
        let serialized = serde_json::to_value(&session).unwrap();
        assert_eq!(
            serialized["nativeThread"]["threadId"],
            "exact-vendor-thread"
        );
        assert_eq!(serialized["pendingRequests"], serde_json::json!([]));
        session.status = crate::models::SessionStatus::Completed;
        assert_eq!(
            serde_json::to_value(session).unwrap()["nativeThread"]["sessionId"],
            "s"
        );
    }
    #[test]
    fn interrupted_sessions_recover_without_losing_messages() {
        let temp = crate::git::tests::Repo::new();
        let path = temp.0.join("state.json");
        let mut data: AppData = serde_json::from_value(serde_json::json!({
            "projects": [], "settings": {},
            "sessions": [{"id":"one","title":"Task","projectId":"project","agent":"codex","status":"running","createdAt":"time","lastActivityAt":"time","worktree":{"path":"/unused","branch":"main","isolated":false},"lastError":null,"messages":[{"id":"message","sessionId":"one","role":"agent","content":"partial output","createdAt":"time","streaming":true}]}]
        })).unwrap();
        let mut failed = data.sessions[0].clone();
        failed.id = "failed".into();
        failed.status = crate::models::SessionStatus::Failed;
        failed.last_error = Some("Output limit".into());
        data.sessions.push(failed);
        save(&path, &data).unwrap();
        let recovered = load_or_create(&path).unwrap();
        assert_eq!(
            recovered.sessions[0].status,
            crate::models::SessionStatus::Stopped
        );
        assert_eq!(recovered.sessions[0].messages[0].content, "partial output");
        assert!(!recovered.sessions[0].messages[0].streaming);
        assert!(!recovered.sessions[1].messages[0].streaming);
        assert_eq!(
            recovered.sessions[1].status,
            crate::models::SessionStatus::Failed
        );
        assert_eq!(
            recovered.sessions[1].last_error.as_deref(),
            Some("Output limit")
        );
        assert_eq!(
            load_or_create(&path).unwrap().sessions[0].status,
            crate::models::SessionStatus::Stopped
        );
    }
    #[test]
    fn corrupted_state_is_reported_without_overwriting_it() {
        let temp = crate::git::tests::Repo::new();
        let path = temp.0.join("state.json");
        fs::write(&path, "{bad state").unwrap();
        assert!(load_or_create(&path).is_err());
        assert_eq!(fs::read_to_string(&path).unwrap(), "{bad state");
        fs::write(&path, "").unwrap();
        assert!(load_or_create(&path).is_err());
        assert_eq!(fs::read_to_string(&path).unwrap(), "");
    }
}
