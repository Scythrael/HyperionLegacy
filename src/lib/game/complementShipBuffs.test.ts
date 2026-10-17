// Complement and Acquisition CP-2 (docs/plans/2026-10-14-complement-and-acquisition-plan.md section 3 CP-2): the
// ship-side complement buffs and the crew calls answered with them (wiring plan USER ANSWERS 2026-10-15).
//
//   Damage Control (crew.hullRepairRate, + Stheni racial)  -> the repair speed-up (Shipyard divisor, field repair)
//   Mission Turnaround (crew.missionTurnaround)            -> unloadSpeedMult x (1 + t) and the same repair speed-up
//   Crew Output Multiplier (crew.crewOutputMult, OC-E3)    -> the mission output share (missions and patrol loot)
//   Crew Effectiveness (crew.crewEffectiveness, + Earth-born racial, OC-3) -> every OTHER complement key x
//                                                             (1 + diminishing(e, CREW_EFFECTIVENESS_KNEE))
//   Fast Departure / Fast Return (OC-E5)                   -> each its own mission leg
//   Museum crewBonuses (OC-E8)                             -> also the officer bonuses read directly
//   Constitution (OC-E13)                                  -> a patrol's first cycle ramps too (officerStatFacets)
//
// Each test: the key moves its consumer and only it; a ship without it is unchanged; offline == live.

import { describe, it, expect } from "vitest";
import Decimal from "break_infinity.js";
import { MISSIONS, effectiveMissionDef, freshState, type CrewBucket, type GameState, type PatrolMissionState, type SeniorStaffOfficer, type ShipTypeKey } from "./model";
import {
  CREW_EFFECTIVENESS_KNEE,
  crewEffectivenessMultiplier,
  crewMissionOutputBonus,
  crewRepairSpeedBonus,
  effectiveShipStats,
  officerBonusTotal,
  officerCombatProfile,
  officerMissionOutputBonus,
  officerRepairSpeedBonus,
  shipCrewContribution,
  shipMissionOutputBonus,
  shipRepairSpeedBonus,
} from "./crewOverlay";
import { CREW_STAT_KEYS } from "./crewBuffs";
import { diminishing } from "./diminishing";
import { dispatchCaptainOnMission, dispatchCaptainOnPatrol, economyTick, installMissingCombatBaselines, processShipRepairs, shipRepairDurationTicks, tick } from "./tick";
import { equippedFor } from "./equipment";
import { expeditionCandidates, startExpedition } from "./expedition";
import { getSeniorStaffBonusById } from "./seniorStaffBonuses";
import { withSlottedAwayTeams, plainAwayMember } from "./awayTeamTestFixtures";
import { MUSEUM_COPY_LADDER, museumBonusesFromRecord, RELIC_SETS } from "./relics";

// ===== fixtures =====

// A Spacer crew by default: its racial (crew.endurance) has no 0.14.0 consumer, so the race lifts nothing.
function bucket(profession: CrewBucket["profession"], buff1Id: string, count: number, over: Partial<CrewBucket> = {}): CrewBucket {
  return { profession, rarity: "standard", rank: 1, race: "spacer", buff1Id, buff2Id: null, count, ...over };
}

function crewed(buckets: CrewBucket[], typeKey: ShipTypeKey = "generalFreighter", s0: GameState = freshState()): GameState {
  return { ...s0, ships: s0.ships.map((sh) => (sh.id === "ship-1" ? { ...sh, typeKey, complement: { mode: "active", buckets } } : sh)) };
}

function officer(seat: SeniorStaffOfficer["seat"], bonusIds: string[], race: SeniorStaffOfficer["race"] = "spacer"): SeniorStaffOfficer {
  const bonuses = bonusIds.map((id) => ({ id, magnitude: getSeniorStaffBonusById(id)!.magnitude }));
  const none = { id: "none", magnitude: 0 };
  return {
    id: `officer-${seat}`,
    seat,
    name: `Officer ${seat}`,
    race,
    gender: "nonbinary",
    rank: "ensign",
    bonuses: [bonuses[0] ?? none, bonuses[1] ?? none],
    missionsCompleted: 0,
    assignedShipId: "ship-1",
  };
}

