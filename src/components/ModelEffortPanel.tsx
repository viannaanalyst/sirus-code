import { useEffect, useRef, useState, type CSSProperties } from "react";
import { AnimatePresence, motion } from "motion/react";
import { ChevronRight, RotateCcw, Zap } from "@/components/icons/phosphor";
import type { AgentProviderId, ExecutionOptions } from "@/client/types";
import { useTranslation } from "@/i18n/use-translation";
import { resolveModelBrand } from "@/lib/model-brand-resolver";
import { modelExecutionControls, offeredCursorVariant } from "@/lib/execution-options";
import { modelKey } from "@/lib/settings";
import { motionTokens } from "@/lib/motion";
import { useMotionPreferences } from "@/lib/use-motion-preferences";
import { useAppStore } from "@/store/app-store";

export function ModelEffortPanel({ provider, model, label, disabled, onBrowse, onSelect }: {
  provider: AgentProviderId; model: string | null; label: string; disabled: boolean;
  onBrowse: () => void; onSelect: (provider: AgentProviderId, model: string | null) => void;
}) {
  const t = useTranslation();
  const settings = useAppStore((state) => state.settings);
  const catalogs = useAppStore((state) => state.modelsByProvider);
  const saveSettings = useAppStore((state) => state.saveSettings);
  const reduced = useMotionPreferences();
  const key = modelKey(provider, model ?? "");
  const preference = settings.modelExecution[key] ?? {};
  const models = catalogs[provider]?.models ?? [];
  const fastReason = models.find((row) => row.id === model)?.fastUnavailableReason;
  const controls = modelExecutionControls(provider, model, models, preference);
  const index = Math.max(0, controls.levels.indexOf(controls.effort ?? ""));
  const available = controls.selectableLevels.length > 1;
  const root = useRef<HTMLDivElement>(null);
  const wrap = useRef<HTMLDivElement>(null);
  useEffect(() => { root.current?.querySelector<HTMLElement>("input:not(:disabled), button:not(:disabled)")?.focus(); }, []);
  const [visible, setVisible] = useState(false);
  const [documentVisible, setDocumentVisible] = useState(!document.hidden);
  useEffect(() => {
    const node = wrap.current;
    if (!node || !globalThis.IntersectionObserver) return;
    const observer = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting));
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    const update = () => setDocumentVisible(!document.hidden);
    document.addEventListener("visibilitychange", update);
    return () => document.removeEventListener("visibilitychange", update);
  }, []);
  const selectCursorVariant = (id: string | null, next: ExecutionOptions) => {
    if (!id) return;
    // A legacy Fast preset can share its plain counterpart with a new parameterized
    // entry. Preserve the user's explicit choice instead of restoring that entry's Fast default.
    if (models.find((row) => row.id === id)?.parameterized) {
      const state = useAppStore.getState();
      const targetKey = modelKey(provider, id);
      void saveSettings({ ...state.settings, modelExecution: { ...state.settings.modelExecution, [targetKey]: { ...state.settings.modelExecution[targetKey], ...next } } });
    }
    onSelect(provider, id);
  };
  const setPreference = (next: ExecutionOptions) => {
    if (disabled || !model) return;
    if (provider === "cursor" && !controls.parameterized) {
      const id = offeredCursorVariant(controls.variants, model, next.effort ?? controls.effort, next.fast ?? controls.fast);
      selectCursorVariant(id, { effort: next.effort ?? controls.effort, fast: next.fast ?? controls.fast });
    } else {
      const state = useAppStore.getState();
      void saveSettings({ ...state.settings, modelExecution: { ...state.settings.modelExecution, [key]: { ...state.settings.modelExecution[key], ...next } } });
    }
  };
  const effortLabel = controls.effort ? t(`effort.${controls.effort}`) : t("composer.effortAuto");
  // Higher effort heats the model's colour toward red and speeds the energy up.
  const heat = controls.levels.length > 1 ? index / (controls.levels.length - 1) : 0;
  const embers = controls.levels.length > 1 ? 2 + Math.round(heat * 8) : 0;
  return <div ref={root} className="model-effort-panel p-3" data-brand={resolveModelBrand(model ?? "", provider)} data-fast={controls.fast}
    style={{ "--effort-heat-mix": `${Math.round(heat * 85)}%`, "--effort-speed": 1 - heat * 0.6 } as CSSProperties}>
    <div className="mb-3 flex items-center justify-between gap-2">
      <button type="button" disabled={disabled || !controls.fastAvailable} aria-label={t(controls.fastAvailable ? controls.fast ? "composer.fastDisable" : "composer.fastEnable" : fastReason ? `composer.fastReason.${fastReason}` : "composer.fastUnavailable") + (controls.fastAvailable ? ` · ${t("composer.fastUsage")}` : "")} aria-pressed={controls.fast}
        onClick={() => setPreference({ fast: !controls.fast })} className="effort-bolt flex size-8 items-center justify-center rounded-full disabled:opacity-35">
        <Zap size={20} fill={controls.fast ? "currentColor" : "none"} aria-hidden="true" />
      </button>
      <div className="min-w-0 flex-1 text-center">
        <div className="h-6 overflow-hidden" aria-live="polite">
          <AnimatePresence mode="wait" initial={false}><motion.span key={effortLabel} className="effort-label block ui-dialog-title"
            initial={reduced ? false : { opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: reduced ? 0 : motionTokens.fast }}>{effortLabel}</motion.span></AnimatePresence>
        </div>
        <button type="button" onClick={onBrowse} disabled={disabled} className="mx-auto flex max-w-full items-center gap-1 rounded-full px-2 py-0.5 ui-control text-text-secondary hover:text-text-primary">
          <span className="truncate">{label}</span><ChevronRight size={14} aria-hidden="true" />
        </button>
      </div>
      <button type="button" disabled={disabled || !model || (!available && !controls.fastAvailable)} aria-label={t("composer.resetEffort")} className="flex size-7 items-center justify-center rounded-full text-text-muted hover:bg-background-3 disabled:opacity-35" onClick={() => {
        if (provider === "cursor" && !controls.parameterized) {
          const normal = controls.variants.filter((row) => !row.id.endsWith("-fast"));
          const defaultEffort = normal.some((row) => /-medium$/.test(row.id)) ? "medium" : normal.some((row) => /-high$/.test(row.id)) ? "high" : controls.effort;
          const id = offeredCursorVariant(controls.variants, model, defaultEffort, false);
          selectCursorVariant(id, { effort: defaultEffort, fast: false });
        }
        else { const state = useAppStore.getState(); const next = { ...state.settings.modelExecution }; delete next[key]; void saveSettings({ ...state.settings, modelExecution: next }); }
      }}><RotateCcw size={14} aria-hidden="true" /></button>
    </div>
    <div ref={wrap} className="effort-slider" data-fixed={controls.levels.length === 1 && !disabled} data-automatic={controls.levels.length === 0} data-animate={!reduced && visible && documentVisible && (controls.levels.length > 0 || controls.fastAvailable)} style={{ "--effort-fill": controls.levels.length > 1 ? .055 + .89 * index / (controls.levels.length - 1) : controls.levels.length === 1 ? .945 : 1 } as CSSProperties}>
      <div className="effort-track" aria-hidden="true">
        <div className="effort-fill" />
        <div className="effort-energy"><div className="effort-nebula" /><div className="effort-particles" /><div className="effort-flare" />
          <div className="effort-embers" aria-hidden="true">{Array.from({ length: embers }, (_, ember) => <i key={ember} style={{ left: `${6 + ember * 9}%`, animationDelay: `${ember * 0.19}s` } as CSSProperties} />)}</div>
          <svg className="effort-lightning" viewBox="0 0 360 40" preserveAspectRatio="none"><path d="M-20 24 31 12 45 26 79 10 95 28 142 15 130 30 181 9 202 25 231 13 251 30 290 10 308 24 380 13"/><path d="M60 38 88 20 105 27 137 2 M182 9 191 1 M231 13 246 3 270 7 M251 30 266 38"/></svg>
        </div>
        <svg className="effort-strike" viewBox="0 0 360 48" preserveAspectRatio="none" aria-hidden="true"><path d="M0 30 40 14 62 32 98 10 120 34 160 12 176 30 214 8 236 30 270 14 300 34 330 16 360 24" /></svg>
        <div className="effort-dots">{controls.levels.length > 1 ? controls.levels.map((level) => <i key={level} />) : null}</div>
      </div>
      {controls.levels.length > 0 ? <input type="range" min={0} max={Math.max(1, controls.levels.length - 1)} step={1} value={controls.levels.length === 1 ? 1 : index} disabled={disabled || !available}
        aria-label={t("composer.effort")} aria-valuetext={effortLabel} onChange={(event) => setPreference({ effort: controls.levels[Number(event.target.value)] })} /> : null}
    </div>
    {controls.levels.length > 0 ? <div className="mt-2 flex justify-between ui-caption text-text-muted"><span>{controls.levels.length === 1 ? t("composer.effortFixed") : t(`effort.${controls.levels[0] ?? "minimal"}`)}</span><span>{t(`effort.${controls.levels.at(-1) ?? "xhigh"}`)}</span></div>
    : <p className="mt-2 ui-description text-text-muted">{t("composer.effortAutomaticHelp")}</p>}
    {!available && controls.levels.length > 1 ? <p className="mt-3 ui-description text-text-muted">{t(controls.fast && controls.levels.length > controls.selectableLevels.length ? "composer.effortFixedFast" : "composer.effortUnsupported")}</p> : null}

  </div>;
}
