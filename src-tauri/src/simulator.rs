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

use base64::Engine;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
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
/// Renderer frame batches: at most one event per interval (~30 per second).
const FRAME_BATCH: Duration = Duration::from_millis(33);
/// Encoded bytes a batch may hold before deltas are dropped until a keyframe.
const MAX_BATCH_BYTES: usize = 6 * 1024 * 1024;
const MAX_TEXT: usize = 2_000;
pub const FRAME_EVENT: &str = "simulator-frame";
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

async fn ensure_helper(sim: &Sim) -> Result<()> {
    let mut guard = sim.helper.lock().await;
    if guard
        .as_ref()
        .is_some_and(|helper| !helper.dead.load(Ordering::Acquire))
    {
        return Ok(());
    }
    let binary = build(sim).await?;
    let mut child = tokio::process::Command::new(&binary)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
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
    let pending: Pending = Default::default();
    let dead = Arc::new(AtomicBool::new(false));
    let (reader_pending, reader_dead) = (pending.clone(), dead.clone());
    tauri::async_runtime::spawn(async move {
        let mut lines = BufReader::new(stdout).lines();
        while let Ok(Some(line)) = lines.next_line().await {
            if line.len() > 8 * 1024 * 1024 {
                continue;
            }
            let Ok(message) = serde_json::from_str::<Value>(&line) else {
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
        for (_, sender) in reader_pending.lock().drain() {
            let _ = sender.send(Err("the simulator helper stopped".into()));
        }
    });
    *guard = Some(Helper {
        stdin,
        pending,
        next: AtomicU64::new(1),
        dead,
        _child: child,
    });
    Ok(())
}

async fn call(sim: &Sim, method: &str, params: Value, timeout: Duration) -> Result<Value> {
    ensure_helper(sim).await?;
    let receiver = {
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
        helper.stdin.write_all(&line).await?;
        helper.stdin.flush().await?;
        receiver
    };
    match tokio::time::timeout(timeout, receiver).await {
        Ok(Ok(Ok(value))) => Ok(value),
        Ok(Ok(Err(message))) => Err(Error::new("simulator", message)),
        _ => Err(Error::new(
            "simulator",
            format!("The simulator did not answer '{method}'."),
        )),
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
    if sim.booted.lock().len() >= MAX_BOOTED {
        return Err(Error::new(
            "limit",
            "Sirus Code already started 3 simulators. Shut one down first.",
        ));
    }
    let output = run(&["simctl", "boot", udid], Duration::from_secs(120)).await?;
    if !output.status.success() && !stderr_of(&output).contains("Booted") {
        return Err(Error::new(
            "simulator",
            format!("The simulator did not boot: {}", stderr_of(&output)),
        ));
    }
    sim.booted.lock().insert(udid.to_string());
    let _ = run(&["simctl", "bootstatus", udid], Duration::from_secs(180)).await;
    // `bootstatus` returns before SpringBoard accepts touches; a HID client
    // created earlier silently drops input, so give the home screen a moment.
    tokio::time::sleep(BOOT_SETTLE).await;
    Ok(())
}

async fn stop_stream(sim: &Sim) {
    if let Some(task) = sim.stream.lock().take() {
        task.abort();
    }
    let _ = call(sim, "stream.stop", json!({}), CALL_TIMEOUT).await;
}

/// Listens on the private frame socket and forwards each envelope to the renderer.
fn start_frames(sim: &Arc<Sim>, socket: PathBuf, generation: u64) -> Result<()> {
    let _ = std::fs::remove_file(&socket);
    let listener = tokio::net::UnixListener::bind(&socket)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(&socket, std::fs::Permissions::from_mode(0o600));
    }
    let owner = sim.clone();
    // Frames are read as fast as the helper writes them but reach the renderer in
    // batches, at most one event per FRAME_BATCH, so a busy screen cannot flood
    // the webview's IPC queue. If a batch grows past MAX_BATCH_BYTES the deltas
    // are dropped until the next keyframe, which redraws the whole screen.
    let pending: Arc<parking_lot::Mutex<(Vec<Value>, usize, bool)>> = Default::default();
    let reader_pending = pending.clone();
    let reader_owner = owner.clone();
    let done = Arc::new(AtomicBool::new(false));
    let reader_done = done.clone();
    let reader = tauri::async_runtime::spawn(async move {
        let Ok((mut stream, _)) = listener.accept().await else {
            return;
        };
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
            if reader_owner.generation.load(Ordering::Acquire) != generation {
                break;
            }
            if u16::from_le_bytes([envelope[0], envelope[1]]) != 0x5346 {
                continue;
            }
            let flags = envelope[3];
            let (keyframe, config) = (flags & 1 != 0, flags & 2 != 0);
            let sequence = u32::from_le_bytes([envelope[4], envelope[5], envelope[6], envelope[7]]);
            let timestamp_ms = f64::from_bits(u64::from_le_bytes([
                envelope[8],
                envelope[9],
                envelope[10],
                envelope[11],
                envelope[12],
                envelope[13],
                envelope[14],
                envelope[15],
            ]));
            let id_length = envelope[16] as usize;
            let Some(payload) = envelope.get(17 + id_length..) else {
                continue;
            };
            let udid = String::from_utf8_lossy(&envelope[17..17 + id_length]).to_string();
            let mut slot = reader_pending.lock();
            let (frames, bytes, waiting_key) = &mut *slot;
            if config || keyframe {
                *waiting_key = false;
            } else if *waiting_key {
                continue;
            }
            if !config && !keyframe && *bytes + payload.len() > MAX_BATCH_BYTES {
                // The renderer is behind: drop deltas until a keyframe resets the picture.
                *waiting_key = true;
                continue;
            }
            *bytes += payload.len();
            frames.push(json!({
                "udid": udid,
                "sequence": sequence,
                "timestampMs": timestamp_ms,
                "keyframe": keyframe,
                "config": config,
                "data": base64::engine::general_purpose::STANDARD.encode(payload),
            }));
        }
        reader_done.store(true, Ordering::Release);
    });
    let task = tauri::async_runtime::spawn(async move {
        let mut tick = tokio::time::interval(FRAME_BATCH);
        tick.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
        loop {
            tick.tick().await;
            if owner.generation.load(Ordering::Acquire) != generation
                || done.load(Ordering::Acquire)
            {
                break;
            }
            let frames = {
                let mut slot = pending.lock();
                slot.1 = 0;
                std::mem::take(&mut slot.0)
            };
            if !frames.is_empty() {
                let _ = owner.app.emit(FRAME_EVENT, json!({ "frames": frames }));
            }
        }
        reader.abort();
    });
    *sim.stream.lock() = Some(task);
    Ok(())
}

/// Opens a fresh frame socket and starts the helper stream (codec parameters and a keyframe first).
async fn start_stream(sim: &Arc<Sim>) -> Result<Value> {
    let generation = sim.generation.fetch_add(1, Ordering::AcqRel) + 1;
    std::fs::create_dir_all(&sim.dir)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(&sim.dir, std::fs::Permissions::from_mode(0o700));
    }
    let socket = sim.dir.join("frames.sock");
    start_frames(sim, socket.clone(), generation)?;
    call(
        sim,
        "stream.start",
        json!({ "socketPath": socket.to_string_lossy(), "keyframeIntervalSeconds": 2.0 }),
        CALL_TIMEOUT,
    )
    .await
}

