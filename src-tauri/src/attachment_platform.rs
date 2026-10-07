//! Fixed native picker/clipboard operations. No caller-selected filesystem path.
use crate::error::{Error, Result};
use std::path::PathBuf;
pub enum ClipboardFile {
    Path(PathBuf),
    Bytes(String, Vec<u8>),
}

#[cfg(target_os = "macos")]
async fn main_thread<T: Send + 'static>(
    app: &tauri::AppHandle,
    action: impl FnOnce() -> Result<T> + Send + 'static,
) -> Result<T> {
    let (sender, receiver) = tokio::sync::oneshot::channel();
    app.run_on_main_thread(move || {
        let _ = sender.send(action());
    })
    .map_err(|_| Error::new("attachment", "Could not open native attachment control."))?;
    receiver
        .await
        .map_err(|_| Error::new("attachment", "Native attachment control closed."))?
}
#[cfg(target_os = "macos")]
pub async fn pick(app: &tauri::AppHandle, folder: Option<bool>) -> Result<Vec<PathBuf>> {
    main_thread(app, move || {
        use objc2::MainThreadMarker;
        use objc2_app_kit::NSOpenPanel;
        let marker = MainThreadMarker::new()
            .ok_or_else(|| Error::new("attachment", "File picker requires the main thread."))?;
        let panel = NSOpenPanel::openPanel(marker);
        panel.setCanChooseFiles(folder != Some(true));
        panel.setCanChooseDirectories(folder != Some(false));
        panel.setAllowsMultipleSelection(true);
        panel.setResolvesAliases(false);
        panel.setTreatsFilePackagesAsDirectories(false);
        if panel.runModal() != 1 {
            return Ok(Vec::new());
        }
        let urls = panel.URLs();
        if urls.len() > 8 {
            return Err(Error::new(
                "attachment",
                "Select at most 8 attachments at a time.",
            ));
        }
        urls.iter()
            .map(|url| {
                if !url.isFileURL() {
                    return Err(Error::invalid_path("Only local attachments are supported."));
                }
                url.path()
                    .map(|path| PathBuf::from(path.to_string()))
                    .ok_or_else(|| Error::invalid_path("Invalid selected file."))
            })
            .collect()
    })
    .await
}
#[cfg(not(target_os = "macos"))]
pub async fn pick(app: &tauri::AppHandle, folder: Option<bool>) -> Result<Vec<PathBuf>> {
    use tauri_plugin_dialog::DialogExt;
    let (tx, rx) = tokio::sync::oneshot::channel();
    if folder == Some(true) {
        app.dialog().file().pick_folder(move |path| {
            let _ = tx.send(path.map(|p| vec![p]));
        });
    } else {
        app.dialog().file().pick_files(move |paths| {
            let _ = tx.send(paths);
        });
    }
    rx.await
        .map_err(|_| Error::new("attachment", "File picker could not be opened."))?
        .unwrap_or_default()
        .into_iter()
        .map(|path| {
            path.into_path()
                .map_err(|_| Error::invalid_path("Only local attachments are supported."))
        })
        .collect()
}
/// Text paths are admitted only when the current native clipboard equals the pasted text.
/// This is not a filesystem resolver for renderer strings.
fn clipboard_path(text: &str) -> Option<PathBuf> {
    if text.len() > 8192 || text.contains(['\n', '\r', '\0']) {
        return None;
    }
    let text = text.trim().trim_matches('"').trim_matches('\'');
    if text.starts_with("file://") {
        return reqwest::Url::parse(text).ok()?.to_file_path().ok();
    }
    text.starts_with('/').then(|| PathBuf::from(text))
}
#[cfg(target_os = "macos")]
pub async fn paste(
    app: &tauri::AppHandle,
    state: std::sync::Arc<crate::commands::AppState>,
    expected_text: Option<String>,
) -> Result<Vec<ClipboardFile>> {
    main_thread(app, move || {
        use objc2_app_kit::{
            NSBitmapImageFileType, NSBitmapImageRep, NSPasteboard, NSPasteboardTypeFileURL,
            NSPasteboardTypePNG, NSPasteboardTypeString, NSPasteboardTypeTIFF,
        };
        use objc2_foundation::{NSDictionary, NSURL};
        let board = NSPasteboard::generalPasteboard();
        if !state.attachments.take_paste(board.changeCount()) {
            return Ok(Vec::new());
        }
        let mut paths = Vec::new();
        if let Some(items) = board.pasteboardItems() {
            for item in items.iter().take(9) {
                // Framework globals are immutable. URLs must be local file URLs.
                if let Some(value) = item.stringForType(unsafe { NSPasteboardTypeFileURL }) {
                    if let Some(url) = NSURL::URLWithString(&value).filter(|url| url.isFileURL()) {
                        if let Some(path) = url.path() {
                            paths.push(ClipboardFile::Path(PathBuf::from(path.to_string())));
                        }
                    }
                }
            }
        }
        if paths.len() > 8 {
            return Err(Error::new(
                "attachment",
                "Select at most 8 attachments at a time.",
            ));
        }
        if !paths.is_empty() {
            return Ok(paths);
        }
        if let Some(data) = board.dataForType(unsafe { NSPasteboardTypePNG }) {
            if data.length() > crate::attachments::MAX_FILE_BYTES {
                return Err(Error::new(
                    "attachment",
                    "Each attachment must be at most 10 MiB.",
                ));
            }
            return Ok(vec![ClipboardFile::Bytes(
                "Clipboard.png".into(),
                data.to_vec(),
            )]);
        }
        if let Some(data) = board.dataForType(unsafe { NSPasteboardTypeTIFF }) {
            if data.length() > crate::attachments::MAX_FILE_BYTES {
                return Err(Error::new(
                    "attachment",
                    "Each attachment must be at most 10 MiB.",
                ));
            }
            let image = NSBitmapImageRep::imageRepWithData(&data)
                .ok_or_else(|| Error::new("attachment", "Cannot read clipboard image."))?;
            if image.pixelsWide() > 8192
                || image.pixelsHigh() > 8192
                || image.pixelsWide() * image.pixelsHigh() > 32_000_000
            {
                return Err(Error::new("attachment", "Clipboard image is too large."));
            }
            // Empty properties dictionary has no values with incorrect Objective-C types.
            let png = unsafe {
                image.representationUsingType_properties(
                    NSBitmapImageFileType::PNG,
                    &NSDictionary::new(),
                )
            }
            .ok_or_else(|| Error::new("attachment", "Cannot prepare clipboard image."))?;
            if png.length() > crate::attachments::MAX_FILE_BYTES {
                return Err(Error::new(
                    "attachment",
                    "Each attachment must be at most 10 MiB.",
                ));
            }
            return Ok(vec![ClipboardFile::Bytes(
                "Clipboard.png".into(),
                png.to_vec(),
            )]);
        }
        if let (Some(expected), Some(actual)) = (
            expected_text,
            board.stringForType(unsafe { NSPasteboardTypeString }),
        ) {
            if expected == actual.to_string() {
                if let Some(path) = clipboard_path(&expected).filter(|p| p.is_file() || p.is_dir())
                {
                    return Ok(vec![ClipboardFile::Path(path)]);
                }
            }
        }
        Ok(Vec::new())
    })
    .await
}
/// Local file and folder URLs of the last drag (Finder → composer), read once per drag.
#[cfg(target_os = "macos")]
pub async fn dropped(
    app: &tauri::AppHandle,
    state: std::sync::Arc<crate::commands::AppState>,
) -> Result<Vec<PathBuf>> {
    main_thread(app, move || {
        use objc2_app_kit::{NSPasteboard, NSPasteboardNameDrag, NSPasteboardTypeFileURL};
        use objc2_foundation::NSURL;
        let board = NSPasteboard::pasteboardWithName(unsafe { NSPasteboardNameDrag });
        if !state.attachments.take_drop(board.changeCount()) {
            return Ok(Vec::new());
        }
        let mut paths = Vec::new();
        if let Some(items) = board.pasteboardItems() {
            for item in items.iter().take(9) {
                if let Some(value) = item.stringForType(unsafe { NSPasteboardTypeFileURL }) {
                    if let Some(url) = NSURL::URLWithString(&value).filter(|url| url.isFileURL()) {
                        if let Some(path) = url.path() {
                            paths.push(PathBuf::from(path.to_string()));
                        }
                    }
                }
            }
        }
        if paths.len() > 8 {
            return Err(Error::new(
                "attachment",
                "Select at most 8 attachments at a time.",
            ));
        }
        Ok(paths)
    })
    .await
}
#[cfg(not(target_os = "macos"))]
pub async fn dropped(
    _app: &tauri::AppHandle,
    _state: std::sync::Arc<crate::commands::AppState>,
) -> Result<Vec<PathBuf>> {
    Ok(Vec::new())
}
#[cfg(not(target_os = "macos"))]
pub async fn paste(
    _app: &tauri::AppHandle,
    _state: std::sync::Arc<crate::commands::AppState>,
    _expected_text: Option<String>,
) -> Result<Vec<ClipboardFile>> {
    Ok(Vec::new())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn clipboard_paths_are_single_local_values_not_remote_or_multiline() {
        assert_eq!(
            clipboard_path("\"/tmp/a b.png\""),
            Some(PathBuf::from("/tmp/a b.png"))
        );
        assert_eq!(
            clipboard_path("file:///tmp/a%20b.csv"),
            Some(PathBuf::from("/tmp/a b.csv"))
        );
        for text in [
            "https://example.com/file",
            "relative.png",
            "/tmp/a\n/tmp/b",
            "/tmp/\0",
        ] {
            assert!(clipboard_path(text).is_none());
        }
    }
}

