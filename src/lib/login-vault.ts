import type { LoginInput } from "@/client/types";

/** `example.com` or `localhost:3000` for a saved login's origin. */
export function siteLabel(origin: string): string {
  try {
    return new URL(origin).host || origin;
  } catch {
    return origin;
  }
}

/** The Settings form's fields before they become a `LoginInput`. */
export interface LoginDraft { id: string | null; site: string; username: string; password: string; totp: string; agentUse: boolean }

export const emptyLoginDraft: LoginDraft = { id: null, site: "", username: "", password: "", totp: "", agentUse: false };

/**
 * The form as the native `login_vault_save` expects it. An edit keeps the saved password when the field is
 * empty; a new login needs one. For the authenticator secret, empty keeps it, and a lone dash clears it.
 */
export function loginInput(draft: LoginDraft): LoginInput | null {
  const site = draft.site.trim();
  const username = draft.username.trim();
  if (!site || !username || (!draft.id && !draft.password)) return null;
  const totp = draft.totp.trim();
  return {
    id: draft.id,
    origin: site,
    username,
    password: draft.password || null,
    totp: totp === "" ? null : totp === "-" ? "" : totp,
    agentUse: draft.agentUse,
  };
}
