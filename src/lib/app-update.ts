import type { AppUpdateStatus } from "@/client/types";

/** What the update toast shows (ADR-140), or nothing. */
export type AppUpdateToastKind = "available" | "progress" | "installed" | "failed";

/**
 * The toast offers a found update until the person picks Later for that version, follows a
 * download they started, asks for the restart once installed, and reports a failed install.
 * A failed check stays in Settings, where it was asked for.
 */
export function appUpdateToast(status: AppUpdateStatus | null, dismissed: string | null, installRequested: boolean): AppUpdateToastKind | null {
  if (!status) return null;
  const key = status.version ?? status.currentVersion;
  switch (status.phase) {
    case "available": return dismissed === key ? null : "available";
    case "downloading":
    case "installing": return "progress";
    case "installed": return dismissed === `installed:${key}` ? null : "installed";
    case "failed": return installRequested && dismissed !== `failed:${key}` ? "failed" : null;
    default: return null;
  }
}

/** The dismissal key for the toast now shown, so Later hides only this offer. */
export function appUpdateDismissKey(status: AppUpdateStatus, kind: AppUpdateToastKind): string {
  const key = status.version ?? status.currentVersion;
  return kind === "installed" ? `installed:${key}` : kind === "failed" ? `failed:${key}` : key;
}

/** Download progress in whole percent, or null while the size is unknown. */
export function appUpdatePercent(status: Pick<AppUpdateStatus, "downloaded" | "total">): number | null {
  if (!status.total || status.total <= 0) return null;
  return Math.max(0, Math.min(100, Math.floor((status.downloaded / status.total) * 100)));
}

/** The first paragraph of the release notes, short enough for a toast. */
export function appUpdateSummary(notes: string | null, limit = 160): string | null {
  const first = notes?.split(/\n\s*\n/)[0]?.replace(/^[-*#\s]+/, "").replace(/\s+/g, " ").trim();
  if (!first) return null;
  return first.length > limit ? `${first.slice(0, limit - 1).trimEnd()}…` : first;
}
