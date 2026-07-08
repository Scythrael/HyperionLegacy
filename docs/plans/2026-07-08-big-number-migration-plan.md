# Big-Number (Decimal) Migration Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace plain JS `number` with `break_infinity.js`'s `Decimal` type for every resource/currency
field that needs unbounded scale (up to and beyond `e1,000,000`), while every bounded counter (level,
statPoints, adminPoints, talent/recipe costs, tick/phase counters, percentages) stays a plain `number`.

**Architecture:** `Decimal` becomes the runtime type for `homePlanet.storage`'s 5 keys, mission `cargo`'s
3 keys, captain `xp`, `fleetAdminXp`, and `RECIPES[].inputs`/`.output.amount`. Every arithmetic/comparison
site touching those fields switches from JS operators to `Decimal`'s own methods (`.plus()`, `.minus()`,
`.times()`, `.dividedBy()`, `.lt()`, `.gte()`, etc.), which accept `DecimalSource = Decimal | number | string`
directly — so comparisons against plain-number thresholds (`xpForNextLevel(level)`, talent costs) need no
wrapping, as long as the method is always called *on* the Decimal side. Serialization relies on `Decimal`'s
built-in `toJSON(): string` for the write path (automatic, no code needed), plus a new idempotent
`hydrateDecimals()` step applied unconditionally at the end of `migrate()` for the read path (since
`JSON.parse` can never reconstruct a class instance on its own, and a save already at the current version
skips the migration loop entirely — hydration cannot live only inside a version-keyed migration function).

**Tech Stack:** Vite + Svelte 5 + TypeScript + Vitest, `break_infinity.js` (new dependency).

---

## Before you start: read this

Node.js/npm/tsc are **not available** in this environment. There is no dev server, no test runner, no
compiler. Every single task in this plan is verified by reading code and hand-tracing math — the ONLY
place this code actually compiles/runs is Vercel's build step, after a push to `main`. The user has
explicitly asked for **extra care and triple-checking** on this migration specifically, more so than any
other feature built this session. That means:

- Every task here is deliberately smaller and more narrowly scoped than a typical feature task in this
  project's history. Do not batch multiple tasks' diffs into one commit.
- Before marking any task done, re-read your own diff and hand-trace at least one worked example all
  the way through, the same way this project's `tick.ts`/`tick.test.ts` comments already do.
- Two library facts below were verified directly against `break_infinity.js`'s actual TypeScript
  declaration file (`https://cdn.jsdelivr.net/npm/break_infinity.js@2/dist/index.d.ts`) at plan-writing
  time, not assumed from general familiarity with similar libraries. If anything about the library's
  actual behavior ever contradicts what's written here once the dependency is truly installed and
  type-checked (which can only happen on Vercel), that contradiction is the more important signal —
  trust the real compiler over this document.

### Verified `break_infinity.js` API surface (do not deviate from these exact names)

```ts
type DecimalSource = Decimal | number | string;

class Decimal {
  constructor(value?: DecimalSource);
  mantissa: number;
  exponent: number;
  toNumber(): number;         // plain double, precision loss OK for display-only/percentage use
  toString(): string;
  toJSON(): string;           // JSON.stringify calls this automatically -- confirmed present
  plus(value: DecimalSource): Decimal;
  minus(value: DecimalSource): Decimal;
  times(value: DecimalSource): Decimal;
  dividedBy(value: DecimalSource): Decimal;
  lt(value: DecimalSource): boolean;
  gt(value: DecimalSource): boolean;
  lte(value: DecimalSource): boolean;
  gte(value: DecimalSource): boolean;
  equals(value: DecimalSource): boolean;
  pow(value: number | Decimal): Decimal;
  static max(value: DecimalSource, other: DecimalSource): Decimal;
  static min(value: DecimalSource, other: DecimalSource): Decimal;
}
```

**Critical implication that simplifies several tasks below**: because every method accepts
`DecimalSource` (which includes plain `number`), comparing or computing a Decimal field against a
plain-number threshold (e.g. `xp.gte(xpForNextLevel(level))`, where `xpForNextLevel` returns a plain
`number`) needs **no wrapping at all** — just call the method on the Decimal side. The one rule to
never break: **a plain JS number has no `.lt()`/`.plus()` methods, so the Decimal value must always be
the receiver, never the argument-only side of a raw `<`/`+` operator.**

### Rewrite pattern (every call site touching a `Decimal` field follows this)

| Old (plain `number`) | New (`Decimal`) |
|---|---|
| `a += b` | `a = a.plus(b)` |
| `a -= b` | `a = a.minus(b)` |
| `a * b` | `a.times(b)` |
| `a / b` | `a.dividedBy(b)` |
| `a < b` | `a.lt(b)` |
| `a >= b` | `a.gte(b)` |
| `Math.min(a, b)` | `Decimal.min(a, b)` |
| `Math.max(a, b)` | `Decimal.max(a, b)` |
| `0` (initial value) | `new Decimal(0)` |
| need a plain number back (percentages, CSS width %) | `.toNumber()` at the very end, after all Decimal math |

### Confirmed field split (unchanged from the design doc, do not re-litigate)

| Goes `Decimal` | Stays plain `number` |
|---|---|
| `homePlanet.storage` (`commonOre`, `uncommonMaterial`, `rareMaterial`, `refinedMaterial`, `components`) | `level` (per-captain), `fleetAdminLevel` |
| Mission `cargo` (`commonOre`, `uncommonMaterial`, `rareMaterial`) | `statPoints`, `adminPoints` |
| Captain `xp` | `CAPTAIN_TALENTS[].cost`, `HOMEWORLD_TALENTS[].cost` |
| `fleetAdminXp` | All tick/phase counters, `xpForNextLevel`/`xpForNextFleetAdminLevel`'s return values (plain formulas of `level`, itself plain) |
| `RECIPES[].inputs[key]`, `RECIPES[].output.amount` | `HomeworldTalentEffect`'s `recipeBonusOutput.bonus` and `passiveTrickle.perTick` (flat bonus/rate constants — flow into `.plus(plainNumber)` on the Decimal side, no wrapping needed) |

---

### Task 0: Set up git worktree

**Context:** `feat/loot-tier-rework` has already merged into `main` (confirmed, commit `a4add85`,
pushed). This migration touches the same files (`model.ts`, `tick.ts`) and must not run concurrently
with any other in-flight branch on this repo.

**Step 1:** Verify `main` is clean and up to date:

```bash
cd "F:/Windows Folders/Documents/fleet-admiral"
git status
git branch --show-current
```

Expected: `On branch main`, `nothing to commit, working tree clean`.

**Step 2:** Create the worktree (this project's established location, already gitignored):

```bash
git worktree add .worktrees/feat-big-number-migration -b feat/big-number-migration
cd .worktrees/feat-big-number-migration
```

**Step 3:** Confirm the worktree is on the right branch and clean:

```bash
git status
git log --oneline -3
```

Expected: `On branch feat/big-number-migration`, top commit is `a4add85` (the loot-tier-rework merge).

All subsequent tasks in this plan operate inside
`F:\Windows Folders\Documents\fleet-admiral\.worktrees\feat-big-number-migration` — every file path below
is relative to that worktree root, not the main repo checkout.

---

### Task 1: Add `break_infinity.js` dependency + isolated smoke test

**Files:**
- Modify: `package.json`
- Create: `src/lib/game/decimal-smoke.test.ts`

**Why this task exists on its own:** this is the cheapest possible place for a library-behavior surprise
to surface — before any real game code depends on it. Node/npm can't run here, so this test can't
actually be executed in this environment either, but writing it accurately, hand-tracing it, and having
it reviewed BEFORE any other task builds on top of the dependency is the whole point.

**Step 1:** Add the dependency to `package.json`'s `"dependencies"` block (alongside the existing
`lz-string` entry):

```json
"dependencies": {
  "lz-string": "^1.5.0",
  "break_infinity.js": "^2.2.0"
}
```

**Step 2:** Write `src/lib/game/decimal-smoke.test.ts`, a small, self-contained file exercising exactly
the operations this migration depends on, each hand-traced in a comment:

