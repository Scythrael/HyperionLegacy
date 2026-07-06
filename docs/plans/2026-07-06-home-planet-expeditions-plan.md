# Home Planet & Mission Expeditions (Phase 3a) Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a Home Planet storage entity and a general, data-driven mission engine — a captain can
be dispatched on a round-trip expedition (order → transit out → extract cargo → transit back →
unload), auto-repeating until recalled, with loot landing in a new fleet-wide storage pool separate
from any captain's own economy.

**Architecture:** A `MISSIONS` lookup (mirroring `SKILL_TREE`'s "generic engine, small launch
content" shape) drives a per-captain mission state machine (`CaptainState.mission`). The
advancement algorithm (`tickCaptainMission`) generalizes this codebase's existing "accumulate a
continuous quantity, clamp/complete at a threshold" pattern (already used for research progress) to
a SEQUENCE of thresholds (5 phases) that wraps back to the start on completion unless recalled — a
`while` loop that fully resolves however many phase transitions and loot rolls a single call's
`ticksElapsed` represents, which is what makes it closed-form regardless of how the caller chunks
time. A captain on a mission has their normal Generator Stack production paused entirely.

**Tech Stack:** Svelte 5 (existing non-runes style), TypeScript, Vitest. No new dependencies.

**Design doc:** `docs/plans/2026-07-06-home-planet-expeditions-design.md` — read this first if
anything below is ambiguous. Note: the design doc says a completed mission returns a captain to
idle; this was superseded by a follow-up decision (auto-repeat until recalled) captured in this
plan instead — this plan's behavior is the authoritative one.

**A note on testing:** Node.js/npm is unavailable in this environment — no dev server, no build, no
test runner. Every task follows this session's established TDD pattern: write the test, manually
trace by hand whether it would pass or fail given the code as written, then implement, then
re-trace.

**Risk note:** Task 2 (the mission advancement algorithm) is the single highest-risk task in this
plan — higher than any prior phase's riskiest task, because this is a genuinely NEW kind of logic
(a discrete, multi-phase, wrap-around state machine), not a generalization of existing logic like
every prior "highest risk" task this session has been. Read it multiple times before touching code.
Do not skip its manual-trace steps.

---

### Task 1: Data model (`model.ts`)

**Files:**
- Modify: `src/lib/game/model.ts`
- Modify: `src/lib/game/model.test.ts`

**Context:** Read the current `src/lib/game/model.ts` in full — `CaptainState`/`GameState`/
`freshCaptainStack`/`freshCaptains`/`freshState` have all evolved across 3 phases now; don't rely on
any paraphrase.

**Step 1: Write the failing tests**

Add to the top of `src/lib/game/model.test.ts`'s import list:

```ts
import {
  freshState,
  freshCaptains,
  freshCaptainStack,
  isModuleUnlocked,
  isResourceUnlocked,
  captainMultiplier,
  specializationMultiplier,
  fleetLifetimeComponents,
  captainSlotCount,
  researchDurationMult,
  requiredTicksForPhase,
  rollLootTable,
  SPECIALIZATIONS,
  SKILL_TREE,
  MISSIONS,
} from "./model";
```

Add these new tests (append to the file; do not touch any existing describe block):

```ts
describe("freshState / freshCaptainStack — mission and Home Planet fields", () => {
  it("a fresh captain starts with no active mission", () => {
    const captain = freshCaptains(1)[0];
    expect(captain.mission).toBe(null);
  });

  it("freshState's homePlanet storage starts at 0 for every material", () => {
    const state = freshState();
    expect(state.homePlanet.storage).toEqual({ commonOre: 0, uncommonMaterial: 0, rareMaterial: 0 });
  });

  it("freshCaptainStack resets mission to null (both prestige tiers cancel an active mission)", () => {
    expect(freshCaptainStack().mission).toBe(null);
  });
});

describe("MISSIONS — launch set", () => {
  it("has exactly 2 missions with the specified tick counts and cargo/extraction values", () => {
    expect(MISSIONS.shortOreRun.transitOutTicks).toBe(3);
    expect(MISSIONS.shortOreRun.transitBackTicks).toBe(3);
    expect(MISSIONS.shortOreRun.unloadTicks).toBe(1);
    expect(MISSIONS.shortOreRun.extractionRatePerTick).toBe(10);
    expect(MISSIONS.shortOreRun.cargoCapacity).toBe(100);

    expect(MISSIONS.longOreRun.transitOutTicks).toBe(8);
    expect(MISSIONS.longOreRun.transitBackTicks).toBe(8);
    expect(MISSIONS.longOreRun.cargoCapacity).toBe(100);
  });

  it("each mission's loot table weights sum to 999 or 1000 (sanity check against typos)", () => {
    for (const key of Object.keys(MISSIONS) as (keyof typeof MISSIONS)[]) {
      const total = MISSIONS[key].lootTable.reduce((sum, entry) => sum + entry.weight, 0);
      expect(total).toBeGreaterThanOrEqual(999);
      expect(total).toBeLessThanOrEqual(1000);
    }
  });

  it("longOreRun has better rare-material odds than shortOreRun", () => {
    const shortRareWeight = MISSIONS.shortOreRun.lootTable.find((e) => e.material === "rareMaterial")!.weight;
    const longRareWeight = MISSIONS.longOreRun.lootTable.find((e) => e.material === "rareMaterial")!.weight;
    expect(longRareWeight).toBeGreaterThan(shortRareWeight);
  });
});

describe("requiredTicksForPhase", () => {
  it("ordersReceived is always exactly 1 tick", () => {
    expect(requiredTicksForPhase("ordersReceived", MISSIONS.shortOreRun)).toBe(1);
  });

  it("transitOut/transitBack/unloading match the mission definition directly", () => {
    expect(requiredTicksForPhase("transitOut", MISSIONS.shortOreRun)).toBe(3);
    expect(requiredTicksForPhase("transitBack", MISSIONS.shortOreRun)).toBe(3);
    expect(requiredTicksForPhase("unloading", MISSIONS.shortOreRun)).toBe(1);
  });

  it("extracting is cargoCapacity / extractionRatePerTick, rounded up", () => {
    // 100 / 10 = exactly 10 -- this plan's launch content is deliberately
    // chosen to divide evenly, sidestepping a partial-final-tick edge case
    // (see this task's Step 3 comment on requiredTicksForPhase for why).
    expect(requiredTicksForPhase("extracting", MISSIONS.shortOreRun)).toBe(10);
  });
});

describe("rollLootTable", () => {
  it("with an rng that always returns 0, always picks the FIRST table entry", () => {
    const material = rollLootTable(MISSIONS.shortOreRun.lootTable, () => 0);
    expect(material).toBe(MISSIONS.shortOreRun.lootTable[0].material); // commonOre
  });

  it("with an rng that always returns just under 1, always picks the LAST table entry", () => {
    const material = rollLootTable(MISSIONS.shortOreRun.lootTable, () => 0.999999);
    const lastEntry = MISSIONS.shortOreRun.lootTable[MISSIONS.shortOreRun.lootTable.length - 1];
    expect(material).toBe(lastEntry.material); // rareMaterial
  });

  it("with an rng landing exactly on the boundary between two entries, picks the SECOND of the two", () => {
    // shortOreRun weights: commonOre 980, uncommonMaterial 19, rareMaterial 1
    // (total 1000). rng() * 1000 = 980.0 lands exactly on the commonOre/
    // uncommonMaterial boundary -- rollLootTable's cumulative-weight walk
    // must use a strict `<` comparison (not `<=`) so a value exactly AT a
    // cumulative boundary falls into the NEXT bucket, not the one that just
    // ended, keeping each bucket's actual probability mass equal to its
    // stated weight (a `<=` comparison would silently make commonOre's
    // effective range 981/1000 instead of 980/1000).
    const material = rollLootTable(MISSIONS.shortOreRun.lootTable, () => 980 / 1000);
    expect(material).toBe("uncommonMaterial");
  });
});
```

**Step 2: Confirm the tests would fail**

`MISSIONS`, `requiredTicksForPhase`, `rollLootTable` don't exist yet; `CaptainState` has no
`mission` field; `GameState` has no `homePlanet` field. Confirm by inspection.

**Step 3: Write the implementation**

In `src/lib/game/model.ts`, add after the `SKILL_TREE` block and before `CaptainState`:

```ts
export type LootMaterialKey = "commonOre" | "uncommonMaterial" | "rareMaterial";

export interface LootTableEntry {
  material: LootMaterialKey;
  weight: number; // out of the table's total weight
}

export type MissionPhase = "ordersReceived" | "transitOut" | "extracting" | "transitBack" | "unloading";

export interface MissionDef {
  label: string;
  transitOutTicks: number;
  transitBackTicks: number;
  unloadTicks: number;
  extractionRatePerTick: number; // total units/tick, regardless of which tier they land as
  cargoCapacity: number; // total units across all tiers; MUST divide evenly by extractionRatePerTick
  // for this launch's requiredTicksForPhase() to have no partial-final-tick
  // edge case -- see that function's comment below if this is ever violated.
  lootTable: LootTableEntry[];
}

// 2 missions at launch: a fast, safe ore run and a slower one with better
// rare-material odds. Add a new entry here (and nowhere else -- App.svelte's
// Missions panel iterates this object) if a 3rd mission is ever wanted.
// Both entries' cargoCapacity divides evenly by extractionRatePerTick (100/10
// = 10) -- keep this true for any future entry too, or update
// requiredTicksForPhase's extracting case to handle a smaller final tick.
export const MISSIONS: Record<"shortOreRun" | "longOreRun", MissionDef> = {
  shortOreRun: {
    label: "Short Ore Run",
    transitOutTicks: 3,
    transitBackTicks: 3,
    unloadTicks: 1,
    extractionRatePerTick: 10,
    cargoCapacity: 100,
    lootTable: [
      { material: "commonOre", weight: 980 },
      { material: "uncommonMaterial", weight: 19 },
      { material: "rareMaterial", weight: 1 },
    ],
  },
  longOreRun: {
    label: "Long Ore Run",
    transitOutTicks: 8,
    transitBackTicks: 8,
    unloadTicks: 1,
    extractionRatePerTick: 10,
    cargoCapacity: 100,
    lootTable: [
      { material: "commonOre", weight: 900 },
      { material: "uncommonMaterial", weight: 80 },
      { material: "rareMaterial", weight: 20 },
    ],
  },
};

export type MissionKey = keyof typeof MISSIONS;

export interface CaptainMissionState {
  missionKey: MissionKey;
  phase: MissionPhase;
  phaseProgressTicks: number; // continuous (can be fractional mid-tick), like research's progressSeconds
  cargo: Record<LootMaterialKey, number>;
  recalled: boolean; // if true, ends the loop (mission -> null) after THIS cycle's unloading completes,
  // instead of auto-restarting at ordersReceived. Does not interrupt the current cycle mid-flight.
}

// How many ticks a phase requires before advancing to the next one.
// "extracting" is the one phase whose length isn't a literal field on
// MissionDef -- it's however many ticks it takes to extract cargoCapacity
// units at extractionRatePerTick units/tick. Rounds up, which only matters
// if cargoCapacity doesn't divide evenly by extractionRatePerTick (today's
// launch content avoids this; see the MISSIONS comment above).
export function requiredTicksForPhase(phase: MissionPhase, missionDef: MissionDef): number {
  switch (phase) {
    case "ordersReceived":
      return 1;
    case "transitOut":
      return missionDef.transitOutTicks;
    case "extracting":
      return Math.ceil(missionDef.cargoCapacity / missionDef.extractionRatePerTick);
    case "transitBack":
      return missionDef.transitBackTicks;
    case "unloading":
      return missionDef.unloadTicks;
  }
}

// Weighted random pick from a loot table. `rng` defaults to Math.random for
// real gameplay; tests inject a fixed value to hit a specific tier
// deterministically (see model.test.ts's "rollLootTable" tests for the exact
// boundary behavior this produces). Walks entries in the table's own order,
// accumulating weight, and picks the first entry whose cumulative weight
// STRICTLY EXCEEDS `rng() * totalWeight` -- this (not `>=`) is what keeps
// each entry's actual probability mass equal to its stated weight; a
// non-strict comparison would silently shift one unit of probability mass
// from each entry to the next one in the table.
export function rollLootTable(lootTable: LootTableEntry[], rng: () => number = Math.random): LootMaterialKey {
  const totalWeight = lootTable.reduce((sum, entry) => sum + entry.weight, 0);
  const roll = rng() * totalWeight;
  let cumulative = 0;
  for (const entry of lootTable) {
    cumulative += entry.weight;
    if (roll < cumulative) return entry.material;
  }
  return lootTable[lootTable.length - 1].material; // floating-point fallback, should be unreachable
}
```

Update `CaptainState` (find the interface, add `mission` as its last field):

```ts
export interface CaptainState {
  id: number;
  label: string;
  shipType: ShipType;
  resources: Record<ResourceKey, number>;
  modules: Record<ModuleKey, number>;
  research: Record<ResearchKey, ResearchState>;
  lifetimeComponents: number;
  tickDurationSeconds: number;
  captainPoints: number;
  captainPrestigeCount: number;
  specialization: SpecializationKey | null;
  mission: CaptainMissionState | null; // null when idle/running their normal Generator Stack economy
}
```

Update `GameState` (add `homePlanet`):

```ts
export interface GameState {
  captains: CaptainState[];
  augmentPoints: number;
  prestigeCount: number;
  gameTimeSeconds: number;
  skillPoints: number;
  unlockedSkillNodes: SkillNodeKey[];
  homePlanet: { storage: Record<LootMaterialKey, number> }; // fleet-wide, separate from any captain's own resources
}
```

Update `freshCaptainStack()` — add `mission: null` to both its return type and its return value:

```ts
export function freshCaptainStack(): Pick<
  CaptainState,
  "resources" | "modules" | "research" | "lifetimeComponents" | "tickDurationSeconds" | "mission"
> {
  return {
    resources: { ore: 0, ingots: 0, components: 0, alloys: 0 },
    modules: { miner: 1, refinery: 0, fabricator: 0, synthesizer: 0 },
    research: { alloySynthesis: { started: false, progressSeconds: 0, completed: false } },
    lifetimeComponents: 0,
    tickDurationSeconds: 10,
    mission: null, // both prestige tiers cancel any active mission as part of the reset -- see tick.ts
  };
}
```

Update `freshState()` — add `homePlanet`:

```ts
export function freshState(): GameState {
  return {
    captains: freshCaptains(1),
    augmentPoints: 0,
    prestigeCount: 0,
    gameTimeSeconds: 0,
    skillPoints: 0,
    unlockedSkillNodes: [],
    homePlanet: { storage: { commonOre: 0, uncommonMaterial: 0, rareMaterial: 0 } },
  };
}
```

`freshCaptains(count)` itself needs no change — it already spreads `freshCaptainStack()`, which now
includes `mission: null` automatically.

**Step 4: Confirm the tests would pass**

Manually trace the trickiest ones:
- `rollLootTable` with the boundary-landing rng (`980/1000` exactly): `totalWeight = 1000`,
  `roll = 980`. Walking entries: `commonOre` (weight 980) → `cumulative = 980`; `roll < cumulative`
  is `980 < 980` = `false`, so it does NOT return here. Next: `uncommonMaterial` (weight 19) →
  `cumulative = 999`; `980 < 999` = `true` → returns `"uncommonMaterial"`. Confirms the strict `<`
  correctly excludes the exact boundary from the first bucket. ✓
- `requiredTicksForPhase("extracting", MISSIONS.shortOreRun)`: `Math.ceil(100 / 10) = Math.ceil(10) =
  10`. ✓

**Step 5: Commit**

```bash
git add src/lib/game/model.ts src/lib/game/model.test.ts
git commit -m "feat: add mission/Home Planet data model (MISSIONS, loot table, tick-requirement helpers)"
```

---

### Task 2: Mission advancement algorithm (`tick.ts`) — HIGHEST RISK, read multiple times before editing

**Files:**
- Modify: `src/lib/game/tick.ts`
- Modify: `src/lib/game/tick.test.ts`

**Context — read this whole section before touching any code.** Every prior tick-based system in
this codebase (resource production, research progress) is a CONTINUOUS accrual: `quantity +=
rate * deltaSeconds`, optionally clamped at one single completion threshold. This is different:
mission progress is a SEQUENCE of 5 phases, each with its own tick-length requirement, that WRAPS
BACK to the first phase on completion (unless recalled) rather than clamping and stopping forever.
`tickCaptainMission` (this task) is a pure function that must resolve this ENTIRE sequence — however
many phase transitions, extraction-tick loot rolls, and full auto-repeat cycles a given
`ticksElapsed` represents — within ONE call, so that calling it once with a large `ticksElapsed`
produces the IDENTICAL result as calling it many times with small `ticksElapsed` values summing to
the same total. This task builds and tests `tickCaptainMission` IN ISOLATION — it is not wired into
`tick()`/`tickCaptainStack()` yet (that's Task 3).

**The algorithm, in words:**
1. If the captain has no active mission, or `ticksElapsed <= 0`, return unchanged.
2. Otherwise, loop: at each step, compute how many ticks the CURRENT phase still needs
   (`requiredTicksForPhase(phase, missionDef) - phaseProgressTicks`), and apply the smaller of that
   or however many ticks remain in the whole call's budget.
3. If the current phase is `"extracting"`, roll the loot table once for every WHOLE integer tick
   boundary crossed during this step's application (not once per step — a single step can cross
   multiple whole-tick boundaries if `ticksElapsed` is large, e.g. during offline catch-up), adding
   `extractionRatePerTick` units of whatever tier is rolled to `cargo` each time.
4. If this step's application completes the current phase (`phaseProgressTicks` reaches
   `requiredTicksForPhase`), advance to the next phase (resetting `phaseProgressTicks` to 0), OR — if
   the phase just completed was `"unloading"` — the cycle is done: add `cargo`'s contents to a
   running `homePlanetDelta` total, and either end the mission (`recalled: true` → mission becomes
   `null`) or wrap back to `"ordersReceived"` with fresh empty cargo (auto-repeat).
