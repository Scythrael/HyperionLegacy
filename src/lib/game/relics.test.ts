// Exploration 0.14.0 (Phase E4a) tests: the RELIC ENGINE FOUNDATION.
//
// Covers:
//   - the relic CATALOG (four locked sets, 17 relics in K-piece order, US-English flavor with no em dashes);
//   - the PoI -> relic-set SINGLE SOURCE driving BOTH the gambit reward roll and the E2c foreknowledge
//     relic signature (the signature's sets match what the committed expedition actually discovers);
//   - the CLAIM DEPOSIT (materials via the discovery-safe seam + warehouse cap, credits, relic tokens into
//     the vault with set routing, evacuated partial findings, anomaly no-op, lifetime stats fold);
//   - RELIC STUDY start/complete (own Research lane, gates, keyed deterministic identification, tier skew,
//     first-find registered exactly once, completion parity big-jump vs stepped);
//   - MUSEUM MATH (the approved mockup's bottleneck worked example 45/41/22/18/0, museumBonuses sums);
//   - ADDITIVE-NEUTRALITY (an empty relic store is byte-identical on the tick path);
//   - the v62 -> v63 SAVE migration.

import { describe, it, expect } from "vitest";
import Decimal from "break_infinity.js";
import {
  freshState,
  RELIC_DEFAULT_SEED,
  type GameState,
  type Expedition,
  type ExpeditionFinding,
  type EquipmentInstance,
  type RelicVaultToken,
  type RelicSetId,
  generalMuseumRecord,
  emptyMuseumV2,
} from "./model";
import {
  RELICS,
  RELIC_SETS,
  RELIC_SET_BY_POI,
  RELIC_BEARING_POIS,
  MUSEUM_STATS,
  MUSEUM_PER_COPY_BONUS,
  MUSEUM_TIER_LEVEL_BONUS,
  MUSEUM_CAPSTONE_MAGNITUDE,
  getRelicById,
  getRelicSetById,
  relicSetForPoi,
  isRelicBearingPoi,
  identifyRelic,
  relicStudySeed,
  relicStudyDurationTicks,
  relicCopyLevel,
  setTierLevels,
  setCompletion,
  museumBonuses,
  museumBonusesFromRecord,
  setTierBonus,
  setPerCopyBonus,
} from "./relics";
import { RELIC_BEARING_POIS as GAMBIT_RELIC_BEARING_POIS, rollRelicToken } from "./gambit";
import {
  claimExpedition,
  depositExpeditionFindings,
  summarizeExpeditionFindings,
  expeditionCandidates,
  advanceExpedition,
  SENSOR_REVEAL_RELIC,
  SENSOR_REVEAL_HAZARD,
} from "./expedition";
import { asLegacyDispatch, ensureMinimumAwayTeam, dispatchPastPropulsion } from "./awayTeamTestFixtures";
import {
  tick,
  economyTick,
  resolveProcesses,
  itemCap,
  canResearch,
  canStartRelicStudy,
  startRelicStudy,
  relicStudySlotCount,
  relicStudiesInFlight,
  identifyStudiedRelic,
} from "./tick";
import { POI_CATALOG } from "./expeditionContent";
import { itemTotal } from "./inventory";
import { migrate, type SaveFile } from "./save";
import { startV1RelicStudy } from "./relicStudyV1.fixture";

// --- fixtures ----------------------------------------------------------------

// A sensor array fitted to ship-1 with the given implicit sensors (mirrors expedition.test.ts).
function shipWithSensors(sensors: number): GameState {
  const s = freshState();
  const piece: EquipmentInstance = {
    id: "equip-sensor-pow",
    slotType: "sensor",
    rarity: "standard",
    ascension: "none",
    quality: 0,
    iLevel: 1,
    blueprintKey: null,
    implicitStats: { sensors },
    rolledStats: {},
    mass: 0,
    powerDraw: 0,
    durabilityMax: 100,
    fittedToShipId: "ship-1",
    moduleVariant: "sensorBalanced",
  };
  return { ...s, equipment: [...s.equipment, piece] };
}

