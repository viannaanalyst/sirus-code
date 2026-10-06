import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { client } from "@/client";
import type { SimulatorAttached, SimulatorDevice, SimulatorFrame } from "@/client/types";
import { CameraShot, ChevronDown, HomeButton, PowerIcon, RecordDot, RotateView, Unlink, X } from "@/components/icons/phosphor";
import { useTranslation } from "@/i18n/use-translation";
import { cn } from "@/lib/cn";
import { formatUnknownError } from "@/lib/format-error";
import { ConfirmDialog } from "@/primitives/ConfirmDialog";
import { Dropdown, DropdownContent, DropdownItem, DropdownTrigger } from "@/primitives/Dropdown";
import { useAppStore } from "@/store/app-store";
import { DeviceScreen } from "./DeviceFrame";
import { createFrameGateState, stepFrameGate } from "./frame-gate";
import "@/styles/simulator.css";

/** USB HID usages for keys the pane forwards (printable text goes through `text`). */
const KEYS: Record<string, number> = { Enter: 0x28, Escape: 0x29, Backspace: 0x2a, Tab: 0x2b, ArrowRight: 0x4f, ArrowLeft: 0x50, ArrowDown: 0x51, ArrowUp: 0x52, Delete: 0x4c };

function codecFor(payload: Uint8Array): string | null {
  for (let i = 0; i + 4 < payload.length; i += 1) {
    const long = payload[i] === 0 && payload[i + 1] === 0 && payload[i + 2] === 0 && payload[i + 3] === 1;
    const short = payload[i] === 0 && payload[i + 1] === 0 && payload[i + 2] === 1;
    if (!long && !short) continue;
    const nal = i + (long ? 4 : 3);
    if ((payload[nal] & 0x1f) !== 7) continue;
    const hex = (value: number) => value.toString(16).padStart(2, "0");
    return `avc1.${hex(payload[nal + 1])}${hex(payload[nal + 2])}${hex(payload[nal + 3])}`;
  }
  return null;
}

function sameBytes(a: Uint8Array | null, b: Uint8Array) {
  if (!a || a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) if (a[i] !== b[i]) return false;
  return true;
}

/** How long a keyframe request may stay unanswered before it is sent again. */
const KEYFRAME_RETRY_MS = 600;
/**
 * Decodes the helper's Annex-B H.264 frames into the canvas with WebCodecs.
 * Frames flow only while this hook watches the device. Rust rewrites the codec
 * parameters to declare no frame reordering, so WebKit outputs each frame as it
 * is decoded; the helper re-sends the screen shortly after it stops changing.
 */
