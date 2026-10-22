// Exploration 0.14.0 (Phase E4b) tests: the MUSEUM BONUSES go live.
//
// Covers, per MuseumStat, that a seeded museum moves its real consumer in the right direction by the right
// amount, plus the cross-cutting invariants:
//   - SHIP STATS via applyMuseumOverlay inside effectiveShipStats (cargo / transit / mining yield /
//     sensors / extraction speed), with the same-reference additive-neutral fast path;
//   - crewBonuses amplifying every crew contribution (shipCrewContribution);
//   - the extractionSpeed phase seam in effectiveMissionDef (fewer ticks, SAME haul per cycle);
//   - researchSpeed at START for blueprint research + relic study (ceil, >= 1);
//   - craftingQuality via rollQuality's DRAW-COUNT-INVARIANT near-miss promotion;
//   - salvageYield on recycle + hull teardown;
//   - rareMaterialChance on the extraction rare-tier chance (capped at 1, no new draws);
//   - the EXPEDITION snapshot (scanSpeed / relicFindChance / hazardResist stored at dispatch,
//     scienceTeamPower folded into scienceStrength), hazard never negative, relic chance capped;
//   - ADDITIVE-NEUTRAL: an empty museum is bit-identical on every path;
//   - PARITY: a museum that GROWS mid-span (a relic study completing during a long offline tick) ->
//     one big tick(span) == stepped economyTick(_, 1);
//   - the v63 -> v64 SAVE migration.

import { describe, it, expect } from "vitest";
import Decimal from "break_infinity.js";
import {
  freshState,
  shipDerivedStats,
  effectiveMissionDef,
  requiredTicksForPhase,
  rollQuality,
  QUALITY_STEP_CHANCE,
  MISSIONS,
  SHIP_TYPES,
  BLUEPRINTS,
  type GameState,
  type ShipInstance,
  type CrewBucket,
  type Expedition,
  type RelicVaultToken,
  type RelicSetId,
  type TimedProcess,
  type ShipDerivedStats,
  type CaptainState,
  generalMuseumRecord,
  withGeneralMuseumRecord,
} from "./model";
import {
  RELICS,
  RELIC_SETS,
  MUSEUM_STATS,
  MUSEUM_HAZARD_RESIST_MAX,
  museumBonuses,
  museumBonusesFromRecord,
  zeroMuseumBonuses,
  resistedHazard,
  effectiveHazardResist,
  relicStudyDurationTicks,
} from "./relics";
import {
  applyCrewOverlay,
  applyMuseumOverlay,
  effectiveShipStats,
  shipCrewContribution,
  scaleCrewContribution,
} from "./crewOverlay";
import { equippedFor } from "./equipment";
import {
  tick,
  economyTick,
  resolveProcesses,
  startResearch,
  startRelicStudy,
  relicStudiesInFlight,
  dispatchCaptainOnMission,
  tickCaptainMission,
  museumResearchDurationTicks,
} from "./tick";
import { salvageShip, salvageYieldMult } from "./salvage";
import { expeditionCandidates, advanceExpedition, resolveExpeditions } from "./expedition";
import { ensureMinimumAwayTeam, dispatchPastPropulsion } from "./awayTeamTestFixtures";
import { deriveAwayTeam, rollRelicToken } from "./gambit";
import { migrate, type SaveFile } from "./save";

// --- fixtures ----------------------------------------------------------------

// Every relic at `copies` copies: every set tier reaches the same level, so EVERY MuseumStat is non-zero.
function fullMuseum(copies: number): Record<string, number> {
  const out: Record<string, number> = {};
  for (const r of RELICS) out[r.id] = copies;
  return out;
}
const FULL = fullMuseum(160); // every tier at the max ladder level (5)

const withMuseum = (s: GameState, museum: Record<string, number>): GameState => withGeneralMuseumRecord(s, museum);
const ship1 = (s: GameState): ShipInstance => s.ships.find((sh) => sh.id === "ship-1")!;

function bucket(overrides: Partial<CrewBucket> & Pick<CrewBucket, "buff1Id">): CrewBucket {
  return { profession: "operations", rarity: "standard", rank: 1, race: "earthBorn", buff2Id: null, count: 1, ...overrides };
}

function withComplement(s: GameState, buckets: CrewBucket[]): GameState {
  return { ...s, ships: s.ships.map((sh) => (sh.id === "ship-1" ? { ...sh, complement: { buckets, mode: "passive" as const } } : sh)) };
}

function token(id: string, setId: RelicSetId, tier: RelicVaultToken["tier"] = "standard"): RelicVaultToken {
  const poiId = RELIC_SETS.find((st) => st.id === setId)!.sources[0];
  return { id, tier, quality: 0, setId, poiId };
}

// Jump an extraction captain straight into its EXTRACTING phase (every tick is then one extraction roll).
function toExtracting(c: CaptainState): CaptainState {
  const m = c.mission;
  if (!m || m.kind !== "extraction") throw new Error("expected an extraction mission");
  return { ...c, mission: { ...m, phase: "extracting", phaseProgressTicks: 0 } };
}

