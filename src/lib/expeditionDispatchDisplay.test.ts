// expeditionDispatchDisplay.test.ts: the display decisions behind the Expedition Console's dispatch view (0.14.0,
// Ground Operations GO-12 + Squads SQ-7 section 7.2): the ground teams strip (who deploys, who waits and why, the
// ship-level reason), the Subspace Telescope block per detail level (blind, Contact, Graded, Per body,
// Recommendation, Forecast), the recommendation box's "Set composition" preview, the forecast line, the blind
// confirm wording, and the LAZY launch view (a tick that only moves time never asks the engine again).

import { describe, expect, it } from "vitest";
import { SUBSPACE_TELESCOPE_FACILITY_KEY, freshState, type AwayMember, type GameState, type GroundTeamKind, type ShipGroundTeam } from "./game/model";
import { expeditionCandidates, expeditionLaunchView, expeditionRiskPreview, type ExpeditionCandidate } from "./game/expedition";
import { deployableGroundTeams } from "./game/groundTeams";
import { gateRiskView, readSystem, telescopeReadingAtLevel } from "./game/telescope";
import { tick } from "./game/tick";
import type { LaunchForecast, LaunchRecommendation } from "./game/launchRecommendation";
import type { ThreatAssessment } from "./game/combat/threatAssessment";
import { plainAwayMember } from "./game/awayTeamTestFixtures";
import {
  BLIND_LAUNCH_DETAIL,
  BLIND_LAUNCH_TITLE,
  BLIND_LAUNCH_WARNING,
  RISK_FACTOR_ORDER,
  RISK_GRADE_COLORS,
  RISK_METER_STEPS,
  candidateRegionText,
  createInputCache,
  dispatchTeamsView,
  expandedLaunchView,
  factorFlavor,
  forecastView,
  SENSOR_SPLIT_HINT,
  launchViewInputs,
  recommendationView,
  sensorSplitHint,
  telescopeBlockView,
} from "./expeditionDispatchDisplay";

const T0 = 100_000;
const SEC = ["member-1", "member-2", "member-3", "member-4", "member-5", "member-6"];
const SCI = ["member-11", "member-12", "member-13", "member-14", "member-15", "member-16"];

// ship-1 (General Freighter, 3 / 3 squads): Alpha and Bravo both Ground and fully slotted, two Security and one
// Science member in the reserve (the launchPreview.test.ts crew), at telescope `level`.
function crewed(level = 1, mutate: (m: AwayMember) => AwayMember = (m) => m): GameState {
  const base = freshState();
  const member = (id: string, type: AwayMember["teamType"]): AwayMember => mutate({ ...plainAwayMember(id, type, "ship-1"), name: id.replace("member-", "M"), rank: 8 as AwayMember["rank"] });
  const teams: ShipGroundTeam[] = [
    { kind: "ground", security: SEC.slice(0, 3), science: SCI.slice(0, 3), helpOthers: false },
    { kind: "ground", security: SEC.slice(3), science: SCI.slice(3), helpOthers: false },
  ];
  return {
    ...base,
    gameTimeSeconds: T0,
    awayMembers: [
      ...SEC.map((id) => member(id, "security")),
      ...SCI.map((id) => member(id, "science")),
      member("member-7", "security"),
      member("member-8", "security"),
      member("member-17", "science"),
    ],
    nextAwayMemberId: 100,
    ships: base.ships.map((sh) => ({ ...sh, groundTeams: teams })),
    facilities: { ...base.facilities, [SUBSPACE_TELESCOPE_FACILITY_KEY]: { level } },
  };
}

function withTeams(state: GameState, teams: ShipGroundTeam[]): GameState {
  return { ...state, ships: state.ships.map((s) => (s.id === "ship-1" ? { ...s, groundTeams: teams } : s)) };
}

const NO_DASH = /\u2014|-{2}/;

