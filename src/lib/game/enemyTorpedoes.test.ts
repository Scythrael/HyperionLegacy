// WR-8b ENEMY TORPEDOES (user 2026-11-10 "Simple now"): the unit proofs. The Corsair Carrier installs the Concussion
// Torpedo beside its plasma; a Marauder carries one at a chance on the patrol ramp (the WR-10 Corroded mechanism); a
// ship event's vessel carries one at its tier's chance; a Defensive ship's point defense shoots some down; every input
// is frozen when the run starts, so one call == 997 s chunks == 1 s steps and in-flight runs replay byte-identically.

import { describe, expect, it } from "vitest";
import Decimal from "break_infinity.js";
import {
  PATROLS,
  type Expedition,
  type GameState,
  type PatrolMissionState,
} from "./model";
import { dispatchCaptainOnPatrol, economyTick } from "./tick";
import { advanceExpedition } from "./expedition";
import {
  generateEnemyWave,
  generateEnemyWaveDetailed,
} from "./combat/enemyWave";
import {
  patrolMarauderTorpedoPermille,
  patrolTorpedoesLive,
  patrolWaveEnemyParams,
} from "./combat/patrolProfile";
import {
  COMBAT_RULES_WR8,
  DEFENSIVE_STANCE,
  MARAUDER_TORPEDO_PERMILLE,
  RULES_COMBAT_SPEED,
  SHIP_EVENT_TORPEDO_PERMILLE_BY_TIER,
  newCombatRulesStamp,
  type CombatRulesStamp,
} from "./combat/combatRules";
import { resolveBattle } from "./combat/resolveBattle";
import { flavorCategory } from "./combat/flavor";
import { formatCombatLog } from "./combat/logFormat";
import { simplifiedLogTokens, visualBeatsForRound } from "./combat/combatView";
import {
  shipEventCarriesTorpedo,
  shipEventEnemy,
  shipEventTorpedoPermille,
  HOSTILE_PROBE_HULL,
  CLOAKED_VESSEL_HULL,
} from "./shipScanEvents";
import {
  N_FULL,
  PATROL_RULES_RAMP_FLOOR,
  patrolDifficultyAt,
  patrolEnemyScale,
  rampFraction,
} from "./runDifficulty";
import { replayPatrol } from "./combat/patrolReplay";
import { onHull, stateHash, withCrew } from "./firstRunsGoldens.fixture";
import {
  asExpeditionVeteran,
  asPatrolVeteran,
  dispatchPastPropulsion,
} from "./awayTeamTestFixtures";
import { onPatrolCurve, routeTicks } from "./safeFirstPatrol.fixture";
import { withEnemyTorpedoesOff } from "./enemyTorpedoSwitch.fixture";
import {
  PATROL_TORPEDO_HELP,
  SHIP_EVENT_TORPEDO_HELP,
  marauderTorpedoPermilleAfter,
  patrolTorpedoLine,
} from "../enemyTorpedoDisplay";
import { HELP_TOPICS } from "../helpTopics";

const STAMP: CombatRulesStamp = {
  rules: COMBAT_RULES_WR8,
  speed: RULES_COMBAT_SPEED,
  enemyTorpedoes: 1,
};
const torpedoes = (weapons: { weaponType?: string }[]): number =>
  weapons.filter((w) => w.weaponType === "concussionTorpedo").length;
const curveStamp = (completed: number) => ({
  version: 1 as const,
  firstRun: false,
  ramp: rampFraction(completed),
  tier: 1 as const,
  completed,
});

describe("WR-8b: the stamp", () => {
  it("every new combat rules stamp carries enemyTorpedoes; the switch writes none", () => {
    expect(newCombatRulesStamp(30)).toEqual({
      rules: COMBAT_RULES_WR8,
      speed: 30,
      enemyTorpedoes: 1,
    });
    expect(withEnemyTorpedoesOff(() => newCombatRulesStamp(30))).toEqual({
      rules: COMBAT_RULES_WR8,
      speed: 30,
    });
  });
});

