// expeditionConsoleDisplay.test.ts: Expedition Tiers G2-6, the dispatch console's region picker, candidate and resume
// cards, launch bar, region map and recall confirm (the signed-off mockup, user 2026-10-21 "approve as is"). Every
// number is the engine's: the tabs are expeditionTierGates, the card rows are candidateVoyage / candidateReach /
// expeditionSystemGate, the recall confirm is recallPreview.

import { describe, expect, it } from "vitest";
import { freshState, type AwayMember, type Expedition, type GameState, type RegionTier, type ShipGroundTeam, type ShipTypeKey } from "./game/model";
import {
  advanceExpedition,
  candidateReach,
  candidateVoyage,
  expeditionCandidates,
  expeditionSystemGate,
  recallExpedition,
  recallPreview,
  resumableSystems,
  startExpedition,
  tierCandidateSystems,
} from "./game/expedition";
import { expeditionGateText, expeditionTierGates } from "./game/propulsion";
import { REGION_TIERS, stateHomeworld } from "./game/galaxy";
import { installMissingCombatBaselines } from "./game/tick";
import { asExpeditionVeteran, plainAwayMember } from "./game/awayTeamTestFixtures";
import { installPiece } from "./game/wiring/probes";
import { withoutCp14 } from "./game/cp14Switch.fixture";
import { nearestFirst } from "./expeditionDispatchDisplay";
import {
  candidateCardView,
  candidatesHeading,
  consoleDefaultTier,
  isTrainingDispatch,
  launchBarView,
  lockedTierView,
  nextTier,
  preselectCandidateId,
  recallClaimView,
  recallConfirmView,
  recalledStepperView,
  regionMapView,
  regionTabsView,
  resumeCardsView,
  shipPropulsionView,
  tierFactsView,
  tierGateShortText,
  tierReachLy,
  trainingRunNote,
  voyageSpanText,
} from "./expeditionConsoleDisplay";
import { parseStoredTier } from "./expeditionConsolePreference";

const T0 = 100_000;
const SEC = ["member-1", "member-2", "member-3", "member-4", "member-5", "member-6"];
const SCI = ["member-11", "member-12", "member-13", "member-14", "member-15", "member-16"];

function crewed(hull: ShipTypeKey = "orion", expeditionSeed?: number): GameState {
  const base = freshState();
  const m = (id: string, t: AwayMember["teamType"]): AwayMember => ({ ...plainAwayMember(id, t, "ship-1"), rank: 10 as AwayMember["rank"] });
  const teams: ShipGroundTeam[] = [
    { kind: "ground", security: SEC.slice(0, 3), science: SCI.slice(0, 3), helpOthers: false },
    { kind: "ground", security: SEC.slice(3), science: SCI.slice(3), helpOthers: false },
  ];
  const s: GameState = {
    ...base,
    ...(expeditionSeed === undefined ? {} : { expeditionSeed }),
    gameTimeSeconds: T0,
    nextExpeditionId: 2,
    awayMembers: [...SEC.map((id) => m(id, "security")), ...SCI.map((id) => m(id, "science"))],
    nextAwayMemberId: 100,
    ships: base.ships.map((sh) => ({ ...sh, typeKey: hull, groundTeams: teams })),
  };
  return asExpeditionVeteran(installMissingCombatBaselines(s));
}
const drive = (s: GameState, blueprintKey: string): GameState => installPiece(s, { slotType: "ftlDrive", blueprintKey, powerDraw: 4 });
const sensors = (s: GameState, n: number): GameState => installPiece(s, { slotType: "sensor", implicitStats: { sensors: n } });
const ship1 = (s: GameState) => s.ships.find((x) => x.id === "ship-1")!;
const at = (s: GameState, t: number): GameState => ({ ...s, gameTimeSeconds: t });

