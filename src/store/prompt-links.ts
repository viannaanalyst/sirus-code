import { client } from "@/client";
import { formatUnknownError } from "@/lib/format-error";
import { linkedModel, placeLinkedPrompt, promptLinkSource } from "@/lib/prompt-link";
import { selectEnabledAgents, useAppStore, type PromptLinkNotice } from "@/store/app-store";
import { focusComposer } from "@/lib/composer-focus";

/**
 * Prompt links (ADR-122). The native side checks the link and matches its project; here
 * the project's new-thread landing opens with the prompt in its draft. Nothing is sent.
 */

let noticeSequence = 0;
const notify = (notice: DistributiveOmit<PromptLinkNotice, "id">) =>
  useAppStore.setState({ promptLinkNotice: { ...notice, id: ++noticeSequence } as PromptLinkNotice });
type DistributiveOmit<T, K extends keyof T> = T extends unknown ? Omit<T, K> : never;

function whenReady(): Promise<void> {
  if (useAppStore.getState().ready) return Promise.resolve();
  return new Promise((resolve) => {
    const stop = useAppStore.subscribe((state) => { if (state.ready) { stop(); resolve(); } });
  });
}

let receiving: Promise<void> = Promise.resolve();
/** Takes the waiting link, if any, once the app has its projects. Calls run one at a time. */
export function receivePromptLink(): Promise<void> {
  receiving = receiving.then(openWaitingLink, openWaitingLink);
  return receiving;
}

async function openWaitingLink() {
  await whenReady();
  let outcome;
  try { outcome = await client.takePromptLink(); }
  catch (error) { useAppStore.setState({ error: formatUnknownError(error) }); return; }
  if (!outcome) return;
  if (outcome.kind === "invalid") { notify({ kind: "invalid", reason: outcome.reason }); return; }
  let store = useAppStore.getState();
  const projectId = outcome.projectId ?? store.selectedProjectId ?? store.projects[0]?.id ?? null;
  if (!projectId) { notify({ kind: "noProject" }); return; }
  try {
    store.setSettingsOpen(false);
    store.setPaletteOpen(false);
    if (store.selectedProjectId !== projectId) await store.selectProject(projectId);
    useAppStore.getState().requestNewSession();
    let providerNote: Extract<PromptLinkNotice, { kind: "opened" }>["providerNote"] = null;
    if (outcome.provider) {
      store = useAppStore.getState();
      if (selectEnabledAgents(store).some((agent) => agent.id === outcome.provider)) {
        const model = linkedModel(outcome.model, store.modelsByProvider[outcome.provider]?.models);
        await store.setSessionModel(outcome.provider, model.model);
        providerNote = model.known ? "applied" : "modelUnknown";
      } else providerNote = "unavailable";
    }
    store = useAppStore.getState();
    const owner = `project:${projectId}`;
    const { draft, replaced } = placeLinkedPrompt(store.composerDrafts[owner], outcome.prompt);
    store.setComposerDraft(owner, draft);
    notify({
      kind: "opened",
      hiddenCharacters: outcome.hiddenCharacters,
      missingProject: outcome.missingProject,
      provider: outcome.provider,
      providerNote,
      restore: replaced === null ? null : { owner, text: replaced },
    });
    requestAnimationFrame(() => focusComposer(owner));
  } catch (error) {
    useAppStore.setState({ error: formatUnknownError(error) });
  }
}

/** Listens for links while the app runs and opens one that started it. */
export async function bindPromptLinks(): Promise<() => void> {
  const unlisten = await client.onPromptLink(() => { void receivePromptLink(); });
  void receivePromptLink();
  return unlisten;
}

/** Copies a link to the open composer's draft, with its project, provider and model. */
export async function copyPromptLink() {
  const state = useAppStore.getState();
  const source = promptLinkSource({
    selectedSessionId: state.selectedSessionId,
    selectedProjectId: state.selectedProjectId,
    sessions: state.sessions,
    composerDrafts: state.composerDrafts,
    defaultAgent: state.settings.defaultAgent,
    defaultModel: state.settings.defaultModel,
  });
  if (!source) { notify({ kind: "copyEmpty" }); return; }
  try {
    const link = await client.buildPromptLink(source);
    await navigator.clipboard.writeText(link);
    notify({ kind: "copied" });
  } catch (error) {
    notify({ kind: "copyFailed", message: formatUnknownError(error) });
  }
}

/** Puts back the draft a linked prompt replaced. */
export function restoreReplacedDraft(restore: { owner: string; text: string }) {
  useAppStore.getState().setComposerDraft(restore.owner, restore.text);
}
