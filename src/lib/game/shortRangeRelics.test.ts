// G1-5 (Short-Range Missions: relic drops, docs/plans/2026-10-17-short-range-missions-plan.md section 4 G1-5 and the
// USER ANSWERS, call 11 "Rare, per hour (Recommended)": lowest-tier unidentified relics, a chance per HOUR of mission
// time, Tier I 0.08x and Tier II 0.15x the expedition rate). The flag a new dispatch carries; the blanks a delivered
// cycle finds (Tier I, the lowest rarity, no set, source "shortRange"); a run in flight from before G1-5 finds none;
// the training run follows the same rule; the rate per tier over a seed batch; a short cycle repeated fast earns no
// more per hour than a long one; offline == live across many cycles with finds (two captains, the vault's order); the
// completion log entry and the offline recap name the finds; the save round trip; a taken id never repeats.

import { describe, expect, it } from "vitest";
import { cp16OffForThisFile } from "./cp16Switch.fixture";
import { crewModuleSiOffForThisFile } from "./crewModuleSiSwitch.fixture";

// Standard-Issue crew modules (0.14.0, user 2026-11-17 "free basic set, all ships"): this file's pins predate the
// free Sensor Suite, Bridge Module and Crew Quarters every ship now carries (their berths, officer lift, hull bonus
// and equipment ids), so the set is off here and the pins keep proving their own slice. The set itself is pinned in
// crewModuleStandardIssue.test.ts.
crewModuleSiOffForThisFile();
// Complement CP-16 (the Hall of Command) came after every pin here: the file runs with the slice off, so its pins
// keep proving their own slice (cp16Goldens.test.ts pins what CP-16 moved: the missions counter, the notables and
// the Hall of Command entry).
cp16OffForThisFile();
import Decimal from "break_infinity.js";
import { SALVAGE_LOOT_POOLS, type CaptainState, type GameState, type RunCounts, type ShortRangeMissionState } from "./model";
import { dispatchCaptainOnShortRange, isWellFormedShortRangeMission, shortRangeBoardSlots, startShortRangeCycle } from "./shortRangeBoard";
import { shortRangeCycleRelics, shortRangeVaultDeposit } from "./shortRangeCycle";
import { SHORT_RANGE_TEMPLATE_KEYS } from "./shortRange";
import { RELIC_SHORT_RANGE_SALT, newRunRelicBlanksFlag, SHORT_RANGE_RELIC_CEILING, rollShortRangeRelicBlanks, shortRangeRelicMicrosPerHour } from "./relicBlanks";
import { economyTick, recallCaptain, startRelicStudy } from "./tick";
import { resolveCrew } from "./crewOverlay";
import { runCountsOf } from "./runDifficulty";
import { buildHomeDashboard } from "./homeDashboard";
import { shortRangeBoardView } from "../shortRangeBoardDisplay";
import { summarizeOfflineProgress } from "./offlineSummary";
import { deserialize, migrate, serialize } from "./save";
import { WIRING_CAPTAIN_ID, editShip, installPiece, shipOf, wiringBase, withFacilityLevel } from "./wiring/probes";
import { asPreRelicDispatch, withoutShortRangeRelics } from "./shortRangeRelics.fixture";

const RNG = (): number => 0.5;

// A crewed Eir (48 h of hires) with a sensor array and a 30 berth Guest Wing: meets the Tier I and Tier II sheets.
// Mission Control at level 2 (slot 2 is the Tier II slot).
function qualified(): GameState {
  const eir = resolveCrew({ ...editShip(wiringBase(), { typeKey: "eir" }), gameTimeSeconds: 48 * 3600 });
  const sensed = installPiece(eir, { slotType: "sensor", moduleVariant: "sensorBalanced", implicitStats: { sensors: 20 } });
  const s = installPiece(sensed, { slotType: "quarters", moduleVariant: "quartersGuestWing", implicitStats: { colonistCapacity: 30 } });
  return { ...s, credits: new Decimal(1e9), transitBerthCapacity: 8, facilities: { ...s.facilities, missionControl: { ...s.facilities.missionControl, level: 2 } } };
}

