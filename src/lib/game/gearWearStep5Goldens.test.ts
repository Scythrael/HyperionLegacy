// GEAR WEAR step 5 GOLDENS FIRST (docs/plans/2026-10-16-gear-wear-design.md sections 10 and 11 step 5; the SF-7 note:
// "a patrol records no use event today. When step 5 adds one, skip the training cycle"). The patrols step 5 touches,
// captured on the code BEFORE any step 5 engine edit (feat 8d3809b), through the real dispatch
// (dispatchCaptainOnPatrol) and the live economyTick loop in 1 s ticks, nothing edited after dispatch, on a patrol
// veteran save with every live slice ON:
//
//   patrol:<variant>:<hull>:<route>:<once|repeat> : the dispatch record, each relaunch (its tick, record and state),
//                   the outcome and its tick, the ship, the state and ship-1's piece conditions at the end. Variants:
//                   `si` (Standard Issue, pristine) and `worn` (ship-1's pieces preset worn), four hulls x both routes x
//                   Dispatch Once and Repeatedly; `crew` (a destroyer with a crew aboard: its crew modules wear too).
//
// PRE (below) is that capture. With the step 5 switch OFF (patrolUseWearSwitch.fixture.ts: no patrol is use-stamped)
// every row reproduces PRE byte for byte, and a patrol DISPATCHED inside the switch (a run in flight at the update)
// and then flown by the live engine reproduces it too. LIVE is the step 5 engine; each row that moved is named in
// MOVES with why. A training cycle (the save's first patrol) records no use wear (W9, SF-7).

import { describe, expect, it } from "vitest";
import { cp16OffForThisFile } from "./cp16Switch.fixture";
// Complement CP-16 is unrelated to these pins (it only adds the missions counter and notables): off, as every gear wear
// golden file runs it.
cp16OffForThisFile();
import { writeFileSync } from "node:fs";
import Decimal from "break_infinity.js";
import { PATROLS, type GameState, type PatrolKey, type PatrolMissionState, type ShipTypeKey } from "./model";
import { dispatchCaptainOnPatrol, economyTick } from "./tick";
import { hash, onHull, stateHash } from "./firstRunsGoldens.fixture";
import { asPatrolVeteran } from "./awayTeamTestFixtures";
import { pieceCondition, withPieceCondition } from "./gearWear";
import * as wearEngine from "./gearWearEngine";

const HULLS: ShipTypeKey[] = ["generalFreighter", "destroyer", "battleship", "carrier"];
const ROUTES = Object.keys(PATROLS) as PatrolKey[];
const RNG = (): number => 0.5;
const MAX_CYCLES = 3;
const CAPTURE = import.meta.env.GW5_CAPTURE as string | undefined;

const WORN: Readonly<Record<string, number>> = {
  weapon: 700,
  reactorCore: 760,
  ftlDrive: 820,
  shieldEmitters: 650,
  hullPlating: 600,
  droneBay: 680,
  specUtility: 750,
  module: 700,
  cargoBay: 900,
  sensor: 900,
  bridge: 880,
  quarters: 880,
};

// The step 5 switch, read through the module so this file also runs on the pre-step-5 engine (the capture).
function useWearOff<T>(run: () => T): T {
  const sw = (wearEngine as unknown as { PATROL_USE_WEAR_SWITCH?: { live: boolean } }).PATROL_USE_WEAR_SWITCH;
  if (sw === undefined) return run();
  const was = sw.live;
  sw.live = false;
  try {
    return run();
  } finally {
    sw.live = was;
  }
}

const patrolOf = (s: GameState): PatrolMissionState | null => s.captains[0].mission as PatrolMissionState | null;

type Variant = "si" | "worn" | "crew";

function base(hull: ShipTypeKey, variant: Variant): GameState {
  let s = asPatrolVeteran({ ...onHull(hull), nextPatrolSeed: 1, credits: new Decimal(100_000) });
  if (variant === "worn") {
    s = { ...s, equipment: s.equipment.map((e) => (e.fittedToShipId === "ship-1" && WORN[e.slotType] !== undefined ? withPieceCondition(e, WORN[e.slotType], s.gameTimeSeconds) : e)) };
  }
  if (variant === "crew") {
    s = { ...s, ships: s.ships.map((sh) => (sh.id === "ship-1" ? { ...sh, complement: { buckets: [{ profession: "operations", rarity: "standard", rank: 3, race: "earthBorn", buff1Id: "ops.loadSpeed", buff2Id: "ops.unloadSpeed", count: 4 }], mode: "passive" } } : sh)) };
  }
  return s;
}

function conditions(s: GameState): string {
  return s.equipment
    .filter((e) => e.fittedToShipId === "ship-1")
    .map((e) => `${e.slotType}=${pieceCondition(e)}`)
    .join(" ");
}

