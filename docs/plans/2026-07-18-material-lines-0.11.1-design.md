# 0.11.1 "Material Lines" Design

**Status:** DRAFT for user review. Design direction locked 2026-07-18 (see SESSION_HANDOFF.md §5); this doc turns it into a concrete, buildable spec. Exact quantities are first-pass device-check tunables; the THEMATIC ASSIGNMENTS and SCOPE are what to approve.

**Goal:** Give all 12 mission-loot items a real purpose (or an honest "reserved for future" tooltip), by making each ship system crafted from its thematically-matched material lines, so every mission pulls its weight, without walling off any slot behind a mission the player cannot yet run.

---

## 1. The problem

The 0.11.0 crafting loop is fully playable off just TWO raw ores: `commonOre` (Titanium) and `uncommonMaterial` (Polysilicate), both from the Local Asteroid run. Everything the 12 equipment blueprints consume traces back to those two through the titanium/polysilicate spine:

```
commonOre ─refine▶ titaniumIngot / refinedMaterial ─fabricate▶ frameSegment ─┐
uncommonMaterial ─refine▶ polysilicateWafer ────────fabricate▶ powerCoupling ┤▶ structuralAssembly ▶ GEAR
```

The other 10 mission items (from the Lunar Mine, Salvage, and Forage runs) have NO refine recipe and NO sink. They pile up as dead loot. Two refined targets already exist with broken-promise tooltips: `reclaimedAlloy` ("Refined from salvage") and `purifiedBiomass` ("Refined from foraged biomass"), neither wired.

## 2. The hard constraint: mission ladder == crafting access

The four resource missions are all unlock-level 1 (available on a fresh save), but they carry CAPABILITY gates that form a natural progression:

| Mission | Loot (common / uncommon / rare) | Capability gate |
|---|---|---|
| Local Asteroid | Titanium / Polysilicate / Iridium | none (immediate) |
| Lunar Mine | Ferrite / Cobalt / Osmium | none material (early) |
| Salvage Wreckage | Scrap / Circuitry / Reactor Cell | captain L2 + cargo 90 |
| Forage Flora | Biomass / Resin / Spore | captain L3 |

**Design rule (non-negotiable):** every slot must have at least one variety craftable from EARLY materials (Asteroid, or Asteroid + Lunar), so a new player is never blocked from upgrading a slot. Materials gated behind Salvage (L2) or Forage (L3) may only be REQUIRED by premium / higher-research-tier varieties, never by a slot's only option. Because 0.11.0 already seeds a stat-neutral Standard-Issue baseline in every slot, no ship is ever un-flyable regardless; this rule is about not gating the first real UPGRADE of a slot.

## 3. The four material line identities

| Line | Mission | common | uncommon | rare | Feeds |
|---|---|---|---|---|---|
| **Structural spine** | Local Asteroid | Titanium → ingots/frames | Polysilicate → wafers/couplings | Iridium → premium catalyst (reserved) | everything (base) |
| **Heavy metals** | Lunar Mine | Ferrite → bulk structural | Cobalt → reactor/drive coils | Osmium → shielding / high-output | holds, reactors, drives |
| **Recovered tech** | Salvage | Scrap → reclaimed structural | Circuitry → recovered electronics | Reactor Cell → reactor-craft ingredient | reactors, drives, holds |
| **Organic chemistry** | Forage | Biomass → composite fiber | Resin → compound base | Spore → exotic bio-catalyst | spec-utility (sensors), compounds |

## 4. The refine + compound layer (stage 1)

Wire the two existing broken-promise targets, add a small set of new refined materials, and introduce the multi-input "chemical compound" refines the user asked for. Keep item count disciplined: prefer compounds over one-refined-item-per-raw.

**Simple refines (single raw in):**

| Recipe | In | Out | Status |
|---|---|---|---|
| refineFerriteIngot | Ferrite | `ferriteIngot` (new, heavy structural) | new item + recipe |
| refineReclaimedAlloy | Scrap Alloy | `reclaimedAlloy` | target EXISTS, wire recipe |
| refinePurifiedBiomass | Fibrous Biomass | `purifiedBiomass` | target EXISTS, wire recipe |
| refineReclaimedCircuit | Salvaged Circuitry | `reclaimedCircuit` (new, recovered electronics) | new item + recipe |

