//! Devices pane (ADR-128): a live, touchable iOS Simulator in the right dock,
//! built on Expo's `expo-device-hub` (MIT).
//!
//! - `toolchain`: Node.js 22+ and Xcode checks, and the pinned hub install,
//!   which happens only after the person presses Install in the pane.
//! - `hub`: the hub as a supervised loopback child, started while a pane holds
//!   a lease and stopped a minute after the last one ends, and on quit.
//! - `proxy`: the only way to the hub; an allowlist of stream and input routes.
//!
//! Booting, attaching and shutting down go through the hub's own API so its
//! stream helper sees the device; appearance and Open URL use `xcrun simctl`
//! with fixed argv.

mod hub;
pub mod proxy;
mod toolchain;

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::OnceLock;
use std::time::{Duration, Instant};

use parking_lot::Mutex;
use serde::Deserialize;
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter};
use tokio::process::Command;

use crate::error::{Error, Result};
use crate::models::{DeviceProxy, DeviceStatus, DeviceTools, SimDevice, SimFamily};

/// Emitted when the install, the hub or a device changes; the pane asks for status again.
pub const CHANGED: &str = "device-changed";
/// A pane renews its lease every 20 s; one not renewed for this long is gone.
const LEASE_TTL: Duration = Duration::from_secs(60);
/// The hub stops this long after the last lease ends.
const IDLE_STOP: Duration = Duration::from_secs(60);
const MAX_LEASES: usize = 16;
const BOOT_TIMEOUT: Duration = Duration::from_secs(180);
const SIMCTL_TIMEOUT: Duration = Duration::from_secs(30);

struct Devices {
    app: AppHandle,
    tools: PathBuf,
    hub: hub::Hub,
    state: Mutex<State>,
    proxy: tokio::sync::Mutex<Option<DeviceProxy>>,
}

struct State {
    installing: bool,
    install_error: Option<String>,
    leases: HashMap<String, Instant>,
    /// When the last lease ended (or the hub started without one).
    idle_since: Instant,
}

static DEVICES: OnceLock<Devices> = OnceLock::new();

#[derive(Debug, Deserialize)]
#[serde(
    tag = "type",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum Action {
    /// Checks and the device list; never installs or starts anything.
    Status,
    /// The person pressed Install in the pane (explicit consent).
    Install {
        consent: bool,
    },
    /// A visible pane wants the hub (renewed every 20 s).
    Lease {
        id: String,
    },
    Release {
        id: String,
    },
    /// Boots the simulator if needed and attaches the hub's stream helper.
    Attach {
        udid: String,
    },
    Shutdown {
        udid: String,
        confirm: bool,
    },
    Appearance {
        udid: String,
        dark: bool,
    },
    OpenUrl {
        udid: String,
        url: String,
    },
}

pub fn init(app: AppHandle, data_dir: &Path) {
    let tools = data_dir.join("tools");
    let _ = DEVICES.set(Devices {
        app,
        hub: hub::Hub::new(tools.clone()),
        tools,
        state: Mutex::new(State {
            installing: false,
            install_error: None,
            leases: HashMap::new(),
            idle_since: Instant::now(),
        }),
        proxy: tokio::sync::Mutex::new(None),
    });
    tauri::async_runtime::spawn(reap_leases());
}

fn devices() -> Result<&'static Devices> {
    DEVICES
        .get()
        .ok_or_else(|| Error::new("devices", "Devices are not ready yet."))
}

fn changed() {
    if let Some(devices) = DEVICES.get() {
        let _ = devices.app.emit(CHANGED, ());
    }
}

/// The running hub's loopback origin, for the proxy.
pub(crate) fn hub_origin() -> Option<String> {
    #[cfg(test)]
    if let Some(origin) = TEST_HUB_ORIGIN.get() {
        return Some(origin.clone());
    }
    DEVICES.get()?.hub.origin()
}

/// A hub started by hand, for the ignored end-to-end proxy test.
#[cfg(test)]
static TEST_HUB_ORIGIN: OnceLock<String> = OnceLock::new();

/// App quit: the hub and its process group go with the app.
pub fn shutdown() {
    if let Some(devices) = DEVICES.get() {
        devices.hub.stop();
    }
}

