// WR-1 (0.14.0 wiring registry, plan docs/plans/2026-10-15-wiring-registry-and-audit-plan.md section 3): the SEAM
// PROBES and the minimal fixture builders the registry's sensitivity level reads.
//
// A probe is a PURE function: (state, context) -> the one number a registry entry should move, read through the
// real exported engine function its consumer calls (the ship stat sheet, the mission def, the dispatch snapshot of an
// expedition, a combatant, a facility reader, ...). No probe writes state, so the Debug "Wiring" panel (WR-3) can run
// them on a live save. The fixtures build from freshState() with the one starting hull ("ship-1") and its captain.
//
// Nothing here changes engine behavior: every probe calls code the game already runs. Where a consumer computes its
// value inline (the extraction roll's chance thresholds, the passive trickle), the probe drives the real tick with a
// controlled rng and reads what it delivered.

import Decimal from "break_infinity.js";
import {
  BLUEPRINTS,
  EQUIPMENT_SLOTS,
  MEMBER_SLOT_TYPES,
  MISSIONS,
  PATROLS,
  REFINE_RECIPES,
  SALVAGE_LOOT_POOLS,
  SHIP_TYPES,
  blueprintResearchable,
  effectiveMissionDef,
  equipmentStorageCap,
  groundTeamCount,
  freshState,
  rollQuality,
  type AffixAlignment,
  type AffixId,
  type AwayMember,
  type AwayTeamType,
  type CaptainMissionState,
  type CaptainState,
  type CrewBucket,
  type CrewProfession,
  type CrewRace,
  type EquipmentInstance,
  type Expedition,
  type ExpeditionBody,
  type ExpeditionPlanetType,
  type GambitActionId,
  type GambitRule,
  type GambitStatusId,
  type GambitTargetSelector,
  type GameState,
  type MissionKey,
  type ObjectiveAffix,
  type OfficerStats,
  type SeniorStaffSeat,
  type ShipInstance,
  type ShipTypeKey,
  type SnapshotMember,
  type MemberPerkId,
} from "../model";
import {
  canBuildShip,
  canDispatch,
  startLine,
  startResearch,
  patrolPhaseFor,
  captainBonusRollChance,
  captainBonusRollChanceMult,
  captainSpecBonusRollChance,
  craftingItemLevelBonus,
  dispatchCaptainOnPatrol,
  economyTick,
  fabricateSlotCount,
  fleetRareYieldMult,
  fleetReachBonus,
  installMissingCombatBaselines,
  missionUnlocked,
  museumResearchDurationTicks,
  queueDepth,
  refineJobDurationTicks,
  refineSlotCount,
  researchSlotCount,
  salvageSlotCount,
  shipBuildDurationTicks,
  shipRangeLightYears,
  shipRepairDurationTicks,
  shipyardBayCount,
  tierCap,
  xpPerTick,
} from "../tick";
import { combatHullTypeOf, shipToCombatant } from "../combat/bridge";
import type { Combatant, CombatWeapon } from "../combat/types";
import type { DroneRole, DroneSquadron } from "../combat/drones";
import type { WeaponId } from "../combat/weapons";
import { resolveBattle } from "../combat/resolveBattle";
import { makeWeaponInstance } from "../combat/weapons";
import { makeSquadron } from "../combat/drones";
import { generateEnemyWave } from "../combat/enemyWave";
import type { PirateHullId } from "../combat/enemyHulls";
import { STATUS_EFFECT_DEFS, activeStatDelta, applyEffect, tickEffects } from "../combat/statusEffects";
import { makeRng } from "../combat/rng";
import { advanceExpedition, expeditionCandidates, scanEncounterChance, scanRatePerSecond, startExpedition } from "../expedition";
import {
  GAMBIT_STATUSES,
  activityRelicFindBonus,
  applyStatus,
  buildRosterCombatants,
  deriveAwayTeam,
  evaluateAndAct,
  expeditionTeamCombatants,
  firstAidEffectiveness,
  gambitPresetPrograms,
  generateEncounter,
  resolveGroundBattle,
  resolveTarget,
  strikeHitChance,
  tickEndOfRound,
  type BattleState,
  type GroundCombatant,
} from "../gambit";
import { fieldworkEffect, fieldworkHazardResist, fieldworkSpeedMult } from "../fieldwork";
import { taskSecurityHazardResist } from "../groundTasks";
import { snapshotMembers } from "../awayTeam";
import { applyExpeditionInjuries, injuryRecoverySeconds, shipInjuryFactors } from "../injuries";
import { boardingRepelChance, buildShipCombatant, snapshotShipEventProfile } from "../shipScanEvents";
import { shipsWithMemberAutoSlotted } from "../groundTeamSlots";
import { equippedFor } from "../equipment";
import { effectiveShipStats, officerCombatMods, officerMissionOutputBonus, officerRepairSpeedBonus, shipCrewContribution } from "../crewOverlay";
import { departmentFacet, seatFacet } from "../officerStats";
import { RELICS, museumBonuses, type MuseumStat } from "../relics";
import { salvageSalvagedMaterial, salvageShip, salvageTalentBonus, salvageYieldMult } from "../salvage";
import { alertResetSeconds, escalationAt, extraBattleChance, longRangeCover, maxExtraBattles } from "../affixes";
import { ENEMY_RANKS_VERSION, type EnemyRank } from "../enemyRanks";
import { taskFightGuard } from "../groundFight";
import { sellItem } from "../quartermaster";
import { retirementExpMultiplier } from "../captainRetirement";
import { transitBerthCount } from "../berths";
import { telescopeReading } from "../telescope";
import { getSeniorStaffBonusById } from "../seniorStaffBonuses";
import { CREW_STAT_KEYS } from "../crewBuffs";
import { POI_CATALOG, PLANET_TYPES, planetTypeHazard, poisForPlanetType } from "../expeditionContent";
import { damageControlEffect, pathfinderEffect } from "../utilityGear";
import { installedSensorArray, sensorArrayEffect, sensorArrayRelicFindBonus } from "../sensorArrays";
import { quartersCapacityBonus } from "../crewModules";
import { addItemQuality, itemTotal } from "../inventory";
import { GROUND_CONDITIONS, conditionCureSeconds } from "../medicalBay";
import { loadoutSlotDefsForShipType } from "../armory";
import { gambitProgramEquals } from "../memberGambits";

// ============================================================================
// Contexts (every context a claim can cover; plan section 3.2)
// ============================================================================

export const CONTEXT_IDS = [
  "sheet", // the crew-boosted ship stat sheet (effectiveShipStats): missions, dispatch gates, berths, readouts
  "mission:extraction",
  "mission:survey",
  "mission:transport",
  "patrol", // ship battles (patrols and the Ground Ops ship events build the same combatant)
  "shipyard", // Shipyard repair, builds, bays
  "expedition:groundOps", // a run dispatched since GO-7b (every new run)
  "expedition:legacy", // a run dispatched before GO-7b (only old in-flight saves)
  "shipEvent", // the Ground Ops ship-side scan events
  "ground", // ground battles (the Security squad)
  "ground:noInflict", // a Security member wearing no inflict piece
  "fieldwork", // the Science party's work on a task
  "medbay", // injury recovery
  "craft",
  "salvage", // recycling a piece or salvaging a material
  "salvage:teardown", // tearing down a hull
  "salvage:topTier", // a Fleet Admiral past the last loot-tier threshold
  "research",
  "facility",
  "fleet", // account-level (talent readers, queues, trickle)
  "captain", // captain progression
] as const;
export type ContextId = (typeof CONTEXT_IDS)[number];

// ============================================================================
// Fixtures
// ============================================================================

export const WIRING_SHIP_ID = "ship-1";
export const WIRING_CAPTAIN_ID = 1;
export const NO_OFFICER_BONUS = { id: "wiring.none", magnitude: 0 };

export type Transform = (s: GameState) => GameState;
export const identity: Transform = (s) => s;

// A fresh save with room to work (credits), optionally on another hull.
export function wiringBase(typeKey?: ShipTypeKey): GameState {
  const base = freshState();
  const s: GameState = { ...base, credits: new Decimal(1_000_000) };
  return typeKey ? editShip(s, { typeKey }) : s;
}

// A combat hull with its Standard Issue combat gear installed (plating, emitters, weapons, pods).
export function combatBase(typeKey: ShipTypeKey = "destroyer"): GameState {
  return installMissingCombatBaselines(wiringBase(typeKey));
}

export function shipOf(s: GameState): ShipInstance {
  const ship = s.ships.find((sh) => sh.id === WIRING_SHIP_ID);
  if (!ship) throw new Error("wiring fixture: no ship-1");
  return ship;
}

export function captainOf(s: GameState): CaptainState {
  const c = s.captains.find((cap) => cap.id === WIRING_CAPTAIN_ID);
  if (!c) throw new Error("wiring fixture: no captain 1");
  return c;
}

export function editShip(s: GameState, over: Partial<ShipInstance>): GameState {
  return { ...s, ships: s.ships.map((sh) => (sh.id === WIRING_SHIP_ID ? { ...sh, ...over } : sh)) };
}

export function editCaptain(s: GameState, over: Partial<CaptainState>): GameState {
  return { ...s, captains: s.captains.map((c) => (c.id === WIRING_CAPTAIN_ID ? { ...c, ...over } : c)) };
}

// Seat one officer on ship-1 carrying `bonusIds` at their catalog magnitude (an ensign stores the base magnitude).
export function seatOfficer(
  s: GameState,
  seat: SeniorStaffSeat,
  bonusIds: readonly string[],
  opts: { race?: CrewRace; stats?: OfficerStats; id?: string } = {},
): GameState {
  const bonuses = bonusIds.map((id) => ({ id, magnitude: getSeniorStaffBonusById(id)!.magnitude }));
  const officer = {
    id: opts.id ?? `wiring-officer-${seat}`,
    seat,
    name: `Wiring ${seat}`,
    race: opts.race ?? "earthBorn",
    gender: "nonbinary",
    rank: "ensign" as const,
    bonuses: [bonuses[0] ?? NO_OFFICER_BONUS, bonuses[1] ?? NO_OFFICER_BONUS] as [typeof NO_OFFICER_BONUS, typeof NO_OFFICER_BONUS],
    missionsCompleted: 0,
    assignedShipId: WIRING_SHIP_ID,
    ...(opts.stats ? { stats: { ...opts.stats } } : {}),
  };
  return { ...s, officers: [...s.officers.filter((o) => o.seat !== seat || o.assignedShipId !== WIRING_SHIP_ID), officer] };
}

