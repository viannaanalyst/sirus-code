//! Embedded browser: native WKWebView tabs owned by Rust (ADR-029).
//! Pure policy and geometry live here so they stay testable; the platform
//! module owns WebKit objects and only runs on the macOS main thread.

use serde::{Deserialize, Serialize};

use crate::error::{Error, Result};

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BrowserBounds {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BrowserTabState {
    pub id: String,
    pub url: String,
    pub title: String,
    pub loading: bool,
    pub can_go_back: bool,
    pub can_go_forward: bool,
    pub favicon_url: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BrowserSessionState {
    pub session_id: String,
    pub open: bool,
    pub tabs: Vec<BrowserTabState>,
    pub active_tab_id: Option<String>,
}

impl BrowserSessionState {
    pub fn closed(session_id: &str) -> Self {
        Self {
            session_id: session_id.into(),
            open: false,
            tabs: vec![],
            active_tab_id: None,
        }
    }
}

/// Top-level navigation allowlist. `file:`, `data:` and every other scheme are
/// refused; no user or page input reaches the OS.
pub fn is_allowed_browser_url(url: &str) -> bool {
    let trimmed = url.trim();
    if trimmed.is_empty() || trimmed.chars().any(char::is_control) {
        return false;
    }
    if trimmed.eq_ignore_ascii_case("about:blank") {
        return true;
    }
    match trimmed.split_once(':') {
        Some((scheme, rest)) => {
            let scheme = scheme.to_ascii_lowercase();
            (scheme == "http" || scheme == "https") && !rest.is_empty()
        }
        None => false,
    }
}

/// Favicons are display-only: http(s) or a bounded inline image, never a
/// script-capable scheme. The app webview renders them under the CSP image rule.
pub fn is_allowed_favicon_url(url: &str) -> bool {
    let trimmed = url.trim();
    if trimmed.is_empty() || trimmed.len() > 16 * 1024 || trimmed.chars().any(char::is_control) {
        return false;
    }
    if trimmed.starts_with("data:image/") {
        return true;
    }
    is_allowed_browser_url(trimmed)
}

/// Keys an agent or the person may press on a page (ADR-087); anything else is refused.
pub const BROWSER_KEYS: &[&str] = &[
    "Enter",
    "Escape",
    "Tab",
    "Backspace",
    "Delete",
    "ArrowUp",
    "ArrowDown",
    "ArrowLeft",
    "ArrowRight",
    "PageUp",
    "PageDown",
    "Home",
    "End",
    " ",
];

pub fn is_allowed_browser_key(key: &str) -> bool {
    BROWSER_KEYS.contains(&key)
}

/// The person's own input on a tab, sent from a paired phone (ADR-087). Tap
/// coordinates are fractions of the visible viewport.
#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum PersonAction {
    Tap {
        x: f64,
        y: f64,
    },
    Type {
        text: String,
        submit: bool,
    },
    Key {
        key: String,
    },
    Scroll {
        dy: f64,
    },
    /// A share of the visible page height, from a swipe on the picture.
    Swipe {
        fraction: f64,
    },
}

impl PersonAction {
    pub fn is_valid(&self) -> bool {
        match self {
            Self::Tap { x, y } => (0.0..=1.0).contains(x) && (0.0..=1.0).contains(y),
            Self::Type { text, .. } => text.len() <= 16 * 1024,
            Self::Key { key } => is_allowed_browser_key(key),
            Self::Scroll { dy } => dy.is_finite() && dy.abs() <= 20_000.0,
            Self::Swipe { fraction } => (-2.0..=2.0).contains(fraction),
        }
    }
}

/// Element annotations collected by the fixed in-page annotation script.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BrowserAnnotation {
    pub selector: String,
    pub label: String,
}

fn truncate_chars(value: &str, limit: usize) -> String {
    if value.chars().count() <= limit {
        value.into()
    } else {
        value.chars().take(limit).collect()
    }
}

/// Bounded, ownerless parse of the script result: at most 20 entries with a
/// selector, each field truncated before it reaches the renderer.
pub fn parse_browser_annotations(raw: &str) -> Vec<BrowserAnnotation> {
    let Ok(entries) = serde_json::from_str::<Vec<BrowserAnnotation>>(raw) else {
        return vec![];
    };
    entries
        .into_iter()
        .take(20)
        .filter(|annotation| !annotation.selector.trim().is_empty())
        .map(|annotation| BrowserAnnotation {
            selector: truncate_chars(annotation.selector.trim(), 400),
            label: truncate_chars(annotation.label.trim(), 300),
        })
        .collect()
}