function useSimulatorVideo(canvas: React.RefObject<HTMLCanvasElement | null>, udid: string | null) {
  const [live, setLive] = useState(false);
  const [videoError, setVideoError] = useState<string | null>(null);
  useEffect(() => {
    if (!udid) { setLive(false); setVideoError(null); return; }
    if (typeof VideoDecoder !== "function" || typeof EncodedVideoChunk !== "function") {
      setLive(false);
      setVideoError("This WebView does not support H.264 WebCodecs.");
      return;
    }
    let decoder: VideoDecoder | null = null;
    let config: Uint8Array | null = null;
    let parameters: Uint8Array | null = null;
    let disposed = false;
    let gate = createFrameGateState();
    // One request at a time; a keyframe (or the retry window) clears it.
    let requestedAt = -Infinity;
    const requestKeyframe = () => {
      if (disposed || performance.now() - requestedAt < KEYFRAME_RETRY_MS) return;
      requestedAt = performance.now();
      void client.simulatorAction({ type: "resync" }).catch(() => undefined);
    };
    const teardown = () => {
      config = null;
      parameters = null;
      if (!decoder) return;
      const current = decoder;
      decoder = null;
      try { if (current.state !== "closed") current.close(); } catch { /* already errored */ }
    };
    const fail = (reason: unknown) => {
      if (disposed) return;
      teardown();
      gate = createFrameGateState();
      setLive(false);
      setVideoError(reason instanceof Error ? reason.message : "The simulator video decoder failed.");
      requestedAt = -Infinity;
      requestKeyframe();
    };
    const paint = (frame: VideoFrame) => {
      try {
        const target = canvas.current;
        if (!target || disposed) return;
        if (target.width !== frame.displayWidth || target.height !== frame.displayHeight) { target.width = frame.displayWidth; target.height = frame.displayHeight; }
        target.getContext("2d")?.drawImage(frame, 0, 0);
        setLive(true);
        setVideoError(null);
      } finally { frame.close(); }
    };
    setLive(false);
    setVideoError(null);
    const onFrame = (frame: SimulatorFrame) => {
      if (disposed) return;
      const awaiting = gate.phase === "awaiting-keyframe";
      const step = stepFrameGate(gate, frame, udid);
      gate = step.state;
      if (frame.keyframe) requestedAt = -Infinity;
      if (step.requestKeyframe || (awaiting && step.action.kind === "drop" && !frame.config)) requestKeyframe();
      if (step.action.kind === "ignore" || step.action.kind === "drop") return;
      const payload = frame.data;
      if (step.action.kind === "configure") {
        parameters = payload;
        // The helper repeats unchanged parameters before every keyframe; keep the decoder.
        if (decoder && decoder.state === "configured" && sameBytes(config, payload)) return;
        const codec = codecFor(payload);
        if (!codec) { fail(new Error("The simulator stream sent invalid H.264 parameters.")); return; }
        teardown();
        parameters = payload;
        decoder = new VideoDecoder({ output: paint, error: fail });
        try { decoder.configure({ codec, optimizeForLatency: true }); }
        catch (reason) { fail(reason); return; }
        config = payload;
        return;
      }
      if (!decoder || decoder.state !== "configured") return;
      const keyframe = step.action.keyframe;
      if (!keyframe && decoder.decodeQueueSize > 8) {
        gate = { phase: "awaiting-keyframe", lastSequence: frame.sequence };
        requestKeyframe();
        return;
      }
      let data = payload;
      if (keyframe && parameters) {
        data = new Uint8Array(parameters.length + payload.length);
        data.set(parameters);
        data.set(payload, parameters.length);
        parameters = null;
      }
      try {
        decoder.decode(new EncodedVideoChunk({ type: keyframe ? "key" : "delta", timestamp: Math.round(frame.timestampMs * 1000), data }));
      }
      catch (reason) { fail(reason); }
    };
    // Subscribing starts the stream (parameters and a keyframe first) or, when it
    // already runs for another pane, asks for a keyframe of the current screen.
    const watching = client.watchSimulator(onFrame);
    void watching.then(() => { if (!disposed) requestKeyframe(); })
      .catch((reason) => { if (!disposed) setVideoError(formatUnknownError(reason)); });
    return () => {
      disposed = true;
      setLive(false);
      teardown();
      void watching.then((stop) => stop()).catch(() => undefined);
    };
  }, [canvas, udid]);
  return { live, videoError };
}

