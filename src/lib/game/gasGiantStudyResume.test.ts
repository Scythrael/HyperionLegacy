// Gas Giant Study GG-3 x Expedition Tiers G2-5 (merge review, 0.14.0): a recalled study run's giant and the resumed
// system. User G12 "Pick up where you left off": a giant whose study was cut short by the recall is studied on the
// resumed trip; a giant studied on the first trip is not studied again, counts as done in the progress, and a system
// whose every objective and every study is done leaves no resumable record.

import { describe, expect, it } from "vitest";
import { freshState, type AwayMember, type Expedition, type GameState, type ShipGroundTeam } from "./model";
import { advanceExpedition, claimExpedition, expeditionCandidates, heldSystems, recallExpedition, startExpedition } from "./expedition";
import { groundOpsProgress } from "./groundOps";
import { isStudyBody } from "./gasGiantStudy";
import { installMissingCombatBaselines } from "./tick";
import { asExpeditionVeteran, plainAwayMember } from "./awayTeamTestFixtures";

// Fix round FR-E (0.14.0): this file runs with the round on, so its resume paths are pinned on the rules the game plays
// (a recall keeps the rolled scan boundaries of the body it cut short, a real star's bodies are the star's).

const T0 = 100_000;
const FINAL = T0 + 3_000_000;
const SEC = ["member-1", "member-2", "member-3", "member-4", "member-5", "member-6"];
const SCI = ["member-11", "member-12", "member-13", "member-14", "member-15", "member-16"];

function crewed(expeditionSeed: number): GameState {
  const base = freshState();
  const m = (id: string, t: AwayMember["teamType"]): AwayMember => ({ ...plainAwayMember(id, t, "ship-1"), rank: 10 as AwayMember["rank"] });
  const teams: ShipGroundTeam[] = [
    { kind: "ground", security: SEC.slice(0, 3), science: SCI.slice(0, 3), helpOthers: false },
    { kind: "ground", security: SEC.slice(3), science: SCI.slice(3), helpOthers: false },
  ];
  const s: GameState = {
    ...base,
    gameTimeSeconds: T0,
    nextExpeditionId: 2,
    expeditionSeed,
    awayMembers: [...SEC.map((id) => m(id, "security")), ...SCI.map((id) => m(id, "science"))],
    nextAwayMemberId: 100,
    ships: base.ships.map((sh) => ({ ...sh, typeKey: "orion" as const, groundTeams: teams })),
  };
  return asExpeditionVeteran(installMissingCombatBaselines(s));
}

const at = (state: GameState, t: number): GameState => ({ ...state, gameTimeSeconds: t });

// The first Tier I study run of the fixture whose giant has a body still to scan after it (so a recall mid-study
// leaves a resumable system). Searched over save seeds; deterministic.
function studyRun(): { state: GameState; exp: Expedition; giant: number } {
  for (let seed = 1; seed < 400; seed += 1) {
    const s = crewed(seed);
    for (const c of expeditionCandidates(s, "ship-1", 1)) {
      const res = startExpedition(s, "ship-1", 1, c.id);
      if (!res.success || !res.expedition?.study) continue;
      const exp = res.expedition;
      const giant = exp.bodies.findIndex((b) => isStudyBody(exp, b));
      if (giant >= 0 && giant < exp.bodies.length - 1) return { state: res.next, exp, giant };
    }
  }
  throw new Error("no fixture study run");
}

// Advance until the giant's study is under way; returns that time.
function midStudy(exp: Expedition, giant: number): number {
  for (let t = exp.phaseAnchorSeconds + 30; t < FINAL; t += 30) {
    const leg = advanceExpedition(exp, t).groundOps?.studyLegs?.find((l) => l.bodyIndex === giant);
    if (leg && leg.startsAt < t && t < leg.endsAt) return t;
  }
  throw new Error("the study never ran");
}

function recallAndClaim(state: GameState, exp: Expedition, t: number): GameState {
  const s1 = recallExpedition(at(state, t), exp.id);
  const home = advanceExpedition(s1.expeditions[0], FINAL);
  const s2 = claimExpedition({ ...s1, gameTimeSeconds: home.phaseAnchorSeconds, expeditions: [home] }, exp.id).next;
  // (The Shipyard repairs any hull damage the scan events left before the resumed launch.)
  return { ...s2, ships: s2.ships.map(({ damaged: _d, repairDamage: _r, ...sh }) => sh as GameState["ships"][number]), activeProcesses: [] };
}

function finish(run: Expedition): Expedition {
  const done = advanceExpedition(run, FINAL);
  expect(done.phase).toBe("complete");
  return done;
}

describe("GG-3 x G2-5: a recalled study run's giant on the resumed trip", () => {
  it("a study cut short by the recall is flown again on the resumed trip (and pays then, once)", () => {
    const { state, exp, giant } = studyRun();
    const t = midStudy(exp, giant);
    const s2 = recallAndClaim(state, exp, t);
    const [held] = heldSystems(s2);
    expect(held.kind).toBe("resume");
    expect(held.bodies![giant].scanned).toBe(true);
    const res = startExpedition(s2, "ship-1", 1, held.id);
    expect(res.success, res.reason).toBe(true);
    const done = finish(res.expedition!);
    expect(done.groundOps!.studyLegs?.filter((l) => l.bodyIndex === giant && l.done).length).toBe(1);
    expect(done.findings.filter((f) => f.source === "study" && f.id.endsWith(`-${giant}`)).length).toBe(1);
    expect(groundOpsProgress(done, done.phaseAnchorSeconds)).toBe(1);
    // offline == live: one call == 997 s chunks, and 1 s steps across the resumed study.
    const run = res.expedition!;
    const leg = done.groundOps!.studyLegs!.find((l) => l.bodyIndex === giant)!;
    let chunked = run;
    for (let s = run.phaseAnchorSeconds + 997; s < FINAL; s += 997) chunked = advanceExpedition(chunked, s);
    expect(advanceExpedition(chunked, FINAL)).toEqual(done);
    let stepped = advanceExpedition(run, leg.startsAt - 30);
    for (let s = leg.startsAt - 29; s <= leg.endsAt + 30; s += 1) stepped = advanceExpedition(stepped, s);
    expect(advanceExpedition(stepped, FINAL)).toEqual(done);
  });

  it("a giant studied on the first trip is not studied again, and counts as done in the resumed run's progress", () => {
    const { state, exp, giant } = studyRun();
    const studied = advanceExpedition(exp, FINAL).groundOps!.studyLegs!.find((l) => l.bodyIndex === giant)!;
    // Recall just after the study ends, while a later body is still to scan (the giant is not the last body).
    const t = studied.endsAt + 1;
    expect(advanceExpedition(exp, t).bodies.some((b) => !b.scanned)).toBe(true);
    const s2 = recallAndClaim(state, exp, t);
    const held = heldSystems(s2)[0];
    expect(held.kind).toBe("resume");
    const res = startExpedition(s2, "ship-1", 1, held.id);
    expect(res.success, res.reason).toBe(true);
    const done = finish(res.expedition!);
    expect(done.groundOps!.studyLegs?.some((l) => l.bodyIndex === giant) ?? false).toBe(false);
    expect(done.findings.some((f) => f.source === "study" && f.id.endsWith(`-${giant}`))).toBe(false);
    expect(groundOpsProgress(done, done.phaseAnchorSeconds)).toBe(1);
  });
});
