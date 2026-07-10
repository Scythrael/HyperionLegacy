# Ship Production Economy — Epic / Decomposition Doc

**Date:** 2026-07-10
**Type:** Epic (umbrella roadmap). NOT a buildable design doc — each phase below gets its OWN
brainstorm → design → plan pass before any code is written.
**Status:** Vision captured + phase ordering agreed. Phase 1 is the next feature to brainstorm.

---

## 1. What this is

A full material → refining → fabrication → ship-construction → equipment economy, unlocked and
grown through Homeworld facility upgrades. This is the "Ship building" roadmap item (#3 in the
2026-07-08 roadmap note in `SUGGESTIONS.md`), now expanded into its real shape. It is deliberately
being built out BEFORE Combat because combat has a hard prerequisite this epic satisfies: **ship
stats must be tangible things a combat system can read.** Building the stat/equipment surface now
fleshes out Prospector AND lays combat's foundation in one pass.

It is an **epic**, not a feature: ~6 interlocking systems. It will be built in dependency order,
one phase at a time, each through the full workflow (brainstorm → design → plan → implement →
2-stage review → holistic review → merge → confirm-then-push).

---

## 1a. Full push — master build order (at a glance)

The complete program as of 2026-07-11, in implementation order. Each item is its own feature
(brainstorm → design → plan → build → review → merge), wired into existing content as it lands.
Details for each live in the sections below and in the linked docs.

0. **Progression Pacing Rework** *(prerequisite — FIRST; §4 PREREQUISITE)* — per-tick XP (captain + FA),
   curve recalibration, captain-slot level walls (layered), "Coming Soon"→"Locked". Also **reserves the
   `lifetimeStats` schema + wires mission-side counters** (first & only necessary touch of the closed-form
   mission code) and **flips lifetime-stat counting ON**. The delicate one.
1. **Phase 1 — Facility Framework + Refinery** *([design doc](2026-07-11-facility-framework-refinery-design.md))* —
   shared timed-process engine, facility framework, Refinery, keyed inventory + item registry + `discovered`,
   batch/continuous orders, refine/craft lifetime counters, migration **v16→v17**.
2. **Materials & mission-loot rework** *(§4 Phase 1b; upstream — exact slot flexible)* — distinct named
   materials × quality, co-designed with loot-rarity-range + cargo-as-true-cap (§3.6).
3. **Phase 2 — Warehouse** *(mockup-gated)* — the inventory browser + storage caps.
4. **Phase 3 — Research + blueprints.**
5. **Phase 4 — Fabricator** — components → ship parts; crafted-lifetime counters populate.
6. **Phase 5 — Starbase → Shipyard** — build whole ships.
7. **Phase 6 — Ship systems/modules** *(mockup-gated)* — full stat vocabulary (Prospector + combat),
   equip UI + ship status page; reconcile the cargo redesign.
- **Consumers (build after, back-compute from lifetime stats):** Completions, Achievements
  (commendations), Relics, 100%-completion tracker.
- **Deferred:** Combat behavior / Battlespace — reads the by-then-tangible ship stats.

---

## 2. The vision (captured from the 2026-07-10 brainstorm)

The raw inputs come from **missions**, which are reworked to drop **distinct named raw materials**
(titanium ore, polysilicate ore, …) rather than generic ore — ~3 distinct materials per mission type,
each with a quality grade — feeding durable frames/plating, ship electronics, and the rest of the chain.

Homeworld upgrades unlock a chain of production facilities, each independently upgradeable:

- **Refinery** — refines raw ores and other materials into refined materials. Upgradeable
  (e.g. more refining slots).
- **Warehouse** — storage capacity for materials and components.
- **Fabricator** — builds raw components from refined materials, then assembles those components
  into ship parts (frame, hull plating, and every sub-part that makes sense for a whole vessel).
- **Research** — unlocks blueprints that the Fabricator needs in order to build components/parts.
- **Starbase → Shipyard** — the Shipyard consumes parts and builds whole ships.

The end product is a crafted vessel you then outfit with:

