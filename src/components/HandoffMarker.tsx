import { useLayoutEffect, useRef } from "react";
import type { AgentProviderId } from "@/client/types";
import { ChevronRight } from "@/components/icons/phosphor";
import { ProviderIcon } from "@/components/settings/ProviderIcon";
import { useTranslation } from "@/i18n/use-translation";
import { providerById } from "@/lib/provider-registry";
import { takeHandoffCard } from "@/lib/provider-switch";
import { useMotionPreferences } from "@/lib/use-motion-preferences";

/**
 * A thin transcript divider where another provider answered. For the reply a
 * pending handoff card was just sent with, the card flies from above the
 * composer into this marker and its rules draw outward.
 */
export function HandoffMarker({ sessionId, from, to, live }: { sessionId: string; from: AgentProviderId; to: AgentProviderId; live: boolean }) {
  const t = useTranslation();
  const reduced = useMotionPreferences();
  const pill = useRef<HTMLSpanElement>(null);
  const rules = useRef<HTMLSpanElement[]>([]);
  useLayoutEffect(() => {
    const target = pill.current;
    const card = live ? takeHandoffCard(sessionId) : null;
    if (!target || !card || reduced) return;
    const end = target.getBoundingClientRect();
    const ghost = target.cloneNode(true) as HTMLElement;
    Object.assign(ghost.style, { position: "fixed", left: `${card.left}px`, top: `${card.top}px`, width: `${card.width}px`, height: `${card.height}px`, margin: "0", zIndex: "60", pointerEvents: "none", justifyContent: "center", transformOrigin: "top left" });
    document.body.append(ghost);
    target.style.opacity = "0";
    const flight = ghost.animate([
      { transform: "none", opacity: 1, borderRadius: "8px" },
      { transform: `translate(${end.left - card.left}px, ${end.top - card.top}px) scale(${end.width / card.width}, ${end.height / card.height})`, opacity: .35, borderRadius: "999px" },
    ], { duration: 520, easing: "cubic-bezier(.65,0,.35,1)" });
    const draws = rules.current.map((rule) => rule.animate([{ transform: "scaleX(0)" }, { transform: "scaleX(1)" }], { duration: 380, delay: 420, easing: "cubic-bezier(.16,1,.3,1)", fill: "backwards" }));
    void flight.finished.then(() => { target.style.opacity = ""; ghost.remove(); }, () => undefined);
    return () => { flight.cancel(); draws.forEach((draw) => draw.cancel()); ghost.remove(); target.style.opacity = ""; };
  }, [sessionId, live, reduced]);
  const rule = (side: "left" | "right") => <span ref={(node) => { if (node) rules.current[side === "left" ? 0 : 1] = node; }} aria-hidden="true"
    className={side === "left" ? "h-px flex-1 origin-right bg-gradient-to-r from-transparent to-[var(--border-default)]" : "h-px flex-1 origin-left bg-gradient-to-l from-transparent to-[var(--border-default)]"} />;
  return <div role="separator" aria-label={t("handoff.tookOver", { provider: providerById(to).name })} className="flex items-center gap-2.5 ui-caption text-text-muted">
    {rule("left")}
    <span ref={pill} className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-border-default bg-background-2 px-2.5 py-0.5">
      <ProviderIcon id={from} size={13} />
      <ChevronRight size={11} aria-hidden="true" />
      <ProviderIcon id={to} size={13} />
      <span>{t("handoff.tookOver", { provider: providerById(to).name })}</span>
    </span>
    {rule("right")}
  </div>;
}