// A COMPLETE hand-built expedition carrying the given findings (only claim reads it).
function completeExpedition(findings: ExpeditionFinding[], id = "expedition-1"): Expedition {
  return {
    id,
    shipId: "ship-1",
    captainId: 1,
    targetSystemId: "keplersReach",
    systemName: "Kepler's Reach",
    sensorArrayId: null,
    scanParams: { scanRateMult: 1, coverageWidth: 1, landmarkOddsBias: 0, undergroundPoiOddsBias: 0 },
    sensorPower: 0,
    phase: "complete",
    phaseAnchorSeconds: 0,
    shakedown: false,
    bodies: [],
    anomalyResolved: true,
    anomalyCharted: false,
    anomalyOptIn: true,
    findings,
    seed: 1,
    securityStrength: 0,
    scienceStrength: 0,
    teamKit: 0,
    gambitPrograms: { security: [], science: [] },
    // E4b museum snapshot: neutral (an empty museum), so every pre-E4b assertion is unchanged.
    scanSpeedBonus: 0,
    relicFindBonus: 0,
    hazardResist: 0,
  };
}

function token(id: string, setId: RelicSetId, tier: RelicVaultToken["tier"] = "standard"): RelicVaultToken {
  const poiId = RELIC_SETS.find((s) => s.id === setId)!.sources[0];
  return { id, tier, quality: 0, setId, poiId };
}

// Start + fully resolve ONE relic study on the first vault token. Returns the post-completion state.
// Relics v2 R2-3: started as a v1 study (no `v` stamp), so these tests keep pinning the v1 path an in-flight study
// resolves through; identification v2 is covered in relicIdentify.test.ts.
function studyFirst(s: GameState): GameState {
  const tokenId = s.relicVault[0].id;
  const started = startV1RelicStudy(s, tokenId);
  expect(started.started).toBe(true);
  const proc = started.next.activeProcesses.find((p) => p.kind === "relicStudy")!;
  return resolveProcesses(started.next, proc.remainingTicks, () => 0).next;
}

// ============================================================================
describe("relic catalog: the four locked sets, 17 relics in K-piece order", () => {
  it("ships the exact set labels and relic names in piece order", () => {
    const names = (setId: RelicSetId) => getRelicSetById(setId)!.relicIds.map((rid) => getRelicById(rid)!.label);
    expect(RELIC_SETS.map((s) => s.label)).toEqual(["Precursor Set", "Shipwright Set", "Xenobiology Set", "Deep Earth Set"]);
    expect(names("precursor")).toEqual(["Glyph Tablet", "Resonance Shard", "Star-Chart Fragment", "Precursor Lens", "Heart of the Archive"]);
    expect(names("shipwright")).toEqual(["Hull Rivet", "Flight Recorder", "Ancient Drive Coil", "Captain's Sigil"]);
    expect(names("xenobiology")).toEqual(["Spore Capsule", "Bioluminescent Seed", "Leviathan Scale", "Living Crystal"]);
    expect(names("deepEarth")).toEqual(["Geode Core", "Magma Pearl", "Deep-Vein Compass", "Tectonic Keystone"]);
    expect(RELICS).toHaveLength(17);
  });

  it("every relic has a 1-based index matching its roster slot, the capstone last, and clean flavor", () => {
    for (const set of RELIC_SETS) {
      set.relicIds.forEach((rid, i) => {
        const r = getRelicById(rid)!;
        expect(r.setId).toBe(set.id);
        expect(r.index).toBe(i + 1);
      });
      expect(getRelicById(set.relicIds[set.relicIds.length - 1])!.rarity).toBe("capstone");
      // Tiers run 2..K, one per piece count.
      expect(set.tiers.map((t) => t.pieces)).toEqual(Array.from({ length: set.relicIds.length - 1 }, (_, i) => i + 2));
    }
    for (const r of RELICS) {
      expect(r.flavor.length).toBeGreaterThan(10);
      expect(r.flavor.includes(String.fromCharCode(0x2014))).toBe(false);
      expect(r.flavor.includes("--")).toBe(false); // no em dashes, no "--" substitutes
    }
  });

  it("per-copy + tier stats follow the approved mockup", () => {
    const sets = Object.fromEntries(RELIC_SETS.map((s) => [s.id, s]));
    expect(sets.precursor.perCopyStat).toBe("researchSpeed");
    expect(sets.precursor.tiers.map((t) => t.stats)).toEqual([["researchSpeed"], ["craftingQuality"], ["relicFindChance"], ["researchSpeed", "craftingQuality"]]);
    expect(sets.precursor.tiers[3].capstone).toBe(true);
    expect(sets.precursor.tiers[3].magnitude).toBe(MUSEUM_CAPSTONE_MAGNITUDE);
    expect(sets.shipwright.perCopyStat).toBe("cargoCapacity");
    expect(sets.shipwright.tiers.map((t) => t.stats[0])).toEqual(["transitSpeed", "cargoCapacity", "salvageYield"]);
    expect(sets.xenobiology.perCopyStat).toBe("sensors");
    expect(sets.xenobiology.tiers.map((t) => t.stats[0])).toEqual(["scanSpeed", "scienceTeamPower", "crewBonuses"]);
    expect(sets.deepEarth.perCopyStat).toBe("miningYield");
    expect(sets.deepEarth.tiers.map((t) => t.stats[0])).toEqual(["rareMaterialChance", "extractionSpeed", "hazardResist"]);
  });
});

