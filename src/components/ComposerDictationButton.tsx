import { useEffect, useId, useRef, useState, type CSSProperties } from "react";
import { Mic, Square, X } from "lucide-react";
import { client } from "@/client";
import { ComposerMetalSurface } from "@/components/ComposerMetalSurface";
import { useTranslation } from "@/i18n/use-translation";
import { formatUnknownError } from "@/lib/format-error";
import { useMotionPreferences } from "@/lib/use-motion-preferences";
import { Tooltip } from "@/primitives/Tooltip";
import { useAppStore } from "@/store/app-store";

function dictationMessage(error: unknown): string {
  const message = formatUnknownError(error);
  return [
    "Microphone permission was denied.", "Speech recognition permission was denied.",
    "Microphone permission timed out.", "Speech recognition permission timed out.",
    "Speech recognition is unavailable for this language.", "Speech recognition is unavailable right now.",
    "Dictation failed.",
  ].find((entry) => message.includes(entry)) ?? "Dictation could not start.";
}

/** Native dictation with the approved orbital recording strip. No audio-level probe. */
export function ComposerDictationButton({ onText, disabled, onActiveChange }: {
  onText: (text: string) => void;
  disabled?: boolean;
  onActiveChange: (active: boolean) => void;
}) {
  const t = useTranslation();
  const locale = useAppStore((state) => state.settings.locale);
  const reduced = useMotionPreferences();
  const gradient = useId();
  const [supported, setSupported] = useState(false);
  const [listening, setListening] = useState(false);
  const [busy, setBusy] = useState(false);
  const [interim, setInterim] = useState("");
  const [seconds, setSeconds] = useState(0);
  const [visible, setVisible] = useState(false);
  const [documentVisible, setDocumentVisible] = useState(!document.hidden);
  const root = useRef<HTMLSpanElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const stopped = useRef(true);
  const mounted = useRef(false);
  const pending = useRef(0);
  const started = useRef(0);

  useEffect(() => {
    mounted.current = true;
    void client.dictationStatus().then((status) => {
      if (mounted.current) setSupported(status !== "unsupported");
    }).catch(() => undefined);
    return () => {
      mounted.current = false;
      stopped.current = true;
      onActiveChange(false);
      void client.stopDictation(true).catch(() => undefined);
    };
  }, [onActiveChange]);

  useEffect(() => {
    const node = root.current;
    if (!node) return;
    const observer = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting));
    observer.observe(node);
    const update = () => setDocumentVisible(!document.hidden);
    document.addEventListener("visibilitychange", update);
    return () => { observer.disconnect(); document.removeEventListener("visibilitychange", update); };
  }, [supported, listening]);

  useEffect(() => {
    if (!listening || !visible || !documentVisible) return;
    // A recording clock, not a microphone/status poll; no updates while hidden.
    const update = () => setSeconds(Math.floor((Date.now() - started.current) / 1000));
    update();
    const timer = setInterval(update, 1000);
    return () => clearInterval(timer);
  }, [listening, visible, documentVisible]);

  const stop = (cancelled: boolean) => {
    if (stopped.current) return;
    stopped.current = true;
    setInterim(""); setListening(false); setBusy(true);
    onActiveChange(false);
    pending.current += 1;
    void client.stopDictation(cancelled).then((text) => {
      if (cancelled || !mounted.current) return;
      if (text) onText(text);
      else requestAnimationFrame(() => { if (mounted.current) trigger.current?.focus(); });
    }).catch((error) => {
      if (!cancelled && mounted.current) useAppStore.setState({ error: dictationMessage(error) });
    }).finally(() => {
      pending.current -= 1;
      if (mounted.current && !pending.current) setBusy(false);
    });
  };

  useEffect(() => {
    if (!listening) return;
    const composer = root.current?.closest(".agent-composer");
    const cancel = (event: Event) => {
      if ((event as KeyboardEvent).key === "Escape") { event.preventDefault(); stop(true); }
    };
    composer?.addEventListener("keydown", cancel);
    return () => composer?.removeEventListener("keydown", cancel);
  });

  const start = async () => {
    if (pending.current || disabled) return;
    pending.current += 1;
    setBusy(true); onActiveChange(true);
    try {
      stopped.current = false;
      await client.startDictation(locale);
      if (!mounted.current) { void client.stopDictation(true).catch(() => undefined); return; }
      if (stopped.current) return;
      started.current = Date.now();
      setSeconds(0); setListening(true);
    } catch (error) {
      stopped.current = true;
      if (mounted.current) {
        setListening(false); onActiveChange(false);
        useAppStore.setState({ error: dictationMessage(error) });
      }
    } finally {
      pending.current -= 1;
      if (mounted.current && !pending.current) setBusy(false);
    }
  };

  if (!supported) return null;
  if (!listening) return <span ref={root} className="inline-flex shrink-0">
    <Tooltip label={t(busy ? "Starting dictation" : "Dictate")}>
      <button ref={trigger} type="button" disabled={disabled || busy} aria-label={t("Dictate")} aria-busy={busy} aria-pressed={false} onClick={() => void start()} className="composer-control composer-icon-control composer-metal-button relative inline-flex shrink-0 items-center justify-center rounded-full text-text-secondary hover:text-text-primary disabled:opacity-40">
        <ComposerMetalSurface disabled={Boolean(disabled || busy)} /><Mic size={16} className="relative z-10" aria-hidden="true" />
      </button>
    </Tooltip>
  </span>;

  return <span ref={root} className="composer-dictation" data-animate={!reduced && visible && documentVisible}>
    <span className="composer-dictation-visual">
      <span className="dictation-orbit" aria-hidden="true">
        <svg viewBox="0 0 76 48"><defs><linearGradient id={gradient} x1="0" y1="0" x2="1" y2="1"><stop stopColor="currentColor" stopOpacity=".15" /><stop offset=".5" stopColor="currentColor" /><stop offset="1" stopColor="currentColor" stopOpacity=".25" /></linearGradient></defs><path d="M9 37C-4 16 63-4 67 12C80 33 13 54 9 37Z" stroke={`url(#${gradient})`} /><ellipse cx="38" cy="24" rx="33" ry="11" transform="rotate(25 38 24)" stroke={`url(#${gradient})`} /></svg>
        <span className="dictation-orbit-dot" /><span className="dictation-orbit-core"><Mic size={12} /></span>
      </span>
      <span className="dictation-label ui-control"><span>{t("Your idea in orbit")}</span><span className="ui-caption text-text-muted" role="status" title={interim || undefined}>{interim || t("Listening to you")}</span></span>
      <span className="dictation-wave" aria-hidden="true">{Array.from({ length: 13 }, (_, i) => <b key={i} style={{ "--bar-height": `${Math.round(7 + Math.sin(i * .63) ** 2 * 22)}px`, "--bar-delay": `calc(var(--motion-slow) * ${(-i * .41).toFixed(2)})` } as CSSProperties} />)}</span>
    </span>
    <span className="dictation-clock ui-control" aria-label={t("Recording time")}>{Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, "0")}</span>
    <Tooltip label={t("Cancel dictation")}><button type="button" onClick={() => stop(true)} aria-label={t("Cancel dictation")} className="composer-control composer-icon-control inline-flex items-center justify-center rounded-full bg-background-3 text-text-secondary hover:text-text-primary"><X size={16} aria-hidden="true" /></button></Tooltip>
    <Tooltip label={t("Finish dictation")}><button type="button" autoFocus onClick={() => stop(false)} aria-label={t("Finish dictation")} className="composer-control composer-icon-control inline-flex items-center justify-center rounded-full bg-text-primary text-background-0"><Square size={10} fill="currentColor" aria-hidden="true" /></button></Tooltip>
  </span>;
}
