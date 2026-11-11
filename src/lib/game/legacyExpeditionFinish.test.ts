// Wiring OC-G1 (user 2026-10-16 "Delete it (Recommended)": remove the pre-Ground-Ops path and its legacy-only effects;
// "a dev save with an old in-flight run gets that run finished at load"). The legacy resolver is gone, so a LEGACY run
// (one without its `groundOps` record: dispatched before GO-7b, only in a dev save) must never brick a save:
//   - at load (save.ts finishLegacyExpeditionsOnLoad, every load, idempotent) a legacy run still out is set "complete"
//     with the findings it already holds, nothing more rolled; a Ground Ops run and a complete run are untouched;
//   - the engine's own guard (expedition.ts advanceExpedition / finishLegacyExpedition) applies the same rule;
//   - the claim then works as usual: the findings deposit, the run leaves, its team comes home ready (no bay, no flat
//     injury: that went with the legacy claim).

import { describe, expect, it } from "vitest";
import { freshState, type Expedition, type GameState } from "./model";
import { advanceExpedition, claimExpedition, expeditionCandidates, finishLegacyExpedition } from "./expedition";
import { deserialize, finishLegacyExpeditionsOnLoad, migrate, serialize } from "./save";
import { dispatchPastPropulsion, plainAwayMember, withSlottedAwayTeams, withoutGroundOps } from "./awayTeamTestFixtures";

const T0 = 50_000;

// A real dispatch (Ground Ops), and the same run as the legacy record a pre-GO-7b build would have stored: no groundOps,
// mid-scan, holding one supply-cache finding and one charted anomaly finding.
function dispatched(): { state: GameState; exp: Expedition } {
  const s = withSlottedAwayTeams({
    ...freshState(),
    gameTimeSeconds: T0,
    awayMembers: [plainAwayMember("member-1", "security", "ship-1"), plainAwayMember("member-11", "science", "ship-1")],
    nextAwayMemberId: 100,
  });
  const res = dispatchPastPropulsion(s, "ship-1", 1, expeditionCandidates(s, "ship-1")[0].id);
  if (!res.success || !res.expedition) throw new Error(`dispatch refused: ${res.reason}`);
  return { state: res.next, exp: res.expedition };
}

function legacyMidRun(exp: Expedition): Expedition {
  return {
    ...withoutGroundOps(exp),
    phase: "scanning",
    phaseAnchorSeconds: T0 + 3600,
    findings: [
      { id: `${exp.id}-find-anomaly`, source: "anomaly" },
      { id: `${exp.id}-find-cache-b0-s1`, source: "supplyCache", materials: { scrapAlloy: 2 }, credits: 30, relic: null },
    ],
  };
}

