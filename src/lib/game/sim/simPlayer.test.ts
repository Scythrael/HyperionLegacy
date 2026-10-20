// WR-2 (0.14.0): the simulated player's default tests (fast; the full ablation sweep and the first-run seed batch
// run under `npm run test:sim`, simPlayer.sweep.test.ts).
//
// What is proven here:
//   1. the driver is deterministic (same policy, same seed, same report);
//   2. offline == live: advancing each look's span in one tick() call, in 997 s chunks, or one second at a time
//      gives the same report;
//   3. a known-live choice moves its outcome (a Prospector talent: the gathered Titanium Ore);
//   4. an inert choice is flagged dead (a synthetic one: no selectable choice is inert since 0.14.0);
//   5. the newcomer baseline's first expedition, characterized as it is TODAY: not safe, with exactly why (Safe
//      First Runs SF-2 flips it; that slice updates these pins and says so);
//   6. the newcomer archetype plays the real new game (General Freighter, board hires, the Quartermaster kit,
//      cheapest talents and rungs), and gathering is never lost.

import { describe, expect, it } from "vitest";
import { wiringEntry } from "../wiring/registry";
import { ADVANCE_MODES, simStartState, simulate, type SimReport } from "./simPlayer";
import { ALL_AUTO, NEWCOMER, SIM_HOUR, scripted } from "./policies";
import { ablateChoices } from "./ablation";
import { onHull } from "../firstRunsGoldens.fixture";

const withoutMode = (r: SimReport): Omit<SimReport, "advance"> => {
  const { advance: _mode, ...rest } = r;
  return rest;
};

describe("WR-2 simulated player: determinism and offline == live", () => {
  // SF-2: the training run flies the regular transit now (no 30 minute shakedown), so the run is longer to simulate.
  // Expedition Tiers G2-3: a Tier I voyage is about 2 hours each way (not 6), so inside the horizon the first run
  // comes home, is claimed, and a second one launches.
  it("the same policy and seed give the same report (allAuto, seed 0)", { timeout: 60_000 }, () => {
    const a = simulate(ALL_AUTO, { seed: 0 });
    const b = simulate(ALL_AUTO, { seed: 0 });
    expect(b).toEqual(a);
    expect(a.actions.map((x) => x.action)).toEqual(["fieldWeakestCrew", "dispatch:shortOreRun", "recall", "patrol:crimsonReaverSweep", "launchExpedition", "claim", "launchExpedition"]);
  });

  it("one tick() call, 997 s chunks and 1 s ticks per look give the same report", () => {
    // Looks 1,994 s apart (two whole 997 s chunks), two simulated hours: the gathering run, the patrol and the
    // start of the expedition all fall inside the window.
    const opts = { seed: 1, horizonSeconds: 2 * SIM_HOUR, decisionSeconds: 1994 } as const;
    const [one, ...rest] = ADVANCE_MODES.map((advance) => simulate(ALL_AUTO, { ...opts, advance }));
    expect(one.expeditions.length).toBe(1);
    for (const r of rest) expect(withoutMode(r)).toEqual(withoutMode(one));
  });
});

describe("WR-2 choice ablation: a live choice moves, an inert one is dead", () => {
  it("captain talent Prospector Hub (+common yield) moves the gathered Titanium Ore", () => {
    const e = wiringEntry("captain:CAPTAIN_TALENTS:prospectorHub")!;
    expect(e.status.kind).toBe("live");
    const r = ablateChoices([e], { seeds: [0], horizonSeconds: 1800 });
    expect(r.verdicts[0].verdict).toBe("moves");
    expect(r.verdicts[0].moved).toContain("gathered:commonOre");
    expect(r.verdicts[0].surprise).toBe(false);
  });

  // WR-6 wired the Homeworld placeholder hubs, E-MOD EM-1 the Martian racial, and the inert-racials slice (0.14.0, user
  // "everything wired") the last four races, so no selectable choice is inert any more. The dead-choice detection is
  // proven on a SYNTHETIC choice instead: the Belter racial's entry with its transform swapped for a purely cosmetic
  // edit (renaming the ship, which no engine reader reads), still marked pending so a dead verdict is no surprise.
  it("a synthetic inert choice (a cosmetic ship rename) moves nothing and is flagged dead", () => {
    const belter = wiringEntry("racial:belter")!;
    expect(belter.status.kind).toBe("live");
    const rename = (s: Parameters<typeof belter.on>[0]) => ({ ...s, ships: s.ships.map((sh) => (sh.id === "ship-1" ? { ...sh, name: "Synthetic Inert" } : sh)) });
    const e = { ...belter, id: "synthetic:inertRename", status: { kind: "pending" as const, owner: "synthetic fixture" }, on: rename };
    const r = ablateChoices([e], { seeds: [0], horizonSeconds: 1800 });
    expect(r.verdicts[0].verdict).toBe("dead");
    expect(r.verdicts[0].moved).toEqual([]);
    expect(r.verdicts[0].surprise).toBe(false);
  });

  it("WR-6: the former placeholder hub Home Guard moves the patrol (its shield pool)", () => {
    const e = wiringEntry("fleetAdmiral:HOMEWORLD_TALENTS:homelandDefenseHub")!;
    expect(e.status.kind).toBe("live");
    const r = ablateChoices([e], { seeds: [0], horizonSeconds: 1800 });
    expect(r.verdicts[0].verdict).toBe("moves");
    expect(r.verdicts[0].moved).toContain("patrol:shieldLeft");
  });

  it("scripted([choice]) applies the choice to the start and nothing else", () => {
    const e = wiringEntry("captain:CAPTAIN_TALENTS:prospectorHub")!;
    const base = simStartState(ALL_AUTO).state;
    const withIt = simStartState(scripted([{ id: e.id, apply: e.on }])).state;
    expect(withIt).toEqual(e.on(base));
  });
});

