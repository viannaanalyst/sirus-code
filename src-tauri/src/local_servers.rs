//! Stopping a local development server from the Environment card. Only a
//! process that Sirus Code itself started (a terminal shell's child or an agent's
//! tool) can be stopped: the listener of a localhost port is found with a fixed
//! `lsof` probe, its parent chain must reach this app's process, and it gets
//! SIGTERM. Servers started outside the app are never touched.

use std::time::Duration;

use serde::Deserialize;
use tauri::State;
use tokio::process::Command;

use crate::commands::AppState;
use crate::error::{Error, Result};

const LSOF: &str = "/usr/sbin/lsof";
const PS: &str = "/bin/ps";
const PROBE_TIMEOUT: Duration = Duration::from_secs(3);
const MAX_ANCESTRY: usize = 64;

#[derive(Debug, Deserialize)]
#[serde(
    tag = "type",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum Action {
    Stop { session_id: String, url: String },
}

/// The port of an http(s) localhost URL, or `None` for anything else.
pub fn localhost_port(url: &str) -> Option<u16> {
    let rest = url
        .strip_prefix("http://")
        .or_else(|| url.strip_prefix("https://"))?;
    let authority = rest.split(['/', '?', '#']).next()?;
    let (host, port) = if let Some(bracketed) = authority.strip_prefix('[') {
        let (host, tail) = bracketed.split_once(']')?;
        (host, tail.strip_prefix(':')?)
    } else {
        authority.rsplit_once(':')?
    };
    if !matches!(host, "localhost" | "127.0.0.1" | "::1" | "0.0.0.0") {
        return None;
    }
    port.parse::<u16>().ok().filter(|port| *port > 0)
}

async fn output(program: &str, args: &[&str]) -> Option<String> {
    let mut command = Command::new(program);
    command
        .args(args)
        .env_clear()
        .env("PATH", "/usr/bin:/bin:/usr/sbin:/sbin");
    let result = crate::cli_output::capture_command(command, PROBE_TIMEOUT)
        .await
        .ok()?;
    Some(String::from_utf8_lossy(&result.stdout).into_owned())
}

async fn parent_of(pid: u32) -> Option<u32> {
    output(PS, &["-o", "ppid=", "-p", &pid.to_string()])
        .await?
        .trim()
        .parse()
        .ok()
}

/// True when `pid` descends from this app's process.
async fn owned(pid: u32) -> bool {
    let me = std::process::id();
    let mut current = pid;
    for _ in 0..MAX_ANCESTRY {
        if current == me {
            return current != pid;
        }
        match parent_of(current).await {
            Some(parent) if parent > 1 && parent != current => current = parent,
            _ => return false,
        }
    }
    false
}

#[tauri::command]
pub async fn local_server_action(
    state: State<'_, std::sync::Arc<AppState>>,
    action: Action,
) -> Result<u32> {
    let Action::Stop { session_id, url } = action;
    state.ensure_running()?;
    if !state
        .data
        .lock()
        .sessions
        .iter()
        .any(|session| session.id == session_id)
    {
        return Err(Error::not_found("session not found"));
    }
    let port = localhost_port(&url)
        .ok_or_else(|| Error::new("invalid", "Only localhost servers can be stopped."))?;
    let listing = output(
        LSOF,
        &["-nP", &format!("-iTCP:{port}"), "-sTCP:LISTEN", "-t"],
    )
    .await
    .unwrap_or_default();
    let pids: Vec<u32> = listing
        .lines()
        .filter_map(|line| line.trim().parse().ok())
        .take(8)
        .collect();
    if pids.is_empty() {
        return Err(Error::new("not_found", "That server is no longer running."));
    }
    let mut stopped = 0;
    for pid in pids {
        if !owned(pid).await {
            continue;
        }
        #[cfg(unix)]
        // SAFETY: plain signal to a verified descendant process id.
        if unsafe { libc::kill(pid as i32, libc::SIGTERM) } == 0 {
            stopped += 1;
        }
    }
    if stopped == 0 {
        return Err(Error::new(
            "forbidden",
            "This server was not started by Sirus Code, so it is left running.",
        ));
    }
    Ok(stopped)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_localhost_ports_are_accepted() {
        assert_eq!(localhost_port("http://localhost:5173/"), Some(5173));
        assert_eq!(localhost_port("http://127.0.0.1:3000/app?x=1"), Some(3000));
        assert_eq!(localhost_port("https://[::1]:8443"), Some(8443));
        assert_eq!(localhost_port("http://example.com:80"), None);
        assert_eq!(localhost_port("http://localhost"), None);
        assert_eq!(localhost_port("file:///tmp:80"), None);
        assert_eq!(localhost_port("http://localhost:0"), None);
    }
}
