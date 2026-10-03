import { useTranslation } from "@/i18n/use-translation";
import { Plus } from "lucide-react";
import { cn } from "@/lib/cn";

interface Props {
  onClick: () => void;
  disabled?: boolean;
  compact?: boolean;
}

export function NewSessionButton({ onClick, disabled, compact }: Props) {
  const t = useTranslation();
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "titlebar-no-drag flex items-center justify-center gap-1.5 rounded-full border border-white/12 bg-background-elevated ui-control text-text-primary",
        "hover:bg-background-3 disabled:pointer-events-none disabled:opacity-40",
        compact ? "h-[26px] px-3" : "h-[32px] w-full px-3",
      )}
    >
      {compact ? null : <Plus size={13} strokeWidth={2.2} />}{t("New session")}</button>
  );
}
