// Field Kits FKR-2 (docs/plans/2026-10-14-field-kits-plan.md REVISED SLICES R3 FKR-2, USER ANSWERS 2026-10-15 and
// 2026-10-16): THE FIELD KIT CATALOG, pure. Nothing reads this module yet: FKR-4 (conditions), FKR-5 (grenade
// charges), FKR-6 (kits in battle), FKR-7 (per-member packs and the free basic set) and FKR-8 (the device roll) wire
// it, each flipping its wiring registry entry from pending to live in its own commit.
//
//   - THE SIX KITS (user-named, D20): First Aid Kit, Antitoxin, Combat Stim (First Aid: anyone, 0.5x untrained,
//     1.25x with Medical Training, gambit.ts's constants by import) and Splint, Trauma Kit, Injury Kit (Advanced
//     Medical: Medical Training required, a hard gate).
//   - COVERAGE (group 5, "Proposed coverage" with severity ranks): First Aid Kit clears the basic debuffs (Bleed,
//     Blindness, Weakened, Suppressed, Corroded) plus a small heal; Antitoxin clears Poison; Splint treats a Fracture
//     and a light Broken Bone; Trauma Kit clears Hemorrhage, Neurotoxin, Concussion and a Broken Bone; Combat Stim
//     grants Inspired for 2 rounds; Injury Kit shortens bay time. A Shattered Bone is the medical bay's alone.
//   - SEVERITY RANKS (user 2026-10-15, "In 0.14.0 Field Kits"): Fracture, Broken Bone, Shattered Bone (the user's
//     names), one condition LINE whose rank 1 is the lightest. A kit treats a line up to a rank.
//   - CURE (FK2, "Basic debuffs only"): the medic's free Cure clears BASIC_DEBUFFS only on a Field Kits run (FKR-4).
//   - THE FREE BASIC SET (group 7 "Free basics + your stock", FK3 "Per trip, curved", D23): every objective each
//     member starts with a free set; the ship's Medical and Operations crew add First Aid Kits on an unbounded
//     concave curve, never a cap.
//   - FIELD DEVICES (D20, transcript 70901 / 70979): a device works at a rolled 50 to 75% PER USE, one integer draw
//     on its own salt; Codebreaker anyone on the expedition adds 6% to the roll (FK8: 53 to 79.5%).
//   - SABOTEUR (FK10, "Own grenades only"): +6% on the Saboteur's OWN grenade throws, never squad-wide, no stacking.
//
// [PROVISIONAL] values wait on an open call (plan R4) and live in ONE named constant each; [PROPOSAL] marks what the
// user has not named. DETERMINISM: pure; the only draw is fieldDevicePercent's, on FIELD_DEVICE_SALT (registered in
// salts.test.ts). Module graph: model (types), gambit (first aid constants), diminishing, combat/rng.

import type { AwayRosterSnapshot, AwayTraitId, GambitStatusId } from "./model";
import { FIRST_AID_HEAL, FIRST_AID_TRAINED_EFFECTIVENESS, FIRST_AID_UNTRAINED_EFFECTIVENESS } from "./gambit";
import { diminishing } from "./diminishing";
import { makeRng } from "./combat/rng";

// ===== Ids =====

export type FieldKitId = "firstAidKit" | "antitoxin" | "splint" | "injuryKit" | "traumaKit" | "combatStim";

export const FIELD_KIT_IDS: readonly FieldKitId[] = ["firstAidKit", "antitoxin", "combatStim", "splint", "traumaKit", "injuryKit"];

// The kit categories (D20): First Aid and Advanced Medical are the six kits; Explosives (grenades) and Field Devices
// (Shroud Emitter, Lure Beacon) are installed TOOLS (FK1, "Keep as installed tools") whose rules live here too.
export type KitCategory = "firstAid" | "advancedMedical" | "explosives" | "fieldDevices";

