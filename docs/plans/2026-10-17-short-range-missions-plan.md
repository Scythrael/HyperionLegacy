# G1 Short-Range Missions (0.14.0): PLAN

> **For Claude:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. One fresh implementer per slice, then
> the two-stage review (spec, then quality), re-review after fixes. Never push the branch; dev deploys are the
> controller's call (`git push origin feat/crew-0.14.0:staging`).

Status: PLAN, written 2026-10-17 against `feat/crew-0.14.0` @ `34449a0`. Doc only; nothing here is built. Every name,
number or text marked **[PROPOSAL]** is mine and is the user's to accept, rename or reject; **[PROVISIONAL]** marks a
first-pass number a slice needs to stay green while its open call waits (each lives in ONE named constant). Section 5
lists the calls; a slice that depends on one says which. The mockup's eight open calls (2026-10-09 to now) were never
answered; they are re-presented here, merged with the new ones, most important first.

**Goal:** a third way to send a ship out, between fixed captain missions and long-range expeditions: a repeatable,
set-and-forget mission slot that re-rolls its job every run, gated by a requirement sheet so a qualified ship can take
any roll; people ride in guest quarters, goods ride in the hold; the first run of each template is a training run.

Sources read: E-CREW plan scope additions (G1, lines 20 to 54), the mockup
`scratchpad/short-range-missions-mockup.html` (2026-10-09), the relics-v2 capture, the saga design (C.3, I.1), the
exploration plan (E1, E5), the safe-first-runs plan with all USER ANSWERS and the SF-1 carry note, the complement plan
(CP-13, OC-13 answers), the SMS-1 modules mockup, the Prospecting squads design, the gear wear design, the wiring
registry plan (sections 3.2 to 3.4), the credit sinks pass with its answers, SUGGESTIONS.md, and the code below. Grep
terms: short-range, short range, refugee, evacuation, guest, colonist, colonistCapacity, secondary personnel, supply
pickup, drop-off, phenomenon, telescope repair, comm booster, prisoner, transport.

## 1. The user's words (verbatim; authoritative)

**The G1 vision** (relics-v2 capture, `docs/plans/2026-10-09-relics-v2-and-expedition-tiers-capture.md` 165 to 177,
user re-statement 2026-10-09):
"First type: Short-Range Missions (haven't locked this name down yet, so that's a WIP). These missions will be
somewhat randomized compared to the set distance and so forth of other mission types, but very similar. You'll
choose a mission like "bring refugees to a new camp on [insert planet here]. You'll have to be able to have enough
room for that secondary personnel. So you might have a set of 100 refugees that you take to that planet. The
distance itself will change based on the planetary distance, so transit time changes from run to run. Then you
take time offloading them, then return to home. You'll see things like "pick up supplies/drop off supplies"
missions with a similar setup. A small survey of some special phenomenon. A mission you go to repair a space
telescope, or construct a comm signal booster. Things like that. It is semi random, and each time it runs, the
constraints themselves will change. But each mission will require a specific level of various categories of stat,
even if it's not using them. That way, if the mission randomizes, you can handle all random missions. So you might
see missions requiring secondary personnel slots and required cargo bay slots. We're not storing refugees in the
cargo bay. They have their own guest quarters aboard the ship. But if you're hauling supplies, you don't give them
quarters."

**Where it sits** (same capture, 160 to 164): "Combat and Prospecting will both receive a completely new set of
missions that are far closer to how expansive and different the second type of exploration content will work."
(capture 58 to 61): "it gives options for people to choose if they main-line expeditions that require a bit more
micromanagement, or if they just set everyone on the lower survey missions, and call it good."

**Sensors and quarters** (same capture, 152 to 157): "Crew Quarters Module: ... Some might increase crew compliment,
and others might impact the crew in other ways!" "Sensor Suite: ... The shorter one-off missions might include
scanning and cataloging something in nearby sectors."

**Relics** (same capture, 25 to 26): "Relics can drop from the shorter missions of course, but they won't drop as
often. Incentive to clear long-range expeditions."

**Scope** (E-CREW plan 22): "If something I've said here is not part of the scope (within reason), make it part of the
scope of 0.14.0." The E-CREW plan's G1 line (25 to 27, my record, not verbatim) adds "activates the reserved
`colonistCapacity`".

**Safe first runs** (`docs/plans/2026-10-15-safe-first-runs-plan.md` section 1): "Every mission should be this way. One
mission of each type will allow for players to be able to experience the content in a safe and educational way to
show them how it works, and when it's complete, the difficulty starts creeping in slowly. Perhaps on a slightly curved
line versus a linear progression. Exponential is too fast." Which types: "short-range missions (the first of each
template, once G1 is built)". Later answers that bind G1 (same plan, USER ANSWERS):
- SF4 "Slow start": run 2 at 35%, run 6 about 54%, run 9 about 80%, full from run 11. SF5: completed runs only, the
  training run excluded. SF6 "Tier I only". SF12 "Training run" chip.
- Group 1 SF3: "Expedited, as all first tutorial runs will across the board when you're being taught the systems. We
  might want to add this functionality in where applicable so any systems we build into the tutorial/story/campaign
  patch can link in with them directly." Group 2: expedite is "Hook only"; time skip covers "Every timed process"
  (missions included); a shared grant seam. Group 3 shakedown: a separate TUTORIAL duration constant set EQUAL to the
  normal one for now.