// A deterministic stream (identical sequences when re-created), so two runs draw the same numbers.
function seededRng(): () => number {
  let x = 0x12345678;
  return () => {
    x = (Math.imul(x ^ (x >>> 15), 0x2c1b3c6d) ^ 0x9e3779b9) >>> 0;
    return (x >>> 8) / (1 << 24);
  };
}

// ============================================================================
describe("museum fixture sanity: the FULL museum lights up every stat", () => {
  it("every MuseumStat is positive with every relic at 160 copies, and zero with an empty museum", () => {
    const b = museumBonusesFromRecord(FULL);
    for (const stat of MUSEUM_STATS) expect(b[stat]).toBeGreaterThan(0);
    expect(museumBonuses(freshState())).toEqual(zeroMuseumBonuses());
  });
});

// ============================================================================
describe("SHIP STATS: the museum overlay inside effectiveShipStats", () => {
  it("applyMuseumOverlay returns the SAME reference for an all-zero museum (additive-neutral)", () => {
    const base = shipDerivedStats(ship1(freshState()), []);
    expect(applyMuseumOverlay(base, zeroMuseumBonuses())).toBe(base);
    // Non-ship stats alone never trigger a clone either.
    const offShip = { ...zeroMuseumBonuses(), researchSpeed: 0.5, craftingQuality: 0.5, crewBonuses: 0.5 };
    expect(applyMuseumOverlay(base, offShip)).toBe(base);
  });

  it("scales cargo / transit / mining yield / sensors x (1 + b), and sets extractionSpeedMult only when non-zero", () => {
    const base: ShipDerivedStats = { ...shipDerivedStats(ship1(freshState()), []), sensors: 20 };
    const m = { ...zeroMuseumBonuses(), cargoCapacity: 0.1, transitSpeed: 0.2, miningYield: 0.3, sensors: 0.4 };
    const out = applyMuseumOverlay(base, m);
    expect(out.cargoCapacity).toBeCloseTo(base.cargoCapacity * 1.1, 12);
    expect(out.transitSpeedMult).toBeCloseTo(base.transitSpeedMult * 1.2, 12);
    expect(out.extractionYieldMult).toBeCloseTo(base.extractionYieldMult * 1.3, 12);
    expect(out.sensors).toBeCloseTo(20 * 1.4, 12);
    expect("extractionSpeedMult" in out).toBe(false); // extractionSpeed 0 -> the optional field is never added
    // Non-museum stats ride through untouched.
    expect(out.engineEfficiency).toBe(base.engineEfficiency);
    expect(out.fuelCapacity).toBe(base.fuelCapacity);
    const sped = applyMuseumOverlay(base, { ...zeroMuseumBonuses(), extractionSpeed: 0.25 });
    expect(sped.extractionSpeedMult).toBeCloseTo(1.25, 12);
  });

  it("effectiveShipStats: an empty museum equals the crew-overlay fold exactly; a seeded museum scales it", () => {
    const s = withComplement(freshState(), [bucket({ buff1Id: "ops.effectiveCargo", count: 100 })]);
    const ship = ship1(s);
    const crewOnly = applyCrewOverlay(shipDerivedStats(ship, equippedFor(s, ship.id)), shipCrewContribution(s, ship));
    expect(effectiveShipStats(s, ship)).toEqual(crewOnly);

    // Shipwright per-copy only (hullRivet alone: every tier stays locked) -> cargo +10% ON TOP of crew.
    const sm = withMuseum(s, { hullRivet: 100 });
    expect(museumBonuses(sm).cargoCapacity).toBeCloseTo(0.1, 12);
    expect(museumBonuses(sm).transitSpeed).toBe(0);
    const eff = effectiveShipStats(sm, ship);
    expect(eff.cargoCapacity).toBeCloseTo(crewOnly.cargoCapacity * 1.1, 9);
    expect(eff.transitSpeedMult).toBe(crewOnly.transitSpeedMult);
  });

  it("FULL museum: each ship stat moves by exactly (1 + its museum bonus) over the crew result", () => {
    const s = withMuseum(freshState(), FULL);
    const ship = ship1(s);
    const b = museumBonuses(s);
    const bare = shipDerivedStats(ship, equippedFor(s, ship.id));
    const eff = effectiveShipStats(s, ship);
    expect(eff.cargoCapacity).toBeCloseTo(bare.cargoCapacity * (1 + b.cargoCapacity), 9);
    expect(eff.transitSpeedMult).toBeCloseTo(bare.transitSpeedMult * (1 + b.transitSpeed), 12);
    expect(eff.extractionYieldMult).toBeCloseTo(bare.extractionYieldMult * (1 + b.miningYield), 12);
    expect(eff.extractionSpeedMult).toBeCloseTo(1 + b.extractionSpeed, 12);
    // A bare hull has 0 sensors: the museum AMPLIFIES fitted sensors, it never invents them.
    expect(eff.sensors).toBe(0);
  });
});

