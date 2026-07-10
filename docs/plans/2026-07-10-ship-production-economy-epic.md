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

## 2. The vision (captured from the 2026-07-10 brainstorm)

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
  ore ─▶[Refinery]▶ refined mats ─▶[Fabricator]▶ components ─▶ parts (frame, plating, …)
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

---

## 4. Phase breakdown

Each phase is a placeholder for its own future brainstorm. Scope lines below are directional, NOT
final designs.

### Phase 1 — Facility framework + Refinery  ← NEXT TO BRAINSTORM
- The **Homeworld facility unlock/upgrade meta-system**: the reusable bedrock that every later
  facility (Warehouse, Fabricator, Research, Starbase/Shipyard) hangs on — how a facility is
  unlocked (via Homeworld upgrades), how it's upgraded, how upgrade levels are stored/costed.
- The first production node hung on that framework: the **Refinery** — ore → refined materials, with
  refining-slot upgrades. Least greenfield node (refining primitives partially exist), most upstream,
  produces something usable immediately.
- **Why first:** establishes the pattern all other facilities reuse, and stands alone (refined mats
  are useful to surface even before downstream consumers exist).

### Phase 2 — Warehouse / storage
- Storage capacity caps for materials + components.
- **Open:** may fold into Phase 1's framework rather than being its own phase. Decide when Phase 1 is
  designed.

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