// A second captain (id 2) flying a copy of ship-1 (ship-2), so two slots can run at once.
function withSecondCaptain(s: GameState): GameState {
  const c1 = s.captains[0];
  const c2: CaptainState = { ...c1, id: 2, label: "Captain 2", mission: null };
  const ship2 = { ...shipOf(s), id: "ship-2", assignedCaptainId: 2 };
  const gear2 = s.equipment.filter((e) => e.fittedToShipId === "ship-1").map((e) => ({ ...e, id: `${e.id}-2`, fittedToShipId: "ship-2" }));
  return { ...s, captains: [...s.captains, c2], ships: [...s.ships, ship2], equipment: [...s.equipment, ...gear2] };
}

// Every template already flown once (no training run left), so cycles roll ordinary jobs.
function veteran(s: GameState): GameState {
  const counts = runCountsOf(s);
  const shortRange: RunCounts["shortRange"] = {};
  for (const k of SHORT_RANGE_TEMPLATE_KEYS) shortRange[k] = { dispatched: 50, completed: 50 };
  return { ...s, runCounts: { ...counts, shortRange } };
}

function missionOf(s: GameState, captainId = WIRING_CAPTAIN_ID): ShortRangeMissionState {
  const m = s.captains.find((c) => c.id === captainId)?.mission;
  if (!m || m.kind !== "shortRange") throw new Error("not on a short-range run");
  return m;
}

// The mission a dispatch at cycle `idx` of `slotId` would fly (flagged), without dispatching. Pure.
function cycleAt(s: GameState, slotId: number, idx: number, shipId = "ship-1"): ShortRangeMissionState {
  const slot = shortRangeBoardSlots(s)[slotId];
  const ship = s.ships.find((x) => x.id === shipId)!;
  const start = startShortRangeCycle(s, ship, slot, idx, undefined, true);
  return { kind: "shortRange", slotId, roll: start.roll, plan: start.plan, phase: "transitOut", phaseProgressTicks: 0, recalled: false, relicBlanks: { version: 1 } };
}

// The first cycle index from `from` on `slotId` whose delivery finds at least one blank (and passes `ok`).
function dropIndex(s: GameState, slotId: number, ok: (m: ShortRangeMissionState) => boolean = () => true, shipId = "ship-1"): number {
  for (let i = 0; i < 60_000; i++) {
    const m = cycleAt(s, slotId, i, shipId);
    if (shortRangeCycleRelics(m, 1).length > 0 && ok(m)) return i;
  }
  throw new Error("no relic cycle found");
}

// Captain `captainId` dispatched on `slotId` at cycle `idx` (the board cursor set there first).
function dispatchAt(s: GameState, slotId: number, idx: number, opts: { captainId?: number; repeat?: boolean } = {}): GameState {
  const board = { version: 1 as const, nextCycle: { ...(s.shortRangeBoard?.nextCycle ?? {}), [slotId]: idx } };
  const r = dispatchCaptainOnShortRange({ ...s, shortRangeBoard: board }, opts.captainId ?? WIRING_CAPTAIN_ID, slotId, opts.repeat ?? true);
  expect(r.success, String(r.reason)).toBe(true);
  return r.next;
}

function stepped(s: GameState, n: number): GameState {
  let out = s;
  for (let i = 0; i < n; i++) out = economyTick(out, 1, RNG);
  return out;
}

const shortRangeTokens = (s: GameState) => (s.relicVault ?? []).filter((t) => t.source === "shortRange");