describe("G2-6 the region tabs: Tier I to VII, Ready or the first unmet gate", () => {
  it("seven tabs in Roman numerals; each tab's state is the engine's first unmet tier gate", () => {
    for (const s of [crewed("orion"), drive(crewed("orion"), "classIIDriveBp"), sensors(drive(crewed("aurora"), "classIIIDriveBp"), 30), crewed("generalFreighter")]) {
      const tabs = regionTabsView(s, ship1(s));
      expect(tabs.map((t) => t.numeral)).toEqual(["I", "II", "III", "IV", "V", "VI", "VII"]);
      for (const t of tabs) {
        const g = expeditionTierGates(s, ship1(s), t.tier);
        expect(t.ready, `tier ${t.tier}`).toBe(g.first === null);
        expect(t.stateText).toBe(g.first ? tierGateShortText(g.first) : "Ready");
        expect(t.label).toMatch(/^Tier [IVX]+ · /);
      }
    }
  });

  it("a stock Orion: Tier I ready, Tier II needs a Class II drive; with it, the frontier's sensors; with both, Ready", () => {
    const s = crewed("orion");
    let tabs = regionTabsView(s, ship1(s));
    expect(tabs[0].stateText).toBe("Ready");
    expect(tabs[1].stateText).toBe("Needs a Class II drive");
    expect(tabs[6].stateText).toBe("Needs a Class VII drive");
    const two = drive(s, "classIIDriveBp");
    // Complement CP-14 (OC-16): the Orion's own 25 base sensors meet the Orion Arm's 10, so a Class II drive is enough.
    expect(regionTabsView(two, ship1(two))[1].ready).toBe(true);
    // The frontier's sensor gate itself, on the hull without its base sensors (the CP-14 switch off).
    tabs = withoutCp14(() => regionTabsView(two, ship1(two)));
    expect(tabs[1].stateText).toBe("Needs sensors 10");
    const seeing = sensors(two, 30);
    tabs = regionTabsView(seeing, ship1(seeing));
    expect(tabs[1].ready).toBe(true);
    expect(tabs[1].ariaLabel).toBe("Tier II, Orion Arm: Ready");
  });

  it("a non-explorer hull: every tab says it needs an explorer hull", () => {
    const s = crewed("generalFreighter");
    for (const t of regionTabsView(s, ship1(s))) expect(t.stateText).toBe("Needs an explorer hull");
  });

  it("the short texts for every reason (exhaustive)", () => {
    const d = (reason: Parameters<typeof tierGateShortText>[0]["reason"]) => ({ reason, tier: 5 as RegionTier, driveClass: 1, driveClassNeeded: 5, sensors: 3, sensorsNeeded: 40 });
    expect(tierGateShortText(d("notExplorer"))).toBe("Needs an explorer hull");
    expect(tierGateShortText(d("driveClassUnavailable"))).toBe("No Class V drive yet");
    expect(tierGateShortText(d("driveClassTooLow"))).toBe("Needs a Class V drive");
    expect(tierGateShortText(d("frontierSensors"))).toBe("Needs sensors 40");
    expect(tierGateShortText(d("outOfReach"))).toBe("Beyond this ship's reach");
  });

  it("keyboard: arrows wrap across the seven tabs; Home and End jump; other keys do nothing", () => {
    expect(nextTier(1, "ArrowRight")).toBe(2);
    expect(nextTier(7, "ArrowRight")).toBe(1);
    expect(nextTier(1, "ArrowLeft")).toBe(7);
    expect(nextTier(4, "Home")).toBe(1);
    expect(nextTier(4, "End")).toBe(7);
    expect(nextTier(4, "Enter")).toBeNull();
  });

  it("the zero-click default: the remembered tier when ready, else the deepest ready tier below it, else Tier I", () => {
    const tabs = [1, 2, 3, 4, 5, 6, 7].map((tier) => ({ tier: tier as RegionTier, ready: tier <= 2 }));
    expect(consoleDefaultTier(tabs, 2)).toBe(2);
    expect(consoleDefaultTier(tabs, 5)).toBe(2);
    expect(consoleDefaultTier(tabs, null)).toBe(1);
    expect(consoleDefaultTier(tabs.map((t) => ({ ...t, ready: false })), 4)).toBe(1);
  });

  it("the remembered tier parses only a whole tier I to VII", () => {
    expect(parseStoredTier("3")).toBe(3);
    for (const bad of [null, "", "0", "8", "2.5", "x", "12"]) expect(parseStoredTier(bad)).toBeNull();
  });
});