/// Converts a logical top-left rect (CSS px, window content coordinates) into
/// an AppKit frame with a bottom-left origin. Sizes are at least 1×1.
pub fn appkit_frame(content_height: f64, bounds: &BrowserBounds) -> (f64, f64, f64, f64) {
    let width = bounds.width.max(1.0);
    let height = bounds.height.max(1.0);
    let x = bounds.x.max(0.0);
    let y = (content_height - bounds.y - height).max(0.0);
    (x, y, width, height)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn person_actions_and_keys_are_bounded() {
        assert!(is_allowed_browser_key("Enter"));
        assert!(!is_allowed_browser_key("Meta"));
        assert!(PersonAction::Tap { x: 0.5, y: 1.0 }.is_valid());
        assert!(!PersonAction::Tap { x: -0.1, y: 0.5 }.is_valid());
        assert!(!PersonAction::Key { key: "F12".into() }.is_valid());
        assert!(!PersonAction::Scroll { dy: f64::NAN }.is_valid());
        let tap: PersonAction = serde_json::from_str(r#"{"kind":"tap","x":0.2,"y":0.3}"#).unwrap();
        assert_eq!(tap, PersonAction::Tap { x: 0.2, y: 0.3 });
    }

    #[test]
    fn browser_url_allowlist_accepts_only_http_https_and_blank() {
        assert!(is_allowed_browser_url("https://example.com/a?b=1#c"));
        assert!(is_allowed_browser_url("http://localhost:1420/"));
        assert!(is_allowed_browser_url("  https://example.com  "));
        assert!(is_allowed_browser_url("about:blank"));
        assert!(is_allowed_browser_url("ABOUT:BLANK"));
        assert!(!is_allowed_browser_url("file:///etc/passwd"));
        assert!(!is_allowed_browser_url("data:text/html,hello"));
        assert!(!is_allowed_browser_url("javascript:alert(1)"));
        assert!(!is_allowed_browser_url("about:config"));
        assert!(!is_allowed_browser_url("https:"));
        assert!(!is_allowed_browser_url(""));
        assert!(!is_allowed_browser_url("https://exa\nmple.com"));
        assert!(!is_allowed_browser_url(
            "synara-local-preview://token/x.html"
        ));
    }

    #[test]
    fn favicon_allowlist_accepts_http_and_inline_images_only() {
        assert!(is_allowed_favicon_url("https://example.com/favicon.ico"));
        assert!(is_allowed_favicon_url("data:image/png;base64,AAAA"));
        assert!(!is_allowed_favicon_url("javascript:alert(1)"));
        assert!(!is_allowed_favicon_url("file:///tmp/icon.png"));
        assert!(!is_allowed_favicon_url(&format!(
            "data:image/png;base64,{}",
            "A".repeat(20_000)
        )));
        assert!(!is_allowed_favicon_url(""));
    }

    #[test]
    fn annotation_parse_is_bounded_and_requires_a_selector() {
        let raw = r#"[{"selector":"button#x","label":"button"},{"selector":"  ","label":"skip"},{"selector":"a","label":"y"}]"#;
        let parsed = parse_browser_annotations(raw);
        assert_eq!(parsed.len(), 2);
        assert_eq!(parsed[0].selector, "button#x");
        assert!(parse_browser_annotations("not json").is_empty());
        let long = format!(r#"[{{"selector":"{}","label":""}}]"#, "a".repeat(500));
        assert_eq!(
            parse_browser_annotations(&long)[0].selector.chars().count(),
            400
        );
    }

    #[test]
    fn appkit_frame_flips_the_origin_and_clamps_edges() {
        let bounds = BrowserBounds {
            x: 10.0,
            y: 100.0,
            width: 200.0,
            height: 300.0,
        };
        assert_eq!(appkit_frame(800.0, &bounds), (10.0, 400.0, 200.0, 300.0));
        let negative = BrowserBounds {
            x: -5.0,
            y: 700.0,
            width: 0.0,
            height: -10.0,
        };
        assert_eq!(appkit_frame(800.0, &negative), (0.0, 99.0, 1.0, 1.0));
        let nan = BrowserBounds {
            x: f64::NAN,
            y: f64::NAN,
            width: f64::NAN,
            height: f64::NAN,
        };
        assert_eq!(appkit_frame(800.0, &nan), (0.0, 0.0, 1.0, 1.0));
    }
}

#[cfg(target_os = "macos")]
pub(crate) mod platform {
    use std::cell::RefCell;
    use std::collections::HashMap;
    use std::sync::mpsc;
    use std::time::Duration;

    use block2::RcBlock;
    use objc2::rc::Retained;
    use objc2::runtime::{AnyObject, NSObject, ProtocolObject};
    use objc2::{define_class, msg_send, AllocAnyThread, DeclaredClass, MainThreadOnly};
    use objc2_app_kit::{
        NSBitmapImageFileType, NSBitmapImageRep, NSImage, NSImageCompressionFactor, NSPasteboard,
        NSPasteboardTypeString, NSView, NSWindow,
    };
    use objc2_foundation::{
        MainThreadMarker, NSDictionary, NSError, NSMutableDictionary, NSNumber, NSObjectProtocol,
        NSOperatingSystemVersion, NSPoint, NSProcessInfo, NSRect, NSSize, NSString, NSURLRequest,
        NSURL,
    };
    use objc2_web_kit::{
        WKContentWorld, WKNavigation, WKNavigationAction, WKNavigationActionPolicy,
        WKNavigationDelegate, WKSnapshotConfiguration, WKUIDelegate, WKUserScript,
        WKUserScriptInjectionTime, WKWebView, WKWebViewConfiguration, WKWebsiteDataStore,
        WKWindowFeatures,
    };
    use tauri::{AppHandle, Emitter, Manager};

    use super::{
        appkit_frame, is_allowed_browser_url, is_allowed_favicon_url, parse_browser_annotations,
        BrowserAnnotation, BrowserBounds, BrowserSessionState, BrowserTabState,
    };
    use crate::error::{Error, Result};

    struct TabRuntime {
        webview: Retained<WKWebView>,
        _delegate: Retained<BrowserNavigationDelegate>,
        url: String,
        title: String,
        loading: bool,
        can_go_back: bool,
        can_go_forward: bool,
        favicon_url: String,
        bounds: Option<BrowserBounds>,
    }

    struct SessionRuntime {
        content_view: Retained<NSView>,
        tabs: Vec<(String, TabRuntime)>,
        active: Option<String>,
        next_tab: u64,
        /// Manager clock value of the last open; the least recent browser is released first.
        used: u64,
    }

    /// Each WKWebView keeps its own WebContent memory. A session keeps at most
    /// this many tabs (the oldest closes first), and at most this many sessions
    /// keep live browsers; an older one is released and reopens at its last page.
    const MAX_TABS_PER_SESSION: usize = 8;
    const MAX_LIVE_SESSIONS: usize = 4;
    const MAX_REMEMBERED_PAGES: usize = 64;

    #[derive(Default)]
    struct BrowserManager {
        sessions: HashMap<String, SessionRuntime>,
        clock: u64,
        /// Active page of a released browser, restored when its session reopens it.
        released: HashMap<String, String>,
    }

    // Main-thread-only state: every access below is inside a
    // `run_on_main_thread` closure or a WebKit delegate callback.
    thread_local! {
        static MANAGER: RefCell<Option<BrowserManager>> = const { RefCell::new(None) };
    }

    fn with_manager<R>(operation: impl FnOnce(&mut BrowserManager) -> R) -> Result<R> {
        MANAGER.with(|cell| {
            let mut borrowed = cell
                .try_borrow_mut()
                .map_err(|_| Error::new("native", "browser state is busy"))?;
            let manager = borrowed.get_or_insert_with(BrowserManager::default);
            Ok(operation(manager))
        })
    }

    fn on_main<T: Send + 'static>(
        app: &AppHandle,
        operation: impl FnOnce() -> T + Send + 'static,
    ) -> Result<T> {
        let (sender, receiver) = mpsc::channel();
        app.run_on_main_thread(move || {
            let _ = sender.send(operation());
        })
        .map_err(|_| Error::new("native", "the main thread is unavailable"))?;
        receiver
            .recv_timeout(Duration::from_secs(10))
            .map_err(|_| Error::new("native", "the browser did not answer in time"))
    }

    /// The raw NSWindow pointer, resolved on a worker thread: the window
    /// handle dispatch must never run on the main thread (deadlock).
    #[derive(Clone, Copy)]
    struct WindowPointer(*mut std::ffi::c_void);
    unsafe impl Send for WindowPointer {}

    fn main_window_pointer(app: &AppHandle) -> Result<WindowPointer> {
        let window = app
            .get_webview_window("main")
            .ok_or_else(|| Error::new("native", "the main window is not open"))?;
        let pointer = window
            .ns_window()
            .map_err(|_| Error::new("native", "the main window is unavailable"))?;
        Ok(WindowPointer(pointer))
    }

    fn window_content(pointer: WindowPointer) -> Result<(Retained<NSView>, f64)> {
        let window: &NSWindow = unsafe { &*pointer.0.cast::<NSWindow>() };
        let content = window
            .contentView()
            .ok_or_else(|| Error::new("native", "the window has no content view"))?;
        let height = content.bounds().size.height;
        Ok((content, height))
    }

    /// WKWebView's stock user agent omits the `Version/… Safari/…` tokens, so
    /// sites serve legacy pages without dark-mode support. Send a real Safari UA.
    fn safari_user_agent() -> String {
        let version: NSOperatingSystemVersion =
            NSProcessInfo::processInfo().operatingSystemVersion();
        format!(
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/{}.0 Safari/605.1.15",
            version.majorVersion
        )
    }

    fn session_state(session_id: &str, session: &SessionRuntime) -> BrowserSessionState {
        BrowserSessionState {
            session_id: session_id.into(),
            open: true,
            tabs: session
                .tabs
                .iter()
                .map(|(id, tab)| BrowserTabState {
                    id: id.clone(),
                    url: tab.url.clone(),
                    title: tab.title.clone(),
                    loading: tab.loading,
                    can_go_back: tab.can_go_back,
                    can_go_forward: tab.can_go_forward,
                    favicon_url: tab.favicon_url.clone(),
                })
                .collect(),
            active_tab_id: session.active.clone(),
        }
    }

    impl BrowserManager {
        fn sync_from_webview(
            &mut self,
            session_id: &str,
            tab_id: &str,
            webview: &WKWebView,
            loading: bool,
        ) -> Option<BrowserSessionState> {
            let session = self.sessions.get_mut(session_id)?;
            let tab = &mut session.tabs.iter_mut().find(|(id, _)| id == tab_id)?.1;
            unsafe {
                if let Some(url) = webview.URL().and_then(|value| value.absoluteString()) {
                    tab.url = url.to_string();
                }
                if let Some(title) = webview.title() {
                    tab.title = title.to_string();
                }
                tab.can_go_back = webview.canGoBack();
                tab.can_go_forward = webview.canGoForward();
            }
            tab.loading = loading;
            Some(session_state(session_id, session))
        }

        fn set_favicon(
            &mut self,
            session_id: &str,
            tab_id: &str,
            favicon_url: &str,
        ) -> Option<BrowserSessionState> {
            let session = self.sessions.get_mut(session_id)?;
            let tab = &mut session.tabs.iter_mut().find(|(id, _)| id == tab_id)?.1;
            if tab.favicon_url == favicon_url {
                return None;
            }
            tab.favicon_url = favicon_url.to_string();
            Some(session_state(session_id, session))
        }

        fn show_active(&mut self, session_id: &str, content_height: f64) {
            let Some(session) = self.sessions.get_mut(session_id) else {
                return;
            };
            let content = session.content_view.bounds().size;
            let active = session.active.clone();
            for (id, tab) in &session.tabs {
                let visible = Some(id) == active.as_ref() && tab.bounds.is_some();
                if visible {
                    if let Some(bounds) = &tab.bounds {
                        // Never let a mis-measured rect escape the content view.
                        let clamped = BrowserBounds {
                            x: bounds.x.clamp(0.0, content.width.max(1.0)),
                            y: bounds.y.clamp(0.0, content.height.max(1.0)),
                            width: bounds.width.clamp(0.0, content.width.max(1.0)),
                            height: bounds.height.clamp(0.0, content.height.max(1.0)),
                        };
                        let (x, y, width, height) = appkit_frame(content_height, &clamped);
                        tab.webview
                            .setFrame(NSRect::new(NSPoint::new(x, y), NSSize::new(width, height)));
                    }
                }
                tab.webview.setHidden(!visible);
            }
        }

        fn open(
            &mut self,
            app: &AppHandle,
            session_id: &str,
            content: &Retained<NSView>,
            content_height: f64,
            mtm: MainThreadMarker,
        ) -> Result<BrowserSessionState> {
            self.clock += 1;
            let used = self.clock;
            self.sessions
                .entry(session_id.into())
                .or_insert_with(|| SessionRuntime {
                    content_view: content.clone(),
                    tabs: vec![],
                    active: None,
                    next_tab: 1,
                    used,
                })
                .used = used;
            if self
                .sessions
                .get(session_id)
                .is_some_and(|session| session.tabs.is_empty())
            {
                let page = self.released.remove(session_id);
                self.new_tab(app, session_id, page, content_height, mtm)?;
            } else {
                self.show_active(session_id, content_height);
            }
            self.release_idle(app, session_id);
            let session = self
                .sessions
                .get(session_id)
                .ok_or_else(|| Error::new("native", "the browser session was not created"))?;
            Ok(session_state(session_id, session))
        }

        fn new_tab(
            &mut self,
            app: &AppHandle,
            session_id: &str,
            url: Option<String>,
            content_height: f64,
            mtm: MainThreadMarker,
        ) -> Result<BrowserSessionState> {
            let session = self
                .sessions
                .get_mut(session_id)
                .ok_or_else(|| Error::not_found("the browser is not open for this session"))?;
            if session.tabs.len() >= MAX_TABS_PER_SESSION {
                // The new tab becomes active, so the oldest one can go.
                let (_, oldest) = session.tabs.remove(0);
                oldest.webview.removeFromSuperview();
            }
            let content = session.content_view.clone();
            let tab_id = format!("tab-{}", session.next_tab);
            session.next_tab += 1;
            let (webview, delegate) = unsafe {
                let config = WKWebViewConfiguration::new(mtm);
                config.setWebsiteDataStore(&WKWebsiteDataStore::defaultDataStore(mtm));
                // A laptop-sized page until the dock pane measures it, so a tab opened by
                // an agent or the phone lays out and captures like a real window (ADR-087).
                let frame = NSRect::new(NSPoint::new(0.0, 0.0), NSSize::new(1280.0, 800.0));
                let webview = WKWebView::initWithFrame_configuration(
                    mtm.alloc::<WKWebView>(),
                    frame,
                    &config,
                );
                webview.setCustomUserAgent(Some(&NSString::from_str(&safari_user_agent())));
                if NSObject::respondsToSelector(&webview, objc2::sel!(setInspectable:)) {
                    webview.setInspectable(true);
                }
                let bridge = WKUserScript::initWithSource_injectionTime_forMainFrameOnly(
                    mtm.alloc::<WKUserScript>(),
                    &NSString::from_str(PAGE_BRIDGE_SCRIPT),
                    WKUserScriptInjectionTime::AtDocumentStart,
                    true,
                );
                config.userContentController().addUserScript(&bridge);
                let delegate = BrowserNavigationDelegate::new(app, session_id, &tab_id, mtm);
                webview.setNavigationDelegate(Some(ProtocolObject::from_ref(&*delegate)));
                webview.setUIDelegate(Some(ProtocolObject::from_ref(&*delegate)));
                (webview, delegate)
            };
            webview.setHidden(true);
            content.addSubview(&webview);
            session.tabs.push((
                tab_id.clone(),
                TabRuntime {
                    webview,
                    _delegate: delegate,
                    url: String::new(),
                    title: String::new(),
                    loading: false,
                    can_go_back: false,
                    can_go_forward: false,
                    favicon_url: String::new(),
                    bounds: None,
                },
            ));
            session.active = Some(tab_id);
            if let Some(url) = url.filter(|value| is_allowed_browser_url(value)) {
                if let Some((_, tab)) = session.tabs.last() {
                    unsafe {
                        if let Some(ns_url) = NSURL::URLWithString(&NSString::from_str(&url)) {
                            tab.webview
                                .loadRequest(&NSURLRequest::requestWithURL(&ns_url));
                        }
                    }
                }
            }
            self.show_active(session_id, content_height);
            let session = self
                .sessions
                .get(session_id)
                .ok_or_else(|| Error::new("native", "the browser tab was not created"))?;
            Ok(session_state(session_id, session))
        }

        fn webview(&self, session_id: &str, tab_id: &str) -> Result<Retained<WKWebView>> {
            self.sessions
                .get(session_id)
                .and_then(|session| session.tabs.iter().find(|(id, _)| id == tab_id))
                .map(|(_, tab)| tab.webview.clone())
                .ok_or_else(|| Error::not_found("browser tab not found"))
        }

        fn tab_url(&self, session_id: &str, tab_id: &str) -> Option<String> {
            self.sessions
                .get(session_id)
                .and_then(|session| session.tabs.iter().find(|(id, _)| id == tab_id))
                .map(|(_, tab)| tab.url.clone())
        }

        fn open_popup_tab(
            &mut self,
            app: &AppHandle,
            session_id: &str,
            url: &str,
            mtm: MainThreadMarker,
        ) -> Option<BrowserSessionState> {
            let height = self
                .sessions
                .get(session_id)?
                .content_view
                .bounds()
                .size
                .height;
            self.new_tab(app, session_id, Some(url.to_string()), height, mtm)
                .ok()
        }

        fn mark_loading(&mut self, session_id: &str, tab_id: &str, url: &str) {
            if let Some(tab) = self
                .sessions
                .get_mut(session_id)
                .and_then(|session| session.tabs.iter_mut().find(|(id, _)| id == tab_id))
                .map(|(_, tab)| tab)
            {
                tab.loading = true;
                if !url.is_empty() {
                    tab.url = url.to_string();
                }
            }
        }

        fn close_tab(
            &mut self,
            session_id: &str,
            tab_id: &str,
            content_height: f64,
        ) -> Result<BrowserSessionState> {
            let session = self
                .sessions
                .get_mut(session_id)
                .ok_or_else(|| Error::not_found("the browser is not open for this session"))?;
            let position = session
                .tabs
                .iter()
                .position(|(id, _)| id == tab_id)
                .ok_or_else(|| Error::not_found("browser tab not found"))?;
            let (_, removed) = session.tabs.remove(position);
            removed.webview.removeFromSuperview();
            if session.active.as_deref() == Some(tab_id) {
                session.active = session.tabs.last().map(|(id, _)| id.clone());
            }
            self.show_active(session_id, content_height);
            let session = self
                .sessions
                .get(session_id)
                .ok_or_else(|| Error::new("native", "the browser session was closed"))?;
            Ok(session_state(session_id, session))
        }

        fn select_tab(
            &mut self,
            session_id: &str,
            tab_id: &str,
            content_height: f64,
        ) -> Result<BrowserSessionState> {
            let session = self
                .sessions
                .get_mut(session_id)
                .ok_or_else(|| Error::not_found("the browser is not open for this session"))?;
            if !session.tabs.iter().any(|(id, _)| id == tab_id) {
                return Err(Error::not_found("browser tab not found"));
            }
            session.active = Some(tab_id.into());
            self.show_active(session_id, content_height);
            let session = self
                .sessions
                .get(session_id)
                .ok_or_else(|| Error::not_found("the browser is not open for this session"))?;
            Ok(session_state(session_id, session))
        }

        fn navigate(
            &mut self,
            session_id: &str,
            tab_id: &str,
            url: &str,
        ) -> Result<BrowserSessionState> {
            if !is_allowed_browser_url(url) {
                return Err(Error::new(
                    "invalid",
                    "This URL cannot be opened in the browser.",
                ));
            }
            let webview = self.webview(session_id, tab_id)?;
            let request = NSURL::URLWithString(&NSString::from_str(url))
                .map(|ns_url| NSURLRequest::requestWithURL(&ns_url))
                .ok_or_else(|| {
                    Error::new("invalid", "This URL cannot be opened in the browser.")
                })?;
            unsafe {
                webview.loadRequest(&request);
            }
            self.mark_loading(session_id, tab_id, url);
            let session = self
                .sessions
                .get(session_id)
                .ok_or_else(|| Error::not_found("the browser is not open for this session"))?;
            Ok(session_state(session_id, session))
        }

        fn history(
            &mut self,
            session_id: &str,
            tab_id: &str,
            forward: bool,
        ) -> Result<BrowserSessionState> {
            let webview = self.webview(session_id, tab_id)?;
            unsafe {
                if forward {
                    webview.goForward();
                } else {
                    webview.goBack();
                }
            }
            self.mark_loading(session_id, tab_id, "");
            let session = self
                .sessions
                .get(session_id)
                .ok_or_else(|| Error::not_found("the browser is not open for this session"))?;
            Ok(session_state(session_id, session))
        }

        fn reload(&mut self, session_id: &str, tab_id: &str) -> Result<BrowserSessionState> {
            let webview = self.webview(session_id, tab_id)?;
            unsafe {
                webview.reload();
            }
            self.mark_loading(session_id, tab_id, "");
            let session = self
                .sessions
                .get(session_id)
                .ok_or_else(|| Error::not_found("the browser is not open for this session"))?;
            Ok(session_state(session_id, session))
        }

        fn set_bounds(
            &mut self,
            session_id: &str,
            bounds: Option<BrowserBounds>,
            content_height: f64,
        ) {
            let Some(session) = self.sessions.get_mut(session_id) else {
                return;
            };
            for (_, tab) in &mut session.tabs {
                tab.bounds = bounds.clone();
            }
            self.show_active(session_id, content_height);
        }

        /// Releases the least recently opened browsers beyond the live limit, never
        /// `current`. The renderer learns through `browser-state` and reopens on demand.
        fn release_idle(&mut self, app: &AppHandle, current: &str) {
            while self.sessions.len() > MAX_LIVE_SESSIONS {
                let Some(oldest) = self
                    .sessions
                    .iter()
                    .filter(|(id, _)| id.as_str() != current)
                    .min_by_key(|(_, session)| session.used)
                    .map(|(id, _)| id.clone())
                else {
                    return;
                };
                if let Some(session) = self.sessions.get(&oldest) {
                    let page = session
                        .active
                        .as_ref()
                        .and_then(|active| session.tabs.iter().find(|(id, _)| id == active))
                        .map(|(_, tab)| tab.url.clone())
                        .filter(|url| is_allowed_browser_url(url));
                    if let Some(page) = page {
                        if self.released.len() >= MAX_REMEMBERED_PAGES {
                            self.released.clear();
                        }
                        self.released.insert(oldest.clone(), page);
                    }
                }
                self.close(&oldest);
                let _ = app.emit("browser-state", BrowserSessionState::closed(&oldest));
            }
        }

        fn close(&mut self, session_id: &str) {
            if let Some(session) = self.sessions.remove(session_id) {
                for (_, tab) in session.tabs {
                    tab.webview.removeFromSuperview();
                }
            }
        }

        fn state(&self, session_id: &str) -> BrowserSessionState {
            self.sessions.get(session_id).map_or_else(
                || BrowserSessionState::closed(session_id),
                |session| session_state(session_id, session),
            )
        }
    }

    struct BrowserDelegateIvars {
        session_id: String,
        tab_id: String,
        app: AppHandle,
    }

    const FAVICON_SCRIPT: &str = r#"
(() => {
  const links = Array.from(document.querySelectorAll("link[rel]"));
  const icon = links.find((link) => /(^|\s)(icon|shortcut icon|apple-touch-icon)(\s|$)/i.test(link.rel) && link.href);
  return icon ? String(icon.href) : (location.origin + "/favicon.ico");
})()
"#;

    /// Fixed annotation overlay: hover outline + element HUD, click records an
    /// entry, Escape cancels. No renderer-provided script ever reaches the page.
    const ANNOTATE_START_SCRIPT: &str = r##"
(() => {
  const KEY = "__sirusAnnotations";
  const current = window[KEY];
  if (current && current.active) return "already";
  const entries = [];
  const nodes = [];
  const box = document.createElement("div");
  box.style.cssText = "position:fixed;pointer-events:none;z-index:2147483646;border:2px solid #3b82f6;border-radius:3px;box-shadow:0 0 0 1px rgba(59,130,246,.35);display:none";
  const hud = document.createElement("div");
  hud.style.cssText = "position:fixed;pointer-events:none;z-index:2147483647;display:none;background:rgba(10,10,10,.94);color:#f5f5f5;font:11px/17px ui-monospace,SFMono-Regular,Menlo,monospace;border-radius:8px;padding:7px 10px;white-space:pre;box-shadow:0 8px 24px rgba(0,0,0,.4)";
  const describe = (el) => {
    const rect = el.getBoundingClientRect();
    const style = getComputedStyle(el);
    const tag = el.tagName.toLowerCase();
    const name = el.getAttribute("aria-label") || el.getAttribute("placeholder") || el.getAttribute("title") || (el.innerText || "").trim().replace(/\s+/g, " ").slice(0, 60);
    return (name ? tag + " \"" + name + "\"" : tag)
      + "\n" + Math.round(rect.width) + "x" + Math.round(rect.height)
      + "\ncolor " + style.color
      + "\nfont " + style.fontSize + " " + style.fontFamily
      + "\npadding " + style.padding;
  };
  const selectorFor = (el) => {
    const parts = [];
    let node = el;
    while (node && node.nodeType === 1 && parts.length < 6) {
      let part = node.tagName.toLowerCase();
      if (node.id) { parts.unshift(part + "#" + node.id); break; }
      const parent = node.parentElement;
      if (parent) {
        const siblings = Array.from(parent.children).filter((child) => child.tagName === node.tagName);
        if (siblings.length > 1) part += ":nth-of-type(" + (siblings.indexOf(node) + 1) + ")";
      }
      parts.unshift(part);
      node = node.parentElement;
    }
    return parts.join(" > ").slice(0, 400);
  };
  const labelFor = (el) => {
    const tag = el.tagName.toLowerCase();
    const rect = el.getBoundingClientRect();
    const name = (el.getAttribute("aria-label") || el.getAttribute("placeholder") || el.getAttribute("title") || (el.innerText || "").trim().replace(/\s+/g, " ")).slice(0, 80);
    return name ? tag + " \"" + name + "\"" : tag + " " + Math.round(rect.width) + "x" + Math.round(rect.height);
  };
  const move = (event) => {
    const target = document.elementFromPoint(event.clientX, event.clientY);
    if (!target || target === box || target === hud) { box.style.display = "none"; hud.style.display = "none"; return; }
    const rect = target.getBoundingClientRect();
    box.style.display = "block";
    box.style.left = rect.left + "px"; box.style.top = rect.top + "px";
    box.style.width = rect.width + "px"; box.style.height = rect.height + "px";
    hud.textContent = describe(target);
    hud.style.display = "block";
    hud.style.left = Math.max(8, Math.min(event.clientX + 14, window.innerWidth - 260)) + "px";
    hud.style.top = Math.max(8, Math.min(event.clientY + 16, window.innerHeight - 130)) + "px";
  };
  const click = (event) => {
    const target = event.target;
    if (!target || target === box || target === hud) return;
    event.preventDefault();
    event.stopPropagation();
    const rect = target.getBoundingClientRect();
    const marker = document.createElement("div");
    marker.style.cssText = "position:fixed;pointer-events:none;z-index:2147483647;background:#3b82f6;color:#fff;border-radius:999px;font:600 10px/16px -apple-system,sans-serif;min-width:16px;height:16px;text-align:center;padding:0 4px;box-shadow:0 1px 4px rgba(0,0,0,.4)";
    marker.textContent = String(entries.length + 1);
    marker.style.left = Math.max(0, rect.left - 6) + "px";
    marker.style.top = Math.max(0, rect.top - 6) + "px";
    document.body.appendChild(marker);
    nodes.push(marker);
    entries.push({ selector: selectorFor(target), label: labelFor(target) });
  };
  const cancel = () => {
    document.removeEventListener("mousemove", move, true);
    document.removeEventListener("click", click, true);
    document.removeEventListener("keydown", key, true);
    box.remove();
    hud.remove();
    nodes.forEach((node) => node.remove());
    window[KEY] = null;
  };
  const key = (event) => { if (event.key === "Escape") cancel(); };
  document.addEventListener("mousemove", move, true);
  document.addEventListener("click", click, true);
  document.addEventListener("keydown", key, true);
  document.body.appendChild(box);
  document.body.appendChild(hud);
  window[KEY] = { active: true, entries, cancel };
  return "started";
})()
"##;

    const ANNOTATE_FINISH_SCRIPT: &str = r#"
(() => {
  const current = window.__sirusAnnotations;
  if (!current) return "[]";
  const raw = JSON.stringify(current.entries || []);
  current.cancel();
  return raw;
})()
"#;

    const ANNOTATE_CANCEL_SCRIPT: &str = r#"
(() => {
  const current = window.__sirusAnnotations;
  if (current) current.cancel();
  return "cancelled";
})()
"#;

    /// Document-start bridge: human-input timestamps for takeover detection and
    /// a bounded console log buffer for `browser_logs`.
    const PAGE_BRIDGE_SCRIPT: &str = r##"
(() => {
  window.__sirusHumanAt = window.__sirusHumanAt || 0;
  const mark = () => { window.__sirusHumanAt = Date.now(); };
  document.addEventListener("pointerdown", mark, true);
  document.addEventListener("keydown", mark, true);
  document.addEventListener("wheel", mark, true);
  window.__sirusLogs = window.__sirusLogs || [];
  const push = (level, args) => {
    try {
      window.__sirusLogs.push({ level, text: Array.from(args).map(String).join(" ").slice(0, 500), at: Date.now() });
      if (window.__sirusLogs.length > 200) window.__sirusLogs.shift();
    } catch {}
  };
  for (const level of ["log", "warn", "error", "info"]) {
    const original = console[level];
    console[level] = (...args) => { push(level, args); original.apply(console, args); };
  }
  window.addEventListener("error", (event) => push("error", [event.message]));
  window.addEventListener("unhandledrejection", (event) => push("error", [String(event.reason)]));
})()
"##;

    const SNAPSHOT_SCRIPT: &str = r##"
const nodes = Array.from(document.querySelectorAll("a,button,input,textarea,select,[role='button'],[role='link'],[contenteditable='true']"));
const elements = [];
let count = 0;
for (const el of nodes) {
  if (elements.length >= 200) break;
  const rect = el.getBoundingClientRect();
  if (rect.width < 1 || rect.height < 1) continue;
  const ref = "e" + (++count);
  el.setAttribute("data-sirus-ref", ref);
  elements.push({
    ref,
    tag: el.tagName.toLowerCase(),
    role: el.getAttribute("role") || "",
    name: (el.getAttribute("aria-label") || el.getAttribute("placeholder") || el.innerText || el.value || "").trim().slice(0, 120),
    value: (el.value ?? "").toString().slice(0, 80),
    disabled: !!el.disabled,
  });
}
return JSON.stringify({ url: location.href, title: document.title, elements });
"##;

    const CLICK_SCRIPT: &str = r##"
const input = JSON.parse(args);
const ref = input.ref;
const selector = input.selector;
if (Date.now() - (window.__sirusHumanAt || 0) < 1500) return JSON.stringify({ interrupted: true });
const target = ref ? document.querySelector("[data-sirus-ref='" + ref + "']") : (selector ? document.querySelector(selector) : null);
if (!target) return JSON.stringify({ ok: false, error: "element not found" });
target.scrollIntoView({ block: "center" });
target.click();
return JSON.stringify({ ok: true });
"##;

    const TYPE_SCRIPT: &str = r##"
const input = JSON.parse(args);
const ref = input.ref;
const selector = input.selector;
const text = input.text;
const submit = input.submit;
if (Date.now() - (window.__sirusHumanAt || 0) < 1500) return JSON.stringify({ interrupted: true });
const target = ref ? document.querySelector("[data-sirus-ref='" + ref + "']") : (selector ? document.querySelector(selector) : null);
if (!target) return JSON.stringify({ ok: false, error: "element not found" });
target.focus();
const next = text ?? "";
if (target.isContentEditable) {
  target.textContent = next;
} else if (target instanceof HTMLSelectElement) {
  target.value = next;
} else {
  const proto = target instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
  if (setter) setter.call(target, next); else target.value = next;
}
target.dispatchEvent(new Event("input", { bubbles: true }));
target.dispatchEvent(new Event("change", { bubbles: true }));
if (submit) {
  target.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  if (target.form && typeof target.form.requestSubmit === "function") target.form.requestSubmit();
}
return JSON.stringify({ ok: true });
"##;

    const SCROLL_SCRIPT: &str = r##"
const input = JSON.parse(args);
const dy = input.dy;
if (Date.now() - (window.__sirusHumanAt || 0) < 1500) return JSON.stringify({ interrupted: true });
window.scrollBy({ top: dy ?? 0, left: 0, behavior: "auto" });
return JSON.stringify({ ok: true, y: window.scrollY });
"##;

    /// A key on the focused element (ADR-087). `human` marks the person's own action
    /// (the phone), which pauses agent actions like a local click does.
    const PRESS_SCRIPT: &str = r##"
const input = JSON.parse(args);
const key = input.key;
if (input.human) window.__sirusHumanAt = Date.now();
else if (Date.now() - (window.__sirusHumanAt || 0) < 1500) return JSON.stringify({ interrupted: true });
const target = document.activeElement && document.activeElement !== document.documentElement ? document.activeElement : document.body;
const init = { key, code: key === " " ? "Space" : key, bubbles: true, cancelable: true };
const proceed = target.dispatchEvent(new KeyboardEvent("keydown", init));
if (proceed) {
  const field = target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement;
  if (key === "Enter") {
    if (target instanceof HTMLTextAreaElement) {
      target.setRangeText("\n", target.selectionStart ?? target.value.length, target.selectionEnd ?? target.value.length, "end");
      target.dispatchEvent(new Event("input", { bubbles: true }));
    } else {
      const form = target.form || (target.closest ? target.closest("form") : null);
      if (form) { if (form.requestSubmit) form.requestSubmit(); else form.submit(); }
      else if (target instanceof HTMLElement && !field) target.click();
    }
  } else if (key === "Backspace" && field && target.value) {
    const end = target.selectionEnd ?? target.value.length;
    const start = target.selectionStart === end ? Math.max(0, end - 1) : (target.selectionStart ?? end - 1);
    target.setRangeText("", start, end, "end");
    target.dispatchEvent(new Event("input", { bubbles: true }));
  } else if (key === "Tab") {
    const items = [...document.querySelectorAll("a[href],button,input,select,textarea,[tabindex]:not([tabindex='-1']),[contenteditable='true']")].filter((item) => !item.disabled && item.offsetParent !== null);
    const next = items[(items.indexOf(target) + 1) % Math.max(1, items.length)];
    if (next) next.focus();
  } else if (!field) {
    const page = window.innerHeight * 0.85;
    const moves = { ArrowDown: 80, ArrowUp: -80, PageDown: page, PageUp: -page, " ": page, Home: -1e9, End: 1e9 };
    if (key in moves) window.scrollBy({ top: moves[key], behavior: "auto" });
  }
}
target.dispatchEvent(new KeyboardEvent("keyup", init));
return JSON.stringify({ ok: true });
"##;

    /// Waits until a text or selector shows up, at most 8 s (ADR-087).
    const WAIT_SCRIPT: &str = r##"
const input = JSON.parse(args);
const deadline = Date.now() + Math.min(8000, Math.max(100, input.timeoutMs || 5000));
const found = () => input.selector ? Boolean(document.querySelector(input.selector)) : (document.body ? document.body.innerText : "").includes(input.text);
try { found(); } catch { return JSON.stringify({ ok: false, error: "invalid selector" }); }
while (Date.now() < deadline) {
  if (found()) return JSON.stringify({ ok: true });
  await new Promise((resolve) => setTimeout(resolve, 150));
}
return JSON.stringify({ ok: false, error: "timed out waiting" });
"##;

    /// The person taps the page from the phone: `x` and `y` are fractions of the visible
    /// viewport, the same area the screenshot shows (ADR-087).
    const TAP_SCRIPT: &str = r##"
const input = JSON.parse(args);
window.__sirusHumanAt = Date.now();
const x = input.x * window.innerWidth;
const y = input.y * window.innerHeight;
const target = document.elementFromPoint(x, y);
if (!target) return JSON.stringify({ ok: false, error: "nothing there" });
const options = { bubbles: true, cancelable: true, clientX: x, clientY: y, view: window, pointerType: "touch", isPrimary: true };
target.dispatchEvent(new PointerEvent("pointerdown", options));
target.dispatchEvent(new MouseEvent("mousedown", options));
target.dispatchEvent(new PointerEvent("pointerup", options));
target.dispatchEvent(new MouseEvent("mouseup", options));
const field = target.closest ? target.closest("input,textarea,select,[contenteditable='true']") : null;
if (field && field.focus) field.focus();
target.click();
return JSON.stringify({ ok: true, editable: Boolean(field) });
"##;

    /// The person types from the phone into whatever is focused (ADR-087).
    const INSERT_SCRIPT: &str = r##"
const input = JSON.parse(args);
window.__sirusHumanAt = Date.now();
const target = document.activeElement;
if (!target || target === document.body) return JSON.stringify({ ok: false, error: "tap a field first" });
if (target.isContentEditable) {
  document.execCommand("insertText", false, input.text);
} else if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
  const end = target.selectionEnd ?? target.value.length;
  target.setRangeText(input.text, target.selectionStart ?? end, end, "end");
  target.dispatchEvent(new Event("input", { bubbles: true }));
  target.dispatchEvent(new Event("change", { bubbles: true }));
} else {
  return JSON.stringify({ ok: false, error: "tap a field first" });
}
if (input.submit) {
  const form = target.form || (target.closest ? target.closest("form") : null);
  if (form) { if (form.requestSubmit) form.requestSubmit(); else form.submit(); }
}
return JSON.stringify({ ok: true });
"##;

    const HUMAN_SCROLL_SCRIPT: &str = r##"
const input = JSON.parse(args);
window.__sirusHumanAt = Date.now();
window.scrollBy({ top: input.fraction !== undefined ? input.fraction * window.innerHeight : input.dy, left: 0, behavior: "auto" });
return JSON.stringify({ ok: true, y: window.scrollY });
"##;

    const LOGS_SCRIPT: &str = r##"
const input = JSON.parse(args);
const clear = input.clear;
const logs = window.__sirusLogs || [];
const result = JSON.stringify(logs.slice(-200));
if (clear) window.__sirusLogs = [];
return result;
"##;

    define_class!(
        #[unsafe(super(NSObject))]
        #[thread_kind = MainThreadOnly]
        #[ivars = BrowserDelegateIvars]
        struct BrowserNavigationDelegate;

        unsafe impl NSObjectProtocol for BrowserNavigationDelegate {}

        unsafe impl WKNavigationDelegate for BrowserNavigationDelegate {
            #[unsafe(method(webView:decidePolicyForNavigationAction:decisionHandler:))]
            fn decide_policy(
                &self,
                _webview: &WKWebView,
                action: &WKNavigationAction,
                handler: &block2::Block<dyn Fn(WKNavigationActionPolicy)>,
            ) {
                let allowed = unsafe {
                    !action.shouldPerformDownload()
                        && action
                            .request()
                            .URL()
                            .and_then(|value| value.absoluteString())
                            .is_some_and(|value| is_allowed_browser_url(&value.to_string()))
                };
                (*handler).call((if allowed {
                    WKNavigationActionPolicy::Allow
                } else {
                    WKNavigationActionPolicy::Cancel
                },));
            }

            #[unsafe(method(webView:didStartProvisionalNavigation:))]
            fn did_start(&self, webview: &WKWebView, _navigation: Option<&WKNavigation>) {
                self.publish(webview, true);
            }

            #[unsafe(method(webView:didFinishNavigation:))]
            fn did_finish(&self, webview: &WKWebView, _navigation: Option<&WKNavigation>) {
                self.publish(webview, false);
                self.request_favicon(webview);
            }

            #[unsafe(method(webView:didFailProvisionalNavigation:withError:))]
            fn did_fail_provisional(
                &self,
                webview: &WKWebView,
                _navigation: Option<&WKNavigation>,
                _error: &NSError,
            ) {
                self.publish(webview, false);
            }

            #[unsafe(method(webView:didFailNavigation:withError:))]
            fn did_fail(
                &self,
                webview: &WKWebView,
                _navigation: Option<&WKNavigation>,
                _error: &NSError,
            ) {
                self.publish(webview, false);
            }
        }

        unsafe impl WKUIDelegate for BrowserNavigationDelegate {
            /// Popups (`target=_blank`, OAuth) become internal tabs instead of
            /// native windows; the popup itself is cancelled.
            #[unsafe(method_id(webView:createWebViewWithConfiguration:forNavigationAction:windowFeatures:))]
            fn create_webview(
                &self,
                _webview: &WKWebView,
                _configuration: &WKWebViewConfiguration,
                action: &WKNavigationAction,
                _features: &WKWindowFeatures,
            ) -> Option<Retained<WKWebView>> {
                let ivars = self.ivars();
                let url = unsafe {
                    action
                        .request()
                        .URL()
                        .and_then(|value| value.absoluteString())
                        .map(|value| value.to_string())
                        .unwrap_or_default()
                };
                if is_allowed_browser_url(&url) {
                    if let Some(mtm) = MainThreadMarker::new() {
                        let state = with_manager(|manager| {
                            manager.open_popup_tab(&ivars.app, &ivars.session_id, &url, mtm)
                        })
                        .ok()
                        .flatten();
                        if let Some(state) = state {
                            let _ = ivars.app.emit("browser-state", state);
                        }
                    }
                }
                None
            }
        }
    );

    impl BrowserNavigationDelegate {
        fn new(
            app: &AppHandle,
            session_id: &str,
            tab_id: &str,
            mtm: MainThreadMarker,
        ) -> Retained<Self> {
            let delegate = mtm.alloc::<Self>().set_ivars(BrowserDelegateIvars {
                session_id: session_id.into(),
                tab_id: tab_id.into(),
                app: app.clone(),
            });
            unsafe { msg_send![super(delegate), init] }
        }

        fn publish(&self, webview: &WKWebView, loading: bool) {
            let ivars = self.ivars();
            let state = with_manager(|manager| {
                manager.sync_from_webview(&ivars.session_id, &ivars.tab_id, webview, loading)
            })
            .ok()
            .flatten();
            if let Some(state) = state {
                let _ = ivars.app.emit("browser-state", state);
            }
        }

        fn request_favicon(&self, webview: &WKWebView) {
            let ivars = self.ivars();
            let app = ivars.app.clone();
            let session_id = ivars.session_id.clone();
            let tab_id = ivars.tab_id.clone();
            let handler = RcBlock::new(move |value: *mut AnyObject, _error: *mut NSError| {
                if value.is_null() {
                    return;
                }
                let text = unsafe { (*value.cast::<NSString>()).to_string() };
                if !is_allowed_favicon_url(&text) {
                    return;
                }
                let state =
                    with_manager(|manager| manager.set_favicon(&session_id, &tab_id, &text))
                        .ok()
                        .flatten();
                if let Some(state) = state {
                    let _ = app.emit("browser-state", state);
                }
            });
            unsafe {
                webview.evaluateJavaScript_completionHandler(
                    &NSString::from_str(FAVICON_SCRIPT),
                    Some(&handler),
                );
            }
        }
    }

    fn evaluate_script(
        app: &AppHandle,
        session_id: &str,
        tab_id: &str,
        script: &'static str,
    ) -> Result<String> {
        let (sender, receiver) = mpsc::channel::<String>();
        let session_id = session_id.to_string();
        let tab_id = tab_id.to_string();
        on_main(app, move || -> Result<()> {
            let webview = with_manager(|manager| manager.webview(&session_id, &tab_id))??;
            let handler = RcBlock::new(move |value: *mut AnyObject, _error: *mut NSError| {
                let text = if value.is_null() {
                    String::new()
                } else {
                    unsafe { (*value.cast::<NSString>()).to_string() }
                };
                let _ = sender.send(text);
            });
            unsafe {
                webview.evaluateJavaScript_completionHandler(
                    &NSString::from_str(script),
                    Some(&handler),
                );
            }
            Ok(())
        })??;
        receiver
            .recv_timeout(Duration::from_secs(5))
            .map_err(|_| Error::new("native", "the page did not answer in time"))
    }

    pub fn annotate_start(app: &AppHandle, session_id: &str, tab_id: &str) -> Result<()> {
        evaluate_script(app, session_id, tab_id, ANNOTATE_START_SCRIPT).map(|_| ())
    }

    pub fn annotate_finish(
        app: &AppHandle,
        session_id: &str,
        tab_id: &str,
    ) -> Result<Vec<BrowserAnnotation>> {
        let raw = evaluate_script(app, session_id, tab_id, ANNOTATE_FINISH_SCRIPT)?;
        Ok(parse_browser_annotations(&raw))
    }

    pub fn annotate_cancel(app: &AppHandle, session_id: &str, tab_id: &str) -> Result<()> {
        evaluate_script(app, session_id, tab_id, ANNOTATE_CANCEL_SCRIPT).map(|_| ())
    }

    pub fn copy_link(app: &AppHandle, session_id: &str, tab_id: &str) -> Result<()> {
        let session_id = session_id.to_string();
        let tab_id = tab_id.to_string();
        on_main(app, move || -> Result<()> {
            let url = with_manager(|manager| manager.tab_url(&session_id, &tab_id))
                .ok()
                .flatten()
                .filter(|url| is_allowed_browser_url(url))
                .ok_or_else(|| Error::new("invalid", "There is no page to copy."))?;
            unsafe {
                let pasteboard = NSPasteboard::generalPasteboard();
                pasteboard.clearContents();
                pasteboard.setString_forType(&NSString::from_str(&url), NSPasteboardTypeString);
            }
            Ok(())
        })?
    }

    pub fn capture(app: &AppHandle, session_id: &str, tab_id: &str) -> Result<String> {
        snapshot(app, session_id, tab_id, false)
    }

    /// A small JPEG of the visible page for the phone, which polls it (ADR-087).
    pub fn preview(app: &AppHandle, session_id: &str, tab_id: &str) -> Result<String> {
        snapshot(app, session_id, tab_id, true)
    }

    fn snapshot(app: &AppHandle, session_id: &str, tab_id: &str, small: bool) -> Result<String> {
        use base64::Engine as _;
        let (sender, receiver) = mpsc::channel::<Result<String>>();
        let session_id = session_id.to_string();
        let tab_id = tab_id.to_string();
        on_main(app, move || -> Result<()> {
            let mtm = MainThreadMarker::new()
                .ok_or_else(|| Error::new("native", "the browser must run on the main thread"))?;
            let webview = with_manager(|manager| manager.webview(&session_id, &tab_id))??;
            let handler = RcBlock::new(move |image: *mut NSImage, error: *mut NSError| {
                let result = unsafe {
                    if image.is_null() {
                        let message = error
                            .as_ref()
                            .map(|error| error.localizedDescription().to_string())
                            .unwrap_or_else(|| "Could not capture the page.".into());
                        Err(Error::new("native", message))
                    } else {
                        let image = image.as_ref().expect("checked");
                        let png = image
                            .TIFFRepresentation()
                            .and_then(|data| {
                                NSBitmapImageRep::initWithData(NSBitmapImageRep::alloc(), &data)
                            })
                            .and_then(|rep| {
                                if small {
                                    let quality = NSNumber::new_f64(0.6);
                                    let quality: &AnyObject = quality.as_ref();
                                    let properties = NSDictionary::from_slices(
                                        &[NSImageCompressionFactor],
                                        &[quality],
                                    );
                                    rep.representationUsingType_properties(
                                        NSBitmapImageFileType::JPEG,
                                        &properties,
                                    )
                                } else {
                                    rep.representationUsingType_properties(
                                        NSBitmapImageFileType::PNG,
                                        &NSDictionary::new(),
                                    )
                                }
                            });
                        match png {
                            Some(png) if png.len() <= 8 * 1024 * 1024 => {
                                Ok(base64::engine::general_purpose::STANDARD.encode(png.to_vec()))
                            }
                            Some(_) => Err(Error::new("native", "The screenshot is too large.")),
                            None => Err(Error::new("native", "Could not encode the screenshot.")),
                        }
                    }
                };
                let _ = sender.send(result);
            });
            let configuration = small.then(|| unsafe {
                let configuration = WKSnapshotConfiguration::new(mtm);
                configuration.setSnapshotWidth(Some(&NSNumber::new_f64(720.0)));
                configuration
            });
            unsafe {
                webview.takeSnapshotWithConfiguration_completionHandler(
                    configuration.as_deref(),
                    &handler,
                );
            }
            Ok(())
        })??;
        receiver
            .recv_timeout(Duration::from_secs(10))
            .map_err(|_| Error::new("native", "the page did not answer in time"))?
    }

    fn call_page(
        app: &AppHandle,
        session_id: &str,
        tab_id: &str,
        body: &'static str,
        args: serde_json::Value,
    ) -> Result<String> {
        let (sender, receiver) = mpsc::channel::<String>();
        let session_id = session_id.to_string();
        let tab_id = tab_id.to_string();
        let json = serde_json::to_string(&args)
            .map_err(|_| Error::new("invalid", "Invalid page arguments."))?;
        on_main(app, move || -> Result<()> {
            let mtm = MainThreadMarker::new()
                .ok_or_else(|| Error::new("native", "the browser must run on the main thread"))?;
            let webview = with_manager(|manager| manager.webview(&session_id, &tab_id))??;
            let dictionary: Retained<NSMutableDictionary<NSString, AnyObject>> =
                NSMutableDictionary::new();
            let value = NSString::from_str(&json);
            let object: &AnyObject = value.as_ref();
            let key = NSString::from_str("args");
            // SAFETY: this dictionary has NSString keys, and key implements NSCopying.
            unsafe { dictionary.setObject_forKey(object, ProtocolObject::from_ref(&*key)) };
            let handler = RcBlock::new(move |value: *mut AnyObject, _error: *mut NSError| {
                let text = if value.is_null() {
                    String::new()
                } else {
                    unsafe { (*value.cast::<NSString>()).to_string() }
                };
                let _ = sender.send(text);
            });
            unsafe {
                webview.callAsyncJavaScript_arguments_inFrame_inContentWorld_completionHandler(
                    &NSString::from_str(body),
                    Some(&dictionary),
                    None,
                    &WKContentWorld::pageWorld(mtm),
                    Some(&handler),
                );
            }
            Ok(())
        })??;
        receiver
            .recv_timeout(Duration::from_secs(10))
            .map_err(|_| Error::new("native", "the page did not answer in time"))
    }

    fn active_tab(app: &AppHandle, session_id: &str) -> Result<String> {
        let session_id = session_id.to_string();
        on_main(app, move || -> Result<String> {
            let state = with_manager(|manager| manager.state(&session_id))?;
            state
                .active_tab_id
                .ok_or_else(|| Error::new("invalid", "No browser tab is open."))
        })?
    }

    fn opened_active_tab(app: &AppHandle, session_id: &str) -> Result<String> {
        if let Ok(tab_id) = active_tab(app, session_id) {
            return Ok(tab_id);
        }
        let state = open(app, session_id)?;
        state
            .active_tab_id
            .ok_or_else(|| Error::new("invalid", "No browser tab is open."))
    }

    fn page_action(
        app: &AppHandle,
        session_id: &str,
        body: &'static str,
        args: serde_json::Value,
    ) -> Result<String> {
        let tab_id = opened_active_tab(app, session_id)?;
        call_page(app, session_id, &tab_id, body, args)
    }

    pub fn mcp_status(app: &AppHandle, session_id: &str) -> Result<BrowserSessionState> {
        state(app, session_id)
    }

    pub fn mcp_open(
        app: &AppHandle,
        session_id: &str,
        url: Option<String>,
    ) -> Result<BrowserSessionState> {
        let state = open(app, session_id)?;
        let Some(url) = url.filter(|url| is_allowed_browser_url(url)) else {
            return Ok(state);
        };
        match state.active_tab_id {
            Some(tab_id)
                if !state
                    .tabs
                    .iter()
                    .any(|tab| tab.id == tab_id && tab.url == url) =>
            {
                navigate(app, session_id, &tab_id, &url)
            }
            _ => Ok(state),
        }
    }

    pub fn mcp_navigate(
        app: &AppHandle,
        session_id: &str,
        url: &str,
    ) -> Result<BrowserSessionState> {
        let tab_id = opened_active_tab(app, session_id)?;
        navigate(app, session_id, &tab_id, url)
    }

    pub fn mcp_back(app: &AppHandle, session_id: &str) -> Result<BrowserSessionState> {
        let tab_id = active_tab(app, session_id)?;
        back(app, session_id, &tab_id)
    }

    pub fn mcp_forward(app: &AppHandle, session_id: &str) -> Result<BrowserSessionState> {
        let tab_id = active_tab(app, session_id)?;
        forward(app, session_id, &tab_id)
    }

    pub fn mcp_reload(app: &AppHandle, session_id: &str) -> Result<BrowserSessionState> {
        let tab_id = active_tab(app, session_id)?;
        reload(app, session_id, &tab_id)
    }

    pub fn mcp_close(app: &AppHandle, session_id: &str) -> Result<()> {
        close(app, session_id)
    }

    pub fn mcp_capture(app: &AppHandle, session_id: &str) -> Result<String> {
        let tab_id = active_tab(app, session_id)?;
        capture(app, session_id, &tab_id)
    }

    pub fn mcp_snapshot(app: &AppHandle, session_id: &str) -> Result<String> {
        page_action(app, session_id, SNAPSHOT_SCRIPT, serde_json::json!({}))
    }

    pub fn mcp_click(
        app: &AppHandle,
        session_id: &str,
        reference: &str,
        selector: &str,
    ) -> Result<String> {
        page_action(
            app,
            session_id,
            CLICK_SCRIPT,
            serde_json::json!({ "ref": reference, "selector": selector }),
        )
    }

    pub fn mcp_type(
        app: &AppHandle,
        session_id: &str,
        reference: &str,
        selector: &str,
        text: &str,
        submit: bool,
    ) -> Result<String> {
        page_action(
            app,
            session_id,
            TYPE_SCRIPT,
            serde_json::json!({ "ref": reference, "selector": selector, "text": text, "submit": submit }),
        )
    }

    pub fn mcp_press(app: &AppHandle, session_id: &str, key: &str) -> Result<String> {
        page_action(
            app,
            session_id,
            PRESS_SCRIPT,
            serde_json::json!({ "key": key }),
        )
    }

    pub fn mcp_wait_for(
        app: &AppHandle,
        session_id: &str,
        text: &str,
        selector: &str,
        timeout_ms: u64,
    ) -> Result<String> {
        page_action(
            app,
            session_id,
            WAIT_SCRIPT,
            serde_json::json!({ "text": text, "selector": selector, "timeoutMs": timeout_ms }),
        )
    }

    /// The person's own action on a tab, from a paired phone (ADR-087).
    pub fn person_action(
        app: &AppHandle,
        session_id: &str,
        tab_id: &str,
        action: &super::PersonAction,
    ) -> Result<String> {
        let (body, args) = match action {
            super::PersonAction::Tap { x, y } => {
                (TAP_SCRIPT, serde_json::json!({ "x": x, "y": y }))
            }
            super::PersonAction::Type { text, submit } => (
                INSERT_SCRIPT,
                serde_json::json!({ "text": text, "submit": submit }),
            ),
            super::PersonAction::Key { key } => (
                PRESS_SCRIPT,
                serde_json::json!({ "key": key, "human": true }),
            ),
            super::PersonAction::Scroll { dy } => {
                (HUMAN_SCROLL_SCRIPT, serde_json::json!({ "dy": dy }))
            }
            super::PersonAction::Swipe { fraction } => (
                HUMAN_SCROLL_SCRIPT,
                serde_json::json!({ "fraction": fraction }),
            ),
        };
        call_page(app, session_id, tab_id, body, args)
    }

    pub fn mcp_scroll(app: &AppHandle, session_id: &str, dy: f64) -> Result<String> {
        page_action(
            app,
            session_id,
            SCROLL_SCRIPT,
            serde_json::json!({ "dy": dy }),
        )
    }

    pub fn mcp_logs(app: &AppHandle, session_id: &str, clear: bool) -> Result<String> {
        page_action(
            app,
            session_id,
            LOGS_SCRIPT,
            serde_json::json!({ "clear": clear }),
        )
    }

    pub fn open(app: &AppHandle, session_id: &str) -> Result<BrowserSessionState> {
        let main_app = app.clone();
        let session_id = session_id.to_string();
        let pointer = main_window_pointer(app)?;
        on_main(app, move || -> Result<BrowserSessionState> {
            let mtm = MainThreadMarker::new()
                .ok_or_else(|| Error::new("native", "the browser must start on the main thread"))?;
            let (content, height) = window_content(pointer)?;
            with_manager(|manager| manager.open(&main_app, &session_id, &content, height, mtm))?
        })?
    }

    pub fn close(app: &AppHandle, session_id: &str) -> Result<()> {
        let session_id = session_id.to_string();
        on_main(app, move || {
            with_manager(|manager| manager.close(&session_id))
        })?
    }

    pub fn state(app: &AppHandle, session_id: &str) -> Result<BrowserSessionState> {
        let session_id = session_id.to_string();
        on_main(app, move || {
            with_manager(|manager| manager.state(&session_id))
                .unwrap_or_else(|_| BrowserSessionState::closed(&session_id))
        })
    }

    fn session_operation(
        app: &AppHandle,
        operation: impl FnOnce(&mut BrowserManager, f64) -> Result<BrowserSessionState> + Send + 'static,
    ) -> Result<BrowserSessionState> {
        let pointer = main_window_pointer(app)?;
        on_main(app, move || -> Result<BrowserSessionState> {
            let (_, height) = window_content(pointer)?;
            with_manager(|manager| operation(manager, height))?
        })?
    }

    pub fn new_tab(
        app: &AppHandle,
        session_id: &str,
        url: Option<String>,
    ) -> Result<BrowserSessionState> {
        let main_app = app.clone();
        let session_id = session_id.to_string();
        let pointer = main_window_pointer(app)?;
        on_main(app, move || -> Result<BrowserSessionState> {
            let mtm = MainThreadMarker::new()
                .ok_or_else(|| Error::new("native", "the browser must start on the main thread"))?;
            let (_, height) = window_content(pointer)?;
            with_manager(|manager| {
                manager.new_tab(&main_app, &session_id, url.clone(), height, mtm)
            })?
        })?
    }

    pub fn close_tab(
        app: &AppHandle,
        session_id: &str,
        tab_id: &str,
    ) -> Result<BrowserSessionState> {
        let session_id = session_id.to_string();
        let tab_id = tab_id.to_string();
        session_operation(app, move |manager, height| {
            manager.close_tab(&session_id, &tab_id, height)
        })
    }

    pub fn select_tab(
        app: &AppHandle,
        session_id: &str,
        tab_id: &str,
    ) -> Result<BrowserSessionState> {
        let session_id = session_id.to_string();
        let tab_id = tab_id.to_string();
        session_operation(app, move |manager, height| {
            manager.select_tab(&session_id, &tab_id, height)
        })
    }

    pub fn navigate(
        app: &AppHandle,
        session_id: &str,
        tab_id: &str,
        url: &str,
    ) -> Result<BrowserSessionState> {
        let session_id = session_id.to_string();
        let tab_id = tab_id.to_string();
        let url = url.to_string();
        session_operation(app, move |manager, _| {
            manager.navigate(&session_id, &tab_id, &url)
        })
    }

    pub fn reload(app: &AppHandle, session_id: &str, tab_id: &str) -> Result<BrowserSessionState> {
        let session_id = session_id.to_string();
        let tab_id = tab_id.to_string();
        session_operation(app, move |manager, _| manager.reload(&session_id, &tab_id))
    }

    pub fn back(app: &AppHandle, session_id: &str, tab_id: &str) -> Result<BrowserSessionState> {
        let session_id = session_id.to_string();
        let tab_id = tab_id.to_string();
        session_operation(app, move |manager, _| {
            manager.history(&session_id, &tab_id, false)
        })
    }

    pub fn forward(app: &AppHandle, session_id: &str, tab_id: &str) -> Result<BrowserSessionState> {
        let session_id = session_id.to_string();
        let tab_id = tab_id.to_string();
        session_operation(app, move |manager, _| {
            manager.history(&session_id, &tab_id, true)
        })
    }

    pub fn set_bounds(
        app: &AppHandle,
        session_id: &str,
        bounds: Option<BrowserBounds>,
    ) -> Result<()> {
        let session_id = session_id.to_string();
        let pointer = main_window_pointer(app).ok();
        on_main(app, move || {
            let height = pointer
                .and_then(|pointer| window_content(pointer).ok())
                .map(|(_, height)| height)
                .unwrap_or(0.0);
            with_manager(|manager| manager.set_bounds(&session_id, bounds.clone(), height))
        })?
    }
}