export const WIRING_BUCKET_COUNT = 20; // a real-sized complement bucket (standard rarity, Crewman rank)

export function bucketOf(profession: CrewProfession, buff1Id: string, count = WIRING_BUCKET_COUNT, race: CrewRace = "earthBorn"): CrewBucket {
  return { profession, rarity: "standard", rank: 1, race, buff1Id, buff2Id: null, count };
}

export function withBuckets(s: GameState, buckets: readonly CrewBucket[]): GameState {
  return editShip(s, { complement: { mode: "active", buckets: [...buckets] } });
}

// Install a piece on ship-1, replacing any piece of the same slot type (the readers take the first match).
export function installPiece(s: GameState, over: Omit<Partial<EquipmentInstance>, "slotType"> & { slotType: string }): GameState {
  const piece: EquipmentInstance = {
    id: `wiring-equip-${over.slotType}`,
    rarity: "standard",
    ascension: "none",
    quality: 0,
    iLevel: 10,
    blueprintKey: null,
    implicitStats: {},
    rolledStats: {},
    mass: 0,
    powerDraw: 0,
    durabilityMax: 100,
    durability: 100,
    fittedToShipId: WIRING_SHIP_ID,
    ...over,
  } as EquipmentInstance;
  const rest = s.equipment.filter((e) => !(e.fittedToShipId === WIRING_SHIP_ID && e.slotType === over.slotType));
  return { ...s, equipment: [...rest, piece] };
}

export function withFacilityLevel(s: GameState, key: string, level: number): GameState {
  return { ...s, facilities: { ...s.facilities, [key]: { level } } };
}

export function withMuseum(s: GameState, record: Readonly<Record<string, number>>): GameState {
  return { ...s, relicMuseum: { ...record } };
}

export function withHomeworld(s: GameState, keys: readonly string[]): GameState {
  return { ...s, unlockedHomeworldTalents: [...s.unlockedHomeworldTalents, ...keys] as GameState["unlockedHomeworldTalents"] };
}

// == away team ==

export const WIRING_SECURITY_ID = "member-901";
export const WIRING_SCIENCE_ID = "member-902";

export function wiringMember(id: string, teamType: AwayTeamType, over: Partial<AwayMember> = {}): AwayMember {
  return {
    id,
    teamType,
    spec: teamType === "science" ? "geology" : "offense",
    name: `Wiring ${id}`,
    race: "earthBorn",
    gender: "female",
    rank: 1,
    traits: [],
    assignedShipId: WIRING_SHIP_ID,
    ...over,
  } as AwayMember;
}

// Ship-1 fields one Security member and one Science member, slotted into its first ground team (the D18 minimum).
export function withAwayTeam(s: GameState, security: Partial<AwayMember> = {}, science: Partial<AwayMember> = {}): GameState {
  const members = [wiringMember(WIRING_SECURITY_ID, "security", security), wiringMember(WIRING_SCIENCE_ID, "science", science)];
  const awayMembers = [...s.awayMembers.filter((m) => !members.some((n) => n.id === m.id)), ...members];
  let ships = shipsWithMemberAutoSlotted(s.ships, WIRING_SHIP_ID, WIRING_SECURITY_ID, "security", awayMembers);
  ships = shipsWithMemberAutoSlotted(ships, WIRING_SHIP_ID, WIRING_SCIENCE_ID, "science", awayMembers);
  return { ...s, ships, awayMembers, nextAwayMemberId: Math.max(s.nextAwayMemberId, 903) };
}

export function editMember(s: GameState, id: string, over: Partial<AwayMember>): GameState {
  return { ...s, awayMembers: s.awayMembers.map((m) => (m.id === id ? ({ ...m, ...over } as AwayMember) : m)) };
}

// Put a member gear piece on a member (a fresh piece id per slot type, so two pieces can be worn together).
export function wearPiece(
  s: GameState,
  memberId: string,
  slotType: string,
  moduleVariant: string,
  lines: Readonly<Record<string, number>>,
): GameState {
  const piece: EquipmentInstance = {
    id: `wiring-wear-${memberId}-${slotType}`,
    slotType,
    moduleVariant,
    rarity: "standard",
    ascension: "none",
    quality: 0,
    iLevel: 10,
    blueprintKey: null,
    implicitStats: { ...lines },
    rolledStats: {},
    mass: 0,
    powerDraw: 0,
    durabilityMax: 100,
    durability: 100,
    fittedToShipId: null,
    fittedToMemberId: memberId,
  } as EquipmentInstance;
  const rest = s.equipment.filter((e) => e.id !== piece.id);
  return { ...s, equipment: [...rest, piece] };
}

// The ship's members, frozen exactly as a dispatch freezes them (converted gear, traits, perks).
function rosterOf(s: GameState): { security: SnapshotMember[]; science: SnapshotMember[] } {
  const aboard = s.awayMembers.filter((m) => m.assignedShipId === WIRING_SHIP_ID);
  return {
    security: snapshotMembers(s, aboard.filter((m) => m.teamType === "security")),
    science: snapshotMembers(s, aboard.filter((m) => m.teamType === "science")),
  };
}

// The Security squad's battle combatants, built by the real roster builder.
function squadCombatants(s: GameState): GroundCombatant[] {
  const roster = rosterOf(s);
  return buildRosterCombatants(roster.security, 0, "wiring");
}

function memberCombatant(s: GameState, memberId: string): GroundCombatant | undefined {
  return squadCombatants(s).find((c) => c.memberId === memberId);
}

// A minimal fieldwork run (the readers only need the roster and the crew strength).
function fieldworkRun(s: GameState): Pick<Expedition, "roster" | "scienceStrength"> {
  return { roster: rosterOf(s) as Expedition["roster"], scienceStrength: 0 };
}

const PLANET_IDS = PLANET_TYPES.map((p) => p.id as ExpeditionPlanetType);

// The best value over every planet type (planet-tuned tools count only on their own worlds).
function bestOverPlanets(f: (p: ExpeditionPlanetType) => number): number {
  return Math.max(...PLANET_IDS.map(f));
}

// == expeditions ==

// Dispatch ship-1 on its first candidate (the away team must be aboard). The run's frozen record is what every
// expedition consumer reads, so most expedition probes read it or a consumer of it.
export function dispatchRun(s: GameState): Expedition {
  const ready = s.awayMembers.some((m) => m.assignedShipId === WIRING_SHIP_ID) ? s : withAwayTeam(s);
  const cand = expeditionCandidates(ready, WIRING_SHIP_ID)[0];
  const res = startExpedition(ready, WIRING_SHIP_ID, WIRING_CAPTAIN_ID, cand.id);
  if (!res.success || !res.expedition) throw new Error(`wiring dispatch refused: ${res.reason}`);
  return res.expedition;
}

export function syntheticBody(planetType: ExpeditionPlanetType, hazard: number): ExpeditionBody {
  return { id: `wiring-${planetType}-${hazard}`, planetType, scanTotal: 120, scanProgress: 0, hazard, scanned: false, discoveries: [], activities: [] };
}

// == inventory ==

export function heldOf(s: GameState, item: string): number {
  return Number(itemTotal(s.inventory, item));
}

// The state holding `qty` more of `item` (quality 0).
export function holding(s: GameState, item: string, qty: Decimal): GameState {
  return { ...s, inventory: addItemQuality(s.inventory, item, qty, 0) };
}

// == missions ==

// Put captain 1 on `missionKey` in `phase`, at the start of the phase.
export function onMission(s: GameState, missionKey: MissionKey, phase: CaptainMissionState["phase"]): GameState {
  const mission: CaptainMissionState = {
    kind: "extraction",
    missionKey,
    phase,
    phaseProgressTicks: 0,
    cargo: { commonOre: new Decimal(0), uncommonMaterial: new Decimal(0), rareMaterial: new Decimal(0) },
    recalled: false,
  } as CaptainMissionState;
  return editCaptain(s, { mission } as Partial<CaptainState>);
}

// One extracting tick of captain 1 on `missionKey`, every economy draw returning `draw`: the cargo it took.
function extractingCargo(s: GameState, missionKey: MissionKey, draw: number): { common: number; uncommon: number; rare: number } {
  const after = economyTick(onMission(s, missionKey, "extracting"), 1, () => draw);
  const m = captainOf(after).mission as CaptainMissionState | null;
  const cargo = m && "cargo" in m ? m.cargo : undefined;
  return {
    common: cargo ? Number(cargo.commonOre) : 0,
    uncommon: cargo ? Number(cargo.uncommonMaterial) : 0,
    rare: cargo ? Number(cargo.rareMaterial) : 0,
  };
}

// The chance threshold the extraction roll compares its draw against, found by bisection on a constant-draw rng:
// the largest draw that still lands the tier. `tier` "rare" is the first draw; "uncommon" the second (a draw above
// the rare threshold falls through to it).
function extractionThreshold(s: GameState, missionKey: MissionKey, tier: "rare" | "uncommon"): number {
  // A draw below the rare threshold lands rare, so the uncommon search starts above it (the base odds' midpoint).
  const def = MISSIONS[missionKey];
  let lo = tier === "rare" ? 0 : (def.rareChance + def.uncommonChance) / 2;
  let hi = 1;
  const lands = (d: number) => extractingCargo(s, missionKey, d)[tier] > 0;
  if (!lands(lo + 1e-12)) return 0;
  for (let i = 0; i < 44; i++) {
    const mid = (lo + hi) / 2;
    if (lands(mid)) lo = mid;
    else hi = mid;
  }
  return lo;
}

function missionDefFor(s: GameState, missionKey: MissionKey) {
  return effectiveMissionDef(MISSIONS[missionKey], effectiveShipStats(s, shipOf(s)));
}

