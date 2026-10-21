// Field Kits FKR-5 (docs/plans/2026-10-14-field-kits-plan.md REVISED SLICES R3 FKR-5; USER ANSWERS FK10, FK11, group 7,
// N4, N6, N7, 2026-10-16): THE SQUAD'S THROWN GRENADES, pure. groundFight.ts arms a task fight's fresh squad with them
// ONLY on a Field Kits run (fieldKits.ts fieldKitsLive, flag 2); every other fight never calls this module, so it
// fields, draws and resolves exactly as before (each grenade's passive on-hit status included).
//
//   - THROWN, NOT PASSIVE (N7 + N15 "Thrown, spend charges"): on a Field Kits run a grenade no longer applies its
//     status on every strike; a gambit rule throws it ("throwGrenade", gambit.ts), spending one CHARGE. Any other
//     inflict piece the member wears (the Shock Baton's stun) keeps its on-hit roll.
//   - CHARGES (FK11, group 7 "Free, every objective", N4 "Grenades only"): a grenade carries a set number per
//     OBJECTIVE (Impact 4, Stun 2, Toxin 2) plus one per +1 carry capacity line, and 1 throw per BATTLE. A member's
//     charges left this objective ride in on the fight's team (GroundFightTeam.charges, FKR-7 keeps them); absent =
//     full (awayTeam.ts toolCharges). The Med Kit, Shroud Emitter and Lure Beacon carry none.
//   - THE BLAST (N6 "Group blast + Concussion"): the target's group, each body for the thrower's power x the grenade's
//     powerMult, and the grenade's debuff at its chance (the Impact Grenade's fixed 30% Concussion, else the
//     thrower's status chance: THE STATUS-CHANCE RULE).
//   - SABOTEUR (FK10 "Own grenades only"): a Saboteur's OWN throws get x1.06 on the blast's damage and debuff chance
//     (fieldKits.ts saboteurGrenadeMult), never a squadmate's, no stacking.
//   - WEAR (gear wear design, "tools wear by fieldwork"): a throw is never a wear source and charges are never reduced
//     by wear. Gear wear's member-tool efficiency has not landed; when it does it scales powerMult and statusPermille
//     here, never the charges. Training runs apply no wear (W9).
//
// DETERMINISM: no draw here (stamping only). The throw's rolls (one hit check, one damage variance, one debuff chance
// and one resist roll per body hit, in blast order) come from the fight's own private stream, only in a Field Kits
// run's fights.
//
// Module graph: model (types, varieties), gambit (the combatant, the status-chance rule), awayTeam (the charges),
// fieldKits (Saboteur).

import type { GambitStatusId, GrenadeTraits, SnapshotMember } from "./model";
import { EQUIPMENT_SLOTS, MEMBER_SLOT_TYPES, memberVariety } from "./model";
import { memberStatusChance, type GroundCombatant } from "./gambit";
import { memberGrenade, toolCharges } from "./awayTeam";
import { isSaboteur, saboteurGrenadeMult } from "./fieldKits";

const hasOwn = (o: object, k: string): boolean => Object.prototype.hasOwnProperty.call(o, k);

// The grenade family (every member gear variety with a throw: the Impact, Stun and Toxin Grenades), by variety key,
// in catalog order. Read from the varieties themselves, never a second hand-kept table (the wiring registry's GRENADES
// catalog walks it).
export const GRENADES: Readonly<Record<string, GrenadeTraits>> = Object.fromEntries(
  MEMBER_SLOT_TYPES.flatMap((slot) => EQUIPMENT_SLOTS[slot].varieties.flatMap((v) => (v.member?.grenade ? [[v.key, v.member.grenade] as const] : []))),
);
export const GRENADE_IDS: readonly string[] = Object.keys(GRENADES);

// The statuses a member's NON-grenade inflict pieces land on hit (the Shock Baton's stun): what keeps its on-hit roll
// on a Field Kits run. Pure.
export function passiveInflictStatuses(member: Pick<SnapshotMember, "gear">): Set<GambitStatusId> {
  const out = new Set<GambitStatusId>();
  for (const g of member.gear) {
    const traits = memberVariety(g.slotType, g.varietyKey)?.member;
    if (traits?.grenade) continue;
    if (traits?.groundEffect?.kind === "inflict") out.add(traits.groundEffect.status);
  }
  return out;
}

// A member's charges left this objective: the stored count when the team carries one for them (a whole, non-negative
// number), else full. Pure.
export function chargesLeftFor(member: Pick<SnapshotMember, "memberId" | "gear">, chargesLeft?: Readonly<Record<string, number>>): number {
  const full = toolCharges(member);
  if (!chargesLeft || !hasOwn(chargesLeft, member.memberId)) return full;
  const v = chargesLeft[member.memberId];
  return Number.isFinite(v) ? Math.max(0, Math.floor(v)) : full;
}

// Arm a Field Kits fight's fresh squad (see the header): each named member's grenade passive is taken off its on-hit
// rolls, and a member wearing a grenade gets its throw (GroundCombatant.grenade). `members` = the fielded members'
// snapshots; `chargesLeft` = memberId -> charges left this objective (absent = full). No draw. Mutates the fresh list
// it is handed and returns it.
export function withThrownGrenades(
  team: GroundCombatant[],
  members: readonly SnapshotMember[],
  chargesLeft?: Readonly<Record<string, number>>,
): GroundCombatant[] {
  for (const c of team) {
    if (c.memberId === undefined) continue;
    const m = members.find((x) => x.memberId === c.memberId);
    if (!m) continue;
    if (c.onHitStatuses) {
      const kept = passiveInflictStatuses(m);
      const list = c.onHitStatuses.filter((x) => kept.has(x.id));
      if (list.length > 0) c.onHitStatuses = list;
      else delete c.onHitStatuses;
    }
    const worn = memberGrenade(m);
    if (!worn) continue;
    const own = saboteurGrenadeMult(isSaboteur(m));
    const chance = worn.grenade.statusChance ?? memberStatusChance(m);
    c.grenade = {
      status: worn.grenade.status,
      statusPermille: Math.max(0, Math.min(1000, Math.round(chance * own * 1000))),
      powerMult: worn.grenade.powerMult * own,
      charges: chargesLeftFor(m, chargesLeft),
      perBattle: worn.grenade.charges.perBattle,
      used: 0,
    };
  }
  return team;
}
