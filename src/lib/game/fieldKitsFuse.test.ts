// TIMED GRENADES (user 2026-10-21; recipe realism audit call 11 verbatim: "Impact grenade could be the default grenade
// type as it basically explodes on contact with a surface, versus a timed detonation which other units could have?
// Perhaps they take a few ticks to explode."; merge-batch answers "Timed grenades fuse": "1 round later (Recommended)":
// "Impact Grenade is the default and explodes on contact; Stun and Toxin grenades detonate at the start of the
// thrower's next turn (enemies may move out of a cluster first)").
//
// Covered: the catalog (Stun and Toxin carry the fuse, the Impact Grenade none), the flag (only a run stamped with Field
// Kits catalog 2 arms a fuse; catalog 1, in flight before it, detonates on contact; a new dispatch stamps 2), the
// prime (the charge and the battle's throw spent at once, nothing hit), the detonation at the START of the thrower's
// next turn (before it acts, whether or not it can), the cluster re-forming (a foe downed first is not hit, each foe
// still standing may move clear on its own keyed stream), a fight won before the fuse burns down, and the log lines.
// The whole-run pins (catalog 1 byte-identical, catalog 2 moved and named, Impact-only unchanged) are
// fieldKitsFuseGoldens.test.ts; offline == live on a catalog 2 throwing run is fieldKitsCharges.test.ts.

import { describe, expect, it } from "vitest";
import { GRENADE_FUSE_MOVED_CLEAR_CHANCE, TIMED_GRENADE_FUSE, type EquipmentInstance, type GambitProgram, type SnapshotMember } from "./model";
import { GRENADE_FUSE_SALT, NEURAL_BACKUP_SALT, resolveGroundBattle, type GambitLogEvent, type GroundCombatant, type ThrownGrenade } from "./gambit";
import { snapshotMember } from "./awayTeam";
import { GRENADES, withThrownGrenades } from "./fieldKitsGrenades";
import { FIELD_KITS_CATALOG_VERSION, TIMED_FUSES_CATALOG, timedFusesLive } from "./fieldKits";
import { makeRng } from "./combat/rng";
import { plainAwayMember } from "./awayTeamTestFixtures";
import { WIRING_REGISTRY } from "./wiring/registry";
import { FUSE_ADDED_ENTRY_IDS } from "./fieldKitsFuse.fixture";

function gc(id: string, side: "team" | "enemy", over: Partial<GroundCombatant> = {}): GroundCombatant {
  return {
    id,
    side,
    role: side === "team" ? "security" : "bruiser",
    hp: 100,
    hpMax: 100,
    power: 12,
    accuracy: 1,
    armor: 0,
    heal: 0,
    threat: 12,
    groupTag: side === "team" ? "team" : "a",
    statuses: [],
    downed: false,
    ...over,
  };
}

const HOLD: GambitProgram = [{ target: "self", action: "hold" }];
const THROW: GambitProgram = [{ target: "foeLargestGroup", action: "throwGrenade" }, { target: "foeNearest", action: "attack" }];
const BIG = 1_000_000;

// A Stun Grenade's throw armed as a catalog 2 fight arms it (power and debuff at the reference numbers).
function stun(movedClearPermille: number, over: Partial<ThrownGrenade> = {}): ThrownGrenade {
  return { status: "stun", statusPermille: 0, powerMult: 0.5, charges: 2, perBattle: 1, used: 0, fuse: { movedClearPermille }, ...over };
}

// A thrower with `grenade` who throws, then attacks; foes that only hold (so nothing but the grenade and the attacks moves).
function thrower(grenade: ThrownGrenade, over: Partial<GroundCombatant> = {}): GroundCombatant {
  return gc("a1", "team", { memberId: "member-1", power: 1000, hp: BIG, hpMax: BIG, program: THROW, grenade, ...over });
}
const foe = (id: string, over: Partial<GroundCombatant> = {}): GroundCombatant => gc(id, "enemy", { hp: BIG, hpMax: BIG, program: HOLD, ...over });

