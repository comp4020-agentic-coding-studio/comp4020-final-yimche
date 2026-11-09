# Crit 10 reflection

## What was the breakthrough that moved the work forward?

The breakthrough was separating a player from what everyone in the room can see.
Until this point week the cookie held the player id, and that same id
went out to everyone in a room, so anyone reading the wire held what they
needed to be someone else.
In `d3e5d16` the cookie became a session token that only its owner has, and
accounts arrived beside guests: a name alone still plays, but a username and
password make a record that follows you to another device and goes on the board.
Deciding that the board shows accounts only, and that a guest's record is
shown to them alone, answered the crit's question of what each person may see,
and it went into `spec/multiplayer.test.ts` rather than staying a promise.

## What did this work change about who I want to be as a software developer?

It showed me that a rule can be restored and still be too loose. The commit
rule I put back after crit 9 said to commit when a batch of instructions was
done, and the agent followed it exactly: accounts, game modes and the new
record grid landed together in `d3e5d16`, one commit for three features. The
agent hadn't done anything wrong; my wording allowed it. So the fix went into
the rule, not into a reminder to myself. `320d2ed` rewrote it to one commit per
feature, made before the next one starts, staged by hunk when two features
share a file, and the commits from 27 October onwards show it holding. I want
to read an agent's mistake as a question about my instructions first, because
that's the only kind of fix that keeps working once I've stopped watching.
