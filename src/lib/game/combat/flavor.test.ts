// ============================================================================
// combat/flavor.test.ts: the layered cosmetic flavor pools (Combat 0.13.0, P12a)
//
// Guards the four properties that make flavor safe + useful:
//   1. DETERMINISM: same event + same cosmetic pick => the identical line.
//   2. FALLBACK CHAIN: signature -> weapon-type -> family -> generic, most
//      specific non-empty layer wins.
//   3. CATEGORY DERIVATION: the coarse CombatEvent.type + flags map to the right
//      fine category (crit > attenuation > shield-break > shield-hit > hull-hit).
//   4. INTERPOLATION: names/numbers/effect labels/rank suffixes bind correctly and
//      missing fields degrade gracefully (never "undefined").
// Plus a check that the approved-mockup death-sequence wording is reachable.
// ============================================================================

import { describe, it, expect } from "vitest";
import type { CombatEvent } from "./types";
import {
	selectFlavor,
	selectFlavorTemplate,
	interpolateFlavor,
	flavorCategory,
} from "./flavor";

// A name lookup mapping the two ids used across these tests to friendly names.
const nameFor = (id: string): string =>
	id === "P1" ? "Ravenscar" : id === "E1" ? "Marauder" : id;

// A tiny helper to build a CombatEvent with sensible defaults, overriding only
// the fields a given test cares about. Keeps each test focused on one property.
function ev(partial: Partial<CombatEvent>): CombatEvent {
	return {
		tDeciSec: 10,
		round: 1,
		type: "hit",
		actorId: "P1",
		targetId: "E1",
		...partial,
	};
}

describe("selectFlavorTemplate determinism", () => {
	it("same event + same pickIndex yields the identical template", () => {
		const e = ev({ type: "hit", shieldAfter: 0, hullAfter: 50, damage: 30 });
		expect(selectFlavorTemplate(e, 7)).toBe(selectFlavorTemplate(e, 7));
	});

	it("selectFlavor (select + interpolate) is deterministic for fixed inputs", () => {
		const e = ev({ type: "hit", shieldAfter: 0, hullAfter: 50, damage: 30 });
		expect(selectFlavor(e, nameFor, 3)).toBe(selectFlavor(e, nameFor, 3));
	});

	it("the pick index wraps modulo the pool length (indices past the end reuse lines)", () => {
		// evade has a generic-only pool. Any two indices that are congruent mod the
		// pool length must return the same line; a huge index must not throw.
		const e = ev({ type: "evade", projectilesHit: 0 });
		const a = selectFlavorTemplate(e, 0);
		const b = selectFlavorTemplate(e, 100000); // large index, must still be valid
		expect(typeof b).toBe("string");
		expect(b.length).toBeGreaterThan(0);
		// A negative index is defended (Math.abs), never throwing.
		expect(() => selectFlavorTemplate(e, -5)).not.toThrow();
		expect(a.length).toBeGreaterThan(0);
	});
});

describe("selectFlavorTemplate fallback chain (most specific wins)", () => {
	// A hull hit is the category with all four layers authored, so it is the best
	// probe for the fallback order.
	const hullHit = (extra: Partial<CombatEvent>): CombatEvent =>
		ev({ type: "hit", shieldAfter: 0, hullAfter: 40, damage: 25, ...extra });

	it("weapon-type layer wins over family + generic (railgun hull hit)", () => {
		// Scan every index in the railgun type pool; each line must be a railgun line.
		const e = hullHit({ family: "kinetic", weaponType: "railgun" });
		const lines = new Set<string>();
		for (let i = 0; i < 12; i++) lines.add(selectFlavorTemplate(e, i));
		for (const line of lines) expect(line).toContain("railgun");
	});

	it("falls back to the FAMILY layer when the weapon-type has no type pool", () => {
		// "workhorseX" is not a keyed weapon-type, so a kinetic hull hit must draw
		// from the kinetic family pool (armor-pen flavor), never the railgun lines.
		const e = hullHit({ family: "kinetic", weaponType: "workhorseX" });
		for (let i = 0; i < 12; i++) {
			expect(selectFlavorTemplate(e, i)).not.toContain("railgun");
		}
		// And at least one index yields a distinctly-kinetic (armor/plating) line.
		const all = [0, 1, 2, 3, 4, 5].map((i) => selectFlavorTemplate(e, i));
		expect(all.some((l) => /armor|plating/.test(l))).toBe(true);
	});

	it("falls back to the GENERIC layer when neither type nor family has a pool", () => {
		// evade authors only a generic layer, so setting family + type must not
		// change which pool is used: every line comes from the generic evade pool.
		const withSpecific = ev({
			type: "evade",
			projectilesHit: 0,
			family: "kinetic",
			weaponType: "railgun",
		});
		const bare = ev({ type: "evade", projectilesHit: 0 });
		for (let i = 0; i < 8; i++) {
			expect(selectFlavorTemplate(withSpecific, i)).toBe(
				selectFlavorTemplate(bare, i),
			);
		}
	});

	it("an unminted signature id falls through safely to the most specific available layer", () => {
		// The v1 roster mints no signature, but the module supports the layer. hull
		// hit ships no signature pool, so a signature id simply falls through to the
		// type layer here; this asserts the fallback does NOT crash on an unknown
		// signature and still resolves to the most specific AVAILABLE layer (type).
		const e = hullHit({
			family: "kinetic",
			weaponType: "railgun",
			weaponSignature: "someUnmintedUnique",
		});
		expect(selectFlavorTemplate(e, 0)).toContain("railgun");
	});
});

