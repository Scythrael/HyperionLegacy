// Gas Giant Study GG-6 (the signed-off v3 mockup section 3, "approve as is" 2026-10-21): the Research Lab's Data study
// tab. The lane line, the countdown, the paused state, the held queue (oldest first), the log lines and the banked
// boosts all read the engine (dataStudy.ts) and the completion log the resolver writes.

import { describe, expect, it } from "vitest";
import Decimal from "break_infinity.js";
import { BLUEPRINTS, RESEARCH_FACILITY_KEY, freshState, type GameState } from "./game/model";
import { economyTick } from "./game/tick";
import { addItemQuality } from "./game/inventory";
import { ANCIENT_DATA_FRAGMENT_ID, RESEARCH_DATA_ITEM, RESEARCH_FAMILIES } from "./game/gasGiantContent";
import { DATA_STUDY_TICKS, researchBoostSpeed, researchFamilyOf, setDataStudyPaused } from "./game/dataStudy";
import { buildHomeDashboard, DATA_STUDY_PAUSED_HOME_LINE } from "./game/homeDashboard";
import { ANCIENT_DECODE_TEXT_LIVE, boostText, dataQueueRows, dataStudyLogLine, dataStudyView, familyLabel, ticksText } from "./dataStudyDisplay";
import { itemCap } from "./game/tick";
import { formatNumber } from "./game/format";

const T0 = 100_000;
const rng = () => 0.5;
const PROP = RESEARCH_DATA_ITEM.propulsion;
const SENS = RESEARCH_DATA_ITEM.sensors;

function lab(level = 1, items: Record<string, number> = {}): GameState {
  const base = freshState();
  let inventory = base.inventory;
  for (const [id, n] of Object.entries(items)) inventory = addItemQuality(inventory, id, new Decimal(n), 0);
  return { ...base, gameTimeSeconds: T0, credits: new Decimal(1e12), inventory, facilities: { ...base.facilities, [RESEARCH_FACILITY_KEY]: { level } } };
}
function step(s: GameState, n: number): GameState {
  let out = s;
  for (let i = 0; i < n; i++) out = economyTick(out, 1, rng);
  return out;
}

describe("GG-6 data study words", () => {
  it("prints the countdown in minutes and seconds", () => {
    expect(ticksText(760)).toBe("12 min 40 s");
    expect(ticksText(DATA_STUDY_TICKS)).toBe("20 min");
    expect(ticksText(45)).toBe("45 s");
  });

  it("names a family off its data item and the boost off the engine's curve", () => {
    expect(familyLabel("hullDesign")).toBe("Hull Design");
    expect(familyLabel("propulsion")).toBe("Propulsion");
    expect(boostText(0)).toBe("none");
    expect(boostText(1)).toBe("+12% speed");
    for (const n of [2, 3, 7]) expect(boostText(n)).toBe(`+${Math.round(researchBoostSpeed(n) * 100)}% speed`);
  });
});

