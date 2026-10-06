import { generateMaze, mazeCells, rng } from "./maze.ts";
import {
  CATCH_COOLDOWN_SECONDS,
  CATCH_SECONDS,
  COLLIDE_DISTANCE,
  FLASH_EVERY_MS,
  FLASH_MS,
  SPEED,
  canSee,
  inBeam,
  isBehind,
  move,
  type Body,
  type Maze,
} from "../shared/world.ts";

// One shared room. The server owns every position and decides every catch;
// clients only send which way they want to go and where the torch points.

export type Phase = "waiting" | "countdown" | "playing" | "ended";
export type Status = "alive" | "caught" | "spectating";

export const COUNTDOWN_MS = 3000;
export const ENDED_MS = 5000;
export const AWAY_GRACE_MS = 8000; // a dropped connection keeps its place this long
export const MIN_PLAYERS = 2;

export interface Player extends Body {
  id: string;
  name: string;
  status: Status;
  connected: boolean;
  awaySince: number | null;
  input: { dx: number; dy: number; aim: number | null };
  // how long each other player has had this one's beam on them
  exposure: Map<string, number>;
  // other player id -> when a head-on bump with them stops blocking a catch
  cooldownUntil: Map<string, number>;
  // other players this one bumped and still has a torch between: the cooldown
  // stays full until the light comes off, and only then starts counting down
  cooldownHeld: Set<string>;
  lit: boolean;
}

export interface Hooks {
  roundStarted(seed: number, playerIds: string[]): number;
  roundEnded(roundId: number, winnerId: string | null): void;
  caught(roundId: number, catcherId: string, caughtId: string): void;
}

export interface CatchEvent {
  catcher: string;
  caught: string;
}

export class Game {
  phase: Phase = "waiting";
  phaseEndsAt = 0;
  maze: Maze;
  roundId = 0;
  winner: string | null = null;
  players = new Map<string, Player>();
  // bumped whenever the roster or round changes, so the transport knows to resend them
  rosterVersion = 0;
  roundVersion = 0;
  // Every so often the whole maze flashes into view for everyone at once, so you
  // can get your bearings, and for that moment everyone still in shows up too.
  flashStartedAt = -Infinity;
  nextFlashAt = Infinity;
  private hooks: Hooks;
  private seed = Date.now();

  constructor(hooks: Hooks) {
    this.hooks = hooks;
    this.maze = generateMaze(mazeCells(1), this.seed);
  }

  join(id: string, name: string, now: number): Player {
    let p = this.players.get(id);
    if (p) {
      p.name = name;
      p.connected = true;
      p.awaySince = null;
    } else {
      p = {
        id,
        name,
        x: 1.5,
        y: 1.5,
        facing: 0,
        status: this.phase === "playing" ? "spectating" : "alive",
        connected: true,
        awaySince: null,
        input: { dx: 0, dy: 0, aim: null },
        exposure: new Map(),
        cooldownUntil: new Map(),
        cooldownHeld: new Set(),
        lit: false,
      };
      this.players.set(id, p);
      if (this.phase === "countdown") this.spawn([p]);
    }
    this.rosterVersion++;
    this.advance(now);
    return p;
  }

  leave(id: string, now: number): void {
    const p = this.players.get(id);
    if (!p) return;
    p.connected = false;
    p.awaySince = now;
    p.input = { dx: 0, dy: 0, aim: null };
    this.rosterVersion++;
  }

  setInput(id: string, dx: number, dy: number, aim: number | null): void {
    const p = this.players.get(id);
    if (!p) return;
    const len = Math.hypot(dx, dy);
    p.input = len > 1 ? { dx: dx / len, dy: dy / len, aim } : { dx, dy, aim };
  }

  alive(): Player[] {
    return [...this.players.values()].filter((p) => p.status === "alive");
  }

  tick(now: number, dt: number): CatchEvent[] {
    for (const [id, p] of this.players) {
      if (!p.connected && p.awaySince !== null && now - p.awaySince > AWAY_GRACE_MS) {
        this.players.delete(id);
        this.rosterVersion++;
      }
    }
    // in the lobby you can wander about while you wait, but nobody gets caught
    if (this.phase === "playing" || this.phase === "waiting") this.walk(dt);
    const events = this.phase === "playing" ? this.catches(now, dt) : [];
    this.advance(now);
    return events;
  }