function fight(team: GroundCombatant[], enemies: GroundCombatant[], seed = 7, reviveSeed = 11): { result: ReturnType<typeof resolveGroundBattle>; log: GambitLogEvent[] } {
  const log: GambitLogEvent[] = [];
  const result = resolveGroundBattle(team, enemies, 0, makeRng(seed), log, reviveSeed);
  return { result, log };
}

const detonations = (log: GambitLogEvent[]) => log.filter((e) => e.action === "grenadeDetonates");

function piece(variety: string): EquipmentInstance {
  return {
    id: "equip-1",
    slotType: "memberTool",
    moduleVariant: variety,
    rarity: "standard",
    ascension: "none",
    quality: 0,
    iLevel: 10,
    blueprintKey: "bp-test",
    implicitStats: { groundStatusChance: 30 },
    rolledStats: {},
    mass: 0,
    powerDraw: 0,
    durabilityMax: 100,
    fittedToShipId: null,
    fittedToMemberId: "member-1",
  };
}
const wearer = (variety: string): SnapshotMember => snapshotMember(plainAwayMember("member-1", "security", "ship-1"), [piece(variety)]);
function armedWith(variety: string, timedFuses: boolean): GroundCombatant {
  const c = gc("a1", "team", { memberId: "member-1" });
  withThrownGrenades([c], [wearer(variety)], undefined, timedFuses);
  return c;
}

describe("timed grenades: the catalog and the flag", () => {
  it("the Stun and Toxin Grenades carry the timed fuse; the Impact Grenade (the default) detonates on contact", () => {
    expect(GRENADES.stunGrenade.fuse).toBe(TIMED_GRENADE_FUSE);
    expect(GRENADES.toxinGrenade.fuse).toBe(TIMED_GRENADE_FUSE);
    expect(GRENADES.impactGrenade.fuse).toBeUndefined();
    expect(TIMED_GRENADE_FUSE.movedClearChance).toBe(GRENADE_FUSE_MOVED_CLEAR_CHANCE);
  });

  it("only a run stamped with catalog 2 or later reads the fuse; new dispatches stamp it", () => {
    expect(TIMED_FUSES_CATALOG).toBe(2);
    expect(FIELD_KITS_CATALOG_VERSION).toBeGreaterThanOrEqual(TIMED_FUSES_CATALOG);
    expect(timedFusesLive({})).toBe(false);
    expect(timedFusesLive({ fieldKits: { catalog: 1 } })).toBe(false);
    expect(timedFusesLive({ fieldKits: { catalog: 2 } })).toBe(true);
    expect(timedFusesLive({ fieldKits: { catalog: FIELD_KITS_CATALOG_VERSION } })).toBe(true);
  });

  it("arming: a catalog 2 fight arms the Stun and Toxin fuse at the moved-clear chance; catalog 1 and the Impact Grenade arm none", () => {
    const permille = Math.round(GRENADE_FUSE_MOVED_CLEAR_CHANCE * 1000);
    expect(armedWith("stunGrenade", true).grenade?.fuse).toEqual({ movedClearPermille: permille });
    expect(armedWith("toxinGrenade", true).grenade?.fuse).toEqual({ movedClearPermille: permille });
    expect(armedWith("impactGrenade", true).grenade?.fuse).toBeUndefined();
    expect(armedWith("stunGrenade", false).grenade?.fuse).toBeUndefined();
    // Everything else about the throw is the same on both catalogs.
    const { fuse: _, ...rest } = armedWith("stunGrenade", true).grenade!;
    expect(rest).toEqual(armedWith("stunGrenade", false).grenade);
  });

  it("the moved-clear stream has its own odd salt, distinct from Neural Backup's", () => {
    expect(GRENADE_FUSE_SALT % 2).toBe(1);
    expect(GRENADE_FUSE_SALT).not.toBe(NEURAL_BACKUP_SALT);
  });
});

