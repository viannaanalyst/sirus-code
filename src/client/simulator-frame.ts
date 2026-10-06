import type { SimulatorFrame } from "./types";

const MAGIC = 0x5346;
const HEADER_BYTES = 17;
const decoder = new TextDecoder();

/**
 * Parses one simulator helper envelope (little-endian): magic u16, version u8,
 * flags u8 (1 keyframe, 2 codec config), sequence u32, timestamp f64 ms,
 * device id length u8, device id, then the Annex-B H.264 payload.
 */
export function parseSimulatorFrame(buffer: ArrayBuffer): SimulatorFrame | null {
  if (!(buffer instanceof ArrayBuffer) || buffer.byteLength < HEADER_BYTES) return null;
  const view = new DataView(buffer);
  if (view.getUint16(0, true) !== MAGIC) return null;
  const flags = view.getUint8(3);
  const idLength = view.getUint8(16);
  if (HEADER_BYTES + idLength > buffer.byteLength) return null;
  return {
    udid: decoder.decode(new Uint8Array(buffer, HEADER_BYTES, idLength)),
    sequence: view.getUint32(4, true),
    timestampMs: view.getFloat64(8, true),
    keyframe: (flags & 1) !== 0,
    config: (flags & 2) !== 0,
    data: new Uint8Array(buffer, HEADER_BYTES + idLength),
  };
}