- Group 3, non-explorer ground teams (verbatim): "1. But add in the wiring for a third team. Because remember, combat
  and prospecting are getting their own more involved set of quests and gameplay ... Also, security squads could have
  their own role as well. A special mission to infiltrate an enemy base or a combatant's vessel." The recorded reading
  is "keep their teams (boarding defense now, short-range missions later)". Security infiltration is FUTURE
  (Prospecting squads design 72 to 75), not G1.
- Veterans: "Full strength, as today (Recommended)".

**Gear wear** (`docs/plans/2026-10-16-gear-wear-design.md` USER ANSWERS): W9 "No wear on training". Wear events per
cycle and per distance (section 3.1).

**Overtime and the speed seam** (`docs/plans/2026-10-16-credit-sinks-pass.md` USER ANSWERS): Overtime is for gear
repair, Shipyard repairs and builds, research and facility upgrades (not missions); it "Shares ONE speed seam with the
tutorial time-skip hook". Speed seam calls 2026-10-17: 3 steps, 10 per minute x tier.

**Complement** (`docs/plans/2026-10-14-complement-and-acquisition-plan.md`): OC-13 "One catalog, by hull
(Recommended)": eight lines at +5% to +10%. The General Quarters line in the SMS-1 mockup reads "Operations and Flight
Deck crew +8%; guest quarters +10% for passenger runs"; the plan notes "The General guest-quarters perk does nothing
until Short-Range Missions (G1)."

**Older locked decisions this plan must honor:**
- Saga C.3 [LOCKED]: "Evacuation missions (a peacetime job for big explorers) award refugees, who get posted at
  facilities and act like mini-Senior-Staff" (design 317 to 321). Exploration plan Phase E5 carries it; no current plan
  owns E5 and nothing is built (inventory S1-06, S4-C30). See open call 2.
- Saga I.1 (design record): transport and supply quests are cost-in / reward-out; examples include "transport
  prisoners to a penal colony". Not in the 2026-10-09 list (open call 15).
- Peace is the product; decisions are the user's; never introduce a game entity the user did not name; every
  configured value must act (wiring registry); D23 diminishing returns, never hard caps; gear is always "installed".

## 2. Reconciliation: what exists today (code on `34449a0`)

| Element | Where | State | G1 meaning |
|:-|:-|:-|:-|
| Mission catalog | `MissionDef` model.ts 276; `MISSIONS` 464 (9 keys) | fixed transit, fixed hold, fixed loot | Short-range rolls are NOT `MISSIONS` entries (a per-run def would widen `MissionKey`, `BASE_XP_PER_TICK` 754 and every Record over it) |
| Behavior tags | `missionType?: "extraction" \| "survey" \| "transport"` model.ts 339 | live | Its comment (model.ts 334 to 338) defers "the refugee / prisoner variants (refugees tie E5)" |
| Mission union | `MissionKind = "extraction" \| "patrol"` model.ts 2983; `CaptainMissionState` 2992; `CaptainState.mission` 3833 | live | G1 adds a third arm `kind: "shortRange"`: the exhaustive switches then force every consumer (about 40 narrowing sites: App 14, tick 6, save 4, berths 4, sim 3, model 3, CombatView 3, others) |
| Dispatch and loop | `canDispatch` tick.ts 4877, `dispatchCaptainOnMission` 4978, `tickCaptainMission` 1810, `recallCaptain` 5530, `DispatchBlockReason` 4773 | live | Mirrored, not reused: the short-range gate checks the sheet per category |
| Phase math | `effectiveMissionDef` model.ts 3668 (transit / speed, cargo-scaled unload / crew `unloadSpeedMult`, Flight Deck Constitution, Operations Integrity), `missionPhaseTicks` 3721 | live | The short-range cycle plan applies the SAME folds (one shared helper), so every crew and gear bonus that claims "missions" acts here too |
| Survey missions | `surveyMineralAnomaly`, `surveyStellarPhenomena` model.ts 636, 657 | live, sensor-scaled rare yield | Overlaps "a small survey of some special phenomenon" (open call 7) |
| Supply runs | `frontierSupplyRun`, `colonySupplyLift` model.ts 693, 715 | live, credit cost-in / margin out, working-capital idle | The drop-off template reuses this economy (open call 13) |
| Guest capacity stat | `colonistCapacity` in `RESERVED_STAT_KEYS` model.ts 2899 | INERT, no consumer | Becomes LIVE (G1-1) |
| Crew Quarters slot | `EQUIPMENT_SLOTS.quarters` model.ts 2326 (affixes crewStations 5, crewEfficiency 2, massReduction 1; 9 varieties); `crewModules.ts` catalogs | live | Guest quarters source (open call 6). Adding an affix to the pool moves future quarters rolls (pinned in G1-0) |
| General quarters perk | SMS-1 line "guest quarters +10% for passenger runs"; CP-13 (G5) | approved (OC-13), NOT built | Whichever of CP-13 / G1-1 lands second wires it; registry entry `pending` owner G1 until then |
| Run counters | `RunCounts.shortRange: Record<string, {dispatched, completed}>` model.ts 6582 to 6594; `isFirstRun`, `completedRuns`, `runDifficultyAt` runDifficulty.ts 152 to 191 | built (SF-1), unread | Keyed per TEMPLATE. `veteranRunCountsV70` gives no short-range veterans (none existed), so every save, old or new, gets one training run per template |
| Difficulty curve | `rampFraction`, `runRamp`, `N_FULL` 10, `RAMP_FLOOR` 0.35, `RAMP_MAX_TIER` 1 (runDifficulty.ts 34 to 50) | built | Read by the roll (G1-2) |
| Save | `SAVE_VERSION = 70` save.ts 79, `MIGRATIONS[69]` save.ts 2548 (fuel drop + run counters), v70 not on staging | live | G1 needs no step (section 3.6); if one turns out to be needed it APPENDS to `MIGRATIONS[69]` |
| Reach | `shipReachesRoundTrip` tick.ts 4818, `shipTripRangeLightYears` 4842, `LY_PER_TICK` 0.5 fuel.ts 116 (display only) | live | The Range category is the sheet's longest round trip through this same seam |
| Sensors | `effectiveShipStats(...).sensors` (crewOverlay.ts 534); explorer base sensors approved (CP OC-16: Aurora 35, Orion 25, Eir 15, warships 10) | live | The Sensors category |
| Engineering | Engineering department facets (crewOverlay.ts 431, 508); GO-8 reads "the Engineering department's Integrity facet" (model.ts 7402) | live | Candidate reading for the Engineering category (open call 4) |
| Transit berths | `berths.ts` (unloading at home occupies a berth; the softlock proof: the phase is never gated) | live | Home unload of a short-range run occupies a berth on the same rules [PROPOSAL, open call 18] |
| Relic tokens | `ExpeditionRelicToken` model.ts 6693 (unidentified, identified in the Research Lab) | live (v1) | G3 Relics v2 (per-tier pools) has no plan yet; G1-5 waits for it |
| Mission Control rung hook | `MISSION_CONTROL_UNLOCK_COMPLETIONS` 50 model.ts 4515, commented rung; user OC-C4 "Keep tested hooks" | INERT seam | A natural owner for extra board slots (open call 8) |
| Operations UI | `ConsoleTabs` App.svelte 16626 (Overview, Gathering, Combat Patrols, Exploration, Mission Control); the Exploration tab lists surveys and supply runs (17043) | live | Placement (open call 16) |
| Wiring registry | `src/lib/game/wiring/registry.ts`: 23 entries carry mission contexts (19 extraction, 3 survey, 1 transport); completeness enumerates `MISSIONS` fields, `LIVE_STAT_KEYS`, the quarters catalog, numeric `ShipTypeDef` fields | live | New context `mission:shortRange`; every entry whose claim covers missions gains it or an explicit `outOfScope` reason |
| Lifetime stats | `lifetimeStats.missionsCompleted` model.ts 7544 (keyed by mission key; feeds the crew promotion counter, 6241) | live | Short-range cycles count under `shortRange:<template>` [PROPOSAL] |
| Gear wear | design only | not built | Short-range cycles emit the same wear events (cargo per haul, FTL per distance, reactor and quarters per minute, sensor per survey); none on a training run (W9) |
| Time skip / expedite seam | answers only (safe-first-runs group 2, credit sinks) | not built | G1 registers its cycle with the seam (or the seam slice adds the adapter, whichever lands second) |
| Refugees to facility crews | saga C.3 LOCKED; exploration plan E5 | NOT built, no owner | Open call 2 |

