// Field Kits FKR-6 (docs/plans/2026-10-14-field-kits-plan.md REVISED SLICES R3 FKR-6; USER ANSWERS FK2, FK4, FK11, FK12,
// group 5, group 7, N8, N15, calls 15, 16 and 18): KITS IN BATTLE, pure. groundFight.ts reads this module ONLY on a Field
// Kits run (fieldKits.ts fieldKitsLive, flag 2); every other fight never calls it, so it fields, draws and resolves
// exactly as before (a Use Item spending the team kit, D19's default program).
//
//   - PER MEMBER (FK4 "One per member"): each fielded member carries their OWN kits: the objective's free basic set
//     (group 7 "Free basics + your stock") and the extras they packed. A Use Item spends one from the ACTOR's own
//     carry, a free basic first, then an extra (gambit.ts spendKit; user 2026-10-20 "Approve all"). FKR-7 passes both
//     counts on the fight's team (GroundFightTeam.basics / .kits); a member without an entry carries none.
//   - WHICH KIT: a Use Item rule names one (GambitRuleParams.kitId); a rule naming none means the First Aid Kit (call
//     15, user 2026-10-17 "Means First Aid Kit").
//   - FIRES ONLY WHEN IT CAN DO SOMETHING (FK-M5 "A rule asking for a kit that member can't use simply doesn't fire"):
//     the actor may use the kit (Advanced Medical needs Medical Training, D20), carries one, and the target needs it:
//       First Aid Kit, Antitoxin : a condition on its list (group 5), cut at the first aid effectiveness (0.5x untrained,
//                                  1.25x with Medical Training, Fleet Triage on top; the existing applyFirstAid math),
//                                  the First Aid Kit's small heal riding the cleanse;
//       Combat Stim              : a standing ally without Inspired: Inspired for 2 rounds x the effectiveness, at least 1
//                                  (user 2026-10-20 "Approve all": the rounds scale with skill);
//       Splint                   : a Fracture not yet splinted (it now heals in 3 rounds, source decision 6) or a Broken
//                                  Bone (it becomes a Fracture, N8); never a Shattered Bone;
//       Trauma Kit               : Hemorrhage, Neurotoxin, Concussion, a Fracture or a Broken Bone (one use clears every
//                                  one the target holds, or the one the rule names);
//       Injury Kit               : a DOWNED ally ("Ally downed") not yet treated this battle: its bay share (0.5) goes on
//                                  the record (`treated`; one per downed member per battle, user 2026-10-20); FKR-7
//                                  sums it into the trip and the medical bay reads it.
//   - THE DEFAULT PROGRAM (N15): a member whose program is D19's default runs model.ts FIELD_KITS_DEFAULT_MEMBER_GAMBIT
//     on a Field Kits run (it throws grenades, keeping one for an Elite or a Boss; still no automatic kit use).
//   - SPLINTED FRACTURE (call 18, "No Fracture bay time"): a Fracture healing from a Splint (SPLINT_HEAL_ROUNDS left or
//     fewer) is no bay condition (groundFight.ts memberEndConditions).
//   - ODDS (FK12 "Yes, count packs"): the threat samples field the same packs and charges, spending them fight by fight
//     (fightSuppliesAfter, which FKR-7's run bookkeeping reuses).
//
// DETERMINISM: no draw anywhere here; every kit effect is arithmetic on stored values.
//
// Module graph: model (types, the default programs), gambit (the combatant, the battle hooks), fieldKits (the catalog),
// fieldKitsGrenades (the charges), memberGambits (program equality).

import type { GambitProgram, GambitStatusId, GroundFightRecord, GroundStatus, SnapshotMember } from "./model";
import { DEFAULT_MEMBER_GAMBIT, FIELD_KITS_DEFAULT_MEMBER_GAMBIT } from "./model";
import { GAMBIT_STATUSES, applyStatus, hasStatus, type BattleKitRules, type CombatantKits, type GroundCombatant } from "./gambit";
import { FIELD_KITS, FIELD_KIT_IDS, canUseKit, kitEffectiveness, kitTreatment, type FieldKitId } from "./fieldKits";
import { chargesLeftFor } from "./fieldKitsGrenades";
import { gambitProgramEquals } from "./memberGambits";

const hasOwn = (o: object, k: string): boolean => Object.prototype.hasOwnProperty.call(o, k);

