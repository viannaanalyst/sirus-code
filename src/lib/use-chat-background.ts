import { useEffect } from "react";
import { client } from "@/client";

/**
 * Puts the chosen chat background (ADR-089) behind the conversation panes: the image
 * becomes `--chat-background` on the root and `data-chat-background` turns it on.
 */
export function useChatBackground(name: string | null) {
  useEffect(() => {
    const root = document.documentElement;
    const clear = () => { delete root.dataset.chatBackground; root.style.removeProperty("--chat-background"); };
    if (!name) { clear(); return; }
    let cancelled = false;
    void client.chatBackgroundImage(name).then((url) => {
      if (cancelled) return;
      if (!url) { clear(); return; }
      root.style.setProperty("--chat-background", `url("${url}")`);
      root.dataset.chatBackground = "on";
    }, clear);
    return () => { cancelled = true; };
  }, [name]);
}