describe("WR-2 safe first runs: the allAuto newcomer baseline (SF-2 flipped the expedition; SF-4 flips the patrol)", () => {
  it("the sim's Orion is a legal hull: exactly the SF-0 onHull loadout (its own one-hardpoint baselines)", () => {
    const s = simStartState(ALL_AUTO).state;
    const fitted = (x: typeof s) => x.equipment.filter((e) => e.fittedToShipId === "ship-1");
    expect(fitted(s)).toEqual(fitted(onHull("orion")));
    expect(fitted(s).filter((e) => e.slotType === "weapon").length).toBe(1);
  });

  // SF-2: the first explorer expedition is the TRAINING RUN (the regular transit, so the horizon covers its return):
  // the weakest launchable crew finishes it 100% with no lost fight and no setback.
  it("seed 0: the gathering run delivers, the first Sweep is won, the first expedition (the training run) is safe", { timeout: 60_000 }, () => {
    const r = simulate(ALL_AUTO, { seed: 0, horizonSeconds: 60_000 });
    expect(r.gather).toEqual({ mission: "shortOreRun", refusal: null, deliveries: 7, firstDeliverySeconds: 180, defeat: false });
    // WR-4 (B14): the player side acts first now, so the Sweep ends with more shield left (279, was 236).
    expect(r.patrol).toEqual({ patrol: "crimsonReaverSweep", refusal: null, won: true, endReason: "ordersComplete", repairSeconds: null, wavesWon: 2, wavesLost: 0, hullLeft: 340, shieldLeft: 279 });
    const first = r.expeditions[0];
    expect(first.shakedown).toBe(false);
    expect(first.candidate).toBe(0);
    // Before SF-2 (characterization): "stalled: 0/11 objectives done, stuck on derelictOutpost", "3 lost fights".
    // Safe First Runs OC-1 / OC-2: the weakest launchable crew finishes 100% with no setbacks.
    expect(r.firstExpedition).toEqual({ verdict: "safe", safe: true, reasons: [] });
    expect(first).toMatchObject({ end: "complete", claimed: true, objectivesDone: 11, objectivesTotal: 11, lostFights: 0, hullDamage: 0, setbacks: 0, boardingLoss: 0 });
  });
});

describe("WR-2 newcomer archetype: the real new game", () => {
  it("hires from the board, draws the Quartermaster kit, spends cheapest first, and never loses a gathering run", () => {
    const r = simulate(NEWCOMER, { seed: 0, horizonSeconds: 3 * SIM_HOUR });
    const ok = (name: string): boolean => r.actions.some((a) => a.action === name && a.ok);
    expect(ok("hire:security") && ok("hire:science") && ok("quartermasterKit")).toBe(true);
    expect(r.actions.some((a) => a.action.startsWith("buy:captain:"))).toBe(true);
    expect(r.actions.some((a) => a.action.startsWith("facility:"))).toBe(true);
    expect(r.gather?.refusal).toBeNull();
    expect(r.gather?.defeat).toBe(false);
    expect(r.gather?.deliveries).toBeGreaterThan(0);
    expect(r.patrol?.refusal).toBeNull();
    // CURRENT BEHAVIOR, flipped by G2: the freighter launches an expedition today. User rules since WR-2: the
    // training run is the first expedition FROM AN EXPLORER, and only explorers reach expedition systems (G2's reach
    // gate), so this launch is "not the training run" and G2 makes it a refusal. SF-2 retired the account's 30 minute
    // shakedown, so this first launch is an ordinary run.
    expect(r.expeditions.length).toBe(1);
    expect(r.expeditions[0].shakedown).toBe(false);
  });
});
