// Gas Giant Study x the user's answer of 2026-10-23 (verbatim, plan docs/plans/2026-10-17-gas-giant-study-plan.md):
// "I think the ship should be able to stop mid-scan and pick back up where it left off, so going to get the team from
// where they are is fine. Then go back and continue scanning."
//
// GOLDENS FIRST: a run dispatched before the change (no pickup-pause stamp) resolves exactly as it did: its shuttles
// still wait for the study or the sweep (GG-3 studyPickupAt). These pins were captured on the build before the change.

import { describe, expect, it } from "vitest";
import { SUBSPACE_TELESCOPE_FACILITY_KEY, freshState, type AwayMember, type Expedition, type GameState, type ShipGroundTeam } from "./model";
import { advanceExpedition, flaggedScanTimeline } from "./expedition";
import { IN_SYSTEM_LEG_SECONDS, RETURN_SECONDS, groundLegTeams, pickupPauseSlot, studyLegShare, studyPickupAt } from "./groundOps";
import { NEBULA_SWEEP_SECONDS, isStudyBody, studySeconds } from "./gasGiantStudy";
import { shipNowText, timelineView } from "../groundOpsTimelineDisplay";
import { studyBodyView, studyShipCardView } from "../gasGiantStudyDisplay";
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

  it("a shuttle that waited really docked at studyPickupAt (the old rule, engine-driven)", () => {
    const ops = runTo(old, 600).groundOps!;
    const returns = ops.history.filter((r) => r.step === "return" && !r.recovered && !r.stopped);
    expect(returns.length).toBeGreaterThan(0);
    for (const r of returns) expect(r.endedAt, `${r.teamIndex} at ${r.startedAt}`).toBe(studyPickupAt(ops, r.startedAt + RETURN_SECONDS));
    expect(ops.shipLegs.every((l) => l.studyPause === undefined)).toBe(true);
    expect((ops.studyLegs ?? []).every((l) => l.pauses === undefined)).toBe(true);
  });
});

// Pinned with the change: the same system stamped (a new run).
const GOLDEN_NEW = { newRun600: "affce7e6", newRun997: "affce7e6", newRunOneCall: "affce7e6" };

