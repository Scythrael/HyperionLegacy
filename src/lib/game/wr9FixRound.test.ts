// Wiring WR-9 fix round (docs/plans/2026-10-15-wiring-registry-and-audit-plan.md, "USER ANSWERS (2026-10-31): WR-9
// review calls"): the Pilot's Cunning on short-range runs and patrols, recall rolling fresh, the progress bars reading the
// cut leg, and the third buff granted on load. The golden pins live in wr9Goldens.test.ts.

import { describe, expect, it } from "vitest";
import { PATROLS, type CaptainMissionState, type CaptainState, type GameState, type PatrolMissionState, type ShortRangeMissionState } from "./model";
import { economyTick, recallCaptain, tickCaptainMission, dispatchCaptainOnMission } from "./tick";
import { effectiveShipStats } from "./crewOverlay";
import {
  CUNNING_EDGE_BY_DEPARTMENT,
  PILOT_CUNNING_RETURN_CUT_TICKS,
  captainMissionPhaseTicks,
  pilotCutPatrolLegs,
  pilotCutReturnLeg,
  pilotCutShortRangePlan,
} from "./officerStats";
import { missionPhaseTicks } from "./model";
import { buildHomeDashboard } from "./homeDashboard";
import { buffCountForRank } from "./crewRank";
import { CREW_PROFESSION_BUFFS } from "./crewBuffs";
import { migrate, serialize, deserialize } from "./save";
import { grantedThirdBuff, withThirdBuffGrantedV70 } from "./crewThirdBuff";
import { makeRng } from "./combat/rng";
import {
  wr9Hash,
  wr9LegacyCrewSave,
  wr9LoadedCrew,
  wr9MissionDispatch,
  wr9MissionHash,
  wr9MissionState,
  wr9PatrolDispatch,
  wr9PatrolRun,
  wr9ShortRangeRun,
  WR9_PATROL_TICKS,
} from "./wr9.fixture";
import { withWr9Off } from "./wr9Switch.fixture";

const captain1 = (s: GameState): CaptainState => s.captains.find((c) => c.id === 1)!;

// ===== The Pilot's Cunning on short-range runs =====

describe("Pilot Cunning on short-range runs", () => {
  const srMission = (s: GameState): ShortRangeMissionState => {
    const m = captain1(s).mission;
    if (m?.kind !== "shortRange") throw new Error("no short-range run");
    return m;
  };

  it("a landed roll cuts the plan's leg home by PILOT_CUNNING_RETURN_CUT_TICKS (never below one) and the total follows", () => {
    expect(PILOT_CUNNING_RETURN_CUT_TICKS).toBe(1);
    const plan = { transitOutTicks: 9, onSiteTicks: 4, transitBackTicks: 9, unloadTicks: 3, totalTicks: 25 };
    expect(pilotCutShortRangePlan(plan, 0x1234, 1)).toEqual({ ...plan, transitBackTicks: 8, totalTicks: 24 });
    expect(pilotCutShortRangePlan(plan, 0x1234, 0)).toBe(plan);
    const one = { ...plan, transitBackTicks: 1, totalTicks: 17 };
    expect(pilotCutShortRangePlan(one, 0x1234, 1)).toBe(one);
  });

  it("the dispatch stamps the chance; every later cycle carries it; some cycles fly home a tick sooner", () => {
    const s = wr9ShortRangeRun(20, 4_000);
    expect(srMission(s).pilotCunning).toBeCloseTo(0.1, 12);
    expect("pilotCunning" in srMission(withWr9Off(() => wr9ShortRangeRun(20, 200)))).toBe(false);
    expect("pilotCunning" in srMission(wr9ShortRangeRun(10, 200))).toBe(false);
    // the same run flies more cycles in the same time than with WR-9 off (some legs home were cut)
    expect(srMission(s).cyclesThisRun!).toBeGreaterThanOrEqual(srMission(withWr9Off(() => wr9ShortRangeRun(20, 4_000))).cyclesThisRun!);
    expect(wr9MissionHash(s)).not.toBe(wr9MissionHash(withWr9Off(() => wr9ShortRangeRun(20, 4_000))));
  });

  it("a run in flight from before (no stamp) flies exactly as before", () => {
    const off = withWr9Off(() => wr9ShortRangeRun(20, 2_000));
    // the unstamped run flown on, live and off
    const r1 = makeRng(3);
    const r2 = makeRng(3);
    let live = off;
    let still = off;
    for (let i = 0; i < 40; i++) {
      live = economyTick(live, 100, () => r1.next());
      still = withWr9Off(() => economyTick(still, 100, () => r2.next()));
    }
    expect(wr9MissionHash(live)).toBe(wr9MissionHash(still));
  });

  it("chunked == 1 s steps with the stamp live", () => {
    const start = wr9ShortRangeRun(20, 100);
    const run = (step: number): GameState => {
      const r = makeRng(5);
      let s = start;
      for (let done = 0; done < 1_200; done += step) s = economyTick(s, step, () => r.next());
      return s;
    };
    const ones = run(1);
    expect(wr9MissionHash(run(10))).toBe(wr9MissionHash(ones));
    expect(wr9MissionHash(run(1))).toBe(wr9MissionHash(ones));
  });
});

