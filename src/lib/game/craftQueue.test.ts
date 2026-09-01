// ============================================================================
// craftQueue.test.ts : Crafting 0.13.3, Phase 1 Units 1.2 + 1.3 + 1.4
//
// Unit 1.2 covers the queue-DEPTH half of the queue engine: the
// fleetLogisticsQueue1/2/3 talent chain (model.ts) and the derive-on-read
// queueDepth helper (tick.ts).
//
// Unit 1.3 covers the pure QUEUE MUTATION API (canEnqueueOrder / enqueueOrder /
// removeQueuedOrder / moveQueuedOrder / queuedForFacility) and the QUEUE_ADAPTERS
// table. Neither unit touches TICK behavior.
//
// Unit 1.4 (appended at the bottom of this file) is where the queue finally MOVES:
// promoteQueuedOrders, wired into economyTick's tail. That makes this the
// PARITY-CRITICAL section of the file, and its cases carry "parity" in their names
// on purpose so the release's parity filter sweeps them up with the rest.
//
// The two rules worth pinning hardest (design 2026-09-01-crafting-0.13.3-design.md
// section 5.2) are the ones a later unit could quietly break:
//   1. depth is PER FACILITY, so the same number applies to every queue-capable
//      facility independently and is never split across them, and
//   2. base depth is 1, so the feature is discoverable before any talent is bought.
//
// State is built from freshState() and its unlockedHomeworldTalents assigned
// directly (never through buyHomeworldTalent) so these cases test the pure
// derivation and stay independent of adminPoint costs and FA-level walls, which
// have their own coverage in tick.test.ts.
// ============================================================================

import { describe, it, expect, vi } from "vitest";
import Decimal from "break_infinity.js";
import {
  freshState,
  HOMEWORLD_TALENTS,
  QUEUE_DEPTH_PER_NODE,
  type GameState,
  type HomeworldTalentKey,
  type QueueFacilityKey,
  type QueuedOrder,
} from "./model";
import {
  QUEUE_DEPTH_BASE,
  queueDepth,
  describeHomeworldTalentEffect,
  // Unit 1.3: the mutation API + the adapter table under test below.
  QUEUE_ADAPTERS,
  QUEUE_FACILITY_ORDER,
  canEnqueueOrder,
  enqueueOrder,
  moveQueuedOrder,
  queuedForFacility,
  removeQueuedOrder,
  respecHomeworldTalents,
  startLine,
  // Unit 1.4: the promotion pass + the two tick entry points its parity is measured
  // against (economyTick is the live cadence, tick is the offline catch-up).
  promoteQueuedOrders,
  economyTick,
  tick,
  refineSlotCount,
  fabricateSlotCount,
} from "./tick";
import { itemTotal } from "./inventory";

// The three rungs of the queue-depth chain, in ladder order. Named once here so a
// rename shows up as one compile error instead of nine string literals below.
const QUEUE_CHAIN: HomeworldTalentKey[] = [
  "fleetLogisticsQueue1",
  "fleetLogisticsQueue2",
  "fleetLogisticsQueue3",
];

// Every facility that can hold a queue today. Listed explicitly (not derived from a
// runtime map) so adding a QueueFacilityKey without thinking about depth semantics
// shows up here as a type-level nudge to extend the per-facility case below.
const QUEUE_FACILITIES: QueueFacilityKey[] = ["refinery", "fabricator", "salvageBay"];

function withTalents(keys: HomeworldTalentKey[]): GameState {
  return { ...freshState(), unlockedHomeworldTalents: keys };
}

describe("queueDepth: base depth", () => {
  it("is QUEUE_DEPTH_BASE (1) on a fresh save with no talents learned", () => {
    // Discoverability decision (design section 14 item 2): every player can queue one
    // order behind the running work BEFORE spending a point, so the feature is not
    // invisible until a talent nobody knows to want is bought.
    const state = freshState();
    expect(state.unlockedHomeworldTalents).toEqual([]);
    expect(QUEUE_DEPTH_BASE).toBe(1);
    expect(queueDepth(state)).toBe(1);
  });

  it("is unchanged by talents that grant something other than queue depth", () => {
    // The reduce discriminates on effect.type, so unrelated learned nodes (a hub, a
    // captain slot, a yield mult, the salvage node) must contribute exactly nothing.
    const unrelated: HomeworldTalentKey[] = [
      "fleetLogisticsHub",
      "fleetLogisticsSlot1",
      "fleetLogisticsYield",
      "fleetLogisticsSalvage",
      "economyTrickle",
      "industryBonusOutput",
    ];
    for (const key of unrelated) {
      expect(HOMEWORLD_TALENTS[key].effect.type).not.toBe("queueDepth");
    }
    expect(queueDepth(withTalents(unrelated))).toBe(QUEUE_DEPTH_BASE);
  });
});

describe("queueDepth: the fleetLogisticsQueue chain", () => {
  it("each rung adds its own granted depth, and the rungs STACK additively", () => {
    // Summing (not short-circuiting on the first match) is what lets a 4th rung, or a
    // rung granting more than +1, land with zero change to the helper.
    let learned: HomeworldTalentKey[] = [];
    let expected = QUEUE_DEPTH_BASE;
    for (const key of QUEUE_CHAIN) {
      learned = [...learned, key];
      expected += QUEUE_DEPTH_PER_NODE;
      expect(queueDepth(withTalents(learned))).toBe(expected);
    }
    // All three learned: 1 base + 3 * 1 = 4.
    expect(queueDepth(withTalents(QUEUE_CHAIN))).toBe(4);
  });

  it("reads each rung's grant off the talent's own effect payload, never a local copy", () => {
    // The number lives in exactly one place (QUEUE_DEPTH_PER_NODE, embedded in each
    // node's payload), so retuning it retunes the live helper with no second edit.
    for (const key of QUEUE_CHAIN) {
      const effect = HOMEWORLD_TALENTS[key].effect;
      expect(effect.type).toBe("queueDepth");
      if (effect.type !== "queueDepth") throw new Error("unreachable, narrowing only");
      expect(effect.depth).toBe(QUEUE_DEPTH_PER_NODE);
      // One node learned alone is worth exactly its own payload above the base.
      expect(queueDepth(withTalents([key]))).toBe(QUEUE_DEPTH_BASE + effect.depth);
    }
  });

  it("is order-independent and unaffected by a duplicate-free learned set's ordering", () => {
    const forward = withTalents([...QUEUE_CHAIN]);
    const reversed = withTalents([...QUEUE_CHAIN].reverse());
    expect(queueDepth(forward)).toBe(queueDepth(reversed));
  });

  it("chain shape mirrors the captain-slot chain: escalating cost, rung 1 ungated, then L5 / L25", () => {
    // The slot chain is the authored precedent this chain deliberately mirrors, so the
    // assertions read the SLOT chain's live values rather than transcribing 3 / 5 / 8:
    // retuning one ladder without the other becomes a visible, deliberate decision.
    const slots: HomeworldTalentKey[] = [
      "fleetLogisticsSlot1",
      "fleetLogisticsSlot2",
      "fleetLogisticsSlot3",
    ];
    QUEUE_CHAIN.forEach((key, i) => {
      const queueNode = HOMEWORLD_TALENTS[key];
      const slotNode = HOMEWORLD_TALENTS[slots[i]];
      expect(queueNode.branch).toBe("fleetLogistics");
      expect(queueNode.cost).toBe(slotNode.cost);
      expect(queueNode.requiresFleetAdminLevel).toBe(slotNode.requiresFleetAdminLevel);
      expect(queueNode.flavor.length).toBeGreaterThan(0);
    });
    // Spelled out, because these are the walls a player actually feels.
    expect(HOMEWORLD_TALENTS.fleetLogisticsQueue1.requiresFleetAdminLevel).toBeUndefined();
    expect(HOMEWORLD_TALENTS.fleetLogisticsQueue2.requiresFleetAdminLevel).toBe(5);
    expect(HOMEWORLD_TALENTS.fleetLogisticsQueue3.requiresFleetAdminLevel).toBe(25);
    expect(HOMEWORLD_TALENTS.fleetLogisticsQueue1.cost).toBeLessThan(
      HOMEWORLD_TALENTS.fleetLogisticsQueue2.cost
    );
    expect(HOMEWORLD_TALENTS.fleetLogisticsQueue2.cost).toBeLessThan(
      HOMEWORLD_TALENTS.fleetLogisticsQueue3.cost
    );
  });

  it("sits in the radial web as a hub-rooted chain with symmetric, same-category adjacency", () => {
    // The web's fog-of-war reveal and buy-gating both walk `neighbors`, so a one-way or
    // cross-category link would render and behave inconsistently. (model.test.ts asserts
    // this globally; repeated here on the new nodes so a broken chain fails in the file
    // that owns the feature too.)
    expect(HOMEWORLD_TALENTS.fleetLogisticsHub.neighbors).toContain("fleetLogisticsQueue1");
    expect(HOMEWORLD_TALENTS.fleetLogisticsQueue1.neighbors).toContain("fleetLogisticsHub");
    expect(HOMEWORLD_TALENTS.fleetLogisticsQueue1.neighbors).toContain("fleetLogisticsQueue2");
    expect(HOMEWORLD_TALENTS.fleetLogisticsQueue2.neighbors).toContain("fleetLogisticsQueue3");
    for (const key of QUEUE_CHAIN) {
      for (const n of HOMEWORLD_TALENTS[key].neighbors) {
        expect(HOMEWORLD_TALENTS[n]).toBeDefined();
        expect(HOMEWORLD_TALENTS[n].branch).toBe("fleetLogistics");
        expect(HOMEWORLD_TALENTS[n].neighbors).toContain(key);
      }
    }
    // Coordinates are distinct from every other node in the category, so no two
    // fleetLogistics nodes render stacked on top of each other.
    const fleetNodes = Object.values(HOMEWORLD_TALENTS).filter((t) => t.branch === "fleetLogistics");
    const coords = new Set(fleetNodes.map((t) => `${t.x},${t.y}`));
    expect(coords.size).toBe(fleetNodes.length);
  });
});

