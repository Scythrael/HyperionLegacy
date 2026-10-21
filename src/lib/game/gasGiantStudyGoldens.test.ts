// Gas Giant Study GG-0 (docs/plans/2026-10-17-gas-giant-study-plan.md section 4 GG-0): golden hashes captured on
// the code BEFORE any gas giant study engine edit (on top of a678241). Every later slice (GG-1 to GG-8) keeps these
// green in the same commit, or re-pins one ONLY where the slice names the move and why. Whole serialized records,
// never a narrow subset:
//
//   1. giant  : a Ground Ops run on a seed whose system holds a gas giant (freshState's candidate 2: toxic + gas
//               giant): the candidate (foreknowledge, telescope reading at Level 8), the system task preview, the
//               launch view (demand, recommendation, forecast), the scan step draws and ship scan events per body,
//               the dispatch record, the phase timeline, the finished run, the claim and its deposits.
//   2. risk   : the same seed's bodyRiskGrades per body (expeditionRiskPreview), and each equals its dispatched body.
//   3. plain  : the same captures for a run with NO gas giant (candidate 0: volcanic + barren). It must stay
//               byte-identical through every GG slice (an orbital-only change cannot reach a system without one).
//   4. lab    : startResearch durations for five blueprints, with and without a museum research-speed bonus (GG-5
//               adds the data boost on top of this seam; with no banked boost the numbers must not move).
//   5. census : the item census (ids and counts by category), the refine recipe ids and the blueprint count. GG-1
//               adds items and a recipe, so this is the one golden GG-1 moves: they are held apart and pinned on
//               their own (explained at the pin).
// Plus offline == live parity on both runs: one call == 997 s chunks == 1 s steps over the 600 s around arrival.
//
// Merged with feat/crew-0.14.0 adb41c6 after the capture: G2-2 renamed the candidates (`cand-<slot>` became
// `cand-1-<slot>`), named systems after real stars and stamped a region on each run, and R2-1 moved the museum into
// the Museum v2 record. The captures read through the same pre-G2 helpers the G2-0 regular rows use
// (asPreG2Candidate, asPreG2NamesDispatch, withV1Museum), so every pin above is still the a678241 capture. Gear wear
// steps 1 and 2 (merged later) retired the stored durability: hashes go through goldenJson, which puts it back.

import { describe, expect, it } from "vitest";
import Decimal from "break_infinity.js";
import {
  BLUEPRINTS,
  FIELD_KITS_HIDDEN_BLUEPRINTS,
  ITEMS,
  REFINE_RECIPES,
  RESEARCH_FACILITY_KEY,
  SUBSPACE_TELESCOPE_FACILITY_KEY,
  freshState,
  museumV2WithGeneral,
  type AwayMember,
  type Expedition,
  type GameState,
  type ShipGroundTeam,
} from "./model";
import {
  ENCOUNTER_STEPS,
  advanceExpedition,
  claimExpedition,
  expeditionCandidates,
  expeditionLaunchView,
  expeditionRiskPreview,
  scanStepRoll,
  startExpedition,
  systemTaskPreview,
} from "./expedition";
import { resolveShipScanEvent } from "./shipScanEvents";
import { startResearch } from "./tick";
import { gasStudyItemIds } from "./gasGiantContent";
import { GG1_RECIPE } from "./gasStudyGoldens.fixture";
import { asPreG2Candidate, asPreG2NamesDispatch, asPreRanksDispatch, plainAwayMember, withoutG2NamesState } from "./awayTeamTestFixtures";
import { goldenJson, withV1Museum } from "./firstRunsGoldens.fixture";

// ===== shared helpers =====

function fnv(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16);
}

// Gear wear (merged after the capture) retired the stored durability; goldenJson puts it back, as the G2-0 rows do.
const hash = (v: unknown): string => fnv(goldenJson(v));

const T0 = 100_000;
const FINAL = T0 + 2_000_000;
const SEC = ["member-1", "member-2", "member-3", "member-4", "member-5", "member-6"];
const SCI = ["member-11", "member-12", "member-13", "member-14", "member-15", "member-16"];

