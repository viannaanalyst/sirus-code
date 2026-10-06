//! iOS Simulator pane (ADR-066), adapted from Synara's device pane (MIT).
//!
//! A native helper (`native/simulator-helper`, Swift + Objective-C) drives a
//! booted simulator headless through CoreSimulator/SimulatorKit, which it
//! `dlopen`s from the active Xcode. Its sources are embedded in this binary and
//! compiled on first use with the person's own toolchain into app data, keyed
//! by Xcode build and source hash. The helper speaks newline-delimited JSON-RPC
//! on stdio and writes H.264 frames to a private Unix socket this module
//! listens on; frames reach the renderer as `simulator-frame` events and are
//! decoded there with WebCodecs.
//!
//! Lifecycle and safety:
//! - one app-wide attached device; the renderer and agent tools share it;
//! - frames are encoded only while a pane watches; a late or flushed decoder
//!   asks for a keyframe of the current screen instead of restarting the stream;
//! - attach, detach and stream changes run one at a time; a helper that exits
//!   is restarted and re-attached on the next use;
//! - devices Sirus Code booted are capped at 3 and shut down 10 minutes after
//!   detach, on switching away and on quit; devices the person booted are never
//!   shut down automatically;
//! - every command is a fixed argv (`/usr/bin/xcrun simctl …`, the helper);
//!   device IDs must be UUIDs, app paths must sit inside the session workspace.

use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, OnceLock};
use std::time::Duration;

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::ipc::{Channel, InvokeResponseBody, JavaScriptChannelId};
use tauri::{AppHandle, Emitter, Manager};
use tokio::io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader};
use tokio::sync::oneshot;

use crate::error::{Error, Result};

const XCRUN: &str = "/usr/bin/xcrun";
const MAX_BOOTED: usize = 3;
/// Pause after a fresh boot before attaching input (see `boot`).
const BOOT_SETTLE: Duration = Duration::from_secs(8);
const IDLE_SHUTDOWN: Duration = Duration::from_secs(10 * 60);
const CALL_TIMEOUT: Duration = Duration::from_secs(20);
const MAX_FRAME: usize = 16 * 1024 * 1024;
/// Panes that may receive frames at once; the oldest is dropped beyond this
/// (a reloaded webview never unsubscribes its previous channel).
const MAX_SUBSCRIBERS: usize = 4;
const MAX_TEXT: usize = 2_000;
/// Longest helper reply line (a full-resolution iPad screenshot in base64 fits).
const MAX_REPLY_LINE: usize = 48 * 1024 * 1024;
/// How long a stream start keeps retrying while a fresh boot has no framebuffer yet.
const DISPLAY_WAIT: Duration = Duration::from_secs(45);
pub const STATE_EVENT: &str = "simulator-state";

/// Embedded helper sources, written next to the build output before compiling.
const SOURCES: &[(&str, &str)] = &[
    (
        "AXBridge.h",
        include_str!("../native/simulator-helper/Sources/AXBridge.h"),
    ),
    (
        "AXBridge.m",
        include_str!("../native/simulator-helper/Sources/AXBridge.m"),
    ),
    (
        "CapabilityProbe.swift",
        include_str!("../native/simulator-helper/Sources/CapabilityProbe.swift"),
    ),
    (
        "CoreSimulatorBridge.swift",
        include_str!("../native/simulator-helper/Sources/CoreSimulatorBridge.swift"),
    ),
    (
        "DeviceHelper-Bridging-Header.h",
        include_str!("../native/simulator-helper/Sources/DeviceHelper-Bridging-Header.h"),
    ),
    (
        "FrameStream.swift",
        include_str!("../native/simulator-helper/Sources/FrameStream.swift"),
    ),
    (
        "HIDBridge.h",
        include_str!("../native/simulator-helper/Sources/HIDBridge.h"),
    ),
    (
        "HIDBridge.m",
        include_str!("../native/simulator-helper/Sources/HIDBridge.m"),
    ),
    (
        "main.swift",
        include_str!("../native/simulator-helper/Sources/main.swift"),
    ),
    (
        "Screenshot.swift",
        include_str!("../native/simulator-helper/Sources/Screenshot.swift"),
    ),
    (
        "SymbolManifest.swift",
        include_str!("../native/simulator-helper/Sources/SymbolManifest.swift"),
    ),
];
const SWIFT_ORDER: &[&str] = &[
    "SymbolManifest.swift",
    "CapabilityProbe.swift",
    "CoreSimulatorBridge.swift",
    "FrameStream.swift",
    "Screenshot.swift",
    "main.swift",
];

/// Replies waiting for the helper, by JSON-RPC id.
type Pending =
    Arc<parking_lot::Mutex<HashMap<u64, oneshot::Sender<std::result::Result<Value, String>>>>>;

