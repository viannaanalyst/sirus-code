import { client } from "@/client";
import { useAppStore } from "@/store/app-store";
import { formatUnknownError } from "@/lib/format-error";
import { translate } from "@/i18n";

/** All project actions retain the clicked project ID across asynchronous work. */
export async function sidebarProjectAction(projectId: string, action: "new" | "terminal" | "review") {
  try {
    await useAppStore.getState().selectProject(projectId);
    let state = useAppStore.getState();
    if (state.selectedProjectId !== projectId) return;
    if (action === "new") { state.requestNewSession(); return; }
    const selectedSessionId = state.selectedSessionId;
    const mainView = state.mainView;
    let session = action === "review" ? state.sessions.find((row) => row.projectId === projectId && !row.sideChat && !row.worktree.isolated && !state.settings.archivedSessionIds.includes(row.id)) : undefined;
    if (!session) {
      const agent = state.agents.find((row) => row.id === state.settings.defaultAgent && !state.settings.disabledProviders.includes(row.id))?.id
        ?? state.agents.find((row) => !state.settings.disabledProviders.includes(row.id))?.id;
      if (!agent) throw new Error(translate(state.settings.locale, "providers.noInstalled"));
      const created = await client.createSession({ projectId, agent, isolatedWorktree: false, title: translate(state.settings.locale, action === "terminal" ? "Terminal" : "Review changes"), model: null });
      session = created;
      useAppStore.setState((current) => ({ sessions: [created, ...current.sessions.filter((row) => row.id !== created.id)] }));
    }
    state = useAppStore.getState();
    if (state.selectedProjectId !== projectId || state.selectedSessionId !== selectedSessionId || state.mainView !== mainView) return;
    await state.selectSession(session.id);
    if (useAppStore.getState().selectedSessionId === session.id) useAppStore.getState().openDockPane(action === "terminal" ? "terminal" : "changes");
  } catch (error) { useAppStore.setState({ error: formatUnknownError(error) }); }
}
