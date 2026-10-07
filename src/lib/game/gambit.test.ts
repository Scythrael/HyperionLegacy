// Exploration 0.14.0 (Phase E3a) tests: the away-team GAMBIT combat engine.
//
// Covers, mirroring the expedition.test.ts / salvage.test.ts styles:
//   - RULE EVALUATION: first-match top-down; role-legal action enforcement (validate + resolver skip).
//   - TARGET SELECTORS: highest/lowest HP, highest threat, is-Healer, has-status, ally HP<threshold, has-status.
//   - STATUS system: apply + tick (DoT + duration decay) + cleanse (specific + all-debuffs).
//   - ENEMY ROLES: healer heals a wounded ally; caster afflicts on hit.
//   - FULL BATTLE: a smart (kill-the-healer) program WINS; a lazy (attack-nearest) program does WORSE
//     on the same seeds (proves gambit depth is load-bearing).
//   - EVACUATE->RETRY: an unwinnable activity loses every attempt, evacuates, still yields a partial finding.
//   - REWARDS: the relic roll REUSES the salvage tiers + yields an UNIDENTIFIED relic at a chance; a
//     non-relic PoI never yields one (E4a: the relic-bearing set is DERIVED from relics.ts).
//   - PARITY: a typed multi-body expedition whose activities resolve REAL gambit fights is byte-identical
//     big-jump vs stepped.
//   - SAVE migration v61 -> v62 seeds the default gambit program pair + backfills the expedition snapshot.

import { describe, it, expect } from "vitest";
import {
  freshState,
  DEFAULT_GAMBIT_PROGRAMS,
  SALVAGE_LOOT_POOLS,
  type Expedition,
  type GambitPrograms,
  type GambitProgram,
  type SnapshotMember,
} from "./model";
import {
  resolveTarget,
  applyStatus,
  hasStatus,
  clearDebuffs,
  tickEndOfRound,
  evaluateAndAct,
  isActionLegalForRole,
  validateGambitProgram,
  resolveGroundBattle,
  buildRosterCombatants,
  generateEncounter,
  deriveAwayTeam,
  resolveExpeditionActivity,
  rollRelicToken,
  GAMBIT_PRESETS,
  GAMBIT_STATUSES,
  ENEMY_ROLE_PROGRAMS,
  RELIC_BEARING_POIS,
  MAX_BATTLE_ATTEMPTS,
  type GroundCombatant,
  type BattleState,
} from "./gambit";
import { advanceExpedition, makeExpeditionSeed } from "./expedition";
import { planetTypeHazard, POI_CATALOG } from "./expeditionContent";
import { RELIC_SETS, relicSetForPoi } from "./relics";
import { migrate, type SaveFile } from "./save";
import { makeRng } from "./combat/rng";

// --- fixtures ----------------------------------------------------------------

function mk(id: string, side: "team" | "enemy", role: GroundCombatant["role"], over: Partial<GroundCombatant> = {}): GroundCombatant {
  return {
    id,
    side,
    role,
    hp: 50,
    hpMax: 50,
    power: 10,
    accuracy: 1,
    armor: 0,
    heal: 0,
    threat: 10,
    groupTag: role,
    statuses: [],
    downed: false,
    ...over,
  };
}

function bs(combatants: GroundCombatant[], over: Partial<BattleState> = {}): BattleState {
  return { combatants, round: 0, teamKit: 0, tauntedBy: null, ...over };
}

// A minimal expedition carrying an away-team snapshot + a scanned body with activities, for the resolver
// + parity tests. Defaults to a neutral team; callers override strengths / programs / bodies.
function makeExp(over: Partial<Expedition> = {}): Expedition {
  return {
    id: "expedition-1",
    shipId: "ship-1",
    captainId: 1,
    targetSystemId: "keplersReach",
    systemName: "Kepler's Reach",
    sensorArrayId: null,
    scanParams: { scanRateMult: 1, coverageWidth: 1, landmarkOddsBias: 0, undergroundPoiOddsBias: 0 },
    sensorPower: 0,
    phase: "transit",
    phaseAnchorSeconds: 0,
    shakedown: true,
    bodies: [
      { id: "body-1", planetType: "terrestrial", scanTotal: 100, scanProgress: 0, hazard: planetTypeHazard("terrestrial"), scanned: false, discoveries: [], activities: [] },
    ],
    anomalyResolved: false,
    anomalyCharted: false,
    anomalyOptIn: true,
    findings: [],
    seed: 12345,
    securityStrength: 0,
    scienceStrength: 0,
    teamKit: 2,
    gambitPrograms: cloneProgs(DEFAULT_GAMBIT_PROGRAMS),
    // E4b museum snapshot: neutral (an empty museum), so every pre-E4b assertion is unchanged.
    scanSpeedBonus: 0,
    relicFindBonus: 0,
    hazardResist: 0,
    ...over,
  };
}

