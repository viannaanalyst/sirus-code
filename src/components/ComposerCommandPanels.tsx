import { useState } from "react";
import type { Session } from "@/client/types";
import { Dialog, DialogContent } from "@/components/arc/dialog/dialog";
import { Input } from "@/components/arc/input/input";
import { X } from "@/components/icons/phosphor";
import { useTranslation } from "@/i18n/use-translation";
import { providerById } from "@/lib/provider-registry";
import { modelDisplayName } from "@/lib/model-registry";
import { isMcpProvider, serversFor, serverTarget } from "@/lib/mcp-servers";
import { useMcpCatalog } from "@/lib/use-mcp-catalog";
import { InteractiveButton } from "@/primitives/InteractiveButton";
import { useAppStore } from "@/store/app-store";

/** `/rename`: the same rename as the session menu. */
export function RenameSessionDialog({ session, open, onClose }: { session: Session; open: boolean; onClose: () => void }) {
  const t = useTranslation();
  const [title, setTitle] = useState(session.title ?? "");
  // Stays mounted so closing animates; each opening starts from the current title.
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) { setWasOpen(open); if (open) setTitle(session.title ?? ""); }
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    if (busy || !title.trim()) return;
    setBusy(true);
    try { if (await useAppStore.getState().renameSession(session.id, title)) onClose(); } finally { setBusy(false); }
  };
  return <Dialog open={open} onOpenChange={(next) => { if (!next && !busy) onClose(); }}>
    <DialogContent title={t("session.rename")} description={t("session.renameHelp")} className="w-[min(420px,calc(100vw-32px))]">
      <form onSubmit={(event) => { event.preventDefault(); void submit(); }}>
        <div className="mt-4"><Input label={t("session.titleOptional")} autoFocus required maxLength={200} value={title} onChange={(event) => setTitle(event.target.value)} disabled={busy} /></div>
        <div className="mt-5 flex justify-end gap-2">
          <InteractiveButton variant="ghost" disabled={busy} onClick={onClose}>{t("common.cancel")}</InteractiveButton>
          <InteractiveButton type="submit" variant="secondary" loading={busy} disabled={!title.trim()}>{t("common.save")}</InteractiveButton>
        </div>
      </form>
    </DialogContent>
  </Dialog>;
}

/** `/mcp`: the MCP servers this conversation's provider has configured (ADR-075). */
export function ComposerMcpCard({ session, onClose }: { session: Session; onClose: () => void }) {
  const t = useTranslation();
  const provider = providerById(session.agent).name;
  const supported = isMcpProvider(session.agent);
  const { catalog, loading, error } = useMcpCatalog(supported ? session.projectId : null);
  const servers = supported ? serversFor(catalog?.servers ?? [], session.agent) : [];
  const manage = () => { const store = useAppStore.getState(); store.setSettingsSection("mcp"); store.setSettingsOpen(true); onClose(); };
  return <section aria-label={t("mcp.panel.title").replace("{provider}", provider)} className="mx-auto mb-2 w-full max-w-[var(--chat-column-width)] rounded-2xl border border-border-subtle bg-background-2 px-3 py-2" onKeyDown={(event) => { if (event.key === "Escape") { event.stopPropagation(); onClose(); } }}>
    <div className="flex items-center gap-2">
      <span className="flex-1 ui-control text-text-primary">{t("mcp.panel.title").replace("{provider}", provider)}</span>
      <button type="button" className="ui-caption text-text-muted hover:text-text-primary" onClick={manage}>{t("mcp.panel.manage")}</button>
      <button type="button" autoFocus aria-label={t("mcp.panel.close")} className="usage-limit-close" onClick={onClose}><X size={13} aria-hidden="true" /></button>
    </div>
    {!supported ? <p className="mt-1 ui-caption text-text-muted">{t("mcp.panel.unsupported").replace("{provider}", provider)}</p>
      : error ? <p role="alert" className="mt-1 ui-caption text-danger">{error}</p>
      : loading && !catalog ? <p role="status" className="mt-1 ui-caption text-text-muted">{t("mcp.loading")}</p>
      : !servers.length ? <p className="mt-1 ui-caption text-text-muted">{t("mcp.panel.empty").replace("{provider}", provider)}</p>
      : <ul className="scroll-thin mt-1 max-h-48 space-y-0.5 overflow-y-auto">
        {servers.map(server => <li key={`${server.scope}:${server.path}:${server.name}`} className="flex min-w-0 items-baseline gap-2">
          <span className={`shrink-0 ui-caption ${server.enabled ? "text-text-secondary" : "text-text-muted line-through"}`}>{server.name}</span>
          <span className="shrink-0 ui-caption text-text-muted">{t(`mcp.scope.${server.scope}`)} · {server.transport}</span>
          <code className="min-w-0 flex-1 truncate ui-caption text-text-muted selectable" title={serverTarget(server)}>{serverTarget(server)}</code>
        </li>)}
      </ul>}
    {session.agent === "codex" || session.agent === "claude" || session.agent === "opencode" ? <p className="mt-1 ui-caption text-text-muted/70">{t("mcp.panel.builtIn")}</p> : null}
  </section>;
}

/** `/status`: what this conversation runs with, from data the app already has. */
export function ComposerStatusCard({ session, effort, fast, approval, planning, onClose }: { session: Session; effort: string | null; fast: boolean; approval: string; planning: boolean; onClose: () => void }) {
  const t = useTranslation();
  const catalog = useAppStore((state) => state.modelsByProvider[session.agent]?.models);
  const context = session.contextUsage;
  const rows: [string, string][] = [
    [t("commands.status.provider"), providerById(session.agent).name],
    [t("commands.status.model"), session.model ? catalog?.find((model) => model.id === session.model)?.displayName ?? modelDisplayName(session.agent, session.model) : t("commands.status.default")],
    [t("commands.status.account"), session.providerAccountId && session.providerAccountId !== "default" ? session.providerAccountId : t("commands.status.default")],
    [t("commands.status.effort"), [effort ?? t("commands.status.default"), fast ? "Fast" : null].filter(Boolean).join(" · ")],
    [t("commands.status.approval"), [t(approval), planning ? t("composer.planning") : null].filter(Boolean).join(" · ")],
    [t("commands.status.workspace"), `${session.worktree.isolated ? t("workspace.isolated") : t("workspace.checkout")} · ${session.worktree.branch}`],
  ];
  if (context) rows.push([t("commands.status.context"), context.window ? `${Math.round((context.used / context.window) * 100)}% · ${Math.round(context.used / 1000)}K / ${Math.round(context.window / 1000)}K` : `${Math.round(context.used / 1000)}K`]);
  return <section aria-label={t("commands.status.title")} className="mx-auto mb-2 w-full max-w-[var(--chat-column-width)] rounded-2xl border border-border-subtle bg-background-2 px-3 py-2" onKeyDown={(event) => { if (event.key === "Escape") { event.stopPropagation(); onClose(); } }}>
    <div className="flex items-center gap-2">
      <span className="flex-1 ui-control text-text-primary">{t("commands.status.title")}</span>
      <button type="button" autoFocus aria-label={t("commands.status.close")} className="usage-limit-close" onClick={onClose}><X size={13} aria-hidden="true" /></button>
    </div>
    <dl className="mt-1 grid grid-cols-[max-content_1fr] gap-x-4 gap-y-0.5">
      {rows.map(([label, value]) => <div key={label} className="contents"><dt className="ui-caption text-text-muted">{label}</dt><dd className="min-w-0 truncate ui-caption text-text-secondary selectable">{value}</dd></div>)}
    </dl>
  </section>;
}
