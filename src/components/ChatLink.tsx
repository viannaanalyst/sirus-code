import { AppWindow, CircleDot, Copy, ExternalLink, GitPullRequest, Globe, Server } from "@/components/icons/phosphor";
import { useEffect, useState, useSyncExternalStore, type MouseEvent, type ReactNode } from "react";
import { client, isRemoteUi } from "@/client";
import { ContextMenu, type ContextMenuItem } from "@/components/arc/context-menu/context-menu";
import { GitHubIcon } from "@/components/icons/BrandIcons";
import { useTranslation } from "@/i18n/use-translation";
import { describeLinkChip, linkSite, parseGitHubItemUrl, projectRepository, resolveLinkDestination, wantsSystemBrowser, type LinkClick, type LinkDestination } from "@/lib/link-chips";
import { useAppStore } from "@/store/app-store";

/*
 * Links in chat and terminals (ADR-149): one place decides where a click goes, which
 * right-click actions a link offers and which icon it wears.
 */

// GitHub repositories of saved projects, read natively at most once a minute.
let repositories: string[] = [];
let repositoriesAt = 0;
let repositoriesPending: Promise<string[]> | null = null;
const repositoryListeners = new Set<() => void>();

export function loadProjectRepositories(): Promise<string[]> {
  if (repositoriesPending) return repositoriesPending;
  if (Date.now() - repositoriesAt < 60_000) return Promise.resolve(repositories);
  repositoriesPending = client.pullRequestAction({ type: "repositories" })
    .then((response) => response.type === "repositories" ? response.repositories.map((entry) => entry.repository) : repositories)
    .catch(() => repositories)
    .then((list) => {
      repositories = list;
      repositoriesAt = Date.now();
      repositoriesPending = null;
      repositoryListeners.forEach((listener) => listener());
      return list;
    });
  return repositoriesPending;
}

const subscribeRepositories = (listener: () => void) => { repositoryListeners.add(listener); return () => { repositoryListeners.delete(listener); }; };
const readRepositories = () => repositories;

/** Opens `url` at a destination already decided. */
export function openLinkAt(url: string, destination: LinkDestination, sessionId = useAppStore.getState().selectedSessionId) {
  const store = useAppStore.getState();
  if (destination.kind === "pulls") {
    useAppStore.setState({ pullsSelection: destination.key });
    store.setMainView("pulls");
    return;
  }
  if (destination.kind === "browser" && sessionId && !isRemoteUi) {
    void (async () => {
      const state = useAppStore.getState();
      if (!state.browserBySession[sessionId]?.open && !(await state.openBrowser(sessionId))) return;
      if (!(await useAppStore.getState().browserNewTab(sessionId, url))) return;
      useAppStore.getState().openDockPane("browser");
    })();
    return;
  }
  void client.openExternalUrl(url).catch(() => void navigator.clipboard.writeText(url));
}

/** A click on a link: modifiers, Open links in and the project's pull requests decide where it goes. */
export async function openLinkFrom(url: string, click: LinkClick | null) {
  const store = useAppStore.getState();
  const sessionId = store.selectedSessionId;
  const { linkOpenTarget, githubLinksInApp } = store.settings;
  const needsRepositories = githubLinksInApp && !wantsSystemBrowser(click) && !!parseGitHubItemUrl(url);
  const known = needsRepositories ? await loadProjectRepositories() : repositories;
  openLinkAt(url, resolveLinkDestination(url, click, { linkOpenTarget, githubLinksInApp, repositories: known, browserAvailable: !isRemoteUi && !!sessionId }), sessionId);
}

/** `external`: the system browser regardless of settings (⌘-click and friends). */
export function openLink(url: string, external: boolean) {
  void openLinkFrom(url, external ? { metaKey: true } : null);
}

