import { useEffect, useMemo, useSyncExternalStore, type ReactNode } from "react";
import { client } from "@/client";
import { ChatImageSource, ChatMarkdown } from "@/components/ChatMarkdown";
import { cn } from "@/lib/cn";
import { githubAttachmentAsset, githubAttachmentAssets, prBodyMarkdown } from "@/lib/pr-body";

// GitHub image uploads (user-attachments) of a private repository need the person's
// GitHub login. They are read natively through `gh` (the token stays inside `gh`) into a
// bounded, magic-byte-checked data URL; until then, or if that fails, the image shows as
// a link. Other https images load directly, like the PR description (ADR-102).
type Entry = { state: "loading" } | { state: "ready"; src: string } | { state: "failed"; at: number };
const MAX_CACHED = 24 * 1024 * 1024;
const RETRY_AFTER_MS = 60_000;
let entries = new Map<string, Entry>();
const listeners = new Set<() => void>();
const keyOf = (repository: string, asset: string) => `${repository.toLowerCase()}\0${asset}`;

function put(key: string, entry: Entry) {
  const next = new Map(entries);
  next.delete(key);
  next.set(key, entry);
  // Oldest loaded images go first once the memory-only cache passes its budget.
  let size = 0;
  for (const value of next.values()) if (value.state === "ready") size += value.src.length;
  for (const [other, value] of next) {
    if (size <= MAX_CACHED) break;
    if (other === key || value.state !== "ready") continue;
    size -= value.src.length;
    next.delete(other);
  }
  entries = next;
  for (const listener of listeners) listener();
}

function request(repository: string, number: number, asset: string) {
  const key = keyOf(repository, asset);
  const known = entries.get(key);
  if (known && (known.state !== "failed" || Date.now() - known.at < RETRY_AFTER_MS)) return;
  put(key, { state: "loading" });
  client.pullRequestAction({ type: "attachment", repository, number, asset }).then(
    (response) => put(key, response.type === "attachment" ? { state: "ready", src: response.dataUrl } : { state: "failed", at: Date.now() }),
    () => put(key, { state: "failed", at: Date.now() }),
  );
}

const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
const snapshot = () => entries;

/** GitHub-flavoured text (a description, comment or review) as chat Markdown with its own image gallery. */
export function GithubMarkdown({ text, repository, number, className, empty = null }: { text: string; repository?: string; number?: number; className?: string; empty?: ReactNode }) {
  const markdown = useMemo(() => prBodyMarkdown(text), [text]);
  const assets = useMemo(() => repository && number ? githubAttachmentAssets(markdown, repository) : [], [markdown, repository, number]);
  useEffect(() => { if (repository && number) for (const asset of assets) request(repository, number, asset); }, [assets, repository, number]);
  const cache = useSyncExternalStore(subscribe, snapshot, snapshot);
  const resolve = useMemo(() => {
    if (!repository || !assets.length) return null;
    return (url: string) => {
      const asset = githubAttachmentAsset(url, repository);
      if (!asset) return undefined;
      const entry = assets.includes(asset) ? cache.get(keyOf(repository, asset)) : undefined;
      return entry?.state === "ready" ? entry.src : null;
    };
  }, [assets, cache, repository]);
  if (!markdown && !empty) return null;
  return <div data-gallery-scope="" className={cn("ui-body text-text-secondary [overflow-wrap:anywhere] selectable", className)}>
    {markdown ? <ChatImageSource.Provider value={resolve}><ChatMarkdown text={markdown} /></ChatImageSource.Provider> : empty}
  </div>;
}