// ============================================================================
describe("crewBonuses: every crew contribution grows by (1 + b)", () => {
  it("scaleCrewContribution is a same-reference no-op at 0 and a uniform multiply otherwise", () => {
    const crew = { "crew.effectiveCargo": 0.1, "crew.unloadSpeed": 0.2 };
    expect(scaleCrewContribution(crew, 0)).toBe(crew);
    const scaled = scaleCrewContribution(crew, 0.5);
    expect(scaled["crew.effectiveCargo"]).toBeCloseTo(0.15, 12);
    expect(scaled["crew.unloadSpeed"]).toBeCloseTo(0.3, 12);
    expect(crew["crew.effectiveCargo"]).toBe(0.1); // input untouched
  });

  it("shipCrewContribution under the FULL museum == the empty-museum map x (1 + crewBonuses)", () => {
    const s = withComplement(freshState(), [bucket({ buff1Id: "ops.effectiveCargo", count: 100 })]);
    const plain = shipCrewContribution(s, ship1(s));
    const sm = withMuseum(s, FULL);
    const amped = shipCrewContribution(sm, ship1(sm));
    const cb = museumBonuses(sm).crewBonuses;
    expect(cb).toBeGreaterThan(0);
    expect(Object.keys(amped).sort()).toEqual(Object.keys(plain).sort());
    for (const k of Object.keys(plain)) expect(amped[k]).toBeCloseTo(plain[k] * (1 + cb), 12);
  });
});

// ============================================================================
describe("extractionSpeed: a shorter extracting PHASE that hauls the same cycle", () => {
  const def = MISSIONS.shortOreRun;
  const bare = shipDerivedStats(ship1(freshState()), []);

  it("no multiplier: the def carries no override and the phase length is unchanged", () => {
    const eff = effectiveMissionDef(def, bare);
    expect("extractionTicksOverride" in eff).toBe(false);
    expect(eff.extractionRatePerTick).toBe(def.extractionRatePerTick);
    expect(requiredTicksForPhase("extracting", eff)).toBe(Math.ceil(bare.cargoCapacity / def.extractionRatePerTick));
  });

  it("x1.5 speed: ticks = ceil(base / 1.5), rate rises so ticks * rate == the un-sped haul", () => {
    const eff = effectiveMissionDef(def, { ...bare, extractionSpeedMult: 1.5 });
    const baseTicks = Math.ceil(bare.cargoCapacity / def.extractionRatePerTick);
    expect(requiredTicksForPhase("extracting", eff)).toBe(Math.ceil(baseTicks / 1.5));
    expect(requiredTicksForPhase("extracting", eff) * eff.extractionRatePerTick).toBeCloseTo(baseTicks * def.extractionRatePerTick, 9);
    // Every other phase is untouched (this seam only shortens extracting).
    const plain = effectiveMissionDef(def, bare);
    for (const p of ["ordersReceived", "transitOut", "transitBack", "unloading"] as const) {
      expect(requiredTicksForPhase(p, eff)).toBe(requiredTicksForPhase(p, plain));
    }
  });

  it("a multiplier too small to shave a whole tick leaves the def byte-identical (no stealth yield)", () => {
    const eff = effectiveMissionDef(def, { ...bare, extractionSpeedMult: 1.001 });
    expect(eff).toEqual(effectiveMissionDef(def, bare));
  });

  it("FULL museum via effectiveShipStats: the extracting phase is shorter by the museum ratio", () => {
    const s = withMuseum(freshState(), FULL);
    const stats = effectiveShipStats(s, ship1(s));
    const eff = effectiveMissionDef(def, stats);
    const baseTicks = Math.ceil(stats.cargoCapacity / def.extractionRatePerTick);
    expect(requiredTicksForPhase("extracting", eff)).toBe(Math.ceil(baseTicks / (1 + museumBonuses(s).extractionSpeed)));
    expect(requiredTicksForPhase("extracting", eff)).toBeLessThan(baseTicks);
  });
});

