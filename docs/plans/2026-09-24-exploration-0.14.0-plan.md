# 0.14.0 "Crew + Exploration" — EXPLORATION portion implementation plan

Status: DRAFT for user review 2026-09-24. Companion to the crew plan
(`2026-09-22-crew-0.14.0-plan.md`, crew portion BUILT + live). Design source: the saga design doc
`2026-09-15-exploration-crew-saga-0.14.0-design.md` Parts A/B/E/F/G/H/I (Part I is the definitive
exploration brainstorm). This plan covers the EXPLORATION half of 0.14.0; both halves ship together as
one massive patch on `feat/crew-0.14.0`, promoted only once both are done + QA'd.

## Scope (0.14.0 exploration half)
IN (per I.7 scope lock): the explorer hull + archetype power-grid tuning + deuterium-as-reach-crafting (the
fuel-to-reach MECHANIC itself already shipped in 0.13.6); sensors CONSUMERS (the item is already built,
dormant); BOTH exploration mission types (short/local planetary surveys + transport/supply missions AND
long-distance semi-idle EXPEDITIONS); ground teams + away-team gambit combat; relics -> discovery-gated
Research -> Museum; refugees -> facility crews + evacuation; the UNIVERSAL modules system (H.1, accessory
layer); the captain-identity set (C.6); and finishing the SUS 8-item roster (Part H, roles still to be NAMED
by the user).

OUT (explicitly 0.14.x, NOT 0.14.0, per I.7): the TRADING pillar, FLEET OPERATIONS (combat 2nd type),
ENDLESS mode, the PROSPECTING 2nd type, and online. The prestige-tree Trade/Fleet-Ops talents authored in the
crew plan stay honest GATEWAYS until those land. The 2.0 active-play overlay (Wizardry-homage dungeon crawl)
is far-future; 0.14.0 builds the idle vocabulary only (Part F).

## THE CROWN-JEWEL INVARIANT (non-negotiable, threads every phase)
Offline == live parity. Everything below MUST resolve deterministically on a tick from `gameTimeSeconds`
windows, NEVER `Date.now()` / `Math.random()` in a resolution path (seed via the existing `makeRng` /
mulberry32, window-accumulator pattern already used by transports + the salvage idle watch). The semi-idle
expedition is idle-COMPATIBLE precisely BECAUSE its battles AUTO-resolve via gambits (I.5, the LEAD STEER
that resolved the old Part D "away-team combat does not fit offline" flag). ACTIVE depth = the SETUP/CHOICE
points (array pick, ground-team build + gambit rules, which activities to run, whether to chart an anomaly);
IDLE execution = transit, scanning, auto-battles, task completion, all tick-resolved + offline-safe. Same
additive-neutral discipline as crew: no expedition in flight => the tick path is byte-identical to today.

## What already exists to build on (recon 2026-09-24)
- Missions are captain-dispatched: `MissionDef` + `MissionKind` (today `"extraction" | "patrol"`),
  `CaptainMissionState` / `PatrolMissionState`, resolved in `economyTick`; `effectiveMissionDef(base, ship)`
  folds ship stats (and now crew, via `effectiveShipStats`). Exploration ADDS mission kinds here.
- Headless combat sim lives in `src/lib/game/combat/` (Combat 1.0, deterministic, seeded). The away-team
  gambit resolver REUSES/extends this rather than inventing a 2nd battle engine.
- `archive.ts` = the enshrining system (blueprint Archive). Relics -> Museum extends this pattern (a new
  Archive-family tab for artifacts), not a from-scratch store.
- `sensorArrays.ts` (built, dormant) = the scanning-array catalog + pure readers; E2 is its first CONSUMER.
- `crewOverlay.ts` `effectiveShipStats` = the ONE seam crew folds through; exploration reads ship stats
  through it so crew (Science officer / Science division / sensors) shapes exploration by construction.
- `ShipSpec` has `"explorer"` already; NO explorer hull in `SHIP_TYPES` yet; `commandStructure` already has
  an explorer complement band waiting.
