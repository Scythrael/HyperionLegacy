# Objective Affixes + "objectives" naming: USER CAPTURE (2026-10-14)

Status: CAPTURE of the user's words (verbatim where quoted) plus coordinator notes. Not yet a design.

## 1. Bigger joint crews (GO-13 call 1)

"Yeah. Let's allow this. It will allow players to be able to get a foothold into harder content if they want. They'd
sacrifice speed from only having one team that can do it, but that's more choice for the player. If they want to go go
go now now now, then they can double-up at a cost of completing those tasks at half the speed because it's one large
team of 4 squads rather than 2 sets of 2 squads each with their own list of things to do."
So: the crew picker also offers LARGER crews than the smallest covering set (e.g. Alpha + Bravo on one hard objective);
the doubled crew pools its squads but works one objective at a time (throughput trade-off). Confirmed reading.

## 2. Affixes (a new reusable system), "Reinforcing" first (GO-13 call 2, verbatim)

"I think that some missions shouldn't allow for this. I propose a change because otherwise, you could effectively just
smash an unprepared team against a wall until the wall breaks. Some missions should wall the player. So I present a new
system that we should honestly make use of elsewhere in the project too. Hopefully this addition shouldn't be too
crazy. Affixes. In this case, a deadly rating should have a default affix applied to it for combat-related missions. An
affix that states "The faction occupying this point is quick to reinforce their teams. This will lead to a random
chance of additional battles to clear out this objective. (I like objectives over tasks honestly). In addition, should
you retreat or fail this mission, the compliment of enemy forces will be reinforced before your next visit." Or
something to that end. Perhaps more concise in the tooltip, but the help menu that will define things (that will still
exist, of course) will better explain that this affix (perhaps the affix could be named "Reinforcing"). Affixes can be
required for specific difficulty ratings, and as things grow harder, you can roll affixes (good and bad) for various
things. An affix that makes an already dangerous task more dangerous (even if it's not of deadly rating, even easier
combat-related options can roll the Reinforcing affix. In addition, there can be new affixes that can roll with higher
tiers and higher difficulties (don't forget that we will have additional difficulty tiers on top of this in the future
as well. How that will work, I don't know. So build anything that might be needed in the future to implement a
difficulty system for this, but we're not focusing on higher difficulty tiers over the actual unlockable tiers (same
thing as the other missions, so this shouldn't be any surprise)."

Coordinator reading:
- A generic AFFIX system (reusable elsewhere in the project): an affix has an id, a name, a short tooltip line, a Help
  entry, good or bad polarity, where it can apply, and its mechanical hooks.
- Deadly COMBAT objectives REQUIRE the "Reinforcing" affix; easier combat objectives can ROLL it too.
- Reinforcing: (a) a random chance of ADDITIONAL battles to clear the objective; (b) after a retreat or a failure, the
  enemy complement is REINFORCED before the next visit. This is what "walls" an unprepared team: brute-force retries get
  harder instead of easier.
- More affixes (good and bad) roll at higher tiers and higher difficulties; names beyond "Reinforcing" are the user's.
- FUTURE DIFFICULTY TIERS (like the other missions' difficulty tiers) layer on top later: build the hooks now (an
  affix pool keyed by tier and difficulty, plus a difficulty-tier input), but do not build the higher difficulty tiers.
- NAMING: the user prefers "OBJECTIVES" over "tasks" (player-facing text).
