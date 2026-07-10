# Phase 1 — Facility Framework + Refinery (Design)

**Date:** 2026-07-11
**Epic:** [Ship Production Economy](2026-07-10-ship-production-economy-epic.md) — this is **Phase 1**.
**Type:** Feature design doc. Next step after approval: `writing-plans` → implementation plan.
**Status:** Draft for review.

---

## 1. What Phase 1 ships

The reusable **facility framework** (the meta-system every later facility — Warehouse, Fabricator,
Research, Starbase/Shipyard — hangs on) plus its first real node, the **Refinery**. Plus the
foundational **data model** the whole epic depends on (keyed inventory + item registry + discovery),
established now so later phases don't have to re-migrate it.

Definition of "done" for Phase 1:
- A Refinery you unlock (build to level 1) and upgrade, paying materials over a timed build.
- Refine jobs: assign ore → a slot refines it over a fixed time → refined material lands in inventory.
- Multiple facility upgrades and refine jobs run **concurrently**, gated only by materials (and, for
  refine jobs, available slots).
- A keyed inventory + item registry + `discovered` set backing it all.
- Save migration v16 → v17.

---

## 2. Scope boundary (curated — see epic §3 for the ethos)

### In scope (folded in because deferring forces a re-migration/rework later)
1. **Keyed inventory** — replace the fixed-union `homePlanet.storage: Record<HomePlanetMaterialKey, Decimal>`
   with `inventory: Record<string, Decimal>`. Every later phase (18–27+ named items) needs this;
   doing it now avoids migrating a hand-maintained union repeatedly.
2. **Item registry + taxonomy + discovery** — an `ITEMS` table and a `discovered` set. Only raw ore
   tiers + `refinedMaterial`/`components` populate now; the *structure* (category/tier/rarity/flavor/
   equip-stats) exists so Materials/Warehouse/Modules phases add data, not schema.
3. **One shared timed-process engine** — refine-jobs and facility upgrades are the same deterministic
   timed shape; they share one implementation and one offline/live resolver. Atomic deduct-at-start.

### Explicitly deferred (with reason — NOT in Phase 1)
- **Mission-tick unification onto the new engine** — rewriting working code (Anti-Regression 15a);
  needs a device check. Engine is *shaped* to allow it later; missions stay as-is now.
- **Named-materials drops / loot-rarity-range / cargo-as-true-cap** — the delicate co-designed
  mission-loot pass (epic §3.6). Phase 1's Refinery consumes the EXISTING `commonOre`.
- **Full Warehouse inventory-browser UI** — Phase 2, mockup-gated. Phase 1 has only the minimal
  Refinery panel (also mockup-gated).
- **Fabricator / Research / Shipyard / ship modules** — later phases. The `requiresResearch` field
  exists on upgrades but is empty (no research topics exist yet — "no placeholders").
- **Unrelated latent traps** (e.g. the length-derived captain-id scheme, SUGGESTIONS) — untouched.

---

## 3. The shared timed-process engine (architectural core)

Every timed thing in this system is one shape: a deterministic, fixed-duration process that consumed
its inputs at start and applies an effect at completion.

```ts
type TimedProcessKind = "refineJob" | "facilityUpgrade"; // extensible; missions could join later

interface TimedProcess {
  id: string;              // "proc-N", monotonic (mirror nextShipId pattern)
  kind: TimedProcessKind;
  startTick: number;       // the game-tick index the process began
  durationTicks: number;   // FIXED at creation — deterministic, so offline is closed-form
  effect: ProcessEffect;   // what completion does (add item, level up a facility)
}

type ProcessEffect =
  | { type: "addItem"; itemId: string; amount: Decimal }        // refine job output
  | { type: "facilityLevelUp"; facility: FacilityKey };         // upgrade completion
```

**Single source of truth.** One function resolves completions, called by BOTH the offline `tick()`
and `App.svelte`'s live poll loop — so this never becomes a third hand-mirrored copy (the logged
`tick()`-vs-live-loop drift, SUGGESTIONS). It does NOT touch the existing mission code.

