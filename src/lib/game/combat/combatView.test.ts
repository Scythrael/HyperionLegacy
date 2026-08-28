// ============================================================================
// combat/combatView.test.ts: unit coverage for the pure combat-view helpers
// (Combat 0.13.0, Phase 12b Unit C). These pin the small logic decisions the
// combat view UI factors out of the Svelte component, so the display behavior is
// verifiable without a DOM.
// ============================================================================

import { describe, it, expect } from "vitest";
import {
  currentReplayWaveIndex,
  buildNameFor,
  rangeMarkerPercent,
  logLineClass,
  dronePips,
  logSpeedToMs,
  targetEnemyId,
  enemyWaveTally,
  weaponDisplayName,
  simplifiedLogLine,
  simplifiedLogTokens,
  visualBeatsForRound,
} from "./combatView";
import { BAND_LONG } from "./positioning";
import type { CombatEvent, Combatant } from "./types";
import type { SquadronStatusSummary } from "./drones";
import type { RoundSnapshot } from "./patrolReplay";

// A minimal CombatEvent factory: only the fields the helper reads matter; the
// rest stay at their optional defaults.
function ev(partial: Partial<CombatEvent>): CombatEvent {
  return { tDeciSec: 0, round: 0, type: "hit", ...partial };
}

describe("currentReplayWaveIndex", () => {
  it("returns null for an empty replay", () => {
    expect(currentReplayWaveIndex(0, 0)).toBe(null);
    expect(currentReplayWaveIndex(3, 0)).toBe(null);
  });
  it("shows the first (upcoming) wave before any wave resolves", () => {
    expect(currentReplayWaveIndex(0, 2)).toBe(0);
  });
  it("shows the most-recently-resolved wave once waves have resolved", () => {
    // nextWaveIndex 1 => wave 0 resolved, still transiting to wave 1 => show 0.
    expect(currentReplayWaveIndex(1, 2)).toBe(0);
    // nextWaveIndex 2 (both resolved / finished a 2-wave patrol) => show 1.
    expect(currentReplayWaveIndex(2, 2)).toBe(1);
  });
  it("clamps a nextWaveIndex past the replay's produced waves (early defeat)", () => {
    // The mission thinks it is on wave 3, but the replay only produced 2 waves
    // (a defeat ended it early): clamp to the last produced wave.
    expect(currentReplayWaveIndex(3, 2)).toBe(1);
  });
});

describe("buildNameFor", () => {
  const nameFor = buildNameFor(
    "ship-1",
    "Ravenscar",
    ["foe-a", "foe-b"],
    ["Raider", "Marauder"],
  );
  it("maps the player id to the player name", () => {
    expect(nameFor("ship-1")).toBe("Ravenscar");
  });
  it("maps each enemy id to its aligned hull label", () => {
    expect(nameFor("foe-a")).toBe("Raider");
    expect(nameFor("foe-b")).toBe("Marauder");
  });
  it("falls back to the raw id for an unknown combatant", () => {
    expect(nameFor("mystery")).toBe("mystery");
  });
  it("falls back to the id when a label is missing", () => {
    const nf = buildNameFor("p", "P", ["x", "y"], ["OnlyLabel"]);
    expect(nf("y")).toBe("y");
  });
});

describe("rangeMarkerPercent", () => {
  it("parks at 0 for zero or negative distance", () => {
    expect(rangeMarkerPercent(0)).toBe(0);
    expect(rangeMarkerPercent(-50)).toBe(0);
  });
  it("scales distance as a percentage of the long-band ceiling", () => {
    expect(rangeMarkerPercent(BAND_LONG)).toBe(100);
    expect(rangeMarkerPercent(Math.round(BAND_LONG / 2))).toBe(50);
  });
  it("clamps a distance beyond long range to 100", () => {
    expect(rangeMarkerPercent(BAND_LONG * 3)).toBe(100);
  });
});

