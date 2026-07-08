# Loot Tier Rework, Talent Split, Import Save Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the mutually-exclusive weighted loot roll with independent per-tier
occurrence/amount rolls, split the 2 existing talent bonus effect types into 5 tier-specific ones
(re-targeting 5 already-shipped talent nodes, no new nodes), add an Import Save feature, and reset
the app's version numbering scheme.

**Architecture:** `MissionDef.lootTable` (a `LootTableEntry[]` weighted-pick table) is replaced by
two chance fields (`uncommonChance`, `rareChance`). `tickCaptainMission`'s single `rollLootTable`
call per tick becomes up to 3 independent `rng()` calls per tick (uncommon-occurrence,
uncommon-amount-if-occurred, rare-occurrence) in a fixed documented order, with commonOre computed
as the remainder. The 2 existing talent effect types (`extractionYieldMult`, `rareLootChanceMult`)
are replaced by 5 new ones, each read by its own small helper function (same additive-stacking
pattern the existing helpers already use). App.svelte's live tick loop and preview UI (mission
cards, captain-selection popup) are updated to match. A new `importRawSave` function in `save.ts`
is the write-side counterpart to the existing `exportRawSave`.

**Tech Stack:** Svelte 5 (non-runes), TypeScript, Vitest (present but unexecutable — Node/npm
confirmed absent; all "testing" is manual code tracing/hand-tracing).

---

## Before you start

Read `docs/plans/2026-07-07-loot-tier-rework-design.md` in full — it explains the "why" behind
every decision below. Read the CURRENT `src/lib/game/model.ts`, `src/lib/game/tick.ts`,
`src/lib/game/save.ts`, `src/App.svelte`, `src/lib/game/model.test.ts`, and
`src/lib/game/tick.test.ts` in full before touching anything — do not trust this plan's line-number
estimates, re-derive them from the live files. Node.js/npm/tsc are NOT installed in this
environment — no dev server, no test runner, no compiler. Every verification step is manual code
tracing/hand-tracing math, never live execution.

This is a genuine rewrite of the game's core extraction algorithm and its two already-shipped talent
bonuses. Treat every task with the same care as the original mission system's build
(`docs/plans/2026-07-06-home-planet-expeditions-plan.md`) — this is NOT a routine follow-up task.

---

### Task 1: model.ts — data model rework

**Files:** Modify `src/lib/game/model.ts`.

**Step 1: Replace `LootTableEntry`/`MissionDef.lootTable` with chance fields.**

