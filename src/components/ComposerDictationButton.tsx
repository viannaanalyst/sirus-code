import { useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { Check, Mic, X } from "@/components/icons";
import { client, isRemoteUi } from "@/client";
import { useTranslation } from "@/i18n/use-translation";
import { recordingClock, waveformBars } from "@/lib/dictation-bar";
import { formatUnknownError } from "@/lib/format-error";
import { motionTokens } from "@/lib/motion";
import { useMotionPreferences } from "@/lib/use-motion-preferences";
import { RecordedDictation, WebDictation, iosHomeScreenApp, webDictationSupported } from "@/lib/web-dictation";
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

/**
 * Where the words come from: the Mac's native dictation, or on a phone (ADR-084) the
 * browser's own speech recognition, since the Mac's microphone is out of reach there.
 */
interface DictationEngine {
  status(): Promise<boolean>;
  start(locale: string, onInterim: (text: string) => void): Promise<void>;
  stop(cancelled: boolean): Promise<string>;
}

function createEngine(): DictationEngine {
  if (!isRemoteUi) return {
    status: () => client.dictationStatus().then((status) => status !== "unsupported"),
    start: (locale) => client.startDictation(locale),
    stop: (cancelled) => client.stopDictation(cancelled).then((text) => text ?? ""),
  };
  // The iPhone home-screen app records and lets the computer transcribe (ADR-084 addendum).
  if (iosHomeScreenApp()) {
    let locale = "pt-BR";
    const recorded = new RecordedDictation((audio) => client.transcribeAudio(locale, audio));
    return {
      status: () => RecordedDictation.supported() ? client.transcriptionStatus().then((status) => status === "available", () => false) : Promise.resolve(false),
      start: (next) => { locale = next; return recorded.start(); },
      stop: (cancelled) => recorded.stop(cancelled),
    };
  }
  const web = new WebDictation();
  return { status: () => Promise.resolve(webDictationSupported()), start: (locale, onInterim) => web.start(locale, onInterim), stop: (cancelled) => web.stop(cancelled) };
}

const DESKTOP_BARS = waveformBars(13);
const PHONE_BARS = waveformBars(28, 22, 4);

/**
 * Dictation and its recording bar. No audio-level probe: the waveform moves with CSS. The bar
 * holds two buttons: ✕ discards, ✓ stops and puts the words in the composer to review; Enter
 * finishes too, and sends when Chat behavior says so. The Mac keeps the orb and "Listening to you"
 * (ADR-023); the phone (`compact`) shows a bar: ✕, waveform, time, ✓ (ADR-129).
 */
export function ComposerDictationButton({ onText, disabled, onActiveChange, compact = false }: {
  /** `send` is true when Enter stopped the recording and Chat behavior asks to send. */
  onText: (text: string, send: boolean) => void;
  disabled?: boolean;
  onActiveChange: (active: boolean) => void;
  compact?: boolean;
}) {
  const t = useTranslation();
  const locale = useAppStore((state) => state.settings.locale);
  const reduced = useMotionPreferences();
  const gradient = useId();
  const [supported, setSupported] = useState(false);
  const [listening, setListening] = useState(false);
  // The bar plays its exit before the composer's controls come back.
  const [leaving, setLeaving] = useState(false);
  const refocus = useRef(false);
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
  const engine = useRef<DictationEngine | null>(null);
  engine.current ??= createEngine();

  useEffect(() => {
    mounted.current = true;
    void engine.current?.status().then((ok) => {
      if (mounted.current) setSupported(ok);
    }).catch(() => undefined);
    return () => {
      mounted.current = false;
      stopped.current = true;
      onActiveChange(false);
      void engine.current?.stop(true).catch(() => undefined);
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

  const stop = (cancelled: boolean, send = false) => {
    if (stopped.current) return;
    stopped.current = true;
    setBusy(true);
    const settle = () => {
      if (!mounted.current) return;
      setLeaving(false); setInterim(""); setListening(false);
      onActiveChange(false);
    };
    if (reduced) settle();
    else { setLeaving(true); window.setTimeout(settle, motionTokens.fast * 1000); }
    pending.current += 1;
    void engine.current!.stop(cancelled).then((text) => {
      if (cancelled || !mounted.current) return;
      if (text) onText(text, send);
      else refocus.current = true;
    }).catch((error) => {
      if (!cancelled && mounted.current) useAppStore.setState({ error: dictationMessage(error) });
    }).finally(() => {
      pending.current -= 1;
      if (mounted.current && !pending.current) setBusy(false);
    });
  };

  // Nothing was heard: the mic gets the focus back once it is on screen again.
  useLayoutEffect(() => {
    if (listening || !refocus.current || !trigger.current) return;
    refocus.current = false;
    trigger.current.focus();
  });

  useEffect(() => {
    if (!listening) return;
    const composer = root.current?.closest(".agent-composer");
    const cancel = (event: Event) => {
      const key = (event as KeyboardEvent).key;
      if (key === "Escape") { event.preventDefault(); stop(true); }
      // Enter finishes the recording; Chat behavior decides whether it also sends.
      else if (key === "Enter" && !(event as KeyboardEvent).isComposing) {
        event.preventDefault();
        stop(false, useAppStore.getState().settings.dictationEnterSends);
      }
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
      await engine.current!.start(locale, (text) => { if (mounted.current) setInterim(text); });
      if (!mounted.current) { void engine.current!.stop(true).catch(() => undefined); return; }
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
      <button ref={trigger} type="button" disabled={disabled || busy} aria-label={t("Dictate")} aria-busy={busy} aria-pressed={false} onClick={() => void start()} className={`composer-control composer-icon-control ${compact ? "composer-dictate-plain" : "composer-plain-button"} relative inline-flex shrink-0 items-center justify-center rounded-full text-text-secondary hover:text-text-primary disabled:opacity-40`}>
        <Mic size={compact ? 18 : 16} className="relative z-10" aria-hidden="true" />
      </button>
    </Tooltip>
  </span>;

  const bars = compact ? PHONE_BARS : DESKTOP_BARS;
  const wave = <span className="dictation-wave" aria-hidden="true">{bars.map((bar, i) => <b key={i} style={{ "--bar-height": `${bar.height}px`, "--bar-delay": `calc(var(--motion-slow) * ${bar.delay})` } as CSSProperties} />)}</span>;
  const clock = <span className="dictation-clock ui-control" role="timer" aria-label={t("Recording time")}>{recordingClock(seconds)}</span>;
  const cancel = <Tooltip label={t("Cancel dictation")}><button type="button" onClick={() => stop(true)} aria-label={t("Cancel dictation")} className="dictation-cancel composer-control composer-icon-control inline-flex items-center justify-center rounded-full bg-background-3 text-text-secondary hover:text-text-primary"><X size={16} aria-hidden="true" /></button></Tooltip>;
  // No tooltip: the button takes focus when recording starts, and a tooltip would open with it.
  const finish = <button type="button" autoFocus onClick={() => stop(false)} aria-label={t("Finish dictation")} className="dictation-finish composer-control composer-icon-control inline-flex items-center justify-center rounded-full"><Check size={16} weight="bold" aria-hidden="true" /></button>;
  return <span ref={root} className="composer-dictation" data-compact={compact || undefined} data-leaving={leaving || undefined} data-animate={!reduced && visible && documentVisible && !leaving}>
    {compact ? <>
      {cancel}
      {wave}
      <span className="sr-only" role="status">{interim || t("Listening to you")}</span>
      {clock}
    </> : <>
      <span className="composer-dictation-visual">
        <span className="dictation-orbit" aria-hidden="true">
          <svg viewBox="0 0 76 48"><defs><linearGradient id={gradient} x1="0" y1="0" x2="1" y2="1"><stop stopColor="currentColor" stopOpacity=".15" /><stop offset=".5" stopColor="currentColor" /><stop offset="1" stopColor="currentColor" stopOpacity=".25" /></linearGradient></defs><path d="M9 37C-4 16 63-4 67 12C80 33 13 54 9 37Z" stroke={`url(#${gradient})`} /><ellipse cx="38" cy="24" rx="33" ry="11" transform="rotate(25 38 24)" stroke={`url(#${gradient})`} /></svg>
          <span className="dictation-orbit-dot" /><span className="dictation-orbit-core"><Mic size={12} /></span>
        </span>
        <span className="dictation-label ui-control" role="status" title={interim || undefined}>{interim || t("Listening to you")}</span>
        {wave}
      </span>
      {clock}
      {cancel}
    </>}
    {finish}
  </span>;
}
