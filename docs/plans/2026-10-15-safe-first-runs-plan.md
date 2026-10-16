# Safe first runs and the difficulty curve (0.14.0): PLAN

> **For Claude:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. One fresh implementer per slice, then
> the two-stage review (spec, then quality), re-review after fixes. Never push the branch; dev deploys are the
> controller's call (`git push origin feat/crew-0.14.0:staging`). Staging waits for this fix AND the wiring check
> (capture section 4, S15).

Status: PLAN, written 2026-10-15 against `feat/crew-0.14.0` @ `6b2b20c`. Nothing here is built. Every name, number or
text marked **[PROPOSAL]** is mine and is the user's to accept, rename or reject; **[PROVISIONAL]** marks a first-pass
number a slice needs to stay green while its open call waits (each lives in ONE named constant). Section 5 lists the
calls; a slice that depends on one says which.

**Goal:** the very first expedition cannot be lost; the first run of every mission type is a safe, educational run;
after it, difficulty creeps in on a gentle curve; and the Tier I vault-site stall (Ground Ops BALANCE FINDING) is gone
for every run after the first.

## 1. The user's words (verbatim; authoritative)

From `docs/plans/2026-10-15-wiring-audit-and-safe-first-runs-capture.md`.

Section 1 (T2, difficulty baseline):
"So this can be a baseline. The entirety of the very first planet visited should be hard-set to be completable with no
changes to the ship or the crew. You should be able to build your first exploratation cruiser (the ship type will be a
heavy cruiser for expeditions), get the default crew compliment, set it all to auto so you don't manage it, and be able
to fully 100% the entire first expedition without a chance of losing, and then start scaling things up from there.
Every mission should be this way. One mission of each type will allow for players to be able to experience the content
in a safe and educational way to show them how it works, and when it's complete, the difficulty starts creeping in
slowly. Perhaps on a slightly curved line versus a linear progression. Exponential is too fast. But the first time
someone completes exploration, they can't lose. Hell, perhaps the very first tier can be completed as long as you've
built a cruiser. That being said, once the character moves on to tier 2, that will be different. The universe is not
safe. It's not meant to be. If you go in unprepared, you'll have a tough time in tier 2. If you keep doing that, and
you go into higher tiers or higher difficulty levels, you will undoubtedly fail. If you do so with safety interlocks
disengaged, you will die."

Section 7 (follow-up answers):
- Safe range: "First expedition only." (the "perhaps the very first tier" idea is NOT adopted; later Tier I runs can
  be lost, gently, on the curve).
- Heavy cruiser: "Explorers are heavy cruisers." Orion, Aurora and Eir get that class wording in their descriptions.
  No new hull.
- Which types: all four: expeditions, captain missions (first gathering run and first combat mission), patrols (the
  first patrol), short-range missions (the first of each template, once G1 is built).

Older decisions this plan must honor:
- Ground Ops user Q4 (GO-7b answers): a lost objective HOLDS AND FLAGS ("retry forever, skip by hand",
  `GROUND_STUCK_LOSSES` 3, groundOps.ts:305 to 307, :383, :1741).
- D23 (2026-10-08): stacking bonuses use unbounded concave curves, never hard caps (diminishing.ts).
- Safety Interlocks (SUGGESTIONS.md ~1349, design direction only): Tier stakes are "lose SOME progress if
  under-prepared, but RECOVERABLE"; permadeath only by opt-in interlocks; guards include a "softlock floor".
- Build ease-of-use, sell peace; decisions are the user's; never introduce a game entity the user did not name.

## 2. Findings (code on `6b2b20c`, measured)

### 2.1 How the first expedition is generated today

- **The candidates are the same for every new save.** `freshState` seeds `expeditionSeed: EXPEDITION_DEFAULT_SEED`
  (model.ts:13024, constant 0x2545f491 at :7493); candidates are `makeExpeditionSeed(expeditionSeed, i)`
  (expedition.ts:368) and the seed only advances on a dispatch (expedition.ts:378, :1074). So a new player's first
  expedition is always one of three fixed systems (G2-2 keeps the Tier I seeds byte-identical; G2-1's per-save entropy
  only moves distances).
- **The shakedown** is `shakedown: number === 1` (expedition.ts:1163), a 30 minute transit
  (`SHAKEDOWN_TRANSIT_SECONDS` 1800, expedition.ts:188, read at :1216). It changes transit only; content is a normal
  Tier I run.
- **Bodies, hazard, PoIs:** `generateSystem` (expedition.ts:483) draws 1 to 3 bodies; hazard comes from the planet
  type only (`planetTypeHazard`, expeditionContent.ts:295; volcanic 0.65, ocean 0.4, toxic 0.9, barren and gas giant
  0.1). No tier term.
- **Risk at Tier I:** `expeditionRegion` returns Tier I, no enemy territory, for every seed (riskFactors.ts:80).
  `RISK_TIER_ODDS[1]` combat 60/35/5/0/0, life 30/50/18/2/0 (riskFactors.ts:93). Hostile sites start at Tier III
  (riskFactors.ts `HOSTILE_SITE_RULES`), so none at Tier I. Ambush chance from `riskAmbushChance` (riskFactors.ts:399)
  via `groundTaskAmbushChance` (groundOps.ts:652). Affixes roll at Tier I with `AFFIX_ROLL_TIER_MULT[1]` 0.25
  (affixes.ts:293), Reinforcing among them (more fights, alert escalation).
- **Ship scan events (GO-8)** fire on every run dispatched since GO-8 (shipScanEvents.ts:1 to 30): debris, hostile
  probe battle, sensor ghost or cloaked vessel, radiation storm, plus a boarding attempt that can take credits
  (`takeBoardingLoss`, shipScanEvents.ts:340). Failures pause the scan and leave hull damage that goes to the
  Shipyard at claim (`applyShipEventDamage`, :421).
