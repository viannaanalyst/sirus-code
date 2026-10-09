//! Keeps the Mac from idle-sleeping while any agent turn runs (ADR-100).
//!
//! Each running turn holds a `Hold`; the first one takes an IOKit
//! `PreventUserIdleSystemSleep` assertion and the last one to drop releases
//! it. The display may still sleep and lock. Quit releases it too (the system
//! also drops a process's assertions when it exits). Independent of the
//! `caffeinate` that remote access keeps for paired phones (`remote.rs`).

use parking_lot::Mutex;

/// The system-level resource: taken when the first turn starts, released when the last ends.
trait Assertion {
    fn take(&mut self) -> bool;
    fn release(&mut self);
}

struct Counter<A: Assertion> {
    holds: usize,
    held: bool,
    closed: bool,
    assertion: A,
}

impl<A: Assertion> Counter<A> {
    const fn new(assertion: A) -> Self {
        Self {
            holds: 0,
            held: false,
            closed: false,
            assertion,
        }
    }

    fn acquire(&mut self) {
        self.holds += 1;
        if !self.held && !self.closed {
            self.held = self.assertion.take();
        }
    }

    fn drop_one(&mut self) {
        self.holds = self.holds.saturating_sub(1);
        if self.holds == 0 && self.held {
            self.assertion.release();
            self.held = false;
        }
    }

    fn close(&mut self) {
        self.closed = true;
        if self.held {
            self.assertion.release();
            self.held = false;
        }
    }
}

#[cfg(target_os = "macos")]
mod platform {
    use objc2_core_foundation::CFString;

    #[link(name = "IOKit", kind = "framework")]
    extern "C" {
        fn IOPMAssertionCreateWithName(
            assertion_type: *const CFString,
            level: u32,
            name: *const CFString,
            id: *mut u32,
        ) -> i32;
        fn IOPMAssertionRelease(id: u32) -> i32;
    }

    const LEVEL_ON: u32 = 255;

    pub struct Power(Option<u32>);

    impl Power {
        pub const fn new() -> Self {
            Self(None)
        }
    }

    impl super::Assertion for Power {
        fn take(&mut self) -> bool {
            let kind = CFString::from_str("PreventUserIdleSystemSleep");
            let name = CFString::from_str("Sirus Code agent turn running");
            let mut id = 0u32;
            let result = unsafe { IOPMAssertionCreateWithName(&*kind, LEVEL_ON, &*name, &mut id) };
            if result != 0 {
                tracing::warn!(result, "cannot keep the Mac awake for a running agent");
                return false;
            }
            self.0 = Some(id);
            true
        }

        fn release(&mut self) {
            if let Some(id) = self.0.take() {
                unsafe {
                    IOPMAssertionRelease(id);
                }
            }
        }
    }
}

#[cfg(not(target_os = "macos"))]
mod platform {
    pub struct Power;

    impl Power {
        pub const fn new() -> Self {
            Self
        }
    }

    impl super::Assertion for Power {
        fn take(&mut self) -> bool {
            false
        }
        fn release(&mut self) {}
    }
}

static COUNTER: Mutex<Counter<platform::Power>> = Mutex::new(Counter::new(platform::Power::new()));

/// Held for the life of one agent turn.
#[must_use]
pub struct Hold(());

impl Drop for Hold {
    fn drop(&mut self) {
        COUNTER.lock().drop_one();
    }
}

/// Starts keeping the Mac awake (if not already) until the returned hold drops.
pub fn hold() -> Hold {
    COUNTER.lock().acquire();
    Hold(())
}

/// App quit: release the assertion now; later holds no longer take one.
pub fn release_all() {
    COUNTER.lock().close();
}

#[cfg(test)]
mod tests {
    use super::*;

    #[derive(Default)]
    struct Fake {
        taken: usize,
        released: usize,
    }

    impl Assertion for Fake {
        fn take(&mut self) -> bool {
            self.taken += 1;
            true
        }
        fn release(&mut self) {
            self.released += 1;
        }
    }

    #[test]
    fn one_assertion_spans_overlapping_turns() {
        let mut counter = Counter::new(Fake::default());
        counter.acquire();
        counter.acquire();
        assert_eq!(counter.assertion.taken, 1);
        counter.drop_one();
        assert_eq!(counter.assertion.released, 0, "one turn still runs");
        counter.drop_one();
        assert_eq!(counter.assertion.released, 1);
        counter.acquire();
        assert_eq!(counter.assertion.taken, 2, "a new turn takes it again");
        counter.drop_one();
        assert_eq!(counter.assertion.released, 2);
    }

    #[test]
    fn quit_releases_and_stops_taking() {
        let mut counter = Counter::new(Fake::default());
        counter.acquire();
        counter.close();
        assert_eq!(counter.assertion.released, 1);
        counter.acquire();
        counter.drop_one();
        counter.drop_one();
        assert_eq!(counter.assertion.taken, 1);
        assert_eq!(counter.assertion.released, 1);
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn the_power_assertion_is_taken_and_released() {
        let mut power = platform::Power::new();
        assert!(power.take());
        power.release();
        power.release();
    }
}