describe("logLineClass", () => {
  it("classes a kill line as destroy (highest priority)", () => {
    expect(logLineClass(ev({ type: "destroyed", crit: true }))).toBe("destroy");
  });
  it("classes a crit hit as crit", () => {
    expect(logLineClass(ev({ type: "hit", crit: true }))).toBe("crit");
  });
  it("classes a DoT tick as dot", () => {
    expect(logLineClass(ev({ type: "dot" }))).toBe("dot");
  });
  it("classes a particle attenuation bleed as atten", () => {
    expect(logLineClass(ev({ type: "hit", attenuated: true }))).toBe("atten");
  });
  it("classes a clean miss as evade", () => {
    expect(logLineClass(ev({ type: "evade" }))).toBe("evade");
  });
  it("leaves a plain hit unclassed", () => {
    expect(logLineClass(ev({ type: "hit" }))).toBe("");
  });
});

describe("dronePips", () => {
  it("expands a REAL summary into one pip per drone, in status order (refab is not double-counted)", () => {
    // A genuine squadronStatusSummary shape: `alive` EXCLUDES refabricating drones (a
    // refabricating drone has alive=false in drones.ts), so alive = online + disrupted = 3,
    // NOT 4. With 2 online + 1 disrupted + 1 refabricating + 1 destroyed = 5 total, the
    // destroyed count must be 1. The old `total - alive` (5 - 3 = 2) would render a SECOND
    // offline pip for the refabricating drone (the double-count bug); the fix renders 5 pips.
    const summary: SquadronStatusSummary = {
      total: 5,
      alive: 3,
      online: 2,
      disrupted: 1,
      refabricating: 1,
    };
    const pips = dronePips(summary);
    expect(pips.map((p) => p.cls)).toEqual([
      "online",
      "online",
      "disrupted",
      "refab",
      "offline", // exactly ONE destroyed (5 - 2 online - 1 disrupted - 1 refab)
    ]);
  });
  it("returns no pips for an empty squadron", () => {
    expect(
      dronePips({ total: 0, alive: 0, online: 0, disrupted: 0, refabricating: 0 }),
    ).toEqual([]);
  });
  it("renders all-destroyed as offline pips", () => {
    const pips = dronePips({
      total: 3,
      alive: 0,
      online: 0,
      disrupted: 0,
      refabricating: 0,
    });
    expect(pips.map((p) => p.cls)).toEqual(["offline", "offline", "offline"]);
  });
});

describe("logSpeedToMs", () => {
  it("maps fast to the 1-second cadence (the default)", () => {
    expect(logSpeedToMs("fast")).toBe(1000);
  });
  it("maps slow to the 5-second cadence", () => {
    expect(logSpeedToMs("slow")).toBe(5000);
  });
});

// A minimal enemy Combatant: targetEnemyId / enemyWaveTally read only id + hull +
// shield (shield now counts toward effective HP), so the rest stays a cast rather
// than a full literal. shield defaults to 0 for the hull-only cases.
function enemy(id: string, hull: number, shield = 0): Combatant {
  return { id, hull, shield } as unknown as Combatant;
}
// A minimal RoundSnapshot carrying the per-enemy hulls the helpers read (shield 0).
function snapOf(hulls: Record<string, number>): RoundSnapshot {
  const combatants: RoundSnapshot["combatants"] = {};
  for (const [id, hull] of Object.entries(hulls)) {
    combatants[id] = { id, hull, shield: 0 } as unknown as RoundSnapshot["combatants"][string];
  }
  return { round: 0, combatants };
}
// A RoundSnapshot carrying BOTH hull and shield per enemy, for the effective-HP cases.
function snapOfHS(entries: Record<string, { hull: number; shield: number }>): RoundSnapshot {
  const combatants: RoundSnapshot["combatants"] = {};
  for (const [id, { hull, shield }] of Object.entries(entries)) {
    combatants[id] = { id, hull, shield } as unknown as RoundSnapshot["combatants"][string];
  }
  return { round: 0, combatants };
}