describe("WR-8b: patrol waves", () => {
  const wave = (
    hull: "raider" | "marauder" | "corsairCarrier",
    seed: number,
    permille?: number,
  ) =>
    generateEnemyWaveDetailed(seed, {
      hullPool: [hull],
      enemyCountMin: 1,
      enemyCountMax: 1,
      idPrefix: "t",
      combatRules: true,
      ...(permille === undefined
        ? {}
        : { torpedoes: { marauderPermille: permille } }),
    });

  it("a Corsair Carrier installs the torpedo beside its plasma, last in its list; a Raider never carries one", () => {
    const c = wave("corsairCarrier", 7, 0).enemies[0];
    expect(c.weapons.map((w) => w.weaponType)).toEqual([
      "plasma",
      "concussionTorpedo",
    ]);
    expect(c.weapons[1].missile).toBe(true); // the missile trait: a Defensive point defense can shoot it down
    expect(torpedoes(wave("corsairCarrier", 7).enemies[0].weapons)).toBe(0); // no torpedoes on the wave: none
    for (let seed = 1; seed <= 50; seed++)
      expect(torpedoes(wave("raider", seed, 1000).enemies[0].weapons)).toBe(0);
  });

  it("a Marauder carries one at its chance on a private stream: never at 0, always at 1000, about the chance between", () => {
    let at0 = 0;
    let at1000 = 0;
    let at400 = 0;
    for (let seed = 1; seed <= 1000; seed++) {
      at0 += torpedoes(wave("marauder", seed, 0).enemies[0].weapons);
      at1000 += torpedoes(wave("marauder", seed, 1000).enemies[0].weapons);
      at400 += torpedoes(wave("marauder", seed, 400).enemies[0].weapons);
    }
    expect(at0).toBe(0);
    expect(at1000).toBe(1000);
    expect(at400).toBeGreaterThan(340);
    expect(at400).toBeLessThan(460);
  });

  it("the enemy stream never moves: the same count and hull picks with or without torpedoes", () => {
    const params = {
      hullPool: PATROLS.crimsonReaverWarband.hullPool,
      enemyCountMin: 1,
      enemyCountMax: 4,
      idPrefix: "t",
      combatRules: true,
    };
    for (let seed = 1; seed <= 200; seed++) {
      const off = generateEnemyWaveDetailed(seed, params);
      const on = generateEnemyWaveDetailed(seed, {
        ...params,
        torpedoes: { marauderPermille: 500 },
      });
      expect(on.hullIds).toEqual(off.hullIds);
      on.enemies.forEach((e, i) =>
        expect(e.weapons.slice(0, off.enemies[i].weapons.length)).toEqual(
          off.enemies[i].weapons,
        ),
      );
    }
    // And deterministic: the same seed and params give the same torpedoes.
    expect(
      generateEnemyWave(42, {
        ...params,
        torpedoes: { marauderPermille: 500 },
      }),
    ).toEqual(
      generateEnemyWave(42, {
        ...params,
        torpedoes: { marauderPermille: 500 },
      }),
    );
  });

  it("the Marauder's chance climbs the patrol ramp: 0 on the training patrol and the first two ramped patrols, full at the top", () => {
    expect(
      patrolMarauderTorpedoPermille({
        difficulty: { ...curveStamp(0), firstRun: true },
      }),
    ).toBe(0);
    expect(patrolMarauderTorpedoPermille({ difficulty: curveStamp(0) })).toBe(
      0,
    );
    expect(patrolMarauderTorpedoPermille({ difficulty: curveStamp(1) })).toBe(
      0,
    );
    let last = 0;
    for (let c = 2; c < N_FULL; c++) {
      const p = patrolMarauderTorpedoPermille({ difficulty: curveStamp(c) });
      expect(p, `completed ${c}`).toBeGreaterThan(last);
      expect(p).toBeLessThan(MARAUDER_TORPEDO_PERMILLE);
      last = p;
    }
    expect(patrolMarauderTorpedoPermille({})).toBe(MARAUDER_TORPEDO_PERMILLE); // no curve stamp: full strength
    // The display reads the same numbers.
    expect(marauderTorpedoPermilleAfter(N_FULL)).toBe(
      MARAUDER_TORPEDO_PERMILLE,
    );
    expect(marauderTorpedoPermilleAfter(4)).toBe(
      patrolMarauderTorpedoPermille({ difficulty: curveStamp(4) }),
    );
  });

  // The WR-8b fix round (user 2026-11-10, "Smooth it out (Recommended)": the 9th and 10th patrols step up like the
  // rest, ending at the same 40%). The live dispatch's stamp (patrolDifficultyAt) read at every completed-patrol
  // count: 0, 0, 1.5%, 4.2%, 7.7%, 11.9%, 16.6%, 21.8%, 27.4%, 31.6%, 35.8% (the 11th patrol after the training
  // patrol, completed 10: the enemy curve's top, the odds ramp one run behind it), then 40% with no stamp.
  it("the whole curve a dispatch stamps, with no jump at the top: 31.6%, 35.8%, then 40%", () => {
    const CURVE = [0, 0, 15, 42, 77, 119, 166, 218, 274, 316, 358, 400, 400];
    const base = onHull("carrier");
    const stamps = CURVE.map((_, c) => patrolDifficultyAt(onPatrolCurve(base, c)));
    expect(
      stamps.map((difficulty) => patrolMarauderTorpedoPermille({ difficulty })),
    ).toEqual(CURVE);
    expect(CURVE.map((_, c) => marauderTorpedoPermilleAfter(c))).toEqual(CURVE);
    // Completed 10 is the enemy curve's top: full enemy strength, still stamped for the odds; completed 11 is unstamped.
    expect(stamps[10]).toEqual({
      version: 1,
      firstRun: false,
      ramp: 1,
      tier: 1,
      completed: 10,
    });
    expect(patrolEnemyScale({ difficulty: stamps[10], combatRules: STAMP })).toBe(1);
    expect(stamps[11]).toBeUndefined();
    expect(stamps[12]).toBeUndefined();
    // Every step is a step: the top two climb by no more than the steps before them (the old 31.6% to 40% jump).
    const steps = CURVE.slice(3, 12).map((p, i) => p - CURVE[i + 2]);
    expect(Math.max(...steps.slice(-2))).toBeLessThanOrEqual(
      Math.max(...steps.slice(0, -2)),
    );
    // A veteran stays unstamped (full strength, 40%), and a build with WR-8b off stores what it did (no stamp at 10).
    expect(patrolDifficultyAt(asPatrolVeteran(base))).toBeUndefined();
    expect(
      withEnemyTorpedoesOff(() => patrolDifficultyAt(onPatrolCurve(base, 10))),
    ).toBeUndefined();
    // The training patrol is untouched.
    expect(patrolDifficultyAt(base)).toEqual({
      version: 1,
      firstRun: true,
      ramp: 0,
      tier: 1,
      completed: 0,
    });
  });

  it("only a stamped cycle that is not the training cycle fields torpedoes", () => {
    const def = PATROLS.crimsonReaverWarband;
    expect(
      patrolWaveEnemyParams(def, { combatRules: STAMP }, "x").torpedoes,
    ).toEqual({ marauderPermille: MARAUDER_TORPEDO_PERMILLE });
    expect(
      patrolWaveEnemyParams(
        def,
        { combatRules: { rules: COMBAT_RULES_WR8, speed: 30 } },
        "x",
      ).torpedoes,
    ).toBeUndefined();
    expect(
      patrolTorpedoesLive({
        combatRules: STAMP,
        difficulty: { ...curveStamp(0), firstRun: true },
      }),
    ).toBe(false);
    expect(
      patrolWaveEnemyParams(
        def,
        {
          combatRules: STAMP,
          difficulty: { ...curveStamp(0), firstRun: true },
        },
        "x",
      ).torpedoes,
    ).toBeUndefined();
  });
});