// Whole-state equality through the save's JSON with object keys sorted and `discovered` sorted (shortRangeCycle.test).
function canonical(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(canonical);
  if (v !== null && typeof v === "object") return Object.fromEntries(Object.keys(v).sort().map((k) => [k, canonical((v as Record<string, unknown>)[k])]));
  return v;
}
function same(a: GameState, b: GameState): void {
  const ja = canonical(JSON.parse(JSON.stringify({ ...a, discovered: [...a.discovered].sort() }))) as Record<string, unknown>;
  const jb = canonical(JSON.parse(JSON.stringify({ ...b, discovered: [...b.discovered].sort() }))) as Record<string, unknown>;
  for (const k of new Set([...Object.keys(ja), ...Object.keys(jb)])) expect(JSON.stringify(ja[k]), k).toBe(JSON.stringify(jb[k]));
}

// ===== the flag and one delivered cycle =====

describe("G1-5 the relic flag and a delivered cycle's finds", () => {
  it("a new dispatch carries the flag, and every later cycle of the run keeps it", () => {
    let s = dispatchAt(qualified(), 0, 0);
    // MOVED by the relic tier stagger (named): a new run's flag also carries `stagger` (relicStagger.test.ts).
    expect(missionOf(s).relicBlanks).toEqual(newRunRelicBlanksFlag());
    for (let c = 0; c < 3; c++) {
      const before = missionOf(s);
      s = economyTick(s, before.plan.totalTicks, RNG);
      expect(missionOf(s).roll.cycleIndex).toBe(before.roll.cycleIndex + 1);
      expect(missionOf(s).relicBlanks).toEqual(newRunRelicBlanksFlag());
    }
  });

  it("a cycle that finds blanks puts them in the vault: Tier I, the lowest rarity, no set, named by slot and cycle", () => {
    const base = qualified();
    const idx = dropIndex(base, 0);
    const s0 = dispatchAt(base, 0, idx);
    const m0 = missionOf(s0);
    const want = shortRangeCycleRelics(m0, base.tickDurationSeconds);
    expect(want.length).toBeGreaterThan(0);
    // Nothing lands before the home turnaround is done.
    expect(shortRangeTokens(stepped(s0, Math.ceil(m0.plan.totalTicks) - 1))).toEqual([]);
    const s = economyTick(s0, m0.plan.totalTicks, RNG);
    expect(shortRangeTokens(s)).toEqual(want);
    const lowest = SALVAGE_LOOT_POOLS.intactReactorCore[SHORT_RANGE_RELIC_CEILING];
    want.forEach((t, n) => {
      // MOVED by the relic tier stagger (named): a new run's blanks carry the stagger stamp, appended last.
      expect(t).toEqual({ id: `sr-0-${idx}-relic-${n}`, tier: lowest.tier, quality: lowest.quality, regionTier: 1, cultureId: t.cultureId, source: "shortRange", stagger: 1 });
      expect(t.setId).toBeUndefined();
    });
    // The hook, on the cycle's own seed and planned seconds.
    expect(want).toEqual(rollShortRangeRelicBlanks(m0.roll.seed, m0.roll.tier, m0.plan.totalTicks, `sr-0-${idx}`, true));
    expect(missionOf(s).relicsThisRun).toBe(want.length);
  });

  it("the training run follows the same rule (the guaranteed tutorial drops are the tutorial patch's grant seam)", () => {
    const base = qualified();
    const idx = dropIndex(base, 0);
    const m = missionOf(dispatchAt(base, 0, idx));
    // On a fresh save every template is untried: this is the template's training run, and it found its blanks.
    expect(m.roll.difficulty.firstRun).toBe(true);
    expect(shortRangeTokens(economyTick(dispatchAt(base, 0, idx), m.plan.totalTicks, RNG)).length).toBeGreaterThan(0);
    // The roll never reads the training stamp: the same cycle as an ordinary run finds exactly the same.
    const ordinary = { ...m, roll: { ...m.roll, difficulty: { ...m.roll.difficulty, firstRun: false } } };
    expect(shortRangeCycleRelics(ordinary, 1)).toEqual(shortRangeCycleRelics(m, 1));
    // And an ordinary (veteran) cycle that finds one deposits it too.
    const vet = veteran(base);
    const vIdx = dropIndex(vet, 0);
    const vs = dispatchAt(vet, 0, vIdx);
    expect(missionOf(vs).roll.difficulty.firstRun).toBe(false);
    expect(shortRangeTokens(economyTick(vs, missionOf(vs).plan.totalTicks, RNG)).length).toBeGreaterThan(0);
  });

  it("a run dispatched before G1-5 (no flag) finds nothing on the same cycle and plays identically otherwise", () => {
    const base = qualified();
    const idx = dropIndex(base, 0);
    const stamped = dispatchAt(base, 0, idx);
    const inflight = asPreRelicDispatch(stamped);
    const N = missionOf(stamped).plan.totalTicks * 3;
    const a = economyTick(stamped, N, RNG);
    const b = economyTick(inflight, N, RNG);
    expect(shortRangeTokens(a).length).toBeGreaterThan(0);
    expect(shortRangeTokens(b)).toEqual([]);
    expect(missionOf(b).relicBlanks).toBeUndefined();
    expect(missionOf(b).relicsThisRun).toBeUndefined();
    same(withoutShortRangeRelics(a), b);
  });
});

