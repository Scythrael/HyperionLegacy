// G1-6 (Short-Range Missions, docs/plans/2026-10-17-short-range-missions-plan.md G1-6 and the signed-off board mockup):
// the board's display decisions. Every number and word is read from the engine; these tests pin that the board shows
// what the engine decides (the dispatch gate, the departure hold, the roll, the plan) and the mockup's choices (the
// pre-pick, the six bars, the picker order, the calm waiting line, the collapsed job types list).

import { describe, expect, it } from "vitest";
import Decimal from "break_infinity.js";
import { MISSION_CONTROL_BOARD_RUNGS, MISSIONS, type CaptainState, type GameState, type RunDifficultyStamp } from "./game/model";
import {
  SHORT_RANGE_CATEGORIES,
  SHORT_RANGE_SHEETS,
  SHORT_RANGE_TEMPLATE_KEYS,
  shortRangeCyclePlan,
  shortRangeShipEngineering,
  shortRangeTemplateUses,
  type ShortRangeRoll,
  type ShortRangeTemplateKey,
} from "./game/shortRange";
import { dispatchCaptainOnShortRange, shortRangeBlockText, shortRangeBoardSlots, shortRangeSlotPreview } from "./game/shortRangeBoard";
import { effectiveShipStats, resolveCrew } from "./game/crewOverlay";
import { recallCaptain } from "./game/tick";
import { buildHomeDashboard } from "./game/homeDashboard";
import { WIRING_CAPTAIN_ID, captainOf, editShip, installPiece, shipOf, wiringBase } from "./game/wiring/probes";
import { ICON_SEMANTICS } from "./ui/iconPacks";
import {
  SHORT_RANGE_CATEGORY_VIEW,
  SHORT_RANGE_PREPICK_RULE,
  SHORT_RANGE_SHEET_MARK,
  SHORT_RANGE_TEMPLATE_ICON,
  missionControlRungSlotText,
  shortRangeBars,
  shortRangeBestReady,
  shortRangeBoardView,
  shortRangeCompare,
  shortRangeCostPreview,
  shortRangeJobLine,
  shortRangePickerRows,
  shortRangeRampChip,
  shortRangeRunView,
  shortRangeStatusLine,
  shortRangeTypeRows,
  shortRangeVerdict,
} from "./shortRangeBoardDisplay";

// ===== fixtures =====

// A crewed Eir with a sensor array: meets the Tier I sheet in every category (shortRange.test.ts G1-2).
function qualified(): GameState {
  const eir = resolveCrew({ ...editShip(wiringBase(), { typeKey: "eir" }), gameTimeSeconds: 6 * 3600 });
  return installPiece(eir, { slotType: "sensor", moduleVariant: "sensorBalanced", implicitStats: { sensors: 20 } });
}

// A second captain (id 2) flying a copy of ship-1 (ship-2) with the same gear.
function withSecondCaptain(s: GameState, sensors?: number): GameState {
  const c1 = captainOf(s);
  const c2: CaptainState = { ...c1, id: 2, label: "Captain 2", mission: null };
  const ship2 = { ...shipOf(s), id: "ship-2", assignedCaptainId: 2 };
  const gear2 = s.equipment
    .filter((e) => e.fittedToShipId === "ship-1")
    .map((e) => ({ ...e, id: `${e.id}-2`, fittedToShipId: "ship-2", ...(sensors !== undefined && e.slotType === "sensor" ? { implicitStats: { sensors } } : {}) }));
  return { ...s, captains: [...s.captains, c2], ships: [...s.ships, ship2], equipment: [...s.equipment, ...gear2] };
}

// The state with slot 0's cycle cursor moved to the first cycle whose preview draws `template`.
function slotDrawing(s: GameState, template: ShortRangeTemplateKey): GameState {
  for (let c = 0; c < 500; c++) {
    const at: GameState = { ...s, shortRangeBoard: { version: 1, nextCycle: { 0: c } } };
    if (shortRangeSlotPreview(at, { id: 0, tier: 1 }).template === template) return at;
  }
  throw new Error(`no ${template} in 500 cycles`);
}

