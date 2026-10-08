// E-CREW 0.14.0 (Task 15): FIELDWORK FROM SCIENCE MEMBERS (design D2, sections 5.4 and 5.5).
//
// Covers:
//   - the spec -> PoI mapping is one exhaustive partition of the PoI catalog;
//   - a planet-tuned tool (Flora Scanner, Thermal Rig, Atmo Probe) helps only on its planet types;
//   - a spec match raises the matching PoI's yield and no other's;
//   - the Hazard Suit / groundHazardResist cuts the scan hazard slowdown;
//   - groundRelicFind raises the relic odds;
//   - each Science implant does its documented thing (speed, relic, hazard, vault yield, organics yield);
//   - trait poiYield effects apply at their PoIs only;
//   - the crew rare find (Discovery Instinct + the Science division) is frozen at dispatch and read by the
//     relic roll;
//   - neutrality: a rosterless (pre-D18) in-flight expedition resolves exactly as before;
//   - determinism + offline == live with a real Science roster.

import { describe, it, expect } from "vitest";
import {
  freshState,
  type AwayMember,
  type AwayMemberSpec,
  type AwayTeamType,
  type AwayTraitId,
  type EquipmentInstance,
  type Expedition,
  type ExpeditionActivity,
  type ExpeditionBody,
  type ExpeditionPlanetType,
  type GameState,
  type MemberSlotType,
  type SeniorStaffOfficer,
} from "./model";
import {
  ACTIVITY_SECONDS,
  activityDurationSeconds,
  advanceExpedition,
  expeditionCandidates,
  startExpedition,
} from "./expedition";
import { snapshotAwayRoster, FIELDWORK_YIELD_PER_POINT, GEAR_POINT_BUMP } from "./awayTeam";
import {
  FIELDWORK_SPEED_MAX_MULT,
  FIELDWORK_SPEED_PER_BUMP,
  FIELDWORK_YIELD_PER_BUMP,
  NEUTRAL_FIELDWORK,
  ORGANICS_POIS,
  SCIENCE_SPEC_POIS,
  SCIENCE_STRENGTH_FIELDWORK,
  SPEC_POI_YIELD,
  VAULT_POIS,
  fieldworkEffect,
  fieldworkHazardResist,
  memberFieldworkOnBody,
} from "./fieldwork";
import { resolveExpeditionActivity } from "./gambit";
import { POI_CATALOG, PLANET_TYPES } from "./expeditionContent";
import { shipCrewContribution } from "./crewOverlay";
import { CREW_STAT_KEYS } from "./crewBuffs";

// ===== fixtures =====

function member(id: string, teamType: AwayTeamType, over: Partial<AwayMember> = {}): AwayMember {
  return {
    id,
    teamType,
    // A spec that favors NOTHING the tests below look at unless a test asks for one: cryptography favors
    // buriedVault + derelictOutpost only.
    spec: teamType === "science" ? "cryptography" : "offense",
    name: `Member ${id}`,
    race: "earthBorn",
    gender: "female",
    rank: 1,
    traits: [],
    assignedShipId: "ship-1",
    ...over,
  };
}

// A crafted member piece worn by `wearer`, its ground lines given explicitly (raw points).
function piece(
  id: string,
  slotType: MemberSlotType,
  variety: string,
  wearer: string,
  lines: Record<string, number>
): EquipmentInstance {
  return {
    id,
    slotType,
    moduleVariant: variety,
    rarity: "standard",
    ascension: "none",
    quality: 0,
    iLevel: 10,
    blueprintKey: "bp-test",
    implicitStats: { ...lines },
    rolledStats: {},
    mass: 0,
    powerDraw: 0,
    durabilityMax: 100,
    durability: 100,
    fittedToShipId: null,
    fittedToMemberId: wearer,
  };
}

const SEC = (): AwayMember => member("member-1", "security");

function withRoster(members: AwayMember[], gear: EquipmentInstance[] = []): GameState {
  const base = freshState();
  return { ...base, awayMembers: members, equipment: [...base.equipment, ...gear], nextAwayMemberId: 100 };
}