// Call 15 (user 2026-10-17, "Means First Aid Kit"): the kit a Use Item rule naming none spends on a Field Kits run.
export const LEGACY_USE_ITEM_KIT: FieldKitId = "firstAidKit";

// ===== The kit rules (injected into the battle) =====

// Does one use of `kit` treat status `s`? A kit treats a condition it clears or a line rank it reaches (fieldKits.ts
// kitTreatment); a Splint's heal treats a Fracture only while it has more rounds left than the heal sets (a Fracture
// already splinted needs no second one). Pure.
function treatsStatus(kit: FieldKitId, s: GroundStatus): boolean {
  const t = kitTreatment(kit, s.id);
  if (!t) return false;
  return t.kind !== "heal" || s.remaining > t.rounds;
}

// Would one use of `kit` by `actor` do something to `target` (see the header)? Pure.
export function kitUsable(kit: FieldKitId, actor: GroundCombatant, target: GroundCombatant, statusId?: GambitStatusId): boolean {
  if (!canUseKit(actor, kit) || target.side !== actor.side) return false;
  const def = FIELD_KITS[kit];
  if (def.treatmentShare !== undefined) return target.downed && target.memberId !== undefined && target.injuryTreated === undefined;
  if (target.downed) return false;
  if (def.buff) return !hasStatus(target, def.buff.id);
  return target.statuses.some((s) => (statusId === undefined || s.id === statusId) && treatsStatus(kit, s));
}

// One use of `kit` by `actor` on `target`, IN PLACE (see the header; the kit is already spent). No rng.
export function applyKit(kit: FieldKitId, actor: GroundCombatant, target: GroundCombatant, statusId?: GambitStatusId): void {
  const def = FIELD_KITS[kit];
  const eff = kitEffectiveness(actor, kit);
  if (def.treatmentShare !== undefined) {
    target.injuryTreated = (target.injuryTreated ?? 0) + def.treatmentShare * eff;
    return;
  }
  if (def.buff) {
    applyStatus(target, def.buff.id, undefined, Math.max(1, Math.round(def.buff.rounds * eff)));
    return;
  }
  const targeted = (s: GroundStatus): boolean => (statusId === undefined || s.id === statusId) && treatsStatus(kit, s);
  if (def.category === "firstAid") {
    // The first aid cut (gambit.ts applyFirstAid's math on the kit's own list): each targeted condition loses
    // ceil(remaining x effectiveness) rounds and is pruned at 0; the heal rides the cleanse.
    let cut = false;
    target.statuses = target.statuses
      .map((s) => {
        if (!targeted(s)) return s;
        cut = true;
        return { ...s, remaining: s.remaining - Math.ceil(s.remaining * eff) };
      })
      .filter((s) => s.remaining > 0);
    if (cut && def.heal !== undefined) target.hp = Math.min(target.hpMax, target.hp + Math.round(def.heal * eff));
    return;
  }
  // Advanced Medical (a Medical Training member, full effect): clear, splint (heal in a few rounds) or downgrade.
  const out: GroundStatus[] = [];
  for (const s of target.statuses) {
    const t = targeted(s) ? kitTreatment(kit, s.id) : null;
    if (!t) out.push(s);
    else if (t.kind === "heal") out.push({ ...s, remaining: Math.min(s.remaining, t.rounds) });
    else if (t.kind === "downgrade") out.push({ id: t.to, magnitude: GAMBIT_STATUSES[t.to].magnitude, remaining: s.remaining });
    // "clear": dropped
  }
  target.statuses = out;
}

// The kit rules a Field Kits battle reads (gambit.ts resolveGroundBattle's `kitRules`).
export const FIELD_KITS_BATTLE: BattleKitRules = { legacyKit: LEGACY_USE_ITEM_KIT, usable: kitUsable, apply: applyKit };

// ===== Arming the squad =====

// A member's kit counts from a stored record: whole, non-negative, known kits only (a stray key or a non-finite count
// reads as none). Pure.
function cleanCounts(raw: Readonly<Partial<Record<string, number>>> | undefined): Partial<Record<FieldKitId, number>> {
  const out: Partial<Record<FieldKitId, number>> = {};
  if (!raw) return out;
  for (const id of FIELD_KIT_IDS) {
    const v = hasOwn(raw, id) ? raw[id] : undefined;
    if (typeof v === "number" && Number.isFinite(v) && v >= 1) out[id] = Math.floor(v);
  }
  return out;
}