const BIG_HOLD = 100;
function bigHoldMissionDef(s: GameState) {
  const stats = effectiveShipStats(s, shipOf(s));
  return effectiveMissionDef(MISSIONS.longOreRun, { ...stats, cargoCapacity: stats.cargoCapacity * BIG_HOLD });
}

// == ship combat ==

export function playerCombatant(s: GameState): Combatant {
  const ship = shipOf(s);
  const hullType = combatHullTypeOf(ship.typeKey) ?? undefined;
  return shipToCombatant({
    id: "wiring-player",
    team: "player",
    stats: SHIP_TYPES[ship.typeKey],
    hullType,
    installedGear: equippedFor(s, ship.id),
    officerCombat: officerCombatMods(s, ship),
  });
}

// == Shipyard gates ==

// 1 when canBuildShip(generalFreighter) does not stop at `gate` (it may still stop at a later gate), else 0.
function buildGatePassed(s: GameState, gate: string): number {
  const r = canBuildShip(s, "generalFreighter");
  return r.ok || r.reason !== gate ? 1 : 0;
}

// == crafting ==

// The threshold the quality roll's first climb compares its draw against, with the museum's crafting quality
// bonus (the same rollQuality call the Fabricator makes), found by bisection on a constant draw.
function qualityClimbThreshold(bonus: number): number {
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 44; i++) {
    const mid = (lo + hi) / 2;
    if (rollQuality(() => mid, bonus) >= 1) lo = mid;
    else hi = mid;
  }
  return lo;
}

// == whole-context consumers (WR-1 review: a claimed context a stat does not reach yet is read through the
// context's OWN consumer, so the check proves the stat is absent there, and starts failing the day it arrives) ==

// A stable 32-bit digest of plain data (FNV-1a over its JSON; Decimals as their strings).
export function digestOf(v: unknown): number {
  const text = JSON.stringify(v, (_k, x: unknown) => (x instanceof Decimal ? x.toString() : x)) ?? "";
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h;
}

// The state a run dispatches from (ship-1 must field its away team).
function readyForRun(s: GameState): GameState {
  return s.awayMembers.some((m) => m.assignedShipId === WIRING_SHIP_ID) ? s : withAwayTeam(s);
}

// EVERYTHING a Ground Ops run reads of the ship: the candidate list it picks from (ids, systems, regions, reach) and
// the record frozen at dispatch. The whole timeline is a pure function of that record (advanceExpedition takes no
// state), so a stat that reaches any part of a run moves this digest. -1 when the run cannot dispatch (the check's
// control then fails, so a fixture that cannot fly never passes as "flat").
export function groundOpsRunDigest(s: GameState): number {
  const ready = readyForRun(s);
  const candidates = expeditionCandidates(ready, WIRING_SHIP_ID).map((c) => [c.id, c.systemId, c.telescope.regionTier, c.telescope.inRange]);
  try {
    return digestOf({ candidates, run: dispatchRun(ready) });
  } catch {
    return -1;
  }
}

// EVERYTHING one patrol cycle reads of the ship: dispatch captain 1 on the first patrol (a combat hull), fly one
// whole cycle through the real economyTick, and digest the cycle (the mission record tick by tick, the purse, the
// hold, the tank and the ship). -1 when the ship cannot patrol (a non-combat hull: the check's control then fails).
export function patrolDigest(s: GameState): number {
  const key = Object.keys(PATROLS)[0];
  const r = dispatchCaptainOnPatrol(s, WIRING_CAPTAIN_ID, key, "balanced", false);
  if (!r.success) return -1;
  const def = PATROLS[key];
  let after = r.next;
  const trace: unknown[] = [captainOf(after).mission];
  for (let t = 0; t < def.transitOutTicks + def.rollWindowTicks + def.transitBackTicks + 5; t++) {
    after = economyTick(after, 1, () => 0.5);
    trace.push(captainOf(after).mission); // tick by tick: the legs, every wave and the ship's pools between them
  }
  return digestOf({ trace, credits: after.credits, inventory: after.inventory, ship: shipOf(after) });
}

// The ship-side scan events' combatant: the battle profile frozen at dispatch, rebuilt as each event rebuilds it.
function shipEventCombatant(s: GameState): Combatant | undefined {
  const battle = snapshotShipEventProfile(s, shipOf(s)).battle;
  return battle ? buildShipCombatant("wiring-event", battle, 0, 0) : undefined;
}

// The Security squad as a dispatched run fields it (the run's frozen officer care rides along).
function runMember(s: GameState, memberId: string): GroundCombatant | undefined {
  return expeditionTeamCombatants(dispatchRun(readyForRun(s)), "wiring").find((c) => c.memberId === memberId);
}

// The member's combatant with every inflict-capable piece taken off (the "no inflict piece" context).
const INFLICT_VARIETIES = new Set(
  MEMBER_SLOT_TYPES.flatMap((slot) => EQUIPMENT_SLOTS[slot].varieties.filter((v) => v.member?.groundEffect?.kind === "inflict").map((v) => v.key)),
);
function withoutInflictPieces(s: GameState): GameState {
  return { ...s, equipment: s.equipment.filter((e) => !(e.fittedToMemberId && e.moduleVariant && INFLICT_VARIETIES.has(e.moduleVariant))) };
}

// A hull torn down at the Salvage Bay (a second hull, so the last-hull guard never refuses): what it gave back.
function teardownRecovered(s: GameState): number {
  const spare: ShipInstance = { ...shipOf(s), id: "wiring-teardown", assignedCaptainId: null };
  const held = { ...s, ships: [...s.ships, spare] };
  const r = salvageShip(held, spare.id, () => 0.5);
  if (!r.ok) return -1;
  const items = Object.keys(SHIP_TYPES[spare.typeKey].buildRecipe.components);
  return items.reduce((a, k) => a + heldOf(r.next, k) - heldOf(held, k), 0) + Number(r.next.credits) - Number(held.credits);
}

// The loot tier one salvaged material gives a Fleet Admiral past every loot-tier threshold, the draw at the top.
function topTierRolled(s: GameState): number {
  const item = Object.keys(SALVAGE_LOOT_POOLS)[0];
  const held = holding({ ...s, fleetAdminLevel: 99 }, item, new Decimal(1));
  const r = salvageSalvagedMaterial(held, item, () => 0.999999);
  return r.ok && r.rolled ? r.rolled.quality : -1; // a higher tier deposits at a higher quality rung
}

// One whole shortOreRun cycle (every draw common): the credits and Titanium Ore it delivered.
function cycleOutput(s: GameState): number {
  const { before, after } = oneCycle(s, "shortOreRun");
  return Number(after.credits) - Number(before.credits) + heldOf(after, "commonOre") - heldOf(before, "commonOre");
}

// One whole shortOreRun cycle: the QUALITY of the ore it delivered (quality rung x units, summed).
function cycleOreQuality(s: GameState): number {
  const { before, after } = oneCycle(s, "shortOreRun");
  const weighted = (g: GameState) => (g.inventory.commonOre ?? []).reduce((a, q, i) => a + i * Number(q), 0);
  return weighted(after) - weighted(before);
}

// How many blueprints a top-level Research Lab can start (the relic-gated ones count once their relic is found).
function researchableCount(s: GameState): number {
  const ready = withFacilityLevel(s, "research", 9);
  return Object.keys(BLUEPRINTS).filter((k) => blueprintResearchable(ready, k)).length;
}

// The legacy (pre-Ground Ops) injury path: a run whose Security member went down, brought home. Its recovery time.
function legacyInjurySeconds(s: GameState): number {
  const ready = readyForRun(s);
  const run = dispatchRun(ready);
  const legacy: Expedition = {
    ...run,
    groundOps: undefined,
    risk: undefined,
    scanEvents: [{ bodyIndex: 0, step: 1, kind: "encounter", outcome: "loss", downedMemberIds: [WIRING_SECURITY_ID] }],
  };
  return applyExpeditionInjuries(ready, legacy).injuries.find((i) => i.memberId === WIRING_SECURITY_ID)?.recoverySeconds ?? 0;
}

// == the ground objective affixes (affixes.ts readers) ==

const AFFIX_READERS: Readonly<Record<string, (list: readonly ObjectiveAffix[], alignment: AffixAlignment) => number>> = {
  extraBattleChanceByRank: (l) => extraBattleChance(l),
  maxExtraBattlesByRank: (l) => maxExtraBattles(l),
  alertResetSecondsByRank: (l) => alertResetSeconds(l),
  // The side(s) the alignment covers: positive the squad, negative the enemy, neutral both (summed).
  longRangeEvasionByRank: (l, a) => {
    const c = longRangeCover(l);
    return a === "positive" ? c.team : a === "negative" ? c.enemy : c.team + c.enemy;
  },
};
export const AFFIX_HOOK_KEYS = Object.keys(AFFIX_READERS);
// The hooks whose reading depends on the instance's alignment (one source per alignment the affix may roll).
export const AFFIX_ALIGNED_HOOKS: ReadonlySet<string> = new Set(["longRangeEvasionByRank"]);

// ============================================================================
// The probes
// ============================================================================

export interface ProbeDef {
  readonly label: string;
  readonly read: (s: GameState, ctx: ContextId) => number;
}

const sheet = (s: GameState) => effectiveShipStats(s, shipOf(s));
// A sheet stat read where its consumer reads it: the sheet itself, or (at a claimed context the stat does not reach
// yet) that context's whole consumer, the Ground Ops run or the patrol cycle.
const sheetAt = (read: (s: GameState) => number) => (s: GameState, ctx: ContextId) =>
  ctx === "expedition:groundOps" ? groundOpsRunDigest(s) : ctx === "patrol" ? patrolDigest(s) : read(s);
const sci = () => WIRING_SCIENCE_ID;
// The research probe reads a long project, so one museum step moves it by many ticks (well above its rounding).
const RESEARCH_PROBE_SCALE = 1000;
const sec = () => WIRING_SECURITY_ID;

