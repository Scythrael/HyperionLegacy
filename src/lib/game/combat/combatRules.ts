// ============================================================================
// combat/combatRules.ts: the WR-8 combat descriptors (0.14.0, wiring plan docs/plans/2026-10-15-wiring-registry-and-
// audit-plan.md section 4 WR-8; user answers OC-D9 "Enemies start at range (Recommended)" and OC-D12 "Feed them all
// (Recommended)").
//
// Before WR-8 every battle opened with both sides at position 0, so weapon and drone range, stance (the stance the
// player picks per patrol included), speed, Sensor Power Drain, Coolant Leak and the FTL speed penalty could never
// change a fight (bug B3), and a set of combat inputs had a consumer but no source (anti-drone fire, Inhibit,
// Overcharged Capacitors, drone disruption, enemy armor and evasion, the pod counters, the per-family resists).
// WR-8 gives each one a source and a reader:
//
//   - Fights open at range (ENCOUNTER_OPEN_DISTANCE) and close; patrols pre-charge their guns like the ship events.
//   - A ship holds at its stance's distance, but never farther than its own longest reach (a ship with only short
//     guns closes whatever its stance), and only a FASTER ship can open the range on its target (kiting needs a speed
//     edge; an equal or slower ship holds). So stance, range and speed all matter, and every fight still closes
//     unless one side is faster.
//   - A ship's combat speed comes from its transit speed (the gear, crew, captain and mass that move it), relative to
//     its hull's own base, so every Standard-Issue ship maneuvers like a pirate hull (combatSpeedFor).
//   - Anti-drone fire (Point Defense, EMP), Point Defense's Inhibit, the Tachyon vs-shields exception and the Voltaic
//     arc are TRAITS added to a weapon when it is built under the rules (WEAPON_RULE_TRAITS); the vs-Drones triangle
//     column, the EW drone disruption and the support drones' Overcharged Capacitors act under the rules too.
//   - Pirate hulls carry armor and evasion (PIRATE_HULLS, applied under the rules), and the player's status effects
//     persist across the waves of one patrol cycle.
//   - The installed Reactor Core and FTL drive set the combat reactor and drive pools (their quality: a bigger pool and
//     a lower wear chance), instead of a fresh quality 0 system.
//   - E-MOD EM-3 (0.14.0): an over-budget ship fights at its power supply (combat/power.ts powerSupplyPercent), frozen in
//     the stamp beside its speed; a ship in budget carries no supply, so its stamp is the WR-8 one exactly.
//
// IN-FLIGHT RUNS ARE BYTE-IDENTICAL: every rule above acts only on a battle whose run carries a CombatRulesStamp. A
// patrol cycle is stamped when it starts (dispatch, and each relaunch), an expedition's ship-event battle inputs at
// dispatch, and the dispatch forecast reads the stamp a dispatch would write now. A run in flight before WR-8 fights
// exactly as it did until its next cycle. Gear-driven lines (the resist and pod lines) need no stamp: no ship out on a
// run can install a piece (S1/S2 gear lock), and no piece rolled them before WR-8.
//
// Pure data and pure helpers; no draw happens here.
// ============================================================================

import type { CombatWeapon, WeaponFamily } from "./types";
import type { WeaponEffect } from "./statusEffects";
import type { WeaponId } from "./weapons";
import { BAND_LONG } from "./positioning";

// The rules version a run is stamped with (1 = WR-8). A later combat rules change bumps it so a run keeps the rules
// it was dispatched under.
export const COMBAT_RULES_WR8 = 1 as const;