function patrolSave(completed: number | null): GameState {
  const s = {
    ...onHull("carrier"),
    nextPatrolSeed: 3,
    credits: new Decimal(100_000),
  };
  return completed === null ? asPatrolVeteran(s) : onPatrolCurve(s, completed);
}

describe("WR-8b: the live patrol", () => {
  it("a dispatch stamps the cycle; the training patrol fights no torpedo", () => {
    const r = dispatchCaptainOnPatrol(
      patrolSave(null),
      1,
      "crimsonReaverWarband",
      "standoff",
      false,
    );
    expect(
      (r.next.captains[0].mission as PatrolMissionState).combatRules
        ?.enemyTorpedoes,
    ).toBe(1);
    const fresh = {
      ...onHull("carrier"),
      nextPatrolSeed: 3,
      credits: new Decimal(100_000),
    };
    const t = dispatchCaptainOnPatrol(
      fresh,
      1,
      "crimsonReaverWarband",
      "balanced",
      false,
    );
    const m = t.next.captains[0].mission as PatrolMissionState;
    expect(m.difficulty?.firstRun).toBe(true);
    expect(
      patrolWaveEnemyParams(PATROLS.crimsonReaverWarband, m, "x").torpedoes,
    ).toBeUndefined();
  });

  it("a ramped cycle's Corsair Carriers carry the torpedo at the curve's strength, like every other weapon", () => {
    const at = (c: number, seed: number) => {
      const r = dispatchCaptainOnPatrol(
        { ...patrolSave(c), nextPatrolSeed: seed },
        1,
        "crimsonReaverWarband",
        "balanced",
        false,
      );
      return replayPatrol(r.next, r.next.captains[0]);
    };
    let carriers = 0;
    for (let seed = 1; seed <= 8; seed++) {
      const floor = at(0, seed);
      const top = at(N_FULL - 1, seed);
      floor.waves.slice(0, top.waves.length).forEach((w, i) =>
        w.enemyHullIds.forEach((id, j) => {
          if (id !== "corsairCarrier") return;
          carriers += 1;
          const e = w.enemyStart[j].weapons;
          const nominal = top.waves[i].enemyStart[j].weapons;
          expect(e.map((x) => x.weaponType)).toEqual([
            "plasma",
            "concussionTorpedo",
          ]);
          expect(e.map((x) => x.yieldMax)).toEqual(
            nominal.map((x) =>
              Math.round(x.yieldMax * PATROL_RULES_RAMP_FLOOR),
            ),
          );
        }),
      );
    }
    expect(carriers).toBeGreaterThan(0);
  });

  it("one call == 997 s chunks == 1 s steps on a Dispatch Repeatedly Warband with torpedoes", () => {
    const r = dispatchCaptainOnPatrol(
      patrolSave(null),
      1,
      "crimsonReaverWarband",
      "standoff",
      true,
    );
    const span =
      routeTicks(r.next.captains[0].mission as PatrolMissionState) * 3 + 5;
    const one = economyTick(r.next, span, () => 0.5);
    let chunks = r.next;
    let left = span;
    while (left > 0) {
      const step = Math.min(997, left);
      chunks = economyTick(chunks, step, () => 0.5);
      left -= step;
    }
    let steps = r.next;
    for (let i = 0; i < span; i++) steps = economyTick(steps, 1, () => 0.5);
    expect(stateHash(chunks)).toBe(stateHash(one));
    expect(stateHash(steps)).toBe(stateHash(one));
  });

  it("a cycle dispatched before WR-8b fights no torpedo when the live engine advances it", () => {
    const r = withEnemyTorpedoesOff(() =>
      dispatchCaptainOnPatrol(
        patrolSave(null),
        1,
        "crimsonReaverWarband",
        "balanced",
        false,
      ),
    );
    const m = r.next.captains[0].mission as PatrolMissionState;
    expect(m.combatRules?.enemyTorpedoes).toBeUndefined();
    expect(
      patrolWaveEnemyParams(PATROLS.crimsonReaverWarband, m, "x").torpedoes,
    ).toBeUndefined();
  });
});