export const PROBES = {
  // == the ship stat sheet ==
  sheetCargo: { label: "effectiveShipStats.cargoCapacity (Ground Ops / patrol: the run / cycle digest)", read: sheetAt((s) => sheet(s).cargoCapacity) },
  sheetTransit: { label: "effectiveShipStats.transitSpeedMult (Ground Ops / patrol: the run / cycle digest)", read: sheetAt((s) => sheet(s).transitSpeedMult) },
  sheetYield: { label: "effectiveShipStats.extractionYieldMult", read: (s) => sheet(s).extractionYieldMult },
  sheetUnload: {
    label: "unload speed: effectiveShipStats.unloadSpeedMult (missions) / groundOps.factors.offloadMult (Ground Ops)",
    read: (s, ctx) => (ctx === "expedition:groundOps" ? dispatchRun(s).groundOps?.factors.offloadMult ?? 1 : sheet(s).unloadSpeedMult ?? 1),
  },
  sheetEngineEff: { label: "effectiveShipStats.engineEfficiency (Ground Ops: the run digest)", read: sheetAt((s) => sheet(s).engineEfficiency) },
  sheetFuelCapacity: { label: "effectiveShipStats.fuelCapacity (Ground Ops: the run digest)", read: sheetAt((s) => sheet(s).fuelCapacity) },
  sheetSensors: { label: "effectiveShipStats.sensors (patrol: the cycle digest)", read: sheetAt((s) => sheet(s).sensors) },
  sheetMass: { label: "effectiveShipStats.mass", read: (s) => sheet(s).mass },
  sheetPowerOutput: { label: "effectiveShipStats.powerOutput", read: (s) => sheet(s).powerOutput },
  sheetPowerDraw: { label: "effectiveShipStats.powerDraw", read: (s) => sheet(s).powerDraw },
  sheetExtractionSpeed: { label: "effectiveShipStats.extractionSpeedMult", read: (s) => sheet(s).extractionSpeedMult ?? 1 },
  sheetReturnConstitution: { label: "effectiveShipStats.returnLegConstitution", read: (s) => sheet(s).returnLegConstitution ?? 0 },
  sheetFullHoldIntegrity: { label: "effectiveShipStats.fullHoldUnloadIntegrity", read: (s) => sheet(s).fullHoldUnloadIntegrity ?? 0 },
  shipRange: { label: "shipRangeLightYears", read: (s) => shipRangeLightYears(s, shipOf(s)) },
  // == the mission def a ship flies (effectiveMissionDef) ==
  // The two tick-count probes read a 100x hold, so a small speed-up is not lost to the whole-tick rounding.
  missionUnloadTicks: { label: "effectiveMissionDef(longOreRun).unloadTicks (a 100x hold)", read: (s) => bigHoldMissionDef(s).unloadTicks },
  missionTransitOutTicks: { label: "effectiveMissionDef(longOreRun).transitOutTicks", read: (s) => missionDefFor(s, "longOreRun").transitOutTicks },
  missionExtractionTicks: {
    label: "effectiveMissionDef(longOreRun) extracting ticks (a 100x hold)",
    read: (s) => {
      const d = bigHoldMissionDef(s);
      return d.extractionTicksOverride ?? Math.ceil(d.cargoCapacity / d.extractionRatePerTick);
    },
  },
  // == the extraction roll (one real economyTick, controlled draws) ==
  extractionCommonPerTick: { label: "economyTick extracting: common ore per tick (shortOreRun)", read: (s) => extractingCargo(s, "shortOreRun", 0.999999).common },
  extractionUncommonPerTick: {
    label: "economyTick extracting: uncommon per tick (salvageWreckage)",
    read: (s) => extractingCargo(s, "salvageWreckage", MISSIONS.salvageWreckage.rareChance + (MISSIONS.salvageWreckage.uncommonChance - MISSIONS.salvageWreckage.rareChance) / 2).uncommon,
  },
  extractionRarePerTick: { label: "economyTick extracting: rare per tick (shortOreRun)", read: (s) => extractingCargo(s, "shortOreRun", 0).rare },
  extractionRareThreshold: { label: "economyTick extracting: rare-roll threshold", read: (s, ctx) => extractionThreshold(s, ctx === "mission:survey" ? "surveyMineralAnomaly" : "shortOreRun", "rare") },
  extractionUncommonThreshold: { label: "economyTick extracting: uncommon-roll threshold (salvageWreckage)", read: (s) => extractionThreshold(s, "salvageWreckage", "uncommon") },
  surveyCommonPerTick: { label: "economyTick extracting: survey common per tick", read: (s) => extractingCargo(s, "surveyMineralAnomaly", 0.999999).common },
  bonusRollTrigger: {
    label: "the bonus-roll trigger chance economyTick computes (tick.ts:2275)",
    read: (s) => {
      const c = captainOf(s);
      return captainBonusRollChance(c) * (1 + captainBonusRollChanceMult(c)) + captainSpecBonusRollChance(c);
    },
  },
  passiveTrickle: {
    label: "economyTick: Titanium Ore gained in one idle tick",
    read: (s) => {
      const idle = editCaptain(s, { mission: null } as Partial<CaptainState>);
      const after = economyTick(idle, 1, () => 0.5);
      return heldOf(after, "commonOre") - heldOf(idle, "commonOre");
    },
  },
  missionOutputBonus: { label: "officerMissionOutputBonus (economyTick delivery share)", read: (s) => officerMissionOutputBonus(s, shipOf(s)) },
  missionCycleOutput: { label: "one whole shortOreRun cycle (economyTick): the credits and Titanium Ore delivered", read: (s) => cycleOutput(s) },
  missionOreQuality: { label: "one whole shortOreRun cycle (economyTick): the quality of the ore delivered", read: (s) => cycleOreQuality(s) },
  rareFind: {
    label: "crew rare find: Expedition.crewRareFind (relic roll) / crew.rareFindChance read by survey rare odds (tick.ts:4148)",
    read: (s, ctx) => (ctx === "mission:survey" ? shipCrewContribution(s, shipOf(s))[CREW_STAT_KEYS.rareFindChance] ?? 0 : dispatchRun(s).crewRareFind ?? 0),
  },
  injuryCare: {
    label: "injury care: groundOps.factors.medicalShare (medical bay) / injuryRecoverySeconds (legacy claim)",
    read: (s, ctx) => (ctx === "expedition:legacy" ? injuryRecoverySeconds(shipInjuryFactors(s, shipOf(s))) : dispatchRun(s).groundOps?.factors.medicalShare ?? 0),
  },
  // == captain progression ==
  captainXpPerTick: { label: "xpPerTick(shortOreRun) x retirementExpMultiplier", read: (s) => xpPerTick("shortOreRun", captainOf(s), s) * retirementExpMultiplier(s) },
  // == ship combat ==
  officerWeapons: { label: "officerCombatMods.weaponDamage", read: (s) => officerCombatMods(s, shipOf(s))?.weaponDamage ?? 0 },
  officerShields: { label: "officerCombatMods.shield", read: (s) => officerCombatMods(s, shipOf(s))?.shield ?? 0 },
  officerHull: { label: "officerCombatMods.hull", read: (s) => officerCombatMods(s, shipOf(s))?.hull ?? 0 },
  officerEvasion: {
    label: "evasion: officerCombatMods.evasion (ship battles) / Expedition.encounterEvasion (scan encounters)",
    read: (s, ctx) => (ctx === "expedition:groundOps" ? dispatchRun(s).encounterEvasion ?? 0 : officerCombatMods(s, shipOf(s))?.evasion ?? 0),
  },
  officerHullMult: { label: "1 + officerCombatMods.hull", read: (s) => 1 + (officerCombatMods(s, shipOf(s))?.hull ?? 0) },
  combatHullMax: {
    label: "hullMax: shipToCombatant (patrol) / the ship-event combatant from the profile frozen at dispatch (shipEvent)",
    read: (s, ctx) => (ctx === "shipEvent" ? shipEventCombatant(s)?.hullMax ?? 0 : playerCombatant(s).hullMax),
  },
  combatShieldMax: {
    label: "shieldMax: shipToCombatant (patrol) / the ship-event combatant (shipEvent)",
    read: (s, ctx) => (ctx === "shipEvent" ? shipEventCombatant(s)?.shieldMax ?? 0 : playerCombatant(s).shieldMax),
  },
  combatShieldRecharge: {
    label: "shieldRecharge: shipToCombatant (patrol) / the ship-event combatant (shipEvent)",
    read: (s, ctx) => (ctx === "shipEvent" ? shipEventCombatant(s)?.shieldRecharge ?? 0 : playerCombatant(s).shieldRecharge),
  },
  combatShieldCoherence: { label: "shipToCombatant.shieldCoherence", read: (s) => playerCombatant(s).shieldCoherence },
  combatAblativeArmor: { label: "shipToCombatant.ablativeArmor", read: (s) => playerCombatant(s).ablativeArmor },
  combatKineticDampening: { label: "shipToCombatant.kineticDampening", read: (s) => playerCombatant(s).kineticDampening },
  combatEvasion: { label: "shipToCombatant.evasion", read: (s) => playerCombatant(s).evasion },
  combatWeaponYield: { label: "shipToCombatant first weapon yieldMax", read: (s) => playerCombatant(s).weapons[0]?.yieldMax ?? 0 },
  combatWeaponAccuracy: { label: "shipToCombatant first weapon accuracy", read: (s) => playerCombatant(s).weapons[0]?.accuracy ?? 0 },
  combatWeaponCount: { label: "shipToCombatant weapon count", read: (s) => playerCombatant(s).weapons.length },
  combatDroneHp: { label: "shipToCombatant first squadron droneHp", read: (s) => playerCombatant(s).drones[0]?.droneHp ?? 0 },
  combatDroneAccuracy: { label: "shipToCombatant first squadron accuracy", read: (s) => playerCombatant(s).drones[0]?.accuracy ?? 0 },
  combatDroneCount: { label: "shipToCombatant squadron count", read: (s) => playerCombatant(s).drones.length },
  waveHullRegen: { label: "damageControlEffect.waveHullRegenFraction (tick.ts:3002)", read: (s) => damageControlEffect(equippedFor(s, WIRING_SHIP_ID)).waveHullRegenFraction },
  // == Shipyard ==
  repairTicks: {
    label: "shipRepairDurationTicks (500 damage)",
    read: (s) => {
      const ship = { ...shipOf(s), damaged: true, repairDamage: 500 };
      return shipRepairDurationTicks(ship, equippedFor(s, ship.id), officerRepairSpeedBonus(s, ship));
    },
  },
  officerRepairBonus: {
    label: "recovery speed-up: officerRepairSpeedBonus (Shipyard) / groundOps.factors.rapidRecoveryShare (medical bay)",
    read: (s, ctx) => (ctx === "medbay" ? dispatchRun(s).groundOps?.factors.rapidRecoveryShare ?? 0 : officerRepairSpeedBonus(s, shipOf(s))),
  },
  turnaround: {
    label: "turnaround: effectiveShipStats.unloadSpeedMult (missions) / 1 + officerRepairSpeedBonus (Shipyard)",
    read: (s, ctx) => (ctx === "shipyard" ? 1 + officerRepairSpeedBonus(s, shipOf(s)) : sheet(s).unloadSpeedMult ?? 1),
  },
  shipyardBays: { label: "shipyardBayCount", read: (s) => shipyardBayCount(s) },
  shipBuildTicks: { label: "shipBuildDurationTicks(destroyer)", read: (s) => shipBuildDurationTicks(s, "destroyer") },
  shipyardFounded: { label: "canBuildShip passes the founded gate (0/1)", read: (s) => buildGatePassed(s, "notFounded") },
  dockRoom: { label: "canBuildShip passes the docks gate (0/1)", read: (s) => buildGatePassed(s, "storageFull") },
  // == facilities ==
  refineSlots: { label: "refineSlotCount", read: (s) => refineSlotCount(s) },
  refineJobTicks: { label: "refineJobDurationTicks(1000)", read: (s) => refineJobDurationTicks(s, 1000) },
  tier1Cap: { label: "tierCap(1)", read: (s) => Number(tierCap(s, 1)) },
  tier2Cap: { label: "tierCap(2)", read: (s) => Number(tierCap(s, 2)) },
  // WR-4 (OC-C1): the Fuel Depot's fleet reach (shipReachDef scales every ship's reach by 1 + this).
  fleetReach: { label: "fleetReachBonus (the Fuel Depot rungs)", read: (s) => fleetReachBonus(s) },
  researchSlots: { label: "researchSlotCount", read: (s) => researchSlotCount(s) },
  fabricateSlots: { label: "fabricateSlotCount", read: (s) => fabricateSlotCount(s) },
  salvageLanes: { label: "salvageSlotCount", read: (s) => salvageSlotCount(s) },
  missionsUnlocked: { label: "missions unlocked (count)", read: (s) => (Object.keys(MISSIONS) as MissionKey[]).filter((k) => missionUnlocked(s, k)).length },
  telescopeReach: { label: "telescopeReading.reachTier", read: (s) => telescopeReading(s).reachTier },
  telescopeDetail: { label: "telescopeReading.detail", read: (s) => telescopeReading(s).detail },
  equipmentStorage: { label: "equipmentStorageCap", read: (s) => equipmentStorageCap(s) },
  berths: { label: "transitBerthCount", read: (s) => transitBerthCount(s) },
  researchTicks: {
    label: "a long project's research ticks through the museum research speed (tick.ts:7419; 1000x a blueprint's)",
    read: (s) => museumResearchDurationTicks(Object.values(BLUEPRINTS)[0].researchDurationTicks * RESEARCH_PROBE_SCALE, museumBonuses(s).researchSpeed),
  },
  craftQualityClimb: { label: "rollQuality first-climb threshold at the museum crafting quality", read: (s) => qualityClimbThreshold(museumBonuses(s).craftingQuality) },
  // == fleet readers ==
  fleetRareYield: { label: "fleetRareYieldMult", read: (s) => fleetRareYieldMult(s) },
  queueDepthRefinery: { label: "queueDepth(refinery)", read: (s) => queueDepth(s, "refinery") },
  queueDepthFabricator: { label: "queueDepth(fabricator)", read: (s) => queueDepth(s, "fabricator") },
  queueDepthSalvageBay: { label: "queueDepth(salvageBay)", read: (s) => queueDepth(s, "salvageBay") },
  queueDepthResearchLab: { label: "queueDepth(researchLab)", read: (s) => queueDepth(s, "researchLab") },
  queueDepthShipyard: { label: "queueDepth(shipyard)", read: (s) => queueDepth(s, "shipyard") },
  craftingIlevelBonus: { label: "craftingItemLevelBonus", read: (s) => craftingItemLevelBonus(s) },
  salvageTalentYield: {
    label: "salvageTalentBonus.yieldBonus (recycle fraction) / salvage:teardown: what a hull teardown gives back",
    read: (s, ctx) => (ctx === "salvage:teardown" ? teardownRecovered(s) : salvageTalentBonus(s).yieldBonus),
  },
  salvageTalentCeiling: {
    label: "salvageTalentBonus.ceilingBonus / salvage:topTier: the loot tier (its quality rung) a top Fleet Admiral rolls at the top draw",
    read: (s, ctx) => (ctx === "salvage:topTier" ? topTierRolled(s) : salvageTalentBonus(s).ceilingBonus),
  },
  salvageYield: { label: "salvageYieldMult", read: (s) => salvageYieldMult(s) },
  captainCount: { label: "captains (count)", read: (s) => s.captains.length },
  researchableBlueprints: { label: "blueprints a top-level Research Lab can start (blueprintResearchable)", read: (s) => researchableCount(s) },
  legacyInjurySeconds: { label: "applyExpeditionInjuries on a legacy run: the downed Security member's recovery", read: (s) => legacyInjurySeconds(s) },
  candidateTopTier: {
    label: "expeditionCandidates: the highest region tier offered",
    read: (s) => Math.max(...expeditionCandidates(readyForRun(s), WIRING_SHIP_ID).map((c) => c.telescope.regionTier)),
  },
  groundOpsRun: { label: "the Ground Ops run digest (candidates, the dispatch record, the run played out)", read: (s) => groundOpsRunDigest(s) },
  patrolRun: { label: "the patrol cycle digest (dispatch, one cycle through economyTick)", read: (s) => patrolDigest(s) },
  // == crew modules ==
  quartersCapacity: { label: "quartersCapacityBonus", read: (s) => quartersCapacityBonus(s, shipOf(s)) },
  // == expedition dispatch snapshot and its consumers ==
  expSquadTriage: { label: "dispatch: Expedition.squadTriage", read: (s) => dispatchRun(s).squadTriage ?? 0 },
  expEncounterChance: {
    label: "scanEncounterChance on a hazard-0.4 world",
    read: (s) => scanEncounterChance(dispatchRun(s), syntheticBody("terrestrial", 0.4)),
  },
  expReloadMult: { label: "dispatch: groundOps.factors.reloadMult", read: (s) => dispatchRun(s).groundOps?.factors.reloadMult ?? 1 },
  expOffloadMult: { label: "dispatch: groundOps.factors.offloadMult", read: (s) => dispatchRun(s).groundOps?.factors.offloadMult ?? 1 },
  expBoardingRepel: {
    label: "boardingRepelChance(frozen boardingDefense)",
    read: (s) => boardingRepelChance(dispatchRun(s).groundOps?.shipEventProfile.boardingDefense ?? 0),
  },
  expBoardingDefense: { label: "dispatch: shipEventProfile.boardingDefense", read: (s) => dispatchRun(s).groundOps?.shipEventProfile.boardingDefense ?? 0 },
  expScanRate: { label: "scanRatePerSecond on a hazard-0 world", read: (s) => scanRatePerSecond(dispatchRun(s), syntheticBody("terrestrial", 0)) },
  expScanRateHazard: { label: "scanRatePerSecond on a hazard-0.9 world", read: (s) => scanRatePerSecond(dispatchRun(s), syntheticBody("toxic", 0.9)) },
  expSensorPower: { label: "dispatch: Expedition.sensorPower", read: (s) => dispatchRun(s).sensorPower },
  expScanSpeedBonus: { label: "dispatch: Expedition.scanSpeedBonus", read: (s) => dispatchRun(s).scanSpeedBonus ?? 0 },
  expHazardResist: { label: "dispatch: Expedition.hazardResist", read: (s) => dispatchRun(s).hazardResist ?? 0 },
  expRelicFindBonus: { label: "dispatch: Expedition.relicFindBonus", read: (s) => dispatchRun(s).relicFindBonus ?? 0 },
  expActivityRelicFind: { label: "activityRelicFindBonus (no fieldwork)", read: (s) => activityRelicFindBonus(dispatchRun(s), { relicFind: 0 }) },
  expScienceStrength: { label: "deriveAwayTeam.scienceStrength", read: (s) => deriveAwayTeam(s, shipOf(s)).scienceStrength },
  expSecurityStrength: { label: "deriveAwayTeam.securityStrength", read: (s) => deriveAwayTeam(s, shipOf(s)).securityStrength },
  expTeamKit: { label: "deriveAwayTeam.teamKit", read: (s) => deriveAwayTeam(s, shipOf(s)).teamKit },
  expScanRateMult: { label: "dispatch: scanParams.scanRateMult", read: (s) => dispatchRun(s).scanParams.scanRateMult },
  expCoverageWidth: { label: "dispatch: scanParams.coverageWidth", read: (s) => dispatchRun(s).scanParams.coverageWidth },
  expLandmarkBias: { label: "dispatch: scanParams.landmarkOddsBias", read: (s) => dispatchRun(s).scanParams.landmarkOddsBias },
  expUndergroundBias: { label: "dispatch: scanParams.undergroundPoiOddsBias", read: (s) => dispatchRun(s).scanParams.undergroundPoiOddsBias },
  arrayRelicFind: { label: "sensorArrayRelicFindBonus", read: (s) => sensorArrayRelicFindBonus(installedSensorArray(s, shipOf(s))) },
  arrayLandmarkBias: {
    label: "sensorArrayEffect.landmarkOddsBias",
    read: (s) => {
      const a = installedSensorArray(s, shipOf(s));
      return a ? sensorArrayEffect(a).landmarkOddsBias : 0;
    },
  },
  pathfinderScan: { label: "pathfinderEffect.scanSpeed", read: (s) => pathfinderEffect(equippedFor(s, WIRING_SHIP_ID)).scanSpeed },
  pathfinderHazard: { label: "pathfinderEffect.hazardResist", read: (s) => pathfinderEffect(equippedFor(s, WIRING_SHIP_ID)).hazardResist },
  dcRepairReduction: {
    label: "damageControlEffect.repairTimeReduction (Ground Ops: the run digest, its field repair included)",
    read: sheetAt((s) => damageControlEffect(equippedFor(s, WIRING_SHIP_ID)).repairTimeReduction),
  },
  // == injuries ==
  // == the Security squad (real roster builder) ==
  secHp: { label: "Security combatant hp", read: (s) => memberCombatant(s, sec())?.hp ?? 0 },
  secPower: { label: "Security combatant power", read: (s) => memberCombatant(s, sec())?.power ?? 0 },
  secArmor: { label: "Security combatant armor", read: (s) => memberCombatant(s, sec())?.armor ?? 0 },
  secAccuracy: { label: "Security combatant accuracy", read: (s) => memberCombatant(s, sec())?.accuracy ?? 0 },
  secInflictPermille: {
    label: "Security combatant on-hit status permille (sum; ground:noInflict: with every inflict piece taken off)",
    read: (s, ctx) => (memberCombatant(ctx === "ground:noInflict" ? withoutInflictPieces(s) : s, sec())?.onHitStatuses ?? []).reduce((a, x) => a + x.permille, 0),
  },
  secPoisonResist: { label: "Security combatant poison resist permille", read: (s) => memberCombatant(s, sec())?.resists?.poison ?? 0 },
  secGuardBelow: { label: "Security combatant guardBelow", read: (s) => memberCombatant(s, sec())?.guardBelow ?? 0 },
  secFirstStrike: { label: "Security combatant firstStrike (0/1)", read: (s) => (memberCombatant(s, sec())?.firstStrike ? 1 : 0) },
  secFirstAid: { label: "firstAidEffectiveness(Security combatant)", read: (s) => firstAidEffectiveness(memberCombatant(s, sec()) ?? { medic: false }) },
  secHeal: { label: "Security combatant heal", read: (s) => memberCombatant(s, sec())?.heal ?? 0 },
  secGroupHit: { label: "Security combatant groupHit", read: (s) => memberCombatant(s, sec())?.groupHit ?? 0 },
  secRevivePermille: { label: "Security combatant revive permille", read: (s) => memberCombatant(s, sec())?.revive?.permille ?? 0 },
  secResistSum: {
    label: "Security combatant status resists (permille, summed)",
    read: (s) => Object.values(memberCombatant(s, sec())?.resists ?? {}).reduce((a: number, x) => a + (x ?? 0), 0),
  },
  runSecHp: { label: "the dispatched run's Security combatant hp (expeditionTeamCombatants)", read: (s) => runMember(s, sec())?.hp ?? 0 },
  runSecHeal: { label: "the dispatched run's Security combatant heal (expeditionTeamCombatants)", read: (s) => runMember(s, sec())?.heal ?? 0 },
  secTaskHazardResist: {
    label: "taskSecurityHazardResist",
    read: (s) => taskSecurityHazardResist({ roster: rosterOf(s) as Expedition["roster"] }, [{ securityIds: [sec()], scienceIds: [sci()], scienceShare: 1 }]),
  },
  // Science members never fight (D2): their combat lines are read here through the SAME roster builder, which
  // takes only roster.security, so a Science piece's combat line reads 0 until the Science line swap.
  sciCombatPower: { label: "Science member's battle power (none: Science never fights)", read: (s) => squadCombatants(s).find((c) => c.memberId === sci())?.power ?? 0 },
  // == Science fieldwork ==
  fieldSpeed: { label: "fieldworkSpeedMult (best planet)", read: (s) => bestOverPlanets((p) => fieldworkSpeedMult(fieldworkRun(s), p)) },
  fieldRelicFind: { label: "fieldworkEffect.relicFind (best planet)", read: (s) => bestOverPlanets((p) => fieldworkEffect(fieldworkRun(s), p, POI_CATALOG[0].id).relicFind) },
  fieldHazardResist: { label: "fieldworkHazardResist (best planet)", read: (s) => bestOverPlanets((p) => fieldworkHazardResist(fieldworkRun(s), p)) },
  fieldYieldOrganics: { label: "fieldworkEffect(xenoFloraBloom).yieldMult (best planet)", read: (s) => bestOverPlanets((p) => fieldworkEffect(fieldworkRun(s), p, "xenoFloraBloom").yieldMult) },
  fieldYieldVault: { label: "fieldworkEffect(buriedVault).yieldMult (best planet)", read: (s) => bestOverPlanets((p) => fieldworkEffect(fieldworkRun(s), p, "buriedVault").yieldMult) },
  fieldYieldRuins: { label: "fieldworkEffect(ancientRuins).yieldMult (best planet)", read: (s) => bestOverPlanets((p) => fieldworkEffect(fieldworkRun(s), p, "ancientRuins").yieldMult) },
  fieldYieldMineral: { label: "fieldworkEffect(mineralOutcrop).yieldMult (best planet)", read: (s) => bestOverPlanets((p) => fieldworkEffect(fieldworkRun(s), p, "mineralOutcrop").yieldMult) },
} satisfies Record<string, ProbeDef>;

