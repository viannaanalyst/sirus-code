//! Global window snap (ADR-054). An opt-in system-wide shortcut captures the
//! frontmost window of the app in front into one short-lived native capture.
//! The renderer is told the app name and claims the capture for the composer
//! it has open; nothing is sent. The renderer cannot name a window, app or
//! file, and a capture expires if nobody claims it.
use std::sync::Arc;
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, State};

use crate::attachments::PromptAttachment;
use crate::commands::AppState;
use crate::error::{Error, Result};
use crate::models::AppSettings;

/// A capture older than this is dropped instead of admitted.
const CLAIM_WINDOW: Duration = Duration::from_secs(60);
/// Longest side of the captured image, in pixels.
const MAX_SIDE: f64 = 1800.0;

struct Pending {
    nonce: String,
    app: String,
    at: Instant,
    jpeg: Vec<u8>,
}

static PENDING: parking_lot::Mutex<Option<Pending>> = parking_lot::const_mutex(None);

/// Event `window-snap`: what happened after the shortcut was pressed.
#[derive(Debug, Clone, Serialize)]
#[serde(
    tag = "status",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum SnapEvent {
    /// A capture is waiting to be claimed for the open composer.
    Ready { nonce: String, app: String },
    /// Screen Recording is not granted to Sirus Code.
    NeedsPermission,
    /// Sirus Code itself is in front; there is no other window to snap.
    OwnWindow,
    /// The window could not be captured.
    Failed,
}

#[derive(Debug, Deserialize)]
#[serde(
    tag = "type",
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum Action {
    /// Admits the pending capture into `owner`'s unsent draft.
    Claim { nonce: String, owner: String },
    /// Drops the pending capture.
    Discard { nonce: String },
}

/// Closed renderer surface: claim or drop the one pending capture.
#[tauri::command]
pub async fn window_snap_action(
    state: State<'_, Arc<AppState>>,
    action: Action,
) -> Result<Vec<PromptAttachment>> {
    let state = state.inner().clone();
    crate::commands::native_task(move || match action {
        Action::Discard { nonce } => {
            take(&nonce);
            Ok(Vec::new())
        }
        Action::Claim { nonce, owner } => {
            let pending = take(&nonce)
                .filter(|pending| pending.at.elapsed() <= CLAIM_WINDOW)
                .ok_or_else(|| Error::new("attachment", "That window snap has expired."))?;
            crate::attachments::admit_native_capture(
                &state,
                &owner,
                file_name(&pending.app),
                pending.jpeg,
            )
        }
    })
    .await
}

fn take(nonce: &str) -> Option<Pending> {
    let mut slot = PENDING.lock();
    if slot.as_ref().is_some_and(|pending| pending.nonce == nonce) {
        slot.take()
    } else {
        None
    }
}

/// `<App> window.jpg`, keeping only printable characters that are valid in a file name.
fn file_name(app: &str) -> String {
    let clean: String = app
        .chars()
        .filter(|ch| !ch.is_control() && !matches!(ch, '/' | '\\' | ':'))
        .take(60)
        .collect();
    let clean = clean.trim();
    if clean.is_empty() {
        "Window.jpg".into()
    } else {
        format!("{clean} window.jpg")
    }
}

fn publish(app: &AppHandle, event: SnapEvent) {
    let _ = app.emit("window-snap", event);
}

/// Registers or removes the shortcut to match settings. Call after load and save.
pub fn apply(app: &AppHandle, settings: &AppSettings) {
    platform::apply(
        app,
        settings.window_snap_enabled,
        settings.window_snap_shortcut,
    );
}

#[cfg(target_os = "macos")]
mod platform {
    use super::*;
    use crate::models::WindowSnapShortcut;
    use global_hotkey::hotkey::{Code, HotKey, Modifiers};
    use global_hotkey::{GlobalHotKeyEvent, GlobalHotKeyManager, HotKeyState};
    use objc2_app_kit::NSWorkspace;
    use objc2_core_foundation::{CFDictionary, CFNumber, CFRetained, CFType, CGRect};
    use objc2_core_graphics::{
        kCGWindowBounds, kCGWindowLayer, kCGWindowOwnerPID, CGRectMakeWithDictionaryRepresentation,
        CGWindowListCopyWindowInfo, CGWindowListOption,
    };
    use std::cell::RefCell;
    use std::ptr::NonNull;
    use std::sync::OnceLock;

    thread_local! {
        /// Main thread only: the Carbon-backed manager and the registered key.
        static REGISTERED: RefCell<Option<(GlobalHotKeyManager, Option<HotKey>)>> = const { RefCell::new(None) };
    }
    static HANDLE: OnceLock<AppHandle> = OnceLock::new();

    fn hotkey(shortcut: WindowSnapShortcut) -> HotKey {
        match shortcut {
            WindowSnapShortcut::ControlOptionCommandS => HotKey::new(
                Some(Modifiers::CONTROL | Modifiers::ALT | Modifiers::SUPER),
                Code::KeyS,
            ),
            WindowSnapShortcut::OptionShiftS => {
                HotKey::new(Some(Modifiers::ALT | Modifiers::SHIFT), Code::KeyS)
            }
            WindowSnapShortcut::ControlShiftS => {
                HotKey::new(Some(Modifiers::CONTROL | Modifiers::SHIFT), Code::KeyS)
            }
        }
    }