describe("WR-8b: point defense against a torpedo", () => {
  // A Defensive Carrier (Point Defense working) against a torpedo-armed Corsair Carrier, both too tough to die.
  function fight(seed: number, interceptPct: number) {
    const p = generateEnemyWave(1, {
      hullPool: ["corsairCarrier"],
      enemyCountMin: 1,
      enemyCountMax: 1,
      idPrefix: "p",
      combatRules: true,
    })[0];
    p.id = "p";
    p.team = "player";
    p.position = 0;
    p.weapons = [
      { ...p.weapons[0], weaponType: "pointDefenseArray", antiDrone: true },
    ];
    p.hull = p.hullMax = 1_000_000;
    p.defensive = { ...DEFENSIVE_STANCE, missileInterceptPct: interceptPct };
    p.defensiveCarry = { taken: 0, dealt: 0, absorb: 0 };
    const e = generateEnemyWave(1, {
      hullPool: ["corsairCarrier"],
      enemyCountMin: 1,
      enemyCountMax: 1,
      idPrefix: "e",
      combatRules: true,
      torpedoes: { marauderPermille: 0 },
    })[0];
    e.hull = e.hullMax = 1_000_000;
    return resolveBattle({ combatants: [p, e] }, seed, {
      combatRules: COMBAT_RULES_WR8,
      precharge: true,
      generateLog: true,
    });
  }

  it("shoots some torpedoes down, and the battle log says so (not a dodge)", () => {
    let intercepted = 0;
    let lines = 0;
    for (const seed of [1, 2, 3]) {
      const r = fight(seed, DEFENSIVE_STANCE.missileInterceptPct);
      const downs = r.log.filter(
        (ev) => ev.type === "evade" && (ev.intercepted ?? 0) > 0,
      );
      intercepted += downs.length;
      for (const ev of downs) {
        expect(ev.weaponType).toBe("concussionTorpedo");
        expect(flavorCategory(ev)).toBe("missileIntercept");
        expect(
          simplifiedLogTokens(ev, (id) => id)
            .map((t) => t.text)
            .join(""),
        ).toContain("point defense shoots down");
        expect(
          visualBeatsForRound([ev], ev.round).some(
            (b) => b.intercepted === true,
          ),
        ).toBe(true);
      }
      lines += formatCombatLog(downs, (id) => id).filter((l) =>
        /point defense/.test(l),
      ).length;
      // With the intercept out, no torpedo is shot down.
      expect(fight(seed, 0).log.some((ev) => (ev.intercepted ?? 0) > 0)).toBe(
        false,
      );
    }
    expect(intercepted).toBeGreaterThan(0);
    expect(lines).toBe(intercepted);
  });
});

