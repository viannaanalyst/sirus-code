use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::Arc;
use std::thread;

use parking_lot::Mutex;
use portable_pty::{native_pty_system, CommandBuilder, MasterPty, PtySize};
use tauri::{AppHandle, Emitter, Manager};

use crate::error::{Error, Result};
use crate::models::PtyOutputEvent;

pub struct PtySession {
    writer: Arc<Mutex<Box<dyn Write + Send>>>,
    master: Arc<Mutex<Box<dyn MasterPty + Send>>>,
    killer: Arc<Mutex<Box<dyn portable_pty::ChildKiller + Send + Sync>>>,
    #[cfg(unix)]
    pid: Option<u32>,
    pub id: String,
    /// Owning session. Every command checks it before touching this PTY.
    pub session_id: String,
    /// Terminal tab identity. Unique per session.
    pub terminal_id: String,
}

#[derive(Default)]
struct Utf8Stream {
    pending: Vec<u8>,
}
impl Utf8Stream {
    fn decode(&mut self, bytes: &[u8], eof: bool) -> String {
        self.pending.extend_from_slice(bytes);
        let mut result = String::new();
        loop {
            match std::str::from_utf8(&self.pending) {
                Ok(text) => {
                    result.push_str(text);
                    self.pending.clear();
                    break;
                }
                Err(error) => {
                    let valid = error.valid_up_to();
                    result.push_str(std::str::from_utf8(&self.pending[..valid]).unwrap());
                    self.pending.drain(..valid);
                    match error.error_len() {
                        Some(length) => {
                            self.pending.drain(..length);
                            result.push('\u{fffd}');
                        }
                        None => {
                            if eof {
                                result.push('\u{fffd}');
                                self.pending.clear();
                            }
                            break;
                        }
                    }
                }
            }
        }
        result
    }
}

#[cfg(unix)]
fn signal_owned_session(session: libc::pid_t, signal: libc::c_int) -> Result<()> {
    let output = std::process::Command::new("/bin/ps")
        .args(["-axo", "pid="])
        .output()
        .map_err(|error| {
            Error::new(
                "pty",
                format!("cannot inspect owned terminal processes: {error}"),
            )
        })?;
    if !output.status.success() || output.stdout.len() > 1024 * 1024 {
        return Err(Error::new(
            "pty",
            "cannot inspect owned terminal processes safely",
        ));
    }
    for process in String::from_utf8_lossy(&output.stdout)
        .split_whitespace()
        .filter_map(|value| value.parse::<libc::pid_t>().ok())
        .filter(|pid| *pid > 0)
    {
        // Recheck immediately before the signal, rejecting other sessions.
        // POSIX still has a small PID check/use window; this is not a pidfd API.
        if unsafe { libc::getsid(process) } != session {
            continue;
        }
        let result = unsafe { libc::kill(process, signal) };
        if result != 0 {
            let error = std::io::Error::last_os_error();
            if error.raw_os_error() != Some(libc::ESRCH) {
                return Err(Error::new("pty", error.to_string()));
            }
        }
    }
    Ok(())
}

impl PtySession {
    pub fn write(&self, data: &str) -> Result<()> {
        self.writer
            .lock()
            .write_all(data.as_bytes())
            .map_err(|err| Error::new("pty", err.to_string()))
    }