- ⚠️ CORRECTION (verified 2026-09-24): FUEL-TO-REACH ALREADY SHIPPED IN 0.13.6 (build plan
  `2026-09-16-fuel-to-reach-0.13.6-plan.md`, `fuel-to-reach.test.ts`). `canReach(mission, ship)` is the
  lightyear reach gate (parity with the old `fuelCapacity >= fuelNeeded`), and FUEL NO LONGER DEPLETES / never
  idles a captain (fuel is a range stat only). So the propulsion REWORK is DONE; the earlier E0 framing of it
  as unbuilt was stale. The old tank/refinery/Fuel-Depot/fuel-runway code still PHYSICALLY exists but is inert
  for dispatch (candidate cleanup, see opens). What 0.14.0 still owes on this axis is CONTENT + TUNING (A.6).

## Phased build order (each phase: pure/dormant first, gated, additive-neutral, own commit)

### Phase E0 — Explorer hull(s) + archetype power-grid tuning + deuterium-as-reach-crafting [FOUNDATION]
- ⚠️ Fuel-to-reach ITSELF is DONE (shipped 0.13.6; see the corrected recon note above). What 0.14.0 owes here
  is the CONTENT + TUNING that lean on the reach mechanic (design A.6), NOT the rework.
- Add the EXPLORER hull(s): high base sensors + high crew capacity + more `moduleSlots` as identity, with the
  "glass tank" frailty pole (Part B: huge shields/sensors, frail hull). Add its contrast pole. Wire into
  `SHIP_TYPES` (spec `"explorer"`, already valid) + the explorer complement band (already in commandStructure).
- Archetype POWER-GRID / mass-budget tuning (Part B.4 / A.3): reach trades against weapons/shields/cargo/
  sensors through the shared power+mass budget, so a distance-tuned hull sacrifices elsewhere. First-pass
  `fuelCapacity` / `engineEfficiency` / `transitSpeedMult` per hull archetype (the fuel stats are already
  flagged FIRST-PASS TUNABLE in SHIP_TYPES).
- DEUTERIUM's new role (A.4): the crafting INPUT for reach (build high-capacity drives / efficient engines /
  reactor cores), not a tank top-off. Mining deuterium stays meaningful as a build material.
- SAVE bump likely (new hulls). Gate + parity tests.

### Phase E1 — Sensors consumers + short/local exploration missions [idle tier, low risk]
- First CONSUMER of the built sensors stat + `sensorArrays.ts`. Wire the scalar `sensors` power (survey %/sec,
  detection) into a new idle mission kind.
- New `MissionKind`(s): `survey` (planetary surveys of KNOWN systems + local phenomena, mid-range) and a
  transport/supply kind (I.1: cost-in/reward-out — fill hold with bought/crafted supplies, deliver, reward =
  cost + margin; refugee/prisoner/supply variants). Reuse the mission framework (`MissionDef`,
  `CaptainMissionState`, `economyTick` resolution, `effectiveMissionDef`). Idle, like regular missions.
- Survey yield/find-quality scales off `effectiveShipStats` sensors (so Science crew shapes it). Deterministic.
- Gate + parity. This tier is the safe on-ramp before the expedition state machine.

### Phase E2 — Long-distance EXPEDITIONS [the big semi-idle core]
- New EXPEDITION state machine on `GameState` (its own record, not a `CaptainMissionState`): phases TRANSIT
  -> SCANNING -> ACTIVITIES -> RETURN, per I.2. Deterministic, resolved on `economyTick` from
  `gameTimeSeconds` windows (transport-style accumulator), fully offline-safe.
  - TRANSIT: long (~6 HRS IRL to first real target; INAUGURAL shakedown shorter). Mid-transit CHANCE to CHART
    AN ANOMALY (adds time, gives a bonus) = a seeded roll at a window boundary.
  - SCANNING: % scanned per window via the chosen SCANNING ARRAY (`sensorArrays.ts` variant: Wide/Focused/
    Balanced shape cadence/coverage + landmark/underground-PoI odds). Discovers LANDMARKS / PoIs (seeded).
  - MULTI-BODY SYSTEMS: 1-3 planets + satellites; scan each area of each body; bigger=longer, hazardous=harder;
    planet TYPE gates discoveries/activities.
  - ACTIVITIES: at 100% scan, a LIST of ground-team tasks based on planet type + discoveries (resolved by E3).
