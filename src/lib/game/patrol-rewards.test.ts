// ============================================================================
// patrol-rewards.test.ts : Combat 0.13.0, Phase 10, design S12 "Rewards and loot".
//
// Locks the INTEGRATION of patrol rewards through economyTick: a WON wave's seeded
// loot landing in home inventory / credits, and its XP on the captain + Fleet
// Admiral tracks, folded through the SAME deltas the extraction arm uses. The
// roller's own contract (determinism, bounds, no-gear) is locked separately in
// patrol-loot.test.ts.
//
// THE FLAGSHIP test is the closed-form PARITY GATE, extended to the REWARD state:
// one big economyTick(state, N) must land byte-identical inventory / credits /
// captain XP / FA XP to N stepped economyTick(state, 1) calls (offline == live).
// This holds by construction because each won wave rolls its loot from its OWN
// (masterSeed, waveIndex) seed at the moment it resolves, and each wave resolves
// exactly once on either path.
//
// Seeds: masterSeed 3 => a lone destroyer WINS the 2-wave starter route (waves at
// ticks [3,4]); a carry-state hull override (playerHull 5, playerShield 0) forces a
// guaranteed DEFEAT on the first wave (win-only guard). Same seeds as the base
// patrol-tick.test.ts, chosen for the same reasons.
// ============================================================================

import { describe, it, expect } from "vitest";
import Decimal from "break_infinity.js";
import {
  freshState,
  SHIP_TYPES,
  PATROLS,
  type GameState,
  type ShipTypeKey,
  type PatrolMissionState,
} from "./model";
import { dispatchCaptainOnPatrol, economyTick, deriveWaveSeed, DEFAULT_PATROL_LOOT_TABLE } from "./tick";
import { itemTotal } from "./inventory"; // read an item's TOTAL across quality buckets
import { rollWaveLoot, type WaveLoot } from "./combat/patrolLoot";

const PATROL_KEY = "crimsonReaverSweep";
const DEF = PATROLS[PATROL_KEY];
const ROUTE_LEN = DEF.transitOutTicks + DEF.rollWindowTicks + DEF.transitBackTicks; // 14

// The loot salt, mirrored from tick.ts (module-private there, pinned here to hand-derive the
// per-wave loot seed, the SAME pattern patrol-tick.test.ts uses for RELAUNCH_SEED_SALT).
const WAVE_LOOT_SEED_SALT = 0x85ebca6b;

// A constant rng so any incidental economyTick draw (the quality roll on each deposited
// material) is identical across every compared path, exactly the patrol-tick.test.ts idiom.
const RNG = () => 0.5;

// A fresh, single-captain patrol state flying `typeKey`, with the NEXT dispatch pinned to
// master seed `seed`. Tank + credits topped so fuel never gates (isolates the reward math).
function patrolState(typeKey: ShipTypeKey, seed: number): GameState {
  const base = freshState();
  return {
    ...base,
    nextPatrolSeed: seed,
    fuel: new Decimal(100000),
    credits: new Decimal(100000),
    ships: base.ships.map((s) => (s.id === "ship-1" ? { ...s, typeKey } : s)),
  };
}

function dispatch(state: GameState, repeat: boolean): GameState {
  const r = dispatchCaptainOnPatrol(state, 1, PATROL_KEY, "balanced", repeat);
  expect(r.success).toBe(true);
  return r.next;
}

function patrolOf(state: GameState): PatrolMissionState | null {
  return state.captains[0].mission as PatrolMissionState | null;
}

// Compare two inventories BY VALUE (not by raw Decimal object identity). The loot fold folds
// the 3 seeded-at-0 extraction keys (emptyLootTotals) every call, which leaves a BENIGN -0 vs
// 0 Decimal-mantissa artifact on those zero buckets that differs between a big call and many
// small ones (value-identical, 0 === -0). That artifact is PRE-EXISTING in the fold and is not
// a reward difference, so parity is asserted on per-item TOTALS (via .equals, which treats
// -0 == 0), the meaningful "same loot banked" check.
function expectSameInventoryValue(a: GameState, b: GameState): void {
  const keys = new Set([...Object.keys(a.inventory), ...Object.keys(b.inventory)]);
  for (const k of keys) {
    expect(itemTotal(a.inventory, k).equals(itemTotal(b.inventory, k)), `inventory total for ${k}`).toBe(true);
  }
}

function big(state: GameState, n: number): GameState {
  return economyTick(state, n, RNG);
}
function stepped(state: GameState, n: number): GameState {
  let s = state;
  for (let i = 0; i < n; i++) s = economyTick(s, 1, RNG);
  return s;
}

