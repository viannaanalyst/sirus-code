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
use crate::transcript_store::{Counts, Origin};

/// Per-session transcripts live next to `state.json` (ADR-047).
const SESSIONS_DIR: &str = "sessions";

/// The index records each transcript's counts, so views and checks never read an
/// unloaded transcript for them (ADR-099).
const MESSAGE_COUNT: &str = "messageCount";
const TRANSCRIPT_LENGTH: &str = "transcriptLength";

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
    let entries = value
        .get("sessions")
        .and_then(|sessions| sessions.as_array())
        .map(Vec::as_slice)
        .unwrap_or_default();
    // A session entry that still carries `messages` is the legacy single-file layout.
    let inline = entries
        .iter()
        .filter(|session| session.get("messages").is_some())
        .filter_map(|session| session.get("id")?.as_str().map(str::to_owned))
        .collect::<HashSet<_>>();
    let stored = stored_counts(entries);
    let mut data: AppData = serde_json::from_value(value)
        .map_err(|err| Error::new("persist", format!("invalid state: {err}")))?;
    let dir = sessions_dir(path);
    let mut known = HashMap::new();
    // A transcript set aside as unreadable may still name thumbnail files.
    let mut set_aside = false;
    // Counts were not recorded yet (state written before ADR-099): checkpoint them.
    let mut counted = false;
    for session in &mut data.sessions {
        if inline.contains(&session.id) {
            continue;
        }
        let name = transcript_name(&session.id);
        known.insert(name.clone(), FileState::default());
        let origin = Origin::new(path, &session.id);
        // A session that was running at shutdown is recovered below, with its transcript.
        let active = session.status.is_active();
        if let (false, Some(counts)) = (active, stored.get(&session.id)) {
            session.messages.set_unloaded(origin, *counts);
            continue;
        }
        let file = dir.join(&name);
        let existed = file.exists();
        let read = read_transcript(&file, &session.id)?;
        set_aside |= existed && read.is_none();
        let (messages, hash) = read.map_or((Vec::new(), None), |(m, h)| (m, Some(h)));
        if active {
            session.messages.install(messages);
            known.insert(
                name,
                FileState {
                    revision: Some(session.messages.revision()),
                    hash,
                },
            );
        } else {
            session.messages.set_unloaded(origin, Counts::of(&messages));
            counted = true;
        }
    }
    remove_orphans(&dir, &data);
    seed_written(path, known);
    crate::sidebar::prune(&mut data);
    crate::context_text::prune(&mut data);
    crate::astros::retire_styles(&mut data);
    crate::appearance::normalize(&mut data.settings);
    // Closed enum migration (legacy System → Dark), defaults and numeric bounds
    // are checkpointed once so retained preferences already use the new schema.
    let mut recovered = original_settings.as_ref() != Some(&serde_json::to_value(&data.settings)?);
    recovered |= counted;
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
        recovered |= crate::project_scripts::recover(session);
        // Only active-at-shutdown and legacy inline transcripts are loaded here; the
        // others get the same recovery when they are read (`transcript_store::install`).
        if !session.messages.is_loaded() {
            continue;
        }
        crate::activity::recover(session);
        // Older transcripts embedded image thumbnails; they move to files once.
        recovered |= crate::thumbnails::migrate(path, &mut session.messages);
        if session.messages.iter().any(|message| message.streaming) {
            for message in &mut session.messages {
                message.streaming = false;
            }
            recovered = true;
        }
    }
    recovered |= crate::team::recover(&mut data);
    recovered |= crate::automations::retire_standalone(&mut data);
    if recovered {
        save(path, &data)?;
    }
    if !set_aside {
        crate::thumbnails::remove_orphans_later(path, &data);
    }
    crate::diagnostics::observe(path, &data);
    Ok(data)
}

