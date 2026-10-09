//! Agent processes kept between turns (after T3 Code, ADR-106/107). Codex, Claude and the ACP
//! agents (OpenCode, Devin, Hermes, Cursor) keep their process after a turn that ended cleanly,
//! so the session's next turn reuses it instead of starting the CLI, its MCP servers and the
//! native session again. A process is reused only while its key (binary, account, workspace and
//! the options fixed at start) is unchanged; at most POOL_LIMIT sessions are kept, each for
//! POOL_IDLE without a turn, as T3 does. Stop, a failure, deleting the session or project, and
//! quitting stop it.
use crate::codex::Wire;
use std::time::Duration;
use tokio::process::Child;

/// A key plus the native conversation the process holds: a kept process continues only the
/// conversation it ran (its first turn creates it, so the key is completed when kept).
pub(crate) fn with_thread(key: &str, session: &crate::models::Session) -> String {
    let thread = session
        .native_thread
        .as_ref()
        .map(|native| native.thread_id.as_str())
        .unwrap_or("");
    format!("{key}\u{0}{thread}")
}

pub(crate) const POOL_LIMIT: usize = 8;
pub(crate) const POOL_IDLE: Duration = Duration::from_secs(30 * 60);

struct Pooled {
    session_id: String,
    key: String,
    child: Child,
    wire: Wire,
    serial: u64,
}

static POOL: parking_lot::Mutex<Vec<Pooled>> = parking_lot::Mutex::new(Vec::new());
static POOL_SERIAL: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(1);

/// The session's kept process when it still runs with the same key; otherwise none (and a
/// stale one is stopped).
pub(crate) fn take(session_id: &str, key: &str) -> Option<(Child, Wire)> {
    let mut pool = POOL.lock();
    let index = pool
        .iter()
        .position(|entry| entry.session_id == session_id)?;
    let mut entry = pool.remove(index);
    drop(pool);
    let alive = matches!(entry.child.try_wait(), Ok(None));
    if alive && entry.key == key {
        Some((entry.child, entry.wire))
    } else {
        crate::agent::kill_owned_group(&mut entry.child);
        None
    }
}

/// Keeps a cleanly ended turn's process for the session's next turn.
pub(crate) fn keep(session_id: String, key: String, child: Child, wire: Wire) {
    let serial = POOL_SERIAL.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
    let mut evicted = Vec::new();
    {
        let mut pool = POOL.lock();
        if let Some(index) = pool.iter().position(|entry| entry.session_id == session_id) {
            evicted.push(pool.remove(index));
        }
        pool.push(Pooled {
            session_id,
            key,
            child,
            wire,
            serial,
        });
        while pool.len() > POOL_LIMIT {
            evicted.push(pool.remove(0));
        }
    }
    for mut entry in evicted {
        crate::agent::kill_owned_group(&mut entry.child);
    }
    tokio::spawn(async move {
        tokio::time::sleep(POOL_IDLE).await;
        let idle = {
            let mut pool = POOL.lock();
            pool.iter()
                .position(|entry| entry.serial == serial)
                .map(|index| pool.remove(index))
        };
        if let Some(mut entry) = idle {
            crate::agent::kill_owned_group(&mut entry.child);
        }
    });
}

/// Stops a session's kept process (session removed, project removed).
pub(crate) fn discard(session_id: &str) {
    let entry = {
        let mut pool = POOL.lock();
        pool.iter()
            .position(|entry| entry.session_id == session_id)
            .map(|index| pool.remove(index))
    };
    if let Some(mut entry) = entry {
        crate::agent::kill_owned_group(&mut entry.child);
    }
}

/// Stops every kept process (Sirus Code closing).
pub(crate) fn clear() {
    for mut entry in std::mem::take(&mut *POOL.lock()) {
        crate::agent::kill_owned_group(&mut entry.child);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::process::Stdio;

    fn idle_server() -> (Child, Wire) {
        let mut child = tokio::process::Command::new("/bin/cat")
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .kill_on_drop(true)
            .process_group(0)
            .spawn()
            .unwrap();
        let wire = Wire::new(child.stdin.take().unwrap(), child.stdout.take().unwrap());
        (child, wire)
    }

    #[tokio::test]
    async fn kept_app_servers_are_reused_only_with_the_same_key_and_bounded() {
        clear();
        let (child, mut wire) = idle_server();
        wire.initialized = true;
        keep("pool-a".into(), "key".into(), child, wire);
        // Another key (account, workspace or binary changed) stops the kept process.
        assert!(take("pool-a", "other").is_none());
        assert!(take("pool-a", "key").is_none());
        let (child, mut wire) = idle_server();
        wire.initialized = true;
        keep("pool-a".into(), "key".into(), child, wire);
        let (mut child, wire) = take("pool-a", "key").unwrap();
        assert!(wire.initialized);
        assert!(matches!(child.try_wait(), Ok(None)));
        crate::agent::kill_owned_group(&mut child);
        // At most POOL_LIMIT sessions: the oldest is stopped first.
        for index in 0..=POOL_LIMIT {
            let (child, wire) = idle_server();
            keep(format!("pool-{index}"), "key".into(), child, wire);
        }
        assert!(take("pool-0", "key").is_none());
        assert!(take(&format!("pool-{POOL_LIMIT}"), "key").is_some());
        clear();
        assert!(POOL.lock().is_empty());
    }
}
