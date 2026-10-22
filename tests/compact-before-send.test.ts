import { test } from "node:test";
import assert from "node:assert/strict";
import { COMPACT_IDLE_MS, compactRefusal, isCompactCommand, shouldCompactBeforeSend } from "../src/lib/compact-before-send.ts";
import type { Session } from "../src/client/types.ts";

const now = Date.parse("2026-10-07T12:00:00Z");
const idle = new Date(now - COMPACT_IDLE_MS - 60_000).toISOString();
const base = { agent: "claude", status: "completed", nativeThread: { id: "t" } as unknown as Session["nativeThread"], contextUsage: { used: 120_000, window: 200_000 }, lastActivityAt: idle } as Pick<Session, "agent" | "status" | "nativeThread" | "contextUsage" | "lastActivityAt">;

test("compact and send needs a heavy context, a long pause and a compacting provider", () => {
  assert.equal(shouldCompactBeforeSend(base, now), true);
  assert.equal(shouldCompactBeforeSend({ ...base, agent: "codex" }, now), false, "only Claude");
  // 70% of a known window counts even below 100k tokens.
  assert.equal(shouldCompactBeforeSend({ ...base, contextUsage: { used: 90_000, window: 128_000 } }, now), true);
  assert.equal(shouldCompactBeforeSend({ ...base, contextUsage: { used: 100_000, window: null } }, now), true);
  for (const change of [
    { contextUsage: { used: 60_000, window: 200_000 } },
    { contextUsage: { used: 90_000, window: null } },
    { contextUsage: null },
    { lastActivityAt: new Date(now - COMPACT_IDLE_MS + 60_000).toISOString() },
    { lastActivityAt: "not a date" },
    { agent: "opencode" },
    { nativeThread: null },
    { status: "running" },
    { status: "waiting" },
  ] as const) assert.equal(shouldCompactBeforeSend({ ...base, ...change } as typeof base, now), false, JSON.stringify(change));
  assert.equal(shouldCompactBeforeSend(null, now), false);
});

test("a known cache expiry replaces the idle-time guess", () => {
  const fresh = new Date(now - 60_000).toISOString();
  // An API key's 5-minute cache that just expired: compact even after a short pause.
  assert.equal(shouldCompactBeforeSend({ ...base, lastActivityAt: fresh, contextUsage: { used: 120_000, window: 200_000, cacheExpiresAt: now - 1 } }, now), true);
  // A cache still warm after 70 minutes (a later request refreshed it): send as is.
  assert.equal(shouldCompactBeforeSend({ ...base, contextUsage: { used: 120_000, window: 200_000, cacheExpiresAt: now + 60_000 } }, now), false);
});

test("only the standalone /compact is the command", () => {
  assert.equal(isCompactCommand("/compact"), true);
  assert.equal(isCompactCommand("  /compact\n"), true);
  for (const text of ["/compact now", "please /compact", "/Compact", "compact", ""]) assert.equal(isCompactCommand(text), false, text);
});

test("compact runs on an idle native Codex or Claude conversation and says why not otherwise", () => {
  assert.equal(compactRefusal(base), null);
  assert.equal(compactRefusal({ ...base, agent: "codex" }), null);
  assert.equal(compactRefusal({ ...base, agent: "opencode" }), "context.cannotCompact");
  assert.equal(compactRefusal({ ...base, agent: "cursor", nativeThread: null }), "context.cannotCompact");
  assert.equal(compactRefusal({ ...base, nativeThread: null }), "context.nothingToCompact");
  assert.equal(compactRefusal(null), "context.nothingToCompact");
  for (const status of ["starting", "running", "waiting"] as const) assert.equal(compactRefusal({ ...base, status }), "context.wait");
});
