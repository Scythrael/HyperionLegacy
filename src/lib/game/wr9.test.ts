// Wiring WR-9 (docs/plans/2026-10-15-wiring-registry-and-audit-plan.md section 4 WR-9, the OC-E user answers): the
// behavior, determinism and old-save proofs. The golden pins live in wr9Goldens.test.ts.

import { describe, expect, it } from "vitest";
import { FULL_HOLD_FRACTION, type CaptainMissionState, type CaptainState, type CrewSignature, type GameState } from "./model";
import { economyTick, tickCaptainMission } from "./tick";
import { effectiveShipStats } from "./crewOverlay";
import { PILOT_CUNNING_RETURN_CUT_TICKS, pilotCutReturnLeg } from "./officerStats";
import { OFFLOAD_BASE_SECONDS, groundOffloadSeconds } from "./groundOps";
import { taskFullHaul } from "./groundTasks";
import { advanceExpedition, expeditionCandidates } from "./expedition";
import { dispatchPastPropulsion } from "./awayTeamTestFixtures";
import { generateComplementCrew } from "./crewGeneration";
import { buffCountForRank } from "./crewRank";
import { CREW_PROFESSION_BUFFS, getCrewBuffById } from "./crewBuffs";
import { addToBucketList, contributionForSignature, signatureKey } from "./crew";
import { getSeniorStaffBonusById } from "./seniorStaffBonuses";
import { HELP_TOPICS } from "../helpTopics";
import { makeRng } from "./combat/rng";
import { wr9ExpeditionState, wr9MissionDispatch, wr9MissionHash, wr9MissionRun } from "./wr9.fixture";
import { withWr9Off } from "./wr9Switch.fixture";

const extraction = (s: GameState): CaptainMissionState => {
  const m = s.captains.find((c) => c.id === 1)!.mission;
  if (m?.kind !== "extraction") throw new Error("no captain mission");
  return m;
};

// ===== OC-E4: Pilot Cunning =====

describe("OC-E4 Pilot Cunning: a quicker trip home", () => {
  it("a dispatch stamps the Flight Deck's Cunning facet, only when it is non-zero and WR-9 is on", () => {
    expect(extraction(wr9MissionDispatch("shortOreRun", 20)).pilotCunning).toBeCloseTo(0.1, 12);
    expect("pilotCunning" in extraction(wr9MissionDispatch("shortOreRun", 10))).toBe(false);
    expect("pilotCunning" in withWr9Off(() => extraction(wr9MissionDispatch("shortOreRun", 20)))).toBe(false);
  });

  it("cuts a return leg by PILOT_CUNNING_RETURN_CUT_TICKS, never below one tick", () => {
    expect(PILOT_CUNNING_RETURN_CUT_TICKS).toBe(1);
    expect(pilotCutReturnLeg(25)).toBe(24);
    expect(pilotCutReturnLeg(2)).toBe(1);
    expect(pilotCutReturnLeg(1)).toBe(1);
  });

  // Step one captain mission tick by tick (berths never contended), counting the ticks spent on return legs.
  function returnTicks(s: GameState, cycles: number): { ticks: number; captain: CaptainState } {
    const ship = s.ships.find((sh) => sh.id === "ship-1")!;
    const stats = effectiveShipStats(s, ship);
    const r = makeRng(7);
    let captain = s.captains.find((c) => c.id === 1)!;
    let ticks = 0;
    let done = 0;
    for (let guard = 0; guard < 200_000 && done < cycles; guard++) {
      if (captain.mission?.kind === "extraction" && captain.mission.phase === "transitBack") ticks++;
      const res = tickCaptainMission(1, captain, () => r.next(), {}, stats);
      done += Number(res.lifetimeStatsDelta.missionsCompleted.shortOreRun ?? 0);
      captain = res.captain;
    }
    return { ticks, captain };
  }

  it("the stamped run flies home sooner on the cycles whose roll lands (and a run without the stamp never does)", () => {
    const stamped = returnTicks(wr9MissionDispatch("shortOreRun", 20), 60);
    const plain = returnTicks(wr9MissionDispatch("shortOreRun", 10), 60);
    expect(stamped.ticks).toBeLessThan(plain.ticks);
    // at most one tick per cycle, and the counter stepped once per delivered cycle
    expect(plain.ticks - stamped.ticks).toBeLessThanOrEqual(60);
    expect(stamped.captain.cunningCycles).toBe(60);
    expect(plain.captain.cunningCycles).toBeUndefined();
  });

  it("a run in flight from before WR-9 (no stamp) flies exactly as before", () => {
    const old = wr9MissionDispatch("shortOreRun", 20);
    const unstamped: GameState = {
      ...old,
      captains: old.captains.map((c) => (c.id === 1 && c.mission?.kind === "extraction" ? { ...c, mission: { ...c.mission, pilotCunning: undefined } } : c)),
    };
    delete (unstamped.captains[0].mission as { pilotCunning?: number }).pilotCunning;
    const viaOld = wr9MissionHash(withWr9Off(() => wr9MissionRun("shortOreRun")));
    // the same run from the unstamped dispatch, on live WR-9 code
    const r = makeRng(0x9e9);
    let s = unstamped;
    for (let i = 0; i < 400; i++) s = economyTick(s, 100, () => r.next());
    expect(wr9MissionHash(s)).toBe(viaOld);
  });

  it("one call == 997-tick chunks == 1-tick steps with the stamp live", () => {
    const s = wr9MissionDispatch("shortOreRun", 20);
    const ship = s.ships.find((sh) => sh.id === "ship-1")!;
    const stats = effectiveShipStats(s, ship);
    const start = s.captains.find((c) => c.id === 1)!;
    const T = 9_970;
    const run = (step: number): CaptainState => {
      const r = makeRng(11);
      let c = start;
      for (let done = 0; done < T; done += step) c = tickCaptainMission(Math.min(step, T - done), c, () => r.next(), {}, stats).captain;
      return c;
    };
    const one = run(T);
    expect(JSON.stringify(run(997))).toBe(JSON.stringify(one));
    expect(JSON.stringify(run(1))).toBe(JSON.stringify(one));
    expect(one.cunningCycles).toBeGreaterThan(10);
  });
});