```ts
import { describe, it, expect } from "vitest";
import Decimal from "break_infinity.js";

describe("break_infinity.js Decimal — smoke test (verifies the library behaves as this migration's plan assumes, before any real game code depends on it)", () => {
  it("constructs from a number and a string, both producing an equal value", () => {
    const fromNumber = new Decimal(12345);
    const fromString = new Decimal("12345");
    expect(fromNumber.equals(fromString)).toBe(true);
  });

  it("plus/minus/times/dividedBy return NEW instances and accept plain numbers directly (DecimalSource)", () => {
    const a = new Decimal(10);
    const b = a.plus(5); // DecimalSource accepts a plain number, no wrapping needed
    expect(a.toNumber()).toBe(10); // `a` itself is unchanged -- Decimal is not mutated in place
    expect(b.toNumber()).toBe(15);
    expect(b.minus(3).toNumber()).toBe(12);
    expect(b.times(2).toNumber()).toBe(30);
    expect(b.dividedBy(3).toNumber()).toBe(5);
  });

  it("comparison methods accept a plain number directly, matching a mixed Decimal/number comparison this migration relies on", () => {
    const xp = new Decimal(150);
    // Mirrors tick.ts's real usage: comparing a Decimal xp against a plain-number
    // threshold returned by xpForNextLevel(level) -- no wrapping required.
    expect(xp.gte(100)).toBe(true);
    expect(xp.lt(100)).toBe(false);
  });

  it("toString()/toJSON() both produce a round-trippable string, and toNumber() converts back with acceptable precision loss for small values", () => {
    const d = new Decimal(9999.5);
    expect(d.toString()).toBe(d.toJSON()); // toJSON should just be toString's value, per the verified .d.ts
    const revived = new Decimal(d.toString());
    expect(revived.equals(d)).toBe(true);
    expect(d.toNumber()).toBeCloseTo(9999.5, 6);
  });

  it("JSON.stringify calls toJSON() automatically, embedding the Decimal as a JSON string (no custom replacer needed)", () => {
    const payload = { commonOre: new Decimal(42) };
    const json = JSON.stringify(payload);
    expect(json).toBe('{"commonOre":"42"}');
  });

  it("JSON.parse does NOT reconstruct a Decimal -- the round-tripped value is a plain string, confirming hydration after parse is mandatory", () => {
    const json = JSON.stringify({ commonOre: new Decimal(42) });
    const parsed = JSON.parse(json);
    expect(typeof parsed.commonOre).toBe("string");
    expect(parsed.commonOre instanceof Decimal).toBe(false);
    // This is exactly why Task 3 (save.ts) needs an explicit hydrateDecimals()
    // step -- JSON.parse alone can never produce a live Decimal instance.
  });

  it("Decimal.min/Decimal.max are static functions accepting two DecimalSource args", () => {
    expect(Decimal.min(new Decimal(5), 10).toNumber()).toBe(5);
    expect(Decimal.max(new Decimal(5), 10).toNumber()).toBe(10);
  });

  it("represents magnitudes far beyond Number.MAX_VALUE without overflowing to Infinity", () => {
    // 1e1000000 cannot exist as a JS number at all (overflows past ~1.8e308) --
    // this is the entire reason this migration exists. Constructing it from a
    // STRING (not a number literal, which JS itself would parse as Infinity
    // before Decimal ever saw it) proves the type genuinely holds values this large.
    const huge = new Decimal("1e1000000");
    expect(huge.toNumber()).toBe(Infinity); // toNumber() is documented as lossy/plain-double, this is expected
    expect(huge.toString()).not.toBe("Infinity"); // but the Decimal's OWN string form is not collapsed
    expect(huge.exponent).toBeCloseTo(1000000, 0);
  });
});
```

**Step 2: Commit.**

```bash
git add package.json src/lib/game/decimal-smoke.test.ts
git commit -m "build: add break_infinity.js dependency + smoke test"
```

---

### Task 2: `model.ts` — Decimal type migration

**Files:** Modify `src/lib/game/model.ts` (396 lines as of this plan — read it in full first, this task
touches many small, scattered spots, not one contiguous block).

**Step 1:** Add the import at the top of the file:

```ts
import Decimal from "break_infinity.js";
```

**Step 2:** Change these type declarations (exact current lines shown — re-verify against the live file,
since earlier tasks in a DIFFERENT already-merged branch may have shifted these by a line or two, though
none should have touched this file since `model.ts` was last read for this plan):

- `CaptainMissionState.cargo` (line 96): `cargo: Record<LootMaterialKey, number>;` → `cargo: Record<LootMaterialKey, Decimal>;`
- `CaptainState.xp` (line 127): `xp: number;` → `xp: Decimal;` (keep the existing comment, just change the type)
- `GameState.homePlanet` (line 137): `homePlanet: { storage: Record<HomePlanetMaterialKey, number> };` → `homePlanet: { storage: Record<HomePlanetMaterialKey, Decimal> };`
- `GameState.fleetAdminXp` (line 139): `fleetAdminXp: number;` → `fleetAdminXp: Decimal;`
- `RecipeDef.inputs`/`.output.amount` (lines 148-149):
  ```ts
  export interface RecipeDef {
    label: string;
    inputs: Partial<Record<HomePlanetMaterialKey, Decimal>>;
    output: { key: HomePlanetMaterialKey; amount: Decimal };
  }
  ```

**Step 3:** Update the `RECIPES` static table (lines 155-166) to construct `Decimal` literals instead of
plain numbers:

```ts
export const RECIPES: Record<RecipeKey, RecipeDef> = {
  refineUnobtainium: {
    label: "Refine Unobtainium Ore",
    inputs: { commonOre: new Decimal(10) },
    output: { key: "refinedMaterial", amount: new Decimal(1) },
  },
  fabricateComponents: {
    label: "Fabricate Components",
    inputs: { refinedMaterial: new Decimal(5) },
    output: { key: "components", amount: new Decimal(1) },
  },
};
```

**Step 4:** `MISSIONS`'s `extractionRatePerTick`/`cargoCapacity`/`uncommonChance`/`rareChance` (lines
65-88) — **leave these as plain `number`, do NOT touch them.** They're rates/chances/capacities, not
accumulated currency — `extractionRatePerTick` feeds into `rollExtractionTick`'s per-roll math (Task 4)
as a `DecimalSource` argument, same as any other plain-number threshold. Confirm by re-reading
`MissionDef`'s interface (lines 37-57) that none of its fields are in the "goes Decimal" table above —
correct, `MissionDef` has zero Decimal fields; only the STATE that flows through it does.

**Step 5:** `xpForNextLevel`/`xpForNextFleetAdminLevel` (lines 170-192) — **leave these returning plain
`number`, do NOT touch them.** Both take a plain `level: number` and return a plain `number` formula
result. `DecimalSource` accepts plain numbers directly, so `xp.gte(xpForNextLevel(level))` (Task 5) works
with zero changes to these two functions.

**Step 6:** `CaptainTalentDef.cost`/`HomeworldTalentDef.cost` (lines 228, 235) — **leave these as plain
`number`, do NOT touch them.** Confirmed by the design doc's correction: costs are compared against
`statPoints`/`adminPoints`, which stay plain `number`.

**Step 7:** Update `freshCaptainStack()` (lines 353-364) and `freshState()` (lines 385-396) to seed
Decimal fields with `new Decimal(0)`:

```ts
export function freshCaptainStack(): Pick<
  CaptainState,
  "mission" | "xp" | "level" | "statPoints" | "unlockedCaptainTalents"
> {
  return {
    mission: null,
    xp: new Decimal(0),
    level: 1,
    statPoints: 0,
    unlockedCaptainTalents: [],
  };
}
```

```ts
export function freshState(): GameState {
  return {
    captains: freshCaptains(1),
    tickDurationSeconds: 10,
    gameTimeSeconds: 0,
    homePlanet: {
      storage: {
        commonOre: new Decimal(0),
        uncommonMaterial: new Decimal(0),
        rareMaterial: new Decimal(0),
        refinedMaterial: new Decimal(0),
        components: new Decimal(0),
      },
    },
    unlockedHomeworldTalents: [],
    fleetAdminXp: new Decimal(0),
    fleetAdminLevel: 1,
    adminPoints: 0,
  };
}
```

**Step 8: Verify.** Grep the file for every field in the "goes Decimal" table one more time
(`cargo`, `xp:`, `homePlanet`, `fleetAdminXp`, `inputs`, `output`) and confirm each now reads `Decimal`,
not `number`, at its type declaration. Grep for `RECIPES` and confirm both entries construct
`new Decimal(...)` literals, not bare number literals. Confirm `level`, `statPoints`, `adminPoints`,
`fleetAdminLevel`, `xpForNextLevel`, `xpForNextFleetAdminLevel`, `CaptainTalentDef.cost`,
`HomeworldTalentDef.cost` are UNTOUCHED (still plain `number`) — this file should have exactly 2 places
constructing `new Decimal(0)` in `freshCaptainStack`/`freshState`, plus the 4 `new Decimal(...)` literals
in `RECIPES`, and nowhere else should a raw `Decimal` construction appear in this file.