#[tauri::command]
pub async fn device_action(action: Action) -> Result<Value> {
    let devices = devices()?;
    match action {
        Action::Status => Ok(serde_json::to_value(status(devices).await)?),
        Action::Install { consent } => {
            if !consent {
                return Err(Error::confirmation_required(
                    "Installing the device tools needs your confirmation.",
                ));
            }
            install(devices).await?;
            Ok(Value::Null)
        }
        Action::Lease { id } => {
            lease(devices, id)?;
            let proxy = ensure_proxy(devices).await?;
            Ok(serde_json::to_value(proxy)?)
        }
        Action::Release { id } => {
            let mut state = devices.state.lock();
            if state.leases.remove(&id).is_some() && state.leases.is_empty() {
                state.idle_since = Instant::now();
            }
            Ok(Value::Null)
        }
        Action::Attach { udid } => {
            attach(devices, &udid).await?;
            changed();
            Ok(Value::Null)
        }
        Action::Shutdown { udid, confirm } => {
            if !confirm {
                return Err(Error::confirmation_required(
                    "Shutting down a simulator needs your confirmation.",
                ));
            }
            shutdown_device(devices, &udid).await?;
            changed();
            Ok(Value::Null)
        }
        Action::Appearance { udid, dark } => {
            check_udid(&udid)?;
            simctl(&[
                "ui",
                &udid,
                "appearance",
                if dark { "dark" } else { "light" },
            ])
            .await?;
            Ok(Value::Null)
        }
        Action::OpenUrl { udid, url } => {
            check_udid(&udid)?;
            let url = valid_url(&url).ok_or_else(|| {
                Error::new(
                    "devices",
                    "Enter a full URL such as https://example.com or myapp://path.",
                )
            })?;
            simctl(&["openurl", &udid, url]).await?;
            Ok(Value::Null)
        }
    }
}

async fn status(devices: &Devices) -> DeviceStatus {
    let (node, xcode) = tokio::join!(toolchain::find_node(), toolchain::xcode_available());
    let list = if xcode {
        list_devices().await.unwrap_or_default()
    } else {
        Vec::new()
    };
    let state = devices.state.lock();
    DeviceStatus {
        xcode,
        node_version: node.as_ref().map(|node| node.version.clone()),
        node_ok: node.as_ref().is_some_and(toolchain::Node::ok),
        tools: DeviceTools {
            hub_package: toolchain::HUB_PACKAGE.into(),
            hub_version: toolchain::HUB_VERSION.into(),
            installed: toolchain::installed(&devices.tools),
            installing: state.installing,
            error: state.install_error.clone(),
        },
        hub: devices.hub.state(),
        devices: list,
        proxy: devices
            .proxy
            .try_lock()
            .ok()
            .and_then(|proxy| proxy.clone()),
    }
}

async fn ready_node() -> Result<toolchain::Node> {
    match toolchain::find_node().await {
        Some(node) if node.ok() => Ok(node),
        Some(node) => Err(Error::new(
            "devices",
            format!(
                "The device tools need Node.js {} or newer with npm; found {}.",
                toolchain::NODE_MAJOR,
                node.version
            ),
        )),
        None => Err(Error::new(
            "devices",
            format!(
                "The device tools need Node.js {} or newer.",
                toolchain::NODE_MAJOR
            ),
        )),
    }
}

async fn install(devices: &'static Devices) -> Result<()> {
    let node = ready_node().await?;
    {
        let mut state = devices.state.lock();
        if state.installing {
            return Ok(());
        }
        state.installing = true;
        state.install_error = None;
    }
    changed();
    let result = toolchain::install(&devices.tools, &node).await;
    {
        let mut state = devices.state.lock();
        state.installing = false;
        state.install_error = result.as_ref().err().map(ToString::to_string);
    }
    changed();
    if result.is_ok() && !devices.state.lock().leases.is_empty() {
        start_hub(devices);
    }
    result
}

fn lease(devices: &'static Devices, id: String) -> Result<()> {
    if id.is_empty() || id.len() > 64 {
        return Err(Error::new("devices", "Invalid lease."));
    }
    {
        let mut state = devices.state.lock();
        if !state.leases.contains_key(&id) && state.leases.len() >= MAX_LEASES {
            return Err(Error::new("devices", "Too many device panes are open."));
        }
        state.leases.insert(id, Instant::now());
    }
    if !devices.hub.running() && !devices.hub.state().starting {
        start_hub(devices);
    }
    Ok(())
}

/// Starts the hub in the background when it is installed; the pane hears `device-changed`.
fn start_hub(devices: &'static Devices) {
    if !toolchain::installed(&devices.tools) {
        return;
    }
    tauri::async_runtime::spawn(async move {
        if let Err(error) = hub_ready(devices).await {
            tracing::warn!(%error, "device hub did not start");
        }
    });
}

