// Complement CP-16 (plan docs/plans/2026-10-14-complement-and-acquisition-plan.md CP-16, OC-22; E-CREW Task 29; the CP-16
// notables answer, user 2026-11-06): the final-retirement warning, the missions counter, the notables of a captain's
// command and the Hall of Command entry a retirement appends. Determinism: one economyTick call == 997 s chunks == 1 s
// steps, and offline catch-up == live steps, for the counter and every notable.

import { describe, expect, it } from "vitest";
import Decimal from "break_infinity.js";
import { freshState, xpForNextLevel, type GameState } from "./model";
import { economyTick, tick } from "./tick";
import {
  HALL_OF_COMMAND_SWITCH,
  LEVEL_MILESTONE_EVERY,
  addMissionsFlown,
  captainCommandNotables,
  hallOfCommandOf,
  levelMilestoneTicks,
  notableSecond,
  withCallNotables,
  withCommandFirst,
  withCommandKeysLast,
} from "./captainNotables";
import {
  MAX_CAPTAIN_RETIREMENTS,
  RETIRE_LEVEL_GATE,
  finalRetirementWarningText,
  isFinalRetirement,
  retireBlockReason,
  retireCaptain,
} from "./captainRetirement";
import { claimExpedition } from "./expedition";
import { deserialize, migrate, serialize, SAVE_VERSION } from "./save";
import { refugeesOf } from "./refugees";
import {
  CP16_EXPEDITION_END,
  cp16EvacuationSeconds,
  cp16EvacuationStart,
  cp16Expedition,
  cp16ExpeditionDispatch,
  cp16MissionStart,
  cp16PatrolStart,
  cp16RetireReady,
  cp16ShortRangeStart,
  steppedBy,
} from "./cp16Goldens.fixture";
import { withoutCp16 } from "./cp16Switch.fixture";
import { WIRING_CAPTAIN_ID, editCaptain, seatOfficer } from "./wiring/probes";

const RNG = (): number => 0.5;
const record = (s: GameState) => {
  const c = s.captains.find((x) => x.id === WIRING_CAPTAIN_ID)!;
  return { missionsFlown: c.missionsFlown, notables: c.commandNotables };
};
const json = (v: unknown): string => JSON.stringify(v);

// ===== the pure helpers =====

describe("CP-16 level milestones: the whole tick each crossing lands on", () => {
  // One XP per whole tick from level 9 with 50 XP to go: level 10 at the 50th whole.
  const level9 = (units: number): number => {
    let level = 9;
    let xp = xpForNextLevel(9) - 50 + units;
    while (xp >= xpForNextLevel(level)) xp -= xpForNextLevel(level++);
    return level;
  };

  it("a span of whole ticks: the crossing whole's tick (fractional starts round up to their whole tick)", () => {
    expect(levelMilestoneTicks(9, [{ at: 1, wholes: 100, units: 1, spacing: 1 }], level9)).toEqual([{ level: 10, atTick: 50 }]);
    expect(levelMilestoneTicks(9, [{ at: 0.5, wholes: 100, units: 1, spacing: 1 }], level9)).toEqual([{ level: 10, atTick: 50 }]);
    // Split across spans (two phases of one call): the same tick.
    expect(levelMilestoneTicks(9, [{ at: 1, wholes: 30, units: 1, spacing: 1 }, { at: 31, wholes: 70, units: 1, spacing: 1 }], level9)).toEqual([{ level: 10, atTick: 50 }]);
    // A time skip lands its wholes at once (tick 1 at the call's start).
    expect(levelMilestoneTicks(9, [{ at: 0, wholes: 100, units: 1, spacing: 0 }], level9)).toEqual([{ level: 10, atTick: 1 }]);
  });

  it("no milestone when the award stops short of one, or none is awarded", () => {
    expect(levelMilestoneTicks(9, [{ at: 1, wholes: 49, units: 1, spacing: 1 }], level9)).toEqual([]);
    expect(levelMilestoneTicks(9, [], level9)).toEqual([]);
  });

  it("several milestones in one award, each at its own whole (every LEVEL_MILESTONE_EVERY levels, no cap)", () => {
    // 1 level per unit from level 5: levels 10, 20, 30 at units 5, 15, 25.
    const crossed = levelMilestoneTicks(5, [{ at: 3, wholes: 26, units: 1, spacing: 1 }], (u) => 5 + u);
    expect(crossed).toEqual([
      { level: 10, atTick: 7 },
      { level: 20, atTick: 17 },
      { level: 30, atTick: 27 },
    ]);
    expect(LEVEL_MILESTONE_EVERY).toBe(10);
    expect(levelMilestoneTicks(195, [{ at: 1, wholes: 10, units: 1, spacing: 1 }], (u) => 195 + u)).toEqual([{ level: 200, atTick: 5 }]);
  });

  it("the stamp rule: a call's whole tick, never before tick 1", () => {
    expect(notableSecond(100, 0, 1)).toBe(101);
    expect(notableSecond(100, 0.25, 1)).toBe(101);
    expect(notableSecond(100, 3, 1)).toBe(103);
    expect(notableSecond(100, 3.000000000001, 1)).toBe(103);
    expect(notableSecond(100, 3, 2)).toBe(106);
  });
});

