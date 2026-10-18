//! SQLite storage (ADR-114). The app keeps its state in memory
//! exactly as before; this module is only where it is saved and read. One database next to
//! the old `state.json` (`state.db`), in WAL mode, with a numbered schema:
//!
//! - `projects`, `tasks`: one row per item (id, position, JSON);
//! - `sessions`: one row per session without its messages, with the transcript counts;
//! - `messages`: one row per message, so a save writes only the messages that changed;
//! - `settings`: one row; `app_state`: the remaining top-level fields, one row each.
//!
//! Every save is one transaction that writes only rows whose JSON changed since they were
//! last written (hashes kept in memory), and deletes rows that are gone. Transcripts that
//! are not loaded are never touched. A delayed checkpoint older than what is on disk is
//! dropped, as with the JSON files (ADR-099).

use std::collections::hash_map::DefaultHasher;
use std::collections::{HashMap, HashSet};
use std::hash::{Hash, Hasher};
use std::path::{Path, PathBuf};
use std::sync::OnceLock;

use parking_lot::Mutex;
use rusqlite::{params, Connection, OptionalExtension};
use serde_json::{Map, Value};

use crate::error::{Error, Result};
use crate::models::Message;

/// Item collections stored one row per item.
pub const ROW_TABLES: [(&str, &str); 3] = [
    ("projects", "projects"),
    ("tasks", "tasks"),
    ("reviewGuides", "review_guides"),
];
/// Index fields written into a session row's count columns (ADR-099).
const MESSAGE_COUNT: &str = "messageCount";
const TRANSCRIPT_LENGTH: &str = "transcriptLength";