struct Helper {
    stdin: tokio::process::ChildStdin,
    pending: Pending,
    next: AtomicU64,
    dead: Arc<AtomicBool>,
    stderr: Arc<parking_lot::Mutex<String>>,
    _child: tokio::process::Child,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Attached {
    pub udid: String,
    pub name: String,
    pub family: String,
    pub pixel_width: u32,
    pub pixel_height: u32,
    /// Screen size in points; accessibility frames use these units.
    pub point_width: f64,
    pub point_height: f64,
    pub input: bool,
}

struct Recording {
    udid: String,
    file: PathBuf,
    child: tokio::process::Child,
}

struct Sim {
    app: AppHandle,
    dir: PathBuf,
    helper: tokio::sync::Mutex<Option<Helper>>,
    attached: parking_lot::Mutex<Option<Attached>>,
    booted: parking_lot::Mutex<HashSet<String>>,
    recording: tokio::sync::Mutex<Option<Recording>>,
    stream: parking_lot::Mutex<Option<tauri::async_runtime::JoinHandle<()>>>,
    generation: AtomicU64,
    /// Serializes attach, detach and stream start/stop.
    ops: tokio::sync::Mutex<()>,
    /// Mounted panes' frame channels; the stream runs only while one exists.
    subscribers: parking_lot::Mutex<Vec<(u64, Channel<InvokeResponseBody>)>>,
    next_subscriber: AtomicU64,
    streaming: AtomicBool,
    /// Latest idle-shutdown timer per device; an older timer does nothing.
    idle_token: AtomicU64,
    idle_timers: parking_lot::Mutex<HashMap<String, u64>>,
    /// A failed helper build for this Xcode/source, so later calls fail fast.
    build_error: parking_lot::Mutex<Option<String>>,
    /// Automatic recoveries of the helper or stream in the last minute.
    recoveries: parking_lot::Mutex<Vec<std::time::Instant>>,
}

static SIM: OnceLock<Arc<Sim>> = OnceLock::new();

/// Called once at startup; the helper is only built and started on first use.
pub fn init(app: AppHandle, app_dir: &Path) {
    let _ = SIM.set(Arc::new(Sim {
        app,
        dir: app_dir.join("simulator"),
        helper: tokio::sync::Mutex::new(None),
        attached: parking_lot::Mutex::new(None),
        booted: parking_lot::Mutex::new(HashSet::new()),
        recording: tokio::sync::Mutex::new(None),
        stream: parking_lot::Mutex::new(None),
        generation: AtomicU64::new(0),
        ops: tokio::sync::Mutex::new(()),
        subscribers: parking_lot::Mutex::new(Vec::new()),
        next_subscriber: AtomicU64::new(1),
        streaming: AtomicBool::new(false),
        idle_token: AtomicU64::new(0),
        idle_timers: parking_lot::Mutex::new(HashMap::new()),
        build_error: parking_lot::Mutex::new(None),
        recoveries: parking_lot::Mutex::new(Vec::new()),
    }));
}

fn sim() -> Result<Arc<Sim>> {
    SIM.get()
        .cloned()
        .ok_or_else(|| Error::new("unavailable", "The simulator is not ready yet."))
}

pub fn valid_udid(udid: &str) -> bool {
    udid.len() == 36
        && udid.chars().enumerate().all(|(index, ch)| match index {
            8 | 13 | 18 | 23 => ch == '-',
            _ => ch.is_ascii_hexdigit(),
        })
}

fn unit(value: f64) -> Result<f64> {
    if value.is_finite() && (0.0..=1.0).contains(&value) {
        Ok(value)
    } else {
        Err(Error::new("invalid", "Coordinates are normalized 0..1."))
    }
}

async fn run(args: &[&str], timeout: Duration) -> Result<std::process::Output> {
    let mut command = tokio::process::Command::new(XCRUN);
    command.args(args);
    crate::cli_output::capture_command(command, timeout)
        .await
        .map_err(|error| Error::new("simulator", format!("xcrun failed: {error}")))
}

fn stderr_of(output: &std::process::Output) -> String {
    String::from_utf8_lossy(&output.stderr)
        .trim()
        .chars()
        .take(400)
        .collect()
}

/// Whether a full Xcode with SimulatorKit is selected; checked without building anything.
pub async fn probe() -> Value {
    let developer = tokio::process::Command::new("/usr/bin/xcode-select")
        .arg("-p")
        .output()
        .await
        .ok()
        .filter(|output| output.status.success())
        .map(|output| String::from_utf8_lossy(&output.stdout).trim().to_string())
        .unwrap_or_default();
    let dir = PathBuf::from(&developer);
    let kit = dir
        .join("Library/PrivateFrameworks/SimulatorKit.framework")
        .is_dir()
        || dir.parent().is_some_and(|parent| {
            parent
                .join("SharedFrameworks/SimulatorKit.framework")
                .is_dir()
        });
    json!({
        "available": cfg!(target_os = "macos") && kit,
        "developerDirectory": developer,
        "reason": if kit { Value::Null } else { json!("Install Xcode from the App Store and select it with xcode-select.") },
    })
}

fn source_hash() -> String {
    use sha2::{Digest, Sha256};
    let mut hasher = Sha256::new();
    for (name, text) in SOURCES {
        hasher.update(name.as_bytes());
        hasher.update(text.as_bytes());
    }
    hasher.finalize()[..8]
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

/// Builds the helper with the person's Xcode, once per Xcode build and source version.
async fn build(sim: &Sim) -> Result<PathBuf> {
    if let Some(message) = sim.build_error.lock().clone() {
        return Err(Error::new("simulator", message));
    }
    let result = build_once(sim).await;
    // A compiler failure repeats until Xcode changes; remember it for this run.
    if let Err(Error::App { message, .. }) = &result {
        if message.starts_with("Building the simulator helper failed") {
            *sim.build_error.lock() = Some(message.clone());
        }
    }
    result
}

async fn build_once(sim: &Sim) -> Result<PathBuf> {
    let version = tokio::process::Command::new("/usr/bin/xcodebuild")
        .arg("-version")
        .output()
        .await
        .ok()
        .filter(|output| output.status.success())
        .map(|output| String::from_utf8_lossy(&output.stdout).to_string())
        .ok_or_else(|| Error::new("xcode", "Xcode is not installed or not selected."))?;
    let build_id: String = version
        .lines()
        .find_map(|line| line.strip_prefix("Build version "))
        .unwrap_or("unknown")
        .chars()
        .filter(|ch| ch.is_ascii_alphanumeric())
        .collect();
    let root = sim
        .dir
        .join("helper")
        .join(format!("{build_id}-{}", source_hash()));
    let binary = root.join("sirus-simulator-helper");
    if binary.is_file() {
        return Ok(binary);
    }
    let sources = root.join("src");
    std::fs::create_dir_all(&sources)?;
    for (name, text) in SOURCES {
        std::fs::write(sources.join(name), text)?;
    }
    let arch = std::env::consts::ARCH.replace("aarch64", "arm64");
    let target = format!("{arch}-apple-macosx13.0");
    let mut objects = vec![];
    for name in ["AXBridge", "HIDBridge"] {
        let source = sources.join(format!("{name}.m"));
        let object = root.join(format!("{name}.o"));
        let output = run(
            &[
                "clang",
                "-c",
                "-fobjc-arc",
                "-O2",
                "-fmodules",
                "-target",
                &target,
                &source.to_string_lossy(),
                "-o",
                &object.to_string_lossy(),
            ],
            Duration::from_secs(180),
        )
        .await?;
        if !output.status.success() {
            return Err(Error::new(
                "simulator",
                format!(
                    "Building the simulator helper failed: {}",
                    stderr_of(&output)
                ),
            ));
        }
        objects.push(object.to_string_lossy().to_string());
    }
    let temporary = root.join(".helper-building");
    let header = sources.join("DeviceHelper-Bridging-Header.h");
    let mut args: Vec<String> = [
        "swiftc",
        "-O",
        "-whole-module-optimization",
        "-swift-version",
        "5",
        "-target",
        &target,
        "-import-objc-header",
        &header.to_string_lossy(),
    ]
    .iter()
    .map(|item| item.to_string())
    .collect();
    for framework in [
        "Foundation",
        "AppKit",
        "CoreGraphics",
        "CoreImage",
        "CoreMedia",
        "CoreVideo",
        "ImageIO",
        "IOSurface",
        "VideoToolbox",
        "Metal",
    ] {
        args.push("-framework".into());
        args.push(framework.into());
    }
    args.extend(objects);
    args.extend(
        SWIFT_ORDER
            .iter()
            .map(|name| sources.join(name).to_string_lossy().to_string()),
    );
    args.push("-o".into());
    args.push(temporary.to_string_lossy().to_string());
    let refs: Vec<&str> = args.iter().map(String::as_str).collect();
    let output = run(&refs, Duration::from_secs(300)).await?;
    if !output.status.success() {
        return Err(Error::new(
            "simulator",
            format!(
                "Building the simulator helper failed: {}",
                stderr_of(&output)
            ),
        ));
    }
    std::fs::rename(&temporary, &binary)?;
    Ok(binary)
}

/// Starts the helper when none is running. Returns true when it was (re)started,
/// so the caller can re-attach a device the previous helper had.
async fn ensure_helper(sim: &Sim) -> Result<bool> {
    let mut guard = sim.helper.lock().await;
    if guard
        .as_ref()
        .is_some_and(|helper| !helper.dead.load(Ordering::Acquire))
    {
        return Ok(false);
    }
    let restarted = guard.is_some();
    let binary = build(sim).await?;
    let mut child = tokio::process::Command::new(&binary)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true)
        .spawn()
        .map_err(|error| {
            Error::new(
                "simulator",
                format!("The simulator helper did not start: {error}"),
            )
        })?;
    let stdin = child
        .stdin
        .take()
        .ok_or_else(|| Error::new("simulator", "helper stdin"))?;
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| Error::new("simulator", "helper stdout"))?;
    // The last lines the helper wrote to stderr explain a crash or failed call.
    let stderr_tail: Arc<parking_lot::Mutex<String>> = Default::default();
    if let Some(stderr) = child.stderr.take() {
        let tail = stderr_tail.clone();
        tauri::async_runtime::spawn(async move {
            let mut lines = BufReader::new(stderr).lines();
            while let Ok(Some(line)) = lines.next_line().await {
                let mut tail = tail.lock();
                tail.push_str(line.chars().take(400).collect::<String>().as_str());
                tail.push('\n');
                if tail.len() > 2048 {
                    let cut = tail.len() - 2048;
                    let cut = (cut..tail.len())
                        .find(|index| tail.is_char_boundary(*index))
                        .unwrap_or(0);
                    tail.drain(..cut);
                }
            }
        });
    }
    let pending: Pending = Default::default();
    let dead = Arc::new(AtomicBool::new(false));
    let (reader_pending, reader_dead, reader_tail) =
        (pending.clone(), dead.clone(), stderr_tail.clone());
    tauri::async_runtime::spawn(async move {
        let mut reader = BufReader::new(stdout);
        let mut line = Vec::new();
        loop {
            line.clear();
            match (&mut reader)
                .take(MAX_REPLY_LINE as u64 + 1)
                .read_until(b'\n', &mut line)
                .await
            {
                Ok(0) | Err(_) => break,
                Ok(_) => {}
            }
            if line.last() != Some(&b'\n') {
                if line.len() <= MAX_REPLY_LINE {
                    break; // End of output without a final newline.
                }
                // Longer than any reply: discard the rest of the line, fail its call.
                if !skip_line(&mut reader).await {
                    break;
                }
                if let Some(id) = oversized_id(&line) {
                    if let Some(sender) = reader_pending.lock().remove(&id) {
                        let _ = sender.send(Err("the simulator reply was too large".into()));
                    }
                }
                continue;
            }
            let Ok(message) = serde_json::from_slice::<Value>(&line) else {
                continue;
            };
            let Some(id) = message.get("id").and_then(Value::as_u64) else {
                continue;
            };
            let reply = match message.get("error") {
                Some(error) => Err(error
                    .get("message")
                    .and_then(Value::as_str)
                    .unwrap_or("simulator error")
                    .chars()
                    .take(400)
                    .collect()),
                None => Ok(message.get("result").cloned().unwrap_or(Value::Null)),
            };
            if let Some(sender) = reader_pending.lock().remove(&id) {
                let _ = sender.send(reply);
            }
        }
        reader_dead.store(true, Ordering::Release);
        let reason = helper_stopped(&reader_tail.lock());
        for (_, sender) in reader_pending.lock().drain() {
            let _ = sender.send(Err(reason.clone()));
        }
        // A device stays attached across a helper crash: bring it back.
        if let Some(sim) = SIM.get().cloned() {
            if sim.attached.lock().is_some() && allow_recovery(&sim) {
                tauri::async_runtime::spawn(async move {
                    let _ = recover(sim).await;
                });
            }
        }
    });
    *guard = Some(Helper {
        stdin,
        pending,
        next: AtomicU64::new(1),
        dead,
        stderr: stderr_tail,
        _child: child,
    });
    Ok(restarted)
}

