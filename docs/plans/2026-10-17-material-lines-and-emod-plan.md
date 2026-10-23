# Material Lines + E-MOD (universal modules and the power budget): 0.14.0 G8 PLAN

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan slice by slice
> (fresh subagent per slice, review between slices, two-stage review at the end), after the user answers section 5.

Status: PLAN DRAFT for user review (2026-10-17). Doc only; no game code changes with this file. Branch
`feat/crew-0.14.0`. Owner list: E-CREW plan G8 ("E-MOD universal modules, ... the power grid (S4-A03), deuterium as a
reach-crafting input (S4-A05), Material Lines"). E-CAP and the gas giant study (15b) are the other G8 items and are
NOT in this plan.

**Authority order:** the user's decisions (section 1), then the approved designs they sit in, then this plan, then code.
**Markers:** `(user)` = the user's decision. **[PROPOSAL]** = mine; every name, number, rule and formula so marked is
the user's to accept, change or reject, and no [PROPOSAL] entity exists until the user approves it. **[PROVISIONAL]** =
a build default used only if a call is still open when its slice starts (respect-continue rule), flagged in the commit.

Sources reconciled (all read 2026-10-17): `2026-10-02-material-lines-0.14.0-design.md` (the E-MAT draft, its 14 open
calls, none answered in that doc); the July design's section 12 resolutions (`july.md`, branch
`feat/material-lines-0.11.1`); `2026-10-02-crew-made-real-e-crew-plan.md` (G8, Task 22, E-MOD markers);
`2026-09-24-exploration-0.14.0-plan.md` (E0, E4d, E-MOD, INVENTORY GAP FIXES); `2026-09-15-exploration-crew-saga-0.14.0-design.md`
(A.3, A.4, B.3, B.4, H.1, H.2); `2026-07-31-combat-1.0-integration-design.md` (sections 3, 10; DECISION 3a, 10a);
`2026-07-22-combat-0.13.0-design.md` (section 10); `2026-10-15-wiring-registry-and-audit-plan.md` (OC-C2, OC-C3, OC-D1,
OC-D2, OC-D3, OC-D4, OC-D12, OC-J3, B10, the WR-4 carry note, USER ANSWERS); `2026-10-14-complement-and-acquisition-plan.md`
(CP-11, CP-13, OC-13, OC-14, OC-15, OC-16); `2026-10-14-expedition-tiers-g2-plan.md` (G2-4 drive classes, USER ANSWERS);
`2026-10-16-gear-wear-design.md` (4.3, 4.4, USER ANSWERS); `2026-10-16-credit-sinks-pass.md` (OC-C10); 
`2026-10-08-gas-giant-study-design.md` (sections 1, 1b, 6); `2026-10-17-gas-giant-study-plan.md` (GG-1, open calls 5
and 7, committed `8d15719` while this plan was written); `2026-10-16-prospecting-squads-design.md` (GRADE);
`2026-10-17-small-calls-answers.md` (S2); the Ship Modules and Sensors mockup (scratchpad
`ship-modules-sensors-mockup.html`, artifact GoYVwi6k13P6KvxRrzRicN); SUGGESTIONS.md (the SUS + modules entry, Mystery
Repairable Components, Combat 1.1 future bites); and the code: `combat/power.ts`, `model.ts` (`ShipTypeDef`,
`ShipDerivedStats`, `equipmentStatMods`, `SLOT_BASE_PHYSICALS`, `generateStandardIssue`, `REFINE_RECIPES`, `ITEMS`,
`BLUEPRINTS`), `itemgen.ts`, `equipment.ts` (`canFitEquipment`), `crewModules.ts`, `crewOverlay.ts`, `crewBuffs.ts`,
`crewRaces.ts`, `seniorStaffBonuses.ts`, `combat/durability.ts`, `combat/resolveBattle.ts`, `wiring/registry.ts`,
`relics.ts`, `save.ts`.


## 1. The user's words (verbatim)

**Scope and purpose**
- 2026-10-02 (inventory gap fixes): "roll it into 0.14.0 as a bug fix that adds in proper functionality for those gaps
  and timing calls."
- 2026-10-09 (scope ruling): "If something I've said here is not part of the scope (within reason), make it part of
  the scope of 0.14.0."
- H.1 universal modules, LOCKED 2026-09-23: modules are "always planned for 0.14.0". Accessory layer (weapons = weapons,
  ship systems = armor, modules = accessories), UNIVERSAL on any hull's generic `moduleSlots`, explorer and science
  hulls carry more as identity. Categories: Passive, Proc (on-hit / per-tick / on-mission-complete), Conditional,
  Active (idle-safe AUTO-cast via a gambit-like rule; MANUAL reserved for 2.0), Set. The draw is UNIQUE options you
  cannot get anywhere else. NO baked-in downsides (the tradeoff idea is spun off as future "chaotic gear", H.2).
  Sourcing: BOTH craftable AND salvage-exclusive (salvage, a precursor item, repair, a chance at an exclusive module).
- E4d resolution 2026-10-01: "Precursor Lens's special module ships WITH the module phase (E-MOD) as its first content",
  a unique proc crafted with Precursor Circuit.

**Power budget**
- OC-D1 (2026-10-15): "Install gate + combat penalty (Recommended)": canFitByPower at the install check plus a combat
  over-budget penalty; Reactor Overdrive, Power Discipline and the Martian racial act on it.
- B.4 power grid, LOCKED archetypes 2026-09-16: "Every hull is defined by how it divides ONE power grid across weapons /
  shields / drive-and-range / cargo." Explorer = power-RICH, by far the longest range.
- OC-15 (2026-10-16): "Add tiers 3-7 now (Recommended)": Lab levels 3 to 7 (drive classes II to VII, top modules).
- G2 OC-3 (2026-10-16): "A combination of higher tier ships and better drive blueprints/stats/etc."
- OC-D4 (2026-10-16): "Cap module-class slots (Recommended)" (the proposal named bridge, quarters, sensor, specUtility).
- Gear wear W3 (2026-10-16): "True condition" (gear fights at its real condition); the wear design keeps every gate,
  the power-budget install gate included, on PRISTINE values.
- S2 (2026-10-17): "Lock it (Recommended)": no ship gear changes while the ship is out.
- OC-C10 (2026-10-16): no crafting fees.
- OC-K3 (2026-10-16): "Text that claims no effect (Recommended)": anything with a number and % or + must be a real
  tested effect. Memory "Everything wired" (2026-10-15): no placeholders, every bonus measurably acts.
- D23 (2026-10-08): diminishing returns, never hard caps, on stacking bonuses.

**Material Lines**
- July section 12 (2026-07-18): Iridium refines into `iridiumCatalyst` for the High-Output Core; "Call 3 (compounds):
  CONFIRMED. Keep photonicGel, biocatalyst, cobaltCoil, osmiumPlate"; "Call 5 (item count): CONFIRMED" (7 new refined
  items); Call 4 (mission-tier alignment) DEFERRED, honest "you lack X" feedback instead.
- OC-C3 (2026-10-15): "Add Refinery recipes (Recommended)" (Scrap Alloy into Reclaimed Alloy, Fibrous Biomass into
  Purified Biomass). BUILT in WR-4.
- OC-D2 (2026-10-15): "Chance to upgrade a unit (Recommended)": each delivered unit may climb one quality step.
- OC-J3 (2026-10-16): "Sell now, recipes later (Recommended)" (Salvaged Circuitry, Precursor Circuit).
- OC-C2 (2026-10-15): "Add a Dense Ore source (Recommended)". BUILT in WR-4 as the Lunar Mine's uncommon strike.

**Deuterium**
- Saga A.4 [PROPOSED there, carried into 0.14.0 by the G8 ruling]: "Deuterium becomes the crafting input for reach ...
  You mine it to build range, not to top off a tank."
- Saga A.2 (the fuel lesson): "If you build a system, and then find it feels so bad you have to gently bypass it to make
  it feel remotely good, you have a problem with that system." Playtesters on the fuel-duty captain: "annoying that one
  of my captains has to stay there and is a far lower level as a result."
- Gas giant (2026-10-08): "Canisters of compressed gases. Deuterium Ice would fit this as well. Processed into a
  canister-stored version." 1b-4: six canisters by quality band, "2 standard, 2 augmented, 1 stellar and 1 radiant".


## 2. Reconciliation (what changed, what conflicts, what is already done)

### 2.1 Material Lines: the E-MAT draft against today

| E-MAT draft item | State 2026-10-17 | Effect on this plan |
|:-|:-|:-|
| OC 1: 7 new items + 9 recipes | July CONFIRMED the 7 items and 4 compounds. WR-4 BUILT `refineReclaimedAlloy` (Scrap 10:1) and `refinePurifiedBiomass` (Biomass 6:1) | 7 recipes and 7 items left. Re-confirm against today only (call L1) |
| OC 2: quality mechanic | ANSWERED by OC-D2: "chance to upgrade a unit" | Built as an exact expected count plus one keyed rounding roll (call L4 picks the implementation, not the mechanic) |
| OC 9: Deuterium sell-only | SUPERSEDED: S4-A05 is G8 scope (2026-10-09 ruling) | ML-6 builds a source and consumers (calls L8, L9) |
| OC 10: Bio-Resonance raw organics | ANSWERED by OC-C3 build: it takes 2 Purified Biomass now | Closed |
| OC 11: Precursor Circuit, Intact Data Core | Intact Data Core is consumed by Neural Backup (built, E-CREW Task 7). Precursor Circuit: OC-J3 "sell now, recipes later" | Precursor Circuit becomes the Precursor Lens module input (EM-8). Its sellValue (WR-10, OC-J3) stays |
| 3c gates "Lunar" for Cobalt | OC-C2 replaced the Lunar Mine's Cobalt with Dense Ore; Cobalt now drops only on Survey Mineral Anomaly (captain level 4) | Cobalt Coil varieties gate at level 4; anchors keep the no-wall rule (call L3) |
| 3d bridge / quarters / sensor themes | CP-11 decided "inputs are existing components only. No Material Lines dependency." | Not re-themed here unless the user says so (call L2) |
| Gas giant canisters overlap | The 15b build plan (`8d15719`) owns all six canisters: GG-1 adds `deuteriumCanister` and the Refinery recipe Deuterium Ice x10 into one canister; its open call 7 asks where canisters are used (G2 drive classes, Helium-3 reactors, modules) | Material Lines does NOT add the canister or its recipe. ML-6 adds only an early Deuterium Ice source (call L8) and wires the consumers once, sharing ONE answer with GG call 7 (call L9) |
| Terminology "grade" | Prospecting squads now own **GRADE** (the common/uncommon/rare tier roll) | This plan says QUALITY for the 0..5 axis: `inputGrade` becomes `inputQuality`, `materialGrade` becomes `materialPreference` |
| OC-D2 ownership | The wiring plan lists OC-D2 under WR-7 | ML-3 builds it; WR-7 drops the row (call X1) |

Code facts re-verified: `REFINE_RECIPES` has 4 recipes (model.ts ~7930); none of the 7 new items exist; `materialQualityChance`
still drops in the `equipmentStatMods` default case; only `deuteriumIce` carries a `sellValue` (40); `localFuelRun`
(Local Deuterium Skim) is still defined, yields only `deuteriumIce`, and is hidden from every mission list
(App.svelte ~9518); the economy quality roll is still on the shared injected stream (standing rule: never add a draw to
it); blanks are still `Record<string, Decimal>` (save.ts hydrate).

### 2.2 E-MOD: the power budget against today

