// Field Kits FKR-8 goldens (docs/plans/2026-10-14-field-kits-plan.md REVISED SLICES R3 FKR-8, the wiring plan's OC-F1),
// captured on e024edf BEFORE any FKR-8 engine edit. FKR-8 makes the field devices (Shroud Emitter, Lure Beacon) roll 50
// to 75% PER USE (53 to 79.5% with a Codebreaker aboard) and moves them to the GROUND (OC-F1, user "Move them to the
// ground (Recommended)"): a ground crew's ambush and reinforcement chances, plus a Lure's salvage drop scale. Only a
// run carrying FKR-8's field devices stamp (Expedition.fieldKits.devices, written at dispatch when a device is worn)
// reads any of it, so these pin, for every device set below, each run:
//   - inflight: as today's dispatch records it (Field Kits catalog 2, no devices stamp): byte-identical across FKR-8;
//   - stamped:  the same record with the devices stamp set here as a literal ({ devices: 1 }): identical to inflight
//     today (no engine reads the field yet), so FKR-8 MOVES these on purpose and names each move.
// The runs:
//   HAND : a real dispatch turned into a run on ONE scanned body (the fieldKitsGoldens handRun pattern): calm
//          objectives with an ambush chance placed by hand, combat objectives carrying Reinforcing III by hand. Pinned:
//          the ground operations at T0 + 200,000 s, each objective's ambush and visit counts, the claim's whole state.
//   SHIP : a real dispatch played from launch (ship events at every scan boundary), at two seeds (the second wins two
//          ship battles). Pinned: the ship-event chance and step roll at every boundary, the run's scan events and
//          findings (a won ship battle's salvage), the claim.
// Device sets: none, a Shroud Emitter on each team's lead, a Lure Beacon on each team's lead, the Lures with a
// Codebreaker among the Science squad. Plus offline == live parity on the stamped Lure run (997 s chunks and an
// event-boundary chain against one call).

import { describe, expect, it } from "vitest";
// WR-8b (enemy torpedoes) came after every pin here: the file runs with it off (enemyTorpedoSwitch.fixture.ts), so its
// pins keep proving their own slice (enemyTorpedoGoldens.test.ts pins what WR-8b moved, enemyTorpedoes.test.ts proves it).
import { enemyTorpedoesOffForThisFile } from "./enemyTorpedoSwitch.fixture";
enemyTorpedoesOffForThisFile();
import { cp16OffForThisFile } from "./cp16Switch.fixture";
// Complement CP-16 (the Hall of Command) came after every pin here: the file runs with the slice off, so its pins
// keep proving their own slice (cp16Goldens.test.ts pins what CP-16 moved: the missions counter, the notables and
// the Hall of Command entry).
cp16OffForThisFile();
import { writeFileSync } from "node:fs";
// GEAR WEAR step 3: run with the use sources off like every Field Kits golden (gearWearSwitch.fixture.ts), so a later
// wear slice never reads as a device move here. gearWearGoldens.test.ts pins the wear.
import { gearWearOffInThisFile } from "./gearWearSwitch.fixture";
gearWearOffInThisFile();
import { freshState, type AwayMember, type BodyRiskGrades, type EquipmentInstance, type Expedition, type ExpeditionBody, type GameState, type ShipGroundTeam } from "./model";
import { advanceExpedition, claimExpedition, expeditionCandidates, scanStepRoll, shipScanEventChance } from "./expedition";
import { groundOpsAssignIdle, groundOpsBodyScanned, initGroundTasks } from "./groundOps";
import { shipEventsLive } from "./shipScanEvents";
import { asPreStaggerDispatch, plainAwayMember, dispatchPastPropulsion } from "./awayTeamTestFixtures";
import { hash, stateHash } from "./firstRunsGoldens.fixture";
import { wr11OffForThisFile } from "./wr11Switch.fixture";
// Wiring WR-11 came after every pin here: the whole file runs with WR-11 off (wr11Switch.fixture.ts), so its pins keep
// proving their own slice moved nothing else (WR-11's own moves are pinned in wr11Goldens.test.ts).
wr11OffForThisFile();

