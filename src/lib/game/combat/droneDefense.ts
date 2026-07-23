// ============================================================================
// combat/droneDefense.ts -- the PURE half of the drone DEFENSE model
// (Combat 0.13.0, Phase 7b: defensive interactions + reflect + replenishment)
//
// WHY A SEPARATE MODULE. Phase 7a put the drone DATA MODEL + factories in
// drones.ts and the drone OFFENSE (fireSquadron) inline in resolveBattle's tick
// loop. Phase 7b adds the DEFENSIVE side of the S8 interaction matrix: what
// happens when a shot targets a drone-carrier. That behavior splits cleanly into
// two halves:
//   1. PURE, rng-light helpers that decide the small facts (can this shot be
//      reflected? how much does a drone absorb? which enemy eats a smart-reflect?
//      how far did a between-waves rebuild get?). Those live HERE, unit-tested in
//      isolation with no sim, no combatant graph, no mitigation pipeline.
//   2. The ORCHESTRATION (per-projectile screen routing + calling the shared
//      applyProjectileDamage mitigation) stays in resolveBattle.ts, co-located
//      with fireWeapon + applyProjectileDamage which it must reuse.
// Keeping the pure facts here (Omega 9: readable, testable without the sim; Omega
// 2: each function is one clear concern) means the balance pass can reason about
// the defensive numbers as data, and the sim just wires them together.
//
// UNITS. Same as the rest of combat: HP / damage are bounded INTEGERS, chances
// are integer percents rolled on the shared combat Rng stream (design S0: integer
// fixed-point everywhere, no float). Every function that draws takes the Rng so
// the caller controls the ONE combat stream and parity (offline == live) holds.
// ============================================================================

import type { WeaponFamily } from "./types";
import type { Combatant } from "./types";
import type { Rng } from "./rng";
import type { Drone, DroneSquadron, DroneRole } from "./drones";
import { cleanseChance, STATUS_EFFECT_DEFS } from "./statusEffects";
import type { StatusEffect } from "./statusEffects";

// ---------------------------------------------------------------------------
// REFLECT GATE (design S8: "Reflect / smart-reflect is PARTICLE-ONLY").
// A reflected shot bounces back at the attacker; only PARTICLE weapons can be
// reflected. A kinetic shot (the family Concussion Torpedo belongs to) or an EW
// shot that a drone intercepts is BLOCKED/ABSORBED, never reflected. Torpedoes
// are therefore covered automatically (they are kinetic), but the rule is stated
// on the FAMILY so it is one obvious predicate the sim reads. No draw.
// ---------------------------------------------------------------------------
export function canReflect(family: WeaponFamily): boolean {
	return family === "particle";
}

// ---------------------------------------------------------------------------
// DRONE ABSORB (design S8: "absorb with HP, overflow to carrier").
// A drone soaks incoming damage with its flat HP pool (drones have no shields or
// armor): it absorbs up to its remaining HP, the EXCESS overflows past it, and if
// its HP is exhausted the drone is DESTROYED (flips to refabricating, the status
// pip the UI reads). Mutates the drone in place; makes NO rng draw (pure math).
//
// The overflow is RAW (pre-mitigation) damage: the caller routes it through the
// carrier's normal shields -> armor -> hull mitigation (a drone is a flat buffer
// in FRONT of the carrier's real defenses), so the two stages compose correctly.
// ---------------------------------------------------------------------------
export interface AbsorbResult {
	// Damage the drone soaked with its HP (0..incoming).
	absorbed: number;
	// Damage that spilled past the drone (incoming - absorbed), for the caller to
	// route onto the carrier through normal mitigation.
	overflow: number;
	// True if this hit destroyed the drone (HP hit 0).
	destroyed: boolean;
}

export function absorbWithDrone(drone: Drone, incoming: number): AbsorbResult {
	// Defensive clamp: never let a negative/fractional value corrupt the pool.
	const dmg = Math.max(0, Math.floor(incoming));
	const absorbed = Math.min(drone.hp, dmg);
	drone.hp -= absorbed;
	const overflow = dmg - absorbed;

	let destroyed = false;
	if (drone.hp <= 0) {
		drone.hp = 0;
		drone.alive = false;
		// A destroyed drone enters REFABRICATION (design S8): its refab progress
		// starts at 0 and climbs toward 100 (online) via replenishDrones, out of
		// combat by default (Phase 9) or in-combat with the replenish module.
		drone.status = "refabricating";
		drone.refabProgress = 0;
		destroyed = true;
	}
	return { absorbed, overflow, destroyed };
}

// ---------------------------------------------------------------------------
// REFLECT TARGET SELECTION (design S8: reflect at the attacker; smart-reflect at
// a priority enemy). A plain reflect sends the shot back at the ATTACKER. A
// carrier-exclusive SMART-reflect retargets to a priority foe: design says
// "a weaker/Support enemy first, then others". Ship ROLES do not exist yet (that
// is Phase 9 content), so the design-consistent proxy for "weaker/Support" is the
// LOWEST-HULL living enemy of the carrier. Returns a combatant to hit (never
// null: falls back to the attacker if no other enemy is alive).
// TODO(Phase 9): prefer an actual Support-role ship once ship roles are modeled.
// ---------------------------------------------------------------------------
export function selectReflectTarget(
	carrier: Combatant,
	attacker: Combatant,
	combatants: Combatant[],
	smartReflect: boolean,
): Combatant {
	// Plain reflect: straight back at the attacker (the common case).
	if (!smartReflect) return attacker;

	// Smart-reflect: the weakest LIVING enemy of the carrier (the carrier's enemies
	// are everyone NOT on the carrier's team). Deterministic id tiebreak on equal
	// hull so the pick never depends on array order in a way a reseed could shift.
	let best: Combatant | undefined;
	for (const c of combatants) {
		if (!c.alive) continue;
		if (c.team === carrier.team) continue;
		if (
			best === undefined ||
			c.hull < best.hull ||
			(c.hull === best.hull && c.id < best.id)
		) {
			best = c;
		}
	}
	return best ?? attacker;
}

