// Relics v2 tier stagger, goldens first (docs/plans/2026-10-17-relics-v2-plan.md, USER ANSWERS (2026-10-27): relic
// timeline study and tier staggering). Tests only, captured on d62f48d BEFORE the stagger engine edit. They pin what a
// blank WITHOUT the stagger stamp reveals today, so the stagger proves it keeps every held blank and every study in
// flight at the update byte-identical ("relics players already own are kept"):
//   1. identifyRelicV2 over unstamped blanks: 7 region tiers x 4 rarities x 3 sites x 24 study indexes.
//   2. a vault of unstamped Tier I and Tier VII blanks studied through the real start and resolver (Lab VII, four lanes),
//      the Museum, the first finds and the completion records.
// NEVER regenerate these from a later build.

import { describe, it, expect } from "vitest";
import { RELIC_DEFAULT_SEED, emptyMuseumV2, freshState, type EquipmentRarity, type GameState, type RegionTier, type RelicSetId, type RelicVaultToken } from "./model";
import { RELIC_SETS } from "./relics";
import { identifyRelicV2, relicIdentificationId } from "./relicIdentify";
import { resolveProcesses, startRelicStudy } from "./tick";
import { hash, onHull, withCrew, SWEEP_END } from "./firstRunsGoldens.fixture";
import type { Expedition } from "./model";
import { advanceExpedition, claimExpedition, makeExpeditionSeed } from "./expedition";
import { asExpeditionVeteran, asPreStudyDispatch, dispatchPastPropulsion } from "./awayTeamTestFixtures";
// The R2-2 goldens' setup (relicsV2BlanksGoldens.test.ts): wear sources and the combat rules off, as there.
import { gearWearOffInThisFile } from "./gearWearSwitch.fixture";
gearWearOffInThisFile();
import { combatRulesOffForThisFile } from "./combatRulesSwitch.fixture";
import { wr11OffForThisFile } from "./wr11Switch.fixture";
combatRulesOffForThisFile();
// Wiring WR-11 came after every pin here: the whole file runs with WR-11 off (wr11Switch.fixture.ts), so its pins keep
// proving their own slice moved nothing else (WR-11's own moves are pinned in wr11Goldens.test.ts).
wr11OffForThisFile();

const TIERS: readonly RegionTier[] = [1, 2, 3, 4, 5, 6, 7];
const RARITIES: readonly EquipmentRarity[] = ["standard", "augmented", "stellar", "radiant"];
const SITES: readonly (RelicSetId | null)[] = [null, "deepEarth", "precursor"];

function heldBlank(id: string, regionTier: RegionTier, rarity: EquipmentRarity, site: RelicSetId | null): RelicVaultToken {
  const sited = site === null ? {} : { setId: site, poiId: RELIC_SETS.find((s) => s.id === site)!.sources[0] };
  return { id, tier: rarity, quality: 0, ...sited, ...(regionTier === 1 ? {} : { regionTier }) };
}

describe("stagger golden 1: identification v2 of held (unstamped) blanks", () => {
  it("7 tiers x 4 rarities x 3 sites x 24 study indexes", () => {
    const rows: string[] = [];
    for (const tier of TIERS)
      for (const rarity of RARITIES)
        for (const site of SITES)
          for (let i = 1; i <= 24; i++) {
            const o = identifyRelicV2(RELIC_DEFAULT_SEED, emptyMuseumV2(), heldBlank(`held-${tier}-${rarity}-${site}-${i}`, tier, rarity, site), i);
            rows.push(`${tier} ${rarity} ${site} ${i} ${o.kind} ${relicIdentificationId(o)}`);
          }
    // A Tier I standard blank reaches every band today (the 60/30/9/1 row), so a held blank can still reveal a type the
    // stagger opens later: that is the behavior held blanks keep.
    expect(rows.length).toBe(7 * 4 * 3 * 24);
    expect(hash(rows)).toBe("24db5fca");
  });
});

