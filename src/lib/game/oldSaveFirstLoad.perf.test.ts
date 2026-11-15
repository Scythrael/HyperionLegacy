// oldSaveFirstLoad.perf.test.ts (staging freeze, 2026-11-14): the first load of an OLD save on 0.14.0.
//
// Excluded from the default suite (vite.config.ts) and run alone, serially, by `npm run test:perf`, like
// crewPool.perf.test.ts. The case: a production 0.13.x save (v54, before the crew layer) whose game clock has run for a
// year, with a big fleet. The v54 -> v55 step left no transport window on record, so the first 0.14.0 tick used to owe a
// transport for every half hour since the save began: 17,520 windows, 210,000 crew, minutes of work on a phone. The fix
// (user 2026-11-13, "A welcome batch to fill the fleet (Recommended)") delivers only enough transports to fill every open
// berth once, then runs normally from the update on.
import { describe, expect, it } from "vitest";
import { report } from "../secret/testReport";
import { freshState, type GameState, type ShipTypeKey } from "./model";
import { migrate, serialize, type SaveFile } from "./save";
import { tick } from "./tick";
import { totalCrew } from "./crew";
import { homeworldReserveCount } from "./homeworldReserve";
import { complementTotalCap } from "./commandStructure";
import { quartersCapacityBonus } from "./crewModules";

const DAY = 86400;
const AGE_DAYS = 365;
// The budget for the whole first load (migrate, then the first hour of 1 s ticks) on a desktop runner.
const FIRST_LOAD_BUDGET_MS = 2000;

const TYPES: readonly ShipTypeKey[] = [
  "generalFreighter", "prospectorHauler", "prospectorRunner", "prospectorMiner", "destroyer", "battleship",
  "carrier", "orion", "aurora", "eir",
];

function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

// The spares a long-played save keeps in storage (every one is scanned by a per-ship equipment read).
const SPARES = 400;

// A genuine v54 shape: a year of game time, 25 ships each with the starter kit installed, 400 spares in storage, and
// none of the crew layer's fields.
export function oldProductionSave(): SaveFile {
  const base = freshState() as GameState;
  const extra = Array.from({ length: 24 }, (_, i) => ({ id: `ship-${i + 2}`, typeKey: TYPES[i % TYPES.length], assignedCaptainId: null }));
  const ships = [...base.ships, ...extra];
  let nextId = 100000;
  const kit = base.equipment.filter((e) => e.fittedToShipId === "ship-1");
  const equipment = [
    ...base.equipment,
    ...extra.flatMap((s) => kit.map((e) => ({ ...e, id: `equip-${nextId++}`, fittedToShipId: s.id }))),
    ...Array.from({ length: SPARES }, (_, i) => ({ ...kit[i % kit.length], id: `equip-${nextId++}`, fittedToShipId: null })),
  ];
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { officers, nextOfficerId, crewPool, notableCrew, nextNotableId, lastTransportWindow, ...pre } = { ...base, equipment } as any;
  return {
    version: 54,
    created_at: 0,
    last_saved_at: 0,
    game_time_seconds: AGE_DAYS * DAY + 7,
    state: {
      ...pre,
      ships: ships.map(({ complement, ...rest }: any) => rest),
      nextShipId: ships.length + 1,
      gameTimeSeconds: AGE_DAYS * DAY + 7,
    } as any,
  };
}

function fleetCrew(s: GameState): number {
  return totalCrew(s.crewPool) + homeworldReserveCount(s) + s.ships.reduce((a, sh) => a + totalCrew(sh.complement?.buckets ?? []), 0);
}

function openBerths(s: GameState): number {
  return s.ships.reduce((a, sh) => a + complementTotalCap(sh.typeKey, quartersCapacityBonus(s, sh)), 0);
}

describe("an old production save loads fast on 0.14.0", () => {
  it(`a ${AGE_DAYS}-day-old v54 save with 25 ships: first load under ${FIRST_LOAD_BUDGET_MS} ms, crew fill the fleet once`, () => {
    const raw = JSON.stringify(oldProductionSave());
    const t0 = performance.now();
    const migrated = migrate(JSON.parse(raw) as SaveFile);
    const tMigrate = performance.now() - t0;
    const loaded = tick(3600, migrated, lcg(0x14));
    const ms = performance.now() - t0;
    const t1 = performance.now();
    const saved = serialize(loaded, 0);
    const tSave = performance.now() - t1;
    const crew = fleetCrew(loaded);
    const berths = openBerths(migrated);
    report(
      `[perf] ${AGE_DAYS}-day v54 save, ${loaded.ships.length} ships: migrate ${tMigrate.toFixed(0)} ms, first load (migrate + 1 h) ${ms.toFixed(0)} ms, ` +
        `${crew} crew for ${berths} berths, save ${tSave.toFixed(0)} ms ${saved.length} chars`,
    );
    expect(ms).toBeLessThan(FIRST_LOAD_BUDGET_MS);
    // "Fill the fleet once", not a flood: every berth's worth, rounded up to whole transports (under one more), plus the
    // hour's own two transports.
    expect(crew).toBeGreaterThanOrEqual(berths);
    expect(crew).toBeLessThan(berths + 12 + 2 * 12);
  }, 600000);

  // The reload catch-up of a whole offline cap (4 days of 1 s steps) on that full fleet with its spares. Measured
  // 2026-11-14 on the dev box: 85 us a step (29.4 s) before the perf pass (the crew fill scanned every spare once per
  // ship per step and re-summed every ship's groups), 17 us (6.0 s) after.
  it("then a four-day offline catch-up on that fleet stays under 50 us a step", () => {
    const loaded = tick(3600, migrate(oldProductionSave()), lcg(0x14));
    const t0 = performance.now();
    const out = tick(4 * DAY, loaded, lcg(0x15));
    const ms = performance.now() - t0;
    const perStepUs = (ms / (4 * DAY)) * 1000;
    report(`[perf] then 4 days offline: ${ms.toFixed(0)} ms, ${perStepUs.toFixed(1)} us per step, ${fleetCrew(out)} crew`);
    // The span's own transports only (192 windows), on top of the welcome fill.
    expect(fleetCrew(out)).toBe(fleetCrew(loaded) + 12 * 192);
    expect(perStepUs).toBeLessThan(50);
  }, 900000);
});