describe("WR-8b: ship events", () => {
  function run(tier: number, ramp = 1, oddsRamp?: number): Expedition {
    const res = dispatchPastPropulsion(
      asExpeditionVeteran(withCrew(onHull("orion"), "d18")),
      "ship-1",
      1,
      "cand-0",
    );
    expect(res.success, res.reason).toBe(true);
    const exp = res.expedition!;
    return {
      ...exp,
      difficulty: {
        version: 1,
        firstRun: false,
        ramp,
        tier: tier as 1,
        ...(oddsRamp === undefined ? {} : { oddsRamp }),
      },
    };
  }

  it("the chance by tier, x the Tier I odds ramp; none without the stamp or on the training run", () => {
    for (const t of [1, 2, 3, 4, 5, 6, 7] as const)
      expect(shipEventTorpedoPermille(run(t)), `tier ${t}`).toBe(
        SHIP_EVENT_TORPEDO_PERMILLE_BY_TIER[t],
      );
    expect(shipEventTorpedoPermille(run(1, 0.5, 0))).toBe(0);
    expect(shipEventTorpedoPermille(run(1, 0.5, 0.5))).toBe(
      Math.round(SHIP_EVENT_TORPEDO_PERMILLE_BY_TIER[1] * 0.5),
    );
    const training = {
      ...run(1),
      difficulty: {
        version: 1 as const,
        firstRun: true,
        ramp: 0,
        tier: 1 as const,
      },
    };
    expect(shipEventTorpedoPermille(training)).toBe(0);
    const before = withEnemyTorpedoesOff(() =>
      dispatchPastPropulsion(
        asExpeditionVeteran(withCrew(onHull("orion"), "d18")),
        "ship-1",
        1,
        "cand-0",
      ),
    ).expedition!;
    expect(
      before.groundOps?.shipEventProfile?.battle?.combatRules?.enemyTorpedoes,
    ).toBeUndefined();
    expect(
      shipEventTorpedoPermille({
        ...before,
        difficulty: { version: 1, firstRun: false, ramp: 1, tier: 7 },
      }),
    ).toBe(0);
  });

  it("the vessel carries the torpedo at about its chance, the same on every call, after its own guns", () => {
    const exp = run(7);
    let n = 0;
    for (let b = 0; b < 4; b++) {
      for (let step = 0; step < 250; step++) {
        const carries = shipEventCarriesTorpedo(exp, b, step);
        expect(shipEventCarriesTorpedo(exp, b, step)).toBe(carries);
        const e = shipEventEnemy(
          exp,
          exp.bodies[0],
          b,
          step,
          CLOAKED_VESSEL_HULL,
        );
        expect(e.weapons.map((w) => w.weaponType)).toEqual(
          carries
            ? ["autocannon", "railgun", "concussionTorpedo"]
            : ["autocannon", "railgun"],
        );
        n += carries ? 1 : 0;
      }
    }
    expect(n / 1000).toBeGreaterThan(0.6);
    expect(n / 1000).toBeLessThan(0.7);
    expect(
      torpedoes(
        shipEventEnemy(run(1, 1, 0), exp.bodies[0], 0, 0, HOSTILE_PROBE_HULL)
          .weapons,
      ),
    ).toBe(0);
  });

  it("one call == 997 s chunks == 1 s steps on a Tier VII stamped run", () => {
    const exp = run(7);
    const end = 2_000_000;
    const one = advanceExpedition(exp, end);
    let chunks = exp;
    for (let t = exp.phaseAnchorSeconds + 997; t < 200_000; t += 997)
      chunks = advanceExpedition(chunks, t);
    expect(advanceExpedition(chunks, end)).toEqual(one);
    const from = one.groundOps?.startedAt ?? exp.phaseAnchorSeconds;
    let ones = advanceExpedition(exp, from);
    for (let t = from + 1; t <= from + 6_000; t += 1)
      ones = advanceExpedition(ones, t);
    expect(ones).toEqual(advanceExpedition(exp, from + 6_000));
    expect(advanceExpedition(ones, end)).toEqual(one);
  });
});

