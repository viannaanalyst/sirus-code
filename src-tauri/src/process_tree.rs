//! Agent process trees and their CPU priority (ADR-100).
//!
//! Each agent CLI runs in its own process group, and stopping it signals that
//! group. Some descendants leave the group (Claude background shells, MCP
//! servers and daemons that call `setsid`), so they would outlive Stop and Quit.
//! `stop_tree` snapshots the descendants of the agent first, kills its group as
//! before, sends SIGTERM to every escaped descendant and SIGKILLs the survivors
//! after a short grace. Only processes that descend from the agent are touched.
//!
//! Agent CLIs also run at a lower priority (`AGENT_NICE`) so the UI stays smooth
//! when several agents build and test at once. Terminals the person types in are
//! spawned elsewhere and keep the normal priority.

/// Nice increment for agent CLIs and everything they start.
pub const AGENT_NICE: i32 = 5;
/// Time escaped descendants get to exit after SIGTERM.
#[cfg(unix)]
const GRACE: std::time::Duration = std::time::Duration::from_millis(1500);

/// One row of the process table.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Proc {
    pub pid: i32,
    pub ppid: i32,
    pub pgid: i32,
}

/// Parses `ps -A -o pid=,ppid=,pgid=`.
pub fn parse_table(text: &str) -> Vec<Proc> {
    text.lines()
        .filter_map(|line| {
            let mut columns = line.split_whitespace().map(str::parse::<i32>);
            let (Some(Ok(pid)), Some(Ok(ppid)), Some(Ok(pgid))) =
                (columns.next(), columns.next(), columns.next())
            else {
                return None;
            };
            Some(Proc { pid, ppid, pgid })
        })
        .collect()
}

/// Every process below `root` (not `root` itself), parents before children.
pub fn descendants(table: &[Proc], root: i32) -> Vec<Proc> {
    let mut found = Vec::new();
    let mut frontier = vec![root];
    while let Some(parent) = frontier.pop() {
        for process in table {
            if process.ppid == parent
                && process.pid != root
                && process.pid > 1
                && !found.iter().any(|known: &Proc| known.pid == process.pid)
            {
                found.push(*process);
                frontier.push(process.pid);
            }
        }
    }
    found
}

/// Escaped descendants: those outside the agent's own group, which the group
/// signal does not reach.
pub fn escaped(table: &[Proc], root: i32) -> Vec<Proc> {
    descendants(table, root)
        .into_iter()
        .filter(|process| process.pgid != root)
        .collect()
}

/// Recorded processes still present with the same parent link or group (a
/// reaped PID reused by an unrelated process would differ), plus anything they
/// started meanwhile.
pub fn survivors(recorded: &[Proc], table: &[Proc]) -> Vec<Proc> {
    let mut alive: Vec<Proc> = table
        .iter()
        .filter(|now| {
            recorded.iter().any(|then| {
                then.pid == now.pid
                    && then.pgid == now.pgid
                    // Orphans are re-parented to launchd/init.
                    && (then.ppid == now.ppid || now.ppid == 1)
            })
        })
        .copied()
        .collect();
    let roots: Vec<i32> = alive.iter().map(|process| process.pid).collect();
    for root in roots {
        for child in descendants(table, root) {
            if !alive.iter().any(|known| known.pid == child.pid) {
                alive.push(child);
            }
        }
    }
    alive
}

#[cfg(unix)]
mod unix {
    use super::*;
    use parking_lot::{Condvar, Mutex};
    use std::time::Instant;

