import { Fragment, useState, type ReactNode } from "react";
import type { AppSettings, Project, Session } from "@/client/types";
import { ProjectIcon } from "@/components/ProjectAvatar";
import { ProviderIcon } from "@/components/settings/ProviderIcon";
import { ArrowUpDown, Clock3, Copy, GitBranch, Moon, Pencil, Pin, PinOff, Trash2, Undo2 } from "@/components/icons";
import { SnoozeCountdown } from "@/components/SnoozePicker";
import { usePhoneTranslation as useTranslation } from "./use-phone-host";
import { environmentLabel, rowActionRoute } from "@/lib/environments";
import { isRemoteUi } from "@/client";
import { rowIndicator, sessionBadge, shortAgo } from "@/lib/mobile";
import { rowDetails, rowMenuItems, type RowMenuId } from "@/lib/phone-home";
import { usePhonePrefs } from "@/lib/phone-prefs";
import { canSnooze } from "@/lib/snooze";
import { toggleSidebarId } from "@/lib/sidebar-layout";
import { useAppStore } from "@/store/app-store";
import { environmentOffline, useEnvironments, type EnvironmentSessionAction } from "@/store/environments-store";
import { useHostLabel } from "./use-phone-host";
import { MobileDeleteDialog, MobileDialog } from "./MobileDialog";
import { MobileRowMenu, type RowMenuEntry } from "./MobileRowMenu";
import { MobileSnoozeSheet } from "./MobileSnoozeSheet";
import { MobileSwipeRow, type SwipeAction } from "./MobileSwipeRow";

const BADGE_KEYS = { approve: "mobile.approve", question: "mobile.question", working: "mobile.workingBadge", failed: "mobile.failed", stopped: "mobile.stopped" } as const;

/**
 * One conversation in a phone list, on two lines (ADR-129): the provider's icon (with a state dot
 * while the agent works, waits on the person or failed), the title and its age; then, muted and
 * under the title, the project, the branch, the pull request when already loaded and the
 * computer when the phone knows several (ADR-132).
 */
export function MobileSessionRow({ session, project, showProject = true, pinned = false, pending = false, marker, onOpen }: { session: Session; project: Project | undefined; showProject?: boolean; pinned?: boolean; /** A change waits for the conversation's computer to come back (ADR-132). */ pending?: boolean; /** Which computer the conversation is on; only passed when the phone knows several. */ marker?: ReactNode; onOpen?: () => void }) {
  const t = useTranslation();
  const locale = useAppStore((state) => state.settings.locale);
  // The pull request's number only when the Mac already looked it up for this branch; never fetched for a row.
  const pullRequest = useAppStore((state) => {
    const snapshot = state.pullRequestsBySession[session.id]?.snapshot;
    return snapshot && snapshot.branch === session.worktree.branch ? snapshot.pullRequest?.number ?? null : null;
  });
  const badge = sessionBadge(session);
  const indicator = rowIndicator(session);
  const details = rowDetails({ projectName: showProject ? project?.name : null, branch: session.worktree?.branch, pullRequest, computer: !!marker });
  return <button type="button" className="mobile-row" data-indicator={indicator ?? undefined} onClick={onOpen}>
    <span className="mobile-row-lead" aria-hidden="true">
      <ProviderIcon id={session.agent} size={16} />
      {indicator ? <span className="mobile-row-dot" data-indicator={indicator} /> : null}
    </span>
    <span className="mobile-row-main">
      <span className="mobile-row-line">
        <span className="mobile-row-title">
          {pinned ? <Pin size={12} fill="currentColor" className="mobile-row-pin" aria-label={t("mobile.pinned")} /> : null}{session.title}
          {badge ? <span className="sr-only">, {t(BADGE_KEYS[badge])}</span> : null}
        </span>
        {pending ? <span className="mobile-row-pending" title={t("environments.pending")}><Clock3 size={11} aria-hidden="true" /><span className="sr-only">{t("environments.pending")}</span></span> : null}
        {session.snoozedUntil ? <span className="mobile-row-time mobile-row-snoozed"><Moon size={11} aria-hidden="true" /><SnoozeCountdown until={session.snoozedUntil} /></span>
          : <span className="mobile-row-time">{shortAgo(session.lastActivityAt, locale)}</span>}
      </span>
      {details.length ? <span className="mobile-row-meta">
        {details.map((detail, index) => <Fragment key={detail.kind}>
          {index ? <span className="mobile-row-meta-dot" aria-hidden="true">·</span> : null}
          {detail.kind === "project" && project ? <span className="mobile-row-meta-item"><ProjectIcon project={project} size={12} /><span>{detail.text}</span></span>
            : detail.kind === "branch" ? <span className="mobile-row-meta-item" title={detail.full}><GitBranch size={12} aria-hidden="true" /><span className="mobile-row-branch">{detail.text}</span></span>
            : detail.kind === "pullRequest" ? <span className="mobile-row-meta-item mobile-row-meta-fixed">{detail.text}</span>
            : detail.kind === "computer" ? marker : null}
        </Fragment>)}
      </span> : null}
    </span>
  </button>;
}