async fn hub_ready(devices: &'static Devices) -> Result<String> {
    if let Some(origin) = devices.hub.origin() {
        return Ok(origin);
    }
    if !toolchain::installed(&devices.tools) {
        return Err(Error::new("devices", "Install the device tools first."));
    }
    if !toolchain::xcode_available().await {
        return Err(Error::new(
            "devices",
            "Xcode with an iOS simulator runtime is needed.",
        ));
    }
    let node = ready_node().await?;
    devices
        .hub
        .ensure(&node, &toolchain::entry(&devices.tools), changed)
        .await
}

async fn ensure_proxy(devices: &Devices) -> Result<DeviceProxy> {
    let mut proxy = devices.proxy.lock().await;
    if let Some(proxy) = proxy.as_ref() {
        return Ok(proxy.clone());
    }
    let (port, token) = proxy::start_local().await?;
    let started = DeviceProxy { port, token };
    *proxy = Some(started.clone());
    Ok(started)
}

/// Drops leases that were not renewed and stops an idle hub.
async fn reap_leases() {
    let mut tick = tokio::time::interval(Duration::from_secs(15));
    loop {
        tick.tick().await;
        let Some(devices) = DEVICES.get() else {
            continue;
        };
        let idle = {
            let mut state = devices.state.lock();
            let before = state.leases.len();
            state.leases.retain(|_, seen| seen.elapsed() < LEASE_TTL);
            if before > 0 && state.leases.is_empty() {
                state.idle_since = Instant::now();
            }
            state.leases.is_empty() && state.idle_since.elapsed() >= IDLE_STOP
        };
        if idle && devices.hub.running() {
            devices.hub.stop();
            changed();
        }
    }
}

fn check_udid(udid: &str) -> Result<()> {
    if proxy::valid_udid(udid) {
        Ok(())
    } else {
        Err(Error::new("devices", "Unknown simulator."))
    }
}

/// A URL with a scheme, no spaces or control characters; `file:` and
/// `javascript:` are refused.
fn valid_url(url: &str) -> Option<&str> {
    let url = url.trim();
    if url.is_empty() || url.len() > 2048 || url.starts_with('-') {
        return None;
    }
    if url.chars().any(|c| c.is_whitespace() || c.is_control()) {
        return None;
    }
    let (scheme, rest) = url.split_once(':')?;
    let scheme_ok = scheme.len() <= 32
        && scheme
            .chars()
            .next()
            .is_some_and(|c| c.is_ascii_alphabetic())
        && scheme
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '+' | '-' | '.'));
    let blocked = ["file", "javascript", "data"]
        .iter()
        .any(|blocked| scheme.eq_ignore_ascii_case(blocked));
    (scheme_ok && !blocked && !rest.is_empty()).then_some(url)
}

async fn simctl_output(args: &[&str], timeout: Duration) -> Result<Vec<u8>> {
    let mut command = Command::new("/usr/bin/xcrun");
    command
        .arg("simctl")
        .args(args)
        .env("PATH", "/usr/bin:/bin:/usr/sbin:/sbin");
    let output = crate::cli_output::capture_command(command, timeout)
        .await
        .map_err(|error| Error::new("devices", format!("simctl could not run: {error}")))?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        let line = stderr
            .lines()
            .find(|line| !line.trim().is_empty())
            .unwrap_or("failed");
        return Err(Error::new(
            "devices",
            format!("simctl: {}", line.chars().take(300).collect::<String>()),
        ));
    }
    Ok(output.stdout)
}

async fn simctl(args: &[&str]) -> Result<()> {
    simctl_output(args, SIMCTL_TIMEOUT).await.map(|_| ())
}

async fn list_devices() -> Result<Vec<SimDevice>> {
    let stdout = simctl_output(&["list", "devices", "available", "-j"], SIMCTL_TIMEOUT).await?;
    Ok(parse_devices(&serde_json::from_slice(&stdout)?))
}

