import { useState } from "react";
import { Check, ChevronDown, Folder, FolderPlus, GitBranch, GitBranchPlus, Laptop, MessageCircle, Plus, Search, X } from "@/components/icons/phosphor";
import { client } from "@/client";
import type { BranchInfo } from "@/client/types";
import { useTranslation } from "@/i18n/use-translation";
import { formatUnknownError } from "@/lib/format-error";
import { cn } from "@/lib/cn";
import { Popover, PopoverContent, PopoverTrigger } from "@/primitives/Popover";
import { selectCurrentProject, useAppStore } from "@/store/app-store";

const chip = "flex min-w-0 items-center gap-1.5 rounded-[8px] px-2 py-1 ui-caption text-text-secondary transition-colors duration-[var(--motion-fast)] hover:bg-background-3 hover:text-text-primary";
const menuRow = "flex w-full items-center gap-2 rounded-[6px] px-2 py-1.5 text-left ui-control text-text-secondary hover:bg-background-3 hover:text-text-primary disabled:pointer-events-none disabled:opacity-40";
const searchInput = "w-full bg-transparent ui-control text-text-primary outline-none placeholder:text-text-muted";

/** New-thread landing controls: project, workspace and branch, like Synara's composer row. */
export function LandingControls() {
  const t = useTranslation();
  const project = useAppStore(selectCurrentProject);
  const projects = useAppStore((state) => state.projects);
  const selectProject = useAppStore((state) => state.selectProject);
  const addProjectFromPicker = useAppStore((state) => state.addProjectFromPicker);
  const draftIsolated = useAppStore((state) => state.draftIsolated);
  const setDraftIsolated = useAppStore((state) => state.setDraftIsolated);
  const draftTemporary = useAppStore((state) => state.draftTemporary);
  const setDraftTemporary = useAppStore((state) => state.setDraftTemporary);
  const gitByPath = useAppStore((state) => state.gitByPath);
  const refreshProjectGit = useAppStore((state) => state.refreshProjectGit);
  const [projectOpen, setProjectOpen] = useState(false);
  const [workspaceOpen, setWorkspaceOpen] = useState(false);
  const [branchOpen, setBranchOpen] = useState(false);
  const [projectQuery, setProjectQuery] = useState("");
  const [branches, setBranches] = useState<BranchInfo[] | null>(null);
  const [branchQuery, setBranchQuery] = useState("");
  const [creating, setCreating] = useState(false);
  const [newBranch, setNewBranch] = useState("");
  const [busy, setBusy] = useState(false);
  const setStoreError = (message: string) => useAppStore.setState({ error: message });

  if (!project) return null;
  const identity = gitByPath[project.path];
  const isRepo = identity?.isRepo ?? false;
  const branch = identity?.branch ?? null;

  const loadBranches = () => {
    setBranches(null);
    setBranchQuery("");
    setCreating(false);
    setNewBranch("");
    client
      .listBranches(project.id)
      .then(setBranches)
      .catch((reason: unknown) => {
        setBranches([]);
        setStoreError(formatUnknownError(reason));
      });
  };
  const switchBranch = async (name: string) => {
    if (busy || name === branch) return;
    setBusy(true);
    try {
      await client.checkoutBranch(project.id, name);
      await refreshProjectGit(project.id);
      setBranchOpen(false);
    } catch (reason) {
      setStoreError(formatUnknownError(reason));
    } finally {
      setBusy(false);
    }
  };
  const createAndSwitch = async () => {
    const name = newBranch.trim();
    if (!name || busy) return;
    setBusy(true);
    try {
      await client.createBranch(project.id, name);
      setCreating(false);
      setNewBranch("");
      await refreshProjectGit(project.id);
      await client.listBranches(project.id).then(setBranches).catch(() => undefined);
      setBranchOpen(false);
    } catch (reason) {
      setStoreError(formatUnknownError(reason));
    } finally {
      setBusy(false);
    }
  };

  const filteredProjects = projects.filter((item) => item.name.toLowerCase().includes(projectQuery.trim().toLowerCase()));
  const filteredBranches = (branches ?? []).filter((item) => item.name.toLowerCase().includes(branchQuery.trim().toLowerCase()));

  return (
    // A glass tray that tucks under the composer (after ChatGPT's); the row itself does not move.
    <div className="relative z-[5] px-6"><div className="mx-auto w-full max-w-[var(--chat-column-width)]">
    <div className="landing-tray flex flex-wrap items-center gap-1">
      <Popover open={projectOpen} onOpenChange={(open) => { setProjectOpen(open); if (open) setProjectQuery(""); }}>
        <PopoverTrigger asChild>
          <button type="button" className={chip} aria-label={t("Project")} title={t("Work in")}>
            <Folder size={13} aria-hidden="true" />
            <span className="max-w-[160px] truncate">{project.name}</span>
          </button>
        </PopoverTrigger>
        <PopoverContent align="start" side="top" sideOffset={8} className="w-64 p-1">
          <div className="flex items-center gap-2 px-2 py-1.5 text-text-muted">
            <Search size={13} aria-hidden="true" />
            <input autoFocus value={projectQuery} onChange={(event) => setProjectQuery(event.target.value)} placeholder={t("Search projects")} className={searchInput} />
          </div>
          <div className="scroll-thin max-h-56 overflow-y-auto">
            {filteredProjects.map((item) => (
              <button
                key={item.id}
                type="button"
                className={menuRow}
                onClick={() => {
                  void selectProject(item.id);
                  setProjectOpen(false);
                }}
              >
                <Folder size={14} className="shrink-0 text-text-muted" aria-hidden="true" />
                <span className="min-w-0 flex-1 truncate">{item.name}</span>
                {item.id === project.id ? <Check size={13} aria-hidden="true" /> : null}
              </button>
            ))}
          </div>
          <div className="mt-1 border-t border-border-subtle pt-1">
            <button
              type="button"
              className={menuRow}
              onClick={() => {
                setProjectOpen(false);
                void addProjectFromPicker();
              }}
            >
              <Plus size={14} aria-hidden="true" />
              {t("New project")}
            </button>
            <button
              type="button"
              className={menuRow}
              onClick={() => {
                setProjectOpen(false);
                useAppStore.getState().setCreateProjectOpen(true);
              }}
            >
              <FolderPlus size={14} aria-hidden="true" />
              {t("newProject.menu")}
            </button>
          </div>
        </PopoverContent>
      </Popover>

      <Popover open={workspaceOpen} onOpenChange={setWorkspaceOpen}>
        <PopoverTrigger asChild>
          <button type="button" className={chip} aria-label={t("Work in")}>
            <Laptop size={13} aria-hidden="true" />
            <span>{t(draftIsolated ? "New worktree" : "Local")}</span>
            <ChevronDown size={11} className="text-text-muted" aria-hidden="true" />
          </button>
        </PopoverTrigger>
        <PopoverContent align="start" side="top" sideOffset={8} className="w-56 p-1">
          <p className="px-2 py-1 ui-caption text-text-muted">{t("Work in")}</p>
          <button
            type="button"
            className={menuRow}
            onClick={() => {
              setDraftIsolated(false);
              setWorkspaceOpen(false);
            }}
          >
            <Laptop size={14} aria-hidden="true" />
            <span className="flex-1">{t("Local project")}</span>
            {!draftIsolated ? <Check size={13} aria-hidden="true" /> : null}
          </button>
          <button
            type="button"
            className={menuRow}
            disabled={!isRepo}
            title={!isRepo ? t("Isolated worktrees require a Git repository.") : undefined}
            onClick={() => {
              setDraftIsolated(true);
              setWorkspaceOpen(false);
            }}
          >
            <GitBranchPlus size={14} aria-hidden="true" />
            <span className="flex-1">{t("New worktree")}</span>
            {draftIsolated ? <Check size={13} aria-hidden="true" /> : null}
          </button>
          {!isRepo ? <p className="px-2 py-1 ui-caption text-text-muted">{t("Isolated worktrees require a Git repository.")}</p> : null}
        </PopoverContent>
      </Popover>

      {isRepo ? (
        <Popover
          open={branchOpen}
          onOpenChange={(open) => {
            setBranchOpen(open);
            if (open) loadBranches();
          }}
        >
          <PopoverTrigger asChild>
            <button type="button" className={chip} aria-label={t("Branch")}>
              <GitBranch size={13} aria-hidden="true" />
              <span className="max-w-[140px] truncate">{branch ?? "—"}</span>
              <ChevronDown size={11} className="text-text-muted" aria-hidden="true" />
            </button>
          </PopoverTrigger>
          <PopoverContent align="start" side="top" sideOffset={8} className="w-64 p-1">
            <div className="flex items-center gap-2 px-2 py-1.5 text-text-muted">
              <Search size={13} aria-hidden="true" />
              <input autoFocus value={branchQuery} onChange={(event) => setBranchQuery(event.target.value)} placeholder={t("Search branches…")} className={searchInput} />
            </div>
            <div className="scroll-thin max-h-56 overflow-y-auto">
              {branches === null ? (
                <p className="px-2 py-2 ui-caption text-text-muted">{t("common.loading")}</p>
              ) : (
                filteredBranches.map((item) => (
                  <button
                    key={item.name}
                    type="button"
                    disabled={busy}
                    className={cn(menuRow, item.current && "text-text-primary")}
                    onClick={() => void switchBranch(item.name)}
                  >
                    <span className="min-w-0 flex-1 truncate">{item.name}</span>
                    {item.current ? <span className="shrink-0 ui-caption text-text-muted">{t("current")}</span> : null}
                  </button>
                ))
              )}
            </div>
            <div className="mt-1 border-t border-border-subtle pt-1">
              {creating ? (
                <div className="flex items-center gap-1 px-1 py-1">
                  <input
                    autoFocus
                    value={newBranch}
                    onChange={(event) => setNewBranch(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") void createAndSwitch();
                    }}
                    placeholder={t("New branch name")}
                    className="min-w-0 flex-1 rounded-[6px] border border-border-subtle bg-background-2 px-2 py-1 ui-caption outline-none focus-visible:border-border-default"
                  />
                  <button type="button" disabled={!newBranch.trim() || busy} onClick={() => void createAndSwitch()} className="rounded-[6px] px-2 py-1 ui-caption text-accent disabled:opacity-40">
                    {t("Create")}
                  </button>
                  <button
                    type="button"
                    aria-label={t("common.cancel")}
                    onClick={() => {
                      setCreating(false);
                      setNewBranch("");
                    }}
                    className="rounded-[6px] p-1 text-text-muted hover:text-text-primary"
                  >
                    <X size={12} />
                  </button>
                </div>
              ) : (
                <button type="button" className={menuRow} onClick={() => setCreating(true)}>
                  <Plus size={14} aria-hidden="true" />
                  {t("Create and checkout new branch…")}
                </button>
              )}
            </div>
          </PopoverContent>
        </Popover>
      ) : null}

      <button type="button" className={cn(chip, "ml-auto", draftTemporary && "bg-background-3 text-text-primary")} aria-pressed={draftTemporary}
        title={t("temporary.hint")} onClick={() => setDraftTemporary(!draftTemporary)}>
        <MessageCircle size={13} aria-hidden="true" fill={draftTemporary ? "currentColor" : "none"} />
        <span>{t("temporary.label")}</span>
      </button>
    </div>
    </div></div>
  );
}
