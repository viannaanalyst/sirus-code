import { useCallback, useEffect, useRef, useState } from "react";
import { client } from "@/client";
import type { SkillOwner, SkillsCatalog } from "@/client/types";
import { formatUnknownError } from "@/lib/format-error";
import { skillContextKey } from "@/lib/skills";
import { useAppStore } from "@/store/app-store";

/** Last catalog per owner context: reopening the `/` menu shows it at once while a fresh copy loads, so a choice never waits on the reload. */
const recent = new Map<string, SkillsCatalog>();

export function useSkillsCatalog(owner: SkillOwner, enabled = true) {
  const { projectId, sessionId } = owner;
  const context = useAppStore(state => skillContextKey(state, owner));
  const key = JSON.stringify([projectId, sessionId, context]);
  const generation = useRef(0);
  const invalidate = useCallback(() => { generation.current++; }, []);
  const initial = () => ({ key, catalog: recent.get(key) ?? null, loading: !recent.has(key), error: null });
  const [state, setState] = useState<{ key: string; catalog: SkillsCatalog | null; loading: boolean; error: string | null }>(initial);
  const refresh = useCallback(async () => {
    const id = ++generation.current;
    setState({ key, catalog: recent.get(key) ?? null, loading: !recent.has(key), error: null });
    try {
      const catalog = await client.skillsCatalog({ projectId, sessionId });
      recent.set(key, catalog);
      if (id === generation.current) setState({ key, catalog, loading: false, error: null });
    } catch (error) {
      recent.delete(key);
      if (id === generation.current) setState({ key, catalog: null, loading: false, error: formatUnknownError(error) });
    }
  }, [projectId, sessionId, key]);
  useEffect(() => { if (enabled) void refresh(); return invalidate; }, [refresh, invalidate, enabled]);
  return { ...(state.key === key ? state : initial()), refresh };
}
