import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { Check, ChevronDown, ChevronLeft, Search, Star, X, Zap } from "@/components/icons/phosphor";
import { motion } from "motion/react";
import type { AgentProviderId } from "@/client/types";
import { ModelEffortPanel } from "@/components/ModelEffortPanel";
import { ModelIcon } from "@/components/ModelIcon";
import { modelExecutionControls } from "@/lib/execution-options";
import { FavoriteStar } from "@/components/FavoriteStar";
import { ProviderIcon } from "@/components/settings/ProviderIcon";
import { ProviderOrbitSwap } from "@/components/ProviderOrbitSwap";
import { announceProviderSwitch } from "@/lib/provider-switch";
import { translate, type Locale } from "@/i18n";
import { cn } from "@/lib/cn";
import { modelDisplayName, pickerModelChoices, type ModelChoice, type ModelPickerScope } from "@/lib/model-registry";
import { motionTokens } from "@/lib/motion";
import { PROVIDERS, providerById } from "@/lib/provider-registry";
import { isProviderEnabled, modelKey, parseModelKey } from "@/lib/settings";
import { useMotionPreferences } from "@/lib/use-motion-preferences";
import { Popover, PopoverContent, PopoverTrigger } from "@/primitives/Popover";
import { useAppStore } from "@/store/app-store";

