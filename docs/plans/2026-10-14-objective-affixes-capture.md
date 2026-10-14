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

## 6. AF-1 calls (user, 2026-10-14)

- Reinforcing's extra battles strike MID-WORK, like ambushes (at random points along the progress bar), not on landing.
- The number of extra battles is WEIGHTED TOWARD FEWER (1 most likely, the rank's max rarest). User: "Ultimately,
  Reinforcing X won't likely be seen often by anything outside of safety interlock max difficulty." (So the top ranks
  belong mainly to the future difficulty / safety-interlock tiers.)
- Impossible after 3 setbacks on a score-8 Deadly objective: KEEP as built.

## Carry from the AF-1 follow-up (built 2026-10-14, commit `feat(0.14.0): reinforcements strike mid-work, weighted counts (AF-1 follow-up)`; section 6 calls + review minors)

- **MID-WORK STRIKES (user, section 6), replacing the landing placement above.** A visit (a crew's landing on a
  Reinforcing objective) still rolls once, on `REINFORCEMENT_SALT` keyed by (flat index, `visits`), but
  `rollReinforcements` now returns the STRIKE POINTS: ascending fractions in (0, 1) of the progress still ahead,
  which `landOnTask` maps onto the bar (`GroundTeamRun.reinforcementsAt`, progress points, on the lead; replaces the
  count field `reinforcements`). Nothing is fought at landing. `startWork` cuts a work step where the next strike lies
  before its target (whole second 1 to secs - 1 of the step; a step under 2 s runs whole and the strike lands at its
  end; `GroundTeamRun.reinforcing`, like `ambushed`), and `finishWork` meets it as a REINFORCEMENT fight where the
  work stopped (progress kept, nothing banked, the task's ordinary keyed fight stream, the alert's escalation). A win
  passes no fight point and the work goes on from that spot (later strikes cut later steps); a loss is an ordinary
  loss and drops the visit's remaining strikes (so do a GO-7d stop and idle). Calm objectives never carry
  Reinforcing, so a strike never meets an ambush.
- **WEIGHTED TOWARD FEWER (user, section 6).** One named table, `REINFORCEMENT_COUNT_WEIGHTS` = [50, 25, 13, 8, 4]
  for 1 to 5 battles, cut at the rank's maximum [PROVISIONAL]: with a maximum of 2, one battle about 2 / 3 of the
  time; with 5, one battle half the time and 5 battles 4%.
- **Draw layout (integer draws, the GO-8 review contract; review minor).** Both rolls draw integers only:
  `AFFIX_DRAW_UNITS` 1,000,000 with `affixChanceUnits` (rounded) for chances, and ONE `nextInt(weights total)` per
  weighted pick. Stamping: draw 1 whether, draw 2 which, then per catalog affix its rank and its alignment. A visit:
  draw 1 whether, draw 2 how many, then the rank's maximum strike-point draws, always made (the first `count` used).
