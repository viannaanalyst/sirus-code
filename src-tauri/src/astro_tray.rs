//! The Astros menu in the macOS menu bar and their floating chat (ADR-088).
//! The menu reads "Astros", the Astros (a dot in each one's colour), then opening and
//! quitting the app. Choosing an Astro opens a small always-on-top window that follows
//! across Spaces and shows its own conversation, with the same UI over the same state
//! as the main window.

use std::sync::Arc;

use serde_json::json;
use tauri::image::Image;
use tauri::menu::{IconMenuItem, Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::TrayIconBuilder;
use tauri::{AppHandle, Emitter, Manager, WebviewUrl, WebviewWindowBuilder};

use crate::commands::AppState;
use crate::error::{Error, Result};

const TRAY: &str = "astros";
/// The floating chat's window label; its capability is in `capabilities/default.json`.
pub const FLOAT: &str = "astro-float";
const OPEN_APP: &str = "astros:open-app";
const QUIT: &str = "astros:quit";
const ASTRO_PREFIX: &str = "astros:astro:";

/// Adds the menu bar item. Failing here never stops the app.
pub fn setup(app: &AppHandle) {
    let built = TrayIconBuilder::with_id(TRAY)
        .icon(tray_glyph())
        .icon_as_template(true)
        .tooltip("Astros")
        .show_menu_on_left_click(true)
        .on_menu_event(|app, event| on_menu(app, event.id().as_ref()))
        .build(app);
    if built.is_ok() {
        refresh(app);
    }
}

/// Rebuilds the menu after Astros or the language change.
pub fn refresh(app: &AppHandle) {
    let Some(tray) = app.tray_by_id(TRAY) else {
        return;
    };
    if let Ok(menu) = build_menu(app) {
        let _ = tray.set_menu(Some(menu));
    }
}

fn build_menu(app: &AppHandle) -> tauri::Result<Menu<tauri::Wry>> {
    let state = app.state::<Arc<AppState>>();
    let (astros, portuguese) = {
        let data = state.data.lock();
        let astros: Vec<(String, String, String)> = data
            .astros
            .iter()
            .map(|astro| (astro.id.clone(), astro.name.clone(), astro.color.clone()))
            .collect();
        (astros, data.settings.locale == "pt-BR")
    };
    let menu = Menu::new(app)?;
    menu.append(&MenuItem::with_id(
        app,
        "astros:title",
        "Astros",
        false,
        None::<&str>,
    )?)?;
    menu.append(&PredefinedMenuItem::separator(app)?)?;
    if astros.is_empty() {
        let empty = if portuguese {
            "Nenhum Astro ainda"
        } else {
            "No Astros yet"
        };
        menu.append(&MenuItem::with_id(
            app,
            "astros:empty",
            empty,
            false,
            None::<&str>,
        )?)?;
    }
    for (id, name, color) in astros {
        menu.append(&IconMenuItem::with_id(
            app,
            format!("{ASTRO_PREFIX}{id}"),
            name,
            true,
            Some(color_dot(&color)),
            None::<&str>,
        )?)?;
    }
    menu.append(&PredefinedMenuItem::separator(app)?)?;
    let (open, quit) = if portuguese {
        ("Abrir SirusCode", "Sair do SirusCode")
    } else {
        ("Open SirusCode", "Quit SirusCode")
    };
    menu.append(&MenuItem::with_id(app, OPEN_APP, open, true, None::<&str>)?)?;
    menu.append(&MenuItem::with_id(app, QUIT, quit, true, None::<&str>)?)?;
    Ok(menu)
}

fn on_menu(app: &AppHandle, id: &str) {
    if let Some(astro_id) = id.strip_prefix(ASTRO_PREFIX) {
        let _ = open_float(app, astro_id);
    } else if id == OPEN_APP {
        show_main(app);
    } else if id == QUIT {
        // The same path as ⌘Q, which asks first when agents are running.
        app.exit(0);
    }
}

fn show_main(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

/// Opens the floating chat on an Astro, or brings it forward and switches to it.
pub fn open_float(app: &AppHandle, astro_id: &str) -> Result<()> {
    let name = app
        .state::<Arc<AppState>>()
        .data
        .lock()
        .astros
        .iter()
        .find(|astro| astro.id == astro_id)
        .map(|astro| astro.name.clone())
        .ok_or_else(|| Error::not_found("Astro not found"))?;
    if let Some(window) = app.get_webview_window(FLOAT) {
        let _ = window.set_title(&name);
        let _ = app.emit("astro-float-select", json!({ "astroId": astro_id }));
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
        return Ok(());
    }
    // The shell reads which Astro to show before the app script runs.
    let script = format!(
        "window.__SIRUS_ASTRO_FLOAT__ = {};",
        serde_json::to_string(astro_id).unwrap_or_else(|_| "null".into())
    );
    WebviewWindowBuilder::new(app, FLOAT, WebviewUrl::App("index.html".into()))
        .title(&name)
        .inner_size(420.0, 640.0)
        .min_inner_size(340.0, 420.0)
        .always_on_top(true)
        .visible_on_all_workspaces(true)
        .resizable(true)
        .initialization_script(&script)
        .build()
        .map_err(|error| Error::new("native", error.to_string()))?;
    Ok(())
}

/// From the floating chat: show the conversation in the main window.
#[tauri::command]
pub fn astro_show_in_main(app: AppHandle, session_id: String) -> Result<()> {
    show_main(&app);
    let _ = app.emit("astro-open-in-main", json!({ "sessionId": session_id }));
    Ok(())
}

/// The menu bar glyph: the Sirus logo. It is white on clear, and as a template image
/// macOS uses only its alpha, so it follows the menu bar's light or dark look.
fn tray_glyph() -> Image<'static> {
    Image::from_bytes(include_bytes!("../../public/sirus-glyph-small.png"))
        .map(|image| image.to_owned())
        .unwrap_or_else(|_| Image::new_owned(vec![0; 4], 1, 1))
}

/// A filled circle in an Astro's colour for its menu row.
fn color_dot(color: &str) -> Image<'static> {
    const SIZE: u32 = 32;
    let channel = |range: std::ops::Range<usize>| {
        color
            .get(range)
            .and_then(|hex| u8::from_str_radix(hex, 16).ok())
            .unwrap_or(140)
    };
    let (red, green, blue) = (channel(1..3), channel(3..5), channel(5..7));
    let mut rgba = vec![0u8; (SIZE * SIZE * 4) as usize];
    let centre = SIZE as f64 / 2.0;
    for y in 0..SIZE {
        for x in 0..SIZE {
            let distance =
                ((x as f64 + 0.5 - centre).powi(2) + (y as f64 + 0.5 - centre).powi(2)).sqrt();
            let alpha = (11.0 - distance).clamp(0.0, 1.0);
            let index = ((y * SIZE + x) * 4) as usize;
            rgba[index..index + 4].copy_from_slice(&[red, green, blue, (alpha * 255.0) as u8]);
        }
    }
    Image::new_owned(rgba, SIZE, SIZE)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn glyphs_have_their_size_and_some_ink() {
        let glyph = tray_glyph();
        assert_eq!((glyph.width(), glyph.height()), (128, 128));
        assert!(glyph.rgba().chunks(4).any(|pixel| pixel[3] == 255));
        assert!(glyph.rgba().chunks(4).any(|pixel| pixel[3] == 0));
        let dot = color_dot("#ff8000");
        assert_eq!(
            &dot.rgba()[(16 * 32 + 16) * 4..(16 * 32 + 16) * 4 + 4],
            &[255, 128, 0, 255]
        );
    }
}
