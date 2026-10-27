// WR-3 (0.14.0, plan docs/plans/2026-10-15-wiring-registry-and-audit-plan.md): the Debug "Wiring" panel's OWNERSHIP
// readers, by registry catalog: does the measured subject on a live save own an entry's source, and the same save
// without it. The view model (src/lib/wiringPanelDisplay.ts) measures with them.
//
// It lives beside the registry (not in src/lib) because it is keyed by catalog NAME: the completeness test's
// unread-constant scan skips this folder, so a catalog named here never counts as a read of that constant.
// Pure: nothing here writes state; every "without" state is a fresh copy. It imports the registry and probes as
// TYPES only, so the app bundle never carries them (the panel loads them lazily).
//
// What the probes read (probes.ts): ship-1, captain 1 and the fixture member ids. On a live save the panel MEASURES
// those subjects: ship-1, captain 1, and the first Security and first Science member aboard ship-1 (aliased to the
// fixture ids in a probe view, `wiringProbeView`). Ownership is judged on the same subjects, so a source owned
// elsewhere in the fleet reads "not owned" here rather than a false "contributing nothing".

import type { WiringEntry } from "./registry";
import {
  HOMEWORLD_TALENTS,
  SHIP_DOCKS_BASE,
  SUBSPACE_TELESCOPE_FACILITY_KEY,
  type CrewBucket,
  type EquipmentInstance,
  type GameState,
  type HomeworldTalentKey,
  isStandardIssueBaseline,
  emptyMuseumV2,
  withGeneralMuseumRecord,
  type MuseumV2,
  type RegionTierKey,
} from "../model";
import { EXCEPTIONAL_SETS, MUSEUM_COPY_LADDER, RELIC_SETS, museumActiveRecord, museumBonuses, type MuseumStat } from "../relics";
import { OFFICER_STAT_NEUTRAL } from "../officerStats";
import { CREW_RACES } from "../crewRaces";
import { CREW_STAT_KEYS } from "../crewBuffs";

// The subjects the probes read (probes.ts WIRING_SHIP_ID, WIRING_CAPTAIN_ID, WIRING_SECURITY_ID, WIRING_SCIENCE_ID;
// repeated here so the panel never imports probes.ts statically; the test pins them equal).
export const PANEL_SHIP_ID = "ship-1";
export const PANEL_CAPTAIN_ID = 1;
export const PANEL_SECURITY_ID = "member-901";
export const PANEL_SCIENCE_ID = "member-902";
// The id an engine reader ignores: an officer bonus or crew buff swapped to it acts on nothing (the fixtures use it).
const NONE_ID = "wiring.none";
// The panel's neutral race (probes.ts FIXTURE_RACE): the Belter, whose racial acts only on a carrier's patrol drone
// screen. Every racial acts since 0.14.0, so the Belter itself is measured against the Spacer (transit speed), which
// never touches the drone screen its probe reads.
const INERT_RACE = "belter";
const neutralRaceFor = (race: string): string => (race === INERT_RACE ? "spacer" : INERT_RACE);
// Deck Handling (the Flight Deck buff and the Belter racial) acts only on a drone screen; a ship that installs no drone
// bay owns it but has nothing for it to act on, which is not a dead wire.
const DRONELESS_NOTE = "acts on a patrol's drone screen; this ship installs no drone bay";
const fieldsNoDrones = (s: GameState): boolean => !s.equipment.some((e) => e.fittedToShipId === PANEL_SHIP_ID && e.slotType === "droneBay");

export type Ownership = "owned" | "notOwned" | "content" | "unmeasured";

// ============================================================================
// The probe view: the save, with its measured members under the fixture ids
// ============================================================================

function renameMember(s: GameState, from: string, to: string): GameState {
  const swap = (id: string | null | undefined) => (id === from ? to : id);
  const fromJson = JSON.stringify(from);
  const toJson = JSON.stringify(to);
  return {
    ...s,
    awayMembers: s.awayMembers.map((m) => (m.id === from ? { ...m, id: to } : m)),
    equipment: s.equipment.map((e) => (e.fittedToMemberId === from ? { ...e, fittedToMemberId: swap(e.fittedToMemberId) } : e)),
    ships: s.ships.map((sh) =>
      sh.groundTeams && JSON.stringify(sh.groundTeams).includes(fromJson)
        ? { ...sh, groundTeams: JSON.parse(JSON.stringify(sh.groundTeams).split(fromJson).join(toJson)) }
        : sh,
    ),
  };
}