function body(planetType: ExpeditionPlanetType, poiIds: string[], over: Partial<ExpeditionBody> = {}): ExpeditionBody {
  return {
    id: "body-1",
    planetType,
    scanTotal: 100,
    scanProgress: 100,
    hazard: 0.4,
    scanned: true,
    discoveries: [],
    activities: poiIds.map((poiId, i) => ({ id: `act-${i}`, bodyId: "body-1", poiId, done: false })),
    ...over,
  };
}

// A hand-built expedition carrying a REAL roster snapshot of `state`'s ship-1.
function exp(state: GameState, bodies: ExpeditionBody[], over: Partial<Expedition> = {}): Expedition {
  return {
    id: "expedition-1",
    shipId: "ship-1",
    captainId: 1,
    targetSystemId: "keplersReach",
    systemName: "Kepler's Reach",
    sensorArrayId: null,
    scanParams: { scanRateMult: 1, coverageWidth: 1, landmarkOddsBias: 0, undergroundPoiOddsBias: 0 },
    sensorPower: 0,
    phase: "activities",
    phaseAnchorSeconds: 0,
    shakedown: false,
    bodies,
    anomalyResolved: true,
    anomalyCharted: false,
    anomalyOptIn: false,
    findings: [],
    seed: 7,
    securityStrength: 0,
    scienceStrength: 0,
    teamKit: 2,
    gambitPrograms: { security: [], science: [] },
    scanSpeedBonus: 0,
    relicFindBonus: 0,
    hazardResist: 0,
    roster: snapshotAwayRoster(state, state.ships[0]),
    ...over,
  };
}

// The Science-party effect for one bare-roster state vs one with `gear` / `sci` changes, at a PoI on a body.
function effectFor(sci: AwayMember[], gear: EquipmentInstance[], planetType: ExpeditionPlanetType, poiId: string) {
  const s = withRoster([SEC(), ...sci], gear);
  return fieldworkEffect(exp(s, [body(planetType, [poiId])]), planetType, poiId);
}

const SCI = (over: Partial<AwayMember> = {}): AwayMember => member("member-2", "science", over);

// ============================================================================
describe("the Science spec -> PoI mapping", () => {
  it("is one exhaustive partition: every PoI is favored by exactly one Science spec", () => {
    const seen = new Map<string, string>();
    for (const [spec, pois] of Object.entries(SCIENCE_SPEC_POIS)) {
      for (const poi of pois) {
        expect(seen.has(poi), `${poi} favored twice`).toBe(false);
        seen.set(poi, spec);
      }
    }
    expect([...seen.keys()].sort()).toEqual(POI_CATALOG.map((p) => p.id).sort());
    expect(Object.keys(SCIENCE_SPEC_POIS).sort()).toEqual(["archaeology", "cryptography", "geology", "xenobiology"]);
  });

  it("matches the spec tooltips' subjects", () => {
    expect(SCIENCE_SPEC_POIS.archaeology).toEqual(expect.arrayContaining(["ancientRuins", "subterraneanCivilization"]));
    expect(SCIENCE_SPEC_POIS.xenobiology).toEqual(["xenoFloraBloom"]);
    expect(SCIENCE_SPEC_POIS.geology).toEqual(expect.arrayContaining(["mineralOutcrop", "caveNetwork", "geothermalChamber"]));
    expect(SCIENCE_SPEC_POIS.cryptography).toEqual(expect.arrayContaining(["buriedVault"]));
  });

  it("the find families: organics at the xeno-flora bloom, vaults at the vault and the civilization", () => {
    expect([...ORGANICS_POIS]).toEqual(["xenoFloraBloom"]);
    expect([...VAULT_POIS].sort()).toEqual(["buriedVault", "subterraneanCivilization"]);
  });
});

