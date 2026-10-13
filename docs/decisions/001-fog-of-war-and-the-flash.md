# 001: What each player sees of everyone else

**Status:** accepted, crit 9. **Decided in:**
[`735ec24`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-yimche/commit/735ec24)
(fog of war),
[`2b0f265`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-yimche/commit/2b0f265)
(a flash of walls only) and
[`295b47a`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-yimche/commit/295b47a)
(a flash that shows everyone).

## Context

Torchlight is real-time: every player's position changes twenty times a
second, and the server could send all of it to everyone. The question is what
each player should actually receive about the others, live.

The whole game rests on not knowing where people are. If you can see everyone,
there's nothing to sneak up on. But a dark maze with no information at all is
just wandering until you bump into someone, and with a few friends in a small
maze that gets slow and frustrating.

The README's idea of good decides between them: **fair, and seen to be fair**
(nobody can cheat by reading the network traffic), and **tense rather than
twitchy** (the game rewards sneaking round a loop over fast reactions).

## Options considered

1. **Send everyone's position to everyone; the browser hides what you can't
   see.** Simplest to build, and the client could draw smooth fog effects.
   But anyone who opens the developer tools sees every player, so the game is
   only fair until someone looks. Fails "fair, and seen to be fair".
2. **Strict fog of war, decided by the server.** Each player is sent only the
   people inside their own torch beam or close enough to make out. Fair, since
   a hidden position never leaves the server. But with no other information,
   finding anyone is luck, and a round with two players can drag.
3. **Fog of war, plus a flash of the walls every 15 seconds.** The first
   version I built (`2b0f265`). It helped people find their way round the
   maze, but not find each other, so rounds still dragged.
4. **Fog of war, plus a flash every 10 seconds that shows everyone still in,
   for a second, timed by the server for all players at once.** What I chose
   (`295b47a`).

## Decision

Option 4. The server decides what each player sees (`viewFor` in
`server/game.ts`): only people in your beam or your small circle of sight,
except during the flash, when everyone still in is sent to everyone. The
server owns the flash's timing, so it happens for every player in the same
tick, and the countdown to the next one is part of each player's view.

## Consequences

What it buys:

- **No cheating through the network.** A hidden player's position is never
  sent, so there is nothing to read. `spec/game.test.ts` checks this
  directly: "never sends a hidden player's position".
- **A rhythm to every round.** The countdown in the corner turns the flash
  into a moment to plan around: get your bearings, pick a target, and don't be
  standing in an open hall when it comes. That is the tension the README asks
  for.
- **The same moment for everyone.** Because the server times it, nobody gets
  the flash a beat earlier than anyone else.

What it costs:

- **Less smoothness.** Other players appear and disappear at the edge of your
  beam instead of fading in, because the client only learns about someone once
  they are visible. The client can't predict or ease a player it was never
  told about.
- **A second of perfect information.** For one second in ten, hiding is
  impossible. Someone who memorises positions during the flash gets a real
  advantage, which leans the game slightly toward attention over sneaking.
- **More work per tick on the server.** It computes a separate view for every
  player, with line-of-sight checks against every other player, twenty times
  a second. That's fine for a room of friends, but it is one reason the game
  stays at one machine and small rooms.
- **Powerups have to respect it.** The x-ray torch widens what the server
  sends you; it can't be done in the browser, which is why it's decided in
  `inBeam` and `canSee` on the server too.

## What would change it

If rounds still feel slow with two players, the next option is shortening the
gap between flashes rather than showing more between them. If the flash makes
hiding feel pointless, the flash could show where people are only as rough
areas instead of exact dots.
