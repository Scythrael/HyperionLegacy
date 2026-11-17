// E-MOD EM-4 review (2026-10-23): the readouts read what the engine reads.
//
//   - The install compare and the readout's gear note (ShipSystemsPanel) read the gear-only sheet WITH the Reactor
//     Core's drive rule (crewOverlay.ts gearSheetWithReactorDrive): a crafted core never compares as slower.
//   - A captain mission in flight is read on its own run sheet (gearWearEngine.ts missionRunSheet: its gear wear stamp
//     and its reactor lift flag) by the Home row, the mission card (App.svelte) and the transit berth wait (berths.ts),
//     exactly the sheet the engine flies it on: a run dispatched before EM-4 (no flag) on a crafted-core ship, and a run
//     whose drive was worn at dispatch, both count down to the tick the engine leaves the leg, and neither is reported
//     waiting for a berth mid-transit.
//   - A malformed reactor lift flag (null included) never counts.
//
// Gear wear stays ON in this file (the worn-drive case needs the run's wear stamp).

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import Decimal from "break_infinity.js";
import { SHIP_TYPES, shipDerivedStats, type CaptainMissionState, type GameState, type ShipTypeKey } from "./model";
import { dispatchCaptainOnMission, economyTick } from "./tick";
import { effectiveShipStats, gearSheetWithReactorDrive } from "./crewOverlay";
import { equippedFor } from "./equipmentQueries";
import { buildHomeDashboard } from "./homeDashboard";
import { isAwaitingBerth } from "./berths";
import { reactorLiftFlagged } from "./reactorSurplus";
import { onHull } from "./firstRunsGoldens.fixture";
import { installPiece } from "./wiring/probes";
import { EM4_SHIP, em4Core, withCore, worstCore } from "./emodEm4.fixture";
import { withReactorLiftOff } from "./emodEm4Switch.fixture";
import { crewModuleSiOffForThisFile } from "./crewModuleSiSwitch.fixture";

// Standard-Issue crew modules (0.14.0, user 2026-11-17 "free basic set, all ships"): this file's pins predate the
// free Sensor Suite, Bridge Module and Crew Quarters every ship now carries (their berths, officer lift, hull bonus
// and equipment ids), so the set is off here and the pins keep proving their own slice. The set itself is pinned in
// crewModuleStandardIssue.test.ts.
crewModuleSiOffForThisFile();

const RNG = (): number => 0.5;
const HULLS = Object.keys(SHIP_TYPES) as ShipTypeKey[];
const ship1 = (s: GameState) => s.ships.find((sh) => sh.id === EM4_SHIP)!;
const mission = (s: GameState) => s.captains[0].mission as CaptainMissionState;

describe("EM-4 review: the gear-only drive fold (the install compare, the gear note)", () => {
  it("a crafted core never compares as slower; the floor is the Standard-Issue gear sheet exactly; a light core is faster", () => {
    for (const hull of HULLS) {
      const si = onHull(hull);
      const siGear = shipDerivedStats(ship1(si), equippedFor(si, EM4_SHIP)).transitSpeedMult;
      for (let iLevel = 1; iLevel <= 40; iLevel += 3) {
        for (const variety of ["efficientCore", "balancedCore", "highOutputCore"]) {
          const s = withCore(si, worstCore(variety, iLevel));
          expect(gearSheetWithReactorDrive(ship1(s), equippedFor(s, EM4_SHIP)).transitSpeedMult, `${hull} ${variety} iL${iLevel}`).toBeGreaterThanOrEqual(siGear);
        }
      }
      const ref = withCore(si, em4Core("ref"));
      expect(gearSheetWithReactorDrive(ship1(ref), equippedFor(ref, EM4_SHIP)).transitSpeedMult).toBe(siGear);
      const top = withCore(si, em4Core("top"));
      expect(gearSheetWithReactorDrive(ship1(top), equippedFor(top, EM4_SHIP)).transitSpeedMult).toBeGreaterThan(siGear);
      // On a crew-free ship the gear-only rule is the engine's own rule.
      for (const s of [ref, top]) expect(gearSheetWithReactorDrive(ship1(s), equippedFor(s, EM4_SHIP)).transitSpeedMult).toBe(effectiveShipStats(s, ship1(s)).transitSpeedMult);
    }
  });

  it("is the raw gear fold with the Standard-Issue core and while the switch is off", () => {
    const si = onHull("destroyer");
    expect(gearSheetWithReactorDrive(ship1(si), equippedFor(si, EM4_SHIP))).toEqual(shipDerivedStats(ship1(si), equippedFor(si, EM4_SHIP)));
    const ref = withCore(si, em4Core("ref"));
    expect(withReactorLiftOff(() => gearSheetWithReactorDrive(ship1(ref), equippedFor(ref, EM4_SHIP)))).toEqual(shipDerivedStats(ship1(ref), equippedFor(ref, EM4_SHIP)));
  });

  it("ShipSystemsPanel builds the install compare (both sides) and the readout's gear note on it", () => {
    const src = readFileSync("src/lib/ShipSystemsPanel.svelte", "utf8");
    expect(src).toContain("const candStats = gearSheetWithReactorDrive(ship, candidateGear);");
    expect(src).toContain("buildLiveRows(fitDriveStats ?? fitStats, candStats)");
    expect(src).toContain("gearSheetWithReactorDrive(ship, fittedPieces)");
    expect(src).toContain("gear: d.get(fitDriveStats ?? fitStats)");
  });
});

