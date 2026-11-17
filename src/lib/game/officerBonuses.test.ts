import { withEnemyTorpedoesOff } from "./enemyTorpedoSwitch.fixture";
// E-CREW 0.14.0 (Task 20): OFFICER BONUSES GO LIVE (design 6.1 + D12).
//
// Covers, bonus by bonus, that every Senior Staff bonus a player can roll now does something, and where:
//   - Weapons / Shield / Evasive Command + Inspiring Leader's combat half: the patrol combatant (frozen per
//     cycle on PatrolMissionState.officerCombat, read identically by the live loop and the display replay);
//   - Inspiring Leader's ship-stat half + Veteran Instincts' unload half: effectiveShipStats (crew map);
//   - Rapid Recovery + Veteran Instincts' repair half: the Shipyard repair duration;
//   - Command Presence: delivered hauls + credits of extraction / survey / transport runs and patrol loot;
//   - Discovery Instinct: survey missions' rare-drop odds (the relic roll was already live, Task 15);
//   - Fleet Triage + Morale Anchor: the away team's healing / first aid and Fear resist, frozen on the
//     Expedition at dispatch;
//   - Reactor Overdrive: the ship's net power draw (E-MOD EM-1: crew.powerEfficiency, netPowerDraw).
// NEUTRALITY: with no officer, patrol, mission, repair and expedition replays are byte-identical to the
// code BEFORE Task 20 (golden hashes captured before the change).

// The ordering determinism slice (canonicalOrder.ts: `discovered` and the lifetime tally maps kept in canonical order)
// came after every pin here: the file runs with it off (orderingSwitch.fixture.ts), so its pins keep proving their own
// slice (orderingGoldens.test.ts pins the order move and proves it moved order only).
import { canonicalOrderOffForThisFile } from "./orderingSwitch.fixture";
canonicalOrderOffForThisFile();
// Ordering determinism part 2 (canonicalOrder.ts: inventory keys and a call's completion log in one order) came after every pin here, traced order-only: the file runs with it off (ordering2Switch.fixture.ts).
import { ordering2OffForThisFile } from "./ordering2Switch.fixture";
ordering2OffForThisFile();
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
import { cp16OffForThisFile } from "./cp16Switch.fixture";
// Complement CP-16 (the Hall of Command) came after every pin here: the file runs with the slice off, so its pins
// keep proving their own slice (cp16Goldens.test.ts pins what CP-16 moved: the missions counter, the notables and
// the Hall of Command entry).
cp16OffForThisFile();
// GEAR WEAR step 3: this file's pins were captured before the use wear engine; it runs with the use sources off
// (gearWearSwitch.fixture.ts), so they keep proving nothing else moved. gearWearGoldens.test.ts pins the wear.
import { gearWearOffInThisFile } from "./gearWearSwitch.fixture";
gearWearOffInThisFile();
import Decimal from "break_infinity.js";
import {
  freshState,
  SHIP_TYPES,
  type AwayMember,
  type AwayTeamType,
  type GameState,
  type MissionKey,
  type PatrolMissionState,
  type SeniorStaffOfficer,
  type SeniorStaffSeat,
  type ShipTypeKey,
} from "./model";
import {
  dispatchCaptainOnPatrol,
  economyTick,
  installMissingCombatBaselines,
  processShipRepairs,
  shipRepairDurationTicks,
  tickCaptainMission,
  tickCaptainPatrol,
} from "./tick";
import { replayPatrol } from "./combat/patrolReplay";
import { applyOfficerCombat, foldedPlayerDefense, shipToCombatant, combatHullTypeOf } from "./combat/bridge";
import { equippedFor } from "./equipment";
import { advanceExpedition, claimExpedition, expeditionCandidates } from "./expedition";
import {
  OFFICER_BONUSES_PENDING_IN_RELEASE,
  effectiveShipStats,
  officerCombatMods,
  officerMissionOutputBonus,
  officerRepairSpeedBonus,
  netPowerDraw,
  shipCrewContribution,
} from "./crewOverlay";
import { CREW_STAT_KEYS } from "./crewBuffs";
import { SENIOR_STAFF_BONUSES, getSeniorStaffBonusById } from "./seniorStaffBonuses";
import { buildRosterCombatants, generateEncounter, resolveGroundBattle, type GambitLogEvent, type GroundCombatant } from "./gambit";
import { taskFightTeam } from "./groundFight";
import { snapshotAwayRoster } from "./awayTeam";
import { makeRng } from "./combat/rng";
import { itemTotal } from "./inventory";
// Ground Ops GO-1: whole-state goldens hash without the new, inert ground-team slots (captured before them).
import { asLegacyDispatch, asPreG2NamesDispatch, withSlottedAwayTeams, withoutGroundSquadState, dispatchPastPropulsion, asPrePatrolCurveDispatch } from "./awayTeamTestFixtures";
// SF-1: whole states hash without the run counters (seeded by freshState, written by a patrol), absent before SF-1.
import { withoutRunCounts, goldenJson, withoutCompletionTracking } from "./firstRunsGoldens.fixture";
import { withCombatRulesOff } from "./combatRulesSwitch.fixture";
import { withPatrolLegsOff } from "./patrolLegsSwitch.fixture";
import { wr11OffForThisFile } from "./wr11Switch.fixture";
import { fixRoundESwitchesOffForThisFile } from "./fixRoundESwitch.fixture";
import { fixRoundAnswersOffForThisFile } from "./fixRoundAnswersSwitch.fixture";

// Fix round answers Q3 (2026-11-17, "Yes, same every visit": a catalog-named system's bodies are drawn from its
// catalog id, the same every visit) moves this file's pins (the catalog-named systems its runs fly have other bodies).
// They predate it and are about another slice, so the file runs with it off (fixRoundAnswersSwitch.fixture.ts). Q3's
// own pins: expeditionFixRoundE.test.ts.
fixRoundAnswersOffForThisFile("catalogBodies");

