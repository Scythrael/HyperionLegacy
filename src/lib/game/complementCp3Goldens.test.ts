// Complement and Acquisition CP-3 (docs/plans/2026-10-14-complement-and-acquisition-plan.md section 3 CP-3; wiring
// plan answers OC-E1 "Resist enemy debuffs", OC-E2 "Shorter bay time"): golden hashes captured on the code BEFORE the
// engine edit (on top of b95a878). The fixtures (complementCp3.fixture.ts) are real Ground Ops runs whose ship carries
// the four CP-3 keys (Counter-Infiltration, Away-Team Protection, Triage, Prevent a Crew Loss) or, as the control,
// only keys CP-3 does not touch.
//
// The CP-3 wiring commit re-pins ONLY what a CP-3 key moves (GOLDEN), each with its reason beside it, and proves the
// move with the four keys switched off (complementCp3Switch.fixture.ts withCp3Off): every fixture then reproduces
// its capture (BEFORE).

// Ordering determinism part 2 (canonicalOrder.ts: inventory keys and a call's completion log in one order) came after every pin here, traced order-only: the file runs with it off (ordering2Switch.fixture.ts).
import { ordering2OffForThisFile } from "./ordering2Switch.fixture";
ordering2OffForThisFile();
import { describe, expect, it } from "vitest";
// Relics v2 source planets (user 2026-11-13 "First + count") came after these pins: each blank now also carries its
// planet's name (display only). The file runs with the stamp off, so every pin reproduces as captured (relicPlanet.fixture.ts).
import { planetStampOffForThisFile } from "./relicPlanet.fixture";
planetStampOffForThisFile();
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
import { shipCrewContribution } from "./crewOverlay";
import { CREW_STAT_KEYS } from "./crewBuffs";
import { CP3_CONTROL_CREW, CP3_CREW, CP3_MEDICAL_CREW, CP3_SECURITY_CREW, CP3_SEEDS, cp3Run, cp3State, type Cp3Fixture } from "./complementCp3.fixture";
import type { CrewBucket } from "./model";
import { withCp3Off } from "./complementCp3Switch.fixture";
import { wr11OffForThisFile } from "./wr11Switch.fixture";
// Wiring WR-11 came after every pin here: the whole file runs with WR-11 off (wr11Switch.fixture.ts), so its pins keep
// proving their own slice moved nothing else (WR-11's own moves are pinned in wr11Goldens.test.ts).
wr11OffForThisFile();

// Captured on the code BEFORE the engine edit (b95a878).
const BEFORE: Record<Cp3Fixture, string[]> = {
  security: ["369ba123", "55bf1f05", "98506974"],
  medical: ["19444ff3", "32f8abbc", "a7f3240"],
  all: ["6cf5bf63", "b34f6ee2", "57343822"],
  control: ["e9ef1561", "763cc6ee", "de8a65f6"],
};

// The pins today. Each move names its reason; an unchanged pin equals BEFORE.
const GOLDEN: Record<Cp3Fixture, string[]> = {
  // MOVES: the dispatch freezes squadHpBonus and squadDebuffResist (the record and the run carry them). The claimed
  // state is unchanged: the bigger HP and the resist change no fight's outcome or bay time on this seed.
  // CP-3 fix round (user 2026-10-30 "Round up"): the added HP rounds up, so the finished run's squad HP moves again
  // (the end hash; was ae625665). The combined resist moved nothing here: no member has a resist of their own, and
  // with none the combination is the crew's share alone, as before.
  security: ["d7578cb8", "f765ca5a", BEFORE.security[2]],
  // MOVES: squadTriage carries the crew's Triage and the factors freeze preventLossShare. The claim is unchanged: this
  // seed's bay stays are Health only (Prevent a Crew Loss is for injuries) and the stronger first aid lands no
  // different outcome.
  medical: ["1d65838b", "4b32e210", BEFORE.medical[2]],
  // MOVES: all four keys frozen, and on this seed they reshape the fights (Triage's heals and the bigger HP), so the
  // run ends sooner and the claimed state (the member's bay end, the clock) moves too.
  // CP-3 fix round (user 2026-10-30 "Round up"): the added HP rounds up, so the finished run moves again (the end
  // hash; was 4645678); the claimed state is the same as at CP-3.
  all: ["7fcf8766", "a21a10f7", "ad5f4741"],
  // Unchanged (the control): its crew holds no CP-3 key.
  control: BEFORE.control,
};

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

  it("the switch proof: with the four CP-3 keys off every fixture reproduces its pre-CP-3 capture", () => {
    for (const name of Object.keys(CP3_SEEDS) as Cp3Fixture[]) {
      expect(withCp3Off(() => cp3Run(CP3_CREW[name], CP3_SEEDS[name]).out), name).toEqual(BEFORE[name]);
    }
  });
});
