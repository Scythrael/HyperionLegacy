// Field Kits FK-3 (docs/plans/2026-10-14-field-kits-plan.md section 0 "Flag-neutral", section 4 FK-3): golden hashes
// captured on the code BEFORE any Field Kits engine edit. A run WITHOUT `Expedition.fieldKits` (every run dispatched
// before FK-6, legacy and Ground Ops alike) must advance, fight, roll and claim byte-identically in every later
// slice. Each fixture is dispatched (or hand-built from a real dispatch), passed through withoutFieldKits
// (awayTeamTestFixtures.ts; today it strips nothing, from FK-6 on it strips the flag, packs, treatment and the
// fight record's kit fields), then hashed at five checkpoints, its phase read at 2,000,000 s, and its claim hashed.
//
//   legacy        : no groundOps (the oldest engine path still live; a lone Security member, scan-time encounters).
//   preSq4        : a Ground Ops run dispatched before SQ-4 (no risk profile, two Ground teams).
//   riskAware     : a risk-aware run before AF-1 (Tier IV enemy territory, no affix flag: SQ-4 + clearing).
//   affixCat1     : affix catalog 1 (AF-1): a Reinforcing objective, a weak crew, a loss raises the ALERT.
//   affixCat2     : affix catalog 2 (AF-2): Reinforcing plus NEGATIVE Rocky Outcroppings on a rifle squad.
//   tierSeven     : a real Tier VII enemy territory dispatch (forced region: play is Tier I only).
//   ossirBleed    : an Ossir member (Stoneskin) fielded with a carried Bleed, into the fight and the bay.
//   shroud / lure / bothDevices : a Shroud Emitter, a Lure Beacon, and both worn on a run with ship events (the
//                   ship-event chance and step roll at EVERY scan boundary are hashed too).
// Plus: an Ossir member taking Bleed in a battle (enemies stamped with a Bleed on-hit), the threat odds of three
// objectives, and offline == live parity (one call == 997 s chunks == 1 s steps) on the same fixtures.

import { describe, expect, it } from "vitest";
import { freshState, type AwayMember, type BodyRiskGrades, type EquipmentInstance, type Expedition, type ExpeditionActivity, type ExpeditionBody, type GameState, type ShipGroundTeam } from "./model";
import { advanceExpedition, claimExpedition, expeditionCandidates, scanStepRoll, shipScanEventChance, squadEncounterBias, fieldDeviceEffectiveness, startExpedition } from "./expedition";
import { generateRiskProfile, type ExpeditionRegion } from "./riskFactors";
import { groundOpsAssignIdle, groundOpsBodyScanned, initGroundTasks } from "./groundOps";
import { rollReinforcements, type ObjectiveAffix } from "./affixes";
import { taskFightSeed, taskFightTeam, type GroundFightTeam } from "./groundFight";
import { generateEncounter, resolveGroundBattle, type GambitLogEvent } from "./gambit";
import { makeRng } from "./combat/rng";
import { groundTaskClearOdds, groundThreatOddsKey } from "./groundThreat";
import { shipEventsLive } from "./shipScanEvents";
import { plainAwayMember, withSlottedAwayTeams, withoutAffixes, withoutFieldKits, withoutGroundOps, withoutRisk } from "./awayTeamTestFixtures";

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
  const res = startExpedition(state, "ship-1", 1, expeditionCandidates(state, "ship-1")[0].id);
  if (!res.success || !res.expedition) throw new Error(`dispatch refused: ${res.reason}`);
  let exp = withoutFieldKits(res.expedition);
  if (region) {
    const forced = generateRiskProfile(exp.seed, region, exp.bodies);
    exp = { ...exp, risk: forced.profile, bodies: exp.bodies.map((b, i) => ({ ...b, risk: forced.bodies[i] })) };
  }
  return { next: res.next, exp };
}

// One Ground team slotted (3 / 3) at `rank` and an empty pair: one team deploys. `over` edits a member.
function oneTeam(rank = 1, over: Record<string, Partial<AwayMember>> = {}): GameState {
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
  const res = startExpedition(setup.state, "ship-1", 1, "cand-0");
  if (!res.success || !res.expedition) throw new Error(`dispatch refused: ${res.reason}`);
  const d = withoutFieldKits(res.expedition);
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
    durability: 100,
    fittedToShipId: null,
    fittedToMemberId: wearer,
  };
}