5. Repeat until the call's `ticksElapsed` budget is fully consumed, or the mission ends (recalled).

**Step 1: Write the failing tests**

Add to `src/lib/game/tick.test.ts` (keep every existing describe block untouched, add new ones):

```ts
import { tickCaptainMission } from "./tick"; // add to the existing import line from "./tick"
import { MISSIONS, type CaptainMissionState } from "./model"; // add to the existing import line from "./model"

function missionCaptain(missionKey: "shortOreRun" | "longOreRun" = "shortOreRun"): CaptainMissionState {
  return {
    missionKey,
    phase: "ordersReceived",
    phaseProgressTicks: 0,
    cargo: { commonOre: 0, uncommonMaterial: 0, rareMaterial: 0 },
    recalled: false,
  };
}

const ALWAYS_COMMON_ORE = () => 0; // lands on the first (commonOre) bucket every time -- see rollLootTable

describe("tickCaptainMission — closed-form requirement", () => {
  it("one big jump equals many small ticks, across multiple phase transitions", () => {
    const base = freshCaptains(1)[0];
    base.mission = missionCaptain("shortOreRun");
    // shortOreRun total ticks per cycle: 1 (orders) + 3 (out) + 10 (extract) + 3 (back) + 1 (unload) = 18.
    // 40 ticksElapsed crosses more than one full cycle (auto-repeat).
    const bigJump = tickCaptainMission(40, base, ALWAYS_COMMON_ORE);

    let stepped = base;
    for (let i = 0; i < 400; i++) {
      stepped = tickCaptainMission(0.1, stepped, ALWAYS_COMMON_ORE);
    }

    expect(bigJump.captain.mission).toEqual(stepped.captain.mission);
    expect(bigJump.homePlanetDelta).toEqual(stepped.homePlanetDelta);
  });

  it("zero or negative ticksElapsed is a no-op", () => {
    const base = freshCaptains(1)[0];
    base.mission = missionCaptain();
    const result = tickCaptainMission(0, base, ALWAYS_COMMON_ORE);
    expect(result.captain).toBe(base);
    expect(result.homePlanetDelta).toEqual({ commonOre: 0, uncommonMaterial: 0, rareMaterial: 0 });
  });

  it("a captain with no active mission is returned unchanged", () => {
    const base = freshCaptains(1)[0]; // mission: null
    const result = tickCaptainMission(100, base, ALWAYS_COMMON_ORE);
    expect(result.captain).toBe(base);
  });
});

describe("tickCaptainMission — phase progression", () => {
  it("advances phaseProgressTicks within ordersReceived without completing it", () => {
    const base = freshCaptains(1)[0];
    base.mission = missionCaptain();
    const { captain } = tickCaptainMission(0.5, base, ALWAYS_COMMON_ORE);
    expect(captain.mission!.phase).toBe("ordersReceived");
    expect(captain.mission!.phaseProgressTicks).toBeCloseTo(0.5, 6);
  });

  it("completes ordersReceived (1 tick) and moves into transitOut", () => {
    const base = freshCaptains(1)[0];
    base.mission = missionCaptain();
    const { captain } = tickCaptainMission(1, base, ALWAYS_COMMON_ORE);
    expect(captain.mission!.phase).toBe("transitOut");
    expect(captain.mission!.phaseProgressTicks).toBe(0);
  });

  it("carries leftover ticks into the next phase in the same call", () => {
    const base = freshCaptains(1)[0];
    base.mission = missionCaptain();
    // 1.5 ticks: completes the 1-tick ordersReceived phase, carries 0.5 into transitOut.
    const { captain } = tickCaptainMission(1.5, base, ALWAYS_COMMON_ORE);
    expect(captain.mission!.phase).toBe("transitOut");
    expect(captain.mission!.phaseProgressTicks).toBeCloseTo(0.5, 6);
  });

  it("advances all the way through extracting, transitBack, and unloading in one big call", () => {
    const base = freshCaptains(1)[0];
    base.mission = missionCaptain(); // shortOreRun: 1+3+10+3+1 = 18 ticks for one full cycle
    const { captain, homePlanetDelta } = tickCaptainMission(17.9, base, ALWAYS_COMMON_ORE);
    expect(captain.mission!.phase).toBe("unloading");
    expect(captain.mission!.phaseProgressTicks).toBeCloseTo(0.9, 6);
    expect(homePlanetDelta).toEqual({ commonOre: 0, uncommonMaterial: 0, rareMaterial: 0 }); // not unloaded yet
  });
});

describe("tickCaptainMission — extraction loot rolls", () => {
  it("rolls loot once per whole tick crossed during extracting, adding extractionRatePerTick units each time", () => {
    const base = freshCaptains(1)[0];
    base.mission = { ...missionCaptain(), phase: "extracting", phaseProgressTicks: 0 };
    // 3.5 ticks of extracting crosses whole boundaries 1, 2, 3 -- 3 rolls, all commonOre (rate 10 each).
    const { captain } = tickCaptainMission(3.5, base, ALWAYS_COMMON_ORE);
    expect(captain.mission!.cargo.commonOre).toBe(30);
    expect(captain.mission!.phaseProgressTicks).toBeCloseTo(3.5, 6);
  });

  it("a large jump resolves every extraction tick's loot roll, not just the last one", () => {
    const base = freshCaptains(1)[0];
    base.mission = { ...missionCaptain(), phase: "extracting", phaseProgressTicks: 0 };
    // Exactly 10 ticks completes extracting (cargoCapacity 100 / rate 10).
    const { captain } = tickCaptainMission(10, base, ALWAYS_COMMON_ORE);
    expect(captain.mission!.cargo.commonOre).toBe(100);
    expect(captain.mission!.phase).toBe("transitBack"); // extracting completed, advanced
  });

  it("respects the injected rng for a non-common tier", () => {
    const base = freshCaptains(1)[0];
    base.mission = { ...missionCaptain(), phase: "extracting", phaseProgressTicks: 0 };
    const ALWAYS_RARE = () => 0.9999; // lands in the last bucket (rareMaterial) -- see rollLootTable
    const { captain } = tickCaptainMission(1, base, ALWAYS_RARE);
    expect(captain.mission!.cargo.rareMaterial).toBe(10);
    expect(captain.mission!.cargo.commonOre).toBe(0);
  });
});

describe("tickCaptainMission — cycle completion, auto-repeat, and recall", () => {
  it("completing a full cycle (not recalled) delivers cargo to homePlanetDelta and restarts at ordersReceived", () => {
    const base = freshCaptains(1)[0];
    base.mission = { ...missionCaptain(), phase: "unloading", phaseProgressTicks: 0 };
    base.mission.cargo = { commonOre: 90, uncommonMaterial: 8, rareMaterial: 2 };
    const { captain, homePlanetDelta } = tickCaptainMission(1, base, ALWAYS_COMMON_ORE); // 1 tick completes unloadTicks=1

    expect(homePlanetDelta).toEqual({ commonOre: 90, uncommonMaterial: 8, rareMaterial: 2 });
    expect(captain.mission!.phase).toBe("ordersReceived"); // auto-repeated
    expect(captain.mission!.phaseProgressTicks).toBe(0);
    expect(captain.mission!.cargo).toEqual({ commonOre: 0, uncommonMaterial: 0, rareMaterial: 0 }); // reset
    expect(captain.mission!.recalled).toBe(false);
  });

  it("completing a full cycle WHILE recalled ends the mission (mission becomes null)", () => {
    const base = freshCaptains(1)[0];
    base.mission = { ...missionCaptain(), phase: "unloading", phaseProgressTicks: 0, recalled: true };
    base.mission.cargo = { commonOre: 50, uncommonMaterial: 0, rareMaterial: 0 };
    const { captain, homePlanetDelta } = tickCaptainMission(1, base, ALWAYS_COMMON_ORE);

    expect(homePlanetDelta).toEqual({ commonOre: 50, uncommonMaterial: 0, rareMaterial: 0 });
    expect(captain.mission).toBe(null);
  });

  it("a big jump can complete multiple full auto-repeat cycles, accumulating homePlanetDelta across all of them", () => {
    const base = freshCaptains(1)[0];
    base.mission = missionCaptain(); // shortOreRun, 18 ticks/cycle
    const { captain, homePlanetDelta } = tickCaptainMission(36, base, ALWAYS_COMMON_ORE); // exactly 2 full cycles

    // Each cycle extracts 100 commonOre (10 ticks * 10/tick, always-common rng); 2 cycles = 200.
    expect(homePlanetDelta).toEqual({ commonOre: 200, uncommonMaterial: 0, rareMaterial: 0 });
    expect(captain.mission!.phase).toBe("ordersReceived"); // mid-3rd-cycle-start, not recalled
    expect(captain.mission!.phaseProgressTicks).toBe(0);
  });

  it("recall takes effect at the end of the CURRENT cycle, not immediately", () => {
    const base = freshCaptains(1)[0];
    base.mission = { ...missionCaptain(), phase: "extracting", phaseProgressTicks: 5, recalled: true };
    // 3 more ticks: still mid-extraction, far from completing the cycle -- recalled flag is inert until unloading finishes.
    const { captain } = tickCaptainMission(3, base, ALWAYS_COMMON_ORE);
    expect(captain.mission).not.toBe(null);
    expect(captain.mission!.phase).toBe("extracting");
    expect(captain.mission!.phaseProgressTicks).toBeCloseTo(8, 6);
  });
});
```

