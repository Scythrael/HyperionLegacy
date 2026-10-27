// GEAR WEAR step 3 review follow-ups (2026-10-21): field repair acting on the run's own wear in real play, a
// time-skipped expedition's wear, the expedition reach gate on the pristine voyage, and proof that the golden files run
// with the use sources off would only gain the wear fields with wear on.

import { describe, expect, it } from "vitest";
import Decimal from "break_infinity.js";
import { MISSIONS, freshState, type EquipmentInstance, type Expedition, type GameState, type MissionKey } from "./model";
import { dispatchCaptainOnMission, dispatchCaptainOnPatrol, economyTick, installMissingCombatBaselines } from "./tick";
import { CONDITION_FULL, pieceCondition } from "./gearWear";
import { emptyWearEvents, recordExpeditionWear, resolveGearWear } from "./gearWearEngine";
import { candidateReach, candidateSystemById, candidateVoyage, claimExpedition, expeditionCandidates, expeditionDispatchGate, expeditionSystemGate } from "./expedition";
import { advanceExpedition } from "./expedition";
import { FIELD_REPAIR_DAMAGE_SHARE } from "./groundOps";
import { applyTimeSkip } from "./processSpeed";
import { asPreRanksDispatch, asPreSafeFirstRunsDispatch, dispatchPastPropulsion, plainAwayMember, withSlottedAwayTeams } from "./awayTeamTestFixtures";
import { WIRING_SHIP_ID, installPiece, shipOf, wiringBase, withAwayTeam } from "./wiring/probes";
import { withFixtureCondition } from "./wiring/wearProbes";
import { withGearWearOff } from "./gearWearSwitch.fixture";
import { withBattleWearOff } from "./battleWearSwitch.fixture";

const RNG = () => 0.5;

function stepped(s: GameState, n: number): GameState {
  let out = s;
  for (let i = 0; i < n; i++) out = economyTick(out, 1, RNG);
  return out;
}

function shipPieces(s: GameState): EquipmentInstance[] {
  return s.equipment.filter((e) => e.fittedToShipId === WIRING_SHIP_ID);
}

// An ordinary run: the starting freighter past the propulsion gates (not a training run, so it is wear-stamped), a
// medic squad, the ship leaving with hull damage one point under the field repair threshold so its first light damage
// sets it down for a REAL field repair (the complementGoldens pattern). No piece is worn before it leaves.
function fieldRepairRun(): { s: GameState; exp: Expedition; done: Expedition } {
  const squad = [
    { ...plainAwayMember("member-1", "security", "ship-1"), rank: 3 as const },
    { ...plainAwayMember("member-2", "security", "ship-1"), rank: 2 as const, traits: ["fieldMedic" as const] },
    plainAwayMember("member-11", "science", "ship-1"),
  ];
  const s = withSlottedAwayTeams({ ...freshState(), awayMembers: squad, nextAwayMemberId: 100, expeditionSeed: 0x1244 });
  // Dispatched as complementGoldens' groundOpsRepair dispatches it (before enemy ranks and safe first runs), whose ship
  // events set it down for a field repair.
  const res = asPreSafeFirstRunsDispatch(asPreRanksDispatch(dispatchPastPropulsion(s, "ship-1", 1, expeditionCandidates(s, "ship-1")[0].id)));
  if (!res.success || !res.expedition) throw new Error(`dispatch refused: ${res.reason}`);
  const exp0 = res.expedition;
  const exp: Expedition = { ...exp0, groundOps: { ...exp0.groundOps!, hullDamage: FIELD_REPAIR_DAMAGE_SHARE * exp0.groundOps!.shipEventProfile.battle!.hullMax - 1 } };
  const done = advanceExpedition(exp, 2_000_000);
  return { s: { ...res.next, expeditions: [exp] }, exp, done };
}

function homecoming(before: GameState, done: Expedition, dropWindows = false): GameState {
  const home: GameState = { ...before, gameTimeSeconds: done.phaseAnchorSeconds, expeditions: [done] };
  const events = emptyWearEvents();
  recordExpeditionWear(before, home, events);
  if (dropWindows) events.fieldWindows.clear();
  return resolveGearWear(before, home, events);
}

const reactor = (x: GameState) => pieceCondition(shipPieces(x).find((e) => e.slotType === "reactorCore")!);

describe("field repair acts on the run's OWN wear (real play, no pre-worn piece)", () => {
  it("a GO-8b leg repairs, at the field rate and in event order, the wear the same run took before it", () => {
    const { s, exp, done } = fieldRepairRun();
    expect(exp.gearWear).toBeDefined();
    expect(done.phase).toBe("complete");
    expect(done.groundOps!.repairLegs?.length ?? 0).toBeGreaterThan(0);
    expect(shipPieces(s).every((e) => e.condition === undefined)).toBe(true);
    const withLeg = homecoming(s, done);
    const withoutLeg = homecoming(s, done, true);
    expect(reactor(withoutLeg)).toBeLessThan(CONDITION_FULL);
    expect(reactor(withLeg)).toBeGreaterThan(reactor(withoutLeg));
  });

  it("the tail of economyTick records the leg and applies it the same way", () => {
    const { s, done } = fieldRepairRun();
    const before: GameState = { ...s, gameTimeSeconds: done.phaseAnchorSeconds - 1 };
    const ticked = economyTick(before, 1, RNG);
    expect(ticked.expeditions[0].phase).toBe("complete");
    const expected = homecoming(before, ticked.expeditions[0]);
    expect(shipPieces(ticked).map((e) => [e.id, pieceCondition(e)])).toEqual(
      shipPieces(expected).map((e) => [e.id, pieceCondition(e)]),
    );
  });
});

