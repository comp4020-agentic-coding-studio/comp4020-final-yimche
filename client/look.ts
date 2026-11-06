// How the game looks, in small pieces anything can draw with: a tile in the
// map's theme, a torch beam, a player, the ice and the stun ring. The
// round in main.ts and the demos in How to play both draw with these, so a
// demo looks like the game it explains. Each takes a view saying where the
// maze sits on its canvas and how big a tile is, in canvas pixels, and the
// theme its tiles are drawn in (night when it doesn't say).

import { LOOKS, floorTile, type Look } from "./themes.ts";
import { BEAM_HALF_ANGLE, BEAM_RANGE, BLACKOUT_REACH, PLAYER_RADIUS, castRay, type Maze } from "../shared/world.ts";

export interface View {
  ctx: CanvasRenderingContext2D;
  maze: Maze;
  scale: number; // one tile, in canvas pixels
  offX: number;
  offY: number;
  look?: Look;
}

// The torchlight, and a colour for each player so you can tell who's who in
// the dark. Both are the same in every theme; themes.ts holds the ground.
export const LIGHT = "255 236 196";
export const PLAYER_COLOURS = ["#5cc8d8", "#f08a6c", "#9b8cf0", "#7fd08a", "#f0a3c8", "#e8c46a", "#6ea8f5", "#d4d4dc"];
// frost: the pale blue a frozen player and their stuck beam are tinted with
export const ICE = "200 238 255";
// A freeze that would land: the beam's path, already filled, gets a bright
// ice edge that pulses, so "ready" reads apart from a frozen beam, which is
// only a flat pale tint. Call it straight after filling the beam's path.
export function readyEdge(v: View, now: number): void {
  const { ctx, scale } = v;
  ctx.save();
  ctx.strokeStyle = `rgb(${ICE} / ${0.7 + 0.3 * Math.sin(now / 160)})`;
  ctx.lineWidth = Math.max(2, scale * 0.09);
  ctx.lineJoin = "round";
  ctx.stroke();
  ctx.restore();
}
// the stun ring: a soft white, apart from a freeze's ice and every
// powerup's colour, so a shield never reads as frost
export const STUN = "236 236 244";
// the red a player turns while a beam is on their back or side
export const LIT = "#f06e5a";

// How far ahead of the edge a tile starts to shake, and how far behind it a
// falling tile is gone from sight, both in tiles.
export const SHAKE_AHEAD = 0.6;
const FALL_DEPTH = 0.8;

// One tile of the maze, in the view's theme. Floor is laid in the theme's
// pattern with grout showing the grid; a wall has a lit lip along its bottom when floor lies
// below it, so it reads as raised. A falling tile shrinks and darkens as it
// drops, and a fallen one is left as the dark underneath.
export function tile(v: View, x: number, y: number, isWall: boolean, lip: boolean, depth: number, now: number): void {
  const { ctx, scale, offX, offY } = v;
  if (depth >= FALL_DEPTH) return;
  const fall = Math.max(0, depth / FALL_DEPTH);
  const size = 1 - fall * 0.85;
  let jx = 0;
  let jy = 0;
  if (depth > -SHAKE_AHEAD && depth <= 0) {
    const k = (1 + depth / SHAKE_AHEAD) * scale * 0.04;
    jx = Math.sin(now / 37 + x * 7 + y * 3) * k;
    jy = Math.cos(now / 41 + x * 5 + y * 11) * k;
  }
  const px = offX + (x + 0.5 - size / 2) * scale + jx;
  const py = offY + (y + 0.5 - size / 2) * scale + jy + fall * scale * 0.25;
  const s = size * scale;
  const look = v.look ?? LOOKS.night;
  if (isWall) {
    ctx.fillStyle = look.wall;
    ctx.fillRect(px, py, s + 0.5, s + 0.5);
    if (lip) {
      ctx.fillStyle = look.lip;
      ctx.fillRect(px, py + s * 0.82, s + 0.5, s * 0.18 + 0.5);
    }
  } else {
    floorTile(ctx, look, px, py, s, x, y);
  }
  if (fall > 0) {
    // the same falling dark in every theme
    ctx.fillStyle = `rgb(4 5 10 / ${fall})`;
    ctx.fillRect(px, py, s + 0.5, s + 0.5);
  } else if (depth > -SHAKE_AHEAD) {
    // about to go: a red tinge so you see it coming
    ctx.fillStyle = `rgb(200 50 50 / ${0.3 * (1 + depth / SHAKE_AHEAD)})`;
    ctx.fillRect(px, py, s + 0.5, s + 0.5);
  }
}