**Step 2: Confirm the tests would fail**

`tickCaptainMission` doesn't exist yet. Confirm by inspection.

**Step 3: Write the implementation**

Add to `src/lib/game/tick.ts` (add `requiredTicksForPhase`, `rollLootTable`, `MISSIONS`,
`type CaptainMissionState`, `type LootMaterialKey`, `type MissionPhase` to the existing import line
from `"./model"`):

```ts
const MISSION_PHASE_ORDER: MissionPhase[] = ["ordersReceived", "transitOut", "extracting", "transitBack", "unloading"];

function emptyLootTotals(): Record<LootMaterialKey, number> {
  return { commonOre: 0, uncommonMaterial: 0, rareMaterial: 0 };
}

// The mission-progress analog of tickCaptainStack: MUST be closed-form,
// exactly like tickCaptainStack, but generalized from "one continuous
// quantity clamped at one threshold" to "a sequence of 5 phase thresholds
// that wraps back to the start on completion, unless recalled." One call
// with a large ticksElapsed must resolve EVERY phase transition, extraction
// loot roll, and auto-repeat cycle that ticksElapsed represents -- not just
// the first one -- which is what the while loop below does.
//
// `ticksElapsed` is NOT deltaSeconds -- it's the caller's job (tick(), in
// this same file) to convert deltaSeconds into ticksElapsed by dividing by
// the captain's own tickDurationSeconds, same cadence used for that
// captain's normal production. This keeps mission progress on the same
// per-captain cadence as everything else, rather than inventing a second
// timing system.
export function tickCaptainMission(
  ticksElapsed: number,
  captain: CaptainState,
  rng: () => number = Math.random
): { captain: CaptainState; homePlanetDelta: Record<LootMaterialKey, number> } {
  if (!captain.mission || ticksElapsed <= 0) {
    return { captain, homePlanetDelta: emptyLootTotals() };
  }

  const missionDef = MISSIONS[captain.mission.missionKey];
  let mission: CaptainMissionState | null = { ...captain.mission, cargo: { ...captain.mission.cargo } };
  let remaining = ticksElapsed;
  const homePlanetDelta = emptyLootTotals();

  while (remaining > 0 && mission !== null) {
    const requiredTicks = requiredTicksForPhase(mission.phase, missionDef);
    const ticksLeftInPhase = requiredTicks - mission.phaseProgressTicks;
    const ticksToApply = Math.min(remaining, ticksLeftInPhase);

    if (mission.phase === "extracting") {
      // Roll loot once per WHOLE tick boundary crossed during this step --
      // NOT once per step, since a single step can span many whole ticks
      // during a large offline-catchup jump. E.g. going from
      // phaseProgressTicks 2.4 by ticksToApply 4 (to 6.4) crosses whole
      // boundaries 3, 4, 5, 6 -- 4 rolls, matching 4 whole ticks' worth of
      // extraction, regardless of how this call got chunked.
      const fromWhole = Math.floor(mission.phaseProgressTicks);
      const toWhole = Math.floor(mission.phaseProgressTicks + ticksToApply);
      const rollsThisStep = toWhole - fromWhole;
      for (let i = 0; i < rollsThisStep; i++) {
        const material = rollLootTable(missionDef.lootTable, rng);
        mission.cargo[material] += missionDef.extractionRatePerTick;
      }
    }

    mission.phaseProgressTicks += ticksToApply;
    remaining -= ticksToApply;

    if (mission.phaseProgressTicks >= requiredTicks) {
      const nextIndex = MISSION_PHASE_ORDER.indexOf(mission.phase) + 1;
      if (nextIndex >= MISSION_PHASE_ORDER.length) {
        // Just completed "unloading" -- one full cycle is done.
        (Object.keys(mission.cargo) as LootMaterialKey[]).forEach((key) => {
          homePlanetDelta[key] += mission.cargo[key];
        });
        if (mission.recalled) {
          mission = null;
        } else {
          mission = {
            missionKey: mission.missionKey,
            phase: "ordersReceived",
            phaseProgressTicks: 0,
            cargo: emptyLootTotals(),
            recalled: false,
          };
        }
      } else {
        mission.phase = MISSION_PHASE_ORDER[nextIndex];
        mission.phaseProgressTicks = 0;
      }
    }
  }

  return { captain: { ...captain, mission }, homePlanetDelta };
}
```