const MENU_ICONS: Record<RowMenuId, ReactNode> = {
  "copy-id": <Copy size={16} />,
  return: <Undo2 size={16} />,
  arrange: <ArrowUpDown size={16} />,
  pin: <Pin size={16} />,
  unpin: <PinOff size={16} />,
  rename: <Pencil size={16} />,
  delete: <Trash2 size={16} />,
};

/**
 * A conversation row with its swipe actions and long-press menu
 * (ADR-086, ADR-129). The swipe shows two round buttons: the lifecycle step in the accent
 * circle (snooze, or return from snooze) and, for a snoozed row, a change of time. Everything
 * else (copy the id, arrange, pin, rename, delete) sits in the long-press
 * menu. Delete asks first; snoozing opens its sheet.
 *
 * A row of another computer (`environmentId`, ADR-132) offers the same: each action runs on
 * that computer through its own client, without switching, and changes its settings, not the
 * active computer's. While it cannot be reached the menu says so and only copies the id.
 */
export function MobileSessionItem({ session, project, showProject = true, snoozed = false, arrange = false, marker, environmentId, onOpen }: { session: Session; project: Project | undefined; showProject?: boolean; snoozed?: boolean; arrange?: boolean; marker?: ReactNode; environmentId?: string; onOpen: () => void }) {
  const t = useTranslation();
  const storeId = useEnvironments((state) => state.storeId);
  const connection = useEnvironments((state) => environmentId ? state.connection[environmentId] : undefined);
  const route = rowActionRoute(environmentId, storeId, connection);
  // While the row's computer is out of reach its actions wait on the phone (ADR-132 addendum).
  const storeOffline = useEnvironments((state) => isRemoteUi && environmentOffline(state.connection[state.storeId]));
  const queueTo = route.kind === "unreachable" ? route.environmentId : route.kind === "store" && storeOffline ? storeId : null;
  const waiting = useEnvironments((state) => state.pending.some((item) => item.sessionId === session.id && item.environmentId === (environmentId ?? state.storeId)));
  const elsewhere = route.kind !== "store" || queueTo !== null;
  const environment = useEnvironments((state) => elsewhere ? state.environments.find((item) => item.id === environmentId) : undefined);
  const pinnedHere = useAppStore((state) => state.settings.pinnedSessionIds.includes(session.id));
  const pinnedThere = useEnvironments((state) => !!environmentId && !!state.summaries[environmentId]?.pinnedSessionIds.includes(session.id));
  const pinned = elsewhere ? pinnedThere : pinnedHere;
  const macOrder = useAppStore((state) => state.settings.sidebarThreadSortOrder);
  const order = usePhonePrefs((state) => state.prefs.threadOrder) ?? macOrder;
  const [deleting, setDeleting] = useState(false);
  const [snoozing, setSnoozing] = useState(false);
  const [menuAnchor, setMenuAnchor] = useState<HTMLElement | null>(null);
  const [renaming, setRenaming] = useState(false);
  const [title, setTitle] = useState("");
  const active = ["starting", "running", "waiting"].includes(session.status);
  const save = (change: (settings: AppSettings) => AppSettings) => { const state = useAppStore.getState(); void state.saveSettings(change(state.settings)); };
  // Another computer's row: the action goes to that computer (ADR-132).
  const there = (action: EnvironmentSessionAction) => {
    if (queueTo) { useEnvironments.getState().queueAction(queueTo, session.id, action); return Promise.resolve(true); }
    return route.kind === "remote" ? useEnvironments.getState().sessionAction(route.environmentId, session.id, action) : Promise.resolve(false);
  };
  // Snoozing on another computer (or while it is out of reach) raises the same undo toast as here.
  const snoozeThere = async (until: string) => {
    if (!await there({ type: "snooze", until })) return;
    useAppStore.setState({ snoozeNotice: { id: Date.now(), sessionId: session.id, until, wasSelected: false, undo: () => there({ type: "snooze", until: null }) } });
  };
  const unsnooze = () => void (elsewhere ? there({ type: "snooze", until: null }) : useAppStore.getState().snoozeSession(session.id, null));
  const togglePin = () => elsewhere ? void there({ type: pinned ? "unpin" : "pin" }) : save((settings) => ({ ...settings, pinnedSessionIds: toggleSidebarId(settings.pinnedSessionIds, session.id) }));
  const swipe: SwipeAction[] = snoozed ? [
    { id: "return", label: t("snooze.return"), icon: <Undo2 size={17} />, tone: "primary", onSelect: unsnooze },
    { id: "change", label: t("snooze.change"), icon: <Clock3 size={17} />, tone: "plain", onSelect: () => setSnoozing(true) },
  ] : [
    { id: "snooze", label: t("snooze.confirm"), icon: <Moon size={17} />, tone: "primary", disabled: !canSnooze(session), onSelect: () => setSnoozing(true) },
  ];
  const actions = swipe;
  const labels: Record<RowMenuId, string> = {
    "copy-id": t("phoneHome.copyId"), return: t("snooze.return"),
    arrange: t("phoneHome.arrange"), pin: t("mobile.pin"), unpin: t("mobile.unpin"), rename: t("phoneHome.rename"),
    delete: t("mobile.delete"),
  };
  const run: Partial<Record<RowMenuId, () => void>> = {
    "copy-id": () => void navigator.clipboard?.writeText(session.id).catch(() => undefined),
    return: unsnooze,
    pin: togglePin,
    unpin: togglePin,
    rename: () => { setTitle(session.title); setRenaming(true); },
    delete: () => setDeleting(true),
  };
  const choose = (menu: RowMenuId, choice: string) => {
    if (menu === "arrange") usePhonePrefs.getState().update({ threadOrder: choice === "created_at" ? "created_at" : "updated_at" });
  };
  const items = rowMenuItems({
    place: snoozed ? "snoozed" : arrange ? "home" : "list",
    pinned, active, order,
  });
  const menu: RowMenuEntry[] = items.map((item) => ({
    id: item.id, label: labels[item.id], icon: MENU_ICONS[item.id], destructive: item.destructive, disabled: item.disabled, onSelect: run[item.id],
    submenu: item.submenu?.map((option) => ({ id: option.id, checked: option.checked, label: t(`phoneHome.arrange.${option.id}`), onSelect: () => choose(item.id, option.id) })),
  }));
  const rename = async () => {
    const next = title.trim();
    (document.activeElement as HTMLElement | null)?.blur();
    setRenaming(false);
    if (next && next !== session.title) await (elsewhere ? there({ type: "rename", title: next }) : useAppStore.getState().renameSession(session.id, next));
  };
  const name = environment ? environmentLabel(environment, t("environments.computer")) : "";
  const hostName = useHostLabel();
  const note = queueTo ? t("environments.rowQueued", { name: name || hostName }) : undefined;
  const row = <MobileSessionRow session={session} project={project} showProject={showProject} pinned={pinned} pending={waiting} marker={marker} onOpen={onOpen} />;
  return <>
    <MobileSwipeRow actions={actions} onLongPress={setMenuAnchor}>{row}</MobileSwipeRow>
    <MobileRowMenu open={!!menuAnchor} anchor={menuAnchor} items={menu} note={note} onClose={() => setMenuAnchor(null)}
      preview={<MobileSessionRow session={session} project={project} showProject={showProject} pinned={pinned} pending={waiting} marker={marker} />} />
    <MobileDialog open={renaming} title={t("session.rename")} onClose={() => setRenaming(false)}>
      <form onSubmit={(event) => { event.preventDefault(); void rename(); }}>
        <input className="mobile-input" autoFocus value={title} maxLength={200} onChange={(event) => setTitle(event.target.value)} aria-label={t("session.titleOptional")} enterKeyHint="done" />
        <div className="mobile-dialog-actions">
          <button type="button" className="mobile-dialog-button" onClick={() => setRenaming(false)}>{t("common.cancel")}</button>
          <button type="submit" className="mobile-dialog-button" data-tone="primary" disabled={!title.trim()}>{t("common.save")}</button>
        </div>
      </form>
    </MobileDialog>
    <MobileDeleteDialog session={session} open={deleting} onClose={() => setDeleting(false)} onDelete={elsewhere ? (removeWorktree) => there({ type: "delete", removeWorktree }) : undefined} />
    <MobileSnoozeSheet session={session} open={snoozing} onClose={() => setSnoozing(false)} onSnooze={elsewhere ? (until) => void snoozeThere(until) : undefined} />
  </>;
}
