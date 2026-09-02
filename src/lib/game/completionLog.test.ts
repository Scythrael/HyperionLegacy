// ============================================================================
// completionLog.test.ts : Crafting 0.13.3, Unit 4.4b (the COMPLETED-EVENTS LOG)
//
// SUGGESTIONS.md, "COMPLETED-EVENTS LOG" (user, 2026-09-02). Every timed job in the
// game used to complete SILENTLY, which is what let Unit 4.4 lose the Salvage Bay's
// material manifest without anything else noticing. This unit gives every finished
// ORDER a readable, timestamped, id-carrying record.
//
// ⚠️ WHERE THE PARITY CASES ARE. The offline==live cases (the whole point of design
// catch 2, the injected clock) live at the bottom of craftQueue.test.ts, because the
// release's parity gate excludes that file and salvage.test.ts and must keep reading
// exactly 101. Putting new "parity" cases in a NEW file would silently move that
// baseline. Everything NON-parity is here.
//
// The four properties this file pins hardest, because each is a way the feature could
// be quietly wrong rather than loudly broken:
//   1. ONE ENTRY PER ORDER (design catch 1). A batch of N leaves ONE row carrying the
//      accumulated yield, never N rows, or a single big batch would evict the whole
//      ring buffer.
//   2. A CANCELLED RUN STILL REPORTS. Both cancel branches (drain a committed
//      iteration, or remove an idle line) end with exactly one honest entry.
//   3. THE RING BUFFER IS A RING. It caps at COMPLETION_LOG_CAP and evicts the OLDEST.
//   4. EVERY KIND IS COVERED, with an honest shape per kind (an upgrade grants a level,
//      research grants an unlock, a refine batch grants items).
// ============================================================================

import { describe, it, expect } from "vitest";
import Decimal from "break_infinity.js";
import {
  freshState,
  COMPLETION_LOG_CAP,
  ITEMS,
  SHIP_TYPES,
  type GameState,
  type TimedProcess,
  type TimedProcessKind,
  type ProcessEffect,
} from "./model";
import { resolveProcesses, economyTick, startLine, cancelLine, UNKNOWN_COMPLETION_TIME_MS } from "./tick";
import { migrate } from "./save";
import { itemTotal } from "./inventory";

// A readable, fixed clock. Any value works; a round one keeps the arithmetic in the
// assertions legible.
const T0 = 1_700_000_000_000;

// A repeatable rng so the salvage loot roll below lands the same way every run. Not a
// good generator and not meant to be (see craftQueue.test.ts's own note).
function seededRng(): () => number {
  let seed = 987654321;
  return () => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed / 2147483648;
  };
}

// A state with chosen stock and a built refinery, mirroring craftQueue.test.ts's fixture
// so the two files agree about what a workable fleet looks like.
function craftState(opts: { commonOre?: number; titaniumIngot?: number; refineryLevel?: number } = {}): GameState {
  const s = freshState();
  const inventory: Record<string, Decimal[]> = { ...s.inventory };
  if (opts.commonOre !== undefined) inventory.commonOre = [new Decimal(opts.commonOre)];
  if (opts.titaniumIngot !== undefined) inventory.titaniumIngot = [new Decimal(opts.titaniumIngot)];
  return {
    ...s,
    inventory,
    facilities: { ...s.facilities, refinery: { level: opts.refineryLevel ?? 1 } },
  };
}

// Build one ready-to-complete process. remainingTicks 1 means a single resolveProcesses
// call lands it, which is what every case here wants.
function readyProcess(id: string, kind: TimedProcessKind, effect: ProcessEffect, lineId?: string): TimedProcess {
  return { id, kind, remainingTicks: 1, durationTicks: 10, effect, ...(lineId !== undefined ? { lineId } : {}) };
}

const REFINE_KEY = "refineCommonOre"; // commonOre x20 -> titaniumIngot x1

// ---------------------------------------------------------------------------
// 1. ONE ENTRY PER ORDER (design catch 1)
// ---------------------------------------------------------------------------

