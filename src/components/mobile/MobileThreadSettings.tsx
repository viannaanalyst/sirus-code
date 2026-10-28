import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "motion/react";
import type { AgentProviderId, ApprovalMode, ExecutionOptions } from "@/client/types";
import { Bot, Check, ChevronLeft, ChevronRight, Hand, Lightbulb, Search, X, Zap } from "@/components/icons";
import { ProviderIcon } from "@/components/settings/ProviderIcon";
import type { PhoneModelButtonProps } from "@/components/phone-composer-slot";
import { usePhoneTranslation as useTranslation } from "./use-phone-host";
import { composerApproval } from "@/lib/composer-approval";
import { modelExecutionControls } from "@/lib/execution-options";
import { motionTokens } from "@/lib/motion";
import { approvalOptions, chooseExecution, isDefaultChoice, threadSettingsOptions, threadSettingsSections, threadSettingsSummary } from "@/lib/phone-chat";
import { PROVIDERS, providerById } from "@/lib/provider-registry";
import { announceProviderSwitch } from "@/lib/provider-switch";
import { isProviderEnabled, modelKey } from "@/lib/settings";
import { useMotionPreferences } from "@/lib/use-motion-preferences";
import { useAppStore } from "@/store/app-store";
import "@/styles/mobile-thread-settings.css";

interface Draft { provider: AgentProviderId; model: string | null; preference: ExecutionOptions; save: boolean; approval: ApprovalMode | null }
type Page = "main" | "model" | "effort" | "tier" | "access";

const APPROVAL_LABEL: Record<ApprovalMode, string> = { ask: "composer.askApproval", auto: "composer.autoReview", full: "composer.fullAccess" };
const APPROVAL_ICON = { ask: Hand, auto: Bot, full: Zap } as const;
const PAGE_TITLE: Record<Page, string> = { main: "phoneChat.settings", model: "phoneChat.model", effort: "phoneChat.reasoning", tier: "phoneChat.serviceTier", access: "phoneChat.access" };

/**
 * Thread settings, "summary first" (ADR-129): the pending model and its options on one screen,
 * the model list and each option's choices on screens that slide in. Choices wait in a draft;
 * OK applies them with the composer's own rules (a provider change is the desktop's model change,
 * effort and Fast are saved per model, access per provider), Cancel drops them.
 */
