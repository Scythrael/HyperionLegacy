// ============================================================================
// combat/flavor.ts: layered cosmetic flavor pools for the combat log
// (Combat 0.13.0, Phase 12a)
//
// PURPOSE. The sim (resolveBattle.ts) emits a stream of STRUCTURED CombatEvents
// (types.ts). This module turns one event into one human-readable flavor LINE,
// selected off the COSMETIC rng stream. It is the real replacement for the dev
// stand-in in logFormat.ts (whose header pointed here).
//
// THE HARD INVARIANT THIS MODULE LIVES UNDER (design S0 principle 3): flavor
// selection is COSMETIC ONLY. It must never touch the combat stream and must
// never change a battle outcome. The mechanism: the sim draws a single integer
// from the `cosmetic` stream per event and passes it in as `pickIndex`; every
// function here is a PURE function of (event fields + that index). Same inputs
// always yield the same line, and because the pick is a plain modulo over a pool,
// adding or removing a flavor line can only change WHICH sentence renders, never
// any number the sim computed. Offline (generateLog:false) simply never calls in
// here, draws nothing from the cosmetic stream, and stays byte-identical to live.
//
// LAYERED POOLS WITH MOST-SPECIFIC-WINS FALLBACK (design S16). For each event
// CATEGORY (shield hit, hull hit, shield break, crit, attenuation, evade, effect
// applied, DoT, ambush, destruction, the drone events, outcome/retreat) there is
// a pool, and each pool is tried in order:
//     signature-weapon  ->  weapon-type  ->  weapon-family  ->  generic
// The FIRST non-empty layer wins. Family + generic lines are authored DENSELY
// (several varied lines each) so text does not feel repetitive; weapon-type and
// signature layers add IDENTITY spice only where it is worth it (a Railgun
// punching through, a Voltaic arc stripping shields), and everything else simply
// inherits the family line. That keeps the content viable with no combinatorial
// explosion.
//
// RENDER SPLIT. Selection (which line) is separated from interpolation (binding
// names + numbers). The sim stores the raw TEMPLATE on the event (it has no
// name lookup), and the render step (logFormat / the combat view) binds
// {actor}/{target}/{damage}/... via the caller's nameFor and the event's own
// numeric fields. selectFlavor() below composes both for callers that have a
// nameFor to hand.
//
// STYLE: no em dashes and no "--" as punctuation anywhere in the lines (project
// rule); commas / periods / parens only. Gear is INSTALLED, never "fit".
// ============================================================================

import type { CombatEvent, WeaponFamily } from "./types";
import { STATUS_EFFECT_DEFS } from "./statusEffects";

// The magnitude of the single cosmetic draw the sim makes per event. Kept at 1000
// (the same magnitude the Phase-3 throwaway draw used) so the cosmetic stream
// advances by a familiar step; the exact value only has to comfortably exceed any
// pool length so the modulo below spreads evenly across a pool. Exported so the
// sim references ONE constant rather than a bare literal (Omega 9 transparency).
export const FLAVOR_PICK_RANGE = 1000;

// ---------------------------------------------------------------------------
// FLAVOR CATEGORIES. A CombatEvent.type is coarse ("hit" covers shield hits,
// hull hits, crits, shield breaks and attenuation bleed-through), so we DERIVE a
// finer category from the event's flags. This derivation is the "most specific
// EVENT SHAPE wins" half of the system; the pool layering is the other half.
// ---------------------------------------------------------------------------
export type FlavorCategory =
	| "shieldHit"
	| "hullHit"
	| "shieldBreak"
	| "crit"
	| "attenuation"
	| "evade"
	| "effectApplied"
	| "dot"
	| "jam"
	| "ambush"
	| "destruction"
	| "droneVolley"
	| "droneSupport"
	| "droneCleanse"
	| "droneIntercept"
	| "droneReflect"
	| "droneCounter"
	| "droneReplenish"
	| "outcome"
	| "retreat"
	| "generic";