// Fix round FR-E (0.14.0): the star rule (lane 3 I2, STAR_BODIES_SWITCH: a real star's bodies are drawn from the star,
// not from its candidate slot) moves the expeditions dispatch record (its candidate is a real star). The pins here
// predate the round and are about another slice, so the file runs with that fix off (fixRoundESwitch.fixture.ts); every
// other fix of the round runs here. The round's own pins: expeditionFixRoundE.test.ts and
// expeditionFixRoundEGoldens.test.ts.
fixRoundESwitchesOffForThisFile("starBodies");
// Wiring WR-11 came after every pin here: the whole file runs with WR-11 off (wr11Switch.fixture.ts), so its pins keep
// proving their own slice moved nothing else (WR-11's own moves are pinned in wr11Goldens.test.ts).
wr11OffForThisFile();
// WR-7 follow-up OC-D8: these neutrality goldens were captured before the patrol legs scaled, so their patrols fly the
// route's legs too (patrolLegsSwitch.fixture.ts; patrolLegsGoldens.test.ts pins the legs).
const withCombatRulesAndLegsOff = <T>(run: () => T): T => withCombatRulesOff(() => withPatrolLegsOff(run));

// Every dispatch slots the members in hire order (dispatch reads the slotted ground teams). Wiring OC-G1: the runs are
// Ground Ops runs; the expedition golden below hashes only the DISPATCH RECORD, as the pre-GO-7b dispatch wrote it
// (asLegacyDispatch strips the later flags from the record; nothing resolves it).
const start: typeof dispatchPastPropulsion = (state, ...rest) => asPreG2NamesDispatch(dispatchPastPropulsion(withSlottedAwayTeams(state), ...rest));
const preGroundOpsRecord: typeof dispatchPastPropulsion = (state, ...rest) => asPreG2NamesDispatch(asLegacyDispatch(dispatchPastPropulsion(withSlottedAwayTeams(state), ...rest)));

// ===== fixtures =====

function fnv(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16);
}

function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

// An officer seated on ship-1 carrying ONE real bonus (by catalog id, at its catalog magnitude) and an
// unknown second id (contributes nothing), Earth-born (racial crew.crewEffectiveness, a dormant key).
function officerWith(bonusId: string, seat?: SeniorStaffSeat, id = "officer-1", shipId = "ship-1"): SeniorStaffOfficer {
  const def = getSeniorStaffBonusById(bonusId)!;
  return {
    id,
    seat: seat ?? (def.seat === "any" ? "executive" : def.seat),
    name: `Officer ${id}`,
    race: "earthBorn",
    gender: "nonbinary",
    rank: "ensign",
    bonuses: [
      { id: bonusId, magnitude: def.magnitude },
      { id: "test.none", magnitude: 0 },
    ],
    missionsCompleted: 0,
    assignedShipId: shipId,
  };
}

function member(id: string, teamType: AwayTeamType, over: Partial<AwayMember> = {}): AwayMember {
  return {
    id,
    teamType,
    spec: teamType === "science" ? "geology" : "offense",
    name: `Member ${id}`,
    race: "earthBorn",
    gender: "female",
    rank: 1,
    traits: [],
    assignedShipId: "ship-1",
    ...over,
  };
}

const GOLDEN_ROSTER: AwayMember[] = [
  member("member-1", "security", { spec: "offense", rank: 3, traits: ["quickDraw"] }),
  member("member-2", "security", { spec: "defense", rank: 2, traits: ["bulwark"] }),
  member("member-3", "security", { spec: "debuff", rank: 4, traits: ["fieldMedic"] }),
  member("member-4", "science"),
];

function patrolState(typeKey: ShipTypeKey, officers: SeniorStaffOfficer[] = []): GameState {
  const base = freshState();
  return installMissingCombatBaselines({
    ...base,
    credits: new Decimal(100000),
    ships: base.ships.map((sh) => (sh.id === "ship-1" ? { ...sh, typeKey } : sh)),
    officers,
  });
}

function missionState(key: MissionKey, officers: SeniorStaffOfficer[] = []): GameState {
  const s = freshState();
  s.captains[0].mission = {
    kind: "extraction",
    missionKey: key,
    phase: "ordersReceived",
    phaseProgressTicks: 0,
    cargo: { commonOre: new Decimal(0), uncommonMaterial: new Decimal(0), rareMaterial: new Decimal(0) },
    recalled: false,
  };
  s.credits = new Decimal(1_000_000);
  s.officers = officers;
  return s;
}

function runTicks(s: GameState, n: number, rng: () => number): GameState {
  let out = s;
  for (let i = 0; i < n; i++) out = economyTick(out, 1, rng);
  return out;
}

const patrolOf = (s: GameState): PatrolMissionState => s.captains[0].mission as PatrolMissionState;

// ============================================================================
// NEUTRALITY: golden hashes captured from the code BEFORE Task 20 (no officer anywhere).
// ============================================================================
const GOLDEN: Record<string, string | string[]> = {
  "mission:shortOreRun": "f32eb08",
  "mission:surveyMineralAnomaly": "43fdb4f",
  "mission:frontierSupplyRun": "c8b32785",
  // Re-pinned by WR-4 (B14): a battle's turn order is by side, then input order (the player side first), no longer
  // by id ("crimsonReavers-w..." used to sort ahead of "ship-1"); each patrol's state and replays moved, its dispatch
  // record did not.
  "patrol:destroyer:dispatch": "2482ac0b",
  "patrol:destroyer:state": "57dd4829",
  "patrol:destroyer:replays": ["6ca86c97", "76776b70", "19b7c316", "c8fe1f57", "ea748cb3", "ce4904ed", "a2f81e1", "3c3169d3"],
  "patrol:carrier:dispatch": "16e07798",
  "patrol:carrier:state": "f1903d3c",
  "patrol:carrier:replays": ["9e9d9838", "95126c89", "6f82e593", "349cbd04", "8c13b3c8", "c1af6ef3", "d7ae934c", "3ee0a8b7"],
  "patrol:battleship:dispatch": "80f668a3",
  "patrol:battleship:state": "6f0d2f1e",
  "patrol:battleship:replays": ["10a14de7", "4074234d", "16dfcddc", "a816e123", "c9dec81", "ef111092", "847f08c8", "535d66ee"],
  repair: "b439b3e9",
  // Wiring OC-G1: each pin was "dispatch record / legacy resolution / legacy claim injuries"; the last two proved only
  // the deleted legacy path and are RETIRED, the dispatch record hash (first of the three) is held unchanged.
  expedition: ["29c9f4b8", "79cb18b", "3c126cd4", "6634649d", "7fdee9a2", "e57f36c2", "9f72ec67", "fa4bcf63"],
  // Wiring OC-G1 fix round: one Ground Ops run resolved and claimed, "dispatch record / resolved run / claimed state
  // without the officers", captured on the engine of the OC-G1 fix round (the end-to-end half the retired legacy pins
  // carried). The real assertion is the equality below: a seated officer carrying no live bonus changes nothing.
  groundOps: "a725ca70/355c21b5/9d3f2838",
  // WR-8b (enemy torpedoes) merged before the OC-G1 fix round reached feat: the live run now carries the torpedo stamp
  // (dispatch record and resolved run move, the claim does not). With torpedoes off the pin above reproduces exactly.
  groundOpsTorpedoes: "1f732f74/a4e963fd/9d3f2838",
};

