# Ships — Stats Foundation — Design

**Date:** 2026-07-09
**Roadmap position:** Feature #2 in the user's stated sequence (1 Talent-tree foundations → **2 Ships**
→ 3 Ship building → 4 Combat). The Talent-tree foundations closed out with the Radial Skill Web
(`docs/plans/2026-07-08-radial-skill-web-design.md`), so Ships is next.

This is the **foundational** ship pass: it turns the ship from a field fused onto the captain
(`CaptainState.shipType`, only ever `"resourcer"`) into a **real, separate, stat-bearing entity** that
intertwines with missions — and it is deliberately built so that ship-building (#3), combat (#4), and
the **Research** system all bolt on later without a data-model rewrite.

---

## Motivation & the hook

The player-facing hook (chosen explicitly during brainstorming) is **"meaningful ship stats"**: which
hull a captain flies should visibly change how a mission performs, and choosing/working-toward a hull
should be a real decision. Everything below serves that hook while laying groundwork for the larger
ship systems the user has planned.

---

## Scope decision (settled during brainstorming)

Ships is a large, multi-layer vision (a ship pool, a Sector Space parking construct, exclusive
assignment, ship equipment/modules/reactor, a Research unlock tree, a Shipyard). Building all of that
at once — with **no local test/renderer on this machine** (Node/npm confirmed absent again this
session) — would be a huge blind branch. So the scope is drawn tightly:

| **In this pass (delivers the hook)** | **Deferred — documented, not built** |
|---|---|
| Ship as a real stat-bearing entity, separate from the captain | Ship **modules / equipment / reactor core** (buckets baked into the data model; inert) |
| A player-owned **pool** of ships with a **storage-capacity cap** | **Research** system (the unlock engine for better ships/modules/tiers) — its own next feature |
| **Exclusive captain→ship assignment** (a captain always has exactly one) | **Minimal build action** (resource-cost ship construction) — the *going-forward* acquisition method |
| **3 mission-affecting stats:** cargo capacity, transit speed, extraction yield | **Combat / other-mode** intertwining |
| **4 real ship types:** General Freighter + 3 Prospector hulls | The **6** Tactician/Explorer hulls (documented buckets) |
| **Sector Space tab opened minimally** — only the ship construct | **Shipyard** (build/repair); the full Sector Space buildout |
| Buy-with-**credits** acquisition | **Salvage** (~60% materials back) / **sell for credits** |
| Save migration **v15 → v16** | Capacity **growth** via Sector Space upgrades (forward target ~50–100) |

**Why skeleton + the 3 Prospector ships (not skeleton-only):** if the Freighter were the *only* real
hull this pass, every captain would fly an identical ship and there would be nothing meaningful to
swap between — the hook would not actually land, and we'd ship an elaborate management UI with zero
gameplay decision (a "silent feature"). The 3 Prospector hulls make the hook real *now*, and since
buy-with-credits is already in scope, they are marginal extra work. Resourcefulness (Prospector) is
the one fully-real captain spec today, which is why the first spec ships align to it.

---

## History note — this Research is NOT a revert

The repo previously had a "Research" system that was **torn out in Phase 4** (the Navigation
Restructuring & Progression Overhaul), and `CUT_FOR_SCOPE.md` still lists "Research / material
discovery" as cut. Per the user (2026-07-09): that removed Research was a **placeholder riding on the
generator stack**, and the generator stack was the thing cut on purpose. The Research referenced here
is the **intended, ultimate form** — a Homeworld-facility tech-tree that unlocks new ship types,
modules, ship equipment, ship passive upgrades, and higher ship tiers. It is a *different role* from
the removed generator-stack Research. **Do not read this as reverting a deliberately-removed system.**
Research is **not** built in this pass; it is the natural next feature after Ships.

---

## Core design decisions (settled Q&A)

1. **Captain and ship are fully separate entities.** The player owns a pool of ships; a captain
   *claims* a ship and flies it exclusively. (Today they are fused: `CaptainState.shipType`.)
2. **Captains always have exactly one ship** — there is **no shipless state**. Changing a captain's
   ship is an atomic *replace*: the new hull is assigned and the old hull auto-parks. This removes a
   whole branch of "shipless captain can't be dispatched" edge cases. (Chosen over the alternative of
   allowing a captain to be shipless.)
3. **Unused/backup ships are parked** in a **Sector Space construct** that grants ship-storage
   capacity. This pass opens the Sector Space tab **minimally** — only this construct; the rest of
   Sector Space stays a locked placeholder.
4. **Three mission-affecting stats:** cargo capacity, transit speed (Vector-Fall Engine lore),
   extraction yield. Combat stats (hull/shields/weapons) are deferred until Battlespace.
5. **Ships differ by functional type (tradeoffs), not a rarity ladder** — no hull is strictly best.
   Ships also carry a `tier` field (all real ships are tier 1 this pass; higher tiers arrive via
   Research).
6. **Acquisition this pass = buy with credits.** Going forward, the *minimal build action* (resource
   cost) becomes the way; that is deferred. The General Freighter is a cheap starter/emergency
   fallback and is not expected to be a common purchase.
7. **Forward-compat is mandatory:** the ship data model must leave clean room for modules, equipment,
   reactor core, and tiers. Reactor-core tier ≤ ship tier; equipment/module tiers gate on reactor
   power ("no power → can't run the device"). Higher ship tiers → more module slots + stat modifiers.

---

## Data model

New static type table (mirrors the `MISSIONS` / `RECIPES` convention in `model.ts`):

```ts
export type ShipSpec = "general" | "prospector" | "tactician" | "explorer";

export type ShipTypeKey =
  | "generalFreighter"
  | "prospectorHauler"
  | "prospectorRunner"
  | "prospectorMiner";
// 6 more keys (destroyer/battleship/carrier, cruiser/surveyor/medical) are documented as
// forward buckets below and are NOT added to this union until they are actually built.

export interface ShipTypeDef {
  label: string;
  spec: ShipSpec;
  tier: number;                      // all real ships = 1 this pass; Research raises this later
  cargoCapacity: number;             // DRIVES the extraction-phase length (see Mission math)
  transitSpeedMult: number;          // divides transit ticks; >1 faster, <1 slower
  extractionYieldMult: number;       // scales per-extraction-tick loot (folds into existing bonus seam)
  moduleSlots: number;               // POPULATED this pass, but INERT (no module system yet)
  equipmentSlots: number;            // forward bucket — counts finalized with the equipment/reactor design
  cost: { credits: number } | null;  // null = not purchasable (future hulls gate on Research/build)
  description: string;
  // --- forward-compat, NOT populated this pass ---
  // reactorTier?: number;  // a ship carries one reactor-core slot; reactorTier ≤ tier; gates equip/module tiers
}
```

Lightweight per-ship instance (only mutable per-ship state; everything else derives from the table):

```ts
export interface ShipInstance {
  id: string;                        // stable unique id (allocated from a GameState counter)
  typeKey: ShipTypeKey;
  assignedCaptainId: number | null;  // SINGLE SOURCE OF TRUTH for assignment; null = parked/available
  name?: string;                     // player naming deferred (same as captain naming, model.ts:148)
  // --- forward-compat, NOT this pass ---
  // modules?: […]; equipment?: […]; reactorCore?: …; tierOverride?: number;
}
```

`GameState` (`model.ts:158`) gains:

```ts
  ships: ShipInstance[];
  shipStorageCapacity: number;       // total owned ships cap (assigned + parked); starts 8
  // + a ship-id counter (e.g. nextShipId) for stable unique allocation, analogous to captain nextId
```

`GameState` **removes nothing structurally except** `CaptainState.shipType` (`model.ts:149`) — the
captain no longer owns a ship; the ship knows its captain.

**Assignment authority = `ship.assignedCaptainId`.** This is the single source of truth, chosen so a
ship can never be flown by two captains (a structural guarantee, not a runtime check). Derived queries
(fleet ≤10, so trivially cheap):

- Available ships: `ships.filter(s => s.assignedCaptainId === null)`
- A captain's ship: `ships.find(s => s.assignedCaptainId === cap.id)`

**Invariant (enforced, see Migration):** every captain id appears as exactly one ship's
`assignedCaptainId`. Parked ships carry `null`.

---

## The 4 real ship types (tier 1)

A genuine tradeoff triangle over the three stats, relative to today's mission baselines (transit
25/70, extraction 90, rate 1). **All numbers are first-pass `TUNABLE`** — real balance is a
device-check/tuning concern, since there is no local simulation on this machine.