const ship1 = (s: GameState) => s.ships.find((sh) => sh.id === "ship-1")!;

function lcg(seed: number): () => number {
  let x = seed >>> 0;
  return () => {
    x = (Math.imul(x, 1664525) + 1013904223) >>> 0;
    return x / 4294967296;
  };
}

// A Xeno 4-piece museum (the crewBonuses tier), and its amplification.
function xenoMuseum(): Record<string, number> {
  const set = RELIC_SETS.find((x) => x.tiers.some((t) => t.stats.includes("crewBonuses")))!;
  const tier = set.tiers.find((t) => t.stats.includes("crewBonuses"))!;
  return Object.fromEntries(set.relicIds.slice(0, tier.pieces).map((id) => [id, MUSEUM_COPY_LADDER[0]]));
}

// ===== Damage Control and Mission Turnaround: the repair speed-up =====

describe("Damage Control and Mission Turnaround speed every repair", () => {
  const damaged = (buckets: CrewBucket[]) =>
    installMissingCombatBaselines({
      ...crewed(buckets, "destroyer"),
      ships: crewed(buckets, "destroyer").ships.map((sh) => (sh.id === "ship-1" ? { ...sh, damaged: true, repairDamage: 437 } : sh)),
    });

  it("Damage Control: 0.0015 per head joins the Shipyard divisor (60 heads = +9%), and only the repair", () => {
    const none = damaged([bucket("engineering", "eng.range", 60)]);
    const dc = damaged([bucket("engineering", "eng.hullRepair", 60)]);
    expect(crewRepairSpeedBonus(none, ship1(none))).toBe(0);
    expect(crewRepairSpeedBonus(dc, ship1(dc))).toBeCloseTo(0.09, 12);
    expect(shipRepairSpeedBonus(dc, ship1(dc))).toBeCloseTo(officerRepairSpeedBonus(dc, ship1(dc)) + 0.09, 12);
    const ticks = (s: GameState) => processShipRepairs(s).activeProcesses.find((p) => p.kind === "shipRepair")!.durationTicks;
    const bare = damaged([]);
    expect(ticks(dc)).toBe(shipRepairDurationTicks(ship1(dc), equippedFor(dc, "ship-1"), 0.09));
    expect(ticks(dc)).toBeLessThan(ticks(bare));
    // It folds onto no ship stat: the sheet is the crew-free one.
    const plain = damaged([bucket("engineering", "wiring.none", 60)]);
    expect(effectiveShipStats(dc, ship1(dc))).toEqual(effectiveShipStats(plain, ship1(plain)));
  });

  it("the Stheni racial adds to the same speed-up (crew per head, officers at the officer magnitude)", () => {
    const crew = damaged([bucket("engineering", "eng.range", 100, { race: "stheni" })]);
    expect(crewRepairSpeedBonus(crew, ship1(crew))).toBeCloseTo(0.0006 * 100, 12);
    const seated = { ...damaged([]), officers: [officer("engineering", [], "stheni")] };
    expect(shipRepairSpeedBonus(seated, ship1(seated))).toBeCloseTo(0.06, 12);
  });

  it("Mission Turnaround: unload x (1 + t) on the sheet AND the repair speed-up (its own key, not Veteran Instincts')", () => {
    const s = crewed([bucket("operations", "excl.missionTurnaround", 5)]);
    const plain = crewed([bucket("operations", "wiring.none", 5)]);
    const t = 0.01 * 5;
    expect(effectiveShipStats(s, ship1(s)).unloadSpeedMult).toBeCloseTo(1 + t, 12);
    expect(effectiveShipStats(plain, ship1(plain)).unloadSpeedMult).toBeUndefined();
    expect(crewRepairSpeedBonus(s, ship1(s))).toBeCloseTo(t, 12);
    expect(officerRepairSpeedBonus(s, ship1(s))).toBe(0);
    // The unload phase really shortens on a big hold.
    const hold = (g: GameState) => effectiveMissionDef(MISSIONS.longOreRun, { ...effectiveShipStats(g, ship1(g)), cargoCapacity: 9000 }).unloadTicks;
    expect(hold(s)).toBeLessThan(hold(plain));
  });

  it("the field repair freezes the speed-up at dispatch; a run dispatched before keeps its value", () => {
    const squad = [plainAwayMember("member-1", "security", "ship-1"), plainAwayMember("member-11", "science", "ship-1")];
    const withSquad = (s: GameState) => withSlottedAwayTeams({ ...s, awayMembers: squad, nextAwayMemberId: 100, expeditionSeed: 0x1234 });
    const dispatch = (s: GameState) => {
      const r = startExpedition(s, "ship-1", 1, expeditionCandidates(s, "ship-1")[0].id);
      expect(r.success).toBe(true);
      return r;
    };
    const before = dispatch(withSquad(freshState()));
    expect(before.expedition!.groundOps!.shipEventProfile.battle!.repairSpeed).toBe(0);
    const dc = dispatch(withSquad(crewed([bucket("engineering", "eng.hullRepair", 60)])));
    expect(dc.expedition!.groundOps!.shipEventProfile.battle!.repairSpeed).toBeCloseTo(0.09, 12);
    // The earlier run's record is untouched by crew that arrive later (it reads only what it froze).
    const later = crewed([bucket("engineering", "eng.hullRepair", 60)], "generalFreighter", before.next);
    expect(later.expeditions[0].groundOps!.shipEventProfile.battle!.repairSpeed).toBe(0);
  });
});

