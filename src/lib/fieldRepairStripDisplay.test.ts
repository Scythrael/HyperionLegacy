// OC-F14 (Option A, user answers 2026-11-12): the field repair strip's words for every state the mockup draws, read on
// real Ground Ops runs (fieldRepairOrder.fixture.ts) through the engine's own plan and legs.

import { describe, expect, it } from "vitest";
import { freshState, type AwayMember, type Expedition, type GameState } from "./game/model";
import { advanceExpedition, cancelFieldRepair, expeditionCandidates, orderFieldRepair } from "./game/expedition";
import { OCF14_FAR, ocf14Damaged, ocf14Dispatch, ocf14Threshold, ocf14WindowOpen } from "./game/fieldRepairOrder.fixture";
import { asPreCurveDispatch, plainAwayMember, withSlottedAwayTeams, dispatchPastPropulsion } from "./game/awayTeamTestFixtures";
import { autoRepairAt, fieldRepairLogText, fieldRepairRefusalText, fieldRepairStripView, type TextPart } from "./fieldRepairStripDisplay";

const TOXIC_FROZEN = 0xa6fe4;
const ARID_ONLY = 0xa6fe5;
const NO_WORLD = 0xa6fe0;
const words = (parts: TextPart[] | null): string => (parts ?? []).map((p) => p.text).join("");
const bolds = (parts: TextPart[] | null): string[] => (parts ?? []).filter((p) => p.bold).map((p) => p.text);

function at(seed: number, dt: number, damage: number): { state: GameState; t: number; id: string; run: Expedition } {
  const { next, exp } = ocf14Dispatch(seed);
  const t = ocf14WindowOpen(exp) + dt;
  const run = ocf14Damaged(advanceExpedition(exp, t), damage);
  return { state: { ...next, gameTimeSeconds: t, expeditions: [run] }, t, id: exp.id, run };
}
const runOf = (s: GameState): Expedition => s.expeditions[0];

describe("OC-F14 strip: when it shows", () => {
  it("hidden with a whole hull and no repair to report, and before the window opens", () => {
    const { run, t } = at(TOXIC_FROZEN, 200, 0);
    expect(fieldRepairStripView(run, t)).toBeNull();
    const { exp } = ocf14Dispatch(TOXIC_FROZEN);
    expect(fieldRepairStripView(ocf14Damaged(exp, 40), 0)).toBeNull();
  });
  it("the auto mark: the threshold share of the hull pool, in whole points", () => {
    expect(autoRepairAt(500)).toBe(125);
    expect(autoRepairAt(402)).toBe(101);
  });
});

describe("OC-F14 strip: available (the preview is the engine's plan)", () => {
  it("orbit when it is the faster: where, how long, and the world it passes over", () => {
    const { run, t } = at(TOXIC_FROZEN, 200, 48);
    const v = fieldRepairStripView(run, t)!;
    expect(v.state).toBe("available");
    expect(v.order).toEqual({ enabled: true, text: "Order field repair", glyph: "shipyard" });
    expect(words(v.numbersWide)).toBe("48 damage of 500 · auto at 125");
    expect(words(v.numbersNarrow)).toBe("48 of 500 · auto at 125");
    expect(v.hull).toMatchObject({ fillPct: 9.6, markPct: 25 });
    expect(words(v.whenWide)).toMatch(/^Repairs in orbit, 2m 12s: sooner than flying to .+ · Frozen \(11m 28s\)\. The scan waits that long; the teams keep working\.$/);
    expect(bolds(v.whenWide)).toContain("in orbit");
    expect(words(v.whenNarrow)).toMatch(/^Repairs in orbit, 2m 12s: sooner than flying to [^·]+ \(11m 28s\)\. The scan waits; the teams keep working\.$/);
    expect(v.dim).toBe("Free. Fixes all 48 damage. Without it the ship repairs on its own at 125, or in the Shipyard at home.");
    expect(v.cancel).toBe(false);
    expect(v.tagOff).toBe(false);
  });
  it("the world when it is the faster (a long repair): the flight there and back and the whole wait", () => {
    const { run, t } = at(TOXIC_FROZEN, 200, 1162);
    const v = fieldRepairStripView(run, t)!;
    expect(words(v.whenWide)).toMatch(/^Flies to .+ · Frozen \(5m\), repairs 20m 2s, flies back \(5m\)\. The scan waits 30m 2s\.$/);
    expect(v.dim).toBe("Free. Fixes all 1162 damage. Without it the ship repairs on its own after its next hit, or in the Shipyard at home.");
  });
  it("a run from before the repair rules reads the old rule: the mockup's 11m 28s", () => {
    const { run, t } = at(TOXIC_FROZEN, 200, 48);
    const { repairRules: _stamp, ...old } = run;
    expect(words(fieldRepairStripView(old, t)!.whenWide)).toMatch(/^Flies to .+ \(5m\), repairs 1m 28s, flies back \(5m\)\. The scan waits 11m 28s\.$/);
  });
  it("on a repair world: sets down where it is, no flight (the mockup's 1m 28s)", () => {
    const { run, t } = at(ARID_ONLY, 200, 48);
    const v = fieldRepairStripView(run, t)!;
    expect(words(v.whenWide)).toMatch(/^Sets down at .+ · Arid, the body it scans: repairs in 1m 28s, no flight\. The scan waits that long; the teams keep working\.$/);
    expect(words(v.whenNarrow)).toMatch(/^Sets down at [^·]+, the body it scans: 1m 28s, no flight\. The scan waits; the teams keep working\.$/);
  });
  it("no world in the system: in orbit, three times the Shipyard's time", () => {
    const { run, t } = at(NO_WORLD, 200, 48);
    expect(words(fieldRepairStripView(run, t)!.whenWide)).toBe("No world here to set down on: repairs in orbit, 2m 12s (three times the Shipyard's time).");
  });
});

