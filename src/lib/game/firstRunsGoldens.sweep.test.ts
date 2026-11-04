// Safe First Runs SF-0 (docs/plans/2026-10-15-safe-first-runs-plan.md section 4 SF-0, item 3): the section 2.5 B
// outcome table pinned on the code BEFORE any safe-first-runs engine edit (on top of bfac15f). 60 Tier I seeds (the
// save's expedition seed set to makeExpeditionSeed(0x1234567, i), candidate 0 dispatched as the shakedown), each crew
// row of the table, advanced in one call to 3,000,000 s (firstRunsGoldens.fixture.ts rebuilds the section 2.5 method).
// Its own file because the whole table is slow (about 35 s): the default run pins 7 seeds of every row (DEFAULT_SEEDS,
// about 4 s); all 60 seeds and the sums run only under the measurement gate (SF_SWEEP set, or `npm run test:sweep`).
// Every test runs at most 4 seeds and stays well under 2 s.
//
// Each seed pins a code (S stalled, L any lost fight, H hull damage, B a ship-event setback, V a Vault or Subterranean
// site, K stuck on a Vault or Subterranean site; "." for none) and the hash of the whole run at 3,000,000 s. The last
// test sums the PINNED codes (no rerun) and checks them against the plan's table, number for number.

import { describe, expect, it } from "vitest";
import { cp14OffForThisFile } from "./cp14Switch.fixture";
// Complement CP-14 (hull base sensors and Science amplification) came after every pin here: the file runs with the
// slice off, so its pins keep proving their own slice (cp14Goldens.test.ts pins what CP-14 moved).
cp14OffForThisFile();
import type { ShipTypeKey } from "./model";
import { advanceExpedition, makeExpeditionSeed, startExpedition } from "./expedition";
import { hash, onHull, VAULT_SITES, runOutcome, SWEEP, SWEEP_END, withCrew, type CrewName } from "./firstRunsGoldens.fixture";
import { asPreG2NamesDispatch, asPreRanksDispatch, asPreSafeFirstRunsDispatch } from "./awayTeamTestFixtures";
// WR-8 (0.14.0): every pin in this file was taken before the combat rules (combatRulesSwitch.fixture.ts), so the file
// runs with them switched off and its pins keep proving WR-8 moved nothing else here (the rules stamp new patrol
// cycles and runs; combatDescriptorGoldens.test.ts pins the combat rules themselves).
import { combatRulesOffForThisFile } from "./combatRulesSwitch.fixture";
import { wr11OffForThisFile } from "./wr11Switch.fixture";
combatRulesOffForThisFile();
// Wiring WR-11 came after every pin here: the whole file runs with WR-11 off (wr11Switch.fixture.ts), so its pins keep
// proving their own slice moved nothing else (WR-11's own moves are pinned in wr11Goldens.test.ts).
wr11OffForThisFile();

const SEEDS = 60;
const CHUNK = 3;
// The default run's seeds: a spread over the table's outcomes (stalled and finished, with and without hull damage,
// setbacks and Vault sites).
const DEFAULT_SEEDS: number[][] = [[3, 13, 15, 23], [27, 31, 39]];

// The section 2.5 B rows: [label, hull, crew].
const ROWS: [string, ShipTypeKey, CrewName][] = [
  ["orion:d18", "orion", "d18"],
  ["orion:rank1", "orion", "rank1"],
  ["orion:rank3", "orion", "rank3"],
  ["orion:rank6", "orion", "rank6"],
  ["aurora:rank1", "aurora", "rank1"],
  ["eir:rank1", "eir", "rank1"],
];

// The plan's section 2.5 B table (stalled, any lost fight, hull damage, ship-event setback, Vault or Subterranean
// present) plus one column SF-0 adds: stuck on a Vault or Subterranean site. The plan's "every stalled run stalls on a
// Vault or Subterranean site" holds on the full-rank Orion and Aurora rows; the D18 minimum crew also stalls on 8 seeds
// with no such site (it loses ordinary fights), and Eir rank 1 on 2 seeds elsewhere.
const TABLE_B: Record<string, [number, number, number, number, number, number]> = {
  "orion:d18": [57, 58, 21, 35, 49, 49],
  "orion:rank1": [40, 56, 21, 35, 49, 40],
  "orion:rank3": [24, 51, 21, 35, 49, 24],
  "orion:rank6": [15, 49, 21, 35, 49, 15],
  "aurora:rank1": [40, 56, 21, 35, 49, 40],
  "eir:rank1": [24, 50, 21, 35, 49, 22],
};

