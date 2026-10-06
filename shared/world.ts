// Geometry both sides agree on: the server decides who is lit and caught with
// these functions, and the client draws the same beam it's judged by.

export const PLAYER_RADIUS = 0.3;
export const SPEED = 3.2; // tiles per second
export const BEAM_RANGE = 5.5;
export const BEAM_HALF_ANGLE = Math.PI / 7;
export const AURA_RADIUS = 1.3; // what you can see around you without the torch
export const CATCH_SECONDS = 0.4; // how long a beam has to stay on someone
export const COLLIDE_DISTANCE = PLAYER_RADIUS * 2.2; // close enough to call it a bump
export const CATCH_COOLDOWN_SECONDS = 3; // a head-on bump buys both of you this long
export const FLASH_EVERY_MS = 15000; // how often the whole maze flashes into view
export const FLASH_MS = 1000; // how long a flash takes to fade back to dark

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

// True when target is facing away from attacker, so attacker is somewhere in
// target's back half rather than somewhere target is looking. A beam only
// catches from here; lighting someone's face doesn't, since they saw it coming.
export function isBehind(target: Body, attacker: Body): boolean {
  const toAttacker = Math.atan2(attacker.y - target.y, attacker.x - target.x);
  return angleBetween(target.facing, toAttacker) > Math.PI / 2;
}

// Is b inside a's torch beam? This is visibility, not a catch: a beam can land
// on someone's front and light them up without catching them (see isBehind).
export function inBeam(maze: Maze, a: Body, b: Body): boolean {
  const dist = Math.hypot(b.x - a.x, b.y - a.y);
  if (dist > BEAM_RANGE + PLAYER_RADIUS) return false;
  // allow the beam to clip the edge of a body, not just its centre
  const slack = dist > 0 ? Math.atan(PLAYER_RADIUS / dist) : Math.PI;
  if (angleBetween(Math.atan2(b.y - a.y, b.x - a.x), a.facing) > BEAM_HALF_ANGLE + slack) return false;
  return lineOfSight(maze, a, b, dist);
}

// Can a see b at all: in the beam, or close enough to make out in the dark.
export function canSee(maze: Maze, a: Body, b: Body): boolean {
  const dist = Math.hypot(b.x - a.x, b.y - a.y);
  if (dist <= AURA_RADIUS + PLAYER_RADIUS && lineOfSight(maze, a, b, dist)) return true;
  return inBeam(maze, a, b);
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
