import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import type { Astro, AstroIconId, AstroInput, AstroStyle } from "@/client/types";
import { Drawer, DrawerContent } from "@/components/arc/drawer/drawer";
import { AstroIcon } from "@/components/astros/AstroArt";
import { HabitsTab, MemoryTab } from "@/components/astros/AstroPanel";
import { ModelSelector } from "@/components/ModelSelector";
import { ProjectGlyph } from "@/components/ProjectGlyph";
import { ChevronDown, ChevronLeft, ChevronRight, Gauge, Plus, RotateCcw, Trash2, X } from "@/components/icons/phosphor";
import { useTranslation } from "@/i18n/use-translation";
import { ASTRO_COLORS, ASTRO_ICONS, ASTRO_STYLES } from "@/lib/astro-art";
import { cn } from "@/lib/cn";
import { modelExecutionControls } from "@/lib/execution-options";
import { motionTokens } from "@/lib/motion";
import { modelKey } from "@/lib/settings";
import { useMotionPreferences } from "@/lib/use-motion-preferences";
import { ConfirmDialog } from "@/primitives/ConfirmDialog";
import { Dropdown, DropdownContent, DropdownItem, DropdownTrigger } from "@/primitives/Dropdown";
import { IconButton } from "@/primitives/IconButton";
import { type AstroDrawerPage, useAppStore } from "@/store/app-store";
import "@/styles/astros.css";

const input = (astro: Astro): AstroInput => ({ id: astro.id, name: astro.name, icon: astro.icon, style: astro.style, color: astro.color, background: astro.background, projectIds: astro.projectIds, soul: astro.soul });

/**
 * An Astro's details (ADR-069), after MonoCode's Mono drawer: look, model and
 * effort, projects, then Soul, Habits and Memory pages, with New conversation
 * at the bottom. Every change saves as it is made.
 */
export function AstroDrawer() {
  const t = useTranslation();
  const drawer = useAppStore((state) => state.astroDrawer);
  const astro = useAppStore((state) => drawer ? state.astros?.find((item) => item.id === drawer.astroId) ?? null : null);
  const reduced = useMotionPreferences();
  // The last Astro stays rendered while the drawer slides out.
  const [last, setLast] = useState<Astro | null>(null);
  if (astro && astro !== last) setLast(astro);
  const shown = astro ?? last;
  const page = drawer?.page ?? "main";
  const go = (next: AstroDrawerPage) => shown && useAppStore.getState().setAstroDrawer({ astroId: shown.id, page: next });
  const titles: Record<AstroDrawerPage, string> = { main: t("astros.details"), soul: t("astros.soul"), habits: t("astros.habits"), memory: t("astros.memory") };
  return <Drawer open={Boolean(drawer && astro)} onOpenChange={(open) => { if (!open) useAppStore.getState().setAstroDrawer(null); }}>
    <DrawerContent title={titles[page]} side="right" className="astro-drawer" style={shown ? { "--astro": shown.color } as React.CSSProperties : undefined}>
      {shown ? <AnimatePresence mode="popLayout" initial={false}>
        <motion.div key={page} className="astro-drawer-page"
          initial={reduced ? { opacity: 0 } : { opacity: 0, x: page === "main" ? -24 : 24 }}
          animate={{ opacity: 1, x: 0 }}
          exit={reduced ? { opacity: 0 } : { opacity: 0, x: page === "main" ? 24 : -24 }}
          transition={{ duration: motionTokens.fast, ease: motionTokens.ease }}>
          {page === "main" ? <MainPage astro={shown} go={go} /> : <>
            <button type="button" className="astro-drawer-back ui-control" onClick={() => go("main")}><ChevronLeft size={14} />{t("astros.details")}</button>
            {page === "soul" ? <SoulPage astro={shown} /> : page === "habits" ? <HabitsTab astro={shown} /> : <MemoryTab astro={shown} />}
          </>}
        </motion.div>
      </AnimatePresence> : null}
    </DrawerContent>
  </Drawer>;
}

/** Saves a change now, or after typing settles for text fields. */
function useAstroSave(astro: Astro) {
  const timer = useRef<number | undefined>(undefined);
  const pending = useRef<Partial<AstroInput>>({});
  useEffect(() => () => window.clearTimeout(timer.current), []);
  return (change: Partial<AstroInput>, delay = 0) => {
    pending.current = { ...pending.current, ...change };
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      const current = useAppStore.getState().astros?.find((item) => item.id === astro.id);
      if (!current) return;
      const next = { ...input(current), ...pending.current };
      pending.current = {};
      if (next.name.trim()) void useAppStore.getState().saveAstro({ ...next, name: next.name.trim() });
    }, delay);
  };
}

