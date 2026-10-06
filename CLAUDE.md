# Harness for this deliverable

The final project (crits 8, 9 and 10, then submission): Torchlight, hide and
seek in a dark maze where everyone is the seeker. A few friends open the link,
give a name, and play rounds in one shared room; their record stays on the
board. Built on plain Node (TypeScript run directly), `ws`, `node:sqlite` and a
canvas client bundled by esbuild, deployed to one Fly machine.

These are the rules the agent works under here. They are mine, decided for this
app, and they are part of what gets marked.

## Ground truth and honesty

- **The server owns the truth.** Every position, catch and round result is
  decided in `server/game.ts`. The client only sends input (direction, aim) and
  draws what it's sent. Never move a game decision into the browser.
- **One geometry, shared.** Beam, line of sight, movement and catch rules live
  in `shared/world.ts`, used by both sides, so the beam a player sees is the
  beam they're judged by. Don't write a second copy on either side.
- **Persistent state lives in SQLite** (`server/db.ts`) on the Fly volume at
  `/data`, the only storage that survives a redeploy. The in-memory room is
  allowed to be lost on restart; records are not.
- `PROCESS.md` and the reflections describe what actually happened. Don't
  claim a step, a source or a correction that the history doesn't show.

## What the app must keep doing

- **Fog of war is enforced by the server.** A player's view never contains
  the position of someone they can't see. The one exception is the flash every
  ten seconds, which the server decides and times for everyone at once.
  `spec/game.test.ts` guards both.
- **A name is all it takes to play,** and a returning cookie gets the same
  player and record back. That's the core flow; `spec/multiplayer.test.ts`
  guards it.
- **Catches only count from behind,** with a held beam, never a flash. The
  game rules are written as tests named the way a player would say them; a new
  rule gets a new test before it's trusted.
- `/` answers and `/readme/` publishes `README.md` in full
  (`spec/invariants.test.ts`). Keep both.

## Working rules

- Keep `pnpm check` green (typecheck + the running-app tests). The tests run
  against a live server, so start one (`pnpm dev`, or `pnpm build` then
  `DATA_DIR=$(mktemp -d) pnpm start`) before running them.
- Test **contracts, not construction**: assert what the game does, so a test
  survives a rewrite of how it's built.
- Match the house style: small commented modules, no framework, one process
  and one room (the app is single-machine by `fly.toml`, and the shared room
  depends on that).
- `README.md` is the crit material and changes as the game does; update it in
  the same commit as a change to the rules.
- Prose in this repo follows the house voice: no em-dashes.