// Sum a list of WaveLoot into one aggregate (materials merged, credits/XP summed), the
// hand-computed expectation for a set of won waves.
function sumLoot(loots: WaveLoot[]): WaveLoot {
  const materials: Record<string, number> = {};
  let credits = 0;
  let captainXp = 0;
  let fleetAdminXp = 0;
  for (const l of loots) {
    for (const id of Object.keys(l.materials)) materials[id] = (materials[id] ?? 0) + l.materials[id];
    credits += l.credits;
    captainXp += l.captainXp;
    fleetAdminXp += l.fleetAdminXp;
  }
  return { materials, credits, captainXp, fleetAdminXp };
}

// The exact loot the two winning waves (indices 0 and 1) of a masterSeed yield, hand-derived
// from the same salt/derivation the engine uses.
function expectedTwoWaveLoot(masterSeed: number): WaveLoot {
  return sumLoot([
    rollWaveLoot(DEFAULT_PATROL_LOOT_TABLE, deriveWaveSeed(masterSeed, 0, WAVE_LOOT_SEED_SALT)),
    rollWaveLoot(DEFAULT_PATROL_LOOT_TABLE, deriveWaveSeed(masterSeed, 1, WAVE_LOOT_SEED_SALT)),
  ]);
}

// ---------------------------------------------------------------------------
// THE PARITY GATE, extended to the reward state.
// ---------------------------------------------------------------------------
describe("closed-form parity: reward deltas identical big vs stepped (THE GATE)", () => {
  for (const seed of [1, 3, 5, 7, 11]) {
    for (const repeat of [false, true]) {
      it(`inventory / credits / captain XP / FA XP match, masterSeed=${seed}, repeat=${repeat}`, () => {
        const dispatched = dispatch(patrolState("destroyer", seed), repeat);
        const N = 40; // > ROUTE_LEN so a repeat patrol relaunches + loots multiple cycles
        const b = big(dispatched, N);
        const s = stepped(dispatched, N);

        // Captain XP / level / statPoints ride on the captain object.
        expect(b.captains).toEqual(s.captains);
        // Reward-affected state must match by value (see expectSameInventoryValue for the
        // benign -0/0 zero-bucket artifact this deliberately looks past).
        expectSameInventoryValue(b, s);
        expect(b.discovered.slice().sort()).toEqual(s.discovered.slice().sort());
        expect(b.credits.toString()).toBe(s.credits.toString());
        expect(b.fleetAdminXp.toString()).toBe(s.fleetAdminXp.toString());
        expect(b.fleetAdminLevel).toBe(s.fleetAdminLevel);
      });
    }
  }
});

// ---------------------------------------------------------------------------
// Determinism: same masterSeed => same total reward.
// ---------------------------------------------------------------------------
describe("determinism", () => {
  it("same masterSeed reproduces identical inventory / credits / captain XP", () => {
    const a = stepped(dispatch(patrolState("destroyer", 3), false), ROUTE_LEN + 4);
    const b = stepped(dispatch(patrolState("destroyer", 3), false), ROUTE_LEN + 4);
    expect(a.inventory).toEqual(b.inventory);
    expect(a.credits.toString()).toBe(b.credits.toString());
    expect(a.captains).toEqual(b.captains);
    expect(a.fleetAdminXp.toString()).toBe(b.fleetAdminXp.toString());
  });
});