describe("G2-6 the tier facts, the ship line and the locked panel", () => {
  it("the band, time, bodies, haul and telescope chips per tier (Tier III and IV share a band)", () => {
    const s = crewed();
    const home = stateHomeworld(s);
    const one = tierFactsView(s, 1);
    expect(one.bandText).toBe(`${home.regionBandsLy[1].near.toLocaleString("en-US")} to ${home.regionBandsLy[1].far.toLocaleString("en-US")} ly from your homeworld`);
    expect(one.timeText).toBe("About 2h one way at Class I, 1h 36m to 2h 24m by distance");
    expect(one.bodiesText).toBe("1 to 3 bodies");
    expect(one.haulText).toBe("Haul x1");
    expect(one.telescopeText).toBe("Telescope: Graded");
    expect(tierFactsView(s, 3).bandText).toMatch(/\(shared with IV\)$/);
    expect(tierFactsView(s, 4).bandText).toMatch(/\(shared with III\)$/);
    expect(tierFactsView(s, 7).timeText).toBe("About 7d one way at Class VII, 5d 14h to 8d 10h by distance");
    expect(tierFactsView(s, 7).telescopeText).toBe("Telescope: beyond range");
    expect(tierFactsView(s, 2).haulText).toBe("Haul x1.25");
  });

  it("the header names the drive class and the reach at the picked tier's mid band", () => {
    const s = drive(crewed("orion"), "classIIDriveBp");
    const v = shipPropulsionView(s, ship1(s), 2);
    expect(v.driveText).toBe("Class II drive");
    expect(v.reachLy).toBe(tierReachLy(s, ship1(s), 2));
    expect(v.reachText).toBe(`Reach ${Math.round(v.reachLy).toLocaleString("en-US")} ly round trip`);
    expect(v.homeworldText).toBe("Homeworld: Sol, in the Local Bubble");
    const placed = { ...s, homeworld: { version: 1 as const, seed: 0x6a09e667 } };
    expect(shipPropulsionView(placed, ship1(placed), 1).homeworldText).toMatch(/^Homeworld: \d+ ly from Sol, in the Local Bubble$/);
  });

  it("a locked tier lists every gate, met or not, and previews its three nearest systems by name and distance", () => {
    // Complement CP-14: the Eir (15 base sensors) still falls short of the Perseus Arm's 20; the Orion's 25 would meet it.
    const s = drive(crewed("eir"), "classIIDriveBp");
    const gates = expeditionTierGates(s, ship1(s), 3);
    const v = lockedTierView(s, ship1(s), 3, gates);
    expect(v.heading).toBe("What Tier III needs");
    expect(v.reasonText).toBe(expeditionGateText(gates.first!));
    expect(v.rows.map((r) => [r.key, r.status])).toEqual([["drive", "unmet"], ["sensors", "unmet"], ["reach", "info"], ["telescope", "info"]]);
    expect(v.rows[0].title).toBe("Class III drive or better");
    expect(v.rows[0].detail).toMatch(/^This ship has Class II\. A higher tier hull or a better FTL drive raises the class/);
    expect(v.rows[1].title).toBe("Sensors 20 to chart the Perseus Arm");
    expect(v.rows[3].title).toBe("Beyond your telescope today");
    const nearest = [...tierCandidateSystems(s, 3)].sort((a, b) => a.distanceLy - b.distanceLy);
    expect(v.peek.map((p) => p.name)).toEqual(nearest.map((c) => c.systemName));
    expect(v.peekHeading).toBe("Three nearest systems waiting here");
  });

  it("a tier with no frontier sensors (Tier II, retired by the CP-14 fix round) shows no sensor row", () => {
    const s = crewed("eir");
    const gates = expeditionTierGates(s, ship1(s), 2);
    expect(gates.sensorsNeeded).toBe(0);
    const v = lockedTierView(s, ship1(s), 2, gates);
    expect(v.rows.map((r) => r.key)).toEqual(["drive", "reach", "telescope"]);
  });

  it("a non-explorer's locked panel leads with the explorer hull", () => {
    const s = crewed("generalFreighter");
    const v = lockedTierView(s, ship1(s), 1, expeditionTierGates(s, ship1(s), 1));
    expect(v.rows[0]).toMatchObject({ key: "explorer", status: "unmet" });
    expect(v.reasonText).toBe("This hull cannot reach any expedition system. Expeditions need an explorer hull.");
  });
});