// The stamp a run carries (PatrolMissionState.combatRules, ShipEventBattle.combatRules), frozen when the cycle (or the
// run) starts (D24 freeze at dispatch):
//   speed         : the ship's combat speed (combatSpeedFor).
//   reactorQuality: the installed Reactor Core's quality, the combat reactor pool's (written only when above 0).
//   ftlQuality    : the installed FTL drive's quality, the combat drive pool's (written only when above 0).
//   powerSupplyPercent: E-MOD EM-3 (0.14.0, user answer P6 "sqrt curve, floor 60%"): the power supply an over-budget
//                   ship fights at (combat/power.ts powerSupplyPercent: its pristine output against its net draw), its
//                   weapon damage and shield recharge in whole percent. Written only when below 100, so a ship in budget
//                   carries exactly the stamp it carried before EM-3, and a run stamped before EM-3 (no field) fights
//                   at 100 until its next cycle: in-flight runs replay byte-identically.
//   enemyTorpedoes: WR-8b (0.14.0, user 2026-11-10 "Simple now"): the run's enemies carry torpedoes (the Concussion
//                   Torpedo, a missile): every Corsair Carrier, a Marauder at its ramped chance (combat/patrolProfile.ts
//                   patrolMarauderTorpedoPermille), a ship event's vessel at its tier's chance (shipScanEvents.ts
//                   shipEventTorpedoPermille). Written on every new stamp, so a run stamped before WR-8b (no field)
//                   fights the loadouts it always did until its next cycle: in-flight runs replay byte-identically.
export interface CombatRulesStamp {
  rules: typeof COMBAT_RULES_WR8;
  speed: number;
  reactorQuality?: number;
  ftlQuality?: number;
  powerSupplyPercent?: number;
  enemyTorpedoes?: 1;
}

// TEST-ONLY off switch (combatRulesSwitch.fixture.ts withCombatRulesOff): while false, no new run is stamped and the
// rules' catalog lines stay out of the craft pools, so a golden computed inside the switch is the pre-WR-8 game
// exactly. Always true in the app.
export const COMBAT_RULES_SWITCH: { stampNewRuns: boolean } = { stampNewRuns: true };

// TEST-ONLY off switch for E-MOD EM-3 (emodEm3Switch.fixture.ts withPowerSupplyOff): while false, no new stamp carries
// a power supply, so a run starting inside the switch is a run stamped before EM-3 exactly. Always true in the app.
export const POWER_SUPPLY_SWITCH: { stampNewRuns: boolean } = { stampNewRuns: true };

// TEST-ONLY off switch for WR-8b (enemyTorpedoSwitch.fixture.ts withEnemyTorpedoesOff): while false, no new stamp
// carries enemyTorpedoes, so a run starting inside the switch is a run stamped before WR-8b exactly. Always true in the
// app.
export const ENEMY_TORPEDO_SWITCH: { stampNewRuns: boolean } = { stampNewRuns: true };

// The stamp a run starting now carries for a ship of combat speed `speed`, the installed system qualities and the
// power supply percent (undefined while the test switch is off).
export function newCombatRulesStamp(speed: number, reactorQuality = 0, ftlQuality = 0, powerSupplyPercent = 100): CombatRulesStamp | undefined {
  if (!COMBAT_RULES_SWITCH.stampNewRuns) return undefined;
  return {
    rules: COMBAT_RULES_WR8,
    speed,
    ...(reactorQuality > 0 ? { reactorQuality } : {}),
    ...(ftlQuality > 0 ? { ftlQuality } : {}),
    ...(POWER_SUPPLY_SWITCH.stampNewRuns && powerSupplyPercent < 100 ? { powerSupplyPercent } : {}),
    ...(ENEMY_TORPEDO_SWITCH.stampNewRuns ? { enemyTorpedoes: 1 as const } : {}),
  };
}