describe("queueDepth: PER FACILITY semantics", () => {
  it("returns the same depth for every queue-capable facility (never split between them)", () => {
    // Design section 5.2: a shared pool would let a full Refinery queue silently starve
    // the Fabricator. The helper is facility-independent BY CONSTRUCTION (it takes no
    // facility argument), and callers count only same-facility entries against it. This
    // case pins the rule callers must honor: one number, applied to each facility.
    const state = withTalents(QUEUE_CHAIN);
    const depth = queueDepth(state);
    expect(depth).toBe(4);
    // Facility-independent BY CONSTRUCTION: the helper takes state and nothing else, so
    // there is no argument through which one facility could ever get a different answer.
    // Pinning the arity makes a future "queueDepth(state, facility)" overload a failing
    // test rather than a silent re-interpretation of the per-facility rule.
    expect(queueDepth.length).toBe(1);
    // Each facility is measured against THIS one number, so the capacity a fully-invested
    // player actually has is depth PER facility (4 waiting orders each, 12 across the
    // three), not depth shared across them (which would be 4 total).
    expect(QUEUE_FACILITIES.length * depth).toBe(12);
    expect(QUEUE_FACILITIES).toHaveLength(3);
  });

  it("holds at base depth too: one waiting slot at EACH facility, not one shared", () => {
    const depth = queueDepth(freshState());
    expect(depth).toBe(1);
    expect(QUEUE_FACILITIES.length * depth).toBe(QUEUE_FACILITIES.length);
  });
});

describe("describeHomeworldTalentEffect: the queueDepth effect", () => {
  it("describes the grant as per-facility queued orders, with the payload's own number", () => {
    const text = describeHomeworldTalentEffect({ type: "queueDepth", depth: QUEUE_DEPTH_PER_NODE });
    expect(text).toContain(`+${QUEUE_DEPTH_PER_NODE}`);
    expect(text.toLowerCase()).toContain("queued order");
    // "per facility" is load-bearing: without it the tooltip reads as one shared slot
    // across the whole base, the exact misreading the per-facility model avoids.
    expect(text.toLowerCase()).toContain("per facility");
  });

  it("describes every chain node without falling through to an empty string", () => {
    for (const key of QUEUE_CHAIN) {
      const text = describeHomeworldTalentEffect(HOMEWORLD_TALENTS[key].effect);
      expect(text.length).toBeGreaterThan(0);
      expect(text).not.toContain("undefined");
    }
  });
});

// ============================================================================
// Phase 1 Unit 1.3: the QUEUE MUTATION API + QUEUE_ADAPTERS
//
// Everything below exercises PURE functions only. None of it runs inside a tick
// (the promotion pass is Unit 1.4), so no case here can move parity, and every
// case asserts the immutability contract the whole subsystem rests on: the input
// state is never mutated, and a refusal returns the SAME reference.
// ============================================================================

// Real registry keys, so the adapter-delegation cases below are gated by the REAL
// canStartLine rather than by a fixture that only looks like a recipe.
const REFINE_KEY = "refineCommonOre"; // commonOre x20 -> titaniumIngot x1
const FABRICATE_KEY = "frameSegmentBp"; // titaniumIngot x4 -> frameSegment x1

// The two order shapes a queue can hold. Batch mode (not continuous) is the default
// here because its `remaining` is the count canStartLine is asked about, which is the
// number the adapter delegation cases pin.
function refineOrder(recipeKey: string = REFINE_KEY, remaining = 1): QueuedOrder {
  return { type: "craftLine", kind: "refine", recipeKey, mode: { kind: "batch", remaining } };
}
function fabricateOrder(recipeKey: string = FABRICATE_KEY, remaining = 1): QueuedOrder {
  return { type: "craftLine", kind: "fabricate", recipeKey, mode: { kind: "batch", remaining } };
}
function salvageOrder(instanceId = "eq-1"): QueuedOrder {
  return { type: "salvage", target: { kind: "equipment", instanceId } };
}

// A state with chosen facility levels + stock, mirroring craft-lines.test.ts's fixture.
// freshState seeds the refinery at level 0, so a refine line can only start once it is
// bumped: that is what makes the hasFreeSlot cases below non-vacuous.
function craftState(opts: {
  commonOre?: number;
  titaniumIngot?: number;
  refineryLevel?: number;
  fabricatorLevel?: number;
} = {}): GameState {
  const s = freshState();
  const inventory: Record<string, Decimal[]> = { ...s.inventory };
  if (opts.commonOre !== undefined) inventory.commonOre = [new Decimal(opts.commonOre)];
  if (opts.titaniumIngot !== undefined) inventory.titaniumIngot = [new Decimal(opts.titaniumIngot)];
  return {
    ...s,
    inventory,
    facilities: {
      ...s.facilities,
      refinery: { level: opts.refineryLevel ?? 1 },
      fabricator: { level: opts.fabricatorLevel ?? 1 },
    },
    researchedBlueprints: ["frameSegmentBp"],
  };
}

// Enqueue a run of orders, asserting each one took. Returns the final state so a case
// can set up a loaded queue in one line without re-asserting the happy path each time.
function enqueueAll(
  state: GameState,
  entries: Array<{ facility: QueueFacilityKey; order: QueuedOrder }>
): GameState {
  let s = state;
  for (const entry of entries) {
    const result = enqueueOrder(s, entry.facility, entry.order);
    expect(result.queued).toBe(true);
    s = result.next;
  }
  return s;
}

// The queue reduced to "id at facility", the shape most ordering assertions want.
function queueShape(state: GameState): string[] {
  return state.processQueue.map((job) => `${job.facility}:${job.id}`);
}

