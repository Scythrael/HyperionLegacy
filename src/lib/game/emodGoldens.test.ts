// E-MOD EM-0 (0.14.0, plan docs/plans/2026-10-17-material-lines-and-emod-plan.md section 4 EM-0): golden hashes
// captured on the code BEFORE any power budget engine edit (the CP-0 / WR-4 / G2-0 pattern). Every later E-MOD slice
// keeps these green in the same commit, or re-pins one ONLY where its commit names the move and why, with the proof
// that zeroing the new effect reproduces the old hash.
//
//   sheet    : effectiveShipStats for every hull with EVERY slot combination the census can build (each slot either its
//              Standard Issue / empty state or a crafted piece; weapons and drone pods as a whole hardpoint set), one
//              hash per hull over all of them, plus the full crafted loadout alone and with power-efficiency crew
//              aboard (a Martian Engineering officer carrying Reactor Overdrive, a Martian Power Discipline bucket).
//   census   : every hull's maximum crafted power draw (the P1 census), read from the data, pinned as numbers.
//   patrol   : a Repeat patrol for every combat hull on both routes, with a crafted Reactor Core and shield emitters
//              and the power-efficiency crew aboard: the dispatch record, the display replay every 150 s, the state.
//              SF-4 merge (user 2026-10-21 "One step per patrol run"): the 11 rows whose run wins more than one route
//              re-pinned on their final state hash only: runCounts.patrol.completed counts the run once, not once per
//              won route (with the per-route count line restored every old value reproduces); the fight is unchanged.
//   groundOps: two Ground Ops runs (ship events live) on an Orion with the same power fixture, through claim.
//   mission  : two captain missions on a General Freighter with a crafted Reactor Core and the power crew, 700 s.
//   registry : the wiring registry snapshot (id, status, contexts, probe) and the E-MOD owned rows by name.

// The ordering determinism slice (canonicalOrder.ts: `discovered` and the lifetime tally maps kept in canonical order)
// came after every pin here: the file runs with it off (orderingSwitch.fixture.ts), so its pins keep proving their own
// slice (orderingGoldens.test.ts pins the order move and proves it moved order only).
import { canonicalOrderOffForThisFile } from "./orderingSwitch.fixture";
canonicalOrderOffForThisFile();
// Ordering determinism part 2 (canonicalOrder.ts: inventory keys and a call's completion log in one order) came after every pin here, traced order-only: the file runs with it off (ordering2Switch.fixture.ts).
import { ordering2OffForThisFile } from "./ordering2Switch.fixture";
ordering2OffForThisFile();
import { E5_2_ADDED_ENTRY_IDS, E5_4_ADDED_ENTRY_IDS } from "./refugeeRegistry.fixture";
import { describe, expect, it } from "vitest";
// WR-8b (enemy torpedoes) came after every pin here: the file runs with it off (enemyTorpedoSwitch.fixture.ts), so its
// pins keep proving their own slice (enemyTorpedoGoldens.test.ts pins what WR-8b moved, enemyTorpedoes.test.ts proves it).
import { enemyTorpedoesOffForThisFile } from "./enemyTorpedoSwitch.fixture";
enemyTorpedoesOffForThisFile();
import { gw5ReadBack } from "./gearWearStep5Registry.fixture"; // Gear wear step 5: its deleted and flipped rows read back, innermost
import { otUiReadBack } from "./otUiRegistry.fixture"; // OT-UI: the Overtime row restated, read back innermost
// Wiring WR-10 (the away rules stamped at dispatch, a hire's account program) came after every pin here: the whole file
// runs with WR-10 off (wr10Switch.fixture.ts), so its pins keep proving their own slice (wr10Goldens.test.ts pins WR-10's).
import { wr10OffForThisFile } from "./wr10Switch.fixture";
wr10OffForThisFile();
import { cp16OffForThisFile } from "./cp16Switch.fixture";
// Complement CP-19: this file's pins predate the Personnel Rosters track (a new game's facility map gains its
// pre-granted Level 1), so it runs with the slice off; cp19Goldens.test.ts pins the slice itself.
import { cp19OffForThisFile } from "./cp19Switch.fixture";
cp19OffForThisFile();
// Complement CP-16 (the Hall of Command) came after every pin here: the file runs with the slice off, so its pins
// keep proving their own slice (cp16Goldens.test.ts pins what CP-16 moved: the missions counter, the notables and
// the Hall of Command entry).
cp16OffForThisFile();
import { cp14OffForThisFile } from "./cp14Switch.fixture";
// Complement CP-14 (hull base sensors and Science amplification) came after every pin here: the file runs with the
// slice off, so its pins keep proving their own slice (cp14Goldens.test.ts pins what CP-14 moved).
cp14OffForThisFile();
import { cp13OffForThisFile } from "./cp13Switch.fixture";
// Complement CP-13 (hull-family module bonuses) came after every pin here: the file runs with the bonus off, so its pins
// keep proving their own slice (cp13Goldens.test.ts pins what CP-13 moved).
cp13OffForThisFile();
import { cp13ReadBack } from "./cp13Registry.fixture"; // Complement CP-13: its added rows read back, innermost
import { cp14ReadBack } from "./cp14Registry.fixture"; // Complement CP-14: its added, flipped and moved rows read back, innermost
import { cp16ReadBack } from "./cp16Registry.fixture"; // Complement CP-16: its added Hall of Command rows read back, innermost
import { cp18ReadBack } from "./cp18Registry.fixture";
import { cp19ReadBack } from "./cp19Registry.fixture";
// Material Lines ML-5: its two added audit rows held apart (ml5Goldens.test.ts pins the slice).
import { ml5ReadBack } from "./ml5Registry.fixture";
// Wiring WR-10 flipped twelve away rows after every pin here (wr10Registry.fixture.ts): read back innermost.
import { wr10ReadBack } from "./wr10Registry.fixture";
import { wr13ReadBack } from "./wr13Registry.fixture";
// WR-8b (enemy torpedoes) came after these pins: its registry rows are read back innermost.
import { wr8bReadBack } from "./wr8bRegistry.fixture";
// Wiring OC-G1 (the legacy expedition path deleted) came after these pins: its registry read-back applies innermost.
import { ocg1ReadBack } from "./ocg1Registry.fixture";
// Complement CP-4's rest (the Flight Deck's Integrity on replenish) added one audit row after every pin here: read back innermost.
import { cp4FdReadBack } from "./cp4FlightDeckRegistry.fixture";
import { g29ReadBack } from "./g29Registry.fixture";
import { hullCrewCapsOffForThisFile } from "./hullCrewCapsSwitch.fixture";
// Complement plan CP-5 (per-hull crew caps): every pin here predates CP-5 and is about another slice, so the file runs
// with the per-hull caps off (hullCrewCapsSwitch.fixture.ts); cp5Goldens.test.ts pins what CP-5 moved.
hullCrewCapsOffForThisFile();
// GEAR WEAR step 3: this file's pins were captured before the use wear engine; it runs with the use sources off
// (gearWearSwitch.fixture.ts), so they keep proving nothing else moved. gearWearGoldens.test.ts pins the wear.
import { gearWearOffInThisFile } from "./gearWearSwitch.fixture";
import { gw3RegistryBack } from "./gearWearRegistry.fixture";
// Gear wear step 4 came after every pin here: its registry move is read back first (gearWearCombatRegistry.fixture.ts).
import { gw4ReadBack } from "./gearWearCombatRegistry.fixture";
import { patrolLegsOffForThisFile } from "./patrolLegsSwitch.fixture";

