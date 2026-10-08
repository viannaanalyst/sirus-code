use std::cell::Cell;
use std::collections::hash_map::DefaultHasher;
use std::collections::{HashMap, HashSet};
use std::fs;
use std::hash::{Hash, Hasher};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, OnceLock};
use std::time::Duration;

use parking_lot::Mutex;
use serde::{Deserialize, Serialize};

use crate::commands::AppState;
use crate::error::{Error, Result};
use crate::models::{AppData, Message};

/// Per-session transcripts live next to `state.json` (ADR-047).
const SESSIONS_DIR: &str = "sessions";

pub fn load_or_create(path: &Path) -> Result<AppData> {
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
    // A session entry that still carries `messages` is the legacy single-file layout.
    let inline = value
        .get("sessions")
        .and_then(|sessions| sessions.as_array())
        .map(|sessions| {
            sessions
                .iter()
                .filter(|session| session.get("messages").is_some())
                .filter_map(|session| session.get("id")?.as_str().map(str::to_owned))
                .collect::<HashSet<_>>()
        })
        .unwrap_or_default();
    let mut data: AppData = serde_json::from_value(value)
        .map_err(|err| Error::new("persist", format!("invalid state: {err}")))?;
    let dir = sessions_dir(path);
    let mut on_disk = HashMap::new();
    // A transcript set aside as unreadable may still name thumbnail files.
    let mut set_aside = false;
    for session in &mut data.sessions {
        if inline.contains(&session.id) {
            continue;
        }
        let name = transcript_name(&session.id);
        let file = dir.join(&name);
        let existed = file.exists();
        match read_transcript(&file, &session.id)? {
            Some((messages, hash)) => {
                session.messages = messages;
                on_disk.insert(name, hash);
            }
            None => set_aside |= existed,
        }
    }
    remove_orphans(&dir, &data);
    seed_written(path, on_disk);
    crate::sidebar::prune(&mut data);
    crate::context_text::prune(&mut data);
    crate::astros::retire_styles(&mut data);
    crate::appearance::normalize(&mut data.settings);
    // Closed enum migration (legacy System → Dark), defaults and numeric bounds
    // are checkpointed once so retained preferences already use the new schema.
    let mut recovered = original_settings.as_ref() != Some(&serde_json::to_value(&data.settings)?);
    if !inline.is_empty() {
        // One-time split: keep the legacy file before rewriting it without transcripts.
        let backup = path.with_extension("json.pre-split-backup");
        if !backup.exists() {
            fs::copy(path, &backup)?;
        }
        recovered = true;
    }
    for session in &mut data.sessions {
        if session.status.is_active() {
            session.status = crate::models::SessionStatus::Stopped;
            session.last_error = Some("Execution was interrupted when Sirus Code closed.".into());
            recovered = true;
        }
        crate::activity::recover(session);
        recovered |= crate::project_scripts::recover(session);
        // Older transcripts embedded image thumbnails; they move to files once.
        recovered |= crate::thumbnails::migrate(path, &mut session.messages);
        for message in &mut session.messages {
            if message.streaming {
                message.streaming = false;
                recovered = true;
            }
        }
    }
    recovered |= crate::team::recover(&mut data);
    recovered |= crate::automations::retire_standalone(&mut data);
    if recovered {
        save(path, &data)?;
    }
    if !set_aside {
        crate::thumbnails::remove_orphans(path, &data);
    }
    crate::diagnostics::observe(path, &data);
    Ok(data)
}

thread_local! {
    static OMIT_TRANSCRIPTS: Cell<bool> = const { Cell::new(false) };
}

/// `skip_serializing_if` for `Session::messages`. `state.json`, `load_state` and
/// session events omit transcripts: each has its own file and its own loader.
pub fn omit_transcripts<T>(_: &T) -> bool {
    OMIT_TRANSCRIPTS.with(Cell::get)
}