    pub fn apply(app: &AppHandle, enabled: bool, shortcut: WindowSnapShortcut) {
        if HANDLE.set(app.clone()).is_ok() {
            GlobalHotKeyEvent::set_event_handler(Some(|event: GlobalHotKeyEvent| {
                if event.state == HotKeyState::Pressed {
                    if let Some(app) = HANDLE.get() {
                        pressed(app.clone());
                    }
                }
            }));
        }
        let _ = app.run_on_main_thread(move || {
            REGISTERED.with(|cell| {
                let mut cell = cell.borrow_mut();
                if cell.is_none() {
                    match GlobalHotKeyManager::new() {
                        Ok(manager) => *cell = Some((manager, None)),
                        Err(_) => return,
                    }
                }
                let Some((manager, current)) = cell.as_mut() else {
                    return;
                };
                if let Some(key) = current.take() {
                    let _ = manager.unregister(key);
                }
                if enabled {
                    let key = hotkey(shortcut);
                    // Another app may already own the combination; then the shortcut stays off.
                    if manager.register(key).is_ok() {
                        *current = Some(key);
                    }
                }
            });
        });
    }

    /// Runs on the main thread (Carbon event); the capture itself runs on a worker.
    fn pressed(app: AppHandle) {
        let Some(front) = NSWorkspace::sharedWorkspace().frontmostApplication() else {
            return publish(&app, SnapEvent::Failed);
        };
        let pid = front.processIdentifier();
        if pid as u32 == std::process::id() {
            return publish(&app, SnapEvent::OwnWindow);
        }
        let name = front
            .localizedName()
            .map(|name| name.to_string())
            .unwrap_or_default();
        std::thread::spawn(move || {
            if !crate::computer::permissions().screen_recording {
                return publish(&app, SnapEvent::NeedsPermission);
            }
            let Some(frame) = front_window(pid) else {
                return publish(&app, SnapEvent::Failed);
            };
            match crate::computer::screenshot(pid, frame, MAX_SIDE) {
                Ok(image) => {
                    let nonce = uuid::Uuid::new_v4().to_string();
                    *PENDING.lock() = Some(Pending {
                        nonce: nonce.clone(),
                        app: name.clone(),
                        at: Instant::now(),
                        jpeg: image.jpeg,
                    });
                    publish(&app, SnapEvent::Ready { nonce, app: name });
                }
                Err(_) => publish(&app, SnapEvent::Failed),
            }
        });
    }

    /// Frame of the app's frontmost normal window: the window list is ordered front to back.
    fn front_window(pid: i32) -> Option<crate::computer::Frame> {
        let windows = CGWindowListCopyWindowInfo(
            CGWindowListOption::OptionOnScreenOnly | CGWindowListOption::ExcludeDesktopElements,
            0,
        )?;
        let number = |entry: &CFDictionary, key: &CFType| -> Option<i64> {
            let value = unsafe { entry.value(key as *const CFType as *const _) } as *mut CFType;
            let value = unsafe { CFRetained::retain(NonNull::new(value)?) };
            value.downcast::<CFNumber>().ok()?.as_i64()
        };
        (0..windows.count()).find_map(|index| {
            let entry = unsafe { windows.value_at_index(index) } as *mut CFType;
            let entry = unsafe { CFRetained::retain(NonNull::new(entry)?) }
                .downcast::<CFDictionary>()
                .ok()?;
            if number(&entry, unsafe { kCGWindowOwnerPID })? != pid as i64
                || number(&entry, unsafe { kCGWindowLayer })? != 0
            {
                return None;
            }
            let bounds =
                unsafe { entry.value(kCGWindowBounds as *const _ as *const _) } as *mut CFType;
            let bounds = unsafe { CFRetained::retain(NonNull::new(bounds)?) }
                .downcast::<CFDictionary>()
                .ok()?;
            let mut rect = CGRect::default();
            unsafe { CGRectMakeWithDictionaryRepresentation(Some(&bounds), &mut rect) }
                .then_some(())?;
            (rect.size.width >= 40.0 && rect.size.height >= 40.0).then_some(
                crate::computer::Frame {
                    x: rect.origin.x,
                    y: rect.origin.y,
                    width: rect.size.width,
                    height: rect.size.height,
                },
            )
        })
    }
}

#[cfg(not(target_os = "macos"))]
mod platform {
    use super::*;
    pub fn apply(_app: &AppHandle, _enabled: bool, _shortcut: crate::models::WindowSnapShortcut) {}
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn file_names_are_printable_and_bounded() {
        assert_eq!(file_name("Google Chrome"), "Google Chrome window.jpg");
        assert_eq!(file_name("a/b\\c:d\n"), "abcd window.jpg");
        assert_eq!(file_name("  "), "Window.jpg");
        assert!(file_name(&"x".repeat(500)).len() <= 80);
    }

    #[test]
    fn a_capture_is_taken_once_and_only_with_its_nonce() {
        *PENDING.lock() = Some(Pending {
            nonce: "n1".into(),
            app: "App".into(),
            at: Instant::now(),
            jpeg: vec![1],
        });
        assert!(take("other").is_none());
        assert!(take("n1").is_some());
        assert!(take("n1").is_none());
    }

    #[test]
    fn actions_are_closed() {
        assert!(serde_json::from_value::<Action>(
            serde_json::json!({"type":"claim","nonce":"n","owner":"session:s"})
        )
        .is_ok());
        assert!(serde_json::from_value::<Action>(
            serde_json::json!({"type":"claim","nonce":"n","owner":"o","path":"/x"})
        )
        .is_err());
        assert!(serde_json::from_value::<Action>(serde_json::json!({"type":"capture"})).is_err());
    }
}