// WR-7 follow-up OC-D8 (patrol legs scale with transit speed): every pin here predates the legs and is about E-MOD;
// with the legs off each one returns (checked when the legs were wired), so the file runs with them off and keeps
// proving its own slice. patrolLegsGoldens.test.ts pins the legs on every patrol and every combat hull.
patrolLegsOffForThisFile();
gearWearOffInThisFile();
import Decimal from "break_infinity.js";
import {
  EQUIPMENT_SLOTS,
  SHIP_TYPES,
  SLOT_BASE_PHYSICALS,
  freshState,
  type AwayMember,
  type CrewBucket,
  type EquipmentInstance,
  type EquipmentSlotType,
  type GameState,
  type MissionKey,
  type PatrolKey,
  type PatrolMissionState,
  type ShipTypeKey,
} from "./model";
import { dispatchCaptainOnMission, dispatchCaptainOnPatrol, economyTick, installMissingCombatBaselines } from "./tick";
import { replayPatrol } from "./combat/patrolReplay";
import { WEAPON_DEFS } from "./combat/weapons";
import { DRONE_POD_BASE_POWER_DRAW, generateDronePod, generateEquipment, generateWeapon } from "./itemgen";
import { effectiveShipStats } from "./crewOverlay";
import { advanceExpedition, claimExpedition, expeditionCandidates } from "./expedition";
import { shipEventsLive } from "./shipScanEvents";
import { asPreVoyageDispatch, plainAwayMember, withSlottedAwayTeams, dispatchPastPropulsion, asPrePatrolCurveDispatch } from "./awayTeamTestFixtures";
import { FKR8_ADDED_IDS, FKR8_FLIPPED_LIVE, WIRING_REGISTRY, type WiringEntry } from "./wiring/registry";
// E-MOD EM-7 came after every pin here: its added rows are left out and its moduleSlots flip read back first.
import { em7ReadBack } from "./emodEm7Registry.fixture";
// WR-8: every registry pin here was taken before WR-8, so its added entries are left out and its flips read back.
import { wr8ReadBack } from "./combatDescriptorRegistry.fixture";
import { siReadBack } from "./siMemberGearRegistry.fixture";
import { getSeniorStaffBonusById } from "./seniorStaffBonuses";
import { withEm1Off } from "./emodEm1Switch.fixture";
import { goldenJson, withV1Museum } from "./firstRunsGoldens.fixture"; // gear wear: goldenJson puts the retired durability back
import { GG1_ADDED_ENTRY_IDS, GG_STUDY_ADDED_ENTRY_IDS, GG_STUDY_FLIPPED_BEFORE } from "./gasStudyGoldens.fixture";
import { FUSE_ADDED_ENTRY_IDS } from "./fieldKitsFuse.fixture";
import { RX_ADDED_ENTRY_IDS } from "./reactorFuelGoldens.fixture";
// Rarity readiness RR-3 and up: the added RARITY_PROFILES (and later rarity) entries, held apart like RX_ADDED_ENTRY_IDS.
import { RR_ADDED_ENTRY_IDS } from "./rarityRegistry.fixture";
import { OC15_ADDED_ENTRY_IDS } from "./labFabricatorTiers.fixture";
// ML-2 (the Material Lines recipe rework + the recipe realism audit): its registry move, read back by ml2RowsBack.
import { ml2RowsBack } from "./ml2RecipeGoldens.fixture";
// E-MOD EM-5 (the module slot): its registry move, read back by em5ReadBack.
import { em5ReadBack } from "./emodEm5Registry.fixture";
// E-MOD EM-3 came after every pin here: its two added rows are left out (emodEm3Registry.fixture.ts em3ReadBack; its
// flipped row, ship:wr8:powerInCombat, is a WR-8 addition wr8ReadBack already leaves out).
import { em3ReadBack } from "./emodEm3Registry.fixture";
// E-MOD EM-4 came after every pin here too: its added row is left out and its flipped row read back (em4ReadBack), and
// the file runs with the reactor surplus drive lift off (reactorLiftOffForThisFile): the sheets and missions here fly
// a crafted Reactor Core, so the lift moves them by design (emodEm4Goldens.test.ts pins it); off, every pin holds.
import { em4ReadBack } from "./emodEm4Registry.fixture";
import { reactorLiftOffForThisFile } from "./emodEm4Switch.fixture";
reactorLiftOffForThisFile();
import { R2_2_ADDED_ENTRY_IDS } from "./relicBlanks.fixture";
import { R2_10_ADDED_ENTRY_IDS } from "./relicMinigame.fixture"; // R2-10: its 17 minigame audit rows, held apart the same way
import { R2_3_ADDED_ENTRY_IDS } from "./relicIdentify.fixture"; // R2-3: its three audit rows, held apart the same way
import { R2_4_ADDED_ENTRY_IDS, R2_4_FLIPPED_BEFORE } from "./relicMuseumV2.fixture"; // R2-4: its additions held apart, its flips read back
import { G2_4_ADDED_ENTRY_IDS, G2_4_FLIPPED_BEFORE } from "./propulsionRecallGoldens.fixture";
import { G2_6_ADDED_ENTRY_IDS, G2_6_FLIPPED_BEFORE } from "./expeditionConsoleRegistry.fixture";
// ML-3 (Material Lines: material quality on delivery, OC-D2): its registry move, read back by ml3RowsBack.
import { ml3RowsBack } from "./materialQualityGoldens.fixture";
// WR-8 (0.14.0): every pin in this file was taken before the combat rules (combatRulesSwitch.fixture.ts), so the file
// runs with them switched off and its pins keep proving WR-8 moved nothing else here (the rules stamp new patrol
// cycles and runs; combatDescriptorGoldens.test.ts pins the combat rules themselves).
import { combatRulesOffForThisFile } from "./combatRulesSwitch.fixture";
combatRulesOffForThisFile();
// WR-7 follow-up OC-D5 (favorsSpec, "+10% on its ship type"): after every pin here too. Its one registry flip is read
// back (favorsSpecReadBack) and the file runs with the bonus off: the census and crafted sheets install favored pieces
// on hulls of their spec, which it moves by design (favorsSpecGoldens.test.ts and wr7Goldens.test.ts pin it).
import { favorsSpecReadBack } from "./favoredSpecRegistry.fixture";
// WR-7 follow-up OC-D8 (patrol legs), after every pin here: the transit sources' patrol context flipped live and its
// audit row added (patrolLegsRegistry.fixture.ts), read back in the registry chain.
import { patrolLegsReadBack } from "./patrolLegsRegistry.fixture";
// The OC-D8 follow-up (Fast Departure / Fast Return on patrols), after every pin here: its two audit rows added
// (patrolLegLiftsRegistry.fixture.ts), read back in the registry chain.
import { patrolLegLiftsReadBack } from "./patrolLegLiftsRegistry.fixture";
// Complement plan CP-3 came after every pin here: its six flips and one added audit row are read back (cp3Registry.fixture.ts).
import { cp3ReadBack } from "./cp3Registry.fixture";
// Wiring WR-11 came after every registry pin here: its flips, added and removed rows are read back (wr11Registry.fixture.ts).
import { wr11ReadBack } from "./wr11Registry.fixture";
import { wr9ReadBack } from "./wr9Registry.fixture";
import { cp5ReadBack } from "./cp5Registry.fixture"; // CP-5: its registry move read back (cp5Registry.fixture.ts)
import { sf7ReadBack } from "./sf7Registry.fixture"; // Safe first runs SF-7: its registry move read back (sf7Registry.fixture.ts)
import { cp11ReadBack } from "./cp11Registry.fixture"; // Complement CP-11: its registry move read back (cp11Registry.fixture.ts)
import { cp12ReadBack } from "./cp12Registry.fixture"; // Complement CP-12: the obtainable row's flip read back, innermost
// E-MOD EM-8 came after every registry pin here: its added rows, the Precursor Lens relic flip and the dropped Precursor
// Circuit reserve are read back (emodEm8Registry.fixture.ts).
import { em8ReadBack } from "./emodEm8Registry.fixture";
import { favoredSpecOffForThisFile } from "./favoredSpecSwitch.fixture";
favoredSpecOffForThisFile();
// Wiring WR-11 came after every pin here: the whole file runs with WR-11 off (wr11Switch.fixture.ts), so its pins keep
// proving their own slice moved nothing else (WR-11's own moves are pinned in wr11Goldens.test.ts).
wr11OffForThisFile();
// The crewHours determinism fix (2026-10-30): this file's pins predate it and are about another slice, so the whole
// file runs with the float crewHours counter (crewHoursSwitch.fixture.ts; crewHoursMs.test.ts traces the move).
import { crewHoursFloatForThisFile } from "./crewHoursSwitch.fixture";
import { wr11OffForThisFile } from "./wr11Switch.fixture";
crewHoursFloatForThisFile();

// ===== shared helpers =====

function fnv(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16);
}

// Relics v2 R2-1 (merged after EM-0's capture): whole states hash with the Museum v2 record in its v1 form
// (withV1Museum, the feat precedent), as EM-0 captured them.
const hash = (v: unknown): string => fnv(goldenJson(withV1Museum(v)));

function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function seededRng(seed: number): () => number {
  let x = seed >>> 0;
  return () => {
    x = (Math.imul(x ^ (x >>> 15), 0x2c1b3c6d) ^ 0x9e3779b9) >>> 0;
    return (x >>> 8) / (1 << 24);
  };
}

const HULLS = Object.keys(SHIP_TYPES) as ShipTypeKey[];
const SHIP = "ship-1";

// The single slots a crafted piece can fill, in a fixed order (each one bit of the slot combination).
const SINGLE_SLOTS = ["cargoBay", "ftlDrive", "reactorCore", "specUtility", "shieldEmitters", "hullPlating", "bridge", "quarters", "sensor"] as const;
type SingleSlot = (typeof SINGLE_SLOTS)[number];

// The variety a crafted piece of `slot` takes on `hull`: the first one the hull may install (a specUtility variety
// carries its own hull gate, else the slot's). null when the hull can install none (a General Freighter's utility).
function varietyFor(slot: SingleSlot, hull: ShipTypeKey): string | null {
  const def = EQUIPMENT_SLOTS[slot];
  const spec = SHIP_TYPES[hull].spec;
  const ok = def.varieties.find((v) => {
    const req = v.equipRequirement ?? def.equipRequirement;
    return req?.hullSpec === undefined || req.hullSpec === spec;
  });
  return ok ? ok.key : null;
}

// The single slots `hull` can carry a crafted piece in.
function slotsFor(hull: ShipTypeKey): SingleSlot[] {
  return SINGLE_SLOTS.filter((slot) => varietyFor(slot, hull) !== null);
}

function craftedPiece(slot: SingleSlot, hull: ShipTypeKey, n: number): EquipmentInstance {
  const piece = generateEquipment({
    slotType: slot as EquipmentSlotType,
    varietyKey: varietyFor(slot, hull)!,
    blueprintKey: null,
    iLevel: 20,
    quality: 2,
    rarity: "augmented",
    ascension: "none",
    rng: seededRng(0x51a7 + n * 7919),
    allocateId: () => `emod-${slot}`,
  });
  return { ...piece, fittedToShipId: SHIP };
}

// The heaviest-draw weapon (the census reads the same def).
const HEAVY_WEAPON = (Object.keys(WEAPON_DEFS) as (keyof typeof WEAPON_DEFS)[]).reduce((a, b) => (WEAPON_DEFS[b].powerDraw > WEAPON_DEFS[a].powerDraw ? b : a));

function craftedWeapons(hull: ShipTypeKey): EquipmentInstance[] {
  return Array.from({ length: SHIP_TYPES[hull].weaponHardpoints }, (_, i) => ({
    ...generateWeapon({
      weaponType: HEAVY_WEAPON,
      blueprintKey: null,
      iLevel: 20,
      quality: 2,
      rarity: "augmented",
      ascension: "none",
      rng: seededRng(0xa11 + i),
      allocateId: () => `emod-weapon-${i}`,
    }),
    fittedToShipId: SHIP,
  }));
}

function craftedPods(hull: ShipTypeKey): EquipmentInstance[] {
  return Array.from({ length: SHIP_TYPES[hull].droneBays ?? 0 }, (_, i) => ({
    ...generateDronePod({
      droneRole: i % 2 === 0 ? "attack" : "defense",
      blueprintKey: null,
      iLevel: 20,
      quality: 2,
      rarity: "augmented",
      ascension: "none",
      rng: seededRng(0xb22 + i),
      allocateId: () => `emod-pod-${i}`,
    }),
    fittedToShipId: SHIP,
  }));
}