// D18: a plain snapshotted Security member (rank 1, no traits or gear). Since the anonymous crew-derived
// detail is gone, every battle fixture here fields named members built from these.
function secSnap(memberId: string, over: Partial<SnapshotMember> = {}): SnapshotMember {
  return {
    memberId,
    teamType: "security",
    spec: "offense",
    rank: 1,
    rankFactor: 1,
    traits: [],
    groundStats: { hp: 0, power: 0, armor: 0, accuracy: 0, statusChance: 0, fieldwork: 0, relicFind: 0, hazardResist: 0 },
    resists: {},
    implants: [],
    gear: [],
    gambit: DEFAULT_GAMBIT_PROGRAMS.security.map((r) => ({ ...r })),
    effects: [],
    ...over,
  };
}

// A roster of `n` plain Security members (member-1..n), each running `program`, and no Science.
function secRoster(n: number, program?: GambitProgram): Expedition["roster"] {
  const security = Array.from({ length: n }, (_, i) =>
    secSnap(`member-${i + 1}`, program ? { gambit: program.map((r) => ({ ...r })) } : {}),
  );
  return { security, science: [] };
}

function cloneProgs(p: GambitPrograms): GambitPrograms {
  const cr = (r: any) => ({ ...r, params: r.params ? { ...r.params } : undefined });
  return { security: p.security.map(cr), science: p.science.map(cr) };
}