// The conditions Field Kits adds. FKR-4 folds them into model.ts GambitStatusId (with their GAMBIT_STATUSES rows);
// until then this module names them itself so the catalog can say what treats what. Fracture, Hemorrhage, Neurotoxin,
// Concussion and Blindness already have medical bay rows (medicalBay.ts GROUND_CONDITIONS); Broken Bone and Shattered
// Bone get theirs at FKR-4 [PROVISIONAL bay times, open call N11].
export type FieldKitStatusId = "fracture" | "brokenBone" | "shatteredBone" | "hemorrhage" | "neurotoxin" | "concussion" | "blindness";
export type FieldKitConditionId = GambitStatusId | FieldKitStatusId;

// ===== Condition lines and severity ranks =====

// [PROVISIONAL, open call N9] Bone is the only severity line in 0.14.0 (N9 (a), Recommended); Bleed then Hemorrhage
// and Poison then Neurotoxin stay separate conditions unless the user picks (b).
export type ConditionLine = "bone";
export const CONDITION_LINE_IDS: readonly ConditionLine[] = ["bone"];

export interface SeverityRankDef {
  readonly id: FieldKitStatusId;
  readonly label: string; // the player-facing name (the user's)
}

// Each line's ranks, lightest first (index 0 is rank 1). The bone line WORSENS in battle (FKR-4: a bone hit on a member
// already holding a bone condition raises it one rank; [PROVISIONAL, open call N10] it always starts at Fracture).
export const CONDITION_LINES: Readonly<Record<ConditionLine, readonly SeverityRankDef[]>> = {
  bone: [
    { id: "fracture", label: "Fracture" },
    { id: "brokenBone", label: "Broken Bone" },
    { id: "shatteredBone", label: "Shattered Bone" },
  ],
};

export interface Severity {
  readonly line: ConditionLine;
  readonly rank: number; // 1 = the lightest
}

// The line and rank of `status`, or undefined for a condition outside every line. Pure.
export function severityOf(status: FieldKitConditionId): Severity | undefined {
  for (const line of CONDITION_LINE_IDS) {
    const i = CONDITION_LINES[line].findIndex((r) => r.id === status);
    if (i >= 0) return { line, rank: i + 1 };
  }
  return undefined;
}

// ===== Basic debuffs (Cure and First Aid) =====

// What the medic's free Cure clears on a Field Kits run (FK2, "Basic debuffs only"; FKR-4 makes it live): the user's
// basic list (Bleed, Blindness, Weakened, Suppressed, Corroded) plus Poison, which Cure clears and a First Aid Kit
// does not (Antitoxin's job). Stun and Fear stay on it as today [PROVISIONAL, plan FKR-2 "plus stun and fear as
// today"]. Never a serious condition (Hemorrhage, Neurotoxin, Concussion, any bone rank) and never a buff.
export const BASIC_DEBUFFS: readonly FieldKitConditionId[] = ["bleed", "blindness", "weakened", "suppressed", "corroded", "poison", "stun", "fear"];

// A First Aid Kit clears the basic debuffs except Poison (group 5: "First Aid clears basic debuffs (Bleed, Blindness,
// Weakened, Suppressed, Corroded)"; Antitoxin takes Poison). Stun and Fear ride with BASIC_DEBUFFS [PROVISIONAL].
const FIRST_AID_CLEARS: readonly FieldKitConditionId[] = BASIC_DEBUFFS.filter((id) => id !== "poison");

// ===== Category rules =====

export interface KitCategoryRule {
  readonly requiresMedicalTraining: boolean; // a hard gate (D20): an untrained member cannot use it at all
  readonly untrained: number; // effectiveness without Medical Training (0 when gated)
  readonly trained: number; // effectiveness with Medical Training
}

// First Aid: D20 "work for anyone, at reduced effectiveness without training" (0.5) and "something like a 25% or 50%
// boost" with it (1.25), read from gambit.ts. Advanced Medical: Medical Training required, full effect (FK-1).
// Explosives: anyone throws a grenade at full strength (D20 "It doesn't take a true amount of skill"); Saboteur adds
// to the thrower's own throws (saboteurGrenadeMult). Field Devices: anyone, at the rolled 50 to 75% per use
// (fieldDevicePercent), Codebreaker aboard adds 6% (fieldDeviceRollEffectiveness); 1 here, the roll multiplies.
export const KIT_CATEGORY_RULES: Readonly<Record<KitCategory, KitCategoryRule>> = {
  firstAid: { requiresMedicalTraining: false, untrained: FIRST_AID_UNTRAINED_EFFECTIVENESS, trained: FIRST_AID_TRAINED_EFFECTIVENESS },
  advancedMedical: { requiresMedicalTraining: true, untrained: 0, trained: 1 },
  explosives: { requiresMedicalTraining: false, untrained: 1, trained: 1 },
  fieldDevices: { requiresMedicalTraining: false, untrained: 1, trained: 1 },
};