describe("OC-F14 strip: in progress, canceled, then hidden", () => {
  it("repairing in orbit: the chip, the progress, the time left, and Cancel", () => {
    const { state, t, id } = at(TOXIC_FROZEN, 200, 48);
    const ordered = runOf(orderFieldRepair(state, id));
    const v = fieldRepairStripView(ordered, t + 50)!;
    expect(v.state).toBe("repairing");
    expect(v.chip).toEqual({ tone: "going", glyph: "shipyard", text: "Repairing" });
    expect(v.order).toBeNull();
    expect(v.cancel).toBe(true);
    expect(v.progressPct).toBeCloseTo((50 / 132) * 100, 6);
    expect(words(v.whenWide)).toBe("Damage clears when the repair ends, in 1m 22s.");
    expect(v.dim).toBe("Cancel keeps the repair finished so far.");
    expect(words(v.numbersWide)).toBe("48 of 500");
  });
  it("a world repair: setting course, set down, then repaired and flying back (no Cancel then)", () => {
    const { state, t, id } = at(TOXIC_FROZEN, 200, 1162);
    const ordered = runOf(orderFieldRepair(state, id));
    const leg = ordered.groundOps!.repairLegs![0];
    expect(words(fieldRepairStripView(ordered, t + 120)!.whenWide)).toBe("Back on the scan in 28m 2s."); // 1802 s - 120 s
    expect(words(fieldRepairStripView(ordered, t + 400)!.whenWide)).toBe("Damage clears when the repair ends, then 5m back.");
    const back = fieldRepairStripView(advanceExpedition(ordered, leg.repairedAt + 10), leg.repairedAt + 10)!;
    expect(back.state).toBe("repaired");
    expect(back.chip).toEqual({ tone: "ok", glyph: "check", text: "Repaired" });
    expect(back.cancel).toBe(false);
    expect(words(back.numbersWide)).toBe("0 of 500");
  });
  it("canceled: the hull it kept, and back on the scan", () => {
    const { state, t, id } = at(TOXIC_FROZEN, 200, 1162);
    const ordered = orderFieldRepair(state, id);
    const c = t + 300 + 400;
    const cut = runOf(cancelFieldRepair({ ...ordered, gameTimeSeconds: c }, id));
    const v = fieldRepairStripView(cut, c + 10)!;
    // The rest can be ordered again at once: it waits for the ship, after the canceled line.
    expect(v.state).toBe("available");
    expect(v.order).toEqual({ enabled: true, text: "Order field repair", glyph: "shipyard" });
    expect(v.cancel).toBe(false);
    expect(words(v.whenWide)).toMatch(/^Canceled: 386 hull repaired, back on the scan in 4m 50s\. Repairs in orbit, .+ Starts when the ship is free, in 4m 50s\.$/);
    expect(words(v.numbersWide)).toBe("776 damage of 500 · auto at 125");
    expect(v.dim).toBe("Free. Fixes all 776 damage. Without it the ship repairs on its own after its next hit, or in the Shipyard at home.");
    expect(fieldRepairLogText(cut, "cancel")).toBe("Field repair canceled: 386 hull repaired.");
  });
  it("hidden once the repair is done and the hull is whole (no lingering strip)", () => {
    const { state, id } = at(ARID_ONLY, 200, 48);
    const ordered = runOf(orderFieldRepair(state, id));
    const end = ordered.groundOps!.repairLegs![0].endsAt;
    const after = advanceExpedition(ordered, end + 240);
    expect(after.groundOps!.hullDamage ?? 0).toBe(0);
    expect(fieldRepairStripView(after, end)).toBeNull();
    expect(fieldRepairStripView(after, end + 240)).toBeNull();
    expect(fieldRepairLogText(ordered, "order")).toMatch(/^Field repair ordered at .+ · Arid: 1m 28s\.$/);
  });
  it("ordered while the ship flies a pickup: it starts when the ship is back, and can be canceled", { timeout: 120_000 }, () => {
    const member = (mid: string, teamType: AwayMember["teamType"], over: Partial<AwayMember> = {}): AwayMember => ({ ...plainAwayMember(mid, teamType, "ship-1"), ...over });
    const squad = [member("member-1", "security", { rank: 3 }), member("member-2", "security", { rank: 2, traits: ["fieldMedic"] }), member("member-11", "science")];
    const s0 = withSlottedAwayTeams({ ...freshState(), awayMembers: squad, nextAwayMemberId: 100, expeditionSeed: 0xa13bd4 });
    const res = asPreCurveDispatch(dispatchPastPropulsion(s0, "ship-1", 1, expeditionCandidates(s0, "ship-1")[0].id));
    const exp = res.expedition!;
    const pickup = advanceExpedition(exp, OCF14_FAR).groundOps!.shipLegs[0];
    const t = pickup.startsAt + 10;
    const ordered = runOf(orderFieldRepair({ ...res.next, gameTimeSeconds: t, expeditions: [ocf14Damaged(advanceExpedition(exp, t), 48)] }, exp.id));
    const v = fieldRepairStripView(ordered, t)!;
    expect(v.state).toBe("ordered");
    expect(v.dim).toBeNull(); // a cancel here only withdraws the order
    expect(v.chip).toEqual({ tone: "going", glyph: "clock", text: "Ordered" });
    expect(v.cancel).toBe(true);
    expect(words(v.whenWide)).toMatch(/^Starts when the ship is back from the pickup, in .+\.$/);
    expect(bolds(v.whenWide)).toEqual([`${Math.floor((pickup.endsAt - t) / 60)}m${(pickup.endsAt - t) % 60 === 0 ? "" : ` ${(pickup.endsAt - t) % 60}s`}`]);
  });
});