export function ModelSelector({ currentProvider, currentModel, onSelect, disabled = false, executionControls = false, switchOwner }: {
  executionControls?: boolean;
  /** Announces a provider switch for this pane's scene (`ProviderSwitchScene`). */
  switchOwner?: string;
  disabled?: boolean;
  currentProvider: AgentProviderId;
  currentModel: string | null;
  onSelect: (provider: AgentProviderId, model: string | null) => void;
}) {
  const settings = useAppStore((state) => state.settings);
  const installs = useAppStore((state) => state.agents);
  const catalogs = useAppStore((state) => state.modelsByProvider);
  const loadProviderModels = useAppStore((state) => state.loadProviderModels);
  const toggleFavorite = useAppStore((state) => state.toggleModelFavorite);
  const t = (key: string) => translate(settings.locale, key);
  const reducedMotion = useMotionPreferences();
  const [open, setOpen] = useState(false);
  const [orbit, setOrbit] = useState<{ from: AgentProviderId; to: AgentProviderId; key: number } | null>(null);
  const [page, setPage] = useState<"effort" | "catalog">("catalog");
  const browseButton = useRef<HTMLButtonElement>(null);
  const [scope, setScope] = useState<ModelPickerScope>(currentProvider);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const requestSequence = useRef(0);
  const search = useRef<HTMLInputElement>(null);
  const rail = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const panelId = useId();
  const glide = useRef<HTMLSpanElement>(null);
  const enabledProviders = useMemo(() => PROVIDERS.filter((definition) =>
    installs.some((item) => item.id === definition.id && item.installed) && isProviderEnabled(settings, definition.id)
  ).map((definition) => definition.id), [installs, settings]);
  const providerReady = enabledProviders.includes(currentProvider) || Boolean(currentModel && installs.some((item) => item.id === currentProvider && item.installed));

  // Only the selected provider is warmed up. Hover probes are cached/coalesced by the store.
  useEffect(() => {
    if (providerReady) void loadProviderModels(currentProvider);
  }, [providerReady, currentProvider, loadProviderModels]);

  const rows = useMemo(() => pickerModelChoices(catalogs, settings, enabledProviders, scope, currentProvider, currentModel, query),
    [catalogs, settings, enabledProviders, scope, currentProvider, currentModel, query]);
  const rawLabel = catalogs[currentProvider]?.models.find((model) => model.id === currentModel)?.displayName ?? currentModel;
  const currentLabel = rawLabel ? modelDisplayName(currentProvider, rawLabel, catalogs[currentProvider]?.models.map((model) => model.displayName)).replace(/^Claude\s+/i, "") : t("models.select");

  const loadScope = (next: ModelPickerScope) => {
    const sequence = ++requestSequence.current;
    const sources = next === "favorites" ? enabledProviders.filter((provider) =>
      settings.favoriteModels.some((key) => parseModelKey(key)?.provider === provider)
    ) : enabledProviders.filter((provider) => provider === next);
    setLoading(sources.some((provider) => !catalogs[provider]));
    void Promise.all(sources.map((provider) => loadProviderModels(provider))).finally(() => {
      if (requestSequence.current === sequence) setLoading(false);
    });
  };
  const browse = (next: ModelPickerScope) => {
    if (disabled || next === scope) return;
    // Keep keyboard focus safe when pointer browsing replaces the focused model row.
    if (panel.current?.contains(document.activeElement)) search.current?.focus();
    setScope(next);
    setQuery("");
    loadScope(next);
  };
  const select = (row: ModelChoice) => {
    if (disabled) return;
    if (executionControls) setPage("effort"); else setOpen(false);
    setQuery("");
    ++requestSequence.current;
    if (row.provider !== currentProvider) {
      if (!reducedMotion) setOrbit({ from: currentProvider, to: row.provider, key: performance.now() });
      if (switchOwner) announceProviderSwitch(switchOwner, row.provider);
    }
    onSelect(row.provider, row.model.id);
  };
  const manageProviders = () => {
    setOpen(false);
    ++requestSequence.current;
    const store = useAppStore.getState();
    store.setNewSessionOpen(false);
    store.setSettingsSection("providers");
    store.setSettingsOpen(true);
  };
  const navigate = (event: KeyboardEvent<HTMLDivElement>) => {
    const target = event.target;
    const providers = Array.from(rail.current?.querySelectorAll<HTMLButtonElement>("button[data-provider-option]:not(:disabled)") ?? []);
    const models = Array.from(panel.current?.querySelectorAll<HTMLButtonElement>("button[data-model-option]:not(:disabled)") ?? []);
    if (target instanceof HTMLInputElement && ["ArrowDown", "ArrowUp"].includes(event.key)) {
      const button = event.key === "ArrowDown" ? models[0] : models[models.length - 1];
      if (button) { event.preventDefault(); button.focus(); }
      return;
    }
    if (!(target instanceof HTMLButtonElement)) return;
    const buttons = target.hasAttribute("data-provider-option") ? providers : target.hasAttribute("data-model-option") ? models : [];
    if (!buttons.length) return;
    // Provider tabs run left to right above the list; models run top to bottom.
    const tab = providers.includes(target);
    const back = tab ? "ArrowLeft" : "ArrowUp", forward = tab ? "ArrowRight" : "ArrowDown";
    if ([back, forward, "Home", "End"].includes(event.key)) {
      event.preventDefault();
      const index = buttons.indexOf(target);
      const next = event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1 : (index + (event.key === back ? -1 : 1) + buttons.length) % buttons.length;
      buttons[next]?.focus();
    } else if (event.key === "ArrowDown" && tab) {
      event.preventDefault();
      (models[0] ?? search.current)?.focus();
    } else if (event.key === "ArrowLeft" && models.includes(target)) {
      event.preventDefault();
      providers.find((button) => button.dataset.providerOption === scope)?.focus();
    }
  };

  const execution = modelExecutionControls(currentProvider, currentModel, catalogs[currentProvider]?.models ?? [], settings.modelExecution[modelKey(currentProvider, currentModel ?? "")]);
  useEffect(() => { if (open && page === "catalog") search.current?.focus(); }, [open, page]);
  // The highlight glides to the chosen provider tab; the first placement is instant.
  useLayoutEffect(() => {
    const mark = glide.current, tab = rail.current?.querySelector<HTMLElement>(`[data-provider-option="${scope}"]`);
    if (!mark || !tab) return;
    const first = !mark.dataset.placed;
    if (first) mark.style.transition = "none";
    mark.style.transform = `translateX(${tab.offsetLeft}px)`;
    mark.style.width = `${tab.offsetWidth}px`;
    if (first) { void mark.offsetWidth; mark.style.transition = ""; mark.dataset.placed = "1"; }
  });

  return (
    <Popover open={open} onOpenChange={(next) => {
      setOpen(next);
      setQuery("");
      if (next) { setPage(executionControls && currentModel ? "effort" : "catalog"); setScope(currentProvider); loadScope(currentProvider); }
      else { ++requestSequence.current; setLoading(false); }
    }}>
      <PopoverTrigger asChild>
        <button type="button" disabled={disabled} aria-label={`${t("models.models")} · ${currentLabel} · ${providerById(currentProvider).name}`}
          className={cn("composer-model-trigger titlebar-no-drag inline-flex max-w-[260px] min-w-0 items-center gap-2 rounded-full bg-transparent px-2 ui-control text-text-secondary transition-colors duration-[var(--motion-fast)] hover:bg-[var(--accent-muted)] hover:text-text-primary disabled:opacity-40", executionControls ? "composer-control" : "h-8")}>
          <span className="relative inline-flex shrink-0">
            <span className={cn("inline-flex", orbit && "opacity-0")}>{currentModel ? <ModelIcon modelId={currentModel} provider={currentProvider} size={executionControls ? 16 : 20} /> : <ProviderIcon id={currentProvider} size={executionControls ? 16 : 20} />}</span>
            {orbit ? <ProviderOrbitSwap key={orbit.key} from={orbit.from} to={orbit.to} size={executionControls ? 16 : 20} onDone={() => setOrbit(null)} /> : null}
          </span>
          <span className="truncate">{currentLabel}</span>
          {executionControls && execution.fast ? <Zap size={12} fill="currentColor" aria-label={t("composer.fast")} /> : null}
          <ChevronDown size={12} aria-hidden="true" className="shrink-0 text-text-muted" />
        </button>
      </PopoverTrigger>
      <PopoverContent side="top" sideOffset={6} align={executionControls ? "center" : "start"} aria-label={t("models.models")} style={{ width: executionControls && page === "effort" ? 280 : 288, maxWidth: "calc(100vw - 20px)" }} className="max-h-[var(--radix-popover-content-available-height)] max-w-[calc(100vw-20px)] overflow-auto p-0" onKeyDown={navigate}
        onOpenAutoFocus={(event) => { event.preventDefault(); if (executionControls && currentModel) browseButton.current?.focus(); else search.current?.focus(); }}>
        {executionControls && page === "effort" ? <ModelEffortPanel provider={currentProvider} model={currentModel} label={currentLabel} disabled={disabled} onSelect={onSelect} onBrowse={() => setPage("catalog")} /> : <>
        {executionControls && currentModel ? <button ref={browseButton} type="button" onClick={() => setPage("effort")} className="flex w-full items-center gap-1 border-b border-border-subtle px-3 py-2 text-text-secondary hover:bg-background-3"><ChevronLeft size={14} />{t("composer.backEffort")}</button> : null}
        <div className="flex h-[320px] max-h-[var(--radix-popover-content-available-height,320px)] flex-col">
          <div ref={rail} role="group" aria-label={t("providers.title")} className="model-tabs">
            <span ref={glide} className="model-tabs-glide" aria-hidden="true" />
            <button type="button" data-provider-option="favorites" disabled={disabled} aria-label={t("models.favorites")} aria-pressed={scope === "favorites"} aria-controls={panelId}
              className="model-tab" onPointerEnter={() => browse("favorites")} onFocus={() => browse("favorites")} onClick={() => browse("favorites")}>
              <Star size={14} aria-hidden="true" fill={scope === "favorites" ? "currentColor" : "none"} className="model-tab-star" />
            </button>
            {enabledProviders.map((provider) => (
              <button key={provider} type="button" data-provider-option={provider} disabled={disabled}
                aria-label={providerById(provider).name} aria-pressed={scope === provider} aria-controls={panelId}
                className="model-tab" onPointerEnter={() => browse(provider)} onFocus={() => browse(provider)} onClick={() => browse(provider)}>
                <ProviderIcon id={provider} size={15} className="bg-transparent" />
              </button>
            ))}
          </div>
          <p className="px-3 ui-caption text-text-muted">{scope === "favorites" ? t("models.favorites") : providerById(scope).name}</p>
          <div id={panelId} className="flex min-h-0 min-w-0 flex-1 flex-col" role="group" aria-label={scope === "favorites" ? t("models.favorites") : providerById(scope).name}>
            <div className="mx-1.5 mb-0.5 mt-1.5 flex h-7 shrink-0 items-center gap-2 rounded-[var(--radius-md)] border border-border-default bg-background-1 px-2 text-text-muted transition-colors duration-[var(--motion-fast)] focus-within:border-text-muted focus-within:ring-2 focus-within:ring-[var(--accent-muted)]">
              <Search size={13} aria-hidden="true" className="shrink-0" />
              <input ref={search} value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t("models.search")} aria-label={t("models.search")}
                className="h-full min-w-0 flex-1 border-0 bg-transparent ui-control text-text-primary outline-none placeholder:text-text-muted focus-visible:outline-none" />
              {query ? <button type="button" aria-label={t("Clear search")} onClick={() => { setQuery(""); search.current?.focus(); }} className="flex size-5 shrink-0 items-center justify-center rounded text-text-muted hover:text-text-primary"><X size={12} aria-hidden="true" /></button> : null}
            </div>
            <motion.div ref={panel} key={scope} className="scroll-thin min-h-0 flex-1 overflow-y-auto p-1" aria-busy={loading}
              initial={reducedMotion ? false : { opacity: 0, x: 4 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: reducedMotion ? 0 : motionTokens.fast, ease: motionTokens.ease }}>
              {rows.length ? rows.map((row) => (
                <ModelOption key={modelKey(row.provider, row.model.id)} row={row} locale={settings.locale} disabled={disabled}
                  showProvider={scope === "favorites"} selected={row.provider === currentProvider && row.variantIds.includes(currentModel ?? "")}
                  onSelect={() => select(row)} onFavorite={() => {
                    for (const id of row.favorite ? row.favoriteModelIds : [row.model.id]) toggleFavorite(row.provider, id);
                  }} />
              )) : <div className="px-2 py-4 ui-control text-text-muted">
                <p role="status">{t(loading ? "models.loading" : query.trim() ? "models.noMatches" : scope === "favorites" ? "models.noFavorites" : enabledProviders.length ? "models.noProviderModels" : "providers.noInstalled")}</p>
                {!loading && !query.trim() && scope !== "favorites" ? <button type="button" onClick={manageProviders} className="mt-3 rounded px-1 py-1 text-text-secondary hover:text-text-primary">{t("models.manage")}</button> : null}
              </div>}
            </motion.div>
          </div>
        </div>
        </>}
      </PopoverContent>
    </Popover>
  );
}