// One flavor pool: a generic layer (always present + dense) plus optional more-
// specific layers. Keys in the type/signature maps are weapon roster type ids and
// future signature-weapon ids respectively.
interface FlavorPool {
	// The always-present fallback. MUST be non-empty for every category so a line
	// is always available (guaranteed by the DEFAULT_GENERIC backstop in selectPool).
	generic: readonly string[];
	// Family spice (kinetic / particle / ew). Optional per family.
	family?: Partial<Record<WeaponFamily, readonly string[]>>;
	// Weapon-type spice, keyed by CombatWeapon.weaponType (e.g. "railgun").
	weaponType?: Record<string, readonly string[]>;
	// Signature-weapon spice, keyed by a future crafted/named weapon id. FORWARD
	// HOOK: the v1 roster mints none, so the sim never populates it; kept so the
	// top fallback layer is real + tested (see flavor.test.ts).
	signature?: Record<string, readonly string[]>;
}

// ---------------------------------------------------------------------------
// THE POOLS. Author family + generic densely; add type/signature only for
// identity. Placeholders (bound at render, see interpolateFlavor):
//   {actor}  {target}  {damage}  {effect}  {rank}  {shield}  {hull}  {count}
// ---------------------------------------------------------------------------
const POOLS: Record<FlavorCategory, FlavorPool> = {
	// A hit that landed on the target's shields (shields still up afterward).
	shieldHit: {
		generic: [
			"{actor}'s fire splashes across {target}'s shields, {damage} absorbed.",
			"{actor} batters {target}'s shields for {damage}.",
			"{actor}'s salvo flares against {target}'s screen, {damage} soaked.",
			"{actor} rakes {target}'s shields, {damage} bled off ({shield} left).",
			"{actor} pounds {target}'s deflectors for {damage}.",
			"{actor}'s hit ripples over {target}'s shields, {damage} down.",
		],
		family: {
			kinetic: [
				"{actor}'s rounds hammer flat against {target}'s shields, {damage}.",
				"{actor}'s slugs spark off {target}'s screen for {damage}.",
			],
			particle: [
				"{actor}'s beam claws at {target}'s shields for {damage}.",
				"{actor}'s emitters wash {damage} over {target}'s screen.",
			],
			ew: ["{actor}'s discharge crackles over {target}'s shields, {damage}."],
		},
		weaponType: {
			voltaic: ["{actor}'s voltaic arc grinds {target}'s shields down by {damage}."],
			graviton: ["{actor}'s graviton lance rakes {target}, {damage} through the screen."],
		},
	},

	// A hit on exposed hull (shields already down, or overflow to the hull).
	hullHit: {
		generic: [
			"{actor} rakes {target}'s hull for {damage}.",
			"{actor}'s fire chews into {target}'s exposed hull, {damage} damage.",
			"{actor} punches into {target}'s bare frame for {damage}.",
			"{actor}'s salvo tears {damage} out of {target}'s hull.",
			"{actor} lands a clean hit on {target}'s hull, {damage} through.",
			"{actor} hammers {target}'s hull plating for {damage}.",
		],
		family: {
			// Kinetic family = armor-penetration flavor (design S3 armor-pen signature).
			kinetic: [
				"{actor}'s slugs bore through {target}'s armor for {damage}.",
				"{actor} drives {damage} clean past {target}'s plating.",
				"{actor}'s rounds shrug off {target}'s armor and bite {damage} deep.",
			],
			particle: [
				"{actor}'s beam boils {damage} off {target}'s hull.",
				"{actor} sears {target}'s frame for {damage}.",
			],
			ew: ["{actor}'s discharge scorches {target}'s hull for {damage}."],
		},
		weaponType: {
			// The death-sequence beat (b) from the approved mockup: the killing hull hit.
			railgun: [
				"{actor}'s railgun punches clean through the exposed frame, {damage} into the hull.",
				"{actor}'s railgun spikes {target}'s hull for {damage}, straight through the armor.",
			],
			autocannon: [
				"{actor}'s autocannon stitches {damage} across {target}'s hull.",
				"{actor}'s autocannon rattles {damage} into {target}'s plating.",
			],
			concussionTorpedo: [
				"{actor}'s torpedo detonates against {target}'s hull for {damage}.",
			],
			plasma: ["{actor}'s plasma bolt melts {damage} out of {target}'s hull."],
		},
	},

	// A hit that dropped the target's shields to exactly 0 (the "hull laid bare"
	// beat (a) of the death sequence). Detected via CombatEvent.shieldBroke.
	shieldBreak: {
		generic: [
			"{actor}'s fire collapses {target}'s last shields, hull laid bare.",
			"{actor} strips {target}'s shields away, the hull now exposed.",
			"{target}'s shields buckle and fail under {actor}'s fire.",
			"{actor} shatters the last of {target}'s screen, {damage} spilling into the hull.",
			"{target}'s deflectors gutter out, hull wide open.",
		],
		family: {
			particle: [
				"{actor}'s beam burns through {target}'s failing shields, hull laid bare.",
			],
			kinetic: ["{actor}'s salvo caves in {target}'s last shields, frame exposed."],
		},
		weaponType: {
			// Near-verbatim from the approved mockup death sequence, beat (a).
			voltaic: [
				"Voltaic discharge strips {target}'s last shields, hull laid bare.",
				"{actor}'s voltaic surge overloads {target}'s emitters, shields gone.",
			],
		},
	},

	// A critical hit (any category, flagged crit).
	crit: {
		generic: [
			"Critical hit. {actor} savages {target} for {damage}.",
			"{actor} finds a seam and drives {damage} deep into {target}. Critical.",
			"A crushing blow from {actor}, {damage} to {target}.",
			"{actor}'s shot lands true, {damage} critical into {target}.",
			"Direct hit. {actor} rips {damage} out of {target}.",
		],
		family: {
			kinetic: ["{actor}'s round finds a gap and guts {target} for {damage}. Critical."],
			particle: ["{actor}'s beam lances a critical seam in {target}, {damage}."],
		},
		weaponType: {
			railgun: ["{actor}'s railgun scores a critical, {damage} clean through {target}."],
		},
	},

	// A particle shot that bled damage through shields to the hull (attenuation).
	attenuation: {
		generic: [
			"{actor}'s particle fire bleeds {damage} straight to {target}'s hull (shield attenuation).",
			"{actor}'s beam slips past {target}'s shields, {damage} into the hull.",
			"{actor}'s fire phases {damage} through {target}'s screen to the hull beneath.",
			"Part of {actor}'s beam bypasses {target}'s shields, {damage} to hull.",
		],
		weaponType: {
			plasma: ["{actor}'s plasma seeps {damage} through {target}'s shields to the hull."],
			graviton: ["{actor}'s graviton lance bleeds {damage} past {target}'s screen."],
		},
	},

	// A full miss (no projectile connected).
	evade: {
		generic: [
			"{target} slips aside, {actor}'s fire goes wide.",
			"{target} jinks and {actor}'s shot finds only empty space.",
			"{actor}'s salvo misses as {target} rolls clear.",
			"{target} evades, {actor}'s fire streaks past.",
			"{actor} tracks late, {target} dances out of the line.",
			"Nothing but void, {target} was already gone when {actor} fired.",
		],
	},

	// A disruption / DoT / buff took hold on the target ({effect}{rank}).
	effectApplied: {
		generic: [
			"{actor}'s hit seeds {effect}{rank} on {target}.",
			"{target} is struck with {effect}{rank}.",
			"{actor} afflicts {target} with {effect}{rank}.",
			"{effect}{rank} takes hold on {target}.",
			"{target}'s systems flare with {effect}{rank}.",
		],
	},

	// One aggregated damage-over-time line per effect per round.
	dot: {
		generic: [
			"{effect}{rank} sears {target} for {damage} this round.",
			"{effect}{rank} eats away at {target}, {damage} over the round.",
			"{target} takes {damage} from {effect}{rank}.",
			"{effect}{rank} smolders across {target}, {damage} lost.",
		],
	},

	// A weapon that JAMMED and fired nothing (Weapon Jam disruption, design S4).
	// DISPLAY-ONLY: the skip already resolved on the combat stream; this only
	// narrates it. Actor-only wording (a jam affects the firing ship, no target),
	// so the templates reference {actor} only. The family + weaponType layers name
	// the seized weapon the same way every other weapon line does.
	jam: {
		generic: [
			"{actor}'s weapon seizes, the shot lost to a jam.",
			"A feed jam chokes {actor}'s gun, no round leaves the tube.",
			"{actor}'s mount locks up, the salvo dies before it fires.",
			"{actor}'s weapon jams and fails to fire.",
			"{actor}'s firing cycle stalls, nothing comes off the rail.",
		],
		family: {
			kinetic: [
				"{actor}'s autoloader jams, the round stuck in the breech.",
				"{actor}'s slugs bind in the feed and the gun falls silent.",
			],
			particle: [
				"{actor}'s emitters misfire, the beam guttering out before it forms.",
			],
			ew: ["{actor}'s disruptor shorts out mid-charge, firing nothing."],
		},
		weaponType: {
			railgun: ["{actor}'s railgun seizes on the rails, the shot lost."],
			autocannon: ["{actor}'s autocannon jams, the belt snarled in the feed."],
		},
	},

	// A surprise opening salvo (ambush / decloak).
	ambush: {
		generic: [
			"Out of nowhere, {actor} opens up on {target} for {damage}.",
			"{actor} strikes first from ambush, {damage} before {target} can react.",
			"{target} is caught cold, {actor}'s opening salvo lands {damage}.",
			"{actor} decloaks and hammers {target} for {damage}.",
			"A surprise volley from {actor} rakes {target} for {damage}.",
		],
	},

	// The kill (beat (c) of the death sequence). Target-only wording, since a DoT
	// kill has no acting shooter to name.
	destruction: {
		generic: [
			"{target}'s hull gives way and it breaks apart.",
			"{target} buckles, then splits open and goes dark.",
			"{target}'s frame folds and the ship tears itself apart.",
			"{target} is gutted, tumbling away in pieces.",
			"The lights die on {target} as its hull collapses.",
			"{target} comes apart in a spreading bloom of debris.",
		],
	},

	// A drone squadron's offensive volley.
	droneVolley: {
		generic: [
			"{actor}'s drones swarm {target}, {damage} across the pass.",
			"{actor}'s squadron strafes {target} for {damage}.",
			"{actor}'s drones dive on {target}, {damage} in the run.",
		],
	},

	// A support squadron pulse repairing the owner ({actor} == {target}).
	droneSupport: {
		generic: [
			"{actor}'s support drones patch {damage} of hull.",
			"{actor}'s tender drones weld {damage} back onto the frame.",
		],
	},

	// A support squadron cleansing a disruption from its owner.
	droneCleanse: {
		generic: [
			"{actor}'s drones scrub {effect} from the systems.",
			"{actor}'s support wing purges {effect}.",
		],
	},

	// The defender's screen intercepting an incoming shot ({actor} == screen owner).
	droneIntercept: {
		generic: [
			"{actor}'s screen throws itself into {target}'s fire.",
			"{actor}'s drones intercept, blunting {target}'s salvo.",
		],
	},

	// The screen reflecting damage back at the attacker.
	droneReflect: {
		generic: ["{actor}'s drones fling fire back at {target} for {damage}."],
	},

	// The screen dealing collateral counter-damage.
	droneCounter: {
		generic: ["{actor}'s screen lashes out, {damage} onto {target}."],
	},

	// A drone rebuilt / repaired mid-fight.
	droneReplenish: {
		generic: [
			"Fresh drones spin up in {actor}'s bays.",
			"{actor}'s hangar refabricates a lost drone.",
		],
	},

	// The victory line. NOT wired into the sim (the outcome is returned separately,
	// not as a cosmetic-drawn event); provided for the render layer + future use.
	outcome: {
		generic: [
			"{actor} stands victorious over the wreckage.",
			"The field belongs to {actor}.",
		],
	},

	// A withdrawal line. FORWARD HOOK: retreat is not modeled in v1 (no retreat
	// event exists), so nothing selects this yet; authored for completeness.
	retreat: {
		generic: [
			"{actor} breaks off and withdraws from the fight.",
			"{actor} disengages, running for open space.",
		],
	},

	// Ultimate backstop for any event type we do not specifically narrate.
	generic: {
		generic: [
			"{actor} engages {target}.",
			"Fire is exchanged between {actor} and {target}.",
		],
	},
};

