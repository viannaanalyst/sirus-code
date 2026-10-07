//! Images a reply links to on this Mac (ADR-085). Agents often answer with
//! `[see image](/tmp/preview.png)`: a path the renderer cannot load. This reads
//! one such file for the image gallery, and only when it really is an image: an
//! image extension, a regular file under 25 MiB, and PNG, JPEG, GIF or WebP bytes.
//! Relative paths resolve in the session's workspace; nothing is written.

use std::io::Read;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use base64::Engine;
use tauri::State;

use crate::commands::{native_task, session_path, AppState};
use crate::error::{Error, Result};

const MAX_BYTES: u64 = 25 * 1024 * 1024;
const EXTENSIONS: &[&str] = &["png", "jpg", "jpeg", "gif", "webp"];

/// The image type its first bytes declare.
pub fn image_type(bytes: &[u8]) -> Option<&'static str> {
    if bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
        Some("image/png")
    } else if bytes.starts_with(&[0xFF, 0xD8, 0xFF]) {
        Some("image/jpeg")
    } else if bytes.starts_with(b"GIF87a") || bytes.starts_with(b"GIF89a") {
        Some("image/gif")
    } else if bytes.len() >= 12 && &bytes[..4] == b"RIFF" && &bytes[8..12] == b"WEBP" {
        Some("image/webp")
    } else {
        None
    }
}

/// The file a reply's link names: `file://` and `~/` are understood, relative paths sit in `cwd`.
pub fn resolve(cwd: &Path, home: Option<&Path>, link: &str) -> Result<PathBuf> {
    let link = link.trim();
    let link = link.strip_prefix("file://").unwrap_or(link);
    let path = match (link.strip_prefix("~/"), home) {
        (Some(rest), Some(home)) => home.join(rest),
        _ => PathBuf::from(link),
    };
    let path = if path.is_absolute() {
        path
    } else {
        cwd.join(path)
    };
    let extension = path
        .extension()
        .and_then(|extension| extension.to_str())
        .map(str::to_ascii_lowercase)
        .unwrap_or_default();
    if !EXTENSIONS.contains(&extension.as_str()) {
        return Err(Error::invalid_path(
            "only PNG, JPEG, GIF and WebP images open here",
        ));
    }
    Ok(path)
}

#[tauri::command]
pub async fn reply_image(
    state: State<'_, Arc<AppState>>,
    session_id: String,
    path: String,
) -> Result<String> {
    let state = state.inner().clone();
    native_task(move || {
        let cwd = session_path(&state, &session_id)?;
        let home = std::env::var_os("HOME").map(PathBuf::from);
        let path = resolve(&cwd, home.as_deref(), &path)?;
        let metadata = std::fs::metadata(&path)
            .map_err(|_| Error::not_found("The image is no longer on this Mac."))?;
        if !metadata.is_file() {
            return Err(Error::invalid_path("not an image file"));
        }
        if metadata.len() > MAX_BYTES {
            return Err(Error::invalid_path("The image is larger than 25 MB."));
        }
        let mut bytes = Vec::with_capacity(metadata.len() as usize);
        std::fs::File::open(&path)?
            .take(MAX_BYTES + 1)
            .read_to_end(&mut bytes)?;
        let kind = image_type(&bytes).ok_or_else(|| Error::invalid_path("not an image file"))?;
        Ok(format!(
            "data:{kind};base64,{}",
            base64::engine::general_purpose::STANDARD.encode(bytes)
        ))
    })
    .await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn images_are_recognised_by_their_bytes() {
        assert_eq!(image_type(b"\x89PNG\r\n\x1a\nrest"), Some("image/png"));
        assert_eq!(image_type(&[0xFF, 0xD8, 0xFF, 0xE0]), Some("image/jpeg"));
        assert_eq!(image_type(b"GIF89a.."), Some("image/gif"));
        assert_eq!(image_type(b"RIFF\0\0\0\0WEBPVP8 "), Some("image/webp"));
        assert_eq!(image_type(b"<svg xmlns"), None);
        assert_eq!(image_type(b"#!/bin/sh"), None);
    }

    #[test]
    fn links_resolve_to_image_paths_only() {
        let cwd = Path::new("/work/app");
        let home = Path::new("/Users/me");
        assert_eq!(
            resolve(cwd, Some(home), "/tmp/previews/a.png").unwrap(),
            PathBuf::from("/tmp/previews/a.png")
        );
        assert_eq!(
            resolve(cwd, Some(home), "file:///tmp/b.JPG").unwrap(),
            PathBuf::from("/tmp/b.JPG")
        );
        assert_eq!(
            resolve(cwd, Some(home), "~/Desktop/c.webp").unwrap(),
            PathBuf::from("/Users/me/Desktop/c.webp")
        );
        assert_eq!(
            resolve(cwd, Some(home), "shots/d.gif").unwrap(),
            PathBuf::from("/work/app/shots/d.gif")
        );
        assert!(resolve(cwd, Some(home), "/etc/passwd").is_err());
        assert!(resolve(cwd, Some(home), "/tmp/notes.svg").is_err());
        assert!(resolve(cwd, Some(home), "/tmp/archive").is_err());
    }
}
