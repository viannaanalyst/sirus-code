//! Remote access (ADR-080): the app can serve its own interface to the person's
//! other devices. Off by default. When on, a small HTTP server listens on one
//! port, answers only loopback and Tailscale peers (100.64.0.0/10,
//! fd7a:115c:a1e0::/48), and serves the bundled UI plus one WebSocket.
//!
//! A device joins with a one-time pairing code (five minutes, single use) and
//! receives its own token; only the token's SHA-256 is kept, in `remote.json`.
//! Over the socket a paired device invokes the same IPC commands the window
//! uses: each call is handed to the main webview's IPC entry point, so the
//! command list, argument parsing and capability checks stay the ones the
//! desktop has. A few commands that only make sense at the Mac (pickers,
//! dictation, computer use) or that manage remote access itself are refused.
//! Events are forwarded by name as the device subscribes to them.

use std::collections::HashMap;
use std::net::{IpAddr, Ipv4Addr, SocketAddr};
use std::path::{Path, PathBuf};
use std::sync::{Arc, OnceLock};
use std::time::{Duration, Instant};

use axum::extract::ws::{Message, WebSocket, WebSocketUpgrade};
use axum::extract::{ConnectInfo, Request, State as AxumState};
use axum::http::{header, HeaderMap, HeaderValue, StatusCode, Uri};
use axum::middleware::{self, Next};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use axum::{Json, Router};
use base64::Engine;
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use tauri::ipc::{CallbackFn, InvokeBody, InvokeResponse, InvokeResponseBody};
use tauri::webview::InvokeRequest;
use tauri::{AppHandle, Emitter, Listener, Manager};
use tokio::sync::{broadcast, mpsc, oneshot, watch};

use crate::error::{Error, Result};

mod push;
mod tailscale;

pub const DEFAULT_PORT: u16 = 7710;
/// Emitted when a device pairs or connects, so Settings → Connections refreshes.
pub const CHANGED: &str = "remote-changed";
const PAIR_TTL: Duration = Duration::from_secs(5 * 60);
const PAIR_FAILURES: u8 = 5;
const HELLO_TIMEOUT: Duration = Duration::from_secs(10);
const MAX_DEVICES: usize = 10;
const MAX_MESSAGE: usize = 32 * 1024 * 1024;
/// Messages queued for one device before it is considered too slow and dropped.
const QUEUE: usize = 4096;
const MAX_SUBSCRIPTIONS: usize = 64;

/// Commands a device never runs: remote access manages itself only at the Mac,
/// and these act on the Mac's own screen, microphone or file pickers.
const DENIED: &[&str] = &[
    "remote_action",
    "remote_pair",
    "pick_folder",
    "pick_executable",
    "capture_prompt_window",
    "drop_prompt_attachments",
    "dictation_status",
    "start_dictation",
    "stop_dictation",
    "computer_action",
    "simulator_action",
    "window_snap_action",
    "astro_show_in_main",
    "chat_background_action",
];

const CSP: &str = "default-src 'self'; img-src 'self' data: blob: https:; style-src 'self' 'unsafe-inline'; font-src 'self' data:; connect-src 'self'; script-src 'self'; worker-src 'self' blob:; frame-ancestors 'none'";

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Config {
    #[serde(default)]
    enabled: bool,
    #[serde(default)]
    port: Option<u16>,
    #[serde(default)]
    devices: Vec<Device>,
    /// Keep the Mac awake on power while remote access is on (ADR-083).
    #[serde(default)]
    keep_awake: bool,
    /// The VAPID private key for web push (ADR-082), base64url.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    vapid_private: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Device {
    id: String,
    name: String,
    token_hash: String,
    created_at: DateTime<Utc>,
    #[serde(default)]
    last_seen: Option<DateTime<Utc>>,
    /// The browser's push subscription when the device turned alerts on.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    push: Option<Value>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeviceInfo {
    id: String,
    name: String,
    created_at: DateTime<Utc>,
    last_seen: Option<DateTime<Utc>>,
    push: bool,
}

/// `tailscale serve` in front of the port, for HTTPS and so for web push (ADR-082).
#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Https {
    /// Tailscale's command-line tool is installed.
    available: bool,
    /// `https://<mac>.<tailnet>.ts.net` while it serves this port.
    url: Option<String>,
    /// The tailnet must allow HTTPS first; this admin page does it.
    setup_url: Option<String>,
    error: Option<String>,
    #[serde(skip)]
    host: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Status {
    enabled: bool,
    running: bool,
    port: u16,
    /// `http://<tailscale address>:<port>` for each Tailscale address of this Mac.
    urls: Vec<String>,
    devices: Vec<DeviceInfo>,
    error: Option<String>,
    https: Https,
    keep_awake: bool,
    /// The Mac is being kept awake right now (it is, while on power).
    awake: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Pairing {
    code: String,
    /// The addresses above with `?pair=<code>`, ready for a QR code.
    urls: Vec<String>,
    /// The first URL as a QR code (SVG markup).
    qr_svg: String,
    expires_at: DateTime<Utc>,
}

#[derive(Debug, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum Action {
    Status,
    SetEnabled {
        enabled: bool,
    },
    #[serde(rename_all = "camelCase")]
    Revoke {
        device_id: String,
    },
    EnableHttps,
    DisableHttps,
    /// Opens Tailscale's page that allows HTTPS on the tailnet.
    OpenHttpsSetup,
    #[serde(rename_all = "camelCase")]
    TestPush {
        device_id: String,
    },
    SetKeepAwake {
        enabled: bool,
    },
}

struct PairCode {
    hash: String,
    expires: Instant,
    failures: u8,
}

