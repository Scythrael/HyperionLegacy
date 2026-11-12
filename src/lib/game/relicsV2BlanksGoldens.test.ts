// Relics v2 R2-2 goldens first (docs/plans/2026-10-17-relics-v2-plan.md section 4 R2-2): tests only, captured on the
// code BEFORE the R2-2 engine edit (on top of 624b0c5). They pin what a NEW dispatch's relic finds are today, so R2-2
// proves what it keeps and what it moves:
//   7. fresh dispatches at Tiers I, IV and VII (an Eir with a rank 6 crew, three candidate seeds each), run to
//      completion: every relic finding (its PoI and token) and the whole finished run.
//   8. the Tier I runs claimed: the vault the claim deposits.
// R2-2 must keep every token's id, PoI and count at every tier (the relic chance is untouched, user call 13 "Better
// rarity only"), and the rarity at Tier I. A later pin names its move and the reason.
// NEVER regenerate these from a later build.

// OC-F14 (the field repair rules stamped at dispatch on a system mixing repair worlds with other bodies) came after every pin
// here, traced: the file runs with it off (fieldRepairRulesSwitch.fixture.ts), so its pins keep proving their own slice
// (fieldRepairOrderGoldens.test.ts pins OC-F14's moves and proves them with the switch off).
import { repairRulesOffForThisFile } from "./fieldRepairRulesSwitch.fixture";
repairRulesOffForThisFile();
import { describe, it, expect } from "vitest";
// Wiring WR-10 (the away rules stamped at dispatch, a hire's account program) came after every pin here: the whole file
// runs with WR-10 off (wr10Switch.fixture.ts), so its pins keep proving their own slice (wr10Goldens.test.ts pins WR-10's).
import { wr10OffForThisFile } from "./wr10Switch.fixture";
wr10OffForThisFile();
import { cp14OffForThisFile } from "./cp14Switch.fixture";
// Complement CP-14 (hull base sensors and Science amplification) came after every pin here: the file runs with the
// slice off, so its pins keep proving their own slice (cp14Goldens.test.ts pins what CP-14 moved).
cp14OffForThisFile();
// GEAR WEAR step 3: this file's pins were captured before the use wear engine; it runs with the use sources off
// (gearWearSwitch.fixture.ts), so they keep proving nothing else moved. gearWearGoldens.test.ts pins the wear.
import { gearWearOffInThisFile } from "./gearWearSwitch.fixture";
gearWearOffInThisFile();
import type { Expedition, ExpeditionFinding, GameState, RegionTier } from "./model";
import { advanceExpedition, claimExpedition, makeExpeditionSeed } from "./expedition";
import { hash, onHull, withCrew, SWEEP_END } from "./firstRunsGoldens.fixture";
import { asExpeditionVeteran, asPreRelicBlanksRun, asPreStudyDispatch, dispatchPastPropulsion } from "./awayTeamTestFixtures";
import { cultureForBody } from "./relicBlanks";
import { FIELD_KITS_CATALOG_VERSION } from "./fieldKits";
// WR-8 (0.14.0): every pin in this file was taken before the combat rules (combatRulesSwitch.fixture.ts), so the file
// runs with them switched off and its pins keep proving WR-8 moved nothing else here (the rules stamp new patrol
// cycles and runs; combatDescriptorGoldens.test.ts pins the combat rules themselves).
import { combatRulesOffForThisFile } from "./combatRulesSwitch.fixture";
import { wr11OffForThisFile } from "./wr11Switch.fixture";
combatRulesOffForThisFile();
// Wiring WR-11 came after every pin here: the whole file runs with WR-11 off (wr11Switch.fixture.ts), so its pins keep
// proving their own slice moved nothing else (WR-11's own moves are pinned in wr11Goldens.test.ts).
wr11OffForThisFile();

const SEEDS = [11, 23, 37] as const;
const TIERS: readonly RegionTier[] = [1, 4, 7];

function crewed(seed: number): GameState {
  return asExpeditionVeteran(withCrew(onHull("eir", makeExpeditionSeed(0x2468ace, seed)), "rank6"));
}

