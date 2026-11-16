// GEAR WEAR close-out fix pass (docs/plans/2026-10-16-gear-wear-design.md, "Close-out review (2026-11-11) and USER
// ANSWERS"): golden pins of the runs the two engine answers move, captured on feat 523faa86 BEFORE the edit (the WR-8
// rule: goldens first), then re-pinned LIVE, each moved pin traced by its switch-off reproduction (the PRE pins hold
// with the switch off: gearWearCloseoutSwitch.fixture.ts).
//   "Keep the bay rate": a ship's gear keeps the doubled Shipyard bay rate until it is full, even after its hull
//     repair ends (GEAR_BAY_RATE_KEPT_SWITCH). Moves the bay rows only.
//   "Make it exact": leftover underway seconds at a context change (a run's end, a repair pause's edges, a field repair
//     leg's edges) are credited at the rate that applied (REPAIR_EXACT_EDGES_SWITCH). Moves the run-end and pause rows.
//
//   missionEnd     : a freighter on shortOreRun (stamped, use wear), 1,500 s in 1 s steps, recalled, flown home in 1 s
//                    steps, then docked: the ship's pieces at the end of the run and 7, 45 and 300 s later.
//   shortRangeEnd  : a short-range run (training cycle, then ordinary ones), 3,000 s, recalled, home, then 300 s docked.
//   pauseFirst     : a destroyer whose combat gear is at 2% dispatched on Repeat Sweep ("Repair first, then go"), 2,000 s
//                    in 1 s steps (the pause, its close and the first cycle out).
//   pauseRepeat    : a pristine destroyer on Repeat Sweep for 59,820 s in 997 s chunks (pauses mid-run; enemy torpedoes
//                    off, as the step 4 pause tests fly it).
//   bay / bayOt3   : a damaged destroyer in a Shipyard bay with every installed piece at 0, its hull repair as queued /
//                    with 3 hull Overtime steps bought at once, in 1 s steps until its gear is full: the second it was
//                    full and the pieces at the hull's end and at full.

import { describe, expect, it } from "vitest";
import { writeFileSync } from "node:fs";
import Decimal from "break_infinity.js";
import { type EquipmentInstance, type GameState, type PatrolMissionState, type ShortRangeMissionState } from "./model";
import { dispatchCaptainOnMission, dispatchCaptainOnPatrol, economyTick, installMissingCombatBaselines, processShipRepairs, recallCaptain } from "./tick";
import { pieceCondition, withPieceCondition } from "./gearWear";
import { runWearStamp } from "./gearWearEngine";
import { buyOvertime } from "./processSpeed";
import { shortRangeBoardSlots, shortRangeNextCycle, startShortRangeCycle } from "./shortRangeBoard";
import { WIRING_SHIP_ID, seatOfficer, shipOf, wiringBase } from "./wiring/probes";
import { afterGatheringTraining } from "./wiring/wearProbes";
import { onHull, hash } from "./firstRunsGoldens.fixture";
import { asPatrolVeteran } from "./awayTeamTestFixtures";
import { withCloseoutOff } from "./gearWearCloseoutSwitch.fixture";
import { withEnemyTorpedoesOff } from "./enemyTorpedoSwitch.fixture";
import { fixRoundEOffForThisFile } from "./fixRoundESwitch.fixture";

// Fix round FR-E (0.14.0): this file's fixtures launch real stars, recall and resume, or fly Repeat patrols that pause,
// climb or meet a route they would lose, and its pins are about another slice; it runs with the round's fixes off
// (fixRoundESwitch.fixture.ts), so they keep proving that slice. The round's own pins: expeditionFixRoundEGoldens and
// patrolFixRoundE tests.
fixRoundEOffForThisFile();

const CAPTURE = Boolean(import.meta.env.GWCLOSE_CAPTURE);
const RNG = () => 0.5;

function stepped(s: GameState, n: number): GameState {
  let out = s;
  for (let i = 0; i < n; i++) out = economyTick(out, 1, RNG);
  return out;
}

const pieces = (s: GameState, shipId: string): EquipmentInstance[] => s.equipment.filter((e) => e.fittedToShipId === shipId);
const row = (s: GameState, shipId: string): string => `${pieces(s, shipId).map((e) => `${e.slotType}:${pieceCondition(e)}@${e.conditionAt ?? "-"}`).join(",")}#${hash(s.equipment)}`;