**Step 4: Confirm the tests would pass**

Manually trace the two highest-value tests:

- **Closed-form test**: with `ALWAYS_COMMON_ORE` (a constant rng), every extraction roll in BOTH the
  big-jump and the stepped-accumulation path picks `commonOre` deterministically — so the two paths
  differ only in HOW they chunk `ticksElapsed`, never in WHAT gets rolled. Since the while loop
  fully resolves phase transitions and whole-tick-boundary loot rolls within a single call
  (nothing is deferred to "next call"), processing `40` ticks in one call must reach the exact same
  `(phase, phaseProgressTicks, cargo)` as processing `0.1` ticks 400 times in sequence — each 0.1-tick
  step is just a smaller slice of the identical whole-tick-boundary-crossing math the big-jump does
  all at once. ✓
- **Multi-cycle auto-repeat test** (`tickCaptainMission(36, ...)`, shortOreRun = 18 ticks/cycle):
  first pass through the loop resolves `ordersReceived`(1) → `transitOut`(3) → `extracting`(10, 10
  rolls × 10 units = 100 commonOre, since `ALWAYS_COMMON_ORE`) → `transitBack`(3) → `unloading`(1) =
  18 ticks consumed, `remaining = 36-18 = 18`. `mission.recalled` is `false`, so it wraps to
  `ordersReceived` with fresh empty cargo, and `homePlanetDelta.commonOre` is now `100`. The loop
  continues (since `remaining = 18 > 0`): resolves the SAME 18-tick sequence again, adding another
  100 to `homePlanetDelta.commonOre` (now `200`) and wrapping a second time, `remaining` now `0`,
  loop exits with `mission.phase === "ordersReceived"`, `phaseProgressTicks === 0`. Matches the
  test's expectations exactly. ✓

