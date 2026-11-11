// Field Kits FK-3 (docs/plans/2026-10-14-field-kits-plan.md section 0 "Flag-neutral", section 4 FK-3): golden hashes
// captured on the code BEFORE any Field Kits engine edit. A run WITHOUT `Expedition.fieldKits` (every run dispatched
// before FK-6, legacy and Ground Ops alike) must advance, fight, roll and claim byte-identically in every later
// slice. Each fixture is dispatched (or hand-built from a real dispatch), passed through withoutFieldKits
// (awayTeamTestFixtures.ts; today it strips nothing, from FK-6 on it strips the flag, packs, treatment and the
// fight record's kit fields), then hashed at five checkpoints, its phase read at 2,000,000 s, and its claim hashed.
//
//   (legacy, legacyDevices: RETIRED by Wiring OC-G1, user 2026-10-16 "Delete it": the two runs without groundOps pinned
//                   only the deleted legacy engine path; their golden, parity and event-boundary parity tests went with it.)
//   preSq4        : a Ground Ops run dispatched before SQ-4 (no risk profile, BOTH Ground teams deploy).
//   riskAware     : a risk-aware run before AF-1 (Tier IV enemy territory, no affix flag: SQ-4 + clearing).
//   affixCat1     : affix catalog 1 (AF-1): a Reinforcing objective, a weak crew, a loss raises the ALERT.
//   affixCat2     : affix catalog 2 (AF-2): Reinforcing plus NEGATIVE Rocky Outcroppings on a rifle squad.
//   tierSeven     : a real Tier VII enemy territory dispatch (forced region: play is Tier I only).
//   ossirBleed    : an Ossir member (Stoneskin) fielded with a carried Bleed, into the fight and the bay.
//   shroud / lure / bothDevices : a Shroud Emitter (-0.4), a Lure Beacon (+0.4), and one Shroud with three Lures
//                   (+0.8) worn on a run with ship events (the ship-event chance and step roll at EVERY scan
//                   boundary are hashed too).
// Every fixture also hashes MID-RUN checkpoints read off its own history (the middle of the first bay stay and of the
// first recovery leg), so the carry, the trip conditions and bayEnds are pinned while they are live.
// Plus: an Ossir member taking Bleed in a battle (enemies stamped with a Bleed on-hit), the threat odds of three
// objectives, and offline == live parity on the same fixtures: one call == 997 s chunks == 1 s steps over a busy
// stretch, and an EVENT-BOUNDARY chain (t - 1, t, t + 1 at every recorded step boundary, log line and ship leg).
// FKR-0 (2026-10-16, REVISED SLICES) adds its own fixtures and captures at the bottom of this file (grenade wearers,
// final and reinforcement fights, odds per difficulty grade, crafted grenade rolls, a loadout round trip), through the
// same whole-run suites; the claim hashes now pass through the state twin withoutFieldKitsState (identity today).

import { describe, expect, it } from "vitest";
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
import { EQUIPMENT_SLOTS, FIELD_KITS_PLAYER_LIVE, freshState, grenadeCraftPool, type AwayMember, type BodyRiskGrades, type EquipmentInstance, type Expedition, type ExpeditionActivity, type ExpeditionBody, type GameState, type GroundStepRecord, type ShipGroundTeam } from "./model";
import { advanceExpedition, claimExpedition, expeditionCandidates, scanStepRoll, shipScanEventChance, squadEncounterBias, PRE_FKR8_DEVICE_EFFECTIVENESS } from "./expedition";
import { bodyFloraGrade, generateRiskProfile, type ExpeditionRegion } from "./riskFactors";
import { groundOpsAssignIdle, groundOpsBodyScanned, initGroundTasks, taskCover } from "./groundOps";
import { alertLevelAt, rollReinforcements, type ObjectiveAffix } from "./affixes";
import { resolveTaskFight, taskFightSeed, taskFightTeam, withEscalation, withFloraToxins, type GroundFightTeam } from "./groundFight";
import { generateEncounter, resolveGroundBattle, type GambitLogEvent } from "./gambit";
import { makeRng } from "./combat/rng";
import { groundTaskClearOdds, groundThreatOddsKey } from "./groundThreat";
import { shipEventsLive } from "./shipScanEvents";
import { resistedHazard } from "./relics";
import { inspectBlank } from "./tick";
import { applyGroundTeamLoadout, checkInGroundTeamLoadout, createGroundTeamLoadout } from "./armory";
import { deserialize, migrate, serialize } from "./save";
import { asPreG2NamesDispatch, plainAwayMember, withSlottedAwayTeams, withoutAffixes, withoutFieldKits, withoutFieldKitsState, withoutRisk, withoutSafeFirstRuns, dispatchPastPropulsion } from "./awayTeamTestFixtures";
// SF-1: whole states hash without the run counters (seeded by freshState, written by a claim), absent before SF-1.
import { withoutRunCounts, goldenJson } from "./firstRunsGoldens.fixture";
// WR-8 (0.14.0): every pin in this file was taken before the combat rules (combatRulesSwitch.fixture.ts), so the file
// runs with them switched off and its pins keep proving WR-8 moved nothing else here (the rules stamp new patrol
// cycles and runs; combatDescriptorGoldens.test.ts pins the combat rules themselves).
import { combatRulesOffForThisFile } from "./combatRulesSwitch.fixture";
import { wr11OffForThisFile } from "./wr11Switch.fixture";
combatRulesOffForThisFile();
// Wiring WR-11 came after every pin here: the whole file runs with WR-11 off (wr11Switch.fixture.ts), so its pins keep
// proving their own slice moved nothing else (WR-11's own moves are pinned in wr11Goldens.test.ts).
wr11OffForThisFile();

// ===== shared helpers =====

function fnv(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16);
}

const T0 = 100_000;
const CHECKPOINTS = [5000, 20000, 60000, 150000, 400000].map((d) => T0 + d);
const FINAL = T0 + 2_000_000;
const SEC = ["member-1", "member-2", "member-3", "member-4", "member-5", "member-6"];
const SCI = ["member-11", "member-12", "member-13", "member-14", "member-15", "member-16"];
const CALM: BodyRiskGrades = { combat: 0, fauna: 0, flora: 0, hazard: 0 };

const member = (id: string, teamType: AwayMember["teamType"], over: Partial<AwayMember> = {}): AwayMember => ({
  ...plainAwayMember(id, teamType, "ship-1"),
  ...over,
});

// Advance in `step` second chunks from `from` to `to` (inclusive of `to`).
function chunked(exp: Expedition, from: number, to: number, step: number): Expedition {
  let e = exp;
  for (let t = from + step; t < to; t += step) e = advanceExpedition(e, t);
  return advanceExpedition(e, to);
}

// ship-1: Ground + Ground (or Strike + Survey) fully slotted at `rank`, the game clock at T0.
function crewed(expeditionSeed: number, kinds: "gg" | "ss" = "gg", rank = 6, equipment: EquipmentInstance[] = []): GameState {
  const base = freshState();
  const m = (id: string, t: AwayMember["teamType"]): AwayMember => member(id, t, { rank: rank as AwayMember["rank"] });
  const teams: ShipGroundTeam[] =
    kinds === "gg"
      ? [
          { kind: "ground", security: SEC.slice(0, 3), science: SCI.slice(0, 3), helpOthers: false },
          { kind: "ground", security: SEC.slice(3), science: SCI.slice(3), helpOthers: false },
        ]
      : [
          { kind: "strike", security: SEC.slice(), science: [], helpOthers: false },
          { kind: "survey", security: [], science: SCI.slice(), helpOthers: false },
        ];
  return {
    ...base,
    gameTimeSeconds: T0,
    expeditionSeed,
    awayMembers: [...SEC.map((id) => m(id, "security")), ...SCI.map((id) => m(id, "science"))],
    equipment: [...base.equipment, ...equipment],
    nextAwayMemberId: 100,
    ships: base.ships.map((sh) => ({ ...sh, groundTeams: teams })),
  };
}

