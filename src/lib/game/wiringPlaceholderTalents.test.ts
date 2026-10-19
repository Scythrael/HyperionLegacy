// WR-6 (0.14.0, plan docs/plans/2026-10-15-wiring-registry-and-audit-plan.md section 4 WR-6): each former placeholder
// or partial talent at its consumer, at its catalog magnitude, and the invariants its wiring promises (a run or job in
// flight never changes; offline == live; nothing moves without the source). The registry's sensitivity checks cover
// the seams; these cover the composition and the freezes.

import { describe, expect, it } from "vitest";
import Decimal from "break_infinity.js";
import {
  CAPTAIN_RACIAL_SCALE,
  CAPTAIN_TALENTS,
  CIVIC_CHARTER_TRANSPORT_CREW,
  EXPLORER_HUB_SCAN_RATE,
  HOME_GUARD_PATROL_SHIELD,
  HOMEWORLD_TALENTS,
  SALVAGE_TALENT_YIELD_BONUS,
  SCIENCE_SPEC_RELIC_FIND,
  TACTICAL_SPEC_WEAPON_DAMAGE,
  TACTICIAN_HUB_WEAPON_DAMAGE,
  WORKS_DIRECTORATE_BONUS_CHANCE,
  specCards,
  categoryCards,
  type GameState,
  type PatrolMissionState,
} from "./model";
import {
  describeCaptainTalentEffect,
  describeHomeworldTalentEffect,
  dispatchCaptainOnPatrol,
  fabricatorBonusOutputChance,
  resolveProcesses,
  startProcess,
  worksDirectorateBonus,
} from "./tick";
import { captainCombatMods, homeGuardPatrolShieldMult, patrolCaptainCombatMods, shipCaptainCombatMods } from "./captainTacticianEffects";
import { captainSurveyScanParams, explorerCaptainRun } from "./captainExplorerEffects";
import { captainPrimaryMult } from "./captainPrimaryEffects";
import { shipCrewContribution } from "./crewOverlay";
import { captainRacialBonus } from "./seniorStaff";
import { CREW_RACES } from "./crewRaces";
import { CREW_STAT_KEYS } from "./crewBuffs";
import { hullTeardownFraction, salvageTalentBonus } from "./salvage";
import { TRANSPORT_BATCH_SIZE, transportBatch, transportBatchSize } from "./transports";
import { combatBase, editCaptain, shipOf, teardownRecovered, withHomeworld, wiringBase } from "./wiring/probes";

const captain1 = (s: GameState) => s.captains[0];

describe("WR-6 captain primary: the hubs and the specs (OC-A40 to OC-A42, sizes [PROVISIONAL])", () => {
  it("Combat Readiness and the tactical spec are each their own weapon damage factor, composing with Weapons Drill", () => {
    const base = wiringBase();
    expect(captainCombatMods(captain1(base))).toBeUndefined();
    const hub = editCaptain(base, { unlockedCaptainTalents: ["tacticianHub"] });
    expect(Object.keys(captainCombatMods(captain1(hub))!)).toEqual(["weaponDamage"]);
    expect(captainCombatMods(captain1(hub))!.weaponDamage).toBeCloseTo(TACTICIAN_HUB_WEAPON_DAMAGE, 12);
    const all = editCaptain(base, { unlockedCaptainTalents: ["tacticianHub"], spec: "tactical", unlockedSecondaryTalents: ["gunnery1"] });
    const drill = captainCombatMods(editCaptain(base, { unlockedSecondaryTalents: ["gunnery1"] }).captains[0])!.weaponDamage!;
    expect(captainCombatMods(captain1(all))!.weaponDamage).toBeCloseTo((1 + drill) * (1 + TACTICIAN_HUB_WEAPON_DAMAGE) * (1 + TACTICAL_SPEC_WEAPON_DAMAGE) - 1, 12);
  });

  it("Survey Doctrine multiplies the frozen scan rate beside Cartographer; the science spec the relic find", () => {
    const base = wiringBase();
    expect(captainSurveyScanParams(captain1(base))).toEqual({});
    expect(explorerCaptainRun(captain1(base))).toBeUndefined();
    const hub = editCaptain(base, { unlockedCaptainTalents: ["explorerHub"] });
    expect(captainSurveyScanParams(captain1(hub)).captainScanRateMult).toBeCloseTo(1 + EXPLORER_HUB_SCAN_RATE, 12);
    const both = editCaptain(base, { unlockedCaptainTalents: ["explorerHub"], unlockedSecondaryTalents: ["surveySensors2"] });
    expect(captainSurveyScanParams(captain1(both)).captainScanRateMult).toBeCloseTo((1 + EXPLORER_HUB_SCAN_RATE) * 1.08, 12);
    const sci = editCaptain(base, { spec: "science" });
    expect(explorerCaptainRun(captain1(sci))).toEqual({ relicFindMult: 1 + SCIENCE_SPEC_RELIC_FIND });
  });

  it("a hub reads only the effect type it carries (a Prospector spec moves none of these factors)", () => {
    const pros = editCaptain(wiringBase(), { spec: "resourcefulness", unlockedCaptainTalents: ["prospectorHub"] });
    for (const kind of ["weaponDamageMult", "scanRateMult", "relicFindMult"] as const) expect(captainPrimaryMult(captain1(pros), kind)).toBe(1);
  });

  it("no captain node or Homeworld node is a 'No bonus yet' placeholder any more", () => {
    for (const def of Object.values(CAPTAIN_TALENTS)) expect(describeCaptainTalentEffect(def.effect)).not.toMatch(/No bonus yet/);
    for (const def of Object.values(HOMEWORLD_TALENTS)) expect(describeHomeworldTalentEffect(def.effect)).not.toMatch(/No bonus yet/);
    const cardText = [...specCards, ...categoryCards].flatMap((c) => c.bullets).join(" ");
    expect(cardText).not.toMatch(/arrives when|gateway node|No bonus yet/);
  });
});