// ============================================================================
describe("researchSpeed: research + relic study durations at START", () => {
  it("museumResearchDurationTicks: ceil(base / (1 + b)), >= 1, and the base unchanged at b = 0", () => {
    expect(museumResearchDurationTicks(60, 0)).toBe(60);
    expect(museumResearchDurationTicks(60, -1)).toBe(60);
    expect(museumResearchDurationTicks(60, Number.NaN)).toBe(60);
    expect(museumResearchDurationTicks(60, 0.1)).toBe(Math.ceil(60 / 1.1)); // 55
    expect(museumResearchDurationTicks(1, 100)).toBe(1); // never a 0-tick job
    expect(museumResearchDurationTicks(0, 0.5)).toBe(0); // scales a duration, never invents one
  });

  it("blueprint research starts shorter with a museum, unchanged without", () => {
    const s = { ...freshState(), credits: new Decimal(1_000_000) };
    const base = startResearch(s, "frameSegmentBp");
    expect(base.started).toBe(true);
    const baseProc = base.next.activeProcesses.find((p) => p.kind === "researchProject")!;
    expect(baseProc.durationTicks).toBe(BLUEPRINTS.frameSegmentBp.researchDurationTicks);

    const sm = withMuseum(s, { glyphTablet: 100 }); // Precursor per-copy researchSpeed 0.1
    expect(museumBonuses(sm).researchSpeed).toBeCloseTo(0.1, 12);
    const fast = startResearch(sm, "frameSegmentBp");
    const fastProc = fast.next.activeProcesses.find((p) => p.kind === "researchProject")!;
    expect(fastProc.durationTicks).toBe(Math.ceil(BLUEPRINTS.frameSegmentBp.researchDurationTicks / 1.1));
    expect(fastProc.remainingTicks).toBe(fastProc.durationTicks);
  });

  it("relic study starts shorter with a museum, unchanged without; an in-flight study is never re-timed", () => {
    const s = { ...freshState(), relicVault: [token("t1", "deepEarth", "stellar")] };
    const plain = relicStudiesInFlight(startRelicStudy(s, "t1").next)[0];
    expect(plain.durationTicks).toBe(relicStudyDurationTicks("stellar"));
    const sm = withMuseum(s, { glyphTablet: 100 });
    const started = startRelicStudy(sm, "t1").next;
    const fast = relicStudiesInFlight(started)[0];
    expect(fast.durationTicks).toBe(Math.ceil(relicStudyDurationTicks("stellar") / 1.1));
    // Growing the museum AFTER start leaves the stored countdown alone (start-time only).
    const grown = withMuseum(started, FULL);
    const stepped = resolveProcesses(grown, 1, () => 0).next;
    expect(relicStudiesInFlight(stepped)[0].remainingTicks).toBe(fast.remainingTicks - 1);
  });
});

// ============================================================================
describe("craftingQuality: rollQuality is DRAW-COUNT INVARIANT", () => {
  // A scripted rng that also counts its draws.
  function scripted(values: number[]): { rng: () => number; draws: () => number } {
    let i = 0;
    return { rng: () => values[i++ % values.length], draws: () => i };
  }

  it("bonus 0 is bit-identical to the no-arg roll over many seeded streams", () => {
    for (let k = 0; k < 200; k++) {
      const a = seededRng();
      const b = seededRng();
      for (let j = 0; j < k; j++) {
        a();
        b();
      }
      expect(rollQuality(a, 0)).toBe(rollQuality(b));
      expect(a()).toBe(b()); // and the streams stay aligned
    }
  });

  it("a near miss promotes one tier off the SAME failing draw, with no extra draw", () => {
    const c0 = QUALITY_STEP_CHANCE[0];
    // r == chance fails the base step (strict <) but falls inside the boosted window [c, c * 1.5).
    const base = scripted([c0]);
    expect(rollQuality(base.rng)).toBe(0);
    expect(base.draws()).toBe(1);
    const boosted = scripted([c0]);
    expect(rollQuality(boosted.rng, 0.5)).toBe(1);
    expect(boosted.draws()).toBe(1); // the promotion consumed NOTHING extra
    // Outside the window: no promotion.
    const far = scripted([c0 * 1.6]);
    expect(rollQuality(far.rng, 0.5)).toBe(0);
    // A real climb then a near miss: tier 1 + promotion -> 2, still exactly 2 draws.
    const climb = scripted([0, QUALITY_STEP_CHANCE[1]]);
    expect(rollQuality(climb.rng, 0.5)).toBe(2);
    expect(climb.draws()).toBe(2);
  });

  it("over many random streams: identical draw counts, and the boosted tier is base or base + 1", () => {
    for (let k = 0; k < 500; k++) {
      // Low-heavy values so climbs and near misses both happen.
      const vals = Array.from({ length: 8 }, (_, j) => ((k * 7919 + j * 104729) % 1000) / 1_000_000);
      const a = scripted(vals);
      const b = scripted(vals);
      const tBase = rollQuality(a.rng);
      const tBoost = rollQuality(b.rng, 0.4);
      expect(b.draws()).toBe(a.draws());
      expect(tBoost === tBase || tBoost === tBase + 1).toBe(true);
    }
  });

  it("resolveProcesses: a museum-boosted refine completion consumes the same number of draws", () => {
    const proc: TimedProcess = {
      id: "proc-test",
      kind: "refineJob",
      remainingTicks: 1,
      durationTicks: 1,
      effect: { type: "addItem", itemId: "titaniumIngot", amount: new Decimal(1) },
    };
    const run = (museum: Record<string, number>): number => {
      const s = withMuseum({ ...freshState(), activeProcesses: [proc] }, museum);
      const c = scripted([QUALITY_STEP_CHANCE[0]]); // a near miss on the first draw
      resolveProcesses(s, 1, c.rng);
      return c.draws();
    };
    expect(run(FULL)).toBe(run({}));
    // And the boosted completion really landed one tier higher.
    const boostedState = resolveProcesses(
      withMuseum({ ...freshState(), activeProcesses: [proc] }, FULL),
      1,
      scripted([QUALITY_STEP_CHANCE[0]]).rng
    ).next;
    expect(boostedState.inventory.titaniumIngot?.[1]?.gt(0)).toBe(true);
  });
});