describe("targetEnemyId", () => {
  const enemies = [enemy("foe-a", 260), enemy("foe-b", 120), enemy("foe-c", 120)];

  it("returns null when there are no enemies", () => {
    expect(targetEnemyId([], snapOf({}))).toBe(null);
  });
  it("falls back to wave-start pool before any snapshot (lowest effective HP wins)", () => {
    // No snapshot: foe-b and foe-c tie at 120 effective HP; the LOWER id (foe-b) wins.
    expect(targetEnemyId(enemies, null)).toBe("foe-b");
  });
  it("marks the living enemy with the LOWEST current effective HP", () => {
    // foe-a chewed down to 40 (shield 0) is now the lowest-effective-HP living ship.
    expect(targetEnemyId(enemies, snapOf({ "foe-a": 40, "foe-b": 120, "foe-c": 120 }))).toBe(
      "foe-a",
    );
  });
  it("counts shield toward effective HP (shields soak before hull)", () => {
    // foe-b has the lowest HULL (60) but a 100 shield, so its effective HP is 160;
    // foe-a at 100 hull / 0 shield is effective HP 100 and is the real focus target.
    // Bare-hull logic would wrongly mark foe-b.
    const es = [enemy("foe-a", 100), enemy("foe-b", 60)];
    expect(
      targetEnemyId(es, snapOfHS({ "foe-a": { hull: 100, shield: 0 }, "foe-b": { hull: 60, shield: 100 } })),
    ).toBe("foe-a");
  });
  it("breaks an effective-HP tie to the LOWEST id, not wave order", () => {
    // Wave order is [zeta, alpha] but they tie at 50 effective HP, so the lower id
    // (alpha) is the target, matching selectTarget's order-independent tiebreak.
    const es = [enemy("zeta", 50), enemy("alpha", 50)];
    expect(targetEnemyId(es, null)).toBe("alpha");
  });
  it("skips destroyed enemies (hull <= 0) when picking the target", () => {
    // foe-b is destroyed; the lowest LIVING effective HP is foe-c at 90.
    expect(
      targetEnemyId(enemies, snapOf({ "foe-a": 200, "foe-b": 0, "foe-c": 90 })),
    ).toBe("foe-c");
  });
  it("returns null when every enemy is destroyed", () => {
    expect(
      targetEnemyId(enemies, snapOf({ "foe-a": 0, "foe-b": 0, "foe-c": 0 })),
    ).toBe(null);
  });
});

describe("enemyWaveTally", () => {
  const enemies = [enemy("foe-a", 260), enemy("foe-b", 120), enemy("foe-c", 120)];

  it("counts all living before any damage", () => {
    expect(enemyWaveTally(enemies, null)).toEqual({ living: 3, down: 0 });
  });
  it("splits living vs destroyed off the current snapshot", () => {
    expect(
      enemyWaveTally(enemies, snapOf({ "foe-a": 200, "foe-b": 0, "foe-c": 90 })),
    ).toEqual({ living: 2, down: 1 });
  });
  it("counts all down when every enemy is destroyed", () => {
    expect(
      enemyWaveTally(enemies, snapOf({ "foe-a": 0, "foe-b": 0, "foe-c": 0 })),
    ).toEqual({ living: 0, down: 3 });
  });
});

// ---------------------------------------------------------------------------
// Simplified combat-log renderer (Combat 0.13.0 combat-log options). The pure,
// plain-damage line + its structured token form, both tested without a DOM.
// ---------------------------------------------------------------------------
describe("weaponDisplayName", () => {
  it("maps a known roster type to its display name", () => {
    expect(weaponDisplayName("railgun")).toBe("Railgun");
    expect(weaponDisplayName("concussionTorpedo")).toBe("Concussion Torpedo");
  });
  it("falls back to 'weapons' for an absent or unknown type", () => {
    expect(weaponDisplayName(undefined)).toBe("weapons");
    expect(weaponDisplayName("phaser")).toBe("weapons");
  });
});

