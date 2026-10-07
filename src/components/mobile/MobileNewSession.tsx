import { useEffect, useMemo, useState } from "react";
import type { AgentProviderId, ApprovalMode } from "@/client/types";
import { ArrowUp, FolderGit2, Folder } from "@/components/icons/phosphor";
import { ModelIcon } from "@/components/ModelIcon";
import { ProjectGlyph } from "@/components/ProjectGlyph";
import { ProviderIcon } from "@/components/settings/ProviderIcon";
import { useTranslation } from "@/i18n/use-translation";
import { cn } from "@/lib/cn";
import { latestModelChoices, providerModelChoices } from "@/lib/model-registry";
import { PROVIDERS, providerById } from "@/lib/provider-registry";
import { isProviderEnabled } from "@/lib/settings";
import { useAppStore } from "@/store/app-store";
import type { MobileNavigation } from "./MobileApp";

const APPROVAL_LABELS: Record<ApprovalMode, string> = { ask: "composer.askApproval", auto: "composer.autoReview", full: "composer.fullAccess" };

/** Project, model, workspace, approval and the first message in one sheet; the agent starts on the Mac. */
export function MobileNewSession({ projectId, navigation }: { projectId: string | null; navigation: MobileNavigation }) {
  const t = useTranslation();
  const projects = useAppStore((state) => state.projects);
  const agents = useAppStore((state) => state.agents);
  const settings = useAppStore((state) => state.settings);
  const catalogs = useAppStore((state) => state.modelsByProvider);
  const [project, setProject] = useState(projectId ?? [...projects].sort((a, b) => b.lastOpenedAt.localeCompare(a.lastOpenedAt))[0]?.id ?? null);
  const installed = useMemo(() => PROVIDERS.filter((definition) => agents.some((agent) => agent.id === definition.id && agent.installed) && isProviderEnabled(settings, definition.id)).map((definition) => definition.id), [agents, settings]);
  const [choice, setChoice] = useState<{ provider: AgentProviderId; model: string | null }>({ provider: settings.defaultAgent, model: null });
  const [isolated, setIsolated] = useState(settings.defaultSessionWorkspace !== "checkout");
  const [approval, setApproval] = useState<ApprovalMode>("ask");
  const [prompt, setPrompt] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => { void useAppStore.getState().loadAllModels(); }, []);
  // Keep the choice on an installed provider.
  const provider = installed.includes(choice.provider) ? choice.provider : installed[0] ?? choice.provider;
  const modes = providerById(provider).approvalModes;
  const mode = modes.includes(approval) ? approval : modes[0] ?? "ask";
  const models = useMemo(() => installed.flatMap((id) => latestModelChoices(providerModelChoices(catalogs, settings, id, null, ""), null, "").slice(0, 2).map((row) => ({ provider: id, id: row.variantIds[0] ?? row.model.id, name: row.displayName }))), [catalogs, settings, installed]);

  const start = async () => {
    const text = prompt.trim();
    if (!project || !text || busy || !installed.length) return;
    setBusy(true);
    const store = useAppStore.getState();
    useAppStore.setState({ selectedProjectId: project, selectedSessionId: null });
    await store.createSession(provider, isolated, undefined, choice.provider === provider ? choice.model : null);
    const sessionId = useAppStore.getState().selectedSessionId;
    if (!sessionId) { setBusy(false); return; }
    void useAppStore.getState().sendPrompt(text, { approval: mode }, sessionId);
    navigation.replace({ kind: "chat", sessionId });
  };

  return <div className="mobile-page mobile-sheet">
    <span className="mobile-sheet-grip" aria-hidden="true" />
    <header className="mobile-sheet-head">
      <button type="button" className="mobile-text-button" onClick={navigation.back}>{t("mobile.cancel")}</button>
      <h1>{t("mobile.newConversation")}</h1>
      <span />
    </header>
    <div className="mobile-scroll mobile-form">
      <section>
        <h2>{t("mobile.project")}</h2>
        <div className="mobile-chips mobile-chips-scroll">
          {projects.map((item) => <button key={item.id} type="button" className="mobile-chip mobile-chip-project" aria-pressed={project === item.id} onClick={() => setProject(item.id)}>
            <ProjectGlyph project={item} size={14} />{item.name}
          </button>)}
        </div>
      </section>
      <section>
        <h2>{t("mobile.model")}</h2>
        {installed.length ? <div className="mobile-card mobile-options" role="radiogroup" aria-label={t("mobile.model")}>
          {installed.map((id) => {
            const selected = provider === id && (choice.provider !== id || choice.model === null);
            return <button key={id} type="button" role="radio" aria-checked={selected} className="mobile-option" onClick={() => setChoice({ provider: id, model: null })}>
              <ProviderIcon id={id} size={18} />
              <span><span className="mobile-option-title">{providerById(id).name}</span><span className="mobile-option-help">{t("mobile.defaultModel")}</span></span>
              <span className="mobile-radio" aria-hidden="true" />
            </button>;
          })}
          {models.map((model) => {
            const selected = choice.provider === model.provider && choice.model === model.id;
            return <button key={`${model.provider}:${model.id}`} type="button" role="radio" aria-checked={selected} className="mobile-option" onClick={() => setChoice({ provider: model.provider, model: model.id })}>
              <ModelIcon modelId={model.id} provider={model.provider} />
              <span><span className="mobile-option-title">{model.name}</span><span className="mobile-option-help">{providerById(model.provider).name}</span></span>
              <span className="mobile-radio" aria-hidden="true" />
            </button>;
          })}
        </div> : <p className="mobile-empty">{t("mobile.noAgents")}</p>}
      </section>
      <section>
        <h2>{t("mobile.where")}</h2>
        <div className="mobile-segmented" role="radiogroup" aria-label={t("mobile.where")}>
          <button type="button" role="radio" aria-checked={isolated} onClick={() => setIsolated(true)}><FolderGit2 size={14} aria-hidden="true" />{t("mobile.worktree")}</button>
          <button type="button" role="radio" aria-checked={!isolated} onClick={() => setIsolated(false)}><Folder size={14} aria-hidden="true" />{t("mobile.projectFolder")}</button>
        </div>
        <p className="mobile-help">{t(isolated ? "mobile.worktreeHelp" : "mobile.folderHelp")}</p>
      </section>
      <section>
        <h2>{t("mobile.approval")}</h2>
        <div className="mobile-segmented" role="radiogroup" aria-label={t("mobile.approval")}>
          {modes.map((item) => <button key={item} type="button" role="radio" aria-checked={mode === item} onClick={() => setApproval(item)}>{t(APPROVAL_LABELS[item])}</button>)}
        </div>
      </section>
      <section>
        <textarea className={cn("mobile-textarea")} value={prompt} onChange={(event) => setPrompt(event.target.value)} placeholder={t("mobile.prompt")} aria-label={t("mobile.prompt")} rows={4} />
      </section>
      <button type="button" className="mobile-primary" disabled={!project || !prompt.trim() || busy || !installed.length} onClick={() => void start()}>{t("mobile.start")}<ArrowUp size={15} aria-hidden="true" /></button>
      <p className="mobile-help mobile-center">{t("mobile.startHelp")}</p>
    </div>
  </div>;
}
