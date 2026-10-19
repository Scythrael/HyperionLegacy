// Crew 0.14.0 (Phase C-3a): tests for the captain PRESTIGE secondary talent tree -- the catalog
// well-formedness, the pure allocation engine (points / adjacency / single-branch commitment), the
// v57 -> v58 save migration backfill, and a DORMANCY check that a captain carrying the new fields ticks
// byte-identically to one that does not (nothing in the engine reads them yet).

import { describe, it, expect } from "vitest";
import Decimal from "break_infinity.js";
import {
  SECONDARY_CAPTAIN_TALENTS,
  SECONDARY_TALENT_TREES,
  SECONDARY_TALENT_BRANCHES,
  freshState,
  freshCaptains,
  type CaptainState,
  type SecondaryTalentBranch,
  type SecondaryTalentKey,
} from "./model";
import {
  secondaryTalentBranchOf,
  secondaryTalentsInBranch,
  branchUltimate,
  committedBranch,
  canBuySecondaryTalent,
  buySecondaryTalent,
  secondaryTalentBuyLock,
  secondaryTalentBuyLockText,
  secondaryTalentProgress,
} from "./captainSecondaryTree";
import { migrate, type SaveFile } from "./save";
import { dispatchCaptainOnMission, tick } from "./tick";

const ALL_KEYS = Object.keys(SECONDARY_CAPTAIN_TALENTS) as SecondaryTalentKey[];

// A captain with `points` unspent secondary points and no owned nodes.
function captainWithPoints(points: number): CaptainState {
  const c = freshCaptains(1)[0];
  return { ...c, secondaryPoints: points };
}

// A tiny deterministic PRNG (mulberry32) so the dormancy test can drive two ticks with identical rng.
function makeRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ============================================================================
// Catalog well-formedness
// ============================================================================
describe("SECONDARY_CAPTAIN_TALENTS catalog", () => {
  it("has exactly 45 nodes (3 trees x 3 branches x 5 rungs)", () => {
    expect(ALL_KEYS).toHaveLength(45);
    expect(SECONDARY_TALENT_TREES).toHaveLength(3);
    expect(SECONDARY_TALENT_BRANCHES).toHaveLength(9);
  });

  it("has unique keys and each def's neighbors reference real keys", () => {
    expect(new Set(ALL_KEYS).size).toBe(45);
    for (const key of ALL_KEYS) {
      for (const n of SECONDARY_CAPTAIN_TALENTS[key].neighbors) {
        expect(ALL_KEYS).toContain(n);
      }
    }
  });

  it("lays each branch out as 5 rungs numbered 1..5 exactly once", () => {
    for (const branch of SECONDARY_TALENT_BRANCHES) {
      const keys = secondaryTalentsInBranch(branch);
      expect(keys).toHaveLength(5);
      expect(keys.map((k) => SECONDARY_CAPTAIN_TALENTS[k].rung)).toEqual([1, 2, 3, 4, 5]);
      // every node in the branch agrees on its branch id
      for (const k of keys) expect(SECONDARY_CAPTAIN_TALENTS[k].branch).toBe(branch);
    }
  });

  it("seeds exactly one isHub per branch, and it is the rung-1 entry (RadialWeb fog-of-war seed)", () => {
    for (const branch of SECONDARY_TALENT_BRANCHES) {
      const keys = secondaryTalentsInBranch(branch);
      const hubs = keys.filter((k) => SECONDARY_CAPTAIN_TALENTS[k].isHub === true);
      expect(hubs).toHaveLength(1);
      expect(SECONDARY_CAPTAIN_TALENTS[hubs[0]].rung).toBe(1);
    }
    // and no non-rung-1 node is flagged a hub anywhere in the catalog
    for (const key of ALL_KEYS) {
      if (SECONDARY_CAPTAIN_TALENTS[key].isHub) expect(SECONDARY_CAPTAIN_TALENTS[key].rung).toBe(1);
    }
  });

  it("groups the 9 branches into 3 trees of 3", () => {
    const byTree = new Map<string, Set<SecondaryTalentBranch>>();
    for (const key of ALL_KEYS) {
      const def = SECONDARY_CAPTAIN_TALENTS[key];
      if (!byTree.has(def.tree)) byTree.set(def.tree, new Set());
      byTree.get(def.tree)!.add(def.branch);
    }
    expect([...byTree.keys()].sort()).toEqual([...SECONDARY_TALENT_TREES].sort());
    for (const branches of byTree.values()) expect(branches.size).toBe(3);
  });

  it("has symmetric, intra-branch neighbor links forming a linear rung1<->..<->rung5 chain", () => {
    for (const key of ALL_KEYS) {
      const def = SECONDARY_CAPTAIN_TALENTS[key];
      for (const n of def.neighbors) {
        // symmetric
        expect(SECONDARY_CAPTAIN_TALENTS[n].neighbors).toContain(key);
        // intra-branch only (no cross-branch links)
        expect(SECONDARY_CAPTAIN_TALENTS[n].branch).toBe(def.branch);
        // adjacent rungs only
        expect(Math.abs(SECONDARY_CAPTAIN_TALENTS[n].rung - def.rung)).toBe(1);
      }
    }
  });

  it("gives each branch exactly one rung-5 capstone (effect.type === 'capstone')", () => {
    for (const branch of SECONDARY_TALENT_BRANCHES) {
      const keys = secondaryTalentsInBranch(branch);
      const capstones = keys.filter((k) => SECONDARY_CAPTAIN_TALENTS[k].effect.type === "capstone");
      expect(capstones).toHaveLength(1);
      const ult = branchUltimate(branch);
      expect(capstones[0]).toBe(ult);
      expect(SECONDARY_CAPTAIN_TALENTS[ult].rung).toBe(5);
    }
  });

  it("every node costs exactly 1 point", () => {
    for (const key of ALL_KEYS) expect(SECONDARY_CAPTAIN_TALENTS[key].cost).toBe(1);
  });

  it("secondaryTalentBranchOf returns each node's branch", () => {
    expect(secondaryTalentBranchOf("extraction1")).toBe("extraction");
    expect(secondaryTalentBranchOf("fleetOps5")).toBe("fleetOps");
    expect(secondaryTalentBranchOf("commandCrew3")).toBe("commandCrew");
  });
});

