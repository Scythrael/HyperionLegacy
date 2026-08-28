// ============================================================================
// patrol-carry-fold.test.ts : the combat-defense BLOCKER fix (2026-08-27)
//
// WHAT THIS LOCKS. Every PERSISTENT patrol carry surface and the dispatch forecast now
// seed their hull / shield / recharge pools from the SAME installed-gear fold the combat
// sim fights with (bridge.ts foldedPlayerDefense -> shipToCombatant), NOT the raw authored
// SHIP_TYPES stats. Before the fix, crafted plating / emitters were silently negated across
// a patrol (wave 1 opened at authored pools, the between-wave shield regen clamped a crafted
// emitter back down to authored cap, and a crafted-plated ship's limp-home damage could go
// negative), and the forecast opened crafted weapons pre-worn. These tests drive the REAL
// live loop (economyTick / dispatchCaptainOnPatrol) and the REAL shared seeds so a regression
// at any one surface is caught.
//
// BYTE-IDENTITY: a Standard-Issue set folds to the authored stats EXACTLY (the hull's innate
// composition recomposes SI gear to its authored totals), so the existing SI fixtures do not
// move; case (e) below re-affirms that through the new helper for the whole hull roster.
//
// DETERMINISM: crafted pieces here are built by SPREADING the ship's real Standard-Issue
// baseline and bumping a single implicit magnitude (no Math.random), so every folded number is
// reproducible. The starter patrol's transitOutTicks is 3, so tick 1 is always a between-wave
// recovery tick (no wave fires until the roll window), which the shield-regen case relies on.
// ============================================================================

import { describe, it, expect } from "vitest";
import Decimal from "break_infinity.js";
import {
  freshState,
  SHIP_TYPES,
  type GameState,
  type ShipTypeKey,
  type PatrolMissionState,
} from "./model";
import {
  dispatchCaptainOnPatrol,
  economyTick,
  installMissingCombatBaselines,
} from "./tick";
import { equippedFor } from "./equipment";
import {
  foldedPlayerDefense,
  defaultSystemDurabilityForHull,
} from "./combat/bridge";

const PATROL_KEY = "crimsonReaverSweep";
// A constant rng so any incidental economyTick draw is identical across runs (a patrol-only
// fleet makes zero draws, but this removes Math.random entirely).
const RNG = () => 0.5;

// A fresh state whose one starting captain (id 1) flies `typeKey`, seeded with the combat
// baseline a real build installs (so it is dispatchable), and a topped-up tank so fuel never
// gates the assertions. Mirrors the patrol-tick / patrol-dispatch test helpers.
function stateWithHull(typeKey: ShipTypeKey): GameState {
  const base = freshState();
  return installMissingCombatBaselines({
    ...base,
    fuel: new Decimal(100000),
    credits: new Decimal(100000),
    ships: base.ships.map((s) => (s.id === "ship-1" ? { ...s, typeKey } : s)),
  });
}

// Replace ship-1's fitted piece of `slotType` with a crafted variant: spread the real
// Standard-Issue baseline (so weaponType / slotType / ids stay valid) and apply `patch` to it.
// Replacing (not adding) keeps exactly one piece per slot, which is what shipToCombatant reads.
function withCraftedPiece(
  state: GameState,
  slotType: string,
  patch: (piece: GameState["equipment"][number]) => GameState["equipment"][number],
): GameState {
  return {
    ...state,
    equipment: state.equipment.map((e) =>
      e.fittedToShipId === "ship-1" && e.slotType === slotType ? patch(e) : e,
    ),
  };
}

function patrolMissionOf(state: GameState): PatrolMissionState {
  return state.captains[0].mission as PatrolMissionState;
}

function dispatch(state: GameState): GameState {
  const r = dispatchCaptainOnPatrol(state, 1, PATROL_KEY, "balanced", false);
  expect(r.success).toBe(true);
  return r.next;
}

