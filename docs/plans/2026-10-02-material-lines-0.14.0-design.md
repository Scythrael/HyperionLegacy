# 0.14.0 "Material Lines + Material Quality" Design (Phase E-MAT)

**Status: DRAFT for user review. Nothing here is decided until the user approves it.**
Supersedes `docs/plans/2026-07-18-material-lines-0.11.1-design.md` (which lives only on branch
`feat/material-lines-0.11.1`). The July doc's sections 12 and 13 (the user's resolutions) are treated as
decided input; everything else is re-derived against the code on `feat/crew-0.14.0` as of 2026-10-02.

**Why now:** user decision 2026-10-02 (exploration plan, "INVENTORY GAP FIXES", Phase E-MAT, inventory rows
S5-152, S5-105, S5-130, S5-128): ship Material Lines inside 0.14.0 as a FIX, and give the
`materialQualityChance` rig stat its designed function.

**Goal (unchanged from July):** every mission-loot material gets a real crafting use (or an honest
"reserved" tooltip), through four thematic material lines, and no slot's first real upgrade is ever walled
behind a mission the player cannot run yet.

Conventions: `file:line` cites are to `src/lib/game/` unless a path is given. Quantities are first-pass
placeholders; the THEMATIC ASSIGNMENTS, the SEAMS and the OPEN CALLS are what need approval. Anything marked
**[PROPOSAL]** is a new game entity or mechanic I am proposing; the user decides.


## 1. Current material census (verified 2026-10-02)

`ITEMS` (model.ts:6277-6616) has 25 entries: 14 `raw`, 2 `salvagedMaterial`, 5 `refined`,
3 `minorComponent` (frameSegment, powerCoupling, intactDataCore) and 1 `majorComponent` (structuralAssembly).

### 1a. Raw and salvaged materials (16)

