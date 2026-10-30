# Minigame Prestige Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Captain, Fleet and Prestigeception each meaningful from start to e10,000,000 (rising bars, automations
at milestones, leveled Skill Point skills that scale off prestige counts) and give relics a combined 2.5x asymptotic
ceiling toward a secret e25,000,000 prize.

**Architecture:** All rules live in the pure secret-game engine (`src/lib/secret/engine.ts`) driven by data in
`config.ts`; state in `state.ts` (optional fields, safe defaults, one-time conversion marked in the save); the
overlay (`SecretGameOverlay.svelte`) only renders. Pacing is pinned by the existing sim suite (`sim*.test.ts`).
Slices run one at a time on the 0.14.0 branch (they share engine.ts and config.ts).

**Tech Stack:** TypeScript, Svelte 5, break_infinity Decimal, vitest.

**Spec:** `docs/plans/2026-10-27-minigame-prestige-redesign-design.md` (APPROVED 2026-10-27). Decision record:
`docs/plans/2026-10-23-minigame-fast-progress-investigation.md`, from "USER DIRECTION (2026-10-27)" on. Executors read
both before each slice.

## Global Constraints

- Relic-free pacing bands unchanged: first Captain about 45 min, finale e777,777 3 to 5 days, e1,000,000 about a
  month, e10,000,000 about 120 days (average); optimal and casual reported beside them.
- Offline == live; one advance call == chunked == 1 s steps; trusted-clock rules of 0.13.11.1 unchanged.
- Never roll back past the 0.13.11.1 Captain Points conversion (`captainScale: 2` stays).
- The main game never moves (no main-game import of secret game behavior beyond the existing snapshot and save).
- Level caps shown as "X / Y" (approved minigame exception to D23); the relic ceiling is an asymptote (approved
  minigame exception); every other curve concave and uncapped.
- Every name or number not in the spec is [PROPOSAL] / [PROVISIONAL] in ONE named constant.
- Text: no em dashes, no "--" substitutes, US English, the game's humor, SVG glyphs only; the e25M milestone is "???"
  until reached and never hinted.
- Gates per slice: `npx vitest run --maxWorkers=4 --testTimeout=60000`, `npm run check` (0 errors).

## Review Focus

1. A save converted mid-Prestigeception with many Fleets in `fleetCount`: its NEXT Fleet bar is the risen one, so it
   must still be reachable (the card says "Prestigeception first" if it is not). Test in Slice 2.
2. Auto Fleet / Auto Prestigeception with a risen bar: auto prestige must read the same bar as the button and never
   fire below it, in live play and in offline catch-up. Test in Slices 2 and 3.
3. A converted save whose automations are owned but whose milestone is not reached: the automation stays usable and
   its switch state survives. Test in Slice 6.
4. Skill Point cutoff with deeper caps: a save that hit today's "all learned" cutoff earns again, and earning stops
   exactly when every leveled skill is maxed (never a stranded point). Test in Slice 4.
5. Relic snapshot refresh mid-session never moves the plateau backward (counts only rise) and the relic-free game is
   byte-identical to the shipped goldens. Test in Slice 5.

---

### Slice 0: Goldens and the relic timeline study

**Files:**
- Create: `src/lib/secret/redesignGoldens.test.ts`, `src/lib/secret/redesignGoldens.json`
- Create: `docs/plans/2026-10-27-relic-timeline-study.md` (study result)
- Read-only for the study: `src/lib/game/relics.ts`, relic drop paths (expedition, short-range), `sim*` harnesses

**Interfaces:**
- Produces: `redesignGoldens.json` keys `fleetBarLadder`, `pcBarLadder`, `skillState`, `milestoneUnlocks`,
  `pacingRelicFree` (captured from TODAY's engine so every later move is explained).

- [ ] Step 1: Capture today's engine outputs into `redesignGoldens.json` (fleetGain / prestigeceptionGain at bars
  308, 400, 1,000, 10,000 effective exponents; the skill purchase order and times of the steady sim; milestone times;
  the relic-free pacing table). Test `redesignGoldens > capture matches today` passes on the current branch.