## 3. Design

### 3.1 The board and the loop

- A **board** of mission **slots**. Each slot has a tier and a requirement sheet. A captain and their hull take a slot
  (same picker as captain missions; the captain is busy). The slot runs cycle after cycle until recalled; every cycle
  re-rolls (open call 1).
- **One cycle** (mockup section 3): transit out (the rolled distance), work on site (the job's own length), any load or
  offload on site, transit back, unload at home. No failure state: a ship that meets the sheet always completes
  [PROPOSAL, open call 9].
- **The next roll is visible** on the board before dispatch (pure from the seed and the slot's next cycle index), so the
  player sees what the slot will ask next.
- Auto-stops reuse today's rules: a supply pickup whose material is at its Warehouse cap idles the cycle (the
  `materialAtCap` seam); a drop-off whose load cost the fleet cannot cover idles (the transport working-capital gate).
  Both resume on their own. A skipped or idled roll is not re-drawn (the cycle index still advances only on a
  delivered cycle, so no stream shifts).

### 3.2 Templates [PROPOSAL labels; the jobs are the user's]

| Key (identifier) | Label [PROPOSAL] | User's words | Uses | Rolled constraints |
|:-|:-|:-|:-|:-|
| `refugeeRelocation` | Refugee Relocation | "bring refugees to a new camp" | Range, Guest quarters | destination, distance, headcount |
| `supplyDropOff` | Supply Drop-off | "drop off supplies" | Range, Cargo | destination, distance, units |
| `supplyPickup` | Supply Pickup | "pick up supplies" | Range, Cargo | destination, distance, units |
| `phenomenonSurvey` | Phenomenon Survey | "a small survey of some special phenomenon" | Range, Sensors | phenomenon, distance, scan size |
| `telescopeRepair` | Telescope Repair | "repair a space telescope" | Range, Cargo, Engineering | site, distance, parts, repair size |
| `commBoosterBuild` | Comm Booster Build | "construct a comm signal booster" | Range, Cargo, Engineering | site, distance, components, build size |

Keys are stored in saves (`runCounts.shortRange`, the mission arm), so they are settled before G1-2 even if the labels
change later. Phenomenon flavor (mockup: comet at perihelion, magnetar flare echo, interstellar object flyby, gas giant
aurora, pulsar glitch) and destination designations ("Body III, temperate world", "Body IV, L2 point") are display
only [PROPOSAL, open calls 12 and 17].

### 3.3 Requirement sheets and categories [PROPOSAL, open calls 3 and 4]

- One sheet per tier covering every category, judged against the picked ship: **Range** (round trip, through
  `shipReachesRoundTrip`), **Cargo** (`effectiveShipStats.cargoCapacity`), **Guest quarters** (the new
  `colonistCapacity`), **Sensors** (`effectiveShipStats.sensors`), **Engineering** (a rating; reading per open call 4).
- **The contract:** a roll never exceeds its slot's sheet in any category (property-tested over 10,000 seeds per tier),
  so a ship that qualifies once can take every roll. Categories a roll does not use are still required (the user's
  rule).
- [PROVISIONAL] first-pass numbers, from the mockup:

| Tier | Range (round trip, ly) | Cargo | Guest quarters | Sensors | Engineering |
|:-|:-|:-|:-|:-|:-|
| I | 180 | 90 | 60 | 10 | 3 |
| II | 260 | 150 | 100 | 20 | 5 |

  Roll ranges: Tier I distance 30 to 90 ly, headcount 30 to 60, cargo 40 to 90, scan 6 to 10, engineering 2 to 3;
  Tier II distance 60 to 130, headcount 60 to 100, cargo 90 to 150, scan 14 to 20, engineering 4 to 5.
- Consequence to flag: a bare General Freighter (0 guest quarters, 0 sensors) meets no sheet. The first slot is reached
  by installing one Crew Quarters module with a guest line and a sensor (or flying an explorer). Open call 6 sets how
  easy that is.

### 3.4 Guest quarters (`colonistCapacity`) [PROPOSAL, open calls 5 and 6]

- Moves from `RESERVED_STAT_KEYS` to `LIVE_STAT_KEYS`; folds into `ShipDerivedStats.colonistCapacity` as an OPTIONAL
  field written only when non-zero (so every existing derived-stat object and hash is byte-identical).
- Sources: a `colonistCapacity` line on the Crew Quarters affix pool; a new quarters variety whose signature line is
  guest quarters (fewer crew stations in trade); a hull base on transport-minded hulls (new optional
  `ShipTypeDef.colonistCapacity`, classified in `fieldRoles.ts`); the approved General perk (+10% guest quarters on a
  General hull's quarters module, CP-13).
- Guests are not crew: they add nothing to the complement, take no crew stations, and never substitute for the hold
  (and the hold never substitutes for them). Only refugee jobs read guest quarters; only goods jobs read the hold.

### 3.5 Rolls, timing and rewards

- **Roll** (`rollShortRangeJob`, pure): `makeRng((boardSeed ^ SHORT_RANGE_ROLL_SALT ^ imul(slotId, K) ^ cycleIndex)
  >>> 0)` with a FIXED draw layout (template, destination, distance, size A, size B, flavor: six draws every roll,
  whatever the template), so a template change never shifts a later draw. Rolled at the cycle start, frozen on the
  mission (offline == live by construction). Never the shared economy stream.
- **Training run:** the first roll of each template per save (`isFirstRun(state, "shortRange", template)`) takes the
  template's SMALLEST constraints, carries the "Training run" chip (SF12), applies no wear (W9), and reads a
  `SHORT_RANGE_TUTORIAL_TICKS_SCALE` equal to 1 (the shakedown precedent: hook only, normal length).
- **Ramp:** later Tier I rolls draw their sizes from `floor + (full - floor) x f` of the range, `f = runRamp(completed,
  tier)` per template (SF4 to SF6); Tier II rolls the full range from its first run. A veteran save still gets the
  ramp (no short-range history exists), which matches "only new content ramps".
- **Timing** [PROVISIONAL, 1 tick = 1 s]: transit = distance / `LY_PER_TICK`, then the same `transitSpeedMult` divide,
  Flight Deck Constitution and Fast Departure / Fast Return legs as `effectiveMissionDef`; work on site: survey scan
  shortened by Sensors, repair or build shortened by Engineering; on-site load or offload and home unload scale with
  headcount or units and the crew `unloadSpeedMult` (cargo-scaled unload as today). One extracted helper
  `shortRangeCyclePlan(roll, stats)` so the gate, the loop and every readout agree.
- **Rewards** [PROPOSAL, open call 13; priced to today's Tier II band, about 1,000 to 1,300 credits per hour at base,
  credit sinks section 2.1]: refugees: credits per person x distance + captain XP; drop-off: the supply-run cost-in /
  margin-out loop; pickup: common materials to the Warehouse + credits; survey: rare materials + credits by today's
  sensor yield rule; repair and build: credits + captain XP by tier. Captain XP and Fleet Admiral XP accrue per active
  tick (integer rates, the closed-form parity trap). No new currency.
- **Relics** (G1-5, after G3) [PROPOSAL, open call 11]: lowest-tier unidentified relics; chance per HOUR of mission
  time (Tier I 0.08x, Tier II 0.15x of the expedition rate), rolled once per delivered cycle on its own
  `SHORT_RANGE_RELIC_SALT` stream.

### 3.6 Data model and SAVE impact

```ts
// model.ts [PROPOSAL shapes]
export type ShortRangeTemplateKey = "refugeeRelocation" | "supplyDropOff" | "supplyPickup"
  | "phenomenonSurvey" | "telescopeRepair" | "commBoosterBuild";
export type ShortRangeCategory = "range" | "cargo" | "guests" | "sensors" | "engineering";
export interface ShortRangeTemplateDef { key; label; uses: readonly ShortRangeCategory[]; rolls: Record<tier, ranges>;
  workTicks; reward: ShortRangeRewardDef }               // every field classified in wiring/fieldRoles.ts
export const SHORT_RANGE_SHEETS: Record<ShortRangeTier, Record<ShortRangeCategory, number>>;
export interface ShortRangeRoll { version: 1; template; tier; cycleIndex; destinationIndex; distanceLy;
  guests?; units?; scan?; engineering?; flavorIndex; difficulty: RunDifficultyStamp }
export interface ShortRangeMissionState { kind: "shortRange"; slotId: number; roll: ShortRangeRoll;
  phase: ShortRangePhase; phaseProgressTicks: number; recalled: boolean }
export type ShortRangePhase = "transitOut" | "onSite" | "transitBack" | "unloading";
// GameState
shortRangeBoard?: { version: 1; nextCycle: Record<number, number> };  // absent = every slot at cycle 0
```

- `MissionKind` widens to `"extraction" | "patrol" | "shortRange"`; `CaptainState.mission` gains the arm. Old saves
  never carry it (only new code writes it).
- **Board seed:** derived, never stored: `homeworld.seed ^ SHORT_RANGE_BOARD_SALT` once G2-1's stored homeworld exists,
  else a fixed `SHORT_RANGE_DEFAULT_SEED` (the `EXPEDITION_DEFAULT_SEED` precedent). Slot count and tiers are DERIVED
  (open call 8), never stored.
- **SAVE:** no `SAVE_VERSION` bump and no migration step: every new field is optional and absent reads as the fresh
  value; `runCounts.shortRange` already exists in v70. If review finds a field that must be backfilled, it APPENDS a
  frozen, idempotent step to `MIGRATIONS[69]` (v70 has not reached staging); never v71 while that holds. Hydration
  hardening: a malformed `shortRangeBoard` or roll reads as absent (the `isWellFormedRunCounts` pattern); a stored roll
  with an unknown template key ends the mission at load with no reward (logged), never a crash.

### 3.7 Determinism, parity, neutrality

- Salts [PROPOSAL values at build, unique in the repo, odd]: `SHORT_RANGE_BOARD_SALT`, `SHORT_RANGE_ROLL_SALT`,
  `SHORT_RANGE_RELIC_SALT`, `SHORT_RANGE_ROUNDING_SALT` if any fractional payout needs whole units.
- Every engine slice proves one call == 997 s chunks == 1 s steps over a multi-cycle short-range run next to a mission
  Repeat and a patrol Repeat (the existing parity harness).
- **Additive-neutral:** with no short-range dispatch, every golden is byte-identical (section 4, G1-0). Adding the
  quarters affix moves only NEW quarters rolls; G1-0 pins today's rolls so the move is named, not silent.

## 4. Slices

### G1-0: Goldens first (tests only)

Pin before any engine change: one delivered cycle for every `MISSIONS` key x every hull (reuse `firstRunsGoldens`
`gather:*`), a mixed-fleet `economyTick` whole-state hash over 6 hours (mission Repeat, patrol Repeat, an expedition),
`effectiveShipStats` for every hull with and without each quarters variety, `generateEquipment` for the quarters slot
at 50 fixed seeds (the affix pool move), the wiring registry snapshot (ids and statuses), the Operations and Home pure
view helpers, and an `old:v69` load. `stateHash` strips the new optional fields (no-op today). **UI:** none.

### G1-1: Guest quarters stat (engine + small display) [open calls 5, 6]

`colonistCapacity` to LIVE; the optional derived field; the quarters affix line; the hull base field; the new variety
(only if approved, with an SVG tile glyph reviewed at 16, 28 and 56 px and classified in `ICON_SEMANTICS`); the
General perk hook. Registry entries per source (`linearAbsolute` for lines and base, `linearRelative` for the perk;
context `mission:shortRange`, `pending` owner G1-4 until a consumer reads it). **Tests:** neutrality (no source = the
same object), each source moves the stat by its catalog magnitude, guests never touch crew capacity. **Goldens:** the
quarters roll pins move (named). **UI:** the stat line on the Ship Systems tile and stat breakdown reuses the existing
line pattern (no mockup), unless open call 6 adds the variety (its tile then rides G1-6's sign-off).

**Carry note (G1-0 + G1-1, built 2026-10-19 on `a678241`):**
- G1-0 lives in `shortRangeGoldens.test.ts` (fleet 6 h, Home + Ships views, stats per hull x quarters variety,
  quarters gen at 50 seeds, registry ids and statuses, a v69 load). Re-capture with `G1_CAPTURE=<path>` (writes JSON).
  A slice that adds registry entries lists them in `G1_ADDED_ENTRY_IDS` so the base pin keeps proving nothing moved.
  Sheet goldens everywhere hash through `withoutGuests` (firstRunsGoldens.fixture.ts); guest values pin as `guests:*`.
- Guest quarters reads `effectiveShipStats(...).colonistCapacity ?? 0` (whole berths; absent = 0). Sources: hull base
  `HULL_GUEST_QUARTERS` (model.ts) [PROVISIONAL]; the quarters affix (appended, `GUEST_QUARTERS_AFFIX_WEIGHT` 2
  [PROVISIONAL]); the Guest Wing (`quartersGuestWing`, signature line only, crew capacity `GUEST_WING_CREW_CAPACITY` 4
  [PROVISIONAL]); lines are stored in berths (`GUEST_QUARTERS_PER_POINT` 4 [PROVISIONAL], itemgen.ts); the General
  perk `GENERAL_QUARTERS_GUEST_PERK` 0.1 (model.ts, any quarters module on a General hull, whole total, rounded).
  Calibration for G1-2's sheets: a Freighter with a derelict iL10 Guest Wing reads (20 + 40) x 1.1 = 66, an Orion 80,
  an Eir 120; a guest affix at iL10 standard is 24 berths.
- Wiring: 6 guest entries are `pending` G1-4 at the new context `mission:shortRange` (live at `sheet`);
  `sheetGuestQuarters` reads 0 there and `FLAT_UNCONTROLLED` says why. G1-4 points that probe at the cycle, flips
  them live and removes the FLAT_UNCONTROLLED line. The Guest Wing's crew-effect entry is `notApplicable` (boost 0).
- For G1-2: the sheet now has SIX categories, Range, Cargo, Guest quarters, Sensors, Engineering and **Security** (user
  2026-10-19: the seventh template, Prisoner Transport, reads Guest quarters + the ship's Security crew strength; every
  tier sheet gains a Security row, small at Tier I). Section 3.6's `ShortRangeCategory` and `ShortRangeTemplateKey`
  widen accordingly (the template key is still to name, [PROPOSAL]).
- Elsewhere: CP-11 must add a Guest Wing blueprint (no module has one yet); CP-12's quarters tile reuses the SVG
  `guestWing` glyph (icons.ts, `varietySvgIcon`); CP-13 may absorb the General perk into its hull-family catalog.

### G1-2: Templates, sheets and the roll (pure engine)

`shortRange.ts`: the catalog, sheets, `rollShortRangeJob`, the training and ramp rules, `shortRangeCyclePlan`, sheet
evaluation per category (`meetsSheet(state, ship, tier) -> { ok, short: ShortRangeCategory[] }`). **Tests:** fixed
draw layout (six draws, any template), same seed same roll, roll never exceeds the sheet (10,000 seeds per tier),
training roll is the minimum, ramp monotone in completed runs and flat at Tier II, the cycle plan applies every
mission fold (transit, unload, Constitution, Fast Departure / Return) identically to `effectiveMissionDef` on a
matching def. **UI:** none.

**Carry note (G1-2, built 2026-10-19 on `1c512fc`):**
- `shortRange.ts` is pure; nothing in the game calls it yet. Seven templates (`SHORT_RANGE_TEMPLATE_KEYS`, a FROZEN
  draw order); the seventh key is `prisonerTransport` (user 2026-10-20 "Approve"), label "Prisoner Transport". Six categories, one
  sheet per tier (`SHORT_RANGE_SHEETS`, exactly the largest roll); every number (user 2026-10-20 "Approve") in one named constant
  (`SHORT_RANGE_TEMPLATES`, `SHORT_RANGE_SHEETS`, `SHORT_RANGE_CREW_RATING`, `SHORT_RANGE_WORK`).
- Range is in the game's real lightyears: the mockup's distances x LY_PER_TICK (Tier I 15 to 45 ly one way, sheet 90;
  Tier II 30 to 65, sheet 130), so the mockup's transit ticks hold and a General Freighter (100 ly) reaches Tier I but
  not Tier II. The 3.3 table's 180 / 260 were in the mockup's scale.
- Engineering and Security ratings: `shortRangeCrewRating(shipDivisionStrength(...))`, 2 x log2(1 + strength / 2).
  `shipDivisionStrength` (gambit.ts) is the away team's own Security / Science sum, now shared (deriveAwayTeam reads
  it; identical numbers); Engineering adds the engineering-seat officer. A 6 h crewed Freighter rates about 3.7 / 1.2.
- The roll: `rollShortRangeJob(state, slot, cycleIndex)`, six draws always. The training run is decided per drawn
  template by `runDifficultyAt(state, "shortRange", tier, template)`, i.e. `runCounts.shortRange[template].dispatched
  === 0`: with the whole job re-rolling, **G1-3/G1-4 must bump `dispatched` per cycle START of that template** (not
  per slot dispatch), and two slots may both draw an untried template at once (both are training runs). The ramp
  applies to the distance and every size (`spanTop`, share = `rampEnemyScale(ramp)`); a training run at a Tier II
  slot takes that tier's smallest roll.
- `shortRangeCyclePlan(roll, stats, engineeringRating)`: model.ts's folds are now shared helpers
  (`scaledUnloadTicks`, `outboundLegTicks`, `returnLegTicks`, `fullHoldUnloadTicksFor`; effectiveMissionDef reads
  them, byte-identical). No orders tick; the Constitution ramp reads transit out + on site. Every job has a home
  turnaround (Supply Pickup unloads its units; the rest take the 3-tick floor).
- `shortRangeCycleReward(roll, stats)`: credits, the drop-off's `loadCost` (G1-4: spend at the cycle start, the
  working-capital idle), materials (pickup: `commonOre` x units; survey: `rareMaterial`, stochastic whole units on
  `SHORT_RANGE_ROUNDING_SALT`), integer XP per active tick. Base credits per hour (reference ship at the sheet, full
  strength): Tier I 1,050 to 1,260, Tier II 1,050 to 1,260; Prisoner Transport 1.20x Refugee Relocation.
- Wiring: `SHORT_RANGE_TEMPLATES` is classified (fieldRoles) and enumerated (catalogs); 21 entries
  `mission:SHORT_RANGE_TEMPLATES:<key>:<rolls|work|reward>` are `pending` owner G1-4 (in `G1_ADDED_ENTRY_IDS`, so
  `registry:g1` moved by exactly these). G1-4 flips them live with a cycle probe. Salts registered in salts.test.ts.

### G1-3: Board, dispatch, recall (engine)

Derived slots (open call 8), `canDispatchShortRange` with one block reason per short category plus the captain-mission
reasons (busy, no ship, needs repair, crew lock), `dispatchCaptainOnShortRange`, recall after the current cycle,
`runCounts.shortRange[template].dispatched`, the widened union with every exhaustive consumer handled (shipsOutOnRuns,
crew lock, salvage safety, assign-ship guard, berths, homeDashboard, sim player, save hydration). **Tests:** each
gate, same-ref on refusal, union exhaustiveness compile, a hand-edited bad roll loads safely. **UI:** none.

### G1-4: The cycle engine (engine)

`tickCaptainShortRange` routed from `economyTick`: phases, re-roll at each cycle start, rewards per template, the
working-capital and Warehouse-cap idles, XP accrual, `lifetimeStats`, `runCounts.shortRange[template].completed`
(training excluded, SF5), completion log entries, transit-berth occupancy at home, gear wear events if gear wear has
landed (none on training), the time-skip seam adapter if the seam has landed. Registry: `mission:shortRange` added to
every mission-claim entry (23 today) or an explicit `outOfScope` with reason; the guest quarters entries go `live`.
**Tests:** offline == live (one call, 997 s chunks, 1 s steps) over 20 cycles, idle and resume, recall, the training
run's chip flag and smallest roll, neutrality goldens unchanged. **UI:** none.

### G1-5: Relic drops (engine; after G3 Relics v2) [open call 11]

Per-hour chance on its own salt, lowest-tier pool from G3, the token through the existing Research Lab identify path.
**Tests:** expected rate over a seed batch per tier within tolerance; a short run repeated fast earns no more per hour
than a long one; training runs follow the same rule. **UI:** the completion line names the relic (reuses the
expedition relic line).

### G1-6: Board UI, dispatch, in-progress (UI; needs a mockup sign-off)

Board cards (this run's roll on top, the slot's sheet as one bar per category vs the picked ship, used categories
highlighted), dispatch popup with per-category blocked reasons, Repeat and Recall, the in-progress card on Operations
Overview and Home, the offline recap line, the Training run chip, desktop 1280 px and mobile 375 px. **Mockup coverage:**
the 2026-10-09 mockup covers the board card concept and requirement bars, the guest quarters explainer, the cycle
timeline, the rewards table and the three-way comparison. It does NOT cover: the real Operations placement, the
dispatch popup and its refusal text, the Overview / Home in-progress cards, the Ship Systems guest-quarters line or a
new variety tile, the Training run chip placement, the recap line, or any 375 px layout. A v2 mockup after the open
calls are answered; build waits for sign-off.

### G1-7: Help, patch note, QA sheet, close-out

A Help page (Operations > Short-Range Missions), the 0.14.0 patch note lines, the wiring release gate green
(`RELEASE_GATE=1`, no G1 entry `pending`), and the desktop + mobile QA sheet (section 6). Inventory rows closed.

## 5. OPEN CALLS for the user (multiple-choice ready; recommended first)

1. **What re-rolls each run?** (a) The whole job: a slot draws any template each run (Recommended; your "handle all
   random missions"). (b) Only its constraints: the template stays, destination and size change. (c) Per slot, the
   player picks (a) or (b).
2. **Refugees and the locked "refugees to facility crews" loop (C.3, E5 has no owner).** (a) G1 builds relocation
   only; E5 (evacuation brings refugees home to staff facilities) gets its own short design right after G1, still
   0.14.0 (Recommended). (b) G1 also builds an Evacuation template and E5's facility posting (adds a slice, and a
   system to design). (c) Move E5 to 0.14.x.
3. **Requirement sheet shape.** (a) One sheet per tier covering all categories (Recommended). (b) One sheet per
   template. (c) Per tier, only the categories that tier's templates use.
4. **Categories, and what Engineering reads.** (a) Range, Cargo, Guest quarters, Sensors, Engineering; Engineering =
   the ship's Engineering crew strength as a rating (Recommended). (b) Same five; Engineering = the Engineering
   officer's level. (c) Drop Engineering; repair and build jobs read Cargo and Sensors.
5. **On-screen name for `colonistCapacity`** [PROPOSAL]. (a) "Guest quarters" (your words, already in the approved
   General perk line) (Recommended). (b) "Guest berths" (the mockup). (c) "Secondary personnel".
6. **Where guest quarters come from.** (a) A quarters affix line + a new quarters variety + a hull base + the General
   perk (Recommended). (b) Affix + hull base + perk, no new variety. (c) Affix + perk only. If (a): variety name
   [PROPOSAL] "Guest Wing" / "Passenger Quarters" / your name; hull base [PROVISIONAL] Eir 80, Orion 40, Aurora 40,
   General Freighter 20, others 0.
7. **Today's survey and supply captain missions.** (a) Keep all four unchanged beside short-range (Recommended:
   byte-identical, no veteran questions). (b) Fold them into short-range templates and retire them. (c) Keep, but
   hide once short-range unlocks.