// ---------------------------------------------------------------------------
// Rewards on WIN only: a lost wave / defeated patrol grants NOTHING.
// ---------------------------------------------------------------------------
describe("rewards on WIN only", () => {
  it("a guaranteed DEFEAT (lost first wave) deposits NO loot, NO bounty, NO XP", () => {
    const dispatched = dispatch(patrolState("destroyer", 3), true);
    const cap = dispatched.captains[0];
    const m = cap.mission as PatrolMissionState;
    // Force a loss on the first wave (sliver hull, no shield): the patrol ends with 0 wins.
    const wounded: GameState = {
      ...dispatched,
      captains: [{ ...cap, mission: { ...m, playerHull: 5, playerShield: 0 } }],
    };

    const done = stepped(wounded, ROUTE_LEN + 4);
    const p = patrolOf(done);
    expect(p).toBeNull(); // patrol ended (defeat)
    expect(done.ships[0].damaged).toBe(true); // it was a defeat, not a clean end
    // NOTHING was awarded for the lost wave: inventory empty, credits unchanged from dispatch,
    // captain XP still 0, FA XP still 0.
    expect(Object.keys(done.inventory).every((k) => itemTotal(done.inventory, k).equals(0))).toBe(true);
    expect(done.credits.toString()).toBe(dispatched.credits.toString());
    expect(done.captains[0].xp.equals(0)).toBe(true);
    expect(done.fleetAdminXp.equals(0)).toBe(true);
  });

  it("a WON patrol (2 waves) DOES deposit loot + bounty + XP", () => {
    const dispatched = dispatch(patrolState("destroyer", 3), false);
    const done = stepped(dispatched, ROUTE_LEN + 4);
    // Won both waves, ended cleanly (not damaged).
    expect(patrolOf(done)).toBeNull();
    expect(done.ships[0].damaged).toBeUndefined();
    // Something landed in inventory + credits + XP.
    expect(itemTotal(done.inventory, DEFAULT_PATROL_LOOT_TABLE.salvage.itemId).gt(0)).toBe(true);
    expect(done.credits.gt(dispatched.credits)).toBe(true);
    expect(done.captains[0].xp.gt(0)).toBe(true);
    expect(done.fleetAdminXp.gt(0)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Loot lands in the RIGHT places, at the EXACT hand-derived amounts.
// ---------------------------------------------------------------------------
describe("loot lands in the right places (exact amounts)", () => {
  it("materials -> inventory, credits -> state.credits, captain XP -> captain, FA XP -> FA track", () => {
    const dispatched = dispatch(patrolState("destroyer", 3), false);
    const masterSeed = patrolOf(dispatched)!.masterSeed;
    const expected = expectedTwoWaveLoot(masterSeed);

    const done = stepped(dispatched, ROUTE_LEN + 4);
    expect(patrolOf(done)).toBeNull(); // both waves resolved, patrol done

    // MATERIALS: every expected item id landed at exactly its summed qty (delta from the
    // at-dispatch total, so a nonzero starting stock would not fool the assertion).
    for (const id of Object.keys(expected.materials)) {
      const delta = itemTotal(done.inventory, id).minus(itemTotal(dispatched.inventory, id));
      expect(delta.equals(expected.materials[id]), `material ${id}`).toBe(true);
    }
    // CREDITS: dispatch credits + the summed bounty (Dispatch Once => no relaunch fuel spend).
    expect(done.credits.toString()).toBe(dispatched.credits.plus(expected.credits).toString());
    // CAPTAIN XP: exactly the summed per-wave captain XP (2 waves * 20 = 40, below
    // xpForNextLevel(1)=300 so no level-up here; the level-up path is covered separately).
    expect(done.captains[0].xp.equals(expected.captainXp)).toBe(true);
    expect(expected.captainXp).toBe(40); // pins the first-pass amount so a retune is a deliberate edit
    expect(done.captains[0].level).toBe(1); // no level-up at 40 XP
    // FA XP: exactly the summed per-wave FA XP (2 * 10 = 20, below xpForNextFleetAdminLevel(1)).
    expect(done.fleetAdminXp.equals(expected.fleetAdminXp)).toBe(true);
    expect(expected.fleetAdminXp).toBe(20);
    expect(done.fleetAdminLevel).toBe(1);
  });

  it("captain LEVEL-UP fires when accrued patrol XP crosses the threshold (shared foldXpLevelUps)", () => {
    // Seed the captain just under level 2 so a single won wave's XP (20) tips it over
    // xpForNextLevel(1) = 300, proving the level-up machinery runs on patrol XP too.
    const dispatched = dispatch(patrolState("destroyer", 3), false);
    const cap = dispatched.captains[0];
    const primed: GameState = {
      ...dispatched,
      captains: [{ ...cap, xp: new Decimal(290), level: 1, statPoints: 0 }],
    };
    const done = stepped(primed, ROUTE_LEN + 4);
    const after = done.captains[0];
    // 290 + 40 (two waves) = 330; crosses 300 once => level 2, 30 carried, +1 stat point.
    expect(after.level).toBe(2);
    expect(after.xp.equals(30)).toBe(true);
    expect(after.statPoints).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// A repeat patrol accumulates loot ACROSS relaunched cycles (multi-cycle reward).
// ---------------------------------------------------------------------------
describe("repeat-dispatch accumulates reward across cycles", () => {
  it("two full winning cycles bank more salvage than one", () => {
    const oneCycle = stepped(dispatch(patrolState("destroyer", 3), true), ROUTE_LEN);
    const twoCycles = stepped(dispatch(patrolState("destroyer", 3), true), ROUTE_LEN * 2);
    const salvageId = DEFAULT_PATROL_LOOT_TABLE.salvage.itemId;
    expect(itemTotal(twoCycles.inventory, salvageId).gt(itemTotal(oneCycle.inventory, salvageId))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Anti-regression: a hull that does NOT win a wave (no patrol at all) banks nothing,
// and the reward path never perturbs a non-combat baseline.
// ---------------------------------------------------------------------------
describe("anti-regression", () => {
  it("an idle fleet (no dispatched patrol) banks no patrol reward", () => {
    const idle = economyTick(patrolState("destroyer", 3), 20, RNG);
    expect(Object.keys(idle.inventory).every((k) => itemTotal(idle.inventory, k).equals(0))).toBe(true);
    expect(idle.credits.toString()).toBe(new Decimal(100000).toString());
    expect(idle.fleetAdminXp.equals(0)).toBe(true);
    expect(idle.captains[0].xp.equals(0)).toBe(true);
    expect(SHIP_TYPES.destroyer.hullIntegrity).toBeGreaterThan(0); // sanity: hull exists
  });
});
