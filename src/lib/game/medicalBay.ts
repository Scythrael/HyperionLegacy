// Ground Operations 0.14.0 (GO-3; D24, D25; plan docs/plans/2026-10-09-ground-operations-plan.md): the
// MEDICAL BAY's cure-time math and the member PERK hook.
//
// After every task a ground team returns to the ship (offload, medical bay, reload). In the bay every
// condition a member gathered on the trip cures on its own clock and they all tick down AT ONCE, so a member
// waits for their LONGEST condition and the team waits for its longest member (user, D25: "if you have 1000
// ailments and 1 fracture ... you wait for 10 ticks"). Times are in seconds (1 tick = 1 second, user 9b.5).
//
//   care_c = medicalShare + rapidRecoveryShare + officerFacetShare + treatmentShare
//            (+ injurySteady + preventLossShare when the condition's class is "injury"), each share clamped at 0
//            or more
//   t      = cureSeconds x (STONESKIN_INJURY_MULT for an injury on a Stoneskin member, else 1) / (1 + care_c)
//   cure   = max(BAY_MIN_SECONDS, round(t))
// Care DIVIDES (D23: diminishing returns, never a cap): every share point still shortens the cure, each a
// little less than the last; the floor only keeps a cure a whole second.
//
// BAYCARE MAPPING (the FROZEN medical factors this reads; GO-7a freezes them on the run at dispatch, GO-7b
// passes them in; bayCareFrom below is the one place the mapping is written down):
//   medicalShare       = the Medical division's injury buff: crew.reducedCrewLosses from the ship's crew
//                        rollup ("Reduced Crew Losses"; injuries.ts shipInjuryFactors.medicalShare).
//   rapidRecoveryShare = the Rapid Recovery officer bonus: officerBonusTotal(officer.repairRateMult)
//                        (injuries.ts shipInjuryFactors.rapidRecoveryShare).
//   officerFacetShare  = Medical's Constitution facet Expedition.recoveryTurnaround (shorter turnaround)
//                        + Medical's Cunning over-delivery Expedition.quickRecovery (rolled at dispatch).
//                        Applies to EVERY condition class.
//   injurySteady       = Medical's Integrity facet Expedition.injurySteady. Applies to INJURY-class
//                        conditions only (Task 21 review: it steadies members who come home injured).
//   preventLossShare   = the complement's Prevent a Crew Loss (crew.preventCrewLoss; complement plan CP-3, OC-E2
//                        "Shorter bay time"), frozen on GroundOpsFactors.preventLossShare. INJURY-class only.
//   hullInjuryShare    = CP-13, the Tactician quarters perk (injured crew recover 15% faster): INJURY-class only.
//   hullBayShare       = CP-13, the Explorer quarters perk (bay time 10% shorter): every condition class. Both frozen on
//                        GroundOpsFactors at dispatch (crewModules.ts hullFamilyQuartersPerk).
//   treatmentShare     = the per-member Injury Kit share (Field Kits FKR-6 / FKR-7: the trip's GroundTeamRun.treatment,
//                        only for the member it was used on); 0 on a run without field kits.
//
// PERKS: memberPerksFor(race) is the racial physical perk table (D24); awayTeam.ts snapshotMember freezes
// it onto SnapshotMember.perks at dispatch. Stoneskin (Ossir) makes injuries last 25% longer in the bay; its
// in-battle half ("land 25% less often", and 25% longer in battle) is Field Kits FKR-4's (gambit.ts
// STONESKIN_BATTLE_RESIST, a Field Kits run only), which also brings Fracture, Broken Bone, Shattered Bone, Hemorrhage,
// Concussion, Neurotoxin and Blindness into battle.
//
// Module graph: model.ts <- medicalBay.ts (imports model.ts types only). PURE: no state, no randomness.

import type { CrewRace, Expedition, MemberPerkId } from "./model";

// A condition's class (user D25 TERMS): AILMENTS are non-physical debuffs (poisons and so forth), INJURIES
// are physical (fractures, concussion, ...), HEALTH is the hit points lost in the fights of the task.
export type ConditionClass = "health" | "ailment" | "injury";

export interface GroundConditionDef {
  id: string;
  label: string;
  cls: ConditionClass;
  cureSeconds: number; // the bay time with no care and no perks
}

