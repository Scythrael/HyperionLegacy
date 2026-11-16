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

// The ordering determinism slice (canonicalOrder.ts: `discovered` and the lifetime tally maps kept in canonical order)
// came after every pin here: the file runs with it off (orderingSwitch.fixture.ts), so its pins keep proving their own
// slice (orderingGoldens.test.ts pins the order move and proves it moved order only).
import { canonicalOrderOffForThisFile } from "./orderingSwitch.fixture";
canonicalOrderOffForThisFile();
// Ordering determinism part 2 (canonicalOrder.ts: inventory keys and a call's completion log in one order) came after every pin here, traced order-only: the file runs with it off (ordering2Switch.fixture.ts).
import { ordering2OffForThisFile } from "./ordering2Switch.fixture";
ordering2OffForThisFile();
// OC-F14 (the field repair rules stamped at dispatch on a system mixing repair worlds with other bodies) came after every pin
// here, traced: the file runs with it off (fieldRepairRulesSwitch.fixture.ts), so its pins keep proving their own slice
// (fieldRepairOrderGoldens.test.ts pins OC-F14's moves and proves them with the switch off).
import { repairRulesOffForThisFile } from "./fieldRepairRulesSwitch.fixture";
repairRulesOffForThisFile();
import { describe, expect, it } from "vitest";
// Relics v2 source planets (user 2026-11-13 "First + count") came after these pins: each blank now also carries its
// planet's name (display only). The file runs with the stamp off, so every pin reproduces as captured (relicPlanet.fixture.ts).
import { planetStampOffForThisFile } from "./relicPlanet.fixture";
planetStampOffForThisFile();
// Gear wear close-out (2026-11-11: "Make it exact", "Keep the bay rate") came after every pin here: the file runs with it
// off (gearWearCloseoutSwitch.fixture.ts), so its pins keep proving their own slice (gearWearCloseoutGoldens.test.ts and
// gearWearCloseout.test.ts pin and prove what the close-out moved: leftover underway seconds at a run's end, a repair
// pause's or a field repair leg's edges credited at the rate that applied; gear keeping the bay rate until full).
import { gearWearCloseoutOffForThisFile, withCloseoutOn } from "./gearWearCloseoutSwitch.fixture";
gearWearCloseoutOffForThisFile();
// WR-8b (enemy torpedoes) came after every pin here: the file runs with it off (enemyTorpedoSwitch.fixture.ts), so its
// pins keep proving their own slice (enemyTorpedoGoldens.test.ts pins what WR-8b moved, enemyTorpedoes.test.ts proves it).
import { enemyTorpedoesOffForThisFile } from "./enemyTorpedoSwitch.fixture";
enemyTorpedoesOffForThisFile();
// Wiring WR-10 (the away rules stamped at dispatch, a hire's account program) came after every pin here: the whole file
// runs with WR-10 off (wr10Switch.fixture.ts), so its pins keep proving their own slice (wr10Goldens.test.ts pins WR-10's).
import { wr10OffForThisFile } from "./wr10Switch.fixture";
wr10OffForThisFile();
import { cp16OffForThisFile } from "./cp16Switch.fixture";
// Complement CP-16 (the Hall of Command) came after every pin here: the file runs with the slice off, so its pins
// keep proving their own slice (cp16Goldens.test.ts pins what CP-16 moved: the missions counter, the notables and
// the Hall of Command entry).
cp16OffForThisFile();
import { cp14OffForThisFile } from "./cp14Switch.fixture";
// Complement CP-14 (hull base sensors and Science amplification) came after every pin here: the file runs with the
// slice off, so its pins keep proving their own slice (cp14Goldens.test.ts pins what CP-14 moved).
cp14OffForThisFile();
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
import { patrolDispatchCycle } from "./tick";
import { withBattleWearOff } from "./battleWearSwitch.fixture";
import { withFavoredSpecOff } from "./favoredSpecSwitch.fixture";
import { patrolLegsOffForThisFile } from "./patrolLegsSwitch.fixture";
import { wr11OffForThisFile } from "./wr11Switch.fixture";
import { fixRoundEOffForThisFile } from "./fixRoundESwitch.fixture";

// Fix round FR-E (0.14.0): this file's fixtures launch real stars, recall and resume, or fly Repeat patrols that pause,
// climb or meet a route they would lose, and its pins are about another slice; it runs with the round's fixes off
// (fixRoundESwitch.fixture.ts), so they keep proving that slice. The round's own pins: expeditionFixRoundEGoldens and
// patrolFixRoundE tests.
fixRoundEOffForThisFile();

