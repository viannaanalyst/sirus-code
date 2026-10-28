import { useEffect, useMemo, useState } from "react";
import type { AgentProviderId, ApprovalMode } from "@/client/types";
import { ArrowUp, FolderGit2, Folder, Link2, TriangleAlert, X } from "@/components/icons/phosphor";
import { ModelIcon } from "@/components/ModelIcon";
import { ProjectIcon } from "@/components/ProjectAvatar";
import { ProviderIcon } from "@/components/settings/ProviderIcon";
import { usePhoneTranslation as useTranslation } from "./use-phone-host";
import { defaultApprovalFor } from "@/lib/composer-approval";
import { latestModelChoices, providerModelChoices } from "@/lib/model-registry";
import { PROVIDERS, providerById } from "@/lib/provider-registry";
import { isProviderEnabled } from "@/lib/settings";
import { linkedModel } from "@/lib/prompt-link";
import type { LinkedDraft } from "@/lib/phone-prompt-link";
import { useAppStore } from "@/store/app-store";
import type { MobileNavigation } from "./MobileApp";
import { MobileSelect } from "./MobileSelect";

const DEFAULT_MODEL = "__default";

const APPROVAL_LABELS: Record<ApprovalMode, string> = { ask: "composer.askApproval", auto: "composer.autoReview", full: "composer.fullAccess" };

/**
 * Project, model, workspace, approval and the first message in one sheet; the agent starts on
 * the Mac. A prompt link (ADR-124) fills the message and picks the project, provider and model
 * it names when they are here; the person still reads it and presses Start.
 */
