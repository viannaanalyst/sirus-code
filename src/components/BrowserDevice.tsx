import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent, type ReactNode, type RefObject } from "react";
import { DeviceRotate, X } from "@/components/icons";
import { client } from "@/client";
import { useTranslation } from "@/i18n/use-translation";
import "@/styles/browser.css";
import { DEVICE_PRESETS, fitDevice, presetViewport, resized, rotated, type DeviceSize, type DeviceViewport } from "@/lib/browser-device";

/** Space kept around a device frame for its resize rails. */
const GUTTER = 12;
const RAIL = 10;

/**
 * Device toolbar (ADR-111): a device preset, the CSS width and height, rotate and
 * close. The page lays out at that size; the pane scales it down when it does not fit.
 */
export function BrowserDeviceToolbar({ device, onChange }: { device: DeviceSize; onChange: (next: DeviceViewport) => void }) {
  const t = useTranslation();
  const [width, setWidth] = useState(String(device.width));
  const [height, setHeight] = useState(String(device.height));
  useEffect(() => { setWidth(String(device.width)); setHeight(String(device.height)); }, [device.width, device.height]);
  const commit = () => {
    const next = resized(Number(width), Number(height));
    if ((next.width !== device.width || next.height !== device.height)) onChange(next);
    else { setWidth(String(device.width)); setHeight(String(device.height)); }
  };
  const field = "h-6 w-[58px] rounded-[6px] border border-border-default bg-background-1 px-1.5 text-center ui-caption tabular-nums text-text-primary outline-none focus-visible:border-text-muted";
  const control = "inline-flex size-6 shrink-0 items-center justify-center rounded-[7px] text-text-muted transition-colors duration-[var(--motion-fast)] hover:bg-background-3/80 hover:text-text-primary";
  return <div role="toolbar" aria-label={t("browser.deviceToolbar")} className="flex min-w-0 items-center gap-1.5 px-2 pt-1.5">
    <select value={device.preset ?? ""} aria-label={t("browser.devicePreset")} onChange={(event) => { if (event.target.value) onChange(presetViewport(event.target.value)); }}
      className="h-6 min-w-0 max-w-[180px] flex-1 truncate rounded-[6px] border border-border-default bg-background-1 px-1.5 ui-caption text-text-primary outline-none focus-visible:border-text-muted">
      {device.preset ? null : <option value="">{t("browser.customSize")}</option>}
      {DEVICE_PRESETS.map((preset) => <option key={preset.id} value={preset.id}>{preset.label} · {preset.width} × {preset.height}</option>)}
    </select>
    <form className="flex items-center gap-1" onSubmit={(event) => { event.preventDefault(); commit(); }}>
      <input inputMode="numeric" aria-label={t("browser.width")} value={width} onChange={(event) => setWidth(event.target.value.replace(/\D/g, "").slice(0, 4))} onBlur={commit} className={field} />
      <span aria-hidden="true" className="ui-caption text-text-muted">×</span>
      <input inputMode="numeric" aria-label={t("browser.height")} value={height} onChange={(event) => setHeight(event.target.value.replace(/\D/g, "").slice(0, 4))} onBlur={commit} className={field} />
      <button type="submit" hidden />
    </form>
    <button type="button" title={t("browser.rotate")} aria-label={t("browser.rotate")} onClick={() => onChange(rotated(device))} className={control}><DeviceRotate size={13} aria-hidden="true" /></button>
    <span className="flex-1" />
    <button type="button" title={t("browser.closeDevice")} aria-label={t("browser.closeDevice")} onClick={() => onChange({ kind: "fill" })} className={control}><X size={12} aria-hidden="true" /></button>
  </div>;
}

type Edge = "left" | "right" | "bottom" | "bottomLeft" | "bottomRight";
const EDGES: Edge[] = ["left", "right", "bottom", "bottomLeft", "bottomRight"];

/**
 * The pane's page area: in device mode a centred frame the native view covers, with rails to
 * resize it from the sides and bottom (arrow keys work too), and the zoom that keeps its CSS size.
 */
