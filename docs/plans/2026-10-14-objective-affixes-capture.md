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

## Carry from AF-1 (built 2026-10-14, commits `test(0.14.0): pre-affix golden hashes before the change (AF-1 step 1)` and `feat(0.14.0): objective affixes with Reinforcing, larger joint crews (AF-1)`)

- **The flag.** `ExpeditionRiskProfile.difficultyTier?` (riskFactors.ts `BASE_DIFFICULTY_TIER` 1, written by
  `generateRiskProfile`, so every run dispatched from now on, the telescope preview and the forecast all carry it).
  Its PRESENCE makes a run affix-aware (`runDifficultyTier`); a run dispatched before AF-1 has none and stamps,
  plans and resolves exactly as before: `groundOpsAffixes.test.ts` pins five dispatches (Tier I; forced Tier III;
  Tier IV enemy territory on Ground + Ground and on Strike + Survey; a weak crew at Tier VI enemy territory) with
  the flag stripped (new fixture `withoutAffixes`) against hashes captured BEFORE the change (five checkpoints, the
  phase at 2,000,000 s, the claim). The clearing goldens' `withoutClearing` now strips it too (a run before the
  follow-up never had affixes). Legacy, pre-SQ-4, pre-clearing goldens and every existing parity test unchanged.
  No SAVE bump (optional fields).
- **`affixes.ts`** (new, pure; imports model types, combat/rng, diminishing, riskFactors; imported by groundOps.ts
  and groundFight.ts). `AffixDef` = { id, name, **maxRank (per affix)**, alignments, appliesTo
  (`combatObjective` / `calmObjective`), minTier, minDifficulty, requiredFromDifficulty?, rollWeight,
  tooltip(instance), help, hooks }. Hooks are DATA per rank (`extraBattleChanceByRank`, `maxExtraBattlesByRank`,
  `alertResetSecondsByRank`) read through `extraBattleChance` (independent chances combined), `maxExtraBattles`,
  `alertResetSeconds`, `raisesAlert`, so a new affix plugs in by data. Instance (model.ts `ObjectiveAffix`) = { id,
  rank, alignment }. Alignment colors `affixColorClass`: positive green, neutral yellow, negative red; `affixLabel`
  ("Reinforcing III"), `affixPill` (label, color, alignment name, tooltip), `validAffixes` (drops malformed ones).
- **Pools keyed by (region tier, difficulty, difficulty tier)** (`affixPool`): required affixes (Reinforcing from
  Deadly on combat objectives), rollable entries (never a required one), the roll chance
  `AFFIX_ROLL_CHANCE_BY_DIFFICULTY` [0.5%, 1%, 2%, 4%, 6%] x `AFFIX_ROLL_TIER_MULT` (I 0.25 .. VII 2) x
  `difficultyTierRollMult` (the future-tiers hook: base 1, any other tier reads as base; nothing else built),
  `AFFIX_RANK_WEIGHTS_BY_TIER` (Tier I rank I only, II up to II, III up to III, ranks IV+ only from Tier IV and
  rare) and `AFFIX_RANK_CAP_BY_DIFFICULTY` [1, 2, 3, 5, 10] (high ranks need hard objectives), all [PROVISIONAL].
  `AFFIX_MAX_ROLLED` 1.