  private walk(dt: number): void {
    for (const p of this.alive()) {
      if (p.input.dx !== 0 || p.input.dy !== 0) {
        move(this.maze, p, p.input.dx * SPEED * dt, p.input.dy * SPEED * dt);
        p.facing = Math.atan2(p.input.dy, p.input.dx);
      }
      if (p.input.aim !== null) p.facing = p.input.aim;
    }
  }

  private catches(now: number, dt: number): CatchEvent[] {
    const alive = this.alive();
    const events: CatchEvent[] = [];
    const caughtNow = new Set<string>();
    for (const target of alive) target.lit = false;

    // A head-on bump: close enough to touch, and neither one snuck up on the
    // other. Doesn't catch anyone, but stuns the pair: a beam between them
    // doesn't count while either torch stays on the other, nor for a few
    // seconds after it comes off, so a stare-down in a corridor doesn't turn
    // into an instant trade. Bumping again starts the stun over.
    for (let i = 0; i < alive.length; i++) {
      for (let j = i + 1; j < alive.length; j++) {
        const [a, b] = [alive[i], alive[j]];
        const bumped =
          Math.hypot(a.x - b.x, a.y - b.y) <= COLLIDE_DISTANCE &&
          !isBehind(a, b) &&
          !isBehind(b, a); // one of them had the other's back
        if (bumped) {
          a.cooldownHeld.add(b.id);
          b.cooldownHeld.add(a.id);
        }
        if (!a.cooldownHeld.has(b.id)) continue;
        if (!inBeam(this.maze, a, b) && !inBeam(this.maze, b, a)) {
          // the light's off: let the countdown run, and don't hold again until another bump
          a.cooldownHeld.delete(b.id);
          b.cooldownHeld.delete(a.id);
          if (!bumped) continue;
        }
        const until = now + CATCH_COOLDOWN_SECONDS * 1000;
        a.cooldownUntil.set(b.id, until);
        b.cooldownUntil.set(a.id, until);
      }
    }

    for (const seeker of alive) {
      for (const target of alive) {
        if (seeker === target) continue;
        const catchable =
          inBeam(this.maze, seeker, target) &&
          isBehind(target, seeker) &&
          (target.cooldownUntil.get(seeker.id) ?? 0) <= now;
        if (!catchable) {
          target.exposure.delete(seeker.id);
          continue;
        }
        target.lit = true;
        const held = (target.exposure.get(seeker.id) ?? 0) + dt;
        target.exposure.set(seeker.id, held);
        if (held >= CATCH_SECONDS && !caughtNow.has(seeker.id) && !caughtNow.has(target.id)) {
          caughtNow.add(target.id);
          events.push({ catcher: seeker.id, caught: target.id });
        }
      }
    }
    for (const e of events) {
      const p = this.players.get(e.caught)!;
      p.status = "caught";
      p.exposure.clear();
      p.lit = false;
      this.hooks.caught(this.roundId, e.catcher, e.caught);
    }
    if (events.length > 0) this.rosterVersion++;
    return events;
  }

  // Moves the round between phases when its clock runs out or the room changes.
  private advance(now: number): void {
    const present = [...this.players.values()].filter((p) => p.connected || p.status === "alive");
    switch (this.phase) {
      case "waiting":
        if (present.length >= MIN_PLAYERS) this.startCountdown(now);
        break;
      case "countdown":
        if (present.length < MIN_PLAYERS) this.setPhase("waiting", 0);
        else if (now >= this.phaseEndsAt) {
          const ids = this.alive().map((p) => p.id);
          this.roundId = this.hooks.roundStarted(this.seed, ids);
          this.setPhase("playing", 0);
          this.flashStartedAt = -Infinity;
          this.nextFlashAt = now + FLASH_EVERY_MS;
        }
        break;
      case "playing": {
        if (now >= this.nextFlashAt) {
          this.flashStartedAt = this.nextFlashAt;
          this.nextFlashAt += FLASH_EVERY_MS;
        }
        // someone away past the grace period was dropped in tick(), which forfeits
        const alive = this.alive();
        if (alive.length <= 1) {
          this.winner = alive[0]?.id ?? null;
          this.hooks.roundEnded(this.roundId, this.winner);
          this.setPhase("ended", now + ENDED_MS);
        }
        break;
      }
      case "ended":
        if (now >= this.phaseEndsAt) {
          if (present.length >= MIN_PLAYERS) this.startCountdown(now);
          else this.setPhase("waiting", 0);
        }
        break;
    }
  }

