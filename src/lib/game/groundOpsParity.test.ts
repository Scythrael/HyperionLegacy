// Ground Operations GO-7b: the COMBINED OPERATIONS WINDOW on a real dispatched run, and offline == live parity.
//
// One pinned run (two plain-ish Security members, a 2+ body system) exercises everything the timeline has to
// keep chunking-proof: OVERLAP (the team works body 1 while the ship scans body 2, user Q1), a WIPE while the
// ship is scanning (a RECOVERY LEG: the ship breaks off, the scan pauses, the team's return ends when the ship
// arrives), CARRY DAMAGE between the fights of one attempt (user Q5), and a RETRY of a lost task after the bay.
// One big advance == 997 s chunks == 1 s chunks over the first 2 hours of the window (deep-equal).

import { describe, expect, it } from "vitest";
import { freshState, type AwayMember, type Expedition } from "./model";
import { advanceExpedition, expeditionCandidates, expeditionPhaseFraction, scanRatePerSecond } from "./expedition";
import { IN_SYSTEM_LEG_SECONDS, groundShipPosition, scanClockAt, scanClockToTime } from "./groundOps";
import { asPreFieldKitsDispatch, plainAwayMember, withSlottedAwayTeams, withoutEnemyRanks, withoutGroundOps, withoutShipEvents, dispatchPastPropulsion } from "./awayTeamTestFixtures";
import { deserialize, migrate, serialize, type SaveFile } from "./save";

const member = (id: string, teamType: AwayMember["teamType"], over: Partial<AwayMember> = {}): AwayMember => ({
  ...plainAwayMember(id, teamType, "ship-1"),
  ...over,
});
const SQUAD: AwayMember[] = [
  member("member-1", "security", { rank: 3 }),
  member("member-2", "security", { rank: 2, traits: ["fieldMedic"] }),
  member("member-11", "science"),
];
// Pinned by a seed search (the scenario assertions below fail loudly if a change ever moves it off).
const SEED = 0x0a13bd4;
// Ground Ops GO-8: the run as dispatched before the ship-side scan events (withoutShipEvents), so this file keeps
// pinning the GO-7b window it was written for; the ship events' own parity lives in shipScanEvents.test.ts.
const TWO_HOURS = 7200;

function dispatch(): Expedition {
  const s = withSlottedAwayTeams({ ...freshState(), awayMembers: SQUAD.map((m) => ({ ...m })), nextAwayMemberId: 100, expeditionSeed: SEED });
  const res = asPreFieldKitsDispatch(dispatchPastPropulsion(s, "ship-1", 1, expeditionCandidates(s, "ship-1")[0].id));
  if (!res.success || !res.expedition) throw new Error(`dispatch refused: ${res.reason}`);
  // Field Kits FKR-1: and before enemy ranks, so the seed's pinned scenarios (late wipes, a recovery leg) hold.
  return withoutShipEvents(withoutEnemyRanks(res.expedition));
}

// The time the window opened (the scanning phase anchor), read off an advance past the transit.
function windowOpen(exp: Expedition): number {
  let t = 0;
  let e = exp;
  while (e.groundOps!.startedAt === undefined) {
    t += 600;
    e = advanceExpedition(exp, t);
  }
  return e.groundOps!.startedAt!;
}

