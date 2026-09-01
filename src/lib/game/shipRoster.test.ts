// ============================================================================
// shipRoster.test.ts -- unit tests for the pure Ships-tab roster view-model.
// Author: Claude (Opus 4.8) | 2026-09-01
//
// Covers buildShipRoster's shaping contract (0.13.2 Unit 3):
//   - sort orders: attention-first floats a damaged / missing-slot ship to the top;
//     name is A to Z; rating is strongest-first; class sort orders by class label.
//   - class grouping (filterKey "byClass") splits the non-favorites into one group
//     per hull class, ordered by class label.
//   - favorites pin into their own "Favorites" top group; the rest fall under "All ships".
//   - search matches the display name OR the hull-class label.
//   - the needsOrders filter keeps only parked / idle ships.
//   - the attention predicate: damaged is true; a combat hull with an empty required
//     combat slot is true; a fully-installed undamaged ship is false.
//
// State is built from the real freshState() seed (mirroring equipment.test.ts) and
// reshaped one dimension at a time, so the fixtures exercise the production folds
// (equippedFor / computeCombatReadout / shipToCombatant / battleRating), never mocks.
// No em dashes / no "--" as punctuation (project rule): commas, periods, parens only.
// ============================================================================

import { describe, it, expect } from "vitest";
import Decimal from "break_infinity.js";
import { freshState } from "./model";
import type { GameState, ShipInstance, EquipmentInstance, EquipmentSlotType } from "./model";
import { buildShipRoster } from "./shipRoster";

// ----------------------------------------------------------------------------
// Fixtures
// ----------------------------------------------------------------------------

// A fully-shaped EquipmentInstance with inert defaults, fitted to `shipId`. Tests set
// only the fields they isolate (slotType + the stat / weaponType under test). Mirrors
// the combatFit.test / equipment.test factories.
function piece(
	shipId: string,
	slotType: EquipmentSlotType,
	overrides: Partial<EquipmentInstance> = {},
): EquipmentInstance {
	return {
		id: overrides.id ?? `${shipId}-${slotType}`,
		slotType,
		rarity: "standard",
		ascension: "none",
		quality: 0,
		iLevel: 1,
		blueprintKey: null,
		implicitStats: {},
		rolledStats: {},
		mass: 0,
		powerDraw: 0,
		durabilityMax: 100,
		durability: 100,
		fittedToShipId: shipId,
		...overrides,
	};
}

// The three combat pieces that make a hull "fully installed" for the attention
// predicate (a weapon so missingRequired excludes "weapon", plus a shield emitter and
// hull plating). The weapon carries a real weaponType so shipToCombatant can reconstruct
// it (it throws on a weapon piece with no weaponType). `platingHp` lets a test set the
// plating's hullStrength, which raises hullMax (and thus the Battle Rating) predictably.
function combatKit(shipId: string, platingHp = 100): EquipmentInstance[] {
	return [
		piece(shipId, "weapon", { id: `${shipId}-w`, weaponType: "plasma" }),
		piece(shipId, "shieldEmitters", { id: `${shipId}-s`, implicitStats: { shieldCapacity: 200, shieldRecharge: 5 } }),
		piece(shipId, "hullPlating", { id: `${shipId}-h`, implicitStats: { hullStrength: platingHp } }),
	];
}

// Build a ShipInstance off the seeded template, overriding only the row-relevant fields.
function ship(over: Partial<ShipInstance> & { id: string }): ShipInstance {
	return {
		id: over.id,
		typeKey: over.typeKey ?? "destroyer",
		assignedCaptainId: over.assignedCaptainId ?? null,
		name: over.name,
		damaged: over.damaged,
	};
}

// A GameState carrying exactly the given ships + equipment (captains default to the
// freshState seed unless a test overrides them). Everything else is the real seed, so
// the folds run against a valid state.
function stateWith(ships: ShipInstance[], equipment: EquipmentInstance[], captains?: GameState["captains"]): GameState {
	const base = freshState();
	return { ...base, ships, equipment, captains: captains ?? base.captains };
}