#[cfg(not(target_os = "macos"))]
mod platform {
    use tauri::AppHandle;

    use super::{BrowserAnnotation, BrowserBounds, BrowserSessionState};
    use crate::error::{Error, Result};

    fn unsupported() -> Error {
        Error::new(
            "unsupported",
            "The embedded browser is only available on macOS.",
        )
    }

    pub fn open(_app: &AppHandle, _session_id: &str) -> Result<BrowserSessionState> {
        Err(unsupported())
    }

    pub fn close(_app: &AppHandle, _session_id: &str) -> Result<()> {
        Err(unsupported())
    }

    pub fn state(_app: &AppHandle, session_id: &str) -> Result<BrowserSessionState> {
        Ok(BrowserSessionState::closed(session_id))
    }

    pub fn new_tab(
        _app: &AppHandle,
        _session_id: &str,
        _url: Option<String>,
    ) -> Result<BrowserSessionState> {
        Err(unsupported())
    }

    pub fn close_tab(
        _app: &AppHandle,
        _session_id: &str,
        _tab_id: &str,
    ) -> Result<BrowserSessionState> {
        Err(unsupported())
    }

    pub fn select_tab(
        _app: &AppHandle,
        _session_id: &str,
        _tab_id: &str,
    ) -> Result<BrowserSessionState> {
        Err(unsupported())
    }