// The first Security and the first Science member aboard ship-1 take the fixture member ids (a member already
// holding a fixture id elsewhere steps aside under a panel-only id). A save with nobody aboard is returned as is.
export function wiringProbeView(save: GameState): GameState {
  let v = save;
  const pairs: [string, string][] = [
    ["security", PANEL_SECURITY_ID],
    ["science", PANEL_SCIENCE_ID],
  ];
  for (const [team, fixtureId] of pairs) {
    const measured = v.awayMembers.find((m) => m.assignedShipId === PANEL_SHIP_ID && m.teamType === team);
    if (!measured || measured.id === fixtureId) continue;
    if (v.awayMembers.some((m) => m.id === fixtureId)) v = renameMember(v, fixtureId, `wiring-panel-aside-${fixtureId}`);
    v = renameMember(v, measured.id, fixtureId);
  }
  return v;
}

// ============================================================================
// Ownership: per catalog, does the measured subject own the source, and the save without it
// ============================================================================

export interface Owned {
  readonly ownership: Ownership;
  readonly withState?: GameState; // default: the probe view itself
  readonly withoutState?: GameState;
  readonly measure?: boolean; // false: owned but not removable here (note says why)
  readonly note?: string;
}

const NOT_OWNED: Owned = { ownership: "notOwned" };

// Game data every save plays with (missions, enemies, content tables): proved by the sensitivity suite, not owned.
export const CONTENT_CATALOGS: ReadonlySet<string> = new Set([
  "MISSIONS",
  "SHORT_RANGE_TEMPLATES", // G1-2: the short-range jobs, content like MISSIONS
  "PATROLS",
  "WEAPON_DEFS",
  "ROLE_TEMPLATE",
  "PIRATE_HULLS",
  "STATUS_EFFECT_DEFS",
  "GAMBIT_STATUSES",
  "GAMBIT_ACTIONS",
  "GAMBIT_SELECTORS",
  "GAMBIT_PRESETS",
  "POI_CATALOG",
  "PLANET_TYPES",
  "SALVAGE_LOOT_POOLS",
  "ITEMS",
  "AFFIX_DEFS",
  "AFFIX_ESCALATION",
  "ENEMY_RANKS",
  "REFINE_RECIPES",
  "BLUEPRINTS",
  "FIELD_KITS",
  "KIT_CATEGORY_RULES",
  "CONDITION_LINES",
  "FREE_BASIC_SET",
  "FIELD_KIT_PRICES",
  // Field Kits FKR-5: the grenade family's charges, throws, blast and debuff (catalog facts of the grenade varieties).
  "GRENADES",
  "GROUND_CONDITIONS",
  "SPEED_SEAM",
  // Gear wear (0.14.0): the wear sources, repair rates and bonuses and efficiency consumers every piece plays by.
  // Rarity readiness RR-3: the per-rarity rows every minted piece rolls by (content, like the loot pools).
  "RARITY_PROFILES",
  "ASCENSION_BUDGET_MULT", // RR-4: the ascension rows, content like the rarity rows
  "LUMINOUS_AFFIXES", // RR-5: the legendary affix rows a Luminous piece rolls (content)
  "MODULE_RARITY_FACTOR", // review of RR-3 / RR-4: the module effect factor per band (content)
  "GEAR_SETS", // RR-6: the gear set tiers (content)
  "WEAR_SOURCES",
  "REPAIR_RATES",
  "REPAIR_RATE_BONUSES",
  "WEAR_EFFICIENCY",
  // Reactor fuel ladder (0.14.0): the fuel each Reactor Core recipe takes, and each core variety's tech tier.
  "REACTOR_TECH_TIERS",
  "REACTOR_VARIETY_TECH",
]);