// The ship-event chance and the step roll at EVERY scan boundary of the run (bodyIndex, step 1..steps-1), at the
// dispatch hour and 24 h out (the Constitution ramp's clock). FK-7 multiplies the device dial per boundary on
// flagged runs only; an unflagged run keeps exactly these.
function boundaryReads(exp: Expedition): unknown[] {
  const steps = exp.encounterSteps ?? 1;
  const out: unknown[] = [];
  exp.bodies.forEach((body, i) => {
    for (let k = 1; k < steps; k += 1) {
      for (const hours of [0, 24]) out.push([i, k, hours, shipScanEventChance(exp, body, hours), scanStepRoll(exp, i, k, hours)]);
    }
  });
  return out;
}

// The 1 s parity window (see the parity test). Pure.
function liveWindow(exp: Expedition, hand: boolean): [number, number] {
  if (!exp.groundOps) return [T0, T0 + 60_000];
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
  legacy: {
    build: () => {
      const s = withSlottedAwayTeams({ ...freshState(), awayMembers: [member("member-1", "security"), member("member-11", "science")], nextAwayMemberId: 100, expeditionSeed: 0x1236456, gameTimeSeconds: T0 });
      const d = dispatch(s);
      return { next: d.next, exp: withoutGroundOps(d.exp) };
    },
    check: (done, exp) => {
      expect("groundOps" in exp).toBe(false);
      expect((done.scanEvents ?? []).some((e) => e.kind === "encounter")).toBe(true);
    },
  },
  preSq4: {
    build: () => {
      const s = withSlottedAwayTeams(
        {
          ...freshState(),
          gameTimeSeconds: T0,
          awayMembers: [member("member-1", "security", { rank: 3 }), member("member-2", "security"), member("member-3", "security"), member("member-4", "security"), member("member-11", "science"), member("member-12", "science")],
          nextAwayMemberId: 100,
          expeditionSeed: 0x6eed1,
        },
        2,
      );
      const d = dispatch(s);
      return { next: d.next, exp: withoutRisk(d.exp) };
    },
    check: (done, exp) => {
      expect(exp.groundOps).toBeDefined();
      expect(exp.risk).toBeUndefined();
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
      expect(squadEncounterBias(exp.roster!.security, fieldDeviceEffectiveness(exp.roster))).toBeCloseTo(-0.4);
    },
  },
  lure: {
    build: () => dispatch(crewed(0xaadc2, "gg", 3, [tool("equip-901", "lureBeacon", "member-1")])),
    check: (done, exp) => {
      expect(squadEncounterBias(exp.roster!.security, fieldDeviceEffectiveness(exp.roster))).toBeCloseTo(0.4);
      expect((done.scanEvents ?? []).some((e) => e.kind === "shipEvent")).toBe(true);
    },
  },
  bothDevices: {
    build: () => dispatch(crewed(0xaadc2, "gg", 3, [tool("equip-901", "shroudEmitter", "member-1"), tool("equip-902", "lureBeacon", "member-4"), tool("equip-903", "lureBeacon", "member-5")])),
    check: (_done, exp) => {
      expect(squadEncounterBias(exp.roster!.security, fieldDeviceEffectiveness(exp.roster))).toBeCloseTo(0.4);
    },
  },
};

