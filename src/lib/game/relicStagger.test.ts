// Relics v2 tier stagger (docs/plans/2026-10-17-relics-v2-plan.md, USER ANSWERS (2026-10-27): relic timeline study and
// tier staggering; 2026-10-28 "Starting with standard/augmented is fine for Tier I."): each general type has a first
// region tier (relics.ts RELIC_TYPE_FIRST_TIER); a blank stamped by a run dispatched from the stagger on reveals only the
// types open at its tier, a band with none dropping to the nearest lower band that has one. Held blanks and studies in
// flight keep revealing as before (relicStaggerGoldens.test.ts).

import { describe, it, expect } from "vitest";
import { RELIC_DEFAULT_SEED, emptyMuseumV2, freshState, type EquipmentRarity, type GameState, type RegionTier, type RelicSetId, type RelicVaultToken, type ShortRangeMissionState } from "./model";
import { RELIC_BANDS, RELIC_SETS, RELIC_TYPES, RELIC_TYPE_FIRST_TIER, getRelicTypeById, relicStaggerBand, relicTypesInBand, relicTypesInBandAt } from "./relics";
import { identifyRelicV2, relicIdentificationId, rollRelicIdentification } from "./relicIdentify";
import {
  RELIC_BLANKS_VERSION,
  RELIC_STAGGER_VERSION,
  newRunRelicBlanksFlag,
  planetCompletionRelicBlank,
  relicBlankStamp,
  relicBlanksStaggered,
  rollShortRangeRelicBlanks,
} from "./relicBlanks";
import { resolveProcesses, startRelicStudy } from "./tick";
import { isWellFormedShortRangeMission } from "./shortRangeBoard";
import { shortRangeCycleRelics } from "./shortRangeCycle";
import { BLUEPRINTS } from "./model";
import { deserialize, serialize } from "./save";
import type { Rng } from "./combat/rng";
import Decimal from "break_infinity.js";
import { dispatchCaptainOnShortRange } from "./shortRangeBoard";
import { resolveCrew } from "./crewOverlay";
import { WIRING_CAPTAIN_ID, editShip, installPiece, wiringBase } from "./wiring/probes";

const TIERS: readonly RegionTier[] = [1, 2, 3, 4, 5, 6, 7];
const RARITIES: readonly EquipmentRarity[] = ["standard", "augmented", "stellar", "radiant"];

function staggered(id: string, regionTier: RegionTier, rarity: EquipmentRarity, site: RelicSetId | null = null): RelicVaultToken {
  const sited = site === null ? {} : { setId: site, poiId: RELIC_SETS.find((s) => s.id === site)!.sources[0] };
  return { id, tier: rarity, quality: 0, ...sited, regionTier, stagger: RELIC_STAGGER_VERSION };
}

describe("the table (user 2026-10-27)", () => {
  it("every type has a first tier; Tier I opens standard and augmented only; Tier VII opens one per band from four families", () => {
    for (const t of RELIC_TYPES) expect(t.firstTier, t.id).toBe(RELIC_TYPE_FIRST_TIER[t.id]);
    expect(Object.keys(RELIC_TYPE_FIRST_TIER).sort()).toEqual(RELIC_TYPES.map((t) => t.id).sort());
    const at = (tier: RegionTier) => RELIC_TYPES.filter((t) => t.firstTier === tier).map((t) => t.id);
    expect(at(1)).toEqual(["glyphTablet", "resonanceShard", "sporeCapsule", "geodeCore"]);
    expect(new Set(at(1).map((id) => getRelicTypeById(id)!.band))).toEqual(new Set(["standard", "augmented"]));
    const seven = at(7).map((id) => getRelicTypeById(id)!);
    expect(seven.map((t) => t.band).sort()).toEqual([...RELIC_BANDS].sort());
    expect(new Set(seven.map((t) => t.siteSet)).size).toBe(4);
    // Every tier from II to VII opens at least one type (staggered T1 to T7).
    for (const tier of TIERS) expect(at(tier).length, `Tier ${tier}`).toBeGreaterThan(0);
  });

  it("a type once open stays open at every tier above; Tier VII opens all 17", () => {
    for (const t of RELIC_TYPES)
      for (const tier of TIERS) expect(relicTypesInBandAt(t.band, tier).includes(t), `${t.id} ${tier}`).toBe(tier >= t.firstTier);
    expect(RELIC_BANDS.flatMap((b) => relicTypesInBandAt(b, 7)).length).toBe(17);
  });

  it("a band with no open type drops to the nearest lower band that has one (never a dead roll)", () => {
    for (const tier of TIERS)
      for (const band of RELIC_BANDS) {
        const landed = relicStaggerBand(band, tier);
        expect(relicTypesInBandAt(landed, tier).length, `${tier} ${band}`).toBeGreaterThan(0);
        expect(RELIC_BANDS.indexOf(landed), `${tier} ${band}`).toBeLessThanOrEqual(RELIC_BANDS.indexOf(band));
        if (relicTypesInBandAt(band, tier).length > 0) expect(landed).toBe(band);
      }
    expect(relicStaggerBand("radiant", 1)).toBe("augmented");
    expect(relicStaggerBand("stellar", 1)).toBe("augmented");
    expect(relicStaggerBand("radiant", 3)).toBe("stellar");
    expect(relicStaggerBand("radiant", 4)).toBe("radiant");
  });
});