// ===== WR-8b: enemy torpedoes (user 2026-11-10, "Simple now, rest logged (Recommended)") =====
// The torpedo an enemy carries: the Concussion Torpedo (weapons.ts), a missile (WEAPON_RULE_TRAITS below), so a
// Defensive ship's working Point Defense or EMP can shoot it down (DEFENSIVE_STANCE.missileInterceptPct).
export const ENEMY_TORPEDO: WeaponId = "concussionTorpedo";
// [PROVISIONAL] The Marauder's chance to carry a torpedo at the top of the patrol ramp (full strength: a veteran, the
// curve at its top), in whole permille. User: "Perhaps give them a chance to have them. Spice up earlier tiers." The
// chance climbs the patrol ramp the way the WR-10 casters' Corroded climbs the expedition odds ramp (one run behind
// the enemy curve, runDifficulty.ts rampOddsFraction, rampedChance): 0 on the first two ramped patrols, never on the
// training patrol.
export const MARAUDER_TORPEDO_PERMILLE = 400;
// [PROVISIONAL] A ship event vessel's (the Hostile Probe's, the Cloaked Vessel's) chance to carry a torpedo, by the
// run's expedition tier, in whole permille. User: "Starting off a bit more generous, but as you go up in tier ...
// enemies become far more dangerous." Gentle at Tier I (and on the Tier I ramp, x the run's odds ramp, so 0 on the
// first ramped runs), rising each tier. Never on the training run (it fights no battle). A ship event has no stance, so
// no point defense shoots these down (the user accepted that).
export const SHIP_EVENT_TORPEDO_PERMILLE_BY_TIER: Readonly<Record<1 | 2 | 3 | 4 | 5 | 6 | 7, number>> = {
  1: 50,
  2: 150,
  3: 250,
  4: 350,
  5: 450,
  6: 550,
  7: 650,
};
// The draw a torpedo chance in permille is rolled against (one nextInt draw, below the chance: carried).
export const TORPEDO_ROLL_UNITS = 1000;

// The shipToCombatant arguments a combatant built under `stamp` takes (its traits, speed, system pools and, when the
// stamp carries one, its power supply). Pure.
export function stampCombatArgs(stamp: CombatRulesStamp): {
  combatRules: true;
  speed: number;
  systemQuality: { reactor: number; ftl: number };
  powerSupplyPercent?: number;
} {
  return {
    combatRules: true,
    speed: stamp.speed,
    systemQuality: { reactor: stamp.reactorQuality ?? 0, ftl: stamp.ftlQuality ?? 0 },
    ...(stamp.powerSupplyPercent !== undefined ? { powerSupplyPercent: stamp.powerSupplyPercent } : {}),
  };
}

// [PROVISIONAL] (OC-D9, the plan's recommended option: "enemies spawn at range and close"): the distance a fight opens
// at, the player at 0 and the enemy side here. The long band's edge, so the longest guns (railgun, torpedo, graviton)
// can open the fight and every shorter gun has to close first.
export const ENCOUNTER_OPEN_DISTANCE = BAND_LONG;

// The combat speed a combatant built without the rules flies with (position units per second): the pre-WR-8
// placeholder every co-located battle carried (moot there: nobody moves at position 0 vs 0).
export const DEFAULT_COMBAT_SPEED = 10;

// [PROVISIONAL] (OC-D9): the combat speed under the rules, enemies' and a Standard-Issue player ship's alike: 3
// position units a tick, so closing from ENCOUNTER_OPEN_DISTANCE to the short band takes about 3 s when both sides
// close and about 7 s when one side holds. The approach is felt (the longest guns open the fight) without deciding it.
export const RULES_COMBAT_SPEED = 30;

// [PROVISIONAL] (OC-D9 "speed matters"; ShipDerivedStats in combat, OC-D12): a ship's combat speed is
// RULES_COMBAT_SPEED x its transit speed / its hull's base transit speed, so a Standard-Issue ship maneuvers like the
// pirate hulls, and the transit speed lines, crew, captain and mass (its drag is already in the sheet's transit speed)
// move it. Alternative for the user: absolute (RULES_COMBAT_SPEED x transit speed: hull identity, a Runner outpaces
// the pirates and a Battleship is outpaced by them). Whole units, at least 1. Pure.
export function combatSpeedFor(sheetTransitSpeedMult: number, hullBaseTransitSpeedMult: number): number {
  if (!(hullBaseTransitSpeedMult > 0) || !Number.isFinite(sheetTransitSpeedMult)) return RULES_COMBAT_SPEED;
  return Math.max(1, Math.round((RULES_COMBAT_SPEED * sheetTransitSpeedMult) / hullBaseTransitSpeedMult));
}

// The design's "vs Drones" triangle column (design S3: Kinetic -10%, EW +10%, Particle 0%), integer percents applied
// to the damage a drone takes when it absorbs a shot under the rules.
export const FAMILY_VS_DRONES: Record<WeaponFamily, number> = {
  kinetic: 90,
  particle: 100,
  ew: 110,
};

