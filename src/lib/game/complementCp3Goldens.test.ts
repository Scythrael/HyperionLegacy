// Complement and Acquisition CP-3 (docs/plans/2026-10-14-complement-and-acquisition-plan.md section 3 CP-3; wiring
// plan answers OC-E1 "Resist enemy debuffs", OC-E2 "Shorter bay time"): golden hashes captured on the code BEFORE the
// engine edit (on top of b95a878). The fixtures (complementCp3.fixture.ts) are real Ground Ops runs whose ship carries
// the four CP-3 keys (Counter-Infiltration, Away-Team Protection, Triage, Prevent a Crew Loss) or, as the control,
// only keys CP-3 does not touch.
//
// The CP-3 wiring commit re-pins ONLY what a CP-3 key moves (GOLDEN), each with its reason beside it, and proves the
// move with the four keys switched off (complementCp3Switch.fixture.ts withCp3Off): every fixture then reproduces
// its capture (BEFORE).

import { describe, expect, it } from "vitest";
import { shipCrewContribution } from "./crewOverlay";
import { CREW_STAT_KEYS } from "./crewBuffs";
import { CP3_CONTROL_CREW, CP3_CREW, CP3_MEDICAL_CREW, CP3_SECURITY_CREW, CP3_SEEDS, cp3Run, cp3State, type Cp3Fixture } from "./complementCp3.fixture";
import type { CrewBucket } from "./model";

// Captured on the code BEFORE the engine edit (b95a878).
const BEFORE: Record<Cp3Fixture, string[]> = {
  security: ["369ba123", "55bf1f05", "98506974"],
  medical: ["19444ff3", "32f8abbc", "a7f3240"],
  all: ["6cf5bf63", "b34f6ee2", "57343822"],
  control: ["e9ef1561", "763cc6ee", "de8a65f6"],
};

// The pins today. Each move names its reason; an unchanged pin equals BEFORE.
const GOLDEN: Record<Cp3Fixture, string[]> = { ...BEFORE };

const CP3_KEYS = [CREW_STAT_KEYS.counterInfiltration, CREW_STAT_KEYS.awayTeamProtection, CREW_STAT_KEYS.triage, CREW_STAT_KEYS.preventCrewLoss];

describe("CP-3 goldens (captured before the Ground Ops complement consumers)", () => {
  it("each fixture holds the keys it claims", () => {
    const keys = (b: readonly CrewBucket[]) => {
      const s = cp3State(b, 1);
      return shipCrewContribution(s, s.ships[0]);
    };
    const sec = keys(CP3_SECURITY_CREW);
    expect(sec[CREW_STAT_KEYS.counterInfiltration]).toBeGreaterThan(0);
    expect(sec[CREW_STAT_KEYS.awayTeamProtection]).toBeGreaterThan(0);
    const med = keys(CP3_MEDICAL_CREW);
    expect(med[CREW_STAT_KEYS.triage]).toBeGreaterThan(0);
    expect(med[CREW_STAT_KEYS.preventCrewLoss]).toBeGreaterThan(0);
    const ctl = keys(CP3_CONTROL_CREW);
    for (const k of CP3_KEYS) expect(ctl[k] ?? 0).toBe(0);
  });

  for (const name of Object.keys(CP3_SEEDS) as Cp3Fixture[]) {
    it(`${name}: a Ground Ops run (dispatch, end, claim)`, () => {
      const { exp, out } = cp3Run(CP3_CREW[name], CP3_SEEDS[name]);
      expect(exp.groundOps).toBeDefined();
      expect(out).toEqual(GOLDEN[name]);
    });
  }
});