// An Rng that counts its integer draws and answers each with `answer(maxExclusive)`.
function scripted(answer: (max: number) => number): Rng & { draws: number } {
  const r = {
    draws: 0,
    next: () => 0,
    nextInt(max: number) {
      r.draws++;
      return answer(max);
    },
    nextRange: (a: number) => a,
    chance: () => false,
  };
  return r as unknown as Rng & { draws: number };
}

describe("the roll", () => {
  it("draws exactly three integers, staggered or not, at every tier, band and in-band index", () => {
    for (const tier of TIERS)
      for (const rarity of RARITIES)
        for (const pick of [0, 1, 7, 50, 99, 999]) {
          const rng = scripted((max) => (max === 100_000 ? 99_999 : Math.min(max - 1, pick)));
          const o = rollRelicIdentification(rng, { regionTier: tier, rarity, siteSet: null, heldExceptional: {}, staggered: true });
          expect(rng.draws).toBe(3);
          expect(o.kind).toBe("general");
        }
  });

  it("a staggered blank never reveals a type above its tier; Tier I reveals only standard and augmented types", () => {
    for (const tier of TIERS)
      for (const rarity of RARITIES)
        for (let i = 0; i < 400; i++) {
          const o = identifyRelicV2(RELIC_DEFAULT_SEED, emptyMuseumV2(), staggered(`s-${tier}-${rarity}-${i}`, tier, rarity, i % 3 === 0 ? "deepEarth" : null), i + 1);
          if (o.kind !== "general") continue;
          expect(getRelicTypeById(o.typeId)!.firstTier, `${tier} ${rarity} ${i} ${o.typeId}`).toBeLessThanOrEqual(tier);
          if (tier === 1) expect(["standard", "augmented"]).toContain(getRelicTypeById(o.typeId)!.band);
        }
  });

  it("at Tier VII (every type open) a staggered blank reveals exactly what an unstamped one does", () => {
    for (const rarity of RARITIES)
      for (let i = 0; i < 200; i++) {
        const t = staggered(`seven-${rarity}-${i}`, 7, rarity, i % 2 === 0 ? "precursor" : null);
        const { stagger: _s, ...held } = t;
        expect(identifyRelicV2(RELIC_DEFAULT_SEED, emptyMuseumV2(), t, i + 1)).toEqual(identifyRelicV2(RELIC_DEFAULT_SEED, emptyMuseumV2(), held, i + 1));
      }
  });

  it("the stagger never loses a find: every staggered study reveals a relic", () => {
    // Pure in the stored values; the exceptional check and the band draw are the unstamped roll's.
    for (let i = 0; i < 500; i++) {
      const t = staggered(`never-${i}`, 1, "radiant");
      const { stagger: _s, ...held } = t;
      const a = identifyRelicV2(RELIC_DEFAULT_SEED, emptyMuseumV2(), t, i + 1);
      const b = identifyRelicV2(RELIC_DEFAULT_SEED, emptyMuseumV2(), held, i + 1);
      expect(a.kind).toBe(b.kind);
      if (a.kind === "exceptional") expect(a).toEqual(b);
      else expect(relicIdentificationId(a).length).toBeGreaterThan(0);
    }
  });
});

