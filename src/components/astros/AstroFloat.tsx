import { useEffect, useState } from "react";
import { MotionConfig } from "motion/react";
import { client } from "@/client";
import { AstroDrawer } from "@/components/astros/AstroDrawer";
import { ErrorToast } from "@/components/ErrorToast";
import { ExternalLink } from "@/components/icons/phosphor";
import { SessionPane } from "@/components/SessionPane";
import { TopToastStack } from "@/components/TopToastStack";
import { useTranslation } from "@/i18n/use-translation";
import { dismissAppSplash } from "@/lib/app-splash";
import { motionTokens } from "@/lib/motion";
import { applyAppearance } from "@/lib/settings";
import { useMotionPreferences } from "@/lib/use-motion-preferences";
import { useRetainedTranscripts } from "@/lib/use-retained-transcripts";
import { useSystemPalette } from "@/lib/use-system-palette";
import { InteractiveButton } from "@/primitives/InteractiveButton";
import { TooltipProvider } from "@/primitives/Tooltip";
import { bindRealtime, useAppStore } from "@/store/app-store";
import "@/styles/astros.css";

/**
 * The floating Astro chat opened from the menu bar (ADR-088): the Astro's own
 * conversation over the same state as the main window, with approvals, questions,
 * attachments and stop, and a way back to the full window.
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
  useEffect(() => {
    let stop: (() => void) | undefined;
    let cancelled = false;
    void client.onAstroFloatSelect(setAstroId).then((unlisten) => { if (cancelled) unlisten(); else stop = unlisten; });
    return () => { cancelled = true; stop?.(); };
  }, []);
  // Opening creates the conversation the first time and selects it here only.
  useEffect(() => { if (ready && !selected) void useAppStore.getState().openAstro(astroId); }, [ready, astroId, selected]);

  const store = useAppStore.getState;
  return <MotionConfig reducedMotion={reducedMotion ? "always" : "never"} transition={{ duration: reducedMotion ? 0 : motionTokens.fast, ease: motionTokens.ease }}>
    <TooltipProvider>
      <div className="astro-float">
        <div className="astro-float-bar">
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
        <AstroDrawer />
        <TopToastStack><ErrorToast /></TopToastStack>
      </div>
    </TooltipProvider>
  </MotionConfig>;
}