/// Runs `serialize` with `Session::messages` omitted on this thread.
pub fn without_transcripts<R>(serialize: impl FnOnce() -> R) -> R {
    struct Restore(bool);
    impl Drop for Restore {
        fn drop(&mut self) {
            OMIT_TRANSCRIPTS.with(|flag| flag.set(self.0));
        }
    }
    let _restore = Restore(OMIT_TRANSCRIPTS.with(|flag| flag.replace(true)));
    serialize()
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct TranscriptRef<'a> {
    session_id: &'a str,
    messages: &'a [Message],
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Transcript {
    session_id: String,
    messages: Vec<Message>,
}

fn sessions_dir(path: &Path) -> PathBuf {
    path.parent()
        .unwrap_or_else(|| Path::new("."))
        .join(SESSIONS_DIR)
}

/// State content never chooses a path: unusual IDs are hashed into the name.
fn transcript_name(id: &str) -> String {
    if (1..=128).contains(&id.len())
        && id
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-' || byte == b'_')
    {
        format!("{id}.json")
    } else {
        use sha2::Digest;
        format!("h-{:x}.json", sha2::Sha256::digest(id.as_bytes()))
    }
}

fn content_hash(bytes: &[u8]) -> u64 {
    let mut hasher = DefaultHasher::new();
    bytes.hash(&mut hasher);
    hasher.finish()
}

/// A missing file is an empty transcript. Unparseable or foreign content is set
/// aside (never overwritten); other read errors refuse to load the state.
fn read_transcript(file: &Path, session_id: &str) -> Result<Option<(Vec<Message>, u64)>> {
    let bytes = match fs::read(file) {
        Ok(bytes) => bytes,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(error) => {
            return Err(Error::new(
                "persist",
                format!("cannot read a session transcript: {error}"),
            ))
        }
    };
    match serde_json::from_slice::<Transcript>(&bytes) {
        Ok(transcript) if transcript.session_id == session_id => {
            Ok(Some((transcript.messages, content_hash(&bytes))))
        }
        _ => {
            let aside = file.with_extension(format!(
                "corrupt-{}",
                std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .map(|time| time.as_secs())
                    .unwrap_or_default()
            ));
            fs::rename(file, &aside)?;
            tracing::error!("an unreadable session transcript was kept aside");
            Ok(None)
        }
    }
}

/// Transcript files (and interrupted temp files) of sessions the state no longer lists.
fn remove_orphans(dir: &Path, data: &AppData) {
    let Ok(entries) = fs::read_dir(dir) else {
        return;
    };
    let live = data
        .sessions
        .iter()
        .map(|session| transcript_name(&session.id))
        .collect::<HashSet<_>>();
    for entry in entries.flatten() {
        let name = entry.file_name().to_string_lossy().into_owned();
        let ours = name.ends_with(".json") || name.ends_with(".json.tmp");
        if ours && !live.contains(&name) && entry.file_type().is_ok_and(|kind| kind.is_file()) {
            let _ = fs::remove_file(entry.path());
        }
    }
}

/// Snapshot order. Taken while the caller holds the state lock, so a higher
/// generation is always a newer state.
static GENERATION: AtomicU64 = AtomicU64::new(0);

/// What is on disk for one state file: its generation and each transcript's hash.
#[derive(Default)]
struct Written {
    generation: u64,
    transcripts: HashMap<String, u64>,
}
/// The lock also serializes writers.
static WRITTEN: OnceLock<Mutex<HashMap<PathBuf, Written>>> = OnceLock::new();

fn slot<'a>(all: &'a mut HashMap<PathBuf, Written>, path: &Path) -> &'a mut Written {
    // Production has one state file; keep disposable test roots bounded.
    if !all.contains_key(path) && all.len() >= 64 {
        all.clear();
    }
    all.entry(path.to_path_buf()).or_default()
}

fn seed_written(path: &Path, transcripts: HashMap<String, u64>) {
    let mut all = WRITTEN.get_or_init(Mutex::default).lock();
    slot(&mut all, path).transcripts = transcripts;
}

fn next_generation() -> u64 {
    GENERATION.fetch_add(1, Ordering::SeqCst) + 1
}

struct Encoded {
    generation: u64,
    state: Vec<u8>,
    transcripts: Vec<(String, u64, Vec<u8>)>,
    /// Only some sessions' transcripts: files of the others are kept.
    partial: bool,
}

/// Compact JSON: the index without messages, and one transcript per session.
fn encode(data: &AppData, generation: u64) -> Result<Encoded> {
    let state = without_transcripts(|| serde_json::to_vec(data))?;
    let transcripts = data
        .sessions
        .iter()
        .map(|session| {
            let bytes = serde_json::to_vec(&TranscriptRef {
                session_id: &session.id,
                messages: &session.messages,
            })?;
            Ok((transcript_name(&session.id), content_hash(&bytes), bytes))
        })
        .collect::<Result<Vec<_>>>()?;
    Ok(Encoded {
        generation,
        state,
        transcripts,
        partial: false,
    })
}

/// Saves synchronously; callers hold the state lock and may roll back on error.
pub fn save(path: &Path, data: &AppData) -> Result<()> {
    write(path, &encode(data, next_generation())?)?;
    crate::diagnostics::observe(path, data);
    Ok(())
}