- `combat/power.ts` (`powerBudget`, `canFitByPower`, `totalPowerDraw`) is pure, integer, exact-equal-allowed, and has
  no non-test caller. `ShipDerivedStats.powerOutput` / `powerDraw` are display only (ShipSystemsPanel rows "Power Output",
  "Power Draw", whose tooltips already promise "keep it at or under power output").
- **Critical finding: no hull has a base power output.** `ShipTypeDef` carries no power field (only a commented
  `reactorTier` forward hook). Standard-Issue pieces draw 0 and the Standard-Issue Reactor Core supplies 0
  (`STANDARD_ISSUE_IMPLICIT_MAGNITUDE = 0`). Crafted pieces draw real power (cargo 2, FTL 4, reactor 1, utility 2,
  shields 6, weapons 8 to 35 by type, drone pods 10). A literal install gate today would refuse EVERY crafted piece on a
  ship with the Standard-Issue reactor, and crafted weapons are live on production. So a hull base output is required
  (call P1). Maximum crafted draw per hull today: Freighter and Hauler 85, Runner and Prospector 50, Destroyer 155,
  Battleship 225, Carrier 105, the three explorers 50.
- A crafted Reactor Core's `powerOutput` implicit is about iLevel at Standard quality (budget = iLevel x 2 x 1.1^q x
  1.15^r, half to the implicit), so a tier 1 core supplies about 20 to 40. Its base mass 12 drags speed and fuel
  (`MASS_SPEED_DRAG`), so it is net negative today (B10). The gate alone fixes nothing for a ship with nothing extra to
  power (call P3).
- Combat already models "power starvation": `reactorDamagePercent` (Degraded 90, Offline 70) is a global weapon-damage
  multiplier (resolveBattle.ts ~821). The over-budget penalty composes with it as one more integer percent.
- Reactor Overdrive (`officer.powerEfficiencyMult`, 0.1), Power Discipline (`crew.powerEfficiency`, 0.002) and the
  Martian racial (senior 0.05, complement 0.0005) all key `crew.powerEfficiency`. The registry probe already exists:
  `sheetPowerDraw` on a ship with a powered cargo bay. They sit in `OFFICER_BONUSES_PENDING_IN_RELEASE` and the
  registry `E_MOD` pending set; Task 22's test fails if they are still there after E-MOD lands.
- The E-CREW design's "Engineering power facet" no longer exists: officerStats.ts gives Engineering's four facets to
  shield recharge, a free repair tick, voyage fuel efficiency and repair speed. Nothing to wire.
- Gear wear (approved): the install gate reads PRISTINE values (4.3). In combat the four-state model stays the authority
  for the reactor (4.4) and W3 makes it open at true condition. So the over-budget check uses the pristine output, and
  wear keeps acting only through `reactorDamagePercent`: no double penalty.
- Combat 1.0 DECISION 3a recommended that power gate installs, not dispatch; this plan keeps that (no dispatch block).

### 2.3 E-MOD: modules against today and against later answers

- `moduleSlots` (1 to 5 per hull) is read nowhere. `EquipmentSlotType` has no module slot. Logistics shows "Modules" as
  a "coming soon" chip (`LOGISTICS_RESERVED_GOODS`).
- **Conflict to settle (call M1):** H.1 (LOCKED) puts universal modules on `moduleSlots`; OC-D4 (answered later, inside
  the wiring audit, before E-MOD was planned) makes `moduleSlots` a cap on bridge, quarters, sensor and specUtility.
  Both cannot hold at today's counts: a Freighter (1) could not carry a bridge AND quarters, let alone a module. OC-D4 is
  not built yet (WR-7 has not started), so E-MOD can settle it before code exists.
- **Combat 1.1 leftovers have moved (call M5):** the exploration plan said they "ride E-MOD", but OC-D12 ("Feed them
  all") sends rapid charge, in-combat replenish and smart reflect to defense-pod lines, Overcharged Capacitors to the
  support drone pulse and the cloak detector to sensors (deferred to 0.14.x, CP-15). What still belongs to E-MOD is the
  ACTIVE-ABILITY ENGINE (the bounded trigger taxonomy of Combat 1.0 section 10, DECISION 10a) and the power gate.
- Crew modules (`crewModules.ts`) are the pattern to copy: an `EquipmentInstance` with `moduleVariant` stamped to a
  catalog id, effect scaled by `moduleEffectScale(rarity, quality)` (+12% per rarity band, +6% per quality rung). The
  Ship Modules and Sensors mockup covers ONLY bridge, quarters and sensors; **no mockup covers universal modules or the
  power readout**, so E-MOD UI needs a new sign-off.
- Precursor Lens: the relic and its first-find moment exist (relics.ts `precursorLens`, rare, Precursor set); the
  blueprint was deliberately not authored (model.ts ~9387). Adding it is a data change with `requiresRelicDiscovery`.
  Relics v2 (G3, not designed yet) may rename relics by culture; the id stays, so EM-8 does not wait on G3.
- The salvage-exclusive loop is the narrow form of SUGGESTIONS "Mystery Repairable Components" (S54: "E-MOD keeps
  only 'repair, chance at an exclusive module'"). Its open questions (venue, double lottery and pity, set iLevel vs the
  crafting ceiling) are unanswered.
- E-SUS (the 8 SUS roles) stays blocked on the user's names and is NOT modules (H.1: SUS = function, modules =
  personality).


## 3. Data model and save impact

### 3.1 Material Lines

- `ITEMS` += 7 refined items **(July-approved names; re-confirm, call L1)**: `ferriteIngot` (Ferrite Ingot),
  `reclaimedCircuit` (Reclaimed Circuit), `iridiumCatalyst` (Iridium Catalyst), `cobaltCoil` (Cobalt Coil), `osmiumPlate`
  (Osmium Plate), `photonicGel` (Photonic Gel), `biocatalyst` (Biocatalyst). `category: "refined"`, tier 1, honest
  `unlockHint` naming the recipe. (`deuteriumCanister` and its refine belong to GG-1, not here.)
- `REFINE_RECIPES` += `refineFerriteIngot`, `refineReclaimedCircuit`, `refineIridiumCatalyst`, `synthCobaltCoil`
  (Cobalt Ore + Titanium Ingot), `synthOsmiumPlate` (Osmium Ore + Ferrite Ingot), `synthPhotonicGel` (Polysilicate
  Wafer + Volatile Resin), `synthBiocatalyst` (Purified Biomass + Exotic Spore Cluster). Ratios and durations [PROPOSAL], each duration a whole number of ticks that keeps the
  speed rung's XP per tick exact (the WR-4 rule).
- `ItemDef.reserved?: string` [PROPOSAL]: typed reserved marker replacing the hint-string test match.
- `ShipDerivedStats.materialQuality?: number` (OPTIONAL, absent reads 0): the rig's `materialQualityChance` folded
  through a new `PERCENT_STAT_CURVES.materialQualityChance` entry (D23 concave, no cap) into the per-unit climb chance.