    pub fn navigate(
        _app: &AppHandle,
        _session_id: &str,
        _tab_id: &str,
        _url: &str,
    ) -> Result<BrowserSessionState> {
        Err(unsupported())
    }

    pub fn reload(
        _app: &AppHandle,
        _session_id: &str,
        _tab_id: &str,
    ) -> Result<BrowserSessionState> {
        Err(unsupported())
    }

    pub fn back(_app: &AppHandle, _session_id: &str, _tab_id: &str) -> Result<BrowserSessionState> {
        Err(unsupported())
    }

    pub fn forward(
        _app: &AppHandle,
        _session_id: &str,
        _tab_id: &str,
    ) -> Result<BrowserSessionState> {
        Err(unsupported())
    }

    pub fn set_bounds(
        _app: &AppHandle,
        _session_id: &str,
        _bounds: Option<BrowserBounds>,
    ) -> Result<()> {
        Err(unsupported())
    }

    pub fn annotate_start(_app: &AppHandle, _session_id: &str, _tab_id: &str) -> Result<()> {
        Err(unsupported())
    }

    pub fn annotate_finish(
        _app: &AppHandle,
        _session_id: &str,
        _tab_id: &str,
    ) -> Result<Vec<BrowserAnnotation>> {
        Err(unsupported())
    }