// One patrol, 1 s ticks until the captain idles (Once) or MAX_CYCLES cycles started (Repeat: then recalled home).
// `inFlight`: dispatched inside the step 5 switch (a run from before step 5), then flown by the live engine.
function patrolRun(state: GameState, key: PatrolKey, repeat: boolean, label: string, mode: "live" | "off" | "inFlight"): string[] {
  const go = () => dispatchCaptainOnPatrol(state, 1, key, "balanced", repeat);
  const r = mode === "live" ? go() : useWearOff(go);
  expect(r.success, `${label}: ${r.reason}`).toBe(true);
  const fly = (): string[] => {
    const row = [hash(structuredClone(r.next.captains[0].mission))];
    let s = r.next;
    let ticks = 0;
    let cycles = 1;
    let seed = patrolOf(s)!.masterSeed;
    while (patrolOf(s) !== null) {
      s = economyTick(s, 1, RNG);
      ticks += 1;
      const m = patrolOf(s);
      if (m !== null && m.masterSeed !== seed) {
        seed = m.masterSeed;
        cycles += 1;
        row.push(`relaunch:${ticks}`, hash(structuredClone(m)), stateHash(s));
        if (cycles >= MAX_CYCLES) s = { ...s, captains: s.captains.map((c, i) => (i === 0 && c.mission?.kind === "patrol" ? { ...c, mission: { ...c.mission, recalled: true } } : c)) };
      }
      if (ticks > 6000) throw new Error(`${label}: the patrol never ended`);
    }
    row.push(`${s.ships[0].damaged === true ? "lost" : "won"}:${ticks}`, hash(s.ships[0]), stateHash(s), conditions(s));
    return row;
  };
  return mode === "off" ? useWearOff(fly) : fly();
}

interface Case {
  key: string;
  state: () => GameState;
  route: PatrolKey;
  repeat: boolean;
}

const CASES: Case[] = [];
for (const variant of ["si", "worn"] as Variant[]) {
  for (const hull of HULLS) {
    for (const route of ROUTES) {
      for (const repeat of [false, true]) {
        CASES.push({ key: `patrol:${variant}:${hull}:${route}:${repeat ? "repeat" : "once"}`, state: () => base(hull, variant), route, repeat });
      }
    }
  }
}
for (const route of ROUTES) CASES.push({ key: `patrol:crew:destroyer:${route}:repeat`, state: () => base("destroyer", "crew"), route, repeat: true });

if (CAPTURE) {
  it("captures (GW5_CAPTURE)", () => {
    const out: Record<string, string[]> = {};
    for (const c of CASES) out[c.key] = patrolRun(c.state(), c.route, c.repeat, c.key, CAPTURE === "pre" ? "off" : "live");
    writeFileSync((import.meta.env.GW5_OUT as string | undefined) ?? "gw5.json", JSON.stringify(out, null, 1));
  }, 600_000);
} else {
  describe("gear wear step 5 goldens: patrol use wear", () => {
    it("the step 5 switch reproduces every PRE row (no patrol is use-stamped)", () => {
      for (const c of CASES) expect(patrolRun(c.state(), c.route, c.repeat, c.key, "off"), c.key).toEqual(PRE[c.key]);
    });

    it("a patrol in flight at the update (dispatched before step 5) flies on byte-identical", () => {
      for (const c of CASES) expect(patrolRun(c.state(), c.route, c.repeat, c.key, "inFlight"), c.key).toEqual(PRE[c.key]);
    });

    it("LIVE: every row as the step 5 engine flies it", () => {
      for (const c of CASES) expect(patrolRun(c.state(), c.route, c.repeat, c.key, "live"), c.key).toEqual(LIVE[c.key]);
    });

    // MOVES, named: every row moves at its dispatch record (the new `useWear: 1` stamp, carried to each relaunch), and
    // from there only by USE wear: each cycle's end takes the reactor core's minutes and the drive's round trip (the
    // crew modules' minutes too with crew aboard and a module installed; none of these hulls installs one) off the
    // pieces, a few per-mille on these short routes, and a relaunched cycle opens its reactor and drive pools at that
    // lower condition (its record and state hashes move). Nothing else moves: the waves, the outcome and its tick are
    // PRE's on every row (checked here), and every other slot's final condition is PRE's.
    it("the moves are use wear only: the outcome and its tick never change, only the reactor, the drive and the modules wear", () => {
      const USE_SLOTS = new Set(["reactorCore", "ftlDrive", "bridge", "quarters", "module"]);
      for (const c of CASES) {
        const pre = PRE[c.key];
        const live = LIVE[c.key];
        expect(live.find((x) => /^(won|lost):/.test(x)), c.key).toBe(pre.find((x) => /^(won|lost):/.test(x)));
        expect(live[0], `${c.key}: the dispatch record carries the new stamp`).not.toBe(pre[0]);
        const before = pre[pre.length - 1].split(" ");
        const after = live[live.length - 1].split(" ");
        expect(after.length).toBe(before.length);
        after.forEach((entry, i) => {
          const [slot, v] = entry.split("=");
          const [, w] = before[i].split("=");
          if (USE_SLOTS.has(slot)) expect(Number(v), `${c.key} ${slot}`).toBeLessThanOrEqual(Number(w));
          else expect(v, `${c.key} ${slot}`).toBe(w);
        });
      }
    });

    it("the training cycle (the save's first patrol) records no use wear (W9, SF-7)", () => {
      // A fresh save: its first patrol is the training run. Its only cycle ends with every piece as it was dispatched.
      const fresh = { ...onHull("destroyer"), nextPatrolSeed: 1, credits: new Decimal(100_000) };
      const r = dispatchCaptainOnPatrol(fresh, 1, ROUTES[0], "balanced", false);
      expect(r.success).toBe(true);
      expect(patrolOf(r.next)?.useWear).toBe(1);
      let s = r.next;
      let ticks = 0;
      while (patrolOf(s) !== null && ticks < 6000) {
        s = economyTick(s, 1, RNG);
        ticks += 1;
      }
      expect(s.equipment.filter((e) => e.fittedToShipId === "ship-1" && e.condition !== undefined)).toEqual([]);
    });
  });
}
// ===== THE PINS (generated from the captures) =====