struct Server {
    port: u16,
    shutdown: watch::Sender<bool>,
}

struct Remote {
    path: PathBuf,
    config: parking_lot::Mutex<Config>,
    pairing: parking_lot::Mutex<Option<PairCode>>,
    server: parking_lot::Mutex<Option<Server>>,
    error: parking_lot::Mutex<Option<String>>,
    /// Ids of devices whose access was just removed; their sockets close.
    revoked: broadcast::Sender<String>,
    https: parking_lot::Mutex<Https>,
    /// `caffeinate -s` while the Mac should stay awake for paired devices.
    awake: parking_lot::Mutex<Option<std::process::Child>>,
}

static REMOTE: OnceLock<Arc<Remote>> = OnceLock::new();

fn remote() -> Result<Arc<Remote>> {
    REMOTE
        .get()
        .cloned()
        .ok_or_else(|| Error::new("remote", "Remote access is not ready yet."))
}

pub fn init(app: AppHandle, data_dir: &Path) {
    let path = data_dir.join("remote.json");
    let config = std::fs::read(&path)
        .ok()
        .and_then(|bytes| serde_json::from_slice::<Config>(&bytes).ok())
        .unwrap_or_default();
    let enabled = config.enabled;
    let remote = Arc::new(Remote {
        path,
        config: parking_lot::Mutex::new(config),
        pairing: parking_lot::Mutex::new(None),
        server: parking_lot::Mutex::new(None),
        error: parking_lot::Mutex::new(None),
        revoked: broadcast::channel(16).0,
        https: parking_lot::Mutex::new(Https::default()),
        awake: parking_lot::Mutex::new(None),
    });
    let _ = REMOTE.set(remote.clone());
    sync_awake(&remote);
    if enabled {
        tauri::async_runtime::spawn(async move {
            refresh_https(&remote).await;
            start(app, remote).await;
        });
    }
}

pub fn shutdown() {
    if let Some(remote) = REMOTE.get() {
        stop(remote);
        release_awake(remote);
    }
}

/// Paired devices can only reach an awake Mac: while remote access and the switch are on,
/// `caffeinate -s` holds off system sleep on power (the display still sleeps and locks).
/// `-w` releases it if Sirus quits without cleaning up.
fn sync_awake(remote: &Remote) {
    let wanted = awake_wanted(&remote.config.lock());
    let mut awake = remote.awake.lock();
    if let Some(child) = awake.as_mut() {
        // A caffeinate that ended on its own is started again below.
        if !matches!(child.try_wait(), Ok(None)) {
            *awake = None;
        }
    }
    match (wanted, awake.is_some()) {
        (true, false) => {
            match std::process::Command::new("/usr/bin/caffeinate")
                .args(caffeinate_args(std::process::id()))
                .stdin(std::process::Stdio::null())
                .stdout(std::process::Stdio::null())
                .stderr(std::process::Stdio::null())
                .spawn()
            {
                Ok(child) => *awake = Some(child),
                Err(error) => tracing::warn!(%error, "cannot keep the Mac awake"),
            }
        }
        (false, true) => {
            if let Some(mut child) = awake.take() {
                let _ = child.kill();
                let _ = child.wait();
            }
        }
        _ => {}
    }
}

fn release_awake(remote: &Remote) {
    if let Some(mut child) = remote.awake.lock().take() {
        let _ = child.kill();
        let _ = child.wait();
    }
}

fn awake_wanted(config: &Config) -> bool {
    config.enabled && config.keep_awake
}

fn caffeinate_args(pid: u32) -> Vec<String> {
    vec!["-s".into(), "-w".into(), pid.to_string()]
}

#[tauri::command]
pub async fn remote_action(app: AppHandle, action: Action) -> Result<Status> {
    let remote = remote()?;
    match action {
        Action::Status => {
            sync_awake(&remote);
            refresh_https(&remote).await;
        }
        Action::EnableHttps => {
            let port = port(&remote.config.lock());
            let outcome = tailscale::enable(port).await;
            refresh_https(&remote).await;
            let mut https = remote.https.lock();
            match outcome {
                tailscale::Enable::Done => {}
                tailscale::Enable::NeedsSetup(url) => {
                    https.setup_url = url;
                    https.error = Some("HTTPS is not allowed on this tailnet yet.".into());
                }
                tailscale::Enable::Failed(message) => https.error = Some(message),
            }
        }
        Action::DisableHttps => {
            tailscale::disable().await;
            refresh_https(&remote).await;
        }
        Action::OpenHttpsSetup => {
            use tauri_plugin_opener::OpenerExt;
            let url = remote.https.lock().setup_url.clone();
            if let Some(url) = url.filter(|url| tailscale::is_setup_url(url)) {
                app.opener()
                    .open_url(url, None::<&str>)
                    .map_err(|error| Error::new("remote", error.to_string()))?;
            }
        }
        Action::TestPush { device_id } => {
            let portuguese = app
                .try_state::<Arc<crate::commands::AppState>>()
                .is_some_and(|state| state.data.lock().settings.locale == "pt-BR");
            let (title, body) = if portuguese {
                ("Sirus Code", "Os alertas deste aparelho estão funcionando.")
            } else {
                ("Sirus Code", "Alerts on this device are working.")
            };
            let only = remote
                .config
                .lock()
                .devices
                .iter()
                .any(|device| device.id == device_id && device.push.is_some());
            if !only {
                return Err(Error::new(
                    "remote",
                    "This device has not turned alerts on.",
                ));
            }
            push::send_to(&remote, &device_id, push::payload(title, body, "")).await;
        }
        Action::SetEnabled { enabled } => {
            remote.config.lock().enabled = enabled;
            save(&remote)?;
            if enabled {
                start(app, remote.clone()).await;
            } else {
                stop(&remote);
                *remote.pairing.lock() = None;
            }
            sync_awake(&remote);
        }
        Action::SetKeepAwake { enabled } => {
            remote.config.lock().keep_awake = enabled;
            save(&remote)?;
            sync_awake(&remote);
        }
        Action::Revoke { device_id } => {
            remote
                .config
                .lock()
                .devices
                .retain(|device| device.id != device_id);
            save(&remote)?;
            let _ = remote.revoked.send(device_id);
        }
    }
    Ok(status(&remote))
}