// ship-1 re-hulled to `hull` with its Standard Issue economy and combat gear.
function hullState(hull: ShipTypeKey): GameState {
  const base = freshState();
  return installMissingCombatBaselines({ ...base, credits: new Decimal(1_000_000), ships: base.ships.map((sh) => (sh.id === SHIP ? { ...sh, typeKey: hull } : sh)) });
}

// Replace ship-1's pieces in `slots` with crafted ones; `weapons` / `pods` swap the whole hardpoint / bay set.
function withCrafted(s: GameState, hull: ShipTypeKey, slots: readonly SingleSlot[], weapons: boolean, pods: boolean): GameState {
  const drop = new Set<string>([...slots, ...(weapons ? ["weapon"] : []), ...(pods ? ["droneBay"] : [])]);
  const kept = s.equipment.filter((e) => !(e.fittedToShipId === SHIP && drop.has(e.slotType)));
  const added = [
    ...slots.map((slot) => craftedPiece(slot, hull, SINGLE_SLOTS.indexOf(slot))),
    ...(weapons ? craftedWeapons(hull) : []),
    ...(pods ? craftedPods(hull) : []),
  ];
  return { ...s, equipment: [...kept, ...added] };
}

// The power-efficiency crew: a Martian Engineering officer carrying Reactor Overdrive, and a Martian Engineering
// bucket carrying Power Discipline (both key crew.powerEfficiency).
const POWER_BUCKET: CrewBucket = { profession: "engineering", rarity: "standard", rank: 1, race: "martian", buff1Id: "eng.power", buff2Id: null, count: 20 };
function withPowerCrew(s: GameState): GameState {
  const officer = {
    id: "emod-officer",
    seat: "engineering" as const,
    name: "EM Engineer",
    race: "martian" as const,
    gender: "nonbinary" as const,
    rank: "ensign" as const,
    bonuses: [
      // Read off the catalog at call time, so the EM-1 switch (withEm1Off) can turn it off too.
      { id: "eng.overdrive", magnitude: getSeniorStaffBonusById("eng.overdrive")!.magnitude },
      { id: "test.none", magnitude: 0 },
    ] as [{ id: string; magnitude: number }, { id: string; magnitude: number }],
    missionsCompleted: 0,
    assignedShipId: SHIP,
  };
  return {
    ...s,
    officers: [...s.officers, officer],
    ships: s.ships.map((sh) => (sh.id === SHIP ? { ...sh, complement: { mode: "active" as const, buckets: [POWER_BUCKET] } } : sh)),
  };
}

const sheetOf = (s: GameState) => effectiveShipStats(s, s.ships.find((sh) => sh.id === SHIP)!);

// Every slot combination for `hull`: bit i of the mask crafts slot i; the two top bits craft the weapon set and the
// pod set (the pod bit only on a hull with bays). One hash over every combination's sheet, in mask order.
function combinationsHash(hull: ShipTypeKey): { hash: string; count: number } {
  const slots = slotsFor(hull);
  const bays = (SHIP_TYPES[hull].droneBays ?? 0) > 0;
  const bits = slots.length + 1 + (bays ? 1 : 0);
  const base = hullState(hull);
  const parts: string[] = [];
  for (let mask = 0; mask < 1 << bits; mask++) {
    const chosen = slots.filter((_, i) => (mask & (1 << i)) !== 0);
    const weapons = (mask & (1 << slots.length)) !== 0;
    const pods = bays && (mask & (1 << (slots.length + 1))) !== 0;
    parts.push(hash(sheetOf(withCrafted(base, hull, chosen, weapons, pods))));
  }
  return { hash: fnv(parts.join("|")), count: parts.length };
}

function fullLoadout(hull: ShipTypeKey): GameState {
  return withCrafted(hullState(hull), hull, slotsFor(hull), true, (SHIP_TYPES[hull].droneBays ?? 0) > 0);
}

// The P1 census: the most a crafted loadout can draw on `hull`, from the data (a rolled powerDrawReduction only ever
// lowers a piece's draw, itemgen.ts generateEquipment). Every single slot the hull can install, every hardpoint at the
// heaviest weapon, every bay at a drone pod.
function maxCraftedDraw(hull: ShipTypeKey): number {
  const singles = slotsFor(hull).reduce((sum, slot) => sum + SLOT_BASE_PHYSICALS[slot].powerDraw, 0);
  return singles + SHIP_TYPES[hull].weaponHardpoints * WEAPON_DEFS[HEAVY_WEAPON].powerDraw + (SHIP_TYPES[hull].droneBays ?? 0) * DRONE_POD_BASE_POWER_DRAW;
}

// The patrol / mission / Ground Ops power fixture: a crafted Reactor Core and shield emitters (a real draw) with the
// power-efficiency crew aboard, on top of the hull's Standard Issue.
function powerFixture(hull: ShipTypeKey): GameState {
  return withPowerCrew(withCrafted(hullState(hull), hull, ["reactorCore", "shieldEmitters"], false, false));
}

const ROUTES: PatrolKey[] = ["crimsonReaverSweep", "crimsonReaverWarband"];

function patrolRun(hull: ShipTypeKey, route: PatrolKey): string[] {
  const st = powerFixture(hull);
  const r = asPrePatrolCurveDispatch(dispatchCaptainOnPatrol(st, 1, route, "balanced", true));
  if (!r.success) return [`refused:${r.reason}`];
  let s = r.next;
  const out = [hash(s.captains[0].mission)];
  for (let i = 0; i < 600; i++) {
    s = economyTick(s, 1, () => 0.5);
    const m = s.captains[0].mission as PatrolMissionState | null;
    if (m === null) break;
    if (i % 150 === 0) out.push(hash(replayPatrol(s, s.captains[0])));
  }
  out.push(hash(s));
  return out;
}

const member = (id: string, teamType: AwayMember["teamType"], over: Partial<AwayMember> = {}): AwayMember => ({
  ...plainAwayMember(id, teamType, SHIP),
  ...over,
});
const SQUAD: AwayMember[] = [member("member-1", "security", { rank: 3 }), member("member-2", "security", { rank: 2, traits: ["fieldMedic"] }), member("member-11", "science")];

function groundOpsRun(seed: number): string[] {
  const s0 = powerFixture("orion");
  const s = withSlottedAwayTeams({ ...s0, awayMembers: SQUAD.map((m) => ({ ...m })), nextAwayMemberId: 100, expeditionSeed: seed });
  // G2-3 (merged after EM-0's capture): the run as dispatched before the voyage engine (asPreVoyageDispatch, the feat
  // precedent), so it flies the fixed legs EM-0 pinned.
  const res = asPreVoyageDispatch(dispatchPastPropulsion(s, SHIP, 1, expeditionCandidates(s, SHIP)[0].id));
  if (!res.success || !res.expedition) throw new Error(`dispatch refused: ${res.reason}`);
  const exp = res.expedition;
  expect(shipEventsLive(exp)).toBe(true);
  const done = advanceExpedition(exp, 2_000_000);
  expect(done.phase).toBe("complete");
  const claim = claimExpedition({ ...res.next, expeditions: [done] }, done.id);
  expect(claim.success).toBe(true);
  return [hash(exp), hash(done), hash(claim.next)];
}

function missionRun(key: MissionKey): string {
  const base = powerFixture("generalFreighter");
  const st: GameState = { ...base, captains: base.captains.map((c) => ({ ...c, level: 10 })) };
  const r = dispatchCaptainOnMission(st, 1, key);
  expect(r.success, key).toBe(true);
  let s = r.next;
  const rng = lcg(0xe40d);
  for (let i = 0; i < 700; i++) s = economyTick(s, 1, rng);
  return hash(s);
}

// ===== the goldens =====

