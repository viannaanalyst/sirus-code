import { useCallback, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion, type Variants } from "motion/react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { Dialog } from "@/components/arc/dialog/dialog";
import { ErrorToast } from "@/components/ErrorToast";
import { TopToastStack } from "@/components/TopToastStack";
import { ActivityNotifications } from "@/components/ActivityNotifications";
import { useTranslation } from "@/i18n/use-translation";
import type { AgentProviderId } from "@/client/types";
import { SettingsPanels } from "@/components/settings/SettingsPanels";
import { SETTINGS_GROUPS, SettingsSidebar } from "@/components/settings/SettingsSidebar";
import type { SettingsSectionId } from "@/lib/settings";
import { SETTINGS_INDEX } from "@/lib/settings-index";
import { searchSettings, type SettingsMatch } from "@/lib/settings-search";
import { settingsEscapeAction, settingsViewDirection } from "@/lib/settings-navigation";
import { motionTokens } from "@/lib/motion";
import { useSidebarMotion } from "@/lib/sidebar-motion";
import { WindowNavigationControls } from "@/components/WindowNavigationControls";
import { useAppStore } from "@/store/app-store";

// Content moves with the direction of travel through the menu: down the menu rises, up the menu descends.
const viewMotion: Variants = {
  enter: (direction: number) => ({ opacity: 0, y: direction * 22 }),
  shown: { opacity: 1, y: 0, transition: { duration: motionTokens.slow + motionTokens.fast / 2, delay: motionTokens.instant / 2, ease: motionTokens.ease } },
  exit: (direction: number) => ({ opacity: 0, y: direction * -16, transition: { duration: motionTokens.fast, ease: [0.4, 0, 1, 1] } }),
};

/** The page is revealed by a circle born from the rail's Settings gear (bottom-left fallback). */
function setRevealOrigin(node: HTMLElement) {
  const gear = document.querySelector<HTMLElement>('.sidebar-rail-button[data-section="settings"]')?.getBoundingClientRect();
  node.style.setProperty("--settings-origin-x", `${gear ? gear.left + gear.width / 2 : 26}px`);
  node.style.setProperty("--settings-origin-y", `${gear ? gear.top + gear.height / 2 : innerHeight - 26}px`);
}

