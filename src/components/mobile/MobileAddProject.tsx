import { useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { client } from "@/client";
import type { Project } from "@/client/types";
import { FolderOpen, LoaderCircle, TriangleAlert, X } from "@/components/icons";
import { GitHubIcon } from "@/components/icons/BrandIcons";
import { formatUnknownError } from "@/lib/format-error";
import { motionTokens } from "@/lib/motion";
import { hostKind } from "@/lib/phone-host";
import { checkClone, cloneParent, folderPathLooksValid } from "@/lib/phone-projects";
import { useAppStore } from "@/store/app-store";
import type { MobileNavigation } from "./MobileApp";
import { usePhoneTranslation as useTranslation } from "./use-phone-host";

type Mode = "clone" | "folder";

/**
 * Adds a project from the phone (ADR-131), where the host has no folder picker: clone a
 * GitHub repository into the host's projects folder, or type the full path of a folder that
 * is already there. The host checks both again; a clone of an existing folder is refused.
 */
export function MobileAddProject({ then, navigation }: { then: "new" | "back"; navigation: MobileNavigation }) {
  const t = useTranslation();
  const kind = useAppStore((state) => hostKind(state.hostInfo));
  const [mode, setMode] = useState<Mode>("clone");
  const [source, setSource] = useState("");
  const [folder, setFolder] = useState("");
  const [path, setPath] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const parent = cloneParent(kind);
  const check = checkClone(source, folder);
  const typoKey = !check.ok && check.reason !== "empty" ? `phoneProjects.invalid.${check.reason}` : null;
  const ready = mode === "clone" ? check.ok : folderPathLooksValid(path);

  const added = (project: Project) => {
    useAppStore.setState((state) => ({ projects: [project, ...state.projects.filter((item) => item.id !== project.id)] }));
    if (then === "new") navigation.replace({ kind: "new", projectId: project.id });
    else navigation.back();
  };
  const submit = async () => {
    if (!ready || busy) return;
    (document.activeElement as HTMLElement | null)?.blur();
    setBusy(true);
    setError(null);
    try {
      const project = mode === "clone" && check.ok
        ? await client.cloneProject(check.source, parent, check.folder)
        : await client.addProject(path.trim());
      added(project);
    } catch (reason) {
      setError(formatUnknownError(reason));
      setBusy(false);
    }
  };

  return <div className="mobile-page mobile-sheet">
    <span className="mobile-sheet-grip" aria-hidden="true" />
    <header className="mobile-sheet-head">
      <button type="button" className="mobile-sheet-close mobile-glass" aria-label={t("mobile.cancel")} onClick={navigation.back}><X size={17} aria-hidden="true" /></button>
      <h1>{t("phoneProjects.add")}</h1>
      <span />
    </header>
    <form className="mobile-scroll mobile-form" onSubmit={(event) => { event.preventDefault(); void submit(); }}>
      <div className="mobile-segmented" role="radiogroup" aria-label={t("phoneProjects.add")}>
        <button type="button" role="radio" aria-checked={mode === "clone"} disabled={busy} onClick={() => { setMode("clone"); setError(null); }}><GitHubIcon size={14} />{t("phoneProjects.clone")}</button>
        <button type="button" role="radio" aria-checked={mode === "folder"} disabled={busy} onClick={() => { setMode("folder"); setError(null); }}><FolderOpen size={14} aria-hidden="true" />{t("phoneProjects.folder")}</button>
      </div>
      {mode === "clone" ? <section className="mobile-fields">
        <label className="mobile-field-label" htmlFor="phone-clone-source">{t("phoneProjects.repository")}</label>
        <input id="phone-clone-source" className="mobile-input mobile-input-left" value={source} disabled={busy} onChange={(event) => setSource(event.target.value)}
          placeholder="owner/repo" autoCapitalize="none" autoCorrect="off" spellCheck={false} inputMode="url" enterKeyHint="go" aria-invalid={typoKey ? true : undefined} />
        <label className="mobile-field-label" htmlFor="phone-clone-folder">{t("phoneProjects.folderName")}</label>
        <input id="phone-clone-folder" className="mobile-input mobile-input-left" value={folder} disabled={busy} onChange={(event) => setFolder(event.target.value)}
          placeholder={check.ok ? check.name : t("phoneProjects.folderNamePlaceholder")} autoCapitalize="none" autoCorrect="off" spellCheck={false} enterKeyHint="go" />
        <p className="mobile-help">{typoKey ? t(typoKey) : t("phoneProjects.cloneHelp", { path: `${parent}/${check.ok ? check.name : "…"}` })}</p>
      </section> : <section className="mobile-fields">
        <label className="mobile-field-label" htmlFor="phone-folder-path">{t("phoneProjects.path")}</label>
        <input id="phone-folder-path" className="mobile-input mobile-input-left" value={path} disabled={busy} onChange={(event) => setPath(event.target.value)}
          placeholder={kind === "mac" ? "~/Projetos/app" : "/home/me/app"} autoCapitalize="none" autoCorrect="off" spellCheck={false} enterKeyHint="go" />
        <p className="mobile-help">{t("phoneProjects.pathHelp")}</p>
      </section>}
      <AnimatePresence initial={false}>
        {error ? <motion.p key="error" role="alert" className="mobile-add-error"
          initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }} transition={{ duration: motionTokens.fast, ease: motionTokens.ease }}>
          <TriangleAlert size={14} aria-hidden="true" /><span>{error}</span>
        </motion.p> : null}
      </AnimatePresence>
      <button type="submit" className="mobile-primary" disabled={!ready || busy} aria-busy={busy || undefined}>
        {busy ? <LoaderCircle size={15} className="animate-spin" aria-hidden="true" /> : null}
        {busy ? t(mode === "clone" ? "phoneProjects.cloning" : "phoneProjects.adding") : t(mode === "clone" ? "phoneProjects.cloneButton" : "phoneProjects.addButton")}
      </button>
      {busy && mode === "clone" ? <p className="mobile-help mobile-center" role="status">{t("phoneProjects.cloningHelp")}</p> : null}
    </form>
  </div>;
}
