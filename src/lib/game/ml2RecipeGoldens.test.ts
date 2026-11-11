// ML-2 goldens (0.14.0): the pre-rework capture (ml2RecipeGoldens.fixture.ts ML2_GOLDEN, taken on feat/crew-0.14.0 at
// 624b0c5 before any ML-2 data edit), and ML-2's moves, each proven to be the recipe change alone.
//
// MOVED BY ML-2 (each read back: with the 20 reworked blueprints' old inputs put back, withPreMl2Recipes, every value
// below reproduces the capture exactly):
//   recipes  : the 20 reworked blueprint rows (plan ML-2 + the recipe realism audit). Every other blueprint, every
//              Refinery recipe that existed and every hull build are untouched; the two new refines (Biofiber, Resin
//              Distillate) are new keys, held apart.
//   fabricate: one craft of each reworked blueprint, because it is stocked with (and spends) its new inputs. The
//              shared-stream draw count is unchanged on every row.
//   salvage  : salvage refunds a piece's blueprint recipe as it stands, so a salvaged reworked piece gives back its
//              new inputs (the reactor fuel slice's precedent).
// UNCHANGED: the piece each reworked blank rolls (a crafted piece never reads its recipe; already crafted gear keeps
// every stat). Test-only.

// Ordering determinism part 2 (canonicalOrder.ts: inventory keys and a call's completion log in one order) came after every pin here, traced order-only: the file runs with it off (ordering2Switch.fixture.ts).
import { ordering2OffForThisFile } from "./ordering2Switch.fixture";
ordering2OffForThisFile();
import { describe, expect, it } from "vitest";
import { withoutGg7Content } from "./gasGiantSpecials.fixture";
// E-MOD EM-8 came after this capture: the Precursor Lens's blueprint, variety and the circuit's recipe held apart.
import { EM8_BLUEPRINT_KEYS, withoutEm8Content } from "./emodEm8Switch.fixture";
import { withoutCp11Content } from "./cp11BlueprintsSwitch.fixture";
import { hash } from "./firstRunsGoldens.fixture";
import { BLUEPRINTS, isMemberSlotType } from "./model";
import { withSiMemberGearOff } from "./siMemberGearSwitch.fixture";
import {
  ML2_GOLDEN,
  ML2_NEW_REFINES,
  ML2_REWORKED,
  fabricated,
  inspected,
  isEquipment,
  reworkedRows,
  salvageRows,
  untouchedRows,
  withPreMl2Recipes,
} from "./ml2RecipeGoldens.fixture";
// WR-8 (0.14.0): every pin in this file was taken before the combat rules (combatRulesSwitch.fixture.ts), so the file
// runs with them switched off and its pins keep proving WR-8 moved nothing else here (the rules stamp new patrol
// cycles and runs; combatDescriptorGoldens.test.ts pins the combat rules themselves).
import { combatRulesOffForThisFile } from "./combatRulesSwitch.fixture";
combatRulesOffForThisFile();

