// WR-3: the Debug Wiring panel's view model (wiringPanelDisplay.ts), on the real registry and real saves, plus the
// verdict and filter logic on hand-built entries.

import { beforeAll, describe, expect, it } from "vitest";
import Decimal from "break_infinity.js";
import { freshState, type GameState } from "./game/model";
import { installMissingCombatBaselines } from "./game/tick";
import { CATALOGS, WIRING_REGISTRY, WIRING_SYSTEMS, curveExpected, type WiringEntry } from "./game/wiring/registry";
import {
  WIRING_CAPTAIN_ID,
  WIRING_SCIENCE_ID,
  WIRING_SECURITY_ID,
  WIRING_SHIP_ID,
  bucketOf,
  editCaptain,
  readProbe,
  seatOfficer,
  wearPiece,
  withAwayTeam,
  withBuckets,
  withFacilityLevel,
  withHomeworld,
  withMuseum,
} from "./game/wiring/probes";
import {
  PANEL_CAPTAIN_ID,
  PANEL_SCIENCE_ID,
  PANEL_SECURITY_ID,
  PANEL_SHIP_ID,
  catalogClassified,
  contributionText,
  expectedText,
  formatNumber,
  groupWiringRows,
  loadWiringDeps,
  measureWiring,
  measureWiringSync,
  rowMatches,
  statusChip,
  wiringProbeView,
  wiringSubjectsText,
  wiringTotals,
  type WiringDeps,
  type WiringFilter,
  type WiringRow,
} from "./wiringPanelDisplay";

const DEPS: WiringDeps = { registry: WIRING_REGISTRY, systems: WIRING_SYSTEMS, catalogs: CATALOGS, readProbe, curveExpected };
const ALL: WiringFilter = { system: "all", view: "all", search: "" };

// The save a new game starts from (App.svelte: installMissingCombatBaselines(freshState(...))).
const newGame = (): GameState => installMissingCombatBaselines(freshState());
const rowOf = (rows: readonly WiringRow[], id: string): WiringRow => {
  const r = rows.find((x) => x.id === id);
  if (!r) throw new Error(`no row ${id}`);
  return r;
};

// Move the fixture members to ordinary save ids (as a real save numbers them), everywhere the save names them.
function renumberMembers(s: GameState): GameState {
  const ren = (id: string | null | undefined) => (id === WIRING_SECURITY_ID ? "member-5" : id === WIRING_SCIENCE_ID ? "member-6" : id);
  const swap = (json: string) => json.split(`"${WIRING_SECURITY_ID}"`).join('"member-5"').split(`"${WIRING_SCIENCE_ID}"`).join('"member-6"');
  return {
    ...s,
    awayMembers: s.awayMembers.map((m) => ({ ...m, id: ren(m.id)! })),
    equipment: s.equipment.map((e) => ({ ...e, fittedToMemberId: ren(e.fittedToMemberId) })),
    ships: s.ships.map((sh) => (sh.groundTeams ? { ...sh, groundTeams: JSON.parse(swap(JSON.stringify(sh.groundTeams))) } : sh)),
  };
}

describe("wiring panel: the registry side", () => {
  it("measures the same subjects the probes read", () => {
    expect(PANEL_SHIP_ID).toBe(WIRING_SHIP_ID);
    expect(PANEL_CAPTAIN_ID).toBe(WIRING_CAPTAIN_ID);
    expect(PANEL_SECURITY_ID).toBe(WIRING_SECURITY_ID);
    expect(PANEL_SCIENCE_ID).toBe(WIRING_SCIENCE_ID);
  });

  it("classifies every catalog the registry names (a new catalog must get an owner reader, content or a reason)", () => {
    const catalogs = [...new Set(WIRING_REGISTRY.map((e) => e.source.catalog))];
    expect(catalogs.filter((c) => !catalogClassified(c))).toEqual([]);
  });

  it("loads the registry lazily with the same entries", async () => {
    const deps = await loadWiringDeps();
    expect(deps.registry).toBe(WIRING_REGISTRY);
    expect(deps.systems).toEqual(WIRING_SYSTEMS);
  });
});

