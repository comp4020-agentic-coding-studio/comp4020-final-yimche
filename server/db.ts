import { mkdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

// /data is the Fly volume, the only storage that survives a redeploy.
const dir = process.env.DATA_DIR ?? "/data";
mkdirSync(dir, { recursive: true });
const db = new DatabaseSync(`${dir}/game.db`);

db.exec(`
  PRAGMA journal_mode = WAL;
  CREATE TABLE IF NOT EXISTS players (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    last_seen INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS rounds (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    seed INTEGER NOT NULL,
    started_at INTEGER NOT NULL,
    ended_at INTEGER,
    winner_id TEXT REFERENCES players(id),
    player_count INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS round_players (
    round_id INTEGER NOT NULL REFERENCES rounds(id),
    player_id TEXT NOT NULL REFERENCES players(id),
    PRIMARY KEY (round_id, player_id)
  );
  CREATE TABLE IF NOT EXISTS catches (
    round_id INTEGER NOT NULL REFERENCES rounds(id),
    catcher_id TEXT NOT NULL REFERENCES players(id),
    caught_id TEXT NOT NULL REFERENCES players(id),
    at INTEGER NOT NULL
  );
`);

export interface PlayerRow {
  id: string;
  name: string;
}

export interface Record {
  name: string;
  catches: number;
  caught: number;
  wins: number;
  rounds: number;
}

const q = {
  getPlayer: db.prepare("SELECT id, name FROM players WHERE id = ?"),
  upsertPlayer: db.prepare(`
    INSERT INTO players (id, name, created_at, last_seen) VALUES (?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET name = excluded.name, last_seen = excluded.last_seen`),
  touch: db.prepare("UPDATE players SET last_seen = ? WHERE id = ?"),
  startRound: db.prepare("INSERT INTO rounds (seed, started_at, player_count) VALUES (?, ?, ?)"),
  joinRound: db.prepare("INSERT OR IGNORE INTO round_players (round_id, player_id) VALUES (?, ?)"),
  endRound: db.prepare("UPDATE rounds SET ended_at = ?, winner_id = ? WHERE id = ?"),
  catch: db.prepare("INSERT INTO catches (round_id, catcher_id, caught_id, at) VALUES (?, ?, ?, ?)"),
  record: db.prepare(`
    SELECT p.name,
      (SELECT COUNT(*) FROM catches WHERE catcher_id = p.id) AS catches,
      (SELECT COUNT(*) FROM catches WHERE caught_id = p.id) AS caught,
      (SELECT COUNT(*) FROM rounds WHERE winner_id = p.id) AS wins,
      (SELECT COUNT(*) FROM round_players WHERE player_id = p.id) AS rounds
    FROM players p WHERE p.id = ?`),
  leaderboard: db.prepare(`
    SELECT p.name,
      (SELECT COUNT(*) FROM catches WHERE catcher_id = p.id) AS catches,
      (SELECT COUNT(*) FROM rounds WHERE winner_id = p.id) AS wins
    FROM players p
    WHERE catches > 0 OR wins > 0
    ORDER BY wins DESC, catches DESC
    LIMIT 10`),
  recentCatches: db.prepare(`
    SELECT a.name AS catcher, b.name AS caught, c.at
    FROM catches c JOIN players a ON a.id = c.catcher_id JOIN players b ON b.id = c.caught_id
    ORDER BY c.at DESC LIMIT 8`),
};

export const store = {
  getPlayer: (id: string) => q.getPlayer.get(id) as PlayerRow | undefined,
  savePlayer: (id: string, name: string) => q.upsertPlayer.run(id, name, Date.now(), Date.now()),
  touch: (id: string) => q.touch.run(Date.now(), id),
  startRound: (seed: number, playerIds: string[]) => {
    const id = Number(q.startRound.run(seed, Date.now(), playerIds.length).lastInsertRowid);
    for (const p of playerIds) q.joinRound.run(id, p);
    return id;
  },
  endRound: (id: number, winnerId: string | null) => q.endRound.run(Date.now(), winnerId, id),
  recordCatch: (roundId: number, catcherId: string, caughtId: string) =>
    q.catch.run(roundId, catcherId, caughtId, Date.now()),
  record: (id: string) => q.record.get(id) as Record | undefined,
  leaderboard: () => q.leaderboard.all() as { name: string; catches: number; wins: number }[],
  recentCatches: () => q.recentCatches.all() as { catcher: string; caught: string; at: number }[],
};