describe("GO-12: the ground teams strip", () => {
  it("lists every team that will deploy with its ready counts", () => {
    const s = crewed();
    const v = dispatchTeamsView(deployableGroundTeams(s, "ship-1"), s.gameTimeSeconds);
    expect(v.ok).toBe(true);
    expect(v.blockText).toBeNull();
    expect(v.summary).toBe("2 of 2 teams will deploy");
    expect(v.rows.map((r) => [r.name, r.kindLabel, r.status, r.statusText, r.countsText])).toEqual([
      ["Alpha", "Ground team", "deploys", "Will deploy", "3 Security, 3 Science ready"],
      ["Bravo", "Ground team", "deploys", "Will deploy", "3 Security, 3 Science ready"],
    ]);
  });

  it("a team with a recovering member will NOT deploy and says who and how long (no stand-in)", () => {
    const s = crewed(1, (m) => (m.id === "member-5" ? { ...m, injuredUntilSeconds: T0 + 600 } : m));
    const v = dispatchTeamsView(deployableGroundTeams(s, "ship-1"), s.gameTimeSeconds);
    expect(v.ok).toBe(true); // Alpha alone meets D18
    expect(v.summary).toBe("1 of 2 teams will deploy");
    const bravo = v.rows[1];
    expect(bravo.status).toBe("waits");
    expect(bravo.statusText).toBe("Will not deploy");
    expect(bravo.countsText).toBe("Ready: 2 of 3 Security, 3 of 3 Science");
    expect(bravo.waits).toEqual(["M5 returns to duty in 10m"]);
  });

  it("the ship-level reason when nothing deploys, with the time left or what to slot", () => {
    const hurt = crewed(1, (m) => ({ ...m, injuredUntilSeconds: T0 + 600 }));
    const v = dispatchTeamsView(deployableGroundTeams(hurt, "ship-1"), hurt.gameTimeSeconds);
    expect(v.ok).toBe(false);
    expect(v.blockText).toBe("No ground team is ready: the first is ready in 10m.");
    expect(v.blockHint).toBe("Slot or swap members on the ship's Away Team tab.");
    expect(v.rows.every((r) => r.status === "waits")).toBe(true);

    const empty = withTeams(crewed(), [
      { kind: "ground", security: [null, null, null], science: [null, null, null], helpOthers: false },
      { kind: "ground", security: [null, null, null], science: [null, null, null], helpOthers: false },
    ]);
    const e = dispatchTeamsView(deployableGroundTeams(empty, "ship-1"), empty.gameTimeSeconds);
    expect(e.blockText).toBe("No ground team is ready: slot at least 1 member into each squad of a team.");
    expect(e.rows.map((r) => [r.status, r.statusText, r.countsText])).toEqual([
      ["empty", "Stays aboard: nobody is slotted.", null],
      ["empty", "Stays aboard: nobody is slotted.", null],
    ]);
  });

  it("a Strike team counts Security only; an empty squad is named as the wait", () => {
    const s = withTeams(crewed(), [
      { kind: "strike", security: ["member-1", "member-2", "member-3", "member-4", null, null], science: [], helpOthers: false },
      { kind: "survey", security: [], science: ["member-11", "member-12", "member-13", null, null, null], helpOthers: false },
    ]);
    const v = dispatchTeamsView(deployableGroundTeams(s, "ship-1"), s.gameTimeSeconds);
    expect(v.rows[0].countsText).toBe("4 Security ready");
    expect(v.rows[0].kindLabel).toBe("Strike team");
    expect(v.rows[1].status).toBe("waits");
    expect(v.rows[1].countsText).toBe("Ready: 3 of 3 Science");
    expect(v.rows[1].waits).toEqual(["Science squad 2 needs a member in a slot"]);
    expect(v.ok).toBe(false);
    expect(v.blockText).toBe("Nothing ready covers Science: a team with a Science squad must deploy too.");
  });

  it("no em dash or double hyphen in any strip text", () => {
    const s = crewed(1, (m) => (m.id === "member-5" ? { ...m, injuredUntilSeconds: T0 + 600 } : m));
    const v = dispatchTeamsView(deployableGroundTeams(s, "ship-1"), s.gameTimeSeconds);
    expect(JSON.stringify(v)).not.toMatch(NO_DASH);
  });
});