- **Stamping** (groundOps.ts `initGroundTasks`, risk-aware branch, affix-aware runs only): `difficultyScore` stored
  beside the grade; `affixes` (when any) from `rollObjectiveAffixes` on new salt `AFFIX_ROLL_SALT` 0x6b8d2f4b keyed
  by (body index, the objective's index on its body). Fixed draw layout: whether a rolled affix comes, which one,
  then per catalog affix its rank and alignment (append new affixes at the END of `AFFIX_ORDER`).
- **REINFORCING (always negative; required on Deadly combat objectives; rare otherwise).** `REINFORCING_RANKS`, ONE
  table [PROVISIONAL except the user's I / II / III / X numbers]:

  | Rank | I | II | III | IV | V | VI | VII | VIII | IX | X |
  |---|---|---|---|---|---|---|---|---|---|---|
  | Chance per landing | 25% | 35% | 40% | 42% | 44% | 46% | 47% | 48% | 49% | 50% |
  | Max extra battles | 1 | 1 | 2 | 2 | 3 | 3 | 4 | 4 | 5 | 5 |
  | Alert reset | 30m | 40m | 50m | 1h | 1h 10m | 1h 20m | 1h 30m | 1h 40m | 1h 50m | 2h |

  - **Extra battles per LANDING** (`landOnTask` at a deploy's end): `rollReinforcements` on new salt
    `REINFORCEMENT_SALT` 0x1f4e9a73 keyed by (flat index, the objective's `visits`): draw 1 whether (next() <
    chance), draw 2 how many (1 + nextInt(max), uniform [PROVISIONAL]). They are fought FIRST, back to back where
    the crew landed [PROVISIONAL placement], as REINFORCEMENT fights (`GroundFightRecord.reinforcement`,
    `GroundStepRecord.reinforcement`; the remaining count on `GroundTeamRun.reinforcements`): a win passes no fight
    point (carry damage threads through), a loss is an ordinary loss (loss streak, back of the line, a wipe waits
    for the ship). Then the visit goes on (a fight point at the held progress, else work).
  - **The ALERT** (`ExpeditionActivity.alert` = { level, lastAt }): every LOST fight on the objective (owner, helper
    or a recalled crew alike: the enemy beat a crew off) sets level = (level at that instant) + 1, clock restarted.
    It lapses at lastAt + the rank's reset (`alertLevelAt` is a pure function of the record and the time, so offline
    == live). **Escalation** (replaces the generic "strength up", user section 5): per level each fight fields
    `ESCALATION_ENEMIES_PER_LEVEL` 1 more enemy (copies of the generated guards in order, own ids) and every enemy's
    damage takes **Heightened Senses** = 1 + D23 `diminishing(0.2 x level, knee 1)` (+18%, +34%, +48%, ... never
    capped) [PROVISIONAL] (groundFight.ts `withEscalation`, no draw; the level is read at the fight's START).
    **Deviation:** Heightened Senses is a damage multiplier on the guards, not a battle status, so the battle log
    does not name it. The helper floor reads the escalated odds; the default plan reads fresh odds.
  - **The rating** (`objectiveDifficultyAt`): stored score + `ALERT_DIFFICULTY_PER_LEVEL` 1 per level, graded as at
    stamping; an ALERTED objective at `IMPOSSIBLE_DIFFICULTY_SCORE` 11 or more reads grade 6 "Impossible"
    [PROVISIONAL]: a score 8 Deadly objective after 3 setbacks, score 9 after 2, score 10+ after 1. Never Impossible
    without an alert (a site scored 12 on its own would otherwise wait forever). Rewards and completion weights keep
    reading the STORED grade (no farming the bonus by losing on purpose).
  - **THE FAILSAFE**: an objective whose alert makes it Impossible is HELD (`objectiveHeld`): no crew starts it and
    no helper borrows it, it stays `queued` (not skipped), and the team moves on down its queue (or idles). The UI
    countdown is `objectiveHeldUntil(task, now)` (= `alertResetsAt`). The reset is a WINDOW EVENT (`nextAlertReset`
    over every task, whatever its status, so a stored alert can never outlive its reset; at one instant it goes
    first): the record is cleared, a log line `alertReset` ("Derelict Outpost: the threat appears to have
    retreated", `ALERT_RESET_TEXT`, the user's words) is written for a task still to do, and idle teams pick it up
    again at that instant. The window cannot close while it waits (it is still queued).
  - **Interpretation (for the user):** at the reset the ALERT clears and the objective returns to normal; the
    Reinforcing affix itself stays on it (it is the objective's nature: the per-landing extra battles go on).
  - Stuck predicates are unchanged (`groundTaskStuck` reads the loss streak / sent back): a held objective with 3
    losses in a row also reads Stuck; one held after fewer setbacks reads held, not stuck, and resumes on its own.
- **LARGER JOINT CREWS (user section 1).** New groundOps.ts `groundTaskCrewOptions(exp, taskId)`: the smallest
  covering crews first (`larger: false`, the same lists as `groundTaskCrews`), then every LARGER covering set of
  deployed teams (`larger: true`; e.g. Alpha + Bravo on one hard objective on a Ground + Ground ship), by size, then
  team order. `groundTaskCrews` is unchanged (GO-13's select and Auto-assign still read it), so switching the select
  to the new reader is a UI step. The trade-off (documented at the function): the crew pools every Security squad
  into one fight side and sums every Science squad's fieldwork, but works ONE objective at a time as a joint crew,
  so the ship works fewer objectives at once (better odds on the hard one, a slower run). The edits already accept
  such a crew through `partners`; the plan and Auto-assign never pick one.
- **Not built (per the brief):** Rocky Outcroppings (needs a ground weapon range attribute), the "objectives" text
  rename, any UI (pills, the Impossible countdown, the reinforcement fight in the timeline, the larger crews in the
  select). For the UI: a reinforcement fight's record carries the task's `pointIndex` like any fight, so GO-14's
  "wiped here" pip logic should skip records marked `reinforcement`.
- Tests: new `affixes.test.ts` (15: the catalog and the rank table, colors / labels / pill / text rules,
  validAffixes, pools and the difficulty-tier key, the flag, stamping determinism / Deadly required / calm never /
  rank gates / rarity, the reinforcement roll rates and counts, the alert's raise and lapse, escalation on the D23
  curve, the rating and the failsafe), `groundOpsAffixes.test.ts` (5 pre-AF-1 goldens + 13: stamping on a real
  Tier IV dispatch and the gate, extra battles at a landing and no roll without the hook, withEscalation, the alert
  raise and the escalated retry fight, the threat key, the failsafe end to end (held with a countdown, the calm
  objective done meanwhile, the log line, the retry at the reset), no helper borrows a held objective, parity one
  call == 997 s == 1 s over 3 h with extra battles, an Impossible hold and its reset, a real Tier VI weak-crew
  dispatch big == 997 s, the crew options on Ground + Ground and Strike + Survey, a larger crew end to end);
  salts.test.ts registers affixes.ts. Suite 4606 -> 4639 passed (1 skipped); `npm run check` 0 errors.
- **Observed (20 seeds per tier, a rank 5 Ground + Ground crew):** Deadly objectives (so Reinforcing) are 3% of
  Tier I objectives, 24% at Tier III, 41% at Tier IV enemy territory, 54% at Tier VI enemy territory; rolled
  Reinforcing on easier objectives about 3% at Tier III. Every Tier III+ run finished; two Tier I runs held a Deadly
  objective their crew could not beat and kept retrying after each reset (the existing "retry forever, skip by
  hand" rule).