const T0 = 100_000;
const MID = T0 + 200_000;
const FINAL = T0 + 2_000_000;
const SEC = ["member-1", "member-2", "member-3", "member-4", "member-5", "member-6"];
const SCI = ["member-11", "member-12", "member-13", "member-14", "member-15", "member-16"];
const CAPTURE = Boolean(import.meta.env.FKR8_CAPTURE);

type DeviceSet = "none" | "shroud" | "lure" | "lureCodebreaker";
const DEVICE_SETS: readonly DeviceSet[] = ["none", "shroud", "lure", "lureCodebreaker"];
type Stamp = "inflight" | "stamped";
const STAMPS: readonly Stamp[] = ["inflight", "stamped"];

function tool(id: string, variety: string, wearer: string): EquipmentInstance {
  return {
    id,
    slotType: "memberTool",
    moduleVariant: variety,
    rarity: "standard",
    ascension: "none",
    quality: 0,
    iLevel: 10,
    blueprintKey: "bp-test",
    implicitStats: {},
    rolledStats: {},
    mass: 0,
    powerDraw: 0,
    durabilityMax: 100,
    fittedToShipId: null,
    fittedToMemberId: wearer,
  };
}

// ship-1: Ground + Ground fully slotted at rank 3, the devices on each team's lead (member-1, member-4).
function crewed(expeditionSeed: number, set: DeviceSet): GameState {
  const base = freshState();
  const variety = set === "shroud" ? "shroudEmitter" : set === "none" ? null : "lureBeacon";
  const gear = variety ? [tool("equip-901", variety, "member-1"), tool("equip-902", variety, "member-4")] : [];
  const m = (id: string, t: AwayMember["teamType"]): AwayMember => ({
    ...plainAwayMember(id, t, "ship-1"),
    rank: 3,
    ...(set === "lureCodebreaker" && id === "member-11" ? { traits: ["codebreaker"] } : {}),
  });
  const teams: ShipGroundTeam[] = [
    { kind: "ground", security: SEC.slice(0, 3), science: SCI.slice(0, 3), helpOthers: false },
    { kind: "ground", security: SEC.slice(3), science: SCI.slice(3), helpOthers: false },
  ];
  return {
    ...base,
    gameTimeSeconds: T0,
    expeditionSeed,
    awayMembers: [...SEC.map((id) => m(id, "security")), ...SCI.map((id) => m(id, "science"))],
    equipment: [...base.equipment, ...gear],
    nextAwayMemberId: 100,
    ships: base.ships.map((sh) => ({ ...sh, groundTeams: teams })),
  };
}

function dispatched(state: GameState): { next: GameState; exp: Expedition } {
  // Relics v2 tier stagger (after these pins): read as a pre-stagger dispatch (asPreStaggerDispatch, no draw moves).
  const res = asPreStaggerDispatch(dispatchPastPropulsion(state, "ship-1", 1, expeditionCandidates(state, "ship-1")[0].id));
  if (!res.success || !res.expedition) throw new Error(`dispatch refused: ${res.reason}`);
  return { next: res.next, exp: res.expedition };
}

// The run as a dispatch made before FKR-8 records it ("inflight": Field Kits catalog 2, no devices stamp), or with
// FKR-8's field devices stamp ("stamped").
function atStamp(exp: Expedition, stamp: Stamp): Expedition {
  if (!exp.fieldKits) throw new Error("the dispatch stamped no Field Kits flag");
  const { devices: _devices, ...kits } = exp.fieldKits as typeof exp.fieldKits & { devices?: number };
  return { ...exp, fieldKits: { ...kits, catalog: 2, ...(stamp === "stamped" ? { devices: 1 } : {}) } };
}

const HAND_RISK: BodyRiskGrades = { combat: 2, fauna: 0, flora: 0, hazard: 0 };
const AMBUSH_CHANCE = 0.45;

