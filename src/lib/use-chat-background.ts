import { useEffect } from "react";
import { client } from "@/client";
import { renderBackgroundEffect, type BackgroundEffect } from "@/lib/background-effects";

/**
 * Puts the chosen chat background (ADR-089) behind the conversation panes: the image,
 * drawn with its effect, becomes `--chat-background` on the root and
 * `data-chat-background` turns it on.
 */
export function useChatBackground(name: string | null, effect: BackgroundEffect) {
  useEffect(() => {
    const root = document.documentElement;
    const clear = () => { delete root.dataset.chatBackground; root.style.removeProperty("--chat-background"); };
    if (!name) { clear(); return; }
    let cancelled = false;
    void client.chatBackgroundImage(name).then(async (url) => {
      if (cancelled) return;
      if (!url) { clear(); return; }
      const drawn = await renderBackgroundEffect(url, effect);
      if (cancelled) return;
      root.style.setProperty("--chat-background", `url("${drawn}")`);
      root.dataset.chatBackground = "on";
    }, clear);
    return () => { cancelled = true; };
  }, [name, effect]);
}
