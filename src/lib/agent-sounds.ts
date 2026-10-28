import type { ActivityNotification } from "@/client/types";

/**
 * Agent sounds (ADR-171): two short cues made with Web Audio, so no audio files ship.
 * They are opt-in in Settings → Notifications and quiet on purpose.
 */
export type AgentCue = "completion" | "attention";

/** A finished turn chimes; a permission or question asks for the person. Failures and reminders stay silent. */
export function agentCueFor(kind: ActivityNotification["kind"]): AgentCue | null {
  if (kind === "completion") return "completion";
  return kind === "permission" || kind === "question" ? "attention" : null;
}

/**
 * True when the person is already looking at the conversation with the window focused, so the
 * on-screen state is enough. Mirrors the session rule the activity alert uses in the store.
 */
export function isViewingNotice(
  view: { settingsOpen: boolean; mainView: string; selectedSessionId: string | null },
  notice: Pick<ActivityNotification, "sessionId">,
  focused: boolean,
): boolean {
  return focused && !view.settingsOpen && view.mainView === "session" && view.selectedSessionId === notice.sessionId;
}

interface Note { freq: number; at: number; type: OscillatorType; peak: number }

/** Gentle: low peaks, a soft attack and a long exponential decay. */
const CUES: Record<AgentCue, Note[]> = {
  completion: [{ freq: 880, at: 0, type: "triangle", peak: 0.05 }, { freq: 1318.5, at: 0.11, type: "sine", peak: 0.035 }],
  attention: [{ freq: 659.3, at: 0, type: "sine", peak: 0.05 }, { freq: 659.3, at: 0.17, type: "sine", peak: 0.04 }],
};

const ATTACK = 0.02;
const DECAY = 0.7;
let context: AudioContext | null = null;

function voice(ctx: AudioContext, note: Note, start: number) {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  const t0 = start + note.at;
  osc.type = note.type;
  osc.frequency.setValueAtTime(note.freq, t0);
  gain.gain.setValueAtTime(0.0001, t0);
  gain.gain.exponentialRampToValueAtTime(note.peak, t0 + ATTACK);
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + ATTACK + DECAY);
  osc.connect(gain).connect(ctx.destination);
  osc.start(t0);
  osc.stop(t0 + ATTACK + DECAY + 0.05);
}

/** Plays one cue. A host without audio output, or a refused context, stays silent instead of failing. */
export function playAgentCue(cue: AgentCue): void {
  try {
    if (typeof window === "undefined" || !window.AudioContext) return;
    context ??= new window.AudioContext();
    if (context.state === "suspended") void context.resume();
    const now = context.currentTime;
    for (const note of CUES[cue]) voice(context, note, now);
  } catch {
    // Sound is decoration: a failed chime must never break the activity feed.
  }
}