**Step 5: Commit**

```bash
git add src/lib/game/tick.ts src/lib/game/tick.test.ts
git commit -m "feat: add tickCaptainMission, the mission-progress state machine (closed-form)"
```

---

### Task 3: Dispatch/recall + wiring into `tick()`/prestige (`tick.ts`)

**Files:**
- Modify: `src/lib/game/tick.ts`
- Modify: `src/lib/game/tick.test.ts`

**Context:** Task 2 built `tickCaptainMission` in isolation. This task wires it into the actual game
loop: `tick()` must skip normal production for any captain currently on a mission and advance their
mission instead, aggregating loot into `state.homePlanet.storage`. Also adds the two player actions
(`dispatchCaptainOnMission`, `recallCaptain`) and settles what both prestige tiers do to an active
mission.

**Step 1: Write the failing tests**

Add to `src/lib/game/tick.test.ts` (add `dispatchCaptainOnMission`, `recallCaptain` to the existing
import line from `"./tick"`):

```ts
describe("tick() — routes captains on a mission through tickCaptainMission instead of production", () => {
  it("a captain on a mission produces NOTHING via their normal Generator Stack this tick", () => {
    const state = freshState();
    state.captains[0].modules.miner = 5; // would normally produce ore
    state.captains[0].mission = {
      missionKey: "shortOreRun",
      phase: "transitOut",
      phaseProgressTicks: 0,
      cargo: { commonOre: 0, uncommonMaterial: 0, rareMaterial: 0 },
      recalled: false,
    };

    const result = tick(100, state); // 100 seconds, tickDurationSeconds=10 -> 10 mission ticks
    expect(result.captains[0].resources.ore).toBe(0); // no normal production while on a mission
  });

  it("a captain with no mission still produces normally (no regression)", () => {
    const state = freshState();
    state.captains[0].modules.miner = 1;
    const result = tick(10, state);
    expect(result.captains[0].resources.ore).toBeCloseTo(10, 6);
  });

  it("mission loot lands in state.homePlanet.storage, aggregated across all captains on missions", () => {
    const state = freshState();
    state.captains = freshCaptains(2);
    state.captains[0].mission = {
      missionKey: "shortOreRun",
      phase: "extracting",
      phaseProgressTicks: 0,
      cargo: { commonOre: 0, uncommonMaterial: 0, rareMaterial: 0 },
      recalled: false,
    };
    state.captains[1].mission = {
      missionKey: "shortOreRun",
      phase: "extracting",
      phaseProgressTicks: 9, // 1 tick away from completing extraction
      cargo: { commonOre: 90, uncommonMaterial: 0, rareMaterial: 0 },
      recalled: false,
    };

    // tickDurationSeconds=10, so 10 seconds = exactly 1 mission tick for both captains.
    const result = tick(10, state);
    // Captain 0: 1 extraction tick's worth of loot added to THEIR cargo (not yet delivered home).
    expect(result.captains[0].mission!.cargo.commonOre).toBeGreaterThan(0);
    // Captain 1's extraction phase completes this tick and advances to transitBack --
    // nothing delivered to homePlanet yet (that only happens after unloading).
    expect(result.homePlanet.storage.commonOre).toBe(0);
  });
});

describe("dispatchCaptainOnMission", () => {
  it("dispatches an idle captain, setting their initial mission state", () => {
    const state = freshState();
    const { next, success } = dispatchCaptainOnMission(state, 1, "shortOreRun");
    expect(success).toBe(true);
    expect(next.captains[0].mission).toEqual({
      missionKey: "shortOreRun",
      phase: "ordersReceived",
      phaseProgressTicks: 0,
      cargo: { commonOre: 0, uncommonMaterial: 0, rareMaterial: 0 },
      recalled: false,
    });
  });

  it("fails if the captain is already on a mission", () => {
    const state = freshState();
    const { next: dispatched } = dispatchCaptainOnMission(state, 1, "shortOreRun");
    const { next, success } = dispatchCaptainOnMission(dispatched, 1, "longOreRun");
    expect(success).toBe(false);
    expect(next).toBe(dispatched);
  });

  it("fails if no captain has the given id, rather than throwing", () => {
    const state = freshState();
    const { next, success } = dispatchCaptainOnMission(state, 999, "shortOreRun");
    expect(success).toBe(false);
    expect(next).toBe(state);
  });
});

describe("recallCaptain", () => {
  it("sets recalled: true on an active mission", () => {
    const state = freshState();
    const { next: dispatched } = dispatchCaptainOnMission(state, 1, "shortOreRun");
    const { next, success } = recallCaptain(dispatched, 1);
    expect(success).toBe(true);
    expect(next.captains[0].mission!.recalled).toBe(true);
  });

  it("fails if the captain has no active mission", () => {
    const state = freshState();
    const { next, success } = recallCaptain(state, 1);
    expect(success).toBe(false);
    expect(next).toBe(state);
  });
});

describe("prestige tiers cancel an active mission (in-transit cargo is lost, a deliberate choice)", () => {
  it("captainPrestige resets mission to null for the prestiged captain", () => {
    const state = freshState();
    state.captains[0].lifetimeComponents = 100;
    const { next: dispatched } = dispatchCaptainOnMission(state, 1, "shortOreRun");
    dispatched.captains[0].lifetimeComponents = 100; // re-apply after dispatch's shallow copy

    const { next, gained } = captainPrestige(dispatched, 1, "mining");
    expect(gained).toBe(10);
    expect(next.captains[0].mission).toBe(null);
  });

  it("Fleet Prestige resets every captain's mission to null (fresh roster has none)", () => {
    const state = freshState();
    state.captains[0].lifetimeComponents = 100;
    const { next: dispatched } = dispatchCaptainOnMission(state, 1, "shortOreRun");
    dispatched.captains[0].lifetimeComponents = 100;

    const { next } = prestige(dispatched);
    expect(next.captains[0].mission).toBe(null);
  });
});
```