/// Consumes input up to and including the next newline without buffering it.
async fn skip_line<R: tokio::io::AsyncBufRead + Unpin>(reader: &mut R) -> bool {
    loop {
        let Ok(buffer) = reader.fill_buf().await else {
            return false;
        };
        if buffer.is_empty() {
            return false;
        }
        match buffer.iter().position(|byte| *byte == b'\n') {
            Some(index) => {
                reader.consume(index + 1);
                return true;
            }
            None => {
                let length = buffer.len();
                reader.consume(length);
            }
        }
    }
}

fn helper_stopped(tail: &str) -> String {
    let last = tail.lines().rev().find(|line| !line.trim().is_empty());
    match last {
        Some(line) => format!("The simulator helper stopped: {}", line.trim()),
        None => "The simulator helper stopped.".into(),
    }
}

/// The JSON-RPC id at the start of an oversized reply line, if present.
fn oversized_id(line: &[u8]) -> Option<u64> {
    let head = String::from_utf8_lossy(&line[..line.len().min(256)]);
    let start = head.find("\"id\":")? + 5;
    let digits: String = head[start..]
        .trim_start()
        .chars()
        .take_while(char::is_ascii_digit)
        .collect();
    digits.parse().ok()
}

/// At most three automatic recoveries a minute, so a helper that keeps
/// crashing surfaces its error instead of looping.
fn allow_recovery(sim: &Sim) -> bool {
    let now = std::time::Instant::now();
    let mut recent = sim.recoveries.lock();
    recent.retain(|at| now.duration_since(*at) < Duration::from_secs(60));
    if recent.len() >= 3 {
        return false;
    }
    recent.push(now);
    true
}

/// Re-attaches the current device to a fresh helper and restarts the stream if a pane watches.
/// Boxed because it is spawned from `ensure_helper`, which it calls again.
fn recover(
    sim: Arc<Sim>,
) -> std::pin::Pin<Box<dyn std::future::Future<Output = Result<()>> + Send>> {
    Box::pin(async move {
        let _ops = sim.ops.lock().await;
        let Some(udid) = sim.attached.lock().as_ref().map(|item| item.udid.clone()) else {
            return Ok(());
        };
        discard_stream(&sim);
        call(
            &sim,
            "attach",
            json!({ "udid": udid }),
            Duration::from_secs(60),
        )
        .await?;
        reconcile_locked(&sim).await
    })
}

async fn call(sim: &Sim, method: &str, params: Value, timeout: Duration) -> Result<Value> {
    if ensure_helper(sim).await? && !matches!(method, "attach" | "list" | "ping") {
        // A new helper knows no device yet; re-attach the one the pane shows.
        // Its stream is restarted by `recover`, spawned when the old one exited.
        let udid = sim.attached.lock().as_ref().map(|item| item.udid.clone());
        if let Some(udid) = udid {
            send(
                sim,
                "attach",
                json!({ "udid": udid }),
                Duration::from_secs(60),
            )
            .await?;
        }
    }
    send(sim, method, params, timeout).await
}

