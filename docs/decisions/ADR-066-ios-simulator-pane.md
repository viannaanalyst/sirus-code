# ADR-066: iOS Simulator pane

**Status:** Accepted

## Context

Synara Beta shows a live, touchable iOS Simulator in its right dock, and agents can drive it to test the apps they build. The owner uses Xcode and asked for the same pane, with the same device drawing, in Sirus Code.

## Decision

**Native helper.** `src-tauri/native/simulator-helper` holds Synara's device helper (MIT, attribution in its `LICENSE`), renamed for Sirus Code.

- The helper drives a booted simulator headless through CoreSimulator/SimulatorKit, which it `dlopen`s from the selected Xcode. It needs no Screen Recording or Accessibility permission.
- `simulator.rs` embeds the sources and compiles them on first use with the person's own `xcrun clang`/`swiftc`, into app data keyed by Xcode build and source hash.
- The helper speaks newline-delimited JSON-RPC on stdio: list, attach, stream, tap, swipe, key, text, button, screenshot and describe-ui.
- It writes H.264 (Annex B) frames to a private 0600 Unix socket that `simulator.rs` listens on. Rust batches frames into `simulator-frame` events at most every 33 ms and drops queued deltas above 6 MiB until a codec config or keyframe arrives. The renderer gates frames by device and sequence, requires codec config plus a keyframe, and requests a stream restart after a late subscription, lost delta or decoder error. This bounds IPC traffic and recovers the WebCodecs decoder without waiting for the next periodic keyframe. Frames arrive only when the screen changes.
- The helper's capture timestamp is preserved through IPC as the WebCodecs timestamp. The renderer flushes the initial keyframe so WebKit presents a still frame even when the screen is idle, then restarts the stream once because WebCodecs requires a fresh keyframe after a flush.

**Pane.** The dock gains a Simulator pane:

- a picker listing the available iOS simulators (name, runtime, booted state);
- the drawn device: an SVG squircle chassis with clickable side buttons, adapted from Synara's `DeviceFrame`;
- a control rail: Home, rotate view, save screenshot, record (saved through the native save dialog), shut down (confirmed) and disconnect.

Input:

- A click becomes a tap and a drag becomes a swipe, in normalized coordinates.
- Keys go through as HID usages or text.

**Agent tools.** The existing per-session MCP bridge (`browser_mcp.rs`) also serves `simulator_list`, `simulator_boot`, `simulator_install`, `simulator_launch`, `simulator_screenshot`, `simulator_describe_ui`, `simulator_tap`, `simulator_swipe`, `simulator_type` and `simulator_button`.

- `simulator_install` accepts only an `.app` bundle inside the session workspace.
- Bundle IDs and UDIDs are validated.
- Coordinates must be normalized 0..1.
- When an agent boots a simulator, `simulator-open` opens the pane if Chat behavior's `autoOpenSimulator` is on (the default).

**Lifecycle.**

- There is one attached device app-wide.
- Sirus Code boots at most 3 simulators. One it booted shuts down 10 minutes after it is detached, when the person switches to another device, and on quit. Simulators the person booted are never shut down automatically.
- After a fresh boot, attach waits briefly: `bootstatus` returns before SpringBoard accepts touches.
- Every command is a fixed argv: `/usr/bin/xcrun simctl …` or the helper.

## Consequences

- **Positive:** the person and the agent can see and drive an iOS app without leaving Sirus Code, and without granting extra macOS permissions.
- **Negative:**
  - The helper relies on private Xcode frameworks, so a new Xcode can break it. Rebuilding per Xcode build limits this, and failures are reported in the pane.
  - The first open spends a few seconds compiling.
  - The simulated device cannot really rotate; rotate only turns the view.
  - Text input covers printable ASCII.
  - Apps inside a simulator crash as macOS processes, so their crash dialogs (for example "MobileCal quit unexpectedly" on a first boot) come from macOS, not Sirus Code.

## Alternatives considered

- **Mirroring the Simulator.app window with ScreenCaptureKit.** Rejected: it needs Screen Recording, shows window chrome and cannot inject touches reliably.
- **A prebuilt helper binary.** Rejected: the private API moves with each Xcode release, so the helper must be built against the installed toolchain.