describe("G2-6 the candidate card: transit, reach and gates are the engine's", () => {
  it("every Tier I card: the transit a launch flies, the reach the gate reads, the gate it refuses on", () => {
    const s = crewed("orion");
    const cands = nearestFirst(expeditionCandidates(s, "ship-1", 1));
    for (const c of cands) {
      const v = candidateCardView(s, ship1(s), c);
      const sys = { tier: c.region.tier, distanceLy: c.telescope.distanceLy };
      const voyage = candidateVoyage(s, ship1(s), sys, isTrainingDispatch(s, ship1(s), 1));
      const reach = candidateReach(s, ship1(s), sys);
      expect(v.outboundSeconds).toBe(voyage.outboundSeconds);
      expect(v.transitText).toBe(`Out ${voyageSpanText(voyage.outboundSeconds)} · back ${voyageSpanText(voyage.returnSeconds)}`);
      expect(v.reach.roundTripLy).toBe(reach.roundTripLy);
      expect(v.reach.reachLy).toBe(reach.reachLy);
      expect(v.reach.met).toBe(reach.met);
      expect(v.gate).toEqual(expeditionSystemGate(s, ship1(s), sys));
      expect(v.launchable).toBe(startExpedition(s, "ship-1", 1, c.id).success);
      // Tier I asks for no frontier sensors, so the card shows no sensor gate (never an always-met one).
      expect(v.gatesText.sensors).toBeNull();
      expect(v.risk).not.toBeNull();
    }
  });

  // Expedition seed 1: a Class II Orion's Tier II list holds systems both inside and past its reach (forced, not hoped for).
  it("an out of reach card: the bar is hatched full with the reach marked, the full line names both numbers", () => {
    const s = sensors(drive(crewed("orion", 1), "classIIDriveBp"), 30);
    const cards = nearestFirst(expeditionCandidates(s, "ship-1", 2)).map((c) => candidateCardView(s, ship1(s), c));
    const over = cards.find((c) => !c.reach.met)!;
    const within = cards.find((c) => c.reach.met)!;
    expect(over).toBeDefined();
    expect(within).toBeDefined();
    expect(over.reach.fillPercent).toBe(100);
    expect(over.reach.markPercent).toBeLessThan(100);
    expect(over.reasonText).toMatch(/^Beyond this ship's reach: [\d,]+ ly round trip, the ship reaches [\d,]+ ly\.$/);
    expect(over.launchable).toBe(false);
    expect(within.reach.markPercent).toBeNull();
    expect(within.reach.fillPercent).toBeLessThanOrEqual(100);
    expect(within.reasonText).toBeNull();
    expect(within.launchable).toBe(true);
  });

  it("known enemy territory: the card's Combat grade reads the mockup's (+1); the other grades do not", () => {
    const s = crewed("orion");
    const base = expeditionCandidates(s, "ship-1", 1)[0];
    const enemy = { ...base, telescope: { ...base.telescope, risk: { ...base.telescope.risk!, enemyTerritory: true } } };
    const v = candidateCardView(s, ship1(s), enemy);
    expect(v.enemyTerritory).toBe(true);
    const combat = v.risk!.find((f) => f.id === "combat")!;
    expect(combat.gradeText).toBe(`${combat.gradeName} (+1)`);
    for (const f of v.risk!.filter((x) => x.id !== "combat")) expect(f.gradeText).toBe(f.gradeName);
    const calm = candidateCardView(s, ship1(s), base);
    expect(calm.risk!.find((f) => f.id === "combat")!.gradeText).toBe(calm.risk!.find((f) => f.id === "combat")!.gradeName);
  });

  it("preselects the nearest launchable card, else the nearest", () => {
    expect(preselectCandidateId([{ id: "a", launchable: false }, { id: "b", launchable: true }])).toBe("b");
    expect(preselectCandidateId([{ id: "a", launchable: false }, { id: "b", launchable: false }])).toBe("a");
    expect(preselectCandidateId([])).toBeNull();
    expect(candidatesHeading(3)).toBe("Three nearest systems");
    expect(candidatesHeading(4)).toBe("Nearest systems");
  });

  it("the training run chip and note on a fresh save's first explorer expedition (Tier I only)", () => {
    const fresh = { ...crewed("orion"), runCounts: freshState().runCounts, nextExpeditionId: 1 };
    expect(isTrainingDispatch(fresh, ship1(fresh), 1)).toBe(true);
    expect(isTrainingDispatch(fresh, ship1(fresh), 2)).toBe(false);
    expect(candidateCardView(fresh, ship1(fresh), expeditionCandidates(fresh, "ship-1", 1)[0]).trainingRun).toBe(true);
    // SF-6: the note leads with the chip's approved line (user 2026-10-27, "This run cannot fail").
    expect(trainingRunNote(fresh, "Aurora")).toBe("This training run cannot fail. From the next one on, the risk rises slowly. Aurora's training run flies the same trip an ordinary run to that system would. Wolf 359 appears in the first Tier I list after this run.");
    expect(trainingRunNote({ nextExpeditionId: 4 }, "Aurora")).not.toMatch(/Wolf 359/);
  });

  it("the launch bar: the selection and its outbound time; Resume reads Resume", () => {
    expect(launchBarView(null)).toEqual({ resume: false, selectedText: "Select a target system", buttonText: "Launch" });
    expect(launchBarView({ name: "LB-0472", outboundSeconds: 6_720, resume: false }).selectedText).toBe("Selected: LB-0472 · out 1h 52m");
    expect(launchBarView({ name: "Polaris", outboundSeconds: 11_400, resume: true })).toEqual({ resume: true, selectedText: "Resume: Polaris · out 3h 10m", buttonText: "Resume" });
  });

  it("voyage spans: minutes and hours as the console's countdown, two days and longer in days", () => {
    expect(voyageSpanText(6_720)).toBe("1h 52m");
    expect(voyageSpanText(43_200)).toBe("12h");
    expect(voyageSpanText(86_400)).toBe("24h");
    expect(voyageSpanText(72 * 3_600)).toBe("3d");
    expect(voyageSpanText(168 * 3_600)).toBe("7d");
    expect(voyageSpanText(50 * 3_600)).toBe("2d 2h");
  });
});

describe("G2-6 the region map (the alternative picker)", () => {
  it("one badge per tier, locked exactly where the tab is, the picked one selected, a reach ring inside the map", () => {
    const s = drive(crewed("orion"), "classIIDriveBp");
    const tabs = regionTabsView(s, ship1(s));
    const v = regionMapView(s, ship1(s), tabs, 1);
    expect(v.badges.map((b) => b.tier)).toEqual([...REGION_TIERS]);
    for (const b of v.badges) {
      expect(b.locked).toBe(!tabs[b.tier - 1].ready);
      expect(b.selected).toBe(b.tier === 1);
      expect(b.ariaLabel).toBe(tabs[b.tier - 1].ariaLabel);
    }
    expect(v.reachR).toBeGreaterThan(0);
    // The ring grows with the drive class.
    const seven = drive(crewed("orion"), "classVIIDriveBp");
    expect(regionMapView(seven, ship1(seven), regionTabsView(seven, ship1(seven)), 1).reachR).toBeGreaterThan(v.reachR);
  });
});

describe("G2-6 recall: the one confirm, the recalled stepper and the claim (user G13)", () => {
  function flying(cand = "cand-1-0"): { s: GameState; exp: Expedition } {
    const res = startExpedition(crewed("orion"), "ship-1", 1, cand);
    expect(res.success, res.reason).toBe(true);
    return { s: res.next, exp: res.expedition! };
  }

  it("mid-transit: home in the time flown; nothing charted; the system goes back to the candidates", () => {
    const { s, exp } = flying();
    const mid = at(s, T0 + 1_000);
    const p = recallPreview(mid, exp.id);
    expect(p.ok).toBe(true);
    const v = recallConfirmView(mid, exp, "Orion")!;
    expect(v.title).toBe("Recall Orion?");
    expect(v.line).toBe(`It flies home in ${voyageSpanText(p.ok ? p.preview.returnSeconds : 0)}, the distance it has covered so far.`);
    expect(v.stops[0]).toBe("Nothing has been charted yet.");
    expect(v.stops[1]).toMatch(/goes back to the Tier I candidates/);
    expect([v.keepText, v.recallText]).toEqual(["Keep going", "Recall home"]);
  });

  // The first moment the run has arrived, and the first moment its first body is charted (stepped through the engine).
  function firstAt(exp: Expedition, done: (e: Expedition) => boolean): number {
    let t = exp.phaseAnchorSeconds;
    while (!done(advanceExpedition(exp, t))) t += 60;
    return t;
  }

  it("after arrival, once a body is charted: the full trip out; objectives stop with progress; the system stays open", () => {
    const { s, exp } = flying();
    const t = firstAt(exp, (e) => e.bodies[0].scanned) + 60;
    const now = at({ ...s, expeditions: [advanceExpedition(exp, t)] }, t);
    const p = recallPreview(now, exp.id);
    expect(p.ok).toBe(true);
    expect(p.ok && p.preview.held).toBe("resume");
    const v = recallConfirmView(now, now.expeditions[0], "Orion")!;
    expect(v.stops[0]).toBe("Objectives in progress stop and keep their progress; finished work comes home.");
    expect(v.stops).toContain("The medical bay treats the injured on the way.");
    expect(v.line).toMatch(/the full trip out\.$/);
    expect(v.stops.some((x) => /stays open: any explorer can resume it/.test(x))).toBe(true);
  });

  it("arrived but nothing charted yet: no objective stops; the system goes back to the candidates", () => {
    const { s, exp } = flying();
    const t = firstAt(exp, (e) => e.phase !== "transit") + 1;
    const run = advanceExpedition(exp, t);
    expect(run.bodies.some((b) => b.scanned)).toBe(false);
    const now = at({ ...s, expeditions: [run] }, t);
    const p = recallPreview(now, exp.id);
    expect(p.ok && p.preview.phase).not.toBe("transit");
    expect(p.ok && p.preview.held).toBe("candidate");
    const v = recallConfirmView(now, run, "Orion")!;
    expect(v.stops[0]).toBe("Nothing has been charted yet.");
    expect(v.stops.some((x) => /Objectives in progress/.test(x))).toBe(false);
    expect(v.stops[v.stops.length - 1]).toMatch(/goes back to the Tier I candidates\.$/);
  });

  it("a run from before G2-2 (no region stamp) recalled in transit: it does not stay open to resume", () => {
    const { s, exp } = flying();
    const legacy: Expedition = { ...exp };
    delete legacy.region;
    const mid = at({ ...s, expeditions: [legacy] }, T0 + 1_000);
    const p = recallPreview(mid, exp.id);
    expect(p.ok && p.preview.held).toBeNull();
    const v = recallConfirmView(mid, legacy, "Orion")!;
    expect(v.stops).toEqual(["Nothing has been charted yet.", `${exp.systemName} does not stay open to resume.`]);
  });

  it("a run that cannot be recalled has no confirm", () => {
    const { s, exp } = flying();
    expect(recallConfirmView(at(s, T0 + 5_000_000), exp, "Orion")).toBeNull();
  });

  it("the recalled stepper: transit cut, Return reads Recalled with the time left; the claim names what stays", () => {
    const { s, exp } = flying();
    const mid = at(s, T0 + 1_000);
    const recalled = recallExpedition(mid, exp.id);
    const run = recalled.expeditions[0];
    const step = recalledStepperView(run, T0 + 1_000)!;
    expect(step.steps).toEqual(["cut", "cut", "cut", "recalled"]);
    expect(step.returnText).toBe(`Recalled · home in ${voyageSpanText(run.recall!.returnSeconds)}`);
    expect(recalledStepperView(exp, T0)).toBeNull();
    // Home: the claim card.
    const home = { ...run, phase: "complete" as const };
    const claim = recallClaimView(recalled, home)!;
    expect(claim.heading).toBe(`Home from ${run.systemName} (recalled)`);
    expect(claim.text).toBe(`No findings yet. ${run.systemName} is a Tier I candidate again.`);
    expect(claim.resumeChip).toBeNull();
    expect(recallClaimView(recalled, run)).toBeNull();
  });

  it("a recalled charted system: a resume card at the top of its region, its count on the tab, Launch reads Resume", () => {
    const { s, exp } = flying();
    let t = T0 + 20_000;
    let state = recallExpedition(at(s, t), exp.id);
    while (resumableSystems(state).length === 0 && t < T0 + 200_000) {
      t += 5_000;
      state = recallExpedition(at(s, t), exp.id);
    }
    expect(resumableSystems(state).length).toBe(1);
    // The ship is home after its return leg; claim to free it, then read the console.
    const run = state.expeditions[0];
    const home = at({ ...state, expeditions: [] }, run.phaseAnchorSeconds + run.recall!.returnSeconds + 1);
    const tabs = regionTabsView(home, ship1(home));
    expect(tabs[0].resumeCount).toBe(1);
    expect(tabs[0].ariaLabel).toMatch(/, 1 to resume$/);
    const cards = resumeCardsView(home, ship1(home), 1);
    expect(cards).toHaveLength(1);
    const r = resumableSystems(home, 1)[0];
    expect(cards[0].id).toBe(r.id);
    expect(cards[0].percent).toBe(Math.round(r.progress * 100));
    expect(cards[0].chartedText).toMatch(new RegExp(`^${cards[0].percent}% · ${r.bodiesScanned} of ${r.bodies} bod`));
    expect(cards[0].abandonConfirm).toBe(`Abandon ${r.systemName}? Its saved progress is let go; findings you claimed stay yours.`);
    expect(cards[0].launchable).toBe(true);
    expect(startExpedition(home, "ship-1", 1, r.id).success).toBe(true);
    const claim = recallClaimView(state, { ...run, phase: "complete" })!;
    expect(claim.resumeChip).toBe("In Resume: Tier I");
    expect(claim.text).toMatch(new RegExp(` ${r.systemName} saved to Resume at ${Math.round(r.progress * 100)}%\\.$`));
    // A ship that cannot attempt the region (here a non-explorer: Tier I locked) still lists the card, with its gate
    // line, so the tab's resume count always has its card and Abandon (review fix).
    const locked = { ...home, ships: home.ships.map((sh) => (sh.id === "ship-1" ? { ...sh, typeKey: "generalFreighter" as const } : sh)) };
    expect(regionTabsView(locked, ship1(locked))[0]).toMatchObject({ ready: false, resumeCount: 1 });
    const lockedCards = resumeCardsView(locked, ship1(locked), 1);
    expect(lockedCards).toHaveLength(1);
    expect(lockedCards[0].launchable).toBe(false);
    expect(lockedCards[0].reasonText).toBe("This hull cannot reach any expedition system. Expeditions need an explorer hull.");
  });
});