// Captured on a9caa06 (feat/crew-0.14.0) by EM-0, before any engine edit; the moves since are named per pin. The
// patrol, Ground Ops and mission pins have never moved: EM-1 adds no install gate and no combat penalty (after the merge
// of feat 922025e they hash whole states through withV1Museum and dispatch the Ground Ops runs through
// asPreVoyageDispatch, the feat precedents for R2-1 and G2-3, and every one reproduces its EM-0 capture).
const GOLDEN: Record<string, unknown> = {
  // Re-pinned by EM-1: every sheet's powerOutput gains the hull's basePowerOutput (P1); with the EM-1 switch on
  // (withEm1Off) every hull reproduces its EM-0 capture (EM0 below).
  sheetCombinations: [
    "generalFreighter:512:904c45b5",
    "prospectorHauler:1024:81ebe43f",
    "prospectorRunner:1024:a0912d83",
    "prospectorMiner:1024:d5857b1b",
    "destroyer:1024:1c5ccd2f",
    "battleship:1024:c0787e3",
    "carrier:2048:bf1e8323",
    "orion:1024:3ed9843",
    "aurora:1024:2d6c4713",
    "eir:1024:9ff23953",
  ],
  // Re-pinned by EM-1: the hull's base output (both halves) and, in the second half, the power crew's net-draw cut
  // (P4); with the switch on both halves reproduce EM0, so the two moves are the only ones.
  sheetFull: [
    "generalFreighter:3c8399b8/1545f1aa",
    "prospectorHauler:e1815faf/ab7e11a9",
    "prospectorRunner:1a732802/4f3b9348",
    "prospectorMiner:54d53d3a/b5b2d90",
    "destroyer:4c700df6/86a39c4d",
    "battleship:ae047abb/593b8b64",
    "carrier:7609bcb7/4e0c6a1d",
    "orion:a683d1f5/9e8563ff",
    "aurora:6ddeac9d/9200677",
    "eir:c9782ab/ed133541",
  ],
  census: {
    generalFreighter: 83,
    prospectorHauler: 85,
    prospectorRunner: 50,
    prospectorMiner: 50,
    destroyer: 155,
    battleship: 225,
    carrier: 105,
    orion: 50,
    aurora: 50,
    eir: 50,
  },
  "patrol:generalFreighter:crimsonReaverSweep": ["a22d953b", "ba66dffe", "723e2602", "130098be", "fe6ef38e", "8c911439"],
  "patrol:generalFreighter:crimsonReaverWarband": ["14716665", "c216a930", "959196a4"],
  "patrol:prospectorHauler:crimsonReaverSweep": ["f395dca2", "bfabeeb8", "8b244bb5", "d641c52e", "16232dd", "3d913738"],
  "patrol:prospectorHauler:crimsonReaverWarband": ["f7018a80", "60d4aba5", "19676b4e"],
  "patrol:prospectorRunner:crimsonReaverSweep": ["35304b07", "2185d719", "e93e9b51", "16da2dca"],
  "patrol:prospectorRunner:crimsonReaverWarband": ["bb3f0839", "9f18867c", "f7534b8d"],
  "patrol:prospectorMiner:crimsonReaverSweep": ["2c976c41", "a16c6fd", "a9e1b6aa", "14280689"],
  "patrol:prospectorMiner:crimsonReaverWarband": ["20145f43", "1f247c82", "45787ec6"],
  "patrol:destroyer:crimsonReaverSweep": ["e212a0f4", "9586b518", "1da1ff6e", "1e78b5f3", "f64053de", "1c053e74"],
  "patrol:destroyer:crimsonReaverWarband": ["29d6046", "901bc214", "afddc656"],
  "patrol:battleship:crimsonReaverSweep": ["7db855f4", "58f7ae81", "9068de5", "1acf4ae0", "89a5cba7", "c556c22d"],
  "patrol:battleship:crimsonReaverWarband": ["3ec73e1a", "4adb9662", "e0d1ba43"],
  "patrol:carrier:crimsonReaverSweep": ["50c62cd6", "dcbc2dd1", "5cc81f0d", "3ce28abd", "858014be", "a4078401"],
  "patrol:carrier:crimsonReaverWarband": ["a0e384dc", "178481b4", "825e9b88"],
  "patrol:orion:crimsonReaverSweep": ["8e12b325", "8d98a86d", "4135379", "79f76d3", "c2ad0786", "f7e3cd8"],
  "patrol:orion:crimsonReaverWarband": ["97101bc3", "5aaf9652", "f67ce1b7"],
  "patrol:aurora:crimsonReaverSweep": ["79bb80eb", "7c45f89b", "8bfce8d8", "bb93abd5", "ae0c7bb", "70663bff"],
  "patrol:aurora:crimsonReaverWarband": ["d2b521ad", "1a87d5fa", "b86390f6"],
  "patrol:eir:crimsonReaverSweep": ["6d0d415d", "9c5d8a38", "4a803c6e", "3122d103", "2c2b4c4a", "825368c7"],
  "patrol:eir:crimsonReaverWarband": ["746ba2fb", "38710db5", "4ca7b65c"],
  "groundOps:1234": ["5faadba9", "1aaa13e8", "69d85c9f"],
  "groundOps:5678": ["4e315ea2", "aac5113b", "9ca2d437"],
  "mission:shortOreRun": "f067d369",
  "mission:surveyMineralAnomaly": "ccae3eb9",
  // EM-1: the full crafted loadout's power output / draw / draw with the power crew aboard (the crafted Reactor Core
  // supplies 32 on top of the hull's own; the crew's 0.2 efficiency cuts the draw by about 13%).
  power: [
    "generalFreighter:133/82/71",
    "prospectorHauler:133/84/73",
    "prospectorRunner:98/49/43",
    "prospectorMiner:98/49/43",
    "destroyer:208/154/133",
    "battleship:278/224/193",
    "carrier:158/104/90",
    "orion:178/49/43",
    "aurora:198/49/43",
    "eir:168/49/43",
  ],
  // Re-pinned by EM-1: Reactor Overdrive, Power Discipline, the Martian racial, the powerOutput and powerDrawReduction
  // lines and the slot and weapon draw rows went live, every hull's basePowerOutput joined, the drive class draw seam
  // joined, the reactor surplus row is owned by EM-4 and the division wings no longer name E-MOD (EM-0: eb2a0c07, with
  // 13 E-MOD rows). The two rows left naming E-MOD: the Precursor Lens module (EM-8) and the reactor surplus (EM-4).
  // Re-pinned again at the merge of feat 922025e (EM-1 aea24b6b): FKR-5, G2-3 and R2-1 added their entries (the
  // G1-0 golden 5 in shortRangeGoldens.test.ts proves each slice is its only cause); the E-MOD rows did not change.
  // Re-pinned at the merge into the ML-1 branch (452c9676): Material Lines ML-1 added 14 entries (its seven Refinery
  // recipes, pending while hidden, and its seven typed reserves); with them left out the snapshot reproduces
  // 452c9676 (asserted below, ML1_ENTRY_IDS), so they are the only cause; the E-MOD rows did not change.
  // Re-pinned at the merge into the FKR-6 branch (c1260fe0 -> 30489b98), two causes, each read back below: G1-3 (merged
  // after the ML-1 re-pin without moving it: feat a2a1b6a reads a488ee24) re-owned the facility:audit:missionControlUnlock
  // row, and Field Kits FKR-6 added 5 entries and flipped 8 pending -> live. With FKR-6 read back (FKR6_BEFORE) the
  // snapshot is a488ee24, and with the G1-3 row's old owner too it is c1260fe0; the E-MOD rows did not change.
  // Re-pinned by the inert racials (0.14.0, 30489b98 -> b5c9178b): eight entries went live with their probes and
  // contexts (Deck Handling, Survey Aptitude, the Belter, Vael, Outer-Colony and Spacer racials, the Science and Flight
  // Deck wings), the four still-pending Ground Ops crew keys and the Security and Medical wings name their owner CP-3
  // (was "E-CREW Task 23" / "CP-3, CP-4"), and one audit row joins (the Spacer long-haul ramp, deferred). Read back
  // (RACIALS_BEFORE, RACIALS_ADDED_IDS) the snapshot is 30489b98, and every earlier read-back holds; the E-MOD rows hold.
  // Re-pinned by G1-4 on its own branch (30489b98 -> 80e62647): the short-range cycle engine flipped the six guest
  // quarters sources and the 21 template fields live at mission:shortRange, added
  // captain:SECONDARY_CAPTAIN_TALENTS:trade2:shortRange, and gave 17 mission-claim entries the mission:shortRange
  // context; read back (g14Back) the snapshot is 30489b98.
  // Re-pinned at the merge of G1-4 into feat (b5c9178b / 80e62647 -> c844bd4): the two moves together, nothing else.
  // Re-pinned by Field Kits FKR-7 on its own branch (30489b98 -> 3c94e7d1): it added 2 entries, flipped 8 pending -> live
  // and re-owned the hidden pieces row (FKR-9 / FKR-10); with those read back (FKR7_BEFORE) the snapshot is 30489b98.
  // Re-pinned at the merge of FKR-7 into feat (c844bd4 / 3c94e7d1 -> 60d00075): the three moves together, nothing else.
  // Reading back every slice but one reproduces that slice's own pin (b5c9178b, 80e62647, 3c94e7d1), reading back
  // FKR-7 alone reproduces c844bd4, and reading back all three reproduces 30489b98 (asserted below).
  // Re-pinned by Field Kits FKR-9 / FKR-10, the switch-on (60d00075 -> 9deacec7): FIELD_KITS_PLAYER_LIVE brings back
  // FKR-5's three hidden entries (the Impact Grenade blueprint, the Stun and Toxin carry lines) and the hidden pieces and
  // runs switch audit rows go live with their probes and contexts; read back (FKR9_SHOWN_IDS, FKR9_BEFORE) the snapshot is
  // 60d00075, and every earlier read-back holds FKR-9 apart too. The E-MOD rows hold.
  // Re-pinned by gear wear steps 1 and 2 (60d00075 -> 48a843b0): the `wear` system's 41 pending entries added and the
  // four OC-D14 durability audit rows re-owned; read back (`gw`), the snapshot is 60d00075 (asserted below).
  // Re-pinned by Gas Giant Study GG-1 on its own branch (60d00075 -> c86ecfb4): it only ADDS entries (the study uses,
  // the giant class and nebula kind fields, the canister sell values, the research data reserves, the Deuterium
  // Canister recipe); left out, the snapshot is 60d00075.
  // Re-pinned at the merge of gear wear into the GG-1 branch (48a843b0 / c86ecfb4 -> fca48c3f): the two moves together,
  // nothing else. With GG-1 left out the snapshot is gear wear's 48a843b0, with gear wear read back and GG-1 kept it is
  // GG-1's c86ecfb4, and with both it is 60d00075 (asserted below).
  // Re-pinned at the merge of feat (gear wear steps 1 and 2, GG-1) into FKR-9 / FKR-10 (9deacec7 / fca48c3f -> 1d8ae09b):
  // the moves together, nothing else. Reading back FKR-9 reproduces fca48c3f, reading back gear wear and leaving GG-1
  // out reproduces 9deacec7, and reading back all three reproduces 60d00075 (asserted below).
  // Re-pinned by safe first runs SF-3 (1d8ae09b -> bd1e2f48): Weak's two rank entries flip pending -> live with their
  // probe and the ground context (the difficulty curve places Weak); read back (SF3_BEFORE) the snapshot is 1d8ae09b.
  // Re-pinned by ML-2 (bd1e2f48 -> cfe349ea): the seven ML-1 recipe entries flip pending -> live with their content
  // probes, the six ML-1 reserve entries are gone (each good has its blueprint consumer) and the two new refines
  // (Biofiber, Resin Distillate) join; read back (ml2RowsBack, inside every rowsBack too) the snapshot is bd1e2f48.
  // Re-pinned by ML-3 (cfe349ea -> c89e7c59): the rig line's entry (ship:gearLine:materialQualityChance) flips
  // pending -> live on mission:extraction; read back (ml3RowsBack, inside every rowsBack too) the snapshot is cfe349ea.
  // Field Kits FKR-11 (the close-out) does NOT move it: Inspired's flip and the three re-owned audit rows are read back
  // in the snapshot and every read-back (fkr11ReadBack, the G1-6 pattern).
  registry: [
    "7df9aad2",
    "relic:RELICS:precursorLens",
    "ship:audit:reactorCoreNet",
  ],
};