// A captain built off the seed template, overriding id / label / mission only.
function captain(over: { id: number; label?: string; mission?: GameState["captains"][number]["mission"] }): GameState["captains"][number] {
	const base = freshState().captains[0];
	return { ...base, id: over.id, label: over.label ?? `Captain ${over.id}`, mission: over.mission ?? null };
}

// A minimal live extraction mission (the "gathering" status), same literal shape
// equipment.test.ts uses for an on-mission captain.
const EXTRACTION_MISSION = {
	kind: "extraction" as const,
	missionKey: "shortOreRun" as const,
	phase: "transitOut" as const,
	phaseProgressTicks: 0,
	recalled: false,
	cargo: { commonOre: new Decimal(0), uncommonMaterial: new Decimal(0), rareMaterial: new Decimal(0) },
};

const NO_FAVORITES = new Set<string>();

// Default opts with the attention sort + all filter + no search + no favorites.
function opts(over: Partial<Parameters<typeof buildShipRoster>[1]> = {}) {
	return {
		sortKey: over.sortKey ?? ("attention" as const),
		filterKey: over.filterKey ?? ("all" as const),
		searchText: over.searchText ?? "",
		favorites: over.favorites ?? NO_FAVORITES,
	};
}

// Flatten a roster to a single ordered id list (groups concatenated in group order),
// for the sort assertions that do not care about grouping.
function flatIds(roster: ReturnType<typeof buildShipRoster>): string[] {
	return roster.groups.flatMap((g) => g.rows.map((r) => r.id));
}

// ----------------------------------------------------------------------------
// Sort orders
// ----------------------------------------------------------------------------

describe("buildShipRoster sort orders", () => {
	it("attention (default) floats a damaged ship above a healthy one", () => {
		const healthy = ship({ id: "ship-A", name: "Healthy", typeKey: "destroyer" });
		const hurt = ship({ id: "ship-B", name: "Hurt", typeKey: "destroyer", damaged: true });
		// Healthy is fully installed (not needing attention); hurt is damaged.
		const equip = [...combatKit("ship-A"), ...combatKit("ship-B")];
		const roster = buildShipRoster(stateWith([healthy, hurt], equip), opts());

		expect(flatIds(roster)[0]).toBe("ship-B"); // damaged floats to the top
		const hurtRow = roster.groups[0].rows.find((r) => r.id === "ship-B");
		expect(hurtRow?.needsAttention).toBe(true);
	});

	it("attention also floats a combat hull with a missing required slot", () => {
		const kitted = ship({ id: "ship-A", name: "Kitted", typeKey: "destroyer" });
		const bare = ship({ id: "ship-B", name: "Bare", typeKey: "destroyer" }); // no combat gear
		const roster = buildShipRoster(stateWith([kitted, bare], combatKit("ship-A")), opts());

		expect(flatIds(roster)[0]).toBe("ship-B"); // missing weapon => needs attention => top
	});

	it("name sorts A to Z", () => {
		const zed = ship({ id: "ship-Z", name: "Zed", typeKey: "destroyer" });
		const alpha = ship({ id: "ship-A", name: "Alpha", typeKey: "destroyer" });
		const equip = [...combatKit("ship-Z"), ...combatKit("ship-A")];
		const roster = buildShipRoster(stateWith([zed, alpha], equip), opts({ sortKey: "name" }));

		expect(flatIds(roster)).toEqual(["ship-A", "ship-Z"]);
	});

	it("rating sorts strongest first", () => {
		// Both fully installed + undamaged (so neither needs attention); the only
		// difference is plating hullStrength, which raises hullMax and thus the rating.
		const strong = ship({ id: "ship-strong", name: "Strong", typeKey: "destroyer" });
		const weak = ship({ id: "ship-weak", name: "Weak", typeKey: "destroyer" });
		const equip = [...combatKit("ship-strong", 5000), ...combatKit("ship-weak", 50)];
		const roster = buildShipRoster(stateWith([strong, weak], equip), opts({ sortKey: "rating" }));

		expect(flatIds(roster)).toEqual(["ship-strong", "ship-weak"]);
	});

	it("class sorts by hull-class label", () => {
		const dest = ship({ id: "ship-D", name: "Zeta", typeKey: "destroyer" }); // "Destroyer"
		const freighter = ship({ id: "ship-F", name: "Alpha", typeKey: "generalFreighter" }); // "General Freighter"
		const equip = [...combatKit("ship-D"), ...combatKit("ship-F")];
		// Despite the name order (Alpha < Zeta), class sort puts Destroyer before General Freighter.
		const roster = buildShipRoster(stateWith([dest, freighter], equip), opts({ sortKey: "class" }));

		expect(flatIds(roster)).toEqual(["ship-D", "ship-F"]);
	});
});