// ============================================================================
// Content probes ("content:<family>:<args>"): content DATA the engine reads (weapons, drone roles, pirate hulls,
// patrols, statuses, gambit actions / selectors / presets, PoIs, planets, loot pools, sell values, mission fields).
// A content source is not something a save "owns", so its on / off is a MARK on the fixture state (sourceOn) that
// the probe reads to include the source or leave it out; "equals" probes read the consumer's value for the def.
// ============================================================================

const SOURCE_ON = new WeakSet<GameState>();

// The fixture with the content source switched ON (a fresh object, so the mark never leaks onto another state).
export function sourceOn(s: GameState): GameState {
  const next = { ...s };
  SOURCE_ON.add(next);
  return next;
}
function isOn(s: GameState): boolean {
  return SOURCE_ON.has(s);
}

// == ship battles ==

const DUEL_SEEDS = [11, 12345, 777];

// One duel per seed between a destroyer frame carrying `weapons` / `drones` and an enemy destroyer frame (armed with
// one autocannon when `enemyArmed`): the enemy's damage taken (hull + shield) and statuses on it, minus the player's
// own damage taken. Summed over the seeds. The enemy's shields do not recharge (WR-4): since B14 the player side
// acts first, and a light Attack squadron's damage was fully recharged by the time an armed enemy finished the duel,
// so the end-of-fight reading could not see it.
function duelScore(weapons: () => CombatWeapon[], drones: () => DroneSquadron[], enemyArmed: boolean): number {
  let total = 0;
  for (const seed of DUEL_SEEDS) {
    const p = shipToCombatant({ id: "p", team: "player", stats: SHIP_TYPES.destroyer, weaponLoadout: weapons(), drones: drones() });
    const e = shipToCombatant({
      id: "e",
      team: "enemy",
      stats: { ...SHIP_TYPES.destroyer, shieldRecharge: 0 },
      weaponLoadout: enemyArmed ? [makeWeaponInstance("autocannon", "e-w0")] : [],
      drones: [],
    });
    const r = resolveBattle({ combatants: [p, e] }, seed, { generateLog: false });
    const fp = r.finalCombatants.find((c) => c.id === "p")!;
    const fe = r.finalCombatants.find((c) => c.id === "e")!;
    total += fe.hullMax + fe.shieldMax - Math.max(0, fe.hull) - Math.max(0, fe.shield) + fe.statusEffects.length;
    total -= fp.hullMax + fp.shieldMax - Math.max(0, fp.hull) - Math.max(0, fp.shield);
    // The player's drones still standing (a Support squadron repairs them; a Defense squadron shields).
    for (const sq of fp.drones) for (const d of sq.drones) total += Math.max(0, d.hp);
  }
  return total;
}