// Dispatch candidate 0, optionally on a forced region (the risk replaced before any body scans).
function dispatch(state: GameState, region?: ExpeditionRegion): { next: GameState; exp: Expedition } {
  const res = asPreG2NamesDispatch(dispatchPastPropulsion(state, "ship-1", 1, expeditionCandidates(state, "ship-1")[0].id));
  if (!res.success || !res.expedition) throw new Error(`dispatch refused: ${res.reason}`);
  // Safe first runs SF-2: the run as dispatched before SF-2 (the retired 30 minute shakedown on expedition 1).
  let exp = withoutFieldKits(withoutSafeFirstRuns(res.expedition));
  if (region) {
    const forced = generateRiskProfile(exp.seed, region, exp.bodies);
    exp = { ...exp, risk: forced.profile, bodies: exp.bodies.map((b, i) => ({ ...b, risk: forced.bodies[i] })) };
  }
  return { next: res.next, exp };
}

// One Ground team slotted (3 / 3) at `rank` and an empty pair: one team deploys. `over` edits a member.
function oneTeam(rank = 1, over: Record<string, Partial<AwayMember>> = {}, equipment: EquipmentInstance[] = []): GameState {
  const base = freshState();
  const m = (id: string, t: AwayMember["teamType"]): AwayMember => member(id, t, { rank: rank as AwayMember["rank"], ...(over[id] ?? {}) });
  const teams: ShipGroundTeam[] = [
    { kind: "ground", security: SEC.slice(0, 3), science: SCI.slice(0, 3), helpOthers: false },
    { kind: "ground", security: [null, null, null], science: [null, null, null], helpOthers: false },
  ];
  return {
    ...base,
    gameTimeSeconds: T0 - 50_000,
    awayMembers: [...SEC.slice(0, 3).map((id) => m(id, "security")), ...SCI.slice(0, 3).map((id) => m(id, "science"))],
    ...(equipment.length > 0 ? { equipment: [...base.equipment, ...equipment] } : {}),
    nextAwayMemberId: 100,
    ships: base.ships.map((sh) => ({ ...sh, groundTeams: teams })),
  };
}

interface HandSetup {
  state: GameState;
  pois: string[];
  risk: BodyRiskGrades;
  seed?: number;
  securityStrength?: number;
  // The risk profile's affix fields: "none" (risk-aware, before AF-1), 1 (AF-1 catalog), 2 (AF-2 catalog).
  catalog: "none" | 1 | 2;
  after?: (e: Expedition) => void; // edit the stamped tasks (and the roster) before the plan
  afterPlan?: (e: Expedition) => void; // edit the queues before the teams pick
  afterPick?: (e: Expedition) => void; // edit the teams after they pick (a carry)
}

// A real dispatch turned into a run whose window opened at T0 with ONE body (carrying `risk`) just scanned: its
// tasks stamped through the real path, then planned, then the teams pick (the groundOpsAffixes / Outcroppings
// pattern).
function handRun(setup: HandSetup): { next: GameState; exp: Expedition } {
  const res = asPreG2NamesDispatch(dispatchPastPropulsion(setup.state, "ship-1", 1, "cand-0"));
  if (!res.success || !res.expedition) throw new Error(`dispatch refused: ${res.reason}`);
  const d = withoutFieldKits(withoutSafeFirstRuns(res.expedition)); // SF-2: as dispatched before SF-2 (see dispatch)
  const body: ExpeditionBody = {
    id: "body-1",
    planetType: "terrestrial",
    scanTotal: 100,
    scanProgress: 100,
    hazard: 0.1,
    scanned: true,
    discoveries: setup.pois.map((poiId, k) => ({ id: `${d.id}-body-1-disc-${k}`, kind: "landmark", poiId })),
    activities: setup.pois.map((poiId, k) => ({ id: `${d.id}-body-1-act-${k}`, bodyId: "body-1", poiId, done: false })),
    risk: { ...setup.risk },
  };
  const affix = setup.catalog === "none" ? {} : setup.catalog === 1 ? { difficultyTier: 1 } : { difficultyTier: 1, affixCatalog: 2 };
  const exp: Expedition = structuredClone({
    ...d,
    seed: setup.seed ?? d.seed,
    ...(setup.securityStrength !== undefined ? { securityStrength: setup.securityStrength } : {}),
    phase: "activities",
    phaseAnchorSeconds: T0,
    bodies: [body],
    scanStepCursor: Math.max(0, (d.encounterSteps ?? 1) - 1),
    groundOps: { ...d.groundOps!, startedAt: T0 },
    risk: { version: 1, tier: 1, enemyTerritory: false, system: { combat: setup.risk.combat, fauna: setup.risk.fauna, flora: setup.risk.flora }, ...affix },
  });
  initGroundTasks(exp, 0);
  setup.after?.(exp);
  for (const team of exp.groundOps!.teams) team.stepStartedAt = T0;
  groundOpsBodyScanned(exp, 0, T0);
  setup.afterPlan?.(exp);
  groundOpsAssignIdle(exp, T0);
  setup.afterPick?.(exp);
  return { next: res.next, exp };
}

const tasksOf = (e: Expedition): ExpeditionActivity[] => e.bodies[0].activities;
const R = (rank: number): ObjectiveAffix => ({ id: "reinforcing", rank, alignment: "negative" });
const RO = (rank: number, alignment: ObjectiveAffix["alignment"]): ObjectiveAffix => ({ id: "rockyOutcroppings", rank, alignment });
const memberPiece = (varietyKey: string) => ({ pieceId: `piece-${varietyKey}`, slotType: "memberWeapon" as const, varietyKey, points: 0 });

// A seed whose first Reinforcing strike for `affixes` lands early on the bar (before the first fight point).
function earlyStrikeSeed(affixes: ObjectiveAffix[]): number {
  let seed = 1;
  while ((rollReinforcements(seed, 0, 0, affixes)[0] ?? 1) > 0.2) seed += 1;
  return seed;
}

// A crafted member Tool worn by `wearer` (Shroud Emitter / Lure Beacon are memberTool varieties).
function tool(id: string, variety: string, wearer: string): EquipmentInstance {
  return {
    id,
    slotType: "memberTool",
    moduleVariant: variety,
    rarity: "standard",
    ascension: "none",
    quality: 0,
    iLevel: 10,
    blueprintKey: "bp-test",
    implicitStats: {},
    rolledStats: {},
    mass: 0,
    powerDraw: 0,
    durabilityMax: 100,
    fittedToShipId: null,
    fittedToMemberId: wearer,
  };
}

// The device-read chance and the step roll at EVERY scan boundary of the run (bodyIndex, step 1..steps-1), at the
// dispatch hour and 24 h out (the Constitution ramp's clock): the ship-event chance (every fixture here is a Ground Ops
// run since OC-G1 retired the legacy ones). FK-7 multiplies the device dial per boundary on flagged runs only; an
// unflagged run keeps exactly these.
function boundaryReads(exp: Expedition): unknown[] {
  const steps = exp.encounterSteps ?? 1;
  const out: unknown[] = [];
  exp.bodies.forEach((body, i) => {
    for (let k = 1; k < steps; k += 1) {
      for (const hours of [0, 24]) {
        const chance = shipScanEventChance(exp, body, hours);
        out.push([i, k, hours, chance, scanStepRoll(exp, i, k, hours)]);
      }
    }
  });
  return out;
}