// ===== The Pilot's Cunning on patrols =====

describe("Pilot Cunning on patrols", () => {
  const patrol = (s: GameState): PatrolMissionState => {
    const m = captain1(s).mission;
    if (m?.kind !== "patrol") throw new Error("no patrol");
    return m;
  };

  it("a landed roll folds the cut into the frozen leg home (the route's own legs stay absent when nothing changes)", () => {
    const def = PATROLS.crimsonReaverSweep;
    expect(pilotCutPatrolLegs(def, undefined, 7, 1)).toEqual({ out: def.transitOutTicks, back: pilotCutReturnLeg(def.transitBackTicks) });
    expect(pilotCutPatrolLegs(def, { out: 5, back: 6 }, 7, 1)).toEqual({ out: 5, back: 5 });
    expect(pilotCutPatrolLegs(def, undefined, 7, 0)).toBeUndefined();
    expect(pilotCutPatrolLegs(def, { out: 5, back: 1 }, 7, 1)).toEqual({ out: 5, back: 1 });
  });

  it("the dispatch stamps the chance and the first cycle rolls it on its masterSeed; relaunches carry the stamp", () => {
    const m = patrol(wr9PatrolDispatch(20));
    expect(m.pilotCunning).toBeCloseTo(0.1, 12);
    expect(m.legTicks).toEqual(pilotCutPatrolLegs(PATROLS[m.patrolKey], undefined, m.masterSeed, 0.1));
    expect("pilotCunning" in patrol(wr9PatrolDispatch(10))).toBe(false);
    expect("pilotCunning" in withWr9Off(() => patrol(wr9PatrolDispatch(20)))).toBe(false);
    // over a Repeat run's cycles, at least one froze a cut leg home, and each cycle's legs are its own roll's
    const r = makeRng(9);
    let s = wr9PatrolDispatch(20);
    const seen = new Map<number, PatrolMissionState>();
    for (let t = 0; t < 3_000; t++) {
      const cur = patrol(s);
      seen.set(cur.masterSeed, cur);
      s = economyTick(s, 1, () => r.next());
    }
    expect(seen.size).toBeGreaterThan(20);
    let cut = 0;
    for (const c of seen.values()) {
      expect(c.pilotCunning).toBeCloseTo(0.1, 12);
      expect(c.legTicks).toEqual(pilotCutPatrolLegs(PATROLS[c.patrolKey], undefined, c.masterSeed, 0.1));
      if (c.legTicks !== undefined) cut++;
    }
    expect(cut).toBeGreaterThan(0);
  });

  it("a patrol in flight from before (no stamp) flies exactly as before, relaunches included", () => {
    const off = withWr9Off(() => wr9PatrolDispatch(20));
    const r1 = makeRng(4);
    const r2 = makeRng(4);
    let live = off;
    let still = off;
    for (let i = 0; i < 30; i++) {
      live = economyTick(live, 100, () => r1.next());
      still = withWr9Off(() => economyTick(still, 100, () => r2.next()));
    }
    expect(wr9MissionHash(live)).toBe(wr9MissionHash(still));
  });

  it("one call == 100-tick calls == 1 s steps with the stamp live", () => {
    const T = 1_500;
    const run = (step: number): GameState => {
      const r = makeRng(0xba7);
      let s = wr9PatrolDispatch(20);
      for (let done = 0; done < T; done += step) s = economyTick(s, Math.min(step, T - done), () => r.next());
      return s;
    };
    const one = wr9MissionHash(run(T));
    expect(wr9MissionHash(run(100))).toBe(one);
    expect(wr9MissionHash(run(1))).toBe(one);
    expect(WR9_PATROL_TICKS).toBeGreaterThan(T);
    expect(wr9MissionHash(wr9PatrolRun())).not.toBe(wr9MissionHash(withWr9Off(() => wr9PatrolRun())));
  });
});