describe("CP-16 the captain record", () => {
  const c0 = freshState().captains[0];

  it("missionsFlown adds up, and nothing is written for none", () => {
    expect(addMissionsFlown(c0, 0)).toBe(c0);
    expect(addMissionsFlown(addMissionsFlown(c0, 2), 3).missionsFlown).toBe(5);
  });

  it("a first is recorded once; a level milestone every time; one call's notables apply in time order", () => {
    const once = withCommandFirst(c0, "firstRelic", 50);
    expect(withCommandFirst(once, "firstRelic", 90)).toBe(once);
    const noted = withCallNotables(c0, [
      { kind: "firstRelic", label: "First relic found", atGameSeconds: 70 },
      { kind: "levelMilestone", label: "Reached level 10", atGameSeconds: 40 },
      { kind: "firstRelic", label: "First relic found", atGameSeconds: 80 },
    ]);
    expect(captainCommandNotables(noted).map((n) => [n.kind, n.atGameSeconds])).toEqual([
      ["levelMilestone", 40],
      ["firstRelic", 70],
    ]);
  });

  it("the record sits last on the captain in a fixed order, however it was written", () => {
    const a = withCommandKeysLast({ ...withCommandFirst(c0, "firstExpedition", 1), cunningCycles: 2, missionsFlown: 3 });
    const keys = Object.keys(a);
    expect(keys.slice(-2)).toEqual(["missionsFlown", "commandNotables"]);
    expect(withCommandKeysLast(a)).toBe(a);
  });

  it("with the switch off nothing is written", () => {
    HALL_OF_COMMAND_SWITCH.live = false;
    try {
      expect(addMissionsFlown(c0, 4)).toBe(c0);
      expect(withCommandFirst(c0, "firstRelic", 1)).toBe(c0);
    } finally {
      HALL_OF_COMMAND_SWITCH.live = true;
    }
  });
});

// ===== the engine =====