// ship-1 with two Ground teams of six rank 10 members (3 Security + 3 Science each), the clock at T0, the telescope
// at Level 8 (the launch view's forecast shows). freshState's expedition seed, so the candidates are a new save's own.
function crewed(): GameState {
  const base = freshState();
  const m = (id: string, t: AwayMember["teamType"]): AwayMember => ({ ...plainAwayMember(id, t, "ship-1"), rank: 10 as AwayMember["rank"] });
  const teams: ShipGroundTeam[] = [
    { kind: "ground", security: SEC.slice(0, 3), science: SCI.slice(0, 3), helpOthers: false },
    { kind: "ground", security: SEC.slice(3), science: SCI.slice(3), helpOthers: false },
  ];
  return {
    ...base,
    gameTimeSeconds: T0,
    nextExpeditionId: 2,
    facilities: { ...base.facilities, [SUBSPACE_TELESCOPE_FACILITY_KEY]: { level: 8 } },
    awayMembers: [...SEC.map((id) => m(id, "security")), ...SCI.map((id) => m(id, "science"))],
    nextAwayMemberId: 100,
    ships: base.ships.map((sh) => ({ ...sh, groundTeams: teams })),
  };
}

// Advance in `step` second chunks from `from` to `to` (inclusive of `to`).
function chunked(exp: Expedition, from: number, to: number, step: number): Expedition {
  let e = exp;
  for (let t = from + step; t < to; t += step) e = advanceExpedition(e, t);
  return advanceExpedition(e, to);
}

// The run's phase timeline: [phase, anchor] for every phase it enters (101 s chunks to completion).
function timeline(exp: Expedition): [string, number][] {
  const out: [string, number][] = [[exp.phase, exp.phaseAnchorSeconds]];
  let e = exp;
  for (let t = exp.phaseAnchorSeconds + 101; e.phase !== "complete" && t < FINAL; t += 101) {
    e = advanceExpedition(e, t);
    if (out[out.length - 1][0] !== e.phase) out.push([e.phase, e.phaseAnchorSeconds]);
  }
  expect(out.map(([p]) => p)).toEqual(["transit", "scanning", "activities", "return", "complete"]);
  return out;
}

// Every capture of one candidate's run, in a fixed order: [candidate, task preview, launch view, scan draws per
// body..., dispatch record, timeline, finished run, scan events, findings, claim, deposits].
function captureRun(candidateId: string): { out: string[]; exp: Expedition; planetTypes: string[] } {
  const state = crewed();
  const cand = expeditionCandidates(state, "ship-1").find((c) => c.id === candidateId)!;
  expect(cand, candidateId).toBeDefined();
  // Field Kits FKR-1: dispatched with the enemy ranks flag off (asPreRanksDispatch), as the G2-0 regular rows are, so
  // the unequipped rank 10 squads close the window inside a day of game time; ranked runs are groundOpsRanks.test.ts's.
  const res = asPreG2NamesDispatch(asPreRanksDispatch(startExpedition(state, "ship-1", 1, candidateId)));
  if (!res.success || !res.expedition) throw new Error(`dispatch refused: ${res.reason}`);
  const exp = res.expedition;
  expect(exp.groundOps).toBeDefined();
  const preview = systemTaskPreview(cand.seed, exp.scanParams);
  const view = expeditionLaunchView(state, "ship-1", cand);
  expect(view.demand).not.toBeNull();
  // The scan step draws (encounter, supply cache) and the ship scan event at every boundary of every body.
  const draws = exp.bodies.map((body, i) =>
    hash(Array.from({ length: ENCOUNTER_STEPS }, (_, step) => [scanStepRoll(exp, i, step), resolveShipScanEvent(exp, body, i, step, 0)])),
  );
  const tl = timeline(exp);
  const done = advanceExpedition(exp, FINAL);
  const claim = claimExpedition({ ...res.next, expeditions: [done] }, done.id);
  expect(claim.success).toBe(true);
  const deposits = { inventory: claim.next.inventory, credits: claim.next.credits.toString(), relicVault: claim.next.relicVault ?? null };
  const out = [
    hash(asPreG2Candidate(cand)),
    hash(preview),
    hash(view),
    ...draws,
    hash(exp),
    hash(tl),
    hash(done),
    hash(done.scanEvents ?? null),
    hash(done.findings),
    hash(withV1Museum(withoutG2NamesState(claim.next))),
    hash(deposits),
  ];
  return { out, exp, planetTypes: exp.bodies.map((b) => b.planetType) };
}

// one call == 997 s chunks == 1 s steps over the 600 s around arrival. `exp` untouched.
function expectParity(exp: Expedition): void {
  const frozen = structuredClone(exp);
  const tl = timeline(exp);
  const end = tl[tl.length - 1][1] + 1;
  const one = advanceExpedition(exp, end);
  expect(chunked(exp, T0, end, 997)).toEqual(one);
  const arrival = tl[1][1];
  const from = Math.floor(arrival) - 300;
  expect(chunked(advanceExpedition(exp, from), from, from + 600, 1)).toEqual(advanceExpedition(exp, from + 600));
  expect(exp).toEqual(frozen);
}

// ===== the goldens =====