// ============================================================================
// Allocation engine
// ============================================================================
describe("captainSecondaryTree allocation", () => {
  it("a fresh captain has 0 points, no owned nodes, and no committed branch", () => {
    const c = freshCaptains(1)[0];
    expect(c.secondaryPoints).toBe(0);
    expect(c.unlockedSecondaryTalents).toEqual([]);
    expect(c.retirements).toBe(0);
    expect(committedBranch(c)).toBeNull();
  });

  it("cannot buy anything with 0 points", () => {
    const c = captainWithPoints(0);
    expect(canBuySecondaryTalent(c, "extraction1")).toBe(false);
    const after = buySecondaryTalent(c, "extraction1");
    expect(after.unlockedSecondaryTalents).toEqual([]);
    expect(after.secondaryPoints).toBe(0);
    expect(after).not.toBe(c); // no-op still returns a fresh copy
  });

  it("the first purchase must be a rung-1 entry node", () => {
    const c = captainWithPoints(5);
    expect(canBuySecondaryTalent(c, "extraction2")).toBe(false); // rung 2, not an entry
    expect(canBuySecondaryTalent(c, "extraction1")).toBe(true);
    // any branch's rung-1 entry is allowed before committing
    expect(canBuySecondaryTalent(c, "gunnery1")).toBe(true);
    expect(canBuySecondaryTalent(c, "commandCrew1")).toBe(true);
  });

  it("buying a node spends one point and appends the key", () => {
    const c = captainWithPoints(5);
    const after = buySecondaryTalent(c, "extraction1");
    expect(after.secondaryPoints).toBe(4);
    expect(after.unlockedSecondaryTalents).toEqual(["extraction1"]);
    expect(committedBranch(after)).toBe("extraction");
  });

  it("enforces adjacency within a branch (cannot skip a rung)", () => {
    let c = captainWithPoints(5);
    c = buySecondaryTalent(c, "extraction1");
    expect(canBuySecondaryTalent(c, "extraction3")).toBe(false); // not adjacent to owned rung 1
    expect(canBuySecondaryTalent(c, "extraction2")).toBe(true);
    c = buySecondaryTalent(c, "extraction2");
    expect(canBuySecondaryTalent(c, "extraction3")).toBe(true);
  });

  it("cannot re-buy an already-owned node", () => {
    let c = captainWithPoints(5);
    c = buySecondaryTalent(c, "extraction1");
    expect(canBuySecondaryTalent(c, "extraction1")).toBe(false);
    const after = buySecondaryTalent(c, "extraction1");
    expect(after.unlockedSecondaryTalents).toEqual(["extraction1"]); // unchanged
    expect(after.secondaryPoints).toBe(4);
  });

  it("SINGLE-BRANCH commitment blocks buying into a second branch", () => {
    let c = captainWithPoints(5);
    c = buySecondaryTalent(c, "gunnery1");
    expect(committedBranch(c)).toBe("gunnery");
    // another branch's entry is now forbidden even though it is a rung-1 node
    expect(canBuySecondaryTalent(c, "extraction1")).toBe(false);
    expect(canBuySecondaryTalent(c, "aegis1")).toBe(false);
    const after = buySecondaryTalent(c, "extraction1");
    expect(after.unlockedSecondaryTalents).toEqual(["gunnery1"]); // no-op
  });

  it("5 points drive exactly one branch to its ultimate capstone", () => {
    let c = captainWithPoints(5);
    for (const key of secondaryTalentsInBranch("aegis")) {
      expect(canBuySecondaryTalent(c, key)).toBe(true);
      c = buySecondaryTalent(c, key);
    }
    expect(c.secondaryPoints).toBe(0);
    expect(c.unlockedSecondaryTalents).toHaveLength(5);
    expect(c.unlockedSecondaryTalents).toContain(branchUltimate("aegis"));

    const progress = secondaryTalentProgress(c);
    const aegis = progress.find((p) => p.branch === "aegis")!;
    expect(aegis.owned).toBe(5);
    expect(aegis.total).toBe(5);
    expect(aegis.ultimateReached).toBe(true);
    // every other branch untouched
    for (const p of progress) {
      if (p.branch !== "aegis") {
        expect(p.owned).toBe(0);
        expect(p.ultimateReached).toBe(false);
      }
    }
  });

  it("no-op when out of points mid-branch (cannot reach the capstone with only 4 points)", () => {
    let c = captainWithPoints(4);
    for (const key of secondaryTalentsInBranch("trade")) {
      c = buySecondaryTalent(c, key);
    }
    expect(c.secondaryPoints).toBe(0);
    expect(c.unlockedSecondaryTalents).toEqual(["trade1", "trade2", "trade3", "trade4"]);
    expect(c.unlockedSecondaryTalents).not.toContain(branchUltimate("trade"));
    // the last legal buy is a no-op: no point left
    expect(canBuySecondaryTalent(c, "trade5")).toBe(false);
  });

  it("buySecondaryTalent never mutates its input captain", () => {
    const c = captainWithPoints(5);
    const snapshot = JSON.stringify({ p: c.secondaryPoints, o: c.unlockedSecondaryTalents });
    buySecondaryTalent(c, "extraction1");
    expect(JSON.stringify({ p: c.secondaryPoints, o: c.unlockedSecondaryTalents })).toBe(snapshot);
  });
});