  private startCountdown(now: number): void {
    this.seed = Math.floor(Math.random() * 2 ** 31);
    const players = [...this.players.values()].filter((p) => p.connected);
    // the maze grows with the room so a crowd still has space to hide
    this.maze = generateMaze(mazeCells(players.length), this.seed);
    this.winner = null;
    for (const p of players) {
      p.status = "alive";
      p.exposure.clear();
      p.cooldownUntil.clear();
      p.cooldownHeld.clear();
      p.lit = false;
    }
    this.spawn(players);
    this.setPhase("countdown", now + COUNTDOWN_MS);
    this.rosterVersion++;
  }

  // Spreads players out: each takes the free room farthest from everyone placed so far.
  private spawn(players: Player[]): void {
    const rand = rng(this.seed ^ players.length);
    const rooms: [number, number][] = [];
    for (let y = 1; y < this.maze.h; y += 2) {
      for (let x = 1; x < this.maze.w; x += 2) rooms.push([x + 0.5, y + 0.5]);
    }
    const placed = this.alive()
      .filter((p) => !players.includes(p))
      .map((p) => [p.x, p.y] as [number, number]);
    for (const p of players) {
      let best = rooms[Math.floor(rand() * rooms.length)];
      if (placed.length > 0) {
        let bestDist = -1;
        for (const r of rooms) {
          const d = Math.min(...placed.map(([x, y]) => Math.hypot(r[0] - x, r[1] - y)));
          if (d > bestDist) {
            bestDist = d;
            best = r;
          }
        }
      }
      placed.push(best);
      [p.x, p.y] = best;
      p.facing = rand() * Math.PI * 2;
    }
  }

  private setPhase(phase: Phase, endsAt: number): void {
    this.phase = phase;
    this.phaseEndsAt = endsAt;
    this.roundVersion++;
  }

  // What one player is allowed to know. Fog of war is enforced here, not in
  // the browser: a hidden player's position never leaves the server.
  viewFor(id: string, now: number) {
    const me = this.players.get(id);
    const flashMs = this.phase === "playing" ? Math.max(0, this.flashStartedAt + FLASH_MS - now) : 0;
    const seesAll = !me || me.status !== "alive" || this.phase !== "playing" || flashMs > 0;
    const visible = [...this.players.values()].filter(
      (p) =>
        p.id !== id &&
        p.status === "alive" &&
        (seesAll || canSee(this.maze, me, p)),
    );
    // how long a bump with each player still shields the pair, so both can see it
    const cooldownMs = (p: Player) => (me ? Math.max(0, (me.cooldownUntil.get(p.id) ?? 0) - now) : 0);
    return {
      t: "state" as const,
      phase: this.phase,
      remainingMs: this.phaseEndsAt ? Math.max(0, this.phaseEndsAt - now) : 0,
      flashMs,
      nextFlashMs: this.phase === "playing" ? Math.max(0, this.nextFlashAt - now) : 0,
      me: me && {
        x: me.x,
        y: me.y,
        facing: me.facing,
        status: me.status,
        lit: me.lit,
        cooldownHeld: me.cooldownHeld.size > 0,
        cooldownMs: Math.max(0, ...[...me.cooldownUntil.values()].map((t) => t - now)),
      },
      others: visible.map((p) => ({ id: p.id, x: p.x, y: p.y, facing: p.facing,
        cooldownMs: cooldownMs(p),
        cooldownHeld: !!me?.cooldownHeld.has(p.id),
      })),
    };
  }

  roster() {
    return {
      t: "roster" as const,
      alive: this.alive().length,
      total: [...this.players.values()].filter((p) => p.status !== "spectating").length,
      players: [...this.players.values()].map((p) => ({
        id: p.id,
        name: p.name,
        status: p.status,
        away: !p.connected,
      })),
    };
  }

  round() {
    return {
      t: "round" as const,
      id: this.roundId,
      phase: this.phase,
      maze: this.maze.rows,
      winner: this.winner && (this.players.get(this.winner)?.name ?? null),
    };
  }
}