**Compound refines (multi-input "chemical process," the sci-fi flavor):**

| Recipe | Inputs | Out | Feeds |
|---|---|---|---|
| synthPhotonicGel | Polysilicate Wafer + Volatile Resin | `photonicGel` (new) | survey sensors |
| synthBiocatalyst | Purified Biomass + Exotic Spore Cluster | `biocatalyst` (new) | refinery-feed rig |
| synthCobaltCoil | Cobalt Ore + Titanium Ingot | `cobaltCoil` (new) | drives, reactors |
| synthOsmiumPlate | Osmium Ore + Ferrite Ingot | `osmiumPlate` (new) | high-output reactor shielding |

Multi-input refines require a small extension to `REFINE_RECIPES` (today each recipe has ONE input key; the shape `input: Record<string, Decimal>` already supports multiple, so this is data, not an engine change, VERIFY in the plan). The Derelict Reactor Cell (see §6) is consumed DIRECTLY as a crafting ingredient, not refined.

## 5. The reworked 12 equipment recipes (stage 2)

Each slot gets a thematic identity; its three varieties escalate from Asteroid-spine (early) to themed premiums (later). Quantities are placeholders.

**CARGO BAY = structural (metals + composite):**

| Variety | Tier | Reworked recipe | Theme / gate |
|---|---|---|---|
| balancedHold (default) | 1 | frameSegment 2 + titaniumIngot 2 + refinedMaterial 2 | unchanged, Asteroid, early |
| prospectorHold | 1 | frameSegment 2 + purifiedBiomass 3 | light composite hold, Forage (see §7 gate note) |
| haulerHold | 2 | frameSegment 3 + ferriteIngot 2 + reclaimedAlloy 2 | heavy structural, Lunar + Salvage, T2 |

**FTL DRIVE = propulsion electronics + coils:**

| Variety | Tier | Reworked recipe | Theme / gate |
|---|---|---|---|
| balancedDrive (default) | 1 | powerCoupling 2 + polysilicateWafer 2 + titaniumIngot 1 | unchanged, Asteroid, early |
| sprintDrive | 1 | powerCoupling 2 + cobaltCoil 2 | magnetic speed coils, Lunar |
| economyDrive | 1 | powerCoupling 2 + reclaimedCircuit 3 | efficient recovered tech, Salvage |

**REACTOR CORE = power metals + salvaged cores:**

| Variety | Tier | Reworked recipe | Theme / gate |
|---|---|---|---|
| balancedCore (default) | 1 | powerCoupling 2 + polysilicateWafer 2 + titaniumIngot 1 | unchanged, Asteroid, early |
| efficientCore | 1 | powerCoupling 2 + cobaltCoil 2 | regulated coils, Lunar |
| highOutputCore | 2 | powerCoupling 3 + iridiumCatalyst 1 + osmiumPlate 1 | premium reactor, Iridium catalyst + Lunar rare, T2 |

**SPEC UTILITY = sensors (electronics + organics):**

| Variety | Tier | Reworked recipe | Theme / gate |
|---|---|---|---|
| yieldRig (default) | 1 | frameSegment 2 + polysilicateWafer 2 | unchanged, Asteroid, early |
| surveyRig | 1 | powerCoupling 2 + photonicGel 2 | sensor array compound, Forage |
| refineryFeedRig | 1 | refinedMaterial 2 + biocatalyst 2 | quality sorter compound, Forage |

**Item usage tally:** this wires Titanium, Polysilicate, Ferrite, Cobalt, Osmium, Scrap, Circuitry, Reactor Cell, Biomass, Resin, Spore = 11 of 12. **Iridium (Asteroid rare) is the one deliberately RESERVED** with an honest "not yet used in any recipe; reserved for a future higher-tier gear line" tooltip. (It is the natural premium catalyst for gear tiers above Radiant / the 0.12.0+ combat systems, which do not exist yet. Wiring it now would be speculative.)

## 6. The Derelict Reactor Cell (the rename + ingredient rule)