// ============================================================================
// Save migration v57 -> v58
// ============================================================================
describe("migrate, v57 -> v58 captain secondary-tree dormant fields", () => {
  it("backfills secondaryPoints / unlockedSecondaryTalents / retirements onto every captain", () => {
    const base = freshState();
    // A genuine v57 shape: the secondary-tree fields (which landed in v58) do not exist yet, so strip
    // them off every captain in the fixture.
    const preSecondary = {
      ...base,
      captains: base.captains.map((c) => {
        const { secondaryPoints, unlockedSecondaryTalents, retirements, ...rest } = c as any;
        return rest;
      }),
    };
    const save: SaveFile = {
      version: 57, created_at: 0, last_saved_at: 0, game_time_seconds: 0,
      state: preSecondary as any,
    };
    const migrated: any = migrate(save);
    expect(migrated.captains.length).toBeGreaterThan(0);
    for (const c of migrated.captains) {
      expect(c.secondaryPoints).toBe(0);
      expect(c.unlockedSecondaryTalents).toEqual([]);
      expect(c.retirements).toBe(0);
    }
  });

  it("is idempotent: a save already carrying secondary state keeps its own values (does not clobber)", () => {
    const base = freshState();
    const withState = {
      ...base,
      captains: base.captains.map((c) => ({
        ...c,
        secondaryPoints: 3,
        unlockedSecondaryTalents: ["gunnery1", "gunnery2"],
        retirements: 2,
      })),
    };
    const save: SaveFile = {
      version: 57, created_at: 0, last_saved_at: 0, game_time_seconds: 0,
      state: withState as any,
    };
    const migrated: any = migrate(save);
    for (const c of migrated.captains) {
      expect(c.secondaryPoints).toBe(3);
      expect(c.unlockedSecondaryTalents).toEqual(["gunnery1", "gunnery2"]);
      expect(c.retirements).toBe(2);
    }
  });
});