// Sources the panel does not judge ownership of, each with why (a NEW catalog must join a list: the test fails).
export const UNMEASURED_CATALOGS: Readonly<Record<string, string>> = {
  AWAY_TEAM_STRENGTH: "derived from the squad and its kit",
  MEMBER_GROUND_EFFECTS: "derived from the gear a member wears (see the member gear rows)",
  MEMBER_PERKS: "a member perk (no owner reader in the panel)",
  GAMBIT_PROGRAMS: "the account gambit pair (no owner reader in the panel)",
  AUDIT: "an audit row: no catalog source to own",
  SHIP_SEAMS: "a framework seam: nothing to own",
  "SHIP_TYPES.missing": "a claimed hull attribute with no field",
  PROSPECTING_SPEC_BASE: "hidden until the prospecting quests patch",
  PROSPECTING_BLUEPRINTS: "hidden until the prospecting quests patch",
  PROSPECTING_USES: "hidden until the prospecting quests patch",
  // Gas Giant Study: the engine (gasGiantStudy.ts) reads the classes on a run, never off a ship the panel owns.
  GAS_STUDY_USES: "the gas giant study engine's uses (GG-2 to GG-7 live): read on a run, by the Research Lab or by the Fabricator, no owner reader",
  GIANT_CLASSES: "read by the giant class roll and the study reward on a run (GG-2, GG-3): no owner reader in the panel",
  NEBULA_KINDS: "read by the nebula sweep's reward on a run (GG-4): no owner reader in the panel",
  GAS_STUDY_SEAM: "a framework seam (the probe dive, read by gear wear step 3): nothing to own",
  // GG-5: the Research Lab's data study lane is account-level (the Lab, the banked boosts), never a ship's.
  DATA_STUDY: "the Research Lab's data study lane (GG-5): account-level, no ship owner reader",
  DATA_STUDY_SEAM: "a framework seam (the decode gate, read by GG-7's special blueprints): nothing to own",
};

const shipOf = (s: GameState) => s.ships.find((sh) => sh.id === PANEL_SHIP_ID);
const captainOf = (s: GameState) => s.captains.find((c) => c.id === PANEL_CAPTAIN_ID);
const officersAboard = (s: GameState) => s.officers.filter((o) => o.assignedShipId === PANEL_SHIP_ID);
const bucketsAboard = (s: GameState): readonly CrewBucket[] => shipOf(s)?.complement?.buckets ?? [];
const installed = (s: GameState) => s.equipment.filter((e) => e.fittedToShipId === PANEL_SHIP_ID);
const hasLine = (e: EquipmentInstance, line: string) => (e.implicitStats?.[line] ?? 0) !== 0 || (e.rolledStats?.[line] ?? 0) !== 0;

function editCaptainIn(s: GameState, edit: (c: GameState["captains"][number]) => GameState["captains"][number]): GameState {
  return { ...s, captains: s.captains.map((c) => (c.id === PANEL_CAPTAIN_ID ? edit(c) : c)) };
}

function editBuckets(s: GameState, edit: (b: CrewBucket) => CrewBucket): GameState {
  return {
    ...s,
    ships: s.ships.map((sh) =>
      sh.id === PANEL_SHIP_ID && sh.complement ? { ...sh, complement: { ...sh.complement, buckets: sh.complement.buckets.map(edit) } } : sh,
    ),
  };
}

function dropLine(s: GameState, match: (e: EquipmentInstance) => boolean, line: string): GameState {
  const strip = (rec: Record<string, number> | undefined) => {
    if (!rec || !(line in rec)) return rec;
    const { [line]: _gone, ...rest } = rec;
    return rest;
  };
  return {
    ...s,
    equipment: s.equipment.map((e) =>
      match(e) && hasLine(e, line) ? ({ ...e, implicitStats: strip(e.implicitStats), rolledStats: strip(e.rolledStats) } as EquipmentInstance) : e,
    ),
  };
}

function uninstall(s: GameState, match: (e: EquipmentInstance) => boolean): GameState {
  return { ...s, equipment: s.equipment.map((e) => (match(e) ? { ...e, fittedToShipId: null } : e)) };
}

