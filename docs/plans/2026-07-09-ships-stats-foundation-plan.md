# Ships — Stats Foundation — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Design doc: `docs/plans/2026-07-09-ships-stats-foundation-design.md` (read it first).

**Goal:** Turn the ship from a field fused onto the captain into a real, separate, stat-bearing entity that intertwines with missions — 4 hull types, exclusive assignment, a minimal Sector Space parking construct, buy-with-credits, and a v15→v16 save migration.

**Architecture:** A static `SHIP_TYPES` table + lightweight `ShipInstance[]` on `GameState` (assignment authority = `ship.assignedCaptainId`). Ship stats apply by feeding a *derived* `effectiveMissionDef` and an extra yield summand into the existing closed-form `tickCaptainMission` — no change to its `while`-loop structure. Every captain always has exactly one assigned ship (invariant enforced in migration, new-game, and new-captain-unlock paths).

**Tech Stack:** Vite + Svelte + TypeScript; `break_infinity.js` `Decimal` for currencies; LZString-compressed localStorage saves with a numbered `MIGRATIONS` chain.

---

## ⚠️ TESTING REALITY — READ BEFORE EXECUTING ANY TASK

**There is NO Node/npm/tsc/vitest on this machine.** Do **NOT** run `npm test`, `npm run *`, `vitest`, `svelte-check`, or any network/tooling command — they don't exist here and will fail or hang. (See KNOWN history: a review agent once hung ~18 min on a network call.)