- Sci-fi system names already banked (Part E: Kepler's Reach, Tycho Verge, Cygnus Gate, ...).
- SETUP/CHOICE points surface in UI (array pick, activity selection, anomaly-chart opt-in); execution ticks.
- SAVE bump. Heavy parity + determinism tests (one-big-window vs stepped must match, like the crew parity test).

#### E2b — Planet types + PoI catalog (CONTENT LAYER, LOCKED 2026-09-30 from the approved Expedition Console mockup)
The E2a engine shipped with a GENERIC body model (a scan size, a random hazard, generic landmark/underground
discovery tokens). E2b makes discoveries REAL + TYPE-GATED, as pure data + readers in `src/lib/game/expeditionContent.ts`
(the same DATA-only posture as `sensorArrays.ts`; imports the `ExpeditionPlanetType` union from `model.ts`,
no cycle). NO UI (that is E2c). Names + which PoIs are eligible on which planet types are LOCKED user calls;
all weights/biases/hazard scalars are FIRST-PASS TUNABLE.

**PLANET TYPES (8)** — each gates which discoveries appear + their per-pool odds (via a `surfaceBias` /
`undergroundBias` added to the sensor array's own bias in the discovery roll) and carries a HAZARD tier ->
scalar (feeds the E2a scan-rate hazard penalty + later ground difficulty). A body's `planetType` is assigned
at system generation (seeded, FIRST-PASS uniform over the 8) and stamps the body's `hazard`.

| # | id | Label | Hazard tier | Notes |
|---|----|-------|-------------|-------|
| 1 | `terrestrial` | Terrestrial | LOW | balanced finds (ruins, outposts, mixed minerals) |
| 2 | `ocean` | Ocean | MEDIUM | xeno-flora, biotech samples, sunken structures; surface work slower |
| 3 | `arid` | Arid | LOW-MEDIUM | buried ruins + preserved tech; strong UNDERGROUND-PoI odds |
| 4 | `volcanic` | Volcanic | HIGH | rare/exotic minerals, few structures |
| 5 | `frozen` | Frozen | MEDIUM | preserved relics + crashed ships, best relic-survival odds |
| 6 | `gasGiant` | Gas Giant | LOW (orbital) | NO LANDING: orbital scan only; SATELLITES host the ground activities |
| 7 | `barren` | Barren | LOW | straightforward mining, few discoveries |
| 8 | `toxic` | Toxic | VERY HIGH | exotic compounds + strange life, needs a hardened team |

Hazard tier scalars (TUNABLE): low 0.1, lowMedium 0.25, medium 0.4, high 0.65, veryHigh 0.9.

**POINTS OF INTEREST (9)** — two pools; the sensor array bias (`sensorArrays.ts`: Wide-Beam favors surface,
Focused-Beam favors underground) + the planet type's own pool bias together skew which pool discovery rolls
draw from. Each PoI declares a per-planet-type eligibility/WEIGHT map (absent => not eligible on that type);
the weighted pick within a pool draws from the type's eligible set.

- SURFACE (Wide-Beam favors): `ancientRuins` Ancient Ruins (dig-site; relic lead), `crashedShip` Crashed Ship
  (salvage + intact tech/log), `xenoFloraBloom` Xeno-Flora Bloom (science sampling; biotech/research),
  `mineralOutcrop` Mineral Outcrop (rare/exotic material, planet-type flavored), `derelictOutpost` Derelict
  Outpost (supplies/data; fight risk).
- UNDERGROUND (Focused-Beam favors): `caveNetwork` Cave Network (branching; deposits/dens — the universal
  underground find, eligible on every type), `buriedVault` Buried Vault (sealed cache; high relic odds behind
  a fight), `subterraneanCivilization` Subterranean Civilization (the big relic prize; needs an exploration
  build), `geothermalChamber` Geothermal Chamber (energy/exotic-compound; volcanic-flavored).

**Gas Giant orbital-only handling:** kept simple + faithful. `orbitalOnly: true` is a flag the E2c UI reads to
flavor a gas-giant body's finds/activities as SATELLITE OPS (no surface landing). The engine still generates
discoveries + one activity per discovery for a gas-giant body from its eligible pool, so it yields activities
like any body.

**Engine wiring (`expedition.ts`):** `ExpeditionBody` gains persisted `planetType`; `ExpeditionDiscovery` +
`ExpeditionActivity` gain a `poiId`. The SCANNING discovery roll now draws from `poisForPlanetType(body.planetType)`,
weighted, with per-pool odds = base + planet-type pool bias + snapshotted array pool bias, keeping the E2a
`makeRng(seed ^ salt ^ index)` keyed determinism (the extra weighted-pick draws come from that same keyed
stream). Determinism / closed-form parity (one-big == many-small) / additive-neutrality (no active expedition
=> same-ref, byte-identical tick) are all preserved — the catalog is static data on no non-expedition path.

**SAVE:** `SAVE_VERSION` 59 -> 60; MIGRATIONS[59] backfills `planetType: "terrestrial"` onto any in-flight
expedition body that predates the field (v59 is branch-only, but a mid-branch v59 save could hold an
expedition without it). A fresh / expedition-free save is unaffected.

### Phase E3 — Ground teams + away-team GAMBIT combat [interleaves with E2 activities]
- Ground teams = 2 roles (I.4/I.7): SCIENCE (find relics) + SECURITY (protect / fight). Per-team Armor/Weapon/
  Tool gear (shared shape with the future Landing Party / Invasion). One task at a time per ship; higher-tier
  ships carry multiple teams -> multiple simultaneous tasks (I.2 step 9).
- BATTLES AUTO-RESOLVE via GAMBITS (Security fights, Science takes cover): a deterministic resolver that
  REUSES/extends `src/lib/game/combat/`. WIN -> continue; LOSE -> evacuate + restart the task; you always win
  SOMETHING, the goal is a RELIC (I.2 step 7). Offline-safe by construction (no live manual session in 0.14.0;
  the manual/active version is the 2.0 overlay).
- Task completion -> enemy drops + random-event drops + a "treasure chest" / EXPEDITIONARY FINDINGS with a
  CHANCE of a RELIC (rarities) — REUSE the salvage loot-roll machinery for the tiered rarity roll.
- E2 ships its activity resolver against this; sequence E3 to land with E2's activity phase (or E2 activities
  ship against a placeholder resolver, E3 swaps in the real gambit combat). [E2 shipped the placeholder resolver
  at `resolveActivitiesPhase` in expedition.ts; E3 swaps in the real engine there, record shape unchanged.]

#### E3 GAMBIT DESIGN — FULL FFXII DEPTH (user, 2026-09-30) [LOCKED direction]
The user wants the COMPLETE FFXII gambit system, not a trimmed preset: fully customizable, and LOAD-BEARING
(harder missions spell "certain death" without proper gambits). The MODEL ships FFXII-grade in 0.14.0; the
exhaustive CONTENT library grows through the balance pass (same first-pass-then-flood posture as every 0.14.0
phase). Ties [[SUGGESTIONS: gambits-everywhere]] (the eventual auto-vs-gambit layer on ship combat too) - so
build the interpreter GENERALIZABLE, not hard-wired to ground combat.
- RULE = `[TARGET] + [ACTION]`, evaluated top-down, FIRST MATCH fires, per member, per round (FFXII's exact
  structure). The TARGET carries the condition.
- TARGET SELECTORS (the tactical heart, user's examples baked in): Foe nearest/farthest; Foe HIGHEST HP
  ("punch the biggest guy to establish dominance"); Foe LOWEST HP (finish the wounded); Foe HIGHEST THREAT
  ("take down the biggest damage threat first"); Foe IS HEALER/SUPPORT ("target the healer"); Foe IS
  CASTER/ranged; Foe HAS STATUS = X; Foe in the LARGEST GROUP / most-numerous type (multi-group encounters);
  Ally HP < X% (GRANULAR, configurable threshold); Ally HAS STATUS = X; Ally/Self any/lowest-HP; Self HP < X%
  / has status = X.
- NON-TARGET CONDITIONS: opening round; outnumbered; enemy group count >= N; a skill/item is available; the
  objective is in reach.
- STATUS / AFFLICTIONS (propose + name a first-pass set; the "if afflicted, a designated member cures it"
  loop): debuffs e.g. Poison/Bleed (DoT), Stun/Concussed (skip), Burn, Weakened (dmg down), Suppressed (acc
  down), Fear (may fall back), Corroded (armor down); buffs e.g. Shielded, Inspired. A CURE clears specific
  statuses. This is what makes "Ally has status = Poison -> Cleanse" gambits matter.
- ACTIONS: SECURITY = Attack (per selector) / Suppress / Taunt (force enemy focus, "establish dominance") /
  Execute (bonus vs low HP) / Brace. SCIENCE = Cure/Cleanse (the designated curer) / Aid-Heal / Shield ally /
  Analyze (reveal enemy role/weakness) / Secure objective / Take cover. BOTH = Use Item (a team-kit consumable
  cure/stim, "use a skill OR an item to cure it") / Fall back / Hold.
- ENEMY ROLES so targeting decisions are load-bearing: Bruiser (biggest/tank), Striker (highest damage
  threat), Healer/Support (heals enemies - "target the healer"), Caster (applies afflictions), Swarm (many
  weak). Hard encounters MIX roles + sling afflictions so a naive rule list loses.
- PRESETS (flavorful, user-seeded, the accessible on-ramp + the seed of the eventual auto-vs-gambit split):
  "Establish Dominance", "President of the Turtle Club", "Decapitate" (healer then striker), "Triage"
  (cure/heal priority), "Balanced", "Relic Rush", plus Custom.
- ⚠️ SCOPE NOTE: FFXII depth = the COMBINATORIAL model (target x condition x action x status), NOT a huge flat
  list, so 0.14.0 ships the full model + a first-pass content set deep enough to make hard missions demand
  smart gambits; the exhaustive affliction/skill/enemy-role library is balance-pass content. Interpreter stays
  deterministic + offline-safe + generalizable (ship combat adopts it later).

### Phase E4 — Relics -> discovery-gated Research -> Museum [extends archive.ts]
- RELICS are UNIDENTIFIED when found (like crafting BLANKS): the RESEARCH facility STUDIES a relic to reveal
  it (reuse the blanks/inspect + queue pattern), then you give it to the MUSEUM = a new Archive-family tab
  (extends `archive.ts`).
- Giving a relic grants its BONUS; a relic SET grants a set bonus; a relic's bonus GROWS as you give more (the
  logged relic system). Discovery-gated Research (Part E, SUGGESTIONS ~108): discovery-prerequisite research,
  some resource sourcing (deuterium/rare) as exploration rewards (the surviving piece of the old auto-mining).
- SAVE bump (relic inventory + museum state). Gate.

### Phase E5 — Refugees -> facility crews + evacuation [ties E1 transport + crew]
- The evacuation -> refugees -> facility-crews loop (C.3): a transport/supply mission variant (E1) carries
  refugees; delivering them staffs facility crews. Ties the exploration transport loop back into the crew +
  homeworld systems. Gate.

### Phase E-MOD — Universal modules system (H.1) [0.14.0-core, parallel track]
- The ACCESSORY layer on hulls' generic `moduleSlots` (already an inert count on `ShipTypeDef`; explorer/
  science hulls carry more as identity). DISTINCT from the crew bridge/quarters modules (built) and from SUS.