// ===== The kit catalog =====

// How a kit treats a severity line: up to which rank, and how. "clear" removes the condition; "splint" sets a
// Fracture to heal in SPLINT_HEAL_ROUNDS and turns a heavier rank into the rank below it (N8).
export interface LineCare {
  readonly upTo: number;
  readonly mode: "clear" | "splint";
}

export interface FieldKitDef {
  readonly id: FieldKitId;
  readonly label: string; // the user's name
  readonly category: KitCategory;
  readonly clears: readonly FieldKitConditionId[]; // conditions outside any line that one use removes
  readonly lines?: Readonly<Partial<Record<ConditionLine, LineCare>>>;
  readonly heal?: number; // HP one use restores at 1.0 effectiveness
  readonly buff?: { readonly id: GambitStatusId; readonly rounds: number };
  readonly treatmentShare?: number; // the Injury Kit's medical bay share (medicalBay.ts treatmentShare)
}

// Source decision 6 (transcript 70901 answer 4, "Yes."): after a Splint a Fracture heals in 3 rounds. The battle (FKR-6)
// sets its remaining rounds to the lower of this and what it already had.
export const SPLINT_HEAL_ROUNDS = 3;
// Group 5: "Combat Stim Inspired 2 rounds".
export const STIM_INSPIRED_ROUNDS = 2;
// The Injury Kit's bay share (open call 2's proposal, accepted with group 5's coverage: 0.5, bay time / 1.5 for one
// kit). Several kits add their shares in the bay divisor (concave, never zero; open call 11's proposal).
export const INJURY_KIT_TREATMENT_SHARE = 0.5;

export const FIELD_KITS: Readonly<Record<FieldKitId, FieldKitDef>> = {
  firstAidKit: { id: "firstAidKit", label: "First Aid Kit", category: "firstAid", clears: FIRST_AID_CLEARS, heal: FIRST_AID_HEAL },
  antitoxin: { id: "antitoxin", label: "Antitoxin", category: "firstAid", clears: ["poison"] },
  combatStim: { id: "combatStim", label: "Combat Stim", category: "firstAid", clears: [], buff: { id: "inspired", rounds: STIM_INSPIRED_ROUNDS } },
  splint: { id: "splint", label: "Splint", category: "advancedMedical", clears: [], lines: { bone: { upTo: 2, mode: "splint" } } },
  traumaKit: {
    id: "traumaKit",
    label: "Trauma Kit",
    category: "advancedMedical",
    clears: ["hemorrhage", "neurotoxin", "concussion"],
    lines: { bone: { upTo: 2, mode: "clear" } },
  },
  injuryKit: { id: "injuryKit", label: "Injury Kit", category: "advancedMedical", clears: [], treatmentShare: INJURY_KIT_TREATMENT_SHARE },
};

// ===== Gates and effectiveness =====

// The combatant facts a kit rule reads (gambit.ts GroundCombatant carries both).
export interface KitUser {
  readonly medic?: boolean; // Medical Training (D20)
  readonly careMult?: number; // Fleet Triage (Task 20): multiplies first aid, as gambit.ts's Use Item does today
}

// Can `actor` use `kit` at all? Advanced Medical needs Medical Training; everything else is for anyone. Pure.
export function canUseKit(actor: KitUser, kit: FieldKitId): boolean {
  return !KIT_CATEGORY_RULES[FIELD_KITS[kit].category].requiresMedicalTraining || actor.medic === true;
}