describe("SQ-7 7.2: the Subspace Telescope block", () => {
  const cand0 = (s: GameState): ExpeditionCandidate => expeditionCandidates(s, "ship-1")[0];

  it("Graded (Level 1): four factor rows with a meter, a grade and a flavor line; no bodies yet", () => {
    const s = crewed(1);
    const c = cand0(s);
    const b = telescopeBlockView(c, 1);
    expect(b.blind).toBe(false);
    expect(b.chipText).toBe("Detail 2 · Graded");
    expect(b.regionText).toMatch(/^Tier I · Local Bubble · \d[\d,]* ly from your homeworld$/);
    expect(b.factors.map((f) => f.id)).toEqual([...RISK_FACTOR_ORDER]);
    for (const f of b.factors) {
      expect(f.grade).not.toBeNull();
      expect(f.lit).toBe(f.grade! + 1);
      expect(f.lit).toBeLessThanOrEqual(RISK_METER_STEPS);
      expect(f.color).toBe(RISK_GRADE_COLORS[f.grade!]);
      expect(f.flavor).toBe(factorFlavor(f.id, f.grade!));
      expect(f.ariaLabel).toBe(`${f.label}: ${f.gradeName}, ${f.flavor}`);
    }
    expect(b.bodies).toBeNull();
    expect(b.demandText).toBeNull();
    expect(b.nextNote).toBe("Each body's grades and the objective demand appear at detail 3 (Per body).");
    expect(b.wantsLaunchView).toBe(false);
  });

  it("Per body (Level 3): the per-body strip and the task demand line", () => {
    const s = crewed(3);
    const c = cand0(s);
    const b = telescopeBlockView(c, 3);
    expect(b.chipText).toBe("Detail 3 · Per body");
    expect(b.bodies).not.toBeNull();
    expect(b.bodies!.length).toBe(c.telescope.risk!.bodies!.length);
    expect(b.bodies![0].label).toMatch(/^Body 1/);
    expect(b.bodies![0].grades.map((g) => g.label)).toEqual(["Combat", "Fauna", "Flora", "Hazard"]);
    expect(b.demandText).toMatch(/^(Security work on|No Security work expected on) .*\.$/);
    expect(b.nextNote).toBe("The squad recommendation appears at detail 4 (Recommendation).");
    expect(b.wantsLaunchView).toBe(false);
    expect(telescopeBlockView(cand0(crewed(5)), 5).wantsLaunchView).toBe(true);
    expect(telescopeBlockView(cand0(crewed(5)), 5).nextNote).toBeNull();
  });

  it("Contact (detail 1): presence only, no meter; the ship's own hazard read lifts Hazard (the higher wins)", () => {
    const c = cand0(crewed(1));
    const preview = expeditionRiskPreview(c.seed);
    const contact: ExpeditionCandidate = {
      ...c,
      foreknowledge: { ...c.foreknowledge, bodies: (c.foreknowledge.bodies ?? []).map((x) => ({ ...x, hazard: null })) },
      telescope: { ...c.telescope, detail: 1, detailName: "Contact", risk: gateRiskView(preview, 1) },
    };
    const b = telescopeBlockView(contact, 1);
    for (const f of b.factors) {
      expect(f.grade).toBeNull();
      expect(f.lit).toBe(0);
      expect(["Present", "Not detected"]).toContain(f.gradeName);
      expect(f.gradeName).toBe(f.present ? "Present" : "Not detected");
    }
    expect(b.nextNote).toBe("Each factor's grade appears at detail 2 (Graded).");
    // The ship's sensors read a lethal hazard on a body: Hazard shows its grade even at Contact.
    const sensed: ExpeditionCandidate = {
      ...contact,
      foreknowledge: { ...contact.foreknowledge, inRange: true, bodies: [{ planetType: "toxic", hazard: 0.75 }] },
    };
    const hz = telescopeBlockView(sensed, 1).factors.find((f) => f.id === "hazard")!;
    expect(hz.grade).toBe(4);
    expect(hz.gradeName).toBe("Extreme");
    expect(hz.flavor).toBe("Lethal");
  });

  it("Blind: only the region, the distance, the chip and the range gap", () => {
    const blindAt0 = cand0(crewed(0));
    expect(blindAt0.telescope.blind).toBe(true);
    const b0 = telescopeBlockView(blindAt0, 0);
    expect(b0.blind).toBe(true);
    expect(b0.chipText).toBe("Blind launch");
    expect(b0.factors).toEqual([]);
    expect(b0.bodies).toBeNull();
    expect(b0.wantsLaunchView).toBe(false);
    expect(b0.rangeText).toMatch(/^The Subspace Telescope reads nothing yet; this system is \d[\d,]* ly\.$/);
    // A system past a founded telescope's range (forced: Tier II at Level 1).
    const c = cand0(crewed(1));
    const preview = expeditionRiskPreview(c.seed);
    const far = readSystem(telescopeReadingAtLevel(1), c.seed, 0, { ...preview, profile: { ...preview.profile, tier: 2 } });
    expect(far.blind).toBe(true);
    const b = telescopeBlockView({ ...c, telescope: { ...far, demand: null } }, 1);
    expect(b.rangeText).toBe(`Beyond the Subspace Telescope's range: Level 1 reads 150 ly; this system is ${far.distanceLy.toLocaleString("en-US")} ly.`);
    expect(candidateRegionText(far)).toBe(`Tier II · Orion Arm · ${far.distanceLy.toLocaleString("en-US")} ly`);
  });

  it("flavor lines: the engine's, else the mockup's for None and Hazard; never an em dash", () => {
    expect(factorFlavor("combat", 2)).toBe("Hostile activity");
    expect(factorFlavor("combat", 0)).toBe("No hostile signs");
    expect(factorFlavor("fauna", 0)).toBe("No life signs");
    expect(factorFlavor("flora", 0)).toBe("No growth");
    expect([0, 1, 2, 3, 4].map((g) => factorFlavor("hazard", g as 0))).toEqual(["Calm", "Mild", "Harsh", "Severe", "Lethal"]);
    for (const id of RISK_FACTOR_ORDER) for (const g of [0, 1, 2, 3, 4] as const) expect(factorFlavor(id, g)).not.toMatch(NO_DASH);
  });
});