// Captured on the code BEFORE any safe-first-runs engine edit (SF-0, on top of bfac15f).
const GOLDEN: Record<string, string[]> = {
  "orion:d18": [
    "0:SL.BVK:bf4aaefd", "1:SL..VK:43a5fc2b", "2:SL..VK:25afbe1a", "3:SLHBVK:8cf08ae4",
    "4:SL..VK:ccb4c095", "5:SL..VK:beb43919", "6:SL.BVK:830070e0", "7:SL..VK:e4f9b730",
    "8:SL..VK:ec2b261", "9:SL.BVK:abb25e86", "10:SLHBVK:7a1e5110", "11:SL.BVK:2434e8b7",
    "12:SLHBVK:8ca08ee0", "13:SLHBVK:7a5367a", "14:SL..VK:725d6569", "15:SL.B..:b6622efc",
    "16:SLHBVK:411aa16d", "17:SLHBVK:87b1e74a", "18:SL..VK:476a8c26", "19:SLHBVK:d21b4b77",
    "20:SLHBVK:672dedfb", "21:SL..VK:4c23c315", "22:SL..VK:9d68c6aa", "23:SLHBVK:83fa34c6",
    "24:SLHBVK:ef5e88d9", "25:.L....:3dfc30ce", "26:SL..VK:a81841df", "27:SL....:69d5f5d",
    "28:SL....:bd78adeb", "29:SL..VK:88fbcfce", "30:SL....:b4bf6946", "31:SLHB..:69f6f67d",
    "32:SL..VK:7210a170", "33:SL..VK:8b614e5c", "34:......:c820e121", "35:SL..VK:a10d2c20",
    "36:...B..:d356f499", "37:SLHBVK:dde42219", "38:SL.BVK:987f9bb5", "39:SLHBVK:732b5d6d",
    "40:SL..VK:1241c75c", "41:SLHBVK:e2687e50", "42:SL..VK:f00b5a95", "43:SL.B..:12f99267",
    "44:SL.BVK:9d87c6f2", "45:SL..VK:49a3dcdf", "46:SL....:cef50879", "47:SL.B..:6bb4a93c",
    "48:SL.BVK:e55b2673", "49:SL.BVK:a2aa1e9e", "50:SLHBVK:b4a4c15d", "51:SL..VK:7f7b59b1",
    "52:SLHBVK:ed7372c4", "53:SLHBVK:190da3cb", "54:SL.BVK:3af5c2f0", "55:SLHBVK:5f39a47d",
    "56:SL.BVK:329e1ce8", "57:SLHBVK:cc6744e2", "58:SLHBVK:9ae68c05", "59:SLHBVK:61734649",
  ],
  "orion:rank1": [
    "0:SL.BVK:a8870d1f", "1:SL..VK:7062cc5d", "2:SL..VK:ac09f698", "3:SLHBVK:4841e9f8",
    "4:SL..VK:7cf9f36b", "5:.L..V.:e3ca3ffa", "6:.L.BV.:2acff773", "7:SL..VK:4aae21e5",
    "8:.L..V.:e22a2767", "9:SL.BVK:5705be30", "10:SLHBVK:81348062", "11:SL.BVK:515109c2",
    "12:SLHBVK:14310794", "13:SLHBVK:15e07b9e", "14:SL..VK:5a098df2", "15:.L.B..:efb7eef6",
    "16:SLHBVK:33c051c", "17:SLHBVK:a63aefcb", "18:SL..VK:d517a434", "19:SLHBVK:d0148ffb",
    "20:SLHBVK:15c9e9cf", "21:.L..V.:d431dd23", "22:.L..V.:4077b1af", "23:SLHBVK:c172456",
    "24:SLHBVK:72061df8", "25:......:f221f7e1", "26:SL..VK:78f8e15c", "27:.L....:aecbe7fc",
    "28:.L....:664aca5e", "29:SL..VK:385f0ddc", "30:.L....:af3d893c", "31:.LHB..:8fb49e7a",
    "32:.L..V.:33b0c744", "33:SL..VK:f128edaf", "34:......:497c491d", "35:.L..V.:91201f48",
    "36:...B..:7b37337b", "37:SLHBVK:788e3ac4", "38:SL.BVK:9a954362", "39:..HBV.:2345836",
    "40:SL..VK:fdade9c0", "41:SLHBVK:5390af29", "42:SL..VK:27742b9d", "43:.L.B..:2aa41649",
    "44:SL.BVK:3d84343f", "45:SL..VK:4464a9b4", "46:.L....:f70579e5", "47:.L.B..:1051d403",
    "48:SL.BVK:b0c3529", "49:.L.BV.:8217f983", "50:SLHBVK:15a35a4", "51:SL..VK:36158564",
    "52:SLHBVK:5d2b8cb9", "53:SLHBVK:5af937ea", "54:SL.BVK:38e6596e", "55:SLHBVK:3ff06b9f",
    "56:SL.BVK:5bc5ec1b", "57:SLHBVK:3a226d70", "58:SLHBVK:a6a8aa73", "59:SLHBVK:4999a38",
  ],
  "orion:rank3": [
    "0:SL.BVK:d01d283f", "1:.L..V.:2f71f6e3", "2:.L..V.:30f4c030", "3:.LHBV.:d0e93e2e",
    "4:SL..VK:d5881eec", "5:.L..V.:ae82d3f9", "6:...BV.:d91f84a9", "7:SL..VK:56fc52a5",
    "8:.L..V.:2b1fdea8", "9:SL.BVK:bf366818", "10:SLHBVK:dcde1947", "11:SL.BVK:3636eaf5",
    "12:.LHBV.:adce098d", "13:.LHBV.:37d945f1", "14:.L..V.:ef5b4586", "15:.L.B..:191de91b",
    "16:SLHBVK:e9b9ad64", "17:.LHBV.:60183ad6", "18:SL..VK:a25e8d0f", "19:SLHBVK:710e4743",
    "20:SLHBVK:6c277558", "21:.L..V.:4504c8e6", "22:.L..V.:30221c74", "23:SLHBVK:e3fec0a4",
    "24:SLHBVK:64b9622e", "25:......:825641f6", "26:SL..VK:cad54fd1", "27:......:3d9d80d4",
    "28:.L....:b07c699a", "29:.L..V.:2f84c054", "30:......:fc8b2933", "31:.LHB..:5a839347",
    "32:.L..V.:fe9ebcd", "33:SL..VK:8efce743", "34:......:ad9bcb2f", "35:....V.:eca86f64",
    "36:...B..:d8bbad15", "37:.LHBV.:2c4e50c2", "38:SL.BVK:b73f9c29", "39:..HBV.:3d20a473",
    "40:.L..V.:2eb4a982", "41:SLHBVK:8636c42b", "42:SL..VK:e05865a9", "43:...B..:4530bf30",
    "44:SL.BVK:75b2a753", "45:.L..V.:3b2b3adb", "46:.L....:3138f000", "47:.L.B..:53b71da1",
    "48:SL.BVK:14fbf047", "49:.L.BV.:5c109f89", "50:SLHBVK:ddfefeb4", "51:.L..V.:f6e3446",
    "52:.LHBV.:cb4365ff", "53:.LHBV.:c4ee79cf", "54:.L.BV.:ad4ae648", "55:SLHBVK:1946341d",
    "56:SL.BVK:54126007", "57:SLHBVK:799de539", "58:SLHBVK:de3aa341", "59:.LHBV.:61444663",
  ],
  "orion:rank6": [
    "0:.L.BV.:4918e41c", "1:.L..V.:5876b35d", "2:.L..V.:229615f5", "3:.LHBV.:5c1af141",
    "4:SL..VK:eae4ecc0", "5:.L..V.:b57ac082", "6:...BV.:8576ad63", "7:SL..VK:6744caeb",
    "8:....V.:117ac1e1", "9:SL.BVK:f5ca6c6c", "10:.LHBV.:de6702e4", "11:SL.BVK:4afa3aa6",
    "12:.LHBV.:1649b61b", "13:.LHBV.:64d33c2e", "14:.L..V.:c4815994", "15:.L.B..:6a459387",
    "16:SLHBVK:45f32754", "17:.LHBV.:ec73b185", "18:.L..V.:9d795c5e", "19:SLHBVK:f7ed03a",
    "20:.LHBV.:f63bd4be", "21:.L..V.:9eb2b781", "22:.L..V.:993e14f6", "23:.LHBV.:418586df",
    "24:SLHBVK:5d98226d", "25:......:cd533d65", "26:.L..V.:8b7cf34e", "27:......:457ddd89",
    "28:.L....:88fca72a", "29:.L..V.:ad3bdb6a", "30:......:5ff11d9c", "31:.LHB..:d34b4dbf",
    "32:.L..V.:8a240ffb", "33:.L..V.:72374cb3", "34:......:93579ca5", "35:....V.:3db7529",
    "36:...B..:376550a3", "37:.LHBV.:bb2dc4b4", "38:SL.BVK:d057854c", "39:..HBV.:7f9cbd22",
    "40:.L..V.:5100d256", "41:SLHBVK:f736b41b", "42:SL..VK:61c8ef6c", "43:...B..:c073d51a",
    "44:SL.BVK:15aad4d2", "45:....V.:f8fe02dc", "46:.L....:f739e7d2", "47:.L.B..:3279dde8",
    "48:.L.BV.:d9373b8c", "49:.L.BV.:50ef133", "50:SLHBVK:b6f2674", "51:.L..V.:4918381b",
    "52:.LHBV.:19af75e2", "53:.LHBV.:e335f987", "54:.L.BV.:434bf1ab", "55:SLHBVK:1de0ce69",
    "56:SL.BVK:a6e0e4f7", "57:.LHBV.:ff3ef37e", "58:SLHBVK:3302a6ec", "59:.LHBV.:10b2c291",
  ],
  "aurora:rank1": [
    "0:SL.BVK:cd7029ed", "1:SL..VK:df1f9d9f", "2:SL..VK:f470a8e6", "3:SLHBVK:5e41a32a",
    "4:SL..VK:653d0459", "5:.L..V.:4c3096f0", "6:.L.BV.:ab91706f", "7:SL..VK:797d380b",
    "8:.L..V.:738f7363", "9:SL.BVK:60aae71a", "10:SLHBVK:aef3ede6", "11:SL.BVK:d6602f5e",
    "12:SLHBVK:c717d5e6", "13:SLHBVK:bad2fcbe", "14:SL..VK:c3f77a7e", "15:.L.B..:28004202",
    "16:SLHBVK:310f3abc", "17:SLHBVK:8fb846d", "18:SL..VK:ff2ca782", "19:SLHBVK:86182855",
    "20:SLHBVK:f557db5f", "21:.L..V.:eba4aa8d", "22:.L..V.:b1add5db", "23:SLHBVK:334c09ec",
    "24:SLHBVK:43ae6e38", "25:......:bc1daadb", "26:SL..VK:65e701a0", "27:.L....:c14b3e42",
    "28:.L....:a4eb3aa0", "29:SL..VK:8c12b2e8", "30:.L....:abdb4ad2", "31:.LHB..:834dfb5e",
    "32:.L..V.:1de44348", "33:SL..VK:aad15b45", "34:......:c68586f9", "35:.L..V.:e7aad304",
    "36:...B..:99a3b6b5", "37:SLHBVK:2325f5e", "38:SL.BVK:a63dc13c", "39:..HBV.:900a4c70",
    "40:SL..VK:717e1864", "41:SLHBVK:198da12b", "42:SL..VK:66f68fef", "43:.L.B..:d17acda5",
    "44:SL.BVK:be186021", "45:SL..VK:7a44ecbe", "46:.L....:5f585f29", "47:.L.B..:a2a68171",
    "48:SL.BVK:40adfddf", "49:.L.BV.:ee452b31", "50:SLHBVK:e95e77ac", "51:SL..VK:2999a1d0",
    "52:SLHBVK:9cc1579d", "53:SLHBVK:7af9ee0c", "54:SL.BVK:36341760", "55:SLHBVK:a337a609",
    "56:SL.BVK:bae9e797", "57:SLHBVK:40c5bbb6", "58:SLHBVK:7bdb6ee1", "59:SLHBVK:aac9c2c6",
  ],
  "eir:rank1": [
    "0:.L.BV.:415c7461", "1:.L..V.:be67ba43", "2:.L..V.:31ec5412", "3:.LHBV.:72888c5e",
    "4:SL..VK:10c5d45a", "5:SL..VK:94e8d341", "6:...BV.:60cb7b69", "7:SL..VK:67bded67",
    "8:.L..V.:78ed0a76", "9:SL.BVK:79bbe326", "10:SLHBVK:31db9b14", "11:SL.BVK:16d65709",
    "12:.LHBV.:ae5a1357", "13:SLHBV.:c8e3fe9a", "14:SL..VK:e0b25519", "15:.L.B..:5ba6c236",
    "16:SLHBVK:27761dba", "17:.LHBV.:298f6016", "18:SL..VK:4224735", "19:SLHBVK:fc4892f",
    "20:.LHBV.:7b846256", "21:....V.:f33162d6", "22:.L..V.:94c93558", "23:SLHBV.:f581ce91",
    "24:SLHBVK:39d339ae", "25:......:f0b1ab8f", "26:.L..V.:db677f97", "27:......:bc7a6282",
    "28:.L....:e6c40e97", "29:.L..V.:29d5c293", "30:.L....:bd91e3f", "31:.LHB..:5dd07c",
    "32:.L..V.:1c2b6918", "33:.L..V.:cbe544ba", "34:......:3360a995", "35:....V.:162ab90a",
    "36:...B..:957908b3", "37:.LHBV.:b2a5ff36", "38:SL.BVK:64f1fb45", "39:SLHBVK:420709d8",
    "40:.L..V.:322c937", "41:SLHBVK:f7413935", "42:SL..VK:ec2df191", "43:...B..:b924b1be",
    "44:SL.BVK:42e648ba", "45:....V.:2ec4e3bb", "46:......:aaae94a7", "47:.L.B..:92b941a5",
    "48:.L.BV.:20e9634c", "49:.L.BV.:c24ea107", "50:SLHBVK:de2ed747", "51:.L..V.:fc03d4d7",
    "52:SLHBVK:8e8f0997", "53:SLHBVK:d17ea6c8", "54:.L.BV.:a3ec3f41", "55:SLHBVK:36ec665a",
    "56:SL.BVK:3ec7b399", "57:.LHBV.:901c61d6", "58:SLHBVK:80a87791", "59:.LHBV.:75b4c212",
  ],
};