// ============================================================================
describe("spec match raises the matching PoI's yield and no other's", () => {
  const specs: AwayMemberSpec[] = ["archaeology", "xenobiology", "geology", "cryptography"];
  for (const spec of specs) {
    it(`${spec}`, () => {
      for (const poi of POI_CATALOG) {
        const eff = effectFor([SCI({ spec })], [], "terrestrial", poi.id);
        const favored = (SCIENCE_SPEC_POIS as Record<string, readonly string[]>)[spec].includes(poi.id);
        expect(eff.yieldMult, `${spec} at ${poi.id}`).toBeCloseTo(favored ? 1 + SPEC_POI_YIELD : 1, 12);
        // A spec changes yield only, never pace or relic odds.
        expect(eff.speedMult).toBe(1);
        expect(eff.relicFind).toBe(0);
      }
    });
  }

  it("two matching members stack additively", () => {
    const s = withRoster([SEC(), SCI({ spec: "geology" }), member("member-3", "science", { spec: "geology" })]);
    const eff = fieldworkEffect(exp(s, [body("volcanic", ["mineralOutcrop"])]), "volcanic", "mineralOutcrop");
    expect(eff.yieldMult).toBeCloseTo(1 + 2 * SPEC_POI_YIELD, 12);
  });

  it("the resolved activity hauls more credits at the favored PoI", () => {
    const bare = withRoster([SEC(), SCI({ spec: "cryptography" })]);
    const geo = withRoster([SEC(), SCI({ spec: "geology" })]);
    const b = body("volcanic", ["mineralOutcrop"]);
    const act = b.activities[0];
    const a = resolveExpeditionActivity(exp(bare, [b]), b, act, 0).finding;
    const g = resolveExpeditionActivity(exp(geo, [b]), b, act, 0).finding;
    expect(g.credits ?? 0).toBeGreaterThan(a.credits ?? 0);
    // Same material item (the draw order is untouched), at least as many units.
    const am = a.materials ?? {};
    const gm = g.materials ?? {};
    expect(Object.keys(gm)).toEqual(Object.keys(am));
    const k = Object.keys(am)[0];
    expect(gm[k]).toBeGreaterThanOrEqual(am[k]);
  });
});