    pub(super) fn table() -> Vec<Proc> {
        std::process::Command::new("/bin/ps")
            .args(["-A", "-o", "pid=,ppid=,pgid="])
            .stdin(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .output()
            .ok()
            .filter(|output| output.status.success())
            .map(|output| parse_table(&String::from_utf8_lossy(&output.stdout)))
            .unwrap_or_default()
    }

    fn signal(processes: &[Proc], signal: i32) {
        for process in processes {
            unsafe {
                libc::kill(process.pid, signal);
            }
        }
    }

    struct Pending {
        id: u64,
        deadline: Instant,
        processes: Vec<Proc>,
    }

    static PENDING: Mutex<Vec<Pending>> = Mutex::new(Vec::new());
    static SETTLED: Condvar = Condvar::new();
    static NEXT: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(1);

    fn kill_survivors(processes: &[Proc]) {
        signal(&survivors(processes, &table()), libc::SIGKILL);
    }

    pub(super) fn terminate(processes: Vec<Proc>) {
        if processes.is_empty() {
            return;
        }
        signal(&processes, libc::SIGTERM);
        let id = NEXT.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
        PENDING.lock().push(Pending {
            id,
            deadline: Instant::now() + GRACE,
            processes,
        });
        let spawned = std::thread::Builder::new()
            .name("sirus-stop-tree".into())
            .spawn(move || {
                std::thread::sleep(GRACE);
                let entry = {
                    let mut pending = PENDING.lock();
                    let index = pending.iter().position(|entry| entry.id == id);
                    index.map(|index| pending.remove(index))
                };
                if let Some(entry) = entry {
                    kill_survivors(&entry.processes);
                }
                SETTLED.notify_all();
            });
        if spawned.is_err() {
            let entry = {
                let mut pending = PENDING.lock();
                let index = pending.iter().position(|entry| entry.id == id);
                index.map(|index| pending.remove(index))
            };
            if let Some(entry) = entry {
                kill_survivors(&entry.processes);
            }
        }
    }

    /// Quit: finish every pending stop now. Waits at most until the latest
    /// deadline, then SIGKILLs whatever is left.
    pub(super) fn finish_pending() {
        let mut pending = PENDING.lock();
        if let Some(deadline) = pending.iter().map(|entry| entry.deadline).max() {
            let quit_by = deadline.min(Instant::now() + std::time::Duration::from_millis(500));
            while !pending.is_empty() {
                if SETTLED.wait_until(&mut pending, quit_by).timed_out() {
                    break;
                }
            }
        }
        let left: Vec<Pending> = pending.drain(..).collect();
        drop(pending);
        for entry in left {
            kill_survivors(&entry.processes);
        }
    }
}

/// Stops an agent: its process group at once, then every descendant that left
/// the group (SIGTERM now, SIGKILL after `GRACE`). The caller still owns the
/// unreaped leader, so `pid` cannot have been reused yet.
#[cfg(unix)]
pub fn stop_tree(pid: u32) -> std::io::Result<()> {
    let root = pid as i32;
    if root <= 1 {
        return Ok(());
    }
    // Snapshot before signalling: once the leader dies its children are re-parented.
    let escaped = escaped(&unix::table(), root);
    let result = unsafe { libc::kill(-root, libc::SIGKILL) };
    let error = (result != 0).then(std::io::Error::last_os_error);
    unix::terminate(escaped);
    match error {
        Some(error) if error.raw_os_error() != Some(libc::ESRCH) => Err(error),
        _ => Ok(()),
    }
}

/// App quit: SIGKILL what earlier stops left running (bounded wait).
pub fn finish_pending() {
    #[cfg(unix)]
    unix::finish_pending();
}

/// Lowers an agent's CPU priority right after it is spawned; its children
/// inherit it. Never fails the turn: priority is only a courtesy to the UI.
pub fn lower_priority(pid: Option<u32>) {
    #[cfg(unix)]
    if let Some(pid) = pid.filter(|pid| *pid > 1) {
        unsafe {
            // getpriority can legitimately return -1; clear errno to tell.
            *errno_location() = 0;
            let current = libc::getpriority(libc::PRIO_PROCESS, pid as libc::id_t);
            if current == -1 && *errno_location() != 0 {
                return;
            }
            let target = (current + AGENT_NICE).min(20);
            if target > current {
                libc::setpriority(libc::PRIO_PROCESS, pid as libc::id_t, target);
            }
        }
    }
    #[cfg(not(unix))]
    let _ = pid;
}

#[cfg(target_os = "macos")]
unsafe fn errno_location() -> *mut i32 {
    libc::__error()
}
#[cfg(all(unix, not(target_os = "macos")))]
unsafe fn errno_location() -> *mut i32 {
    libc::__errno_location()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn proc(pid: i32, ppid: i32, pgid: i32) -> Proc {
        Proc { pid, ppid, pgid }
    }

    #[test]
    fn parses_the_process_table() {
        assert_eq!(
            parse_table("  1     0     1\n 501   1   501\nbad line\n 600 501 600\n"),
            vec![proc(1, 0, 1), proc(501, 1, 501), proc(600, 501, 600)]
        );
    }

    #[test]
    fn walks_descendants_and_spares_everything_else() {
        let table = [
            proc(1, 0, 1),
            proc(10, 1, 10), // agent
            proc(11, 10, 10),
            proc(12, 11, 12), // setsid grandchild
            proc(13, 12, 12),
            proc(20, 1, 20),  // unrelated
            proc(21, 20, 10), // unrelated, same number as the agent group
        ];
        let below: Vec<i32> = descendants(&table, 10).iter().map(|p| p.pid).collect();
        assert_eq!(below.len(), 3);
        for pid in [11, 12, 13] {
            assert!(below.contains(&pid));
        }
        let out: Vec<i32> = escaped(&table, 10).iter().map(|p| p.pid).collect();
        assert_eq!(out.len(), 2);
        assert!(out.contains(&12) && out.contains(&13));
    }

    #[test]
    fn survivors_ignore_reused_pids_and_follow_new_children() {
        let recorded = [proc(12, 11, 12), proc(13, 12, 12)];
        let table = [
            proc(1, 0, 1),
            proc(12, 1, 12),  // orphaned, still ours
            proc(13, 77, 77), // pid reused by someone else
            proc(14, 12, 12), // started after the snapshot
        ];
        let alive: Vec<i32> = survivors(&recorded, &table).iter().map(|p| p.pid).collect();
        assert_eq!(alive, vec![12, 14]);
    }

    #[cfg(unix)]
    fn alive(pid: i32) -> bool {
        // Zombies count as gone: they hold no resources and only await a reap.
        unix::table().iter().any(|process| process.pid == pid)
            && std::process::Command::new("/bin/ps")
                .args(["-o", "stat=", "-p", &pid.to_string()])
                .output()
                .map(|output| {
                    !String::from_utf8_lossy(&output.stdout)
                        .trim()
                        .starts_with('Z')
                })
                .unwrap_or(false)
    }

    #[cfg(unix)]
    #[test]
    fn stop_kills_a_grandchild_that_left_the_group() {
        use std::os::unix::process::CommandExt;
        let dir = tempfile::tempdir().unwrap();
        let marker = dir.path().join("grandchild.pid");
        // The grandchild starts its own session (new group) and ignores SIGTERM,
        // so only the SIGKILL escalation can stop it.
        let script = format!(
            "/usr/bin/perl -MPOSIX -e 'POSIX::setsid(); $SIG{{TERM}}=q(IGNORE); open(my $f, \">\", $ARGV[0]); print $f $$; close $f; sleep 60' {:?} &\nsleep 60\n",
            marker
        );
        let mut child = std::process::Command::new("/bin/sh")
            .arg("-c")
            .arg(script)
            .process_group(0)
            .spawn()
            .unwrap();
        let started = std::time::Instant::now();
        let grandchild = loop {
            if let Some(pid) = std::fs::read_to_string(&marker)
                .ok()
                .and_then(|text| text.trim().parse::<i32>().ok())
            {
                break pid;
            }
            assert!(started.elapsed() < std::time::Duration::from_secs(10));
            std::thread::sleep(std::time::Duration::from_millis(20));
        };
        let unrelated = std::process::Command::new("/bin/sleep")
            .arg("30")
            .spawn()
            .unwrap();
        assert!(alive(grandchild));
        stop_tree(child.id()).unwrap();
        child.wait().unwrap();
        let started = std::time::Instant::now();
        while alive(grandchild) {
            assert!(
                started.elapsed() < std::time::Duration::from_secs(8),
                "the setsid grandchild outlived stop"
            );
            std::thread::sleep(std::time::Duration::from_millis(50));
        }
        let mut unrelated = unrelated;
        assert!(
            unrelated.try_wait().unwrap().is_none(),
            "an unrelated process was killed"
        );
        let _ = unrelated.kill();
        let _ = unrelated.wait();
    }

    #[cfg(unix)]
    #[test]
    fn lowered_priority_applies_to_the_child() {
        let mut child = std::process::Command::new("/bin/sleep")
            .arg("5")
            .spawn()
            .unwrap();
        let before = unsafe { libc::getpriority(libc::PRIO_PROCESS, child.id() as libc::id_t) };
        lower_priority(Some(child.id()));
        let after = unsafe { libc::getpriority(libc::PRIO_PROCESS, child.id() as libc::id_t) };
        assert_eq!(after, (before + AGENT_NICE).min(20));
        let _ = child.kill();
        let _ = child.wait();
    }
}