describe("GG-6 the Data study tab", () => {
  it("no lane before the Research Lab: the tab says when it opens and offers no switch", () => {
    const v = dataStudyView(lab(0, { [PROP]: 1 }));
    expect(v.open).toBe(false);
    expect(v.closedText).toMatch(/Research Lab/);
  });

  it("idle with nothing held; the lane line and the Lab level", () => {
    const v = dataStudyView(lab(1));
    expect(v.open).toBe(true);
    expect(v.laneText).toBe("Lane 1 of 1");
    expect(v.labLevelText).toBe("Lab level 1");
    expect(v.current).toBeNull();
    expect(v.idleText).toBe("Idle: no held data");
    expect(v.switchText).toBe("Auto-study on");
    expect(v.queue).toEqual([]);
  });

  it("auto-studies held data: the study under way with its countdown, the rest queued oldest first", () => {
    const s = step(lab(1, { [PROP]: 1, [SENS]: 2 }), 1);
    const v = dataStudyView(s);
    expect(v.current?.itemId).toBe(PROP);
    expect(v.current?.etaText).toMatch(/ left of 20 min$/);
    expect(v.queue.map((r) => [r.itemId, r.count])).toEqual([[SENS, 2]]);
    const later = dataStudyView(step(s, 440));
    // The lane starts the study after the tick's completions (tick.ts processDataStudyLane), so 440 more ticks leave 760.
    expect(later.current?.etaText).toBe(`${ticksText(DATA_STUDY_TICKS - 440)} left of 20 min`);
    expect(later.current?.progressPct).toBeGreaterThan(v.current!.progressPct);
  });

  it("paused: the switch reads Paused, the countdown holds and says so, the note changes", () => {
    const s = setDataStudyPaused(step(lab(1, { [PROP]: 1, [SENS]: 1 }), 5), true);
    const v = dataStudyView(s);
    expect(v.paused).toBe(true);
    expect(v.switchText).toBe("Paused");
    expect(v.current?.etaText.startsWith("Paused, ")).toBe(true);
    const held = dataStudyView(step(s, 300));
    expect(held.current?.etaText).toBe(v.current?.etaText);
    expect(v.note).toMatch(/^Paused: held data waits/);
    // Paused before anything started: the idle line names the wait.
    const idle = dataStudyView(setDataStudyPaused(lab(1, { [PROP]: 1 }), true));
    expect(idle.idleText).toBe("Paused: held data waits");
  });

  it("a finished study banks its family's boost in the table and writes the log line", () => {
    const s = step(lab(1, { [PROP]: 1 }), DATA_STUDY_TICKS + 2);
    const v = dataStudyView(s);
    const row = v.boosts.find((b) => b.family === "propulsion")!;
    expect(row.banked).toBe(1);
    expect(row.nextText).toBe("+12% speed");
    expect(v.boosts.length).toBe(RESEARCH_FAMILIES.length);
    expect(v.log[0]).toMatch(/^Propulsion Data study done: boost banked/);
  });

  it("on, with data held and nothing started yet: the lane says it is starting, not idle", () => {
    const v = dataStudyView(lab(1, { [PROP]: 1 }));
    expect(v.current).toBeNull();
    expect(v.idleText).toBe("Starting the next held data");
  });

  it("shows held data against its per-type cap and warns when a type is full; no decoded count before GG-7", () => {
    const s = lab(1, { [PROP]: 2, [SENS]: 1 });
    const cap = itemCap(s, PROP);
    const v = dataStudyView(s);
    expect(v.capText).toBe(`Held data 3 / ${formatNumber(cap)} of each type`);
    expect(v.fullWarnings).toEqual([]);
    const full = { ...lab(1, { [PROP]: cap.toNumber() }), discovered: [...freshState().discovered, PROP] };
    expect(dataStudyView(full).fullWarnings).toEqual([`Propulsion Data is full (cap ${formatNumber(cap)}): more of it coming home is not kept.`]);
    expect(ANCIENT_DECODE_TEXT_LIVE).toBe(false);
    expect(v.ancientText).toBeNull();
  });

  it("folds consecutive units of one item into a row", () => {
    const s = { ...lab(1, { [PROP]: 2, [SENS]: 1 }), dataStudyHeld: [{ itemId: SENS }, { itemId: PROP }, { itemId: PROP }] };
    expect(dataQueueRows(s).map((r) => [r.itemId, r.count])).toEqual([
      [SENS, 1],
      [PROP, 2],
    ]);
    expect(dataQueueRows(s)[0].glyph).toBe("researchData");
  });
});

describe("GG-6 the log lines", () => {
  it("a learned recipe names its blueprint and family; a fragment its decode; any other study its boost", () => {
    const key = Object.keys(BLUEPRINTS).find((k) => researchFamilyOf(BLUEPRINTS[k]) === "field")!;
    expect(dataStudyLogLine({ kind: "dataStudy", reward: "blueprint", subjectKey: key })).toBe(
      `Field Data study done: boost banked, and a recipe learned (5% chance): ${BLUEPRINTS[key].label}.`,
    );
    expect(dataStudyLogLine({ kind: "dataStudy", reward: "nothing", subjectKey: ANCIENT_DATA_FRAGMENT_ID })).toMatch(/^Ancient Data Fragment studied/);
    expect(dataStudyLogLine({ kind: "dataStudy", reward: "nothing", subjectKey: SENS })).toBe("Sensors Data study done: boost banked.");
    expect(dataStudyLogLine({ kind: "researchProject", reward: "blueprint", subjectKey: key })).toBeNull();
  });
});

describe("GG-6 the Home row while paused", () => {
  it("a paused data study's row says its countdown holds; on, it carries no extra line", () => {
    const s = step(lab(1, { [PROP]: 1 }), 3);
    const rowOf = (st: GameState) => buildHomeDashboard(st).inProgress.find((r) => r.primaryLabel.startsWith("Studying, "));
    const on = rowOf(s);
    expect(on?.secondaryLabel).toBeNull();
    expect(on?.jumpTarget).toBe("dataStudy");
    const off = rowOf(setDataStudyPaused(s, true));
    expect(off?.secondaryLabel).toBe(DATA_STUDY_PAUSED_HOME_LINE);
  });
});
