//! Sent image thumbnails live as files next to `state.json`
//! (`thumbnails/<attachment id>.jpg`), not inside transcripts: a message keeps only
//! `hasThumbnail`, and the webview loads the JPEG through the `sirus-thumb` scheme
//! (the phone through `/api/thumbnail/<id>` in remote access). The file name is
//! always a canonical UUID, so message content never chooses a path.
use std::collections::HashSet;
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};

use base64::{engine::general_purpose::STANDARD, Engine};

use crate::models::{AppData, Message, Session};

const DIR: &str = "thumbnails";
const DATA_URL: &str = "data:image/jpeg;base64,";
/// The scheme the desktop webview loads thumbnails from (`sirus-thumb://localhost/<id>`).
pub const SCHEME: &str = "sirus-thumb";

/// Only a lowercase, hyphenated UUID names a thumbnail file.
pub fn valid_id(id: &str) -> bool {
    uuid::Uuid::parse_str(id).is_ok_and(|uuid| uuid.hyphenated().to_string() == id)
}

fn dir(data_path: &Path) -> PathBuf {
    data_path
        .parent()
        .unwrap_or_else(|| Path::new("."))
        .join(DIR)
}

fn file(data_path: &Path, id: &str) -> Option<PathBuf> {
    valid_id(id).then(|| dir(data_path).join(format!("{id}.jpg")))
}

/// Writes one thumbnail (temp file, then rename). An existing file is kept: an
/// attachment id's image never changes ("Send again" reuses the same id).
pub fn store(data_path: &Path, id: &str, jpeg: &[u8]) -> std::io::Result<()> {
    let path = file(data_path, id).ok_or_else(|| {
        std::io::Error::new(std::io::ErrorKind::InvalidInput, "invalid thumbnail id")
    })?;
    if path.metadata().is_ok_and(|meta| meta.is_file()) {
        return Ok(());
    }
    fs::create_dir_all(dir(data_path))?;
    let tmp = path.with_extension("jpg.tmp");
    let mut out = fs::File::create(&tmp)?;
    out.write_all(jpeg)?;
    drop(out);
    fs::rename(&tmp, &path).inspect_err(|_| {
        let _ = fs::remove_file(&tmp);
    })
}

pub fn read(data_path: &Path, id: &str) -> Option<Vec<u8>> {
    fs::read(file(data_path, id)?).ok()
}

/// Longest side of the copy a message bubble shows (56 px tall, up to 3x density).
const SMALL_SIDE: u32 = 192;

fn small_file(data_path: &Path, id: &str) -> Option<PathBuf> {
    valid_id(id).then(|| dir(data_path).join(format!("{id}.small.jpg")))
}

/// The bubble's small copy: decoding the 1280 px thumbnail for a 56 px chip held about
/// 3 MB per image while it was on screen. Made on first request and kept beside it.
pub fn read_small(data_path: &Path, id: &str) -> Option<Vec<u8>> {
    let path = small_file(data_path, id)?;
    if let Ok(bytes) = fs::read(&path) {
        return Some(bytes);
    }
    let large = read(data_path, id)?;
    let Some(bytes) = shrink(&large) else {
        return Some(large);
    };
    let tmp = path.with_extension("jpg.tmp");
    if fs::write(&tmp, &bytes).is_ok() && fs::rename(&tmp, &path).is_err() {
        let _ = fs::remove_file(&tmp);
    }
    Some(bytes)
}

fn shrink(jpeg: &[u8]) -> Option<Vec<u8>> {
    let image = image::load_from_memory_with_format(jpeg, image::ImageFormat::Jpeg).ok()?;
    if image.width() <= SMALL_SIDE && image.height() <= SMALL_SIDE {
        return None;
    }
    let small = image.resize(
        SMALL_SIDE,
        SMALL_SIDE,
        image::imageops::FilterType::Triangle,
    );
    let mut out = Vec::new();
    image::codecs::jpeg::JpegEncoder::new_with_quality(&mut out, 80)
        .encode_image(&small.to_rgb8())
        .ok()?;
    Some(out)
}

/// `size=small` asks for the bubble copy; anything else is the full thumbnail.
pub fn read_sized(data_path: &Path, id: &str, query: Option<&str>) -> Option<Vec<u8>> {
    let small = query.is_some_and(|query| query.split('&').any(|pair| pair == "size=small"));
    if small {
        read_small(data_path, id)
    } else {
        read(data_path, id)
    }
}