function MainPage({ astro, go }: { astro: Astro; go: (page: AstroDrawerPage) => void }) {
  const t = useTranslation();
  const save = useAstroSave(astro);
  const [name, setName] = useState(astro.name);
  const [confirm, setConfirm] = useState<"reset" | "delete" | null>(null);
  const projects = useAppStore((state) => state.projects);
  const habits = useAppStore((state) => state.automations?.automations.filter((item) => item.astroId === astro.id).length ?? 0);
  useEffect(() => { if (!useAppStore.getState().automations) void useAppStore.getState().automationAction({ type: "list" }); }, []);
  const owned = projects.filter((project) => astro.projectIds.includes(project.id));
  const others = projects.filter((project) => !astro.projectIds.includes(project.id));
  const custom = !ASTRO_COLORS.includes(astro.color as never);
  return <div className="flex flex-col">
    <section className="astro-drawer-identity">
      <AstroIcon icon={astro.icon} style={astro.style} color={astro.color} size={80} />
      <input className="astro-drawer-name ui-section" value={name} maxLength={40} aria-label={t("astros.name")}
        onChange={(event) => { setName(event.target.value); save({ name: event.target.value }, 500); }}
        onBlur={() => { if (!name.trim()) setName(astro.name); }} />
      <div className="astro-segmented" role="group" aria-label={t("astros.style")}>
        {ASTRO_STYLES.map((style: AstroStyle) => <button key={style} type="button" aria-pressed={astro.style === style} onClick={() => save({ style })}>{t(`astros.style.${style}`)}</button>)}
      </div>
      <div className="astro-drawer-icons" role="radiogroup" aria-label={t("astros.icon")}>
        {ASTRO_ICONS.map((icon: AstroIconId) => <button key={icon} type="button" role="radio" aria-checked={astro.icon === icon} title={t(`astros.icon.${icon}`)} aria-label={t(`astros.icon.${icon}`)} className="astro-drawer-icon" onClick={() => save({ icon })}>
          <AstroIcon icon={icon} style={astro.style} color={astro.color} size={28} />
        </button>)}
      </div>
      <div className="astro-drawer-colors" role="radiogroup" aria-label={t("astros.color")}>
        {ASTRO_COLORS.map((color) => <button key={color} type="button" role="radio" aria-checked={astro.color === color} aria-label={color} className="astro-swatch" style={{ background: color }} onClick={() => save({ color })} />)}
        <label className={cn("astro-swatch astro-swatch-custom", custom && "astro-swatch-chosen")} title={t("astros.customColor")}>
          <input type="color" value={astro.color} aria-label={t("astros.customColor")} onChange={(event) => save({ color: event.target.value }, 250)} />
        </label>
      </div>
    </section>
    <section className="astro-drawer-fields">
      <ModelRow astro={astro} />
      <div className="astro-drawer-field">
        <span className="ui-control text-text-muted">{t("astros.projects")}</span>
        <div className="flex min-w-0 flex-col gap-1">
          {owned.map((project) => <span key={project.id} className="astro-drawer-project ui-control">
            <ProjectGlyph project={project} size={15} /><span className="min-w-0 flex-1 truncate">{project.name}</span>
            {owned.length > 1 ? <IconButton label={t("astros.removeProject")} onClick={() => save({ projectIds: astro.projectIds.filter((id) => id !== project.id) })}><X size={12} /></IconButton> : null}
          </span>)}
          {others.length ? <Dropdown>
            <DropdownTrigger asChild><button type="button" className="astro-drawer-add ui-control"><Plus size={13} />{t("astros.addProject")}</button></DropdownTrigger>
            <DropdownContent align="start">
              {others.map((project) => <DropdownItem key={project.id} icon={<ProjectGlyph project={project} size={14} />} onSelect={() => save({ projectIds: [...astro.projectIds, project.id] })}>{project.name}</DropdownItem>)}
            </DropdownContent>
          </Dropdown> : null}
        </div>
      </div>
    </section>
    <section className="astro-drawer-links">
      <LinkRow title={t("astros.soul")} hint={astro.soul.trim().split("\n").find((line) => line.trim() && !line.startsWith("#")) ?? t("astros.soulHintShort")} onClick={() => go("soul")} />
      <LinkRow title={t("astros.habits")} hint={t("astros.habitsShort")} count={habits} onClick={() => go("habits")} />
      <LinkRow title={t("astros.memory")} hint={t("astros.memoryShort")} count={astro.memory.length} onClick={() => go("memory")} />
    </section>
    <section className="astro-drawer-footer">
      <button type="button" className="astro-drawer-danger" onClick={() => setConfirm("reset")}>
        <span className="ui-control"><RotateCcw size={13} />{t("astros.reset")}</span>
        <span className="ui-caption text-text-muted">{t("astros.resetShort")}</span>
      </button>
      <button type="button" className="astro-drawer-danger" onClick={() => setConfirm("delete")}>
        <span className="ui-control"><Trash2 size={13} />{t("astros.delete")}</span>
      </button>
    </section>
    <ConfirmDialog open={confirm !== null} onOpenChange={(open) => { if (!open) setConfirm(null); }} destructive
      title={t(confirm === "delete" ? "astros.deleteTitle" : "astros.resetTitle", { name: astro.name })}
      description={t(confirm === "delete" ? "astros.deleteBody" : "astros.resetBody")}
      confirmLabel={t(confirm === "delete" ? "astros.delete" : "astros.reset")} cancelLabel={t("common.cancel")}
      onConfirm={async () => {
        const store = useAppStore.getState();
        if (confirm === "delete") { store.setAstroDrawer(null); await store.deleteAstro(astro.id); }
        else await store.resetAstro(astro.id);
        setConfirm(null);
      }} />
  </div>;
}