// ===== Recall rolls fresh =====

describe("a recalled and re-dispatched run never replays the Pilot roll", () => {
  it("each stamped dispatch steps the captain's lifetime Cunning counter; an unstamped one does not", () => {
    let s = wr9MissionDispatch("shortOreRun", 20);
    expect(captain1(s).cunningCycles).toBe(1);
    s = recallCaptain(s, 1).next;
    const keys: number[] = [];
    const r = makeRng(1);
    for (let i = 0; i < 2_000 && captain1(s).mission !== null; i++) {
      const m = captain1(s).mission as CaptainMissionState;
      if (m.phase === "transitBack") keys.push(captain1(s).cunningCycles ?? 0);
      s = economyTick(s, 1, () => r.next());
    }
    expect(captain1(s).mission).toBeNull();
    const recalledKey = keys[0];
    const again = dispatchCaptainOnMission(s, 1, "shortOreRun");
    expect(again.success).toBe(true);
    const fresh = captain1(again.next).cunningCycles!;
    expect(fresh).toBe((captain1(s).cunningCycles ?? 0) + 1);
    expect(fresh).not.toBe(recalledKey);
    // no Pilot Cunning, no stamp, no step
    const plain = dispatchCaptainOnMission(wr9MissionState(10), 1, "shortOreRun");
    expect(captain1(plain.next).cunningCycles).toBeUndefined();
  });
});

// ===== The progress bars read the cut leg =====

describe("the in-flight readouts read the leg the engine flies", () => {
  it("a cut return leg's bar spans exactly the ticks it flies (no jump)", () => {
    const s0 = wr9MissionDispatch("shortOreRun", 20);
    // a sure roll: every return leg is cut
    let s: GameState = { ...s0, captains: s0.captains.map((c) => (c.id === 1 ? { ...c, mission: { ...(c.mission as CaptainMissionState), pilotCunning: 1 } } : c)) };
    const ship = s.ships.find((sh) => sh.id === "ship-1")!;
    const stats = effectiveShipStats(s, ship);
    const r = makeRng(2);
    let c = captain1(s);
    while ((c.mission as CaptainMissionState).phase !== "transitBack") c = tickCaptainMission(1, c, () => r.next(), {}, stats).captain;
    s = { ...s, captains: s.captains.map((x) => (x.id === 1 ? c : x)) };
    const row = buildHomeDashboard(s).inProgress.find((x) => x.id === "extraction-1")!;
    const m = c.mission as CaptainMissionState;
    let flown = 0;
    while (c.mission !== null && (c.mission as CaptainMissionState).phase === "transitBack") {
      c = tickCaptainMission(1, c, () => r.next(), {}, stats).captain;
      flown++;
    }
    expect(row.durationTicks).toBe(flown);
    expect(row.remainingTicks).toBe(flown);
    // and it is the cut leg, one tick shorter than the uncut phase
    const uncut = buildHomeDashboard({ ...s, captains: s.captains.map((x) => (x.id === 1 ? { ...x, mission: { ...m, pilotCunning: undefined } } : x)) }).inProgress.find(
      (x) => x.id === "extraction-1",
    )!;
    expect(uncut.durationTicks).toBe(flown + PILOT_CUNNING_RETURN_CUT_TICKS);
  });

  it("captainMissionPhaseTicks is missionPhaseTicks off the return leg and without the stamp", () => {
    const s = wr9MissionDispatch("shortOreRun", 20);
    const c = captain1(s);
    const m = c.mission as CaptainMissionState;
    const def = { label: "x", transitOutTicks: 7, transitBackTicks: 7, unloadTicks: 3, extractionRatePerTick: 1, cargoCapacity: 10 } as unknown as Parameters<typeof missionPhaseTicks>[1];
    expect(captainMissionPhaseTicks(c, m, def)).toBe(missionPhaseTicks(m.phase, def, m.cargo));
    expect(captainMissionPhaseTicks(c, { ...m, phase: "transitBack", pilotCunning: undefined }, def)).toBe(7);
    expect(captainMissionPhaseTicks(c, { ...m, phase: "transitBack", pilotCunning: 1 }, def)).toBe(6);
  });
});