export function MobileThreadSettings({ open, onClose, session, provider, model, modelDisabled, accessDisabled, approvalByProvider, planning, onModelChange, onApproval }: PhoneModelButtonProps & { open: boolean; onClose: () => void }) {
  const t = useTranslation();
  const reduced = useMotionPreferences();
  const settings = useAppStore((state) => state.settings);
  const installs = useAppStore((state) => state.agents);
  const catalogs = useAppStore((state) => state.modelsByProvider);
  const [draft, setDraft] = useState<Draft>({ provider, model, preference: {}, save: false, approval: null });
  const [page, setPage] = useState<Page>("main");
  const [direction, setDirection] = useState(1);
  const [focusTarget, setFocusTarget] = useState("cancel");
  const [query, setQuery] = useState("");
  const sheet = useRef<HTMLDivElement>(null);
  const providers = useMemo(() => PROVIDERS.filter((definition) => installs.some((item) => item.id === definition.id && item.installed) && isProviderEnabled(settings, definition.id)).map((definition) => definition.id), [installs, settings]);

  // Each opening starts from the conversation as it is.
  useEffect(() => {
    if (!open) return;
    const state = useAppStore.getState();
    setDraft({ provider, model, preference: state.settings.modelExecution[modelKey(provider, model ?? "")] ?? {}, save: false, approval: null });
    setPage("main");
    setFocusTarget("cancel");
    setQuery("");
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only when the sheet opens
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const close = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [open, onClose]);
  // Focus follows the screen: Cancel on open, Back on a sub-screen, the row it came from on return.
  useEffect(() => {
    if (!open) return;
    const frame = requestAnimationFrame(() => sheet.current?.querySelector<HTMLElement>(`[data-focus="${focusTarget}"]`)?.focus({ preventScroll: true }));
    return () => cancelAnimationFrame(frame);
  }, [open, focusTarget]);
  // The pending provider's catalog feeds the summary; the model screen loads every enabled one.
  useEffect(() => {
    if (!open) return;
    const load = useAppStore.getState().loadProviderModels;
    for (const id of providers) if (page === "model" || id === draft.provider) void load(id);
  }, [open, providers, page, draft.provider]);

  const go = (next: Page) => {
    setDirection(next === "main" ? -1 : 1);
    setFocusTarget(next === "main" ? page : "back");
    setPage(next);
  };
  const models = catalogs[draft.provider]?.models ?? [];
  const controls = modelExecutionControls(draft.provider, draft.model, models, draft.preference);
  const definition = providerById(draft.provider);
  const shown = threadSettingsOptions(controls, definition.approvalModes);
  const summary = threadSettingsSummary(settings, models, draft.provider, draft.model, session ? provider : null);
  const approval = draft.approval ?? composerApproval(draft.provider, session, approvalByProvider, planning, settings.defaultApproval).effective;
  const effortLabel = controls.effort ? t(`effort.${controls.effort}`) : t("composer.effortAuto");
  const modelName = summary.name ?? t("models.select");

  const pickModel = (next: AgentProviderId, id: string, stay = false) => {
    if (modelDisabled) return;
    setDraft((current) => ({ provider: next, model: id, preference: useAppStore.getState().settings.modelExecution[modelKey(next, id)] ?? {}, save: false, approval: next === current.provider ? current.approval : null }));
    setQuery("");
    if (!stay) go("main");
  };
  const modelRow = (row: ReturnType<typeof threadSettingsSections>[number]["rows"][number], stay = false) => {
    const selected = row.provider === draft.provider && row.variantIds.includes(draft.model ?? "");
    return <button key={modelKey(row.provider, row.model.id)} type="button" className="mts-model" aria-pressed={selected} data-selected={selected || undefined} disabled={modelDisabled} onClick={() => pickModel(row.provider, row.model.id, stay)}>
      <span className="mts-model-name">{row.displayName.replace(/^Claude\s+/i, "")}</span>
      {isDefaultChoice(settings, row) ? <span className="mts-tag">{t("phoneChat.default")}</span> : null}
      <span className="mts-check" aria-hidden="true">{selected ? <Check size={16} /> : null}</span>
    </button>;
  };
  const pickExecution = (next: ExecutionOptions) => {
    if (modelDisabled) return;
    setDraft((current) => {
      const result = chooseExecution(current.provider, current.model, catalogs[current.provider]?.models ?? [], current.preference, next);
      return { ...current, model: result.model, preference: result.preference, save: result.save || (current.save && result.model === current.model) };
    });
    go("main");
  };
  const done = () => {
    if (draft.provider !== provider || draft.model !== model) {
      if (draft.provider !== provider && session) announceProviderSwitch(session.id, draft.provider);
      onModelChange(draft.provider, draft.model);
    }
    if (draft.save && draft.model) {
      const state = useAppStore.getState();
      const key = modelKey(draft.provider, draft.model);
      void state.saveSettings({ ...state.settings, modelExecution: { ...state.settings.modelExecution, [key]: { ...state.settings.modelExecution[key], ...draft.preference } } });
    }
    if (draft.approval && !accessDisabled) onApproval(draft.provider, draft.approval);
    onClose();
  };

  const title = t(PAGE_TITLE[page]);
  const transition = { duration: reduced ? 0 : motionTokens.normal, ease: motionTokens.ease };
  const head = <header className="mts-head">
    {page === "main"
      ? <button type="button" className="mts-head-button" data-focus="cancel" onClick={onClose}>{t("common.cancel")}</button>
      : <button type="button" className="mts-head-back" data-focus="back" aria-label={t("mobile.back")} onClick={() => go("main")}><ChevronLeft size={20} aria-hidden="true" /></button>}
    <h2>{title}</h2>
    {page === "main" ? <button type="button" className="mts-head-button" data-tone="primary" onClick={done}>{t("phoneChat.done")}</button> : <span aria-hidden="true" />}
  </header>;

  let body: ReactNode;
  if (page === "main") {
    // The selected agent's models sit under the summary, options last; "Change" lists every agent's.
    const ownModels = threadSettingsSections(catalogs, settings, [draft.provider], draft.provider, draft.model, "")[0]?.rows ?? [];
    body = <div className="mts-scroll">
      <div className="mts-summary">
        <span className="mts-summary-tile" aria-hidden="true"><ProviderIcon id={draft.provider} size={24} /></span>
        <span className="mts-summary-text">
          <span className="mts-summary-name">{modelName}</span>
          <span className="mts-summary-sub">{definition.name}{summary.note ? ` · ${t(summary.note === "switch" ? "phoneChat.switchesAgent" : "phoneChat.default")}` : ""}</span>
        </span>
        <button type="button" className="mts-change" data-focus="model" disabled={modelDisabled} aria-label={t("phoneChat.changeModel", { model: modelName })} onClick={() => go("model")}>{t("phoneChat.change")}</button>
      </div>
      {modelDisabled ? <p className="mobile-help mts-note">{t("phoneChat.modelLocked")}</p> : null}
      {ownModels.length > 1 ? <section aria-labelledby="mts-models-label">
        <h3 id="mts-models-label" className="mts-label">{t("phoneChat.providerModels", { provider: definition.name })}</h3>
        <div className="mts-card">{ownModels.map((row) => modelRow(row, true))}</div>
      </section> : null}
      {shown.reasoning || shown.tier || shown.access ? <section aria-labelledby="mts-options-label">
        <h3 id="mts-options-label" className="mts-label">{t("phoneChat.options")}</h3>
        <div className="mts-card">
          {shown.reasoning ? <OptionRow focus="effort" icon={<Lightbulb size={17} />} title={t("phoneChat.reasoning")} value={effortLabel} disabled={modelDisabled || !draft.model || controls.selectableLevels.length < 2} onClick={() => go("effort")} /> : null}
          {shown.tier ? <OptionRow focus="tier" icon={<Zap size={17} />} title={t("phoneChat.serviceTier")} value={t(controls.fast ? "phoneChat.fast" : "phoneChat.standard")} disabled={modelDisabled} onClick={() => go("tier")} /> : null}
          {shown.access ? <OptionRow focus="access" icon={(() => { const Icon = APPROVAL_ICON[approval]; return <Icon size={17} />; })()} title={t("phoneChat.access")} value={t(approval === "ask" && definition.approvalPolicy === "vendor" ? "composer.vendorApproval" : APPROVAL_LABEL[approval])} disabled={accessDisabled} onClick={() => go("access")} /> : null}
        </div>
      </section> : null}
    </div>;
  } else if (page === "model") {
    const sections = threadSettingsSections(catalogs, settings, providers, draft.provider, draft.model, query);
    body = <>
      <div className="mts-scroll" data-search="">
        {sections.map(({ provider: id, rows }) => <section key={id} className="mts-group" aria-labelledby={`mts-group-${id}`}>
          <h3 id={`mts-group-${id}`} className="mts-group-head"><ProviderIcon id={id} size={16} /><span>{providerById(id).name}</span></h3>
          <div className="mts-card">
            {rows.length ? rows.map((row) => modelRow(row)) : <p className="mobile-empty mts-empty" role="status">{t(catalogs[id] ? "models.noProviderModels" : "models.loading")}</p>}
          </div>
        </section>)}
        {query.trim() && !sections.length ? <p className="mobile-empty" role="status">{t("models.noMatches")}</p> : null}
      </div>
      <label className="mts-search mobile-glass">
        <Search size={16} aria-hidden="true" />
        <input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t("phoneChat.findModel")} aria-label={t("phoneChat.findModel")} autoCapitalize="off" autoCorrect="off" enterKeyHint="search" />
        {query ? <button type="button" aria-label={t("Clear search")} onClick={() => setQuery("")}><X size={14} aria-hidden="true" /></button> : null}
      </label>
    </>;
  } else if (page === "effort") {
    body = <div className="mts-scroll">
      <div className="mts-card">
        {controls.levels.map((level) => <ChoiceRow key={level} title={t(`effort.${level}`)} selected={controls.effort === level} disabled={!controls.selectableLevels.includes(level)} onClick={() => pickExecution({ effort: level })} />)}
      </div>
      <p className="mts-hint">{t("phoneChat.reasoningHint")}</p>
    </div>;
  } else if (page === "tier") {
    body = <div className="mts-scroll">
      <div className="mts-card">
        <ChoiceRow title={t("phoneChat.standard")} selected={!controls.fast} onClick={() => pickExecution({ fast: false })} />
        <ChoiceRow title={t("phoneChat.fast")} selected={controls.fast} onClick={() => pickExecution({ fast: true })} />
      </div>
      <p className="mts-hint">{t("phoneChat.fastHint")}</p>
    </div>;
  } else {
    body = <div className="mts-scroll">
      <div className="mts-card">
        {approvalOptions(definition.approvalModes).map(({ mode, supported }) => {
          const description = !supported ? "composer.approvalUnsupported" : mode === "ask" ? "composer.askApprovalDescription" : mode === "auto" && draft.provider === "opencode" ? "composer.autoEditsDescription" : mode === "auto" ? "composer.autoReviewDescription" : "composer.fullAccessDescription";
          return <ChoiceRow key={mode} title={t(APPROVAL_LABEL[mode])} subtitle={t(description)} selected={supported && approval === mode} disabled={!supported || accessDisabled}
            onClick={() => { setDraft((current) => ({ ...current, approval: mode })); go("main"); }} />;
        })}
      </div>
      <p className="mts-hint">{t("phoneChat.accessHint", { provider: definition.name })}</p>
    </div>;
  }

  return createPortal(<AnimatePresence>
    {open ? <motion.div key="thread-settings" className="mobile-action-scrim mobile-thread-scrim" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={transition} onClick={onClose}>
      <motion.div ref={sheet} role="dialog" aria-modal="true" aria-label={title} className="mobile-thread-sheet" initial={{ y: "100%" }} animate={{ y: 0 }} exit={{ y: "100%" }} transition={transition} onClick={(event) => event.stopPropagation()}>
        <span className="mobile-sheet-grip" aria-hidden="true" />
        <div className="mts-viewport">
          <AnimatePresence initial={false} custom={direction}>
            <motion.div key={page} className="mts-page" data-page={page} custom={direction} variants={PAGE_MOTION} initial="enter" animate="center" exit="exit" transition={transition}>
              {head}
              {body}
            </motion.div>
          </AnimatePresence>
        </div>
      </motion.div>
    </motion.div> : null}
  </AnimatePresence>, document.body);
}