/// A fresh one-time code; it replaces any earlier one.
#[tauri::command]
pub async fn remote_pair() -> Result<Pairing> {
    let remote = remote()?;
    if remote.server.lock().is_none() {
        return Err(Error::new("remote", "Turn on remote access first."));
    }
    if remote.config.lock().devices.len() >= MAX_DEVICES {
        return Err(Error::new(
            "remote",
            format!("Up to {MAX_DEVICES} devices can be connected. Remove one first."),
        ));
    }
    let bases = base_urls(&remote);
    if bases.is_empty() {
        return Err(Error::new(
            "remote",
            "Tailscale is not connected on this Mac. Open Tailscale and sign in, then try again.",
        ));
    }
    let code = pairing_code();
    *remote.pairing.lock() = Some(PairCode {
        hash: hash(&code),
        expires: Instant::now() + PAIR_TTL,
        failures: 0,
    });
    let urls: Vec<String> = bases
        .into_iter()
        .map(|url| format!("{url}/?pair={code}"))
        .collect();
    let qr_svg = qr_svg(&urls[0])?;
    Ok(Pairing {
        code,
        urls,
        qr_svg,
        expires_at: Utc::now() + chrono::Duration::from_std(PAIR_TTL).unwrap_or_default(),
    })
}

fn qr_svg(text: &str) -> Result<String> {
    let code = qrcode::QrCode::with_error_correction_level(text, qrcode::EcLevel::M)
        .map_err(|error| Error::new("remote", error.to_string()))?;
    Ok(code
        .render::<qrcode::render::svg::Color>()
        .min_dimensions(240, 240)
        .quiet_zone(true)
        .dark_color(qrcode::render::svg::Color("#000000"))
        .light_color(qrcode::render::svg::Color("#ffffff"))
        .build())
}

/// Re-reads whether `tailscale serve` fronts the port and under which name.
async fn refresh_https(remote: &Remote) {
    let port = port(&remote.config.lock());
    let available = tailscale::cli().is_some();
    let (host, serving) = if available {
        tokio::join!(tailscale::dns_name(), tailscale::serving(port))
    } else {
        (None, false)
    };
    let mut https = remote.https.lock();
    https.available = available;
    https.host = host.clone();
    https.url = host
        .filter(|_| serving)
        .map(|host| format!("https://{host}"));
    if https.url.is_some() {
        https.setup_url = None;
        https.error = None;
    }
}

fn status(remote: &Remote) -> Status {
    let config = remote.config.lock().clone();
    Status {
        enabled: config.enabled,
        running: remote.server.lock().is_some(),
        port: port(&config),
        urls: base_urls(remote),
        devices: config
            .devices
            .into_iter()
            .map(|device| DeviceInfo {
                id: device.id,
                name: device.name,
                created_at: device.created_at,
                last_seen: device.last_seen,
                push: device.push.is_some(),
            })
            .collect(),
        error: remote.error.lock().clone(),
        https: remote.https.lock().clone(),
        keep_awake: config.keep_awake,
        awake: remote.awake.lock().is_some(),
    }
}

fn port(config: &Config) -> u16 {
    config.port.unwrap_or(DEFAULT_PORT)
}

fn base_urls(remote: &Remote) -> Vec<String> {
    let port = port(&remote.config.lock());
    #[allow(unused_mut)]
    let mut addresses = tailscale_addresses();
    // Development builds can pair over loopback to test without Tailscale.
    #[cfg(debug_assertions)]
    if addresses.is_empty() && std::env::var("SIRUS_REMOTE_LOOPBACK").as_deref() == Ok("1") {
        addresses.push(Ipv4Addr::LOCALHOST);
    }
    // The HTTPS name comes first: only it can install as an app with alerts.
    let secure = remote.https.lock().url.clone();
    secure
        .into_iter()
        .chain(
            addresses
                .into_iter()
                .map(|ip| format!("http://{ip}:{port}")),
        )
        .collect()
}

fn save(remote: &Remote) -> Result<()> {
    let bytes = serde_json::to_vec_pretty(&*remote.config.lock())?;
    let tmp = remote.path.with_extension("json.tmp");
    std::fs::write(&tmp, bytes)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&tmp, std::fs::Permissions::from_mode(0o600))?;
    }
    std::fs::rename(tmp, &remote.path)?;
    Ok(())
}

