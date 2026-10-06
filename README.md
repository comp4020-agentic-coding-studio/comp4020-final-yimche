# Torchlight

Hide and seek in a dark maze, where everyone is the seeker. Each player carries
a torch. Hold your beam on someone's back for a moment and they're caught; light
up their face and they've seen you coming, so it doesn't count. The last one
still in the dark wins the round.

## How to play

1. Open the app and give yourself a name. That's the whole sign-up: a cookie
   remembers you, so your record is still there when you come back.
2. Once two people are in the room, a three-second countdown starts and a fresh
   maze is built for the round.
3. Move with <kbd>WASD</kbd> or the arrow keys, or drag on the maze on a phone.
   Your torch points where you walk, or at the mouse.
4. You can only see what your torch lights, plus a small circle around you.
   Keep your beam on someone's back and they're out.
   Every ten seconds the whole maze flashes into view for a moment, and
   everyone still in shows up with it. A countdown in the corner says when the
   next flash is coming: get your bearings, and don't be caught in the open.
5. Walk into someone head-on and you both get a short stun: neither of you can
   catch the other until the light comes off and the countdown runs out.

Anyone who arrives mid-round watches and joins the next one.

## What "good" means here (first take)

This is a game for a handful of friends in the same room or the same group
chat, not a game for strangers at scale. So good means:

- **Ten seconds from link to playing.** No account, no lobby, no settings. A
  name and you're in.
- **Fair, and seen to be fair.** The server decides every catch and never sends
  your browser the position of anyone you can't see, so nobody can cheat by
  reading the network traffic. The beam you see drawn is the same geometry the
  server judges you by.
- **Tense rather than twitchy.** Catches need a held beam from behind, not a
  flash, so the game rewards sneaking round a loop and coming up behind someone
  over fast reactions.
- **A trace that stays.** Your catches, times caught and wins are kept, and the
  board shows the best seekers, so coming back the next day means something.
- **Works on a phone.** Half of a group of friends will open the link on one.

## What shaped it

- The brief's suggestion of games for a few friends, and the small web: one
  page, one room, no infrastructure beyond a single machine and a SQLite file.
- Classic maze generation (a recursive backtracker), then "braided" so there
  are no dead ends. A maze with dead ends is a trap in a game about being
  hunted; loops let you circle round behind someone.
- Corridors alone made every chase a straight line, so a few open halls are
  knocked through each maze. In a hall you can circle and dodge a beam, but
  there's nowhere to hide while you cross it.
- Grid raycasting (the DDA technique from old first-person engines) for the
  torch beam and line of sight, shared between server and client.

## How it's built

A plain Node server (TypeScript, run directly) holds one shared room and ticks
the game twenty times a second, pushing each player their own view over a
WebSocket. Players, rounds and catches live in SQLite (`node:sqlite`) on a Fly
volume. The browser client is a single canvas bundled with esbuild. The reasons
for each choice are in [PROCESS.md](PROCESS.md).
