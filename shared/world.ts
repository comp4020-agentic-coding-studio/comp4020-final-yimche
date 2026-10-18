// Geometry both sides agree on: the server decides who is lit and caught with
// these functions, and the client draws the same beam it's judged by.

export const PLAYER_RADIUS = 0.3;
export const SPEED = 3.2; // tiles per second
export const ACCELERATION = 12; // how quickly speed eases toward the input, per second
export const BEAM_RANGE = 5.5;
export const BEAM_HALF_ANGLE = Math.PI / 7;
export const AURA_RADIUS = 1.3; // what you can see around you without the torch
export const CATCH_SECONDS = 0.4; // how long a beam has to stay on someone
export const COLLIDE_DISTANCE = PLAYER_RADIUS * 2.2; // close enough to call it a bump
export const CATCH_COOLDOWN_SECONDS = 3; // a head-on bump or a stand-off buys both of you this long
export const SAFE_HALF_ANGLE = Math.PI / 4; // you're safe from a beam only within 45° either side of where you look
export const FLASH_EVERY_MS = 10000; // how often the whole maze flashes into view
export const FLASH_MS = 1000; // how long a flash takes to fade back to dark

// Powerups lie about the maze; walk over one to pick it up, and it's yours
// until you choose to use it. You carry one at a time: walking over another
// swaps it in, and the old one is gone.
export type Kind = "speed" | "xray" | "teleport";
export const KINDS: Kind[] = ["speed", "xray", "teleport"];
export const PICKUP_RADIUS = 0.55; // how close you have to walk to pick one up
export const SPEED_BOOST = 1.6; // speed multiplier while a boost lasts
export const SPEED_MS = 4000;
export const XRAY_MS = 5000; // a torch that sees through walls, but catches only in the open
// A teleport lands somewhere random, but ahead of you: within 30° either side
// of where you face, between these distances away.
export const TELEPORT_HALF_ANGLE = Math.PI / 6;
export const TELEPORT_MIN = 4;
export const TELEPORT_MAX = 10;

// The dark closes in so a round can't drag on: a minute in, the floor starts
// falling away from the edges toward one room, and over the next minute it
// shrinks to the few tiles around it. Step onto a fallen tile and you fall,
// out of the round as surely as a catch.
export const CLOSE_AFTER_MS = 60_000;
export const CLOSE_TAKES_MS = 60_000;
export const ZONE_MIN_RADIUS = 1.5;

export interface Zone {
  x: number;
  y: number;
}

// How far the safe floor reaches, so many ms into a round: wide enough to
// cover the whole maze until it starts closing, then shrinking steadily.
export function zoneRadius(maze: Maze, zone: Zone, elapsedMs: number): number {
  const full = Math.max(
    ...[[0, 0], [maze.w, 0], [0, maze.h], [maze.w, maze.h]].map(([x, y]) => Math.hypot(x - zone.x, y - zone.y)),
  );
  const k = Math.min(1, Math.max(0, (elapsedMs - CLOSE_AFTER_MS) / CLOSE_TAKES_MS));
  return full + (ZONE_MIN_RADIUS - full) * k;
}

// The floor falls away tile by tile as the radius shrinks: how far past a
// tile's falling point the radius has come, in tiles. Above zero the tile is
// gone, and standing on a gone tile is falling into the dark. Each tile counts
// as up to a third nearer than it is, at random, so the floor crumbles in
// scattered bits rather than a neat ring; the room in the middle never falls.
const SCATTER = 0.35;
export function fallDepth(zone: Zone, r: number, tx: number, ty: number): number {
  const dist = Math.hypot(tx + 0.5 - zone.x, ty + 0.5 - zone.y);
  return dist * (1 - SCATTER * scatter(zone, tx, ty)) - r;
}

// A number in [0, 1) fixed for each tile and round, the same on every screen.
function scatter(zone: Zone, tx: number, ty: number): number {
  let h = (tx * 374761393 + ty * 668265263 + Math.floor(zone.x * 2) * 2147483647 + Math.floor(zone.y * 2) * 1274126177) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 2 ** 32;
}

export function tileFallen(zone: Zone, r: number, x: number, y: number): boolean {
  return fallDepth(zone, r, Math.floor(x), Math.floor(y)) > 0;
}

export interface Maze {
  w: number;
  h: number;
  rows: string[]; // "#" wall, "." floor
}

export function isWall(maze: Maze, x: number, y: number): boolean {
  if (x < 0 || y < 0 || x >= maze.w || y >= maze.h) return true;
  return maze.rows[y][x] === "#";
}