describe("wiring panel: a new game", () => {
  let save: GameState;
  let rows: WiringRow[];
  beforeAll(() => {
    save = newGame();
    rows = measureWiringSync(save, DEPS);
  });

  it("has one row per registry entry, in registry order, every one grouped under its system", () => {
    expect(rows.map((r) => r.id)).toEqual(WIRING_REGISTRY.map((e) => e.id));
    const groups = groupWiringRows(rows, WIRING_SYSTEMS, ALL);
    expect(groups.map((g) => g.system)).toEqual(WIRING_SYSTEMS.filter((s) => rows.some((r) => r.system === s)));
    expect(groups.reduce((n, g) => n + g.rows.length, 0)).toBe(WIRING_REGISTRY.length);
    const totals = wiringTotals(rows);
    expect(Object.values(totals.byStatus).reduce((a, b) => a + b, 0)).toBe(WIRING_REGISTRY.length);
    expect(totals.byStatus.seam).toBeGreaterThan(0);
  });

  it("owns only the starting facilities, the starting hull and its Standard Issue gear, and nothing owned is dead", () => {
    const owned = rows.filter((r) => r.ownership === "owned");
    // 0.14.0 (user 2026-11-17 "free basic set, all ships"): the hull's Standard-Issue gear now includes a Balanced Array,
    // a Balanced Command bridge and Utilitarian Quarters, so their catalogs (and the hull bonus they give) are owned too.
    expect(new Set(owned.map((r) => r.source.split(":")[0]))).toEqual(
      new Set(["FACILITIES", "SUBSPACE_TELESCOPE_LEVELS", "SHIP_GEAR_LINES", "SHIP_TYPES", "SENSOR_ARRAYS", "BRIDGE_MODULES", "QUARTERS_MODULES", "HULL_FAMILY_MODULE_BONUS"]),
    );
    // The plan's QA line: "contributing nothing" on a fresh save lists no deferred source. Since the free crew modules,
    // it lists exactly the three module effects that wait on people a new game does not have yet: the bridge's officer
    // lift (no officer seated) and the quarters' division lifts (no crew aboard).
    expect(rows.filter((r) => rowMatches(r, { ...ALL, view: "ownedNothing" })).map((r) => r.id)).toEqual([
      "ship:QUARTERS_MODULES:quartersUtilitarian",
      "ship:BRIDGE_MODULES:bridgeBalancedCommand",
      "ship:HULL_FAMILY_MODULE_BONUS:general:quarters:divisions",
    ]);
    // Mission Control rung 1 opens its missions, measured as that rung's own step, on its curve.
    const mc = rowOf(rows, "facility:FACILITIES:missionControl:0");
    expect(mc.verdict).toBe("contributing");
    expect(mc.readings[0].without).toBe(0);
    expect(mc.readings[0].onCurve).toBe(true);
    // Hull data is owned but not removable from the save.
    expect(rowOf(rows, "ship:SHIP_TYPES:generalFreighter:cargoCapacity").verdict).toBe("unmeasured");
  });

  it("does not write the save", () => {
    const before = JSON.stringify(save);
    measureWiringSync(save, DEPS);
    expect(JSON.stringify(save)).toBe(before);
  });

  it("names its subjects", () => {
    expect(wiringSubjectsText(save)).toContain(`(${WIRING_SHIP_ID})`);
    expect(wiringSubjectsText(save)).toContain("Security: none aboard");
  });
});

