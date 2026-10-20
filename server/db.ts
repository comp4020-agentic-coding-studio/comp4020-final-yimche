import { mkdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

// /data is the Fly volume, the only storage that survives a redeploy.
const dir = process.env.DATA_DIR ?? "/data";
mkdirSync(dir, { recursive: true });
const db = new DatabaseSync(`${dir}/game.db`);
db.exec("PRAGMA journal_mode = WAL");

// Bumped when the schema changes in a way old rows can't carry over. Version 1
// brought in accounts and started the board afresh: everything from the
// name-only days before it, players included, is dropped on first boot.
const SCHEMA = 1;
const { user_version } = db.prepare("PRAGMA user_version").get() as { user_version: number };
if (user_version < SCHEMA) {
  db.exec(`
    BEGIN;
    DROP TABLE IF EXISTS catches;
    DROP TABLE IF EXISTS round_players;
    DROP TABLE IF EXISTS rounds;
    DROP TABLE IF EXISTS sessions;
    DROP TABLE IF EXISTS players;
    PRAGMA user_version = ${SCHEMA};
    COMMIT;
  `);
}

// A player with no username is a guest. A guest's record is kept against
// their cookie, shown only to them and never on the board, and comes with them
// if they make an account. A session token is what the cookie holds; it is
// never the player id, which everyone in a room is sent.
db.exec(`
  CREATE TABLE IF NOT EXISTS players (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    username TEXT UNIQUE COLLATE NOCASE,
    pass TEXT,
    created_at INTEGER NOT NULL,
    last_seen INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS sessions (
    token TEXT PRIMARY KEY,
    player_id TEXT NOT NULL REFERENCES players(id),
    created_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS rounds (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    mode TEXT NOT NULL,
    seed INTEGER NOT NULL,
    started_at INTEGER NOT NULL,
    ended_at INTEGER,
    player_count INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS round_players (
    round_id INTEGER NOT NULL REFERENCES rounds(id),
    player_id TEXT NOT NULL REFERENCES players(id),
    team TEXT,
    won INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (round_id, player_id)
  );
  CREATE TABLE IF NOT EXISTS catches (
    round_id INTEGER NOT NULL REFERENCES rounds(id),
    catcher_id TEXT REFERENCES players(id),
    caught_id TEXT REFERENCES players(id),
    kind TEXT NOT NULL,
    at INTEGER NOT NULL
  );
`);

// Guests who haven't been back in a month are forgotten, record and all. A
// catch between them and someone else stays on the other one's record.
const MONTH = 30 * 24 * 60 * 60 * 1000;
const stale = "(SELECT id FROM players WHERE username IS NULL AND last_seen < ?)";
const cutoff = Date.now() - MONTH;
db.prepare(`DELETE FROM sessions WHERE player_id IN ${stale}`).run(cutoff);
db.prepare(`DELETE FROM round_players WHERE player_id IN ${stale}`).run(cutoff);
db.prepare(`UPDATE catches SET catcher_id = NULL WHERE catcher_id IN ${stale}`).run(cutoff);
db.prepare(`UPDATE catches SET caught_id = NULL WHERE caught_id IN ${stale}`).run(cutoff);
db.prepare(`DELETE FROM players WHERE id IN ${stale}`).run(cutoff);

export interface PlayerRow {
  id: string;
  name: string;
  guest: boolean;
}

export interface Record {
  name: string;
  guest: boolean;
  rounds: number;
  wins: number;
  catches: number;
  caught: number;
  falls: number;
  modes: { [mode: string]: { rounds: number; wins: number } };
}

const q = {
  bySession: db.prepare(`
    SELECT p.id, p.name, p.username IS NULL AS guest
    FROM sessions s JOIN players p ON p.id = s.player_id WHERE s.token = ?`),
  byUsername: db.prepare("SELECT id, name, pass FROM players WHERE username = ?"),
  addPlayer: db.prepare(`
    INSERT INTO players (id, name, username, pass, created_at, last_seen) VALUES (?, ?, ?, ?, ?, ?)`),
  renameGuest: db.prepare("UPDATE players SET name = ?, last_seen = ? WHERE id = ? AND username IS NULL"),
  upgrade: db.prepare("UPDATE players SET username = ?, name = ?, pass = ? WHERE id = ? AND username IS NULL"),
  touch: db.prepare("UPDATE players SET last_seen = ? WHERE id = ?"),
  addSession: db.prepare("INSERT INTO sessions (token, player_id, created_at) VALUES (?, ?, ?)"),
  dropSession: db.prepare("DELETE FROM sessions WHERE token = ?"),
  startRound: db.prepare("INSERT INTO rounds (mode, seed, started_at, player_count) VALUES (?, ?, ?, ?)"),
  joinRound: db.prepare("INSERT OR IGNORE INTO round_players (round_id, player_id, team) VALUES (?, ?, ?)"),
  endRound: db.prepare("UPDATE rounds SET ended_at = ? WHERE id = ?"),
  won: db.prepare("UPDATE round_players SET won = 1 WHERE round_id = ? AND player_id = ?"),
  catch: db.prepare("INSERT INTO catches (round_id, catcher_id, caught_id, kind, at) VALUES (?, ?, ?, ?, ?)"),
  record: db.prepare(`
    SELECT p.name, p.username IS NULL AS guest,
      (SELECT COUNT(*) FROM round_players WHERE player_id = p.id) AS rounds,
      (SELECT COUNT(*) FROM round_players WHERE player_id = p.id AND won = 1) AS wins,
      (SELECT COUNT(*) FROM catches WHERE catcher_id = p.id AND kind = 'catch') AS catches,
      (SELECT COUNT(*) FROM catches WHERE caught_id = p.id AND kind = 'catch') AS caught,
      (SELECT COUNT(*) FROM catches WHERE caught_id = p.id AND kind = 'fall') AS falls
    FROM players p WHERE p.id = ?`),
  byMode: db.prepare(`
    SELECT r.mode, COUNT(*) AS rounds, SUM(rp.won) AS wins
    FROM round_players rp JOIN rounds r ON r.id = rp.round_id
    WHERE rp.player_id = ? GROUP BY r.mode`),
  leaderboard: db.prepare(`
    SELECT * FROM (
      SELECT p.name,
        (SELECT COUNT(*) FROM round_players WHERE player_id = p.id) AS rounds,
        (SELECT COUNT(*) FROM round_players WHERE player_id = p.id AND won = 1) AS wins,
        (SELECT COUNT(*) FROM catches WHERE catcher_id = p.id AND kind = 'catch') AS catches
      FROM players p WHERE p.username IS NOT NULL)
    WHERE rounds > 0
    ORDER BY wins DESC, catches DESC
    LIMIT 10`),
};

export const store = {
  session: (token: string): PlayerRow | undefined => {
    const row = q.bySession.get(token) as { id: string; name: string; guest: number } | undefined;
    return row && { id: row.id, name: row.name, guest: row.guest === 1 };
  },
  byUsername: (username: string) =>
    q.byUsername.get(username) as { id: string; name: string; pass: string } | undefined,
  addGuest: (id: string, name: string) => q.addPlayer.run(id, name, null, null, Date.now(), Date.now()),
  addAccount: (id: string, username: string, pass: string) =>
    q.addPlayer.run(id, username, username, pass, Date.now(), Date.now()),
  renameGuest: (id: string, name: string) => q.renameGuest.run(name, Date.now(), id),
  // a guest who makes an account keeps their player, so they stay in their room
  upgrade: (id: string, username: string, pass: string) => q.upgrade.run(username, username, pass, id),
  touch: (id: string) => q.touch.run(Date.now(), id),
  addSession: (token: string, playerId: string) => q.addSession.run(token, playerId, Date.now()),
  dropSession: (token: string) => q.dropSession.run(token),
  startRound: (mode: string, seed: number, total: number, players: { id: string; team: string | null }[]) => {
    const id = Number(q.startRound.run(mode, seed, Date.now(), total).lastInsertRowid);
    for (const p of players) q.joinRound.run(id, p.id, p.team);
    return id;
  },
  endRound: (id: number, winnerIds: string[]) => {
    q.endRound.run(Date.now(), id);
    for (const w of winnerIds) q.won.run(id, w);
  },
  recordCatch: (roundId: number, catcherId: string | null, caughtId: string | null, kind: "catch" | "fall") =>
    q.catch.run(roundId, catcherId, caughtId, kind, Date.now()),
  record: (id: string): Record | undefined => {
    const row = q.record.get(id) as (Omit<Record, "modes" | "guest"> & { guest: number }) | undefined;
    if (!row) return undefined;
    const modes: Record["modes"] = {};
    for (const m of q.byMode.all(id) as { mode: string; rounds: number; wins: number }[]) {
      modes[m.mode] = { rounds: m.rounds, wins: m.wins };
    }
    return { ...row, guest: row.guest === 1, modes };
  },
  leaderboard: () => q.leaderboard.all() as { name: string; rounds: number; wins: number; catches: number }[],
};