// Relics v2 R2-4: the Museum tiers the D23 curve serves, and the state with some ids removed from some tiers' general
// copies and snapshots, or some exceptional pieces removed.
const CURVED_TIER_KEYS: readonly RegionTierKey[] = ["2", "3", "4", "5", "6", "7"];
function withoutMuseumIds(v: GameState, tiers: readonly RegionTierKey[], ids: readonly string[]): GameState {
  const m: MuseumV2 = v.museumV2 ?? emptyMuseumV2();
  const strip = (part: MuseumV2["general"]): MuseumV2["general"] => {
    const out = { ...part };
    for (const t of tiers) {
      const rec = out[t];
      if (!rec) continue;
      out[t] = Object.fromEntries(Object.entries(rec).filter(([id]) => !ids.includes(id)));
    }
    return out;
  };
  return { ...v, museumV2: { ...m, general: strip(m.general), frozen: strip(m.frozen) } };
}
function withoutPieces(v: GameState, ids: readonly string[]): GameState {
  const m: MuseumV2 = v.museumV2 ?? emptyMuseumV2();
  return { ...v, museumV2: { ...m, exceptional: Object.fromEntries(Object.entries(m.exceptional).filter(([id]) => !ids.includes(id))) } };
}

function owned(withoutState: GameState, note?: string): Owned {
  return { ownership: "owned", withoutState, ...(note ? { note } : {}) };
}

// A rung of a level track: the save owns it when its level is past the rung; measured as the rung's own step (the
// entry's on vs off on this save), so a higher rung is not counted in a lower one.
function rung(e: WiringEntry, v: GameState, ownsIt: boolean): Owned {
  return ownsIt ? { ownership: "owned", withState: e.on(v), withoutState: e.off(v), note: "measured as this rung's own step" } : NOT_OWNED;
}

const MEMBER_OF_TEAM: Readonly<Record<string, string>> = { security: PANEL_SECURITY_ID, science: PANEL_SCIENCE_ID };

type Adapter = (e: WiringEntry, v: GameState, key: string) => Owned;

