// Expedition Tiers G2-4 / G2-5 goldens first (docs/plans/2026-10-14-expedition-tiers-g2-plan.md G2-4 and G2-5): hashes
// captured on the code BEFORE propulsion (drive classes, the reach gate, frontier sensors) and recall (feat/crew-0.14.0
// @ 624b0c5). G2-4 adds dispatch gates and reads each ship's drive class into the voyage; G2-5 adds the recall and the
// resumable systems. Neither may touch a run nobody recalled. Captured here:
//
//   1. Two stored voyage-era records (propulsionRecallGoldens.fixture.ts), each hashed along its own timeline
//      (transit midpoint, arrival, mid-scan, window end, the finished run, the claim, the time skip), plus offline ==
//      live parity. They must stay unchanged in every later slice.
//   2. The same dispatches made today equal the stored records (the dispatch path G2-4 extends).
//   3. A veteran Aurora's cand-0 dispatch at every tier I to VII, and its candidate lists: G2-4's gates may refuse
//      the deeper tiers (a Class I drive); every move is named where it is re-pinned.
//   4. The blueprint catalog's keys (G2-4 adds the classed FTL drives).

// The ordering determinism slice (canonicalOrder.ts: `discovered` and the lifetime tally maps kept in canonical order)
// came after every pin here: the file runs with it off (orderingSwitch.fixture.ts), so its pins keep proving their own
// slice (orderingGoldens.test.ts pins the order move and proves it moved order only).
import { canonicalOrderOffForThisFile } from "./orderingSwitch.fixture";
canonicalOrderOffForThisFile();
// Ordering determinism part 2 (canonicalOrder.ts: inventory keys and a call's completion log in one order) came after every pin here, traced order-only: the file runs with it off (ordering2Switch.fixture.ts).
import { ordering2OffForThisFile } from "./ordering2Switch.fixture";
ordering2OffForThisFile();
import { describe, expect, it } from "vitest";
// Wiring WR-10 (the away rules stamped at dispatch, a hire's account program) came after every pin here: the whole file
// runs with WR-10 off (wr10Switch.fixture.ts), so its pins keep proving their own slice (wr10Goldens.test.ts pins WR-10's).
import { wr10OffForThisFile } from "./wr10Switch.fixture";
wr10OffForThisFile();
import { cp16OffForThisFile } from "./cp16Switch.fixture";
// Complement CP-19: this file's pins predate the Personnel Rosters track (a new game's facility map gains its
// pre-granted Level 1), so it runs with the slice off; cp19Goldens.test.ts pins the slice itself.
import { cp19OffForThisFile } from "./cp19Switch.fixture";
cp19OffForThisFile();
// Complement CP-16 (the Hall of Command) came after every pin here: the file runs with the slice off, so its pins
// keep proving their own slice (cp16Goldens.test.ts pins what CP-16 moved: the missions counter, the notables and
// the Hall of Command entry).
cp16OffForThisFile();
import { cp14OffForThisFile } from "./cp14Switch.fixture";
// Complement CP-14 (hull base sensors and Science amplification) came after every pin here: the file runs with the
// slice off, so its pins keep proving their own slice (cp14Goldens.test.ts pins what CP-14 moved).
cp14OffForThisFile();
import { GG7_BLUEPRINT_KEYS } from "./gasGiantSpecials.fixture";
// E-MOD EM-8 came after this capture: the Precursor Lens's blueprint, variety and the circuit's recipe held apart.
import { EM8_BLUEPRINT_KEYS, withoutEm8Content } from "./emodEm8Switch.fixture";
import { CP11_BLUEPRINT_KEYS } from "./cp11BlueprintsSwitch.fixture";
// GEAR WEAR step 3: this file's pins were captured before the use wear engine; it runs with the use sources off
// (gearWearSwitch.fixture.ts), so they keep proving nothing else moved. gearWearGoldens.test.ts pins the wear.
import { gearWearOffInThisFile } from "./gearWearSwitch.fixture";
gearWearOffInThisFile();
import Decimal from "break_infinity.js";
import { BLUEPRINTS, freshState, type AwayMember, type Expedition, type GameState, type RegionTier, type ShipGroundTeam } from "./model";
import { advanceExpedition, advanceExpeditionSeed, claimExpedition, expeditionCandidates, startExpedition } from "./expedition";
import { applyTimeSkip } from "./processSpeed";
import { installMissingCombatBaselines } from "./tick";
import { asExpeditionVeteran, dispatchPastPropulsion, plainAwayMember, withoutRelicBlanks, withoutStudy, G2_7_DERELICT_PINS, hasWolf359Derelict, withoutWolf359Derelict } from "./awayTeamTestFixtures";
import { FIELD_KITS_CATALOG_VERSION } from "./fieldKits";
import { HELD_DRIVE_KEYS, PRE_G2_4_STORED_RUNS, withoutHeldDrives } from "./propulsionRecallGoldens.fixture";
import { goldenJson } from "./firstRunsGoldens.fixture";
// WR-8 (0.14.0): every pin in this file was taken before the combat rules (combatRulesSwitch.fixture.ts), so the file
// runs with them switched off and its pins keep proving WR-8 moved nothing else here (the rules stamp new patrol
// cycles and runs; combatDescriptorGoldens.test.ts pins the combat rules themselves).
import { combatRulesOffForThisFile } from "./combatRulesSwitch.fixture";
import { EM7_BLUEPRINT_KEYS } from "./emodEm7.fixture";
import { wr11OffForThisFile } from "./wr11Switch.fixture";
combatRulesOffForThisFile();
// Wiring WR-11 came after every pin here: the whole file runs with WR-11 off (wr11Switch.fixture.ts), so its pins keep
// proving their own slice moved nothing else (WR-11's own moves are pinned in wr11Goldens.test.ts).
wr11OffForThisFile();

