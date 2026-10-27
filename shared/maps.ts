// What makes a hand-made map playable. The editor checks a map with these as
// it's drawn, and the server checks it again before it goes in the shared
// library, so a map that uploads is a map a round can be played on.

import type { Maze } from "./world.ts";

// Odd sizes, so the outer wall lands on both edges and the spots on odd
// squares (where players and powerups appear) sit inside it.
export const MAP_MIN = 11;
export const MAP_MAX = 41;
// Players spawn, powerups land and the floor falls in toward spots on the odd
// squares, so a map needs enough of them open for a crowd to spread out.
export const MIN_SPOTS = 12;
export const MAP_NAME_MAX = 24;

// A spot: a floor tile on an odd square, where the game puts people and powerups.
export const isSpot = (x: number, y: number) => x % 2 === 1 && y % 2 === 1;

export function toMaze(rows: string[]): Maze {
  return { w: rows[0]?.length ?? 0, h: rows.length, rows };
}

// Floor tiles that can't be walked to from the biggest open area, by
// "x,y". A map is only fair when this is empty: nobody spawns sealed off.
export function unreachable(rows: string[]): Set<string> {
  const floor: [number, number][] = [];
  rows.forEach((row, y) => [...row].forEach((c, x) => c === "." && floor.push([x, y])));
  const seen = new Map<string, number>();
  const sizes: number[] = [];
  for (const [sx, sy] of floor) {
    if (seen.has(`${sx},${sy}`)) continue;
    const group = sizes.length;
    let size = 0;
    const stack = [[sx, sy]];
    seen.set(`${sx},${sy}`, group);
    while (stack.length > 0) {
      const [x, y] = stack.pop()!;
      size++;
      for (const [nx, ny] of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]]) {
        if (rows[ny]?.[nx] !== "." || seen.has(`${nx},${ny}`)) continue;
        seen.set(`${nx},${ny}`, group);
        stack.push([nx, ny]);
      }
    }
    sizes.push(size);
  }
  const biggest = sizes.indexOf(Math.max(...sizes));
  return new Set([...seen].filter(([, g]) => g !== biggest).map(([k]) => k));
}

// Why a map can't be played, in words for the person drawing it, or null
// when it's fine.
export function mapProblem(rows: unknown): string | null {
  if (!Array.isArray(rows) || !rows.every((r) => typeof r === "string")) return "A map is a grid of rows";
  const h = rows.length;
  const w = rows[0]?.length ?? 0;
  if (h < MAP_MIN || h > MAP_MAX || w < MAP_MIN || w > MAP_MAX) return `A map is ${MAP_MIN} to ${MAP_MAX} squares each way`;
  if (w % 2 === 0 || h % 2 === 0) return "A map is an odd number of squares each way";
  if (rows.some((r) => r.length !== w)) return "Every row of a map is the same length";
  if (rows.some((r) => /[^#.]/.test(r))) return "A map is made of walls and floor only";
  const edge = rows[0] + rows[h - 1] + rows.map((r) => r[0] + r[w - 1]).join("");
  if (edge.includes(".")) return "The outside edge has to be wall all the way round";
  let spots = 0;
  rows.forEach((r, y) => [...r].forEach((c, x) => c === "." && isSpot(x, y) && spots++));
  if (spots < MIN_SPOTS) return `Open at least ${MIN_SPOTS} of the marked spots, so players and powerups have somewhere to go`;
  if (unreachable(rows).size > 0) return "Some floor is sealed off from the rest; join it up or wall it in";
  return null;
}

// A map's name: 1 to 24 printable characters, trimmed.
export function cleanMapName(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const name = raw.replace(/[\p{C}]/gu, "").trim().slice(0, MAP_NAME_MAX);
  return name.length > 0 ? name : null;
}
