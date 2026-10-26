// ML-2 (0.14.0, Material Lines recipe rework + the recipe realism audit; plans
// docs/plans/2026-10-17-material-lines-and-emod-plan.md section 4 "ML-2" and docs/plans/2026-10-21-recipe-realism-audit.md
// USER ANSWERS Groups A to D): GOLDENS FIRST, captured on feat/crew-0.14.0 at 624b0c5 before any ML-2 data edit (the
// CP-0 / ML-0 / RX-0 pattern). What ML-2 may move, and what it must not:
//   recipes  : the whole recipe table (every blueprint's inputs and output, every Refinery recipe, every hull build).
//   fabricate: one craft of every blueprint ML-2 reworks, stocked with exactly its inputs, through completion.
//   inspect  : the piece each reworked equipment blank rolls (a crafted piece's roll never reads its recipe).
//   salvage  : what one salvage of each reworked equipment piece gives back at fixed band draws (salvage refunds the
//              piece's blueprint recipe as it stands).
// TEST-ONLY (imported by *.test.ts files only): ml2RecipeGoldens.test.ts pins the capture; materialLinesMl2.test.ts reads
// it back after the rework.

import Decimal from "break_infinity.js";
import { BLUEPRINTS, REFINE_RECIPES, SHIP_TYPES, freshState, resetRefineConsumerCacheForTest, type GameState } from "./model";
import { economyTick, inspectBlank, startLine } from "./tick";
import { salvageEquipment } from "./salvage";
import { hash, stateHash } from "./firstRunsGoldens.fixture";
import { holding, withFacilityLevel } from "./wiring/probes";
import { EM7_BLUEPRINT_KEYS } from "./emodEm7.fixture";

// Every blueprint ML-2 reworks (plan ML-2 + audit Groups B and C), in BLUEPRINTS order.
export const ML2_REWORKED: readonly string[] = [
  "powerCouplingBp",
  "prospectorHoldBp",
  "haulerHoldBp",
  "sprintDriveBp",
  "economyDriveBp",
  "highOutputCoreBp",
  "efficientCoreBp",
  "surveyRigBp",
  "refineryFeedRigBp",
  "rechargeArrayBp",
  "reinforcedPlatingBp",
  "ablativePlatingBp",
  "compositePlatingBp",
  "ballisticWeaveBp",
  "fieldSuitBp",
  "hazardSuitBp",
  "toxinGrenadeBp",
  "medKitBp",
  "atmoProbeBp",
  "archaeoScannerBp",
];

const BANDS = [0, 0.15, 0.5, 0.95];

function lcg(seed: number): { rng: () => number; draws: () => number } {
  let s = seed >>> 0;
  let n = 0;
  return {
    rng: () => {
      n += 1;
      s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
      return s / 4294967296;
    },
    draws: () => n,
  };
}

// The recipe table, row by row (hashes; the literal rows ML-2 changes live in its own test's PRE_ML2_RECIPES).
export function recipeTable(): string[] {
  return [
    ...Object.entries(BLUEPRINTS).map(([k, bp]) => `bp:${k}:${hash(bp.recipe)}`),
    ...Object.entries(REFINE_RECIPES).map(([k, r]) => `refine:${k}:${hash({ input: Object.fromEntries(Object.entries(r.input).map(([i, n]) => [i, n.toString()])), output: r.output.itemId, n: r.output.amount.toString(), ticks: r.durationTicks })}`),
    ...Object.entries(SHIP_TYPES).map(([k, h]) => `hull:${k}:${hash(h.buildRecipe)}`),
  ];
}

// A Fabricator at the blueprint's tier, the blueprint researched, holding exactly one craft's inputs.
export function stockedFor(bp: string): GameState {
  const def = BLUEPRINTS[bp];
  let s: GameState = { ...withFacilityLevel(freshState(), "fabricator", Math.max(1, def.tier)), researchedBlueprints: [bp] };
  for (const [item, qty] of Object.entries(def.recipe.inputs)) s = holding(s, item, new Decimal(qty));
  return s;
}

// One craft of `bp` through completion: the state hash and the shared-stream draw count.
export function fabricated(bp: string): string {
  const r = startLine(stockedFor(bp), "fabricate", bp, { kind: "batch", remaining: 1 });
  if (!r.started) return `refused:${r.reason}`;
  const stream = lcg(0x2b1);
  let s = r.next;
  for (let i = 0; i < BLUEPRINTS[bp].craftDurationTicks + 4; i++) s = economyTick(s, 1, stream.rng);
  return `${stateHash(s)}:${stream.draws()}`;
}

