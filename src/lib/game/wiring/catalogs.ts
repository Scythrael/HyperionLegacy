// WR-1 (0.14.0, plan docs/plans/2026-10-15-wiring-registry-and-audit-plan.md section 3.4): the PROGRAMMATIC
// enumeration of every effect source in every catalog. Never a hand-kept list: each source comes from walking the
// catalog itself, so a new talent, bonus, buff, race, trait, gear line, rung, module, array, relic, museum stat,
// hull field, mission field, weapon, drone role, status, gambit action / selector / preset, PoI, planet, loot pool,
// sell value or medical condition appears here the moment it is configured, and the completeness test
// (wiring.completeness.test.ts) fails until the registry carries an entry for it.
//
// Per-def catalogs list one source per def. Data catalogs (hulls, missions, pirate hulls, planets, sensor arrays) list
// one source per (def, field) for every field fieldRoles.ts classifies as "effect", when the def sets it.

import {
  BLUEPRINTS,
  CAPTAIN_TALENTS,
  EQUIPMENT_SLOTS,
  EQUIPMENT_STORAGE_RUNGS,
  FACILITIES,
  HOMEWORLD_TALENTS,
  ITEMS,
  LIVE_STAT_KEYS,
  MEMBER_GROUND_STAT_KEYS,
  MEMBER_SLOT_TYPES,
  MISSIONS,
  PATROLS,
  REFINE_RECIPES,
  SALVAGE_LOOT_POOLS,
  SECONDARY_CAPTAIN_TALENTS,
  SHIP_DOCKS_RUNGS,
  SHIP_TYPES,
  STANDARD_ISSUE_MEMBER_SHARES,
  SUBSPACE_TELESCOPE_LEVELS,
  TRANSIT_BERTH_RUNGS,
  type MemberSlotType,
} from "../model";
import { AFFIX_DEFS, escalationAt } from "../affixes";
import { ENEMY_RANK_IDS } from "../enemyRanks";
import { CONDITION_LINES, CONDITION_LINE_IDS, FIELD_KIT_BLUEPRINT, FIELD_KIT_IDS, FREE_BASIC_SET, KIT_CATEGORY_RULES } from "../fieldKits";
import { GRENADE_IDS } from "../fieldKitsGrenades";
import { SENIOR_STAFF_BONUSES } from "../seniorStaffBonuses";
import { CREW_PROFESSION_BUFFS, SECOND_LEVEL_EXCLUSIVE } from "../crewBuffs";
import { CREW_RACES } from "../crewRaces";
import { CREW_RARITY_MULTIPLIER } from "../crewRarity";
import { CREW_RANK_ORDER } from "../crewRank";
import { OFFICER_STAT_KEYS } from "../seniorStaff";
import { DEPARTMENT_OF_SEAT } from "../officerStats";
import { AWAY_TRAITS } from "../awayTraits";
import { PROSPECTING_BLUEPRINTS, PROSPECTING_SPEC_BASE, PROSPECTING_USES } from "../prospecting";
import { GAMBIT_PRESETS, GAMBIT_STATUSES } from "../gambit";
import { GROUND_CONDITIONS } from "../medicalBay";
import { EXCEPTIONAL_SETS, MUSEUM_STATS, MUSEUM_V2_PER_COPY, RELIC_SETS, RELIC_TYPES, RELICS } from "../relics";
import { BRIDGE_MODULES, QUARTERS_MODULES } from "../crewModules";
import { SENSOR_ARRAYS } from "../sensorArrays";
import { POI_CATALOG, PLANET_TYPES } from "../expeditionContent";
import { WEAPON_DEFS } from "../combat/weapons";
import { ROLE_TEMPLATE } from "../combat/drones";
import { PIRATE_HULLS } from "../combat/enemyHulls";
import { STATUS_EFFECT_DEFS } from "../combat/statusEffects";
import { DRONE_POD_AFFIX_POOL, DRONE_POD_IMPLICIT_STAT, WEAPON_AFFIX_POOL, WEAPON_IMPLICIT_STAT } from "../itemgen";
import { AFFIX_ALIGNED_HOOKS, AFFIX_HOOK_KEYS, GAMBIT_ACTIONS, GAMBIT_SELECTORS } from "./probes";
import { FIELD_ROLES, effectFieldsOf } from "./fieldRoles";
import { REPAIR_RATES, REPAIR_RATE_BONUSES, WEAR_EFFICIENCY, WEAR_SOURCES } from "../gearWear";
import { SHORT_RANGE_TEMPLATES } from "../shortRange";
import { GAS_STUDY_USES, GIANT_CLASSES, NEBULA_KINDS, RESEARCH_FAMILIES } from "../gasGiantContent";
import { DATA_STUDY_ITEM_IDS } from "../dataStudy";
import { REACTOR_TECH_TIERS, REACTOR_VARIETY_TECH } from "../reactorTech";
import { RARITY_PROFILES } from "../rarityProfiles";
import { ASCENSION_BUDGET_MULT } from "../ascension";
import { LUMINOUS_AFFIXES } from "../legendaryAffixes";
import { MODULE_RARITY_FACTOR } from "../model";
import { GEAR_SETS } from "../gearSets";

