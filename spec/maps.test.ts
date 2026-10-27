import { describe, expect, it } from "vitest";
import { generateMaze, mazeCells } from "../server/maze.ts";
import { MAP_MAX, MIN_SPOTS, cleanMapName, mapProblem, unreachable } from "../shared/maps.ts";

// The rules a hand-made map has to keep before anyone can play on it. The
// editor and the server both ask these, so the wording is what a mapmaker reads.

// An open room inside a wall: every spot open, nothing sealed off.
const open = (w = 11, h = 11) =>
  Array.from({ length: h }, (_, y) => (y === 0 || y === h - 1 ? "#".repeat(w) : "#" + ".".repeat(w - 2) + "#"));

const setTile = (rows: string[], x: number, y: number, c: string) =>
  rows.map((r, j) => (j === y ? r.slice(0, x) + c + r.slice(x + 1) : r));

describe("a hand-made map", () => {
  it("an open room inside a wall is a playable map, and so is every generated maze", () => {
    expect(mapProblem(open())).toBe(null);
    expect(mapProblem(open(41, 21))).toBe(null);
    for (const players of [2, 6, 50]) expect(mapProblem(generateMaze(mazeCells(players), players).rows)).toBe(null);
  });

  it("has to be walled in all the way round", () => {
    expect(mapProblem(setTile(open(), 0, 5, "."))).toMatch(/outside edge/);
    expect(mapProblem(setTile(open(), 5, 10, "."))).toMatch(/outside edge/);
  });

  it("is between 11 and 41 squares each way, an odd number, every row the same length", () => {
    expect(mapProblem(open(9, 11))).toMatch(/11 to 41/);
    expect(mapProblem(open(MAP_MAX + 2, 11))).toMatch(/11 to 41/);
    expect(mapProblem(open(12, 11))).toMatch(/odd/);
    expect(mapProblem([...open().slice(0, 10), "#".repeat(10)])).toMatch(/same length/);
  });

  it("is made of walls and floor and nothing else", () => {
    expect(mapProblem(setTile(open(), 3, 3, "X"))).toMatch(/walls and floor/);
    expect(mapProblem("not a map")).toMatch(/grid/);
    expect(mapProblem([1, 2, 3])).toMatch(/grid/);
  });

  it("needs enough open spots for players and powerups to spread out", () => {
    // walls on every odd square but a few
    let rows = open(15, 15);
    let left = 0;
    for (let y = 1; y < 14; y += 2) {
      for (let x = 1; x < 14; x += 2) {
        if (left < MIN_SPOTS - 1) left++;
        else rows = setTile(rows, x, y, "#");
      }
    }
    expect(mapProblem(rows)).toMatch(/at least 12/);
  });

  it("can't leave any floor sealed off from the rest", () => {
    // a wall straight down the middle cuts the room in two
    const split = open(21, 11).map((r, y) => (y === 0 || y === 10 ? r : r.slice(0, 10) + "#" + r.slice(11)));
    expect(mapProblem(split)).toMatch(/sealed off/);
    expect(unreachable(split).size).toBeGreaterThan(0);
    expect(unreachable(open()).size).toBe(0);
  });

  it("is named with 1 to 24 characters", () => {
    expect(cleanMapName("  The Catacombs ")).toBe("The Catacombs");
    expect(cleanMapName("   ")).toBe(null);
    expect(cleanMapName("x".repeat(40))?.length).toBe(24);
    expect(cleanMapName(7)).toBe(null);
  });
});
