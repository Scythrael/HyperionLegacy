// Gas Giant Study x the user's answer of 2026-10-23 (verbatim, plan docs/plans/2026-10-17-gas-giant-study-plan.md):
// "I think the ship should be able to stop mid-scan and pick back up where it left off, so going to get the team from
// where they are is fine. Then go back and continue scanning."
//
// GOLDENS FIRST: a run dispatched before the change (no pickup-pause stamp) resolves exactly as it did: its shuttles
// still wait for the study or the sweep (GG-3 studyPickupAt). These pins were captured on the build before the change.

import { describe, expect, it } from "vitest";
import { SUBSPACE_TELESCOPE_FACILITY_KEY, freshState, type AwayMember, type Expedition, type GameState, type ShipGroundTeam } from "./model";
import { advanceExpedition } from "./expedition";
import { RETURN_SECONDS } from "./groundOps";
import { dispatchPastPropulsion, plainAwayMember, withoutPickupPause } from "./awayTeamTestFixtures";
import { fnv, goldenJson } from "./firstRunsGoldens.fixture";

const SEC = ["member-1", "member-2", "member-3", "member-4", "member-5", "member-6"];
const SCI = ["member-11", "member-12", "member-13", "member-14", "member-15", "member-16"];
const T0 = 100_000;
const hash = (v: unknown): string => fnv(goldenJson(v));

function crewed(): GameState {
  const base = freshState();
  const m = (id: string, t: AwayMember["teamType"]): AwayMember => ({ ...plainAwayMember(id, t, "ship-1"), rank: 10 as AwayMember["rank"] });
  const teams: ShipGroundTeam[] = [
    { kind: "ground", security: SEC.slice(0, 3), science: SCI.slice(0, 3), helpOthers: false },
    { kind: "ground", security: SEC.slice(3), science: SCI.slice(3), helpOthers: false },
  ];
  return {
    ...base,
    gameTimeSeconds: T0,
    nextExpeditionId: 2,
    facilities: { ...base.facilities, [SUBSPACE_TELESCOPE_FACILITY_KEY]: { level: 8 } },
    awayMembers: [...SEC.map((id) => m(id, "security")), ...SCI.map((id) => m(id, "science"))],
    nextAwayMemberId: 100,
    ships: base.ships.map((sh) => ({ ...sh, groundTeams: teams })),
  };
}

// The GG-0 gas giant system (a fresh save's candidate 2: one giant, the last body, and a nebula); both teams' last
// pickups waited behind the study and the sweep on the build before the change.
function pickupFixture(): Expedition {
  const res = dispatchPastPropulsion(crewed(), "ship-1", 1, "cand-1-2");
  if (!res.success || !res.expedition) throw new Error(`dispatch refused: ${res.reason}`);
  return res.expedition;
}

function runTo(exp: Expedition, step: number, horizon = 400_000): Expedition {
  let run = exp;
  for (let t = exp.phaseAnchorSeconds + step; t <= exp.phaseAnchorSeconds + horizon; t += step) run = advanceExpedition(run, t);
  return run;
}

// Pinned before the change (2026-10-23, on gg-6 31e1fc3).
const GOLDEN = {
  oldRun600: "124dbee8",
  oldRun997: "124dbee8",
  oldRunOneCall: "124dbee8",
};

describe("pickup pause: a run dispatched before the change resolves exactly as stored", () => {
  const old = withoutPickupPause(pickupFixture());

  it("the whole run, stepped at 600 s and 997 s and in one call", () => {
    const out = {
      oldRun600: hash(runTo(old, 600)),
      oldRun997: hash(runTo(old, 997)),
      oldRunOneCall: hash(advanceExpedition(old, old.phaseAnchorSeconds + 400_000)),
    };
    expect(out).toEqual(GOLDEN);
  });

  it("the fixture really holds a shuttle that waited for a study or the sweep (the case the change touches)", () => {
    const ops = runTo(old, 600).groundOps!;
    const waited = ops.history.filter(
      (r) => r.step === "return" && !r.recovered && r.endedAt - r.startedAt > RETURN_SECONDS && (ops.studyLegs ?? []).some((l) => l.endsAt === r.endedAt),
    );
    expect(waited.length).toBeGreaterThan(0);
  });
});
