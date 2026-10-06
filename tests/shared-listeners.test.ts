import { test } from "node:test";
import assert from "node:assert/strict";
import { SirusClient } from "../src/client/index.ts";
import type { Transport } from "../src/client/transport.ts";
import type { PtyOutputEvent } from "../src/client/types.ts";

test("terminal output uses one native listener fanned out to every terminal", async () => {
  const native = new Map<string, (payload: unknown) => void>();
  let registrations = 0, removals = 0;
  const transport: Transport = {
    invoke: async () => { throw new Error("unused"); },
    listen: async <T,>(event: string, handler: (payload: T) => void) => {
      registrations += 1;
      native.set(event, handler as (payload: unknown) => void);
      return () => { removals += 1; native.delete(event); };
    },
  };
  const client = new SirusClient(transport);
  const seen: string[] = [];
  const first = await client.onPtyOutput((event) => seen.push(`1:${event.data}`));
  const second = await client.onPtyOutput((event) => seen.push(`2:${event.data}`));
  assert.equal(registrations, 1);
  const chunk: PtyOutputEvent = { sessionId: "s", terminalId: "t", data: "ls" };
  native.get("pty-output")!(chunk);
  assert.deepEqual(seen, ["1:ls", "2:ls"]);

  first();
  first();
  assert.equal(removals, 0, "a remaining terminal keeps the native listener");
  native.get("pty-output")!(chunk);
  assert.deepEqual(seen.slice(2), ["2:ls"]);
  second();
  await Promise.resolve();
  assert.equal(removals, 1);

  await client.onPtyOutput(() => {});
  assert.equal(registrations, 2, "a later terminal registers again");
});
