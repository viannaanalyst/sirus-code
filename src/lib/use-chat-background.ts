import { useEffect } from "react";
import { client } from "@/client";
import { releaseBackgroundEffects, renderBackgroundEffect, type BackgroundEffect } from "@/lib/background-effects";

/**
 * Puts the chosen chat background (ADR-089) behind the conversation panes: the image,
 * drawn with its effect, becomes `--chat-background` on the root and
 * `data-chat-background` turns it on. The variable holds a short `blob:` URL (owned and
 * revoked by the effects cache), so style recalcs on the root never re-read the image.
 * It stays on the root because the Appearance settings preview reads it too.
 */
export function useChatBackground(name: string | null, effect: BackgroundEffect) {
  useEffect(() => {
    const root = document.documentElement;
    const clear = () => { delete root.dataset.chatBackground; root.style.removeProperty("--chat-background"); };
    if (!name) { clear(); releaseBackgroundEffects(); return; }
    let cancelled = false;
    void client.chatBackgroundImage(name).then(async (source) => {
      if (cancelled) return;
      if (!source) { clear(); return; }
      const url = await renderBackgroundEffect(source, effect);
      if (cancelled) return;
      root.style.setProperty("--chat-background", `url("${url}")`);
      root.dataset.chatBackground = "on";
    }).catch(clear);
    return () => { cancelled = true; };
  }, [name, effect]);
}