// [PROVISIONAL] (OC-D12 "damageResist / disruptionResist lines on plating and emitters"; D23): the summed resist
// points of one family across the installed gear become a percent on a hyperbolic curve that approaches 100 and never
// reaches it (points / (points + knee)): 50 points = 50%. Whole percents rounded DOWN, so no amount of points ever
// reaches 100 (immunity): the curve tops out at 99. No hard cap below that: more points never resist less.
export const FAMILY_RESIST_KNEE = 50;
export function familyResistPercent(points: number): number {
  if (!(points > 0)) return 0;
  // (The min only guards float precision at absurd point counts, where points + knee rounds to points.)
  return Math.min(99, Math.floor((100 * points) / (points + FAMILY_RESIST_KNEE)));
}

// [PROVISIONAL] (OC-D12 "rapid charge, in-combat replenish and smart reflect as drone pod lines"; D23): a pod line's
// points become a share in [0, 1) on the same hyperbolic curve: 20 points = half. In-combat replenish is that share of
// the squadron's replenish rate during the fight; smart reflect is the chance a reflected shot seeks the weakest foe;
// rapid charge closes that share of the gap between the ambush return-fire delay and the rapid-charge delay.
export const POD_LINE_KNEE = 20;
export function podLineShare(points: number): number {
  if (!(points > 0)) return 0;
  return points / (points + POD_LINE_KNEE);
}

// The three pod line keys (rolled by crafted drone pods, itemgen.ts DRONE_POD_AFFIX_POOL), and the role each one is
// for: smart reflect only matters on a Defense pod (only Defense drones reflect), so only a Defense pod rolls it.
export const POD_LINE_REPLENISH = "droneInCombatReplenish";
export const POD_LINE_SMART_REFLECT = "droneSmartReflect";
export const POD_LINE_RAPID_CHARGE = "droneRapidCharge";

// The six per-family resist line keys: plating rolls the damage resists, emitters the disruption resists (bridge.ts
// sumFamilyResist reads them off every installed piece).
export const PLATING_RESIST_LINES = ["damageResist_kinetic", "damageResist_particle", "damageResist_ew"] as const;
export const EMITTER_RESIST_LINES = ["disruptionResist_kinetic", "disruptionResist_particle", "disruptionResist_ew"] as const;

// [PROVISIONAL] (OC-D12 "overchargedCapacitors gets a source"): a support squadron's pulse charges its owner's
// capacitors (the Overcharged Capacitors buff, +shield recharge); a pulse on a ship already charged refreshes it and
// rolls this escalation chance (integer percent, x the current rank, the weapon proc rule).
export const SUPPORT_OVERCHARGE_ESCALATION = 30;

// ===== Stances (user 2026-10-22, WR-8 review: "Stance should decide") =====
// Under the rules each stance sets where a ship parks (resolveBattle.ts stanceHoldDistance):
//   Aggressive : its SHORTEST firing gun's reach, so every installed gun fires (the brawl it always was).
//   Balanced   : the farthest range at which the guns and drones that reach it deliver MORE than this share of its
//                expected damage (ties go to the closer range), so a small short gun on a long-range ship may sit out
//                but a Balanced Destroyer's autocannons fire. [PROVISIONAL] the share.
//   Defensive  : (the stored key stays "standoff", so no save migration) its LONGEST reach, backing off when a foe
//                closes only if it is faster; and it takes less and deals less, puts its shields first and guards
//                against threats (DefensiveStance below).
export const BALANCED_FIREPOWER_SHARE = 0.5;