// ===== the rate =====

describe("G1-5 the rate: per hour of mission time, Tier I 0.08x and Tier II 0.15x the expedition rate", () => {
  it("expected finds per hour are the tier's rate exactly; the counts over a seed batch sit within tolerance", () => {
    const s = veteran(qualified());
    for (const [slotId, tier] of [[0, 1], [2, 2]] as const) {
      // 20,000 real rolls of the slot, each flown as a one-hour cycle (the seed is the real cycle's).
      let n = 0;
      const N = 20_000;
      for (let i = 0; i < N; i++) {
        const m = cycleAt(s, slotId, i);
        n += shortRangeCycleRelics({ ...m, plan: { ...m.plan, totalTicks: 3600 } }, 1).length;
      }
      const expected = (N * shortRangeRelicMicrosPerHour(tier)) / 1_000_000;
      expect(expected, `tier ${tier}`).toBeCloseTo(N * 0.5 * (tier === 1 ? 0.08 : 0.15), 6);
      expect(Math.abs(n - expected), `tier ${tier}: ${n} vs ${expected}`).toBeLessThan(4 * Math.sqrt(expected));
    }
  });

  it("over the real cycle lengths, the finds track the planned hours (a seed batch per tier)", () => {
    const s = veteran(qualified());
    for (const [slotId, tier] of [[0, 1], [2, 2]] as const) {
      let n = 0;
      let micros = 0;
      for (let i = 0; i < 40_000; i++) {
        const m = cycleAt(s, slotId, i);
        n += shortRangeCycleRelics(m, 1).length;
        micros += Math.round((shortRangeRelicMicrosPerHour(tier) * Math.floor(m.plan.totalTicks)) / 3600);
      }
      const expected = micros / 1_000_000;
      expect(expected).toBeGreaterThan(10);
      expect(Math.abs(n - expected), `tier ${tier}: ${n} vs ${expected}`).toBeLessThan(4 * Math.sqrt(expected) + 1);
    }
  });

  it("a short cycle repeated fast earns no more per hour than a long one", () => {
    const s = veteran(qualified());
    let short = 0;
    let long = 0;
    const N = 20_000;
    for (let i = 0; i < N; i++) {
      const m = cycleAt(s, 0, i);
      // Six-minute cycles (ten an hour) against one-hour cycles: the same hours of mission time.
      for (let k = 0; k < 10; k++) short += shortRangeCycleRelics({ ...m, roll: { ...m.roll, seed: (m.roll.seed + k * 0x9e3779b1) >>> 0 }, plan: { ...m.plan, totalTicks: 360 } }, 1).length;
      long += shortRangeCycleRelics({ ...m, plan: { ...m.plan, totalTicks: 3600 } }, 1).length;
    }
    const expected = (N * shortRangeRelicMicrosPerHour(1)) / 1_000_000;
    expect(Math.abs(short - expected)).toBeLessThan(4 * Math.sqrt(expected));
    expect(Math.abs(long - expected)).toBeLessThan(4 * Math.sqrt(expected));
  });

  it("the drop draws are keyed off the cycle's own seed on the relic salt (no other stream moves)", () => {
    const m = cycleAt(qualified(), 0, 7);
    const a = shortRangeCycleRelics(m, 1);
    expect(shortRangeCycleRelics(m, 1)).toEqual(a);
    expect(RELIC_SHORT_RANGE_SALT % 2).toBe(1);
    // No flag, no draw.
    expect(shortRangeCycleRelics({ ...m, relicBlanks: undefined }, 1)).toEqual([]);
  });
});

