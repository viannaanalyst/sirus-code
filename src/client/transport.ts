export type Unlisten = () => void;

export interface Transport {
  invoke<T>(command: string, args?: Record<string, unknown>): Promise<T>;
  listen<T>(event: string, handler: (payload: T) => void): Promise<Unlisten>;
  /** Where an `<img>` loads a sent image's thumbnail by attachment id. Optional for test transports. */
  thumbnailUrl?(id: string): string | undefined;
}