function fnv(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16);
}
const hash = (v: unknown): string => fnv(goldenJson(v));

// MERGED ONTO feat (0.14.0 integration): two slices merged after this capture stamp every NEW dispatch, and nothing
// else in it: Relics v2 R2-2 adds its relic blanks flag (Expedition.relicBlanks) and the timed grenades bumped the
// Field Kits catalog stamp from 1 to 2 (FIELD_KITS_CATALOG_VERSION). A dispatch made today is read back to the record
// the capture's code wrote (the flag dropped, the stamp put back to catalog 1); the live stamp is checked. Gas Giant
// Study GG-2 (merged later still) stamps a system with a gas giant `study` and freezes each giant's profile: withoutStudy
// takes both off. Pure.
function asPreMergeDispatch(exp: Expedition): Expedition {
  const plain = withoutStudy(withoutRelicBlanks(exp));
  if (!plain.fieldKits) return plain;
  expect(plain.fieldKits.catalog).toBe(FIELD_KITS_CATALOG_VERSION);
  return { ...plain, fieldKits: { ...plain.fieldKits, catalog: 1 } };
}

const T0 = 100_000;
const FINAL = T0 + 3_000_000;
const PHASES = ["transit", "scanning", "activities", "return", "complete"];
const SEC = ["member-1", "member-2", "member-3", "member-4", "member-5", "member-6"];
const SCI = ["member-11", "member-12", "member-13", "member-14", "member-15", "member-16"];

// ship-1 with two Ground teams of six rank 10 members (3 Security + 3 Science each), the clock at T0.
export function crewedForRecall(nextExpeditionId: number): GameState {
  const base = freshState();
  const m = (id: string, t: AwayMember["teamType"]): AwayMember => ({ ...plainAwayMember(id, t, "ship-1"), rank: 10 as AwayMember["rank"] });
  const teams: ShipGroundTeam[] = [
    { kind: "ground", security: SEC.slice(0, 3), science: SCI.slice(0, 3), helpOthers: false },
    { kind: "ground", security: SEC.slice(3), science: SCI.slice(3), helpOthers: false },
  ];
  return {
    ...base,
    gameTimeSeconds: T0,
    nextExpeditionId,
    awayMembers: [...SEC.map((id) => m(id, "security")), ...SCI.map((id) => m(id, "science"))],
    nextAwayMemberId: 100,
    ships: base.ships.map((sh) => ({ ...sh, groundTeams: teams })),
  };
}