#[cfg(target_os = "macos")]
thread_local! { static PASTE_MONITOR: std::cell::RefCell<Option<objc2::rc::Retained<objc2::runtime::AnyObject>>> = const { std::cell::RefCell::new(None) }; }
/// Observe only this app's native Command-V event. A compromised renderer cannot
/// manufacture a native clipboard read by writing a path to its own clipboard.
#[cfg(target_os = "macos")]
pub fn install_paste_listener(
    _app: &tauri::AppHandle,
    state: std::sync::Arc<crate::commands::AppState>,
) {
    use objc2_app_kit::{NSEvent, NSEventMask, NSEventModifierFlags, NSPasteboard};
    let block = block2::RcBlock::new(move |pointer: std::ptr::NonNull<NSEvent>| {
        // AppKit supplies a live event; return the same pointer, without swallowing keys.
        let event = unsafe { pointer.as_ref() };
        if event
            .modifierFlags()
            .contains(NSEventModifierFlags::Command)
            && !event
                .modifierFlags()
                .intersects(NSEventModifierFlags::Option | NSEventModifierFlags::Control)
            && event
                .charactersIgnoringModifiers()
                .is_some_and(|value| value.to_string().eq_ignore_ascii_case("v"))
            && !event.isARepeat()
        {
            state
                .attachments
                .admit_paste(NSPasteboard::generalPasteboard().changeCount());
        }
        pointer.as_ptr()
    });
    let monitor = unsafe {
        NSEvent::addLocalMonitorForEventsMatchingMask_handler(NSEventMask::KeyDown, &block)
    };
    PASTE_MONITOR.with(|slot| *slot.borrow_mut() = monitor);
}
#[cfg(target_os = "macos")]
pub fn remove_paste_listener() {
    PASTE_MONITOR.with(|slot| {
        if let Some(monitor) = slot.borrow_mut().take() {
            unsafe { objc2_app_kit::NSEvent::removeMonitor(&monitor) };
        }
    });
}
#[cfg(not(target_os = "macos"))]
pub fn install_paste_listener(
    _app: &tauri::AppHandle,
    _state: std::sync::Arc<crate::commands::AppState>,
) {
}
#[cfg(not(target_os = "macos"))]
pub fn remove_paste_listener() {}
