import { create } from "zustand";
import { localClient } from "@/client";
import type { AppUpdateStatus } from "@/client/types";
import { appUpdateDismissKey, type AppUpdateToastKind } from "@/lib/app-update";

/**
 * In-app updates of this Mac's app (ADR-140). Rust owns the check, download, signature check
 * and restart; this store mirrors its status from the `app-update` event. Only the desktop app
 * has it: a page served to another device has no `localClient` and never shows updates.
 */
interface AppUpdateState {
  status: AppUpdateStatus | null;
  /** The offer the person put off with Later (per version, for this launch). */
  dismissed: string | null;
  /** The person asked to install, so a failure is reported in the toast too. */
  installRequested: boolean;
  /** A check or install was asked here and has not answered yet. */
  pending: boolean;
  bind: () => void;
  check: () => Promise<void>;
  install: () => Promise<void>;
  restart: () => Promise<void>;
  later: (kind: AppUpdateToastKind) => void;
}

let bound = false;

export const useAppUpdate = create<AppUpdateState>((set, get) => {
  const run = async (action: "check" | "install" | "restart") => {
    if (!localClient || get().pending) return;
    set({ pending: true, ...(action === "install" ? { installRequested: true } : {}) });
    try {
      set({ status: await localClient.appUpdateAction({ type: action }) });
    } catch (error) {
      const status = get().status;
      if (status) set({ status: { ...status, phase: "failed", error: String(error) } });
    } finally {
      set({ pending: false });
    }
  };
  return {
    status: null,
    dismissed: null,
    installRequested: false,
    pending: false,
    bind: () => {
      if (bound || !localClient) return;
      bound = true;
      void localClient.onAppUpdate((status) => set({ status }));
      void localClient.appUpdateAction({ type: "status" }).then((status) => set({ status }), () => undefined);
    },
    check: () => run("check"),
    install: () => run("install"),
    restart: () => run("restart"),
    later: (kind) => {
      const status = get().status;
      if (status) set({ dismissed: appUpdateDismissKey(status, kind) });
    },
  };
});