function fleetBase(): GameState {
  const s = installMissingCombatBaselines(seatOfficer(afterGatheringTraining(wiringBase()), "operations", []));
  return { ...s, captains: s.captains.map((c) => ({ ...c, level: 10 })) };
}

// Recalled, flown home in 1 s steps, then 300 s docked: [the run's end, 300 s later].
function endAndDock(s0: GameState, shipId: string): string[] {
  let s = recallCaptain(s0, 1).next;
  let guard = 0;
  while (s.captains[0].mission !== null && guard++ < 50_000) s = economyTick(s, 1, RNG);
  expect(s.captains[0].mission).toBeNull();
  const out = [`end:${row(s, shipId)}`];
  for (const [mark, n] of [[7, 7], [45, 38], [300, 255]] as const) {
    s = stepped(s, n);
    out.push(`+${mark}:${row(s, shipId)}`);
  }
  return out;
}

function missionEnd(): string[] {
  const r = dispatchCaptainOnMission(fleetBase(), 1, "shortOreRun");
  expect(r.success).toBe(true);
  return endAndDock(stepped(r.next, 1500), WIRING_SHIP_ID);
}

function shortRangeEnd(): string[] {
  const base = fleetBase();
  const s0: GameState = { ...base, facilities: { ...base.facilities, missionControl: { ...base.facilities.missionControl, level: 9 } } };
  const slot = shortRangeBoardSlots(s0)[0];
  const wear = runWearStamp(s0, WIRING_SHIP_ID);
  const start = startShortRangeCycle(s0, shipOf(s0), slot, shortRangeNextCycle(s0, slot.id), wear, true);
  const mission: ShortRangeMissionState = { kind: "shortRange", slotId: slot.id, roll: start.roll, plan: start.plan, phase: "transitOut", phaseProgressTicks: 0, recalled: false, gearWear: wear };
  const s: GameState = { ...s0, captains: s0.captains.map((c, i) => (i === 0 ? { ...c, mission } : c)), runCounts: start.runCounts };
  return endAndDock(stepped(s, 3000), WIRING_SHIP_ID);
}

const COMBAT = ["weapon", "reactorCore", "ftlDrive", "shieldEmitters", "hullPlating", "droneBay"];
const veteran = (): GameState => asPatrolVeteran({ ...onHull("destroyer"), nextPatrolSeed: 1, credits: new Decimal(1_000_000) });
const wornAt = (s: GameState, slots: readonly string[] | null, c: number): GameState => ({
  ...s,
  equipment: s.equipment.map((e) => (e.fittedToShipId === "ship-1" && (slots === null || slots.includes(e.slotType)) ? withPieceCondition(e, c, s.gameTimeSeconds) : e)),
});

function pauseFirst(): string[] {
  const r = dispatchCaptainOnPatrol(wornAt(veteran(), COMBAT, 20), 1, "crimsonReaverSweep", "balanced", true);
  expect(r.success).toBe(true);
  expect((r.next.captains[0].mission as PatrolMissionState).repairPause?.first).toBe(true);
  const out: string[] = [];
  let s = r.next;
  for (const [mark, n] of [[300, 300], [1000, 700], [2000, 1000]] as const) {
    s = stepped(s, n);
    out.push(`${mark}:${row(s, "ship-1")}`, `${mark}:${hash(s.captains)}`);
  }
  return out;
}

// (enemy torpedoes off, as the step 4 pause tests fly it, so the run lives long enough to pause mid-run)
function pauseRepeat(): string[] {
  return withEnemyTorpedoesOff(() => {
    const r = dispatchCaptainOnPatrol(veteran(), 1, "crimsonReaverSweep", "balanced", true);
    expect(r.success).toBe(true);
    const out: string[] = [];
    let s = r.next;
    for (let t = 997; t <= 59_820; t += 997) {
      s = economyTick(s, 997, RNG);
      if (t % (997 * 10) === 0) out.push(`${t}:${row(s, "ship-1")}`, `${t}:${hash(s.captains)}`);
    }
    out.push(`pauses:${(s.captains[0].mission as PatrolMissionState | null)?.repairPausesThisRun ?? "ended"}`);
    return out;
  });
}