function dispatched(s: GameState, slotId = 0): GameState {
  const r = dispatchCaptainOnShortRange(s, WIRING_CAPTAIN_ID, slotId, true);
  expect(r.success).toBe(true);
  return r.next;
}

const STAMP = (firstRun: boolean, ramp: number, tier: 1 | 2 = 1): RunDifficultyStamp => ({ version: 1, firstRun, ramp, tier });

function roll(template: ShortRangeTemplateKey, over: Partial<ShortRangeRoll> = {}): ShortRangeRoll {
  return { version: 1, seed: 1, slotId: 0, cycleIndex: 0, template, tier: 1, destinationIndex: 0, distanceLy: 29, flavorIndex: 0, difficulty: STAMP(false, 1), ...over };
}

// ===== vocabulary =====

describe("G1-6 vocabulary: every glyph is a classified SVG icon", () => {
  it("each job and each category draws an icons.ts glyph that ICON_SEMANTICS classifies", () => {
    for (const k of SHORT_RANGE_TEMPLATE_KEYS) expect(ICON_SEMANTICS[SHORT_RANGE_TEMPLATE_ICON[k]], k).toBeDefined();
    for (const c of SHORT_RANGE_CATEGORIES) expect(ICON_SEMANTICS[SHORT_RANGE_CATEGORY_VIEW[c].icon], c).toBeDefined();
    expect(SHORT_RANGE_TEMPLATE_ICON.commBoosterBuild).toBe("commBooster");
    expect(SHORT_RANGE_TEMPLATE_ICON.prisonerTransport).toBe("security");
    expect(ICON_SEMANTICS.shortRange).toBe("subject");
  });

  it("each job's line names what, where and how far", () => {
    expect(shortRangeJobLine(roll("refugeeRelocation", { guests: 41, destinationIndex: 1 }))).toBe("41 refugees to Body III, temperate world, 29 ly out");
    expect(shortRangeJobLine(roll("prisonerTransport", { guests: 20, distanceLy: 15 }))).toBe("20 prisoners to Body II, desert world, 15 ly out");
    expect(shortRangeJobLine(roll("supplyDropOff", { units: 120 }))).toBe("120 units of supplies to Body II, desert world, 29 ly out");
    expect(shortRangeJobLine(roll("supplyPickup", { units: 62 }))).toBe("62 units of supplies from Body II, desert world, 29 ly out");
    expect(shortRangeJobLine(roll("phenomenonSurvey", { scan: 6, distanceLy: 15 }))).toBe("A 6 point scan near Body V, 15 ly out");
    expect(shortRangeJobLine(roll("telescopeRepair", { units: 20 }))).toBe("20 units of parts to the telescope at Body III, L2 point, 29 ly out");
    expect(shortRangeJobLine(roll("commBoosterBuild", { units: 50 }))).toBe("50 units of components to the relay at Body V, L4 trojan point, 29 ly out");
  });

  it("the slow start chip: none on the training run or at full size; the size share on a Tier I ramp", () => {
    expect(shortRangeRampChip(roll("supplyPickup", { difficulty: STAMP(true, 0) }))).toBeNull();
    expect(shortRangeRampChip(roll("supplyPickup", { difficulty: STAMP(false, 0) }))).toBe("Slow start: size up to 35%");
    expect(shortRangeRampChip(roll("supplyPickup", { difficulty: STAMP(false, 1) }))).toBeNull();
    expect(shortRangeRampChip(roll("supplyPickup", { tier: 2, difficulty: STAMP(false, 1, 2) }))).toBeNull();
  });
});

// ===== the board =====