/** iOS Simulator pane (ADR-066): a live, touchable device the agent can also drive. */
export function SimulatorPane({ paneId }: { paneId: string }) {
  const t = useTranslation();
  const [available, setAvailable] = useState<boolean | null>(null);
  const [devices, setDevices] = useState<SimulatorDevice[] | null>(null);
  const [attached, setAttached] = useState<SimulatorAttached | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [recording, setRecording] = useState(false);
  const [landscape, setLandscape] = useState(false);
  const [confirmShutdown, setConfirmShutdown] = useState(false);
  const canvas = useRef<HTMLCanvasElement>(null);
  const { live, videoError } = useSimulatorVideo(canvas, attached?.udid ?? null);
  const fail = (reason: unknown) => useAppStore.setState({ error: formatUnknownError(reason) });

  const refresh = async () => {
    try {
      const listed = await client.simulatorAction<{ devices: SimulatorDevice[]; attached: SimulatorAttached | null; recording: boolean }>({ type: "list" });
      setDevices(listed.devices);
      setAttached(listed.attached);
      setRecording(listed.recording);
    } catch (reason) { setDevices([]); fail(reason); }
  };

  useEffect(() => {
    let alive = true;
    void client.simulatorAction<{ available: boolean }>({ type: "probe" }).then((probe) => {
      if (!alive) return;
      setAvailable(probe.available);
      if (probe.available) { setBusy("preparing"); void refresh().finally(() => alive && setBusy(null)); }
    }).catch(() => alive && setAvailable(false));
    const stop = client.onSimulatorState((state) => { if (alive) setAttached(state.attached); });
    return () => { alive = false; void stop.then((unlisten) => unlisten()); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const choose = async (device: SimulatorDevice) => {
    setBusy(device.booted ? "attaching" : "booting");
    try { setAttached(await client.simulatorAction<SimulatorAttached>({ type: "attach", udid: device.udid })); await refresh(); }
    catch (reason) { fail(reason); }
    finally { setBusy(null); }
  };
  const act = (action: Parameters<typeof client.simulatorAction>[0]) => void client.simulatorAction(action).catch(fail);

  // Input is sent in order: each call waits for the previous one, so a fast
  // drag or typing burst reaches the device as it happened.
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const send = (action: Parameters<typeof client.simulatorAction>[0]) => {
    queue.current = queue.current.then(() => client.simulatorAction(action)).catch(fail);
  };

  // Pointer → live touch down/move/up in normalized screen coordinates. Offsets
  // are measured before CSS transforms, so this also holds when rotated.
  const touch = useRef<{ moved: { x: number; y: number } | null; frame: number } | null>(null);
  const point = (event: PointerEvent<HTMLCanvasElement>) => {
    const target = event.currentTarget;
    const clamp = (value: number) => Math.min(1, Math.max(0, value));
    return { x: clamp(event.nativeEvent.offsetX / Math.max(1, target.clientWidth)), y: clamp(event.nativeEvent.offsetY / Math.max(1, target.clientHeight)) };
  };
  const onPointerDown = (event: PointerEvent<HTMLCanvasElement>) => {
    if (!attached?.input || event.button !== 0 || touch.current) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    event.currentTarget.closest<HTMLElement>(".simulator-body")?.focus();
    touch.current = { moved: null, frame: 0 };
    send({ type: "touch", phase: "down", ...point(event) });
  };
  const onPointerMove = (event: PointerEvent<HTMLCanvasElement>) => {
    const current = touch.current;
    if (!current) return;
    current.moved = point(event);
    // At most one move per animation frame.
    if (current.frame) return;
    current.frame = requestAnimationFrame(() => {
      current.frame = 0;
      if (touch.current !== current || !current.moved) return;
      send({ type: "touch", phase: "move", ...current.moved });
      current.moved = null;
    });
  };
  const onPointerUp = (event: PointerEvent<HTMLCanvasElement>) => {
    const current = touch.current;
    if (!current) return;
    touch.current = null;
    cancelAnimationFrame(current.frame);
    send({ type: "touch", phase: "up", ...point(event) });
  };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!attached?.input || event.metaKey || event.ctrlKey || event.nativeEvent.isComposing) return;
    if (KEYS[event.key]) { event.preventDefault(); send({ type: "key", usage: KEYS[event.key] }); return; }
    if (event.key.length === 1) { event.preventDefault(); send({ type: "text", text: event.key }); }
  };

  const label = attached?.name ?? t("simulator.choose");
  const message = videoError ?? (available === false ? t("simulator.needsXcode")
    : busy === "preparing" ? t("simulator.preparing")
    : busy === "booting" ? t("simulator.booting")
    : busy === "attaching" ? t("simulator.connecting")
    : !attached ? t("simulator.chooseHint")
    : !live ? t("simulator.waiting") : null);

  return <div className="simulator-pane">
    <div className="simulator-header">
      <Dropdown>
        <DropdownTrigger asChild>
          <button type="button" className="simulator-picker ui-control" disabled={!devices?.length || !!busy}>{label}<ChevronDown size={13} aria-hidden="true" /></button>
        </DropdownTrigger>
        <DropdownContent align="start" side="bottom" className="simulator-menu">
          {(devices ?? []).map((device) => <DropdownItem key={device.udid} onSelect={() => void choose(device)}>
            <span className="simulator-menu-row"><span>{device.name}</span><span className="text-text-muted">{device.runtime} · {t(device.booted ? "simulator.on" : "simulator.off")}</span></span>
          </DropdownItem>)}
        </DropdownContent>
      </Dropdown>
      <button type="button" className="simulator-icon" aria-label={t("Close panel")} title={t("Close panel")} onClick={() => { if (attached) act({ type: "detach" }); useAppStore.getState().closeDockPane(paneId); }}><X size={14} /></button>
    </div>
    <div className="simulator-body" tabIndex={0} onKeyDown={onKeyDown} aria-label={t("simulator.title")}>
      <DeviceScreen kind={attached?.family === "tablet" ? "iPad" : "iPhone"} pixelWidth={attached?.pixelWidth} pixelHeight={attached?.pixelHeight} landscape={landscape} label={t}
        onPressButton={attached?.input ? (button) => act({ type: "button", name: button }) : undefined}>
        <canvas ref={canvas} className={cn("simulator-canvas", !live && "opacity-0")} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp} onLostPointerCapture={onPointerUp} />
        {message ? <p className="simulator-message ui-caption">{message}</p> : null}
      </DeviceScreen>
    </div>
    <div className="simulator-rail" role="toolbar" aria-label={t("simulator.controls")}>
      <button type="button" title={t("simulator.home")} aria-label={t("simulator.home")} disabled={!attached?.input} onClick={() => act({ type: "button", name: "home" })}><HomeButton size={15} /></button>
      <button type="button" title={t("simulator.rotate")} aria-label={t("simulator.rotate")} disabled={!attached} aria-pressed={landscape} onClick={() => setLandscape((value) => !value)}><RotateView size={15} /></button>
      <span className="simulator-rail-gap" />
      <button type="button" title={t("simulator.screenshot")} aria-label={t("simulator.screenshot")} disabled={!attached} onClick={() => act({ type: "screenshot" })}><CameraShot size={15} /></button>
      <button type="button" title={t(recording ? "simulator.stopRecording" : "simulator.record")} aria-label={t(recording ? "simulator.stopRecording" : "simulator.record")} disabled={!attached} data-recording={recording || undefined}
        onClick={() => { const next = !recording; setRecording(next); void client.simulatorAction({ type: "record", start: next }).catch((reason) => { setRecording(!next); fail(reason); }); }}><RecordDot size={15} /></button>
      <span className="simulator-rail-gap" />
      <button type="button" title={t("simulator.shutdown")} aria-label={t("simulator.shutdown")} disabled={!attached} onClick={() => setConfirmShutdown(true)}><PowerIcon size={15} /></button>
      <button type="button" title={t("simulator.detach")} aria-label={t("simulator.detach")} disabled={!attached} onClick={() => { act({ type: "detach" }); setAttached(null); }}><Unlink size={15} /></button>
    </div>
    <ConfirmDialog open={confirmShutdown} onOpenChange={setConfirmShutdown} title={t("simulator.shutdownTitle")} description={t("simulator.shutdownBody")} confirmLabel={t("simulator.shutdown")} cancelLabel={t("common.cancel")}
      onConfirm={async () => { if (!attached) return; try { await client.simulatorAction({ type: "shutdown", udid: attached.udid, confirm: true }); setAttached(null); await refresh(); } catch (reason) { fail(reason); } }} />
  </div>;
}
