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

## 3. User answers (2026-10-14, verbatim where quoted)

- **Timing:** build the reusable affix system NOW in 0.14.0, Reinforcing first, plus hooks for future difficulty tiers.
- **Objectives rename:** ALL player-facing text says "objective" (screens, tooltips, log lines, Help); code names stay.
- **Reinforcing mechanics:** "I agree with 1" (a per-visit chance of an extra battle; every retreat or wipe raises a
  reinforcement level that strengthens the enemy on the D23 curve; progress kept), PLUS:
  - "It's not permanent. Eventually, the alert level of that facility in the objective resets as the "threat appears
    to have retreated", and things return to normal."
  - "affixes can have ranks. So perhaps this will have Reinforcing I while higher versions might be Reinforcing II, which
    will stagger increases over their ranking increases. Perhaps Reinforcing II might increase the chance to 35% instead
    of 25%, and Reinforcing III might bump it to 40, but will also increase the time for Reinforcing to reset by X
    minutes."
  - "This should also scale the objective difficulty rating as well, which should trigger a failsafe for a team so they
    don't keep resetting and failing. If it's deadly, and they fail a few times (on the main team), if the difficulty
    level becomes impossible, then impossible should show (perhaps with a timer that indicates how long before the
    objective returns to normal difficulty levels as that's when Reinforcing disappears)."
  - "Early planets will seldom have this, if at all, unless the roll gets it. This one is a particularly nasty one."
- **Alignment (verbatim):** "Some affixes might be something like Rocky Outcroppings that provide additional cover which
  increases evasion against long-range weaponry by 15% for both sides of combat, or perhaps for one side as a good or
  bad version. So perhaps affixes can roll with different alignments too. So Reinforcing is a negative affix. Always.
  Rocky Outcroppings can be all 3. If it's positive, you get the evasion. If neutral, both get it, if negative, the
  enemy gets it. Some affixes are net positive. Some are net negative. Some can roll into more than one, but only one at
  a time. Some might not have a neutral option. Some might have only positive/negative, and the affix should have a
  color coding that makes this obvious to the player at a glance. So the pill or however we ultimately display them will
  be color coded with green/yellow/red."

## 4. Design summary (coordinator, numbers are PROVISIONAL)

- **Affix definition:** id, name, ranks (I, II, III...), allowed ALIGNMENTS (positive / neutral / negative; an affix
  rolls exactly one), where it applies (combat objectives, any objective, later other systems), tier and difficulty
  gates, roll weight, short tooltip + Help text, and mechanical hooks. Pills are colored by alignment: green positive,
  yellow neutral, red negative. Rolled deterministically on the body's own risk stream, appended draws only (no shift).
- **Reinforcing (always negative):** required on Deadly combat objectives; rolls rarely on easier combat objectives
  and rarely on early tiers. Rank I / II / III: extra-battle chance per visit 25% / 35% / 40% (user); each retreat or
  wipe raises the ALERT level (enemy strength up on the D23 curve and the objective's difficulty rating up); the alert
  DECAYS: it resets after a timer ("the threat appears to have retreated"), longer at higher ranks (base 30 min,
  +X per rank, PROVISIONAL). FAILSAFE: when the alert pushes the objective to Impossible, the team stops retrying it,
  the card shows Impossible with a countdown to the reset, and the team moves on; it returns after the reset.
- **Rocky Outcroppings (positive / neutral / negative):** +15% evasion against LONG-RANGE weapons for you (positive),
  both sides (neutral) or the enemy (negative). Needs a ground weapon RANGE attribute (long vs short) in the gambit
  combat engine (design step).
- **Future difficulty tiers:** affix pools keyed by (tier, difficulty, difficultyTier) with difficultyTier fixed at the
  base tier today; nothing else built.
- **Deterministic, pure:** the alert level is a pure function of stored attempt outcomes and times (offline == live).

## 5. Reinforcing ranks up to X and failure escalation (user, 2026-10-14, verbatim)

"With higher rankings of Reinforcing, it not only increases the chance of battle, higher ranks can increase the number
of possible battles it can roll too. So if we go up as high as Reinforcing X (I think we might, and other affixes won't
have a ton of different levels for balancing reasons), you might get something stupid like 50% chance of 5 additional
battles and if you fail, we have to discuss that particular part. How does it become harder? Additional enemies, and
they gain a heightened senses buff that gives them additional stacking damage until the alert wears off?"

Coordinator proposal (PROVISIONAL, sent to the user to confirm):
- Ranks I to X. Extra-battle chance per visit: I 25%, II 35%, III 40% (user), then rising to X 50% (user's example).
  Maximum extra battles per visit: I-II 1, III-IV 2, V-VI 3, VII-VIII 4, IX-X 5 (X = up to 5, user's example).
- Each retreat or wipe raises the ALERT level until it decays: per level, each fight fields +1 more enemy, and the
  enemies gain a stacking "Heightened Senses" damage buff (per alert level, on the D23 diminishing curve: never capped,
  each stack worth a bit less). Both clear when the alert resets ("the threat appears to have retreated"). This
  replaces section 4's generic "enemy strength up".
- Other affixes keep only a few ranks (user: "for balancing reasons").