describe("G1-6 the board: open slots, then the Mission Control slots still to open", () => {
  it("a fresh save: two free Tier I slots, then the level 2 and level 3 slots with their cost and gate", () => {
    const v = shortRangeBoardView(wiringBase());
    expect(v.headline).toBe("Mission Control level 1: 2 of 4 slots open");
    expect(v.cards.map((c) => [c.kind, c.slotId, c.tier])).toEqual([
      ["free", 0, 1],
      ["free", 1, 1],
      ["locked", 2, 2],
      ["locked", 3, 2],
    ]);
    const l2 = v.cards[2];
    const l3 = v.cards[3];
    if (l2.kind !== "locked" || l3.kind !== "locked") throw new Error("not locked");
    expect(l2.level).toBe(2);
    expect(l2.credits).toBe(MISSION_CONTROL_BOARD_RUNGS[0].credits!.toNumber());
    expect(l2.durationTicks).toBe(MISSION_CONTROL_BOARD_RUNGS[0].durationTicks);
    expect(l2.gate.map((g) => g.label)).toEqual([MISSIONS.shortOreRun.label, MISSIONS.longOreRun.label]);
    expect(l2.gate.every((g) => g.have === 0 && g.need === 50)).toBe(true);
    expect(l2.sheetText).toBe("Tier II sheet: 130 ly, Cargo 150, Guest quarters 100, Sensors 20, Engineering 5, Security 4");
    expect(l3.level).toBe(3);
    expect(l3.gate).toEqual([]);
  });

  it("Mission Control level 2 opens the Tier II slot; the completion gate reads the lifetime tally", () => {
    const s = { ...wiringBase(), facilities: { ...wiringBase().facilities, missionControl: { level: 2 } } };
    const v = shortRangeBoardView(s);
    expect(v.headline).toBe("Mission Control level 2: 3 of 4 slots open");
    expect(v.cards.map((c) => c.kind)).toEqual(["free", "free", "free", "locked"]);
    const gated = shortRangeBoardView({ ...wiringBase(), lifetimeStats: { ...wiringBase().lifetimeStats, missionsCompleted: { shortOreRun: new Decimal(31) } } });
    const card = gated.cards[2];
    if (card.kind !== "locked") throw new Error("not locked");
    expect(card.gate[0]).toEqual({ label: MISSIONS.shortOreRun.label, have: 31, need: 50 });
  });

  it("a free slot shows its next roll (the roll dispatch takes) against the best ready captain", () => {
    const s = qualified();
    const card = shortRangeBoardView(s).cards[0];
    if (card.kind !== "free") throw new Error("not free");
    const preview = shortRangeSlotPreview(s, { id: 0, tier: 1 });
    expect(card.job.template).toBe(preview.template);
    expect(card.job.training).toBe(true); // a fresh save: every template's first run is its training run
    expect(card.compare?.ready).toBe(true);
    expect(card.compare?.captainId).toBe(WIRING_CAPTAIN_ID);
    expect(card.compare?.shortLines).toEqual([]);
    expect(card.compare?.wayIn).toBeNull();
    // Six bars in sheet order; the job's categories bold, the rest on standby; none short.
    expect(card.compare?.bars.map((b) => b.category)).toEqual([...SHORT_RANGE_CATEGORIES]);
    expect(card.compare?.bars.filter((b) => b.used).map((b) => b.category)).toEqual(shortRangeTemplateUses(preview.template));
    expect(card.compare?.bars.some((b) => b.short)).toBe(false);
  });

  it("nobody ready: the closest captain, every short category in the gate's own words, and one way in", () => {
    const s = wiringBase(); // a bare General Freighter: short of guests, sensors, engineering and security
    const card = shortRangeBoardView(s).cards[0];
    if (card.kind !== "free") throw new Error("not free");
    expect(card.compare?.ready).toBe(false);
    expect(card.compare?.shortLines).toEqual(["guests", "sensors", "engineering", "security"].map((c) => shortRangeBlockText(c as never)));
    expect(card.compare?.wayIn).toContain("a Guest Wing in the Crew Quarters Module");
    expect(card.compare?.wayIn).toContain("any Sensor Array");
    expect(card.compare?.bars.filter((b) => b.short).map((b) => b.category)).toEqual(["guests", "sensors", "engineering", "security"]);
  });

  it("no captain with a sound ship to compare: no comparison, the sheet as text", () => {
    const s = editShip(wiringBase(), { assignedCaptainId: null });
    const card = shortRangeBoardView(s).cards[0];
    if (card.kind !== "free") throw new Error("not free");
    expect(card.compare).toBeNull();
    expect(card.sheetText).toContain("Tier I sheet: 90 ly");
  });

  it("a flown slot is a run card; the run's slot is no longer free", () => {
    const s = dispatched(qualified());
    const v = shortRangeBoardView(s);
    expect(v.cards[0].kind).toBe("run");
    expect(v.cards[1].kind).toBe("free");
  });
});