// The conditions the bay cures, user 9b.5 approved times. Classes follow D24's physical list (Fracture,
// Bleed, Hemorrhage, Concussion are bodily) plus D9 (a downed member is injured). [PROVISIONAL, Q6: the
// classes marked below; design section 5 grouped Bleed with the 60 second ailments.] Battle statuses NOT in
// this table (stun, weakened, suppressed, corroded, fear, every buff) END WITH THE BATTLE and need no bay
// time [PROVISIONAL, Q6]; an id this table does not hold is ignored by the bay.
export const GROUND_CONDITIONS: Readonly<Record<string, GroundConditionDef>> = {
  health: { id: "health", label: "Health", cls: "health", cureSeconds: 60 },
  poison: { id: "poison", label: "Poison", cls: "ailment", cureSeconds: 60 },
  bleed: { id: "bleed", label: "Bleed", cls: "injury", cureSeconds: 60 }, // D24 lists Bleed as physical [PROVISIONAL class]
  blindness: { id: "blindness", label: "Blindness", cls: "ailment", cureSeconds: 60 }, // arrives with 16b [PROVISIONAL class]
  neurotoxin: { id: "neurotoxin", label: "Neurotoxin", cls: "ailment", cureSeconds: 300 }, // 16b
  hemorrhage: { id: "hemorrhage", label: "Hemorrhage", cls: "injury", cureSeconds: 300 }, // 16b
  concussion: { id: "concussion", label: "Concussion", cls: "injury", cureSeconds: 900 }, // 16b
  fracture: { id: "fracture", label: "Fracture", cls: "injury", cureSeconds: 1800 }, // 16b (user N11: 30 minutes)
  // Field Kits FKR-4: the bone line's heavier ranks (user N11 "30m / 1h / 2h"). A Shattered Bone is the bay's alone.
  brokenBone: { id: "brokenBone", label: "Broken Bone", cls: "injury", cureSeconds: 3600 },
  shatteredBone: { id: "shatteredBone", label: "Shattered Bone", cls: "injury", cureSeconds: 7200 },
  downed: { id: "downed", label: "Downed", cls: "injury", cureSeconds: 1200 }, // D9: a downed member is injured [PROVISIONAL class]
};

// Stoneskin (D24, user: "if they do land, they last for 25% longer. Imagine trying to mend stone."): an
// injury-class condition on a Stoneskin member takes this much longer in the bay.
export const STONESKIN_INJURY_MULT = 1.25;

// The shortest a cure can be, in seconds (D23 style: care never reaches 0). [PROVISIONAL, Q8: the old
// injury floor was 15 minutes.]
export const BAY_MIN_SECONDS = 1;

// The ship's medical care, frozen at dispatch (see BAYCARE MAPPING in the header).
export interface BayCare {
  medicalShare: number;
  rapidRecoveryShare: number;
  officerFacetShare: number;
  injurySteady: number;
  // Complement plan CP-3 (OC-E2 "Shorter bay time"): Prevent a Crew Loss (crew.preventCrewLoss, the exclusive pool),
  // frozen at dispatch on GroundOpsFactors.preventLossShare. INJURY-class conditions only, like injurySteady. Absent = 0
  // (every run dispatched before CP-3 and every ship without the buff).
  preventLossShare?: number;
  // CP-13 (OC-13): the quarters module's hull-family perk, frozen at dispatch (GroundOpsFactors.hullInjuryShare /
  // hullBayShare): the Tactician's share for INJURY-class conditions, the Explorer's for every condition. Absent = 0.
  hullInjuryShare?: number;
  hullBayShare?: number;
}

// The BayCare a run carries: the ship's two care shares (injuries.ts InjuryRecoveryFactors, frozen at
// dispatch by GO-7a) plus the run's frozen Medical facets (absent = 0). The ONE written-down mapping. Pure.
export function bayCareFrom(
  ship: { medicalShare: number; rapidRecoveryShare: number },
  run: Pick<Expedition, "recoveryTurnaround" | "quickRecovery" | "injurySteady">,
): BayCare {
  return {
    medicalShare: ship.medicalShare,
    rapidRecoveryShare: ship.rapidRecoveryShare,
    officerFacetShare: (run.recoveryTurnaround ?? 0) + (run.quickRecovery ?? 0),
    injurySteady: run.injurySteady ?? 0,
  };
}