// PRE: captured on feat 8d3809b (before any step 5 edit) with GW5_CAPTURE=pre.
const PRE: Readonly<Record<string, readonly string[]>> = {
  "patrol:si:generalFreighter:crimsonReaverSweep:once": ["e1c443c2", "won:14", "b2f38143", "ccde4fa", "cargoBay=1000 ftlDrive=830 reactorCore=892 specUtility=1000 weapon=820 weapon=870 shieldEmitters=817 hullPlating=909"],
  "patrol:si:generalFreighter:crimsonReaverSweep:repeat": ["3f20dbd7", "relaunch:14", "277f3b70", "ea2c4ae9", "relaunch:28", "92768286", "e7ef4da8", "won:42", "b2f38143", "2cff7989", "cargoBay=1000 ftlDrive=640 reactorCore=759 specUtility=1000 weapon=630 weapon=750 shieldEmitters=493 hullPlating=904"],
  "patrol:si:generalFreighter:crimsonReaverWarband:once": ["de9c6e20", "lost:20", "701a58f1", "319720d8", "cargoBay=1000 ftlDrive=870 reactorCore=825 specUtility=1000 weapon=920 weapon=800 shieldEmitters=796 hullPlating=845"],
  "patrol:si:generalFreighter:crimsonReaverWarband:repeat": ["245e9175", "lost:20", "701a58f1", "319720d8", "cargoBay=1000 ftlDrive=870 reactorCore=825 specUtility=1000 weapon=920 weapon=800 shieldEmitters=796 hullPlating=845"],
  "patrol:si:destroyer:crimsonReaverSweep:once": ["c478f282", "won:14", "6ad9f46c", "c6c2c36", "cargoBay=1000 ftlDrive=950 reactorCore=967 specUtility=1000 weapon=930 weapon=940 weapon=960 weapon=960 shieldEmitters=857 hullPlating=1000"],
  "patrol:si:destroyer:crimsonReaverSweep:repeat": ["8f383097", "relaunch:14", "51f9a0f0", "7a9c61d0", "relaunch:28", "c41a2975", "836dbd38", "won:42", "6ad9f46c", "11c2f4b5", "cargoBay=1000 ftlDrive=880 reactorCore=893 specUtility=1000 weapon=860 weapon=870 weapon=910 weapon=920 shieldEmitters=766 hullPlating=1000"],
  "patrol:si:destroyer:crimsonReaverWarband:once": ["4912f49d", "won:20", "6ad9f46c", "e692a9", "cargoBay=1000 ftlDrive=960 reactorCore=917 specUtility=1000 weapon=920 weapon=890 weapon=890 weapon=860 shieldEmitters=788 hullPlating=937"],
  "patrol:si:destroyer:crimsonReaverWarband:repeat": ["9f5cb74", "relaunch:339", "9361352", "83c88641", "lost:352", "44b4c6b5", "577fae02", "cargoBay=1000 ftlDrive=940 reactorCore=950 specUtility=1000 weapon=940 weapon=910 weapon=910 weapon=930 shieldEmitters=850 hullPlating=844"],
  "patrol:si:battleship:crimsonReaverSweep:once": ["d148adf6", "won:18", "c6dba9cb", "970447a5", "cargoBay=1000 ftlDrive=970 reactorCore=992 specUtility=1000 weapon=980 weapon=990 weapon=990 weapon=970 weapon=980 weapon=1000 shieldEmitters=974 hullPlating=1000"],
  "patrol:si:battleship:crimsonReaverSweep:repeat": ["75ed6a31", "relaunch:18", "9445c712", "33fb55f6", "relaunch:36", "991ac240", "35ee33d7", "won:54", "c6dba9cb", "1ae618d5", "cargoBay=1000 ftlDrive=921 reactorCore=969 specUtility=1000 weapon=951 weapon=951 weapon=961 weapon=951 weapon=941 weapon=960 shieldEmitters=951 hullPlating=1000"],
  "patrol:si:battleship:crimsonReaverWarband:once": ["e60947f4", "won:28", "c6dba9cb", "b4a088b7", "cargoBay=1000 ftlDrive=990 reactorCore=975 specUtility=1000 weapon=960 weapon=970 weapon=940 weapon=960 weapon=980 weapon=930 shieldEmitters=969 hullPlating=995"],
  "patrol:si:battleship:crimsonReaverWarband:repeat": ["da327ed3", "relaunch:134", "1214ec94", "f7b5df95", "lost:161", "afe73d75", "e442456a", "cargoBay=1000 ftlDrive=820 reactorCore=909 specUtility=1000 weapon=820 weapon=850 weapon=840 weapon=860 weapon=810 weapon=870 shieldEmitters=835 hullPlating=846"],
  "patrol:si:carrier:crimsonReaverSweep:once": ["4e649c52", "won:16", "ea909677", "7795a049", "cargoBay=1000 ftlDrive=940 reactorCore=942 specUtility=1000 weapon=920 weapon=920 shieldEmitters=967 hullPlating=1000 droneBay=775"],
  "patrol:si:carrier:crimsonReaverSweep:repeat": ["b9e146e9", "relaunch:16", "21d360ed", "4ffc36a7", "relaunch:32", "14e037c8", "fe0574db", "won:48", "ea909677", "ba472202", "cargoBay=1000 ftlDrive=851 reactorCore=902 specUtility=1000 weapon=821 weapon=851 shieldEmitters=962 hullPlating=1000 droneBay=589"],
  "patrol:si:carrier:crimsonReaverWarband:once": ["f131f134", "won:26", "ea909677", "cb4723c9", "cargoBay=1000 ftlDrive=930 reactorCore=942 specUtility=1000 weapon=900 weapon=880 shieldEmitters=989 hullPlating=979 droneBay=664"],
  "patrol:si:carrier:crimsonReaverWarband:repeat": ["8ad30f8b", "relaunch:531", "b981054d", "cc727885", "lost:553", "73109288", "8fbf14af", "cargoBay=1000 ftlDrive=910 reactorCore=917 specUtility=1000 weapon=900 weapon=860 shieldEmitters=850 hullPlating=844 droneBay=700"],
  "patrol:worn:generalFreighter:crimsonReaverSweep:once": ["dd64f856", "won:14", "b2f38143", "46a29dbb", "cargoBay=900 ftlDrive=640 reactorCore=644 specUtility=750 weapon=520 weapon=560 shieldEmitters=463 hullPlating=495"],
  "patrol:worn:generalFreighter:crimsonReaverSweep:repeat": ["8217f6f3", "relaunch:14", "a0cb8520", "cf6ebd34", "relaunch:28", "3353b8", "a70b2a06", "won:42", "b2f38143", "7d1146", "cargoBay=901 ftlDrive=331 reactorCore=396 specUtility=751 weapon=281 weapon=311 shieldEmitters=15 hullPlating=433"],
  "patrol:worn:generalFreighter:crimsonReaverWarband:once": ["d3b6ece8", "lost:20", "ba00cf2d", "83147c71", "cargoBay=900 ftlDrive=690 reactorCore=602 specUtility=750 weapon=630 weapon=500 shieldEmitters=455 hullPlating=445"],
  "patrol:worn:generalFreighter:crimsonReaverWarband:repeat": ["e9000789", "relaunch:601", "7eda60a9", "c4956398", "lost:617", "701a58f1", "90e7b74b", "cargoBay=1000 ftlDrive=980 reactorCore=934 specUtility=1000 weapon=970 weapon=950 shieldEmitters=850 hullPlating=844"],
  "patrol:worn:destroyer:crimsonReaverSweep:once": ["7a2d6153", "won:14", "6ad9f46c", "800e261f", "cargoBay=900 ftlDrive=770 reactorCore=727 specUtility=750 weapon=630 weapon=640 weapon=660 weapon=660 shieldEmitters=503 hullPlating=600"],
  "patrol:worn:destroyer:crimsonReaverSweep:repeat": ["5e182f34", "relaunch:14", "e02ae17c", "fa9a29c2", "relaunch:28", "86e8b877", "133809d9", "won:42", "6ad9f46c", "634e6e85", "cargoBay=901 ftlDrive=681 reactorCore=654 specUtility=751 weapon=531 weapon=531 weapon=581 weapon=621 shieldEmitters=376 hullPlating=601"],
  "patrol:worn:destroyer:crimsonReaverWarband:once": ["ebef0f32", "won:20", "6ad9f46c", "bf0c06d8", "cargoBay=900 ftlDrive=780 reactorCore=677 specUtility=750 weapon=620 weapon=590 weapon=590 weapon=560 shieldEmitters=437 hullPlating=537"],
  "patrol:worn:destroyer:crimsonReaverWarband:repeat": ["214bafc9", "relaunch:866", "9361352", "96426894", "lost:879", "44b4c6b5", "cc6260f8", "cargoBay=1000 ftlDrive=940 reactorCore=950 specUtility=1000 weapon=940 weapon=910 weapon=910 weapon=930 shieldEmitters=850 hullPlating=844"],
  "patrol:worn:battleship:crimsonReaverSweep:once": ["c33f5692", "won:18", "c6dba9cb", "386fcca6", "cargoBay=900 ftlDrive=790 reactorCore=752 specUtility=750 weapon=680 weapon=690 weapon=690 weapon=670 weapon=680 weapon=700 shieldEmitters=623 hullPlating=600"],
  "patrol:worn:battleship:crimsonReaverSweep:repeat": ["74fd3f65", "relaunch:18", "f76ae3e3", "3c4c3180", "relaunch:36", "e76ac2c0", "6868e31a", "won:54", "c6dba9cb", "4e0051ad", "cargoBay=901 ftlDrive=741 reactorCore=729 specUtility=751 weapon=651 weapon=651 weapon=661 weapon=651 weapon=641 weapon=661 shieldEmitters=600 hullPlating=601"],
  "patrol:worn:battleship:crimsonReaverWarband:once": ["bb19bb50", "won:28", "c6dba9cb", "8fb462e6", "cargoBay=900 ftlDrive=810 reactorCore=735 specUtility=750 weapon=660 weapon=670 weapon=640 weapon=660 weapon=680 weapon=630 shieldEmitters=618 hullPlating=595"],
  "patrol:worn:battleship:crimsonReaverWarband:repeat": ["5c829707", "relaunch:637", "1214ec94", "60989f85", "lost:664", "afe73d75", "a55e69d8", "cargoBay=1000 ftlDrive=820 reactorCore=909 specUtility=1000 weapon=820 weapon=850 weapon=840 weapon=860 weapon=810 weapon=870 shieldEmitters=835 hullPlating=846"],
  "patrol:worn:carrier:crimsonReaverSweep:once": ["d6dd3d88", "won:16", "ea909677", "9dc77134", "cargoBay=900 ftlDrive=760 reactorCore=702 specUtility=750 weapon=620 weapon=620 shieldEmitters=619 hullPlating=600 droneBay=493"],
  "patrol:worn:carrier:crimsonReaverSweep:repeat": ["482b32af", "relaunch:16", "b33cdeac", "db55ab9d", "relaunch:32", "413c1334", "e14f9fb3", "won:48", "ea909677", "feea34be", "cargoBay=901 ftlDrive=661 reactorCore=645 specUtility=751 weapon=521 weapon=511 shieldEmitters=615 hullPlating=601 droneBay=232"],
  "patrol:worn:carrier:crimsonReaverWarband:once": ["45bda12e", "won:26", "ea909677", "25ede22f", "cargoBay=900 ftlDrive=750 reactorCore=702 specUtility=750 weapon=610 weapon=580 shieldEmitters=640 hullPlating=579 droneBay=344"],
  "patrol:worn:carrier:crimsonReaverWarband:repeat": ["76867275", "relaunch:1011", "b981054d", "a6661099", "lost:1033", "73109288", "329d302f", "cargoBay=1000 ftlDrive=910 reactorCore=917 specUtility=1000 weapon=900 weapon=860 shieldEmitters=850 hullPlating=844 droneBay=700"],
  "patrol:crew:destroyer:crimsonReaverSweep:repeat": ["8f383097", "relaunch:14", "51f9a0f0", "4ca016e0", "relaunch:28", "c41a2975", "a4367788", "won:42", "577a666", "7872a7eb", "cargoBay=1000 ftlDrive=880 reactorCore=893 specUtility=1000 weapon=860 weapon=870 weapon=910 weapon=920 shieldEmitters=766 hullPlating=1000"],
  "patrol:crew:destroyer:crimsonReaverWarband:repeat": ["9f5cb74", "relaunch:339", "9361352", "4c561411", "lost:352", "2e01cff7", "a1f5478a", "cargoBay=1000 ftlDrive=940 reactorCore=950 specUtility=1000 weapon=940 weapon=910 weapon=910 weapon=930 shieldEmitters=850 hullPlating=844"],
};