describe("simplifiedLogLine", () => {
  // Player id -> captain name, enemy id -> hull label, exactly like the flavor path.
  const nameFor = buildNameFor("P1", "Captain Vale", ["E1"], ["Raider Interceptor"]);

  it("reports a hit with both shield and hull damage, named by weapon type", () => {
    const line = simplifiedLogLine(
      ev({
        type: "hit",
        actorId: "P1",
        targetId: "E1",
        weaponType: "railgun",
        damage: 12,
        shieldDamage: 5,
        hullDamage: 7,
      }),
      nameFor,
    );
    expect(line).toBe(
      "Captain Vale's Railgun hits Raider Interceptor for 5 shield damage and 7 hull damage.",
    );
  });

  it("uses shield-only shorthand when the hull took nothing", () => {
    const line = simplifiedLogLine(
      ev({ type: "hit", actorId: "P1", targetId: "E1", weaponType: "voltaic", damage: 8, shieldDamage: 8, hullDamage: 0 }),
      nameFor,
    );
    expect(line).toBe("Captain Vale's Voltaic Arc hits Raider Interceptor for 8 shield damage.");
  });

  it("uses hull-only shorthand when shields took nothing", () => {
    const line = simplifiedLogLine(
      ev({ type: "hit", actorId: "P1", targetId: "E1", weaponType: "autocannon", damage: 9, shieldDamage: 0, hullDamage: 9 }),
      nameFor,
    );
    expect(line).toBe("Captain Vale's Autocannon hits Raider Interceptor for 9 hull damage.");
  });

  it("reads as a glancing hit when a connecting shot dealt zero", () => {
    const line = simplifiedLogLine(
      ev({ type: "hit", actorId: "P1", targetId: "E1", weaponType: "railgun", damage: 0, shieldDamage: 0, hullDamage: 0 }),
      nameFor,
    );
    expect(line).toBe("Captain Vale's Railgun hits Raider Interceptor but the shot glances off.");
  });

  it("falls back to 'weapons' when the hit has no weapon type", () => {
    const line = simplifiedLogLine(
      ev({ type: "hit", actorId: "E1", targetId: "P1", damage: 4, shieldDamage: 0, hullDamage: 4 }),
      nameFor,
    );
    expect(line).toBe("Raider Interceptor's weapons hits Captain Vale for 4 hull damage.");
  });

  it("attributes a damage total to hull when the split fields are absent", () => {
    // A damage event without the shield/hull split (defensive fallback) still reports.
    const line = simplifiedLogLine(
      ev({ type: "droneReflect", actorId: "E1", targetId: "P1", damage: 6 }),
      nameFor,
    );
    expect(line).toBe("Raider Interceptor's drones reflect fire at Captain Vale for 6 hull damage.");
  });

  it("renders an evade line", () => {
    expect(
      simplifiedLogLine(ev({ type: "evade", actorId: "P1", targetId: "E1" }), nameFor),
    ).toBe("Raider Interceptor evades Captain Vale's fire.");
  });

  it("renders a DoT line with the effect name and hull damage", () => {
    expect(
      simplifiedLogLine(
        ev({ type: "dot", targetId: "E1", damage: 20, effectDefId: "plasmaFire", effectRank: 2 }),
        nameFor,
      ),
    ).toBe("Plasma Fire II deals 20 hull damage to Raider Interceptor.");
  });

  it("renders a destroyed line", () => {
    expect(
      simplifiedLogLine(ev({ type: "destroyed", targetId: "E1" }), nameFor),
    ).toBe("Raider Interceptor is destroyed.");
  });

  it("renders an effect-applied line", () => {
    expect(
      simplifiedLogLine(
        ev({ type: "effectApplied", actorId: "P1", targetId: "E1", effectDefId: "plasmaFire", effectRank: 1 }),
        nameFor,
      ),
    ).toBe("Captain Vale hits Raider Interceptor with Plasma Fire.");
  });
});

