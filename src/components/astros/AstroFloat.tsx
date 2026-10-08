import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { AnimatePresence, MotionConfig, motion } from "motion/react";
import { client } from "@/client";
import { AstroDrawer } from "@/components/astros/AstroDrawer";
import { AstroFloatRail } from "@/components/astros/AstroFloatRail";
import { ErrorToast } from "@/components/ErrorToast";
import { ExternalLink, PanelLeft } from "@/components/icons/phosphor";
import { SessionPane } from "@/components/SessionPane";
import { QuitToast } from "@/components/QuitToast";
import { TopToastStack } from "@/components/TopToastStack";
import { useTranslation } from "@/i18n/use-translation";
import { useAmbientActive } from "@/lib/ambient-motion";
import { dismissAppSplash } from "@/lib/app-splash";
import { astroFloatCurrent, astroFloatRailMode } from "@/lib/astro-float";
import { motionTokens } from "@/lib/motion";
import { applyAppearance } from "@/lib/settings";
import { useMotionPreferences } from "@/lib/use-motion-preferences";
import { useChatBackground } from "@/lib/use-chat-background";
import { useRetainedTranscripts } from "@/lib/use-retained-transcripts";
import { useSystemPalette } from "@/lib/use-system-palette";
import { IconButton } from "@/primitives/IconButton";
import { InteractiveButton } from "@/primitives/InteractiveButton";
import { TooltipProvider } from "@/primitives/Tooltip";
import { bindRealtime, useAppStore } from "@/store/app-store";
import "@/styles/astros.css";

function subscribeWidth(listener: () => void) {
  window.addEventListener("resize", listener);
  return () => window.removeEventListener("resize", listener);
}
const windowWidth = () => window.innerWidth;
/** Server renders assume the default float size, which keeps the rail beside the chat. */
const defaultWidth = () => 480;

/**
 * The floating Astro chat opened from the menu bar (ADR-088): the Astro's own
 * conversation over the same state as the main window, with approvals, questions,
 * attachments and stop, and a way back to the full window. A rail of Astros
 * switches conversations or creates a new Astro without closing the window.
 */
