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
catch, a beam held on someone's back for a long enough time does"), then made
each rule a test in `spec/game.test.ts` before trusting it.
The tests are named as rules of the game, so the spec reads as the game's
rulebook and a failing test says which rule broke.

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

## Crit 9: all at once

Torchlight was real-time from the start, as we knew what the assignment was from
the beginning. The server ticks every room twenty times a second and pushes each
player their own view over a WebSocket.
So the week's work was the decision one level up, about what each player should
see of everyone else, and then playing more and turning what felt wrong into
rules.

The decision is written up in
[`600abaf`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-yimche/commit/600abaf),
`docs/decisions/001-fog-of-war-and-the-flash.md`: fog of war enforced by the
server, plus a flash every ten seconds that shows everyone still in. It got
there in two steps. The first flash showed walls only
([`2b0f265`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-yimche/commit/2b0f265));
playing it, people could find their way but still not each other, so the
flash was changed to show everyone, with a countdown
([`295b47a`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-yimche/commit/295b47a)).

### Correcting the work

- **The harness had lost a rule.** Halfway through I noticed the agent had
  stopped committing as it went. The rule to commit when a batch of
  instructions is done lived in my crit 5 and assignment 2 files but not here,
  because this harness was adapted from crit 7's. I had the agent find it in
  the older repos and bring it back
  ([`bdeec95`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-yimche/commit/bdeec95)).
- **Powerups went through a redesign of their own.** The first version gave
  each kind its own key and topped up on a timer
  ([`53308d0`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-yimche/commit/53308d0)).
  I changed it to one slot that a new pickup replaces, with powerups spread
  across the maze and moved on every pickup so nobody can farm one spot
  ([`b55175d`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-yimche/commit/b55175d)).
- **The game rules were retuned from playing.** Mazes too big for two players
  to meet were shrunk and opened up
  ([`b2c0ff0`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-yimche/commit/b2c0ff0)),
  and catches now count from the side as well, rather than strictly fgrom behind
  ([`c5818d4`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-yimche/commit/c5818d4)).
  Each change came with a test named as the rule.
- **The look was redone** after I judged the black and yellow page as reading
  like generic AI output
  ([`dacdaa4`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-yimche/commit/dacdaa4)).
  The agent checked it in screenshots of a scripted round, which caught the
  powerup bar showing in the lobby before I saw it.

### Workflow shift
At this point in the semester, I had been utilising the skill 
[`i-have-adhd`](https://github.com/ayghri/i-have-adhd) for basically every
interaction I had with claude, as it made it easier and more concise to read,
removing fluff, and also reduces the token usage.
This would come in key when in this week, I took inspiration from the crit-9
pod meeting where one of the groups designed a full stack developer team of
agents to use for their crit.
Game devs, server dev, client dev, tests writer, docs writers etc etc.
All these agents can be found in the .claude directory.

This did make the process take a lot longer than previously, but it allowed me
to add multiple features at once, and appeared to result in less breakage of the
program when testing. Quality control.

## Crit 10: fly by instruments

The app had to tell people apart, with who may see what checked on the server.
The cookie had held the player id that everyone in the room is sent, so anyone
reading the wire could become someone else.
[`d3e5d16`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-yimche/commit/d3e5d16)
made it a session token only its owner holds, and added accounts beside guests.
The board shows accounts only, and a guest sees their own record alone, both
guarded in `spec/multiplayer.test.ts`.

### Correcting the harness, again

The commit rule I restored in crit 9 said to commit when a batch was done, so
accounts, game modes and the record grid all landed in `d3e5d16`.

My wording allowed it, so I fixed the wording:
[`320d2ed`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-yimche/commit/320d2ed)
makes it one commit per feature, made before the next starts. Everything from
27 October follows it.

## The last fortnight
This fortnight was really just adding features and small fixes here and there.
Also some quality of life things.
The rest was making it good to play in one room: freeze, decoy and blackout
powerups
([`ec88775`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-yimche/commit/ec88775)),
a shared map library
([`8c4415b`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-yimche/commit/8c4415b)),
and a README rewritten as the argument, with every claim given a rule in
`CLAUDE.md`
([`90d48c2`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-yimche/commit/90d48c2)).

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