describe("a time-skipped expedition still takes its wear", () => {
  it("the skip brings the run home now, its use wear and field repairs on its timeline laid back to end now", () => {
    const { s } = fieldRepairRun();
    const skip = applyTimeSkip(s, { kind: "expedition", id: s.expeditions[0].id });
    expect(skip.applied).toBe(true);
    expect(skip.next.expeditions[0].phase).toBe("complete");
    const worn = shipPieces(skip.next).filter((e) => e.condition !== undefined);
    expect(worn.length).toBeGreaterThan(0);
    for (const e of worn) expect(e.conditionAt!).toBeLessThanOrEqual(s.gameTimeSeconds);
    // The next ticks never apply it twice (the run was already home): the gear only recovers.
    const after = stepped(skip.next, 2);
    for (const e of shipPieces(after)) {
      const was = worn.find((w) => w.id === e.id);
      if (was) expect(pieceCondition(e)).toBeGreaterThanOrEqual(pieceCondition(was));
    }
  });
});

describe("the expedition reach gate reads the pristine voyage (design 4.3: no gate reads a worn value)", () => {
  it("a worn drive flies a slower voyage, but reach, the system gate and the dispatch gate never move", () => {
    const s = withAwayTeam(installPiece(wiringBase("orion"), { slotType: "ftlDrive", implicitStats: { transitSpeedMult: 20, fuelCapacity: 40 } }));
    const worn = withFixtureCondition(s, "ftlDrive", 0);
    const ship = shipOf(s);
    const cands = expeditionCandidates(s, WIRING_SHIP_ID);
    expect(cands.length).toBeGreaterThan(0);
    for (const c of cands) {
      const cand = candidateSystemById(s, c.id)!;
      expect(candidateReach(worn, ship, cand)).toEqual(candidateReach(s, ship, cand));
      expect(expeditionSystemGate(worn, ship, cand)).toEqual(expeditionSystemGate(s, ship, cand));
      expect(expeditionDispatchGate(worn, ship, c.id)).toEqual(expeditionDispatchGate(s, ship, c.id));
      expect(candidateVoyage(worn, ship, cand, false).outboundSeconds).toBeGreaterThan(candidateVoyage(s, ship, cand, false).outboundSeconds);
    }
  });
});

// The golden files captured before step 3 run with the use sources off (gearWearOffInThisFile). Their fixtures fly
// Standard-Issue gear, whose lines fold to nothing, so with wear ON the only difference is the wear fields themselves:
// the run stamps, the ground tally and the pieces' condition and anchor. Proven here on each kind of run they fly. (A
// fixture that carries crafted, lined gear also folds its wear from cycle 2 by the re-read rule, user 2026-10-21:
// gearWearGoldens.test.ts pins those moves.)
function withoutWearFields(s: GameState): string {
  return JSON.stringify(s, (k, v) => (k === "gearWear" || k === "wearTally" || k === "condition" || k === "conditionAt" ? undefined : v));
}

const RUNS: [string, () => GameState][] = [
  ...(Object.keys(MISSIONS) as MissionKey[]).map(
    (key) =>
      [
        `mission ${key}`,
        () => {
          const base = installMissingCombatBaselines({ ...freshState(), credits: new Decimal(1e6), captains: freshState().captains.map((c) => ({ ...c, level: 10 })) });
          const r = dispatchCaptainOnMission(base, 1, key);
          return r.success ? stepped(r.next, 1800) : base;
        },
      ] as [string, () => GameState],
  ),
  [
    // Gear wear step 4: a patrol's battle wear (its own carried wear changes its later cycles) is proven by
    // gearWearCombatGoldens.test.ts; here the battle sources stay off so the run shows step 3's use wear fields alone.
    "a patrol",
    () =>
      withBattleWearOff(() => {
        const r = dispatchCaptainOnPatrol(installMissingCombatBaselines(wiringBase("destroyer")), 1, "crimsonReaverSweep", "balanced", true);
        return stepped(r.next, 900);
      }),
  ],
  [
    "an ordinary expedition with a field repair, home and claimed",
    () => {
      const { s, done } = fieldRepairRun();
      const home = economyTick({ ...s, gameTimeSeconds: done.phaseAnchorSeconds - 1 }, 1, RNG);
      return claimExpedition(stepped(home, 30), done.id).next;
    },
  ],
];

describe("with wear on, the use-wear-off goldens' runs gain only the wear fields", () => {
  for (const [name, run] of RUNS) {
    it(name, () => {
      expect(withoutWearFields(run())).toBe(withoutWearFields(withGearWearOff(run)));
    });
  }
  it("and the wear really is on in them (vacuity guard)", () => {
    const on = RUNS.find(([n]) => n === "mission shortOreRun")![1]();
    expect(on.equipment.some((e) => e.condition !== undefined)).toBe(true);
    const exp = RUNS.find(([n]) => n.startsWith("an ordinary expedition"))![1]();
    expect(exp.equipment.some((e) => e.condition !== undefined)).toBe(true);
  });
});
