import { Dialog, DialogContent } from "@/components/arc/dialog/dialog";
import { Input } from "@/components/arc/input/input";
import { Select } from "@/components/arc/select/select";
import { RadioCards } from "@/components/arc/radio-cards/radio-cards";
import { useState } from "react";
import { ModelSelector } from "@/components/ModelSelector";
import { selectCurrentProject, useAppStore } from "@/store/app-store";
import type { AgentProviderId } from "@/client/types";
import { parseModelKey } from "@/lib/settings";
import { translate } from "@/i18n";
import { InteractiveButton } from "@/primitives/InteractiveButton";

export function NewSessionDialog() {
  const open = useAppStore((state) => state.newSessionOpen);
  const setOpen = useAppStore((state) => state.setNewSessionOpen);
  const locale = useAppStore((state) => state.settings.locale);
  const t = (key: string) => translate(locale, key);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent title={t("session.new")} description={t("session.description")} className="w-[min(480px,calc(100vw-32px))]">
        <SessionForm onClose={() => setOpen(false)} />
      </DialogContent>
    </Dialog>

  );
}

function SessionForm({ onClose }: { onClose: () => void }) {
  const settings = useAppStore((state) => state.settings);
  const agents = useAppStore((state) => state.agents);
  const projects = useAppStore((state) => state.projects);
  const project = useAppStore(selectCurrentProject);
  const identities = useAppStore((state) => state.gitByPath);
  const createSession = useAppStore((state) => state.createSession);
  const selectProject = useAppStore((state) => state.selectProject);
  const t = (key: string) => translate(settings.locale, key);
  const [title, setTitle] = useState("");
  const [projectId, setProjectId] = useState(project?.id ?? projects[0]?.id ?? "");
  const enabled = agents.filter((item) => item.installed && !settings.disabledProviders.includes(item.id));
  const [provider, setProvider] = useState<AgentProviderId>(enabled.find((item) => item.id === settings.defaultAgent)?.id ?? enabled[0]?.id ?? settings.defaultAgent);
  const [model, setModel] = useState<string | null>(() => {
    const parsed = parseModelKey(settings.defaultModel);
    return parsed?.provider === provider ? parsed.id : null;
  });
  const [isolated, setIsolated] = useState(settings.defaultSessionWorkspace === "worktree");
  const [busy, setBusy] = useState(false);
  const effectiveProjectId = projects.some((item) => item.id === projectId) ? projectId : project?.id ?? projects[0]?.id ?? "";
  const target = projects.find((item) => item.id === effectiveProjectId);
  const isRepo = target ? identities[target.path]?.isRepo === true : false;
  const validProvider = enabled.some((item) => item.id === provider);
  return (
    <form onSubmit={(event) => {
      event.preventDefault();
      if (busy || !target || !validProvider) return;
      setBusy(true);
      void (async () => {
        try {
          if (effectiveProjectId !== useAppStore.getState().selectedProjectId) await selectProject(effectiveProjectId);
          await createSession(provider, isolated && isRepo, title || undefined, model);
        } finally { setBusy(false); }
      })();
    }}>
      <div className="mt-4"><Select label={t("project.title")} value={effectiveProjectId} onValueChange={setProjectId} disabled={busy || projects.length === 0} placeholder={t("project.open")} options={projects.map((item) => ({ value: item.id, label: item.name }))} /></div>
      {target ? <p className="mt-1 truncate font-mono ui-caption text-text-muted" title={target.path}>{target.path}</p> : <InteractiveButton className="mt-2" onClick={() => void useAppStore.getState().addProjectFromPicker()}>{t("project.open")}</InteractiveButton>}
      <div className="mt-3"><Input label={t("session.titleOptional")} maxLength={200} value={title} onChange={(event) => setTitle(event.target.value)} placeholder={t("session.titlePlaceholder")} disabled={busy} /></div>
      <div className="mt-3">
        <p className="mb-1 ui-control text-text-secondary">{t("models.models")}</p>
        <ModelSelector currentProvider={provider} currentModel={model} disabled={busy} onSelect={(id, value) => { setProvider(id); setModel(value); }} />
        {!validProvider ? <p className="mt-1 ui-control text-text-muted">{t("providers.noInstalled")}</p> : null}
      </div>
      <div className="mt-4">
        <p className="mb-2 ui-control text-text-secondary">{t("Workspace")}</p>
        <RadioCards aria-label={t("Workspace")} name="workspace" layout="list" value={isolated && isRepo ? "worktree" : "checkout"} disabled={busy} onValueChange={(next) => setIsolated(next === "worktree")}
          options={[
            { value: "checkout", label: t("workspace.checkout"), description: t("Shared working directory") },
            { value: "worktree", label: t("workspace.isolated"), description: t("Separate branch and working directory"), disabled: !isRepo, disabledReason: t("workspace.requiresGit") },
          ]} />
      </div>
      <div className="mt-5 flex justify-end gap-2">
        <InteractiveButton variant="ghost" onClick={onClose} disabled={busy}>{t("common.cancel")}</InteractiveButton>
        <InteractiveButton type="submit" variant="primary" loading={busy} disabled={!target || !validProvider}>{busy ? t("session.creating") : t("session.create")}</InteractiveButton>
      </div>
    </form>
  );
}