describe("one entry per ORDER, not per job iteration", () => {
  it("folds a batch of 5 refine iterations into ONE entry carrying the whole yield", () => {
    // 5 iterations x 20 ore = 100 ore, so the batch can run to its end without stalling.
    const started = startLine(craftState({ commonOre: 100 }), "refine", REFINE_KEY, { kind: "batch", remaining: 5 });
    expect(started.started).toBe(true);

    // Run long enough for all five iterations plus the tick that removes the finished
    // line (refineCommonOre is 12 ticks, so 5 x 12 = 60 with headroom).
    let s = started.next;
    for (let i = 0; i < 90; i++) s = economyTick(s, 1, seededRng(), T0 + i * 1000);

    // The line is gone, so the order genuinely finished (not merely paused).
    expect(s.refineLines).toHaveLength(0);
    // NON-VACUITY: five ingots really were produced.
    expect(itemTotal(s.inventory, "titaniumIngot").toString()).toBe("5");

    // ONE row, not five. This is the property that stops a 10,000-run batch from
    // evicting every other entry in the ring buffer.
    expect(s.completionLog).toHaveLength(1);
    const entry = s.completionLog[0];
    expect(entry.kind).toBe("refineJob");
    expect(entry.reward).toBe("materials");
    expect(entry.iterations).toBe(5);
    expect(entry.items).toEqual([{ itemId: "titaniumIngot", amount: "5" }]);
    // The accumulation is closed out, so nothing is left accruing.
    expect(s.openJobBatches).toEqual([]);
    // The order's own span: it started before it finished, and both stamps are real.
    expect(entry.atMs).toBeGreaterThan(entry.startedAtMs);
    expect(entry.startedAtMs).toBeGreaterThan(0);
  });

  it("keeps the accumulation OPEN and logs nothing while the batch is still running", () => {
    const started = startLine(craftState({ commonOre: 100 }), "refine", REFINE_KEY, { kind: "batch", remaining: 5 });
    // 25 ticks is two completed iterations of a 12-tick recipe, well short of five.
    let s = started.next;
    for (let i = 0; i < 25; i++) s = economyTick(s, 1, seededRng(), T0 + i * 1000);

    expect(itemTotal(s.inventory, "titaniumIngot").toString()).toBe("2");
    // Nothing is DONE yet, so nothing is on the board. The two ingots are held in the
    // open accumulation instead, which is what makes the single summary possible.
    expect(s.completionLog).toEqual([]);
    expect(s.openJobBatches).toHaveLength(1);
    expect(s.openJobBatches[0].iterations).toBe(2);
    expect(s.openJobBatches[0].items).toEqual([{ itemId: "titaniumIngot", amount: "2" }]);
  });

  it("gives a manual (line-less) job its own entry, because a one-shot is a batch of one", () => {
    // The retired startRefineJob path stamps no lineId. There is no order to fold into,
    // so each such completion is honestly its own record.
    const s: GameState = {
      ...craftState(),
      activeProcesses: [
        readyProcess("proc-1", "refineJob", { type: "addItem", itemId: "titaniumIngot", amount: new Decimal(3) }),
        readyProcess("proc-2", "refineJob", { type: "addItem", itemId: "titaniumIngot", amount: new Decimal(3) }),
      ],
    };
    const out = resolveProcesses(s, 1, seededRng(), T0).next;
    expect(out.completionLog).toHaveLength(2);
    expect(out.completionLog.map((e) => e.iterations)).toEqual([1, 1]);
    expect(out.openJobBatches).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 2. A CANCELLED RUN STILL REPORTS (the user's "stop partway through")
// ---------------------------------------------------------------------------

describe("cancelling a batch partway still emits an entry for what was produced", () => {
  it("emits when the line is REMOVED outright (no iteration in flight)", () => {
    // A batch of 5 that RUNS OUT of input partway: the line stalls with NO job in flight
    // (startProcess's affordability backstop refuses the next iteration), so no completion
    // is ever coming to flush its accumulation. cancelLine then removes the line outright,
    // and that is the branch that would otherwise strand the run's yield forever.
    // (canStartLine reserves the whole batch at start, so the ore is emptied mid-run here
    // rather than being short from the beginning, which would refuse the line entirely.)
    const started = startLine(craftState({ commonOre: 100 }), "refine", REFINE_KEY, { kind: "batch", remaining: 5 });
    expect(started.started).toBe(true);
    let s = started.next;
    for (let i = 0; i < 25; i++) s = economyTick(s, 1, seededRng(), T0 + i * 1000);
    // Strip the remaining input. The committed iteration still finishes; the next cannot start.
    s = { ...s, inventory: { ...s.inventory, commonOre: [new Decimal(0)] } };
    for (let i = 25; i < 45; i++) s = economyTick(s, 1, seededRng(), T0 + i * 1000);

    expect(itemTotal(s.inventory, "titaniumIngot").toString()).toBe("3");
    expect(s.activeProcesses).toHaveLength(0); // stalled: nothing in flight
    expect(s.refineLines).toHaveLength(1);     // the line survives, waiting for input
    expect(s.completionLog).toEqual([]);       // still open, nothing reported yet

    const cancelled = cancelLine(s, s.refineLines[0].id, T0 + 99_000);

    expect(cancelled.refineLines).toHaveLength(0);
    expect(cancelled.completionLog).toHaveLength(1);
    expect(cancelled.completionLog[0].iterations).toBe(3);
    expect(cancelled.completionLog[0].items).toEqual([{ itemId: "titaniumIngot", amount: "3" }]);
    // Dated at the cancel, which is when the run actually stopped.
    expect(cancelled.completionLog[0].atMs).toBe(T0 + 99_000);
    expect(cancelled.openJobBatches).toEqual([]);
  });

  it("emits ONCE, from the resolver, when a committed iteration is still draining", () => {
    // The other cancel branch: an iteration IS in flight, so cancelLine drains it (the
    // line survives at remaining 0) and the RESOLVER emits when that iteration lands.
    // Emitting here too would double-log the same run.
    const started = startLine(craftState({ commonOre: 100 }), "refine", REFINE_KEY, { kind: "batch", remaining: 5 });
    let s = started.next;
    for (let i = 0; i < 25; i++) s = economyTick(s, 1, seededRng(), T0 + i * 1000);
    expect(s.activeProcesses).toHaveLength(1); // the third iteration is committed

    const cancelled = cancelLine(s, s.refineLines[0].id, T0 + 25_000);
    // Nothing logged at the cancel itself: the run has not finished draining.
    expect(cancelled.completionLog).toEqual([]);
    expect(cancelled.openJobBatches).toHaveLength(1);

    // Drain it. The committed iteration finishes, the line is removed, ONE entry lands.
    let drained = cancelled;
    for (let i = 0; i < 30; i++) drained = economyTick(drained, 1, seededRng(), T0 + (26 + i) * 1000);

    expect(drained.refineLines).toHaveLength(0);
    expect(drained.completionLog).toHaveLength(1);
    expect(drained.completionLog[0].iterations).toBe(3); // 2 before the cancel + the drained one
    expect(drained.openJobBatches).toEqual([]);
  });

  it("emits NOTHING when a line is cancelled before it produced anything", () => {
    // "You produced nothing" is not an event worth a ring slot, and a row saying so would
    // be noise on a board whose whole job is to report what you received.
    const started = startLine(craftState({ commonOre: 100 }), "refine", REFINE_KEY, { kind: "batch", remaining: 5 });
    const cancelled = cancelLine(started.next, started.next.refineLines[0].id, T0);
    expect(cancelled.completionLog).toEqual([]);
    expect(cancelled.nextCompletionLogId).toBe(1); // no id was burned either
  });

  it("stays a same-reference no-op for an unknown line id", () => {
    const s = craftState();
    expect(cancelLine(s, "craft-999", T0)).toBe(s);
  });
});

// ---------------------------------------------------------------------------
// 3. THE RING BUFFER
// ---------------------------------------------------------------------------

describe("the ring buffer caps and evicts the OLDEST", () => {
  it(`keeps exactly ${COMPLETION_LOG_CAP} entries and drops the earliest ones`, () => {
    // Ten more completions than the cap, all in one resolve, so the eviction has to
    // happen mid-call rather than only across calls.
    const overflow = COMPLETION_LOG_CAP + 10;
    const s: GameState = {
      ...craftState(),
      activeProcesses: Array.from({ length: overflow }, (_, i) =>
        readyProcess(`proc-${i + 1}`, "refineJob", { type: "addItem", itemId: "titaniumIngot", amount: new Decimal(1) })
      ),
    };
    const out = resolveProcesses(s, 1, seededRng(), T0).next;

    expect(out.completionLog).toHaveLength(COMPLETION_LOG_CAP);
    // Ids are still monotonic across the whole run (never reused), so the SURVIVING
    // window is the newest 50: done-11 .. done-60.
    expect(out.completionLog[0].id).toBe(`done-${overflow - COMPLETION_LOG_CAP + 1}`);
    expect(out.completionLog[COMPLETION_LOG_CAP - 1].id).toBe(`done-${overflow}`);
    expect(out.nextCompletionLogId).toBe(overflow + 1);
  });

  it("keeps the array chronological, oldest first, so eviction is a slice off the front", () => {
    let s: GameState = { ...craftState(), activeProcesses: [] };
    for (let i = 0; i < 3; i++) {
      s = resolveProcesses(
        {
          ...s,
          activeProcesses: [readyProcess(`proc-${i}`, "refineJob", { type: "addItem", itemId: "titaniumIngot", amount: new Decimal(1) })],
        },
        1,
        seededRng(),
        T0 + i * 1000
      ).next;
    }
    expect(s.completionLog.map((e) => e.atMs)).toEqual([T0, T0 + 1000, T0 + 2000]);
  });
});

// ---------------------------------------------------------------------------
// 4. EVERY KIND IS COVERED, WITH AN HONEST SHAPE
// ---------------------------------------------------------------------------

// The full kind list, pinned here so the coverage case below is genuinely exhaustive.
const ALL_KINDS = [
  "refineJob",
  "fabricateJob",
  "shipBuild",
  "researchProject",
  "facilityUpgrade",
  "fuelRefineJob",
  "equipmentStorageUpgrade",
  "docksExpansion",
  "shipRepair",
  "salvageJob",
] as const satisfies readonly TimedProcessKind[];

// ⚠️ THE COMPILE-TIME HALF OF THE GUARD, the same trick QUEUE_FACILITY_ORDER uses in
// tick.ts: a NEW TimedProcessKind that is not listed above makes `Unlisted` a real type,
// which makes this assignment a type error. So a future kind cannot be added without
// someone deciding here what its completion record looks like.
type UnlistedKind = Exclude<TimedProcessKind, (typeof ALL_KINDS)[number]>;
const ALL_KINDS_IS_EXHAUSTIVE: UnlistedKind extends never ? true : false = true;

const HULL_TYPE = Object.keys(SHIP_TYPES)[0];
// A salvaged material: the only category salvageSalvagedMaterial will roll loot for.
const SALVAGED_MATERIAL =
  Object.keys(ITEMS).find((id) => ITEMS[id].category === "salvagedMaterial") ?? "intactReactorCore";

describe("every TimedProcessKind leaves an honest record", () => {
  it("is exhaustive over the union (compile-time guard)", () => {
    expect(ALL_KINDS_IS_EXHAUSTIVE).toBe(true);
    expect(ALL_KINDS).toHaveLength(10);
  });

  it("records one entry per kind, each with the reward shape that kind actually grants", () => {
    const base = craftState({ commonOre: 100, titaniumIngot: 20 });
    const s: GameState = {
      ...base,
      // A held salvaged material, so the salvage arm resolves for real rather than stale.
      inventory: { ...base.inventory, [SALVAGED_MATERIAL]: [new Decimal(5)] },
      // A damaged hull for the repair arm to clear.
      ships: base.ships.map((ship, i) => (i === 0 ? { ...ship, damaged: true, repairDamage: 10 } : ship)),
      activeProcesses: [
        readyProcess("p-refine", "refineJob", { type: "addItem", itemId: "titaniumIngot", amount: new Decimal(2) }),
        readyProcess("p-fab", "fabricateJob", { type: "addItem", itemId: "frameSegment", amount: new Decimal(1) }),
        readyProcess("p-build", "shipBuild", { type: "addShip", typeKey: HULL_TYPE as never }),
        readyProcess("p-research", "researchProject", { type: "unlockBlueprint", key: "frameSegmentBp" }),
        readyProcess("p-upgrade", "facilityUpgrade", { type: "facilityLevelUp", facility: "refinery" }),
        readyProcess("p-fuel", "fuelRefineJob", { type: "addFuel", amount: new Decimal(25) }),
        readyProcess("p-storage", "equipmentStorageUpgrade", { type: "equipmentStorageLevelUp" }),
        readyProcess("p-docks", "docksExpansion", { type: "docksCapacityUp" }),
        readyProcess("p-repair", "shipRepair", { type: "clearShipDamage", shipId: base.ships[0].id }),
        readyProcess("p-salvage", "salvageJob", { type: "salvageResolve", target: { kind: "material", itemId: SALVAGED_MATERIAL } }),
      ],
    };

    const out = resolveProcesses(s, 1, seededRng(), T0).next;

    // One record per kind, in activeProcesses order (the same order the completions ran).
    expect(out.completionLog).toHaveLength(ALL_KINDS.length);
    const byKind = new Map(out.completionLog.map((e) => [e.kind, e]));
    for (const kind of ALL_KINDS) {
      expect(byKind.has(kind)).toBe(true);
      expect(byKind.get(kind)!.atMs).toBe(T0);
      // Every record is dated as a real span, not a zero-length instant.
      expect(byKind.get(kind)!.startedAtMs).toBeLessThan(T0);
    }

    // --- and each shape is honest about what that kind actually grants ---
    // A refine batch grants ITEMS.
    expect(byKind.get("refineJob")).toMatchObject({
      reward: "materials",
      items: [{ itemId: "titaniumIngot", amount: "2" }],
    });
    // A material fabricate also grants items (its byEffect arm's other branch).
    expect(byKind.get("fabricateJob")).toMatchObject({ reward: "materials" });
    // A build grants a HULL, named by its type key (an id, never a rendered label).
    expect(byKind.get("shipBuild")).toMatchObject({ reward: "hull", subjectKey: HULL_TYPE });
    // Research grants an UNLOCK, not items.
    expect(byKind.get("researchProject")).toMatchObject({ reward: "blueprint", subjectKey: "frameSegmentBp", items: [] });
    // An upgrade grants a LEVEL, and reports the level the player NOW has (refinery 1 -> 2).
    expect(byKind.get("facilityUpgrade")).toMatchObject({ reward: "level", subjectKey: "refinery", level: 2, items: [] });
    // Fuel goes to the tank, so it is reported as an amount, not as an inventory item.
    expect(byKind.get("fuelRefineJob")).toMatchObject({ reward: "fuel", fuelAmount: "25", items: [] });
    // The two standalone storage tracks report their new rung / capacity.
    expect(byKind.get("equipmentStorageUpgrade")).toMatchObject({ reward: "level", subjectKey: "equipmentStorage", level: 1 });
    expect(byKind.get("docksExpansion")).toMatchObject({ reward: "level", subjectKey: "docks", level: base.shipStorageCapacity + 1 });
    // A repair grants a working hull, named by ship id.
    expect(byKind.get("shipRepair")).toMatchObject({ reward: "repair", subjectKey: base.ships[0].id, items: [] });
    // Salvage grants the RECOVERY MANIFEST: the very thing Unit 4.4 lost.
    const salvaged = byKind.get("salvageJob")!;
    expect(salvaged.reward).toBe("materials");
    expect(salvaged.stale).toBe(false);
    expect(salvaged.subjectKey).toBe(SALVAGED_MATERIAL);
    expect(salvaged.items.length).toBeGreaterThan(0);
    expect(salvaged.items.every((line) => ITEMS[line.itemId] !== undefined)).toBe(true);
  });

  it("records a STALE salvage as an honest 'nothing was consumed' entry", () => {
    // The fail-safe no-op the resolver documents: the target was gone when its turn came.
    // It used to be completely silent, which reads as a bug.
    const base = craftState();
    const s: GameState = {
      ...base,
      activeProcesses: [
        readyProcess("p-stale", "salvageJob", { type: "salvageResolve", target: { kind: "equipment", instanceId: "equip-does-not-exist" } }),
      ],
    };
    const out = resolveProcesses(s, 1, seededRng(), T0).next;
    expect(out.completionLog).toHaveLength(1);
    expect(out.completionLog[0]).toMatchObject({
      kind: "salvageJob",
      reward: "nothing",
      stale: true,
      subjectKey: "equip-does-not-exist",
      items: [],
    });
  });

  it("does not record a ship build that was HELD because the docks were full", () => {
    // The resolver's documented backstop: a finished build waits rather than parking a
    // hull over cap. It has not completed, so it must not appear as completed.
    const base = craftState();
    const s: GameState = {
      ...base,
      shipStorageCapacity: base.ships.length, // no room
      activeProcesses: [readyProcess("p-held", "shipBuild", { type: "addShip", typeKey: HULL_TYPE as never })],
    };
    const out = resolveProcesses(s, 1, seededRng(), T0).next;
    expect(out.activeProcesses).toHaveLength(1); // still held
    expect(out.completionLog).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 5. THE INJECTED CLOCK AND THE SAVE
// ---------------------------------------------------------------------------

describe("the injected clock", () => {
  it("stamps the value it was handed, and NEVER reads an ambient clock", () => {
    // Two identical resolves with two different injected clocks differ ONLY in the stamp,
    // which is the property that lets an offline catch-up date entries in the past.
    const s: GameState = {
      ...craftState(),
      activeProcesses: [readyProcess("proc-1", "refineJob", { type: "addItem", itemId: "titaniumIngot", amount: new Decimal(1) })],
    };
    const a = resolveProcesses(s, 1, seededRng(), T0).next;
    const b = resolveProcesses(s, 1, seededRng(), T0 - 3_600_000).next;
    expect(a.completionLog[0].atMs).toBe(T0);
    expect(b.completionLog[0].atMs).toBe(T0 - 3_600_000);
    // Everything else about the two records is identical, so the clock is the only input.
    expect({ ...a.completionLog[0], atMs: 0, startedAtMs: 0 }).toEqual({ ...b.completionLog[0], atMs: 0, startedAtMs: 0 });
  });

  it("defaults to the unknown sentinel rather than to Date.now()", () => {
    const s: GameState = {
      ...craftState(),
      activeProcesses: [readyProcess("proc-1", "refineJob", { type: "addItem", itemId: "titaniumIngot", amount: new Decimal(1) })],
    };
    const out = resolveProcesses(s, 1, seededRng()).next;
    expect(out.completionLog[0].atMs).toBe(UNKNOWN_COMPLETION_TIME_MS);
    expect(out.completionLog[0].startedAtMs).toBe(UNKNOWN_COMPLETION_TIME_MS);
  });

  it("is a value-identical no-op on the three log fields when nothing completes", () => {
    const s = craftState();
    const out = resolveProcesses({ ...s, activeProcesses: [] }, 1, seededRng(), T0).next;
    expect(out.completionLog).toBe(s.completionLog);
    expect(out.nextCompletionLogId).toBe(s.nextCompletionLogId);
    expect(out.openJobBatches).toBe(s.openJobBatches);
  });
});

describe("save migration", () => {
  it("gives a save with no log field an EMPTY log, an id counter of 1 and no open batches", () => {
    // A v39 save predates the feature entirely, so there is no history to reconstruct: an
    // empty log is the honest starting state, and it fills in from the next completed order.
    const seed = freshState();
    const legacy: Record<string, unknown> = { ...seed };
    delete legacy.completionLog;
    delete legacy.nextCompletionLogId;
    delete legacy.openJobBatches;

    const migrated = migrate({
      version: 39,
      created_at: T0,
      last_saved_at: T0,
      game_time_seconds: 0,
      state: legacy as unknown as GameState,
    });

    expect(migrated.completionLog).toEqual([]);
    expect(migrated.nextCompletionLogId).toBe(1);
    expect(migrated.openJobBatches).toEqual([]);
  });

  it("leaves an ALREADY-populated log untouched (the step is idempotent)", () => {
    const seed = freshState();
    const populated: GameState = {
      ...seed,
      completionLog: [
        {
          id: "done-7",
          kind: "refineJob",
          reward: "materials",
          atMs: T0,
          startedAtMs: T0 - 12_000,
          iterations: 4,
          items: [{ itemId: "titaniumIngot", amount: "4" }],
          pieces: 0,
          subjectKey: "titaniumIngot",
          level: null,
          fuelAmount: null,
          creditsAmount: null,
          stale: false,
        },
      ],
      nextCompletionLogId: 8,
    };
    const migrated = migrate({
      version: 39,
      created_at: T0,
      last_saved_at: T0,
      game_time_seconds: 0,
      state: populated,
    });
    expect(migrated.completionLog).toEqual(populated.completionLog);
    expect(migrated.nextCompletionLogId).toBe(8);
  });

  it("carries a log through a serialize / deserialize round trip with no live Decimal", () => {
    // The shape rule the record is bound by: amounts are Decimal STRINGS, so the whole log
    // rides hydrateDecimals's spread with no hydration branch. A live Decimal here would
    // come back as a bare string and throw on the first .plus().
    const seed = freshState();
    const s: GameState = {
      ...seed,
      completionLog: [
        {
          id: "done-1",
          kind: "salvageJob",
          reward: "materials",
          atMs: T0,
          startedAtMs: T0 - 5000,
          iterations: 1,
          items: [{ itemId: "titaniumIngot", amount: "1e30" }],
          pieces: 0,
          subjectKey: "eq-1",
          level: null,
          fuelAmount: null,
          creditsAmount: "1200",
          stale: false,
        },
      ],
      nextCompletionLogId: 2,
    };
    const roundTripped = migrate(JSON.parse(JSON.stringify({
      version: 40,
      created_at: T0,
      last_saved_at: T0,
      game_time_seconds: 0,
      state: s,
    })));
    expect(roundTripped.completionLog).toEqual(s.completionLog);
    // Still a plain string, and still exact at a scale a JS number would round.
    expect(typeof roundTripped.completionLog[0].items[0].amount).toBe("string");
    expect(new Decimal(roundTripped.completionLog[0].items[0].amount).toString()).toBe("1e+30");
  });
});