// A Ground Ops run (live dispatch) resolved to the end and claimed: its three hashes. The officers are stripped from the
// claimed state (their own records differ by construction: one fixture seats one, the other none).
function groundOpsRunHash(officers: SeniorStaffOfficer[]): string {
  const s: GameState = { ...freshState(), awayMembers: GOLDEN_ROSTER, nextAwayMemberId: 100, expeditionSeed: 0x2468ace, officers };
  const res = start(s, "ship-1", 1, expeditionCandidates(s, "ship-1")[0].id);
  expect(res.success).toBe(true);
  expect(res.expedition!.groundOps).toBeDefined();
  const done = advanceExpedition(res.expedition!, 1_000_000);
  expect(done.phase).toBe("complete");
  // The fixture really fights (the run's battles are what the officers could reach).
  expect(done.groundOps!.history.some((r) => r.step === "fight")).toBe(true);
  const claimed = claimExpedition({ ...res.next, expeditions: [done] }, done.id);
  expect(claimed.success).toBe(true);
  return [res.expedition, done, { ...withoutCompletionTracking(claimed.next), officers: [] }].map((x) => fnv(goldenJson(x))).join("/");
}

describe("neutrality: no officer = byte-identical to before Task 20 (golden)", () => {
  it("extraction, survey and transport runs through economyTick", () => {
    for (const key of ["shortOreRun", "surveyMineralAnomaly", "frontierSupplyRun"] as MissionKey[]) {
      const s = runTicks(missionState(key), 700, lcg(0xbeef));
      expect(fnv(goldenJson(withoutRunCounts(withoutGroundSquadState(s)))), key).toBe(GOLDEN[`mission:${key}`]);
    }
  });

  // WR-8 (0.14.0): captured before the combat rules, so the patrols fly with them switched off (combatRulesSwitch
  // .fixture.ts; combatDescriptorGoldens.test.ts pins the rules).
  it("patrols (live loop + relaunches + the display replay)", () => withCombatRulesAndLegsOff(() => {
    for (const typeKey of ["destroyer", "carrier", "battleship"] as ShipTypeKey[]) {
      const r = asPrePatrolCurveDispatch(dispatchCaptainOnPatrol(patrolState(typeKey), 1, "crimsonReaverSweep", "balanced", true));
      expect(r.success).toBe(true);
      let s = r.next;
      expect(fnv(goldenJson(s.captains[0].mission))).toBe(GOLDEN[`patrol:${typeKey}:dispatch`]);
      const replays: string[] = [];
      for (let i = 0; i < 1200; i++) {
        s = economyTick(s, 1, () => 0.5);
        if (i % 150 === 0) replays.push(fnv(goldenJson(replayPatrol(s, s.captains[0]))));
      }
      expect(fnv(goldenJson(withoutRunCounts(withoutGroundSquadState(s))))).toBe(GOLDEN[`patrol:${typeKey}:state`]);
      expect(replays).toEqual(GOLDEN[`patrol:${typeKey}:replays`]);
    }
  }));

  it("a Shipyard repair", () => {
    const base = installMissingCombatBaselines({ ...freshState() });
    const s = {
      ...base,
      ships: base.ships.map((sh) => (sh.id === "ship-1" ? { ...sh, typeKey: "destroyer" as ShipTypeKey, damaged: true, repairDamage: 437 } : sh)),
    };
    expect(fnv(goldenJson(processShipRepairs(installMissingCombatBaselines(s)).activeProcesses))).toBe(GOLDEN.repair);
  });

  it("expeditions: the dispatch record (OC-G1 retired the legacy resolution and claim halves)", () => {
    const s0: GameState = { ...freshState(), awayMembers: GOLDEN_ROSTER, nextAwayMemberId: 100 };
    const runs: string[] = [];
    for (let i = 0; i < 8; i++) {
      const s = { ...s0, expeditionSeed: (0x2468ace + i * 7919) >>> 0 };
      const res = preGroundOpsRecord(s, "ship-1", 1, expeditionCandidates(s, "ship-1")[0].id);
      expect(res.success).toBe(true);
      runs.push(fnv(goldenJson(res.expedition)));
    }
    expect(runs).toEqual(GOLDEN.expedition);
  });

  // Wiring OC-G1 fix round: the expedition pins above hash only the dispatch record now, so this restores a resolved
  // run: the same Ground Ops run with no officer and with a seated officer whose only bonus is an unknown id (nothing
  // live) is byte-identical through the claim.
  it("expeditions: a Ground Ops run through claim, no officer = a seated officer with no live bonus", () => {
    const neutral: SeniorStaffOfficer = { ...officerWith("ops.cargoExpand"), bonuses: [{ id: "test.none", magnitude: 0 }, { id: "test.none", magnitude: 0 }] };
    const plain = groundOpsRunHash([]);
    expect(groundOpsRunHash([neutral])).toBe(plain);
    expect(plain).toBe(GOLDEN.groundOpsTorpedoes);
    expect(withEnemyTorpedoesOff(() => groundOpsRunHash([]))).toBe(GOLDEN.groundOps);
  });

  it("a ship whose officers carry only non-combat bonuses freezes NO combat record", () => {
    const s = patrolState("destroyer", [officerWith("ops.cargoExpand")]);
    expect(officerCombatMods(s, s.ships[0])).toBeUndefined();
    const r = asPrePatrolCurveDispatch(dispatchCaptainOnPatrol(s, 1, "crimsonReaverSweep", "balanced", false));
    expect("officerCombat" in patrolOf(r.next)).toBe(false);
  });
});

