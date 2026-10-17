// Field Kits FKR-2 (docs/plans/2026-10-14-field-kits-plan.md REVISED SLICES R3 FKR-2): the pure kit catalog, the
// condition lines and severity ranks, the category rules, the free basic set curve, the per-use device roll and the
// specialist bonuses. Nothing reads the module yet (FKR-4 to FKR-8 wire it), so these tests pin the contract.

import { describe, it, expect } from "vitest";
import {
  BASIC_DEBUFFS,
  CODEBREAKER_DEVICE_BONUS,
  CONDITION_LINES,
  CONDITION_LINE_IDS,
  FIELD_DEVICE_MIN_PERCENT,
  FIELD_DEVICE_SALT,
  FIELD_DEVICE_SPAN_PERCENT,
  FIELD_KITS,
  FIELD_KIT_IDS,
  FREE_BASIC_FIRST_AID_PER_MEMBER,
  INJURY_KIT_TREATMENT_SHARE,
  KIT_CATEGORY_RULES,
  SABOTEUR_GRENADE_BONUS,
  SPLINT_HEAL_ROUNDS,
  STIM_INSPIRED_ROUNDS,
  canUseKit,
  codebreakerAboard,
  fieldDevicePercent,
  fieldDeviceRollEffectiveness,
  freeBasicCrewCurve,
  freeBasicFirstAid,
  freeBasicSet,
  isSaboteur,
  kitClears,
  kitEffectiveness,
  kitTreatment,
  saboteurGrenadeMult,
  severityOf,
  treatsUpTo,
  type FieldKitConditionId,
  type FieldKitId,
} from "./fieldKits";
import { FIRST_AID_HEAL, FIRST_AID_TRAINED_EFFECTIVENESS, FIRST_AID_UNTRAINED_EFFECTIVENESS, GAMBIT_STATUSES } from "./gambit";
import { GROUND_CONDITIONS } from "./medicalBay";
import { makeRng } from "./combat/rng";
import type { AwayRosterSnapshot, SnapshotMember } from "./model";

const TRAINED = { medic: true };
const UNTRAINED = { medic: false };
const BARE = {};

describe("the kit catalog (FKR-2)", () => {
  it("lists the six user-named kits, ids matching their keys, each with a label and a category", () => {
    expect([...FIELD_KIT_IDS].sort()).toEqual(["antitoxin", "combatStim", "firstAidKit", "injuryKit", "splint", "traumaKit"]);
    expect(Object.keys(FIELD_KITS).sort()).toEqual([...FIELD_KIT_IDS].sort());
    for (const id of FIELD_KIT_IDS) {
      expect(FIELD_KITS[id].id).toBe(id);
      expect(FIELD_KITS[id].label.length).toBeGreaterThan(0);
      expect(KIT_CATEGORY_RULES[FIELD_KITS[id].category]).toBeDefined();
    }
    expect(FIELD_KITS.firstAidKit.label).toBe("First Aid Kit");
    expect(FIELD_KITS.traumaKit.label).toBe("Trauma Kit");
    expect(FIELD_KITS.combatStim.label).toBe("Combat Stim");
  });

  it("First Aid Kit, Antitoxin and Combat Stim are First Aid; Splint, Trauma Kit and Injury Kit are Advanced Medical", () => {
    const byCategory = (c: string) => FIELD_KIT_IDS.filter((id) => FIELD_KITS[id].category === c).sort();
    expect(byCategory("firstAid")).toEqual(["antitoxin", "combatStim", "firstAidKit"]);
    expect(byCategory("advancedMedical")).toEqual(["injuryKit", "splint", "traumaKit"]);
  });
});

