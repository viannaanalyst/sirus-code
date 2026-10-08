import { test } from "node:test";
import assert from "node:assert/strict";
import { thumbnailUrl } from "../src/lib/thumbnail-url.ts";
import { LocalTransport } from "../src/client/local-transport.ts";
import { RemoteTransport } from "../src/client/remote-transport.ts";

const id = "0b6f1d1e-5c1a-4f7e-9a51-2a0f3c9d8e11";

test("sent images load by id; legacy messages keep their data URL; files have none", () => {
  const resolve = (value: string) => `thumb:${value}`;
  assert.equal(thumbnailUrl({ id, name: "a.png", kind: "file", hasThumbnail: true }, resolve), `thumb:${id}`);
  assert.equal(thumbnailUrl({ id, name: "a.png", kind: "file", thumbnail: "data:image/jpeg;base64,AA" }, resolve), "data:image/jpeg;base64,AA");
  assert.equal(thumbnailUrl({ id, name: "a.txt", kind: "file" }, resolve), undefined);
  assert.equal(thumbnailUrl({ name: "a.png", kind: "file", hasThumbnail: true }, resolve), undefined);
});

test("each transport names its own thumbnail address", () => {
  assert.equal(new LocalTransport().thumbnailUrl(id), `sirus-thumb://localhost/${id}`);
  const remote = (token: string | null) => new RemoteTransport({ url: "ws://mac/api/socket", token: () => token });
  assert.equal(remote("a b").thumbnailUrl(id), `/api/thumbnail/${id}?token=a%20b`);
  assert.equal(remote(null).thumbnailUrl(id), undefined);
});