// ============================================================================
describe("planet-tuned tools help only on their planet types", () => {
  // A Flora Scanner with an organics line AND a fieldwork line: on a tuned body both count; elsewhere neither.
  const scanner = (): EquipmentInstance =>
    piece("equip-901", "memberTool", "floraScanner", "member-2", { groundOrganicsYield: 12, groundFieldwork: 6 });

  it("a Flora Scanner raises organics (the xeno-flora bloom) only on terrestrial, ocean and toxic bodies", () => {
    const tuned: ExpeditionPlanetType[] = ["terrestrial", "ocean", "toxic"];
    for (const pt of PLANET_TYPES.map((p) => p.id)) {
      const bare = effectFor([SCI()], [], pt, "xenoFloraBloom");
      const withTool = effectFor([SCI()], [scanner()], pt, "xenoFloraBloom");
      if (tuned.includes(pt)) {
        const expected =
          1 + 12 * FIELDWORK_YIELD_PER_POINT + FIELDWORK_YIELD_PER_BUMP * 6 * GEAR_POINT_BUMP.fieldwork;
        expect(withTool.yieldMult, pt).toBeCloseTo(expected, 12);
        expect(withTool.yieldMult).toBeGreaterThan(bare.yieldMult);
      } else {
        expect(withTool, pt).toEqual(bare);
      }
    }
  });

  it("a Flora Scanner's organics line does nothing at a non-organics PoI (its fieldwork line still counts)", () => {
    const withTool = effectFor([SCI()], [scanner()], "ocean", "mineralOutcrop");
    expect(withTool.yieldMult).toBeCloseTo(1 + FIELDWORK_YIELD_PER_BUMP * 6 * GEAR_POINT_BUMP.fieldwork, 12);
  });

  it("a Flora Scanner raises the resolved haul on an ocean world, not on an arid one", () => {
    for (const [pt, raises] of [["ocean", true], ["arid", false]] as const) {
      const b = body(pt, ["xenoFloraBloom"]);
      const bare = resolveExpeditionActivity(exp(withRoster([SEC(), SCI()]), [b]), b, b.activities[0], 0).finding;
      const tooled = resolveExpeditionActivity(
        exp(withRoster([SEC(), SCI()], [scanner()]), [b]),
        b,
        b.activities[0],
        0
      ).finding;
      if (raises) expect(tooled.credits ?? 0).toBeGreaterThan(bare.credits ?? 0);
      else expect(tooled).toEqual(bare);
    }
  });

  it("a Thermal Rig's hazard line cuts the hazard only on volcanic and frozen bodies", () => {
    const rig = piece("equip-902", "memberTool", "thermalRig", "member-2", { groundHazardResist: 20 });
    const s = withRoster([SEC(), SCI()], [rig]);
    const e = exp(s, [body("volcanic", [])]);
    expect(fieldworkHazardResist(e, "volcanic")).toBeCloseTo(20 * GEAR_POINT_BUMP.hazardResist, 12);
    expect(fieldworkHazardResist(e, "frozen")).toBeCloseTo(20 * GEAR_POINT_BUMP.hazardResist, 12);
    expect(fieldworkHazardResist(e, "toxic")).toBe(0);
  });

  it("an Atmo Probe works only on gas giants (and gas giant fieldwork runs without one)", () => {
    const probe = piece("equip-903", "memberTool", "atmoProbe", "member-2", { groundFieldwork: 20 });
    const gg = effectFor([SCI()], [probe], "gasGiant", "caveNetwork");
    expect(gg.speedMult).toBeGreaterThan(1);
    expect(effectFor([SCI()], [probe], "barren", "caveNetwork")).toEqual(effectFor([SCI()], [], "barren", "caveNetwork"));
    // No probe: a gas giant's activity still resolves (a finding with a haul), exactly as today.
    const b = body("gasGiant", ["caveNetwork"]);
    const f = resolveExpeditionActivity(exp(withRoster([SEC(), SCI()]), [b]), b, b.activities[0], 0).finding;
    expect(f.credits).toBeGreaterThan(0);
  });

  it("a Decryptor's vault line counts on ANY body, at the vault and the civilization only", () => {
    const dec = piece("equip-904", "memberTool", "decryptor", "member-2", { groundVaultYield: 12 });
    for (const pt of ["arid", "frozen", "toxic"] as const) {
      for (const poi of ["buriedVault", "subterraneanCivilization"]) {
        expect(effectFor([SCI({ spec: "geology" })], [dec], pt, poi).yieldMult).toBeCloseTo(1 + 12 * FIELDWORK_YIELD_PER_POINT, 12);
      }
      expect(effectFor([SCI({ spec: "geology" })], [dec], pt, "ancientRuins").yieldMult).toBe(1);
    }
  });
});

// ============================================================================
describe("hazard: the Hazard Suit and groundHazardResist cut the scan hazard slowdown", () => {
  // A scanning-phase single-body run with no encounter steps (the plain scan path), body hazard 1.
  function scanning(state: GameState, planetType: ExpeditionPlanetType): Expedition {
    return exp(state, [body(planetType, [], { scanProgress: 0, scanned: false, hazard: 1 })], { phase: "scanning" });
  }

  it("a Hazard Suit raises the scan progress made in the same time on a hazardous body", () => {
    const suit = piece("equip-905", "memberArmor", "hazardSuit", "member-2", { groundHazardResist: 30 });
    const bare = advanceExpedition(scanning(withRoster([SEC(), SCI()]), "toxic"), 600);
    const suited = advanceExpedition(scanning(withRoster([SEC(), SCI()], [suit]), "toxic"), 600);
    expect(suited.bodies[0].scanProgress).toBeGreaterThan(bare.bodies[0].scanProgress);
    // The rate: hazard 1 * (1 - 0.3) -> slow 1 + 0.7 * 0.5 instead of 1.5.
    expect(suited.bodies[0].scanProgress).toBeCloseTo((600 * 0.05) / (1 + 0.7 * 0.5), 9);
  });

  it("the Steady trait's hazardResist cuts it too, and adds to the museum's resist", () => {
    const steady = withRoster([SEC(), SCI({ traits: ["steady" as AwayTraitId] })]);
    expect(fieldworkHazardResist(exp(steady, []), "toxic")).toBeCloseTo(0.1, 12);
    const run = advanceExpedition(
      { ...scanning(steady, "toxic"), hazardResist: 0.2 },
      600
    );
    expect(run.bodies[0].scanProgress).toBeCloseTo((600 * 0.05) / (1 + 0.7 * 0.5), 9);
  });
});