// ============================================================================
// Ship battles: Weapons / Shield / Evasive Command + Inspiring Leader (combat half)
// ============================================================================
describe("ship-battle bonuses (Weapons, Shield, Evasive Command; Inspiring Leader)", () => {
  const destroyer = (officers: SeniorStaffOfficer[]) => patrolState("destroyer", officers);
  const combatantOf = (s: GameState) =>
    shipToCombatant({
      id: "ship-1",
      team: "player",
      stats: SHIP_TYPES.destroyer,
      hullType: combatHullTypeOf("destroyer")!,
      installedGear: equippedFor(s, "ship-1"),
      officerCombat: officerCombatMods(s, s.ships[0]),
    });

  it("Weapons Command scales every installed weapon's damage band, and nothing else", () => {
    const plain = combatantOf(destroyer([]));
    const s = destroyer([officerWith("tac.weaponCommand")]);
    expect(officerCombatMods(s, s.ships[0])).toEqual({ weaponDamage: 0.1, shield: 0, hull: 0, evasion: 0 });
    const c = combatantOf(s);
    expect(c.weapons.length).toBeGreaterThan(0);
    c.weapons.forEach((w, i) => {
      expect(w.yieldMin).toBe(Math.round(plain.weapons[i].yieldMin * 1.1));
      expect(w.yieldMax).toBe(Math.round(plain.weapons[i].yieldMax * 1.1));
    });
    expect([c.shieldMax, c.hullMax, c.evasion]).toEqual([plain.shieldMax, plain.hullMax, plain.evasion]);
  });

  it("Shield Command scales the shield pool and recharge (combatant AND the folded carry pools)", () => {
    const plain = combatantOf(destroyer([]));
    const s = destroyer([officerWith("tac.shieldCommand")]);
    const c = combatantOf(s);
    expect(c.shieldMax).toBe(Math.round(plain.shieldMax * 1.1));
    expect(c.shield).toBe(c.shieldMax);
    expect(c.shieldRecharge).toBe(Math.round(plain.shieldRecharge * 1.1));
    const folded = foldedPlayerDefense(SHIP_TYPES.destroyer, equippedFor(s, "ship-1"), officerCombatMods(s, s.ships[0]));
    expect(folded.shieldMax).toBe(c.shieldMax);
    // The patrol seeds its wave-1 shield from the same fold.
    const r = asPrePatrolCurveDispatch(dispatchCaptainOnPatrol(s, 1, "crimsonReaverSweep", "balanced", false));
    expect(patrolOf(r.next).playerShield).toBe(c.shieldMax);
  });

  it("officer evasion ADDS to whatever evasion the combatant already has (never overwrites it)", () => {
    const c = combatantOf(destroyer([]));
    c.evasion = 5; // a future maneuver stat
    applyOfficerCombat(c, { weaponDamage: 0, shield: 0, hull: 0, evasion: 0.1 });
    expect(c.evasion).toBe(15);
  });

  it("Evasive Command gives the ship whole evasion points (0.1 -> 10)", () => {
    expect(combatantOf(destroyer([])).evasion).toBe(0);
    expect(combatantOf(destroyer([officerWith("pilot.evasion")])).evasion).toBe(10);
  });

  it("Inspiring Leader lifts weapons, shields AND hull, compounding with a seat bonus", () => {
    const plain = combatantOf(destroyer([]));
    const s = destroyer([officerWith("tac.weaponCommand"), officerWith("any.inspiringLeader", "executive", "officer-2")]);
    const mods = officerCombatMods(s, s.ships[0])!;
    expect(mods.weaponDamage).toBeCloseTo(1.1 * 1.04 - 1, 12);
    expect(mods.shield).toBeCloseTo(0.04, 12);
    expect(mods.hull).toBeCloseTo(0.04, 12);
    const c = combatantOf(s);
    expect(c.hullMax).toBe(Math.round(plain.hullMax * 1.04));
    expect(c.weapons[0].yieldMax).toBe(Math.round(plain.weapons[0].yieldMax * (1 + mods.weaponDamage)));
  });

  it("D12: the Complement never feeds the combat bonuses (officers only)", () => {
    const s = destroyer([]);
    const withCrew: GameState = {
      ...s,
      ships: s.ships.map((sh) =>
        sh.id === "ship-1"
          ? {
              ...sh,
              complement: {
                mode: "passive",
                buckets: [{ profession: "security", rarity: "legendary", rank: 8, race: "earthBorn", buff1Id: "sec.boarding", buff2Id: "excl.crewOutputMult", count: 50 }],
              },
            }
          : sh,
      ),
    } as GameState;
    expect(officerCombatMods(withCrew, withCrew.ships[0])).toBeUndefined();
  });

  it("a patrol FREEZES the cycle's officer bonuses at dispatch; reseating mid-cycle changes neither the fight nor the replay", () => {
    const s = destroyer([officerWith("tac.weaponCommand"), officerWith("pilot.evasion", "pilot", "officer-2")]);
    const r = asPrePatrolCurveDispatch(dispatchCaptainOnPatrol(s, 1, "crimsonReaverSweep", "balanced", false));
    expect(patrolOf(r.next).officerCombat).toEqual({ weaponDamage: 0.1, shield: 0, hull: 0, evasion: 0.1 });
    // Live: keep the officers seated. Reseated: both officers leave the ship right after dispatch.
    let live = r.next;
    let reseated: GameState = { ...r.next, officers: r.next.officers.map((o) => ({ ...o, assignedShipId: null })) };
    // Advance until the first wave has been fought, while the cycle is still out.
    for (let i = 0; i < 2000 && patrolOf(live).nextWaveIndex < 1; i++) {
      live = economyTick(live, 1, () => 0.5);
      reseated = economyTick(reseated, 1, () => 0.5);
    }
    expect(patrolOf(live).nextWaveIndex).toBeGreaterThanOrEqual(1);
    expect(JSON.stringify(reseated.captains[0].mission)).toBe(JSON.stringify(live.captains[0].mission));
    // The replay reads the frozen record too: it shows the bonuses whoever sits the seat now.
    const replay = replayPatrol(reseated, reseated.captains[0]);
    expect(replay.available).toBe(true);
    expect(replay.waves[0].playerStart.evasion).toBe(10);
    expect(JSON.stringify(replay.waves)).toBe(JSON.stringify(replayPatrol(live, live.captains[0]).waves));
  });

  it("the officer bonuses change the fight (vs the same patrol without them)", () => {
    const off = asPrePatrolCurveDispatch(dispatchCaptainOnPatrol(destroyer([]), 1, "crimsonReaverSweep", "balanced", false)).next;
    const on = asPrePatrolCurveDispatch(dispatchCaptainOnPatrol(
      destroyer([officerWith("tac.weaponCommand"), officerWith("pilot.evasion", "pilot", "officer-2")]),
      1,
      "crimsonReaverSweep",
      "balanced",
      false,
    )).next;
    const a = replayPatrol(off, off.captains[0]);
    const b = replayPatrol(on, on.captains[0]);
    expect(JSON.stringify(b.waves.map((w) => w.log))).not.toBe(JSON.stringify(a.waves.map((w) => w.log)));
  });

  it("a repeat-dispatch RELAUNCH freezes the officers seated at the relaunch", () => {
    // Dispatched with no officer; an officer is seated mid-cycle. The current cycle keeps fighting without
    // the bonus, the NEXT cycle (the relaunch) carries it.
    const r = asPrePatrolCurveDispatch(dispatchCaptainOnPatrol(destroyer([]), 1, "crimsonReaverSweep", "balanced", true));
    let s: GameState = { ...r.next, officers: [officerWith("tac.shieldCommand")] };
    expect(patrolOf(s).officerCombat).toBeUndefined();
    const firstSeed = patrolOf(s).masterSeed;
    for (let i = 0; i < 2000 && patrolOf(s)?.masterSeed === firstSeed; i++) s = economyTick(s, 1, () => 0.5);
    expect(patrolOf(s).masterSeed).not.toBe(firstSeed);
    expect(patrolOf(s).officerCombat).toEqual({ weaponDamage: 0, shield: 0.1, hull: 0, evasion: 0 });
  });

  it("closed form: one big patrol advance equals many small ones with frozen bonuses", () => {
    const s = destroyer([officerWith("tac.weaponCommand"), officerWith("tac.shieldCommand", "tactical", "officer-2")]);
    // Two tactical bonuses on one seat type would be refused by assignOfficerToShip; this fixture seats them
    // directly to stress the fold, which is legal input to the pure functions.
    const r = asPrePatrolCurveDispatch(dispatchCaptainOnPatrol(s, 1, "crimsonReaverSweep", "balanced", true));
    const captain = r.next.captains[0];
    const ship = r.next.ships[0];
    const gear = equippedFor(r.next, "ship-1");
    const effects = { outputShare: 0.06, relaunchCombat: officerCombatMods(r.next, ship) };
    const big = tickCaptainPatrol(600, captain, ship, gear, 1, effects);
    let c = captain;
    let credits = 0;
    const loot: Record<string, Decimal> = {};
    for (let i = 0; i < 600; i++) {
      const step = tickCaptainPatrol(1, c, ship, gear, 1, effects);
      c = step.captain;
      credits += step.creditsDelta;
      for (const [k, v] of Object.entries(step.homePlanetDelta)) loot[k] = (loot[k] ?? new Decimal(0)).plus(v);
    }
    expect(JSON.stringify(c.mission)).toBe(JSON.stringify(big.captain.mission));
    // Whole-unit rewards (Command Presence rounds per wave on a keyed stream), so the sums match EXACTLY.
    expect(big.creditsDelta).toBeGreaterThan(0);
    expect(credits).toBe(big.creditsDelta);
    for (const [k, v] of Object.entries(big.homePlanetDelta)) {
      expect(Number.isInteger(v.toNumber()), k).toBe(true);
      expect((loot[k] ?? new Decimal(0)).toNumber(), k).toBe(v.toNumber());
    }
  });
});