/// The data URL a message carries when its file cannot be written (kept as before).
pub fn data_url(jpeg: &[u8]) -> String {
    format!("{DATA_URL}{}", STANDARD.encode(jpeg))
}

/// Moves embedded thumbnails (older transcripts) into files. Each one is stripped
/// only after its file is written, so a failure keeps the data in the message.
/// Returns whether any message changed.
pub fn migrate(data_path: &Path, messages: &mut [Message]) -> bool {
    let mut changed = false;
    for attachment in messages.iter_mut().flat_map(|m| m.attachments.iter_mut()) {
        let (Some(id), Some(url)) = (attachment.id.as_deref(), attachment.thumbnail.as_deref())
        else {
            continue;
        };
        let Some(jpeg) = url
            .strip_prefix(DATA_URL)
            .and_then(|encoded| STANDARD.decode(encoded).ok())
        else {
            continue;
        };
        match store(data_path, id, &jpeg) {
            Ok(()) => {
                attachment.thumbnail = None;
                attachment.has_thumbnail = true;
                changed = true;
            }
            Err(error) => tracing::warn!(%error, "cannot move a thumbnail out of a transcript"),
        }
    }
    changed
}

fn ids<'a>(sessions: impl IntoIterator<Item = &'a Session>) -> HashSet<&'a str> {
    sessions
        .into_iter()
        .flat_map(|session| &session.messages)
        .flat_map(|message| &message.attachments)
        .filter(|attachment| attachment.has_thumbnail)
        .filter_map(|attachment| attachment.id.as_deref())
        .collect()
}

/// After sessions were deleted (and the state saved): removes their thumbnails that
/// no remaining message shows.
pub fn release(data_path: &Path, removed: &[Session], data: &AppData) {
    let kept = ids(&data.sessions);
    for id in ids(removed) {
        if kept.contains(id) {
            continue;
        }
        for path in [file(data_path, id), small_file(data_path, id)]
            .into_iter()
            .flatten()
        {
            match fs::remove_file(path) {
                Ok(()) => {}
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
                Err(error) => tracing::warn!(%error, "cannot remove a deleted thumbnail"),
            }
        }
    }
}

/// At load, with every transcript read: thumbnail files no message shows (sessions
/// removed another way, or an interrupted write). Only our own names are touched.
pub fn remove_orphans(data_path: &Path, data: &AppData) {
    let Ok(entries) = fs::read_dir(dir(data_path)) else {
        return;
    };
    let live = ids(&data.sessions);
    for entry in entries.flatten() {
        let name = entry.file_name().to_string_lossy().into_owned();
        let Some(id) = name
            .strip_suffix(".small.jpg.tmp")
            .or_else(|| name.strip_suffix(".small.jpg"))
            .or_else(|| name.strip_suffix(".jpg.tmp"))
            .or_else(|| name.strip_suffix(".jpg"))
        else {
            continue;
        };
        let orphan = name.ends_with(".tmp") || !live.contains(id);
        if valid_id(id) && orphan && entry.file_type().is_ok_and(|kind| kind.is_file()) {
            let _ = fs::remove_file(entry.path());
        }
    }
}

/// `sirus-thumb://localhost/<id>[?size=small]` (macOS) or `http://sirus-thumb.localhost/<id>`.
pub fn serve(
    data_path: Option<&Path>,
    request: &tauri::http::Request<Vec<u8>>,
) -> tauri::http::Response<Vec<u8>> {
    let id = request.uri().path().trim_start_matches('/');
    let bytes = data_path.and_then(|path| read_sized(path, id, request.uri().query()));
    response(bytes)
}

