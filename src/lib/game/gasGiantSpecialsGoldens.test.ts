// Gas Giant Study GG-7 (crafting uses and special blueprints): golden hashes captured on feat/crew-0.14.0 1567b4d,
// BEFORE the GG-7 data and engine edits (docs/plans/2026-10-17-gas-giant-study-plan.md section GG-7, the brief's "goldens
// first"). Whole serialized records, never a narrow subset:
//
//   1. research capture: every blueprint's research verdict (canResearch) at Research Lab levels 0 to 7, with no
//      ancient entry decoded and with five entries of one culture decoded. GG-7 adds new blueprints (the special
//      blueprints carry requiresDecode; the canister modules do not); every blueprint that existed before GG-7 must
//      read exactly this capture (the added keys are held apart, GG7_ADDED_BLUEPRINT_KEYS).
//   2. study run capture: every region tier, every candidate slot and two save seeds, crewed with two Ground teams,
//      for each system that holds an orbital body or a nebula: the dispatch record as dispatched today (every stamp
//      kept: study, nebula, pickup pause), the finished run and the claim's deposits. GG-7's Ramscoop Collector and
//      Resonance Sensor Array stamp new runs only when one is installed; the fixture ship carries neither, so every
//      record must read exactly this capture.
//   3. the Ancient Data Fragment's odds over every tier and a range of probe ratings (the Resonance Sensor Array lifts
//      them only on a run that froze its bonus at dispatch).

// Ordering determinism part 2 (canonicalOrder.ts: inventory keys and a call's completion log in one order) came after every pin here, traced order-only: the file runs with it off (ordering2Switch.fixture.ts).
import { ordering2OffForThisFile } from "./ordering2Switch.fixture";
ordering2OffForThisFile();
// OC-F14 (the field repair rules stamped at dispatch on a system mixing repair worlds with other bodies) came after every pin
// here, traced: the file runs with it off (fieldRepairRulesSwitch.fixture.ts), so its pins keep proving their own slice
// (fieldRepairOrderGoldens.test.ts pins OC-F14's moves and proves them with the switch off).
import { repairRulesOffForThisFile } from "./fieldRepairRulesSwitch.fixture";
repairRulesOffForThisFile();
import { describe, expect, it } from "vitest";
// Wiring WR-10 (the away rules stamped at dispatch, a hire's account program) came after every pin here: the whole file
// runs with WR-10 off (wr10Switch.fixture.ts), so its pins keep proving their own slice (wr10Goldens.test.ts pins WR-10's).
import { wr10OffForThisFile } from "./wr10Switch.fixture";
wr10OffForThisFile();
import { EM8_BLUEPRINT_KEYS } from "./emodEm8Switch.fixture";
import { CP11_BLUEPRINT_KEYS } from "./cp11BlueprintsSwitch.fixture";
import { gearWearOffInThisFile } from "./gearWearSwitch.fixture";
gearWearOffInThisFile();
import { combatRulesOffForThisFile } from "./combatRulesSwitch.fixture";
combatRulesOffForThisFile();
// Wiring WR-11 came after every pin here: the whole file runs with WR-11 off (wr11Switch.fixture.ts), so its pins keep
// proving their own slice moved nothing else (WR-11's own moves are pinned in wr11Goldens.test.ts).
wr11OffForThisFile();
import Decimal from "break_infinity.js";
import { BLUEPRINTS, RESEARCH_FACILITY_KEY, SUBSPACE_TELESCOPE_FACILITY_KEY, freshState, type AwayMember, type GameState, type ShipGroundTeam } from "./model";
import { canResearch } from "./tick";
import { advanceExpedition, claimExpedition } from "./expedition";
import { ancientFragmentPermille } from "./gasGiantStudy";
import { asPreStaggerDispatch, dispatchPastPropulsion, plainAwayMember, G2_7_DERELICT_PINS, hasWolf359Derelict, withoutWolf359Derelict } from "./awayTeamTestFixtures";
import { goldenJson } from "./firstRunsGoldens.fixture";
import { wr11OffForThisFile } from "./wr11Switch.fixture";

