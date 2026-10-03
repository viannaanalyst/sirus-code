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
#[cfg(test)]
mod tests {
    use super::*;
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