// ============================================================================
describe("relic odds: groundRelicFind and the crew rare find", () => {
  function relicCount(e: Expedition, poiId: string): number {
    let n = 0;
    for (let i = 0; i < 400; i++) {
      const b = body("arid", [poiId], { hazard: 0 });
      // A strong crew layer so the Security squad wins most fights (a relic needs a win).
      const ex = { ...e, seed: (0x9e37 + i * 7919) >>> 0, bodies: [b], securityStrength: 60 };
      if (resolveExpeditionActivity(ex, b, b.activities[0], 0).finding.relic) n++;
    }
    return n;
  }

  it("an Archaeo-Scanner implant raises relicFind, and with it the relic count", () => {
    const scan = piece("equip-906", "implant", "archaeoScanner", "member-2", { groundRelicFind: 60 });
    const bareS = withRoster([SEC(), SCI()]);
    const implS = withRoster([SEC(), SCI()], [scan]);
    const eff = fieldworkEffect(exp(implS, []), "arid", "ancientRuins");
    expect(eff.relicFind).toBeCloseTo(60 * GEAR_POINT_BUMP.relicFind, 12);
    expect(relicCount(exp(implS, []), "ancientRuins")).toBeGreaterThan(relicCount(exp(bareS, []), "ancientRuins"));
  });

  it("Keen Eye's relicFind reads through, on every body", () => {
    const s = withRoster([SEC(), SCI({ traits: ["keenEye" as AwayTraitId] })]);
    for (const pt of ["arid", "gasGiant"] as const) expect(fieldworkEffect(exp(s, []), pt, "crashedShip").relicFind).toBeCloseTo(0.05, 12);
  });

  it("the crew rare find raises the relic count", () => {
    const s = withRoster([SEC(), SCI()]);
    expect(relicCount(exp(s, [], { crewRareFind: 0.6 }), "ancientRuins")).toBeGreaterThan(relicCount(exp(s, []), "ancientRuins"));
  });

  const scienceOfficer = (): SeniorStaffOfficer => ({
    id: "officer-1",
    seat: "science",
    name: "Test Scientist",
    race: "earthBorn",
    gender: "nonbinary",
    rank: "ensign",
    bonuses: [
      { id: "sci.discovery", magnitude: 0.12 },
      { id: "sci.yieldSurge", magnitude: 0.1 },
    ],
    missionsCompleted: 0,
    assignedShipId: "ship-1",
  });

  it("dispatch freezes the crew rare find (Discovery Instinct folded with the Science division) once", () => {
    const s = withRoster([SEC(), SCI()]);
    const rollup = (st: GameState): number => shipCrewContribution(st, st.ships[0])[CREW_STAT_KEYS.rareFindChance] ?? 0;
    const none = startExpedition(s, "ship-1", 1, expeditionCandidates(s, "ship-1")[0].id);
    expect(none.success).toBe(true);
    expect(none.expedition!.crewRareFind).toBe(rollup(s));
    const withOfficer = { ...s, officers: [scienceOfficer()] };
    const res = startExpedition(withOfficer, "ship-1", 1, expeditionCandidates(withOfficer, "ship-1")[0].id);
    expect(res.success).toBe(true);
    // Exactly the crew rollup (which already carries the officer bonus), never officer + rollup twice.
    expect(res.expedition!.crewRareFind).toBeCloseTo(rollup(withOfficer), 12);
    expect(res.expedition!.crewRareFind! - none.expedition!.crewRareFind!).toBeCloseTo(0.12, 9);
  });
});