describe("the stamp", () => {
  it("a new run's flag carries the stagger; a run without it mints unstamped blanks", () => {
    expect(newRunRelicBlanksFlag()).toEqual({ version: RELIC_BLANKS_VERSION, stagger: RELIC_STAGGER_VERSION });
    expect(relicBlanksStaggered(newRunRelicBlanksFlag())).toBe(true);
    const preStagger: { version: number; stagger?: number } = { version: 1 };
    expect(relicBlanksStaggered(preStagger)).toBe(false);
    expect(relicBlanksStaggered(undefined)).toBe(false);
    const exp = { seed: 77, region: undefined, risk: undefined } as const;
    expect(relicBlankStamp({ ...exp, relicBlanks: newRunRelicBlanksFlag() }, 0)?.stagger).toBe(RELIC_STAGGER_VERSION);
    expect(relicBlankStamp({ ...exp, relicBlanks: { version: 1 } }, 0)).not.toHaveProperty("stagger");
  });

  it("short-range blanks: the stamp is appended, nothing else moves; the mission flag drives it", () => {
    for (let seed = 0; seed < 200; seed++) {
      const plain = rollShortRangeRelicBlanks(seed, 2, 36 * 3600, `sr-${seed}`);
      const stamped = rollShortRangeRelicBlanks(seed, 2, 36 * 3600, `sr-${seed}`, true);
      expect(stamped.map(({ stagger: _s, ...rest }) => rest)).toEqual(plain);
      for (const t of stamped) expect(Object.keys(t).at(-1)).toBe("stagger");
    }
    const mission = (flag: ShortRangeMissionState["relicBlanks"]) =>
      ({ slotId: 0, roll: { seed: 3, tier: 2, cycleIndex: 0 }, plan: { totalTicks: 400_000 }, relicBlanks: flag }) as unknown as ShortRangeMissionState;
    expect(shortRangeCycleRelics(mission({ version: 1, stagger: 1 }), 1).every((t) => t.stagger === 1)).toBe(true);
    expect(shortRangeCycleRelics(mission({ version: 1 }), 1).some((t) => "stagger" in t)).toBe(false);
  });

  it("a new short-range dispatch carries the stagger; the save check accepts it, a pre-stagger flag, and no foreign value", () => {
    // shortRangeRelics.test.ts's qualified Eir (a sensor array and a Guest Wing meet the Tier I sheet).
    const eir = resolveCrew({ ...editShip(wiringBase(), { typeKey: "eir" }), gameTimeSeconds: 48 * 3600 });
    const sensed = installPiece(eir, { slotType: "sensor", moduleVariant: "sensorBalanced", implicitStats: { sensors: 20 } });
    const q = installPiece(sensed, { slotType: "quarters", moduleVariant: "quartersGuestWing", implicitStats: { colonistCapacity: 30 } });
    const r = dispatchCaptainOnShortRange({ ...q, credits: new Decimal(1e9), transitBerthCapacity: 8 }, WIRING_CAPTAIN_ID, 0, true);
    expect(r.success, String(r.reason)).toBe(true);
    const m = r.next.captains.find((c) => c.id === WIRING_CAPTAIN_ID)!.mission as ShortRangeMissionState;
    expect(m.relicBlanks).toEqual({ version: 1, stagger: 1 });
    expect(isWellFormedShortRangeMission(m)).toBe(true);
    expect(isWellFormedShortRangeMission({ ...m, relicBlanks: { version: 1 } })).toBe(true);
    expect(isWellFormedShortRangeMission({ ...m, relicBlanks: { version: 1, stagger: 2 } as never })).toBe(false);
  });

  it("the planet completion blank carries the stamp on a staggered run", () => {
    const exp = { id: "e", seed: 5, region: undefined, risk: undefined, bodies: [{ id: "body-1", hazard: 0.9 }] } as never;
    expect(planetCompletionRelicBlank({ ...(exp as object), relicBlanks: newRunRelicBlanksFlag() } as never, 0)?.stagger).toBe(1);
    expect(planetCompletionRelicBlank({ ...(exp as object), relicBlanks: { version: 1 } } as never, 0)).not.toHaveProperty("stagger");
  });

  it("a stamped vault token survives the save round trip", () => {
    const s: GameState = { ...freshState(1), relicVault: [staggered("rt", 3, "stellar")] };
    expect(deserialize(serialize(s, 0))!.state.relicVault).toEqual(s.relicVault);
  });
});

describe("through the real start and resolver", () => {
  // 60 radiant Tier II blanks (the band most likely to reach a late type), Lab VII, studied to the end.
  function studied(regionTier: RegionTier, n: number): GameState {
    let s: GameState = { ...freshState(1), facilities: { ...freshState(1).facilities, research: { level: 7 } }, relicVault: [], relicQueue: [] };
    for (let i = 0; i < n; i++) {
      const t = staggered(`real-${regionTier}-${i}`, regionTier, "radiant", i % 2 === 0 ? "shipwright" : null);
      const r = startRelicStudy({ ...s, relicVault: [t] }, t.id);
      expect(r.started).toBe(true);
      s = resolveProcesses(r.next, 100_000, () => 0).next;
    }
    return s;
  }

  it("a staggered Tier II vault discovers no type above Tier II, so no later relic-gated blueprint opens", () => {
    const s = studied(2, 60);
    const general = s.relicDiscovered.filter((id) => getRelicTypeById(id));
    expect(general.length).toBeGreaterThan(0);
    for (const id of general) expect(getRelicTypeById(id)!.firstTier, id).toBeLessThanOrEqual(2);
    // The radiant band at Tier II has no open type: radiant reveals dropped to Precursor Lens (stellar, Tier II).
    expect(general).toContain("precursorLens");
    for (const key of ["damageControlSuiteBp", "pathfinderSuiteBp", "bioResonanceArrayBp", "neuralBackupBp"]) {
      const gate = BLUEPRINTS[key].requiresRelicDiscovery!;
      expect(s.relicDiscovered, key).not.toContain(gate);
    }
  });

  it("at Tier VII the same staggered blanks open every relic-gated blueprint's relic in time", () => {
    const s = studied(7, 400);
    for (const key of ["damageControlSuiteBp", "pathfinderSuiteBp", "bioResonanceArrayBp", "neuralBackupBp"]) {
      expect(s.relicDiscovered, key).toContain(BLUEPRINTS[key].requiresRelicDiscovery!);
    }
  });

  it("relicTypesInBand (unstamped pool) is unchanged by the stagger", () => {
    for (const band of RELIC_BANDS) expect(relicTypesInBand(band)).toEqual(RELIC_TYPES.filter((t) => t.band === band));
  });
});
