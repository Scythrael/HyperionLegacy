// Relics v2 R2-2 goldens first (docs/plans/2026-10-17-relics-v2-plan.md section 4 R2-2): tests only, captured on the
// code BEFORE the R2-2 engine edit (on top of 624b0c5). They pin what a NEW dispatch's relic finds are today, so R2-2
// proves what it keeps and what it moves:
//   7. fresh dispatches at Tiers I, IV and VII (an Eir with a rank 6 crew, three candidate seeds each), run to
//      completion: every relic finding (its PoI and token) and the whole finished run.
//   8. the Tier I runs claimed: the vault the claim deposits.
// R2-2 must keep every token's id, PoI and count at every tier (the relic chance is untouched, user call 13 "Better
// rarity only"), and the rarity at Tier I. A later pin names its move and the reason.
// NEVER regenerate these from a later build.

import { describe, it, expect } from "vitest";
import type { Expedition, ExpeditionFinding, GameState, RegionTier } from "./model";
import { advanceExpedition, claimExpedition, makeExpeditionSeed, startExpedition } from "./expedition";
import { hash, onHull, withCrew, SWEEP_END } from "./firstRunsGoldens.fixture";
import { asExpeditionVeteran } from "./awayTeamTestFixtures";

const SEEDS = [11, 23, 37] as const;
const TIERS: readonly RegionTier[] = [1, 4, 7];

function crewed(seed: number): GameState {
  return asExpeditionVeteran(withCrew(onHull("eir", makeExpeditionSeed(0x2468ace, seed)), "rank6"));
}

function finished(seed: number, tier: RegionTier): { state: GameState; done: Expedition } {
  const res = startExpedition(crewed(seed), "ship-1", 1, `cand-${tier}-0`);
  if (!res.success || !res.expedition) throw new Error(`dispatch refused: ${seed} ${tier} ${res.reason}`);
  return { state: res.next, done: advanceExpedition(res.expedition, res.next.gameTimeSeconds + SWEEP_END) };
}

// One relic finding as "<body-act> <PoI> <rarity> <quality>" (the id's run prefix dropped).
const row = (f: ExpeditionFinding): string => `${f.relic!.id.replace(/^expedition-1-relic-expedition-1-/, "")} ${f.poiId} ${f.relic!.tier} ${f.relic!.quality}`;
const relicRows = (done: Expedition): string[] => done.findings.filter((f) => f.relic).map(row);