// ============================================================================
describe("rule evaluation — first-match top-down + role-legal enforcement", () => {
  it("fires the FIRST rule whose action is legal and whose target resolves", () => {
    // E-CREW Task 13 rewrite (the Science actor + secureObjective it used are gone: Science never fights and
    // the objective track was removed). A Security actor with an illegal Science-only action first, then a
    // legal attack. The illegal rule is SKIPPED and the attack lands (role-legal enforcement + first-match
    // fall-through).
    const sec = mk("t-sec-0", "team", "security", { accuracy: 1 });
    const foe = mk("enemy-bruiser-1", "enemy", "bruiser");
    const state = bs([sec, foe]);
    const program: GambitProgram = [
      { target: "foeNearest", action: "analyze" }, // ILLEGAL for Security -> skipped
      { target: "foeNearest", action: "attack" }, // legal -> fires
    ];
    evaluateAndAct(program, sec, state, makeRngLike());
    expect(hasStatus(foe, "corroded")).toBe(false); // the illegal analyze never fired
    expect(foe.hp).toBeLessThan(foe.hpMax); // the attack landed
  });

  // D19 FIX: the selector is the CONDITION for targetless actions too. "selfHpBelow -> brace" used to brace
  // every round at full HP (the targetless action ignored its selector); now it waits for the condition.
  it("a targetless action fires only when its selector resolves (brace when hurt means when hurt)", () => {
    const program: GambitProgram = [
      { target: "selfHpBelow", params: { hpThreshold: 0.5 }, action: "brace" },
      { target: "foeNearest", action: "attack" },
    ];
    const healthy = mk("t-sec-0", "team", "security", { accuracy: 1 });
    const foeA = mk("enemy-bruiser-1", "enemy", "bruiser");
    evaluateAndAct(program, healthy, bs([healthy, foeA]), makeRngLike());
    expect(hasStatus(healthy, "shielded")).toBe(false); // full HP: no brace
    expect(foeA.hp).toBeLessThan(foeA.hpMax); // the attack fired instead

    const hurt = mk("t-sec-0", "team", "security", { accuracy: 1, hp: 10 });
    const foeB = mk("enemy-bruiser-1", "enemy", "bruiser");
    evaluateAndAct(program, hurt, bs([hurt, foeB]), makeRngLike());
    expect(hasStatus(hurt, "shielded")).toBe(true); // below half: braces
    expect(foeB.hp).toBe(foeB.hpMax);

    // "self" always resolves for a standing actor, so a plain self-brace is unchanged.
    const plain = mk("t-sec-0", "team", "security");
    evaluateAndAct([{ target: "self", action: "brace" }], plain, bs([plain, mk("enemy-bruiser-1", "enemy", "bruiser")]), makeRngLike());
    expect(hasStatus(plain, "shielded")).toBe(true);
  });

  it("isActionLegalForRole gates team roles but not enemy roles", () => {
    expect(isActionLegalForRole("science", "attack")).toBe(false);
    expect(isActionLegalForRole("science", "cure")).toBe(true);
    // E-CREW Task 13: a Security program MAY contain the medic actions (they fire only for a medic member).
    expect(isActionLegalForRole("security", "cure")).toBe(true);
    expect(isActionLegalForRole("security", "aidHeal")).toBe(true);
    expect(isActionLegalForRole("security", "analyze")).toBe(false);
    expect(isActionLegalForRole("security", "attack")).toBe(true);
    // Enemy roles run controlled internal programs, so every action is legal for them.
    expect(isActionLegalForRole("healer", "attack")).toBe(true);
    expect(isActionLegalForRole("caster", "aidHeal")).toBe(true);
  });

  it("validateGambitProgram flags illegal rules by index", () => {
    const sciIssues = validateGambitProgram("science", [
      { target: "self", action: "secureObjective" },
      { target: "foeNearest", action: "attack" }, // illegal
    ]);
    expect(sciIssues).toEqual([{ index: 1, action: "attack", reason: "illegalActionForRole" }]);
    // E-CREW Task 13: cure is no longer an issue in a Security program (medic-gated at runtime);
    // Science-only actions still are.
    const secIssues = validateGambitProgram("security", [
      { target: "allyLowestHp", action: "cure" },
      { target: "self", action: "secureObjective" },
    ]);
    expect(secIssues.map((i) => i.index)).toEqual([1]);
    // The Balanced default pair is fully legal.
    expect(validateGambitProgram("security", DEFAULT_GAMBIT_PROGRAMS.security)).toEqual([]);
    expect(validateGambitProgram("science", DEFAULT_GAMBIT_PROGRAMS.science)).toEqual([]);
  });
});

// ============================================================================
describe("target selectors — pick the right combatant", () => {
  const actor = mk("t-sec-0", "team", "security");

  it("foeHighestHp / foeLowestHp pick the HP extremes (tie -> lowest id)", () => {
    const foes = [
      mk("enemy-a", "enemy", "bruiser", { hp: 30 }),
      mk("enemy-b", "enemy", "bruiser", { hp: 70 }),
      mk("enemy-c", "enemy", "bruiser", { hp: 50 }),
    ];
    const state = bs([actor, ...foes]);
    expect(resolveTarget("foeHighestHp", undefined, actor, state)!.id).toBe("enemy-b");
    expect(resolveTarget("foeLowestHp", undefined, actor, state)!.id).toBe("enemy-a");
  });

  it("foeHighestThreat picks the biggest threat", () => {
    const foes = [
      mk("enemy-a", "enemy", "striker", { threat: 5 }),
      mk("enemy-b", "enemy", "striker", { threat: 22 }),
      mk("enemy-c", "enemy", "striker", { threat: 10 }),
    ];
    expect(resolveTarget("foeHighestThreat", undefined, actor, bs([actor, ...foes]))!.id).toBe("enemy-b");
  });

  it("foeIsHealer picks the enemy healer/support", () => {
    const foes = [mk("enemy-b1", "enemy", "bruiser"), mk("enemy-h1", "enemy", "healer")];
    expect(resolveTarget("foeIsHealer", undefined, actor, bs([actor, ...foes]))!.id).toBe("enemy-h1");
    // No healer present -> null (the rule would not fire, falling through to the next).
    expect(resolveTarget("foeIsHealer", undefined, actor, bs([actor, mk("enemy-b1", "enemy", "bruiser")]))).toBeNull();
  });

  it("foeHasStatus picks a foe carrying the named status", () => {
    const poisoned = mk("enemy-a", "enemy", "bruiser");
    applyStatus(poisoned, "poison");
    const clean = mk("enemy-b", "enemy", "bruiser");
    const state = bs([actor, clean, poisoned]);
    expect(resolveTarget("foeHasStatus", { statusId: "poison" }, actor, state)!.id).toBe("enemy-a");
    expect(resolveTarget("foeHasStatus", { statusId: "bleed" }, actor, state)).toBeNull();
  });

  it("allyHpBelow picks the most-wounded ally under the threshold; none -> null", () => {
    const sci = mk("t-sci-0", "team", "science");
    const wounded = mk("t-sec-1", "team", "security", { hp: 40, hpMax: 100 }); // 40% < 50%
    const healthy = mk("t-sec-2", "team", "security", { hp: 90, hpMax: 100 });
    const state = bs([sci, wounded, healthy]);
    expect(resolveTarget("allyHpBelow", { hpThreshold: 0.5 }, sci, state)!.id).toBe("t-sec-1");
    // A high enough threshold with everyone topped -> null.
    const topped = bs([sci, mk("t-sec-1", "team", "security", { hp: 100, hpMax: 100 })]);
    expect(resolveTarget("allyHpBelow", { hpThreshold: 0.3 }, sci, topped)).toBeNull();
  });

  it("allyHasStatus (no id) picks an ally with any debuff, ignoring buff-only allies", () => {
    const sci = mk("t-sci-0", "team", "science");
    const buffed = mk("t-sec-1", "team", "security");
    applyStatus(buffed, "shielded"); // a BUFF, not a debuff
    const debuffed = mk("t-sec-2", "team", "security", { hp: 20, hpMax: 100 });
    applyStatus(debuffed, "poison");
    const state = bs([sci, buffed, debuffed]);
    expect(resolveTarget("allyHasStatus", undefined, sci, state)!.id).toBe("t-sec-2");
  });
});