export const isEquipment = (bp: string): boolean => BLUEPRINTS[bp].equipmentOutput !== undefined;

export function inspected(bp: string): GameState {
  return inspectBlank({ ...freshState(), blanks: { [bp]: new Decimal(1) } }, bp);
}

export function salvageRows(): [string, (Record<string, number> | string)[]][] {
  return ML2_REWORKED.filter(isEquipment).map((k) => {
    const s = inspected(k);
    const id = s.equipment.at(-1)!.id;
    return [k, BANDS.map((band) => {
      const r = salvageEquipment(s, id, () => band);
      return r.ok ? r.recovered : r.reason;
    })];
  });
}

// Captured on feat/crew-0.14.0 at 624b0c5, before the ML-2 data edits.
export const ML2_GOLDEN = {
  // The recipe table with the reworked blueprint rows left out (81 rows: every other blueprint, every Refinery recipe,
  // every hull build), as one hash; then each reworked row's own hash.
  recipesUntouched: "c71e7155",
  recipesReworked: [
    ["powerCouplingBp","a714542d"],
    ["prospectorHoldBp","ac49571b"],
    ["haulerHoldBp","975e6727"],
    ["sprintDriveBp","1c2a6368"],
    ["economyDriveBp","c40bb387"],
    ["highOutputCoreBp","55655292"],
    ["efficientCoreBp","597e6b14"],
    ["surveyRigBp","8b227e57"],
    ["refineryFeedRigBp","a6fd5ca7"],
    ["rechargeArrayBp","1c2a6368"],
    ["reinforcedPlatingBp","41a311b0"],
    ["ablativePlatingBp","5ed4e3ec"],
    ["compositePlatingBp","d7be71c3"],
    ["ballisticWeaveBp","b38caa61"],
    ["fieldSuitBp","5ac5336b"],
    ["hazardSuitBp","3a94ca63"],
    ["toxinGrenadeBp","2935224e"],
    ["medKitBp","e741b7de"],
    ["atmoProbeBp","fd5fea77"],
    ["archaeoScannerBp","e267f9f6"],
  ],
  fabricate: [
    ["powerCouplingBp","b25c46a7:1"],
    ["prospectorHoldBp","6615c374:0"],
    ["haulerHoldBp","dc70159e:0"],
    ["sprintDriveBp","9fde4b83:0"],
    ["economyDriveBp","1d811b90:0"],
    ["highOutputCoreBp","9b520d6f:0"],
    ["efficientCoreBp","e187aa0:0"],
    ["surveyRigBp","eb870c98:0"],
    ["refineryFeedRigBp","e2495c1b:0"],
    ["rechargeArrayBp","9690f322:0"],
    ["reinforcedPlatingBp","a1158e18:0"],
    ["ablativePlatingBp","150edd84:0"],
    ["compositePlatingBp","4102e6a2:0"],
    ["ballisticWeaveBp","bdc36fb2:0"],
    ["fieldSuitBp","28c07734:0"],
    ["hazardSuitBp","4eb19096:0"],
    ["toxinGrenadeBp","8ed60a6d:0"],
    ["medKitBp","89485dad:0"],
    ["atmoProbeBp","e7e5a418:0"],
    ["archaeoScannerBp","2883b2f9:0"],
  ],
  inspect: [
    ["prospectorHoldBp","306dc77a"],
    ["haulerHoldBp","46da7829"],
    ["sprintDriveBp","5fdccfd5"],
    ["economyDriveBp","94862ead"],
    ["highOutputCoreBp","23013b42"],
    ["efficientCoreBp","ba4705a9"],
    ["surveyRigBp","ae359669"],
    ["refineryFeedRigBp","6f893e7c"],
    ["rechargeArrayBp","e33fcb34"],
    ["reinforcedPlatingBp","b6ee75b4"],
    ["ablativePlatingBp","3c31699e"],
    ["compositePlatingBp","9a3da18a"],
    ["ballisticWeaveBp","b7a8c81c"],
    ["fieldSuitBp","d99c3b55"],
    ["hazardSuitBp","1d2510ee"],
    ["toxinGrenadeBp","866411ac"],
    ["medKitBp","18617a2e"],
    ["atmoProbeBp","7786e78a"],
    ["archaeoScannerBp","77cc6006"],
  ],
  salvage: [
    ["prospectorHoldBp",[{"frameSegment":1,"titaniumIngot":0},{"frameSegment":0,"titaniumIngot":1},{"frameSegment":1,"titaniumIngot":1},{"frameSegment":1,"titaniumIngot":1}]],
    ["haulerHoldBp",[{"frameSegment":1,"structuralAssembly":0},{"frameSegment":0,"structuralAssembly":0},{"frameSegment":1,"structuralAssembly":1},{"frameSegment":1,"structuralAssembly":1}]],
    ["sprintDriveBp",[{"powerCoupling":1,"polysilicateWafer":0},{"powerCoupling":0,"polysilicateWafer":1},{"powerCoupling":1,"polysilicateWafer":1},{"powerCoupling":1,"polysilicateWafer":1}]],
    ["economyDriveBp",[{"powerCoupling":1,"titaniumIngot":0},{"powerCoupling":0,"titaniumIngot":1},{"powerCoupling":1,"titaniumIngot":1},{"powerCoupling":1,"titaniumIngot":1}]],
    ["highOutputCoreBp",[{"powerCoupling":1,"structuralAssembly":0,"deuteriumCanister":0},{"powerCoupling":0,"structuralAssembly":0,"deuteriumCanister":0},{"powerCoupling":1,"structuralAssembly":1,"deuteriumCanister":1},{"powerCoupling":1,"structuralAssembly":1,"deuteriumCanister":1}]],
    ["efficientCoreBp",[{"powerCoupling":1,"polysilicateWafer":0,"deuteriumCanister":0},{"powerCoupling":0,"polysilicateWafer":1,"deuteriumCanister":0},{"powerCoupling":1,"polysilicateWafer":1,"deuteriumCanister":0},{"powerCoupling":1,"polysilicateWafer":1,"deuteriumCanister":0}]],
    ["surveyRigBp",[{"powerCoupling":1,"polysilicateWafer":0},{"powerCoupling":0,"polysilicateWafer":0},{"powerCoupling":1,"polysilicateWafer":1},{"powerCoupling":1,"polysilicateWafer":1}]],
    ["refineryFeedRigBp",[{"titaniumIngot":2},{"titaniumIngot":1},{"titaniumIngot":2},{"titaniumIngot":2}]],
    ["rechargeArrayBp",[{"powerCoupling":1,"polysilicateWafer":0},{"powerCoupling":0,"polysilicateWafer":1},{"powerCoupling":1,"polysilicateWafer":1},{"powerCoupling":1,"polysilicateWafer":1}]],
    ["reinforcedPlatingBp",[{"titaniumIngot":1,"frameSegment":0},{"titaniumIngot":0,"frameSegment":0},{"titaniumIngot":1,"frameSegment":1},{"titaniumIngot":1,"frameSegment":1}]],
    ["ablativePlatingBp",[{"titaniumIngot":1,"frameSegment":0},{"titaniumIngot":0,"frameSegment":0},{"titaniumIngot":1,"frameSegment":1},{"titaniumIngot":1,"frameSegment":1}]],
    ["compositePlatingBp",[{"titaniumIngot":1,"frameSegment":0,"structuralAssembly":0},{"titaniumIngot":0,"frameSegment":0,"structuralAssembly":0},{"titaniumIngot":1,"frameSegment":1,"structuralAssembly":0},{"titaniumIngot":1,"frameSegment":1,"structuralAssembly":0}]],
    ["ballisticWeaveBp",[{"titaniumIngot":1,"polysilicateWafer":0},{"titaniumIngot":0,"polysilicateWafer":0},{"titaniumIngot":1,"polysilicateWafer":1},{"titaniumIngot":1,"polysilicateWafer":1}]],
    ["fieldSuitBp",[{"titaniumIngot":1,"polysilicateWafer":0},{"titaniumIngot":0,"polysilicateWafer":0},{"titaniumIngot":1,"polysilicateWafer":1},{"titaniumIngot":1,"polysilicateWafer":1}]],
    ["hazardSuitBp",[{"titaniumIngot":1,"polysilicateWafer":0,"frameSegment":0},{"titaniumIngot":0,"polysilicateWafer":0,"frameSegment":0},{"titaniumIngot":1,"polysilicateWafer":1,"frameSegment":0},{"titaniumIngot":1,"polysilicateWafer":1,"frameSegment":0}]],
    ["toxinGrenadeBp",[{"polysilicateWafer":1,"powerCoupling":0,"titaniumIngot":0},{"polysilicateWafer":0,"powerCoupling":0,"titaniumIngot":0},{"polysilicateWafer":1,"powerCoupling":1,"titaniumIngot":0},{"polysilicateWafer":1,"powerCoupling":1,"titaniumIngot":0}]],
    ["medKitBp",[{"polysilicateWafer":1,"titaniumIngot":0},{"polysilicateWafer":0,"titaniumIngot":0},{"polysilicateWafer":1,"titaniumIngot":1},{"polysilicateWafer":1,"titaniumIngot":1}]],
    ["atmoProbeBp",[{"polysilicateWafer":1,"frameSegment":0,"powerCoupling":0},{"polysilicateWafer":0,"frameSegment":0,"powerCoupling":0},{"polysilicateWafer":1,"frameSegment":1,"powerCoupling":0},{"polysilicateWafer":1,"frameSegment":1,"powerCoupling":0}]],
    ["archaeoScannerBp",[{"polysilicateWafer":1,"frameSegment":0},{"polysilicateWafer":1,"frameSegment":0},{"polysilicateWafer":2,"frameSegment":1},{"polysilicateWafer":2,"frameSegment":1}]],
  ],
};