- `ProcessEffect.inputQuality?: number` (OPTIONAL) on `addItem` / `addBlank`; `CraftLine` / `QueuedOrder`
  `materialPreference?: "lowest" | "best"` (OPTIONAL, absent = lowest, today's behavior); `removeItemHighestFirst`.
- Blanks with quality (call L7 a): `blanks: Record<string, Decimal[]>` (quality buckets, lazy grow like inventory).
- New salt `MATERIAL_QUALITY_SALT`, exported and listed in `salts.test.ts` MODULES.

### 3.2 E-MOD power budget

- `ShipTypeDef.basePowerOutput: number` **[PROPOSAL values, call P1]**, the hull's own generation (B.4 grid). Option (a)
  values: Freighter 85, Hauler 85, Runner 50, Prospector 50, Destroyer 160, Battleship 230, Carrier 110, Orion 130,
  Aurora 150, Eir 120 (each at or above today's maximum crafted draw; explorers well above as the power-rich identity).
- `ShipDerivedStats.powerOutput` = base + reactor implicit + any module `powerOutput` line. `powerDraw` = the NET
  draw after power efficiency: `ceil(grossDraw / (1 + diminishing(e, POWER_EFFICIENCY_KNEE)))`, `e` = the ship's summed
  `crew.powerEfficiency` (call P4). New derived `reactorSurplus` = `min(reactorOutput, max(0, output - draw))` (call P3).
- `EquipFitBlockReason` += `overPower` (reason text names the shortfall: "Needs 12 more power. Install a stronger Reactor
  Core or remove a powered system."), `moduleSlotsFull`, `duplicateModule` (call M8).
- One pure reader `shipPowerBudget(state, shipId, candidate?)` wrapping `power.ts`; every install path calls it.
- FTL drive class draw (call P5): `DRIVE_CLASS_POWER_DRAW[class]` [PROPOSAL x1.6 per class above I] read by G2-4's
  drive blueprints.
- Combat: `CombatShip.powerSupplyPercent?: number` (absent = 100), frozen when the battle is built (bridge.ts), applied
  beside `reactorDamagePercent` (call P6).

### 3.3 E-MOD modules

- `EquipmentSlotType` += `"module"`, a MULTI slot (joins `MULTI_SLOT_TYPES`), capped per call M1 (option a: by
  `SHIP_TYPES[hull].moduleSlots`). `SLOT_BASE_PHYSICALS.module` = `{ mass: 0, powerDraw: per def, durability: 100 }`.
- New `src/lib/game/shipModules.ts` [PROPOSAL file name]: `UNIVERSAL_MODULES: UniversalModuleDef[]` and pure readers.
  ```ts
  interface UniversalModuleDef {
    id: string; label: string;                       // id == the stamped moduleVariant
    category: "passive" | "proc" | "conditional" | "active" | "set";
    contexts: ("patrol" | "shipEvent" | "mission" | "expedition")[];
    trigger?: ModuleTrigger;                          // the bounded taxonomy, call M4
    effect: { key: string; magnitude: number };      // scaled by moduleEffectScale (crewModules.ts)
    chance?: number; cooldownTicks?: number; oncePerBattle?: boolean;
    condition?: { kind: "hullBelow" | "shieldBelow"; value: number };
    setId?: string;
    powerDraw: number;
    source: "craft" | "discovery" | "salvageExclusive";
  }
  ```
- Mint: the existing `generateEquipment` path with a module slot entry in `EQUIPMENT_SLOTS` (varieties = catalog ids),
  so rarity, quality, iLevel, salvage, Armory storage, Archive rows and `isSparePiece` all follow.
- Combat: `CombatShip.moduleProcs?` frozen per patrol cycle like `officerCombat`; resolveBattle reads them at the trigger
  points. Procs draw from a PRIVATE stream `makeRng(battleSeed ^ MODULE_PROC_SALT ^ shipIndex)`, never the combat
  stream, so a ship with modules leaves every other draw unchanged.
- Missions: an `onMissionCycle` proc keys `makeRng(seed ^ MODULE_CYCLE_SALT ^ captainKey ^ cycle)` with the Command
  Presence per-run cycle counter as precedent (CaptainMissionState ~3009). Expeditions: frozen in the dispatch snapshot.
- Wear: modules wear like crew modules (time underway, slowly) [PROPOSAL, call M9].

### 3.4 Save impact (SAVE_VERSION 70, not yet on staging)

Staging is 0.13.10 (save 54); v70 is the shared unreleased 0.14.0 bump. Any step this plan needs **appends to
`MIGRATIONS[69]` and to the "WHAT v70 CONTAINS" list in save.ts** (after `dropRetiredFuelV70` and SF-1's
`withRunCountsV70`, and G2-1's step if it lands first); no v71.

| Change | Save effect |
|:-|:-|
| New items, recipes, blueprint inputs, `reserved`, `basePowerOutput`, drive class draw, module catalog | None: static data; inventory and the equipment pool are open-keyed |
| `materialQuality`, `inputQuality`, `materialPreference`, `powerSupplyPercent`, `moduleProcs` | None: optional, absent = today |
| Module pieces (`slotType: "module"`) | None: no old save holds one |
| Quality blanks (call L7 a) | **Step appended to MIGRATIONS[69]**: `bucketBlanksV70` wraps each `blanks[key]` into `[count]` (quality 0); `hydrateDecimalMap` learns the array shape. FROZEN constants only |
| Active rule choice (call M3 b only) | None: optional `moduleRule?` on the instance |
| Salvage-exclusive loop (call M2 b only) | None: new items, a new `TimedProcessKind`, optional `modulePity?` (absent = 0) |
| Unhiding Local Deuterium Skim (call L8 a) | None: the v51 to v52 cleanup already cleared captains; the mission def is unchanged |

Production impact at 0.14.0 (patch notes): with P1 (a) no live loadout goes over budget; ships with a crafted Reactor
Core gain the surplus speed (P3 a); Archive completion % drops by the new blueprints (the Task 10 precedent).


## 4. Slices

Standing rules apply to every slice (E-CREW plan "Standing rules"): gate = `npm run check` (0 errors; the 2 known
RadialWeb warnings) + `npx vitest run`; additive-neutral; determinism only via `makeRng(seed ^ salt ^ index)`; never a
new draw on the shared economy stream; one commit per slice listing closed inventory rows and registry ids; US English,
no em dashes, "install" in player text; SVG glyphs in icons.ts + ICON_SEMANTICS.

**Goldens first.** ML-0 and EM-0 capture hashes before any behavior change; every later move is explained in the
commit (which hash, why, and the proof that zeroing the new effect reproduces the old hash).

### Material Lines (ML)

**ML-0 Goldens.** Whole-state hashes for: a Local Asteroid / Lunar Mine / Salvage / Forage / Survey run (stepped
`economyTick(_,1)` and one offline `tick()`), a refine line and a fabricate line through completion, an inspect, a
Prospecting Rig ship's deliveries; the shared-stream draw count per run (wrap the rng). Item census counts.

**ML-1 Items and recipes (data).** The 7 items, 7 recipes, `reserved` marker, stale hints (Damaged Reactor Housing
"(a coming mechanic)", Deuterium Ice "refine at the Fuel Depot"), Reclaimed Alloy retag (call L11). Tests: each recipe
in/out; multi-input deducts all atomically and refuses when any is short; allocation reserves every input; every raw and
salvaged item has a sink or a typed reserve (extended to every producible refined item); every refined input is
producible. Neutral: no golden moves (new keys only). UI: Refinery list only (grouping waits for ML-7).

> **Carry note (ML-0 + ML-1 built 2026-10-20).** ML-0: `materialLinesGoldens.test.ts` pins the six gathering runs
> (stepped == one offline `tick()`, with the shared-stream draw count), a refine line, a fabricate line, an equipment
> blank + inspect, a Prospector Miner with a crafted Refinery-Feed Rig on the Local Asteroid run (ML-3's seam), and the
> census. ML-1: the 7 items and 7 recipes as named (keys `refineFerriteIngot`, `refineReclaimedCircuit`,
> `refineIridiumCatalyst`, `synthCobaltCoil`, `synthOsmiumPlate`, `synthPhotonicGel`, `synthBiocatalyst`), every
> ratio and duration in ONE table, `MATERIAL_LINE_RECIPE_NUMBERS` (model.ts; compounds run 20 ticks because 40 breaks
> the speed rung XP rule; the user approved the numbers as built, 2026-10-20). `ItemDef.reserved` is live: field role `effect`, one pending registry
> entry `facility:ITEMS:<id>:reserved` per reserve (owner = the marker). Reserved now: Reclaimed Circuit, Iridium
> Catalyst, Cobalt Coil, Osmium Plate, Photonic Gel, Biocatalyst (owner ML-2) and Precursor Circuit (owner EM-8).
> **ML-2 and EM-8 must drop the marker in the same commit that adds the consumer** (materialLines.test.ts fails while
> an item is both reserved and consumed). Ferrite Ingot already feeds the Osmium Plate. Stale text fixed: Damaged
> Reactor Housing hint, Deuterium Ice flavor (its hint was already honest), Intact Data Core hint (the Neural Backup
> consumes it). Reclaimed Alloy retagged uncommon (L11). Goldens: only the ML-0 census moved (refined 5 to 12, recipes
> 4 to 11; the test proves removing the ML-1 rows reproduces ML-0). `shortRangeGoldens` holds the 14 new registry
> entries apart (`registry:ml1`), so its base pin is unchanged.
> **Review fix (2026-10-20, "nothing inert player-reachable"):** `refineRecipeOffered(key)` (model.ts) is the ONE
> check canStartLine, the Refinery dropdown and the dashboard's idle-refinery scan read. A recipe is hidden while its
> output is reserved or only feeds hidden recipes, so all seven ML-1 recipes are hidden today (Ferrite Ingot only feeds
> the reserved Osmium Plate) and each comes on offer by itself when ML-2 / EM-8 drop the marker. Their registry
> entries (`facility:REFINE_RECIPES:<key>`) read pending (owner ML-2, no probe) while hidden and turn live with their
> content probe by themselves; ML-2 re-pins `shortRangeGoldens` `registry:ml1` when they do. **ML-2 note:** the
> seven recipes, and so the six E-MAT orphan raws' Refinery sinks (all but Scrap Alloy), first become player-reachable
> in ML-2. **Patch note line (L11):** "Reclaimed Alloy is now tagged uncommon (it refines from common Scrap Alloy)."
> Rarity also feeds the Salvage Bay confirm prompt's tier (App.svelte `salvageTargetNeedsConfirm`), but material
> salvage takes salvaged materials only, so nothing a player does changes beyond the color and the reward chips.

**ML-2 Recipe rework (data).** Per call L2 (a): cargo, FTL, reactor, utility, shields, plating per E-MAT 3c and 3d with
today's items, Sprint Drive vs Efficient Core differentiated (L11), Hauler Hold / High-Output Core Structural Assembly
rule (L11). Tests: no-wall walker (every slot keeps a non-relic variety whose full tree bottoms out in Asteroid + Lunar
raws), distinct input maps per slot, the "intended spread" test updated, in-flight safety (a pre-patch job completes
off its stored effect; an active line on a reworked recipe waits, no throw, no negative bucket, resumes when stocked).
Goldens: only fabricate goldens on reworked blueprints move. Patch note: active lines on reworked recipes may wait.

> **Carry note (ML-2 built 2026-10-21, with the recipe realism audit, on feat 624b0c5).** Built per L2 / L11 and the
> audit's USER ANSWERS Groups A to D (`2026-10-21-recipe-realism-audit.md`). 20 blueprint rows changed: cargo, FTL,
> reactor (other inputs only; `withReactorFuel` still appends the canisters), utility, Recharge Array and plating per
> E-MAT 3c / 3d with the four audit amendments (Prospector Hold Frame 2 + Ti 1 + Reclaimed Alloy 2; Ablative Plating
> Frame 2 + Ti 1 + Biofiber 2; Composite Plating with Biofiber 1 for the Reclaimed Alloy; Capacitor Bank unchanged);
> Power Coupling Wafer 3 + Ti 1; Toxin Grenade Ti 1 + Coupling 1 + Resin Distillate 1; Med Kit Wafer 1 + Ti 1 +
> Purified Biomass 2; Archaeo-Scanner Wafer 4 + Coupling 1; Ballistic Weave Ti 1 + Wafer 1 + Biofiber 2; Field Suit
> Ti 1 + Wafer 2 + Biofiber 1; Hazard Suit Ti 3 + Wafer 2 + Resin Distillate 1 (its seal); Galileo-Class Probe Wafer 2
> + Coupling 1 + Ti 2. New refined goods `biofiber` and `resinDistillate` (`refineBiofiber` 5:1, `refineResinDistillate`
> 3:1, 20 ticks, `RECIPE_REALISM_REFINE_NUMBERS`), SVG glyphs `biofiber` / `resinDistillate` (icons.ts, ICON_SEMANTICS,
> ui/refinedIcons.ts; Warehouse Refined shelf after the Biocatalyst, and the offline recap rows). Text fixes T1 to T8
> (T8 was already done by the reactor fuel slice; T4 in the form call 6 (c) leaves it: "food and medical"). The six ML-1
> `reserved` markers dropped in this commit (`ML2_RECIPE_REWORK` retired); every ML-1 recipe is offered and its registry
> entry live by itself; only the Precursor Circuit (EM-8) stays reserved. Calls 15 and 16: the ladder seam was already
> built (reactorTech.ts) and its realism guard (every core carries its fuel) is reactorTech.test.ts; ML-2 adds the
> others (materialLinesMl2.test.ts: fabrics take Biofiber, seals and agents Resin Distillate, Purified Biomass stays
> food and medical, no strut in an implant) plus the no-wall walker, distinct maps (implants excepted: shared Wafer +
> Coupling stacks predate ML-2) and the in-flight rules. Goldens: `ml2RecipeGoldens` (captured first, own commit) moves
> only the 20 rows, their crafts (draw counts unchanged) and their salvage refunds; `withPreMl2Recipes` reproduces every
> capture; inspected pieces unchanged. Registry: `ml2RowsBack` / `ml2LinesBack` read the move back for emodGoldens
> (bd1e2f48 -> cfe349ea) and shortRangeGoldens (`registry:ml1` re-pinned; base pin unchanged). No save step.
> **Patch note lines:** "Recipes now make physical sense: ablative plating and away-team armor are woven from the new
> Biofiber, seals and toxin grenades use the new Resin Distillate, and many ship systems now use Material Lines goods.
> Gear you already crafted keeps every stat. A standing craft line on a changed recipe waits until you have the new
> materials, then carries on." and "Salvaging a piece gives back parts of its current recipe."

**ML-3 Material quality on delivery (OC-D2).** Fold `materialQualityChance` into `materialQuality`. In economyTick's
per-captain merge, for a ship with `materialQuality > 0`: `climb = floor(delta x p)`, plus 1 if
`makeRng(seed ^ MATERIAL_QUALITY_SALT ^ captainKey ^ cycle)() < frac(delta x p)` (call L4 a). At the fold the existing
roll is untouched; climbed units deposit FIRST at `min(5, q + 1)`, the rest at `q` (a cap clamp trims ordinary units).
Determinism: shared-stream draw count identical with or without a rig (test wraps the rng); parity one offline span ==
stepped live. Tests: delta 100 at p 0.1 = 10 climb exactly when the fraction is 0; tier 5 stays 5; Standard-Issue rig
folds to 0; the old "materialQualityChance stays reserved" assertion is replaced. Registry: `materialQualityChance` LIVE.
Goldens: only rig-ship states move. UI: the rig tooltip line becomes a real "+X% chance per unit to arrive one quality
higher" (text, no mockup).

> **Carry note (ML-3 built 2026-10-21, on feat f85ef73).** Goldens first: `materialQualityGoldens.test.ts` (own
> commit) pins a Refinery-Feed Rig ship under an Assayer captain on the Local Asteroid run and on Salvage Wreckage
> (plus the ML-4 craft captures). Built in `materialQuality.ts`: `materialQualityClimbChance(points)` =
> `diminishing(points x 0.01, 0.25)` (D23, the shared unbounded curve rather than an asymptotic PERCENT_STAT_CURVES
> entry; a probability, so 1 at most), **`MATERIAL_QUALITY_CURVE` [PROVISIONAL]** (no answer names the numbers: 10
> points about 8.5%, 20 about 15%, 30 about 21%); `equipmentStatMods` sums the line into
> `percentPlus.materialQualityChance` (written only when a piece carries it) and `shipDerivedStats` writes the optional
> `ShipDerivedStats.materialQuality` only when above 0. economyTick's per-captain merge climbs `floor(amount x p)`
> units per delivered item plus one rounding draw each (sorted item order) on
> `makeRng(FNV(captainId|materialQuality|cycle) ^ MATERIAL_QUALITY_SALT)` (salt registered in salts.test.ts), keyed on
> the new lifetime counter `CaptainState.materialQualityCycles` (optional, written only once a delivery rolled; the
> Motherlode rule, no save step). The deposit fold deposits each share's climbed units FIRST at `min(5, q + 1)`, then
> the rest at `q`; the Assayer's own share climbs from its own graded quality. No shared draw added (draw counts
> unchanged in every capture). Goldens moved: only rig-ship states (ML-0 `rig`, ML-3 `rigAssayer` / `rigSalvage`), each
> reproduced by `withMaterialQualityOff` (the curve at 0 points per point); the registry snapshots (emodGoldens
> cfe349ea -> c89e7c59, read back by `ml3RowsBack`; shortRangeGoldens unchanged through `ML3_SLICE`). Registry:
> `ship:gearLine:materialQualityChance` LIVE on mission:extraction (probe `missionOreQuality`, now the delivered ore's
> average quality); the FLAT_UNCONTROLLED excuse is gone; the wiring plan's WR-7 row is struck (X1). UI: the item
> tooltip's detail line "+X% chance per unit to arrive one quality higher" (`ui/materialQualityText.ts`). Short-range
> pickups keep their own deposit roll (the registry's existing outOfScope reason). **Patch note line:** "Refinery-Feed
> Rigs (and every Prospecting Rig's Material Quality line) now work: each unit a mission delivers has a chance to
> arrive one quality higher."
> **Review follow-ups (2026-10-21, merged with feat 5b5011a).** (a) The climb seed is now keyed by the save's own seed
> too, the plan's `seed ^ MATERIAL_QUALITY_SALT ^ captain ^ cycle`: `materialQualitySeed(saveSeed, captainId, cycle)` =
> `saveSeed ^ salt ^ FNV(captainId|materialQuality|cycle)`, the save seed being the homeworld seed
> (`worksDirectorateSaveSeed`, the Works Directorate precedent), so delivery N of captain 1 does not climb alike in
> every save. No live save has these draws yet; every golden fixture has no homeworld seed (0), so no pin moved (a
> seeded-save test proves the key is read). (b) **Reading of L4 for the user to confirm:** "one keyed rounding roll
> per delivery" is built as ONE private stream per delivery that takes ONE draw per delivered ITEM (sorted item
> order), because each item has its own leftover fraction (a Salvage Wreckage delivery of three items takes three
> draws on that one stream). The alternative is one draw shared by every item of the delivery (its items would round
> up or down together). (c) The switch's visible title is aria-hidden (the switch's own label names it once). (d) The
> rig tooltip also shows the ship's combined chance when two installed pieces carry the line ("Ship total, 2 pieces:
> +Y% per unit (the points add, then diminish)", `shipMaterialQualityText`, Ship Systems passes the ship's pieces);
> today only one Prospecting Rig installs per ship, so it first shows once more than one slot carries the line.

**ML-4 Quality carries into crafts.** `startProcess` variant reports the unit-weighted consumed quality; effects stamp
`inputQuality`; completion = `min(5, carried + rollQuality(rng, craftQualityBonus))` (same call, same draw count;
call L6). `materialPreference` per order with `removeItemHighestFirst` (call L5). Tests: a best-first line on q2 stock
lands at 2 or more; absent `inputQuality` resolves byte-identically; lowest-first default byte-identical; reservation
stays total-based (allocation.ts untouched). UI: the toggle needs the ML-7 mockup.

> **Carry note (ML-4 built 2026-10-21, after ML-3).** Goldens: `materialQualityGoldens.test.ts` `refineMixed` /
> `fabMixed` moved by design (c43a66c9 -> a653ebe5, bd8b3770 -> 44bb89ca; draw counts unchanged); stripping every
> job's stamp as the run goes (`stripCarry`) reproduces both captures; `inFlight` (a job started without a stamp) and
> `queued` held. Built: `startProcess` takes an optional `materialPreference`; a refineJob / fabricateJob whose effect
> is `addItem` tallies what it consumes with `drawQualityTally` (inventory.ts, the same walk as the deduct) and
> stamps `inputQuality` = `carriedQuality` (floor of the unit-weighted average, materialQuality.ts) only when above 0;
> completion = `craftOutputQuality(inputQuality, rollQuality(rng, craftQualityBonus))` (same call, same draws). "best"
> drains through the new `removeItemHighestFirst`. `materialPreference?: "best"` (absent = lowest) on `CraftLine`,
> `CraftOrder` (mirrored onto joined lanes) and the queued `craftLine` order (carried at promotion); `startLine` takes it
> as a fifth argument. allocation.ts gained only the type field; reservation math is untouched (total-based, tested).
> UI (the signed-off Refinery mockup's order switch, wired now so the field is player-reachable): a `Toggle` "Use best
> materials" on the Refinery and Fabricator configurators with the mockup's two notes (`bestMaterialsNote`), OFF
> every time the form opens (sign-off: no memory), carried through the confirm modal and Add to queue; the log says
> ", best materials". The Fabricator shows it only for stackable outputs (`bestOffered`). No save step. **For ML-5:**
> blanks carry nothing yet: extend `carries` in startProcess to `addBlank` (stamp `inputQuality` on it), bucket the
> blank on completion, drop the `bestOffered` guard so equipment blueprints show the switch, and pass the blank's
> quality into `mintCraftedPiece` at inspect. **For ML-7:** the switch is in place (restyle freely); still yours: the
> "This order uses" per-quality breakdown and the "Carried quality: average X = QN, then the roll" readout (the engine
> walk is `drawQualityTally`), grouping, per-quality chips, Help. **Patch note line:** "Material quality now carries
> into what you craft: an order's output starts from the average quality of what it used. Turn on Use best
> materials on an order to spend your highest quality stock first."

**ML-5 Quality blanks (call L7 a).** Blanks become quality buckets; inspect consumes the highest quality first and
passes it to `mintCraftedPiece` (carry + climb); inspect seed derivation and draw order unchanged, so reload-before-
inspect still re-rolls the same piece. Save: `bucketBlanksV70` appended to `MIGRATIONS[69]`. Tests: counts preserved
into quality 0; a quality-g blank inspects to g or more; reload parity; the migration on a v69 fixture. **0.14.x
candidate** if the user prefers (L7 b).

**ML-6 Deuterium as the reach input (S4-A05).** Per calls L8 and L9: an early source (a: Local Deuterium Skim visible
again as an ordinary Tier I mining run, no fuel role, Repeat-friendly so it never needs a dedicated captain), and the
Deuterium Canister (GG-1's item and refine) as an input to Class III+ FTL drive blueprints (authored by G2-4) and the
High-Output Core. Depends on GG-1 and G2-4. Tests: drive blueprints refuse without canisters; the no-wall rule still
holds for Class I and II; the skim run delivers on Repeat. UI: the Deuterium Ice hint and the mission card text.

**ML-7 Legibility UI (mockup first, new sign-off).** Refinery grouped by line (2 recipes become 12), a per-quality
readout in Materials (hover or expand), the "Use best materials" toggle on a craft order, Help topic "Material lines and
quality". Verify in preview desktop + 375 px.

### E-MOD (EM)

**EM-0 Goldens.** Ship sheet for every hull with every slot combination the census can build (the CP-0 pattern);
every hull's maximum crafted draw (the P1 census); patrol states and replays for every combat hull and both routes; GO
ship battles; mission runs on a ship with a crafted Reactor Core; the registry snapshot.

**EM-1 Power budget engine.** `basePowerOutput`, the output and net-draw fold, power efficiency (Overdrive, Power
Discipline, Martian) on a D23 curve, `reactorSurplus`, `shipPowerBudget`. Remove `officer.powerEfficiencyMult` from
`OFFICER_BONUSES_PENDING_IN_RELEASE` and every `E_MOD` pending registry entry (`crew.powerEfficiency`, `martian`,
`powerOutput`, `powerDrawReduction`, `ship:audit:slotPowerDraw`, `ship:audit:weaponPowerDraw`); Task 22's
`PENDING_IN_RELEASE` loses its three E-MOD entries. Tests: each source moves `sheetPowerDraw`; neutrality (no officer,
no Martian, Standard-Issue gear) byte-identical; integer exactness. Save: none.

*Carry note (EM-0 and EM-1 built 2026-10-20, on a9caa06).* EM-0 is `emodGoldens.test.ts` (512 to 2,048 sheets per
hull, the census, 20 patrols, 2 Ground Ops runs, 2 missions, the registry). The census reads 83 for the Freighter (it
installs no utility; section 2.2 said 85), the rest as section 2.2; `basePowerOutput` takes the option (a) values.
EM-1 moved only the sheets (output + hull base; draw cut by efficiency) and the registry; every patrol, mission and
Ground Ops pin held. Golden files that pinned a sheet earlier hash it inside `withEm1Off`
(`emodEm1Switch.fixture.ts`), which reproduces every EM-0 capture. Built: `netPowerDraw` in `crewOverlay.ts`
(`ceil(gross / (1 + diminishing(e, POWER_EFFICIENCY_KNEE)))`, folded in `applyCrewOverlay`; knee 0.25,
user confirmed 2026-10-20: one Overdrive officer about 8%, e 0.5 about 24%); `DRIVE_CLASS_POWER_DRAW_MULT` 1.6 with `ftlDriveClass` reading
an optional `BlueprintDef.driveClass` (absent = Class I; G2-4 sets it and must not bake the class into `powerDraw` at
mint; if OC-3's hull-tier class should also draw, G2-4 extends `ftlDriveClass`); `shipPower.ts shipPowerBudget(state,
shipId, { piece, replacingInstanceId }?)` with `reactorSurplus` (EM-2 gates on its `overBudget`, EM-3 freezes its
output and draw, EM-4 reads `reactorSurplus`). Registry: Overdrive, Power Discipline, Martian, the powerOutput and
powerDrawReduction lines, the slot and weapon draw rows LIVE; each hull's `basePowerOutput` and the drive class seam
added; `ship:audit:reactorCoreNet` now owned by EM-4. UI: the Power Output / Power Draw (i) texts and the Overdrive
description only (the power bar waits for the EM-10 mockup). **For G2-4:** the voyage class (G2-3 hard-codes
`driveClass: STANDARD_DRIVE_CLASS` at expedition.ts ~718) and the power draw must read ONE drive class source,
`ftlDriveClass`. **For the release:** Overdrive, Power Discipline and Martian show LIVE, but a lower draw changes nothing
until the install gate and the combat penalty read it, so EM-2 and EM-3 must land in 0.14.0. Integration (2026-10-20):
`MULTI_SLOT_TYPES` is exported from equipment.ts and shipPower.ts reuses it (EM-5 adds `module` there once).

**EM-2 Install gate.** `canFitEquipment` gains `overPower` (pristine values only, never wear), checked after capacity;
the same check on every install path: hand install, item-side install, Armory loadout check-out (whole-set budget
including the loadout's own reactor), roster loadout apply, reactor swap (an install that leaves draw above the new
output is refused). Uninstall is NEVER blocked and nothing is ever evicted (call P2). Tests: each path both sides of the
boundary (exact-equal installs); a census proves no current maximum loadout is refused under P1 (a); wear never read.
UI: refusal text through the existing reason switch (exhaustive).

*Carry note (EM-2 built 2026-10-21, on 624b0c5).* Goldens first: `emodEm2Goldens.test.ts` pins every install path
(hand install piece by piece, the reactor swap back to Standard Issue, the item-side Install on... targets, the Armory
check-out, a gear-only roster's linked loadout) for the heaviest crafted loadout on every hull, bare and with the
power crew; every verdict reads ok and no pin moved with the gate (the P1 census: no live loadout is refused; every
piece's intrinsic draw is minted from SLOT_BASE_PHYSICALS / WEAPON_DEFS / DRONE_POD_BASE_POWER_DRAW, none of which has
ever been raised in git history, and rolled powerDrawReduction only lowers it, so no older piece draws more than the
census). Built: `canFitEquipment` returns `overPower` LAST (after hardpointsFull / baysFull), reading the ship as the
install would really leave it (`applyFit`, the same transition fitEquipment runs) through
`shipPower.ts installPowerShortfallBetween` (pristine values; a fast path skips the crew fold whenever the gross draw
fits, so every live ship pays nothing); the refusal carries `powerShortfall` (`EquipFitRefusal`), and every reason
switch now takes the refusal (App `devFitReasonText`, ShipSystemsPanel `reasonText`, `buildInstallOnRows`), all reading
`overPowerReasonText` ("needs N more power. Install a stronger Reactor Core or remove a powered system", the mockup's
wording). `checkOutLoadout` refuses a whole set over budget (the loadout's own Reactor Core counts, the ship's manual
gear goes to storage so its core does not); `loadoutCheckOutPowerShortfall` feeds the Armory's inline refusal line and
log; the roster apply judges the gate on the FULLY applied roster (its officers and crew included) against the same
roster without the loadout, and re-runs without the loadout when it fails (`rosterLoadoutPowerShortfall` names it in
the log; the people still land). Uninstall is
never blocked and nothing is evicted (P2): `overBudgetNotice` is the Ship Systems warning ("Over budget by N", the cause
from the ship as it is, named like the mockup: no Engineering officer aboard, or no efficiency source, then the
supply side). **`POWER_GATE_ALLOWS_NON_WORSENING_INSTALL` (shipPower.ts), user ruling 2026-10-21 "Allow non-worsening
(Recommended)":** on a ship already over budget, an install that does not make the shortfall worse passes (a bridge,
an equal swap, a stronger but still short Reactor Core); a refusal always names the WHOLE shortfall after the install
(10 over plus a 3-draw install: "needs 13 more power"). The Armory Check out button is disabled while its refusal
line shows. Review follow-ups (2026-10-21): `equippedFor`, `MULTI_SLOT_TYPES` and `onMissionLock` moved to the leaf
`equipmentQueries.ts` (re-exported from equipment.ts), so equipment.ts -> shipPower.ts is one-way with no import
cycle; `InstallTarget`'s ship row carries only `refusal`.
Power efficiency now moves the verdict (powerInstallGate.test.ts: a 90 draw on an 85 hull is refused bare, passes with
one Overdrive officer, with Power Discipline, and the Martian racial cuts the candidate draw). **Honest scope:** under
P1 no crafted loadout reaches the boundary today, so the gate and the efficiency sources first bind in play when
modules (EM-5) and Class II+ drives (G2-4) add draw. **For EM-3 (after WR-8):** the warning's strength line ("Weapons
and shield recharge at X%") joins `overBudgetNotice` with the penalty; freeze `powerSupplyPercent` from
`shipPowerTotals` (pristine output vs net draw). **Note:** `shipPowerTotals().draw` is the GROSS draw whenever the
ship is within budget (the fast path skips the crew fold); it is the net draw only when the ship is over. That is
exact for a percent that is 100 in budget, but anything that needs the in-budget net draw must read
`shipPowerBudget` instead.

**EM-3 Combat over-budget penalty.** `powerSupplyPercent` frozen at battle build from pristine output vs net draw;
multiplies weapon damage and shield recharge beside `reactorDamagePercent` (call P6). 100 when in budget, so every
golden holds unless a ship is over budget. Runs AFTER WR-8 (shared bridge.ts and patrol goldens). Tests: replay parity;
neutrality; the floor; stacking with a Degraded reactor is multiplicative, never below the floor product.

*Carry note (EM-3 built 2026-10-23, on feat 21ff7c8).* Goldens first: `emodEm3Goldens.test.ts` (own commit) pins, under
the WR-8 rules, battles through the real stamp path (Destroyer, Battleship, Carrier, Orion), Dispatch Once patrols and
the dispatch forecast (Freighter, Destroyer, Battleship, Carrier x both routes) and the Orion's ship-event battles, each
in budget, over (a draw of 1.5x output, supply 81%) and deep over (4x, the floor); before the engine every over and
deep row equalled its in-budget row. Built: `combat/power.ts powerSupplyPercent(output, draw)` (100 in budget, the
exact-equal rule included; else the whole floor of 100 x sqrt(output / draw) by integer root, never below
`POWER_SUPPLY_FLOOR_PERCENT` 60, user P6); `CombatRulesStamp.powerSupplyPercent`, written only below 100 (the WR-8 hand
off: frozen beside `speed` at every patrol cycle start, relaunch, ship-event dispatch and the forecast), passed by
`stampCombatArgs` to `shipToCombatant` (`Combatant.powerSupplyPercent`, set only below 100). One fold reads the power:
`crewOverlay.ts shipNetPowerTotals` (moved there from shipPower.ts so the stamp reads it without an import cycle;
`shipPowerTotals` delegates). resolveBattle: weapon damage first takes the worn reactor's own per-hit floor (exactly as
in budget), then the supply, banked on the attacker (ten-thousandths of a point), so a fight's total is the floor of
its supplied total and an over-budget ship never out-hits the same ship in budget (review must-fix 2026-10-23: one
banked product of reactor and supply rounded less than the in-budget floor and made small worn-reactor hits a BONUS;
no golden moved with the fix: no pinned fight had a worn reactor change its damage); shield recharge banks the supply in hundredths of
a tenth (`Accumulators.shieldSupply`), and the Defensive bonus banks on the supplied tenths. No draw added, so no salt.
Proved: every in-budget row held; `emodEm3Switch.fixture.ts withPowerSupplyOff` reproduces every pre-EM-3 row; a run
dispatched inside the switch and flown by the live engine is byte-identical (in flight); one 900 s `tick()` equals 900
`economyTick(_, 1)` on a Repeat over-budget patrol; the replay reads the stamp. Win rate (forecast wins of 64, in /
over / deep): Freighter Sweep 57 / 48 / 37, Destroyer Sweep 64 / 63 / 63, Destroyer Warband 9 / 4 / 2, Battleship
Warband 52 / 45 / 33, Carrier Warband 23 / 14 / 6; the Battleship and Carrier Sweeps and the Freighter Warband held. No
live ship is over budget under P1, so no live save moves; the player's path in is the P2 one (an Engineering officer
or Martian crew leaving, or a Reactor Core removed from a ship whose Class II+ drive or modules needed it). UI: `overBudgetNotice`
gains `supplyPercent`, `strength` ("Weapons and shield recharge at X%.", bold) and `gentleNote` ("The cut is gentle and
grows with the shortfall, never below 60%."), the mockup's lines, shown first in the Ship Systems warning; the Power Draw (i) text states the penalty. Registry: `ship:wr8:powerInCombat` LIVE (weapon damage over
300 shots, patrol and ship event), new `ship:em3:powerShieldRecharge` (LIVE, both contexts) and `ship:em3:powerSupplyFloor`
(LIVE, equals 60); `emodEm3Registry.fixture.ts em3ReadBack` holds the two added rows apart in emodGoldens and
shortRangeGoldens. No save step. **Readings for the user:** drone damage is not cut (P6 names weapons and shield
recharge); the patrol's shield top-up between waves (out of combat) is not cut. **For EM-4:** a reactor surplus lift on
`transitSpeedMult` also moves the stamp's combat speed (WR-8 note); the supply is untouched by it (surplus is in budget).
**For EM-10:** the power bar's over-budget chip can read `overBudgetNotice().supplyPercent`.

**EM-4 Reactor surplus (B10 fix, call P3 a).** `reactorSurplus` lifts `transitSpeedMult` on a D23 curve
[PROPOSAL knee so a Standard-quality tier 1 core nets positive on every hull after its mass]. Speed counts everywhere
(OC-D8), so mission, patrol-leg and voyage goldens with a crafted reactor move (explained; zeroing the lift reproduces
them). Registry: `ship:audit:reactorCoreNet` LIVE. Tests: the B10 test (crafted core vs Standard-Issue, every hull,
strictly faster); Standard-Issue reactor = byte-identical.

*Carry note (EM-4 built 2026-10-23, on feat e1ee724).* Goldens first: `emodEm4Goldens.test.ts` (own commit 65e9cf3)
pins, before the engine, every hull's sheet with the Standard-Issue core and three real mints (`emodEm4.fixture.ts`:
ref, the worst Standard tier 1 roll at item level 20, 23 output and the full mass 12; mid, a Balanced Core at 10; top,
the item level 40 quality 5 Radiant High-Output Core, about 150 output, mass 0), Short Ore Runs, a short-range run, an
Orion's voyage, the combat stamp, Dispatch Once patrols (four hulls x both routes, WR-8 rules) and the forecasts.
Built: the leaf `reactorSurplus.ts` (`REACTOR_SURPLUS_LIFT` [PROPOSAL] perPoint 0.022, knee 10: lift = 1 + perPoint x
diminishing(surplus, knee); `REACTOR_LIFT_SWITCH`, the test-only off switch; the run flag `reactorLift: { version: 1 }`);
`crewOverlay.ts shipReactorSurplus` (equals `shipPowerBudget().reactorSurplus`, a fast path while the hull's own output
covers the draw) and the lift applied LAST in `effectiveShipStats` (`opts.reactorLift: false` reads without it).
In-flight byte-identity: a captain mission and a short-range run read the lift only when flagged, stamped at dispatch on
a ship with a powered Reactor Core (no flag on a Standard-Issue ship, so every such run record is unchanged) and carried
to every later cycle (`runShipStats(..., reactorLift)`, `startShortRangeCycle(..., reactorLift)`, the Home dashboard
row); a patrol cycle reads it through its combat stamp, frozen at the cycle start (the WR-8 / EM-3 rule: a run in
flight keeps its stamp until its next cycle); an expedition through its dispatch snapshot. No draw, no salt, no save
step (the short-range validator learns the flag). Moved by design (zeroing the lift, `emodEm4Switch.fixture.ts`,
reproduces every pre row; every Standard-Issue row held): sheet speed x hull base, pre / live, ref 0.81 / 1.05, mid
0.89 / 1.06, top 1.00 / 2.01; Short Ore Run legs on a Freighter ref 31 / 24 ticks (raw 25), top 25 / 13; the Orion's
Tier I voyage ref 6,915 / 5,317 s each way (Standard Issue 5,577), top 5,577 / 2,776; forecast wins of 64: Carrier
Warband ref 3 / 28, mid 2 / 26, top 25 / 33 (Standard Issue 23), and its Dispatch Once now won; Battleship Warband ref 49
/ 53; Destroyer Warband ref 3 / 6 (Standard Issue 9); Freighter Sweep ref 56 / 57. `emodGoldens`, `gearWearGoldens`
run with the lift off (`reactorLiftOffForThisFile`); the registry pins read EM-4 back (`emodEm4Registry.fixture.ts
em4ReadBack`). Registry: `ship:audit:reactorCoreNet` LIVE (sheet and Ground Ops voyage), new
`ship:em4:reactorLiftCombatSpeed` LIVE (patrol and ship event stamp). UI: one source bucket ("Reactor surplus") in the
FTL Speed readout and the FTL Speed / Power Output (i) texts. **Readings for the user:** the worst Standard roll nets
faster from about 17 output (item level 15); cores crafted below that (a fresh crafter's item level 1 to 10) can still
be slower than Standard Issue, because the full mass 12 costs 19% of the speed and the lift is surplus-driven; the top
core doubles the speed (the D23 curve has no cap, and the B10 bar forces its far end); the core's mass still costs fuel
efficiency (reach). **For WR-7:** patrol legs still ignore speed; when they scale with it they read the stamp or a flag
the same way. **For EM-7 / G2-4:** a module or Class II+ drive draw spends the lift only once the total draw passes the hull's own power (the systems draw the hull's power first; the B.4 grid).

*Carry note (EM-4 follow-up, 2026-10-23, the user's answers to the EM-4 open calls: "Never slower (Recommended)" and
"Soften the top (Recommended)").* The readings above are superseded. NEVER SLOWER (`crewOverlay.ts applyReactorDrive`):
the lifted speed is floored at the same ship's speed with this core weightless and no lift, which is exactly its
Standard-Issue sheet (the Standard-Issue core weighs 0 and supplies 0, and a core carries no transit line); the floor is
folded exactly, and skipped when the lift is clearly above the core's own drag. Since it sits on the sheet's transit
speed it holds for the mission and short-range legs, the voyage and the combat stamp. The run flag now also marks a core
with mass and no output. SOFTER TOP: `REACTOR_SURPLUS_LIFT` [PROVISIONAL] perPoint 0.0077, knee 10: the best core 0.14.0
can mint (item level 40, quality 5, Radiant, mass 0, about 150 output) flies +35%; a weightless 20 output core +10%.
With the floor, the core's mass eats the lift first: a full mass 12 core shows a gain only from about 80 surplus, a 6
mass core from about 28. Impact (pre-EM-4 / now): sheet speed ref 0.81 / 1.00, mid 0.89 / 1.00, top 1.00 / 1.35;
Freighter Short Ore Run legs ref 31 / 25 ticks, top 25 / 19 (Standard Issue 25); the Orion's Tier I voyage ref 6,915 /
5,577 s each way, top 5,577 / 4,121 (Standard Issue 5,577); forecast wins of 64 (Standard Issue in brackets): Carrier
Warband ref 3 / 23, top 25 / 29 (23); Battleship Warband ref 49 / 52, top 52 / 55 (52); Destroyer Warband ref 3 / 9,
top 9 / 7 (9); Freighter Sweep ref 56 / 57, top 57 / 60 (57). Tests: `emodEm4.test.ts` sweeps every hull, every core
variety, item levels 1 to 40 (the worst Standard roll, four seeded Standard rolls and a Radiant quality 5 roll), light
and loaded: the sheet speed and the Long Ore Run legs never worse than Standard Issue; the combat stamp speed on every
combat hull and the Orion's voyage likewise; the best core +30 to +40%. Registry: `ship:em4:reactorNeverSlower` added
LIVE (equals: a 1 output, mass 12 core on a bare Freighter reads the hull's own speed on the sheet and the voyage); the
two lift probes use a weightless core. The flag version stays 1 (no EM-4 build ever reached staging or a save).
**The combat speed case** (a ref core at combat speed 31 won 6 Destroyer Warbands of 64, Standard Issue at 30 won 9):
NOT a real inversion. A sweep of the Destroyer's stamp speed (64 and 512 samples) shows one real step, at the pirates'
own speed 30: below it 3 to 4 of 64 (50 to 56 of 512), from 30 up a plateau of 6 to 9 of 64 (78 to 90 of 512; 30: 82,
31: 78, 32: 83). The Carrier (2 / 23 of 64 below / at 30) and the Battleship show the same step. So 31 against 30 is
sample noise on the plateau; the real harm was the old dragged core pushing a ship BELOW the pirates' speed (24), which
the never-slower floor now rules out. **Reading for the user:** with both answers, a Standard-quality core with its full
mass 12 never shows a speed gain at any item level 0.14.0 reaches (its worst roll tops out near 46 output at item level
40); the gain shows on light (mass-reduced) and high-output rare cores (a Radiant quality 5 High-Output Core: +8% at item
level 10, +23% at 20, +35% at 40; the Balanced Core's Radiant roll +9% at 40). Its other worth is the power headroom
(EM-2).

*Carry note (EM-4 review fixes, 2026-10-23, "approve with fixes").* (1) The Ship Systems install compare and the
readout's gear note read `crewOverlay.ts gearSheetWithReactorDrive` (the gear-only sheet with the same drive rule:
gross-draw surplus, the never-slower floor), so a crafted core no longer compares as slower ("x1.00 -> x0.81, -19
pts" before); the source popover names the bucket "Reactor Core (never slower)" when the floor sets the speed.
(2) ONE run sheet for a captain mission in flight, `gearWearEngine.ts missionRunSheet` (the run's gear wear stamp and
its reactor lift flag): the engine's mission arm and the Home row already read it; now the mission card (App.svelte)
and the transit berth wait (berths.ts isAwaitingBerth and the berth ETA's unload) do too. Fixed with it, the older gear
wear step 3 gap: those readouts read the pristine stored sheet, so a run worn at dispatch counted down early. Behavior
beyond the readouts: none (the berth readers are display only; the engine claims berths through transitBerthsFree).
(3) The FTL Speed (i) text and reactorSurplus.ts: powered systems use the lift only once they draw more than the hull's
own power. (5) KNOWN_ISSUES.md records the pre-existing one-call parity break for Short Ore Runs (the 0.13.4 per-call
berth budget). (7) `reactorLift` is required in `runShipStats` and `startShortRangeCycle`. (8) A captain mission's flag
is read through `reactorSurplus.ts reactorLiftFlagged` (a malformed value, null included, never counts), the rule the
short-range validator uses. Registry: the reactor wear consumer row (`wear:WEAR_EFFICIENCY:reactorCore:powerOutput`,
pending on gear wear step 4) now names the drive lift as a reader (em4ReadBack restores the old owner text for the
earlier pins). Tests: `emodEm4Readouts.test.ts`.
**OPEN CALL for the user (EM-4 review item 4), [PROVISIONAL] as built:** the drive lift reads the Reactor Core's
PRISTINE output (like the install gate), so a worn core lifts as much as a new one. (a) Keep pristine (as built; the
core's wear acts in combat through its four-state model). (b) Read the worn output, like the other run consumers, from
gear wear step 4.

**EM-5 Module slot and catalog (engine).** The `module` slot, cap (call M1), `moduleSlotsFull`, `duplicateModule`
(call M8), physicals, catalog, mint path, Passive and Conditional effects through the ship sheet and combat bridge,
Armory / salvage / Archive / item-side install support, S2 out-of-ship lock. Hull descriptions made true (OC-D13: "most
module slots"). Tests: cap per hull; neutrality (no module = same object); each passive moves its value; each
conditional fires only in its state.

*Carry note (EM-5 built 2026-10-21, on f85ef73).* Goldens first: `emodEm5Goldens.test.ts` (install verdicts for every
hull with and without the Spec Utility, the player combatant Standard Issue and fully crafted, every slot and variety's
mint, the Armory slot set); none moved. Built: `EquipmentSlotType` `module`, a MULTI slot (`MULTI_SLOT_TYPES` in
equipmentQueries.ts); `EQUIPMENT_SLOTS.module` (no signature line, no affix pool: rarity and quality act through
`moduleEffectScale`, which moved to model.ts and is re-exported by crewModules.ts); `SLOT_BASE_PHYSICALS.module` mass 0,
durability 100, its draw the def's (`UniversalModuleDef.powerDraw`, applied at mint, itemgen.ts). The leaf catalog
`shipModules.ts`: the types for Passive, Proc, Conditional, Active, Set and Special, the M4 trigger union, the M1 rule
(`MODULE_SLOT_SHARING_TYPES`: module + specUtility share `moduleSlots`), `validateUniversalModuleCatalog` (refuses a
category or key with no engine yet, and a second module on one Passive / Conditional key until it has a D23 curve).
`UNIVERSAL_MODULES` is EMPTY (the roster is EM-7's, the Lens EM-8's). Install gate: `duplicateModule` (M8), then
`moduleSlotsFull` (a module, or a Spec Utility into an EMPTY slot), then `overPower`; S2 for modules only: a module
cannot be installed or removed while `shipCrewLocked` (an expedition included), the other slots keep `onMissionLock`
(S2 for them is still unbuilt). Engines: Passive `powerOutput` folds into `equipmentStatMods.modulePowerOutput` (the
sheet, `shipPowerTotals`, `shipPowerBudget.moduleOutput`; `reactorOutput` and `reactorSurplus` stay the reactor's);
Passive `hullIntegrity` and Conditional `weaponDamage` (hull or shield below a fraction, per projectile, no draw) in
`bridge.ts applyModuleCombat`, so every fold that passes installed gear (patrol, replay, ship events) reads them.
Armory: `module0..n` slots and `loadoutModuleRuleBroken` (cap + one per set); check-out / check-in honor S2 when a
module moves. Wear (M9): `module:minutesUnderway` (raw 2) and `module:effect`, pending on gear wear steps 3 / 4 like
every slot. **The switch:** `UNIVERSAL_MODULES_LIVE = false` (shipModules.ts) hides the Armory module slots; the
engine is live. **For EM-7:** flip the switch in the commit that adds the first module blueprint (shipModules.test.ts
asserts the switch equals "a module blueprint exists"), add each def to BOTH `UNIVERSAL_MODULES` and
`EQUIPMENT_SLOTS.module.varieties`, add the catalog to the wiring registry with probes (sheetPowerOutput,
combatHullMax, a below-threshold damage probe), flip the hulls' `moduleSlots` entries live (owner text names EM-7), and
make the Aurora description true (OC-D13). **For EM-6:** add each new effect key and category to `MODULE_ENGINE_KEYS`
with its engine. **For EM-10:** the `onMission` reason text says "captain is on a mission"; a module on an expedition
needs the crew-lock wording. Registry: two wear rows added and every hull's `moduleSlots` re-owned to EM-7 (still
pending); `emodEm5Registry.fixture.ts em5ReadBack` reads both back for emodGoldens and shortRangeGoldens. No save step.

**EM-6 Proc and Active engine (the Combat 1.1 active-ability engine).** The trigger taxonomy (call M4) at fixed points
in the step loop; private salted streams; Actives auto-cast by their preset rule (call M3). Frozen per patrol cycle;
mission-cycle procs keyed on the run's cycle counter; expedition procs frozen in the dispatch snapshot. Tests: replay
parity with modules; a module-free fleet byte-identical; every trigger fires at its point; cooldown and once-per-battle.

*Carry note (EM-6 built 2026-10-21 on feat 3306bda, merged with feat bc25a23).* Goldens first: `emodEm6Goldens.test.ts` (own commit) pins
resolveBattle for every combat hull and every open (plain, precharged, the player ambushing, the player ambushed),
logged and offline; a patrol per combat hull on both routes with the replay and an in-flight save/load continuation;
six Orion Ground Ops runs (probe battles, cloaked ambushes) through claim; three extraction runs stepped and as one
offline `tick()`. None moved (no module = no engine: `makeModuleEngine` returns null, `moduleCycle` / `moduleScanProcs`
are absent). Built in the leaf `shipModules.ts`: the trigger rules (`MODULE_TRIGGER_CONTEXTS` checked per listed
context: only a ship event can ambush; `MODULE_TRIGGER_EFFECTS`), the engine keys `arcDamage` / `shieldRestore`
(combat), `bonusHaul` (mission cycle), `extraDiscovery` (body scanned) for Proc, Special and (combat only) Active, the
frozen shapes (`moduleCombatProcs`, `moduleCycleProcs`, `moduleScanProcs`, integer at the fold, module id order) and
three salts registered in salts.test.ts (`MODULE_PROC_SALT` per battle and turn index, `MODULE_CYCLE_SALT` per captain
lifetime cycle with the save seed mixed in, `MODULE_SCAN_SALT` per body). The validator now refuses: an Active with a
chance or without once-per-battle / a cooldown (M3), a hull threshold without a rule, a cooldown outside combat, a
context its trigger never reaches, a non-whole arc, a fraction out of (0, 1], and two modules on one triggered key
(D23). Combat (`resolveBattle.ts`): battle start (before an ambush), incoming ambush (the ambushed party, before the
salvo), after ambush (after a salvo fired), on hit (a connecting weapon shot or drone volley on the carrier, the
ambush salvo included), then per combat tick and below a hull threshold once per tick after status effects. A proc
fires when its rule holds, its effect would act (an arc needs a living target: the attacker, else the current
target; a restore needs missing shields) and its chance lands; a failed chance spends nothing. Each carrier rolls on
its own stream; a certain chance takes no draw. New log event `moduleProc` (flavor `moduleArc` / `moduleShield`,
`{module}` placeholder, Simplified line, an arc pop) carries the pools, so the replay fold stays true. Frozen: patrol
waves and the replay fold the installed pieces (all ship gear is locked while out, S2 shipGearLock); ship events fold the dispatch
snapshot; `Expedition.moduleScanProcs` is written at dispatch; the mission cycle reads `bonuses.moduleCycle`
(`missionCycleModulesFor`, a call-constant) on delivered non-transport extraction cycles, keyed on the new optional
lifetime counter `CaptainState.moduleCycles` (the Motherlode rule; no save step). Tests: `shipModuleProcs.test.ts`
(one fixture module per trigger in shipModulesTest.fixture.ts). Registry: nothing added or moved (no catalog entry
exists; EM-7 registers each module with its probe). `MODULE_ARC_FAMILY` (EW, user-confirmed 2026-10-22). **[PROVISIONAL]** `MODULE_SCALE_ON`
(the Lens' rarity and quality lift its chance, since one discovery is a whole count). **Readings for the user:** "on
hit" is a hit TAKEN (the roster's Arc Discharger); the mission cycle is an extraction cycle (short-range board runs and
transport runs do not fire it); a bonus haul lands after Motherlode and before Command Presence. **For EM-7:** add
each def to `UNIVERSAL_MODULES` and the slot varieties; the roster's four triggered rows fit the engine as approved
(Arc Discharger: proc onHit arcDamage; Prospector's Echo: proc missionCycle bonusHaul; Shield Surge: active hullBelow
0.5 oncePerBattle shieldRestore 0.3); the Set engine is still yours. **For EM-8:** the Precursor Lens is a `special`
bodyScanned `extraDiscovery` 1 (contexts `["expedition"]`). **For EM-10:** the one-line Active rule text reads the
def's trigger and rule.

**EM-7 v1 roster and blueprints (content).** The roster the user approves (call M6), blueprints on Lab tiers 2 to 4
[PROPOSAL] (OC-15 tiers), recipes per call M7, two-piece set bonus. Tests: each module mints and acts in its context;
a no-dead-stats entry per module (OC-K3); Archive rows.

**EM-8 Precursor Lens special module.** Discovery-gated blueprint (`requiresRelicDiscovery: "precursorLens"`), input
Precursor Circuit, one per fleet or per ship per call M8, its unique proc per call M6. Registry: the Precursor Lens
first-find row LIVE. Tests: masked until identified; mints; proc acts.

**EM-9 Salvage-exclusive loop (call M2).** Salvage drops a damaged module precursor [PROPOSAL item], a repair process
rolls a chance at an exclusive module with a visible pity counter, set iLevel per item type (SUGGESTIONS decision). Its
own short design first (venue, pity, ceiling interaction). **0.14.x candidate** (recommended there).

**EM-10 UI (mockup first, new sign-off).** Ship Systems: a Modules row of `moduleSlots` tiles, a power bar ("Power 84
/ 130", headroom, over-budget chip), drive class draw on the FTL tile; Fabricator "Modules" group; Logistics "Modules"
family replaces the coming-soon chip; module tooltip with its trigger in plain words; refusal reasons; Help topic "Power
and modules". Verify in preview desktop + 375 px.

### Order and dependencies

ML-0, ML-1, ML-2, ML-3 can start now (WR-4 is done). ML-4 and ML-5 after ML-3. ML-6 after GG-1 and G2-4. ML-7 after its
mockup. EM-0 and EM-1 can start after CP-11 (bridge, quarters, sensor blueprints exist to install). EM-2 after EM-1.
EM-3 and EM-4 after WR-8 (bridge.ts, patrol goldens, reactor pools from the installed piece). EM-5 to EM-8 after EM-2
and the M1 answer; EM-6 after WR-8. EM-10 after its mockup. ML and EM share only `model.ts` data tables and run as
separate builders, not in parallel on the same file.


## 5. OPEN CALLS (multiple-choice ready; recommended first; most important first)

**Power budget**
1. **P1 Hull base power.** (a) Every hull gets a base output at or above today's heaviest crafted loadout (values in 3.2);
   nothing on a live save goes over budget, and the budget binds on modules and higher drive classes (Recommended).
   (b) Base sized to a typical loadout, so heavy weapon builds need a crafted Reactor Core (moves patrol balance; live
   over-budget ships take the penalty). (c) No hull base; the Standard-Issue Reactor Core gets a floor output instead.
2. **P3 What a Reactor Core is worth (B10).** (a) Reactor power the ship does not use speeds the drive on a diminishing
   curve (the B.4 grid: power not spent on weapons goes to the drive) (Recommended). (b) Cut the reactor's base mass so
   it never slows the ship; headroom only. (c) Both.
3. **P2 Over budget anyway** (a reactor removed, an Engineering officer leaves). (a) Never evict; a warning chip; the
   combat penalty applies (Recommended). (b) Never evict and no penalty until the loadout changes. (c) Also block patrol
   dispatch (not recommended: power gates installs, not dispatch).
4. **P6 Penalty shape.** (a) Weapon damage and shield recharge x sqrt(output / draw), never below 60% (Recommended).
   (b) Linear output / draw, never below 50%. (c) Weapons only.
5. **P4 Power efficiency** (Overdrive, Power Discipline, Martian). (a) Cuts the ship's net draw on a diminishing curve
   (Recommended). (b) Raises output instead.
6. **P5 Drive classes draw power (S4-A03).** (a) FTL drive draw grows x1.6 per class above I, so deep reach competes
   with weapons and modules (Recommended). (b) No extra draw.

**Modules**
7. **M1 Module slots (H.1 vs OC-D4).** (a) `moduleSlots` counts universal modules only; bridge, quarters, sensor and SUS
   keep one fixed slot each, so OC-D4's cap lands on the module sockets (Recommended). (b) One shared pool capping all
   module-class pieces, with hull counts raised [PROPOSAL 4 to 8]. (c) OC-D4 as answered on the four slots, plus a
   separate new count for universal modules.
8. **M2 How much of E-MOD in 0.14.0.** (a) Power budget + all five categories with a small v1 roster (about 8 modules
   + the Precursor Lens); the salvage-exclusive loop moves to 0.14.x (Recommended). (b) Everything now, the loop too.
   (c) Power budget + Passive and Conditional + the Precursor Lens now; Procs, Actives, Sets in 0.14.x.
9. **M5 Uniqueness.** (a) Modules carry only effects found nowhere else (H.1 "the draw"), so none of the OC-D12 pod and
   drone lines (Recommended). (b) Modules may also carry those lines so non-carrier hulls get them.
10. **M3 Active auto-cast rule.** (a) Each Active ships one preset rule (its condition, once per battle or on a
    cooldown), no editor (Recommended). (b) Two or three selectable presets per module (a small picker, mockup).
    (c) A full ship gambit editor (largest).
11. **M4 Trigger set.** (a) Combat: battle start, incoming ambush, after ambush, on hit, per combat tick, below a hull
    threshold; outside combat: per mission cycle and per body scanned (Recommended). (b) Combat triggers only.
12. **M6 v1 roster** (every name and effect [PROPOSAL]; approve, rename or replace any row):

    | Category | Module [PROPOSAL] | Effect [PROPOSAL] | Context |
    |:-|:-|:-|:-|
    | Passive | Auxiliary Capacitor | +power output (flat) | all |
    | Passive | Structural Bracing | +hull integrity % | combat |
    | Proc | Arc Discharger | on hit taken, a chance to arc a small hit back | combat |
    | Proc | Prospector's Echo | each mission cycle, a chance of a bonus haul of the cycle's common material | mission |
    | Conditional | Last Stand Protocol | below 25% hull, +damage | combat |
    | Active | Shield Surge | once per battle below 50% hull, restore 30% shields (Combat 1.0's own example) | combat |
    | Set (2 pieces) | Survey Pair: Long-Baseline Array + Signal Integrator | together: +scan speed on expeditions | expedition |
    | Special | Precursor Lens | each body scanned, a chance to uncover one extra hidden discovery ("you will see the writing that used to be there") | expedition |

13. **M7 Module recipes.** (a) Material Lines themes (Reclaimed Circuit, Photonic Gel, Cobalt Coil, Osmium Plate,
    Iridium Catalyst for the top tier) (Recommended). (b) Existing components only, like CP-11.
14. **M8 Duplicates.** (a) One copy of a module per ship; the Precursor Lens one per ship (Recommended). (b) Duplicates
    stack on the D23 curve. (c) The Precursor Lens one per fleet (the Neural Backup rule).
15. **M9 Module wear.** (a) Slowly by time underway, like crew modules (Recommended). (b) Never.

**Material Lines**
16. **L1 Items.** (a) Build the 7 July-approved items and 7 remaining recipes as named (Recommended). (b) Rename some
    (say which). (c) Simple refines only (Ferrite Ingot, Reclaimed Circuit, Iridium Catalyst), compounds later.
17. **L8 Early Deuterium source** (the gas giant study is the deep source, GG plan). (a) Local Deuterium Skim returns as
    an ordinary Tier I mining run (no fuel role), so a Class III drive does not wait on an expedition (Recommended).
    (b) Gas giant study only. (c) Deuterium Ice drops on the Lunar Mine and surveys.
18. **L9 Deuterium consumers** (answer once, for this plan and GG call 7). (a) Class III+ FTL drives (G2-4) and the
    High-Output Core (Recommended). (b) Drives only. (c) Every Reactor Core variety too.
19. **L2 Recipe pass scope.** (a) Cargo, FTL, reactor, utility, shields, plating now; weapons and drones stay for the
    0.16.0 balance patch; bridge, quarters and sensors keep CP-11's components (Recommended). (b) Also weapons and drones
    now. (c) The four economy slots only.
20. **L4 Per-unit chance, implemented.** (a) The exact expected count plus one keyed rounding roll per delivery (no
    shared draws) (Recommended). (b) A private per-unit roll for every unit (cost grows with haul size).
21. **L5 Spending good stock.** (a) A per-order "Use best materials" toggle, default lowest-first (Recommended, mockup).
    (b) Best-first by default for craft lines. (c) Lowest-first only (quality rarely flows).
22. **L7 Crafted gear inherits quality.** (a) Yes: quality blanks, one step appended to v70 (Recommended). (b) Stackable
    outputs only now; gear in 0.14.x.
23. **L6 Carry formula.** (a) Unit-weighted average, floored, plus the usual climb roll (Recommended). (b) Weakest link.
    (c) The better of the carried quality and the roll.
24. **L3 Cobalt gate.** (a) Accept level 4 (Survey Mineral Anomaly) for the Cobalt Coil varieties; anchors stay open
    (Recommended). (b) Add Cobalt back to the Lunar Mine as a second uncommon. (c) Swap those recipes to Ferrite Ingot.
25. **L10 Material rarity cap.** (a) Skip; as written it nerfs every craft (Recommended). (b) A positive form later.
    (c) Build the cap.
26. **L11 Small data calls, one answer each.** Sprint Drive vs Efficient Core differentiation as in E-MAT 3c (approve /
    other); Structural Assembly kept on Hauler Hold and dropped on High-Output Core (approve / same rule for both);
    Reclaimed Alloy retagged uncommon (yes / no).

**Ownership**
27. **X1 OC-D2.** (a) ML-3 builds it; WR-7 drops the row (Recommended). (b) WR-7 builds it; ML-3 only consumes it.

**Not decisions for this plan:** E-SUS names (blocked), the other five canisters and their uses (GG call 7), Relics v2
renames.


## 6. Size and scope (honest)

| Block | Slices | Size | Notes |
|:-|:-|:-|:-|
| Material Lines core (ML-0 to ML-3) | 4 | M | Mostly data + one deterministic seam; low risk |
| Quality carry + blanks (ML-4, ML-5) | 2 | M | ML-5 is the one save step; **0.14.x candidate** |
| Deuterium (ML-6) | 1 | S | Waits on GG-1 and G2-4 |
| Material Lines UI (ML-7) | 1 + mockup | S to M | |
| Power budget (EM-0 to EM-4) | 5 | M to L | EM-3 and EM-4 move combat and speed goldens; after WR-8 |
| Module foundation + engine (EM-5, EM-6) | 2 | L | The genuinely new sim architecture (Combat 1.0 called it the highest-risk part) |
| Roster + Precursor Lens (EM-7, EM-8) | 2 | M | Content; needs the M6 names |
| Salvage-exclusive loop (EM-9) | 1 + design | M to L | **0.14.x recommended** |
| Modules UI (EM-10) | 1 + mockup | M | |

Total: about 19 slices, two new mockups. Scope push-back (standing rule): 0.14.0 already carries CP, FK, G2, SF, WR,
Ground Ops, Relics v2, the gas giant study and G1. This plan is the largest remaining G8 block, and E-MOD's module
engine is the single biggest new system left in the release. The cleanest cuts that keep every promise honest are
EM-9 (the salvage loop), ML-5 (quality blanks) and, if the user wants more room, the M2 (c) split (Procs, Actives and
Sets in 0.14.x). The power budget itself should not move: seven registry rows and Task 22's allow-list wait on it.

## USER ANSWERS (2026-10-17)

- **Hull base power:** "Hulls get base power (Recommended)": each hull supplies enough base power for a normal
  Standard-Issue + early crafted fit; a crafted Reactor Core adds more; explorers power-rich.
- **Reactor Core value (B10):** "Power headroom + surplus bonus (Recommended)": raises the budget, and unused surplus
  gives a small bonus (e.g. faster shield recharge).
- **Over budget:** "Gentle penalty curve (Recommended)": smooth reduced strength as the shortfall grows; nothing
  shuts off; installing over budget is refused with the reason shown.
- **Module slot conflict:** "Separate counts (Recommended)": bridge, quarters and sensor always have their own slot;
  `moduleSlots` caps only the universal modules and spec utility (Aurora the most). Supersedes OC-D4's wording.
- **P1 pinned:** "No ship goes over (Recommended)": base output at or above today's heaviest crafted loadout; the
  budget binds on modules and higher drive classes. **P3 surplus:** "Speeds the drive (Recommended)" (supersedes the
  "faster shield recharge" example in the first answer). **M2 scope:** "Power + all 5 types, small roster
  (Recommended)": salvage-only module loop to 0.14.x. **P6 penalty:** "sqrt curve, floor 60% (Recommended)".

## USER ANSWERS (2026-10-19)

- **P4 power efficiency:** "Cuts net draw (Recommended)": Overdrive, Power Discipline and Martian cut the ship's net
  draw on a diminishing curve.
- **L9 Deuterium consumers:** answered through gas giant call 7 ("Drives + Lab blueprints"): Deuterium feeds Class III+
  FTL drives; whether the High-Output Core also takes it is asked with L8.
- **P5 drive draw:** "x1.6 per class (Recommended)".
- **M3 Active auto-cast:** "One preset rule (Recommended)".
- **M4 trigger set:** "Original proposal (Recommended)" (the earlier "Something else" was a misclick, user
  2026-10-19): combat battle start, incoming ambush, after ambush, on hit, per combat tick, below a hull threshold;
  outside combat per mission cycle and per body scanned.
- **M5 uniqueness:** "Unique effects only (Recommended)".
- **M6 v1 roster:** "Approve all (Recommended)": the eight rows in section 5 call 12 as named, with those effects.
- **M7 recipes:** "Material Lines items (Recommended)".
- **M8 duplicates:** "One per ship (Recommended)"; the Precursor Lens one per ship too.
- **M9 module wear:** "Slowly underway (Recommended)".
- **L1 items:** "Build as named (Recommended)": the 7 July-approved items and 7 remaining recipes.
- **L8 early Deuterium:** "Deuterium Skim mining run (Recommended)": Local Deuterium Skim returns as an ordinary Tier I
  mining run (no fuel role). With L9 (via GG call 7): Deuterium feeds Class III+ FTL drives and the High-Output Core.
- **L2 recipe scope:** "Six economy/defense slots (Recommended)": cargo, FTL, reactor, utility, shields, plating now;
  weapons and drones wait for 0.16.0; bridge, quarters, sensors keep CP-11's components.
- **L4 per-unit chance:** "Expected count + 1 roll (Recommended)".
- **L5 spending stock:** "Toggle, lowest-first default (Recommended)".
- **L7 crafted gear inherits quality:** "Yes, gear too (Recommended)": quality blanks, one step appended to v70.
- **L6 carry formula:** "Weighted average + climb (Recommended)".
- **L3 Cobalt gate:** "Accept level 4 (Recommended)".
- **L10 rarity cap:** "Skip it (Recommended)".
- **L11 small data calls:** "Approve all three (Recommended)": Sprint Drive vs Efficient Core as in E-MAT 3c;
  Structural Assembly kept on Hauler Hold, dropped on High-Output Core; Reclaimed Alloy retagged uncommon.
- **X1 OC-D2 owner:** "Material Lines builds it (Recommended)": ML-3 builds it; WR-7 drops the row.
- ALL Material Lines and E-MOD calls answered (2026-10-19).
- **ML-1 recipe numbers (2026-10-20):** "Approve (Recommended)": MATERIAL_LINE_RECIPE_NUMBERS as built (Ferrite 20:1
  12 ticks; Circuitry 5:1 and Iridium 3:1 20 ticks; Cobalt Coil 3 Cobalt + 1 Titanium Ingot; Osmium Plate 2 Osmium +
  2 Ferrite Ingot; Photonic Gel 1 Wafer + 3 Resin; Biocatalyst 2 Purified Biomass + 1 Spore; compounds 20 ticks).
- **EM-2 non-worsening installs (2026-10-21):** "Allow non-worsening (Recommended)": on a ship already over budget, an
  install that does not raise the shortfall still goes through (so a player can always climb out). Review follow-ups for
  the builder: the refusal must show the WHOLE shortfall (after-install draw minus output), not only the increment; the
  Power Draw help text must describe this rule truthfully; roster apply judges the fully applied roster (its officers and
  crew included); the warning names the cause; the Armory Check out button disables when refused; drop the duplicate
  reason/refusal field; consider moving equippedFor + MULTI_SLOT_TYPES to a leaf module to break the import cycle.

## OPEN CALLS for the user (2026-10-23, from the EM-3 review; built on these defaults)

1. Drones are NOT weakened when over budget (P6 names only weapon damage and shield recharge).
2. Shields still refill at full speed between patrol waves (outside combat); only in-fight recharge is cut.
3. The supply percent rounds DOWN (81% where the mockup's sketch rounded to 82%), so it shows the number the ship
   actually fights at.
4. Battle Rating does not drop for an over-budget ship (it also ignores the other WR-8 stamp fields). Should BR reflect
   the power cut?

## EM-4 built (branch em-4, 7f7de6d, 2026-10-23): open calls for the user

Built per P3 (a) "Speeds the drive": lift = 1 + 0.022 x diminishing(surplus, 10) [PROVISIONAL], concave, uncapped.
Builder's findings: (1) the first answer said unused surplus gives a SMALL bonus, but the plan's B10 bar (a crafted
core nets positive after its full mass 12, which costs 19% speed) forces the top of the curve high: a top core (iL40
q5 Radiant, ~150 output) about DOUBLES speed (Freighter Short Ore Run legs 25 to 13 ticks; Orion Tier I voyage 5,577 s
to 2,776 s each way). (2) Real tier 1 cores supply about their item level (1 to 35), not the plan's assumed 20 to 40, so
a fresh crafter's core (iL1 to 10) can still be SLOWER than Standard Issue; only from about 17 output (iL15) does the
worst roll net faster. Fully fixing that needs the mass cut too (P3 option c, not picked). (3) Combat speed is not
monotonic: a ref core gives combat speed 31 on the Destroyer Warband and wins 6 of 64 vs 9 at Standard Issue's 30.
USER ANSWERS (2026-10-23): (1) early cores: "Never slower (Recommended)" (a crafted core's speed can never drop below Standard Issue's; its weight only eats into the surplus bonus; a systemic guarantee). (2) top end: "Soften the top (Recommended)" (flatten the curve so the best core gives a solid but modest lift, about +30 to +40%).
EM-4 follow-up built (5e5bf19): never-slower floor + REACTOR_SURPLUS_LIFT 0.0077/knee 10 (best core +35%). OPEN CALL: with both answers, a Standard-quality core at full mass 12 never shows a speed gain in 0.14.0 (needs ~80 unused power, worst iL40 roll ~46); gains show only on light or high-output rare cores (Radiant q5 High-Output: +8% iL10, +23% iL20, +35% iL40). For most cores the value is power headroom plus never slower. If ordinary cores should feel faster, the remaining lever is the mass cut (P3 option c). The 31-vs-30 combat case was noise (one real step at the pirates' speed 30).
OPEN CALL (EM-4 review, 2026-10-23): should a WORN reactor shrink the surplus speed lift? Built: the lift reads pristine output; the never-slower floor holds either way. Patch-note line needed: repeating runs dispatched before EM-4 get the lift (and the floor) only once re-dispatched; patrols pick it up at their next cycle.
