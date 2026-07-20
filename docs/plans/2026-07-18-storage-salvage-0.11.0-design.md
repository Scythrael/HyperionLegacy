# 0.11.0 Storage + Salvage Design

**Status:** DRAFT for user review. Part of making 0.11.0 FEATURE COMPLETE before it promotes to prod. Companion to the legibility design (`2026-07-18-ship-systems-legibility-0.11.0-design.md`) and the salvaging vision notes (`2026-07-18-salvaging-design-notes.md`, the fuller/future context). This doc is the buildable 0.11.0 slice.

**Why full salvage now (user, 2026-07-18):** the storage location + the salvage-equipment mechanic are the hard infrastructure; once they exist, completing the loot side is incremental. Combat (0.12.0) will drop large volumes of salvage, so salvage must land complete and ready for combat to plug into.

**Scope guard:** storage + salvage only. No combat, no Material Lines recipe rework (0.11.2), no new equipment slots/stats.

---

## 1. Capped, upgradable Ship Systems storage

- `state.equipment` is currently UNBOUNDED. Add a CAP on stored systems (a first-pass number, e.g. 25, device-check tunable), surfaced as X / max on the Ship Systems Warehouse tab.
- The cap is UPGRADABLE, mirroring the existing material-warehouse `storageCapMult` rung pattern (model.ts). REUSE that pattern (a track of rungs whose effect multiplies the base cap), so the machinery and UI idiom already exist.
- **Cap counts SPARE systems only** (unequipped, in the pool). A fitted system lives on its ship and does not consume storage. This is the natural model: you manage your SPARE inventory; installed gear is "in use." (Standard-Issue baselines are auto-managed and never counted, see below.)
- **Softlock proof:** with a cap, two escape valves must always exist: SALVAGE (below) and the cap UPGRADE. Salvage is always available on any spare system, so a full store can always be relieved. A test asserts salvage is reachable whenever the store is at cap.

## 2. Salvaging EQUIPMENT (the recycle model)

- Any SPARE crafted system can be salvaged: it is consumed and returns a VARIABLE percentage (first-pass ~30-40%, tunable) of the materials that crafted it (its blueprint `recipe.inputs`), rounded sensibly, deposited to inventory. Frees the storage slot.
- Standard-Issue baselines: NOT salvageable (they are free and craft-less; salvaging them yields nothing and they auto-refit anyway). Or salvage them for nothing but removal. RECOMMENDATION: baselines are simply not offered a salvage action (they are managed by the never-empty invariant, not the storage pool).
- VARIANCE not flat (user: "60% flat is boring"): the return is a rolled value in a band, not a fixed number.
- FA-talent scaling of the yield % is part of §5.
- This is a live, player-initiated INSTANT action (not a timed process), so it is live-path only, uses `Math.random`, and has NO offline-parity concern.

## 3. Salvaging SALVAGED MATERIALS (the loot model)

A new item CATEGORY, "salvaged material," with its own Warehouse tab. First and only member this patch: the **Damaged Reactor Housing** (renamed from `intactReactorCore`, the rare Salvage-mission drop; reclassified from "raw" to "salvaged material"). Its purpose IS to be salvaged.

**The roll (reuses the mission-loot machinery):**
- Salvaging one consumes it and rolls a weighted, TIERED loot table, the same shape as `MISSIONS[...].lootTable` but with a TALLER ladder that maps to the gear rarity tiers (standard, augmented, stellar, radiant, and reserved room above).
- The rolled tier picks an item from that tier's pool; higher tiers yield rarer/better items and higher quality (the dropped material gets a quality appropriate to the tier, reusing the 0-5 quality system).
- **Progression-gated ceiling:** early on, only the low tiers can roll; the high tiers (up to Radiant, possibly higher) unlock and gain weight with progression and FA talents (user). A fresh player salvaging a Housing gets low-tier drops; a developed one can hit the top.

