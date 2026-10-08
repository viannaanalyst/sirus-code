//! Closed, persisted appearance preferences and native-only window effects.
use crate::commands::AppState;
use crate::error::{Error, Result};
use crate::models::{AppSettings, AppearanceSupport, ThemePref};
use std::sync::Arc;
use tauri::Manager;

pub fn support() -> AppearanceSupport {
    AppearanceSupport {
        translucency: cfg!(target_os = "macos"),
        dock_icon: cfg!(target_os = "macos"),
    }
}

pub fn validate(settings: &AppSettings) -> Result<()> {
    if settings.theme == ThemePref::Translucent {
        return Err(Error::new(
            "invalid_settings",
            "Choose System, Light or Dark; translucency is a material preference.",
        ));
    }
    for (name, value, min, max) in [
        ("darkWindowOpacity", settings.dark_window_opacity, 25, 100),
        ("lightWindowOpacity", settings.light_window_opacity, 25, 100),
        ("darkSidebarOpacity", settings.dark_sidebar_opacity, 25, 100),
        (
            "lightSidebarOpacity",
            settings.light_sidebar_opacity,
            25,
            100,
        ),
        ("translucentOpacity", settings.translucent_opacity, 25, 100),
        ("uiFontSize", settings.ui_font_size, 11, 18),
        ("codeFontSize", settings.code_font_size, 10, 22),
        ("terminalFontSize", settings.terminal_font_size, 10, 22),
    ] {
        if !(min..=max).contains(&value) {
            return Err(Error::new(
                "invalid_settings",
                format!("{name} must be an integer from {min} to {max}."),
            ));
        }
    }
    Ok(())
}