// ============================================================================
describe("status system — apply, tick (DoT + decay), cleanse", () => {
  it("applies a status, ticks its DoT + decrements duration, and expires it", () => {
    const c = mk("t-sec-0", "team", "security", { hp: 100, hpMax: 100 });
    applyStatus(c, "poison"); // magnitude 5, duration 4
    expect(hasStatus(c, "poison")).toBe(true);
    const state = bs([c]);
    tickEndOfRound(state);
    expect(c.hp).toBe(100 - GAMBIT_STATUSES.poison.magnitude); // one DoT tick
    // After the full duration of ticks, the status is gone.
    for (let i = 0; i < GAMBIT_STATUSES.poison.duration; i++) tickEndOfRound(state);
    expect(hasStatus(c, "poison")).toBe(false);
  });

  it("cure clears a specific debuff, or all debuffs, but never a buff", () => {
    const c = mk("t-sec-0", "team", "security");
    applyStatus(c, "poison");
    applyStatus(c, "weakened");
    applyStatus(c, "shielded"); // a buff, must survive a cleanse
    // Clear only poison:
    expect(clearDebuffs(c, "poison")).toBe(true);
    expect(hasStatus(c, "poison")).toBe(false);
    expect(hasStatus(c, "weakened")).toBe(true);
    // Clear ALL debuffs (keeps the buff):
    expect(clearDebuffs(c)).toBe(true);
    expect(hasStatus(c, "weakened")).toBe(false);
    expect(hasStatus(c, "shielded")).toBe(true);
    // Nothing left to cleanse -> returns false (so a gambit rule would not fire).
    expect(clearDebuffs(c)).toBe(false);
  });
});

// ============================================================================
describe("enemy role behaviors", () => {
  it("a Healer heals a wounded enemy ally instead of attacking", () => {
    const healer = mk("enemy-healer-1", "enemy", "healer", { heal: 16 });
    const woundedAlly = mk("enemy-bruiser-1", "enemy", "bruiser", { hp: 20, hpMax: 100 });
    const teamFoe = mk("t-sec-0", "team", "security");
    const state = bs([healer, woundedAlly, teamFoe]);
    evaluateAndAct(ENEMY_ROLE_PROGRAMS.healer, healer, state, makeRngLike());
    expect(woundedAlly.hp).toBe(36); // 20 + 16 heal, foe untouched
    expect(teamFoe.hp).toBe(teamFoe.hpMax);
  });

  it("a Caster applies its affliction on a landed attack", () => {
    const caster = mk("enemy-caster-1", "enemy", "caster", { accuracy: 1, statusOnHit: { id: "poison", permille: 1000 } });
    const foe = mk("t-sec-0", "team", "security", { hp: 60, hpMax: 60, armor: 0 });
    const state = bs([caster, foe]);
    evaluateAndAct(ENEMY_ROLE_PROGRAMS.caster, caster, state, makeRng(7));
    expect(foe.hp).toBeLessThan(60); // the attack landed
    expect(hasStatus(foe, "poison")).toBe(true); // and afflicted (permille 1000 + accuracy 1 => certain)
  });
});

