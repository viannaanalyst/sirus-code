//! Project icon customization (ADR-059): a folder colour, an emoji or a logo
//! image that replaces the folder in the sidebar. Display metadata only; the
//! project folder is never touched. The logo comes from a file the person picks
//! in the native dialog, decoded with bounds and stored as a small PNG data URL.
use std::sync::Arc;

use base64::Engine;
use serde::Deserialize;
use tauri::{AppHandle, State};

use crate::commands::AppState;
use crate::error::{Error, Result};
use crate::models::{Project, ProjectAstroIcon};

/// Preset colours the renderer maps to tokens; anything else must be `#rrggbb`.
const PRESETS: [&str; 9] = [
    "blue", "red", "yellow", "green", "pink", "purple", "teal", "orange", "gray",
];
/// Line icons a project can show instead of its folder; the renderer maps each name.
pub const ICONS: [&str; 58] = [
    "folder",
    "code",
    "terminal",
    "book-open",
    "graduation-cap",
    "pencil-simple",
    "feather",
    "briefcase",
    "music-notes",
    "chart-bar",
    "barbell",
    "scales",
    "globe",
    "airplane-tilt",
    "wrench",
    "paw-print",
    "flask",
    "brain",
    "heart",
    "tree",
    "rocket",
    "lightbulb",
    "star",
    "coffee",
    "camera",
    "shopping-cart",
    "house",
    "car",
    "game-controller",
    "palette",
    "database",
    "cloud",
    "lock",
    "key",
    "currency-dollar",
    "bank",
    "stethoscope",
    "chat-circle",
    "envelope",
    "device-mobile",
    "calendar-blank",
    "robot",
    "cpu",
    "bug",
    "leaf",
    "sun",
    "moon",
    "fire",
    "lightning",
    "cube",
    "puzzle-piece",
    "trophy",
    "users",
    "storefront",
    "film-slate",
    "newspaper",
    "atom",
    "cat",
];
/// The logo is cropped square and scaled to this many pixels per side.
const LOGO_SIDE: u32 = 96;
/// Largest picked file that is decoded.
const MAX_FILE: u64 = 10 * 1024 * 1024;
/// Largest stored data URL.
const MAX_LOGO: usize = 96 * 1024;

#[derive(Debug, Deserialize)]
#[serde(
    tag = "type",
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum Action {
    /// Tints the folder; `null` returns to the default colour.
    SetColor {
        project_id: String,
        color: Option<String>,
    },
    /// Shows an emoji instead of the folder; `null` removes it.
    SetEmoji {
        project_id: String,
        emoji: Option<String>,
    },
    /// Opens the native image picker; the chosen image becomes the logo.
    PickLogo {
        project_id: String,
    },
    /// Shows one of the Astro icons instead of the folder; `null` removes it.
    SetAstro {
        project_id: String,
        astro: Option<ProjectAstroIcon>,
    },
    ClearLogo {
        project_id: String,
    },
    /// Shows one of the line icons instead of the folder; `null` removes it.
    SetIcon {
        project_id: String,
        icon: Option<String>,
    },
}

/// Closed project-appearance surface. Returns the updated project, or `None`
/// when the person cancelled the picker.
#[tauri::command]
pub async fn project_look_action(
    app: AppHandle,
    state: State<'_, Arc<AppState>>,
    action: Action,
) -> Result<Option<Project>> {
    let state = state.inner().clone();
    let logo = match &action {
        Action::PickLogo { project_id } => {
            ensure_project(&state, project_id)?;
            let Some(path) = pick_image(&app).await else {
                return Ok(None);
            };
            Some(
                tokio::task::spawn_blocking(move || logo_from_file(&path))
                    .await
                    .map_err(|_| Error::new("invalid", "Could not read that image."))??,
            )
        }
        _ => None,
    };
    crate::commands::native_task(move || {
        let mut data = state.data.lock();
        state.ensure_running()?;
        let project = data
            .projects
            .iter_mut()
            .find(|row| row.id == project_id(&action))
            .ok_or_else(|| Error::not_found("project not found"))?;
        match action {
            Action::SetColor { color, .. } => {
                project.look.color = color.map(|value| valid_color(&value)).transpose()?
            }
            Action::SetEmoji { emoji, .. } => {
                project.look.emoji = emoji.map(|value| valid_emoji(&value)).transpose()?;
                // One icon at a time: an emoji replaces a logo or an Astro icon.
                if project.look.emoji.is_some() {
                    project.look.logo = None;
                    project.look.astro = None;
                    project.look.icon = None;
                }
            }
            Action::PickLogo { .. } => {
                project.look.logo = logo;
                project.look.emoji = None;
                project.look.astro = None;
                project.look.icon = None;
            }
            Action::SetAstro { astro, .. } => {
                project.look.astro = astro.map(valid_astro).transpose()?;
                if project.look.astro.is_some() {
                    project.look.logo = None;
                    project.look.emoji = None;
                    project.look.icon = None;
                }
            }
            Action::ClearLogo { .. } => project.look.logo = None,
            Action::SetIcon { icon, .. } => {
                if icon.as_deref().is_some_and(|name| !ICONS.contains(&name)) {
                    return Err(Error::new("invalid", "Unknown project icon."));
                }
                project.look.icon = icon;
                if project.look.icon.is_some() {
                    project.look.logo = None;
                    project.look.emoji = None;
                    project.look.astro = None;
                }
            }
        }
        let saved = project.clone();
        crate::persist::save(&state.data_path, &data)?;
        Ok(Some(saved))
    })
    .await
}