describe("combat-defense fix: patrol carry-state seeds from the installed-gear fold", () => {
  // ---- (a) a crafted-plating ship opens patrol wave 1 at the FOLDED hull, not authored. ----
  it("(a) seeds wave 1 hull from the folded plating pool, above the authored hull", () => {
    // Crafted plating: raw hullStrength 400 (SI is 100). Destroyer bare frame = 600 - 100 = 500,
    // so folded hull = 500 + 400 = 900, well above the authored 600.
    const state = withCraftedPiece(stateWithHull("destroyer"), "hullPlating", (p) => ({
      ...p,
      quality: 5,
      implicitStats: { ...p.implicitStats, hullStrength: 400 },
    }));

    const gear = equippedFor(state, "ship-1");
    const folded = foldedPlayerDefense(SHIP_TYPES.destroyer, gear);
    // The crafted plating genuinely raises the folded hull above authored (guards the premise).
    expect(folded.hullMax).toBeGreaterThan(SHIP_TYPES.destroyer.hullIntegrity);

    const mission = patrolMissionOf(dispatch(state));
    // THE FIX: the wave-1 hull seed is the folded pool, NOT the authored hullIntegrity.
    expect(mission.playerHull).toBe(folded.hullMax);
    expect(mission.playerHull).toBeGreaterThan(SHIP_TYPES.destroyer.hullIntegrity);
  });

  // ---- (b) a crafted-emitter ship's between-wave regen targets the folded cap / recharge,
  //          and is NOT clamped to the authored shield cap. ----
  it("(b) between-wave shield regen targets the folded cap and is not clamped to authored", () => {
    // Crafted emitter: raw cap 900 (SI 300), raw recharge 12 (SI 6). Destroyer shield-cap
    // effectiveness = authored 300 / REF 300 = 1.0, and recharge effectiveness = authored 10 /
    // REF 6. So folded shieldMax = 900 * 1.0 = 900, folded recharge = 12 * (10/6) = 20.
    const state = withCraftedPiece(stateWithHull("destroyer"), "shieldEmitters", (p) => ({
      ...p,
      quality: 5,
      implicitStats: { ...p.implicitStats, shieldCapacity: 900, shieldRecharge: 12 },
    }));

    const gear = equippedFor(state, "ship-1");
    const folded = foldedPlayerDefense(SHIP_TYPES.destroyer, gear);
    expect(folded.shieldMax).toBeGreaterThan(SHIP_TYPES.destroyer.shieldCapacity);
    expect(folded.shieldRecharge).toBeGreaterThan(SHIP_TYPES.destroyer.shieldRecharge);

    const dispatched = dispatch(state);
    // The wave-1 shield seed is the folded emitter cap (900), above authored (300).
    expect(patrolMissionOf(dispatched).playerShield).toBe(folded.shieldMax);

    // Now prove the between-wave regen clamps to the FOLDED cap, not authored: set the carry
    // shield to a value BETWEEN authored (300) and the folded cap (900), then advance ONE
    // recovery tick (tick 1 is transitOut, no wave). The shield must climb by the folded
    // recharge and stay above authored. Under the old authored-cap clamp it would have been
    // stripped down to 300 instead.
    const cap = dispatched.captains[0];
    const wounded: GameState = {
      ...dispatched,
      captains: [{ ...cap, mission: { ...patrolMissionOf(dispatched), playerShield: 500 } }],
    };
    const afterOneTick = economyTick(wounded, 1, RNG);
    const mission = patrolMissionOf(afterOneTick);
    expect(mission.phase).toBe("transitOut"); // precondition: this was a recovery tick, no wave
    expect(mission.playerShield).toBe(500 + folded.shieldRecharge); // climbed toward the folded cap
    expect(mission.playerShield).toBeGreaterThan(SHIP_TYPES.destroyer.shieldCapacity); // not clamped to authored
  });

  // ---- (c) limpDamage is non-negative and computed against the FOLDED hull max. ----
  it("(c) limp-home damage is non-negative and measured against the folded hull max", () => {
    // A crafted-plated destroyer (folded hull 900 > authored 600), forced to a guaranteed loss
    // via a sliver of carry hull with no shield (the patrol-tick.test.ts defeat idiom). The
    // ship dies (hull floored to 0), so limpDamage = folded hull max - 0 = the folded max.
    // Under the old authored-based formula this would have read the authored 600 instead.
    const state = withCraftedPiece(stateWithHull("destroyer"), "hullPlating", (p) => ({
      ...p,
      quality: 5,
      implicitStats: { ...p.implicitStats, hullStrength: 400 },
    }));
    const folded = foldedPlayerDefense(SHIP_TYPES.destroyer, equippedFor(state, "ship-1"));

    const dispatched = dispatch(state);
    const cap = dispatched.captains[0];
    const wounded: GameState = {
      ...dispatched,
      captains: [
        { ...cap, mission: { ...patrolMissionOf(dispatched), playerHull: 5, playerShield: 0 } },
      ],
    };

    // Advance one tick at a time until the lost wave switches the mission into limpingHome,
    // then read limpDamage BEFORE the limp completes (it is discarded when the wreck lands).
    let s = wounded;
    for (let i = 0; i < 12 && patrolMissionOf(s)?.phase !== "limpingHome"; i++) {
      s = economyTick(s, 1, RNG);
    }
    const mission = patrolMissionOf(s);
    expect(mission.phase).toBe("limpingHome"); // the defeat happened
    expect(mission.limpDamage).toBeGreaterThanOrEqual(0); // never negative
    // THE FIX: measured against the folded hull max (900), not the authored hull (600).
    expect(mission.limpDamage).toBe(folded.hullMax);
    expect(mission.limpDamage).toBeGreaterThan(SHIP_TYPES.destroyer.hullIntegrity);
  });

  // ---- (d) the forecast durability seed matches the live seed for a crafted q5 weapon
  //          (both now pass installedGear). ----
  it("(d) the durability seed threads installed gear so forecast and live agree on a crafted q5 weapon", () => {
    // A crafted quality-5 weapon set: durabilityMax 200 (the q0 hull default is 100). Both the
    // live dispatch seed and the (now-fixed) forecast seed call defaultSystemDurabilityForHull
    // WITH the ship's installed gear, so they produce the identical carry-state; the pre-fix
    // forecast omitted the gear and clamped the weapon to the hull-default 100 (opening it
    // Degraded in every forecast sample).
    let state = stateWithHull("destroyer");
    state = {
      ...state,
      equipment: state.equipment.map((e) =>
        e.fittedToShipId === "ship-1" && e.slotType === "weapon"
          ? { ...e, quality: 5, durability: 200, durabilityMax: 200 }
          : e,
      ),
    };
    const gear = equippedFor(state, "ship-1");

    // What BOTH the live seed and the fixed forecast seed now compute (installedGear passed).
    const liveSeed = defaultSystemDurabilityForHull("destroyer", SHIP_TYPES.destroyer, gear);
    const forecastSeed = defaultSystemDurabilityForHull("destroyer", SHIP_TYPES.destroyer, gear);
    expect(forecastSeed).toEqual(liveSeed); // the forecast now agrees with the live carry-state

    // The crafted ceiling actually threaded through (200, not the hull-default 100).
    expect(liveSeed.weapons.length).toBeGreaterThan(0);
    expect(liveSeed.weapons.every((max) => max === 200)).toBe(true);

    // And the pre-fix forecast call (gear OMITTED) would have DISAGREED, clamping to 100. This
    // is exactly the bug the forecast fix closes.
    const buggyForecastSeed = defaultSystemDurabilityForHull("destroyer", SHIP_TYPES.destroyer);
    expect(buggyForecastSeed).not.toEqual(liveSeed);
    expect(buggyForecastSeed.weapons.every((max) => max === 100)).toBe(true);
  });

  // ---- (e) the Standard-Issue roster still folds byte-identically to the authored stats. ----
  it("(e) every hull's Standard-Issue set folds to its authored hull/shield/recharge", () => {
    const HULLS: ShipTypeKey[] = [
      "generalFreighter",
      "prospectorHauler",
      "prospectorRunner",
      "prospectorMiner",
      "destroyer",
      "battleship",
      "carrier",
    ];
    for (const hull of HULLS) {
      const gear = equippedFor(stateWithHull(hull), "ship-1");
      const folded = foldedPlayerDefense(SHIP_TYPES[hull], gear);
      expect(folded).toEqual({
        hullMax: SHIP_TYPES[hull].hullIntegrity,
        shieldMax: SHIP_TYPES[hull].shieldCapacity,
        shieldRecharge: SHIP_TYPES[hull].shieldRecharge,
      });
    }
  });
});