// ===== offline == live =====

describe("G1-5 offline == live with finds: one call == 997 s chunks == 1 s steps", () => {
  it("two captains whose cycles both find blanks, the second delivering first: the whole state (the vault's order) matches", () => {
    // Veteran counters (every template flown, the curve full): a single call longer than a cycle threads the run
    // counters captain by captain, so on a fresh save two captains' training runs could fall in a different order than
    // in 1 s steps (a G1-4 multi-cycle-call class, not a relic one; production steps economyTick(state, 1)).
    const base = veteran(withSecondCaptain(qualified()));
    // Captain 1 on the longest of slot 0's first five finding cycles, so a shorter finding cycle on slot 1 exists.
    const drops: number[] = [];
    for (let from = 0; drops.length < 5; from = drops[drops.length - 1] + 1) drops.push(dropIndex(base, 0, (m) => m.roll.cycleIndex >= from));
    const i0 = drops.reduce((best, i) => (cycleAt(base, 0, i).plan.totalTicks > cycleAt(base, 0, best).plan.totalTicks ? i : best));
    const a = dispatchAt(base, 0, i0, { captainId: 1 });
    const long0 = missionOf(a, 1).plan.totalTicks;
    const i1 = dropIndex(a, 1, (m) => m.plan.totalTicks + 1 < long0, "ship-2");
    const s0 = dispatchAt(a, 1, i1, { captainId: 2 });
    expect(missionOf(s0, 2).plan.totalTicks).toBeLessThan(long0);
    const N = Math.ceil(long0) + 600;
    const once = economyTick(s0, N, RNG);
    let chunks = s0;
    for (let left = N; left > 0; left -= 997) chunks = economyTick(chunks, Math.min(997, left), RNG);
    const steps = stepped(s0, N);
    // Captain 2's find landed first, so the vault reads it first however the span is cut.
    const ids = shortRangeTokens(steps).map((t) => t.id);
    expect(ids[0]).toBe(`sr-1-${i1}-relic-0`);
    expect(ids).toContain(`sr-0-${i0}-relic-0`);
    same(once, steps);
    same(chunks, steps);
  });

  it("across many cycles on Repeat (a Tier II slot), the finds and the whole state match every way the span is cut", () => {
    const base = qualified();
    const idx = dropIndex(base, 2);
    const s0 = dispatchAt(base, 2, idx);
    const N = 6 * 3600;
    const once = economyTick(s0, N, RNG);
    let chunks = s0;
    for (let left = N; left > 0; left -= 997) chunks = economyTick(chunks, Math.min(997, left), RNG);
    let hours = s0;
    for (let h = 0; h < 6; h++) hours = economyTick(hours, 3600, RNG);
    expect(shortRangeTokens(once).length).toBeGreaterThan(0);
    expect(missionOf(once).cyclesThisRun).toBeGreaterThan(20);
    same(once, chunks);
    same(once, hours);
  });
});

// ===== the log, the recap, the save, the vault =====