**Step 9: Update `model.test.ts`.** Read the full file first (202 lines). Every existing assertion that
checks a now-Decimal field's value with a plain `toBe(0)`/`toBe(number)` needs to become a `Decimal`-aware
assertion. The pattern: `expect(x).toBe(0)` → `expect(x.equals(0)).toBe(true)` (using `.equals()`, which
accepts a plain-number argument per `DecimalSource` — do not construct a `new Decimal(0)` just to compare,
that's unnecessary noise). Read every existing `it(...)` block touching `freshState()`/`freshCaptains()`/
`freshCaptainStack()`/`RECIPES` and update each one this way. Do NOT change any assertion about `level`,
`statPoints`, `adminPoints`, `fleetAdminLevel`, or talent/homeworld-talent `cost` fields — those stay
exactly as they are today (plain `number`, plain `toBe()`).

**Step 10: Commit.**

```bash
git add src/lib/game/model.ts src/lib/game/model.test.ts
git commit -m "feat: migrate model.ts's currency/resource fields to Decimal"
```

---

### Task 3: `save.ts` — hydration + v11→v12 migration

**Files:** Modify `src/lib/game/save.ts` (342 lines), `src/lib/game/save.test.ts` (820 lines).

**This is one of the two highest-risk tasks in this plan** (the other is Task 5). Read the "Before you
start" section's serialization reasoning again before touching this file — the short version: `toJSON()`
means the WRITE path (`serialize()`) needs zero code changes (JSON.stringify already calls it
automatically on every Decimal it encounters, however deeply nested). The READ path is the one that needs
new code, and it must run **unconditionally**, not just inside a version-keyed migration step, because a
save already at the current `SAVE_VERSION` skips the entire migration loop.

**Step 1:** Add the import:

```ts
import Decimal from "break_infinity.js";
```

**Step 2:** Add a small, idempotent hydration helper near the top of the file, after the imports:

```ts
// Converts a value that MIGHT be a plain number (an old, pre-migration save),
// a string (a current-format save, since JSON.parse never reconstructs class
// instances -- it just leaves whatever toJSON() produced as a plain string),
// or already a live Decimal instance (calling this twice is harmless) into a
// real Decimal. Safe to call unconditionally on any of the three shapes.
function toDecimal(value: Decimal | number | string): Decimal {
  return value instanceof Decimal ? value : new Decimal(value);
}

// Applied UNCONDITIONALLY at the end of migrate(), below -- NOT only inside
// MIGRATIONS[11]. A save already at the current SAVE_VERSION skips the
// migration while-loop entirely (there's no MIGRATIONS[12] to run), so if
// hydration only happened inside a version-keyed step, saves written by the
// CURRENT serialize()/deserialize() (whose Decimal fields round-trip through
// JSON as plain strings, per toJSON()) would never get converted back into
// live Decimal instances -- every .plus()/.gte() call in tick.ts would throw
// at runtime the first time it touched one. Idempotent, so calling it on an
// already-hydrated state (e.g. state built fresh via freshState(), never
// serialized at all) is also safe -- toDecimal() no-ops on an existing Decimal.
function hydrateDecimals(state: any): GameState {
  return {
    ...state,
    captains: state.captains.map((c: any) => ({
      ...c,
      xp: toDecimal(c.xp),
      mission: c.mission
        ? {
            ...c.mission,
            cargo: {
              commonOre: toDecimal(c.mission.cargo.commonOre),
              uncommonMaterial: toDecimal(c.mission.cargo.uncommonMaterial),
              rareMaterial: toDecimal(c.mission.cargo.rareMaterial),
            },
          }
        : c.mission,
    })),
    homePlanet: {
      storage: {
        commonOre: toDecimal(state.homePlanet.storage.commonOre),
        uncommonMaterial: toDecimal(state.homePlanet.storage.uncommonMaterial),
        rareMaterial: toDecimal(state.homePlanet.storage.rareMaterial),
        refinedMaterial: toDecimal(state.homePlanet.storage.refinedMaterial),
        components: toDecimal(state.homePlanet.storage.components),
      },
    },
    fleetAdminXp: toDecimal(state.fleetAdminXp),
  };
}
```

**Step 3:** Bump `SAVE_VERSION` (line 8) from `11` to `12`.

**Step 4:** Add `MIGRATIONS[11]` (v11→v12) to the `MIGRATIONS` table, and extend the file-header comment
block above it (matching every prior migration's documented style — read `MIGRATIONS[10]`'s comment
immediately above the table for the exact tone/format to match):

```ts
// v11 -> v12: Big-Number (Decimal) Migration (docs/plans/2026-07-08-big-
// number-migration-plan.md). homePlanet.storage's 5 keys, each captain's
// mission.cargo (3 keys) and xp, and fleetAdminXp switch from plain number to
// break_infinity.js's Decimal, to support unbounded scale (up to e1,000,000+).
// This migration step itself does no real conversion work -- on a pre-v12
// save, every one of these fields is still a plain JS number at this point in
// the chain (JSON.parse of an OLD save's JSON never produced anything else),
// and migrate()'s hydrateDecimals() call (see below, applied unconditionally
// AFTER this while loop finishes, regardless of which migrations ran) is what
// actually converts them into live Decimal instances. This step exists purely
// so the version-bump/migration-table convention (Ops §8.E.1: bump
// SAVE_VERSION, add a migrate_vN_to_vN+1 entry when the schema changes) has a
// documented marker at the exact version where Decimal fields were
// introduced, for any future reader scanning this table.
```

```ts
11: (state: any): GameState => state, // no-op -- see the comment above; hydrateDecimals() (called unconditionally in migrate(), below) does the real work for both old AND already-current-version saves.
```

**Step 5:** Update `migrate()` (currently lines 264-272) to call `hydrateDecimals()` unconditionally on
its way out, regardless of how many migration steps ran:

```ts
export function migrate(save: SaveFile): GameState {
  let state = save.state;
  let version = save.version;
  while (MIGRATIONS[version]) {
    state = MIGRATIONS[version](state);
    version += 1;
  }
  return hydrateDecimals(state);
}
```

**Step 6: Verify.** Hand-trace both paths:
- **Old save (e.g. a real v9 save)**: `migrate()` runs `MIGRATIONS[9]`, `[10]`, `[11]` in sequence.
  `MIGRATIONS[11]` is a no-op (`state` unchanged, still plain numbers on every Decimal-designated field).
  `hydrateDecimals(state)` then runs once at the end, converting every plain number into
  `new Decimal(number)`. Confirmed: `toDecimal(5)` → `5 instanceof Decimal` is `false` → `new Decimal(5)`.
  Correct.
- **Current-version save (already v12)**: `migrate()`'s while loop finds no `MIGRATIONS[12]`, runs zero
  iterations. `hydrateDecimals(state)` still runs (it's outside the while loop, unconditional). `state`'s
  Decimal-designated fields are whatever `JSON.parse` produced from a `serialize()`-written blob — per
  the smoke test in Task 1, that's a plain STRING (since `toJSON()` fired during `stringify`). Confirmed:
  `toDecimal("5")` → `"5" instanceof Decimal` is `false` → `new Decimal("5")`. Correct.
- **A `GameState` that never went through serialize/deserialize at all** (e.g. `freshState()`'s own
  return value, consumed directly in-memory without ever hitting `localStorage`): never calls `migrate()`
  or `hydrateDecimals()` at all — `freshState()` (Task 2) already constructs real `Decimal` instances
  directly. Confirmed no double-conversion risk, since `hydrateDecimals` is never called on this path.

**Step 7: Update `save.test.ts`.** Read the full file first (820 lines — it already has 11 prior
migration-chain tests you'll be extending the pattern of, plus the `importRawSave` tests added in the
Loot Tier Rework branch). Add:
1. A new test confirming `MIGRATIONS[11]`/hydration converts a hand-written pre-v12 literal (with plain
   `number` values on every Decimal-designated field) into real `Decimal` instances — assert via
   `result.homePlanet.storage.commonOre instanceof Decimal` and `.equals(...)`, not `.toBe(...)` (plain
   `toBe` on a `Decimal` object compares references, which will always fail even for equal values).
2. A test confirming a full `serialize()` → `deserialize()` → `migrate()` round-trip on a `freshState()`
   (already at the current version) produces `Decimal` instances with the SAME values as the original
   (proving the `toJSON()`/hydration pair works end-to-end, not just the migration-table path).
3. Extend the existing "chained v1 -> v11 migration" test (search for that describe block) into a
   "chained v1 -> v12" test, adding an assertion that the final result's Decimal-designated fields are
   real `Decimal` instances with the values the old plain-number chain would have produced.

Do NOT modify any EXISTING migration test's assertions about non-Decimal fields (level, statPoints,
adminPoints, etc.) — those are untouched by this task.

**Step 8: Commit.**

```bash
git add src/lib/game/save.ts src/lib/game/save.test.ts
git commit -m "feat: save.ts v11->v12 migration + unconditional Decimal hydration"
```

---

### Task 4: `tick.ts` — extraction & cargo arithmetic

**Files:** Modify `src/lib/game/tick.ts` (576 lines — read in full, this is the highest-traffic file in
the whole migration).

**Step 1:** Add the import:

```ts
import Decimal from "break_infinity.js";
```

**Step 2:** `emptyLootTotals()` (lines 39-41) — change to return `Decimal` zeros:

```ts
function emptyLootTotals(): Record<LootMaterialKey, Decimal> {
  return { commonOre: new Decimal(0), uncommonMaterial: new Decimal(0), rareMaterial: new Decimal(0) };
}
```

**Step 3:** `rollExtractionTick` (lines 144-174) — this function's `bonuses` parameter (yield/chance
mults) all stay plain `number` (confirmed: talent mults are small percentages, e.g. `0.1`, never
Decimal-scale — they're not in the field-split table at all). Only the RETURN VALUE's shape changes,
since it produces `Record<LootMaterialKey, Decimal>` now instead of `Record<LootMaterialKey, number>`.
Rewrite the arithmetic:

```ts
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
): Record<LootMaterialKey, Decimal> {
  const effectiveUncommonChance = Math.min(1, missionDef.uncommonChance * (1 + bonuses.uncommonChanceMult));
  const effectiveRareChance = Math.min(1, missionDef.rareChance * (1 + bonuses.rareChanceMult));

  let uncommonAmount = new Decimal(0);
  if (rng() < effectiveUncommonChance) {
    const amountRoll = rng();
    const baseAmount = amountRoll < 0.75 ? 1 : amountRoll < 0.95 ? 2 : 3;
    uncommonAmount = new Decimal(baseAmount).times(1 + bonuses.uncommonYieldMult);
  }

  let rareAmount = new Decimal(0);
  if (rng() < effectiveRareChance) {
    rareAmount = new Decimal(1).times(1 + bonuses.rareYieldMult);
  }

  const commonAmount = Decimal.max(0, new Decimal(missionDef.extractionRatePerTick).minus(uncommonAmount).minus(rareAmount)).times(
    1 + bonuses.commonYieldMult
  );

  return { commonOre: commonAmount, uncommonMaterial: uncommonAmount, rareMaterial: rareAmount };
}
```

Hand-trace this against the exact same worked example this function's own tests already use (constant
`rng() = 0`, `shortOreRun`, no bonuses): `effectiveUncommonChance = 0.019`, `0 < 0.019` → true →
`amountRoll = 0` → `0 < 0.75` → `baseAmount = 1` → `uncommonAmount = new Decimal(1).times(1) = 1`.
`effectiveRareChance = 0.001`, `0 < 0.001` → true → `rareAmount = new Decimal(1).times(1) = 1`.
`commonAmount = Decimal.max(0, new Decimal(10).minus(1).minus(1)).times(1) = Decimal.max(0, 8).times(1) = 8`.
Result: `{ commonOre: 8, uncommonMaterial: 1, rareMaterial: 1 }` — matches the design doc's worked example
exactly (byte-identical to what the old plain-number version produced for this same case).

