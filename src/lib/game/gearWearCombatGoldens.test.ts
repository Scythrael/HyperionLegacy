// GEAR WEAR step 4 GOLDENS FIRST (docs/plans/2026-10-16-gear-wear-design.md sections 10 and 11 step 4, the WR-8 rule):
// the combat step 4 touches, captured on the code BEFORE any step 4 engine edit (on top of 09cca5e), so the engine
// commit has to name every move it makes. Real dispatches through dispatchCaptainOnPatrol / startExpedition and the
// live economyTick loop (1 s ticks), nothing edited after dispatch, on a patrol (or expedition) veteran save, with
// every live slice ON (the combat rules, use wear, the reactor lift):
//
//   patrol:<variant>:<hull>:<route>:<once|repeat> : the dispatch record and the display replay of the cycle, each
//                   relaunch (its tick, record, replay and state), the outcome and its tick, the ship, the state and
//                   ship-1's piece conditions at the end. Variants: `si` (Standard Issue, pristine), `worn` (the same
//                   pieces preset to WORN: true condition and efficiency have something to read), on every hull x both
//                   routes x Dispatch Once and Repeatedly; `crafted` (a quality 3 loadout, the combat hulls, Repeat),
//                   `dc` (a destroyer with a Damage Control Suite, Repeat) and `modules` (a battleship with a worn
//                   Structural Bracing and Last Stand Protocol, Repeat).
//   forecast:<variant>:<hull>:<route> : the dispatch card's Threat Assessment (App.svelte patrolForecastFor
//                   mirrored), five hulls x both routes x si / worn.
//   shipEvent:<variant>:<hull>:<cand>:<seed> : an expedition's Ground Operations ship events run to SWEEP_END: the
//                   battles, the events and the run.
//   battle:<variant>:<hull>:<cand> : the ship battles themselves from stubbed draws (a probe, a cloaked vessel struck
//                   first and ambushing), each event record hashed.
//   ground:<variant> : a crafted Orion whose members wear crafted member gear on an ordinary Ground Ops run (si; worn:
//                   its ship's pieces preset to WORN), through the engine's homecoming: its ship events, the run, the
//                   claimed state and every piece's condition as it lands (member armor wears by battle in step 4).
//   repair:dc       : a damaged destroyer with a Damage Control Suite in its Shipyard repair, to completion.
//
// The parity checks (not hashes): every cycle's display replay reaches the outcome the live loop reached.

import { describe, expect, it } from "vitest";
import { writeFileSync } from "node:fs";
import Decimal from "break_infinity.js";
import {
  EQUIPMENT_SLOTS,
  PATROLS,
  SHIP_TYPES,
  freshState,
  isMemberSlotType,
  type AwayMember,
  type AwayTeamType,
  type EquipmentInstance,
  type EquipmentSlotType,
  type Expedition,
  type GameState,
  type PatrolKey,
  type PatrolMissionState,
  type ShipTypeKey,
} from "./model";
import { dispatchCaptainOnPatrol, economyTick, installMissingCombatBaselines, processShipRepairs, shipRepairDurationTicks } from "./tick";
import { advanceExpedition, claimExpedition, expeditionCandidates, startExpedition } from "./expedition";
import { resolveShipScanEventFromDraws, shipEventKindOf, SHIP_EVENT_DRAW_UNITS, SHIP_EVENT_WEIGHT_TOTAL, type ShipEventDraws } from "./shipScanEvents";
import { equippedFor } from "./equipment";
import { replayPatrol, resolvePatrolWaves } from "./combat/patrolReplay";
import { combatHullTypeOf, defaultSystemDurabilityForHull, foldedPlayerDefense, installedDronesForPatrol } from "./combat/bridge";
import { DEFAULT_SAMPLES } from "./combat/rating";
import { threatAssessment } from "./combat/threatAssessment";
import { hash, onHull, runOutcome, stateHash, SWEEP_END, withCrew } from "./firstRunsGoldens.fixture";
import { asExpeditionVeteran, asPatrolVeteran, dispatchPastPropulsion, plainAwayMember, withoutNebula, withSlottedAwayTeams } from "./awayTeamTestFixtures";
import { patrolDifficultyAt } from "./runDifficulty";
import { officerRepairSpeedBonus, shipCombatRulesStamp } from "./crewOverlay";
import { generateDronePod, generateEquipment, generateWeapon } from "./itemgen";
import { pieceCondition, withPieceCondition } from "./gearWear";
import { emptyWearEvents, recordExpeditionWear, resolveGearWear } from "./gearWearEngine";
import { afterExpeditionTraining } from "./wiring/wearProbes";
import { DAMAGE_CONTROL_SUITE_KEY } from "./utilityGear";

const HULLS = Object.keys(SHIP_TYPES) as ShipTypeKey[];
const ROUTES = Object.keys(PATROLS) as PatrolKey[];
const COMBAT_HULLS: ShipTypeKey[] = ["destroyer", "battleship", "carrier"];
const FORECAST_HULLS: ShipTypeKey[] = ["generalFreighter", "destroyer", "battleship", "carrier", "orion"];
const EXPLORERS: ShipTypeKey[] = ["orion", "aurora", "eir"];
const CANDS = ["cand-0", "cand-1", "cand-2"];
const EXPEDITION_SEEDS: (number | undefined)[] = [undefined, 101];
const RNG = (): number => 0.5;
const MAX_CYCLES = 3;

// The worn variant's conditions, per slot (per-mille): a weapon above the Degraded line, a reactor and a drive just
// below it (so a true-condition pool opens Degraded), the defenses and pods in the Battered band.
const WORN: Readonly<Record<string, number>> = {
  weapon: 640,
  reactorCore: 560,
  ftlDrive: 580,
  shieldEmitters: 620,
  hullPlating: 520,
  droneBay: 600,
  specUtility: 700,
  module: 650,
  cargoBay: 900,
  sensor: 900,
  bridge: 900,
  quarters: 900,
};

const patrolOf = (s: GameState): PatrolMissionState | null => s.captains[0].mission as PatrolMissionState | null;

function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

// Every piece fitted to ship-1 at its WORN condition, anchored at the save's clock. Pure.
function worn(s: GameState): GameState {
  return {
    ...s,
    equipment: s.equipment.map((e) => (e.fittedToShipId === "ship-1" && WORN[e.slotType] !== undefined ? withPieceCondition(e, WORN[e.slotType], s.gameTimeSeconds) : e)),
  };
}

// ===== crafted pieces (the gearWearGoldens method: the real generators, quality 3, seeded) =====

const CRAFTED_QUALITY = 3;
const CRAFTED_ILEVEL = 30;

function craftedLike(like: EquipmentInstance, id: string, seed: number): EquipmentInstance | null {
  const common = { blueprintKey: null, iLevel: CRAFTED_ILEVEL, quality: CRAFTED_QUALITY, rarity: "augmented" as const, ascension: "none" as const, rng: lcg(seed), allocateId: () => id };
  if (like.slotType === "weapon" && like.weaponType) return generateWeapon({ weaponType: like.weaponType, ...common });
  if (like.slotType === "droneBay" && like.droneRole) return generateDronePod({ droneRole: like.droneRole, ...common });
  const slot = EQUIPMENT_SLOTS[like.slotType];
  if (!slot) return null;
  return generateEquipment({ slotType: like.slotType, varietyKey: like.moduleVariant ?? slot.varieties[0].key, ...common });
}

function craftedLoadout(s: GameState): GameState {
  const base = installMissingCombatBaselines(s);
  let n = 0;
  const equipment = base.equipment.map((e) => {
    if (e.fittedToShipId !== "ship-1") return e;
    n += 1;
    const p = craftedLike(e, `gw4-${e.slotType}-${n}`, 0x9e37 + n * 7919);
    return p ? { ...p, fittedToShipId: "ship-1" } : e;
  });
  return { ...base, equipment };
}

// One crafted piece of a utility or module variety, installed on ship-1 (replacing any piece of a single slot).
function installCrafted(s: GameState, slotType: EquipmentSlotType, varietyKey: string, id: string, seed: number, replace: boolean): GameState {
  const p = generateEquipment({ slotType, varietyKey, blueprintKey: null, iLevel: CRAFTED_ILEVEL, quality: CRAFTED_QUALITY, rarity: "augmented", ascension: "none", rng: lcg(seed), allocateId: () => id });
  const kept = replace ? s.equipment.filter((e) => !(e.fittedToShipId === "ship-1" && e.slotType === slotType)) : s.equipment;
  return { ...s, equipment: [...kept, { ...p, fittedToShipId: "ship-1" }] };
}

// Ship-1's pieces as `slot=condition` (the pins name what wore, not only a hash).
function conditions(s: GameState): string {
  return s.equipment
    .filter((e) => e.fittedToShipId === "ship-1" || e.fittedToMemberId)
    .map((e) => `${e.slotType}=${pieceCondition(e)}`)
    .join(" ");
}

// ===== patrols =====

type Variant = "si" | "worn" | "crafted" | "dc" | "modules";

function patrolBase(hull: ShipTypeKey, variant: Variant): GameState {
  let s = asPatrolVeteran({ ...onHull(hull), nextPatrolSeed: 1, credits: new Decimal(100_000) });
  if (variant === "worn") s = worn(s);
  if (variant === "crafted") s = craftedLoadout(s);
  if (variant === "dc") s = installCrafted(s, "specUtility", DAMAGE_CONTROL_SUITE_KEY, "gw4-dc", 0x0dc5, true);
  if (variant === "modules") {
    s = installCrafted(s, "module", "structuralBracing", "gw4-bracing", 0x0b7a, false);
    s = installCrafted(s, "module", "lastStandProtocol", "gw4-laststand", 0x1a57, false);
    s = { ...s, equipment: s.equipment.map((e) => (e.slotType === "module" ? withPieceCondition(e, WORN.module, s.gameTimeSeconds) : e)) };
  }
  return s;
}

