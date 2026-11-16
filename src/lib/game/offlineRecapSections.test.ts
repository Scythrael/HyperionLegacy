// FR-C R8-6 / R11-4 (QA 2026-11-14): While You Were Away gets sections for what auto-salvage took, the queued orders that
// started and the upgrades that finished. Each is read from the SAME engine run the catch-up already made (the completed-
// events log and the queue, before against after), so the recap narrates offline exactly what live play would have done.
import { describe, it, expect } from "vitest";
import Decimal from "break_infinity.js";
import {
  AUTO_SALVAGE_GRACE_SECONDS_DEFAULT,
  AUTO_SALVAGE_RARITIES_NONE,
  freshState,
  generateStandardIssue,
  type EquipmentInstance,
  type GameState,
} from "./model";
import { economyTick, enqueueOrder, removeQueuedOrder, startFacilityUpgrade, startLine, tick } from "./tick";
import { summarizeOfflineProgress } from "./offlineSummary";

const RNG = () => 0.5;

function spare(id: string): EquipmentInstance {
  const base = generateStandardIssue({ slotType: "cargoBay", fittedToShipId: null, allocateId: () => id });
  return { ...base, fittedToShipId: null, blueprintKey: "prospectorHoldBp", quality: 0, iLevel: 10 };
}

function awayState(): GameState {
  const base = freshState();
  let s: GameState = {
    ...base,
    gameTimeSeconds: 10 * AUTO_SALVAGE_GRACE_SECONDS_DEFAULT,
    facilities: { ...base.facilities, refinery: { level: 1 }, salvageBay: { level: 1 } },
    inventory: { ...base.inventory, commonOre: [new Decimal(5_000)] },
    equipment: [...base.equipment, spare("eq-a"), spare("eq-b")],
    salvageConfirmQualities: [],
    autoSalvage: {
      enabled: true,
      qualities: [0, 1, 2, 3, 4, 5],
      duplicates: false,
      keepPerVariety: 1,
      rarities: { ...AUTO_SALVAGE_RARITIES_NONE },
      graceSeconds: AUTO_SALVAGE_GRACE_SECONDS_DEFAULT,
    },
  };
  // A running refine line holds the one slot, so a queued refine order waits for it.
  s = startLine(s, "refine", "refineCommonOre", { kind: "batch", remaining: 2 }).next;
  const q = enqueueOrder(s, "refinery", { type: "craftLine", kind: "refine", recipeKey: "refineCommonOre", mode: { kind: "batch", remaining: 3 } });
  expect(q.queued).toBe(true);
  s = q.next;
  // A facility upgrade in progress (the Fuel Depot's first rung, Titanium Ore only).
  const up = startFacilityUpgrade(s, "fuelStorage");
  expect(up.started).toBe(true);
  return up.next;
}

describe("the recap's auto-salvage, started-order and finished-upgrade sections", () => {
  it("names what auto-salvage took, the queued order that started and the upgrade that finished", () => {
    const before = awayState();
    const after = tick(3600 * before.tickDurationSeconds, before, RNG);
    const sum = summarizeOfflineProgress(before, after, 3600);
    expect(sum.autoSalvaged.length).toBeGreaterThan(0);
    expect(sum.autoSalvaged.reduce((n, r) => n + r.count, 0)).toBeGreaterThan(0);
    expect(sum.ordersStarted.map((o) => o.facility)).toContain("refinery");
    expect(sum.upgradesFinished.some((u) => u.label.includes("Fuel Depot"))).toBe(true);
    expect(sum.hasContent).toBe(true);
  });

  it("offline equals live: the same sections from one tick() call and from 1 s steps", () => {
    const before = awayState();
    const offline = tick(1800 * before.tickDurationSeconds, before, RNG);
    let live = before;
    for (let i = 0; i < 1800; i++) live = economyTick(live, 1, RNG);
    const a = summarizeOfflineProgress(before, offline, 1800);
    const b = summarizeOfflineProgress(before, live, 1800);
    expect(a.autoSalvaged).toEqual(b.autoSalvaged);
    expect(a.ordersStarted).toEqual(b.ordersStarted);
    expect(a.upgradesFinished).toEqual(b.upgradesFinished);
  });

  it("an absence where none of it happened shows none of the three", () => {
    const s = freshState();
    const sum = summarizeOfflineProgress(s, s, 60);
    expect(sum.autoSalvaged).toEqual([]);
    expect(sum.ordersStarted).toEqual([]);
    expect(sum.upgradesFinished).toEqual([]);
  });
});

// FR-C fix pass: the recap counts from cumulative tallies, not the 50-entry completed-events log, so a long absence with
// the Auto-Salvage Terminal busy neither undercounts what it took nor drops an upgrade that finished early.
describe("the recap stays exact past the completed-events log's 50 entries", () => {
  function longAwayState(spares: number): GameState {
    const s = awayState();
    const extra = Array.from({ length: spares }, (_, i) => spare(`eq-long-${i}`));
    return { ...s, equipment: [...s.equipment, ...extra] };
  }

  it("counts every auto-salvage and keeps the upgrade that finished first", () => {
    const before = longAwayState(80);
    const after = tick(4 * 86_400, before, RNG);
    const sum = summarizeOfflineProgress(before, after, 4 * 86_400);
    // The engine ran more than the log can hold, so the old reading (the log) could not have counted them all.
    const logged = after.nextCompletionLogId - before.nextCompletionLogId;
    expect(logged).toBeGreaterThan(50);
    const consumed = before.equipment.length - after.equipment.length;
    expect(consumed).toBeGreaterThan(50);
    expect(sum.autoSalvaged.reduce((n, r) => n + r.count, 0)).toBe(consumed);
    // The Fuel Depot rung finished in the first minutes, long since evicted from the log.
    expect(after.completionLog.some((e) => e.kind === "facilityUpgrade")).toBe(false);
    expect(sum.upgradesFinished.map((u) => u.label)).toEqual(["Upgraded, Fuel Depot, Level 1"]);
  });

  it("offline equals live past the cap too", () => {
    const before = longAwayState(60);
    const span = 6 * 3600;
    const offline = tick(span, before, RNG);
    let chunked = before;
    for (let t = 0; t < span; t += 997) chunked = tick(Math.min(997, span - t), chunked, RNG);
    const a = summarizeOfflineProgress(before, offline, span);
    const b = summarizeOfflineProgress(before, chunked, span);
    expect(a.autoSalvaged).toEqual(b.autoSalvaged);
    expect(a.upgradesFinished).toEqual(b.upgradesFinished);
    expect(a.ordersStarted).toEqual(b.ordersStarted);
    expect(offline.recapTally).toEqual(chunked.recapTally);
  });
});

// FR-C fix pass: "Queued orders started" lists only orders the ENGINE started, never one the player removed (a recap
// still open spans the live play between two absences, awayRecapSpan).
describe("queued orders started counts engine starts only", () => {
  it("an order the player removed between absences is not listed as started", () => {
    const before = awayState();
    const id = before.processQueue[0].id;
    const removed = removeQueuedOrder(before, id);
    const after = tick(3600 * before.tickDurationSeconds, removed, RNG);
    const sum = summarizeOfflineProgress(before, after, 3600);
    expect(sum.ordersStarted.map((o) => o.id)).not.toContain(id);
  });

  it("an order the engine promoted is listed", () => {
    const before = awayState();
    const id = before.processQueue[0].id;
    const after = tick(3600 * before.tickDurationSeconds, before, RNG);
    expect(summarizeOfflineProgress(before, after, 3600).ordersStarted.map((o) => o.id)).toEqual([id]);
  });
});