**Step 4:** `tickCaptainMission` (lines 190-317) — the cargo accumulation loop (lines 258-263) changes
from `+=` to `.plus()`:

```ts
      for (let i = 0; i < rollsThisStep; i++) {
        const delta = rollExtractionTick(missionDef, resolvedBonuses, rng);
        mission.cargo.commonOre = mission.cargo.commonOre.plus(delta.commonOre);
        mission.cargo.uncommonMaterial = mission.cargo.uncommonMaterial.plus(delta.uncommonMaterial);
        mission.cargo.rareMaterial = mission.cargo.rareMaterial.plus(delta.rareMaterial);
      }
```

The cycle-completion accumulation into `homePlanetDelta` (lines 283-285) changes from `+=` to `.plus()`:

```ts
        (Object.keys(mission.cargo) as LootMaterialKey[]).forEach((key) => {
          homePlanetDelta[key] = homePlanetDelta[key].plus(mission.cargo[key]);
        });
```

**Do NOT touch** the XP/level-up block (lines 292-297) in this task — that's Task 5's job specifically,
since it also needs the bounded-loop fix. Leave it exactly as-is for now (it will still reference
`captain.xp`, now typed `Decimal`, which means this file won't type-check as a whole until Task 5 lands —
that's expected and fine, since there's no compiler running here to complain mid-task anyway; each task
commits independently and the branch as a whole only needs to be correct once ALL tasks are done, same
as every other multi-file migration this session).

**Step 5: Verify.** Re-read the whole `tickCaptainMission` function once more. Confirm `mission.cargo`'s
initial value (line 212, `{ ...captain.mission.cargo }`) still works unchanged — it's a shallow spread
of an object whose values are now `Decimal` instances, which is fine, no different from spreading an
object of numbers. Confirm the closed-form guarantee is untouched: `resolvedBonuses` (computed once,
lines 226-232) is still plain-number-only (mults, not scaled currency), so nothing about the "computed
once per call" contract changes.

**Step 6: Commit.**

```bash
git add src/lib/game/tick.ts
git commit -m "feat: tick.ts extraction/cargo arithmetic -- Decimal"
```

---

### Task 5: `tick.ts` — XP/leveling arithmetic + bounded level-up loop fix

> **2026-07-08 AMENDMENT — read this before starting Task 5.** The
> `feat/fleet-admiral-xp-rework` branch (`docs/plans/2026-07-08-fleet-admiral-xp-rework-plan.md`) merged
> **before** this migration's implementation began, and it already built two of the three things Step 1
> and Step 3 below describe from scratch. Do not be confused if you find them already present in
> `tick.ts` — that is expected, not a merge conflict to resolve:
>
> - **`MAX_LEVEL_UPS_PER_TICK = 10_000` already exists in `tick.ts`.** It was added by that other plan as
>   a plain-`number` bounded-loop safeguard for `applyFleetAdminXp` (see below), for exactly the same
>   "large offline-catchup delta could otherwise loop unboundedly" reason Step 1 below describes for
>   captain XP. **Reuse the existing constant — do not redefine it a second time.** Its Decimal-migration
>   need is nothing: `levelUpsThisCall < MAX_LEVEL_UPS_PER_TICK` is a plain-number-vs-plain-number
>   comparison in both the captain-XP loop (Step 2) and the Fleet-Admiral loop (see below) — this constant
>   itself never touches a `Decimal` value, so Step 1's constant-definition code block is now a no-op;
>   just confirm the constant is present and skip re-adding it.
> - **`recomputeFleetAdmin` no longer exists anywhere in the codebase.** It was fully replaced (not
>   renamed alongside, not kept as a fallback) by a function with a materially different contract:
>   `applyFleetAdminXp(state: GameState, fleetAdminXpDelta: number): GameState`. Fleet Admiral XP is no
>   longer recomputed fresh each call from the sum of captain levels — it is earned incrementally per
>   completed mission cycle (`MissionDef.fleetAdminXpPerCycle`) and accumulated into a delta that
>   `applyFleetAdminXp` adds to the existing `state.fleetAdminXp`, then resolves level-ups by
>   **subtracting** the threshold each time — the same subtract-and-carry-forward shape captain XP's own
>   loop already uses (Step 2 below), not the old "recompute a running total, never subtract" shape Step 3
>   below was written to describe. Step 3's rewrite of `recomputeFleetAdmin` (and its Step 4 hand-trace)
>   is now **obsolete in its entirety** — there is no `recomputeFleetAdmin` body left to rewrite. See the
>   replacement task below instead.
>
> **Revised Step 3 — make `applyFleetAdminXp` Decimal-aware.** Its bounded-loop *structure* is already
> correct and battle-tested (mirrors the captain-XP loop exactly); this migration's job is ONLY to swap
> its arithmetic operators to `Decimal` methods, per this plan's own rewrite-pattern table above (`a += b`
> → `a = a.plus(b)`, `a -= b` → `a = a.minus(b)`, `a >= b` → `a.gte(b)`). Per the confirmed field-split
> table, `fleetAdminXp` goes `Decimal`; `fleetAdminXpDelta` is a function **parameter**, not a state field,
> and is not in that table at all — it stays a plain `number` (mirrors `XP_PER_MISSION_CYCLE` and the other
> flat per-cycle constants that flow into `.plus()` on the Decimal side without needing to become Decimal
> themselves). Concretely:
>
> | Current (`tick.ts`, plain `number`) | After this migration (`Decimal`) |
> |---|---|
> | `if (fleetAdminXpDelta <= 0) return state;` | unchanged — `fleetAdminXpDelta` stays plain `number`, this is a plain-number comparison |
> | `let xp = state.fleetAdminXp + fleetAdminXpDelta;` | `let xp = state.fleetAdminXp.plus(fleetAdminXpDelta);` |
> | `while (xp >= xpForNextFleetAdminLevel(level) && levelUpsThisCall < MAX_LEVEL_UPS_PER_TICK)` | `while (xp.gte(xpForNextFleetAdminLevel(level)) && levelUpsThisCall < MAX_LEVEL_UPS_PER_TICK)` (second clause unchanged — both sides already plain `number`) |
> | `xp -= xpForNextFleetAdminLevel(level);` | `xp = xp.minus(xpForNextFleetAdminLevel(level));` |
> | `level += 1; adminPoints += 1; levelUpsThisCall += 1;` | unchanged — none of these three are in the field-split table, all stay plain `number` |
> | `return { ...state, fleetAdminXp: xp, fleetAdminLevel: level, adminPoints };` | unchanged shape — `xp` is now a `Decimal` value being assigned into the (now-`Decimal`) `fleetAdminXp` field |
>
> Hand-trace once converted: `state.fleetAdminXp` is `Decimal(2000)`, `fleetAdminXpDelta` is `600` (plain
> number, e.g. summed from `MissionDef.fleetAdminXpPerCycle` across captains this call).
> `state.fleetAdminXp.plus(600)` → `Decimal(2600)`. `xpForNextFleetAdminLevel(1) = 2500` (plain number,
> formula of plain-`number` `level` — unchanged, confirmed in the field-split table). `Decimal(2600).gte(2500)`
> → `true` → loop runs: `level` becomes `2`, `xp = Decimal(2600).minus(2500)` → `Decimal(100)`.
> `xpForNextFleetAdminLevel(2) = 10000`. `Decimal(100).gte(10000)` → `false` → loop stops. Returns
> `fleetAdminXp: Decimal(100)`, `fleetAdminLevel: 2`, `adminPoints: 1` — same result the pre-Decimal
> version already produced for this exact scenario (see that plan's own `applyFleetAdminXp` tests in
> `tick.test.ts`), confirming this rewrite only changed the arithmetic's type, not its behavior.
>
> The rest of this Task 5 (Steps 1, 2, and 4-5 below) is UNCHANGED and still applies as originally
> written for captain XP — only Step 3 (and its Step 4 hand-trace, both about the function formerly named
> `recomputeFleetAdmin`) is superseded by the revised version above.