// ============================================================================
describe("full battle — gambit depth is load-bearing", () => {
  // A mid-strength team vs a healer-guarded Buried Vault. A SMART program (kill the healer) should win
  // far more often than a LAZY one (attack nearest, which chews on a bruiser the healer keeps topped).
  // E-CREW Task 13, DELIBERATE FIXTURE CHANGE: securityStrength 10 -> 18. The anonymous detail is now
  // Security only (it used to add a healing Science body), so the old strength-10 pair (2 Security bodies)
  // could no longer win this hazard-0.65 Vault on any seed. 18 fields the 4-body detail, where the smart
  // program wins 28 of 60 and the lazy one 0, the same contrast the test exists to prove.
  // D18 DELIBERATE FIXTURE CHANGE: the anonymous detail (buildTeamCombatants) is deleted, so the same four
  // bodies are now four plain NAMED Security members sharing the same strength 18 crew layer, each running
  // the program under test as its own.
  const snapshot = { securityStrength: 18, scienceStrength: 5, teamKit: 3 };
  const team = (programs: GambitPrograms, prefix: string) =>
    buildRosterCombatants(secRoster(4, programs.security)!.security, snapshot.securityStrength, prefix);
  const smart: GambitPrograms = {
    security: [
      { target: "foeIsHealer", action: "attack" },
      { target: "foeHighestThreat", action: "attack" },
      { target: "foeNearest", action: "attack" },
    ],
    science: cloneProgs(DEFAULT_GAMBIT_PROGRAMS).science,
  };
  const lazy: GambitPrograms = {
    security: [{ target: "foeNearest", action: "attack" }],
    science: cloneProgs(DEFAULT_GAMBIT_PROGRAMS).science, // identical science: only the targeting differs
  };
  // A hazardous Vault: the healer's heal outpaces the lazy team's DPS on a single bruiser, so lazy dies
  // by attrition while smart decapitates the healer and mops up. This is the whole point of the test.
  const HAZARD = 0.65;
  const N = 60;

  function winCount(programs: GambitPrograms): number {
    let wins = 0;
    for (let s = 0; s < N; s++) {
      const seed = (0x1234 ^ (s * 0x9e3779b9)) >>> 0;
      const enemies = generateEncounter(seed, HAZARD, "buriedVault");
      if (resolveGroundBattle(team(programs, `b${s}`), enemies, snapshot.teamKit, makeRng(seed)).result === "win") wins++;
    }
    return wins;
  }

  it("a smart (kill-the-healer) program wins, and wins MORE than a lazy attack-nearest program", () => {
    const smartWins = winCount(smart);
    const lazyWins = winCount(lazy);
    expect(smartWins).toBeGreaterThan(0); // the kill-the-healer path is a real WIN
    expect(smartWins).toBeGreaterThan(lazyWins); // depth matters: the same seeds, better targeting, more wins
  });

  it("is deterministic: the same team + enemies + seed replays byte-identically", () => {
    const seed = 0xabcdef;
    const a = resolveGroundBattle(team(smart, "x"), generateEncounter(seed, HAZARD, "buriedVault"), snapshot.teamKit, makeRng(seed));
    const b = resolveGroundBattle(team(smart, "x"), generateEncounter(seed, HAZARD, "buriedVault"), snapshot.teamKit, makeRng(seed));
    expect(a).toEqual(b);
  });
});