// ============================================================================
// Dormancy / additive-neutrality
// ============================================================================
describe("captain secondary-tree fields on IDLE captains (WR-5a: the Extraction nodes act on missions only)", () => {
  it("an idle captain carrying Extraction nodes ticks identically to one without them, and the fields pass through untouched", () => {
    const control = freshState();
    // The modified state differs ONLY in the secondary-tree fields of its captains.
    const modified = {
      ...freshState(),
      captains: control.captains.map((c) => ({
        ...c,
        secondaryPoints: 5,
        unlockedSecondaryTalents: ["extraction1", "extraction2", "extraction3"] as SecondaryTalentKey[],
        retirements: 3,
      })),
    };

    const controlAfter = tick(30, control, makeRng(12345));
    const modifiedAfter = tick(30, modified, makeRng(12345));

    // The injected fields survive the tick untouched (proves the engine never rewrites them).
    for (const c of modifiedAfter.captains) {
      expect(c.secondaryPoints).toBe(5);
      expect(c.unlockedSecondaryTalents).toEqual(["extraction1", "extraction2", "extraction3"]);
      expect(c.retirements).toBe(3);
    }

    // Stripping the secondary fields, the two post-tick states are byte-identical (an idle captain flies no
    // mission, so no Extraction node has anything to act on).
    const strip = (s: any) => ({
      ...s,
      captains: s.captains.map((c: any) => {
        const { secondaryPoints, unlockedSecondaryTalents, retirements, ...rest } = c;
        return rest;
      }),
    });
    expect(strip(modifiedAfter)).toEqual(strip(controlAfter));
  });

  it("uses Decimal only where the base game does; the secondary fields are plain values", () => {
    const c = freshCaptains(1)[0];
    expect(typeof c.secondaryPoints).toBe("number");
    expect(Array.isArray(c.unlockedSecondaryTalents)).toBe(true);
    expect(typeof c.retirements).toBe("number");
    expect(c.xp instanceof Decimal).toBe(true); // sanity: the base game's Decimal field is unaffected
  });
});

// ============================================================================
// WR-5a (user 2026-10-17, "Block buying while out")
// ============================================================================
describe("no prestige talent can be learned while the captain's ship is out", () => {
  const docked = () => {
    const s = freshState();
    return { ...s, credits: new Decimal(1_000_000), captains: s.captains.map((c) => (c.id === 1 ? { ...c, secondaryPoints: 2 } : c)) };
  };
  it("docked: the buy is allowed; on a mission: refused (canBuy false, buy a no-op), with the reason", () => {
    const s = docked();
    const c = s.captains.find((x) => x.id === 1)!;
    expect(secondaryTalentBuyLock(s, 1)).toBeNull();
    expect(canBuySecondaryTalent(c, "extraction1", s)).toBe(true);
    const out = dispatchCaptainOnMission(s, 1, "shortOreRun");
    expect(out.success).toBe(true);
    const flying = out.next.captains.find((x) => x.id === 1)!;
    expect(secondaryTalentBuyLock(out.next, 1)).toBe("onMission");
    expect(canBuySecondaryTalent(flying, "extraction1", out.next)).toBe(false);
    const after = buySecondaryTalent(flying, "extraction1", out.next);
    expect(after.unlockedSecondaryTalents).toEqual([]);
    expect(after.secondaryPoints).toBe(2);
    expect(secondaryTalentBuyLockText("onMission")).toBe("Ship is out on a mission: prestige talents can be learned again once it returns");
  });
  it("an unclaimed expedition locks too, and a captain with no ship is never locked", () => {
    const s = docked();
    const onRun = { ...s, expeditions: [{ shipId: "ship-1", captainId: 1 } as unknown as (typeof s.expeditions)[number]] };
    expect(secondaryTalentBuyLock(onRun, 1)).toBe("onExpedition");
    expect(canBuySecondaryTalent(onRun.captains[0], "extraction1", onRun)).toBe(false);
    const shipless = { ...s, ships: s.ships.map((sh) => ({ ...sh, assignedCaptainId: null })) };
    expect(secondaryTalentBuyLock(shipless, 1)).toBeNull();
  });
});