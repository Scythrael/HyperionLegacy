// Gas Giant Study x the user's answer of 2026-10-23 (verbatim, plan docs/plans/2026-10-17-gas-giant-study-plan.md):
// "I think the ship should be able to stop mid-scan and pick back up where it left off, so going to get the team from
// where they are is fine. Then go back and continue scanning."
//
// GOLDENS FIRST: a run dispatched before the change (no pickup-pause stamp) resolves exactly as it did: its shuttles
// still wait for the study or the sweep (GG-3 studyPickupAt). These pins were captured on the build before the change.

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
import { SUBSPACE_TELESCOPE_FACILITY_KEY, freshState, type AwayMember, type Expedition, type GameState, type ShipGroundTeam } from "./model";
import { advanceExpedition, flaggedScanTimeline } from "./expedition";
import { IN_SYSTEM_LEG_SECONDS, RETURN_SECONDS, groundLegTeams, pausePaysOff, pickupPauseSlot, studyLegShare, studyPickupAt, waitDockAt } from "./groundOps";
import { NEBULA_SWEEP_SECONDS, isStudyBody, studySeconds } from "./gasGiantStudy";
import { shipNowText, timelineView } from "../groundOpsTimelineDisplay";
import { studyBodyView, studyShipCardView } from "../gasGiantStudyDisplay";
import { asPreStaggerDispatch, dispatchPastPropulsion, plainAwayMember, withoutPickupPause } from "./awayTeamTestFixtures";
import { fnv, goldenJson } from "./firstRunsGoldens.fixture";
// Gear wear step 4 (0.14.0): every run here was pinned before step 4 stamped a new run for battle wear (the stamp's
// `battle`, its ship battle snapshot's frozen reactor and drive), so the file runs with the battle sources off.
import { battleWearOffInThisFile } from "./battleWearSwitch.fixture";
import { wr11OffForThisFile } from "./wr11Switch.fixture";

// Fix round FR-E (0.14.0): this file runs with the round on (its weak-crew fixture is found, see wipeFixture).
// Wiring WR-11 came after every pin here: the whole file runs with WR-11 off (wr11Switch.fixture.ts), so its pins keep
// proving their own slice moved nothing else (WR-11's own moves are pinned in wr11Goldens.test.ts).
wr11OffForThisFile();
battleWearOffInThisFile();

const SEC = ["member-1", "member-2", "member-3", "member-4", "member-5", "member-6"];
const SCI = ["member-11", "member-12", "member-13", "member-14", "member-15", "member-16"];
const T0 = 100_000;
const hash = (v: unknown): string => fnv(goldenJson(v));

// ship-1 with two Ground teams of six rank 10 members (the default), or three thinner teams of `rank` members (the
// GG-6 pause review's weak-crew fixture, whose teams wipe); `seed` sets the save's expedition seed.
function crewed(seed?: number, rank = 10, teamsN: 2 | 3 = 2): GameState {
  const base = freshState();
  const m = (id: string, t: AwayMember["teamType"]): AwayMember => ({ ...plainAwayMember(id, t, "ship-1"), rank: rank as AwayMember["rank"] });
  const teams: ShipGroundTeam[] =
    teamsN === 2
      ? [
          { kind: "ground", security: SEC.slice(0, 3), science: SCI.slice(0, 3), helpOthers: false },
          { kind: "ground", security: SEC.slice(3), science: SCI.slice(3), helpOthers: false },
        ]
      : [0, 1, 2].map((k) => ({ kind: "ground" as const, security: SEC.slice(2 * k, 2 * k + 2), science: SCI.slice(2 * k, 2 * k + 2), helpOthers: false }));
  return {
    ...base,
    gameTimeSeconds: T0,
    nextExpeditionId: 2,
    ...(seed !== undefined ? { expeditionSeed: seed } : {}),
    facilities: { ...base.facilities, [SUBSPACE_TELESCOPE_FACILITY_KEY]: { level: 8 } },
    awayMembers: [...SEC.map((id) => m(id, "security")), ...SCI.map((id) => m(id, "science"))],
    nextAwayMemberId: 100,
    ships: base.ships.map((sh) => ({ ...sh, groundTeams: teams })),
  };
}

