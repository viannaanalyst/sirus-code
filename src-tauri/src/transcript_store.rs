//! Native transcripts on demand (ADR-099). `Session::messages` is a [`Messages`]:
//! either loaded (in memory) or unloaded (only its counts stay; the content is
//! `sessions/<id>.json`). Active, unsaved and recently used transcripts stay
//! loaded; the others are read when a path needs them and released by [`evict`].
//!
//! Paths that need a transcript lock the state through [`lock_loaded`], which reads
//! missing ones outside the lock. Any other access still works: an unloaded
//! transcript is read on first access (under whatever lock the caller holds), so a
//! path that forgot to ask first is slower, never wrong. Scans over many sessions
//! (search, thumbnails, documents) read files one at a time without the lock and
//! never keep what they read.

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, OnceLock};

use parking_lot::{Mutex, MutexGuard};
use serde::{Deserialize, Deserializer, Serialize, Serializer};

use crate::models::{AppData, Message, MessageRole, Session};

/// Recently used transcripts kept loaded besides active and unsaved ones.
pub const KEEP_RECENT: usize = 6;

static REVISION: AtomicU64 = AtomicU64::new(1);
static CLOCK: AtomicU64 = AtomicU64::new(1);

/// Every change to a loaded transcript gets a new, process-unique revision; a
/// transcript is unsaved while its revision differs from the one last written.
pub fn next_revision() -> u64 {
    REVISION.fetch_add(1, Ordering::Relaxed)
}

/// What the index knows about a transcript without reading it.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct Counts {
    /// Every message, system notes included.
    pub messages: usize,
    /// User and assistant messages: what views treat as a started conversation.
    pub conversation: usize,
}

impl Counts {
    pub fn of(messages: &[Message]) -> Self {
        Self {
            messages: messages.len(),
            conversation: messages
                .iter()
                .filter(|message| message.role != MessageRole::System)
                .count(),
        }
    }
}

/// Where an unloaded transcript is read from.
#[derive(Debug)]
pub struct Origin {
    pub state_path: PathBuf,
    pub session_id: String,
}

impl Origin {
    pub fn new(state_path: &Path, session_id: &str) -> Arc<Self> {
        Arc::new(Self {
            state_path: state_path.to_path_buf(),
            session_id: session_id.to_owned(),
        })
    }
}

/// A session's messages, loaded or not. Reads and writes go through `Deref`, so
/// existing code keeps using it as a `Vec<Message>`; every mutable access marks it
/// unsaved. Persistence writes only loaded, unsaved transcripts, so an unloaded
/// (or unreadable) one never replaces its file.
pub struct Messages {
    /// Set when loaded. A `OnceLock` so a shared reference can read on access.
    list: OnceLock<Vec<Message>>,
    /// Set once the transcript was unloaded: where to read it from again.
    origin: Option<Arc<Origin>>,
    /// Counts while unloaded (and of the file when a read failed).
    stored: Counts,
    revision: u64,
    /// Last load or explicit use, for least-recently-used eviction.
    used: AtomicU64,
    /// A read on access failed: the empty content is never written.
    failed: AtomicBool,
}

impl Messages {
    pub fn is_loaded(&self) -> bool {
        self.list.get().is_some()
    }

    /// The loaded, writable content; `None` while unloaded or after a failed read.
    pub fn loaded(&self) -> Option<&[Message]> {
        self.list
            .get()
            .filter(|_| !self.failed.load(Ordering::Acquire))
            .map(Vec::as_slice)
    }

    pub fn failed(&self) -> bool {
        self.failed.load(Ordering::Acquire)
    }

    pub fn counts(&self) -> Counts {
        match self.loaded() {
            Some(list) => Counts::of(list),
            None => self.stored,
        }
    }

    /// Message count without reading an unloaded transcript.
    pub fn len(&self) -> usize {
        match self.list.get() {
            Some(list) => list.len(),
            None => self.stored.messages,
        }
    }

    pub fn is_empty(&self) -> bool {
        self.len() == 0
    }

    /// User and assistant messages, without reading an unloaded transcript.
    pub fn conversation_len(&self) -> usize {
        self.counts().conversation
    }

    pub fn revision(&self) -> u64 {
        self.revision
    }

    pub fn origin(&self) -> Option<&Arc<Origin>> {
        self.origin.as_ref()
    }

    pub fn touch(&self) {
        self.used
            .store(CLOCK.fetch_add(1, Ordering::Relaxed), Ordering::Relaxed);
    }

    /// Content read from disk becomes the loaded transcript (a new revision).
    pub fn install(&mut self, list: Vec<Message>) {
        self.list = OnceLock::from(list);
        self.failed.store(false, Ordering::Release);
        self.revision = next_revision();
    }

    /// Releases the content; only its counts stay. Callers check it is saved.
    pub fn unload(&mut self, origin: Arc<Origin>) {
        let counts = self.counts();
        self.set_unloaded(origin, counts);
    }