- [ ] Step 2: Study: measure from the main game's real rules how long a steady and a heavy player take to reach 1,000
  identified relics per region tier and 10,000 copies of each of the 17 types; write the table to the study doc with
  the method and assumptions. No code change.
- [ ] Step 3: Commit `test(minigame): pre-redesign goldens` and `docs(minigame): relic timeline study`. Report the
  study table to the controller (it goes to the user before Slice 5's tuning).

**Slice 0 carry note (built):**
- `redesignGoldens.test.ts` + `.json`, captured on the unchanged engine (795a2c1): `fleetBarLadder` (rungs n = 0 to 5
  Fleets since the last Prestigeception: bar found by bisection, 308.255273 on every rung today; fleetGain at
  effective peaks 308 / 400 / 1,000 / 10,000 = 0 / 46 / 76 / 271), `pcBarLadder` (m = 0 to 3 lifetime
  Prestigeceptions: bar 10,000 on every rung; gain 11,900 at e10,000), and per player (average, optimal, casual)
  `skillState` (purchase order and second, Skill Points held at the stop: 2 / 0 / 6), `milestoneUnlocks` and
  `pacingRelicFree` (every sim event to e10,000,000; average 4.88 / 32.35 / 119.15 d, optimal 4.46 / 34.47 / 130.06,
  casual 6.86 / 47.84 / 140.65). The sims stop at e10,000,000 (sim.test.ts runs 20 days past it; the events before
  the stop are the same). One file, four tests, about 9 minutes serial (the three sims). Every later slice that moves
  a capture says which and why, then regenerates with GOLDEN_WRITE=1.
- Study: `docs/plans/2026-10-27-relic-timeline-study.md`. Headline for Slice 5: 10,000 copies of every type is about
  88 years raw (18 weighted) for a heavy player, so the ceiling's "about reached at 10,000 of each" needs a user call;
  and no type is tier-gated today (Tier I can reveal every radiant type), against the user's stated intent.

### Slice 1: State fields and config data

**Files:**
- Modify: `src/lib/secret/state.ts`, `src/lib/secret/config.ts`
- Test: `src/lib/secret/state.test.ts`

**Interfaces:**
- Produces in `state.ts`: `captainSinceFleet: number` (Captain Prestiges since the last Fleet or Prestigeception),
  `skillLevels: Partial<Record<LeveledSkillId, number>>`, `automations: Partial<Record<AutomationId, true>>`,
  `skillPointsEarned: number` (lifetime total the schedule has paid), `prestigeV: 1` (conversion marker); all optional
  on load with defaults 0 / {} / {}.
- Produces in `config.ts`: `type AutomationId = "autoOverclock" | "autoBuyLow" | "autoBuyHigh" | "autoCaptain" |
  "autoFleet" | "autoPc"`; `type LeveledSkillId = "headStart" | "tenfoldTraining" | "overdrive" | "captainsAcademy" |
  "fleetLogistics" | "lucidPlanning"`; `LEVELED_SKILLS: readonly LeveledSkillDef[]` with `{ id, name, flavor, effect,
  cap, costBase, costStep, step, scalesOff: "lifetimeFleets" | "captainSinceFleet" | "lifetimePcs" | "fleetCount" }`
  per the spec 3.3 table; `AUTOMATION_UNLOCKS: Readonly<Record<AutomationId, MilestoneId>>` per the spec 3.2 table;
  `FLEET_BAR_RATIO`, `PC_BAR_RATIO`, `SKILL_POINT_SCHEDULE: readonly number[]` (front-loaded, [PROVISIONAL]).

- [ ] Step 1: Test `state > a 0.13.11.2 save loads with the new fields defaulted and round-trips byte-identical`.
- [ ] Step 2: Add the fields and data; the test passes; no engine reads them yet; all existing tests pass.
- [ ] Step 3: Commit `feat(minigame): redesign state and config data`.

**Slice 1 carry note (built, with the 2026-10-28 plan update):**
- State (`state.ts`): `captainSinceFleet`, `skillPointsEarned`, `skillLevels`, `automations`, `automationBuy` are
  plain fields with defaults 0 / 0 / {} / {} / {} in `freshSecretState` and deep copies in `cloneSecret`, so later
  slices read them without `??`. `serializeSecret` writes each one only once it holds something, always last and in
  that fixed order; `prestigeV?: 1` is optional (Slice 6 stamps it). A 0.13.11.2 save and every fresh save serialize
  byte-identically (test with a hand-written 0.13.11.2 fixture). Bad values fall back to defaults, never reject;
  levels are whole and at most the cap; a buy amount is kept only for automations in `AUTOMATION_BUY_DEFAULT`.
  `autoOn` is widened to `SkillId | AutomationId` (switches for the two new automations load too).
- Config (`config.ts`, section "0.14.0 prestige redesign"): `AutomationId` (eight), `AUTOMATION_IDS`,
  `AUTOMATION_NAMES`, `AutomationBuy`, `AUTOMATION_BUY_CHOICES`, `AUTOMATION_BUY_DEFAULT`, `AUTOMATION_UNLOCKS`,
  `LeveledSkillId`, `SkillScaleCount`, `SkillGate`, `LeveledSkillDef` (plus `replaces: { skill, level }`, the level
  that equals today's Head Start / Ten Bonus x2.2 / Overdrive ^1.05: levels 1 / 2 / 2), `LEVELED_SKILLS`,
  `SKILL_GATE_LIFT_PC`, `FLEET_BAR_RATIO`, `PC_BAR_RATIO`, `SKILL_POINT_SCHEDULE` ([3, 3, 2, 2, 1], the last entry
  repeats), `AUTO_SKILLS_PC_COUNT`, `E20M_EXPONENT`, `SECRET_PRIZE_EXPONENT`.
- New milestones live in `PENDING_MILESTONES` with their own `PendingMilestoneId` type, OUT of `MILESTONES` and
  `MilestoneId`, so `reached`, `milestoneVisible`, `checkMilestonesMut`, the runtime and every golden never see them.
  Slice 3 (secondFleet, e10k, pcRegular) and Slice 5 (e20m, e25m) move each def into `MILESTONES` and its id into
  `MilestoneId` (then `AnyMilestoneId` collapses to `MilestoneId`).
- Measured for the skill totals (0.13.11.2 engine, average player): lifetime Fleets 4 / 18 / 47 / 73 and
  Prestigeceptions 1 / 3 / 6 / 8 at days 1 / 2 / 7 / 120. The six skills' caps and costs total 79 points, what the
  schedule pays over 73 Fleets; the rising bars will lower the Fleet count, so Slice 4 re-tunes.

### Slice 2: Rising bars, payouts from the base bar

**Files:**
- Modify: `src/lib/secret/engine.ts` (`fleetGain`, `prestigeceptionGain`, `doFleetMut`, `doPrestigeceptionMut`,
  `doCaptainMut`, `dueAutoPrestige`, `prestigePreview`)
- Test: `src/lib/secret/risingBars.test.ts`

**Interfaces:**
- Produces: `fleetBarExponent(s: SecretState): number` = FLEET_AT x FLEET_BAR_RATIO^fleetCount;
  `pcBarExponent(s: SecretState): number` = PRESTIGECEPTION_AT x PC_BAR_RATIO^pcCount; `nextFleetBarExponent(s)`,
  `nextPcBarExponent(s)`; gains still computed by `gainShape(e, FLEET_AT | PRESTIGECEPTION_AT, k)` (the BASE bar,
  user "Harder pays more"), available only when the effective peak reaches the risen bar.

- [ ] Step 1: Tests: the bar rises with `fleetCount` and resets to 1.8e308 after a Prestigeception; the PC bar rises
  with `pcCount` and never resets; a Fleet cleared at a risen bar pays more Augment Points than one at the base bar;
  `captainSinceFleet` counts Captains and resets at Fleet and Prestigeception; auto Fleet and auto Prestigeception
  never fire below the bar (live and through `catchUp`); Review Focus 1 (a save with a high `fleetCount` shows
  "Prestigeception first" when its Fleet bar exceeds the PC bar).
- [ ] Step 2: Implement; tests pass; `redesignGoldens` moves only `fleetBarLadder` / `pcBarLadder` (explained).
- [ ] Step 3: Commit `feat(minigame): rising Fleet and Prestigeception bars`.

**Slice 2 carry note (built; revised after the review call "Make them bite"):**
- Bar shape (engine `fleetBarExponent` / `pcBarExponent` / `next*`): each bar sits where the climb pays
  FLEET_BAR_RATIO (PC_BAR_RATIO) times the points that layer has already paid and you still hold (Augment Points
  since the last Prestigeception; every Dream Point). So each Fleet must pay what all the Fleets before it in this
  Prestigeception paid together, and each Prestigeception what all before it paid. Empty holdings give the base bar
  (first Fleet after a Prestigeception, first Prestigeception). Payouts still measure from the base bars. The
  button, `prestigePreview`, auto prestige and catch-up all read one bar. No new save field.
- RATIO 1 (both, [PROVISIONAL], reasoning in config.ts): the bar is the very line the 100% automatic target
  already followed, so relic-free pacing is unchanged to the second (average 4.88 / 32.35 / 119.15 d, optimal
  4.46 / 34.47 / 130.06, casual 6.86 / 47.84 / 140.65; the Slice 2 x1.18 count ladder had moved them). Measured
  and rejected: RATIO 1.001 (average e10M 127.6 d), 1.05 (e10M 106.2, optimal e1M 63.7), 1.25 (finale 6.18), a
  bar tracking the last peak x2.1 per payout (e10M 146 d), count ladders (stop biting after the finale).
- Bite (`simBite.test.ts`, average player to e10M, `sim.ts simulateBite`): Fleets from the 3rd of a
  Prestigeception decided by the bar 53/53, fired within 2% of the bar 40/53 (75%); Prestigeceptions from the 2nd
  decided 7/7, at the bar 6/7 (86%). At RATIO 1 the 100% target sits on the bar; it decides only at targets above
  100% (lower targets and manual play are now held to the bar, so the 10 / 25 / 50% choices act like 100%).
- At RATIO 1 the second Fleet of a Prestigeception taken right at 1.8e308 only matches the first, so its bar can
  equal the first; from the third on the bar strictly rises.
- Review Focus 1: a converted save holding many Augment Points shows "Prestigeception first" and the Prestigeception
  clears it; a converted save HOLDING Dream Points with its Fleet blocked does not deadlock: Captain Prestiges keep
  stacking until the climb pays the Prestigeception bar (measured: 1 h, 16 Captain Prestiges), then Fleets resume.
- Relics, re-measured with the SHIPPING catch-up instead of LONG_STRETCH_DT (finale / e1M / e10M, days):
  relic-free 4.88 / 32.35 / 130.34 (the shortcut says 119.15), typical collection 4.17 / 27.87 / 102.08 (shortcut
  101.29). So on the shipping catch-up the typical collection reaches e10M 21.7% sooner, past the Gentle 20%, and
  the relic-free average is at the 130-day edge: the shortcut runs about 11 days fast relic-free but not with
  relics. simRelicsAverage (shortcut on both sides, 15% sooner) keeps its original 0.8 floor; Slice 5 should pin
  the relic bands on the shipping catch-up. The catch-up tolerance and relic stretch bound added at first are
  reverted to their originals (their fixtures no longer move).
- Cards: `prestigeCards.ts` feeds Needs, "Next one" (the Fleet or Prestigeception taken now, or at the bar) and
  "Prestigeception first". Help still says "a fresh climb to e10,000 Ore": Slice 7 rewrites it.
- Goldens: redesignGoldens moves only fleetBarLadder / pcBarLadder (each rung holds what the rungs before it paid);
  the pacing rows are back to the Slice 0 capture. relicGoldens moves only by `captainSinceFleet` in the saves and
  fleetGain / pcGain readouts that now read 0 below the bar. goldens.json is unchanged.
- Slice 1 review: the leveled skill "Fleet Logistics" shows as "Fleet Requisitions" (id unchanged).

### Slice 3: Automations at milestones

**Files:**
- Modify: `src/lib/secret/config.ts` (MILESTONES: the two new automation milestones and the "every skill maxed"
  change, names and flavor [PROPOSAL, approved]), `src/lib/secret/engine.ts` (`hasSkill` / `autoActive` for
  automations read `automations`, granted in `checkMilestonesMut`; `buySkill` no longer sells automations)
- Test: `src/lib/secret/automationMilestones.test.ts`

**Interfaces:**
- Consumes: `AUTOMATION_UNLOCKS`, `automations` (Slice 1).
- Produces: `automationUnlocked(s: SecretState, id: AutomationId): boolean`; the milestone popup's reward line
  "Reward: <automation name> unlocked".

- [ ] Step 1: Tests: reaching each mapped milestone grants exactly its automation (switch defaults on, target default
  100%); offline catch-up grants it at the same step as live; no Skill Point is spent on automations; a granted
  automation fires as today.
- [ ] Step 2: Implement; tests pass.
- [ ] Step 3: Commit `feat(minigame): automations unlock at milestones`.

### Slice 4: Leveled skills and the Skill Point schedule

**Files:**
- Modify: `src/lib/secret/engine.ts` (`doFleetMut` pays `SKILL_POINT_SCHEDULE[fleetTotal]`-style points until
  `skillPointsEarned` reaches the total max cost; `buySkill` becomes `buySkillLevel`; the effects of Head Start, Ten
  Bonus, Overdrive move to levels; the three new skills act on Captain / Augment / Dream Point gains)
- Test: `src/lib/secret/leveledSkills.test.ts`

**Interfaces:**
- Produces: `skillLevel(s, id: LeveledSkillId): number`; `skillLevelCost(s, id): number | null` (null at cap);
  `buySkillLevel(s, id, atMs): SecretState`; `skillScaleFactor(s, id): number` (exactly 1 at a count of 0, concave,
  growing); `totalSkillCost(): number`; `skillPointsRemaining(s): number` (the schedule total minus earned).

- [ ] Step 1: Tests: the schedule's total equals `totalSkillCost()`; earning stops exactly when every skill is maxed
  (Review Focus 4, including a save that hit today's cutoff); `skillScaleFactor` is 1 at count 0 and rises with the
  named count; Head Start level 1 equals today's 1e10 start, Ten Bonus and Overdrive reach today's x2.2 / ^1.05 at
  the level the spec names; each new skill measurably moves its gain.
- [ ] Step 2: Implement; tests pass.
- [ ] Step 3: Re-sim (steady, optimal, casual): relic-free bands hold; the average player's last point lands near the
  time e10,000,000 becomes reliable (report the day); tune only the [PROVISIONAL] constants.
- [ ] Step 4: Commit `feat(minigame): leveled skills and the Skill Point schedule`.

### Slice 5: The relic ceiling and the late milestones

**Files:**
- Modify: `src/lib/secret/relicBoosts.ts`, `src/lib/secret/config.ts` (RELIC_BOOSTS curve constants; milestones
  e20,000,000 and e25,000,000; the e25M reward hook id `starfallVisualization` [PROPOSAL]), `src/lib/secret/engine.ts`
  (post-e10M slowdown stays; relic levers reach the plateau target)
- Test: `src/lib/secret/relicCeiling.test.ts`, the existing relic sims

**Interfaces:**
- Consumes: the Slice 0 study table (the controller confirms the tuning targets with the user first).
- Produces: `relicCeilingFraction(s: SecretState): number` in [0, 1) (combined progress toward the 2.5x limit);
  `plateauExponent` measured by the sim harness (relic-free about 1e7, at 10,000 copies of all 17 types about 2.5e7).

- [ ] Step 1: Tests: relic-free state byte-identical to the shipped goldens; `relicCeilingFraction` is 0 with no
  relics, strictly increasing in every type's count, below 1 always; at 10,000 copies of all 17 types the sim plateau
  is within 2% of 2.5x the relic-free plateau; a typical 0.14.0 collection stays about 15% faster to each goal (the
  approved Gentle band); Review Focus 5; the e25M milestone reads "???" in every view until reached.
- [ ] Step 2: Implement; tests pass; report the plateau table (relic-free, typical, heavy, the limit).
- [ ] Step 3: Commit `feat(minigame): relic ceiling and the e25M secret milestone`.

### Slice 6: Save conversion

**Files:**
- Modify: `src/lib/secret/state.ts` (`deserializeSecret` one-time conversion, marker `prestigeV: 1`)
- Test: `src/lib/secret/prestigeConversion.test.ts`

**Interfaces:**
- Consumes: Slices 1 to 4.
- Produces: `convertPrestigeV1(s: SecretState): SecretState` (pure, idempotent by the marker).

- [ ] Step 1: Tests (fixtures from real 0.13.11.2 shapes): Skill Points recomputed from `fleetTotal` on the new
  schedule with no double pay; owned automations kept with their switches (Review Focus 3); automations granted for
  milestones already reached; owned Head Start / Ten Bonus / Overdrive converted to matching levels with their cost
  counted as spent; a second load changes nothing; the Captain Points conversion marker untouched.
- [ ] Step 2: Implement; tests pass.
- [ ] Step 3: Commit `feat(minigame): one-time prestige redesign conversion`.

### Slice 7: UI, Help and close-out

**Files:**
- Modify: `src/lib/SecretGameOverlay.svelte` (Skills tab leveled rows reusing the Upgrades row style, automation
  toggles shown as milestone unlocks, Prestige cards "Next one needs" and "Prestigeception first", milestone reward
  lines), `src/lib/secret/config.ts` (HELP_SECTIONS and THE FINE PRINT rewritten), docs carry notes
- Test: `src/lib/secret/textRules.test.ts` (extended), overlay display helpers' tests

- [ ] Step 1: Tests: Help numbers read from constants; text rules; locked automations read "???" until their milestone
  is visible; the e25M row hidden.
- [ ] Step 2: Implement; verify at 1280 px and 375 px (headless Chrome, 375 px inside an iframe) with no clipping;
  any layout beyond these rows goes back for a mockup sign-off.
- [ ] Step 3: Full gates; carry note in this plan; curated QA checklist (desktop + mobile) for the user.
- [ ] Step 4: Commit `feat(minigame): prestige redesign UI and Help`.

The e25M visualization itself is NOT in this plan: it needs its own mockup sign-off (spec 3.5).

## Plan update (2026-10-28): the Automation tab and gated skills

The user's 2026-10-28 answers (design doc, "Automation and skills answers", playback confirmed) change Slices 1, 3, 4
and 7. These notes supersede the slice text above where they differ.

- Slice 1 (data): `AutomationId` gains `autoSkills` (auto-skill allocation: spends Skill Points cheapest available level
  first, round-robin; QoL only, never optimal) and `autoUpgrades` (auto-buy for the e1,000,000 Upgrades tab, cheapest
  first, round-robin). Every automation gets a per-automation buy amount setting `automationBuy: Partial<Record<
  AutomationId, "1" | "10" | "max">>` [PROPOSAL default "max" for the generator auto-buys, "1" for skills and upgrades]
  where buying applies. `AUTOMATION_UNLOCKS` covers all eight; the two new ones unlock at later milestones [PROPOSAL:
  autoUpgrades at "Forever, Twice" (e2,000,000), autoSkills at a new Prestigeception-count milestone]. `LeveledSkillDef`
  gains `availableAt: { milestone: MilestoneId } | { prestiges: { layer: "captain" | "fleet" | "pc"; count: number;
  scope: "current" | "lifetime" } }` (each skill, and optionally later level bands, opens alongside an automation
  milestone or at a prestige count) and the constant `SKILL_GATE_LIFT_PC` [PROVISIONAL]: from that many lifetime
  Prestigeceptions on, every skill already unlocked once is available from the start of each climb.
- Slice 3 (automations): build the Automation tab (all automations, each with on/off and its buy amount; locked ones
  read "???" until their milestone is visible); the milestone popup names what unlocked; automations are QoL only (no
  efficiency logic anywhere).
- Slice 4 (skills): skills are bought by hand as today; `skillAvailable(s, id): boolean` reads `availableAt` and
  `SKILL_GATE_LIFT_PC`; a gated skill shows when and how it opens; the sim buys skills in the order they open.
- Slice 7 (UI and Help): the [?] Help explains automations, the Automation tab, the skill gates and the gate lift.
- Naming: never abbreviate Fleet Admiral Prestige to an acronym (other acronyms are fine).
- Separate main-game slice (not part of this plan): rename player-facing "gambit" to "Tactical Protocol(s)" (user
  2026-10-28), code names unchanged.
  CARRY (2026-10-28, done on feat/crew-0.14.0): player text now says "Tactical Protocols" (the Away-Team Tactical
  Protocols heading, Help, log lines, Expedition notes, the editor notice, the 0.14.0 Field Kits QA sheet); code names,
  save fields, registry ids, Debug wiring labels and shipped patch notes keep "gambit".

## Slice 3 status and tuning call (2026-10-28)

Slice 3 engine built as WIP 1aaeb6f on worktree-agent-a067ede01b877445a (NOT merged): the automation logic works, but
15 pacing tests are red (automation timing shifts when Prestigeceptions land; one landing just short of a goal costs
17 to 27 days; 19 placements probed, none held). User: "One retune after Slice 4 (Recommended)": keep Slice 3 unmerged,
build Slice 4 on top of it on the same branch, then ONE combined pacing retune with every new mechanic in place (and
make the curve less touchy around where Prestigeceptions land); merge Slices 3 + 4 together once green.

## Slices 3 + 4 retune result and user calls (2026-10-28)

Branch worktree-agent-a067ede01b877445a: 4e3ae8e (Slice 4) + 0fd0273 (retune WIP). Relic-free average 4.16 / 32.79 /
119.60 d, optimal 4.11 / 32.53 / 118.86, casual 4.28 / 36.63 / 119.53; e10M check-in spread 104.4-166.4 d before,
114.1-126.9 after; last Skill Point day 108.6, 0 spare at e10M. User calls (all Recommended):
- Casual pace: "Accept, re-pin casual" (automation catching casual players up is the QoL point; re-pin the casual bands).
- Auto Prestigeception at "A Respectable Googol": "Mystery popup": the popup reads "Reward: a new automation, for later.
  You'll know it when you see it." and the Automation tab shows it as ??? until the first Prestigeception.
- Skill sizes "OK" (49 points: Head Start 2; Tenfold Training and Overdrive 5, today's effect at level 4; Captain's
  Academy 3, Fleet Requisitions 3, Lucid Planning 2 at +5% each); balanced again in 0.16.0.
FIX ROUND still to do (after the weekly reset): the catch-up parity failures (day2 6 h and 10 h 19 over the bound on a
plateau; mid 48 h 3.5 UNDER live, which breaks "never less") fixed in code, not by loosening; "keen" finale later than
"light" (a player who checks in more must never be slower); then Slice 5 (relic ceiling: typical optimal e1M x1.20 and
casual finale x1.13 out of Gentle; heavy reaches e10M in 24 days).

## Slices 3 + 4 review (2026-10-29): approve with fixes; user call

User: Auto Prestigeception "Granted OFF until revealed (Recommended)": unlocked at A Respectable Googol (the mystery
popup as approved) but switched OFF and hidden; the first Prestigeception is always the player's own choice; after it
the automation reveals itself (still off) and the player turns it on. Existing saves the same (never fires unseen).
Fix list for the next round on the branch (with Slice 5a): the above; apply the instant-fire-at-the-bar rule to Captain
and Fleet too if pacing holds (else document why Prestigeception only) and fix the stepMut header comment and the
unstated coarse-step production cut; a "waiting for Auto-buy I to IV" note on the Auto Captain row; purchaseSeconds
carries the fraction (no Math.round drift on long coarse steps); Help: THREE KINDS OF PRESTIGE (Skill Points by
schedule) and MILESTONES (rewards now unlock automations); reword the goldens.test.ts header; skillPointsRemaining is
fixed by Slice 6.

## Slice 5a retune calls (user, 2026-10-29 evening, verbatim picks)

Context: with Auto Prestigeception granted off until revealed, the first Prestigeception is manual, overshoot past
the bar paid extra Dream Points, and the ladder lost its anchor. The builder's interim retune (branch
worktree-agent-a067ede01b877445a @ ff34005: PC_BAR_RATIO 3, CP_K 0.21, SOFT_SCALE 66, SKILL_SCALE_POW 0.1) kept the
relic-free bands (average 3.62 / 32.95 / 122.98 d) but gave only 4 Prestigeceptions and about 45 of 49 Skill Points
by e10M, Frequent Dreamer near day 80, the gate lift after e10M; a typical Tier I collection sped the climb only x1.01
/ 0.93 / 0.94 (short of Gentle 0.8 to 0.9). Plateau table: relic-free e10.0M, typical e11.0M, heavy e15.9M, full
Tier VII e23.5M, 10k of every type e24.9M, limit e25.0M.

1. Prestigeception payout: "Pay at the bar (Recommended)": a Prestigeception pays its bar's Dream Points no matter
   how far past it the climb went; waiting costs nothing and earns nothing. Then tune the relic levers to Gentle.
2. e10M goals: "All 49 points before e10M (Recommended)": every Skill Point and the gate lift arrive before e10M,
   with at least 4 Prestigeceptions on the way; e20M and e25M are where relics carry you.

## Slice 5a retune result and calls (user, 2026-10-29 night)

Retune 9850b1f (branch worktree-agent-a067ede01b877445a): pay at the bar for Prestigeception only (Captain and Fleet
keep growing payouts, design 3.1); PC_BAR_RATIO 2, CP_K 0.53 x CAPTAIN_BEND, SOFT_SCALE 63, SKILL_SCALE_POW 0.1, Tier
I relic levers x6.5 [PROVISIONAL]. Relic-free average 3.76 / 32.10 / 118.06 d; 5 Prestigeceptions and all 49 Skill
Points (about day 98) before e10M; gate lift about day 90; typical Tier I x0.890 / 0.851 / 0.876 (Gentle).
1. Auto Prestigeception target menu: "Remove it (Recommended)": a plain on/off that fires at the bar; Captain and
   Fleet keep their target menus. (Amends the signed-off automation mockup for that one row; Slice 7 UI.)
2. e10M near day 118 instead of about 123: "118 is fine (Recommended)".
3. Casual finale about 4.8 days (simCasual floor 5 -> 4 days): "Accept ~4.8 days (Recommended)".
4. Old saves that bought the Auto Prestigeception skill: hidden until their own first Prestigeception, then revealed
   ON: "Back ON for buyers (Recommended)". New players get it OFF.
