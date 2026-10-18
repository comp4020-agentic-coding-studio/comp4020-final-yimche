import { describe, expect, it } from "vitest";
import { AWAY_GRACE_MS, ENDED_MS, Game, type Hooks } from "../server/game.ts";
import {
  CATCH_COOLDOWN_SECONDS,
  CATCH_SECONDS,
  CLOSE_AFTER_MS,
  CLOSE_TAKES_MS,
  FLASH_EVERY_MS,
  FLASH_MS,
  SPEED,
  SPEED_MS,
  TELEPORT_HALF_ANGLE,
  TELEPORT_MAX,
  TELEPORT_MIN,
  XRAY_MS,
  angleBetween,
  canSee,
  fallDepth,
  inBeam,
  type Maze,
} from "../shared/world.ts";

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
  expect(game.start("a", 0)).toBe(true); // a was in first, so a hosts
  game.tick(10_000, 0.05); // past the countdown
  expect(game.phase).toBe("playing");
  game.maze = maze;
  game.pickups = []; // scattered on the real maze; each test lays its own
  game.zone = { x: maze.w / 2, y: maze.h / 2 }; // so is where the floor falls in toward
  const a = game.players.get("a")!;
  const b = game.players.get("b")!;
  // spawned on the real maze too: put them in this one, apart and facing walls
  Object.assign(a, { x: 1.5, y: 1.5, facing: Math.PI });
  Object.assign(b, { x: 10.5, y: 3.5, facing: 0 });
  return { game, a, b, h };
}

describe("the first one in hosts the room", () => {
  it("the first player in is the host, and the round waits for them to start it", () => {
    const game = new Game(hooks());
    game.join("a", "A", 0);
    game.join("b", "B", 0);
    expect(game.roster().host).toBe("a");
    game.tick(60_000, 0.05);
    expect(game.phase).toBe("waiting"); // nobody pressed start, so nothing starts
    expect(game.start("a", 60_000)).toBe(true);
    expect(game.phase).toBe("countdown");
  });

  it("only the host can start the round", () => {
    const game = new Game(hooks());
    game.join("a", "A", 0);
    game.join("b", "B", 0);
    expect(game.start("b", 0)).toBe(false);
    expect(game.phase).toBe("waiting");
  });

  it("the host can't start a round alone", () => {
    const game = new Game(hooks());
    game.join("a", "A", 0);
    expect(game.start("a", 0)).toBe(false);
    expect(game.phase).toBe("waiting");
  });

  it("if the host leaves for good, whoever came in next takes over", () => {
    const game = new Game(hooks());
    game.join("a", "A", 0);
    game.join("b", "B", 0);
    game.join("c", "C", 0);
    game.leave("a", 0);
    game.tick(AWAY_GRACE_MS / 2, 0.05);
    expect(game.roster().host).toBe("a"); // a dropped connection keeps the job a while
    game.tick(AWAY_GRACE_MS + 1, 0.05);
    expect(game.roster().host).toBe("b");
    expect(game.start("b", AWAY_GRACE_MS + 1)).toBe(true);
  });

  it("after a round everyone's back in the lobby until the host starts another", () => {
    const { game, a, b } = playing();
    Object.assign(a, { x: 2.5, y: 2.5, facing: 0 });
    Object.assign(b, { x: 6.5, y: 2.5, facing: 0 });
    game.tick(10_000, CATCH_SECONDS + 0.01);
    expect(game.phase).toBe("ended");
    game.tick(10_000 + ENDED_MS + 1, 0.05);
    expect(game.phase).toBe("waiting");
    expect(b.status).toBe("alive"); // caught last round, in the next one
    game.tick(60_000, 0.05);
    expect(game.phase).toBe("waiting");
  });
});

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

  it("a flash every ten seconds shows everyone still in, then the dark comes back", () => {
    const { game, a, b } = playing(); // lights went out at 10_000
    Object.assign(a, { x: 5.5, y: 2.5, facing: 0 });
    Object.assign(b, { x: 2.5, y: 2.5, facing: Math.PI / 2 }); // behind a, torch away
    const before = game.viewFor("a", 10_000 + FLASH_EVERY_MS - 1);
    expect(FLASH_EVERY_MS).toBe(10_000);
    expect(before.flashMs).toBe(0);
    expect(before.nextFlashMs).toBe(1); // the countdown the player sees
    expect(before.others).toEqual([]);

    const flashAt = 10_000 + FLASH_EVERY_MS;
    game.tick(flashAt, 0);
    expect(game.viewFor("a", flashAt).flashMs).toBe(FLASH_MS);
    expect(game.viewFor("a", flashAt).nextFlashMs).toBe(FLASH_EVERY_MS);
    expect(game.viewFor("a", flashAt).others.map((o) => o.id)).toEqual(["b"]);
    expect(game.viewFor("a", flashAt + FLASH_MS).flashMs).toBe(0);
    expect(game.viewFor("a", flashAt + FLASH_MS).others).toEqual([]);

    game.tick(flashAt + FLASH_EVERY_MS, 0); // and again
    expect(game.viewFor("a", flashAt + FLASH_EVERY_MS).flashMs).toBe(FLASH_MS);
  });
});