**The loot pool contents (user rules, from the notes):**
- **Exclusive salvage-only items** are the bread and butter of the high tiers: items obtainable ONLY via salvage. Exclusivity is a property, not a category, an exclusive drop can be a raw, refined, or component-type item. THIS PATCH they are DEFINED and droppable but RESERVED (honest "reserved for a future recipe" tooltip), because their consumers are combat / Material Lines / future gear tiers that do not exist yet. They accumulate as a head start for those features.
- **Refined materials and fabricated components** can also drop, but at SUPER-RARE rates (hard rule: salvage must never replace refining/fabricating).
- **HARD BALANCE RULE:** salvage SUPPLEMENTS, never replaces, missions/refining/fabricating. Steep odds on top tiers; super-rare odds on plain refined/components; the reliable, common outcome is modest.

## 4. Where salvage lives

- The **Ship Systems** Warehouse tab (from the legibility work): each SPARE system shows a Salvage action (recycle, §2).
- The **Salvaged Materials** Warehouse tab (new): the Damaged Reactor Housing and future salvaged materials, each with a Salvage action (loot roll, §3).
- Both are the surfaces combat will later feed and the fuller 0.11.2+ salvage economy will extend.

## 5. Fleet Admiral salvage talent

- Add ONE salvage-focused FA talent (or a small cluster) that improves: the equipment recycle YIELD %, and/or the salvaged-material roll ODDS / rarity CEILING.
- Slots into the existing FA talent tree (radial web). First-pass values, tunable.
- OPEN CALL: one combined talent, or split (yield vs odds)? Placement in the tree?

## 6. Save / migration

- `equipmentStorageCap` (or a facility/track rung state) added: additive, backfilled by a numbered migration (default the base cap), SAVE_VERSION bump. Follow the frozen-migration discipline.
- `intactReactorCore` to Damaged Reactor Housing: LABEL + CATEGORY change. The category flip ("raw" to "salvaged material") is a data change, not a save change (the id stays, so existing stacks carry over and simply render under the new tab). Confirm the Warehouse groups by category so the reclassification just works.
- New exclusive-salvage items + the salvaged-material category: additive ITEMS entries, no save shape change.
- Removing dead `components` + merging `refinedMaterial` to `titaniumIngot` (from legibility/naming): recipe repoints + a migration converting any old `refinedMaterial` / `components` inventory stacks (convert `refinedMaterial` to `titaniumIngot` at the ratio, drop `components`). One migration covers all the 0.11.0-completion data changes.

## 7. Testing

- Storage cap: crafting past the cap is blocked with a clear reason; salvage and cap-upgrade both relieve a full store; the "salvage always reachable at cap" softlock guard.
- Equipment recycle: returns materials in the expected band; consumes the system; frees the slot; baselines are not salvageable.
- Salvaged-material roll: weighted tiers behave; progression gates the ceiling; super-rare refined/component odds hold; exclusive items are reserved (no consumer, honest tooltip).
- Migration: an old save with `refinedMaterial` / `components` / `intactReactorCore` stacks lands coherent (converted / dropped / reclassified).
- The rolls are live-only instant actions (Math.random), so NO offline-parity tests are needed, but a test should confirm salvage does NOT run inside `economyTick` / offline `tick()` (it is a discrete action, not a timed process).

## 8. Open calls for user review

1. **Salvaged-material loot ladder:** map salvage tiers to the gear rarity names (standard, augmented, stellar, radiant, + reserved above)? And is progression-gated ceiling + FA-talent-boosted odds the right control model?
2. **Exclusive salvage items reserved this patch** (defined + droppable, but "reserved for future recipe" tooltip since consumers are combat/Material Lines): OK, or do you want at least one exclusive to have a 0.11.0 use?
3. **FA salvage talent:** one combined talent (yield + odds) or split? Any placement preference in the talent web?
4. **Storage cap base value + upgrade curve:** start at 25 with the material-tab-style multiplier rungs, tune at device check?