// LIVE: the step 5 engine (GW5_CAPTURE=live), re-captured at the step 5 review fixes (2026-11-09): C2 curves each
// cycle's use at the piece's condition BEFORE carrying it, and the carry now lives on each piece (useWearCarry), so
// every row's state hash moves and the use-worn slots wear a little less (several rows now end on PRE's conditions,
// their use still in the carry). C1 moved no row (the free rates settle to the same bytes as before).
const LIVE: Readonly<Record<string, readonly string[]>> = {
  "patrol:si:generalFreighter:crimsonReaverSweep:once": ["d534b75", "won:14", "b2f38143", "7c44a5f1", "cargoBay=1000 ftlDrive=830 reactorCore=892 specUtility=1000 weapon=820 weapon=870 shieldEmitters=817 hullPlating=909"],
  "patrol:si:generalFreighter:crimsonReaverSweep:repeat": ["c48133c4", "relaunch:14", "4e6c7da3", "e0f81575", "relaunch:28", "b6cb7be1", "2a0db733", "won:42", "b2f38143", "968106ae", "cargoBay=1000 ftlDrive=640 reactorCore=758 specUtility=1000 weapon=630 weapon=750 shieldEmitters=493 hullPlating=904"],
  "patrol:si:generalFreighter:crimsonReaverWarband:once": ["16d41a93", "lost:20", "701a58f1", "6a74a4a8", "cargoBay=1000 ftlDrive=870 reactorCore=825 specUtility=1000 weapon=920 weapon=800 shieldEmitters=796 hullPlating=845"],
  "patrol:si:generalFreighter:crimsonReaverWarband:repeat": ["45ed6602", "lost:20", "701a58f1", "6a74a4a8", "cargoBay=1000 ftlDrive=870 reactorCore=825 specUtility=1000 weapon=920 weapon=800 shieldEmitters=796 hullPlating=845"],
  "patrol:si:destroyer:crimsonReaverSweep:once": ["c14d88b5", "won:14", "6ad9f46c", "d5404eed", "cargoBay=1000 ftlDrive=950 reactorCore=967 specUtility=1000 weapon=930 weapon=940 weapon=960 weapon=960 shieldEmitters=857 hullPlating=1000"],
  "patrol:si:destroyer:crimsonReaverSweep:repeat": ["f2c5f04", "relaunch:14", "fe41eb23", "72d71bb2", "relaunch:28", "fbf9fd0f", "689c824a", "won:42", "6ad9f46c", "3bf704d8", "cargoBay=1000 ftlDrive=879 reactorCore=892 specUtility=1000 weapon=860 weapon=870 weapon=910 weapon=920 shieldEmitters=766 hullPlating=1000"],
  "patrol:si:destroyer:crimsonReaverWarband:once": ["35506cca", "won:20", "6ad9f46c", "ad28a205", "cargoBay=1000 ftlDrive=960 reactorCore=917 specUtility=1000 weapon=920 weapon=890 weapon=890 weapon=860 shieldEmitters=788 hullPlating=937"],
  "patrol:si:destroyer:crimsonReaverWarband:repeat": ["152b5e9f", "relaunch:339", "acded4a5", "254e27c2", "lost:352", "44b4c6b5", "806855b7", "cargoBay=1000 ftlDrive=940 reactorCore=950 specUtility=1000 weapon=940 weapon=910 weapon=910 weapon=930 shieldEmitters=850 hullPlating=844"],
  "patrol:si:battleship:crimsonReaverSweep:once": ["7dfa9691", "won:18", "c6dba9cb", "b750ac0b", "cargoBay=1000 ftlDrive=970 reactorCore=992 specUtility=1000 weapon=980 weapon=990 weapon=990 weapon=970 weapon=980 weapon=1000 shieldEmitters=974 hullPlating=1000"],
  "patrol:si:battleship:crimsonReaverSweep:repeat": ["3bd9c436", "relaunch:18", "c955ac45", "286d341b", "relaunch:36", "3438ec36", "8bcaf4ab", "won:54", "c6dba9cb", "dc40eadd", "cargoBay=1000 ftlDrive=920 reactorCore=967 specUtility=1000 weapon=951 weapon=951 weapon=961 weapon=951 weapon=941 weapon=960 shieldEmitters=951 hullPlating=1000"],
  "patrol:si:battleship:crimsonReaverWarband:once": ["515e331f", "won:28", "c6dba9cb", "5d5b5497", "cargoBay=1000 ftlDrive=990 reactorCore=974 specUtility=1000 weapon=960 weapon=970 weapon=940 weapon=960 weapon=980 weapon=930 shieldEmitters=969 hullPlating=995"],
  "patrol:si:battleship:crimsonReaverWarband:repeat": ["7ca373c8", "relaunch:134", "a104ff5f", "dbc591aa", "lost:161", "afe73d75", "6c56f4ef", "cargoBay=1000 ftlDrive=820 reactorCore=908 specUtility=1000 weapon=820 weapon=850 weapon=840 weapon=860 weapon=810 weapon=870 shieldEmitters=835 hullPlating=846"],
  "patrol:si:carrier:crimsonReaverSweep:once": ["5c678905", "won:16", "ea909677", "23901646", "cargoBay=1000 ftlDrive=940 reactorCore=942 specUtility=1000 weapon=920 weapon=920 shieldEmitters=967 hullPlating=1000 droneBay=775"],
  "patrol:si:carrier:crimsonReaverSweep:repeat": ["7fa6deee", "relaunch:16", "fbd3895a", "6e3f638b", "relaunch:32", "c76fdc3e", "80ba83be", "won:48", "ea909677", "9559fd2d", "cargoBay=1000 ftlDrive=850 reactorCore=900 specUtility=1000 weapon=821 weapon=851 shieldEmitters=962 hullPlating=1000 droneBay=589"],
  "patrol:si:carrier:crimsonReaverWarband:once": ["823c12df", "won:26", "ea909677", "19d7e88b", "cargoBay=1000 ftlDrive=930 reactorCore=941 specUtility=1000 weapon=900 weapon=880 shieldEmitters=989 hullPlating=979 droneBay=664"],
  "patrol:si:carrier:crimsonReaverWarband:repeat": ["dc6c60c0", "relaunch:531", "cb852d7a", "ee181dc8", "lost:553", "73109288", "51481b58", "cargoBay=1000 ftlDrive=910 reactorCore=917 specUtility=1000 weapon=900 weapon=860 shieldEmitters=850 hullPlating=844 droneBay=700"],
  "patrol:worn:generalFreighter:crimsonReaverSweep:once": ["aab31931", "won:14", "b2f38143", "603a6233", "cargoBay=900 ftlDrive=640 reactorCore=644 specUtility=750 weapon=520 weapon=560 shieldEmitters=463 hullPlating=495"],
  "patrol:worn:generalFreighter:crimsonReaverSweep:repeat": ["595c9f28", "relaunch:14", "6fe78193", "3bace2b5", "relaunch:28", "982dcf0b", "338209d5", "won:42", "b2f38143", "2ec6eade", "cargoBay=901 ftlDrive=331 reactorCore=396 specUtility=751 weapon=281 weapon=311 shieldEmitters=15 hullPlating=433"],
  "patrol:worn:generalFreighter:crimsonReaverWarband:once": ["c17779fb", "lost:20", "ba00cf2d", "78c3814b", "cargoBay=900 ftlDrive=690 reactorCore=602 specUtility=750 weapon=630 weapon=500 shieldEmitters=455 hullPlating=445"],
  "patrol:worn:generalFreighter:crimsonReaverWarband:repeat": ["e662d1ac", "relaunch:601", "2afba2e", "a7835863", "lost:617", "701a58f1", "9a25dcb1", "cargoBay=1000 ftlDrive=980 reactorCore=934 specUtility=1000 weapon=970 weapon=950 shieldEmitters=850 hullPlating=844"],
  "patrol:worn:destroyer:crimsonReaverSweep:once": ["3cc0ce48", "won:14", "6ad9f46c", "a475050", "cargoBay=900 ftlDrive=770 reactorCore=727 specUtility=750 weapon=630 weapon=640 weapon=660 weapon=660 shieldEmitters=503 hullPlating=600"],
  "patrol:worn:destroyer:crimsonReaverSweep:repeat": ["fd6df0df", "relaunch:14", "e7c8c507", "6bd4577a", "relaunch:28", "6062e724", "bcb36a0f", "won:42", "6ad9f46c", "7c448083", "cargoBay=901 ftlDrive=681 reactorCore=654 specUtility=751 weapon=531 weapon=531 weapon=581 weapon=621 shieldEmitters=376 hullPlating=601"],
  "patrol:worn:destroyer:crimsonReaverWarband:once": ["f8f6be25", "won:20", "6ad9f46c", "34bbf78f", "cargoBay=900 ftlDrive=780 reactorCore=677 specUtility=750 weapon=620 weapon=590 weapon=590 weapon=560 shieldEmitters=437 hullPlating=537"],
  "patrol:worn:destroyer:crimsonReaverWarband:repeat": ["dc60010e", "relaunch:866", "acded4a5", "3cd993f", "lost:879", "44b4c6b5", "f38b9329", "cargoBay=1000 ftlDrive=940 reactorCore=950 specUtility=1000 weapon=940 weapon=910 weapon=910 weapon=930 shieldEmitters=850 hullPlating=844"],
  "patrol:worn:battleship:crimsonReaverSweep:once": ["efe223c5", "won:18", "c6dba9cb", "3b77d3ce", "cargoBay=900 ftlDrive=790 reactorCore=752 specUtility=750 weapon=680 weapon=690 weapon=690 weapon=670 weapon=680 weapon=700 shieldEmitters=623 hullPlating=600"],
  "patrol:worn:battleship:crimsonReaverSweep:repeat": ["cc3ae7b2", "relaunch:18", "2d9af6d8", "df5f7483", "relaunch:36", "e5a8fb73", "39515df6", "won:54", "c6dba9cb", "1345c506", "cargoBay=901 ftlDrive=741 reactorCore=728 specUtility=751 weapon=651 weapon=651 weapon=661 weapon=651 weapon=641 weapon=661 shieldEmitters=600 hullPlating=601"],
  "patrol:worn:battleship:crimsonReaverWarband:once": ["653c9ec3", "won:28", "c6dba9cb", "7b95967c", "cargoBay=900 ftlDrive=810 reactorCore=735 specUtility=750 weapon=660 weapon=670 weapon=640 weapon=660 weapon=680 weapon=630 shieldEmitters=618 hullPlating=595"],
  "patrol:worn:battleship:crimsonReaverWarband:repeat": ["9e61f4", "relaunch:637", "a104ff5f", "5542a0ba", "lost:664", "afe73d75", "4a72def1", "cargoBay=1000 ftlDrive=820 reactorCore=908 specUtility=1000 weapon=820 weapon=850 weapon=840 weapon=860 weapon=810 weapon=870 shieldEmitters=835 hullPlating=846"],
  "patrol:worn:carrier:crimsonReaverSweep:once": ["6537055b", "won:16", "ea909677", "cbb524d0", "cargoBay=900 ftlDrive=760 reactorCore=702 specUtility=750 weapon=620 weapon=620 shieldEmitters=619 hullPlating=600 droneBay=493"],
  "patrol:worn:carrier:crimsonReaverSweep:repeat": ["c3ac7efc", "relaunch:16", "b07f2677", "cb2e323c", "relaunch:32", "db0c94df", "11d433f2", "won:48", "ea909677", "2aa61c90", "cargoBay=901 ftlDrive=661 reactorCore=645 specUtility=751 weapon=521 weapon=511 shieldEmitters=615 hullPlating=601 droneBay=232"],
  "patrol:worn:carrier:crimsonReaverWarband:once": ["57dff529", "won:26", "ea909677", "90fa5112", "cargoBay=900 ftlDrive=750 reactorCore=702 specUtility=750 weapon=610 weapon=580 shieldEmitters=640 hullPlating=579 droneBay=344"],
  "patrol:worn:carrier:crimsonReaverWarband:repeat": ["7dff7702", "relaunch:1011", "cb852d7a", "fb8e6172", "lost:1033", "73109288", "cec8c996", "cargoBay=1000 ftlDrive=910 reactorCore=917 specUtility=1000 weapon=900 weapon=860 shieldEmitters=850 hullPlating=844 droneBay=700"],
  "patrol:crew:destroyer:crimsonReaverSweep:repeat": ["f2c5f04", "relaunch:14", "fe41eb23", "5c0b06f4", "relaunch:28", "fbf9fd0f", "9e5f80d2", "won:42", "577a666", "5d1e2c6e", "cargoBay=1000 ftlDrive=879 reactorCore=892 specUtility=1000 weapon=860 weapon=870 weapon=910 weapon=920 shieldEmitters=766 hullPlating=1000"],
  "patrol:crew:destroyer:crimsonReaverWarband:repeat": ["152b5e9f", "relaunch:339", "acded4a5", "d915b240", "lost:352", "2e01cff7", "de49b85f", "cargoBay=1000 ftlDrive=940 reactorCore=950 specUtility=1000 weapon=940 weapon=910 weapon=910 weapon=930 shieldEmitters=850 hullPlating=844"],
};