describe("CP-16 missions flown and level milestones on the runs (one call == 997 s chunks == 1 s steps)", () => {
  it("a Short Ore Run: six delivered cycles in 1000 s, level 10 at second 50 (the 50th XP)", () => {
    const s0 = cp16MissionStart();
    const steps = steppedBy(s0, 1000, 1);
    expect(record(steps)).toEqual({ missionsFlown: 6, notables: [{ kind: "levelMilestone", label: "Reached level 10", atGameSeconds: s0.gameTimeSeconds + 50 }] });
    expect(Number(steps.lifetimeStats.missionsCompleted.shortOreRun)).toBe(6);
    for (const chunk of [1000, 997, 7]) expect(json(steppedBy(s0, 1000, chunk))).toBe(json(steps));
  });

  it("the stamp is the second the 1 s steps reach the level on", () => {
    const s0 = cp16MissionStart();
    const at49 = steppedBy(s0, 49, 1);
    expect(at49.captains[0].level).toBe(9);
    const at50 = economyTick(at49, 1, RNG);
    expect(at50.captains[0].level).toBe(10);
    expect(captainCommandNotables(at50.captains[0])[0].atGameSeconds).toBe(at50.gameTimeSeconds);
  });

  it("a patrol: the completed route is a mission flown, the won wave's XP reaches level 10 at its second", () => {
    const s0 = cp16PatrolStart();
    let steps = s0;
    let n = 0;
    while (steps.captains[0].mission !== null) {
      steps = economyTick(steps, 1, RNG);
      n += 1;
    }
    const r = record(steps);
    expect(r.missionsFlown).toBe(1);
    expect(r.notables?.map((x) => x.label)).toEqual(["Reached level 10"]);
    const at = r.notables![0].atGameSeconds;
    expect(at).toBeGreaterThan(s0.gameTimeSeconds);
    expect(at).toBeLessThanOrEqual(s0.gameTimeSeconds + n);
    for (const chunk of [n, 997, 3]) expect(json(steppedBy(s0, n, chunk).captains)).toBe(json(steps.captains));
  });

  it("a short-range run: the delivered cycle is a mission flown and its XP reaches level 20", () => {
    const s0 = cp16ShortRangeStart(0);
    const steps = steppedBy(s0, 900, 1);
    const r = record(steps);
    expect(r.missionsFlown).toBe(Number(Object.values(steps.lifetimeStats.missionsCompleted).reduce((a, d) => a.plus(d), new Decimal(0))));
    expect(r.missionsFlown).toBeGreaterThan(0);
    expect(r.notables?.map((x) => x.label)).toEqual(["Reached level 20"]);
    for (const chunk of [900, 997, 13]) expect(json(steppedBy(s0, 900, chunk).captains)).toBe(json(steps.captains));
  });

  it("an Evacuation: the arrival is the captain's first refugee rescued, at the refugee's own arrival second", () => {
    const s0 = cp16EvacuationStart();
    const n = cp16EvacuationSeconds(s0);
    const steps = steppedBy(s0, n, 1);
    const arrived = refugeesOf(steps).list;
    expect(arrived).toHaveLength(1);
    const rescue = (record(steps).notables ?? []).filter((x) => x.kind === "firstRefugeeRescued");
    expect(rescue).toEqual([{ kind: "firstRefugeeRescued", label: "First refugee rescued", atGameSeconds: arrived[0].arrivedAtSeconds }]);
    expect(record(steps).missionsFlown).toBe(1);
    for (const chunk of [n, 997, 11]) expect(json(steppedBy(s0, n, chunk))).toBe(json(steps));
  });

  it("offline catch-up (tick) == live 1 s steps", () => {
    const s0 = cp16MissionStart();
    const live = steppedBy(s0, 1000, 1);
    const offline = tick(1000, s0, RNG);
    expect(record(offline)).toEqual(record(live));
  });

  it("with the slice off no run writes anything", () => {
    const s = withoutCp16(() => steppedBy(cp16MissionStart(), 1000, 1));
    expect(record(s)).toEqual({ missionsFlown: undefined, notables: undefined });
  });
});

describe("CP-16 firsts under command at the dispatch and the claim", () => {
  it("an expedition's dispatch is the captain's first expedition; a Tier II one is also their first Tier II run", () => {
    const one = cp16ExpeditionDispatch("cand-0");
    expect(record(one).notables).toEqual([{ kind: "firstExpedition", label: "First expedition", atGameSeconds: one.gameTimeSeconds }]);
    const two = cp16ExpeditionDispatch("cand-2-0");
    expect(record(two).notables?.map((n) => n.label)).toEqual(["First expedition", "First Tier II run"]);
  });

  it("the claim of a run that brings relics home is the captain's first relic found, at the claim; a second claim adds none", () => {
    const run = cp16Expedition("cand-2-0");
    const relics = (run.claimed.relicVault ?? []).length;
    expect(relics).toBeGreaterThan(0);
    expect(record(run.claimed).notables).toEqual([
      { kind: "firstExpedition", label: "First expedition", atGameSeconds: run.dispatched.gameTimeSeconds },
      { kind: "firstTierTwoRun", label: "First Tier II run", atGameSeconds: run.dispatched.gameTimeSeconds },
      { kind: "firstRelic", label: "First relic found", atGameSeconds: CP16_EXPEDITION_END },
    ]);
    // A refused claim (nothing to claim) changes nothing.
    expect(claimExpedition(run.claimed, "expedition-404").next).toBe(run.claimed);
  });

  it("a Tier I short-range dispatch records no Tier II run", () => {
    expect(record(cp16ShortRangeStart(0)).notables).toBeUndefined();
  });
});

