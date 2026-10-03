import { useState, type ReactNode } from "react";
import { Dialog, DialogContent } from "@/components/arc/dialog/dialog";
import { InteractiveButton } from "@/primitives/InteractiveButton";
import { useTranslation } from "@/i18n/use-translation";

/**
 * One confirmation layout for the whole app: message, optional extra content, then Cancel and
 * the action. Destructive actions (delete, remove, discard, reset) always use the red button.
 */
export function ConfirmDialog({ open, onOpenChange, title, description, confirmLabel, cancelLabel, onConfirm, destructive = true, busy: busyProp, disabled = false, children, onCloseAutoFocus }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  confirmLabel: string;
  cancelLabel?: string;
  /** Resolve true (or nothing) to close; false keeps the dialog open, e.g. after an error. */
  onConfirm: () => unknown;
  destructive?: boolean;
  busy?: boolean;
  disabled?: boolean;
  children?: ReactNode;
  onCloseAutoFocus?: (event: Event) => void;
}) {
  const t = useTranslation();
  const [running, setRunning] = useState(false);
  const busy = busyProp ?? running;
  const confirm = async () => {
    setRunning(true);
    try { if ((await onConfirm()) !== false) onOpenChange(false); } finally { setRunning(false); }
  };
  return <Dialog open={open} onOpenChange={(next) => { if (!busy) onOpenChange(next); }}>
    <DialogContent role="alertdialog" variant="confirm" title={title} description={description} className="w-[min(420px,calc(100vw-32px))]" onCloseAutoFocus={onCloseAutoFocus}>
      {children}
      <div className="flex justify-end gap-2">
        <InteractiveButton variant="ghost" disabled={busy} onClick={() => onOpenChange(false)}>{cancelLabel ?? t("common.cancel")}</InteractiveButton>
        <InteractiveButton variant={destructive ? "danger" : "primary"} glow={false} loading={busy} disabled={disabled} onClick={() => void confirm()}>{confirmLabel}</InteractiveButton>
      </div>
    </DialogContent>
  </Dialog>;
}
