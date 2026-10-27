# Torchlight: press release and FAQ

A working-backwards document in the PR/FAQ style: the press release we would
want to publish on launch day, then the questions people would ask about it.
The first fifty FAQs are the ones a business reviewer would ask; the second
fifty are the ones a player would. Every number in here is taken from the
code as it stands (`shared/world.ts`, `server/`), not from a plan.

---

## Press release

**Torchlight turns any group chat into a game of hide and seek in the dark**

*Canberra, November 2026.* Torchlight is a free browser game for a handful of
friends. One of you sends a link, everyone types a name, and within seconds
you're all in a dark maze carrying torches. Everyone is the seeker. Hold your
beam on someone's back or side for under half a second and they're out; light
up their face and they've seen you coming, so it doesn't count. The last one
still in the dark wins.

Most quick party games are either twitch shooters that reward reflexes or turn
based games that stall while someone thinks. Torchlight sits between them. You
can only see what your torch lights and a small circle around you, so the game
is about sneaking round a loop and coming up behind someone. Every ten seconds
the whole maze flashes into view for a moment, and everyone still in shows up
with it, so nobody wanders lost for long and nobody can hide forever. A minute
in, the floor starts falling away from the edges, and a round is over inside
about two minutes.

"I wanted the feeling of playing hide and seek in a dark house as a kid, where
the tension is in the quiet bits," said Julian Mo, who made Torchlight. "The
rule that makes it work is that a catch has to come from behind or the side.
If you see someone coming, you're safe, so you have to keep looking around."

Fairness is built in. The server decides every catch and never sends your
browser the position of anyone you can't see, so reading the network traffic
gives a cheater nothing. The beam drawn on your screen is the same geometry the
server judges you by.

Torchlight has three modes (free for all, teams, and one v one with winner
stays on), six powerups including a decoy that looks exactly like you, and a
map editor whose maps go into a library every host can pick from. It runs on a
phone as well as a laptop. Play as a guest with just a name, or make an
account to put your record on the best seekers board.

*Illustrative reaction we are aiming for, not a real quote:* "We played it
for an hour at lunch. The flash is when everyone screams."

Torchlight is live now. Open the link, give a name, send the room link to your
friends.

---

## Business FAQ

### The opportunity

**1. What is Torchlight, in one sentence?**
A free browser game of hide and seek in a dark maze, for a few friends, where
everyone hunts everyone with a torch.

**2. Who is it for?**
A group of two to eight friends who are already together, in a room or a group
chat, and want something to play right now without installing anything.

**3. Why would that group pick this over what they already play?**
It costs nothing, needs no install or account, and goes from link to playing
in about ten seconds. Most of the alternatives ask for at least one of those.

**4. What problem does it solve?**
The dead time in a group: the five minutes before a meeting, a lunch break, a
call that's winding down. Existing games take longer to set up than the time
available.

**5. Why a dark maze, specifically?**
Not knowing where people are is what makes hide and seek tense. A torch gives
you a limited, directional view, which turns that uncertainty into decisions
you make every second.

**6. What makes it different from other browser party games?**
The catch rule. A catch needs a held beam from behind or the side, never the
front, so the game rewards positioning and patience over reaction speed.

**7. Is the market big enough to matter?**
For this project the goal is a game a group plays again, not scale. The
design deliberately serves small groups well rather than strangers at volume.

**8. Why not matchmake strangers?**
Strangers need moderation, anti-abuse and a population large enough to fill
rooms at all hours. Friends bring their own room and their own trust, so the
game can skip all of that.

**9. What does success look like?**
A group that plays a second session on a different day, and players whose
record on the board keeps growing.

**10. What is the single most important metric?**
Return rate: whether a cookie or account comes back for a second day. The
records in SQLite are what would answer it.

### Product decisions

**11. Why is an account optional?**
Asking for an account loses people before they've seen the game. A name is
enough to play; an account is offered later to whoever wants a place on the
board.

