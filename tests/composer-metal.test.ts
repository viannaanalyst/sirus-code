import { test } from "node:test";
import assert from "node:assert/strict";
import { watchTranscriptScroll } from "../src/lib/composer-metal.ts";

test("the composer rim pauses while the transcript scrolls and resumes once idle", async () => {
  let listener: ((event: Event) => void) | undefined;
  const target = {
    addEventListener: (_type: string, handler: (event: Event) => void) => { listener = handler; },
    removeEventListener: () => { listener = undefined; },
  } as unknown as Pick<Document, "addEventListener" | "removeEventListener">;
  const changes: boolean[] = [];
  const stop = watchTranscriptScroll(target, (scrolling) => changes.push(scrolling), 20);
  const scroll = (selector: string) => listener?.({ target: { matches: (query: string) => query === selector } } as unknown as Event);
  scroll(".other-scroller");
  assert.deepEqual(changes, [], "other scrollers are ignored");
  scroll(".transcript-scroll");
  scroll(".transcript-scroll");
  assert.deepEqual(changes, [true], "one pause for a burst of scroll events");
  await new Promise((resolve) => setTimeout(resolve, 40));
  assert.deepEqual(changes, [true, false], "resumes after the idle delay");
  stop();
  assert.equal(listener, undefined);
});