// ============================================================================
describe("resolveExpeditionActivity — win yields real findings; a lost task evacuates + retries", () => {
  it("a strong team WINS an easy task and yields a real material + credit finding", () => {
    // D18 DELIBERATE FIXTURE CHANGE: a named Security squad (the anonymous detail is gone).
    const exp = makeExp({ securityStrength: 40, scienceStrength: 20, teamKit: 6, roster: secRoster(3) });
    const body = exp.bodies[0]; // terrestrial, low hazard
    const activity = { id: "expedition-1-body-1-act-0", bodyId: "body-1", poiId: "caveNetwork", done: false };
    const res = resolveExpeditionActivity(exp, body, activity, 0);
    expect(res.outcome).toBe("win");
    expect(res.finding.source).toBe("activity");
    expect(res.finding.poiId).toBe("caveNetwork");
    expect(Object.keys(res.finding.materials ?? {}).length).toBeGreaterThan(0);
    expect(res.finding.credits ?? 0).toBeGreaterThan(0);
    // E4a INTENTIONAL CHANGE: caveNetwork now SOURCES the Deep Earth relic set (relics.ts RELIC_SET_BY_POI),
    // so it is relic-bearing and a win MAY carry a relic (it used to be asserted null here). Whatever
    // rolled, it is an UNIDENTIFIED token, and claiming it routes to Deep Earth.
    expect(relicSetForPoi("caveNetwork")).toBe("deepEarth");
    if (res.finding.relic) expect(res.finding.relic.unidentified).toBe(true);
    expect(res.finding.evacuated).toBeUndefined();
  });

  it("a bare team LOSES a brutal task on every attempt, EVACUATES, and still keeps a partial haul", () => {
    // A 0-strength team vs a very-high-hazard Subterranean Civilization (healer + caster + bruiser + striker).
    // D18 DELIBERATE FIXTURE CHANGE: one plain named member (the anonymous detail is gone); with NO member
    // at all the task would evacuate without fighting (0 attempts), which awayRoster.test.ts covers.
    const exp = makeExp({
      securityStrength: 0,
      scienceStrength: 0,
      teamKit: 0,
      roster: secRoster(1),
      bodies: [{ id: "body-1", planetType: "toxic", scanTotal: 100, scanProgress: 0, hazard: planetTypeHazard("toxic"), scanned: false, discoveries: [], activities: [] }],
    });
    const body = exp.bodies[0];
    const activity = { id: "expedition-1-body-1-act-0", bodyId: "body-1", poiId: "subterraneanCivilization", done: false };
    const res = resolveExpeditionActivity(exp, body, activity, 0);
    expect(res.outcome).toBe("evacuated");
    expect(res.attempts).toBe(MAX_BATTLE_ATTEMPTS); // it retried the full cap before evacuating
    expect(res.finding.evacuated).toBe(true);
    expect(res.finding.relic ?? null).toBeNull(); // no relic on an evacuation
    expect(Object.keys(res.finding.materials ?? {}).length).toBeGreaterThan(0); // always win SOMETHING
  });

  it("is deterministic: the same expedition + activity + index resolves identically", () => {
    const exp = makeExp({ securityStrength: 12, scienceStrength: 6, roster: secRoster(2) });
    const activity = { id: "expedition-1-body-1-act-0", bodyId: "body-1", poiId: "crashedShip", done: false };
    const a = resolveExpeditionActivity(exp, exp.bodies[0], activity, 2);
    const b = resolveExpeditionActivity(exp, exp.bodies[0], activity, 2);
    expect(a).toEqual(b);
  });
});