describe("enqueueOrder: the depth cap is enforced PER FACILITY, at enqueue", () => {
  it("accepts up to queueDepth waiting orders at one facility, then refuses with queueFull", () => {
    // Base depth 1: exactly one waiting order, then the door closes.
    const state = craftState();
    expect(queueDepth(state)).toBe(1);

    const first = enqueueOrder(state, "refinery", refineOrder());
    expect(first.queued).toBe(true);
    expect(first.reason).toBeUndefined();
    expect(queuedForFacility(first.next, "refinery")).toHaveLength(1);

    const second = enqueueOrder(first.next, "refinery", refineOrder());
    expect(second.queued).toBe(false);
    expect(second.reason).toBe("queueFull");
    // A refusal is a same-REFERENCE no-op and must not consume an id: nextQueueId is
    // the monotonic source, and burning one on a rejected click would leave a visible
    // gap in the ids for no reason.
    expect(second.next).toBe(first.next);
    expect(second.next.nextQueueId).toBe(first.next.nextQueueId);
  });

  it("a FULL facility never blocks another facility (no shared pool)", () => {
    // The rule the flat array makes easy to get wrong: counting processQueue.length
    // instead of the matching entries would make this case fail, and a full Refinery
    // queue would silently starve the Fabricator with no console able to explain why.
    const state = craftState();
    const loaded = enqueueAll(state, [{ facility: "refinery", order: refineOrder() }]);
    expect(enqueueOrder(loaded, "refinery", refineOrder()).queued).toBe(false);

    const other = enqueueOrder(loaded, "fabricator", fabricateOrder());
    expect(other.queued).toBe(true);
    expect(queuedForFacility(other.next, "fabricator")).toHaveLength(1);
    // Both facilities are now at their own cap, from ONE depth of 1.
    expect(other.next.processQueue).toHaveLength(2);
    expect(enqueueOrder(other.next, "fabricator", fabricateOrder()).queued).toBe(false);
  });

  it("a deeper queue talent raises the cap at EVERY facility", () => {
    const state: GameState = { ...craftState(), unlockedHomeworldTalents: QUEUE_CHAIN };
    expect(queueDepth(state)).toBe(4);
    let s = state;
    for (let i = 0; i < 4; i++) {
      s = enqueueAll(s, [
        { facility: "refinery", order: refineOrder() },
        { facility: "fabricator", order: fabricateOrder() },
      ]);
    }
    expect(queuedForFacility(s, "refinery")).toHaveLength(4);
    expect(queuedForFacility(s, "fabricator")).toHaveLength(4);
    expect(enqueueOrder(s, "refinery", refineOrder()).queued).toBe(false);
    expect(enqueueOrder(s, "fabricator", fabricateOrder()).queued).toBe(false);
  });

  it("refuses an order whose shape does not belong at that facility", () => {
    // A mismatched entry could never promote, so it would sit there occupying a depth
    // slot with a block reason no player action could ever clear. Refused up front.
    const state = craftState();
    expect(enqueueOrder(state, "refinery", fabricateOrder()).reason).toBe("wrongFacility");
    expect(enqueueOrder(state, "refinery", salvageOrder()).reason).toBe("wrongFacility");
    expect(enqueueOrder(state, "fabricator", refineOrder()).reason).toBe("wrongFacility");
    expect(enqueueOrder(state, "salvageBay", refineOrder()).reason).toBe("wrongFacility");
    expect(state.processQueue).toHaveLength(0);
    // The matching shapes are accepted, so the guard is a filter and not a wall.
    expect(enqueueOrder(state, "salvageBay", salvageOrder()).queued).toBe(true);
  });

  it("does NOT check affordability, research, tier or slots at enqueue (design §5.3)", () => {
    // Queuing work you cannot start YET is the entire feature. This state has no ore,
    // no refinery and no fabricator, so canStartLine would refuse every one of these
    // orders right now; they still queue, and promotion is what gates them later.
    const barren: GameState = {
      ...freshState(),
      facilities: { ...freshState().facilities, refinery: { level: 0 }, fabricator: { level: 0 } },
    };
    expect(canEnqueueOrder(barren, "refinery", refineOrder(REFINE_KEY, 999)).ok).toBe(true);
    const queued = enqueueOrder(barren, "refinery", refineOrder(REFINE_KEY, 999));
    expect(queued.queued).toBe(true);
    // The adapter, asked the same question, says no. Both are correct: enqueue gates on
    // DEPTH, promotion gates on canStartLine.
    const gate = QUEUE_ADAPTERS.refinery.canStart(queued.next, refineOrder(REFINE_KEY, 999));
    expect(gate.ok).toBe(false);
  });

  it("never mutates the state it was handed", () => {
    const state = craftState();
    const before = state.processQueue;
    const result = enqueueOrder(state, "refinery", refineOrder());
    expect(state.processQueue).toBe(before);
    expect(state.processQueue).toHaveLength(0);
    expect(state.nextQueueId).toBe(1);
    expect(result.next).not.toBe(state);
    expect(result.next.processQueue).not.toBe(before);
  });
});

describe("enqueueOrder: ids mint monotonically and are never reused", () => {
  it("mints q-N from nextQueueId and bumps it once per accepted order", () => {
    const state: GameState = { ...craftState(), unlockedHomeworldTalents: QUEUE_CHAIN };
    const loaded = enqueueAll(state, [
      { facility: "refinery", order: refineOrder() },
      { facility: "fabricator", order: fabricateOrder() },
      { facility: "refinery", order: refineOrder() },
    ]);
    expect(loaded.processQueue.map((j) => j.id)).toEqual(["q-1", "q-2", "q-3"]);
    expect(loaded.nextQueueId).toBe(4);
  });

  it("does NOT rewind the counter on a removal, so an id can never name two orders", () => {
    // A recycled id would let a stale UI reference (a click on a row the promotion pass
    // already consumed) resolve to somebody ELSE's order. Resolving to nothing is safe;
    // resolving to the wrong job is not.
    const state: GameState = { ...craftState(), unlockedHomeworldTalents: QUEUE_CHAIN };
    const loaded = enqueueAll(state, [
      { facility: "refinery", order: refineOrder() },
      { facility: "refinery", order: refineOrder() },
    ]);
    const afterRemove = removeQueuedOrder(loaded, "q-1");
    expect(afterRemove.nextQueueId).toBe(3);

    const readded = enqueueOrder(afterRemove, "refinery", refineOrder());
    expect(readded.queued).toBe(true);
    expect(readded.next.processQueue.map((j) => j.id)).toEqual(["q-2", "q-3"]);
    // Across the whole run every id handed out was distinct.
    const allIds = ["q-1", ...readded.next.processQueue.map((j) => j.id)];
    expect(new Set(allIds).size).toBe(allIds.length);
  });
});

describe("removeQueuedOrder", () => {
  it("drops exactly one entry by id and preserves the order of the rest", () => {
    const state: GameState = { ...craftState(), unlockedHomeworldTalents: QUEUE_CHAIN };
    const loaded = enqueueAll(state, [
      { facility: "refinery", order: refineOrder() },
      { facility: "fabricator", order: fabricateOrder() },
      { facility: "refinery", order: refineOrder() },
    ]);
    const next = removeQueuedOrder(loaded, "q-2");
    expect(queueShape(next)).toEqual(["refinery:q-1", "refinery:q-3"]);
    expect(queuedForFacility(next, "fabricator")).toHaveLength(0);
  });

  it("is a same-reference NO-OP for an unknown id (and for an empty queue)", () => {
    // A double click, or a row the promotion pass already consumed, must not throw and
    // must not clear the queue.
    const state: GameState = { ...craftState(), unlockedHomeworldTalents: QUEUE_CHAIN };
    const loaded = enqueueAll(state, [{ facility: "refinery", order: refineOrder() }]);
    expect(removeQueuedOrder(loaded, "q-999")).toBe(loaded);
    expect(removeQueuedOrder(loaded, "")).toBe(loaded);
    expect(removeQueuedOrder(state, "q-1")).toBe(state);
    // Removing the same id twice: the second call is the no-op path.
    const once = removeQueuedOrder(loaded, "q-1");
    expect(once.processQueue).toHaveLength(0);
    expect(removeQueuedOrder(once, "q-1")).toBe(once);
  });
});

