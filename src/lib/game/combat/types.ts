// ============================================================================
// combat/types.ts -- shared data shapes for the combat sim (Combat 0.13.0,
// Phase 2 sim-core skeleton)
//
// These are the DATA CONTRACTS the whole combat engine speaks. They are
// deliberately MINIMAL for the skeleton (YAGNI: no weapon families, drones, or
// status effects modeled yet) but FORWARD-SHAPED: every place a later phase
// will grow the model is either already present as a reserved-empty field or
// called out in a TODO, so later phases EXTEND these shapes instead of
// reshaping them (which would ripple through the sim + every test). Comments
// name exactly which phase fills each gap so the growth path is legible.
//
// Everything time-related is INTEGER FIXED-POINT (deci-seconds), never a float,
// per design S0 principle 4 (integer math everywhere to avoid cross-device
// drift). "DeciSec" in a field name = tenths of a second as a whole number
// (10 = 1.0s). HP / shields / damage / positions are all bounded integers too.
// ============================================================================

// Which side a combatant fights for. Two teams for v1 (your ship vs enemies);
// escort ships join the "player" team in a later phase without changing this.
export type CombatTeam = "player" | "enemy";

// The three PERMANENT weapon families (design S3). Growth happens as new TYPES
// within a family, never new families. Each family has a signature trait and a
// modest damage-type triangle multiplier (a lever, not a hard counter), both
// implemented in resolveBattle's shot pipeline:
//   - "kinetic":  Armor Penetration signature; +10% vs armor/hull, hard-walled
//                 by shields (no attenuation). The finisher.
//   - "particle": Shield Attenuation signature; +10% vs shields, partial hull
//                 damage bleeds through shields (never fully walled). Steady.
//   - "ew":       Disruption-focused; weak direct damage, no attenuation. The
//                 support/debuff family (disruption procs land in Phase 4).
export type WeaponFamily = "kinetic" | "particle" | "ew";

// Phase 4 status-effect shapes live in statusEffects.ts (the whole disruption/
// DoT/buff engine + registry). types.ts imports them as TYPES ONLY so the two
// modules can reference each other's shapes (Combatant carries StatusEffect[];
// statusEffects.ts's tickEffects reads a structural subset of Combatant) with
// zero runtime cycle: `import type` is erased at compile time.
import type { StatusEffect, WeaponEffect } from "./statusEffects";