/// iOS simulators from `simctl list devices available -j`, booted first, newest runtime first.
fn parse_devices(list: &Value) -> Vec<SimDevice> {
    let mut devices = Vec::new();
    let Some(runtimes) = list.get("devices").and_then(Value::as_object) else {
        return devices;
    };
    for (runtime, entries) in runtimes {
        let Some(version) = runtime
            .rsplit('.')
            .next()
            .and_then(|tail| tail.strip_prefix("iOS-"))
        else {
            continue;
        };
        let runtime = format!("iOS {}", version.replace('-', "."));
        for entry in entries.as_array().into_iter().flatten() {
            let (Some(udid), Some(name)) = (
                entry.get("udid").and_then(Value::as_str),
                entry.get("name").and_then(Value::as_str),
            ) else {
                continue;
            };
            if !proxy::valid_udid(udid)
                || entry.get("isAvailable").and_then(Value::as_bool) == Some(false)
            {
                continue;
            }
            let kind = entry
                .get("deviceTypeIdentifier")
                .and_then(Value::as_str)
                .unwrap_or(name);
            devices.push(SimDevice {
                udid: udid.into(),
                name: name.chars().take(80).collect(),
                runtime: runtime.clone(),
                booted: entry.get("state").and_then(Value::as_str) == Some("Booted"),
                family: if kind.contains("iPad") {
                    SimFamily::Tablet
                } else {
                    SimFamily::Phone
                },
            });
        }
    }
    devices.sort_by(|a, b| {
        b.booted
            .cmp(&a.booted)
            .then_with(|| runtime_key(&b.runtime).cmp(&runtime_key(&a.runtime)))
            .then_with(|| {
                a.family
                    .eq(&SimFamily::Tablet)
                    .cmp(&b.family.eq(&SimFamily::Tablet))
            })
            .then_with(|| a.name.cmp(&b.name))
    });
    devices.truncate(64);
    devices
}

fn runtime_key(runtime: &str) -> Vec<u32> {
    runtime
        .trim_start_matches("iOS ")
        .split('.')
        .filter_map(|part| part.parse().ok())
        .collect()
}

async fn hub_post(origin: &str, path: &str, body: Value, timeout: Duration) -> Result<Value> {
    let response = hub::http()
        .post(format!("{origin}{path}"))
        .header(reqwest::header::CONTENT_TYPE, "application/json")
        .body(body.to_string())
        .timeout(timeout)
        .send()
        .await
        .map_err(|error| {
            Error::new("devices", format!("The device hub did not answer: {error}"))
        })?;
    let text = response.text().await.map_err(|error| {
        Error::new("devices", format!("The device hub did not answer: {error}"))
    })?;
    let value: Value = serde_json::from_str(&text).unwrap_or(Value::Null);
    if value.get("ok").and_then(Value::as_bool) != Some(true) {
        let message = value
            .get("error")
            .and_then(Value::as_str)
            .unwrap_or("The device hub refused the request.");
        return Err(Error::new(
            "devices",
            message.chars().take(300).collect::<String>(),
        ));
    }
    Ok(value)
}

/// Boots through the hub (so its list and stream helper see the device), then
/// attaches the helper; `grid/api/start` is idempotent for a booted simulator.
async fn attach(devices: &'static Devices, udid: &str) -> Result<()> {
    check_udid(udid)?;
    let origin = hub_ready(devices).await?;
    let booted = list_devices()
        .await?
        .into_iter()
        .find(|device| device.udid == udid)
        .ok_or_else(|| Error::new("devices", "Unknown simulator."))?
        .booted;
    if !booted {
        hub_post(
            &origin,
            "/api/devices/boot",
            json!({ "platform": "ios", "id": udid }),
            BOOT_TIMEOUT,
        )
        .await?;
        changed();
    }
    hub_post(
        &origin,
        "/vendor/serve-sim/grid/api/start",
        json!({ "udid": udid }),
        BOOT_TIMEOUT,
    )
    .await?;
    Ok(())
}

