import { useEffect, useRef, useState } from "react";
import { ImagePlus, X } from "@/components/icons/phosphor";
import type { Project } from "@/client/types";
import { ProjectGlyph, PROJECT_COLORS } from "@/components/ProjectGlyph";
import { useTranslation } from "@/i18n/use-translation";
import { cn } from "@/lib/cn";
import { Popover, PopoverContent, PopoverTrigger } from "@/primitives/Popover";
import { useAppStore } from "@/store/app-store";

const EMOJIS = ["🚀", "⚡", "🔥", "✨", "🌱", "🌊", "🎯", "🧠", "💡", "🛠️", "⚙️", "🧪", "📦", "📱", "💻", "🖥️", "🌐", "🔒", "🔑", "💳", "💰", "📊", "📈", "🗂️", "📝", "📚", "🎨", "🎵", "🎮", "🏠", "🏥", "🩺", "⚖️", "🛒", "🍔", "☕", "🚂", "🐙", "🦊", "🐝", "🐳", "🦄", "🌙", "☀️", "⭐", "❤️", "🟢", "🔷"];
const ORDER = ["blue", "red", "yellow", "green", "pink", "purple", "teal", "orange"];

/** Project logo, emoji and folder colour (ADR-059). Each change applies at once. */
export function ProjectLookEditor({ projectId }: { projectId: string }) {
  const t = useTranslation();
  const project = useAppStore((state) => state.projects.find((row) => row.id === projectId));
  const update = useAppStore((state) => state.updateProjectLook);
  const [busy, setBusy] = useState(false);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  if (!project) return null;
  const look = project.look ?? {};
  const run = (action: Parameters<typeof update>[0]) => { setBusy(true); void update(action).finally(() => setBusy(false)); };
  const setEmoji = (emoji: string | null) => { setEmojiOpen(false); setTyped(""); run({ type: "setEmoji", projectId, emoji }); };
  const custom = look.color && !PROJECT_COLORS[look.color] ? look.color : null;
  return <div className="project-look">
    <div className="project-look-icon">
      <button type="button" className="project-look-logo" disabled={busy} aria-label={t("projectLook.pickLogo")} onClick={() => run({ type: "pickLogo", projectId })}>
        {look.logo || look.emoji ? <ProjectGlyph project={project as Project} size={28} /> : <ImagePlus size={22} aria-hidden="true" />}
      </button>
      <div className="min-w-0 flex-1">
        <p className="ui-control text-text-secondary">{t("projectLook.logo")}</p>
        <p className="ui-caption text-text-muted">{t("projectLook.logoHelp")}</p>
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          <Popover open={emojiOpen} onOpenChange={setEmojiOpen}>
            <PopoverTrigger asChild><button type="button" className="project-look-chip ui-caption" disabled={busy}>{look.emoji ? `${look.emoji} ${t("projectLook.changeEmoji")}` : t("projectLook.emoji")}</button></PopoverTrigger>
            <PopoverContent side="bottom" align="start" className="z-[60] w-[268px] p-2" aria-label={t("projectLook.emoji")}>
              <div className="project-look-emojis">{EMOJIS.map((emoji) => <button key={emoji} type="button" aria-label={emoji} onClick={() => setEmoji(emoji)}>{emoji}</button>)}</div>
              <form className="mt-2 flex gap-1.5" onSubmit={(event) => { event.preventDefault(); if (typed.trim()) setEmoji(typed.trim()); }}>
                <input value={typed} onChange={(event) => setTyped(event.target.value)} placeholder={t("projectLook.typeEmoji")} aria-label={t("projectLook.typeEmoji")} className="project-look-input ui-control" maxLength={16} />
                <button type="submit" className="project-look-chip ui-caption" disabled={!typed.trim()}>OK</button>
              </form>
            </PopoverContent>
          </Popover>
          {look.logo ? <button type="button" className="project-look-chip ui-caption" disabled={busy} onClick={() => run({ type: "clearLogo", projectId })}><X size={11} aria-hidden="true" />{t("projectLook.removeLogo")}</button> : null}
          {look.emoji ? <button type="button" className="project-look-chip ui-caption" disabled={busy} onClick={() => setEmoji(null)}><X size={11} aria-hidden="true" />{t("projectLook.removeEmoji")}</button> : null}
        </div>
      </div>
    </div>
    <div className="project-look-colors" role="radiogroup" aria-label={t("projectLook.color")}>
      <button type="button" role="radio" aria-checked={!look.color} aria-label={t("projectLook.defaultColor")} className="project-look-swatch" style={{ background: PROJECT_COLORS.gray }} onClick={() => run({ type: "setColor", projectId, color: null })} />
      {ORDER.map((id) => <button key={id} type="button" role="radio" aria-checked={look.color === id} aria-label={t(`projectLook.colors.${id}`)} className="project-look-swatch" style={{ background: PROJECT_COLORS[id] }} onClick={() => run({ type: "setColor", projectId, color: id })} />)}
      <label className={cn("project-look-swatch project-look-custom", custom && "project-look-custom-on")} aria-label={t("projectLook.customColor")} style={custom ? { background: custom } : undefined}>
        <input type="color" value={custom ?? "#888888"} aria-label={t("projectLook.customColor")} onChange={(event) => {
          const value = event.target.value;
          // The system colour panel reports every move; save once it settles.
          if (timer.current) clearTimeout(timer.current);
          timer.current = setTimeout(() => run({ type: "setColor", projectId, color: value }), 300);
        }} />
      </label>
    </div>
  </div>;
}
