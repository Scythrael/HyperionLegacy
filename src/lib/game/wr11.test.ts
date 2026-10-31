// Wiring WR-11 (docs/plans/2026-10-15-wiring-registry-and-audit-plan.md section 4 WR-11, with its OC-G / OC-H / OC-I /
// OC-J user answers): the expedition, relic, mission and salvage leftovers, each proven where it acts. The goldens live
// in wr11Goldens.test.ts; this file proves each rule and its determinism.

import Decimal from "break_infinity.js";
import { describe, expect, it } from "vitest";
import {
  FACTIONS,
  ITEMS,
  MISSIONS,
  PATROLS,
  SALVAGE_DROP_SELL_VALUE,
  missionDefWithoutShip,
  type Expedition,
} from "./model";
import {
  OCEAN_SURFACE_WORK_MULT,
  POI_CATALOG,
  POI_MATERIAL_MULT,
  POI_RELIC_ODDS_MULT,
  groundSiteFlavor,
  poiMaterialMult,
  poiRelicOddsMult,
  surfaceWorkMult,
} from "./expeditionContent";
import { relicChancePermille, rollHaul, rollRelicToken } from "./gambit";
import { taskWorkSeconds } from "./groundTasks";
import { memberFieldworkScale } from "./fieldwork";
import { ANOMALY_CHANCE_PERMILLE, advanceExpedition, anomalyChartPermille, chartedAnomalyFinding, claimExpedition, expeditionCandidates } from "./expedition";
import { SALVAGE_LOOT_POOLS } from "./model";
import { salvageOverflowTiers, salvageTierReach } from "./salvage";
import { STATUS_EFFECT_DEFS } from "./combat/statusEffects";
import { affixCount } from "./itemgen";
import { sellItem } from "./quartermaster";
import { buildHomeDashboard } from "./homeDashboard";
import { MUSEUM_STAT_LABEL } from "../ui/relicIcons";
import { HELP_TOPICS } from "../helpTopics";
import { wr11Dispatch, wr11Run, wr11SalvageRun, wr11SalvageState, wr11State } from "./wr11.fixture";
import { WR11_DELETED_CARGO, withWr11Off } from "./wr11Switch.fixture";

describe("WR-11 OC-G4: each site gives what its flavor names, on a run stamped with the site rules", () => {
  it("Buried Vault and Subterranean Civilization raise the relic chance; every other site leaves it", () => {
    expect(poiRelicOddsMult({ siteRules: 1 }, "buriedVault")).toBe(POI_RELIC_ODDS_MULT.buriedVault);
    expect(poiRelicOddsMult({ siteRules: 1 }, "subterraneanCivilization")).toBe(POI_RELIC_ODDS_MULT.subterraneanCivilization);
    for (const p of POI_CATALOG.filter((x) => x.relicOddsMult === undefined)) expect(poiRelicOddsMult({ siteRules: 1 }, p.id)).toBe(1);
    // An unstamped run (in flight at the update) keeps every site at x1.
    expect(poiRelicOddsMult({}, "buriedVault")).toBe(1);
    expect(relicChancePermille(0, 0, poiRelicOddsMult({ siteRules: 1 }, "buriedVault"))).toBe(Math.round(relicChancePermille(0, 0) * 1.5));
  });

  it("the relic roll at a vault hits where the plain roll misses (the same single draw)", () => {
    // A seed whose chance draw lands between the plain and the vault threshold.
    let found = -1;
    for (let seed = 1; seed < 5000 && found < 0; seed += 1) {
      if (!rollRelicToken(seed, 0, "buriedVault", "r") && rollRelicToken(seed, 0, "buriedVault", "r", 0, undefined, undefined, 1.5)) found = seed;
    }
    expect(found).toBeGreaterThan(0);
    // Every seed that hits without the factor also hits with it (the factor only raises the threshold).
    for (let seed = 1; seed < 500; seed += 1) {
      if (rollRelicToken(seed, 0, "buriedVault", "r")) expect(rollRelicToken(seed, 0, "buriedVault", "r", 0, undefined, undefined, 1.5)).not.toBeNull();
    }
  });

  it("Bloom, Geothermal, Outpost and Crashed Ship haul more materials, credits unchanged", () => {
    for (const id of ["xenoFloraBloom", "geothermalChamber", "derelictOutpost", "crashedShip"]) expect(poiMaterialMult({ siteRules: 1 }, id)).toBe(POI_MATERIAL_MULT);
    for (const id of ["ancientRuins", "mineralOutcrop", "caveNetwork", "buriedVault", "subterraneanCivilization"]) expect(poiMaterialMult({ siteRules: 1 }, id)).toBe(1);
    const plain = rollHaul(77, "terrestrial", 0.3, 10);
    const more = rollHaul(77, "terrestrial", 0.3, 10, POI_MATERIAL_MULT);
    expect(Object.keys(more.materials)).toEqual(Object.keys(plain.materials));
    expect(Object.values(more.materials)[0]).toBeGreaterThan(Object.values(plain.materials)[0]);
    expect(more.credits).toBe(plain.credits);
  });

  it("every site's flavor is the line the objective card and queue row render, and claims only what is real", () => {
    for (const p of POI_CATALOG) {
      expect(groundSiteFlavor(p.id)).toBe(p.flavor);
      expect(p.flavor).not.toMatch(/\+|--|—/);
      if (/relic odds/.test(p.flavor)) expect(p.relicOddsMult).toBeGreaterThan(1);
      if (/extra (materials|salvage|supplies|exotic)/.test(p.flavor)) expect(p.materialMult).toBeGreaterThan(1);
    }
  });
});