/// Writes only transcripts whose content changed, then the index, then removes
/// files of sessions the index no longer lists. A snapshot older than what is
/// already on disk is dropped, so a delayed checkpoint never replaces a newer save.
fn write(path: &Path, encoded: &Encoded) -> Result<()> {
    let mut all = WRITTEN.get_or_init(Mutex::default).lock();
    let disk = slot(&mut all, path);
    if disk.generation > encoded.generation {
        return Ok(());
    }
    let dir = sessions_dir(path);
    if !encoded.transcripts.is_empty() {
        fs::create_dir_all(&dir)?;
    }
    for (name, hash, bytes) in &encoded.transcripts {
        if disk.transcripts.get(name) == Some(hash) {
            continue;
        }
        atomic_write(&dir.join(name), bytes)?;
        disk.transcripts.insert(name.clone(), *hash);
    }
    atomic_write(path, &encoded.state)?;
    if encoded.partial {
        disk.generation = encoded.generation;
        return Ok(());
    }
    let live = encoded
        .transcripts
        .iter()
        .map(|(name, _, _)| name.as_str())
        .collect::<HashSet<_>>();
    let removed = disk
        .transcripts
        .keys()
        .filter(|name| !live.contains(name.as_str()))
        .cloned()
        .collect::<Vec<_>>();
    for name in removed {
        match fs::remove_file(dir.join(&name)) {
            Ok(()) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => {
                tracing::warn!(%error, "cannot remove a deleted session transcript");
                continue;
            }
        }
        disk.transcripts.remove(&name);
    }
    disk.generation = encoded.generation;
    Ok(())
}

fn atomic_write(path: &Path, bytes: &[u8]) -> Result<()> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    let tmp = path.with_extension("json.tmp");
    let mut file = fs::File::create(&tmp)?;
    file.write_all(bytes)?;
    file.sync_all()?;
    drop(file);
    fs::rename(tmp, path)?;
    Ok(())
}

/// Sessions whose transcripts changed since the last checkpoint, per state file.
static CHECKPOINT_SESSIONS: OnceLock<Mutex<HashMap<PathBuf, HashSet<String>>>> = OnceLock::new();

/// Coalesced, best-effort checkpoint for streaming output: at most one write per
/// second across every stream. Under the lock it encodes the index (metadata only)
/// and clones only the transcripts of the sessions that streamed; encoding, hashing
/// and writing them happen outside it. Other transcripts are left as they are on
/// disk. Final states keep using [`save`], which writes every changed transcript.
pub fn checkpoint_soon(state: &Arc<AppState>, session_id: &str) {
    {
        let mut all = CHECKPOINT_SESSIONS.get_or_init(Mutex::default).lock();
        if !all.contains_key(&state.data_path) && all.len() >= 64 {
            all.clear();
        }
        all.entry(state.data_path.clone())
            .or_default()
            .insert(session_id.to_owned());
    }
    if state.checkpoint_pending.swap(true, Ordering::AcqRel) {
        return;
    }
    let state = state.clone();
    std::thread::spawn(move || {
        std::thread::sleep(CHECKPOINT_DELAY);
        // Cleared before the snapshot, so later output schedules another checkpoint.
        state.checkpoint_pending.store(false, Ordering::Release);
        let snapshot = {
            let data = state.data.lock();
            let sessions = CHECKPOINT_SESSIONS
                .get_or_init(Mutex::default)
                .lock()
                .remove(&state.data_path)
                .unwrap_or_default();
            snapshot_sessions(&data, &sessions, next_generation())
        };
        if let Err(error) = snapshot
            .and_then(|snapshot| snapshot.encode())
            .and_then(|encoded| write(&state.data_path, &encoded))
        {
            tracing::error!(%error, "cannot checkpoint streamed output");
        }
    });
}

/// A checkpoint's view of the state: the encoded index and the named sessions' messages.
struct PartialSnapshot {
    generation: u64,
    state: Vec<u8>,
    transcripts: Vec<(String, Vec<Message>)>,
}

impl PartialSnapshot {
    fn encode(self) -> Result<Encoded> {
        let transcripts = self
            .transcripts
            .into_iter()
            .map(|(session_id, messages)| {
                let bytes = serde_json::to_vec(&TranscriptRef {
                    session_id: &session_id,
                    messages: &messages,
                })?;
                Ok((transcript_name(&session_id), content_hash(&bytes), bytes))
            })
            .collect::<Result<Vec<_>>>()?;
        Ok(Encoded {
            generation: self.generation,
            state: self.state,
            transcripts,
            partial: true,
        })
    }
}