// ===== OC-E9: Command Presence and Operations Integrity on expeditions =====

describe("OC-E9 Command Presence and Operations Integrity on Ground Ops", () => {
  const dispatch = (seed: number, integrity = 20) => {
    const s = wr9ExpeditionState(seed, integrity);
    const res = dispatchPastPropulsion(s, "ship-1", 1, expeditionCandidates(s, "ship-1")[0].id);
    if (!res.success || !res.expedition) throw new Error(`dispatch refused: ${res.reason}`);
    return res.expedition;
  };

  it("the dispatch freezes Command Presence and the Operations Integrity facet, each only when non-zero", () => {
    const exp = dispatch(0x1234);
    expect(exp.groundOutputShare).toBeCloseTo(getSeniorStaffBonusById("xo.commandOutput")!.magnitude, 12);
    expect(exp.groundOps?.factors.offloadSteady).toBeCloseTo(0.1, 12);
    expect("offloadSteady" in dispatch(0x1234, 10).groundOps!.factors).toBe(false);
    const off = withWr9Off(() => dispatch(0x1234));
    expect("groundOutputShare" in off).toBe(false);
    expect("offloadSteady" in off.groundOps!.factors).toBe(false);
  });

  it("Command Presence grows an objective's haul (the same roll, scaled)", () => {
    const exp = dispatch(0x1234);
    const body = { planetType: "terrestrial" as const, hazard: 0.6 };
    const team = [{ securityIds: [], scienceIds: [], scienceShare: 1 }];
    const withIt = taskFullHaul(exp, team, body, "mineralOutcrop", 0);
    const without = taskFullHaul({ ...exp, groundOutputShare: undefined }, team, body, "mineralOutcrop", 0);
    expect(Object.keys(withIt.materials)).toEqual(Object.keys(without.materials));
    expect(withIt.credits).toBeGreaterThan(without.credits);
    const item = Object.keys(without.materials)[0];
    expect(withIt.materials[item]).toBeGreaterThanOrEqual(without.materials[item]);
  });

  it("a packed offload (at least FULL_HOLD_FRACTION of the objective) divides by (1 + Integrity); a partial one does not", () => {
    const factors = { offloadMult: 1.25, offloadSteady: 0.1 };
    const base = OFFLOAD_BASE_SECONDS / 1.25;
    expect(groundOffloadSeconds(factors, 4, 4)).toBeCloseTo(base / 1.1, 12);
    expect(groundOffloadSeconds(factors, 9, 10)).toBeCloseTo(base / 1.1, 12);
    expect(FULL_HOLD_FRACTION).toBe(0.9);
    expect(groundOffloadSeconds(factors, 3, 4)).toBe(base);
    expect(groundOffloadSeconds({ offloadMult: 1.25 }, 4, 4)).toBe(base);
  });

  it("one call == 997 s chunks == 1 s steps with both live", () => {
    const exp = dispatch(0x3c3c);
    const end = 2_000_000;
    const one = advanceExpedition(exp, end);
    expect(one.phase).toBe("complete");
    let chunks = exp;
    for (let t = exp.phaseAnchorSeconds + 997; t < 200_000; t += 997) chunks = advanceExpedition(chunks, t);
    expect(advanceExpedition(chunks, end)).toEqual(one);
    const from = one.groundOps?.startedAt ?? exp.phaseAnchorSeconds;
    let ones = advanceExpedition(exp, from);
    for (let t = from + 1; t <= from + 6_000; t += 1) ones = advanceExpedition(ones, t);
    expect(ones).toEqual(advanceExpedition(exp, from + 6_000));
    expect(advanceExpedition(ones, end)).toEqual(one);
  });

  it("a run dispatched before WR-9 (neither field) resolves exactly as it did", () => {
    const old = withWr9Off(() => dispatch(0xbebe));
    expect(advanceExpedition(old, 2_000_000)).toEqual(withWr9Off(() => advanceExpedition(old, 2_000_000)));
  });
});