export const onHull = (s: GameState, typeKey: "orion" | "aurora" | "eir"): GameState =>
  installMissingCombatBaselines({ ...s, ships: s.ships.map((x) => (x.id === "ship-1" ? { ...x, typeKey } : x)) });

type Name = "orionTier1" | "tier4";
const CASES: Record<Name, { crew: () => GameState; candidate: string; tier: RegionTier }> = {
  orionTier1: { crew: () => asExpeditionVeteran(onHull(crewedForRecall(2), "orion")), candidate: "cand-1-0", tier: 1 },
  tier4: { crew: () => asExpeditionVeteran(crewedForRecall(2)), candidate: "cand-4-0", tier: 4 },
};

const stored = (name: Name): Expedition => structuredClone(PRE_G2_4_STORED_RUNS[name]) as Expedition;

function held(crew: GameState, exp: Expedition): GameState {
  return { ...crew, nextExpeditionId: crew.nextExpeditionId + 1, expeditionSeed: advanceExpeditionSeed(crew.expeditionSeed), expeditions: [exp] };
}

function timeline(exp: Expedition): [string, number][] {
  const out: [string, number][] = [[exp.phase, exp.phaseAnchorSeconds]];
  let e = exp;
  for (let t = exp.phaseAnchorSeconds + 101; e.phase !== "complete" && t < FINAL; t += 101) {
    e = advanceExpedition(e, t);
    if (out[out.length - 1][0] !== e.phase) out.push([e.phase, e.phaseAnchorSeconds]);
  }
  expect(out.map(([p]) => p)).toEqual(PHASES);
  return out;
}
const anchorOf = (tl: [string, number][], phase: string): number => tl.find(([p]) => p === phase)![1];

function chunked(exp: Expedition, from: number, to: number, step: number): Expedition {
  let e = exp;
  for (let t = from + step; t < to; t += step) e = advanceExpedition(e, t);
  return advanceExpedition(e, to);
}

function eventTimes(done: Expedition, tl: [string, number][], to: number): number[] {
  const times = new Set<number>(tl.map(([, t]) => t));
  const ops = done.groundOps;
  for (const r of ops?.history ?? []) for (const t of [r.startedAt, r.endedAt]) times.add(t);
  for (const l of ops?.log ?? []) times.add(l.at);
  for (const leg of ops?.shipLegs ?? []) for (const t of [leg.startsAt, leg.arrivesAt, leg.endsAt]) times.add(t);
  for (const leg of ops?.repairLegs ?? []) for (const t of [leg.startsAt, leg.arrivesAt, leg.repairedAt, leg.endsAt]) times.add(t);
  return [...times].filter((t) => Number.isFinite(t) && t > T0 + 1 && t + 1 < to).sort((a, b) => a - b);
}

// Offline == live on one run (the voyageGoldens.test.ts check): one call == 997 s chunks == 1 s steps around arrival ==
// the event-boundary chain, the input never touched. Exported for the recall and resume parity tests.
export function expectRunParity(exp: Expedition): void {
  const frozen = structuredClone(exp);
  const tl = timeline(exp);
  const end = anchorOf(tl, "complete") + 1;
  const one = advanceExpedition(exp, end);
  expect(chunked(exp, exp.phaseAnchorSeconds, end, 997)).toEqual(one);
  const arrival = anchorOf(tl, "scanning");
  const from = Math.floor(arrival) - 300;
  expect(chunked(advanceExpedition(exp, from), from, from + 600, 1)).toEqual(advanceExpedition(exp, from + 600));
  let e = exp;
  for (const t of eventTimes(one, tl, end)) for (const at of [t - 1, t, t + 1]) e = advanceExpedition(e, at);
  expect(advanceExpedition(e, end)).toEqual(one);
  expect(exp).toEqual(frozen);
}

