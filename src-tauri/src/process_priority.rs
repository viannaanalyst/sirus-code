//! Agents and the app's own background work run below the person (ADR-143). Provider CLIs,
//! and every tool, compiler or test run they start (children inherit it), get a nice value of
//! at least 10 and, on macOS, throttled disk I/O, so a heavy build inside a conversation
//! cannot make the app or the Mac stutter. Git that Sirus runs by itself (status polling,
//! diff stats, the automatic pull) runs the same way inside a [`background`] scope; Git the
//! person asks for (commit, push, checkout) and the person's terminals keep normal priority.

use std::cell::Cell;
use std::process::Command;

/// Lowers the process `command` will start: nice at least 10 and, on macOS, throttled
/// disk I/O. Best effort: a refused hint never stops the launch. No-op off unix.
pub(crate) fn lower(command: &mut Command) {
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        // SAFETY: runs in the forked child before exec; it only makes system calls
        // (no allocation, no locks), which is what async-signal safety requires.
        unsafe {
            command.pre_exec(|| {
                let current = libc::getpriority(libc::PRIO_PROCESS, 0);
                libc::setpriority(libc::PRIO_PROCESS, 0, current.max(NICE));
                #[cfg(target_os = "macos")]
                setiopolicy_np(IOPOL_TYPE_DISK, IOPOL_SCOPE_PROCESS, IOPOL_THROTTLE);
                Ok(())
            });
        }
    }
    #[cfg(not(unix))]
    let _ = command;
}

/// [`lower`] for a Tokio command.
pub(crate) fn lower_async(command: &mut tokio::process::Command) {
    lower(command.as_std_mut());
}

thread_local! {
    static BACKGROUND: Cell<bool> = const { Cell::new(false) };
}

/// Runs `work` as background work of the app: commands built with [`lower_in_background`]
/// on this thread meanwhile start lowered.
pub(crate) fn background<R>(work: impl FnOnce() -> R) -> R {
    struct Restore(bool);
    impl Drop for Restore {
        fn drop(&mut self) {
            BACKGROUND.with(|flag| flag.set(self.0));
        }
    }
    let _restore = Restore(BACKGROUND.with(|flag| flag.replace(true)));
    work()
}

/// Lowers `command` when it is built inside a [`background`] scope.
pub(crate) fn lower_in_background(command: &mut Command) {
    if BACKGROUND.with(Cell::get) {
        lower(command);
    }
}

#[cfg(unix)]
const NICE: libc::c_int = 10;

#[cfg(target_os = "macos")]
const IOPOL_TYPE_DISK: libc::c_int = 0;
#[cfg(target_os = "macos")]
const IOPOL_SCOPE_PROCESS: libc::c_int = 0;
#[cfg(target_os = "macos")]
const IOPOL_THROTTLE: libc::c_int = 3;

#[cfg(target_os = "macos")]
unsafe extern "C" {
    fn setiopolicy_np(kind: libc::c_int, scope: libc::c_int, policy: libc::c_int) -> libc::c_int;
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;

    fn nice_seen_by_child(command: &mut Command) -> i32 {
        let output = command
            .args(["-c", "ps -o nice= -p $$"])
            .output()
            .expect("sh runs");
        assert!(output.status.success());
        String::from_utf8_lossy(&output.stdout)
            .trim()
            .parse()
            .expect("a nice value")
    }

    #[test]
    fn a_lowered_child_and_its_children_run_at_nice_ten() {
        let mut command = Command::new("/bin/sh");
        lower(&mut command);
        assert!(nice_seen_by_child(&mut command) >= 10);
        // A grandchild (what an agent's tool run is) inherits it.
        let mut command = Command::new("/bin/sh");
        lower(&mut command);
        let output = command
            .args(["-c", "/bin/sh -c 'ps -o nice= -p $$'"])
            .output()
            .unwrap();
        let nice: i32 = String::from_utf8_lossy(&output.stdout)
            .trim()
            .parse()
            .unwrap();
        assert!(nice >= 10);
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn a_lowered_child_has_throttled_disk_io() {
        // The probe binary is this test executable: getiopolicy_np is not reachable from sh.
        if std::env::var("SIRUS_IOPOLICY_PROBE").is_ok() {
            return;
        }
        unsafe extern "C" {
            fn getiopolicy_np(kind: libc::c_int, scope: libc::c_int) -> libc::c_int;
        }
        // The test may itself run under a lowered agent (inheriting the throttle): compare with
        // its own policy before the spawn rather than with a fixed value.
        let before = unsafe { getiopolicy_np(IOPOL_TYPE_DISK, IOPOL_SCOPE_PROCESS) };
        let mut command = Command::new(std::env::current_exe().unwrap());
        command
            .args([
                "--exact",
                "process_priority::tests::iopolicy_probe",
                "--nocapture",
            ])
            .env("SIRUS_IOPOLICY_PROBE", "1");
        lower(&mut command);
        let output = command.output().unwrap();
        assert!(
            String::from_utf8_lossy(&output.stdout).contains(&format!("iopolicy={IOPOL_THROTTLE}")),
            "{}",
            String::from_utf8_lossy(&output.stdout)
        );
        // This test process itself is untouched.
        assert_eq!(
            unsafe { getiopolicy_np(IOPOL_TYPE_DISK, IOPOL_SCOPE_PROCESS) },
            before
        );
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn iopolicy_probe() {
        if std::env::var("SIRUS_IOPOLICY_PROBE").is_err() {
            return;
        }
        unsafe extern "C" {
            fn getiopolicy_np(kind: libc::c_int, scope: libc::c_int) -> libc::c_int;
        }
        let policy = unsafe { getiopolicy_np(IOPOL_TYPE_DISK, IOPOL_SCOPE_PROCESS) };
        println!("iopolicy={policy}");
    }

    #[test]
    fn only_commands_built_in_a_background_scope_are_lowered() {
        let mut normal = Command::new("/bin/sh");
        lower_in_background(&mut normal);
        let own = unsafe { libc::getpriority(libc::PRIO_PROCESS, 0) };
        assert_eq!(nice_seen_by_child(&mut normal), own);
        let mut scoped = background(|| {
            let mut command = Command::new("/bin/sh");
            lower_in_background(&mut command);
            command
        });
        assert!(nice_seen_by_child(&mut scoped) >= 10);
        // The scope ends with the closure.
        let mut after = Command::new("/bin/sh");
        lower_in_background(&mut after);
        assert_eq!(nice_seen_by_child(&mut after), own);
    }
}