// The effectiveness `actor` uses `kit` at: the category's trained or untrained value, 0 when the gate refuses, times
// Fleet Triage's careMult when present. Pure.
export function kitEffectiveness(actor: KitUser, kit: FieldKitId): number {
  if (!canUseKit(actor, kit)) return 0;
  const rule = KIT_CATEGORY_RULES[FIELD_KITS[kit].category];
  const base = actor.medic === true ? rule.trained : rule.untrained;
  return actor.careMult === undefined ? base : base * actor.careMult;
}

// ===== Coverage =====

// The conditions outside every line one use of `kit` removes. Pure.
export function kitClears(kit: FieldKitId): readonly FieldKitConditionId[] {
  return FIELD_KITS[kit].clears;
}

// The highest rank of each line `kit` treats (a line it does not treat is absent; no kit reaches Shattered Bone). Pure.
export function treatsUpTo(kit: FieldKitId): Partial<Record<ConditionLine, number>> {
  const out: Partial<Record<ConditionLine, number>> = {};
  const lines = FIELD_KITS[kit].lines ?? {};
  for (const line of CONDITION_LINE_IDS) {
    const care = lines[line];
    if (care) out[line] = care.upTo;
  }
  return out;
}

// What one use of `kit` does to `condition`: clear it, set it to heal in a few rounds (a splinted Fracture), turn it
// into a lighter rank (a splinted Broken Bone becomes a Fracture: [PROVISIONAL, open call N8] (a), Recommended), or
// null (the kit does not treat it, so a rule naming it does not fire). Buffs are never cleared. Pure.
export type KitTreatment =
  | { readonly kind: "clear" }
  | { readonly kind: "heal"; readonly rounds: number }
  | { readonly kind: "downgrade"; readonly to: FieldKitStatusId };

export function kitTreatment(kit: FieldKitId, condition: FieldKitConditionId): KitTreatment | null {
  const def = FIELD_KITS[kit];
  if (def.clears.includes(condition)) return { kind: "clear" };
  const sev = severityOf(condition);
  if (!sev) return null;
  const care = def.lines?.[sev.line];
  if (!care || sev.rank > care.upTo) return null;
  if (care.mode === "clear") return { kind: "clear" };
  if (sev.rank === 1) return { kind: "heal", rounds: SPLINT_HEAL_ROUNDS };
  return { kind: "downgrade", to: CONDITION_LINES[sev.line][sev.rank - 2].id };
}

// ===== The free basic set (per member, per objective) =====

// [PROVISIONAL, open call N12] (a), Recommended: 1 First Aid Kit per member plus the crew curve, refreshed each
// objective and each reload (FKR-7 refreshes it). (c) would add 1 Antitoxin here.
export const FREE_BASIC_FIRST_AID_PER_MEMBER = 1;

export interface FreeBasicDef {
  readonly base: number; // kits every member gets
  readonly crewCurve: boolean; // the ship's Medical and Operations crew add kits on the D23 curve
}

// The free basic set's contents: a kit id -> its base and whether the crew curve adds to it.
export const FREE_BASIC_SET: Readonly<Partial<Record<FieldKitId, FreeBasicDef>>> = {
  firstAidKit: { base: FREE_BASIC_FIRST_AID_PER_MEMBER, crewCurve: true },
};

// [PROVISIONAL, open call N12] The crew curve: support heads (Medical + Operations headcount, as gambit.ts's team kit
// counts them) per kit at the curve's linear start, and the D23 knee in kits. diminishing(heads / 8, 4): 8 heads add
// about 0.9 kit, 16 about 1.7, 32 about 2.9, 80 about 5.8; it keeps rising without a ceiling (D23, FK3 "the cap of 8
// becomes a D23 diminishing curve").
export const FREE_BASIC_HEADS_PER_KIT = 8;
export const FREE_BASIC_CURVE_KNEE = 4;

// The crew curve's extra kits before rounding (0 for no crew; unbounded, strictly concave). Pure.
export function freeBasicCrewCurve(supportHeads: number): number {
  const heads = Number.isFinite(supportHeads) && supportHeads > 0 ? supportHeads : 0;
  return diminishing(heads / FREE_BASIC_HEADS_PER_KIT, FREE_BASIC_CURVE_KNEE);
}

