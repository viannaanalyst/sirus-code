import type { AgentProviderId, McpProvider, McpServer, McpServerInput } from "@/client/types";

/** Providers whose MCP config files Sirus Code reads and edits (ADR-075). */
export const MCP_PROVIDERS: readonly McpProvider[] = ["claude", "codex", "opencode", "cursor"];

export function isMcpProvider(id: AgentProviderId | string): id is McpProvider {
  return (MCP_PROVIDERS as readonly string[]).includes(id);
}

const NAME = /^[A-Za-z0-9_-]{1,64}$/;
const record = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const strings = (value: unknown): Record<string, string> | undefined => {
  if (!record(value)) return undefined;
  const entries = Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === "string");
  return entries.length ? Object.fromEntries(entries) : undefined;
};
const looksLikeServer = (value: unknown) => record(value) && (typeof value.command === "string" || Array.isArray(value.command) || typeof value.url === "string" || typeof value.serverUrl === "string");

/** One server object in any of the common shapes (Claude/Cursor, Codex-like, OpenCode). */
export function serverFromObject(name: string, value: Record<string, unknown>): McpServerInput {
  const server: McpServerInput = { name: name.trim() };
  const kind = typeof value.type === "string" ? value.type : "";
  if (Array.isArray(value.command)) {
    const [command, ...args] = value.command.filter((part): part is string => typeof part === "string");
    server.command = command;
    server.args = args;
  } else if (typeof value.command === "string") {
    server.command = value.command;
    server.args = Array.isArray(value.args) ? value.args.filter((arg): arg is string => typeof arg === "string") : [];
  }
  const url = typeof value.url === "string" ? value.url : typeof value.serverUrl === "string" ? value.serverUrl : undefined;
  if (!server.command && url) {
    server.url = url;
    server.transport = kind === "sse" ? "sse" : "http";
    const headers = strings(value.headers) ?? strings(value.http_headers);
    if (headers) server.headers = headers;
  }
  const env = strings(value.env) ?? strings(value.environment);
  if (server.command && env) server.env = env;
  return server;
}

/**
 * Pasted JSON: `{ "mcpServers": { name: {…} } }`, OpenCode's `{ "mcp": {…} }`,
 * a bare `{ name: {…} }` map, or one server object named by `fallbackName`.
 */
export function parseMcpJson(text: string, fallbackName = ""): { servers: McpServerInput[]; error: string | null } {
  let parsed: unknown;
  try { parsed = JSON.parse(text); } catch { return { servers: [], error: "mcp.paste.invalidJson" }; }
  if (!record(parsed)) return { servers: [], error: "mcp.paste.invalidJson" };
  const map = record(parsed.mcpServers) ? parsed.mcpServers : record(parsed.mcp) ? parsed.mcp : record(parsed.servers) ? parsed.servers : null;
  if (map) return named(map);
  if (looksLikeServer(parsed)) {
    if (!fallbackName.trim()) return { servers: [], error: "mcp.paste.needsName" };
    return { servers: [serverFromObject(fallbackName, parsed)], error: null };
  }
  if (Object.values(parsed).length && Object.values(parsed).every(looksLikeServer)) return named(parsed);
  return { servers: [], error: "mcp.paste.noServers" };
}

function named(map: Record<string, unknown>) {
  const servers = Object.entries(map).filter(([, value]) => looksLikeServer(value)).map(([name, value]) => serverFromObject(name, value as Record<string, unknown>));
  return servers.length ? { servers, error: null } : { servers, error: "mcp.paste.noServers" };
}

/** Form fields: arguments one per line, `KEY=value` per line for env and headers. */
export function serverFromForm(form: { name: string; kind: "command" | "url"; command: string; args: string; env: string; url: string; headers: string; sse: boolean }): McpServerInput {
  const pairs = (text: string, separator: string) => {
    const entries = text.split("\n").map(line => line.trim()).filter(Boolean).map((line) => {
      const at = line.indexOf(separator);
      return at > 0 ? [line.slice(0, at).trim(), line.slice(at + 1).trim()] as const : null;
    }).filter((entry): entry is readonly [string, string] => entry !== null);
    return entries.length ? Object.fromEntries(entries) : undefined;
  };
  if (form.kind === "url") return { name: form.name.trim(), url: form.url.trim(), transport: form.sse ? "sse" : "http", headers: pairs(form.headers, ":") ?? pairs(form.headers, "=") };
  return { name: form.name.trim(), command: form.command.trim(), args: form.args.split("\n").map(arg => arg.trim()).filter(Boolean), env: pairs(form.env, "=") };
}

/** A short reason the server cannot be saved, or null. Native validation is the authority. */
export function mcpInputProblem(server: McpServerInput): string | null {
  if (!NAME.test(server.name)) return "mcp.problem.name";
  if (server.name.toLowerCase().startsWith("sirus_")) return "mcp.problem.reserved";
  if (Boolean(server.command) === Boolean(server.url)) return "mcp.problem.kind";
  if (server.url && !/^https?:\/\/\S+$/.test(server.url)) return "mcp.problem.url";
  return null;
}

/** Servers the provider can use in this project: user, project and Claude's local entries. */
export function serversFor(servers: McpServer[], provider: AgentProviderId): McpServer[] {
  return servers.filter(server => server.provider === provider);
}

/** Name → providers that configure it, for the grouped Settings list. */
export function groupByName(servers: McpServer[]): [string, McpServer[]][] {
  const groups = new Map<string, McpServer[]>();
  for (const server of servers) groups.set(server.name, [...(groups.get(server.name) ?? []), server]);
  return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b));
}

/** What the server runs or reaches, with environment values masked. */
export function serverTarget(server: Pick<McpServer, "command" | "args" | "url">): string {
  return server.command ? [server.command, ...server.args].join(" ") : server.url ?? "";
}

export function maskedPairs(keys: string[]): string {
  return keys.map(key => `${key}=••••`).join("  ");
}