- Categories: Passive / Proc (idle-friendly auto-fire: on-hit / per-tick / on-mission-complete) / Conditional /
  Active (idle-safe AUTO-cast via a gambit-like rule; MANUAL reserved for 2.0) / Set. Draw = UNIQUE procs/
  actives you cannot get elsewhere; NO baked-in downsides (chaotic gear H.2 is future).
- Sourcing = BOTH craftable (quality/rarity/iLevel) AND salvage-precursor-EXCLUSIVE (salvage -> precursor item
  -> REPAIR -> chance at an exclusive module; extends the Damaged-Reactor-Housing precedent + salvage system).
- Follows the same slot-activation pattern as the crew modules (Phase 1b) + sensors. Gate + additive-neutral.

### Phase E-CAP — Captain identity set (C.6) [rides in 0.14.0]
- Structured names + an earned RANK PREFIX, per-captain portrait-border color-coding, earned medals/ranks/
  surname unlocks driven by a NEW PERSONNEL achievement tier. Own sub-slice; wires to the crew/officer +
  promotion systems (the objective-gated promotion from the crew UI review). Gate.

### Phase E-SUS — Finish the SUS 8-item roster (Part H) [OPEN: roles need naming]
- Today `specUtility` ships ONE family (Prospecting Rig). Build the other 8 (9 total): focused, specialized
  items each tuned to a specific activity/build (drilled-in, NOT generalized), the way the Prospecting Rig is
  tuned for mining. ⚠️ OPEN: the user must NAME the 8 roles (do not invent the set); hull-class-gated vs
  per-item; how they map to the Explorer/crew roles. BLOCKED on that input.