async fn send(sim: &Sim, method: &str, params: Value, timeout: Duration) -> Result<Value> {
    let (receiver, pending, id, tail) = {
        let mut guard = sim.helper.lock().await;
        let helper = guard
            .as_mut()
            .ok_or_else(|| Error::new("simulator", "helper unavailable"))?;
        let id = helper.next.fetch_add(1, Ordering::Relaxed);
        let (sender, receiver) = oneshot::channel();
        helper.pending.lock().insert(id, sender);
        let mut line = serde_json::to_vec(
            &json!({ "jsonrpc": "2.0", "id": id, "method": method, "params": params }),
        )
        .map_err(|error| Error::new("simulator", error.to_string()))?;
        line.push(b'\n');
        if helper.stdin.write_all(&line).await.is_err() || helper.stdin.flush().await.is_err() {
            helper.pending.lock().remove(&id);
            return Err(Error::new(
                "simulator",
                helper_stopped(&helper.stderr.lock()),
            ));
        }
        (receiver, helper.pending.clone(), id, helper.stderr.clone())
    };
    match tokio::time::timeout(timeout, receiver).await {
        Ok(Ok(Ok(value))) => Ok(value),
        Ok(Ok(Err(message))) => Err(Error::new("simulator", message)),
        Ok(Err(_)) => Err(Error::new("simulator", helper_stopped(&tail.lock()))),
        Err(_) => {
            pending.lock().remove(&id);
            Err(Error::new(
                "simulator",
                format!("The simulator did not answer '{method}'."),
            ))
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Device {
    pub udid: String,
    pub name: String,
    pub runtime: String,
    pub booted: bool,
    pub family: String,
}

fn runtime_label(identifier: &str) -> String {
    // com.apple.CoreSimulator.SimRuntime.iOS-27-0 → iOS 27.0
    let tail = identifier.rsplit('.').next().unwrap_or(identifier);
    let mut parts = tail.split('-');
    let os = parts.next().unwrap_or_default();
    let version: Vec<&str> = parts.collect();
    if version.is_empty() {
        os.to_string()
    } else {
        format!("{os} {}", version.join("."))
    }
}

async fn devices(sim: &Sim) -> Result<Vec<Device>> {
    let result = call(sim, "list", json!({}), CALL_TIMEOUT).await?;
    let mut list: Vec<Device> = result
        .get("devices")
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .filter_map(|item| {
                    let udid = item.get("udid")?.as_str()?.to_string();
                    let runtime = item
                        .get("runtime")
                        .and_then(Value::as_str)
                        .unwrap_or_default();
                    if !valid_udid(&udid) || !runtime.contains("iOS") {
                        return None;
                    }
                    let device_type = item
                        .get("deviceType")
                        .and_then(Value::as_str)
                        .unwrap_or_default();
                    Some(Device {
                        udid,
                        name: item
                            .get("name")
                            .and_then(Value::as_str)
                            .unwrap_or("Simulator")
                            .chars()
                            .take(80)
                            .collect(),
                        runtime: runtime_label(runtime),
                        booted: item.get("booted").and_then(Value::as_bool).unwrap_or(false),
                        family: if device_type.contains("iPad") {
                            "tablet".into()
                        } else {
                            "phone".into()
                        },
                    })
                })
                .collect()
        })
        .unwrap_or_default();
    list.sort_by(|a, b| a.name.cmp(&b.name));
    list.truncate(64);
    Ok(list)
}

fn emit_state(sim: &Sim) {
    let attached = sim.attached.lock().clone();
    let _ = sim.app.emit(STATE_EVENT, json!({ "attached": attached }));
}

async fn boot(sim: &Sim, udid: &str) -> Result<()> {
    let list = devices(sim).await?;
    let device = list
        .iter()
        .find(|device| device.udid == udid)
        .ok_or_else(|| Error::not_found("simulator not found"))?;
    if device.booted {
        return Ok(());
    }
    {
        // Devices shut down outside the app no longer count toward the cap, and
        // the slot is taken before the slow boot so two boots cannot both pass.
        let mut booted = sim.booted.lock();
        booted.retain(|id| list.iter().any(|item| &item.udid == id && item.booted));
        if booted.len() >= MAX_BOOTED {
            return Err(Error::new(
                "limit",
                "Sirus Code already started 3 simulators. Shut one down first.",
            ));
        }
        booted.insert(udid.to_string());
    }
    let started = match run(&["simctl", "boot", udid], Duration::from_secs(120)).await {
        Ok(output) => {
            let error = stderr_of(&output);
            // "current state: Booted/Booting": someone else started it already.
            if output.status.success() || error.contains("Booted") || error.contains("Booting") {
                Ok(())
            } else {
                Err(Error::new(
                    "simulator",
                    format!("The simulator did not boot: {error}"),
                ))
            }
        }
        Err(error) => Err(error),
    };
    if let Err(error) = started {
        sim.booted.lock().remove(udid);
        return Err(error);
    }
    let _ = run(&["simctl", "bootstatus", udid], Duration::from_secs(180)).await;
    // `bootstatus` returns before SpringBoard accepts touches; a HID client
    // created earlier silently drops input, so give the home screen a moment.
    tokio::time::sleep(BOOT_SETTLE).await;
    Ok(())
}

/// Forgets the current stream locally (frames of older generations are ignored).
fn discard_stream(sim: &Sim) {
    sim.generation.fetch_add(1, Ordering::AcqRel);
    if let Some(task) = sim.stream.lock().take() {
        task.abort();
    }
    sim.streaming.store(false, Ordering::Release);
}

async fn stop_stream(sim: &Sim) {
    discard_stream(sim);
    let _ = call(sim, "stream.stop", json!({}), CALL_TIMEOUT).await;
}

/// Listens on the private frame socket and forwards each envelope, unchanged,
/// as raw bytes to every subscribed pane (an `ArrayBuffer` in the webview).
fn start_frames(sim: &Arc<Sim>, socket: PathBuf, generation: u64) -> Result<()> {
    let _ = std::fs::remove_file(&socket);
    let listener = tokio::net::UnixListener::bind(&socket)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(&socket, std::fs::Permissions::from_mode(0o600));
    }
    let owner = sim.clone();
    let task = tauri::async_runtime::spawn(async move {
        if let Ok((mut stream, _)) = listener.accept().await {
            let mut length = [0u8; 4];
            while stream.read_exact(&mut length).await.is_ok() {
                let size = u32::from_le_bytes(length) as usize;
                if !(17..=MAX_FRAME).contains(&size) {
                    break;
                }
                let mut envelope = vec![0u8; size];
                if stream.read_exact(&mut envelope).await.is_err() {
                    break;
                }
                if owner.generation.load(Ordering::Acquire) != generation {
                    return;
                }
                if u16::from_le_bytes([envelope[0], envelope[1]]) != 0x5346
                    || 17 + envelope[16] as usize > envelope.len()
                {
                    continue;
                }
                if envelope[3] & 2 != 0 {
                    // Codec parameters: declare no frame reordering so the webview's
                    // decoder shows each frame at once (see `simulator_h264`).
                    let header = 17 + envelope[16] as usize;
                    if let Some(parameters) =
                        crate::simulator_h264::low_latency_parameters(&envelope[header..])
                    {
                        envelope.truncate(header);
                        envelope.extend_from_slice(&parameters);
                    }
                }
                let channels: Vec<_> = owner
                    .subscribers
                    .lock()
                    .iter()
                    .map(|(_, channel)| channel.clone())
                    .collect();
                for channel in channels {
                    let _ = channel.send(InvokeResponseBody::Raw(envelope.clone()));
                }
            }
        }
        // The frame socket closed while this stream was current: restart it from
        // another task, since discarding the stream aborts this one.
        if owner.generation.load(Ordering::Acquire) == generation && allow_recovery(&owner) {
            tauri::async_runtime::spawn(async move {
                let _ops = owner.ops.lock().await;
                if owner.generation.load(Ordering::Acquire) == generation {
                    discard_stream(&owner);
                    let _ = call(&owner, "stream.stop", json!({}), CALL_TIMEOUT).await;
                    let _ = reconcile_locked(&owner).await;
                }
            });
        }
    });
    *sim.stream.lock() = Some(task);
    Ok(())
}

