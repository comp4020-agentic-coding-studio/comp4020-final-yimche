// Which sounds a moment calls for, worked out from what this player already
// holds: the state before, the state after, and the message that arrived.
// Nothing here touches audio, so the choice can be tested on its own.
//
// Fog holds for sound as it does for sight. Every cue follows this player's
// own fields (their status, slot, freeze, stun, light), the room-wide clock
// (countdown, start, flash, end) or a message they were sent. Nothing reads
// the others list, so a player out of view never makes a sound.

import type { Kind } from "../shared/world.ts";

export type Cue =
  | "countdown"
  | "start"
  | "flash"
  | "pickup"
  | "use"
  | "freeze"
  | "refused"
  | "stun"
  | "lit"
  | "catch"
  | "caught"
  | "fell"
  | "win"
  | "lose";

export const CUES: Cue[] = [
  "countdown", "start", "flash", "pickup", "use", "freeze", "refused",
  "stun", "lit", "catch", "caught", "fell", "win", "lose",
];

type Team = "red" | "blue";

// Only the parts of a state message that sound listens to.
export interface Heard {
  phase: "waiting" | "countdown" | "playing" | "ended";
  remainingMs: number;
  flashMs: number;
  me?: {
    status: "alive" | "caught" | "spectating";
    lit: boolean;
    cooldownHeld: boolean;
    cooldownMs: number;
    item: Kind | null;
    frozenMs: number;
  };
  zone: { x: number; y: number; r: number; closesInMs: number } | null;
}

// The messages that can carry a cue on their own.
export type Said =
  | { t: "catch"; catcherId: string | null; caughtId: string }
  | { t: "used"; kind: Kind | null; ok: boolean }
  | { t: string };

// Who is listening: their id, and in teams their side and the side that won.
export interface Listener {
  id?: string;
  team?: Team | null;
  winnerTeam?: Team | null;
}

const secs = (s: Heard) => Math.ceil(s.remainingMs / 1000);
const stunned = (s: Heard) => !!s.me && (s.me.cooldownHeld || s.me.cooldownMs > 0);

export function cues(before: Heard | null, after: Heard | null, msg?: Said, you: Listener = {}): Cue[] {
  const out: Cue[] = [];

  // messages: a catch notice, and the server's answer to Space
  if (msg?.t === "catch" && "caughtId" in msg) {
    if (msg.caughtId !== you.id) out.push("catch");
    else out.push(msg.catcherId ? "caught" : "fell");
  }
  if (msg?.t === "used" && "ok" in msg) {
    if (msg.ok) out.push("use");
    if (msg.ok && msg.kind === "freeze") out.push("freeze");
    if (!msg.ok && msg.kind) out.push("refused");
  }

  if (!before || !after) return out;

  // the room's clock: each count, lights out, the flash, the end
  if (after.phase === "countdown" && (before.phase !== "countdown" || secs(after) < secs(before))) out.push("countdown");
  if (after.phase === "playing" && before.phase === "countdown") out.push("start");
  if (after.phase === "playing" && before.phase === "playing" && after.flashMs > before.flashMs) out.push("flash");
  if (after.phase === "ended" && before.phase === "playing" && before.me && before.me.status !== "spectating") {
    const won = you.team ? you.winnerTeam === you.team : after.me?.status === "alive";
    out.push(won ? "win" : "lose");
  }

  // you, while you're in the round
  const a = after.me;
  const b = before.me;
  if (after.phase !== "playing" || before.phase !== "playing" || !a || !b || a.status !== "alive") return out;
  if (a.item && a.item !== b.item) out.push("pickup");
  if (a.frozenMs > 0 && b.frozenMs <= 0) out.push("freeze");
  if (stunned(after) && !stunned(before)) out.push("stun");
  if (a.lit && !b.lit) out.push("lit");
  return out;
}

// The mood of the music: calm in the lobby and the countdown, a pulse that
// grows as the dark closes in during a round, and silence once it ends so
// the end cue stands alone. `pulse` runs from 0 (none) to 1 (fully closed).
export interface Mood {
  playing: boolean;
  pulse: number;
}

export function moodOf(s: Heard | null, maze: { w: number; h: number }): Mood {
  if (!s || s.phase === "ended") return { playing: false, pulse: 0 };
  if (s.phase !== "playing" || !s.zone) return { playing: true, pulse: 0 };
  const { x, y, r, closesInMs } = s.zone;
  // the last twenty seconds before it closes bring a faint pulse in
  if (closesInMs > 0) return { playing: true, pulse: 0.3 * Math.max(0, 1 - closesInMs / 20_000) };
  // then it grows with how far the floor has fallen
  const full = Math.max(...[[0, 0], [maze.w, 0], [0, maze.h], [maze.w, maze.h]].map(([cx, cy]) => Math.hypot(cx - x, cy - y)));
  const k = full > 0 ? Math.min(1, Math.max(0, 1 - r / full)) : 1;
  return { playing: true, pulse: 0.3 + 0.7 * k };
}