// Does the run roll at its scan boundaries (a Ground Ops run with ship events)?
const rollsBoundaries = (exp: Expedition): boolean => shipEventsLive(exp);

// Every step record the run's history has shown at the checkpoints (the display history is capped, so the union of
// the one-call reads), in time order. Pure.
function seenHistory(exp: Expedition): GroundStepRecord[] {
  const seen = new Map<string, GroundStepRecord>();
  for (const t of CHECKPOINTS) {
    for (const r of advanceExpedition(exp, t).groundOps?.history ?? []) seen.set(`${r.teamIndex}:${r.step}:${r.startedAt}`, r);
  }
  return [...seen.values()].sort((a, b) => a.startedAt - b.startedAt || a.teamIndex - b.teamIndex);
}

// The MID-RUN checkpoints read off the fixture's own history: the middle of the first bay stay and of the first
// recovery leg (whichever the run has). Whole seconds. Pure.
function midRunPoints(exp: Expedition): number[] {
  const out: number[] = [];
  const bay = seenHistory(exp).find((r) => r.step === "bay" && r.endedAt > r.startedAt + 2);
  if (bay) out.push(Math.floor((bay.startedAt + bay.endedAt) / 2));
  const leg = advanceExpedition(exp, CHECKPOINTS[CHECKPOINTS.length - 1]).groundOps!.shipLegs[0];
  if (leg) out.push(Math.floor((leg.startsAt + leg.endsAt) / 2));
  return out;
}

// Every recorded event time before `to`: each step record's start and end, each log line, each ship leg's start,
// arrival and end. Sorted, unique, after T0. Pure.
function eventTimes(exp: Expedition, to: number): number[] {
  const times = new Set<number>();
  for (const r of seenHistory(exp)) {
    times.add(r.startedAt);
    times.add(r.endedAt);
  }
  const ops = advanceExpedition(exp, to).groundOps;
  for (const l of ops?.log ?? []) times.add(l.at);
  for (const leg of ops?.shipLegs ?? []) for (const t of [leg.startsAt, leg.arrivesAt, leg.endsAt]) times.add(t);
  return [...times].filter((t) => Number.isFinite(t) && t > T0 + 1 && t + 1 < to).sort((a, b) => a - b);
}

// The 1 s parity window (see the parity test). Pure.
function liveWindow(exp: Expedition, hand: boolean): [number, number] {
  if (hand) return [T0, T0 + 3 * 3600];
  const open = advanceExpedition(exp, T0 + 30_000).groundOps!.startedAt!;
  return [open, open + 3600];
}

// ===== the fixtures =====

interface Fixture {
  build: () => { next: GameState; exp: Expedition };
  check?: (done: Expedition, exp: Expedition) => void; // the run holds what it is pinned for
  hand?: true; // a hand-built run (window open at T0): the 1 s steps cover its first 3 hours
  extraAt?: number[]; // extra checkpoints hashed after the five (a moment the fixture is pinned for)
}

const ossirOver = { "member-1": { race: "ossir" as AwayMember["race"] } };
const BLEED = { id: "bleed" as const, magnitude: 7, remaining: 8 };

const FIXTURES: Record<string, Fixture> = {
  preSq4: {
    build: () => {
      const s = withSlottedAwayTeams(
        {
          ...freshState(),
          gameTimeSeconds: T0,
          // Hire order fills Alpha (3 / 3) first, then Bravo (member-4 / member-14): both teams deploy.
          awayMembers: [
            member("member-1", "security", { rank: 3 }),
            member("member-2", "security"),
            member("member-3", "security"),
            member("member-4", "security", { rank: 2 }),
            member("member-11", "science"),
            member("member-12", "science"),
            member("member-13", "science"),
            member("member-14", "science"),
          ],
          nextAwayMemberId: 100,
          expeditionSeed: 0x6eee0,
        },
        2,
      );
      const d = dispatch(s);
      return { next: d.next, exp: withoutRisk(d.exp) };
    },
    check: (done, exp) => {
      expect(exp.groundOps!.teams.length).toBe(2);
      expect(exp.risk).toBeUndefined();
      expect(done.groundOps!.shipLegs.length).toBeGreaterThan(0);
      expect(done.groundOps!.history.some((r) => r.outcome !== undefined)).toBe(true);
    },
  },
  riskAware: {
    build: () => {
      const d = dispatch(crewed(0x0a13bd4), { tier: 4, enemyTerritory: true });
      return { next: d.next, exp: withoutAffixes(d.exp) };
    },
    check: (done, exp) => {
      expect(exp.risk).toBeDefined();
      expect(exp.risk!.difficultyTier).toBeUndefined();
      expect(done.bodies.some((b) => b.activities.some((a) => a.difficulty !== undefined))).toBe(true);
    },
  },
  affixCat1: {
    build: () =>
      handRun({
        state: oneTeam(3),
        seed: earlyStrikeSeed([R(3)]),
        pois: ["derelictOutpost", "mineralOutcrop"],
        risk: { ...CALM },
        securityStrength: 0,
        catalog: 1,
        after: (e) => {
          tasksOf(e)[0].affixes = [R(3)];
          tasksOf(e)[0].difficultyScore = 10;
        },
        afterPlan: (e) => {
          const ids = tasksOf(e).map((t) => t.id);
          e.groundOps!.teams[0].queue = [ids[0], ids[1]];
        },
      }),
    check: (done) => {
      expect(done.risk!.affixCatalog).toBeUndefined();
      expect(done.groundOps!.history.some((r) => r.reinforcement)).toBe(true);
      expect((done.groundOps!.log ?? []).some((l) => l.kind === "alertReset")).toBe(true);
    },
    hand: true,
  },
  affixCat2: {
    build: () => {
      const affixes = [R(3), RO(2, "negative")];
      return handRun({
        state: oneTeam(2),
        seed: earlyStrikeSeed([R(3)]),
        pois: ["derelictOutpost", "crashedShip"],
        risk: { ...CALM, combat: 3 },
        securityStrength: 6,
        catalog: 2,
        after: (e) => {
          for (const m of e.roster!.security) m.gear = [memberPiece("pulseRifle")];
          for (const task of tasksOf(e)) {
            task.affixes = affixes.map((a) => ({ ...a }));
            task.difficultyScore = 6;
          }
        },
      });
    },
    check: (done) => {
      expect(done.risk!.affixCatalog).toBe(2);
      expect(done.groundOps!.history.some((r) => r.reinforcement)).toBe(true);
      expect(done.groundOps!.history.some((r) => r.outcome === "loss")).toBe(true);
    },
    hand: true,
  },
  tierSeven: {
    build: () => dispatch(crewed(0x5eed777), { tier: 7, enemyTerritory: true }),
    check: (_done, exp) => {
      expect(exp.risk!.tier).toBe(7);
      expect(exp.risk!.enemyTerritory).toBe(true);
      expect(exp.risk!.affixCatalog).toBe(2);
    },
  },
  ossirBleed: {
    build: () =>
      handRun({
        state: oneTeam(2, ossirOver),
        pois: ["derelictOutpost", "crashedShip"],
        risk: { ...CALM, combat: 2 },
        catalog: 2,
        afterPick: (e) => {
          // Full HP (47 at rank 2; a carried HP is clamped to the fielded max anyway) and a Bleed with 8 rounds left.
          e.groundOps!.teams[0].carry = { "member-1": { hp: 47, hpMax: 47, statuses: [{ ...BLEED }] } };
        },
      }),
    // Just after the first fight: the Bleed sits in the member's trip conditions (the bay later heals it away).
    extraAt: [T0 + 600],
    check: (_done, exp) => {
      expect(exp.roster!.security.find((m) => m.memberId === "member-1")!.perks).toEqual(["stoneskin"]);
      // The carried Bleed rides into the objective's first fight and comes out of it as a bay condition.
      let bled = false;
      for (let t = T0 + 60; t <= T0 + 3 * 3600 && !bled; t += 60) {
        bled = (advanceExpedition(exp, t).groundOps!.teams[0].conditions["member-1"] ?? []).includes("bleed");
      }
      expect(bled).toBe(true);
      expect(advanceExpedition(exp, T0 + 600).groundOps!.teams[0].conditions["member-1"]).toContain("bleed");
    },
    hand: true,
  },
  shroud: {
    build: () => dispatch(crewed(0xaadc2, "gg", 3, [tool("equip-901", "shroudEmitter", "member-1")])),
    check: (_done, exp) => {
      expect(shipEventsLive(exp)).toBe(true);
      expect(squadEncounterBias(exp.roster!.security, PRE_FKR8_DEVICE_EFFECTIVENESS)).toBeCloseTo(-0.4);
    },
  },
  lure: {
    build: () => dispatch(crewed(0xaadc2, "gg", 3, [tool("equip-901", "lureBeacon", "member-1")])),
    check: (done, exp) => {
      expect(squadEncounterBias(exp.roster!.security, PRE_FKR8_DEVICE_EFFECTIVENESS)).toBeCloseTo(0.4);
      expect((done.scanEvents ?? []).some((e) => e.kind === "shipEvent")).toBe(true);
    },
  },
  bothDevices: {
    build: () => dispatch(crewed(0xaadc2, "gg", 3, [tool("equip-901", "shroudEmitter", "member-1"), tool("equip-902", "lureBeacon", "member-4"), tool("equip-903", "lureBeacon", "member-5"), tool("equip-904", "lureBeacon", "member-6")])),
    check: (_done, exp) => {
      expect(squadEncounterBias(exp.roster!.security, PRE_FKR8_DEVICE_EFFECTIVENESS)).toBeCloseTo(0.8);
    },
  },
};

