// ============================================================================
// combat/captainEdge.ts: the commanding captain's Tactician talents in a ship battle (WR-5b, 0.14.0)
//
// The battle side of captainTacticianEffects.ts (which reads the nodes and freezes CaptainCombatMods at dispatch /
// per patrol cycle). Two halves:
//   1. The FOLD (applyCaptainCombat, applyCaptainDrones): shipToCombatant and the patrol drone seed call these on a
//      freshly minted player combatant / squadron list, after the officers' fold. Pools and integer stats are scaled
//      and rounded (the codebase's integer-at-the-fold convention); the battle-time edges go on the combatant.
//   2. The BATTLE-TIME helpers resolveBattle and statusEffects call: a projectile's captain damage, a drone hit's,
//      the incoming hit chance, the weapon charge clock, and Bulwark's lethal-hit save.
//
// DETERMINISM: no draw anywhere. Every fractional factor is banked in integer thousandths (a weapon's
// damageCarryMilli, the battle's per-combatant drone carry) or hundredths (a weapon's chargeCarry), so a small
// factor on small integers is exact over a battle instead of rounding to nothing. A combatant or weapon without the
// fields (every enemy, every ship whose captain owns no Tactician node) takes the exact pre-WR-5b path.
// ============================================================================

import type { CaptainCombatMods } from "../model";
import type { Combatant, CombatWeapon } from "./types";
import type { DroneSquadron } from "./drones";

const MILLI = 1000;

// Overcharge (gunnery3) acts while the target's hull is strictly above this share of its pool (plan 5.A: "above
// 50% hull").
export const OVERCHARGE_HULL_SHARE = 0.5;

// The fold onto a fresh player combatant, IN PLACE (the combatant is fresh per call; weapons are replaced with
// copies, so a caller's explicit loadout is never mutated). Absent mods are a no-op. Drones: applyCaptainDrones.
export function applyCaptainCombat(c: Combatant, mods: CaptainCombatMods | undefined): void {
  if (!mods) return;
  const accuracy = mods.accuracy ?? 0;
  const cooldown = mods.cooldown ?? 0;
  const opening = mods.openingVolley ?? 0;
  if (accuracy > 0 || cooldown > 0 || opening > 0) {
    c.weapons = c.weapons.map((w) => ({
      ...w,
      ...(accuracy > 0 ? { accuracy: Math.round(w.accuracy * (1 + accuracy)) } : {}),
      ...(cooldown > 0 ? { chargeRatePct: Math.round(100 * (1 + cooldown)), chargeCarry: 0 } : {}),
      ...(opening > 0 ? { openingVolley: true } : {}),
    }));
  }
  const shield = mods.shield ?? 0;
  if (shield > 0) {
    c.shieldMax = Math.max(0, Math.round(c.shieldMax * (1 + shield)));
    c.shield = c.shieldMax;
    c.shieldRecharge = Math.max(0, Math.round(c.shieldRecharge * (1 + shield)));
  }
  const hull = mods.hull ?? 0;
  if (hull > 0) {
    c.hullMax = Math.max(1, Math.round(c.hullMax * (1 + hull)));
    c.hull = c.hullMax;
  }
  const edge = {
    weaponDamage: Math.max(0, mods.weaponDamage ?? 0),
    highHealthDamage: Math.max(0, mods.highHealthDamage ?? 0),
    openingVolley: Math.max(0, opening),
    droneDamage: Math.max(0, mods.droneDamage ?? 0),
    evasion: Math.max(0, mods.evasion ?? 0),
  };
  if (edge.weaponDamage > 0 || edge.highHealthDamage > 0 || edge.openingVolley > 0 || edge.droneDamage > 0 || edge.evasion > 0) {
    c.captainEdge = edge;
  }
  const bulwark = Math.floor(mods.bulwark ?? 0);
  if (bulwark > 0) c.bulwarkCharges = bulwark;
  c.drones = applyCaptainDrones(c.drones, mods);
}