describe("GO-7b the combined operations window (user Q1) on a real run", () => {
  const exp = dispatch();
  const open = windowOpen(exp);
  const at2h = advanceExpedition(exp, open + TWO_HOURS);
  const ops = at2h.groundOps!;

  it("the pinned run has the scenario: 2+ bodies, overlap, a recovery leg while scanning, a retry", () => {
    expect(exp.bodies.length).toBeGreaterThanOrEqual(2);
    expect(ops.shipLegs.length).toBeGreaterThanOrEqual(1);
    const losses = ops.history.filter((r) => r.outcome === "loss");
    expect(losses.some((l) => ops.history.some((r) => r.step === "fight" && r.taskId === l.taskId && r.startedAt > l.endedAt))).toBe(true);
  });

  it("OVERLAP: the team works the first scanned body while the ship is still scanning the rest", () => {
    const firstDeploy = ops.history.find((r) => r.step === "deploy")!;
    const scanned = advanceExpedition(exp, firstDeploy.startedAt);
    expect(scanned.bodies[0].scanned).toBe(true);
    expect(scanned.bodies.some((b) => !b.scanned)).toBe(true);
    expect(scanned.phase).toBe("scanning");
    // The first deploy is the first body's completion (the moment its tasks appear).
    expect(firstDeploy.startedAt).toBe(scanClockToTime(scanned.groundOps!, exp.bodies[0].scanTotal / scanRatePerSecond(exp, exp.bodies[0])));
  });

  it("a WIPE while scanning sends the ship on a RECOVERY LEG: it breaks off, the team's return ends on arrival, the scan pauses for the leg", () => {
    const leg = ops.shipLegs[0];
    expect(leg.arrivesAt - leg.startsAt).toBe(IN_SYSTEM_LEG_SECONDS);
    expect(leg.endsAt - leg.startsAt).toBe(2 * IN_SYSTEM_LEG_SECONDS);
    expect(leg.scanBodyIndex).toBeGreaterThan(leg.bodyIndex);
    // The team's return step is the ship's flight to it, flagged on the display record.
    const ret = ops.history.find((r) => r.step === "return" && r.startedAt === leg.startsAt)!;
    expect(ret).toMatchObject({ endedAt: leg.arrivesAt, recovered: true });
    const lost = ops.history.find((r) => r.step === "fight" && r.endedAt === leg.startsAt)!;
    expect(lost.outcome).toBe("loss");
    // Ship position: away on the leg, then back on its scan.
    expect(groundShipPosition(at2h, leg.startsAt + 1)).toEqual({ kind: "recovery", leg });
    // The scan clock stops for the whole leg.
    expect(scanClockAt(ops, leg.endsAt) - scanClockAt(ops, leg.startsAt)).toBe(0);
    const before = advanceExpedition(exp, leg.startsAt);
    const during = advanceExpedition(exp, leg.endsAt - 1);
    const scanning = before.bodies.findIndex((b) => !b.scanned);
    expect(during.bodies[scanning].scanProgress).toBe(before.bodies[scanning].scanProgress);
    // Every leg is one recovered return; an ordinary return never delays the scan.
    expect(ops.shipLegs.every((l) => l.scanBodyIndex !== null)).toBe(true); // within 2 h the scan is still running
    expect(ops.history.filter((r) => r.recovered).length).toBe(ops.shipLegs.length);
  });

  it("the scanning phase lasts the bodies' scan time plus every recovery leg", () => {
    const far = advanceExpedition(exp, open + 200_000).groundOps!;
    const bodyTime = exp.bodies.reduce((sum, b) => sum + b.scanTotal / scanRatePerSecond(exp, b), 0);
    const scanEnd = scanClockToTime(far, bodyTime);
    // Only the legs flown WHILE scanning pause it (a late wipe's leg delays nothing else).
    const scanLegs = far.shipLegs.filter((l) => l.scanBodyIndex !== null).length;
    expect(scanEnd - open).toBeCloseTo(bodyTime + scanLegs * 2 * IN_SYSTEM_LEG_SECONDS, 6);
    const justBefore = advanceExpedition(exp, scanEnd - 1);
    expect(justBefore.phase).toBe("scanning");
    expect(justBefore.bodies.some((b) => !b.scanned)).toBe(true);
    const justAfter = advanceExpedition(exp, scanEnd + 1);
    expect(justAfter.bodies.every((b) => b.scanned)).toBe(true);
    expect(justAfter.phase).not.toBe("scanning");
    if (justAfter.phase === "activities") expect(justAfter.phaseAnchorSeconds).toBeCloseTo(scanEnd, 6);
  });

  it("the scanning bar never moves backward, a recovery leg holds it (the scan clock over the whole scan)", () => {
    const leg = ops.shipLegs[0];
    let last = -1;
    for (let t = open; t <= open + TWO_HOURS; t += 13) {
      const e = advanceExpedition(exp, t);
      if (e.phase !== "scanning") break;
      const f = expeditionPhaseFraction(e, t);
      expect(f).toBeGreaterThanOrEqual(last);
      last = f;
    }
    const a = advanceExpedition(exp, leg.startsAt + 1);
    const b = advanceExpedition(exp, leg.endsAt - 1);
    expect(expeditionPhaseFraction(b, leg.endsAt - 1)).toBe(expeditionPhaseFraction(a, leg.startsAt + 1));
  });

  it("LATE WIPES: once the system is fully scanned, a wiped team still waits for the ship's leg (nothing else delayed)", () => {
    const far = advanceExpedition(exp, open + 150_000);
    const late = far.groundOps!.shipLegs.filter((l) => l.scanBodyIndex === null);
    expect(late.length).toBeGreaterThan(0);
    const oldest = far.groundOps!.history[0].startedAt; // the display history is capped
    const shown = late.filter((l) => l.startsAt > oldest);
    expect(shown.length).toBeGreaterThan(0);
    for (const leg of shown) {
      expect(far.groundOps!.history.find((r) => r.step === "return" && r.endedAt === leg.arrivesAt)).toMatchObject({ recovered: true });
      expect(leg.arrivesAt - leg.startsAt).toBe(IN_SYSTEM_LEG_SECONDS);
    }
  });

  it("a flagged run rolls no scan-time ground battle (user 9b.6); its supply caches sit on the same step draws", () => {
    const far = advanceExpedition(exp, open + 200_000);
    expect((far.scanEvents ?? []).some((ev) => ev.kind === "encounter")).toBe(false);
    const legacy = advanceExpedition(withoutGroundOps(exp), open + 200_000);
    const key = (ev: { bodyIndex: number; step: number }) => `${ev.bodyIndex}:${ev.step}`;
    const flaggedCaches = new Set((far.scanEvents ?? []).filter((ev) => ev.kind === "supplyCache").map(key));
    for (const ev of legacy.scanEvents ?? []) if (ev.kind === "supplyCache") expect(flaggedCaches.has(key(ev))).toBe(true);
  });
});

