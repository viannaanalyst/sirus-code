import { useCallback, useEffect, useSyncExternalStore } from "react";
import { client } from "@/client";
import type { SubagentFeed, SubagentFeedEntry, SubagentFeedEvent } from "@/client/types";
import { mergeFeedEntries } from "@/lib/subagent-team";
import { formatUnknownError } from "@/lib/format-error";

/**
 * Subagent live views (ADR-146) keep their feeds here, outside the app store: an event for
 * one subagent re-renders only the view watching it, never the transcript. Only watched
 * feeds are kept; an event for a feed no one watches is dropped (the native side still has it).
 */
export interface FeedState {
  entries: SubagentFeedEntry[];
  dropped: number;
  source: SubagentFeed["source"] | "loading";
  error: string | null;
}

const EMPTY: FeedState = { entries: [], dropped: 0, source: "loading", error: null };
const feeds = new Map<string, FeedState>();
const watchers = new Map<string, Set<() => void>>();
let listening: Promise<() => void> | null = null;

const id = (sessionId: string, key: string) => `${sessionId}\u0000${key}`;

function set(feed: string, next: FeedState) {
  feeds.set(feed, next);
  for (const notify of watchers.get(feed) ?? []) notify();
}

/** Applies a `subagent-feed` event to the feed it names, if a view watches it. */
export function applyFeedEvent(event: SubagentFeedEvent) {
  const feed = id(event.sessionId, event.key);
  const known = feeds.get(feed);
  if (!known) return;
  const merged = mergeFeedEntries(known.entries, event.entries);
  set(feed, { entries: merged.entries, dropped: Math.max(known.dropped, event.dropped) + merged.dropped, source: "live", error: null });
}

function listen() {
  listening ??= client.onSubagentFeed(applyFeedEvent);
}

async function load(sessionId: string, key: string) {
  const feed = id(sessionId, key);
  try {
    const read = await client.subagentFeed(sessionId, key);
    const known = feeds.get(feed);
    if (!known) return;
    // Events that arrived while reading are newer than the read: they go on top. A transcript
    // read again merges into what is shown, so rows that did not change keep their identity.
    const live = known.source === "live";
    const merged = live ? mergeFeedEntries(read.entries, known.entries) : mergeFeedEntries(known.entries, read.entries);
    set(feed, { entries: merged.entries, dropped: read.dropped + merged.dropped, source: live ? "live" : read.source, error: null });
  } catch (error) {
    const known = feeds.get(feed);
    if (known) set(feed, { ...known, source: known.source === "loading" ? "none" : known.source, error: formatUnknownError(error) });
  }
}

function watch(sessionId: string, key: string, notify: () => void) {
  const feed = id(sessionId, key);
  listen();
  let group = watchers.get(feed);
  if (!group) {
    group = new Set();
    watchers.set(feed, group);
    feeds.set(feed, EMPTY);
    void load(sessionId, key);
  }
  const own = group;
  own.add(notify);
  return () => {
    own.delete(notify);
    if (own.size) return;
    watchers.delete(feed);
    feeds.delete(feed);
  };
}

/** Re-reads a feed that is not streaming (a Claude transcript a running child is still writing). */
const POLL_MS = 2000;

/**
 * One subagent's feed. While it runs and nothing streams live, its transcript is read again
 * every two seconds, only while the view is shown and the window visible.
 */
export function useSubagentFeed(sessionId: string, key: string, running: boolean): FeedState {
  const subscribe = useCallback((notify: () => void) => watch(sessionId, key, notify), [sessionId, key]);
  const snapshot = useCallback(() => feeds.get(id(sessionId, key)) ?? EMPTY, [sessionId, key]);
  const state = useSyncExternalStore(subscribe, snapshot, () => EMPTY);
  const polling = running && state.source !== "live" && state.source !== "loading";
  useEffect(() => {
    if (!polling) return;
    const timer = window.setInterval(() => { if (!document.hidden) void load(sessionId, key); }, POLL_MS);
    return () => window.clearInterval(timer);
  }, [polling, sessionId, key]);
  return state;
}
