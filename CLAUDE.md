# Harness for this deliverable

The final project (crits 8, 9 and 10, then submission): Torchlight, hide and
seek in a dark maze where everyone is the seeker. A few friends open the link,
give a name, and play rounds in a room the first of them hosts; their record
stays on the board. Built on plain Node (TypeScript run directly), `ws`, `node:sqlite` and a
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
  `/data`, the only storage that survives a redeploy. The in-memory rooms are
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
- **Catches only count from behind or the side** (anywhere outside the 90°
  in front of the target), with a held beam, never a flash. The
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
  holding every room in memory (the app is single-machine by `fly.toml`, and
  players in a room only meet if they reach the same process).
- `README.md` is the crit material and changes as the game does; update it in
  the same commit as a change to the rules.
- **Watch the finished thing run, don't just read it.** Tests prove the rules;
  only playing a round (or screenshotting one) shows whether it reads and
  feels right. Check a visible change in the running app before calling it done.

## House style (no AI tells)

- **No em-dashes, en-dashes, or `--`. Anywhere.** Prose, code comments, commit
  messages, docs, player-facing text, this file. Use a comma, a semicolon, or a
  restructured sentence. (CSS custom properties are code, not prose.)
- **Drop the other AI tells too.** No "not just X, but Y" scaffolding, no
  reflexive "it's worth noting", no hollow superlatives, no throat-clearing
  preambles. Write plainly and let the work carry itself.

## Working agreement

Carried over from crit 5 and assignment 2; it was dropped when this harness
was adapted from crit 7's.

- **Commit when a series of instructions is done.** After completing a request
  (or a batch of them), commit the work before handing back, never leaving
  finished work sitting uncommitted. Prefer small, logical commits with messages
  that say what changed and why; reconstruct the honest build order when several
  landed together. Never commit a red `pnpm check`. This is standing
  authorization to commit.
- **Push is still yours.** Committing is automatic; pushing is a deliberate act
  left to Julian. This repo is already public, and a push to `main` deploys to
  Fly, so a push is a release.