// A hard backstop so selectPool can NEVER return an empty pool (which would make
// the modulo below divide by zero). If a category ever ships with an empty
// generic layer by mistake, this keeps the renderer alive with a legible line.
const DEFAULT_GENERIC: readonly string[] = ["{actor} strikes {target}."];

// ---------------------------------------------------------------------------
// flavorCategory: derive the fine flavor category from a coarse CombatEvent.
//
// This is the "most specific EVENT SHAPE wins" step. For a "hit" the order of the
// checks below IS the priority: crit beats attenuation beats shield-break beats a
// plain shield hit beats a hull hit. Everything else maps one event type to one
// category. An unrecognized type falls to "generic".
// ---------------------------------------------------------------------------
export function flavorCategory(event: CombatEvent): FlavorCategory {
	switch (event.type) {
		case "hit": {
			if (event.crit) return "crit";
			if (event.attenuated) return "attenuation";
			if (event.shieldBroke) return "shieldBreak";
			// Shields still up after the hit => it landed on the screen; else the hull.
			if (event.shieldAfter !== undefined && event.shieldAfter > 0) return "shieldHit";
			return "hullHit";
		}
		case "ambush":
			return "ambush";
		case "evade":
			return "evade";
		case "effectApplied":
			return "effectApplied";
		case "dot":
			return "dot";
		case "jam":
			return "jam";
		case "destroyed":
			return "destruction";
		case "droneVolley":
			// A whiffed volley (no drone connected) still narrates as a volley line;
			// the count reads 0. Keeping it in the drone-volley pool avoids a separate
			// "drone evade" pool for an uncommon case.
			return "droneVolley";
		case "droneSupport":
			return "droneSupport";
		case "droneCleanse":
			return "droneCleanse";
		case "droneIntercept":
			return "droneIntercept";
		case "droneReflect":
			return "droneReflect";
		case "droneCounter":
			return "droneCounter";
		case "droneReplenish":
			return "droneReplenish";
		default:
			return "generic";
	}
}