function bay(overtimeSteps: number): string[] {
  const damaged = wornAt({ ...veteran(), ships: veteran().ships.map((sh) => (sh.id === "ship-1" ? { ...sh, damaged: true, repairDamage: 620 } : sh)) }, null, 0);
  let s = processShipRepairs(damaged);
  const repair = s.activeProcesses.find((p) => p.kind === "shipRepair")!;
  expect(repair).toBeDefined();
  for (let i = 0; i < overtimeSteps; i++) s = buyOvertime(s, { kind: "process", id: repair.id }).next;
  const out = [`hullTicks:${repair.durationTicks}`];
  let t = 0;
  let hullDone: number | null = null;
  while (pieces(s, "ship-1").some((e) => e.condition !== undefined) && t < 10_000) {
    s = economyTick(s, 1, RNG);
    t += 1;
    if (hullDone === null && !s.activeProcesses.some((p) => p.kind === "shipRepair")) {
      hullDone = t;
      out.push(`hull:${t}:${row(s, "ship-1")}`);
    }
  }
  out.push(`full:${t}:${row(s, "ship-1")}`);
  return out;
}

const ROWS: Record<string, () => string[]> = {
  missionEnd,
  shortRangeEnd,
  pauseFirst,
  pauseRepeat,
  bay: () => bay(0),
  bayOt3: () => bay(3),
};