describe("timed grenades: prime, then detonate at the start of the thrower's next turn", () => {
  it("the throw primes (the charge is spent, nobody is hit); the blast lands at the start of the next round, before the thrower acts", () => {
    const e1 = foe("e1");
    const e2 = foe("e2");
    const { result, log } = fight([thrower(stun(0))], [e1, e2]);
    const primed = log.find((e) => e.action === "throwGrenade");
    expect(primed).toMatchObject({ round: 1, memberId: "member-1", primed: true, targetSide: "enemy" });
    expect(primed?.hpDelta).toBeUndefined();
    expect(primed?.missed).toBeUndefined();
    // Round 1 after the throw: no foe lost HP (the thrower's only action was the throw; the foes hold).
    const det = detonations(log);
    expect(det).toHaveLength(1);
    expect(det[0]).toMatchObject({ round: 2, memberId: "member-1", targetSide: "enemy" });
    expect(det[0].blast).toEqual({ hit: 2, movedClear: 0, missed: 0, downed: 0, afflicted: 0 });
    expect(det[0].hpDelta).toBeLessThan(0);
    // In round 2 the detonation comes first, then the thrower's own action (an attack: the battle's throw is spent).
    const round2 = log.filter((e) => e.round === 2 && e.memberId === "member-1");
    expect(round2.map((e) => e.action)).toEqual(["grenadeDetonates", "attack"]);
    expect(result.chargesUsed).toEqual({ "member-1": 1 });
  });

  it("the same grenade WITHOUT a fuse (catalog 1, or the Impact Grenade) hits on the throw itself", () => {
    const { log } = fight([thrower(stun(0, { fuse: undefined }))], [foe("e1"), foe("e2")]);
    const thrown = log.find((e) => e.action === "throwGrenade");
    expect(thrown?.primed).toBeUndefined();
    expect(thrown?.round).toBe(1);
    expect(thrown?.hpDelta).toBeLessThan(0);
    expect(detonations(log)).toHaveLength(0);
  });

  it("a thrower downed before its next turn still sets it off (the fuse burns regardless)", () => {
    // Poison at the end of round 1 downs the 1 HP thrower; a squadmate keeps the fight going.
    const a1 = thrower(stun(0), { hp: 1, hpMax: 1, statuses: [{ id: "poison", remaining: 4, magnitude: 5 }] });
    const a2 = gc("a2", "team", { memberId: "member-2", hp: BIG, hpMax: BIG, power: 1, program: HOLD });
    const { log } = fight([a1, a2], [foe("e1"), foe("e2")]);
    const det = detonations(log);
    expect(det).toHaveLength(1);
    expect(det[0].round).toBe(2);
    expect(det[0].blast?.hit).toBe(2);
  });

  it("the cluster RE-FORMS: a foe downed before the detonation is not hit; the rest of its group still is", () => {
    // a2 acts after a1 in round 1 and finishes the target (e1) before the fuse burns down.
    const a2 = gc("a2", "team", { memberId: "member-2", power: 1000, program: [{ target: "foeLowestHp", action: "attack" }] });
    const { log } = fight([thrower(stun(0)), a2], [foe("e1", { hp: 1, hpMax: BIG }), foe("e2")]);
    const det = detonations(log);
    expect(det).toHaveLength(1);
    const b = det[0].blast!;
    expect(b.hit + b.missed + b.movedClear).toBe(1);
    expect(b.hit).toBe(1);
  });

  it("only the target's group is in the cluster (a foe of another group is never hit)", () => {
    const other = foe("e3", { groupTag: "b" });
    const { log } = fight([thrower(stun(0))], [foe("e1"), foe("e2"), other]);
    // foeLargestGroup picks group "a" (two bodies).
    expect(detonations(log)[0].blast?.hit).toBe(2);
    expect(other.hp).toBe(BIG);
  });

  it("foes MOVE CLEAR at the fuse's chance: certain, none is hit; never, every one in reach is", () => {
    const e1 = foe("e1");
    const e2 = foe("e2");
    const all = fight([thrower(stun(1000))], [e1, e2]);
    expect(detonations(all.log)[0].blast).toEqual({ hit: 0, movedClear: 2, missed: 0, downed: 0, afflicted: 0 });
    expect(detonations(all.log)[0].hpDelta).toBeUndefined();
    const none = fight([thrower(stun(0))], [foe("e1"), foe("e2")]);
    expect(detonations(none.log)[0].blast?.movedClear).toBe(0);
  });

  it("the moved-clear rolls ride their own keyed stream: over many battles about the configured share moves clear", () => {
    const permille = Math.round(GRENADE_FUSE_MOVED_CLEAR_CHANCE * 1000);
    let moved = 0;
    let bodies = 0;
    for (let k = 0; k < 400; k += 1) {
      const { log } = fight([thrower(stun(permille))], [foe("e1"), foe("e2")], 7, (k * 0x9e3779b1) >>> 0);
      const b = detonations(log)[0].blast!;
      moved += b.movedClear;
      bodies += 2;
    }
    const share = moved / bodies;
    expect(share).toBeGreaterThan(GRENADE_FUSE_MOVED_CLEAR_CHANCE - 0.05);
    expect(share).toBeLessThan(GRENADE_FUSE_MOVED_CLEAR_CHANCE + 0.05);
  });

  it("with no chance to move clear the fight never reads the fuse stream (the battle seed alone decides it)", () => {
    const a = fight([thrower(stun(0))], [foe("e1"), foe("e2")], 7, 1);
    const b = fight([thrower(stun(0))], [foe("e1"), foe("e2")], 7, 99);
    expect(b.log).toEqual(a.log);
    expect(b.result).toEqual(a.result);
  });

  it("the debuff lands at detonation through the same rolls as on contact", () => {
    const { log } = fight([thrower(stun(0, { statusPermille: 1000 }))], [foe("e1"), foe("e2")]);
    const det = detonations(log)[0];
    expect(det.blast?.afflicted).toBe(2);
    expect(det.statusApplied).toBe(true);
  });

  it("a fight won before the fuse burns down never detonates; the throw's charge stays spent", () => {
    const a2 = gc("a2", "team", { memberId: "member-2", power: 1000, program: [{ target: "foeNearest", action: "attack" }] });
    const { result, log } = fight([thrower(stun(0)), a2], [foe("e1", { hp: 1, hpMax: 1 })]);
    expect(result.result).toBe("win");
    expect(result.rounds).toBe(0);
    expect(detonations(log)).toHaveLength(0);
    expect(result.chargesUsed).toEqual({ "member-1": 1 });
  });

  it("logging is observation only: the same battle with and without a log sink", () => {
    const a = resolveGroundBattle([thrower(stun(200))], [foe("e1"), foe("e2")], 0, makeRng(3), undefined, 5);
    const b = resolveGroundBattle([thrower(stun(200))], [foe("e1"), foe("e2")], 0, makeRng(3), [], 5);
    expect(b).toEqual(a);
  });
});

describe("timed grenades: the wiring registry entries the fuse adds", () => {
  it("each grenade's fuse is live; the moved-clear chance is live on the timed ones and not applicable on the Impact Grenade", () => {
    const rows = WIRING_REGISTRY.filter((e) => FUSE_ADDED_ENTRY_IDS.has(e.id)).map((e) => [e.id, e.status.kind, e.contexts.join(","), e.probe ?? null, e.notApplicable ? "n/a" : ""]);
    expect(rows).toEqual([
      ["away:GRENADES:stunGrenade:fuse", "live", "ground", "content:grenade:stunGrenade:fuse", ""],
      ["away:GRENADES:stunGrenade:movedClear", "live", "ground", "content:grenade:stunGrenade:movedClear", ""],
      ["away:GRENADES:toxinGrenade:fuse", "live", "ground", "content:grenade:toxinGrenade:fuse", ""],
      ["away:GRENADES:toxinGrenade:movedClear", "live", "ground", "content:grenade:toxinGrenade:movedClear", ""],
      ["away:GRENADES:impactGrenade:fuse", "live", "ground", "content:grenade:impactGrenade:fuse", ""],
      ["away:GRENADES:impactGrenade:movedClear", "live", "", null, "n/a"],
    ]);
  });
});