**Files:** Modify `src/lib/game/tick.ts` (continuing from Task 4's edits).

**This is the other highest-risk task.** Read the design doc's "XP/level-up loop risk" section again
before starting.

**Step 1:** Add the cap constant near the top of the file, alongside the other tuning constants
(`MISSION_TICK_EPSILON`, `XP_PER_MISSION_CYCLE`):

```ts
// Once xp is Decimal-scale, a naive `while (xp >= xpForNextLevel(level))` loop
// could iterate an enormous, unbounded number of times in a single call if a
// huge ticksElapsed (offline catch-up) completes many mission cycles at once
// and xpForNextLevel's linear growth (100 * level) doesn't outpace how large
// xp can get. Capping the loop at a fixed max per call and carrying any
// leftover xp forward (it simply keeps resolving on the NEXT tick() call,
// which happens continuously during live play) is the deliberately simple,
// safe choice -- an alternative closed-form solution (inverting the XP curve
// algebraically via .log10()) was considered and rejected in the design doc:
// log-based inversion on Decimal-scale values is exactly the kind of
// precision-sensitive math most likely to introduce a subtle bug, which cuts
// against this migration's explicit "no mistakes" goal.
const MAX_LEVEL_UPS_PER_TICK = 10_000;
```

**Step 2:** Rewrite the captain XP/level-up block inside `tickCaptainMission` (currently lines 286-297):

```ts
        xp = xp.plus(XP_PER_MISSION_CYCLE);
        let levelUpsThisCall = 0;
        while (xp.gte(xpForNextLevel(level)) && levelUpsThisCall < MAX_LEVEL_UPS_PER_TICK) {
          xp = xp.minus(xpForNextLevel(level));
          level += 1;
          statPoints += 1;
          levelUpsThisCall += 1;
        }
```

Hand-trace: `xp` starts as a `Decimal` (per Task 2/3), `XP_PER_MISSION_CYCLE` is a plain `number` (`50`)
— `xp.plus(50)` works directly (`DecimalSource` accepts plain numbers). `xpForNextLevel(level)` returns a
plain `number` — `xp.gte(plainNumber)` and `xp.minus(plainNumber)` both work directly, no wrapping. `level`
and `statPoints` stay plain `number`, untouched — only `xp` itself changed type. The `levelUpsThisCall`
counter is a plain local `number`, capped by `MAX_LEVEL_UPS_PER_TICK`; if the cap is hit, the `while`
condition's SECOND clause (`levelUpsThisCall < MAX_LEVEL_UPS_PER_TICK`) becomes false and the loop exits
even if `xp.gte(xpForNextLevel(level))` is still true — meaning `xp` can legitimately be left ≥ the next
threshold when this function returns. That's intentional: the NEXT call to `tickCaptainMission`
(whichever cycle completes next) will pick up right where this one left off and keep resolving level-ups,
never losing progress, just spreading it across more calls than an unbounded loop would have.

**Step 3:** Rewrite `recomputeFleetAdmin` (currently lines 328-341) with the same bounded-loop pattern
(Fleet Admiral XP is NOT accumulated incrementally like captain XP — it's recomputed fresh from the sum
of every captain's level each call, per the existing comment above this function; that sum itself is
still a plain-`number` sum of plain-`number` `level`s, so `targetXp`/the comparison against
`state.fleetAdminXp` need care about which side is which type):

```ts
export function recomputeFleetAdmin(state: GameState): GameState {
  const targetXp = state.captains.reduce((sum, c) => sum + c.level, 0); // plain number -- level stays plain
  if (state.fleetAdminXp.equals(targetXp)) return state; // no captain leveled since last check -- same reference

  let xp = new Decimal(targetXp);
  let level = state.fleetAdminLevel;
  let adminPoints = state.adminPoints;
  let levelUpsThisCall = 0;
  while (xp.gte(xpForNextFleetAdminLevel(level)) && levelUpsThisCall < MAX_LEVEL_UPS_PER_TICK) {
    level += 1;
    adminPoints += 1;
    levelUpsThisCall += 1;
  }

  return { ...state, fleetAdminXp: xp, fleetAdminLevel: level, adminPoints };
}
```

Note this function's original body does NOT subtract `xpForNextFleetAdminLevel(level)` from `xp` inside
the loop (unlike the captain XP loop) — re-read the ORIGINAL code above to confirm this asymmetry is
real and intentional (Fleet Admiral XP is a running total, re-derived fresh each call from captain
levels, never "spent down" the way captain XP is) — preserve that exact behavior, don't accidentally
introduce a `.minus()` here that wasn't in the original.

**Step 4: Verify.** Hand-trace `recomputeFleetAdmin` with a concrete example: 1 captain at level 50 →
`targetXp = 50`. `state.fleetAdminXp` (a fresh game) is `Decimal(0)`. `Decimal(0).equals(50)` → `false` →
proceeds. `xp = new Decimal(50)`. `xpForNextFleetAdminLevel(1) = 500 * 1 * 1 = 500`. `50.gte(500)` →
`false` → loop doesn't run at all, `level` stays `1`, `adminPoints` stays `0`. Returns
`{ ...state, fleetAdminXp: new Decimal(50), fleetAdminLevel: 1, adminPoints: 0 }`. Matches the existing
(already-known, pre-migration) balance quirk documented in `model.ts`'s own comment above
`xpForNextFleetAdminLevel` — this migration does not change that balance behavior, only its numeric type.

**Step 5: Commit.**

```bash
git add src/lib/game/tick.ts
git commit -m "feat: tick.ts XP/leveling arithmetic -- Decimal + bounded level-up loop"
```

---

### Task 6: `tick.ts` — recipe crafting & talent-cost boundary

**Files:** Modify `src/lib/game/tick.ts` (continuing from Tasks 4-5).

**This task is specifically about the Decimal/plain-`number` BOUNDARY** — the highest-risk spot for a
type mix-up, per the design doc. Read `craftRecipe`, `buyCaptainTalent`, and `buyHomeworldTalent`
(currently lines 477-575) together before editing anything.

**Step 1:** Rewrite `craftRecipe` (currently lines 477-502). `recipe.inputs[key]` and
`recipe.output.amount` are now `Decimal` (Task 2); `state.homePlanet.storage[key]` is `Decimal` (Task 2);
`bonusOutput` (from `recipeBonusOutput.bonus`) stays plain `number` (confirmed in the "Before you start"
table — flows into `.plus()` on the Decimal side, no wrapping needed):

```ts
export function craftRecipe(state: GameState, recipeKey: RecipeKey): { next: GameState; success: boolean } {
  const recipe = RECIPES[recipeKey];
  for (const key of Object.keys(recipe.inputs) as HomePlanetMaterialKey[]) {
    const needed = recipe.inputs[key] ?? new Decimal(0);
    if (state.homePlanet.storage[key].lt(needed)) return { next: state, success: false };
  }

  const storage = { ...state.homePlanet.storage };
  for (const key of Object.keys(recipe.inputs) as HomePlanetMaterialKey[]) {
    const needed = recipe.inputs[key] ?? new Decimal(0);
    storage[key] = storage[key].minus(needed);
  }

  const bonusOutput = state.unlockedHomeworldTalents.reduce((sum, key) => {
    const effect = HOMEWORLD_TALENTS[key].effect;
    return effect.type === "recipeBonusOutput" && effect.recipeKey === recipeKey ? sum + effect.bonus : sum;
  }, 0); // plain number sum -- effect.bonus stays plain number, unchanged from before this migration

  storage[recipe.output.key] = storage[recipe.output.key].plus(recipe.output.amount).plus(bonusOutput);

  return { next: { ...state, homePlanet: { storage } }, success: true };
}
```

Note the `?? new Decimal(0)` fallback (rather than plain `?? 0`) — `recipe.inputs[key]` is now
`Decimal | undefined` (since `Partial<Record<...>>`), so the fallback must match the Decimal type, not
mix a plain `0` into a variable later used with `.lt()`/`.minus()`.

**Step 2:** `buyCaptainTalent` (currently lines 516-539) and `buyHomeworldTalent` (currently lines
545-575) — **confirm these need ZERO changes.** `talent.cost` stays plain `number` (Task 2, Step 6).
`captain.statPoints`/`state.adminPoints` stay plain `number` (never in the Decimal bucket). Read both
functions' existing comparison/subtraction lines (`captain.statPoints < talent.cost`,
`captain.statPoints - talent.cost`, `state.adminPoints < talent.cost`, `state.adminPoints - talent.cost`)
and confirm every operand on both sides of every one of these lines is plain `number` — if so, leave
these two functions completely untouched, do not edit them in this task. This is the check this task
exists to make explicit and deliberate, not an assumption to skip past.