describe("wiring panel: owned sources measure their live contribution", () => {
  it("a captain secondary node: x1.05 yield, on its curve; not owned before it is bought", () => {
    const before = rowOf(measureWiringSync(newGame(), DEPS), "captain:SECONDARY_CAPTAIN_TALENTS:extraction1");
    expect(before.ownership).toBe("notOwned");
    expect(before.readings).toEqual([]);
    const s = editCaptain(newGame(), { unlockedSecondaryTalents: ["extraction1"] });
    const r = rowOf(measureWiringSync(s, DEPS), "captain:SECONDARY_CAPTAIN_TALENTS:extraction1");
    expect(r.ownership).toBe("owned");
    expect(r.verdict).toBe("contributing");
    expect(r.magnitude).toBeGreaterThan(0);
    expect(r.readings[0].now! / r.readings[0].without!).toBeCloseTo(1 + r.magnitude!, 9);
    expect(r.readings[0].onCurve).toBe(true);
  });

  // Complement CP-19 fix round (user 2026-11-09 "Flat +1 always"): on a save with a Recruiter and bought rungs, every
  // Personnel Rosters effect row and both Recruiter rows read on their curve; the Level 1 base-value pins are left
  // unmeasured (the Recruiter's +1 sits on top of the base on a real save).
  it("a Recruiter save with Personnel Rosters rungs: no board row reads off curve", () => {
    const s = withFacilityLevel(editCaptain(newGame(), { unlockedSecondaryTalents: ["commandCrew4"] }), "personnelRosters", 4);
    const rows = measureWiringSync(s, DEPS).filter((r) => r.id.includes("personnelRosters") || r.id.includes("commandCrew4"));
    expect(rows).toHaveLength(14);
    for (const r of rows) for (const reading of r.readings) expect(reading.onCurve, `${r.id} ${JSON.stringify(reading)}`).not.toBe(false);
    for (const i of [1, 2, 3]) {
      const r = rowOf(rows, `facility:FACILITIES:personnelRosters:${i}`);
      expect([r.verdict, r.readings[0].now! - r.readings[0].without!, r.readings[0].onCurve]).toEqual(["contributing", 2, true]);
    }
    const recruiter = rowOf(rows, "captain:SECONDARY_CAPTAIN_TALENTS:commandCrew4:recruits");
    expect([recruiter.readings[0].now, recruiter.readings[0].without, recruiter.readings[0].onCurve]).toEqual([17, 16, true]);
    expect(rowOf(rows, "facility:FACILITIES:personnelRosters:0").readings).toEqual([]);
  });

  it("a Homeworld talent and a facility rung above the starting level", () => {
    const s = withFacilityLevel(withHomeworld(newGame(), ["fleetLogisticsHub"]), "refinery", 3);
    const rows = measureWiringSync(s, DEPS);
    expect(rowOf(rows, "fleetAdmiral:HOMEWORLD_TALENTS:fleetLogisticsHub").verdict).toBe("contributing");
    for (const i of [0, 1, 2]) expect(rowOf(rows, `facility:FACILITIES:refinery:${i}`).verdict).toBe("contributing");
    expect(rowOf(rows, "facility:FACILITIES:refinery:3").ownership).toBe("notOwned");
  });

  it("an officer bonus counts only on the measured ship", () => {
    const aboard = seatOfficer(newGame(), "operations", ["ops.cargoExpand"]);
    const r = rowOf(measureWiringSync(aboard, DEPS), "officer:officer.effectiveCargoMult");
    expect(r.ownership).toBe("owned");
    expect(r.verdict).toBe("contributing");
    expect(r.readings[0].expected).toBeNull(); // an officer's magnitude is the fixture ensign's, not this save's
    const elsewhere = { ...aboard, officers: aboard.officers.map((o) => ({ ...o, assignedShipId: "ship-7" })) };
    expect(rowOf(measureWiringSync(elsewhere, DEPS), "officer:officer.effectiveCargoMult").ownership).toBe("notOwned");
  });

  it("complement buffs and Museum stats the save really has", () => {
    let s = withBuckets(newGame(), [bucketOf("operations", "ops.unloadSpeed")]);
    s = withMuseum(s, { glyphTablet: 12, resonanceShard: 12 });
    const rows = measureWiringSync(s, DEPS);
    expect(rowOf(rows, "crew:crew.unloadSpeed").verdict).toBe("contributing");
    expect(rowOf(rows, "relic:MUSEUM_STATS:researchSpeed").verdict).toBe("contributing");
    expect(rowOf(rows, "relic:RELICS:glyphTablet").verdict).toBe("contributing");
    // A Museum stat no relic held here gives is not owned (not a false "contributing nothing").
    expect(rowOf(rows, "relic:MUSEUM_STATS:hazardResist").ownership).toBe("notOwned");
    // The free Balanced Command bridge lifts officers, and none is seated here (the crew aboard now gives the free
    // Utilitarian Quarters' division lifts something to act on).
    expect(rows.filter((r) => r.verdict === "nothing" || r.verdict === "error").map((r) => r.id)).toEqual(["ship:BRIDGE_MODULES:bridgeBalancedCommand"]);
  });

  it("away members under their own save ids are measured as the probes' members", () => {
    let s = withAwayTeam(newGame(), { traits: ["steadyAim"] });
    s = wearPiece(s, WIRING_SECURITY_ID, "memberArmor", "ballisticWeave", { groundHp: 20 });
    s = renumberMembers(s);
    expect(s.awayMembers.map((m) => m.id)).toEqual(["member-5", "member-6"]);
    const view = wiringProbeView(s);
    expect(view.awayMembers.map((m) => m.id)).toEqual([WIRING_SECURITY_ID, WIRING_SCIENCE_ID]);
    expect(view.equipment.find((e) => e.slotType === "memberArmor")?.fittedToMemberId).toBe(WIRING_SECURITY_ID);
    expect(s.awayMembers.map((m) => m.id)).toEqual(["member-5", "member-6"]); // the save itself is untouched
    const rows = measureWiringSync(s, DEPS);
    const trait = rowOf(rows, "away:AWAY_TRAITS:steadyAim");
    expect(trait.verdict).toBe("contributing");
    expect(trait.readings[0].onCurve).toBe(true);
    expect(rowOf(rows, "gear:security:ballisticWeave:groundHp").verdict).toBe("contributing");
    expect(wiringSubjectsText(s)).not.toContain("Security: none aboard");
  });

  it("a member already holding a fixture id elsewhere steps aside", () => {
    const s = renumberMembers(withAwayTeam(newGame()));
    const stray = { ...s.awayMembers[0], id: WIRING_SECURITY_ID, assignedShipId: null };
    const view = wiringProbeView({ ...s, awayMembers: [stray, ...s.awayMembers] });
    const ids = view.awayMembers.map((m) => m.id);
    expect(ids.filter((id) => id === WIRING_SECURITY_ID)).toHaveLength(1);
    expect(view.awayMembers.find((m) => m.id === WIRING_SECURITY_ID)?.assignedShipId).toBe(WIRING_SHIP_ID);
    expect(ids).toContain(`wiring-panel-aside-${WIRING_SECURITY_ID}`);
  });
});

