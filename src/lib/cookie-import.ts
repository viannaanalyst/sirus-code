import type { CookieDomain } from "@/client/types";

/** Nothing is preselected: the owner ticks every domain they want. */
export function initialSelection(): Set<string> {
  return new Set();
}

export function toggleDomain(selected: ReadonlySet<string>, domain: string): Set<string> {
  const next = new Set(selected);
  if (next.has(domain)) next.delete(domain);
  else next.add(domain);
  return next;
}

/** The domains matching a search, by substring and ignoring case. An empty search keeps all of them. */
export function filterDomains(domains: readonly CookieDomain[], query: string): CookieDomain[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [...domains];
  return domains.filter((item) => item.domain.includes(needle));
}

/** The ticked domains in the order the list shows them, which is the order the consent step names them. */
export function selectedDomains(domains: readonly CookieDomain[], selected: ReadonlySet<string>): string[] {
  return domains.filter((item) => selected.has(item.domain)).map((item) => item.domain);
}

/** How many cookies the ticked domains carry (the counts shown in the list). */
export function selectedCookieCount(domains: readonly CookieDomain[], selected: ReadonlySet<string>): number {
  return domains.reduce((total, item) => (selected.has(item.domain) ? total + item.count : total), 0);
}

/** Import needs at least one ticked domain; the consent step is only reachable through this. */
export function canReviewSelection(selected: ReadonlySet<string>): boolean {
  return selected.size > 0;
}

/** The back end answers `full_disk_access` when macOS refuses Safari's cookie file. */
export function isFullDiskAccessError(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && (error as { code?: unknown }).code === "full_disk_access");
}