describe("SQ-7 7.2: the recommendation box and the forecast line", () => {
  const rec = (kinds: GroundTeamKind[], current: GroundTeamKind[], isCurrent: boolean): LaunchRecommendation =>
    ({
      kinds,
      label: kinds.map((k) => k[0].toUpperCase() + k.slice(1)).join(" + "),
      current,
      currentLabel: "Ground + Ground",
      isCurrent,
      headline: isCurrent ? "Your Ground + Ground suits this system." : "Launch with Strike + Ground",
      reason: "Enemy territory on 1 of 1 body; 4 objectives need 2 Security squads.",
      unfinished: [],
      unfinishedText: null,
      stillUnfinished: [],
      stillUnfinishedText: null,
      oddsDecided: false,
      riskyFightsText: null,
      ranked: [],
    }) as LaunchRecommendation;

  it("Set composition names the change and who moves; Alpha stays put", () => {
    const s = crewed(5);
    const v = recommendationView(s, "ship-1", rec(["strike", "ground"], ["ground", "ground"], false));
    expect(v.headline).toBe("Launch with Strike + Ground");
    expect(v.currentText).toBe("Your ship: Ground + Ground");
    expect(v.action).not.toBeNull();
    expect(v.action!.label).toBe("Set composition: Strike + Ground");
    expect(v.action!.kinds).toEqual(["strike", "ground"]);
    expect(v.action!.moves).toEqual(["Bravo changes from Ground to Strike.", "M14, M15 and M16 move to the reserve.", "M7 and M8 join from the reserve."]);
    // M17 plus the three Science members dropped: 4 in the reserve for 3 berths (allowed, said plainly).
    expect(v.action!.overCapacity).toBe("The reserve will be over capacity: 4 members for 3 berths. Nobody has to leave; hiring pauses until it fits again.");
    expect(v.actionBlocked).toBeNull();
  });

  it("nothing to set when the ship already fields it; a pending team is confirmed instead", () => {
    const s = crewed(5);
    expect(recommendationView(s, "ship-1", rec(["ground", "ground"], ["ground", "ground"], true)).action).toBeNull();
    const pending = { ...s, ships: s.ships.map((sh) => ({ ...sh, groundTeams: sh.groundTeams!.map((t, i) => (i === 1 ? { ...t, kindPending: true as const } : t)) })) };
    const v = recommendationView(pending, "ship-1", rec(["ground", "ground"], ["ground", "ground"], true));
    expect(v.action!.label).toBe("Confirm Ground + Ground");
    expect(v.action!.moves).toEqual(["Bravo keeps Ground (confirms its type)."]);
  });

  it("the crew lock says why the composition cannot be set", () => {
    const s = crewed(5);
    const out: GameState = { ...s, expeditions: [{ id: "x", shipId: "ship-1" } as GameState["expeditions"][number]] };
    const v = recommendationView(out, "ship-1", rec(["strike", "ground"], ["ground", "ground"], false));
    expect(v.action).toBeNull();
    expect(v.actionBlocked).toBe("Ship is out on a mission.");
  });

  it("the forecast line names the tasks, the hardest fight, its crew and the odds", () => {
    const ship = crewed(7).ships[0];
    const threat = { tier: "worthy", name: "A Worthy Adversary" } as ThreatAssessment;
    const f: LaunchForecast = {
      kinds: ["strike", "ground"],
      label: "Strike + Ground",
      teamsDeployed: 2,
      tasks: 11,
      byDifficulty: [2, 6, 3, 0, 0],
      unfinished: 2,
      hardest: { bodyIndex: 0, poiId: "geothermalChamber", label: "Geothermal Chamber", difficulty: 3, difficultyName: "Challenging", fightPoints: 3, crew: [0, 1] },
      threat,
      note: null,
    };
    const v = forecastView(ship, f);
    expect(v.lead).toBe("Forecast with Strike + Ground");
    expect(v.tasksText).toBe("11 objectives: 2 Simple, 6 Standard, 3 Challenging");
    expect(v.unfinishedText).toBe("Leaves 2 objectives unfinished.");
    expect(v.hardestText).toBe("Hardest fight: Geothermal Chamber (Challenging, 3 fights), crew Alpha (Strike) + Bravo (Ground)");
    expect(v.threat).toBe(threat);
    const calm = forecastView(ship, { ...f, unfinished: 0, hardest: null, threat: null, note: "No fights expected" });
    expect(calm.hardestText).toBeNull();
    expect(calm.unfinishedText).toBeNull();
    expect(calm.note).toBe("No fights expected");
    // Objective affixes: a Deadly hardest fight carries Reinforcing (required there), shown as its pill.
    expect(v.affixPills).toEqual([]);
    const deadly = forecastView(ship, { ...f, hardest: { ...f.hardest!, difficulty: 5, difficultyName: "Deadly" } });
    expect(deadly.affixPills.map((p) => [p.label, p.color, p.alignment])).toEqual([["Reinforcing", "red", "Negative"]]);
  });

  it("the blind confirm carries the user's warning, plainly", () => {
    expect(BLIND_LAUNCH_TITLE).toBe("Blind launch");
    expect(BLIND_LAUNCH_WARNING).toBe("This is truly unknown territory. Are you sure you wish to go?");
    expect(`${BLIND_LAUNCH_WARNING} ${BLIND_LAUNCH_DETAIL}`).not.toMatch(NO_DASH);
  });
});