// Captured on 624b0c5.
const PRE_R2_2: Readonly<Record<string, { phase: string; run: string; finds: readonly string[] }>> = {
  "1:11": { phase: "complete", run: "c992e059", finds: ["body-1-act-4 xenoFloraBloom standard 0", "body-1-act-2 crashedShip standard 0", "body-1-act-3 buriedVault standard 0"] },
  "1:23": { phase: "activities", run: "b4a0ca78", finds: ["body-1-act-0 caveNetwork standard 0", "body-1-act-2 caveNetwork standard 0", "body-2-act-1 derelictOutpost standard 0", "body-2-act-2 geothermalChamber standard 0", "body-3-act-0 mineralOutcrop standard 0", "body-2-act-3 buriedVault standard 0"] },
  "1:37": { phase: "complete", run: "53ef7e5a", finds: ["body-1-act-3 ancientRuins standard 0", "body-1-act-5 caveNetwork standard 0", "body-2-act-0 derelictOutpost standard 0", "body-2-act-1 buriedVault standard 0"] },
  "4:11": { phase: "complete", run: "bf5f2929", finds: ["body-1-act-2 caveNetwork standard 0", "body-2-act-1 ancientRuins standard 0", "body-2-act-3 derelictOutpost standard 0", "body-3-act-2 mineralOutcrop standard 0", "body-3-act-4 xenoFloraBloom standard 0"] },
  "4:23": { phase: "complete", run: "c49a2f8", finds: ["body-1-act-0 ancientRuins standard 0", "body-1-act-5 geothermalChamber standard 0", "body-1-act-3 xenoFloraBloom standard 0", "body-2-act-1 ancientRuins augmented 1", "body-2-act-2 buriedVault augmented 1", "body-2-act-0 geothermalChamber standard 0"] },
  "4:37": { phase: "complete", run: "673dedf5", finds: ["body-1-act-3 ancientRuins standard 0", "body-1-act-2 buriedVault augmented 1", "body-1-act-0 crashedShip standard 0", "body-2-act-0 caveNetwork standard 0", "body-2-act-7 ancientRuins standard 0", "body-2-act-3 mineralOutcrop standard 0", "body-2-act-5 derelictOutpost standard 0"] },
  "7:11": { phase: "complete", run: "3188a19", finds: ["body-1-act-0 mineralOutcrop standard 0", "body-1-act-2 subterraneanCivilization standard 0", "body-1-act-3 subterraneanCivilization standard 0", "body-1-act-4 derelictOutpost standard 0", "body-2-act-2 subterraneanCivilization standard 0", "body-1-act-1 crashedShip standard 0", "body-3-act-1 caveNetwork standard 0", "body-3-act-6 crashedShip standard 0", "body-3-act-2 xenoFloraBloom standard 0", "body-3-act-8 xenoFloraBloom standard 0", "body-3-act-4 xenoFloraBloom standard 0", "body-4-act-0 geothermalChamber standard 0", "body-5-act-0 ancientRuins standard 0", "body-5-act-3 ancientRuins standard 0", "body-5-act-6 ancientRuins standard 0", "body-5-act-4 caveNetwork standard 0"] },
  "7:23": { phase: "complete", run: "bc542656", finds: ["body-1-act-3 crashedShip standard 0", "body-1-act-5 ancientRuins augmented 1", "body-1-act-1 geothermalChamber standard 0", "body-1-act-2 buriedVault augmented 1", "body-1-act-6 buriedVault standard 0", "body-2-act-5 derelictOutpost standard 0", "body-2-act-1 derelictOutpost standard 0", "body-1-act-0 xenoFloraBloom standard 0", "body-2-act-0 geothermalChamber augmented 1", "body-2-act-3 caveNetwork standard 0", "body-3-act-2 derelictOutpost standard 0", "body-3-act-3 crashedShip standard 0", "body-3-act-1 caveNetwork standard 0", "body-4-act-0 mineralOutcrop augmented 1", "body-4-act-2 buriedVault standard 0", "body-2-act-2 buriedVault standard 0"] },
  "7:37": { phase: "activities", run: "93b65529", finds: ["body-1-act-0 buriedVault standard 0", "body-2-act-0 derelictOutpost standard 0", "body-2-act-1 derelictOutpost standard 0", "body-3-act-3 derelictOutpost standard 0", "body-3-act-1 crashedShip standard 0", "body-4-act-1 xenoFloraBloom standard 0", "body-4-act-2 buriedVault standard 0", "body-4-act-3 derelictOutpost standard 0", "body-4-act-4 buriedVault standard 0", "body-5-act-1 caveNetwork standard 0", "body-5-act-3 caveNetwork standard 0", "body-5-act-7 caveNetwork augmented 1", "body-5-act-5 geothermalChamber augmented 1", "body-5-act-0 mineralOutcrop augmented 1", "body-5-act-4 mineralOutcrop standard 0", "body-5-act-2 buriedVault standard 0"] },
};

describe("R2-2 golden 7: fresh dispatches' relic finds by tier", () => {
  for (const tier of TIERS) {
    for (const seed of SEEDS) {
      it(`Tier ${tier}, seed ${seed}`, () => {
        const { done } = finished(seed, tier);
        const pin = PRE_R2_2[`${tier}:${seed}`];
        expect({ phase: done.phase, finds: relicRows(done) }).toEqual({ phase: pin.phase, finds: pin.finds });
        expect(hash(done)).toBe(pin.run);
      });
    }
  }
});

describe("R2-2 golden 8: the Tier I claims' vault", () => {
  const vault = (seed: number) => {
    const { state, done } = finished(seed, 1);
    const held = { ...state, gameTimeSeconds: done.phaseAnchorSeconds, expeditions: state.expeditions.map((e) => (e.id === done.id ? done : e)) };
    const claim = claimExpedition(held, done.id);
    expect(claim.success).toBe(true);
    return claim.next.relicVault;
  };
  const tok = (act: string, setId: string, poiId: string) => ({ id: `expedition-1-relic-expedition-1-${act}`, tier: "standard", quality: 0, setId, poiId });
  it("seed 11", () => {
    expect(vault(11)).toEqual([tok("body-1-act-4", "xenobiology", "xenoFloraBloom"), tok("body-1-act-2", "shipwright", "crashedShip"), tok("body-1-act-3", "precursor", "buriedVault")]);
  });
  it("seed 37", () => {
    expect(vault(37)).toEqual([
      tok("body-1-act-3", "precursor", "ancientRuins"),
      tok("body-1-act-5", "deepEarth", "caveNetwork"),
      tok("body-2-act-0", "shipwright", "derelictOutpost"),
      tok("body-2-act-1", "precursor", "buriedVault"),
    ]);
  });
});