const SCHEMA_V1: &str = r#"
CREATE TABLE IF NOT EXISTS settings (id INTEGER PRIMARY KEY CHECK (id = 1), json TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS app_state (key TEXT PRIMARY KEY, json TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS projects (id TEXT PRIMARY KEY, position INTEGER NOT NULL, json TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS tasks (id TEXT PRIMARY KEY, position INTEGER NOT NULL, json TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS astros (id TEXT PRIMARY KEY, position INTEGER NOT NULL, json TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS automations (id TEXT PRIMARY KEY, position INTEGER NOT NULL, json TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  position INTEGER NOT NULL,
  json TEXT NOT NULL,
  message_count INTEGER NOT NULL DEFAULT 0,
  transcript_length INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS messages (
  session_id TEXT NOT NULL,
  position INTEGER NOT NULL,
  id TEXT NOT NULL,
  json TEXT NOT NULL,
  PRIMARY KEY (session_id, position)
) WITHOUT ROWID;
"#;

/// Astros and their habits were removed (ADR-116): their tables and saved state go.
const SCHEMA_V2: &str = r#"
DROP TABLE IF EXISTS astros;
DROP TABLE IF EXISTS automations;
DELETE FROM app_state WHERE key IN ('automationRuns', 'astros', 'automations');
"#;

/// Guided reviews (ADR-125): one row per guide.
const SCHEMA_V4: &str = r#"
CREATE TABLE IF NOT EXISTS review_guides (id TEXT PRIMARY KEY, position INTEGER NOT NULL, json TEXT NOT NULL);
"#;

/// The database beside a state file: `state.json` → `state.db`.
pub fn db_path(state_path: &Path) -> PathBuf {
    state_path.with_extension("db")
}

pub fn exists(state_path: &Path) -> bool {
    db_path(state_path).exists()
}

fn hash(text: &str) -> u64 {
    let mut hasher = DefaultHasher::new();
    text.hash(&mut hasher);
    hasher.finish()
}

/// What one session's message rows hold, as last written or read.
#[derive(Default, Clone)]
struct Transcript {
    /// The in-memory revision those rows hold; `None` when unknown.
    revision: Option<u64>,
    /// Per position: message id and JSON hash.
    rows: Vec<(String, u64)>,
}

struct Db {
    conn: Connection,
    /// Order of snapshots: a write older than this is dropped.
    generation: u64,
    /// `(table, key)` → hash of the JSON on disk.
    rows: HashMap<(String, String), u64>,
    transcripts: HashMap<String, Transcript>,
}

static OPEN: OnceLock<Mutex<HashMap<PathBuf, Db>>> = OnceLock::new();

fn sql(error: rusqlite::Error) -> Error {
    Error::new("persist", format!("database: {error}"))
}

fn connect(state_path: &Path) -> Result<Db> {
    if let Some(parent) = state_path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let conn = Connection::open(db_path(state_path)).map_err(sql)?;
    conn.execute_batch(
        // The WAL file shrinks back to 32 MiB after a checkpoint (a host runs for months, ADR-131).
        "PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000; PRAGMA journal_size_limit = 33554432;",
    )
    .map_err(sql)?;
    migrate(&conn, state_path)?;
    Ok(Db {
        conn,
        generation: 0,
        rows: HashMap::new(),
        transcripts: HashMap::new(),
    })
}

/// One numbered migration: SQL, or code that needs the state file's location.
enum Step {
    Sql(&'static str),
    Code(fn(&Connection, &Path) -> Result<()>),
}

/// Numbered schema versions: each runs once, in order.
fn migrate(conn: &Connection, state_path: &Path) -> Result<()> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);",
    )
    .map_err(sql)?;
    // Each version not yet recorded runs, so one recorded out of order is still applied.
    let applied = {
        let mut statement = conn
            .prepare("SELECT version FROM schema_migrations")
            .map_err(sql)?;
        let versions = statement
            .query_map([], |row| row.get::<_, i64>(0))
            .map_err(sql)?
            .collect::<std::result::Result<HashSet<_>, _>>()
            .map_err(sql)?;
        versions
    };
    let steps: [(i64, Step); 4] = [
        (1, Step::Sql(SCHEMA_V1)),
        (2, Step::Sql(SCHEMA_V2)),
        (3, Step::Code(restore_project_astros)),
        (4, Step::Sql(SCHEMA_V4)),
    ];
    for (version, step) in steps {
        if applied.contains(&version) {
            continue;
        }
        let transaction = conn.unchecked_transaction().map_err(sql)?;
        match step {
            Step::Sql(schema) => transaction.execute_batch(schema).map_err(sql)?,
            Step::Code(run) => run(&transaction, state_path)?,
        }
        transaction
            .execute(
                "INSERT INTO schema_migrations (version, applied_at) VALUES (?1, ?2)",
                params![version, chrono::Utc::now().to_rfc3339()],
            )
            .map_err(sql)?;
        transaction.commit().map_err(sql)?;
    }
    Ok(())
}

/// Version 3 (ADR-116): Astro project icons stayed when Astros were removed, but the version
/// in between dropped `look.astro` whenever it re-saved a project. The untouched JSON backup
/// made before the move into SQLite still has them: a project whose look has no icon of any
/// kind gets back the valid Astro icon its backup copy had. No backup, an unreadable one or
/// an unknown icon changes nothing.
fn restore_project_astros(conn: &Connection, state_path: &Path) -> Result<()> {
    let backed_up = backup_project_astros(state_path);
    if backed_up.is_empty() {
        return Ok(());
    }
    let rows = {
        let mut statement = conn.prepare("SELECT id, json FROM projects").map_err(sql)?;
        let rows = statement
            .query_map([], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
            })
            .map_err(sql)?
            .collect::<std::result::Result<Vec<_>, _>>()
            .map_err(sql)?;
        rows
    };
    for (id, json) in rows {
        let Some(astro) = backed_up.get(&id) else {
            continue;
        };
        let Ok(Value::Object(mut project)) = serde_json::from_str::<Value>(&json) else {
            continue;
        };
        let look = project
            .entry("look")
            .or_insert_with(|| Value::Object(Map::new()));
        if look.is_null() {
            *look = Value::Object(Map::new());
        }
        let Value::Object(look) = look else {
            continue;
        };
        let has_icon = ["astro", "emoji", "logo", "icon"]
            .iter()
            .any(|key| look.get(*key).is_some_and(|value| !value.is_null()));
        if has_icon {
            continue;
        }
        look.insert(
            "astro".into(),
            serde_json::to_value(astro)
                .map_err(|error| Error::new("persist", error.to_string()))?,
        );
        let json = serde_json::to_string(&Value::Object(project))
            .map_err(|error| Error::new("persist", error.to_string()))?;
        conn.execute(
            "UPDATE projects SET json = ?1 WHERE id = ?2",
            params![json, id],
        )
        .map_err(sql)?;
    }
    Ok(())
}

/// Valid Astro icons of the projects in the pre-SQLite backup, by project id.
fn backup_project_astros(state_path: &Path) -> HashMap<String, crate::models::ProjectAstroIcon> {
    let (Some(parent), Some(name)) = (state_path.parent(), state_path.file_name()) else {
        return HashMap::new();
    };
    let backup = parent.join(crate::persist::JSON_BACKUP_DIR).join(name);
    let Ok(text) = std::fs::read_to_string(backup) else {
        return HashMap::new();
    };
    let Ok(state) = serde_json::from_str::<Value>(&text) else {
        return HashMap::new();
    };
    let Some(projects) = state.get("projects").and_then(Value::as_array) else {
        return HashMap::new();
    };
    projects
        .iter()
        .filter_map(|project| {
            let id = project.get("id")?.as_str()?.to_string();
            let astro = project.get("look")?.get("astro")?.clone();
            let astro = serde_json::from_value::<crate::models::ProjectAstroIcon>(astro).ok()?;
            crate::project_look::is_valid_astro(&astro).then_some((id, astro))
        })
        .collect()
}

/// Runs `operation` with the state file's database, opening it on first use.
fn with_db<R>(state_path: &Path, operation: impl FnOnce(&mut Db) -> Result<R>) -> Result<R> {
    let mut all = OPEN.get_or_init(Mutex::default).lock();
    // Production has one state file; disposable test roots stay bounded.
    if !all.contains_key(state_path) && all.len() >= 64 {
        all.clear();
    }
    if !all.contains_key(state_path) {
        let db = connect(state_path)?;
        all.insert(state_path.to_path_buf(), db);
    }
    let db = all
        .get_mut(state_path)
        .ok_or_else(|| Error::new("persist", "database unavailable"))?;
    operation(db)
}

/// Closes and deletes the database (a migration that could not be verified).
pub fn discard(state_path: &Path) {
    if let Some(all) = OPEN.get() {
        all.lock().remove(state_path);
    }
    let path = db_path(state_path);
    for suffix in ["", "-wal", "-shm"] {
        let mut name = path.clone().into_os_string();
        name.push(suffix);
        let _ = std::fs::remove_file(PathBuf::from(name));
    }
}

/// Forgets the open connection and caches, as a new process would (tests).
#[cfg(test)]
pub fn forget(state_path: &Path) {
    if let Some(all) = OPEN.get() {
        all.lock().remove(state_path);
    }
}

/// A raw connection for tests that inspect or damage rows.
#[cfg(test)]
pub fn raw(state_path: &Path) -> Connection {
    Connection::open(db_path(state_path)).unwrap()
}

/// Opens (creating when needed) the database and its schema.
pub fn open(state_path: &Path) -> Result<()> {
    with_db(state_path, |_| Ok(()))
}

/// The index as `state.json` held it: every top-level field, sessions with their counts
/// and without messages. `None` for an empty database.
pub fn read_index(state_path: &Path) -> Result<Option<Value>> {
    with_db(state_path, |db| {
        let mut index = Map::new();
        let settings: Option<String> = db
            .conn
            .query_row("SELECT json FROM settings WHERE id = 1", [], |row| {
                row.get(0)
            })
            .optional()
            .map_err(sql)?;
        let Some(settings) = settings else {
            return Ok(None);
        };
        db.rows
            .insert(("settings".into(), String::new()), hash(&settings));
        index.insert("settings".into(), parse(&settings)?);
        let mut statement = db
            .conn
            .prepare("SELECT key, json FROM app_state")
            .map_err(sql)?;
        let rows = statement
            .query_map([], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
            })
            .map_err(sql)?;
        for row in rows {
            let (key, json) = row.map_err(sql)?;
            db.rows
                .insert(("app_state".into(), key.clone()), hash(&json));
            index.insert(key, parse(&json)?);
        }
        drop(statement);
        for (field, table) in ROW_TABLES {
            let mut statement = db
                .conn
                .prepare(&format!("SELECT id, json FROM {table} ORDER BY position"))
                .map_err(sql)?;
            let rows = statement
                .query_map([], |row| {
                    Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
                })
                .map_err(sql)?;
            let mut items = Vec::new();
            for row in rows {
                let (id, json) = row.map_err(sql)?;
                db.rows.insert((table.into(), id), hash(&json));
                items.push(parse(&json)?);
            }
            index.insert(field.into(), Value::Array(items));
        }
        let mut statement = db
            .conn
            .prepare(
                "SELECT id, json, message_count, transcript_length FROM sessions ORDER BY position",
            )
            .map_err(sql)?;
        let rows = statement
            .query_map([], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, i64>(2)?,
                    row.get::<_, i64>(3)?,
                ))
            })
            .map_err(sql)?;
        let mut sessions = Vec::new();
        for row in rows {
            let (id, json, messages, conversation) = row.map_err(sql)?;
            db.rows.insert(("sessions".into(), id), hash(&json));
            let mut entry = parse(&json)?;
            entry[MESSAGE_COUNT] = messages.into();
            entry[TRANSCRIPT_LENGTH] = conversation.into();
            sessions.push(entry);
        }
        index.insert("sessions".into(), Value::Array(sessions));
        Ok(Some(Value::Object(index)))
    })
}