// The EM-0 captures of the pins EM-1 moved (before it the power crew moved no sheet: crew.powerEfficiency had no
// consumer, so each sheetFull pair read the same hash twice). withEm1Off reproduces each exactly.
const EM0: Record<string, unknown> = {
  sheetCombinations: [
    "generalFreighter:512:16169b47",
    "prospectorHauler:1024:8cdda793",
    "prospectorRunner:1024:854fc36b",
    "prospectorMiner:1024:1a000283",
    "destroyer:1024:fa730773",
    "battleship:1024:e73ece6f",
    "carrier:2048:fd7b05c3",
    "orion:1024:a4e64707",
    "aurora:1024:4c96d94b",
    "eir:1024:1e3c094f",
  ],
  sheetFull: [
    "generalFreighter:216ef85d/216ef85d",
    "prospectorHauler:2516fe/2516fe",
    "prospectorRunner:61a33ebb/61a33ebb",
    "prospectorMiner:5f61b183/5f61b183",
    "destroyer:1f3290ba/1f3290ba",
    "battleship:54a4eab8/54a4eab8",
    "carrier:4757d743/4757d743",
    "orion:99c11d4f/99c11d4f",
    "aurora:b1501469/b1501469",
    "eir:d521e9b4/d521e9b4",
  ],
};

// The registry snapshot before ML-2 (the SF-3 pin).
const REGISTRY_BEFORE_ML2 = "6b2ebb9f";
const REGISTRY_BEFORE_ML3 = "3c79b5fd";
// The registry snapshot before Material Lines ML-1, and the 14 entries ML-1 added (its recipes and its reserves).
const REGISTRY_BEFORE_ML1 = "74d966af";
const ML1_ENTRY_IDS: ReadonlySet<string> = new Set<string>([
  ...["refineFerriteIngot", "refineReclaimedCircuit", "refineIridiumCatalyst", "synthCobaltCoil", "synthOsmiumPlate", "synthPhotonicGel", "synthBiocatalyst"].map((k) => `facility:REFINE_RECIPES:${k}`),
  ...["reclaimedCircuit", "iridiumCatalyst", "cobaltCoil", "osmiumPlate", "photonicGel", "biocatalyst", "precursorCircuit"].map((id) => `facility:ITEMS:${id}:reserved`),
]);

// Field Kits FKR-6: the 5 entries it added, and the 8 it flipped pending -> live as they stood before it (status, no
// contexts, no probe).
const FKR6_ADDED_IDS: ReadonlySet<string> = new Set<string>([
  "away:GAMBIT_SELECTORS:allyDowned",
  "away:GAMBIT_PROGRAMS:minRank:elite",
  "away:GAMBIT_PROGRAMS:minRank:boss",
  "away:GAMBIT_PROGRAMS:reserveForBoss",
  "away:GAMBIT_PROGRAMS:fieldKitsDefault",
]);
const FKR6_BEFORE: Readonly<Record<string, string>> = {
  "away:FIELD_KITS:firstAidKit": "FKR-6 (kits in battle: a Use Item rule spends the member's own First Aid Kit)",
  "away:FIELD_KITS:antitoxin": "FKR-6 (kits in battle: Antitoxin clears Poison)",
  "away:FIELD_KITS:combatStim": "FKR-6 (kits in battle: Combat Stim grants Inspired)",
  "away:FIELD_KITS:splint": "FKR-6 (kits in battle: Splint on the bone line, N8)",
  "away:FIELD_KITS:traumaKit": "FKR-6 (kits in battle: Trauma Kit on serious conditions)",
  "away:FIELD_KITS:injuryKit": "FKR-6 + FKR-7 (the Injury Kit treatment share reaches the medical bay)",
  "away:KIT_CATEGORY_RULES:firstAid": "FKR-6 (First Aid kits at 0.5x untrained, 1.25x with Medical Training)",
  "away:KIT_CATEGORY_RULES:advancedMedical": "FKR-6 (the Medical Training gate on Splint, Trauma Kit and Injury Kit)",
};
const REGISTRY_BEFORE_FKR6 = "9aed426b";
// G1-3's one moved row, as it stood before it (the c1260fe0 snapshot).
const G13_ROW = "facility:audit:missionControlUnlock";
const G13_ROW_BEFORE = { kind: "pending", owner: "WR-4, OC-C4" };
const REGISTRY_BEFORE_G13 = "e495f57f";

// The inert racials (0.14.0): the one audit row they added (the Spacer long-haul ramp, still deferred) and the 14 rows
// they changed as they stood before them ([status, contexts, probe]): 8 flipped live (Deck Handling, Survey Aptitude,
// the Belter, Outer-Colony, Vael and Spacer racials, the Science and Flight Deck wings) and 6 re-owned to CP-3 (the
// four Ground Ops crew keys, the Security and Medical wings). Read back, the snapshot is feat's 30489b98.
const REGISTRY_BEFORE_RACIALS = "d0bb3317";
const RACIALS_ADDED_IDS: ReadonlySet<string> = new Set<string>(["crew:audit:spacerLongHaulRamp"]);
const RACIALS_BEFORE: Readonly<Record<string, readonly unknown[]>> = {
  "crew:crew.droneHandling": [{ "kind": "pending", "owner": "E-CREW Task 23 (division pools + exclusive pool live, design 6.2)", "contexts": ["patrol"]}, [], "combatDroneHp"],
  "crew:crew.counterInfiltration": [{ "kind": "pending", "owner": "E-CREW Task 23 (division pools + exclusive pool live, design 6.2)" }, [], null],
  "crew:crew.awayTeamProtection": [{ "kind": "pending", "owner": "E-CREW Task 23 (division pools + exclusive pool live, design 6.2)", "contexts": ["ground"]}, [], "runSecHp"],
  "crew:crew.surveyAptitude": [{ "kind": "pending", "owner": "E-CREW Task 23 (division pools + exclusive pool live, design 6.2)", "contexts": ["expedition:groundOps"]}, [], "expScanRate"],
  "crew:crew.triage": [{ "kind": "pending", "owner": "E-CREW Task 23 (division pools + exclusive pool live, design 6.2)", "contexts": ["ground"]}, [], "runSecHeal"],
  "crew:crew.preventCrewLoss": [{ "kind": "pending", "owner": "E-CREW Task 23 (division pools + exclusive pool live, design 6.2)", "contexts": ["medbay"]}, [], "injuryCare"],
  "racial:belter": [{ "kind": "pending", "owner": "E-CREW Task 23 (division pools + exclusive pool live, design 6.2)", "contexts": ["patrol"]}, [], "combatDroneHp"],
  "racial:outerColony": [{ "kind": "pending", "owner": "E-CREW Task 23 (division pools + exclusive pool live, design 6.2)", "contexts": ["expedition:groundOps"]}, [], "expScanRate"],
  "racial:spacer": [{ "kind": "deferred", "owner": "Task 23: complement long-haul ramp (D26)", "userRef": "capture 2026-10-15 section 3 T3 (moved to 0.14.x): the Spacer long-haul ramp" }, [], null],
  "racial:vael": [{ "kind": "pending", "owner": "E-CREW Task 23 (division pools + exclusive pool live, design 6.2)", "contexts": ["expedition:groundOps"]}, [], "expScanRate"],
  "ship:QUARTERS_MODULES:quartersSecurityWing": [{ "kind": "pending", "owner": "CP-3, CP-4 (the security division's dead keys; its live keys move)", "contexts": ["ground"]}, ["sheet"], "sheetUnload"],
  "ship:QUARTERS_MODULES:quartersScienceWing": [{ "kind": "pending", "owner": "CP-3, CP-4 (the science division's dead keys; its live keys move)", "contexts": ["expedition:groundOps"]}, ["sheet"], "sheetUnload"],
  "ship:QUARTERS_MODULES:quartersMedicalWing": [{ "kind": "pending", "owner": "CP-3, CP-4 (the medical division's dead keys; its live keys move)", "contexts": ["ground"]}, ["sheet"], "sheetUnload"],
  "ship:QUARTERS_MODULES:quartersFlightDeckWing": [{ "kind": "pending", "owner": "CP-3, CP-4 (the flightDeck division's dead keys; its live keys move)", "contexts": ["patrol"]}, ["sheet"], "sheetUnload"],
};

// G1-4 (the short-range cycle engine): the one entry it added, the 27 it flipped pending -> live (the six guest
// quarters sources, read at the sheet then, and the 21 template fields, with no probe then), and the entries its
// mission:shortRange sweep gave that context (their status and probe unchanged). The snapshot before it: G14_BEFORE.
const G14_ADDED_IDS: ReadonlySet<string> = new Set<string>(["captain:SECONDARY_CAPTAIN_TALENTS:trade2:shortRange"]);
const G14_GUEST_IDS: ReadonlySet<string> = new Set<string>([
  "ship:gearLine:colonistCapacity",
  "ship:SHIP_TYPES:generalFreighter:colonistCapacity",
  "ship:SHIP_TYPES:orion:colonistCapacity",
  "ship:SHIP_TYPES:aurora:colonistCapacity",
  "ship:SHIP_TYPES:eir:colonistCapacity",
  "ship:SHIP_SEAMS:generalQuartersGuestPerk",
]);
const G14_GUESTS_OWNER = "G1-4 (the short-range passenger jobs read guest quarters)";
const G14_CYCLE_OWNER = "G1-4 (the short-range cycle engine flies the rolls, times the work and pays the rewards)";
const G14_SWEPT_IDS: ReadonlySet<string> = new Set<string>([
  "officer:officer.shipOutputMult",
  "crew:crew.crewOutputMult",
  "captain:SECONDARY_CAPTAIN_TALENTS:commandCrew2",
  "captain:SECONDARY_CAPTAIN_TALENTS:commandCrew5:officers",
  "captain:SECONDARY_CAPTAIN_TALENTS:commandCrew3",
  "captain:SECONDARY_CAPTAIN_TALENTS:trade1",
  "captain:SECONDARY_CAPTAIN_TALENTS:trade3",
  "captain:SECONDARY_CAPTAIN_TALENTS:extraction4",
  "captain:SECONDARY_CAPTAIN_TALENTS:extraction5",
  ...Array.from({ length: 8 }, (_, i) => `facility:TRANSIT_BERTH_RUNGS:${i}`),
]);
const REGISTRY_BEFORE_G14 = "d0bb3317";
function g14Back(e: (typeof WIRING_REGISTRY)[number]): unknown[] {
  if (e.id.startsWith("mission:SHORT_RANGE_TEMPLATES:")) return [e.id, { kind: "pending", owner: G14_CYCLE_OWNER }, [], null];
  if (G14_GUEST_IDS.has(e.id)) return [e.id, { kind: "pending", owner: G14_GUESTS_OWNER, contexts: ["mission:shortRange"] }, ["sheet"], e.probe ?? null];
  if (G14_SWEPT_IDS.has(e.id)) return [e.id, e.status, e.contexts.filter((c) => c !== "mission:shortRange"), e.probe ?? null];
  return [e.id, e.status, e.contexts, e.probe ?? null];
}

