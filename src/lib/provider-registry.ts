import type { AgentProviderId, ApprovalMode } from "@/client/types";

export interface ProviderDefinition {
  id: AgentProviderId;
  name: string;
  vendor: string;
  website: string;
  capabilities: string[];
  executionNote?: string;
  approvalPolicy: "host" | "auto-review" | "vendor";
  approvalModes: ApprovalMode[];
}

export const PROVIDERS: ProviderDefinition[] = [
  {
    id: "claude",
    approvalModes: ["ask", "auto", "full"],
    approvalPolicy: "host",
    name: "Claude Code",
    vendor: "Anthropic",
    website: "https://docs.anthropic.com/en/docs/claude-code",
    capabilities: ["cli", "workspace-edits"],
  },
  {
    id: "codex",
    approvalModes: ["ask", "auto", "full"],
    approvalPolicy: "host",
    name: "Codex",
    vendor: "OpenAI",
    website: "https://github.com/openai/codex",
    capabilities: ["cli", "workspace-edits"],
  },
  {
    id: "cursor",
    approvalModes: ["auto", "full"],
    approvalPolicy: "auto-review",
    name: "Cursor",
    vendor: "Cursor",
    website: "https://cursor.com/docs/cli/overview",
    capabilities: ["cli", "workspace-edits"],
    executionNote: "Cursor Auto-review uses its sandbox; Full access uses --force with the sandbox disabled. Manual callbacks cannot be answered in this adapter. Vendor deny rules remain effective.",
  },
  {
    id: "grok",
    approvalModes: [],
    approvalPolicy: "vendor",
    name: "Grok",
    vendor: "xAI",
    website: "https://docs.x.ai/build/cli/overview",
    capabilities: ["cli", "workspace-edits"],
  },
  {
    id: "opencode",
    approvalModes: ["ask", "auto", "full"],
    approvalPolicy: "host",
    name: "OpenCode",
    vendor: "OpenCode",
    website: "https://opencode.ai/docs/acp/",
    capabilities: ["cli", "workspace-edits", "native-resume", "host-file-approvals"],
    executionNote: "OpenCode uses native sessions. Request approval reviews file edits; Auto-review allows file edits within the adapter policy. Full access allows CLI tools. Unsupported host callbacks are denied. ACP is not a filesystem sandbox.",
  },
  {
    id: "antigravity", name: "Antigravity", vendor: "Google", website: "https://antigravity.google/docs/cli/install/",
    capabilities: ["cli", "workspace-edits"], approvalPolicy: "vendor", approvalModes: [],
    executionNote: "Antigravity uses its CLI permissions and terminal sandbox. Headless permission requests are denied by the CLI; this adapter cannot answer them. Its terminal sandbox is not a filesystem sandbox for every tool.",
  },
  {
    id: "droid", name: "Droid", vendor: "Factory", website: "https://docs.factory.ai/droid-cli/overview",
    capabilities: ["cli", "workspace-edits"], approvalPolicy: "vendor", approvalModes: ["auto"],
    executionNote: "Droid Auto-review uses low autonomy for file edits. Planning uses the CLI's read-only default. Higher autonomy and permission bypasses are unavailable in this adapter.",
  },
  {
    id: "pi", name: "Pi", vendor: "Earendil", website: "https://pi.dev/docs/latest/quickstart",
    capabilities: ["cli", "workspace-edits"], approvalPolicy: "vendor", approvalModes: ["auto"],
    executionNote: "Pi uses built-in read/edit/write tools; planning selects read-only tools. Shell tools and extensions are disabled. Tool selection is not an operating-system filesystem sandbox.",
  },
  {
    id: "devin", name: "Devin", vendor: "Cognition", website: "https://docs.devin.ai/cli/index",
    capabilities: ["cli", "workspace-edits"], approvalPolicy: "vendor", approvalModes: ["auto"],
    executionNote: "Devin runs locally with Accept Edits and its exec-tool sandbox. Existing workspace trust is required. This adapter cannot answer interactive permissions and does not start cloud sessions.",
  },
];


export function providerById(id: AgentProviderId) {
  return PROVIDERS.find((item) => item.id === id) ?? PROVIDERS[0];
}