// The reworked values after ML-2 (pinned so a later slice cannot move one unexplained).
const AFTER = {
  recipesReworked: [
    ["powerCouplingBp","6b9c31b3"],
    ["prospectorHoldBp","bde110a0"],
    ["haulerHoldBp","e0b21fb1"],
    ["sprintDriveBp","a20346ca"],
    ["economyDriveBp","3d2eef2"],
    ["highOutputCoreBp","9e14b95a"],
    ["efficientCoreBp","e17f3752"],
    ["surveyRigBp","fb57bd4"],
    ["refineryFeedRigBp","d1c1186d"],
    ["rechargeArrayBp","8ce250e2"],
    ["reinforcedPlatingBp","79672994"],
    ["ablativePlatingBp","2a8f0e67"],
    ["compositePlatingBp","c7a4d18b"],
    ["ballisticWeaveBp","8c03e465"],
    ["fieldSuitBp","db93623b"],
    ["hazardSuitBp","1b97a725"],
    ["toxinGrenadeBp","711251fd"],
    ["medKitBp","b0d2fdcf"],
    ["atmoProbeBp","21f1b58"],
    ["archaeoScannerBp","98d7a4"],
  ],
  fabricate: [
    ["powerCouplingBp","83a0dbed:1"],
    ["prospectorHoldBp","75dfa04f:0"],
    ["haulerHoldBp","86a27d7b:0"],
    ["sprintDriveBp","31ab888:0"],
    ["economyDriveBp","a0833f69:0"],
    ["highOutputCoreBp","5f2a363e:0"],
    ["efficientCoreBp","533787a2:0"],
    ["surveyRigBp","9b051edb:0"],
    ["refineryFeedRigBp","42d3245c:0"],
    ["rechargeArrayBp","243dad96:0"],
    ["reinforcedPlatingBp","72e322c6:0"],
    ["ablativePlatingBp","943c2b9a:0"],
    ["compositePlatingBp","3634d0a2:0"],
    ["ballisticWeaveBp","eb5643de:0"],
    ["fieldSuitBp","342db8a0:0"],
    ["hazardSuitBp","8b71e77e:0"],
    ["toxinGrenadeBp","d829a1a6:0"],
    ["medKitBp","4fb258e9:0"],
    ["atmoProbeBp","f92264f2:0"],
    ["archaeoScannerBp","d1f444ef:0"],
  ],
  salvage: [
    ["prospectorHoldBp",[{"frameSegment":1,"titaniumIngot":0,"reclaimedAlloy":0},{"frameSegment":0,"titaniumIngot":0,"reclaimedAlloy":0},{"frameSegment":1,"titaniumIngot":1,"reclaimedAlloy":1},{"frameSegment":1,"titaniumIngot":1,"reclaimedAlloy":1}]],
    ["haulerHoldBp",[{"structuralAssembly":0,"ferriteIngot":0,"reclaimedAlloy":0},{"structuralAssembly":0,"ferriteIngot":0,"reclaimedAlloy":0},{"structuralAssembly":1,"ferriteIngot":1,"reclaimedAlloy":1},{"structuralAssembly":0,"ferriteIngot":1,"reclaimedAlloy":1}]],
    ["sprintDriveBp",[{"powerCoupling":1,"cobaltCoil":0},{"powerCoupling":0,"cobaltCoil":0},{"powerCoupling":1,"cobaltCoil":1},{"powerCoupling":1,"cobaltCoil":1}]],
    ["economyDriveBp",[{"powerCoupling":1,"reclaimedCircuit":0},{"powerCoupling":0,"reclaimedCircuit":1},{"powerCoupling":1,"reclaimedCircuit":1},{"powerCoupling":1,"reclaimedCircuit":1}]],
    ["highOutputCoreBp",[{"powerCoupling":1,"iridiumCatalyst":0,"osmiumPlate":0,"deuteriumCanister":1},{"powerCoupling":0,"iridiumCatalyst":0,"osmiumPlate":0,"deuteriumCanister":0},{"powerCoupling":1,"iridiumCatalyst":1,"osmiumPlate":0,"deuteriumCanister":1},{"powerCoupling":1,"iridiumCatalyst":1,"osmiumPlate":0,"deuteriumCanister":1}]],
    ["efficientCoreBp",[{"powerCoupling":1,"cobaltCoil":0,"reclaimedCircuit":0,"deuteriumCanister":0},{"powerCoupling":0,"cobaltCoil":0,"reclaimedCircuit":0,"deuteriumCanister":0},{"powerCoupling":1,"cobaltCoil":1,"reclaimedCircuit":1,"deuteriumCanister":1},{"powerCoupling":1,"cobaltCoil":1,"reclaimedCircuit":1,"deuteriumCanister":1}]],
    ["surveyRigBp",[{"powerCoupling":1,"photonicGel":0},{"powerCoupling":0,"photonicGel":0},{"powerCoupling":1,"photonicGel":1},{"powerCoupling":1,"photonicGel":1}]],
    ["refineryFeedRigBp",[{"titaniumIngot":1,"biocatalyst":0},{"titaniumIngot":0,"biocatalyst":0},{"titaniumIngot":1,"biocatalyst":1},{"titaniumIngot":1,"biocatalyst":1}]],
    ["rechargeArrayBp",[{"powerCoupling":1,"polysilicateWafer":0,"cobaltCoil":0},{"powerCoupling":0,"polysilicateWafer":0,"cobaltCoil":0},{"powerCoupling":1,"polysilicateWafer":1,"cobaltCoil":1},{"powerCoupling":1,"polysilicateWafer":1,"cobaltCoil":1}]],
    ["reinforcedPlatingBp",[{"ferriteIngot":1,"titaniumIngot":0,"frameSegment":0},{"ferriteIngot":0,"titaniumIngot":0,"frameSegment":0},{"ferriteIngot":1,"titaniumIngot":1,"frameSegment":0},{"ferriteIngot":1,"titaniumIngot":1,"frameSegment":0}]],
    ["ablativePlatingBp",[{"frameSegment":1,"titaniumIngot":0,"biofiber":0},{"frameSegment":0,"titaniumIngot":0,"biofiber":0},{"frameSegment":1,"titaniumIngot":1,"biofiber":1},{"frameSegment":1,"titaniumIngot":1,"biofiber":1}]],
    ["compositePlatingBp",[{"titaniumIngot":0,"frameSegment":0,"structuralAssembly":0,"osmiumPlate":0,"biofiber":0},{"titaniumIngot":0,"frameSegment":0,"structuralAssembly":0,"osmiumPlate":0,"biofiber":1},{"titaniumIngot":1,"frameSegment":1,"structuralAssembly":0,"osmiumPlate":1,"biofiber":1},{"titaniumIngot":0,"frameSegment":1,"structuralAssembly":0,"osmiumPlate":1,"biofiber":1}]],
    ["ballisticWeaveBp",[{"titaniumIngot":0,"polysilicateWafer":0,"biofiber":0},{"titaniumIngot":0,"polysilicateWafer":0,"biofiber":0},{"titaniumIngot":1,"polysilicateWafer":1,"biofiber":1},{"titaniumIngot":0,"polysilicateWafer":1,"biofiber":1}]],
    ["fieldSuitBp",[{"titaniumIngot":0,"polysilicateWafer":0,"biofiber":0},{"titaniumIngot":0,"polysilicateWafer":0,"biofiber":0},{"titaniumIngot":1,"polysilicateWafer":1,"biofiber":0},{"titaniumIngot":0,"polysilicateWafer":1,"biofiber":0}]],
    ["hazardSuitBp",[{"titaniumIngot":1,"polysilicateWafer":0,"resinDistillate":0},{"titaniumIngot":0,"polysilicateWafer":0,"resinDistillate":0},{"titaniumIngot":1,"polysilicateWafer":1,"resinDistillate":0},{"titaniumIngot":1,"polysilicateWafer":1,"resinDistillate":0}]],
    ["toxinGrenadeBp",[{"titaniumIngot":0,"powerCoupling":0,"resinDistillate":0},{"titaniumIngot":0,"powerCoupling":0,"resinDistillate":0},{"titaniumIngot":1,"powerCoupling":1,"resinDistillate":0},{"titaniumIngot":0,"powerCoupling":1,"resinDistillate":0}]],
    ["medKitBp",[{"polysilicateWafer":0,"titaniumIngot":0,"purifiedBiomass":0},{"polysilicateWafer":0,"titaniumIngot":0,"purifiedBiomass":0},{"polysilicateWafer":1,"titaniumIngot":1,"purifiedBiomass":1},{"polysilicateWafer":0,"titaniumIngot":1,"purifiedBiomass":1}]],
    ["atmoProbeBp",[{"polysilicateWafer":1,"powerCoupling":0,"titaniumIngot":0},{"polysilicateWafer":0,"powerCoupling":0,"titaniumIngot":0},{"polysilicateWafer":1,"powerCoupling":1,"titaniumIngot":1},{"polysilicateWafer":1,"powerCoupling":1,"titaniumIngot":1}]],
    ["archaeoScannerBp",[{"polysilicateWafer":1,"powerCoupling":0},{"polysilicateWafer":1,"powerCoupling":0},{"polysilicateWafer":2,"powerCoupling":1},{"polysilicateWafer":2,"powerCoupling":1}]],
  ],
};