/// Opens the native image picker and returns the picked image as a small square PNG data
/// URL, for icons that are not a project's (project folders). `None` when cancelled.
#[tauri::command]
pub async fn pick_look_image(app: AppHandle) -> Result<Option<String>> {
    let Some(path) = pick_image(&app).await else {
        return Ok(None);
    };
    tokio::task::spawn_blocking(move || logo_from_file(&path))
        .await
        .map_err(|_| Error::new("invalid", "Could not read that image."))?
        .map(Some)
}

/// Checks a look that arrives whole (a project folder's): known colour, emoji, Astro and
/// line icon, and a logo that is a bounded PNG data URL like the ones made here.
pub fn validate_look(look: &crate::models::ProjectLook) -> Result<()> {
    if let Some(color) = &look.color {
        valid_color(color)?;
    }
    if let Some(emoji) = &look.emoji {
        valid_emoji(emoji)?;
    }
    if let Some(astro) = &look.astro {
        valid_astro(astro.clone())?;
    }
    if look
        .icon
        .as_deref()
        .is_some_and(|name| !ICONS.contains(&name))
    {
        return Err(Error::new("invalid", "Unknown project icon."));
    }
    if look
        .logo
        .as_deref()
        .is_some_and(|logo| !logo.starts_with("data:image/png;base64,") || logo.len() > MAX_LOGO)
    {
        return Err(Error::new("invalid", "Use a PNG or JPEG image."));
    }
    Ok(())
}

/// Where projects keep their own icon, most specific first (ADR-072).
const ICON_CANDIDATES: &[&str] = &[
    "public/favicon.svg",
    "public/favicon.png",
    "public/favicon.ico",
    "public/icon.svg",
    "public/icon.png",
    "app/icon.svg",
    "app/icon.png",
    "app/favicon.ico",
    "src/app/icon.svg",
    "src/app/icon.png",
    "src/app/favicon.ico",
    "public/apple-touch-icon.png",
    "public/logo.svg",
    "public/logo.png",
    "static/favicon.svg",
    "static/favicon.png",
    "static/favicon.ico",
    "favicon.svg",
    "favicon.png",
    "favicon.ico",
    "logo.svg",
    "logo.png",
    "icon.svg",
    "icon.png",
    "assets/logo.svg",
    "assets/logo.png",
    "assets/icon.png",
    "src/assets/logo.svg",
    "src/assets/logo.png",
    "src-tauri/icons/128x128.png",
    "build/icon.png",
    "resources/icon.png",
];
const MAX_ICON_FILE: u64 = 512 * 1024;

/// The project's own favicon or logo as a small data URL, when Settings → Automatic project
/// icons is on. Only fixed candidate paths inside the project are read; nothing is written.
#[tauri::command]
pub async fn project_auto_icon(
    state: State<'_, Arc<AppState>>,
    project_id: String,
) -> Result<Option<String>> {
    let state = state.inner().clone();
    crate::commands::native_task(move || {
        let root = {
            let data = state.data.lock();
            if !data.settings.project_auto_icons {
                return Ok(None);
            }
            data.projects
                .iter()
                .find(|row| row.id == project_id)
                .map(|row| std::path::PathBuf::from(&row.path))
                .ok_or_else(|| Error::not_found("project not found"))?
        };
        Ok(find_project_icon(&root))
    })
    .await
}

