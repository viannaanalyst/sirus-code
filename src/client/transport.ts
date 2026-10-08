export type Unlisten = () => void;

/** A native → UI message stream, passed inside command arguments (serializes to its id). */
export interface StreamChannel {
  toJSON(): string;
}

export interface Transport {
  invoke<T>(command: string, args?: Record<string, unknown>): Promise<T>;
  listen<T>(event: string, handler: (payload: T) => void): Promise<Unlisten>;
  /** Raw messages arrive as `ArrayBuffer`s, without JSON or base64. Optional for test transports. */
  channel?<T>(onMessage: (message: T) => void): Promise<StreamChannel>;
  /** Where an `<img>` loads a sent image's thumbnail by attachment id. Optional for test transports. */
  thumbnailUrl?(id: string): string | undefined;
}