**12. Why do guests not appear on the board?**
A guest name is unverified and can be anything, so a public board of guest
names invites impersonation. Guests still see their own record.

**13. Does a guest lose their record by making an account?**
No. The account takes over the guest's player, so their record comes with
them.

**14. Why a four-letter room code?**
It can be read aloud across a room. The letters I and O are left out because
they read like 1 and 0, leaving 24 letters and about 330,000 codes.

**15. Why does the first person in become host?**
Somebody has to say when to start, and the first in is usually the one who
sent the link. If they leave for good, whoever came in next takes over.

**16. Why three modes and not more?**
Free for all, teams and one v one cover the shapes a small group wants: a
melee, a side to be on, and a ladder when there are too many to all play
well. Each is guarded by its own tests.

**17. Why does a round end in about two minutes?**
The floor starts falling a minute in and finishes a minute later. Short rounds
keep everyone involved and stop a round stalling on two cautious players.

**18. Why the flash every ten seconds?**
Pure darkness made rounds slow: people wandered without meeting. A flash of
walls alone didn't fix it, so it now shows everyone still in, for everyone at
once. The decision is recorded in `docs/decisions/001`.

**19. Why powerups at all?**
They give a losing player a way back and break up stand-offs. Each is a
trade-off with a counter, not a straight win.

**20. How do you stop powerups from being farmed?**
A taken powerup reappears more than five tiles from anyone, and the
replacement is whichever kind is scarcest, so no spot or kind is worth
camping.

**21. Why a map editor?**
Hand-made maps let a group make the game theirs and give returning players
something new, at no cost to us beyond storage.

**22. How do you keep bad maps out of the library?**
The server checks every map before saving it: odd size from 11 to 41, walled
all round, no sealed-off floor, and at least twelve spawn spots. A failing map
is refused with the reason.

**23. Why does the maze scale with the number of players?**
Two players in a big maze never meet; eight in a small one never hide. The
maze gives about fifty rooms per player, between 10 and 20 cells a side.

### Technology and cost

**24. What is it built on?**
A plain Node server written in TypeScript, `ws` for WebSockets, `node:sqlite`
for storage, and a canvas client bundled with esbuild. No framework.

**25. Why no framework?**
The client is one canvas and the server is one process. A framework would add
weight and moving parts without solving a problem the game has.

**26. Where does it run?**
One shared-cpu-1x machine with 256 MB of memory on Fly, in Sydney, with a
volume for the database.

**27. What does it cost to run?**
One small machine and one small volume. There's no separate database server,
CDN or queue to pay for.

**28. Why a single machine?**
Players in a room only meet if they reach the same process. One machine
guarantees that without a coordination layer.

**29. What happens on a restart or redeploy?**
Rooms in play are lost, and players rejoin. Records, accounts and maps live in
SQLite on the volume and survive.

**30. Is losing rooms on restart acceptable?**
Yes, for a game with two-minute rounds. Losing a record would not be, which is
why records go to disk and rooms don't.

**31. How fast does the server update players?**
Twenty times a second per room, each player getting their own view.

**32. How many players can one machine hold?**
It hasn't been load tested at scale. It's sized for several small groups at
once, which is the audience.

**33. How many players fit in one room?**
There's no hard cap in the code. The maze stops growing at 20 cells a side,
which gives eight players their full share of space, so eight is the
comfortable top.

**34. What is the plan if it outgrows one machine?**
Route each room code to a fixed machine so a room still lives in one process.
That's deferred until there is demand for it.

### Fairness, trust and safety

**35. How do you stop cheating?**
The server owns the truth. The browser only sends direction and aim; every
position, catch and result is decided on the server.

**36. Can someone read the network traffic to find hidden players?**
No. A player's view never contains the position of someone they can't see.
The only exception is the flash, which shows everyone to everyone at once.

**37. How do you know that stays true?**
`spec/game.test.ts` has a test that a hidden player's position is never sent,
and it runs against a live server on every check.