## Review + merge (per the standing workflow)
Two-stage subagent review (Fable bug-check, then Opus full-ledger fix) after the build phases, a holistic
review, then confirm-then-push. Deploy to staging only via `git push origin <branch>:staging`; promotion to
main is the user's call with the pre-flight `git log main ^branch` check. 0.14.0 promotes only once crew +
exploration are BOTH done + QA'd (delta + full QA sheet, standing format).

## OPEN items for the user (before / during build)
1. Vestigial fuel-economy cleanup: fuel-to-reach (0.13.6) left the old tank / refinery pipelines / Fuel Depot /
   fuel-runway projection PHYSICALLY present but inert for dispatch. Decide whether 0.14.0 removes them (A.2's
   "net deletion of complexity") or leaves them, and repoint deuterium mining to the reach-crafting-input role
   (A.4). NOT the blocker E0 once looked like: the rework already shipped. (The [[project_fuel_runway_measured_locked]]
   memory predates fuel-to-reach; verify whether fuel-runway is now dead code before touching it.)
2. E-SUS: NAME the 8 SUS item roles (blocked until then).
3. Phase ORDERING: E0 (explorer hull + tuning) first, or the idle tier (E1) first to de-risk the mission-kind
   plumbing? (Part G proposed the propulsion/hull work first; open to reorder.)
