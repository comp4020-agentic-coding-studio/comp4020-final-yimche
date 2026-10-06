# Process overview

## Crit 8: getting it alive

The week's bar was proof of life: a stranger can visit, do the core thing, and
find their trace when they come back. For Torchlight the core thing is a round
of hide and seek with at least one other person, and the trace is your record
on the board.

The work landed in three steps:

1. [`a04cb54`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-yimche/commit/a04cb54)
   set up the stack (below): a Node server, `node:sqlite`, an esbuild bundle
   for the client, and a two-stage Dockerfile.
2. [`735ec24`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-yimche/commit/735ec24)
   is the game: a seeded, braided maze, the shared torch geometry, the
   server-authoritative room, and the canvas client.
3. [`49dd9d4`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-yimche/commit/49dd9d4)
   is the spec I hold the game to, run against the live app by `pnpm check`.

### Directing and grounding the agent

I gave the agent the rules as a player would feel them ("a flash doesn't
catch, a held beam on someone's back does"), then made each rule a test in
`spec/game.test.ts` before trusting it. The tests are named as rules of the
game, so the spec reads as the game's rulebook and a failing test says which
rule broke.

Two rules mattered most for correcting the work:

- **Fog of war is enforced by the server.** It's easy for an agent to hide
  players by not drawing them while still sending their positions. The test
  "never sends a hidden player's position" pins the real requirement.
- **The head-on bump.** Two players meeting face to face could otherwise catch
  each other at once. The stun, held while the light stays on and counting down
  only once it's off, went through several rounds of correction; each case is
  now its own test.

The maze got the same treatment: "no dead ends" and "every room can be
reached" in `spec/maze.test.ts`, plus a movement test for turning into a side
corridor when slightly off-centre, which was the first thing that felt wrong
when actually playing.

## Decision record: the stack

**Context.** A real-time game for a few players in one room, deployed to one
Fly machine with one volume, built by one person in a few weeks.

**Decision.** Plain Node with TypeScript run directly (type stripping), `ws`
for WebSockets, `node:sqlite` for storage, a hand-written canvas client
bundled by esbuild. No framework on either side.

**Why.**

- The game loop is the app. A server-rendered or SPA framework would add
  routing and hydration around a page that is one canvas and a sidebar.
- `node:sqlite` is built in, so there's no native module to compile in the
  Docker image, and one SQLite file on the Fly volume is all the persistence a
  single room needs.
- Sharing `shared/world.ts` between server and client means the beam the
  player sees is exactly the beam the server judges, with no second
  implementation to drift.
- Running TypeScript directly keeps the server build step at zero; only the
  client is bundled.

**Trade-offs accepted.**

- One room, in memory, on one machine. It can't scale out, and a redeploy ends
  the round in progress (records survive, since they're in SQLite). Fine for a
  game among friends.
- `node:sqlite` is still marked experimental in Node 24; the warning is
  silenced in the Dockerfile's `CMD`.
- No framework means writing the static file serving and cookie parsing by
  hand. They're small and covered by the spec.