describe("category rules and gates", () => {
  it("First Aid reuses gambit.ts's 0.5x untrained and 1.25x trained (imported, never copied)", () => {
    expect(KIT_CATEGORY_RULES.firstAid.untrained).toBe(FIRST_AID_UNTRAINED_EFFECTIVENESS);
    expect(KIT_CATEGORY_RULES.firstAid.trained).toBe(FIRST_AID_TRAINED_EFFECTIVENESS);
    expect(KIT_CATEGORY_RULES.firstAid.untrained).toBe(0.5);
    expect(KIT_CATEGORY_RULES.firstAid.trained).toBe(1.25);
    expect(KIT_CATEGORY_RULES.firstAid.requiresMedicalTraining).toBe(false);
  });

  it("Advanced Medical needs Medical Training; Explosives work for anyone at full strength", () => {
    expect(KIT_CATEGORY_RULES.advancedMedical.requiresMedicalTraining).toBe(true);
    expect(KIT_CATEGORY_RULES.advancedMedical.trained).toBe(1);
    expect(KIT_CATEGORY_RULES.explosives).toMatchObject({ requiresMedicalTraining: false, untrained: 1, trained: 1 });
    expect(KIT_CATEGORY_RULES.fieldDevices.requiresMedicalTraining).toBe(false);
  });

  it("each kit's gate: anyone uses First Aid kits, only a trained member uses Advanced Medical ones", () => {
    for (const id of ["firstAidKit", "antitoxin", "combatStim"] as const) {
      expect(canUseKit(TRAINED, id), id).toBe(true);
      expect(canUseKit(UNTRAINED, id), id).toBe(true);
      expect(canUseKit(BARE, id), id).toBe(true);
    }
    for (const id of ["splint", "traumaKit", "injuryKit"] as const) {
      expect(canUseKit(TRAINED, id), id).toBe(true);
      expect(canUseKit(UNTRAINED, id), id).toBe(false);
      expect(canUseKit(BARE, id), id).toBe(false);
    }
  });

  it("effectiveness: First Aid 0.5 / 1.25, Advanced Medical 0 untrained and 1 trained, Fleet Triage multiplies", () => {
    expect(kitEffectiveness(UNTRAINED, "firstAidKit")).toBe(0.5);
    expect(kitEffectiveness(TRAINED, "firstAidKit")).toBe(1.25);
    expect(kitEffectiveness(TRAINED, "combatStim")).toBe(1.25);
    expect(kitEffectiveness(UNTRAINED, "traumaKit")).toBe(0);
    expect(kitEffectiveness(TRAINED, "traumaKit")).toBe(1);
    expect(kitEffectiveness({ medic: true, careMult: 1.2 }, "firstAidKit")).toBeCloseTo(1.5, 12);
    expect(kitEffectiveness({ medic: false, careMult: 1.2 }, "splint")).toBe(0);
  });
});

describe("condition lines and severity ranks", () => {
  it("the bone line runs Fracture, Broken Bone, Shattered Bone (bone only in 0.14.0, N9)", () => {
    expect(CONDITION_LINE_IDS).toEqual(["bone"]);
    expect(CONDITION_LINES.bone.map((r) => r.id)).toEqual(["fracture", "brokenBone", "shatteredBone"]);
    expect(CONDITION_LINES.bone.map((r) => r.label)).toEqual(["Fracture", "Broken Bone", "Shattered Bone"]);
  });

  it("severityOf names the line and the rank (1 lightest); a status outside a line has none", () => {
    expect(severityOf("fracture")).toEqual({ line: "bone", rank: 1 });
    expect(severityOf("brokenBone")).toEqual({ line: "bone", rank: 2 });
    expect(severityOf("shatteredBone")).toEqual({ line: "bone", rank: 3 });
    for (const id of ["poison", "bleed", "hemorrhage", "neurotoxin", "concussion", "blindness", "stun"] as const) expect(severityOf(id), id).toBeUndefined();
  });

  it("the Fracture rank keeps the medical bay's existing condition id", () => {
    expect(GROUND_CONDITIONS[CONDITION_LINES.bone[0].id]).toBeDefined();
  });
});