// Layouts: giant / plain = [candidate, task preview, launch view, scan draws body 0, scan draws body 1, dispatch
// record, timeline, finished run, scan events, findings, claim, deposits]; risk = [profile, body 0, body 1].
// Cross-check: the dispatch records and timelines are the G2-0 regular rows' own (expeditionTiersGoldens.test.ts
// fresh:regular:cand-0 ffa69009 / 5a7a918b and cand-2 93b332c5 / f23b02ce), and the gas giant launch view is G2-0
// display:launch's (b956de0c), so the two captures agree on the shared code path.
const GOLDEN: Record<string, readonly string[]> = {
  giant: ["f5ddbd0a", "e375bf74", "b956de0c", "4ac8a0a7", "44d0a224", "93b332c5", "f23b02ce", "e8b83c3e", "d95c0baf", "a6f5bf49", "9a143f7", "661f503f"],
  plain: ["82735f", "61454ce6", "a44bfe48", "81d9393c", "394ef6cb", "ffa69009", "5a7a918b", "52c3393d", "2dc0e5cf", "5d234ce9", "8b1199fc", "174e7996"],
  risk: ["6b5a19c0", "9c9d2b43", "31ca5738"],
};

// The research project's ticks for five blueprints (one per tier and family the lab offers), then the same with a
// museum research-speed bonus (a hundred copies of each Precursor relic: the set's per-copy stat, its tiers and its
// capstone all read research speed).
const LAB_BLUEPRINTS = ["atmoProbeBp", "decryptorBp", "coreDrillBp", "firstAidKitBp", "dermalWeaveBp"] as const;
const PRECURSOR_MUSEUM: Readonly<Record<string, number>> = {
  glyphTablet: 100,
  resonanceShard: 100,
  starChartFragment: 100,
  precursorLens: 100,
  heartOfTheArchive: 100,
};
const LAB_GOLDEN: Record<"plain" | "museum", readonly number[]> = {
  plain: [120, 120, 60, 60, 160],
  museum: [77, 77, 39, 39, 103],
};

// The census at GG-0 (a678241) was items 125548b0, refined 5, the first four recipes, 78 blueprints. Re-pinned at the
// merge of feat/crew-0.14.0 adb41c6 (before any GG-1 item): Material Lines ML-1 added seven refined items and the
// seven recipes after refinePurifiedBiomass (ferrite, reclaimed circuit, iridium catalyst; cobalt coil, osmium plate,
// photonic gel, biocatalyst). Nothing else moved: the other categories and the blueprint count are GG-0's.
const CENSUS_GOLDEN = {
  items: "4f57ddc8",
  byCategory: { fieldKit: 6, majorComponent: 1, minorComponent: 3, raw: 14, refined: 12, salvagedMaterial: 2 } as Record<string, number>,
  refineRecipes: [
    "refineCommonOre",
    "refinePolysilicateWafer",
    "refineReclaimedAlloy",
    "refinePurifiedBiomass",
    "refineFerriteIngot",
    "refineReclaimedCircuit",
    "refineIridiumCatalyst",
    "synthCobaltCoil",
    "synthOsmiumPlate",
    "synthPhotonicGel",
    "synthBiocatalyst",
  ],
  blueprints: 78,
};

// What GG-1 added (held apart above, so the merge pin keeps proving nothing else moved): fifteen items in ITEMS order
// at the end of the table (six Gas Storage Canisters, eight research data items, the Ancient Data Fragment; two new
// categories) and one Refinery recipe at the end of REFINE_RECIPES (Deuterium Ice into a Deuterium Canister).
const GG1_CENSUS = {
  items: [
    "hydrogenCanister",
    "methaneCanister",
    "ammoniaCanister",
    "deuteriumCanister",
    "helium3Canister",
    "antimatterCell",
    "propulsionData",
    "defenseData",
    "weaponsData",
    "systemsData",
    "fieldData",
    "hullDesignData",
    "materialsData",
    "sensorsData",
    "ancientDataFragment",
  ],
  byCategory: { gasCanister: 6, researchData: 9 } as Record<string, number>,
  refineRecipes: ["refineDeuteriumCanister"],
};

describe("GG-0 golden 1: a Ground Ops run on a system with a gas giant", () => {
  it("candidate 2: candidate, task preview, launch view, scan draws, dispatch, timeline, run, claim and deposits", () => {
    const { out, planetTypes } = captureRun("cand-1-2");
    expect(planetTypes).toContain("gasGiant");
    expect(out).toEqual(GOLDEN.giant);
  });

  it("candidate 2: one call == 997 s chunks == 1 s steps", () => {
    expectParity(captureRun("cand-1-2").exp);
  });
});