// One patrol from `state`, advanced in 1 s ticks until the captain idles (Once) or MAX_CYCLES cycles have started
// (Repeat: then recalled and flown home). Every cycle's display replay must reach the outcome the live cycle did.
function patrolRun(state: GameState, key: PatrolKey, repeat: boolean, label: string): string[] {
  const r = dispatchCaptainOnPatrol(state, 1, key, "balanced", repeat);
  expect(r.success, `${label}: ${r.reason}`).toBe(true);
  let replay = replayPatrol(r.next, r.next.captains[0]);
  const row = [hash(structuredClone(r.next.captains[0].mission)), hash(replay)];
  let s = r.next;
  let ticks = 0;
  let cycles = 1;
  let seed = patrolOf(s)!.masterSeed;
  let lostCycle = false;
  while (patrolOf(s) !== null) {
    s = economyTick(s, 1, RNG);
    ticks += 1;
    const m = patrolOf(s);
    if (m !== null && m.phase === "limpingHome") lostCycle = true;
    if (m !== null && m.masterSeed !== seed) {
      expect(replay.defeated, `${label}: the replay of cycle ${cycles} reaches the live outcome`).toBe(false);
      seed = m.masterSeed;
      cycles += 1;
      replay = replayPatrol(s, s.captains[0]);
      row.push(`relaunch:${ticks}`, hash(structuredClone(m)), hash(replay), stateHash(s));
      if (cycles >= MAX_CYCLES) s = { ...s, captains: s.captains.map((c, i) => (i === 0 && c.mission?.kind === "patrol" ? { ...c, mission: { ...c.mission, recalled: true } } : c)) };
    }
    if (ticks > 6000) throw new Error(`${label}: the patrol never ended`);
  }
  expect(replay.defeated, `${label}: the replay of the last cycle reaches the live outcome`).toBe(lostCycle);
  row.push(`${s.ships[0].damaged === true ? "lost" : "won"}:${ticks}`, hash(s.ships[0]), stateHash(s), conditions(s));
  return row;
}

// App.svelte patrolForecastFor's sweep, mirrored (FORECAST_SEED 0x5a4d + i over DEFAULT_SAMPLES).
function forecast(state: GameState, key: PatrolKey): string {
  const ship = state.ships[0];
  const hullType = combatHullTypeOf(ship.typeKey);
  if (hullType === null) return "none";
  const def = PATROLS[key];
  const shipDef = SHIP_TYPES[ship.typeKey];
  const installedGear = equippedFor(state, ship.id);
  const startDrones = installedDronesForPatrol(installedGear, `forecast-${key}-p`);
  const combatRules = shipCombatRulesStamp(state, ship);
  const startSystemDurability = defaultSystemDurabilityForHull(hullType, shipDef, installedGear, combatRules);
  const startDefense = foldedPlayerDefense(shipDef, installedGear);
  let wins = 0;
  for (let i = 0; i < DEFAULT_SAMPLES; i++) {
    const result = resolvePatrolWaves({
      playerId: ship.id, stats: shipDef, hullType, stance: "balanced", installedGear, masterSeed: 0x5a4d + i, factionId: def.factionId, def,
      startHull: startDefense.hullMax, startShield: startDefense.shieldMax, startDrones, startSystemDurability,
      difficulty: patrolDifficultyAt(state), combatRules,
    });
    if (!result.defeated) wins += 1;
  }
  return `${wins}:${threatAssessment(wins, DEFAULT_SAMPLES).tier}`;
}

// ===== expedition ship events =====

function shipEventBase(hull: ShipTypeKey, seed: number | undefined, variant: "si" | "worn"): GameState {
  const s = asExpeditionVeteran(withCrew(onHull(hull, seed), "d18"));
  return variant === "worn" ? worn(s) : s;
}

// The run home through the engine's own tail at the instant it lands (recordExpeditionWear, resolveGearWear).
function landed(before: GameState, done: Expedition): GameState {
  const home: GameState = { ...before, expeditions: before.expeditions.map((e) => (e.id === done.id ? done : e)), gameTimeSeconds: done.phaseAnchorSeconds };
  const events = emptyWearEvents();
  recordExpeditionWear(before, home, events);
  return resolveGearWear(before, home, events);
}

function shipEventRow(hull: ShipTypeKey, cand: string, seed: number | undefined, variant: "si" | "worn"): string[] {
  const res = dispatchPastPropulsion(shipEventBase(hull, seed, variant), "ship-1", 1, cand);
  expect(res.success, `${hull} ${cand}: ${res.reason}`).toBe(true);
  const done: Expedition = advanceExpedition(withoutNebula(res.expedition!), SWEEP_END);
  const events = (done.scanEvents ?? []).filter((e) => e.kind === "shipEvent");
  const battles = events.filter((e) => e.event === "probe" || e.event === "cloaked").map((e) => `${e.event}:${e.outcome}`);
  const o = runOutcome(done);
  return [battles.join(",") || "none", hash(events), `${o.objectives} hull:${o.hullDamage} setbacks:${o.setbacks}`, hash(done)];
}

function kindDraw(want: "probe" | "cloaked"): number {
  for (let k = 0; k < SHIP_EVENT_WEIGHT_TOTAL; k++) if (shipEventKindOf({ kind: k, cloaked: 0 }) === want) return k;
  throw new Error(`no draw names ${want}`);
}

function battleRow(hull: ShipTypeKey, cand: string, variant: "si" | "worn"): string[] {
  const res = dispatchPastPropulsion(shipEventBase(hull, undefined, variant), "ship-1", 1, cand);
  expect(res.success, `${hull} ${cand}: ${res.reason}`).toBe(true);
  const exp = res.expedition!;
  const quiet = { boardingAttempt: SHIP_EVENT_DRAW_UNITS - 1, boardingRepel: 0 };
  const cases: [string, ShipEventDraws][] = [
    ["probe", { kind: kindDraw("probe"), check: 0, cloaked: 0, ...quiet }],
    ["cloakedPass", { kind: kindDraw("cloaked"), check: 0, cloaked: 0, ...quiet }],
    ["cloakedFail", { kind: kindDraw("cloaked"), check: SHIP_EVENT_DRAW_UNITS - 1, cloaked: 0, ...quiet }],
  ];
  const out: string[] = [];
  for (const [name, draws] of cases) {
    for (let b = 0; b < Math.min(2, exp.bodies.length); b++) {
      for (const step of [0, 1, 2]) {
        const r = resolveShipScanEventFromDraws(exp, exp.bodies[b], b, step, 1, draws);
        out.push(`${name}:${b}:${step}:${r.event.outcome}:${r.event.hullWear ?? 0}:${hash(r.event)}`);
      }
    }
  }
  return out;
}

// ===== the ground run (member armor) =====

function memberPiece(slotType: EquipmentSlotType, team: AwayTeamType, memberId: string, seed: number): EquipmentInstance {
  const v = EQUIPMENT_SLOTS[slotType].varieties.find((x) => x.member?.teamTypes.includes(team));
  if (!v) throw new Error(`no ${team} variety for ${slotType}`);
  const p = generateEquipment({ slotType, varietyKey: v.key, blueprintKey: null, iLevel: CRAFTED_ILEVEL, quality: CRAFTED_QUALITY, rarity: "augmented", ascension: "none", rng: lcg(seed), allocateId: () => `gw4-${memberId}-${slotType}` });
  return { ...p, fittedToShipId: null, fittedToMemberId: memberId };
}

const MEMBER_SLOTS = (Object.keys(EQUIPMENT_SLOTS) as EquipmentSlotType[]).filter((k) => isMemberSlotType(k));

function groundRun(variant: "si" | "worn"): string[] {
  const squad: AwayMember[] = [
    { ...plainAwayMember("member-1", "security", "ship-1"), rank: 3 },
    { ...plainAwayMember("member-2", "security", "ship-1"), rank: 2 },
    plainAwayMember("member-11", "science", "ship-1"),
  ];
  let s0 = craftedLoadout({ ...onHull("orion"), awayMembers: squad, nextAwayMemberId: 100, expeditionSeed: 0x4ea2 });
  squad.forEach((m, i) => {
    const pieces = MEMBER_SLOTS.flatMap((slot, j) => (EQUIPMENT_SLOTS[slot].varieties.some((x) => x.member?.teamTypes.includes(m.teamType)) ? [memberPiece(slot, m.teamType, m.id, 0x51 + i * 977 + j * 131)] : []));
    s0 = { ...s0, equipment: [...s0.equipment, ...pieces] };
  });
  s0 = afterExpeditionTraining(withSlottedAwayTeams(s0));
  if (variant === "worn") s0 = worn(s0);
  const res = startExpedition(s0, "ship-1", 1, expeditionCandidates(s0, "ship-1")[0].id);
  if (!res.success || !res.expedition) throw new Error(`dispatch refused: ${res.reason}`);
  let s = res.next;
  for (let i = 0; i < 40; i++) s = economyTick(s, 1, lcg(0x4e));
  const done = advanceExpedition(s.expeditions[0], 2_000_000);
  expect(done.phase).toBe("complete");
  const shipEvents = (done.scanEvents ?? []).filter((e) => e.kind === "shipEvent");
  const battles = shipEvents.map((e) => `${e.event}:${e.outcome}:${e.hullWear ?? 0}`).join(",") || "none";
  const home = landed(s, done);
  const claim = claimExpedition(home, done.id);
  expect(claim.success).toBe(true);
  return [battles, hash(res.expedition), hash(done), stateHash(claim.next), conditions(home)];
}

// ===== the Shipyard repair with a Damage Control Suite =====

function dcRepair(): string[] {
  const base = installCrafted(onHull("destroyer"), "specUtility", DAMAGE_CONTROL_SUITE_KEY, "gw4-dc", 0x0dc5, true);
  const s0: GameState = { ...base, ships: base.ships.map((sh) => (sh.id === "ship-1" ? { ...sh, damaged: true, repairDamage: 311 } : sh)) };
  const ship = s0.ships[0];
  const ticks = shipRepairDurationTicks(ship, equippedFor(s0, ship.id), officerRepairSpeedBonus(s0, ship));
  const started = processShipRepairs(s0);
  let done = started;
  for (let i = 0; i < ticks + 2; i++) done = economyTick(done, 1, lcg(0x2e9a));
  expect(done.ships[0].damaged).toBeUndefined();
  return [String(ticks), hash(started.activeProcesses), stateHash(done), conditions(done)];
}

// ===== the capture =====

