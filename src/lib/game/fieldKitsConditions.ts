// Field Kits FKR-4 (docs/plans/2026-10-14-field-kits-plan.md REVISED SLICES R3 FKR-4; USER ANSWERS FK6, FK7, FK13, N10,
// N14, 2026-10-15 to 2026-10-17): THE ENEMY INFLICTORS and the squad's Stoneskin battle half, pure. groundFight.ts
// stamps them on a task fight's fresh combatants ONLY on a Field Kits run (fieldKits.ts fieldKitsLive, flag 2); every
// other fight never calls this module, so it fields, draws and resolves exactly as before. The conditions themselves
// (their effects, the bone line's worsening, the turn loss, Cure's basic list, the resist rolls) live in gambit.ts.
//
//   - BRUISERS (FK7, "As proposed"): a HEAVY HIT (a landed strike of HEAVY_HIT_FRACTION or more of the target's max HP)
//     inflicts a Fracture (a bone hit: it starts at Fracture and worsens on repeat hits, user N10) and a Concussion.
//   - STRIKERS (FK7): Hemorrhage on finishing a wounded target (a landed Execute on a low-HP target, the engine has no
//     critical hits), and one FLASH GRENADE each (Blindness, user transcript 70901 answer 1: "Enemy combatants could
//     throw flash grenades and have a chance to cause a turn or two of blindness"), thrown on the Striker's first turn.
//   - CASTERS (FK7, N14 "Challenging and up"): Neurotoxin in place of Poison on a Challenging or harder objective.
//   - SWARM and HOSTILE GARRISONS (FK7, D26 "SOME ENEMIES CAUSE FEAR"): their landed attacks may inflict Fear (a Swarm
//     anywhere; every enemy of a hostile site, riskFactors.ts isHostileSiteId).
//   - STONESKIN (D24, the Ossir perk's battle half): a member whose snapshot carries the perk is stamped `stoneskin`, so
//     a physical status lands 25% less often and lasts 25% longer (gambit.ts STONESKIN_BATTLE_RESIST).
//
// DETERMINISM: no draw here (stamping only). The battle's new rolls (a heavy hit's resist rolls, the flash grenade's hit
// check and rounds, the turn loss) come from the fight's own private stream, and only in a Field Kits run's fights.
//
// Module graph: model (types), gambit (the combatant, the enemy programs), riskFactors (the hostile sites).

import type { GambitProgram, GambitRule, GambitStatusId, SnapshotMember } from "./model";
import { ENEMY_ROLE_PROGRAMS, type GroundCombatant } from "./gambit";
import { isHostileSiteId } from "./riskFactors";

// ===== The inflictors (user FK7 "As proposed", with its numbers) =====

// A heavy hit: a landed strike of at least this share of the target's max HP (FK7's proposal, accepted).
export const HEAVY_HIT_FRACTION = 0.25;
// What a Bruiser's heavy hit inflicts: a bone hit (Fracture first, then worse) and a Concussion.
export const BRUISER_HEAVY_HIT: readonly GambitStatusId[] = ["fracture", "concussion"];
// What a Striker's Execute on a wounded target inflicts.
export const STRIKER_EXECUTE_AFFLICTION: GambitStatusId = "hemorrhage";
// Flash grenades per Striker per battle (FK7: "one flash grenade each").
export const FLASH_GRENADES_PER_STRIKER = 1;
// The rule a Striker throws it by, ahead of its own program: at the squad's biggest threat (its hardest hitter, the
// foe a Blindness costs the most) [PROPOSAL: the target; the user named only the grenade].
export const FLASH_GRENADE_RULE: GambitRule = { target: "foeHighestThreat", action: "flashGrenade" };
// The objective grade a Caster's Poison becomes Neurotoxin from (user N14 "Challenging and up": grade 3 of 1 Simple ..
// 5 Deadly). An unrated objective keeps Poison.
export const NEUROTOXIN_FROM_GRADE = 3;
// The chance, in permille, a Swarm's or a hostile garrison's landed attack inflicts Fear [PROVISIONAL: the user
// named the inflictors (FK7, D26), not the chance; balance pass].
export const FEAR_ON_HIT_PERMILLE = 200;

// What the guard stamping reads about the fight: the objective's stamped grade (1 Simple .. 5 Deadly; absent =
// unrated) and its site.
export interface FieldKitsGuardContext {
  grade: number | undefined;
  poiId: string;
}

// The Striker's program on a Field Kits run: the flash grenade first (it fires only while one is left), then its own.
function strikerProgram(): GambitProgram {
  return [{ ...FLASH_GRENADE_RULE }, ...ENEMY_ROLE_PROGRAMS.striker.map((r) => ({ ...r }))];
}

// Stamp the Field Kits inflictors on a fight's fresh guard (see the header). No draw. Mutates the fresh list it is
// handed and returns it.
export function withFieldKitsGuard(enemies: GroundCombatant[], ctx: FieldKitsGuardContext): GroundCombatant[] {
  const hostile = isHostileSiteId(ctx.poiId);
  const neurotoxin = typeof ctx.grade === "number" && ctx.grade >= NEUROTOXIN_FROM_GRADE;
  for (const e of enemies) {
    if (e.side !== "enemy") continue;
    switch (e.role) {
      case "bruiser":
        e.heavyHit = { fraction: HEAVY_HIT_FRACTION, statuses: [...BRUISER_HEAVY_HIT] };
        break;
      case "striker":
        e.executeAfflicts = STRIKER_EXECUTE_AFFLICTION;
        e.flashGrenades = FLASH_GRENADES_PER_STRIKER;
        e.program = strikerProgram();
        break;
      case "caster":
        if (neurotoxin && e.statusOnHit?.id === "poison") e.statusOnHit = { id: "neurotoxin", permille: e.statusOnHit.permille };
        break;
    }
    if (e.role === "swarm" || hostile) e.onHitStatuses = [...(e.onHitStatuses ?? []), { id: "fear", permille: FEAR_ON_HIT_PERMILLE }];
  }
  return enemies;
}

// Stamp the squad's Field Kits battle traits on a fight's fresh team: Stoneskin on every member whose snapshot carries
// the perk (`members`: the fielded members' snapshots). No draw. Mutates the fresh list it is handed and returns it.
export function withFieldKitsTeam(team: GroundCombatant[], members: readonly SnapshotMember[]): GroundCombatant[] {
  for (const c of team) {
    if (c.memberId === undefined) continue;
    const m = members.find((x) => x.memberId === c.memberId);
    if (m?.perks?.includes("stoneskin")) c.stoneskin = true;
  }
  return team;
}
