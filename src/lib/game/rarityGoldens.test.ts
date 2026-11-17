// RARITY READINESS RR-0 (docs/plans/2026-10-23-rarity-readiness-plan.md): the goldens captured on the engine BEFORE any
// rarity engine edit. LIVE pins (Standard to Radiant, ascension "none", the real inspect mint, the craft preview, the
// live crew Derelict band and the live order readers) may never move in any rarity readiness slice; RESERVED pins
// (Derelict items, Luminous, Constellar, Nova, Celestial) carry their owner slice in the key and move only in that
// slice, with the move explained in its commit. See rarityGoldens.fixture.ts.

import { describe, expect, it } from "vitest";
import { withoutGg7Content } from "./gasGiantSpecials.fixture";
// E-MOD EM-8 came after this capture: the Precursor Lens's blueprint, variety and the circuit's recipe held apart.
import { EM8_BLUEPRINT_KEYS, withoutEm8Content } from "./emodEm8Switch.fixture";
import { withoutCp11Content } from "./cp11BlueprintsSwitch.fixture";
import { writeFileSync } from "node:fs";
import { BLUEPRINTS, EQUIPMENT_RARITY_LADDER } from "./model";
import { WEAPON_DEFS } from "./combat/weapons";
import { ROLE_TEMPLATE } from "./combat/drones";
import {
  LIVE_BANDS,
  RARITY_GOLDENS_LIVE,
  RARITY_GOLDENS_RESERVED,
  RESERVED_BANDS,
  RESERVED_OWNER,
  computeLivePins,
  computeReservedPins,
  gearBlueprintKeys,
  liveSlots,
  sweepFacts,
} from "./rarityGoldens.fixture";
import { crewModuleSiOffForThisFile } from "./crewModuleSiSwitch.fixture";

// Standard-Issue crew modules (0.14.0, user 2026-11-17 "free basic set, all ships"): this file's pins predate the
// free Sensor Suite, Bridge Module and Crew Quarters every ship now carries (their berths, officer lift, hull bonus
// and equipment ids), so the set is off here and the pins keep proving their own slice. The set itself is pinned in
// crewModuleStandardIssue.test.ts.
crewModuleSiOffForThisFile();

// RR_CAPTURE = an output path: record every pin instead of asserting (the GW_CAPTURE pattern).
const CAPTURE = Boolean(import.meta.env.RR_CAPTURE);

describe("rarity readiness goldens (RR-0, captured before any rarity engine edit)", () => {
  it("covers the whole ladder, every live slot, weapon, drone role and gear blueprint (vacuity guard)", () => {
    expect([...LIVE_BANDS, ...RESERVED_BANDS].sort()).toEqual([...EQUIPMENT_RARITY_LADDER].sort());
    expect(liveSlots().length).toBeGreaterThanOrEqual(13);
    expect(Object.keys(WEAPON_DEFS).length).toBeGreaterThan(0);
    expect(Object.keys(ROLE_TEMPLATE).length).toBe(3);
    const gear = gearBlueprintKeys();
    expect(gear.length).toBeGreaterThan(50);
    for (const k of gear) expect(BLUEPRINTS[k]).toBeDefined();
  });

  it("every band but Derelict (no affixes by design) mints pieces with more than one rolled line; member slots mint off a real blueprint", () => {
    const { multiLine, memberWithBlueprint } = sweepFacts();
    for (const r of EQUIPMENT_RARITY_LADDER) {
      if (r === "derelict") expect(multiLine[r], r).toBe(0);
      else expect(multiLine[r], r).toBeGreaterThan(0);
    }
    expect(memberWithBlueprint).toBeGreaterThan(0);
  });

  it("every RESERVED key names its owner slice, and no LIVE key does", () => {
    const reserved = Object.keys(computeReservedPins());
    for (const k of reserved) expect(RESERVED_OWNER.test(k), k).toBe(true);
    for (const k of Object.keys(computeLivePins())) expect(RESERVED_OWNER.test(k), k).toBe(false);
  });

  if (CAPTURE) {
    it("captures", () => {
      writeFileSync(String(import.meta.env.RR_CAPTURE), JSON.stringify({ live: computeLivePins(), reserved: computeReservedPins() }, null, 2));
    });
    return;
  }

  // Gas Giant Study GG-7 came after this capture: its blueprints and slot varieties are held apart
  // (gasGiantSpecials.fixture.ts), so the rarity slices stay the only moves. Complement CP-11's blueprints likewise
  // (cp11BlueprintsSwitch.fixture.ts).
  it("LIVE: Standard to Radiant, the inspect mint, the craft preview and the live readers are byte-identical", () => {
    const pins = withoutCp11Content(() => withoutGg7Content(() => withoutEm8Content(() => computeLivePins())));
    expect(Object.keys(pins).sort()).toEqual(Object.keys(RARITY_GOLDENS_LIVE).sort());
    for (const [k, v] of Object.entries(pins)) expect(v, k).toBe(RARITY_GOLDENS_LIVE[k]);
  });

  it("RESERVED: Derelict items, Luminous, Constellar, Nova and Celestial (moved only by the owner slice in the key)", () => {
    const pins = withoutCp11Content(() => withoutGg7Content(() => withoutEm8Content(() => computeReservedPins())));
    expect(Object.keys(pins).sort()).toEqual(Object.keys(RARITY_GOLDENS_RESERVED).sort());
    for (const [k, v] of Object.entries(pins)) expect(v, k).toBe(RARITY_GOLDENS_RESERVED[k]);
  });
});