describe("moveQueuedOrder: swaps SAME-FACILITY neighbours in the flat array", () => {
  // One interleaved queue reused by the cases below:
  //   index 0 refinery q-1 | 1 fabricator q-2 | 2 refinery q-3 | 3 fabricator q-4
  // The Refinery's two entries are NOT adjacent, which is exactly the case a naive
  // index +/- 1 swap would get wrong.
  function interleaved(): GameState {
    const state: GameState = { ...craftState(), unlockedHomeworldTalents: QUEUE_CHAIN };
    return enqueueAll(state, [
      { facility: "refinery", order: refineOrder() },
      { facility: "fabricator", order: fabricateOrder() },
      { facility: "refinery", order: refineOrder() },
      { facility: "fabricator", order: fabricateOrder() },
    ]);
  }

  it("moves an entry UP past another facility's entries, leaving them where they are", () => {
    const loaded = interleaved();
    expect(queueShape(loaded)).toEqual([
      "refinery:q-1",
      "fabricator:q-2",
      "refinery:q-3",
      "fabricator:q-4",
    ]);
    const next = moveQueuedOrder(loaded, "q-3", "up");
    // The two REFINERY entries swapped positions (0 and 2). The fabricator entries kept
    // their exact indices (1 and 3) and therefore their relative order.
    expect(queueShape(next)).toEqual([
      "refinery:q-3",
      "fabricator:q-2",
      "refinery:q-1",
      "fabricator:q-4",
    ]);
    expect(queuedForFacility(next, "fabricator").map((j) => j.id)).toEqual(["q-2", "q-4"]);
    expect(queuedForFacility(next, "refinery").map((j) => j.id)).toEqual(["q-3", "q-1"]);
  });

  it("moves an entry DOWN symmetrically, and up-then-down round-trips", () => {
    const loaded = interleaved();
    const down = moveQueuedOrder(loaded, "q-1", "down");
    expect(queueShape(down)).toEqual([
      "refinery:q-3",
      "fabricator:q-2",
      "refinery:q-1",
      "fabricator:q-4",
    ]);
    // Same result as moving q-3 up: the two operations name the same swap.
    expect(queueShape(down)).toEqual(queueShape(moveQueuedOrder(loaded, "q-3", "up")));
    expect(queueShape(moveQueuedOrder(down, "q-1", "up"))).toEqual(queueShape(loaded));
  });

  it("reorders the OTHER facility without touching the first one's order", () => {
    const loaded = interleaved();
    const next = moveQueuedOrder(loaded, "q-4", "up");
    expect(queueShape(next)).toEqual([
      "refinery:q-1",
      "fabricator:q-4",
      "refinery:q-3",
      "fabricator:q-2",
    ]);
    expect(queuedForFacility(next, "refinery").map((j) => j.id)).toEqual(["q-1", "q-3"]);
  });

  it("is a same-reference NO-OP at that facility's own boundaries", () => {
    // q-1 is the FIRST refinery entry even though it is not the first array entry, and
    // q-4 is the LAST fabricator entry. Boundaries are per facility, not per array.
    const loaded = interleaved();
    expect(moveQueuedOrder(loaded, "q-1", "up")).toBe(loaded);
    expect(moveQueuedOrder(loaded, "q-3", "down")).toBe(loaded);
    expect(moveQueuedOrder(loaded, "q-2", "up")).toBe(loaded);
    expect(moveQueuedOrder(loaded, "q-4", "down")).toBe(loaded);
  });

  it("is a same-reference NO-OP for an unknown id and for a lone entry", () => {
    const loaded = interleaved();
    expect(moveQueuedOrder(loaded, "q-999", "up")).toBe(loaded);
    const lone = enqueueAll(craftState(), [{ facility: "refinery", order: refineOrder() }]);
    expect(moveQueuedOrder(lone, "q-1", "up")).toBe(lone);
    expect(moveQueuedOrder(lone, "q-1", "down")).toBe(lone);
  });

  it("never mutates the array it was handed", () => {
    const loaded = interleaved();
    const before = queueShape(loaded);
    const next = moveQueuedOrder(loaded, "q-3", "up");
    expect(queueShape(loaded)).toEqual(before);
    expect(next.processQueue).not.toBe(loaded.processQueue);
  });
});

describe("respec shrinks depth: over-depth queues DRAIN, they are never truncated", () => {
  it("keeps existing entries, refuses new ones, and reopens as the queue drains", () => {
    // THE DECISION THIS PINS (Unit 1.3): depth is enforced at ENQUEUE ONLY. A respec
    // refunds the queueDepth nodes, so a facility can legitimately end up holding MORE
    // waiting orders than the new, smaller depth allows. Those orders are LEFT ALONE.
    // They drain (promote or get removed) and cannot be replaced until the facility is
    // back under the cap. Same posture as over-cap inventory: a shrinking cap never
    // destroys what the player already has, it just stops them adding more. Truncating
    // here would delete configured work as a side effect of a talent refund, which is a
    // data-loss shape.
    const invested: GameState = {
      ...craftState(),
      unlockedHomeworldTalents: QUEUE_CHAIN,
      credits: new Decimal(1000), // respec charges RESPEC_COST_CREDITS
    };
    expect(queueDepth(invested)).toBe(4);
    const loaded = enqueueAll(invested, [
      { facility: "refinery", order: refineOrder() },
      { facility: "refinery", order: refineOrder() },
      { facility: "refinery", order: refineOrder() },
      { facility: "fabricator", order: fabricateOrder() },
    ]);

    // The REAL respec path, not a hand-edited talent list, so this proves the actual
    // refund leaves the queue intact.
    const respec = respecHomeworldTalents(loaded);
    expect(respec.success).toBe(true);
    const shrunk = respec.next;
    expect(queueDepth(shrunk)).toBe(QUEUE_DEPTH_BASE); // 4 -> 1

    // 1. Nothing was destroyed: all four entries survive, in their original order.
    expect(queueShape(shrunk)).toEqual([
      "refinery:q-1",
      "refinery:q-2",
      "refinery:q-3",
      "fabricator:q-4",
    ]);
    expect(queuedForFacility(shrunk, "refinery")).toHaveLength(3);

    // 2. Over the cap means no new orders, at EITHER facility (the fabricator is at
    //    1 of 1 too), with the honest reason.
    expect(enqueueOrder(shrunk, "refinery", refineOrder()).reason).toBe("queueFull");
    expect(enqueueOrder(shrunk, "fabricator", fabricateOrder()).reason).toBe("queueFull");

    // 3. Draining reopens the door, but only once the facility is genuinely back UNDER
    //    the new cap: 3 -> 2 -> 1 are all still full at depth 1.
    const drained1 = removeQueuedOrder(shrunk, "q-1");
    expect(enqueueOrder(drained1, "refinery", refineOrder()).reason).toBe("queueFull");
    const drained2 = removeQueuedOrder(drained1, "q-2");
    expect(enqueueOrder(drained2, "refinery", refineOrder()).reason).toBe("queueFull");
    const drained3 = removeQueuedOrder(drained2, "q-3");
    const reopened = enqueueOrder(drained3, "refinery", refineOrder());
    expect(reopened.queued).toBe(true);
    // The re-added order takes a FRESH id; the drained ones are gone for good.
    expect(queuedForFacility(reopened.next, "refinery").map((j) => j.id)).toEqual(["q-5"]);
  });

  it("moving and removing still work while a facility is over its depth", () => {
    // The over-depth state must not be a frozen or broken state: the player's only way
    // back under the cap is to manage the queue, so reorder and remove have to keep
    // working there.
    const invested: GameState = {
      ...craftState(),
      unlockedHomeworldTalents: QUEUE_CHAIN,
      credits: new Decimal(1000),
    };
    const loaded = enqueueAll(invested, [
      { facility: "refinery", order: refineOrder() },
      { facility: "refinery", order: refineOrder() },
    ]);
    const shrunk = respecHomeworldTalents(loaded).next;
    expect(queuedForFacility(shrunk, "refinery").length).toBeGreaterThan(queueDepth(shrunk));

    const moved = moveQueuedOrder(shrunk, "q-2", "up");
    expect(queueShape(moved)).toEqual(["refinery:q-2", "refinery:q-1"]);
    expect(removeQueuedOrder(moved, "q-2").processQueue).toHaveLength(1);
  });
});