fn parse(json: &str) -> Result<Value> {
    serde_json::from_str(json)
        .map_err(|error| Error::new("persist", format!("invalid stored JSON: {error}")))
}

/// A session's message rows as JSON strings, in order.
fn message_rows(db: &Db, session_id: &str) -> Result<Vec<(String, String)>> {
    let mut statement = db
        .conn
        .prepare_cached("SELECT id, json FROM messages WHERE session_id = ?1 ORDER BY position")
        .map_err(sql)?;
    let rows = statement
        .query_map([session_id], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })
        .map_err(sql)?;
    rows.collect::<std::result::Result<Vec<_>, _>>()
        .map_err(sql)
}

/// A transcript read to load it: what it read is remembered, so a later save rewrites
/// only messages that changed. A row that no longer parses is skipped and logged.
pub fn read_messages(state_path: &Path, session_id: &str) -> Result<Vec<Message>> {
    with_db(state_path, |db| {
        let rows = message_rows(db, session_id)?;
        let mut messages = Vec::with_capacity(rows.len());
        let mut cached = Vec::with_capacity(rows.len());
        for (id, json) in rows {
            match serde_json::from_str::<Message>(&json) {
                Ok(message) => {
                    cached.push((id, hash(&json)));
                    messages.push(message);
                }
                Err(error) => tracing::error!(%error, "a stored message could not be read"),
            }
        }
        db.transcripts.insert(
            session_id.to_owned(),
            Transcript {
                revision: None,
                rows: cached,
            },
        );
        Ok(messages)
    })
}