// Captured from the code BEFORE any Field Kits engine edit (FK-3, on top of 5656c2e): five checkpoint hashes (plus a
// fixture's extra ones), the phase at 2,000,000 s, the claim's whole-state hash, and for every Ground Ops run with
// ship events the hash of every boundary's ship-event chance and step roll. Cross-check: riskAware is the AF-1 gate's
// tierFourEnemy fixture (groundOpsAffixes.test.ts) and reproduces its capture exactly.
const GOLDEN: Record<string, string[]> = {
  legacy: ["2334d1e4", "7827d5f", "7827d5f", "7827d5f", "7827d5f", "complete", "401c4dfe"],
  preSq4: ["915b3013", "e34eece0", "5b44fe38", "1aa2a579", "9cabfa23", "complete", "1503c9fa"],
  riskAware: ["5b204c68", "8ea32568", "b3a4fc92", "b3a4fc92", "b3a4fc92", "complete", "8104073a", "aecdd3ab"],
  affixCat1: ["a125b2d7", "d17642e1", "d17642e1", "d17642e1", "d17642e1", "complete", "6a022578", "3f9ea2db"],
  affixCat2: ["c487dfef", "7d56af0d", "4b46d650", "4b46d650", "4b46d650", "complete", "361f1665", "3f9ea2db"],
  tierSeven: ["ab177aeb", "87da063c", "c7d06b78", "c7d06b78", "c7d06b78", "complete", "254d0d67", "d3f9694f"],
  ossirBleed: ["2088aced", "e3e14cee", "e3e14cee", "e3e14cee", "e3e14cee", "feeddd04", "complete", "74a3e7b4", "1540097"],
  shroud: ["8533bf1f", "cfacc53e", "a0a3f20b", "8d8264ae", "8d8264ae", "complete", "e24c9b72", "deee4b83"],
  lure: ["5e656376", "e269d354", "6d1cd4ad", "5cd7911d", "5cd7911d", "complete", "10a12e23", "90bc745"],
  bothDevices: ["dff1d4", "23671c98", "73d7715f", "878b5c69", "878b5c69", "complete", "5f1d8750", "90bc745"],
  ossirBattle: ["90bfefdc"],
  threat: ["ffd7bbbb"],
};

describe("FK-3 pre-Field-Kits goldens: a run without the Field Kits flag resolves byte-identically", () => {
  for (const [name, f] of Object.entries(FIXTURES)) {
    it(`${name}: five checkpoints, the phase at 2,000,000 s and the claim match the pre-Field-Kits capture`, () => {
      const { next, exp } = f.build();
      expect(withoutFieldKits(exp)).toEqual(exp);
      expect("fieldKits" in exp).toBe(false);
      const hashes = [...CHECKPOINTS, ...(f.extraAt ?? [])].map((t) => fnv(JSON.stringify(advanceExpedition(exp, t))));
      const done = advanceExpedition(exp, FINAL);
      f.check?.(done, exp);
      hashes.push(done.phase);
      const claimed = done.phase === "complete" ? claimExpedition({ ...next, expeditions: [done] }, done.id) : null;
      if (claimed) expect(claimed.success).toBe(true);
      hashes.push(claimed ? fnv(JSON.stringify(claimed.next)) : "unclaimed");
      if (exp.groundOps && shipEventsLive(exp)) hashes.push(fnv(JSON.stringify(boundaryReads(exp))));
      expect(hashes).toEqual(GOLDEN[name]);
    });
  }
});

describe("FK-3 parity: one call == 997 s chunks == 1 s steps on the same fixtures", () => {
  for (const [name, f] of Object.entries(FIXTURES)) {
    it(`${name}: one call == 997 s chunks == 1 s steps`, () => {
      const { exp } = f.build();
      const frozen = structuredClone(exp);
      // 997 s chunks from dispatch to the last checkpoint.
      const far = CHECKPOINTS[CHECKPOINTS.length - 1];
      expect(chunked(exp, T0, far, 997)).toEqual(advanceExpedition(exp, far));
      // 1 s steps over the busy stretch: a legacy run's first 60,000 s; a Ground Ops run's first hour of the window
      // (a hand-built run's first 3 hours), from a one-call advance to the window's opening.
      const [from, to] = liveWindow(exp, f.hand === true);
      const start = from === T0 ? exp : advanceExpedition(exp, from);
      expect(chunked(start, from, to, 1)).toEqual(advanceExpedition(exp, to));
      expect(exp).toEqual(frozen);
    });
  }
});

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
    const hash = fnv(JSON.stringify({ result, squad, guards, log }));
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
    const hash = fnv(JSON.stringify(reads));
    expect(hash).toBe(GOLDEN.threat[0]);
  });
});