/// The hub's own shutdown closes its capture session first; without a hub, `simctl` does it.
async fn shutdown_device(devices: &Devices, udid: &str) -> Result<()> {
    check_udid(udid)?;
    if let Some(origin) = devices.hub.origin() {
        if hub_post(
            &origin,
            "/vendor/serve-sim/grid/api/shutdown",
            json!({ "udid": udid }),
            SIMCTL_TIMEOUT,
        )
        .await
        .is_ok()
        {
            return Ok(());
        }
    }
    match simctl(&["shutdown", udid]).await {
        Ok(()) => Ok(()),
        // Already off is fine.
        Err(_)
            if list_devices()
                .await?
                .iter()
                .any(|device| device.udid == udid && !device.booted) =>
        {
            Ok(())
        }
        Err(error) => Err(error),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn simctl_lists_become_ios_devices() {
        let list = json!({ "devices": {
            "com.apple.CoreSimulator.SimRuntime.iOS-18-2": [
                { "udid": "11111111-1111-1111-1111-111111111111", "name": "iPhone 16", "state": "Shutdown", "isAvailable": true, "deviceTypeIdentifier": "com.apple.CoreSimulator.SimDeviceType.iPhone-16" },
                { "udid": "22222222-2222-2222-2222-222222222222", "name": "iPad Air", "state": "Shutdown", "isAvailable": true, "deviceTypeIdentifier": "com.apple.CoreSimulator.SimDeviceType.iPad-Air" }
            ],
            "com.apple.CoreSimulator.SimRuntime.iOS-27-0": [
                { "udid": "33333333-3333-3333-3333-333333333333", "name": "iPhone 18 Pro", "state": "Booted", "isAvailable": true },
                { "udid": "not a udid", "name": "Bad", "state": "Booted" }
            ],
            "com.apple.CoreSimulator.SimRuntime.watchOS-11-0": [
                { "udid": "44444444-4444-4444-4444-444444444444", "name": "Watch", "state": "Booted" }
            ]
        }});
        let devices = parse_devices(&list);
        let names: Vec<_> = devices.iter().map(|device| device.name.as_str()).collect();
        assert_eq!(names, ["iPhone 18 Pro", "iPhone 16", "iPad Air"]);
        assert_eq!(devices[0].runtime, "iOS 27.0");
        assert!(devices[0].booted);
        assert_eq!(devices[2].family, SimFamily::Tablet);
    }

    /// Installs the pinned hub with the real npm into `SIRUS_DEVICE_TOOLS_DIR`,
    /// runs it, kills it to see the supervisor restart it, attaches the booted
    /// simulator `SIRUS_DEVICE_HUB_UDID`, relays it and stops the hub:
    /// `cargo test devices::tests::installs_and_runs -- --ignored --nocapture`.
    #[test]
    #[cfg(unix)]
    #[ignore = "downloads expo-device-hub and needs Xcode and a booted simulator"]
    fn installs_and_runs_the_real_hub() {
        let tools =
            PathBuf::from(std::env::var("SIRUS_DEVICE_TOOLS_DIR").expect("SIRUS_DEVICE_TOOLS_DIR"));
        let udid = std::env::var("SIRUS_DEVICE_HUB_UDID").expect("SIRUS_DEVICE_HUB_UDID");
        tauri::async_runtime::block_on(async move {
            let node = ready_node().await.unwrap();
            toolchain::install(&tools, &node).await.unwrap();
            assert!(toolchain::installed(&tools));
            let hub: &'static hub::Hub = Box::leak(Box::new(hub::Hub::new(tools.clone())));
            let first = hub
                .ensure(&node, &toolchain::entry(&tools), || {})
                .await
                .unwrap();
            assert!(tools.join("hub.json").exists());
            eprintln!("hub at {first}");
            // A crash is restarted on a new port.
            let record: Value =
                serde_json::from_str(&std::fs::read_to_string(tools.join("hub.json")).unwrap())
                    .unwrap();
            let pid = record["pid"].as_u64().unwrap() as i32;
            unsafe { libc::kill(pid, libc::SIGKILL) };
            let mut second = None;
            for _ in 0..100 {
                tokio::time::sleep(Duration::from_millis(100)).await;
                second = hub.origin().filter(|origin| *origin != first);
                if second.is_some() {
                    break;
                }
            }
            let second = second.expect("the hub was restarted");
            eprintln!("restarted at {second}");
            hub_post(
                &second,
                "/vendor/serve-sim/grid/api/start",
                json!({ "udid": udid }),
                BOOT_TIMEOUT,
            )
            .await
            .unwrap();
            let _ = TEST_HUB_ORIGIN.set(second.clone());
            proxy::tests::check_real_relay(&udid).await;
            let record: Value =
                serde_json::from_str(&std::fs::read_to_string(tools.join("hub.json")).unwrap())
                    .unwrap();
            let pid = record["pid"].as_u64().unwrap() as i32;
            hub.stop();
            tokio::time::sleep(Duration::from_millis(300)).await;
            assert!(!hub.running());
            assert_ne!(
                unsafe { libc::kill(pid, 0) },
                0,
                "the hub's process is gone"
            );
            assert!(!tools.join("hub.json").exists());
        });
    }

    #[test]
    fn open_url_accepts_web_and_app_links_only() {
        assert_eq!(
            valid_url(" https://example.com/a?b=c "),
            Some("https://example.com/a?b=c")
        );
        assert!(valid_url("myapp://path").is_some());
        assert!(valid_url("exp://127.0.0.1:8081").is_some());
        for bad in [
            "",
            "example.com",
            "file:///etc/passwd",
            "javascript:alert(1)",
            "-h",
            "https://a b",
            "1abc://x",
        ] {
            assert_eq!(valid_url(bad), None, "{bad}");
        }
    }
}
