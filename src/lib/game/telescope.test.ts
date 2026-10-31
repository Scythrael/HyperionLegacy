// Squads SQ-5 (docs/plans/2026-10-12-squads-and-subspace-telescope-design.md section 6): the Subspace Telescope
// facility (its level ladder, upgrades as funded development cycles on the existing facility framework), the
// telescope READING (range in light-years from the homeworld, the detail it reads, flat across the range), the
// ship's sensors 40+ lift, the detail GATING of the risk preview, the blind state on the candidate, and the proof
// that the telescope only changes what is SHOWN (a run resolves identically at every level).

import { describe, expect, it } from "vitest";
import Decimal from "break_infinity.js";
import {
  FACILITIES,
  SUBSPACE_TELESCOPE_FACILITY_KEY,
  SUBSPACE_TELESCOPE_LEVELS,
  freshState,
  type AwayMember,
  type BodyRiskGrades,
  type EquipmentInstance,
  type ExpeditionRiskProfile,
  type GameState,
  type RegionTier,
  type ShipGroundTeam,
} from "./model";
import { canBuildFacilityUpgrade, resolveProcesses, startFacilityUpgrade } from "./tick";
import {
  SENSOR_REVEAL_HAZARD,
  advanceExpedition,
  claimExpedition,
  editGroundOps,
  expeditionCandidates,
  expeditionLaunchView,
  expeditionRiskPreview,
  } from "./expedition";
import {
  PROVISIONAL_HOMEWORLD,
  REGION_TIER_NAMES,
  TELESCOPE_DETAIL,
  TELESCOPE_DETAIL_NAMES,
  TELESCOPE_DEVELOPMENT_CYCLES,
  TELESCOPE_SHIP_LIFT_SENSORS,
  blindLaunchCount,
  gateRiskView,
  rangeLyForReach,
  readSystem,
  regionTierNumeral,
  stateHomeworld,
  systemDistanceLy,
  telescopeLevel,
  telescopeReading,
  telescopeReadingAtLevel,
} from "./telescope";
import { buildHomeDashboard } from "./homeDashboard";
import { plainAwayMember, dispatchPastPropulsion } from "./awayTeamTestFixtures";
import { groundOpsStuck, groundOpsStuckTaskIds } from "./groundOps";

const TELESCOPE = FACILITIES[SUBSPACE_TELESCOPE_FACILITY_KEY];

function atLevel(level: number, base: GameState = freshState()): GameState {
  return { ...base, facilities: { ...base.facilities, [SUBSPACE_TELESCOPE_FACILITY_KEY]: { level } } };
}

// A hand-built preview: one system of the given tier, with these bodies.
function preview(tier: RegionTier, bodies: BodyRiskGrades[], enemyTerritory = false): { profile: ExpeditionRiskProfile; bodies: BodyRiskGrades[] } {
  return {
    profile: { version: 1, tier, enemyTerritory, system: { combat: 3, fauna: 2, flora: 2 } },
    bodies,
  };
}
const MIXED: BodyRiskGrades[] = [
  { combat: 2, fauna: 0, flora: 0, hazard: 3 },
  { combat: 1, fauna: 2, flora: 1, hazard: 0 },
];
const CALM: BodyRiskGrades[] = [{ combat: 0, fauna: 0, flora: 0, hazard: 0 }];