function code(seed: number, hull: ShipTypeKey, crew: CrewName): string {
  // Field Kits FKR-1: the run as dispatched before enemy ranks (the flag off), so the section 2.5 B table keeps its capture.
  // Safe first runs SF-2: and as dispatched before SF-2 (no training stamp, the 30 minute shakedown), so this table stays
  // the NOMINAL Tier I record SF-3's ramp is measured against; the training run's proof is safeFirstExpedition.sweep.
  const res = asPreG2NamesDispatch(asPreSafeFirstRunsDispatch(asPreRanksDispatch(startExpedition(withCrew(onHull(hull, makeExpeditionSeed(0x1234567, seed)), crew), "ship-1", 1, "cand-0"))));
  if (!res.success || !res.expedition) throw new Error(`dispatch refused: ${res.reason}`);
  expect(res.expedition.shakedown).toBe(true);
  const done = advanceExpedition(res.expedition, SWEEP_END);
  const o = runOutcome(done);
  const flags = [
    o.stalled ? "S" : ".",
    o.lostFights > 0 ? "L" : ".",
    o.hullDamage > 0 ? "H" : ".",
    o.setbacks > 0 ? "B" : ".",
    o.vaultSites > 0 ? "V" : ".",
    o.stuck.some((poi) => VAULT_SITES.has(poi)) ? "K" : ".",
  ].join("");
  return `${seed}:${flags}:${hash(done)}`;
}