/// Opens a fresh frame socket and starts the helper stream (codec parameters and a keyframe first).
/// A device that just booted may have no framebuffer yet; retry for a while.
async fn start_stream(sim: &Arc<Sim>) -> Result<Value> {
    std::fs::create_dir_all(&sim.dir)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(&sim.dir, std::fs::Permissions::from_mode(0o700));
    }
    let socket = sim.dir.join("frames.sock");
    let deadline = std::time::Instant::now() + DISPLAY_WAIT;
    loop {
        let generation = sim.generation.fetch_add(1, Ordering::AcqRel) + 1;
        start_frames(sim, socket.clone(), generation)?;
        let started = call(
            sim,
            "stream.start",
            json!({ "socketPath": socket.to_string_lossy(), "keyframeIntervalSeconds": 2.0 }),
            CALL_TIMEOUT,
        )
        .await;
        match started {
            Ok(value) => {
                sim.streaming.store(true, Ordering::Release);
                return Ok(value);
            }
            Err(error) => {
                discard_stream(sim);
                let message = error.to_string();
                if message.contains("already running") {
                    let _ = call(sim, "stream.stop", json!({}), CALL_TIMEOUT).await;
                } else if !message.contains("framebuffer") {
                    return Err(error);
                }
                if std::time::Instant::now() >= deadline {
                    return Err(error);
                }
                tokio::time::sleep(Duration::from_millis(750)).await;
            }
        }
    }
}

/// Runs the stream exactly while a device is attached and a pane watches it.
async fn reconcile_locked(sim: &Arc<Sim>) -> Result<()> {
    let wanted = sim.attached.lock().is_some() && !sim.subscribers.lock().is_empty();
    let running = sim.streaming.load(Ordering::Acquire);
    if wanted && !running {
        start_stream(sim).await?;
    } else if !wanted && running {
        stop_stream(sim).await;
    }
    Ok(())
}

async fn reconcile(sim: &Arc<Sim>) -> Result<()> {
    let _ops = sim.ops.lock().await;
    reconcile_locked(sim).await
}

async fn attach(sim: &Arc<Sim>, udid: &str) -> Result<Attached> {
    if !valid_udid(udid) {
        return Err(Error::new("invalid", "Invalid simulator."));
    }
    let _ops = sim.ops.lock().await;
    let current = sim.attached.lock().clone();
    if let Some(current) = current.filter(|item| item.udid == udid) {
        return Ok(current);
    }
    let previous = detach_locked(sim).await;
    boot(sim, udid).await?;
    // Switching away shuts down the device Sirus Code booted for the previous one.
    if let Some(previous) = previous.filter(|previous| previous != udid) {
        shutdown_owned(sim, &previous).await;
    }
    let geometry = call(
        sim,
        "attach",
        json!({ "udid": udid }),
        Duration::from_secs(60),
    )
    .await?;
    let list = devices(sim).await.unwrap_or_default();
    let device = list.iter().find(|device| device.udid == udid);
    let size = |key: &str, fallback: u64| {
        geometry
            .get(key)
            .and_then(Value::as_u64)
            .unwrap_or(fallback)
            .min(16_384) as u32
    };
    let points = |key: &str, fallback: f64| {
        geometry
            .get(key)
            .and_then(Value::as_f64)
            .filter(|value| value.is_finite() && *value > 0.0)
            .unwrap_or(fallback)
    };
    let attached = Attached {
        udid: udid.to_string(),
        name: device
            .map(|device| device.name.clone())
            .unwrap_or_else(|| "Simulator".into()),
        family: device
            .map(|device| device.family.clone())
            .unwrap_or_else(|| "phone".into()),
        pixel_width: size("pixelWidth", 1206),
        pixel_height: size("pixelHeight", 2622),
        point_width: points("pointWidth", 402.0),
        point_height: points("pointHeight", 874.0),
        input: geometry
            .get("capabilities")
            .and_then(|caps| caps.get("input"))
            .and_then(Value::as_bool)
            .unwrap_or(false),
    };
    *sim.attached.lock() = Some(attached.clone());
    emit_state(sim);
    reconcile_locked(sim).await?;
    Ok(attached)
}

async fn detach(sim: &Arc<Sim>) {
    let _ops = sim.ops.lock().await;
    detach_locked(sim).await;
}

/// Stops the stream and any recording, and schedules the idle shutdown of a
/// device Sirus Code booted. Returns the device that was attached.
async fn detach_locked(sim: &Arc<Sim>) -> Option<String> {
    let previous = sim.attached.lock().take();
    if sim.streaming.load(Ordering::Acquire) || sim.stream.lock().is_some() {
        stop_stream(sim).await;
    } else {
        discard_stream(sim);
    }
    discard_recording(sim).await;
    let previous = previous?;
    emit_state(sim);
    // A device Sirus Code booted shuts down after a while unless it is attached
    // again; a later detach of the same device replaces this timer.
    if sim.booted.lock().contains(&previous.udid) {
        let token = sim.idle_token.fetch_add(1, Ordering::AcqRel) + 1;
        sim.idle_timers.lock().insert(previous.udid.clone(), token);
        let owner = sim.clone();
        let udid = previous.udid.clone();
        tauri::async_runtime::spawn(async move {
            tokio::time::sleep(IDLE_SHUTDOWN).await;
            if owner.idle_timers.lock().get(&udid) != Some(&token) {
                return;
            }
            let _ops = owner.ops.lock().await;
            let again = owner
                .attached
                .lock()
                .as_ref()
                .is_some_and(|item| item.udid == udid);
            if !again {
                owner.idle_timers.lock().remove(&udid);
                shutdown_owned(&owner, &udid).await;
            }
        });
    }
    Some(previous.udid)
}