// Captured on 09cca5e (the step 4 engine not yet in), 2026-10-27, with GW4_CAPTURE.
const GOLDEN_PRE: Record<string, string[]> = {
  "patrol:si:generalFreighter:crimsonReaverSweep:once": ["e38d27d1", "597c09a2", "won:14", "b2f38143", "619f0aa1", "cargoBay=1000 ftlDrive=1000 reactorCore=1000 specUtility=1000 weapon=1000 weapon=1000 shieldEmitters=1000 hullPlating=1000"],
  "patrol:si:generalFreighter:crimsonReaverSweep:repeat": ["73034d22", "597c09a2", "relaunch:14", "63a72302", "dfb680d9", "802729ba", "relaunch:28", "c21dbd9a", "dda0cde2", "4099a67c", "won:42", "b2f38143", "1193c52", "cargoBay=1000 ftlDrive=1000 reactorCore=1000 specUtility=1000 weapon=1000 weapon=1000 shieldEmitters=1000 hullPlating=1000"],
  "patrol:si:generalFreighter:crimsonReaverWarband:once": ["8170ae77", "3bc66d4f", "lost:20", "701a58f1", "beaf4ad4", "cargoBay=1000 ftlDrive=1000 reactorCore=1000 specUtility=1000 weapon=1000 weapon=1000 shieldEmitters=1000 hullPlating=1000"],
  "patrol:si:generalFreighter:crimsonReaverWarband:repeat": ["99dcfe20", "3bc66d4f", "lost:20", "701a58f1", "beaf4ad4", "cargoBay=1000 ftlDrive=1000 reactorCore=1000 specUtility=1000 weapon=1000 weapon=1000 shieldEmitters=1000 hullPlating=1000"],
  "patrol:si:prospectorHauler:crimsonReaverSweep:once": ["f98b7306", "41ce7378", "won:14", "9d03d00b", "44d412c5", "cargoBay=1000 ftlDrive=1000 reactorCore=1000 specUtility=1000 weapon=1000 weapon=1000 shieldEmitters=1000 hullPlating=1000"],
  "patrol:si:prospectorHauler:crimsonReaverSweep:repeat": ["934c2bc3", "41ce7378", "relaunch:14", "e12e8723", "775306c6", "e1b49b3", "relaunch:28", "ffa3365b", "c05e6e30", "e0ca0b5f", "won:42", "9d03d00b", "47f525c2", "cargoBay=1000 ftlDrive=1000 reactorCore=1000 specUtility=1000 weapon=1000 weapon=1000 shieldEmitters=1000 hullPlating=1000"],
  "patrol:si:prospectorHauler:crimsonReaverWarband:once": ["80c4d6e8", "45b124f1", "lost:23", "8539ed3f", "2e9d3cfb", "cargoBay=1000 ftlDrive=1000 reactorCore=1000 specUtility=1000 weapon=1000 weapon=1000 shieldEmitters=1000 hullPlating=1000"],
  "patrol:si:prospectorHauler:crimsonReaverWarband:repeat": ["106706bd", "45b124f1", "lost:23", "8539ed3f", "2e9d3cfb", "cargoBay=1000 ftlDrive=1000 reactorCore=1000 specUtility=1000 weapon=1000 weapon=1000 shieldEmitters=1000 hullPlating=1000"],
  "patrol:si:prospectorRunner:crimsonReaverSweep:once": ["63a6753a", "b0c9ae30", "lost:10", "e1360e3a", "3458dee6", "cargoBay=1000 ftlDrive=1000 reactorCore=1000 specUtility=1000 weapon=1000 shieldEmitters=1000 hullPlating=1000"],
  "patrol:si:prospectorRunner:crimsonReaverSweep:repeat": ["214270f", "b0c9ae30", "lost:10", "e1360e3a", "3458dee6", "cargoBay=1000 ftlDrive=1000 reactorCore=1000 specUtility=1000 weapon=1000 shieldEmitters=1000 hullPlating=1000"],
  "patrol:si:prospectorRunner:crimsonReaverWarband:once": ["121696a8", "88141285", "lost:20", "e1360e3a", "7542ef9a", "cargoBay=1000 ftlDrive=1000 reactorCore=1000 specUtility=1000 weapon=1000 shieldEmitters=1000 hullPlating=1000"],
  "patrol:si:prospectorRunner:crimsonReaverWarband:repeat": ["30947c7d", "88141285", "lost:20", "e1360e3a", "7542ef9a", "cargoBay=1000 ftlDrive=1000 reactorCore=1000 specUtility=1000 weapon=1000 shieldEmitters=1000 hullPlating=1000"],
  "patrol:si:prospectorMiner:crimsonReaverSweep:once": ["de8ea837", "1b2af2bc", "lost:10", "4a78733f", "e7fd04bd", "cargoBay=1000 ftlDrive=1000 reactorCore=1000 specUtility=1000 weapon=1000 shieldEmitters=1000 hullPlating=1000"],
  "patrol:si:prospectorMiner:crimsonReaverSweep:repeat": ["e25a34e0", "1b2af2bc", "lost:10", "4a78733f", "e7fd04bd", "cargoBay=1000 ftlDrive=1000 reactorCore=1000 specUtility=1000 weapon=1000 shieldEmitters=1000 hullPlating=1000"],
  "patrol:si:prospectorMiner:crimsonReaverWarband:once": ["45245f69", "8774e398", "lost:20", "4a78733f", "445177ad", "cargoBay=1000 ftlDrive=1000 reactorCore=1000 specUtility=1000 weapon=1000 shieldEmitters=1000 hullPlating=1000"],
  "patrol:si:prospectorMiner:crimsonReaverWarband:repeat": ["33ff849a", "8774e398", "lost:20", "4a78733f", "445177ad", "cargoBay=1000 ftlDrive=1000 reactorCore=1000 specUtility=1000 weapon=1000 shieldEmitters=1000 hullPlating=1000"],
  "patrol:si:destroyer:crimsonReaverSweep:once": ["31e77619", "ba2ee129", "won:14", "6ad9f46c", "d4055219", "cargoBay=1000 ftlDrive=1000 reactorCore=1000 specUtility=1000 weapon=1000 weapon=1000 weapon=1000 weapon=1000 shieldEmitters=1000 hullPlating=1000"],
  "patrol:si:destroyer:crimsonReaverSweep:repeat": ["88ed10aa", "ba2ee129", "relaunch:14", "60ebf60a", "cd28e7d8", "ec4d7b2e", "relaunch:28", "7e062882", "9aedc8b", "b1f3a2b2", "won:42", "6ad9f46c", "bba9124", "cargoBay=1000 ftlDrive=1000 reactorCore=1000 specUtility=1000 weapon=1000 weapon=1000 weapon=1000 weapon=1000 shieldEmitters=1000 hullPlating=1000"],
  "patrol:si:destroyer:crimsonReaverWarband:once": ["d309e353", "5469ccef", "won:22", "6ad9f46c", "94a165d6", "cargoBay=1000 ftlDrive=1000 reactorCore=1000 specUtility=1000 weapon=1000 weapon=1000 weapon=1000 weapon=1000 shieldEmitters=1000 hullPlating=1000"],
  "patrol:si:destroyer:crimsonReaverWarband:repeat": ["f622e534", "5469ccef", "relaunch:22", "2ac69177", "ebef6932", "92f08a9f", "lost:38", "44b4c6b5", "db558c17", "cargoBay=1000 ftlDrive=1000 reactorCore=1000 specUtility=1000 weapon=1000 weapon=1000 weapon=1000 weapon=1000 shieldEmitters=1000 hullPlating=1000"],
  "patrol:si:battleship:crimsonReaverSweep:once": ["8117c7c7", "2436a90a", "won:14", "c6dba9cb", "6a6e81a4", "cargoBay=1000 ftlDrive=1000 reactorCore=1000 specUtility=1000 weapon=1000 weapon=1000 weapon=1000 weapon=1000 weapon=1000 weapon=1000 shieldEmitters=1000 hullPlating=1000"],
  "patrol:si:battleship:crimsonReaverSweep:repeat": ["20cde710", "2436a90a", "relaunch:14", "faca3df0", "4028ddbe", "a70c0c5b", "relaunch:28", "c0349798", "b7cafc2b", "e313c0f5", "won:42", "c6dba9cb", "ae27954d", "cargoBay=1000 ftlDrive=1000 reactorCore=1000 specUtility=1000 weapon=1000 weapon=1000 weapon=1000 weapon=1000 weapon=1000 weapon=1000 shieldEmitters=1000 hullPlating=1000"],
  "patrol:si:battleship:crimsonReaverWarband:once": ["5ef43211", "a4925972", "won:22", "c6dba9cb", "394499f3", "cargoBay=1000 ftlDrive=1000 reactorCore=1000 specUtility=1000 weapon=1000 weapon=1000 weapon=1000 weapon=1000 weapon=1000 weapon=1000 shieldEmitters=1000 hullPlating=1000"],
  "patrol:si:battleship:crimsonReaverWarband:repeat": ["34602562", "a4925972", "relaunch:22", "2140ca1f", "e45fd510", "e9252c44", "lost:40", "afe73d75", "f547373a", "cargoBay=1000 ftlDrive=1000 reactorCore=1000 specUtility=1000 weapon=1000 weapon=1000 weapon=1000 weapon=1000 weapon=1000 weapon=1000 shieldEmitters=1000 hullPlating=1000"],
  "patrol:si:carrier:crimsonReaverSweep:once": ["10bbdaa4", "8f2f9130", "won:14", "ea909677", "9554bb6e", "cargoBay=1000 ftlDrive=1000 reactorCore=1000 specUtility=1000 weapon=1000 weapon=1000 shieldEmitters=1000 hullPlating=1000 droneBay=1000"],
  "patrol:si:carrier:crimsonReaverSweep:repeat": ["850b5d91", "8f2f9130", "relaunch:14", "58546b3", "c6c25f92", "c852a96", "relaunch:28", "d272f5a0", "d7d386e7", "fe0a521d", "won:42", "ea909677", "64959369", "cargoBay=1000 ftlDrive=1000 reactorCore=1000 specUtility=1000 weapon=1000 weapon=1000 shieldEmitters=1000 hullPlating=1000 droneBay=1000"],
  "patrol:si:carrier:crimsonReaverWarband:once": ["cf2ed6fa", "c28deffe", "won:22", "ea909677", "15006abb", "cargoBay=1000 ftlDrive=1000 reactorCore=1000 specUtility=1000 weapon=1000 weapon=1000 shieldEmitters=1000 hullPlating=1000 droneBay=1000"],
  "patrol:si:carrier:crimsonReaverWarband:repeat": ["a6257fcf", "c28deffe", "relaunch:22", "ef3396d8", "9145b617", "1f175bf5", "lost:38", "73109288", "5d7605b4", "cargoBay=1000 ftlDrive=1000 reactorCore=1000 specUtility=1000 weapon=1000 weapon=1000 shieldEmitters=1000 hullPlating=1000 droneBay=1000"],
  "patrol:si:orion:crimsonReaverSweep:once": ["40a9303c", "f6d6af33", "won:14", "c75858d4", "9f06f3dd", "cargoBay=1000 ftlDrive=1000 reactorCore=1000 specUtility=1000 weapon=1000 shieldEmitters=1000 hullPlating=1000"],
  "patrol:si:orion:crimsonReaverSweep:repeat": ["d818f5a9", "f6d6af33", "relaunch:14", "819d4289", "df046fc3", "2232a633", "relaunch:28", "e7cf8ac1", "ec1608e8", "32de9505", "won:42", "c75858d4", "6d24a25c", "cargoBay=1000 ftlDrive=1000 reactorCore=1000 specUtility=1000 weapon=1000 shieldEmitters=1000 hullPlating=1000"],
  "patrol:si:orion:crimsonReaverWarband:once": ["65e0e99a", "acbf2a27", "lost:20", "6619cb48", "20b8680", "cargoBay=1000 ftlDrive=1000 reactorCore=1000 specUtility=1000 weapon=1000 shieldEmitters=1000 hullPlating=1000"],
  "patrol:si:orion:crimsonReaverWarband:repeat": ["d6a857ef", "acbf2a27", "lost:20", "6619cb48", "20b8680", "cargoBay=1000 ftlDrive=1000 reactorCore=1000 specUtility=1000 weapon=1000 shieldEmitters=1000 hullPlating=1000"],
  "patrol:si:aurora:crimsonReaverSweep:once": ["dbd9c477", "6eeaff13", "won:14", "62b89a6f", "511447be", "cargoBay=1000 ftlDrive=1000 reactorCore=1000 specUtility=1000 weapon=1000 shieldEmitters=1000 hullPlating=1000"],
  "patrol:si:aurora:crimsonReaverSweep:repeat": ["a9555020", "6eeaff13", "relaunch:14", "2640ec00", "29baaf8e", "72233a1f", "relaunch:28", "88c7eb68", "c1840d62", "2d93ea29", "won:42", "62b89a6f", "efae95d5", "cargoBay=1000 ftlDrive=1000 reactorCore=1000 specUtility=1000 weapon=1000 shieldEmitters=1000 hullPlating=1000"],
  "patrol:si:aurora:crimsonReaverWarband:once": ["c5c49945", "a5c4a4bd", "lost:20", "def772e7", "e97d0cbd", "cargoBay=1000 ftlDrive=1000 reactorCore=1000 specUtility=1000 weapon=1000 shieldEmitters=1000 hullPlating=1000"],
  "patrol:si:aurora:crimsonReaverWarband:repeat": ["faa3a9e", "a5c4a4bd", "lost:20", "def772e7", "e97d0cbd", "cargoBay=1000 ftlDrive=1000 reactorCore=1000 specUtility=1000 weapon=1000 shieldEmitters=1000 hullPlating=1000"],
  "patrol:si:eir:crimsonReaverSweep:once": ["87e41c0f", "28bafcf2", "won:14", "ffdca63b", "ef5f54b8", "cargoBay=1000 ftlDrive=1000 reactorCore=1000 specUtility=1000 weapon=1000 shieldEmitters=1000 hullPlating=1000"],
  "patrol:si:eir:crimsonReaverSweep:repeat": ["59e3b7f8", "28bafcf2", "relaunch:14", "a8468558", "b801119d", "99ea9bf9", "relaunch:28", "e57d6b00", "ca52d3ab", "e967f201", "won:42", "ffdca63b", "34db43b9", "cargoBay=1000 ftlDrive=1000 reactorCore=1000 specUtility=1000 weapon=1000 shieldEmitters=1000 hullPlating=1000"],
  "patrol:si:eir:crimsonReaverWarband:once": ["3cd5058d", "5f90e37a", "lost:20", "7ddb5b8d", "d9543d0b", "cargoBay=1000 ftlDrive=1000 reactorCore=1000 specUtility=1000 weapon=1000 shieldEmitters=1000 hullPlating=1000"],
  "patrol:si:eir:crimsonReaverWarband:repeat": ["51f75e26", "5f90e37a", "lost:20", "7ddb5b8d", "d9543d0b", "cargoBay=1000 ftlDrive=1000 reactorCore=1000 specUtility=1000 weapon=1000 shieldEmitters=1000 hullPlating=1000"],
  "patrol:worn:generalFreighter:crimsonReaverSweep:once": ["e38d27d1", "597c09a2", "won:14", "b2f38143", "9156cdca", "cargoBay=909 ftlDrive=589 reactorCore=569 specUtility=709 weapon=649 weapon=649 shieldEmitters=629 hullPlating=529"],
  "patrol:worn:generalFreighter:crimsonReaverSweep:repeat": ["73034d22", "597c09a2", "relaunch:14", "63a72302", "dfb680d9", "1b6fa42f", "relaunch:28", "c21dbd9a", "dda0cde2", "de2e6881", "won:42", "b2f38143", "f960d867", "cargoBay=909 ftlDrive=589 reactorCore=569 specUtility=709 weapon=649 weapon=649 shieldEmitters=629 hullPlating=529"],
  "patrol:worn:generalFreighter:crimsonReaverWarband:once": ["8170ae77", "3bc66d4f", "lost:20", "701a58f1", "7b417b6e", "cargoBay=926 ftlDrive=606 reactorCore=586 specUtility=726 weapon=666 weapon=666 shieldEmitters=646 hullPlating=546"],
  "patrol:worn:generalFreighter:crimsonReaverWarband:repeat": ["99dcfe20", "3bc66d4f", "lost:20", "701a58f1", "7b417b6e", "cargoBay=926 ftlDrive=606 reactorCore=586 specUtility=726 weapon=666 weapon=666 shieldEmitters=646 hullPlating=546"],
  "patrol:worn:prospectorHauler:crimsonReaverSweep:once": ["f98b7306", "41ce7378", "won:14", "9d03d00b", "4e57ac3e", "cargoBay=909 ftlDrive=589 reactorCore=569 specUtility=709 weapon=649 weapon=649 shieldEmitters=629 hullPlating=529"],
  "patrol:worn:prospectorHauler:crimsonReaverSweep:repeat": ["934c2bc3", "41ce7378", "relaunch:14", "e12e8723", "775306c6", "2368a58c", "relaunch:28", "ffa3365b", "c05e6e30", "a15437c8", "won:42", "9d03d00b", "baec3517", "cargoBay=909 ftlDrive=589 reactorCore=569 specUtility=709 weapon=649 weapon=649 shieldEmitters=629 hullPlating=529"],
  "patrol:worn:prospectorHauler:crimsonReaverWarband:once": ["80c4d6e8", "45b124f1", "lost:23", "8539ed3f", "c35ab53", "cargoBay=930 ftlDrive=610 reactorCore=590 specUtility=730 weapon=670 weapon=670 shieldEmitters=650 hullPlating=550"],
  "patrol:worn:prospectorHauler:crimsonReaverWarband:repeat": ["106706bd", "45b124f1", "lost:23", "8539ed3f", "c35ab53", "cargoBay=930 ftlDrive=610 reactorCore=590 specUtility=730 weapon=670 weapon=670 shieldEmitters=650 hullPlating=550"],
  "patrol:worn:prospectorRunner:crimsonReaverSweep:once": ["63a6753a", "b0c9ae30", "lost:10", "e1360e3a", "1ada2635", "cargoBay=913 ftlDrive=593 reactorCore=573 specUtility=713 weapon=653 shieldEmitters=633 hullPlating=533"],
  "patrol:worn:prospectorRunner:crimsonReaverSweep:repeat": ["214270f", "b0c9ae30", "lost:10", "e1360e3a", "1ada2635", "cargoBay=913 ftlDrive=593 reactorCore=573 specUtility=713 weapon=653 shieldEmitters=633 hullPlating=533"],
  "patrol:worn:prospectorRunner:crimsonReaverWarband:once": ["121696a8", "88141285", "lost:20", "e1360e3a", "c71e063e", "cargoBay=926 ftlDrive=606 reactorCore=586 specUtility=726 weapon=666 shieldEmitters=646 hullPlating=546"],
  "patrol:worn:prospectorRunner:crimsonReaverWarband:repeat": ["30947c7d", "88141285", "lost:20", "e1360e3a", "c71e063e", "cargoBay=926 ftlDrive=606 reactorCore=586 specUtility=726 weapon=666 shieldEmitters=646 hullPlating=546"],
  "patrol:worn:prospectorMiner:crimsonReaverSweep:once": ["de8ea837", "1b2af2bc", "lost:10", "4a78733f", "6b70e6d4", "cargoBay=913 ftlDrive=593 reactorCore=573 specUtility=713 weapon=653 shieldEmitters=633 hullPlating=533"],
  "patrol:worn:prospectorMiner:crimsonReaverSweep:repeat": ["e25a34e0", "1b2af2bc", "lost:10", "4a78733f", "6b70e6d4", "cargoBay=913 ftlDrive=593 reactorCore=573 specUtility=713 weapon=653 shieldEmitters=633 hullPlating=533"],
  "patrol:worn:prospectorMiner:crimsonReaverWarband:once": ["45245f69", "8774e398", "lost:20", "4a78733f", "5ae3cea3", "cargoBay=926 ftlDrive=606 reactorCore=586 specUtility=726 weapon=666 shieldEmitters=646 hullPlating=546"],
  "patrol:worn:prospectorMiner:crimsonReaverWarband:repeat": ["33ff849a", "8774e398", "lost:20", "4a78733f", "5ae3cea3", "cargoBay=926 ftlDrive=606 reactorCore=586 specUtility=726 weapon=666 shieldEmitters=646 hullPlating=546"],
  "patrol:worn:destroyer:crimsonReaverSweep:once": ["31e77619", "ba2ee129", "won:14", "6ad9f46c", "901cd640", "cargoBay=909 ftlDrive=589 reactorCore=569 specUtility=709 weapon=649 weapon=649 weapon=649 weapon=649 shieldEmitters=629 hullPlating=529"],
  "patrol:worn:destroyer:crimsonReaverSweep:repeat": ["88ed10aa", "ba2ee129", "relaunch:14", "60ebf60a", "cd28e7d8", "ad487619", "relaunch:28", "7e062882", "9aedc8b", "9d4ef55d", "won:42", "6ad9f46c", "2ff09ef1", "cargoBay=909 ftlDrive=589 reactorCore=569 specUtility=709 weapon=649 weapon=649 weapon=649 weapon=649 shieldEmitters=629 hullPlating=529"],
  "patrol:worn:destroyer:crimsonReaverWarband:once": ["d309e353", "5469ccef", "won:22", "6ad9f46c", "25b8d46b", "cargoBay=914 ftlDrive=594 reactorCore=574 specUtility=714 weapon=654 weapon=654 weapon=654 weapon=654 shieldEmitters=634 hullPlating=534"],
  "patrol:worn:destroyer:crimsonReaverWarband:repeat": ["f622e534", "5469ccef", "relaunch:22", "2ac69177", "ebef6932", "1db417c2", "lost:38", "44b4c6b5", "136ab280", "cargoBay=911 ftlDrive=591 reactorCore=571 specUtility=711 weapon=651 weapon=651 weapon=651 weapon=651 shieldEmitters=631 hullPlating=531"],
  "patrol:worn:battleship:crimsonReaverSweep:once": ["8117c7c7", "2436a90a", "won:14", "c6dba9cb", "4534d601", "cargoBay=909 ftlDrive=589 reactorCore=569 specUtility=709 weapon=649 weapon=649 weapon=649 weapon=649 weapon=649 weapon=649 shieldEmitters=629 hullPlating=529"],
  "patrol:worn:battleship:crimsonReaverSweep:repeat": ["20cde710", "2436a90a", "relaunch:14", "faca3df0", "4028ddbe", "d01f01ba", "relaunch:28", "c0349798", "b7cafc2b", "67dfacbc", "won:42", "c6dba9cb", "9325d38", "cargoBay=909 ftlDrive=589 reactorCore=569 specUtility=709 weapon=649 weapon=649 weapon=649 weapon=649 weapon=649 weapon=649 shieldEmitters=629 hullPlating=529"],
  "patrol:worn:battleship:crimsonReaverWarband:once": ["5ef43211", "a4925972", "won:22", "c6dba9cb", "5688686", "cargoBay=914 ftlDrive=594 reactorCore=574 specUtility=714 weapon=654 weapon=654 weapon=654 weapon=654 weapon=654 weapon=654 shieldEmitters=634 hullPlating=534"],
  "patrol:worn:battleship:crimsonReaverWarband:repeat": ["34602562", "a4925972", "relaunch:22", "2140ca1f", "e45fd510", "b226911f", "lost:40", "afe73d75", "5d7c1f39", "cargoBay=914 ftlDrive=594 reactorCore=574 specUtility=714 weapon=654 weapon=654 weapon=654 weapon=654 weapon=654 weapon=654 shieldEmitters=634 hullPlating=534"],
  "patrol:worn:carrier:crimsonReaverSweep:once": ["10bbdaa4", "8f2f9130", "won:14", "ea909677", "50289c38", "cargoBay=909 ftlDrive=589 reactorCore=569 specUtility=709 weapon=649 weapon=649 shieldEmitters=629 hullPlating=529 droneBay=609"],
  "patrol:worn:carrier:crimsonReaverSweep:repeat": ["850b5d91", "8f2f9130", "relaunch:14", "58546b3", "c6c25f92", "d1927268", "relaunch:28", "d272f5a0", "d7d386e7", "329402fb", "won:42", "ea909677", "3bd01e8e", "cargoBay=909 ftlDrive=589 reactorCore=569 specUtility=709 weapon=649 weapon=649 shieldEmitters=629 hullPlating=529 droneBay=609"],
  "patrol:worn:carrier:crimsonReaverWarband:once": ["cf2ed6fa", "c28deffe", "won:22", "ea909677", "9080ed53", "cargoBay=914 ftlDrive=594 reactorCore=574 specUtility=714 weapon=654 weapon=654 shieldEmitters=634 hullPlating=534 droneBay=614"],
  "patrol:worn:carrier:crimsonReaverWarband:repeat": ["a6257fcf", "c28deffe", "relaunch:22", "ef3396d8", "9145b617", "37de8ce3", "lost:38", "73109288", "2ec563a7", "cargoBay=911 ftlDrive=591 reactorCore=571 specUtility=711 weapon=651 weapon=651 shieldEmitters=631 hullPlating=531 droneBay=611"],
  "patrol:worn:orion:crimsonReaverSweep:once": ["40a9303c", "f6d6af33", "won:14", "c75858d4", "3eaf12f5", "cargoBay=909 ftlDrive=589 reactorCore=569 specUtility=709 weapon=649 shieldEmitters=629 hullPlating=529"],
  "patrol:worn:orion:crimsonReaverSweep:repeat": ["d818f5a9", "f6d6af33", "relaunch:14", "819d4289", "df046fc3", "47db3d51", "relaunch:28", "e7cf8ac1", "ec1608e8", "c01251cf", "won:42", "c75858d4", "19c5cfcb", "cargoBay=909 ftlDrive=589 reactorCore=569 specUtility=709 weapon=649 shieldEmitters=629 hullPlating=529"],
  "patrol:worn:orion:crimsonReaverWarband:once": ["65e0e99a", "acbf2a27", "lost:20", "6619cb48", "a5848d20", "cargoBay=926 ftlDrive=606 reactorCore=586 specUtility=726 weapon=666 shieldEmitters=646 hullPlating=546"],
  "patrol:worn:orion:crimsonReaverWarband:repeat": ["d6a857ef", "acbf2a27", "lost:20", "6619cb48", "a5848d20", "cargoBay=926 ftlDrive=606 reactorCore=586 specUtility=726 weapon=666 shieldEmitters=646 hullPlating=546"],
  "patrol:worn:aurora:crimsonReaverSweep:once": ["dbd9c477", "6eeaff13", "won:14", "62b89a6f", "5b30e448", "cargoBay=909 ftlDrive=589 reactorCore=569 specUtility=709 weapon=649 shieldEmitters=629 hullPlating=529"],
  "patrol:worn:aurora:crimsonReaverSweep:repeat": ["a9555020", "6eeaff13", "relaunch:14", "2640ec00", "29baaf8e", "aab1e155", "relaunch:28", "88c7eb68", "c1840d62", "7186ab1b", "won:42", "62b89a6f", "10caa438", "cargoBay=909 ftlDrive=589 reactorCore=569 specUtility=709 weapon=649 shieldEmitters=629 hullPlating=529"],
  "patrol:worn:aurora:crimsonReaverWarband:once": ["c5c49945", "a5c4a4bd", "lost:20", "def772e7", "f89e13d3", "cargoBay=926 ftlDrive=606 reactorCore=586 specUtility=726 weapon=666 shieldEmitters=646 hullPlating=546"],
  "patrol:worn:aurora:crimsonReaverWarband:repeat": ["faa3a9e", "a5c4a4bd", "lost:20", "def772e7", "f89e13d3", "cargoBay=926 ftlDrive=606 reactorCore=586 specUtility=726 weapon=666 shieldEmitters=646 hullPlating=546"],
  "patrol:worn:eir:crimsonReaverSweep:once": ["87e41c0f", "28bafcf2", "won:14", "ffdca63b", "d1c61f4a", "cargoBay=909 ftlDrive=589 reactorCore=569 specUtility=709 weapon=649 shieldEmitters=629 hullPlating=529"],
  "patrol:worn:eir:crimsonReaverSweep:repeat": ["59e3b7f8", "28bafcf2", "relaunch:14", "a8468558", "b801119d", "b5ce212b", "relaunch:28", "e57d6b00", "ca52d3ab", "eff64743", "won:42", "ffdca63b", "59b055e4", "cargoBay=909 ftlDrive=589 reactorCore=569 specUtility=709 weapon=649 shieldEmitters=629 hullPlating=529"],
  "patrol:worn:eir:crimsonReaverWarband:once": ["3cd5058d", "5f90e37a", "lost:20", "7ddb5b8d", "40b54ae5", "cargoBay=926 ftlDrive=606 reactorCore=586 specUtility=726 weapon=666 shieldEmitters=646 hullPlating=546"],
  "patrol:worn:eir:crimsonReaverWarband:repeat": ["51f75e26", "5f90e37a", "lost:20", "7ddb5b8d", "40b54ae5", "cargoBay=926 ftlDrive=606 reactorCore=586 specUtility=726 weapon=666 shieldEmitters=646 hullPlating=546"],
  "patrol:crafted:destroyer:crimsonReaverSweep:repeat": ["979a724f", "9b31d2ea", "relaunch:14", "48d5f4af", "264157f4", "49ef360b", "relaunch:28", "a0415677", "a541edf", "5b8261dd", "won:42", "6ad9f46c", "7c559dca", "cargoBay=1000 ftlDrive=1000 reactorCore=1000 specUtility=1000 weapon=1000 weapon=1000 weapon=1000 weapon=1000 shieldEmitters=1000 hullPlating=1000"],
  "patrol:crafted:destroyer:crimsonReaverWarband:repeat": ["52a98541", "64ce01be", "relaunch:22", "29b1220a", "65caf644", "2c92a386", "relaunch:44", "487971b2", "791d1e40", "c6f2fc89", "won:66", "6ad9f46c", "91d4b8f1", "cargoBay=1000 ftlDrive=1000 reactorCore=1000 specUtility=1000 weapon=1000 weapon=1000 weapon=1000 weapon=1000 shieldEmitters=1000 hullPlating=1000"],
  "patrol:crafted:battleship:crimsonReaverSweep:repeat": ["8b3635ae", "aed8379f", "relaunch:14", "f87deab8", "99cfb159", "937ea62d", "relaunch:28", "83fbf5a", "b8bf6198", "38bab391", "won:42", "c6dba9cb", "1b28aa59", "cargoBay=1000 ftlDrive=1000 reactorCore=1000 specUtility=1000 weapon=1000 weapon=1000 weapon=1000 weapon=1000 weapon=1000 weapon=1000 shieldEmitters=1000 hullPlating=1000"],
  "patrol:crafted:battleship:crimsonReaverWarband:repeat": ["5ee25e4c", "8f582d90", "relaunch:22", "c8aa0c1d", "9108059e", "56b825d0", "relaunch:44", "e91bd32f", "ff73714b", "614f2649", "won:66", "c6dba9cb", "e8885b5a", "cargoBay=1000 ftlDrive=1000 reactorCore=1000 specUtility=1000 weapon=1000 weapon=1000 weapon=1000 weapon=1000 weapon=1000 weapon=1000 shieldEmitters=1000 hullPlating=1000"],
  "patrol:crafted:carrier:crimsonReaverSweep:repeat": ["c00d6ca6", "52094610", "relaunch:14", "c1b8f9ce", "ff4e5a10", "86cb1193", "relaunch:28", "5e5d3f0d", "56e380a", "610252f4", "won:42", "ea909677", "77c9a23f", "cargoBay=1000 ftlDrive=1000 reactorCore=1000 specUtility=1000 weapon=1000 weapon=1000 shieldEmitters=1000 hullPlating=1000 droneBay=1000"],
  "patrol:crafted:carrier:crimsonReaverWarband:repeat": ["dd581a0", "52ece1ab", "relaunch:22", "68744da1", "f642be18", "66ac4e72", "relaunch:44", "9ebcc376", "93168da5", "bdbac4a", "won:66", "ea909677", "922b50ac", "cargoBay=1000 ftlDrive=1000 reactorCore=1000 specUtility=1000 weapon=1000 weapon=1000 shieldEmitters=1000 hullPlating=1000 droneBay=1000"],
  "patrol:dc:destroyer:crimsonReaverSweep:repeat": ["f7e82ce2", "7a88748f", "relaunch:14", "52dc9662", "af67fe07", "c362614a", "relaunch:28", "73045fda", "4848a375", "52ac6626", "won:42", "6ad9f46c", "728039be", "cargoBay=1000 ftlDrive=1000 reactorCore=1000 weapon=1000 weapon=1000 weapon=1000 weapon=1000 shieldEmitters=1000 hullPlating=1000 specUtility=1000"],
  "patrol:modules:battleship:crimsonReaverSweep:repeat": ["d9b70241", "8592bf41", "relaunch:14", "db1edd21", "b9c2af6e", "38ba8886", "relaunch:28", "87614429", "e3e2a9a3", "12dcc1d6", "won:42", "c6dba9cb", "aaba7a25", "cargoBay=1000 ftlDrive=1000 reactorCore=1000 specUtility=1000 weapon=1000 weapon=1000 weapon=1000 weapon=1000 weapon=1000 weapon=1000 shieldEmitters=1000 hullPlating=1000 module=659 module=659"],
  "patrol:dc:destroyer:crimsonReaverWarband:repeat": ["7c2b9ebc", "15ccdf90", "relaunch:22", "bd301d1f", "e78441ab", "fd0eab45", "lost:38", "44b4c6b5", "6c65d363", "cargoBay=1000 ftlDrive=1000 reactorCore=1000 weapon=1000 weapon=1000 weapon=1000 weapon=1000 shieldEmitters=1000 hullPlating=1000 specUtility=1000"],
  "patrol:modules:battleship:crimsonReaverWarband:repeat": ["ebf51bb3", "6a5def3d", "relaunch:22", "38901b3e", "66a36768", "667f2755", "lost:40", "6057cea6", "6c077135", "cargoBay=1000 ftlDrive=1000 reactorCore=1000 specUtility=1000 weapon=1000 weapon=1000 weapon=1000 weapon=1000 weapon=1000 weapon=1000 shieldEmitters=1000 hullPlating=1000 module=664 module=664"],
  "forecast:si:generalFreighter:crimsonReaverSweep": ["57:likely"],
  "forecast:si:generalFreighter:crimsonReaverWarband": ["0:impossible"],
  "forecast:si:destroyer:crimsonReaverSweep": ["64:guaranteed"],
  "forecast:si:destroyer:crimsonReaverWarband": ["9:extreme"],
  "forecast:si:battleship:crimsonReaverSweep": ["64:guaranteed"],
  "forecast:si:battleship:crimsonReaverWarband": ["52:likely"],
  "forecast:si:carrier:crimsonReaverSweep": ["64:guaranteed"],
  "forecast:si:carrier:crimsonReaverWarband": ["23:notAdvised"],
  "forecast:si:orion:crimsonReaverSweep": ["58:likely"],
  "forecast:si:orion:crimsonReaverWarband": ["0:impossible"],
  "forecast:worn:generalFreighter:crimsonReaverSweep": ["57:likely"],
  "forecast:worn:generalFreighter:crimsonReaverWarband": ["0:impossible"],
  "forecast:worn:destroyer:crimsonReaverSweep": ["64:guaranteed"],
  "forecast:worn:destroyer:crimsonReaverWarband": ["9:extreme"],
  "forecast:worn:battleship:crimsonReaverSweep": ["64:guaranteed"],
  "forecast:worn:battleship:crimsonReaverWarband": ["52:likely"],
  "forecast:worn:carrier:crimsonReaverSweep": ["64:guaranteed"],
  "forecast:worn:carrier:crimsonReaverWarband": ["23:notAdvised"],
  "forecast:worn:orion:crimsonReaverSweep": ["58:likely"],
  "forecast:worn:orion:crimsonReaverWarband": ["0:impossible"],
  "shipEvent:si:orion:cand-0:default": ["none", "628d0a82", "1/11 hull:0 setbacks:0", "fb092933"],
  "shipEvent:si:orion:cand-0:101": ["probe:win", "f6d6791c", "7/12 hull:0 setbacks:1", "b715c823"],
  "battle:si:orion:cand-0": ["probe:0:0:win:0:a894f168", "probe:0:1:win:0:f4bd0752", "probe:0:2:win:0:3f047c54", "probe:1:0:win:0:cc9053ba", "probe:1:1:win:0:b3d35774", "probe:1:2:win:0:8eb44f6", "cloakedPass:0:0:win:0:38c3f49", "cloakedPass:0:1:win:0:6bea0e7", "cloakedPass:0:2:win:0:eda81181", "cloakedPass:1:0:win:0:27ecdc73", "cloakedPass:1:1:win:0:31ef0e91", "cloakedPass:1:2:win:0:abfb56f3", "cloakedFail:0:0:win:0:38c3f49", "cloakedFail:0:1:win:0:6bea0e7", "cloakedFail:0:2:win:0:eda81181", "cloakedFail:1:0:win:0:27ecdc73", "cloakedFail:1:1:loss:41:28710703", "cloakedFail:1:2:win:0:abfb56f3"],
  "shipEvent:si:orion:cand-1:default": ["probe:win", "63ad049a", "7/10 hull:0 setbacks:2", "e034ba41"],
  "shipEvent:si:orion:cand-1:101": ["none", "2a9661e9", "4/14 hull:0 setbacks:1", "716325f1"],
  "battle:si:orion:cand-1": ["probe:0:0:win:0:a894f168", "probe:0:1:win:0:f4bd0752", "probe:0:2:win:0:3f047c54", "probe:1:0:win:0:cc9053ba", "probe:1:1:win:0:b3d35774", "probe:1:2:win:0:8eb44f6", "cloakedPass:0:0:win:0:38c3f49", "cloakedPass:0:1:win:0:6bea0e7", "cloakedPass:0:2:win:0:eda81181", "cloakedPass:1:0:win:0:27ecdc73", "cloakedPass:1:1:win:0:31ef0e91", "cloakedPass:1:2:win:0:abfb56f3", "cloakedFail:0:0:win:0:38c3f49", "cloakedFail:0:1:win:0:6bea0e7", "cloakedFail:0:2:loss:41:695e5fdb", "cloakedFail:1:0:win:0:27ecdc73", "cloakedFail:1:1:win:0:31ef0e91", "cloakedFail:1:2:win:0:abfb56f3"],
  "shipEvent:si:orion:cand-2:default": ["cloaked:loss", "577d816c", "4/6 hull:55 setbacks:2", "9343110b"],
  "shipEvent:si:orion:cand-2:101": ["probe:win", "c54ee85f", "7/15 hull:0 setbacks:1", "39215136"],
  "battle:si:orion:cand-2": ["probe:0:0:win:0:a894f168", "probe:0:1:win:0:f4bd0752", "probe:0:2:win:0:3f047c54", "probe:1:0:win:0:cc9053ba", "probe:1:1:win:0:b3d35774", "probe:1:2:win:0:8eb44f6", "cloakedPass:0:0:win:0:38c3f49", "cloakedPass:0:1:win:0:6bea0e7", "cloakedPass:0:2:loss:41:695e5fdb", "cloakedPass:1:0:win:0:27ecdc73", "cloakedPass:1:1:win:0:31ef0e91", "cloakedPass:1:2:win:0:abfb56f3", "cloakedFail:0:0:win:0:38c3f49", "cloakedFail:0:1:win:0:6bea0e7", "cloakedFail:0:2:win:0:eda81181", "cloakedFail:1:0:win:0:27ecdc73", "cloakedFail:1:1:win:0:31ef0e91", "cloakedFail:1:2:win:0:abfb56f3"],
  "shipEvent:si:aurora:cand-0:default": ["none", "628d0a82", "1/11 hull:0 setbacks:0", "526315a9"],
  "shipEvent:si:aurora:cand-0:101": ["probe:win", "f6d6791c", "7/12 hull:0 setbacks:1", "673d4fa9"],
  "battle:si:aurora:cand-0": ["probe:0:0:win:0:a894f168", "probe:0:1:win:0:f4bd0752", "probe:0:2:win:0:3f047c54", "probe:1:0:win:0:cc9053ba", "probe:1:1:win:0:b3d35774", "probe:1:2:win:0:8eb44f6", "cloakedPass:0:0:win:0:38c3f49", "cloakedPass:0:1:win:0:6bea0e7", "cloakedPass:0:2:win:0:eda81181", "cloakedPass:1:0:win:0:27ecdc73", "cloakedPass:1:1:win:0:31ef0e91", "cloakedPass:1:2:win:0:abfb56f3", "cloakedFail:0:0:win:0:38c3f49", "cloakedFail:0:1:win:0:6bea0e7", "cloakedFail:0:2:loss:36:7321f355", "cloakedFail:1:0:win:0:27ecdc73", "cloakedFail:1:1:loss:36:3233077d", "cloakedFail:1:2:win:0:abfb56f3"],
  "shipEvent:si:aurora:cand-1:default": ["probe:win", "63ad049a", "7/10 hull:0 setbacks:2", "f1aa3343"],
  "shipEvent:si:aurora:cand-1:101": ["none", "2a9661e9", "4/14 hull:0 setbacks:1", "13fbbec1"],
  "battle:si:aurora:cand-1": ["probe:0:0:win:0:a894f168", "probe:0:1:win:0:f4bd0752", "probe:0:2:win:0:3f047c54", "probe:1:0:win:0:cc9053ba", "probe:1:1:win:0:b3d35774", "probe:1:2:win:0:8eb44f6", "cloakedPass:0:0:win:0:38c3f49", "cloakedPass:0:1:win:0:6bea0e7", "cloakedPass:0:2:win:0:eda81181", "cloakedPass:1:0:win:0:27ecdc73", "cloakedPass:1:1:win:0:31ef0e91", "cloakedPass:1:2:win:0:abfb56f3", "cloakedFail:0:0:win:0:38c3f49", "cloakedFail:0:1:win:0:6bea0e7", "cloakedFail:0:2:loss:36:7321f355", "cloakedFail:1:0:win:0:27ecdc73", "cloakedFail:1:1:win:0:31ef0e91", "cloakedFail:1:2:win:0:abfb56f3"],
  "shipEvent:si:aurora:cand-2:default": ["cloaked:loss", "31a281f0", "4/6 hull:48 setbacks:2", "c9eeca87"],
  "shipEvent:si:aurora:cand-2:101": ["probe:win", "c54ee85f", "7/15 hull:0 setbacks:1", "efe885e4"],
  "battle:si:aurora:cand-2": ["probe:0:0:win:0:a894f168", "probe:0:1:win:0:f4bd0752", "probe:0:2:win:0:3f047c54", "probe:1:0:win:0:cc9053ba", "probe:1:1:win:0:b3d35774", "probe:1:2:win:0:8eb44f6", "cloakedPass:0:0:win:0:38c3f49", "cloakedPass:0:1:win:0:6bea0e7", "cloakedPass:0:2:loss:36:7321f355", "cloakedPass:1:0:win:0:27ecdc73", "cloakedPass:1:1:win:0:31ef0e91", "cloakedPass:1:2:win:0:abfb56f3", "cloakedFail:0:0:win:0:38c3f49", "cloakedFail:0:1:win:0:6bea0e7", "cloakedFail:0:2:win:0:eda81181", "cloakedFail:1:0:win:0:27ecdc73", "cloakedFail:1:1:win:0:31ef0e91", "cloakedFail:1:2:win:0:abfb56f3"],
  "shipEvent:si:eir:cand-0:default": ["none", "628d0a82", "1/11 hull:0 setbacks:0", "8ff25b7a"],
  "shipEvent:si:eir:cand-0:101": ["probe:win", "f6d6791c", "7/12 hull:0 setbacks:1", "f79fcb4f"],
  "battle:si:eir:cand-0": ["probe:0:0:win:0:a894f168", "probe:0:1:win:0:f4bd0752", "probe:0:2:win:0:3f047c54", "probe:1:0:win:0:cc9053ba", "probe:1:1:win:0:b3d35774", "probe:1:2:win:0:8eb44f6", "cloakedPass:0:0:win:0:38c3f49", "cloakedPass:0:1:win:0:6bea0e7", "cloakedPass:0:2:win:0:eda81181", "cloakedPass:1:0:win:0:27ecdc73", "cloakedPass:1:1:win:0:31ef0e91", "cloakedPass:1:2:win:0:abfb56f3", "cloakedFail:0:0:win:0:38c3f49", "cloakedFail:0:1:win:0:6bea0e7", "cloakedFail:0:2:loss:43:6d647655", "cloakedFail:1:0:loss:43:ca30cdd2", "cloakedFail:1:1:loss:43:2c758a7d", "cloakedFail:1:2:win:0:abfb56f3"],
  "shipEvent:si:eir:cand-1:default": ["probe:win", "63ad049a", "7/10 hull:0 setbacks:2", "55f34f3b"],
  "shipEvent:si:eir:cand-1:101": ["none", "2a9661e9", "4/14 hull:0 setbacks:1", "f4132a62"],
  "battle:si:eir:cand-1": ["probe:0:0:win:0:a894f168", "probe:0:1:win:0:f4bd0752", "probe:0:2:win:0:3f047c54", "probe:1:0:win:0:cc9053ba", "probe:1:1:win:0:b3d35774", "probe:1:2:win:0:8eb44f6", "cloakedPass:0:0:win:0:38c3f49", "cloakedPass:0:1:win:0:6bea0e7", "cloakedPass:0:2:win:0:eda81181", "cloakedPass:1:0:win:0:27ecdc73", "cloakedPass:1:1:win:0:31ef0e91", "cloakedPass:1:2:win:0:abfb56f3", "cloakedFail:0:0:win:0:38c3f49", "cloakedFail:0:1:win:0:6bea0e7", "cloakedFail:0:2:loss:43:6d647655", "cloakedFail:1:0:win:0:27ecdc73", "cloakedFail:1:1:win:0:31ef0e91", "cloakedFail:1:2:win:0:abfb56f3"],
  "shipEvent:si:eir:cand-2:default": ["cloaked:loss", "83f410ba", "4/6 hull:57 setbacks:2", "15cd44ba"],
  "shipEvent:si:eir:cand-2:101": ["probe:win", "c54ee85f", "7/15 hull:0 setbacks:1", "3835f948"],
  "battle:si:eir:cand-2": ["probe:0:0:win:0:a894f168", "probe:0:1:win:0:f4bd0752", "probe:0:2:win:0:3f047c54", "probe:1:0:win:0:cc9053ba", "probe:1:1:win:0:b3d35774", "probe:1:2:win:0:8eb44f6", "cloakedPass:0:0:win:0:38c3f49", "cloakedPass:0:1:win:0:6bea0e7", "cloakedPass:0:2:loss:43:6d647655", "cloakedPass:1:0:win:0:27ecdc73", "cloakedPass:1:1:win:0:31ef0e91", "cloakedPass:1:2:win:0:abfb56f3", "cloakedFail:0:0:win:0:38c3f49", "cloakedFail:0:1:loss:43:f6c34a98", "cloakedFail:0:2:win:0:eda81181", "cloakedFail:1:0:win:0:27ecdc73", "cloakedFail:1:1:win:0:31ef0e91", "cloakedFail:1:2:win:0:abfb56f3"],
  "shipEvent:worn:orion:cand-0:default": ["none", "628d0a82", "1/11 hull:0 setbacks:0", "d0bd949d"],
  "shipEvent:worn:orion:cand-0:101": ["probe:win", "f6d6791c", "7/12 hull:0 setbacks:1", "b6be8021"],
  "battle:worn:orion:cand-0": ["probe:0:0:win:0:a894f168", "probe:0:1:win:0:f4bd0752", "probe:0:2:win:0:3f047c54", "probe:1:0:win:0:cc9053ba", "probe:1:1:win:0:b3d35774", "probe:1:2:win:0:8eb44f6", "cloakedPass:0:0:win:0:38c3f49", "cloakedPass:0:1:loss:41:fabed3b6", "cloakedPass:0:2:win:0:eda81181", "cloakedPass:1:0:loss:41:c636d7b4", "cloakedPass:1:1:win:0:31ef0e91", "cloakedPass:1:2:loss:41:4dfd9dfe", "cloakedFail:0:0:win:0:38c3f49", "cloakedFail:0:1:loss:41:fabed3b6", "cloakedFail:0:2:loss:41:695e5fdb", "cloakedFail:1:0:loss:41:c636d7b4", "cloakedFail:1:1:loss:41:28710703", "cloakedFail:1:2:loss:41:4dfd9dfe"],
  "shipEvent:worn:orion:cand-1:default": ["probe:win", "63ad049a", "7/10 hull:0 setbacks:2", "e7e6dcef"],
  "shipEvent:worn:orion:cand-1:101": ["none", "2a9661e9", "4/14 hull:0 setbacks:1", "6cb6fc23"],
  "battle:worn:orion:cand-1": ["probe:0:0:win:0:a894f168", "probe:0:1:win:0:f4bd0752", "probe:0:2:win:0:3f047c54", "probe:1:0:win:0:cc9053ba", "probe:1:1:win:0:b3d35774", "probe:1:2:win:0:8eb44f6", "cloakedPass:0:0:win:0:38c3f49", "cloakedPass:0:1:win:0:6bea0e7", "cloakedPass:0:2:win:0:eda81181", "cloakedPass:1:0:loss:41:c636d7b4", "cloakedPass:1:1:win:0:31ef0e91", "cloakedPass:1:2:win:0:abfb56f3", "cloakedFail:0:0:loss:41:e154b8d", "cloakedFail:0:1:loss:41:fabed3b6", "cloakedFail:0:2:loss:41:695e5fdb", "cloakedFail:1:0:loss:41:c636d7b4", "cloakedFail:1:1:win:0:31ef0e91", "cloakedFail:1:2:win:0:abfb56f3"],
  "shipEvent:worn:orion:cand-2:default": ["cloaked:loss", "577d816c", "4/6 hull:55 setbacks:2", "48081845"],
  "shipEvent:worn:orion:cand-2:101": ["probe:win", "c54ee85f", "7/15 hull:0 setbacks:1", "3c854f50"],
  "battle:worn:orion:cand-2": ["probe:0:0:win:0:a894f168", "probe:0:1:win:0:f4bd0752", "probe:0:2:win:0:3f047c54", "probe:1:0:win:0:cc9053ba", "probe:1:1:win:0:b3d35774", "probe:1:2:win:0:8eb44f6", "cloakedPass:0:0:win:0:38c3f49", "cloakedPass:0:1:win:0:6bea0e7", "cloakedPass:0:2:loss:41:695e5fdb", "cloakedPass:1:0:win:0:27ecdc73", "cloakedPass:1:1:win:0:31ef0e91", "cloakedPass:1:2:win:0:abfb56f3", "cloakedFail:0:0:loss:41:e154b8d", "cloakedFail:0:1:loss:41:fabed3b6", "cloakedFail:0:2:win:0:eda81181", "cloakedFail:1:0:win:0:27ecdc73", "cloakedFail:1:1:win:0:31ef0e91", "cloakedFail:1:2:win:0:abfb56f3"],
  "shipEvent:worn:aurora:cand-0:default": ["none", "628d0a82", "1/11 hull:0 setbacks:0", "359f8da1"],
  "shipEvent:worn:aurora:cand-0:101": ["probe:win", "f6d6791c", "7/12 hull:0 setbacks:1", "c8b35ed1"],
  "battle:worn:aurora:cand-0": ["probe:0:0:win:0:a894f168", "probe:0:1:win:0:f4bd0752", "probe:0:2:win:0:3f047c54", "probe:1:0:win:0:cc9053ba", "probe:1:1:win:0:b3d35774", "probe:1:2:win:0:8eb44f6", "cloakedPass:0:0:loss:36:c355192f", "cloakedPass:0:1:loss:36:8a344f88", "cloakedPass:0:2:win:0:eda81181", "cloakedPass:1:0:loss:36:aa5595ce", "cloakedPass:1:1:win:0:31ef0e91", "cloakedPass:1:2:loss:36:dd7319d0", "cloakedFail:0:0:loss:36:c355192f", "cloakedFail:0:1:loss:36:8a344f88", "cloakedFail:0:2:loss:36:7321f355", "cloakedFail:1:0:loss:36:aa5595ce", "cloakedFail:1:1:loss:36:3233077d", "cloakedFail:1:2:loss:36:dd7319d0"],
  "shipEvent:worn:aurora:cand-1:default": ["probe:win", "63ad049a", "7/10 hull:0 setbacks:2", "416f1895"],
  "shipEvent:worn:aurora:cand-1:101": ["none", "2a9661e9", "4/14 hull:0 setbacks:1", "ffec647f"],
  "battle:worn:aurora:cand-1": ["probe:0:0:win:0:a894f168", "probe:0:1:win:0:f4bd0752", "probe:0:2:win:0:3f047c54", "probe:1:0:win:0:cc9053ba", "probe:1:1:win:0:b3d35774", "probe:1:2:win:0:8eb44f6", "cloakedPass:0:0:loss:36:c355192f", "cloakedPass:0:1:win:0:6bea0e7", "cloakedPass:0:2:win:0:eda81181", "cloakedPass:1:0:loss:36:aa5595ce", "cloakedPass:1:1:win:0:31ef0e91", "cloakedPass:1:2:win:0:abfb56f3", "cloakedFail:0:0:loss:36:c355192f", "cloakedFail:0:1:loss:36:8a344f88", "cloakedFail:0:2:loss:36:7321f355", "cloakedFail:1:0:loss:36:aa5595ce", "cloakedFail:1:1:win:0:31ef0e91", "cloakedFail:1:2:loss:36:dd7319d0"],
  "shipEvent:worn:aurora:cand-2:default": ["cloaked:loss", "31a281f0", "4/6 hull:48 setbacks:2", "b2ac6e65"],
  "shipEvent:worn:aurora:cand-2:101": ["probe:win", "c54ee85f", "7/15 hull:0 setbacks:1", "43c606a8"],
  "battle:worn:aurora:cand-2": ["probe:0:0:win:0:a894f168", "probe:0:1:win:0:f4bd0752", "probe:0:2:win:0:3f047c54", "probe:1:0:win:0:cc9053ba", "probe:1:1:win:0:b3d35774", "probe:1:2:win:0:8eb44f6", "cloakedPass:0:0:loss:36:c355192f", "cloakedPass:0:1:loss:36:8a344f88", "cloakedPass:0:2:loss:36:7321f355", "cloakedPass:1:0:win:0:27ecdc73", "cloakedPass:1:1:win:0:31ef0e91", "cloakedPass:1:2:win:0:abfb56f3", "cloakedFail:0:0:loss:36:c355192f", "cloakedFail:0:1:loss:36:8a344f88", "cloakedFail:0:2:win:0:eda81181", "cloakedFail:1:0:win:0:27ecdc73", "cloakedFail:1:1:win:0:31ef0e91", "cloakedFail:1:2:win:0:abfb56f3"],
  "shipEvent:worn:eir:cand-0:default": ["none", "628d0a82", "1/11 hull:0 setbacks:0", "256652b2"],
  "shipEvent:worn:eir:cand-0:101": ["probe:win", "f6d6791c", "7/12 hull:0 setbacks:1", "e26b15a3"],
  "battle:worn:eir:cand-0": ["probe:0:0:win:0:a894f168", "probe:0:1:win:0:f4bd0752", "probe:0:2:win:0:3f047c54", "probe:1:0:win:0:cc9053ba", "probe:1:1:win:0:b3d35774", "probe:1:2:win:0:8eb44f6", "cloakedPass:0:0:loss:43:a0f3513", "cloakedPass:0:1:loss:43:f6c34a98", "cloakedPass:0:2:win:0:eda81181", "cloakedPass:1:0:loss:43:ca30cdd2", "cloakedPass:1:1:win:0:31ef0e91", "cloakedPass:1:2:loss:43:4a0214e0", "cloakedFail:0:0:loss:43:a0f3513", "cloakedFail:0:1:loss:43:f6c34a98", "cloakedFail:0:2:loss:43:6d647655", "cloakedFail:1:0:loss:43:ca30cdd2", "cloakedFail:1:1:loss:43:2c758a7d", "cloakedFail:1:2:loss:43:4a0214e0"],
  "shipEvent:worn:eir:cand-1:default": ["probe:win", "63ad049a", "7/10 hull:0 setbacks:2", "503d3a85"],
  "shipEvent:worn:eir:cand-1:101": ["none", "2a9661e9", "4/14 hull:0 setbacks:1", "2353318a"],
  "battle:worn:eir:cand-1": ["probe:0:0:win:0:a894f168", "probe:0:1:win:0:f4bd0752", "probe:0:2:win:0:3f047c54", "probe:1:0:win:0:cc9053ba", "probe:1:1:win:0:b3d35774", "probe:1:2:win:0:8eb44f6", "cloakedPass:0:0:loss:43:a0f3513", "cloakedPass:0:1:loss:43:f6c34a98", "cloakedPass:0:2:win:0:eda81181", "cloakedPass:1:0:loss:43:ca30cdd2", "cloakedPass:1:1:win:0:31ef0e91", "cloakedPass:1:2:loss:43:4a0214e0", "cloakedFail:0:0:loss:43:a0f3513", "cloakedFail:0:1:loss:43:f6c34a98", "cloakedFail:0:2:loss:43:6d647655", "cloakedFail:1:0:loss:43:ca30cdd2", "cloakedFail:1:1:loss:43:2c758a7d", "cloakedFail:1:2:loss:43:4a0214e0"],
  "shipEvent:worn:eir:cand-2:default": ["cloaked:loss", "83f410ba", "4/6 hull:57 setbacks:2", "168d9c50"],
  "shipEvent:worn:eir:cand-2:101": ["probe:win", "c54ee85f", "7/15 hull:0 setbacks:1", "7b101c86"],
  "battle:worn:eir:cand-2": ["probe:0:0:win:0:a894f168", "probe:0:1:win:0:f4bd0752", "probe:0:2:win:0:3f047c54", "probe:1:0:win:0:cc9053ba", "probe:1:1:win:0:b3d35774", "probe:1:2:win:0:8eb44f6", "cloakedPass:0:0:loss:43:a0f3513", "cloakedPass:0:1:loss:43:f6c34a98", "cloakedPass:0:2:loss:43:6d647655", "cloakedPass:1:0:loss:43:ca30cdd2", "cloakedPass:1:1:win:0:31ef0e91", "cloakedPass:1:2:win:0:abfb56f3", "cloakedFail:0:0:loss:43:a0f3513", "cloakedFail:0:1:loss:43:f6c34a98", "cloakedFail:0:2:loss:43:6d647655", "cloakedFail:1:0:win:0:27ecdc73", "cloakedFail:1:1:loss:43:2c758a7d", "cloakedFail:1:2:win:0:abfb56f3"],
  "ground:si": ["ghost:pass:0,storm:pass:0,ghost:pass:0", "f5c83649", "4852bda", "cddaaf46", "cargoBay=1000 ftlDrive=970 reactorCore=991 specUtility=1000 weapon=1000 shieldEmitters=1000 hullPlating=1000 memberWeapon=982 memberArmor=1000 memberTool=1000 implant=1000 memberWeapon=982 memberArmor=1000 memberTool=1000 implant=1000 memberWeapon=1000 memberArmor=1000 memberTool=940 implant=1000"],
  "ground:worn": ["ghost:pass:0,storm:pass:0,ghost:pass:0", "e18d3cc6", "ccd1fc7", "7391e766", "cargoBay=1000 ftlDrive=970 reactorCore=991 specUtility=1000 weapon=1000 shieldEmitters=1000 hullPlating=1000 memberWeapon=982 memberArmor=1000 memberTool=1000 implant=1000 memberWeapon=982 memberArmor=1000 memberTool=1000 implant=1000 memberWeapon=1000 memberArmor=1000 memberTool=940 implant=1000"],
  "repair:dc": ["111", "b126e5d5", "c621a214", "cargoBay=1000 ftlDrive=1000 reactorCore=1000 weapon=1000 weapon=1000 weapon=1000 weapon=1000 shieldEmitters=1000 hullPlating=1000 specUtility=1000"],
};