/// Taken under the state lock; cheap: the index has no messages.
fn snapshot_sessions(
    data: &AppData,
    sessions: &HashSet<String>,
    generation: u64,
) -> Result<PartialSnapshot> {
    Ok(PartialSnapshot {
        generation,
        state: without_transcripts(|| serde_json::to_vec(data))?,
        transcripts: data
            .sessions
            .iter()
            .filter(|session| sessions.contains(&session.id))
            .map(|session| (session.id.clone(), session.messages.clone()))
            .collect(),
    })
}

const CHECKPOINT_DELAY: Duration = Duration::from_secs(1);

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn a_delayed_older_snapshot_never_replaces_a_newer_save() {
        let temp = crate::git::tests::Repo::new();
        let path = temp.0.join("state.json");
        let older = encode(&AppData::default(), next_generation()).unwrap();
        let mut newer_data = AppData::default();
        newer_data
            .composer_drafts
            .insert("session:s".into(), "newer".into());
        save(&path, &newer_data).unwrap();
        write(&path, &older).unwrap();
        let loaded = load_or_create(&path).unwrap();
        assert_eq!(loaded.composer_drafts["session:s"], "newer");
    }

    fn session(id: &str, texts: &[&str]) -> crate::models::Session {
        let messages = texts
            .iter()
            .enumerate()
            .map(|(index, text)| serde_json::json!({"id":format!("{id}-{index}"),"sessionId":id,"role":"agent","content":text,"createdAt":"t","streaming":false}))
            .collect::<Vec<_>>();
        serde_json::from_value(serde_json::json!({"id":id,"title":"Task","projectId":"p","agent":"codex","status":"completed","createdAt":"t","lastActivityAt":"t","worktree":{"path":"/fixture","branch":"main","isolated":false},"lastError":null,"messages":messages})).unwrap()
    }

    #[test]
    fn transcripts_live_in_their_own_files_and_only_changed_ones_are_rewritten() {
        let temp = crate::git::tests::Repo::new();
        let path = temp.0.join("state.json");
        let mut data = AppData {
            sessions: vec![session("a", &["first"]), session("b", &["other"])],
            ..AppData::default()
        };
        save(&path, &data).unwrap();
        let index: serde_json::Value = serde_json::from_slice(&fs::read(&path).unwrap()).unwrap();
        assert!(index["sessions"]
            .as_array()
            .unwrap()
            .iter()
            .all(|s| s.get("messages").is_none()));
        let dir = temp.0.join("sessions");
        assert!(dir.join("a.json").exists() && dir.join("b.json").exists());
        // Over IPC the transcript stays inline.
        assert!(serde_json::to_value(&data.sessions[0])
            .unwrap()
            .get("messages")
            .is_some());

        // An unchanged transcript is not rewritten: a marker in its file survives the save.
        let marker = fs::read(dir.join("b.json")).unwrap();
        fs::write(
            dir.join("b.json"),
            [&marker[..marker.len() - 1], b" }"].concat(),
        )
        .unwrap();
        data.sessions[0].messages[0].content.push_str(" and more");
        save(&path, &data).unwrap();
        assert!(fs::read(dir.join("b.json")).unwrap().ends_with(b" }"));

        let loaded = load_or_create(&path).unwrap();
        assert_eq!(loaded.sessions[0].messages[0].content, "first and more");
        assert_eq!(loaded.sessions[1].messages[0].content, "other");

        // A removed session's file goes once the index no longer lists it.
        data.sessions.remove(1);
        save(&path, &data).unwrap();
        assert!(!dir.join("b.json").exists());
    }

    #[test]
    fn a_streaming_checkpoint_writes_only_the_named_transcripts() {
        let temp = crate::git::tests::Repo::new();
        let path = temp.0.join("state.json");
        let dir = temp.0.join("sessions");
        let mut data = AppData {
            sessions: vec![session("a", &["first"]), session("b", &["other"])],
            ..AppData::default()
        };
        save(&path, &data).unwrap();
        data.sessions[0].messages[0].content.push_str(" streamed");
        // A change the checkpoint was not told about waits for the next full save.
        data.sessions[1].messages[0].content.push_str(" unsaved");
        data.sessions.push(session("c", &["new"]));
        let named = HashSet::from(["a".to_owned()]);
        let snapshot = snapshot_sessions(&data, &named, next_generation()).unwrap();
        assert_eq!(
            snapshot.transcripts.len(),
            1,
            "only the streaming session is cloned"
        );
        write(&path, &snapshot.encode().unwrap()).unwrap();
        let loaded = load_or_create(&path).unwrap();
        assert_eq!(loaded.sessions.len(), 3, "the index is current");
        assert_eq!(loaded.sessions[0].messages[0].content, "first streamed");
        assert_eq!(loaded.sessions[1].messages[0].content, "other");
        assert!(loaded.sessions[2].messages.is_empty());
        assert!(dir.join("b.json").exists(), "other transcripts are kept");
        save(&path, &data).unwrap();
        let loaded = load_or_create(&path).unwrap();
        assert_eq!(loaded.sessions[1].messages[0].content, "other unsaved");
        assert_eq!(loaded.sessions[2].messages[0].content, "new");
    }

    #[test]
    fn a_legacy_single_file_is_backed_up_and_split_once() {
        let temp = crate::git::tests::Repo::new();
        let path = temp.0.join("state.json");
        let mut legacy = serde_json::to_value(AppData::default()).unwrap();
        legacy["sessions"] =
            serde_json::json!([serde_json::to_value(session("old", &["kept"])).unwrap()]);
        let raw = serde_json::to_string_pretty(&legacy).unwrap();
        fs::write(&path, &raw).unwrap();
        let loaded = load_or_create(&path).unwrap();
        assert_eq!(loaded.sessions[0].messages[0].content, "kept");
        assert_eq!(
            fs::read_to_string(path.with_extension("json.pre-split-backup")).unwrap(),
            raw
        );
        let index: serde_json::Value = serde_json::from_slice(&fs::read(&path).unwrap()).unwrap();
        assert!(index["sessions"][0].get("messages").is_none());
        assert!(temp.0.join("sessions/old.json").exists());
        assert_eq!(
            load_or_create(&path).unwrap().sessions[0].messages[0].content,
            "kept"
        );
    }

    #[test]
    fn damaged_orphan_and_unsafe_transcripts_never_lose_data_or_choose_paths() {
        let temp = crate::git::tests::Repo::new();
        let path = temp.0.join("state.json");
        let data = AppData {
            sessions: vec![session("good", &["ok"]), session("../escape", &["safe"])],
            ..AppData::default()
        };
        save(&path, &data).unwrap();
        let dir = temp.0.join("sessions");
        let hashed = transcript_name("../escape");
        assert!(hashed.starts_with("h-") && dir.join(&hashed).exists());
        assert!(!temp.0.join("escape.json").exists());

        fs::write(dir.join("good.json"), b"{not json").unwrap();
        fs::write(dir.join("ghost.json"), b"{}").unwrap();
        let loaded = load_or_create(&path).unwrap();
        assert!(loaded.sessions[0].messages.is_empty());
        assert_eq!(loaded.sessions[1].messages[0].content, "safe");
        assert!(!dir.join("ghost.json").exists(), "orphans are removed");
        let aside = fs::read_dir(&dir)
            .unwrap()
            .flatten()
            .find(|entry| {
                entry
                    .file_name()
                    .to_string_lossy()
                    .starts_with("good.corrupt-")
            })
            .expect("damaged transcript is kept aside");
        assert_eq!(fs::read(aside.path()).unwrap(), b"{not json");
    }
    #[test]
    fn embedded_thumbnails_move_to_files_on_load_and_orphans_go() {
        let temp = crate::git::tests::Repo::new();
        let path = temp.0.join("state.json");
        let id = uuid::Uuid::new_v4().to_string();
        let orphan = uuid::Uuid::new_v4().to_string();
        let mut data = AppData {
            sessions: vec![session("s", &[])],
            ..AppData::default()
        };
        data.sessions[0].messages = vec![serde_json::from_value(serde_json::json!({
            "id":"m","sessionId":"s","role":"user","content":"look","createdAt":"t","streaming":false,
            "attachments":[{"id":id,"name":"a.png","kind":"file","thumbnail":crate::thumbnails::data_url(b"jpeg")}]
        }))
        .unwrap()];
        save(&path, &data).unwrap();
        crate::thumbnails::store(&path, &orphan, b"old").unwrap();
        let loaded = load_or_create(&path).unwrap();
        let attachment = &loaded.sessions[0].messages[0].attachments[0];
        assert!(attachment.has_thumbnail && attachment.thumbnail.is_none());
        assert_eq!(crate::thumbnails::read(&path, &id).unwrap(), b"jpeg");
        assert!(crate::thumbnails::read(&path, &orphan).is_none());
        let saved = fs::read_to_string(temp.0.join("sessions/s.json")).unwrap();
        assert!(!saved.contains("base64") && saved.contains("\"hasThumbnail\":true"));
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
