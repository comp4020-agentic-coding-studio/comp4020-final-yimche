# Torchlight

Hide and seek in a dark maze, where everyone is the seeker. Each player carries
a torch. Hold your beam on someone's back or side for a moment and they're
caught; light up their face and they've seen you coming, so it doesn't count.
The last one still in the dark wins the round.

Give a name, make a room and send its link to friends; the host presses
Start. The full rules are in [How to play](docs/how-to-play.md), and in the
game.

## What "good" means here

This is a game for a handful of friends in one room or group chat, not for
strangers at scale. So good means:

- **Ten seconds from link to playing.** A name and you're in as a guest; a room
  link takes you straight to your friends. An account is there only for
  whoever wants their record on the board.
- **Fair, and seen to be fair.** The server decides every catch and never sends
  your browser the position of anyone you can't see, so reading the network
  traffic gives a cheater nothing. The beam you see drawn is the same geometry
  the server judges you by.
- **Tense rather than twitchy.** A catch needs a held beam from behind or the
  side, never a flash, so the game rewards sneaking round a loop over fast
  reactions.
- **A trace that stays.** Rounds, wins, catches and falls are kept, and the
  board shows the best seekers, so coming back the next day means something.
- **Works on a phone.** Half of any group will open the link on one.

## Which claims are enforced and which are judged

Enforced, by tests in `spec/` run against the live server:

- fog of war: a player's view never holds a hidden player's position, apart
  from the flash every ten seconds and the rival their own freeze stopped
  (`spec/game.test.ts`);
- catches count only from outside the 90° in front of the target, with a held
  beam, and a head-on meeting stuns both instead;
- a name is enough to play, and a returning cookie gets the same player and
  record back (`spec/multiplayer.test.ts`);
- the maze has no dead ends and every room can be reached (`spec/maze.test.ts`).

Judged, by playing rounds with friends: whether it feels tense rather than
twitchy, whether the flash reads at a glance, and whether it works on a phone.

## What shaped it

- The brief's suggestion of games for a few friends, and the small web: one
  page, a handful of rooms, one machine and a SQLite file.
- Classic maze generation (a recursive backtracker), then "braided" so there
  are no dead ends. A dead end is a trap in a game about being hunted; loops
  let you circle round behind someone.
- Grid raycasting (the DDA technique from old first-person engines) for the
  torch beam and line of sight, shared between server and client.

## What I chose not to build

- **No chat.** The players are already together, in a room or a group chat.
- **No matchmaking with strangers.** Rooms are joined by link or code.
- **No guests on the board.** A guest's record is shown only to them, so the
  board can't be filled with throwaway names.
- **No client-side catches.** Smoother, but it makes cheating trivial.

## How it's built

A Node server ticks each room twenty times a second and pushes each player
their own view over a WebSocket; records live in SQLite on a Fly volume. The
reasons are in [PROCESS.md](PROCESS.md), and what each player sees of the
others is decided in
[docs/decisions/001-fog-of-war-and-the-flash.md](docs/decisions/001-fog-of-war-and-the-flash.md).
