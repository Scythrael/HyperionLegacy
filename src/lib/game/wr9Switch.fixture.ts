// Wiring WR-9 (docs/plans/2026-10-15-wiring-registry-and-audit-plan.md section 4 WR-9): the test-only switch golden
// files use to prove what WR-9 moved (the withWr11Off precedent). TEST-ONLY (imported by *.test.ts files only).
//
// WR-9 moves these things: a captain mission dispatch stamps the Pilot's Cunning (CaptainMissionState.pilotCunning, a
// chance per cycle to fly home a tick sooner, OC-E4); an expedition dispatch freezes Command Presence on its objective
// hauls (Expedition.groundOutputShare) and Operations Integrity on its offload (GroundOpsFactors.offloadSteady, OC-E9);
// a generated crewmember whose rank carries three buffs rolls a third from its profession pool (CrewSignature.buff3Id,
// OC-E12). With the switch OFF (model.ts WR9_SWITCH.live false, for one call or one file, restored after) none of these is
// written, so every run and crewmember made inside it is the pre-WR-9 game exactly.

import { afterAll } from "vitest";
import { WR9_SWITCH } from "./model";

export function withWr9Off<T>(run: () => T): T {
  const was = WR9_SWITCH.live;
  WR9_SWITCH.live = false;
  try {
    return run();
  } finally {
    WR9_SWITCH.live = was;
  }
}

// For a golden FILE captured before WR-9 whose pins are about another slice: the whole file runs with WR-9 off, and its
// pins keep proving that slice moved nothing else. Called once at the file's top level, restored after its last test.
export function wr9OffForThisFile(): void {
  const was = WR9_SWITCH.live;
  WR9_SWITCH.live = false;
  afterAll(() => {
    WR9_SWITCH.live = was;
  });
}
