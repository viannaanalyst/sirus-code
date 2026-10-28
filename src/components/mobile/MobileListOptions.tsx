import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "motion/react";
import type { Project } from "@/client/types";
import { Check, ChevronDown, ChevronRight, Folder, FolderOpen, Laptop, Monitor, Server } from "@/components/icons/phosphor";
import { ProjectIcon } from "@/components/ProjectAvatar";
import type { Environment } from "@/lib/environments";
import type { HomeFilter } from "@/lib/phone-home";
import { motionTokens } from "@/lib/motion";
import { useEnvironmentLabel } from "./MobileEnvironments";
import { usePhoneTranslation as useTranslation } from "./use-phone-host";

interface Choice { id: string | null; title: string; subtitle?: string; icon: ReactNode }

/**
 * Home's list options (ADR-129 addendum): a glass card above the
 * dock's filter button with Project, Computer (only with several computers) and See projects.
 * Project and Computer open a second card over the first, with a header that goes back, "All"
 * first and a check on the current choice. A tap on the scrim or Escape closes it.
 */
export function MobileListOptions({ open, anchor, projects, environments, environmentOf, storeId, filter, onProject, onComputer, onSeeProjects, onClose }: {
  open: boolean;
  anchor: HTMLElement | null;
  /** Every computer's projects, in the phone's project order. */
  projects: readonly Project[];
  /** Paired computers; the Computer row shows only with more than one. */
  environments: readonly Environment[];
  environmentOf: ReadonlyMap<string, string>;
  storeId: string;
  filter: HomeFilter;
  onProject: (projectId: string | null) => void;
  onComputer: (environmentId: string | null) => void;
  onSeeProjects: () => void;
  onClose: () => void;
}) {
  const t = useTranslation();
  const label = useEnvironmentLabel();
  const [nested, setNested] = useState<"project" | "computer" | null>(null);
  const [rect, setRect] = useState<DOMRect | null>(null);
  useEffect(() => {
    if (!open) return;
    setNested(null);
    setRect(anchor?.getBoundingClientRect() ?? null);
  }, [open, anchor]);
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setNested((current) => { if (!current) onClose(); return null; });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const multiple = environments.length > 1;
  const computerOf = (projectId: string) => environments.find((item) => item.id === (environmentOf.get(projectId) ?? storeId));
  const currentProject = projects.find((project) => project.id === filter.projectId);
  const currentComputer = environments.find((item) => item.id === filter.environmentId);
  const computerIcon = (environment: Environment | undefined) => environment?.kind === "server" ? <Server size={17} /> : <Laptop size={17} />;
  const choices: Choice[] = nested === "project" ? [
    { id: null, title: t("phoneHome.allProjects"), subtitle: t("phoneHome.allProjectsHint"), icon: <FolderOpen size={17} /> },
    ...projects.map((project) => ({ id: project.id, title: project.name, subtitle: multiple ? label(computerOf(project.id)) : undefined, icon: <ProjectIcon project={project} size={17} /> })),
  ] : nested === "computer" ? [
    { id: null, title: t("phoneHome.allComputers"), subtitle: t("phoneHome.allComputersHint"), icon: <Monitor size={17} /> },
    ...environments.map((environment) => ({ id: environment.id, title: label(environment), icon: computerIcon(environment) })),
  ] : [];
  const chosen = nested === "project" ? filter.projectId : filter.environmentId;
  const choose = (id: string | null) => {
    onClose();
    if (id === chosen) return;
    if (nested === "project") onProject(id); else onComputer(id);
  };

  const width = rect ? Math.min(300, window.innerWidth - 24) : 0;
  const left = rect ? Math.max(12, Math.min(rect.left, window.innerWidth - width - 12)) : 12;
  const bottom = rect ? window.innerHeight - rect.top + 10 : 0;
  const row = (key: string, icon: ReactNode, title: string, subtitle: string | undefined, onClick: () => void, chevron = true) =>
    <button key={key} type="button" role="menuitem" className="mobile-popover-item" tabIndex={nested ? -1 : 0} aria-haspopup={chevron ? "menu" : undefined} onClick={onClick}>
      <span className="mobile-popover-icon" aria-hidden="true">{icon}</span>
      <span className="mobile-popover-text"><span className="mobile-popover-title">{title}</span>{subtitle ? <span className="mobile-popover-subtitle">{subtitle}</span> : null}</span>
      {chevron ? <ChevronRight size={14} className="mobile-row-menu-chevron" aria-hidden="true" /> : null}
    </button>;

  return createPortal(<AnimatePresence>
    {open && rect ? <motion.div key="list-options" className="mobile-list-options-layer" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: motionTokens.fast }}>
      <div className="mobile-menu-scrim mobile-popover-scrim" onClick={onClose} />
      <motion.div role="menu" aria-label={t("phoneHome.listOptions")} className="mobile-list-options mobile-glass" style={{ bottom, left, width, transformOrigin: "bottom left" }}
        initial={{ opacity: 0, scale: 0.92, y: 6 }} animate={{ opacity: nested ? 0.55 : 1, scale: nested ? 0.97 : 1, y: 0 }} exit={{ opacity: 0, scale: 0.96 }}
        transition={{ duration: motionTokens.normal, ease: motionTokens.ease }}>
        <p className="mobile-list-options-title">{t("phoneHome.listOptions")}</p>
        {row("project", <Folder size={17} />, t("phoneHome.filterProject"), currentProject?.name ?? t("phoneHome.allProjects"), () => setNested("project"))}
        {multiple ? row("computer", computerIcon(currentComputer), t("phoneHome.filterComputer"), currentComputer ? label(currentComputer) : t("phoneHome.allComputers"), () => setNested("computer")) : null}
        {row("projects", <FolderOpen size={17} />, t("phoneHome.seeProjects"), undefined, () => { onClose(); onSeeProjects(); }, false)}
      </motion.div>
      <AnimatePresence>
        {nested ? <motion.div key={nested} role="menu" aria-label={t(nested === "project" ? "phoneHome.filterProject" : "phoneHome.filterComputer")} className="mobile-list-options mobile-list-options-nested mobile-glass"
          style={{ bottom: bottom + 14, left: Math.min(left + 14, window.innerWidth - width - 12), width, transformOrigin: "bottom left" }}
          initial={{ opacity: 0, scale: 0.92, y: 8 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.95, y: 4 }}
          transition={{ duration: motionTokens.normal, ease: motionTokens.ease }}>
          <button type="button" className="mobile-list-options-head" aria-label={t("phoneHome.back")} onClick={() => setNested(null)}>
            <span>{t(nested === "project" ? "phoneHome.filterProject" : "phoneHome.filterComputer")}</span>
            <ChevronDown size={14} aria-hidden="true" />
          </button>
          <div className="mobile-list-options-choices">
            {choices.map((choice) => <button key={choice.id ?? "all"} type="button" role="menuitemradio" aria-checked={choice.id === chosen} className="mobile-popover-item" onClick={() => choose(choice.id)}>
              <span className="mobile-popover-icon" aria-hidden="true">{choice.icon}</span>
              <span className="mobile-popover-text"><span className="mobile-popover-title">{choice.title}</span>{choice.subtitle ? <span className="mobile-popover-subtitle">{choice.subtitle}</span> : null}</span>
              <span className="mobile-list-options-check" aria-hidden="true">{choice.id === chosen ? <Check size={16} /> : null}</span>
            </button>)}
          </div>
        </motion.div> : null}
      </AnimatePresence>
    </motion.div> : null}
  </AnimatePresence>, document.body);
}