**38. Could the client and server disagree about a beam?**
They share one geometry module, `shared/world.ts`, so the beam drawn is the
beam judged. There is no second copy to drift.

**39. How are passwords stored?**
As a salted scrypt hash. The password itself is never kept.

**40. What does the cookie hold?**
A session token, HttpOnly, SameSite=Lax, lasting a year. No tracking cookies.

**41. What personal data do you collect?**
A display name, and for accounts a username and password hash. Game records
are tied to that player. No email, no location, no analytics.

**42. What about offensive names?**
Names are trimmed and limited to 16 printable characters. There's no word
filter; the audience is friends who chose to play together, and guest names
never reach the public board.

**43. What about offensive maps?**
A map is walls and floor on a grid, which limits the damage. Its name and
author are shown in the library. Moderation would be the first addition if the
library were opened to strangers.

### Quality and process

**44. How is quality assured?**
109 tests across five files, run against a live server by `pnpm check`. They
are named as rules a player would say, so a failure says which rule broke.

**45. Why test against a live server?**
The tests check what the game does, not how it's built, so they survive a
rewrite. Running the real server is the honest version of that.

**46. How are new rules added?**
A new rule gets a test before it's trusted. The README, which is the rulebook,
changes in the same commit.

**47. How was it built?**
With an AI coding agent, directed by written rules in `CLAUDE.md` and held to
the tests. `PROCESS.md` records what was asked, what went wrong and what was
corrected.

**48. How does a change reach players?**
A push to `main` deploys to Fly through CI. Pushing is a deliberate step, so
a push is a release.

### Risks

**49. What is the biggest risk?**
That a group plays once and doesn't come back. The board, accounts and map
library are the bets against it.

**50. What would make you stop?**
If groups don't play a second round within a session. That would mean the
core loop isn't fun, and features wouldn't fix it.

---

## Customer FAQ

### Getting in

**51. How do I start playing?**
Open the link, type a name, and press Play. That's all.

**52. Do I need an account?**
No. You play as a guest with just a name. Make an account only if you want to
be on the board or sign in from another device.

**53. Do I need to install anything?**
No. It runs in your browser, on a laptop or a phone.

**54. Does it cost anything?**
No.

**55. How do I play with my friends?**
Make a room and send them its link, which has the room code in it. They land
straight in your room.

**56. Can I join a room someone already made?**
Yes. Open their link, or pick an open room from the list.

**57. What if I join while a round is going?**
You watch that round and play in the next one.

**58. Can several groups play at once?**
Yes. Each room is separate; you never see other rooms' players.

**59. What happens if the host leaves?**
If they leave for good, whoever came in after them becomes host.

**60. What can the host do?**
Pick the mode, pick a map or a fresh maze, and press Start.

### Playing

**61. How do I move?**
WASD or the arrow keys. On a phone, drag on the maze.

**62. How do I aim my torch?**
It points at your mouse, whichever way you walk. On a phone it points where
you walk.

**63. How do I catch someone?**
Keep your beam on them from behind or the side for a moment, under half a
second.

**64. Why didn't my catch count?**
Most likely you lit their face. The quarter in front of someone, 45° either
side of where they look, is safe: they can see you coming. A wall in the way
or a blackout shortening your beam also stops it.

**65. How far does my torch reach?**
About five and a half tiles. You also see a small circle around yourself
without it.

**66. What is the flash?**
Every ten seconds the whole maze lights up for a moment and everyone still in
shows up. Use it to get your bearings; don't be caught in the open when it
comes.

**67. Can a flash catch someone?**
No. Only a held beam catches.

**68. What happens if I walk into someone head-on?**
You both get a short stun: neither can catch the other until the light comes
off and a three-second countdown runs out.

**69. What if we catch each other at the same time?**
Same thing: a stand-off stuns you both, so neither gets a free catch by
turning away.