// ============================================================================
describe("salvageYield: recycle + hull teardown fractions scale x (1 + b)", () => {
  it("salvageYieldMult is exactly 1 with an empty museum", () => {
    expect(salvageYieldMult(freshState())).toBe(1);
    expect(salvageYieldMult(withMuseum(freshState(), FULL))).toBeCloseTo(1 + museumBonuses(withMuseum(freshState(), FULL)).salvageYield, 12);
  });

  it("a hull teardown refunds more credits under the museum, the same draw count", () => {
    const base = freshState();
    const spare: ShipInstance = { ...base.ships[0], id: "ship-2", assignedCaptainId: null, complement: undefined };
    const s = { ...base, ships: [...base.ships, spare] };
    let drawsA = 0;
    let drawsB = 0;
    const plain = salvageShip(s, "ship-2", () => (drawsA++, 0.5));
    const sm = withMuseum(s, FULL);
    const amped = salvageShip(sm, "ship-2", () => (drawsB++, 0.5));
    expect(plain.ok && amped.ok).toBe(true);
    expect(drawsA).toBe(1);
    expect(drawsB).toBe(1);
    if (!plain.ok || !amped.ok) return;
    const recipe = SHIP_TYPES[spare.typeKey].buildRecipe;
    expect(plain.creditsRecovered).toBe(Math.floor(recipe.credits * 0.35));
    expect(amped.creditsRecovered).toBe(Math.floor(recipe.credits * 0.35 * salvageYieldMult(sm)));
    expect(amped.creditsRecovered).toBeGreaterThan(plain.creditsRecovered);
  });
});

// ============================================================================
describe("rareMaterialChance: the extraction rare-tier chance, capped, no new draws", () => {
  // A captain already in the EXTRACTING phase of shortOreRun, so every tick is one extraction roll.
  function extractingCaptain() {
    const d = dispatchCaptainOnMission(freshState(), 1, "shortOreRun");
    expect(d.success).toBe(true);
    return toExtracting(d.next.captains.find((c) => c.id === 1)!);
  }

  it("a draw in [rareChance, rareChance * (1 + b)) hits rare ONLY with the museum bonus", () => {
    const cap = extractingCaptain();
    const r = MISSIONS.shortOreRun.rareChance * 1.25; // misses base rare, inside a +50% window
    const plain = tickCaptainMission(1, cap, () => r, {});
    const amped = tickCaptainMission(1, cap, () => r, { museumRareChanceMult: 0.5 });
    const pm = plain.captain.mission!;
    const am = amped.captain.mission!;
    if (pm.kind !== "extraction" || am.kind !== "extraction") throw new Error("expected extraction");
    expect(pm.cargo.rareMaterial.toNumber()).toBe(0);
    expect(am.cargo.rareMaterial.toNumber()).toBeGreaterThan(0);
  });

  it("the chance is capped at 1 (a huge bonus = always rare), and the draw count per tick is unchanged", () => {
    const cap = extractingCaptain();
    let drawsA = 0;
    let drawsB = 0;
    // r = 0.9: misses both base rare and uncommon (2 draws) and the bonus-roll trigger (1 draw).
    const base = tickCaptainMission(1, cap, () => (drawsA++, 0.9), {});
    const capped = tickCaptainMission(1, cap, () => (drawsB++, 0.9), { museumRareChanceMult: 1e9 });
    const cm = capped.captain.mission!;
    if (cm.kind !== "extraction") throw new Error("expected extraction");
    expect(cm.cargo.rareMaterial.toNumber()).toBe(MISSIONS.shortOreRun.extractionRatePerTick);
    expect(Number.isFinite(cm.cargo.rareMaterial.toNumber())).toBe(true);
    // A rare hit stops the primary roll at 1 draw (vs 2 on a full miss) by the EXISTING early-return
    // rule; the museum adds no draw of its own. Base: 2 primary + 1 trigger; capped: 1 primary + 1 trigger.
    expect(drawsA).toBe(3);
    expect(drawsB).toBe(2);
    expect(base.captain.mission).toBeDefined();
  });

  it("economyTick threads the museum's rareMaterialChance into the live extraction roll", () => {
    // Deep Earth 2-piece tier at level 1: rareMaterialChance 0.005 (plus a per-copy miningYield that only
    // scales AMOUNTS, never the odds). A constant draw just above the base rare chance hits rare ONLY here.
    const d = dispatchCaptainOnMission(freshState(), 1, "shortOreRun").next;
    const extracting = {
      ...d,
      captains: d.captains.map((c) => (c.id === 1 ? toExtracting(c) : c)),
    };
    const sm = withMuseum(extracting, { geodeCore: 10, magmaPearl: 10 });
    expect(museumBonuses(sm).rareMaterialChance).toBeCloseTo(0.005, 12);
    const r = MISSIONS.shortOreRun.rareChance * 1.002;
    const rare = (st: GameState): number => {
      const m = st.captains.find((c) => c.id === 1)!.mission!;
      if (m.kind !== "extraction") throw new Error("expected extraction");
      return m.cargo.rareMaterial.toNumber();
    };
    expect(rare(economyTick(extracting, 1, () => r))).toBe(0);
    expect(rare(economyTick(sm, 1, () => r))).toBeGreaterThan(0);
  });

  it("economyTick with an empty museum is identical to the pre-E4b odds (0 -> identical runs)", () => {
    const d = dispatchCaptainOnMission(freshState(), 1, "shortOreRun").next;
    const a = economyTick(d, 1, seededRng());
    const b = economyTick(withMuseum(d, {}), 1, seededRng());
    expect(a.captains).toEqual(b.captains);
  });
});