// ============================================================================
// Ship stats: Inspiring Leader (ship-stat half) + Veteran Instincts (unload half)
// ============================================================================
describe("ship-stat bonuses (Inspiring Leader, Veteran Instincts)", () => {
  it("Inspiring Leader lifts cargo, FTL speed, yield, sensors, range and unload; never mass or power", () => {
    const base = freshState();
    const plain = effectiveShipStats(base, base.ships[0]);
    const s = { ...base, officers: [officerWith("any.inspiringLeader")] };
    const lifted = effectiveShipStats(s, s.ships[0]);
    expect(lifted.cargoCapacity).toBeCloseTo(plain.cargoCapacity * 1.04, 9);
    expect(lifted.transitSpeedMult).toBeCloseTo(plain.transitSpeedMult * 1.04, 9);
    expect(lifted.extractionYieldMult).toBeCloseTo(plain.extractionYieldMult * 1.04, 9);
    expect(lifted.fuelCapacity).toBeCloseTo(plain.fuelCapacity * 1.04, 9);
    expect(lifted.sensors).toBeCloseTo(plain.sensors * 1.04, 9);
    expect(lifted.unloadSpeedMult).toBeCloseTo(1.04, 9);
    expect([lifted.mass, lifted.powerOutput, lifted.powerDraw, lifted.engineEfficiency]).toEqual([
      plain.mass,
      plain.powerOutput,
      plain.powerDraw,
      plain.engineEfficiency,
    ]);
  });

  it("Veteran Instincts speeds the unload (turnaround) and nothing else on the ship sheet", () => {
    const base = freshState();
    const plain = effectiveShipStats(base, base.ships[0]);
    const s = { ...base, officers: [officerWith("any.veteranInstincts")] };
    const v = effectiveShipStats(s, s.ships[0]);
    expect(v.unloadSpeedMult).toBeCloseTo(1.06, 12);
    expect({ ...v, unloadSpeedMult: undefined }).toEqual({ ...plain, unloadSpeedMult: undefined });
  });

  it("the ship-stat lifts ride the crew map as OFFICER-ONLY keys (no Complement exclusive-pool key is lit)", () => {
    const base = freshState();
    const s = { ...base, officers: [officerWith("any.inspiringLeader"), officerWith("any.veteranInstincts", "pilot", "officer-2"), officerWith("xo.commandOutput", "executive", "officer-3")] };
    const crew = shipCrewContribution(s, s.ships[0]);
    expect(crew[CREW_STAT_KEYS.crewOutputMult]).toBeUndefined();
    expect(crew[CREW_STAT_KEYS.missionTurnaround]).toBeUndefined();
    expect(crew["officer.allStatsMult"]).toBeCloseTo(0.04, 12);
    expect(crew["officer.missionTurnaroundCut"]).toBeCloseTo(0.06, 12);
  });
});