// The captain's drone nodes on a squadron list (fresh squadrons returned; the input is never mutated): Squadron
// Tactics scales every drone's hit points, Wing Commander the replenish rate (both rounded), and Wolfpack appends
// copies of the FIRST squadron (none without a pod). The same list with no drone node.
export function applyCaptainDrones(squadrons: DroneSquadron[], mods: CaptainCombatMods | undefined): DroneSquadron[] {
  if (!mods || squadrons.length === 0) return squadrons;
  const hp = mods.droneHp ?? 0;
  const replenish = mods.droneReplenish ?? 0;
  const extra = Math.floor(mods.wolfpack ?? 0);
  if (!(hp > 0) && !(replenish > 0) && !(extra > 0)) return squadrons;
  const scaled = squadrons.map((sq) => {
    const droneHp = hp > 0 ? Math.max(1, Math.round(sq.droneHp * (1 + hp))) : sq.droneHp;
    return {
      ...sq,
      droneHp,
      droneReplenishRate: replenish > 0 ? Math.round(sq.droneReplenishRate * (1 + replenish)) : sq.droneReplenishRate,
      drones: sq.drones.map((d) => {
        if (!(hp > 0)) return { ...d };
        const hpMax = Math.max(1, Math.round(d.hpMax * (1 + hp)));
        return { ...d, hpMax, hp: d.alive ? hpMax : d.hp };
      }),
    };
  });
  for (let i = 1; i <= extra; i++) {
    const first = scaled[0];
    scaled.push({ ...first, id: `${first.id}Wolfpack${i}`, cooldownAccumulator: 0, drones: first.drones.map((d) => ({ ...d })) });
  }
  return scaled;
}

// Bank `bonusMilli` thousandths of `raw` into `carry` and return the whole points it pays now. Pure arithmetic on the
// passed carry holder.
function banked(raw: number, bonusMilli: number, carry: { milli: number }): number {
  if (bonusMilli <= 0 || raw <= 0) return 0;
  const total = raw * bonusMilli + carry.milli;
  const whole = Math.floor(total / MILLI);
  carry.milli = total - whole * MILLI;
  return whole;
}

// One weapon projectile's damage with the attacker's captain edges (Weapons Drill, Overcharge against a target above
// half hull, Alpha Strike on the weapon's first shot), each its own factor, banked on the weapon. `raw` unchanged
// without an edge. Mutates only the weapon's carry.
export function captainProjectileDamage(edge: Combatant["captainEdge"], weapon: CombatWeapon, target: Pick<Combatant, "hull" | "hullMax">, raw: number): number {
  if (!edge) return raw;
  let factor = 1 + edge.weaponDamage;
  if (edge.highHealthDamage > 0 && target.hull > OVERCHARGE_HULL_SHARE * target.hullMax) factor *= 1 + edge.highHealthDamage;
  if (edge.openingVolley > 0 && weapon.openingVolley === true) factor *= 1 + edge.openingVolley;
  const bonusMilli = Math.round(factor * MILLI) - MILLI;
  if (bonusMilli <= 0) return raw;
  const carry = { milli: weapon.damageCarryMilli ?? 0 };
  const extra = banked(raw, bonusMilli, carry);
  weapon.damageCarryMilli = carry.milli;
  return raw + extra;
}

// One drone hit's damage with Drone Handler, banked on the battle's per-combatant carry. `raw` unchanged without it.
export function captainDroneDamage(edge: Combatant["captainEdge"], carry: { milli: number }, raw: number): number {
  if (!edge || !(edge.droneDamage > 0)) return raw;
  return raw + banked(raw, Math.round(edge.droneDamage * MILLI), carry);
}

// The hit chance (an integer percent) an enemy shot or drone has against `target`, after Point Defense. Unchanged
// without it.
export function incomingHitChance(target: Pick<Combatant, "captainEdge">, hitChance: number): number {
  const ev = target.captainEdge?.evasion ?? 0;
  return ev > 0 ? Math.round(hitChance / (1 + ev)) : hitChance;
}

// Advance a weapon's cooldown clock by one battle tick of `dtDeciSec`: Ammo Reserves runs it chargeRatePct
// hundredths as fast, carrying the remainder (whole integers only). `dtDeciSec` without the node.
export function chargeWeapon(weapon: CombatWeapon, dtDeciSec: number): void {
  const rate = weapon.chargeRatePct;
  if (rate === undefined || rate === 100) {
    weapon.cooldownAccumulator += dtDeciSec;
    return;
  }
  const units = dtDeciSec * rate + (weapon.chargeCarry ?? 0);
  const whole = Math.floor(units / 100);
  weapon.chargeCarry = units - whole * 100;
  weapon.cooldownAccumulator += whole;
}

// Land `amount` hull-path damage on `target`. Bulwark: a hit that would take a living hull to 0 or below leaves it
// at 1 and spends one charge. Exactly `hull -= amount` without a charge.
export function landHullDamage(target: Pick<Combatant, "hull" | "bulwarkCharges">, amount: number): void {
  if (amount <= 0) return;
  const charges = target.bulwarkCharges ?? 0;
  if (charges > 0 && target.hull > 0 && target.hull - amount <= 0) {
    target.hull = 1;
    target.bulwarkCharges = charges - 1;
    return;
  }
  target.hull -= amount;
}