    pub fn annotate_cancel(_app: &AppHandle, _session_id: &str, _tab_id: &str) -> Result<()> {
        Err(unsupported())
    }

    pub fn copy_link(_app: &AppHandle, _session_id: &str, _tab_id: &str) -> Result<()> {
        Err(unsupported())
    }

    pub fn capture(_app: &AppHandle, _session_id: &str, _tab_id: &str) -> Result<String> {
        Err(unsupported())
    }

    pub fn preview(_app: &AppHandle, _session_id: &str, _tab_id: &str) -> Result<String> {
        Err(unsupported())
    }

    pub fn person_action(
        _app: &AppHandle,
        _session_id: &str,
        _tab_id: &str,
        _action: &super::PersonAction,
    ) -> Result<String> {
        Err(unsupported())
    }
}

#[tauri::command]
pub async fn browser_open(
    app: tauri::AppHandle,
    state: tauri::State<'_, std::sync::Arc<crate::commands::AppState>>,
    session_id: String,
) -> Result<BrowserSessionState> {
    let app_state = state.inner().clone();
    if !app_state
        .data
        .lock()
        .sessions
        .iter()
        .any(|session| session.id == session_id)
    {
        return Err(Error::not_found("session not found"));
    }
    crate::commands::native_task(move || platform::open(&app, &session_id)).await
}

