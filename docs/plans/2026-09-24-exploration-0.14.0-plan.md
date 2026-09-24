# 0.14.0 "Crew + Exploration" — EXPLORATION portion implementation plan

Status: DRAFT for user review 2026-09-24. Companion to the crew plan
(`2026-09-22-crew-0.14.0-plan.md`, crew portion BUILT + live). Design source: the saga design doc
`2026-09-15-exploration-crew-saga-0.14.0-design.md` Parts A/B/E/F/G/H/I (Part I is the definitive
exploration brainstorm). This plan covers the EXPLORATION half of 0.14.0; both halves ship together as
one massive patch on `feat/crew-0.14.0`, promoted only once both are done + QA'd.

## Scope (0.14.0 exploration half)
IN (per I.7 scope lock): fuel-to-reach + explorer hull; sensors CONSUMERS (the item is already built,
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
  an explorer complement band waiting. Fuel is still per-trip (`fuelCapacity` vs `fuelNeeded`); the
  fuel-to-reach rework is NOT built.

## Phased build order (each phase: pure/dormant first, gated, additive-neutral, own commit)

### Phase E0 — Fuel-to-Reach rework + the Explorer hull [FOUNDATION, needs a design sub-pass]
- Fuel becomes REACH/RANGE (Part A: "conventional FTL takes decades unless purpose-built" made mechanical):
  distance is the gate, the explorer hull is the answer. This reworks the per-trip `fuelNeeded` consumption
  model into a reach/range capability. ⚠️ BIG ECONOMY CHANGE + interacts with the LOCKED fuel-runway system
  ([[project_fuel_runway_measured_locked]], measured-EMA projection): E0 must either preserve fuel-runway's
  contract or consciously supersede it WITH THE USER. FLAG: E0 gets a short design sub-pass + user confirm
  before build (Part A holds the reach model; verify it against the live fuel economy first).
- Add the EXPLORER hull(s): high base sensors + high crew capacity + more `moduleSlots` as identity, with the
  "glass tank" frailty pole (Part B: huge shields/sensors, frail hull). Add its contrast pole. Wire into
  `SHIP_TYPES` (spec `"explorer"`, already valid) + the explorer complement band (already in commandStructure).
- SAVE bump likely (reach fields). Gate + parity tests.

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
  ship against a placeholder resolver, E3 swaps in the real gambit combat).

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
1. E0 fuel-to-reach: confirm the reach model (Part A) vs the LOCKED fuel-runway system — supersede or preserve?
   (A short design sub-pass with the user before E0 builds.)
2. E-SUS: NAME the 8 SUS item roles (blocked until then).
3. Phase ORDERING: is E0 (fuel-to-reach) really first, or does the idle tier (E1) come first to de-risk? (Part
   G proposed fuel-to-reach first; open to reorder.)
4. Expedition tuning: transit lengths, scan rates, anomaly-chart odds, discovery/relic rarity curves, multi-
   body counts — all balancing-patch material; first-pass in each owning phase.
5. Away-team gambit ruleset depth: how much gambit configurability in 0.14.0 vs deferred to the 2.0 active mode.
6. Does the captain-identity set (E-CAP) or modules (E-MOD) want to land earlier (they improve the current game
   independent of exploration content)?