// ============================================================================
describe("rewards — the relic roll REUSES the salvage tiers", () => {
  const poolTiers = SALVAGE_LOOT_POOLS.intactReactorCore;

  // E4a INTENTIONAL CHANGE: this used "mineralOutcrop" as the non-bearing PoI. The approved Relic Museum
  // mockup makes mineralOutcrop a Deep Earth SOURCE, and in fact every catalog PoI now sources some set,
  // so the only non-bearing PoI left is an id outside the catalog (a tampered / unknown id).
  it("a non-relic-bearing (unknown) PoI never yields a relic token", () => {
    for (let s = 0; s < 200; s++) {
      expect(rollRelicToken(s, 0.9, "notARealPoi", `relic-${s}`)).toBeNull();
    }
  });

  it("E4a: the newly relic-bearing PoIs (Xenobiology + Deep Earth sources) now yield relics at a chance", () => {
    for (const poi of ["xenoFloraBloom", "mineralOutcrop", "caveNetwork", "geothermalChamber", "derelictOutpost"]) {
      let hits = 0;
      for (let s = 0; s < 200; s++) if (rollRelicToken(s, 0.6, poi, `relic-${s}`)) hits++;
      expect(hits).toBeGreaterThan(0);
      expect(hits).toBeLessThan(200);
    }
  });

  it("a relic-bearing PoI yields UNIDENTIFIED relics at a chance, with a salvage-tier rarity + quality", () => {
    let hits = 0;
    for (let s = 0; s < 300; s++) {
      const relic = rollRelicToken(s, 0.8, "buriedVault", `relic-${s}`);
      if (!relic) continue;
      hits++;
      expect(relic.unidentified).toBe(true);
      // The tier + quality come straight from the reused salvage tier ladder.
      const tier = poolTiers.find((t) => t.tier === relic.tier);
      expect(tier).toBeDefined();
      expect(relic.quality).toBe(tier!.quality);
    }
    expect(hits).toBeGreaterThan(0); // relics DO drop sometimes
    expect(hits).toBeLessThan(300); // ...but not always (it is a chance)
  });

  // E4a INTENTIONAL CHANGE: the gambit relic-bearing set is no longer the hand-kept E3a four; it is DERIVED
  // from relics.ts RELIC_SET_BY_POI (the union of every relic set's sources), the single source of truth
  // the E2c foreknowledge signature reads too. That union is the whole 9-PoI catalog.
  it("the gambit relic-bearing set is exactly the union of the relic sets' sources (all 9 PoIs)", () => {
    const union = RELIC_SETS.flatMap((set) => [...set.sources]).sort();
    expect([...RELIC_BEARING_POIS].sort()).toEqual(union);
    expect(union).toEqual(POI_CATALOG.map((p) => p.id).sort());
  });
});

// ============================================================================
describe("presets + crew derivation", () => {
  it("ships exactly the 6 locked preset titles, with Balanced == the default pair", () => {
    expect(GAMBIT_PRESETS.map((p) => p.title)).toEqual([
      "Establish Dominance",
      "Decapitate",
      "Turtle Club President",
      "Triage",
      "Balanced",
      "Custom",
    ]);
    const balanced = GAMBIT_PRESETS.find((p) => p.title === "Balanced")!;
    expect(balanced.programs).toEqual(DEFAULT_GAMBIT_PROGRAMS);
    // Custom is an empty starter.
    const custom = GAMBIT_PRESETS.find((p) => p.title === "Custom")!;
    expect(custom.programs).toEqual({ security: [], science: [] });
    // The presets are genuinely distinct (their program pairs are not all identical).
    const serialized = new Set(GAMBIT_PRESETS.map((p) => JSON.stringify(p.programs)));
    expect(serialized.size).toBe(GAMBIT_PRESETS.length);
  });

  it("deriveAwayTeam reads crew: a bare ship is 0/0 + base kit; Security/Science crew raise the strengths", () => {
    const bare = freshState();
    const bareTeam = deriveAwayTeam(bare, bare.ships[0]);
    expect(bareTeam.securityStrength).toBe(0);
    expect(bareTeam.scienceStrength).toBe(0);
    expect(bareTeam.teamKit).toBeGreaterThan(0); // a base kit even with no crew

    // Give the ship a Security + Science complement.
    const s = { ...bare };
    s.ships = bare.ships.map((sh, i) =>
      i === 0
        ? {
            ...sh,
            complement: {
              mode: "passive" as const,
              buckets: [
                { profession: "security" as const, rarity: "standard" as const, rank: 3 as const, race: "earthBorn" as const, buff1Id: "x", buff2Id: null, count: 5 },
                { profession: "science" as const, rarity: "standard" as const, rank: 3 as const, race: "earthBorn" as const, buff1Id: "x", buff2Id: null, count: 3 },
              ],
            },
          }
        : sh,
    );
    const crewedTeam = deriveAwayTeam(s, s.ships[0]);
    expect(crewedTeam.securityStrength).toBeGreaterThan(0);
    expect(crewedTeam.scienceStrength).toBeGreaterThan(0);
    expect(crewedTeam.securityStrength).toBeGreaterThan(crewedTeam.scienceStrength); // more security crew
  });
});