/// Ends a running recording without saving it (detach, switch, quit).
async fn discard_recording(sim: &Sim) {
    let Some(mut current) = sim.recording.lock().await.take() else {
        return;
    };
    #[cfg(unix)]
    if let Some(pid) = current.child.id() {
        unsafe { libc::kill(pid as i32, libc::SIGINT) };
    }
    if tokio::time::timeout(Duration::from_secs(5), current.child.wait())
        .await
        .is_err()
    {
        let _ = current.child.kill().await;
    }
    let _ = std::fs::remove_file(&current.file);
}

async fn shutdown_owned(sim: &Sim, udid: &str) {
    if sim.booted.lock().remove(udid) {
        let _ = run(&["simctl", "shutdown", udid], Duration::from_secs(60)).await;
    }
}

/// On quit: stop recording and shut down every simulator Sirus Code booted.
pub fn shutdown_all() {
    let Some(sim) = SIM.get().cloned() else {
        return;
    };
    if let Ok(mut recording) = sim.recording.try_lock() {
        if let Some(mut current) = recording.take() {
            #[cfg(unix)]
            if let Some(pid) = current.child.id() {
                unsafe { libc::kill(pid as i32, libc::SIGINT) };
            }
            let _ = current.child.start_kill();
            let _ = std::fs::remove_file(&current.file);
        }
    }
    let owned: Vec<String> = sim.booted.lock().drain().collect();
    for udid in owned {
        let _ = std::process::Command::new(XCRUN)
            .args(["simctl", "shutdown", &udid])
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status();
    }
}

/// The helper types about one character every 30 ms.
fn text_timeout(text: &str) -> Duration {
    CALL_TIMEOUT + Duration::from_millis(40 * text.chars().count() as u64)
}

fn attached_udid(sim: &Sim) -> Result<String> {
    sim.attached
        .lock()
        .as_ref()
        .map(|item| item.udid.clone())
        .ok_or_else(|| Error::new("not_attached", "Choose a simulator first."))
}

async fn press_button(sim: &Sim, name: &str) -> Result<Value> {
    // The HID Home usage goes home on Face ID devices too; a synthetic edge
    // swipe was unreliable (apps take it as a scroll).
    call(sim, "button", json!({ "name": name }), CALL_TIMEOUT).await
}

async fn save_dialog(app: &AppHandle, name: &str, extension: &str) -> Option<PathBuf> {
    use tauri_plugin_dialog::DialogExt;
    let (tx, rx) = tokio::sync::oneshot::channel();
    app.dialog()
        .file()
        .set_file_name(name)
        .add_filter(extension.to_uppercase(), &[extension])
        .save_file(move |file| {
            let _ = tx.send(file.and_then(|path| path.into_path().ok()));
        });
    rx.await.ok().flatten()
}

#[derive(Deserialize)]
#[serde(
    tag = "type",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum Action {
    Probe {},
    List {},
    Attach {
        udid: String,
    },
    Detach {},
    Tap {
        x: f64,
        y: f64,
    },
    Touch {
        phase: String,
        x: f64,
        y: f64,
    },
    Swipe {
        start_x: f64,
        start_y: f64,
        end_x: f64,
        end_y: f64,
    },
    Key {
        usage: u32,
        phase: Option<String>,
    },
    Text {
        text: String,
    },
    Button {
        name: String,
    },
    Screenshot {},
    /// Asks for codec parameters and a keyframe of the current screen.
    Resync {},
    /// A mounted pane subscribes its frame channel; returns the subscription id.
    Watch {
        channel: JavaScriptChannelId,
    },
    /// Ends a subscription from `Watch`.
    Unwatch {
        id: u64,
    },

    Record {
        start: bool,
    },
    Shutdown {
        udid: String,
        confirm: bool,
    },
}

