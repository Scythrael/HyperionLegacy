// Reactor tech foundation + the reactor fuel ladder (0.14.0; capture docs/plans/2026-10-21-reactor-fuel-and-recipe-
// realism-capture.md, the user's words in section 1 and USER ANSWERS in section 5; the recipe realism audit
// docs/plans/2026-10-21-recipe-realism-audit.md section 4.3 and its USER ANSWERS Group A).
//
// The user (2026-10-21): "All reactor core crafting recipes should ultimately require something like this since that
// makes sense", the ladder "Deuterium, then Helium-3", the transitional tech "Antimatter-catalyzed fusion", and the
// foundation "Data model + hooks": reactor tech tiers, fuel per tier and a per-hull-tier power generation requirement
// seam, wired and tested, no new reactors in 0.14.0. Audit Group A: Deuterium Canisters per core 1 / 1 / 2 (Balanced,
// Efficient, High-Output), Helium-3 in NO reactor in 0.14.0 ("reactors take it in the balancing patch"), and the ladder
// as tabled in audit 4.3: fusion on Deuterium, Deuterium-Helium-3 fusion, antimatter-catalyzed fusion (Helium-3 plus a
// cell), antimatter reactors on cells. Section 6 of the capture: a tier above antimatter (zero-point energy) may come
// later, so a tier is a ROW of data here: adding one is a new id, a new row in REACTOR_TECH_TIERS and its fuel in
// REACTOR_FUEL_LADDER, never a redesign.
//
// What acts today:
//   - every Reactor Core blueprint's recipe carries its fuel (model.ts BLUEPRINTS, reactorCoreFuel): a Fabricator
//     craft spends it like any other input. All three cores are fusion cores of blueprint tier I or II, so all three
//     burn Deuterium Canisters (Deuterium Ice refined 10:1 at the Refinery; the Cometary Ice Harvest, open from day
//     one, brings the ice in), and none can ever wait on Helium-3 or antimatter.
//   - the EM-1 power budget names the installed core's tech tier (shipPower.ts shipPowerBudget.reactorTech) and the
//     hull tier's requirement, through requiredReactorTech below.
// What waits (wiring registry, registry.ts reactorTechEntries, all SEAMS for the balancing patch): the larger fusion
// cores' rung (blueprint tier III and up), the three higher tech tiers' fuel, and the hull tier requirement (the user:
// "Probably a requirement of power generation on T7 ships. Which likely won't appear until at least the balancing
// patch"). A rung goes live by itself the moment a Reactor Core blueprint reads it.
//
// Pure data and pure functions; no imports, so model.ts can read it without a cycle.

// The reactor tech tiers, in order. A new tier (zero-point energy, section 6) is a new id here and a new row below.
export type ReactorTechId = "fusion" | "deuteriumHelium3Fusion" | "antimatterCatalyzedFusion" | "antimatter";

// One rung of a tier's fuel ladder: from this blueprint tier up (until the next rung), a reactor of the tier is
// crafted with `fuel` (item id -> count per craft).
export interface ReactorFuelRung {
  readonly fromBlueprintTier: number;
  readonly fuel: Readonly<Record<string, number>>;
}

export interface ReactorTechDef {
  readonly id: ReactorTechId;
  readonly label: string;
  readonly rank: number; // 1 = fusion; a tier meets a requirement of its own rank or lower
  readonly science: string; // the real or theorized science the tier follows
  readonly fuelLadder: readonly ReactorFuelRung[];
}

// The fuel each tech tier's Reactor Core blueprints take, per craft, by blueprint tier.
// - fusion (deuterium-deuterium; today's three cores): the user's counts (audit Group A call 1, "1 / 1 / 2") read as
//   one Deuterium Canister for a tier I core and two for a tier II core (the Balanced and Efficient Cores are tier I,
//   the High-Output Core tier II). [PROPOSAL] tier III and up (audit 4.3 "Fusion, larger cores": more Deuterium per
//   core): three canisters, a balancing patch seam.
// - deuteriumHelium3Fusion, antimatterCatalyzedFusion, antimatter: the audit 4.3 bands, no reactor yet (balancing
//   patch seams). [PROPOSAL] amounts: Deuterium-Helium-3 fusion 1 Deuterium + 1 Helium-3 Canister (the table names the
//   gas, "with Deuterium", not the counts); antimatter-catalyzed fusion 2 Helium-3 + 1 Antimatter Containment Cell and
//   antimatter 3 cells (the audit's [PROPOSAL] amounts).
export const REACTOR_FUEL_LADDER: Readonly<Record<ReactorTechId, readonly ReactorFuelRung[]>> = {
  fusion: [
    { fromBlueprintTier: 1, fuel: { deuteriumCanister: 1 } },
    { fromBlueprintTier: 2, fuel: { deuteriumCanister: 2 } },
    { fromBlueprintTier: 3, fuel: { deuteriumCanister: 3 } },
  ],
  deuteriumHelium3Fusion: [{ fromBlueprintTier: 1, fuel: { deuteriumCanister: 1, helium3Canister: 1 } }],
  antimatterCatalyzedFusion: [{ fromBlueprintTier: 1, fuel: { helium3Canister: 2, antimatterCell: 1 } }],
  antimatter: [{ fromBlueprintTier: 1, fuel: { antimatterCell: 3 } }],
};