// A single weapon mounted on a combatant.
//
// This is the REAL Phase 3 weapon model (it replaced the Phase 2 flat-`yield`
// placeholder). A weapon now carries its family (which selects the triangle +
// signature in the shot pipeline), a min-max damage band rolled with variance +
// crit, an accuracy that is checked against target evasion, a projectile count
// (each projectile rolls hit/crit independently), and the two signature levers
// (shieldAttenuation for particle, armorPen for kinetic). All numeric fields are
// bounded INTEGERS so the sim stays drift-proof.
//
// FORWARD HOOKS deferred to later phases (kept OUT of this shape on purpose so
// the contract stays exactly the Phase 3 spec, added additively later):
//   - installCap / class gates + power draw  [Phase 5, equipment mapping]
//   - effect-slot CONTENT (real disruption/DoT records)  [Phase 4]
export interface CombatWeapon {
	// Stable identifier for this weapon instance. Used in log events + for
	// deterministic ordering if two weapons ever need a tiebreak.
	id: string;
	// Which family this weapon belongs to. Selects the damage-type triangle
	// multiplier AND the signature trait (attenuation vs armor-pen vs disruption)
	// applied in the shot pipeline.
	family: WeaponFamily;
	// Damage band, INCLUSIVE integers. Each projectile rolls a raw value in
	// [yieldMin, yieldMax] off the combat stream (design S2.4 damage variance).
	// yieldMin == yieldMax gives a flat, variance-free weapon.
	yieldMin: number;
	yieldMax: number;
	// Time between shots, in deci-seconds (integer fixed-point). e.g. 15 = fire
	// once every 1.5s. Balance derives this from a design-facing attack rate.
	cooldownDeciSec: number;
	// Hit chance as an INTEGER PERCENT (0..100). The shot pipeline rolls each
	// projectile against clamp(accuracy - targetEvasion, 0, 100) via
	// combat.chance(effective, 100), so no float ever enters the hit path.
	accuracy: number;
	// How many projectiles the weapon fires per shot. Each projectile rolls its
	// own hit + crit independently (design S2.2): a high count is reliable chip,
	// a single projectile is swingy. Must be >= 1.
	projectileCount: number;
	// Firing range on the 1D distance axis (integer). The weapon only fires when
	// the target's |position - self.position| is <= range. Phase 6 replaces the
	// scalar with Long/Medium/Short range BANDS.
	range: number;
	// PARTICLE signature (0 for kinetic/EW). An integer percent: the fraction of
	// incoming damage that, once reduced by the target's shieldCoherence, skips
	// shields straight to the hull-path (design S2.5a). Only consulted for the
	// particle family; kinetic + EW never attenuate.
	shieldAttenuation: number;
	// KINETIC signature (0 for particle/EW). An integer percent of the target's
	// ablativeArmor AND kineticDampening that this weapon IGNORES on the hull-path
	// (design S2.5c / S3 Armor Penetration). Only consulted for the kinetic
	// family.
	armorPen: number;
	// Carry-over cooldown clock, in deci-seconds. Advanced by dt each tick; when
	// it reaches cooldownDeciSec the weapon fires and we SUBTRACT cooldownDeciSec
	// (keeping the remainder) so fractional fire rates never skew over time.
	// Seeded to 0 (or a value) at battle start.
	cooldownAccumulator: number;
	// The disruptions/DoTs this weapon can inflict on hit (design S3: up to 2). A
	// weapon rolls each slot's procChance off the combat stream on a connecting
	// shot; on success it applies the slot's effect to the target with rank
	// escalation (design S2.6 / S4). Empty [] = a weapon that inflicts no effects
	// (e.g. a plain Autocannon). See statusEffects.ts WeaponEffect + the shot
	// pipeline's effect-proc seam in resolveBattle.ts.
	effectSlots: WeaponEffect[];
}

// One participant in the battle: a ship (yours or an enemy).
//
// Phase 3 added the core defense model (shieldCoherence, ablativeArmor,
// kineticDampening, evasion below). Still FORWARD-FRIENDLY GAPS for later phases
// (all purely additive when they arrive):
//   - resists: per damage-type damage-resist AND disruption-resist        [Phase 5]
//   - durability / system-condition tracking                               [Phase 9]
//   - power budget (reactor output vs loadout draw)                         [Phase 10]
//   - stance + preferred range band, targeting policy                       [Phase 6]
export interface Combatant {
	// Unique id across BOTH teams. Also the deterministic sort key for turn
	// order (see resolveBattle), so it must be stable and unique per battle.
	id: string;
	// Which side this combatant is on.
	team: CombatTeam;

	// Hull = the real health pool. Hull <= 0 means destroyed (alive=false). Kept
	// as a bounded integer.
	hull: number;
	// Starting/maximum hull, used for tiebreak (highest total hull% remaining)
	// and later for repair + UI bars.
	hullMax: number;

	// Shield = a regenerating buffer that absorbs damage BEFORE hull. Overflow
	// past the current shield pool continues to hull.
	shield: number;
	// Maximum shield pool; shield regen is clamped to this.
	shieldMax: number;
	// Shield regenerated per SECOND (not per tick). resolveBattle converts this
	// to a per-dt amount using fixed-point accumulation so 0.1s steps stay exact.
	shieldRecharge: number;
	// Attenuation RESIST, an integer percent (design S5 shieldCoherence). It is
	// subtracted from a PARTICLE weapon's shieldAttenuation before the bypass
	// fraction is computed: net bypass = max(0, weapon.shieldAttenuation -
	// shieldCoherence). Counter-building against particle pressure. 0 = no resist.
	// NOTE: per-type resists + disruption resists land in Phase 5.
	shieldCoherence: number;