describe("kit coverage (group 5 with severity ranks)", () => {
  it("treatsUpTo: Splint and Trauma Kit reach Broken Bone (rank 2); no kit reaches Shattered Bone", () => {
    expect(treatsUpTo("splint")).toEqual({ bone: 2 });
    expect(treatsUpTo("traumaKit")).toEqual({ bone: 2 });
    for (const id of ["firstAidKit", "antitoxin", "combatStim", "injuryKit"] as const) expect(treatsUpTo(id), id).toEqual({});
    for (const id of FIELD_KIT_IDS) expect(treatsUpTo(id).bone ?? 0, id).toBeLessThan(3);
  });

  it("First Aid clears the user's basic debuffs (Bleed, Blindness, Weakened, Suppressed, Corroded) but never Poison", () => {
    const clears = kitClears("firstAidKit");
    for (const id of ["bleed", "blindness", "weakened", "suppressed", "corroded"] as const) expect(clears, id).toContain(id);
    expect(clears).not.toContain("poison");
    for (const id of ["hemorrhage", "neurotoxin", "concussion", "fracture"] as const) expect(clears, id).not.toContain(id);
    expect(FIELD_KITS.firstAidKit.heal).toBe(FIRST_AID_HEAL);
  });

  it("Antitoxin clears Poison only (Neurotoxin needs a Trauma Kit)", () => {
    expect(kitClears("antitoxin")).toEqual(["poison"]);
  });

  it("Trauma Kit clears Hemorrhage, Neurotoxin and Concussion", () => {
    expect([...kitClears("traumaKit")].sort()).toEqual(["concussion", "hemorrhage", "neurotoxin"]);
  });

  it("Combat Stim grants Inspired for 2 rounds; Injury Kit carries a bay treatment share", () => {
    expect(FIELD_KITS.combatStim.buff).toEqual({ id: "inspired", rounds: STIM_INSPIRED_ROUNDS });
    expect(STIM_INSPIRED_ROUNDS).toBe(2);
    expect(GAMBIT_STATUSES.inspired.kind).toBe("buff");
    expect(FIELD_KITS.injuryKit.treatmentShare).toBe(INJURY_KIT_TREATMENT_SHARE);
    expect(INJURY_KIT_TREATMENT_SHARE).toBeGreaterThan(0);
    expect(kitClears("injuryKit")).toEqual([]);
  });

  it("kitTreatment: Splint heals a Fracture in 3 rounds and turns a Broken Bone into a Fracture (N8)", () => {
    expect(SPLINT_HEAL_ROUNDS).toBe(3);
    expect(kitTreatment("splint", "fracture")).toEqual({ kind: "heal", rounds: SPLINT_HEAL_ROUNDS });
    expect(kitTreatment("splint", "brokenBone")).toEqual({ kind: "downgrade", to: "fracture" });
    expect(kitTreatment("splint", "shatteredBone")).toBeNull();
    expect(kitTreatment("splint", "bleed")).toBeNull();
  });

  it("kitTreatment: a Trauma Kit clears a Fracture, a Broken Bone and its three conditions, never a Shattered Bone", () => {
    for (const id of ["fracture", "brokenBone", "hemorrhage", "neurotoxin", "concussion"] as const) expect(kitTreatment("traumaKit", id), id).toEqual({ kind: "clear" });
    expect(kitTreatment("traumaKit", "shatteredBone")).toBeNull();
    expect(kitTreatment("traumaKit", "poison")).toBeNull();
  });

  it("kitTreatment: no kit treats a Shattered Bone (only the medical bay)", () => {
    for (const id of FIELD_KIT_IDS) expect(kitTreatment(id, "shatteredBone"), id).toBeNull();
  });

  it("kitTreatment: clears follow kitClears; a buff is never cleared", () => {
    expect(kitTreatment("firstAidKit", "weakened")).toEqual({ kind: "clear" });
    expect(kitTreatment("firstAidKit", "poison")).toBeNull();
    expect(kitTreatment("antitoxin", "poison")).toEqual({ kind: "clear" });
    for (const id of FIELD_KIT_IDS) {
      expect(kitTreatment(id, "inspired"), id).toBeNull();
      expect(kitTreatment(id, "shielded"), id).toBeNull();
    }
  });
});