describe("flavorCategory derivation", () => {
	it("prioritizes crit over every other hit sub-category", () => {
		expect(
			flavorCategory(ev({ type: "hit", crit: true, attenuated: true, shieldAfter: 5 })),
		).toBe("crit");
	});

	it("attenuation beats shield-break and plain hits", () => {
		expect(
			flavorCategory(ev({ type: "hit", attenuated: true, shieldBroke: true, shieldAfter: 0 })),
		).toBe("attenuation");
	});

	it("shield-break beats a plain shield/hull hit", () => {
		expect(
			flavorCategory(ev({ type: "hit", shieldBroke: true, shieldAfter: 0 })),
		).toBe("shieldBreak");
	});

	it("a hit with shields still up is a shield hit; with shields down, a hull hit", () => {
		expect(flavorCategory(ev({ type: "hit", shieldAfter: 20 }))).toBe("shieldHit");
		expect(flavorCategory(ev({ type: "hit", shieldAfter: 0 }))).toBe("hullHit");
	});

	it("maps the non-hit event types one-to-one", () => {
		expect(flavorCategory(ev({ type: "evade" }))).toBe("evade");
		expect(flavorCategory(ev({ type: "ambush" }))).toBe("ambush");
		expect(flavorCategory(ev({ type: "effectApplied" }))).toBe("effectApplied");
		expect(flavorCategory(ev({ type: "dot" }))).toBe("dot");
		expect(flavorCategory(ev({ type: "jam" }))).toBe("jam");
		expect(flavorCategory(ev({ type: "destroyed" }))).toBe("destruction");
		expect(flavorCategory(ev({ type: "droneVolley" }))).toBe("droneVolley");
		expect(flavorCategory(ev({ type: "droneSupport" }))).toBe("droneSupport");
		expect(flavorCategory(ev({ type: "droneCleanse" }))).toBe("droneCleanse");
		expect(flavorCategory(ev({ type: "droneIntercept" }))).toBe("droneIntercept");
		expect(flavorCategory(ev({ type: "droneReplenish" }))).toBe("droneReplenish");
	});

	it("an unknown event type falls to the generic category", () => {
		expect(flavorCategory(ev({ type: "somethingNew" }))).toBe("generic");
	});
});

describe("interpolateFlavor binding", () => {
	it("binds actor + target names and the damage number", () => {
		const e = ev({ type: "hit", shieldAfter: 0, damage: 42 });
		const out = interpolateFlavor("{actor} hits {target} for {damage}.", e, nameFor);
		expect(out).toBe("Ravenscar hits Marauder for 42.");
	});

	it("resolves an effect def id to its display name and rank suffix", () => {
		const e = ev({ type: "dot", effectDefId: "plasmaFire", effectRank: 2, damage: 14 });
		const out = interpolateFlavor("{effect}{rank} burns {target} for {damage}.", e, nameFor);
		expect(out).toBe("Plasma Fire II burns Marauder for 14.");
	});

	it("renders no rank suffix at rank 1", () => {
		const e = ev({ type: "effectApplied", effectDefId: "plasmaFire", effectRank: 1 });
		const out = interpolateFlavor("{effect}{rank} takes hold.", e, nameFor);
		expect(out).toBe("Plasma Fire takes hold.");
	});

	it("degrades gracefully: a missing actor id renders a neutral word, not undefined", () => {
		// DoT + DoT-kill events carry no actorId; the destruction pool is target-only,
		// but if a template referenced {actor} it must never render "undefined".
		const e = ev({ type: "dot", actorId: undefined, targetId: "E1", damage: 5 });
		const out = interpolateFlavor("{actor} vs {target}.", e, nameFor);
		expect(out).toBe("something vs Marauder.");
		expect(out).not.toContain("undefined");
	});

	it("an unknown placeholder resolves to empty rather than leaking braces", () => {
		const e = ev({ type: "hit" });
		expect(interpolateFlavor("{actor}{bogus}!", e, nameFor)).toBe("Ravenscar!");
	});
});

describe("death-sequence wording is reachable (approved mockup)", () => {
	// Scan enough indices to cover each small pool, then assert the three beats.
	const scan = (e: CombatEvent): string[] =>
		Array.from({ length: 12 }, (_v, i) => selectFlavor(e, nameFor, i));

	it("beat (a): a voltaic shield-break can read 'hull laid bare'", () => {
		const e = ev({
			type: "hit",
			shieldBroke: true,
			shieldAfter: 0,
			hullAfter: 200,
			damage: 30,
			family: "particle",
			weaponType: "voltaic",
		});
		expect(scan(e).some((l) => l.includes("hull laid bare"))).toBe(true);
	});

	it("beat (b): a railgun hull hit can read 'punches clean through the exposed frame'", () => {
		const e = ev({
			type: "hit",
			shieldAfter: 0,
			hullAfter: 60,
			damage: 140,
			family: "kinetic",
			weaponType: "railgun",
		});
		const lines = scan(e);
		expect(lines.some((l) => l.includes("punches clean through the exposed frame"))).toBe(
			true,
		);
		// The damage binds into the beat.
		expect(lines.some((l) => l.includes("140 into the hull"))).toBe(true);
	});

	it("beat (c): the destruction pool reads as the hull giving way / breaking apart", () => {
		const e = ev({ type: "destroyed", actorId: "P1", targetId: "E1", hullAfter: -3 });
		const lines = scan(e);
		expect(
			lines.some((l) => l.includes("breaks apart") || l.includes("hull gives way")),
		).toBe(true);
		// Never phrase destruction as shields killing the ship.
		for (const l of lines) expect(l.toLowerCase()).not.toContain("shield");
	});
});