// One member's free basic set for one objective: each kit's base, plus the rounded crew curve where it applies.
// Whole kits, never decreasing as the crew grows, no cap. Pure.
export function freeBasicSet(supportHeads: number): Partial<Record<FieldKitId, number>> {
  const extra = Math.round(freeBasicCrewCurve(supportHeads));
  const out: Partial<Record<FieldKitId, number>> = {};
  for (const id of FIELD_KIT_IDS) {
    const def = FREE_BASIC_SET[id];
    if (def) out[id] = def.base + (def.crewCurve ? extra : 0);
  }
  return out;
}

// The free First Aid Kits one member starts an objective with. Pure.
export function freeBasicFirstAid(supportHeads: number): number {
  return freeBasicSet(supportHeads).firstAidKit ?? 0;
}

// ===== Field devices: the per-use roll =====

// The per-use device roll's own stream (odd, distinct, registered in salts.test.ts). Never a draw on a shared stream.
export const FIELD_DEVICE_SALT = 0x3a9d5c27;
// D20 (transcript 70901 answer 3, corrected at 70979): "a chance between 50-75%", rolled per use.
export const FIELD_DEVICE_MIN_PERCENT = 50;
export const FIELD_DEVICE_SPAN_PERCENT = 26; // nextInt(26): 0..25, so 50..75 inclusive
// FK8 "+6% to the roll": anyone on the expedition with Codebreaker, x1.06 (53 to 79.5%).
export const CODEBREAKER_DEVICE_BONUS = 0.06;
export const CODEBREAKER_TRAIT_ID: AwayTraitId = "codebreaker";

// One use's rolled percent, an integer in [50, 75]: one nextInt on makeRng((seed ^ FIELD_DEVICE_SALT ^ key) >>> 0).
// FKR-8 keys it by the use (the boundary the device is read at). Pure.
export function fieldDevicePercent(seed: number, key: number): number {
  return FIELD_DEVICE_MIN_PERCENT + makeRng((seed ^ FIELD_DEVICE_SALT ^ key) >>> 0).nextInt(FIELD_DEVICE_SPAN_PERCENT);
}

// The device's effectiveness for one use: the rolled percent as a fraction, x (1 + CODEBREAKER_DEVICE_BONUS) with a
// Codebreaker aboard. Pure.
export function fieldDeviceRollEffectiveness(percent: number, codebreakerIsAboard: boolean): number {
  const f = percent / 100;
  return codebreakerIsAboard ? f * (1 + CODEBREAKER_DEVICE_BONUS) : f;
}

// Is a Codebreaker anywhere on the expedition (Security or Science, FK-M1 "anyone on the expedition")? Pure.
export function codebreakerAboard(roster: AwayRosterSnapshot | undefined): boolean {
  if (!roster) return false;
  return [...roster.security, ...roster.science].some((m) => m.traits.includes(CODEBREAKER_TRAIT_ID));
}

// ===== Saboteur: the thrower's own grenades =====

// FK10 "Own grenades only": +6% to the Saboteur's own throws (damage and debuff chance, FKR-5), never the squad's.
export const SABOTEUR_GRENADE_BONUS = 0.06;
export const SABOTEUR_TRAIT_ID: AwayTraitId = "saboteur";

// Does this member carry Saboteur? Pure.
export function isSaboteur(member: { readonly traits: readonly AwayTraitId[] }): boolean {
  return member.traits.includes(SABOTEUR_TRAIT_ID);
}

// The multiplier on one grenade throw: x1.06 when the THROWER is a Saboteur, else 1. One bonus, no stacking. Pure.
export function saboteurGrenadeMult(throwerIsSaboteur: boolean): number {
  return throwerIsSaboteur ? 1 + SABOTEUR_GRENADE_BONUS : 1;
}

// ===== The flag =====

// The catalog version a Field Kits run is stamped with (Expedition.fieldKits.catalog, FKR-7). Bump it when a kit's
// numbers or coverage change, and keep the old version's rules for runs stamped with it.
export const FIELD_KITS_CATALOG_VERSION = 1;