// Field Kits FKR-5: the sources each grenade carries (its GrenadeTraits, as the registry measures them). Timed grenades
// (user 2026-10-21): its fuse (the turns from the throw to the blast) and, on a timed one, the moved-clear chance.
export const GRENADE_FIELDS = ["charges", "perBattle", "blast", "status", "fuse", "movedClear"] as const;

export interface EffectSource {
  readonly catalog: string;
  readonly key: string;
}

// The ground lines a member variety rolls (its own pools, else the slot's).
function memberLines(slotType: MemberSlotType, v: { implicitStats?: string[]; affixPool?: { stat: string }[] }): string[] {
  const slot = EQUIPMENT_SLOTS[slotType];
  const keys = new Set([...(v.implicitStats ?? slot.implicitStats), ...(v.affixPool ?? slot.affixPool).map((a) => a.stat)]);
  return (MEMBER_GROUND_STAT_KEYS as readonly string[]).filter((k) => keys.has(k));
}

// Every line key any SHIP piece can carry: the ship slots' implicit and affix pools (slot and variety level), the
// crafted weapon and drone pod pools, and the LIVE_STAT_KEYS vocabulary. (B18: weaponYield, weaponAccuracy, droneHp
// and droneAccuracy roll and are read, though the vocabulary lists the first two as RESERVED and the last two
// nowhere; enumerating the pools themselves is what lets the completeness test see them.)
export function shipLineKeys(): string[] {
  const keys = new Set<string>(LIVE_STAT_KEYS);
  for (const [slotType, slot] of Object.entries(EQUIPMENT_SLOTS)) {
    if ((MEMBER_SLOT_TYPES as readonly string[]).includes(slotType)) continue;
    for (const k of slot.implicitStats) keys.add(k);
    for (const a of slot.affixPool) keys.add(a.stat);
    for (const v of slot.varieties) {
      for (const k of v.implicitStats ?? []) keys.add(k);
      for (const a of v.affixPool ?? []) keys.add(a.stat);
    }
  }
  keys.add(WEAPON_IMPLICIT_STAT);
  for (const a of WEAPON_AFFIX_POOL) keys.add(a.stat);
  keys.add(DRONE_POD_IMPLICIT_STAT);
  for (const a of DRONE_POD_AFFIX_POOL) keys.add(a.stat);
  return [...keys];
}

// The data catalogs whose sources are (def, field) pairs, by the name FIELD_ROLES classifies them under.
const FIELD_CATALOGS: Readonly<Record<string, Readonly<Record<string, object>>>> = {
  SHIP_TYPES,
  MISSIONS,
  PIRATE_HULLS,
  PLANET_TYPES: Object.fromEntries(PLANET_TYPES.map((p) => [p.id, p])),
  SENSOR_ARRAYS: Object.fromEntries(SENSOR_ARRAYS.map((a) => [a.id, a])),
  ITEMS,
  SUBSPACE_TELESCOPE_LEVELS: Object.fromEntries(SUBSPACE_TELESCOPE_LEVELS.map((r) => [String(r.level), r])),
  SHORT_RANGE_TEMPLATES,
  // Gas Giant Study GG-1: the giant classes and nebula kinds, field by field.
  GIANT_CLASSES: Object.fromEntries(GIANT_CLASSES.map((c) => [c.id, c])),
  NEBULA_KINDS: Object.fromEntries(NEBULA_KINDS.map((k) => [k.id, k])),
};

function fieldSources(catalog: string, defs: Readonly<Record<string, object>>): EffectSource[] {
  const effect = effectFieldsOf(catalog);
  const out: EffectSource[] = [];
  for (const [key, def] of Object.entries(defs)) {
    for (const field of effect) {
      const v = (def as Record<string, unknown>)[field];
      if (v === undefined || v === null || v === false) continue;
      out.push({ catalog, key: `${key}:${field}` });
    }
  }
  return out;
}