describe("WR-11 OC-G6: Ocean surface work is slower (the other two planet comments are dropped)", () => {
  const run = { roster: undefined, scienceStrength: 0, hazardResist: 0 };
  it("a surface objective on an Ocean world takes x1.25 on a stamped run; underground work and other worlds do not", () => {
    const base = taskWorkSeconds(run, [], { planetType: "ocean", hazard: 0 }, "crashedShip");
    expect(taskWorkSeconds({ ...run, siteRules: 1 }, [], { planetType: "ocean", hazard: 0 }, "crashedShip")).toBe(Math.round(base * OCEAN_SURFACE_WORK_MULT));
    expect(taskWorkSeconds({ ...run, siteRules: 1 }, [], { planetType: "ocean", hazard: 0 }, "caveNetwork")).toBe(base);
    expect(taskWorkSeconds({ ...run, siteRules: 1 }, [], { planetType: "terrestrial", hazard: 0 }, "crashedShip")).toBe(base);
    expect(surfaceWorkMult({}, "ocean", "crashedShip")).toBe(1);
  });
});

describe("WR-11 OC-G3: the anomaly chart reads the sensors and pays a small haul", () => {
  it("the chance rises with the frozen sensors on a curve toward certain, never reaching it", () => {
    const at = (sensorPower: number) => anomalyChartPermille({ siteRules: 1, sensorPower });
    expect(at(0)).toBe(ANOMALY_CHANCE_PERMILLE);
    expect(at(20)).toBe(566);
    expect(at(40)).toBe(675);
    let prev = at(0);
    for (const s of [5, 10, 40, 100, 1000, 1e6]) {
      expect(at(s)).toBeGreaterThan(prev - 1);
      expect(at(s)).toBeLessThan(1000);
      prev = at(s);
    }
    // An older run keeps the flat chance whatever its sensors.
    expect(anomalyChartPermille({ sensorPower: 80 })).toBe(ANOMALY_CHANCE_PERMILLE);
  });

  it("a charted anomaly's finding carries materials and credits, deposited at claim; an older run's carries none", () => {
    const found = chartedAnomalyFinding({ id: "x", siteRules: 1 }, () => 99);
    expect(found.credits).toBeGreaterThan(0);
    expect(Object.values(found.materials ?? {}).reduce((a, b) => a + b, 0)).toBeGreaterThan(0);
    expect(chartedAnomalyFinding({ id: "x" }, () => 99)).toEqual({ id: "x-find-anomaly", source: "anomaly" });
    // A real run that charts one (0x8b8b) brings the haul home.
    const { done, claimed } = wr11Run(0x8b8b);
    const f = done.findings.find((x) => x.source === "anomaly")!;
    expect(f.credits).toBeGreaterThan(0);
    const off = withWr11Off(() => wr11Run(0x8b8b));
    expect(Number(claimed.credits) - Number(off.claimed.credits)).toBeGreaterThanOrEqual(f.credits!);
  });
});