| Ship (placeholder name) | Spec | Cargo | Transit speed | Extraction yield | Module slots | Buy cost | Feel |
|---|---|---|---|---|---|---|---|
| **General Freighter** | general | 90 (baseline) | 1.0× | 1.0× | 1 | ~25 cr | Neutral starter/emergency; every captain seeded one |
| **Hauler** | prospector | 180 (2×) | 0.8× (slower) | 1.0× | 2 | ~150 cr | Big hauls per run, slower cycles |
| **Runner** | prospector | 60 | 1.5× (faster) | 1.0× | 2 | ~150 cr | Rapid short cycles, small holds |
| **Prospector** | prospector | 90 | 1.0× | 1.35× | 2 | ~150 cr | More materials per extraction tick |

- **Names are placeholders** — the user owns final naming/lore (they enjoy this; cf. "Vector-Fall
  Engine"). Keys above (`prospectorMiner` etc.) are provisional too.
- **Module slots:** Freighter 1, all three Prospector hulls 2. *Explorer/science hulls will get more
  module slots than their peers — that is the Explorer identity* (documented forward, see below). No
  Prospector hull hoards a 3rd slot.
- The **General Freighter is exactly today's implicit ship** (cargo 90 / 1.0× / 1.0×) — this is what
  makes the migration seamless (see below).

---

## Mission math (the closed-form-sensitive part)

`tickCaptainMission` (`tick.ts:403`) **MUST remain closed-form**: one call with a large `ticksElapsed`
must resolve identically to many small calls summing to the same total. The key insight: **all three
ship stats are applied by modifying the *inputs* to the existing closed-form machinery — none require
changing the `while`-loop structure.**

**1. Transit speed → a derived "effective mission."** One pure helper:

```ts
effectiveMissionDef(base: MissionDef, ship): MissionDef  // returns a modified copy
  transitOutTicks  = ceil(base.transitOutTicks  / ship.transitSpeedMult)
  transitBackTicks = ceil(base.transitBackTicks / ship.transitSpeedMult)
  cargoCapacity    = ship.cargoCapacity     // ← cargo drives the haul; see below
  // extractionRatePerTick, uncommonChance, rareChance, tier, xp/credits: unchanged
```

Transit phases are pure tick-counters (no rolls), so rescaling their length is trivially closed-form;
`ceil` keeps them integer.

**2. Extraction yield → folds into the existing bonus seam.** `rollExtractionTick` (`tick.ts:320`)
already scales each tier by `(1 + yieldMult)` (`tick.ts:336–341`), and the caller `tick()` already
*sums* per-captain talent bonuses into that `bonuses` object. The ship's `extractionYieldMult` becomes
**one more summand** the caller adds — the same seam Lucky Strike / talents use, no new mechanism. It
applies to all three tiers' yield mults (common/uncommon/rare), so "yield" = total materials extracted
regardless of which tier wins the tick.

**3. Cargo → drives the extraction-phase length.** `requiredTicksForPhase("extracting", …)` is
`ceil(cargoCapacity / extractionRatePerTick)` (`model.ts:138`). By feeding it the *ship's* cargo via
`effectiveMissionDef`, a Hauler (180) runs a longer extraction phase (~2× materials **and** ~2×
rare-roll density per run), a Runner (60) a shorter one. Because `extractionRatePerTick = 1`, any
integer ship cargo still divides evenly — no partial-final-tick path is introduced this pass.

> **Honest balance caveat (do not oversell cargo):** because extraction is per-tick, cargo is
> *roughly throughput-neutral* — a bigger hold yields more per run but the run takes proportionally
> longer. Its real value is bigger per-run numbers, more rare-roll density, and being the foundation
> for future cargo-*gated* missions. The genuine throughput levers this pass are **transit** (Runner =
> faster cycles) and **yield** (Prospector = more per tick).

### Why this stays closed-form AND migration-safe

- A captain **cannot swap ships mid-mission** (assignment rule below), so `effectiveMissionDef` is
  **stable for an entire cycle** — the one-big-call ≡ many-small-calls guarantee holds. The existing
  closed-form tests are **extended** to cover ship-modified missions (Hauler 180 / Runner 60 /
  faster+slower transit).
- The seeded Freighter equals today's implicit ship, so **every in-flight mission behaves identically
  after migration** — no discontinuity by construction.

### How `tickCaptainMission` gets the ship

`tickCaptainMission` no longer reads `captain.shipType` (removed). The caller (`tick()`) resolves the
captain's assigned ship and passes its derived stats (or the `effectiveMissionDef`) in, keeping the
function pure/testable. Exact parameter wiring is a plan concern; the function must stay closed-form
and its 4th `bonuses` arg keeps defaulting to no-bonus so existing tests/call sites are unaffected.

---

## Assignment rules

- **Claim:** assign an available ship (`assignedCaptainId === null`) to a captain → exclusive.
- **Swap (atomic replace):** assigning a new ship to a captain auto-parks their old ship (old →
  `null`, new → captain). There is no unassign-to-nothing (captains always have a ship).
- 🔒 **Cannot change a captain's ship while they are on an active mission** (`captain.mission !== null`)
  — this is what guarantees `effectiveMissionDef` is stable per cycle (the closed-form promise). The
  UI disables the swap for on-mission captains; the player recalls first.
- **Dispatch is never gated on ship existence** — every captain always has one.

---

## Storage capacity & acquisition

- `GameState.shipStorageCapacity` = **total owned ships cap** (assigned + parked) — the Sector Space
  dock's size. Acquiring is blocked at the cap. "Parking" is just where unassigned hulls sit within it.
- **Starting value: 8** (`TUNABLE`) — room for up to 4 captains' hulls + ~4 backups/purchases.
  **Growth is deferred** — a future Sector Space/Starbase upgrade raises it (forward target ~50–100);
  logged, not built.
- **Pricing** (all `TUNABLE`): Freighter ≈ 25 cr (cheap emergency fallback, ≈1–2 Long Ore Runs at 20
  cr/cycle); each Prospector hull ≈ 150 cr (a real first goal, ≈7–15 cycles of saving). Credits are
  the currency introduced by the Talent Tree Visual Redesign and given a header display by the
  currency-indicator work (`main` @ `38da5ee`); ship purchases are a real credit sink.

---

## Sector Space (minimal UI)

Light up the **Sector Space** tab for real, but only with the ship-parking/management construct:

- A **ship list** showing each owned ship, its type, its stats (cargo / transit / yield), its
  (inert, empty) module slots, and its assignment (which captain, or "parked").
- **Assign / swap** controls (respecting the on-mission lock).
- A **capacity readout** (owned / `shipStorageCapacity`).
- A **buy panel** to purchase the Freighter and the 3 Prospector hulls with credits (blocked at cap).
- Everything else in Sector Space stays locked ("Coming Soon").

> 🎨 **Build-time gate:** the ship-management UI is spatial/layout-heavy. Per the talent-tree lesson
> (a text-only brainstorm missed the intended layout), **obtain a rough mockup from the user before
> building the Sector Space UI.** Design-doc/plan work can proceed without it; UI construction cannot.

---

## Save migration (v15 → v16)

`SAVE_VERSION` is currently **15** (`save.ts:9`) → bump to **16**, add `MIGRATIONS[15]` (v15→v16). Per
the repo's frozen-migration discipline, prior migration bodies are **never edited**; only a new
numbered entry is added (`save.ts:255`, run by the `while (MIGRATIONS[version])` loop at `save.ts:450`).

`MIGRATIONS[15]` does:

1. For each existing captain: create a **General Freighter** `ShipInstance` (`assignedCaptainId =
   captain.id`), push to a new `ships[]`. (Freighter = today's implicit ship → in-flight missions
   unaffected.)
2. Consume + drop `captain.shipType` (all `"resourcer"` today → Freighter).
3. Add `GameState.ships`, `shipStorageCapacity = 8`, and the ship-id counter.

**The always-has-a-ship invariant is enforced in three places** — all must agree on shape:

1. **Migration** (above) — one Freighter per existing captain.
2. **New game** initial state — seed each starting captain a Freighter + `ships[]` + capacity 8
   (must converge with a migrated save's shape).
3. **New-captain unlock** (`unlockCaptainSlot` path in `tick.ts`; note the inline captain literals at
   `model.ts:821` and `model.ts:910`) — create + assign a Freighter to the new captain. Granted
   regardless of cap (a captain must have a hull; cap 8 > 4 captains, so no conflict today).

> ⚠️ **Minefield (design-first flag) — RESOLVED, premise corrected during the Task-3 review:**
> `MIGRATIONS[4]` contains an inline `const captainOne: CaptainState = { … shipType: "resourcer", … }`
> (`save.ts:285-302`). The original worry was that removing `shipType` from `CaptainState` would break
> this historical migration. Reality: (1) that literal is `: CaptainState`-annotated (NOT `any` — only
> the outer `type Migration = (state:any)=>any` is), but it has ALREADY diverged from `CaptainState`
> (it carries pre-Phase-4 `resources`/`modules`/`research`/`specialization`/… and omits current
> required fields), so it does not type-check against `CaptainState` today regardless of this feature;
> (2) the production build is `vite build` (esbuild, no type-check) with no `vercel.json`/CI, so runtime
> and deploy are unaffected — the `check` script (`svelte-check && tsc`) is separate and not in the
> build path. So removal is deploy-safe. v15→v16 (`MIGRATIONS[15]`) is the single place `shipType` is
> mapped→Freighter and dropped. To clear the type-check-only diagnostic, Task 4 relaxes `captainOne`'s
> annotation to `any` (type-only, migration body unchanged — the frozen-migration rule protects
> behavior, not annotations).

---

## Forward-compat & deferred (documented, not built)

- **10-ship roster** (organized by captain spec — this is why `ShipTypeDef` has a `spec` field now):
  - *General:* **Freighter** — basic, spec-less, starter/emergency.
  - *Prospector (resourcefulness):* Hauler · Runner · Prospector (the 3 built this pass).
  - *Tactician (tactical/combat):* **Destroyer** (glass cannon) · **Battleship** (tank) · **Carrier**
    (drones/pets). Bonuses need combat/Battlespace.
  - *Explorer (science):* **Cruiser** (long-haul exploration + diplomacy — Enterprise-D/E) · **Survey
    vessel** (Nebula/Nova-class science) · **Medical transport** (crew-landing, useful in Battlespace
    modes). Bonuses need a redefined science mechanic. **Explorer hulls get more module slots** than
    their peers.
- `ShipTypeDef` forward fields: `equipmentSlots` (counts finalized with the equipment/reactor design),
  **reactor core** (`reactorTier ≤ tier`; gates equipment/module tiers), tier scaling (higher tier →
  more module slots + stat modifiers).
- **Modules / equipment / reactor are inert this pass** — displayed (empty slots) but non-functional.
  Log to `KNOWN_ISSUES.md`, same convention as other known-inert systems.
- **Research** (the unlock engine for better ships/modules/tiers) — the next feature.
- **Minimal build action** (resource-cost ship construction) — the going-forward acquisition method;
  this pass uses buy-with-credits.
- **Salvage** (recover ~60% of a ship's crafting materials — not 100%) / **sell for credits** — log to
  `SUGGESTIONS.md`.
- **Capacity growth** via Sector Space upgrades (forward target ~50–100).
- **`minCargoRequired?`** field on `MissionDef` — the eventual cargo *gate* (a mission requiring a
  minimum hold). Cheap forward field, unused until a mission sets it.
- **Ship naming** — deferred, same as captain naming.

---

## Testing / verification plan

No local Node/npm/renderer on this machine, so "testing" is authored unit tests (for the TDD plan and
future CI — not runnable here), hand-tracing, and the user's live device checks (per the Radial Skill
Web precedent, which caught real mobile-only bugs static review could not).

**Unit tests (authored):**
- `effectiveMissionDef` — transit `ceil` correctness, cargo passthrough, and the yield summand feeding
  `rollExtractionTick`.
- **Closed-form invariance, EXTENDED** — one-big-call ≡ many-small-calls with ship-modified missions:
  Hauler (180), Runner (60), and faster/slower transit. This is the highest-risk area; the existing
  closed-form test in `tick.test.ts` is the template.
- **Migration v15→v16** — a v15 save → each captain has exactly one assigned Freighter;
  `ships.length === captains.length`; `shipStorageCapacity === 8`; `shipType` gone; an in-flight
  mission resolves identically pre/post migration.
- **Assignment** — swap parks old + assigns new; on-mission swap blocked; capacity cap blocks buy; a
  newly-unlocked captain is granted + assigned a Freighter.

**Device checkpoints (user's Android + desktop):**
- **A** — Sector Space renders; ship list + stats display; assign/swap works; dispatch uses the
  assigned ship.
- **B** — buy a Prospector hull with credits → assign → run a mission → *see* the stat effect (faster
  cycle / bigger haul / more yield); a real pre-existing save migrates cleanly on the live device.

**Claude hand-trace:** the migration and one full mission cycle with a modified ship (since no runner
exists here).

---

## Open items for the writing-plans step

- Exact `tickCaptainMission` parameter wiring for passing ship stats / `effectiveMissionDef`.
- Ship-id allocation scheme (counter on `GameState` vs. derived string ids).
- Confirming the migration-typing minefield above compiles.
- Final `TUNABLE` numbers are placeholders throughout; balance happens at the device-check stage.
- Mockup request for the Sector Space UI before the UI tasks.
