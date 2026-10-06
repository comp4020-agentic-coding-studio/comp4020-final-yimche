# Crit 8 reflection

## What was the breakthrough that moved the work forward?

The breakthrough was deciding that the server owns the truth and the client only
draws it. Early on it was tempting to let each browser work out what it could
see and who it had caught, since that's where the canvas and the mouse are. Once
I moved every catch onto the server and put the beam geometry in one shared
file, a whole class of problems disappeared: there was no way for two players to
disagree about a catch, and fog of war became something I could test ("never
sends a hidden player's position") rather than something I hoped the client
respected. After that, most of the remaining work was tuning rules, not
untangling state.

## What did this work change about who I want to be as a software developer?

It changed how I want to work with an agent. The agent could write a raycaster
or a maze generator faster than I could, but it had no idea what felt fair to a
player. What kept the work on track was writing each rule down as a test named
the way a player would say it, then playing the game and turning every "that
felt wrong" into another test. I want to be the developer who owns the rules
and the judgement of what good feels like, and treats the code, mine or the
agent's, as something those rules check.
