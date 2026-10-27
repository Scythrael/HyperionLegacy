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

> **STALE after WR-4 B14 (2026-10-16):** battle turn order is by side (the player first), then input order, so this
> table no longer matches the engine. The current numbers are the `WINS` table in `src/lib/game/firstRunsGoldens.test.ts`
> (gated, `npm run test:sweep`; re-measured: freighter 191 / 5, hauler 198 / 10, runner 106 / 0, miner 107 / 0,
> destroyer 200 / 44, battleship 200 / 158, carrier 200 / 109, Orion 176 / 1, Aurora 174 / 1, Eir 172 / 1). The
> seed 1 sentence below is also from before B14.

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
   both routes at seeds 1 and 2, plus the 200-seed win table of section 2.5 E (pinned as numbers; STALE in the plan
   after WR-4 B14, the pinned `WINS` table in firstRunsGoldens.test.ts is current).
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

## USER ANSWERS, group 1 of the leftovers (2026-10-16, verbatim)

- **SF3 which first:** "2, because part of the tutorial will require that the user build a ship, and the tutorial will
  include "time skips" that instantly finish things for no resources. Similar to how a typical tutorial would. Giving
  you the materials, and finishing it up. So when you unlock exploration, part of the tutorial will involve you getting
  your first T1 ship that can go on that first expedition. So it's a guaranteed win. That first one will always finish
  rather quickly. Expedited, as all first tutorial runs will across the board when you're being taught the systems. We
  might want to add this functionality in where applicable so any systems we build into the tutorial/story/campaign
  patch can link in with them directly."
  Reading: the training run is the first expedition FROM AN EXPLORER (the tutorial gives the first T1 explorer). First
  tutorial runs are EXPEDITED (finish quickly) across every system; the tutorial patch adds "time skips" that instantly
  finish things for free. 0.14.0 should build the HOOKS (an expedite / time-skip seam per run type and per facility
  process) so the tutorial patch can link in directly. Follow-up asked: whether first runs are already expedited in
  0.14.0 or only hooked.
- **SF5 curve advance:** "1, but the tutorial does not count for this. Completing the tutorial will give you an
  achievement for each tutorial you complete though. We may also have to flesh those out appropriately between
  tutorial and balancing patch. So we will want to throw that in somewhere in 0.15.x because those will need to be
  accounted for in balancing too. But yeah, your question. Completed runs only, minus the tutorial run."
  So: completed (claimed) runs only; the training / tutorial run does not count. Per-tutorial achievements are a
  0.15.x item (logged in SUGGESTIONS).
- **SF8 training ship events:** "For now, 1. But as you go into higher tiers, you might have hazards in your way that
  can cause problems. You might have to pass through a massive electrical storm and going around would be too extensive
  to go around." So: events fire and always pass on the training run; FUTURE idea (logged): transit hazards en route
  at higher tiers.
- **SF16 recall first:** "Training carries over (Recommended)".

## USER ANSWERS, group 2: tutorial hooks (2026-10-16)