	// -- Hull-path defenses (design S5). Applied on the hull-path AFTER shields, in
	// the strict order ablativeArmor (deplete) -> kineticDampening (%), see the
	// shot pipeline. Per-type resists + durability + power all arrive in Phase 5.
	// Ablative armor: a DEPLETING flat buffer that soaks hull-path damage first
	// and is consumed as it soaks (integer points). Kinetic weapons ignore
	// weapon.armorPen percent of it. 0 = no armor buffer.
	ablativeArmor: number;
	// Kinetic dampening: a flat PERCENT reduction (0..100) applied to whatever
	// hull-path damage remains after ablative armor. Kinetic weapons ignore
	// weapon.armorPen percent of this reduction. 0 = no dampening.
	kineticDampening: number;
	// Evasion: an integer percent subtracted from a weapon's accuracy to get the
	// per-projectile hit chance (design S2.1). Higher = harder to hit. 0 = none.
	// Phase 6 feeds this from maneuverability/speed + range; a flat field for now.
	evasion: number;

	// Position on a 1D distance axis (integer). Combatants close/open distance
	// toward their target each tick. Phase 6 layers stance + range bands on top;
	// the skeleton just closes toward the nearest enemy.
	position: number;
	// Movement per SECOND along the position axis (integer). Converted to a
	// per-dt step by resolveBattle.
	speed: number;

	// This combatant's weapons. Skeleton fires the placeholder shot; Phase 3
	// swaps in the real shot pipeline.
	weapons: CombatWeapon[];

	// Liveness flag. Set false the tick hull first reaches <= 0. Kept as an
	// explicit field (rather than deriving hull<=0 everywhere) so death is a
	// single unambiguous source of truth the loop + objective read.
	alive: boolean;

	// Active timed status effects (DoTs / disruptions / buffs) currently on this
	// combatant (design S4). tickEffects advances them each step; effect procs
	// from enemy weapons push onto this list. PERSISTS between battles by design
	// (disruptions tick down over time), so the sim does NOT clear it at battle
	// end. See statusEffects.ts.
	statusEffects: StatusEffect[];
	// RESERVED, EMPTY until Phase 8 (drones). Typed loosely on purpose so the
	// drone sub-system can define its real element type and drop it in without
	// reshaping Combatant; the sim loop already has an "act drones" seam that
	// iterates this empty array today.
	drones: unknown[]; // TODO Phase 8: launched drone squadrons
}

// One structured record in the combat log.
//
// THIS IS THE SINGLE EVENT STREAM (design S8/S16). It feeds three consumers:
// live round-by-round watching, the offline While-You-Were-Away summary, and
// the future 2.0 replay/animation. It is DATA, never prose: flavor text is
// selected LATER from these fields via the cosmetic stream, so the same event
// can render many different flavor lines without changing the outcome. Keep
// adding optional fields as phases need them; never bake rendered sentences in.
export interface CombatEvent {
	// When the event happened, in deci-seconds from battle start (integer). The
	// canonical, sortable timestamp.
	tDeciSec: number;
	// The 1-second narration bucket this event falls in (floor(tDeciSec / 10)).
	// Precomputed so the log renderer can group by round without re-deriving.
	round: number;
	// Event category, e.g. "shot", "shieldHit", "hullHit", "destroyed",
	// "battleEnd". Kept a plain string so phases add new types freely; the
	// flavor layer switches on this.
	type: string;

	// Who acted (weapon owner), if applicable. Optional because some events
	// (e.g. battleEnd) have no single actor.
	actorId?: string;
	// Who was affected, if applicable.
	targetId?: string;

	// Damage applied by this event (integer), if any. For a multi-projectile shot
	// this is the TOTAL damage summed across every projectile that landed.
	damage?: number;
	// Coarse result tag, e.g. "hit" / "evade" / "destroyed". The flavor layer
	// switches on this plus `type`.
	result?: string;
	// Target's shield value AFTER this event resolved, so the eventual flavor
	// line matches reality (design S2.8: "log the event with the result so the
	// flavor matches reality").
	shieldAfter?: number;
	// Target's hull value AFTER this event resolved, same reason.
	hullAfter?: number;