// HAND: one scanned body, three calm objectives (no fight points) with AMBUSH_CHANCE and two combat objectives carrying
// Reinforcing III. The teams take them in the planner's order.
function handRun(set: DeviceSet, stamp: Stamp, seed = 0xfd8a): { next: GameState; exp: Expedition } {
  const d = dispatched(crewed(seed, set));
  const pois = ["ancientRuins", "ancientRuins", "ancientRuins", "enemyColony", "derelictOutpost"];
  const base = atStamp(d.exp, stamp);
  const body: ExpeditionBody = {
    id: "body-1",
    planetType: "terrestrial",
    scanTotal: 100,
    scanProgress: 100,
    hazard: 0.1,
    scanned: true,
    discoveries: pois.map((poiId, k) => ({ id: `${base.id}-body-1-disc-${k}`, kind: "landmark", poiId })),
    activities: pois.map((poiId, k) => ({ id: `${base.id}-body-1-act-${k}`, bodyId: "body-1", poiId, done: false })),
    risk: { ...HAND_RISK },
  };
  const exp: Expedition = structuredClone({
    ...base,
    phase: "activities",
    phaseAnchorSeconds: T0,
    bodies: [body],
    scanStepCursor: Math.max(0, (base.encounterSteps ?? 1) - 1),
    groundOps: { ...base.groundOps!, startedAt: T0 },
    risk: { version: 1, tier: 1, enemyTerritory: false, system: { combat: HAND_RISK.combat, fauna: 0, flora: 0 }, difficultyTier: 1, affixCatalog: 2 },
  });
  initGroundTasks(exp, 0);
  for (const task of exp.bodies[0].activities) {
    if (task.poiId === "ancientRuins") {
      task.fightPoints = [];
      task.ambushChance = AMBUSH_CHANCE;
      delete task.affixes;
    } else {
      task.affixes = [{ id: "reinforcing", rank: 3, alignment: "negative" }];
      delete task.ambushChance;
    }
  }
  for (const team of exp.groundOps!.teams) team.stepStartedAt = T0;
  groundOpsBodyScanned(exp, 0, T0);
  groundOpsAssignIdle(exp, T0);
  return { next: d.next, exp };
}

function claimPin(next: GameState, exp: Expedition): string {
  const done = advanceExpedition(exp, FINAL);
  if (done.phase !== "complete") return `unclaimed:${done.phase}`;
  const claimed = claimExpedition({ ...next, expeditions: [done] }, done.id);
  return claimed.success ? stateHash(claimed.next) : `refused:${claimed.reason}`;
}

function handPins(set: DeviceSet, stamp: Stamp): { run: string; tally: string; claim: string } {
  const { next, exp } = handRun(set, stamp);
  const mid = advanceExpedition(exp, MID);
  const tally = mid.bodies[0].activities.map((a) => [a.poiId, a.ambushes ?? 0, a.visits ?? 0, a.fightCount ?? 0, a.status]);
  return { run: hash(mid.groundOps), tally: JSON.stringify(tally), claim: claimPin(next, exp) };
}

// The ship-event chance and the step roll at EVERY scan boundary (dispatch hour and 24 h out).
function boundaryReads(exp: Expedition): unknown[] {
  const steps = exp.encounterSteps ?? 1;
  const out: unknown[] = [];
  exp.bodies.forEach((body, i) => {
    for (let k = 1; k < steps; k += 1) {
      for (const hours of [0, 24]) out.push([i, k, hours, shipScanEventChance(exp, body, hours), scanStepRoll(exp, i, k, hours)]);
    }
  });
  return out;
}

// The ship runs' seeds: one whose ship events win no battle, one with two won ship battles (their salvage).
const SHIP_SEEDS: readonly (readonly [string, number])[] = [
  ["", 0xaadc2],
  [":salvage", 0xdef0],
];

function shipPins(set: DeviceSet, stamp: Stamp, seed: number): { reads: string; events: string; claim: string } {
  const d = dispatched(crewed(seed, set));
  const exp = atStamp(d.exp, stamp);
  expect(shipEventsLive(exp)).toBe(true);
  const done = advanceExpedition(exp, FINAL);
  return {
    reads: hash(boundaryReads(exp)),
    events: hash({ scanEvents: done.scanEvents, findings: done.findings, hull: done.groundOps?.hullDamage }),
    claim: claimPin(d.next, exp),
  };
}

const key = (set: DeviceSet, stamp: Stamp) => `${set}:${stamp}`;