// ============================================================================
describe("PoI -> relic set: ONE source of truth for the reward roll AND the foreknowledge signature", () => {
  it("maps each PoI to the set the mockup sources it from", () => {
    expect(RELIC_SET_BY_POI).toEqual({
      subterraneanCivilization: "precursor",
      buriedVault: "precursor",
      ancientRuins: "precursor",
      crashedShip: "shipwright",
      derelictOutpost: "shipwright",
      xenoFloraBloom: "xenobiology",
      caveNetwork: "deepEarth",
      geothermalChamber: "deepEarth",
      mineralOutcrop: "deepEarth",
    });
    // Every catalog PoI sources a set (so Xenobiology + Deep Earth can actually drop now).
    for (const poi of POI_CATALOG) expect(isRelicBearingPoi(poi.id)).toBe(true);
    expect(relicSetForPoi("notARealPoi")).toBeNull();
    expect(relicSetForPoi(undefined)).toBeNull();
  });

  it("the gambit reward roll reads the SAME set object (no second list to drift)", () => {
    expect(GAMBIT_RELIC_BEARING_POIS).toBe(RELIC_BEARING_POIS);
    // The roll fires only where the map says so: a mapped PoI drops at a chance, an unmapped one never.
    let mappedHits = 0;
    for (let s = 0; s < 300; s++) {
      if (rollRelicToken(s, 0.7, "xenoFloraBloom", `r-${s}`)) mappedHits++;
      expect(rollRelicToken(s, 0.7, "notARealPoi", `r-${s}`)).toBeNull();
    }
    expect(mappedHits).toBeGreaterThan(0);
  });

  it("the foreknowledge relic sets equal the sets the COMMITTED expedition actually discovers", () => {
    const s = ensureMinimumAwayTeam(shipWithSensors(SENSOR_REVEAL_RELIC)); // D18: a launchable ship
    const cands = expeditionCandidates(s, "ship-1");
    for (const cand of cands) {
      const fk = cand.foreknowledge;
      expect(fk.relicSets).not.toBeNull();
      expect(fk.relicSignature).toBe(fk.relicSets!.length > 0);
      // Commit this candidate and run it to completion; derive the sets from its real discoveries.
      // A legacy run (asLegacyDispatch) always completes; the discoveries are the same on either engine.
      const res = asLegacyDispatch(dispatchPastPropulsion(s, "ship-1", 1, cand.id));
      const done = advanceExpedition(res.expedition!, 10_000_000);
      expect(done.phase).toBe("complete");
      const found = new Set<RelicSetId>();
      for (const b of done.bodies) for (const d of b.discoveries) found.add(relicSetForPoi(d.poiId)!);
      expect(fk.relicSets).toEqual(RELIC_SETS.map((x) => x.id).filter((id) => found.has(id)));
    }
  });

  it("the relic sets stay masked below the relic reveal threshold", () => {
    const fk = expeditionCandidates(shipWithSensors(SENSOR_REVEAL_HAZARD), "ship-1")[0].foreknowledge;
    expect(fk.relicSets).toBeNull();
    expect(fk.relicSignature).toBeNull();
  });
});