export default function AstroFloat({ initialAstroId }: { initialAstroId: string }) {
  const t = useTranslation();
  const reducedMotion = useMotionPreferences();
  const systemPalette = useSystemPalette();
  const bootstrap = useAppStore((state) => state.bootstrap);
  const ready = useAppStore((state) => state.ready);
  const settings = useAppStore((state) => state.settings);
  const hostInfo = useAppStore((state) => state.hostInfo);
  const agents = useAppStore((state) => state.agents);
  const [astroId, setAstroId] = useState(initialAstroId);
  const astros = useAppStore((state) => state.astros);
  const focused = useAmbientActive();
  const railMode = astroFloatRailMode(useSyncExternalStore(subscribeWidth, windowWidth, defaultWidth));
  const [railOpen, setRailOpen] = useState(false);
  // While a new Astro is being created its conversation takes the selection; the old one must not reopen.
  const creating = useRef(false);
  const sessionId = useAppStore((state) => state.astros?.find((astro) => astro.id === astroId)?.sessionId ?? null);
  const selected = useAppStore((state) => sessionId !== null && state.selectedSessionId === sessionId);
  useRetainedTranscripts(sessionId ? [sessionId] : []);

  useEffect(() => {
    let cancelled = false;
    let cleanup: (() => void) | undefined;
    void bindRealtime().then((unbind) => {
      if (cancelled) { unbind(); return; }
      cleanup = unbind;
      void bootstrap();
    }).catch((error: unknown) => useAppStore.setState({ ready: true, error: String(error) }));
    return () => { cancelled = true; cleanup?.(); };
  }, [bootstrap]);
  useEffect(() => { if (ready) requestAnimationFrame(dismissAppSplash); }, [ready]);
  useEffect(() => { applyAppearance(settings, hostInfo?.appearanceSupport, systemPalette); }, [settings, hostInfo, systemPalette]);
  useChatBackground(settings.chatBackground, settings.chatBackgroundEffect);
  useEffect(() => {
    let stop: (() => void) | undefined;
    let cancelled = false;
    void client.onAstroFloatSelect(setAstroId).then((unlisten) => { if (cancelled) unlisten(); else stop = unlisten; });
    return () => { cancelled = true; stop?.(); };
  }, []);
  // Opening creates the conversation the first time and selects it here only.
  useEffect(() => { if (ready && !selected && !creating.current) void useAppStore.getState().openAstro(astroId); }, [ready, astroId, selected]);
  useEffect(() => { if (ready && astros === null) void useAppStore.getState().loadAstros(); }, [ready, astros]);
  useEffect(() => { if (railMode === "beside") setRailOpen(false); }, [railMode]);
  useEffect(() => {
    if (!railOpen) return;
    // Focus moves into the rail on its current Astro and returns to the toggle on Escape.
    const frame = requestAnimationFrame(() => document.querySelector<HTMLElement>('#astro-float-rail [aria-current="page"], #astro-float-rail button')?.focus());
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") { setRailOpen(false); document.getElementById("astro-float-rail-toggle")?.focus(); } };
    window.addEventListener("keydown", onKey);
    return () => { cancelAnimationFrame(frame); window.removeEventListener("keydown", onKey); };
  }, [railOpen]);

  // The rail goes through the menu bar's path, which retitles the window and echoes the choice back.
  const select = useCallback((id: string) => {
    setAstroId(id);
    setRailOpen(false);
    void client.astroFloatSelect(id).catch(() => undefined);
  }, []);
  const create = useCallback(async () => {
    if (creating.current) return;
    creating.current = true;
    try {
      const id = await useAppStore.getState().createAstro(t("astros.newName"));
      if (id) select(id);
    } finally { creating.current = false; }
  }, [select, t]);
  // A deleted Astro hands the window to the first one left.
  useEffect(() => {
    const next = astroFloatCurrent(astroId, astros);
    if (next !== astroId) select(next);
  }, [astroId, astros, select]);

  const store = useAppStore.getState;
  return <MotionConfig reducedMotion={reducedMotion ? "always" : "never"} transition={{ duration: reducedMotion ? 0 : motionTokens.fast, ease: motionTokens.ease }}>
    <TooltipProvider>
      <div className="astro-float" data-rail={railMode}>
        {railMode === "beside" && astros ? <AstroFloatRail astros={astros} currentId={astroId} focused={focused} onSelect={select} onCreate={() => void create()} /> : null}
        <AnimatePresence>
          {railMode === "toggle" && railOpen && astros ? <motion.div key="rail" className="astro-float-rail-layer" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <button type="button" className="astro-float-rail-scrim" tabIndex={-1} aria-hidden="true" onClick={() => setRailOpen(false)} />
            <motion.div className="astro-float-rail-sheet" initial={{ x: -16 }} animate={{ x: 0 }} exit={{ x: -16 }}>
              <AstroFloatRail astros={astros} currentId={astroId} focused={focused} overlay onSelect={select} onCreate={() => { setRailOpen(false); void create(); }} />
            </motion.div>
          </motion.div> : null}
        </AnimatePresence>
        <div className="astro-float-main">
          <div className="astro-float-bar">
            {railMode === "toggle" ? <IconButton id="astro-float-rail-toggle" className="mr-auto" label={t(railOpen ? "astros.float.hideRail" : "astros.float.showRail")} aria-expanded={railOpen} aria-controls={railOpen ? "astro-float-rail" : undefined} onClick={() => setRailOpen((open) => !open)}>
              <PanelLeft size={14} />
            </IconButton> : null}
            <InteractiveButton variant="toolbar" disabled={!sessionId} onClick={() => { if (sessionId) void client.astroShowInMain(sessionId); }}>
              <ExternalLink size={13} />{t("astros.float.openInApp")}
            </InteractiveButton>
          </div>
          {selected && sessionId ? <SessionPane
            agents={agents}
            onSend={(prompt, execution) => store().sendPrompt(prompt, execution, sessionId)}
            onStop={() => void store().stopAgent(sessionId)}
            onNewSession={() => void client.astroShowInMain(sessionId)}
            onModelChange={(provider, model) => void store().setSessionModel(provider, model, sessionId)}
          /> : <div className="flex-1" aria-busy="true" />}
        </div>
        <AstroDrawer />
        <TopToastStack><ErrorToast /></TopToastStack>
        <QuitToast />
      </div>
    </TooltipProvider>
  </MotionConfig>;
}