const REWORKED_SET: ReadonlySet<string> = new Set(ML2_REWORKED);

// The recipe table rows ML-2 must not touch: every blueprint it does not rework, every Refinery recipe except the
// `added` ones (a later slice's new keys, held apart), every hull build. And the reworked rows.
// Expedition Tiers G2-4 (merged onto feat after ML-2): its Class II to VII drive blueprints (driveClass set) are new
// keys too, held apart the same way (the materialLinesGoldens.test.ts precedent).
export function untouchedRows(added: ReadonlySet<string> = new Set()): string[] {
  return recipeTable().filter((r) => {
    const [kind, key] = r.split(":");
    // E-MOD EM-7: its eight module blueprints came after the capture and are held apart (emodEm7.fixture.ts).
    return kind === "bp" ? !REWORKED_SET.has(key) && BLUEPRINTS[key].driveClass === undefined && !EM7_BLUEPRINT_KEYS.has(key) : kind === "refine" ? !added.has(key) : true;
  });
}
export function reworkedRows(): [string, string][] {
  return ML2_REWORKED.map((k) => [k, hash(BLUEPRINTS[k].recipe)]);
}

// ===== the read-back (added by ML-2 itself) =====

// Every reworked blueprint's inputs as they stood at 624b0c5, in their old key order (the Reactor Cores with their
// withReactorFuel canisters appended). withPreMl2Recipes puts them back, so every ML-2 move can be shown to be the
// recipe change alone: under them each reworked row, craft and salvage reproduces ML2_GOLDEN.
export const PRE_ML2_RECIPES: Readonly<Record<string, Readonly<Record<string, number>>>> = {
  powerCouplingBp: { polysilicateWafer: 4 },
  prospectorHoldBp: { frameSegment: 2, titaniumIngot: 3 },
  haulerHoldBp: { frameSegment: 3, structuralAssembly: 1 },
  sprintDriveBp: { powerCoupling: 2, polysilicateWafer: 3 },
  economyDriveBp: { powerCoupling: 2, titaniumIngot: 3 },
  highOutputCoreBp: { powerCoupling: 3, structuralAssembly: 1, deuteriumCanister: 2 },
  efficientCoreBp: { powerCoupling: 2, polysilicateWafer: 3, deuteriumCanister: 1 },
  surveyRigBp: { powerCoupling: 2, polysilicateWafer: 2 },
  refineryFeedRigBp: { titaniumIngot: 5 },
  rechargeArrayBp: { powerCoupling: 2, polysilicateWafer: 3 },
  reinforcedPlatingBp: { titaniumIngot: 3, frameSegment: 1 },
  ablativePlatingBp: { titaniumIngot: 2, frameSegment: 2 },
  compositePlatingBp: { titaniumIngot: 3, frameSegment: 2, structuralAssembly: 1 },
  ballisticWeaveBp: { titaniumIngot: 3, polysilicateWafer: 1 },
  fieldSuitBp: { titaniumIngot: 2, polysilicateWafer: 2 },
  hazardSuitBp: { titaniumIngot: 3, polysilicateWafer: 2, frameSegment: 1 },
  toxinGrenadeBp: { polysilicateWafer: 3, powerCoupling: 1, titaniumIngot: 1 },
  medKitBp: { polysilicateWafer: 2, titaniumIngot: 1 },
  atmoProbeBp: { polysilicateWafer: 2, frameSegment: 1, powerCoupling: 1 },
  archaeoScannerBp: { polysilicateWafer: 4, frameSegment: 1 },
};