- **Ship systems** (akin to equipment) and **modules** (akin to RPG accessories). Examples the user
  named: reactor core; hull plating (e.g. +armor / −speed tradeoff); shield emitters; tractor beam
  (a combat item, potentially with on-use status effects); engines (affect transit speed); and so on.

The player equips these on a crafted ship and sees the impact — which means the ship needs a
**status page** (likely living on the captain's stats page, with base stats surfaced on the ship's
tooltip, exact placement TBD and mockup-gated).

### Production DAG

```
Homeworld upgrades ─▶ unlock facilities
  missions ─▶ named raw materials ─▶[Refinery]▶ refined mats ─▶[Fabricator]▶ components ─▶ parts (frame, plating, …)
   (titanium ore, polysilicate ore, …; 3 distinct per mission type × quality roll)
                                        ▲                              │
                                 [Research: blueprints]          [Shipyard]▶ ship
                                                                        │
                                        equip systems / modules ────────▶ tangible stat impact
                                                                        │
                                                                 ship status page
  [Warehouse] = storage cap for materials + components throughout the chain
```

---

## 3. Governing principles (locked this session — do not re-litigate)

1. **Build in dependency order, one phase at a time.** No monster PR. Each phase is its own
   feature with its own design/plan, shippable on its own.

2. **Full stat vocabulary up front; combat *behavior* deferred.** The ship-stat model defines BOTH
   Prospector stats (cargo, transit speed, extraction yield) AND combat stats (armor, shield HP,
   weapon power, etc.) from the start, so a future Combat feature is a *reader* of stats that already
   exist, not a stat-model rewrite.
   - **The line:** ship stats and craftable combat *items* are TANGIBLE now (a shield emitter gives a
     real, visible `shieldHp`; a plating gives real armor). Combat **resolution / active effects**
     (how shield HP absorbs damage, tractor-beam on-use status effects, weapon firing) are **inert
     until Battlespace exists.** We model the numbers; combat later decides what they mean. We do NOT
     invent combat's rules in this epic — that would lock in semantics a future combat brainstorm
     wants different, in the wrong phase.
   - This is the same forward-compat pattern the Ships: Stats Foundation feature already used
     (`moduleSlots`/`equipmentSlots`/reactor carried forward inert). See
     `docs/plans/2026-07-09-ships-stats-foundation-design.md`.

3. **Closed-form mission math stays intact.** Every stat that touches mission duration/yield must
   preserve `tickCaptainMission`'s closed-form (no tick-by-tick simulation) guarantee, exactly as the
   ships-foundation and cargo notes require. See `tick.ts`'s own "MUST be closed-form" comment.

4. **Spatial UI is mockup-gated.** The ship status/equip UI (Phase 6) hard-stops for a user sketch
   before it's built. (Established preference — text-only spatial designs have missed intent before.)

5. **Reuse existing primitives, don't reinvent.** `refinedMaterial`, `components`, `RECIPES`, and
   `craftRecipe` already exist in the model from Phase 4. The Refinery/Fabricator build ON these, not
   beside them. (Note: there's a logged gap that `refinedMaterial`/`components` don't display in the
   UI yet — `SUGGESTIONS.md` — which Phase 1/2 will naturally address.)