describe("CP-16 the Hall of Command entry a retirement appends", () => {
  it("one entry, exactly once, with the outgoing captain's record; the successor starts fresh", () => {
    const base = cp16RetireReady(1);
    const ready: GameState = {
      ...base,
      captains: base.captains.map((c) => withCommandFirst(addMissionsFlown(c, 42), "firstExpedition", 777)),
    };
    const outgoing = ready.captains[0];
    const next = retireCaptain(ready, WIRING_CAPTAIN_ID);
    expect(hallOfCommandOf(next)).toEqual([
      {
        captainName: outgoing.label,
        levelReached: RETIRE_LEVEL_GATE + 3,
        retirementNumber: 2,
        missionsFlown: 42,
        retiredAtGameSeconds: ready.gameTimeSeconds,
        notables: [{ kind: "firstExpedition", label: "First expedition", atGameSeconds: 777 }],
      },
    ]);
    const successor = next.captains[0];
    expect(successor.missionsFlown).toBeUndefined();
    expect(successor.commandNotables).toBeUndefined();
    expect(successor.label).not.toBe(outgoing.label);
    // A refused retirement (the successor has no XO now) appends nothing.
    expect(retireCaptain(next, WIRING_CAPTAIN_ID)).toBe(next);
    expect(hallOfCommandOf(next)).toHaveLength(1);
  });

  it("entries accumulate in retirement order; a captain with nothing recorded still gets one", () => {
    const first = retireCaptain(cp16RetireReady(0), WIRING_CAPTAIN_ID);
    expect(hallOfCommandOf(first)).toHaveLength(1);
    expect(hallOfCommandOf(first)[0]).toMatchObject({ retirementNumber: 1, missionsFlown: 0, notables: [] });
    const again = retireCaptain(
      { ...cp16RetireReady(1), hallOfCommand: first.hallOfCommand },
      WIRING_CAPTAIN_ID,
    );
    expect(hallOfCommandOf(again).map((e) => e.retirementNumber)).toEqual([1, 2]);
  });

  it("with the slice off a retirement writes no entry", () => {
    expect(withoutCp16(() => retireCaptain(cp16RetireReady(0), WIRING_CAPTAIN_ID)).hallOfCommand).toBeUndefined();
  });
});

describe("CP-16 the final-retirement warning", () => {
  it("shows for the slot's last retirement only, and the engine locks the captaincy in after it", () => {
    for (let r = 0; r < MAX_CAPTAIN_RETIREMENTS; r++) expect(isFinalRetirement({ retirements: r })).toBe(r === MAX_CAPTAIN_RETIREMENTS - 1);
    expect(isFinalRetirement({ retirements: MAX_CAPTAIN_RETIREMENTS })).toBe(false);
    const last = retireCaptain(cp16RetireReady(MAX_CAPTAIN_RETIREMENTS - 1), WIRING_CAPTAIN_ID);
    expect(last.captains[0].retirements).toBe(MAX_CAPTAIN_RETIREMENTS);
    // Climbed back past the gate, with a new XO seated: still refused, for good.
    const climbed = seatOfficer(editCaptain(last, { level: RETIRE_LEVEL_GATE + 10 }), "executive", [], { id: "officer-xo-2" });
    expect(retireBlockReason(climbed, WIRING_CAPTAIN_ID)).toBe("lockedIn");
    expect(hallOfCommandOf(last)[0].retirementNumber).toBe(MAX_CAPTAIN_RETIREMENTS);
    const text = finalRetirementWarningText();
    expect(text).toContain(`${MAX_CAPTAIN_RETIREMENTS} of ${MAX_CAPTAIN_RETIREMENTS}`);
    expect(text).toMatch(/never retire again/);
    expect(text).not.toMatch(/\u2014|-{2}|\bfit/);
  });
});

describe("CP-16 save: optional fields, no bump", () => {
  it("an old save (no record) loads with no Hall entries; a written record survives a round trip", () => {
    expect(SAVE_VERSION).toBe(71);
    const old = deserialize(serialize(freshState(), 0, 0));
    expect(old && migrate(old).hallOfCommand).toBeUndefined();
    const retired = retireCaptain(cp16RetireReady(0), WIRING_CAPTAIN_ID);
    const flown = steppedBy(cp16MissionStart(), 1000, 1);
    for (const s of [retired, flown]) {
      const back = deserialize(serialize(s, 0, 0));
      expect(back).not.toBeNull();
      const loaded = migrate(back!);
      expect(json(loaded.hallOfCommand)).toBe(json(s.hallOfCommand));
      expect(json(loaded.captains.map((c) => [c.missionsFlown, c.commandNotables]))).toBe(json(s.captains.map((c) => [c.missionsFlown, c.commandNotables])));
    }
  });
});