    /// Marks the transcript as on disk only, with the counts the index recorded.
    pub fn set_unloaded(&mut self, origin: Arc<Origin>, counts: Counts) {
        self.list = OnceLock::new();
        self.origin = Some(origin);
        self.stored = counts;
        self.failed.store(false, Ordering::Release);
        // A later read is compared with what was written under a new revision.
        self.revision = next_revision();
    }

    /// What a scan needs without the state lock: a copy of loaded content, or
    /// where to read it. Unloaded content is read later, outside the lock.
    pub fn snapshot(&self) -> Snapshot {
        match (self.loaded(), &self.origin) {
            (Some(list), _) => Snapshot::Loaded(list.to_vec()),
            (None, Some(origin)) if !self.is_loaded() => Snapshot::Unloaded(origin.clone()),
            _ => Snapshot::Unavailable,
        }
    }

    fn read_on_access(&self) -> Vec<Message> {
        let Some(origin) = &self.origin else {
            return Vec::new();
        };
        self.touch();
        tracing::debug!("a session transcript was read on access");
        match crate::persist::read_origin(origin) {
            Ok(read) => read.messages,
            Err(error) => {
                self.failed.store(true, Ordering::Release);
                tracing::error!(%error, "cannot read a session transcript; it is not saved until it loads");
                Vec::new()
            }
        }
    }
}

/// A transcript as a scan sees it.
pub enum Snapshot {
    Loaded(Vec<Message>),
    Unloaded(Arc<Origin>),
    Unavailable,
}

impl Snapshot {
    /// The messages, reading an unloaded transcript without changing anything on
    /// disk. `None` when it cannot be read.
    pub fn read(self) -> Option<Vec<Message>> {
        match self {
            Snapshot::Loaded(list) => Some(list),
            Snapshot::Unloaded(origin) => crate::persist::read_only(&origin),
            Snapshot::Unavailable => None,
        }
    }
}

impl From<Vec<Message>> for Messages {
    fn from(list: Vec<Message>) -> Self {
        Self {
            list: OnceLock::from(list),
            origin: None,
            stored: Counts::default(),
            revision: next_revision(),
            used: AtomicU64::new(0),
            failed: AtomicBool::new(false),
        }
    }
}

impl Default for Messages {
    fn default() -> Self {
        Self::from(Vec::new())
    }
}

impl Clone for Messages {
    fn clone(&self) -> Self {
        let list = OnceLock::new();
        if let Some(loaded) = self.list.get() {
            let _ = list.set(loaded.clone());
        }
        Self {
            list,
            origin: self.origin.clone(),
            stored: self.stored,
            revision: self.revision,
            used: AtomicU64::new(self.used.load(Ordering::Relaxed)),
            failed: AtomicBool::new(self.failed()),
        }
    }
}

impl std::fmt::Debug for Messages {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self.list.get() {
            Some(list) => list.fmt(f),
            None => f
                .debug_struct("Unloaded")
                .field("messages", &self.stored.messages)
                .finish(),
        }
    }
}

impl std::ops::Deref for Messages {
    type Target = Vec<Message>;
    fn deref(&self) -> &Vec<Message> {
        self.list.get_or_init(|| self.read_on_access())
    }
}

impl std::ops::DerefMut for Messages {
    fn deref_mut(&mut self) -> &mut Vec<Message> {
        if self.list.get().is_none() {
            let list = self.read_on_access();
            self.list = OnceLock::from(list);
        }
        self.revision = next_revision();
        self.list.get_mut().expect("the transcript was just loaded")
    }
}

impl<'a> IntoIterator for &'a Messages {
    type Item = &'a Message;
    type IntoIter = std::slice::Iter<'a, Message>;
    fn into_iter(self) -> Self::IntoIter {
        std::ops::Deref::deref(self).iter()
    }
}

impl<'a> IntoIterator for &'a mut Messages {
    type Item = &'a mut Message;
    type IntoIter = std::slice::IterMut<'a, Message>;
    fn into_iter(self) -> Self::IntoIter {
        std::ops::DerefMut::deref_mut(self).iter_mut()
    }
}

impl Serialize for Messages {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        std::ops::Deref::deref(self).serialize(serializer)
    }
}

impl<'de> Deserialize<'de> for Messages {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        Vec::<Message>::deserialize(deserializer).map(Self::from)
    }
}

