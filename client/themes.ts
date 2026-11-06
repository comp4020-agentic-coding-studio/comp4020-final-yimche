// What each map theme looks like: the colours of its floor, the grout between
// floor stones, its walls, the lit lip along a wall's foot, the dark under a
// fallen tile, and the pattern its floor is laid in. Only the ground changes.
// The beam, the fog, the red of a falling tile and the players are drawn on
// top in the same colours whatever the theme, so a round reads the same in
// every one. Each floor sits near night's brightness for the same reason: a
// torch lights it about as much, and a player stands out from it as well.

import type { Theme } from "../shared/maps.ts";

export type Pattern = "tiles" | "flagstones" | "bricks" | "planks" | "grating";

export interface Look {
  name: string; // as a player would say it
  floor: string;
  grout: string;
  wall: string;
  lip: string;
  void: string;
  pattern: Pattern;
}

export const LOOKS: Record<Theme, Look> = {
  // the game as it always looked: square tiles in a blue night
  night: { name: "Night", floor: "#46536f", grout: "#3a4660", wall: "#121722", lip: "#5a6888", void: "#04050a", pattern: "tiles" },
  // pale worn stone under old earth
  catacombs: { name: "Catacombs", floor: "#5f5848", grout: "#423c31", wall: "#17130e", lip: "#7a705b", void: "#060504", pattern: "flagstones" },
  // a mossy brick path between dark hedges, the floor greyed toward night
  // so every player stands off it as clearly as on night
  garden: { name: "Garden", floor: "#4c5649", grout: "#363e32", wall: "#0d1a0c", lip: "#3e6a37", void: "#030702", pattern: "bricks" },
  // oak boards and plum panelled walls
  manor: { name: "Manor", floor: "#5e4433", grout: "#3f2c20", wall: "#1c1017", lip: "#6a3d55", void: "#070306", pattern: "planks" },
  // steel grating over the dark, walls of soot with a rust edge
  foundry: { name: "Foundry", floor: "#4b4c50", grout: "#232325", wall: "#1a1310", lip: "#8a4c26", void: "#050302", pattern: "grating" },
};

// A small steady number for a tile, so a stone's shape and shade stay put
// from frame to frame and from screen to screen.
function hash(x: number, y: number, k = 0): number {
  let h = (x * 374761393 + y * 668265263 + k * 2246822519) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

// The floor colour a little lighter or darker, by up to amount (0 to 1).
const shades = new Map<string, string>();
function shade(hex: string, amount: number): string {
  const key = `${hex}${amount.toFixed(2)}`;
  let c = shades.get(key);
  if (!c) {
    const n = parseInt(hex.slice(1), 16);
    const f = (v: number) => Math.round(Math.max(0, Math.min(255, v + amount * 255)));
    c = `rgb(${f(n >> 16)} ${f((n >> 8) & 255)} ${f(n & 255)})`;
    shades.set(key, c);
  }
  return c;
}
// four steps of shade, picked by a tile's hash
const varied = (hex: string, r: number) => shade(hex, (Math.floor(r * 4) - 1.5) * 0.018);

// One floor tile in its theme's pattern, filling the square at px, py of side
// s. x and y are the tile's place in the maze, which seeds its variation.
export function floorTile(ctx: CanvasRenderingContext2D, look: Look, px: number, py: number, s: number, x: number, y: number): void {
  const gap = Math.max(1, s * 0.04);
  ctx.fillStyle = look.grout;
  ctx.fillRect(px, py, s + 0.5, s + 0.5);
  switch (look.pattern) {
    case "tiles":
      ctx.fillStyle = look.floor;
      ctx.fillRect(px + gap, py + gap, s - gap, s - gap);
      return;
    case "flagstones": {
      // two courses of stones, each cut once at a place of its own
      const half = s / 2;
      for (let row = 0; row < 2; row++) {
        const cut = 0.3 + 0.4 * hash(x, y, row);
        const top = py + row * half + gap;
        const h = half - gap;
        ctx.fillStyle = varied(look.floor, hash(x, y, row + 10));
        ctx.fillRect(px + gap, top, s * cut - gap, h);
        ctx.fillStyle = varied(look.floor, hash(x, y, row + 20));
        ctx.fillRect(px + s * cut + gap, top, s * (1 - cut) - gap, h);
      }
      return;
    }
    case "bricks": {
      // three courses, every other one set over by half a brick
      const course = s / 3;
      for (let row = 0; row < 3; row++) {
        const top = py + row * course + gap / 2;
        const shift = (y * 3 + row) % 2 === 0 ? 0 : s / 4;
        for (let i = -1; i < 2; i++) {
          const left = Math.max(px, px + shift + i * (s / 2) + gap / 2);
          const right = Math.min(px + s, px + shift + (i + 1) * (s / 2) - gap / 2);
          if (right <= left) continue;
          ctx.fillStyle = varied(look.floor, hash(x * 2 + i, y * 3 + row, 3));
          ctx.fillRect(left, top, right - left, course - gap);
        }
      }
      return;
    }
    case "planks": {
      // boards running across, joined end to end where the hash says
      const board = s / 3;
      ctx.fillStyle = look.floor;
      for (let row = 0; row < 3; row++) {
        const top = py + row * board + gap / 2;
        const h = board - gap;
        const join = hash(x, y * 3 + row, 5) < 0.4 ? px + s * (0.2 + 0.6 * hash(x, y * 3 + row, 6)) : null;
        if (join === null) {
          ctx.fillStyle = varied(look.floor, hash(x >> 1, y * 3 + row, 7));
          ctx.fillRect(px, top, s + 0.5, h);
        } else {
          ctx.fillStyle = varied(look.floor, hash(x >> 1, y * 3 + row, 7));
          ctx.fillRect(px, top, join - px - gap / 2, h);
          ctx.fillStyle = varied(look.floor, hash(x >> 1, y * 3 + row, 8));
          ctx.fillRect(join + gap / 2, top, px + s - join - gap / 2 + 0.5, h);
        }
      }
      return;
    }
    case "grating": {
      // a steel plate with a grid of slots showing the dark beneath
      ctx.fillStyle = look.floor;
      ctx.fillRect(px + gap, py + gap, s - gap, s - gap);
      ctx.fillStyle = look.grout;
      const n = 3;
      const cell = (s - gap) / n;
      const slot = cell * 0.42;
      for (let i = 0; i < n; i++) {
        for (let j = 0; j < n; j++) {
          ctx.fillRect(px + gap + i * cell + (cell - slot) / 2, py + gap + j * cell + (cell - slot * 0.5) / 2 - cell * 0.12, slot, slot * 0.5);
        }
      }
      return;
    }
  }
}