// Captured on 523faa86 (feat head) BEFORE the close-out edit.
const PRE: Record<string, string[]> = {
  missionEnd: ["end:cargoBay:970@1532,ftlDrive:1000@-,reactorCore:981@1532,specUtility:970@1532,weapon:1000@-,weapon:1000@-,shieldEmitters:1000@-,hullPlating:1000@-#7be8b0eb", "+7:cargoBay:975@1539.5,ftlDrive:1000@-,reactorCore:986@1539.5,specUtility:975@1539.5,weapon:1000@-,weapon:1000@-,shieldEmitters:1000@-,hullPlating:1000@-#2473ab62", "+45:cargoBay:1000@-,ftlDrive:1000@-,reactorCore:1000@-,specUtility:1000@-,weapon:1000@-,weapon:1000@-,shieldEmitters:1000@-,hullPlating:1000@-#1acb1083", "+300:cargoBay:1000@-,ftlDrive:1000@-,reactorCore:1000@-,specUtility:1000@-,weapon:1000@-,weapon:1000@-,shieldEmitters:1000@-,hullPlating:1000@-#1acb1083"],
  shortRangeEnd: ["end:cargoBay:1000@-,ftlDrive:947@3091.5,reactorCore:1000@-,specUtility:1000@-,weapon:1000@-,weapon:1000@-,shieldEmitters:1000@-,hullPlating:1000@-#9f0a4aa4", "+7:cargoBay:1000@-,ftlDrive:952@3099,reactorCore:1000@-,specUtility:1000@-,weapon:1000@-,weapon:1000@-,shieldEmitters:1000@-,hullPlating:1000@-#c363ef8b", "+45:cargoBay:1000@-,ftlDrive:977@3136.5,reactorCore:1000@-,specUtility:1000@-,weapon:1000@-,weapon:1000@-,shieldEmitters:1000@-,hullPlating:1000@-#64cf2399", "+300:cargoBay:1000@-,ftlDrive:1000@-,reactorCore:1000@-,specUtility:1000@-,weapon:1000@-,weapon:1000@-,shieldEmitters:1000@-,hullPlating:1000@-#1acb1083"],
  pauseFirst: ["300:cargoBay:1000@-,ftlDrive:20@0,reactorCore:20@0,specUtility:1000@-,weapon:20@0,weapon:20@0,weapon:20@0,weapon:20@0,shieldEmitters:20@0,hullPlating:20@0#de50c81", "300:a15dcf66", "1000:cargoBay:1000@-,ftlDrive:20@0,reactorCore:20@0,specUtility:1000@-,weapon:20@0,weapon:20@0,weapon:20@0,weapon:20@0,shieldEmitters:20@0,hullPlating:20@0#de50c81", "1000:b6928d72", "2000:cargoBay:1000@-,ftlDrive:463@1575,reactorCore:531@1575,specUtility:1000@-,weapon:423@1575,weapon:443@1575,weapon:483@1575,weapon:463@1575,shieldEmitters:264@1595,hullPlating:973@1589#a0caf19", "2000:856c7561"],
  pauseRepeat: ["9970:cargoBay:1000@-,ftlDrive:333@9565,reactorCore:390@9565,specUtility:1000@-,weapon:293@9565,weapon:423@9565,weapon:173@9565,weapon:283@9565,shieldEmitters:1@9584,hullPlating:935@9583#279a1fd0", "9970:90540dab", "19940:cargoBay:1000@-,ftlDrive:254@19398,reactorCore:339@19398,specUtility:1000@-,weapon:224@19398,weapon:264@19398,weapon:104@19398,weapon:304@19398,shieldEmitters:0@19390,hullPlating:970@19391#fc9674ec", "19940:fbd59810", "29910:cargoBay:1000@-,ftlDrive:184@28825,reactorCore:373@28825,specUtility:1000@-,weapon:134@28825,weapon:154@28825,weapon:34@28825,weapon:74@28825,shieldEmitters:1@28844,hullPlating:920@28827#162bfaaa", "29910:1d39fdf9", "39880:cargoBay:1000@-,ftlDrive:202@38692,reactorCore:237@38692,specUtility:1000@-,weapon:82@38692,weapon:82@38692,weapon:102@38692,weapon:52@38692,shieldEmitters:1@38714,hullPlating:784@38714#4265c4fb", "39880:2832a968", "49850:cargoBay:1000@-,ftlDrive:452@48563,reactorCore:563@48563,specUtility:1000@-,weapon:472@48563,weapon:502@48563,weapon:492@48563,weapon:482@48563,shieldEmitters:104@48584,hullPlating:978@48569#13d4b33b", "49850:c14a992a", "59820:cargoBay:1000@-,ftlDrive:104@58439,reactorCore:240@58439,specUtility:1000@-,weapon:14@58439,weapon:104@58439,weapon:94@58439,weapon:184@58439,shieldEmitters:0@58430,hullPlating:842@58432#402d16da", "59820:d7126019", "pauses:37"],
  bay: ["hullTicks:330", "hull:330:cargoBay:440@330,ftlDrive:440@330,reactorCore:440@330,specUtility:440@330,weapon:440@330,weapon:440@330,weapon:440@330,weapon:440@330,shieldEmitters:440@330,hullPlating:440@330#168732bb", "full:1170:cargoBay:1000@-,ftlDrive:1000@-,reactorCore:1000@-,specUtility:1000@-,weapon:1000@-,weapon:1000@-,weapon:1000@-,weapon:1000@-,shieldEmitters:1000@-,hullPlating:1000@-#fbacc285"],
  bayOt3: ["hullTicks:330", "hull:189:cargoBay:252@189,ftlDrive:252@189,reactorCore:252@189,specUtility:252@189,weapon:252@189,weapon:252@189,weapon:252@189,weapon:252@189,shieldEmitters:252@189,hullPlating:252@189#bac82b1f", "full:1311:cargoBay:1000@-,ftlDrive:1000@-,reactorCore:1000@-,specUtility:1000@-,weapon:1000@-,weapon:1000@-,weapon:1000@-,weapon:1000@-,shieldEmitters:1000@-,hullPlating:1000@-#fbacc285"],
};