fn find_project_icon(root: &std::path::Path) -> Option<String> {
    let root = root.canonicalize().ok()?;
    for candidate in ICON_CANDIDATES {
        let Ok(path) = root.join(candidate).canonicalize() else {
            continue;
        };
        // A symlink must not lead the read outside the project.
        if !path.starts_with(&root) || !path.is_file() {
            continue;
        }
        if std::fs::metadata(&path)
            .map(|meta| meta.len() > MAX_ICON_FILE)
            .unwrap_or(true)
        {
            continue;
        }
        let Ok(bytes) = std::fs::read(&path) else {
            continue;
        };
        if candidate.ends_with(".svg") {
            // Shown through <img>, where SVG scripts never run.
            return Some(format!(
                "data:image/svg+xml;base64,{}",
                base64::engine::general_purpose::STANDARD.encode(bytes)
            ));
        }
        if let Ok(url) = logo_from_bytes(&bytes) {
            return Some(url);
        }
    }
    None
}

fn project_id(action: &Action) -> String {
    match action {
        Action::SetColor { project_id, .. }
        | Action::SetEmoji { project_id, .. }
        | Action::PickLogo { project_id }
        | Action::SetAstro { project_id, .. }
        | Action::ClearLogo { project_id }
        | Action::SetIcon { project_id, .. } => project_id.clone(),
    }
}

fn ensure_project(state: &AppState, project_id: &str) -> Result<()> {
    state.ensure_running()?;
    if state
        .data
        .lock()
        .projects
        .iter()
        .any(|row| row.id == project_id)
    {
        Ok(())
    } else {
        Err(Error::not_found("project not found"))
    }
}

pub(crate) fn valid_color(value: &str) -> Result<String> {
    let hex = value.len() == 7
        && value.starts_with('#')
        && value[1..].bytes().all(|byte| byte.is_ascii_hexdigit());
    if PRESETS.contains(&value) || hex {
        Ok(value.to_ascii_lowercase())
    } else {
        Err(Error::new(
            "invalid",
            "Choose one of the colours or a #rrggbb value.",
        ))
    }
}

pub(crate) fn valid_astro(astro: ProjectAstroIcon) -> Result<ProjectAstroIcon> {
    if crate::astros::ICONS.contains(&astro.icon.as_str())
        && crate::astros::STYLES.contains(&astro.style.as_str())
    {
        Ok(astro)
    } else {
        Err(Error::new("invalid", "Unknown Astro icon or style."))
    }
}

/// A short printable symbol (an emoji, including joined sequences); no spaces or control characters.
pub(crate) fn valid_emoji(value: &str) -> Result<String> {
    let value = value.trim();
    if value.is_empty()
        || value.len() > 32
        || value.chars().count() > 10
        || value
            .chars()
            .any(|ch| ch.is_control() || ch.is_whitespace())
    {
        return Err(Error::new("invalid", "Use a single emoji."));
    }
    Ok(value.to_owned())
}

async fn pick_image(app: &AppHandle) -> Option<std::path::PathBuf> {
    use tauri_plugin_dialog::DialogExt;
    let (tx, rx) = tokio::sync::oneshot::channel();
    app.dialog()
        .file()
        .add_filter("Image", &["png", "jpg", "jpeg"])
        .pick_file(move |file| {
            let _ = tx.send(file.and_then(|path| path.into_path().ok()));
        });
    rx.await.ok().flatten()
}

/// Decodes a bounded PNG/JPEG, crops it to the centre square and returns a small PNG data URL.
fn logo_from_file(path: &std::path::Path) -> Result<String> {
    let size = std::fs::metadata(path)
        .map_err(|_| Error::new("invalid", "Could not read that image."))?
        .len();
    if size > MAX_FILE {
        return Err(Error::new("invalid", "The image must be at most 10 MiB."));
    }
    let bytes =
        std::fs::read(path).map_err(|_| Error::new("invalid", "Could not read that image."))?;
    logo_from_bytes(&bytes)
}