// ---------------------------------------------------------------------------
// selectPool: the most-specific-wins fallback over the four layers.
//
// Tries signature -> weapon-type -> family -> generic and returns the FIRST
// non-empty layer. Never returns an empty array (DEFAULT_GENERIC backstop), so
// callers can safely modulo into it.
// ---------------------------------------------------------------------------
function selectPool(
	category: FlavorCategory,
	family: WeaponFamily | undefined,
	weaponType: string | undefined,
	weaponSignature: string | undefined,
): readonly string[] {
	const pool = POOLS[category];

	// Layer 1 (most specific): a named signature weapon.
	if (weaponSignature !== undefined) {
		const sig = pool.signature?.[weaponSignature];
		if (sig && sig.length > 0) return sig;
	}
	// Layer 2: the weapon roster type.
	if (weaponType !== undefined) {
		const typed = pool.weaponType?.[weaponType];
		if (typed && typed.length > 0) return typed;
	}
	// Layer 3: the weapon family.
	if (family !== undefined) {
		const fam = pool.family?.[family];
		if (fam && fam.length > 0) return fam;
	}
	// Layer 4: the generic pool (or the hard backstop if it is somehow empty).
	return pool.generic.length > 0 ? pool.generic : DEFAULT_GENERIC;
}

// ---------------------------------------------------------------------------
// selectFlavorTemplate: pick the raw template line for an event (PURE).
//
// Given the event and a cosmetic-drawn integer, derive the category, resolve the
// most-specific non-empty pool, and index into it with `pickIndex % length`. The
// return value still contains {placeholders}: name/number binding is a separate
// render step (interpolateFlavor). This split is what lets the SIM select the
// line (the cosmetic-isolation-critical decision) without needing a name lookup.
//
// Deterministic: identical (event fields + pickIndex) always give the identical
// template. That is the property the parity + determinism tests rely on.
// ---------------------------------------------------------------------------
export function selectFlavorTemplate(event: CombatEvent, pickIndex: number): string {
	const category = flavorCategory(event);
	const pool = selectPool(
		category,
		event.family,
		event.weaponType,
		event.weaponSignature,
	);
	// Normalize the index into the pool. Math.abs guards a negative draw (the sim
	// never passes one, but a defensive modulo keeps the function total).
	const idx = Math.abs(pickIndex) % pool.length;
	return pool[idx];
}