async fn start(app: AppHandle, remote: Arc<Remote>) {
    let port = port(&remote.config.lock());
    if remote
        .server
        .lock()
        .as_ref()
        .is_some_and(|server| server.port == port)
    {
        return;
    }
    stop(&remote);
    let listener = match tokio::net::TcpListener::bind((Ipv4Addr::UNSPECIFIED, port)).await {
        Ok(listener) => listener,
        Err(error) => {
            tracing::warn!(%error, port, "remote access cannot listen");
            *remote.error.lock() = Some(format!("Port {port} is not available: {error}"));
            return;
        }
    };
    let (shutdown, mut stopped) = watch::channel(false);
    *remote.server.lock() = Some(Server {
        port,
        shutdown: shutdown.clone(),
    });
    *remote.error.lock() = None;
    let shared = Shared {
        app,
        remote: remote.clone(),
        shutdown: shutdown.subscribe(),
    };
    let router = Router::new()
        .route(
            "/api/health",
            get(|| async { Json(json!({ "app": "sirus" })) }),
        )
        .route("/api/pair", post(pair))
        .route(
            "/api/push",
            get(push_key).put(push_subscribe).delete(push_unsubscribe),
        )
        .route("/api/socket", get(socket))
        .fallback(get(asset))
        // The bundle is several megabytes of text; compressed it is about a quarter (gzip/brotli).
        .layer(tower_http::compression::CompressionLayer::new())
        .layer(middleware::from_fn(guard))
        .with_state(shared);
    tauri::async_runtime::spawn(async move {
        let served = axum::serve(
            listener,
            router.into_make_service_with_connect_info::<SocketAddr>(),
        )
        .with_graceful_shutdown(async move {
            let _ = stopped.wait_for(|stopped| *stopped).await;
        })
        .await;
        if let Err(error) = served {
            tracing::warn!(%error, "remote access server stopped");
            *remote.error.lock() = Some(error.to_string());
        }
        let mut server = remote.server.lock();
        if server
            .as_ref()
            .is_some_and(|server| server.shutdown.same_channel(&shutdown))
        {
            *server = None;
        }
    });
}

fn stop(remote: &Remote) {
    if let Some(server) = remote.server.lock().take() {
        let _ = server.shutdown.send(true);
    }
}

#[derive(Clone)]
struct Shared {
    app: AppHandle,
    remote: Arc<Remote>,
    shutdown: watch::Receiver<bool>,
}

/// Only loopback and Tailscale peers, and no cross-site requests.
async fn guard(
    ConnectInfo(peer): ConnectInfo<SocketAddr>,
    request: Request,
    next: Next,
) -> Response {
    if !allowed_peer(peer.ip()) {
        return StatusCode::FORBIDDEN.into_response();
    }
    let https_host = REMOTE
        .get()
        .and_then(|remote| remote.https.lock().host.clone());
    if !same_origin(request.headers(), https_host.as_deref()) {
        return StatusCode::FORBIDDEN.into_response();
    }
    next.run(request).await
}

fn allowed_peer(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(ip) => ip.is_loopback() || is_tailscale_v4(ip),
        IpAddr::V6(ip) => {
            if let Some(mapped) = ip.to_ipv4_mapped() {
                return allowed_peer(IpAddr::V4(mapped));
            }
            let segments = ip.segments();
            ip.is_loopback()
                || (segments[0] == 0xfd7a && segments[1] == 0x115c && segments[2] == 0xa1e0)
        }
    }
}

fn is_tailscale_v4(ip: Ipv4Addr) -> bool {
    let [a, b, ..] = ip.octets();
    a == 100 && (64..128).contains(&b)
}

/// A browser sends `Origin` on cross-site requests and WebSocket handshakes; it must name
/// this host, or this Mac's HTTPS name when `tailscale serve` forwards the request.
fn same_origin(headers: &HeaderMap, https_host: Option<&str>) -> bool {
    let Some(origin) = headers.get(header::ORIGIN) else {
        return true;
    };
    if let (Some(host), Ok(origin)) = (https_host, origin.to_str()) {
        if origin.eq_ignore_ascii_case(&format!("https://{host}")) {
            return true;
        }
    }
    let Some(host) = headers
        .get(header::HOST)
        .and_then(|host| host.to_str().ok())
    else {
        return false;
    };
    origin
        .to_str()
        .ok()
        .and_then(|origin| origin.split_once("://"))
        .is_some_and(|(_, rest)| rest.eq_ignore_ascii_case(host))
}

async fn asset(AxumState(shared): AxumState<Shared>, uri: Uri) -> Response {
    let path = uri.path().to_string();
    let resolver = shared.app.asset_resolver();
    // Tauri answers unknown paths with the app shell; that suits client-side routes,
    // but a missing script or image must stay missing.
    let file = path.rsplit('/').next().unwrap_or_default();
    let Some(mut asset) = resolver.get(path.clone()) else {
        return StatusCode::NOT_FOUND.into_response();
    };
    if is_static_file(file) && asset.mime_type.starts_with("text/html") {
        return StatusCode::NOT_FOUND.into_response();
    }
    // Tauri does not know the web app manifest's type.
    if file.ends_with(".webmanifest") {
        asset.mime_type = "application/manifest+json".into();
    }
    let html = asset.mime_type.starts_with("text/html");
    let mut response = asset.bytes.into_response();
    let headers = response.headers_mut();
    if let Ok(value) = HeaderValue::from_str(&asset.mime_type) {
        headers.insert(header::CONTENT_TYPE, value);
    }
    headers.insert(
        header::X_CONTENT_TYPE_OPTIONS,
        HeaderValue::from_static("nosniff"),
    );
    headers.insert(
        header::REFERRER_POLICY,
        HeaderValue::from_static("no-referrer"),
    );
    if html {
        headers.insert(
            header::CONTENT_SECURITY_POLICY,
            HeaderValue::from_static(CSP),
        );
        headers.insert(header::CACHE_CONTROL, HeaderValue::from_static("no-cache"));
    } else if path.starts_with("/assets/") {
        // Built files carry a content hash in their names: they never change.
        headers.insert(
            header::CACHE_CONTROL,
            HeaderValue::from_static("public, max-age=31536000, immutable"),
        );
    }
    response
}