- **Expedite now:** "Hook only": in 0.14.0 first runs keep normal length; the tutorial patch turns expediting on.
  (Follow-up asked: today's existing 30-minute shakedown first expedition.)
- **Time-skip scope:** "Every timed process (Recommended)": one shared seam covering missions, patrols, expeditions,
  ship builds and repairs, research, crafting, refining, salvage and facility upgrades; unused until the tutorial.
- **Non-explorer first expedition (verbatim):** "The balance for expeditions make it impossible for any ships that
  exist in-game now to be able to dispatch in one of them. Because their ships/cores don't have enough capacity and/or
  speed to get them there without running out of fuel and dying in the cold depths of space all alone." So: only
  explorers can reach expedition systems; non-explorer hulls fail the reach / drive gate even for Tier I. TODAY the
  code lets every hull launch an expedition (no reach gate): G2's reach gate must enforce this, and the dispatch screen
  must say why ("can't reach: needs an explorer's range and drive").
- **Grant hook:** "Yes, add it now (Recommended)": one shared grant seam (items, credits, gear, a hull) with a log line,
  tested, unused until the tutorial / quests patch.

## USER ANSWERS, group 3 (2026-10-16, verbatim where quoted)

- **Shakedown:** "For now, we go with the regular planned duration, but set both the tutorial and normal length of the
  trip to the same value. Then, when tutorial time comes, we adjust accordingly and set the tutorial time to something
  like "5 seconds" when the story beats will basically explain some aspects of it while we "travel". Basically, the
  lore will carry the tutorials. But if this system occurs, once we actually complete the tutorials, a secondary
  version of the tutorial must be available for a player to repeat that just shows them how to use the system, but
  doesn't include the "shorter trip" tutorial version because this will reward real actual loot (including guaranteed
  drops so we can show how specific systems work. Like at least one or two general relics, and the very first
  exceptional relic."
  So in 0.14.0: retire the 30-minute shakedown as a special length: the first explorer expedition takes the regular
  Tier I duration, via a separate TUTORIAL duration constant set EQUAL to the normal one (the tutorial patch later sets
  it to about 5 seconds). Logged for the tutorial patch: story beats during travel; a repeatable practice version of
  each tutorial after completion, with normal durations and no tutorial rewards; the real tutorial grants guaranteed
  drops (one or two general relics and the very first exceptional relic).
- **Non-explorer ground teams:** "1. But add in the wiring for a third team. Because remember, combat and prospecting
  are getting their own more involved set of quests and gameplay, and having a set of teams for prospecting for those
  will required. Also, security squads could have their own role as well. A special mission to infiltrate an enemy base
  or a combatant's vessel." So: keep their teams (boarding defense now, short-range missions later) AND wire a third
  team (follow-up asked: a third team TYPE such as the existing, inert Prospecting type, or a third team slot).
  FUTURE (logged): prospecting quests with prospecting teams; Security infiltration missions (enemy base, enemy vessel).
- **SF9:** "One in total (Recommended)". **SF10:** "Fewest waves, lightest raider (Recommended)": 2 waves of 1 Raider.

## USER ANSWERS, group 4 (2026-10-16)

- **Third team:** "Prospecting squad type (Recommended)": finish the existing Prospecting squad type.
- **Use it now?** "2. Because there's no real use for them yet. It's building in the foundation for them as is, rather
  than building them in after the fact. Since we're building 2/3 of the squads, we might as well build all 3." So:
  build Prospecting fully (specs, recruits, gear rules, slots, tests) but HIDDEN from players until the prospecting
  quests: an explicit, user-approved exception to the no-placeholders rule (registry status: deferred, owner = the
  prospecting quests patch).
- **SF11 patrol ramp:** "Scale enemy stats (Recommended)": enemies start weaker and grow to full over the first
  several patrols (same gentle curve).
- **SF13 heavy cruiser text:** "Build card + ship header (Recommended)": show the hull description, incl. "heavy
  cruiser", on the Shipyard build card and the ship header.
- **Prospecting design (2026-10-16):** "I draft, you approve (Recommended)": a short design + mockup (roles, what each
  improves on gathering, gear, team kinds), every name a [PROPOSAL] for the user to rename. Built hidden.

## SF-1 CARRY NOTE (2026-10-16, built on 576ce3a)

Files: new `src/lib/game/runDifficulty.ts` (pure rules) + `runDifficulty.test.ts`; `model.ts` (`RunCounts`,
`freshRunCounts`, `RunDifficultyStamp`, `Expedition.difficulty?`, `GameState.runCounts?`, freshState seeds it);
`expedition.ts` (claimExpedition counts); `tick.ts` (patrol dispatch counts; economyTick folds won routes); `save.ts`
(v70 step 2). No behavior change: nothing reads the curve, the stamp or the training rule yet.

**Data model** (renamed from section 3.3 to fit the USER ANSWERS): `runCounts = { version: 1, expedition: { completed,
trainingDone, veteran }, patrol: { dispatched, completed, veteran }, shortRange: { [template]: { dispatched, completed }
} }`. `expedition.completed` = claimed runs that were not recalled, the training run excluded (SF5);
`trainingDone` = the training run was claimed, not recalled (SF16: a recalled one carries over); `patrol.completed` =
won routes (economyTick, beside `lifetimeStats.missionsCompleted`). The training run = the first expedition FROM AN
EXPLORER (spec "explorer"), one at a time (a stamped training run out blocks a second): `isTrainingExpedition`.
One safe patrol in total: `patrol.dispatched === 0`. G2-5's `Expedition.recall` is read by shape until it lands.

**The curve** (SF4 slow start): `rampFraction(c) = (c / (N_FULL - 1)) ^ 1.5`, c = completed runs (training excluded),
so run 2 reads 0 (enemy scale `RAMP_FLOOR` 0.35), run 6 0.54, run 9 0.80, run 11 on 1. `runRamp` is Tier I only
(SF6); `encounterHazard` caps I 0.1 / II 0.5 (SF7); `runEnemyScale` / `runMaxEnemies` read the training constants.
`runDifficultyAt(state, type, tier, key?)` returns the stamp SF-2 to SF-4 write (`key` = the hull for an expedition).

**SAVE v70, step 2** (appended to `MIGRATIONS[69]`, no v71): `withRunCountsV70` ALWAYS derives (frozen
`veteranRunCountsV70`): expeditions claimed = nextExpeditionId - 1 - runs out, any dispatch = veteran (training done);
patrols dispatched = nextPatrolSeed - 1 (at least 1 with a won route), completed = won routes over the frozen
`V70_PATROL_KEYS`, any = veteran. **A veteran reads ramp 1** (today's difficulty), so an old save plays exactly as now
(plan 3.4 "a veteran save reads f = 1"; SF-0's `old:v69` rule). A current-version state without the field (a dev save
from before SF-1) derives the same way at read time (`runCountsOf`).

**Goldens:** every SF-0 hash unchanged (default 59 + 12 and the gated 233, through `stateHash`). Whole-state hashes
captured before SF-1 now strip `runCounts` (no stored value changed): `withoutRunCounts` (firstRunsGoldens.fixture.ts)
in complementGoldens, fieldKitsGoldens, groundOpsAffixes / Clearing / Outcroppings / Risk / Legacy, officerBonuses,
officerStatFacets; wiringGoldens `hashState`; G2-0 `withoutG2State` (golden 1 unchanged; golden 2's claim through it).
relics.test and two save.test "plays byte-identically" comparisons expect the counter (the no-step load is handed the
derived counters).

For later slices: SF-2 stamps `difficulty` in buildExpedition via `runDifficultyAt` AND retires the 30-minute shakedown
(group 3 answer: a separate tutorial duration constant equal to the regular Tier I one; not done here, it moves the
shakedown goldens). SF-4 adds the patrol stamp and must leave the training cycle's route out of `patrol.completed`
(countPatrolRoutes). The shared speed / time-skip seam (group 2, Overtime) is not part of SF-1.

SF-1 review (2026-10-17): startExpedition now stores `runCountsOf(state)` (the counts before the dispatch), so a
state without stored counters (a dev save or fixture from before SF-1) is never reclassified as a veteran by its own
first dispatch (patrol dispatch and the claim already stored them). **Flag for SF-4 (the user's pacing call):** the
patrol curve counts WON ROUTES, so it fills after 9 of them, which a single Repeat session can fly in one sitting.
- **Veterans (2026-10-16):** "Full strength, as today (Recommended)": existing saves play as now; only new games ramp.

## SF-2 CARRY NOTE (2026-10-17, built on 7590156)

**What the training run is now.** `buildExpedition` writes `Expedition.difficulty` (runDifficultyAt) ONLY on the
training run (the first expedition from an explorer, SF3; a recalled one carries over, SF16): every other run stores
exactly the record it did (SF-3 stamps the ramped runs). The one read is enemyRanks.ts `isTrainingRun`, so FKR-1's
"no Elite or Boss on a training run" now sees the stamp. The profile, each read only on the stamp, no new draw on any
stream:
1. Guards (groundFight.ts): hazard read as 0 and gambit.ts `generateEncounter`'s new optional `EncounterProfile`
   (absent = today's guard): HP, power and heal x `FIRST_RUN_ENEMY_SCALE` 0.2, at most `FIRST_RUN_MAX_ENEMIES` 1 (the
   first enemy in role order). Every enemy Normal (FKR-1). Flora poison still applies.
2. No affixes (the roll is still made and dropped) and no ambush chance (groundOps.ts initGroundTasks).
3. Ship events fire and always pass (shipScanEvents.ts trainingShipEvent, SF8): debris and storm pass, a ghost passes
   with its bonus find, a probe or cloaked vessel is beaten off with its salvage (no battle fought), a boarding attempt
   is repelled. No pause, no hull wear, nothing taken.
4. The backstop (groundOps.ts trainingFellBack): a lost fight still clears its point; the crew comes home as from any
   loss (bay, a wiped team's recovery leg); no alert, no loss streak, no send-back, no helper skip; the step record
   carries `fellBack: true` and the log a `trainingFellBack` entry, worded by groundOpsLogText as "<objective>: The
   guards fell back. Training run: no setback." (`TRAINING_FELL_BACK_TEXT`).
5. Odds: groundThreat.ts groundTaskClearOdds reads Guaranteed on a training run (no samples, no memo entry), so the
   default plan, the recommendation and the launch forecast agree with the run.
6. Transit: the 30 minute shakedown is RETIRED (group 3). New runs store `shakedown: false`; the training run flies
   `TUTORIAL_TRANSIT_SECONDS` (= `TRANSIT_SECONDS` for now; the tutorial patch shortens it), every other run the
   regular one; a run in flight from before SF-2 keeps its stored shakedown and its 30 minute legs.
Gear wear is not built, so there is none to switch off (note for whoever builds it: skip it on the stamp).

**The proof.** `safeFirstExpedition.test.ts` (22 default tests, about 3 s): the stamp and the transit per explorer,
the freighter's ordinary first run, veterans, the legacy shakedown, the recall carry-over, each profile effect against
the same run without the stamp (never vacuous), the backstop with an unarmed crew and with a crew wiped every fight
(recovery legs), offline == live on that run (one call, 997 s chunks, 1 s steps around the first recovery leg, the
event-boundary chain), the Forecast-detail launch view against the run, and a fixed sample (3 fresh candidates x 3
explorers x 10 crews, 8 seeds x 3 explorers x 4 crews). `safeFirstExpedition.sweep.test.ts` (gated, `npm run
test:sweep:training` or SF_SWEEP; about 20 s): 500 Tier I seeds x Orion, Aurora, Eir x {D18 minimum, board 2 hires and
all 10 at window i mod 6, full rank 1, full rank 1 with a passive complement} = 7,500 runs, every one complete with
every objective done (71,595), no lost fight (77,760 won), no send-back, no stuck flag at any 10,000 s checkpoint, no
hull damage, no ship-event setback (20,130 passed), no boarding loss, claimed with the ship undamaged; 13,335 Vault or
Subterranean objectives among them. The fixed constants (0.2, 1) needed no tuning: the backstop never fired.

**Goldens.** Moved on purpose (SF-0 `firstRunsGoldens.test.ts`, the moves listed in its GOLDEN header): the 24
`first:*` rows (freighters: the regular transit; explorers: the training run, all 54 explorer rows now complete clean),
`first:parity`, `later:eir:real` and its line, and the 24 gated `lines:first:*`. Unchanged: everything else in SF-0
(`first:launch`, `guards`, `gather:*`, patrols, `old:v69`; `later:orion:*` through a fixture that marks the training
run done), FK-3, FKR-0, G2-0 goldens 1, 2 and 4, CP-0, WR-4 and every earlier gate. The pre-SF-2 dispatch is
reconstructed by awayTeamTestFixtures.ts `withoutSafeFirstRuns` / `asPreSafeFirstRunsDispatch` (no stamp, the
shakedown back on "expedition-1"), folded into `withoutRisk` / `withoutGroundOps` / `withoutAffixes` /
`withoutAffixCatalog` (a run from before those flags is from before SF-2 too) and applied explicitly in CP-0, WR-4,
G2-0 and FK-3. **The SF-0 section 2.5 B sweep stays the pre-SF-2 NOMINAL Tier I record** (dispatched as before SF-2),
the baseline SF-3's ramp is measured against, instead of becoming a second copy of the training proof. Behavior
tests that assumed the 1,800 s shakedown now wait the regular transit (clearing, launch preview, telescope, the sim
horizons); `asExpeditionVeteran` is the helper for nominal explorer play.

For later slices: SF-3 writes the stamp on ramped runs and generalizes groundFight.ts's training branch to
`runEnemyScale` / `runMaxEnemies` / `encounterHazard` (the hazard 0 and the backstop stay training only). SF-6 shows
the "Training run" chip from `isTrainingRun`, the run log (no UI renders `groundOpsLogText` yet), and the retired
"shakedown run" label in ExpeditionPanel.svelte (legacy in-flight runs only now). SF-4 adds the patrol stamp.

## USER ANSWERS (2026-10-21): SF-3 review

- **Weak and the ramp:** "Fade Weak + build SI gear (Recommended)": ordinary enemies x(0.7 + 0.3 x ramp) so Weak fades out
  smoothly (no run 7 to 8 jump; Weak's multiplier still acts), AND build the Quartermaster Standard-Issue member gear stats
  next (about +15% squad power in the sim meets both Tier I targets: 97% completion, 98% vault wins).
- **Run 10 to 11 cliff:** "Smooth the last steps (Recommended)": spread the final climb over runs 9 to 12 and let affixes
  and ambushes reach full strength one run later.

## SI GEAR CARRY NOTE (2026-10-21, built on 0dca5f2; goldens first in da7e6b5)

**What the Quartermaster's member set is now.** Every Standard-Issue member piece carries `points` stat points (model.ts
`STANDARD_ISSUE_MEMBER_GEAR`, 12, **[PROVISIONAL]**), split by slot role (`STANDARD_ISSUE_MEMBER_SHARES`): Pulse Rifle
power 6 + accuracy 6, Ballistic Weave armor 7 + HP 5, Med Kit HP 12, Flora Scanner organics yield 6 + fieldwork 6, the
three hidden Prospecting pieces their signature pairs 6 + 6. A full Security kit: +6% power, +2.4% accuracy, +17.5%
armor, +17% HP per member. Quality-less ordinary implicit lines, so every consumer reads them unchanged. Implants keep no
free floor (user: "Keep this as is."). **The Science Sidearm and Field Suit carry no lines [PROVISIONAL]:** every line
they roll is inert for Science until the D26 line swap (wiring SCIENCE_LINE_SWAP), and a free fieldwork line would out-do
the crafted Field Suits that roll none.
- **Held pieces:** `withStandardIssueMemberLines` is the mint's last step AND runs on every load (save.ts
  `withStandardIssueMemberLinesV70`, the withHomeworldV70 posture; no SAVE_VERSION move), so a piece issued before gains
  the lines, a re-load is a no-op, crafted / dev / ship pieces are untouched, and an in-flight run keeps its frozen roster.
- **Crafted stays above it [PROVISIONAL rule]:** crafted iLevel follows crafting level (iL 1 at level 1 = 2 points), so
  sizing alone could not keep crafted Tier 1 better. itemgen.ts `craftedItemLevelFloor` (derived from the points: iL 7,
  a 14 point weakest budget) floors member-gear crafts (Fabricator, inspect, preview, per-blueprint readout). Proved for
  every member variety and affix pick (siMemberGear.test.ts). Points 0 turns it off.
- **Wiring:** 13 `si:` entries (7 live through the gear seams on the real issued piece, 6 Prospecting deferred).

**Measured.** SF-3 ramp at full strength (temp merge of this branch onto 7c0b991, `rampRun` with the `rank1si` crew,
200 seeds): a full rank 1 Orion team in the set completes **193 of 200** runs (96.5%) and wins **356 of 365** Vault /
Subterranean objectives (97.5%); bare: 125 / 200 and 231 / 365. Runs 2 to 8: 200 / 200 with every vault won; run 9: 197
and 366 / 369; run 10: 194 and 361 / 368. SF-3's own sweep is unchanged (bare crews). Without SF-3 (`npm run
test:sweep:si`): SF-0 method 20 to 36 of 60 finished, vault 38 to 68 of 108; full strength 77 to 106 of 200, vault 144 to
211 of 365. The fade-Weak / smoothing change does not move the full-strength numbers (its factor is 1 at full ramp).
On merge: add a `rank1si` row to safeFirstRamp.sweep.test.ts (the fixture crew exists).

## SF-3 CARRY NOTE (2026-10-20, built on a678241; goldens first in 23448d2)

**What an ordinary run is now.** `buildExpedition` writes `Expedition.difficulty` on EVERY new expedition: the training
run's stamp (SF-2) or an ordinary one `{ version 1, firstRun false, ramp, tier }` (runDifficulty.ts `runDifficultyAt`;
read strictly by `rampedStampOf`, `runRampOf`). The training run is Tier I only now (SF6: a Tier II+ dispatch is never
the training run and reads full strength). The curve is SF-1's `rampFraction` (SF4 slow start: run 2 at 35%, run 6
about 54%, run 9 about 80%, full from run 11; completed runs only, training excluded); `rampEnemyScale` is exactly 1 at
full strength. What reads the ordinary stamp, no new draw on any stream:
1. Guards (groundFight.ts `taskFightGuard`): hazard `encounterHazard` (SF7 ceilings Tier I 0.1, Tier II 0.5, Tier III+
   raw; scans and the risk grade keep the raw hazard), the curve's strength as an `EncounterProfile` (no enemy cap; full
   strength reads no profile), and on the curve's LOW END every unled enemy is Weak (enemyRanks.ts `EARLY_CURVE_RANK`
   [PROVISIONAL], `curveBaseRank`: runs whose curve strength is at or below Weak's own x0.7, i.e. runs 2 to 7). Ranks
   multiply after the curve (field kits plan rule), so a run-2 ordinary enemy stands at 0.35 x 0.7; a placed lead
   (Elite / Boss / Strong) keeps its rank.
2. Affix roll chance x ramp (affixes.ts, required affixes always) and the ambush chance x ramp (groundOps.ts).
3. Ship events (shipScanEvents.ts): each check's FAIL chance x ramp (`rampedPassChance`), hull wear x ramp (none at the
   floor), the battle enemy at the curve's strength on the capped hazard.
4. Threat odds memo key appends `["curve", ramp, tier]` on stamped runs only.
Wiring: `expedition:ENEMY_RANKS:weak` (+ `:hp`) live (probe on an ordinary run at the curve's floor).

**Measured (gated `npm run test:sweep:ramp`, 200 seeds x 10 curve positions x {D18 minimum, full rank 1}).** Stall
count and lost fights never fall as the curve rises; the D18 minimum completes run 2 on 195 of 200. The plan's nominal
targets (rank 1 completes 95%, wins 90% of Vault / Subterranean at full strength) are REPORTED, not asserted: measured
125 / 200 and 231 / 365 (every hold a Challenging+ Vault or Subterranean final with its FKR-1 Elite / Boss lead); the
user's 2026-10-16 ruling makes comfortable nominal Tier I a full team in the Quartermaster's first set, whose stats are
not built yet. **Flag for the user:** the Weak low end ends in one step between run 7 (ordinary enemy 0.62 x 0.7 =
0.43) and run 8 (0.70 x 1): D18 Vault / Subterranean wins 182 to 0 and rank 1 lost fights 96 to 673 across that step.

**Goldens.** `rampGoldens.test.ts` (captured pre-SF-3 in 23448d2) re-pinned with every move named in its header;
`expeditionTiersGoldens` `display:launch` Level 8 of cand-0 and cand-2 (the forecast reads the gentler run). Every
other golden unchanged: fixtures strip the ordinary stamp with `withoutCurve` / `asPreCurveDispatch` (folded into
`withoutEnemyRanks` and `withoutFieldKits`, since a run from before FKR-1 is from before SF-3).

**Merged with feat at adb41c6 (2026-10-20).** One curve source: G1's short-range span share already reads
runDifficulty.ts `rampEnemyScale`; SF-3's Tier I training gate applies to EXPEDITIONS only, so a short-range template
keeps its training run at any tier (G1 plan: a Tier II slot's training run takes that tier's smallest roll). Goldens
captured before SF-3 strip the ordinary stamp at dispatch (`asPreCurveDispatch`, composed with `asPreG2NamesDispatch`
where both apply): groundOpsAffixes / Outcroppings / Risk, placeholderTalentGoldens, racialsGoldens, fieldKitsRun and
its goldens' switch-off row, voyageGoldens tier4 (`withoutCurve`). rampGoldens dispatches through
`asPreG2NamesDispatch` (no region, no voyage), as does the ramp sweep fixture, so the SF-3 pins and the measured table hold. Registry: Weak's two flips are held
apart by `SF3_SLICE` (shortRangeGoldens, every registryPin call, the ML-1 pattern) and `sf3` in emodGoldens `rowsBack`;
emodGoldens `registry` re-pinned 60d00075 to 9a8ecb9c (read back, 60d00075).

**SF-3 review applied (2026-10-21, user "Fade Weak" and "Smooth the last steps").**
- The curve (runDifficulty.ts `rampFraction`; G1's short-range share reads the same one): the SF4 ease-in unchanged to
  run 9 (`RAMP_EASE_SPAN` 9, `RAMP_EASE_UNTIL` 7), then even steps to full at run 12 (`N_FULL` 11). Enemy strength per
  run 2 to 12: 0.35, 0.37, 0.42, 0.48, 0.54, 0.62, 0.70, 0.80, 0.86, 0.93, 1.00 (no step after run 9 larger than the
  run 8 to 9 step). The affix roll and the ambush chance read the curve one run behind (`RAMP_ODDS_LAG` 1,
  `rampOddsFraction`, stored as `difficulty.oddsRamp` only where it differs from `ramp`): full from run 13. Ship-event
  checks and hull wear stay on the enemy curve.
- Weak fades: every unled enemy on an ordinary run takes `curveBaseFactor` = 0.7 + 0.3 x ramp (enemyRanks.ts; the
  ranks still multiply after the curve's strength), so an ordinary enemy stands at 0.25, 0.27, 0.31, 0.36, 0.43, 0.51,
  0.61, 0.72, 0.81, 0.90, 1.00 of nominal on runs 2 to 12. It is NAMED Weak while ramp is below
  `EARLY_CURVE_WEAK_UNTIL` 0.5 [PROVISIONAL] (the factor below the Weak / Normal midpoint: runs 2 to 7; run 8 sits at
  0.54, clear of the line, so no near-tie decides the name), Normal from run 8. Surprise and reinforcement fights are
  unled, so their enemies take the run's base too (REINFORCEMENT_RANK N5 = no lead, the run's base).
- Measured (`npm run test:sweep:ramp`, 200 seeds each; stalled runs, Vault / Subterranean won of held): D18 minimum run
  2: 5 stalled, 377 of 383; run 7: 175, 8 of 376; run 8: 176, 0; run 10: 184, 0; run 11 and 12: 187, 0. Full rank 1
  run 2: 0, 383 of 383; run 7: 0, 376 of 376; run 8: 0, 369 of 369; run 10: 6, 361 of 369; run 11: 19, 341 of 366; run
  12: 75, 231 of 365. The fixture `asExpeditionVeteran` keeps its pinned completed count 10 (a veteran reads full
  strength regardless). Goldens moved: rampGoldens c5 and c9 (named in its header), the default sample pins and the
  sweep table (re-measured, named in each file).

**Merged with feat at 900d613 (FKR-9 / FKR-10, kits switched on; 2026-10-21).** `asPreCurveDispatch` composes
`asPreFieldKitsDispatch` (a run before SF-3 was a run before the switch-on), and the ramp goldens and sweep fixture go
through `asPreG2NamesDispatch`, which composes it too, so every SF-3 pin and the measured sweep table are unchanged and
still comparable (kits off). With kits on, the SF-2 training proof sweep lost one fight for the D18 minimum crew on
seeds 42 and 336 of each explorer (the Field Kits enemy inflictors); per OC-1 ("no lost fights") a training run's
guards now skip `withFieldKitsGuard` (groundFight.ts), and the 500-seed proof passes again. Registry: SF3_SLICE beside
FKR9_SLICE, GW_SLICE and GG1_SLICE in every shortRangeGoldens registryPin call; emodGoldens reads back sf3 beside fkr9
and gw; `registry` re-pinned 1d8ae09b to bd1e2f48 (read back, 1d8ae09b).

## USER ANSWERS (2026-10-21): Standard-Issue member gear review

- **Crafted vs SI:** "Floor the stat budget (Recommended)": crafted member gear always rolls at least the free set's total
  and each signature line at least the free piece's value; item level, Archive score and salvage stay as they are (the
  builder's item level 7 floor is replaced).
- **Science gear (D26):** "Give them Science lines (Recommended)": Sidearm relic find + fieldwork; Field Suit fieldwork +
  hazard resist; drop armor and HP from the Hazard Suit's extra rolls per the review; old crafted pieces get dead lines
  remapped on load so nothing is useless.

## SI GEAR REVIEW CARRY NOTE (2026-10-21, on the merge of feat d553614)

**Built per the review answers above.**
- **Budget floor** (replaces the item level 7 floor, which is gone): model.ts `craftedMemberFloorImplicits`, applied by
  itemgen.ts `generateEquipment` to every crafted (blueprinted) member piece after its roll: each signature line at
  least the free piece's value of that variety, then the total (signature + rolled, carry lines excluded) at least the
  free set's 12, the shortfall spread over the signature lines. Item level, quality, rarity, affix picks and rng draws
  are untouched (Archive score, salvage time, keep-best ranking as before). `previewCraftOutcome` shows the floored
  range; the Crafting panel's per-tier and per-blueprint readouts are plain `computeItemLevel` again and agree.
- **D26 Science lines**: Sidearm `groundRelicFind` + `groundFieldwork`, Field Suit `groundFieldwork` +
  `groundHazardResist` (own signature lines and pools, the Prospecting tools' pattern); Hazard Suit pool hazard resist
  only. The 7 pending SCIENCE_LINE_SWAP entries and the Hazard Suit's two Prospecting ARM / HP lines retire (the lines no
  longer roll); 3 new Science entries are live with probes. Held pieces: save.ts `withStandardIssueMemberLinesV70` now
  also runs `withScienceLineSwap` (every load, idempotent), moving a pre-swap Sidearm's / Field Suit's combat lines
  points for points (`SCIENCE_LINE_REMAP` **[PROVISIONAL]**: power to fieldwork, accuracy and status chance to relic
  find, armor and HP to hazard resist). The Hazard Suit keeps old ARM / HP (Prospecting `digSafety` still reads them;
  **flag:** no new Prospecting gear rolls ARM / HP now, so dig safety has no gear source until the quests patch).
- **SI Science pieces**: Sidearm relic find 6 + fieldwork 6, Field Suit fieldwork 6 + hazard resist 6.
- **Quality**: `STANDARD_ISSUE_MEMBER_POINTS` is a plain const; the golden switch lives only in
  siMemberGearSwitch.fixture.ts (it empties the share table and restores the pre-swap varieties). The load raise only
  RAISES lines. The strict `isStandardIssueMemberPiece` (quality 0, item level 1, no rolled lines) keeps dev and test
  blueprint-less pieces out.
- **Sweeps**: safeFirstRamp.sweep.test.ts gains the `rank1si` row and asserts the targets on it. Full strength (run 12
  since the SF-3 review): 193 of 200 complete, 356 of 365 Vault / Subterranean won; run 11: 193 and 357 of 366; runs 2
  to 9 every run and every vault. The stale sim ablation expectation (homelandDefenseHub "dead") now reads "moves".
- **Goldens**: siMemberGearGoldens BEFORE re-captured on feat d553614 itself (identical to the switched-off reading),
  Sidearm and Field Suit crafts added; registry chains read the change back through siMemberGearRegistry.fixture.ts
  (added entries out, retired rows restored in place), so every earlier pin reproduces; gearWearGoldens' crafted-gear
  expedition is built with the pre-swap catalog (its Science member wears a Sidearm and Field Suit).

## SF-4 CARRY NOTE (2026-10-21, built on f85ef73; goldens first in 5c12275)

**What a patrol is now.** `dispatchCaptainOnPatrol` stamps `PatrolMissionState.difficulty` (runDifficulty.ts
`patrolDifficultyAt`: the run stamp plus `completed`, the won routes the cycle's ramp was read at) ONLY when it acts:
the save's one safe patrol (SF9: `patrol.dispatched === 0`, not a veteran) or a cycle below the top of the curve. Absent
= full strength, so a veteran, the top of the curve and every patrol in flight from before SF-4 store and fight exactly
what they did (no SAVE_VERSION move; save.ts note). One shared leaf, combat/patrolProfile.ts, is read by the live loop
(tick.ts freshPatrolMission / tickCaptainPatrol) AND the display replay and dispatch forecast (patrolReplay.ts
resolvePatrolWaves; App.svelte patrolForecastFor passes `patrolDifficultyAt(state)` and keys its memo on it):
1. The training cycle (SF10 "2 waves of 1 Raider"): the first `FIRST_PATROL_WAVES` 2 waves of its own schedule (never
   more than minWaves; the schedule draws unchanged), each ONE enemy of the route's lightest hull (`lightestPatrolHull`:
   the raider on both routes) at nominal strength. The backstop (OC-1): a lost wave breaks off (no defeat, no limp, no
   damage, the carry-state it was entered with goes on, no loot for it); the replay marks the wave `brokeOff`.
2. A ramped cycle (SF11 "Scale enemy stats"): the route's own waves and enemies, every enemy's hull, shields, recharge,
   weapon yields and drone HP / yields x `rampEnemyScale(ramp)` (one curve source; the SF-3 review's smoothed last steps
   come with `rampFraction`). The Weak fade and the affix / ambush lag are Ground Ops rules: a ship battle has no ranks,
   affixes or ambushes, so the enemy scale is the whole patrol curve.
3. The curve counts won routes minus the training cycle's (SF5): `tickCaptainPatrol` reports `curveRoutesCompleted`,
   which economyTick folds into `runCounts.patrol.completed` (lifetimeStats.missionsCompleted still counts every route).
   A Repeat relaunch reads the next position from the stored stamp alone (`nextPatrolCycleDifficulty`: the training
   cycle hands over the floor, each won cycle one step up, none stays none), so one call == many and a second captain's
   wins reach only the next dispatch.
No new draw and no new salt. The forecast reads Guaranteed on the safe patrol for every hull and route by construction.

**The proof.** `safeFirstPatrol.sweep.test.ts` (gated, `npm run test:sweep:patrol`, about 65 s): master seeds 0 to 999
x all 10 hulls x both routes x Dispatch Once and Repeat = 40,000 first patrols, every one the training cycle, won, no
defeat, no limp, no damage, its route off the curve, Repeat flying on at the floor; **the backstop never fired (0 lost
waves of 80,000)**, so the training enemy needs no scale. The curve table (200 seeds x 11 positions x 10 hulls x 2
routes): wins never rise as the curve climbs on any row, the top equals a veteran's (the SF-0 WINS table), pinned
(`CURVE_WINS`; e.g. the Runner's Warband 60 of 200 at the floor to 0 at full, the destroyer's 200 to 44).
`safeFirstPatrol.test.ts` (14 default tests): the rules, the profile against the same cycle without it, the backstop
with an unarmed Orion (every wave lost in the fight, broken off, won undamaged; its next patrol at the floor is lost),
offline == live (one call, 5 s chunks, 1 s steps) over a Repeat run through training and ramped cycles, the forecast,
a 1,000-patrol fixed sample.

**Goldens.** patrolRampGoldens.test.ts (captured before SF-4 in 5c12275) re-pinned with every move named in its header;
UNCHANGED: every `ramp:*:c10` and `veteran:*` row (full strength is the pre-SF-4 game). SF-0 firstRunsGoldens: the 10
`patrol:<hull>` rows, `patrol:repeat` and the gated `patrol:forecast` re-pinned (named in its GOLDEN header); the
200-seed WINS table now dispatches as a patrol veteran (the nominal record), the closed-form pair keeps a limping case
through a veteran; `gather:*`, `guards`, `old:v69` unchanged. Every other golden that dispatched a patrol from a fresh
save goes through awayTeamTestFixtures.ts `asPrePatrolCurveDispatch` (the pre-SF-4 dispatch: no stamp, the whole
schedule) and is byte-identical; patrol-balance.test.ts runs as `asPatrolVeteran` and keeps its numbers. simPlayer's
allAuto first Sweep is the training cycle now (shield left 732, was 279).

**For the user (open, flagged by SF-1):** the patrol curve steps per WON ROUTE, so one Dispatch Repeatedly session
climbs it in about ten routes (a Sweep route is 14 ticks: under three minutes of Repeat at the 1 s tick). The
alternative is one step per patrol run (dispatch to its end), a small change in `nextPatrolCycleDifficulty` and the
route count. Patrol cloak detection moved to 0.14.x (T3 ruling): not built here. SF-6 owns the "Training run" chip on
the patrol card and any `brokeOff` wording.

## USER ANSWERS (2026-10-21): SF-4 pacing

- Patrol ramp pacing: "One step per patrol run (Recommended)": each dispatched patrol (however many routes it repeats)
  is one curve step, so the ramp lasts about 10 patrol runs like expeditions; NOT one step per won route as first built.

## SF-4 MERGE NOTE (2026-10-21, the pacing answer built at the merge)

- **One step per patrol run:** `tickCaptainPatrol` reports `curveRunsCompleted`: a run counts ONCE, at its first won
  route (`routesCompletedThisRun` is still 0), unless it is the training cycle's; economyTick folds it with
  `countPatrolRuns` (was `countPatrolRoutes`). `nextPatrolCycleDifficulty` keeps a ramped cycle's stamp unchanged at a
  Repeat relaunch (the run's one position), and the training cycle still hands over the floor, so the training run's
  later routes fly where the next patrol starts and count nothing. A relaunch still reads the stored stamp alone, and the
  count reads stored per-run state, so one call == chunks == 1 s steps (tested in safeFirstPatrol.test.ts and
  runDifficulty.test.ts). A run lost on its first route counts nothing (SF5 "completed runs only").
- **Veterans:** the v70 migration's `patrol.completed` (won routes) is left as is: a veteran plays at full strength, so
  the number never moves a curve.
- **Goldens moved, named in each header:** SF-4's own (patrolRampGoldens `repeat:*`, firstRunsGoldens `patrol:repeat`);
  captainExplorerGoldens `patrol` (baseline, commandCrew2 / 3 / 5) and emodGoldens' 11 multi-route patrol rows move only
  through `runCounts.patrol.completed` in the hashed state (with the per-route count line restored every old value
  reproduced). racialsWired's Belter replenish test now dispatches as a patrol veteran (at the floor no drone is lost).
  `npm run test:sweep:patrol` green.

## USER ANSWERS (2026-10-27): SF-6 text (calls 12 and 13)

- **Call 12 first-run text:** "Approve as drafted (Recommended)": chip "Training run" with "Your first expedition cannot
  fail. From the next one on, the risk rises slowly." (patrol: "Your first patrol cannot fail. From the next one on,
  the risk rises slowly."); the gathering card: "First run: see how a mission works."
- **Call 13 heavy cruiser descriptions:** "Approve as drafted (Recommended)": the three SF-6 descriptions verbatim, shown
  on the Shipyard build card AND the ship detail header. (Check the Aurora line against the EM-7 OC-D13 fix, which made
  its description true: keep whichever text is true of the built hull and say so.)

## SF-5 + SF-6 CARRY NOTE (2026-10-27, built on 1567b4d)

**SF-5 (tests + doc, no engine change).** `safeFirstRunsContract.test.ts` (27 default tests, about 3 s): gathering, every
MISSIONS key x every hull that can fly it x three stop paths (delivered on Repeat, recalled half way, broke at the
relaunch) never ends in a defeat or hull damage, and the first-run marker `isFirstGatheringRun` (runDifficulty.ts,
DISPLAY ONLY: no MISSIONS key in `lifetimeStats.missionsCompleted` yet; patrol routes and `shortRange:` keys ignored)
is true on every tick before the save's first delivered cycle and false from it; the G1 contract against every live
template at Tier I and II (the stamp equals `runDifficultyAt`, the training run is keyed per template and is the
smallest roll, later runs read `rampFraction` through `runRamp`, the reach never shrinks as the curve climbs, other
templates keep their training run) plus the live loop delivering each template's training run with no defeat. Carry
note added to the E-CREW plan's G1 entry.

**SF-6 (display only).** Text verbatim in one module, `src/lib/trainingRunDisplay.ts` (call 12). The chip and its line:
the expedition dispatch card (the chip, its title the line; the Tier I training note now leads with the chip and the
line), the run view header (`isTrainingRun`), the patrol dispatch card and its Dispatch popup (`isFirstRun(state,
"patrol")`, the same stamp the Threat Assessment reads, so it reads Guaranteed); the gathering line on the Gathering
list and on the first run's in-progress card. The backstop's log line now shows on the ground timeline (a lost fight
with `fellBack` reads "fell back" and `TRAINING_FELL_BACK_TEXT`, not a held loss). Hull descriptions (call 13) on the
Shipyard build card and under the ship detail header, every hull; `trainingRunDisplay.test.ts` pins the approved text
and checks each explorer claim against the built hull. Help: the Risk Factors topic gains TRAINING RUNS AND RISING RISK
(every number from runDifficulty.ts; tested in helpTopics.test.ts), the Objective Difficulty topic points to it.
375 px checked (no sideways scroll; the glyph is the existing `check` SVG).

**For the user.** The Aurora's approved "the fastest cruise" is false fleet-wide (Aurora 1.3, the Runner 1.5): the
built text keeps OC-D13's true "of the explorer hulls" after it. Eir's "crew" is true of its away teams (8, the most);
its complement ties the other explorers'. The battleship's existing "The most armor, shields, and guns" now shows and
its "shields" is false (600; the explorers carry 700 to 800). No golden moved.