**Step 3: Verify.** Hand-trace `craftRecipe("refineUnobtainium", ...)` with `state.homePlanet.storage.commonOre = new Decimal(15)`,
no bonus talents unlocked: `needed = new Decimal(10)`. `new Decimal(15).lt(10)` → `false` → proceeds.
`storage.commonOre = new Decimal(15).minus(10) = Decimal(5)`. `bonusOutput = 0` (no talents). `storage.refinedMaterial = Decimal(0).plus(1).plus(0) = Decimal(1)`.
Matches the pre-migration behavior exactly (just Decimal-typed now instead of plain-number).

**Step 4: Commit.**

```bash
git add src/lib/game/tick.ts
git commit -m "feat: tick.ts recipe crafting Decimal boundary -- talent costs confirmed untouched"
```

---

### Task 7: `tick.ts` — `tick()`'s own homePlanet merge + `tick.test.ts` comprehensive updates

**Files:** Modify `src/lib/game/tick.ts` (finishing the file), `src/lib/game/tick.test.ts` (1052 lines).

**Step 1:** `tick()`'s homePlanet merge (currently lines 373-374 inside the `.map()`, and lines 417-419
in the final return) — change `+=`/`+` to `.plus()`:

```ts
    (Object.keys(delta) as LootMaterialKey[]).forEach((key) => {
      homePlanetDelta[key] = homePlanetDelta[key].plus(delta[key]);
    });
```

```ts
      storage: {
        ...state.homePlanet.storage,
        commonOre: state.homePlanet.storage.commonOre.plus(homePlanetDelta.commonOre),
        uncommonMaterial: state.homePlanet.storage.uncommonMaterial.plus(homePlanetDelta.uncommonMaterial),
        rareMaterial: state.homePlanet.storage.rareMaterial.plus(homePlanetDelta.rareMaterial),
      },
```

**Step 2:** The `passiveTrickle` block (currently lines 385-390) — `effect.perTick` stays plain `number`
(confirmed in the field-split table), `ticksElapsed` stays plain `number` — their PRODUCT
(`effect.perTick * ticksElapsed`) is plain-number arithmetic, unchanged, but the accumulation into
`homePlanetDelta` (a `Decimal`) needs `.plus()`:

```ts
  for (const key of state.unlockedHomeworldTalents) {
    const effect = HOMEWORLD_TALENTS[key].effect;
    if (effect.type === "passiveTrickle" && (LOOT_MATERIAL_KEYS as string[]).includes(effect.material)) {
      homePlanetDelta[effect.material as LootMaterialKey] = homePlanetDelta[effect.material as LootMaterialKey].plus(
        effect.perTick * ticksElapsed
      );
    }
  }
```

**Step 3: Verify** `tick.ts` is now fully migrated: grep the ENTIRE file for `+=` and `-=` one more time
and confirm every remaining hit operates only on plain-`number` fields (`level`, `statPoints`,
`adminPoints`, `phaseProgressTicks`, `remaining`, `gameTimeSeconds`, loop counters) — zero hits should
remain on any Decimal-designated field.

**Step 4: Update `tick.test.ts`.** This is the largest test-update task in this plan (1052 lines, many
hand-traced numeric assertions). Read the whole file first. The mechanical pattern, applied throughout:

- Every `expect(x).toBe(someNumber)` where `x` is now a `Decimal` field (mission cargo, homePlanetDelta,
  captain xp, fleetAdminXp, storage) becomes `expect(x.equals(someNumber)).toBe(true)` (NOT `.toBe()` —
  `Decimal` is an object, reference-compared by `toBe`, which will always fail even for equal values).
  Where the existing test used `.toBeCloseTo(n, 6)` for float-drift tolerance, use
  `expect(x.toNumber()).toBeCloseTo(n, 6)` instead (converting to a plain number first, since
  `.toBeCloseTo` needs a plain number operand).
- Every place a test constructs an expected `Record<LootMaterialKey, number>` literal (e.g.
  `{ commonOre: 8, uncommonMaterial: 1, rareMaterial: 1 }`) to compare against a real
  `Record<LootMaterialKey, Decimal>` result via `.toEqual(...)` needs rethinking — `toEqual` does a deep
  structural comparison, and a `Decimal` instance's internal shape (`mantissa`/`exponent`/etc.) will NOT
  structurally equal a plain number literal. Replace these with per-key `.equals()` assertions instead
  (three separate `expect(result.commonOre.equals(8)).toBe(true)` lines rather than one `toEqual` call).
