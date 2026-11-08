// Short looping demos for How to play: small canvases that show a rule in
// motion rather than only describing it. Each one scripts simple motion on a
// tiny open room, but whether someone is lit, safe, caught or frozen is
// decided by the same isBehind, inBeam and the other rules from
// shared/world.ts the server judges by, drawn with the same look.ts the game
// itself draws with. The stun demo's timing is scripted to fit a tiny room;
// the catch and freeze demos are judged frame by frame by the shared rules.

import {
  CATCH_COOLDOWN_SECONDS,
  CATCH_SECONDS,
  COLLIDE_DISTANCE,
  FREEZE_MS,
  SAFE_HALF_ANGLE,
  canSee,
  inBeam,
  isBehind,
  type Body,
  type Maze,
} from "../shared/world.ts";
import { ICE, LIGHT, dot, revealRing, floor as drawFloor, frost, shield, beam as torchBeam, type View } from "./look.ts";

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
// the loop started, in seconds. It plays in the open room unless it names
// a maze of its own.
interface Demo {
  id: string;
  seconds: number;
  keyFrame: number;
  maze?: Maze;
  draw(v: View, t: number): void;
}

function view(canvas: HTMLCanvasElement, maze: Maze = ROOM): View {
  const ctx = canvas.getContext("2d")!;
  const dpr = devicePixelRatio || 1;
  const w = Math.max(1, Math.round(canvas.clientWidth * dpr));
  const h = Math.max(1, Math.round(canvas.clientHeight * dpr));
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
  }
  const scale = Math.min(canvas.width / maze.w, canvas.height / maze.h);
  const offX = (canvas.width - maze.w * scale) / 2;
  const offY = (canvas.height - maze.h * scale) / 2;
  return { ctx, maze, scale, offX, offY };
}

// Smoothstep, for motion that starts and ends gently.
const ease = (k: number) => k * k * (3 - 2 * k);

// A beam drawn and filled in one call, in a given colour.
function fill(v: View, x: number, y: number, facing: number, colour: string): void {
  torchBeam(v, v.ctx, x, y, facing);
  v.ctx.fillStyle = colour;
  v.ctx.fill();
}

// 1. Catching: the safe quarter, then the catch

// The rival stands still, facing east. The seeker starts right in front of
// it, beam on its face, and sways a little: safe, however long the beam
// holds. Then it circles round to the rival's side, where a held beam
// catches, and the rival is out. Whether the rival is catchable and when
// it's caught is worked out the way the server works it out: a beam held on
// someone outside their front 90 degrees, for CATCH_SECONDS, catches them.
// The path is an ellipse that stays inside the room's walls.
function catchingDemo(): Demo {
  const rival: Body = { x: 4.5, y: 3, facing: 0 };
  const seconds = 6;
  const sway = 1.6; // in front, swaying
  const circle = 3.4; // round to the side
  const angle = (t: number): number => {
    if (t < sway) return 0.25 * Math.sin((Math.PI * t) / sway);
    return ease(Math.min(1, (t - sway) / (circle - sway))) * (Math.PI / 2);
  };
  const pos = (t: number): Body => {
    const a = angle(t);
    const x = rival.x + Math.cos(a) * 2.4;
    const y = rival.y + Math.sin(a) * 1.6;
    return { x, y, facing: Math.atan2(rival.y - y, rival.x - x) };
  };
  const { held, caughtAt } = expose(seconds, (t) => {
    const seeker = pos(t);
    return inBeam(ROOM, seeker, rival) && isBehind(rival, seeker);
  });
  return {
    id: "demo-catch",
    seconds,
    keyFrame: caughtAt + 0.15,
    draw(v, t) {
      const seeker = pos(t);
      drawFloor(v);
      if (t < caughtAt) safeCone(v, rival);
      fill(v, seeker.x, seeker.y, seeker.facing, `rgb(${LIGHT} / 0.26)`);
      target(v, rival, t, caughtAt, held(t) > 0);
      dot(v, seeker.x, seeker.y, seeker.facing, SEEKER, "");
      seamFade(v, t, seconds);
    },
  };
}

// How long a beam has been held somewhere catchable at each moment of a
// loop, sampled the way the server accumulates it (reset to 0 the moment
// it isn't), and the first moment it reaches CATCH_SECONDS: the catch.
function expose(seconds: number, catchable: (t: number) => boolean): { held: (t: number) => number; caughtAt: number } {
  const hz = 120;
  const samples: number[] = [];
  let held = 0;
  let caughtAt = Infinity;
  for (let i = 0; i < seconds * hz; i++) {
    held = catchable(i / hz) ? held + 1 / hz : 0;
    if (held >= CATCH_SECONDS && caughtAt === Infinity) caughtAt = i / hz;
    samples.push(held);
  }
  return { held: (t) => samples[Math.min(samples.length - 1, Math.floor(t * hz))], caughtAt };
}