// ----------------------------------------------------------------------------
// Grouping + favorites + search
// ----------------------------------------------------------------------------

describe("buildShipRoster grouping and favorites", () => {
	it("byClass splits non-favorites into per-class groups ordered by class label", () => {
		const dest1 = ship({ id: "ship-D1", name: "D-One", typeKey: "destroyer" });
		const dest2 = ship({ id: "ship-D2", name: "D-Two", typeKey: "destroyer" });
		const freighter = ship({ id: "ship-F", name: "Freight", typeKey: "generalFreighter" });
		const equip = [...combatKit("ship-D1"), ...combatKit("ship-D2"), ...combatKit("ship-F")];
		const roster = buildShipRoster(stateWith([dest1, dest2, freighter], equip), opts({ filterKey: "byClass" }));

		expect(roster.groups.map((g) => g.label)).toEqual(["Destroyer", "General Freighter"]);
		expect(roster.groups[0].rows.map((r) => r.id).sort()).toEqual(["ship-D1", "ship-D2"]);
		expect(roster.groups[1].rows.map((r) => r.id)).toEqual(["ship-F"]);
	});

	it("favorites pin into a Favorites group above an All ships group", () => {
		const fav = ship({ id: "ship-fav", name: "Star", typeKey: "destroyer" });
		const other = ship({ id: "ship-other", name: "Plain", typeKey: "destroyer" });
		const equip = [...combatKit("ship-fav"), ...combatKit("ship-other")];
		const roster = buildShipRoster(
			stateWith([fav, other], equip),
			opts({ favorites: new Set(["ship-fav"]) }),
		);

		expect(roster.groups[0].label).toBe("Favorites");
		expect(roster.groups[0].rows.map((r) => r.id)).toEqual(["ship-fav"]);
		expect(roster.groups[0].rows[0].favorite).toBe(true);
		expect(roster.groups[1].label).toBe("All ships");
		expect(roster.groups[1].rows.map((r) => r.id)).toEqual(["ship-other"]);
	});

	it("with no favorites the single group is header-less (label null)", () => {
		const only = ship({ id: "ship-A", name: "Solo", typeKey: "destroyer" });
		const roster = buildShipRoster(stateWith([only], combatKit("ship-A")), opts());

		expect(roster.groups).toHaveLength(1);
		expect(roster.groups[0].label).toBeNull();
	});

	it("search matches the display name OR the hull-class label", () => {
		const falcon = ship({ id: "ship-falcon", name: "Falcon", typeKey: "destroyer" });
		const hawk = ship({ id: "ship-hawk", name: "Hawk", typeKey: "generalFreighter" });
		const equip = [...combatKit("ship-falcon"), ...combatKit("ship-hawk")];
		const st = stateWith([falcon, hawk], equip);

		// Name match.
		expect(flatIds(buildShipRoster(st, opts({ searchText: "falcon" })))).toEqual(["ship-falcon"]);
		// Class match ("Destroyer" contains the needle) finds the destroyer only.
		expect(flatIds(buildShipRoster(st, opts({ searchText: "destroyer" })))).toEqual(["ship-falcon"]);
		// Class match on the freighter.
		expect(flatIds(buildShipRoster(st, opts({ searchText: "freighter" })))).toEqual(["ship-hawk"]);
		// No match => empty.
		expect(flatIds(buildShipRoster(st, opts({ searchText: "zzz" })))).toEqual([]);
	});

	it("needsOrders keeps only parked or idle ships", () => {
		// parked (no captain), idle (captain, no mission), gathering (captain on extraction).
		const parkedShip = ship({ id: "ship-parked", name: "Parked", typeKey: "destroyer", assignedCaptainId: null });
		const idleShip = ship({ id: "ship-idle", name: "Idle", typeKey: "destroyer", assignedCaptainId: 10 });
		const busyShip = ship({ id: "ship-busy", name: "Busy", typeKey: "destroyer", assignedCaptainId: 11 });
		const caps = [
			captain({ id: 10 }), // idle
			captain({ id: 11, mission: EXTRACTION_MISSION }), // gathering
		];
		const equip = [...combatKit("ship-parked"), ...combatKit("ship-idle"), ...combatKit("ship-busy")];
		const roster = buildShipRoster(
			stateWith([parkedShip, idleShip, busyShip], equip, caps),
			opts({ filterKey: "needsOrders" }),
		);

		const ids = flatIds(roster).sort();
		expect(ids).toEqual(["ship-idle", "ship-parked"]); // busy (gathering) excluded
	});
});

