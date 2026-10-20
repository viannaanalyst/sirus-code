/**
 * Links that look like links (ADR-149): GitHub URLs read as `owner/repo#12`, other
 * web addresses lose their scheme, `www.` and trailing slash, and every click resolves
 * to one place — the Pull requests page, the conversation's Sirus browser or the system
 * browser — from the modifiers held and Chat behavior's settings.
 */
import type { LinkOpenTarget } from "@/client/types";
import { composerSegments, type ComposerSegment } from "@/lib/composer-tokens";
import { splitLinks } from "@/lib/link-text";

export interface LinkChip {
  /** `owner/repo#12`, `owner/repo@abc1234`, … or the whole URL without its scheme. */
  label: string;
  /** Shows the GitHub mark instead of the site's favicon. */
  github: boolean;
}

const parse = (url: string): URL | null => {
  try {
    return new URL(/^https?:\/\//i.test(url) ? url : `https://${url}`);
  } catch {
    return null;
  }
};

/** owner, owner/repo, owner/repo#N (pull or issue), owner/repo@abc1234 (commit); null for any other GitHub page. */
export function shortenGitHubLink(url: string): string | null {
  const parsed = parse(url);
  if (!parsed || !/^(?:www\.)?github\.com$/i.test(parsed.hostname)) return null;
  const [owner, rawRepo, kind, ref] = parsed.pathname.split("/").filter(Boolean);
  if (!owner) return null;
  const repo = rawRepo?.replace(/\.git$/i, "");
  if (!repo) return owner;
  if (!kind) return `${owner}/${repo}`;
  if ((kind === "pull" || kind === "issues") && ref && /^\d+$/.test(ref)) return `${owner}/${repo}#${ref}`;
  if (kind === "commit" && ref && /^[0-9a-f]{7,40}$/i.test(ref)) return `${owner}/${repo}@${ref.slice(0, 7)}`;
  return null;
}

/** The address without `https://`, `www.` and a trailing slash. */
export function prettifyUrl(url: string): string {
  return url.replace(/^https?:\/\//i, "").replace(/^www\./i, "").replace(/\/$/, "");
}

export function describeLinkChip(url: string): LinkChip {
  const github = shortenGitHubLink(url);
  return github ? { label: github, github: true } : { label: prettifyUrl(url), github: false };
}

/** The address when inline code holds exactly one http(s) URL (agents often quote a local server's address in backticks); null otherwise. */
export function codeLinkUrl(text: string): string | null {
  const value = text.trim();
  if (!/^https?:\/\/[^\s`<>"]+$/i.test(value)) return null;
  try {
    return new URL(value).host ? value : null;
  } catch {
    return null;
  }
}

/** Whether a link's visible text is just its address (then it reads as a chip). */
export function isBareLinkText(text: string, url: string): boolean {
  const bare = (value: string) => prettifyUrl(value.trim()).toLowerCase();
  return text.trim() !== "" && bare(text) === bare(url);
}

/** Names and addresses that only make sense on this computer or network. */
export function isLocalHost(host: string): boolean {
  const name = host.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
  if (!name.includes(".") || name.includes(":")) return true;
  if (/(^|\.)(localhost|local|internal|lan|home|corp|intranet|test|example|invalid|home\.arpa|ts\.net)$/.test(name)) return true;
  // Every IP literal stays local to the favicon lookup: public ones have no favicon service entry either.
  return /^\d{1,3}(?:\.\d{1,3}){3}$/.test(name);
}

export type LinkSite = { kind: "github" } | { kind: "local" } | { kind: "site"; host: string };

/** What a link's icon shows: the GitHub mark, a local-server glyph, or the favicon of `host`. */
export function linkSite(url: string): LinkSite {
  if (shortenGitHubLink(url)) return { kind: "github" };
  const parsed = parse(url);
  if (!parsed || !/^https?:$/.test(parsed.protocol) || !parsed.hostname || isLocalHost(parsed.hostname)) return { kind: "local" };
  return { kind: "site", host: parsed.hostname.toLowerCase().replace(/^www\./, "") };
}

export interface GitHubItemLink { repository: string; number: number; kind: "pullRequest" | "issue" }

/** The pull request or issue a GitHub URL points at. */
export function parseGitHubItemUrl(url: string): GitHubItemLink | null {
  const match = /^https?:\/\/(?:www\.)?github\.com\/([\w.-]+\/[\w.-]+)\/(pull|issues)\/(\d+)(?:[/?#]|$)/i.exec(url.trim());
  if (!match) return null;
  return { repository: match[1].replace(/\.git$/i, ""), number: Number(match[3]), kind: match[2].toLowerCase() === "issues" ? "issue" : "pullRequest" };
}

/** The saved project repository's own spelling of `repository`, or null when no project has it. */
export function projectRepository(repositories: readonly string[], repository: string): string | null {
  return repositories.find((owned) => owned.toLowerCase() === repository.toLowerCase()) ?? null;
}

export interface LinkClick { metaKey?: boolean; ctrlKey?: boolean; altKey?: boolean; button?: number }

/** ⌘, Ctrl, Option and middle clicks always leave the app. */
export const wantsSystemBrowser = (click: LinkClick | null | undefined) =>
  !!click && (!!click.metaKey || !!click.ctrlKey || !!click.altKey || click.button === 1);

export type LinkDestination = { kind: "pulls"; key: string } | { kind: "browser" } | { kind: "system" };

export interface LinkRules {
  linkOpenTarget: LinkOpenTarget;
  githubLinksInApp: boolean;
  /** GitHub repositories of saved projects (`owner/repo`). */
  repositories: readonly string[];
  /** A conversation with a Sirus browser is in front (never on the phone). */
  browserAvailable: boolean;
}

/** Where a click on `url` goes. */
export function resolveLinkDestination(url: string, click: LinkClick | null | undefined, rules: LinkRules): LinkDestination {
  if (wantsSystemBrowser(click) || !/^https?:\/\//i.test(url)) return { kind: "system" };
  const item = rules.githubLinksInApp ? parseGitHubItemUrl(url) : null;
  const owned = item ? projectRepository(rules.repositories, item.repository) : null;
  if (item && owned) return { kind: "pulls", key: `${owned}#${item.number}` };
  return rules.linkOpenTarget === "app" && rules.browserAvailable ? { kind: "browser" } : { kind: "system" };
}

export interface ComposerPaint { text: string; kind: ComposerSegment["kind"] | "link" }

/**
 * What the composer's mirror paints: `/skill` and `@file` tokens, then web addresses in the
 * remaining text. The characters are the typed ones (no short label, no icon), so the
 * mirror keeps wrapping exactly like the textarea above it.
 */
export function composerPaintSegments(value: string): ComposerPaint[] {
  return composerSegments(value).flatMap((segment): ComposerPaint[] => segment.kind === "text"
    ? splitLinks(segment.text).map((part) => ({ text: part.text, kind: part.kind }))
    : [segment]);
}
