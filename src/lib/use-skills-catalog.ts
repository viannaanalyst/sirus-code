import { useCallback, useEffect, useRef, useState } from "react";
import { client } from "@/client";
import type { SkillOwner, SkillsCatalog } from "@/client/types";
import { formatUnknownError } from "@/lib/format-error";
import { skillContextKey } from "@/lib/skills";
import { useAppStore } from "@/store/app-store";

export function useSkillsCatalog(owner: SkillOwner, enabled = true) {
  const { projectId, sessionId } = owner;
  const context = useAppStore(state => skillContextKey(state, owner));
  const key = JSON.stringify([projectId, sessionId, context]);
  const generation = useRef(0);
  const invalidate = useCallback(() => { generation.current++; }, []);
  const [state, setState] = useState<{ key: string; catalog: SkillsCatalog | null; loading: boolean; error: string | null }>({ key, catalog: null, loading: true, error: null });
  const refresh = useCallback(async () => {
    const id = ++generation.current;
    setState({ key, catalog: null, loading: true, error: null });
    try {
      const catalog = await client.skillsCatalog({ projectId, sessionId });
      if (id === generation.current) setState({ key, catalog, loading: false, error: null });
    } catch (error) {
      if (id === generation.current) setState({ key, catalog: null, loading: false, error: formatUnknownError(error) });
    }
  }, [projectId, sessionId, key]);
  useEffect(() => { if (enabled) void refresh(); return invalidate; }, [refresh, invalidate, enabled]);
  return { ...(state.key === key ? state : { key, catalog: null, loading: true, error: null }), refresh };
}