/// Files a browser asks for by name; the app shell in their place means they are missing.
fn is_static_file(file: &str) -> bool {
    const EXTENSIONS: &[&str] = &[
        "js", "mjs", "css", "map", "json", "png", "jpg", "jpeg", "gif", "webp", "svg", "ico",
        "woff", "woff2", "ttf", "wasm", "bcmap", "pfb",
    ];
    file.rsplit_once('.')
        .is_some_and(|(_, extension)| EXTENSIONS.contains(&extension.to_ascii_lowercase().as_str()))
}

#[derive(Deserialize)]
struct PairRequest {
    code: String,
    #[serde(default)]
    name: String,
}

async fn pair(AxumState(shared): AxumState<Shared>, Json(request): Json<PairRequest>) -> Response {
    match redeem(&shared.remote, &request.code, &request.name) {
        Ok((device_id, token)) => {
            let _ = shared.app.emit(CHANGED, ());
            Json(json!({ "deviceId": device_id, "token": token })).into_response()
        }
        Err(message) => (
            StatusCode::UNAUTHORIZED,
            Json(json!({ "message": message })),
        )
            .into_response(),
    }
}

/// Exchanges a pairing code for a new device token.
fn redeem(
    remote: &Remote,
    code: &str,
    name: &str,
) -> std::result::Result<(String, String), &'static str> {
    {
        let mut pairing = remote.pairing.lock();
        let Some(current) = pairing.as_mut() else {
            return Err("This code is no longer valid. Show a new QR code on the Mac.");
        };
        if current.expires <= Instant::now() {
            *pairing = None;
            return Err("This code has expired. Show a new QR code on the Mac.");
        }
        let code: String = code
            .chars()
            .filter(|character| !matches!(character, ' ' | '-'))
            .collect();
        if current.hash != hash(&code) {
            current.failures += 1;
            if current.failures >= PAIR_FAILURES {
                *pairing = None;
            }
            return Err("This code is not valid.");
        }
        *pairing = None;
    }
    let token = random_token(32);
    let device = Device {
        id: uuid::Uuid::new_v4().to_string(),
        name: device_name(name),
        token_hash: hash(&token),
        created_at: Utc::now(),
        last_seen: None,
        push: None,
    };
    let id = device.id.clone();
    {
        let mut config = remote.config.lock();
        if config.devices.len() >= MAX_DEVICES {
            return Err("Too many devices are connected.");
        }
        config.devices.push(device);
    }
    if save(remote).is_err() {
        return Err("The Mac could not save this device.");
    }
    Ok((id, token))
}

fn device_name(name: &str) -> String {
    let name: String = name
        .chars()
        .filter(|character| !character.is_control())
        .take(60)
        .collect();
    let name = name.trim();
    if name.is_empty() {
        "Device".into()
    } else {
        name.into()
    }
}

/// The device behind `Authorization: Bearer <token>`.
fn bearer_device(remote: &Remote, headers: &HeaderMap) -> Option<String> {
    let token = headers
        .get(header::AUTHORIZATION)?
        .to_str()
        .ok()?
        .strip_prefix("Bearer ")?;
    authenticate(remote, token.trim())
}

async fn push_key(AxumState(shared): AxumState<Shared>, headers: HeaderMap) -> Response {
    if bearer_device(&shared.remote, &headers).is_none() {
        return StatusCode::UNAUTHORIZED.into_response();
    }
    match push::public_key(&shared.remote) {
        Ok(key) => Json(json!({ "publicKey": key })).into_response(),
        Err(_) => StatusCode::INTERNAL_SERVER_ERROR.into_response(),
    }
}

async fn push_subscribe(
    AxumState(shared): AxumState<Shared>,
    headers: HeaderMap,
    Json(subscription): Json<Value>,
) -> Response {
    let Some(device_id) = bearer_device(&shared.remote, &headers) else {
        return StatusCode::UNAUTHORIZED.into_response();
    };
    if !push::valid_subscription(&subscription) {
        return StatusCode::BAD_REQUEST.into_response();
    }
    set_push(&shared, &device_id, Some(subscription))
}

async fn push_unsubscribe(AxumState(shared): AxumState<Shared>, headers: HeaderMap) -> Response {
    let Some(device_id) = bearer_device(&shared.remote, &headers) else {
        return StatusCode::UNAUTHORIZED.into_response();
    };
    set_push(&shared, &device_id, None)
}

fn set_push(shared: &Shared, device_id: &str, subscription: Option<Value>) -> Response {
    if let Some(device) = shared
        .remote
        .config
        .lock()
        .devices
        .iter_mut()
        .find(|device| device.id == device_id)
    {
        device.push = subscription;
    }
    if save(&shared.remote).is_err() {
        return StatusCode::INTERNAL_SERVER_ERROR.into_response();
    }
    let _ = shared.app.emit(CHANGED, ());
    StatusCode::NO_CONTENT.into_response()
}

/// Sends a session alert to every device that turned alerts on (ADR-082).
pub fn notify(title: &str, body: &str, session_id: &str) {
    let Some(remote) = REMOTE.get().cloned() else {
        return;
    };
    if !remote
        .config
        .lock()
        .devices
        .iter()
        .any(|device| device.push.is_some())
    {
        return;
    }
    let payload = push::payload(title, body, session_id);
    tauri::async_runtime::spawn(async move { push::send_all(&remote, payload).await });
}

/// The device a token belongs to, noting when it was last seen.
fn authenticate(remote: &Remote, token: &str) -> Option<String> {
    let hashed = hash(token);
    let id = {
        let mut config = remote.config.lock();
        let device = config
            .devices
            .iter_mut()
            .find(|device| device.token_hash == hashed)?;
        device.last_seen = Some(Utc::now());
        device.id.clone()
    };
    let _ = save(remote);
    Some(id)
}