describe("catching only counts from behind or the side", () => {
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

  it("two torches on each other stun the pair, like a bump, even from across a room", () => {
    const { game, a, b } = playing();
    const cooldown = CATCH_COOLDOWN_SECONDS * 1000;
    Object.assign(a, { x: 2.5, y: 2.5, facing: 0 }); // a looks east at b
    Object.assign(b, { x: 6.5, y: 2.5, facing: Math.PI }); // b looks west at a: a stand-off
    game.tick(10_000, 0.05);
    expect(game.viewFor("a", 10_000).me?.cooldownHeld).toBe(true);

    b.facing = 0; // b turns tail, back to a's torch
    game.tick(10_050, CATCH_SECONDS + 0.1);
    expect(b.status).toBe("alive"); // a's torch is still on b, so the stun holds

    a.facing = -Math.PI / 2; // a looks away, then back once the countdown runs out
    game.tick(10_100, 0.05);
    a.facing = 0;
    game.tick(10_100 + cooldown - 100, CATCH_SECONDS + 0.1);
    expect(b.status).toBe("alive");
    game.tick(10_100 + cooldown + 100, CATCH_SECONDS + 0.1);
    expect(b.status).toBe("caught");
  });

  it("coming at someone from the side catches them too; only the 90° in front of them is safe", () => {
    const { game, a, b } = playing();
    Object.assign(a, { x: 2.5, y: 2.5, facing: 0 }); // a looks east at b
    Object.assign(b, { x: 6.5, y: 2.5, facing: -Math.PI / 2 }); // b looks north: a is off b's left side
    game.tick(10_000, CATCH_SECONDS + 0.01);
    expect(b.status).toBe("caught");
  });

  it("someone looking within 45° of you is safe from your beam", () => {
    const { game, a, b } = playing();
    Object.assign(a, { x: 2.5, y: 2.5, facing: 0 });
    Object.assign(b, { x: 6.5, y: 2.5, facing: Math.PI - Math.PI / 5 }); // 36° off looking straight at a
    game.tick(10_000, CATCH_SECONDS + 1);
    expect(b.status).toBe("alive");
  });

  it("one torch on someone's back is not a stand-off", () => {
    const { game, a, b } = playing();
    Object.assign(a, { x: 2.5, y: 2.5, facing: 0 });
    Object.assign(b, { x: 6.5, y: 2.5, facing: 0 }); // b's torch points away from a
    game.tick(10_000, 0.05);
    expect(game.viewFor("a", 10_000).me?.cooldownHeld).toBe(false);
  });

  it("bumping again during the countdown starts the stun over", () => {
    const { game, a, b } = playing();
    const cooldown = CATCH_COOLDOWN_SECONDS * 1000;
    Object.assign(a, { x: 4, y: 2.5, facing: 0 });
    Object.assign(b, { x: 4.3, y: 2.5, facing: Math.PI });
    game.tick(10_000, 0.05); // the first bump, face to face
    expect(game.viewFor("a", 10_000).me?.cooldownHeld).toBe(true);

    a.facing = -Math.PI / 2; // both lights off: the countdown starts
    b.facing = Math.PI / 2;
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

// An open 31x31 floor, for rules about where things land.
const open31: Maze = {
  w: 31,
  h: 31,
  rows: Array.from({ length: 31 }, (_, y) => (y === 0 || y === 30 ? "#".repeat(31) : "#" + ".".repeat(29) + "#")),
};

describe("powerups take your one slot until you use them", () => {
  it("walking over a powerup picks it up, and it stays yours until you use it", () => {
    const { game, a } = playing();
    Object.assign(a, { x: 2.5, y: 2.5, facing: 0 });
    game.pickups = [{ id: 1, kind: "speed", x: 2.5, y: 2.5 }];
    game.tick(10_000, 0.05);
    expect(game.viewFor("a", 10_000).me?.item).toBe("speed");
    game.tick(30_000, 0.05); // long after, still carried
    expect(game.viewFor("a", 30_000).me?.item).toBe("speed");
    expect(game.use("a", 30_000)).toBe(true);
    expect(game.viewFor("a", 30_000).me?.item).toBe(null);
    expect(game.use("a", 40_000)).toBe(false); // used up
  });

  it("walking over another powerup swaps it for the one you had", () => {
    const { game, a } = playing();
    Object.assign(a, { x: 2.5, y: 2.5, facing: 0 });
    a.item = "xray";
    game.pickups = [{ id: 1, kind: "teleport", x: 2.5, y: 2.5 }];
    game.tick(10_000, 0.05);
    expect(game.viewFor("a", 10_000).me?.item).toBe("teleport");
  });

  it("a powerup picked up while another runs waits until that one wears off", () => {
    const { game, a } = playing();
    a.item = "speed";
    expect(game.use("a", 10_000)).toBe(true);
    a.item = "xray"; // picked up mid-boost
    expect(game.use("a", 10_000 + SPEED_MS - 1)).toBe(false);
    expect(game.viewFor("a", 10_000 + SPEED_MS - 1).me?.item).toBe("xray"); // still kept
    expect(game.use("a", 10_000 + SPEED_MS + 1)).toBe(true);
  });

  it("you can't use a powerup you haven't picked up", () => {
    const { game } = playing();
    expect(game.use("a", 10_000)).toBe(false);
  });

  it("a round starts with powerups spread across the maze, never two close together", () => {
    for (let n = 0; n < 5; n++) {
      const game = new Game(hooks());
      game.join("a", "A", 0);
      game.join("b", "B", 0);
      game.start("a", 0);
      game.tick(10_000, 0.05);
      const { pickups } = game.viewFor("a", 10_000);
      expect(pickups.length).toBe(4); // two more than there are players
      const gap = game.maze.w / 4; // a sector is under a third of the maze across
      for (const p of pickups) {
        for (const q of pickups) if (p !== q) expect(Math.hypot(p.x - q.x, p.y - q.y)).toBeGreaterThan(gap / 2);
      }
    }
  });

  it("a powerup taken turns up again somewhere else, so you can't farm one spot", () => {
    const { game, a } = playing();
    game.maze = open31;
    game.pickups = [];
    Object.assign(a, { x: 15.5, y: 15.5, facing: 0 });
    game.pickups = [{ id: 1, kind: "speed", x: 15.5, y: 15.5 }];
    for (let i = 0; i < 20; i++) {
      game.tick(10_000 + i * 50, 0.05);
      expect(game.pickups).toHaveLength(1); // the same number stays out
      expect(Math.hypot(game.pickups[0].x - 15.5, game.pickups[0].y - 15.5)).toBeGreaterThan(5);
      game.pickups[0].x = 15.5; // put it back under a's feet for the next try
      game.pickups[0].y = 15.5;
    }
  });

  it("a speed boost makes you faster for a few seconds, then wears off", () => {
    const { game, a } = playing();
    a.item = "speed";
    game.use("a", 10_000);
    game.pickups = [];
    Object.assign(a, { x: 1.5, y: 3.5, facing: 0 });
    game.setInput("a", 1, 0, null);
    game.tick(10_100, 0.5);
    expect(a.x - 1.5).toBeGreaterThan(SPEED * 0.5 * 1.2);
    a.x = 1.5;
    game.tick(10_000 + SPEED_MS + 1, 0.5);
    expect(a.x - 1.5).toBeCloseTo(SPEED * 0.5);
  });

  it("an x-ray torch shows someone through a wall, but can't catch them there", () => {
    const { game, a, b } = playing();
    Object.assign(a, { x: 4.5, y: 1.5, facing: 0 });
    Object.assign(b, { x: 7.5, y: 1.5, facing: 0 }); // behind the wall, back to a
    expect(game.viewFor("a", 10_000).others).toEqual([]);
    a.item = "xray";
    game.use("a", 10_000);
    expect(game.viewFor("a", 10_000).others.map((o) => o.id)).toEqual(["b"]);
    game.pickups = [];
    game.tick(10_050, CATCH_SECONDS + 0.1);
    expect(b.status).toBe("alive");
    expect(game.viewFor("a", 10_000 + XRAY_MS + 1).others).toEqual([]); // and it wears off
  });

  it("a teleport drops you somewhere else in the maze and breaks a beam on your back", () => {
    const { game, a, b } = playing();
    game.maze = open31;
    game.pickups = [];
    Object.assign(a, { x: 2.5, y: 2.5, facing: 0 });
    Object.assign(b, { x: 5.5, y: 2.5, facing: 0 }); // back to a's torch
    game.tick(10_000, CATCH_SECONDS / 2);
    expect(b.lit).toBe(true);
    b.item = "teleport";
    expect(game.use("b", 10_050)).toBe(true);
    expect(Math.hypot(b.x - 5.5, b.y - 2.5)).toBeGreaterThanOrEqual(TELEPORT_MIN);
    expect(b.exposure.size + (a.exposure.get("b") ?? 0)).toBe(0);
  });

  it("a teleport lands somewhere random, but ahead of where you're facing", () => {
    for (const facing of [0, Math.PI / 2, Math.PI, -Math.PI / 4]) {
      const spots = new Set<string>();
      for (let i = 0; i < 20; i++) {
        const { game, a } = playing();
        game.maze = open31;
        game.pickups = [];
        Object.assign(a, { x: 15.5, y: 15.5, facing });
        a.item = "teleport";
        game.use("a", 10_000);
        const d = Math.hypot(a.x - 15.5, a.y - 15.5);
        expect(d).toBeGreaterThanOrEqual(TELEPORT_MIN);
        expect(d).toBeLessThanOrEqual(TELEPORT_MAX);
        expect(angleBetween(Math.atan2(a.y - 15.5, a.x - 15.5), facing)).toBeLessThanOrEqual(TELEPORT_HALF_ANGLE);
        spots.add(`${a.x},${a.y}`);
      }
      expect(spots.size, "not the same spot every time").toBeGreaterThan(3);
    }
  });

  it("a teleport facing the edge of the maze still takes you somewhere", () => {
    const { game, a } = playing();
    game.maze = open31;
    game.pickups = [];
    Object.assign(a, { x: 28.5, y: 15.5, facing: 0 }); // the outer wall is right ahead
    a.item = "teleport";
    expect(game.use("a", 10_000)).toBe(true);
    expect(Math.hypot(a.x - 28.5, a.y - 15.5)).toBeGreaterThanOrEqual(TELEPORT_MIN);
  });
});

describe("the dark closes in so a round can't drag on", () => {
  it("for the first minute none of the floor falls", () => {
    const { game, a, b } = playing(); // lights went out at 10_000
    game.zone = { x: 6.5, y: 2.5 };
    Object.assign(a, { x: 1.5, y: 1.5, facing: Math.PI });
    Object.assign(b, { x: 10.5, y: 3.5, facing: 0 });
    game.tick(10_000 + CLOSE_AFTER_MS - 1, 0.05);
    expect([a.status, b.status]).toEqual(["alive", "alive"]);
    expect(game.viewFor("a", 10_000).zone?.closesInMs).toBe(CLOSE_AFTER_MS);
  });

  it("then it falls away until only a few tiles around one room are left", () => {
    const { game } = playing();
    game.zone = { x: 6.5, y: 2.5 };
    const r = (t: number) => game.zoneRadius(10_000 + t);
    expect(r(CLOSE_AFTER_MS + CLOSE_TAKES_MS / 2)).toBeLessThan(r(CLOSE_AFTER_MS));
    expect(r(CLOSE_AFTER_MS + CLOSE_TAKES_MS)).toBeLessThan(2);
    expect(r(CLOSE_AFTER_MS + CLOSE_TAKES_MS * 5)).toBe(r(CLOSE_AFTER_MS + CLOSE_TAKES_MS));
    // the room in the middle never falls
    expect(fallDepth(game.zone, r(CLOSE_AFTER_MS + CLOSE_TAKES_MS), 6, 2)).toBeLessThan(0);
  });

  it("the floor falls in scattered bits, not a neat ring", () => {
    const zone = { x: 20.5, y: 20.5 };
    // tiles the same distance out don't all fall at the same moment
    const ring = [[30, 20], [10, 20], [20, 30], [20, 10]].map(([x, y]) => fallDepth(zone, 0, x, y));
    expect(new Set(ring.map((d) => d.toFixed(3))).size).toBeGreaterThan(1);
  });

  it("stepping onto a fallen tile drops you straight away, and nobody gets the catch", () => {
    const h = hooks();
    const { game, a, b } = playing(h);
    game.zone = { x: 6.5, y: 2.5 };
    Object.assign(a, { x: 6.5, y: 2.5, facing: 0 });
    Object.assign(b, { x: 1.5, y: 1.5, facing: 0 });
    const closed = 10_000 + CLOSE_AFTER_MS + CLOSE_TAKES_MS;
    game.tick(closed, 0.05);
    expect(b.status).toBe("caught");
    expect(h.catches).toEqual([]);
    expect(game.phase).toBe("ended"); // a is the last torch standing
  });
});

describe("moving and aiming", () => {
  it("walking speeds up smoothly rather than starting at full pelt", () => {
    const { game, a } = playing();
    Object.assign(a, { x: 1.5, y: 3.5, facing: 0 });
    game.setInput("a", 1, 0, null);
    game.tick(10_050, 0.02);
    const first = a.x - 1.5;
    expect(first).toBeGreaterThan(0);
    expect(first).toBeLessThan(SPEED * 0.02);
    for (let i = 0; i < 20; i++) game.tick(10_100, 0.02);
    const before = a.x;
    game.tick(10_100, 0.02);
    expect(a.x - before).toBeCloseTo(SPEED * 0.02, 2); // up to speed
  });

  it("letting go glides to a stop instead of halting dead", () => {
    const { game, a } = playing();
    Object.assign(a, { x: 1.5, y: 3.5, facing: 0 });
    game.setInput("a", 1, 0, null);
    for (let i = 0; i < 20; i++) game.tick(10_100, 0.02);
    game.setInput("a", 0, 0, null);
    const before = a.x;
    game.tick(10_100, 0.02);
    expect(a.x).toBeGreaterThan(before);
    for (let i = 0; i < 50; i++) game.tick(10_100, 0.02);
    const stopped = a.x;
    game.tick(10_100, 0.02);
    expect(a.x).toBe(stopped);
  });

  it("the torch points at the cursor, whichever way you walk", () => {
    const { game, a } = playing();
    Object.assign(a, { x: 2.5, y: 3.5, facing: 0 });
    game.setInput("a", 1, 0, Math.PI / 2); // walking east, aiming south
    for (let i = 0; i < 5; i++) game.tick(10_100, 0.05);
    expect(a.facing).toBe(Math.PI / 2);
    game.setInput("a", 0, -1, Math.PI / 2); // turning north doesn't swing it
    game.tick(10_100, 0.05);
    expect(a.facing).toBe(Math.PI / 2);
  });
});