// ===== Crew Output Multiplier =====

describe("Crew Output Multiplier joins the mission output share (OC-E3: mission + patrol haul)", () => {
  it("adds to Command Presence's share, read through the crew map", () => {
    const s = { ...crewed([bucket("operations", "excl.crewOutputMult", 3)]), officers: [officer("executive", ["xo.commandOutput"])] };
    expect(crewMissionOutputBonus(s, ship1(s))).toBeCloseTo(0.03, 12);
    expect(shipMissionOutputBonus(s, ship1(s))).toBeCloseTo(officerMissionOutputBonus(s, ship1(s)) + 0.03, 12);
    const none = crewed([bucket("operations", "wiring.none", 3)]);
    expect(shipMissionOutputBonus(none, ship1(none))).toBe(0);
    // No ship stat moves.
    expect(effectiveShipStats(s, ship1(s))).toEqual(effectiveShipStats({ ...s, ships: none.ships }, ship1(none)));
  });

  it("a mission delivers more with it, and one big offline catch-up equals the same span live", () => {
    const run = (buckets: CrewBucket[]) => {
      const base: GameState = { ...crewed(buckets), credits: new Decimal(1_000_000) };
      const r = dispatchCaptainOnMission(base, 1, "shortOreRun");
      expect(r.success).toBe(true);
      return r.next;
    };
    const boosted = run([bucket("operations", "excl.crewOutputMult", 20)]);
    const plain = run([bucket("operations", "wiring.none", 20)]);
    const N = 900;
    const big = tick(N, boosted, lcg(9));
    let small = boosted;
    const rng = lcg(9);
    for (let i = 0; i < N; i++) small = tick(1, small, rng);
    expect(JSON.stringify(big.inventory)).toBe(JSON.stringify(small.inventory));
    expect(big.credits.toString()).toBe(small.credits.toString());
    expect(JSON.stringify(big.captains)).toBe(JSON.stringify(small.captains));
    const plainAfter = tick(N, plain, lcg(9));
    expect(big.credits.gt(plainAfter.credits)).toBe(true);
  });

  it("a Repeat patrol's wave loot grows with it, and big == small", () => {
    const base = installMissingCombatBaselines({ ...crewed([bucket("operations", "excl.crewOutputMult", 20)], "destroyer"), credits: new Decimal(100_000) });
    const plainBase = installMissingCombatBaselines({ ...crewed([bucket("operations", "wiring.none", 20)], "destroyer"), credits: new Decimal(100_000) });
    const go = (s: GameState) => dispatchCaptainOnPatrol(s, 1, "crimsonReaverSweep", "balanced", true).next;
    const N = 1200;
    const big = tick(N, go(base), () => 0.5);
    let small = go(base);
    for (let i = 0; i < N; i++) small = tick(1, small, () => 0.5);
    expect(JSON.stringify(big.inventory)).toBe(JSON.stringify(small.inventory));
    expect(big.credits.toString()).toBe(small.credits.toString());
    expect((big.captains[0].mission as PatrolMissionState).repeatDispatch).toBe(true);
    const plain = tick(N, go(plainBase), () => 0.5);
    expect(big.credits.gt(plain.credits)).toBe(true);
  });
});