#[tauri::command]
pub async fn simulator_action(
    app: AppHandle,
    webview: tauri::Webview,
    action: Action,
) -> Result<Value> {
    let _ = &app;
    let sim = sim()?;
    match action {
        Action::Probe {} => Ok(probe().await),
        Action::List {} => Ok(json!({
            "devices": devices(&sim).await?,
            "attached": sim.attached.lock().clone(),
            "recording": sim.recording.lock().await.is_some(),
        })),
        Action::Attach { udid } => Ok(serde_json::to_value(attach(&sim, &udid).await?).unwrap_or(Value::Null)),
        Action::Detach {} => {
            detach(&sim).await;
            Ok(json!({ "detached": true }))
        }
        Action::Tap { x, y } => {
            call(&sim, "tap", json!({ "x": unit(x)?, "y": unit(y)? }), CALL_TIMEOUT).await
        }
        Action::Touch { phase, x, y } => {
            if !matches!(phase.as_str(), "down" | "move" | "up") {
                return Err(Error::new("invalid", "Unknown touch phase."));
            }
            call(&sim, "touch", json!({ "phase": phase, "x": unit(x)?, "y": unit(y)? }), CALL_TIMEOUT).await
        }
        Action::Swipe { start_x, start_y, end_x, end_y } => call(
            &sim,
            "swipe",
            json!({ "startX": unit(start_x)?, "startY": unit(start_y)?, "endX": unit(end_x)?, "endY": unit(end_y)?, "durationMs": 250 }),
            CALL_TIMEOUT,
        )
        .await,
        Action::Key { usage, phase } => {
            if usage == 0 || usage > 0xE7 || phase.as_deref().is_some_and(|phase| !matches!(phase, "down" | "up")) {
                return Err(Error::new("invalid", "Unknown key."));
            }
            call(&sim, "key", json!({ "usage": usage, "phase": phase }), CALL_TIMEOUT).await
        }
        Action::Text { text } => {
            if text.chars().count() > MAX_TEXT {
                return Err(Error::new("invalid", "Text is too long."));
            }
            let timeout = text_timeout(&text);
            call(&sim, "text", json!({ "text": text }), timeout).await
        }
        Action::Button { name } => {
            if !matches!(name.as_str(), "home" | "lock" | "side" | "siri" | "volume-up" | "volume-down") {
                return Err(Error::new("invalid", "Unknown button."));
            }
            press_button(&sim, &name).await
        }
        Action::Resync {} => {
            attached_udid(&sim)?;
            let running = sim.streaming.load(Ordering::Acquire)
                && call(&sim, "stream.keyframe", json!({}), CALL_TIMEOUT)
                    .await?
                    .get("running")
                    .and_then(Value::as_bool)
                    .unwrap_or(false);
            if !running {
                // The helper lost the stream (restart): start a new one.
                let _ops = sim.ops.lock().await;
                discard_stream(&sim);
                reconcile_locked(&sim).await?;
            }
            Ok(json!({ "resynced": true }))
        }
        Action::Watch { channel } => {
            let id = sim.next_subscriber.fetch_add(1, Ordering::Relaxed);
            {
                let mut subscribers = sim.subscribers.lock();
                subscribers.push((id, channel.channel_on(webview)));
                let excess = subscribers.len().saturating_sub(MAX_SUBSCRIBERS);
                subscribers.drain(..excess);
            }
            reconcile(&sim).await?;
            Ok(json!({ "id": id }))
        }
        Action::Unwatch { id } => {
            sim.subscribers.lock().retain(|(item, _)| *item != id);
            reconcile(&sim).await?;
            Ok(json!({ "unwatched": true }))
        }
        Action::Screenshot {} => {
            attached_udid(&sim)?;
            let name = format!("Simulator {}.png", chrono::Local::now().format("%Y-%m-%d %H.%M.%S"));
            let Some(path) = save_dialog(&sim.app, &name, "png").await else {
                return Ok(json!({ "saved": false }));
            };
            let path = path.with_extension("png");
            call(&sim, "screenshot", json!({ "path": path.to_string_lossy() }), CALL_TIMEOUT).await?;
            Ok(json!({ "saved": true }))
        }
        Action::Record { start } => {
            let mut recording = sim.recording.lock().await;
            if start {
                if recording.is_some() {
                    return Err(Error::new("invalid", "A recording is already running."));
                }
                let udid = attached_udid(&sim)?;
                std::fs::create_dir_all(&sim.dir)?;
                let file = sim.dir.join(format!("recording-{}.mp4", uuid::Uuid::new_v4()));
                let child = tokio::process::Command::new(XCRUN)
                    .args(["simctl", "io", &udid, "recordVideo", "--codec=h264", "--force"])
                    .arg(&file)
                    .stdin(Stdio::null())
                    .stdout(Stdio::null())
                    .stderr(Stdio::null())
                    .kill_on_drop(true)
                    .spawn()
                    .map_err(|error| Error::new("simulator", format!("Recording did not start: {error}")))?;
                *recording = Some(Recording { udid, file, child });
                return Ok(json!({ "recording": true }));
            }
            let Some(mut current) = recording.take() else {
                return Ok(json!({ "recording": false }));
            };
            drop(recording);
            #[cfg(unix)]
            if let Some(pid) = current.child.id() {
                // recordVideo finalizes the movie on SIGINT.
                unsafe { libc::kill(pid as i32, libc::SIGINT) };
            }
            let _ = tokio::time::timeout(Duration::from_secs(15), current.child.wait()).await;
            let name = format!("Simulator {}.mp4", chrono::Local::now().format("%Y-%m-%d %H.%M.%S"));
            let _ = &current.udid;
            let saved = match save_dialog(&sim.app, &name, "mp4").await {
                Some(path) => {
                    let path = path.with_extension("mp4");
                    std::fs::copy(&current.file, &path).is_ok()
                }
                None => false,
            };
            let _ = std::fs::remove_file(&current.file);
            Ok(json!({ "recording": false, "saved": saved }))
        }
        Action::Shutdown { udid, confirm } => {
            if !confirm || !valid_udid(&udid) {
                return Err(Error::new("invalid", "Shutting down a simulator needs confirmation."));
            }
            let _ops = sim.ops.lock().await;
            if sim.attached.lock().as_ref().is_some_and(|item| item.udid == udid) {
                detach_locked(&sim).await;
            }
            sim.booted.lock().remove(&udid);
            sim.idle_timers.lock().remove(&udid);
            let output = run(&["simctl", "shutdown", &udid], Duration::from_secs(60)).await?;
            if !output.status.success() && !stderr_of(&output).contains("Shutdown") {
                return Err(Error::new("simulator", stderr_of(&output)));
            }
            Ok(json!({ "shutdown": true }))
        }
    }
}

// MARK: - Agent tools (served through the app's MCP bridge, see browser_mcp.rs)

pub fn tool_definitions() -> Vec<Value> {
    let point = json!({ "type": "object", "properties": { "x": { "type": "number", "description": "0..1 from the left" }, "y": { "type": "number", "description": "0..1 from the top" } }, "required": ["x", "y"] });
    vec![
        json!({ "name": "simulator_list", "description": "List iOS simulators (name, runtime, booted) and the one attached to the Sirus Code Simulator pane.", "inputSchema": { "type": "object", "properties": {} } }),
        json!({ "name": "simulator_boot", "description": "Boot (if needed) and attach an iOS simulator by udid or exact name; it opens in the person's Simulator pane.", "inputSchema": { "type": "object", "properties": { "udid": { "type": "string" }, "name": { "type": "string" } } } }),
        json!({ "name": "simulator_install", "description": "Install a built .app bundle (path inside this session's workspace) on the attached simulator.", "inputSchema": { "type": "object", "properties": { "path": { "type": "string" } }, "required": ["path"] } }),
        json!({ "name": "simulator_launch", "description": "Launch an installed app by bundle identifier on the attached simulator.", "inputSchema": { "type": "object", "properties": { "bundleId": { "type": "string" } }, "required": ["bundleId"] } }),
        json!({ "name": "simulator_screenshot", "description": "PNG screenshot of the attached simulator screen.", "inputSchema": { "type": "object", "properties": {} } }),
        json!({ "name": "simulator_describe_ui", "description": "Accessibility tree of the frontmost app (roles, labels, frames in points). Divide a point by the attached device's pointWidth/pointHeight (simulator_list) to get the 0..1 coordinates simulator_tap takes.", "inputSchema": { "type": "object", "properties": {} } }),
        json!({ "name": "simulator_tap", "description": "Tap at normalized screen coordinates (0..1 of the screen width and height, not points).", "inputSchema": point }),
        json!({ "name": "simulator_swipe", "description": "Swipe between normalized points.", "inputSchema": { "type": "object", "properties": { "startX": { "type": "number" }, "startY": { "type": "number" }, "endX": { "type": "number" }, "endY": { "type": "number" } }, "required": ["startX", "startY", "endX", "endY"] } }),
        json!({ "name": "simulator_type", "description": "Type printable ASCII text into the focused field.", "inputSchema": { "type": "object", "properties": { "text": { "type": "string" } }, "required": ["text"] } }),
        json!({ "name": "simulator_button", "description": "Press a hardware button: home, lock, volume-up, volume-down.", "inputSchema": { "type": "object", "properties": { "name": { "type": "string" } }, "required": ["name"] } }),
    ]
}

