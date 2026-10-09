//! Fixed native picker/clipboard operations. No caller-selected filesystem path.
use crate::error::{Error, Result};
use std::path::PathBuf;
pub enum ClipboardFile {
    Path(PathBuf),
    Bytes(String, Vec<u8>),
    /// Raw clipboard TIFF, converted to PNG by [`tiff_to_png`] off the AppKit main thread.
    #[cfg_attr(not(target_os = "macos"), allow(dead_code))]
    Tiff(Vec<u8>),
}

/// Decodes clipboard TIFF and re-encodes it as PNG. Runs on a blocking worker, never
/// on the main thread: large screenshots take long enough to stall the UI.
#[cfg(target_os = "macos")]
pub fn tiff_to_png(tiff: &[u8]) -> Result<Vec<u8>> {
    use objc2_app_kit::{NSBitmapImageFileType, NSBitmapImageRep};
    use objc2_foundation::{NSData, NSDictionary};
    objc2::rc::autoreleasepool(|_| {
        let data = NSData::with_bytes(tiff);
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
        Ok(png.to_vec())
    })
}
#[cfg(not(target_os = "macos"))]
pub fn tiff_to_png(_tiff: &[u8]) -> Result<Vec<u8>> {
    Err(Error::new("attachment", "Cannot read clipboard image."))
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
            NSPasteboard, NSPasteboardTypeFileURL, NSPasteboardTypePNG, NSPasteboardTypeString,
            NSPasteboardTypeTIFF,
        };
        let board = NSPasteboard::generalPasteboard();
        if !state.attachments.take_paste(board.changeCount()) {
            return Ok(Vec::new());
        }
        let mut paths = Vec::new();
        if let Some(items) = board.pasteboardItems() {
            for item in items.iter().take(9) {
                // Framework globals are immutable. URLs must be local file URLs.
                if let Some(value) = item.stringForType(unsafe { NSPasteboardTypeFileURL }) {
                    if let Some(path) = pasted_file_path(&value.to_string()) {
                        paths.push(ClipboardFile::Path(path));
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
            // Only copy the bytes out here; decoding and PNG encoding run off the main thread.
            return Ok(vec![ClipboardFile::Tiff(data.to_vec())]);
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
#[cfg(not(target_os = "macos"))]
pub async fn paste(
    _app: &tauri::AppHandle,
    _state: std::sync::Arc<crate::commands::AppState>,
    _expected_text: Option<String>,
) -> Result<Vec<ClipboardFile>> {
    Ok(Vec::new())
}

/// A pasted file URL as the file's current path. Finder copies file reference URLs
/// (`file:///.file/id=…`); they resolve to where the file is now, so a file renamed after
/// copying still attaches. Only local file URLs are accepted, before anything is resolved.
#[cfg(target_os = "macos")]
fn pasted_file_path(value: &str) -> Option<PathBuf> {
    use objc2_foundation::{NSString, NSURL};
    let url = NSURL::URLWithString(&NSString::from_str(value))?;
    let host = url.host().map(|host| host.to_string()).unwrap_or_default();
    if !url.isFileURL() || !(host.is_empty() || host == "localhost") {
        return None;
    }
    let resolved = if url.isFileReferenceURL() {
        url.filePathURL()?
    } else {
        url
    };
    resolved.path().map(|path| PathBuf::from(path.to_string()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[cfg(target_os = "macos")]
    #[test]
    fn finder_file_references_resolve_to_the_current_path_and_remote_hosts_are_refused() {
        use objc2_foundation::{NSString, NSURL};
        let dir = std::env::temp_dir().join(format!("sirus-paste-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let first = dir.join("copied.png");
        std::fs::write(&first, b"x").unwrap();
        let url = NSURL::fileURLWithPath(&NSString::from_str(&first.to_string_lossy()));
        let reference = url
            .fileReferenceURL()
            .unwrap()
            .absoluteString()
            .unwrap()
            .to_string();
        assert!(reference.starts_with("file:///.file/id="), "{reference}");
        let renamed = dir.join("renamed.png");
        std::fs::rename(&first, &renamed).unwrap();
        let resolved = pasted_file_path(&reference).unwrap();
        assert_eq!(
            resolved.canonicalize().unwrap(),
            renamed.canonicalize().unwrap()
        );
        assert_eq!(
            pasted_file_path(&url.absoluteString().unwrap().to_string())
                .unwrap()
                .file_name()
                .unwrap(),
            "copied.png"
        );
        assert!(pasted_file_path("file://evil.example/etc/passwd").is_none());
        assert!(pasted_file_path("https://example.com/a.png").is_none());
        let _ = std::fs::remove_dir_all(dir);
    }
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
