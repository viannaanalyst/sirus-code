import type { SimulatorFrame } from "@/client/types";

export interface FrameGateState {
  phase: "awaiting-config" | "awaiting-keyframe" | "streaming";
  lastSequence: number | null;
}

export type FrameGateAction =
  | { kind: "ignore" }
  | { kind: "configure" }
  | { kind: "decode"; keyframe: boolean }
  | { kind: "drop" };

export interface FrameGateStep {
  state: FrameGateState;
  action: FrameGateAction;
  requestKeyframe: boolean;
}

export function createFrameGateState(): FrameGateState {
  return { phase: "awaiting-config", lastSequence: null };
}

const SEQUENCE_MODULUS = 2 ** 32;
const MAX_PLAUSIBLE_SEQUENCE_GAP = 1_024;

/** Admit only frames the WebCodecs decoder can use, and recover after loss. */
export function stepFrameGate(
  state: FrameGateState,
  frame: Pick<SimulatorFrame, "udid" | "sequence" | "keyframe" | "config">,
  expectedUdid: string,
): FrameGateStep {
  if (frame.udid !== expectedUdid) {
    return { state, action: { kind: "ignore" }, requestKeyframe: false };
  }

  if (frame.config) {
    return {
      state: { phase: "awaiting-keyframe", lastSequence: frame.sequence },
      action: { kind: "configure" },
      requestKeyframe: false,
    };
  }

  if (state.phase === "awaiting-config") {
    return { state, action: { kind: "drop" }, requestKeyframe: false };
  }

  if (state.lastSequence !== null) {
    const distance = (frame.sequence - state.lastSequence + SEQUENCE_MODULUS) % SEQUENCE_MODULUS;
    if (distance === 0 || distance > MAX_PLAUSIBLE_SEQUENCE_GAP) {
      return { state, action: { kind: "drop" }, requestKeyframe: false };
    }
    if (distance > 1 && !frame.keyframe && state.phase === "streaming") {
      return {
        state: { phase: "awaiting-keyframe", lastSequence: frame.sequence },
        action: { kind: "drop" },
        requestKeyframe: true,
      };
    }
  }

  if (state.phase === "awaiting-keyframe" && !frame.keyframe) {
    return {
      state: { ...state, lastSequence: frame.sequence },
      action: { kind: "drop" },
      requestKeyframe: false,
    };
  }

  return {
    state: { phase: "streaming", lastSequence: frame.sequence },
    action: { kind: "decode", keyframe: frame.keyframe },
    requestKeyframe: false,
  };
}
