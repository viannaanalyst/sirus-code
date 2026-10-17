import { useEffect, useState } from "react";
import { ArrowRight, Laptop, Server } from "@/components/icons/phosphor";
import { Dialog, DialogContent } from "@/components/arc/dialog/dialog";
import { client } from "@/client";
import type { Session } from "@/client/types";
import { useTranslation } from "@/i18n/use-translation";
import { moveBranch } from "@/lib/computers";
import { HOME_ENVIRONMENT } from "@/lib/environments";
import { formatUnknownError } from "@/lib/format-error";
import { InteractiveButton } from "@/primitives/InteractiveButton";
import { useAppStore } from "@/store/app-store";
import { ComputerError, computerLabel, useComputers } from "@/store/computers-store";
import "@/styles/computers.css";
import { isAuxiliarySession } from "@/lib/pull-ask";

/**
 * "Move to <computer>" items for a conversation's menus (ADR-133): one per other paired
 * computer, disabled while it does not answer. Empty with a single computer.
 */
export function useMoveMenu(group = "move") {
  const t = useTranslation();
  const computers = useComputers((state) => state.computers);
  const activeId = useComputers((state) => state.activeId);
  const connection = useComputers((state) => state.connection);
  useComputers((state) => state.hostInfo);
  return (session: Session | null | undefined) => {
    if (!session || isAuxiliarySession(session) || computers.length < 2) return [];
    return computers.filter((computer) => computer.id !== activeId).map((computer) => ({
      id: `move:${computer.id}`,
      group,
      label: t("computers.move.item", { name: computerLabel(computer.id) }),
      icon: computer.id === HOME_ENVIRONMENT || computer.kind === "mac" ? <Laptop size={15} /> : <Server size={15} />,
      disabled: computer.id !== HOME_ENVIRONMENT && connection[computer.id] !== "open",
      onSelect: () => useComputers.getState().requestMove(session.id, computer.id),
    }));
  };
}

/** The confirmation and progress of moving a conversation; mounted once in the window. */
export function MoveSessionDialog() {
  const t = useTranslation();
  const request = useComputers((state) => state.moveRequest);
  const moving = useComputers((state) => state.moving);
  const session = useAppStore((state) => request ? state.sessions.find((item) => item.id === request.sessionId) ?? null : null);
  const [remoteUrl, setRemoteUrl] = useState<string | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [shown, setShown] = useState(request);
  if (shown !== request) { setShown(request); setRemoteUrl(undefined); setError(null); }

  useEffect(() => {
    if (!request || !session) return;
    let cancelled = false;
    client.projectRemoteUrl(session.projectId).then((url) => { if (!cancelled) setRemoteUrl(url); }, (reason: unknown) => { if (!cancelled) { setRemoteUrl(null); setError(formatUnknownError(reason)); } });
    return () => { cancelled = true; };
  }, [request, session?.projectId]); // eslint-disable-line react-hooks/exhaustive-deps

  const name = request ? computerLabel(request.targetId) : "";
  const refusal = request && remoteUrl !== undefined ? useComputers.getState().moveRefusal(request.sessionId, request.targetId, remoteUrl) : null;
  const busy = moving !== null;
  const move = async () => {
    if (!request || busy || refusal) return;
    setError(null);
    try {
      await useComputers.getState().moveSession(request.sessionId, request.targetId);
      useComputers.setState({ moveRequest: null });
    } catch (reason) {
      setError(reason instanceof ComputerError ? t(reason.key) : formatUnknownError(reason));
    }
  };

  return <Dialog open={request !== null && session !== null} onOpenChange={(open) => { if (!open) useComputers.getState().cancelMove(); }}>
    <DialogContent title={t("computers.move.title", { name })} description={session?.title} className="w-[min(480px,calc(100vw-32px))]">
      <div className="mt-3 flex flex-col gap-3">
        <p className="ui-body text-text-secondary">{t("computers.move.help", { name, branch: request ? moveBranch(request.sessionId) : "" })}</p>
        {refusal ? <p role="alert" className="ui-caption text-warning">{t(`computers.move.refused.${refusal}`)}</p> : null}
        {moving ? <p role="status" className="ui-caption text-text-muted">{t(`computers.move.step.${moving.step}`, { name })}</p> : null}
        {error ? <p role="alert" className="selectable ui-caption text-danger">{error}</p> : null}
        <div className="mt-1 flex justify-end gap-2">
          <InteractiveButton variant="ghost" disabled={busy} onClick={() => useComputers.getState().cancelMove()}>{t("common.cancel")}</InteractiveButton>
          <InteractiveButton variant="secondary" loading={busy} disabled={remoteUrl === undefined || refusal !== null} onClick={() => void move()}>
            <ArrowRight size={14} aria-hidden="true" />{t("computers.move.confirm")}
          </InteractiveButton>
        </div>
      </div>
    </DialogContent>
  </Dialog>;
}

/** The note a moved conversation carries in its transcript (ADR-133). */
export function SessionMovedNote({ session, which }: { session: Session; which: "from" | "to" }) {
  const t = useTranslation();
  const computers = useComputers((state) => state.computers);
  if (which === "from" ? !session.movedFrom : !session.movedTo) return null;
  const target = session.movedTo ? computers.find((item) => computerLabel(item.id) === session.movedTo!.computer) : undefined;
  return <>
    {which === "from" && session.movedFrom ? <p className="session-moved-note ui-caption" role="note"><ArrowRight size={13} aria-hidden="true" /><span>{t("computers.moved.from", { name: session.movedFrom.computer, branch: session.movedFrom.branch })}</span></p> : null}
    {which === "to" && session.movedTo ? <p className="session-moved-note ui-caption" role="note">
      <ArrowRight size={13} aria-hidden="true" />
      <span>{t("computers.moved.to", { name: session.movedTo.computer, branch: session.movedTo.branch })}</span>
      {target ? <InteractiveButton variant="toolbar" onClick={() => void useComputers.getState().activate(target.id)}>{t("computers.moved.open", { name: session.movedTo.computer })}</InteractiveButton> : null}
    </p> : null}
  </>;
}