export const REACTOR_TECH_TIERS: readonly ReactorTechDef[] = [
  {
    id: "fusion",
    label: "Fusion",
    rank: 1,
    science: "Deuterium-deuterium fusion: it needs no tritium, and deuterium is real in comet and moon ice",
    fuelLadder: REACTOR_FUEL_LADDER.fusion,
  },
  {
    id: "deuteriumHelium3Fusion",
    label: "Deuterium-Helium-3 Fusion",
    rank: 2,
    science: "Deuterium and helium-3 release mostly charged particles and far fewer neutrons: less shielding, direct power conversion",
    fuelLadder: REACTOR_FUEL_LADDER.deuteriumHelium3Fusion,
  },
  {
    id: "antimatterCatalyzedFusion",
    label: "Antimatter-Catalyzed Fusion",
    rank: 3,
    science: "A small antiproton pulse ignites a fusion pellet (the Penn State ICAN-II and AIMStar studies)",
    fuelLadder: REACTOR_FUEL_LADDER.antimatterCatalyzedFusion,
  },
  {
    id: "antimatter",
    label: "Antimatter",
    rank: 4,
    science: "Matter and antimatter annihilate, antiprotons held in a magnetic trap (real lab traps hold them today)",
    fuelLadder: REACTOR_FUEL_LADDER.antimatter,
  },
];

const BY_ID: ReadonlyMap<ReactorTechId, ReactorTechDef> = new Map(REACTOR_TECH_TIERS.map((t) => [t.id, t]));

export function reactorTechDef(id: ReactorTechId): ReactorTechDef {
  const def = BY_ID.get(id);
  if (!def) throw new Error(`unknown reactor tech ${id}`);
  return def;
}

// Every Reactor Core variety's tech tier (model.ts EQUIPMENT_SLOTS.reactorCore.varieties; a test holds the two lists
// equal, so a new variety cannot ship untagged). All fusion today. The Standard-Issue core is the slot's default
// variety (model.ts DEFAULT_EQUIPMENT_VARIETY.reactorCore, balancedCore), so it reads fusion too.
export const REACTOR_VARIETY_TECH: Readonly<Record<string, ReactorTechId>> = {
  highOutputCore: "fusion",
  efficientCore: "fusion",
  balancedCore: "fusion",
};

// The fuel rung a reactor of `tech` reads at blueprint tier `blueprintTier`: the last rung starting at or below it.
export function reactorFuelRung(tech: ReactorTechId, blueprintTier: number): ReactorFuelRung {
  const ladder = reactorTechDef(tech).fuelLadder;
  let rung = ladder[0];
  for (const r of ladder) if (r.fromBlueprintTier <= blueprintTier) rung = r;
  return rung;
}

// The fuel inputs a Reactor Core blueprint of `varietyKey` at `blueprintTier` takes (a fresh object, spread LAST into
// the recipe so every older input keeps its place: salvage draws its rounding per input in recipe order).
export function reactorCoreFuel(varietyKey: string, blueprintTier: number): Record<string, number> {
  const tech = REACTOR_VARIETY_TECH[varietyKey];
  if (!tech) throw new Error(`reactor variety ${varietyKey} has no tech tier`);
  return { ...reactorFuelRung(tech, blueprintTier).fuel };
}

// The per-hull-tier power generation requirement: the lowest reactor tech a hull of that tier must have installed.
// EMPTY in 0.14.0 (no requirement is active, so nothing reads as inert to a player). The balancing patch adds its rows
// (the user: Tier VII hulls likely require antimatter); registry entry ship:SHIP_SEAMS:hullReactorRequirement.
export const HULL_TIER_REACTOR_REQUIREMENT: Readonly<Partial<Record<number, ReactorTechId>>> = {};

// The requirement a hull of `hullTier` reads: the row at the highest tier at or below it (a requirement holds for
// every tier above it until another row raises it), or null. `table` is the seam's test hook. Pure.
export function requiredReactorTech(
  hullTier: number,
  table: Readonly<Partial<Record<number, ReactorTechId>>> = HULL_TIER_REACTOR_REQUIREMENT,
): ReactorTechId | null {
  let best: { tier: number; tech: ReactorTechId } | null = null;
  for (const [k, tech] of Object.entries(table)) {
    const tier = Number(k);
    if (tech !== undefined && tier <= hullTier && (best === null || tier > best.tier)) best = { tier, tech };
  }
  return best?.tech ?? null;
}

// Whether an installed reactor tech meets a requirement: no requirement always does; a requirement needs an installed
// reactor of its rank or higher (a hull with no Reactor Core installed meets none). Pure.
export function meetsReactorRequirement(installed: ReactorTechId | null, required: ReactorTechId | null): boolean {
  if (required === null) return true;
  if (installed === null) return false;
  return reactorTechDef(installed).rank >= reactorTechDef(required).rank;
}