// ===== a captain mission in flight =====

function freighter(s: GameState): GameState {
  return { ...s, credits: new Decimal(1_000_000), captains: s.captains.map((c) => ({ ...c, level: 10 })) };
}

// Steps `s` until the mission enters `phase`, then counts the engine's ticks in it, checking at every tick that the
// Home row's duration and the berth wait agree with the engine. Returns the ticks the engine spent in the phase.
function phaseAgrees(s0: GameState, phase: "transitOut" | "transitBack"): number {
  let s = s0;
  for (let i = 0; i < 5000 && mission(s).phase !== phase; i++) s = economyTick(s, 1, RNG);
  expect(mission(s).phase).toBe(phase);
  const row = () => buildHomeDashboard(s).inProgress.find((x) => x.id === "extraction-1")!;
  const shown = row().durationTicks;
  let ticks = 0;
  while (mission(s).phase === phase) {
    // Berths are free here, so the engine never holds: a run is never "waiting for a berth" while it still flies.
    expect(isAwaitingBerth(s, s.captains[0]), `berth at ${ticks}`).toBe(false);
    s = economyTick(s, 1, RNG);
    ticks += 1;
    if (ticks > 5000) throw new Error("the phase never ended");
  }
  expect(shown, `${phase} duration`).toBe(ticks);
  return ticks;
}

describe("EM-4 review: in-flight readouts read the run's own sheet", () => {
  it("a run dispatched before EM-4 (no flag) on a crafted-core ship: the readouts count its unlifted legs", () => {
    const s0 = freighter(withCore(onHull("generalFreighter"), em4Core("ref")));
    const r = withReactorLiftOff(() => dispatchCaptainOnMission(s0, 1, "shortOreRun"));
    expect(mission(r.next).reactorLift).toBeUndefined();
    const out = phaseAgrees(r.next, "transitOut");
    const back = phaseAgrees(r.next, "transitBack");
    // The unlifted legs (the core's mass drag), longer than the floored legs a dispatch now flies.
    const now = dispatchCaptainOnMission(s0, 1, "shortOreRun").next;
    expect(phaseAgrees(now, "transitOut")).toBeLessThan(out);
    expect(back).toBe(out);
  });

  it("a run whose drive was worn at dispatch: the readouts count the worn (frozen) legs", () => {
    const base = freighter(onHull("generalFreighter"));
    const worn = installPiece(base, { slotType: "ftlDrive", implicitStats: { transitSpeedMult: 20 }, condition: 100, conditionAt: base.gameTimeSeconds });
    const r = dispatchCaptainOnMission(worn, 1, "longOreRun");
    expect(mission(r.next).gearWear?.frozen).toBeDefined();
    const pristine = dispatchCaptainOnMission(installPiece(base, { slotType: "ftlDrive", implicitStats: { transitSpeedMult: 20 } }), 1, "longOreRun");
    expect(phaseAgrees(r.next, "transitOut")).toBeGreaterThan(phaseAgrees(pristine.next, "transitOut"));
  });

  it("App.svelte's mission card reads the run sheet", () => {
    const src = readFileSync("src/App.svelte", "utf8");
    expect(src).toContain("effectiveMissionDef(MISSIONS[mission.missionKey], missionRunSheet(state, missionShip, mission))");
  });

  it("a malformed captain-mission flag (null) never counts: the run flies and reads unlifted legs", () => {
    expect(reactorLiftFlagged(null)).toBe(false);
    expect(reactorLiftFlagged({ version: 2 })).toBe(false);
    expect(reactorLiftFlagged({ version: 1 })).toBe(true);
    const s0 = freighter(withCore(onHull("generalFreighter"), em4Core("ref")));
    const flagged = dispatchCaptainOnMission(s0, 1, "shortOreRun").next;
    const nulled: GameState = { ...flagged, captains: flagged.captains.map((c, i) => (i === 0 ? { ...c, mission: { ...mission(flagged), reactorLift: null as unknown as { version: 1 } } } : c)) };
    const unflagged = withReactorLiftOff(() => dispatchCaptainOnMission(s0, 1, "shortOreRun")).next;
    expect(phaseAgrees(nulled, "transitOut")).toBe(phaseAgrees(unflagged, "transitOut"));
  });
});