// ===== bars =====

describe("G1-6 the sheet bars", () => {
  it("value / sheet, the crew ratings to one place, the fill at the sheet mark for a ship exactly at the sheet", () => {
    const s = qualified();
    const bars = shortRangeBars(s, shipOf(s), 1, ["range", "guests"]);
    const eng = bars.find((b) => b.category === "engineering")!;
    expect(eng.haveText).toBe(shortRangeShipEngineering(s, shipOf(s)).toFixed(1));
    expect(eng.needText).toBe(String(SHORT_RANGE_SHEETS[1].engineering));
    expect(bars.find((b) => b.category === "range")!.needText).toBe("90 ly");
    for (const b of bars) {
      expect(b.fill).toBeGreaterThanOrEqual(SHORT_RANGE_SHEET_MARK - 1e-9); // all met: at or past the sheet line
      expect(b.fill).toBeLessThanOrEqual(1);
    }
    expect(bars.filter((b) => b.used).map((b) => b.category)).toEqual(["range", "guests"]);
  });
});

// ===== captains =====

describe("G1-6 the pre-pick and the picker", () => {
  it(`the pre-pick (${SHORT_RANGE_PREPICK_RULE}): the ready ship with the widest margin; ties to the lowest id`, () => {
    const tie = withSecondCaptain(qualified());
    expect(shortRangeBestReady(tie, 0)).toBe(WIRING_CAPTAIN_ID);
    // Captain 1's ship meets Sensors exactly (its binding category, margin 1); captain 2's copy has twice the sheet, so
    // its smallest ratio is one of its other, roomier categories: captain 2 clears the sheet by more.
    const eir = resolveCrew({ ...editShip(wiringBase(), { typeKey: "eir" }), gameTimeSeconds: 6 * 3600 });
    const atSheet = installPiece(eir, { slotType: "sensor", moduleVariant: "sensorBalanced", implicitStats: { sensors: SHORT_RANGE_SHEETS[1].sensors } });
    const wider = withSecondCaptain(atSheet, SHORT_RANGE_SHEETS[1].sensors * 2);
    expect(shortRangeBestReady(wider, 0)).toBe(2);
    const cmp = shortRangeCompare(wider, { id: 0, tier: 1 }, shortRangeSlotPreview(wider, { id: 0, tier: 1 }));
    expect(cmp?.ready).toBe(true);
    expect(cmp?.captainId).toBe(2);
    expect(shortRangeBestReady(wiringBase(), 0)).toBeNull();
    expect(shortRangeBestReady(qualified(), 9)).toBeNull();
  });

  it("ready first (the pre-pick on top), then short (selectable), then blocked with the reason", () => {
    const base = withSecondCaptain(qualified());
    const flying = dispatched(base, 0); // captain 1 now flies slot 0
    const rows = shortRangePickerRows(flying, 1);
    expect(rows.map((r) => [r.captainId, r.kind])).toEqual([
      [2, "ready"],
      [WIRING_CAPTAIN_ID, "blocked"],
    ]);
    expect(rows[0].why).toBe("Ready, best match");
    expect(rows[0].best).toBe(true);
    expect(rows[1].why).toBe(`${shortRangeBlockText("busy")} (flying Slot 1)`);
    const bare = shortRangePickerRows(wiringBase(), 0);
    expect(bare[0].kind).toBe("short");
    expect(bare[0].why).toBe("Short: Guest quarters, Sensors, Engineering crew rating, Security crew rating");
  });

  it("the verdict: ok, every short category, or the one status reason", () => {
    expect(shortRangeVerdict(qualified(), WIRING_CAPTAIN_ID, 0)).toEqual({ ok: true, title: null, lines: [] });
    const short = shortRangeVerdict(wiringBase(), WIRING_CAPTAIN_ID, 0);
    expect(short.ok).toBe(false);
    expect(short.title).toBe("Captain 1 cannot take this slot yet:");
    expect(short.lines).toHaveLength(4);
    const noShip = shortRangeVerdict(editShip(wiringBase(), { assignedCaptainId: null }), WIRING_CAPTAIN_ID, 0);
    expect(noShip.lines).toEqual([shortRangeBlockText("noShip")]);
  });
});

