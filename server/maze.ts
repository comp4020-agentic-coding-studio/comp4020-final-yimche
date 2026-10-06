import type { Maze } from "../shared/world.ts";

// Small seeded PRNG (mulberry32) so a round's maze can be rebuilt from its seed.
export function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// How many rooms across the maze is for a given crowd: big enough that two
// players can lose each other, growing so a showcase room still has space.
export function mazeCells(players: number): number {
  return Math.min(22, 13 + players);
}

// A recursive-backtracker maze of cells×cells rooms, then "braided": every
// dead end is opened up and more walls knocked out at random, so corridors
// form loops you can circle round to come up behind someone.
export function generateMaze(cells: number, seed: number): Maze {
  const rand = rng(seed);
  const size = cells * 2 + 1;
  const grid: string[][] = Array.from({ length: size }, () => Array(size).fill("#"));
  const visited = new Set<number>();
  const stack: [number, number][] = [[0, 0]];
  visited.add(0);
  grid[1][1] = ".";
  while (stack.length > 0) {
    const [cx, cy] = stack[stack.length - 1];
    const next = (
      [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ] as const
    )
      .map(([dx, dy]) => [cx + dx, cy + dy] as const)
      .filter(([x, y]) => x >= 0 && y >= 0 && x < cells && y < cells && !visited.has(y * cells + x));
    if (next.length === 0) {
      stack.pop();
      continue;
    }
    const [nx, ny] = next[Math.floor(rand() * next.length)];
    visited.add(ny * cells + nx);
    grid[ny * 2 + 1][nx * 2 + 1] = ".";
    grid[cy + ny + 1][cx + nx + 1] = ".";
    stack.push([nx, ny]);
  }
  // Open every dead end into a neighbouring corridor. Only walls between two
  // rooms are removed, never the pillars at the corners, so it stays a maze of
  // corridors rather than opening into halls.
  const inside = (x: number, y: number) => x > 0 && y > 0 && x < size - 1 && y < size - 1;
  for (let cy = 0; cy < cells; cy++) {
    for (let cx = 0; cx < cells; cx++) {
      const x = cx * 2 + 1;
      const y = cy * 2 + 1;
      const sides = [
        [x + 1, y],
        [x - 1, y],
        [x, y + 1],
        [x, y - 1],
      ].filter(([wx, wy]) => grid[wy][wx] === "#");
      const walls = sides.filter(([wx, wy]) => inside(wx, wy));
      if (sides.length === 3 && walls.length > 0) {
        const [wx, wy] = walls[Math.floor(rand() * walls.length)];
        grid[wy][wx] = ".";
      }
    }
  }
  for (let y = 1; y < size - 1; y++) {
    for (let x = 1; x < size - 1; x++) {
      const between = (x % 2 === 0) !== (y % 2 === 0);
      if (between && grid[y][x] === "#" && rand() < 0.15) grid[y][x] = ".";
    }
  }
  return { w: size, h: size, rows: grid.map((r) => r.join("")) };
}
