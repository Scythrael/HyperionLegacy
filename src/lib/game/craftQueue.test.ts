// ============================================================================
// craftQueue.test.ts : Crafting 0.13.3, Phase 1 Unit 1.2 (queue depth)
//
// Covers the queue-DEPTH half of the queue engine: the fleetLogisticsQueue1/2/3
// talent chain (model.ts) and the derive-on-read queueDepth helper (tick.ts).
// NOTHING here touches queue BEHAVIOR, because none exists yet: Unit 1.3 lands
// the mutation API + QUEUE_ADAPTERS and Unit 1.4 lands the promotion pass, both
// of which extend THIS file rather than starting a new one.
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

import { describe, it, expect } from "vitest";
import {
  freshState,
  HOMEWORLD_TALENTS,
  QUEUE_DEPTH_PER_NODE,
  type GameState,
  type HomeworldTalentKey,
  type QueueFacilityKey,
} from "./model";
import { QUEUE_DEPTH_BASE, queueDepth, describeHomeworldTalentEffect } from "./tick";

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