- Every `missionCaptain()`-style test helper that constructs a `CaptainMissionState` with a plain-number
  `cargo` literal (search for `cargo: { commonOre: 0, ...`) needs `new Decimal(0)` (or whatever the
  literal's value is) at each key.
- `freshCaptains(1)[0]`/`freshState()` calls throughout already produce real `Decimal`-typed fields after
  Task 2/3 land — no changes needed to those call sites themselves, only to what's asserted AFTER them.
- The `ALWAYS_MIN_ROLL`/`NOTHING_OCCURS` constant-rng helper functions themselves are untouched (they
  return plain numbers from `rng()`, unrelated to the Decimal migration) — only the assertions checking
  their EFFECTS need updating.
- The `d2391ed`-style `Math.random`-mocking tests (search for `vi.spyOn(Math, "random")`) — re-verify
  their underlying algebraic claim (`total = rate*(1+commonYieldMult) - k*commonYieldMult`) still holds
  with Decimal arithmetic (it does — `.plus()`/`.minus()`/`.times()` are algebraically equivalent to
  `+`/`-`/`*` for finite values, this migration doesn't change the MATH, only the TYPE), then update
  their assertions from `toBeCloseTo(11, 6)` to `.toNumber()`-converted equivalents:
  `expect(totalDelivered.toNumber()).toBeCloseTo(11, 6)` where `totalDelivered` is now built via
  `.plus()` chains instead of `+`.

Do NOT change any assertion about `level`, `statPoints`, `adminPoints`, `phaseProgressTicks`, `phase`, or
talent/homeworld-talent `cost` — none of those are Decimal, none of those tests need touching.

**Step 5: Commit.**

```bash
git add src/lib/game/tick.ts src/lib/game/tick.test.ts
git commit -m "feat: finish tick.ts Decimal migration + comprehensive tick.test.ts updates"
```

---

### Task 8: `format.ts` — Decimal-aware `formatNumber`

**Files:** Modify `src/lib/game/format.ts` (20 lines).

**Critical finding from grounding this plan against the real `App.svelte`**: `formatNumber` is called
with BOTH Decimal-bucket values (resource storage, cargo, xp, recipe amounts) AND plain-number values
that are NOT in the Decimal bucket at all (e.g. `formatNumber(offlineSeconds)` — a time value;
`formatNumber(talent.cost)` — a plain-number cost; `formatNumber(xpForNextFleetAdminLevel(...))` — a
plain-number threshold). **`formatNumber` cannot become Decimal-only** — it must accept
`number | Decimal` and branch, preserving the EXACT existing behavior for plain-number callers (zero
regression risk there) while adding new Decimal-aware logic for the other branch. This keeps "the ONE
number formatting function" contract (Ops §8.E.4) intact — one function, wider input type, not two
competing formatters.

**Step 1:** Add the import and rewrite the function:

```ts
// The ONE number formatting function. Never call .toString() on a game
// number for display anywhere else in the codebase — Ops §8.E.4. If the
// format needs to change later (named tiers, scientific notation threshold,
// etc.) this is the only place that changes.
//
// Accepts EITHER a plain number (time/tick/percentage/cost displays -- these
// never migrated to Decimal, see docs/plans/2026-07-08-big-number-migration-
// plan.md's field-split table) OR a Decimal (resource/currency displays).
// The plain-number branch below is BYTE-IDENTICAL to this function's
// pre-migration body -- zero behavior change for any caller passing a plain
// number, only NEW behavior added for the Decimal branch.

import Decimal from "break_infinity.js";

const TIERS = ["", "K", "M", "B", "T", "Qa", "Qi", "Sx", "Sp", "Oc"];

export function formatNumber(n: number | Decimal): string {
  if (n instanceof Decimal) return formatDecimal(n);

  if (n === null || n === undefined || Number.isNaN(n)) return "0";
  const abs = Math.abs(n);
  if (abs < 1000) return abs < 10 && abs !== 0 ? n.toFixed(2) : Math.floor(n).toString();

  let tier = Math.floor(Math.log10(abs) / 3);
  if (tier >= TIERS.length) return n.toExponential(2);
  tier = Math.min(tier, TIERS.length - 1);

  const scaled = n / Math.pow(10, tier * 3);
  const decimals = scaled < 10 ? 2 : scaled < 100 ? 1 : 0;
  return `${scaled.toFixed(decimals)}${TIERS[tier]}`;
}

// Decimal-aware branch -- mirrors the plain-number logic above exactly (same
// tier table, same <1000/<10 thresholds, same decimals-by-magnitude rule),
// but reads magnitude from the Decimal's OWN mantissa/exponent instead of
// Math.log10 on a raw number, since a Decimal can hold values far beyond what
// Math.log10 could even represent as a finite double (that's the entire
// reason this type exists). break_infinity.js's Decimal has no isNaN()/
// isFinite() method (verified against the library's own .d.ts at plan-writing
// time) -- Number.isNaN(d.mantissa) is the equivalent check, since an invalid
// Decimal would surface as NaN in its own mantissa field.
function formatDecimal(d: Decimal): string {
  if (Number.isNaN(d.mantissa)) return "0";
  if (d.exponent < 3) return formatNumber(d.toNumber()); // small enough to safely round-trip through a plain double -- reuse the exact plain-number branch above, not a duplicate implementation
  if (d.exponent >= TIERS.length * 3) return d.toExponential(2);

  const tier = Math.floor(d.exponent / 3);
  // Math.pow(10, tier*3) (a plain number) is sufficient here, not new Decimal(10).pow(tier*3) --
  // tier*3 never exceeds 27 (TIERS has 10 entries, index 9 * 3 = 27), nowhere near double
  // overflow, and .dividedBy() accepts a plain-number DecimalSource directly.
  const scaled = d.dividedBy(Math.pow(10, tier * 3)).toNumber();
  const decimals = scaled < 10 ? 2 : scaled < 100 ? 1 : 0;
  return `${scaled.toFixed(decimals)}${TIERS[tier]}`;
}
```

(`.pow(value: number | Decimal): Decimal` is confirmed to exist on `Decimal` too, verified directly
against the library's `.d.ts` at plan-writing time — but isn't needed for this specific calculation,
since `Math.pow` on a small plain exponent is simpler and already sufficient here.)

**Step 2: Verify.** Hand-trace `formatDecimal(new Decimal(1234))`: `d.exponent` for `1234` is `3` (since
`1234 = 1.234e3`). `3 < 3` is false, `3 >= 30` is false. `tier = Math.floor(3/3) = 1`. `scaled =
1234 / 1000 = 1.234`. `decimals = 2` (since `1.234 < 10`). Result: `"1.23K"` — matches what the OLD
plain-number `formatNumber(1234)` would have produced (confirm by hand-tracing the original function with
the same input: `abs = 1234`, not `< 1000`, `tier = floor(log10(1234)/3) = floor(3.09/3) = floor(1.03) = 1`,
`scaled = 1234/1000 = 1.234`, `decimals = 2`, result `"1.23K"`) — byte-identical, confirming the Decimal
branch reproduces the exact same formatting rule as the pre-migration plain-number path for a value that
happens to fit in both.

**Step 3:** There is no `format.test.ts` in this codebase today (confirm via `ls src/lib/game/*.test.ts`
before assuming). If one does not exist, create `src/lib/game/format.test.ts` with hand-traced tests for
both branches (plain-number cases matching the function's pre-migration behavior exactly, plus new
Decimal cases including a value far beyond `Number.MAX_VALUE` to prove the whole point of this migration,
e.g. `formatNumber(new Decimal("1e500"))` should NOT throw or return `"Infinity"`).

**Step 4: Commit.**

```bash
git add src/lib/game/format.ts src/lib/game/format.test.ts
git commit -m "feat: Decimal-aware formatNumber, plain-number path byte-identical to before"
```

---

### Task 9: `App.svelte` — live tick loop's local Decimal arithmetic

**Files:** Modify `src/App.svelte` (1871 lines).

**This task is about LOGIC, not display** — the live 100ms tick-poll loop inside `onMount`'s
`setInterval` duplicates `tick.ts`'s own `homePlanetDelta` accumulation and storage-merge logic locally
(it calls `tickCaptainMission` directly per-captain, but re-implements the OUTER accumulation itself,
mirroring `tick()` — this is an existing, deliberate pattern from a prior feature, not something this
migration introduces). Read the whole `setInterval` callback (currently roughly lines 250-420) before
editing.

**Step 1:** Add the import at the top of the `<script>` block:

```ts
import Decimal from "break_infinity.js";
```

**Step 2:** The local `homePlanetDelta` accumulator (currently declared around line 294):

```ts
      const homePlanetDelta: Record<LootMaterialKey, Decimal> = {
        commonOre: new Decimal(0),
        uncommonMaterial: new Decimal(0),
        rareMaterial: new Decimal(0),
      };
```

**Step 3:** The `anyLootDelivered` check + per-captain accumulation (currently around lines 351-356) —
the zero-check (`delta.commonOre !== 0`) needs to become Decimal-aware, and the accumulation switches to
`.plus()`:

```ts
          if (!delta.commonOre.equals(0) || !delta.uncommonMaterial.equals(0) || !delta.rareMaterial.equals(0)) {
            anyLootDelivered = true;
            homePlanetDelta.commonOre = homePlanetDelta.commonOre.plus(delta.commonOre);
            homePlanetDelta.uncommonMaterial = homePlanetDelta.uncommonMaterial.plus(delta.uncommonMaterial);
            homePlanetDelta.rareMaterial = homePlanetDelta.rareMaterial.plus(delta.rareMaterial);
          }
```

**Step 4:** The `passiveTrickle` block inside this same `setInterval` (currently around lines 364-370) —
same pattern as `tick.ts`'s Task 7 Step 2:

```ts
        for (const key of state.unlockedHomeworldTalents) {
          const effect = HOMEWORLD_TALENTS[key].effect;
          if (effect.type === "passiveTrickle" && (LOOT_MATERIAL_KEYS as string[]).includes(effect.material)) {
            anyLootDelivered = true;
            homePlanetDelta[effect.material as LootMaterialKey] = homePlanetDelta[effect.material as LootMaterialKey].plus(
              effect.perTick * ticksElapsed
            );
          }
        }
```

**Step 5:** The `homePlanet.storage` merge (currently around lines 393-403) — same pattern as `tick.ts`'s
Task 7 Step 1:

```ts
        state = {
          ...state,
          homePlanet: {
            storage: {
              ...state.homePlanet.storage,
              commonOre: state.homePlanet.storage.commonOre.plus(homePlanetDelta.commonOre),
              uncommonMaterial: state.homePlanet.storage.uncommonMaterial.plus(homePlanetDelta.uncommonMaterial),
              rareMaterial: state.homePlanet.storage.rareMaterial.plus(homePlanetDelta.rareMaterial),
            },
          },
        };
```

**Step 6: Verify.** Grep this `setInterval` callback specifically (not the whole file yet — display call
sites are Task 10) for any remaining `+=`/`!== 0` pattern touching `homePlanetDelta` or
`state.homePlanet.storage` and confirm none remain. Confirm `recomputeFleetAdmin(...)` (called later in
this same callback, around line 406+ per the earlier grep) needs NO changes here — it's a real function
call into the already-migrated `tick.ts` version (Task 5), not reimplemented locally.

**Step 7: Commit.**

```bash
git add src/App.svelte
git commit -m "feat: App.svelte live tick loop's local Decimal arithmetic"
```

---

### Task 10: `App.svelte` — display call sites

**Files:** Modify `src/App.svelte` (continuing from Task 9).

**This task is purely about `formatNumber(...)` call sites reading now-Decimal fields** — since Task 8
already made `formatNumber` accept `number | Decimal` transparently, MOST of these call sites need
**zero changes at all**. Read through every `formatNumber(...)` call in the file (grep for it) and
categorize each one:

**Confirmed to need NO change** (already Decimal-typed after Tasks 2-9, `formatNumber` accepts it
directly): `formatNumber(state.homePlanet.storage.commonOre)`, `.uncommonMaterial`, `.rareMaterial`
(mission popup and resource panel, several call sites), `formatNumber(state.homePlanet.storage[key])`
(recipe panel), `formatNumber(recipe.output.amount)`, `formatNumber(amount)` (recipe inputs iteration —
confirm `amount`'s inferred type is now `Decimal`, following from `Object.entries(recipe.inputs)`'s cast,
Step 1 below), `formatNumber(activeCaptain.xp)`, `formatNumber(state.fleetAdminXp)`,
`formatNumber(mission.cargo.commonOre)`, `.uncommonMaterial`, `.rareMaterial` (in-progress mission cargo
display).

**Confirmed to need NO change** (stayed plain `number`, `formatNumber`'s plain-number branch handles
these exactly as before): `formatNumber(offlineSeconds)`, `formatNumber(talent.cost)` (both Captain
Talents and Homeworld Talents panels), `formatNumber(state.adminPoints)`,
`formatNumber(activeCaptain.statPoints)`, `formatNumber(xpForNextLevel(activeCaptain.level))`,
`formatNumber(xpForNextFleetAdminLevel(state.fleetAdminLevel))`, `formatNumber(missionDef.cargoCapacity)`,
`formatNumber(missionDef.extractionRatePerTick)` (and its bonus-scaled variant in the popup preview),
`formatNumber(amountPerTick)`-style tick-rate previews.

**Step 1:** The ONE spot needing a real code change: the recipe-inputs type cast (search for
`inputEntries` in the Homeworld crafting panel):

```ts
{@const inputEntries = Object.entries(recipe.inputs) as [HomePlanetMaterialKey, Decimal][]}
```

(was `[HomePlanetMaterialKey, number][]` — change the cast to match `RecipeDef.inputs`'s new Decimal
type from Task 2).

**Step 2: Verify.** Re-read every `formatNumber(...)` call site in the file one more time and confirm
your categorization above is correct against the REAL current file (don't trust this plan's categorization
blindly — re-derive it, since it's exactly the kind of thing worth triple-checking). For each site,
confirm: is the argument's value ultimately sourced from a field in the "goes Decimal" table (Task 2), or
not? That single check determines whether it needs touching, and per Task 8, both cases already work
correctly through the SAME `formatNumber` call with zero per-site code change beyond the one cast above.

**Step 3: Commit.**

```bash
git add src/App.svelte
git commit -m "feat: App.svelte display call sites -- verified Decimal-transparent via formatNumber"
```

---

### Task 11: `App.svelte` — affordability checks + percentage/progress-bar math

**Files:** Modify `src/App.svelte` (continuing from Task 10).

**Step 1:** The recipe-craft affordability check (search for `inputEntries.every`):

```ts
{@const affordable = inputEntries.every(([key, amount]) => state.homePlanet.storage[key].gte(amount))}
```

(was `state.homePlanet.storage[key] >= amount` — `>=` doesn't exist on a `Decimal`, must call `.gte()` on
the Decimal side, with the now-Decimal `amount` as its argument).

**Step 2:** The Homeworld Talents / Captain Talents affordability checks (search for `talent.cost`) —
**confirm these need NO changes**: `state.adminPoints >= talent.cost` and
`activeCaptain.statPoints >= talent.cost` both stay plain-`number`-vs-plain-`number` comparisons (neither
operand is in the Decimal bucket), so the plain `>=` operator is correct and untouched.

**Step 3:** The Fleet Admiral XP progress-bar ratio (currently `$: fleetAdminXpRatio = state.fleetAdminXp / xpForNextFleetAdminLevel(state.fleetAdminLevel);`,
added during the Loot Tier Rework header-redesign follow-up):

```ts
  $: fleetAdminXpRatio = state.fleetAdminXp.dividedBy(xpForNextFleetAdminLevel(state.fleetAdminLevel)).toNumber();
```

The `.toNumber()` conversion happens HERE, once, at the reactive-variable boundary — every downstream
consumer of `fleetAdminXpRatio` (the bar-fill `width:{Math.min(100, fleetAdminXpRatio * 100)}%` style and
the readout `{(fleetAdminXpRatio * 100).toFixed(1)}%`) already expects a plain number and needs NO further
changes, since `fleetAdminXpRatio` is now a plain number by the time it reaches them. A ratio is always in
`[0, ~huge]` range before clamping, but `Math.min(100, ...)` already clamps the DISPLAY width — precision
loss from `.toNumber()` on a percentage-scale ratio is completely acceptable here (this is exactly the
legitimate "drop back to plain number for bounded, display-only math" case the rewrite-pattern table's
`.toNumber()` row exists for).

**Step 4:** The captain XP progress-bar ratio (currently inline:
`(activeCaptain.xp / xpForNextLevel(activeCaptain.level)) * 100` inside the `width:` style binding):

```svelte
{@const activeCaptainXpRatio = activeCaptain.xp.dividedBy(xpForNextLevel(activeCaptain.level)).toNumber()}
```

placed as a new `{@const}` immediately before its first use, then replace both the bar-fill width
expression and the readout percentage expression to reference `activeCaptainXpRatio * 100` instead of
recomputing the division inline — this ALSO fixes a small pre-existing duplication (the same division was
computed twice inline, once for the bar and once for the readout, before this migration) while making the
Decimal conversion happen in exactly one place. Read the surrounding markup carefully first — confirm
whether `activeCaptain` is `{@const}`-available at both usage sites (it should be, given the existing code
already reused it for both), and place the new `{@const}` at a scope that covers both.

**Step 5: Verify.** Grep the whole file one final time for any remaining `<`, `>`, `<=`, `>=`, `+=`, `-=`
operator touching any Decimal-bucket field (`.storage`, `.cargo`, `.xp`, `fleetAdminXp`) — the ENTIRE file
should have zero remaining hits after this task. Also grep for `formatNumber(` one more time and confirm
every call site still makes sense (no site passes a raw un-converted expression that used to rely on `/`
producing a plain number but now would produce a `Decimal` object formatted incorrectly, or vice versa).

**Step 6: Commit.**

```bash
git add src/App.svelte
git commit -m "feat: App.svelte affordability checks + percentage math -- Decimal"
```

---

### Task 12: Docs + session log

**Files:** Modify `SESSION_LOG.md`. Modify `KNOWN_ISSUES.md` only if something genuinely warrants a new
entry.

**Step 1:** Append a new SESSION_LOG.md entry (match the established "Session N — ..." format exactly,
read the 2-3 most recent entries first) summarizing: the motivation (unbounded scale, up to
`e1,000,000+`), the confirmed field split (and the design-time correction that talent/recipe costs stay
plain number), the verified `break_infinity.js` API surface (constructors, arithmetic/comparison methods
all accepting `DecimalSource`, confirmed `toJSON()`), the save.ts hydration approach and WHY it has to be
unconditional (not just inside the v11→v12 migration step), the bounded level-up loop fix
(`MAX_LEVEL_UPS_PER_TICK`) and why a closed-form/log-based alternative was rejected, the
`formatNumber(number | Decimal)` dual-branch approach and why a Decimal-only rewrite would have broken
non-resource callers (time/cost/threshold displays), and the extra verification rigor applied throughout
(re-fetching the library's actual `.d.ts` mid-plan to resolve two real open questions — whether methods
accept plain numbers directly, and whether `toJSON()` exists — rather than assuming).

**Step 2:** Only if something genuinely warrants it — consider whether the `MAX_LEVEL_UPS_PER_TICK` cap
itself deserves a `KNOWN_ISSUES.md` entry (e.g., "if a save's XP ever grows so fast that level-ups can't
fully resolve within one cap's worth of iterations per tick, level display will lag reality by a few ticks
until it catches up — intentional trade-off, not a bug, but worth writing down"). Use judgement; if
nothing warrants a new entry, say so in your task report rather than forcing one.

**Step 3: Commit.**

```bash
git add SESSION_LOG.md KNOWN_ISSUES.md
git commit -m "docs: session log for Big-Number (Decimal) Migration"
```

Do NOT push — origin/main triggers a live Vercel production redeploy; wait for explicit confirmation
before any push, per this project's established practice.

---

## After all tasks: final holistic review

Once all 12 tasks (plus Task 0's worktree setup) are committed and individually reviewed, dispatch one
final holistic review of the WHOLE branch before presenting merge options — same pattern as every other
feature this session. Specifically re-verify, viewing the branch as a whole rather than task-by-task:

1. Grep the ENTIRE `src/` directory (not just files touched by name in this plan) for any remaining
   `+=`/`-=`/bare `<`/`>`/`<=`/`>=` operator touching a Decimal-bucket field, in case some call site was
   missed because it lives in a file this plan didn't anticipate.
2. Confirm `package.json`'s new dependency is the only new dependency added (no accidental duplicate or
   stray `@types` package, since `break_infinity.js` ships its own types).
3. Confirm the full serialize → deserialize → migrate round trip is coherent end-to-end by tracing a
   COMPLETE save/load cycle by hand: `freshState()` (real Decimals) → `saveToLocalStorage` (calls
   `serialize`, which calls `JSON.stringify`, which calls `toJSON()` on each Decimal automatically) →
   `loadFromLocalStorage` (calls `deserialize`/`JSON.parse`, producing strings where Decimals used to be)
   → `migrate()` (hydration converts strings back to Decimals) → the resulting `GameState` has real
   `Decimal` instances with the SAME values as the original `freshState()`.
4. Confirm `MAX_LEVEL_UPS_PER_TICK`'s value (`10_000`) is referenced identically in both places it's used
   (`tickCaptainMission` and `recomputeFleetAdmin`) — it should be ONE constant, not two independently
   duplicated numbers that could drift apart.