// The two Refinery recipes and the two refined goods ML-2 adds (the recipe realism audit's Biofiber and Resin
// Distillate; new keys only), held apart from the untouched table and the earlier censuses.
export const ML2_NEW_REFINES: ReadonlySet<string> = new Set(["refineBiofiber", "refineResinDistillate"]);
export const ML2_NEW_ITEMS: ReadonlySet<string> = new Set(["biofiber", "resinDistillate"]);

// ===== the wiring registry (the golden files that pin it: shortRangeGoldens, emodGoldens) =====

// ML-2's whole registry move, captured against the registry at 624b0c5: the two new refines' entries are ADDED; the
// seven ML-1 recipe entries flip pending -> live with their content probes (refineRecipeOffered offers them now); the
// six ML-1 reserve entries are GONE (each good has its consumer, so no reserve is built). Nothing else moved.
export const ML2_ADDED_ENTRY_IDS: ReadonlySet<string> = new Set([...ML2_NEW_REFINES].map((k) => `facility:REFINE_RECIPES:${k}`));
export const ML2_LIFTED_RECIPE_IDS: ReadonlySet<string> = new Set(
  ["refineFerriteIngot", "refineReclaimedCircuit", "refineIridiumCatalyst", "synthCobaltCoil", "synthOsmiumPlate", "synthPhotonicGel", "synthBiocatalyst"].map(
    (k) => `facility:REFINE_RECIPES:${k}`,
  ),
);
export const ML2_DROPPED_RESERVE_IDS: readonly string[] = ["reclaimedCircuit", "iridiumCatalyst", "cobaltCoil", "osmiumPlate", "photonicGel", "biocatalyst"].map(
  (id) => `facility:ITEMS:${id}:reserved`,
);
// The pending owner every one of those entries named before ML-2 (model.ts ML2_RECIPE_REWORK, retired by ML-2).
const ML2_OWNER_BEFORE = "ML-2 (Material Lines recipe rework: the cargo, FTL, reactor, utility, shield and plating blueprints)";
// The dropped reserves sat together, just before the Precursor Circuit's (EM-8), which stays.
const ML2_RESERVES_SAT_BEFORE = "facility:ITEMS:precursorCircuit:reserved";