// Field Kits FKR-7 (the run plumbing): the 2 entries it added, and the 9 rows it moved as they stood before it: the 8 it
// flipped pending -> live (status, no contexts, no probe) and the hidden pieces row's owner (still pending). The
// snapshot before it is REGISTRY_BEFORE_FKR7 (the FKR-6 re-pin).
const FKR7_ADDED_IDS: ReadonlySet<string> = new Set<string>(["away:FREE_BASIC_SET:firstAidKit:crew", "away:audit:fieldKitsRunsSwitch"]);
const FKR7_PRICE = "FKR-7 (Quartermaster kit sales and the off-by-default launch top-up charge the price)";
const FKR7_BEFORE: Readonly<Record<string, string>> = {
  "away:FREE_BASIC_SET:firstAidKit": "FKR-7 (the per-objective free basic set, refreshed each objective and reload)",
  ...Object.fromEntries(["firstAidKit", "antitoxin", "combatStim", "splint", "traumaKit", "injuryKit"].map((k) => [`facility:FIELD_KIT_PRICES:${k}`, FKR7_PRICE])),
  "away:audit:treatmentShare": "FK-5 / FK-6",
  "away:audit:fieldKitsHiddenPieces": "FKR-7 (flips FIELD_KITS_PLAYER_LIVE when kits are wired into runs)",
};
const REGISTRY_BEFORE_FKR7 = "d0bb3317";

// Field Kits FKR-9 / FKR-10 (the switch-on): the three FKR-5 entries the switch shows again (absent before it), and the two
// audit rows it flipped pending -> live as they stood before it (status, no contexts, no probe). The snapshot before it
// is REGISTRY_BEFORE_FKR9 (the FKR-7 merge pin).
const FKR9_SHOWN_IDS: ReadonlySet<string> = new Set<string>([
  "gear:security:stunGrenade:groundCarryCapacity",
  "gear:security:toxinGrenade:groundCarryCapacity",
  "facility:BLUEPRINTS:impactGrenadeBp",
]);
const FKR9_BEFORE: Readonly<Record<string, string>> = {
  "away:audit:fieldKitsHiddenPieces": "FKR-9 / FKR-10 (flip FIELD_KITS_PLAYER_LIVE with FIELD_KITS_RUNS_LIVE once the pack UI ships)",
  "away:audit:fieldKitsRunsSwitch": "FKR-9 / FKR-10 (the per-member pack UI and the Quartermaster kit sale rows; flips with FIELD_KITS_PLAYER_LIVE)",
};
const REGISTRY_BEFORE_FKR9 = "f3a371a";

// The pins each of the three latest slices left on its own branch (the inert racials on feat, G1-4 and FKR-7 on theirs),
// each from 30489b98, and feat's pin after G1-4 merged (before FKR-7). Merged, reading back only the OTHER slices
// reproduces each one.
const REGISTRY_RACIALS_PIN = "db20a066";
const REGISTRY_G14_PIN = "dabbbcb4";
const REGISTRY_FKR7_PIN = "24105e10";
const REGISTRY_BEFORE_FKR7_MERGE = "599776ed";
// GG-1 on its own branch and gear wear steps 1 and 2 on feat, each from 60d00075.
const REGISTRY_GG1_PIN = "98ba8d1f";
const REGISTRY_GEAR_WEAR_PIN = "b7c916e3";
// The two pins the merge of feat into FKR-9 / FKR-10 joined: feat's (gear wear + GG-1) and FKR-9's own (the switch-on).
const REGISTRY_FEAT_BEFORE_FKR9_MERGE = "5052478c";
const REGISTRY_FKR9_PIN = "62d7ba06";

// Safe first runs SF-3 (the difficulty curve places Weak enemies): the two Weak rank entries it flipped pending -> live,
// as they stood before it (status, no contexts, no probe). Every read-back below undoes it too (sf3), so each earlier
// proof chain holds; read back alone it reproduces the snapshot from before SF-3's merge.
const SF3_OWNER = "SF-3 (the difficulty curve places Weak enemies)";
const SF3_BEFORE: Readonly<Record<string, unknown>> = {
  "expedition:ENEMY_RANKS:weak": { kind: "pending", owner: SF3_OWNER },
  "expedition:ENEMY_RANKS:weak:hp": { kind: "pending", owner: SF3_OWNER },
};
const REGISTRY_BEFORE_SF3 = "c44be692";