describe("GG-0 golden 2: the gas giant seed's risk grades per body", () => {
  it("expeditionRiskPreview per body, each equal to the dispatched body's grades", () => {
    const { exp } = captureRun("cand-1-2");
    const preview = expeditionRiskPreview(exp.seed);
    expect(preview.bodies.length).toBe(exp.bodies.length);
    preview.bodies.forEach((grades, i) => expect(exp.bodies[i].risk).toEqual(grades));
    expect([hash(preview.profile), ...preview.bodies.map((b) => hash(b))]).toEqual(GOLDEN.risk);
  });
});

describe("GG-0 golden 3: a run with no gas giant (byte-identical through every GG slice)", () => {
  it("candidate 0: candidate, task preview, launch view, scan draws, dispatch, timeline, run, claim and deposits", () => {
    const { out, planetTypes } = captureRun("cand-1-0");
    expect(planetTypes).not.toContain("gasGiant");
    expect(out).toEqual(GOLDEN.plain);
  });

  it("candidate 0: one call == 997 s chunks == 1 s steps", () => {
    expectParity(captureRun("cand-1-0").exp);
  });
});

describe("GG-0 golden 4: startResearch durations, with and without the museum", () => {
  const ticks = (museum: boolean): number[] =>
    LAB_BLUEPRINTS.map((key) => {
      const base = freshState();
      const ready: GameState = {
        ...base,
        facilities: { ...base.facilities, [RESEARCH_FACILITY_KEY]: { level: 9 } },
        credits: new Decimal(1e12),
        // Relics v2 R2-1 (merged after GG-0): the v1 copy record now lives in the Museum v2 record's Tier I general
        // copies (where the v69 -> v70 step moves every v1 copy), so the same hundred copies go there.
        museumV2: museum ? museumV2WithGeneral(base.museumV2, PRECURSOR_MUSEUM) : base.museumV2,
      };
      const r = startResearch(ready, key);
      expect(r.started, key).toBe(true);
      return r.next.activeProcesses[r.next.activeProcesses.length - 1].remainingTicks;
    });

  it("five blueprints at a top Lab: the project's ticks", () => {
    for (const key of LAB_BLUEPRINTS) expect(BLUEPRINTS[key], key).toBeDefined();
    expect(ticks(false)).toEqual(LAB_GOLDEN.plain);
  });

  it("the same five with a museum research-speed bonus: every one shorter", () => {
    const plain = ticks(false);
    const museum = ticks(true);
    museum.forEach((t, i) => expect(t).toBeLessThan(plain[i]));
    expect(museum).toEqual(LAB_GOLDEN.museum);
  });
});

describe("GG-0 golden 5: the item census", () => {
  const gg1 = new Set(gasStudyItemIds());
  const census = (ids: string[], recipes: string[]) => {
    const byCategory: Record<string, number> = {};
    for (const id of ids) byCategory[ITEMS[id].category] = (byCategory[ITEMS[id].category] ?? 0) + 1;
    return { ids, byCategory, refineRecipes: recipes };
  };

  it("item ids, counts by category, refine recipes and blueprint count (GG-1's additions held apart)", () => {
    const before = census(Object.keys(ITEMS).filter((id) => !gg1.has(id)), Object.keys(REFINE_RECIPES).filter((k) => k !== GG1_RECIPE));
    expect({ items: hash(before.ids), byCategory: before.byCategory, refineRecipes: before.refineRecipes, blueprints: Object.keys(BLUEPRINTS).filter((k) => !(k in FIELD_KITS_HIDDEN_BLUEPRINTS)).length }).toEqual(CENSUS_GOLDEN);
    // Field Kits FKR-9 / FKR-10 (the switch-on): the hidden Impact Grenade blueprint merges in, the one named move of the
    // blueprint count (78 to 79), counted apart as in materialLinesGoldens.test.ts.
    for (const k of Object.keys(FIELD_KITS_HIDDEN_BLUEPRINTS)) expect(BLUEPRINTS[k], k).toBe(FIELD_KITS_HIDDEN_BLUEPRINTS[k]);
  });

  it("GG-1's additions: fifteen items appended in order and the one recipe appended", () => {
    const keys = Object.keys(ITEMS);
    expect(keys.slice(keys.length - GG1_CENSUS.items.length)).toEqual(GG1_CENSUS.items);
    const recipes = Object.keys(REFINE_RECIPES);
    expect(recipes.slice(recipes.length - 1)).toEqual(GG1_CENSUS.refineRecipes);
    const added = census(GG1_CENSUS.items, GG1_CENSUS.refineRecipes);
    expect({ items: added.ids, byCategory: added.byCategory, refineRecipes: added.refineRecipes }).toEqual(GG1_CENSUS);
  });
});