// ===== cost preview =====

describe("G1-6 the cost preview", () => {
  it("this job from the engine's own plan and reward; the drop-off load span; a per-hour estimate", () => {
    const s = qualified();
    const slot = { id: 0, tier: 1 as const };
    const p = shortRangeCostPreview(s, WIRING_CAPTAIN_ID, slot)!;
    const preview = shortRangeSlotPreview(s, slot);
    const ship = shipOf(s);
    expect(p.training).toBe(true);
    expect(p.cycleTicks).toBe(shortRangeCyclePlan(preview, effectiveShipStats(s, ship), shortRangeShipEngineering(s, ship)).totalTicks);
    expect(p.dropOffLoad).toEqual([120, 270]); // Tier I: 40 to 90 units at 3 credits, no Trade discount
    expect(p.marginPct).toBe(20);
    expect(p.creditsPerHour).toBeGreaterThan(500);
    expect(p.creditsPerHour).toBeLessThan(3000);
    expect(shortRangeCostPreview(s, WIRING_CAPTAIN_ID, slot)).toEqual(p); // deterministic
    expect(shortRangeCostPreview(s, 999, slot)).toBeNull();
  });

  it("a drop-off's load is what it pays as it leaves", () => {
    const s = slotDrawing(qualified(), "supplyDropOff");
    const p = shortRangeCostPreview(s, WIRING_CAPTAIN_ID, { id: 0, tier: 1 })!;
    const units = shortRangeSlotPreview(s, { id: 0, tier: 1 }).units!;
    expect(p.loadNow).toBe(units * 3);
  });
});

// ===== a run =====