const ADAPTERS: Readonly<Record<string, Adapter>> = {
  SENIOR_STAFF_BONUSES: (_e, v, key) => {
    if (!officersAboard(v).some((o) => o.bonuses.some((b) => b.id === key))) return NOT_OWNED;
    return owned({
      ...v,
      officers: v.officers.map((o) =>
        o.assignedShipId === PANEL_SHIP_ID && o.bonuses.some((b) => b.id === key)
          ? { ...o, bonuses: o.bonuses.map((b) => (b.id === key ? { id: NONE_ID, magnitude: 0 } : b)) as typeof o.bonuses }
          : o,
      ),
    });
  },
  CREW_PROFESSION_BUFFS: (_e, v, key) => crewBuff(v, key),
  SECOND_LEVEL_EXCLUSIVE: (_e, v, key) => crewBuff(v, key),
  CREW_RACES: (_e, v, key) => {
    // The racial acts through the ship's officers and complement (CREW_RACES racialBonus), not the away squads.
    const has = officersAboard(v).some((o) => o.race === key) || bucketsAboard(v).some((b) => b.race === key);
    if (!has) return NOT_OWNED;
    const statKey = CREW_RACES[key as keyof typeof CREW_RACES]?.racialBonus.statKey;
    if (statKey === CREW_STAT_KEYS.droneHandling && fieldsNoDrones(v)) return { ownership: "owned", measure: false, note: DRONELESS_NOTE };
    const neutral = neutralRaceFor(key);
    const toInert = <T extends { race: string }>(x: T): T => (x.race === key ? { ...x, race: neutral } : x);
    const s1 = { ...v, officers: v.officers.map((o) => (o.assignedShipId === PANEL_SHIP_ID ? toInert(o) : o)) } as GameState;
    const label = neutral === "spacer" ? "Spacers (transit speed only)" : "Belters (a carrier's drone replenish only)";
    return owned(editBuckets(s1, (b) => toInert(b)), `without = the same officers and crew as ${label}`);
  },
  OFFICER_STAT_FACETS: (_e, v, key) => {
    const [seat, stat] = key.split(":");
    const has = (o: GameState["officers"][number]) =>
      o.assignedShipId === PANEL_SHIP_ID && o.seat === seat && o.stats !== undefined && (o.stats as unknown as Record<string, number>)[stat] !== OFFICER_STAT_NEUTRAL;
    if (!v.officers.some(has)) return NOT_OWNED;
    return owned(
      { ...v, officers: v.officers.map((o) => (has(o) ? { ...o, stats: { ...o.stats!, [stat]: OFFICER_STAT_NEUTRAL } } : o)) },
      `without = that stat at the neutral ${OFFICER_STAT_NEUTRAL}`,
    );
  },
  AWAY_TRAITS: (_e, v, key) => {
    const measured = (id: string) => id === PANEL_SECURITY_ID || id === PANEL_SCIENCE_ID;
    if (!v.awayMembers.some((m) => measured(m.id) && (m.traits as readonly string[]).includes(key))) return NOT_OWNED;
    return owned({
      ...v,
      awayMembers: v.awayMembers.map((m) => (measured(m.id) ? { ...m, traits: m.traits.filter((t) => t !== key) } : m)),
    });
  },
  "EQUIPMENT_SLOTS.member": (_e, v, key) => {
    const [slotType, variant, team, line] = key.split(":");
    const memberId = MEMBER_OF_TEAM[team];
    if (!memberId) return NOT_OWNED;
    const match = (e: EquipmentInstance) => e.fittedToMemberId === memberId && e.slotType === slotType && e.moduleVariant === variant;
    if (!v.equipment.some((e) => match(e) && hasLine(e, line))) return NOT_OWNED;
    return owned(dropLine(v, match, line));
  },
  // 0.14.0: a Quartermaster Standard-Issue member line, owned when the measured member wears that issued piece.
  STANDARD_ISSUE_MEMBER_SHARES: (_e, v, key) => {
    const [slotType, variant, team, line] = key.split(":");
    const memberId = MEMBER_OF_TEAM[team];
    if (!memberId) return NOT_OWNED;
    const match = (e: EquipmentInstance) =>
      e.fittedToMemberId === memberId && e.slotType === slotType && e.moduleVariant === variant && isStandardIssueBaseline(e);
    if (!v.equipment.some((e) => match(e) && hasLine(e, line))) return NOT_OWNED;
    return owned(dropLine(v, match, line));
  },
  CAPTAIN_TALENTS: (_e, v, key) =>
    (captainOf(v)?.unlockedCaptainTalents as readonly string[] | undefined)?.includes(key)
      ? owned(editCaptainIn(v, (c) => ({ ...c, unlockedCaptainTalents: c.unlockedCaptainTalents.filter((k) => k !== key) })))
      : NOT_OWNED,
  CAPTAIN_SPEC_BONUS: (_e, v, key) => (captainOf(v)?.spec === key ? owned(editCaptainIn(v, (c) => ({ ...c, spec: null }))) : NOT_OWNED),
  SECONDARY_CAPTAIN_TALENTS: (_e, v, key) => {
    const node = key.split(":")[0];
    return (captainOf(v)?.unlockedSecondaryTalents as readonly string[] | undefined)?.includes(node)
      ? owned(editCaptainIn(v, (c) => ({ ...c, unlockedSecondaryTalents: c.unlockedSecondaryTalents.filter((k) => k !== node) })))
      : NOT_OWNED;
  },
  CAPTAIN_PROGRESSION: (_e, v, key) => {
    // WR-6: a captain race is owned when captain 1 carries one ("without" drops it). The registry measures a
    // Station-born captain, so the expected value is that race's.
    if (key === "race") return captainOf(v)?.race ? owned(editCaptainIn(v, (c) => ({ ...c, race: undefined }))) : NOT_OWNED;
    if (key !== "retirementExpMultiplier") return { ownership: "unmeasured", note: "no owner reader in the panel" };
    return (captainOf(v)?.retirements ?? 0) > 0 ? owned(editCaptainIn(v, (c) => ({ ...c, retirements: 0 }))) : NOT_OWNED;
  },
  HOMEWORLD_TALENTS: (_e, v, key) => {
    const node = key.split(":")[0] as HomeworldTalentKey;
    if (!v.unlockedHomeworldTalents.includes(node)) return NOT_OWNED;
    if (HOMEWORLD_TALENTS[node]?.effect.type === "unlockCaptainSlot")
      return { ownership: "owned", measure: false, note: "a one-time grant at purchase (a captain and a hull)" };
    return owned({ ...v, unlockedHomeworldTalents: v.unlockedHomeworldTalents.filter((k) => k !== node) });
  },
  FACILITIES: (e, v, key) => {
    const [fkey, i] = key.split(":");
    return rung(e, v, (v.facilities[fkey]?.level ?? 0) > Number(i));
  },
  EQUIPMENT_STORAGE_RUNGS: (e, v, key) => rung(e, v, v.equipmentStorageLevel > Number(key)),
  TRANSIT_BERTH_RUNGS: (e, v, key) => rung(e, v, v.transitBerthCapacity > Number(key)),
  SUBSPACE_TELESCOPE_LEVELS: (e, v, key) => rung(e, v, (v.facilities[SUBSPACE_TELESCOPE_FACILITY_KEY]?.level ?? 0) >= Number(key.split(":")[0])),
  SHIP_DOCKS_RUNGS: (_e, v, key) => {
    const cap = SHIP_DOCKS_BASE + Number(key);
    return v.shipStorageCapacity > cap
      ? { ownership: "owned", withState: { ...v, shipStorageCapacity: cap + 1 }, withoutState: { ...v, shipStorageCapacity: cap }, note: "measured as this rung's own step" }
      : NOT_OWNED;
  },
  SHIP_GEAR_LINES: (_e, v, key) => {
    const match = (e: EquipmentInstance) => e.fittedToShipId === PANEL_SHIP_ID;
    if (!installed(v).some((e) => hasLine(e, key))) return NOT_OWNED;
    if (key === "massReduction") return { ownership: "owned", measure: false, note: "consumed at mint into the piece's mass" };
    return owned(dropLine(v, match, key));
  },
  SHIP_TYPES: (_e, v, key) =>
    shipOf(v)?.typeKey === key.split(":")[0] ? { ownership: "owned", measure: false, note: "hull data, read verbatim (the sensitivity suite proves it)" } : NOT_OWNED,
  QUARTERS_MODULES: (_e, v, key) => moduleOn(v, "quarters", key.split(":")[0]),
  BRIDGE_MODULES: (_e, v, key) => moduleOn(v, "bridge", key.split(":")[0]),
  SENSOR_ARRAYS: (_e, v, key) => moduleOn(v, "sensor", key.split(":")[0]),
  // E-MOD EM-7: a universal module installed on the measured ship.
  UNIVERSAL_MODULES: (_e, v, key) => moduleOn(v, "module", key),
  MUSEUM_STATS: (_e, v, key) =>
    (museumBonuses(v)[key as MuseumStat] ?? 0) !== 0 ? owned({ ...v, museumV2: emptyMuseumV2() }, "without = an empty Museum (the stat's whole total)") : NOT_OWNED,
  // Relics v2 R2-4: a general type's copies at Tiers II to VII (its Tier I copies are its RELICS row).
  RELIC_TYPES: (_e, v, key) => {
    const tiers = CURVED_TIER_KEYS.filter((t) => (museumActiveRecord(v.museumV2, Number(t) as 2)[key] ?? 0) > 0);
    if (tiers.length === 0) return NOT_OWNED;
    return owned(withoutMuseumIds(v, tiers, [key]), "without = none of its copies at Tiers II to VII");
  },
  // Relics v2 R2-4: a tier's per-copy value: every copy the tier holds.
  MUSEUM_V2_PER_COPY: (_e, v, key) => {
    const record = museumActiveRecord(v.museumV2, Number(key) as 2);
    if (Object.keys(record).length === 0) return NOT_OWNED;
    return owned(withoutMuseumIds(v, [key as RegionTierKey], Object.keys(record)), "without = none of the tier's copies");
  },
  // Relics v2 R2-4: an exceptional piece held (a duplicate adds nothing), or a full set (every piece held).
  EXCEPTIONAL_SETS: (_e, v, key) => {
    const [setId, part] = key.split(":");
    const set = EXCEPTIONAL_SETS.find((x) => x.id === setId);
    const held = v.museumV2?.exceptional ?? {};
    if (!set) return NOT_OWNED;
    if (part === "full") {
      if (!set.pieces.every((p) => (held[p.id] ?? 0) > 0)) return NOT_OWNED;
      const last = set.pieces[set.pieces.length - 1].id;
      return owned(withoutPieces(v, [last]), "without = the set's last piece (its own value goes too)");
    }
    return (held[part] ?? 0) > 0 ? owned(withoutPieces(v, [part]), "without = the piece") : NOT_OWNED;
  },
  // Relics v2 R2-4: Tier I's record as the regular game reads it (its soft cap snapshot once frozen).
  RELICS: (_e, v, key) => {
    if ((museumActiveRecord(v.museumV2, 1)[key] ?? 0) <= 0) return NOT_OWNED;
    return owned(withoutMuseumIds(v, ["1"], [key]), "without = none of its copies");
  },
  RELIC_SETS: (_e, v, key) => {
    const [setId, piecesText] = key.split(":");
    const set = RELIC_SETS.find((x) => x.id === setId);
    const relics = set?.relicIds.slice(0, Number(piecesText)) ?? [];
    const first = MUSEUM_COPY_LADDER[0];
    const museum = museumActiveRecord(v.museumV2, 1);
    if (!relics.length || !relics.every((r) => (museum[r] ?? 0) >= first)) return NOT_OWNED;
    const last = relics[relics.length - 1];
    const edited = { ...museum, [last]: first - 1 };
    // Relics v2 R2-4: a frozen Tier I is read from its snapshot, so the edit goes there.
    const without = v.museumV2?.frozen?.["1"] !== undefined ? { ...v, museumV2: { ...v.museumV2, frozen: { ...v.museumV2.frozen, "1": edited } } } : withGeneralMuseumRecord(v, edited);
    return owned(without, `without = the tier's last relic at ${first - 1} copies`);
  },
  CREW_RARITY_MULTIPLIER: (_e, v, key) =>
    bucketsAboard(v).some((b) => b.rarity === key)
      ? owned(editBuckets(v, (b) => (b.rarity === key ? { ...b, rarity: "standard" } : b)), "without = those crew at standard rarity")
      : NOT_OWNED,
  CREW_RANKS: (_e, v, key) =>
    bucketsAboard(v).some((b) => b.rank === Number(key))
      ? owned(editBuckets(v, (b) => (b.rank === Number(key) ? { ...b, rank: 1 } : b)), "without = those crew at rank 1")
      : NOT_OWNED,
};