describe("pickup pause: a new study run (the user's answer)", () => {
  const fresh = pickupFixture();

  it("is stamped on a study run only, right after the study stamps", () => {
    expect(fresh.pickupPause).toBe(1);
    const keys = Object.keys(fresh);
    expect(keys.indexOf("pickupPause")).toBe(keys.indexOf(fresh.nebula ? "nebula" : "study") + 1);
    const res = dispatchPastPropulsion(crewed(), "ship-1", 1, "cand-1-0");
    const plain = res.expedition!;
    if (!plain.study && !plain.nebula) expect("pickupPause" in plain).toBe(false);
  });

  it("no shuttle waits behind a study or the sweep: the ship pauses it, flies the pickup and the team docks when it arrives", () => {
    const ops = runTo(fresh, 600).groundOps!;
    const pickups = ops.shipLegs.filter((l) => l.pickup === 1);
    expect(pickups.length).toBeGreaterThan(0);
    for (const r of ops.history) {
      if (r.step !== "return" || r.recovered || r.stopped) continue;
      if (r.studyPickup) {
        // Engine-driven: the team docked exactly when its pickup leg arrived.
        expect(pickups.some((l) => l.arrivesAt === r.endedAt && groundLegTeams(l).includes(r.teamIndex))).toBe(true);
      } else {
        // An ordinary shuttle docks on time (nothing held the ship then).
        expect(r.endedAt - r.startedAt).toBe(RETURN_SECONDS);
      }
    }
    expect(ops.history.some((r) => r.studyPickup)).toBe(true);
  });

  it("each pickup lies inside the study it paused; the study keeps its whole length outside the pauses", () => {
    const run = runTo(fresh, 600);
    const ops = run.groundOps!;
    for (const leg of ops.shipLegs.filter((l) => l.studyPause === 1)) {
      expect(leg.scanBodyIndex).toBeNull();
      expect(leg.endsAt - leg.startsAt).toBe(2 * IN_SYSTEM_LEG_SECONDS);
      const study = (ops.studyLegs ?? []).find((s) => (s.pauses ?? []).some((p) => p.from === leg.startsAt && p.to === leg.endsAt));
      expect(study, `pickup at ${leg.startsAt}`).toBeDefined();
      expect(study!.startsAt).toBeLessThanOrEqual(leg.startsAt);
      expect(study!.endsAt).toBeGreaterThan(leg.endsAt);
    }
    for (const s of ops.studyLegs ?? []) {
      const paused = (s.pauses ?? []).reduce((a, p) => a + (p.to - p.from), 0);
      const own = s.nebula === 1 ? NEBULA_SWEEP_SECONDS : studySeconds(run, run.bodies[s.bodyIndex]);
      expect(s.endsAt - s.startsAt - paused, `study ${s.bodyIndex}`).toBe(own);
    }
    // Legs never overlap except a pickup inside the study it paused.
    const all = [...ops.shipLegs.map((l) => ({ ...l, inside: l.studyPause === 1 })), ...(ops.studyLegs ?? []).map((l) => ({ ...l, inside: false }))].sort((a, b) => a.startsAt - b.startsAt);
    const outer = all.filter((l) => !l.inside);
    for (let i = 1; i < outer.length; i++) expect(outer[i].startsAt).toBeGreaterThanOrEqual(outer[i - 1].endsAt);
  });

  it("nothing is lost or counted twice: the studies' rewards equal the old run's, and their share holds still during a pause", () => {
    const run = runTo(fresh, 600);
    const before = runTo(withoutPickupPause(fresh), 600);
    const studyFinds = (r: Expedition) => r.findings.filter((f) => f.source === "study").map((f) => ({ id: f.id, materials: f.materials }));
    expect(studyFinds(run)).toEqual(studyFinds(before));
    const study = (run.groundOps!.studyLegs ?? []).find((s) => (s.pauses ?? []).length > 0)!;
    const p = study.pauses![0];
    expect(studyLegShare({ ...study, done: undefined }, p.from)).toBeCloseTo(studyLegShare({ ...study, done: undefined }, p.to), 12);
    expect(studyLegShare({ ...study, done: undefined }, study.endsAt)).toBe(1);
    expect(studyLegShare({ ...study, done: undefined }, study.startsAt)).toBe(0);
  });

  it("offline == live: 600 s, 997 s and one call give the same run (pinned)", () => {
    const out = {
      newRun600: hash(runTo(fresh, 600)),
      newRun997: hash(runTo(fresh, 997)),
      newRunOneCall: hash(advanceExpedition(fresh, fresh.phaseAnchorSeconds + 400_000)),
    };
    expect(out.newRun997).toBe(out.newRun600);
    expect(out.newRunOneCall).toBe(out.newRun600);
    expect(out).toEqual(GOLDEN_NEW);
  });

  it("the timeline and the study card show the pause and the resume", () => {
    const run = runTo(fresh, 600);
    const ops = run.groundOps!;
    const leg = ops.shipLegs.find((l) => l.pickup === 1)!;
    const mid = advanceExpedition(fresh, leg.startsAt + 30);
    expect(shipNowText(mid, null, leg.startsAt + 30)).toMatch(/^(Study|Sweep) paused: flying to pick up /);
    const card = studyShipCardView(mid, null, leg.startsAt + 30, () => null)!;
    expect(card.title).toMatch(/paused for a pickup$/);
    expect(card.tail).toMatch(/^It resumes where it left off: /);
    const i = mid.bodies.findIndex((b) => isStudyBody(mid, b));
    const row = studyBodyView(mid, i, leg.startsAt + 30);
    const study = mid.groundOps!.studyLegs!.find((s) => (s.pauses ?? []).some((p) => p.from === leg.startsAt))!;
    if (study.nebula !== 1) expect(row!.chips.map((c) => c.text)).toContain("Paused for a pickup");
    const after = advanceExpedition(fresh, leg.endsAt + 30);
    const resumed = after.groundOps!.studyLegs!.find((s) => s.bodyIndex === study.bodyIndex)!;
    if (study.nebula !== 1 && resumed.endsAt > leg.endsAt + 30) {
      expect(studyBodyView(after, i, leg.endsAt + 30)!.chips.map((c) => c.text).join(" ")).toMatch(/Resumed after|Paused for a pickup/);
    }
    // The team lane reads a pickup, never a wipe; the old hatched wait is not drawn on a new run.
    const view = timelineView(run, null, ops.endedAt!, "whole", flaggedScanTimeline)!;
    expect(view.lanes.some((l) => l.segments.some((s) => s.label === "pickup"))).toBe(true);
    expect(view.lanes.some((l) => l.segments.some((s) => s.category === "wait"))).toBe(false);
    expect(view.lanes.some((l) => l.segments.some((s) => s.category === "wipe"))).toBe(false);
    // An old run still draws its hatched wait.
    const oldRun = runTo(withoutPickupPause(fresh), 600);
    const oldView = timelineView(oldRun, null, oldRun.groundOps!.endedAt!, "whole", flaggedScanTimeline)!;
    expect(oldView.lanes.some((l) => l.segments.some((s) => s.category === "wait"))).toBe(true);
  });
});

describe("pickup pause: the slot", () => {
  it("waits out the ship's other legs, then pauses the study that holds it; none when no study does", () => {
    const study = { kind: "study" as const, bodyIndex: 1, scanBodyIndex: null, startsAt: 100, endsAt: 1000 };
    const leg = { kind: "recovery" as const, teamIndex: 0, bodyIndex: 0, scanBodyIndex: null, startsAt: 200, arrivesAt: 500, endsAt: 800, studyPause: 1 as const };
    expect(pickupPauseSlot({ shipLegs: [], studyLegs: [study] }, 150)).toEqual({ from: 150, study });
    expect(pickupPauseSlot({ shipLegs: [leg], studyLegs: [study] }, 300)).toEqual({ from: 800, study });
    expect(pickupPauseSlot({ shipLegs: [], studyLegs: [study] }, 1000)).toBeNull();
    expect(pickupPauseSlot({ shipLegs: [], studyLegs: [{ ...study, done: true as const }] }, 150)).toBeNull();
  });
});