#[tauri::command]
pub async fn browser_close(app: tauri::AppHandle, session_id: String) -> Result<()> {
    crate::commands::native_task(move || platform::close(&app, &session_id)).await
}

#[tauri::command]
pub async fn browser_state(
    app: tauri::AppHandle,
    session_id: String,
) -> Result<BrowserSessionState> {
    crate::commands::native_task(move || platform::state(&app, &session_id)).await
}

#[tauri::command]
pub async fn browser_new_tab(
    app: tauri::AppHandle,
    session_id: String,
    url: Option<String>,
) -> Result<BrowserSessionState> {
    crate::commands::native_task(move || platform::new_tab(&app, &session_id, url)).await
}

#[tauri::command]
pub async fn browser_close_tab(
    app: tauri::AppHandle,
    session_id: String,
    tab_id: String,
) -> Result<BrowserSessionState> {
    crate::commands::native_task(move || platform::close_tab(&app, &session_id, &tab_id)).await
}

#[tauri::command]
pub async fn browser_select_tab(
    app: tauri::AppHandle,
    session_id: String,
    tab_id: String,
) -> Result<BrowserSessionState> {
    crate::commands::native_task(move || platform::select_tab(&app, &session_id, &tab_id)).await
}

#[tauri::command]
pub async fn browser_navigate(
    app: tauri::AppHandle,
    session_id: String,
    tab_id: String,
    url: String,
) -> Result<BrowserSessionState> {
    crate::commands::native_task(move || platform::navigate(&app, &session_id, &tab_id, &url)).await
}