// Roman-numeral RANK suffix for effect lines: rank 1 renders nothing (a plain
// "Plasma Fire"), rank 2/3 render " II" / " III" (a leading space so templates
// can write "{effect}{rank}" and get "Plasma Fire II"). Ranks are 1..MAX_RANK (3).
function rankSuffix(rank: number | undefined): string {
	if (rank === undefined || rank <= 1) return "";
	if (rank === 2) return " II";
	if (rank === 3) return " III";
	// Defensive: an out-of-range rank still renders legibly rather than silently
	// dropping (Omega 14: no silent wrong behavior).
	return ` ${rank}`;
}

// Resolve an effect def id to its display name (e.g. "plasmaFire" -> "Plasma
// Fire"), falling back to the raw id so an unknown effect never renders "undefined".
function effectLabel(defId: string | undefined): string {
	if (defId === undefined) return "an effect";
	return STATUS_EFFECT_DEFS[defId]?.displayName ?? defId;
}

// Resolve a combatant id to a display name via the caller's lookup, falling back
// to the raw id (and to a neutral word when there is no id at all) so a missing
// name never renders "undefined". Mirrors logFormat's display helper.
function displayName(nameFor: (id: string) => string, id: string | undefined): string {
	if (id === undefined) return "something";
	const name = nameFor(id);
	return name && name.length > 0 ? name : id;
}