// Every effect source the game configures today.
export function enumerateEffectSources(): EffectSource[] {
  const out: EffectSource[] = [];
  const add = (catalog: string, keys: readonly string[]) => keys.forEach((key) => out.push({ catalog, key }));

  // crew
  add("SENIOR_STAFF_BONUSES", SENIOR_STAFF_BONUSES.map((d) => d.id));
  add("CREW_PROFESSION_BUFFS", Object.values(CREW_PROFESSION_BUFFS).flat().map((d) => d.id));
  add("SECOND_LEVEL_EXCLUSIVE", SECOND_LEVEL_EXCLUSIVE.map((d) => d.id));
  add("CREW_RACES", Object.keys(CREW_RACES));
  add("OFFICER_STAT_FACETS", Object.keys(DEPARTMENT_OF_SEAT).flatMap((seat) => OFFICER_STAT_KEYS.map((stat) => `${seat}:${stat}`)));
  add("CREW_RARITY_MULTIPLIER", Object.keys(CREW_RARITY_MULTIPLIER));
  add("CREW_RANKS", CREW_RANK_ORDER.map(String));
  // away
  for (const slotType of MEMBER_SLOT_TYPES) {
    for (const v of EQUIPMENT_SLOTS[slotType].varieties) {
      if (!v.member) continue;
      for (const team of v.member.teamTypes) add("EQUIPMENT_SLOTS.member", memberLines(slotType, v).map((k) => `${slotType}:${v.key}:${team}:${k}`));
    }
  }
  // 0.14.0: the Quartermaster's Standard-Issue member lines (model.ts STANDARD_ISSUE_MEMBER_SHARES), one source per
  // (slot, variety, squad, line).
  for (const slotType of MEMBER_SLOT_TYPES) {
    for (const v of EQUIPMENT_SLOTS[slotType].varieties) {
      const shares = STANDARD_ISSUE_MEMBER_SHARES[v.key];
      if (!v.member || shares === undefined) continue;
      for (const team of v.member.teamTypes) add("STANDARD_ISSUE_MEMBER_SHARES", Object.keys(shares).map((k) => `${slotType}:${v.key}:${team}:${k}`));
    }
  }
  add("AWAY_TRAITS", AWAY_TRAITS.map((t) => t.id));
  // Prospecting squads (hidden): the role bases, the hidden blueprints and the three later uses.
  add("PROSPECTING_SPEC_BASE", Object.keys(PROSPECTING_SPEC_BASE));
  add("PROSPECTING_BLUEPRINTS", Object.keys(PROSPECTING_BLUEPRINTS));
  add("PROSPECTING_USES", PROSPECTING_USES);
  // Gas Giant Study (GG-1 data, the engine uses wired by GG-2 to GG-7)
  add("GAS_STUDY_USES", Object.keys(GAS_STUDY_USES));
  // GG-5: the Research Lab's data study lane: the eight family boosts, the recipe chance, the fragment's decode, and
  // the lane consuming each research data item.
  add("DATA_STUDY", [...RESEARCH_FAMILIES.map((f) => `boost:${f}`), "recipeChance", "ancientDecode", ...DATA_STUDY_ITEM_IDS.map((id) => `consume:${id}`)]);
  add(
    "MEMBER_GROUND_EFFECTS",
    [...new Set(MEMBER_SLOT_TYPES.flatMap((st) => EQUIPMENT_SLOTS[st].varieties.map((v) => v.member?.groundEffect?.kind).filter((k): k is NonNullable<typeof k> => k !== undefined)))],
  );
  add("GAMBIT_STATUSES", Object.keys(GAMBIT_STATUSES));
  add("GAMBIT_ACTIONS", GAMBIT_ACTIONS);
  add("GAMBIT_SELECTORS", GAMBIT_SELECTORS);
  add("GAMBIT_PRESETS", GAMBIT_PRESETS.map((p) => p.id));
  add("GROUND_CONDITIONS", Object.keys(GROUND_CONDITIONS));
  // captain
  add("CAPTAIN_TALENTS", Object.keys(CAPTAIN_TALENTS));
  add("CAPTAIN_SPEC_BONUS", [...new Set(Object.values(CAPTAIN_TALENTS).map((d) => d.branch))]);
  add("SECONDARY_CAPTAIN_TALENTS", Object.keys(SECONDARY_CAPTAIN_TALENTS));
  // fleet admiral
  add("HOMEWORLD_TALENTS", Object.keys(HOMEWORLD_TALENTS));
  // facilities
  add("FACILITIES", Object.entries(FACILITIES).flatMap(([k, f]) => f.upgrades.map((_, i) => `${k}:${i}`)));
  add("EQUIPMENT_STORAGE_RUNGS", EQUIPMENT_STORAGE_RUNGS.map((_, i) => String(i)));
  add("SHIP_DOCKS_RUNGS", SHIP_DOCKS_RUNGS.map((_, i) => String(i)));
  add("TRANSIT_BERTH_RUNGS", TRANSIT_BERTH_RUNGS.map((_, i) => String(i)));
  add("REFINE_RECIPES", Object.keys(REFINE_RECIPES));
  add("BLUEPRINTS", Object.keys(BLUEPRINTS));
  // ship
  add("SHIP_GEAR_LINES", shipLineKeys());
  add("QUARTERS_MODULES", QUARTERS_MODULES.map((m) => m.id));
  add("BRIDGE_MODULES", BRIDGE_MODULES.map((m) => m.id));
  // RARITY READINESS RR-3: one row per rarity band (budget, affixes, secondaries, Artisan).
  add("RARITY_PROFILES", Object.keys(RARITY_PROFILES));
  // RARITY READINESS RR-4: one row per ascension (the Nova / Celestial budget multipliers).
  add("ASCENSION_BUDGET_MULT", [...Object.keys(ASCENSION_BUDGET_MULT), "nova:modules", "celestial:modules"]);
  // Review of RR-3 / RR-4: the module effect factor per band (moduleEffectScale).
  add("MODULE_RARITY_FACTOR", Object.keys(MODULE_RARITY_FACTOR));
  // RARITY READINESS RR-6: one source per gear set tier, plus the Celestial reduction.
  add("GEAR_SETS", [...GEAR_SETS.flatMap((s) => s.tiers.map((t) => `${s.id}:${t.pieces}`)), "celestialReduction"]);
  // RARITY READINESS RR-5: one row per Luminous legendary affix.
  add("LUMINOUS_AFFIXES", LUMINOUS_AFFIXES.map((d) => d.id));
  add("WEAPON_DEFS", Object.keys(WEAPON_DEFS));
  add("ROLE_TEMPLATE", Object.keys(ROLE_TEMPLATE));
  add("STATUS_EFFECT_DEFS", Object.keys(STATUS_EFFECT_DEFS));
  // relics
  add("MUSEUM_STATS", MUSEUM_STATS);
  add("RELIC_SETS", RELIC_SETS.flatMap((s) => s.tiers.map((t) => `${s.id}:${t.pieces}`)));
  add("RELICS", RELICS.map((r) => r.id));
  // Relics v2 R2-1 (live since R2-4's museum math v2): every general type, and every exceptional piece and full-set bonus
  add("RELIC_TYPES", RELIC_TYPES.map((t) => t.id));
  add("EXCEPTIONAL_SETS", EXCEPTIONAL_SETS.flatMap((s) => [...s.pieces.map((p) => `${s.id}:${p.id}`), `${s.id}:full`]));
  // Relics v2 R2-4: each tier's per-copy value above Tier I (museum math v2)
  add("MUSEUM_V2_PER_COPY", Object.keys(MUSEUM_V2_PER_COPY));
  // missions, expedition content, salvage
  add("PATROLS", Object.keys(PATROLS));
  // the ground objective affixes: every rank of every hook (an alignment-dependent hook once per alignment the
  // affix may roll), and the alert escalation's outputs
  add(
    "AFFIX_DEFS",
    Object.values(AFFIX_DEFS).flatMap((def) =>
      AFFIX_HOOK_KEYS.flatMap((hook) =>
        ((def.hooks as Readonly<Record<string, readonly number[] | undefined>>)[hook] ?? []).flatMap((_, i) =>
          AFFIX_ALIGNED_HOOKS.has(hook) ? def.alignments.map((a) => `${def.id}:${i + 1}:${hook}:${a}`) : [`${def.id}:${i + 1}:${hook}`],
        ),
      ),
    ),
  );
  add("AFFIX_ESCALATION", Object.keys(escalationAt(1)));
  // the enemy ranks (Field Kits FKR-1): one source per rank multiplier
  add("ENEMY_RANKS", ENEMY_RANK_IDS);
  // the field kits (Field Kits FKR-2): every kit, every category rule, every severity rank, the free basic set
  add("FIELD_KITS", FIELD_KIT_IDS);
  add("KIT_CATEGORY_RULES", Object.keys(KIT_CATEGORY_RULES));
  add("CONDITION_LINES", CONDITION_LINE_IDS.flatMap((line) => CONDITION_LINES[line].map((r) => `${line}:${r.id}`)));
  add("FREE_BASIC_SET", Object.keys(FREE_BASIC_SET));
  // the field kit items (Field Kits FKR-3): each kit blueprint's craft and each kit's Quartermaster price
  add("BLUEPRINTS", FIELD_KIT_IDS.map((id) => `${FIELD_KIT_BLUEPRINT[id]}:craft`));
  add("FIELD_KIT_PRICES", FIELD_KIT_IDS);
  // the grenade family (Field Kits FKR-5): each grenade's charges per objective, throws per battle, blast and debuff
  add("GRENADES", GRENADE_IDS.flatMap((k) => GRENADE_FIELDS.map((f) => `${k}:${f}`)));
  // gear wear (0.14.0, steps 1 and 2): every wear source, repair context, repair bonus and efficiency consumer
  add("WEAR_SOURCES", WEAR_SOURCES.map((w) => w.id));
  add("REPAIR_RATES", Object.keys(REPAIR_RATES));
  add("REPAIR_RATE_BONUSES", REPAIR_RATE_BONUSES);
  add("WEAR_EFFICIENCY", WEAR_EFFICIENCY.map((c) => c.id));
  add("POI_CATALOG", POI_CATALOG.map((p) => p.id));
  add("SALVAGE_LOOT_POOLS", Object.keys(SALVAGE_LOOT_POOLS));
  // the reactor tech foundation (0.14.0, reactorTech.ts): every rung of every tech tier's fuel ladder, and each Reactor
  // Core variety's tech tag (the hull tier power requirement is a SHIP_SEAMS entry)
  add("REACTOR_TECH_TIERS", REACTOR_TECH_TIERS.flatMap((t) => t.fuelLadder.map((_, i) => `${t.id}:fuel:${i}`)));
  add("REACTOR_VARIETY_TECH", Object.keys(REACTOR_VARIETY_TECH));
  // the data catalogs, field by field
  for (const [catalog, defs] of Object.entries(FIELD_CATALOGS)) out.push(...fieldSources(catalog, defs));
  return out;
}