/// Only stored numeric values are normalized; incoming saves are rejected if
/// out of range. Unknown families/themes/icons fail closed during serde decoding.
pub fn normalize(settings: &mut AppSettings) {
    for (value, min, max, fallback) in [
        (&mut settings.dark_window_opacity, 25, 100, 85),
        (&mut settings.light_window_opacity, 25, 100, 85),
        (&mut settings.dark_sidebar_opacity, 25, 100, 72),
        (&mut settings.light_sidebar_opacity, 25, 100, 38),
        (&mut settings.translucent_opacity, 25, 100, 85),
        (&mut settings.ui_font_size, 11, 18, 13),
        (&mut settings.code_font_size, 10, 22, 13),
        (&mut settings.terminal_font_size, 10, 22, 13),
    ] {
        if !(min..=max).contains(value) {
            *value = fallback;
        }
    }
    if settings.theme == ThemePref::Translucent {
        settings.theme = ThemePref::Dark;
        settings.dark_window_translucent = true;
        settings.dark_window_opacity = settings.translucent_opacity;
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct WindowIntent {
    glass: bool,
    light: bool,
    follows_system: bool,
    background: [u8; 3],
}

fn window_intent(settings: &AppSettings, system_light: bool) -> WindowIntent {
    let light =
        settings.theme == ThemePref::Light || (settings.theme == ThemePref::System && system_light);
    let glass = if light {
        settings.light_sidebar_translucent || settings.light_window_translucent
    } else {
        settings.dark_sidebar_translucent || settings.dark_window_translucent
    };
    WindowIntent {
        glass: support().translucency && glass,
        light,
        follows_system: settings.theme == ThemePref::System,
        background: if light { [244, 244, 245] } else { [12, 12, 12] },
    }
}

pub fn schedule(app: &tauri::AppHandle, state: Arc<AppState>) {
    schedule_current(app, state, false);
}

pub fn ready(app: &tauri::AppHandle, state: Arc<AppState>) {
    // Tauri can assign its embedded Dock image after setup; restore our choice
    // once on Ready, while ordinary settings saves remain idempotent.
    schedule_current(app, state, true);
}

fn schedule_current(app: &tauri::AppHandle, state: Arc<AppState>, force_dock: bool) {
    let app_handle = app.clone();
    // Never capture the submitted settings: delayed callbacks read the latest
    // successfully persisted state, so an older save cannot replay old glass.
    if let Err(error) = app.run_on_main_thread(move || apply_now(&app_handle, &state, force_dock)) {
        tracing::warn!(%error, "cannot schedule native appearance");
    }
}

/// Applies the latest persisted appearance to the main window. Main thread only;
/// the launch reveal calls it right before the hidden window is shown (ADR-098).
pub fn apply_now(app: &tauri::AppHandle, state: &AppState, force_dock: bool) {
    #[cfg(not(target_os = "macos"))]
    let _ = force_dock;
    let data = state.data.lock();
    if state.ensure_running().is_err() {
        return;
    }
    let Some(window) = app.get_webview_window("main") else {
        return;
    };
    // Keep admission excluded while native effects apply; the next save
    // queues its own latest-state callback after this one completes.
    #[cfg(target_os = "macos")]
    macos::apply(&window, &data.settings, force_dock);
    #[cfg(not(target_os = "macos"))]
    {
        let theme = match data.settings.theme {
            ThemePref::System => None,
            ThemePref::Light => Some(tauri::Theme::Light),
            _ => Some(tauri::Theme::Dark),
        };
        let _ = window.set_theme(theme);
        let intent = window_intent(
            &data.settings,
            window
                .theme()
                .is_ok_and(|theme| theme == tauri::Theme::Light),
        );
        let [r, g, b] = intent.background;
        if let Err(error) = window.set_background_color(Some(tauri::window::Color(r, g, b, 255))) {
            tracing::warn!(%error, "cannot apply opaque appearance");
        }
    }
}

#[cfg(target_os = "macos")]
mod macos {
    use super::*;
    use crate::models::DockIcon;
    use objc2::{AnyThread, MainThreadMarker, MainThreadOnly};
    use objc2_app_kit::NSAppearanceCustomization;
    use objc2_app_kit::{
        NSAppearance, NSAppearanceNameAqua, NSAppearanceNameDarkAqua, NSApplication,
        NSAutoresizingMaskOptions, NSColor, NSImage, NSUserInterfaceItemIdentification,
        NSVisualEffectBlendingMode, NSVisualEffectMaterial, NSVisualEffectState,
        NSVisualEffectView, NSWindow, NSWindowOrderingMode,
    };
    use objc2_foundation::{NSArray, NSData, NSString};
    use std::cell::RefCell;
    use std::ffi::{c_int, c_void};
    use std::sync::OnceLock;

    const BACKING_ID: &str = "sirus.appearance-glass-backing";
    const BLUR_RADIUS: c_int = 24;
    const SMOKED_DOCK: &[u8] = include_bytes!("../icons/dock-smoked-glass.png");
    const WHITE_DOCK: &[u8] = include_bytes!("../icons/dock-white.png");

    thread_local! {
        static LAST_APPLIED: RefCell<Option<(WindowIntent, DockIcon)>> = const { RefCell::new(None) };
        /// The private blur needs a window number, which a never-shown window may lack:
        /// the next apply (right after the launch reveal shows it) tries again.
        static BLUR_PENDING: std::cell::Cell<bool> = const { std::cell::Cell::new(false) };
    }

    type ConnectionFn = unsafe extern "C" fn() -> usize;
    type BlurFn = unsafe extern "C" fn(usize, c_int, c_int) -> c_int;

    pub(super) fn apply(window: &tauri::WebviewWindow, settings: &AppSettings, force_dock: bool) {
        let Some(mtm) = MainThreadMarker::new() else {
            return;
        };
        let Ok(raw) = window.ns_window() else {
            return;
        };
        // Tauri owns this NSWindow; the pointer is only borrowed in this
        // main-thread callback and never retained by a renderer-selected value.
        let Some(native) = (unsafe { raw.cast::<NSWindow>().as_ref() }) else {
            return;
        };
        // NSApplication inherits the OS palette; an explicit window override must
        // not turn the System choice into the previous forced Light/Dark choice.
        let app = NSApplication::sharedApplication(mtm);
        let system_light = unsafe {
            app.effectiveAppearance()
                .bestMatchFromAppearancesWithNames(&NSArray::from_slice(&[
                    NSAppearanceNameAqua,
                    NSAppearanceNameDarkAqua,
                ]))
                .is_some_and(|name| &*name == NSAppearanceNameAqua)
        };
        let intent = window_intent(settings, system_light);
        let previous = LAST_APPLIED.with(|slot| slot.borrow().clone());
        if BLUR_PENDING.get() || previous.as_ref().is_none_or(|(old, _)| *old != intent) {
            BLUR_PENDING.set(false);
            // AppKit exports these immutable appearance-name constants.
            let appearance_name = unsafe {
                if intent.light {
                    NSAppearanceNameAqua
                } else {
                    NSAppearanceNameDarkAqua
                }
            };
            let appearance = if intent.follows_system {
                None
            } else {
                NSAppearance::appearanceNamed(appearance_name)
            };
            native.setAppearance(appearance.as_deref());
            if intent.glass {
                native.setOpaque(false);
                // MonoCode's tiny nonzero alpha keeps native shadows/corners intact.
                native
                    .setBackgroundColor(Some(&NSColor::clearColor().colorWithAlphaComponent(0.01)));
                let private_blur = apply_blur(native, BLUR_RADIUS);
                BLUR_PENDING.set(!private_blur && !native.isVisible());
                set_backing(native, true, private_blur);
            } else {
                apply_blur(native, 0);
                set_backing(native, false, false);
                native.setOpaque(true);
                let [r, g, b] = intent.background;
                native.setBackgroundColor(Some(&NSColor::colorWithRed_green_blue_alpha(
                    f64::from(r) / 255.0,
                    f64::from(g) / 255.0,
                    f64::from(b) / 255.0,
                    1.0,
                )));
            }
            native.setHasShadow(true);
            native.invalidateShadow();
        }
        if force_dock
            || previous
                .as_ref()
                .is_none_or(|(_, old)| *old != settings.dock_icon)
        {
            let app = NSApplication::sharedApplication(mtm);
            let bytes = match settings.dock_icon {
                DockIcon::Default => None,
                DockIcon::SmokedGlass => Some(SMOKED_DOCK),
                DockIcon::White => Some(WHITE_DOCK),
            };
            if let Some(bytes) = bytes {
                let data = NSData::with_bytes(bytes);
                if let Some(image) = NSImage::initWithData(NSImage::alloc(), &data) {
                    // Fixed embedded artwork only; no renderer paths/images.
                    unsafe { app.setApplicationIconImage(Some(&image)) };
                }
            } else {
                // nil restores the original bundle icon. Do not replace
                // the platform's default with a raw PNG.
                unsafe { app.setApplicationIconImage(None) };
            }
        }
        LAST_APPLIED.with(|slot| *slot.borrow_mut() = Some((intent, settings.dock_icon)));
    }

    fn set_backing(window: &NSWindow, enabled: bool, private_blur: bool) {
        let Some(content) = window.contentView() else {
            return;
        };
        let identifier = NSString::from_str(BACKING_ID);
        if let Some(backing) = content
            .subviews()
            .iter()
            .find(|view| view.identifier().as_deref() == Some(&identifier))
        {
            // Full-strength standard AppKit blur when WindowServer is absent
            // or fails. The 1% backing otherwise stabilizes WKWebView repaints.
            backing.setAlphaValue(if private_blur { 0.01 } else { 1.0 });
            backing.setHidden(!enabled);
            return;
        }
        if !enabled {
            return;
        }
        let backing = NSVisualEffectView::initWithFrame(
            NSVisualEffectView::alloc(window.mtm()),
            content.bounds(),
        );
        backing.setIdentifier(Some(&identifier));
        backing.setMaterial(NSVisualEffectMaterial::UnderWindowBackground);
        backing.setBlendingMode(NSVisualEffectBlendingMode::BehindWindow);
        backing.setState(NSVisualEffectState::Active);
        backing.setAlphaValue(if private_blur { 0.01 } else { 1.0 });
        backing.setAutoresizingMask(
            NSAutoresizingMaskOptions::ViewWidthSizable
                | NSAutoresizingMaskOptions::ViewHeightSizable,
        );
        // Keep Wry's parent, responder and webview intact. Sidebar/full glass
        // share this backing; the renderer controls which panes remain opaque.
        content.addSubview_positioned_relativeTo(&backing, NSWindowOrderingMode::Below, None);
    }

    fn apply_blur(window: &NSWindow, radius: c_int) -> bool {
        static BLUR: OnceLock<Option<BlurFn>> = OnceLock::new();
        static CONNECTION: OnceLock<Option<ConnectionFn>> = OnceLock::new();
        let blur = *BLUR.get_or_init(|| {
            let pointer = unsafe {
                libc::dlsym(
                    libc::RTLD_DEFAULT,
                    c"CGSSetWindowBackgroundBlurRadius".as_ptr(),
                )
            };
            (!pointer.is_null())
                .then(|| unsafe { std::mem::transmute::<*mut c_void, BlurFn>(pointer) })
        });
        let connection = *CONNECTION.get_or_init(|| {
            for name in [c"CGSDefaultConnectionForThread", c"CGSMainConnectionID"] {
                let pointer = unsafe { libc::dlsym(libc::RTLD_DEFAULT, name.as_ptr()) };
                if !pointer.is_null() {
                    return Some(unsafe {
                        std::mem::transmute::<*mut c_void, ConnectionFn>(pointer)
                    });
                }
            }
            None
        });
        let (Some(blur), Some(connection)) = (blur, connection) else {
            return false;
        };
        let number = window.windowNumber();
        let connection = unsafe { connection() };
        if number <= 0 || number > c_int::MAX as isize || connection == 0 {
            return false;
        }
        unsafe { blur(connection, number as c_int, radius) == 0 }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::{DockIcon, MonoFont, UiFont};

    #[test]
    fn legacy_defaults_preserve_system_and_migrate_neutral_glass() {
        let settings: AppSettings = serde_json::from_str("{}").unwrap();
        let defaults = serde_json::to_value(&settings).unwrap();
        assert_eq!(defaults["theme"], "dark");
        assert_eq!(defaults["darkSidebarOpacity"], 72);
        assert_eq!(defaults["lightSidebarOpacity"], 38);
        assert_eq!(defaults["translucentOpacity"], 85);
        assert_eq!(defaults["systemUiFont"], true);
        assert_eq!(defaults["uiFont"], "inter");
        assert_eq!(defaults["uiFontSize"], 13);
        assert_eq!(defaults["codeFont"], "plexMono");
        assert_eq!(defaults["codeFontSize"], 13);
        assert_eq!(defaults["terminalFont"], "plexMono");
        assert_eq!(defaults["terminalFontSize"], 13);
        assert_eq!(defaults["fontSmoothing"], true);
        assert_eq!(defaults["dockIcon"], "default");
        assert_eq!(defaults["darkSidebarTranslucent"], false);
        assert_eq!(defaults["lightSidebarTranslucent"], false);
        let migrated: AppSettings =
            serde_json::from_str(r#"{"theme":"system","glass":true}"#).unwrap();
        assert_eq!(migrated.theme, ThemePref::System);
        assert!(!window_intent(&migrated, false).glass);
        assert_eq!(serde_json::to_value(migrated).unwrap()["theme"], "system");
        assert_eq!(
            serde_json::to_value(serde_json::from_value::<AppSettings>(defaults.clone()).unwrap())
                .unwrap(),
            defaults
        );
    }

    #[test]
    fn incoming_ranges_are_validated_and_stored_ranges_normalized() {
        for (field, min, max, fallback) in [
            ("darkWindowOpacity", 25, 100, 85),
            ("lightWindowOpacity", 25, 100, 85),
            ("darkSidebarOpacity", 25, 100, 72),
            ("lightSidebarOpacity", 25, 100, 38),
            ("translucentOpacity", 25, 100, 85),
            ("uiFontSize", 11, 18, 13),
            ("codeFontSize", 10, 22, 13),
            ("terminalFontSize", 10, 22, 13),
        ] {
            for value in [min, max] {
                let settings: AppSettings =
                    serde_json::from_value(serde_json::json!({field: value})).unwrap();
                assert!(settings.validate_controls().is_ok(), "{field}:{value}");
            }
            for value in [min - 1, max + 1] {
                let mut settings: AppSettings =
                    serde_json::from_value(serde_json::json!({field: value})).unwrap();
                assert!(settings.validate_controls().is_err(), "{field}:{value}");
                normalize(&mut settings);
                assert_eq!(serde_json::to_value(settings).unwrap()[field], fallback);
            }
            for value in [
                serde_json::json!(1.5),
                serde_json::json!(-1),
                serde_json::json!("50"),
            ] {
                assert!(
                    serde_json::from_value::<AppSettings>(serde_json::json!({field: value}))
                        .is_err()
                );
            }
        }
    }

    #[test]
    fn closed_families_theme_and_dock_choices_reject_renderer_values() {
        for field in ["uiFont", "codeFont", "terminalFont", "dockIcon", "theme"] {
            for value in [
                serde_json::json!("/tmp/font"),
                serde_json::json!("https://font"),
                serde_json::json!(42),
                serde_json::Value::Null,
            ] {
                assert!(
                    serde_json::from_value::<AppSettings>(serde_json::json!({field: value}))
                        .is_err()
                );
            }
        }
        for font in [
            "inter",
            "geist",
            "dmSans",
            "plexSans",
            "humanist",
            "helvetica",
        ] {
            assert!(serde_json::from_value::<UiFont>(serde_json::json!(font)).is_ok());
        }
        for font in [
            "plexMono",
            "jetbrains",
            "fira",
            "geistMono",
            "source",
            "roboto",
            "ubuntu",
            "sfMono",
            "menlo",
            "cascadia",
            "hack",
            "consolas",
        ] {
            assert!(serde_json::from_value::<MonoFont>(serde_json::json!(font)).is_ok());
        }
        assert!(serde_json::from_value::<DockIcon>(serde_json::json!("smokedGlass")).is_ok());
    }

    #[test]
    fn dock_alternatives_survive_settings_round_trip() {
        for choice in ["default", "smokedGlass", "white"] {
            let settings: AppSettings =
                serde_json::from_value(serde_json::json!({ "dockIcon": choice })).unwrap();
            let value = serde_json::to_value(&settings).unwrap();
            assert_eq!(value["dockIcon"], choice);
            let restored: AppSettings = serde_json::from_value(value).unwrap();
            assert_eq!(restored.dock_icon, settings.dock_icon);
        }
    }

    #[test]
    fn native_intent_tracks_each_theme_and_independent_sidebar_choices() {
        for (theme, dark, light, glass, background) in [
            (ThemePref::Dark, false, true, false, [12, 12, 12]),
            (ThemePref::Dark, true, false, true, [12, 12, 12]),
            (ThemePref::Light, true, false, false, [244, 244, 245]),
            (ThemePref::Light, false, true, true, [244, 244, 245]),
            (ThemePref::System, false, false, false, [12, 12, 12]),
        ] {
            let settings = AppSettings {
                theme,
                dark_sidebar_translucent: dark,
                light_sidebar_translucent: light,
                ..AppSettings::default()
            };
            let intent = window_intent(&settings, false);
            assert_eq!(intent.glass, cfg!(target_os = "macos") && glass);
            assert_eq!(intent.light, settings.theme == ThemePref::Light);
            assert_eq!(intent.background, background);
        }
        let mut settings = AppSettings {
            theme: ThemePref::System,
            dark_window_translucent: true,
            light_window_translucent: false,
            ..AppSettings::default()
        };
        let dark = window_intent(&settings, false);
        let light = window_intent(&settings, true);
        assert!(dark.follows_system && light.follows_system);
        assert!(!dark.light && light.light);
        assert_eq!(dark.glass, cfg!(target_os = "macos"));
        assert!(!light.glass);
        settings.theme = ThemePref::Dark;
        assert!(!window_intent(&settings, true).follows_system);
        assert!(!window_intent(&settings, true).light);
        settings.theme = ThemePref::Translucent;
        settings.translucent_opacity = 43;
        assert!(validate(&settings).is_err());
        normalize(&mut settings);
        assert_eq!(settings.theme, ThemePref::Dark);
        assert!(settings.dark_window_translucent);
        assert_eq!(settings.dark_window_opacity, 43);
        assert!(validate(&settings).is_ok());
        assert_eq!(support().dock_icon, cfg!(target_os = "macos"));
    }
}
