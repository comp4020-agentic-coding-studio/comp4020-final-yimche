import { describe, expect, it } from "vitest";
import { Game, type Hooks } from "../server/game.ts";
import { CATCH_COOLDOWN_SECONDS, CATCH_SECONDS, canSee, inBeam, type Maze } from "../shared/world.ts";

// The rules of the game, checked on the server's own logic rather than over
// the wire: these are the claims a browser can't be trusted to enforce.

// A corridor with a wall halfway along it, and an open room below.
const maze: Maze = {
  w: 12,
  h: 5,
  rows: ["############", "#.....#....#", "#..........#", "#..........#", "############"],
};

const hooks = (): Hooks & { catches: [string, string][] } => {
  const catches: [string, string][] = [];
  return {
    catches,
    roundStarted: () => 1,
    roundEnded: () => {},
    caught: (_r, a, b) => catches.push([a, b]),
  };
};

function playing(h = hooks()) {
  const game = new Game(h);
  game.join("a", "A", 0);
  game.join("b", "B", 0);
  game.tick(10_000, 0.05); // past the countdown
  expect(game.phase).toBe("playing");
  game.maze = maze;
  const a = game.players.get("a")!;
  const b = game.players.get("b")!;
  return { game, a, b, h };
}

describe("torchlight", () => {
  it("a wall stops the beam", () => {
    const a = { x: 2.5, y: 1.5, facing: 0 };
    expect(inBeam(maze, a, { x: 5.5, y: 1.5, facing: 0 })).toBe(true);
    expect(inBeam(maze, a, { x: 7.5, y: 1.5, facing: 0 })).toBe(false);
  });

  it("you can't see someone behind you in the dark", () => {
    const a = { x: 5.5, y: 2.5, facing: 0 };
    expect(canSee(maze, a, { x: 2.5, y: 2.5, facing: 0 })).toBe(false);
    expect(canSee(maze, a, { x: 8.5, y: 2.5, facing: 0 })).toBe(true);
  });
});

describe("fog of war is enforced by the server", () => {
  it("never sends a hidden player's position", () => {
    const { game, a, b } = playing();
    Object.assign(a, { x: 5.5, y: 2.5, facing: 0 });
    Object.assign(b, { x: 2.5, y: 2.5, facing: Math.PI / 2 }); // behind a, torch away
    expect(game.viewFor("a", 0).others).toEqual([]);
    a.facing = Math.PI;
    expect(game.viewFor("a", 0).others.map((o) => o.id)).toEqual(["b"]);
  });
});

describe("catching only counts from behind", () => {
  it("holding the beam on someone's back catches them, a flash doesn't", () => {
    const { game, a, b, h } = playing();
    Object.assign(a, { x: 2.5, y: 2.5, facing: 0 }); // a looks east, straight at b
    Object.assign(b, { x: 6.5, y: 2.5, facing: 0 }); // b looks east too: back turned to a
    game.tick(10_000, CATCH_SECONDS / 2);
    expect(b.status).toBe("alive");
    expect(b.lit).toBe(true);
    game.tick(10_050, CATCH_SECONDS / 2 + 0.01);
    expect(b.status).toBe("caught");
    expect(h.catches).toEqual([["a", "b"]]);
  });

  it("facing your pursuer keeps you safe, however long they hold the beam", () => {
    const { game, a, b } = playing();
    Object.assign(a, { x: 2.5, y: 2.5, facing: 0 }); // a looks east at b
    Object.assign(b, { x: 6.5, y: 2.5, facing: Math.PI }); // b looks west, straight back at a
    game.tick(10_000, CATCH_SECONDS + 1);
    expect(b.status).toBe("alive");
    expect(b.lit).toBe(false);
  });

  it("a head-on bump stuns the pair while the light stays on, then counts down once it's off", () => {
    const { game, a, b } = playing();
    const cooldown = CATCH_COOLDOWN_SECONDS * 1000;
    // walk into each other, face to face
    Object.assign(a, { x: 4, y: 2.5, facing: 0 });
    Object.assign(b, { x: 4.3, y: 2.5, facing: Math.PI });
    game.tick(10_000, 0.05); // the bump: starts the stun between a and b

    b.facing = 0; // b turns away, back now exposed to a
    const off = 10_000 + cooldown * 3;
    game.tick(off, CATCH_SECONDS + 0.1);
    expect(b.status).toBe("alive"); // a's torch is still on b, so the stun holds

    a.facing = -Math.PI / 2; // a looks away: the countdown runs from the last tick the light was on
    game.tick(off + 50, 0.05);
    a.facing = 0; // and back, which doesn't hold the stun again
    game.tick(off + cooldown - 100, CATCH_SECONDS + 0.1);
    expect(b.status).toBe("alive"); // still counting down

    game.tick(off + cooldown + 100, CATCH_SECONDS + 0.1);
    expect(b.status).toBe("caught"); // the stun's over, the exposure counts again
  });

  it("bumping again during the countdown starts the stun over", () => {
    const { game, a, b } = playing();
    const cooldown = CATCH_COOLDOWN_SECONDS * 1000;
    Object.assign(a, { x: 4, y: 2.5, facing: -Math.PI / 2 });
    Object.assign(b, { x: 4.3, y: 2.5, facing: Math.PI });
    game.tick(10_000, 0.05); // a bump with a's torch already off b: countdown from here
    expect(game.viewFor("a", 10_000).me?.cooldownHeld).toBe(true); // b's torch is on a

    b.facing = Math.PI / 2; // both lights off
    game.tick(10_050, 0.05);
    expect(game.viewFor("a", 10_050).me?.cooldownHeld).toBe(false);

    a.facing = 0; // face to face again: a fresh bump
    b.facing = Math.PI;
    game.tick(10_000 + cooldown - 100, 0.05);
    expect(game.viewFor("a", 10_000 + cooldown - 100).me?.cooldownHeld).toBe(true);
    expect(game.viewFor("a", 10_000 + cooldown - 100).others[0].cooldownMs).toBe(cooldown);
  });

  it("the last one standing wins and the tracker counts down", () => {
    const { game, a, b } = playing();
    expect(game.roster()).toMatchObject({ alive: 2, total: 2 });
    Object.assign(a, { x: 2.5, y: 2.5, facing: 0 });
    Object.assign(b, { x: 6.5, y: 2.5, facing: 0 });
    game.tick(10_000, CATCH_SECONDS + 0.01);
    expect(game.roster()).toMatchObject({ alive: 1, total: 2 });
    expect(game.phase).toBe("ended");
    expect(game.round().winner).toBe("A");
  });

  it("someone arriving mid-round waits for the next one", () => {
    const { game } = playing();
    game.join("c", "C", 10_000);
    expect(game.players.get("c")!.status).toBe("spectating");
    expect(game.roster()).toMatchObject({ alive: 2, total: 2 });
  });
});