/// A renderer that subscribed late asks for a fresh keyframe by restarting the stream.
async fn restart_stream(sim: &Arc<Sim>) -> Result<()> {
    sim.generation.fetch_add(1, Ordering::AcqRel);
    stop_stream(sim).await;
    start_stream(sim).await.map(|_| ())
}

async fn attach(sim: &Arc<Sim>, udid: &str) -> Result<Attached> {
    if !valid_udid(udid) {
        return Err(Error::new("invalid", "Invalid simulator."));
    }
    let previous = sim.attached.lock().as_ref().map(|item| item.udid.clone());
    if previous.as_deref() == Some(udid) {
        if let Some(current) = sim.attached.lock().clone() {
            return Ok(current);
        }
    }
    detach(sim).await;
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
    let started = start_stream(sim).await?;
    let list = devices(sim).await.unwrap_or_default();
    let device = list.iter().find(|device| device.udid == udid);
    let attached = Attached {
        udid: udid.to_string(),
        name: device
            .map(|device| device.name.clone())
            .unwrap_or_else(|| "Simulator".into()),
        family: device
            .map(|device| device.family.clone())
            .unwrap_or_else(|| "phone".into()),
        pixel_width: started
            .get("pixelWidth")
            .and_then(Value::as_u64)
            .unwrap_or(1206) as u32,
        pixel_height: started
            .get("pixelHeight")
            .and_then(Value::as_u64)
            .unwrap_or(2622) as u32,
        input: geometry
            .get("capabilities")
            .and_then(|caps| caps.get("input"))
            .map(|input| input.as_bool().unwrap_or(true))
            .unwrap_or(true),
    };
    *sim.attached.lock() = Some(attached.clone());
    emit_state(sim);
    Ok(attached)
}