// Which later moves a read-back undoes. Each slice's rows are disjoint from every other slice's.
// Gear wear steps 1 and 2 (0.14.0): the `wear` system's entries it added (all pending) and the four OC-D14 durability
// audit rows it re-owned (still pending, now naming gear wear steps 3 and 4), read back as they stood. `gw` rides in
// every read-back below, so each earlier pin keeps proving its own slice was its only move.
const GW_BEFORE: Readonly<Record<string, string>> = Object.fromEntries(
  ["ship:audit:slotDurability", "ship:audit:qualityDurabilityMax", "ship:audit:podDurability", "away:audit:memberSlotPhysicals"].map((id) => [id, "WR-8, OC-D14"]),
);
const REGISTRY_BEFORE_GEAR_WEAR = "f3a371a";
// Gas Giant Study GG-1 only ADDS entries (gasStudyGoldens.fixture.ts), so every read-back leaves them out unless
// `keepGg1` (the one check that reproduces GG-1's own pin with gear wear read back).
type Back = { readonly sf3?: boolean; readonly fkr9?: boolean; readonly racials?: boolean; readonly g14?: boolean; readonly fkr7?: boolean; readonly fkr6?: boolean; readonly g13?: boolean; readonly gw?: boolean; readonly keepGg1?: boolean };
// The reactor fuel ladder (0.14.0) only ADDS entries (reactorFuelGoldens.fixture.ts), after every pin here was taken:
// every read-back and the snapshot leave them out (reactorFuelGoldens.test.ts pins them with their statuses). The timed
// grenades (user 2026-10-21) only ADD entries too (fieldKitsFuse.fixture.ts, pinned with their statuses in
// fieldKitsFuse.test.ts) and are left out the same way.
// Relics v2 R2-2 the same (its five audit rows, relicBlanks.fixture.ts; relicBlanks.test.ts pins them).
// G1-6 (SHORT_RANGE_BOARD_LIVE, the board UI) came after every pin here too: the two Mission Control board rungs it put
// in FACILITIES (each enumerates as a facility rung entry) and G1-3's audit row, which it flipped pending -> live with
// its own check (the 50-completion gate). Every read-back and the snapshot leave the rungs out and read the row as it
// stood (G16_ROW_BEFORE); "G1-6 is the only cause" below proves that is the whole move.
// The Quartermaster Standard-Issue member lines and the D26 line swap (0.14.0) came after every pin here too: every
// read-back and the snapshot read them back (siMemberGearRegistry.fixture.ts siReadBack: the added entries left out,
// the nine retired combat lines restored in place; shortRangeGoldens.test.ts `registry:si` pins them).
// Expedition Tiers G2-4 / G2-5 come after every pin too: their added entries are left out and their flips read back
// (propulsionRecallGoldens.fixture.ts).
// The OC-15 Lab and Fabricator tier rungs (labFabricatorTiers.fixture.ts) only ADD entries too, left out the same way
// (labFabricatorTiers.test.ts pins them live).
const G16_ADDED_IDS: ReadonlySet<string> = new Set<string>(["facility:FACILITIES:missionControl:1", "facility:FACILITIES:missionControl:2"]);
const G16_ROW_BEFORE = { kind: "pending", owner: "G1-6 (flips SHORT_RANGE_BOARD_LIVE with the board UI; the rungs then enumerate as facility rung entries on the shortRangeSlots probe)" } as const;
// E-MOD EM-5 came after every pin here: its two module wear rows are left out and the hulls' moduleSlots entries read
// with their old owner (emodEm5Registry.fixture.ts em5ReadBack; shipModules.test.ts pins the move itself).
// Gear wear step 3 came after every pin here too: its registry move is read back first (gearWearRegistry.fixture.ts).
// Gas Giant Study GG-2 / GG-3 came after every pin here as well: the entries they FLIPPED pending -> live (the gas giant's
// orbitalOnly row and the GG-1 study entries they wired; gasStudyGoldens.fixture.ts) read back as they stood (pending
// on their owner, no live context, no probe) in every read-back and the snapshot; GG-3's added probe dive seam is left out.
// Relics v2 R2-4 the same (relicMuseumV2.fixture.ts): its added entries left out, its RELIC_TYPES / EXCEPTIONAL_SETS
// flips read back as R2-1 registered them.
// Field Kits FKR-11 (the close-out) came after every pin here too: Inspired's status row flipped pending -> live (the
// Combat Stim inflicts it) with its probe and the ground context, and three audit rows were re-owned (still pending:
// the two field device rows to FKR-8, the status picker to WR-10). Every read-back and the snapshot read them as they
// stood (FKR11_BEFORE); shortRangeGoldens' "FKR-11 is the only cause" proves the flip is the whole move.
const FKR11_BEFORE: Readonly<Record<string, string>> = {
  "away:GAMBIT_STATUSES:inspired": "FK-5 (nothing inflicts it)",
  "away:audit:shroudLureGroundOps": "FK-7 + OC-F1",
  "away:audit:fieldDeviceEffectiveness": "FK-7",
  "away:audit:statusPicker": "FK-9 + WR-10",
};
// Field Kits FKR-8 (the field devices roll per use, on the ground) came after every pin here too: three entries flipped
// pending -> live (the Field Devices kit category, its two audit rows; FKR8_FLIPPED_LIVE) and two audit rows were added
// (OC-F1's reinforcement and salvage halves; FKR8_ADDED_IDS). Every read-back and the snapshot read them as they stood
// before it (pending on FKR-8, no live context, no probe; the added rows left out), inside fkr11ReadBack.
function fkr8ReadBack(rows: readonly WiringEntry[]): WiringEntry[] {
  return rows
    .filter((e) => !FKR8_ADDED_IDS.has(e.id))
    .map((e) => (e.id in FKR8_FLIPPED_LIVE ? ({ ...e, status: { kind: "pending", owner: FKR8_FLIPPED_LIVE[e.id] }, contexts: [], probe: undefined } as WiringEntry) : e));
}
function fkr11ReadBack(rows: readonly WiringEntry[]): WiringEntry[] {
  return fkr8ReadBack(rows).map((e) => {
    if (!(e.id in FKR11_BEFORE)) return e;
    const status = { kind: "pending", owner: FKR11_BEFORE[e.id] } as WiringEntry["status"];
    return e.id === "away:GAMBIT_STATUSES:inspired" ? { ...e, status, contexts: [], probe: undefined } : { ...e, status };
  });
}
const BEFORE_RX: WiringEntry[] = siReadBack(
  em4ReadBack(em3ReadBack(em5ReadBack(wr8ReadBack(gw3RegistryBack(em7ReadBack(fkr11ReadBack(gw4ReadBack(favorsSpecReadBack(patrolLegsReadBack(patrolLegLiftsReadBack(cp3ReadBack(wr11ReadBack(wr9ReadBack(em8ReadBack(cp5ReadBack(sf7ReadBack(cp11ReadBack(cp12ReadBack(cp13ReadBack(cp14ReadBack(cp16ReadBack(cp18ReadBack(cp19ReadBack(gw5ReadBack(ml5ReadBack(otUiReadBack(wr10ReadBack(wr13ReadBack(wr8bReadBack(ocg1ReadBack(cp4FdReadBack(g29ReadBack(WIRING_REGISTRY))))))))))))))))))))))))))))))))).filter(
    (e) =>
      !RX_ADDED_ENTRY_IDS.has(e.id) && !RR_ADDED_ENTRY_IDS.has(e.id) && !FUSE_ADDED_ENTRY_IDS.has(e.id) && !R2_2_ADDED_ENTRY_IDS.has(e.id) && !R2_3_ADDED_ENTRY_IDS.has(e.id) && !R2_10_ADDED_ENTRY_IDS.has(e.id) && !R2_4_ADDED_ENTRY_IDS.has(e.id) && !G16_ADDED_IDS.has(e.id) &&
      !G2_4_ADDED_ENTRY_IDS.has(e.id) && !OC15_ADDED_ENTRY_IDS.has(e.id) && !GG_STUDY_ADDED_ENTRY_IDS.has(e.id) && !G2_6_ADDED_ENTRY_IDS.has(e.id) &&
      // E5-2 (Refugee Posts): the Evacuation template's three rows, added after every pin here.
      !E5_2_ADDED_ENTRY_IDS.has(e.id) &&
      // E5-4 (Refugee Posts): the sixteen refugee post rows, added after every pin here.
      !E5_4_ADDED_ENTRY_IDS.has(e.id),
  ).map((e) =>
    e.id === G13_ROW
      ? { ...e, status: G16_ROW_BEFORE as (typeof WIRING_REGISTRY)[number]["status"], contexts: [], probe: undefined }
      : e.id in G2_6_FLIPPED_BEFORE
        ? ({ ...e, ...G2_6_FLIPPED_BEFORE[e.id] } as unknown as WiringEntry)
      : e.id in G2_4_FLIPPED_BEFORE
        ? { ...e, status: G2_4_FLIPPED_BEFORE[e.id], contexts: [], probe: undefined }
        : GG_STUDY_FLIPPED_BEFORE.has(e.id)
          ? ({ ...e, status: GG_STUDY_FLIPPED_BEFORE.get(e.id)!, contexts: [], probe: undefined } as WiringEntry)
          : R2_4_FLIPPED_BEFORE.has(e.id)
            ? ({ ...e, status: R2_4_FLIPPED_BEFORE.get(e.id)!, contexts: [], probe: undefined } as WiringEntry)
            : e,
  ),
  (e) => e.id,
  (row) => ({ id: row[0], status: row[1], contexts: row[2], probe: row[3] ?? undefined }) as unknown as WiringEntry,
);
function rowsBack(back: Back): unknown[][] {
  // Every pin here was taken before ML-2 (and ML-3), so their moves are always read back.
  return ml2RowsBack(ml3RowsBack(rowsBackBeforeMl2(back)));
}
function rowsBackBeforeMl2(back: Back): unknown[][] {
  return BEFORE_RX.filter(
    (e) =>
      !(!back.keepGg1 && GG1_ADDED_ENTRY_IDS.has(e.id)) &&
      !(back.fkr9 && FKR9_SHOWN_IDS.has(e.id)) &&
      !(back.racials && RACIALS_ADDED_IDS.has(e.id)) &&
      !(back.g14 && G14_ADDED_IDS.has(e.id)) &&
      !(back.fkr7 && FKR7_ADDED_IDS.has(e.id)) &&
      !(back.fkr6 && FKR6_ADDED_IDS.has(e.id)) &&
      !(back.gw && e.id.startsWith("wear:")),
  ).map((e) =>
    back.sf3 && e.id in SF3_BEFORE
      ? [e.id, SF3_BEFORE[e.id], [], null]
      : back.gw && e.id in GW_BEFORE
      ? [e.id, { kind: "pending", owner: GW_BEFORE[e.id] }, e.contexts, e.probe ?? null]
      : back.racials && e.id in RACIALS_BEFORE
      ? [e.id, ...RACIALS_BEFORE[e.id]]
      : back.fkr7 && e.id in FKR7_BEFORE
        ? [e.id, { kind: "pending", owner: FKR7_BEFORE[e.id] }, [], null]
        : back.fkr9 && e.id in FKR9_BEFORE
          ? [e.id, { kind: "pending", owner: FKR9_BEFORE[e.id] }, [], null]
        : back.fkr6 && e.id in FKR6_BEFORE
          ? [e.id, { kind: "pending", owner: FKR6_BEFORE[e.id] }, [], null]
          : back.g13 && e.id === G13_ROW
            ? [e.id, G13_ROW_BEFORE, e.contexts, e.probe ?? null]
            : back.g14
              ? g14Back(e)
              : [e.id, e.status, e.contexts, e.probe ?? null],
  );
}

// The registry snapshot rows with the inert racials, G1-4, FKR-7 and FKR-6 read back (FKR-6's added entries left out,
// its flips as they stood) and, when `g13Back`, G1-3's audit row with its old owner.
function registryRowsBack(g13Back: boolean): unknown[][] {
  return rowsBack({ sf3: true, fkr9: true, gw: true, racials: true, g14: true, fkr7: true, fkr6: true, g13: g13Back });
}

function pinned(name: string, value: unknown): void {
  expect(value, name).toEqual(GOLDEN[name]);
}

