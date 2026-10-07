import { useCallback, useEffect, useRef, useState } from "react";
import { client } from "@/client";
import type { McpCatalog } from "@/client/types";
import { formatUnknownError } from "@/lib/format-error";

/** The MCP servers configured for the providers, as seen from a project (ADR-075). */
export function useMcpCatalog(projectId: string | null) {
  const [catalog, setCatalog] = useState<McpCatalog | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const generation = useRef(0);
  const refresh = useCallback(async () => {
    const current = ++generation.current;
    setLoading(true);
    try {
      const result = await client.mcpAction({ type: "list", projectId });
      if (current === generation.current) { setCatalog(result.catalog); setError(null); }
    } catch (reason) {
      if (current === generation.current) setError(formatUnknownError(reason));
    } finally {
      if (current === generation.current) setLoading(false);
    }
  }, [projectId]);
  const invalidate = useCallback(() => { generation.current++; }, []);
  useEffect(() => { void refresh(); return invalidate; }, [refresh, invalidate]);
  const replace = useCallback((next: McpCatalog) => { generation.current++; setCatalog(next); setLoading(false); setError(null); }, []);
  return { catalog, loading, error, refresh, replace };
}