// Hand-built entries on one owned source (captain 1 owning extraction1), to pin the verdicts.
function fakeEntry(over: Partial<WiringEntry>): WiringEntry {
  return {
    id: "test:entry",
    system: "captain",
    source: { catalog: "SECONDARY_CAPTAIN_TALENTS", key: "extraction1" },
    claim: "a test claim",
    probe: "sheetYield",
    contexts: ["sheet"],
    direction: "up",
    curve: { kind: "linearRelative" },
    magnitude: () => 0.05,
    on: (s) => s,
    off: (s) => s,
    base: () => newGame(),
    status: { kind: "live" },
    ...over,
  };
}

describe("wiring panel: verdicts, filters and text", () => {
  const owning = () => editCaptain(newGame(), { unlockedSecondaryTalents: ["extraction1"] });
  const fakeDeps = (entries: WiringEntry[], read: WiringDeps["readProbe"]): WiringDeps => ({ ...DEPS, registry: entries, readProbe: read });

  it("owned, nothing moved: contributing nothing; the probe failing: an error with its message", () => {
    const flat = measureWiringSync(owning(), fakeDeps([fakeEntry({})], () => 1))[0];
    expect(flat.verdict).toBe("nothing");
    expect(flat.readings[0]).toMatchObject({ now: 1, without: 1, moved: false, onCurve: false });
    const broken = measureWiringSync(owning(), fakeDeps([fakeEntry({})], () => {
      throw new Error("no ship-1");
    }))[0];
    expect(broken.verdict).toBe("error");
    expect(contributionText(broken.readings[0])).toBe("probe error: no ship-1");
    expect(rowMatches(flat, { ...ALL, view: "ownedNothing" })).toBe(true);
    expect(rowMatches(broken, { ...ALL, view: "ownedNothing" })).toBe(true);
  });

  it("an entry asserting no direction is information; a pending owned source with no live context does nothing", () => {
    const info = measureWiringSync(owning(), fakeDeps([fakeEntry({ direction: "none" })], () => 1))[0];
    expect(info.verdict).toBe("info");
    const pend = measureWiringSync(owning(), fakeDeps([fakeEntry({ contexts: [], status: { kind: "pending", owner: "WR-99" } })], () => 1))[0];
    expect(pend.verdict).toBe("nothing");
    expect(pend.status).toEqual({ kind: "pending", label: "pending", detail: "WR-99" });
    expect(rowMatches(pend, { ...ALL, view: "pending" })).toBe(true);
    expect(rowMatches(pend, { ...ALL, view: "notLive" })).toBe(false);
  });

  it("status chips name the owner and the user's words", () => {
    expect(statusChip({ kind: "live" })).toEqual({ kind: "live", label: "live", detail: "" });
    expect(statusChip({ kind: "pending", owner: "G2-2", contexts: ["patrol"] })).toEqual({ kind: "pending", label: "partial", detail: "G2-2 (not yet: patrol)" });
    expect(statusChip({ kind: "deferred", owner: "CP-15", userRef: "T3" }).detail).toBe("CP-15; T3");
    expect(statusChip({ kind: "held", userRef: "D14" }).label).toBe("held");
    expect(statusChip({ kind: "seam", owner: "the tutorial patch", userRef: "Hook only" })).toEqual({
      kind: "seam",
      label: "seam",
      detail: "the tutorial patch; Hook only",
    });
  });

  it("filters by system, view and search", () => {
    const rows = measureWiringSync(newGame(), DEPS);
    const captain = groupWiringRows(rows, WIRING_SYSTEMS, { ...ALL, system: "captain" });
    expect(captain.map((g) => g.system)).toEqual(["captain"]);
    const seams = rows.filter((r) => rowMatches(r, { ...ALL, view: "notLive" }));
    expect(seams.length).toBe(WIRING_REGISTRY.filter((e) => ["deferred", "held", "seam"].includes(e.status.kind)).length);
    const found = rows.filter((r) => rowMatches(r, { ...ALL, search: "EXTRACTION1" }));
    expect(found.map((r) => r.id)).toContain("captain:SECONDARY_CAPTAIN_TALENTS:extraction1");
    expect(rows.filter((r) => rowMatches(r, { ...ALL, view: "owned" })).every((r) => r.ownership === "owned")).toBe(true);
  });

  it("measures in slices with progress, to the same rows", async () => {
    const s = owning();
    const progress: number[] = [];
    const rows = await measureWiring(s, DEPS, { chunk: 300, onProgress: (done) => progress.push(done), yieldFn: async () => {} });
    expect(rows).toEqual(measureWiringSync(s, DEPS));
    expect(progress[progress.length - 1]).toBe(WIRING_REGISTRY.length);
    expect(progress.length).toBe(Math.ceil(WIRING_REGISTRY.length / 300));
  });

  it("formats readings", () => {
    expect(formatNumber(null)).toBe("n/a");
    expect(formatNumber(9)).toBe("9");
    expect(formatNumber(1.0500000001)).toBe("1.05");
    expect(formatNumber(58310.4)).toBe("58310");
    expect(contributionText({ context: "sheet", now: 1.05, without: 1, expected: 1.05, moved: true, onCurve: true })).toBe("1.05 vs 1 (+0.05, +5%)");
    expect(contributionText({ context: "sheet", now: 2, without: 0, expected: null, moved: true, onCurve: null })).toBe("2 vs 0 (+2)");
    expect(expectedText({ context: "sheet", now: 1.05, without: 1, expected: 1.05, moved: true, onCurve: true })).toBe("1.05 (on curve)");
    expect(expectedText({ context: "sheet", now: 1.1, without: 1, expected: 1.05, moved: true, onCurve: false })).toBe("1.05 (off curve)");
    expect(expectedText({ context: "sheet", now: 1, without: 1, expected: null, moved: false, onCurve: null })).toBe("n/a");
  });

  it("keeps Decimal fields intact in the view", () => {
    const s = { ...newGame(), credits: new Decimal(1234) };
    expect(wiringProbeView(s).credits.eq(1234)).toBe(true);
  });
});