describe("EM-0 goldens (re-pinned by EM-1 where named)", () => {
  it("sheet: every hull, every slot combination the census can build", () => {
    const out = HULLS.map((hull) => {
      const { hash: h, count } = combinationsHash(hull);
      return `${hull}:${count}:${h}`;
    });
    pinned("sheetCombinations", out);
  });

  it("sheet: the full crafted loadout, alone and with the power-efficiency crew", () => {
    const out = HULLS.map((hull) => `${hull}:${hash(sheetOf(fullLoadout(hull)))}/${hash(sheetOf(withPowerCrew(fullLoadout(hull))))}`);
    pinned("sheetFull", out);
  });

  it("census: every hull's maximum crafted power draw (P1), and the full loadout draws no more", () => {
    const census = Object.fromEntries(HULLS.map((hull) => [hull, maxCraftedDraw(hull)]));
    pinned("census", census);
    for (const hull of HULLS) {
      const gross = fullLoadout(hull).equipment.filter((e) => e.fittedToShipId === SHIP).reduce((sum, e) => sum + e.powerDraw, 0);
      expect(gross, hull).toBeLessThanOrEqual(census[hull]);
      expect(gross, hull).toBeGreaterThan(0);
    }
  });

  for (const hull of HULLS) {
    for (const route of ROUTES) {
      it(`patrol: ${hull} on ${route}, Repeat, with the display replay`, () => {
        pinned(`patrol:${hull}:${route}`, patrolRun(hull, route));
      });
    }
  }

  for (const seed of [0x1234, 0x5678]) {
    it(`groundOps: an Orion run with ship events (seed ${seed.toString(16)}), through claim`, () => {
      pinned(`groundOps:${seed.toString(16)}`, groundOpsRun(seed));
    });
  }

  for (const key of ["shortOreRun", "surveyMineralAnomaly"] as MissionKey[]) {
    it(`mission ${key}: a crafted Reactor Core and the power crew, 700 economyTick seconds`, () => {
      pinned(`mission:${key}`, missionRun(key));
    });
  }

  it("registry: the wiring registry snapshot and the E-MOD owned rows", () => {
    const rows = BEFORE_RX.map((e) => [e.id, e.status, e.contexts, e.probe ?? null]);
    const snapshot = hash(rows);
    // ML-3 read back: the ML-2 pin before it; ML-2 read back too: the SF-3 pin before that.
    expect(hash(ml3RowsBack(rows))).toBe(REGISTRY_BEFORE_ML3);
    expect(hash(ml2RowsBack(ml3RowsBack(rows)))).toBe(REGISTRY_BEFORE_ML2);
    const emod = BEFORE_RX.filter((e) => e.status.kind !== "live" && "owner" in e.status && /E-MOD/.test(e.status.owner)).map((e) => e.id).sort();
    pinned("registry", [snapshot, ...emod]);
    // The two latest moves, merged together: with GG-1 left out the snapshot is gear wear's own pin; with gear wear read
    // back and GG-1 kept it is GG-1's own pin; with both undone it is the merged feat pin before either.
    // (Safe first runs SF-3's two flips are read back in each: sf3.)
    expect(hash(rowsBack({ sf3: true, fkr9: true }))).toBe(REGISTRY_GEAR_WEAR_PIN);
    // The merge with FKR-9 / FKR-10: FKR-9 read back and GG-1 kept is feat's merged pin; gear wear read back and GG-1
    // left out is FKR-9's own pin.
    expect(hash(rowsBack({ sf3: true, fkr9: true, keepGg1: true }))).toBe(REGISTRY_FEAT_BEFORE_FKR9_MERGE);
    expect(hash(rowsBack({ sf3: true, gw: true }))).toBe(REGISTRY_FKR9_PIN);
    expect(hash(rowsBack({ sf3: true, fkr9: true, gw: true, keepGg1: true }))).toBe(REGISTRY_GG1_PIN);
    expect(hash(rowsBack({ sf3: true, fkr9: true, gw: true }))).toBe(REGISTRY_BEFORE_GEAR_WEAR);
    // With the later moves read back (FKR-6 and G1-3, the test below) and ML-1's entries left out: the snapshot before ML-1.
    const beforeMl1 = hash(registryRowsBack(true).filter((r) => !ML1_ENTRY_IDS.has(r[0] as string)));
    expect(beforeMl1).toBe(REGISTRY_BEFORE_ML1);
  });
  // Safe first runs SF-3: Weak's two entries flipped live are the only move since the FKR-9 / FKR-10 merge.
  it("registry: safe first runs SF-3 (Weak placed by the curve) is the only cause of its snapshot move", () => {
    expect(WIRING_REGISTRY.filter((e) => e.id in SF3_BEFORE).map((e) => e.status.kind)).toEqual(["live", "live"]);
    expect(hash(rowsBack({ sf3: true, keepGg1: true }))).toBe(REGISTRY_BEFORE_SF3);
  });
  // Field Kits FKR-9 / FKR-10 (the switch-on): its three re-shown entries left out and its two audit flips read back, the
  // snapshot is the pin before it.
  it("registry: Field Kits FKR-9 / FKR-10 (the switch-on) is the only cause of its snapshot move", () => {
    expect(hash(rowsBack({ sf3: true, gw: true, fkr9: true }))).toBe(REGISTRY_BEFORE_FKR9);
  });
  // The three latest moves, merged together: each cause test also undoes the other slices' changes.
  it("registry: the inert racials are the only cause of their snapshot move", () => {
    expect(hash(rowsBack({ sf3: true, fkr9: true, gw: true, g14: true, fkr7: true }))).toBe(REGISTRY_RACIALS_PIN);
    expect(hash(rowsBack({ sf3: true, fkr9: true, gw: true, g14: true, fkr7: true, racials: true }))).toBe(REGISTRY_BEFORE_RACIALS);
  });
  it("registry: G1-4 (the short-range cycle engine) is the only cause of its snapshot move", () => {
    expect(hash(rowsBack({ sf3: true, fkr9: true, gw: true, racials: true, fkr7: true }))).toBe(REGISTRY_G14_PIN);
    expect(hash(rowsBack({ sf3: true, fkr9: true, gw: true, racials: true, fkr7: true, g14: true }))).toBe(REGISTRY_BEFORE_G14);
  });
  it("registry: Field Kits FKR-7 is the only cause of its snapshot move", () => {
    expect(hash(rowsBack({ sf3: true, fkr9: true, gw: true, fkr7: true }))).toBe(REGISTRY_BEFORE_FKR7_MERGE);
    expect(hash(rowsBack({ sf3: true, fkr9: true, gw: true, racials: true, g14: true }))).toBe(REGISTRY_FKR7_PIN);
    expect(hash(rowsBack({ sf3: true, fkr9: true, gw: true, racials: true, g14: true, fkr7: true }))).toBe(REGISTRY_BEFORE_FKR7);
  });
  it("registry: FKR-6 and G1-3's audit row are the only causes of its snapshot move", () => {
    expect(hash(registryRowsBack(false))).toBe(REGISTRY_BEFORE_FKR6);
    expect(hash(registryRowsBack(true))).toBe(REGISTRY_BEFORE_G13);
  });
  // G1-6: the live registry (the reactor fuel additions left out) is the pinned snapshot's rows plus exactly the two
  // board rungs (in FACILITIES order, right after the founding rung) and G1-3's audit row live with its gate check.
  it("registry: G1-6 (the board goes live) is the only cause of its move", () => {
    // Merged onto feat (0.14.0 integration): the slices BEFORE_RX holds apart (the timed grenades, R2-2, the SI read-back)
    // and G2-4's additions are held apart here the same way, so the comparison sees G1-6's move alone. E-MOD EM-5's move is
    // read back first (em5ReadBack), as BEFORE_RX does; Gas Giant Study GG-3's added seam is held apart too.
    const live = em4ReadBack(em3ReadBack(em5ReadBack(wr8ReadBack(gw3RegistryBack(em7ReadBack(gw4ReadBack(patrolLegsReadBack(patrolLegLiftsReadBack(cp3ReadBack(wr11ReadBack(wr9ReadBack(em8ReadBack(cp5ReadBack(sf7ReadBack(cp11ReadBack(cp12ReadBack(cp13ReadBack(cp14ReadBack(cp16ReadBack(cp18ReadBack(cp19ReadBack(gw5ReadBack(ml5ReadBack(otUiReadBack(wr10ReadBack(wr13ReadBack(wr8bReadBack(ocg1ReadBack(cp4FdReadBack(g29ReadBack(WIRING_REGISTRY))))))))))))))))))))))))))))))).filter(
      (e) => !FKR8_ADDED_IDS.has(e.id) && !RX_ADDED_ENTRY_IDS.has(e.id) && !RR_ADDED_ENTRY_IDS.has(e.id) && !FUSE_ADDED_ENTRY_IDS.has(e.id) && !R2_2_ADDED_ENTRY_IDS.has(e.id) && !R2_3_ADDED_ENTRY_IDS.has(e.id) && !R2_10_ADDED_ENTRY_IDS.has(e.id) && !R2_4_ADDED_ENTRY_IDS.has(e.id) && !G2_4_ADDED_ENTRY_IDS.has(e.id) && !OC15_ADDED_ENTRY_IDS.has(e.id) && !GG_STUDY_ADDED_ENTRY_IDS.has(e.id) && !G2_6_ADDED_ENTRY_IDS.has(e.id) && !E5_2_ADDED_ENTRY_IDS.has(e.id) && !E5_4_ADDED_ENTRY_IDS.has(e.id),
    );
    const rung = live.filter((e) => G16_ADDED_IDS.has(e.id)).map((e) => [e.id, e.status, e.contexts, e.probe ?? null]);
    expect(rung).toEqual([...G16_ADDED_IDS].map((id) => [id, { kind: "live" }, ["mission:shortRange"], "shortRangeSlots"]));
    const row = live.find((e) => e.id === G13_ROW)!;
    expect([row.status, row.contexts, row.probe]).toEqual([{ kind: "live" }, ["facility"], "missionControlBuildable"]);
    const rest = siReadBack(live.filter((e) => !G16_ADDED_IDS.has(e.id) && e.id !== G13_ROW).map((e) => e.id), (id) => id, (r) => r[0]);
    expect(rest).toEqual(BEFORE_RX.filter((e) => e.id !== G13_ROW).map((e) => e.id));
    const ids = live.map((e) => e.id);
    expect(ids.indexOf("facility:FACILITIES:missionControl:1")).toBe(ids.indexOf("facility:FACILITIES:missionControl:0") + 1);
  });
});

describe("EM-1 turn it off: with the power budget engine switched off, every moved sheet is the EM-0 capture", () => {
  it("sheet: every hull, every slot combination", () => {
    expect(withEm1Off(() => HULLS.map((hull) => {
      const { hash: h, count } = combinationsHash(hull);
      return `${hull}:${count}:${h}`;
    }))).toEqual(EM0.sheetCombinations);
  });

  it("sheet: the full crafted loadout, alone and with the power-efficiency crew", () => {
    expect(withEm1Off(() => HULLS.map((hull) => `${hull}:${hash(sheetOf(fullLoadout(hull)))}/${hash(sheetOf(withPowerCrew(fullLoadout(hull))))}`))).toEqual(EM0.sheetFull);
  });

  it("the switch restores every value it touched", () => {
    const before = JSON.stringify([HULLS.map((h) => SHIP_TYPES[h].basePowerOutput), getSeniorStaffBonusById("eng.overdrive")]);
    withEm1Off(() => expect(SHIP_TYPES.destroyer.basePowerOutput).toBe(0));
    expect(JSON.stringify([HULLS.map((h) => SHIP_TYPES[h].basePowerOutput), getSeniorStaffBonusById("eng.overdrive")])).toBe(before);
  });
});

describe("EM-1 power numbers (P1: no live ship goes over budget)", () => {
  it("every hull's base output covers its maximum crafted draw (the EM-0 census)", () => {
    for (const hull of HULLS) expect(SHIP_TYPES[hull].basePowerOutput, hull).toBeGreaterThanOrEqual(maxCraftedDraw(hull));
  });

  it("the full crafted loadout's output and draw, alone and with the power crew, on every hull", () => {
    const out = HULLS.map((hull) => {
      const alone = sheetOf(fullLoadout(hull));
      const crewed = sheetOf(withPowerCrew(fullLoadout(hull)));
      expect(alone.powerDraw, hull).toBeLessThanOrEqual(alone.powerOutput);
      expect(crewed.powerDraw, hull).toBeLessThan(alone.powerDraw);
      expect(Number.isInteger(crewed.powerDraw), hull).toBe(true);
      return `${hull}:${alone.powerOutput}/${alone.powerDraw}/${crewed.powerDraw}`;
    });
    pinned("power", out);
  });
});