// What a fight's teams carry (memberId -> kit -> count), merged over its teams (each member sits on one team).
export type MemberKitCounts = Readonly<Record<string, Readonly<Partial<Record<FieldKitId, number>>>>>;

// Arm a Field Kits fight's fresh squad with its kits: every named member gets a pack (GroundCombatant.kits), its free
// basics from `basics` and its extras from `extras` (a member without an entry carries none). No draw. Mutates the
// fresh list it is handed and returns it.
export function withFieldKitPacks(team: GroundCombatant[], basics?: MemberKitCounts, extras?: MemberKitCounts): GroundCombatant[] {
  for (const c of team) {
    const id = c.memberId;
    if (id === undefined) continue;
    const pack: CombatantKits = {
      basics: cleanCounts(basics && hasOwn(basics, id) ? basics[id] : undefined),
      extras: cleanCounts(extras && hasOwn(extras, id) ? extras[id] : undefined),
      basicsUsed: {},
      extrasUsed: {},
    };
    c.kits = pack;
  }
  return team;
}

// N15: a member whose program IS D19's default runs the Field Kits default (it throws grenades, keeping one for a
// Boss) in a Field Kits fight. A member with a program of their own keeps it. Mutates the fresh list, returns it.
export function withFieldKitsDefaultProgram(team: GroundCombatant[]): GroundCombatant[] {
  for (const c of team) {
    if (c.program && gambitProgramEquals(c.program, DEFAULT_MEMBER_GAMBIT)) c.program = cloneProgram(FIELD_KITS_DEFAULT_MEMBER_GAMBIT);
  }
  return team;
}

function cloneProgram(p: readonly GambitProgram[number][]): GambitProgram {
  return p.map((r) => (r.params ? { ...r, params: { ...r.params } } : { ...r }));
}

// ===== Supplies across an objective's fights =====

// The supplies a fight's team carries into its NEXT fight of the objective: its charges, free basics and extras left,
// minus what the fight's record says each of its members spent. Members the record does not name keep what they had;
// a team the fight spent nothing from comes back as the SAME object. `roster` = the run's Security snapshots (a
// member's full charges when the team carries no count for them). Pure. FKR-7's run bookkeeping reads it too.
export interface FightSupplies {
  readonly securityIds: readonly string[];
  readonly charges?: Readonly<Record<string, number>>;
  readonly basics?: MemberKitCounts;
  readonly kits?: MemberKitCounts;
}
export function fightSuppliesAfter<T extends FightSupplies>(
  team: T,
  record: Pick<GroundFightRecord, "chargesUsed" | "basicsUsed" | "kitsUsed">,
  roster: readonly SnapshotMember[] | undefined,
): T {
  let charges: Record<string, number> | undefined;
  let basics: Record<string, Partial<Record<FieldKitId, number>>> | undefined;
  let kits: Record<string, Partial<Record<FieldKitId, number>>> | undefined;
  const less = (held: Readonly<Partial<Record<FieldKitId, number>>> | undefined, used: Partial<Record<FieldKitId, number>>) => {
    const left = cleanCounts(held);
    for (const id of FIELD_KIT_IDS) {
      const n = used[id] ?? 0;
      if (n > 0) left[id] = Math.max(0, (left[id] ?? 0) - n);
    }
    return left;
  };
  for (const id of team.securityIds) {
    const thrown = record.chargesUsed?.[id] ?? 0;
    if (thrown > 0) {
      const member = roster?.find((m) => m.memberId === id);
      if (member) {
        charges ??= { ...(team.charges ?? {}) };
        charges[id] = Math.max(0, chargesLeftFor(member, team.charges) - thrown);
      }
    }
    const b = record.basicsUsed?.[id];
    if (b) {
      basics ??= { ...(team.basics ?? {}) };
      basics[id] = less(team.basics?.[id], b);
    }
    const k = record.kitsUsed?.[id];
    if (k) {
      kits ??= { ...(team.kits ?? {}) };
      kits[id] = less(team.kits?.[id], k);
    }
  }
  if (!charges && !basics && !kits) return team;
  return { ...team, ...(charges ? { charges } : {}), ...(basics ? { basics } : {}), ...(kits ? { kits } : {}) };
}