**How "run the test" works in this plan:** each TDD task still *writes* the failing test first (it's committed for future CI + documents intent), but "verify it fails / passes" means **hand-trace the test against the code by reading it** — arithmetic by hand, control flow by eye. State the trace explicitly in your task summary. The *real* runtime verification is the two **device checkpoints** (Phase 6) on the user's own desktop + Android via a Vercel preview deploy.

**Every executor/reviewer subagent prompt must repeat this constraint** ("static/hand-trace only, no npm/network, keep it bounded").

---

## Phase 1 — Data model (types, table, pure helpers)

*No behavior change yet; nothing consumes these until Phase 3.*

### Task 1: Ship types, `ShipTypeDef`, `ShipInstance`, `SHIP_TYPES`

**Files:**
- Modify: `src/lib/game/model.ts` (add near the `MISSIONS` block, ~line 20 for the type + ~line 112 for the table)
- Test: `src/lib/game/model.test.ts`

**Step 1 — Write the failing test:**
```ts
import { SHIP_TYPES } from "./model";

describe("SHIP_TYPES", () => {
  it("has the 4 real hulls with the designed stat profiles", () => {
    expect(SHIP_TYPES.generalFreighter.cargoCapacity).toBe(90);
    expect(SHIP_TYPES.generalFreighter.transitSpeedMult).toBe(1.0);
    expect(SHIP_TYPES.generalFreighter.extractionYieldMult).toBe(1.0);
    expect(SHIP_TYPES.generalFreighter.moduleSlots).toBe(1);
    expect(SHIP_TYPES.prospectorHauler.cargoCapacity).toBe(180);
    expect(SHIP_TYPES.prospectorRunner.transitSpeedMult).toBe(1.5);
    expect(SHIP_TYPES.prospectorMiner.extractionYieldMult).toBe(1.35);
    // every real hull is tier 1 with 1-2 module slots and a credit cost
    for (const key of Object.keys(SHIP_TYPES) as (keyof typeof SHIP_TYPES)[]) {
      expect(SHIP_TYPES[key].tier).toBe(1);
      expect(SHIP_TYPES[key].cost?.credits).toBeGreaterThan(0);
    }
  });
});
```

**Step 2 — Hand-verify it fails:** `SHIP_TYPES` doesn't exist → import is undefined → reference error. Confirmed fail.

**Step 3 — Implement** (`model.ts`). Add the `ShipType` legacy alias note is untouched; add new declarations:
```ts
export type ShipSpec = "general" | "prospector" | "tactician" | "explorer";

export type ShipTypeKey =
  | "generalFreighter"
  | "prospectorHauler"
  | "prospectorRunner"
  | "prospectorMiner";
// FORWARD BUCKETS (documented in the design doc, NOT built): tactician —
// destroyer/battleship/carrier; explorer — cruiser/surveyor/medical (explorer
// hulls get MORE module slots). Add keys here only when actually built.

export interface ShipTypeDef {
  label: string;
  spec: ShipSpec;
  tier: number;                     // all real hulls = 1 this pass; Research raises later
  cargoCapacity: number;            // drives extraction-phase length (Phase 3)
  transitSpeedMult: number;         // divides transit ticks; >1 faster, <1 slower
  extractionYieldMult: number;      // scales per-extraction-tick loot
  moduleSlots: number;              // POPULATED but INERT this pass (no module system)
  equipmentSlots: number;           // forward bucket; counts finalized with equipment/reactor design
  cost: { credits: number } | null; // null = not purchasable
  description: string;
  // FORWARD (not populated): reactorTier?: number  // reactorTier <= tier; gates equip/module tiers
}

// TUNABLE — first-pass balance; real tuning happens at the device-check stage.
export const SHIP_TYPES: Record<ShipTypeKey, ShipTypeDef> = {
  generalFreighter: {
    label: "General Freighter", spec: "general", tier: 1,
    cargoCapacity: 90, transitSpeedMult: 1.0, extractionYieldMult: 1.0,
    moduleSlots: 1, equipmentSlots: 0, cost: { credits: 25 },
    description: "A no-frills hauler. Every captain's starter and emergency fallback.",
  },
  prospectorHauler: {
    label: "Hauler", spec: "prospector", tier: 1,
    cargoCapacity: 180, transitSpeedMult: 0.8, extractionYieldMult: 1.0,
    moduleSlots: 2, equipmentSlots: 0, cost: { credits: 150 },
    description: "Doubles cargo at the cost of speed — big hauls, longer runs.",
  },
  prospectorRunner: {
    label: "Runner", spec: "prospector", tier: 1,
    cargoCapacity: 60, transitSpeedMult: 1.5, extractionYieldMult: 1.0,
    moduleSlots: 2, equipmentSlots: 0, cost: { credits: 150 },
    description: "Fast transit, small hold — rapid short cycles.",
  },
  prospectorMiner: {
    label: "Prospector", spec: "prospector", tier: 1,
    cargoCapacity: 90, transitSpeedMult: 1.0, extractionYieldMult: 1.35,
    moduleSlots: 2, equipmentSlots: 0, cost: { credits: 150 },
    description: "Specialized extraction rig — more materials per tick.",
  },
};

export interface ShipInstance {
  id: string;                       // stable unique id from GameState.nextShipId
  typeKey: ShipTypeKey;
  assignedCaptainId: number | null; // SINGLE SOURCE OF TRUTH; null = parked/available
  name?: string;                    // player naming deferred
  // FORWARD (not this pass): modules?, equipment?, reactorCore?, tierOverride?
}
```

**Step 4 — Hand-verify it passes:** read the literal values against the assertions. Confirm.

**Step 5 — Commit:**
```bash
git add src/lib/game/model.ts src/lib/game/model.test.ts
git commit -m "feat(ships): add ShipTypeDef, SHIP_TYPES table, ShipInstance"
```

---

### Task 2: `shipDerivedStats` + `effectiveMissionDef` pure helpers

**Files:**
- Modify: `src/lib/game/model.ts` (right after `requiredTicksForPhase`, ~line 144)
- Test: `src/lib/game/model.test.ts`

**Step 1 — Failing test:**
```ts
import { effectiveMissionDef, shipDerivedStats, MISSIONS, SHIP_TYPES } from "./model";

describe("effectiveMissionDef", () => {
  const short = MISSIONS.shortOreRun; // transitOut/Back 25, cargo 90, rate 1

  it("freighter (baseline) leaves the mission unchanged", () => {
    const eff = effectiveMissionDef(short, shipDerivedStats({ id: "s", typeKey: "generalFreighter", assignedCaptainId: null }));
    expect(eff.transitOutTicks).toBe(25);
    expect(eff.transitBackTicks).toBe(25);
    expect(eff.cargoCapacity).toBe(90);
  });

  it("runner (1.5x) shortens transit via ceil, hauler (0.8x) lengthens it", () => {
    const runner = effectiveMissionDef(short, shipDerivedStats({ id: "s", typeKey: "prospectorRunner", assignedCaptainId: null }));
    expect(runner.transitOutTicks).toBe(Math.ceil(25 / 1.5)); // 17
    expect(runner.cargoCapacity).toBe(60);
    const hauler = effectiveMissionDef(short, shipDerivedStats({ id: "s", typeKey: "prospectorHauler", assignedCaptainId: null }));
    expect(hauler.transitOutTicks).toBe(Math.ceil(25 / 0.8)); // 32
    expect(hauler.cargoCapacity).toBe(180);
  });

  it("does not mutate the base mission", () => {
    effectiveMissionDef(short, shipDerivedStats({ id: "s", typeKey: "prospectorHauler", assignedCaptainId: null }));
    expect(MISSIONS.shortOreRun.cargoCapacity).toBe(90);
  });
});
```

**Step 2 — Hand-verify fail:** functions undefined.

**Step 3 — Implement** (`model.ts`):
```ts
export interface ShipDerivedStats {
  cargoCapacity: number;
  transitSpeedMult: number;
  extractionYieldMult: number;
}

export function shipDerivedStats(ship: ShipInstance): ShipDerivedStats {
  const def = SHIP_TYPES[ship.typeKey];
  return {
    cargoCapacity: def.cargoCapacity,
    transitSpeedMult: def.transitSpeedMult,
    extractionYieldMult: def.extractionYieldMult,
  };
}

// Returns a MODIFIED COPY of the base mission with the ship's stats applied.
// transit rescaled by ceil (stays integer + closed-form); cargo drives the
// extraction-phase length (requiredTicksForPhase reads cargoCapacity). Because
// extractionRatePerTick is 1, any integer ship cargo still divides evenly.
export function effectiveMissionDef(base: MissionDef, ship: ShipDerivedStats): MissionDef {
  return {
    ...base,
    transitOutTicks: Math.ceil(base.transitOutTicks / ship.transitSpeedMult),
    transitBackTicks: Math.ceil(base.transitBackTicks / ship.transitSpeedMult),
    cargoCapacity: ship.cargoCapacity,
  };
}
```

**Step 4 — Hand-verify pass:** 25/1.5=16.67→ceil 17 ✓; 25/0.8=31.25→ceil 32 ✓; spread copy doesn't mutate base ✓.

**Step 5 — Commit:**
```bash
git add src/lib/game/model.ts src/lib/game/model.test.ts
git commit -m "feat(ships): add shipDerivedStats + effectiveMissionDef helpers"
```

---

## Phase 2 — GameState fields, seeding, migration

### Task 3: Add `ships` / `shipStorageCapacity` / `nextShipId` to `GameState`; seed in `freshState`; drop `shipType`

**Files:**
- Modify: `src/lib/game/model.ts` — `GameState` (~158), `freshCaptains` (815-826), `freshState` (828-848), remove `CaptainState.shipType` (149)
- Test: `src/lib/game/model.test.ts`

**Step 1 — Failing test:**
```ts
import { freshState } from "./model";

describe("freshState ships seeding", () => {
  it("seeds one General Freighter assigned to the starting captain, capacity 8", () => {
    const s = freshState();
    expect(s.shipStorageCapacity).toBe(8);
    expect(s.ships).toHaveLength(1);
    expect(s.ships[0].typeKey).toBe("generalFreighter");
    expect(s.ships[0].assignedCaptainId).toBe(s.captains[0].id);
    // invariant: every captain has exactly one assigned ship
    for (const c of s.captains) {
      expect(s.ships.filter((sh) => sh.assignedCaptainId === c.id)).toHaveLength(1);
    }
  });
});
```

**Step 2 — Hand-verify fail:** `shipStorageCapacity`/`ships` undefined on freshState output.

**Step 3 — Implement:**
- `CaptainState` (149): **delete** the `shipType: ShipType;` line. (Leave the `export type ShipType = "resourcer"` alias at line 20 in place — historical migrations/tests may still reference the type name; removing the *field* is what matters. Deleting the alias is optional cleanup, out of scope.)
- `GameState` (~167, after `credits`): add
  ```ts
    ships: ShipInstance[];
    shipStorageCapacity: number;
    nextShipId: number;
  ```
- `freshCaptains` (818-823): remove the `shipType: "resourcer",` line so the literal is just `{ id: i, label: ..., ...freshCaptainStack() }`.
- `freshState` (return object): add
  ```ts
    ships: [{ id: "ship-1", typeKey: "generalFreighter", assignedCaptainId: 1 }],
    shipStorageCapacity: 8,
    nextShipId: 2,
  ```
  (freshCaptains(1) makes captain id 1, so the seeded freighter binds to id 1.)

**Step 4 — Hand-verify pass:** freshState now returns ships length 1, capacity 8, assigned to id 1 ✓. Confirm no other file references `captain.shipType` for reads (grep in Task 3 verification — `tick()` and the unlock literal are handled in Tasks 6/7/10; the MIGRATIONS[4] literal is `: CaptainState`-annotated but already non-conformant and the build doesn't type-check, so it's runtime/deploy-safe — Task 4 Step 3b relaxes its annotation to clear the diagnostic).

**Step 5 — Commit:**
```bash
git add src/lib/game/model.ts src/lib/game/model.test.ts
git commit -m "feat(ships): add ships/capacity/nextShipId to GameState; seed freshState; drop CaptainState.shipType"
```

---

### Task 4: Save migration v15 → v16

**Files:**
- Modify: `src/lib/game/save.ts` — `SAVE_VERSION` (9), add `MIGRATIONS[15]` (after entry 14, before the closing brace at ~448)
- Test: `src/lib/game/save.test.ts`

**Step 1 — Failing test:**
```ts
import { migrate } from "./save"; // or whatever the existing test imports; match the file's convention

describe("v15 -> v16 ships migration", () => {
  it("grandfathers one Freighter per captain, adds capacity 8, strips shipType", () => {
    const v15: any = {
      version: 15,
      captains: [
        { id: 1, label: "Captain 1", shipType: "resourcer", mission: null },
        { id: 2, label: "Captain 2", shipType: "resourcer", mission: null },
      ],
      // ...other v15 fields elided; migration must pass them through untouched
    };
    const out: any = MIGRATIONS[15](v15);
    expect(out.ships).toHaveLength(2);
    expect(out.ships.every((s: any) => s.typeKey === "generalFreighter")).toBe(true);
    expect(out.ships.map((s: any) => s.assignedCaptainId).sort()).toEqual([1, 2]);
    expect(out.shipStorageCapacity).toBe(8);
    expect(out.nextShipId).toBe(3);
    expect(out.captains.every((c: any) => !("shipType" in c))).toBe(true);
  });
});
```
*(If `MIGRATIONS` isn't exported, mirror the existing save.test.ts pattern — it already tests migrations somehow; match that access path rather than inventing one.)*

**Step 2 — Hand-verify fail:** `MIGRATIONS[15]` doesn't exist → `undefined is not a function`.

**Step 3 — Implement:**
- `SAVE_VERSION = 16;`
- Add to `MIGRATIONS`:
```ts
  // v15 -> v16: Ships stats foundation. Captain/ship separation — every existing
  // captain is grandfathered a General Freighter (== today's implicit ship:
  // cargo 90 / 1.0x / 1.0x, so in-flight missions are unaffected). shipType is
  // dropped from captains. Frozen once shipped (never edit this body).
  15: (state: any): any => {
    let nextShipId = 1;
    const ships = (state.captains ?? []).map((c: any) => ({
      id: `ship-${nextShipId++}`,
      typeKey: "generalFreighter",
      assignedCaptainId: c.id,
    }));
    const captains = (state.captains ?? []).map(({ shipType, ...rest }: any) => rest);
    return { ...state, captains, ships, shipStorageCapacity: 8, nextShipId };
  },
```

**Step 3b — Relax the `MIGRATIONS[4]` annotation (type-only, behavior-identical):** its inner
`const captainOne: CaptainState = {…}` (save.ts ~285) is annotated `: CaptainState` but has ALREADY
diverged from that interface (it carries pre-Phase-4 fields `resources`/`modules`/`research`/
`specialization`/etc. and omits current required ones) — so it does not type-check against
`CaptainState` today, independent of our change. Removing `shipType` from `CaptainState` just adds one
more orphan property there. Change the annotation to `const captainOne: any = {…}` — leave the object
body 100% unchanged (TS types are erased at build; runtime behavior is identical, so this respects the
frozen-migration rule, which protects behavior, not annotations). Add a one-line comment: `// historical
shape — predates the current CaptainState; typed loose so this frozen body isn't coupled to the live
interface.`

**Step 4 — Hand-verify pass:** 2 captains → 2 freighters (ids ship-1/ship-2, assigned 1/2), nextShipId ends at 3, capacity 8, `shipType` destructured out ✓. `MIGRATIONS[4]`'s body is unchanged; only its annotation is relaxed to `any` (Step 3b), so `npm run check` no longer flags the orphan `shipType` (nor the pre-existing divergences) on that literal ✓. NOTE (corrects an earlier premise): the *inner* literal is `: CaptainState`-annotated, NOT `any` — only the outer `Migration` type is `(state:any)=>any`. Removal is still deploy-safe because the production build is `vite build` (esbuild, no type-check) with no CI; the `check` script is separate.

**Step 5 — Commit:**
```bash
git add src/lib/game/save.ts src/lib/game/save.test.ts
git commit -m "feat(ships): add v15->v16 migration grandfathering a Freighter per captain"
```

---

### Task 5: Verify save serialize/deserialize round-trips the new fields

**Files:**
- Read first: all of `src/lib/game/save.ts` (find `serialize`/`deserialize` or equivalent)
- Modify: `src/lib/game/save.ts` only if it does explicit field-by-field (de)serialization
- Test: `src/lib/game/save.test.ts`

**Context:** `ShipInstance`/`shipStorageCapacity`/`nextShipId` contain **no `Decimal`**, so they are plain-JSON-safe. IF save uses a generic JSON pass-through, they round-trip for free. IF it reconstructs `GameState` field-by-field (like it revives `Decimal`s for credits/xp/storage), the new fields must be added to that path or they'll be dropped on load.

**Step 1 — Failing test:** serialize a `freshState()` (which now has ships), deserialize, assert `ships`/`shipStorageCapacity`/`nextShipId` survive intact.

**Step 2 — Hand-verify:** read the (de)serialize code; determine pass-through vs explicit. If explicit and missing the fields, the test "fails" (fields dropped) by trace.

**Step 3 — Implement:** add the three fields to the explicit (de)serialize path if needed; otherwise no code change (note that in the commit).

**Step 4 — Hand-verify pass.**

**Step 5 — Commit:**
```bash
git add src/lib/game/save.ts src/lib/game/save.test.ts
git commit -m "test(ships): confirm ships fields round-trip through save (+ wire if explicit)"
```

---

## Phase 3 — Mission math wiring (closed-form sensitive)

> Use superpowers:test-driven-development rigor here — this is the highest-risk area. The existing closed-form test in `tick.test.ts` (the "big jump equals many small ticks" test, ~line 60) is the template.

### Task 6: Thread ship stats into `tickCaptainMission`

**Files:**
- Modify: `src/lib/game/tick.ts` — `tickCaptainMission` signature (403), `missionDef` resolution (438), `resolvedBonuses` (464-473)
- Test: `src/lib/game/tick.test.ts`

**Step 1 — Failing tests:**
```ts
import { shipDerivedStats } from "./model";
const HAULER = shipDerivedStats({ id: "h", typeKey: "prospectorHauler", assignedCaptainId: null }); // cargo 180, transit 0.8
const RUNNER = shipDerivedStats({ id: "r", typeKey: "prospectorRunner", assignedCaptainId: null }); // cargo 60, transit 1.5
const MINER  = shipDerivedStats({ id: "m", typeKey: "prospectorMiner",  assignedCaptainId: null }); // yield 1.35

describe("tickCaptainMission with ship stats", () => {
  it("omitting the 5th arg behaves exactly as before (freighter-equivalent)", () => {
    const base = freshCaptains(1)[0]; // give it a mission via the existing test helper pattern
    // ... start a shortOreRun mission on `base` the same way existing tests do ...
    const withNull = tickCaptainMission(50, startedCaptain, ALWAYS_MIN_ROLL, {}, null);
    const without  = tickCaptainMission(50, startedCaptain, ALWAYS_MIN_ROLL, {});
    expect(withNull).toEqual(without);
  });

  it("STAYS CLOSED-FORM with a hauler: one big call == many small calls", () => {
    // mirror the existing closed-form test but pass HAULER as the 5th arg on
    // BOTH the single-big-call and the loop-of-small-calls paths.
    // Assert final cargo + phase + xp match between the two.
  });

  it("miner (1.35x) increases the deterministic per-tick common yield by +0.35", () => {
    // ALWAYS_MIN_ROLL => common wins every tick; compare a single extracting
    // tick's commonOre delta with MINER vs null; expect the MINER delta to be
    // baseAmount * 1.35 vs baseAmount * 1.0.
  });
});
```

**Step 2 — Hand-verify fail:** 5th param doesn't exist yet; yield unaffected.

**Step 3 — Implement** (`tick.ts`):
- Signature (403): add a 5th param
  ```ts
  export function tickCaptainMission(
    ticksElapsed: number,
    captain: CaptainState,
    rng: () => number = Math.random,
    bonuses: { /* existing */ } = {},
    shipStats: ShipDerivedStats | null = null,   // NEW — null = no ship modifier (== freighter baseline)
  ) { ... }
  ```
- `missionDef` (438):
  ```ts
  const rawMissionDef = MISSIONS[captain.mission.missionKey];
  const missionDef = shipStats ? effectiveMissionDef(rawMissionDef, shipStats) : rawMissionDef;
  ```
- `resolvedBonuses` (464-473): fold the ship's yield into all three tiers
  ```ts
  const shipYieldBonus = shipStats ? shipStats.extractionYieldMult - 1 : 0; // 1.35x -> +0.35
  const resolvedBonuses = {
    commonYieldMult:   (bonuses.commonYieldMult   ?? 0) + shipYieldBonus,
    uncommonYieldMult: (bonuses.uncommonYieldMult ?? 0) + shipYieldBonus,
    uncommonChanceMult: bonuses.uncommonChanceMult ?? 0,
    rareYieldMult:     (bonuses.rareYieldMult     ?? 0) + shipYieldBonus,
    rareChanceMult:     bonuses.rareChanceMult    ?? 0,
    bonusRollChance:    bonuses.bonusRollChance    ?? 0,
    bonusRollChanceMult: bonuses.bonusRollChanceMult ?? 0,
    specBonusRollChance: bonuses.specBonusRollChance ?? 0,
  };
  ```
  Import `effectiveMissionDef`, `ShipDerivedStats` from `./model`.

**Step 4 — Hand-verify pass:** null path is byte-identical (shipYieldBonus 0, missionDef unchanged) → existing tests + the "omit 5th arg" test pass. Closed-form: `shipStats` is constant across the whole call (same as `bonuses`), and `effectiveMissionDef` is computed once before the loop, so the "one big jump == many small ticks" invariant is preserved by the exact same reasoning the header comment already gives. Hand-trace one hauler cycle both ways to confirm.

**Step 5 — Commit:**
```bash
git add src/lib/game/tick.ts src/lib/game/tick.test.ts
git commit -m "feat(ships): thread ship stats (transit/cargo/yield) into tickCaptainMission, closed-form preserved"
```

---

### Task 7: Resolve each captain's ship in the `tick()` fleet loop

**Files:**
- Modify: `src/lib/game/tick.ts` — `tick()` captain `.map` (666-691)
- Test: `src/lib/game/tick.test.ts`

**Step 1 — Failing test:** build a `freshState()`, put its captain on a `shortOreRun`, replace the captain's assigned ship with a Runner (`prospectorRunner`), call `tick(bigSeconds, state)`, and assert the mission advanced *faster* (fewer transit ticks consumed for the same elapsed) than with the seeded Freighter. (Compare two states: one Freighter-assigned, one Runner-assigned, same elapsed → Runner is further along / completes more cycles.)

**Step 2 — Hand-verify fail:** `tick()` doesn't look up ships yet → both behave identically.

**Step 3 — Implement** (`tick.ts`, inside the `.map` at 666):
```ts
  const captains = state.captains.map((captain) => {
    if (captain.mission === null) return captain;
    const ship = state.ships.find((s) => s.assignedCaptainId === captain.id);
    const shipStats = ship ? shipDerivedStats(ship) : null; // invariant: always found; null-guard is defensive
    const bonuses = { /* unchanged */ };
    const { captain: updated, homePlanetDelta: delta, fleetAdminXpDelta: cX, creditsDelta: cC } =
      tickCaptainMission(ticksElapsed, captain, Math.random, bonuses, shipStats); // 5th arg
    /* unchanged accumulation */
    return updated;
  });
```
Import `shipDerivedStats` from `./model`.

**Step 4 — Hand-verify pass:** Runner transit 25→17 each way → shorter cycle → more progress per elapsed ✓.

**Step 5 — Commit:**
```bash
git add src/lib/game/tick.ts src/lib/game/tick.test.ts
git commit -m "feat(ships): tick() applies each captain's assigned-ship stats to their mission"
```

---

## Phase 4 — Ship actions (assignment, purchase, new-captain seeding)

### Task 8: `assignShipToCaptain` (atomic swap, on-mission lock)

**Files:**
- Modify: `src/lib/game/tick.ts` (add near the other action fns, e.g. after `recallCaptain`)
- Test: `src/lib/game/tick.test.ts`

**Step 1 — Failing tests:**
```ts
describe("assignShipToCaptain", () => {
  it("assigns a parked ship and parks the captain's previous ship (atomic swap)", () => { /* ... */ });
  it("reassigning the captain's CURRENT ship is a harmless no-op (keeps it assigned)", () => { /* ordering guard */ });
  it("fails (same state ref) if the captain is on a mission", () => { /* ... */ });
  it("fails if the ship is already assigned to a DIFFERENT captain", () => { /* ... */ });
});
```

**Step 2 — Hand-verify fail:** function undefined.

**Step 3 — Implement:**
```ts
// Atomic swap: a captain always ends with exactly one assigned ship. Blocked
// while the captain is on a mission (keeps effectiveMissionDef stable per cycle
// — the closed-form guarantee). Fails with the SAME state ref, same convention
// as the other buy/action functions in this file.
export function assignShipToCaptain(
  state: GameState, captainId: number, shipId: string,
): { next: GameState; success: boolean } {
  const captain = state.captains.find((c) => c.id === captainId);
  const ship = state.ships.find((s) => s.id === shipId);
  if (!captain || !ship) return { next: state, success: false };
  if (captain.mission !== null) return { next: state, success: false };
  if (ship.assignedCaptainId !== null && ship.assignedCaptainId !== captainId) {
    return { next: state, success: false };
  }
  // ORDER MATTERS: assign the target FIRST, then park a *different* old ship,
  // so reassigning the captain's own ship doesn't park-then-drop it.
  const ships = state.ships.map((s) => {
    if (s.id === shipId) return { ...s, assignedCaptainId: captainId };
    if (s.assignedCaptainId === captainId) return { ...s, assignedCaptainId: null };
    return s;
  });
  return { next: { ...state, ships }, success: true };
}
```

**Step 4 — Hand-verify pass:** trace the no-op case (shipId === current) — first branch reassigns to self, second branch skips it → still assigned ✓.

**Step 5 — Commit:**
```bash
git add src/lib/game/tick.ts src/lib/game/tick.test.ts
git commit -m "feat(ships): add assignShipToCaptain (atomic swap, on-mission lock)"
```

---

### Task 9: `buyShip` (credits + capacity cap)

**Files:**
- Modify: `src/lib/game/tick.ts`
- Test: `src/lib/game/tick.test.ts`

**Step 1 — Failing tests:** buys when affordable + under cap (credits deducted, ship added parked, `nextShipId` bumped); fails (same ref) when at capacity; fails when credits < cost; fails for a `cost: null` type.

**Step 2 — Hand-verify fail:** undefined.

**Step 3 — Implement:**
```ts
export function buyShip(
  state: GameState, typeKey: ShipTypeKey,
): { next: GameState; success: boolean } {
  const def = SHIP_TYPES[typeKey];
  if (!def.cost) return { next: state, success: false };
  if (state.ships.length >= state.shipStorageCapacity) return { next: state, success: false };
  if (state.credits.lt(def.cost.credits)) return { next: state, success: false };
  const ship: ShipInstance = { id: `ship-${state.nextShipId}`, typeKey, assignedCaptainId: null };
  return {
    next: {
      ...state,
      credits: state.credits.minus(def.cost.credits),
      ships: [...state.ships, ship],
      nextShipId: state.nextShipId + 1,
    },
    success: true,
  };
}
```
Import `SHIP_TYPES`, `ShipTypeKey`, `ShipInstance` from `./model`.

**Step 4 — Hand-verify pass:** `Decimal.lt`/`.minus` are correct break_infinity methods (credits is `Decimal`) ✓.

**Step 5 — Commit:**
```bash
git add src/lib/game/tick.ts src/lib/game/tick.test.ts
git commit -m "feat(ships): add buyShip (credits cost + storage-capacity cap)"
```

---

### Task 10: New-captain unlock also grants + assigns a Freighter

**Files:**
- Modify: `src/lib/game/tick.ts` — `unlockCaptainSlot` branch (907-912)
- Test: `src/lib/game/tick.test.ts`

**Step 1 — Failing test:** drive the `unlockCaptainSlot` path (buy the Homeworld talent with enough adminPoints), assert the new captain exists AND a Freighter with `assignedCaptainId === newCaptainId` was added, and `nextShipId` bumped. Assert the always-has-a-ship invariant across all captains.

**Step 2 — Hand-verify fail:** currently only pushes a captain (with a stale `shipType` literal), no ship.

**Step 3 — Implement** (replace 907-911):
```ts
    const nextId = state.captains.length + 1;
    const captains = [
      ...state.captains,
      { id: nextId, label: `Captain ${nextId}`, ...freshCaptainStack() }, // shipType removed
    ];
    const ships = [
      ...state.ships,
      { id: `ship-${state.nextShipId}`, typeKey: "generalFreighter" as const, assignedCaptainId: nextId },
    ];
    return {
      next: { ...state, captains, ships, nextShipId: state.nextShipId + 1, adminPoints, unlockedHomeworldTalents },
      success: true,
    };
```

**Step 4 — Hand-verify pass:** new captain + bound freighter, invariant holds ✓. (Note: granted regardless of `shipStorageCapacity` — a captain must always have a hull; cap 8 > 4 max captains today.)

**Step 5 — Commit:**
```bash
git add src/lib/game/tick.ts src/lib/game/tick.test.ts
git commit -m "feat(ships): unlockCaptainSlot grants + assigns a Freighter (always-has-a-ship invariant)"
```

---

## Phase 5 — Sector Space minimal UI

> 🎨 **HARD GATE — MOCKUP FIRST.** Do NOT start Phase 5 until the user provides a rough layout mockup/sketch for the Sector Space ship construct. Ship management is spatial/layout-heavy and the talent-tree history shows text-only guesses miss intent. Phases 1–4 (all logic) can complete without it; the executor must STOP and request the mockup before this phase.

### Task 11: Open the Sector Space tab with the ship-management construct

**Files:**
- Read first: `src/App.svelte` (find the existing Sector Space "Coming Soon" placeholder + the tab/SubTabs system), `src/lib/SubTabs.svelte`
- Modify: `src/App.svelte`
- Verify: device checkpoint (no unit test for Svelte markup here)

**Behavioral spec (exact layout per the user's mockup):**
- Replace the Sector Space "Coming Soon" placeholder with a **ship-management panel**; keep any *other* Sector Space sub-tabs locked.
- **Ship list:** each owned ship shows type label, the 3 stats (cargo / transit / yield), its module slots rendered as **empty/inert** pips (with a "modules coming with Research" affordance), and assignment (captain name or "Parked").
- **Assign/swap control** per captain (or per ship) calling `assignShipToCaptain`; disabled with a reason tooltip when that captain `mission !== null` ("Recall to change ship").
- **Capacity readout:** `owned / shipStorageCapacity`.
- **Buy panel:** the Freighter + 3 Prospector hulls with their credit costs, calling `buyShip`; each disabled (with reason) when unaffordable or at cap.
- Reuse existing idioms: `Panel.svelte`, theme tokens, `SubTabs.svelte`, the currency-chip/tooltip patterns already in the header.

**Steps:** implement to the mockup → device checkpoint A (below) is the verification → commit `feat(ships): Sector Space ship-management construct (list, assign, buy, capacity)`.

---

## Phase 6 — Docs, version bump, checkpoints, review

### Task 12: Docs + APP_VERSION/PATCH_NOTES

**Files:**
- `KNOWN_ISSUES.md` — add: modules/equipment/reactor slots are displayed but **inert** this pass (no module system); ship equipment/reactor pending Research.
- `SUGGESTIONS.md` — add: **ship salvage (~60% materials back) / sell-for-credits**; **capacity growth via Sector Space upgrades (target ~50–100)**; **`minCargoRequired` mission-gate field**; the 6 Tactician/Explorer hull buckets (Explorer hulls get more module slots).
- `SESSION_LOG.md` — append a new session entry (per convention; last entry is Session 25 — bring it current, noting the interim talent-reset-row + currency-indicator merges).
- `PATCH_NOTES` + `APP_VERSION` — bump (currency work shipped 0.3.0; this is a feature → 0.4.0). Find these where the Radial Web bumped them.

**Commit:** `docs(ships): KNOWN_ISSUES/SUGGESTIONS/SESSION_LOG/PATCH_NOTES for ships foundation`.

### Task 13: Device Checkpoint A (structure/interaction)
On the user's desktop + Android via a Vercel preview of this branch: Sector Space renders; ship list + stats show; assign/swap works and is blocked on-mission; dispatch uses the assigned ship. Fix any mobile-only issues in-branch (per the Radial Web precedent). Commit fixes individually.

### Task 14: Device Checkpoint B (economy/migration on a real save)
Buy a Prospector hull with credits → assign → run a mission → **see** the stat effect (faster cycle / bigger haul / more yield). Load a **real pre-existing save** and confirm it migrates cleanly (each captain has a Freighter, nothing lost, in-flight mission uninterrupted). Fix in-branch; commit individually.

### Task 15: Final holistic review + merge
Dispatch a whole-branch holistic review (cross-task integration, closed-form integrity, invariant enforcement across migration/new-game/unlock, save round-trip) — **static/hand-trace only, no npm/network**. Apply small doc/comment fixes directly; re-dispatch a task if something substantive is found. Then merge locally into `main` and clean up the worktree/branch. **Do NOT push to origin/main without fresh explicit user confirmation** (triggers a live Vercel production redeploy).

---

## Execution notes / open items carried from design
- Exact `tickCaptainMission` wiring is specified above (5th param, null-safe).
- Ship-id scheme: monotonic `GameState.nextShipId` → `ship-${n}` (robust to future ship deletion; length-based ids are not).
- The migration "minefield" (removing `shipType`) is deploy-safe, but the earlier premise was imprecise: the outer `type Migration = (state:any)=>any`, but `MIGRATIONS[4]`'s *inner* `captainOne` literal is `: CaptainState`-annotated. That literal ALREADY diverges from `CaptainState` (pre-Phase-4 fields present, current ones missing), so it doesn't type-check today regardless — and the production build is `vite build` (esbuild, no type-check) with no CI, so runtime/deploy are unaffected. Task 4 Step 3b relaxes that one annotation to `any` (type-only, body unchanged) to clear the `npm run check` diagnostic. Found by the Task-3 code-quality review.
- All `TUNABLE` numbers (stat profiles, prices, capacity 8) are first-pass; balance is a device-check concern.
- Task 5 may be a no-op if save (de)serialization is generic JSON pass-through — confirm by reading, don't assume.
```
