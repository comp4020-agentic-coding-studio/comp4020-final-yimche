// Short looping demos for How to play: small canvases that show a rule in
// motion rather than only describing it. Each one scripts simple motion on a
// tiny open room, but whether someone is lit, safe, caught or frozen is
// decided by the same isBehind, inBeam and the other rules from
// shared/world.ts the server judges by, drawn with the same look.ts the game
// itself draws with. A demo can never show a rule the game doesn't keep.

import {
  BEAM_RANGE,
  CATCH_COOLDOWN_SECONDS,
  CATCH_SECONDS,
  COLLIDE_DISTANCE,
  FREEZE_MS,
  SAFE_HALF_ANGLE,
  inBeam,
  isBehind,
  type Body,
  type Maze,
} from "../shared/world.ts";
import { ICE, LIGHT, dot, floor as drawFloor, frost, shield, beam as torchBeam, type View } from "./look.ts";

// A small open room, walled all round: enough space to show the motion, with
// nothing in the middle to hide the geometry it's demonstrating.
const ROOM: Maze = {
  w: 9,
  h: 6,
  rows: ["#########", "#.......#", "#.......#", "#.......#", "#.......#", "#########"],
};
const SEEKER = "#5cc8d8";
const RIVAL = "#f0a3c8";

const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");

// A canvas, how long its loop runs, the moment that shows its point best
// (drawn still under reduced motion), and a draw function of the time since
// the loop started, in seconds.
interface Demo {
  id: string;
  seconds: number;
  keyFrame: number;
  draw(v: View, t: number): void;
}

function view(canvas: HTMLCanvasElement): View {
  const ctx = canvas.getContext("2d")!;
  const dpr = devicePixelRatio || 1;
  const w = Math.max(1, Math.round(canvas.clientWidth * dpr));
  const h = Math.max(1, Math.round(canvas.clientHeight * dpr));
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
  }
  const scale = Math.min(canvas.width / ROOM.w, canvas.height / ROOM.h);
  const offX = (canvas.width - ROOM.w * scale) / 2;
  const offY = (canvas.height - ROOM.h * scale) / 2;
  return { ctx, maze: ROOM, scale, offX, offY };
}

// Smoothstep, for motion that starts and ends gently.
const ease = (k: number) => k * k * (3 - 2 * k);

// A beam drawn and filled in one call, in a given colour.
function fill(v: View, x: number, y: number, facing: number, colour: string): void {
  torchBeam(v, v.ctx, x, y, facing);
  v.ctx.fillStyle = colour;
  v.ctx.fill();
}

// ---------- 1. Catching: the safe quarter, then the catch ----------

// The rival stands still, facing east. The seeker circles all the way round
// it once a loop: starting right in front (safe, however long the beam
// holds), sweeping through the side and the back (where a held beam catches)
// and back to the front again, so the loop's start and end line up exactly.
// Whether the rival is lit, catchable and finally caught is worked out the
// way the server works it out: a beam held on someone outside their front
// 90 degrees, for CATCH_SECONDS, catches them.
function catchingDemo(): Demo {
  const rival: Body = { x: 4.5, y: 3, facing: 0 };
  const radius = 2.4;
  const pos = (t: number, seconds: number): Body => {
    const a = (t / seconds) * Math.PI * 2;
    const x = rival.x + Math.cos(a) * radius;
    const y = rival.y + Math.sin(a) * radius;
    return { x, y, facing: Math.atan2(rival.y - y, rival.x - x) };
  };
  // exposure, sampled the way the server accumulates it: reset to 0 the
  // moment the beam isn't held somewhere catchable, otherwise it grows.
  const seconds = 6;
  const hz = 120;
  const exposure: number[] = [];
  let held = 0;
  for (let i = 0; i < seconds * hz; i++) {
    const seeker = pos(i / hz, seconds);
    const catchable = inBeam(ROOM, seeker, rival) && isBehind(rival, seeker);
    held = catchable ? Math.min(CATCH_SECONDS, held + 1 / hz) : 0;
    exposure.push(held);
  }
  return {
    id: "demo-catch",
    seconds,
    keyFrame: seconds * 0.55, // mid-sweep, caught and lit red
    draw(v, t) {
      const seeker = pos(t, seconds);
      const lit = inBeam(ROOM, seeker, rival);
      const caught = exposure[Math.min(exposure.length - 1, Math.floor((t / seconds) * exposure.length))] >= CATCH_SECONDS;
      drawFloor(v);
      safeCone(v, rival);
      if (lit) fill(v, seeker.x, seeker.y, seeker.facing, `rgb(${LIGHT} / 0.26)`);
      dot(v, rival.x, rival.y, rival.facing, RIVAL, "", lit && caught);
      dot(v, seeker.x, seeker.y, seeker.facing, SEEKER, "");
    },
  };
}

