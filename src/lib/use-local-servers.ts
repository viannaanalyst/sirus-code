import { useEffect, useMemo } from "react";
import { mergeLocalServers, type LocalServerEntry, type NativeLocalServer } from "@/lib/local-servers";
import { useAppStore } from "@/store/app-store";

const NO_SERVERS: NativeLocalServer[] = [];
const NO_URLS: string[] = [];

/**
 * The session's local servers, native listeners merged with scanned output (ADR-151). Scans only
 * while `visible` (the browser's empty state or the Environment row), once on showing and again
 * when a script or terminal starts. Nothing polls.
 */
export function useLocalServers(sessionId: string | null, visible: boolean): LocalServerEntry[] {
  const native = useAppStore((state) => (sessionId ? state.detectedServersBySession[sessionId] : undefined) ?? NO_SERVERS);
  const scanned = useAppStore((state) => (sessionId ? state.localServersBySession[sessionId] : undefined) ?? NO_URLS);
  const tick = useAppStore((state) => (sessionId ? state.serverScanTick[sessionId] : undefined) ?? 0);
  useEffect(() => {
    if (!sessionId || !visible) return;
    void useAppStore.getState().refreshLocalServers(sessionId);
  }, [sessionId, visible, tick]);
  return useMemo(() => mergeLocalServers(native, scanned), [native, scanned]);
}