export function MobileNewSession({ projectId, link, navigation }: { projectId: string | null; link?: LinkedDraft; navigation: MobileNavigation }) {
  const t = useTranslation();
  const projects = useAppStore((state) => state.projects);
  const agents = useAppStore((state) => state.agents);
  const settings = useAppStore((state) => state.settings);
  const catalogs = useAppStore((state) => state.modelsByProvider);
  const [project, setProject] = useState(projectId ?? [...projects].sort((a, b) => b.lastOpenedAt.localeCompare(a.lastOpenedAt))[0]?.id ?? null);
  const installed = useMemo(() => PROVIDERS.filter((definition) => agents.some((agent) => agent.id === definition.id && agent.installed) && isProviderEnabled(settings, definition.id)).map((definition) => definition.id), [agents, settings]);
  const [choice, setChoice] = useState<{ provider: AgentProviderId; model: string | null }>(() => link?.provider && installed.includes(link.provider) ? { provider: link.provider, model: link.model } : { provider: settings.defaultAgent, model: null });
  const [isolated, setIsolated] = useState(settings.defaultSessionWorkspace !== "checkout");
  // Unchosen, it follows Settings → Default permissions (ADR-130).
  const [approval, setApproval] = useState<ApprovalMode | null>(null);
  const [prompt, setPrompt] = useState(link?.prompt ?? "");
  const [busy, setBusy] = useState(false);
  useEffect(() => { void useAppStore.getState().loadAllModels(); }, []);
  // Keep the choice on an installed provider.
  const provider = installed.includes(choice.provider) ? choice.provider : installed[0] ?? choice.provider;
  const modes = providerById(provider).approvalModes;
  const mode = approval && modes.includes(approval) ? approval : defaultApprovalFor(modes, settings.defaultApproval);
  // The provider first, then one of its newest models (or its own default).
  const models = useMemo(() => latestModelChoices(providerModelChoices(catalogs, settings, provider, null, ""), null, "").map((row) => ({ id: row.variantIds[0] ?? row.model.id, name: row.displayName })), [catalogs, settings, provider]);
  // A linked model may be named by its display name or in another case; once the list is
  // loaded, one that is not there falls back to the provider's default.
  const resolved = choice.provider === provider && choice.model && models.length ? linkedModel(choice.model, models.map((item) => ({ id: item.id, displayName: item.name }))) : null;
  const model = resolved?.model ?? null;
  const linkProviderMissing = !!link?.provider && installed.length > 0 && !installed.includes(link.provider);
  const linkModelUnknown = !!link?.model && !linkProviderMissing && provider === link.provider && resolved?.known === false;

  const start = async () => {
    const text = prompt.trim();
    if (!project || !text || busy || !installed.length) return;
    setBusy(true);
    const store = useAppStore.getState();
    useAppStore.setState({ selectedProjectId: project, selectedSessionId: null });
    await store.createSession(provider, isolated, undefined, model);
    const sessionId = useAppStore.getState().selectedSessionId;
    if (!sessionId) { setBusy(false); return; }
    void useAppStore.getState().sendPrompt(text, { approval: mode }, sessionId);
    navigation.replace({ kind: "chat", sessionId });
  };

  return <div className="mobile-page mobile-sheet">
    <span className="mobile-sheet-grip" aria-hidden="true" />
    <header className="mobile-sheet-head">
      <button type="button" className="mobile-sheet-close mobile-glass" aria-label={t("mobile.cancel")} onClick={navigation.back}><X size={17} aria-hidden="true" /></button>
      <h1>{t("mobile.newConversation")}</h1>
      <span />
    </header>
    <div className="mobile-scroll mobile-form">
      {link ? <section className="mobile-link-note" role="status">
        <p className="mobile-link-note-title"><Link2 size={15} aria-hidden="true" />{t("promptLink.opened")}</p>
        <p>{t("promptLink.readFirst")}</p>
        {link.hiddenCharacters ? <p className="mobile-link-note-warning"><TriangleAlert size={14} aria-hidden="true" /><span><strong>{t("promptLink.hidden")}</strong> {t("promptLink.hiddenHelp", { count: link.hiddenCharacters })}</span></p> : null}
        {link.missingProject ? <p>{t("promptLink.missingProject", { project: link.missingProject })}</p> : null}
        {linkProviderMissing && link.provider ? <p>{t("promptLink.providerUnavailable", { provider: providerById(link.provider).name })}</p> : null}
        {linkModelUnknown ? <p>{t("promptLink.modelUnknown", { provider: providerById(provider).name })}</p> : null}
      </section> : null}
      <section className="mobile-fields">
        <MobileSelect label={t("mobile.project")} value={project} onChange={setProject}
          options={projects.map((item) => ({ value: item.id, label: item.name, icon: <ProjectIcon project={item} size={16} /> }))} />
        {installed.length ? <>
          <MobileSelect label={t("mobile.provider")} value={provider} onChange={(id) => setChoice({ provider: id, model: null })}
            options={installed.map((id) => ({ value: id, label: providerById(id).name, icon: <ProviderIcon id={id} size={18} /> }))} />
          <MobileSelect label={t("mobile.model")} value={model ?? DEFAULT_MODEL} onChange={(id) => setChoice({ provider, model: id === DEFAULT_MODEL ? null : id })}
            options={[{ value: DEFAULT_MODEL, label: t("mobile.defaultModel"), description: providerById(provider).name, icon: <ProviderIcon id={provider} size={18} /> },
              ...models.map((item) => ({ value: item.id, label: item.name, icon: <ModelIcon modelId={item.id} provider={provider} size={18} /> }))]} />
        </> : <p className="mobile-empty">{t("mobile.noAgents")}</p>}
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
        <textarea className="mobile-textarea" value={prompt} onChange={(event) => setPrompt(event.target.value)} placeholder={t("mobile.prompt")} aria-label={t("mobile.prompt")} rows={4} />
      </section>
      <button type="button" className="mobile-primary" disabled={!project || !prompt.trim() || busy || !installed.length} onClick={() => void start()}>{t("mobile.start")}<ArrowUp size={15} aria-hidden="true" /></button>
      <p className="mobile-help mobile-center">{t("mobile.startHelp")}</p>
    </div>
  </div>;
}
