//! The main window opens hidden, gets its final appearance, and appears at launch;
//! the front end then reveals its content on the first ready paint (ADR-098). A native fallback shows it anyway, so
//! a broken bundle never leaves an invisible app. Other windows are not involved.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use tauri::{AppHandle, Manager};

use crate::commands::AppState;
use crate::error::Result;

const MAIN: &str = "main";

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

/// Shows the main window as soon as the app starts, already in its glass look (applied
/// in `show_main` before the first frame), so a click opens a translucent window with the
/// logo at once; the content then reveals on the first ready paint (2026-10-08: waiting
/// for that paint, a slow start left the window hidden and then opaque black).
pub fn show_at_launch(app: &AppHandle) {
    if REVEAL.claim() {
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
}