function crewBuff(v: GameState, key: string): Owned {
  if (!bucketsAboard(v).some((b) => b.buff1Id === key || b.buff2Id === key)) return NOT_OWNED;
  if (key === "flight.droneHandling" && fieldsNoDrones(v)) return { ownership: "owned", measure: false, note: DRONELESS_NOTE };
  return owned(editBuckets(v, (b) => ({ ...b, buff1Id: b.buff1Id === key ? NONE_ID : b.buff1Id, buff2Id: b.buff2Id === key ? null : b.buff2Id })));
}

function moduleOn(v: GameState, slotType: string, variant: string): Owned {
  const match = (e: EquipmentInstance) => e.fittedToShipId === PANEL_SHIP_ID && e.slotType === slotType && e.moduleVariant === variant;
  return v.equipment.some(match) ? owned(uninstall(v, match), "without = the module uninstalled") : NOT_OWNED;
}

// Every catalog a registry entry names is classified: an ownership reader, content, or a named reason.
export function catalogClassified(catalog: string): boolean {
  return catalog in ADAPTERS || CONTENT_CATALOGS.has(catalog) || catalog in UNMEASURED_CATALOGS;
}

export function ownershipOf(e: WiringEntry, view: GameState): Owned {
  const { catalog, key } = e.source;
  const adapter = ADAPTERS[catalog];
  if (adapter) return adapter(e, view, key);
  if (CONTENT_CATALOGS.has(catalog)) return { ownership: "content" };
  return { ownership: "unmeasured", note: UNMEASURED_CATALOGS[catalog] ?? `no ownership reader for ${catalog}` };
}

// The catalogs whose registry magnitude IS what this save owns (a talent node, a rung, a trait): only for these does
// the curve give an expected value here. Elsewhere the magnitude is the sensitivity fixture's (20 gear points, a
// 20-head bucket, an ensign's base, a fixture Museum), not this save's, so the panel shows no expected value. The
// expectation assumes the source is alone on its value, as in the fixture; a source stacked additively with another
// reads "off curve" without a broken wire.
export const SAVE_MAGNITUDE_CATALOGS: ReadonlySet<string> = new Set([
  "CAPTAIN_TALENTS",
  "CAPTAIN_SPEC_BONUS",
  "SECONDARY_CAPTAIN_TALENTS",
  "HOMEWORLD_TALENTS",
  "FACILITIES",
  "EQUIPMENT_STORAGE_RUNGS",
  "TRANSIT_BERTH_RUNGS",
  "SHIP_DOCKS_RUNGS",
  "SUBSPACE_TELESCOPE_LEVELS",
  "AWAY_TRAITS",
]);