Sources: mission `lootTable`s (model.ts:439-708), patrol loot tables (tick.ts:2542-2610), salvage loot
pools (model.ts:6682-6799, deposited by salvage.ts:528 at the tier's quality), expedition ground-battle
hauls (gambit.ts:1192-1201, deposited at quality 0 via expedition.ts:856), Economy talent trickle
(model.ts:10206, 10216).

| Item (id) | Line | Rarity | Sources | Consumers today |
|:-|:-|:-|:-|:-|
| Titanium Ore (`commonOre`) | Structural | common | Local Asteroid (model.ts:509), Survey Mineral Anomaly (619), patrol cargo (tick.ts:2550, 2589), Economy talent trickle (model.ts:10206, 10216) | `refineCommonOre` (6203); Refinery rungs (3663-3690); Warehouse T1 rungs (3490) + T2 unlock (3526); Fuel Depot rungs (3582, 3592); Equipment Storage rungs (8331-8334) |
| Polysilicate Ore (`uncommonMaterial`) | Structural | uncommon | Local Asteroid (509) | `refinePolysilicateWafer` (6208) |
| Iridium Ore (`rareMaterial`) | Structural | rare | Local Asteroid (509) | **NONE** |
| Ferrite (`ferriteOre`) | Heavy metals | common | Lunar Mine (536), Survey Stellar Phenomena (640) | **NONE** |
| Cobalt Ore (`cobaltOre`) | Heavy metals | uncommon | Lunar Mine (536), Survey Mineral Anomaly (619) | **NONE** |
| Osmium Ore (`osmiumOre`) | Heavy metals | rare | Lunar Mine (536), Survey Mineral Anomaly (619) | **NONE** |
| Scrap Alloy (`scrapAlloy`) | Recovered tech | common | Salvage Wreckage (558), patrol cargo (tick.ts:2549, 2588), expedition hauls (gambit.ts:1194-1200), Reactor Housing salvage standard tier (model.ts:6694) | **NONE** |
| Salvaged Circuitry (`salvagedCircuitry`) | Recovered tech | uncommon | Salvage Wreckage (558), Reactor Housing salvage augmented tier (6705), expedition hauls (gambit.ts:1195-1199) | **NONE** |
| Damaged Reactor Housing (`intactReactorCore`, salvagedMaterial) | Recovered tech | rare | Salvage Wreckage rare (558), patrol salvage drop (tick.ts:2545, 2584) | Material salvage (`SALVAGE_LOOT_POOLS.intactReactorCore`, model.ts:6685) |
| Damaged Weapon System (`damagedWeaponSystem`, salvagedMaterial) | Recovered tech | uncommon | patrol `damagedSystem` drop (tick.ts:2571, 2608) | Material salvage (model.ts:6746) |
| Fibrous Biomass (`fibrousBiomass`) | Organic | common | Forage (582) | `bioResonanceArrayBp` only (7697, relic-gated) |
| Volatile Resin (`volatileResin`) | Organic | uncommon | Forage (582), Survey Stellar Phenomena (640) | `bioResonanceArrayBp` only (7697) |
| Exotic Spore Cluster (`exoticSporeCluster`) | Organic | rare | Forage (582), Survey Stellar Phenomena (640) | `bioResonanceArrayBp` only (7697) |
| Anomalous Alloy (`anomalousAlloy`) | Salvage exotic | epic | salvage stellar tiers (6717, 6778), expedition hauls (gambit.ts:1197-1201) | `damageControlSuiteBp` only (7667, relic-gated) |
| Deuterium Ice (`deuteriumIce`) | (deprecated fuel ore) | common | `localFuelRun` only, which 0.13.6 hid from the UI (App.svelte:8959-8960) | legacy Fuel Depot pipeline (tick.ts:10080) + Quartermaster sell (`sellValue: 40`, model.ts:6346) |
| Dense Ore (`denseOre`) | (T2 stub) | uncommon | none (deliberate, model.ts:6360-6377) | Warehouse T2 rungs 1+ (3533), the intended "future content" wall |

Notes:
- The two transport missions and `localFuelRun` point their uncommon/rare slots at
  `uncommonMaterial`/`rareMaterial` as inert scaffolding with 0% chances (model.ts:474-479, 657-660,
  676, 697); they are not real sources.
- **Survey missions do NOT drop any new rare/exotic item.** E1a deliberately reused existing items in new
  triads (model.ts:597-598, 617-618, 638-639). Their effect on this design is a SECOND source for Cobalt,
  Osmium, Ferrite, Resin and Spore, behind captain level 4 / 5.

**Raw/salvaged with NO consumer (6):** Iridium Ore, Ferrite, Cobalt Ore, Osmium Ore, Scrap Alloy, Salvaged
Circuitry. (The inventory row S5-105 lists five; Iridium is the sixth, because July's planned
`iridiumCatalyst` was never built.) Organics have only a relic-gated sink, which is "no sink" for most
players. Deuterium Ice and Dense Ore are special cases (section 3e).

### 1b. Refined, component and exotic items (9)

| Item | Category | Producer | Consumers |
|:-|:-|:-|:-|
| `titaniumIngot` | refined | `refineCommonOre`; also patrol cargo, expedition hauls, salvage (super-rare) | ~20 blueprints, Refinery rungs 3-4, Equipment Storage rungs |
| `polysilicateWafer` | refined | `refinePolysilicateWafer`; weapon-system salvage staple (6755) | ~20 blueprints |
| `reclaimedAlloy` | refined (tagged rare) | **NONE** | **NONE** (hint "Refined from salvage at the Refinery" is a broken promise, model.ts:6529) |
| `purifiedBiomass` | refined | **NONE** | **NONE** (hint "Refined from foraged biomass" is a broken promise, model.ts:6537) |
| `precursorCircuit` | refined (epic) | salvage radiant tiers (6730, 6791) | **NONE** (honest "reserved for a future recipe" hint) |
| `frameSegment`, `powerCoupling` | minorComponent | `frameSegmentBp`, `powerCouplingBp` | blueprints, hull BOMs (SHIP_TYPES `buildRecipe`, e.g. model.ts:1040), patrol cargo |
| `structuralAssembly` | majorComponent | `structuralAssemblyBp` | T2 blueprints, hull BOMs, Docks + Transit Berth rungs (8463, 8479) |
| `intactDataCore` | minorComponent (legendary) | salvage radiant tiers (6731, 6792) | **NONE** (honest reserved hint; carries the unannounced Easter-egg flavor, model.ts:6610-6614, keep as-is) |

### 1c. Every current consumer surface (so nothing is missed)

- `REFINE_RECIPES` (model.ts:6201-6212): 2 recipes. The engine already supports multi-input refines:
  `RefineRecipeDef.input` is a map (6147), allocation reserves every key (allocation.ts:186-194), and the
  Refinery UI already renders "A + B" inputs (App.svelte:10715). July's "VERIFY multi-input" is verified: it is data only.
- `BLUEPRINTS` (model.ts:6973-7701): 3 material, 12 economy equipment, 6 shield/plating, 9 weapons,
  3 drone pods, 5 unlock-only hulls, 3 relic-gated (Damage Control Suite, Pathfinder Suite, Bio-Resonance Array).
- Shipyard hull BOMs: components only (`frameSegment`/`powerCoupling`/`structuralAssembly`), never raw
  (model.ts:1040, 1053, 1109, 1220, 1237 and siblings).
- Facility, storage, docks and berth rungs (listed above).
- Material salvage pools (2 salvaged materials).
- Quartermaster sell: only items with `sellValue`, today only Deuterium Ice (model.ts:6261-6266; quartermaster.ts:524-578).
- Relic studies consume no materials (relics.ts has no material cost).


## 2. Material quality today, and the seam to make `materialQualityChance` real

### 2a. What exists

- Storage: `GameState.inventory` is `Record<string, Decimal[]>`, index = quality 0..5 (inventory.ts:36-45).
  Consumption everywhere is **lowest-quality-first** (`removeItemLowestFirst`, inventory.ts:142; used by
  `startProcess`, tick.ts:5357-5360).
- **Quality above 0 IS deposited today, from three places:**
  1. Mission, patrol and talent-trickle loot: the fold in `economyTick` rolls ONE `rollQuality(rng)` per
     item key per call and deposits the whole key's delta at that tier (tick.ts:4031-4059). Odds are 0.1% per
     step, compounding (model.ts:8879-8885). A whole cycle's cargo shares one tier (tick.ts:4041-4042).
  2. Refine and material-fabricate completions: `rollQuality(rng, craftQualityBonus)` once per completed job
     (tick.ts:10897), where `craftQualityBonus` is the museum's craftingQuality (tick.ts:10839).
  3. Material salvage deposits the rolled drop at the tier's fixed quality 0/1/3/4 (salvage.ts:528,
     model.ts:6690-6729). Equipment salvage refunds and expedition hauls deposit at quality 0
     (salvage.ts:381, 709; expedition.ts:828, 856).
