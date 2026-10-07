import { test } from "node:test";
import assert from "node:assert/strict";
import { groupByName, isMcpProvider, maskedPairs, mcpInputProblem, parseMcpJson, serverFromForm, serversFor, serverTarget } from "../src/lib/mcp-servers.ts";
import type { McpServer } from "../src/client/types.ts";

test("pasted mcpServers JSON yields every server in the common shapes", () => {
  const { servers, error } = parseMcpJson(JSON.stringify({ mcpServers: {
    docs: { command: "npx", args: ["-y", "docs"], env: { TOKEN: "x" } },
    remote: { type: "sse", url: "https://x.dev/sse", headers: { Authorization: "Bearer t" } },
  } }));
  assert.equal(error, null);
  assert.deepEqual(servers, [
    { name: "docs", command: "npx", args: ["-y", "docs"], env: { TOKEN: "x" } },
    { name: "remote", url: "https://x.dev/sse", transport: "sse", headers: { Authorization: "Bearer t" } },
  ]);
  const opencode = parseMcpJson(JSON.stringify({ mcp: { local: { type: "local", command: ["bun", "x", "srv"], environment: { A: "1" } } } }));
  assert.deepEqual(opencode.servers, [{ name: "local", command: "bun", args: ["x", "srv"], env: { A: "1" } }]);
  assert.equal(parseMcpJson(JSON.stringify({ fetch: { command: "uvx", args: ["mcp-server-fetch"] } })).servers[0].name, "fetch");
});

test("a single server object needs a name and bad input explains itself", () => {
  assert.equal(parseMcpJson('{"command":"npx"}').error, "mcp.paste.needsName");
  assert.equal(parseMcpJson('{"command":"npx"}', "docs").servers[0].name, "docs");
  assert.equal(parseMcpJson("{nope").error, "mcp.paste.invalidJson");
  assert.equal(parseMcpJson('{"theme":"dark"}').error, "mcp.paste.noServers");
});

test("the form builds a server and validation mirrors the native rules", () => {
  const form = { name: "docs", kind: "command" as const, command: " npx ", args: "-y\n\ndocs\n", env: "TOKEN=a=b\nbad", url: "", headers: "", sse: false };
  assert.deepEqual(serverFromForm(form), { name: "docs", command: "npx", args: ["-y", "docs"], env: { TOKEN: "a=b" } });
  assert.deepEqual(serverFromForm({ ...form, kind: "url", url: "https://x.dev/mcp", headers: "Authorization: Bearer t" }), { name: "docs", url: "https://x.dev/mcp", transport: "http", headers: { Authorization: "Bearer t" } });
  assert.equal(mcpInputProblem({ name: "docs", command: "npx" }), null);
  assert.equal(mcpInputProblem({ name: "has space", command: "npx" }), "mcp.problem.name");
  assert.equal(mcpInputProblem({ name: "sirus_browser", command: "npx" }), "mcp.problem.reserved");
  assert.equal(mcpInputProblem({ name: "x", command: "npx", url: "https://a" }), "mcp.problem.kind");
  assert.equal(mcpInputProblem({ name: "x", url: "ftp://a" }), "mcp.problem.url");
});

test("listing helpers group by name, filter by provider and mask values", () => {
  const server = (name: string, provider: McpServer["provider"]): McpServer => ({ name, provider, scope: "user", path: "~/x", transport: "stdio", command: "npx", args: ["-y", name], url: null, envKeys: ["TOKEN"], headerKeys: [], enabled: true });
  const all = [server("b", "codex"), server("a", "claude"), server("b", "claude")];
  assert.deepEqual(groupByName(all).map(([name, rows]) => [name, rows.length]), [["a", 1], ["b", 2]]);
  assert.deepEqual(serversFor(all, "claude").map(row => row.name), ["a", "b"]);
  assert.equal(serverTarget(all[0]), "npx -y b");
  assert.equal(maskedPairs(["TOKEN", "KEY"]), "TOKEN=••••  KEY=••••");
  assert.ok(isMcpProvider("cursor") && !isMcpProvider("grok"));
});