// The catalogs FIELD_ROLES classifies, with their defs (for the field-role and claim-text checks).
export function classifiedCatalogDefs(): Record<string, Readonly<Record<string, object>>> {
  const keyed = <T extends object>(list: readonly T[], id: (d: T) => string) => Object.fromEntries(list.map((d) => [id(d), d]));
  const all: Record<string, Readonly<Record<string, object>>> = {
    ...FIELD_CATALOGS,
    SENIOR_STAFF_BONUSES: keyed(SENIOR_STAFF_BONUSES, (d) => d.id),
    CREW_BUFFS: keyed([...Object.values(CREW_PROFESSION_BUFFS).flat(), ...SECOND_LEVEL_EXCLUSIVE], (d) => d.id),
    CREW_RACES,
    AWAY_TRAITS: keyed(AWAY_TRAITS, (d) => d.id),
    GAMBIT_STATUSES,
    GAMBIT_PRESETS: keyed(GAMBIT_PRESETS, (d) => d.id),
    GROUND_CONDITIONS,
    CAPTAIN_TALENTS,
    SECONDARY_CAPTAIN_TALENTS,
    HOMEWORLD_TALENTS,
    FACILITIES,
    FACILITY_UPGRADES: Object.fromEntries(Object.entries(FACILITIES).flatMap(([k, f]) => f.upgrades.map((u, i) => [`${k}:${i}`, u]))),
    REFINE_RECIPES,
    BLUEPRINTS,
    QUARTERS_MODULES: keyed(QUARTERS_MODULES, (d) => d.id),
    BRIDGE_MODULES: keyed(BRIDGE_MODULES, (d) => d.id),
    WEAPON_DEFS,
    ROLE_TEMPLATE,
    STATUS_EFFECT_DEFS,
    RELIC_SETS: keyed(RELIC_SETS, (d) => d.id),
    RELICS: keyed(RELICS, (d) => d.id),
    RELIC_TYPES: keyed(RELIC_TYPES, (d) => d.id),
    EXCEPTIONAL_SETS: keyed(EXCEPTIONAL_SETS, (d) => d.id),
    PATROLS,
    POI_CATALOG: keyed(POI_CATALOG, (d) => d.id),
    EQUIPMENT_SLOTS,
    EQUIPMENT_VARIETIES: Object.fromEntries(Object.entries(EQUIPMENT_SLOTS).flatMap(([k, s]) => s.varieties.map((v) => [`${k}:${v.key}`, v]))),
    AFFIX_DEFS,
  };
  for (const name of Object.keys(all)) if (!(name in FIELD_ROLES)) throw new Error(`catalog ${name} has no FIELD_ROLES entry`);
  return all;
}