describe("GO-7b PARITY: one big advance == 997 s chunks == 1 s chunks", () => {
  it("over the first 2 hours of the window (overlap, a recovery leg, carry damage, a retry)", { timeout: 120_000 }, () => {
    const exp = dispatch();
    const open = windowOpen(exp);
    const END = open + TWO_HOURS;
    const big = advanceExpedition(exp, END);

    let chunked = exp;
    for (let t = 997; t < END; t += 997) chunked = advanceExpedition(chunked, t);
    chunked = advanceExpedition(chunked, END);
    expect(chunked).toEqual(big);

    let live = exp;
    let hurtCarry = false;
    for (let t = 1; t <= END; t += 1) {
      live = advanceExpedition(live, t);
      const team = live.groundOps!.teams[0];
      if (team.carry && Object.values(team.carry).some((c) => c.hp < c.hpMax)) hurtCarry = true;
    }
    expect(live).toEqual(big);
    expect(hurtCarry).toBe(true);
    expect(big.groundOps!.shipLegs.length).toBeGreaterThanOrEqual(1);
  });

  it("over the whole run (big == 997 s chunks), and the input is never mutated", { timeout: 120_000 }, () => {
    const exp = dispatch();
    const frozen = structuredClone(exp);
    const END = windowOpen(exp) + 150_000;
    const big = advanceExpedition(exp, END);
    let chunked = exp;
    for (let t = 997; t < END; t += 997) chunked = advanceExpedition(chunked, t);
    chunked = advanceExpedition(chunked, END);
    expect(chunked).toEqual(big);
    expect(exp).toEqual(frozen);
    // The whole run includes late wipes (recovery legs after the scan) and tasks sent to the back of the line.
    expect(big.groundOps!.shipLegs.some((l) => l.scanBodyIndex === null)).toBe(true);
    expect(big.bodies.some((b) => b.activities.some((a) => (a.sentBack ?? 0) > 0))).toBe(true);
  });

  it("a save mid-run (in a recovery leg, a team mid-step) reloads and resolves identically", { timeout: 120_000 }, () => {
    const s = withSlottedAwayTeams({ ...freshState(), awayMembers: SQUAD.map((m) => ({ ...m })), nextAwayMemberId: 100, expeditionSeed: SEED });
    const res = asPreFieldKitsDispatch(dispatchPastPropulsion(s, "ship-1", 1, expeditionCandidates(s, "ship-1")[0].id));
    const exp = withoutShipEvents(withoutEnemyRanks(res.expedition!)); // FKR-1: before enemy ranks (see dispatch)
    const open = windowOpen(exp);
    const leg = advanceExpedition(exp, open + TWO_HOURS).groundOps!.shipLegs[0];
    const mid = advanceExpedition(exp, leg.startsAt + 100);
    const state = { ...res.next, gameTimeSeconds: leg.startsAt + 100, expeditions: [mid] };
    const loaded = migrate(deserialize(serialize(state, 0)) as SaveFile);
    expect(loaded.expeditions[0]).toEqual(mid);
    const END = open + 50_000;
    expect(advanceExpedition(loaded.expeditions[0], END)).toEqual(advanceExpedition(exp, END));
  });
});
