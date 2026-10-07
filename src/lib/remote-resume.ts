/**
 * Coming back to the phone app (ADR-084): iOS suspends a home-screen app in the
 * background, which drops its connection to the Mac. On return the app reconnects and
 * refreshes its data in place, without reloading the page (and its splash). It reloads
 * only when the Mac now serves a newer build, so updates arrive by themselves.
 */
export function isNewerBuild(servedHtml: string, ownScript: string): boolean {
  return ownScript.length > 0 && !servedHtml.includes(ownScript);
}
