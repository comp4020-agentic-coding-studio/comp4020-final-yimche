# Crit 9 reflection

## What was the breakthrough that moved the work forward?

The breakthrough was realising that the multi-user decision this crit asks
for was one I had already made, in code, back in crit 8. Because the server
builds a separate view for every player, "what does each person see of the
others" was never a question of transport; it was a rule about the game.
Writing it down as a decision record made me name the options I'd skipped
past, like sending everyone's position and hiding it in the browser, and say
plainly what my choice costs: players pop in at the edge of the beam instead
of fading in, and the flash gives away a second of perfect information every
ten. Seeing the costs written out also made the flash's history make sense.
The walls-only version failed because it answered the wrong question; people
needed to find each other, not the corridors.

## What did this work change about who I want to be as a software developer?

It showed me that a harness drifts when it's copied. This repo's rules came
from crit 7, and the rule to commit as the work goes along had quietly fallen
out on the way, so the agent built three features and left them uncommitted.
Nothing broke, but the record of how the work grew would have been one lump.
I want to treat my rules the way I treat my game rules: when I notice one is
missing, I find where it went and put it back in writing, rather than
re-asking every session and hoping it sticks.