4. Expedition tuning: transit lengths, scan rates, anomaly-chart odds, discovery/relic rarity curves, multi-
   body counts — all balancing-patch material; first-pass in each owning phase.
5. Away-team gambit ruleset depth: how much gambit configurability in 0.14.0 vs deferred to the 2.0 active mode.
6. Does the captain-identity set (E-CAP) or modules (E-MOD) want to land earlier (they improve the current game
   independent of exploration content)?

## E1 design decisions (user 2026-09-25)
- SURVEY missions REWARD (E1a): rare/exotic MATERIALS + credits + XP, SENSOR-SCALED, using the existing item
  economy. NO new currency/entity. The richer discovery->research->relic rewards layer on in E4; surveys give
  tangible payoff now. This makes the built-but-dormant sensor item + the explorer/Aurora hull matter (the
  FIRST live consumer of the `sensors` stat).
- SCOPE: SURVEY (E1a) first, then TRANSPORT/supply (E1b). Transport = cost-in/reward-out credit economy,
  cargo-scaled (Eir + Operations crew shine); refugee variant ties E5 (deferred).
- E1a mechanic: fold the `sensors` stat LIVE (equipmentStatMods currently skips it like materialQualityChance)
  into an additive ShipDerivedStats.sensors; survey missions reuse the extraction transit/scan/return
  framework with a mission-type flag, drop rare/exotic materials, and scale yield by the ship's sensors.
  Explorer-hull BASE sensors + Science-crew sensor amplification stay deferred (I.6); a bare ship reads
  sensors 0 -> no survey bonus (additive-neutral for non-sensor ships).