```
resolveCompletedProcesses(state, nowTick):
   for each process where nowTick - startTick >= durationTicks:
       apply effect (add item to inventory / bump facility level + mark discovered)
       remove process
   // inputs were ALREADY deducted at start — completion only grants outputs
```

**Why closed-form / offline-safe:** durations are fixed at creation and inputs are gone at start, so
offline catch-up is a pure "which processes' end-tick have passed" check — no tick-by-tick sim,
matching missions' own closed-form guarantee.

---

## 4. Atomic consumption — the double-consume fix (Root Cause)

The concern: with concurrent processes, a naive "check inputs now, consume at completion" lets two
processes both see enough materials and both start, over-drawing inventory.

**Fix: consume inputs atomically at process START.** `startProcess` deducts inputs from `inventory`
in the same state transition that creates the `TimedProcess`. Consequences:
- No "checked-but-not-yet-consumed" window → double-consume is structurally impossible.
- The `[Item]: 5/5 ✅` / `4/5 ❌` readiness readout just reads live `inventory`, which already
  reflects everything running has reserved. No separate reservation ledger, no refresh race.
- Cancelling a process (if we allow it — see §9 open items) refunds its inputs.

```
startProcess(state, kind, inputs, duration, effect):
   for each (itemId, qty) in inputs:
       if inventory[itemId] < qty: return { state, started: false }   // gate
   deduct every input from inventory
   push new TimedProcess(startTick = state.currentTick, duration, effect)
   return { state', started: true }
```

---

## 5. Facility framework

```ts
type FacilityKey = "refinery"; // Phase 1. Warehouse/fabricator/shipyard/... added in their phases.

interface FacilityState { level: number; } // 0 = not built. Unlock = level 0->1.

interface FacilityUpgradeDef {                 // one entry per target level; track is FINITE
  materials: Record<string, Decimal>;
  requiresHomeworldTalents?: HomeworldTalentKey[]; // missing -> shown red "missing"
  requiresResearch?: string[];                     // research topic ids; EMPTY now (none exist)
  requiresFacilityLevels?: Partial<Record<FacilityKey, number>>; // dependency chain
  requiresFleetAdminLevel?: number;                // FA-level gate (user 2026-07-11); missing -> red
  durationTicks: number;
  effect: FacilityUpgradeEffect;                   // e.g. { addRefineSlots: 1 } | { refineSpeedMult: n }
}

interface FacilityDef {
  label: string;
  upgrades: FacilityUpgradeDef[]; // index i = requirements to reach level i+1
}
```

Rules:
- **Unlock = the level 0→1 upgrade** — same mechanic as every later level. No separate unlock system.
- An upgrade is buildable when: all `materials` are in inventory AND all `requiresHomeworldTalents`/
  `requiresResearch`/`requiresFacilityLevels` are satisfied (missing prereqs render red as "missing").
- Starting an upgrade = a `facilityUpgrade` TimedProcess (materials deducted at start, §4).
- **Concurrency:** unlimited concurrent facility upgrades — the only gate is materials (per the user).
  Refine JOBS are separately capped by the facility's **slot count** (that's what slot upgrades buy).
- **Finite tracks, no placeholders:** `upgrades[]` only contains levels whose requirements exist
  today. More appended additively as real content (research topics, higher tiers) lands.

---

## 6. Refinery specifics