// [PROVISIONAL] (user 2026-10-22: Defensive "does ALL FOUR"; 0.16.0 owns the numbers). Each is one flat source (no
// stacking), so no curve is needed; each reads the whole percent below:
//   damageTakenPct     : incoming damage reduced (every hit through applyProjectileDamage).
//   damageDealtPct     : outgoing weapon and drone damage reduced.
//   shieldRechargePct  : shields recharge faster in the fight.
//   shieldAbsorbPct    : each shield point stops this much more damage (the shield's effective capacity).
//   missileInterceptPct: a Defensive ship with working point defense shoots down an incoming missile projectile at
//                        this chance (a missile is a weapon with the `missile` trait, the Concussion Torpedo).
// Guarding (no number): its anti-drone weapons fire at a foe fielding drones before any other target, and its drone
// squadrons hunt enemy drones before enemy ships.
export interface DefensiveStance {
  damageTakenPct: number;
  damageDealtPct: number;
  shieldRechargePct: number;
  shieldAbsorbPct: number;
  missileInterceptPct: number;
}
// [PROVISIONAL] (user 2026-10-22, answer 5 "Closing is evasive (Recommended)"): a ship closing toward its stance range
// while still OUT of its own reach (no gun or offense drone can hit any foe yet) moves evasively and takes this percent
// less from every hit. It stops the moment any of its sources reaches a foe, or when it stops closing. Both sides, the
// same rules. Never 100 (no immunity); banked like the Defensive percents, so it is exact over the approach.
export const CLOSING_EVASION_PCT = 40;

export const DEFENSIVE_STANCE: Readonly<DefensiveStance> = {
  damageTakenPct: 20,
  damageDealtPct: 10,
  shieldRechargePct: 25,
  shieldAbsorbPct: 15,
  missileInterceptPct: 30,
};

// The weapon traits the rules add when a weapon is built (bridge.ts shipToCombatant, combatRules on):
//   antiDrone        : the weapon aims at the target's drones (the squadron-targeted intercept row). Point Defense and
//                      EMP (OC-D12 "antiDrone on Point Defense and EMP").
//   droneEffectSlots : effects a connecting shot procs on a target that fields live drones. Point Defense's Inhibit
//                      [PROVISIONAL 40% proc, 25% escalation] (OC-D12 "inhibit from the PDA").
//   vsShieldsPct     : the vs-Shields triangle column for this weapon (the Tachyon anti-shield exception, design S3
//                      "buffed vs shields": the particle column's 110 [PROVISIONAL]).
//   chainSharePct    : the share of a connecting shot's damage that arcs to the attacker's next weakest foe (the
//                      Voltaic chain, design S3 [PROVISIONAL 30%]).
//   missile          : the weapon fires missiles a Defensive ship's point defense can shoot down (the Concussion
//                      Torpedo; user 2026-10-22 "point defense and drones focus incoming drones and missiles").
export interface WeaponRuleTraits {
  antiDrone?: boolean;
  droneEffectSlots?: readonly WeaponEffect[];
  vsShieldsPct?: number;
  chainSharePct?: number;
  missile?: boolean;
}
export const WEAPON_RULE_TRAITS: Readonly<Partial<Record<WeaponId, WeaponRuleTraits>>> = {
  pointDefenseArray: { antiDrone: true, droneEffectSlots: [{ defId: "inhibit", procChance: 40, escalationChance: 25 }] },
  empCannon: { antiDrone: true },
  tachyonBurstEmitter: { vsShieldsPct: 110 },
  voltaic: { chainSharePct: 30 },
  concussionTorpedo: { missile: true },
};

// `w` with its rule traits (a fresh object; the effect slots copied). A weapon with none is returned as it is. Pure.
export function withWeaponRuleTraits(w: CombatWeapon): CombatWeapon {
  const traits = w.weaponType === undefined ? undefined : WEAPON_RULE_TRAITS[w.weaponType as WeaponId];
  if (traits === undefined) return w;
  return {
    ...w,
    ...(traits.antiDrone ? { antiDrone: true } : {}),
    ...(traits.droneEffectSlots ? { droneEffectSlots: traits.droneEffectSlots.map((e) => ({ ...e })) } : {}),
    ...(traits.vsShieldsPct !== undefined ? { vsShieldsPct: traits.vsShieldsPct } : {}),
    ...(traits.chainSharePct !== undefined ? { chainSharePct: traits.chainSharePct } : {}),
    ...(traits.missile ? { missile: true } : {}),
  };
}