// ===== Crew Effectiveness =====

describe("Crew Effectiveness lifts every other complement buff (OC-3), on the D23 curve", () => {
  it("the multiplier is 1 + diminishing(e, knee): exactly 1 at 0, concave, never capped", () => {
    expect(crewEffectivenessMultiplier(0)).toBe(1);
    expect(crewEffectivenessMultiplier(-1)).toBe(1);
    expect(crewEffectivenessMultiplier(0.1)).toBeCloseTo(1 + diminishing(0.1, CREW_EFFECTIVENESS_KNEE), 15);
    const step = (e: number) => crewEffectivenessMultiplier(e + 0.1) - crewEffectivenessMultiplier(e);
    expect(step(1)).toBeLessThan(step(0));
    expect(crewEffectivenessMultiplier(100)).toBeGreaterThan(crewEffectivenessMultiplier(10));
  });

  it("scales every other complement key, never itself, and leaves the officers' own bonuses alone", () => {
    const others = [bucket("operations", "ops.unloadSpeed", 50), bucket("engineering", "eng.range", 40)];
    const med = bucket("medical", "med.effectiveness", 30);
    const without = crewed([...others, bucket("medical", "wiring.none", 30)]);
    const withIt = crewed([...others, med]);
    const officers = [officer("operations", ["ops.cargoExpand"])];
    const a = shipCrewContribution({ ...without, officers }, ship1(without));
    const b = shipCrewContribution({ ...withIt, officers }, ship1(withIt));
    const e = 0.002 * 30;
    const lift = 1 + diminishing(e, CREW_EFFECTIVENESS_KNEE);
    expect(b[CREW_STAT_KEYS.unloadSpeed]).toBeCloseTo(a[CREW_STAT_KEYS.unloadSpeed] * lift, 12);
    expect(b[CREW_STAT_KEYS.rangeEfficiency]).toBeCloseTo(a[CREW_STAT_KEYS.rangeEfficiency] * lift, 12);
    expect(b[CREW_STAT_KEYS.crewEffectiveness]).toBeCloseTo(e, 12);
    // The officer's Cargo Optimization is the whole effectiveCargo key here: not lifted.
    expect(b[CREW_STAT_KEYS.effectiveCargo]).toBe(a[CREW_STAT_KEYS.effectiveCargo]);
  });

  it("the Earth-born racial counts: per head on the crew, at the officer magnitude on a seated officer", () => {
    const lifted = bucket("operations", "ops.unloadSpeed", 50);
    const plain = crewed([lifted]);
    const u = shipCrewContribution(plain, ship1(plain))[CREW_STAT_KEYS.unloadSpeed];
    const earthCrew = crewed([lifted, bucket("security", "wiring.none", 100, { race: "earthBorn" })]);
    expect(shipCrewContribution(earthCrew, ship1(earthCrew))[CREW_STAT_KEYS.unloadSpeed]).toBeCloseTo(u * crewEffectivenessMultiplier(0.0004 * 100), 12);
    const earthOfficer = { ...plain, officers: [officer("executive", [], "earthBorn")] };
    expect(shipCrewContribution(earthOfficer, ship1(earthOfficer))[CREW_STAT_KEYS.unloadSpeed]).toBeCloseTo(u * crewEffectivenessMultiplier(0.04), 12);
  });

  it("with no effectiveness aboard the crew map is the plain rollup (same numbers, no float op)", () => {
    const s = crewed([bucket("operations", "ops.unloadSpeed", 50)]);
    expect(shipCrewContribution(s, ship1(s))[CREW_STAT_KEYS.unloadSpeed]).toBe(0.002 * 50);
  });
});

// ===== Fast Departure / Fast Return =====