The rare Salvage item is `intactReactorCore`, label "Intact Reactor Core." Two problems: (a) the user does not want it to read as an installable reactor (it must be a crafting INGREDIENT only), and (b) its name collides conceptually with the `reactorCore` equipment SLOT.

- It is ALREADY a raw mission-loot item, never an installable `EquipmentInstance`, so "not installable" holds by construction. It is consumed as a direct input to `highOutputCoreBp` (§5).
- Rename to **"Derelict Reactor Cell"**. RECOMMENDATION: rename the LABEL only (display-only, no save migration; the item id `intactReactorCore` stays). Changing the id would force an inventory-key migration for zero functional gain. OPEN CALL: acceptable to keep the id, or do you want the id changed too (costs a migration)?

## 7. No-wall verification + the soft-gate note

Every slot has an Asteroid-spine default (balancedHold / balancedDrive / balancedCore / yieldRig) craftable immediately. No HARD wall.

SOFT gates (intended progression, but worth aligning): several T1 premium varieties (prospectorHold, economyDrive, surveyRig, refineryFeedRig) require Salvage- or Forage-tier materials the player cannot gather until captain L2/L3. A player could RESEARCH the blueprint before they can FEED it. That is honest (the Fabricator will show the missing material), but it can feel like a tease. **Recommendation:** bump the research availability of the Forage/Salvage-dependent varieties so a blueprint becomes researchable roughly when its materials become gatherable (e.g. tie their research tier or a captain-level hint to the mission that supplies them). Flag for the plan; do not over-engineer.

## 8. Save / migration

- New ITEMS entries (ferriteIngot, reclaimedCircuit, photonicGel, biocatalyst, cobaltCoil, osmiumPlate; reclaimedAlloy + purifiedBiomass already exist) are additive inventory keys. Empty on old saves = fine; they appear when first produced. The quality-bucketed inventory already tolerates absent keys. Likely NO save-version bump needed (verify: adding ITEMS keys does not change the save SHAPE).
- Label-only rename of intactReactorCore: no migration.
- The reworked equipment RECIPES change only `BLUEPRINTS[...].recipe.inputs` (data). Existing crafted gear is unaffected (recipes are consumed at craft time, not stored). In-flight fabricate jobs: confirm a job started under the old recipe resolves against the reserved (already-deducted) materials, not the new recipe, so a mid-flight patch cannot strand a job. This is the one migration-adjacent risk to verify in the plan.

## 9. Testing strategy

- Refine + compound recipes: each produces the right output from the right inputs; multi-input recipes deduct ALL inputs atomically (mirror the existing single-input refine tests).
- Reworked equipment recipes: each of the 12 consumes its new inputs and still mints the correct `EquipmentInstance` (the Task 19 mint path is unchanged; only inputs differ).
- No-wall assertion: a test that, for each slot, at least one variety's recipe inputs are all reachable from Asteroid-only (or Asteroid + Lunar) materials.
- Reserved-item honesty: a standing-rule test that every raw item either has a downstream consumer OR a "reserved for future" tooltip (extend the existing unlockHint non-empty guard with a "has a sink or is explicitly reserved" check).
- Offline/live parity: refines run through the existing `refineJob` path already in `economyTick`; adding recipes does not add a new seam. Confirm no new RNG draw is introduced (refines are deterministic).

## 10. Scope boundaries (NOT in 0.11.1)

- No new equipment SLOTS, varieties, or stats. Only the INPUTS of the existing 12 recipes change, plus the refine/compound layer.
- No combat, weapons, or shields (0.12.0).
- No higher gear tiers / rarities above the current ladder. Iridium stays reserved.
- No rebalance of stat magnitudes or the stat-neutral baseline (that is the separate device-check tuning pass).
- No per-hull slot availability wiring.

## 11. Open calls for user review (before this goes to a plan)

1. **Iridium reserved** (the only unwired item) with an honest future tooltip: OK, or do you want it wired now (would need a speculative sink)?
2. **Derelict Reactor Cell**: label-only rename (no migration, my rec) vs id rename (costs a migration)?
3. **Compound set** (photonicGel, biocatalyst, cobaltCoil, osmiumPlate): right flavor and count, or trim/expand? Any naming preferences for the sci-fi compounds?
4. **Soft-gate alignment** (§7): align premium-variety research availability with their mission's capability tier, or leave it as honest "you lack material X" feedback?
5. **New refined-item count** (6 new: ferriteIngot, reclaimedCircuit, + 4 compounds): comfortable, or want it leaner (e.g. fold more raws into shared compounds)?