/** Right-click actions for a link; empty for none, so no menu shows. */
export function useLinkMenuItems(url: string | null): ContextMenuItem[] {
  const t = useTranslation();
  const known = useSyncExternalStore(subscribeRepositories, readRepositories, readRepositories);
  const sessionId = useAppStore((state) => state.selectedSessionId);
  if (!url) return [];
  const item = parseGitHubItemUrl(url);
  const owned = item ? projectRepository(known, item.repository) : null;
  return [
    ...(item && owned ? [{
      id: "item", label: t(item.kind === "issue" ? "link.openIssue" : "link.openPull"),
      icon: item.kind === "issue" ? <CircleDot size={15} /> : <GitPullRequest size={15} />,
      onSelect: () => openLinkAt(url, { kind: "pulls", key: `${owned}#${item.number}` }),
    }] : []),
    ...(!isRemoteUi && sessionId ? [{ id: "sirus", label: t("link.openInSirus"), icon: <AppWindow size={15} />, onSelect: () => openLinkAt(url, { kind: "browser" }, sessionId) }] : []),
    { id: "system", label: t("link.openInSystem"), icon: <ExternalLink size={15} />, onSelect: () => openLinkAt(url, { kind: "system" }) },
    { id: "copy", label: t("link.copy"), icon: <Copy size={15} />, group: "copy", onSelect: () => void navigator.clipboard.writeText(url) },
  ];
}

// Favicons by host: one native lookup per host per window, at most 500 remembered.
const favicons = new Map<string, Promise<string | null>>();
const faviconsSettled = new Map<string, string | null>();
function loadFavicon(host: string): Promise<string | null> {
  let pending = favicons.get(host);
  if (!pending) {
    pending = client.siteFavicon(host).catch(() => null).then((src) => {
      faviconsSettled.set(host, src);
      if (faviconsSettled.size > 500) {
        const oldest = faviconsSettled.keys().next().value!;
        faviconsSettled.delete(oldest);
        favicons.delete(oldest);
      }
      return src;
    });
    favicons.set(host, pending);
  }
  return pending;
}

function SiteFavicon({ host }: { host: string }) {
  const [loaded, setLoaded] = useState<{ host: string; src: string | null } | null>(null);
  const src = loaded?.host === host ? loaded.src : faviconsSettled.get(host);
  useEffect(() => {
    if (faviconsSettled.has(host)) return;
    let alive = true;
    void loadFavicon(host).then((value) => { if (alive) setLoaded({ host, src: value }); });
    return () => { alive = false; };
  }, [host]);
  // The globe holds the place while the icon loads and stays when there is none.
  return src ? <img src={src} alt="" aria-hidden="true" draggable={false} className="chat-link-icon chat-link-favicon" onError={() => setLoaded({ host, src: null })} />
    : <Globe size={13} aria-hidden="true" className="chat-link-icon" />;
}

/** The GitHub mark, a local-server glyph, or the site's favicon. */
export function LinkIcon({ url }: { url: string }) {
  const site = linkSite(url);
  if (site.kind === "github") return <GitHubIcon size={13} className="chat-link-icon" />;
  if (site.kind === "local") return <Server size={13} aria-hidden="true" className="chat-link-icon" />;
  return <SiteFavicon host={site.host} />;
}

const onLinkClick = (url: string) => (event: MouseEvent<HTMLAnchorElement>) => {
  event.preventDefault();
  void openLinkFrom(url, event);
};
const onLinkAuxClick = (url: string) => (event: MouseEvent<HTMLAnchorElement>) => {
  if (event.button !== 1) return;
  event.preventDefault();
  void openLinkFrom(url, event);
};

/**
 * A web link in chat. `chip` shows the pill (ADR-149): the short label (`owner/repo#12`) or the
 * host and the middle-shortened path (`example.com/docs/…/page`), on one line; otherwise `children`
 * (the text the reply wrote) follows the icon. The full URL is the tooltip.
 */
export function ChatLink({ url, chip = false, children }: { url: string; chip?: boolean; children?: ReactNode }) {
  const t = useTranslation();
  const items = useLinkMenuItems(url);
  const label = chip ? describeLinkChip(url) : null;
  return <ContextMenu inline activation="context-only" label={t("link.actions", { url })} items={items}>
    <a href="#" title={url} className={chip ? "chat-link chat-link-chip" : "chat-link"} data-link-url={url}
      onClick={onLinkClick(url)} onAuxClick={onLinkAuxClick(url)}
      onPointerEnter={() => { if (parseGitHubItemUrl(url)) void loadProjectRepositories(); }}
      onContextMenu={() => { if (parseGitHubItemUrl(url)) void loadProjectRepositories(); requestAnimationFrame(() => window.getSelection()?.removeAllRanges()); }}>
      <LinkIcon url={url} />{label ? <span className="chat-link-text">{label.github ? label.label : <><span className="chat-link-host">{label.host}</span><span className="chat-link-path">{label.path}</span></>}</span> : children}
    </a>
  </ContextMenu>;
}