// Layout: [timeline, transit midpoint, arrival, mid-scan, window end, finished run, claim, time skip].
const GOLDEN: Record<Name, string[]> = {
  orionTier1: ["3379a545", "e8c373d4", "e0070ec3", "19e4da00", "977d9d76", "7e41c4e4", "356eb3cc", "575a0d4d"],
  tier4: ["5136e96", "5ae2c", "d1f2cc1b", "b42008cc", "4e42e1e6", "ab9f05b3", "8c2ecacb", "546d9369"],
};
// Per tier I..VII: the veteran Aurora's cand-<tier>-0 dispatch result, then its candidate list.
// MOVED AT THE GG-2 MERGE, named: Tier VI's dispatch (its system holds a gas giant whose risk grades held a hostile
// site or a clearing objective): GG-2 places neither on an orbital body (every draw kept), which withoutStudy cannot
// rebuild, so that row re-pinned (was a49bef54). Tier III (also a gas giant system) reads as before through withoutStudy.
const GOLDEN_TIERS: string[] = [
  "1:ok:627f2c8a", "1:list:27922952", "2:ok:5f7ba254", "2:list:60913b6f", "3:ok:d787b326", "3:list:ae4a9424",
  "4:ok:1ec0d52", "4:list:a2dc4ed5", "5:ok:d790b266", "5:list:a10fc09a", "6:ok:fcb848ae", "6:list:ecacb6f1",
  "7:ok:d51772f2", "7:list:e16e3c7c",
];
const GOLDEN_CATALOG = "fc8d8357";

// Layout: one hash per checkpoint (see GOLDEN). Exported for the later slices' neutrality checks.
export function storedRunHashes(name: Name): string[] {
  const exp = stored(name);
  const state = held(CASES[name].crew(), exp);
  const tl = timeline(exp);
  const arrival = anchorOf(tl, "scanning");
  const done = advanceExpedition(exp, FINAL);
  const windowEnd = done.groundOps!.endedAt!;
  expect(windowEnd).toBe(anchorOf(tl, "return"));
  const points = [Math.floor((T0 + arrival) / 2), arrival, Math.floor((arrival + anchorOf(tl, "activities")) / 2), windowEnd];
  const claim = claimExpedition({ ...state, gameTimeSeconds: done.phaseAnchorSeconds, expeditions: [done] }, done.id);
  expect(claim.success).toBe(true);
  // G2-7 switch: a Wolf 359 claim's derelict entry comes off (G2_7_DERELICT_PINS traces which cases carry it).
  expect(hasWolf359Derelict(claim.next), name).toBe(G2_7_DERELICT_PINS.includes(`propulsionRecallGoldens:${name}`));
  claim.next = withoutWolf359Derelict(claim.next, state);
  const skip = applyTimeSkip({ ...state, gameTimeSeconds: T0 + 1_000 }, { kind: "expedition", id: exp.id });
  expect(skip.applied).toBe(true);
  return [hash(tl), ...points.map((t) => hash(advanceExpedition(exp, t))), hash(done), hash(claim.next), hash(skip.next.expeditions)];
}

describe("G2-4 / G2-5 goldens first: voyage-era in-flight runs keep resolving byte-identically", () => {
  for (const name of ["orionTier1", "tier4"] as const) {
    it(`${name}: the stored record's timeline, checkpoints, claim and time skip match the pre-G2-4 capture`, () => {
      const exp = stored(name);
      expect(exp.voyage?.driveClass).toBe(1);
      expect(exp.region?.tier).toBe(CASES[name].tier);
      expect("recall" in exp).toBe(false);
      expect(storedRunHashes(name)).toEqual(GOLDEN[name]);
    });

    it(`${name}: one call == 997 s chunks == 1 s steps == the event-boundary chain`, () => {
      expectRunParity(stored(name));
    });

    // G2-4: the freighter's Tier IV run is refused by a player's dispatch now (not an explorer; a Class I drive), so both
    // are compared through the pre-G2-4 dispatch (the gates only refuse; a launched record is unchanged).
    it(`${name}: the same dispatch made today is the stored record`, () => {
      const res = dispatchPastPropulsion(CASES[name].crew(), "ship-1", 1, CASES[name].candidate);
      expect(res.success).toBe(true);
      expect(JSON.parse(JSON.stringify(asPreMergeDispatch(res.expedition!)))).toEqual(stored(name));
    });
  }
});