// Captured from the code BEFORE any Field Kits engine edit (FK-3, on top of 5656c2e): five checkpoint hashes (plus a
// fixture's extra ones), each mid-run checkpoint's offset from T0 and hash, the phase at 2,000,000 s, the claim's
// whole-state hash, and for every run that rolls at its scan boundaries the hash of every boundary's chance and roll. Cross-check: riskAware is the AF-1 gate's
// tierFourEnemy fixture (groundOpsAffixes.test.ts) and reproduces its capture exactly.
const GOLDEN: Record<string, string[]> = {
  preSq4: ["14e59e6b", "e9001ad8", "e9001ad8", "e9001ad8", "e9001ad8", "@8681", "aa0093f4", "@8595", "a74719e", "complete", "1a2cddd"],
  riskAware: ["5b204c68", "8ea32568", "b3a4fc92", "b3a4fc92", "b3a4fc92", "@10789", "a8fd81ea", "@17484", "dcef27b8", "complete", "2da25f", "aecdd3ab"],
  affixCat1: ["a125b2d7", "d17642e1", "d17642e1", "d17642e1", "d17642e1", "@1151", "4a98f97f", "@551", "4a98f97f", "complete", "453305c1", "3f9ea2db"],
  affixCat2: ["c487dfef", "7d56af0d", "4b46d650", "4b46d650", "4b46d650", "@1674", "452d89d2", "@954", "ce1329ee", "complete", "5fc49130", "3f9ea2db"],
  tierSeven: ["ab177aeb", "87da063c", "c7d06b78", "c7d06b78", "c7d06b78", "@7226", "1f30db1a", "@22304", "e38ce9f8", "complete", "820ca0fa", "d3f9694f"],
  ossirBleed: ["2088aced", "e3e14cee", "e3e14cee", "e3e14cee", "e3e14cee", "feeddd04", "@1676", "e847ac09", "@3344", "4ef57719", "complete", "5934e0e1", "1540097"],
  shroud: ["8533bf1f", "cfacc53e", "a0a3f20b", "8d8264ae", "8d8264ae", "@8790", "2e7a3257", "@9822", "8da7b81c", "complete", "8f2b5981", "deee4b83"],
  lure: ["5e656376", "e269d354", "6d1cd4ad", "5cd7911d", "5cd7911d", "@8790", "a5358f8c", "@9822", "67a8757b", "complete", "fcbf9b62", "90bc745"],
  bothDevices: ["54ad1d0f", "679a167c", "e42a0c25", "1c98490a", "1c98490a", "@8790", "bb522afb", "@9822", "653b6770", "complete", "bf5cc252", "3d1708d1"],
  ossirBattle: ["90bfefdc"],
  threat: ["ffd7bbbb"],
};

// The three whole-run suites, shared by FK-3 and FKR-0: the golden (five checkpoints, mid-run checkpoints, the phase
// at 2,000,000 s, the claim through the state twin, the boundary reads), parity (one call == 997 s chunks == 1 s
// steps) and event-boundary parity (t - 1, t, t + 1 of every recorded event == one call, plus 61 s chunks).
function wholeRunSuites(tag: string, fixtures: Record<string, Fixture>, golden: Record<string, string[]>): void {
  describe(`${tag} pre-Field-Kits goldens: a run without the Field Kits flag resolves byte-identically`, () => {
    for (const [name, f] of Object.entries(fixtures)) {
      it(`${name}: five checkpoints, the phase at 2,000,000 s and the claim match the pre-Field-Kits capture`, () => {
        const { next, exp } = f.build();
        expect(withoutFieldKits(exp)).toEqual(exp);
        expect("fieldKits" in exp).toBe(false);
        expect("enemyRanks" in exp).toBe(false);
        const hashes = [...CHECKPOINTS, ...(f.extraAt ?? [])].map((t) => fnv(goldenJson(advanceExpedition(exp, t))));
        // The mid-run checkpoints: their offsets are pinned too, then the state at each.
        const mid = midRunPoints(exp);
        if (exp.groundOps) expect(mid.length).toBeGreaterThan(0);
        for (const t of mid) hashes.push(`@${t - T0}`, fnv(goldenJson(advanceExpedition(exp, t))));
        const done = advanceExpedition(exp, FINAL);
        f.check?.(done, exp);
        hashes.push(done.phase);
        const claimed = done.phase === "complete" ? claimExpedition({ ...next, expeditions: [done] }, done.id) : null;
        if (claimed) expect(claimed.success).toBe(true);
        // FKR-0: the claim hashes through the state twin (identity today; FKR-7's team packs / top-up come off).
        if (claimed) expect(withoutFieldKitsState(claimed.next)).toEqual(claimed.next);
        hashes.push(claimed ? fnv(goldenJson(withoutRunCounts(withoutFieldKitsState(claimed.next)))) : "unclaimed");
        if (rollsBoundaries(exp)) hashes.push(fnv(goldenJson(boundaryReads(exp))));
        expect(hashes).toEqual(golden[name]);
      });
    }
  });

  describe(`${tag} parity: one call == 997 s chunks == 1 s steps on the same fixtures`, () => {
    for (const [name, f] of Object.entries(fixtures)) {
      it(`${name}: one call == 997 s chunks == 1 s steps`, () => {
        const { exp } = f.build();
        const frozen = structuredClone(exp);
        // 997 s chunks from dispatch to the last checkpoint.
        const far = CHECKPOINTS[CHECKPOINTS.length - 1];
        expect(chunked(exp, T0, far, 997)).toEqual(advanceExpedition(exp, far));
        // 1 s steps over the busy stretch: the run's first hour of the window
        // (a hand-built run's first 3 hours), from a one-call advance to the window's opening.
        const [from, to] = liveWindow(exp, f.hand === true);
        const start = from === T0 ? exp : advanceExpedition(exp, from);
        expect(chunked(start, from, to, 1)).toEqual(advanceExpedition(exp, to));
        expect(exp).toEqual(frozen);
      });
    }
  });

  describe(`${tag} event-boundary parity: a chain stopping at t - 1, t and t + 1 of every recorded event == one call`, () => {
    for (const [name, f] of Object.entries(fixtures)) {
      it(`${name}: the event-boundary chain (and a 61 s chunk pass) matches the one-call run`, () => {
        const { exp } = f.build();
        const far = CHECKPOINTS[CHECKPOINTS.length - 1];
        const one = advanceExpedition(exp, far);
        const times = eventTimes(exp, far);
        if (exp.groundOps) expect(times.length).toBeGreaterThan(10);
        let e = exp;
        for (const t of times) for (const at of [t - 1, t, t + 1]) e = advanceExpedition(e, at);
        expect(advanceExpedition(e, far)).toEqual(one);
        // 61 s chunks over the first 60,000 s (a prime step that never lines up with the 6 s fight rounds).
        const to = T0 + 60_000;
        expect(chunked(exp, T0, to, 61)).toEqual(advanceExpedition(exp, to));
      });
    }
  });
}