describe("FACILITIES.subspaceTelescope (the level ladder)", () => {
  it("is the user-named facility with the 8-level ladder, one rung per table row", () => {
    expect(TELESCOPE.label).toBe("Subspace Telescope");
    expect(SUBSPACE_TELESCOPE_LEVELS.map((r) => r.level)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(TELESCOPE.upgrades).toHaveLength(SUBSPACE_TELESCOPE_LEVELS.length);
    TELESCOPE.upgrades.forEach((rung, i) => {
      const row = SUBSPACE_TELESCOPE_LEVELS[i];
      expect(rung.effect).toEqual({ telescope: { reachTier: row.reachTier, detail: row.detail } });
      expect(rung.durationTicks).toBe(row.durationTicks);
    });
  });

  it("the founding rung is free, instant and ungated (pre-granted at level 1)", () => {
    const founding = TELESCOPE.upgrades[0];
    expect(founding.credits).toBeUndefined();
    expect(founding.durationTicks).toBe(0);
    expect(founding.requiresFleetAdminLevel).toBeUndefined();
    expect(Object.keys(founding.materials)).toHaveLength(0);
    expect(freshState().facilities[SUBSPACE_TELESCOPE_FACILITY_KEY]).toEqual({ level: 1 });
  });

  it("every development cycle costs credits + an FA gate only (no materials, no talent gates), the design's credits and FA gates", () => {
    for (let i = 1; i < TELESCOPE.upgrades.length; i++) {
      const rung = TELESCOPE.upgrades[i];
      expect(Object.keys(rung.materials), `rung ${i} materials`).toHaveLength(0);
      expect(rung.requiresHomeworldTalents, `rung ${i} talents`).toBeUndefined();
      expect(rung.requiresResearch).toBeUndefined();
      expect(rung.requiresFacilityLevels).toBeUndefined();
      expect(rung.credits!.gt(0)).toBe(true);
      expect(rung.durationTicks).toBeGreaterThan(TELESCOPE.upgrades[i - 1].durationTicks);
    }
    expect(TELESCOPE.upgrades.slice(1).map((r) => r.credits!.toNumber())).toEqual([4_000, 10_000, 25_000, 60_000, 150_000, 375_000, 900_000]);
    expect(TELESCOPE.upgrades.slice(1).map((r) => r.requiresFleetAdminLevel)).toEqual([3, 5, 8, 11, 14, 17, 20]);
    expect(TELESCOPE.upgrades[1].credits!.toNumber()).toBe(4_000);
    expect(TELESCOPE.upgrades[7].credits!.toNumber()).toBe(900_000);
  });

  it("reach and detail never go down a level, detail tops out at Forecast and Level 8 reaches the Galactic Core", () => {
    let reach = 0;
    let detail = 0;
    for (const row of SUBSPACE_TELESCOPE_LEVELS) {
      expect(row.reachTier).toBeGreaterThanOrEqual(reach);
      expect(row.detail).toBeGreaterThanOrEqual(detail);
      expect(row.detail).toBeLessThanOrEqual(TELESCOPE_DETAIL.forecast);
      reach = row.reachTier;
      detail = row.detail;
    }
    expect(reach).toBe(7);
    expect(detail).toBe(5);
  });

  it("names a funded development cycle for every bought level, never a new entity", () => {
    expect(Object.keys(TELESCOPE_DEVELOPMENT_CYCLES).map(Number)).toEqual([2, 3, 4, 5, 6, 7, 8]);
    for (const line of Object.values(TELESCOPE_DEVELOPMENT_CYCLES)) {
      expect(line.length).toBeGreaterThan(0);
      expect(line).not.toMatch(/—|-{2}/);
      expect(line).not.toMatch(/\bfit(ting|ted)?\b/i);
    }
  });

  it("no other facility rung carries the telescope effect", () => {
    for (const [key, def] of Object.entries(FACILITIES)) {
      if (key === SUBSPACE_TELESCOPE_FACILITY_KEY) continue;
      for (const rung of def.upgrades) expect("telescope" in rung.effect, `${key}`).toBe(false);
    }
  });
});

describe("telescope upgrades run like every facility upgrade", () => {
  it("a cycle is gated on FA level and credits, deducts the credits at start and bumps the level at completion", () => {
    const poor = { ...freshState(), fleetAdminLevel: 3, credits: new Decimal(3_999) };
    expect(canBuildFacilityUpgrade(poor, SUBSPACE_TELESCOPE_FACILITY_KEY).ok).toBe(false);
    const lowFa = { ...freshState(), fleetAdminLevel: 2, credits: new Decimal(1e9) };
    expect(canBuildFacilityUpgrade(lowFa, SUBSPACE_TELESCOPE_FACILITY_KEY)).toEqual({ ok: false, reason: "Requires Fleet Admiral level 3" });

    const ready = { ...freshState(), fleetAdminLevel: 3, credits: new Decimal(5_000) };
    expect(canBuildFacilityUpgrade(ready, SUBSPACE_TELESCOPE_FACILITY_KEY).ok).toBe(true);
    const started = startFacilityUpgrade(ready, SUBSPACE_TELESCOPE_FACILITY_KEY);
    expect(started.started).toBe(true);
    expect(started.next.credits.toNumber()).toBe(1_000);
    const proc = started.next.activeProcesses.find((p) => p.kind === "facilityUpgrade")!;
    expect(proc.durationTicks).toBe(120);
    expect(proc.effect).toEqual({ type: "facilityLevelUp", facility: SUBSPACE_TELESCOPE_FACILITY_KEY });
    expect(telescopeLevel(started.next)).toBe(1); // mid-cycle: still Level 1
    expect(canBuildFacilityUpgrade(started.next, SUBSPACE_TELESCOPE_FACILITY_KEY).reason).toBe("Upgrade already in progress");

    const done = resolveProcesses(started.next, 120).next;
    expect(telescopeLevel(done)).toBe(2);
    expect(telescopeReading(done, PROVISIONAL_HOMEWORLD)).toMatchObject({ level: 2, reachTier: 2, rangeLy: 3_000, detail: 2 });
    // G2-1: the state reader measures from the save's own homeworld.
    expect(telescopeReading(done)).toEqual(telescopeReadingAtLevel(2, stateHomeworld(done)));
  });

  it("Level 8 is fully upgraded", () => {
    const top = { ...atLevel(8), fleetAdminLevel: 99, credits: new Decimal(1e12) };
    expect(canBuildFacilityUpgrade(top, SUBSPACE_TELESCOPE_FACILITY_KEY)).toEqual({ ok: false, reason: "Subspace Telescope is fully upgraded" });
  });

  it("Home offers a startable telescope upgrade now that its Facilities card exists (SQ-7.4)", () => {
    const rich = { ...freshState(), credits: new Decimal(1e12), fleetAdminLevel: 30 };
    expect(canBuildFacilityUpgrade(rich, SUBSPACE_TELESCOPE_FACILITY_KEY).ok).toBe(true);
    const prompt = buildHomeDashboard(rich).needsOrders.find((p) => p.id === "idle-facility-upgrade");
    expect(prompt?.facilityKeys ?? []).toContain(SUBSPACE_TELESCOPE_FACILITY_KEY);
    // Not startable (FA gate unmet): never offered.
    const gated = { ...freshState(), credits: new Decimal(1e12), fleetAdminLevel: 1 };
    const none = buildHomeDashboard(gated).needsOrders.find((p) => p.id === "idle-facility-upgrade");
    expect(none?.facilityKeys ?? []).not.toContain(SUBSPACE_TELESCOPE_FACILITY_KEY);
  });
});

describe("the reading: range in light-years from the homeworld, and detail", () => {
  it("each level reads the design table's reach, range and detail", () => {
    const expected: [number, number, number, number][] = [
      // level, reachTier, rangeLy, detail
      [1, 1, 150, 2],
      [2, 2, 3_000, 2],
      [3, 2, 3_000, 3],
      [4, 4, 7_600, 3],
      [5, 4, 7_600, 4],
      [6, 5, 13_000, 4],
      [7, 6, 25_000, 5],
      [8, 7, 26_500, 5],
    ];
    for (const [level, reachTier, rangeLy, detail] of expected) {
      expect(telescopeReadingAtLevel(level), `level ${level}`).toEqual({ level, reachTier, rangeLy, detail, detailName: TELESCOPE_DETAIL_NAMES[detail] });
      expect(telescopeReading(atLevel(level), PROVISIONAL_HOMEWORLD)).toEqual(telescopeReadingAtLevel(level));
      expect(telescopeReading(atLevel(level))).toEqual(telescopeReadingAtLevel(level, stateHomeworld(atLevel(level))));
    }
  });

  it("an unfounded telescope (level 0, never on a real save) reads nothing; a level past the track reads the top rung", () => {
    expect(telescopeReadingAtLevel(0)).toEqual({ level: 0, reachTier: 0, rangeLy: 0, detail: 0, detailName: "Blind" });
    expect(telescopeReadingAtLevel(12)).toMatchObject({ reachTier: 7, rangeLy: 26_500, detail: 5 });
    const absent = { ...freshState(), facilities: { ...freshState().facilities } };
    delete absent.facilities[SUBSPACE_TELESCOPE_FACILITY_KEY];
    expect(telescopeLevel(absent)).toBe(0);
  });

  it("range is the far edge of the reached regions as measured from the PROVISIONAL homeworld", () => {
    expect(rangeLyForReach(0)).toBe(0);
    expect(rangeLyForReach(3)).toBe(7_600); // Perseus and Sagittarius share one band
    for (let tier = 1 as RegionTier; tier <= 7; tier = (tier + 1) as RegionTier) {
      expect(rangeLyForReach(tier)).toBe(Math.max(...([1, 2, 3, 4, 5, 6, 7] as RegionTier[]).filter((t) => t <= tier).map((t) => PROVISIONAL_HOMEWORLD.regionBandsLy[t].far)));
    }
    expect(PROVISIONAL_HOMEWORLD.distanceFromCoreLy).toBe(26_500);
  });

  it("names the seven regions and their numerals", () => {
    expect(REGION_TIER_NAMES[1]).toBe("Local Bubble");
    expect(REGION_TIER_NAMES[7]).toBe("Galactic Core");
    expect([1, 2, 3, 4, 5, 6, 7].map((t) => regionTierNumeral(t as RegionTier))).toEqual(["I", "II", "III", "IV", "V", "VI", "VII"]);
  });

  it("a system's distance is deterministic and lies inside its region's band, never ON its near edge (SQ-5 review Minor 1)", () => {
    for (let tier = 1 as RegionTier; tier <= 7; tier = (tier + 1) as RegionTier) {
      const band = PROVISIONAL_HOMEWORLD.regionBandsLy[tier];
      for (let seed = 1; seed < 400; seed += 7) {
        const d = systemDistanceLy(seed * 2654435761, tier);
        expect(Number.isInteger(d)).toBe(true);
        // The near edge is the previous region's far edge (its telescope range): a system there would read in range
        // one region early.
        expect(d).toBeGreaterThan(band.near);
        expect(d).toBeLessThanOrEqual(band.far);
        expect(systemDistanceLy(seed * 2654435761, tier)).toBe(d);
      }
    }
  });

  it("the near edge can never be drawn: a tiny band reads its far edge, and over many seeds no Tier II system sits at 150 ly", () => {
    const tight = { ...PROVISIONAL_HOMEWORLD, regionBandsLy: { ...PROVISIONAL_HOMEWORLD.regionBandsLy, 2: { near: 150, far: 151 } } };
    for (let seed = 0; seed < 50; seed++) expect(systemDistanceLy(seed, 2, tight)).toBe(151);
    for (let seed = 0; seed < 4000; seed++) expect(systemDistanceLy(seed, 2)).toBeGreaterThan(rangeLyForReach(1));
  });

  it("in range by distance agrees with in range by region (nearer regions first)", () => {
    for (let level = 0; level <= 8; level++) {
      const reading = telescopeReadingAtLevel(level);
      for (let tier = 1 as RegionTier; tier <= 7; tier = (tier + 1) as RegionTier) {
        for (let seed = 3; seed < 200; seed += 11) {
          const sys = readSystem(reading, seed, 0, preview(tier, CALM));
          expect(sys.inRange, `level ${level} tier ${tier}`).toBe(tier <= reading.reachTier);
          expect(sys.inRange).toBe(sys.distanceLy <= reading.rangeLy);
        }
      }
    }
  });
});

describe("readSystem: blind, flat detail and the ship's lift", () => {
  it("beyond range a system is BLIND: no detail, no risk, the range gap shown", () => {
    const sys = readSystem(telescopeReadingAtLevel(2), 12345, 100, preview(4, MIXED));
    expect(sys).toMatchObject({ regionTier: 4, inRange: false, blind: true, telescopeDetail: 0, shipLift: false, detail: 0, detailName: "Blind", risk: null, rangeLy: 3_000 });
    expect(sys.distanceLy).toBeGreaterThan(sys.rangeLy);
  });

  it("detail is FLAT across the range (no falloff in the outermost region) [PROVISIONAL, user #8]", () => {
    const reading = telescopeReadingAtLevel(4);
    for (const tier of [1, 2, 3, 4] as RegionTier[]) {
      expect(readSystem(reading, 99, 0, preview(tier, MIXED)).detail).toBe(3);
    }
  });

  it("the ship's sensors at 40+ add one detail level, never past Forecast and never past range", () => {
    expect(TELESCOPE_SHIP_LIFT_SENSORS).toBe(SENSOR_REVEAL_HAZARD);
    const l3 = telescopeReadingAtLevel(3);
    expect(readSystem(l3, 7, 39, preview(1, MIXED))).toMatchObject({ telescopeDetail: 3, shipLift: false, detail: 3 });
    expect(readSystem(l3, 7, 40, preview(1, MIXED))).toMatchObject({ telescopeDetail: 3, shipLift: true, detail: 4, detailName: "Recommendation" });
    expect(readSystem(telescopeReadingAtLevel(8), 7, 500, preview(7, MIXED))).toMatchObject({ telescopeDetail: 5, shipLift: false, detail: 5 });
    expect(readSystem(l3, 7, 500, preview(3, MIXED))).toMatchObject({ blind: true, shipLift: false, detail: 0, risk: null });
  });
});

describe("gateRiskView: what each detail level reveals", () => {
  const p = preview(2, MIXED, true);

  it("Blind (0) reveals nothing", () => {
    expect(gateRiskView(p, 0)).toBeNull();
  });

  it("Contact (1) reveals which factors are present at system level, no grades, no bodies", () => {
    expect(gateRiskView(p, 1)).toEqual({
      factors: {
        combat: { present: true, grade: null },
        fauna: { present: true, grade: null },
        flora: { present: true, grade: null },
        hazard: { present: true, grade: null },
      },
      enemyTerritory: null,
      bodies: null,
    });
    const calm = gateRiskView(preview(1, CALM), 1)!;
    expect(Object.values(calm.factors).every((f) => !f.present)).toBe(true);
  });

  it("Graded (2) adds each factor's system-level grade (the worst body) and enemy territory", () => {
    expect(gateRiskView(p, 2)).toEqual({
      factors: {
        combat: { present: true, grade: 2 },
        fauna: { present: true, grade: 2 },
        flora: { present: true, grade: 1 },
        hazard: { present: true, grade: 3 },
      },
      enemyTerritory: true,
      bodies: null,
    });
  });

  it("Per body (3) adds every body's grades; Recommendation and Forecast (4, 5) read the same risk (SQ-6 adds theirs)", () => {
    const v3 = gateRiskView(p, 3)!;
    expect(v3.bodies).toEqual(MIXED.map((b) => ({ combat: b.combat, fauna: b.fauna, flora: b.flora, hazard: b.hazard })));
    expect(gateRiskView(p, 4)).toEqual(v3);
    expect(gateRiskView(p, 5)).toEqual(v3);
  });

  it("never reveals a body's hostile site placement (fielding it depends on the squads: SQ-6's task preview)", () => {
    const withSite = preview(3, [{ combat: 3, fauna: 0, flora: 0, hazard: 0, site: "enemyColony" }]);
    expect(JSON.stringify(gateRiskView(withSite, 5))).not.toContain("enemyColony");
  });
});

// ===== The candidate and the run =====

const T0 = 100_000;
const SEC = ["member-1", "member-2", "member-3"];
const SCI = ["member-11", "member-12", "member-13"];
const CREW: AwayMember[] = [
  // Rank 8, the top of the ladder (GO-12 review: no out-of-ladder ranks in fixtures). A crew that still stalls
  // skips its stuck tasks at a checkpoint (the GO-13 escape hatch, the same edits at every level), so the run
  // finishes and the claim is compared too.
  ...SEC.map((id) => ({ ...plainAwayMember(id, "security", "ship-1"), rank: 8 as AwayMember["rank"] })),
  ...SCI.map((id) => ({ ...plainAwayMember(id, "science", "ship-1"), rank: 8 as AwayMember["rank"] })),
];

function crewedState(): GameState {
  const base = freshState();
  const teams: ShipGroundTeam[] = [
    { kind: "ground", security: [...SEC], science: [...SCI], helpOthers: false },
    { kind: "ground", security: [null, null, null], science: [null, null, null], helpOthers: false },
  ];
  return {
    ...base,
    gameTimeSeconds: T0,
    awayMembers: CREW.map((m) => ({ ...m })),
    nextAwayMemberId: 100,
    ships: base.ships.map((sh) => ({ ...sh, groundTeams: teams })),
  };
}

describe("the candidate carries the telescope reading", () => {
  it("a fresh save reads every candidate (all Tier I today) in range at Graded, matching readSystem on the risk preview", () => {
    const s = freshState();
    for (const c of expeditionCandidates(s, "ship-1")) {
      expect(c.telescope.blind).toBe(false);
      expect(c.telescope.regionTier).toBe(1);
      expect(c.telescope.detail).toBe(2);
      // SQ-6: the reading plus the task-based pieces, none of which Graded shows.
      expect(c.telescope).toEqual({
        ...readSystem(telescopeReading(s), c.seed, 0, expeditionRiskPreview(c.seed), stateHomeworld(s)),
        demand: null,
      });
    }
  });

  it("a blind candidate also hides the ship's own foreknowledge (blind means blind) [PROPOSAL, open call 7]", () => {
    const s = crewedState();
    const seen = expeditionCandidates(s, "ship-1");
    const blind = expeditionCandidates(atLevel(0, s), "ship-1");
    blind.forEach((c, i) => {
      expect(c.seed).toBe(seen[i].seed);
      expect(c.telescope.blind).toBe(true);
      expect(c.foreknowledge).toEqual({ inRange: false, bodyCount: null, bodies: null, relicSets: null });
    });
  });

  it("a run resolves IDENTICALLY at every telescope level (it only changes what is shown)", () => {
    // The display-only state (the telescope's level and, SQ-6, the blind launch counter) comes off first.
    const strip = (state: GameState): unknown => {
      const copy = structuredClone(state) as GameState;
      delete copy.facilities[SUBSPACE_TELESCOPE_FACILITY_KEY];
      delete copy.blindLaunches;
      return JSON.parse(JSON.stringify(copy));
    };
    // Safe first runs SF-2: the last checkpoint leaves room for the regular transit legs (the 30 minute shakedown is
    // retired), so the run still completes and is claimed.
    const CHECKPOINTS = [T0 + 10_000, T0 + 30_000, T0 + 60_000, T0 + 120_000, T0 + 400_000, T0 + 800_000];
    let reference: string[] | null = null;
    let claimed = 0;
    for (let level = 0; level <= 8; level++) {
      const s = atLevel(level, crewedState());
      const cand = expeditionCandidates(s, "ship-1")[0];
      expect(cand.telescope.blind).toBe(level === 0);
      const res = dispatchPastPropulsion(s, "ship-1", 1, cand.id);
      expect(res.success, `dispatch at level ${level}: ${res.reason}`).toBe(true);
      expect(blindLaunchCount(res.next), `blind launch counted at level ${level}`).toBe(level === 0 ? 1 : 0);
      const now: string[] = [JSON.stringify(strip(res.next))];
      let run = res.expedition!;
      for (const t of CHECKPOINTS) {
        let exp = advanceExpedition(run, t);
        if (groundOpsStuck(exp)) {
          let edited: GameState = { ...res.next, gameTimeSeconds: t, expeditions: [exp] };
          for (const id of groundOpsStuckTaskIds(exp)) edited = editGroundOps(edited, exp.id, { kind: "skip", taskId: id });
          exp = edited.expeditions[0];
        }
        run = exp;
        now.push(JSON.stringify(exp));
        if (exp.phase === "complete") {
          const withRun = { ...res.next, expeditions: res.next.expeditions.map((e) => (e.id === exp.id ? exp : e)) };
          const claim = claimExpedition(withRun, exp.id);
          expect(claim.success).toBe(true);
          now.push(JSON.stringify(strip(claim.next)));
          claimed += 1;
        }
      }
      if (reference === null) reference = now;
      else expect(now, `telescope level ${level}`).toEqual(reference);
    }
    expect(claimed, "the run completes and is claimed at every level").toBeGreaterThanOrEqual(9);
  });
});

// The ship's lift end to end (SQ-5 review Minor 2): a ship with sensors 40+ reads one detail higher, and the run it
// launches is the same at every telescope level. The lifted reading reaches Recommendation and Forecast, so this
// also proves SQ-6's previews (the task preview, the recommendation, the forecast's throwaway run) change nothing.
describe("the ship's lift changes only what is shown", () => {
  function withSensors(state: GameState, sensors: number): GameState {
    const piece: EquipmentInstance = {
      id: "equip-sensor-lift",
      slotType: "sensor",
      rarity: "standard",
      ascension: "none",
      quality: 0,
      iLevel: 1,
      blueprintKey: null,
      implicitStats: { sensors },
      rolledStats: {},
      mass: 0,
      powerDraw: 0,
      durabilityMax: 100,
      fittedToShipId: "ship-1",
      moduleVariant: "sensorBalanced",
    };
    return { ...state, equipment: [...state.equipment, piece] };
  }

  it("with sensors 40+ the run is identical at every level, lifted or not, Recommendation and Forecast included", () => {
    const strip = (state: GameState): unknown => {
      const copy = structuredClone(state) as GameState;
      delete copy.facilities[SUBSPACE_TELESCOPE_FACILITY_KEY];
      delete copy.blindLaunches;
      return JSON.parse(JSON.stringify(copy));
    };
    const CHECKPOINTS = [T0 + 30_000, T0 + 120_000, T0 + 400_000];
    let reference: string[] | null = null;
    const seen: number[] = [];
    for (const level of [0, 1, 3, 5, 7, 8]) {
      const s = atLevel(level, withSensors(crewedState(), TELESCOPE_SHIP_LIFT_SENSORS + 10));
      const cand = expeditionCandidates(s, "ship-1")[0];
      expect(cand.telescope.shipLift, `level ${level}`).toBe(level >= 1 && level < 7);
      seen.push(cand.telescope.detail);
      const view = expeditionLaunchView(s, "ship-1", cand); // what the expanded card asks for (SQ-6 follow-up 2)
      if (cand.telescope.detail >= TELESCOPE_DETAIL.recommendation) expect(view.recommendation).not.toBeNull();
      if (cand.telescope.detail >= TELESCOPE_DETAIL.forecast) expect(view.forecast).not.toBeNull();
      const res = dispatchPastPropulsion(s, "ship-1", 1, cand.id);
      expect(res.success, `dispatch at level ${level}: ${res.reason}`).toBe(true);
      const now: string[] = [JSON.stringify(strip(res.next))];
      for (const t of CHECKPOINTS) now.push(JSON.stringify(advanceExpedition(res.expedition!, t)));
      if (reference === null) reference = now;
      else expect(now, `telescope level ${level}`).toEqual(reference);
    }
    expect(seen).toEqual([0, 3, 4, 5, 5, 5]); // blind, then Graded + 1, Per body + 1, Recommendation + 1, Forecast
  });
});