describe("simplifiedLogTokens", () => {
  const nameFor = buildNameFor("P1", "Vale", ["E1"], ["Raider"]);

  it("tags the shield and hull numbers so the render layer can color them", () => {
    const tokens = simplifiedLogTokens(
      ev({ type: "hit", actorId: "P1", targetId: "E1", weaponType: "railgun", damage: 12, shieldDamage: 5, hullDamage: 7 }),
      nameFor,
    );
    // Exactly one shield-tagged token ("5") and one hull-tagged token ("7").
    const shieldTokens = tokens.filter((t) => t.kind === "shield");
    const hullTokens = tokens.filter((t) => t.kind === "hull");
    expect(shieldTokens.map((t) => t.text)).toEqual(["5"]);
    expect(hullTokens.map((t) => t.text)).toEqual(["7"]);
  });

  it("flattens to exactly the simplifiedLogLine string (no drift)", () => {
    const event = ev({ type: "hit", actorId: "P1", targetId: "E1", weaponType: "autocannon", damage: 9, shieldDamage: 2, hullDamage: 7 });
    const joined = simplifiedLogTokens(event, nameFor)
      .map((t) => t.text)
      .join("");
    expect(joined).toBe(simplifiedLogLine(event, nameFor));
  });

  it("a DoT line tags only the hull number", () => {
    const tokens = simplifiedLogTokens(
      ev({ type: "dot", targetId: "E1", damage: 20, effectDefId: "plasmaFire", effectRank: 1 }),
      nameFor,
    );
    expect(tokens.filter((t) => t.kind === "shield")).toEqual([]);
    expect(tokens.filter((t) => t.kind === "hull").map((t) => t.text)).toEqual(["20"]);
  });

  it("a plain line (evade) carries no colored damage tokens", () => {
    const tokens = simplifiedLogTokens(ev({ type: "evade", actorId: "P1", targetId: "E1" }), nameFor);
    expect(tokens.every((t) => t.kind === "text")).toBe(true);
  });

  it("renders EVERY drone / outcome / unknown event type as a non-blank, undefined-free line (totality)", () => {
    // The renderer must never emit a blank or "undefined"-bearing line for any event type
    // (Omega 14: no silent gaps). These types resolve via their own case or the default
    // catch-all; this pins that guarantee so a future event type cannot silently regress it.
    const types = [
      "droneVolley", "droneSupport", "droneCleanse", "droneIntercept",
      "droneReflect", "droneCounter", "droneReplenish", "outcome", "somethingBrandNew",
    ];
    for (const type of types) {
      const line = simplifiedLogLine(
        ev({ type, actorId: "P1", targetId: "E1", damage: 9, shieldDamage: 4, hullDamage: 5 }),
        nameFor,
      );
      expect(line.length, `type ${type} rendered blank`).toBeGreaterThan(0);
      expect(line, `type ${type} leaked undefined`).not.toContain("undefined");
    }
  });

  it("a winner-less outcome event reports the battle ending, not 'something wins'", () => {
    // Self-contained nameFor so the assertion does not depend on the enclosing fixture.
    const nf = buildNameFor("P1", "Vale", ["E1"], ["Raider"]);
    expect(simplifiedLogLine(ev({ type: "outcome" }), nf)).toBe("The battle ends.");
    expect(simplifiedLogLine(ev({ type: "outcome", actorId: "P1" }), nf)).toBe(
      "Vale wins the battle.",
    );
  });
});