// ============================================================================
describe("CLAIM DEPOSIT: findings land in inventory / credits / the relic vault", () => {
  const findings: ExpeditionFinding[] = [
    {
      id: "f-1",
      source: "activity",
      poiId: "xenoFloraBloom",
      materials: { scrapAlloy: 5, anomalousAlloy: 3 },
      credits: 100,
      relic: { id: "expedition-1-relic-a", tier: "stellar", quality: 2, unidentified: true },
    },
    // An EVACUATED partial: deposits its reduced haul like any other, never a relic.
    { id: "f-2", source: "activity", poiId: "caveNetwork", materials: { titaniumIngot: 2 }, credits: 40, relic: null, evacuated: true },
    // An ANOMALY finding: no payload, a no-op.
    { id: "f-3", source: "anomaly" },
  ];

  it("deposits materials (marking them discovered), credits, and routes the relic to its set in the vault", () => {
    const base = { ...freshState(), expeditions: [completeExpedition(findings)] };
    const res = claimExpedition(base, "expedition-1");
    expect(res.success).toBe(true);
    const n = res.next;
    expect(n.expeditions).toHaveLength(0);
    expect(itemTotal(n.inventory, "scrapAlloy").minus(itemTotal(base.inventory, "scrapAlloy")).toNumber()).toBe(5);
    expect(itemTotal(n.inventory, "anomalousAlloy").toNumber()).toBe(3);
    expect(itemTotal(n.inventory, "titaniumIngot").minus(itemTotal(base.inventory, "titaniumIngot")).toNumber()).toBe(2);
    // The discovery-safe seam marks a reward-only exotic DISCOVERED (the 0.13.8 invisible-exotic guard).
    expect(base.discovered.includes("anomalousAlloy")).toBe(false);
    expect(n.discovered).toContain("anomalousAlloy");
    expect(n.credits.minus(base.credits).toNumber()).toBe(140);
    // The relic token keeps its tier + quality + PoI, routed to Xenobiology.
    expect(n.relicVault).toEqual([
      { id: "expedition-1-relic-a", tier: "stellar", quality: 2, setId: "xenobiology", poiId: "xenoFloraBloom" },
    ]);
    // Lifetime stats fold through the shared seam: gross materials gathered + credits earned.
    expect(n.lifetimeStats.creditsEarned.minus(base.lifetimeStats.creditsEarned).toNumber()).toBe(140);
    expect(n.lifetimeStats.itemsGathered.anomalousAlloy.toNumber()).toBe(3);
    // The summary reader reports the same haul.
    expect(summarizeExpeditionFindings(findings)).toEqual({
      materials: { scrapAlloy: 5, anomalousAlloy: 3, titaniumIngot: 2 },
      credits: 140,
      relics: 1,
      evacuated: 1,
    });
  });

  it("honors the warehouse cap: a near-cap stack lands AT the cap, never past it", () => {
    const s0 = freshState();
    const cap = itemCap(s0, "scrapAlloy");
    const nearCap = { ...s0, inventory: { ...s0.inventory, scrapAlloy: [cap.minus(2)] } };
    const out = depositExpeditionFindings(nearCap, [{ id: "f", source: "activity", poiId: "mineralOutcrop", materials: { scrapAlloy: 5 } }]);
    expect(itemTotal(out.inventory, "scrapAlloy").equals(cap)).toBe(true);
  });

  it("an anomaly-only (payload-free) finding list is a same-reference no-op deposit", () => {
    const s = freshState();
    expect(depositExpeditionFindings(s, [{ id: "a", source: "anomaly" }])).toBe(s);
    // A claim of an anomaly-only run changes ONLY the expedition list (and, SF-1, counts the completed run).
    const base = { ...s, expeditions: [completeExpedition([{ id: "a", source: "anomaly" }])] };
    const res = claimExpedition(base, "expedition-1");
    const runCounts = { ...base.runCounts!, expedition: { ...base.runCounts!.expedition, completed: 1 } };
    expect(res.next).toEqual({ ...base, expeditions: [], runCounts });
  });

  it("a real expedition run end-to-end: claimed credits + vault tokens match its findings", () => {
    // A crewed-strong snapshot so ground tasks win and relics can roll; run through the real tick.
    let s = ensureMinimumAwayTeam(freshState()); // D18: a launchable ship
    const dispatched = dispatchPastPropulsion(s, "ship-1", 1, "cand-0");
    s = {
      ...dispatched.next,
      expeditions: dispatched.next.expeditions.map((e) => ({ ...e, securityStrength: 60, scienceStrength: 30, teamKit: 6 })),
      gameTimeSeconds: 10_000_000,
    };
    s = { ...s, expeditions: s.expeditions.map((e) => advanceExpedition(e, s.gameTimeSeconds)) };
    const exp = s.expeditions[0];
    expect(exp.phase).toBe("complete");
    const res = claimExpedition(s, exp.id);
    const sum = summarizeExpeditionFindings(exp.findings);
    expect(res.next.credits.minus(s.credits).toNumber()).toBe(sum.credits);
    expect(res.next.relicVault).toHaveLength(exp.findings.filter((f) => f.relic).length);
    for (const t of res.next.relicVault) expect(t.setId).toBe(relicSetForPoi(t.poiId));
  });
});