// The first finds the held vault lands today, in order. Tier I blanks among them reveal types the stagger opens at Tier II
// and later (Precursor Lens, Deep-Vein Compass, Tectonic Keystone, Ancient Drive Coil): a held blank keeps that.
const HELD_FINDS = [
  "hullRivet", "sporeCapsule", "resonanceShard", "exc-t7-b-p2", "glyphTablet", "bioluminescentSeed", "precursorLens",
  "deepVeinCompass", "flightRecorder", "starChartFragment", "tectonicKeystone", "ancientDriveCoil",
];

describe("stagger golden 2:a vault of held blanks studied through the real start and resolver", () => {
  it("Museum, first finds and completion records", () => {
    const vault: RelicVaultToken[] = [];
    for (let i = 0; i < 16; i++) vault.push(heldBlank(`vault-${i}`, i % 2 === 0 ? 1 : 7, RARITIES[i % 4], SITES[i % 3]));
    let s: GameState = { ...freshState(1), facilities: { ...freshState(1).facilities, research: { level: 7 } }, relicVault: vault, relicQueue: [] };
    for (const t of vault) {
      const r = startRelicStudy(s, t.id);
      if (r.started) s = r.next;
      else {
        // Four lanes at Lab VII: resolve what is running, then start the next.
        s = resolveProcesses(s, 100_000, () => 0).next;
        const again = startRelicStudy(s, t.id);
        expect(again.started, t.id).toBe(true);
        s = again.next;
      }
    }
    s = resolveProcesses(s, 100_000, () => 0).next;
    expect(s.relicVault.length).toBe(0);
    expect({ museum: hash(s.museumV2), discovered: s.relicDiscovered, log: hash(s.completionLog ?? []) }).toEqual({ museum: "8ca930be", discovered: HELD_FINDS, log: "3e3a77e6" });
  });
});

// The run flag as a pre-stagger dispatch wrote it: `relicBlanks` without its `stagger` key (a no-op on d62f48d).
function withoutStaggerFlag(exp: Expedition): Expedition {
  if (!exp.relicBlanks || !("stagger" in exp.relicBlanks)) return exp;
  return { ...exp, relicBlanks: { version: exp.relicBlanks.version } };
}
function asPreStaggerDispatch<R extends { next: GameState; expedition?: Expedition }>(res: R): R {
  if (!res.expedition) return res;
  return { ...res, expedition: withoutStaggerFlag(res.expedition), next: { ...res.next, expeditions: res.next.expeditions.map(withoutStaggerFlag) } };
}

// 3. A Tier VII run dispatched BEFORE the stagger (its relic blanks flag as the dispatch writes it on d62f48d), flown to
// completion and claimed: the finished run and the vault. The stagger build checks the same run with its flag read
// back to the pre-stagger one (asPreStaggerDispatch, a no-op on d62f48d), then studies the vault.
describe("stagger golden 3: a run in flight at the update", () => {
  it("Tier VII, seed 23: finished run, claimed vault, and the vault identified", () => {
    const crewed = asExpeditionVeteran(withCrew(onHull("eir", makeExpeditionSeed(0x2468ace, 23)), "rank6"));
    const res = asPreStaggerDispatch(asPreStudyDispatch(dispatchPastPropulsion(crewed, "ship-1", 1, "cand-7-0")));
    expect(res.success).toBe(true);
    const done = advanceExpedition(res.expedition!, res.next.gameTimeSeconds + SWEEP_END);
    const held = { ...res.next, gameTimeSeconds: done.phaseAnchorSeconds, expeditions: res.next.expeditions.map((e) => (e.id === done.id ? done : e)) };
    const claim = claimExpedition(held, done.id);
    expect(claim.success).toBe(true);
    const ids = claim.next.relicVault.map((t, i) => `${t.tier} ${relicIdentificationId(identifyRelicV2(RELIC_DEFAULT_SEED, emptyMuseumV2(), t, i + 1))}`);
    expect({ run: hash(done), vault: hash(claim.next.relicVault), ids: hash(ids), n: ids.length }).toEqual({ run: "ba1b6b1b", vault: "d6fe0fb4", ids: "e96f4a0b", n: 16 });
  });
});