describe("WR-6 captain race (OC-A43 [PROVISIONAL]: the officer magnitude)", () => {
  it("a Station-born captain adds its racial to the ship's crew map; no race adds nothing", () => {
    const base = wiringBase();
    const ship = shipOf(base);
    expect(captainRacialBonus(captain1(base))).toBeNull();
    expect(shipCrewContribution(base, ship)[CREW_STAT_KEYS.unloadSpeed] ?? 0).toBe(0);
    const raced = editCaptain(base, { race: "stationBorn" });
    const m = CREW_RACES.stationBorn.racialBonus.seniorStaff * CAPTAIN_RACIAL_SCALE;
    expect(shipCrewContribution(raced, shipOf(raced))[CREW_STAT_KEYS.unloadSpeed]).toBeCloseTo(m, 12);
  });

  it("the captain's racial follows the ship it commands, not the fleet", () => {
    const raced = editCaptain(wiringBase(), { race: "stationBorn" });
    const unassigned = { ...raced, ships: raced.ships.map((sh) => ({ ...sh, assignedCaptainId: null })) };
    expect(shipCrewContribution(unassigned, shipOf(unassigned))[CREW_STAT_KEYS.unloadSpeed] ?? 0).toBe(0);
  });
});

describe("WR-6 Salvage Operations on hull teardown (OC-B1, B16 wording)", () => {
  it("the teardown fraction gains the talent's percentage points, so a teardown refunds more", () => {
    const base = wiringBase();
    const owned = withHomeworld(base, ["fleetLogisticsSalvage"]);
    expect(salvageTalentBonus(owned).yieldBonus).toBe(SALVAGE_TALENT_YIELD_BONUS);
    expect(hullTeardownFraction(owned, 0.5) - hullTeardownFraction(base, 0.5)).toBeCloseTo(SALVAGE_TALENT_YIELD_BONUS, 12);
    expect(teardownRecovered(owned)).toBeGreaterThan(teardownRecovered(base));
    expect(describeHomeworldTalentEffect(HOMEWORLD_TALENTS.fleetLogisticsSalvage.effect)).toMatch(/percentage points/);
  });
});