/// A scan's read: nothing is remembered. `None` when the database cannot be read.
pub fn read_messages_only(state_path: &Path, session_id: &str) -> Option<Vec<Message>> {
    with_db(state_path, |db| {
        Ok(message_rows(db, session_id)?
            .into_iter()
            .filter_map(|(_, json)| serde_json::from_str(&json).ok())
            .collect())
    })
    .ok()
}

/// The transcript as the JSON file held it, for literal scans.
pub fn read_raw(state_path: &Path, session_id: &str) -> Option<Vec<u8>> {
    with_db(state_path, |db| {
        let rows = message_rows(db, session_id)?;
        let mut bytes =
            Vec::with_capacity(rows.iter().map(|(_, json)| json.len() + 1).sum::<usize>() + 64);
        bytes.extend_from_slice(b"{\"sessionId\":");
        bytes.extend_from_slice(serde_json::to_string(session_id)?.as_bytes());
        bytes.extend_from_slice(b",\"messages\":[");
        for (index, (_, json)) in rows.iter().enumerate() {
            if index > 0 {
                bytes.push(b',');
            }
            bytes.extend_from_slice(json.as_bytes());
        }
        bytes.extend_from_slice(b"]}");
        Ok(bytes)
    })
    .ok()
}

/// A transcript just read is what the rows hold at `revision`.
pub fn mark_saved(state_path: &Path, session_id: &str, revision: u64) {
    let _ = with_db(state_path, |db| {
        db.transcripts
            .entry(session_id.to_owned())
            .or_default()
            .revision = Some(revision);
        Ok(())
    });
}

/// The revision each session's rows hold, when known.
pub fn revisions(state_path: &Path, sessions: &[&str]) -> Vec<Option<u64>> {
    with_db(state_path, |db| {
        Ok(sessions
            .iter()
            .map(|id| {
                db.transcripts
                    .get(*id)
                    .and_then(|transcript| transcript.revision)
            })
            .collect())
    })
    .unwrap_or_else(|_| vec![None; sessions.len()])
}

