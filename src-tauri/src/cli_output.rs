//! Bounded capture for native, read-only CLI probes. Never exposed as IPC.
use std::io;
use std::process::{Output, Stdio};
use std::time::Duration;
use tokio::io::{AsyncBufReadExt, AsyncRead, AsyncReadExt, AsyncWriteExt, BufReader};
use tokio::process::Command;

const STDOUT_LIMIT: usize = 2 * 1024 * 1024;
const STDERR_LIMIT: usize = 64 * 1024;

async fn bounded<R: AsyncRead + Unpin>(reader: R, limit: usize) -> io::Result<Vec<u8>> {
    let mut bytes = Vec::new();
    reader
        .take(limit as u64 + 1)
        .read_to_end(&mut bytes)
        .await?;
    if bytes.len() > limit {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "CLI probe output exceeds the safe limit",
        ));
    }
    Ok(bytes)
}

pub async fn capture(binary: &str, args: &[&str], duration: Duration) -> io::Result<Output> {
    let mut command = crate::detect::command(binary);
    command.args(args);
    capture_command(command, duration).await
}

/// Capture a native-owned command with caller-selected cwd/environment and the
/// same output ceilings, timeout and owned-group cleanup as catalog probes.
pub(crate) async fn capture_command(
    mut command: Command,
    duration: Duration,
) -> io::Result<Output> {
    command
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    #[cfg(unix)]
    command.process_group(0);
    let mut child = command.spawn()?;
    let stdout = child.stdout.take().expect("piped stdout");
    let stderr = child.stderr.take().expect("piped stderr");
    let result = tokio::time::timeout(duration, async {
        // Drain before reaping: an exited leader stays PID-owned if a helper holds
        // either pipe open, so timeout cleanup can still stop that original group.
        let (stdout, stderr) =
            tokio::try_join!(bounded(stdout, STDOUT_LIMIT), bounded(stderr, STDERR_LIMIT))?;
        let status = child.wait().await?;
        Ok(Output {
            status,
            stdout,
            stderr,
        })
    })
    .await
    .unwrap_or_else(|_| {
        Err(io::Error::new(
            io::ErrorKind::TimedOut,
            "CLI probe timed out",
        ))
    });
    if result.is_err() {
        #[cfg(unix)]
        if let Some(pid) = child.id() {
            let pid = pid as libc::pid_t;
            // Signal only the group whose still-owned leader was spawned above.
            // This child has not been reaped; its PID cannot be reused here.
            unsafe {
                libc::kill(-pid, libc::SIGKILL);
            }
        }
        let _ = child.start_kill();
        let _ = tokio::time::timeout(Duration::from_secs(2), child.wait()).await;
    }
    result
}