8. **Board slots and tiers.** (a) Two Tier I slots from the start; a Tier II slot at Mission Control level 2 (the
   kept 50-completion hook); a fourth at level 3 (Recommended). (b) Slots by captain level. (c) One slot per captain.
9. **After the training run.** (a) Tier I rolls grow from small to full on your slow-start curve; no failure ever
   (Recommended). (b) Every later roll uses the full range. (c) Also a small setback chance at Tier II.
10. **Training run profile.** (a) Smallest roll, "Training run" chip, no wear, normal length via the tutorial hook
    (Recommended; matches the SF answers). (b) Chip only.
11. **Relics.** (a) Lowest-tier unidentified relics, chance per hour of mission time, Tier I 0.08x and Tier II 0.15x
    of the expedition rate (Recommended). (b) A flat chance per run. (c) None in 0.14.0.
12. **Destinations.** (a) Generated nearby bodies with placeholder designations (Recommended). (b) Real planets you
    charted on expeditions (needs a charted record, G7). (c) Generated now, charted ones mixed in once G7 lands.
13. **Rewards.** (a) The mockup table, priced to today's Tier II income band (Recommended). (b) Credits and XP only.
    (c) The mockup table at a lower band (short-range below captain missions per hour).
14. **Ground teams on short-range** (the 2026-10-16 note "short-range missions later"). (a) None in G1; a
    squad-using template is logged for later (Recommended: set and forget). (b) Repair and build jobs also need a
    ready Science squad aboard.