describe("WR-11 OC-H1: the Museum's Science team power also scales the named Science members' fieldwork", () => {
  it("a dispatch freezes the power, and each member's own fieldwork is x (1 + it)", () => {
    const { exp } = wr11Dispatch(0x1234, "museum");
    expect(exp.museumSciencePower).toBeGreaterThan(0);
    expect(memberFieldworkScale(exp)).toBe(1 + exp.museumSciencePower!);
    expect(wr11Dispatch(0x1234).exp.museumSciencePower).toBeUndefined();
    expect(memberFieldworkScale({})).toBe(1);
  });
});

describe("WR-11 OC-H2: the Museum's salvage yield says where it acts", () => {
  it("the stat names recycling and hull teardown", () => {
    expect(MUSEUM_STAT_LABEL.salvageYield).toBe("salvage yield (recycling and hull teardown)");
  });
});

describe("WR-11 OC-G5 and the no-call deletions", () => {
  it("the frozen ship-event profile no longer carries evasion or shieldCapacity", () => {
    const profile = wr11Dispatch(0x1234).exp.groundOps!.shipEventProfile as unknown as Record<string, unknown>;
    expect("evasion" in profile).toBe(false);
    expect("shieldCapacity" in profile).toBe(false);
    expect(profile.battle).toBeDefined();
  });
  it("no status def carries a color; no candidate's foreknowledge carries relicSignature", () => {
    for (const def of Object.values(STATUS_EFFECT_DEFS)) expect("color" in def).toBe(false);
    for (const c of expeditionCandidates(wr11State(0x1234), "ship-1")) expect("relicSignature" in c.foreknowledge).toBe(false);
  });
});

describe("WR-11 OC-I1 and OC-I2", () => {
  it("no mission carries a cargoCapacity of its own; a def read without a ship takes the reference hold", () => {
    for (const def of Object.values(MISSIONS)) expect("cargoCapacity" in def).toBe(false);
    expect(missionDefWithoutShip(MISSIONS.shortOreRun).cargoCapacity).toBe(90);
    // Each mission keeps the hold it carried before the deletion as its no-ship preview hold.
    for (const [key, def] of Object.entries(MISSIONS)) expect(missionDefWithoutShip(def).cargoCapacity).toBe(WR11_DELETED_CARGO[key]);
  });
  it("the three unused factions stay out of every patrol and every Help line until the user names their content", () => {
    const used = new Set(Object.values(PATROLS).map((p) => p.factionId));
    const help = JSON.stringify(HELP_TOPICS);
    for (const id of ["voidJackals", "ironVultures", "ashenCorsairs"]) {
      expect(used.has(id)).toBe(false);
      expect(help).not.toContain(FACTIONS[id].name);
    }
  });
});

describe("WR-11 OC-J1: the talent's reach past the top tier tilts the loot odds upward", () => {
  const pool = SALVAGE_LOOT_POOLS.damagedWeaponSystem;
  it("only the talent's share counts, and only on a stamped job", () => {
    const at = (fa: number, talent: boolean, stamped = true) => salvageTierReach({ ...wr11SalvageState(talent), fleetAdminLevel: fa }, pool.length, 0, stamped);
    expect(at(10, true)).toEqual({ ceiling: 3, overflow: 0 }); // the talent's tier lands inside the pool
    expect(at(15, true)).toEqual({ ceiling: 3, overflow: 1 }); // B16: it used to be wasted from FA 15
    expect(at(40, true)).toEqual({ ceiling: 3, overflow: 1 });
    expect(at(40, false)).toEqual({ ceiling: 3, overflow: 0 }); // RR-7's reserved fifth-tier row tilts nothing
    expect(at(15, true, false)).toEqual({ ceiling: 3, overflow: 0 }); // an unstamped job rolls as before
  });
  it("the tilt raises every higher tier's share on a diminishing curve and leaves the bottom tier's weight", () => {
    const one = salvageOverflowTiers(pool, 1);
    const two = salvageOverflowTiers(pool, 2);
    expect(one[0].weight).toBe(pool[0].weight);
    const share = (t: readonly { weight: number }[]) => t[t.length - 1].weight / t.reduce((a, x) => a + x.weight, 0);
    expect(share(one)).toBeGreaterThan(share(pool));
    expect(share(two)).toBeGreaterThan(share(one));
    expect(two[3].weight / one[3].weight).toBeLessThan(one[3].weight / pool[3].weight); // diminishing, never a cap
  });
  it("forty salvages with the talent climb the tiers; one call of the string is deterministic", () => {
    const quality = (s: ReturnType<typeof wr11SalvageRun>) =>
      Object.values(s.inventory).reduce((a, buckets) => a + buckets.reduce((b, q, i) => b + i * Number(q), 0), 0);
    expect(quality(wr11SalvageRun(true))).toBeGreaterThan(quality(withWr11Off(() => wr11SalvageRun(true))));
    expect(JSON.stringify(wr11SalvageRun(true))).toBe(JSON.stringify(wr11SalvageRun(true)));
  });
});