describe("QUEUE_ADAPTERS: exhaustive over QueueFacilityKey", () => {
  it("has a complete row for every facility, and the iteration order lists them all", () => {
    // The Record type makes a MISSING row a compile error; this case is the runtime
    // echo of that, plus the same guarantee for the declared iteration order (which the
    // type system checks separately via QUEUE_FACILITY_ORDER's exhaustiveness alias).
    for (const facility of QUEUE_FACILITIES) {
      const adapter = QUEUE_ADAPTERS[facility];
      expect(adapter, `missing adapter row for ${facility}`).toBeDefined();
      expect(typeof adapter.hasFreeSlot).toBe("function");
      expect(typeof adapter.canStart).toBe("function");
      expect(typeof adapter.start).toBe("function");
    }
    expect(Object.keys(QUEUE_ADAPTERS).sort()).toEqual([...QUEUE_FACILITIES].sort());
    // The promotion pass iterates THIS tuple, never Object.keys, so promotion order is
    // a stated property of the engine rather than an object-key implementation detail.
    expect([...QUEUE_FACILITY_ORDER]).toEqual(["refinery", "fabricator", "salvageBay"]);
    expect([...QUEUE_FACILITY_ORDER].sort()).toEqual([...QUEUE_FACILITIES].sort());
  });

  it("salvageBay is a STUB this unit and can never be promoted", () => {
    // Phase 2 Unit 2.4 replaces this row with the real canStartSalvage / startSalvageJob
    // delegation. Until then it is braked TWICE (no free slot AND a refusing gate), so a
    // promotion pass cannot promote a salvage order however it is written.
    const state = enqueueAll(craftState(), [{ facility: "salvageBay", order: salvageOrder() }]);
    const adapter = QUEUE_ADAPTERS.salvageBay;
    expect(adapter.hasFreeSlot(state)).toBe(false);

    const gate = adapter.canStart(state, salvageOrder());
    expect(gate.ok).toBe(false);
    if (gate.ok) throw new Error("unreachable, narrowing only");
    expect(gate.reason).toBe("notImplemented");

    const started = adapter.start(state, salvageOrder());
    expect(started.started).toBe(false);
    expect(started.next).toBe(state); // same-ref no-op: it spent nothing and queued nothing
  });
});

describe("QUEUE_ADAPTERS: refinery + fabricator delegate wholesale to the line engine", () => {
  it("hasFreeSlot compares the facility's own lines against its own slot count", () => {
    // Refinery level 0 => 0 slots => no room, even with an empty line array. This is the
    // cheap "is there any point scanning this facility" answer the promotion pass wants
    // BEFORE it has an order in hand.
    const unbuilt = craftState({ refineryLevel: 0 });
    expect(QUEUE_ADAPTERS.refinery.hasFreeSlot(unbuilt)).toBe(false);

    const built = craftState({ commonOre: 100, refineryLevel: 1 });
    expect(QUEUE_ADAPTERS.refinery.hasFreeSlot(built)).toBe(true);
    // Fill the single slot through the REAL start path: the slot is now taken.
    const running = startLine(built, "refine", REFINE_KEY, { kind: "batch", remaining: 1 });
    expect(running.started).toBe(true);
    expect(QUEUE_ADAPTERS.refinery.hasFreeSlot(running.next)).toBe(false);
    // The fabricator's own slot is untouched by the refinery's: per facility, always.
    expect(QUEUE_ADAPTERS.fabricator.hasFreeSlot(running.next)).toBe(true);
  });

  it("canStart returns canStartLine's OWN reason tokens, never a queue-local opinion", () => {
    // The point of wholesale delegation: a queued row and the configurator's disabled
    // Start button can never tell the player two different stories about one recipe.
    const state = craftState({ commonOre: 0, refineryLevel: 1 });
    const unknown = QUEUE_ADAPTERS.refinery.canStart(state, refineOrder("noSuchRecipe"));
    expect(unknown).toEqual({ ok: false, reason: "notFound" });

    const broke = QUEUE_ADAPTERS.refinery.canStart(state, refineOrder(REFINE_KEY, 1));
    expect(broke).toEqual({ ok: false, reason: "materials" });

    const unresearched = QUEUE_ADAPTERS.fabricator.canStart(
      { ...state, researchedBlueprints: [] },
      fabricateOrder()
    );
    expect(unresearched).toEqual({ ok: false, reason: "notResearched" });

    const stocked = craftState({ commonOre: 100, refineryLevel: 1 });
    expect(QUEUE_ADAPTERS.refinery.canStart(stocked, refineOrder(REFINE_KEY, 1))).toEqual({ ok: true });
    // The gate is asked about the BATCH count the order carries, so an unaffordable
    // batch is refused even though a batch of 1 would pass.
    expect(QUEUE_ADAPTERS.refinery.canStart(stocked, refineOrder(REFINE_KEY, 99))).toEqual({
      ok: false,
      reason: "materials",
    });
  });

  it("start produces exactly what startLine would have produced", () => {
    const stocked = craftState({ commonOre: 100, refineryLevel: 1 });
    const viaAdapter = QUEUE_ADAPTERS.refinery.start(stocked, refineOrder(REFINE_KEY, 2));
    const viaEngine = startLine(stocked, "refine", REFINE_KEY, { kind: "batch", remaining: 2 });
    expect(viaAdapter.started).toBe(true);
    expect(viaAdapter.next.refineLines).toEqual(viaEngine.next.refineLines);
    expect(viaAdapter.next.nextCraftLineId).toBe(viaEngine.next.nextCraftLineId);
  });

  it("start refuses (same-ref, started false) when the line engine refuses", () => {
    const broke = craftState({ commonOre: 0, refineryLevel: 1 });
    const refused = QUEUE_ADAPTERS.refinery.start(broke, refineOrder(REFINE_KEY, 1));
    expect(refused.started).toBe(false);
    expect(refused.next).toBe(broke);
  });

  it("answers wrongFacility for an order shape that is not its own", () => {
    // Unreachable through enqueueOrder (which refuses the same mismatch), but an adapter
    // handed a hand-edited save's nonsense entry must still answer honestly rather than
    // crash or, worse, start the wrong kind of line.
    const state = craftState({ commonOre: 100 });
    expect(QUEUE_ADAPTERS.refinery.canStart(state, fabricateOrder())).toEqual({
      ok: false,
      reason: "wrongFacility",
    });
    expect(QUEUE_ADAPTERS.refinery.canStart(state, salvageOrder())).toEqual({
      ok: false,
      reason: "wrongFacility",
    });
    expect(QUEUE_ADAPTERS.fabricator.canStart(state, refineOrder())).toEqual({
      ok: false,
      reason: "wrongFacility",
    });
    const refused = QUEUE_ADAPTERS.refinery.start(state, fabricateOrder());
    expect(refused.started).toBe(false);
    expect(refused.next).toBe(state);
  });
});

describe("queuedForFacility", () => {
  it("returns only that facility's entries, in array order, deriving nothing new", () => {
    const state: GameState = { ...craftState(), unlockedHomeworldTalents: QUEUE_CHAIN };
    const loaded = enqueueAll(state, [
      { facility: "fabricator", order: fabricateOrder() },
      { facility: "refinery", order: refineOrder() },
      { facility: "fabricator", order: fabricateOrder() },
    ]);
    expect(queuedForFacility(loaded, "refinery").map((j) => j.id)).toEqual(["q-2"]);
    expect(queuedForFacility(loaded, "fabricator").map((j) => j.id)).toEqual(["q-1", "q-3"]);
    expect(queuedForFacility(loaded, "salvageBay")).toEqual([]);
    // An empty queue is an empty list at every facility, never a throw.
    for (const facility of QUEUE_FACILITIES) {
      expect(queuedForFacility(freshState(), facility)).toEqual([]);
    }
  });
});

// ============================================================================
// Unit 1.4: promoteQueuedOrders, the promotion pass in economyTick's tail.
//
// âš ï¸ THE PARITY-CRITICAL SECTION. The hard invariant of the whole engine is that an
// offline span resolves exactly as the same span of live play would: completion order
// and rng draw order are identical whether the player watched it or was away for two
// days. Promotion now runs inside that seam, so every case below that carries "parity"
// in its name exists to prove the queue did not put a crack in it.
//
// How the parity cases are built, and why they are honest:
//   - Both paths start from the SAME state object and are advanced by the SAME number
//     of WHOLE ticks: path A is one tick(SPAN, ...) offline catch-up, path B is SPAN
//     hand-stepped economyTick(_, 1) calls (which is what a live poll does per bar).
//     Whole ticks only, so tick()'s documented trailing-fractional artifact is not in
//     play and the comparison is exact.
//   - Each path gets its OWN freshly seeded rng from the same seed. A constant rng
//     would hide a difference in draw COUNT or ORDER; a seeded sequence surfaces one as
//     a value divergence downstream.
//   - The comparison is a deep-equal over queueSnapshot: inventory (per quality
//     bucket), activeProcesses, both line arrays, the remaining processQueue, all three
//     monotonic id counters, crafting level/XP and the lifetime produced counters.
//   - Every parity case also asserts NON-VACUITY: real promotions happened across the
//     span, so a pass cannot come from two identically inert states.
// ============================================================================