describe("basic debuffs: what Cure and First Aid clear", () => {
  it("Cure clears the basic debuffs (Poison included) and never a serious condition or a buff", () => {
    for (const id of ["bleed", "blindness", "weakened", "suppressed", "corroded", "poison"] as const) expect(BASIC_DEBUFFS, id).toContain(id);
    const serious: FieldKitConditionId[] = ["hemorrhage", "neurotoxin", "concussion", "fracture", "brokenBone", "shatteredBone", "shielded", "inspired"];
    for (const id of serious) expect(BASIC_DEBUFFS, id).not.toContain(id);
    // Stun and Fear stay on the list as today [PROVISIONAL].
    expect(BASIC_DEBUFFS).toContain("stun");
    expect(BASIC_DEBUFFS).toContain("fear");
  });

  it("First Aid's clears are the basic debuffs minus Poison", () => {
    expect([...kitClears("firstAidKit")].sort()).toEqual(BASIC_DEBUFFS.filter((id) => id !== "poison").sort());
  });
});

describe("the free basic set (D23 curve, no cap)", () => {
  it("a member with no support crew still gets the base First Aid Kit (N12)", () => {
    expect(freeBasicFirstAid(0)).toBe(FREE_BASIC_FIRST_AID_PER_MEMBER);
    expect(FREE_BASIC_FIRST_AID_PER_MEMBER).toBe(1);
    expect(freeBasicSet(0)).toEqual({ firstAidKit: FREE_BASIC_FIRST_AID_PER_MEMBER });
  });

  it("whole kits, never decreasing as the crew grows", () => {
    let prev = freeBasicFirstAid(0);
    for (let heads = 1; heads <= 400; heads += 1) {
      const n = freeBasicFirstAid(heads);
      expect(Number.isInteger(n), String(heads)).toBe(true);
      expect(n, String(heads)).toBeGreaterThanOrEqual(prev);
      prev = n;
    }
  });

  it("concave: the crew curve's each later block of crew adds less than the block before; the kits round it", () => {
    const step = 8;
    let prevGain = Number.POSITIVE_INFINITY;
    for (let heads = 0; heads < 2000; heads += step) {
      const gain = freeBasicCrewCurve(heads + step) - freeBasicCrewCurve(heads);
      expect(gain, String(heads)).toBeGreaterThan(0);
      expect(gain, String(heads)).toBeLessThan(prevGain);
      prevGain = gain;
    }
    expect(freeBasicCrewCurve(0)).toBe(0);
    for (const heads of [0, 3, 8, 17, 64, 333]) expect(freeBasicFirstAid(heads), String(heads)).toBe(FREE_BASIC_FIRST_AID_PER_MEMBER + Math.round(freeBasicCrewCurve(heads)));
  });

  it("uncapped: a bigger crew keeps adding kits (no ceiling, D23)", () => {
    expect(freeBasicFirstAid(1000)).toBeGreaterThan(freeBasicFirstAid(200));
    expect(freeBasicFirstAid(20000)).toBeGreaterThan(freeBasicFirstAid(1000));
    expect(freeBasicFirstAid(1e6)).toBeGreaterThan(freeBasicFirstAid(20000));
  });

  it("odd input reads as no crew", () => {
    expect(freeBasicFirstAid(-5)).toBe(FREE_BASIC_FIRST_AID_PER_MEMBER);
    expect(freeBasicFirstAid(Number.NaN)).toBe(FREE_BASIC_FIRST_AID_PER_MEMBER);
  });
});