describe("G1-5 the completion log, the offline recap, the save and the vault", () => {
  it("the run's completion entry names the relics it found; Home reads them in the expedition claim line's words", () => {
    const base = qualified();
    const idx = dropIndex(base, 0);
    const s0 = dispatchAt(base, 0, idx);
    const found = shortRangeCycleRelics(missionOf(s0), 1).length;
    // Recalled once it has left home (a recall at home ends the run at once): it finishes this cycle, then stops.
    const recalled = recallCaptain(economyTick(s0, 1, RNG), WIRING_CAPTAIN_ID, 0).next;
    const done = economyTick(recalled, missionOf(s0).plan.totalTicks - 1, RNG);
    expect(done.captains[0].mission).toBeNull();
    const entry = done.completionLog!.at(-1)!;
    expect(entry).toMatchObject({ kind: "shortRangeRun", iterations: 1, relicsFound: found });
    const row = buildHomeDashboard(done).recentlyCompleted.find((x) => x.id === entry.id);
    expect(row?.secondaryLabel).toBe(`1 mission completed, recalled, ${found} unidentified relic${found === 1 ? "" : "s"} to the vault`);
  });

  it("a recall while the next cycle waits at home still names the earlier cycle's finds; a run with none writes no field", () => {
    const base = qualified();
    const idx = dropIndex(base, 0);
    const s0 = dispatchAt(base, 0, idx);
    const found = shortRangeCycleRelics(missionOf(s0), 1).length;
    const delivered = economyTick(s0, missionOf(s0).plan.totalTicks, RNG);
    expect(missionOf(delivered).relicsThisRun).toBe(found);
    const ended = recallCaptain(delivered, WIRING_CAPTAIN_ID, 0).next;
    expect(ended.captains[0].mission).toBeNull();
    expect(ended.completionLog!.at(-1)).toMatchObject({ kind: "shortRangeRun", iterations: 1, relicsFound: found });
    // An unflagged run: the entry carries no relic field at all.
    const plain = recallCaptain(economyTick(asPreRelicDispatch(s0), missionOf(s0).plan.totalTicks, RNG), WIRING_CAPTAIN_ID, 0).next;
    expect("relicsFound" in plain.completionLog!.at(-1)!).toBe(false);
  });

  it("a live Repeat run's finding cycle writes its own find line at once; Home names the relics and the board card says so", () => {
    const base = qualified();
    const idx = dropIndex(base, 0);
    const s0 = dispatchAt(base, 0, idx);
    const found = shortRangeCycleRelics(missionOf(s0), 1).length;
    const before = s0.completionLog?.length ?? 0;
    const delivered = economyTick(s0, missionOf(s0).plan.totalTicks, RNG);
    // The run goes on (Repeat), and the cycle that found the relics logged them already.
    expect(missionOf(delivered).relicsThisRun).toBe(found);
    expect(delivered.completionLog!.length).toBe(before + 1);
    const entry = delivered.completionLog!.at(-1)!;
    expect(entry).toMatchObject({ kind: "shortRangeRelicFind", iterations: 1, relicsFound: found, subjectKey: "slot-0" });
    const row = buildHomeDashboard(delivered).recentlyCompleted.find((x) => x.id === entry.id);
    const noun = `${found} unidentified relic${found === 1 ? "" : "s"}`;
    expect(row).toMatchObject({ primaryLabel: `Found, ${noun}`, source: "Short-Range Missions", secondaryLabel: "to the vault, on mission 1 of the run", jumpTarget: "relics" });
    const card = shortRangeBoardView(delivered).cards.find((c) => c.slotId === 0);
    expect(card?.kind === "run" ? card.run.relicLine : null).toBe(`Found ${noun} this run, in the vault.`);
    // Before any find the card has no relic line.
    const fresh = shortRangeBoardView(s0).cards.find((c) => c.slotId === 0);
    expect(fresh?.kind === "run" ? fresh.run.relicLine : "absent").toBeNull();
  });

  it("a cycle that ends the run writes no find line (the run's own entry names its finds); an unflagged run writes none", () => {
    const base = qualified();
    const idx = dropIndex(base, 0);
    const s0 = dispatchAt(base, 0, idx);
    const before = s0.completionLog?.length ?? 0;
    const recalled = recallCaptain(economyTick(s0, 1, RNG), WIRING_CAPTAIN_ID, 0).next;
    const done = economyTick(recalled, missionOf(s0).plan.totalTicks - 1, RNG);
    expect(done.completionLog!.slice(before).map((e) => e.kind)).toEqual(["shortRangeRun"]);
    const plain = economyTick(asPreRelicDispatch(s0), missionOf(s0).plan.totalTicks, RNG);
    expect((plain.completionLog ?? []).some((e) => e.kind === "shortRangeRelicFind")).toBe(false);
  });

  it("the offline recap counts the relics that reached the vault while away", () => {
    const base = qualified();
    const idx = dropIndex(base, 0);
    const s0 = dispatchAt(base, 0, idx);
    const after = economyTick(s0, missionOf(s0).plan.totalTicks, RNG);
    const sum = summarizeOfflineProgress(s0, after, missionOf(s0).plan.totalTicks);
    expect(sum.relicsFound).toBe(shortRangeTokens(after).length);
    expect(sum.relicsFound).toBeGreaterThan(0);
    expect(sum.hasContent).toBe(true);
    expect(summarizeOfflineProgress(after, after, 1).relicsFound).toBe(0);
  });

  it("a flagged run with its finds round-trips the save; a bad flag or count is refused at load", () => {
    const base = qualified();
    const idx = dropIndex(base, 0);
    const s = economyTick(dispatchAt(base, 0, idx), missionOf(dispatchAt(base, 0, idx)).plan.totalTicks, RNG);
    const back = migrate(deserialize(serialize(s, 0, 0))!);
    expect(missionOf(back)).toEqual(missionOf(s));
    expect(back.relicVault).toEqual(s.relicVault);
    expect(isWellFormedShortRangeMission(missionOf(s))).toBe(true);
    expect(isWellFormedShortRangeMission({ ...missionOf(s), relicBlanks: { version: 2 } })).toBe(false);
    expect(isWellFormedShortRangeMission({ ...missionOf(s), relicBlanks: null })).toBe(false);
    expect(isWellFormedShortRangeMission({ ...missionOf(s), relicsThisRun: 1.5 })).toBe(false);
    expect(isWellFormedShortRangeMission({ ...missionOf(s), relicsThisRun: -1 })).toBe(false);
  });

  it("a find whose id is taken (a vault token or a study in flight) takes the next free suffix", () => {
    const base = qualified();
    const idx = dropIndex(base, 0);
    const s0 = dispatchAt(base, 0, idx);
    const want = shortRangeCycleRelics(missionOf(s0), 1)[0];
    const clash = { ...want, source: "expedition" as const };
    const studied = startRelicStudy(withFacilityLevel({ ...s0, relicVault: [clash, { ...clash, id: `${want.id}-2` }] }, "research", 1), `${want.id}-2`);
    expect(studied.started).toBe(true);
    const ids = shortRangeVaultDeposit(studied.next, [{ token: want, atTick: 1 }]).map((t) => t.id);
    expect(ids).toEqual([want.id, `${want.id}-3`]);
    // Through the engine: the delivered cycle's blank lands under the free id.
    const s = economyTick(studied.next, missionOf(s0).plan.totalTicks, RNG);
    expect(shortRangeTokens(s)[0].id).toBe(`${want.id}-3`);
  });

  it("a short-range blank studies at the Research Lab like any other (a setless blank: the general pick)", () => {
    const base = qualified();
    const idx = dropIndex(base, 0);
    const s0 = dispatchAt(base, 0, idx);
    const s = withFacilityLevel({ ...economyTick(s0, missionOf(s0).plan.totalTicks, RNG), credits: new Decimal(1e9) }, "research", 1);
    const token = shortRangeTokens(s)[0];
    const r = startRelicStudy(s, token.id);
    expect(r.started).toBe(true);
    expect(shortRangeTokens(r.next).some((t) => t.id === token.id)).toBe(false);
  });
});