- **Nothing reads input quality.** Refine/fabricate output quality is a fresh roll; crafted gear quality is a
  fresh roll at INSPECT (`mintCraftedPiece`, tick.ts:10585, called from `inspectBlank`, tick.ts:10656-10689,
  seeded by `makeRng(inspectRollSeed(inspectSeed, blueprintKey))`, tick.ts:10665). Blanks are fungible
  `Record<string, Decimal>` keyed by blueprint (model.ts:5753; save.ts:234), so they carry no per-unit grade.
- **`materialQualityChance` does nothing.** It rolls on all three Prospecting Rigs (model.ts:1858,
  1863-1867; 65% of the Refinery-Feed Rig's ratios), shows as "Material Quality" (EquipmentTooltip.svelte:206),
  and `equipmentStatMods` drops it in the `default` case (model.ts:2582-2584, 2643-2646). `ShipDerivedStats`
  has no field for it (model.ts:2464-2497). model.test.ts:1416-1427 asserts it stays unfolded.
- Standard-Issue rigs carry no rolled stats (`rolledStats: {}`, model.ts:7891) and their implicit is
  `extractionYieldMult` at magnitude 0, so the stat-neutral baseline holds no `materialQualityChance`.
- The rig slot is gated to a prospector captain in a Prospector hull (model.ts:1847-1849).
- I found no per-quality material readout in the UI: the warehouse surfaces read `itemTotal` (App.svelte:975-978).

### 2b. The problem the July spec did not face

The economy's quality roll is on the SHARED injected `rng` stream (tick.ts:3486, 4052), not on a
`makeRng(seed ^ salt ^ index)` keyed stream. Parity holds because offline `tick()` and live App.svelte both
step `economyTick(_, 1)` per whole tick with the same draw sequence (tick.ts:4377-4386; App.svelte:3356). So
**any new draw on that stream, or any change in how many keys roll, shifts every later draw.** And the roll
is per KEY for the whole fleet, while the rig stat is per SHIP.

### 2c. Recommended seam: a deterministic "graded share" at the loot merge **[PROPOSAL]**

Design intent (equipment design section 5, plan Task 9b): the rig "favors quality of found materials", and
the plan asked for a CLOSED-FORM bulk resolve ("how many of N land at each quality, NOT a per-item loop").
That is exactly what this does, with zero new rng draws:

1. **Fold the stat.** `equipmentStatMods` sums `materialQualityChance` as a raw plus (like `sensors` in E1a,
   model.ts:2622-2625); `shipDerivedStats` converts it with a new `PERCENT_STAT_CURVES.materialQualityChance`
   entry (model.ts:2519-2526 pattern) into `ShipDerivedStats.materialQuality?: number`, a 0..~0.25 SHARE.
   OPTIONAL field (the `unloadSpeedMult` precedent, model.ts:2483-2490) so no fixture churn; absent reads 0.
   Strawman curve: `{ B: 0.02, r: 0.92 }` (asymptote 25%; plus 5 gives about 8.5%). TUNABLE.
2. **Split at the merge, not at the roll.** In `economyTick`'s per-captain merge (tick.ts:3949-3951), where
   `shipStats` is in scope, compute for a ship with `materialQuality > 0`:
   `graded[key] += floor(delta[key] * materialQuality)` into a new call-local `gradedDelta` map. The full
   `delta` still merges into `homePlanetDelta` exactly as today.
3. **Deposit at the fold.** In the fold loop (tick.ts:4031-4059) the existing roll is UNCHANGED
   (`quality = amount.gt(0) ? rollQuality(rng) : 0`, same keys, same order, same draw count). Then:
   if `graded[key] > 0`, deposit `graded` at `min(5, quality + 1)` FIRST, then `amount - graded` at `quality`.
   If `graded` is 0 or absent, the code path is the existing single `addToInventory` call.

Why this one:
- **Additive-neutral:** a fleet with no rig stat produces an empty `gradedDelta`, so inventory buckets AND
  the rng stream are byte-identical. Even WITH a rig, the draw count is identical (the split is arithmetic),
  so later refine/mint rolls never shift.
- **Parity-safe:** deliveries already resolve inside the per-tick step on both paths; the floor is applied per
  captain per call, identically offline and live.
- **Visible:** at 0.1% per step the existing roll alone makes a +300% chance bonus nearly invisible (about one
  q1 cycle in 250). A share means "8% of this rig's haul arrives one grade up", every cycle.
- Graded-first deposit means a cap clamp trims the ungraded units, never the better ones.
- Applies to extraction and survey deliveries. Transports deposit nothing (tick.ts:2217) so they are unaffected.

Considered and rejected: (a) `rollQuality(rng, bonus)` near-miss promotion per ship (E4b's draw-count-
invariant device, model.ts:8912-8923) needs per-ship roll groups, which ADD draws when a rig ship shares a key
with others, and is too weak at current odds; (b) a keyed `makeRng` per delivery: extraction missions carry
no cycle counter or seed to key on (`CaptainMissionState`, model.ts:2207-2224), so it would need new
persisted state for no gain over the deterministic split.

### 2d. Material quality feeds refine output and crafted gear **[PROPOSAL]**

Three pieces, each optional-field and absent-equals-today:

1. **Stamp the consumed grade at job start.** A variant of `startProcess` (tick.ts:5332) reports the
   unit-weighted average quality of everything it consumed, floored, and the line engine stamps it on the
   effect: `{ type: "addItem", ..., inputGrade?: number }` and `{ type: "addBlank", ..., inputGrade?: number }`
   (ProcessEffect, model.ts:3028-3080). Inputs are already deducted at start, so this is a read of what was
   taken, not a new reservation.
2. **Carry plus climb at completion.** `quality = min(5, inputGrade + rollQuality(rng, craftQualityBonus))`
   at tick.ts:10897. `rollQuality` is called exactly as now, so the draw count is unchanged; `inputGrade`
   absent or 0 is byte-identical (this also covers every pre-patch in-flight job).
3. **Graded blanks.** For gear to inherit the grade, blanks must remember it: migrate
   `blanks: Record<string, Decimal>` to `Record<string, Decimal[]>` (grade buckets, same lazy-grow policy as
   inventory). `inspectBlank` consumes the HIGHEST grade first and passes it to `mintCraftedPiece`, which
   applies the same carry plus climb. The inspect seed derivation (tick.ts:10640-10646) and draw order are
   unchanged, so reload-before-inspect still re-rolls the same piece. Gear quality already scales the stat
   budget (itemgen.ts:207, 1.1x per rung), so this is a real, visible payoff.

**The consumption-policy catch (needs a call, see OPEN CALL 3):** with the documented lowest-first policy, a
small stack of q1 ore sits behind an endless q0 supply and never gets consumed, so grade would almost never
flow. For the feature to be real, the player needs a way to spend the good stock. Recommendation: an optional
per-order preference `materialGrade?: "lowest" | "best"` on CraftLine/QueuedOrder (absent = lowest, today's
behavior), with a matching `removeItemHighestFirst` helper. Reservation stays total-based (allocation.ts),
so nothing in the derived-allocation model changes. This is a UI control, so it needs a mockup first.

### 2e. Material rarity (the other half of S5-128)

Plan Task 10 also said "material rarity caps craftable gear rarity". Built literally, that is a NERF to every
current craft (`rollCraftedRarity` reaches Radiant from any recipe today, model.ts:8961). Recommendation: do
not build the cap; if anything, a positive form later (rare inputs raise rarity odds). OPEN CALL 6.


## 3. Mapping the July design onto today

### 3a. What changed since July, and what it means

| July assumption | Today | Effect on this design |
|:-|:-|:-|
| `refinedMaterial` exists as a recipe input | Retired into `titaniumIngot` (model.ts:6349-6354; refine-recipes.test.ts:48-70) | Every July `refinedMaterial` becomes `titaniumIngot` |
| `components` placeholder output | Removed; `outputItem` optional (model.ts:6355-6359, 6855-6865) | July 13.2 is resolved |
| Reactor Housing reserved for a future salvage mechanic | Salvage is LIVE and the Housing has a pool (model.ts:6685) | Housing already has a consumer; nothing to add. Its hint "(a coming mechanic)" is stale (6453) |
| 12 equipment blueprints | 12 economy + 6 shield/plating + 9 weapons + 3 drones + 3 relic-gated | New slots need themes (3c, 3d) |
| Organics unused | Bio-Resonance Array takes raw organics by user spec, with a test carve-out (model.ts:7651-7655; model.test.ts:2168-2172) | Keep (OPEN CALL 10) |
| Anomalous Alloy reserved | Consumed by Damage Control Suite (7667) | Done |
| Surveys did not exist | Two surveys re-drop Lunar/Forage/Asteroid items (619, 640) | A second, later source; no new items needed |
| Fuel was mined | Fuel-to-reach (0.13.6); Deuterium Ice deprecated, sell-only | Out of the four lines (3e) |
| Refine engine single-input | Multi-input already works end to end (1c) | Compounds are pure data |
| Fabricate was instant-ish | 0.13.3 queue, 0.13.4 lanes/orders with DERIVED reservation | Section 4 risk |

### 3b. The refine and compound layer

All nine recipes below were in July's approved set (July sections 4 and 12). Items marked NEW are the seven
July-approved new items; they are new entities in TODAY's code and need the user's re-confirmation (OPEN CALL 1).

**Simple refines (single raw in):**

| Recipe | In | Out | Status |
|:-|:-|:-|:-|
| `refineFerriteIngot` | Ferrite | `ferriteIngot` NEW (heavy structural) | July-approved |
| `refineReclaimedAlloy` | Scrap Alloy | `reclaimedAlloy` (EXISTS, fixes its broken hint) | July-approved |
| `refineReclaimedCircuit` | Salvaged Circuitry | `reclaimedCircuit` NEW (recovered electronics) | July-approved |
| `refinePurifiedBiomass` | Fibrous Biomass | `purifiedBiomass` (EXISTS, fixes its broken hint) | July-approved |
| `refineIridiumCatalyst` | Iridium Ore | `iridiumCatalyst` NEW (premium catalyst) | July 12 resolution |

**Compound refines (multi-input):**

| Recipe | Inputs | Out | Feeds |
|:-|:-|:-|:-|
| `synthCobaltCoil` | Cobalt Ore + Titanium Ingot | `cobaltCoil` NEW | drives, reactors, recharge emitters, rail weapons |
| `synthOsmiumPlate` | Osmium Ore + Ferrite Ingot | `osmiumPlate` NEW | high-output reactor, capacitor bank, composite plating |
| `synthPhotonicGel` | Polysilicate Wafer + Volatile Resin | `photonicGel` NEW | survey rig, sensors, tachyon emitter |
| `synthBiocatalyst` | Purified Biomass + Exotic Spore Cluster | `biocatalyst` NEW | Refinery-Feed Rig, medical/elite quarters |

All new items: `category: "refined"`, `tier: 1`, honest `unlockHint` naming the recipe. Rarity strawman:
ingots/circuit/biomass uncommon, coils/gel uncommon, plate/catalyst/biocatalyst rare. `xpWeightNum` stays
absent (default refine weight, model.ts:6150-6171) so refining stays a weak road to crafting level.

Every compound output is a refine output, so the "no raw in equipment recipes" rule (model.test.ts:2165-2176)
and the "every refined input is producible" rule (refine-recipes.test.ts:32) both keep holding.

### 3c. Per-slot recipe rework (the July 12 slots, updated)

"Today" is the shipped recipe; "Proposed" is July's intent with today's items substituted. Anchors (the
no-wall variety) are unchanged Asteroid-spine recipes.

**CARGO BAY (structural: metals + composite)**

| Variety | Tier | Today | Proposed | Gate |
|:-|:-|:-|:-|:-|
| balancedHold (default, anchor) | 1 | frame 2 + Ti ingot 4 (7079) | unchanged | Asteroid |
| prospectorHold | 1 | frame 2 + Ti ingot 3 (7063) | frame 2 + purifiedBiomass 3 | Forage (L3) |
| haulerHold | 2 | frame 3 + structuralAssembly 1 (7092) | structuralAssembly 1 + ferriteIngot 2 + reclaimedAlloy 2 | Lunar + Salvage (L2) |

**FTL DRIVE (propulsion electronics + coils)**

| Variety | Tier | Today | Proposed | Gate |
|:-|:-|:-|:-|:-|
| balancedDrive (default, anchor) | 1 | coupling 2 + wafer 2 + Ti 1 (7134) | unchanged | Asteroid |
| sprintDrive | 1 | coupling 2 + wafer 3 (7107) | coupling 2 + cobaltCoil 2 | Lunar |
| economyDrive | 1 | coupling 2 + Ti 3 (7121) | coupling 2 + reclaimedCircuit 3 | Salvage (L2) |

**REACTOR CORE (power metals + catalysts)**

| Variety | Tier | Today | Proposed | Gate |
|:-|:-|:-|:-|:-|
| balancedCore (default, anchor) | 1 | coupling 2 + wafer 2 + Ti 1 (7175) | unchanged | Asteroid |
| efficientCore | 1 | coupling 2 + wafer 3 (7162) | coupling 2 + cobaltCoil 1 + reclaimedCircuit 2 | Lunar + Salvage (L2) |
| highOutputCore | 2 | coupling 3 + structuralAssembly 1 (7149) | coupling 3 + iridiumCatalyst 1 + osmiumPlate 1 | Asteroid rare + Lunar rare |

Note: July gave sprintDrive and efficientCore the IDENTICAL recipe (coupling 2 + cobaltCoil 2), and TODAY they
are also identical (coupling 2 + wafer 3). The proposal differentiates them (OPEN CALL 8).

**SPEC UTILITY (Prospecting Rigs: sensors + organics)**

| Variety | Tier | Today | Proposed | Gate |
|:-|:-|:-|:-|:-|
| yieldRig (default, anchor) | 1 | frame 2 + wafer 2 (7190) | unchanged | Asteroid |
| surveyRig | 1 | coupling 2 + wafer 2 (7203) | coupling 2 + photonicGel 2 | Forage (L3) or Survey Stellar (L5) |
| refineryFeedRig | 1 | Ti ingot 5 (7218) | Ti ingot 2 + biocatalyst 2 | Forage (L3) |
| damageControlSuite, pathfinderSuite (relic-gated) | 2 | user-specified in E4d | unchanged | relic |

The Refinery-Feed Rig being built from the bio-catalyst is the thematic tie to the quality stat it carries.

### 3d. Slots that did not exist in July **[PROPOSAL, every row]**

Shields, plating, weapons and drones have live blueprints today; the proposals only change INPUTS. Sensor,
bridge and quarters blueprints do not exist yet: their blueprints are owned by other 0.14.0 work the user
already approved (A5 "early sensor path", S4-I12; E-CREW "crew modules get a blueprint", S4-CP23). This doc
only proposes their MATERIAL THEMES so those phases do not each invent a different economy.

**SHIELD EMITTERS (energy: couplings + coils + plate)**

| Variety | Tier | Today | Proposed |
|:-|:-|:-|:-|
| balancedEmitter (anchor) | 1 | coupling 2 + wafer 2 + Ti 1 (7466) | unchanged (Asteroid) |
| rechargeArray | 1 | coupling 2 + wafer 3 (7478) | coupling 2 + wafer 1 + cobaltCoil 2 (Lunar) |
| capacitorBank | 2 | coupling 3 + wafer 3 + SA 1 (7490) | coupling 3 + wafer 2 + SA 1 + osmiumPlate 1 (Lunar rare) |

**HULL PLATING (heavy metals)**

| Variety | Tier | Today | Proposed |
|:-|:-|:-|:-|
| reinforcedPlating (anchor) | 1 | Ti 3 + frame 1 (7504) | ferriteIngot 2 + Ti 1 + frame 1 (Lunar, ungated, so still no-wall) |
| ablativePlating | 1 | Ti 2 + frame 2 (7516) | reclaimedAlloy 2 + frame 2 (Salvage L2) |
| compositePlating | 2 | Ti 3 + frame 2 + SA 1 (7528) | Ti 1 + frame 2 + SA 1 + osmiumPlate 1 + reclaimedAlloy 1 |

**WEAPONS (9) and DRONE PODS (3)** (recommend a lighter touch, OPEN CALL 7): keep each family's T1 staple on
the spine (plasma 7256, autocannon 7297, point-defense 7338, attack pod 7405) as the anchors, and theme the T2s:
graviton + cobaltCoil, voltaic + cobaltCoil + reclaimedCircuit, railgun swaps 2 Ti for 2 ferriteIngot +
cobaltCoil 1, concussion torpedo + osmiumPlate 1, EMP cannon + reclaimedCircuit, tachyon emitter + photonicGel,
defense pod + reclaimedCircuit, support pod + purifiedBiomass (repair foam).

**SENSOR ARRAYS (A5 owns the blueprints)**: Balanced Array = wafer 3 + coupling 1 + frame 1 (Asteroid
anchor, which is what makes A5's "early sensor path" reachable on day one); Wide-Beam = wafer 2 + photonicGel 2
+ frame 1 (Organic); Focused-Beam = reclaimedCircuit 3 + coupling 1 + wafer 1 (Recovered tech). Bio-Resonance
unchanged.

**BRIDGE (3) and QUARTERS (9) (E-CREW owns the blueprints)**: Balanced Command and Utilitarian Quarters on
the spine (frame + Ti + coupling) as anchors; Focused Command + reclaimedCircuit; Flag Command (premium) +
iridiumCatalyst. Quarters wings themed by division: Security ferriteIngot, Engineering cobaltCoil,
Science photonicGel, Medical biocatalyst, Operations reclaimedCircuit, Flight-Deck cobaltCoil + frame;
Efficient Quarters purifiedBiomass (life support), Elite Quarters biocatalyst + reclaimedAlloy.

### 3e. Items that stay outside the four lines

- **Deuterium Ice:** deprecated, no live source (localFuelRun is hidden), sell-only. The approved-but-unbuilt
  S4-A05 ("deuterium as the crafting input for reach") cannot be satisfied by Material Lines without a live
  source. Its `unlockHint` still says to refine it at the Fuel Depot (model.ts:6340): stale regardless of the
  call. OPEN CALL 9.
- **Dense Ore:** deliberate T2 stub, keep.
- **Precursor Circuit, Intact Data Core:** keep RESERVED. Their natural homes are the two discovery projects
  E4d explicitly deferred (Precursor Lens module, Heart of the Archive's Neural Backup, model.ts:7646-7649).
  Giving them a Material Lines sink now would pre-empt those. OPEN CALL 11.

### 3f. Usage tally and no-wall check

After 3b + 3c, every raw/salvaged item except Deuterium Ice and Dense Ore has a consumer: the six orphans
(Iridium, Ferrite, Cobalt, Osmium, Scrap, Circuitry) are wired, and the organics gain non-relic sinks.
`reclaimedAlloy` and `purifiedBiomass` gain producers. With 3d, every new item has 2 or more consumers.

Mission gates (verified): Local Asteroid and Lunar Mine have no capability gate (model.ts:497-546); Salvage
needs captain L2 + cargo 90 (566-569); Forage L3 + cargo 90 (589-590); surveys L4 / L5 (625, 646).
Every slot keeps an Asteroid or Asteroid+Lunar anchor variety (bolded "anchor" rows). Salvage/Forage materials
are only ever required by a non-anchor variety, so July's no-wall rule holds. July call 4 (aligning research
availability to mission tier) stays deferred as the user resolved; the Fabricator's "missing X" readout is the
honest feedback.


## 4. Save, migration and in-flight risk

`SAVE_VERSION` is 64 (save.ts:43). 0.14.0 may bump it further before E-MAT lands; whatever is next at build time.

- **New ITEMS keys: no bump.** Inventory is grow-on-demand (inventory.ts:20-26; addToInventory tick.ts:3403),
  absent keys read 0, new items start undiscovered and reveal on first positive deposit. `clampInventoryToCaps`
  on load only touches held stacks.
- **New REFINE_RECIPES / changed blueprint inputs: no bump.** Static data, never persisted.
- **ShipDerivedStats.materialQuality, ProcessEffect.inputGrade, CraftLine/QueuedOrder.materialGrade: no bump**
  if all are OPTIONAL with absent = today's behavior. Old in-flight jobs simply have no `inputGrade`.
- **Graded blanks (2d.3): needs a bump** (vN -> vN+1): wrap each `blanks[key]` Decimal into `[Decimal]`
  (grade 0) and teach `hydrateDecimalMap` (save.ts:234) the array shape. Only needed if OPEN CALL 5 says yes.
- **In-flight jobs: SAFE.** `startProcess` deducts inputs at start (tick.ts:5357-5360) and the effect
  (output item + amount, or the blank's blueprint key) is stored on the process (tick.ts:7666, 7701), so a
  completion never re-reads a recipe. A job started under an old recipe finishes exactly as started.
- **Active lines and queued orders: the real risk.** Reservation is DERIVED from the current recipe every read
  (allocation.ts:183-205; queued orders 257, 477), and each new iteration is costed by `lineJobSpec`
  (tick.ts:7651-7705). After the patch, an active batch or continuous line for a reworked blueprint (for
  example `sprintDriveBp`) reserves and consumes the NEW inputs for its remaining iterations. If the player
  lacks `cobaltCoil`, `startProcess` refuses and the line waits (tick.ts:7789): no loss, no crash, no
  negative bucket, but a stalled order the player did not expect. Mitigation: patch note + the existing
  "waiting on X" readout; no migration. Recipe KEYS are never renamed or removed, so no line goes inert.
- **Stale-hint fixes** ride along (display-only): Reactor Housing hint (6453), Deuterium Ice hint (6340).


## 5. Test strategy (mirrors July section 9, plus quality)

1. **Refine + compounds:** each new recipe produces the right output from the right inputs; multi-input
   recipes deduct ALL inputs atomically and refuse when any one is short; allocation reserves every input.
2. **Reworked blueprints:** each consumes its new inputs and still produces its blank / mint / stackable;
   the no-raw rule and the producible-refined-chain rule still pass; update the "intended spread" test
   (model.test.ts:2179-2196) to the new set.
3. **No-wall (standing):** for each slot with blueprints, at least one non-relic-gated variety's full input
   tree (walked through REFINE_RECIPES + material BLUEPRINTS) bottoms out in Asteroid + Lunar raws only.
4. **Every raw has a sink (standing rule July asked for):** every `raw` and `salvagedMaterial` item is consumed
   by a refine input, a blueprint input, a hull BOM, a facility/storage/docks/berth rung, a salvage pool key,
   or a Quartermaster `sellValue`, OR is explicitly reserved. Extend it to every PRODUCIBLE refined/component
   item too. Reserved marker: today the convention is hint text "reserved for a future recipe"
   (model.test.ts:1737-1750); I recommend a typed `reserved?: string` on ItemDef instead **[PROPOSAL]**
   (static data, no migration) so the test does not string-match.
5. **Distinct recipes (standing):** no two varieties of one slot share an identical input map.
6. **Material quality, fold:** the rig stat folds into `materialQuality`; a Standard-Issue rig folds to 0;
   update model.test.ts:1416-1427 (which asserts the stat is reserved).
7. **Additive-neutral:** a seeded fleet with no rig produces byte-identical inventory buckets AND an identical
   rng draw count versus the pre-change engine (wrap the rng to count calls).
8. **Graded share:** delta 100 at share 0.1 deposits 10 at tier+1 and 90 at tier; tier 5 stays 5; a cap clamp
   trims ungraded units first; the draw count with a rig equals the draw count without.
9. **Parity:** extend quality-roll.test.ts so one offline `tick()` span equals stepped live `economyTick(_,1)`,
   bucket for bucket, with a rig ship in the fleet and a graded refine line running.
10. **Grade carry:** a best-first line consuming q2 inputs stamps `inputGrade 2` and its output lands at
    `>= 2`; a process without `inputGrade` (old save) resolves identically; lowest-first default is
    byte-identical.
11. **Blanks migration (if approved):** counts preserved into grade 0; a grade-g blank inspects to quality
    `>= g`; reload-before-inspect re-rolls the same piece.
12. **In-flight safety:** a pre-patch fabricate job completes off its stored effect; an active line on a
    reworked recipe waits (no throw, no negative bucket) when short and resumes when stocked.


## 6. Scope boundaries (not in E-MAT)

No new slots, varieties or stats. No new missions or loot-table changes. No stat-magnitude rebalance (the
0.16.0 balance patch owns numbers). No material-rarity cap (unless OPEN CALL 6 says otherwise). Sensor /
bridge / quarters BLUEPRINTS are authored by A5 / E-CREW, using the themes in 3d if approved.

## 7. OPEN CALLS for the user

1. **Re-confirm July's 7 new items and 9 refine recipes** (ferriteIngot, reclaimedCircuit, iridiumCatalyst,
   cobaltCoil, osmiumPlate, photonicGel, biocatalyst) as approved in July, now against today's game. Names OK?
2. **Material Quality mechanic:** the deterministic graded share (a % of the rig ship's haul arrives one grade
   up, zero new rng draws; my rec) vs a chance-style bonus on the existing roll (weak at current odds, and
   costs extra draws). Plus the curve: strawman asymptote 25%.
3. **Spending good stock:** grade only flows into crafts if high-grade units get consumed. Options: (a) a
   per-order "Use best materials" toggle, default lowest-first (my rec, needs a mockup); (b) make best-first
   the default for craft lines; (c) leave lowest-first and accept the feature is mostly dormant.
4. **Grade carry formula:** unit-weighted average of consumed grades, floored, then `grade + roll` (my rec) vs
   weakest-link (lowest grade consumed) vs a floor-only `max(grade, roll)`.
5. **Should crafted gear inherit grade?** Requires graded blanks and a save bump (my rec: yes, it is the
   visible payoff), or limit grade carry to stackable refine/material outputs this release.
6. **Material rarity cap (Task 10's other half):** skip (my rec; as written it nerfs every current craft),
   build a positive form later, or build the cap.
7. **Scope of the recipe pass:** July's 4 economy slots + shields/plating (my rec for E-MAT), weapons and
   drones now or deferred to 0.16.0, and whether A5 / E-CREW adopt the sensor/bridge/quarters themes in 3d.
8. **sprintDrive vs efficientCore** share an identical recipe today and in July; approve the differentiation
   in 3c (or name a different one).
9. **Deuterium Ice:** stays sell-only with a corrected hint (my rec for E-MAT), or revive S4-A05 (reach
   crafting input), which first needs a live deuterium source decision.
10. **Bio-Resonance Array** keeps its user-specified raw organics (my rec) vs moves to refined organics now
    that purifiedBiomass/photonicGel/biocatalyst exist (would retire the test carve-out).
11. **Precursor Circuit and Intact Data Core** stay reserved for the deferred Precursor Lens / Neural Backup
    projects (my rec) vs get a Material Lines sink now (e.g. Flag Command).
12. **haulerHold / highOutputCore:** July dropped `structuralAssembly` from both; today both use it. Keep SA
    alongside the themed inputs (my table keeps it on haulerHold, drops it on highOutputCore per July), or
    pick one rule for both.
13. **Legibility:** the Refinery list grows from 2 to 11 recipes (group by line?) and there is no per-quality
    material readout anywhere. Both are UI surfaces that need a mockup before build.
14. **`reclaimedAlloy` is tagged `rare`** while it refines from common scrap. Retag to uncommon (display only)?