// The target of a catch: red while a beam is on it somewhere it can be
// caught, then once caught it fades out of the round, labelled so a new
// player reads it as out rather than just lit.
function target(v: View, body: Body, t: number, caughtAt: number, catchable: boolean): void {
  if (t < caughtAt) {
    dot(v, body.x, body.y, body.facing, RIVAL, "", catchable);
    return;
  }
  const { ctx, scale } = v;
  ctx.save();
  ctx.globalAlpha = Math.max(0, 1 - (t - caughtAt) / 0.7);
  dot(v, body.x, body.y, body.facing, RIVAL, "", true);
  ctx.globalAlpha = Math.min(1, (t - caughtAt) / 0.2);
  ctx.font = `600 ${Math.max(11, Math.round(scale * 0.55))}px system-ui, sans-serif`;
  ctx.textAlign = "center";
  ctx.fillStyle = "#eef0f5";
  ctx.fillText("Caught", v.offX + body.x * scale, v.offY + (body.y - 0.5) * scale);
  ctx.restore();
}

// Fades the room to dark over the last moments of a loop and back up over
// the first, so a loop whose end and start are in different places doesn't
// jump at the seam.
function seamFade(v: View, t: number, seconds: number): void {
  const edge = Math.min(t / 0.3, (seconds - t) / 0.4);
  if (edge >= 1) return;
  const { ctx, scale, offX, offY } = v;
  ctx.fillStyle = `rgb(4 5 10 / ${1 - Math.max(0, edge)})`;
  ctx.fillRect(offX, offY, ROOM.w * scale, ROOM.h * scale);
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

// 2. The stun: a head-on bump

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
      fill(v, v1.x, v1.y, v1.facing, `rgb(${LIGHT} / 0.2)`);
      fill(v, v2.x, v2.y, v2.facing, `rgb(${LIGHT} / 0.2)`);
      dot(v, v1.x, v1.y, v1.facing, SEEKER, "");
      dot(v, v2.x, v2.y, v2.facing, RIVAL, "");
      if (cooldownMs > 0) {
        shield(v, v1.x, v1.y, cooldownMs, held, t * 1000);
        shield(v, v2.x, v2.y, cooldownMs, held, t * 1000);
      }
    },
  };
}

// 3. The flash: everyone shows at once

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
      // the others show only in the flash, as the server's fog would have it
      v.ctx.save();
      v.ctx.globalAlpha = Math.min(1, flash * 3);
      for (const o of others) dot(v, o.x, o.y, o.facing, RIVAL, "");
      v.ctx.restore();
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

// 4. Freeze: a rival out of sight, revealed, then the catch

// The same room with a wall across the middle. The seeker stands on one
// side in the dark; the rival is on the other, out of sight, back turned.
// The seeker uses a freeze: it needs no beam, and the rival freezes where
// they are and shows through the dark, ringed in ice, to the seeker alone.
// The seeker walks round the wall and holds the beam on the rival's side
// for the catch. Who is seen and when the catch lands are worked out by the
// shared canSee, inBeam and isBehind, as the server works them out.
const WALLED: Maze = {
  w: 9,
  h: 6,
  rows: ["#########", "#.......#", "#...#...#", "#...#...#", "#.......#", "#########"],
};