#[tauri::command]
pub async fn browser_reload(
    app: tauri::AppHandle,
    session_id: String,
    tab_id: String,
) -> Result<BrowserSessionState> {
    crate::commands::native_task(move || platform::reload(&app, &session_id, &tab_id)).await
}

#[tauri::command]
pub async fn browser_back(
    app: tauri::AppHandle,
    session_id: String,
    tab_id: String,
) -> Result<BrowserSessionState> {
    crate::commands::native_task(move || platform::back(&app, &session_id, &tab_id)).await
}

#[tauri::command]
pub async fn browser_forward(
    app: tauri::AppHandle,
    session_id: String,
    tab_id: String,
) -> Result<BrowserSessionState> {
    crate::commands::native_task(move || platform::forward(&app, &session_id, &tab_id)).await
}

#[tauri::command]
pub async fn browser_set_bounds(
    app: tauri::AppHandle,
    session_id: String,
    bounds: Option<BrowserBounds>,
) -> Result<()> {
    crate::commands::native_task(move || platform::set_bounds(&app, &session_id, bounds)).await
}

#[tauri::command]
pub async fn browser_annotate_start(
    app: tauri::AppHandle,
    session_id: String,
    tab_id: String,
) -> Result<()> {
    crate::commands::native_task(move || platform::annotate_start(&app, &session_id, &tab_id)).await
}