describe("SF-0 section 2.5 B: 7 of the 60 Tier I shakedowns per crew row (the default run)", () => {
  for (const [label, hull, crew] of ROWS) {
    for (const seeds of DEFAULT_SEEDS) {
      it(`${label}: seeds ${seeds.join(", ")}`, () => {
        expect(seeds.map((seed) => code(seed, hull, crew))).toEqual(seeds.map((seed) => GOLDEN[label][seed]));
      });
    }
  }
});

describe.runIf(SWEEP)("SF-0 section 2.5 B (gated): 60 Tier I shakedowns per crew row and the table's sums", () => {
  for (const [label, hull, crew] of ROWS) {
    for (let from = 0; from < SEEDS; from += CHUNK) {
      it(`${label}: seeds ${from} to ${from + CHUNK - 1}`, () => {
        const out: string[] = [];
        for (let seed = from; seed < from + CHUNK; seed++) out.push(code(seed, hull, crew));
        expect(out).toEqual(GOLDEN[label].slice(from, from + CHUNK));
      });
    }
  }

  it("the pinned codes sum to the plan's section 2.5 B table", () => {
    for (const [label] of ROWS) {
      const codes = GOLDEN[label].map((c) => c.split(":")[1]);
      expect(codes.length).toBe(SEEDS);
      const sums = ["S", "L", "H", "B", "V", "K"].map((f, i) => codes.filter((c) => c[i] === f).length);
      expect(sums, label).toEqual(TABLE_B[label]);
    }
  });
});