describe("WR-6 Works Directorate (OC-B2: the Fabricator bonus, [PROVISIONAL] chance)", () => {
  const startBlanks = (s0: GameState, n: number): GameState => {
    let s = s0;
    for (let i = 0; i < n; i++) s = startProcess(s, "fabricateJob", {}, 5 + (i % 7), { type: "addBlank", blueprintKey: "wr6" }).next;
    return s;
  };

  it("the chance comes from the talent; no talent, no roll and no stamp", () => {
    expect(fabricatorBonusOutputChance(wiringBase())).toBe(0);
    expect(fabricatorBonusOutputChance(withHomeworld(wiringBase(), ["industryHub"]))).toBeCloseTo(WORKS_DIRECTORATE_BONUS_CHANCE, 12);
    expect(worksDirectorateBonus(7, 0)).toBe(false);
    const s = startBlanks(wiringBase(), 200);
    expect(s.activeProcesses.some((p) => p.bonusOutput)).toBe(false);
  });

  it("only a Fabricator job is stamped (a refine job never is)", () => {
    let s = withHomeworld(wiringBase(), ["industryHub"]);
    for (let i = 0; i < 200; i++) s = startProcess(s, "refineJob", {}, 5, { type: "addItem", itemId: "titaniumIngot", amount: new Decimal(1) }).next;
    expect(s.activeProcesses.some((p) => p.bonusOutput)).toBe(false);
  });

  it("the extra output is decided when the job starts: buying the talent later never changes a job in flight", () => {
    const before = startBlanks(wiringBase(), 100);
    const boughtLater = withHomeworld(before, ["industryHub"]);
    const done = resolveProcesses(boughtLater, 100, () => 0.5).next;
    expect(Number(done.blanks.wr6)).toBe(100);
  });

  it("offline == live: one resolve over the span and one-tick resolves deliver the same blanks", () => {
    const s0 = startBlanks(withHomeworld(wiringBase(), ["industryHub"]), 300);
    const big = resolveProcesses(s0, 20, () => 0.5).next;
    let small = s0;
    for (let i = 0; i < 20; i++) small = resolveProcesses(small, 1, () => 0.5).next;
    expect(Number(big.blanks.wr6)).toBe(Number(small.blanks.wr6));
    expect(Number(big.blanks.wr6)).toBeGreaterThan(300); // some jobs landed the extra blank
  });

  it("a stamped material job deposits its output twice and the completion log says so", () => {
    let s = withHomeworld({ ...wiringBase(), inventory: {} }, ["industryHub"]);
    let n = 0;
    while (!s.activeProcesses.some((p) => p.bonusOutput) && n < 500) {
      s = startProcess(s, "fabricateJob", {}, 1, { type: "addItem", itemId: "frameSegment", amount: new Decimal(1) }).next;
      n += 1;
    }
    const stamped = s.activeProcesses.filter((p) => p.bonusOutput).length;
    const done = resolveProcesses(s, 1, () => 0.5).next;
    const held = Object.values(done.inventory.frameSegment ?? {}).reduce((a, d) => a + Number(d), 0);
    expect(held).toBe(n + stamped);
  });
});

describe("WR-6 Home Guard (OC-B3: patrol shields, [PROVISIONAL] size)", () => {
  it("a patrol cycle freezes the Home Guard shield factor; an expedition ship event does not read it", () => {
    const base = withHomeworld({ ...combatBase(), captains: combatBase().captains.map((c) => ({ ...c, level: 10 })) }, ["homelandDefenseHub"]);
    expect(homeGuardPatrolShieldMult(base)).toBeCloseTo(1 + HOME_GUARD_PATROL_SHIELD, 12);
    const r = dispatchCaptainOnPatrol(base, 1, "crimsonReaverSweep", "balanced", false);
    expect(r.success).toBe(true);
    const mission = r.next.captains[0].mission as PatrolMissionState;
    expect(mission.captainCombat?.shield).toBeCloseTo(HOME_GUARD_PATROL_SHIELD, 12);
    expect(shipCaptainCombatMods(base, shipOf(base))).toBeUndefined();
    // Composes with Shield Discipline as its own factor.
    const aegis = captainCombatMods(editCaptain(base, { unlockedSecondaryTalents: ["aegis1"] }).captains[0])!.shield!;
    const both = patrolCaptainCombatMods(editCaptain(base, { unlockedSecondaryTalents: ["aegis1"] }).captains[0], homeGuardPatrolShieldMult(base));
    expect(both!.shield).toBeCloseTo((1 + aegis) * (1 + HOME_GUARD_PATROL_SHIELD) - 1, 12);
  });
});

describe("WR-6 Civic Charter (OC-B3: crew recruitment, [PROVISIONAL] size)", () => {
  it("every transport carries the extra crew, and the base batch's crew are unchanged (the bonus only adds)", () => {
    expect(transportBatchSize(wiringBase())).toBe(TRANSPORT_BATCH_SIZE);
    expect(transportBatchSize(withHomeworld(wiringBase(), ["citizenryHub"]))).toBe(TRANSPORT_BATCH_SIZE + CIVIC_CHARTER_TRANSPORT_CREW);
    const heads = (b: { count: number }[]) => b.reduce((a, x) => a + x.count, 0);
    const small = transportBatch(1234, 5, TRANSPORT_BATCH_SIZE);
    const large = transportBatch(1234, 5, TRANSPORT_BATCH_SIZE + CIVIC_CHARTER_TRANSPORT_CREW);
    expect(heads(large) - heads(small)).toBe(CIVIC_CHARTER_TRANSPORT_CREW);
    for (const b of small) {
      const match = large.find((x) => x.profession === b.profession && x.rarity === b.rarity && x.rank === b.rank && x.race === b.race && x.buff1Id === b.buff1Id && x.buff2Id === b.buff2Id);
      expect(match && match.count >= b.count).toBe(true);
    }
  });
});