wholeRunSuites("FK-3", FIXTURES, GOLDEN);

// ===== an Ossir member taking Bleed in a battle =====

describe("FK-3 an Ossir member taking Bleed (Stoneskin's battle half lands in FK-4 on flagged runs only)", () => {
  it("guards whose every landed strike inflicts Bleed: the battle, the squad's end state and the log match the capture", () => {
    const { exp } = FIXTURES.ossirBleed.build();
    const team0 = exp.groundOps!.teams[0];
    const teams: GroundFightTeam[] = [{ securityIds: team0.securityIds, securityShare: exp.groundOps!.factors.securityShare[0] }];
    const task = tasksOf(exp)[0];
    const seed = taskFightSeed(exp, 0, 0);
    const squad = taskFightTeam(exp, teams, task);
    const guards = generateEncounter(seed, 0.3, "derelictOutpost");
    for (const g of guards) g.statusOnHit = { id: "bleed", permille: 1000 };
    const log: GambitLogEvent[] = [];
    const result = resolveGroundBattle(squad, guards, exp.teamKit, makeRng(seed), log, seed);
    const ossir = squad.find((c) => c.memberId === "member-1")!;
    // The Ossir member was struck, and lost more HP than the strikes dealt: the rest is the Bleed ticking.
    const struck = log.filter((ev) => ev.side === "enemy" && ev.targetMemberId === "member-1" && (ev.hpDelta ?? 0) < 0);
    expect(struck.length).toBeGreaterThan(0);
    const strikeDamage = struck.reduce((sum, ev) => sum - (ev.hpDelta ?? 0), 0);
    expect(ossir.hpMax - ossir.hp).toBeGreaterThan(strikeDamage);
    const hash = fnv(goldenJson({ result, squad, guards, log }));
    expect(hash).toBe(GOLDEN.ossirBattle[0]);
  });
});

// ===== the threat odds of three objectives =====

describe("FK-3 the threat odds of three objectives", () => {
  it("each objective's clear odds and memo key match the capture", () => {
    const { exp } = handRun({ state: oneTeam(3), pois: ["derelictOutpost", "crashedShip", "mineralOutcrop"], risk: { ...CALM, combat: 3, fauna: 2 }, catalog: 2 });
    const team0 = exp.groundOps!.teams[0];
    const teams: GroundFightTeam[] = [{ securityIds: team0.securityIds, securityShare: exp.groundOps!.factors.securityShare[0] }];
    const reads = tasksOf(exp).map((task, k) => [groundTaskClearOdds(exp, teams, exp.bodies[0], task, k), groundThreatOddsKey(exp, teams, exp.bodies[0], task, k, 32)]);
    expect(reads.length).toBe(3);
    const hash = fnv(goldenJson(reads));
    expect(hash).toBe(GOLDEN.threat[0]);
  });
});

// =====================================================================================================================
// Field Kits FKR-0 (docs/plans/2026-10-14-field-kits-plan.md, REVISED SLICES R3 FKR-0): what FK-3 does not pin,
// captured on the code BEFORE any revised Field Kits engine edit. Every fixture still goes through withoutFieldKits
// (now also stripping enemyRanks, basics, charges, chargesUsed, basicsUsed, ranks; team packs / topUp through the state
// twin withoutFieldKitsState), so a run WITHOUT both flags keeps these hashes through FKR-1..FKR-11:
//   (1) a Stun Grenade and a Toxin Grenade wearer's fights: today's PASSIVE on-hit inflict (flagged runs replace it with
//       thrown charges at FKR-5), as whole runs (checkpoints, claim, parity, event-boundary parity) and as one battle;
//   (2) final fights (each graded objective's last fight point, and every fight of a Deadly Enemy Fortification) and
//       the AF-1 Reinforcing reinforcement fights' enemy lists (FKR-1's rank targets): the fielded enemies, the record
//       and the battle log;
//   (3) the threat odds at each difficulty grade 1 to 5 (ordinary sites and the two hostile sites);
//   (4) one crafted roll of each grenade variety at three seeds (MOVES AT FKR-5 ON PURPOSE: the new carry capacity
//       line joins the grenade pools; the moved hashes must be NAMED in that commit, never silently re-captured).
//       Hidden until FKR-7 (user 2026-10-20): while FIELD_KITS_PLAYER_LIVE is false the pools are the FKR-0 ones and
//       the pin is back on its FKR-0 capture; FKR-7 flips the switch and the pin reads FKR-5's;
//   (5) a squad loadout round trip (create, check in, apply, save and load) with `consumables` absent.
// The pure measurement table (the threat odds per grade at three crew ranks, 256 samples) runs only under the gate.
// =====================================================================================================================

// A crafted member Tool with a fixed status chance line (the grenade's implicit), worn by `wearer`. Frozen lines, so
// (1) never moves when FKR-5 changes what a NEW craft rolls.
const grenade = (id: string, variety: "stunGrenade" | "toxinGrenade", wearer: string, chance = 60): EquipmentInstance => ({
  ...tool(id, variety, wearer),
  implicitStats: { groundStatusChance: chance },
});

const wears = (exp: Expedition, memberId: string, variety: string): boolean =>
  exp.roster!.security.find((m) => m.memberId === memberId)!.gear.some((g) => g.varietyKey === variety);

const FKR0_FIXTURES: Record<string, Fixture> = {
  stunGrenade: {
    build: () =>
      handRun({
        state: oneTeam(2, {}, [grenade("equip-901", "stunGrenade", "member-1")]),
        pois: ["derelictOutpost", "crashedShip"],
        risk: { ...CALM, combat: 2 },
        catalog: 2,
      }),
    check: (_done, exp) => expect(wears(exp, "member-1", "stunGrenade")).toBe(true),
    hand: true,
  },
  toxinGrenade: {
    build: () =>
      handRun({
        state: oneTeam(2, {}, [grenade("equip-901", "toxinGrenade", "member-1")]),
        pois: ["derelictOutpost", "crashedShip"],
        risk: { ...CALM, combat: 2 },
        catalog: 2,
      }),
    check: (_done, exp) => expect(wears(exp, "member-1", "toxinGrenade")).toBe(true),
    hand: true,
  },
  // A real dispatch with both grenades worn (one per team), on its real timeline.
  grenadesReal: {
    build: () => dispatch(crewed(0xaadc2, "gg", 3, [grenade("equip-901", "stunGrenade", "member-1"), grenade("equip-902", "toxinGrenade", "member-4")])),
    check: (_done, exp) => {
      expect(wears(exp, "member-1", "stunGrenade")).toBe(true);
      expect(wears(exp, "member-4", "toxinGrenade")).toBe(true);
    },
  },
};

