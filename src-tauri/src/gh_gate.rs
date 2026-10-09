//! One shared gate for GitHub CLI reads (ADR-100). The inbox, PR context, PR
//! watches and CI auto-fix all read through `gh`; together they could start a
//! burst of processes and walk into GitHub's secondary rate limit. Reads here:
//! - run at most `MAX_CONCURRENT` at a time;
//! - fail fast for `RATE_LIMIT_PAUSE` once any read reports a rate limit;
//! - reuse an identical successful read made in the last `REUSE_WINDOW`.
//!
//! Writes never go through the gate, but they clear the reuse cache so a read
//! right after a change sees GitHub's new state.

use std::collections::HashMap;
use std::io;
use std::process::Output;
use std::sync::OnceLock;
use std::time::{Duration, Instant};

use parking_lot::Mutex;
use tokio::process::Command;
use tokio::sync::Semaphore;

pub const MAX_CONCURRENT: usize = 5;
pub const RATE_LIMIT_PAUSE: Duration = Duration::from_secs(60);
pub const REUSE_WINDOW: Duration = Duration::from_secs(10);
const REUSE_LIMIT: usize = 64;

#[derive(Default)]
struct Gate {
    paused_until: Option<Instant>,
    recent: HashMap<String, (Instant, Output)>,
}

/// Outcome of looking at the gate before a read runs.
#[derive(Debug, PartialEq, Eq)]
enum Admission {
    Paused,
    Reuse(Output),
    Run,
}

impl Gate {
    fn admit(&mut self, key: &str, now: Instant) -> Admission {
        if self.paused_until.is_some_and(|until| now < until) {
            return Admission::Paused;
        }
        self.paused_until = None;
        match self.recent.get(key) {
            Some((at, output)) if now.saturating_duration_since(*at) < REUSE_WINDOW => {
                Admission::Reuse(output.clone())
            }
            _ => Admission::Run,
        }
    }

    fn record(&mut self, key: String, output: &Output, now: Instant) {
        if rate_limited(output) {
            self.pause(now);
            return;
        }
        if !output.status.success() {
            return;
        }
        self.recent
            .retain(|_, (at, _)| now.saturating_duration_since(*at) < REUSE_WINDOW);
        if self.recent.len() >= REUSE_LIMIT {
            if let Some(oldest) = self
                .recent
                .iter()
                .min_by_key(|(_, (at, _))| *at)
                .map(|(key, _)| key.clone())
            {
                self.recent.remove(&oldest);
            }
        }
        self.recent.insert(key, (now, output.clone()));
    }

    fn pause(&mut self, now: Instant) {
        self.paused_until = Some(now + RATE_LIMIT_PAUSE);
        self.recent.clear();
    }
}

static GATE: Mutex<Option<Gate>> = Mutex::new(None);

fn with_gate<T>(run: impl FnOnce(&mut Gate) -> T) -> T {
    run(GATE.lock().get_or_insert_with(Gate::default))
}

fn permits() -> &'static Semaphore {
    static PERMITS: OnceLock<Semaphore> = OnceLock::new();
    PERMITS.get_or_init(|| Semaphore::new(MAX_CONCURRENT))
}

/// GitHub's primary and secondary limits: `gh` prints the API message
/// ("API rate limit exceeded", "You have exceeded a secondary rate limit")
/// with HTTP 403 or 429.
pub fn rate_limited(output: &Output) -> bool {
    if output.status.success() {
        return false;
    }
    let stderr = String::from_utf8_lossy(&output.stderr).to_ascii_lowercase();
    stderr.contains("rate limit") || stderr.contains("http 429") || stderr.contains("abuse")
}

fn key(command: &Command) -> String {
    let command = command.as_std();
    let mut key = command.get_program().to_string_lossy().into_owned();
    for arg in command.get_args() {
        key.push('\0');
        key.push_str(&arg.to_string_lossy());
    }
    key
}

fn paused_error() -> io::Error {
    io::Error::other("GitHub reads are paused after a rate limit")
}