- **High ranks very rare at the base difficulty tier (user, section 6: "Ultimately, Reinforcing X won't likely be
  seen often by anything outside of safety interlock max difficulty").** The top ranks belong mainly to the FUTURE
  max-difficulty / safety-interlock tiers. `AFFIX_RANK_WEIGHTS_BY_TIER` retuned [PROVISIONAL]: III [70, 22, 8], IV
  [55, 28, 12, 4, 1], V [45, 28, 15, 7, 3, 1, 1], VI [38, 27, 17, 9, 5, 2, 1, 1], VII [30, 24, 18, 11, 7, 4, 3, 1, 1,
  1]; ranks IX and X appear only at Tier VII, 1% each. A future difficulty tier would carry its own rank weights.
- **Impossible after 3 setbacks on a score-8 Deadly objective (user, section 6): KEPT as built.**
- **Review minors.** `withEscalation` scales BOTH an enemy's damage and its threat by the Heightened Senses
  multiplier (it no longer overwrites threat). New save test: a JSON save mid-alert (serialize, deserialize,
  migrate), found on a weak crew on a Reinforcing X objective at the first instant a work step runs with a strike
  pending on the lead, the objective on alert and an earlier reset in the log, reloads equal and resolves equal to
  the uninterrupted run (affixes, visits, difficultyScore, the alert, reinforcementsAt and the alertReset log line
  all ride the save).
- **For the UI step (GO-14 timeline, not built here):** `heldLoss` (the "wiped here, resumes here" pip and the held
  line) must SKIP fight records marked `reinforcement` (a reinforcement fight carries the task's `pointIndex` like a
  point fight but strikes between points), and the lanes should label reinforcement fights ("Reinforcements") the
  way they label surprise fights.
- Tests: affixes.test.ts 15 -> 16 (the visit roll returns strike points, rates and counts; the weighted count; the
  base-tier rank rarity), groundOpsAffixes.test.ts 18 -> 20 (the mid-work strikes end to end, a strike landing at
  its point, the save mid-alert; the parity run now meets an early strike). Every golden (legacy, pre-SQ-4,
  pre-clearing, pre-AF-1) and every parity test unchanged.

## Carry from AF-2 (built 2026-10-14, commits `test(0.14.0): pre-AF-2 golden hashes before the change (AF-2 step 1)` and `feat(0.14.0): ground weapon range + Rocky Outcroppings affix (AF-2)`; engine only)

- **Ground weapon RANGE (gambit.ts `GroundRange` "long" / "short"; data only on its own).** Member weapons read the
  catalog's existing `MemberVarietyTraits.weaponRange` (model.ts, E-CREW Task 7): Pulse Rifle long; Scattergun,
  Shock Baton (melee) and Sidearm short. `memberWeaponRange(snapshot member)` = the first worn Away-Team Weapon's
  range, else `UNARMED_RANGE` short. Implants (the Targeting Optic) and tools never set it (aim is not reach).
  Enemy attacks by role, `ENEMY_ROLE_RANGE` [PROVISIONAL]: Striker, Caster, Healer long; Bruiser, Swarm short.
  `attackRange(c)` reads a stamped `GroundCombatant.range`, else the enemy role's, else unarmed. Nothing reads the
  range unless a target has `GroundCombatant.longRangeEvasion` (`strikeHitChance`: a LONG-range strike's hit chance
  x (1 - evasion), on the SAME single hit-check draw), so a fight without cover is the fight as before (test: a
  fully stamped fight with no evasion equals an unstamped one).
- **ROCKY OUTCROPPINGS** (affixes.ts `rockyOutcroppings`; positive / neutral / negative, nextInt(3) uniform;
  combat objectives only; never required; minTier I, minDifficulty Simple; roll weight
  `ROCKY_OUTCROPPINGS_ROLL_WEIGHT` 100 = Reinforcing's) [PROVISIONAL]. Ranks I / II / III =
  `ROCKY_OUTCROPPINGS_EVASION` 15% (user) / 18% / 21% evasion against LONG-RANGE attacks, ranks gated by the
  existing `AFFIX_RANK_WEIGHTS_BY_TIER` and caps (Tier I rank I only). Hook `longRangeEvasionByRank`, read by
  `longRangeCover(affixes)` = { team, enemy }: positive covers the squad, neutral both sides, negative the guard;
  several instances combine as independent chances (never capped, D23). Tooltip by alignment ("Rocky cover favors
  your squad: it evades 15% of the enemy's long-range attacks." / "...favors the enemy..." / "...on both sides...")
  and a Help entry that points at short-range weapons as the answer to a negative roll.
- **In the fights** (groundFight.ts `withCover`, no draw): when either side has cover, every combatant is stamped
  with its range (members from their frozen snapshot's weapon) and each covered side with its evasion. Threaded as a
  trailing `cover` argument through `resolveTaskFight` / `resolveTaskFightOnSeed` and the threat reads
  (`groundThreatSampleFights`, `groundTaskClearOdds`, `groundTaskThreat`); the THREAT MEMO KEY appends
  ["cover", team, enemy] only when cover is present, so every other key is unchanged. groundOps.ts `taskCover(task)`
  (exported; undefined without cover) feeds every fight (point, surprise, reinforcement) and every odds read (crew
  odds, the default plan's fresh odds, the helper floor).
- **THE GATE: the affix CATALOG version.** Adding an affix changes the stamping layout for unstamped objectives (the
  "which" pick's weights and the per-affix rank / alignment draws), so `ExpeditionRiskProfile.affixCatalog?`
  (riskFactors.ts `AFFIX_CATALOG_VERSION` 2, written by `generateRiskProfile`) records the run's catalog;
  `runAffixCatalog` reads an absent one as `AF1_AFFIX_CATALOG` 1. Every `AffixDef` carries the `catalog` that
  introduced it (Reinforcing 1, Rocky Outcroppings 2); `affixPool(..., catalog)` and `rollObjectiveAffixes({ catalog })`
  use only that catalog's affixes (`catalogAffixes`), so an affix-aware run dispatched between AF-1 and AF-2 stamps
  on AF-1's exact layout. Proven by six goldens captured BEFORE the engine edit (`groundOpsOutcroppings.test.ts`:
  Tier I; Tier III; Tier IV enemy territory on Ground + Ground and on Strike + Survey; a weak crew at Tier VI; Tier
  VII enemy territory; fixture `withoutAffixCatalog`). `withoutAffixes` strips the version too. A future affix: add
  it with the next catalog number and bump `AFFIX_CATALOG_VERSION`. No SAVE bump (optional field).
- **AF-1 re-review edge fix (groundOps.ts startWork / finishWork).** A reinforcement strike in a work step under 2 s
  runs the step WHOLE (to the target exactly) and lands at its end: `finishWork` now BANKS the finished segment
  first (new `bankSegment`), then starts the reinforcement fight, so the working crew gets the credit (before: the
  segment went unbanked; a lost fight at a point left it unbanked for good, and at 100% the next crew's zero-length
  step banked it). `bankSegment` keeps a segment's FIRST bankers when it is already banked (so the crew that later
  finishes the zero-length remainder does not take the credit); no earlier flow banked a segment twice with another
  crew, and every golden is unchanged.
- **Observed rates (from the pool math, base difficulty tier):** a rolled affix is `AFFIX_ROLL_CHANCE_BY_DIFFICULTY`
  x the tier multiplier; on an easier combat objective it is Reinforcing or Rocky Outcroppings half and half, on a
  Deadly one (Reinforcing required) the rolled slot is Rocky Outcroppings alone. So Rocky Outcroppings is RARE: about
  0.06% of Simple Tier I combat objectives, 2% of Hard Tier III ones, 12% of Deadly Tier VII ones. Side effect: on
  new runs a ROLLED Reinforcing on an easier objective is half as common as at AF-1 (they share the one rolled slot).
- **For the UI step (not built here):** the pill colors and tooltips come from `affixPill` as for Reinforcing; the
  Help text is `AFFIX_DEFS.rockyOutcroppings.help`; a member card could show its weapon range via
  `memberWeaponRange`.
- **For the user's PROVISIONAL list (AF-2):** (a) the 15% evasion is MULTIPLICATIVE as built (a long-range hit
  chance x 0.85, not minus 15 points); (b) the enemy range table (Striker, Caster, Healer long; Bruiser, Swarm
  short); (c) Rocky Outcroppings ranks II / III at 18% / 21%; (d) on a Deadly combat objective Reinforcing is
  REQUIRED, so Rocky Outcroppings is the only ROLLABLE entry there and every rolled hit is Outcroppings (on easier
  combat objectives the one shared slot splits half and half between the two).
- **Questions for the user:** (1) "+15% evasion" is read as MULTIPLICATIVE (a long-range hit chance x 0.85), not
  minus 15 points; (2) the ENEMY_ROLE_RANGE classification (Healers and Casters long); (3) ranks II / III at 18% /
  21%; (4) should Rocky Outcroppings (terrain) roll more often than the shared rare slot allows, for example its
  own independent roll in a later catalog?
- Tests: new `groundOpsOutcroppings.test.ts` (6 pre-AF-2 goldens + 18: the range classification, the range alone
  changes nothing, strikeHitChance, cover vs short / long attackers, the definition and the catalog, the cover by
  alignment, the pill, the stamping roll (alignments, tier gate, catalog 1 never rolls it), Reinforcing's draws kept,
  the profile's version and a real Tier VII dispatch stamping from each catalog, withCover, the right side per
  alignment in a task fight, odds positive > none > negative and the memo key, an engine run with and without the
  cover, parity one call == 997 s == 1 s with negative cover + Reinforcing (a reinforcement and a loss in the
  window), the edge fix); affixes.test.ts updated for the second affix (catalog 1 keeps AF-1's expectations). Every
  golden (legacy, pre-SQ-4, pre-clearing, pre-AF-1, pre-AF-2) and every parity test unchanged.

## Carry from the UI step (built 2026-10-14, commit `feat(0.14.0): objectives naming, affix pills, larger crew picker (UI)`)

- **Objectives rename (user, section 3).** Every player-facing string of the UI layer about ground work now says
  "objective": the queue screen ("Ground operations · objective queues", the "Objective" column, "9 objectives
  discovered", the region names, the button tooltips, the empty / stuck hints, the result lines), the progress cards
  ("Objective progress · N of M done", "No objective started yet", "Done: no fights on this objective", "Skipped
  partway: progress kept at 6%"), the timelines ("Idle: about to take its next objective", "the objective" fallback),
  the dispatch console ("Fights during objectives", "Does the objective fieldwork", "Leaves 2 objectives unfinished.",
  "the objective demand appear at detail 3"), the squad words (awayTeamDisplay.ts, groundTeamDisplay.ts intro), the
  edit log lines (groundTaskQueueDisplay.ts groundOpsEditLogText) and App.svelte's "will stay on its own objectives."
  log line, legacy runs' "Lost objectives evacuate", Help (relics). Code names, save fields and test names stay.
  **Still "task" (engine files, not edited here; to route):** groundOps.ts `groundOpsEditBlockText` (the nine refusal reasons,
  shown in the queue's "Not changed: <reason>." line and App's "[Ship] Cannot change the ground plan: <reason>." log)
  and `groundOpsLogText`'s "A task" fallback; expedition.ts the "A task" label fallback (about line 905);
  launchRecommendation.ts `taskLabel` "A task", `taskDemandText` ("N tasks need 2 Security squads", the telescope's
  detail 3 demand line), `demandLine` ("No ground tasks expected.", "N tasks need ...", "N of M tasks need no Security
  squad"), `reasonOver` ("Covers N tasks ...", "One team can take N of M tasks alone"), `recommendLaunch`
  ("would leave N tasks unfinished", "Nothing on this hull covers every task") and `forecastTasksText` ("11 tasks:
  ...", "No ground tasks expected", the forecast line).
- **Affix pills (user, section 3: green / yellow / red).** New `src/lib/objectiveAffixDisplay.ts` (+ test, 10): one pill
  per well-formed affix (`affixPillView` over affixes.ts `affixPill`): the rank in the label ("Reinforcing III"),
  the alignment color AND its word written on the pill ("NEGATIVE | Reinforcing III"), so color is never the only
  signal; the affix's short line as the tooltip; the accessible name carries the whole readout. New
  `src/lib/ui/AffixPill.svelte` (HelpTip chip mode: hover, tap, keyboard focus; theme tokens `--color-success` /
  `--color-warning` / `--color-danger`, so the colorblind palette follows) and `src/lib/ObjectiveAffixes.svelte` (the
  pills + the alert block), on every queue row's card (GroundTaskQueue) and every progress card (GroundTaskCard).
  Rocky Outcroppings (AF-2) needed nothing: its pills read "POSITIVE / NEUTRAL / NEGATIVE Rocky Outcroppings II"
  with its own tooltip.
- **The alert and the Impossible countdown.** While an objective is on alert: "On alert (level 2)", "2 more enemies
  per fight, Heightened Senses x2 (+34% enemy damage). Rating raised to Deadly.", "The alert clears in 36m 12s".
  While HELD (objectiveHeldUntil): "Impossible: resets in 38m 43s" (whole seconds under an hour, "1h 3m" above;
  recomputed every tick, so it counts down), "1 more enemy per fight, Heightened Senses x1 (+18% enemy damage).",
  then what the failsafe does in the user's words ("Your teams move on and come back when the alert resets: the
  threat appears to have retreated, and the objective returns to normal difficulty."), in the Impossible tier's
  crimson (`IMPOSSIBLE_HEX`, read from the threat ramp) with the same STATIC glow as the Impossible chip (user
  2026-10-14; no animation). Done and skipped objectives keep their pills, never an alert. The "you're going to
  die" quote is intent only and appears nowhere.
- **Telescope.** The forecast's hardest fight shows the Reinforcing pill (name only: the rank rolls at the scan)
  when it is a Deadly combat objective (`forecastAffixPills`; Reinforcing is required there), tooltip "Deadly combat
  objectives always carry Reinforcing; its rank rolls when the body's scan finishes." (Unit-tested; not seen in the
  preview: no detail 5 candidate in the seeded save.)
- **Larger crews in the picker (user, section 1).** `crewOptions` reads `groundTaskCrewOptions`: the smallest crews
  first, then every larger covering crew, "Alpha + Bravo (doubled)" ("larger crew" when not twice the smallest).
  The select's words stay short (a long option widened the Assigned column and squeezed the cards); under the select,
  while a larger crew is picked or set, its trade-off: "Doubled crew: more punch and more fieldwork, one objective at
  a time." (`largerCrewNote`: "more punch" when it brings Security past the needs, "more fieldwork" for Science, the
  cost always). Apply sends `assign` with `partners` (engine-accepted, tested); the card then shows the larger
  crew's own tier ("Joint crew odds"). The result line names the crew only ("assigned to Alpha + Bravo.").
- **GO-14 polish.** (1) `heldLoss` skips fight records marked `reinforcement` (and `fightingNow` ignores a pending
  reinforcement fight), so a lost reinforcement fight never reads "wiped here" at the next point; a lost POINT fight
  after a won reinforcement still holds the bar. (2) Lanes label reinforcement fights like surprise fights:
  "reinforcements" (live), "reinforcements, won / lost / wiped", detail "Reinforcements at Crashed Ship: won (24s)";
  the card notes "Beat back reinforcements once", "Lost a fight to reinforcements". (3) The axis already defaults to
  "Recent" (every width; verified at 375 px after a reload). (4) The bay card's longest row reads its time left while
  the team is in the bay: "20m (19m 32s left)" (not before the bay starts). (5) The mobile "crop": the preview capture
  showed the bottom nav mid-screen with empty space under it. Cause found: a test-side `scrollIntoView` scrolled the
  app's `overflow: hidden` `.frame` (182 px), not a layout bug; with the frame at 0 and the real scroller
  (`.tab-scroll-area`) scrolled instead, 375 px captures are whole. Keyboard `focus()` inside the panel does not move
  the frame.
- **Help.** Two new topics: `affixes` ("Objective Affixes": pills, green / yellow / red alignments written on, ranks,
  required vs rolled, set at the scan, the telescope pill) and `reinforcing` ("Reinforcing (affix)": affixes.ts
  `AFFIX_DEFS.reinforcing.help`, plus what the card shows on alert and the held countdown). helpTopics.test.ts pins
  both and that no topic says "task(s)", em dashes or double hyphens.
- Verified in the dev preview (seeded saves built in the page from the engine: a Ground + Ground crew at rank 3 on
  a forced Tier VI and a Tier IV enemy-territory run, advanced to an Impossible hold): pills (red, green, yellow),
  tooltips by hover and keyboard, the countdown ticking (1h 3m -> 1h 2m; 38m 43s -> 34m 32s), the doubled crew
  applied by keyboard (select, Tab, Enter; Worthy solo vs Guaranteed doubled), reinforcement fights on the lanes,
  the held progress card, the bay's time left, Help on a phone; 1280 px and 375 px (page width 375, no sideways
  scroll); no text on the expedition screen says "task"; no new console errors. localStorage restored
  byte-identical (SHA-256). Screenshots in the session scratchpad `ui-affix/`.

## 7. Affix roll slots (user, 2026-10-14)

"For now, 1 works. But we may end up having different chances of rolling different affixes for different
difficulties, planet types, tiers, etc. So we want to keep this in mind." So: keep ONE shared rolled-affix slot per
objective for now; the affix roll weights must be able to vary by difficulty, planet type, tier (and later difficulty
tier) without a redesign (per-context weight hooks).

## Carry from the AF-2 follow-up (built 2026-10-14, commit `chore(0.14.0): engine player-facing text says objective; context affix weights (AF-2 follow-up)`)

- **Engine text says "objective" (user, section 3; the UI step's routed list).** groundOps.ts
  `groundOpsEditBlockText`: "This expedition launched before Ground Operations: its objectives run on their own",
  "No such objective", "That objective is already done", "That objective was skipped: re-queue it first", "Only a
  skipped objective can be re-queued", "No queued objectives on that body to plan", "That objective is not in this
  team's queue", "Nobody deployed brings the squads this objective needs", "That crew does not bring the squads this
  objective needs: add a partner team"; `groundOpsLogText`'s fallback name "An objective"; expedition.ts the
  forecast's hardest-objective label fallback "An objective"; launchRecommendation.ts `taskLabel` "An objective",
  `taskDemandText` / `demandLine` ("N objectives need 2 Security squads", "No ground objectives expected.", "3 of 4
  objectives need no Security squad", "N objectives need 2 Science squads"), `reasonOver` ("Covers N objectives your
  ... would leave unfinished.", "One team can take N of M objectives alone"), `recommendLaunch` ("would leave N
  objectives unfinished", "Nothing on this hull covers every objective") and `forecastTasksText` ("11 objectives:
  ...", "No ground objectives expected"). A grep of src/lib/game found no other player-facing "task" string.
  Identifiers, save fields and test names unchanged; expectations updated in launchRecommendation.test.ts,
  launchPreview.test.ts and expeditionDispatchDisplay.test.ts (test expectations only). The doc comment example in
  expeditionDispatchDisplay.ts (`tasksText: "11 tasks: ..."`) is a display-helper file and was left for the UI owner.
- **Per-context affix weights (user, section 7).** ONE shared rolled slot kept. New `AffixDef.weightFor?(context)`
  with `AffixRollContext` = { tier, difficulty, difficultyTier, planetType?, target }; `affixRollWeight(def,
  context)` reads the hook, else the flat `rollWeight` (non-positive or non-finite reads 0: the affix does not roll
  there). `affixPool` takes an optional `planetType` and `rollObjectiveAffixes` an optional `planetType` (groundOps.ts
  passes the body's). No affix defines the hook today, so every pool and every catalog rolls byte-identically (every
  golden unchanged). A future difficulty tier or planet-specific affix plugs in by data on the hook.
- Tests: groundOpsOutcroppings.test.ts 24 -> 27 (the weight reader, the hook in the pool and the stamping roll with
  the planet type, the engine text never says task). Suite 4686 passed (1 skipped); `npm run check` 0 errors.