describe("G2-4 goldens first: a veteran Aurora at every tier, and the blueprint catalog", () => {
  // G2-4 (named moves): the pinned hashes are the pre-G2-4 dispatch (dispatchPastPropulsion), unchanged. A player's
  // dispatch of the Class I Aurora now launches Tier I exactly as before and is refused deeper: Tier II with
  // driveClassTooLow (a Class II drive can be built), Tiers III to VII with driveClassUnavailable (no Class III or better
  // drive is served by the facility tracks yet), the state untouched. The candidate lists do not move.
  it("the cand-0 dispatch result and the candidate list of each tier I to VII", () => {
    const state = { ...asExpeditionVeteran(onHull(crewedForRecall(2), "aurora")), credits: new Decimal(1_000_000) };
    const out: string[] = [];
    for (const tier of [1, 2, 3, 4, 5, 6, 7] as const) {
      const res = dispatchPastPropulsion(state, "ship-1", 1, `cand-${tier}-0`);
      const back = res.success ? { ...res, expedition: asPreMergeDispatch(res.expedition!), next: res.next.expeditions.map(asPreMergeDispatch) } : { ...res, next: null };
      out.push(`${tier}:${res.success ? "ok" : res.reason}:${hash(back)}`);
      out.push(`${tier}:list:${hash(expeditionCandidates(state, "ship-1", tier))}`);
      const gated = startExpedition(state, "ship-1", 1, `cand-${tier}-0`);
      if (tier === 1) expect(gated).toEqual(res);
      else {
        // FLIPPED BY OC-15 (Lab and Fabricator at tier VII serve Class III to VII): every deeper tier reads
        // driveClassTooLow; with those rows held out (the catalog before OC-15) Tiers III to VII read
        // driveClassUnavailable exactly as G2-4 pinned.
        expect(gated.reason, `tier ${tier}`).toBe("driveClassTooLow");
        expect(gated.next).toBe(state);
        const before = withoutHeldDrives(() => startExpedition(state, "ship-1", 1, `cand-${tier}-0`));
        expect(before.reason, `tier ${tier}`).toBe(tier === 2 ? "driveClassTooLow" : "driveClassUnavailable");
      }
    }
    expect(out).toEqual(GOLDEN_TIERS);
  });

  // G2-4 (named move): the Class II Drive Blueprint joins the catalog right after the Class I drives; the other keys
  // hash as before, in order.
  it("the blueprint catalog's keys", () => {
    // OC-15 (named move): the Class III to VII rows follow it, in class order, once both tracks reach tier VII.
    const keys = Object.keys(BLUEPRINTS);
    const classed = ["classIIDriveBp", ...HELD_DRIVE_KEYS];
    expect(keys.slice(keys.indexOf("balancedDriveBp") + 1, keys.indexOf("balancedDriveBp") + 1 + classed.length)).toEqual(classed);
    // E-MOD EM-7 (named move): its eight module blueprints follow the Bio-Resonance Array; held apart here.
    // Gas Giant Study GG-7 (named move): its four blueprints follow EM-7's; held apart here too.
    // Complement CP-11 (named move): its fifteen crew module and array blueprints follow GG-7's; held apart here too.
    expect(hash(keys.filter((k) => !classed.includes(k) && !EM7_BLUEPRINT_KEYS.has(k) && !GG7_BLUEPRINT_KEYS.has(k) && !EM8_BLUEPRINT_KEYS.has(k) && !CP11_BLUEPRINT_KEYS.has(k)))).toBe(GOLDEN_CATALOG);
  });
});
