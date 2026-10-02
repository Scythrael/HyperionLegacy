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

#### ⭐ THE AWAY TEAM ROSTER: the INTENDED plan for exploration ground teams (user-confirmed 2026-10-01)
⚠️ This was the plan all along but was never written into this doc (see the record below). It is now the
authoritative model for ground teams, and the E3 build DEVIATES from it until reworked.
- **A DEDICATED AWAY-TEAM ROSTER PER SHIP**: persistent, NAMED members, stored like Senior Staff officers
  (small + bounded, so the crew Complement's bucket model is untouched). Two squads with distinct jobs
  (2026-10-01 split): the **SECURITY DETAIL fights** (Contact phase, Security-only gambit battles, in-fight
  curing via medic skills + kit items) and the **SCIENCE PARTY does the fieldwork** (excavate / sample /
  decrypt; drives speed, haul, relic odds).
- **EACH MEMBER IS OUTFITTED**: **Armor / Weapon / Tool** gear slots + **cybernetic IMPLANT** slots. Implants
  equip to INDIVIDUAL members, not squads. Security implants = combat; Science implants = fieldwork.
  UNIQUE-EQUIPPED implants (Neural Backup) = ONE in the entire fleet.
- **Base strength still flows from the crew** (the ship's Security / Science divisions + the matching
  officers); gear and implants layer on top.
- **ONE shared loadout family:** this roster + loadout system is the same mechanic the older notes call for
  across Landing Party missions, Away Missions, and Battlespace Invasion ground troops ("build the
  equipment slots ONCE and reuse"), so design it to be reused, not exploration-only.
- **Source notes this consolidates** (SUGGESTIONS): "Landing Party missions" (2026-07-07: "item/equipment
  slots for the boarding party, a loadout system, not just picking which captain/crew go"), "Away Missions"
  (2026-07-16: crew fill away-mission slots; build the loadout ONCE across Away Missions / Landing Party /
  Invasion), the "Ground combat" entry (ground characters with offense/defense/debuff specs), and the
  2026-07-09 cybernetics entry (implants on individuals).
- **WHAT THE CODE DOES TODAY (the deviation to fix):** `buildTeamCombatants` (gambit.ts) MINTS anonymous
  members fresh for every battle from crew strength (ids like `<prefix>-sec-0`), with no persistence, no
  gear, no slots. E3 (2026-09-30) chose "derive from crew" and DEFERRED the gear layer because these notes
  were not cross-checked before that build. Rework: members come from the persistent roster.
- **E-CREW DESIGN ANSWERS (user, 2026-10-02):**
  - GEAR MODEL = EVERYTHING PER MEMBER (Armor + Weapon + Tool + implants on each named member), superseding the
    2026-09-17 per-team slot counts. The management load is answered by **ARMORY LOADOUTS for the Security and
    Science teams** ("already a plan as well", SUGGESTIONS :1736-1745), so a squad's whole kit is saved/applied
    in one action, mirroring ship loadouts.
  - RECRUITMENT = LIKE SENIOR STAFF (confirms the 2026-09-17 note): an hourly-refresh candidate roster (name,
    race, squad specialty, rolled traits); hire into a ship's squad, fire to free the spot.
  - SQUAD SIZE = PER SHIP TYPE, members of 3 or 4 per squad ("each ship type has different team sizes").
  - A THIRD GROUND TEAM TYPE, **PROSPECTING** (user-named): "at least the wiring to account for it". The team
    type must be a data-driven list, not a Security/Science binary. Whether Prospecting gets live content in
    0.14.0 is still open.
  - A DOWNED MEMBER IS INJURED AND RECOVERS (recovery timer, Medical shortens it; gear + implants stay on), "but
    we will have the same kind of difficulty toggles that ship combat has with SAFETY INTERLOCKS". Interlocks
    are the planned (NOT yet built) opt-in endgame risk axis (SUGGESTIONS :1349 + :1416 reward philosophy:
    permadeath only by informed, opt-in choice; gatekeep flex, never power). 0.14.0: injury-only, with the
    member-fall path built so a future interlock can add a permadeath chance that shares the ship-combat
    interlock design.
  - PROGRESSION = "rankings similar to crew complement" (user LEANING, "not 100% sure ... but I think this would
    be best"). Complement rank (crewRank.ts) is ROLLED AT GENERATION on the 8-tier ladder (Crewman ... Lt
    Commander), never levels, gates trait COUNT and nudges magnitude; you improve by recruiting better. Applied
    here: a candidate's rank is rolled on the hourly roster, so chasing a high-rank recruit is the growth loop
    (pairs with fire-and-rehire). Revisit before the build plan locks.
  - IMPLANT SLOTS = 1 per member by default; a 2nd slot via RACE AFFINITY (certain races integrate cybernetics
    better), "for now". ⚠️ User concern to carry into the balance pass: "ensure that we're not inadvertently
    creating a meta" (always-hire-race-X). Which races get affinity = a proposal in the mockup, not decided.
  - PROSPECTING TEAM = WIRING ONLY in 0.14.0 (in the team-type list + gear compatibility; no ship fields one, no
    activity uses it yet).
  - OFFICERS ARE EXEMPT from the "crew never double-dips weapons/shields" rule (rule stays Complement-only).
    User: "The bridge officers can double-dip across all possible options ... you'll have officers for combat
    vessels, prospecting vessels, and science." So EVERY dormant officer bonus (S4-CP12) gets a live consumer,
    incl. Tactical weapon/shield effectiveness.
  - HOSTILITY = RANDOM ENCOUNTERS DURING SCAN PROGRESS: "Fights will randomly happen as you're progressing
    through scans. Basically a random chance." (RPG random-battle model, not a per-site contact phase.) The
    Security-tool encounter-rate dial (2026-09-17) scales that chance up or down.
  - MOCKUP "Crew Made Real" (https://claude.ai/artifact/UYTkL2q9PyDHKGbeERcvuj) APPROVED by the user
    ("delightful"). Section 12 answers: (a) the 1,017-crew flagship is a LATER HULL TIER (3rd or 4th; "each
    tier is" a class generation, Constitution vs Galaxy), not this pass; (b) craft-duplicate crew buff HELD
    (FA talent or future homeworld staffing; stop it rolling on ship crew); (c) OFFICER STATS ARE IN:
    Strength / Integrity / Cunning / Constitution on Senior Staff. User direction: senior staff are HEADS OF
    THEIR DEPARTMENTS, so their stats shape the SHIP's and the ON-SHIP CREW's operations (e.g. high Integrity
    = bravery: the security crew "more apt to act bravely in the face of death", boarding party
    effectiveness). Officer stats do NOT touch ground-team stats on a planet.
  - OFFICER STAT MODEL = "EACH STAT IS ONE FACET" of the department the officer HEADS (user pick 2026-10-02):
    Tactical heads Security, Science heads Science, Medical heads Medical, Engineering heads Engineering,
    Operations heads Operations, Pilot heads Flight Deck; the XO touches every department at a smaller share.
    STRENGTH = how hard the department works (scales its complement buffs). INTEGRITY = bravery, holds when it
    counts (boarding defense + boarding party, steadiness when the hull is low, crew losses under fire).
    CUNNING = finds the edge (chance the department over-delivers). CONSTITUTION = endurance (long expeditions
    + patrols, recovery between deployments). ⚠️ NO DEAD STATS: crew losses, fatigue and boarding do not exist
    yet, so each facet needs a LIVE 0.14.0 consumer (positive-framed, no new punishment); the boarding /
    crew-loss parts light up when those systems land.
- **OPEN for the design pass (mockup first):** how members are recruited (a candidate roster like officers?
  drawn from crew?), members per squad, gear catalog + crafting, slot counts, member progression, and what
  happens when a member falls (injury vs permanent loss).

### Phase E4 — Relics -> discovery-gated Research -> Museum [extends archive.ts]
- RELICS are UNIDENTIFIED when found (like crafting BLANKS): the RESEARCH facility STUDIES a relic to reveal
  it (reuse the blanks/inspect + queue pattern), then you give it to the MUSEUM = a new Archive-family tab
  (extends `archive.ts`).
- Giving a relic grants its BONUS; a relic SET grants a set bonus; a relic's bonus GROWS as you give more (the
  logged relic system). Discovery-gated Research (Part E, SUGGESTIONS ~108): discovery-prerequisite research,
  some resource sourcing (deuterium/rare) as exploration rewards (the surviving piece of the old auto-mining).
- SAVE bump (relic inventory + museum state). Gate.

#### E4 DECISIONS (user + source recon, 2026-10-01)
- ⚠️ **FOUNDATION GAP (fix first):** `claimExpedition` currently deposits NOTHING. It removes the expedition
  and returns the findings; `doClaimExpedition` only logs a count, so every material/credit/relic an
  expedition earns is discarded on Claim (the deposit was deliberately deferred to E4; 0.14.0 unreleased, so
  no player impact). E4 starts by making Claim DEPOSIT: materials via `addToInventory` (the discovery seam,
  NOT raw addItemQuality, per the 0.13.8 invisible-exotic hotfix), credits, and relics into a relic store.
- **RELICS + ARTIFACTS ARE COMBINED (user, 2026-10-01).** The 2026-07-29 SUGGESTIONS notes defined TWO
  distinct collectibles (UNKNOWN RELICS from long-range exploration = research-to-unlock, not accumulation;
  ARTIFACTS from archaeological surveys = per-copy stacking passive + nested K-piece "Relic Bonus" sets
  leveling on a doubling copy ladder with the least-collected BOTTLENECK rule). For 0.14.0 the user confirmed
  these are ONE combined system (the plan's merged wording above was intentional). Working interpretation =
  the UNION, nothing dropped: expedition relics arrive UNIDENTIFIED -> Research studies one to reveal WHICH
  relic it is -> a FIRST-FIND of a relic type is the unknown-relic DISCOVERY UNLOCK (e.g. a discovery-gated
  research project / powerful bonus) -> every copy goes to the MUSEUM for the artifact layers (per-copy
  passive + K-piece set tiers leveling on the doubling ladder, bottlenecked by the least-collected relic).
  Relic SETS + roster + bonuses + unlocks are NEW ENTITIES: proposed via mockup for user approval, not
  invented. Leveling curve first-pass from the user's own example (10/20/40/80/160 copies, +0.005/level
  additive), still the open "PIN AT DESIGN TIME" from the notes, so TUNABLE.
- **E4d FIRST-FIND UNLOCKS, revised with the user (2026-10-01).** A 4th variety in an existing slot must earn
  its place: reactor cores + hull plating each have only 3 stats with all three corners already covered (a
  4th = power creep), and the utility (SUS) slot holds ONLY prospector rigs, so combat + explorer hulls have an
  EMPTY utility slot today. Lineup (rare-relic first find -> discovery-gated research -> item, crafted with):
  - Ancient Drive Coil -> COMBAT utility item, combat hulls only (proposed role: recovery = faster post-loss
    repair + light between-wave hull regen) [Anomalous Alloy]. User named this SUS role (1 of the 8).
  - Deep-Vein Compass -> EXPLORER utility item, explorers only (sensors + scan speed + hazard resist)
    [refined metals]. User named this SUS role (2 of the 8).
  - Leviathan Scale -> RELIC-HUNTER scanning array (the only array that raises relic find chance, at the
    cost of slower scans) [organics].
  - Precursor Lens -> SPECIAL MODULE: a unique proc you cannot get elsewhere [Precursor Circuit]. Needs the
    universal module system (E-MOD), whose module slots are inert today.
  - Heart of the Archive (Precursor CAPSTONE) -> **NEURAL BACKUP (Reraise)**, the user's final pick for NOW
    ("B for this one", 2026-10-01, after briefly choosing C = the Archive Ghost ground-team member): the core
    holds the away team's neural backups. Really rare by design (capstone first find + an Intact Data Core).
    Replaces the proposed Archive-Linked bridge module. The bigger AI idea is DEFERRED, see SUGGESTIONS
    "THE ARCHIVE AI". **Refined by the user (2026-10-01):** Neural Backup is an EQUIPPED item and
    **UNIQUE-EQUIPPED = ONE IN THE ENTIRE FLEET, period** (not one per character/team); it can fire at most
    ONCE PER BATTLE and is NOT guaranteed (~50% chance) to revive the first downed member. It is a
    **CYBERNETIC IMPLANT**, see "CYBERNETICS REVIVED" below.
  - **Resolved 2026-10-01:** Precursor Lens's special module ships WITH the module phase (E-MOD) as its first
    content, not in E4d. Combat utility role = RECOVERY (faster post-loss repair + light between-wave hull regen).
- ⚠️ **CYBERNETICS REVIVED via ground teams (user, 2026-10-01).** Augmentation/cybernetics was 0.14.0's ONLY
  conscious cut, for a data-model reason: the crew Complement is a bucket histogram of interchangeable crew,
  and equipping individual crew breaks that. The user's insight: the deferred GROUND-TEAM gear layer is "a new
  home for cybernetic implants", and ground teams are NOT complement buckets, so the original reason does not
  apply there. Neural Backup is the first implant. OPEN (user's call): whether the implant system lands in
  0.14.0 (e.g. foundation + Neural Backup only) or later; per-team vs per-member implant slots; the wider
  implant catalog. **DECIDED 2026-10-01: FULL cybernetics in 0.14.0** (implant system + a starting catalog);
  the equipment-icon SVG migration pass follows E4. Mockup: "Cybernetics Bay" artifact.
- ⚠️ **SQUAD ROLES SPLIT (user, 2026-10-01): SECURITY = BATTLES, SCIENCE = OVERWORLD.** "I'm not sure the
  science team should really be part of the battle. The security team handles the battles and the science
  team handles overworld activities." REVISES the built E3 design (where Science fought, had its own gambit
  program, and could win mid-fight by securing the objective). Target model: an expedition activity becomes
  (1) CONTACT: if the site is hostile, the Security detail fights by its gambits (Security-only battles; the
  in-fight cure/aid/heal capability moves to Security via medic-style skills + kit items, honoring the
  user's earlier "a designated person on that team uses a skill or an item to cure it"), then (2) FIELDWORK:
  the Science party works the site, and Science strength + Science implants + the Museum's "Science team
  power" drive fieldwork speed, yield, and relic odds. Losing the fight evacuates with a partial haul.
  Science implants are therefore OVERWORLD implants; combat implants (incl. sustain + status resists, and
  NEURAL BACKUP) belong to Security. Reconfiguration of the built E3 engine/UI follows E4d (file overlap).

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

### INVENTORY GAP FIXES (DECIDED, user 2026-10-02)
The 2026-09-30 planned-features audit ([PLANNED_FEATURES_INVENTORY.md](../PLANNED_FEATURES_INVENTORY.md)) found
locked/planned work that never landed. User: "roll it into 0.14.0 as a bug fix that adds in proper functionality
for those gaps and timing calls." These ride 0.14.0 as FIXES that add real function (never "remove the dead
thing"). Each carried row is closed by ID in its commit.

- **Phase E-CREW, "make crew real" (inventory A1-A3).** The away-team roster rework (THE AWAY TEAM ROSTER above,
  carrying the older locked details in inventory A1) + cybernetics, AND the crew systems that display but do
  nothing: dormant Senior Staff bonuses (S4-CP12), no-op Complement pools (S4-CP04/CP05), notables never creatable +
  graduate/sort/mass-action (S4-C24), Active-mode assignment (S4-C18), plus the small crew rows in A2. Crew modules
  get a blueprint AND an install tile (S4-CP23). ONE whole-build mockup before any code (mockup = full sign-off).
- **Phase E-MAT, Material Lines + Material Quality (inventory B2: S5-152, S5-105, S5-130, S5-128).** Revive the
  July Material Lines design (`feat/material-lines-0.11.1`, reconciled against current code first: recipes,
  salvage, refinery queue and items have all moved since) so every mission material has a sink. Give the
  `materialQualityChance` rig stat its designed function (equipment design 0.11.0 section 5: it raises the quality
  of found materials, and material quality feeds crafted quality). Inventory already stores materials per quality.
- **Gear handling (S5-133, S5-151):** equipment discard + sell for credits; install a system from the ITEM side as
  well as the ship side (0.12.0 console lock).
- **Captain trees (S5-120):** real Tactician + Explorer base talent trees (both are inert hubs today) + the INFAMY
  talent (raises a patrol's max waves).
- **Combat 1.1 leftovers ride E-MOD (S5-196, S5-126):** active-ability engine, ambush counter-modules, in-combat
  drone replenish, Overcharged Capacitors, and the power-budget fit gate (same mechanic as E0's power grid,
  S4-A03). The sim hooks exist and are hardwired off.
- **Still in 0.14.0 scope from the audit (already locked there):** reach into expeditions + recall (A4), early
  sensor acquisition + sensor roles (A5), the achievement foundation + milestone ledger E-CAP needs (A6), Help
  rewrite incl. the wrong-in-prod fuel topic (A8). Section D decisions stay the user's; none are assumed here.

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