/** The Astro's provider/model and, when the model offers it, its effort. */
function ModelRow({ astro }: { astro: Astro }) {
  const t = useTranslation();
  const session = useAppStore((state) => state.sessions.find((item) => item.id === astro.sessionId) ?? null);
  const catalogs = useAppStore((state) => state.modelsByProvider);
  const settings = useAppStore((state) => state.settings);
  if (!session) return null;
  const busy = ["starting", "running", "waiting"].includes(session.status);
  const key = session.model ? modelKey(session.agent, session.model) : null;
  const controls = modelExecutionControls(session.agent, session.model ?? null, catalogs[session.agent]?.models ?? [], key ? settings.modelExecution[key] : undefined);
  const setEffort = (effort: string) => {
    if (!key) return;
    const state = useAppStore.getState();
    void state.saveSettings({ ...state.settings, modelExecution: { ...state.settings.modelExecution, [key]: { ...state.settings.modelExecution[key], effort } } });
  };
  return <>
    <div className="astro-drawer-field">
      <span className="ui-control text-text-muted">{t("astros.model")}</span>
      <ModelSelector currentProvider={session.agent} currentModel={session.model ?? null} disabled={busy} onSelect={(provider, model) => void useAppStore.getState().setSessionModel(provider, model, session.id)} />
    </div>
    {controls.selectableLevels.length > 1 && !controls.variants.length ? <div className="astro-drawer-field">
      <span className="ui-control text-text-muted">{t("astros.variant")}</span>
      <Dropdown>
        <DropdownTrigger asChild><button type="button" disabled={busy} className="astro-drawer-select ui-control"><Gauge size={14} />{controls.effort ? t(`effort.${controls.effort}`) : t("composer.effortAuto")}<ChevronDown size={11} /></button></DropdownTrigger>
        <DropdownContent align="start">
          {controls.selectableLevels.map((level) => <DropdownItem key={level} icon={<Gauge size={14} />} onSelect={() => setEffort(level)}>{t(`effort.${level}`)}</DropdownItem>)}
        </DropdownContent>
      </Dropdown>
    </div> : null}
  </>;
}

function LinkRow({ title, hint, count, onClick }: { title: string; hint: string; count?: number; onClick: () => void }) {
  return <button type="button" className="astro-drawer-link" onClick={onClick}>
    <span className="min-w-0 flex-1 text-left">
      <span className="block ui-control text-text-primary">{title}</span>
      <span className="block truncate ui-caption text-text-muted">{hint}</span>
    </span>
    {count !== undefined ? <span className="ui-caption tabular-nums text-text-muted">{count}</span> : null}
    <ChevronRight size={14} className="text-text-muted" />
  </button>;
}

function SoulPage({ astro }: { astro: Astro }) {
  const t = useTranslation();
  const save = useAstroSave(astro);
  const [soul, setSoul] = useState(astro.soul);
  return <div className="flex flex-col gap-2">
    <p className="ui-caption text-text-muted">{t("astros.soulHint")}</p>
    <textarea className="automation-control ui-control astro-drawer-soul font-mono" value={soul} maxLength={16000} spellCheck={false} placeholder={t("astros.soulPlaceholder")}
      onChange={(event) => { setSoul(event.target.value); save({ soul: event.target.value }, 600); }} />
  </div>;
}