- **The vault stall:** Buried Vault fields healer + 2 bruisers, Subterranean Civilization healer + caster + bruiser +
  striker (gambit.ts:1559 to 1560). `generateEncounter` (gambit.ts:1587) scales HP and power by
  `1 + hazard * HAZARD_STAT_COEFF` (0.8, :1582) and adds an extra enemy at `hazard * 600` permille (:1581, :1592).
  The flagged path calls it from groundFight.ts:284 with the body's raw hazard. A lost objective goes to the back of
  the queue after 3 losses and is retried forever until the player presses Skip (groundOps.ts:305 to 307, :383,
  :1002, :1525; flag `groundOpsStuck` :2329, text "Stuck: needs a stronger team or a skip" :2342).

### 2.2 What a fresh explorer actually fields

- **There is no default away team.** `freshState` has `awayMembers: []` (model.ts:13043) and `crewPool: []`
  (model.ts:13004). Building a hull hires nobody. The D18 gate refuses an expedition without at least 1 ready
  Security AND 1 ready Science member (`needsAwayTeam`, expedition.ts:395 to 430, checked in `startExpedition`). So
  "the default crew complement, set to auto" cannot launch an expedition at all until the player hires from the
  recruit board (hiring is free, awayTeam.ts:435; a hire auto-slots into the lowest ground team, GO-2).
- **The complement is a different thing:** the bulk crew (`ship.complement`) fills passively from `crewPool`
  (crewOverlay.ts:664 via autoCrew.ts), which transports feed over time; it adds Security / Science strength to the
  away team snapshot (gambit.ts:1306 to 1346). A brand new ship has none.
- **The fresh recruit board** (window 0, awayRecruitSeed fixed per save like every other seed): 10 candidates, 6
  Security (ranks 4, 1, 1, 1, 3, 2) and 4 Science (ranks 3, 4, 1, 1), 1 or 2 traits each. Rank weights favor low ranks
  (awayTeam.ts `RECRUIT_RANK_WEIGHTS` 30/24/18/12/7/5/3/1).
- Orion / Aurora / Eir: tier 2, blueprint-gated (Research Lab), 4 ground squads = 2 teams, Standard-Issue gear
  (model.ts:1265 to 1334). **Their `description` strings (model.ts:1287, :1309, :1333) are read by no UI today**
  (grep: only model.ts defines `description` on ShipTypeDef; no `.description` read of a hull anywhere), so the heavy
  cruiser wording needs a place to show (a wiring audit item too: a configured value that does nothing).

### 2.3 Captain missions and patrols today

- **Gathering (extraction / survey / transport) cannot be lost.** Its only stops are `fuel` and `cargo`
  (`CaptainStopReason`, model.ts:3816); `defeat` is patrol-only. A transport idles on working capital, never fails.
- **There is no combat captain mission apart from patrols.** `CaptainMissionState` is extraction or patrol; the
  user's "first combat mission" and "first patrol" are the same thing in code (open call 9).
- **Patrols can be lost.** A lost wave sets the limp-home phase (2x return), ends `defeat` and flags the ship
  `damaged` for the Shipyard (tick.ts:3083 to 3101, :3222 to 3240). The first patrol of a fresh save uses master seed
  1 (`nextPatrolSeed: 1`, model.ts:12868; read at tick.ts:5395).

### 2.4 "First run" state in the save

- Expeditions: `nextExpeditionId` (model.ts:7863, fresh 1) is the dispatch count + 1; it already marks the first run
  (the shakedown). No claimed-run counter exists (claimExpedition, expedition.ts:2199, deposits findings, injuries and
  hull damage only).
- Patrols: `nextPatrolSeed` counts dispatches but is a seed (tests set it freely); `lifetimeStats.missionsCompleted`
  (model.ts:7615) counts WON patrol routes and delivered mission cycles per key (tick.ts:3274 to 3276, :4227).
- Short-range missions (G1): not built (E-CREW plan line 25).
- SAVE_VERSION is 69 (save.ts:61); G2-1 plans v70 for the homeworld.

### 2.5 Measured today (scratch sims through the real engine, deleted after)

Method: `freshState`, ship-1 retyped to the hull with Standard-Issue gear (`installMissingCombatBaselines`), no
complement, no officers, nothing edited after dispatch (everything on auto), the first dispatch (`nextExpeditionId`
1, the shakedown), advanced in one call to 3,000,000 s. "Stalled" = the run had not reached return or complete (an
objective held and flagged forever). Crews: **D18 minimum** (1 Security + 1 Science, rank 1, no traits, no gear),
**board** (the real fresh board hires), **full rank R** (6 Security + 6 Science of rank R slotted across both teams).