// ============================================================================
describe("RELIC STUDY: Research identifies a vault token on its own lane", () => {
  const withVault = (tokens: RelicVaultToken[]): GameState => ({ ...freshState(), relicVault: tokens });

  it("gates: notFound, noFacility, noSlot (one lane at Lab I and II)", () => {
    const s = withVault([token("t1", "precursor"), token("t2", "precursor")]);
    expect(canStartRelicStudy(s, "nope")).toEqual({ ok: false, reason: "notFound" });
    const noLab = { ...s, facilities: { ...s.facilities, research: { level: 0 } } };
    expect(relicStudySlotCount(noLab)).toBe(0);
    expect(canStartRelicStudy(noLab, "t1")).toEqual({ ok: false, reason: "noFacility" });
    expect(relicStudySlotCount(s)).toBe(1);
    expect(relicStudySlotCount({ ...s, facilities: { ...s.facilities, research: { level: 2 } } })).toBe(1);
    const first = startRelicStudy(s, "t1");
    expect(first.started).toBe(true);
    expect(canStartRelicStudy(first.next, "t2")).toEqual({ ok: false, reason: "noSlot" });
    const blocked = startRelicStudy(first.next, "t2");
    expect(blocked.started).toBe(false);
    expect(blocked.next).toBe(first.next); // same reference on a block
  });

  it("start consumes the token into the process (tier-scaled duration) and never blocks blueprint research", () => {
    const s = { ...withVault([token("t1", "shipwright", "radiant")]), credits: new Decimal(1_000_000) };
    const { next, started } = startRelicStudy(s, "t1");
    expect(started).toBe(true);
    expect(next.relicVault).toEqual([]);
    expect(next.nextRelicStudyIndex).toBe(s.nextRelicStudyIndex + 1);
    const procs = relicStudiesInFlight(next);
    expect(procs).toHaveLength(1);
    expect(procs[0].durationTicks).toBe(relicStudyDurationTicks("radiant"));
    expect(relicStudyDurationTicks("radiant")).toBeGreaterThan(relicStudyDurationTicks("standard"));
    expect(procs[0].effect).toEqual({ type: "identifyRelic", token: s.relicVault[0], studyIndex: 1, v: 2 }); // R2-3: the v2 stamp
    // Its OWN lane: blueprint research is still startable while the study runs.
    expect(canResearch(next, "frameSegmentBp")).toEqual({ ok: true });
  });

  it("completion identifies a relic WITHIN the token's set, deposits one museum copy, logs it, and replays equal", () => {
    const s = withVault([token("t1", "deepEarth", "augmented")]);
    const a = studyFirst(s);
    const b = studyFirst(s);
    expect(generalMuseumRecord(a)).toEqual(generalMuseumRecord(b)); // deterministic replay
    const ids = Object.keys(generalMuseumRecord(a));
    expect(ids).toHaveLength(1);
    expect(getRelicById(ids[0])!.setId).toBe("deepEarth");
    expect(generalMuseumRecord(a)[ids[0]]).toBe(1);
    expect(a.relicDiscovered).toEqual(ids);
    expect(relicStudiesInFlight(a)).toHaveLength(0);
    // The relic matches the pure keyed derivation, and the completion log names it.
    expect(identifyStudiedRelic(s, s.relicVault[0], 1)).toBe(ids[0]);
    const entry = a.completionLog[a.completionLog.length - 1];
    expect(entry.kind).toBe("relicStudy");
    expect(entry.reward).toBe("relic");
    expect(entry.subjectKey).toBe(ids[0]);
  });

  it("FIRST FIND registers exactly once, in first-find order, however many copies follow", () => {
    let s = withVault(Array.from({ length: 30 }, (_, i) => token(`t${i}`, "xenobiology")));
    const order: string[] = [];
    while (s.relicVault.length > 0) {
      const before = new Set(Object.keys(generalMuseumRecord(s)));
      s = studyFirst(s);
      for (const id of Object.keys(generalMuseumRecord(s))) if (!before.has(id)) order.push(id);
    }
    const copies = Object.values(generalMuseumRecord(s)).reduce((a, b) => a + b, 0);
    expect(copies).toBe(30);
    expect(Object.values(generalMuseumRecord(s)).some((c) => c > 1)).toBe(true); // repeats really happened
    expect(new Set(s.relicDiscovered).size).toBe(s.relicDiscovered.length); // never duplicated
    expect(s.relicDiscovered).toEqual(order); // ordered by first find
    expect([...s.relicDiscovered].sort()).toEqual(Object.keys(generalMuseumRecord(s)).sort());
  });

  it("tier skew: radiant tokens reveal far more rare/capstone relics than standard tokens", () => {
    const N = 2000;
    for (const set of RELIC_SETS) {
      const highShare = (tier: RelicVaultToken["tier"]) => {
        let high = 0;
        let low = 0;
        for (let i = 0; i < N; i++) {
          const rid = identifyRelic(set.id, tier, relicStudySeed(RELIC_DEFAULT_SEED, i + 1, `tok-${i}`))!;
          const r = getRelicById(rid)!.rarity;
          if (r === "rare" || r === "capstone") high++;
          else low++;
        }
        return { high: high / N, low: low / N };
      };
      const std = highShare("standard");
      const rad = highShare("radiant");
      expect(std.low).toBeGreaterThan(0.75); // standard mostly reveals the low-index relics
      expect(rad.high).toBeGreaterThan(0.55); // radiant has strong odds of rare/capstone
      expect(rad.high).toBeGreaterThan(std.high * 4);
    }
  });

  it("identification is a pure keyed function: same inputs, same relic; the token id is mixed in", () => {
    const seedA = relicStudySeed(RELIC_DEFAULT_SEED, 7, "tok-a");
    expect(identifyRelic("precursor", "stellar", seedA)).toBe(identifyRelic("precursor", "stellar", seedA));
    expect(relicStudySeed(RELIC_DEFAULT_SEED, 7, "tok-a")).not.toBe(relicStudySeed(RELIC_DEFAULT_SEED, 7, "tok-b"));
    expect(identifyRelic("notASet" as RelicSetId, "standard", 1)).toBeNull();
  });

  it("PARITY: one big tick span == stepped single ticks for a study completing mid-span", () => {
    const seed = (): GameState => startRelicStudy({ ...freshState(), relicVault: [token("t1", "precursor", "stellar")] }, "t1").next;
    const SPAN = relicStudyDurationTicks("stellar") + 50;
    const RNG = () => 0;
    const offline = tick(SPAN, seed(), RNG);
    let live = seed();
    for (let i = 0; i < SPAN; i++) live = economyTick(live, 1, RNG);
    const snap = (st: GameState) => ({
      relicMuseum: generalMuseumRecord(st),
      relicDiscovered: st.relicDiscovered,
      relicVault: st.relicVault,
      activeProcesses: st.activeProcesses,
      fleetAdminXp: st.fleetAdminXp.toString(),
      fleetAdminLevel: st.fleetAdminLevel,
    });
    expect(snap(offline)).toEqual(snap(live));
    // Non-vacuous: the study completed and FA XP was lumped (research-like XP policy).
    expect(Object.values(generalMuseumRecord(offline)).reduce((a, b) => a + b, 0)).toBe(1);
    expect(relicStudiesInFlight(offline)).toHaveLength(0);
    expect(offline.fleetAdminXp.gt(0) || offline.fleetAdminLevel > 1).toBe(true);
  });
});