- **Refine recipe** = inputs → output + a duration. Phase 1 seeds ONE real recipe from the existing
  data: `commonOre ×10 → refinedMaterial ×1` (today's `RECIPES.refineUnobtainium`), now with a
  `durationTicks`. (The instant `craftRecipe()`/`RECIPES` path is left intact for now; the timed
  refinery is the going-forward mechanic — see §9 for whether/when to retire the instant path.)
- **Slots** = max parallel refine jobs. Refinery level grants slots (`addRefineSlots` upgrade effect).
- **Starting a job** = pick a recipe → if a slot is free and inputs available → a `refineJob`
  TimedProcess (inputs deducted at start). On completion, output added + `itemId` marked discovered.
- v1: **manual start** per job (auto-repeat is a deferred nicety, §9).
- **Refine durations (user, 2026-07-11 — tunable placeholders):** common 10 ticks, uncommon 25,
  rare 60. Component/fabricator durations (Phase 4) start ~60 ticks and climb into hours for
  high-tier/high-rarity items.
- **XP model:** each timed process awards **Fleet Admiral XP = its `durationTicks`** on completion
  (the "1 XP per tick" model — self-budgeting, closed-form). **Sequencing (decided 2026-07-11): the
  Progression Pacing Rework lands BEFORE Phase 1** (see epic §4 PREREQUISITE), so the FA curve is
  already recalibrated — this hook is **ACTIVE in Phase 1 from day one**, awarding FA XP = durationTicks
  against the tuned curve. (FA-level values used by `requiresFleetAdminLevel` upgrade gates also assume
  the recalibrated curve, so those gates get real numbers only after the rework sets the curve.)

---

## 7. Data model — inventory, item registry, discovery

```ts
type ItemCategory =
  | "raw" | "refined" | "minorComponent" | "majorComponent" | "shipModule" | "shipSystem";
type ItemRarity = "common" | "uncommon" | "rare" | "epic" | "legendary"; // forward room; UI colors

interface ItemDef {
  label: string;              // shown as [Bracketed Name] per the UI convention
  category: ItemCategory;
  tier: number;
  rarity: ItemRarity;
  flavor: string;
  equipStats?: Record<string, number>; // only for shipModule/shipSystem (forward; empty in Phase 1)
}

const ITEMS: Record<string, ItemDef> = { /* commonOre, uncommonMaterial, rareMaterial,
                                            refinedMaterial, components — Phase 1 seeds */ };
```

- `GameState.inventory: Record<string, Decimal>` — replaces `homePlanet.storage`. All existing
  storage keys migrate in 1:1 (§8).
- `GameState.discovered: string[]` — itemIds seen at least once (looted/crafted/researched). Drives
  the `❓`→rarity-color reveal. Any code path that adds an item marks it discovered.

---

## 8. Save migration (v16 → v17)

Add `MIGRATIONS[16]` (`type Migration = (state: any) => any`; free to reshape). Bump SAVE_VERSION 17.

- Build `inventory` from the old `homePlanet.storage` (copy each key's Decimal across; drop the old
  `storage` object). Preserve the `Decimal` values exactly.
- Seed `discovered` with every itemId that currently has a non-zero balance (already-owned = already
  discovered — no false `❓` on existing saves).
- Initialise `facilities: { refinery: { level: 0 } }` and `activeProcesses: []`, `nextProcessId: 1`.
- Verify against `save.test.ts` conventions; add a v16→v17 round-trip test.

---

## 9. UI (mockup-gated) + open items for the plan step

**UI is spatial → a mockup is required before building** (epic §3.4). Phase 1 UI = the Refinery panel
(upgrade track with the readiness readouts + the timed job slots + "currently building" progress rows,
mission-pane style). The full Warehouse browser is Phase 2. Reuse the `[Bracketed Item]` + `5/5 ✅` /
`4/5 ❌` conventions from the epic's Warehouse spec.

**Open items to settle during planning (not blocking this design):**
1. Exact Refinery recipe list, `durationTicks`, and per-level slot counts (content/balance —
   placeholder values, tuned later, same as every launch table here).
2. Auto-repeat refine jobs? (recommend: manual v1; auto-repeat deferred.)
3. Cancellable in-progress processes with input refund? (recommend: yes, cheap given §4.)
4. Retire the instant `craftRecipe()`/`RECIPES` path, or leave it beside the timed refinery for now?
   (recommend: leave intact this pass — Anti-Regression; retire when the Fabricator subsumes it.)
5. Tick unit for `durationTicks` — confirm against the current `tickDurationSeconds` model so refinery
   durations read sensibly next to mission durations.

---

## 10. Verification (no Node on this machine)

Manual code tracing + unit tests read by hand (Vitest files authored but not run locally), plus a
Vercel preview branch for device testing — same constraint as every prior feature. Key things to
hand-verify: the migration round-trip, atomic-consume under concurrent starts, and that the live loop
and offline `tick()` both call the ONE process resolver (no second copy).
