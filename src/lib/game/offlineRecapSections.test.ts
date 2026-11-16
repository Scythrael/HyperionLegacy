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
import { economyTick, enqueueOrder, startFacilityUpgrade, startLine, tick } from "./tick";
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