6. **Mission loot & materials are ONE co-designed pass — do not patch the closed-form extraction three
   times.** Three separate reworks now target the delicate closed-form `tickCaptainMission` extraction
   logic: (a) **distinct named raw-material drops** (this epic — missions drop titanium/polysilicate/etc.
   instead of generic ore), (b) the logged **loot-rarity-range rework** (`SUGGESTIONS.md` — roll a
   min/max quantity within a tier instead of dumping a full tick's units), and (c) the logged
   **cargo-as-true-cap redesign** (`SUGGESTIONS.md`). Three independent edits to the same fragile
   function is the exact drift-trap that already produced the live-loop-vs-`tick()` regressions. Per
   Root Cause: design them together as one "mission loot & materials" pass. And every change here must
   ALSO be mirrored into `App.svelte`'s live poll loop (the hand-maintained copy of `tick()`), or land
   the tick-path unification refactor (`SUGGESTIONS.md`) first.

7. **Named materials require a keyed inventory, not more hardcoded fields.** 3 materials/mission ×
   quality grades → ~18 distinct (material, quality) stacks (≈27 with a 3rd mission). This must be a
   keyed item inventory (`itemId → qty`), not additional flat `GameState` resource fields. Ties into
   the logged Inventory-tab idea and the `refinedMaterial`/`components` display gap.

---

## 4. Phase breakdown

Each phase is a placeholder for its own future brainstorm. Scope lines below are directional, NOT
final designs.

**⚠️ PREREQUISITE (decided 2026-07-11) — a Progression Pacing Rework lands BEFORE Phase 1.** Its own
feature (own brainstorm/design/plan), NOT part of this epic, but sequenced first because it defines the
Fleet Admiral XP curve that Phase 1's facility processes award into. Scope:
- **Per-tick XP:** all timed actions (missions today; refine/upgrade processes in Phase 1) award 1 XP
  per tick — a process's tick-duration IS its XP reward. Applies to BOTH captain and Fleet Admiral XP.
- **Curve recalibration:** raise XP to account for the per-tick model so **captain leveling FEELS the
  same** as today; Fleet Admiral ramps **faster early, then slower over time** (FA power is high → its
  levels should come in more slowly later). Values tunable ("hard to tell what's too fast/slow").
- **Captain slots become level walls (LAYERED, not a reversal):** the shipped Fleet Logistics
  `unlockCaptainSlot` talents gain an ADDITIONAL Fleet-Admiral-level requirement on top of their
  existing adminPoint cost — you need the level AND the talent. Ladder (×5, tunable): slot 2 → L1,
  3 → L5, 4 → L25, 5 → L125, grow for 6+. Rationale: **captains are "wall breakers"** — deliberate
  progression walls that unlocking a new captain helps break through.
- **"Coming Soon" → "Locked" relabel:** content that EXISTS but isn't yet unlocked (e.g. unlockable
  captain slots) shows "Locked" (with its requirement), not "Coming Soon" (reserved for content that
  doesn't exist yet). Small cross-cutting UI change; may ride with this rework.
- **Also folds in the mission-side Lifetime Stats counters** (missions completed, materials gathered,
  credits/XP earned) — because this rework is the FIRST touch of the mission tick, add the stat
  increments here alongside per-tick XP (one careful pass through the dual-path code, not two). The
  `lifetimeStats` schema itself is reserved in the migration; see Phase 1 design §8 + the
  Completions/Achievements SUGGESTIONS entry for WHY these must start counting now (lifetime totals are
  unrecoverable — can't be back-derived from spent/consumed inventory).
- ⚠️ **Edits WORKING, closed-form mission XP code** → Anti-Regression + closed-form care, its own
  device check. The delicate one — trickier than Phase 1's greenfield facility work.

### Phase 1 — Facility framework + Refinery  ← NEXT TO BRAINSTORM
- The **Homeworld facility unlock/upgrade meta-system**: the reusable bedrock that every later
  facility (Warehouse, Fabricator, Research, Starbase/Shipyard) hangs on — how a facility is
  unlocked (via Homeworld upgrades), how it's upgraded, how upgrade levels are stored/costed.
- The first production node hung on that framework: the **Refinery** — ore → refined materials, with
  refining-slot upgrades. Least greenfield node (refining primitives partially exist), most upstream,
  produces something usable immediately.
- **PRODUCTION MODEL (LOCKED, Phase-1 brainstorm): timed jobs + slots.** A refining job occupies a
  slot and takes a FIXED number of ticks (deterministic → offline catch-up stays closed-form:
  `floor(elapsed / duration)` per slot). Upgrades add slots (parallel jobs) and/or cut duration. This
  is a NEW subsystem — today's `craftRecipe()` is instant/click-driven with no time or slots; the
  timed-slot model does NOT reuse it directly (though `RECIPES`' input→output shape is a useful start).
  Must be mirrored into `App.svelte`'s live loop as well as `tick()` (the two-tick-path trap).
- **Why first:** establishes the pattern all other facilities reuse, and stands alone (refined mats
  are useful to surface even before downstream consumers exist).
- **Dependency:** the Refinery needs real distinct inputs to be meaningful — see the Materials phase
  directly below, which is upstream of it. Ordering of these two is an open question (§6).

### Phase 1b (ordering TBD) — Materials & mission-loot sourcing  ← UPSTREAM BEDROCK
- Rework mission drops from generic ore into **distinct named raw materials** (titanium ore,
  polysilicate ore, …). ~3 distinct materials per mission type (3 short + 3 long = 6; possibly a 3rd
  mission for more), each drop also rolling a **quality grade**.
- **Loot shape (settled 2026-07-10):** 3 materials per mission × a quality roll per drop.
- **T1 prospecting mission rework (user vision, 2026-07-11):** rework the existing T1 missions'
  titles / flavor text / drop rates / XP-per-run. The **Long Run** is re-themed/re-tuned to yield the
  SECOND material set (longer transit distance, same ~50 cargo requirement). Possibly a 3rd mission
  for more materials. Note: mission cargo *requirements* don't exist yet — the "50 cargo req" rides
  with the cargo-as-true-cap redesign (§3.6). This rework is part of the one co-designed loot pass.
- **Quality axis (recommended, NOT yet locked):** reuse the EXISTING common/uncommon/rare rarity roll
  as the quality grade — the current single-roll extraction *becomes* the quality roll, applied to
  named materials. Closed-form-safe. Alternative (a second orthogonal grade on top of rarity) is
  harder and must be deliberately designed — confirm before building.
- **This is the biggest of the three closed-form reworks — see principle §3.6 (co-design as one pass)
  and §3.7 (keyed inventory).**
- Feeds the Refinery (Phase 1) and is stored by the Warehouse (Phase 2). Its exact slot in the build
  order is an open question (§6) — it's upstream of Refinery, so it may need to lead or land together
  with it.

### Phase 2 — Warehouse / storage  (working name — user wants a better one)
- Storage capacity caps for materials + components.
- **Open:** may fold into Phase 1's framework rather than being its own phase. Decide when Phase 1 is
  designed.
- **UI SPEC (user vision, 2026-07-11 — MOCKUP-GATED before build, §3.4):** a left-side tab under
  Homeworld (captain-list-style left nav). Top sub-tabs within it: **Overview, Upgrades, Raw Materials,
  Refined Materials, Minor Components** (ship modules for now; later also ground-troop equipment),
  **Major Components** (ship materials — frame, hull plating, etc.), **Ship Modules, Ship Systems.**
  - Each item shows as a box/icon with the **current total** in it (1, 2, 103k, 1.3m).
  - **Undiscovered items show a `❓` placeholder** with a clue to how to get it ("hasn't been crafted
    yet", "needs to be researched first").
  - On FIRST discovery (looted / crafted / researched), the box takes the item's **rarity color**
    (white common, green uncommon, blue rare, …).
  - **Tooltip:** item name, flavor text, classification (tier, etc.), and equip stats if it's a module
    or ship system.
- **Data-model implications this UI forces (define forward-compat now):**
  1. **Keyed item inventory** (`itemId → qty`), not hardcoded fields (already principle §3.7).
  2. A persistent **`discovered` set** (itemIds seen at least once) driving the `❓`→reveal behavior —
     a new save field + migration.
  3. An **item taxonomy**: every item carries `category` (raw / refined / minorComponent /
     majorComponent / shipModule / shipSystem), `tier`, `rarity`, plus flavor + (for modules/systems)
     equip stats. This taxonomy is the inventory backbone — populate raw/refined early, the rest as
     their phases ship.

### Phase 3 — Research + blueprints
- The unlock engine: Research unlocks blueprints that gate what the Fabricator may build.
- **Open sequencing:** Research (3) vs Fabricator (4) ordering is soft. A minimal Fabricator could
  ship first with a fixed starter recipe set, then Research layers gating on top; or Research lands
  first as the spine. Decide when brainstorming these two.
- **History note:** this Research is NOT a revert of the Phase-4-cut generator-stack Research (that
  was a placeholder on the removed generator stack). This is the ship-upgrade unlock engine — a
  different role. See `docs/plans/2026-07-09-ships-stats-foundation-design.md`'s "History note".

### Phase 4 — Fabricator
- Refined materials → raw components → ship parts (frame, hull plating, and the rest of a vessel's
  sub-parts). Consumes Phase 3 blueprints.

### Phase 5 — Starbase → Shipyard
- Unlock the Starbase, then the Shipyard. Shipyard consumes parts and builds whole ships — a
  resource-cost build action layered onto today's credits-buy acquisition (`buyShip`).
- Relates to deferred ideas: ship salvage/sell, ship-storage-capacity growth (`SUGGESTIONS.md`).

### Phase 6 — Ship systems / modules (full stat vocabulary)
- Make the ship equipment/module layer functional: reactor core (reactorTier ≤ ship tier; gates
  equipment/module tiers), engines (→ transit speed), hull plating (→ armor / speed tradeoff), cargo
  modules, shield emitters, weapons, tractor beam, etc.
- Defines the **full stat vocabulary** (Prospector + combat) per principle §3.2. Passive stats are
  tangible and visible immediately; combat resolution/actives stay inert until Battlespace.
- Includes the **equip UI + ship status page** (mockup-gated, §3.4).
- **Collision to resolve first:** the pending **Cargo & progression redesign** brainstorm
  (`SUGGESTIONS.md`) — cargo-affecting modules interact directly with cargo-as-true-cap. That
  redesign likely needs to land (or be co-designed) before cargo modules.

### Deferred (not part of this epic) — Combat behavior
- Battlespace/combat itself: how armor/shields/weapons/tractor-beam actives actually resolve. Depends
  on this epic completing (tangible ship stats) plus its own full combat design. The combat *items*
  and *stats* are built here; the *fight* is a later feature.

---

## 5. Ties into existing / logged work

- **Ships: Stats Foundation** (`2026-07-09`, shipped) — this epic makes its inert forward-compat
  buckets (`moduleSlots`, `equipmentSlots`, reactor, tiers) real.
- **Cargo & progression redesign** (`SUGGESTIONS.md`) — must be reconciled before Phase 6 cargo
  modules; possibly earlier.
- **`refinedMaterial`/`components` UI display gap** (`SUGGESTIONS.md`) — addressed as Refinery/
  Fabricator surface these.
- **Crew leveling / augmentation / cybernetics** (`SUGGESTIONS.md`) — augments are a crafted item
  class unlocked via Research; a natural extension of Phase 3–4 once the Crew system exists.
- **Homeworld Market / broader credits economy** (`SUGGESTIONS.md`) — interacts with material/credit
  sinks this economy creates.

---

## 6. Open questions carried into the per-phase brainstorms

1. Warehouse: its own phase, or part of the Phase 1 facility framework?
2. Research vs Fabricator ordering (Phase 3 ↔ 4): gating-spine-first vs minimal-Fabricator-first?
3. Full ship-stat vocabulary: exact stat fields (which combat stats to model now, at what
   granularity) — decided in Phase 6's design, guided by §3.2's stats-vs-behavior line.
4. Where the ship status page lives (captain stats page vs dedicated) — mockup-gated, Phase 6.
5. How facility upgrade levels are modeled/persisted (save-migration shape) — Phase 1.
6. Quality axis for named materials: reuse the existing common/uncommon/rare rarity roll
   (recommended, closed-form-safe) vs. a new orthogonal grade on top? — Materials phase.
7. Materials-phase ordering: lead phase, or bundled with the Refinery? And the combined design with
   the loot-rarity-range + cargo-as-true-cap reworks (§3.6) — one "mission loot & materials" pass.
8. Recipe sufficiency: are 6 named materials (× quality) actually enough to compose the first few
   system tiers, or is a 3rd mission / more materials needed? — decided against the Fabricator recipe
   graph (Phase 4), but the material COUNT is set earlier (Materials phase), so keep headroom.