describe("the LAZY launch view: built once per input change, never per tick", () => {
  it("ticks that only move time reuse the view; a crew change rebuilds it", () => {
    // One warm-up tick: the fixture's empty crew complement fills on the first tick (a one-time ship change).
    let s = tick(1, crewed(7), () => 0.5, 999_000);
    const cache = createInputCache<ReturnType<typeof expandedLaunchView>>();
    let reads = 0;
    const reader: typeof expeditionLaunchView = (st, id, c) => {
      reads += 1;
      return expeditionLaunchView(st, id, c);
    };
    const read = (st: GameState) => {
      const c = expeditionCandidates(st, "ship-1")[0];
      const deploys = deployableGroundTeams(st, "ship-1").teams.map((t) => t.deploys);
      return cache.get(launchViewInputs(st, "ship-1", c, deploys), () => expandedLaunchView(st, "ship-1", c, reader));
    };
    const first = read(s);
    expect(first.view.recommendation).not.toBeNull();
    expect(first.recommendation).not.toBeNull();
    expect(first.forecast).not.toBeNull();
    for (let i = 0; i < 5; i++) {
      s = tick(1, s, () => 0.5, 1_000_000 + i * 1000);
      expect(read(s)).toBe(first);
    }
    expect(reads).toBe(1);
    expect(cache.computes()).toBe(1);
    // A member injured (the deploy set changes) rebuilds it once.
    const hurt = { ...s, awayMembers: s.awayMembers.map((m) => (m.id === "member-5" ? { ...m, injuredUntilSeconds: s.gameTimeSeconds + 600 } : m)) };
    const second = read(hurt);
    expect(second).not.toBe(first);
    expect(reads).toBe(2);
    expect(read(hurt)).toBe(second);
    expect(reads).toBe(2);
  });

  it("an injury running out changes the inputs with no record changing", () => {
    const s = crewed(7, (m) => (m.id === "member-5" ? { ...m, injuredUntilSeconds: T0 + 2 } : m));
    const c = expeditionCandidates(s, "ship-1")[0];
    const before = launchViewInputs(s, "ship-1", c, deployableGroundTeams(s, "ship-1").teams.map((t) => t.deploys));
    const later = { ...s, gameTimeSeconds: T0 + 5 };
    const after = launchViewInputs(later, "ship-1", c, deployableGroundTeams(later, "ship-1").teams.map((t) => t.deploys));
    expect(before.slice(0, -1)).toEqual(after.slice(0, -1));
    expect(before[before.length - 1]).not.toBe(after[after.length - 1]);
  });
});

