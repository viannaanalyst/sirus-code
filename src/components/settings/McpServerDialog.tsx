import { useState } from "react";
import { client } from "@/client";
import type { McpCatalog, McpProvider, McpServerInput } from "@/client/types";
import { Checkbox } from "@/components/arc/checkbox/checkbox";
import { Dialog, DialogContent } from "@/components/arc/dialog/dialog";
import { Input } from "@/components/arc/input/input";
import { Textarea } from "@/components/arc/textarea/textarea";
import { useTranslation } from "@/i18n/use-translation";
import { formatUnknownError } from "@/lib/format-error";
import { MCP_PROVIDERS, mcpInputProblem, parseMcpJson, serverFromForm } from "@/lib/mcp-servers";
import { providerById } from "@/lib/provider-registry";
import { InteractiveButton } from "@/primitives/InteractiveButton";
import { SegmentedControl } from "@/primitives/SegmentedControl";
import { ProviderIcon } from "./ProviderIcon";

const EMPTY_FORM = { name: "", kind: "command" as "command" | "url", command: "", args: "", env: "", url: "", headers: "", sse: false };

/** Add server: pasted `mcpServers` JSON or a small form, installed into the chosen providers (ADR-075). */
export function McpServerDialog({ open, projectId, installed, onClose, onDone }: { open: boolean; projectId: string | null; installed: McpProvider[]; onClose: () => void; onDone: (catalog: McpCatalog) => void }) {
  const t = useTranslation();
  const [mode, setMode] = useState<"paste" | "form">("paste");
  const [json, setJson] = useState("");
  const [form, setForm] = useState(EMPTY_FORM);
  const [providers, setProviders] = useState<McpProvider[]>([]);
  const [scope, setScope] = useState<"user" | "project">("user");
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  // Stays mounted so closing animates; each opening starts clean with the installed providers ticked.
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) { setMode("paste"); setJson(""); setForm(EMPTY_FORM); setProviders(installed.length ? installed : ["claude"]); setScope("user"); setErrors([]); }
  }
  const parsed: { servers: McpServerInput[]; error: string | null } = mode === "paste"
    ? json.trim() ? parseMcpJson(json, form.name) : { servers: [], error: null }
    : { servers: [serverFromForm(form)], error: null };
  const problem = parsed.error ?? parsed.servers.map(mcpInputProblem).find(Boolean) ?? null;
  const ready = parsed.servers.length > 0 && !problem && providers.length > 0;
  const install = async () => {
    if (!ready || busy) return;
    setBusy(true);
    setErrors([]);
    const failed: string[] = [];
    let catalog: McpCatalog | null = null;
    try {
      for (const server of parsed.servers) {
        const result = await client.mcpAction({ type: "add", projectId, providers, scope, server });
        catalog = result.catalog;
        failed.push(...result.failures.map(failure => `${server.name} · ${t("mcp.dialog.failed").replace("{provider}", providerById(failure.provider as McpProvider).name).replace("{message}", failure.message)}`));
      }
    } catch (error) {
      failed.push(formatUnknownError(error));
    } finally {
      setBusy(false);
    }
    if (catalog) onDone(catalog);
    if (failed.length) setErrors(failed); else onClose();
  };
  const field = (key: keyof typeof EMPTY_FORM) => ({ value: String(form[key]), onChange: (event: { target: { value: string } }) => setForm({ ...form, [key]: event.target.value }), disabled: busy });
  return <Dialog open={open} onOpenChange={(next) => { if (!next && !busy) onClose(); }}>
    <DialogContent title={t("mcp.dialog.title")} description={t("mcp.dialog.description")} className="w-[min(560px,calc(100vw-32px))]">
      <form className="mt-4 space-y-4" onSubmit={(event) => { event.preventDefault(); void install(); }}>
        <SegmentedControl label={t("mcp.dialog.title")} value={mode} onChange={setMode} disabled={busy} options={[{ value: "paste", label: t("mcp.dialog.paste") }, { value: "form", label: t("mcp.dialog.form") }]} />
        {mode === "paste" ? <>
          <Textarea label={t("mcp.dialog.json")} description={t("mcp.dialog.jsonHelp")} autoFocus spellCheck={false} rows={8} className="font-[family-name:var(--code-font-family)]" placeholder={'{\n  "mcpServers": {\n    "docs": { "command": "npx", "args": ["-y", "docs-mcp"] }\n  }\n}'} value={json} onChange={(event) => setJson(event.target.value)} disabled={busy} />
          {json.trim() && parsed.error === "mcp.paste.needsName" || form.name ? <Input label={t("mcp.dialog.name")} {...field("name")} /> : null}
          {parsed.servers.length ? <p className="ui-caption text-text-muted">{t("mcp.dialog.found").replace("{names}", parsed.servers.map(server => server.name).join(", "))}</p> : null}
        </> : <>
          <div className="grid grid-cols-[1fr_auto] items-end gap-3">
            <Input label={t("mcp.dialog.name")} autoFocus maxLength={64} {...field("name")} />
            <SegmentedControl label={t("mcp.dialog.kind")} value={form.kind} onChange={(kind) => setForm({ ...form, kind })} disabled={busy} options={[{ value: "command", label: t("mcp.dialog.kindCommand") }, { value: "url", label: t("mcp.dialog.kindUrl") }]} />
          </div>
          {form.kind === "command" ? <>
            <Input label={t("mcp.dialog.command")} spellCheck={false} placeholder="npx" {...field("command")} />
            <Textarea label={t("mcp.dialog.args")} rows={2} spellCheck={false} {...field("args")} />
            <Textarea label={t("mcp.dialog.env")} rows={2} spellCheck={false} {...field("env")} />
          </> : <>
            <Input label={t("mcp.dialog.url")} spellCheck={false} placeholder="https://" {...field("url")} />
            <Textarea label={t("mcp.dialog.headers")} rows={2} spellCheck={false} {...field("headers")} />
            <Checkbox label={t("mcp.dialog.sse")} checked={form.sse} onCheckedChange={(value) => setForm({ ...form, sse: value === true })} disabled={busy} />
          </>}
        </>}
        <fieldset className="space-y-2">
          <legend className="mb-1.5 ui-control font-medium text-text-primary">{t("mcp.dialog.providers")}</legend>
          <div className="flex flex-wrap gap-x-5 gap-y-2">
            {MCP_PROVIDERS.map(id => <span key={id} className="inline-flex items-center gap-1.5"><ProviderIcon id={id} size={14} /><Checkbox label={providerById(id).name} checked={providers.includes(id)} disabled={busy} onCheckedChange={(value) => setProviders(value === true ? [...providers, id] : providers.filter(item => item !== id))} /></span>)}
          </div>
        </fieldset>
        <SegmentedControl label={t("mcp.dialog.scope")} value={scope} onChange={setScope} disabled={busy || !projectId} options={[{ value: "user", label: t("mcp.dialog.scopeUser") }, { value: "project", label: t("mcp.dialog.scopeProject") }]} />
        <p className="ui-caption text-text-muted">{t("mcp.dialog.secretNote")}</p>
        {problem && (json.trim() || mode === "form") ? <p role="alert" className="ui-caption text-danger">{t(problem)}</p> : null}
        {errors.map(error => <p key={error} role="alert" className="ui-caption text-danger">{error}</p>)}
        <div className="flex justify-end gap-2">
          <InteractiveButton variant="ghost" disabled={busy} onClick={onClose}>{t("common.cancel")}</InteractiveButton>
          <InteractiveButton type="submit" variant="secondary" loading={busy} disabled={!ready}>{t("mcp.dialog.install")}</InteractiveButton>
        </div>
      </form>
    </DialogContent>
  </Dialog>;
}