/// One read-only, native-owned NDJSON initialization request. Return only the
/// selected catalog field; account/configuration envelopes are neither logged nor
/// returned to IPC. No user prompt is accepted by this helper.
pub async fn request(
    binary: &str,
    args: &[&str],
    input: &[u8],
    duration: Duration,
    select: impl Fn(&serde_json::Value) -> Option<serde_json::Value>,
) -> io::Result<serde_json::Value> {
    if input.len() > 4096 {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "Catalog initialization is too large",
        ));
    }
    let mut command = crate::detect::command(binary);
    command
        .args(args)
        .current_dir(std::env::temp_dir())
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    #[cfg(unix)]
    command.process_group(0);
    let mut child = command.spawn()?;
    let mut stdin = child.stdin.take().expect("piped stdin");
    let mut stdout = BufReader::new(
        child
            .stdout
            .take()
            .expect("piped stdout")
            .take(STDOUT_LIMIT as u64 + 1),
    );
    let stderr = child.stderr.take().expect("piped stderr");
    let mut errors = tokio::spawn(async move { bounded(stderr, STDERR_LIMIT).await.map(|_| ()) });
    let mut drained_errors = false;
    let result = tokio::time::timeout(duration, async {
        stdin.write_all(input).await?;
        stdin.flush().await?;
        let mut total = 0;
        // read_until is cancellation-safe only if its partially filled buffer
        // survives another select branch (such as stderr closing).
        let mut line = Vec::new();
        loop {
            let count = tokio::select! {
                count = stdout.read_until(b'\n', &mut line) => count?,
                result = &mut errors, if !drained_errors => {
                    drained_errors = true;
                    result.map_err(io::Error::other)??;
                    continue;
                }
            };
            total += line.len();
            if total > STDOUT_LIMIT {
                return Err(io::Error::new(
                    io::ErrorKind::InvalidData,
                    "CLI catalog output exceeds the safe limit",
                ));
            }
            if count == 0 && line.is_empty() {
                return Err(io::Error::new(
                    io::ErrorKind::UnexpectedEof,
                    "CLI initialization ended without a catalog",
                ));
            }
            if let Ok(value) = serde_json::from_slice(&line) {
                if let Some(selected) = select(&value) {
                    return Ok(selected);
                }
            }
            line.clear();
        }
    })
    .await
    .unwrap_or_else(|_| {
        Err(io::Error::new(
            io::ErrorKind::TimedOut,
            "CLI catalog initialization timed out",
        ))
    });
    // The leader has not been reaped, even on EOF: its process group is still owned.
    #[cfg(unix)]
    if let Some(pid) = child.id() {
        unsafe {
            libc::kill(-(pid as libc::pid_t), libc::SIGKILL);
        }
    }
    let _ = child.start_kill();
    let _ = tokio::time::timeout(Duration::from_secs(2), child.wait()).await;
    drop(stdin);
    if !drained_errors {
        errors.abort();
        let _ = errors.await;
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    #[cfg(unix)]
    #[tokio::test]
    async fn catalog_request_selects_only_requested_data_and_handles_closed_stderr() {
        let output = request("/bin/sh", &["-c", "exec 2>&-; read -r input; printf '%s\\n' '{\"account\":\"not-returned\"}' '{\"models\":[{\"value\":\"model\"}]}'; sleep 30"], b"initialize\n", Duration::from_secs(2), |value| value.get("models").cloned()).await.unwrap();
        assert_eq!(output, serde_json::json!([{"value":"model"}]));
    }
    #[cfg(unix)]
    #[tokio::test]
    async fn catalog_request_without_response_times_out() {
        let start = std::time::Instant::now();
        let error = request(
            "/bin/sh",
            &["-c", "read -r input; sleep 30"],
            b"initialize\n",
            Duration::from_millis(80),
            |_| None,
        )
        .await
        .unwrap_err();
        assert_eq!(error.kind(), io::ErrorKind::TimedOut);
        assert!(start.elapsed() < Duration::from_secs(3));
    }
    #[cfg(unix)]
    #[tokio::test]
    async fn catalog_request_keeps_partial_stdout_when_stderr_closes() {
        let output = request("/bin/sh", &["-c", "read -r input; printf '%s' '{\"models\":'; sleep 0.03; exec 2>&-; sleep 0.03; printf '%s\\n' '[{\"value\":\"model\"}]}'; sleep 30"], b"initialize\n", Duration::from_secs(2), |value| value.get("models").cloned()).await.unwrap();
        assert_eq!(output, serde_json::json!([{"value":"model"}]));
    }
    #[cfg(unix)]
    #[tokio::test]
    async fn catalog_request_reports_oversized_stderr_without_repolling_finished_task() {
        let error = request(
            "/bin/sh",
            &["-c", "read -r input; head -c 65537 /dev/zero >&2; sleep 30"],
            b"initialize\n",
            Duration::from_secs(2),
            |_| None,
        )
        .await
        .unwrap_err();
        assert_eq!(error.kind(), io::ErrorKind::InvalidData);
    }
    #[tokio::test]
    async fn preserves_output_and_refuses_oversized_streams() {
        assert_eq!(bounded(&b"version\n"[..], 32).await.unwrap(), b"version\n");
        let oversized = vec![b'x'; 33];
        assert_eq!(
            bounded(oversized.as_slice(), 32).await.unwrap_err().kind(),
            io::ErrorKind::InvalidData
        );
    }
    #[cfg(unix)]
    #[tokio::test]
    async fn an_exited_probe_with_open_descendant_pipes_is_bounded_and_reaped() {
        let repo = crate::git::tests::Repo::new();
        let marker = repo.0.join("owned-probe-helper.pid");
        let identity = uuid::Uuid::new_v4().to_string();
        let script = format!("/bin/sh -c 'sleep 30; : {identity}' & printf '%s' \"$!\" > \"$1\"");
        let start = std::time::Instant::now();
        let error = capture(
            "/bin/sh",
            &["-c", &script, "probe-fixture", marker.to_str().unwrap()],
            Duration::from_millis(80),
        )
        .await
        .unwrap_err();
        assert_eq!(error.kind(), io::ErrorKind::TimedOut);
        assert!(start.elapsed() < Duration::from_secs(3));
        let pid: i32 = std::fs::read_to_string(marker).unwrap().parse().unwrap();
        let output = std::process::Command::new("/bin/ps")
            .args(["-p", &pid.to_string(), "-o", "stat=,args="])
            .output()
            .unwrap();
        let row = String::from_utf8_lossy(&output.stdout);
        let still_running = row.contains(&identity) && !row.trim_start().starts_with('Z');
        if still_running {
            // The unique fixture marker identifies this helper before test cleanup.
            let group = unsafe { libc::getpgid(pid) };
            if group > 0 {
                unsafe {
                    libc::kill(-group, libc::SIGKILL);
                }
            }
        }
        assert!(
            !still_running,
            "timeout must terminate its pipe-owning helper"
        );
    }
}