// ============================================================================
// Shipyard repair: Rapid Recovery + Veteran Instincts (repair half)
// ============================================================================
describe("Shipyard repair (Rapid Recovery, Veteran Instincts)", () => {
  function damaged(officers: SeniorStaffOfficer[]): GameState {
    const base = installMissingCombatBaselines({ ...freshState(), officers });
    return {
      ...base,
      ships: base.ships.map((sh) => (sh.id === "ship-1" ? { ...sh, typeKey: "destroyer" as ShipTypeKey, damaged: true, repairDamage: 437 } : sh)),
    };
  }
  const repairTicks = (s: GameState): number =>
    processShipRepairs(installMissingCombatBaselines(s)).activeProcesses.find((p) => p.kind === "shipRepair")!.durationTicks;

  it("Rapid Recovery divides the repair by (1 + share), ceil", () => {
    const raw = repairTicks(damaged([]));
    const s = damaged([officerWith("med.recovery")]);
    expect(officerRepairSpeedBonus(s, s.ships[0])).toBeCloseTo(0.1, 12);
    expect(repairTicks(s)).toBe(Math.ceil(raw / 1.1));
  });

  it("Veteran Instincts adds to the same divisor; the two stack additively (D23 divisor, never 0)", () => {
    const raw = repairTicks(damaged([]));
    const s = damaged([officerWith("med.recovery"), officerWith("any.veteranInstincts", "pilot", "officer-2")]);
    expect(repairTicks(s)).toBe(Math.ceil(raw / 1.16));
    expect(shipRepairDurationTicks(s.ships[0], [], 1e9)).toBeGreaterThanOrEqual(1);
  });
});

// ============================================================================
// Command Presence: mission output
// ============================================================================
describe("Command Presence (mission output)", () => {
  const xo = () => [officerWith("xo.commandOutput")];

  // Each delivered cycle (or won wave) rounds its boosted amounts back to WHOLE units with chanceRound on a
  // private keyed stream, so over C deliveries a total sits within C units of the exact x1.06.
  const isWhole = (d: Decimal): boolean => Number.isInteger(d.toNumber());

  it("grows a run's delivered haul and credits by the share, keeping whole amounts whole", () => {
    const N = 700;
    const plain = runTicks(missionState("shortOreRun"), N, lcg(7));
    const boosted = runTicks(missionState("shortOreRun", xo()), N, lcg(7));
    const s = missionState("shortOreRun", xo());
    expect(officerMissionOutputBonus(s, s.ships[0])).toBeCloseTo(0.06, 12);
    const cycles = plain.lifetimeStats.missionsCompleted.shortOreRun.toNumber();
    expect(cycles).toBeGreaterThan(0);
    let grew = false;
    for (const key of Object.keys(plain.inventory)) {
      const a = itemTotal(plain.inventory, key);
      const b = itemTotal(boosted.inventory, key);
      expect(isWhole(a) && isWhole(b), key).toBe(true);
      expect(Math.abs(b.toNumber() - a.toNumber() * 1.06), key).toBeLessThanOrEqual(cycles);
      if (b.gt(a)) grew = true;
    }
    expect(grew).toBe(true);
    const earnedPlain = plain.credits.minus(1_000_000).toNumber();
    const earnedBoosted = boosted.credits.minus(1_000_000).toNumber();
    expect(earnedPlain).toBeGreaterThan(0);
    expect(Number.isInteger(earnedBoosted)).toBe(true);
    expect(Math.abs(earnedBoosted - earnedPlain * 1.06)).toBeLessThanOrEqual(cycles);
    // Deterministic: the same run twice lands on the same totals (the rounding stream is keyed, not shared).
    expect(JSON.stringify(runTicks(missionState("shortOreRun", xo()), N, lcg(7)).inventory)).toBe(JSON.stringify(boosted.inventory));
  });

  it("closed form: one big mission advance equals many small ones with the output bonus", () => {
    const captain = missionState("shortOreRun").captains[0];
    const stats = effectiveShipStats(freshState(), freshState().ships[0]);
    const bonuses = { missionOutputMult: 0.06 };
    const big = tickCaptainMission(1000, captain, lcg(3), bonuses, stats);
    let c = captain;
    const rng = lcg(3);
    let credits = 0;
    const loot: Record<string, Decimal> = {};
    for (let i = 0; i < 1000; i++) {
      const step = tickCaptainMission(1, c, rng, bonuses, stats);
      c = step.captain;
      credits += step.creditsDelta;
      for (const [k, v] of Object.entries(step.homePlanetDelta)) loot[k] = (loot[k] ?? new Decimal(0)).plus(v);
    }
    expect(big.creditsDelta).toBeGreaterThan(0);
    expect(credits).toBe(big.creditsDelta);
    for (const [k, v] of Object.entries(big.homePlanetDelta)) expect((loot[k] ?? new Decimal(0)).toNumber(), k).toBe(v.toNumber());
    expect(JSON.stringify(c.mission)).toBe(JSON.stringify(big.captain.mission));
    expect((big.captain.mission as { outputRoundCursor?: number }).outputRoundCursor).toBeGreaterThan(0);
  });

  it("an amount that was ALREADY fractional (a yield bonus) is scaled exactly, not rounded", () => {
    // Breakthrough Analysis (+10% yield) makes every extracting tick deliver a fractional amount, so the
    // haul was fractional before Task 20 too: Command Presence then scales it exactly.
    const yieldOfficer = officerWith("sci.yieldSurge", "science", "officer-2");
    const N = 700;
    const plain = runTicks(missionState("shortOreRun", [yieldOfficer]), N, lcg(7));
    const boosted = runTicks(missionState("shortOreRun", [yieldOfficer, ...xo()]), N, lcg(7));
    const a = itemTotal(plain.inventory, "commonOre");
    expect(isWhole(a)).toBe(false);
    expect(itemTotal(boosted.inventory, "commonOre").toNumber()).toBeCloseTo(a.toNumber() * 1.06, 6);
  });

  it("grows a transport run's net margin", () => {
    const N = 700;
    const plain = runTicks(missionState("frontierSupplyRun"), N, lcg(9));
    const boosted = runTicks(missionState("frontierSupplyRun", xo()), N, lcg(9));
    const cycles = plain.lifetimeStats.missionsCompleted.frontierSupplyRun.toNumber();
    const earnedPlain = plain.credits.minus(1_000_000).toNumber();
    const earnedBoosted = boosted.credits.minus(1_000_000).toNumber();
    expect(earnedPlain).toBeGreaterThan(0);
    expect(Number.isInteger(earnedPlain)).toBe(true);
    expect(Number.isInteger(earnedBoosted)).toBe(true);
    expect(earnedBoosted).toBeGreaterThan(earnedPlain);
    expect(Math.abs(earnedBoosted - earnedPlain * 1.06)).toBeLessThanOrEqual(cycles);
  });

  it("grows a patrol's loot and bounty, in whole units", () => {
    const run = (officers: SeniorStaffOfficer[]) => {
      let s = asPrePatrolCurveDispatch(dispatchCaptainOnPatrol(patrolState("destroyer", officers), 1, "crimsonReaverSweep", "balanced", false)).next;
      for (let i = 0; i < 400; i++) s = economyTick(s, 1, () => 0.5);
      return s;
    };
    const plain = run([]);
    const boosted = run(xo());
    const waves = 3; // a non-repeat crimsonReaverSweep route fights at most 3 waves
    const earned = plain.credits.minus(100000).toNumber();
    const earnedBoosted = boosted.credits.minus(100000).toNumber();
    expect(earned).toBeGreaterThan(0);
    expect(Number.isInteger(earnedBoosted)).toBe(true);
    expect(earnedBoosted).toBeGreaterThan(earned);
    expect(Math.abs(earnedBoosted - earned * 1.06)).toBeLessThanOrEqual(waves);
    for (const key of Object.keys(boosted.inventory)) expect(isWhole(itemTotal(boosted.inventory, key)), key).toBe(true);
  });
});