// ============================================================================
describe("Science implants each do their documented thing", () => {
  const imp = (variety: string, lines: Record<string, number>): EquipmentInstance =>
    piece("equip-910", "implant", variety, "member-2", lines);

  it("Synaptic Accelerator: faster fieldwork (a shorter activity)", () => {
    const s = withRoster([SEC(), SCI()], [imp("synapticAccelerator", { groundFieldwork: 40 })]);
    const e = exp(s, [body("arid", ["ancientRuins"])]);
    const eff = fieldworkEffect(e, "arid", "ancientRuins");
    expect(eff.speedMult).toBeCloseTo(1 + FIELDWORK_SPEED_PER_BUMP * 40 * GEAR_POINT_BUMP.fieldwork, 12);
    expect(activityDurationSeconds(e, e.bodies[0])).toBe(Math.round(ACTIVITY_SECONDS / eff.speedMult));
    expect(activityDurationSeconds(e, e.bodies[0])).toBeLessThan(ACTIVITY_SECONDS);
  });

  it("Archaeo-Scanner: relic odds", () => {
    const s = withRoster([SEC(), SCI()], [imp("archaeoScanner", { groundRelicFind: 30 })]);
    expect(fieldworkEffect(exp(s, []), "arid", "ancientRuins").relicFind).toBeCloseTo(0.3, 12);
  });

  it("Environmental Adaptation: hazard resistance", () => {
    const s = withRoster([SEC(), SCI()], [imp("environmentalAdaptation", { groundHazardResist: 25 })]);
    expect(fieldworkHazardResist(exp(s, []), "toxic")).toBeCloseTo(0.25, 12);
  });

  it("Cipher Wetware: vault and civilization yield, nothing elsewhere", () => {
    const s = withRoster([SEC(), SCI({ spec: "xenobiology" })], [imp("cipherWetware", { groundVaultYield: 20 })]);
    const e = exp(s, []);
    for (const poi of VAULT_POIS) expect(fieldworkEffect(e, "arid", poi).yieldMult).toBeCloseTo(1 + 20 * FIELDWORK_YIELD_PER_POINT, 12);
    expect(fieldworkEffect(e, "arid", "mineralOutcrop").yieldMult).toBe(1);
  });

  it("Bio-Analyzer: organics yield on ANY body (an implant is never planet-tuned)", () => {
    const s = withRoster([SEC(), SCI({ spec: "geology" })], [imp("bioAnalyzer", { groundOrganicsYield: 20 })]);
    const e = exp(s, []);
    for (const pt of ["arid", "frozen", "ocean"] as const) {
      expect(fieldworkEffect(e, pt, "xenoFloraBloom").yieldMult).toBeCloseTo(1 + 20 * FIELDWORK_YIELD_PER_POINT, 12);
    }
    expect(fieldworkEffect(e, "arid", "caveNetwork").yieldMult).toBeCloseTo(1 + SPEC_POI_YIELD, 12);
  });
});