describe("WR-8b: the player-facing text", () => {
  it("the patrol card names who carries torpedoes on a patrol sent now", () => {
    const fresh = onHull("carrier");
    expect(patrolTorpedoLine(fresh, PATROLS.crimsonReaverWarband)).toBeNull(); // the training patrol fields none
    const vet = patrolTorpedoLine(
      asPatrolVeteran(fresh),
      PATROLS.crimsonReaverWarband,
    )!;
    expect(vet).toContain("Every Corsair Carrier carries a Concussion Torpedo");
    expect(vet).toContain(
      `a Marauder carries one ${MARAUDER_TORPEDO_PERMILLE / 10}% of the time`,
    );
    // The card names the condition Help names: the Defensive stance AND a working interceptor (display names).
    expect(vet).toContain(
      "only in the Defensive stance, with a working Point-Defense Array or EMP Cannon",
    );
    expect(
      patrolTorpedoLine(onPatrolCurve(fresh, 0), PATROLS.crimsonReaverSweep),
    ).toContain("No Marauder carries one yet");
  });

  it("Help tells the truth in both topics, with no em dash", () => {
    expect(PATROL_TORPEDO_HELP).toContain(
      `${DEFENSIVE_STANCE.missileInterceptPct}%`,
    );
    expect(PATROL_TORPEDO_HELP).toContain("first 2 patrols after it");
    // The smoothed top (WR-8b fix round): the last ramped step, then full one patrol after the enemy curve's top.
    expect(PATROL_TORPEDO_HELP).toContain("35.8% after 10");
    expect(PATROL_TORPEDO_HELP).toContain("40% from 11 completed patrols on");
    expect(PATROL_TORPEDO_HELP).toContain(
      "a working Point-Defense Array or EMP Cannon",
    );
    expect(PATROL_TORPEDO_HELP).not.toContain("Point Defense Array");
    expect(SHIP_EVENT_TORPEDO_HELP).toContain(
      "cannot shoot these torpedoes down",
    );
    expect(SHIP_EVENT_TORPEDO_HELP).toContain(
      `${SHIP_EVENT_TORPEDO_PERMILLE_BY_TIER[7] / 10}% at Tier VII`,
    );
    const patrols = HELP_TOPICS.find((t) => t.id === "patrols")!.body;
    const scan = HELP_TOPICS.find((t) => t.id === "scanEvents")!.body;
    expect(patrols).toContain(PATROL_TORPEDO_HELP);
    expect(scan).toContain(SHIP_EVENT_TORPEDO_HELP);
    for (const text of [PATROL_TORPEDO_HELP, SHIP_EVENT_TORPEDO_HELP]) {
      expect(text).not.toMatch(/—|--/);
      expect(text).not.toMatch(/\bfit/);
    }
  });
});
