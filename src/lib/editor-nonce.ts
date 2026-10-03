/** Reuse the authorization on Tauri's existing head style; never weaken CSP. */
export function editorStyleNonce(document: Pick<Document, "head">): string | undefined {
  return document.head.querySelector<HTMLStyleElement>("style[nonce]")?.nonce || undefined;
}

/** Radix's existing scroll guards also generate styles through this nonce API. */
export function configureDynamicStyleNonce(document: Pick<Document, "head">): void {
  const nonce = editorStyleNonce(document);
  if (nonce) setNonce(nonce);
}
import { setNonce } from "get-nonce";