export function SettingsPage() {
  const t = useTranslation();
  const previousFocus = useRef<HTMLElement | null>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const attachContent = useCallback((node: HTMLDivElement | null) => { contentRef.current = node; if (node) setRevealOrigin(node); }, []);
  const open = useAppStore((state) => state.settingsOpen);
  const section = useAppStore((state) => state.settingsSection);
  const setOpen = useAppStore((state) => state.setSettingsOpen);
  const setSection = useAppStore((state) => state.setSettingsSection);
  const settings = useAppStore((state) => state.settings);
  const saveSettings = useAppStore((state) => state.saveSettings);
  const agents = useAppStore((state) => state.agents);
  const refreshAgents = useAppStore((state) => state.refreshAgents);
  const host = useAppStore((state) => state.hostInfo);
  const sidebarCollapsed = useAppStore((state) => state.sidebarCollapsed);
  // The Settings menu docks like the main sidebar: springs open, eases closed. Its rows cascade
  // in whenever the menu mounts (Settings opening or the dock reopening, ADR-096).
  const [navMotion, endNavMotion] = useSidebarMotion(sidebarCollapsed);
  const [view, setView] = useState({ section, direction: 1 as 1 | -1 });
  // Settings search (ADR-093): results take the page's place while there is a query.
  const [query, setQuery] = useState("");
  const pageName = useCallback((id: SettingsSectionId) => t(SETTINGS_GROUPS.flatMap((group) => group.items).find((item) => item.id === id)?.label ?? id), [t]);
  const matches = useMemo(() => searchSettings(SETTINGS_INDEX, query, t, pageName), [query, t, pageName]);
  const matched = query.trim() ? new Set(matches.map((match) => match.entry.section)) : null;
  const openMatch = (match: SettingsMatch) => {
    setQuery("");
    setSection(match.entry.section);
    // After the page slides in: bring the row into view and flash it.
    window.setTimeout(() => {
      const row = [...(contentRef.current?.querySelectorAll<HTMLElement>(".settings-row") ?? [])].find((node) => node.querySelector("p")?.textContent?.trim() === match.title);
      if (!row) return;
      row.scrollIntoView({ block: "center", behavior: "smooth" });
      row.classList.remove("settings-row-found");
      void row.offsetWidth;
      row.classList.add("settings-row-found");
    }, 380);
  };
  if (view.section !== section) setView({ section, direction: settingsViewDirection(view.section, section) });

  const back = () => {
    setOpen(false);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
    <DialogPrimitive.Portal>
    <DialogPrimitive.Content ref={attachContent} aria-describedby={undefined}
      onOpenAutoFocus={(event) => {
        previousFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        event.preventDefault();
        const target = contentRef.current?.querySelector<HTMLButtonElement>("[data-settings-back]") ?? contentRef.current;
        target?.focus({ preventScroll: true });
      }}
      onEscapeKeyDown={(event) => {
        const focused = document.activeElement;
        const action = settingsEscapeAction(focused instanceof HTMLElement && focused.matches("[data-shortcut-recording='true']"));
        if (action === "close") return;
        event.preventDefault();
        // The recorder's local bubble handler owns cancellation and its announcement.
      }}
      onCloseAutoFocus={(event) => { event.preventDefault(); if (previousFocus.current?.isConnected) previousFocus.current.focus({ preventScroll: true }); }}
      className="settings-material fixed inset-0 z-40 flex text-text-primary max-md:flex-col">
      <DialogPrimitive.Title className="sr-only">{t("Settings")}</DialogPrimitive.Title>
      <WindowNavigationControls />
      {(!sidebarCollapsed || navMotion === "closing") && <div className="settings-nav-frame" data-motion={navMotion ?? undefined} data-collapsed={sidebarCollapsed || undefined} inert={sidebarCollapsed}
        onTransitionEnd={(event) => { if (event.target === event.currentTarget && event.propertyName === "width") endNavMotion(); }}>
        <SettingsSidebar section={section} onSection={(id) => { setQuery(""); setSection(id); }} onBack={back} query={query} onQuery={setQuery} matched={matched} />
      </div>}
      <div className="settings-main-material flex min-h-0 min-w-0 flex-1 flex-col">
        <div data-tauri-drag-region className="titlebar-drag h-[var(--window-controls-height)] shrink-0" />
        <div className="scroll-thin min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto w-full max-w-[780px] px-8 py-6 max-md:px-5">
            <AnimatePresence mode="wait" custom={view.direction}>
            {query.trim() ? <motion.div key="search" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.16 }}>
              <SettingsSearchResults query={query} matches={matches} pageName={pageName} onOpen={openMatch} />
            </motion.div> :
            <motion.div key={section} custom={view.direction} variants={viewMotion} initial="enter" animate="shown" exit="exit">
            <SettingsPanels
              section={section}
              settings={settings}
              agents={agents}
              host={host}
              onSave={(next) => void saveSettings(next)}
              onRefresh={() => void refreshAgents()}
            />
            </motion.div>}
            </AnimatePresence>
          </div>
        </div>
      </div>
      <TopToastStack><ErrorToast /></TopToastStack>
      <ActivityNotifications />
    </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
    </Dialog>
  );
}

export type { AgentProviderId };

/** Search results: each matching setting with its page and group; opening goes to the row. */
function SettingsSearchResults({ query, matches, pageName, onOpen }: { query: string; matches: SettingsMatch[]; pageName: (id: SettingsSectionId) => string; onOpen: (match: SettingsMatch) => void }) {
  const t = useTranslation();
  return <section aria-label={t("settingsSearch.results", { count: matches.length, query: query.trim() })}>
    <h2 className="ui-title text-text-primary">{t(matches.length === 1 ? "settingsSearch.resultsOne" : "settingsSearch.results", { count: matches.length, query: query.trim() })}</h2>
    {matches.length ? <div className="settings-search-results">
      {matches.map((match) => <button key={`${match.entry.section}:${match.entry.title}`} type="button" className="settings-search-result" onClick={() => onOpen(match)}>
        <span className="settings-search-path">{[pageName(match.entry.section), match.group].filter(Boolean).join(" › ")}</span>
        <span className="settings-search-title"><Highlight text={match.title} query={query} /></span>
        {match.description ? <span className="settings-search-description"><Highlight text={match.description} query={query} /></span> : null}
      </button>)}
    </div> : <p className="mt-4 ui-body text-text-muted">{t("settingsSearch.none")}</p>}
  </section>;
}

function Highlight({ text, query }: { text: string; query: string }) {
  const words = query.trim().split(/\s+/).filter(Boolean).map((word) => word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  if (!words.length) return text;
  const parts = text.split(new RegExp(`(${words.join("|")})`, "gi"));
  return <>{parts.map((part, index) => index % 2 ? <mark key={index}>{part}</mark> : part)}</>;
}