// ===== The tooltip =====

describe("the Pilot's Cunning tooltip names every run type it reaches", () => {
  it("missions, short-range runs and patrols", () => {
    const line = CUNNING_EDGE_BY_DEPARTMENT.flightDeck!;
    expect(line).toMatch(/mission/);
    expect(line).toMatch(/short-range run/);
    expect(line).toMatch(/patrol/);
    expect(line).not.toMatch(/—|--/);
  });
});

// ===== The third buff granted on load =====

describe("the third buff, granted on load to crew rolled before WR-9", () => {
  it("every Lieutenant and Lieutenant Commander gains one profession buff it did not hold; lower ranks and counts are untouched", () => {
    const loaded = wr9LoadedCrew();
    for (const list of [loaded.ship, loaded.pool]) {
      for (const b of list) {
        if (buffCountForRank(b.rank) >= 3) {
          expect(b.buff3Id).toBeDefined();
          expect(CREW_PROFESSION_BUFFS[b.profession].some((x) => x.id === b.buff3Id)).toBe(true);
          expect([b.buff1Id, b.buff2Id]).not.toContain(b.buff3Id);
        } else {
          expect("buff3Id" in b).toBe(false);
        }
      }
    }
    // the counts by rank survive the split (5 + 6 + 9 aboard, one more of each in the pool)
    const byRank = (list: typeof loaded.ship) => list.reduce<Record<number, number>>((acc, b) => ({ ...acc, [b.rank]: (acc[b.rank] ?? 0) + b.count }), {});
    expect(byRank(loaded.ship)).toEqual({ 7: 5, 8: 6, 3: 9 });
    expect(byRank(loaded.pool)).toEqual({ 7: 6, 8: 7, 3: 10 });
    // the exclusive-buff Lieutenant Commanders had two profession buffs to choose from: each member rolled its own
    expect(loaded.ship.filter((b) => b.rank === 8).length).toBeGreaterThan(1);
    expect(loaded.notables[0].buff3Id).toBeDefined();
    expect(CREW_PROFESSION_BUFFS.operations.some((x) => x.id === loaded.notables[0].buff3Id)).toBe(true);
    expect(loaded.notables[0].buff3Id).not.toBe(loaded.notables[0].buff1Id);
  });

  it("is deterministic and idempotent: a second load rerolls nothing, and a grant never touches a crewmember holding one", () => {
    expect(wr9Hash(wr9LoadedCrew())).toBe(wr9Hash(wr9LoadedCrew()));
    // load, save, load again
    const save = deserialize(wr9LegacyCrewSave())!;
    const first = migrate(save, 1);
    const second = migrate(deserialize(serialize(first, 0, 0))!, 1);
    expect(wr9Hash(second.crewPool)).toBe(wr9Hash(first.crewPool));
    expect(wr9Hash(second.notableCrew)).toBe(wr9Hash(first.notableCrew));
    expect(wr9Hash(second.ships)).toBe(wr9Hash(first.ships));
    // the pass on an already-granted state is the same state
    expect(withThirdBuffGrantedV70(first)).toBe(first);
  });

  it("a save without such crew loads exactly as before (the same state from the pass)", () => {
    const s = wr9MissionState(20);
    expect(withThirdBuffGrantedV70(s)).toBe(s);
  });

  it("the roll is the profession pool without the held buffs, one draw on the seed given", () => {
    const sig = { profession: "science" as const, rarity: "standard" as const, rank: 8 as const, race: "earthBorn" as const, buff1Id: "sci.extraction", buff2Id: "excl.crewOutputMult" };
    const picks = new Set<string>();
    for (let seed = 1; seed < 64; seed++) picks.add(grantedThirdBuff(sig, seed)!);
    expect([...picks].sort()).toEqual(["sci.rareFind", "sci.survey"]);
    expect(grantedThirdBuff({ ...sig, buff2Id: "sci.rareFind" }, 5)).toBe("sci.survey");
  });
});