// == ground battles (hand-built combatants: accuracy 1 always hits, armor 0) ==

function gc(id: string, side: "team" | "enemy", over: Partial<GroundCombatant> = {}): GroundCombatant {
  return {
    id,
    side,
    role: side === "team" ? "security" : "bruiser",
    hp: 40,
    hpMax: 40,
    power: 12,
    accuracy: 1,
    armor: 0,
    heal: 0,
    threat: 12,
    groupTag: side === "team" ? "team" : "a",
    statuses: [],
    downed: false,
    ...over,
  };
}

function battle(combatants: GroundCombatant[], teamKit = 2): BattleState {
  return { combatants, round: 0, teamKit, tauntedBy: null };
}

// How much a battle state changed: hp moved, statuses gained or lost, a taunt, kit spent.
function battleChange(before: BattleState, after: BattleState): number {
  let d = 0;
  after.combatants.forEach((c, i) => {
    const b = before.combatants[i];
    d += Math.abs(c.hp - b.hp) + Math.abs(c.statuses.length - b.statuses.length);
  });
  return d + (after.tauntedBy ? 1 : 0) + Math.abs(after.teamKit - before.teamKit);
}

function cloneBattle(b: BattleState): BattleState {
  return { ...b, combatants: b.combatants.map((c) => ({ ...c, statuses: c.statuses.map((x) => ({ ...x })) })) };
}

// The action scenario: a medic actor, a poisoned wounded ally, a healthy foe and a low foe.
function actionScenario(): BattleState {
  const actor = gc("a1", "team", { medic: true, heal: 12, hp: 30, hpMax: 50 });
  const ally = gc("a2", "team", { hp: 20, hpMax: 50 });
  applyStatus(ally, "poison");
  return battle([actor, ally, gc("e1", "enemy"), gc("e2", "enemy", { hp: 10 })]);
}

const ACTION_TARGET: Readonly<Record<GambitActionId, GambitTargetSelector>> = {
  attack: "foeNearest",
  execute: "foeLowestHp",
  suppress: "foeNearest",
  taunt: "openingRound",
  brace: "self",
  cure: "allyHasStatus",
  aidHeal: "allyLowestHp",
  useItem: "allyHasStatus",
  hold: "self",
  fallBack: "self",
  shieldAlly: "allyLowestHp",
  analyze: "foeNearest",
  secureObjective: "self",
  takeCover: "self",
};
export const GAMBIT_ACTIONS = Object.keys(ACTION_TARGET) as GambitActionId[];