// ============================================================================
// Discovery Instinct: survey rare drops
// ============================================================================
describe("Discovery Instinct (survey rare drops)", () => {
  const sci = () => [officerWith("sci.discovery")];

  it("raises a survey's rare-tier odds by the crew rare find (the threshold moves, the draws do not)", () => {
    // surveyMineralAnomaly's rareChance is 0.03; Discovery Instinct (0.12) lifts it to 0.03 * 1.12 = 0.0336.
    // A constant roll of 0.032 sits between the two: every extracting tick rolls rare WITH the officer and
    // never without it (it falls through to the uncommon tier instead).
    const N = 700;
    const roll = () => 0.032;
    const plain = runTicks(missionState("surveyMineralAnomaly"), N, roll);
    const boosted = runTicks(missionState("surveyMineralAnomaly", sci()), N, roll);
    expect(itemTotal(plain.inventory, "osmiumOre").toNumber()).toBe(0);
    expect(itemTotal(boosted.inventory, "osmiumOre").toNumber()).toBeGreaterThan(0);
  });

  it("leaves a NON-survey run's haul untouched", () => {
    const N = 700;
    const plain = runTicks(missionState("shortOreRun"), N, lcg(5));
    const boosted = runTicks(missionState("shortOreRun", sci()), N, lcg(5));
    expect(JSON.stringify(boosted.inventory)).toBe(JSON.stringify(plain.inventory));
  });
});

