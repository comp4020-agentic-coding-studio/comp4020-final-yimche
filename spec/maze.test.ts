import { describe, expect, it } from "vitest";
import { generateMaze, mazeCells } from "../server/maze.ts";
import { move, PLAYER_RADIUS, type Maze } from "../shared/world.ts";

// The maze has to be worth sneaking round: big, full of loops, and never a
// trap for the player's own body.

const floor = (m: Maze, x: number, y: number) => m.rows[y]?.[x] === ".";

describe("the maze", () => {
  it("is big enough for two players to lose each other", () => {
    expect(generateMaze(mazeCells(2), 1).w).toBeGreaterThanOrEqual(31);
  });

  it("has no dead ends, so there's always a way round", () => {
    for (const seed of [1, 2, 3, 42, 1234]) {
      const m = generateMaze(14, seed);
      for (let y = 1; y < m.h; y += 2) {
        for (let x = 1; x < m.w; x += 2) {
          const exits = [floor(m, x + 1, y), floor(m, x - 1, y), floor(m, x, y + 1), floor(m, x, y - 1)];
          expect(exits.filter(Boolean).length, `dead end at ${x},${y} (seed ${seed})`).toBeGreaterThan(1);
        }
      }
    }
  });

  it("every room can be reached", () => {
    const m = generateMaze(14, 7);
    const seen = new Set(["1,1"]);
    const queue = [[1, 1]];
    while (queue.length) {
      const [x, y] = queue.pop()!;
      for (const [nx, ny] of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]]) {
        if (floor(m, nx, ny) && !seen.has(`${nx},${ny}`)) {
          seen.add(`${nx},${ny}`);
          queue.push([nx, ny]);
        }
      }
    }
    const open = m.rows.join("").split("").filter((c) => c === ".").length;
    expect(seen.size).toBe(open);
  });
});

describe("moving through corridors", () => {
  // a vertical corridor at x=1 with a side corridor going right at y=3
  const maze: Maze = {
    w: 6,
    h: 6,
    rows: ["######", "#.####", "#.####", "#.....", "#.####", "######"],
  };

  it("turns into a side corridor even when slightly off-centre", () => {
    // 0.25 below the side corridor's centre: the body overlaps the wall under it
    const body = { x: 1.5, y: 3.75, facing: 0 };
    for (let i = 0; i < 30; i++) move(maze, body, 0.1, 0);
    expect(body.x).toBeGreaterThan(3);
    expect(Math.abs(body.y - 3.5)).toBeLessThanOrEqual(0.5 - PLAYER_RADIUS);
  });

  it("still stops at a solid wall", () => {
    const body = { x: 1.5, y: 1.5, facing: 0 };
    for (let i = 0; i < 30; i++) move(maze, body, 0.1, 0);
    expect(body.x).toBeGreaterThan(2 - PLAYER_RADIUS - 0.01);
    expect(body.x).toBeLessThan(2 - PLAYER_RADIUS);
    expect(body.y).toBe(1.5);
  });
});
