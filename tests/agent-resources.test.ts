import assert from "node:assert/strict";
import { test } from "node:test";
import type { ResourceSnapshot } from "../src/client/types.ts";
import { canStopProcess, formatCpu, formatMemory, resourceRows, rowLevel, runningKey, snapshotLevel, totalLevel, tweenValue, withoutStopping } from "../src/lib/agent-resources.ts";

const GB = 1024 ** 3;
const mac = { cores: 10, memoryTotal: 16 * GB, memoryPressure: "normal" as const };

test("agent resources: the indicator turns amber, then red, on CPU, memory or pressure", () => {
  assert.equal(totalLevel(150, 1 * GB, mac), "normal");
  assert.equal(totalLevel(400, 1 * GB, mac), "elevated");
  assert.equal(totalLevel(750, 1 * GB, mac), "high");
  assert.equal(totalLevel(10, 4 * GB, mac), "elevated");
  assert.equal(totalLevel(10, 8 * GB, mac), "high");
  assert.equal(totalLevel(10, 1 * GB, { ...mac, memoryPressure: "warning" }), "elevated");
  assert.equal(totalLevel(10, 1 * GB, { ...mac, memoryPressure: "critical" }), "high");
  // Unknown memory size and zero cores never divide by zero.
  assert.equal(totalLevel(30, 50 * GB, { cores: 0, memoryTotal: null, memoryPressure: null }), "normal");
  assert.equal(snapshotLevel(null), "normal");
});

test("agent resources: rows tint from nearly one core or a tenth of memory", () => {
  assert.equal(rowLevel(50, 0, mac), "normal");
  assert.equal(rowLevel(95, 0, mac), "elevated");
  assert.equal(rowLevel(250, 0, mac), "high");
  assert.equal(rowLevel(0, 2 * GB, mac), "elevated");
  assert.equal(rowLevel(0, 5 * GB, mac), "high");
});

const snapshot: ResourceSnapshot = {
  cores: 8, memoryTotal: 16 * GB, memoryPressure: "normal", cpuPercent: 130, memoryBytes: 3 * GB,
  sessions: [
    { sessionId: "a", cpuPercent: 30, memoryBytes: 1 * GB, processCount: 1, processes: [{ pid: 10, started: 1, name: "claude", kind: "agent", cpuPercent: 30, memoryBytes: GB }] },
    { sessionId: "b", cpuPercent: 100, memoryBytes: 2 * GB, processCount: 2, processes: [
      { pid: 20, started: 2, name: "codex", kind: "agent", cpuPercent: 5, memoryBytes: GB },
      { pid: 21, started: 3, name: "cargo", kind: "build", cpuPercent: 95, memoryBytes: GB },
    ] },
    { sessionId: "gone", cpuPercent: 0, memoryBytes: 0, processCount: 0, processes: [] },
  ],
};

test("agent resources: rows join titles and providers, busiest first", () => {
  const rows = resourceRows(snapshot, [{ id: "a", title: "Fix login", agent: "claude" }, { id: "b", title: "Build", agent: "codex" }]);
  assert.deepEqual(rows.map(row => row.sessionId), ["b", "a", "gone"]);
  assert.equal(rows[0].title, "Build");
  assert.equal(rows[0].provider, "codex");
  assert.equal(rows[2].provider, null);
  assert.deepEqual(resourceRows(null, []), []);
});

test("agent resources: a process being stopped leaves the list at once", () => {
  const rows = resourceRows(snapshot, []);
  const after = withoutStopping(rows, new Set([21]));
  assert.deepEqual(after[0].processes.map(process => process.pid), [20]);
  assert.equal(after[0].processCount, 1);
  assert.equal(after[1], rows[1]);
  assert.equal(withoutStopping(rows, new Set()), rows);
});

test("agent resources: only tools stop one by one", () => {
  assert.equal(canStopProcess({ kind: "agent", pid: 10 }), false);
  assert.equal(canStopProcess({ kind: "build", pid: 21 }), true);
  assert.equal(canStopProcess({ kind: "tool", pid: 1 }), false);
});

test("agent resources: running sessions form a stable key", () => {
  assert.equal(runningKey([{ id: "b", status: "running" }, { id: "a", status: "waiting" }, { id: "c", status: "completed" }, { id: "d", status: "starting" }]), "a,b,d");
  assert.equal(runningKey([{ id: "x", status: "idle" }]), "");
});

test("agent resources: numbers format compactly and move smoothly", () => {
  assert.equal(formatCpu(0), "0%");
  assert.equal(formatCpu(0.4), "<1%");
  assert.equal(formatCpu(142.6), "143%");
  assert.equal(formatMemory(0), "0 MB");
  assert.equal(formatMemory(512 * 1024 * 1024), "512 MB");
  assert.equal(formatMemory(3.14 * GB), "3.1 GB");
  assert.equal(formatMemory(24 * GB), "24 GB");
  assert.equal(tweenValue(0, 100, 0), 0);
  assert.equal(tweenValue(0, 100, 1), 100);
  assert.equal(tweenValue(0, 100, 2), 100);
  assert.ok(tweenValue(0, 100, 0.5) > 50);
});