describe("the field device roll (50 to 75% per use, its own salt)", () => {
  it("the salt is odd and 32-bit", () => {
    expect(FIELD_DEVICE_SALT % 2).toBe(1);
    expect(FIELD_DEVICE_SALT).toBe(FIELD_DEVICE_SALT >>> 0);
    expect(FIELD_DEVICE_MIN_PERCENT).toBe(50);
    expect(FIELD_DEVICE_SPAN_PERCENT).toBe(26);
  });

  it("is one integer draw nextInt(26) on (seed ^ salt ^ key)", () => {
    for (const [seed, key] of [[1, 0], [12345, 7], [0xdeadbeef, 991]] as const) {
      expect(fieldDevicePercent(seed, key)).toBe(50 + makeRng((seed ^ FIELD_DEVICE_SALT ^ key) >>> 0).nextInt(26));
    }
  });

  it("always an integer in [50, 75], deterministic per key, and both ends are reached", () => {
    const seen = new Set<number>();
    for (let key = 0; key < 2000; key += 1) {
      const p = fieldDevicePercent(424242, key);
      expect(Number.isInteger(p)).toBe(true);
      expect(p).toBeGreaterThanOrEqual(50);
      expect(p).toBeLessThanOrEqual(75);
      expect(fieldDevicePercent(424242, key)).toBe(p);
      seen.add(p);
    }
    expect(seen.has(50)).toBe(true);
    expect(seen.has(75)).toBe(true);
    expect(seen.size).toBe(26);
  });

  it("Codebreaker aboard adds 6% to the roll: 50 to 75% becomes 53 to 79.5%", () => {
    expect(CODEBREAKER_DEVICE_BONUS).toBe(0.06);
    expect(fieldDeviceRollEffectiveness(50, false)).toBeCloseTo(0.5, 12);
    expect(fieldDeviceRollEffectiveness(75, false)).toBeCloseTo(0.75, 12);
    expect(fieldDeviceRollEffectiveness(50, true)).toBeCloseTo(0.53, 12);
    expect(fieldDeviceRollEffectiveness(75, true)).toBeCloseTo(0.795, 12);
  });

  it("codebreakerAboard reads anyone on the expedition (Security or Science)", () => {
    const member = (memberId: string, traits: string[]): SnapshotMember => ({ memberId, traits }) as unknown as SnapshotMember;
    const roster = (security: SnapshotMember[], science: SnapshotMember[]): AwayRosterSnapshot => ({ security, science }) as AwayRosterSnapshot;
    expect(codebreakerAboard(undefined)).toBe(false);
    expect(codebreakerAboard(roster([member("a", ["steadyAim"])], [member("b", ["keenEye"])]))).toBe(false);
    expect(codebreakerAboard(roster([], [member("b", ["codebreaker"])]))).toBe(true);
    expect(codebreakerAboard(roster([member("a", ["codebreaker"])], []))).toBe(true);
  });
});

describe("Saboteur: +6% on the Saboteur's own grenades only", () => {
  it("the thrower's own throw gets x1.06; anyone else's x1; no stacking", () => {
    expect(SABOTEUR_GRENADE_BONUS).toBe(0.06);
    expect(saboteurGrenadeMult(true)).toBeCloseTo(1.06, 12);
    expect(saboteurGrenadeMult(false)).toBe(1);
  });

  it("isSaboteur reads the member's own traits", () => {
    expect(isSaboteur({ traits: ["saboteur"] })).toBe(true);
    expect(isSaboteur({ traits: ["breacher", "veteran"] })).toBe(false);
    expect(isSaboteur({ traits: [] })).toBe(false);
  });
});

describe("text rules", () => {
  it("labels carry no em dash or double hyphen", () => {
    const texts: string[] = [
      ...FIELD_KIT_IDS.map((id: FieldKitId) => FIELD_KITS[id].label),
      ...CONDITION_LINE_IDS.flatMap((l) => CONDITION_LINES[l].map((r) => r.label)),
    ];
    const EM_DASH = String.fromCharCode(0x2014);
    const DOUBLE_HYPHEN = "-".repeat(2);
    for (const t of texts) {
      expect(t.includes(EM_DASH), t).toBe(false);
      expect(t.includes(DOUBLE_HYPHEN), t).toBe(false);
    }
  });
});