describe("OC-F14 strip: disabled with its reason", () => {
  it("the threshold's own repair is on (no order, no Cancel)", () => {
    const { exp } = ocf14Dispatch(TOXIC_FROZEN);
    const start = ocf14Damaged(exp, ocf14Threshold(exp) - 1);
    const leg = advanceExpedition(start, OCF14_FAR).groundOps!.repairLegs![0];
    const mid = advanceExpedition(start, leg.startsAt + 10);
    const v = fieldRepairStripView(mid, leg.startsAt + 10)!;
    expect(v.state).toBe("auto");
    expect(v.tagOff).toBe(true);
    expect(v.cancel).toBe(false);
    expect(v.chip).toEqual({ tone: "going", glyph: "shipyard", text: "Repairing" });
    expect(v.why).toEqual({ glyph: "info", text: "The ship is already setting down for repairs (after heavy damage)." });
  });
  it("the operations are over: the Shipyard repairs it at home", () => {
    const { run, t } = at(TOXIC_FROZEN, 200, 48);
    const v = fieldRepairStripView({ ...run, groundOps: { ...run.groundOps!, endedAt: t } }, t + 5)!;
    expect(v.state).toBe("over");
    expect(v.order).toEqual({ enabled: false, text: "Order field repair", glyph: null });
    expect(v.why).toEqual({ glyph: "info", text: "The ground operations are over: the Shipyard will repair the ship at home." });
  });
  it("a run launched before field repairs: the reason, no bar", () => {
    const { run, t } = at(TOXIC_FROZEN, 200, 48);
    const battle = { ...run.groundOps!.shipEventProfile.battle! };
    delete battle.repairSpeed;
    const old = { ...run, groundOps: { ...run.groundOps!, shipEventProfile: { ...run.groundOps!.shipEventProfile, battle } } };
    const v = fieldRepairStripView(old, t)!;
    expect(v.state).toBe("older");
    expect(v.hull).toBeNull();
    expect(v.numbersWide).toBeNull();
    expect(v.why).toEqual({ glyph: "info", text: "This expedition launched before field repairs." });
  });
  it("every refusal has words", () => {
    for (const r of ["noExpedition", "notGroundOps", "noFieldRepair", "noDamage", "alreadyRepairing", "runFinished", "noOrder", "repaired"] as const) {
      expect(fieldRepairRefusalText(r).length).toBeGreaterThan(0);
    }
  });
});