// Captured on the code BEFORE any revised Field Kits engine edit (FKR-0). Same layout as GOLDEN above; then (1) the
// grenade battles, (2) the final and reinforcement fights, (3) the odds per grade, (4) the crafted rolls, (5) the
// loadout round trip.
// (4) the crafted grenade rolls: FKR-0's capture (the live pin while FIELD_KITS_PLAYER_LIVE is false) and FKR-5's
// (the pools with the carry capacity line, proved below with the carry pools installed). Stun at seeds 2, 3, 27, then
// Toxin.
const FKR0_CRAFTED_ROLLS = ["d8050ca3", "c801541e", "c9723513", "e2e4cbb3", "7316c8c8", "d4611562"];
const FKR5_CRAFTED_ROLLS = ["d8050ca3", "4c0d7cdd", "2e6ffdd3", "f317238a", "7316c8c8", "9fad8889"];

const FKR0_GOLDEN: Record<string, string[]> = {
  stunGrenade: ["23b745b8", "e496a2eb", "e496a2eb", "e496a2eb", "e496a2eb", "@1514", "746a81d4", "@3044", "298733d7", "complete", "26af29ef", "1540097"],
  toxinGrenade: ["36e8c5b0", "a657d8ad", "a657d8ad", "a657d8ad", "a657d8ad", "@1514", "eeed641c", "@3044", "6aec40b9", "complete", "966d6b7", "1540097"],
  grenadesReal: ["ea9b6c79", "9119989c", "b4cd8721", "e9ca8ede", "e9ca8ede", "@8790", "f57e3de7", "@9798", "2d4cd74b", "complete", "778fbcef", "f15f4531"],
  stunBattle: ["77ced599"],
  toxinBattle: ["b5431849"],
  finalFightsLow: ["5b603dd6", "64e67d8c", "b9ba30cd", "137c0bf0", "27fa8282"],
  finalFightsHigh: ["88e60d7f", "3edc464b", "9e2abb10"],
  fortification: ["9fd37493", "584a456e", "e50202f", "aa59c248", "948c91b9", "final:win:6"],
  reinforcementsCat1: ["cc440f12", "e6431f03", "cd636be5", "e76416cf"],
  reinforcementsCat2: ["622e32b3", "1ec40759", "7284f62"],
  oddsLow: ["one team rank 3: 1:32 2:5 3:0 4:0 5:0", "5959943d", "both teams rank 6: 1:32 2:32 3:32 4:30 5:0", "8204f781"],
  oddsHigh: ["one team rank 3: 3:20 4:0 5:0", "365e1dd6", "both teams rank 6: 3:32 4:32 5:32", "d5333f73"],
  // (4) MOVED AT FKR-5 (named, below), back on FKR-0 until FIELD_KITS_PLAYER_LIVE: stunGrenade then toxinGrenade,
  // each at the three INSPECT_SEEDS.
  craftedRolls: FIELD_KITS_PLAYER_LIVE ? FKR5_CRAFTED_ROLLS : FKR0_CRAFTED_ROLLS,
  // created, checked in, applied (the round trip lands back on the created state).
  loadout: ["6ed6a25a", "c1e66bb0", "6ed6a25a"],
};

wholeRunSuites("FKR-0", FKR0_FIXTURES, FKR0_GOLDEN);

// ===== (1) the grenade wearer's battle =====

const fightTeamsOf = (exp: Expedition, indices: number[] = [0]): GroundFightTeam[] =>
  indices.map((i) => {
    const t = exp.groundOps!.teams[i];
    return { securityIds: t.securityIds, downedThisTask: t.downedThisTask, securityShare: exp.groundOps!.factors.securityShare[i] };
  });

describe("FKR-0 (1) a grenade wearer's fight: today's passive on-hit inflict", () => {
  for (const [name, status, key] of [
    ["stunGrenade", "stun", "stunBattle"],
    ["toxinGrenade", "poison", "toxinBattle"],
  ] as const) {
    it(`${name}: the wearer strikes with ${status} on hit; the first fight's record, log and squad match the capture`, () => {
      const { exp } = FKR0_FIXTURES[name].build();
      const teams = fightTeamsOf(exp);
      const task = tasksOf(exp)[0];
      const squad = taskFightTeam(exp, teams, task);
      const wearer = squad.find((c) => c.memberId === "member-1")!;
      expect(wearer.onHitStatuses?.map((s) => s.id)).toEqual([status]);
      expect(wearer.onHitStatuses![0].permille).toBeGreaterThan(0);
      // Nobody else carries an on-hit status.
      expect(squad.filter((c) => c.onHitStatuses !== undefined).length).toBe(1);
      const log: GambitLogEvent[] = [];
      const record = resolveTaskFight(exp, teams, exp.bodies[0], task, 0, undefined, log, alertLevelAt(task, T0), taskCover(task));
      // The wearer's strikes put the status on a guard at least once (the passive roll FKR-5 replaces on flagged runs).
      expect(log.some((ev) => ev.side === "team" && ev.memberId === "member-1" && ev.statusApplied === true)).toBe(true);
      expect([fnv(goldenJson({ record, log, squad }))]).toEqual(FKR0_GOLDEN[key]);
    });
  }
});

// ===== (2) final fights and reinforcement fights (FKR-1's rank targets) =====

// The enemies a task fight fields BEFORE FKR-1's ranks: resolveTaskFightOnSeed's exact chain (generateEncounter on
// the resisted hazard, the flora toxins, the alert's escalation). FKR-1 ranks these AFTER, on stamped runs only.
function fieldedEnemies(exp: Expedition, body: ExpeditionBody, task: ExpeditionActivity, seed: number, alert: number) {
  return withEscalation(withFloraToxins(generateEncounter(seed, resistedHazard(body.hazard, exp.hazardResist ?? 0), task.poiId), bodyFloraGrade(body)), alert);
}

// One fight point of `task` (index k on body 0), fought fresh by `teams`: the fielded enemies, the record and the log.
function pointFight(exp: Expedition, teams: GroundFightTeam[], k: number, point: number) {
  const body = exp.bodies[0];
  const task = { ...tasksOf(exp)[k], pointsCleared: point, fightCount: point };
  const alert = alertLevelAt(task, T0);
  const enemies = fieldedEnemies(exp, body, task, taskFightSeed(exp, k, point), alert);
  const log: GambitLogEvent[] = [];
  const record = resolveTaskFight(exp, teams, body, task, k, undefined, log, alert, taskCover(task));
  return { k, point, poiId: task.poiId, grade: task.difficulty, enemies, record, log };
}

// The graded objectives: one body each (hazard 0.1, tier 1, affix catalog 2), every site stamped through the real path.
// Low (combat 1): Secure Landing Zone 1 fight (Simple), Clear Hostiles 2 (Standard), Derelict Outpost 3 (Challenging),
// Enemy Colony 4 (Dangerous), Enemy Fortification 5 (Deadly). High (combat 3): Ancient Ruins 3 (Challenging), Buried
// Vault 4 (Dangerous), Derelict Outpost 5 (Deadly).
const GRADE_RUNS = {
  Low: { pois: ["secureLandingZone", "clearHostiles", "derelictOutpost", "enemyColony", "enemyFortification"], combat: 1, grades: [1, 2, 3, 4, 5], fights: [1, 2, 3, 4, 5] },
  High: { pois: ["ancientRuins", "buriedVault", "derelictOutpost"], combat: 3, grades: [3, 4, 5], fights: [3, 4, 5] },
} as const;

