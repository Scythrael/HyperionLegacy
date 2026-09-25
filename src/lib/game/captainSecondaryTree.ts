// Crew 0.14.0 (Phase C-3a): the captain PRESTIGE secondary talent tree ALLOCATION engine (pure,
// DORMANT).
//
// The secondary tree (model.ts SECONDARY_CAPTAIN_TALENTS) is a SECOND captain-tier tree that deepens
// the base tree's three identities: 3 trees x 3 branches x 5 rungs = 45 nodes. Points are earned via
// captain RETIREMENT (a later phase, C-3b) and spent here. This module is the pure LOGIC layer for
// spending those points; it is DORMANT on purpose (mirrors crew.ts / seniorStaff.ts): nothing here is
// wired into tick.ts, shipDerivedStats, or the UI, and NOTHING applies the nodes' effects yet (effect
// APPLICATION to gameplay is a still-later live phase). Every function is pure: it reads its inputs and
// returns fresh values, never mutating an input captain/array in place.
//
// ALLOCATION RULES (docs/plans/2026-09-22-crew-0.14.0-plan.md, "Captain PRESTIGE secondary tree"):
//   - Costs 1 secondaryPoint per node.
//   - SINGLE-BRANCH-COMMITTED: once a captain has spent into a branch, every further point must go into
//     THAT same branch (a fully-retired captain has 5 points and fills exactly ONE branch = one of 9
//     ultimate specs). Before the first purchase, ANY branch's rung-1 entry node is allowed.
//   - ADJACENCY: the first purchase must be a rung-1 entry; every later purchase must NEIGHBOR an
//     already-owned node. Because a branch is a linear chain (rung1 <-> ... <-> rung5) with no cross-
//     branch links, this forces buying a branch strictly rung-by-rung from its entry.

import {
  SECONDARY_CAPTAIN_TALENTS,
  SECONDARY_TALENT_BRANCHES,
  type CaptainState,
  type CaptainSecondaryTalentDef,
  type SecondaryTalentBranch,
  type SecondaryTalentKey,
} from "./model";

// The branch a node belongs to. Pure lookup.
export function secondaryTalentBranchOf(key: SecondaryTalentKey): SecondaryTalentBranch {
  return SECONDARY_CAPTAIN_TALENTS[key].branch;
}

// Every node key in a branch, ordered rung 1 -> 5. Pure.
export function secondaryTalentsInBranch(branch: SecondaryTalentBranch): SecondaryTalentKey[] {
  return (Object.keys(SECONDARY_CAPTAIN_TALENTS) as SecondaryTalentKey[])
    .filter((k) => SECONDARY_CAPTAIN_TALENTS[k].branch === branch)
    .sort((a, b) => SECONDARY_CAPTAIN_TALENTS[a].rung - SECONDARY_CAPTAIN_TALENTS[b].rung);
}

// A branch's rung-5 CAPSTONE key (its "ultimate spec"). Pure.
export function branchUltimate(branch: SecondaryTalentBranch): SecondaryTalentKey {
  const keys = secondaryTalentsInBranch(branch);
  return keys[keys.length - 1]; // rung 5 (branches always have exactly 5 rungs)
}

// The single branch this captain has spent into, or null if it has bought nothing yet. By the single-
// branch rule every owned node shares one branch, so the first owned node's branch is authoritative.
// Pure.
export function committedBranch(captain: CaptainState): SecondaryTalentBranch | null {
  const owned = captain.unlockedSecondaryTalents;
  if (owned.length === 0) return null;
  return secondaryTalentBranchOf(owned[0]);
}

// Whether the captain may buy `key` right now: it enforces points, no-double-buy, the single-branch
// commitment, and adjacency (first buy must be a rung-1 entry; later buys must neighbor an owned node).
// Pure.
export function canBuySecondaryTalent(captain: CaptainState, key: SecondaryTalentKey): boolean {
  const def: CaptainSecondaryTalentDef | undefined = SECONDARY_CAPTAIN_TALENTS[key];
  if (!def) return false; // unknown key
  if ((captain.secondaryPoints ?? 0) < 1) return false; // no unspent point
  const owned = captain.unlockedSecondaryTalents;
  if (owned.includes(key)) return false; // already owned
  const committed = committedBranch(captain);
  // SINGLE-BRANCH: once committed, the key must be in that branch. Uncommitted: any branch is fine here,
  // the rung-1 requirement below keeps the first purchase to an entry node.
  if (committed !== null && def.branch !== committed) return false;
  if (owned.length === 0) {
    // First purchase: must be a branch ENTRY (rung 1).
    return def.rung === 1;
  }
  // Later purchase: must be adjacent to an already-owned node.
  return def.neighbors.some((n) => owned.includes(n));
}

// Spend one point on `key`, appending it to the captain's owned nodes. Pure. When the buy is illegal
// (canBuy false), returns a same-shape NO-OP COPY (fresh object + cloned array), mirroring
// promoteOfficer's no-op-copy convention in seniorStaff.ts, so callers get a new reference either way.
export function buySecondaryTalent(captain: CaptainState, key: SecondaryTalentKey): CaptainState {
  if (!canBuySecondaryTalent(captain, key)) {
    return { ...captain, unlockedSecondaryTalents: [...captain.unlockedSecondaryTalents] };
  }
  return {
    ...captain,
    secondaryPoints: captain.secondaryPoints - 1,
    unlockedSecondaryTalents: [...captain.unlockedSecondaryTalents, key],
  };
}

// Per-branch ownership progress, for the later UI (and the catalog/allocation tests). Pure.
export interface SecondaryBranchProgress {
  branch: SecondaryTalentBranch;
  owned: number; // how many of the branch's nodes the captain owns
  total: number; // the branch's node count (always 5)
  ultimateReached: boolean; // whether the rung-5 capstone is owned
}

export function secondaryTalentProgress(captain: CaptainState): SecondaryBranchProgress[] {
  const owned = new Set(captain.unlockedSecondaryTalents);
  return SECONDARY_TALENT_BRANCHES.map((branch) => {
    const keys = secondaryTalentsInBranch(branch);
    return {
      branch,
      owned: keys.filter((k) => owned.has(k)).length,
      total: keys.length,
      ultimateReached: owned.has(branchUltimate(branch)),
    };
  });
}