// The whole maze, tile by tile, with nothing falling.
export function floor(v: View): void {
  const { maze } = v;
  const wall = (x: number, y: number) => maze.rows[y]?.[x] === "#";
  v.ctx.fillStyle = (v.look ?? LOOKS.night).void;
  v.ctx.fillRect(v.offX, v.offY, maze.w * v.scale, maze.h * v.scale);
  for (let y = 0; y < maze.h; y++) {
    for (let x = 0; x < maze.w; x++) tile(v, x, y, wall(x, y), !wall(x, y + 1) && y + 1 < maze.h, -Infinity, 0);
  }
}

// The lit part of a beam, as a path on c, cut short wherever a wall stops it,
// unless it's an x-ray torch, which goes straight through. A torch dimmed by
// a blackout reaches half as far, the same reach the server judges it by.
export function beam(v: View, c: CanvasRenderingContext2D, x: number, y: number, facing: number, xray = false, dimmed = false): void {
  const { maze, scale, offX, offY } = v;
  const range = dimmed ? BEAM_RANGE * BLACKOUT_REACH : BEAM_RANGE;
  const steps = 48;
  c.beginPath();
  c.moveTo(offX + x * scale, offY + y * scale);
  for (let i = 0; i <= steps; i++) {
    const a = facing - BEAM_HALF_ANGLE + (2 * BEAM_HALF_ANGLE * i) / steps;
    const d = xray ? range : castRay(maze, x, y, a, range);
    c.lineTo(offX + (x + Math.cos(a) * d) * scale, offY + (y + Math.sin(a) * d) * scale);
  }
  c.closePath();
}

// A player: their colour, a dark rim, a notch showing which way they face (so
// you can tell whose back is turned), and their name above. Red when lit.
// The label uses whatever font the caller set.
export function dot(v: View, x: number, y: number, facing: number, colour: string, label: string, lit = false): void {
  const { ctx, scale } = v;
  const sx = v.offX + x * scale;
  const sy = v.offY + y * scale;
  const r = PLAYER_RADIUS * scale;
  ctx.fillStyle = lit ? LIT : colour;
  ctx.strokeStyle = "rgb(10 12 20 / 0.7)";
  ctx.lineWidth = Math.max(1.5, scale * 0.06);
  ctx.beginPath();
  ctx.arc(sx, sy, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = "rgb(10 12 20 / 0.75)";
  ctx.beginPath();
  ctx.arc(sx + Math.cos(facing) * r * 0.5, sy + Math.sin(facing) * r * 0.5, r * 0.28, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "rgb(10 12 20 / 0.6)";
  ctx.fillText(label, sx + 1, sy - r - 5 + 1);
  ctx.fillStyle = "#eef0f5";
  ctx.fillText(label, sx, sy - r - 5);
}

// Frozen: the dot sealed in a block of ice, a hexagon with a bright rim and a
// glint, so it reads apart from the stun ring, which is a plain circle.
export function frost(v: View, x: number, y: number, now: number): void {
  const { ctx, scale } = v;
  const sx = v.offX + x * scale;
  const sy = v.offY + y * scale;
  const r = PLAYER_RADIUS * scale * 1.35;
  ctx.beginPath();
  for (let i = 0; i < 6; i++) {
    const a = (i * Math.PI) / 3 + Math.PI / 6;
    ctx.lineTo(sx + Math.cos(a) * r, sy + Math.sin(a) * r);
  }
  ctx.closePath();
  ctx.fillStyle = `rgb(${ICE} / 0.5)`;
  ctx.fill();
  ctx.strokeStyle = `rgb(${ICE} / ${0.85 + 0.15 * Math.sin(now / 300)})`;
  ctx.lineWidth = Math.max(2, scale * 0.07);
  ctx.lineJoin = "round";
  ctx.stroke();
  ctx.lineJoin = "miter";
  // a glint across the top left face
  ctx.strokeStyle = "rgb(255 255 255 / 0.85)";
  ctx.lineWidth = Math.max(1.5, scale * 0.05);
  ctx.beginPath();
  ctx.moveTo(sx - r * 0.55, sy - r * 0.15);
  ctx.lineTo(sx - r * 0.15, sy - r * 0.55);
  ctx.stroke();
}

// A ring while a head-on bump or stand-off shields a pair from catching each other: steady
// while a torch holds the stun, then flashing once the countdown runs, faster
// in its last second so the end is no surprise.
export function shield(v: View, x: number, y: number, cooldownMs: number, held: boolean, now: number): void {
  if (cooldownMs <= 0) return;
  const { ctx, scale } = v;
  const rate = cooldownMs < 1000 ? 10 : 4; // blinks per second
  const on = held ? 1 : 0.5 + 0.5 * Math.sin((now / 1000) * rate * Math.PI * 2);
  ctx.strokeStyle = `rgb(${STUN} / ${0.25 + 0.75 * on})`;
  ctx.lineWidth = Math.max(2, scale * 0.08);
  ctx.beginPath();
  ctx.arc(v.offX + x * scale, v.offY + y * scale, PLAYER_RADIUS * scale * 1.7, 0, Math.PI * 2);
  ctx.stroke();
}
