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
import { dispatchCaptainOnPatrol, economyTick, deriveWaveSeed, DEFAULT_PATROL_LOOT_TABLE, installMissingCombatBaselines } from "./tick";
import { itemTotal } from "./inventory"; // read an item's TOTAL across quality buckets
import { rollWaveLoot, type WaveLoot } from "./combat/patrolLoot";

const PATROL_KEY = "crimsonReaverSweep";
const DEF = PATROLS[PATROL_KEY];
const ROUTE_LEN = DEF.transitOutTicks + DEF.rollWindowTicks + DEF.transitBackTicks; // 14

// The loot salt, mirrored from tick.ts (module-private there, pinned here to hand-derive the
// per-wave loot seed, the SAME pattern patrol-tick.test.ts uses for RELAUNCH_SEED_SALT).
// Must stay in lockstep with tick.ts's WAVE_LOOT_SEED_SALT or the expected loot diverges.
const WAVE_LOOT_SEED_SALT = 0x165667b1;

// A constant rng so any incidental economyTick draw (the quality roll on each deposited
// material) is identical across every compared path, exactly the patrol-tick.test.ts idiom.
const RNG = () => 0.5;

// A fresh, single-captain patrol state flying `typeKey`, with the NEXT dispatch pinned to
// master seed `seed`. Tank + credits topped so fuel never gates (isolates the reward math).
function patrolState(typeKey: ShipTypeKey, seed: number): GameState {
  const base = freshState();
  // Combat 1.0 (Unit 1.3): seed the combat baseline the retype skipped so a fabricated combat hull
  // clears the new empty-required-slot dispatch blocker (economy hull -> no-op).
  return installMissingCombatBaselines({
    ...base,
    nextPatrolSeed: seed,
    fuel: new Decimal(100000),
    credits: new Decimal(100000),
    ships: base.ships.map((s) => (s.id === "ship-1" ? { ...s, typeKey } : s)),
  });
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

// Compare the lifetimeStats fields patrol rewards feed BY VALUE. itemsGathered is a Decimal
// map (compared per-key via .equals, same -0/0 tolerance as inventory); creditsEarned /
// captainXpAwarded / fleetAdminXpAwarded are Decimal scalars (compared via .toString()).
// missionsCompleted now records a WON patrol under its PatrolKey (2026-07-30), so it must match
// BY VALUE across the two paths (offline == live records the same completions); compared per-key
// below, not just for presence.
function expectSameLifetimeStats(a: GameState, b: GameState): void {
  const la = a.lifetimeStats;
  const lb = b.lifetimeStats;
  const keys = new Set([...Object.keys(la.itemsGathered), ...Object.keys(lb.itemsGathered)]);
  for (const k of keys) {
    const va = la.itemsGathered[k] ?? new Decimal(0);
    const vb = lb.itemsGathered[k] ?? new Decimal(0);
    expect(va.equals(vb), `lifetime itemsGathered for ${k}`).toBe(true);
  }
  expect(la.creditsEarned.toString()).toBe(lb.creditsEarned.toString());
  expect(la.captainXpAwarded.toString()).toBe(lb.captainXpAwarded.toString());
  expect(la.fleetAdminXpAwarded.toString()).toBe(lb.fleetAdminXpAwarded.toString());
  const mKeys = new Set([...Object.keys(la.missionsCompleted), ...Object.keys(lb.missionsCompleted)]);
  for (const k of mKeys) {
    const va = la.missionsCompleted[k] ?? new Decimal(0);
    const vb = lb.missionsCompleted[k] ?? new Decimal(0);
    expect(va.equals(vb), `lifetime missionsCompleted for ${k}`).toBe(true);
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

// The exact loot the winning waves of a masterSeed yield, hand-derived from the same
// salt/derivation the engine uses.
//
// ⚠️ THE WAVE COUNT IS PASSED IN, NOT ASSUMED TO BE TWO (0.13.5). This was
// `expectedTwoWaveLoot`, hardcoding indices 0 and 1, which was true only while the Sweep ran
// exactly 2 waves. The F5 retune widened it to 2-3, so a seed that rolls three waves yields loot
// from three and the hand-derived expectation silently under-counted. Reading the count from the
// dispatched mission is what stops this drifting again the next time a patrol is retuned.
function expectedWaveLoot(masterSeed: number, waveCount: number): WaveLoot {
  return sumLoot(
    Array.from({ length: waveCount }, (_, i) =>
      rollWaveLoot(DEFAULT_PATROL_LOOT_TABLE, deriveWaveSeed(masterSeed, i, WAVE_LOOT_SEED_SALT))
    )
  );
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
        // Lifetime stats (itemsGathered / creditsEarned / captain + FA XP awarded) must fold
        // identically big vs stepped too (foldLifetimeStatsDelta is additive/associative).
        expectSameLifetimeStats(b, s);
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
    // Force a loss on the first wave: the patrol ends with 0 wins.
    //
    // ⚠️ 0.13.5 F5: A SLIVER HULL IS NO LONGER ENOUGH, and the fixture is re-tuned rather than the
    // assertion relaxed. It used to set playerHull 5 / playerShield 0 and rely on 5 HP being
    // unsurvivable. F5 fills every hardpoint, so a destroyer now carries four guns instead of two
    // and can KILL THE WAVE BEFORE IT DIES: low hull stopped implying a loss once offense doubled.
    //
    // Stripping the ship's INSTALLED GEAR alongside the sliver hull restores a genuine guaranteed
    // defeat: no weapons means no kills, so the wave cannot be won at any hull value. Editing the
    // expectation instead would have deleted this case's entire purpose, since it exists to prove
    // a LOST wave awards nothing.
    const wounded: GameState = {
      ...dispatched,
      equipment: dispatched.equipment.filter((e) => e.slotType !== "weapon" && e.slotType !== "droneBay"),
      captains: [{ ...cap, mission: { ...m, playerHull: 5, playerShield: 0, playerDrones: [] } }],
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
    // ...and NOTHING accrued into lifetimeStats either (the win-only guard covers lifetime too).
    expect(done.lifetimeStats.creditsEarned.equals(0)).toBe(true);
    expect(done.lifetimeStats.captainXpAwarded.equals(0)).toBe(true);
    expect(done.lifetimeStats.fleetAdminXpAwarded.equals(0)).toBe(true);
    expect(Object.keys(done.lifetimeStats.itemsGathered).every((k) =>
      done.lifetimeStats.itemsGathered[k].equals(0))).toBe(true);
  });

  it("a WON patrol (2 waves) DOES deposit loot + bounty + XP, and records it in lifetimeStats", () => {
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
    // ...and the SAME reward is counted in lifetimeStats (mirrors extraction): salvage in
    // itemsGathered, bounty in creditsEarned, and the gross captain + FA XP awarded.
    expect(done.lifetimeStats.itemsGathered[DEFAULT_PATROL_LOOT_TABLE.salvage.itemId].gt(0)).toBe(true);
    expect(done.lifetimeStats.creditsEarned.gt(0)).toBe(true);
    expect(done.lifetimeStats.captainXpAwarded.gt(0)).toBe(true);
    expect(done.lifetimeStats.fleetAdminXpAwarded.gt(0)).toBe(true);
    // ...INCLUDING missionsCompleted: a completed patrol now records +1 under its PatrolKey
    // (user decision 2026-07-30: patrols count as missions completed, grouped by type in the
    // offline recap + the Missions Completed stat). One WON 2-wave route = one completion.
    const mc = done.lifetimeStats.missionsCompleted;
    expect(Object.keys(mc).length).toBe(1);
    expect(mc[Object.keys(mc)[0]].toNumber()).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Loot lands in the RIGHT places, at the EXACT hand-derived amounts.
// ---------------------------------------------------------------------------
describe("loot lands in the right places (exact amounts)", () => {
  it("materials -> inventory, credits -> state.credits, captain XP -> captain, FA XP -> FA track", () => {
    const dispatched = dispatch(patrolState("destroyer", 3), false);
    const mission = patrolOf(dispatched)!;
    const masterSeed = mission.masterSeed;
    // The mission's OWN schedule decides how many waves are fought, so the expectation follows the
    // patrol's tuning instead of a literal.
    const expected = expectedWaveLoot(masterSeed, mission.waveTicks.length);

    const done = stepped(dispatched, ROUTE_LEN + 4);
    expect(patrolOf(done)).toBeNull(); // every wave resolved, patrol done

    // MATERIALS: every expected item id landed at exactly its summed qty (delta from the
    // at-dispatch total, so a nonzero starting stock would not fool the assertion).
    for (const id of Object.keys(expected.materials)) {
      const delta = itemTotal(done.inventory, id).minus(itemTotal(dispatched.inventory, id));
      expect(delta.equals(expected.materials[id]), `material ${id}`).toBe(true);
    }
    // CREDITS: dispatch credits + the summed bounty (Dispatch Once => no relaunch fuel spend).
    expect(done.credits.toString()).toBe(dispatched.credits.plus(expected.credits).toString());
    // CAPTAIN XP: exactly the summed per-wave captain XP, 20 per wave, still below
    // xpForNextLevel(1)=300 so no level-up here; the level-up path is covered separately.
    //
    // ⚠️ 0.13.5: the total is now derived from the mission's OWN wave count rather than pinned at
    // 40. The literal was a fair pin while the Sweep ran exactly 2 waves; the F5 retune made it
    // 2-3, so a pinned 40 fails on any seed that rolls three. The PER-WAVE rate is what was
    // actually worth pinning, and it is pinned here, so a change to the reward itself is still a
    // deliberate edit while a change to the patrol's schedule is not a test failure.
    const waveCount = mission.waveTicks.length;
    expect(done.captains[0].xp.equals(expected.captainXp)).toBe(true);
    expect(expected.captainXp).toBe(20 * waveCount);
    expect(done.captains[0].level).toBe(1); // still short of a level-up
    // FA XP: exactly the summed per-wave FA XP, 10 per wave, below xpForNextFleetAdminLevel(1).
    expect(done.fleetAdminXp.equals(expected.fleetAdminXp)).toBe(true);
    expect(expected.fleetAdminXp).toBe(10 * waveCount);
    expect(done.fleetAdminLevel).toBe(1);
    // LIFETIME STATS record the SAME reward at the SAME exact amounts (mirrors extraction):
    // itemsGathered per material, creditsEarned = bounty, captain/FA XP awarded = the gross sums.
    for (const id of Object.keys(expected.materials)) {
      expect(done.lifetimeStats.itemsGathered[id].equals(expected.materials[id]), `lifetime ${id}`).toBe(true);
    }
    expect(done.lifetimeStats.creditsEarned.equals(expected.credits)).toBe(true);
    expect(done.lifetimeStats.captainXpAwarded.equals(expected.captainXp)).toBe(true);
    expect(done.lifetimeStats.fleetAdminXpAwarded.equals(expected.fleetAdminXp)).toBe(true);
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
    const waveCount = patrolOf(primed)!.waveTicks.length;
    const done = stepped(primed, ROUTE_LEN + 4);
    const after = done.captains[0];
    // ⚠️ 0.13.5: the carried remainder is DERIVED from the wave count, not pinned at 30. The Sweep
    // now runs 2-3 waves, so the awarded XP is 20 per wave and 290 + that crosses 300 by a
    // different margin depending on the seed's schedule. What this case is actually about is the
    // LEVEL-UP MACHINERY running on patrol XP (one crossing, correct carry, one stat point), and
    // all three of those still hold exactly.
    const carried = 290 + 20 * waveCount - 300;
    expect(after.level).toBe(2);
    expect(after.xp.equals(carried)).toBe(true);
    expect(after.statPoints).toBe(1);
    // The premise still has to hold, or the case would pass vacuously on a schedule that never
    // crossed the threshold at all.
    expect(290 + 20 * waveCount).toBeGreaterThan(300);
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