fn logo_from_bytes(bytes: &[u8]) -> Result<String> {
    let mut reader = image::ImageReader::new(std::io::Cursor::new(bytes))
        .with_guessed_format()
        .map_err(|_| Error::new("invalid", "Use a PNG or JPEG image."))?;
    let mut limits = image::Limits::default();
    limits.max_image_width = Some(8192);
    limits.max_image_height = Some(8192);
    limits.max_alloc = Some(256 * 1024 * 1024);
    reader.limits(limits);
    let decoded = reader
        .decode()
        .map_err(|_| Error::new("invalid", "Use a PNG or JPEG image."))?;
    let side = decoded.width().min(decoded.height());
    if side == 0 {
        return Err(Error::new("invalid", "The image is empty."));
    }
    let square = decoded.crop_imm(
        (decoded.width() - side) / 2,
        (decoded.height() - side) / 2,
        side,
        side,
    );
    let small = square.resize_exact(LOGO_SIDE, LOGO_SIDE, image::imageops::FilterType::Lanczos3);
    let mut png = Vec::new();
    small
        .write_to(&mut std::io::Cursor::new(&mut png), image::ImageFormat::Png)
        .map_err(|_| Error::new("invalid", "Could not convert that image."))?;
    let url = format!(
        "data:image/png;base64,{}",
        base64::engine::general_purpose::STANDARD.encode(png)
    );
    if url.len() > MAX_LOGO {
        return Err(Error::new(
            "invalid",
            "That image is too detailed for a logo.",
        ));
    }
    Ok(url)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn colours_are_presets_or_hex() {
        assert_eq!(valid_color("blue").unwrap(), "blue");
        assert_eq!(valid_color("#AABBCC").unwrap(), "#aabbcc");
        assert!(
            valid_color("url(x)").is_err()
                && valid_color("#abc").is_err()
                && valid_color("navy").is_err()
        );
    }

    #[test]
    fn emojis_are_short_and_printable() {
        assert_eq!(valid_emoji(" 🚂 ").unwrap(), "🚂");
        assert!(valid_emoji("👨‍👩‍👧‍👦").is_ok());
        assert!(
            valid_emoji("a b").is_err()
                && valid_emoji("").is_err()
                && valid_emoji(&"x".repeat(40)).is_err()
        );
    }

    #[test]
    fn astro_icons_are_known_icons_and_styles() {
        let icon = |icon: &str, style: &str| ProjectAstroIcon {
            icon: icon.into(),
            style: style.into(),
        };
        assert!(valid_astro(icon("foguete", "neon")).is_ok());
        assert!(valid_astro(icon("../x", "metal")).is_err());
        assert!(valid_astro(icon("foguete", "pixel")).is_err());
    }

    #[test]
    fn auto_icons_read_known_paths_inside_the_project_only() {
        let dir = tempfile::tempdir().unwrap();
        assert!(find_project_icon(dir.path()).is_none());
        std::fs::create_dir_all(dir.path().join("public")).unwrap();
        std::fs::write(
            dir.path().join("public/favicon.svg"),
            "<svg xmlns='http://www.w3.org/2000/svg'/>",
        )
        .unwrap();
        assert!(find_project_icon(dir.path())
            .unwrap()
            .starts_with("data:image/svg+xml;base64,"));
        #[cfg(unix)]
        {
            let outside = tempfile::tempdir().unwrap();
            std::fs::write(outside.path().join("logo.svg"), "<svg/>").unwrap();
            let other = tempfile::tempdir().unwrap();
            std::os::unix::fs::symlink(
                outside.path().join("logo.svg"),
                other.path().join("logo.svg"),
            )
            .unwrap();
            assert!(
                find_project_icon(other.path()).is_none(),
                "symlinks out of the project are ignored"
            );
        }
    }

    #[test]
    fn logos_are_square_small_pngs() {
        let mut source = Vec::new();
        image::DynamicImage::new_rgb8(300, 120)
            .write_to(
                &mut std::io::Cursor::new(&mut source),
                image::ImageFormat::Png,
            )
            .unwrap();
        let url = logo_from_bytes(&source).unwrap();
        assert!(url.starts_with("data:image/png;base64,"));
        let png = base64::engine::general_purpose::STANDARD
            .decode(&url["data:image/png;base64,".len()..])
            .unwrap();
        let back = image::load_from_memory(&png).unwrap();
        assert_eq!((back.width(), back.height()), (LOGO_SIDE, LOGO_SIDE));
        assert!(logo_from_bytes(b"not an image").is_err());
    }

    #[test]
    fn actions_are_closed() {
        assert!(serde_json::from_value::<Action>(
            serde_json::json!({"type":"setColor","projectId":"p","color":"blue"})
        )
        .is_ok());
        assert!(serde_json::from_value::<Action>(
            serde_json::json!({"type":"pickLogo","projectId":"p","path":"/etc/passwd"})
        )
        .is_err());
        assert!(serde_json::from_value::<Action>(
            serde_json::json!({"type":"setLogo","projectId":"p","logo":"data:"})
        )
        .is_err());
    }
}