#[tauri::command]
pub async fn browser_annotate_finish(
    app: tauri::AppHandle,
    session_id: String,
    tab_id: String,
) -> Result<Vec<BrowserAnnotation>> {
    crate::commands::native_task(move || platform::annotate_finish(&app, &session_id, &tab_id))
        .await
}

#[tauri::command]
pub async fn browser_annotate_cancel(
    app: tauri::AppHandle,
    session_id: String,
    tab_id: String,
) -> Result<()> {
    crate::commands::native_task(move || platform::annotate_cancel(&app, &session_id, &tab_id))
        .await
}

#[tauri::command]
pub async fn browser_copy_link(
    app: tauri::AppHandle,
    session_id: String,
    tab_id: String,
) -> Result<()> {
    crate::commands::native_task(move || platform::copy_link(&app, &session_id, &tab_id)).await
}

#[tauri::command]
pub async fn browser_capture(
    app: tauri::AppHandle,
    session_id: String,
    tab_id: String,
) -> Result<String> {
    crate::commands::native_task(move || platform::capture(&app, &session_id, &tab_id)).await
}

/// A small JPEG of the visible page, base64, for the phone's browser screen (ADR-087).
#[tauri::command]
pub async fn browser_preview(
    app: tauri::AppHandle,
    session_id: String,
    tab_id: String,
) -> Result<String> {
    crate::commands::native_task(move || platform::preview(&app, &session_id, &tab_id)).await
}

/// The person taps, types, presses a key or scrolls a tab from the phone (ADR-087).
#[tauri::command]
pub async fn browser_person_action(
    app: tauri::AppHandle,
    session_id: String,
    tab_id: String,
    action: PersonAction,
) -> Result<serde_json::Value> {
    if !action.is_valid() {
        return Err(Error::new("invalid", "Invalid browser action."));
    }
    let raw = crate::commands::native_task(move || {
        platform::person_action(&app, &session_id, &tab_id, &action)
    })
    .await?;
    Ok(serde_json::from_str(&raw).unwrap_or(serde_json::Value::Null))
}