    pub fn resize(&self, cols: u16, rows: u16) -> Result<()> {
        self.master
            .lock()
            .resize(PtySize {
                rows,
                cols,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|err| Error::new("pty", err.to_string()))
    }

    pub fn kill(&self) -> Result<()> {
        #[cfg(unix)]
        if let Some(pid) = self.pid.filter(|pid| *pid > 0) {
            let pid = pid as libc::pid_t;
            // Job control gives background processes separate groups. Enumerate only
            // numeric PIDs, then authorize every signal against our owned session ID.
            // Detached processes with a different session ID are deliberately excluded.
            signal_owned_session(pid, libc::SIGHUP)?;
            std::thread::sleep(std::time::Duration::from_millis(100));
            signal_owned_session(pid, libc::SIGKILL)?;
            return Ok(());
        }
        self.killer
            .lock()
            .kill()
            .map_err(|err| Error::new("pty", err.to_string()))
    }
}

pub fn start(
    app: AppHandle,
    session_id: String,
    terminal_id: String,
    cwd: String,
    cols: u16,
    rows: u16,
) -> Result<PtySession> {
    let system = native_pty_system();
    let pair = system
        .openpty(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|err| Error::new("pty", err.to_string()))?;

    let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".into());
    let mut cmd = CommandBuilder::new(shell);
    cmd.cwd(cwd);
    cmd.env("TERM", "xterm-256color");

    let mut child = pair
        .slave
        .spawn_command(cmd)
        .map_err(|err| Error::new("pty", err.to_string()))?;
    drop(pair.slave);

    let mut reader = pair
        .master
        .try_clone_reader()
        .map_err(|err| Error::new("pty", err.to_string()))?;
    let writer = pair
        .master
        .take_writer()
        .map_err(|err| Error::new("pty", err.to_string()))?;

    let killer = child.clone_killer();
    #[cfg(unix)]
    let pid = child.process_id();
    let id = uuid::Uuid::new_v4().to_string();
    let reader_id = id.clone();
    let session_for_read = session_id.clone();
    let terminal_for_read = terminal_id.clone();
    thread::spawn(move || {
        let mut buf = [0u8; 4096];
        let mut decoder = Utf8Stream::default();
        loop {
            match reader.read(&mut buf) {
                Ok(n) => {
                    let data = decoder.decode(&buf[..n], n == 0);
                    let state = app.state::<Arc<crate::commands::AppState>>();
                    let ptys = state.ptys.lock();
                    if !ptys
                        .get(&terminal_for_read)
                        .is_some_and(|pty| pty.id == reader_id)
                    {
                        if n == 0 {
                            break;
                        }
                        continue;
                    }
                    if !data.is_empty() {
                        let _ = app.emit(
                            "pty-output",
                            PtyOutputEvent {
                                session_id: session_for_read.clone(),
                                terminal_id: terminal_for_read.clone(),
                                data,
                            },
                        );
                    }
                    if n == 0 {
                        break;
                    }
                }
                Err(error) => {
                    tracing::debug!(%error, "PTY reader closed");
                    break;
                }
            }
        }
        let _ = child.wait();
        let state = app.state::<Arc<crate::commands::AppState>>();
        let mut ptys = state.ptys.lock();
        // A delayed exit from an old PTY must never remove a reopened terminal.
        let current = ptys
            .get(&terminal_for_read)
            .is_some_and(|pty| pty.id == reader_id);
        if current {
            ptys.remove(&terminal_for_read);
        }
        if !current {
            return;
        }
        let _ = app.emit(
            "pty-exit",
            PtyOutputEvent {
                session_id: session_for_read,
                terminal_id: terminal_for_read,
                data: String::new(),
            },
        );
    });

    Ok(PtySession {
        writer: Arc::new(Mutex::new(writer)),
        master: Arc::new(Mutex::new(pair.master)),
        killer: Arc::new(Mutex::new(killer)),
        #[cfg(unix)]
        pid,
        id,
        session_id,
        terminal_id,
    })
}

/// Keyed by terminal id. Each entry is owner-checked against its session.
pub type PtyMap = HashMap<String, PtySession>;

#[cfg(test)]
mod tests {
    use super::*;
    #[cfg(unix)]
    #[test]
    fn terminal_close_terminates_shell_ignoring_hangup() {
        let pair = native_pty_system()
            .openpty(PtySize {
                rows: 24,
                cols: 80,
                pixel_width: 0,
                pixel_height: 0,
            })
            .unwrap();
        let mut command = CommandBuilder::new("/bin/sh");
        command.args(["-c", "trap '' HUP; printf READY; while :; do sleep 1; done"]);
        let mut child = pair.slave.spawn_command(command).unwrap();
        drop(pair.slave);
        let mut reader = pair.master.try_clone_reader().unwrap();
        let mut ready = [0u8; 5];
        reader.read_exact(&mut ready).unwrap();
        assert_eq!(&ready, b"READY");
        let terminal = PtySession {
            writer: Arc::new(Mutex::new(pair.master.take_writer().unwrap())),
            master: Arc::new(Mutex::new(pair.master)),
            killer: Arc::new(Mutex::new(child.clone_killer())),
            pid: child.process_id(),
            id: "owned-test".into(),
            session_id: "owned-session".into(),
            terminal_id: "owned-test".into(),
        };
        terminal.kill().unwrap();
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(2);
        loop {
            if child.try_wait().unwrap().is_some() {
                break;
            }
            if std::time::Instant::now() >= deadline {
                unsafe {
                    libc::kill(child.process_id().unwrap() as i32, libc::SIGKILL);
                }
                child.wait().unwrap();
                panic!("terminal shell survived Close");
            }
            std::thread::sleep(std::time::Duration::from_millis(10));
        }
    }
    #[cfg(unix)]
    #[test]
    fn terminal_close_hangs_up_normal_background_jobs() {
        use std::io::BufRead;
        let pair = native_pty_system()
            .openpty(PtySize {
                rows: 24,
                cols: 80,
                pixel_width: 0,
                pixel_height: 0,
            })
            .unwrap();
        let mut command = CommandBuilder::new("/bin/zsh");
        command.args(["-f"]);
        let mut child = pair.slave.spawn_command(command).unwrap();
        drop(pair.slave);
        let reader = pair.master.try_clone_reader().unwrap();
        let (sender, receiver) = std::sync::mpsc::channel();
        std::thread::spawn(move || {
            for line in std::io::BufReader::new(reader.take(8192))
                .lines()
                .map_while(std::result::Result::ok)
            {
                if let Some(value) = line.split("SWITCHYARD_BG:").last() {
                    if let Ok(pid) = value.trim().parse::<i32>() {
                        let _ = sender.send(pid);
                    }
                }
            }
        });
        let shell = child.process_id().unwrap() as i32;
        let terminal = PtySession {
            writer: Arc::new(Mutex::new(pair.master.take_writer().unwrap())),
            master: Arc::new(Mutex::new(pair.master)),
            killer: Arc::new(Mutex::new(child.clone_killer())),
            pid: child.process_id(),
            id: "owned-job-test".into(),
            session_id: "owned-session".into(),
            terminal_id: "owned-job-test".into(),
        };
        terminal
            .write("setopt HUP; sleep 30 & print -r -- SWITCHYARD_BG:$!\n")
            .unwrap();
        let job = receiver.recv_timeout(std::time::Duration::from_secs(2));
        let groups = job.as_ref().ok().map(|job| {
            (unsafe { libc::getsid(*job) }, unsafe {
                libc::getpgid(*job)
            })
        });
        let mut unrelated = std::process::Command::new("/bin/sleep")
            .arg("30")
            .spawn()
            .unwrap();
        assert_ne!(unsafe { libc::getsid(unrelated.id() as i32) }, shell);
        terminal.kill().unwrap();
        let unrelated_alive = unrelated.try_wait().unwrap().is_none();
        unrelated.kill().unwrap();
        unrelated.wait().unwrap();
        assert!(
            unrelated_alive,
            "cleanup must not signal processes from another session"
        );
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(2);
        while child.try_wait().unwrap().is_none() {
            assert!(
                std::time::Instant::now() < deadline,
                "owned terminal shell survived Close"
            );
            std::thread::sleep(std::time::Duration::from_millis(10));
        }
        let job = job.expect("owned shell must report its background job");
        assert_eq!(groups.unwrap().0, shell);
        assert_ne!(groups.unwrap().1, shell);
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(2);
        while unsafe { libc::kill(job, 0) } == 0 {
            if std::time::Instant::now() >= deadline {
                if unsafe { libc::getsid(job) } == shell {
                    unsafe {
                        libc::kill(job, libc::SIGKILL);
                    }
                }
                let state = std::process::Command::new("ps")
                    .args(["-p", &job.to_string(), "-o", "stat=,command="])
                    .output()
                    .unwrap();
                panic!(
                    "normal background job survived terminal Close: {}",
                    String::from_utf8_lossy(&state.stdout)
                );
            }
            std::thread::sleep(std::time::Duration::from_millis(10));
        }
    }

    #[test]
    fn preserves_multibyte_text_between_pty_reads() {
        let mut decoder = Utf8Stream::default();
        let text = "ação 🚂\u{1b}[0m";
        let mut output = String::new();
        for byte in text.as_bytes() {
            output.push_str(&decoder.decode(&[*byte], false));
        }
        output.push_str(&decoder.decode(&[], true));
        assert_eq!(output, text);
    }
    #[test]
    fn replaces_invalid_bytes_without_losing_following_output() {
        let mut decoder = Utf8Stream::default();
        assert_eq!(decoder.decode(&[0xff, b'a', 0xf0], false), "\u{fffd}a");
        assert_eq!(decoder.decode(&[], true), "\u{fffd}");
    }
}