// ---------------------------------------------------------------------------
// Visual-mode beats (Combat 0.13.0, Phase 12c). The pure map from a round's events
// to the animated pops/tracers, tested without a DOM exactly like the log renderers.
// ---------------------------------------------------------------------------
describe("visualBeatsForRound", () => {
  it("maps a crit hit to a hit beat carrying attacker, target, family, total, and crit", () => {
    const events = [
      ev({
        round: 3,
        type: "hit",
        actorId: "P1",
        targetId: "E1",
        family: "particle",
        damage: 12,
        shieldDamage: 5,
        hullDamage: 7,
        crit: true,
      }),
    ];
    expect(visualBeatsForRound(events, 3)).toEqual([
      { kind: "hit", fromId: "P1", toId: "E1", family: "particle", amount: 12, crit: true },
    ]);
  });

  it("sums the shield + hull split for the hit amount, and defaults crit to false", () => {
    const events = [
      ev({ round: 0, type: "hit", actorId: "P1", targetId: "E1", family: "kinetic", shieldDamage: 3, hullDamage: 4 }),
    ];
    const beats = visualBeatsForRound(events, 0);
    expect(beats[0].amount).toBe(7);
    expect(beats[0].crit).toBe(false);
  });

  it("maps a drone volley to ONE aggregate drone beat (never a crit, no family)", () => {
    const events = [
      ev({ round: 1, type: "droneVolley", actorId: "P1", targetId: "E1", damage: 9, shieldDamage: 2, hullDamage: 7 }),
    ];
    expect(visualBeatsForRound(events, 1)).toEqual([
      { kind: "drone", fromId: "P1", toId: "E1", amount: 9, crit: false },
    ]);
  });

  it("maps a drone reflect that carries only a damage total (no split) to that total", () => {
    // damageSplit attributes a bare `damage` to hull, so the aggregate still reports a number.
    const events = [ev({ round: 2, type: "droneReflect", actorId: "E1", targetId: "P1", damage: 6 })];
    expect(visualBeatsForRound(events, 2)[0]).toEqual({
      kind: "drone",
      fromId: "E1",
      toId: "P1",
      amount: 6,
      crit: false,
    });
  });

  it("maps a DoT tick to a target-only beat with no tracer (no fromId)", () => {
    const events = [ev({ round: 4, type: "dot", targetId: "E1", damage: 20 })];
    const beats = visualBeatsForRound(events, 4);
    expect(beats).toEqual([{ kind: "dot", toId: "E1", amount: 20 }]);
    expect(beats[0].fromId).toBeUndefined();
  });

  it("maps a destroyed event to a target-only destroyed beat (no amount, no fromId)", () => {
    const events = [ev({ round: 5, type: "destroyed", targetId: "E1" })];
    expect(visualBeatsForRound(events, 5)).toEqual([{ kind: "destroyed", toId: "E1" }]);
  });

  it("maps an evade to a quiet evade beat carrying attacker + target", () => {
    const events = [ev({ round: 6, type: "evade", actorId: "P1", targetId: "E1" })];
    expect(visualBeatsForRound(events, 6)).toEqual([{ kind: "evade", fromId: "P1", toId: "E1" }]);
  });

  it("produces NO beat for non-pop event types (roundState / effectApplied / outcome / etc)", () => {
    const events = [
      ev({ round: 0, type: "roundState", actorId: "P1" }),
      ev({ round: 0, type: "effectApplied", actorId: "P1", targetId: "E1", effectDefId: "plasmaFire" }),
      ev({ round: 0, type: "effectExpired", targetId: "E1", effectDefId: "plasmaFire" }),
      ev({ round: 0, type: "droneIntercept", actorId: "P1", targetId: "E1" }),
      ev({ round: 0, type: "droneSupport", actorId: "P1" }),
      ev({ round: 0, type: "outcome", actorId: "P1" }),
      ev({ round: 0, type: "battleEnd" }),
    ];
    expect(visualBeatsForRound(events, 0)).toEqual([]);
  });

  it("filters to the requested round only, preserving fire order within it", () => {
    const events = [
      ev({ round: 0, type: "hit", actorId: "P1", targetId: "E1", damage: 1, hullDamage: 1 }),
      ev({ round: 1, type: "hit", actorId: "P1", targetId: "E1", damage: 2, hullDamage: 2 }),
      ev({ round: 1, type: "droneVolley", actorId: "P1", targetId: "E1", damage: 3, hullDamage: 3 }),
      ev({ round: 2, type: "hit", actorId: "P1", targetId: "E1", damage: 4, hullDamage: 4 }),
    ];
    const beats = visualBeatsForRound(events, 1);
    expect(beats.map((b) => `${b.kind}:${b.amount}`)).toEqual(["hit:2", "drone:3"]);
  });

  it("skips a pop-worthy event that has no target (nothing to anchor a pop over)", () => {
    const events = [ev({ round: 0, type: "hit", actorId: "P1", damage: 5, hullDamage: 5 })];
    expect(visualBeatsForRound(events, 0)).toEqual([]);
  });
});