function finished(seed: number, tier: RegionTier): { state: GameState; done: Expedition } {
  // G2-4 (merged after this capture) gates an Eir off Tiers IV and VII (a Class I drive): the pre-G2-4 dispatch, which
  // writes the record a gated dispatch of a passing ship would (dispatchPastPropulsion).
  // Gas Giant Study GG-2 (merged after this capture too): a gas giant of a study run has no ground objective, so the
  // capture's runs are flown as dispatched before GG-2 (asPreStudyDispatch: no study stamp, the giant keeps its PoIs).
  const res = asPreStudyDispatch(dispatchPastPropulsion(crewed(seed), "ship-1", 1, `cand-${tier}-0`));
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

// MERGED ONTO feat (0.14.0 integration): the timed grenades (merged into feat after 624b0c5) bumped
// FIELD_KITS_CATALOG_VERSION from 1 to 2, which a new dispatch stamps on its run (fieldKits.catalog). That stamp is the
// only move in these runs: a whole-run JSON diff (Tiers I, IV and VII, seed 11, R2-2 tip against the merge) differs in
// that one field and nowhere else, and with it read back to catalog 1 all nine runs hash to their 624b0c5 pins. The
// live run is checked to carry catalog 2.
function asPreFuseStamp(done: Expedition): Expedition {
  expect(done.fieldKits?.catalog).toBe(FIELD_KITS_CATALOG_VERSION);
  return { ...done, fieldKits: { ...done.fieldKits!, catalog: 1 } };
}

// MOVED AT R2-2, named (user call 13 "Better rarity only"): above Tier I a blank's rarity reads the tier's blank table
// (relicBlanks.ts RELIC_BLANK_WEIGHTS), so these finds came out rarer. The same tokens, the same PoIs, the same count
// (the chance never moved); only the rarity and quality of the listed rows, and so the run hash. Re-pinned on R2-2.
// Every moved row moved UP (Tier VII seed 23: four rows, standard to augmented and augmented to stellar; seed 37: four
// rows, one augmented to radiant). Tier IV's three runs drew no row the shift changes (their low hazard ceilings keep
// most draws standard), so they read exactly as before.
const pre7 = (seed: number, moves: Readonly<Record<number, string>>): readonly string[] => PRE_R2_2[`7:${seed}`].finds.map((r, i) => moves[i] ?? r);
const R2_2_MOVED: Readonly<Record<string, { run: string; finds: readonly string[] }>> = {
  "7:23": {
    run: "de857e2b",
    finds: pre7(23, { 5: "body-2-act-5 derelictOutpost augmented 1", 8: "body-2-act-0 geothermalChamber stellar 3", 9: "body-2-act-3 caveNetwork augmented 1", 11: "body-3-act-3 crashedShip augmented 1" }),
  },
  "7:37": {
    run: "263f6543",
    finds: pre7(37, { 2: "body-2-act-1 derelictOutpost augmented 1", 10: "body-5-act-3 caveNetwork augmented 1", 11: "body-5-act-7 caveNetwork radiant 4", 14: "body-5-act-4 mineralOutcrop augmented 1" }),
  },
};

// MOVED AT THE GG-2 MERGE, named: Tier VII seed 11's third body is a gas giant whose risk grades held a hostile site
// or a clearing objective before GG-2. GG-2 places no hostile site or clearing objective on an orbital body (every draw
// kept), which asPreStudyDispatch cannot rebuild (the record stores the new grades), so the flat task index the later
// bodies' rolls key off moved: the giant's own rows read as before, the fourth body's find came out augmented and the
// fifth body's finds changed. Tier IV seed 11 and Tier VII seed 37 (also gas giant systems) read exactly as before
// through asPreStudyDispatch.
const GG_2_MOVED: Readonly<Record<string, { phase: string; run: string; finds: readonly string[] }>> = {
  "7:11": {
    phase: "complete",
    run: "ece9bfad",
    finds: [
      "body-1-act-0 mineralOutcrop standard 0", "body-1-act-2 subterraneanCivilization standard 0", "body-1-act-3 subterraneanCivilization standard 0",
      "body-1-act-4 derelictOutpost standard 0", "body-2-act-2 subterraneanCivilization standard 0", "body-1-act-1 crashedShip standard 0",
      "body-3-act-1 caveNetwork standard 0", "body-3-act-6 crashedShip standard 0", "body-3-act-2 xenoFloraBloom standard 0",
      "body-3-act-8 xenoFloraBloom standard 0", "body-3-act-4 xenoFloraBloom standard 0", "body-4-act-0 geothermalChamber augmented 1",
      "body-5-act-1 subterraneanCivilization standard 0", "body-5-act-6 ancientRuins standard 0", "body-5-act-4 caveNetwork standard 0",
    ],
  },
};

describe("R2-2 golden 7: fresh dispatches' relic finds by tier", () => {
  for (const tier of TIERS) {
    for (const seed of SEEDS) {
      it(`Tier ${tier}, seed ${seed}`, () => {
        const { done } = finished(seed, tier);
        const pin = { ...PRE_R2_2[`${tier}:${seed}`], ...R2_2_MOVED[`${tier}:${seed}`], ...GG_2_MOVED[`${tier}:${seed}`] };
        const pre = asPreFuseStamp(asPreRelicBlanksRun(done));
        // The chance is untouched at every tier: the same tokens at the same PoIs, in the same order.
        const site = (r: string) => r.split(" ").slice(0, 2).join(" ");
        expect(relicRows(pre).map(site)).toEqual((GG_2_MOVED[`${tier}:${seed}`] ?? PRE_R2_2[`${tier}:${seed}`]).finds.map(site));
        expect({ phase: pre.phase, finds: relicRows(pre), run: hash(pre) }).toEqual({ phase: pin.phase, finds: pin.finds, run: pin.run });
        // Tier I is the pre-R2-2 run exactly.
        if (tier === 1) expect(R2_2_MOVED[`${tier}:${seed}`]).toBeUndefined();
        // Every blank carries the run's tier and its body's culture.
        for (const f of done.findings.filter((x) => x.relic)) {
          const bodyIndex = done.bodies.findIndex((b) => b.activities.some((a) => f.relic!.id.endsWith(`-relic-${a.id}`)));
          expect(bodyIndex, f.relic!.id).toBeGreaterThanOrEqual(0);
          expect({ regionTier: f.relic!.regionTier, cultureId: f.relic!.cultureId }).toEqual({ regionTier: tier, cultureId: cultureForBody(done.seed, bodyIndex, tier) });
        }
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
    // R2-2: every deposited blank keeps the stamps its finding carried (Tier I, its body's culture), appended last;
    // without them the vault is the pre-R2-2 one exactly.
    const finds = new Map(done.findings.filter((f) => f.relic).map((f) => [f.relic!.id, f.relic!]));
    // Relics v2 tier stagger (after this capture, named): a new run's blanks also carry the stagger stamp, appended
    // after them; without it the vault is the R2-2 one exactly.
    return claim.next.relicVault.map((t) => {
      const { regionTier, cultureId, stagger, ...rest } = t;
      expect({ regionTier, cultureId, stagger }, t.id).toEqual({ regionTier: 1, cultureId: finds.get(t.id)!.cultureId, stagger: 1 });
      expect(Object.keys(t).slice(-3)).toEqual(["regionTier", "cultureId", "stagger"]);
      return rest;
    });
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