function ModelOption({ row, locale, selected, disabled, showProvider, onSelect, onFavorite }: {
  row: ModelChoice;
  locale: Locale;
  selected: boolean;
  disabled: boolean;
  showProvider: boolean;
  onSelect: () => void;
  onFavorite: () => void;
}) {
  const t = (key: string) => translate(locale, key);
  return (
    <div className={cn("group flex items-center gap-1 rounded-[7px] hover:bg-background-3 focus-within:bg-background-3", selected && "bg-background-3")}>
      <button type="button" disabled={disabled} data-model-option aria-pressed={selected}
        onClick={onSelect} className="flex min-h-7 min-w-0 flex-1 items-center gap-2 px-2 py-1 text-left disabled:opacity-40">
        {showProvider ? <ProviderIcon id={row.provider} size={18} /> : null}
        <span className="min-w-0"><span className="block truncate ui-control text-text-primary">{row.displayName.replace(/^Claude\s+/i, "")}</span>
          {showProvider ? <span className="block truncate ui-description text-text-muted">{providerById(row.provider).name}</span> : null}
        </span>
        {selected ? <Check size={13} aria-hidden="true" className="ml-auto shrink-0 text-text-secondary" /> : null}
      </button>
      <FavoriteStar favorite={row.favorite} alwaysVisible label={`${row.favorite ? t("models.unfavorite") : t("models.favorite")} · ${row.displayName} · ${providerById(row.provider).name}`} onToggle={onFavorite} />
    </div>
  );
}