// The side: "one" = one Ground team (3 / 3) at `rank` (FK-3's threat crew at rank 3); "both" = both Ground teams of a
// fully slotted ship at `rank` (6 Security members fight as one side).
type GradeSide = { kind: "one" | "both"; rank: number };
const sideTeams = (side: GradeSide): number[] => (side.kind === "one" ? [0] : [0, 1]);

function gradeRun(which: keyof typeof GRADE_RUNS, side: GradeSide = { kind: "one", rank: 3 }): Expedition {
  const g = GRADE_RUNS[which];
  const state = side.kind === "one" ? oneTeam(side.rank) : crewed(0x6ade5, "gg", side.rank);
  const { exp } = handRun({ state, pois: [...g.pois], risk: { ...CALM, combat: g.combat }, catalog: 2 });
  expect(tasksOf(exp).map((t) => t.difficulty)).toEqual([...g.grades]);
  expect(tasksOf(exp).map((t) => t.fightPoints?.length)).toEqual([...g.fights]);
  return exp;
}

describe("FKR-0 (2) final fights: each graded objective's last fight point", () => {
  for (const which of ["Low", "High"] as const) {
    it(`${which}: the final fight's enemies, record and log at every grade match the capture`, () => {
      const exp = gradeRun(which);
      const teams = fightTeamsOf(exp);
      const finals = tasksOf(exp).map((t, k) => pointFight(exp, teams, k, t.fightPoints!.length - 1));
      // Deadly objectives carry Reinforcing (required from Deadly, AF-1).
      for (const [k, t] of tasksOf(exp).entries()) if (t.difficulty === 5) expect(t.affixes?.some((a) => a.id === "reinforcing"), `${k}`).toBe(true);
      expect(finals.map((f) => fnv(goldenJson(f)))).toEqual(FKR0_GOLDEN[`finalFights${which}`]);
    });
  }

  it("a Deadly Enemy Fortification: every fight point (the last named) against a full rank 6 side, as captured", () => {
    const { exp } = handRun({ state: crewed(0xf0f7), pois: ["enemyFortification"], risk: { ...CALM, combat: 4 }, catalog: 2 });
    const task = tasksOf(exp)[0];
    expect(task.difficulty).toBe(5);
    expect(task.fightPoints!.length).toBe(5);
    const teams = fightTeamsOf(exp, [0, 1]);
    const fights = [0, 1, 2, 3, 4].map((j) => pointFight(exp, teams, 0, j));
    // The garrison's six roles (two Bruisers, two Strikers, a Caster, a Healer) on every point, plus any hazard extra.
    for (const f of fights) expect(f.enemies.length).toBeGreaterThanOrEqual(6);
    const final = fights[4];
    expect([...fights.map((f) => fnv(goldenJson(f))), `final:${final.record.outcome}:${final.enemies.length}`]).toEqual(FKR0_GOLDEN.fortification);
  });
});

describe("FKR-0 (2) AF-1 Reinforcing: every reinforcement fight's enemy list on the affix fixtures", () => {
  for (const [name, key] of [
    ["affixCat1", "reinforcementsCat1"],
    ["affixCat2", "reinforcementsCat2"],
  ] as const) {
    it(`${name}: each reinforcement fight re-resolves from the moment before it to its stored record; enemies and log as captured`, () => {
      const { exp } = FIXTURES[name].build();
      const fights = seenHistory(exp).filter((r) => r.step === "fight" && r.reinforcement === true);
      expect(fights.length).toBeGreaterThan(0);
      const out = fights.map((r) => {
        const at = r.startedAt;
        const now = advanceExpedition(exp, at);
        const pending = now.groundOps!.teams[r.teamIndex].pendingFight!;
        expect(pending.reinforcement).toBe(true);
        // The run the moment before: the crew's teams, carry and the task as the fight saw them.
        const before = advanceExpedition(exp, at - 1);
        const team = before.groundOps!.teams[r.teamIndex];
        const k = tasksOf(before).findIndex((t) => t.id === r.taskId);
        const task = tasksOf(before)[k];
        expect(task.fightCount ?? 0).toBe(pending.fightNumber);
        const alert = alertLevelAt(task, at);
        const log: GambitLogEvent[] = [];
        const record = resolveTaskFight(before, fightTeamsOf(before, [r.teamIndex]), before.bodies[0], task, k, team.carry, log, alert, taskCover(task));
        expect({ ...record, reinforcement: true }).toEqual(pending);
        const enemies = fieldedEnemies(before, before.bodies[0], task, taskFightSeed(before, k, pending.fightNumber), alert);
        return { at: at - T0, alert, enemies, pending, log };
      });
      // affixCat2 holds an ESCALATED reinforcement fight (alert 1: an extra copied enemy, open call N5's target).
      if (name === "affixCat2") expect(out.some((f) => f.alert > 0 && f.enemies.length > 3)).toBe(true);
      expect(out.map((f) => fnv(goldenJson(f)))).toEqual(FKR0_GOLDEN[key]);
    });
  }
});

// ===== (3) the threat odds at each difficulty grade =====

// Every graded objective's clear odds (and memo key) for `side` at `samples`, as the engine reads them (its alert and
// cover). Pure.
function gradeOdds(exp: Expedition, side: GradeSide, samples: number) {
  const teams = fightTeamsOf(exp, sideTeams(side));
  const body = exp.bodies[0];
  return tasksOf(exp).map((task, k) => {
    const alert = alertLevelAt(task, T0);
    const odds = groundTaskClearOdds(exp, teams, body, task, k, samples, undefined, alert, taskCover(task));
    return { grade: task.difficulty, odds, key: groundThreatOddsKey(exp, teams, body, task, k, samples, undefined, alert, taskCover(task)) };
  });
}

// Two sides per body: FK-3's threat crew (one team at rank 3) and a full rank 6 ship (both teams as one side), so the
// odds sit across the whole range (FKR-1's ranks must move them on the stamped twin only).
const ODDS_SIDES: [string, GradeSide][] = [
  ["one team rank 3", { kind: "one", rank: 3 }],
  ["both teams rank 6", { kind: "both", rank: 6 }],
];

describe("FKR-0 (3) the threat odds at each difficulty grade 1 to 5", () => {
  for (const which of ["Low", "High"] as const) {
    it(`${which}: each graded objective's clear odds and memo key, for both sides, match the capture`, () => {
      const out: string[] = [];
      for (const [label, side] of ODDS_SIDES) {
        const reads = gradeOdds(gradeRun(which, side), side, 32);
        out.push(`${label}: ${reads.map((r) => `${r.grade}:${r.odds.wins}`).join(" ")}`, fnv(goldenJson(reads)));
      }
      expect(out).toEqual(FKR0_GOLDEN[`odds${which}`]);
    });
  }
});

// ===== (4) crafted grenade rolls (MOVES AT FKR-5, named; FKR-0's again until FKR-7) =====

// Three seeds that roll different rarities (Stun: Standard, Radiant, Standard; Toxin: Standard, Augmented, Stellar),
// at crafting level 20 so the lines carry real magnitudes.
const INSPECT_SEEDS = [2, 3, 27];
const INSPECT_CRAFTING_LEVEL = 20;