// A deterministic rng, freshly seeded per path. A linear congruential step, not a good
// generator and not meant to be: it only has to be REPEATABLE and to change value on
// every draw, so that two paths drawing a different number of times cannot both produce
// the same snapshot.
function seededRng(): () => number {
  let seed = 123456789;
  return () => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed / 2147483648;
  };
}

// Decimal maps (lifetimeStats counters) reduced to comparable strings.
function decimalMap(map: Record<string, Decimal>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const key of Object.keys(map).sort()) out[key] = map[key].toString();
  return out;
}

// Inventory reduced to comparable strings, PER QUALITY BUCKET (not itemTotal), so a
// divergence that happens to preserve a total still fails the comparison.
function inventorySnapshot(state: GameState): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const key of Object.keys(state.inventory).sort()) {
    out[key] = state.inventory[key].map((amount) => amount.toString());
  }
  return out;
}

// Everything the promotion pass can touch, or can cause to be touched, in one
// comparable shape. Processes carry lineId so the job-to-line tie has to survive both
// paths identically, and the id counters are included because a divergence in HOW MANY
// lines/jobs/orders were minted is exactly the shape a promotion bug takes.
function queueSnapshot(state: GameState) {
  return {
    inventory: inventorySnapshot(state),
    processes: state.activeProcesses.map((p) => ({
      id: p.id,
      kind: p.kind,
      remainingTicks: p.remainingTicks,
      durationTicks: p.durationTicks,
      lineId: p.lineId,
    })),
    refineLines: state.refineLines,
    fabricateLines: state.fabricateLines,
    processQueue: state.processQueue,
    nextProcessId: state.nextProcessId,
    nextCraftLineId: state.nextCraftLineId,
    nextQueueId: state.nextQueueId,
    craftingLevel: state.craftingLevel,
    craftingXp: state.craftingXp.toString(),
    itemsRefined: decimalMap(state.lifetimeStats.itemsRefined),
    itemsCrafted: decimalMap(state.lifetimeStats.itemsCrafted),
  };
}

// Path B: hand-stepped economyTick, one WHOLE tick at a time, the exact cadence the
// live poll runs and the exact cadence tick()'s offline loop runs internally.
function stepTicks(state: GameState, n: number, rng: () => number): GameState {
  let s = state;
  for (let i = 0; i < n; i++) s = economyTick(s, 1, rng);
  return s;
}

// Path B with a PROMOTION LOG: records "t<tick>:<queueId>" for the tick each queued
// order left the queue. This is the sequence a parity case compares against, because
// the final state alone cannot show WHEN each promotion happened.
function stepTicksLogged(state: GameState, n: number, rng: () => number): { final: GameState; log: string[] } {
  let s = state;
  const log: string[] = [];
  for (let i = 1; i <= n; i++) {
    const before = (s.processQueue ?? []).map((job) => job.id); // queue order
    s = economyTick(s, 1, rng);
    const after = new Set((s.processQueue ?? []).map((job) => job.id));
    for (const id of before) if (!after.has(id)) log.push(`t${i}:${id}`);
  }
  return { final: s, log };
}

// A craftState with the full queue-depth chain learned, so a case can hold several
// waiting orders per facility without the depth cap being the thing under test.
function deepQueueState(opts: Parameters<typeof craftState>[0] = {}): GameState {
  return { ...craftState(opts), unlockedHomeworldTalents: QUEUE_CHAIN };
}

// The queue reduced to ids in array order, the shape the ordering assertions want.
function queueIds(state: GameState): string[] {
  return (state.processQueue ?? []).map((job) => job.id);
}