// The seven away-team pieces as the Standard-Issue member gear change rolls them (its move, read back above).
const AFTER_SI_INSPECT = [
  ["ballisticWeaveBp", "58e491ae"],
  ["fieldSuitBp", "dfbab3d2"],
  ["hazardSuitBp", "f18b729d"],
  ["toxinGrenadeBp", "da18e5e4"],
  ["medKitBp", "ced37d40"],
  ["atmoProbeBp", "7aeedb55"],
  ["archaeoScannerBp", "2f3d6b95"],
];

const drawsOf = (rows: unknown): string[] => (rows as [string, string][]).map(([k, v]) => `${k}:${v.split(":")[1]}`);

describe("ML-2 goldens: the capture, read back, and ML-2's moves", () => {
  it("recipes: the untouched table holds (the two new refines held apart)", () => {
    // Gas Giant Study GG-7 (after this capture): its four NEW blueprints held apart (no existing recipe moved); Complement
    // CP-11's fifteen likewise.
    expect(hash(withoutCp11Content(() => withoutGg7Content(() => withoutEm8Content(() => untouchedRows(ML2_NEW_REFINES)))))).toBe(ML2_GOLDEN.recipesUntouched);
  });

  it("recipes: with the old inputs put back, every reworked row reproduces the capture; today each has moved", () => {
    expect(withPreMl2Recipes(reworkedRows)).toEqual(ML2_GOLDEN.recipesReworked);
    const now = reworkedRows();
    now.forEach(([k, h], i) => expect(h, k).not.toBe(ML2_GOLDEN.recipesReworked[i][1]));
    expect(now).toEqual(AFTER.recipesReworked);
  });

  it("fabricate: the old recipes reproduce the capture; the new ones move only the craft, never the draw count", () => {
    expect(withPreMl2Recipes(() => ML2_REWORKED.map((k) => [k, fabricated(k)]))).toEqual(ML2_GOLDEN.fabricate);
    const now = ML2_REWORKED.map((k) => [k, fabricated(k)]);
    expect(drawsOf(now)).toEqual(drawsOf(ML2_GOLDEN.fabricate));
    expect(now).toEqual(AFTER.fabricate);
  });

  // ML-2 moves no inspected piece (a roll never reads its recipe). The Standard-Issue member gear change merged after the
  // capture (feat 8c4e439: the crafted budget floor and the D26 Science lines) lifts the seven away-team pieces; with it
  // switched off (withSiMemberGearOff) every piece reads the capture, and the ship pieces never moved.
  it("inspect: the piece each reworked equipment blank rolls is unchanged by ML-2", () => {
    const rows = () => ML2_REWORKED.filter(isEquipment).map((k) => [k, hash(inspected(k).equipment.at(-1))]);
    expect(withSiMemberGearOff(rows)).toEqual(ML2_GOLDEN.inspect);
    expect(withPreMl2Recipes(() => withSiMemberGearOff(rows))).toEqual(ML2_GOLDEN.inspect);
    const now = rows();
    const isMember = (k: string) => isMemberSlotType(BLUEPRINTS[k].equipmentOutput!.slotType);
    now.forEach(([k, h], i) => {
      if (!isMember(k as string)) expect(h, k as string).toBe(ML2_GOLDEN.inspect[i][1]);
    });
    expect(now.filter(([k]) => isMember(k as string))).toEqual(AFTER_SI_INSPECT);
  });

  it("salvage: the old recipes reproduce the capture; the new ones give back the new inputs", () => {
    expect(withPreMl2Recipes(salvageRows)).toEqual(ML2_GOLDEN.salvage);
    expect(salvageRows()).toEqual(AFTER.salvage);
  });
});