async fn socket(AxumState(shared): AxumState<Shared>, upgrade: WebSocketUpgrade) -> Response {
    upgrade
        .max_message_size(MAX_MESSAGE)
        .on_upgrade(move |socket| connection(socket, shared))
}

#[derive(Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
enum Incoming {
    Hello {
        token: String,
    },
    Invoke {
        id: u64,
        cmd: String,
        #[serde(default)]
        args: Value,
    },
    Listen {
        event: String,
    },
    Unlisten {
        event: String,
    },
}

async fn connection(mut socket: WebSocket, shared: Shared) {
    let device = match tokio::time::timeout(HELLO_TIMEOUT, socket.recv()).await {
        Ok(Some(Ok(Message::Text(text)))) => match serde_json::from_str::<Incoming>(&text) {
            Ok(Incoming::Hello { token }) => {
                let device = authenticate(&shared.remote, &token);
                if device.is_some() {
                    let _ = shared.app.emit(CHANGED, ());
                }
                device
            }
            _ => None,
        },
        _ => None,
    };
    let Some(device) = device else {
        let _ = socket
            .send(Message::Text(r#"{"type":"unauthorized"}"#.into()))
            .await;
        return;
    };
    if socket
        .send(Message::Text(r#"{"type":"ready"}"#.into()))
        .await
        .is_err()
    {
        return;
    }
    let (outgoing, mut queue) = mpsc::channel::<String>(QUEUE);
    let mut revoked = shared.remote.revoked.subscribe();
    let mut shutdown = shared.shutdown.clone();
    let mut listeners: HashMap<String, tauri::EventId> = HashMap::new();
    loop {
        tokio::select! {
            message = socket.recv() => {
                let text = match message {
                    Some(Ok(Message::Text(text))) => text,
                    Some(Ok(Message::Close(_))) | Some(Err(_)) | None => break,
                    Some(Ok(_)) => continue,
                };
                match serde_json::from_str::<Incoming>(&text) {
                    Ok(Incoming::Invoke { id, cmd, args }) => {
                        let app = shared.app.clone();
                        let outgoing = outgoing.clone();
                        tauri::async_runtime::spawn(async move {
                            let reply = result_message(id, invoke(&app, cmd, args).await);
                            let _ = outgoing.send(reply).await;
                        });
                    }
                    Ok(Incoming::Listen { event }) => {
                        if valid_event(&event) && !listeners.contains_key(&event) && listeners.len() < MAX_SUBSCRIPTIONS {
                            let outgoing = outgoing.clone();
                            let name = serde_json::to_string(&event).unwrap_or_default();
                            let id = shared.app.listen_any(event.clone(), move |message| {
                                let payload = if message.payload().is_empty() { "null" } else { message.payload() };
                                let _ = outgoing.try_send(format!(r#"{{"type":"event","event":{name},"payload":{payload}}}"#));
                            });
                            listeners.insert(event, id);
                        }
                    }
                    Ok(Incoming::Unlisten { event }) => {
                        if let Some(id) = listeners.remove(&event) {
                            shared.app.unlisten(id);
                        }
                    }
                    Ok(Incoming::Hello { .. }) | Err(_) => {}
                }
            }
            Some(reply) = queue.recv() => {
                if socket.send(Message::Text(reply.into())).await.is_err() {
                    break;
                }
            }
            gone = revoked.recv() => {
                if matches!(gone, Ok(ref id) if *id == device) {
                    let _ = socket.send(Message::Text(r#"{"type":"unauthorized"}"#.into())).await;
                    break;
                }
            }
            _ = shutdown.changed() => break,
        }
        // A device that cannot keep up reconnects and reloads instead of growing the queue.
        if outgoing.capacity() == 0 {
            break;
        }
    }
    for (_, id) in listeners {
        shared.app.unlisten(id);
    }
    let _ = socket.send(Message::Close(None)).await;
}

fn valid_event(event: &str) -> bool {
    !event.is_empty()
        && event.len() <= 64
        && event.chars().all(|character| {
            character.is_ascii_alphanumeric() || matches!(character, '-' | '_' | ':' | '/')
        })
}

fn has_files(args: &Value) -> bool {
    args.get("files")
        .and_then(Value::as_array)
        .is_some_and(|files| !files.is_empty())
}

fn allowed_command(command: &str) -> bool {
    !command.is_empty()
        && command.len() <= 64
        && command
            .chars()
            .all(|character| character.is_ascii_alphanumeric() || character == '_')
        && !DENIED.contains(&command)
}

enum Reply {
    Json(String),
    Raw(Vec<u8>),
}

/// Runs one IPC command as the main window would, on the main thread.
async fn invoke(
    app: &AppHandle,
    command: String,
    args: Value,
) -> std::result::Result<Reply, Value> {
    let refuse = |message: &str| json!({ "code": "remote", "message": message });
    if !allowed_command(&command) {
        return Err(refuse("This action is only available on the Mac."));
    }
    // Pasting with no files reads the Mac's pasteboard; a device sends its own files (ADR-086).
    if command == "paste_prompt_attachments" && !has_files(&args) {
        return Err(refuse("This action is only available on the Mac."));
    }
    let window = app
        .get_webview_window("main")
        .ok_or_else(|| refuse("The Sirus window is not open on the Mac."))?;
    let url = window.url().map_err(|error| refuse(&error.to_string()))?;
    let webview: tauri::Webview = window.as_ref().clone();
    let request = InvokeRequest {
        cmd: command,
        callback: CallbackFn(0),
        error: CallbackFn(1),
        url,
        body: InvokeBody::Json(if args.is_null() { json!({}) } else { args }),
        headers: Default::default(),
        invoke_key: app.invoke_key().to_string(),
    };
    let (sender, receiver) = oneshot::channel();
    app.run_on_main_thread(move || {
        webview.on_message(
            request,
            Box::new(move |_, _, response, _, _| {
                let _ = sender.send(response);
            }),
        );
    })
    .map_err(|error| refuse(&error.to_string()))?;
    match receiver.await {
        Ok(InvokeResponse::Ok(InvokeResponseBody::Json(body))) => Ok(Reply::Json(body)),
        Ok(InvokeResponse::Ok(InvokeResponseBody::Raw(bytes))) => Ok(Reply::Raw(bytes)),
        Ok(InvokeResponse::Err(error)) => Err(error.0),
        Err(_) => Err(refuse("The Mac did not answer this action.")),
    }
}

fn result_message(id: u64, result: std::result::Result<Reply, Value>) -> String {
    match result {
        Ok(Reply::Json(body)) => {
            let body = if body.is_empty() {
                "null"
            } else {
                body.as_str()
            };
            format!(r#"{{"type":"result","id":{id},"ok":true,"value":{body}}}"#)
        }
        Ok(Reply::Raw(bytes)) => json!({
            "type": "result",
            "id": id,
            "ok": true,
            "raw": base64::engine::general_purpose::STANDARD.encode(bytes),
        })
        .to_string(),
        Err(error) => {
            json!({ "type": "result", "id": id, "ok": false, "error": error }).to_string()
        }
    }
}

/// Six digits, so a home-screen app (which does not share Safari's storage) can type it.
/// Five minutes, single use and five wrong guesses make guessing impractical.
fn pairing_code() -> String {
    let bytes = uuid::Uuid::new_v4().into_bytes();
    let value = u64::from_le_bytes(bytes[..8].try_into().unwrap_or_default());
    format!("{:06}", value % 1_000_000)
}

fn random_token(bytes: usize) -> String {
    let mut buffer = Vec::with_capacity(bytes + 16);
    while buffer.len() < bytes {
        buffer.extend_from_slice(uuid::Uuid::new_v4().as_bytes());
    }
    buffer.truncate(bytes);
    base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(buffer)
}

fn hash(value: &str) -> String {
    Sha256::digest(value.as_bytes())
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

#[cfg(unix)]
fn tailscale_addresses() -> Vec<Ipv4Addr> {
    let mut found = Vec::new();
    let mut head: *mut libc::ifaddrs = std::ptr::null_mut();
    // SAFETY: getifaddrs fills `head` with a list that stays valid until freeifaddrs,
    // and every node is only read while it is.
    unsafe {
        if libc::getifaddrs(&mut head) != 0 {
            return found;
        }
        let mut cursor = head;
        while !cursor.is_null() {
            let entry = &*cursor;
            if !entry.ifa_addr.is_null() && i32::from((*entry.ifa_addr).sa_family) == libc::AF_INET
            {
                let address = &*(entry.ifa_addr as *const libc::sockaddr_in);
                let ip = Ipv4Addr::from(u32::from_be(address.sin_addr.s_addr));
                if is_tailscale_v4(ip) && !found.contains(&ip) {
                    found.push(ip);
                }
            }
            cursor = entry.ifa_next;
        }
        libc::freeifaddrs(head);
    }
    found
}

#[cfg(not(unix))]
fn tailscale_addresses() -> Vec<Ipv4Addr> {
    Vec::new()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn remote(dir: &Path) -> Remote {
        Remote {
            path: dir.join("remote.json"),
            config: parking_lot::Mutex::new(Config::default()),
            pairing: parking_lot::Mutex::new(None),
            server: parking_lot::Mutex::new(None),
            error: parking_lot::Mutex::new(None),
            revoked: broadcast::channel(4).0,
            https: parking_lot::Mutex::new(Https::default()),
            awake: parking_lot::Mutex::new(None),
        }
    }

    fn offer(remote: &Remote, code: &str, ttl: Duration) {
        *remote.pairing.lock() = Some(PairCode {
            hash: hash(code),
            expires: Instant::now() + ttl,
            failures: 0,
        });
    }

    #[test]
    fn peers_are_loopback_or_tailscale() {
        for allowed in [
            "127.0.0.1",
            "100.64.0.1",
            "100.101.102.103",
            "100.127.255.254",
            "::1",
            "fd7a:115c:a1e0::1",
            "::ffff:100.100.1.1",
        ] {
            assert!(allowed_peer(allowed.parse().unwrap()), "{allowed}");
        }
        for refused in [
            "192.168.1.10",
            "10.0.0.2",
            "100.63.255.255",
            "100.128.0.1",
            "8.8.8.8",
            "fd7a:115c:a1e1::1",
            "::ffff:192.168.1.1",
        ] {
            assert!(!allowed_peer(refused.parse().unwrap()), "{refused}");
        }
    }

    #[test]
    fn origin_must_name_this_host() {
        let mut headers = HeaderMap::new();
        assert!(same_origin(&headers, None));
        headers.insert(header::HOST, HeaderValue::from_static("100.80.1.2:7710"));
        headers.insert(
            header::ORIGIN,
            HeaderValue::from_static("http://100.80.1.2:7710"),
        );
        assert!(same_origin(&headers, None));
        headers.insert(
            header::ORIGIN,
            HeaderValue::from_static("https://evil.example"),
        );
        assert!(!same_origin(&headers, None));
        // `tailscale serve` forwards with the Mac's HTTPS name as the origin.
        headers.insert(
            header::ORIGIN,
            HeaderValue::from_static("https://mac.tail6e87c3.ts.net"),
        );
        assert!(same_origin(&headers, Some("mac.tail6e87c3.ts.net")));
        assert!(!same_origin(&headers, Some("other.tail6e87c3.ts.net")));
        headers.insert(
            header::ORIGIN,
            HeaderValue::from_static("https://evil.example"),
        );
        headers.remove(header::HOST);
        assert!(!same_origin(&headers, None));
    }

    #[test]
    fn pairing_codes_are_single_use_and_tokens_authenticate() {
        let dir = tempfile::tempdir().unwrap();
        let remote = remote(dir.path());
        offer(&remote, "482913", PAIR_TTL);
        let (id, token) = redeem(&remote, "482913", " iPhone\n").unwrap();
        assert!(redeem(&remote, "482913", "again").is_err());
        // A typed code may carry the space or dash shown on the Mac.
        offer(&remote, "123456", PAIR_TTL);
        assert!(redeem(&remote, "123 456", "Typed").is_ok());
        assert_eq!(authenticate(&remote, &token), Some(id.clone()));
        assert_eq!(authenticate(&remote, "wrong"), None);
        let saved: Config =
            serde_json::from_slice(&std::fs::read(dir.path().join("remote.json")).unwrap())
                .unwrap();
        assert_eq!(saved.devices[0].name, "iPhone");
        assert_ne!(saved.devices[0].token_hash, token);
        assert!(saved.devices[0].last_seen.is_some());
    }

    #[test]
    fn expired_or_guessed_codes_fail() {
        let dir = tempfile::tempdir().unwrap();
        let remote = remote(dir.path());
        offer(&remote, "late", Duration::ZERO);
        assert!(redeem(&remote, "late", "").is_err());
        offer(&remote, "right", PAIR_TTL);
        for _ in 0..PAIR_FAILURES {
            assert!(redeem(&remote, "guess", "").is_err());
        }
        // Too many wrong guesses withdraw the code itself.
        assert!(redeem(&remote, "right", "").is_err());
        assert!(remote.config.lock().devices.is_empty());
    }

    #[test]
    fn device_limit_holds() {
        let dir = tempfile::tempdir().unwrap();
        let remote = remote(dir.path());
        for index in 0..MAX_DEVICES {
            offer(&remote, "code", PAIR_TTL);
            redeem(&remote, "code", &format!("Device {index}")).unwrap();
        }
        offer(&remote, "code", PAIR_TTL);
        assert!(redeem(&remote, "code", "One more").is_err());
    }

    #[test]
    fn commands_and_events_are_checked() {
        assert!(allowed_command("send_prompt"));
        assert!(allowed_command("load_state"));
        for refused in [
            "remote_action",
            "remote_pair",
            "pick_folder",
            "computer_action",
            "plugin:opener|open_url",
            "",
            "a b",
        ] {
            assert!(!allowed_command(refused), "{refused}");
        }
        assert!(valid_event("agent-output"));
        assert!(has_files(
            &json!({ "owner": "s", "files": [{ "name": "a.jpg", "data": "AA" }] })
        ));
        assert!(!has_files(&json!({ "owner": "s", "files": [] })));
        assert!(!has_files(&json!({ "owner": "s" })));
        assert!(!valid_event("bad event"));
        assert!(!valid_event(""));
    }

    #[test]
    fn results_embed_the_command_reply() {
        assert_eq!(
            result_message(7, Ok(Reply::Json(r#"{"a":1}"#.into()))),
            r#"{"type":"result","id":7,"ok":true,"value":{"a":1}}"#
        );
        assert_eq!(
            result_message(8, Ok(Reply::Json(String::new()))),
            r#"{"type":"result","id":8,"ok":true,"value":null}"#
        );
        let raw: Value =
            serde_json::from_str(&result_message(9, Ok(Reply::Raw(vec![1, 2])))).unwrap();
        assert_eq!(raw["raw"], "AQI=");
        let error: Value =
            serde_json::from_str(&result_message(3, Err(json!({ "code": "x" })))).unwrap();
        assert_eq!(error["ok"], false);
        assert_eq!(error["error"]["code"], "x");
    }

    #[test]
    fn the_mac_stays_awake_only_with_remote_access_and_the_switch() {
        let mut config = Config {
            keep_awake: true,
            ..Config::default()
        };
        assert!(!awake_wanted(&config), "remote access off");
        config.enabled = true;
        assert!(awake_wanted(&config));
        config.keep_awake = false;
        assert!(!awake_wanted(&config));
        // On power only, and released when Sirus exits.
        assert_eq!(caffeinate_args(42), ["-s", "-w", "42"]);
    }

    #[test]
    fn missing_files_are_told_apart_from_routes() {
        assert!(is_static_file("index-abc.js"));
        assert!(is_static_file("logo.PNG"));
        assert!(!is_static_file("manifest.webmanifest"));
        assert!(!is_static_file("route"));
        assert!(!is_static_file("index.html"));
    }

    #[test]
    fn pairing_links_become_qr_codes() {
        let svg = qr_svg("http://100.80.1.2:7710/?pair=abcdefghijklmnopqrstuv").unwrap();
        assert!(svg.starts_with("<?xml") || svg.starts_with("<svg"));
        assert!(svg.contains("#000000"));
    }

    #[test]
    fn tokens_are_url_safe_and_distinct() {
        let first = random_token(32);
        assert_eq!(first.len(), 43);
        assert!(first
            .chars()
            .all(|character| character.is_ascii_alphanumeric() || matches!(character, '-' | '_')));
        assert_ne!(first, random_token(32));
        assert_eq!(device_name("   "), "Device");
        let code = pairing_code();
        assert_eq!(code.len(), 6);
        assert!(code.chars().all(|character| character.is_ascii_digit()));
    }
}