**A. The three fresh-save candidates (every new player's first expedition is one of these).**

| Candidate | Bodies (hazard) | Stuck objective (rank 3, Orion) | Other |
|:-|:-|:-|:-|
| cand-0 Lyra's Wake | volcanic 0.65, barren 0.1 | Subterranean Civilization on the volcanic body | no ship-event setback |
| cand-1 Halcyon Drift | ocean 0.4, barren 0.1 | Subterranean Civilization on the ocean body | 2 ship-event scan setbacks |
| cand-2 Calliope Reach | toxic 0.9, gas giant 0.1 | Buried Vault on the toxic body | 55 hull damage from ship events |

Each stuck objective was sent back about 570 times by 3,000,000 s (it retries forever). Stalled out of 3: D18 minimum
3/3 on every hull; board hires (first Security + first Science, or all 10) 3/3 on Orion and Aurora, 2/3 or 3/3 on Eir;
full rank 1 3/3 (Eir 2/3); full rank 3 3/3 (Eir 0/3); full rank 6 2/3. Every crew and hull combination lost at least
one fight on at least two of the three. **Of all combinations tried, only a full rank-3 Eir finishes all three
without a manual Skip; most crews finish none.**

**B. 60 random Tier I seeds (cand-0 of `makeExpeditionSeed(0x1234567, i)`), Orion unless named.**

| Crew | Stalled | Any lost fight | Hull damage | Ship-event setback | Vault or Subterranean present |
|:-|:-|:-|:-|:-|:-|
| D18 minimum | 57/60 (95%) | 58/60 | 21/60 | 35/60 | 49/60 (82%) |
| full rank 1 | 40/60 (67%) | 56/60 | 21/60 | 35/60 | 49/60 |
| full rank 3 | 24/60 (40%) | 51/60 | 21/60 | 35/60 | 49/60 |
| full rank 6 | 15/60 (25%) | 49/60 | 21/60 | 35/60 | 49/60 |
| Aurora full rank 1 | 40/60 | 56/60 | 21/60 | 35/60 | 49/60 |
| Eir full rank 1 | 24/60 | 50/60 | 21/60 | 35/60 | 49/60 |

Every stalled run stalls on a Vault or Subterranean site. (The FK-3 sweep's "about half" used a 3-member team.)

**C. Hazard ceiling probe (43 runs: the 3 fresh + 40 seeds; every body's hazard capped; today's enemies, events,
affixes).** Completed by 3,000,000 s: full rank 1: cap 0 43, cap 0.1 42, cap 0.2 28, cap 0.3 28; full rank 3: 43, 43,
43, 37; **D18 minimum: 3/43 at every cap** (one rank 1 Security member loses even unscaled ordinary fights).

**D. Safe-profile prototype (hazard 0, no affixes, no ship events, enemy HP / power / heal scaled, enemy count
capped; 63 runs, D18 minimum and board crews).**

| Enemy scale, max enemies | D18 minimum: complete / lost fights | Board: complete / lost fights |
|:-|:-|:-|
| x1, uncapped | 3 / 2,438 | 7 / 2,396 |
| x0.5, uncapped | 35 / 1,368 | 53 / 1,131 |
| x0.35, max 2 | 63 / 33 | 63 / 16 |
| x0.25, max 2 | 63 / 2 | 63 / 0 |
| **x0.2, max 1** | **63 / 0** | **63 / 0** |

**E. Patrols (200 master seeds, the live `economyTick` loop, Standard-Issue, wins out of 200).**

| Hull | Sweep | Warband | | Hull | Sweep | Warband |
|:-|:-|:-|:-|:-|:-|:-|
| General Freighter | 187 | 3 | | Battleship | 200 | 156 |
| Prospector Hauler | 199 | 8 | | Carrier | 200 | 101 |
| Prospector Runner | 103 | 0 | | Orion | 178 | 1 |
| Prospector Miner | 107 | 0 | | Aurora | 177 | 1 |
| Destroyer | 200 | 39 | | Eir | 173 | 1 |

A fresh save's first patrol (seed 1) wins the Sweep on the freighter, warships and explorers, loses it on the Runner
and Miner, and loses the Warband on every economy hull and explorer. Prototype safe patrol (2 waves of 1 Raider): 200
of 200 on both routes for all eight economy and explorer hulls tested.

## 3. Design

### 3.1 What "cannot lose" means [PROPOSAL, open call 1]

A safe first run: every objective reaches 100% with no player action; the run never stalls; the ship comes home with
no hull damage and nothing taken; no setback event fires against the player. Fights still happen (it is a lesson),
tuned so the weakest launchable crew wins them all in the sweep, AND a rule-level backstop makes completion true by
construction even if a fight is lost.

### 3.2 The first-run profile (stamped at dispatch; feature flag)

- **Expedition stamp** [PROPOSAL shape]: `Expedition.difficulty?: { version: 1; firstRun: boolean; ramp: number;
  tier: RegionTier }`, written by `buildExpedition` (so `launchForecast`'s throwaway run, which goes through the same
  builder, reads exactly what the run will do). **Absent = today's path, byte-identical** (every run in flight at the
  upgrade, every stored golden). `firstRun` is true on the same predicate as the shakedown (`number === 1`), so the
  first expedition from ANY hull is the safe one (open call 3).
- **What the profile does** (each read only when `difficulty.firstRun`; every draw is still taken, values unused, so
  no stream shifts):
  1. Ground encounters: `generateEncounter` gains an optional scale argument (absent = today): hazard read as 0, HP,
     power and heal x `FIRST_RUN_ENEMY_SCALE` [PROVISIONAL 0.2], at most `FIRST_RUN_MAX_ENEMIES` [PROVISIONAL 1]
     (section 2.5 D: 0 lost fights in 126 runs). The extra-enemy roll is still drawn.
  2. No affixes: the affix roll chance is 0 on a first run (draws kept), so no Reinforcing, no alert.
  3. No ambushes: `groundTaskAmbushChance` returns 0.
  4. Ship events fire for the lesson but every check passes: no probe or cloaked battle, no hull damage, no scan
     setback, no boarding loss; the bonus sides (ghost find, supply cache) still pay [PROPOSAL, open call 8]. The fixed
     five-draw layout is untouched.
  5. **The backstop (completion by construction):** on a first run a LOST fight still clears its fight point (the
     crew returns and heals as usual; the objective's progress moves on). Every fight point therefore clears in one
     attempt, ambush and reinforcement fights cannot occur (2, 3), so every objective reaches 100% and the window
     closes. This is the one new rule; it never applies to a run without the stamp. Log line **[PROPOSAL]**: "The
     guards fell back. Training run: no setback."
- **Patrol stamp** [PROPOSAL shape]: `PatrolMissionState.difficulty?: { version: 1; firstRun: boolean; ramp: number }`
  at dispatch. First run: the cycle flies `minWaves` waves of one enemy each, drawn as the route's lightest hull
  (Raider on both routes today) [PROPOSAL, open call 10], with the wave draws unchanged; backstop: on the first cycle a
  wave the ship would lose breaks off (no defeat, no limp, no damage, no loot for that wave). Applies to the first
  cycle only; later cycles of a repeat run read the stamped `ramp`. The Threat Assessment forecast (App.svelte
  `patrolForecastFor` through `resolvePatrolWaves`) reads the same profile, so the first patrol reads Guaranteed.
- **Gathering:** no engine change (it cannot be lost). The first gathering run is educational only: the first-run
  chip and Help line (SF-6), keyed on `lifetimeStats.missionsCompleted` having no mission key yet.
- **Short-range missions (G1):** a CONTRACT for G1's design, not built here: every template stamps the same
  `difficulty` shape at dispatch, its first run per template uses a safe profile, later runs read the shared ramp;
  counters keyed per template (SF-1 provides the keyed counter and the ramp function).

### 3.3 Tracking "first" in the save [PROPOSAL, open call 14]

- New `GameState.runCounts?: { version: 1; expeditionsClaimed: number; patrolsDispatched: number; shortRange:
  Record<string, { dispatched: number; completed: number }> }`. Expedition "first" stays `nextExpeditionId === 1`
  (the shakedown predicate, already stored). Patrol "first" = `patrolsDispatched === 0`. Ramp positions: expeditions
  read `expeditionsClaimed` (incremented in `claimExpedition`, also for legacy runs), patrols read the sum of
  `lifetimeStats.missionsCompleted` over `PATROLS` keys (won routes, already stored).
- **Existing saves count as done:** the migration seeds `expeditionsClaimed = max(0, nextExpeditionId - 1 -
  expeditions.length)` and `patrolsDispatched = max(0, nextPatrolSeed - 1)` (or 1 when any patrol route was ever
  won). A save that ran any expedition or patrol therefore never gets a first-run profile for it. A 0.13.9 player who
  never launched an expedition (exploration is new in 0.14.0) DOES get the safe first expedition.
- **Save bump:** fold into the then-unreleased bump (v70, shared with G2-1, if v70 has not reached staging; otherwise
  v71). Check `git log` for G2-1 or another slice's bump first. Frozen, idempotent migration helper (the v67 / v68
  pattern). Run fields stay optional (no bump).

### 3.4 The gentle curve after the first run [PROPOSAL, open calls 4 to 6]

- `k` = completed runs of the type BEFORE this dispatch (completions only, so a struggling player is never pushed
  harder; open call 5). The first run is `k = 0` (the safe profile). For `k >= 1`, `t = min(1, (k - 1) / (N_FULL -
  1))` and the run's ramp `f = shape(t)` in [0, 1], frozen on the run (`difficulty.ramp`) so an in-flight run never
  changes.
- Shape **[PROPOSAL] gentle ease-in, `t^1.5`** ("creeping in slowly"; polynomial, so it can never become exponential).
  Alternatives: the D23 concave family (`1 - (1 - t)^2`, front-loaded, then flattens) or linear. `N_FULL` [PROVISIONAL
  10]. The enemy scale per run = `RAMP_FLOOR + (1 - RAMP_FLOOR) * f`, `RAMP_FLOOR` [PROVISIONAL 0.35] (section 2.5 D:
  the D18 minimum crew completes 63/63 there):

| Run (k) | 2 (1) | 3 (2) | 4 (3) | 5 (4) | 6 (5) | 7 (6) | 8 (7) | 9 (8) | 10 (9) | 11+ |
|:-|:-|:-|:-|:-|:-|:-|:-|:-|:-|:-|
| ease-in t^1.5 [PROPOSAL] | 0.35 | 0.37 | 0.42 | 0.48 | 0.54 | 0.62 | 0.70 | 0.80 | 0.89 | 1.00 |
| linear | 0.35 | 0.42 | 0.49 | 0.57 | 0.64 | 0.71 | 0.78 | 0.86 | 0.93 | 1.00 |
| concave 1 - (1 - t)^2 | 0.35 | 0.49 | 0.61 | 0.71 | 0.80 | 0.87 | 0.93 | 0.97 | 0.99 | 1.00 |

- What `f` scales at Tier I (each a pure multiplier on a stored value; no new draw): enemy HP / power / heal (the scale
  above), the affix roll chance (x f), the ambush chance (x f), the ship-event check difficulty and hull wear (x f).
  At `f = 1` the run is the Tier I NOMINAL, which is today's Tier I with the hazard ceiling below.
- **Scope [PROPOSAL, open call 6]: the ramp is Tier I only.** Tier II and up start at their nominal on the first run
  there ("once the character moves on to tier 2, that will be different"). The tier itself is the step (RISK_TIER_ODDS,
  AFFIX_ROLL_TIER_MULT and G2's tables already climb per tier). The per-tier nominal is a content target, not a
  stacking bonus, so the clamp at `t = 1` is not a D23 cap; growth across the game comes from the tiers.
- Patrols use the same `f` on enemy stats from `RAMP_FLOOR` to the PatrolDef nominal (today's numbers), keyed on won
  routes. A veteran save reads `f = 1` and is byte-identical to today.

### 3.5 The vault-site stall after the first run [PROPOSAL, open calls 7 and 15]

- **Encounters read a tier-bounded hazard:** `encounterHazard = min(rawHazard, TIER_ENCOUNTER_HAZARD_CEILING[tier])`,
  for stats and the extra-enemy chance, on stamped runs only (the scan slowdown keeps the raw hazard: hazard still
  shapes the scan and the risk grade). [PROVISIONAL] Tier I 0.1 (section 2.5 C: full rank-1 teams complete 42/43,
  rank 3 43/43), Tier II 0.5, Tier III and up uncapped (raw). This also answers G2 open call 18 under the T2 rule.
- Combined with the ramp, a run-2 crew meets vault guards at 0.35 of nominal with hazard at most 0.1; the stall
  becomes a nominal-Tier-I event only for crews that never grew (D18 minimum), which is "lost, gently": the objective
  holds and flags as the user decided (Q4), nothing else is lost.
- Hold and flag stays (user Q4). Alternative (open call 15): at Tier I only, a stuck objective withdraws on its own
  after `GROUND_STUCK_LOSSES` sent-backs and the run comes home logged at its completion %. That reverses Q4 for Tier
  I, so it is offered, not planned.

### 3.6 Determinism, parity, flags

- No new salt and no new RNG stream: every change scales a value or forces an outcome after the existing draws. The
  per-run stamp is written at dispatch from stored state, so offline == live holds by construction; each engine slice
  still proves one call == 997 s chunks == 1 s steps on a first run and a ramped run (and the patrol closed form).
- In-flight runs and every golden without the stamp resolve byte-identically (strip helpers `withoutDifficulty` for
  expeditions and patrols, the `withoutG2Run` pattern).
- **Test fixtures:** freshState is a true new game, so it gets first runs. About 94 `startExpedition` calls in 35
  test files and 15 patrol test files assume nominal play; SF-2 and SF-4 add one helper `asVeteran(state)` (runCounts
  at `N_FULL`, `nextExpeditionId` 2) to the files that pin nominal behavior, mechanically, in the same slice.

## 4. Slices

Gate after every slice: `npm run check` (0 errors; the 2 known RadialWeb warnings are fine) and `npx vitest run` (all
green). One commit per slice, staged by explicit path, ending `Co-Authored-By: Claude Opus 5.5
<noreply@anthropic.com>`. Shared tree: other agents work here; never `git add -A`.

### SF-0: Goldens first (tests only)

New `firstRunsGoldens.test.ts`, captured BEFORE any engine edit:
1. Patrol: the whole first cycle (mission record, ship, completion log, state hash) from freshState for every hull x
   both routes at seeds 1 and 2, plus the 200-seed win table of section 2.5 E (pinned as numbers).
2. Gathering: one delivered cycle for every MISSIONS key x every hull that can fly it.
3. Expedition: the section 2.5 A and B outcome tables pinned (the "today" record, numbers not hashes), and a reference
   to the G2-0 goldens (golden 1 must stay unchanged in every SF slice; golden 2's expedition 1 dispatch is compared
   through `withoutDifficulty`).
Commit `test(0.14.0): pre-safe-first-runs goldens (SF-0)`.

### SF-1: Counters, the curve, SAVE (engine, no behavior)

- Pure module `runDifficulty.ts` [PROPOSAL name]: `runCountsOf(state)`, `isFirstRun(state, type, key?)`,
  `completedRuns(state, type, key?)`, `rampFraction(k)` (open call 4), constants `N_FULL`, `RAMP_FLOOR`,
  `FIRST_RUN_ENEMY_SCALE`, `FIRST_RUN_MAX_ENEMIES`, `TIER_ENCOUNTER_HAZARD_CEILING`.
- `GameState.runCounts` + migration (section 3.3); `claimExpedition` increments `expeditionsClaimed`; patrol dispatch
  increments `patrolsDispatched`.
- Tests: the curve is 0 at k = 1, 1 at k >= N_FULL, strictly increasing between, every step at most the linear step x
  1.5 (never exponential: the step ratio between consecutive runs stays bounded); migration (a fresh save 0; a save
  with any expedition or patrol counts as done; idempotent; an in-flight run unchanged through claim); G2-0 golden 1
  unchanged.

### SF-2: The safe first expedition (engine)

- Stamp `difficulty` in `buildExpedition`; the five profile effects of section 3.2 (encounter scale, no affixes, no
  ambushes, pass-only ship events, the backstop).
- **The proof tests** (the heart of the plan): for each of Orion, Aurora, Eir (and the General Freighter), the 3
  fresh-save candidates plus 500 seeds, crews {D18 minimum rank 1, the real fresh board hires at board windows 0 to 5,
  full rank 1, full rank 1 with a passive complement}, advanced with no edits: 100% of objectives done, the window
  closes, phase reaches complete, hull damage 0, no ship-event setback, no boarding loss, no stuck flag at any
  checkpoint; lost fights 0 [PROVISIONAL target; the backstop proves completion regardless]; the launch forecast's
  outcome equals the run's. Parity on a first run with a wipe and a recovery leg. Golden 1 unchanged; golden 2's
  shakedown through `withoutDifficulty` unchanged.
- Fixture sweep: `asVeteran` added where tests pin nominal behavior.

### SF-3: The ramp and the vault fix (engine)

- Non-first runs stamp `ramp` and `tier`; consumers apply the enemy scale, the tier hazard ceiling, the affix /
  ambush / ship-event scaling (section 3.4, 3.5).
- Tests: over 200 seeds per k, the full rank-1 stall rate and lost-fight rate are non-decreasing in k; at nominal Tier
  I (k >= N_FULL) full rank-1 teams complete >= 95% and Vault / Subterranean sites are won >= 90% [PROVISIONAL targets,
  calibrate the ceiling]; the D18 minimum crew completes run 2 >= 95%; Tier II and up read nominal from the first run
  (a test forces the tier by parameter until G2-2 supplies regions); determinism and parity on a ramped run.

### SF-4: The safe first patrol and the patrol ramp (engine)

- Stamp at dispatch; the safe wave shape and the backstop (section 3.2); the enemy-stat ramp. BOTH call sites apply
  it: the live loop (tick.ts wave generation) and the forecast (`patrolReplay.ts` ~318, `resolvePatrolWaves`), with
  the existing parity proof extended.
- Tests: the first patrol is won on 1,000 seeds x every hull x both routes x Dispatch Once and Repeat (no defeat
  ending, no damage); later patrols' win rate non-increasing in k; a veteran save byte-identical to SF-0 golden 1;
  `patrol-balance.test.ts` runs as a veteran and keeps its numbers; the forecast band on a first patrol reads
  Guaranteed.

### SF-5: Gathering and the G1 contract (tests + doc)

- A test that every MISSIONS key, every hull, every stop path has no defeat outcome and that the first-run marker reads
  true until the first delivered cycle (display only).
- A carry note in the E-CREW plan G1 entry: G1 templates stamp `difficulty`, use `isFirstRun(state, "shortRange",
  templateKey)` and `rampFraction`, and add their own proof test like SF-2's.

### SF-6: UI and text (small; text sign-off, no layout change)

- Hull descriptions **[PROPOSAL text]** (model.ts:1287, :1309, :1333):
  - Orion: "Heavy cruiser. A long-range explorer: enormous shields and reach, a frail hull, and almost no guns."
  - Aurora: "Heavy cruiser. A survey scout: the most module slots and the fastest cruise, at the cost of frame and
    hold."
  - Eir: "Heavy cruiser. A medical transport: the largest hold and crew the fleet fields, for supplies and
    evacuations."
  - Show `description` where a hull is chosen and read: the Shipyard build card and the ship detail header
    [PROPOSAL placement]; today no UI reads it (section 2.2).
- First-run chip **[PROPOSAL text]** on the expedition dispatch card, the run view and the patrol dispatch card:
  "Training run" with the line "Your first expedition cannot fail. From the next one on, the risk rises slowly." (patrol:
  "Your first patrol cannot fail. ..."); the gathering card: "First run: see how a mission works." The backstop log line
  of section 3.2. The forecast and recommendation read the profile, so they agree with the chip.
- Help: the `riskFactors` / `objectiveDifficulty` topics gain a "Training runs and rising risk" paragraph (numbers read
  from the constants); the helpTopics text-rules test covers it.
- 375 px, no sideways scroll; any glyph is SVG in `icons.ts` with `ICON_SEMANTICS` (no emoji).

### SF-7: Close-out

Holistic review (bug-check subagent, then a full-ledger fix pass), carry notes into this doc, the Ground Ops BALANCE
FINDING marked resolved by SF-3, G2 open call 18 marked answered, the QA sheet (section 6) to the user. Staging only
after the wiring check also passes (S15).

**Text rules (every slice).** No em dashes and no double hyphens anywhere (text, code, comments, docs); US English;
"install", never fit / fitting / fitment; "objective", never "task", in player-facing text (code names stay); tier
numbers in Roman numerals; SVG glyphs only.

## 5. OPEN CALLS for the user

1. **What "cannot lose" covers.** [PROPOSAL] every objective done, never stuck, no hull damage, no setback events, no
   credits taken; fights tuned to zero losses with a backstop (a lost fight still clears its point). Alt: also no
   member ever knocked down (stricter, more engine work). Alt: fights optional (no fights at all on the first run).
2. **"The default crew complement."** No away team exists at start; hiring is required to launch. [PROPOSAL] the
   guarantee holds for the weakest crew that can launch (1 Security + 1 Science, rank 1, no gear, no complement). Alt: a
   newly built explorer arrives with its squads auto-hired from the board (new behavior).
3. **Which expedition is first.** [PROPOSAL] the first dispatched from any hull (the shakedown). Alt: the first from an
   explorer hull. Alt: every run until the first one is claimed (lets several ships launch safe runs at once).
4. **Curve shape.** [PROPOSAL] ease-in `t^1.5` ("creeping in slowly"), full at 10 completed runs. Alt: concave D23
   family (front-loaded). Alt: linear. (Table in section 3.4.)
5. **What advances the curve.** [PROPOSAL] completed runs only. Alt: every dispatch.
6. **Ramp scope.** [PROPOSAL] Tier I only; Tier II and up are nominal from their first run. Alt: a short ramp per tier.
7. **Tier hazard ceilings (the vault fix).** [PROPOSAL] encounters read hazard at most I 0.1, II 0.5, III and up raw;
   the scan keeps raw hazard. Alt: scale raw hazard by a per-tier factor. Alt: keep raw hazard, fix only by the ramp.
8. **Ship events on the first run.** [PROPOSAL] they fire and every check passes (a visible lesson). Alt: none at all.
9. **"First combat mission" vs "first patrol".** In code they are the same (patrols are the combat missions).
   [PROPOSAL] one safe first patrol in total. Alt: the first run of each route (Sweep and Warband) is safe.
10. **Safe patrol shape.** [PROPOSAL] `minWaves` waves of one enemy, the route's lightest hull, plus the no-defeat
    backstop (measured 200/200). Alt: today's waves at reduced enemy stats.
11. **Patrol ramp knob.** [PROPOSAL] enemy stats from 0.35 to nominal on the curve. Alt: step wave and enemy counts.
12. **First-run text.** [PROPOSAL] "Training run" chip and lines in SF-6; yours to reword.
13. **Heavy cruiser wording and where it shows.** [PROPOSAL] the three descriptions in SF-6, shown on the Shipyard
    build card and ship header. Alt: a "Heavy Cruiser" class tag beside the hull name instead.
14. **Save shape.** [PROPOSAL] `runCounts` folded into the unreleased bump (v70 with G2-1). Alt: no bump; derive from
    `nextExpeditionId` and `lifetimeStats` (no claimed-run count, so the curve would follow dispatches).
15. **Hold and flag at Tier I.** [PROPOSAL] keep your Q4 rule (retry forever, skip by hand); the ramp and ceiling make
    stalls rare. Alt: at Tier I only, a stuck objective withdraws by itself and the run comes home (reverses Q4 there).
16. **Recall and the first run (after G2-5).** [PROPOSAL] recalling the first expedition uses it up. Alt: the next run
    is still a training run until one completes.

## 6. QA list (desktop 1280 px and mobile 375 px)

1. New save: research and build an Orion; hire one Security and one Science member; dispatch with nothing else
   changed; the "Training run" chip shows; the run completes 100% with no Skip, no hull damage, no setback events.
2. Same with Aurora, Eir and the General Freighter; same with all three fresh candidates.
3. The second expedition: no chip; slightly tougher (more fights lost possible), still completes with a full rank-1
   crew; the forecast agrees.
4. Ten more runs: difficulty rises gently; a Vault or Subterranean site at Tier I is winnable by a full rank-1 crew.
5. An existing save that already ran expeditions or patrols: no training run anywhere; an in-flight run finishes
   exactly as before.
6. First patrol on a Prospector Runner, Sweep and Warband: won, no damage, forecast reads Guaranteed; the second patrol
   reads its real band.
7. First gathering run: the "First run" line shows once.
8. Shipyard and ship header show the heavy cruiser descriptions for Orion, Aurora and Eir.
9. Help: the training runs paragraph; no em dash, no "task", no "fit".
10. Regression: Ground Ops, affixes, field repair, telescope card, recommendation and forecast at Tier I; patrol
    balance numbers for a veteran save.

## 7. Size (honest)

8 slices (SF-0 to SF-7). Heaviest: SF-2 (five profile effects across groundFight, groundOps, affixes, shipScanEvents,
plus the proof sweep and the fixture pass over about 35 test files) and SF-4 (two wave call sites and the forecast
parity). Rough estimate: 1,500 to 2,500 lines of code and tests, about one and a half to two working days of slices
plus review loops. The proof sweeps are slow (about 0.4 s per expedition run): SF-2's full matrix runs in a dedicated
test file with a long timeout, a smaller fixed sample in the default suite. Dependencies: SF-3's tier ceiling reads
G2-2's region when it lands (Tier I until then); the save fold depends on where G2-1's v70 is; G1 is a contract only.

## USER ANSWERS (2026-10-15)

- **OC-2 default crew:** "Weakest crew still wins (Recommended)": no free hires; the first expedition is guaranteed even
  with the smallest crew that can launch (1 Security + 1 Science, rank 1, no gear).
- **OC-1 what "cannot lose" covers:** "Finish 100%, no setbacks (Recommended)": every objective completes, no lost
  fights, no hull damage, no ship-event setbacks; members may still take hits in fights they win.
- **OC-15 stuck objectives after the first run:** "Keep it, plus the warning (Recommended)": keep retry-until-Skip and
  add a pre-launch warning when a crew cannot win an objective.
- **Field Kits severity ranks (asked here):** "In 0.14.0 Field Kits (Recommended)" (recorded in the Field Kits plan).

## SF-0 CARRY NOTE (2026-10-15, built on bfac15f)

Files (tests only, no engine or UI change): `src/lib/game/firstRunsGoldens.test.ts` (59 default tests, about 15 s),
`src/lib/game/firstRunsGoldens.sweep.test.ts` (12 default tests, about 4 s), and the shared
`src/lib/game/firstRunsGoldens.fixture.ts` (the section 2.5 method: `onHull`, `withCrew` for the D18 minimum, board2,
board10 and rank 1 / 3 / 6 crews, `runOutcome`, `SWEEP_END` 3,000,000 s; `stateHash`; the `SWEEP` gate).
**Every whole-state hash goes through `stateHash`**, which strips `runCounts` (SF-1) and `homeworld` (G2-1): a no-op
today, so SF-1's counters alone move no golden. **The measurement gate:** `npm run test:sweep` (vitest in mode `sweep`;
or `SF_SWEEP=1`) also runs the pure measurement tables, 233 tests in about 65 s: the dispatch card's Threat Assessment
bands, the section 2.5 E 200-seed win table, the readable section 2.5 A outcome lines (`lines:*`), and all 60 seeds of
the section 2.5 B table with its sums. The default run keeps 7 of the 60 seeds (3, 13, 15, 23, 27, 31, 39) per row.

What is pinned: the fresh-save first-run predicates and the fresh recruit board; every hull x both patrol routes, the
whole first cycle at master seeds 1 and 2 (dispatch record, display replay per tick, ship, completion log, state), the
save's second patrol after a won first one, a Repeat patrol's first two cycles, closed-form parity; one delivered cycle
for every MISSIONS key x every hull (or its refusal); the section 2.5 A shakedowns for the General Freighter, Orion,
Aurora and Eir x six crews (whole-record hashes and the claim), the shakedown launch view at telescope Level 5,
offline == live parity (one call, 997 s chunks, the event-boundary chain) on a stalled shakedown; later runs as
expedition 2 and 11 and a REAL second run after a claimed first; generateEncounter for the Vault, Subterranean and three
ordinary sites at hazards 0 to 1; **an old save** (`old:v69`: a v69 save with expeditions 1 and 2 flown, patrol seed 5
and a won Sweep, through deserialize + migrate, then one Sweep cycle and one expedition run); the section 2.5 B per-seed
codes and run hashes. Gated: the bands, the win table, the outcome lines and the full 2.5 B table (see above).

Reproduced exactly: section 2.2's board, 2.5 A (crews slotted across both teams, team 0 first), 2.5 B (the setback
column is 35 only with the broad reading: a failed or lost check, a scan pause, hull wear, or an unrepelled boarding;
failed or lost checks alone give 33) and 2.5 E.

Findings for later slices:
- "Every stalled run stalls on a Vault or Subterranean site" holds on the full-rank Orion and Aurora rows only. The D18
  minimum Orion also stalls on 8 seeds with no such site, and Eir rank 1 on 2 seeds elsewhere (sweep column K). On the
  fresh candidates the D18 crew is stuck on ordinary sites too (candidate 0: 10 stuck objectives, 1 of 11 done). SF-2's
  enemy scale must cover every site, not only the guards (the backstop already does).
- The shakedown launch view at Level 5 for a D18 crew on a Freighter or an Orion is byte-identical to G2-0's rank 10
  crew view (`display:launch`). Worth a look for SF-2 ("the launch forecast's outcome equals the run's") and the OC-15
  pre-launch warning.
- First patrol today (seed 1): the Sweep is lost on the Runner and Miner, the Warband on every economy hull and explorer;
  the dispatch card reads "dice" (Runner, Miner Sweep) down to "impossible" (Runner, Miner, explorers Warband).

Which goldens move where: SF-1 moves none (`stateHash` strips `runCounts`). SF-2 moves the shakedown goldens
(`first:*`, `lines:first:*`, the parity hash, the whole sweep file) and must name each move; SF-3 moves `later:*`;
SF-4 moves the fresh-save patrol goldens, the second patrol and the Repeat rows, and the forecast bands; `gather:*`,
`guards` and `old:v69` must stay unchanged through SF-4 (an absent scale argument is today's encounter; an old save
counts as a veteran). When G2-1 lands, `oldSave()` passes migrate the fixed entropy value G2-0's `restored` does.

## REVIEW FINDING (2026-10-15, SF-0 review): Tier I is not gentle for small crews, even off vault sites

- The weakest launchable crew (1 Security + 1 Science, rank 1, no gear) stalls on ORDINARY sites too, not only vaults:
  derelictOutpost (2 Strikers + Swarm), geothermalChamber (Caster + Bruiser), crashedShip, xenoFloraBloom, caveNetwork,
  at hazards from 0.1 to 0.9, no affixes, 0 fight points cleared. Across 63 runs, 209 of 322 stuck objectives were
  non-vault.
- Capping enemy hazard at 0.1 (even 0) leaves the weakest crew stalling 60 of 63. Cap 0.1 plus the x0.35 ramp floor
  stalls 0 of 63 but 50 of 63 still lose fights. Eir rank 1: 26 stalls to 8 (all vault). Orion rank 1: 43 to 1.
- Meaning: the first run needs SF-2's every-site scale plus the backstop (as planned). At nominal Tier I (run 11+) the
  weakest crew stalls about 95% of the time. Raised with the user as a "Your call": how gentle Tier I must be after the
  first run, and for which crew.

## USER ANSWER (2026-10-16): Tier I after the first run

Verbatim: "Okay, so I think that this should go one of two ways. Either it should allow for a user to fully fill a team
with any avaialble ground team, with any level of equipment. Or, we have to perform a slight upgrade to a new set of
gear that can be crafted. I want to say the latter is the best choice."
Reading: the user prefers option 2: after the guaranteed first run, ordinary Tier I expects a SLIGHT gear upgrade
(a craftable set) rather than being comfortable for any full team in starting gear. OPEN (asked 2026-10-16): whether
"a new set of gear" means existing Fabricator away-team gear at low item levels, or a NEW starter gear set (a new
entity the user would name); and whether a full team is also expected.

Follow-up answers (user, 2026-10-16):
- **Which gear:** "1. Basically, We should be able to use the quartermaster during the tutorial to get a first set of
  gear. Standard issue equipment for each of our 6 ground team squad members." So: existing gear; the Quartermaster
  issues a first set of Standard-Issue equipment for each ground team member (the tutorial in the quests patch will
  walk the player through it).
- **Team size:** "Full team + upgrade (Recommended)": comfortable Tier I = a full away team wearing that first set.
- CONFLICT found (asked 2026-10-16): Standard-Issue gear is stat-neutral by design today (model.ts
  STANDARD_ISSUE_IMPLICIT_MAGNITUDE = 0; the Quartermaster already issues Standard-Issue MEMBER pieces at 0 points), so
  wearing it changes nothing. For the Quartermaster set to be the "slight upgrade", member Standard-Issue pieces would
  need small real stats.
- **Standard-Issue stats (user, 2026-10-16, verbatim):** "Each piece of gear gets stats. Similar to ship systems.
  Except with far fewer slots. Default is 3, unless the racial allows for 2 kit slots. Weapon provides offensive stats.
  Armor provides defensive stats. Kit provides utility and potentially stats associated with that based on the role
  the tool is designed for." So member Standard-Issue pieces get real stats (weapon offensive, armor defensive, kit
  utility / role stats). CHECK vs code (asked 2026-10-16): today a member has Armor, Weapon, Tool and IMPLANT slots
  (1 implant, 2 for the augment-affinity races Martian and Stheni, awayTeam.ts implantSlotsFor); the user's "default
  is 3, unless the racial allows for 2 kit slots" may mean the implant racial, or a new 2-kit racial.
- **Member slots (user, 2026-10-16):** "OOH. Yes. Sorry. That's what I mean. Implants X1/X2 depending on racial. Keep
  this as is." So slots stay Weapon, Armor, Tool (the "kit") + Implant x1 (x2 for Martian / Stheni). The free
  Standard-Issue set covers Weapon, Armor and Tool; implants stay a separate extra slot.
- **SF7 hazard ceilings (2026-10-16):** "Cap by tier (Recommended)": enemies read hazard at most 0.1 at Tier I, 0.5 at
  Tier II, uncapped from Tier III; scans and the risk grade keep the real hazard.
- **SF4 curve shape:** "Slow start (Recommended)": run 2 at 35%, run 6 about 54%, run 9 about 80%, full from run 11.
- **SF6 curve scope:** "Tier I only (Recommended)": Tier II and up start at full strength; the tier is the step.
- **SF12 wording:** ""Training run" chip (Recommended)": a "Training run" chip on the first run of each type and the
  log line "The guards fell back. Training run: no setback."