// ============================================================================
describe("traits and the crew strength layer", () => {
  it("a poiYield trait raises yield at its PoIs only", () => {
    const s = withRoster([SEC(), SCI({ spec: "xenobiology", traits: ["deepSurvey" as AwayTraitId] })]);
    const e = exp(s, []);
    expect(fieldworkEffect(e, "volcanic", "geothermalChamber").yieldMult).toBeCloseTo(1.1, 12);
    expect(fieldworkEffect(e, "volcanic", "mineralOutcrop").yieldMult).toBeCloseTo(1.1, 12);
    expect(fieldworkEffect(e, "volcanic", "caveNetwork").yieldMult).toBe(1);
  });

  it("scienceStrength (crew + officers + the museum's scienceTeamPower) adds a squad-wide fieldwork layer", () => {
    const s = withRoster([SEC(), SCI()]);
    const eff = fieldworkEffect(exp(s, [], { scienceStrength: 20 }), "arid", "caveNetwork");
    const F = 20 * SCIENCE_STRENGTH_FIELDWORK;
    expect(eff.yieldMult).toBeCloseTo(1 + FIELDWORK_YIELD_PER_BUMP * F, 12);
    expect(eff.speedMult).toBeCloseTo(1 + FIELDWORK_SPEED_PER_BUMP * F, 12);
  });

  it("the speed is capped", () => {
    const s = withRoster([SEC(), SCI()], [piece("equip-911", "implant", "synapticAccelerator", "member-2", { groundFieldwork: 5000 })]);
    const e = exp(s, [body("arid", ["ancientRuins"])]);
    expect(fieldworkEffect(e, "arid", "ancientRuins").speedMult).toBe(FIELDWORK_SPEED_MAX_MULT);
    expect(activityDurationSeconds(e, e.bodies[0])).toBe(Math.round(ACTIVITY_SECONDS / FIELDWORK_SPEED_MAX_MULT));
  });
});

// ============================================================================
describe("the snapshot carries each member's fieldwork sources", () => {
  it("one untuned source (traits + untuned gear), then one per planet-tuned tool", () => {
    const s = withRoster(
      [SEC(), SCI({ traits: ["keenEye" as AwayTraitId] })],
      [
        piece("equip-920", "memberArmor", "fieldSuit", "member-2", { groundFieldwork: 10 }),
        piece("equip-921", "memberTool", "floraScanner", "member-2", { groundOrganicsYield: 8, groundFieldwork: 4 }),
      ]
    );
    const sci = snapshotAwayRoster(s, s.ships[0]).science[0];
    expect(sci.fieldwork).toBeDefined();
    const [always, ...tuned] = sci.fieldwork!;
    expect(always.planetTypes).toBeUndefined();
    expect(always.fieldwork).toBeCloseTo(10 * GEAR_POINT_BUMP.fieldwork, 12);
    expect(always.relicFind).toBeCloseTo(0.05, 12);
    expect(tuned).toHaveLength(1);
    expect(tuned[0].planetTypes).toEqual(["terrestrial", "ocean", "toxic"]);
    expect(tuned[0].organicsYield).toBeCloseTo(8 * FIELDWORK_YIELD_PER_POINT, 12);
    expect(tuned[0].fieldwork).toBeCloseTo(4 * GEAR_POINT_BUMP.fieldwork, 12);
    // groundStats still totals EVERY worn piece (the member card's figure).
    expect(sci.groundStats.fieldwork).toBeCloseTo(14 * GEAR_POINT_BUMP.fieldwork, 12);
    // The per-body reader picks the tuned source only on a tuned body.
    expect(memberFieldworkOnBody(sci, "ocean").fieldwork).toBeCloseTo(14 * GEAR_POINT_BUMP.fieldwork, 12);
    expect(memberFieldworkOnBody(sci, "arid").fieldwork).toBeCloseTo(10 * GEAR_POINT_BUMP.fieldwork, 12);
  });

  it("a member snapshot from before Task 15 (no fieldwork sources) reads its groundStats, untuned", () => {
    const s = withRoster([SEC(), SCI({ traits: ["keenEye" as AwayTraitId] })]);
    const sci = { ...snapshotAwayRoster(s, s.ships[0]).science[0], fieldwork: undefined };
    expect(memberFieldworkOnBody(sci, "arid")).toEqual({
      fieldwork: 0,
      relicFind: 0.05,
      hazardResist: 0,
      organicsYield: 0,
      vaultYield: 0,
    });
  });
});