// The GG-0 gas giant system (a fresh save's candidate 2: one giant, the last body, and a nebula); both teams' last
// pickups waited behind the study and the sweep on the build before the change.
function pickupFixture(): Expedition {
  // Relics v2 tier stagger (after these pins): a pre-stagger dispatch (asPreStaggerDispatch, no draw moves).
  const res = asPreStaggerDispatch(dispatchPastPropulsion(crewed(), "ship-1", 1, "cand-1-2"));
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

describe("pickup pause: only when it brings the team aboard sooner (GG-6 pause review)", () => {
  it("a team ready with less than a leg's flight of study left waits; one with more is collected", () => {
    const study = { kind: "study" as const, bodyIndex: 1, scanBodyIndex: null, startsAt: 0, endsAt: 1000 };
    const ops = { studyLegs: [study] };
    // Ready at 800: the shuttle would land at 860 and dock at 1000 by waiting; a pickup from 800 arrives at 1100.
    expect(waitDockAt(ops, 800)).toBe(1000);
    expect(pausePaysOff(ops, 800, 800 + IN_SYSTEM_LEG_SECONDS)).toBe(false);
    // Ready at 200: waiting docks at 1000; the pickup arrives at 500.
    expect(pausePaysOff(ops, 200, 200 + IN_SYSTEM_LEG_SECONDS)).toBe(true);
    // A tie waits (never worse, never a pause for nothing).
    expect(pausePaysOff(ops, 400, 1000)).toBe(false);
  });

  it("engine-driven: the review's example (save seed 0x51f15e + 29 x 977, cand-3-1) docks by waiting 105 s, not a 300 s pickup", () => {
    const res = dispatchPastPropulsion(crewed(0x51f15e + 29 * 977), "ship-1", 1, "cand-3-1");
    const exp = res.expedition!;
    expect(exp.pickupPause).toBe(1);
    const ops = advanceExpedition(exp, exp.phaseAnchorSeconds + 4_000_000).groundOps!;
    const waited = ops.history.filter((r) => r.step === "return" && !r.recovered && !r.studyPickup && !r.stopped && r.endedAt - r.startedAt > RETURN_SECONDS);
    expect(waited.length).toBeGreaterThan(0);
    for (const r of waited) {
      // It docked at a study's end, sooner than any pickup could have arrived.
      expect((ops.studyLegs ?? []).some((l) => l.endsAt === r.endedAt)).toBe(true);
      expect(r.endedAt - r.startedAt).toBeLessThan(IN_SYSTEM_LEG_SECONDS + RETURN_SECONDS);
    }
    // Every pickup the ship flew arrived sooner than the shuttle would have docked by waiting at that moment.
    for (const r of ops.history.filter((x) => x.studyPickup)) expect(r.endedAt - r.startedAt).toBeLessThanOrEqual(IN_SYSTEM_LEG_SECONDS + IN_SYSTEM_LEG_SECONDS);
  });
});

describe("pickup pause: a wiped team (the recovery leg pauses the study too)", () => {
  // The review's weak crew: three thin teams of rank 1 members on a Tier II study run whose wiped team's recovery leg
  // pauses the study. The review's capture was save seed 0x51f15e + 2 x 977, cand-2-1; that slot is the Orion Nebula, whose
  // bodies fix round FR-E's star rule (lane 3 I2) now draws from the star, so the fixture is the first such run from
  // that save seed on (found once, then fixed for the file).
  const hasRecoveryPause = (exp: Expedition): boolean =>
    advanceExpedition(exp, exp.phaseAnchorSeconds + 4_000_000).groundOps!.shipLegs.some((l) => l.studyPause === 1 && l.pickup === undefined);
  let found: { save: number; id: string } | null = null;
  const wipeFixture = (): Expedition => {
    if (found === null) {
      for (let k = 2; k < 200 && found === null; k++) {
        const save = 0x51f15e + k * 977;
        for (const id of ["cand-2-0", "cand-2-1", "cand-2-2"]) {
          const res = dispatchPastPropulsion(crewed(save, 1, 3), "ship-1", 1, id, true);
          if (res.success && res.expedition?.study && hasRecoveryPause(res.expedition)) {
            found = { save, id };
            break;
          }
        }
      }
    }
    if (found === null) throw new Error("no weak-crew study run with a recovery leg that pauses the study");
    const res = dispatchPastPropulsion(crewed(found.save, 1, 3), "ship-1", 1, found.id, true);
    if (!res.success || !res.expedition) throw new Error(`dispatch refused: ${res.reason}`);
    return res.expedition;
  };

  it("the recovery leg carries studyPause and no pickup; the team comes home recovered, never a study pickup", () => {
    const exp = wipeFixture();
    const run = advanceExpedition(exp, exp.phaseAnchorSeconds + 4_000_000);
    const ops = run.groundOps!;
    const leg = ops.shipLegs.find((l) => l.studyPause === 1 && l.pickup === undefined)!;
    expect(leg).toBeDefined();
    expect(leg.scanBodyIndex).toBeNull();
    const study = (ops.studyLegs ?? []).find((s) => (s.pauses ?? []).some((p) => p.from === leg.startsAt && p.to === leg.endsAt))!;
    expect(study).toBeDefined();
    // Read just after the pickup lands (the step history is capped per team, so a long weak-crew run ages it out).
    const landed = advanceExpedition(exp, leg.arrivesAt + 1).groundOps!;
    for (const ti of groundLegTeams(leg)) {
      const rec = landed.history.find((r) => r.step === "return" && r.teamIndex === ti && r.endedAt === leg.arrivesAt)!;
      expect(rec, `team ${ti}`).toBeDefined();
      expect(rec.recovered).toBe(true);
      expect(rec.studyPickup).toBeUndefined();
    }
    // The study's share holds still through the pause.
    const p = study.pauses!.find((x) => x.from === leg.startsAt)!;
    const open = { ...study, done: undefined };
    expect(studyLegShare(open, p.from)).toBeCloseTo(studyLegShare(open, p.to), 12);
  });

  it("offline == live (600 s, 997 s and one call), the lane draws the wipe and the leg says recovery leg", () => {
    const exp = wipeFixture();
    const done = advanceExpedition(exp, exp.phaseAnchorSeconds + 4_000_000);
    const leg = done.groundOps!.shipLegs.find((l) => l.studyPause === 1 && l.pickup === undefined)!;
    // Up to a while after the window closes (the return flight is a pure function of the stored record from there).
    const horizon = done.groundOps!.endedAt! - exp.phaseAnchorSeconds + 1200;
    const one = advanceExpedition(exp, exp.phaseAnchorSeconds + horizon);
    // Stepped, then one last call to the same horizon (the steps stop at the last whole step before it).
    const stepped = (step: number) => advanceExpedition(runTo(exp, step, horizon), exp.phaseAnchorSeconds + horizon);
    expect(hash(stepped(600))).toBe(hash(one));
    expect(hash(stepped(997))).toBe(hash(one));
    // The lane right after the wiped team is collected: the lost fight draws as a wipe, the leg as a paused recovery leg.
    const t = leg.arrivesAt + 1;
    const view = timelineView(advanceExpedition(exp, t), null, t, "whole", flaggedScanTimeline)!;
    expect(view.lanes.some((l) => l.segments.some((s) => s.category === "wipe"))).toBe(true);
    const legText = view.ship.steps.map((s) => s.text).filter((x) => /paused: recovery leg to /.test(x));
    expect(legText.length).toBeGreaterThan(0);
  }, 300_000);
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