pub fn response(bytes: Option<Vec<u8>>) -> tauri::http::Response<Vec<u8>> {
    use tauri::http::{header, Response, StatusCode};
    match bytes {
        Some(bytes) => Response::builder()
            .header(header::CONTENT_TYPE, "image/jpeg")
            // An id's image never changes.
            .header(
                header::CACHE_CONTROL,
                "private, max-age=31536000, immutable",
            )
            .header(header::X_CONTENT_TYPE_OPTIONS, "nosniff")
            .body(bytes),
        None => Response::builder()
            .status(StatusCode::NOT_FOUND)
            .body(Vec::new()),
    }
    .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn message(attachments: serde_json::Value) -> Message {
        serde_json::from_value(serde_json::json!({"id":"m","sessionId":"s","role":"user","content":"hi","createdAt":"t","streaming":false,"attachments":attachments})).unwrap()
    }

    #[test]
    fn bubbles_get_a_small_copy_made_once() {
        let root = std::env::temp_dir().join(format!("sirus-thumb-small-{}", uuid::Uuid::new_v4()));
        let data_path = root.join("state.json");
        let id = uuid::Uuid::new_v4().to_string();
        let mut jpeg = Vec::new();
        image::codecs::jpeg::JpegEncoder::new(&mut jpeg)
            .encode_image(&image::RgbImage::new(1280, 640))
            .unwrap();
        store(&data_path, &id, &jpeg).unwrap();
        let small = read_sized(&data_path, &id, Some("size=small")).unwrap();
        let decoded = image::load_from_memory(&small).unwrap();
        assert_eq!((decoded.width(), decoded.height()), (192, 96));
        assert!(small_file(&data_path, &id).unwrap().is_file());
        assert_eq!(read_sized(&data_path, &id, None).unwrap(), jpeg);
        assert!(read_small(&data_path, "../state").is_none());
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn only_canonical_uuids_name_files() {
        let id = uuid::Uuid::new_v4().to_string();
        assert!(valid_id(&id));
        assert!(!valid_id(&id.to_uppercase()));
        assert!(!valid_id("../state"));
        assert!(!valid_id(&id.replace('-', "")));
        let root = Path::new("/data/state.json");
        assert!(file(root, "../../etc/passwd").is_none());
        assert_eq!(
            file(root, &id).unwrap(),
            Path::new("/data/thumbnails").join(format!("{id}.jpg"))
        );
    }

    #[test]
    fn embedded_thumbnails_move_to_files_and_failures_keep_them() {
        let temp = crate::git::tests::Repo::new();
        let path = temp.0.join("state.json");
        let id = uuid::Uuid::new_v4().to_string();
        let url = data_url(b"jpeg-bytes");
        let mut messages = vec![message(serde_json::json!([
            {"id":id,"name":"a.png","kind":"file","thumbnail":url},
            {"id":"not-a-uuid","name":"b.png","kind":"file","thumbnail":url},
            {"name":"c.png","kind":"file","thumbnail":url}
        ]))];
        assert!(migrate(&path, &mut messages));
        let [moved, kept, no_id] = &messages[0].attachments[..] else {
            panic!()
        };
        assert!(moved.thumbnail.is_none() && moved.has_thumbnail);
        assert_eq!(read(&path, &id).unwrap(), b"jpeg-bytes");
        assert_eq!(kept.thumbnail.as_deref(), Some(url.as_str()));
        assert_eq!(no_id.thumbnail.as_deref(), Some(url.as_str()));
        assert!(!migrate(&path, &mut messages));
        let json = serde_json::to_value(&messages[0]).unwrap();
        assert_eq!(json["attachments"][0]["hasThumbnail"], true);
        assert!(json["attachments"][0].get("thumbnail").is_none());
    }

    #[test]
    fn deleted_sessions_release_only_unshared_thumbnails() {
        let temp = crate::git::tests::Repo::new();
        let path = temp.0.join("state.json");
        let (shared, own) = (
            uuid::Uuid::new_v4().to_string(),
            uuid::Uuid::new_v4().to_string(),
        );
        for id in [&shared, &own] {
            store(&path, id, b"x").unwrap();
        }
        let session = |id: &str, thumbs: &[&String]| -> Session {
            let attachments = thumbs
                .iter()
                .map(|t| serde_json::json!({"id":t,"name":"a.png","kind":"file","hasThumbnail":true}))
                .collect::<Vec<_>>();
            let mut session: Session = serde_json::from_value(serde_json::json!({"id":id,"title":"T","projectId":"p","agent":"codex","status":"completed","createdAt":"t","lastActivityAt":"t","worktree":{"path":"/f","branch":"main","isolated":false},"lastError":null,"messages":[]})).unwrap();
            session.messages = vec![message(serde_json::Value::Array(attachments))];
            session
        };
        let data = AppData {
            sessions: vec![session("kept", &[&shared])],
            ..AppData::default()
        };
        release(&path, &[session("gone", &[&shared, &own])], &data);
        assert!(read(&path, &shared).is_some());
        assert!(read(&path, &own).is_none());

        store(&path, &own, b"y").unwrap();
        fs::write(dir(&path).join("notes.txt"), b"keep").unwrap();
        remove_orphans(&path, &data);
        assert!(read(&path, &shared).is_some());
        assert!(read(&path, &own).is_none());
        assert!(dir(&path).join("notes.txt").exists());
    }
}