// Distance along a ray until it enters a wall tile, capped at max (grid DDA).
export function castRay(maze: Maze, ox: number, oy: number, angle: number, max: number): number {
  const dx = Math.cos(angle);
  const dy = Math.sin(angle);
  let mapX = Math.floor(ox);
  let mapY = Math.floor(oy);
  const stepX = dx < 0 ? -1 : 1;
  const stepY = dy < 0 ? -1 : 1;
  const deltaX = dx === 0 ? Infinity : Math.abs(1 / dx);
  const deltaY = dy === 0 ? Infinity : Math.abs(1 / dy);
  let nextX = dx === 0 ? Infinity : (dx > 0 ? mapX + 1 - ox : ox - mapX) * deltaX;
  let nextY = dy === 0 ? Infinity : (dy > 0 ? mapY + 1 - oy : oy - mapY) * deltaY;
  for (;;) {
    let t: number;
    if (nextX < nextY) {
      t = nextX;
      nextX += deltaX;
      mapX += stepX;
    } else {
      t = nextY;
      nextY += deltaY;
      mapY += stepY;
    }
    if (t >= max) return max;
    if (isWall(maze, mapX, mapY)) return t;
  }
}

export interface Body {
  x: number;
  y: number;
  facing: number;
}

function lineOfSight(maze: Maze, a: Body, b: Body, dist: number): boolean {
  return castRay(maze, a.x, a.y, Math.atan2(b.y - a.y, b.x - a.x), dist) >= dist;
}

export function angleBetween(a: number, b: number): number {
  const d = Math.abs(a - b) % (Math.PI * 2);
  return d > Math.PI ? Math.PI * 2 - d : d;
}

// True when attacker is anywhere outside the 90° wedge in front of target,
// 45° either side of where target looks: the sides count as well as the back,
// 270° in all. A beam only catches from there; lighting someone's face
// doesn't, since they saw it coming.
export function isBehind(target: Body, attacker: Body): boolean {
  const toAttacker = Math.atan2(attacker.y - target.y, attacker.x - target.x);
  return angleBetween(target.facing, toAttacker) > SAFE_HALF_ANGLE;
}

// Is b inside a's torch beam? This is visibility, not a catch: a beam can land
// on someone's front and light them up without catching them (see isBehind).
// An x-ray torch ignores walls, which only ever widens what you see.
export function inBeam(maze: Maze, a: Body, b: Body, xray = false): boolean {
  const dist = Math.hypot(b.x - a.x, b.y - a.y);
  if (dist > BEAM_RANGE + PLAYER_RADIUS) return false;
  // allow the beam to clip the edge of a body, not just its centre
  const slack = dist > 0 ? Math.atan(PLAYER_RADIUS / dist) : Math.PI;
  if (angleBetween(Math.atan2(b.y - a.y, b.x - a.x), a.facing) > BEAM_HALF_ANGLE + slack) return false;
  return xray || lineOfSight(maze, a, b, dist);
}

// Can a see b at all: in the beam, or close enough to make out in the dark.
export function canSee(maze: Maze, a: Body, b: Body, xray = false): boolean {
  const dist = Math.hypot(b.x - a.x, b.y - a.y);
  if (dist <= AURA_RADIUS + PLAYER_RADIUS && lineOfSight(maze, a, b, dist)) return true;
  return inBeam(maze, a, b, xray);
}

function blocked(maze: Maze, x: number, y: number): boolean {
  const r = PLAYER_RADIUS;
  return (
    isWall(maze, Math.floor(x - r), Math.floor(y - r)) ||
    isWall(maze, Math.floor(x + r), Math.floor(y - r)) ||
    isWall(maze, Math.floor(x - r), Math.floor(y + r)) ||
    isWall(maze, Math.floor(x + r), Math.floor(y + r))
  );
}

// Moves a body by (dx, dy), sliding along walls one axis at a time. Corridors
// are one tile wide, so turning a corner needs lining up; when a move is only
// blocked because the body is off-centre, it's eased toward the middle of the
// corridor instead, so a slightly early turn still goes round the corner.
export function move(maze: Maze, body: Body, dx: number, dy: number): void {
  const free = (x: number, y: number) => !blocked(maze, x, y);
  if (dx !== 0) {
    if (free(body.x + dx, body.y)) body.x += dx;
    else if (free(body.x + dx, centre(body.y))) body.y = toward(body.y, centre(body.y), Math.abs(dx), (y) => free(body.x, y));
    else body.x = closeIn(body.x, dx, (x) => free(x, body.y));
  }
  if (dy !== 0) {
    if (free(body.x, body.y + dy)) body.y += dy;
    else if (free(centre(body.x), body.y + dy)) body.x = toward(body.x, centre(body.x), Math.abs(dy), (x) => free(x, body.y));
    else body.y = closeIn(body.y, dy, (y) => free(body.x, y));
  }
}

const centre = (v: number) => Math.floor(v) + 0.5;

// Steps v toward target by up to `step`, if that spot is clear.
function toward(v: number, target: number, step: number, clear: (v: number) => boolean): number {
  const next = v + Math.sign(target - v) * Math.min(step, Math.abs(target - v));
  return clear(next) ? next : v;
}

// A full step hits the wall, so take the biggest part of it that doesn't:
// you walk right up to a wall rather than stopping a stride short.
function closeIn(v: number, step: number, clear: (v: number) => boolean): number {
  for (let i = 0; i < 5; i++) {
    step /= 2;
    if (clear(v + step)) v += step;
  }
  return v;
}