// WR-7 follow-up OC-D8 (patrol legs scale with transit speed): every pin here predates the legs and is about gear wear step 4;
// with the legs off each one returns (checked when the legs were wired), so the file runs with them off and keeps
// proving its own slice. patrolLegsGoldens.test.ts pins the legs on every patrol and every combat hull.
patrolLegsOffForThisFile();
// Wiring WR-11 came after every pin here: the whole file runs with WR-11 off (wr11Switch.fixture.ts), so its pins keep
// proving their own slice moved nothing else (WR-11's own moves are pinned in wr11Goldens.test.ts).
wr11OffForThisFile();

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
// `inFlight` (step 4): dispatched inside the step 4 switch (a cycle from before step 4), then advanced by the live engine.
function patrolRun(state: GameState, key: PatrolKey, repeat: boolean, label: string, inFlight = false): string[] {
  const go = () => dispatchCaptainOnPatrol(state, 1, key, "balanced", repeat);
  const r = inFlight ? withBattleWearOff(go) : go();
  expect(r.success, `${label}: ${r.reason}`).toBe(true);
  let replay = replayPatrol(r.next, r.next.captains[0]);
  const row = [hash(structuredClone(r.next.captains[0].mission)), hash(replay)];
  let s = r.next;
  let ticks = 0;
  let cycles = 1;
  let seed = patrolOf(s)!.masterSeed;
  let lostCycle = false;
  // Repair first, then go (review 2026-10-27): a Repeat dispatch whose first cycle would break never flies its dispatched cycle (it
  // repairs, then relaunches), so that cycle's replay has no live outcome to match.
  let unflown = patrolOf(r.next)?.repairPause?.first === true;
  while (patrolOf(s) !== null) {
    s = economyTick(s, 1, RNG);
    ticks += 1;
    const m = patrolOf(s);
    if (m !== null && m.phase === "limpingHome") lostCycle = true;
    if (m !== null && m.masterSeed !== seed) {
      if (!unflown) expect(replay.defeated, `${label}: the replay of cycle ${cycles} reaches the live outcome`).toBe(false);
      unflown = false;
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
  // Step 4: the cycle a dispatch would start fights its frozen gear (App.svelte reads patrolDispatchCycle the same
  // way); the stored gear while battle wear is off, exactly the pre-step-4 forecast.
  const installedGear = patrolDispatchCycle(state, equippedFor(state, ship.id), patrolDifficultyAt(state)).gear;
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

function shipEventRow(hull: ShipTypeKey, cand: string, seed: number | undefined, variant: "si" | "worn", inFlight = false): string[] {
  const go = () => dispatchPastPropulsion(shipEventBase(hull, seed, variant), "ship-1", 1, cand);
  const res = inFlight ? withBattleWearOff(go) : go();
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

function battleRow(hull: ShipTypeKey, cand: string, variant: "si" | "worn", inFlight = false): string[] {
  const go = () => dispatchPastPropulsion(shipEventBase(hull, undefined, variant), "ship-1", 1, cand);
  const res = inFlight ? withBattleWearOff(go) : go();
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

function groundRun(variant: "si" | "worn", inFlight = false): string[] {
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
  const go = () => startExpedition(s0, "ship-1", 1, expeditionCandidates(s0, "ship-1")[0].id);
  const res = inFlight ? withBattleWearOff(go) : go();
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
// Re-pinned at the merge of feat 09fed2c (2026-10-28, the relic tier stagger, Relics v2): its expedition run state moves
// the 38 shipEvent, battle and ground rows' run and state HASHES only (every outcome, tally and condition holds), here
// and in GOLDEN alike; the in-flight suite still reproduces every row byte for byte.
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
  "patrol:crafted:destroyer:crimsonReaverSweep:repeat": ["eb8d3373", "6d0ea35e", "relaunch:14", "c59b065b", "ee747998", "4c70d74b", "relaunch:28", "75f3b863", "a2926d23", "92859d5d", "won:42", "6ad9f46c", "b421ea16", "cargoBay=1000 ftlDrive=1000 reactorCore=1000 specUtility=1000 weapon=1000 weapon=1000 weapon=1000 weapon=1000 shieldEmitters=1000 hullPlating=1000"],
  "patrol:crafted:destroyer:crimsonReaverWarband:repeat": ["826913cd", "9d385139", "relaunch:22", "f9b20fe2", "85239e18", "312e5f6e", "lost:38", "ae7807f5", "67940be1", "cargoBay=1000 ftlDrive=1000 reactorCore=1000 specUtility=1000 weapon=1000 weapon=1000 weapon=1000 weapon=1000 shieldEmitters=1000 hullPlating=1000"],
  "patrol:crafted:battleship:crimsonReaverSweep:repeat": ["3fe23271", "f1fd8c73", "relaunch:14", "cf01cd19", "b872c864", "3041fa96", "relaunch:28", "1c4f3fa1", "b9f7b6f4", "bd8cd882", "won:42", "c6dba9cb", "89ad844d", "cargoBay=1000 ftlDrive=1000 reactorCore=1000 specUtility=1000 weapon=1000 weapon=1000 weapon=1000 weapon=1000 weapon=1000 weapon=1000 shieldEmitters=1000 hullPlating=1000"],
  "patrol:crafted:battleship:crimsonReaverWarband:repeat": ["f9660327", "20e5809f", "relaunch:22", "982f7278", "ff6e942c", "4098ac03", "relaunch:44", "520d96a0", "f8eb9d27", "ad9931de", "won:66", "c6dba9cb", "2c7f0482", "cargoBay=1000 ftlDrive=1000 reactorCore=1000 specUtility=1000 weapon=1000 weapon=1000 weapon=1000 weapon=1000 weapon=1000 weapon=1000 shieldEmitters=1000 hullPlating=1000"],
  "patrol:crafted:carrier:crimsonReaverSweep:repeat": ["8deade5a", "831980ba", "relaunch:14", "f7fc71f2", "5eea5078", "43776534", "relaunch:28", "4c358fa9", "783f4e9d", "9a11bd59", "won:42", "ea909677", "3f2b983e", "cargoBay=1000 ftlDrive=1000 reactorCore=1000 specUtility=1000 weapon=1000 weapon=1000 shieldEmitters=1000 hullPlating=1000 droneBay=1000"],
  "patrol:crafted:carrier:crimsonReaverWarband:repeat": ["aa0df5fc", "321d47ca", "lost:20", "72b470a8", "e78ce23f", "cargoBay=1000 ftlDrive=1000 reactorCore=1000 specUtility=1000 weapon=1000 weapon=1000 shieldEmitters=1000 hullPlating=1000 droneBay=1000"],
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
  "shipEvent:si:orion:cand-0:default": ["none", "628d0a82", "1/11 hull:0 setbacks:0", "99eac3df"],
  "shipEvent:si:orion:cand-0:101": ["probe:win", "f6d6791c", "7/12 hull:0 setbacks:1", "fdd156cb"],
  "battle:si:orion:cand-0": ["probe:0:0:win:0:a894f168", "probe:0:1:win:0:f4bd0752", "probe:0:2:win:0:3f047c54", "probe:1:0:win:0:cc9053ba", "probe:1:1:win:0:b3d35774", "probe:1:2:win:0:8eb44f6", "cloakedPass:0:0:win:0:38c3f49", "cloakedPass:0:1:win:0:6bea0e7", "cloakedPass:0:2:win:0:eda81181", "cloakedPass:1:0:win:0:27ecdc73", "cloakedPass:1:1:win:0:31ef0e91", "cloakedPass:1:2:win:0:abfb56f3", "cloakedFail:0:0:win:0:38c3f49", "cloakedFail:0:1:win:0:6bea0e7", "cloakedFail:0:2:win:0:eda81181", "cloakedFail:1:0:win:0:27ecdc73", "cloakedFail:1:1:loss:41:28710703", "cloakedFail:1:2:win:0:abfb56f3"],
  "shipEvent:si:orion:cand-1:default": ["probe:win", "63ad049a", "7/10 hull:0 setbacks:2", "d908a2d9"],
  "shipEvent:si:orion:cand-1:101": ["none", "2a9661e9", "4/14 hull:0 setbacks:1", "acd0e035"],
  "battle:si:orion:cand-1": ["probe:0:0:win:0:a894f168", "probe:0:1:win:0:f4bd0752", "probe:0:2:win:0:3f047c54", "probe:1:0:win:0:cc9053ba", "probe:1:1:win:0:b3d35774", "probe:1:2:win:0:8eb44f6", "cloakedPass:0:0:win:0:38c3f49", "cloakedPass:0:1:win:0:6bea0e7", "cloakedPass:0:2:win:0:eda81181", "cloakedPass:1:0:win:0:27ecdc73", "cloakedPass:1:1:win:0:31ef0e91", "cloakedPass:1:2:win:0:abfb56f3", "cloakedFail:0:0:win:0:38c3f49", "cloakedFail:0:1:win:0:6bea0e7", "cloakedFail:0:2:loss:41:695e5fdb", "cloakedFail:1:0:win:0:27ecdc73", "cloakedFail:1:1:win:0:31ef0e91", "cloakedFail:1:2:win:0:abfb56f3"],
  "shipEvent:si:orion:cand-2:default": ["cloaked:loss", "577d816c", "4/6 hull:55 setbacks:2", "537d7e17"],
  "shipEvent:si:orion:cand-2:101": ["probe:win", "c54ee85f", "7/15 hull:0 setbacks:1", "556706a2"],
  "battle:si:orion:cand-2": ["probe:0:0:win:0:a894f168", "probe:0:1:win:0:f4bd0752", "probe:0:2:win:0:3f047c54", "probe:1:0:win:0:cc9053ba", "probe:1:1:win:0:b3d35774", "probe:1:2:win:0:8eb44f6", "cloakedPass:0:0:win:0:38c3f49", "cloakedPass:0:1:win:0:6bea0e7", "cloakedPass:0:2:loss:41:695e5fdb", "cloakedPass:1:0:win:0:27ecdc73", "cloakedPass:1:1:win:0:31ef0e91", "cloakedPass:1:2:win:0:abfb56f3", "cloakedFail:0:0:win:0:38c3f49", "cloakedFail:0:1:win:0:6bea0e7", "cloakedFail:0:2:win:0:eda81181", "cloakedFail:1:0:win:0:27ecdc73", "cloakedFail:1:1:win:0:31ef0e91", "cloakedFail:1:2:win:0:abfb56f3"],
  "shipEvent:si:aurora:cand-0:default": ["none", "628d0a82", "1/11 hull:0 setbacks:0", "3b33d479"],
  "shipEvent:si:aurora:cand-0:101": ["probe:win", "f6d6791c", "7/12 hull:0 setbacks:1", "59e9db2d"],
  "battle:si:aurora:cand-0": ["probe:0:0:win:0:a894f168", "probe:0:1:win:0:f4bd0752", "probe:0:2:win:0:3f047c54", "probe:1:0:win:0:cc9053ba", "probe:1:1:win:0:b3d35774", "probe:1:2:win:0:8eb44f6", "cloakedPass:0:0:win:0:38c3f49", "cloakedPass:0:1:win:0:6bea0e7", "cloakedPass:0:2:win:0:eda81181", "cloakedPass:1:0:win:0:27ecdc73", "cloakedPass:1:1:win:0:31ef0e91", "cloakedPass:1:2:win:0:abfb56f3", "cloakedFail:0:0:win:0:38c3f49", "cloakedFail:0:1:win:0:6bea0e7", "cloakedFail:0:2:loss:36:7321f355", "cloakedFail:1:0:win:0:27ecdc73", "cloakedFail:1:1:loss:36:3233077d", "cloakedFail:1:2:win:0:abfb56f3"],
  "shipEvent:si:aurora:cand-1:default": ["probe:win", "63ad049a", "7/10 hull:0 setbacks:2", "622aba57"],
  "shipEvent:si:aurora:cand-1:101": ["none", "2a9661e9", "4/14 hull:0 setbacks:1", "8dcd9915"],
  "battle:si:aurora:cand-1": ["probe:0:0:win:0:a894f168", "probe:0:1:win:0:f4bd0752", "probe:0:2:win:0:3f047c54", "probe:1:0:win:0:cc9053ba", "probe:1:1:win:0:b3d35774", "probe:1:2:win:0:8eb44f6", "cloakedPass:0:0:win:0:38c3f49", "cloakedPass:0:1:win:0:6bea0e7", "cloakedPass:0:2:win:0:eda81181", "cloakedPass:1:0:win:0:27ecdc73", "cloakedPass:1:1:win:0:31ef0e91", "cloakedPass:1:2:win:0:abfb56f3", "cloakedFail:0:0:win:0:38c3f49", "cloakedFail:0:1:win:0:6bea0e7", "cloakedFail:0:2:loss:36:7321f355", "cloakedFail:1:0:win:0:27ecdc73", "cloakedFail:1:1:win:0:31ef0e91", "cloakedFail:1:2:win:0:abfb56f3"],
  "shipEvent:si:aurora:cand-2:default": ["cloaked:loss", "31a281f0", "4/6 hull:48 setbacks:2", "2e5a2f33"],
  "shipEvent:si:aurora:cand-2:101": ["probe:win", "c54ee85f", "7/15 hull:0 setbacks:1", "49033544"],
  "battle:si:aurora:cand-2": ["probe:0:0:win:0:a894f168", "probe:0:1:win:0:f4bd0752", "probe:0:2:win:0:3f047c54", "probe:1:0:win:0:cc9053ba", "probe:1:1:win:0:b3d35774", "probe:1:2:win:0:8eb44f6", "cloakedPass:0:0:win:0:38c3f49", "cloakedPass:0:1:win:0:6bea0e7", "cloakedPass:0:2:loss:36:7321f355", "cloakedPass:1:0:win:0:27ecdc73", "cloakedPass:1:1:win:0:31ef0e91", "cloakedPass:1:2:win:0:abfb56f3", "cloakedFail:0:0:win:0:38c3f49", "cloakedFail:0:1:win:0:6bea0e7", "cloakedFail:0:2:win:0:eda81181", "cloakedFail:1:0:win:0:27ecdc73", "cloakedFail:1:1:win:0:31ef0e91", "cloakedFail:1:2:win:0:abfb56f3"],
  "shipEvent:si:eir:cand-0:default": ["none", "628d0a82", "1/11 hull:0 setbacks:0", "b74ed83e"],
  "shipEvent:si:eir:cand-0:101": ["probe:win", "f6d6791c", "7/12 hull:0 setbacks:1", "e2427dab"],
  "battle:si:eir:cand-0": ["probe:0:0:win:0:a894f168", "probe:0:1:win:0:f4bd0752", "probe:0:2:win:0:3f047c54", "probe:1:0:win:0:cc9053ba", "probe:1:1:win:0:b3d35774", "probe:1:2:win:0:8eb44f6", "cloakedPass:0:0:win:0:38c3f49", "cloakedPass:0:1:win:0:6bea0e7", "cloakedPass:0:2:win:0:eda81181", "cloakedPass:1:0:win:0:27ecdc73", "cloakedPass:1:1:win:0:31ef0e91", "cloakedPass:1:2:win:0:abfb56f3", "cloakedFail:0:0:win:0:38c3f49", "cloakedFail:0:1:win:0:6bea0e7", "cloakedFail:0:2:loss:43:6d647655", "cloakedFail:1:0:loss:43:ca30cdd2", "cloakedFail:1:1:loss:43:2c758a7d", "cloakedFail:1:2:win:0:abfb56f3"],
  "shipEvent:si:eir:cand-1:default": ["probe:win", "63ad049a", "7/10 hull:0 setbacks:2", "4c6dd89f"],
  "shipEvent:si:eir:cand-1:101": ["none", "2a9661e9", "4/14 hull:0 setbacks:1", "c25981ba"],
  "battle:si:eir:cand-1": ["probe:0:0:win:0:a894f168", "probe:0:1:win:0:f4bd0752", "probe:0:2:win:0:3f047c54", "probe:1:0:win:0:cc9053ba", "probe:1:1:win:0:b3d35774", "probe:1:2:win:0:8eb44f6", "cloakedPass:0:0:win:0:38c3f49", "cloakedPass:0:1:win:0:6bea0e7", "cloakedPass:0:2:win:0:eda81181", "cloakedPass:1:0:win:0:27ecdc73", "cloakedPass:1:1:win:0:31ef0e91", "cloakedPass:1:2:win:0:abfb56f3", "cloakedFail:0:0:win:0:38c3f49", "cloakedFail:0:1:win:0:6bea0e7", "cloakedFail:0:2:loss:43:6d647655", "cloakedFail:1:0:win:0:27ecdc73", "cloakedFail:1:1:win:0:31ef0e91", "cloakedFail:1:2:win:0:abfb56f3"],
  "shipEvent:si:eir:cand-2:default": ["cloaked:loss", "83f410ba", "4/6 hull:57 setbacks:2", "e747c2a"],
  "shipEvent:si:eir:cand-2:101": ["probe:win", "c54ee85f", "7/15 hull:0 setbacks:1", "fe6974c0"],
  "battle:si:eir:cand-2": ["probe:0:0:win:0:a894f168", "probe:0:1:win:0:f4bd0752", "probe:0:2:win:0:3f047c54", "probe:1:0:win:0:cc9053ba", "probe:1:1:win:0:b3d35774", "probe:1:2:win:0:8eb44f6", "cloakedPass:0:0:win:0:38c3f49", "cloakedPass:0:1:win:0:6bea0e7", "cloakedPass:0:2:loss:43:6d647655", "cloakedPass:1:0:win:0:27ecdc73", "cloakedPass:1:1:win:0:31ef0e91", "cloakedPass:1:2:win:0:abfb56f3", "cloakedFail:0:0:win:0:38c3f49", "cloakedFail:0:1:loss:43:f6c34a98", "cloakedFail:0:2:win:0:eda81181", "cloakedFail:1:0:win:0:27ecdc73", "cloakedFail:1:1:win:0:31ef0e91", "cloakedFail:1:2:win:0:abfb56f3"],
  "shipEvent:worn:orion:cand-0:default": ["none", "628d0a82", "1/11 hull:0 setbacks:0", "b65df9f5"],
  "shipEvent:worn:orion:cand-0:101": ["probe:win", "f6d6791c", "7/12 hull:0 setbacks:1", "c3a3d33d"],
  "battle:worn:orion:cand-0": ["probe:0:0:win:0:a894f168", "probe:0:1:win:0:f4bd0752", "probe:0:2:win:0:3f047c54", "probe:1:0:win:0:cc9053ba", "probe:1:1:win:0:b3d35774", "probe:1:2:win:0:8eb44f6", "cloakedPass:0:0:win:0:38c3f49", "cloakedPass:0:1:loss:41:fabed3b6", "cloakedPass:0:2:win:0:eda81181", "cloakedPass:1:0:loss:41:c636d7b4", "cloakedPass:1:1:win:0:31ef0e91", "cloakedPass:1:2:loss:41:4dfd9dfe", "cloakedFail:0:0:win:0:38c3f49", "cloakedFail:0:1:loss:41:fabed3b6", "cloakedFail:0:2:loss:41:695e5fdb", "cloakedFail:1:0:loss:41:c636d7b4", "cloakedFail:1:1:loss:41:28710703", "cloakedFail:1:2:loss:41:4dfd9dfe"],
  "shipEvent:worn:orion:cand-1:default": ["probe:win", "63ad049a", "7/10 hull:0 setbacks:2", "86e593bb"],
  "shipEvent:worn:orion:cand-1:101": ["none", "2a9661e9", "4/14 hull:0 setbacks:1", "8357e7b3"],
  "battle:worn:orion:cand-1": ["probe:0:0:win:0:a894f168", "probe:0:1:win:0:f4bd0752", "probe:0:2:win:0:3f047c54", "probe:1:0:win:0:cc9053ba", "probe:1:1:win:0:b3d35774", "probe:1:2:win:0:8eb44f6", "cloakedPass:0:0:win:0:38c3f49", "cloakedPass:0:1:win:0:6bea0e7", "cloakedPass:0:2:win:0:eda81181", "cloakedPass:1:0:loss:41:c636d7b4", "cloakedPass:1:1:win:0:31ef0e91", "cloakedPass:1:2:win:0:abfb56f3", "cloakedFail:0:0:loss:41:e154b8d", "cloakedFail:0:1:loss:41:fabed3b6", "cloakedFail:0:2:loss:41:695e5fdb", "cloakedFail:1:0:loss:41:c636d7b4", "cloakedFail:1:1:win:0:31ef0e91", "cloakedFail:1:2:win:0:abfb56f3"],
  "shipEvent:worn:orion:cand-2:default": ["cloaked:loss", "577d816c", "4/6 hull:55 setbacks:2", "371b7abd"],
  "shipEvent:worn:orion:cand-2:101": ["probe:win", "c54ee85f", "7/15 hull:0 setbacks:1", "384b4518"],
  "battle:worn:orion:cand-2": ["probe:0:0:win:0:a894f168", "probe:0:1:win:0:f4bd0752", "probe:0:2:win:0:3f047c54", "probe:1:0:win:0:cc9053ba", "probe:1:1:win:0:b3d35774", "probe:1:2:win:0:8eb44f6", "cloakedPass:0:0:win:0:38c3f49", "cloakedPass:0:1:win:0:6bea0e7", "cloakedPass:0:2:loss:41:695e5fdb", "cloakedPass:1:0:win:0:27ecdc73", "cloakedPass:1:1:win:0:31ef0e91", "cloakedPass:1:2:win:0:abfb56f3", "cloakedFail:0:0:loss:41:e154b8d", "cloakedFail:0:1:loss:41:fabed3b6", "cloakedFail:0:2:win:0:eda81181", "cloakedFail:1:0:win:0:27ecdc73", "cloakedFail:1:1:win:0:31ef0e91", "cloakedFail:1:2:win:0:abfb56f3"],
  "shipEvent:worn:aurora:cand-0:default": ["none", "628d0a82", "1/11 hull:0 setbacks:0", "d3d9f3b1"],
  "shipEvent:worn:aurora:cand-0:101": ["probe:win", "f6d6791c", "7/12 hull:0 setbacks:1", "18a850f5"],
  "battle:worn:aurora:cand-0": ["probe:0:0:win:0:a894f168", "probe:0:1:win:0:f4bd0752", "probe:0:2:win:0:3f047c54", "probe:1:0:win:0:cc9053ba", "probe:1:1:win:0:b3d35774", "probe:1:2:win:0:8eb44f6", "cloakedPass:0:0:loss:36:c355192f", "cloakedPass:0:1:loss:36:8a344f88", "cloakedPass:0:2:win:0:eda81181", "cloakedPass:1:0:loss:36:aa5595ce", "cloakedPass:1:1:win:0:31ef0e91", "cloakedPass:1:2:loss:36:dd7319d0", "cloakedFail:0:0:loss:36:c355192f", "cloakedFail:0:1:loss:36:8a344f88", "cloakedFail:0:2:loss:36:7321f355", "cloakedFail:1:0:loss:36:aa5595ce", "cloakedFail:1:1:loss:36:3233077d", "cloakedFail:1:2:loss:36:dd7319d0"],
  "shipEvent:worn:aurora:cand-1:default": ["probe:win", "63ad049a", "7/10 hull:0 setbacks:2", "3e4aaee5"],
  "shipEvent:worn:aurora:cand-1:101": ["none", "2a9661e9", "4/14 hull:0 setbacks:1", "f7724a37"],
  "battle:worn:aurora:cand-1": ["probe:0:0:win:0:a894f168", "probe:0:1:win:0:f4bd0752", "probe:0:2:win:0:3f047c54", "probe:1:0:win:0:cc9053ba", "probe:1:1:win:0:b3d35774", "probe:1:2:win:0:8eb44f6", "cloakedPass:0:0:loss:36:c355192f", "cloakedPass:0:1:win:0:6bea0e7", "cloakedPass:0:2:win:0:eda81181", "cloakedPass:1:0:loss:36:aa5595ce", "cloakedPass:1:1:win:0:31ef0e91", "cloakedPass:1:2:win:0:abfb56f3", "cloakedFail:0:0:loss:36:c355192f", "cloakedFail:0:1:loss:36:8a344f88", "cloakedFail:0:2:loss:36:7321f355", "cloakedFail:1:0:loss:36:aa5595ce", "cloakedFail:1:1:win:0:31ef0e91", "cloakedFail:1:2:loss:36:dd7319d0"],
  "shipEvent:worn:aurora:cand-2:default": ["cloaked:loss", "31a281f0", "4/6 hull:48 setbacks:2", "5720605"],
  "shipEvent:worn:aurora:cand-2:101": ["probe:win", "c54ee85f", "7/15 hull:0 setbacks:1", "2c6cace0"],
  "battle:worn:aurora:cand-2": ["probe:0:0:win:0:a894f168", "probe:0:1:win:0:f4bd0752", "probe:0:2:win:0:3f047c54", "probe:1:0:win:0:cc9053ba", "probe:1:1:win:0:b3d35774", "probe:1:2:win:0:8eb44f6", "cloakedPass:0:0:loss:36:c355192f", "cloakedPass:0:1:loss:36:8a344f88", "cloakedPass:0:2:loss:36:7321f355", "cloakedPass:1:0:win:0:27ecdc73", "cloakedPass:1:1:win:0:31ef0e91", "cloakedPass:1:2:win:0:abfb56f3", "cloakedFail:0:0:loss:36:c355192f", "cloakedFail:0:1:loss:36:8a344f88", "cloakedFail:0:2:win:0:eda81181", "cloakedFail:1:0:win:0:27ecdc73", "cloakedFail:1:1:win:0:31ef0e91", "cloakedFail:1:2:win:0:abfb56f3"],
  "shipEvent:worn:eir:cand-0:default": ["none", "628d0a82", "1/11 hull:0 setbacks:0", "1c603a16"],
  "shipEvent:worn:eir:cand-0:101": ["probe:win", "f6d6791c", "7/12 hull:0 setbacks:1", "e0223c07"],
  "battle:worn:eir:cand-0": ["probe:0:0:win:0:a894f168", "probe:0:1:win:0:f4bd0752", "probe:0:2:win:0:3f047c54", "probe:1:0:win:0:cc9053ba", "probe:1:1:win:0:b3d35774", "probe:1:2:win:0:8eb44f6", "cloakedPass:0:0:loss:43:a0f3513", "cloakedPass:0:1:loss:43:f6c34a98", "cloakedPass:0:2:win:0:eda81181", "cloakedPass:1:0:loss:43:ca30cdd2", "cloakedPass:1:1:win:0:31ef0e91", "cloakedPass:1:2:loss:43:4a0214e0", "cloakedFail:0:0:loss:43:a0f3513", "cloakedFail:0:1:loss:43:f6c34a98", "cloakedFail:0:2:loss:43:6d647655", "cloakedFail:1:0:loss:43:ca30cdd2", "cloakedFail:1:1:loss:43:2c758a7d", "cloakedFail:1:2:loss:43:4a0214e0"],
  "shipEvent:worn:eir:cand-1:default": ["probe:win", "63ad049a", "7/10 hull:0 setbacks:2", "cb90a7c5"],
  "shipEvent:worn:eir:cand-1:101": ["none", "2a9661e9", "4/14 hull:0 setbacks:1", "873d7f2"],
  "battle:worn:eir:cand-1": ["probe:0:0:win:0:a894f168", "probe:0:1:win:0:f4bd0752", "probe:0:2:win:0:3f047c54", "probe:1:0:win:0:cc9053ba", "probe:1:1:win:0:b3d35774", "probe:1:2:win:0:8eb44f6", "cloakedPass:0:0:loss:43:a0f3513", "cloakedPass:0:1:loss:43:f6c34a98", "cloakedPass:0:2:win:0:eda81181", "cloakedPass:1:0:loss:43:ca30cdd2", "cloakedPass:1:1:win:0:31ef0e91", "cloakedPass:1:2:loss:43:4a0214e0", "cloakedFail:0:0:loss:43:a0f3513", "cloakedFail:0:1:loss:43:f6c34a98", "cloakedFail:0:2:loss:43:6d647655", "cloakedFail:1:0:loss:43:ca30cdd2", "cloakedFail:1:1:loss:43:2c758a7d", "cloakedFail:1:2:loss:43:4a0214e0"],
  "shipEvent:worn:eir:cand-2:default": ["cloaked:loss", "83f410ba", "4/6 hull:57 setbacks:2", "9b3dc4e4"],
  "shipEvent:worn:eir:cand-2:101": ["probe:win", "c54ee85f", "7/15 hull:0 setbacks:1", "abc4de82"],
  "battle:worn:eir:cand-2": ["probe:0:0:win:0:a894f168", "probe:0:1:win:0:f4bd0752", "probe:0:2:win:0:3f047c54", "probe:1:0:win:0:cc9053ba", "probe:1:1:win:0:b3d35774", "probe:1:2:win:0:8eb44f6", "cloakedPass:0:0:loss:43:a0f3513", "cloakedPass:0:1:loss:43:f6c34a98", "cloakedPass:0:2:loss:43:6d647655", "cloakedPass:1:0:loss:43:ca30cdd2", "cloakedPass:1:1:win:0:31ef0e91", "cloakedPass:1:2:win:0:abfb56f3", "cloakedFail:0:0:loss:43:a0f3513", "cloakedFail:0:1:loss:43:f6c34a98", "cloakedFail:0:2:loss:43:6d647655", "cloakedFail:1:0:win:0:27ecdc73", "cloakedFail:1:1:loss:43:2c758a7d", "cloakedFail:1:2:win:0:abfb56f3"],
  "ground:si": ["ghost:pass:0,storm:pass:0,ghost:pass:0", "fdb18999", "69e5b76f", "8a6c5f3", "cargoBay=1000 ftlDrive=970 reactorCore=991 specUtility=1000 weapon=1000 shieldEmitters=1000 hullPlating=1000 memberWeapon=982 memberArmor=1000 memberTool=1000 implant=1000 memberWeapon=982 memberArmor=1000 memberTool=1000 implant=1000 memberWeapon=1000 memberArmor=1000 memberTool=940 implant=1000"],
  "ground:worn": ["ghost:pass:0,storm:pass:0,ghost:pass:0", "fbc4751c", "c36ad52e", "135b74bb", "cargoBay=1000 ftlDrive=970 reactorCore=991 specUtility=1000 weapon=1000 shieldEmitters=1000 hullPlating=1000 memberWeapon=982 memberArmor=1000 memberTool=1000 implant=1000 memberWeapon=982 memberArmor=1000 memberTool=1000 implant=1000 memberWeapon=1000 memberArmor=1000 memberTool=940 implant=1000"],
  "repair:dc": ["111", "b126e5d5", "c621a214", "cargoBay=1000 ftlDrive=1000 reactorCore=1000 weapon=1000 weapon=1000 weapon=1000 weapon=1000 shieldEmitters=1000 hullPlating=1000 specUtility=1000"],
};


// ===== the rows (one function each, shared by the three proofs below) =====

interface Row {
  run: (inFlight: boolean) => string[];
  // Its dispatch can be made before step 4 and flown on by the live engine (a Dispatch Once patrol, an expedition).
  inFlight: boolean;
}
const ROWS: Record<string, Row> = {};
for (const variant of ["si", "worn"] as const) {
  for (const hull of HULLS) {
    for (const key of ROUTES) {
      for (const repeat of [false, true]) {
        const id = `patrol:${variant}:${hull}:${key}:${repeat ? "repeat" : "once"}`;
        ROWS[id] = { run: (f) => patrolRun(patrolBase(hull, variant), key, repeat, id, f), inFlight: !repeat };
      }
    }
  }
}
for (const hull of COMBAT_HULLS) {
  for (const key of ROUTES) {
    const id = `patrol:crafted:${hull}:${key}:repeat`;
    ROWS[id] = { run: () => patrolRun(patrolBase(hull, "crafted"), key, true, id), inFlight: false };
  }
}
for (const key of ROUTES) {
  const dc = `patrol:dc:destroyer:${key}:repeat`;
  ROWS[dc] = { run: () => patrolRun(patrolBase("destroyer", "dc"), key, true, dc), inFlight: false };
  const mod = `patrol:modules:battleship:${key}:repeat`;
  ROWS[mod] = { run: () => patrolRun(patrolBase("battleship", "modules"), key, true, mod), inFlight: false };
}
for (const variant of ["si", "worn"] as const) {
  for (const hull of FORECAST_HULLS) {
    for (const key of ROUTES) ROWS[`forecast:${variant}:${hull}:${key}`] = { run: () => [forecast(patrolBase(hull, variant), key)], inFlight: false };
  }
}
for (const variant of ["si", "worn"] as const) {
  for (const hull of EXPLORERS) {
    for (const cand of CANDS) {
      for (const seed of EXPEDITION_SEEDS) {
        ROWS[`shipEvent:${variant}:${hull}:${cand}:${seed ?? "default"}`] = { run: (f) => shipEventRow(hull, cand, seed, variant, f), inFlight: true };
      }
      ROWS[`battle:${variant}:${hull}:${cand}`] = { run: (f) => battleRow(hull, cand, variant, f), inFlight: true };
    }
  }
}
for (const variant of ["si", "worn"] as const) ROWS[`ground:${variant}`] = { run: (f) => groundRun(variant, f), inFlight: true };
ROWS["repair:dc"] = { run: () => dcRepair(), inFlight: false };

// ===== the live game (step 4 in), captured with GW4_CAPTURE on the step 4 engine =====
//
// What moved, and why, against the design's section 10 lists; every row's switch-off value is its GOLDEN_PRE (the
// first suite), so each move below is step 4 alone:
//   patrol:si:*        : every new cycle carries the step 4 stamp (PatrolMissionState.cycleStartCondition, {} while
//                        pristine), so every dispatch record and state hash moves; the FIRST cycle's fight is the
//                        pristine one (section 10 "every pristine first cycle": all 48 first-cycle replays of the si,
//                        crafted and dc rows hold); its battles then wear the pieces (the shields and pods each wave,
//                        the plating where the hull is hit, the weapons, reactor and drive at the cycle's end), so the
//                        ship and state hashes and the conditions move ("any golden that serializes an
//                        EquipmentInstance"); a Repeat cycle from 2 opens at that carried wear ("Patrol Repeat from
//                        cycle 2"): its record and replay move, and the three explorers' Sweep Repeat now lose their
//                        third cycle (lost:40, was won:42).
//   patrol:worn:*      : the same pieces preset worn (the carried wear met at once): from cycle 1 the weapons, reactor
//                        and drive open their pools at their true condition (user W3; the reactor and drive below the
//                        Degraded line), the shields, plating and pods at their efficiency, so the first cycle's replay
//                        moves too and nineteen rows end sooner (they lose, or lose earlier: the economy hulls', the
//                        explorers' and the carrier's).
//   patrol:crafted:*   : as si, the crafted quality 3 pieces' toughness taking less per battle ("crafted quality-above-0
//                        reactors and FTL drives in combat").
//   patrol:dc:*        : as si, plus the Damage Control Suite's patch-ups, each one fire (its use wear).
//   patrol:modules:*   : the two worn modules act at their efficiency (WEAR_EFFICIENCY module:effect: the Bracing's hull
//                        lift is smaller, so the cycle's hull pool is), first cycle included.
//   forecast:worn:*    : six bands drop (the forecast fights the cycle a dispatch would start: its frozen worn gear,
//                        e.g. carrier Warband 23 to 1 of 64); forecast:si and four worn rows hold.
//   shipEvent:* / battle:* : a run dispatched now carries the battle stamp, its battle snapshot the reactor and drive
//                        copies and the flag, so every run and event hash moves; each ship battle records its wear on
//                        the event (ExpeditionScanEvent.gearWear), a failed check's hull wear wears the plating; the
//                        worn variant's battles fight the frozen worn gear. No Standard-Issue battle outcome moved;
//                        the worn ships lose 38 of their 162 stubbed fights (mostly the cloaked vessel).
//   ground:*           : the battle stamp, each fight's armor wear on the record and the tally, the members' armor worn
//                        as the run lands (member armor wears by battle, design 3.2).
//   pause to repair    : (user 2026-10-27) a stamped Repeat cycle that would open a combat piece under the line goes
//                        home to repair, then resumes: twelve Repeat rows pause (their relaunch ticks move later) and
//                        the three explorers' Sweep Repeat now WIN their third cycle (lost:40 before the pause); the
//                        carrier Warband's second-cycle loss is the fight's own (it loses that cycle pristine too).
//                        Review 2026-10-27, "Repair first, then go": a Repeat dispatch under the line starts with its
//                        home repair pause, so every preset-worn Repeat row repairs first, then flies; every worn
//                        Sweep Repeat now wins (the economy hulls' and the explorers' lost before); the Warband
//                        Repeats still lose their fight's own way (pristine loses it too). inflight:* rows: an old
//                        Repeat run flies its cycle as GOLDEN_PRE did and is stamped from its next relaunch.
//                        The trigger, user 2026-10-28 "from realism": the line is gone; a Repeat cycle pauses only when
//                        its projection (projectedCycleBreak: the cycle resolved by the replay leaves, no draw) breaks a
//                        worn weapon, reactor or drive, or (PATROL_REPAIR_ON_PROJECTED_DEFEAT) loses the ship. Moved: the
//                        Sweep Repeats no longer pause (they fly their worn gear and win, relaunch:28 again, ending
//                        worn); the three explorers' Sweep Repeat flies cycle 2 worn and pauses before cycle 3 (the one
//                        it would lose), then wins it; the Warband Repeats pause before the cycle they would lose (and
//                        still lose it pristine); the worn Sweep Repeats no longer repair first (nothing would break);
//                        the worn Warband Repeats still repair first (their worn first cycle would be lost), fly
//                        cycle 1 and pause again before the cycle 2 they lose. The in-flight worn
//                        destroyer row's first cycle holds (GOLDEN_PRE's); from its relaunch it flies worn.
//   repair:dc          : HOLDS: the repair it shortens is one suite fire, but its few per-mille recover in the bay
//                        before the repair ends (gearWearCombat.test.ts proves the fire).
// Held (section 10 "expected to stay"): every pristine first cycle's fight; the safe first runs (no wear on training,
// W9: the training cycle and run are never stamped); the Standard-Issue reactor and drive pools (quality 0, 100) while
// pristine.
// Re-pinned by the WR-7 follow-up OC-D5 favorsSpec ("+10% on its ship type", user 2026-10-29): the three `dc` rows
// (the Damage Control Suite favors the Tactician spec, so on the Destroyer its lines count +10%): each patrol record
// carries the favoredSpec stamp, its patch-up and the gear repair rates read the favored lines (the Warband Repeat
// relaunches at 169 and is lost at 185, was 171 and 187), and repair:dc's Shipyard process is shorter. With the bonus
// switched off each of the three is its earlier pin; GOLDEN_PRE is read with it off (the first suite).
const GOLDEN: Record<string, string[]> = {
  "patrol:si:generalFreighter:crimsonReaverSweep:once": ["e1c443c2", "597c09a2", "won:14", "b2f38143", "ccde4fa", "cargoBay=1000 ftlDrive=830 reactorCore=892 specUtility=1000 weapon=820 weapon=870 shieldEmitters=817 hullPlating=909"],
  "patrol:si:generalFreighter:crimsonReaverSweep:repeat": ["3f20dbd7", "597c09a2", "relaunch:14", "277f3b70", "c0f70648", "ea2c4ae9", "relaunch:28", "92768286", "f0f1651f", "e7ef4da8", "won:42", "b2f38143", "2cff7989", "cargoBay=1000 ftlDrive=640 reactorCore=759 specUtility=1000 weapon=630 weapon=750 shieldEmitters=493 hullPlating=904"],
  "patrol:si:generalFreighter:crimsonReaverWarband:once": ["de9c6e20", "3bc66d4f", "lost:20", "701a58f1", "319720d8", "cargoBay=1000 ftlDrive=870 reactorCore=825 specUtility=1000 weapon=920 weapon=800 shieldEmitters=796 hullPlating=845"],
  "patrol:si:generalFreighter:crimsonReaverWarband:repeat": ["245e9175", "3bc66d4f", "lost:20", "701a58f1", "319720d8", "cargoBay=1000 ftlDrive=870 reactorCore=825 specUtility=1000 weapon=920 weapon=800 shieldEmitters=796 hullPlating=845"],
  "patrol:si:prospectorHauler:crimsonReaverSweep:once": ["46a5f0e5", "41ce7378", "won:14", "9d03d00b", "de886ced", "cargoBay=1000 ftlDrive=830 reactorCore=892 specUtility=1000 weapon=820 weapon=870 shieldEmitters=829 hullPlating=943"],
  "patrol:si:prospectorHauler:crimsonReaverSweep:repeat": ["78df35be", "41ce7378", "relaunch:14", "2e5612a3", "508b12a8", "fd57f191", "relaunch:28", "11e7af4e", "1b89ec64", "5ebba55a", "won:42", "9d03d00b", "c7b6f2bb", "cargoBay=1000 ftlDrive=640 reactorCore=759 specUtility=1000 weapon=630 weapon=750 shieldEmitters=558 hullPlating=944"],
  "patrol:si:prospectorHauler:crimsonReaverWarband:once": ["a6c00abf", "45b124f1", "lost:23", "8539ed3f", "7ad94873", "cargoBay=1000 ftlDrive=810 reactorCore=784 specUtility=1000 weapon=900 weapon=750 shieldEmitters=793 hullPlating=846"],
  "patrol:si:prospectorHauler:crimsonReaverWarband:repeat": ["ecd056c8", "45b124f1", "lost:23", "8539ed3f", "7ad94873", "cargoBay=1000 ftlDrive=810 reactorCore=784 specUtility=1000 weapon=900 weapon=750 shieldEmitters=793 hullPlating=846"],
  "patrol:si:prospectorRunner:crimsonReaverSweep:once": ["f8e496d5", "b0c9ae30", "lost:10", "e1360e3a", "9e48066c", "cargoBay=1000 ftlDrive=870 reactorCore=884 specUtility=1000 weapon=850 shieldEmitters=850 hullPlating=844"],
  "patrol:si:prospectorRunner:crimsonReaverSweep:repeat": ["82070ace", "b0c9ae30", "lost:10", "e1360e3a", "9e48066c", "cargoBay=1000 ftlDrive=870 reactorCore=884 specUtility=1000 weapon=850 shieldEmitters=850 hullPlating=844"],
  "patrol:si:prospectorRunner:crimsonReaverWarband:once": ["ac62e5b3", "88141285", "lost:20", "e1360e3a", "1c19b46f", "cargoBay=1000 ftlDrive=780 reactorCore=759 specUtility=1000 weapon=750 shieldEmitters=825 hullPlating=845"],
  "patrol:si:prospectorRunner:crimsonReaverWarband:repeat": ["86274214", "88141285", "lost:20", "e1360e3a", "1c19b46f", "cargoBay=1000 ftlDrive=780 reactorCore=759 specUtility=1000 weapon=750 shieldEmitters=825 hullPlating=845"],
  "patrol:si:prospectorMiner:crimsonReaverSweep:once": ["d1819c8", "1b2af2bc", "lost:10", "4a78733f", "83fc843b", "cargoBay=1000 ftlDrive=820 reactorCore=859 specUtility=1000 weapon=820 shieldEmitters=850 hullPlating=844"],
  "patrol:si:prospectorMiner:crimsonReaverSweep:repeat": ["294b541d", "1b2af2bc", "lost:10", "4a78733f", "83fc843b", "cargoBay=1000 ftlDrive=820 reactorCore=859 specUtility=1000 weapon=820 shieldEmitters=850 hullPlating=844"],
  "patrol:si:prospectorMiner:crimsonReaverWarband:once": ["71b9d842", "8774e398", "lost:20", "4a78733f", "8bc20fd9", "cargoBay=1000 ftlDrive=780 reactorCore=759 specUtility=1000 weapon=740 shieldEmitters=796 hullPlating=846"],
  "patrol:si:prospectorMiner:crimsonReaverWarband:repeat": ["a243c557", "8774e398", "lost:20", "4a78733f", "8bc20fd9", "cargoBay=1000 ftlDrive=780 reactorCore=759 specUtility=1000 weapon=740 shieldEmitters=796 hullPlating=846"],
  "patrol:si:destroyer:crimsonReaverSweep:once": ["c478f282", "ba2ee129", "won:14", "6ad9f46c", "c6c2c36", "cargoBay=1000 ftlDrive=950 reactorCore=967 specUtility=1000 weapon=930 weapon=940 weapon=960 weapon=960 shieldEmitters=857 hullPlating=1000"],
  "patrol:si:destroyer:crimsonReaverSweep:repeat": ["8f383097", "ba2ee129", "relaunch:14", "51f9a0f0", "37fba881", "7a9c61d0", "relaunch:28", "c41a2975", "31d91016", "836dbd38", "won:42", "6ad9f46c", "11c2f4b5", "cargoBay=1000 ftlDrive=880 reactorCore=893 specUtility=1000 weapon=860 weapon=870 weapon=910 weapon=920 shieldEmitters=766 hullPlating=1000"],
  "patrol:si:destroyer:crimsonReaverWarband:once": ["73630c4c", "5469ccef", "won:22", "6ad9f46c", "47c7e85b", "cargoBay=1000 ftlDrive=960 reactorCore=917 specUtility=1000 weapon=920 weapon=890 weapon=890 weapon=860 shieldEmitters=788 hullPlating=937"],
  "patrol:si:destroyer:crimsonReaverWarband:repeat": ["3c5d8399", "5469ccef", "relaunch:341", "4858c570", "ebef6932", "d68ae08c", "lost:357", "44b4c6b5", "82f917f", "cargoBay=1000 ftlDrive=940 reactorCore=950 specUtility=1000 weapon=940 weapon=910 weapon=910 weapon=930 shieldEmitters=850 hullPlating=844"],
  "patrol:si:battleship:crimsonReaverSweep:once": ["2dfb18ca", "2436a90a", "won:14", "c6dba9cb", "8a77afc0", "cargoBay=1000 ftlDrive=970 reactorCore=992 specUtility=1000 weapon=980 weapon=990 weapon=990 weapon=970 weapon=980 weapon=1000 shieldEmitters=974 hullPlating=1000"],
  "patrol:si:battleship:crimsonReaverSweep:repeat": ["fa1c93f", "2436a90a", "relaunch:14", "364687c6", "6ab48506", "b8fbeace", "relaunch:28", "f7d02d86", "7a25963b", "6ab67ead", "won:42", "c6dba9cb", "aed00115", "cargoBay=1000 ftlDrive=920 reactorCore=968 specUtility=1000 weapon=950 weapon=950 weapon=960 weapon=950 weapon=940 weapon=960 shieldEmitters=951 hullPlating=1000"],
  "patrol:si:battleship:crimsonReaverWarband:once": ["6163082c", "a4925972", "won:22", "c6dba9cb", "b2613955", "cargoBay=1000 ftlDrive=990 reactorCore=975 specUtility=1000 weapon=960 weapon=970 weapon=940 weapon=960 weapon=980 weapon=930 shieldEmitters=969 hullPlating=995"],
  "patrol:si:battleship:crimsonReaverWarband:repeat": ["15fb65f9", "a4925972", "relaunch:128", "faf25826", "e45fd510", "30e1d10e", "lost:146", "afe73d75", "69373f95", "cargoBay=1000 ftlDrive=820 reactorCore=909 specUtility=1000 weapon=820 weapon=850 weapon=840 weapon=860 weapon=810 weapon=870 shieldEmitters=835 hullPlating=846"],
  "patrol:si:carrier:crimsonReaverSweep:once": ["fd75b80b", "8f2f9130", "won:14", "ea909677", "80b45ed5", "cargoBay=1000 ftlDrive=940 reactorCore=942 specUtility=1000 weapon=920 weapon=920 shieldEmitters=967 hullPlating=1000 droneBay=775"],
  "patrol:si:carrier:crimsonReaverSweep:repeat": ["894546ac", "8f2f9130", "relaunch:14", "8daa9f07", "204dfba0", "888a955b", "relaunch:28", "b9e624af", "e15e6bc4", "9078cba9", "won:42", "ea909677", "e673be5c", "cargoBay=1000 ftlDrive=850 reactorCore=901 specUtility=1000 weapon=820 weapon=850 shieldEmitters=962 hullPlating=1000 droneBay=589"],
  "patrol:si:carrier:crimsonReaverWarband:once": ["44ef2269", "c28deffe", "won:22", "ea909677", "cb9e5438", "cargoBay=1000 ftlDrive=930 reactorCore=942 specUtility=1000 weapon=900 weapon=880 shieldEmitters=989 hullPlating=979 droneBay=664"],
  "patrol:si:carrier:crimsonReaverWarband:repeat": ["c38f959a", "c28deffe", "relaunch:527", "109643ed", "9145b617", "7b6360a", "lost:543", "73109288", "f6403ea", "cargoBay=1000 ftlDrive=910 reactorCore=917 specUtility=1000 weapon=900 weapon=860 shieldEmitters=850 hullPlating=844 droneBay=700"],
  "patrol:si:orion:crimsonReaverSweep:once": ["96307d3", "f6d6af33", "won:14", "c75858d4", "16bef1a9", "cargoBay=1000 ftlDrive=640 reactorCore=692 specUtility=1000 weapon=600 shieldEmitters=822 hullPlating=931"],
  "patrol:si:orion:crimsonReaverSweep:repeat": ["49cdfeb4", "f6d6af33", "relaunch:14", "d0d5b464", "2b2046ae", "deed936c", "relaunch:1334", "461b0104", "ec1608e8", "fea1d5f5", "won:1348", "c75858d4", "6a355fff", "cargoBay=1000 ftlDrive=850 reactorCore=867 specUtility=1000 weapon=850 shieldEmitters=925 hullPlating=1000"],
  "patrol:si:orion:crimsonReaverWarband:once": ["44b24d79", "acbf2a27", "lost:20", "6619cb48", "c41d314a", "cargoBay=1000 ftlDrive=720 reactorCore=717 specUtility=1000 weapon=680 shieldEmitters=820 hullPlating=844"],
  "patrol:si:orion:crimsonReaverWarband:repeat": ["e972f78a", "acbf2a27", "lost:20", "6619cb48", "c41d314a", "cargoBay=1000 ftlDrive=720 reactorCore=717 specUtility=1000 weapon=680 shieldEmitters=820 hullPlating=844"],
  "patrol:si:aurora:crimsonReaverSweep:once": ["6335977c", "6eeaff13", "won:14", "62b89a6f", "71c6fd52", "cargoBay=1000 ftlDrive=640 reactorCore=692 specUtility=1000 weapon=600 shieldEmitters=814 hullPlating=910"],
  "patrol:si:aurora:crimsonReaverSweep:repeat": ["1dc15be9", "6eeaff13", "relaunch:14", "211bb688", "9c1bb3c4", "4fa1bf61", "relaunch:1334", "a524fc31", "c1840d62", "fd78e92d", "won:1348", "62b89a6f", "21a4662a", "cargoBay=1000 ftlDrive=850 reactorCore=867 specUtility=1000 weapon=850 shieldEmitters=916 hullPlating=1000"],
  "patrol:si:aurora:crimsonReaverWarband:once": ["791cbd5a", "a5c4a4bd", "lost:20", "def772e7", "bd9106a0", "cargoBay=1000 ftlDrive=730 reactorCore=725 specUtility=1000 weapon=690 shieldEmitters=804 hullPlating=844"],
  "patrol:si:aurora:crimsonReaverWarband:repeat": ["e394c6af", "a5c4a4bd", "lost:20", "def772e7", "bd9106a0", "cargoBay=1000 ftlDrive=730 reactorCore=725 specUtility=1000 weapon=690 shieldEmitters=804 hullPlating=844"],
  "patrol:si:eir:crimsonReaverSweep:once": ["29832d98", "28bafcf2", "won:14", "ffdca63b", "72e556b7", "cargoBay=1000 ftlDrive=640 reactorCore=692 specUtility=1000 weapon=600 shieldEmitters=823 hullPlating=863"],
  "patrol:si:eir:crimsonReaverSweep:repeat": ["e5a9dccd", "28bafcf2", "relaunch:14", "877203ad", "131d9393", "a72f715", "relaunch:1334", "bdfb6a85", "ca52d3ab", "7835439", "won:1348", "ffdca63b", "5333ddcc", "cargoBay=1000 ftlDrive=850 reactorCore=867 specUtility=1000 weapon=850 shieldEmitters=914 hullPlating=1000"],
  "patrol:si:eir:crimsonReaverWarband:once": ["e71e100e", "5f90e37a", "lost:20", "7ddb5b8d", "3270e736", "cargoBay=1000 ftlDrive=720 reactorCore=717 specUtility=1000 weapon=680 shieldEmitters=795 hullPlating=844"],
  "patrol:si:eir:crimsonReaverWarband:repeat": ["a4f9c3cb", "5f90e37a", "lost:20", "7ddb5b8d", "3270e736", "cargoBay=1000 ftlDrive=720 reactorCore=717 specUtility=1000 weapon=680 shieldEmitters=795 hullPlating=844"],
  "patrol:worn:generalFreighter:crimsonReaverSweep:once": ["bd4bcf18", "88e313b5", "lost:10", "b5fc4bb3", "87c9d13a", "cargoBay=900 ftlDrive=370 reactorCore=377 specUtility=700 weapon=460 weapon=470 shieldEmitters=470 hullPlating=364"],
  "patrol:worn:generalFreighter:crimsonReaverSweep:repeat": ["5fb48baa", "88e313b5", "relaunch:721", "2dcca550", "dfb680d9", "586b1dd8", "relaunch:735", "b2103e30", "8f85d8b0", "3a400660", "won:749", "b2f38143", "90eaa6f0", "cargoBay=1000 ftlDrive=810 reactorCore=867 specUtility=1000 weapon=810 weapon=880 shieldEmitters=679 hullPlating=995"],
  "patrol:worn:generalFreighter:crimsonReaverWarband:once": ["7b5ddb2", "5450745a", "lost:20", "b5fc4bb3", "18440ca6", "cargoBay=900 ftlDrive=360 reactorCore=385 specUtility=700 weapon=430 weapon=330 shieldEmitters=390 hullPlating=365"],
  "patrol:worn:generalFreighter:crimsonReaverWarband:repeat": ["df361590", "5450745a", "relaunch:721", "7eda60a9", "80dbcbf3", "d11b9efd", "lost:737", "701a58f1", "bfd16c06", "cargoBay=1000 ftlDrive=980 reactorCore=934 specUtility=1000 weapon=970 weapon=950 shieldEmitters=850 hullPlating=844"],
  "patrol:worn:prospectorHauler:crimsonReaverSweep:once": ["4e484730", "2e21339", "lost:14", "d30864e1", "e246e1d1", "cargoBay=900 ftlDrive=280 reactorCore=302 specUtility=700 weapon=360 weapon=380 shieldEmitters=444 hullPlating=365"],
  "patrol:worn:prospectorHauler:crimsonReaverSweep:repeat": ["a95e25d2", "2e21339", "relaunch:721", "1070a1fd", "775306c6", "d79e7899", "relaunch:735", "4eb5bdbd", "68ddce91", "e21436fa", "won:749", "9d03d00b", "64af70ec", "cargoBay=1000 ftlDrive=810 reactorCore=867 specUtility=1000 weapon=810 weapon=880 shieldEmitters=733 hullPlating=1000"],
  "patrol:worn:prospectorHauler:crimsonReaverWarband:once": ["cf12e2c6", "3933588d", "lost:20", "d30864e1", "9561a17f", "cargoBay=900 ftlDrive=310 reactorCore=319 specUtility=700 weapon=400 weapon=270 shieldEmitters=373 hullPlating=365"],
  "patrol:worn:prospectorHauler:crimsonReaverWarband:repeat": ["fac7e13c", "3933588d", "relaunch:721", "1e2cba44", "b356e7c0", "8dde27a0", "lost:737", "8539ed3f", "aa8a7ab1", "cargoBay=1000 ftlDrive=970 reactorCore=917 specUtility=1000 weapon=950 weapon=920 shieldEmitters=850 hullPlating=844"],
  "patrol:worn:prospectorRunner:crimsonReaverSweep:once": ["18b03ca", "7406c76e", "lost:10", "c4ae7568", "22d26d0f", "cargoBay=900 ftlDrive=460 reactorCore=460 specUtility=700 weapon=540 shieldEmitters=470 hullPlating=364"],
  "patrol:worn:prospectorRunner:crimsonReaverSweep:repeat": ["d0d878d8", "7406c76e", "relaunch:721", "c56b40ed", "5a9c96cf", "b27cb0c1", "relaunch:735", "d690303d", "1e6bf9ad", "e157b2c9", "won:749", "c4afd62a", "cb212cee", "cargoBay=1000 ftlDrive=620 reactorCore=676 specUtility=1000 weapon=660 shieldEmitters=433 hullPlating=818"],
  "patrol:worn:prospectorRunner:crimsonReaverWarband:once": ["6cf94cb4", "55888aa7", "lost:16", "c4ae7568", "af0d2c90", "cargoBay=900 ftlDrive=390 reactorCore=360 specUtility=700 weapon=430 shieldEmitters=470 hullPlating=364"],
  "patrol:worn:prospectorRunner:crimsonReaverWarband:repeat": ["22fd661e", "55888aa7", "relaunch:721", "1dc2d808", "8eec5433", "de26f448", "lost:737", "e1360e3a", "1f50355", "cargoBay=1000 ftlDrive=950 reactorCore=975 specUtility=1000 weapon=970 shieldEmitters=850 hullPlating=844"],
  "patrol:worn:prospectorMiner:crimsonReaverSweep:once": ["e52443cd", "4a6e56af", "lost:10", "b8577ef0", "4a16fa1c", "cargoBay=900 ftlDrive=430 reactorCore=435 specUtility=700 weapon=490 shieldEmitters=470 hullPlating=364"],
  "patrol:worn:prospectorMiner:crimsonReaverSweep:repeat": ["4dcd147", "4a6e56af", "relaunch:721", "fb2c428a", "6887daf5", "1846e099", "relaunch:735", "9ad1a929", "df806a71", "542752d2", "won:749", "3e9366f7", "3092f75e", "cargoBay=1000 ftlDrive=620 reactorCore=676 specUtility=1000 weapon=660 shieldEmitters=530 hullPlating=871"],
  "patrol:worn:prospectorMiner:crimsonReaverWarband:once": ["49e60b7f", "c4b613f9", "lost:16", "b8577ef0", "a9a21e1b", "cargoBay=900 ftlDrive=340 reactorCore=285 specUtility=700 weapon=380 shieldEmitters=470 hullPlating=364"],
  "patrol:worn:prospectorMiner:crimsonReaverWarband:repeat": ["16919ded", "c4b613f9", "relaunch:721", "e5fb7553", "fc786623", "b3eb98b2", "lost:737", "4a78733f", "2b5eb750", "cargoBay=1000 ftlDrive=940 reactorCore=975 specUtility=1000 weapon=960 shieldEmitters=850 hullPlating=844"],
  "patrol:worn:destroyer:crimsonReaverSweep:once": ["96938419", "d07b0776", "won:14", "6ad9f46c", "f6c882a3", "cargoBay=900 ftlDrive=510 reactorCore=494 specUtility=700 weapon=560 weapon=560 weapon=530 weapon=570 shieldEmitters=459 hullPlating=520"],
  "patrol:worn:destroyer:crimsonReaverSweep:repeat": ["b8d18aaa", "d07b0776", "relaunch:14", "4dd6babe", "b128e2b0", "efc0a95e", "relaunch:28", "30c5f226", "b48f5b9c", "cd286b09", "won:42", "6ad9f46c", "881a81d0", "cargoBay=901 ftlDrive=381 reactorCore=370 specUtility=701 weapon=421 weapon=391 weapon=381 weapon=411 shieldEmitters=273 hullPlating=521"],
  "patrol:worn:destroyer:crimsonReaverWarband:once": ["2a9c0c4b", "8ccf75a1", "won:22", "6ad9f46c", "f82c5812", "cargoBay=900 ftlDrive=440 reactorCore=427 specUtility=700 weapon=480 weapon=440 weapon=460 weapon=510 shieldEmitters=408 hullPlating=380"],
  "patrol:worn:destroyer:crimsonReaverWarband:repeat": ["b554ceec", "8ccf75a1", "relaunch:953", "4858c570", "ebef6932", "316cc989", "lost:969", "44b4c6b5", "46e9c48a", "cargoBay=1000 ftlDrive=940 reactorCore=950 specUtility=1000 weapon=940 weapon=910 weapon=910 weapon=930 shieldEmitters=850 hullPlating=844"],
  "patrol:worn:battleship:crimsonReaverSweep:once": ["6222bfe8", "9ac03ce9", "won:14", "c6dba9cb", "45d087c6", "cargoBay=900 ftlDrive=550 reactorCore=519 specUtility=700 weapon=620 weapon=590 weapon=610 weapon=610 weapon=630 weapon=610 shieldEmitters=576 hullPlating=520"],
  "patrol:worn:battleship:crimsonReaverSweep:repeat": ["722719bd", "9ac03ce9", "relaunch:14", "18573f22", "c6bbcd13", "b6462535", "relaunch:28", "c5091155", "bff301c1", "c8a8e065", "won:42", "c6dba9cb", "9779698e", "cargoBay=901 ftlDrive=501 reactorCore=487 specUtility=701 weapon=551 weapon=561 weapon=521 weapon=581 weapon=581 weapon=561 shieldEmitters=546 hullPlating=521"],
  "patrol:worn:battleship:crimsonReaverWarband:once": ["e89f9b12", "8789e91", "won:22", "c6dba9cb", "6f1f9458", "cargoBay=900 ftlDrive=440 reactorCore=419 specUtility=700 weapon=460 weapon=510 weapon=470 weapon=550 weapon=510 weapon=570 shieldEmitters=555 hullPlating=421"],
  "patrol:worn:battleship:crimsonReaverWarband:repeat": ["5b797507", "8789e91", "relaunch:895", "faf25826", "e45fd510", "11b0bc25", "lost:913", "afe73d75", "8c94af4f", "cargoBay=1000 ftlDrive=820 reactorCore=909 specUtility=1000 weapon=820 weapon=850 weapon=840 weapon=860 weapon=810 weapon=870 shieldEmitters=835 hullPlating=846"],
  "patrol:worn:carrier:crimsonReaverSweep:once": ["ad5933c9", "c0125de6", "won:14", "ea909677", "acccf58", "cargoBay=900 ftlDrive=510 reactorCore=485 specUtility=700 weapon=570 weapon=530 shieldEmitters=606 hullPlating=520 droneBay=338"],
  "patrol:worn:carrier:crimsonReaverSweep:repeat": ["a160037a", "c0125de6", "relaunch:14", "a189c10b", "c7b2fe00", "1ee51b87", "relaunch:28", "7619d683", "7ba87d64", "34c6008", "won:42", "ea909677", "df82d62a", "cargoBay=901 ftlDrive=411 reactorCore=411 specUtility=701 weapon=501 weapon=431 shieldEmitters=598 hullPlating=521 droneBay=3"],
  "patrol:worn:carrier:crimsonReaverWarband:once": ["5449c91b", "9ff387b7", "lost:20", "5fc4a7ce", "6fec292d", "cargoBay=900 ftlDrive=340 reactorCore=402 specUtility=700 weapon=370 weapon=380 shieldEmitters=562 hullPlating=364 droneBay=300"],
  "patrol:worn:carrier:crimsonReaverWarband:repeat": ["df1a7b91", "9ff387b7", "relaunch:721", "e2a4533a", "9145b617", "c5c1da45", "lost:737", "73109288", "1b6bb66d", "cargoBay=1000 ftlDrive=910 reactorCore=917 specUtility=1000 weapon=900 weapon=860 shieldEmitters=850 hullPlating=844 droneBay=700"],
  "patrol:worn:orion:crimsonReaverSweep:once": ["4b330354", "c5e40def", "lost:10", "235be419", "73b198e8", "cargoBay=900 ftlDrive=210 reactorCore=360 specUtility=700 weapon=320 shieldEmitters=470 hullPlating=364"],
  "patrol:worn:orion:crimsonReaverSweep:repeat": ["8ec111fe", "c5e40def", "relaunch:721", "26220a57", "df046fc3", "dda05fff", "relaunch:735", "18dd6ffb", "feec19fa", "c7687989", "won:749", "c75858d4", "f3f43fae", "cargoBay=1000 ftlDrive=620 reactorCore=676 specUtility=1000 weapon=660 shieldEmitters=815 hullPlating=1000"],
  "patrol:worn:orion:crimsonReaverWarband:once": ["b7db335a", "85bd0696", "lost:20", "235be419", "584151df", "cargoBay=900 ftlDrive=180 reactorCore=94 specUtility=700 weapon=100 shieldEmitters=439 hullPlating=364"],
  "patrol:worn:orion:crimsonReaverWarband:repeat": ["49fd7508", "85bd0696", "relaunch:721", "454bf9f6", "f52393a6", "a49ac80", "lost:737", "6619cb48", "5cfddb5", "cargoBay=1000 ftlDrive=920 reactorCore=942 specUtility=1000 weapon=940 shieldEmitters=850 hullPlating=844"],
  "patrol:worn:aurora:crimsonReaverSweep:once": ["f0877537", "aa63a6bb", "lost:10", "fa918919", "7ef5e7ef", "cargoBay=900 ftlDrive=240 reactorCore=377 specUtility=700 weapon=360 shieldEmitters=470 hullPlating=364"],
  "patrol:worn:aurora:crimsonReaverSweep:repeat": ["d0be53b5", "aa63a6bb", "relaunch:721", "5368da6e", "29baaf8e", "b2497649", "relaunch:735", "f75a2f3", "cf07c7ea", "b72112e3", "won:749", "62b89a6f", "9de2256e", "cargoBay=1000 ftlDrive=620 reactorCore=676 specUtility=1000 weapon=660 shieldEmitters=793 hullPlating=1000"],
  "patrol:worn:aurora:crimsonReaverWarband:once": ["1bd248bd", "85caf75", "lost:20", "fa918919", "4fd6f2eb", "cargoBay=900 ftlDrive=190 reactorCore=94 specUtility=700 weapon=110 shieldEmitters=441 hullPlating=365"],
  "patrol:worn:aurora:crimsonReaverWarband:repeat": ["f51f5357", "85caf75", "relaunch:721", "c1bd387b", "7ac5d6d9", "d07c8120", "lost:737", "def772e7", "c3e40b84", "cargoBay=1000 ftlDrive=940 reactorCore=959 specUtility=1000 weapon=940 shieldEmitters=850 hullPlating=844"],
  "patrol:worn:eir:crimsonReaverSweep:once": ["c57d6a0f", "6453c057", "lost:10", "d4d05c8", "be59c0ca", "cargoBay=900 ftlDrive=250 reactorCore=385 specUtility=700 weapon=380 shieldEmitters=470 hullPlating=364"],
  "patrol:worn:eir:crimsonReaverSweep:repeat": ["17e778dd", "6453c057", "relaunch:721", "302842fe", "b801119d", "16201709", "relaunch:735", "b759b37d", "7617d306", "326f519e", "won:749", "ffdca63b", "8f31a49b", "cargoBay=1000 ftlDrive=620 reactorCore=676 specUtility=1000 weapon=660 shieldEmitters=787 hullPlating=1000"],
  "patrol:worn:eir:crimsonReaverWarband:once": ["4dcced81", "6c4011ff", "lost:20", "d4d05c8", "f6918691", "cargoBay=900 ftlDrive=190 reactorCore=94 specUtility=700 weapon=130 shieldEmitters=444 hullPlating=365"],
  "patrol:worn:eir:crimsonReaverWarband:repeat": ["d6f77a3", "6c4011ff", "relaunch:721", "6273aaf", "5815f83", "550bd402", "lost:737", "7ddb5b8d", "f515e02", "cargoBay=1000 ftlDrive=940 reactorCore=959 specUtility=1000 weapon=940 shieldEmitters=850 hullPlating=844"],
  "patrol:crafted:destroyer:crimsonReaverSweep:repeat": ["ae0b336a", "6d0ea35e", "relaunch:14", "23a60cd7", "a340878", "29c0771e", "relaunch:28", "5a8529cf", "db632e6f", "a349e0b8", "won:42", "6ad9f46c", "138d2e86", "cargoBay=1000 ftlDrive=997 reactorCore=1000 specUtility=1000 weapon=993 weapon=1000 weapon=997 weapon=1000 shieldEmitters=994 hullPlating=1000"],
  "patrol:crafted:destroyer:crimsonReaverWarband:repeat": ["c852dbb4", "9d385139", "relaunch:68", "42f3bd11", "85239e18", "94b8ce5b", "lost:84", "ae7807f5", "4f191582", "cargoBay=1000 ftlDrive=974 reactorCore=958 specUtility=1000 weapon=969 weapon=954 weapon=965 weapon=965 shieldEmitters=978 hullPlating=903"],
  "patrol:crafted:battleship:crimsonReaverSweep:repeat": ["62420a20", "f1fd8c73", "relaunch:14", "4d5b338f", "b872c864", "5a720669", "relaunch:28", "1a621db7", "b9f7b6f4", "8049e39d", "won:42", "c6dba9cb", "b284ec4c", "cargoBay=1000 ftlDrive=997 reactorCore=1000 specUtility=1000 weapon=997 weapon=1000 weapon=1000 weapon=1000 weapon=1000 weapon=1000 shieldEmitters=997 hullPlating=1000"],
  "patrol:crafted:battleship:crimsonReaverWarband:repeat": ["6fe710c6", "20e5809f", "relaunch:22", "db5714af", "ff6e942c", "4c3ae770", "relaunch:44", "29e77fb", "94fe8a0f", "5deb55bd", "won:66", "c6dba9cb", "8e9a2d57", "cargoBay=1000 ftlDrive=935 reactorCore=942 specUtility=1000 weapon=954 weapon=939 weapon=924 weapon=958 weapon=946 weapon=942 shieldEmitters=951 hullPlating=939"],
  "patrol:crafted:carrier:crimsonReaverSweep:repeat": ["7f43a551", "831980ba", "relaunch:14", "31f33560", "87a09a0", "c517b89d", "relaunch:28", "64d19ca8", "5c816bf5", "14d96ce1", "won:42", "ea909677", "7c14cd5f", "cargoBay=1000 ftlDrive=990 reactorCore=988 specUtility=1000 weapon=994 weapon=986 shieldEmitters=1000 hullPlating=1000 droneBay=1000"],
  "patrol:crafted:carrier:crimsonReaverWarband:repeat": ["9c37eeab", "321d47ca", "lost:20", "72b470a8", "88f0aaae", "cargoBay=1000 ftlDrive=942 reactorCore=932 specUtility=1000 weapon=938 weapon=934 shieldEmitters=999 hullPlating=935 droneBay=899"],
  // GEAR WEAR step 5 review fix C1 (2026-11-09): the Damage Control Suite lifts this ship's repair rate off the free 2 a
  // minute, so its anchors are now encoded exactly from integers; two state hashes move, every condition holds (with
  // the old settle the pins hold, checked at the fix).
  "patrol:dc:destroyer:crimsonReaverSweep:repeat": ["4ba0fc6a", "7a88748f", "relaunch:14", "b7aca6cf", "2600f819", "d8bc78d0", "relaunch:28", "c115bf3e", "4ffbff85", "e33c3990", "won:42", "6ad9f46c", "f134ad29", "cargoBay=1000 ftlDrive=881 reactorCore=919 weapon=851 weapon=871 weapon=881 weapon=931 shieldEmitters=762 hullPlating=1000 specUtility=1000"],
  "patrol:modules:battleship:crimsonReaverSweep:repeat": ["7e7ded06", "dcbbe45d", "relaunch:14", "449a2907", "12ea7fa2", "f04f61a1", "relaunch:28", "381f2c69", "975bf0fd", "442a6cea", "won:42", "c6dba9cb", "b8064903", "cargoBay=1000 ftlDrive=920 reactorCore=968 specUtility=1000 weapon=950 weapon=950 weapon=960 weapon=950 weapon=940 weapon=960 shieldEmitters=951 hullPlating=1000 module=651 module=651"],
  "patrol:dc:destroyer:crimsonReaverWarband:repeat": ["8ec4a090", "40351818", "relaunch:169", "4be34a01", "e78441ab", "1bf51b43", "lost:185", "44b4c6b5", "e0aaf98e", "cargoBay=1000 ftlDrive=890 reactorCore=909 weapon=920 weapon=900 weapon=890 weapon=890 shieldEmitters=927 hullPlating=844 specUtility=995"],
  "patrol:modules:battleship:crimsonReaverWarband:repeat": ["353aa350", "c3504eb9", "relaunch:128", "c8f2ec08", "ca33bc97", "d69a22a4", "lost:146", "ccfe2305", "9b0994ae", "cargoBay=1000 ftlDrive=790 reactorCore=900 specUtility=1000 weapon=810 weapon=850 weapon=850 weapon=850 weapon=780 weapon=860 shieldEmitters=835 hullPlating=846 module=735 module=735"],
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
  "forecast:worn:generalFreighter:crimsonReaverSweep": ["37:dice"],
  "forecast:worn:generalFreighter:crimsonReaverWarband": ["0:impossible"],
  "forecast:worn:destroyer:crimsonReaverSweep": ["63:likely"],
  "forecast:worn:destroyer:crimsonReaverWarband": ["2:extreme"],
  "forecast:worn:battleship:crimsonReaverSweep": ["64:guaranteed"],
  "forecast:worn:battleship:crimsonReaverWarband": ["32:dice"],
  "forecast:worn:carrier:crimsonReaverSweep": ["64:guaranteed"],
  "forecast:worn:carrier:crimsonReaverWarband": ["1:extreme"],
  "forecast:worn:orion:crimsonReaverSweep": ["37:dice"],
  "forecast:worn:orion:crimsonReaverWarband": ["0:impossible"],
  "shipEvent:si:orion:cand-0:default": ["none", "628d0a82", "1/11 hull:0 setbacks:0", "766e9787"],
  "shipEvent:si:orion:cand-0:101": ["probe:win", "11dfac17", "7/12 hull:0 setbacks:1", "162cb6ef"],
  "battle:si:orion:cand-0": ["probe:0:0:win:0:c73edb09", "probe:0:1:win:0:a54e4964", "probe:0:2:win:0:eafd4a1b", "probe:1:0:win:0:7bcc3a98", "probe:1:1:win:0:66306a1b", "probe:1:2:win:0:e7c57bc", "cloakedPass:0:0:win:0:f3f52e19", "cloakedPass:0:1:win:0:ea0b90c0", "cloakedPass:0:2:win:0:78f25ccc", "cloakedPass:1:0:win:0:23e5c229", "cloakedPass:1:1:win:0:da68cc6b", "cloakedPass:1:2:win:0:97ee3209", "cloakedFail:0:0:win:0:75465c2b", "cloakedFail:0:1:win:0:10151745", "cloakedFail:0:2:win:0:ef1a7693", "cloakedFail:1:0:win:0:def175c1", "cloakedFail:1:1:loss:41:866f0aad", "cloakedFail:1:2:win:0:abad3b24"],
  "shipEvent:si:orion:cand-1:default": ["probe:win", "2d6212ca", "7/10 hull:0 setbacks:2", "cc00239b"],
  "shipEvent:si:orion:cand-1:101": ["none", "2a9661e9", "4/14 hull:0 setbacks:1", "e5c781b5"],
  "battle:si:orion:cand-1": ["probe:0:0:win:0:354c73b3", "probe:0:1:win:0:a2802e14", "probe:0:2:win:0:6e603a66", "probe:1:0:win:0:19e42699", "probe:1:1:win:0:6b557200", "probe:1:2:win:0:6aabc6c0", "cloakedPass:0:0:win:0:29c7f75f", "cloakedPass:0:1:win:0:7cb1981a", "cloakedPass:0:2:win:0:bab7d762", "cloakedPass:1:0:win:0:7d3b9788", "cloakedPass:1:1:win:0:cdaf51f3", "cloakedPass:1:2:win:0:57fbcb4f", "cloakedFail:0:0:win:0:5d26ea0a", "cloakedFail:0:1:win:0:487a4ded", "cloakedFail:0:2:loss:41:ca9eb680", "cloakedFail:1:0:win:0:a11e16c5", "cloakedFail:1:1:win:0:2570f592", "cloakedFail:1:2:win:0:25bad8a8"],
  "shipEvent:si:orion:cand-2:default": ["cloaked:loss", "db62147d", "4/6 hull:55 setbacks:2", "40bfcd41"],
  "shipEvent:si:orion:cand-2:101": ["probe:win", "12983d5c", "7/15 hull:0 setbacks:1", "425cd99f"],
  "battle:si:orion:cand-2": ["probe:0:0:win:0:80da678d", "probe:0:1:win:0:c6671e7", "probe:0:2:win:0:52a4863b", "probe:1:0:win:0:a53c01ec", "probe:1:1:win:0:6be1a795", "probe:1:2:win:0:884a0b7e", "cloakedPass:0:0:win:0:da47f12c", "cloakedPass:0:1:win:0:37a8f66c", "cloakedPass:0:2:loss:41:82500f31", "cloakedPass:1:0:win:0:18015d55", "cloakedPass:1:1:win:0:7b8bed0a", "cloakedPass:1:2:win:0:61a25f08", "cloakedFail:0:0:win:0:ac2b6517", "cloakedFail:0:1:win:0:6f54e640", "cloakedFail:0:2:win:0:3ebf5c5f", "cloakedFail:1:0:win:0:a4adee9", "cloakedFail:1:1:win:0:1ae8546c", "cloakedFail:1:2:win:0:cd8f2ab0"],
  "shipEvent:si:aurora:cand-0:default": ["none", "628d0a82", "1/11 hull:0 setbacks:0", "cabf74cc"],
  "shipEvent:si:aurora:cand-0:101": ["probe:win", "b67a9aa0", "7/12 hull:0 setbacks:1", "7fa4e9d4"],
  "battle:si:aurora:cand-0": ["probe:0:0:win:0:2fc71408", "probe:0:1:win:0:c0a4ce12", "probe:0:2:win:0:16e0bb0e", "probe:1:0:win:0:5ea89b6d", "probe:1:1:win:0:9128ec2d", "probe:1:2:win:0:d02d5d94", "cloakedPass:0:0:win:0:f3f52e19", "cloakedPass:0:1:win:0:ea0b90c0", "cloakedPass:0:2:win:0:e27d4837", "cloakedPass:1:0:win:0:23e5c229", "cloakedPass:1:1:win:0:171a1cc5", "cloakedPass:1:2:win:0:97ee3209", "cloakedFail:0:0:win:0:75465c2b", "cloakedFail:0:1:win:0:10151745", "cloakedFail:0:2:loss:36:58164d0f", "cloakedFail:1:0:win:0:def175c1", "cloakedFail:1:1:loss:36:2a7b01b7", "cloakedFail:1:2:win:0:abad3b24"],
  "shipEvent:si:aurora:cand-1:default": ["probe:win", "a71dc2bb", "7/10 hull:0 setbacks:2", "60b79b13"],
  "shipEvent:si:aurora:cand-1:101": ["none", "2a9661e9", "4/14 hull:0 setbacks:1", "5d0bb6fb"],
  "battle:si:aurora:cand-1": ["probe:0:0:win:0:7c19d5cd", "probe:0:1:win:0:cd65286e", "probe:0:2:win:0:4b6dc2c2", "probe:1:0:win:0:91f66a6e", "probe:1:1:win:0:8c71b01b", "probe:1:2:win:0:4d869495", "cloakedPass:0:0:win:0:29c7f75f", "cloakedPass:0:1:win:0:4013cf78", "cloakedPass:0:2:win:0:bab7d762", "cloakedPass:1:0:win:0:7d3b9788", "cloakedPass:1:1:win:0:cdaf51f3", "cloakedPass:1:2:win:0:57fbcb4f", "cloakedFail:0:0:win:0:5d26ea0a", "cloakedFail:0:1:win:0:487a4ded", "cloakedFail:0:2:loss:36:43a79848", "cloakedFail:1:0:win:0:a11e16c5", "cloakedFail:1:1:win:0:2570f592", "cloakedFail:1:2:win:0:25bad8a8"],
  "shipEvent:si:aurora:cand-2:default": ["cloaked:loss", "6d041903", "4/6 hull:48 setbacks:2", "f90eefc2"],
  "shipEvent:si:aurora:cand-2:101": ["probe:win", "54922d11", "7/15 hull:0 setbacks:1", "eaf3f37e"],
  "battle:si:aurora:cand-2": ["probe:0:0:win:0:c8e49412", "probe:0:1:win:0:848c3d74", "probe:0:2:win:0:7417f67", "probe:1:0:win:0:d026fa1c", "probe:1:1:win:0:1e0437c1", "probe:1:2:win:0:a9783e51", "cloakedPass:0:0:win:0:da47f12c", "cloakedPass:0:1:win:0:37a8f66c", "cloakedPass:0:2:loss:36:308ba79", "cloakedPass:1:0:win:0:18015d55", "cloakedPass:1:1:win:0:a7cbbeae", "cloakedPass:1:2:win:0:61a25f08", "cloakedFail:0:0:win:0:ac2b6517", "cloakedFail:0:1:win:0:6f54e640", "cloakedFail:0:2:win:0:3ebf5c5f", "cloakedFail:1:0:win:0:a4adee9", "cloakedFail:1:1:win:0:53381a35", "cloakedFail:1:2:win:0:82a61460"],
  "shipEvent:si:eir:cand-0:default": ["none", "628d0a82", "1/11 hull:0 setbacks:0", "4642fd1e"],
  "shipEvent:si:eir:cand-0:101": ["probe:win", "5eca61e1", "7/12 hull:0 setbacks:1", "5c329538"],
  "battle:si:eir:cand-0": ["probe:0:0:win:0:3f511ede", "probe:0:1:win:0:23d85a7", "probe:0:2:win:0:8371f4b5", "probe:1:0:win:0:5ea89b6d", "probe:1:1:win:0:221bb686", "probe:1:2:win:0:3caca283", "cloakedPass:0:0:win:0:f3f52e19", "cloakedPass:0:1:win:0:ea0b90c0", "cloakedPass:0:2:win:0:e27d4837", "cloakedPass:1:0:win:0:23e5c229", "cloakedPass:1:1:win:0:171a1cc5", "cloakedPass:1:2:win:0:97ee3209", "cloakedFail:0:0:win:0:75465c2b", "cloakedFail:0:1:win:0:10151745", "cloakedFail:0:2:loss:43:36082bed", "cloakedFail:1:0:loss:43:52840a41", "cloakedFail:1:1:loss:43:a1633160", "cloakedFail:1:2:win:0:abad3b24"],
  "shipEvent:si:eir:cand-1:default": ["probe:win", "8e05ed5e", "7/10 hull:0 setbacks:2", "cd2bf40a"],
  "shipEvent:si:eir:cand-1:101": ["none", "2a9661e9", "4/14 hull:0 setbacks:1", "b71cc994"],
  "battle:si:eir:cand-1": ["probe:0:0:win:0:e4a20ecc", "probe:0:1:win:0:39f7f515", "probe:0:2:win:0:b7fefc69", "probe:1:0:win:0:10985f99", "probe:1:1:win:0:1ff26b2c", "probe:1:2:win:0:4d869495", "cloakedPass:0:0:win:0:29c7f75f", "cloakedPass:0:1:win:0:4013cf78", "cloakedPass:0:2:win:0:bab7d762", "cloakedPass:1:0:win:0:7d3b9788", "cloakedPass:1:1:win:0:cdaf51f3", "cloakedPass:1:2:win:0:57fbcb4f", "cloakedFail:0:0:win:0:5d26ea0a", "cloakedFail:0:1:win:0:487a4ded", "cloakedFail:0:2:loss:43:4137e682", "cloakedFail:1:0:win:0:a11e16c5", "cloakedFail:1:1:win:0:2570f592", "cloakedFail:1:2:win:0:25bad8a8"],
  "shipEvent:si:eir:cand-2:default": ["cloaked:loss", "54aab9e0", "4/6 hull:57 setbacks:2", "38865a0"],
  "shipEvent:si:eir:cand-2:101": ["probe:win", "d4aa3ba0", "7/15 hull:0 setbacks:1", "a7ab598a"],
  "battle:si:eir:cand-2": ["probe:0:0:win:0:c8e49412", "probe:0:1:win:0:f10b8263", "probe:0:2:win:0:c32ccbd2", "probe:1:0:win:0:d026fa1c", "probe:1:1:win:0:3b2969ec", "probe:1:2:win:0:3a6c9baa", "cloakedPass:0:0:win:0:da47f12c", "cloakedPass:0:1:win:0:37a8f66c", "cloakedPass:0:2:loss:43:2ccb95d2", "cloakedPass:1:0:win:0:18015d55", "cloakedPass:1:1:win:0:5c68b7da", "cloakedPass:1:2:win:0:61a25f08", "cloakedFail:0:0:win:0:ac2b6517", "cloakedFail:0:1:loss:43:9d0221dc", "cloakedFail:0:2:win:0:3ebf5c5f", "cloakedFail:1:0:win:0:a4adee9", "cloakedFail:1:1:win:0:53381a35", "cloakedFail:1:2:win:0:6580e235"],
  "shipEvent:worn:orion:cand-0:default": ["none", "628d0a82", "1/11 hull:0 setbacks:0", "46a0eb83"],
  "shipEvent:worn:orion:cand-0:101": ["probe:win", "c5465d2b", "7/12 hull:0 setbacks:1", "558bb9cd"],
  "battle:worn:orion:cand-0": ["probe:0:0:win:0:29002220", "probe:0:1:win:0:6e75d192", "probe:0:2:win:0:216d0e0e", "probe:1:0:win:0:7a394001", "probe:1:1:win:0:b3493df5", "probe:1:2:win:0:d0b3b1e5", "cloakedPass:0:0:loss:41:6627090d", "cloakedPass:0:1:loss:41:7162729b", "cloakedPass:0:2:loss:41:82ace19b", "cloakedPass:1:0:loss:41:3c794b28", "cloakedPass:1:1:win:0:aa0e3743", "cloakedPass:1:2:loss:41:d031f3dc", "cloakedFail:0:0:loss:41:9f5fe7e4", "cloakedFail:0:1:loss:41:d08e0c77", "cloakedFail:0:2:loss:41:cd1c4502", "cloakedFail:1:0:loss:41:17166d66", "cloakedFail:1:1:loss:41:776ff33b", "cloakedFail:1:2:loss:41:dbca1c30"],
  "shipEvent:worn:orion:cand-1:default": ["probe:win", "9e650297", "7/10 hull:0 setbacks:2", "86a23498"],
  "shipEvent:worn:orion:cand-1:101": ["none", "2a9661e9", "4/14 hull:0 setbacks:1", "83721695"],
  "battle:worn:orion:cand-1": ["probe:0:0:win:0:d6e6e8c0", "probe:0:1:win:0:cff5cfaf", "probe:0:2:win:0:8d734313", "probe:1:0:win:0:c0dc97d2", "probe:1:1:win:0:ed9a0812", "probe:1:2:win:0:eab67e18", "cloakedPass:0:0:loss:41:b5a3aca9", "cloakedPass:0:1:loss:41:68e4ff2c", "cloakedPass:0:2:loss:41:11ca8eae", "cloakedPass:1:0:loss:41:f8d6a3ac", "cloakedPass:1:1:loss:41:87256788", "cloakedPass:1:2:loss:41:83dc59c0", "cloakedFail:0:0:loss:41:96476899", "cloakedFail:0:1:loss:41:b2977f0d", "cloakedFail:0:2:loss:41:a3cf8ba0", "cloakedFail:1:0:loss:41:58ac014b", "cloakedFail:1:1:win:0:84ac92cf", "cloakedFail:1:2:loss:41:ecd3fb33"],
  "shipEvent:worn:orion:cand-2:default": ["cloaked:loss", "ef264be3", "4/6 hull:55 setbacks:2", "1a7e130d"],
  "shipEvent:worn:orion:cand-2:101": ["probe:win", "90138ecc", "7/15 hull:0 setbacks:1", "41d09a01"],
  "battle:worn:orion:cand-2": ["probe:0:0:win:0:54027832", "probe:0:1:win:0:a24e02a3", "probe:0:2:win:0:8e2ccd09", "probe:1:0:win:0:bd823d3a", "probe:1:1:win:0:f2331a5", "probe:1:2:win:0:351a1a4b", "cloakedPass:0:0:loss:41:d673c91b", "cloakedPass:0:1:loss:41:ff596fc8", "cloakedPass:0:2:loss:41:fa3bb0b3", "cloakedPass:1:0:loss:41:3be3da07", "cloakedPass:1:1:loss:41:2db0b2fc", "cloakedPass:1:2:loss:41:99d2d206", "cloakedFail:0:0:loss:41:eae7d904", "cloakedFail:0:1:loss:41:e22f10c8", "cloakedFail:0:2:loss:41:7c5c045d", "cloakedFail:1:0:loss:41:baebdd61", "cloakedFail:1:1:loss:41:8d13ebab", "cloakedFail:1:2:loss:41:ed925e55"],
  "shipEvent:worn:aurora:cand-0:default": ["none", "628d0a82", "1/11 hull:0 setbacks:0", "4184f886"],
  "shipEvent:worn:aurora:cand-0:101": ["probe:win", "d0ad738f", "7/12 hull:0 setbacks:1", "14e15261"],
  "battle:worn:aurora:cand-0": ["probe:0:0:win:0:dd9b884c", "probe:0:1:win:0:266ba50d", "probe:0:2:win:0:d608743a", "probe:1:0:win:0:f0873f05", "probe:1:1:win:0:ef0eb23b", "probe:1:2:win:0:49ab9358", "cloakedPass:0:0:loss:36:e272efa1", "cloakedPass:0:1:loss:36:7b17dca7", "cloakedPass:0:2:loss:36:e0757821", "cloakedPass:1:0:loss:36:35156a81", "cloakedPass:1:1:win:0:aa0e3743", "cloakedPass:1:2:loss:36:a0c95e8e", "cloakedFail:0:0:loss:36:c25a27fa", "cloakedFail:0:1:loss:36:5b45fe36", "cloakedFail:0:2:loss:36:db05104c", "cloakedFail:1:0:loss:36:70f89ded", "cloakedFail:1:1:loss:36:f700e027", "cloakedFail:1:2:loss:36:202924b2"],
  "shipEvent:worn:aurora:cand-1:default": ["probe:win", "7ab4a608", "7/10 hull:0 setbacks:2", "be018d88"],
  "shipEvent:worn:aurora:cand-1:101": ["none", "2a9661e9", "4/14 hull:0 setbacks:1", "fde6ece3"],
  "battle:worn:aurora:cand-1": ["probe:0:0:win:0:2f32f667", "probe:0:1:win:0:6ec1e7c5", "probe:0:2:win:0:d5928a50", "probe:1:0:win:0:a7fc114e", "probe:1:1:win:0:3608b562", "probe:1:2:win:0:ac63191a", "cloakedPass:0:0:loss:36:36459262", "cloakedPass:0:1:loss:36:7ed4547d", "cloakedPass:0:2:loss:36:c3c01383", "cloakedPass:1:0:loss:36:461f48e9", "cloakedPass:1:1:loss:36:98917fdd", "cloakedPass:1:2:loss:36:afa101d9", "cloakedFail:0:0:loss:36:768f1819", "cloakedFail:0:1:loss:36:31b9791e", "cloakedFail:0:2:loss:36:85c97575", "cloakedFail:1:0:loss:36:92d0044e", "cloakedFail:1:1:loss:36:ee53ca3f", "cloakedFail:1:2:loss:36:12abc62c"],
  "shipEvent:worn:aurora:cand-2:default": ["cloaked:loss", "729127ba", "4/6 hull:48 setbacks:2", "2a7550ed"],
  "shipEvent:worn:aurora:cand-2:101": ["probe:win", "8fab88d0", "7/15 hull:0 setbacks:1", "b5b424a9"],
  "battle:worn:aurora:cand-2": ["probe:0:0:win:0:82464ab1", "probe:0:1:win:0:56eafbcf", "probe:0:2:win:0:63f10de", "probe:1:0:win:0:2d8d8d92", "probe:1:1:win:0:6a95caf8", "probe:1:2:win:0:f674293a", "cloakedPass:0:0:loss:36:625df2e4", "cloakedPass:0:1:loss:36:2b394f8b", "cloakedPass:0:2:loss:36:f5e866bc", "cloakedPass:1:0:loss:36:ee66bad3", "cloakedPass:1:1:loss:36:8c1273e3", "cloakedPass:1:2:loss:36:ffceb1f0", "cloakedFail:0:0:loss:36:510825ef", "cloakedFail:0:1:loss:36:36f88b86", "cloakedFail:0:2:loss:36:e29bb863", "cloakedFail:1:0:loss:36:f11ca14c", "cloakedFail:1:1:loss:36:7e35a766", "cloakedFail:1:2:loss:36:686abb6c"],
  "shipEvent:worn:eir:cand-0:default": ["none", "628d0a82", "1/11 hull:0 setbacks:0", "f8c937c0"],
  "shipEvent:worn:eir:cand-0:101": ["probe:win", "8c2c99a1", "7/12 hull:0 setbacks:1", "552fef6e"],
  "battle:worn:eir:cand-0": ["probe:0:0:win:0:c0ed5254", "probe:0:1:win:0:495092cf", "probe:0:2:win:0:cc3fb7fb", "probe:1:0:win:0:59110b04", "probe:1:1:win:0:2d1a7558", "probe:1:2:win:0:74908db2", "cloakedPass:0:0:loss:43:d1988885", "cloakedPass:0:1:loss:43:1425ab41", "cloakedPass:0:2:loss:43:7da049a3", "cloakedPass:1:0:loss:43:fd8119ee", "cloakedPass:1:1:win:0:aa0e3743", "cloakedPass:1:2:loss:43:701413c7", "cloakedFail:0:0:loss:43:72eb5017", "cloakedFail:0:1:loss:43:2d2a3cc6", "cloakedFail:0:2:loss:43:f9c535ca", "cloakedFail:1:0:loss:43:b4120a4c", "cloakedFail:1:1:loss:43:41397611", "cloakedFail:1:2:loss:43:11a634da"],
  "shipEvent:worn:eir:cand-1:default": ["probe:win", "ba7ebdc6", "7/10 hull:0 setbacks:2", "64e49a68"],
  "shipEvent:worn:eir:cand-1:101": ["none", "2a9661e9", "4/14 hull:0 setbacks:1", "8fb6c14a"],
  "battle:worn:eir:cand-1": ["probe:0:0:win:0:57b10f79", "probe:0:1:win:0:4643ceb3", "probe:0:2:win:0:1f2b4e7d", "probe:1:0:win:0:148eddf5", "probe:1:1:win:0:7a1bd5f7", "probe:1:2:win:0:23e12cd1", "cloakedPass:0:0:loss:43:8932a77c", "cloakedPass:0:1:loss:43:3e97fa77", "cloakedPass:0:2:loss:43:db74961d", "cloakedPass:1:0:loss:43:ab8237f7", "cloakedPass:1:1:loss:43:34d8c8a7", "cloakedPass:1:2:loss:43:bef802ad", "cloakedFail:0:0:loss:43:8bf6dbc2", "cloakedFail:0:1:loss:43:d5c18b1c", "cloakedFail:0:2:loss:43:f9dd88e5", "cloakedFail:1:0:loss:43:9a057fde", "cloakedFail:1:1:loss:43:18ecbdad", "cloakedFail:1:2:loss:43:8221a2fd"],
  "shipEvent:worn:eir:cand-2:default": ["cloaked:loss", "a00ac96c", "4/6 hull:57 setbacks:2", "c35b4c74"],
  "shipEvent:worn:eir:cand-2:101": ["probe:win", "28e02f41", "7/15 hull:0 setbacks:1", "1ee8e8a5"],
  "battle:worn:eir:cand-2": ["probe:0:0:win:0:a52b3873", "probe:0:1:win:0:1550b13a", "probe:0:2:win:0:84e10609", "probe:1:0:win:0:9a1ec739", "probe:1:1:win:0:d7150fe7", "probe:1:2:win:0:6306f5e1", "cloakedPass:0:0:loss:43:1c90bce3", "cloakedPass:0:1:loss:43:873bee25", "cloakedPass:0:2:loss:43:307f7b16", "cloakedPass:1:0:loss:43:ee589d39", "cloakedPass:1:1:loss:43:5d1cccf9", "cloakedPass:1:2:loss:43:4abd1fde", "cloakedFail:0:0:loss:43:35d0d7bd", "cloakedFail:0:1:loss:43:3c5c8fb2", "cloakedFail:0:2:loss:43:fa503afd", "cloakedFail:1:0:loss:43:2962042e", "cloakedFail:1:1:loss:43:864a794d", "cloakedFail:1:2:loss:43:c4fdca96"],
  "ground:si": ["ghost:pass:0,storm:pass:0,ghost:pass:0", "cbf2e30e", "3aa28993", "f87faa10", "cargoBay=1000 ftlDrive=970 reactorCore=991 specUtility=1000 weapon=1000 shieldEmitters=1000 hullPlating=1000 memberWeapon=982 memberArmor=986 memberTool=1000 implant=1000 memberWeapon=982 memberArmor=1000 memberTool=1000 implant=1000 memberWeapon=1000 memberArmor=1000 memberTool=940 implant=1000"],
  "ground:worn": ["ghost:pass:0,storm:pass:0,ghost:pass:0", "ad33b252", "1b51fd6b", "cce99a9a", "cargoBay=1000 ftlDrive=970 reactorCore=991 specUtility=1000 weapon=1000 shieldEmitters=1000 hullPlating=1000 memberWeapon=982 memberArmor=986 memberTool=1000 implant=1000 memberWeapon=982 memberArmor=1000 memberTool=1000 implant=1000 memberWeapon=1000 memberArmor=1000 memberTool=940 implant=1000"],
  "repair:dc": ["111", "fd12e611", "c621a214", "cargoBay=1000 ftlDrive=1000 reactorCore=1000 weapon=1000 weapon=1000 weapon=1000 weapon=1000 shieldEmitters=1000 hullPlating=1000 specUtility=1000"],
  "inflight:patrol:si:destroyer:crimsonReaverSweep:repeat": ["88ed10aa", "ba2ee129", "relaunch:14", "35d57735", "cd28e7d8", "e4797c1", "relaunch:28", "7337dec3", "57a71435", "9c751e83", "won:42", "6ad9f46c", "21990c5c", "cargoBay=1000 ftlDrive=930 reactorCore=926 specUtility=1000 weapon=930 weapon=930 weapon=950 weapon=960 shieldEmitters=908 hullPlating=1000"],
  "inflight:patrol:worn:destroyer:crimsonReaverSweep:repeat": ["88ed10aa", "ba2ee129", "relaunch:14", "242131b2", "f5b1a600", "990c5c5b", "relaunch:28", "6cb8523d", "bdd3e1e2", "39e59f8b", "won:42", "6ad9f46c", "2c17e9d9", "cargoBay=901 ftlDrive=461 reactorCore=453 specUtility=701 weapon=501 weapon=481 weapon=511 weapon=501 shieldEmitters=460 hullPlating=521"],
  "inflight:patrol:si:carrier:crimsonReaverWarband:repeat": ["a6257fcf", "c28deffe", "relaunch:22", "5d51819", "9145b617", "8a8e8bde", "lost:38", "73109288", "39666199", "cargoBay=1000 ftlDrive=910 reactorCore=917 specUtility=1000 weapon=900 weapon=860 shieldEmitters=850 hullPlating=844 droneBay=700"],
  "inflight:patrol:worn:orion:crimsonReaverSweep:repeat": ["d818f5a9", "f6d6af33", "relaunch:14", "7b145933", "f972e29b", "1b3bd8b1", "relaunch:1339", "461b0104", "ec1608e8", "c7770d50", "won:1353", "c75858d4", "d72e3f9d", "cargoBay=1000 ftlDrive=850 reactorCore=867 specUtility=1000 weapon=850 shieldEmitters=925 hullPlating=1000"],
};

const CAPTURE = Boolean(import.meta.env.GW4_CAPTURE);
const captured: Record<string, string[]> = {};

describe("gear wear step 4 goldens: the switch reproduces every GOLDEN_PRE row (step 4 moved nothing else)", () => {
  it("the worn variant really is worn and the crafted one crafted (vacuity guard)", () => {
    const w = equippedFor(patrolBase("carrier", "worn"), "ship-1");
    for (const slot of ["weapon", "reactorCore", "ftlDrive", "shieldEmitters", "hullPlating", "droneBay"]) {
      expect(w.some((p) => p.slotType === slot && pieceCondition(p) === WORN[slot]), slot).toBe(true);
    }
    for (const p of equippedFor(patrolBase("destroyer", "crafted"), "ship-1")) expect(p.quality, p.slotType).toBe(CRAFTED_QUALITY);
    expect(equippedFor(patrolBase("destroyer", "dc"), "ship-1").some((p) => p.moduleVariant === DAMAGE_CONTROL_SUITE_KEY)).toBe(true);
    expect(equippedFor(patrolBase("battleship", "modules"), "ship-1").filter((p) => p.slotType === "module").length).toBe(2);
    expect(Object.keys(ROWS).sort()).toEqual(Object.keys(GOLDEN_PRE).sort());
  });
  for (const [id, row] of Object.entries(ROWS)) {
    // WR-7 follow-up (OC-D5): GOLDEN_PRE also predates the favored-spec bonus (the `dc` rows' suite on a Destroyer), so it
    // is read with that switched off too.
    it.skipIf(CAPTURE)(id, () => expect(withBattleWearOff(() => withFavoredSpecOff(() => row.run(false))), id).toEqual(GOLDEN_PRE[id]));
  }
});

describe("gear wear step 4 goldens: IN FLIGHT, a run dispatched before step 4 flies on byte-identical", () => {
  for (const [id, row] of Object.entries(ROWS)) {
    if (!row.inFlight) continue;
    it.skipIf(CAPTURE)(id, () => expect(row.run(true), id).toEqual(GOLDEN_PRE[id]));
  }
});

describe("gear wear step 4 goldens: the live game (every move named in GOLDEN's header)", () => {
  for (const [id, row] of Object.entries(ROWS)) {
    it(id, () => {
      const value = row.run(false);
      if (CAPTURE) {
        captured[id] = value;
        return;
      }
      expect(value, id).toEqual(GOLDEN[id]);
    });
  }
});

// Review 2026-10-27: an IN-FLIGHT REPEAT run (dispatched before step 4, unstamped) flies its cycle exactly as before
// (its record, replay and first relaunch tick are GOLDEN_PRE's), and is stamped from its next relaunch on (pinned).
const INFLIGHT_REPEAT: [ShipTypeKey, PatrolKey, "si" | "worn"][] = [
  ["destroyer", "crimsonReaverSweep", "si"],
  ["destroyer", "crimsonReaverSweep", "worn"],
  ["carrier", "crimsonReaverWarband", "si"],
  ["orion", "crimsonReaverSweep", "worn"],
];
describe("gear wear step 4 goldens: an IN-FLIGHT Repeat run, stamped from its next relaunch", () => {
  for (const [hull, key, variant] of INFLIGHT_REPEAT) {
    const id = `patrol:${variant}:${hull}:${key}:repeat`;
    it(`inflight:${id}`, () => {
      const row = patrolRun(patrolBase(hull, variant), key, true, id, true);
      const pre = GOLDEN_PRE[id];
      expect(row.slice(0, 2), id).toEqual(pre.slice(0, 2));
      expect(row.find((x) => x.startsWith("relaunch:") || /^(won|lost):/.test(x)), id).toBe(pre.find((x) => x.startsWith("relaunch:") || /^(won|lost):/.test(x)));
      if (CAPTURE) {
        captured[`inflight:${id}`] = row;
        return;
      }
      expect(row, id).toEqual(GOLDEN[`inflight:${id}`]);
    });
  }
});

// Gear wear close-out (2026-11-11): the live game and the in-flight Repeat runs with the close-out ON (this file runs
// with it off: its pins above are the switch-off reproduction). Only the rows it moves differ from GOLDEN, each pinned in
// CLOSEOUT_ON with its cause:
//   patrol:modules:battleship:crimsonReaverWarband:repeat ("Make it exact"): its worn modules (650, anchored at
//     dispatch) entered the cycle's repair pause 22 s after their anchor; the old walk credited those 22 underway
//     seconds at the home rate (14 per-mille), so the modules ended at 722 where they read 735.
// GWCLOSE_ON_CAPTURE = an output path: write the rows that differ from GOLDEN there instead of asserting.
const CLOSEOUT_ON_CAPTURE = import.meta.env.GWCLOSE_ON_CAPTURE as string | undefined;
const CLOSEOUT_ON: Record<string, string[]> = {
  "patrol:modules:battleship:crimsonReaverWarband:repeat": ["353aa350", "c3504eb9", "relaunch:128", "dfad1e78", "f24b8aa7", "93be1bb4", "lost:146", "ccfe2305", "c300c056", "cargoBay=1000 ftlDrive=790 reactorCore=900 specUtility=1000 weapon=810 weapon=850 weapon=850 weapon=850 weapon=780 weapon=860 shieldEmitters=835 hullPlating=846 module=722 module=722"],
};
describe("gear wear close-out ON: every row is GOLDEN's but the close-out's named moves", () => {
  const moved: Record<string, string[]> = {};
  const cases: [string, () => string[]][] = [
    ...Object.entries(ROWS).map(([id, row]) => [id, () => row.run(false)] as [string, () => string[]]),
    ...INFLIGHT_REPEAT.map(([hull, key, variant]) => {
      const id = `patrol:${variant}:${hull}:${key}:repeat`;
      return [`inflight:${id}`, () => patrolRun(patrolBase(hull, variant), key, true, id, true)] as [string, () => string[]];
    }),
  ];
  for (const [id, run] of cases) {
    it.skipIf(CAPTURE)(id, () => {
      const value = withCloseoutOn(run);
      if (CLOSEOUT_ON_CAPTURE) {
        if (JSON.stringify(value) !== JSON.stringify(GOLDEN[id])) moved[id] = value;
        return;
      }
      expect(value, id).toEqual(CLOSEOUT_ON[id] ?? GOLDEN[id]);
    });
  }
  it.runIf(CLOSEOUT_ON_CAPTURE !== undefined)("writes", () => {
    writeFileSync(String(CLOSEOUT_ON_CAPTURE), JSON.stringify(moved, null, 1));
  });
});

describe.runIf(CAPTURE)("gear wear step 4 capture (GW4_CAPTURE = an output path): write the goldens there", () => {
  it("writes", () => {
    writeFileSync(String(import.meta.env.GW4_CAPTURE), JSON.stringify(captured, null, 2));
  });
});