// LIVE (the close-out on): only the rows it moved, each traced by the switch-off test above (its PRE pin holds off).
//   missionEnd, shortRangeEnd ("Make it exact"): the run's leftover underway seconds were credited at the home rate
//     (the drive back to full at the run's end, 1000, where the exact credit leaves it at 993; the short-range reactor
//     984 where it read 1000), so the docked marks trail by up to about 2%, then catch up.
//   bay, bayOt3 ("Keep the bay rate"): the gear's full second, 1,170 s and 1,311 s (hull Overtime made it LATER) to
//     750 s in both (1000 per-mille at the bay's 80 a minute); the hull's own end and its pieces then are unchanged.
//   pauseFirst, pauseRepeat: unmoved (a pause repairs its combat pieces to full, so the credited leftover never shows
//     after it closes; a patrol records no use wear).
const LIVE: Partial<Record<string, string[]>> = {
  missionEnd: ["end:cargoBay:968@1532.8,ftlDrive:993@1532.4,reactorCore:979@1532.8,specUtility:968@1532.8,weapon:1000@-,weapon:1000@-,shieldEmitters:1000@-,hullPlating:1000@-#ad7931a1", "+7:cargoBay:972@1538.8,ftlDrive:998@1539.9,reactorCore:983@1538.8,specUtility:972@1538.8,weapon:1000@-,weapon:1000@-,shieldEmitters:1000@-,hullPlating:1000@-#2e9e5219", "+45:cargoBay:998@1577.8,ftlDrive:1000@-,reactorCore:1000@-,specUtility:998@1577.8,weapon:1000@-,weapon:1000@-,shieldEmitters:1000@-,hullPlating:1000@-#27644661", "+300:cargoBay:1000@-,ftlDrive:1000@-,reactorCore:1000@-,specUtility:1000@-,weapon:1000@-,weapon:1000@-,shieldEmitters:1000@-,hullPlating:1000@-#1acb1083"],
  shortRangeEnd: ["end:cargoBay:1000@-,ftlDrive:934@3091,reactorCore:984@3090.75,specUtility:1000@-,weapon:1000@-,weapon:1000@-,shieldEmitters:1000@-,hullPlating:1000@-#96de3151", "+7:cargoBay:1000@-,ftlDrive:939@3098.5,reactorCore:989@3098.25,specUtility:1000@-,weapon:1000@-,weapon:1000@-,shieldEmitters:1000@-,hullPlating:1000@-#bf45de06", "+45:cargoBay:1000@-,ftlDrive:964@3136,reactorCore:1000@-,specUtility:1000@-,weapon:1000@-,weapon:1000@-,shieldEmitters:1000@-,hullPlating:1000@-#5afead20", "+300:cargoBay:1000@-,ftlDrive:1000@-,reactorCore:1000@-,specUtility:1000@-,weapon:1000@-,weapon:1000@-,shieldEmitters:1000@-,hullPlating:1000@-#1acb1083"],
  bay: ["hullTicks:330", "hull:330:cargoBay:440@330,ftlDrive:440@330,reactorCore:440@330,specUtility:440@330,weapon:440@330,weapon:440@330,weapon:440@330,weapon:440@330,shieldEmitters:440@330,hullPlating:440@330#168732bb", "full:750:cargoBay:1000@-,ftlDrive:1000@-,reactorCore:1000@-,specUtility:1000@-,weapon:1000@-,weapon:1000@-,weapon:1000@-,weapon:1000@-,shieldEmitters:1000@-,hullPlating:1000@-#fbacc285"],
  bayOt3: ["hullTicks:330", "hull:189:cargoBay:252@189,ftlDrive:252@189,reactorCore:252@189,specUtility:252@189,weapon:252@189,weapon:252@189,weapon:252@189,weapon:252@189,shieldEmitters:252@189,hullPlating:252@189#bac82b1f", "full:750:cargoBay:1000@-,ftlDrive:1000@-,reactorCore:1000@-,specUtility:1000@-,weapon:1000@-,weapon:1000@-,weapon:1000@-,weapon:1000@-,shieldEmitters:1000@-,hullPlating:1000@-#fbacc285"],
};

describe("gear wear close-out goldens", () => {
  if (CAPTURE) {
    it("capture", () => {
      const out: Record<string, string[]> = {};
      for (const [k, f] of Object.entries(ROWS)) out[k] = f();
      writeFileSync(String(import.meta.env.GWCLOSE_CAPTURE), JSON.stringify(out, null, 1));
    }, 600_000);
    return;
  }
  for (const [k, f] of Object.entries(ROWS)) {
    it(`${k}: the PRE pin holds with the close-out switches off`, () => {
      expect(withCloseoutOff(f)).toEqual(PRE[k]);
    }, 600_000);
    it(`${k}: LIVE ${LIVE[k] ? "moves as traced" : "unmoved"}`, () => {
      expect(f()).toEqual(LIVE[k] ?? PRE[k]);
    }, 600_000);
  }
});