// ===== OC-E12: the third buff, OC-E11: enlisted =====

describe("OC-E12 a third buff at buffCount 3", () => {
  const ROWS = 3000;
  it("every 3-buff rank rolls a distinct third buff from its profession pool; lower ranks roll none; every earlier field is unchanged", () => {
    let thirds = 0;
    for (let i = 0; i < ROWS; i++) {
      const sig = generateComplementCrew(0xabc, i);
      const before = withWr9Off(() => generateComplementCrew(0xabc, i));
      const { buff3Id, ...rest } = sig;
      expect(rest).toEqual(before);
      if (buffCountForRank(sig.rank) >= 3) {
        expect(buff3Id).toBeDefined();
        expect(CREW_PROFESSION_BUFFS[sig.profession].some((b) => b.id === buff3Id)).toBe(true);
        expect(buff3Id).not.toBe(sig.buff1Id);
        expect(buff3Id).not.toBe(sig.buff2Id);
        thirds++;
      } else {
        expect(buff3Id).toBeUndefined();
      }
    }
    expect(thirds).toBeGreaterThan(50);
  });

  it("the third buff counts in the contribution, keys its own bucket, and leaves two-buff keys as they were", () => {
    const two: CrewSignature = { profession: "operations", rarity: "standard", rank: 8, race: "earthBorn", buff1Id: "ops.unloadSpeed", buff2Id: "ops.loadSpeed" };
    const three: CrewSignature = { ...two, buff3Id: "ops.effectiveCargo" };
    expect(signatureKey(two)).toBe("operations|standard|8|earthBorn|ops.unloadSpeed|ops.loadSpeed");
    expect(signatureKey(three)).not.toBe(signatureKey(two));
    const key = getCrewBuffById("ops.effectiveCargo")!.statKey;
    expect(contributionForSignature(two)[key]).toBeUndefined();
    expect(contributionForSignature(three)[key]).toBeGreaterThan(0);
    const list = addToBucketList(addToBucketList([], two, 3), three, 2);
    expect(list).toHaveLength(2);
    expect(list[1].buff3Id).toBe("ops.effectiveCargo");
    expect("buff3Id" in list[0]).toBe(false);
  });
});

// ===== OC-E6, OC-E7, OC-E9 text =====

describe("WR-9 player text", () => {
  it("Morale Anchor names only its Fear resist (OC-E7); Command Presence names expeditions (OC-E9)", () => {
    expect(getSeniorStaffBonusById("xo.moraleAnchor")!.description).not.toMatch(/attrition/i);
    expect(getSeniorStaffBonusById("xo.commandOutput")!.description).toMatch(/expedition objectives/);
  });
  it("the Help says Rapid Loadout speeds the Ground Ops reload only (OC-E6) and names the packed offload", () => {
    const body = HELP_TOPICS.find((t) => t.id === "returnTrip")!.body;
    expect(body).toMatch(/Rapid Loadout \(this reload is the only step it speeds: missions have no load step\)/);
    expect(body).toMatch(/Operations officer's Integrity when the team brings home at least 90% of an objective's haul/);
    expect(body).not.toMatch(/—|--/);
  });
});