describe("G1-6 a run in progress", () => {
  it("running: the cycle timeline, the phase, the time to the next re-roll", () => {
    const s = dispatched(qualified());
    const v = shortRangeRunView(s, captainOf(s))!;
    const m = captainOf(s).mission!;
    if (m.kind !== "shortRange") throw new Error("not short-range");
    expect(v.slotId).toBe(0);
    expect(v.cycleNumber).toBe(1);
    expect(v.phaseIndex).toBe(0);
    expect(v.phases.map((p) => p.label)).toEqual(["Transiting Out", "On Site", "Transiting Back", "Unloading"]);
    expect(v.phases.map((p) => p.ticks)).toEqual([m.plan.transitOutTicks, m.plan.onSiteTicks, m.plan.transitBackTicks, m.plan.unloadTicks]);
    expect(v.cycleRemainingTicks).toBe(Math.ceil(m.plan.totalTicks));
    expect(v.hold).toBeNull();
    expect(v.recalled).toBe(false);
    expect(shortRangeStatusLine(s, captainOf(s))).toBe("Transiting Out, cycle 1");
    expect(shortRangeRunView(qualified(), captainOf(qualified()))).toBeNull();
  });

  it("waiting at home for a drop-off's load: the calm line on the card, Home and the status line", () => {
    const poor = { ...slotDrawing(qualified(), "supplyDropOff"), credits: new Decimal(10) };
    const s = dispatched(poor);
    const v = shortRangeRunView(s, captainOf(s))!;
    const m = captainOf(s).mission!;
    if (m.kind !== "shortRange") throw new Error("not short-range");
    const load = m.roll.units! * 3;
    expect(v.hold).toBe("credits");
    expect(v.holdText).toContain(`Waiting for the ${load} credit load (the fleet has 10)`);
    expect(v.holdText).toContain("Nothing is lost while it waits.");
    expect(v.holdLine).toBe(`Waiting at home for its ${load} credit load; leaves on its own`);
    expect(shortRangeStatusLine(s, captainOf(s))).toBe(v.holdLine);
    const row = buildHomeDashboard(s).inProgress.find((r) => r.id === `shortRange-${WIRING_CAPTAIN_ID}`)!;
    expect(row.secondaryLabel).toBe(v.holdLine);
    expect(row.remainingTicks).toBeNull(); // waiting is a status, never a countdown
    expect(row.jumpTarget).toBe("shortRange");
    // With the credits there it is an ordinary run again.
    const rich = { ...s, credits: new Decimal(1e6) };
    expect(shortRangeRunView(rich, captainOf(rich))!.hold).toBeNull();
  });

  it("waiting for Warehouse room: a pickup whose Titanium Ore shelf is full", () => {
    const base = slotDrawing(qualified(), "supplyPickup");
    const full = { ...base, inventory: { ...base.inventory, commonOre: [new Decimal("1e300")] } };
    const s = dispatched(full);
    const v = shortRangeRunView(s, captainOf(s))!;
    expect(v.hold).toBe("warehouse");
    expect(v.holdLine).toBe("Waiting at home for Warehouse room for Titanium Ore; leaves on its own");
  });

  it("Home: the in-progress row opens the board; a run's end row wears the hop glyph and opens it too", () => {
    const s = dispatched(qualified());
    const row = buildHomeDashboard(s).inProgress.find((r) => r.id === `shortRange-${WIRING_CAPTAIN_ID}`)!;
    expect(row.jumpTarget).toBe("shortRange");
    expect(row.icon).toBe("shortRange");
    const ended = recallCaptain(s, WIRING_CAPTAIN_ID, 1_000).next; // still at home: the run ends at once
    const done = buildHomeDashboard(ended).recentlyCompleted[0];
    expect(done.icon).toBe("shortRange");
    expect(done.jumpTarget).toBe("shortRange");
  });
});

// ===== the job types list =====

describe("G1-6 the collapsed job types list", () => {
  it("a fresh save: every job's training run is next; the uses list per job", () => {
    const rows = shortRangeTypeRows(wiringBase());
    expect(rows.map((r) => r.template)).toEqual([...SHORT_RANGE_TEMPLATE_KEYS]);
    expect(rows.every((r) => r.training && r.status === "Training run next")).toBe(true);
    expect(rows.find((r) => r.template === "prisonerTransport")!.uses.map((u) => u.label)).toEqual(["Range", "Guest quarters", "Security crew rating"]);
  });

  it("the slow start: run 2 at 35%, run 6 about 54%, full from the end of the curve", () => {
    const at = (dispatched: number, completed: number) => {
      const s = wiringBase();
      const counts = { ...s.runCounts!, shortRange: { refugeeRelocation: { dispatched, completed } } };
      return shortRangeTypeRows({ ...s, runCounts: counts }).find((r) => r.template === "refugeeRelocation")!.status;
    };
    expect(at(1, 0)).toBe("Run 2, size up to 35%");
    expect(at(5, 4)).toBe("Run 6, size up to 54%");
    expect(at(30, 29)).toBe("Full size");
  });
});

// ===== Mission Control =====

describe("G1-6 the Mission Control card names the slot a board rung opens", () => {
  it("a board rung names its slot and tier; any other rung reads null", () => {
    expect(missionControlRungSlotText(MISSION_CONTROL_BOARD_RUNGS[0].effect, shortRangeBoardSlots(wiringBase()).length + 1)).toBe("Opens Short-Range slot 3 (Tier II)");
    expect(missionControlRungSlotText({ unlocksContent: true }, 3)).toBeNull();
    expect(missionControlRungSlotText(undefined, 3)).toBeNull();
  });
});
