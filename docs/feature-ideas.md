# Torchlight: feature ideas, scored with RICE

Twenty possible features across the UI, actions, art, game elements,
mechanics and teaching players the rules, scored and sorted. None of them
exist yet: the code has no sound, chat, emotes, gamepad support, tutorial,
bots, settings or replays as of `15b9e45`.

## How they're scored

Score = Reach × Impact × Confidence ÷ Effort.

- **Reach:** players affected per month, out of an assumed 100 active
  players. This is a guess; there's no analytics to ground it.
- **Impact:** 3 massive, 2 high, 1 medium, 0.5 low, 0.25 minimal.
- **Confidence:** how sure the estimates are, as a percentage.
- **Effort:** working days for one person.

## Tier 1: build these first

| # | Feature | Area | R | I | C | E | Score |
|---|---|---|---|---|---|---|---|
| 1 | **Beam turns a colour when it's on a catchable back or side.** It shows the rule that confuses people most ("why didn't that count?") right when it matters. | UI, education | 100 | 2 | 80% | 1.5 | **107** |
| 2 | **Faint safe cone drawn in front of each player you can see.** Players see the 90° no-catch zone instead of guessing it. | UI | 100 | 1 | 80% | 1 | **80** |
| 3 | **Sound:** footsteps louder as people get nearer, a cue before the flash, a sting on a catch. | Elements | 100 | 2 | 80% | 3 | **53** |
| 4 | **Phone vibrates** when a beam lands on you and when you're caught. | UI | 50 | 0.5 | 80% | 0.5 | **40** |
| 5 | **Torch off:** hide your light to sneak, but you can't catch while it's off. | Actions, mechanics | 100 | 2 | 50% | 3 | **33** |

## Tier 2: good value

| # | Feature | Area | R | I | C | E | Score |
|---|---|---|---|---|---|---|---|
| 6 | **Colourblind-safe team colours,** plus a shape marker for each team | Art | 10 | 2 | 80% | 0.5 | **32** |
| 7 | **Tips during your first rounds,** shown when they apply ("lit from the front: you're safe") | Education | 70 | 1 | 80% | 2 | **28** |
| 8 | **Round recap:** who caught whom, and everyone's paths drawn over the maze | UI | 100 | 1 | 80% | 3 | **27** |
| 9 | **Follow cam:** once you're caught, watch through a living player's eyes | UI | 100 | 1 | 50% | 2 | **25** |
| 10 | **Ready-up in the lobby,** with an auto-start once everyone's ready | Actions | 60 | 0.5 | 80% | 1 | **24** |

## Tier 3: worth it later

| # | Feature | Area | R | I | C | E | Score |
|---|---|---|---|---|---|---|---|
| 11 | **Short looping demos in How to play** (catch angle, flash, stun) | Education | 70 | 1 | 80% | 3 | **19** |
| 12 | **Quick emotes and pings** in the lobby | Actions | 80 | 0.5 | 80% | 2 | **16** |
| 13 | **Settings:** flash brightness, reduced shaking, volume | UI, accessibility | 20 | 1 | 80% | 1 | **16** |
| 14 | **Doors** that open and close, blocking line of sight | Elements | 100 | 1 | 50% | 5 | **10** |
| 15 | **Gamepad support** | Actions | 10 | 1 | 80% | 1 | **8** |

## Tier 4: low return for now

| # | Feature | Area | R | I | C | E | Score |
|---|---|---|---|---|---|---|---|
| 16 | **Pick a hat or a colour** for your player | Art | 80 | 0.5 | 50% | 3 | **6.7** |
| 17 | **Tile and wall themes** for each map | Art | 100 | 0.5 | 50% | 4 | **6.3** |
| 18 | **Practice room against bots** | Education, mechanics | 60 | 2 | 50% | 10 | **6** |
| 19 | **Badges** on your record (first catch, ten wins) | Education | 60 | 0.5 | 50% | 3 | **5** |
| 20 | **Mirrors** that bounce beams | Elements | 100 | 1 | 30% | 8 | **3.8** |

## Scores to treat with care

- **#13 matters more than its score.** The flash every ten seconds is a
  full-screen burst of light. A brightness setting is a cheap guard for
  players sensitive to flashing light, so it's worth building early anyway.
- **#9 needs a rules decision first.** A caught player watching a living one
  could tell friends in the same room where people are. The fog of war rule
  covers what the server sends, so decide whether caught players count
  before building it.
- **#5 has low confidence for a reason.** It isn't yet confirmed whether
  rivals can see your beam when you're out of their sight. If they can't,
  turning the torch off adds little.
- **#18 scores low mostly on effort.** Bots that sneak convincingly in a maze
  are about two weeks of work.

## Where to start

#1 reuses the server's catch check, from `shared/world.ts`, on the client to
colour the beam. That keeps the one shared geometry rule from `CLAUDE.md`:
the beam a player sees is still the beam they're judged by.