// ----------------------------------------------------------------------------
// Attention predicate + status
// ----------------------------------------------------------------------------

describe("buildShipRoster attention predicate", () => {
	function rowFor(st: GameState, id: string) {
		const roster = buildShipRoster(st, opts());
		return roster.groups.flatMap((g) => g.rows).find((r) => r.id === id) ?? null;
	}

	it("flags a damaged ship (reason Damaged), even when fully installed", () => {
		const hurt = ship({ id: "ship-A", name: "Hurt", typeKey: "destroyer", damaged: true });
		const row = rowFor(stateWith([hurt], combatKit("ship-A")), "ship-A");
		expect(row?.needsAttention).toBe(true);
		expect(row?.attentionReason).toBe("Damaged");
		expect(row?.damaged).toBe(true);
	});

	it("flags a combat hull with an empty required slot (reason names the slot)", () => {
		const bare = ship({ id: "ship-A", name: "Bare", typeKey: "destroyer" });
		const row = rowFor(stateWith([bare], []), "ship-A"); // no gear at all
		expect(row?.needsAttention).toBe(true);
		expect(row?.attentionReason).toBe("Needs a weapon");
		expect(row?.damaged).toBe(false);
	});

	it("does NOT flag a fully-installed, undamaged ship", () => {
		const good = ship({ id: "ship-A", name: "Good", typeKey: "destroyer" });
		const row = rowFor(stateWith([good], combatKit("ship-A")), "ship-A");
		expect(row?.needsAttention).toBe(false);
		expect(row?.attentionReason).toBeNull();
	});

	it("derives status + captain from the assigned captain's mission", () => {
		const parkedShip = ship({ id: "ship-P", name: "P", typeKey: "destroyer", assignedCaptainId: null });
		const idleShip = ship({ id: "ship-I", name: "I", typeKey: "destroyer", assignedCaptainId: 20 });
		const busyShip = ship({ id: "ship-G", name: "G", typeKey: "destroyer", assignedCaptainId: 21 });
		const caps = [
			captain({ id: 20, label: "Ada" }),
			captain({ id: 21, label: "Boyd", mission: EXTRACTION_MISSION }),
		];
		const equip = [...combatKit("ship-P"), ...combatKit("ship-I"), ...combatKit("ship-G")];
		const st = stateWith([parkedShip, idleShip, busyShip], equip, caps);

		expect(rowFor(st, "ship-P")).toMatchObject({ status: "parked", captainName: null });
		expect(rowFor(st, "ship-I")).toMatchObject({ status: "idle", captainName: "Ada" });
		expect(rowFor(st, "ship-G")).toMatchObject({ status: "gathering", captainName: "Boyd" });
	});
});