/// Runs one `gh` read through the shared gate (bounded like `capture_command`).
pub async fn read(command: Command, timeout: Duration) -> io::Result<Output> {
    // Other modules' tests drive fake `gh` binaries that change between calls; the shared
    // process-wide gate would hand them earlier outputs. The gate's own tests use `Gate`.
    if cfg!(test) {
        return crate::cli_output::capture_command(command, timeout).await;
    }
    let key = key(&command);
    match with_gate(|gate| gate.admit(&key, Instant::now())) {
        Admission::Paused => return Err(paused_error()),
        Admission::Reuse(output) => return Ok(output),
        Admission::Run => {}
    }
    let _permit = permits().acquire().await.map_err(io::Error::other)?;
    // An identical read may have finished, or a limit hit, while this one waited.
    match with_gate(|gate| gate.admit(&key, Instant::now())) {
        Admission::Paused => return Err(paused_error()),
        Admission::Reuse(output) => return Ok(output),
        Admission::Run => {}
    }
    let output = crate::cli_output::capture_command(command, timeout).await?;
    with_gate(|gate| gate.record(key, &output, Instant::now()));
    Ok(output)
}

/// After a `gh` write: drop reused reads, and honour a rate limit it reported.
pub fn wrote(output: &io::Result<Output>) {
    with_gate(|gate| match output {
        Ok(output) if rate_limited(output) => gate.pause(Instant::now()),
        _ => gate.recent.clear(),
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[cfg(unix)]
    fn output(code: i32, stdout: &str, stderr: &str) -> Output {
        use std::os::unix::process::ExitStatusExt;
        Output {
            status: std::process::ExitStatus::from_raw(code << 8),
            stdout: stdout.as_bytes().to_vec(),
            stderr: stderr.as_bytes().to_vec(),
        }
    }

    #[cfg(unix)]
    #[test]
    fn identical_reads_are_reused_within_the_window() {
        let mut gate = Gate::default();
        let start = Instant::now();
        assert_eq!(gate.admit("a", start), Admission::Run);
        gate.record("a".into(), &output(0, "one", ""), start);
        assert_eq!(
            gate.admit("a", start + Duration::from_secs(9)),
            Admission::Reuse(output(0, "one", ""))
        );
        assert_eq!(gate.admit("b", start), Admission::Run);
        assert_eq!(
            gate.admit("a", start + REUSE_WINDOW),
            Admission::Run,
            "an old read runs again"
        );
    }

    #[cfg(unix)]
    #[test]
    fn failures_are_not_reused() {
        let mut gate = Gate::default();
        let start = Instant::now();
        gate.record("a".into(), &output(1, "", "HTTP 502"), start);
        assert_eq!(gate.admit("a", start), Admission::Run);
    }

    #[cfg(unix)]
    #[test]
    fn a_rate_limit_pauses_every_read_for_a_minute() {
        let mut gate = Gate::default();
        let start = Instant::now();
        gate.record("ok".into(), &output(0, "x", ""), start);
        gate.record(
            "a".into(),
            &output(
                1,
                "",
                "HTTP 403: You have exceeded a secondary rate limit. (https://api.github.com/graphql)",
            ),
            start,
        );
        for key in ["a", "b", "ok"] {
            assert_eq!(
                gate.admit(key, start + Duration::from_secs(59)),
                Admission::Paused
            );
        }
        assert_eq!(gate.admit("ok", start + RATE_LIMIT_PAUSE), Admission::Run);
        assert_eq!(gate.admit("b", start + RATE_LIMIT_PAUSE), Admission::Run);
    }

    #[cfg(unix)]
    #[test]
    fn rate_limits_are_recognised_but_permissions_are_not() {
        assert!(rate_limited(&output(1, "", "HTTP 429: Too Many Requests")));
        assert!(rate_limited(&output(
            1,
            "",
            "API rate limit exceeded for user"
        )));
        assert!(!rate_limited(&output(
            1,
            "",
            "HTTP 403: Resource not accessible by integration"
        )));
        assert!(!rate_limited(&output(0, "", "rate limit")));
    }

    #[cfg(unix)]
    #[test]
    fn the_reuse_cache_stays_bounded() {
        let mut gate = Gate::default();
        let start = Instant::now();
        for index in 0..(REUSE_LIMIT + 10) {
            gate.record(
                format!("k{index}"),
                &output(0, "x", ""),
                start + Duration::from_millis(index as u64),
            );
        }
        assert!(gate.recent.len() <= REUSE_LIMIT);
        assert!(!gate.recent.contains_key("k0"));
    }

    #[test]
    fn keys_cover_program_and_arguments() {
        let mut one = Command::new("gh");
        one.args(["api", "/a"]);
        let mut two = Command::new("gh");
        two.args(["api", "/b"]);
        assert_ne!(key(&one), key(&two));
        assert_eq!(key(&one), "gh\0api\0/a");
    }
}
