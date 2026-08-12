// ============================================================================
// combat/logFormat.ts -- CombatEvent[] => human-readable lines (Combat 0.13.0)
//
// A PLAIN, DATA-DRIVEN renderer that turns the structured combat event stream
// (types.ts CombatEvent) into readable text lines for a DEV readout. It groups
// events by round with a "=== Round N ===" divider and applies a small template per
// event type (hit / evade / crit / effect / DoT / destruction), then appends the
// outcome as a final line.
//
// PHASE 12 UPDATE. The layered cosmetic flavor pools (flavor.ts) now select a
// line PER EVENT off the `cosmetic` RNG stream inside resolveBattle and store the
// chosen TEMPLATE on `event.flavor`. This renderer PREFERS that flavor line: when
// `event.flavor` is present it binds the template's names/numbers via
// interpolateFlavor (nameFor + the event's own fields) and renders that. It falls
// back to the built-in per-type templates below ONLY for events with no flavor
// (e.g. events built by hand in a test, or a future event type not yet flavored),
// so the dev tool keeps working and the round-grouping + outcome line are intact.
// ============================================================================

import type { BattleOutcome, CombatEvent, WeaponFamily } from "./types";
import { interpolateFlavor } from "./flavor";

// Readable label for each weapon family (the event carries the family, not a
// weapon name, since the log is family-tagged, see types.ts CombatEvent.family).
const FAMILY_LABEL: Record<WeaponFamily, string> = {
	kinetic: "kinetic",
	particle: "particle",
	ew: "EW",
};

// Resolve a combatant id to a display name via the caller's lookup, falling back
// to the raw id so a missing name never produces "undefined" in a line.
function display(nameFor: (id: string) => string, id: string | undefined): string {
	if (id === undefined) return "something";
	const name = nameFor(id);
	return name && name.length > 0 ? name : id;
}

// Render ONE event to a line (or null to skip an event type we do not narrate).
// Kept a plain switch on `type` so adding a narrated event type is one case.
function formatEvent(
	ev: CombatEvent,
	nameFor: (id: string) => string,
): string | null {
	// PHASE 12: prefer the selected cosmetic flavor line. It holds a raw template
	// (placeholders unbound at sim time, since the sim has no name lookup); bind it
	// here with the caller's nameFor + this event's numbers. Events without flavor
	// fall through to the built-in templates below.
	if (ev.flavor !== undefined) {
		return interpolateFlavor(ev.flavor, ev, nameFor);
	}

	const actor = display(nameFor, ev.actorId);
	const target = display(nameFor, ev.targetId);
	const family = ev.family ? FAMILY_LABEL[ev.family] : "weapon";

	switch (ev.type) {
		case "hit": {
			// Attacker's family fire connects for `damage`. Annotate crit / attenuation
			// (both optional flags on the event) so the dev line reflects reality.
			const tags: string[] = [];
			if (ev.crit) tags.push("CRIT");
			if (ev.attenuated) tags.push("bleed-through");
			const suffix = tags.length > 0 ? ` [${tags.join(", ")}]` : "";
			// Shields still up vs hull exposed, read off the post-event shield value.
			const where =
				ev.shieldAfter !== undefined && ev.shieldAfter > 0
					? "shields"
					: "hull";
			return `${actor}'s ${family} fire hits ${target}'s ${where} for ${ev.damage ?? 0}.${suffix}`;
		}
		case "evade":
			return `${target} evades ${actor}'s ${family} fire.`;
		case "effectApplied": {
			// A disruption/DoT landed. Include the rank (>1) so escalation reads.
			const rank = ev.effectRank && ev.effectRank > 1 ? ` ${ev.effectRank}` : "";
			return `${actor} afflicts ${target} with ${ev.effectDefId ?? "an effect"}${rank}.`;
		}
		case "dot": {
			// One aggregated damage-over-time line per effect per round.
			const rank = ev.effectRank && ev.effectRank > 1 ? ` ${ev.effectRank}` : "";
			return `${ev.effectDefId ?? "A burn"}${rank} sears ${target} for ${ev.damage ?? 0} this round.`;
		}
		case "jam":
			// A weapon jammed and fired nothing (Weapon Jam disruption). Only reached
			// for a hand-built event with no flavor; real sim events carry a flavor
			// line and render above. Actor-only: a jam affects the firing ship, no target.
			return `${actor}'s weapon jams and fails to fire.`;
		case "destroyed":
			return `${target} is destroyed!`;
		default:
			// Unknown / non-narrated event type: skip it rather than emit noise.
			return null;
	}
}

// ---------------------------------------------------------------------------
// formatCombatLog -- the public renderer.
//
// Groups the event stream into rounds (CombatEvent.round, the 1-second bucket)
// with a "=== Round N ===" divider between rounds, formats each event via the
// template above, and appends the outcome as a final line. Human round numbers
// are 1-based (round 0 = the first second of action, shown as "Round 1").
//
// `outcome` is OPTIONAL: the event stream does not carry the winner (resolveBattle
// returns it separately), so pass the outcome to get the final "wins" line. Omit
// it and the lines are just the round-by-round action with no summary.
// ---------------------------------------------------------------------------
export function formatCombatLog(
	log: CombatEvent[],
	nameFor: (id: string) => string,
	outcome?: BattleOutcome,
): string[] {
	const lines: string[] = [];

	// Track the round of the last event we emitted a divider for. -1 so the first
	// real round always triggers a divider. Events are already time-ordered by the
	// sim (it pushes them as they happen), so a single pass groups them correctly.
	let lastRound = -1;
	for (const ev of log) {
		const line = formatEvent(ev, nameFor);
		if (line === null) continue;
		if (ev.round !== lastRound) {
			// New round: emit its divider (human 1-based) before its first line.
			lines.push(`=== Round ${ev.round + 1} ===`);
			lastRound = ev.round;
		}
		lines.push(line);
	}

	// Final summary line from the outcome (if provided).
	if (outcome) {
		if (outcome.winner === "draw") {
			lines.push(`Outcome: draw after ${outcome.rounds} rounds (${outcome.reason}).`);
		} else {
			lines.push(
				`Outcome: ${outcome.winner} wins in ${outcome.rounds} rounds (${outcome.reason}).`,
			);
		}
	}

	return lines;
}