fn workspace_path(app: &AppHandle, session_id: &str, path: &str) -> Result<PathBuf> {
    let state = app.state::<Arc<crate::commands::AppState>>();
    let root = crate::commands::session_path(&state, session_id)?;
    let candidate = if Path::new(path).is_absolute() {
        PathBuf::from(path)
    } else {
        root.join(path)
    };
    let canonical = candidate
        .canonicalize()
        .map_err(|_| Error::invalid_path("app bundle not found"))?;
    if !canonical.starts_with(root.canonicalize().unwrap_or(root))
        || canonical.extension().and_then(|ext| ext.to_str()) != Some("app")
    {
        return Err(Error::invalid_path(
            "Install only .app bundles from this session's workspace.",
        ));
    }
    Ok(canonical)
}

/// One agent tool call; the pane opens (Chat behavior permitting) when a device is attached.
pub async fn execute(
    app: &AppHandle,
    session_id: &str,
    tool: &str,
    args: Value,
) -> std::result::Result<Value, String> {
    let sim = sim().map_err(|error| error.to_string())?;
    let text = |key: &str, limit: usize| {
        args.get(key)
            .and_then(Value::as_str)
            .map(|value| value.chars().take(limit).collect::<String>())
    };
    let number = |key: &str| args.get(key).and_then(Value::as_f64).unwrap_or(f64::NAN);
    let result: Result<Value> = async {
        match tool {
            "simulator_list" => Ok(json!({ "devices": devices(&sim).await?, "attached": sim.attached.lock().clone() })),
            "simulator_boot" => {
                let list = devices(&sim).await?;
                let wanted = text("udid", 40).or_else(|| text("name", 80));
                let device = list
                    .iter()
                    .find(|device| Some(&device.udid) == wanted.as_ref() || Some(&device.name) == wanted.as_ref())
                    .ok_or_else(|| Error::not_found("no simulator with that udid or name; call simulator_list"))?;
                let attached = attach(&sim, &device.udid).await?;
                let _ = app.emit("simulator-open", json!({ "sessionId": session_id }));
                Ok(serde_json::to_value(attached).unwrap_or(Value::Null))
            }
            "simulator_install" => {
                let udid = attached_udid(&sim)?;
                let path = workspace_path(app, session_id, &text("path", 1024).unwrap_or_default())?;
                let output = run(&["simctl", "install", &udid, &path.to_string_lossy()], Duration::from_secs(180)).await?;
                if !output.status.success() {
                    return Err(Error::new("simulator", stderr_of(&output)));
                }
                Ok(json!({ "installed": true }))
            }
            "simulator_launch" => {
                let udid = attached_udid(&sim)?;
                let bundle = text("bundleId", 200).unwrap_or_default();
                if bundle.is_empty() || !bundle.chars().all(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '.' | '-' | '_')) {
                    return Err(Error::new("invalid", "Invalid bundle identifier."));
                }
                let output = run(&["simctl", "launch", &udid, &bundle], Duration::from_secs(60)).await?;
                if !output.status.success() {
                    return Err(Error::new("simulator", stderr_of(&output)));
                }
                Ok(json!({ "launched": bundle }))
            }
            "simulator_screenshot" => {
                attached_udid(&sim)?;
                let shot = call(&sim, "screenshot", json!({}), CALL_TIMEOUT).await?;
                let data = shot.get("base64").and_then(Value::as_str).unwrap_or_default().to_string();
                Ok(json!({ "image": { "mimeType": "image/png", "data": data } }))
            }
            "simulator_describe_ui" => {
                attached_udid(&sim)?;
                let tree = call(&sim, "describe-ui", json!({ "maxDepth": 30 }), CALL_TIMEOUT).await?;
                let encoded = tree.to_string();
                if encoded.len() > 200_000 {
                    return Ok(json!({ "truncated": true, "tree": encoded.chars().take(200_000).collect::<String>() }));
                }
                Ok(tree)
            }
            "simulator_tap" => {
                attached_udid(&sim)?;
                call(&sim, "tap", json!({ "x": unit(number("x"))?, "y": unit(number("y"))? }), CALL_TIMEOUT).await
            }
            "simulator_swipe" => {
                attached_udid(&sim)?;
                call(&sim, "swipe", json!({ "startX": unit(number("startX"))?, "startY": unit(number("startY"))?, "endX": unit(number("endX"))?, "endY": unit(number("endY"))?, "durationMs": 300 }), CALL_TIMEOUT).await
            }
            "simulator_type" => {
                attached_udid(&sim)?;
                let value = text("text", MAX_TEXT).unwrap_or_default();
                let timeout = text_timeout(&value);
                call(&sim, "text", json!({ "text": value }), timeout).await
            }
            "simulator_button" => {
                attached_udid(&sim)?;
                let name = text("name", 20).unwrap_or_default();
                if !matches!(name.as_str(), "home" | "lock" | "volume-up" | "volume-down") {
                    return Err(Error::new("invalid", "Unknown button."));
                }
                press_button(&sim, &name).await
            }
            _ => Err(Error::new("invalid", "unknown simulator tool")),
        }
    }
    .await;
    result.map_err(|error| error.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn udids_coordinates_and_runtimes_are_strict() {
        assert!(valid_udid("7997560A-87D6-47E3-A221-5078A0D241DF"));
        assert!(!valid_udid("7997560A-87D6-47E3-A221-5078A0D241D"));
        assert!(!valid_udid("../../etc/passwd-0000-0000-000000000000"));
        assert!(unit(0.5).is_ok() && unit(1.2).is_err() && unit(f64::NAN).is_err());
        assert_eq!(
            runtime_label("com.apple.CoreSimulator.SimRuntime.iOS-27-0"),
            "iOS 27.0"
        );
    }

    #[test]
    fn tools_are_named_and_sources_are_embedded() {
        assert!(tool_definitions().iter().all(|tool| tool["name"]
            .as_str()
            .is_some_and(|name| name.starts_with("simulator_"))));
        assert_eq!(SOURCES.len(), 11);
        assert!(SWIFT_ORDER
            .iter()
            .all(|name| SOURCES.iter().any(|(source, _)| source == name)));
    }

    #[test]
    fn helper_replies_and_errors_are_bounded() {
        assert_eq!(
            oversized_id(br#"{"jsonrpc":"2.0","id": 42,"result":{"#),
            Some(42)
        );
        assert_eq!(oversized_id(b"no id here"), None);
        assert_eq!(
            helper_stopped("first\nlast line\n\n"),
            "The simulator helper stopped: last line"
        );
        assert_eq!(helper_stopped(""), "The simulator helper stopped.");
        assert!(text_timeout(&"a".repeat(MAX_TEXT)) > Duration::from_secs(90));
    }

    #[tokio::test]
    async fn skipping_an_oversized_line_keeps_the_next_reply() {
        let input: &[u8] = b"xxxxxxxx\n{\"id\":1}\n";
        let mut reader = BufReader::with_capacity(4, input);
        assert!(skip_line(&mut reader).await);
        let mut rest = String::new();
        reader.read_line(&mut rest).await.unwrap();
        assert_eq!(rest, "{\"id\":1}\n");
    }
}