/// Whether each `(session id, revision)` is what the rows hold.
pub fn saved(state_path: &Path, sessions: &[(&str, u64)]) -> Vec<bool> {
    with_db(state_path, |db| {
        Ok(sessions
            .iter()
            .map(|(id, revision)| {
                db.transcripts
                    .get(*id)
                    .is_some_and(|transcript| transcript.revision == Some(*revision))
            })
            .collect())
    })
    .unwrap_or_else(|_| vec![false; sessions.len()])
}

/// One loaded transcript to write.
pub struct TranscriptWrite<'a> {
    pub session_id: &'a str,
    pub revision: u64,
    /// The messages from position `offset` on.
    pub messages: &'a [Message],
    pub offset: usize,
    /// With an offset: the revision whose rows before it are kept (ADR-099).
    pub base: Option<u64>,
}

impl<'a> TranscriptWrite<'a> {
    /// The whole transcript.
    pub fn full(session_id: &'a str, revision: u64, messages: &'a [Message]) -> Self {
        Self {
            session_id,
            revision,
            messages,
            offset: 0,
            base: None,
        }
    }
}

/// Writes a snapshot in one transaction: the index rows that changed, the named
/// transcripts' changed messages, and deletions of what the index no longer lists.
/// A snapshot older than the last one written is dropped. Returns whether it wrote.
pub fn write(
    state_path: &Path,
    generation: u64,
    index: &Value,
    transcripts: &[TranscriptWrite<'_>],
) -> Result<bool> {
    write_with(state_path, generation, index, false, transcripts).map(|outcome| outcome.wrote)
}

/// A streaming checkpoint: `index` holds the sessions and the small app-state fields
/// only (settings and item tables are left as they are), and transcripts may be tails.
/// Returns the sessions whose tail no longer fits the rows (another write landed in
/// between); they need a full checkpoint.
pub fn write_checkpoint(
    state_path: &Path,
    generation: u64,
    index: &Value,
    transcripts: &[TranscriptWrite<'_>],
) -> Result<Vec<String>> {
    write_with(state_path, generation, index, true, transcripts).map(|outcome| outcome.stale)
}

struct Outcome {
    wrote: bool,
    stale: Vec<String>,
}

/// A transcript's cached rows after a write: replaced, or kept up to `offset` and
/// followed by the new tail.
enum Update {
    Replace(Transcript),
    Tail {
        revision: u64,
        offset: usize,
        rows: Vec<(String, u64)>,
    },
}

fn write_with(
    state_path: &Path,
    generation: u64,
    index: &Value,
    partial: bool,
    transcripts: &[TranscriptWrite<'_>],
) -> Result<Outcome> {
    // Encoding happens before the lock: only hashing and SQL run under it.
    let encoded = encode_transcripts(transcripts)?;
    with_db(state_path, |db| {
        if db.generation > generation {
            return Ok(Outcome {
                wrote: false,
                stale: Vec::new(),
            });
        }
        let Db {
            conn,
            rows,
            transcripts: cached,
            ..
        } = db;
        let tx = conn.transaction().map_err(sql)?;
        // The index rows are few (no messages); transcript rows change in place
        // after the commit, so a long transcript is never copied.
        let mut new_rows = rows.clone();
        let removed = write_index(&tx, &mut new_rows, index, partial)?;
        let unknown = Transcript::default();
        let mut updates = Vec::new();
        let mut stale = Vec::new();
        for (write, messages) in transcripts.iter().zip(&encoded) {
            let session_id = write.session_id;
            let previous = cached
                .get(session_id)
                .filter(|_| !removed.iter().any(|id| id == session_id))
                .unwrap_or(&unknown);
            if previous.revision == Some(write.revision) {
                continue;
            }
            if write.offset > 0 {
                // A tail is relative to the rows of `base`.
                if write.base.is_none()
                    || previous.revision != write.base
                    || previous.rows.len() < write.offset
                {
                    stale.push(session_id.to_owned());
                    continue;
                }
            }
            let next = write_messages(&tx, session_id, previous, write.offset, messages)?;
            updates.push((
                session_id,
                if write.offset == 0 {
                    Update::Replace(Transcript {
                        revision: Some(write.revision),
                        rows: next,
                    })
                } else {
                    Update::Tail {
                        revision: write.revision,
                        offset: write.offset,
                        rows: next,
                    }
                },
            ));
        }
        tx.commit().map_err(sql)?;
        *rows = new_rows;
        for id in &removed {
            cached.remove(id);
        }
        for (session_id, update) in updates {
            match update {
                Update::Replace(transcript) => {
                    cached.insert(session_id.to_owned(), transcript);
                }
                Update::Tail {
                    revision,
                    offset,
                    rows,
                } => {
                    let transcript = cached.entry(session_id.to_owned()).or_default();
                    transcript.rows.truncate(offset);
                    transcript.rows.extend(rows);
                    transcript.revision = Some(revision);
                }
            }
        }
        db.generation = generation;
        Ok(Outcome { wrote: true, stale })
    })
}

/// Each transcript's messages as `(id, JSON)`, in order.
fn encode_transcripts(transcripts: &[TranscriptWrite<'_>]) -> Result<Vec<Vec<(String, String)>>> {
    transcripts
        .iter()
        .map(|write| {
            // The live thought (ADR-101) stays out of storage.
            let rows = crate::activity::persisting(|| {
                write
                    .messages
                    .iter()
                    .map(|message| Ok((message.id.clone(), serde_json::to_string(message)?)))
                    .collect::<std::result::Result<Vec<_>, serde_json::Error>>()
            })?;
            Ok(rows)
        })
        .collect()
}

/// Marks a row as present; true when its stored JSON differs (it must be written).
fn changed(
    rows: &HashMap<(String, String), u64>,
    seen: &mut HashSet<(String, String)>,
    slot: &(String, String),
    digest: u64,
) -> bool {
    seen.insert(slot.clone());
    rows.get(slot) != Some(&digest)
}

/// Upserts rows whose JSON changed and deletes rows that are gone, table by table.
/// A `partial` index (a checkpoint's) lists every session but not every field: only
/// sessions it no longer lists are deleted. Returns the sessions removed (their
/// messages go with them).
fn write_index(
    tx: &rusqlite::Transaction<'_>,
    rows: &mut HashMap<(String, String), u64>,
    index: &Value,
    partial: bool,
) -> Result<Vec<String>> {
    let object = index
        .as_object()
        .ok_or_else(|| Error::new("persist", "the state is not an object"))?;
    let mut seen: HashSet<(String, String)> = HashSet::new();
    for (key, value) in object {
        match key.as_str() {
            "settings" => {
                let json = serde_json::to_string(value)?;
                let slot = ("settings".to_owned(), String::new());
                let digest = hash(&json);
                if changed(rows, &mut seen, &slot, digest) {
                    tx.execute(
                        "INSERT INTO settings (id, json) VALUES (1, ?1) ON CONFLICT(id) DO UPDATE SET json = excluded.json",
                        [&json],
                    )
                    .map_err(sql)?;
                    rows.insert(slot, digest);
                }
            }
            "sessions" => {
                for (position, entry) in value.as_array().into_iter().flatten().enumerate() {
                    let Some(id) = entry.get("id").and_then(Value::as_str) else {
                        continue;
                    };
                    let mut entry = entry.clone();
                    let mut count = |key: &str| {
                        entry
                            .as_object_mut()
                            .and_then(|object| object.remove(key))
                            .and_then(|value| value.as_i64())
                            .unwrap_or(0)
                    };
                    let messages = count(MESSAGE_COUNT);
                    let conversation = count(TRANSCRIPT_LENGTH);
                    let json = serde_json::to_string(&entry)?;
                    // Position and counts are part of what the row holds.
                    let digest = hash(&format!("{position}:{messages}:{conversation}:{json}"));
                    let slot = ("sessions".to_owned(), id.to_owned());
                    if changed(rows, &mut seen, &slot, digest) {
                        tx.execute(
                            "INSERT INTO sessions (id, position, json, message_count, transcript_length) VALUES (?1, ?2, ?3, ?4, ?5)
                             ON CONFLICT(id) DO UPDATE SET position = excluded.position, json = excluded.json,
                               message_count = excluded.message_count, transcript_length = excluded.transcript_length",
                            params![id, position as i64, json, messages, conversation],
                        )
                        .map_err(sql)?;
                        rows.insert(slot, digest);
                    }
                }
            }
            field => {
                let table = ROW_TABLES
                    .iter()
                    .find(|(name, _)| *name == field)
                    .map(|(_, table)| *table);
                let items = value.as_array().filter(|items| {
                    items
                        .iter()
                        .all(|item| item.get("id").and_then(Value::as_str).is_some())
                });
                if let (Some(table), Some(items)) = (table, items) {
                    for (position, item) in items.iter().enumerate() {
                        let id = item["id"].as_str().unwrap_or_default();
                        let json = serde_json::to_string(item)?;
                        let digest = hash(&format!("{position}:{json}"));
                        let slot = (table.to_owned(), id.to_owned());
                        if changed(rows, &mut seen, &slot, digest) {
                            tx.execute(
                                &format!(
                                    "INSERT INTO {table} (id, position, json) VALUES (?1, ?2, ?3)
                                     ON CONFLICT(id) DO UPDATE SET position = excluded.position, json = excluded.json"
                                ),
                                params![id, position as i64, json],
                            )
                            .map_err(sql)?;
                            rows.insert(slot, digest);
                        }
                    }
                } else {
                    let json = serde_json::to_string(value)?;
                    let digest = hash(&json);
                    let slot = ("app_state".to_owned(), field.to_owned());
                    if changed(rows, &mut seen, &slot, digest) {
                        tx.execute(
                            "INSERT INTO app_state (key, json) VALUES (?1, ?2) ON CONFLICT(key) DO UPDATE SET json = excluded.json",
                            params![field, json],
                        )
                        .map_err(sql)?;
                        rows.insert(slot, digest);
                    }
                }
            }
        }
    }
    // Rows the index no longer has.
    let gone: Vec<(String, String)> = rows
        .keys()
        .filter(|slot| !seen.contains(*slot) && (!partial || slot.0 == "sessions"))
        .cloned()
        .collect();
    let mut removed = Vec::new();
    for (table, key) in gone {
        match table.as_str() {
            "settings" => continue,
            "app_state" => {
                tx.execute("DELETE FROM app_state WHERE key = ?1", [&key])
                    .map_err(sql)?;
            }
            "sessions" => {
                tx.execute("DELETE FROM sessions WHERE id = ?1", [&key])
                    .map_err(sql)?;
                tx.execute("DELETE FROM messages WHERE session_id = ?1", [&key])
                    .map_err(sql)?;
                removed.push(key.clone());
            }
            known if ROW_TABLES.iter().any(|(_, table)| *table == known) => {
                tx.execute(&format!("DELETE FROM {known} WHERE id = ?1"), [&key])
                    .map_err(sql)?;
            }
            _ => {}
        }
        rows.remove(&(table, key));
    }
    Ok(removed)
}

/// Writes one transcript's changed messages from position `offset` on (the rows
/// before it are kept): rows whose id or JSON differ at their position are replaced,
/// rows past the new length are deleted. Returns the rows from `offset` on.
fn write_messages(
    tx: &rusqlite::Transaction<'_>,
    session_id: &str,
    previous: &Transcript,
    offset: usize,
    messages: &[(String, String)],
) -> Result<Vec<(String, u64)>> {
    // Unknown rows (never read in this process): replace the whole transcript. A
    // tail is only written over known rows.
    let known = previous.revision.is_some() || !previous.rows.is_empty();
    if !known && offset == 0 {
        tx.execute("DELETE FROM messages WHERE session_id = ?1", [session_id])
            .map_err(sql)?;
    }
    let mut next = Vec::with_capacity(messages.len());
    {
        let mut upsert = tx
            .prepare_cached(
                "INSERT INTO messages (session_id, position, id, json) VALUES (?1, ?2, ?3, ?4)
                 ON CONFLICT(session_id, position) DO UPDATE SET id = excluded.id, json = excluded.json",
            )
            .map_err(sql)?;
        for (position, (id, json)) in (offset..).zip(messages) {
            let digest = hash(json);
            let same = known
                && previous
                    .rows
                    .get(position)
                    .is_some_and(|(old_id, old)| old_id == id && *old == digest);
            if !same {
                upsert
                    .execute(params![session_id, position as i64, id, json])
                    .map_err(sql)?;
            }
            next.push((id.clone(), digest));
        }
    }
    let end = offset + messages.len();
    if known && previous.rows.len() > end {
        tx.execute(
            "DELETE FROM messages WHERE session_id = ?1 AND position >= ?2",
            params![session_id, end as i64],
        )
        .map_err(sql)?;
    }
    Ok(next)
}

/// Message rows written per session, for tests.
#[cfg(test)]
pub fn message_count(state_path: &Path, session_id: &str) -> Result<usize> {
    with_db(state_path, |db| {
        db.conn
            .query_row(
                "SELECT COUNT(*) FROM messages WHERE session_id = ?1",
                [session_id],
                |row| row.get::<_, i64>(0),
            )
            .map(|count| count as usize)
            .map_err(sql)
    })
}