function inspectGrenades(): EquipmentInstance[] {
  return (["stunGrenade", "toxinGrenade"] as const).flatMap((variety) =>
    INSPECT_SEEDS.map((inspectSeed) => {
      const bp = `${variety}Bp`;
      const state: GameState = { ...freshState(), craftingLevel: INSPECT_CRAFTING_LEVEL, blanks: { [bp]: [new Decimal(1)] }, inspectSeed };
      const next = inspectBlank(state, bp);
      expect(next).not.toBe(state);
      const piece = next.equipment[next.equipment.length - 1];
      expect(piece.moduleVariant).toBe(variety);
      return piece;
    }),
  );
}

describe("FKR-0 (4) one crafted roll of each grenade variety at three seeds (moved at FKR-5 on purpose)", () => {
  it("inspecting a Stun Grenade and a Toxin Grenade blank at each seed mints the captured pieces", () => {
    expect(inspectGrenades().map((p) => fnv(goldenJson(p)))).toEqual(FKR0_GOLDEN.craftedRolls);
  });

  // MOVED BY FKR-5 (Field Kits tool charges; FK11 "+1 carry capacity"): both grenade pools gained the carry capacity
  // line (pool weight 1, variety share 0.15, the other two shares lowered so each variety's shares still sum to 1), so
  // the weighted affix picks land differently: four of the six captured pieces move (Stun at seeds 3 and 27, Toxin at
  // seeds 2 and 27); Stun at seed 2 and Toxin at seed 3 still pick their FKR-0 lines.
  // HIDDEN UNTIL FKR-7 (user 2026-10-20 "Hide until kits are live"): FIELD_KITS_PLAYER_LIVE picks the pool, so the pin
  // above is FKR-0's again until FKR-7 flips it. Both captures stay proved: with each switch position's pools installed
  // for the call, the same seeds mint exactly that position's pieces, and the base pools are the FKR-0 tables verbatim.
  const fkr0Pools = {
    stunGrenade: { affixPool: [{ stat: "groundStatusChance", weight: 4 }, { stat: "groundAccuracy", weight: 2 }], statRatios: { groundStatusChance: 0.7, groundAccuracy: 0.3 } },
    toxinGrenade: { affixPool: [{ stat: "groundStatusChance", weight: 3 }, { stat: "groundPower", weight: 3 }], statRatios: { groundStatusChance: 0.6, groundPower: 0.4 } },
  };
  function withGrenadePools<T>(live: boolean, fn: () => T): T {
    const varieties = EQUIPMENT_SLOTS.memberTool.varieties as unknown as { key: string; affixPool?: unknown; statRatios: unknown }[];
    const saved = varieties.map((v) => ({ v, affixPool: v.affixPool, statRatios: v.statRatios }));
    try {
      for (const v of varieties) if (v.key === "stunGrenade" || v.key === "toxinGrenade") Object.assign(v, grenadeCraftPool(v.key, live));
      return fn();
    } finally {
      for (const { v, affixPool, statRatios } of saved) Object.assign(v, { affixPool, statRatios });
    }
  }
  it("FKR-5: the base pools are the FKR-0 tables, and with them the same seeds mint the FKR-0 pieces exactly", () => {
    expect(grenadeCraftPool("stunGrenade", false)).toEqual(fkr0Pools.stunGrenade);
    expect(grenadeCraftPool("toxinGrenade", false)).toEqual(fkr0Pools.toxinGrenade);
    expect(withGrenadePools(false, () => inspectGrenades().map((p) => fnv(goldenJson(p))))).toEqual(FKR0_CRAFTED_ROLLS);
  });
  it("FKR-5: with the carry pools (FIELD_KITS_PLAYER_LIVE on) the same seeds mint the moved FKR-5 pieces exactly", () => {
    expect(withGrenadePools(true, () => inspectGrenades().map((p) => fnv(goldenJson(p))))).toEqual(FKR5_CRAFTED_ROLLS);
  });
});

// ===== (5) a squad loadout round trip with consumables absent =====

describe("FKR-0 (5) a squad loadout round trip with `consumables` absent", () => {
  it("create, check in, apply, then save and load: no kit gains consumables; the states match the capture", () => {
    const gear = [grenade("equip-901", "stunGrenade", "member-1"), grenade("equip-902", "toxinGrenade", "member-2")];
    const state = oneTeam(2, {}, gear);
    const created = createGroundTeamLoadout(state, "ship-1", 0, "Grenadiers");
    if (!created.ok) throw new Error(`create refused: ${created.reason}`);
    const checkedIn = checkInGroundTeamLoadout(created.next, created.loadoutId);
    expect(checkedIn.ok).toBe(true);
    const applied = applyGroundTeamLoadout(checkedIn.next, created.loadoutId, "ship-1", 0);
    expect(applied.ok).toBe(true);
    const stages = [created.next, checkedIn.next, applied.next];
    for (const s of stages) {
      expect(s.squadLoadouts.length).toBe(1);
      for (const kit of [...s.squadLoadouts[0].security, ...s.squadLoadouts[0].science]) expect("consumables" in kit).toBe(false);
    }
    // Both grenades went back on their wearers.
    expect(applied.next.equipment.filter((e) => e.fittedToMemberId === "member-1" || e.fittedToMemberId === "member-2").map((e) => e.id)).toEqual(["equip-901", "equip-902"]);
    // Save and load keeps the loadout exactly (no consumables written).
    const file = deserialize(serialize(applied.next, 0));
    expect(file).not.toBeNull();
    const loaded = migrate(file!);
    expect(loaded.squadLoadouts).toEqual(applied.next.squadLoadouts);
    expect(stages.map((s) => fnv(goldenJson(withoutRunCounts(withoutFieldKitsState(s)))))).toEqual(FKR0_GOLDEN.loadout);
  });
});

// ===== the measurement table (gated) =====

// The threat odds per grade at three crew ranks and both sides, 256 samples: a pure measurement table for FKR-1's rank
// tuning (how far each grade's odds sit from 0 and from certain before ranks). Slow, so it runs only with FKR_SWEEP set
// (or under vitest mode "sweep"); the default run pins the 32 sample reads above.
const FKR_SWEEP: boolean = Boolean(import.meta.env.FKR_SWEEP) || import.meta.env.MODE === "sweep";

const ODDS_TABLE: Record<string, string> = {
  "Low one rank 1": "1:256 2:0 3:0 4:0 5:0",
  "Low one rank 3": "1:256 2:38 3:1 4:0 5:0",
  "Low one rank 6": "1:256 2:199 3:19 4:0 5:0",
  "Low both rank 1": "1:256 2:256 3:256 4:0 5:0",
  "Low both rank 3": "1:256 2:256 3:256 4:53 5:0",
  "Low both rank 6": "1:256 2:256 3:256 4:243 5:0",
  "High one rank 1": "3:9 4:0 5:0",
  "High one rank 3": "3:184 4:0 5:0",
  "High one rank 6": "3:254 4:0 5:0",
  "High both rank 1": "3:256 4:201 5:253",
  "High both rank 3": "3:256 4:255 5:256",
  "High both rank 6": "3:256 4:256 5:256",
};

describe.runIf(FKR_SWEEP)("FKR-0 measurement (gated): the threat odds per grade, ranks 1, 3 and 6, both sides, 256 samples", () => {
  for (const which of ["Low", "High"] as const) {
    for (const kind of ["one", "both"] as const) {
      for (const rank of [1, 3, 6]) {
        const label = `${which} ${kind} rank ${rank}`;
        it(label, () => {
          const side: GradeSide = { kind, rank };
          const row = gradeOdds(gradeRun(which, side), side, 256).map((r) => `${r.grade}:${r.odds.wins}`).join(" ");
          console.log(`${label}: ${row}`);
          expect(row).toBe(ODDS_TABLE[label]);
        });
      }
    }
  }
});