// Captured on e024edf (before FKR-8).
const HAND_PINS: Record<string, { run: string; tally: string; claim: string }> = {
  "none:inflight": { run: "a131d025", tally: "[[\"ancientRuins\",0,0,0,\"done\"],[\"ancientRuins\",1,0,1,\"done\"],[\"ancientRuins\",1,0,1,\"done\"],[\"enemyColony\",0,1,4,\"done\"],[\"derelictOutpost\",0,1,6,\"done\"]]", claim: "29564982" },
  "none:stamped": { run: "a131d025", tally: "[[\"ancientRuins\",0,0,0,\"done\"],[\"ancientRuins\",1,0,1,\"done\"],[\"ancientRuins\",1,0,1,\"done\"],[\"enemyColony\",0,1,4,\"done\"],[\"derelictOutpost\",0,1,6,\"done\"]]", claim: "29564982" },
  "shroud:inflight": { run: "a131d025", tally: "[[\"ancientRuins\",0,0,0,\"done\"],[\"ancientRuins\",1,0,1,\"done\"],[\"ancientRuins\",1,0,1,\"done\"],[\"enemyColony\",0,1,4,\"done\"],[\"derelictOutpost\",0,1,6,\"done\"]]", claim: "73dd4368" },
  "shroud:stamped": { run: "a131d025", tally: "[[\"ancientRuins\",0,0,0,\"done\"],[\"ancientRuins\",1,0,1,\"done\"],[\"ancientRuins\",1,0,1,\"done\"],[\"enemyColony\",0,1,4,\"done\"],[\"derelictOutpost\",0,1,6,\"done\"]]", claim: "73dd4368" },
  "lure:inflight": { run: "a131d025", tally: "[[\"ancientRuins\",0,0,0,\"done\"],[\"ancientRuins\",1,0,1,\"done\"],[\"ancientRuins\",1,0,1,\"done\"],[\"enemyColony\",0,1,4,\"done\"],[\"derelictOutpost\",0,1,6,\"done\"]]", claim: "e8eeb216" },
  "lure:stamped": { run: "a131d025", tally: "[[\"ancientRuins\",0,0,0,\"done\"],[\"ancientRuins\",1,0,1,\"done\"],[\"ancientRuins\",1,0,1,\"done\"],[\"enemyColony\",0,1,4,\"done\"],[\"derelictOutpost\",0,1,6,\"done\"]]", claim: "e8eeb216" },
  "lureCodebreaker:inflight": { run: "a131d025", tally: "[[\"ancientRuins\",0,0,0,\"done\"],[\"ancientRuins\",1,0,1,\"done\"],[\"ancientRuins\",1,0,1,\"done\"],[\"enemyColony\",0,1,4,\"done\"],[\"derelictOutpost\",0,1,6,\"done\"]]", claim: "bdc7c5f3" },
  "lureCodebreaker:stamped": { run: "a131d025", tally: "[[\"ancientRuins\",0,0,0,\"done\"],[\"ancientRuins\",1,0,1,\"done\"],[\"ancientRuins\",1,0,1,\"done\"],[\"enemyColony\",0,1,4,\"done\"],[\"derelictOutpost\",0,1,6,\"done\"]]", claim: "bdc7c5f3" },
};
const SHIP_PINS: Record<string, { reads: string; events: string; claim: string }> = {
  "none:inflight": { reads: "f15f4531", events: "c81683ec", claim: "30f62e4b" },
  "none:inflight:salvage": { reads: "6b65277", events: "e174d427", claim: "9cc87b69" },
  "none:stamped": { reads: "f15f4531", events: "c81683ec", claim: "30f62e4b" },
  "none:stamped:salvage": { reads: "6b65277", events: "e174d427", claim: "9cc87b69" },
  "shroud:inflight": { reads: "bfde3045", events: "c2e34ea2", claim: "7b20c101" },
  "shroud:inflight:salvage": { reads: "51d3bee9", events: "a0fd9152", claim: "312e72ca" },
  "shroud:stamped": { reads: "bfde3045", events: "c2e34ea2", claim: "7b20c101" },
  "shroud:stamped:salvage": { reads: "51d3bee9", events: "a0fd9152", claim: "312e72ca" },
  "lure:inflight": { reads: "3d1708d1", events: "5a1e97dd", claim: "1569c33" },
  "lure:inflight:salvage": { reads: "b976dba3", events: "e174d427", claim: "c7cfca7d" },
  "lure:stamped": { reads: "3d1708d1", events: "5a1e97dd", claim: "1569c33" },
  "lure:stamped:salvage": { reads: "b976dba3", events: "e174d427", claim: "c7cfca7d" },
  "lureCodebreaker:inflight": { reads: "3d1708d1", events: "5a1e97dd", claim: "c0dc760c" },
  "lureCodebreaker:inflight:salvage": { reads: "b976dba3", events: "cfe916cb", claim: "f9c728dc" },
  "lureCodebreaker:stamped": { reads: "3d1708d1", events: "5a1e97dd", claim: "c0dc760c" },
  "lureCodebreaker:stamped:salvage": { reads: "b976dba3", events: "cfe916cb", claim: "f9c728dc" },
};

