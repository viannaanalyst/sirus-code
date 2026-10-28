//! Frame-aligned batching of `agent-output` events (ADR-180).
//!
//! A provider can stream a token at a time. Each event costs a serialization, an IPC hop
//! and a store update, so deltas of one stream coalesce per session: the first event after
//! idle goes out immediately, a burst waits for the rest of a 16 ms window and leaves as
//! one event, and a batch leaves at once when it reaches 1 MiB. Anything else that must
//! stay ordered with the text (a session update carrying an approval, a question or a
//! status change, the exit event) calls [`flush`] first, so it is never delayed and never
//! overtakes output. The core ([`Batcher`]) takes the clock as an argument and is unit
//! tested.
use crate::models::AgentEvent;
use crate::runtime::{async_runtime, AppHandle, Emitter};
use parking_lot::Mutex;
use std::collections::HashMap;
use std::sync::LazyLock;
use std::time::{Duration, Instant};

/// One animation frame at 60 Hz.
pub const WINDOW: Duration = Duration::from_millis(16);
/// A batch that reaches this size leaves at once.
pub const MAX_BATCH_BYTES: usize = 1024 * 1024;

#[derive(Default)]
struct Stream {
    /// When the last event left; `None` while the stream is idle.
    last_sent: Option<Instant>,
    pending: Option<AgentEvent>,
}

/// What a push asks the caller to do.
#[derive(Debug, Default)]
pub struct Push {
    /// Events to send now, in order.
    pub send: Vec<AgentEvent>,
    /// Wait this long, then call [`Batcher::due`]; set when a batch started waiting.
    pub wake_in: Option<Duration>,
}

#[derive(Default)]
pub struct Batcher {
    streams: HashMap<String, Stream>,
}

/// UTF-16 length, the unit of `AgentEvent::offset`.
fn units(text: &str) -> usize {
    text.encode_utf16().count()
}

/// Appends `next` to `batch` when it continues the same message and stream; otherwise
/// hands it back.
fn merge(batch: &mut AgentEvent, next: AgentEvent) -> Option<AgentEvent> {
    let contiguous = batch.message_id == next.message_id
        && batch.stream == next.stream
        && next.message.is_none()
        && batch.offset + units(&batch.chunk) == next.offset;
    if !contiguous {
        return Some(next);
    }
    if let Some(message) = batch.message.as_mut() {
        message.content.push_str(&next.chunk);
    }
    batch.chunk.push_str(&next.chunk);
    None
}

impl Batcher {
    pub fn push(&mut self, now: Instant, event: AgentEvent) -> Push {
        let stream = self.streams.entry(event.session_id.clone()).or_default();
        let mut out = Push::default();
        let idle = stream
            .last_sent
            .is_none_or(|sent| now.saturating_duration_since(sent) >= WINDOW);
        match stream.pending.as_mut() {
            None if idle => {
                stream.last_sent = Some(now);
                out.send.push(event);
                return out;
            }
            None => {
                let sent = stream.last_sent.unwrap_or(now);
                out.wake_in = Some(WINDOW.saturating_sub(now.saturating_duration_since(sent)));
                stream.pending = Some(event);
            }
            Some(batch) => {
                if let Some(next) = merge(batch, event) {
                    // Not a continuation: keep order, the old batch leaves first.
                    out.send.extend(stream.pending.replace(next));
                    stream.last_sent = Some(now);
                    out.wake_in = Some(WINDOW);
                }
            }
        }
        if stream
            .pending
            .as_ref()
            .is_some_and(|batch| batch.chunk.len() >= MAX_BATCH_BYTES)
        {
            out.send.extend(stream.pending.take());
            stream.last_sent = Some(now);
        }
        out
    }

    /// The window of a waiting batch ended.
    pub fn due(&mut self, now: Instant, session_id: &str) -> Option<AgentEvent> {
        let stream = self.streams.get_mut(session_id)?;
        let batch = stream.pending.take()?;
        stream.last_sent = Some(now);
        Some(batch)
    }

    /// Takes the waiting batch of a session (a priority event or the end of the turn).
    /// The stream counts as idle afterwards: the next output goes out immediately.
    pub fn flush(&mut self, session_id: &str) -> Option<AgentEvent> {
        let stream = self.streams.get_mut(session_id)?;
        let batch = stream.pending.take();
        stream.last_sent = None;
        batch
    }

    /// Forgets a finished session once nothing waits for it.
    pub fn forget(&mut self, session_id: &str) {
        if self
            .streams
            .get(session_id)
            .is_some_and(|stream| stream.pending.is_none())
        {
            self.streams.remove(session_id);
        }
    }
}

static BATCHER: LazyLock<Mutex<Batcher>> = LazyLock::new(Default::default);

/// Sends output now or within one frame, in order.
pub fn emit(app: &AppHandle, event: AgentEvent) {
    let session_id = event.session_id.clone();
    // The lock stays held while sending: concurrent callers cannot reorder events.
    let mut batcher = BATCHER.lock();
    let push = batcher.push(Instant::now(), event);
    for event in push.send {
        let _ = app.emit("agent-output", event);
    }
    drop(batcher);
    if let Some(wait) = push.wake_in {
        let app = app.clone();
        async_runtime::spawn(async move {
            tokio::time::sleep(wait).await;
            let mut batcher = BATCHER.lock();
            if let Some(event) = batcher.due(Instant::now(), &session_id) {
                let _ = app.emit("agent-output", event);
            }
        });
    }
}

/// Sends what waits for `session_id`. Call it before any event that must not overtake
/// output, and when a turn ends.
pub fn flush(app: &AppHandle, session_id: &str) {
    let mut batcher = BATCHER.lock();
    if let Some(event) = batcher.flush(session_id) {
        let _ = app.emit("agent-output", event);
    }
}