async fn detach(sim: &Arc<Sim>) {
    let previous = sim.attached.lock().take();
    sim.generation.fetch_add(1, Ordering::AcqRel);
    stop_stream(sim).await;
    if let Some(previous) = previous {
        emit_state(sim);
        // A device Sirus Code booted shuts down after a while unless it is attached again.
        if sim.booted.lock().contains(&previous.udid) {
            let owner = sim.clone();
            tauri::async_runtime::spawn(async move {
                tokio::time::sleep(IDLE_SHUTDOWN).await;
                let again = owner
                    .attached
                    .lock()
                    .as_ref()
                    .is_some_and(|item| item.udid == previous.udid);
                if !again {
                    shutdown_owned(&owner, &previous.udid).await;
                }
            });
        }
    }
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
    let owned: Vec<String> = sim.booted.lock().drain().collect();
    for udid in owned {
        let _ = std::process::Command::new(XCRUN)
            .args(["simctl", "shutdown", &udid])
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status();
    }
}

fn attached_udid(sim: &Sim) -> Result<String> {
    sim.attached
        .lock()
        .as_ref()
        .map(|item| item.udid.clone())
        .ok_or_else(|| Error::new("not_attached", "Choose a simulator first."))
}

/// Devices drawn with a physical Home button; every other iPhone/iPad goes home
/// by swiping up from the bottom edge, which the HID Home usage does not do.
fn has_home_button(name: &str) -> bool {
    name.contains("iPhone SE") || name.contains("iPhone 8") || name.contains("(9th generation)")
}

async fn press_button(sim: &Sim, name: &str) -> Result<Value> {
    let device = sim.attached.lock().as_ref().map(|item| item.name.clone());
    match device {
        Some(device) if name == "home" && !has_home_button(&device) => call(
            sim,
            "swipe",
            json!({ "startX": 0.5, "startY": 0.995, "endX": 0.5, "endY": 0.6, "durationMs": 120 }),
            CALL_TIMEOUT,
        )
        .await,
        _ => call(sim, "button", json!({ "name": name }), CALL_TIMEOUT).await,
    }
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

#[derive(Debug, Deserialize)]
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
    /// Restarts the stream so the renderer gets codec parameters and a keyframe.
    Resync {},
    Record {
        start: bool,
    },
    Shutdown {
        udid: String,
        confirm: bool,
    },
}

#[tauri::command]
pub async fn simulator_action(app: AppHandle, action: Action) -> Result<Value> {
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
            call(&sim, "text", json!({ "text": text }), CALL_TIMEOUT).await
        }
        Action::Button { name } => {
            if !matches!(name.as_str(), "home" | "lock" | "side" | "siri" | "volume-up" | "volume-down") {
                return Err(Error::new("invalid", "Unknown button."));
            }
            press_button(&sim, &name).await
        }
        Action::Resync {} => {
            attached_udid(&sim)?;
            restart_stream(&sim).await?;
            Ok(json!({ "resynced": true }))
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
            if sim.attached.lock().as_ref().is_some_and(|item| item.udid == udid) {
                detach(&sim).await;
            }
            sim.booted.lock().remove(&udid);
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
        json!({ "name": "simulator_describe_ui", "description": "Accessibility tree of the frontmost app (roles, labels, frames in points).", "inputSchema": { "type": "object", "properties": {} } }),
        json!({ "name": "simulator_tap", "description": "Tap at normalized screen coordinates (0..1).", "inputSchema": point }),
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
                call(&sim, "text", json!({ "text": value }), CALL_TIMEOUT).await
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
        assert!(has_home_button("iPhone SE (3rd generation)"));
        assert!(has_home_button("iPad (9th generation)"));
        assert!(!has_home_button("iPhone 17 Pro"));
        assert!(!has_home_button("iPad Pro 13-inch (M5)"));
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
}