// The 90 degree wedge in front of a player, faintly shaded, so a demo shows
// the safe quarter the same way the rule reads: SAFE_HALF_ANGLE either side
// of where they're looking.
function safeCone(v: View, body: Body): void {
  const { ctx, scale, offX, offY } = v;
  const sx = offX + body.x * scale;
  const sy = offY + body.y * scale;
  const r = scale * 1.8;
  ctx.beginPath();
  ctx.moveTo(sx, sy);
  ctx.arc(sx, sy, r, body.facing - SAFE_HALF_ANGLE, body.facing + SAFE_HALF_ANGLE);
  ctx.closePath();
  ctx.fillStyle = `rgb(${LIGHT} / 0.1)`;
  ctx.fill();
}

// ---------- 2. The stun: a head-on bump ----------

// Two players walk toward each other, face to face, and bump: the ring
// holds steady while they're still lighting each other, then once they both
// turn away it flashes out over CATCH_COOLDOWN_SECONDS, the same shield()
// the game draws. The loop ends back where it began.
function stunDemo(): Demo {
  const y = 3;
  const seconds = 7;
  const approach = 1.6; // walking in
  const bump = approach + 0.6; // touching, ring holds
  const apart = bump + 0.7; // stepping back, still facing each other
  const turn = apart + 0.4; // both turn away: the light comes off
  const cooldownEnds = turn + CATCH_COOLDOWN_SECONDS;
  return {
    id: "demo-stun",
    seconds,
    keyFrame: bump + 0.3,
    draw(v, t) {
      let p1x: number;
      let p2x: number;
      let facing1: number;
      let facing2: number;
      if (t < approach) {
        const k = ease(t / approach);
        p1x = 2 + k * 2;
        p2x = 7 - k * 2;
        facing1 = 0;
        facing2 = Math.PI;
      } else if (t < apart) {
        p1x = 4;
        p2x = 5;
        facing1 = 0;
        facing2 = Math.PI;
      } else if (t < turn) {
        const k = ease((t - apart) / (turn - apart));
        p1x = 4 - k * 0.5;
        p2x = 5 + k * 0.5;
        facing1 = 0;
        facing2 = Math.PI;
      } else if (t < cooldownEnds) {
        const k = ease(Math.min(1, (t - turn) / 0.4));
        p1x = 3.5 - k * 0.3;
        p2x = 5.5 + k * 0.3;
        facing1 = Math.PI; // both turn tail
        facing2 = 0;
      } else {
        const k = ease((t - cooldownEnds) / (seconds - cooldownEnds));
        p1x = 3.2 + k * (2 - 3.2);
        p2x = 5.8 + k * (7 - 5.8);
        facing1 = Math.PI + k * Math.PI; // turn back to face each other again
        facing2 = 0 - k * -Math.PI;
      }
      const v1: Body = { x: p1x, y, facing: facing1 };
      const v2: Body = { x: p2x, y, facing: facing2 };
      const touching = Math.hypot(v1.x - v2.x, v1.y - v2.y) <= COLLIDE_DISTANCE * 3; // a little generous for a tiny demo room
      const stillLit = inBeam(ROOM, v1, v2) || inBeam(ROOM, v2, v1);
      const held = t >= bump && (t < turn || (touching && stillLit));
      const cooldownMs = t < turn ? (held ? CATCH_COOLDOWN_SECONDS * 1000 : 0) : Math.max(0, (cooldownEnds - t) * 1000);

      drawFloor(v);
      dot(v, v1.x, v1.y, v1.facing, SEEKER, "");
      dot(v, v2.x, v2.y, v2.facing, RIVAL, "");
      if (cooldownMs > 0) {
        shield(v, v1.x, v1.y, cooldownMs, held, t * 1000);
        shield(v, v2.x, v2.y, cooldownMs, held, t * 1000);
      }
    },
  };
}

