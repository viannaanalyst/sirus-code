/** Turns typed address-bar text into a loadable URL or a Google search. */
export function normalizeBrowserAddressInput(input: string): string | null {
  const value = input.trim();
  if (!value) return null;
  if (/^https?:\/\//i.test(value)) return value;
  if (/^about:blank$/i.test(value)) return value;
  const hostLike =
    /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?(\/.*)?$/i.test(value) ||
    /^[^\s/?#]+\.[^\s/?#]+/.test(value);
  if (hostLike && !/\s/.test(value)) return `https://${value}`;
  return `https://www.google.com/search?q=${encodeURIComponent(value)}`;
}

/** Address-bar display value; blank documents render empty. */
export function browserAddressDisplayValue(url: string): string {
  return url === "about:blank" ? "" : url;
}