// ============================================================================
describe("EXPEDITION: museum bonuses snapshotted at dispatch", () => {
  // D18: the ship gets the minimum away team first (the gate itself is tested in expedition.test.ts).
  const dispatch = (base: GameState) => {
    const s = ensureMinimumAwayTeam(base);
    const cand = expeditionCandidates(s, "ship-1")[0];
    return dispatchPastPropulsion(s, "ship-1", 1, cand.id);
  };
  const scienceShip = (s: GameState) => withComplement(s, [bucket({ profession: "science", buff1Id: "ops.unloadSpeed", count: 20 })]);

  it("an empty museum snapshots all-zero bonuses and the un-scaled science strength", () => {
    const s = scienceShip(freshState());
    const exp = dispatch(s).expedition!;
    expect(exp.scanSpeedBonus).toBe(0);
    expect(exp.relicFindBonus).toBe(0);
    expect(exp.hazardResist).toBe(0);
    expect(exp.scienceStrength).toBe(deriveAwayTeam(s, ship1(s)).scienceStrength);
    expect(exp.scienceStrength).toBeGreaterThan(0);
  });

  it("the FULL museum snapshots scanSpeed / relicFindChance / hazardResist and scales scienceStrength", () => {
    const s = scienceShip(freshState());
    const sm = withMuseum(s, FULL);
    const b = museumBonuses(sm);
    const exp = dispatch(sm).expedition!;
    expect(exp.scanSpeedBonus).toBe(b.scanSpeed);
    expect(exp.relicFindBonus).toBe(b.relicFindChance);
    expect(exp.hazardResist).toBe(b.hazardResist);
    const plainScience = deriveAwayTeam(s, ship1(s)).scienceStrength;
    expect(exp.scienceStrength).toBeCloseTo(plainScience * (1 + b.scienceTeamPower), 9);
    // Security is untouched (scienceTeamPower is Science-only).
    expect(exp.securityStrength).toBe(deriveAwayTeam(s, ship1(s)).securityStrength);
  });

  it("resolution reads ONLY the stored snapshot: a museum that grows mid-flight changes nothing", () => {
    const launched = dispatch(freshState()).next;
    const later = { ...launched, gameTimeSeconds: launched.gameTimeSeconds + 40_000 };
    const a = resolveExpeditions(later);
    const b = resolveExpeditions(withMuseum(later, FULL));
    expect(b.expeditions).toEqual(a.expeditions);
  });

  // A hand-built single-body scanning expedition (phaseAnchorSeconds 0, so now == elapsed in phase).
  function scanningExp(over: Partial<Expedition>): Expedition {
    const launched = dispatch(freshState()).expedition!;
    return {
      ...launched,
      phase: "scanning",
      phaseAnchorSeconds: 0,
      bodies: [
        { id: "body-1", planetType: "toxic", scanTotal: 200, scanProgress: 0, hazard: 1, scanned: false, discoveries: [], activities: [] },
      ],
      ...over,
    };
  }

  it("scanSpeed scans faster by (1 + b); hazardResist scans a hazardous body faster", () => {
    const plain = advanceExpedition(scanningExp({}), 100).bodies[0].scanProgress;
    const faster = advanceExpedition(scanningExp({ scanSpeedBonus: 0.5 }), 100).bodies[0].scanProgress;
    expect(faster).toBeCloseTo(plain * 1.5, 9);
    const resisted = advanceExpedition(scanningExp({ hazardResist: 0.5 }), 100).bodies[0].scanProgress;
    expect(resisted).toBeGreaterThan(plain);
    // Zeros are bit-identical to the pre-E4b expedition shape.
    expect(advanceExpedition(scanningExp({ scanSpeedBonus: 0, hazardResist: 0 }), 100)).toEqual(advanceExpedition(scanningExp({}), 100));
  });

  it("the hazard resist curve keeps offline == live parity: one big advance equals 997 s chunks (GO-5)", () => {
    for (const hazardResist of [0.3, 2]) {
      const start = scanningExp({ hazardResist });
      const big = advanceExpedition(start, 20000);
      let chunked = start;
      for (let t = 997; t < 20000; t += 997) chunked = advanceExpedition(chunked, t);
      chunked = advanceExpedition(chunked, 20000);
      expect(chunked).toEqual(big);
    }
    // Past the old clamp (0.75) more resist still scans faster: the curve keeps rising.
    const at1 = advanceExpedition(scanningExp({ hazardResist: 1 }), 100).bodies[0].scanProgress;
    const at2 = advanceExpedition(scanningExp({ hazardResist: 2 }), 100).bodies[0].scanProgress;
    expect(at2).toBeGreaterThan(at1);
  });

  it("resistedHazard: unchanged at 0, approaches MUSEUM_HAZARD_RESIST_MAX without reaching it, never negative", () => {
    expect(resistedHazard(0.8, 0)).toBe(0.8);
    // GO-5 (user hazard ruling 2026-10-12): the resist passes MAX * tanh(raw / MAX) instead of a clamp, so a
    // 0.2 resist cuts 0.1954 (was exactly 0.2) and no resist ever reaches the 0.75 ceiling.
    expect(resistedHazard(1, 0.2)).toBeCloseTo(1 - 0.75 * Math.tanh(0.2 / 0.75), 12);
    expect(resistedHazard(1, 0.2)).toBeCloseTo(0.8046, 4);
    expect(resistedHazard(1, 1e6)).toBeGreaterThan(1 - MUSEUM_HAZARD_RESIST_MAX);
    expect(resistedHazard(1, 1e6)).toBeCloseTo(1 - MUSEUM_HAZARD_RESIST_MAX, 12);
    expect(resistedHazard(1, Infinity)).toBeGreaterThan(1 - MUSEUM_HAZARD_RESIST_MAX);
    expect(resistedHazard(0, 1e6)).toBe(0);
    for (const h of [0, 0.3, 1, 5]) for (const r of [0, 0.1, 0.75, 2, 1e9]) expect(resistedHazard(h, r)).toBeGreaterThanOrEqual(0);
  });

  it("effectiveHazardResist: the before / after table, ~linear when small, rising, never at the ceiling (GO-5)", () => {
    // raw -> effective (the old clamp read min(raw, 0.75)).
    const table: [number, number][] = [
      [0.1, 0.0994],
      [0.3, 0.285],
      [0.5, 0.4371],
      [0.75, 0.5712],
      [1.5, 0.723],
    ];
    for (const [raw, eff] of table) expect(effectiveHazardResist(raw), `raw ${raw}`).toBeCloseTo(eff, 4);
    // Small resists barely change (a 0.05 resist keeps over 99.5% of its value).
    expect(effectiveHazardResist(0.05) / 0.05).toBeGreaterThan(0.995);
    // Strictly rising, always under the ceiling, even where tanh rounds to 1 in floating point.
    let prev = 0;
    for (const raw of [0.01, 0.1, 0.5, 1, 2, 5, 10]) {
      const eff = effectiveHazardResist(raw);
      expect(eff).toBeGreaterThan(prev);
      expect(eff).toBeLessThan(MUSEUM_HAZARD_RESIST_MAX);
      prev = eff;
    }
    for (const raw of [20, 1e6, Infinity]) expect(effectiveHazardResist(raw)).toBeLessThan(MUSEUM_HAZARD_RESIST_MAX);
    for (const raw of [0, -1, NaN]) expect(effectiveHazardResist(raw)).toBe(0);
  });

  it("relicFindChance raises the token chance (capped at certain) without changing the draw order", () => {
    const poi = RELIC_SETS[0].sources[0];
    let hitsBase = 0;
    let hitsBoost = 0;
    for (let seed = 1; seed <= 2000; seed++) {
      const a = rollRelicToken(seed, 0, poi, "r");
      const b = rollRelicToken(seed, 0, poi, "r", 0.5);
      if (a) {
        hitsBase++;
        expect(b).toEqual(a); // a base hit stays a hit with the SAME tier (same draws after the chance)
      }
      if (b) hitsBoost++;
    }
    expect(hitsBoost).toBeGreaterThan(hitsBase);
    // Capped: an absurd bonus is a certain drop, never an error.
    for (let seed = 1; seed <= 50; seed++) expect(rollRelicToken(seed, 0, poi, "r", 1e9)).not.toBeNull();
    // Zero bonus is bit-identical to the 4-arg call.
    for (let seed = 1; seed <= 200; seed++) expect(rollRelicToken(seed, 0.5, poi, "r", 0)).toEqual(rollRelicToken(seed, 0.5, poi, "r"));
  });
});