function actionChange(action: GambitActionId): number {
  const before = actionScenario();
  const after = cloneBattle(before);
  evaluateAndAct([{ target: ACTION_TARGET[action], action }], after.combatants[0], after, makeRng(0x5eed));
  return battleChange(before, after);
}

// The selector scenario and the combatant each selector should pick (its label's promise).
function selectorScenario(): BattleState {
  const a1 = gc("a1", "team", { hp: 10, hpMax: 50 });
  applyStatus(a1, "weakened");
  const a2 = gc("a2", "team", { hp: 40, hpMax: 50 });
  applyStatus(a2, "poison");
  const e1 = gc("e1", "enemy", { hp: 10, threat: 5, groupTag: "a" });
  const e2 = gc("e2", "enemy", { hp: 30, threat: 20, role: "healer", groupTag: "b" });
  applyStatus(e2, "suppressed");
  const e3 = gc("e3", "enemy", { hp: 20, threat: 8, role: "caster", groupTag: "b" });
  return battle([a1, a2, e1, e2, e3]);
}
const SELECTOR_PICK: Readonly<Record<GambitTargetSelector, { pick: string; params?: GambitRule["params"] }>> = {
  foeNearest: { pick: "e1" },
  foeFarthest: { pick: "e3" },
  foeHighestHp: { pick: "e2" },
  foeLowestHp: { pick: "e1" },
  foeHighestThreat: { pick: "e2" },
  foeIsHealer: { pick: "e2" },
  foeIsCaster: { pick: "e3" },
  foeHasStatus: { pick: "e2", params: { statusId: "suppressed" } },
  foeLargestGroup: { pick: "e2" },
  allyLowestHp: { pick: "a1" },
  allyHpBelow: { pick: "a1", params: { hpThreshold: 0.5 } },
  allyHasStatus: { pick: "a2", params: { statusId: "poison" } },
  self: { pick: "a1" },
  selfHpBelow: { pick: "a1", params: { hpThreshold: 0.5 } },
  selfHasStatus: { pick: "a1", params: { statusId: "weakened" } },
  openingRound: { pick: "e1" },
  outnumbered: { pick: "e1" },
};
export const GAMBIT_SELECTORS = Object.keys(SELECTOR_PICK) as GambitTargetSelector[];

function selectorPicks(sel: GambitTargetSelector): number {
  const st = selectorScenario();
  const want = SELECTOR_PICK[sel];
  return resolveTarget(sel, want.params, st.combatants[0], st)?.id === want.pick ? 1 : 0;
}

// One attack (a fixed stream): the hp the target lost.
function strikeDamage(attackerStatus: GambitStatusId | null, targetStatus: GambitStatusId | null): number {
  const attacker = gc("a1", "team");
  const target = gc("e1", "enemy", { hp: 400, hpMax: 400 });
  if (attackerStatus) applyStatus(attacker, attackerStatus);
  if (targetStatus) applyStatus(target, targetStatus);
  const st = battle([attacker, gc("a2", "team"), target]);
  evaluateAndAct([{ target: "foeNearest", action: "attack" }], st.combatants[0], st, makeRng(0x5eed));
  return 400 - st.combatants[2].hp;
}

function groundStatusValue(id: GambitStatusId, on: boolean): number {
  const def = GAMBIT_STATUSES[id];
  switch (def.effect) {
    case "dotDamage": {
      const c = gc("e1", "enemy", { hp: 100, hpMax: 100 });
      if (on) applyStatus(c, id);
      const st = battle([c]);
      tickEndOfRound(st);
      return 100 - st.combatants[0].hp;
    }
    case "damageDown":
    case "damageUp":
      return strikeDamage(on ? id : null, null);
    case "damageTakenDown":
      return strikeDamage(null, on ? id : null);
    case "accuracyDown": {
      const c = gc("a1", "team", { accuracy: 0.9 });
      if (on) applyStatus(c, id);
      return strikeHitChance(c, {});
    }
    case "skipTurn": {
      // The squad's hp lost over one battle when the foe opens stunned vs not.
      const team = [gc("a1", "team", { hp: 60, hpMax: 60, power: 20 })];
      const foe = gc("e1", "enemy", { hp: 30, hpMax: 30, power: 10 });
      if (on) applyStatus(foe, id);
      const r = resolveGroundBattle(team, [foe], 0, makeRng(0x5eed));
      return team[0].hpMax - r.teamHpRemaining;
    }
    default:
      return 0;
  }
}

// == expedition content ==

// Discoveries of `kind` on a dispatched run's bodies all turned into `planet`, scanned to the end, over a seed batch
// (the discovery roll runs at each body's scan completion, expedition.ts:1344). With the source OFF the planet's
// bias for that pool is CANCELLED by the array bias (the roll adds both), so the odds are the base; ON, base + bias.
function planetFinds(s: GameState, planet: ExpeditionPlanetType, kind: "landmark" | "underground", withBias: boolean): number {
  const def = PLANET_TYPES.find((p) => p.id === planet)!;
  let n = 0;
  for (const seed of [0x1111, 0x2222, 0x3333, 0x4444, 0x5555, 0x6666, 0x7777, 0x8888]) {
    const exp0 = dispatchRun({ ...s, expeditionSeed: seed });
    const cancel = withBias ? 0 : -(kind === "landmark" ? def.surfaceBias : def.undergroundBias);
    const scanParams =
      kind === "landmark"
        ? { ...exp0.scanParams, landmarkOddsBias: exp0.scanParams.landmarkOddsBias + cancel }
        : { ...exp0.scanParams, undergroundPoiOddsBias: exp0.scanParams.undergroundPoiOddsBias + cancel };
    let run: Expedition = { ...exp0, scanParams, bodies: exp0.bodies.map((b) => ({ ...b, planetType: planet })) };
    let t = run.phaseAnchorSeconds;
    for (let i = 0; i < 400 && !run.bodies.every((b) => b.scanned); i++) {
      t += 3600;
      run = advanceExpedition(run, t);
    }
    for (const b of run.bodies) n += b.discoveries.filter((d) => d.kind === kind && POI_CATALOG.some((p) => p.id === d.poiId)).length;
  }
  return n;
}

// == missions ==

// Run one whole mission cycle from dispatch with every draw common (economyTick).
function oneCycle(s: GameState, key: MissionKey): { before: GameState; after: GameState } {
  const def = MISSIONS[key];
  const before = onMission(s, key, "ordersReceived");
  let after = before;
  const ticks = 10 + def.transitOutTicks + def.transitBackTicks + def.unloadTicks + Math.ceil(SHIP_TYPES[shipOf(s).typeKey].cargoCapacity / def.extractionRatePerTick);
  for (let i = 0; i < ticks; i++) after = economyTick(after, 1, () => 0.999999);
  return { before, after };
}

function missionFieldValue(s: GameState, field: string, key: MissionKey): number {
  const def = MISSIONS[key];
  switch (field) {
    case "transitOutTicks":
      return missionDefFor(s, key).transitOutTicks;
    case "transitBackTicks":
      return missionDefFor(s, key).transitBackTicks;
    case "unloadTicks":
      return missionDefFor(s, key).unloadTicks;
    case "extractionRatePerTick":
      return extractingCargo(s, key, 0.999999).common;
    case "rareChance":
      return extractionThreshold(s, key, "rare");
    case "uncommonChance":
      return extractionThreshold(s, key, "uncommon");
    case "fleetAdminXpPerTick": {
      const on = onMission(s, key, "transitOut");
      return Number(economyTick(on, 1, () => 0.5).fleetAdminXp) - Number(on.fleetAdminXp);
    }
    case "creditsPerCycle":
    case "supplyCostPerCargo":
    case "rewardMargin": {
      const { before, after } = oneCycle(s, key);
      return Number(after.credits) - Number(before.credits);
    }
    case "lootTable": {
      const { before, after } = oneCycle(s, key);
      const item = def.lootTable.common;
      return heldOf(after, item) > heldOf(before, item) ? 1 : 0;
    }
    case "unlockLevel": {
      const at = (lvl: number) => (missionUnlocked(withFacilityLevel(s, "missionControl", lvl), key) ? 1 : 0);
      return at(def.unlockLevel) - at(def.unlockLevel - 1);
    }
    case "requiresCaptainLevel": {
      const req = def.requiresCaptainLevel ?? 1;
      const blocked = (lvl: number) => {
        const r = canDispatch(editCaptain(s, { level: lvl }), WIRING_CAPTAIN_ID, key);
        return !r.ok && r.reason === "captainLevel" ? 1 : 0;
      };
      return blocked(req - 1) - blocked(req);
    }
    case "requiresCargoCapacity": {
      const blocked = (hull: ShipTypeKey) => {
        const r = canDispatch(editCaptain(editShip(s, { typeKey: hull }), { level: 99 }), WIRING_CAPTAIN_ID, key);
        return !r.ok && r.reason === "cargo" ? 1 : 0;
      };
      return blocked("prospectorRunner") - blocked("generalFreighter");
    }
    case "primaryMaterial": {
      const full = editCaptain(holding(s, def.primaryMaterial, tierCap(s, 1)), { level: 99 });
      const r = canDispatch(full, WIRING_CAPTAIN_ID, key);
      return !r.ok && r.reason === "materialAtCap" ? 1 : 0;
    }
    default:
      throw new Error(`no mission field probe for ${field}`);
  }
}

