// WR-2 (0.14.0): the simulated player's GATED sweep. Runs only under `npm run test:sim` (vitest in mode "sim") or
// with SIM_FULL set, like the SF-0 measurement gate. SIM_SEEDS ("0,1,2") widens the ablation's seed batch (default
// seed 0; each seed is about two minutes). Prints the reports; asserts their shape and the characterizations.
//
//   1. The full choice ablation: every player choice in the wiring registry, allAuto with and without it.
//   2. The first-run batch: allAuto and newcomer over six seeds (the three fresh-save candidates twice), the Safe
//      First Runs assertions: since SF-2 allAuto's first expedition (an Orion's: the training run) is safe on every
//      seed; the newcomer's (a General Freighter's) is an ordinary run.
//   3. offline == live at full length: one tick() call, 997 s chunks and 1 s ticks per look, both policies.

import { describe, expect, it } from "vitest";
import { ADVANCE_MODES, simulate, type SimReport } from "./simPlayer";
import { ALL_AUTO, NEWCOMER, SIM_POLICIES } from "./policies";
import { ablateChoices, simChoiceEntries, ablationSummary } from "./ablation";

const SIM_FULL: boolean = Boolean(import.meta.env.SIM_FULL) || import.meta.env.MODE === "sim";
const SEEDS: number[] = String(import.meta.env.SIM_SEEDS ?? "0")
  .split(",")
  .map((x) => Number(x.trim()))
  .filter((x) => Number.isInteger(x));
const FIRST_RUN_SEEDS = [0, 1, 2, 3, 4, 5];

describe.runIf(SIM_FULL)("WR-2 gated: the full choice ablation", () => {
  it("every player choice in the registry gets one verdict", () => {
    const t0 = performance.now();
    const choices = simChoiceEntries();
    const r = ablateChoices(choices, { policy: ALL_AUTO, seeds: SEEDS });
    const ms = Math.round(performance.now() - t0);
    console.log([...ablationSummary(r), `runtime ${ms} ms`].join("\n"));
    expect(r.verdicts.map((v) => v.id)).toEqual(choices.map((e) => e.id));
    expect(Object.values(r.counts).reduce((a, b) => a + b, 0)).toBe(choices.length);
    const by = new Map(r.verdicts.map((v) => [v.id, v]));
    expect(by.get("captain:CAPTAIN_TALENTS:prospectorHub")?.verdict).toBe("moves");
    expect(by.get("fleetAdmiral:HOMEWORLD_TALENTS:homelandDefenseHub")?.verdict).toBe("dead");
  }, 3_600_000);
});

// SF-2: the training run flies the regular transit (the shakedown is retired), so the horizon covers its return.
const FIRST_RUN_HORIZON = 90_000;

describe.runIf(SIM_FULL)("WR-2 gated: the first-run batch (Safe First Runs)", () => {
  for (const policy of SIM_POLICIES) {
    it(`${policy.name}: the first expedition on every seed, and gathering is never lost`, () => {
      const reports: SimReport[] = FIRST_RUN_SEEDS.map((seed) => simulate(policy, { seed, horizonSeconds: FIRST_RUN_HORIZON }));
      console.log(
        reports
          .map((r) => `${policy.name} seed ${r.seed}: ${r.firstExpedition.verdict} (${r.firstExpedition.reasons.join("; ") || "safe"}); patrol ${r.patrol?.won ? "won" : `lost (${r.patrol?.endReason})`}`)
          .join("\n"),
      );
      for (const r of reports) {
        expect(r.gather?.defeat).toBe(false);
        // CURRENT BEHAVIOR for the newcomer (a General Freighter), flipped by G2: only explorers will reach
        // expedition systems, so its launch becomes a refusal and its run is "not the training run" (the training
        // run is the first expedition FROM AN EXPLORER, SF-2).
        expect(r.expeditions.length).toBeGreaterThan(0);
      }
      // SF-2: the explorer's first expedition is the training run, safe on every seed (before SF-2: none was). The
      // newcomer's freighter flies an ordinary run (not an explorer), so nothing is claimed for it here.
      if (policy === ALL_AUTO) expect(reports.map((r) => r.firstExpedition)).toEqual(reports.map(() => ({ verdict: "safe", safe: true, reasons: [] })));
    }, 600_000);
  }
});

describe.runIf(SIM_FULL)("WR-2 gated: offline == live over the whole run", () => {
  for (const policy of [ALL_AUTO, NEWCOMER]) {
    it(`${policy.name}: one call, 997 s chunks and 1 s ticks per look agree`, () => {
      const opts = { seed: 2, decisionSeconds: 1994 } as const;
      const [one, ...rest] = ADVANCE_MODES.map((advance) => simulate(policy, { ...opts, advance }));
      for (const r of rest) expect({ ...r, advance: one.advance }).toEqual(one);
    }, 600_000);
  }
});
