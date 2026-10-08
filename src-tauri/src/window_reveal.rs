//! The main window opens hidden, already in its final appearance, and appears once the
//! front end has its first ready paint (ADR-098). A native fallback shows it anyway, so
//! a broken bundle never leaves an invisible app. Other windows are not involved.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;

use tauri::{AppHandle, Manager};

use crate::commands::AppState;
use crate::error::Result;

const MAIN: &str = "main";
/// How long after setup the window is shown even if the front end never signals.
pub const FALLBACK_AFTER: Duration = Duration::from_millis(2500);

/// The first of the ready signal and the fallback wins; the other only waits.
#[derive(Default)]
pub struct RevealOnce(AtomicBool);

impl RevealOnce {
    pub const fn new() -> Self {
        Self(AtomicBool::new(false))
    }

    /// True for exactly one caller.
    pub fn claim(&self) -> bool {
        !self.0.swap(true, Ordering::AcqRel)
    }
}

static REVEAL: RevealOnce = RevealOnce::new();

/// Shows the main window anyway after [`FALLBACK_AFTER`].
pub fn arm_fallback(app: &AppHandle) {
    let handle = app.clone();
    let spawned = std::thread::Builder::new()
        .name("window-reveal-fallback".into())
        .spawn(move || {
            std::thread::sleep(FALLBACK_AFTER);
            if REVEAL.claim() {
                tracing::info!("showing the main window before the front end signalled ready");
                show_main(&handle, None);
            }
        });
    // Without the timer, show at once rather than risk an invisible app.
    if spawned.is_err() && REVEAL.claim() {
        show_main(app, None);
    }
}

/// The first ready paint (src/lib/window-opening.ts): show the main window, then
/// resolve, so the web reveal starts on a visible window.
#[tauri::command]
pub async fn window_ready(window: tauri::WebviewWindow) -> Result<()> {
    if window.label() != MAIN {
        return Ok(());
    }
    if !REVEAL.claim() {
        return Ok(());
    }
    let (done, shown) = tokio::sync::oneshot::channel();
    show_main(window.app_handle(), Some(done));
    let _ = shown.await;
    Ok(())
}

/// Dock click or a second launch with nothing on screen: the window comes back even
/// if the launch reveal has not happened yet. Runs on the main thread.
pub fn reopen(app: &AppHandle) {
    REVEAL.claim();
    if let Some(window) = app.get_webview_window(MAIN) {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

fn show_main(app: &AppHandle, done: Option<tokio::sync::oneshot::Sender<()>>) {
    let handle = app.clone();
    let scheduled = app.run_on_main_thread(move || {
        let state = handle.try_state::<Arc<AppState>>();
        // The glass (or opaque background) is in place before the first frame.
        if let Some(state) = &state {
            crate::appearance::apply_now(&handle, state, false);
        }
        if let Some(window) = handle.get_webview_window(MAIN) {
            let _ = window.show();
            let _ = window.set_focus();
        }
        // Retries the private blur if the hidden window had no window number yet.
        if let Some(state) = &state {
            crate::appearance::apply_now(&handle, state, false);
        }
        if let Some(done) = done {
            let _ = done.send(());
        }
    });
    if let Err(error) = scheduled {
        tracing::warn!(%error, "cannot show the main window");
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_the_first_signal_reveals() {
        let once = RevealOnce::new();
        assert!(once.claim());
        assert!(!once.claim());
        assert!(!once.claim());
    }

    #[test]
    fn fallback_is_short_enough_to_never_strand_the_app() {
        assert!(FALLBACK_AFTER >= Duration::from_secs(1));
        assert!(FALLBACK_AFTER <= Duration::from_secs(3));
    }
}