/// Counts the index recorded per session id.
fn stored_counts(entries: &[serde_json::Value]) -> HashMap<String, Counts> {
    entries
        .iter()
        .filter_map(|entry| {
            let count = |key: &str| {
                entry
                    .get(key)?
                    .as_u64()
                    .and_then(|count| usize::try_from(count).ok())
            };
            Some((
                entry.get("id")?.as_str()?.to_owned(),
                Counts {
                    messages: count(MESSAGE_COUNT)?,
                    conversation: count(TRANSCRIPT_LENGTH)?,
                },
            ))
        })
        .collect()
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

fn origin_file(origin: &Origin) -> PathBuf {
    sessions_dir(&origin.state_path).join(transcript_name(&origin.session_id))
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

/// A transcript read on demand, recovered like a startup load: stale streaming
/// flags cleared and embedded thumbnails moved to files.
pub struct Read {
    pub messages: Vec<Message>,
    /// Hash of the file as read; `None` when there was no file.
    pub hash: Option<u64>,
    /// Recovery changed it: it is unsaved until the next save.
    pub changed: bool,
}

/// Reads an unloaded transcript to load it (ADR-099).
pub fn read_origin(origin: &Origin) -> Result<Read> {
    let (mut messages, hash) = match read_transcript(&origin_file(origin), &origin.session_id)? {
        Some((messages, hash)) => (messages, Some(hash)),
        None => (Vec::new(), None),
    };
    let mut changed = crate::thumbnails::migrate(&origin.state_path, &mut messages);
    for message in messages.iter_mut().filter(|message| message.streaming) {
        message.streaming = false;
        changed = true;
    }
    Ok(Read {
        messages,
        hash,
        changed,
    })
}

/// A scan's read: never sets anything aside or migrates. `None` when unreadable.
pub fn read_only(origin: &Origin) -> Option<Vec<Message>> {
    let bytes = match fs::read(origin_file(origin)) {
        Ok(bytes) => bytes,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Some(Vec::new()),
        Err(_) => return None,
    };
    serde_json::from_slice::<Transcript>(&bytes)
        .ok()
        .filter(|transcript| transcript.session_id == origin.session_id)
        .map(|transcript| transcript.messages)
}

/// The file's bytes for literal scans; an absent file is empty.
pub fn read_raw(origin: &Origin) -> Option<Vec<u8>> {
    match fs::read(origin_file(origin)) {
        Ok(bytes) => Some(bytes),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Some(Vec::new()),
        Err(_) => None,
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

/// What is on disk for one transcript file: the revision of the session content it
/// holds (`None` when unknown, e.g. a file not read since startup) and its hash.
#[derive(Default, Clone, Copy)]
struct FileState {
    revision: Option<u64>,
    hash: Option<u64>,
}

/// What is on disk for one state file: its generation and each transcript file.
#[derive(Default)]
struct Written {
    generation: u64,
    transcripts: HashMap<String, FileState>,
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

fn seed_written(path: &Path, transcripts: HashMap<String, FileState>) {
    let mut all = WRITTEN.get_or_init(Mutex::default).lock();
    slot(&mut all, path).transcripts = transcripts;
}

/// A transcript just read matches its file: it is saved at `revision`.
pub fn mark_saved(path: &Path, session_id: &str, revision: u64, hash: Option<u64>) {
    let mut all = WRITTEN.get_or_init(Mutex::default).lock();
    slot(&mut all, path).transcripts.insert(
        transcript_name(session_id),
        FileState {
            revision: Some(revision),
            hash,
        },
    );
}

/// Whether each `(session id, revision)` is what its file holds.
pub fn saved(path: &Path, sessions: &[(&str, u64)]) -> Vec<bool> {
    let mut all = WRITTEN.get_or_init(Mutex::default).lock();
    let disk = slot(&mut all, path);
    sessions
        .iter()
        .map(|(id, revision)| {
            disk.transcripts
                .get(&transcript_name(id))
                .is_some_and(|file| file.revision == Some(*revision))
        })
        .collect()
}

fn next_generation() -> u64 {
    GENERATION.fetch_add(1, Ordering::SeqCst) + 1
}

/// The index without messages, with each session's transcript counts.
fn encode_state(data: &AppData) -> Result<Vec<u8>> {
    let mut value = without_transcripts(|| serde_json::to_value(data))?;
    if let Some(entries) = value
        .get_mut("sessions")
        .and_then(serde_json::Value::as_array_mut)
    {
        for (entry, session) in entries.iter_mut().zip(&data.sessions) {
            let counts = session.messages.counts();
            entry[MESSAGE_COUNT] = counts.messages.into();
            entry[TRANSCRIPT_LENGTH] = counts.conversation.into();
        }
    }
    Ok(serde_json::to_vec(&value)?)
}

/// Writes one transcript unless the file already holds `revision` or the same bytes.
fn write_transcript(
    dir: &Path,
    disk: &mut Written,
    session_id: &str,
    revision: u64,
    messages: &[Message],
) -> Result<bool> {
    let name = transcript_name(session_id);
    let file = disk.transcripts.entry(name.clone()).or_default();
    if file.revision == Some(revision) {
        return Ok(false);
    }
    let bytes = serde_json::to_vec(&TranscriptRef {
        session_id,
        messages,
    })?;
    let hash = content_hash(&bytes);
    let wrote = file.hash != Some(hash);
    if wrote {
        atomic_write(&dir.join(&name), &bytes)?;
    }
    *file = FileState {
        revision: Some(revision),
        hash: Some(hash),
    };
    Ok(wrote)
}

/// Saves synchronously; callers hold the state lock and may roll back on error.
/// Writes the index and only the transcripts that are loaded and changed since they
/// were last written (ADR-099): unloaded ones keep their files untouched, and a save
/// of settings, drafts or metadata writes `state.json` alone. Files of sessions the
/// index no longer lists are removed afterwards.
pub fn save(path: &Path, data: &AppData) -> Result<()> {
    let state = encode_state(data)?;
    let generation = next_generation();
    let dir = sessions_dir(path);
    let mut all = WRITTEN.get_or_init(Mutex::default).lock();
    let disk = slot(&mut all, path);
    for session in &data.sessions {
        let Some(messages) = session.messages.loaded() else {
            continue;
        };
        write_transcript(
            &dir,
            disk,
            &session.id,
            session.messages.revision(),
            messages,
        )?;
    }
    atomic_write(path, &state)?;
    let live = data
        .sessions
        .iter()
        .map(|session| transcript_name(&session.id))
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
    disk.generation = generation;
    drop(all);
    crate::diagnostics::observe(path, data);
    Ok(())
}

/// A checkpoint's encoded view: the index and the named transcripts.
struct Encoded {
    generation: u64,
    state: Vec<u8>,
    transcripts: Vec<(String, u64, Vec<Message>)>,
}

/// Writes a checkpoint: its transcripts (when changed), then the index. A snapshot
/// older than what is already on disk is dropped, so a delayed checkpoint never
/// replaces a newer save. Other transcripts' files are kept.
fn write(path: &Path, encoded: &Encoded) -> Result<()> {
    let mut all = WRITTEN.get_or_init(Mutex::default).lock();
    let disk = slot(&mut all, path);
    if disk.generation > encoded.generation {
        return Ok(());
    }
    let dir = sessions_dir(path);
    for (session_id, revision, messages) in &encoded.transcripts {
        write_transcript(&dir, disk, session_id, *revision, messages)?;
    }
    atomic_write(path, &encoded.state)?;
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
        if let Err(error) = snapshot.and_then(|encoded| write(&state.data_path, &encoded)) {
            tracing::error!(%error, "cannot checkpoint streamed output");
        }
    });
}

/// Taken under the state lock; cheap: the index has no messages and only the named,
/// loaded transcripts are cloned.
fn snapshot_sessions(
    data: &AppData,
    sessions: &HashSet<String>,
    generation: u64,
) -> Result<Encoded> {
    Ok(Encoded {
        generation,
        state: encode_state(data)?,
        transcripts: data
            .sessions
            .iter()
            .filter(|session| sessions.contains(&session.id))
            .filter_map(|session| {
                let messages = session.messages.loaded()?;
                Some((
                    session.id.clone(),
                    session.messages.revision(),
                    messages.to_vec(),
                ))
            })
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
        let older =
            snapshot_sessions(&AppData::default(), &HashSet::new(), next_generation()).unwrap();
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
        write(&path, &snapshot).unwrap();
        let loaded = load_or_create(&path).unwrap();
        assert_eq!(loaded.sessions.len(), 3, "the index is current");
        assert_eq!(loaded.sessions[0].messages[0].content, "first streamed");
        assert_eq!(loaded.sessions[1].messages[0].content, "other");
        assert!(loaded.sessions[2].messages.iter().next().is_none());
        assert!(dir.join("b.json").exists(), "other transcripts are kept");
        save(&path, &data).unwrap();
        let loaded = load_or_create(&path).unwrap();
        assert_eq!(loaded.sessions[1].messages[0].content, "other unsaved");
        assert_eq!(loaded.sessions[2].messages[0].content, "new");
    }

    fn loaded_ids(data: &AppData) -> Vec<&str> {
        data.sessions
            .iter()
            .filter(|session| session.messages.is_loaded())
            .map(|session| session.id.as_str())
            .collect()
    }

    #[test]
    fn startup_loads_only_interrupted_transcripts_and_never_writes_unloaded_ones_empty() {
        let temp = crate::git::tests::Repo::new();
        let path = temp.0.join("state.json");
        let dir = temp.0.join("sessions");
        let mut data = AppData {
            sessions: vec![
                session("a", &["first", "second"]),
                session("b", &["other"]),
                session("c", &["partial"]),
            ],
            ..AppData::default()
        };
        data.sessions[2].status = crate::models::SessionStatus::Running;
        save(&path, &data).unwrap();
        let original = fs::read(dir.join("a.json")).unwrap();
        let loaded = load_or_create(&path).unwrap();
        assert_eq!(
            loaded_ids(&loaded),
            ["c"],
            "only the interrupted turn loads"
        );
        assert_eq!(
            loaded.sessions[2].status,
            crate::models::SessionStatus::Stopped
        );
        // Counts come from the index, without reading the transcript.
        assert_eq!(loaded.sessions[0].messages.len(), 2);
        assert_eq!(loaded.sessions[0].messages.conversation_len(), 2);
        assert!(!loaded.sessions[0].messages.is_loaded());
        save(&path, &loaded).unwrap();
        assert_eq!(fs::read(dir.join("a.json")).unwrap(), original);
        assert_eq!(
            load_or_create(&path).unwrap().sessions[0].messages.len(),
            2,
            "the index keeps the counts of unloaded transcripts"
        );

        // A transcript that cannot be read stays read-only: its empty view is never saved.
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mut loaded = load_or_create(&path).unwrap();
            let file = dir.join("a.json");
            fs::set_permissions(&file, fs::Permissions::from_mode(0o000)).unwrap();
            if fs::read(&file).is_err() {
                let mut extra = loaded.sessions[1].messages[0].clone();
                extra.id = "new".into();
                loaded.sessions[0].messages.push(extra);
                assert!(loaded.sessions[0].messages.failed());
                save(&path, &loaded).unwrap();
            }
            fs::set_permissions(&file, fs::Permissions::from_mode(0o644)).unwrap();
            assert_eq!(fs::read(&file).unwrap(), original);
            let index: serde_json::Value =
                serde_json::from_slice(&fs::read(&path).unwrap()).unwrap();
            assert_eq!(index["sessions"][0]["messageCount"], 2);
        }
    }

    #[test]
    fn saves_write_only_changed_transcripts_and_a_settings_save_writes_only_the_index() {
        let temp = crate::git::tests::Repo::new();
        let path = temp.0.join("state.json");
        let dir = temp.0.join("sessions");
        let mut data = AppData {
            sessions: vec![session("a", &["first"]), session("b", &["other"])],
            ..AppData::default()
        };
        save(&path, &data).unwrap();
        // A marker survives only while its file is not rewritten.
        let mark = |name: &str| {
            let bytes = fs::read(dir.join(name)).unwrap();
            fs::write(dir.join(name), [&bytes[..bytes.len() - 1], b" }"].concat()).unwrap();
        };
        let marked = |name: &str| fs::read(dir.join(name)).unwrap().ends_with(b" }");
        mark("a.json");
        mark("b.json");
        data.composer_drafts
            .insert("session:a".into(), "draft".into());
        data.settings.ui_font_size = 15;
        save(&path, &data).unwrap();
        assert!(
            marked("a.json") && marked("b.json"),
            "settings touch no transcript"
        );
        let index: serde_json::Value = serde_json::from_slice(&fs::read(&path).unwrap()).unwrap();
        assert_eq!(index["composerDrafts"]["session:a"], "draft");
        // Reading is not a change.
        assert_eq!(data.sessions[1].messages.iter().count(), 1);
        data.sessions[0].title = "Renamed".into();
        save(&path, &data).unwrap();
        assert!(marked("a.json") && marked("b.json"));
        data.sessions[0].messages[0].content.push_str(" and more");
        save(&path, &data).unwrap();
        assert!(!marked("a.json"), "the changed transcript is written");
        assert!(marked("b.json"), "the unchanged one is not");
        assert_eq!(
            load_or_create(&path).unwrap().sessions[0].messages[0].content,
            "first and more"
        );
    }

    #[test]
    fn transcripts_load_on_demand_exactly_as_saved() {
        let temp = crate::git::tests::Repo::new();
        let path = temp.0.join("state.json");
        let mut data = AppData {
            sessions: vec![
                session("a", &["one", "two", "three"]),
                session("b", &["other"]),
                session("c", &[]),
            ],
            ..AppData::default()
        };
        data.sessions[0].messages[1].activity = Some(crate::activity::TurnActivity::new(
            crate::models::AgentProviderId::Codex,
            Some("model".into()),
        ));
        data.sessions[0].messages[1]
            .activity
            .as_mut()
            .unwrap()
            .ended_at = Some(5);
        save(&path, &data).unwrap();
        let state = Mutex::new(load_or_create(&path).unwrap());
        assert!(loaded_ids(&state.lock()).is_empty());
        let guard = crate::transcript_store::lock_loaded(&state, &path, &["a", "b", "c"]);
        assert_eq!(loaded_ids(&guard), ["a", "b", "c"]);
        for (loaded, saved) in guard.sessions.iter().zip(&data.sessions) {
            assert_eq!(
                serde_json::to_value(&loaded.messages).unwrap(),
                serde_json::to_value(&saved.messages).unwrap()
            );
        }
        // Loaded content matches its file, so it is saved and can be released again.
        let revisions = guard
            .sessions
            .iter()
            .map(|session| (session.id.as_str(), session.messages.revision()))
            .collect::<Vec<_>>();
        assert!(saved(&path, &revisions).into_iter().all(|saved| saved));
    }

    #[test]
    fn eviction_keeps_active_unsaved_and_recently_used_transcripts() {
        let temp = crate::git::tests::Repo::new();
        let path = temp.0.join("state.json");
        let ids = (0..10).map(|index| format!("s{index}")).collect::<Vec<_>>();
        let data = AppData {
            sessions: ids.iter().map(|id| session(id, &["text"])).collect(),
            ..AppData::default()
        };
        save(&path, &data).unwrap();
        let state = Mutex::new(load_or_create(&path).unwrap());
        let all = ids.iter().map(String::as_str).collect::<Vec<_>>();
        let mut data = crate::transcript_store::lock_loaded(&state, &path, &all);
        assert_eq!(
            loaded_ids(&data).len(),
            10,
            "requested transcripts all load"
        );
        data.sessions[0].status = crate::models::SessionStatus::Running;
        data.sessions[1].messages[0].content.push_str(" unsaved");
        let released = crate::transcript_store::evict(&mut data, &path, &[]);
        assert_eq!(released, 2);
        assert_eq!(
            loaded_ids(&data),
            ["s0", "s1", "s4", "s5", "s6", "s7", "s8", "s9"],
            "active and unsaved stay with the six most recently used"
        );
        assert_eq!(data.sessions[2].messages.len(), 1, "counts stay");
        save(&path, &data).unwrap();
        assert_eq!(crate::transcript_store::evict(&mut data, &path, &[]), 1);
        assert_eq!(
            loaded_ids(&data),
            ["s0", "s4", "s5", "s6", "s7", "s8", "s9"]
        );
        // A released transcript reads back with its saved change.
        drop(data);
        let data = crate::transcript_store::lock_loaded(&state, &path, &["s1"]);
        assert_eq!(data.sessions[1].messages[0].content, "text unsaved");
    }

    /// Before/after numbers for docs/PERFORMANCE.md:
    /// `cargo test --release measure_lazy_transcripts -- --ignored --nocapture`.
    #[test]
    #[ignore]
    fn measure_lazy_transcripts() {
        use std::time::Instant;
        let temp = crate::git::tests::Repo::new();
        let path = temp.0.join("state.json");
        let text = "Lorem ipsum dolor sit amet, consectetur adipiscing elit. ".repeat(24);
        let texts = (0..60).map(|_| text.as_str()).collect::<Vec<_>>();
        let data = AppData {
            sessions: (0..300)
                .map(|index| session(&format!("s{index}"), &texts))
                .collect(),
            ..AppData::default()
        };
        save(&path, &data).unwrap();
        let dir = temp.0.join("sessions");
        let on_disk = fs::read_dir(&dir)
            .unwrap()
            .flatten()
            .map(|entry| entry.metadata().unwrap().len())
            .sum::<u64>();
        let started = Instant::now();
        let lazy = load_or_create(&path).unwrap();
        let lazy_load = started.elapsed();
        let resident = |data: &AppData| {
            data.sessions
                .iter()
                .filter_map(|session| session.messages.loaded())
                .map(|list| serde_json::to_vec(list).unwrap().len())
                .sum::<usize>()
        };
        let lazy_resident = resident(&lazy);
        // Before: every transcript read and kept at startup.
        let started = Instant::now();
        let state = Mutex::new(lazy);
        let all = (0..300)
            .map(|index| format!("s{index}"))
            .collect::<Vec<_>>();
        let eager = crate::transcript_store::lock_loaded(
            &state,
            &path,
            &all.iter().map(String::as_str).collect::<Vec<_>>(),
        );
        let eager_load = started.elapsed() + lazy_load;
        let eager_resident = resident(&eager);
        // Before: every save encoded and hashed every transcript.
        let started = Instant::now();
        for session in &eager.sessions {
            let bytes = serde_json::to_vec(&TranscriptRef {
                session_id: &session.id,
                messages: session.messages.loaded().unwrap(),
            })
            .unwrap();
            content_hash(&bytes);
        }
        let old_save = started.elapsed();
        let started = Instant::now();
        save(&path, &eager).unwrap();
        let new_save = started.elapsed();
        let index = fs::metadata(&path).unwrap().len();
        println!(
            "transcripts on disk {on_disk} B, index {index} B\n\
             startup: lazy {lazy_load:?} keeping {lazy_resident} B; eager {eager_load:?} keeping {eager_resident} B\n\
             metadata save: before (encode all) {old_save:?}, now {new_save:?}"
        );
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
        // Read when used: the damaged file is set aside then, never overwritten.
        assert!(loaded.sessions[0].messages.iter().next().is_none());
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
        .unwrap()]
        .into();
        save(&path, &data).unwrap();
        crate::thumbnails::store(&path, &orphan, b"old").unwrap();
        std::thread::sleep(Duration::from_millis(20));
        let loaded = load_or_create(&path).unwrap();
        // The transcript migrates when it is read, and is saved with the next save.
        let attachment = &loaded.sessions[0].messages[0].attachments[0];
        assert!(attachment.has_thumbnail && attachment.thumbnail.is_none());
        assert_eq!(crate::thumbnails::read(&path, &id).unwrap(), b"jpeg");
        save(&path, &loaded).unwrap();
        // Orphans go on a background scan after load.
        let deadline = std::time::Instant::now() + Duration::from_secs(5);
        while crate::thumbnails::read(&path, &orphan).is_some() {
            assert!(std::time::Instant::now() < deadline, "orphan removed");
            std::thread::sleep(Duration::from_millis(10));
        }
        assert_eq!(crate::thumbnails::read(&path, &id).unwrap(), b"jpeg");
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