/// Flushes and forgets a session whose turn ended.
pub fn finish(app: &AppHandle, session_id: &str) {
    flush(app, session_id);
    BATCHER.lock().forget(session_id);
}

#[cfg(test)]
mod tests {
    use super::*;

    fn event(session: &str, message: &str, offset: usize, chunk: &str) -> AgentEvent {
        AgentEvent {
            session_id: session.into(),
            message_id: message.into(),
            offset,
            message: None,
            stream: "stdout".into(),
            chunk: chunk.into(),
        }
    }

    fn ms(n: u64) -> Duration {
        Duration::from_millis(n)
    }

    #[test]
    fn the_first_event_after_idle_goes_out_immediately() {
        let mut batcher = Batcher::default();
        let push = batcher.push(Instant::now(), event("s", "m", 0, "a"));
        assert_eq!(push.send.len(), 1);
        assert!(push.wake_in.is_none());
    }

    #[test]
    fn a_burst_coalesces_into_one_event_at_the_end_of_the_window() {
        let mut batcher = Batcher::default();
        let t0 = Instant::now();
        batcher.push(t0, event("s", "m", 0, "a"));
        let second = batcher.push(t0 + ms(2), event("s", "m", 1, "b"));
        assert!(second.send.is_empty());
        assert_eq!(second.wake_in, Some(ms(14)));
        let third = batcher.push(t0 + ms(5), event("s", "m", 2, "cé"));
        assert!(third.send.is_empty() && third.wake_in.is_none());
        let batch = batcher.due(t0 + WINDOW, "s").expect("a waiting batch");
        assert_eq!((batch.offset, batch.chunk.as_str()), (1, "bcé"));
        // The window restarted: the next event waits; after a quiet window it goes out at once.
        let next = batcher.push(t0 + ms(20), event("s", "m", 4, "d"));
        assert!(next.send.is_empty());
        batcher.due(t0 + ms(32), "s");
        let idle = batcher.push(t0 + ms(200), event("s", "m", 5, "e"));
        assert_eq!(idle.send.len(), 1);
    }

    #[test]
    fn a_batch_keeps_the_first_message_snapshot_and_extends_it() {
        let mut batcher = Batcher::default();
        let t0 = Instant::now();
        batcher.push(t0, event("s", "old", 0, "x"));
        let mut first = event("s", "m", 0, "a");
        first.message = Some(
            serde_json::from_value(serde_json::json!({
                "id": "m", "sessionId": "s", "role": "agent", "content": "a",
                "createdAt": "now", "streaming": true
            }))
            .expect("a message"),
        );
        assert!(batcher.push(t0 + ms(1), first).send.is_empty());
        batcher.push(t0 + ms(2), event("s", "m", 1, "b"));
        let batch = batcher.flush("s").expect("a waiting batch");
        assert_eq!(batch.chunk, "ab");
        assert_eq!(batch.message.expect("snapshot").content, "ab");
    }

    #[test]
    fn a_flush_sends_the_waiting_batch_and_the_stream_is_idle_again() {
        let mut batcher = Batcher::default();
        let t0 = Instant::now();
        batcher.push(t0, event("s", "m", 0, "a"));
        batcher.push(t0 + ms(1), event("s", "m", 1, "b"));
        assert_eq!(batcher.flush("s").expect("batch").chunk, "b");
        assert!(batcher.flush("s").is_none());
        let push = batcher.push(t0 + ms(2), event("s", "m", 2, "c"));
        assert_eq!(push.send.len(), 1);
        assert!(batcher.due(t0 + WINDOW, "s").is_none());
    }

    #[test]
    fn sessions_batch_independently() {
        let mut batcher = Batcher::default();
        let t0 = Instant::now();
        batcher.push(t0, event("a", "m", 0, "x"));
        let other = batcher.push(t0 + ms(1), event("b", "m", 0, "y"));
        assert_eq!(other.send.len(), 1);
    }

    #[test]
    fn a_non_contiguous_event_keeps_order() {
        let mut batcher = Batcher::default();
        let t0 = Instant::now();
        batcher.push(t0, event("s", "m", 0, "a"));
        batcher.push(t0 + ms(1), event("s", "m", 1, "b"));
        let push = batcher.push(t0 + ms(2), event("s", "n", 0, "z"));
        assert_eq!(push.send.len(), 1);
        assert_eq!(push.send[0].chunk, "b");
        assert_eq!(batcher.flush("s").expect("batch").chunk, "z");
    }

    #[test]
    fn a_batch_leaves_at_once_when_it_reaches_one_mebibyte() {
        let mut batcher = Batcher::default();
        let t0 = Instant::now();
        batcher.push(t0, event("s", "m", 0, "a"));
        let big = "x".repeat(MAX_BATCH_BYTES);
        let push = batcher.push(t0 + ms(1), event("s", "m", 1, &big));
        assert_eq!(push.send.len(), 1);
        assert_eq!(push.send[0].chunk.len(), MAX_BATCH_BYTES);
        assert!(batcher.flush("s").is_none());
    }

    #[test]
    fn forget_keeps_a_stream_that_still_waits() {
        let mut batcher = Batcher::default();
        let t0 = Instant::now();
        batcher.push(t0, event("s", "m", 0, "a"));
        batcher.push(t0 + ms(1), event("s", "m", 1, "b"));
        batcher.forget("s");
        assert!(batcher.flush("s").is_some());
        batcher.forget("s");
        assert!(batcher.streams.is_empty());
    }
}