// ============================================================================
describe("MUSEUM MATH: copy ladder, bottleneck tiers, bonuses", () => {
  it("the approved mockup's worked example: 45/41/22/18/0 -> 2p Lv3, 3p Lv2, 4p Lv1 (bottleneck relic 4), 5p locked", () => {
    const museum = { glyphTablet: 45, resonanceShard: 41, starChartFragment: 22, precursorLens: 18 };
    const tiers = setTierLevels(museum, "precursor");
    expect(tiers.map((t) => [t.pieces, t.level, t.locked])).toEqual([
      [2, 3, false],
      [3, 2, false],
      [4, 1, false],
      [5, 0, true],
    ]);
    // The 4-piece bottleneck is relic 4 (Precursor Lens, 18 copies), which needs 20 for the next level.
    expect(tiers[2]).toMatchObject({ bottleneckRelicId: "precursorLens", bottleneckCopies: 18, nextThreshold: 20, copiesToNextLevel: 2 });
    expect(tiers[0]).toMatchObject({ bottleneckRelicId: "resonanceShard", bottleneckCopies: 41, nextThreshold: 80 });
    expect(tiers[3]).toMatchObject({ bottleneckRelicId: "heartOfTheArchive", bottleneckCopies: 0, nextThreshold: 10 });
    expect(setCompletion(museum, "precursor")).toEqual({ setId: "precursor", collected: 4, total: 5, complete: false, totalCopies: 126 });
  });

  it("relicCopyLevel counts the ladder thresholds met [10, 20, 40, 80, 160]", () => {
    expect([0, 9, 10, 19, 20, 39, 40, 80, 159, 160, 9999].map(relicCopyLevel)).toEqual([0, 0, 1, 1, 2, 2, 3, 4, 4, 5, 5]);
  });

  it("museumBonuses sums per-copy passives + tier levels (additive), with the capstone magnitude", () => {
    const worked = museumBonusesFromRecord({ glyphTablet: 45, resonanceShard: 41, starChartFragment: 22, precursorLens: 18, geodeCore: 10, magmaPearl: 10 });
    expect(worked.researchSpeed).toBeCloseTo(126 * MUSEUM_PER_COPY_BONUS + 3 * MUSEUM_TIER_LEVEL_BONUS, 12);
    expect(worked.craftingQuality).toBeCloseTo(2 * MUSEUM_TIER_LEVEL_BONUS, 12);
    expect(worked.relicFindChance).toBeCloseTo(1 * MUSEUM_TIER_LEVEL_BONUS, 12);
    expect(worked.miningYield).toBeCloseTo(20 * MUSEUM_PER_COPY_BONUS, 12);
    expect(worked.rareMaterialChance).toBeCloseTo(1 * MUSEUM_TIER_LEVEL_BONUS, 12); // Deep Earth 2p Lv1
    expect(worked.extractionSpeed).toBe(0); // 3p locked (Deep-Vein Compass at 0)
    expect(worked.cargoCapacity).toBe(0);

    // A maxed Precursor set: the capstone adds a DOUBLE-magnitude boon to research speed + crafting quality.
    const maxed = museumBonusesFromRecord(Object.fromEntries(getRelicSetById("precursor")!.relicIds.map((r) => [r, 160])));
    const capstone = 5 * MUSEUM_TIER_LEVEL_BONUS * MUSEUM_CAPSTONE_MAGNITUDE;
    expect(maxed.researchSpeed).toBeCloseTo(800 * MUSEUM_PER_COPY_BONUS + 5 * MUSEUM_TIER_LEVEL_BONUS + capstone, 12);
    expect(maxed.craftingQuality).toBeCloseTo(5 * MUSEUM_TIER_LEVEL_BONUS + capstone, 12);
  });

  it("an empty museum reads ALL ZEROS over every MuseumStat (the additive-neutral E4b seam)", () => {
    const b = museumBonuses(freshState());
    expect(Object.keys(b).sort()).toEqual([...MUSEUM_STATS].sort());
    for (const stat of MUSEUM_STATS) expect(b[stat]).toBe(0);
  });
});

