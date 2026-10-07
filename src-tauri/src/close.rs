#[derive(Default)]
pub struct CloseGuard {
    authorized: bool,
    pending: bool,
}
#[derive(Debug, PartialEq, Eq)]
pub enum Decision {
    Allow,
    Ask,
    Pending,
}
impl CloseGuard {
    pub fn request(&mut self, confirm: bool, agents: bool, starting: bool) -> Decision {
        if self.authorized {
            return Decision::Allow;
        }
        if self.pending {
            return Decision::Pending;
        }
        if confirm && (agents || starting) {
            self.pending = true;
            Decision::Ask
        } else {
            self.authorized = true;
            Decision::Allow
        }
    }
    pub fn answer(&mut self, accepted: bool) {
        self.pending = false;
        self.authorized = accepted;
    }
}
/// ⌘Q asks for a second press within this window before quitting (ADR-090).
pub const QUIT_WINDOW: std::time::Duration = std::time::Duration::from_secs(2);
static LAST_QUIT_PRESS: std::sync::Mutex<Option<std::time::Instant>> = std::sync::Mutex::new(None);

/// Whether a ⌘Q press is the confirming second one.
pub fn second_press(last: Option<std::time::Instant>, now: std::time::Instant) -> bool {
    last.is_some_and(|last| now.saturating_duration_since(last) <= QUIT_WINDOW)
}

/// ⌘Q (ADR-090): with agents running, quitting goes straight to the running-agents
/// dialog; otherwise the first press shows "Press ⌘Q again to quit" and a second press
/// within two seconds quits. Returns whether to quit now.
pub fn quit_pressed(app: &tauri::AppHandle) -> bool {
    use std::sync::Arc;
    use tauri::{Emitter, Manager};
    let state = app.state::<Arc<crate::commands::AppState>>();
    let busy = {
        let data = state.data.lock();
        data.settings.confirm_close_running
            && (!state.agents.lock().is_empty()
                || data
                    .sessions
                    .iter()
                    .any(|session| session.status == crate::models::SessionStatus::Starting))
    };
    if busy {
        return true;
    }
    let now = std::time::Instant::now();
    let mut last = LAST_QUIT_PRESS
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    if second_press(*last, now) {
        *last = None;
        return true;
    }
    *last = Some(now);
    let _ = app.emit("quit-armed", QUIT_WINDOW.as_millis() as u64);
    false
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn quitting_needs_a_second_press_within_the_window() {
        let start = std::time::Instant::now();
        assert!(!second_press(None, start));
        assert!(second_press(
            Some(start),
            start + std::time::Duration::from_millis(1500)
        ));
        assert!(!second_press(
            Some(start),
            start + std::time::Duration::from_millis(2500)
        ));
    }
    #[test]
    fn running_and_spawn_admission_require_one_dialog() {
        for (agents, starting) in [(true, false), (false, true)] {
            let mut guard = CloseGuard::default();
            assert_eq!(guard.request(true, agents, starting), Decision::Ask);
            assert_eq!(guard.request(true, agents, starting), Decision::Pending);
            guard.answer(false);
            assert_eq!(guard.request(true, agents, starting), Decision::Ask);
            guard.answer(true);
            assert_eq!(guard.request(true, agents, starting), Decision::Allow);
            assert_eq!(guard.request(true, agents, starting), Decision::Allow);
        }
    }
    #[test]
    fn settled_or_disabled_confirmation_exits_normally() {
        assert_eq!(
            CloseGuard::default().request(true, false, false),
            Decision::Allow
        );
        assert_eq!(
            CloseGuard::default().request(false, true, true),
            Decision::Allow
        );
    }
}