// The content probe dispatcher.
function readContent(id: string, s: GameState): number {
  const [, family, a, b, c, d] = id.split(":");
  const on = isOn(s);
  switch (family) {
    case "weapon":
      return duelScore(() => (on ? [makeWeaponInstance(a as WeaponId, "p-w0")] : []), () => [], false);
    case "drone": {
      // A Support squadron works on other drones, so every role is measured beside an Attack squadron.
      const escort = () => (a === "attack" ? [] : [makeSquadron("attack", undefined, 0, "p-d1")]);
      return duelScore(() => [], () => (on ? [makeSquadron(a as DroneRole, undefined, 0, "p-d0"), ...escort()] : escort()), true);
    }
    case "pirate": {
      const e = generateEnemyWave(1, { hullPool: [a as PirateHullId], enemyCountMin: 1, enemyCountMax: 1, idPrefix: "wiring" })[0];
      return b === "shieldCapacity"
        ? e.shieldMax
        : b === "shieldRecharge"
          ? e.shieldRecharge
          : b === "weapons"
            ? e.weapons.length
            : b === "droneRoles"
              ? e.drones.length
              : e.hullMax;
    }
    case "patrolWindow": {
      const def = PATROLS[a];
      let engaging = 0;
      for (let t = 0; t < def.transitOutTicks + def.rollWindowTicks + def.transitBackTicks + 5; t++) if (patrolPhaseFor(def, t) === "engaging") engaging++;
      return engaging;
    }
    case "shipStatus": {
      const def = STATUS_EFFECT_DEFS[a];
      const effects = applyEffect([], a, 0, makeRng(1));
      if (def.mechanic.type === "statDelta") return activeStatDelta(effects, def.mechanic.stat);
      const c = { hull: 1000, alive: true, statusEffects: effects };
      tickEffects(c, 10, makeRng(1));
      return 1000 - c.hull;
    }
    case "groundStatus":
      return groundStatusValue(a as GambitStatusId, on);
    case "action":
      return actionChange(on ? (a as GambitActionId) : "hold");
    case "selector":
      return selectorPicks(a as GambitTargetSelector);
    case "preset": {
      const want = gambitPresetPrograms(a)?.security;
      const c = squadCombatants(s).find((x) => x.memberId === WIRING_SECURITY_ID);
      return want && c?.program && gambitProgramEquals(c.program, want) ? 1 : 0;
    }
    case "poi":
      return PLANET_IDS.filter((p) => {
        const pools = poisForPlanetType(p);
        return [...pools.surface, ...pools.underground].some((w) => w.poi.id === a);
      }).length;
    case "planetHazard":
      return planetTypeHazard(a);
    case "planetBias":
      return planetFinds(s, a as ExpeditionPlanetType, b as "landmark" | "underground", on);
    case "lootPool": {
      // One salvage of the material: the item it gave is one of the pool's configured drops.
      const held = holding(s, a, new Decimal(1));
      const r = salvageSalvagedMaterial(held, a, () => 0.0001);
      if (!r.ok) return 0;
      const drops = new Set(SALVAGE_LOOT_POOLS[a as keyof typeof SALVAGE_LOOT_POOLS].flatMap((t) => t.drops.map((d) => d.itemId)));
      return [...drops].some((k) => heldOf(r.next, k) > heldOf(held, k)) ? 1 : 0;
    }
    case "sell": {
      const held = holding(s, a, new Decimal(10));
      const r = sellItem(held, a, new Decimal(1));
      return r.ok ? Number(r.next.credits) - Number(held.credits) : 0;
    }
    case "mission":
      return missionFieldValue(s, a, b as MissionKey);
    case "loadoutSlots":
      return loadoutSlotDefsForShipType(a as ShipTypeKey).filter((d) => d.slotType === b).length;
    case "groundTeams":
      return groundTeamCount(a as ShipTypeKey);
    case "cure": {
      // The medical bay time of one condition with no care (b = "stoneskin": an Ossir's perk, when the source is on).
      const perks = b === "stoneskin" && on ? (["stoneskin"] as MemberPerkId[]) : [];
      return conditionCureSeconds(GROUND_CONDITIONS[a], perks, { medicalShare: 0, rapidRecoveryShare: 0, officerFacetShare: 0, injurySteady: 0 });
    }
    case "research": {
      // Start the blueprint's research at a top-level Lab with every relic found: the project's ticks.
      const ready = {
        ...withFacilityLevel(s, "research", 9),
        credits: new Decimal(1e12),
        relicDiscovered: RELICS.map((r) => r.id),
      };
      const r = startResearch(ready, a);
      return r.started ? r.next.activeProcesses[r.next.activeProcesses.length - 1].remainingTicks : -1;
    }
    case "refine": {
      // Start a one-job refine line on a built Refinery holding the inputs: the job's ticks once it starts.
      const recipe = REFINE_RECIPES[a];
      let ready = withFacilityLevel(s, "refinery", 1);
      for (const [item, qty] of Object.entries(recipe.input)) ready = holding(ready, item, qty.times(10));
      const r = startLine(ready, "refine", a, { kind: "batch", remaining: 1 });
      if (!r.started) return -1;
      const after = economyTick(r.next, 1, () => 0.5);
      const job = after.activeProcesses.find((p) => p.kind === "refineJob");
      return job ? job.remainingTicks : -1;
    }
    case "craft": {
      // Field Kits FKR-3: one craft of blueprint `a` on a Fabricator at its tier, researched and holding the inputs, run
      // to completion: how many of its output item the inventory gained.
      const bp = BLUEPRINTS[a];
      const out = bp.recipe.outputItem;
      if (out === undefined) return -1;
      let ready: GameState = { ...withFacilityLevel(s, "fabricator", Math.max(1, bp.tier)), researchedBlueprints: [...s.researchedBlueprints, a] };
      for (const [item, qty] of Object.entries(bp.recipe.inputs)) ready = holding(ready, item, new Decimal(qty));
      const before = heldOf(ready, out);
      const r = startLine(ready, "fabricate", a, { kind: "batch", remaining: 1 });
      if (!r.started) return -1;
      let after = r.next;
      for (let i = 0; i < bp.craftDurationTicks + 2; i += 1) after = economyTick(after, 1, () => 0.5);
      return heldOf(after, out) - before;
    }
    case "affix": {
      // An objective carrying one instance of affix `a` at rank `b` (alignment `d`), read by the hook `c`'s reader.
      const alignment = (d ?? "negative") as AffixAlignment;
      const list: ObjectiveAffix[] = on ? [{ id: a as AffixId, rank: Number(b), alignment }] : [];
      return AFFIX_READERS[c](list, alignment);
    }
    case "escalation": {
      // An objective one alert level up (on) vs calm: the escalation's `a` (extraEnemies or damageMult).
      const e = escalationAt(on ? 1 : 0) as unknown as Record<string, number>;
      return e[a];
    }
    case "enemyRank": {
      // Field Kits FKR-1: the guard of a REAL task fight (groundFight.ts taskFightGuard, the list resolveTaskFightOnSeed
      // fields) at the fight point the placement leads with rank `a`: an objective of the grade and point
      // ENEMY_RANK_PROBE_FIGHT names, on a Derelict Outpost (hazard 0.1). On = a ranked run, off = the same run without
      // the flag (every enemy Normal). The lead's (the strongest enemy's) stat `b`: "hp" (whole numbers) or "power".
      const at = ENEMY_RANK_PROBE_FIGHT[a as EnemyRank];
      if (!at) throw new Error(`enemy rank ${a} has no placement to probe`);
      const task = { id: "wiring-task", poiId: "derelictOutpost", fightCount: at.point, pointsCleared: at.point, difficulty: at.grade, fightPoints: [0.25, 0.5, 0.75] };
      const guard = taskFightGuard({ hazardResist: 0, ...(on ? { enemyRanks: { version: ENEMY_RANKS_VERSION } } : {}) }, { hazard: 0.1 }, task, 0x5eed);
      const lead = guard.reduce((best, e) => (e.power > best.power ? e : best));
      return b === "hp" ? lead.hp : lead.power;
    }
    default:
      throw new Error(`unknown content probe ${id}`);
  }
}

// Field Kits FKR-1: the fight each placed rank is probed on (grade 1 Simple .. 5 Deadly, the 0-based fight point of a
// three-point objective): Normal on a Simple final, Strong on a Dangerous earlier point, Elite on a Challenging final,
// Boss on a Deadly final. Weak has none (SF-3 places it on the difficulty curve).
const ENEMY_RANK_PROBE_FIGHT: Readonly<Partial<Record<EnemyRank, { grade: number; point: number }>>> = {
  normal: { grade: 1, point: 2 },
  strong: { grade: 4, point: 0 },
  elite: { grade: 3, point: 2 },
  boss: { grade: 5, point: 2 },
};

// The officer stat facets: the department facet each facet consumer reads (officerStats.ts departmentFacet; for
// the XO's own bonuses, seatFacet). "facet:<dept>:<stat>".
export type FacetProbeId = `facet:${CrewProfession | "all"}:${keyof OfficerStats}`;
export type ContentProbeId = `content:${string}`;
export type MuseumProbeId = `museum:${string}`;
export type ProbeId = keyof typeof PROBES | FacetProbeId | ContentProbeId | MuseumProbeId;

export function probeLabel(id: ProbeId): string {
  if (id.startsWith("content:")) return id;
  if (id.startsWith("museum:")) return `museumBonuses.${id.slice(7)}`;
  if (id.startsWith("facet:")) {
    const [, dept, stat] = id.split(":");
    return dept === "all" ? `seatFacet(executive, ${stat})` : `departmentFacet(${dept}, ${stat})`;
  }
  return (PROBES[id as keyof typeof PROBES] as ProbeDef).label;
}

function readFacet(id: FacetProbeId, s: GameState): number {
  const [, dept, stat] = id.split(":") as [string, CrewProfession | "all", keyof OfficerStats];
  return dept === "all" ? seatFacet(s, shipOf(s), "executive", stat) : departmentFacet(s, shipOf(s), dept, stat);
}

// A probe's value, by id (the registry stores ids so the Debug panel can name them). A non-finite value throws.
export function readProbe(id: ProbeId, s: GameState, ctx: ContextId): number {
  const v = id.startsWith("facet:")
    ? readFacet(id as FacetProbeId, s)
    : id.startsWith("content:")
      ? readContent(id, s)
      : id.startsWith("museum:")
        ? museumBonuses(s)[id.slice(7) as MuseumStat]
        : (PROBES[id as keyof typeof PROBES] as ProbeDef).read(s, ctx);
  if (!Number.isFinite(v)) throw new Error(`probe ${id} returned a non-finite value: ${v}`);
  return v;
}