**Step 2: Confirm the tests would fail**

`dispatchCaptainOnMission`/`recallCaptain` don't exist yet; `tick()` still calls `tickCaptainStack`
unconditionally for every captain regardless of mission state. Confirm by inspection.

**Step 3: Write the implementation**

In `src/lib/game/tick.ts`, replace `tick()`:

```ts
export function tick(deltaSeconds: number, state: GameState): GameState {
  if (deltaSeconds <= 0) return state;

  const fleetMult = globalMultiplier(state);
  const researchDurationMults = {} as Record<ResearchKey, number>;
  for (const key of Object.keys(RESEARCH_PROJECTS) as ResearchKey[]) {
    researchDurationMults[key] = researchDurationMult(state, key);
  }

  const homePlanetDelta = emptyLootTotals();
  const captains = state.captains.map((captain) => {
    if (captain.mission) {
      // Mission progress is tick-COUNT based (discrete), not continuous-
      // seconds based like production/research -- convert this captain's
      // own deltaSeconds into ticksElapsed using THEIR OWN
      // tickDurationSeconds, same per-captain cadence everything else here
      // already uses. A captain on a mission does NOT run their normal
      // Generator Stack/research this tick -- the two are mutually
      // exclusive per the design doc.
      const ticksElapsed = deltaSeconds / captain.tickDurationSeconds;
      const { captain: updated, homePlanetDelta: delta } = tickCaptainMission(ticksElapsed, captain);
      (Object.keys(delta) as LootMaterialKey[]).forEach((key) => {
        homePlanetDelta[key] += delta[key];
      });
      return updated;
    }
    return tickCaptainStack(deltaSeconds, captain, fleetMult, researchDurationMults);
  });

  return {
    ...state,
    captains,
    gameTimeSeconds: state.gameTimeSeconds + deltaSeconds,
    homePlanet: {
      storage: {
        commonOre: state.homePlanet.storage.commonOre + homePlanetDelta.commonOre,
        uncommonMaterial: state.homePlanet.storage.uncommonMaterial + homePlanetDelta.uncommonMaterial,
        rareMaterial: state.homePlanet.storage.rareMaterial + homePlanetDelta.rareMaterial,
      },
    },
  };
}
```

Add `dispatchCaptainOnMission` and `recallCaptain` after `buySkillNode`:

```ts
// Dispatches an idle captain (mission === null) on a mission. Fails (same
// state reference, unchanged) if the captain doesn't exist or already has
// an active mission -- mirrors captainPrestige's not-found guard and
// buySkillNode's already-unlocked guard.
export function dispatchCaptainOnMission(
  state: GameState,
  captainId: number,
  missionKey: MissionKey
): { next: GameState; success: boolean } {
  const idx = state.captains.findIndex((c) => c.id === captainId);
  if (idx === -1) return { next: state, success: false };
  if (state.captains[idx].mission !== null) return { next: state, success: false };

  const captains = [...state.captains];
  captains[idx] = {
    ...captains[idx],
    mission: {
      missionKey,
      phase: "ordersReceived",
      phaseProgressTicks: 0,
      cargo: emptyLootTotals(),
      recalled: false,
    },
  };
  return { next: { ...state, captains }, success: true };
}

// Marks an active mission as recalled -- takes effect at the end of the
// CURRENT cycle (after unloading completes; see tickCaptainMission), not
// immediately. Fails if the captain has no active mission.
export function recallCaptain(state: GameState, captainId: number): { next: GameState; success: boolean } {
  const idx = state.captains.findIndex((c) => c.id === captainId);
  if (idx === -1 || state.captains[idx].mission === null) return { next: state, success: false };

  const captains = [...state.captains];
  captains[idx] = { ...captains[idx], mission: { ...captains[idx].mission!, recalled: true } };
  return { next: { ...state, captains }, success: true };
}
```

No changes are needed to `captainPrestige`/`prestige` themselves — both already reset a captain's
stack via `freshCaptainStack()` (Task 1 added `mission: null` to its return value), so this
cancellation falls out automatically. In-transit cargo at the moment of prestige is lost — a
deliberate choice, consistent with resources/modules already being wiped by the same reset; this
needs a one-line mention in both prestige panels' copy in Task 6 (UI).

**Step 4: Confirm the tests would pass**

Manually trace the aggregation test: captain 0's mission (`extracting`, `phaseProgressTicks: 0`)
advances by 1 tick (10 seconds / 10 tickDurationSeconds) — crosses whole boundary 1, one loot roll,
cargo gains 10 units of whatever tier (still on the ship, not delivered). Captain 1's mission
(`extracting`, `phaseProgressTicks: 9`, `cargo.commonOre: 90`) advances by 1 tick to
`phaseProgressTicks: 10`, which equals `requiredTicksForPhase("extracting", ...) = 10` — completes
extracting, advances to `transitBack` with `phaseProgressTicks: 0`; the roll for the final boundary
crossing (9→10) still fires, adding 10 more units to captain 1's cargo before the phase transition.
Neither captain has reached `unloading` this tick, so `homePlanetDelta` stays all-zero for both,
matching `result.homePlanet.storage.commonOre === 0`. ✓

**Step 5: Commit**

```bash
git add src/lib/game/tick.ts src/lib/game/tick.test.ts
git commit -m "feat: wire mission progression into tick(), add dispatch/recall actions"
```

---

### Task 4: Save migration v7 → v8 (`save.ts`)

**Files:**
- Modify: `src/lib/game/save.ts`
- Modify: `src/lib/game/save.test.ts`

**Context:** Read the current `save.ts` in full, including its incident-driven comments (TWO real
production incidents this project from under-tested migrations). Same absolute hard rule applies:
never edit `MIGRATIONS[1]` through `[6]`'s bodies.

**Step 1: Write the failing tests**