15. **Prisoner transport** (saga I.1 example). (a) Log for the content patch (Recommended). (b) Add a seventh template
    on guest quarters.
16. **Placement and who flies it.** (a) Its own Operations tab "Short-Range" beside Exploration; a captain and their
    hull via the same picker (Recommended; the mockup). (b) A section on the Exploration tab. (c) A section on
    Gathering.
17. **Names** [PROPOSAL]. (a) Keep "Short-Range Missions" and the six labels in 3.2 and the mockup's phenomenon flavor
    (Recommended). (b) Rename now (your names). (c) Keep for build; rename before release.
18. **Home unload uses a transit berth.** (a) Yes, same rules as captain missions (Recommended). (b) No.

## 6. QA list (desktop 1280 px and mobile 375 px)

1. Fresh save: the board shows its slots and each slot's next roll; a General Freighter is refused with the short
   categories named.
2. Install a quarters module with a guest line and a sensor: the sheet bars turn green; dispatch; the first refugee
   job reads "Training run" and the smallest headcount.
3. Let a slot run 3 cycles: each cycle re-rolls; the timeline lengths change with distance and size.
4. Recall mid-cycle: the ship finishes the cycle and stops.
5. Reload mid-transit and after 2 hours offline: same phase, same rewards as staying online.
6. Supply pickup at a full Warehouse idles and resumes; drop-off with no credits idles and resumes.
7. Ship Systems shows guest quarters only when non-zero; the General perk line raises it on a General hull.
8. 375 px: board cards stack, bars readable, no horizontal scroll.