function fnv(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16);
}
const hash = (v: unknown): string => fnv(goldenJson(v));

// The blueprints GG-7 adds (held apart from capture 1; absent when the capture was taken).
const GG7_ADDED_BLUEPRINT_KEYS: ReadonlySet<string> = new Set(["pressureForgedPlatingBp", "ramscoopCollectorBp", "resonanceSensorArrayBp", "eliteQuartersBp"]);

// ===== 1. research verdicts =====

function labAt(level: number, decoded: boolean): GameState {
  const base = freshState();
  return {
    ...base,
    credits: new Decimal(1e15),
    facilities: { ...base.facilities, [RESEARCH_FACILITY_KEY]: { level } },
    ...(decoded ? { ancientDecoded: { "culture-t1-1": 5, "culture-t2-3": 2 } } : {}),
  };
}

const RESEARCH_CAPTURE: Record<string, string> = {
  "0:plain": "82ff23fd",
  "0:decoded": "82ff23fd",
  "1:plain": "e12df75",
  "1:decoded": "e12df75",
  "2:plain": "8616c3e",
  "2:decoded": "8616c3e",
  "3:plain": "530ca73b",
  "3:decoded": "530ca73b",
  "4:plain": "81cd8071",
  "4:decoded": "81cd8071",
  "5:plain": "5e449d52",
  "5:decoded": "5e449d52",
  "6:plain": "5c9bdd9f",
  "6:decoded": "5c9bdd9f",
  "7:plain": "413c7edc",
  "7:decoded": "413c7edc",
};

describe("GG-7 capture 1: every pre-GG-7 blueprint's research verdict at Lab levels 0 to 7", () => {
  it("with and without decoded ancient entries", () => {
    const rows: Record<string, string> = {};
    for (let level = 0; level <= 7; level++) {
      for (const decoded of [false, true]) {
        const s = labAt(level, decoded);
        // E-MOD EM-8 (after this capture): the Precursor Lens's blueprint held apart too; and Complement CP-11's.
        const verdicts = Object.keys(BLUEPRINTS)
          .filter((k) => !GG7_ADDED_BLUEPRINT_KEYS.has(k) && !EM8_BLUEPRINT_KEYS.has(k) && !CP11_BLUEPRINT_KEYS.has(k))
          .map((k) => [k, canResearch(s, k)]);
        rows[`${level}:${decoded ? "decoded" : "plain"}`] = hash(verdicts);
      }
    }
    expect(rows).toEqual(RESEARCH_CAPTURE);
  });
});

// ===== 2. study and nebula runs, every stamp kept =====

const T0 = 100_000;
const FINAL = T0 + 8_000_000;
const SEC = ["member-1", "member-2", "member-3", "member-4", "member-5", "member-6"];
const SCI = ["member-11", "member-12", "member-13", "member-14", "member-15", "member-16"];

// ship-1 with two Ground teams of six rank 10 members, the telescope at Level 8 (gasGiantNebulaLabGoldens.test.ts).
function crewed(saveSeed: number): GameState {
  const base = freshState();
  const m = (id: string, t: AwayMember["teamType"]): AwayMember => ({ ...plainAwayMember(id, t, "ship-1"), rank: 10 as AwayMember["rank"] });
  const teams: ShipGroundTeam[] = [
    { kind: "ground", security: SEC.slice(0, 3), science: SCI.slice(0, 3), helpOthers: false },
    { kind: "ground", security: SEC.slice(3), science: SCI.slice(3), helpOthers: false },
  ];
  return {
    ...base,
    expeditionSeed: saveSeed,
    gameTimeSeconds: T0,
    nextExpeditionId: 2,
    facilities: { ...base.facilities, [SUBSPACE_TELESCOPE_FACILITY_KEY]: { level: 8 } },
    awayMembers: [...SEC.map((id) => m(id, "security")), ...SCI.map((id) => m(id, "science"))],
    nextAwayMemberId: 100,
    ships: base.ships.map((sh) => ({ ...sh, groundTeams: teams })),
  };
}