Add to `src/lib/game/save.test.ts` (update the existing `"current SAVE_VERSION is 7"` assertions —
grep for the exact count first, do not assume a number without checking, per this session's
established practice of verifying rather than trusting a plan's stated count):

```ts
describe("migrate — mission/Home Planet backfill (v7 -> v8)", () => {
  it("backfills homePlanet storage and mission:null on every captain for a genuine v7 save", () => {
    const legacyState: any = {
      augmentPoints: 5,
      prestigeCount: 1,
      gameTimeSeconds: 2000,
      skillPoints: 2,
      unlockedSkillNodes: ["commandRank1"],
      captains: [
        {
          id: 1,
          label: "Captain 1",
          shipType: "resourcer",
          resources: { ore: 500, ingots: 0, components: 0, alloys: 0 },
          modules: { miner: 10, refinery: 0, fabricator: 0, synthesizer: 0 },
          research: { alloySynthesis: { started: false, progressSeconds: 0, completed: false } },
          lifetimeComponents: 50,
          tickDurationSeconds: 10,
          captainPoints: 0,
          captainPrestigeCount: 0,
          specialization: null,
        },
      ],
    };

    const save: SaveFile = {
      version: 7,
      created_at: 0,
      last_saved_at: 0,
      game_time_seconds: 2000,
      state: legacyState,
    };

    const migrated: any = migrate(save);
    expect(migrated.homePlanet.storage).toEqual({ commonOre: 0, uncommonMaterial: 0, rareMaterial: 0 });
    expect(migrated.captains[0].mission).toBe(null);
    expect(migrated.captains[0].modules.miner).toBe(10); // untouched fields survive the backfill
    expect(migrated.skillPoints).toBe(2);
  });

  it("current SAVE_VERSION is 8", () => {
    expect(SAVE_VERSION).toBe(8);
  });
});

describe("migrate — chained v1 -> v8 migration", () => {
  it("backfills every field across all seven migration steps on a genuine v1 save missing all of them", () => {
    const legacyState: any = {
      resources: { ore: 10, ingots: 0, components: 0 },
      modules: { miner: 1, refinery: 0, fabricator: 0 },
      lifetimeComponents: 0,
      augmentPoints: 0,
      prestigeCount: 0,
      gameTimeSeconds: 100,
    };

    const save: SaveFile = {
      version: 1,
      created_at: 0,
      last_saved_at: 0,
      game_time_seconds: 100,
      state: legacyState,
    };

    const migrated: any = migrate(save);
    expect(migrated.captains).toHaveLength(2); // v4->v5's fresh[1]
    expect(migrated.captains[0].modules.miner).toBe(1); // original v1 progress preserved
    expect(migrated.unlockedSkillNodes).toEqual(["commandRank1"]); // 2 captains -> grandfathered (v6->v7)
    expect(migrated.captains[0].mission).toBe(null);
    expect(migrated.captains[1].mission).toBe(null);
    expect(migrated.homePlanet.storage).toEqual({ commonOre: 0, uncommonMaterial: 0, rareMaterial: 0 });
    expect(migrated.gameTimeSeconds).toBe(100);
  });
});
```

Also update whichever existing "chained v1 -> v7" describe block currently exists: per this file's
own established convention (see the comment already in the file about the v1→v6 block being deleted
in favor of v1→v7), decide whether the existing chained test should be deleted in favor of the new
v1→v8 one above (it will be a strict superset covering one more migration step) — apply the same
reasoning and, if you delete it, leave an equivalent explanatory NOTE comment, matching the existing
precedent in this exact file.

**Step 2: Confirm the tests would fail**

`MIGRATIONS[7]` doesn't exist; `SAVE_VERSION` is currently `7`. Confirm by inspection.

**Step 3: Write the implementation**

In `src/lib/game/save.ts`:

1. Change `SAVE_VERSION = 7` to `SAVE_VERSION = 8`.
2. Extend the migration-table comment and add `MIGRATIONS[7]`:

```ts
// v7 -> v8: Home Planet & Mission Expeditions (docs/plans/2026-07-06-
// home-planet-expeditions-plan.md, Task 4). GameState gains `homePlanet`
// (fleet-wide storage for mission loot); CaptainState gains `mission`
// (null when idle). Every existing save predates both fields.
```

```ts
  7: (state: any): GameState => ({
    ...state,
    homePlanet: state.homePlanet ?? { storage: { commonOre: 0, uncommonMaterial: 0, rareMaterial: 0 } },
    captains: state.captains.map((c: any) => ({ ...c, mission: c.mission ?? null })),
  }),
```

**Step 4: Confirm the tests would pass**

Manually trace: `legacyState.homePlanet` is absent → backfilled to the zeroed storage object.
`legacyState.captains[0].mission` is absent → `c.mission ?? null` gives `null` (identical result
whether the field was truly absent or literally already `null`). `modules.miner: 10` is untouched
since the migration only ever adds `mission` alongside a shallow-spread `...c`, never reconstructs
`modules`. ✓ Chained v1→v8: walks all 7 migrations in sequence — retrace each prior step's
established behavior (already verified in earlier tasks' plans/reviews this session) plus this new
step 7 backfilling `homePlanet`/`mission` on the final v7-shaped intermediate result. ✓

**Step 5: Commit**

```bash
git add src/lib/game/save.ts src/lib/game/save.test.ts
git commit -m "feat: migrate save schema v7->v8, backfill homePlanet storage and mission:null"
```

---

### Task 5: Live tick-loop integration (`App.svelte`) — HIGH RISK, mirrors Phase 1's riskiest task

**Files:**
- Modify: `src/App.svelte`

**Context:** Read the current `src/App.svelte` in full. The live per-captain tick-bar loop (inside
`onMount`'s `setInterval`) currently calls `tickCaptainStack` directly (not through `tick()`) once
per captain, when THAT captain's own cycle completes. This task makes that same call site route a
captain on a mission through `tickCaptainMission` instead, and aggregates loot into
`state.homePlanet.storage` — mirroring exactly what Task 3 already did inside the pure `tick()`
function, just in the live polling loop.

**Step 1: Update imports**

Add `tickCaptainMission`, `dispatchCaptainOnMission`, `recallCaptain` to the existing import from
`"./lib/game/tick"`, and `MISSIONS`, `type MissionKey`, `type LootMaterialKey` to the existing
import from `"./lib/game/model"`.

**Step 2: Fix the live tick loop's per-captain firing**

Find (inside the `onMount` tick-bar loop, the `for` loop over `captains`):

```ts
      for (let i = 0; i < captains.length; i++) {
        const captain = captains[i];
        const cycle = captainCycles[captain.id];
        const barSeconds = Math.max(1, captain.tickDurationSeconds / speed);
        cycle.nowTick = now;
        const progress = (now - cycle.barCycleStart) / 1000 / barSeconds;
        if (progress >= 1) {
          const gameSecondsThisCycle = barSeconds * speed;
          if (!anyFired) {
            captains = [...captains]; // copy on first write this poll
            anyFired = true;
          }
          captains[i] = tickCaptainStack(gameSecondsThisCycle, captain, fleetMult, researchMults);
          cycle.barCycleStart = now;
        }
      }
```

Replace with:

```ts
      let homePlanetDelta = { commonOre: 0, uncommonMaterial: 0, rareMaterial: 0 };
      let anyLootDelivered = false;

      for (let i = 0; i < captains.length; i++) {
        const captain = captains[i];
        const cycle = captainCycles[captain.id];
        const barSeconds = Math.max(1, captain.tickDurationSeconds / speed);
        cycle.nowTick = now;
        const progress = (now - cycle.barCycleStart) / 1000 / barSeconds;
        if (progress >= 1) {
          const gameSecondsThisCycle = barSeconds * speed;
          if (!anyFired) {
            captains = [...captains]; // copy on first write this poll
            anyFired = true;
          }
          if (captain.mission) {
            const ticksElapsed = gameSecondsThisCycle / captain.tickDurationSeconds;
            const result = tickCaptainMission(ticksElapsed, captain);
            captains[i] = result.captain;
            homePlanetDelta = {
              commonOre: homePlanetDelta.commonOre + result.homePlanetDelta.commonOre,
              uncommonMaterial: homePlanetDelta.uncommonMaterial + result.homePlanetDelta.uncommonMaterial,
              rareMaterial: homePlanetDelta.rareMaterial + result.homePlanetDelta.rareMaterial,
            };
            if (result.homePlanetDelta.commonOre || result.homePlanetDelta.uncommonMaterial || result.homePlanetDelta.rareMaterial) {
              anyLootDelivered = true;
            }
          } else {
            captains[i] = tickCaptainStack(gameSecondsThisCycle, captain, fleetMult, researchMults);
          }
          cycle.barCycleStart = now;
        }
      }
```

Find the block immediately after this loop:

```ts
      captainCycles = captainCycles; // reassign to trigger reactivity on the mutated cycle map
      if (anyFired) {
        state = { ...state, captains };
      }
```

Replace with:

```ts
      captainCycles = captainCycles; // reassign to trigger reactivity on the mutated cycle map
      if (anyFired) {
        state = anyLootDelivered
          ? {
              ...state,
              captains,
              homePlanet: {
                storage: {
                  commonOre: state.homePlanet.storage.commonOre + homePlanetDelta.commonOre,
                  uncommonMaterial: state.homePlanet.storage.uncommonMaterial + homePlanetDelta.uncommonMaterial,
                  rareMaterial: state.homePlanet.storage.rareMaterial + homePlanetDelta.rareMaterial,
                },
              },
            }
          : { ...state, captains };
      }
```

**Step 3: Manual verification (no automated test — timing logic, Node unavailable)**

Confirm this mirrors Task 3's `tick()` integration exactly: a captain on a mission never calls
`tickCaptainStack` (no normal production), their `ticksElapsed` is derived the same way (this
captain's own `gameSecondsThisCycle / tickDurationSeconds`), and any completed-cycle loot is
aggregated into `state.homePlanet.storage` in the same poll it was delivered, using the same
addition shape as `tick()`'s offline-catchup path — so a player watching live play and a player who
was offline see the same accounting logic, just triggered by different callers.

**Step 4: Commit**

```bash
git add src/App.svelte
git commit -m "feat: route captains on a mission through tickCaptainMission in the live tick loop"
```

---

### Task 6: Missions panel + Home Planet panel + Recall action (`App.svelte`)

**Files:**
- Modify: `src/App.svelte`

**Step 1: Add `doDispatchCaptainOnMission` and `doRecallCaptain` handlers**

Add near `doBuySkillNode`:

```ts
  function doDispatchCaptainOnMission(missionKey: MissionKey) {
    const { next, success } = dispatchCaptainOnMission(state, activeCaptain.id, missionKey);
    if (!success) return;
    const label = activeCaptain.label;
    state = next;
    pushLog(`[${label}] Dispatched on ${MISSIONS[missionKey].label}.`);
    doSave();
  }

  function doRecallCaptain() {
    const { next, success } = recallCaptain(state, activeCaptain.id);
    if (!success) return;
    const label = activeCaptain.label;
    state = next;
    pushLog(`[${label}] Recalled — will return to base after this cycle.`);
    doSave();
  }
```

**Step 2: Add the MISSIONS panel**

Insert a new `<Panel>` after the RESEARCH panel's closing `</Panel>` and before the CAPTAIN PRESTIGE
panel (per-captain-tab-scoped, same section as Resources/Tick/Generator Stack/Research):

```svelte
      <Panel>
        <div class="panel-title">MISSIONS</div>
        {#if activeCaptain.mission}
          {@const mission = activeCaptain.mission}
          {@const missionDef = MISSIONS[mission.missionKey]}
          <div class="research-name">{missionDef.label}</div>
          <div class="research-cost">Phase: {mission.phase} ({mission.phaseProgressTicks.toFixed(1)} ticks)</div>
          {#if mission.recalled}
            <p class="research-status">Returning to base after this cycle completes.</p>
          {:else}
            <button class="dev-btn danger" on:click={doRecallCaptain}>Recall</button>
          {/if}
        {:else}
          <p class="prestige-text">Dispatch {activeCaptain.label} on an expedition. Their normal Generator Stack pauses until they return.</p>
          <div class="skill-branch">
            {#each Object.entries(MISSIONS) as [key, missionDef]}
              <div class="skill-node">
                <div class="skill-node-label">{missionDef.label}</div>
                <button class="buy-btn" on:click={() => doDispatchCaptainOnMission(key as MissionKey)}>
                  Dispatch
                </button>
              </div>
            {/each}
          </div>
        {/if}
      </Panel>
```

**Step 3: Add the fleet-wide HOME PLANET panel**

Insert a new `<Panel>` after the SKILL TREE panel's closing `</Panel>` (fleet-wide, not
per-captain-tab):

```svelte
      <Panel>
        <div class="panel-title">HOME PLANET</div>
        <div class="resource-grid">
          <div class="resource-card">
            <div class="resource-label">Common Ore</div>
            <div class="resource-value">{formatNumber(state.homePlanet.storage.commonOre)}</div>
          </div>
          <div class="resource-card">
            <div class="resource-label">Uncommon Material</div>
            <div class="resource-value">{formatNumber(state.homePlanet.storage.uncommonMaterial)}</div>
          </div>
          <div class="resource-card">
            <div class="resource-label">Rare Material</div>
            <div class="resource-value">{formatNumber(state.homePlanet.storage.rareMaterial)}</div>
          </div>
        </div>
      </Panel>
```

**Step 4: Update Captain Prestige and Fleet Prestige panels' copy**

Add one sentence to each panel's existing warning/description text (find `.prestige-text` inside
both the `CAPTAIN PRESTIGE` and `FLEET PRESTIGE` panels) noting that an active mission is cancelled
and any in-transit cargo is lost as part of the reset — matching the deliberate choice documented in
Task 3.

**Step 5: Manual verification (no automated test — UI markup, Node unavailable)**

Confirm `activeCaptain.mission`'s truthy/falsy branching is mutually exclusive (dispatch UI only
shows when `null`, phase/recall UI only shows when non-null). Confirm the `resource-grid`
`repeat(4, 1fr)` CSS (used for the 4 existing resources) isn't reused verbatim for a 3-item Home
Planet grid without checking it still looks reasonable at 3 columns — adjust to `repeat(3, 1fr)` in
a scoped class if the shared class would misalign.

**Step 6: Commit**

```bash
git add src/App.svelte
git commit -m "feat: add Missions panel, Home Planet panel, and Recall action"
```

---

### Task 7: Docs and final commit

**Files:**
- Modify: `SESSION_LOG.md`
- Modify: `KNOWN_ISSUES.md` (only if warranted)

**Step 1: Check `KNOWN_ISSUES.md`**

Consider whether anything from this feature is worth flagging — candidates: the partial-final-tick
edge case in `requiredTicksForPhase`'s `"extracting"` case if a future mission's `cargoCapacity`
doesn't divide evenly by `extractionRatePerTick` (already commented in-code on the `MISSIONS`
definition); whether recall-takes-effect-at-cycle-end (not immediately) is confusing enough to be
worth a note for future UI polish. Use judgment per this file's established purpose.

**Step 2: Append a session log entry**

Read the existing `SESSION_LOG.md`'s most recent entries for format/tone. Verify the actual commit
count on this branch against this plan's 7-task structure before writing (this session's
established practice — count what genuinely happened, not what the plan assumed would happen).

**Step 3: Commit**

```bash
git add SESSION_LOG.md KNOWN_ISSUES.md
git commit -m "docs: log Home Planet & Mission Expeditions session"
```

**Step 4: Do not push.** Pushing to `origin/main` triggers a live Vercel production redeploy and
needs the user's explicit go-ahead first.
