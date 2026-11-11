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
// WR-8b (enemy torpedoes) came after every pin here: the file runs with it off (enemyTorpedoSwitch.fixture.ts), so its
// pins keep proving their own slice (enemyTorpedoGoldens.test.ts pins what WR-8b moved, enemyTorpedoes.test.ts proves it).
import { enemyTorpedoesOffForThisFile } from "./enemyTorpedoSwitch.fixture";
enemyTorpedoesOffForThisFile();
// Wiring WR-10 (the away rules stamped at dispatch, a hire's account program) came after every pin here: the whole file
// runs with WR-10 off (wr10Switch.fixture.ts), so its pins keep proving their own slice (wr10Goldens.test.ts pins WR-10's).
import { wr10OffForThisFile } from "./wr10Switch.fixture";
wr10OffForThisFile();
import { cp16OffForThisFile } from "./cp16Switch.fixture";
// Complement CP-16 (the Hall of Command) came after every pin here: the file runs with the slice off, so its pins
// keep proving their own slice (cp16Goldens.test.ts pins what CP-16 moved: the missions counter, the notables and
// the Hall of Command entry).
cp16OffForThisFile();
import { WR11_SEEDS, WR11_VARIANT_SEEDS, wr11Candidates, wr11Hash, wr11Run, wr11SalvageRun, type Wr11Variant } from "./wr11.fixture";
import { getPlanetTypeById, getPoiById } from "./expeditionContent";
import { withWr11Off } from "./wr11Switch.fixture";

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

// The pins today. Each move names its reason; every one returns to BEFORE with WR-11 off (the last describe below).
// Every run: the dispatched record carries the site rules stamp (siteRules) and its ship-event profile no longer holds
// the two display copies (OC-G5), so every dispatch hash moves. Then, per run:
//   the done and claim hashes move with the site rules: Ocean surface work takes x1.25 (1234, 1244, 8b8b, bebe), the
//   material PoIs haul x1.25 materials, Buried Vault (x1.5) and Subterranean (x2) relic odds (3c3c, bebe, cfcf find one
//   more relic each), a charted anomaly brings home its small haul (8b8b, bebe, cfcf);
//   plain:2a2a's claim is unchanged: its one body is an Ocean world of Subterranean sites (no surface work, no extra
//   materials) and both relic rolls already hit, so only the dispatched and done records (the stamps) move;
//   museum: the stamp also carries the Museum's Science team power (museumSciencePower, OC-H1; the fixture's bare
//   Science member has no fieldwork of its own to scale, so it moves the record only);
//   sensors: the chart chance reads the frozen sensors 20 (56.7%; neither seed's roll lands below it).
const GOLDEN: Record<string, string[]> = {
  "plain:1234": ["a5a972e8","363cbcb5","2b3cd4f3"],
  "plain:1244": ["866f080f","15285832","c96579be"],
  "plain:2a2a": ["2387875a","69e5cd20","c41a3104"],
  "plain:3c3c": ["7144b2af","719e3c3e","25bd538d"],
  "plain:5e5e": ["1f4af7a4","4438c3cc","b29f69d6"],
  "plain:8b8b": ["dd8c70d2","dbd7f4f9","e29e0700"],
  "plain:bebe": ["60e733c","4476cad8","b2667cd0"],
  "plain:cfcf": ["b704db3e","ee81f3d1","34e04b51"],
  "museum:1234": ["f5372119","e5aa9d04","e680febc"],
  "museum:3c3c": ["d101f0fa","586ba8b2","468cf43c"],
  "sensors:1234": ["eb639f57","fd917849","4e1918c5"],
  "sensors:3c3c": ["a03c24e","4e571bde","2af10d8"],
};
// Every candidate list: the foreknowledge no longer carries the always-true relicSignature (WR-11, no call).
const GOLDEN_CANDIDATES: Record<string, string> = {
  "1234": "d3c7950e",
  "1244": "9b67311",
  "2a2a": "47f28a7e",
  "3c3c": "c5b0c924",
  "5e5e": "fe9005ee",
  "8b8b": "eabaa1b6",
  "bebe": "f369c455",
  "cfcf": "3c8cde6a",
};
// talent: the talent's tier of reach past the top tilts the tiers upward (OC-J1), so the drops climb, and each log
// entry names its loot tier (OC-J2). control: FA 40 without the talent has no talent reach to tilt (RR-7's reserved
// fifth-tier row stays reserved), so the same drops land; only the log entries gain their loot tier (OC-J2).
const GOLDEN_SALVAGE: Record<"talent" | "control", string> = { talent: "5b83effc", control: "7a094171" };

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
  it("salvage control: without the talent the drops are the pre-WR-11 drops (only the log moved)", () => {
    expect(wr11SalvageRun(false).inventory).toEqual(withWr11Off(() => wr11SalvageRun(false)).inventory);
  });
});

describe("WR-11 goldens with WR-11 off (wr11Switch.fixture.ts): every moved pin returns to its capture", () => {
  for (const [seed, variant] of RUNS) {
    it(`${runKey(seed, variant)} reproduces BEFORE`, () => {
      expect(withWr11Off(() => wr11Run(seed, variant).out)).toEqual(BEFORE[runKey(seed, variant)]);
    });
  }
  it("every candidate list reproduces BEFORE", () => {
    for (const seed of WR11_SEEDS) expect(withWr11Off(() => wr11Candidates(seed))).toBe(BEFORE_CANDIDATES[seed.toString(16)]);
  });
  it("both salvage strings reproduce BEFORE", () => {
    expect(withWr11Off(() => wr11Hash(wr11SalvageRun(true)))).toBe(BEFORE_SALVAGE.talent);
    expect(withWr11Off(() => wr11Hash(wr11SalvageRun(false)))).toBe(BEFORE_SALVAGE.control);
  });
});