describe("promoteQueuedOrders: a free slot pulls the oldest eligible order out of the queue", () => {
  it("promotes a waiting order into a real line and REMOVES it from the queue", () => {
    const loaded = enqueueAll(craftState({ commonOre: 100 }), [
      { facility: "refinery", order: refineOrder(REFINE_KEY, 2) },
    ]);
    expect(loaded.refineLines).toHaveLength(0);

    const promoted = promoteQueuedOrders(loaded);

    // The order is now real running work, configured exactly as startLine would have.
    expect(promoted.refineLines).toHaveLength(1);
    expect(promoted.refineLines[0]).toEqual({
      id: "craft-1",
      kind: "refine",
      recipeKey: REFINE_KEY,
      remaining: 2,
      mode: { kind: "batch", remaining: 2 },
    });
    expect(promoted.nextCraftLineId).toBe(2);
    // And it is GONE from the queue: an order that promoted twice would double-book.
    expect(promoted.processQueue).toEqual([]);
    // The input is untouched (immutability), including the array it was handed.
    expect(loaded.processQueue).toHaveLength(1);
    expect(loaded.refineLines).toHaveLength(0);
  });

  it("is a same-REFERENCE no-op when the queue is empty, so it cannot perturb anything", () => {
    // The case that covers every save predating the feature and every player who never
    // queues: promotion must be provably inert, not merely value-equal.
    const empty = craftState({ commonOre: 100 });
    expect(empty.processQueue).toEqual([]);
    expect(promoteQueuedOrders(empty)).toBe(empty);
    const fresh = freshState();
    expect(promoteQueuedOrders(fresh)).toBe(fresh);
  });

  it("is a same-REFERENCE no-op when nothing in the queue can start", () => {
    // No free slot (refinery unbuilt) -> the scan never even builds a waiting list.
    const unbuilt = enqueueAll(craftState({ commonOre: 100, refineryLevel: 0 }), [
      { facility: "refinery", order: refineOrder() },
    ]);
    expect(promoteQueuedOrders(unbuilt)).toBe(unbuilt);

    // Free slot, but the order is unaffordable -> skipped, and nothing was spent.
    const broke = enqueueAll(craftState({ commonOre: 0 }), [{ facility: "refinery", order: refineOrder() }]);
    expect(promoteQueuedOrders(broke)).toBe(broke);
  });

  it("waits while the slot is busy, then promotes on the tick the running line clears", () => {
    // Refinery level 1 = ONE slot. A batch-1 line occupies it; the queued order behind
    // it must not start until that line has finished and been removed.
    const busy = startLine(craftState({ commonOre: 100 }), "refine", REFINE_KEY, { kind: "batch", remaining: 1 });
    expect(busy.started).toBe(true);
    const loaded = enqueueAll(busy.next, [{ facility: "refinery", order: refineOrder() }]);
    expect(refineSlotCount(loaded)).toBe(1);
    expect(promoteQueuedOrders(loaded)).toBe(loaded); // slot busy -> nothing moves

    // Drive real ticks until the running line's single 12-tick iteration completes and
    // stepCraftLine removes the line, freeing the slot for the queued order.
    let s = loaded;
    let promotedAtTick = 0;
    for (let i = 1; i <= 40 && promotedAtTick === 0; i++) {
      s = economyTick(s, 1);
      if ((s.processQueue ?? []).length === 0) promotedAtTick = i;
    }
    expect(promotedAtTick).toBeGreaterThan(1); // it genuinely waited
    expect(s.refineLines).toHaveLength(1);
    expect(s.refineLines[0].id).toBe("craft-2"); // a NEW line, not the finished one
    expect(queueIds(s)).toEqual([]);
  });

  it("fills EVERY free slot in one tick, and never more than the free slots", () => {
    // Refinery level 2 = TWO slots, three orders waiting. Exactly two may promote this
    // tick; the third has to stay queued, in its place.
    const loaded = enqueueAll(deepQueueState({ commonOre: 400, refineryLevel: 2 }), [
      { facility: "refinery", order: refineOrder() },
      { facility: "refinery", order: refineOrder() },
      { facility: "refinery", order: refineOrder() },
    ]);
    expect(refineSlotCount(loaded)).toBe(2);

    const promoted = promoteQueuedOrders(loaded);
    expect(promoted.refineLines).toHaveLength(2);
    expect(promoted.refineLines.map((l) => l.id)).toEqual(["craft-1", "craft-2"]);
    // The overflow entry is untouched and still first in line for next tick.
    expect(queueIds(promoted)).toEqual(["q-3"]);
    // hasFreeSlot is re-checked per promotion, so a second pass on the SAME state adds
    // nothing: the slots are full now.
    expect(promoteQueuedOrders(promoted)).toBe(promoted);
  });

  it("promotes across DIFFERENT facilities in one tick, each bounded by its own slots", () => {
    const loaded = enqueueAll(deepQueueState({ commonOre: 100, titaniumIngot: 20 }), [
      { facility: "refinery", order: refineOrder() },
      { facility: "fabricator", order: fabricateOrder() },
      { facility: "fabricator", order: fabricateOrder() },
    ]);
    expect(fabricateSlotCount(loaded)).toBe(1);

    const promoted = promoteQueuedOrders(loaded);
    expect(promoted.refineLines).toHaveLength(1);
    expect(promoted.fabricateLines).toHaveLength(1);
    // The Fabricator's single slot took one order; the other waits. The Refinery's own
    // slot was never affected by the Fabricator being full (per facility, always).
    expect(queueIds(promoted)).toEqual(["q-3"]);
  });

  it("never promotes a salvageBay entry while its adapter is a stub", () => {
    // The stub is braked twice (no free slot AND a refusing gate). The promotion pass
    // must respect that rather than reaching around it: Phase 2 Unit 2.4 is what makes
    // salvage promotable, not this unit.
    const loaded = enqueueAll(craftState({ commonOre: 100 }), [
      { facility: "salvageBay", order: salvageOrder() },
    ]);
    expect(promoteQueuedOrders(loaded)).toBe(loaded);
    expect(queueIds(loaded)).toEqual(["q-1"]);

    // Not even across a long offline span, where every other facility drains.
    const advanced = tick(500, loaded, seededRng());
    expect(queuedForFacility(advanced, "salvageBay").map((j) => j.id)).toEqual(["q-1"]);
    // The entry is byte-identical after 500 ticks: nothing consumed it, nothing rewrote
    // it. (There is deliberately no assertion on a "salvageJob" process kind here: that
    // kind does not exist until Phase 2 Unit 2.2, so asserting on it now would be a
    // ghost check that compiles today only by accident.)
    expect(advanced.processQueue).toEqual(loaded.processQueue);
    expect(advanced.activeProcesses).toEqual([]);
  });

  it("draws NO rng, which is what keeps the seeded stream's position untouched", () => {
    // Structural half: the function takes state and nothing else, so there is no rng it
    // COULD thread. Behavioral half: a promoting call touches Math.random zero times.
    expect(promoteQueuedOrders.length).toBe(1);
    const loaded = enqueueAll(deepQueueState({ commonOre: 400, titaniumIngot: 20, refineryLevel: 2 }), [
      { facility: "refinery", order: refineOrder() },
      { facility: "refinery", order: refineOrder() },
      { facility: "fabricator", order: fabricateOrder() },
    ]);
    const spy = vi.spyOn(Math, "random");
    try {
      const promoted = promoteQueuedOrders(loaded);
      expect(promoted.refineLines).toHaveLength(2); // non-vacuous: it really promoted
      expect(promoted.fabricateLines).toHaveLength(1);
      expect(spy).not.toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });
});

describe("promoteQueuedOrders: SKIP-ON-BLOCK, and the array is never reordered", () => {
  it("steps over a blocked head, promotes a later eligible entry, and leaves the head in place", () => {
    // 100 commonOre = 5 affordable iterations. The head asks for 99, which canStartLine
    // refuses with `materials`; the entry behind it asks for 1, which it allows. Strict
    // head-of-line blocking would idle the Refinery here for as long as the head stayed
    // unaffordable, which offline means the entire span.
    const loaded = enqueueAll(deepQueueState({ commonOre: 100 }), [
      { facility: "refinery", order: refineOrder(REFINE_KEY, 99) },
      { facility: "refinery", order: refineOrder(REFINE_KEY, 1) },
    ]);
    expect(QUEUE_ADAPTERS.refinery.canStart(loaded, refineOrder(REFINE_KEY, 99))).toEqual({
      ok: false,
      reason: "materials",
    });

    const promoted = promoteQueuedOrders(loaded);
    // The facility is NOT idle: the later entry ran.
    expect(promoted.refineLines).toHaveLength(1);
    expect(promoted.refineLines[0].remaining).toBe(1);
    // The skipped entry kept its position (still index 0) and its id. Nothing sorted,
    // nothing rotated, nothing silently reordered behind the player's back.
    expect(queueIds(promoted)).toEqual(["q-1"]);
    expect(promoted.processQueue[0].order).toEqual(refineOrder(REFINE_KEY, 99));
  });

  it("keeps the relative order of everything it skipped and everything it left behind", () => {
    // Two blocked entries around one affordable entry, plus a Fabricator entry that has
    // no free slot. Only q-3 may go; q-1, q-2 and q-4 must come out in the same order.
    const busyFab = startLine(
      deepQueueState({ commonOre: 100, titaniumIngot: 20 }),
      "fabricate",
      FABRICATE_KEY,
      { kind: "continuous" }
    );
    expect(busyFab.started).toBe(true);
    const loaded = enqueueAll(busyFab.next, [
      { facility: "refinery", order: refineOrder(REFINE_KEY, 99) },
      { facility: "refinery", order: refineOrder("noSuchRecipe", 1) },
      { facility: "refinery", order: refineOrder(REFINE_KEY, 1) },
      { facility: "fabricator", order: fabricateOrder() },
    ]);

    const promoted = promoteQueuedOrders(loaded);
    expect(promoted.refineLines).toHaveLength(1);
    expect(queueIds(promoted)).toEqual(["q-1", "q-2", "q-4"]);
    expect(promoted.processQueue.map((j) => j.facility)).toEqual(["refinery", "refinery", "fabricator"]);
  });

  it("mints ids monotonically across promotion and never reuses a queue id", () => {
    // A promoted order's id must never come back around: a stale UI row that resolves to
    // nothing is safe, one that resolves to somebody else's order is not.
    const loaded = enqueueAll(deepQueueState({ commonOre: 400, refineryLevel: 2 }), [
      { facility: "refinery", order: refineOrder() },
      { facility: "refinery", order: refineOrder() },
      { facility: "refinery", order: refineOrder() },
    ]);
    const promoted = promoteQueuedOrders(loaded);
    expect(queueIds(promoted)).toEqual(["q-3"]);
    expect(promoted.nextQueueId).toBe(4); // promotion does NOT rewind the counter

    const readded = enqueueOrder(promoted, "refinery", refineOrder());
    expect(readded.queued).toBe(true);
    expect(queueIds(readded.next)).toEqual(["q-3", "q-4"]);
    const everyId = ["q-1", "q-2", ...queueIds(readded.next)];
    expect(new Set(everyId).size).toBe(everyId.length);
  });
});

describe("âš ï¸ promoteQueuedOrders: offline == live parity (the hard invariant)", () => {
  it("parity: an offline span with a queue promoting throughout deep-equals the same span stepped one tick at a time", () => {
    // THE test. Two Refinery slots and one Fabricator slot, five waiting orders, and a
    // span long enough for three separate rounds of promotion:
    //   t1    : q-1 + q-2 fill both refine slots, q-4 fills the fabricate slot
    //   ~t26  : both batch-2 refine lines have finished and cleared -> q-3 promotes
    //   ~t122 : the 120-tick fabricate craft has finished and cleared -> q-5 promotes
    // At SPAN the queue is drained and q-5's craft is still in flight, so the compared
    // states hold running work, finished work and spent materials all at once.
    const base = enqueueAll(deepQueueState({ commonOre: 400, titaniumIngot: 8, refineryLevel: 2 }), [
      { facility: "refinery", order: refineOrder(REFINE_KEY, 2) },
      { facility: "refinery", order: refineOrder(REFINE_KEY, 2) },
      { facility: "refinery", order: refineOrder(REFINE_KEY, 2) },
      { facility: "fabricator", order: fabricateOrder(FABRICATE_KEY, 1) },
      { facility: "fabricator", order: fabricateOrder(FABRICATE_KEY, 1) },
    ]);
    const SPAN = 200; // whole ticks only: tick()'s trailing-fractional artifact is not in play

    // Path A: ONE offline catch-up call. Path B: SPAN hand-stepped live ticks.
    const jumped = tick(SPAN, base, seededRng());
    const { final: stepped, log } = stepTicksLogged(base, SPAN, seededRng());

    expect(queueSnapshot(jumped)).toEqual(queueSnapshot(stepped));

    // NON-VACUITY. The queue really drained, over three distinct ticks, in queue order.
    expect(log).toHaveLength(5);
    expect(log.map((entry) => entry.split(":")[1])).toEqual(["q-1", "q-2", "q-4", "q-3", "q-5"]);
    expect(new Set(log.map((entry) => entry.split(":")[0])).size).toBe(3);
    expect(queueIds(jumped)).toEqual([]);
    // Real production happened: 3 batch-2 refine lines = 6 refine jobs.
    expect(jumped.lifetimeStats.itemsRefined.titaniumIngot.toString()).toBe("6");
    expect(itemTotal(jumped.inventory, "frameSegment").toString()).toBe("1");
    expect(jumped.craftingXp.toString()).not.toBe("0");
    // And the last promoted order is still running at SPAN, so the compared snapshots
    // include in-flight work tied to a line that only exists because of a promotion.
    const inFlight = jumped.activeProcesses.filter((p) => p.kind === "fabricateJob");
    expect(inFlight).toHaveLength(1);
    expect(jumped.fabricateLines).toHaveLength(1);
    expect(inFlight[0].lineId).toBe(jumped.fabricateLines[0].id);
  });

  it("parity: a head unaffordable at tick k becomes affordable at k+m and promotes at exactly k+m on BOTH paths", () => {
    // A continuous refine line drips out one titaniumIngot every 12 ticks. The queued
    // fabricate order needs 4 of them, so it is blocked for the first three completions
    // and promotes on the tick the fourth lands. Both paths must agree on that tick, not
    // merely on the end state.
    const running = startLine(craftState({ commonOre: 80, titaniumIngot: 0 }), "refine", REFINE_KEY, {
      kind: "continuous",
    });
    expect(running.started).toBe(true);
    const base = enqueueAll(running.next, [{ facility: "fabricator", order: fabricateOrder() }]);
    const SPAN = 120;

    // Find the promotion tick by live stepping, then hold BOTH paths to it.
    const { log } = stepTicksLogged(base, SPAN, seededRng());
    expect(log).toHaveLength(1);
    const promotionTick = Number(log[0].slice(1).split(":")[0]);
    expect(promotionTick).toBeGreaterThan(1); // it genuinely waited: NOT promoted on sight

    // One tick BEFORE: still queued, no fabricate line, and the two paths agree.
    const beforeJumped = tick(promotionTick - 1, base, seededRng());
    const beforeStepped = stepTicks(base, promotionTick - 1, seededRng());
    expect(queueSnapshot(beforeJumped)).toEqual(queueSnapshot(beforeStepped));
    expect(queueIds(beforeJumped)).toEqual(["q-1"]);
    expect(beforeJumped.fabricateLines).toHaveLength(0);

    // ON the tick: promoted on both paths, same state, and the craft is under way.
    const atJumped = tick(promotionTick, base, seededRng());
    const atStepped = stepTicks(base, promotionTick, seededRng());
    expect(queueSnapshot(atJumped)).toEqual(queueSnapshot(atStepped));
    expect(queueIds(atJumped)).toEqual([]);
    expect(atJumped.fabricateLines).toHaveLength(1);
    expect(atJumped.activeProcesses.some((p) => p.kind === "fabricateJob")).toBe(true);
  });

  it("parity: skip-on-block resolves identically offline and live, and does not idle the facility", () => {
    // The head asks for 99 iterations and is never affordable across the whole span, so
    // it is skipped every single tick. The offline path must skip it exactly as often
    // and land in the same place: same remaining queue, same array position.
    const base = enqueueAll(deepQueueState({ commonOre: 100 }), [
      { facility: "refinery", order: refineOrder(REFINE_KEY, 99) },
      { facility: "refinery", order: refineOrder(REFINE_KEY, 1) },
    ]);
    const SPAN = 60;

    const jumped = tick(SPAN, base, seededRng());
    const { final: stepped, log } = stepTicksLogged(base, SPAN, seededRng());

    expect(queueSnapshot(jumped)).toEqual(queueSnapshot(stepped));

    // NON-VACUITY: the later entry ran (the facility was never idled by the blocked
    // head), the blocked head is still queued, still at index 0, still itself.
    expect(log).toEqual(["t1:q-2"]);
    expect(queueIds(jumped)).toEqual(["q-1"]);
    expect(jumped.processQueue[0].order).toEqual(refineOrder(REFINE_KEY, 99));
    expect(jumped.lifetimeStats.itemsRefined.titaniumIngot.toString()).toBe("1");
  });

  it("parity: facility iteration order is declared, stable across runs, and identical on both paths", () => {
    // The queue array holds the Fabricator's order FIRST, but QUEUE_FACILITY_ORDER puts
    // the Refinery first, so the Refinery's line is minted first. That is the whole
    // point of iterating a literal tuple instead of Object.keys: which facility wins a
    // contested tick is a stated property of the engine, not an object-key accident.
    // Both orders are CONTINUOUS so their lines outlive the span and the minted ids are
    // still readable at the end of it (a batch-1 refine line would have finished and been
    // removed by tick 13, erasing the very evidence this case is about).
    const continuousRefine: QueuedOrder = {
      type: "craftLine",
      kind: "refine",
      recipeKey: REFINE_KEY,
      mode: { kind: "continuous" },
    };
    const continuousFabricate: QueuedOrder = {
      type: "craftLine",
      kind: "fabricate",
      recipeKey: FABRICATE_KEY,
      mode: { kind: "continuous" },
    };
    const base = enqueueAll(craftState({ commonOre: 100, titaniumIngot: 20 }), [
      { facility: "fabricator", order: continuousFabricate },
      { facility: "refinery", order: continuousRefine },
    ]);
    expect(queueIds(base)).toEqual(["q-1", "q-2"]);
    expect([...QUEUE_FACILITY_ORDER]).toEqual(["refinery", "fabricator", "salvageBay"]);

    // Repeated runs of the pure pass agree with each other, every time.
    for (let run = 0; run < 5; run++) {
      const promoted = promoteQueuedOrders(base);
      expect(promoted.refineLines[0].id).toBe("craft-1"); // refinery promoted FIRST
      expect(promoted.fabricateLines[0].id).toBe("craft-2"); // fabricator SECOND
      expect(queueIds(promoted)).toEqual([]);
    }

    // And the offline path mints them in that same order across a real span.
    const SPAN = 30;
    const jumped = tick(SPAN, base, seededRng());
    const stepped = stepTicks(base, SPAN, seededRng());
    expect(queueSnapshot(jumped)).toEqual(queueSnapshot(stepped));
    expect(jumped.refineLines.map((l) => l.id)).toEqual(["craft-1"]);
    expect(jumped.fabricateLines.map((l) => l.id)).toEqual(["craft-2"]);
  });

  it("parity: an EMPTY queue leaves the tick byte-identical, offline and live alike", () => {
    // The regression guard for every existing save. With no queued work the promotion
    // pass is a same-reference no-op, so a span with the queue field present but empty
    // must land exactly where the same span landed before this unit existed.
    const base = startLine(craftState({ commonOre: 400, titaniumIngot: 20 }), "refine", REFINE_KEY, {
      kind: "continuous",
    }).next;
    expect(base.processQueue).toEqual([]);
    const SPAN = 100;

    const jumped = tick(SPAN, base, seededRng());
    const stepped = stepTicks(base, SPAN, seededRng());
    expect(queueSnapshot(jumped)).toEqual(queueSnapshot(stepped));
    // Non-vacuous (the span really produced) and the queue never gained an entry.
    expect(jumped.lifetimeStats.itemsRefined.titaniumIngot.toString()).not.toBe("0");
    expect(jumped.processQueue).toEqual([]);
    expect(jumped.nextQueueId).toBe(base.nextQueueId);
  });
});
