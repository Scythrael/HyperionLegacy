// Wiring WR-11 (docs/plans/2026-10-15-wiring-registry-and-audit-plan.md section 4 WR-11, its OC-G / OC-H / OC-I / OC-J
// user answers): golden hashes captured on the code BEFORE the engine edit (on top of a158982). The fixtures
// (wr11.fixture.ts) are real Ground Ops runs over a spread of seeds (Ocean surface work, the PoIs whose flavor names a
// reward, charted anomalies, a gas giant), two of them again with a Museum holding Science team power and with a sensor
// array installed, the candidate lists the console shows, and a string of material salvages one tier past the top of the
// loot pool (with the salvage talent) and without it (the control).
//
// The WR-11 wiring commit re-pins ONLY what WR-11 moves (GOLDEN), each with its reason beside it, and proves the move with
// WR-11 switched off (wr11Switch.fixture.ts withWr11Off): every fixture then reproduces its capture (BEFORE).

import { describe, expect, it } from "vitest";
import { WR11_SEEDS, WR11_VARIANT_SEEDS, wr11Candidates, wr11Hash, wr11Run, wr11SalvageRun, type Wr11Variant } from "./wr11.fixture";
import { getPlanetTypeById, getPoiById } from "./expeditionContent";

const runKey = (seed: number, variant: Wr11Variant) => `${variant}:${seed.toString(16)}`;

// Captured on the code BEFORE the engine edit (a158982).
const BEFORE: Record<string, string[]> = {
  "plain:1234": ["8d9c5827","a71ee5f0","392d7904"],
  "plain:1244": ["16e80ea4","233a920d","293ad8e7"],
  "plain:2a2a": ["6b95152f","dbed9023","c41a3104"],
  "plain:3c3c": ["438337ae","f68a0c7f","6d2f2ec3"],
  "plain:5e5e": ["6af840d1","8c86a769","c1f03d5c"],
  "plain:8b8b": ["2e07b399","f1396355","33fb488f"],
  "plain:bebe": ["d8c6a669","58c7d358","8047b6ce"],
  "plain:cfcf": ["8df37efb","4d1ccda8","419d3b36"],
  "museum:1234": ["6d802708","5c1928c2","11808e9d"],
  "museum:3c3c": ["c4c0b47f","8f44fcdf","6a3796a"],
  "sensors:1234": ["d00d165c","812cc0a0","e59103ed"],
  "sensors:3c3c": ["72065f23","d46cae74","81b9ef98"],
};
const BEFORE_CANDIDATES: Record<string, string> = {
  "1234": "94e677b6",
  "1244": "b8467fd9",
  "2a2a": "5b26186",
  "3c3c": "1678656c",
  "5e5e": "cd7cf6",
  "8b8b": "db26200e",
  "bebe": "16924a7d",
  "cfcf": "3debb9e2",
};
const BEFORE_SALVAGE: Record<"talent" | "control", string> = { talent: "f881a381", control: "3a7c8dfd" };

// The pins today. Each move names its reason; an unchanged pin equals BEFORE.
const GOLDEN: Record<string, string[]> = { ...BEFORE };
const GOLDEN_CANDIDATES: Record<string, string> = { ...BEFORE_CANDIDATES };
const GOLDEN_SALVAGE: Record<"talent" | "control", string> = { ...BEFORE_SALVAGE };

const RUNS: [number, Wr11Variant][] = [
  ...WR11_SEEDS.map((s) => [s, "plain"] as [number, Wr11Variant]),
  ...WR11_VARIANT_SEEDS.map((s) => [s, "museum"] as [number, Wr11Variant]),
  ...WR11_VARIANT_SEEDS.map((s) => [s, "sensors"] as [number, Wr11Variant]),
];

describe("WR-11 goldens (captured before the expedition, relic and salvage leftovers)", () => {
  it("the fixtures hold what WR-11 touches", () => {
    const runs = WR11_SEEDS.map((s) => wr11Run(s).done);
    const acts = runs.flatMap((d) => d.bodies.flatMap((b) => b.activities.map((a) => ({ planet: b.planetType, poi: a.poiId }))));
    expect(acts.some((a) => a.planet === "ocean" && getPoiById(a.poi)?.pool === "surface")).toBe(true);
    for (const poi of ["buriedVault", "subterraneanCivilization", "xenoFloraBloom", "geothermalChamber", "derelictOutpost", "crashedShip"]) {
      expect(acts.some((a) => a.poi === poi), poi).toBe(true);
    }
    expect(runs.some((d) => d.anomalyCharted)).toBe(true);
    expect(runs.some((d) => d.bodies.some((b) => getPlanetTypeById(b.planetType)?.orbitalOnly))).toBe(true);
    expect(wr11Run(WR11_VARIANT_SEEDS[0], "sensors").exp.sensorPower).toBeGreaterThan(0);
  });

  for (const [seed, variant] of RUNS) {
    it(`${runKey(seed, variant)}: a Ground Ops run (dispatch, end, claim)`, () => {
      const { exp, out } = wr11Run(seed, variant);
      expect(exp.groundOps).toBeDefined();
      expect(out).toEqual(GOLDEN[runKey(seed, variant)]);
    });
  }

  for (const seed of WR11_SEEDS) {
    it(`candidates ${seed.toString(16)}: the console's candidate list and foreknowledge`, () => {
      expect(wr11Candidates(seed)).toBe(GOLDEN_CANDIDATES[seed.toString(16)]);
    });
  }

  it("salvage: forty Damaged Weapon System salvages with one tier of reach past the pool's top", () => {
    expect(wr11Hash(wr11SalvageRun(true))).toBe(GOLDEN_SALVAGE.talent);
  });
  it("salvage control: the same salvages without the talent (no reach past the top)", () => {
    expect(wr11Hash(wr11SalvageRun(false))).toBe(GOLDEN_SALVAGE.control);
  });
});
