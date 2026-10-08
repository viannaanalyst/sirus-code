import { formatUnknownError } from "@/lib/format-error";
import type { StreamChannel, Transport, Unlisten } from "./transport";

export class LocalTransport implements Transport {
  async invoke<T>(command: string, args?: Record<string, unknown>): Promise<T> {
    const { invoke } = await import("@tauri-apps/api/core");
    try {
      return await invoke<T>(command, args);
    } catch (error) {
      throw new Error(formatUnknownError(error), { cause: error });
    }
  }

  async channel<T>(onMessage: (message: T) => void): Promise<StreamChannel> {
    const { Channel } = await import("@tauri-apps/api/core");
    return new Channel<T>(onMessage);
  }

  /** The `sirus-thumb` scheme; Windows webviews reach custom schemes as `http://<scheme>.localhost`. */
  thumbnailUrl(id: string): string {
    const windows = typeof navigator !== "undefined" && navigator.userAgent.includes("Windows");
    return windows ? `http://sirus-thumb.localhost/${encodeURIComponent(id)}` : `sirus-thumb://localhost/${encodeURIComponent(id)}`;
  }

  async listen<T>(event: string, handler: (payload: T) => void): Promise<Unlisten> {
    const { listen } = await import("@tauri-apps/api/event");
    const unlisten = await listen<T>(event, (message) => handler(message.payload));
    return () => {
      void unlisten();
    };
  }
}