const CAPTURE = Boolean(import.meta.env.GW4_CAPTURE);
const captured: Record<string, string[]> = {};
function pin(key: string, value: string[]): void {
  if (CAPTURE) {
    captured[key] = value;
    return;
  }
  expect(value, key).toEqual(GOLDEN_PRE[key]);
}

describe("gear wear step 4 goldens (captured before the step 4 engine)", () => {
  it("the worn variant really is worn and the crafted one crafted (vacuity guard)", () => {
    const w = equippedFor(patrolBase("carrier", "worn"), "ship-1");
    for (const slot of ["weapon", "reactorCore", "ftlDrive", "shieldEmitters", "hullPlating", "droneBay"]) {
      expect(w.some((p) => p.slotType === slot && pieceCondition(p) === WORN[slot]), slot).toBe(true);
    }
    for (const p of equippedFor(patrolBase("destroyer", "crafted"), "ship-1")) expect(p.quality, p.slotType).toBe(CRAFTED_QUALITY);
    expect(equippedFor(patrolBase("destroyer", "dc"), "ship-1").some((p) => p.moduleVariant === DAMAGE_CONTROL_SUITE_KEY)).toBe(true);
    expect(equippedFor(patrolBase("battleship", "modules"), "ship-1").filter((p) => p.slotType === "module").length).toBe(2);
  });

  for (const variant of ["si", "worn"] as const) {
    for (const hull of HULLS) {
      for (const key of ROUTES) {
        for (const repeat of [false, true]) {
          const id = `patrol:${variant}:${hull}:${key}:${repeat ? "repeat" : "once"}`;
          it(id, () => pin(id, patrolRun(patrolBase(hull, variant), key, repeat, id)));
        }
      }
    }
  }
  for (const hull of COMBAT_HULLS) {
    for (const key of ROUTES) {
      const id = `patrol:crafted:${hull}:${key}:repeat`;
      it(id, () => pin(id, patrolRun(patrolBase(hull, "crafted"), key, true, id)));
    }
  }
  for (const key of ROUTES) {
    const dc = `patrol:dc:destroyer:${key}:repeat`;
    it(dc, () => pin(dc, patrolRun(patrolBase("destroyer", "dc"), key, true, dc)));
    const mod = `patrol:modules:battleship:${key}:repeat`;
    it(mod, () => pin(mod, patrolRun(patrolBase("battleship", "modules"), key, true, mod)));
  }

  for (const variant of ["si", "worn"] as const) {
    for (const hull of FORECAST_HULLS) {
      for (const key of ROUTES) {
        const id = `forecast:${variant}:${hull}:${key}`;
        it(id, () => pin(id, [forecast(patrolBase(hull, variant), key)]));
      }
    }
  }

  for (const variant of ["si", "worn"] as const) {
    for (const hull of EXPLORERS) {
      for (const cand of CANDS) {
        for (const seed of EXPEDITION_SEEDS) {
          const id = `shipEvent:${variant}:${hull}:${cand}:${seed ?? "default"}`;
          it(id, () => pin(id, shipEventRow(hull, cand, seed, variant)));
        }
        const b = `battle:${variant}:${hull}:${cand}`;
        it(b, () => pin(b, battleRow(hull, cand, variant)));
      }
    }
  }

  for (const variant of ["si", "worn"] as const) {
    it(`ground:${variant}: a crafted Orion's ordinary Ground Ops run in crafted member gear, home and claimed`, () => pin(`ground:${variant}`, groundRun(variant)));
  }
  it("repair:dc: a damaged destroyer with a Damage Control Suite, its Shipyard repair to completion", () => pin("repair:dc", dcRepair()));
});

describe.runIf(CAPTURE)("gear wear step 4 capture (GW4_CAPTURE = an output path): write the goldens there", () => {
  it("writes", () => {
    writeFileSync(String(import.meta.env.GW4_CAPTURE), JSON.stringify(captured, null, 2));
  });
});