/// Locks the state with the named sessions' transcripts loaded. Missing ones are
/// read before taking the lock, so a long transcript never blocks other work.
pub fn lock_loaded<'a>(
    data: &'a Mutex<AppData>,
    state_path: &Path,
    ids: &[&str],
) -> MutexGuard<'a, AppData> {
    let mut guard = data.lock();
    let mut wanted = Vec::new();
    for session in guard
        .sessions
        .iter_mut()
        .filter(|session| ids.contains(&session.id.as_str()))
    {
        session.messages.touch();
        if let (false, Some(origin)) = (session.messages.is_loaded(), session.messages.origin()) {
            wanted.push((
                session.id.clone(),
                origin.clone(),
                session.messages.revision(),
            ));
        }
    }
    if wanted.is_empty() {
        return guard;
    }
    drop(guard);
    let reads = wanted
        .into_iter()
        .map(|(id, origin, revision)| (id, revision, crate::persist::read_origin(&origin)))
        .collect::<Vec<_>>();
    let mut guard = data.lock();
    for (id, revision, read) in reads {
        let Some(session) = guard.sessions.iter_mut().find(|session| session.id == id) else {
            continue;
        };
        // Loaded (or released and replaced) meanwhile: what is in memory wins.
        if session.messages.is_loaded() || session.messages.revision() != revision {
            continue;
        }
        match read {
            Ok(read) => install(state_path, session, read),
            Err(error) => tracing::error!(%error, "cannot read a session transcript"),
        }
    }
    evict(&mut guard, state_path, ids);
    guard
}

/// Installs a transcript read from disk and recovers it like a startup load did.
pub(crate) fn install(state_path: &Path, session: &mut Session, read: crate::persist::Read) {
    session.messages.install(read.messages);
    if !session.status.is_active() {
        crate::activity::recover(session);
    }
    if !read.changed {
        crate::persist::mark_saved(
            state_path,
            &session.id,
            session.messages.revision(),
            read.hash,
        );
    }
}

/// Releases loaded transcripts beyond the [`KEEP_RECENT`] most recently used. Never
/// releases active or streaming sessions, unsaved changes or `keep`. Returns how many.
pub fn evict(data: &mut AppData, state_path: &Path, keep: &[&str]) -> usize {
    evict_to(data, state_path, keep, KEEP_RECENT)
}

pub fn evict_to(data: &mut AppData, state_path: &Path, keep: &[&str], recent: usize) -> usize {
    let mut candidates = data
        .sessions
        .iter()
        .enumerate()
        .filter(|(_, session)| {
            session.messages.is_loaded()
                && !session.status.is_active()
                && session.pending_requests.is_empty()
                && !keep.contains(&session.id.as_str())
                && !session
                    .messages
                    .loaded()
                    .is_some_and(|list| list.iter().any(|message| message.streaming))
        })
        .map(|(index, session)| (index, session.messages.used.load(Ordering::Relaxed)))
        .collect::<Vec<_>>();
    if candidates.len() <= recent {
        return 0;
    }
    // The most recently used stay; older ones go once their changes are on disk.
    candidates.sort_by_key(|candidate| std::cmp::Reverse(candidate.1));
    let older = candidates.split_off(recent);
    let saved = crate::persist::saved(
        state_path,
        &older
            .iter()
            .map(|(index, _)| {
                let session = &data.sessions[*index];
                (session.id.as_str(), session.messages.revision())
            })
            .collect::<Vec<_>>(),
    );
    let releasable = older
        .into_iter()
        .zip(saved)
        .filter(|((index, _), saved)| *saved || data.sessions[*index].messages.failed())
        .map(|((index, _), _)| index)
        .collect::<Vec<_>>();
    let mut released = 0;
    for index in releasable {
        let session = &mut data.sessions[index];
        let origin = Origin::new(state_path, &session.id);
        session.messages.unload(origin);
        released += 1;
    }
    released
}

/// Sessions whose transcript mentions `needle` (a literal substring of the file or
/// of the loaded content). Unloaded files are read without the lock, one at a time.
pub fn sessions_mentioning(data: &Mutex<AppData>, needle: &str) -> Vec<String> {
    let snapshots = {
        let data = data.lock();
        data.sessions
            .iter()
            .map(|session| {
                let found = session.messages.loaded().map(|list| mentions(list, needle));
                (
                    session.id.clone(),
                    found,
                    session.messages.origin().cloned(),
                )
            })
            .collect::<Vec<_>>()
    };
    snapshots
        .into_iter()
        .filter(|(_, found, origin)| match (found, origin) {
            (Some(found), _) => *found,
            (None, Some(origin)) => crate::persist::read_raw(origin)
                .is_some_and(|bytes| contains(&bytes, needle.as_bytes())),
            (None, None) => false,
        })
        .map(|(id, _, _)| id)
        .collect()
}

fn mentions(list: &[Message], needle: &str) -> bool {
    serde_json::to_vec(list).is_ok_and(|bytes| contains(&bytes, needle.as_bytes()))
}

/// Literal byte search (no allocation per window).
pub fn contains(haystack: &[u8], needle: &[u8]) -> bool {
    needle.is_empty()
        || haystack
            .windows(needle.len())
            .any(|window| window == needle)
}