// ---------------------------------------------------------------------------
// interpolateFlavor: bind {placeholders} in a template to real values (PURE).
//
// Fills names via the caller's nameFor and numbers from the event's own fields.
// Unknown placeholders are left blank rather than rendering literally, but the
// authored templates only use the documented set. No eval: a single regex sweep
// over an explicit lookup keeps this transparent + injection-proof (Omega 9).
// ---------------------------------------------------------------------------
export function interpolateFlavor(
	template: string,
	event: CombatEvent,
	nameFor: (id: string) => string,
): string {
	const values: Record<string, string> = {
		actor: displayName(nameFor, event.actorId),
		target: displayName(nameFor, event.targetId),
		damage: String(event.damage ?? 0),
		effect: effectLabel(event.effectDefId),
		rank: rankSuffix(event.effectRank),
		shield: String(event.shieldAfter ?? 0),
		// DISPLAY-side clamp at 0: the sim deliberately leaves hull NEGATIVE on an
		// overkill kill (resolveBattle.ts, death check reads `alive`), so without this a
		// log line would interpolate e.g. "Hull -13". The engine value is untouched; only
		// this rendered string is clamped.
		hull: String(Math.max(0, event.hullAfter ?? 0)),
		// Drone/projectile connect count (droneVolley + intercept narration).
		count: String(event.projectilesHit ?? 0),
	};
	// Replace every {word} token with its bound value; an unrecognized token
	// resolves to an empty string (keeps a typo from leaking "{foo}" into the log).
	return template.replace(/\{(\w+)\}/g, (_match, key: string) =>
		key in values ? values[key] : "",
	);
}

// ---------------------------------------------------------------------------
// selectFlavor: the convenience one-shot: select the template then bind it.
//
// For callers that already have a nameFor (unit tests, the future combat view
// that selects on demand). The SIM does NOT use this: it stores the raw template
// from selectFlavorTemplate on the event and lets the render step interpolate,
// because at sim time there is no name lookup. Same inputs => same final line.
// ---------------------------------------------------------------------------
export function selectFlavor(
	event: CombatEvent,
	nameFor: (id: string) => string,
	pickIndex: number,
): string {
	return interpolateFlavor(selectFlavorTemplate(event, pickIndex), event, nameFor);
}