describe("Fast Departure and Fast Return each act on their own leg (OC-E5)", () => {
  // A hold-free comparison on a long mission, so a few percent shows in whole ticks.
  const legs = (s: GameState) => {
    const def = effectiveMissionDef(MISSIONS.longOreRun, effectiveShipStats(s, ship1(s)));
    return { out: def.transitOutTicks, back: def.transitBackTicks };
  };
  const plain = legs(crewed([bucket("flightDeck", "wiring.none", 100)]));

  it("Fast Departure shortens only the outbound leg, Fast Return only the return leg", () => {
    const out = legs(crewed([bucket("flightDeck", "flight.transitOut", 100)]));
    const back = legs(crewed([bucket("flightDeck", "flight.transitBack", 100)]));
    expect(out.out).toBe(Math.ceil(MISSIONS.longOreRun.transitOutTicks / 1.2));
    expect(out.back).toBe(plain.back);
    expect(back.back).toBe(Math.ceil(MISSIONS.longOreRun.transitBackTicks / 1.2));
    expect(back.out).toBe(plain.out);
  });

  it("the Pilot's transit cut still sweeps both legs (transitSpeedMult)", () => {
    const s = { ...crewed([]), officers: [officer("pilot", ["pilot.transitCut"])] };
    const cut = getSeniorStaffBonusById("pilot.transitCut")!.magnitude;
    expect(effectiveShipStats(s, ship1(s)).transitSpeedMult).toBeCloseTo(1 + cut, 12);
    const l = legs(s);
    expect(l.out).toBe(Math.ceil(MISSIONS.longOreRun.transitOutTicks / (1 + cut)));
    expect(l.back).toBe(Math.ceil(MISSIONS.longOreRun.transitBackTicks / (1 + cut)));
  });
});

// ===== Museum crewBonuses on the officers =====

describe("the Museum's crewBonuses amplifies the officer bonuses read directly (OC-E8)", () => {
  it("officerBonusTotal and the officer combat profile grow by x (1 + crewBonuses); an empty museum is unchanged", () => {
    const record = xenoMuseum();
    const amp = museumBonusesFromRecord(record).crewBonuses;
    expect(amp).toBeGreaterThan(0);
    const base = installMissingCombatBaselines({ ...crewed([], "destroyer"), officers: [officer("medical", ["med.fleetTriage"]), officer("tactical", ["tac.weaponCommand"])] });
    const withMuseum = { ...base, relicMuseum: record };
    const triage = officerBonusTotal(base, ship1(base), "officer.crewLossPrevention");
    expect(triage).toBeGreaterThan(0);
    expect(officerBonusTotal(withMuseum, ship1(withMuseum), "officer.crewLossPrevention")).toBeCloseTo(triage * (1 + amp), 12);
    const weapons = (s: GameState) => officerCombatProfile(s, ship1(s)).find((e) => e.kind === "weapons")!.magnitude;
    expect(weapons(withMuseum)).toBeCloseTo(weapons(base) * (1 + amp), 12);
    expect(officerBonusTotal({ ...base, relicMuseum: {} }, ship1(base), "officer.crewLossPrevention")).toBe(triage);
  });

  it("a ship with no officers and no crew is untouched by the museum's crewBonuses", () => {
    const s = { ...freshState(), relicMuseum: xenoMuseum() };
    expect(shipRepairSpeedBonus(s, ship1(s))).toBe(0);
    expect(shipMissionOutputBonus(s, ship1(s))).toBe(0);
  });
});

// ===== neutrality =====

describe("neutral without the keys", () => {
  it("a crew-free ship reads exactly 0 from every CP-2 consumer and runs a mission exactly as before", () => {
    const s = freshState();
    expect(crewRepairSpeedBonus(s, ship1(s))).toBe(0);
    expect(crewMissionOutputBonus(s, ship1(s))).toBe(0);
    expect(shipCrewContribution(s, ship1(s))).toEqual({});
    let a = dispatchCaptainOnMission({ ...s, credits: new Decimal(1000) }, 1, "shortOreRun").next;
    for (let i = 0; i < 200; i++) a = economyTick(a, 1, lcg(4));
    expect(a.captains[0].mission).not.toBeNull();
  });
});
