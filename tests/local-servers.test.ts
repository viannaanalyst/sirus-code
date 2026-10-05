import assert from "node:assert/strict";
import test from "node:test";
import { scanLocalServers } from "../src/lib/local-servers.ts";

test("local servers include any-interface binds, shown as localhost, and nothing remote", () => {
  assert.deepEqual(
    scanLocalServers("Serving HTTP on :: port 5391 (http://[::]:5391/) ... http://0.0.0.0:8000 http://localhost:3000/app https://example.com:443"),
    ["http://localhost:5391", "http://localhost:8000", "http://localhost:3000/app"],
  );
  assert.deepEqual(scanLocalServers("ftp://localhost:21 http://localhost.evil.com:80"), []);
});