const SAVE_SEEDS = [0x51f15e, 0x2b7c0d3] as const;
const TIERS = [1, 2, 3, 4, 5, 6, 7] as const;

const STUDY_RUN_CAPTURE: Record<string, string> = {
  "51f15e:cand-1-0": "8acf8ee1",
  "51f15e:cand-3-0": "beda216e",
  "51f15e:cand-4-0": "d3b61076",
  "51f15e:cand-4-2": "20fb883d",
  "51f15e:cand-5-0": "56579ece",
  "51f15e:cand-5-2": "e0cffb1d",
  "51f15e:cand-6-1": "b15dd2fe",
  "51f15e:cand-6-2": "3f1c5527",
  "51f15e:cand-7-0": "be03519c",
  "51f15e:cand-7-2": "32811b87",
  "2b7c0d3:cand-2-0": "895e1dd3",
  "2b7c0d3:cand-2-1": "9aa08383",
  "2b7c0d3:cand-3-1": "325e6a4d",
  "2b7c0d3:cand-4-0": "cfd7eb0c",
  "2b7c0d3:cand-4-1": "6210ed2",
  "2b7c0d3:cand-5-2": "98a4a98",
  "2b7c0d3:cand-6-2": "d92a18a2",
  "2b7c0d3:cand-7-1": "2ae43d30",
};

describe("GG-7 capture 2: the grid's study and nebula runs, as dispatched today", () => {
  it("every system holding an orbital body or a nebula", () => {
    const rows: Record<string, string> = {};
    for (const saveSeed of SAVE_SEEDS) {
      for (const tier of TIERS) {
        for (let slot = 0; slot < 3; slot++) {
          const id = `cand-${tier}-${slot}`;
          const state = crewed(saveSeed);
          // Relics v2 tier stagger (after this capture): a pre-stagger dispatch (asPreStaggerDispatch, no draw moves).
          const res = asPreStaggerDispatch(dispatchPastPropulsion(state, "ship-1", 1, id));
          if (!res.success || !res.expedition) throw new Error(`dispatch refused: ${res.reason}`);
          const exp = res.expedition;
          if (exp.study === undefined && exp.nebula === undefined) continue;
          const done = advanceExpedition(exp, FINAL);
          expect(done.phase, id).toBe("complete");
          const claim = claimExpedition({ ...res.next, expeditions: [done] }, done.id);
          expect(claim.success).toBe(true);
          // G2-7 switch: a Wolf 359 claim's derelict entry comes off (G2_7_DERELICT_PINS traces which rows carry it).
          const key = `${saveSeed.toString(16)}:${id}`;
          expect(hasWolf359Derelict(claim.next), key).toBe(G2_7_DERELICT_PINS.includes(`gasGiantSpecialsGoldens:${key}`));
          const claimed = withoutWolf359Derelict(claim.next, res.next);
          const deposits = { inventory: claimed.inventory, credits: claimed.credits.toString(), surveyLog: claimed.surveyLog ?? null };
          rows[key] = hash([hash(exp), hash(done), hash(deposits)]);
        }
      }
    }
    expect(Object.keys(rows).length).toBeGreaterThan(4);
    expect(rows).toEqual(STUDY_RUN_CAPTURE);
  });
});

// ===== 3. the Ancient Data Fragment's odds =====

describe("GG-7 capture 3: the Ancient Data Fragment's per-mille odds", () => {
  it("every tier x probe relic ratings 0 to 4", () => {
    const rows: number[][] = [];
    for (const tier of TIERS) {
      const exp = { region: { version: 1 as const, tier, enemyTerritory: false, bearing: 0, distanceLy: 10 } };
      rows.push([0, 0.5, 1, 2, 4].map((r) => ancientFragmentPermille(exp, r)));
    }
    // Tier I: 12, 24, 33, 47, 68 per mille; Tier VII: 40, 79, 109, 154, 223.
    expect(hash(rows)).toBe("6db4eebc");
  });
});