## 7. Size (honest)

Eight slices. G1-0 small; G1-1 medium (stat, affix, base, registry); G1-2 medium (pure, property tests); G1-3 medium
(the union widening touches about 40 sites); G1-4 large (the loop, parity, the registry context sweep over 23
entries); G1-5 small but blocked on G3; G1-6 large (new tab, popup, cards, two layouts, mockup round); G1-7 small.
Roughly the size of G2 without its galaxy work. If open call 2 picks (b), add one large slice and a design round.
Push-back flag: 0.14.0 still carries complement, expedition tiers, Field Kits, Relics v2, the gas giant study,
Material Lines and universal modules ahead of G1 in the build order.

## USER ANSWERS (2026-10-17)

- **Existing survey / supply missions:** "Keep them separate (Recommended)". **Refugees vs the E5 facility-crews
  loop:** "Relocate now, crews loop right after (Recommended)". **Placement:** "Own Operations tab (Recommended)".
  **Slots:** "Mission Control upgrades (Recommended)".

## USER ANSWERS (2026-10-19)

- **Call 1, what re-rolls:** "Whole job (Recommended)": each run a slot can draw any template.
- **Call 3, sheet shape:** "One per tier, all stats (Recommended)".
- **Call 4, categories:** "Five, Engineering = crew (Recommended)": Range, Cargo, Guest quarters, Sensors, Engineering;
  Engineering is the ship's Engineering crew strength as a rating.