	// -- Phase 3 shot-detail fields (all optional; a flavor layer reads them to
	// pick the most specific line). --
	// The firing weapon's family, so flavor can be styled per particle/kinetic/EW.
	family?: WeaponFamily;
	// True if ANY projectile in this shot critically hit (design S2.3 crit lines).
	crit?: boolean;
	// True if this PARTICLE shot bled damage through shields via attenuation
	// (design S2.5a), so the log can narrate the bypass distinctly.
	attenuated?: boolean;
	// How many of the shot's projectiles connected (0 = full evade). Lets flavor
	// distinguish a clean volley from a grazing partial hit.
	projectilesHit?: number;

	// -- Phase 4 status-effect fields (all optional). --
	// The disruption/DoT/buff def id this event concerns, for the flavor layer to
	// switch on (design S16 `disruptionType?`). Set on "effectApplied" events (a
	// weapon landed a disruption) and on "dot" events (a per-round DoT tick sum).
	effectDefId?: string;
	// The rank of the effect at the moment of the event (1..MAX_RANK), so flavor
	// can read "Plasma Fire II" vs "Plasma Fire" (design S4 aggregated DoT line).
	effectRank?: number;
}

// The full cast of a battle: BOTH teams in one flat, team-tagged list. A flat
// list (rather than {player:[], enemy:[]}) keeps the deterministic turn-order
// sort trivial (sort the whole list by id once) and lets objectives filter by
// team as needed.
export interface BattleParticipants {
	combatants: Combatant[];
}

// The victory condition, modeled as a PLUGGABLE predicate over the live battle
// state (design S1: "Objective is data ... pluggable"). Returning null means
// "battle continues"; returning a CombatTeam or "draw" means the battle is
// decided. The skeleton ships one objective (lastTeamStanding); Patrol-specific
// objectives (enemies-down = win, player-down = loss) are just other functions
// with this same signature dropped in later.
export type BattleObjective = (
	participants: BattleParticipants,
) => CombatTeam | "draw" | null;

// Why the battle ended, alongside who won.
export interface BattleOutcome {
	// The victor, or "draw" if the tiebreak could not separate the teams.
	winner: CombatTeam | "draw";
	// How it ended:
	//   "eliminated"  -> the objective was met (a team was wiped / condition hit)
	//   "capReached"  -> the hard tick cap fired and we tiebreak by hull%
	// Kept a small closed union so consumers can switch exhaustively.
	reason: "eliminated" | "capReached";
	// How many 1-second rounds elapsed (for the summary + pacing). Derived from
	// the final tick count.
	rounds: number;
}

// ---------------------------------------------------------------------------
// Built-in objective: LAST TEAM STANDING.
//
// The default/skeleton objective. Returns the winning team once exactly one
// team has any living combatant left, "draw" if BOTH teams are simultaneously
// wiped (possible if a final exchange kills the last ship on each side in the
// same tick), or null while both teams still have fighters. Exported so tests +
// the sim share the exact same logic (no divergent copies).
// ---------------------------------------------------------------------------
export const lastTeamStanding: BattleObjective = (participants) => {
	// Any living player-team combatant?
	const playerAlive = participants.combatants.some(
		(c) => c.team === "player" && c.alive,
	);
	// Any living enemy-team combatant?
	const enemyAlive = participants.combatants.some(
		(c) => c.team === "enemy" && c.alive,
	);

	// Both sides still have fighters: the battle is not decided yet.
	if (playerAlive && enemyAlive) {
		return null;
	}
	// Exactly one side survives: that side wins.
	if (playerAlive) {
		return "player";
	}
	if (enemyAlive) {
		return "enemy";
	}
	// Neither side survives (mutual kill on the same tick): a draw.
	return "draw";
};