// ---------- 3. The flash: everyone shows at once ----------

// A few players sit in the dark, each out of sight of a lone watcher. Every
// so often the whole room lights up for a moment and all of them show, the
// way FLASH_MS fades back to dark in the real game.
function flashDemo(): Demo {
  const seconds = 4;
  const peakAt = 0.15; // the pulse starts almost at the top of the loop
  const fadeOver = 1.1;
  const others: Body[] = [
    { x: 1.8, y: 1.6, facing: 0.6 },
    { x: 7.2, y: 1.6, facing: 2.4 },
    { x: 1.8, y: 4.4, facing: -0.6 },
    { x: 7.2, y: 4.4, facing: -2.2 },
  ];
  const watcher: Body = { x: 4.5, y: 3, facing: 0 };
  return {
    id: "demo-flash",
    seconds,
    keyFrame: peakAt + 0.05,
    draw(v, t) {
      const since = t < peakAt ? t + seconds - fadeOver : t - peakAt; // wraps cleanly
      const flash = Math.max(0, 1 - since / fadeOver) ** 2;
      drawFloor(v);
      for (const o of others) dot(v, o.x, o.y, o.facing, RIVAL, "");
      dot(v, watcher.x, watcher.y, watcher.facing, SEEKER, "");
      // the dark, lifted by the flash and a small aura the watcher always has
      const { ctx, scale, offX, offY } = v;
      ctx.save();
      ctx.beginPath();
      ctx.rect(offX, offY, ROOM.w * scale, ROOM.h * scale);
      ctx.arc(offX + watcher.x * scale, offY + watcher.y * scale, scale * 1.3, 0, Math.PI * 2);
      ctx.clip("evenodd");
      ctx.fillStyle = `rgb(6 8 14 / ${0.82 * (1 - flash)})`;
      ctx.fillRect(offX, offY, ROOM.w * scale, ROOM.h * scale);
      ctx.restore();
      if (flash > 0) {
        ctx.fillStyle = `rgb(225 235 255 / ${0.3 * flash ** 3})`;
        ctx.fillRect(offX, offY, ROOM.w * scale, ROOM.h * scale);
      }
    },
  };
}

// ---------- 4. Freeze: the beam turns ice, then the catch ----------

