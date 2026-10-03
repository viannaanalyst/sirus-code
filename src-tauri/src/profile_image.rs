//! One bounded outgoing image, native-picked destination, and fixed social composers.
use crate::error::{Error, Result};
use base64::Engine;
use serde::{Deserialize, Serialize};
use std::io::Write;
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc,
};

const MAX_PNG: usize = 4 * 1024 * 1024;
static BUSY: AtomicBool = AtomicBool::new(false);
struct ExportGuard;
impl Drop for ExportGuard {
    fn drop(&mut self) {
        BUSY.store(false, Ordering::Release);
    }
}
#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ProfileImageAction {
    Copy,
    Save,
    X,
    Linkedin,
    Reddit,
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum ProfileImageResult {
    Copied,
    Saved,
    Cancelled,
    ComposerOpened,
}

fn validate_png(bytes: &[u8]) -> Result<()> {
    let invalid = || Error::new("profile", "Invalid activity image.");
    if bytes.len() > MAX_PNG || bytes.len() < 45 || !bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
        return Err(invalid());
    }
    let mut at = 8;
    let mut header = false;
    let mut pixels = false;
    while at + 12 <= bytes.len() {
        let length = u32::from_be_bytes(bytes[at..at + 4].try_into().unwrap()) as usize;
        let end = at
            .checked_add(length)
            .and_then(|n| n.checked_add(12))
            .filter(|end| *end <= bytes.len())
            .ok_or_else(invalid)?;
        let kind = &bytes[at + 4..at + 8];
        let expected_crc = u32::from_be_bytes(bytes[end - 4..end].try_into().unwrap());
        if crc32fast::hash(&bytes[at + 4..end - 4]) != expected_crc {
            return Err(invalid());
        }
        if !header && kind != b"IHDR" {
            return Err(invalid());
        }
        match kind {
            b"IHDR" => {
                if header || length != 13 {
                    return Err(invalid());
                }
                let w = u32::from_be_bytes(bytes[at + 8..at + 12].try_into().unwrap());
                let h = u32::from_be_bytes(bytes[at + 12..at + 16].try_into().unwrap());
                if w == 0
                    || h == 0
                    || w > 2048
                    || h > 2048
                    || bytes[at + 16] != 8
                    || ![2, 6].contains(&bytes[at + 17])
                    || bytes[at + 18..at + 21] != [0, 0, 0]
                {
                    return Err(invalid());
                }
                header = true;
            }
            b"IDAT" => {
                pixels |= length > 0;
            }
            b"IEND" => {
                return if length == 0 && pixels && end == bytes.len() {
                    let mut reader = image::ImageReader::with_format(
                        std::io::Cursor::new(bytes),
                        image::ImageFormat::Png,
                    );
                    let mut limits = image::Limits::default();
                    limits.max_image_width = Some(2048);
                    limits.max_image_height = Some(2048);
                    limits.max_alloc = Some(32 * 1024 * 1024);
                    reader.limits(limits);
                    reader.decode().map(|_| ()).map_err(|_| invalid())
                } else {
                    Err(invalid())
                };
            }
            b"acTL" | b"fcTL" | b"fdAT" => {
                return Err(invalid());
            } // no animated image payloads
            _ => {}
        }
        at = end;
    }
    Err(invalid())
}
fn decode(data: &str) -> Result<Vec<u8>> {
    if data.len() > MAX_PNG * 4 / 3 + 4 {
        return Err(Error::new("profile", "Activity image is too large."));
    }
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(data)
        .map_err(|_| Error::new("profile", "Invalid activity image."))?;
    validate_png(&bytes)?;
    Ok(bytes)
}
fn save_picked(path: &std::path::Path, bytes: &[u8]) -> Result<()> {
    if !path.is_absolute()
        || !path
            .extension()
            .is_some_and(|ext| ext.eq_ignore_ascii_case("png"))
    {
        return Err(Error::new("profile", "Choose a PNG destination."));
    }
    let previous = match std::fs::symlink_metadata(path) {
        Ok(meta) if meta.is_file() && !meta.file_type().is_symlink() => Some(meta),
        Ok(_) => {
            return Err(Error::new(
                "profile",
                "Choose a regular PNG file, not a link.",
            ))
        }
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => None,
        Err(err) => return Err(err.into()),
    };
    let mut options = std::fs::OpenOptions::new();
    options.write(true);
    if previous.is_none() {
        options.create_new(true);
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.custom_flags(libc::O_NOFOLLOW).mode(0o600);
    }
    let mut file = options.open(path)?;
    let opened = file.metadata()?;
    if !opened.is_file() {
        return Err(Error::new("profile", "Choose a regular PNG file."));
    }
    #[cfg(unix)]
    if let Some(previous) = previous {
        use std::os::unix::fs::MetadataExt;
        if previous.ino() != opened.ino() || previous.dev() != opened.dev() {
            return Err(Error::new(
                "profile",
                "The selected PNG destination changed.",
            ));
        }
    }
    file.set_len(0)?;
    file.write_all(bytes)?;
    file.sync_all()?;
    Ok(())
}
#[cfg(target_os = "macos")]
async fn copy(app: &tauri::AppHandle, bytes: Vec<u8>) -> Result<()> {
    let (tx, rx) = tokio::sync::oneshot::channel();
    app.run_on_main_thread(move || {
        use objc2_app_kit::{NSBitmapImageRep, NSPasteboard, NSPasteboardTypePNG};
        use objc2_foundation::NSData;
        let action = || {
            let data = NSData::with_bytes(&bytes);
            let image = NSBitmapImageRep::imageRepWithData(&data)
                .ok_or_else(|| Error::new("profile", "Cannot prepare activity image."))?;
            if image.pixelsWide() > 2048 || image.pixelsHigh() > 2048 {
                return Err(Error::new("profile", "Activity image is too large."));
            }
            let board = NSPasteboard::generalPasteboard();
            board.clearContents();
            if !board.setData_forType(Some(&data), unsafe { NSPasteboardTypePNG }) {
                return Err(Error::new("profile", "Could not copy activity image."));
            }
            Ok(())
        };
        let _ = tx.send(action());
    })
    .map_err(|_| Error::new("profile", "Could not copy activity image."))?;
    rx.await
        .map_err(|_| Error::new("profile", "Could not copy activity image."))?
}
#[cfg(not(target_os = "macos"))]
async fn copy(_app: &tauri::AppHandle, _bytes: Vec<u8>) -> Result<()> {
    Err(Error::new(
        "profile",
        "Image copy is unavailable. Use Save instead.",
    ))
}
fn composer(action: ProfileImageAction) -> Option<&'static str> {
    match action {
        ProfileImageAction::X => Some("https://x.com/intent/tweet?text=My%20Switchyard%20activity"),
        ProfileImageAction::Linkedin => Some("https://www.linkedin.com/feed/?shareActive=true"),
        ProfileImageAction::Reddit => {
            Some("https://www.reddit.com/submit?title=My%20Switchyard%20activity")
        }
        _ => None,
    }
}
#[tauri::command]
pub async fn profile_image_action(
    app: tauri::AppHandle,
    state: tauri::State<'_, Arc<crate::commands::AppState>>,
    data: String,
    action: ProfileImageAction,
) -> Result<ProfileImageResult> {
    state.ensure_running()?;
    BUSY.compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
        .map_err(|_| Error::new("profile", "An activity image action is already running."))?;
    let _guard = ExportGuard;
    let bytes = tauri::async_runtime::spawn_blocking(move || decode(&data))
        .await
        .map_err(|_| Error::new("profile", "Cannot prepare activity image."))??;
    if matches!(action, ProfileImageAction::Save) {
        use tauri_plugin_dialog::DialogExt;
        let (tx, rx) = tokio::sync::oneshot::channel();
        app.dialog()
            .file()
            .add_filter("PNG image", &["png"])
            .set_file_name("switchyard-activity.png")
            .save_file(move |path| {
                let _ = tx.send(path);
            });
        let path = rx
            .await
            .map_err(|_| Error::new("profile", "Could not open image save dialog."))?;
        let Some(path) = path else {
            return Ok(ProfileImageResult::Cancelled);
        };
        let path = path
            .into_path()
            .map_err(|_| Error::new("profile", "Choose a local PNG destination."))?;
        state.ensure_running()?;
        tauri::async_runtime::spawn_blocking(move || save_picked(&path, &bytes))
            .await
            .map_err(|_| Error::new("profile", "Could not save activity image."))??;
        return Ok(ProfileImageResult::Saved);
    }
    state.ensure_running()?;
    copy(&app, bytes).await?;
    if let Some(url) = composer(action) {
        use tauri_plugin_opener::OpenerExt;
        state.ensure_running()?;
        app.opener()
            .open_url(url, None::<&str>)
            .map_err(|_| Error::new("profile", "Could not open the social composer."))?;
        Ok(ProfileImageResult::ComposerOpened)
    } else {
        Ok(ProfileImageResult::Copied)
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    fn fixture() -> Vec<u8> {
        use image::ImageEncoder;
        let mut bytes = Vec::new();
        image::codecs::png::PngEncoder::new(&mut bytes)
            .write_image(&[255, 255, 255, 255], 1, 1, image::ExtendedColorType::Rgba8)
            .unwrap();
        bytes
    }

    #[test]
    fn outbound_image_is_bounded_png_and_fixed_actions_only() {
        let bytes = fixture();
        assert!(validate_png(&bytes).is_ok());
        assert!(validate_png(&bytes[..bytes.len() - 1]).is_err());
        let mut corrupt = bytes.clone();
        corrupt[29] ^= 1; // IHDR CRC corruption
        assert!(validate_png(&corrupt).is_err());
        let mut corrupt_pixels = bytes.clone();
        let at = 33; // IDAT, after the complete IHDR
        assert_eq!(&corrupt_pixels[at + 4..at + 8], b"IDAT");
        let length = u32::from_be_bytes(corrupt_pixels[at..at + 4].try_into().unwrap()) as usize;
        let end = at + 12 + length;
        corrupt_pixels[at + 8..end - 4].fill(0); // invalid compressed stream, with a valid CRC
        let crc = crc32fast::hash(&corrupt_pixels[at + 4..end - 4]);
        corrupt_pixels[end - 4..end].copy_from_slice(&crc.to_be_bytes());
        assert!(validate_png(&corrupt_pixels).is_err());
        let mut oversized = bytes.clone();
        oversized[16..20].copy_from_slice(&4096u32.to_be_bytes());
        let crc = crc32fast::hash(&oversized[12..29]);
        oversized[29..33].copy_from_slice(&crc.to_be_bytes());
        assert!(validate_png(&oversized).is_err());
        assert!(decode(&"x".repeat(MAX_PNG * 2)).is_err());
        assert!(serde_json::from_str::<ProfileImageAction>("\"https://evil.test\"").is_err());
        for action in [
            ProfileImageAction::X,
            ProfileImageAction::Linkedin,
            ProfileImageAction::Reddit,
        ] {
            assert!(composer(action).unwrap().starts_with("https://"));
        }
    }
    #[test]
    fn picked_save_writes_only_regular_png_destination() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("activity.png");
        save_picked(&path, &fixture()).unwrap();
        assert_eq!(std::fs::read(&path).unwrap(), fixture());
        assert!(save_picked(&dir.path().join("activity.txt"), &fixture()).is_err());
        #[cfg(unix)]
        {
            let link = dir.path().join("link.png");
            std::os::unix::fs::symlink(&path, &link).unwrap();
            assert!(save_picked(&link, &fixture()).is_err());
        }
    }
}
