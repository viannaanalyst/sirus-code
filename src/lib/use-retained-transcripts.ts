import { useEffect } from "react";
import { retainTranscript } from "@/store/app-store";

/** Keeps these sessions' transcripts loaded while the calling view is mounted (ADR-048). */
export function useRetainedTranscripts(sessionIds: readonly (string | null | undefined)[]) {
  const key = sessionIds.filter((id): id is string => Boolean(id)).join("\0");
  useEffect(() => {
    const releases = key ? key.split("\0").map(retainTranscript) : [];
    return () => releases.forEach((release) => release());
  }, [key]);
}