// ============================================================================
describe("ADDITIVE-NEUTRAL: an empty museum is byte-identical everywhere", () => {
  it("a museum of zero-count entries reads as empty, and the tick is identical to an empty museum", () => {
    const d = dispatchCaptainOnMission(freshState(), 1, "shortOreRun").next;
    const zeroEntries = withMuseum(d, { hullRivet: 0, geodeCore: 0 });
    expect(museumBonuses(zeroEntries)).toEqual(zeroMuseumBonuses());
    const a = tick(500, withMuseum(d, {}), seededRng());
    const b = tick(500, zeroEntries, seededRng());
    expect(withMuseum(b, {})).toEqual(withMuseum(a, {}));
  });

  it("an empty museum leaves research / study durations, expedition snapshots and crew maps untouched", () => {
    const s = { ...freshState(), credits: new Decimal(1_000_000), relicVault: [token("t1", "precursor")] };
    expect(startResearch(s, "frameSegmentBp").next.activeProcesses.at(-1)!.durationTicks).toBe(BLUEPRINTS.frameSegmentBp.researchDurationTicks);
    expect(relicStudiesInFlight(startRelicStudy(s, "t1").next)[0].durationTicks).toBe(relicStudyDurationTicks("standard"));
    const c = withComplement(s, [bucket({ buff1Id: "ops.effectiveCargo", count: 10 })]);
    const contrib = shipCrewContribution(c, ship1(c));
    expect(scaleCrewContribution(contrib, museumBonuses(c).crewBonuses)).toBe(contrib);
  });
});