// Registry snapshot rows ([id, status, contexts, probe], registry order) with ML-2 read back: its added entries left out,
// its lifted recipes pending again, its dropped reserves back in place. Every pin taken before ML-2 reads through it.
export function ml2RowsBack(rows: readonly (readonly unknown[])[]): unknown[][] {
  const out: unknown[][] = [];
  for (const r of rows) {
    const id = r[0] as string;
    if (ML2_ADDED_ENTRY_IDS.has(id)) continue;
    if (id === ML2_RESERVES_SAT_BEFORE) for (const d of ML2_DROPPED_RESERVE_IDS) out.push([d, { kind: "pending", owner: ML2_OWNER_BEFORE }, [], null]);
    out.push(ML2_LIFTED_RECIPE_IDS.has(id) ? [id, { kind: "pending", owner: ML2_OWNER_BEFORE }, [], null] : [...r]);
  }
  return out;
}

// The same read-back on `${id}|${status kind}` lines (shortRangeGoldens' registry pins).
export function ml2LinesBack(lines: readonly string[]): string[] {
  return ml2RowsBack(lines.map((l) => [l.slice(0, l.lastIndexOf("|")), l.slice(l.lastIndexOf("|") + 1)])).map(
    (r) => `${r[0] as string}|${typeof r[1] === "string" ? r[1] : (r[1] as { kind: string }).kind}`,
  );
}

// Runs `fn` with every reworked blueprint's inputs set back to PRE_ML2_RECIPES, then restores them. BLUEPRINTS is
// static data, so this is the honest way to show the old recipes reproduce the capture. The Refinery's consumer cache
// (model.ts consumedOutsideRefinery, read by refineRecipeOffered) is dropped on entry and on restore, so neither side
// ever reads a cache built from the other side's recipes.
export function withPreMl2Recipes<T>(fn: () => T): T {
  const saved = ML2_REWORKED.map((k) => [k, BLUEPRINTS[k]] as const);
  try {
    for (const k of ML2_REWORKED) BLUEPRINTS[k] = { ...BLUEPRINTS[k], recipe: { ...BLUEPRINTS[k].recipe, inputs: { ...PRE_ML2_RECIPES[k] } } };
    resetRefineConsumerCacheForTest();
    return fn();
  } finally {
    for (const [k, bp] of saved) BLUEPRINTS[k] = bp;
    resetRefineConsumerCacheForTest();
  }
}