// ============================================================================
describe("ADDITIVE-NEUTRAL: an empty (or idle) relic store is byte-identical on the tick path", () => {
  const RELIC_KEYS = ["relicVault", "museumV2", "relicDiscovered", "relicSeed", "nextRelicStudyIndex"] as const;
  const strip = (s: GameState): GameState => {
    const out: any = { ...s };
    for (const k of RELIC_KEYS) delete out[k];
    return out;
  };

  it("a tick with the relic store equals a tick without it, store untouched (empty AND with an idle vault)", () => {
    for (const vault of [[], [token("t1", "precursor"), token("t2", "deepEarth", "radiant")]]) {
      const withStore: GameState = { ...freshState(), relicVault: vault };
      const a = tick(500, withStore, () => 0.5);
      const b = tick(500, strip(withStore), () => 0.5);
      expect(strip(a)).toEqual(b);
      for (const k of RELIC_KEYS) expect(a[k]).toEqual(withStore[k]);
    }
  });

  it("resolveProcesses with no study completing never even re-keys the relic fields", () => {
    const s = strip(freshState());
    const out = resolveProcesses({ ...s, activeProcesses: [] }, 10).next;
    expect("museumV2" in out).toBe(false);
  });
});

// ============================================================================
describe("SAVE migration v62 -> v63 seeds the relic store", () => {
  it("backfills an empty vault/museum/registry, the default seed, and the study index", () => {
    const s: any = freshState();
    for (const k of ["relicVault", "relicMuseum", "relicDiscovered", "relicSeed", "nextRelicStudyIndex"]) delete s[k];
    const migrated: any = migrate({ version: 62, created_at: 0, last_saved_at: 0, game_time_seconds: 0, state: s } as SaveFile);
    expect(migrated.relicVault).toEqual([]);
    // Relics v2 R2-1: the chain continues to v70, whose step moves the (empty) v1 museum into museumV2.
    expect("relicMuseum" in migrated).toBe(false);
    expect(migrated.museumV2).toEqual(emptyMuseumV2());
    expect(migrated.relicDiscovered).toEqual([]);
    expect(migrated.relicSeed).toBe(RELIC_DEFAULT_SEED);
    expect(migrated.nextRelicStudyIndex).toBe(1);
  });

  it("is idempotent: an existing store survives the migration untouched", () => {
    const s: any = { ...freshState(), relicVault: [token("t1", "shipwright")], relicMuseum: { hullRivet: 3 }, relicDiscovered: ["hullRivet"], relicSeed: 42, nextRelicStudyIndex: 9 };
    const migrated: any = migrate({ version: 62, created_at: 0, last_saved_at: 0, game_time_seconds: 0, state: s } as SaveFile);
    expect(migrated.relicVault).toEqual(s.relicVault);
    expect("relicMuseum" in migrated).toBe(false);
    expect(generalMuseumRecord(migrated)).toEqual({ hullRivet: 3 });
    expect(migrated.relicDiscovered).toEqual(["hullRivet"]);
    expect(migrated.relicSeed).toBe(42);
    expect(migrated.nextRelicStudyIndex).toBe(9);
  });
});