describe("GO-12 review minors (folded into GO-13)", () => {
  it("the sensor split hint shows beside 'Contents hidden' only when the telescope still reads the system", () => {
    expect(sensorSplitHint({ blind: false, detail: 2 }, { inRange: false })).toBe(SENSOR_SPLIT_HINT);
    expect(sensorSplitHint({ blind: false, detail: 1 }, { inRange: false })).toBe(SENSOR_SPLIT_HINT);
    expect(sensorSplitHint({ blind: false, detail: 3 }, { inRange: true })).toBeNull();
    expect(sensorSplitHint({ blind: true, detail: 0 }, { inRange: false })).toBeNull();
    expect(SENSOR_SPLIT_HINT).toBe("The telescope reads risk; ship sensors read what is there.");
  });

  it("the launch view's inputs carry the fleet's talent unlocks by reference", () => {
    const s = crewed(7);
    const c = expeditionCandidates(s, "ship-1")[0];
    const inputs = launchViewInputs(s, "ship-1", c, [true, true]);
    expect(inputs).toContain(s.unlockedHomeworldTalents);
    const bought = { ...s, unlockedHomeworldTalents: [...s.unlockedHomeworldTalents] };
    const again = launchViewInputs(bought, "ship-1", c, [true, true]);
    expect(again.some((v, i) => !Object.is(v, inputs[i]))).toBe(true);
  });
});