export function BrowserViewport({ sessionId, device, onDevice, frame, still = null, children }: {
  sessionId: string; device: DeviceViewport; onDevice: (next: DeviceViewport) => void; frame: RefObject<HTMLDivElement | null>;
  /** The page as it last looked, shown while a menu or dialog hides the native view. */
  still?: string | null; children?: ReactNode;
}) {
  const t = useTranslation();
  const container = useRef<HTMLDivElement>(null);
  const [space, setSpace] = useState({ width: 0, height: 0 });
  useLayoutEffect(() => {
    const node = container.current;
    if (!node) return;
    const measure = () => setSpace({ width: node.clientWidth, height: node.clientHeight });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  const fit = device.kind === "device" && space.width > 0
    ? fitDevice({ width: Math.max(1, space.width - GUTTER * 2), height: Math.max(1, space.height - GUTTER * 2) }, device)
    : null;
  const zoom = fit?.scale ?? 1;
  // The page keeps the device's CSS width inside the smaller frame.
  useEffect(() => {
    const timer = window.setTimeout(() => void client.browserSetZoom(sessionId, zoom).catch(() => undefined), 60);
    return () => window.clearTimeout(timer);
  }, [sessionId, zoom]);
  useEffect(() => () => { void client.browserSetZoom(sessionId, 1).catch(() => undefined); }, [sessionId]);

  const left = fit ? Math.floor((space.width - fit.width) / 2) : 0;
  const drag = (edge: Edge) => (event: PointerEvent<HTMLDivElement>) => {
    if (device.kind !== "device" || !fit) return;
    event.preventDefault();
    const target = event.currentTarget;
    target.setPointerCapture(event.pointerId);
    const start = { x: event.clientX, y: event.clientY, width: device.width, height: device.height, scale: fit.scale };
    const move = (next: globalThis.PointerEvent) => {
      const dx = (next.clientX - start.x) / start.scale;
      const dy = (next.clientY - start.y) / start.scale;
      // The frame stays centred, so a side drag grows both sides.
      const width = edge === "bottom" ? start.width : start.width + (edge === "left" || edge === "bottomLeft" ? -dx : dx) * 2;
      const height = edge === "left" || edge === "right" ? start.height : start.height + dy;
      onDevice(resized(width, height));
    };
    const end = () => {
      target.removeEventListener("pointermove", move);
      target.removeEventListener("pointerup", end);
      target.removeEventListener("pointercancel", end);
    };
    target.addEventListener("pointermove", move);
    target.addEventListener("pointerup", end);
    target.addEventListener("pointercancel", end);
  };
  const nudge = (edge: Edge) => (event: KeyboardEvent<HTMLDivElement>) => {
    if (device.kind !== "device") return;
    const step = event.shiftKey ? 50 : 10;
    const horizontal = edge !== "bottom" && (event.key === "ArrowLeft" || event.key === "ArrowRight");
    const vertical = edge !== "left" && edge !== "right" && (event.key === "ArrowUp" || event.key === "ArrowDown");
    if (!horizontal && !vertical) return;
    event.preventDefault();
    const grow = event.key === "ArrowRight" || event.key === "ArrowDown" ? step : -step;
    onDevice(resized(device.width + (horizontal ? (edge === "left" || edge === "bottomLeft" ? -grow : grow) : 0), device.height + (vertical ? grow : 0)));
  };
  const rail = (edge: Edge): CSSProperties | null => {
    if (!fit) return null;
    const top = GUTTER, bottom = GUTTER + fit.height;
    switch (edge) {
      case "left": return { left: left - RAIL, top, width: RAIL, height: fit.height, cursor: "ew-resize" };
      case "right": return { left: left + fit.width, top, width: RAIL, height: fit.height, cursor: "ew-resize" };
      case "bottom": return { left, top: bottom, width: fit.width, height: RAIL, cursor: "ns-resize" };
      case "bottomLeft": return { left: left - RAIL, top: bottom, width: RAIL, height: RAIL, cursor: "nesw-resize" };
      case "bottomRight": return { left: left + fit.width, top: bottom, width: RAIL, height: RAIL, cursor: "nwse-resize" };
    }
  };
  return <div ref={container} className="relative mt-1 min-h-0 flex-1 overflow-hidden" data-device={fit ? "" : undefined}>
    <div ref={frame} className="absolute" style={fit ? { left, top: GUTTER, width: fit.width, height: fit.height } : { inset: 0 }}>
      {still ? <img src={still} alt="" aria-hidden="true" draggable={false} className="browser-still" /> : null}
    </div>
    {fit ? EDGES.map((edge) => <div key={edge} role="separator" tabIndex={0} aria-label={t(`browser.resize.${edge}`)} aria-orientation={edge === "bottom" ? "horizontal" : "vertical"}
      className="browser-rail" data-edge={edge} style={rail(edge) ?? undefined} onPointerDown={drag(edge)} onKeyDown={nudge(edge)} />) : null}
    {children ? <div className="absolute inset-0">{children}</div> : null}
  </div>;
}