// MOVED AT FKR-8, named (stamped runs with a device only; every inflight pin and every run with no device holds):
//   HAND shroud      : the Shrouds lower each landing's reinforcement chance at its rolled 50 to 75%, and the Derelict
//                      Outpost's visit now brings none (6 fights to its 4 points); the run and the claim follow. The
//                      ambush rolls on the calm objectives land on the same side of the lowered chance (same ambushes).
//   HAND lure / lureCodebreaker : the Lures raise each landing's reinforcement chance, and the Enemy Colony's visit now
//                      brings reinforcements (4 fights to 6); the ambushes again land on the same side. The Codebreaker's
//                      x1.06 crosses no roll here, so the run hash is the Lure run's; the claim differs only by the trait.
//   SHIP shroud / lure / lureCodebreaker : the ship-event chance no longer reads the devices (OC-F1), so every
//                      boundary's chance and step roll is the no-device run's (`reads` equal none's at each seed) and the
//                      events follow. At the salvage seed the Shroud run's events are exactly the no-device run's (a
//                      Shroud never scales a drop); the Lure runs' two won probe battles pay a larger haul (the Lure's
//                      drop scale at each use's roll, the Codebreaker's x1.06 on top), so their events and claims move.
//                      At the first seed (no won battle) the Lure runs' claims hold: their extra events left nothing.
//                      Re-pinned at the review follow-up (D23 stacking, fieldKits.ts STACKING): the salvage reads the
//                      whole roster's two Lures, whose second now adds less (curved past one device), so the two Lure
//                      salvage-seed rows moved again (events, claims). Every HAND row holds: each crew wears one device,
//                      and one device keeps exactly its linear effect.
const FKR8_MOVED_HAND: Record<string, Partial<{ run: string; tally: string; claim: string }>> = {
  "shroud:stamped": { run: "2ccb9bbd", tally: "[[\"ancientRuins\",0,0,0,\"done\"],[\"ancientRuins\",1,0,1,\"done\"],[\"ancientRuins\",1,0,1,\"done\"],[\"enemyColony\",0,1,4,\"done\"],[\"derelictOutpost\",0,1,4,\"done\"]]", claim: "140fb1eb" },
  "lure:stamped": { run: "265d99f3", tally: "[[\"ancientRuins\",0,0,0,\"done\"],[\"ancientRuins\",1,0,1,\"done\"],[\"ancientRuins\",1,0,1,\"done\"],[\"enemyColony\",0,1,6,\"done\"],[\"derelictOutpost\",0,1,6,\"done\"]]", claim: "7c7dea46" },
  "lureCodebreaker:stamped": { run: "265d99f3", tally: "[[\"ancientRuins\",0,0,0,\"done\"],[\"ancientRuins\",1,0,1,\"done\"],[\"ancientRuins\",1,0,1,\"done\"],[\"enemyColony\",0,1,6,\"done\"],[\"derelictOutpost\",0,1,6,\"done\"]]", claim: "47d704c3" },
};
const FKR8_MOVED_SHIP: Record<string, Partial<{ reads: string; events: string; claim: string }>> = {
  "shroud:stamped": { reads: "f15f4531", events: "c81683ec", claim: "65a11485" },
  "shroud:stamped:salvage": { reads: "6b65277", events: "e174d427", claim: "3c42325f" },
  "lure:stamped": { reads: "f15f4531", events: "c81683ec" },
  "lure:stamped:salvage": { reads: "6b65277", events: "d969e64f", claim: "89664e89" },
  "lureCodebreaker:stamped": { reads: "f15f4531", events: "c81683ec" },
  "lureCodebreaker:stamped:salvage": { reads: "6b65277", events: "e534a915", claim: "a849bbbc" },
};