**70. Why is the floor disappearing?**
A minute in, tiles start falling away from the edges toward one room near
the middle, so a round can't drag on. A tile shakes and glows red just before
it goes.

**71. What happens if I step onto a fallen tile?**
You fall and you're out. Nobody gets a catch for it, but it counts as a fall
on your record.

**72. Is there a warning before the floor falls?**
Yes. A countdown in the corner shows the last ten seconds before it starts.

**73. How long is a round?**
At most about two minutes; the floor has finished falling by then. Most end
sooner.

**74. How do I win?**
Be the last one not caught. In teams, your side wins when the other side is
all caught, and that includes your caught teammates.

**75. What happens after a round?**
Everyone is back in the lobby, wandering the old maze, until the host starts
the next one.

### Modes

**76. What is free for all?**
Everyone against everyone. The last torch standing wins.

**77. How are teams picked?**
At random, into Red and Blue, as evenly as the numbers allow. You wear your
team's colour.

**78. Can I catch a teammate?**
No, and bumping one doesn't stun you.

**79. How does one v one work?**
The first two in line play and everyone else watches. The loser goes to the
back of the line; the winner stays on.

**80. Which mode is best for two people?**
Free for all. The maze is sized so two people keep running into each other.

### Powerups

**81. How do I pick up and use a powerup?**
Walk over one to pick it up. Press Space, or tap the slot at the bottom, to
use it.

**82. Can I carry more than one?**
No. Walking over another swaps it in, and the old one is gone.

**83. What does Speed do?**
About four seconds of running 60% faster.

**84. What does X-ray do?**
For five seconds your torch sees through walls. It shows you where people
are, but only catches someone in the open.

**85. What does Teleport do?**
Drops you somewhere random ahead of where you're facing, four to ten tiles
away. Turn first to steer it. It also breaks any beam on your back.

**86. What does Freeze do?**
Everyone in your beam is stuck for five seconds, unable to move or turn. It
doesn't reach through walls or freeze teammates. With nobody in your beam it
doesn't go off and stays in your slot.

**87. Can a frozen player still catch me?**
Yes. Their beam still catches whoever walks into it, so don't stroll in front
of them.

**88. What does Decoy do?**
Leaves a still copy of you for eight seconds that looks exactly like you to
everyone else. A beam on it does nothing. You see it as a faint ghost with a
dashed ring.

**89. What does Blackout do?**
Every rival's torch reaches only half as far for four seconds, for seeing and
catching. Yours stays full, and teammates are left alone.

**90. How do I know I've been blacked out?**
Your beam visibly shrinks and the game tells you why.

### Records, maps and devices

**91. What does my record track?**
Rounds played, wins, catches, times caught and falls, broken down by mode.

**92. Will my record be there tomorrow?**
Yes. As a guest, a cookie remembers you on the same browser for a year. With
an account, it's there on any device you sign in from.

**93. How do I get on the board?**
Make an account and play. The board shows the top ten accounts by wins, then
catches.

**94. What are the rules for a username and password?**
A username is 3 to 16 letters, digits, dots or underscores, and is also your
name in game. A password is at least six characters.

**95. How do I make my own map?**
Open the map editor from the start screen. Paint walls and floor, or start
from a random maze or any map in the library and change it.

**96. How do I know my map will work?**
A line along the top says whether it's ready or what's in the way. Sealed-off
floor is washed red, and spawn spots are marked with dots.

**97. Who can use my map?**
Anyone. Saved maps go into a shared library, listed under the name you gave,
and any host can pick them.

**98. Does a hand-made map change size for more players?**
No. A picked map is played exactly as drawn, however many turn up. Pick Fresh
maze to get one sized for the room.

**99. Does it work on a phone?**
Yes. Drag to move, tap the slot to use a powerup, and the game fills the
screen.

**100. Is there sound?**
Not yet. The game is silent for now, which suits playing in the same room,
where the screams are supplied by your friends.
