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

// A single weapon mounted on a combatant.
//
// ⚠️ PLACEHOLDER SHAPE. Phase 3 REPLACES this with the real weapon model
// (families Particle/Kinetic/EW, the damage-type triangle, accuracy, crit,
// projectile count, per-weapon effect slots, range bands, install caps). For
// the skeleton a weapon is just "hits for `yield`, every `cooldownDeciSec`, if
// the target is within `range`", which is enough to make battles actually
// resolve so the parity + termination tests are meaningful.
export interface CombatWeapon {
	// Stable identifier for this weapon instance. Used in log events + for
	// deterministic ordering if two weapons ever need a tiebreak.
	id: string;
	// Flat damage dealt per shot in the skeleton. Phase 3 turns this into a
	// min-max range rolled with variance + crit + family multipliers.
	yield: number;
	// Time between shots, in deci-seconds (integer fixed-point). e.g. 15 = fire
	// once every 1.5s. Phase 3 derives this from weaponAttackRate.
	cooldownDeciSec: number;
	// Firing range on the 1D distance axis (integer). The weapon only fires when
	// the target's |position - self.position| is <= range. Phase 3 replaces the
	// scalar with Long/Medium/Short range BANDS.
	range: number;
	// Carry-over cooldown clock, in deci-seconds. Advanced by dt each tick; when
	// it reaches cooldownDeciSec the weapon fires and we SUBTRACT cooldownDeciSec
	// (keeping the remainder) so fractional fire rates never skew over time.
	// Seeded to 0 (or a value) at battle start.
	cooldownAccumulator: number;
}

// One participant in the battle: a ship (yours or an enemy).
//
// FORWARD-FRIENDLY GAPS (added by later phases, do NOT need them yet):
//   - armor: ablativeArmor (depleting buffer) + kineticDampening (% cut)  [Phase 4/5]
//   - resists: per damage-type damage-resist AND disruption-resist        [Phase 4/5]
//   - evasion / maneuverability / accuracy inputs                          [Phase 3]
//   - stance + preferred range band, targeting policy                      [Phase 6]
//   - durability / system-condition tracking                               [Phase 9]
//   - power budget                                                          [Phase 10]
// Adding those is purely additive to this interface.
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

	// RESERVED, EMPTY for the skeleton. Typed loosely on purpose so Phase 4
	// (status-effect system) and Phase 8 (drones) can define their real element
	// types and drop them in without reshaping Combatant or its consumers. They
	// exist now so the sim loop can already have "tick effects" / "act drones"
	// seams that simply iterate empty arrays today.
	statusEffects: unknown[]; // TODO Phase 4: timed DoT/debuff/buff effects
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

	// Damage applied by this event (integer), if any.
	damage?: number;
	// Coarse result tag, e.g. "hit" / "miss". Phase 3 adds "crit", "evade", etc.
	result?: string;
	// Target's shield value AFTER this event resolved, so the eventual flavor
	// line matches reality (design S2.8: "log the event with the result so the
	// flavor matches reality").
	shieldAfter?: number;
	// Target's hull value AFTER this event resolved, same reason.
	hullAfter?: number;
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