- **Call 5, stat name:** "Guest quarters (Recommended)".
- **Call 6, guest quarters sources:** "Affix, variety, hull, perk (Recommended)": a quarters affix line, a new quarters
  variety (name still open), a hull base on transport hulls [PROVISIONAL Eir 80, Orion 40, Aurora 40, General Freighter
  20, others 0], and the General perk.
- **Call 9, after training:** "Slow start, no failure (Recommended)".
- **Call 10, training profile:** "Full training profile (Recommended)": smallest roll, "Training run" chip, no wear,
  normal length via the tutorial hook.
- **Quarters variety name:** "Guest Wing (Recommended)".
- **Call 11, relics:** "Rare, per hour (Recommended)": lowest-tier unidentified relics, chance per hour of mission
  time, Tier I 0.08x and Tier II 0.15x the expedition rate; G1-5 after Relics v2.
- **Call 12, destinations:** "Generated now, charted later (Recommended)".
- **Call 13, rewards:** "Tier II income band (Recommended)": the mockup table at about 1,000 to 1,300 credits per hour
  at base.
- **Call 14, ground teams:** "None in 0.14.0 (Recommended)": a squad-using template is logged for the quests patch.
- **Call 15, prisoner transport:** "Add a seventh job now" (NOT the recommendation): a seventh template on guest
  quarters, built in 0.14.0. Its details (label, what it reads beyond guest quarters, reward) asked next.
- **Call 17, names:** "Keep them (Recommended)".
- **Call 18, home unload berth:** "Yes, same rules (Recommended)".
- **Prisoner Transport needs:** "Security crew rating (Recommended)": reads Guest quarters plus the ship's Security
  crew strength as a SIXTH sheet category, Security; no squad, still set-and-forget. Consequence (from call 3, one
  sheet per tier with all stats): every tier sheet gains a Security row. Confirmed 2026-10-19: "Yes, every sheet (Recommended)" (small at Tier I so a
  normally crewed ship passes).
- **Prisoner Transport reward:** "Higher credits (Recommended)": about 20% more credits per hour than refugee
  relocation, still in the Tier II band.
- All 18 calls answered, plus the prisoner transport details.