describe("WR-11 OC-J2: the completed-events log narrates the drop's loot tier", () => {
  it("each material salvage entry carries its tier, and the Home board row names it", () => {
    const s = wr11SalvageRun(false);
    const last = s.completionLog[s.completionLog.length - 1];
    expect(last.salvageRoll).toBeDefined();
    const row = buildHomeDashboard(s).recentlyCompleted.find((r) => r.id === last.id)!;
    const tier = last.salvageRoll!.tier;
    expect(row.secondaryLabel).toBe(`${tier.charAt(0).toUpperCase()}${tier.slice(1)} quality`);
    // A job started before WR-11 logs no tier (its row reads as before).
    const old = withWr11Off(() => wr11SalvageRun(false));
    expect(old.completionLog[old.completionLog.length - 1].salvageRoll).toBeUndefined();
  });
});

describe("WR-11 OC-J3 and OC-J4", () => {
  it("Salvaged Circuitry and Precursor Circuit sell at the Quartermaster", () => {
    for (const id of ["salvagedCircuitry", "precursorCircuit"] as const) {
      expect(ITEMS[id].sellValue).toBe(SALVAGE_DROP_SELL_VALUE[id]);
      const s = { ...wr11State(1), inventory: { ...wr11State(1).inventory, [id]: [new Decimal(2)] } };
      const r = sellItem(s, id, new Decimal(1));
      expect(r.ok).toBe(true);
      if (r.ok) expect(Number(r.next.credits) - Number(s.credits)).toBe(SALVAGE_DROP_SELL_VALUE[id]);
    }
  });
  it("the unreachable bands keep finite affix counts (safety rows)", () => {
    for (const band of ["derelict", "luminous", "constellar"] as const) {
      const n = affixCount(band, () => 0.5);
      expect(Number.isInteger(n)).toBe(true);
      expect(n).toBeGreaterThanOrEqual(0);
    }
  });
});

describe("WR-11 determinism: one call == chunked == 1 s steps, and an old run replays unchanged", () => {
  const stepped = (exp: Expedition, end: number, step: number): Expedition => {
    let e = exp;
    for (let t = exp.phaseAnchorSeconds + step; t < end; t += step) e = advanceExpedition(e, t);
    return advanceExpedition(e, end);
  };
  it("a stamped run with a charted anomaly, Ocean surface work and vault relics resolves the same however it is advanced", () => {
    for (const seed of [0x8b8b, 0x1234]) {
      const { exp } = wr11Dispatch(seed);
      const end = exp.phaseAnchorSeconds + 2_000_000;
      const one = JSON.stringify(advanceExpedition(exp, end));
      expect(JSON.stringify(stepped(exp, end, 3_600))).toBe(one);
      // 1 s steps over the first two hours (transit and the anomaly check), then one call to the end.
      const early = stepped(exp, exp.phaseAnchorSeconds + 7_200, 1);
      expect(JSON.stringify(advanceExpedition(early, end))).toBe(one);
    }
  });
  it("a run dispatched before WR-11 (no stamps) replays byte-identically under the new code", () => {
    const old = withWr11Off(() => wr11Dispatch(0xbebe));
    const end = old.exp.phaseAnchorSeconds + 2_000_000;
    const before = withWr11Off(() => JSON.stringify(advanceExpedition(old.exp, end)));
    expect(JSON.stringify(advanceExpedition(old.exp, end))).toBe(before);
    const claim = claimExpedition({ ...old.next, expeditions: [advanceExpedition(old.exp, end)] }, old.exp.id);
    expect(claim.success).toBe(true);
  });
});