// ---------------------------------------------------------------------------
// AVAILABLE DEFENDERS (design S8: the intercept order defense -> support -> attack).
// Build the ordered list of drones the carrier can pull into an intercept THIS
// shot, one entry per alive+online drone, in the PRIORITY order the matrix
// implies: defense drones first (they exist to guard), then support drones (pure
// meat-shields), then attack drones LAST (they "do NOT normally guard, but MAY"
// as a risky last resort). A weapon firing N projectiles consumes up to N of
// these (index p), so squadron size = defensive throughput and a thin screen
// leaks the surplus projectiles through to the carrier (design S8 saturation).
// Pure read; no mutation, no draw.
// ---------------------------------------------------------------------------
export interface Defender {
	squadron: DroneSquadron;
	drone: Drone;
}

export function availableDefenders(carrier: Combatant): Defender[] {
	// The fixed intercept priority. Attack is intentionally LAST (risky last resort).
	const order: DroneRole[] = ["defense", "support", "attack"];
	const defenders: Defender[] = [];
	for (const role of order) {
		for (const squadron of carrier.drones) {
			if (squadron.role !== role) continue;
			for (const drone of squadron.drones) {
				// Only healthy drones can intercept: a dead (refabricating) or jammed
				// (disrupted) drone cannot defend (mirrors the offense guard in 7a).
				if (drone.alive && drone.status === "online") {
					defenders.push({ squadron, drone });
				}
			}
		}
	}
	return defenders;
}

// ---------------------------------------------------------------------------
// REPLENISHMENT (design S8: droneReplenishRate rebuilds destroyed drones out of
// combat; a module unlocks x% of it in combat). A PURE helper Phase 9 calls
// between waves (and the in-combat replenish path calls each tick at x% rate).
//
// It advances BOTH recovery tracks by `rateUnits` progress points, in PARALLEL
// across every recovering drone (a screen recovers as a whole, like shields):
//   - DISRUPTED drones climb repairProgress 0..100 back to ONLINE (design S8:
//     "a disrupted drone repairs over repairProgress").
//   - DESTROYED drones climb refabProgress 0..100, then respawn at full HP,
//     online + alive (design S8: "a destroyed drone refabricates over refabProgress").
// Returns how many drones came fully back ONLINE this call (rebuilt refab +
// finished repair), so the caller can log/announce the recovery. Mutates the
// squadron's drones in place; makes NO rng draw (deterministic progress).
// ---------------------------------------------------------------------------
export function replenishDrones(squadron: DroneSquadron, rateUnits: number): number {
	// Clamp to a non-negative integer: a 0 rate is a legal no-op (parity-safe when
	// the in-combat percent floors to nothing on a given tick).
	const units = Math.max(0, Math.floor(rateUnits));
	if (units === 0) return 0;

	let restored = 0;
	for (const drone of squadron.drones) {
		if (drone.alive && drone.status === "disrupted") {
			// A jammed-but-alive drone repairs back to online.
			drone.repairProgress += units;
			if (drone.repairProgress >= 100) {
				drone.repairProgress = 0;
				drone.status = "online";
				restored++;
			}
		} else if (!drone.alive) {
			// A destroyed drone refabricates. Normalize its status in case it was
			// zeroed some other way (defensive: absorbWithDrone already sets it).
			if (drone.status !== "refabricating") {
				drone.status = "refabricating";
				drone.refabProgress = 0;
			}
			drone.refabProgress += units;
			if (drone.refabProgress >= 100) {
				drone.refabProgress = 0;
				drone.hp = drone.hpMax;
				drone.alive = true;
				drone.status = "online";
				restored++;
			}
		}
	}
	return restored;
}

// ---------------------------------------------------------------------------
// SUPPORT CLEANSE (design S8 Mode 3: "disruption cleanse whose chance halves per
// rank"). A support squadron's pulse attempts to strip DISRUPTIONS (debuff-kind
// status effects) off the owner: each active disruption rolls cleanseChance(rank)
// on the combat stream (60 / 30 / 15 per rank, the Phase 4 curve reused verbatim)
// and is removed on success. DoTs and BUFFS are left alone (cleanse is a
// DISRUPTION counter, not a heal-over-time or buff strip). Returns the def ids
// cleansed (for the log) and reassigns owner.statusEffects to the survivors.
//
// One combat draw per disruption present, in list order. Parity: the caller only
// invokes this when a support squadron is actually present + pulsing, so a
// support-less battle never draws here.
// ---------------------------------------------------------------------------
export function supportCleanse(
	owner: { statusEffects: StatusEffect[] },
	rng: Rng,
): string[] {
	const cleansed: string[] = [];
	const survivors: StatusEffect[] = [];
	for (const effect of owner.statusEffects) {
		const def = STATUS_EFFECT_DEFS[effect.defId];
		// Only DISRUPTIONS (debuff kind) are cleansable. An unknown def id (should
		// not happen) is left in place rather than silently dropped.
		if (def !== undefined && def.kind === "debuff") {
			// One draw per disruption, always (whether or not it clears), so the
			// schedule is fixed. Higher rank => lower chance (halving per rank).
			if (rng.chance(cleanseChance(effect.rank), 100)) {
				cleansed.push(effect.defId);
				continue; // stripped: do not carry it into the survivor list
			}
		}
		survivors.push(effect);
	}
	owner.statusEffects = survivors;
	return cleansed;
}