/** Sub-screens push in from the right and pop back, the summary shifts a little behind them. */
const PAGE_MOTION = {
  enter: (direction: number) => ({ x: direction > 0 ? "100%" : "-28%", opacity: direction > 0 ? 1 : 0 }),
  center: { x: 0, opacity: 1 },
  exit: (direction: number) => ({ x: direction > 0 ? "-28%" : "100%", opacity: direction > 0 ? 0 : 1 }),
};

function OptionRow({ focus, icon, title, value, disabled, onClick }: { focus: string; icon: ReactNode; title: string; value: string; disabled?: boolean; onClick: () => void }) {
  return <button type="button" className="mts-option" data-focus={focus} disabled={disabled} onClick={onClick}>
    <span className="mts-option-icon" aria-hidden="true">{icon}</span>
    <span className="mts-option-title">{title}</span>
    <span className="mts-option-value">{value}</span>
    <ChevronRight size={15} aria-hidden="true" className="mts-chevron" />
  </button>;
}

function ChoiceRow({ title, subtitle, selected, disabled, onClick }: { title: string; subtitle?: string; selected: boolean; disabled?: boolean; onClick: () => void }) {
  return <button type="button" aria-pressed={selected} className="mts-choice" disabled={disabled} onClick={onClick}>
    <span className="mts-choice-text"><span>{title}</span>{subtitle ? <span className="mts-choice-subtitle">{subtitle}</span> : null}</span>
    <span className="mts-check" aria-hidden="true">{selected ? <Check size={16} /> : null}</span>
  </button>;
}