function freezeDemo(): Demo {
  const rival: Body = { x: 6.8, y: 2.5, facing: 0 }; // back turned to the wall
  const seconds = 7;
  const freezeAt = 1;
  const thawAt = freezeAt + FREEZE_MS / 1000;
  const walk = 2.6; // round the wall
  const path: [number, number][] = [[2.5, 2.5], [2.5, 4.4], [5.4, 4.4]];
  const legs = path.slice(1).map(([x, y], i) => Math.hypot(x - path[i][0], y - path[i][1]));
  const total = legs.reduce((a, b) => a + b, 0);
  const seekerPos = (t: number): Body => {
    const k = ease(Math.min(1, Math.max(0, (t - freezeAt - 0.2) / walk)));
    let d = k * total;
    let i = 0;
    while (i < legs.length - 1 && d > legs[i]) d -= legs[i++];
    const [x0, y0] = path[i];
    const [x1, y1] = path[i + 1];
    const f = Math.min(1, d / legs[i]);
    const x = x0 + (x1 - x0) * f;
    const y = y0 + (y1 - y0) * f;
    // facing the way it walks, and once round the wall, at the rival
    const facing = k >= 1 || (i === legs.length - 1 && f > 0.6) ? Math.atan2(rival.y - y, rival.x - x) : Math.atan2(y1 - y0, x1 - x0);
    return { x, y, facing: k === 0 ? 0 : facing };
  };
  const { held, caughtAt } = expose(seconds, (t) => {
    const seeker = seekerPos(t);
    return t >= freezeAt && inBeam(WALLED, seeker, rival) && isBehind(rival, seeker);
  });
  return {
    id: "demo-freeze",
    seconds,
    maze: WALLED,
    keyFrame: freezeAt + 0.6,
    draw(v, t) {
      const seeker = seekerPos(t);
      const frozen = t >= freezeAt && t < Math.min(thawAt, caughtAt);
      const { ctx, scale, offX, offY } = v;
      drawFloor(v);
      // the dark over everything but the seeker's torch and the small circle round them
      ctx.fillStyle = "rgb(6 8 14 / 0.82)";
      ctx.fillRect(offX, offY, WALLED.w * scale, WALLED.h * scale);
      ctx.save();
      torchBeam(v, ctx, seeker.x, seeker.y, seeker.facing);
      ctx.arc(offX + seeker.x * scale, offY + seeker.y * scale, scale * 1.3, 0, Math.PI * 2);
      ctx.clip("nonzero");
      drawFloor(v);
      ctx.restore();
      fill(v, seeker.x, seeker.y, seeker.facing, `rgb(${LIGHT} / 0.26)`);
      // the freeze going off: a ring of ice spreads from the seeker
      const since = t - freezeAt;
      if (since >= 0 && since < 0.6) {
        ctx.strokeStyle = `rgb(${ICE} / ${1 - since / 0.6})`;
        ctx.lineWidth = Math.max(2, scale * 0.08);
        ctx.beginPath();
        ctx.arc(offX + seeker.x * scale, offY + seeker.y * scale, scale * (0.4 + since * 3), 0, Math.PI * 2);
        ctx.stroke();
      }
      // the rival shows only in sight, or while the freeze reveals them
      if (frozen) revealRing(v, rival.x, rival.y, t * 1000);
      if (frozen || t >= caughtAt || canSee(WALLED, seeker, rival)) target(v, rival, t, caughtAt, held(t) > 0);
      if (frozen) frost(v, rival.x, rival.y, t * 1000);
      dot(v, seeker.x, seeker.y, seeker.facing, SEEKER, "");
      seamFade(v, t, seconds);
    },
  };
}

const DEMOS = [catchingDemo(), stunDemo(), flashDemo(), freezeDemo()];

// running them

let isVisible: () => boolean = () => false;
let frame = 0; // the shared loop's pending animation frame, 0 when stopped
const playing = new Map<string, number>(); // a Play loop's pending frame, by demo

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
  reducedMotion.addEventListener("change", () => {
    stopDemos();
    showDemos();
  });
  addEventListener("resize", () => {
    if (reducedMotion.matches && isVisible()) renderStill();
  });
  syncButtons();
}

function syncButtons(): void {
  for (const b of document.querySelectorAll<HTMLButtonElement>("[data-play]")) b.hidden = !reducedMotion.matches;
}

// Reduced motion: every demo holds its key frame, with a Play button next
// to it that runs one full loop and then settles back on the still frame.
// Drawn when the tab shows, since a canvas in a closed window has no size.
function renderStill(): void {
  for (const demo of DEMOS) {
    if (playing.has(demo.id)) continue;
    const canvas = document.getElementById(demo.id) as HTMLCanvasElement | null;
    if (canvas) demo.draw(view(canvas, demo.maze), demo.keyFrame);
  }
}

function playOnce(demo: Demo, canvas: HTMLCanvasElement): void {
  if (playing.has(demo.id)) return; // one loop at a time
  const start = performance.now();
  const step = (now: number) => {
    const t = (now - start) / 1000;
    if (!isVisible() || t >= demo.seconds) {
      playing.delete(demo.id);
      if (isVisible()) demo.draw(view(canvas, demo.maze), demo.keyFrame);
      return;
    }
    demo.draw(view(canvas, demo.maze), t);
    playing.set(demo.id, requestAnimationFrame(step));
  };
  playing.set(demo.id, requestAnimationFrame(step));
}

// Starts the demos if the How to play tab is showing: the shared loop, or
// under reduced motion the still frames. Safe to call any number of times.
export function showDemos(): void {
  syncButtons();
  if (!isVisible()) return;
  if (reducedMotion.matches) {
    renderStill();
    return;
  }
  if (!frame) frame = requestAnimationFrame(tick);
}

export function stopDemos(): void {
  cancelAnimationFrame(frame);
  frame = 0;
  for (const id of playing.values()) cancelAnimationFrame(id);
  playing.clear();
}

function tick(now: number): void {
  frame = 0;
  if (!isVisible() || reducedMotion.matches) return;
  for (const demo of DEMOS) {
    const canvas = document.getElementById(demo.id) as HTMLCanvasElement | null;
    if (!canvas || canvas.offsetParent === null) continue; // not on screen right now
    demo.draw(view(canvas, demo.maze), now / 1000 - Math.floor(now / 1000 / demo.seconds) * demo.seconds);
  }
  frame = requestAnimationFrame(tick);
}