---

## 12. Feedback resolutions (2026-07-18, user reviewed after 0.11.0 tested 10/10)

**Call 1 (Iridium) + Call 2 (reactor cell), RESOLVED as a SWAP.** Iridium is now WIRED, the rare Salvage item is now the RESERVED one:
- **Iridium Ore** refines into `iridiumCatalyst` (new) and feeds `highOutputCore` (the premium reactor). It is no longer reserved. (Adds one refined item; count is now 7 new: ferriteIngot, reclaimedCircuit, iridiumCatalyst, + 4 compounds.)
- The rare Salvage item is renamed **"Damaged Reactor Housing"** (not "Derelict Reactor Cell"; label-only, no migration) and becomes the ONE reserved item, with a tooltip pointing at a FUTURE mechanic.
- **NEW FUTURE MECHANIC (logged, NOT 0.11.x): "salvaging."** Some items can be broken down for a CHANCE at very rare crafting materials. The Damaged Reactor Housing is the first candidate (salvage it for a shot at rare mats). This gives it a real future purpose and is a genuinely new system worth its own design pass later. For 0.11.1 the Housing is simply reserved with an honest "can be salvaged for rare materials in a future update" tooltip.

**Call 3 (compounds): CONFIRMED.** Keep photonicGel, biocatalyst, cobaltCoil, osmiumPlate as designed.

**Call 4 (soft-gate alignment): DEFERRED.** Do NOT engineer mission-gated blueprint availability in 0.11.1. Future content (explorer missions and the like) may itself be the unlock mechanism, so aligning now would be premature. For 0.11.1: leave honest "you lack material X" feedback; a blueprint is researchable when its research tier allows, and the Fabricator tells you what you are missing.

**Call 5 (item count): CONFIRMED.** The set (now 7 new refined items) is fine.

## 13. Companion scope: item + system LEGIBILITY (raised during 0.11.0 testing)

Four legibility gaps surfaced. These are display/naming (low economy risk) and pair naturally with adding + naming new items. SEQUENCING (whether these ship as their own patch before Material Lines, or bundle in) is an OPEN user decision.

1. **`refinedMaterial` needs a proper in-fiction name.** It is the generic refined bulk from Titanium Ore (label is the placeholder "Refined Material"). Candidates: "Machined Stock", "Alloy Billet", "Milled Alloy". NOTE for Material Lines: it overlaps thematically with `titaniumIngot` (both refine from Titanium Ore); worth deciding whether it stays a distinct generic or gets a clearer identity.
2. **Crafted items / `components` need proper names.** `components` is a real placeholder ITEM (model.ts:2467) that every equipment blueprint nominally lists as `recipe.outputItem`. The Task 19 mint IGNORES it (it mints an `EquipmentInstance` instead), so a "Prospector Hold" craft likely DISPLAYS as producing "components" in the Fabricator. Fix: the Fabricator surface should show the blueprint's real ship-system output name; the vestigial `components` output on equipment blueprints should be corrected or the item given a real identity.
3. **Ship Systems must appear in the Warehouse.** Crafted systems are `EquipmentInstance`s in `state.equipment`, a SEPARATE structure from the keyed inventory the Warehouse renders, so the Warehouse's shipModule/shipSystem grouping (App.svelte:586) shows nothing. Need a bridge so owned/spare systems are visible as items (with quality/rarity), so the player can SEE what they have.
4. **Slot tooltips: name + granted stats.** `ShipSystemsPanel` slots have static hover labels (Cargo Bay, Reactor Core, ...) but do NOT show the INSTALLED system's name or the stats it grants. Add a per-slot tooltip/readout: what is fitted here + its stat contribution.

## 14. Future mechanics logged (NOT 0.11.x)

- **Salvaging:** break an item down for a chance at rare crafting materials (see §12). First candidate: Damaged Reactor Housing.
- **Explorer missions (and similar)** as future unlock mechanisms for premium blueprints (see §7 deferral).
