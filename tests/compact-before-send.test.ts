import { test } from "node:test";
import assert from "node:assert/strict";
import { COMPACT_IDLE_MS, shouldCompactBeforeSend } from "../src/lib/compact-before-send.ts";
import type { Session } from "../src/client/types.ts";

const now = Date.parse("2026-10-07T12:00:00Z");
const idle = new Date(now - COMPACT_IDLE_MS - 60_000).toISOString();
const base = { agent: "claude", status: "completed", nativeThread: { id: "t" } as unknown as Session["nativeThread"], contextUsage: { used: 120_000, window: 200_000 }, lastActivityAt: idle } as Pick<Session, "agent" | "status" | "nativeThread" | "contextUsage" | "lastActivityAt">;

test("compact and send needs a heavy context, a long pause and a compacting provider", () => {
  assert.equal(shouldCompactBeforeSend(base, now), true);
  assert.equal(shouldCompactBeforeSend({ ...base, agent: "codex" }, now), true);
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