// ============================================================================
// Away team: Fleet Triage + Morale Anchor (frozen on the Expedition at dispatch)
// ============================================================================
describe("away-team bonuses (Fleet Triage, Morale Anchor)", () => {
  const withOfficers = (officers: SeniorStaffOfficer[]): GameState => ({
    ...freshState(),
    awayMembers: GOLDEN_ROSTER,
    nextAwayMemberId: 100,
    officers,
  });
  const dispatch = (s: GameState) => start(s, "ship-1", 1, expeditionCandidates(s, "ship-1")[0].id);

  it("freezes squadTriage / squadFearResist at dispatch (only when non-zero)", () => {
    const plain = dispatch(withOfficers([])).expedition!;
    expect("squadTriage" in plain || "squadFearResist" in plain).toBe(false);
    const exp = dispatch(withOfficers([officerWith("med.fleetTriage"), officerWith("xo.moraleAnchor", "executive", "officer-2")])).expedition!;
    expect(exp.squadTriage).toBeCloseTo(0.15, 12);
    expect(exp.squadFearResist).toBeCloseTo(0.08, 12);
  });

  it("Fleet Triage strengthens a medic's heal and every member's first aid; an untrained member still heals 0", () => {
    const s = withOfficers([]);
    const roster = snapshotAwayRoster(s, s.ships[0]);
    const plain = buildRosterCombatants(roster.security, 0, "t");
    const cared = buildRosterCombatants(roster.security, 0, "t", undefined, { triage: 0.15 });
    plain.forEach((c, i) => {
      expect(cared[i].heal).toBeCloseTo(c.heal * 1.15, 12);
      expect(cared[i].careMult).toBe(1.15);
      expect(c.careMult).toBeUndefined();
    });
    expect(plain.some((c) => c.heal > 0)).toBe(true); // the field medic
    expect(plain.some((c) => c.heal === 0)).toBe(true);
  });

  it("Fleet Triage's first aid restores more HP in battle", () => {
    // A two-member team: an UNTRAINED actor whose program uses team kit on an afflicted ally, and a
    // poisoned, wounded ally. Same seed with and without the care multiplier.
    const mk = (careMult?: number): GroundCombatant[] => {
      const actor: GroundCombatant = {
        id: "t-sec-0", side: "team", role: "security", hp: 80, hpMax: 80, power: 1, accuracy: 0.9, armor: 2, heal: 0,
        threat: 1, groupTag: "security", statuses: [], downed: false, memberId: "a",
        program: [{ target: "allyHasStatus", action: "useItem" }, { target: "foeNearest", action: "attack" }],
      };
      if (careMult !== undefined) actor.careMult = careMult;
      const ally: GroundCombatant = {
        id: "t-sec-1", side: "team", role: "security", hp: 20, hpMax: 80, power: 1, accuracy: 0.9, armor: 2, heal: 0,
        threat: 1, groupTag: "security", statuses: [{ id: "poison", magnitude: 3, remaining: 4 }], downed: false, memberId: "b",
        program: [{ target: "foeNearest", action: "attack" }],
      };
      return [actor, ally];
    };
    const firstAidHp = (careMult?: number): number => {
      const log: GambitLogEvent[] = [];
      resolveGroundBattle(mk(careMult), generateEncounter(77, 0, "ancientRuins"), 3, makeRng(99), log);
      const ev = log.find((e) => e.action === "useItem" && (e.hpDelta ?? 0) > 0);
      return ev?.hpDelta ?? 0;
    };
    const plain = firstAidHp();
    expect(plain).toBeGreaterThan(0);
    expect(firstAidHp(1.6)).toBeGreaterThan(plain);
  });

  it("Morale Anchor gives every member Fear resist, combined with a member's own as independent chances", () => {
    const s = withOfficers([]);
    const roster = snapshotAwayRoster(s, s.ships[0]);
    const plain = buildRosterCombatants(roster.security, 0, "t");
    const anchored = buildRosterCombatants(roster.security, 0, "t", undefined, { fearResist: 0.08 });
    anchored.forEach((c, i) => {
      const own = (plain[i].resists?.fear ?? 0) / 1000;
      expect(c.resists?.fear).toBe(Math.round((1 - (1 - own) * (1 - 0.08)) * 1000));
    });
    // A member with their own Fear resist (Iron Will) still gains, and never reaches certainty.
    const iron = buildRosterCombatants(
      [{ ...roster.security[0], resists: { ...roster.security[0].resists, fear: 0.9 } }],
      0,
      "t",
      undefined,
      { fearResist: 0.08 },
    );
    expect(iron[0].resists?.fear).toBe(Math.round((1 - 0.1 * 0.92) * 1000));
    expect(iron[0].resists!.fear!).toBeLessThan(1000);
  });

  // Wiring OC-G1: the squad is read on the Ground Ops objective fight (groundFight.ts taskFightTeam), the legacy builder
  // having gone with the legacy path.
  it("the run's battles read the frozen fields (taskFightTeam), and offline == live", () => {
    const s = withOfficers([officerWith("med.fleetTriage"), officerWith("xo.moraleAnchor", "executive", "officer-2")]);
    const res = dispatch(s);
    const ops = res.expedition!.groundOps!;
    const team = taskFightTeam(res.expedition!, ops.teams.map((t, i) => ({ securityIds: t.securityIds, securityShare: ops.factors.securityShare[i] ?? 0 })), { id: "x", fightCount: 0 });
    expect(team.length).toBeGreaterThan(0);
    expect(team.every((c) => c.careMult === 1.15 && (c.resists?.fear ?? 0) >= 80)).toBe(true);
    // Reseating the officers after dispatch never changes the run (it reads only the stored record).
    const big = advanceExpedition(res.expedition!, 1_000_000);
    let small = res.expedition!;
    for (let i = 0; i < 400 && small.phase !== "complete"; i++) small = advanceExpedition(small, 3600);
    small = advanceExpedition(small, 1_000_000);
    expect(JSON.stringify(small)).toBe(JSON.stringify(big));
  }, 60_000);
});

// ============================================================================
// The audit: every rollable officer bonus has a live consumer, or is pending in this release
// ============================================================================
// E-MOD EM-1: a fresh state whose ship-1 carries a cargo bay drawing power (Standard Issue draws none).
const POWERED_DRAW = 40;
function poweredFresh(): GameState {
  const base = freshState();
  return { ...base, equipment: base.equipment.map((e) => (e.fittedToShipId === "ship-1" && e.slotType === "cargoBay" ? { ...e, powerDraw: POWERED_DRAW } : e)) };
}

describe("every officer bonus is live (or pending in this release)", () => {
  it("no bonus is pending: Reactor Overdrive went live with the E-MOD power budget (EM-1)", () => {
    expect(OFFICER_BONUSES_PENDING_IN_RELEASE).toEqual({});
    const base = poweredFresh();
    const s = { ...base, officers: [officerWith("eng.overdrive")] };
    // It lands on crew.powerEfficiency (shared with the Engineering division) and cuts the net draw.
    expect(shipCrewContribution(s, s.ships[0])[CREW_STAT_KEYS.powerEfficiency]).toBeCloseTo(0.1, 12);
    expect(effectiveShipStats(base, base.ships[0]).powerDraw).toBe(POWERED_DRAW);
    expect(effectiveShipStats(s, s.ships[0]).powerDraw).toBe(netPowerDraw(POWERED_DRAW, 0.1));
    expect(effectiveShipStats(s, s.ships[0]).powerDraw).toBeLessThan(POWERED_DRAW);
  });

  it("each other bonus changes at least one derived value vs no officer", () => {
    const shipValues = (s: GameState) => {
      const ship = s.ships[0];
      const rosterState = { ...s, awayMembers: GOLDEN_ROSTER, nextAwayMemberId: 100 };
      const exp = start(rosterState, "ship-1", 1, expeditionCandidates(rosterState, "ship-1")[0].id).expedition!;
      return JSON.stringify({
        stats: effectiveShipStats(s, ship),
        combat: officerCombatMods(s, ship) ?? null,
        repair: officerRepairSpeedBonus(s, ship),
        output: officerMissionOutputBonus(s, ship),
        crewRareFind: exp.crewRareFind,
        encounterEvasion: exp.encounterEvasion,
        triage: exp.squadTriage ?? 0,
        fear: exp.squadFearResist ?? 0,
      });
    };
    // E-MOD EM-1: on a ship drawing power, so Reactor Overdrive's net-draw cut shows too.
    const baseline = shipValues(poweredFresh());
    for (const def of SENIOR_STAFF_BONUSES) {
      if (OFFICER_BONUSES_PENDING_IN_RELEASE[def.statKey]) continue;
      const s = { ...poweredFresh(), officers: [officerWith(def.id)] };
      expect(shipValues(s), def.label).not.toBe(baseline);
    }
  });
});