// ============================================================================
describe("NEUTRALITY", () => {
  it("a rosterless (pre-D18) expedition reads the neutral effect: same pace, same haul, same relic odds", () => {
    const s = withRoster([SEC(), SCI({ spec: "geology" })]);
    const e = exp(s, [body("volcanic", ["mineralOutcrop", "caveNetwork"])], { roster: undefined, scienceStrength: 25 });
    expect(fieldworkEffect(e, "volcanic", "mineralOutcrop")).toEqual(NEUTRAL_FIELDWORK);
    expect(fieldworkHazardResist(e, "volcanic")).toBe(0);
    expect(activityDurationSeconds(e, e.bodies[0])).toBe(ACTIVITY_SECONDS);
  });

  it("an empty Science squad is neutral too", () => {
    const s = withRoster([SEC()]);
    const e = exp(s, [body("volcanic", ["mineralOutcrop"])], { scienceStrength: 25 });
    expect(e.roster!.science).toEqual([]);
    expect(fieldworkEffect(e, "volcanic", "mineralOutcrop")).toEqual(NEUTRAL_FIELDWORK);
  });

  it("a rosterless run's activities complete one per ACTIVITY_SECONDS, exactly as before", () => {
    const s = withRoster([SEC(), SCI()]);
    const e = exp(s, [body("arid", ["ancientRuins", "caveNetwork", "buriedVault"])], { roster: undefined });
    const at = (t: number) => advanceExpedition(e, t).bodies[0].activities.filter((a: ExpeditionActivity) => a.done).length;
    expect(at(ACTIVITY_SECONDS - 1)).toBe(0);
    expect(at(ACTIVITY_SECONDS)).toBe(1);
    expect(at(2 * ACTIVITY_SECONDS)).toBe(2);
  });
});

// ============================================================================
describe("DETERMINISM + offline == live with a real Science roster", () => {
  function kitted(): GameState {
    return withRoster(
      [SEC(), SCI({ spec: "archaeology", traits: ["keenEye" as AwayTraitId] }), member("member-3", "science", { spec: "geology" })],
      [
        piece("equip-930", "implant", "synapticAccelerator", "member-2", { groundFieldwork: 30 }),
        piece("equip-931", "memberTool", "coreDrill", "member-3", { groundFieldwork: 12, groundRelicFind: 8 }),
        piece("equip-932", "memberArmor", "hazardSuit", "member-3", { groundHazardResist: 18 }),
      ]
    );
  }

  it("activities: a faster party completes more in the same time, and one big advance == many small", () => {
    const s = kitted();
    const start = exp(s, [
      body("arid", ["ancientRuins", "caveNetwork", "buriedVault"]),
      { ...body("toxic", ["xenoFloraBloom", "mineralOutcrop"]), id: "body-2" },
    ]);
    const durA = activityDurationSeconds(start, start.bodies[0]);
    expect(durA).toBeLessThan(ACTIVITY_SECONDS);
    // After 3 arid durations all three arid tasks are done (the bare run would have done 2 by then at most).
    const t = 3 * durA;
    const mid = advanceExpedition(start, t);
    expect(mid.bodies[0].activities.every((a) => a.done)).toBe(true);

    const END = 3 * durA + 2 * activityDurationSeconds(start, start.bodies[1]) + 5000;
    const big = advanceExpedition(start, END);
    let small = start;
    for (let x = 0; x <= END; x += 37) small = advanceExpedition(small, x);
    small = advanceExpedition(small, END);
    expect(small).toEqual(big);
    // Same inputs, same output (no shared stream).
    expect(advanceExpedition(start, END)).toEqual(big);
  });

  it("a full dispatched run with a kitted Science party completes identically offline and live", () => {
    const base = kitted();
    const s = { ...base, expeditionSeed: 0x51ed270b };
    const res = startExpedition(s, "ship-1", 1, expeditionCandidates(s, "ship-1")[0].id);
    expect(res.success).toBe(true);
    const BIG = 1_000_000;
    const big = advanceExpedition(res.expedition!, BIG);
    let small = res.expedition!;
    for (let x = 0; x <= BIG; x += 211) small = advanceExpedition(small, x);
    small = advanceExpedition(small, BIG);
    expect(big.phase).toBe("complete");
    expect(small).toEqual(big);
  });
});