// ============================================================================
describe("PARITY — a typed expedition whose activities resolve REAL gambit fights", () => {
  const make = () =>
    makeExp({
      phase: "transit",
      shakedown: true,
      seed: makeExpeditionSeed(0x2545f491, 9),
      securityStrength: 14,
      scienceStrength: 7,
      teamKit: 4,
      roster: secRoster(3), // D18: a named squad fights (there is no anonymous detail any more)
      bodies: [
        { id: "body-1", planetType: "arid", scanTotal: 110, scanProgress: 0, hazard: planetTypeHazard("arid"), scanned: false, discoveries: [], activities: [] },
        { id: "body-2", planetType: "frozen", scanTotal: 90, scanProgress: 0, hazard: planetTypeHazard("frozen"), scanned: false, discoveries: [], activities: [] },
      ],
    });

  it("one big jump equals stepped, and the findings carry real reward payloads", () => {
    const big = advanceExpedition(make(), 300_000);
    let stepped = make();
    for (let t = 100; t <= 300_000; t += 100) stepped = advanceExpedition(stepped, t);
    expect(stepped).toEqual(big);
    expect(big.phase).toBe("complete");
    // Non-trivial: activities resolved into REAL findings (materials present on the activity findings).
    const activityFindings = big.findings.filter((f) => f.source === "activity");
    expect(activityFindings.length).toBeGreaterThan(0);
    for (const f of activityFindings) {
      expect(f.poiId).toBeDefined();
      expect(Object.keys(f.materials ?? {}).length).toBeGreaterThan(0);
      expect(typeof f.credits).toBe("number");
    }
  });
});

// ============================================================================
describe("SAVE migration v61 -> v62 seeds the gambit programs + backfills the expedition snapshot", () => {
  it("seeds account-level gambitPrograms from the default pair", () => {
    const s: any = freshState();
    delete s.gambitPrograms;
    const save: SaveFile = { version: 61, created_at: 0, last_saved_at: 0, game_time_seconds: 0, state: s } as any;
    const migrated: any = migrate(save);
    expect(migrated.gambitPrograms).toEqual(DEFAULT_GAMBIT_PROGRAMS);
  });

  it("backfills the away-team snapshot onto an in-flight expedition that predates the fields", () => {
    const s: any = freshState();
    delete s.gambitPrograms;
    const exp: any = {
      id: "expedition-1",
      shipId: "ship-1",
      captainId: 1,
      targetSystemId: "keplersReach",
      systemName: "Kepler's Reach",
      sensorArrayId: null,
      scanParams: { scanRateMult: 1, coverageWidth: 1, landmarkOddsBias: 0, undergroundPoiOddsBias: 0 },
      sensorPower: 0,
      phase: "scanning",
      phaseAnchorSeconds: 0,
      shakedown: true,
      bodies: [{ id: "body-1", planetType: "terrestrial", scanTotal: 100, scanProgress: 0, hazard: 0.1, scanned: false, discoveries: [], activities: [] }],
      anomalyResolved: true,
      anomalyCharted: false,
      anomalyOptIn: true,
      findings: [],
      seed: 12345,
    };
    // predates all E3a snapshot fields
    s.expeditions = [exp];
    s.nextExpeditionId = 2;
    const save: SaveFile = { version: 61, created_at: 0, last_saved_at: 0, game_time_seconds: 0, state: s } as any;
    const migrated: any = migrate(save);
    const me = migrated.expeditions[0];
    expect(me.securityStrength).toBe(0);
    expect(me.scienceStrength).toBe(0);
    expect(me.teamKit).toBe(0);
    expect(me.gambitPrograms).toEqual(DEFAULT_GAMBIT_PROGRAMS);
  });

  it("is a no-op for the account pair on a save that already has one", () => {
    const s: any = freshState(); // freshState already seeds gambitPrograms
    const custom = { security: [{ target: "foeNearest", action: "attack" }], science: [] };
    s.gambitPrograms = custom;
    const save: SaveFile = { version: 61, created_at: 0, last_saved_at: 0, game_time_seconds: 0, state: s } as any;
    const migrated: any = migrate(save);
    expect(migrated.gambitPrograms).toEqual(custom);
  });
});

// --- rng helper (mirror combat/rng usage in the other suites) ---------------
function makeRngLike() {
  return makeRng(1);
}