// The rival stands with its back turned. The seeker closes in; the moment
// the rival is in reach, the beam turns ice exactly as it would if a freeze
// were in hand and ready, the rival freezes solid, and the seeker steps
// round to the back and holds the beam for the catch.
function freezeDemo(): Demo {
  const rival: Body = { x: 6, y: 3, facing: Math.PI }; // back already turned
  const seconds = 7;
  const freezeAt = 2.2;
  const thawAt = freezeAt + Math.min(3.2, FREEZE_MS / 1000);
  const seekerPos = (t: number): Body => {
    if (t < freezeAt) {
      const k = ease(t / freezeAt);
      const x = 1.5 + k * (6 - BEAM_RANGE * 0.7 - 1.5);
      return { x, y: 3, facing: 0 };
    }
    // circles round to the rival's exposed back while it's frozen
    const k = ease(Math.min(1, (t - freezeAt) / (thawAt - freezeAt)));
    const a = Math.PI + k * Math.PI * 0.95; // sweeps from the front round behind
    const r = 1.8;
    const x = rival.x + Math.cos(a) * r;
    const y = rival.y + Math.sin(a) * r;
    return { x, y, facing: Math.atan2(rival.y - y, rival.x - x) };
  };
  const hz = 120;
  const exposure: number[] = [];
  let held = 0;
  for (let i = 0; i < seconds * hz; i++) {
    const t = i / hz;
    const seeker = seekerPos(t);
    const catchable = t >= freezeAt && inBeam(ROOM, seeker, rival) && isBehind(rival, seeker);
    held = catchable ? Math.min(CATCH_SECONDS, held + 1 / hz) : 0;
    exposure.push(held);
  }
  return {
    id: "demo-freeze",
    seconds,
    keyFrame: freezeAt + 0.4,
    draw(v, t) {
      const seeker = seekerPos(t);
      const ready = t < freezeAt && inBeam(ROOM, seeker, rival); // would land, same test as freezeReady
      const frozen = t >= freezeAt && t < thawAt;
      const lit = inBeam(ROOM, seeker, rival);
      const caught = exposure[Math.min(exposure.length - 1, Math.floor((t / seconds) * exposure.length))] >= CATCH_SECONDS;
      drawFloor(v);
      if (lit) fill(v, seeker.x, seeker.y, seeker.facing, ready || frozen ? `rgb(${ICE} / 0.4)` : `rgb(${LIGHT} / 0.26)`);
      dot(v, rival.x, rival.y, rival.facing, RIVAL, "", lit && caught);
      if (frozen) frost(v, rival.x, rival.y, t * 1000);
      dot(v, seeker.x, seeker.y, seeker.facing, SEEKER, "");
    },
  };
}

const DEMOS = [catchingDemo(), stunDemo(), flashDemo(), freezeDemo()];

// ---------- running them ----------

let isVisible: () => boolean = () => false;
let running = false;

// Called once at startup: how demos.ts knows whether it's safe to draw, so a
// stray call to showDemos() or a missed stopDemos() never leaves a loop
// drawing to a closed window or a tab nobody's looking at.
export function initDemos(visible: () => boolean): void {
  isVisible = visible;
  for (const demo of DEMOS) {
    const canvas = document.getElementById(demo.id) as HTMLCanvasElement | null;
    const play = document.querySelector<HTMLButtonElement>(`[data-play="${demo.id}"]`);
    play?.addEventListener("click", () => canvas && playOnce(demo, canvas));
  }
  reducedMotion.addEventListener("change", renderStill);
  renderStill();
}

// Reduced motion: every demo holds its key frame, with a Play button next
// to it that runs one full loop and then settles back on the still frame.
function renderStill(): void {
  for (const b of document.querySelectorAll<HTMLButtonElement>("[data-play]")) b.hidden = !reducedMotion.matches;
  if (!reducedMotion.matches) return;
  for (const demo of DEMOS) {
    const canvas = document.getElementById(demo.id) as HTMLCanvasElement | null;
    if (canvas) demo.draw(view(canvas), demo.keyFrame);
  }
}

function playOnce(demo: Demo, canvas: HTMLCanvasElement): void {
  const start = performance.now();
  const step = (now: number) => {
    const t = (now - start) / 1000;
    if (t >= demo.seconds) {
      demo.draw(view(canvas), demo.keyFrame);
      return;
    }
    demo.draw(view(canvas), t);
    requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

// Starts the shared loop if it isn't already running. Safe to call whenever
// the How to play tab might be showing; the loop checks for itself.
export function showDemos(): void {
  if (running || reducedMotion.matches) return;
  running = true;
  requestAnimationFrame(tick);
}

export function stopDemos(): void {
  running = false;
}

function tick(now: number): void {
  if (!running) return;
  if (!isVisible()) {
    running = false;
    return;
  }
  for (const demo of DEMOS) {
    const canvas = document.getElementById(demo.id) as HTMLCanvasElement | null;
    if (!canvas || canvas.offsetParent === null) continue; // not on screen right now
    demo.draw(view(canvas), now / 1000 - Math.floor(now / 1000 / demo.seconds) * demo.seconds);
  }
  requestAnimationFrame(tick);
}