// ============================================================================
// E4c: the two per-tier / per-copy formulas the Museum UI reads are the SAME ones the fold applies, so the
// displayed "+X%" can never drift from the engine's bonus.
describe("museum display formulas (E4c): setTierBonus + setPerCopyBonus are the fold's own numbers", () => {
  it("setTierBonus is level x per-level bonus x magnitude, 0 for a locked / level-0 tier", () => {
    expect(setTierBonus({ level: 0, magnitude: 1 })).toBe(0);
    expect(setTierBonus({ level: 3, magnitude: 1 })).toBe(3 * MUSEUM_TIER_LEVEL_BONUS * 1);
    expect(setTierBonus({ level: 2, magnitude: MUSEUM_CAPSTONE_MAGNITUDE })).toBe(2 * MUSEUM_TIER_LEVEL_BONUS * MUSEUM_CAPSTONE_MAGNITUDE);
    expect(setPerCopyBonus(0)).toBe(0);
    expect(setPerCopyBonus(126)).toBe(126 * MUSEUM_PER_COPY_BONUS);
  });

  it("summing the per-tier + per-copy displays over a museum reproduces museumBonusesFromRecord exactly", () => {
    const museum = { glyphTablet: 45, resonanceShard: 41, starChartFragment: 22, precursorLens: 18, hullRivet: 12, flightRecorder: 3 };
    const expected = museumBonusesFromRecord(museum);
    const rebuilt: Record<string, number> = Object.fromEntries(MUSEUM_STATS.map((st) => [st, 0]));
    for (const set of RELIC_SETS) {
      const copies = setCompletion(museum, set.id).totalCopies;
      if (copies > 0) rebuilt[set.perCopyStat] += setPerCopyBonus(copies);
      for (const t of setTierLevels(museum, set.id)) {
        if (t.level <= 0) continue;
        for (const st of t.stats) rebuilt[st] += setTierBonus(t);
      }
    }
    expect(rebuilt).toEqual(expected);
    // The approved mockup's Precursor example: 2-piece Lv 3 (+1.5%), 3-piece Lv 2 (+1.0%), 4-piece Lv 1
    // (+0.5%), and 126 copies at +0.1% each on research speed.
    expect(expected.researchSpeed).toBeCloseTo(0.126 + 0.015, 10);
    expect(expected.craftingQuality).toBeCloseTo(0.01, 10);
    expect(expected.relicFindChance).toBeCloseTo(0.005, 10);
  });
});