const share = (v: number): number => Math.max(0, v);

// The care divisor's share sum for a condition (`injury` its class is "injury"), exactly as conditionCureSeconds folds
// it (the same terms in the same order, so the sum is bit-identical). Pure.
export function bayCareTotal(care: BayCare, injury: boolean, treatmentShare: number = 0): number {
  let total = share(care.medicalShare) + share(care.rapidRecoveryShare) + share(care.officerFacetShare) + share(treatmentShare);
  if (injury) total += share(care.injurySteady);
  if (injury && care.preventLossShare !== undefined) total += share(care.preventLossShare);
  // CP-13: the hull-family perks (absent on every run dispatched before CP-13, so the sum is untouched).
  if (injury && care.hullInjuryShare !== undefined) total += share(care.hullInjuryShare);
  if (care.hullBayShare !== undefined) total += share(care.hullBayShare);
  return total;
}

// CP-13 fix round (review: "the tile says 10% shorter, the bay can give 7%"): what ONE care share `extra` does when
// the condition's other care sums to `others` (both from bayCareTotal). The bay divides by 1 + the sum, so the share
// cuts the time by extra / (1 + others + extra) and speeds the recovery by extra / (1 + others): the same share saves
// a little less the more care is already aboard (D23). With no other care these are the catalog's own numbers. Pure.
export function careShareTimeCut(others: number, extra: number): number {
  return share(extra) / (1 + share(others) + share(extra));
}
export function careShareSpeedUp(others: number, extra: number): number {
  return share(extra) / (1 + share(others));
}

// How long one condition takes to cure in the bay, in whole seconds (see the header). `treatmentShare` is
// the per-member Injury Kit hook (Task 16b); 0 today. Pure.
export function conditionCureSeconds(
  cond: GroundConditionDef,
  perks: readonly MemberPerkId[],
  care: BayCare,
  treatmentShare: number = 0,
): number {
  const injury = cond.cls === "injury";
  const total = bayCareTotal(care, injury, treatmentShare);
  const mult = injury && perks.includes("stoneskin") ? STONESKIN_INJURY_MULT : 1;
  return Math.max(BAY_MIN_SECONDS, Math.round((cond.cureSeconds * mult) / (1 + total)));
}

// The table entry for `id`, or undefined (own keys only, so "toString" and friends are never a condition).
function conditionDef(id: string): GroundConditionDef | undefined {
  return Object.prototype.hasOwnProperty.call(GROUND_CONDITIONS, id) ? GROUND_CONDITIONS[id] : undefined;
}

// One member's bay time: the LONGEST of their conditions (they all tick down at once); 0 for none. An id the
// table does not hold (a battle-only status) is ignored. Pure.
export function memberBaySeconds(
  conditionIds: readonly string[],
  perks: readonly MemberPerkId[],
  care: BayCare,
  treatmentShare: number = 0,
): number {
  let longest = 0;
  for (const id of conditionIds) {
    const def = conditionDef(id);
    if (def) longest = Math.max(longest, conditionCureSeconds(def, perks, care, treatmentShare));
  }
  return longest;
}

// A team's bay time: its LONGEST member (user: "you wait for 10 ticks and you're ready to go"); 0 for an
// empty team or one with nothing to cure. Pure.
export function teamBaySeconds(
  members: readonly { conditionIds: readonly string[]; perks: readonly MemberPerkId[]; treatmentShare?: number }[],
  care: BayCare,
): number {
  let longest = 0;
  for (const m of members) longest = Math.max(longest, memberBaySeconds(m.conditionIds, m.perks, care, m.treatmentShare ?? 0));
  return longest;
}

// The racial physical perks (D24). Only the Ossir have one today (Stoneskin); the user names the other
// races' perks later, so every other race has none. Returns a fresh array. Pure.
const RACE_PERKS: Partial<Record<CrewRace, readonly MemberPerkId[]>> = { ossir: ["stoneskin"] };

export function memberPerksFor(race: CrewRace): MemberPerkId[] {
  return [...(RACE_PERKS[race] ?? [])];
}