Delete the `LootTableEntry` interface entirely (nothing else needs it after this task — confirmed
by Task 2/3/4/5's own removals). Change `MissionDef`:

```ts
export interface MissionDef {
  label: string;
  transitOutTicks: number;
  transitBackTicks: number;
  unloadTicks: number;
  extractionRatePerTick: number; // total units/tick, regardless of which tier they land as
  cargoCapacity: number; // total units across all tiers; MUST divide evenly by extractionRatePerTick
  // for this launch's requiredTicksForPhase() to have no partial-final-tick
  // edge case -- see that function's comment below if this is ever violated.
  // Independent per-tick occurrence chances (0-1) for uncommon/rare material,
  // replacing the old weighted-pick lootTable (2026-07-07 Loot Tier Rework --
  // see the design doc). Both can occur in the SAME tick (rolled
  // independently, not mutually exclusive) -- see tick.ts's rollExtractionTick
  // for the exact algorithm and rng() call order.
  uncommonChance: number;
  rareChance: number;
  tier: MissionTier;
}
```

Update both `MISSIONS` entries, replacing `lootTable: [...]` with the converted chances:

```ts
  shortOreRun: {
    label: "Short Ore Run",
    transitOutTicks: 3,
    transitBackTicks: 3,
    unloadTicks: 1,
    extractionRatePerTick: 10,
    cargoCapacity: 100,
    uncommonChance: 0.019, // was lootTable weight 19/1000 (1.9%)
    rareChance: 0.001, // was lootTable weight 1/1000 (0.1%)
    tier: "I",
  },
  longOreRun: {
    label: "Long Ore Run",
    transitOutTicks: 8,
    transitBackTicks: 8,
    unloadTicks: 1,
    extractionRatePerTick: 10,
    cargoCapacity: 100,
    uncommonChance: 0.08, // was lootTable weight 80/1000 (8%)
    rareChance: 0.02, // was lootTable weight 20/1000 (2%)
    tier: "I",
  },
```

**Step 2: Delete `rollLootTable`.** It operated on `LootTableEntry[]`, which no longer exists.
Nothing calls it after Task 3 rewrites `tickCaptainMission`.

**Step 3: Split the talent effect types.**

```ts
export type CaptainTalentEffect =
  | { type: "commonYieldMult"; mult: number }
  | { type: "uncommonYieldMult"; mult: number }
  | { type: "uncommonChanceMult"; mult: number }
  | { type: "rareChanceMult"; mult: number };

export type HomeworldTalentEffect =
  | { type: "unlockCaptainSlot" }
  | { type: "rareYieldMult"; mult: number }
  | { type: "recipeBonusOutput"; recipeKey: RecipeKey; bonus: number }
  | { type: "passiveTrickle"; material: HomePlanetMaterialKey; perTick: number };
```

**Step 4: Re-target the 5 already-shipped talent nodes' `effect` fields** (same cost/requires —
the `effect` value changes for all 5, and `commandExtractionI`/`commandExtractionII` ALSO get new
`label` strings, per the user's own follow-up request: "Command Efficiency I/II" read as a single
generic progression even though they now target two DIFFERENT tiers, not a simple stronger-version
upgrade like Keen Eye I/II. Renamed to "Bulk Extraction" (I, common ore) / "Refined Extraction" (II,
uncommon material) -- distinct names under a shared theme rather than a numbered pair. The
`CaptainTalentKey` identifiers themselves (`commandExtractionI`/`commandExtractionII`) are NOT
renamed -- they're internal keys, never shown to the player, same "only change what's actually
user-facing" precedent as the earlier Fleet Operations/Fleet Captain's nav-tab label rename):

```ts
  commandExtractionI: {
    branch: "command",
    label: "Bulk Extraction",
    cost: 2,
    requires: null,
    effect: { type: "commonYieldMult", mult: 0.1 }, // was extractionYieldMult
  },
  commandExtractionII: {
    branch: "command",
    label: "Refined Extraction",
    cost: 4,
    requires: "commandExtractionI",
    effect: { type: "uncommonYieldMult", mult: 0.15 }, // was extractionYieldMult
  },
  resourcefulnessRareChanceI: {
    branch: "resourcefulness",
    label: "Keen Eye I",
    cost: 2,
    requires: null,
    effect: { type: "uncommonChanceMult", mult: 0.25 }, // was rareLootChanceMult
  },
  resourcefulnessRareChanceII: {
    branch: "resourcefulness",
    label: "Keen Eye II",
    cost: 4,
    requires: "resourcefulnessRareChanceI",
    effect: { type: "rareChanceMult", mult: 0.5 }, // was rareLootChanceMult
  },
```

And in `HOMEWORLD_TALENTS`:

```ts
  fleetLogisticsYield: {
    branch: "fleetLogistics",
    label: "Fleet Requisitions",
    cost: 4,
    requires: null,
    effect: { type: "rareYieldMult", mult: 0.05 }, // was fleetExtractionYieldMult
  },
```

Do not touch any other field on any of these 5 nodes, and do not touch any OTHER node
(`fleetLogisticsSlot1/2/3`, `industryBonusOutput`, `economyTrickle`) at all.

**Step 5: Verify.** Grep the whole `src/` tree for `LootTableEntry`, `lootTable`, `rollLootTable`,
`extractionYieldMult`, `rareLootChanceMult`, `fleetExtractionYieldMult` to confirm every remaining
reference is one you know will be fixed by a LATER task in this plan (Tasks 2-5), not something this
task missed fixing itself. This task ONLY touches `model.ts` — do not fix `tick.ts`/`App.svelte`/test
files here, that's Tasks 2-5's job; just confirm you understand the full blast radius before moving
on.

**Step 6: Commit.**

```bash
git add src/lib/game/model.ts
git commit -m "feat: replace weighted loot table with independent per-tier chances, split talent effects by tier"
```

---

### Task 2: model.test.ts — remove/replace tests for the removed mechanism

**Files:** Modify `src/lib/game/model.test.ts`.

**Step 1:** Delete the entire `describe("rollLootTable", ...)` block (3 tests) — the function it
tests no longer exists.

**Step 2:** In `describe("MISSIONS — launch set", ...)`, replace the 2 tests that reference
`lootTable` (`"each mission's loot table weights sum to 999 or 1000..."` and `"longOreRun has better
rare-material odds than shortOreRun"`) with equivalents against the new fields:

```ts
  it("both missions' occurrence chances are valid probabilities (0-1)", () => {
    for (const key of Object.keys(MISSIONS) as (keyof typeof MISSIONS)[]) {
      expect(MISSIONS[key].uncommonChance).toBeGreaterThan(0);
      expect(MISSIONS[key].uncommonChance).toBeLessThanOrEqual(1);
      expect(MISSIONS[key].rareChance).toBeGreaterThan(0);
      expect(MISSIONS[key].rareChance).toBeLessThanOrEqual(1);
    }
  });

  it("longOreRun has better rare-material odds than shortOreRun", () => {
    expect(MISSIONS.longOreRun.rareChance).toBeGreaterThan(MISSIONS.shortOreRun.rareChance);
    expect(MISSIONS.longOreRun.uncommonChance).toBeGreaterThan(MISSIONS.shortOreRun.uncommonChance);
  });
```

**Step 3:** Verify no other test in this file references `lootTable`/`rollLootTable` (grep the file
yourself). The `CAPTAIN_TALENTS — launch set`/`HOMEWORLD_TALENTS — launch set` describe blocks check
`branch`/`effect.type === "unlockCaptainSlot"` shape, not the specific effect types this plan
changes — confirm they still pass unmodified against the new effect types (they should, since they
don't assert on `commonYieldMult`/etc. specifically).

**Step 4: Commit.**

```bash
git add src/lib/game/model.test.ts
git commit -m "test: update model.test.ts for the removed lootTable/rollLootTable mechanism"
```

---

### Task 3: tick.ts — extraction algorithm + bonus helper rewrite

**Files:** Modify `src/lib/game/tick.ts`.

**Step 1: Remove the import of `rollLootTable` and `type LootTableEntry`** from the `./model` import
block (both no longer exist).

**Step 2: Delete these 4 functions entirely**: `captainExtractionYieldMult`,
`captainRareLootChanceMult`, `fleetExtractionYieldMult`, `applyRareLootChanceMult`.

**Step 3: Add 5 new helper functions** in their place, same additive-stacking/read-at-usage-time
pattern as the ones just removed:

```ts
export function captainCommonYieldMult(captain: CaptainState): number {
  return captain.unlockedCaptainTalents.reduce((sum, key) => {
    const effect = CAPTAIN_TALENTS[key].effect;
    return effect.type === "commonYieldMult" ? sum + effect.mult : sum;
  }, 0);
}

export function captainUncommonYieldMult(captain: CaptainState): number {
  return captain.unlockedCaptainTalents.reduce((sum, key) => {
    const effect = CAPTAIN_TALENTS[key].effect;
    return effect.type === "uncommonYieldMult" ? sum + effect.mult : sum;
  }, 0);
}

export function captainUncommonChanceMult(captain: CaptainState): number {
  return captain.unlockedCaptainTalents.reduce((sum, key) => {
    const effect = CAPTAIN_TALENTS[key].effect;
    return effect.type === "uncommonChanceMult" ? sum + effect.mult : sum;
  }, 0);
}

export function captainRareChanceMult(captain: CaptainState): number {
  return captain.unlockedCaptainTalents.reduce((sum, key) => {
    const effect = CAPTAIN_TALENTS[key].effect;
    return effect.type === "rareChanceMult" ? sum + effect.mult : sum;
  }, 0);
}

export function fleetRareYieldMult(state: GameState): number {
  return state.unlockedHomeworldTalents.reduce((sum, key) => {
    const effect = HOMEWORLD_TALENTS[key].effect;
    return effect.type === "rareYieldMult" ? sum + effect.mult : sum;
  }, 0);
}
```

**Step 4: Replace the extraction roll with the new independent per-tier algorithm.**

Add this new function (replacing the deleted `applyRareLootChanceMult`'s spot):

```ts
// Independent per-tier roll for ONE whole tick of extraction (2026-07-07 Loot
// Tier Rework -- see the design doc). Replaces the old single mutually-
// exclusive rollLootTable pick: uncommon and rare are each rolled
// independently here and CAN both occur in the same tick (not exclusive of
// each other), each replacing that many units of common ore rather than
// adding on top of it.
//
// Exactly 3 rng() calls happen, ALWAYS in this order, regardless of outcome:
//   1. does uncommon occur (rng() < effective uncommon chance)
//   2. IF uncommon occurred: its base amount (rng() again -- 75% -> 1, 20% -> 2, 5% -> 3)
//   3. does rare occur (rng() < effective rare chance) -- rare's amount is always 1, no 4th call needed
// This fixed call count/order matters for hand-tracing a deterministic test
// rng, and for the closed-form guarantee tickCaptainMission depends on (use
// a CONSTANT, non-stateful rng in tests -- see that function's own comment).
//
// yieldMults scale the AMOUNT actually delivered: commonYieldMult scales the
// leftover-after-carve-out common amount (so total per-tick delivery CAN
// exceed extractionRatePerTick -- intentional, this is what "more efficient
// common extraction" should feel like); uncommonYieldMult/rareYieldMult each
// scale their own tier's rolled amount, only when that tier actually
// occurred this tick (nothing to scale if it didn't).
function rollExtractionTick(
  missionDef: MissionDef,
  bonuses: {
    commonYieldMult: number;
    uncommonYieldMult: number;
    uncommonChanceMult: number;
    rareYieldMult: number;
    rareChanceMult: number;
  },
  rng: () => number
): Record<LootMaterialKey, number> {
  const effectiveUncommonChance = Math.min(1, missionDef.uncommonChance * (1 + bonuses.uncommonChanceMult));
  const effectiveRareChance = Math.min(1, missionDef.rareChance * (1 + bonuses.rareChanceMult));

  let uncommonAmount = 0;
  if (rng() < effectiveUncommonChance) {
    const amountRoll = rng();
    const baseAmount = amountRoll < 0.75 ? 1 : amountRoll < 0.95 ? 2 : 3;
    uncommonAmount = baseAmount * (1 + bonuses.uncommonYieldMult);
  }

  let rareAmount = 0;
  if (rng() < effectiveRareChance) {
    rareAmount = 1 * (1 + bonuses.rareYieldMult);
  }

  const commonAmount = Math.max(0, missionDef.extractionRatePerTick - uncommonAmount - rareAmount) * (1 + bonuses.commonYieldMult);

  return { commonOre: commonAmount, uncommonMaterial: uncommonAmount, rareMaterial: rareAmount };
}
```

**Step 5: Rewire `tickCaptainMission` to use it.**

Change the `bonuses` parameter's shape:

```ts
export function tickCaptainMission(
  ticksElapsed: number,
  captain: CaptainState,
  rng: () => number = Math.random,
  // Every field defaults to 0 (no bonus) so every existing call site/test
  // that omits this 4th arg (or omits individual fields) behaves EXACTLY as
  // before -- the caller (tick(), below) sums each captain-level helper +
  // the fleet-wide one (rareYieldMult only, per the design doc) into one
  // value per field before calling in.
  bonuses: {
    commonYieldMult?: number;
    uncommonYieldMult?: number;
    uncommonChanceMult?: number;
    rareYieldMult?: number;
    rareChanceMult?: number;
  } = {}
): { captain: CaptainState; homePlanetDelta: Record<LootMaterialKey, number> } {
```

Replace the old `const extractionYieldMult = ...` / `const rareLootChanceMult = ...` /
`const effectiveLootTable = ...` block with:

```ts
  const resolvedBonuses = {
    commonYieldMult: bonuses.commonYieldMult ?? 0,
    uncommonYieldMult: bonuses.uncommonYieldMult ?? 0,
    uncommonChanceMult: bonuses.uncommonChanceMult ?? 0,
    rareYieldMult: bonuses.rareYieldMult ?? 0,
    rareChanceMult: bonuses.rareChanceMult ?? 0,
  };
```

Replace the extraction roll loop body:

```ts
      const fromWhole = Math.floor(mission.phaseProgressTicks);
      const toWhole = Math.floor(mission.phaseProgressTicks + ticksToApply);
      const rollsThisStep = toWhole - fromWhole;
      for (let i = 0; i < rollsThisStep; i++) {
        const delta = rollExtractionTick(missionDef, resolvedBonuses, rng);
        mission.cargo.commonOre += delta.commonOre;
        mission.cargo.uncommonMaterial += delta.uncommonMaterial;
        mission.cargo.rareMaterial += delta.rareMaterial;
      }
```

**Step 6: Update `tick()`'s bonus computation** (the function that calls `tickCaptainMission` for
every mission captain, offline-catchup path):

```ts
  const fleetRareYield = fleetRareYieldMult(state);
  const captains = state.captains.map((captain) => {
    if (captain.mission === null) return captain;
    const bonuses = {
      commonYieldMult: captainCommonYieldMult(captain),
      uncommonYieldMult: captainUncommonYieldMult(captain),
      uncommonChanceMult: captainUncommonChanceMult(captain),
      rareYieldMult: fleetRareYield,
      rareChanceMult: captainRareChanceMult(captain),
    };
    const { captain: updated, homePlanetDelta: delta } = tickCaptainMission(ticksElapsed, captain, Math.random, bonuses);
    ...
```

(Keep everything else in `tick()` — the `passiveTrickle` loop, `homePlanetDelta` merge, etc. —
completely unchanged; only the `bonuses` object's shape/computation changes.)

**Step 7: Fix the stale comment** near `buyCaptainTalent` (search for "each effect type is read
wherever that stat matters") — it currently names `extractionYieldMult`/`rareLootChanceMult`
specifically; update it to name the 5 new effect types instead, or generalize the wording so it
doesn't need updating again next time an effect type is added/renamed.

**Step 8: Verify.** Grep `tick.ts` for `extractionYieldMult`, `rareLootChanceMult`,
`fleetExtractionYieldMult`, `applyRareLootChanceMult`, `rollLootTable`, `LootTableEntry`,
`lootTable` to confirm zero remaining references. Hand-trace `rollExtractionTick` against the
design doc's two worked examples before moving on:
- `extractionRatePerTick` 10, uncommonAmount 2, rareAmount 0 → `commonAmount = 10 - 2 - 0 = 8`.
  Matches "8 common, 2 uncommon."
- `extractionRatePerTick` 10, uncommonAmount 1, rareAmount 1 → `commonAmount = 10 - 1 - 1 = 8`.
  Matches "8 common, 1 uncommon, 1 rare."

**Step 9: Commit.**

```bash
git add src/lib/game/tick.ts
git commit -m "feat: independent per-tier extraction rolls, 5 tier-specific talent bonus helpers"
```

---

### Task 4: tick.test.ts — comprehensive rewrite for the new mechanism

**Files:** Modify `src/lib/game/tick.test.ts`.

This is the highest-risk task in this plan — the ENTIRE extraction-roll test surface changes shape.
Read the CURRENT full file first. You will need to:

**Step 1:** Update the import block: remove `captainExtractionYieldMult`, `captainRareLootChanceMult`,
`fleetExtractionYieldMult`, `applyRareLootChanceMult`; add `captainCommonYieldMult`,
`captainUncommonYieldMult`, `captainUncommonChanceMult`, `captainRareChanceMult`,
`fleetRareYieldMult`.

**Step 2:** Delete the entire `describe("applyRareLootChanceMult", ...)` block (function no longer
exists).

**Step 3:** Rewrite `describe("captainExtractionYieldMult / captainRareLootChanceMult /
fleetExtractionYieldMult", ...)` (rename the describe block itself to match the new function names)
to test the 5 new helpers instead, hand-verifying against the new `CAPTAIN_TALENTS`/
`HOMEWORLD_TALENTS` values from Task 1:
- `captainCommonYieldMult`: 0 with no talents; 0.1 with `commandExtractionI` unlocked (Command
  Efficiency I).
- `captainUncommonYieldMult`: 0 with no talents; 0.15 with `commandExtractionII` unlocked (only
  reachable once `commandExtractionI` is too, per its `requires`, but test can set
  `unlockedCaptainTalents` directly without going through `buyCaptainTalent`'s validation).
- `captainUncommonChanceMult`: 0 with no talents; 0.25 with `resourcefulnessRareChanceI` (Keen Eye I).
- `captainRareChanceMult`: 0 with no talents; 0.5 with `resourcefulnessRareChanceII` (Keen Eye II).
- `fleetRareYieldMult`: 0 with no Homeworld Talents; 0.05 with `fleetLogisticsYield` unlocked (Fleet
  Requisitions).
- At least one test confirming a helper does NOT pick up an unrelated effect type (e.g.
  `captainCommonYieldMult` ignores `uncommonChanceMult`/etc.).

**Step 4:** Rewrite `describe("tickCaptainMission — extraction loot rolls", ...)` entirely. The old
tests assumed ONE rng() call per tick picking ONE material; the new mechanism makes up to 3 rng()
calls per tick for independent occurrence/amount. Use CONSTANT (non-stateful) rng functions per
test scenario — same value returned on every call — so you can hand-reason exactly which branches
fire regardless of how many times rng() gets invoked internally. Cover, at minimum:

- **All-common tick** (nothing occurs): a constant rng high enough to fail BOTH occurrence checks
  for shortOreRun (e.g. `() => 0.5` -- confirm by hand: `0.5 < 0.019`? no. `0.5 < 0.001`? no).
  Expect `cargo.commonOre` to increase by exactly `extractionRatePerTick` (10) per tick, and
  `uncommonMaterial`/`rareMaterial` to stay 0.
- **Both tiers occur, minimum amounts** (a constant rng low enough to pass every check, e.g.
  `() => 0`): expect uncommon amount 1 (since `0 < 0.75` on the amount roll), rare amount 1, common
  = `10 - 1 - 1 = 8`. Hand-verify this matches the design doc's exact worked example.
- **Uncommon amount lands on 2 or 3** (a targeted distribution test): since occurrence chance is
  always small (≤8% for either mission) while the amount-roll thresholds are 0.75/0.95, no single
  CONSTANT rng value can pass the occurrence check (needs a small value) AND land the amount roll on
  bucket 2 or 3 (needs a value ≥0.75) — occurrence and amount draw from the SAME rng() call sequence.
  For this one test ONLY, use a small stateful sequence function instead of a constant:
  `let calls = 0; const rng = () => { calls++; return calls === 1 ? 0 : 0.8; };` (call 1 passes
  occurrence with `0`, call 2 rolls the amount with `0.8`, landing in the `< 0.95` bucket → amount
  2). Document inline why this ONE test uses a stateful rng while every other test (including the
  closed-form test) uses a constant one — a stateful rng risks breaking the closed-form guarantee if
  used somewhere that guarantee actually matters, so confine it to this single targeted assertion.
- **extractionYieldMult-equivalents scale amount, not occurrence**: verify `commonYieldMult`,
  `uncommonYieldMult`, `rareYieldMult` each scale their own tier's delivered amount by `(1 + mult)`,
  hand-computed.
- **chance mults scale occurrence, not amount**: verify `uncommonChanceMult`/`rareChanceMult` change
  whether a fixed borderline rng value crosses the occurrence threshold (mirroring the OLD
  `"rareLootChanceMult shifts the SAME rng roll..."` test's spirit, adapted to the new independent-
  chance model rather than reweighted-table model).
- **Omitting the bonuses arg behaves exactly as before** (defaults to 0 for every field) — keep an
  equivalent of this existing test.

**Step 5:** Re-verify the EXISTING closed-form test (`"one big jump equals many small ticks..."`)
still passes conceptually against the new algorithm — it uses `ALWAYS_COMMON_ORE = () => 0`, which
under the OLD mechanism meant "always pick bucket 1 (commonOre)" but under the NEW mechanism means
"always pass both occurrence checks AND always land amount-roll on 1" (i.e., every tick delivers
uncommon=1, rare=1, common=8, NOT pure commonOre-only as the name implies anymore). The test's
actual ASSERTION (big-jump result equals many-small-ticks result) still holds regardless of what
`ALWAYS_COMMON_ORE` produces, since it's still a constant function — but its NAME is now misleading.
Rename it to something accurate (e.g. `ALWAYS_MIN_ROLL` or similar) and update its own inline
comment, then verify every OTHER test using the same constant elsewhere in the file needs the same
rename (grep for `ALWAYS_COMMON_ORE` across the whole file).

**Step 6:** Update `describe("tick() — Homeworld/Captain Talent effects wired into extraction and
passive production", ...)` (the block testing `tick()`'s own bonus wiring) to use the new 5-field
bonuses shape and the new helper/talent names (`fleetLogisticsYield` now maps to `rareYieldMult`,
not `fleetExtractionYieldMult`) — hand-recompute every expected numeric value against the new
formulas.

**Step 7:** Grep the WHOLE file one final time for `extractionYieldMult`, `rareLootChanceMult`,
`fleetExtractionYieldMult`, `applyRareLootChanceMult`, `rollLootTable`, `lootTable` to confirm zero
remaining references anywhere, including comments.

**Step 8: Commit.**

```bash
git add src/lib/game/tick.test.ts
git commit -m "test: rewrite tick.test.ts for independent per-tier extraction rolls and split talent bonuses"
```

---

### Task 5: App.svelte — mirror the tick.ts changes in the live loop + update preview UI

**Files:** Modify `src/App.svelte`.

Read the full file first (don't trust old line numbers). This file has TWO places mirroring
tick.ts's bonus-computation logic (the live 100ms poll loop, and the captain-selection popup's
preview math) plus ONE place displaying base mission stats (the mission cards) — all three need
updating.

**Step 1: Update imports** from `./lib/game/tick`: remove `captainExtractionYieldMult`,
`captainRareLootChanceMult`, `fleetExtractionYieldMult`, `applyRareLootChanceMult`; add
`captainCommonYieldMult`, `captainUncommonYieldMult`, `captainUncommonChanceMult`,
`captainRareChanceMult`, `fleetRareYieldMult`.

**Step 2: Update the live tick loop's bonus computation** (inside the `if (progress >= 1)` block,
where `fleetYieldMult`/`bonuses` are currently built before calling `tickCaptainMission`) to build
the new 5-field bonuses object, mirroring Task 3 Step 6's `tick()` changes exactly:

```ts
        const fleetRareYield = fleetRareYieldMult(state);
        ...
          const bonuses = {
            commonYieldMult: captainCommonYieldMult(captain),
            uncommonYieldMult: captainUncommonYieldMult(captain),
            uncommonChanceMult: captainUncommonChanceMult(captain),
            rareYieldMult: fleetRareYield,
            rareChanceMult: captainRareChanceMult(captain),
          };
```

Remove the now-obsolete `passiveTrickle` loop's dependency on anything from the old bonus system (it
doesn't actually depend on extraction bonuses at all — verify this is untouched/unaffected, it reads
`HOMEWORLD_TALENTS`/`passiveTrickle` directly, unrelated to this rework).

**Step 3: Update the Fleet Operations mission-card base-rate display** (the `{#each tierIMissions as
[missionKey, missionDef]}` block, currently doing `{@const totalWeight = missionDef.lootTable.reduce
(...)}` and iterating `missionDef.lootTable`). Replace with:

```svelte
                <div class="mission-card-body">
                  <div class="research-name">{missionDef.label}</div>
                  <div class="research-cost">Cargo capacity: {formatNumber(missionDef.cargoCapacity)}</div>
                  <div class="research-cost">Common Ore: up to {formatNumber(missionDef.extractionRatePerTick)}/tick</div>
                  <div class="research-cost">Uncommon Material: 1-3/tick ({(missionDef.uncommonChance * 100).toFixed(1)}% chance/tick)</div>
                  <div class="research-cost">Rare Material: 1/tick ({(missionDef.rareChance * 100).toFixed(1)}% chance/tick)</div>
                </div>
```

**Step 4: Update the captain-selection popup's live preview** (the `{:else}` branch computing
`extractionYieldMult`/`rareLootChanceMult`/`effectiveLootTable`/`amountPerTick`). Replace the
`{@const}` chain with the new per-tier math, mirroring `rollExtractionTick`'s formulas EXACTLY (same
requirement as the original popup build -- the preview must never show different numbers than what
the real mission will actually do):

```svelte
          {@const uncommonChanceMult = captainUncommonChanceMult(selectedCaptain)}
          {@const rareChanceMult = captainRareChanceMult(selectedCaptain)}
          {@const effectiveUncommonChance = Math.min(1, missionDef.uncommonChance * (1 + uncommonChanceMult))}
          {@const effectiveRareChance = Math.min(1, missionDef.rareChance * (1 + rareChanceMult))}
          {@const commonYieldMult = captainCommonYieldMult(selectedCaptain)}
          {@const uncommonYieldMult = captainUncommonYieldMult(selectedCaptain)}
          {@const rareYieldMult = fleetRareYieldMult(state)}

          <div class="research-name">Captain: {selectedCaptain.label}</div>

          <div class="panel-title">DROP RATES</div>
          <div class="research-cost">Common Ore: up to {formatNumber(missionDef.extractionRatePerTick * (1 + commonYieldMult))}/tick</div>
          <div class="research-cost">Uncommon Material: 1-3/tick, scaled by {(uncommonYieldMult * 100).toFixed(0)}% ({(effectiveUncommonChance * 100).toFixed(1)}% chance/tick)</div>
          <div class="research-cost">Rare Material: 1/tick, scaled by {(rareYieldMult * 100).toFixed(0)}% ({(effectiveRareChance * 100).toFixed(1)}% chance/tick)</div>
```

`rareYieldMult` is FLEET-WIDE ONLY (there is no captain-level rare-yield talent — `fleetLogisticsYield`
/Fleet Requisitions, a Homeworld Talent, is the ONLY source of `rareYieldMult` in the whole talent
tree per Task 1), which is why it reads `fleetRareYieldMult(state)` directly with no captain-level
contribution added in, unlike `commonYieldMult`/`uncommonYieldMult` above it.

Timing section (`requiredTicksForPhase`, etc.) is UNCHANGED — none of this rework touches timing.

**Step 5: Verify.** Grep `App.svelte` for `lootTable`, `extractionYieldMult`, `rareLootChanceMult`,
`fleetExtractionYieldMult`, `applyRareLootChanceMult` to confirm zero remaining references. Hand
verify the popup preview's formulas are byte-identical in shape to `rollExtractionTick`'s (same
`Math.min(1, ...)` clamp, same `(1 + mult)` scaling, same which-mult-affects-which-tier mapping).

**Step 6: Commit.**

```bash
git add src/App.svelte
git commit -m "feat: mirror independent per-tier extraction rolls in the live tick loop and preview UI"
```

---

### Task 6: save.ts — importRawSave function

**Files:** Modify `src/lib/game/save.ts`. Modify `src/lib/game/save.test.ts` (add tests).

**Step 1:** Add, near `exportRawSave`:

```ts
// Counterpart to exportRawSave -- writes a previously-exported raw save
// string back into localStorage, after confirming it actually deserializes
// (rejects garbage/corrupt input rather than silently corrupting the
// current save). Writes the RAW string as-is (same LZ-compressed-base64
// shape exportRawSave produces) rather than re-serializing through
// migrate()/serialize() -- avoids any risk of that round-trip silently
// changing the save's shape before the caller even gets a chance to reload
// and let the normal load-time migration path run.
export function importRawSave(raw: string): boolean {
  const save = deserialize(raw);
  if (!save) return false;
  try {
    localStorage.setItem(SAVE_KEY, raw);
    localStorage.setItem(`${SAVE_KEY}_created_at`, String(save.created_at));
    return true;
  } catch {
    return false;
  }
}
```

**Step 2:** Add tests to `save.test.ts` (read the file's existing style first, e.g. how
`serialize`/`deserialize` round-trips are tested if at all — if there's no existing describe block
for `serialize`/`deserialize`/`exportRawSave`, add a new one for `importRawSave` following this
file's established conventions):

```ts
describe("importRawSave", () => {
  it("rejects garbage input, leaving existing localStorage untouched", () => {
    localStorage.setItem(SAVE_KEY, "some-existing-valid-save-string-placeholder");
    const success = importRawSave("not a valid save at all");
    expect(success).toBe(false);
  });

  it("accepts a valid raw save string, round-tripping via serialize/exportRawSave shape", () => {
    const state = freshState();
    const raw = serialize(state, Date.now());
    const success = importRawSave(raw);
    expect(success).toBe(true);
    expect(localStorage.getItem(SAVE_KEY)).toBe(raw);
  });
});
```

(Adapt exact setup/teardown -- e.g. clearing `localStorage` between tests -- to match whatever
convention this file's OTHER describe blocks already use; don't invent a different one.)

**Step 3: Commit.**

```bash
git add src/lib/game/save.ts src/lib/game/save.test.ts
git commit -m "feat: add importRawSave, the write-side counterpart to exportRawSave"
```

---

### Task 7: App.svelte — Import Save UI

**Files:** Modify `src/App.svelte`.

**Step 1:** Add `importRawSave` to the existing import from `./lib/game/save`.

**Step 2:** Add new script state near `deleteModalOpen`:

```ts
let importModalOpen = false;
let pendingImportRaw: string | null = null;
let importError: string | null = null;

function onImportFileSelected(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) return;
  file.text().then((text) => {
    pendingImportRaw = text;
    importError = null;
    importModalOpen = true;
  });
  input.value = ""; // allow re-selecting the same file later (browsers don't fire `change` on an unchanged value otherwise)
}

function cancelImport() {
  importModalOpen = false;
  pendingImportRaw = null;
  importError = null;
}

function confirmImport() {
  if (pendingImportRaw === null) return;
  const success = importRawSave(pendingImportRaw);
  if (!success) {
    importError = "That file isn't a valid Fleet Admiral save.";
    return;
  }
  // Simplest way to get every derived/init-time value (in-memory state,
  // createdAt, tick-loop timers) to reset cleanly from the just-imported
  // save -- matches the existing "load happens once, at mount" pattern
  // rather than adding a second "hot-swap state mid-session" code path.
  window.location.reload();
}
```

**Step 3:** Add the file input next to the existing Export Save button (in the Options sub-tab,
`dev-row` containing `Export Save`/`Delete Save`):

```svelte
          <button class="dev-btn" on:click={doExportSave}>Export Save</button>
          <label class="dev-btn">
            Import Save
            <input type="file" accept="application/json,.json" style="display:none" on:change={onImportFileSelected} />
          </label>
          <button class="dev-btn danger" on:click={() => (deleteModalOpen = true)}>Delete Save</button>
```

(A `<label>` wrapping a hidden `<input type="file">` is the standard way to style a file input as a
regular button — clicking the visible label text triggers the hidden input. Verify this pattern
renders sensibly given `.dev-btn`'s existing CSS; adjust the label's own display/cursor CSS only if
genuinely needed, don't restyle `.dev-btn` itself.)

**Step 4:** Add the confirmation modal, near the existing `{#if deleteModalOpen}`/`{#if
missionPopupKey !== null}` modals:

```svelte
{#if importModalOpen}
  <div class="modal-backdrop">
    <Panel class="modal-dialog">
      <div class="panel-title">IMPORT SAVE</div>
      <p class="modal-warning">This will REPLACE your current save. This can't be undone.</p>
      {#if importError}
        <p class="modal-warning">{importError}</p>
      {/if}
      <div class="modal-row">
        <button class="dev-btn" on:click={cancelImport}>Cancel</button>
        <button class="dev-btn danger" on:click={confirmImport}>Import</button>
      </div>
    </Panel>
  </div>
{/if}
```

**Step 5: Verify.** Confirm `onImportFileSelected`'s `input.value = ""` reset doesn't interfere with
the `.text()` promise already in flight (it doesn't — `file` was captured into a local variable
before the reset). Confirm the modal's Cancel button fully resets `pendingImportRaw`/`importError`
so a later re-open starts clean.

**Step 6: Commit.**

```bash
git add src/App.svelte
git commit -m "feat: Import Save UI (file input + confirmation modal)"
```

---

### Task 8: App.svelte — versioning reset

**Files:** Modify `src/App.svelte`.

**Step 1:** Change `APP_VERSION` to `"0.2.0"`.

**Step 2:** Add a NEW entry at the TOP of `PATCH_NOTES` (newest-first convention) — do NOT touch any
existing entry (0.6.0-0.9.0 stay exactly as they are, historical record):

```ts
    { version: "0.2.0", summary: "Reworked mission loot so uncommon and rare materials can both drop in the same tick instead of one replacing the others; talent bonuses now target a specific material tier each. Added Import Save. Version numbering restarts here -- 0.2.1/0.2.2 for small fixes, 0.3.0 for the next feature." },
```

**Step 3:** Add a one-line comment above `APP_VERSION`'s declaration noting the reset, so a future
reader isn't confused by `0.2.0` appearing chronologically after `0.9.0`:

```ts
  // Reset to a disciplined X.Y.Z scheme starting 2026-07-07 (Y bumps per
  // feature release, Z bumps per minor fix) -- the pre-reset 0.6.0-0.9.0
  // history above is left untouched (never rewrite patch-note history), so
  // this deliberately reads as "0.2.0 newer than 0.9.0" once, only here.
  const APP_VERSION = "0.2.0";
```

**Step 4: Commit.**

```bash
git add src/App.svelte
git commit -m "docs: reset APP_VERSION to 0.2.0, new versioning scheme going forward"
```

---

### Task 8b: App.svelte — rename the "tactical" Captain Talent branch's display label to "Tactician"

**Files:** Modify `src/App.svelte`.

Mid-plan addition, unrelated to the loot/talent rework above — the user separately asked for this
while reviewing. The Captain Talents panel currently renders each branch's raw string key directly
(`{branch}`), uppercased by `.skill-branch-title`'s own `text-transform: uppercase` CSS — so
`"tactical"` shows as "TACTICAL" today. Same "only change what's user-facing, not the internal key"
precedent as the earlier nav-tab rename and the Command Efficiency → Bulk/Refined Extraction rename:
the `CaptainTalentBranch` union member `"tactical"` stays exactly as-is (it's an internal key
`CAPTAIN_TALENTS` entries key off of via their `branch` field, not shown to the player directly) —
only the DISPLAYED text changes.

**Step 1:** Read the Captain Talents panel block (`{#each (["command", "tactical", "science",
"resourcefulness", "diplomacy"] as CaptainTalentBranch[]) as branch}` — search for this exact line
to find it; do NOT confuse it with the separate Homeworld Talents panel a few hundred lines earlier,
which iterates a DIFFERENT type (`HomeworldTalentBranch`) and must NOT be touched by this task).

**Step 2:** Add a small display-label map near the top of the script section (alongside other
display-only label constants like `MISSION_PHASE_LABEL`):

```ts
// Display label for each Captain Talent branch -- "tactical" shows as
// "Tactician" per the user's own request (2026-07-07); every other branch's
// label is just its own raw key (still uppercased by .skill-branch-title's
// CSS, same as before). The branch KEY itself ("tactical") is unchanged --
// CAPTAIN_TALENTS entries still key off "tactical", this map only affects
// what's rendered.
const CAPTAIN_TALENT_BRANCH_LABEL: Record<CaptainTalentBranch, string> = {
  command: "command",
  tactical: "Tactician",
  science: "science",
  resourcefulness: "resourcefulness",
  diplomacy: "diplomacy",
};
```

**Step 3:** In the Captain Talents panel block ONLY, change `<div class="skill-branch-title">
{branch}</div>` to `<div class="skill-branch-title">{CAPTAIN_TALENT_BRANCH_LABEL[branch]}</div>`.
Do NOT change the Homeworld Talents panel's own `<div class="skill-branch-title">{branch}</div>` —
that one has no corresponding rename request and must render exactly as it does today.

**Step 4: Verify.** Grep the file for `skill-branch-title` to confirm there are exactly 2 call
sites (Homeworld Talents, Captain Talents) and only the Captain Talents one was changed. Confirm
`CAPTAIN_TALENT_BRANCH_LABEL` is a `Record<CaptainTalentBranch, string>` with all 5 keys present
(TypeScript would structurally require this even without a compiler running, but hand-verify by
eye that none are missing/misspelled, since there's no `tsc` in this environment to catch it).

**Step 5: Commit.**

```bash
git add src/App.svelte
git commit -m "style: rename the Captain Talents 'tactical' branch's display label to Tactician"
```

---

### Task 9: Docs — session log + KNOWN_ISSUES.md

**Files:** Modify `SESSION_LOG.md`. Modify `KNOWN_ISSUES.md` only if something genuinely warrants a
new entry (read 2 existing entries for wording/style match first).

**Step 1:** Append a SESSION_LOG.md entry (match the established "Session N — ..." format/tone
exactly) summarizing: the independent per-tier extraction rework (with the exact worked example),
the 5-way talent effect split and which existing nodes got re-targeted to which tier (including the
Command Efficiency I/II → Bulk/Refined Extraction rename), Import Save, the versioning reset
(flagging the intentional 0.2.0-after-0.9.0 oddity), and the "tactical" branch's display label
becoming "Tactician" (Task 8b).

**Step 2: Commit.**

```bash
git add SESSION_LOG.md KNOWN_ISSUES.md
git commit -m "docs: session log for Loot Tier Rework, Talent Split, Import Save"
```

Do NOT push — origin/main triggers a live Vercel production redeploy; wait for explicit confirmation
before any push, per this project's established practice.