// ============================================================================
describe("PARITY: a museum that GROWS mid-span stays offline == live", () => {
  // A captain mining shortOreRun under a well-stocked museum, plus a Shipwright relic study that completes
  // MID-SPAN (adding one copy: +cargo per copy). One big tick(span) must equal the same span stepped one
  // economyTick(_, 1) at a time on every museum-affected output.
  function setup(): GameState {
    const museum = fullMuseum(39); // every tier at level 2, one copy short of the 40 rung
    let s = withMuseum({ ...freshState(), relicVault: [token("t1", "shipwright")] }, museum);
    const study = startRelicStudy(s, "t1");
    expect(study.started).toBe(true);
    s = study.next;
    const d = dispatchCaptainOnMission(s, 1, "shortOreRun");
    expect(d.success).toBe(true);
    return d.next;
  }

  it("one big tick(span) == stepped economyTick(_, 1) with the study completing mid-span", () => {
    const base = setup();
    const studyTicks = relicStudiesInFlight(base)[0].remainingTicks;
    const SPAN = studyTicks + 1500;
    const big = tick(SPAN, base, seededRng());
    let small = base;
    const rng = seededRng();
    for (let i = 0; i < SPAN; i++) small = economyTick(small, 1, rng);

    const snap = (st: GameState) => ({
      relicMuseum: generalMuseumRecord(st),
      captains: st.captains,
      inventory: st.inventory,
      credits: st.credits.toString(),
      lifetimeStats: st.lifetimeStats,
      activeProcesses: st.activeProcesses,
      gameTimeSeconds: st.gameTimeSeconds,
    });
    expect(snap(big)).toEqual(snap(small));

    // Non-vacuous: the museum really grew mid-span, the ship stats really moved, and cycles completed.
    const copies = (st: GameState) => Object.values(generalMuseumRecord(st)).reduce((a, b) => a + b, 0);
    expect(copies(big)).toBe(copies(base) + 1);
    expect(effectiveShipStats(big, ship1(big))).not.toEqual(effectiveShipStats(base, ship1(base)));
    expect(Object.values(big.lifetimeStats.missionsCompleted).some((v) => new Decimal(v).gt(0))).toBe(true);
  });
});

// ============================================================================
describe("SAVE migration v63 -> v64 backfills the expedition museum snapshot", () => {
  it("backfills 0 onto an in-flight expedition, and an expedition-free save is a no-op", () => {
    const s = dispatch63();
    const migrated: any = migrate({ version: 63, created_at: 0, last_saved_at: 0, game_time_seconds: 0, state: s } as SaveFile);
    expect(migrated.expeditions).toHaveLength(1);
    expect(migrated.expeditions[0].scanSpeedBonus).toBe(0);
    expect(migrated.expeditions[0].relicFindBonus).toBe(0);
    expect(migrated.expeditions[0].hazardResist).toBe(0);
    const empty: any = migrate({ version: 63, created_at: 0, last_saved_at: 0, game_time_seconds: 0, state: freshState() } as SaveFile);
    expect(empty.expeditions).toEqual([]);
  });

  it("is idempotent: existing snapshot values survive", () => {
    const s: any = dispatch63();
    s.expeditions[0] = { ...s.expeditions[0], scanSpeedBonus: 0.3, relicFindBonus: 0.2, hazardResist: 0.1 };
    const migrated: any = migrate({ version: 63, created_at: 0, last_saved_at: 0, game_time_seconds: 0, state: s } as SaveFile);
    expect(migrated.expeditions[0].scanSpeedBonus).toBe(0.3);
    expect(migrated.expeditions[0].relicFindBonus).toBe(0.2);
    expect(migrated.expeditions[0].hazardResist).toBe(0.1);
  });

  // A v63-shaped state with one in-flight expedition lacking the three E4b fields.
  function dispatch63(): any {
    const s = ensureMinimumAwayTeam(freshState());
    const exp: any = { ...dispatchPastPropulsion(s, "ship-1", 1, expeditionCandidates(s, "ship-1")[0].id).expedition! };
    delete exp.scanSpeedBonus;
    delete exp.relicFindBonus;
    delete exp.hazardResist;
    return { ...s, expeditions: [exp] };
  }
});