// The pin a run must read now: its capture, with the named FKR-8 move applied (every moved field must have moved).
function expectPinned<T extends Record<string, string>>(got: T, before: T, moved: Partial<T> | undefined): void {
  for (const [field, value] of Object.entries(moved ?? {})) expect(value, `${field} is named as moved`).not.toBe(before[field]);
  expect(got).toEqual({ ...before, ...(moved ?? {}) });
}

const captured: Record<string, unknown> = {};

describe("FKR-8 goldens: field devices on the ground and on ship events (in-flight runs unchanged, new runs moved as named)", () => {
  for (const set of DEVICE_SETS) {
    for (const stamp of STAMPS) {
      it(`HAND ${key(set, stamp)}`, { timeout: 120_000 }, () => {
        const got = handPins(set, stamp);
        if (CAPTURE) captured[`hand:${key(set, stamp)}`] = got;
        else expectPinned(got, HAND_PINS[key(set, stamp)], FKR8_MOVED_HAND[key(set, stamp)]);
      });
      for (const [tag, seed] of SHIP_SEEDS) {
        it(`SHIP ${key(set, stamp)}${tag}`, { timeout: 120_000 }, () => {
          const got = shipPins(set, stamp, seed);
          if (CAPTURE) captured[`ship:${key(set, stamp)}${tag}`] = got;
          else expectPinned(got, SHIP_PINS[`${key(set, stamp)}${tag}`], FKR8_MOVED_SHIP[`${key(set, stamp)}${tag}`]);
        });
      }
    }
  }

  it("a stamped run's ship-event chance reads no device (every device set's reads are the no-device run's)", () => {
    for (const set of DEVICE_SETS) for (const [tag] of SHIP_SEEDS) expect(FKR8_MOVED_SHIP[`${key(set, "stamped")}${tag}`]?.reads ?? SHIP_PINS[`${key(set, "stamped")}${tag}`].reads).toBe(SHIP_PINS[`${key("none", "stamped")}${tag}`].reads);
  });

  it("the hand run meets what it is pinned for: an ambush on a calm objective and reinforcements on a combat one", { timeout: 120_000 }, () => {
    const mid = advanceExpedition(handRun("none", "stamped").exp, MID);
    const tasks = mid.bodies[0].activities;
    expect(tasks.some((a) => (a.ambushes ?? 0) > 0)).toBe(true);
    expect(tasks.some((a) => (a.visits ?? 0) > 0 && (a.fightCount ?? 0) > (a.fightPoints?.length ?? 0))).toBe(true);
  });

  it("offline == live on the stamped Lure run: 997 s chunks and an event-boundary chain equal one call", { timeout: 120_000 }, () => {
    const { exp } = handRun("lure", "stamped");
    const once = advanceExpedition(exp, MID);
    let chunked = exp;
    for (let t = T0 + 997; t < MID; t += 997) chunked = advanceExpedition(chunked, t);
    chunked = advanceExpedition(chunked, MID);
    expect(hash(chunked)).toBe(hash(once));
    const times = new Set<number>();
    for (const r of once.groundOps?.history ?? []) for (const t of [r.startedAt, r.endedAt]) if (t > T0 + 1 && t + 1 < MID) times.add(t);
    let chain = exp;
    for (const t of [...times].sort((a, b) => a - b)) for (const at of [t - 1, t, t + 1]) chain = advanceExpedition(chain, at);
    chain = advanceExpedition(chain, MID);
    expect(hash(chain)).toBe(hash(once));
  });

  it.runIf(CAPTURE)("writes the capture (FKR8_CAPTURE names the file)", () => {
    writeFileSync(String(import.meta.env.FKR8_CAPTURE), JSON.stringify(captured, null, 1));
  });
});