describe("OC-G1: finishLegacyExpeditionsOnLoad (every load)", () => {
  it("finishes a legacy run still out, keeps its findings, and touches nothing else", () => {
    const { exp } = dispatched();
    const legacy = legacyMidRun(exp);
    const legacyDone = { ...legacy, id: "expedition-9", phase: "complete" as const };
    const state = { expeditions: [legacy, exp, legacyDone, null, 7] };
    const out = finishLegacyExpeditionsOnLoad(state);
    expect(out).not.toBe(state);
    expect(out.expeditions[0]).toEqual({ ...legacy, phase: "complete" });
    expect(out.expeditions[0].findings).toEqual(legacy.findings);
    // A Ground Ops run, a legacy run already complete and junk entries keep their references.
    expect(out.expeditions[1]).toBe(exp);
    expect(out.expeditions[2]).toBe(legacyDone);
    expect(out.expeditions[3]).toBe(null);
    expect(out.expeditions[4]).toBe(7);
    // The input is never mutated.
    expect(state.expeditions[0]).toBe(legacy);
    expect(legacy.phase).toBe("scanning");
  });

  it("is idempotent and returns the SAME state when nothing is left to finish", () => {
    const { exp } = dispatched();
    const once = finishLegacyExpeditionsOnLoad({ expeditions: [legacyMidRun(exp)] });
    expect(finishLegacyExpeditionsOnLoad(once)).toBe(once);
    const clean = { expeditions: [exp] };
    expect(finishLegacyExpeditionsOnLoad(clean)).toBe(clean);
    const none = { expeditions: [] };
    expect(finishLegacyExpeditionsOnLoad(none)).toBe(none);
    // Hardened: a missing or non-array expeditions field passes through.
    const odd = { expeditions: "nope" };
    expect(finishLegacyExpeditionsOnLoad(odd)).toBe(odd);
    expect(finishLegacyExpeditionsOnLoad(null)).toBe(null);
  });

  it("a dev save holding a legacy run in flight loads it finished, and the claim brings everything home", () => {
    const { state, exp } = dispatched();
    const legacy = legacyMidRun(exp);
    const withLegacy: GameState = { ...state, gameTimeSeconds: T0 + 7200, expeditions: [legacy] };
    const loaded = migrate(deserialize(serialize(withLegacy, 0))!);
    const run = loaded.expeditions.find((e) => e.id === legacy.id)!;
    expect(run.phase).toBe("complete");
    expect("groundOps" in run).toBe(false);
    expect(run.findings).toEqual(legacy.findings);
    // The tick advances it no further (complete is terminal).
    expect(advanceExpedition(run, loaded.gameTimeSeconds + 1_000_000)).toBe(run);
    // The claim: the findings deposit, the run leaves, nobody comes home injured.
    const claimed = claimExpedition(loaded, run.id);
    expect(claimed.success).toBe(true);
    expect(claimed.injuries).toEqual([]);
    expect(claimed.next.expeditions.some((e) => e.id === run.id)).toBe(false);
    expect(claimed.next.credits.minus(loaded.credits).toNumber()).toBe(30);
    for (const m of claimed.next.awayMembers) expect(m.injuredUntilSeconds).toBeUndefined();
  });

  it("a Ground Ops save loads byte-identically (the step is identity)", () => {
    const { state } = dispatched();
    const s: GameState = { ...state, gameTimeSeconds: T0 + 10 };
    const once = migrate(deserialize(serialize(s, 0, 0))!);
    expect(serialize(migrate(deserialize(serialize(once, 0, 0))!), 0, 0)).toBe(serialize(once, 0, 0));
    expect(finishLegacyExpeditionsOnLoad(once)).toBe(once);
    expect(once.expeditions[0].groundOps).toBeDefined();
    expect(once.expeditions[0].phase).toBe(s.expeditions[0].phase);
  });
});

describe("OC-G1: the engine's guard (advanceExpedition)", () => {
  it("a legacy run is finished, never walked: complete at once, its findings as they were, the input untouched", () => {
    const { exp } = dispatched();
    const legacy = legacyMidRun(exp);
    const frozen = structuredClone(legacy);
    const done = advanceExpedition(legacy, T0 + 5);
    expect(done.phase).toBe("complete");
    expect(done).toEqual({ ...legacy, phase: "complete" });
    expect(finishLegacyExpedition(legacy)).toEqual(done);
    expect(legacy).toEqual(frozen);
    // However the time is chunked, the result is the same.
    let chunked = legacy;
    for (let t = T0; t <= T0 + 50_000; t += 997) chunked = advanceExpedition(chunked, t);
    expect(chunked).toEqual(done);
  });

  it("a Ground Ops run is unaffected: one call == 997 s chunks", () => {
    const { exp } = dispatched();
    const far = T0 + 200_000;
    const one = advanceExpedition(exp, far);
    let chunked = exp;
    for (let t = T0; t < far; t += 997) chunked = advanceExpedition(chunked, t);
    expect(advanceExpedition(chunked, far)).toEqual(one);
    expect(one.groundOps).toBeDefined();
  });
});
