// Ground Operations (GO-4): THE SALT REGISTRY. Every keyed stream in the engine is makeRng((seed ^ SALT ^ key)
// >>> 0); two purposes sharing a salt would share a stream (the same rolls under two names), so every
// exported `*_SALT` constant of the modules below must be DISTINCT, ODD and a 32-bit unsigned value. The test
// collects the salts from the module namespaces, so a new exported salt in any listed module is checked
// automatically. Ground Ops modules join the list as they land (groundFight.ts at GO-5, groundOps.ts at GO-7,
// shipScanEvents.ts at GO-8). A salt that is not exported is invisible here: keep engine salts exported.

import { describe, it, expect } from "vitest";
import * as expedition from "./expedition";
import * as gambit from "./gambit";
import * as groundTasks from "./groundTasks";
import * as officerStats from "./officerStats";
import * as waveSeed from "./combat/waveSeed";
import * as model from "./model";

// The modules whose salts must be distinct AND odd.
const MODULES: Record<string, Record<string, unknown>> = {
  "expedition.ts": expedition,
  "gambit.ts": gambit,
  "groundTasks.ts": groundTasks,
  "officerStats.ts": officerStats,
  "combat/waveSeed.ts": waveSeed,
};

// Legacy salts checked for DISTINCTNESS only. model.ts AWAY_RECRUIT_SEED_SALT (0x5a17c0de) predates the odd
// rule and is even; changing it would reroll every recruit offer, so it stays (it still must not collide).
const DISTINCT_ONLY: Record<string, Record<string, unknown>> = {
  "model.ts": model,
};

interface Salt {
  where: string;
  value: number;
}

function saltsOf(mods: Record<string, Record<string, unknown>>): Salt[] {
  const out: Salt[] = [];
  for (const [file, mod] of Object.entries(mods)) {
    for (const [name, value] of Object.entries(mod)) {
      if (!/_SALT$/.test(name) || typeof value !== "number") continue;
      out.push({ where: `${file} ${name}`, value });
    }
  }
  return out;
}

const STRICT = saltsOf(MODULES);
const ALL = [...STRICT, ...saltsOf(DISTINCT_ONLY)];

describe("salt registry (GO-4)", () => {
  it("collects every known engine salt (an un-exported salt would vanish from the check)", () => {
    const names = STRICT.map((s) => s.where);
    for (const expected of [
      "expedition.ts SYSTEM_SALT",
      "expedition.ts ANOMALY_SALT",
      "expedition.ts DISCOVERY_SALT",
      "expedition.ts ENCOUNTER_SALT",
      "gambit.ts COMBAT_SALT",
      "gambit.ts REWARD_SALT",
      "gambit.ts SCAN_BATTLE_SALT",
      "gambit.ts SCAN_DROP_SALT",
      "gambit.ts SUPPLY_CACHE_SALT",
      "gambit.ts NEURAL_BACKUP_SALT",
      "officerStats.ts CUNNING_SALT",
      "combat/waveSeed.ts WAVE_ENEMY_SEED_SALT",
      "combat/waveSeed.ts WAVE_BATTLE_SEED_SALT",
      "combat/waveSeed.ts RELAUNCH_SEED_SALT",
      "combat/waveSeed.ts WAVE_LOOT_SEED_SALT",
      "combat/waveSeed.ts WAVE_OUTPUT_ROUNDING_SEED_SALT",
    ]) {
      expect(names).toContain(expected);
    }
    // groundTasks.ts adds no salt: its only roll is the reused legacy task reward stream (gambit.ts REWARD_SALT).
    expect(names.filter((n) => n.startsWith("groundTasks.ts"))).toEqual([]);
  });

  it("every salt is a 32-bit unsigned integer", () => {
    for (const s of ALL) {
      expect(Number.isInteger(s.value), s.where).toBe(true);
      expect(s.value, s.where).toBeGreaterThan(0);
      expect(s.value, s.where).toBe(s.value >>> 0);
    }
  });

  it("every salt is odd (the legacy distinct-only list excepted)", () => {
    for (const s of STRICT) expect(s.value % 2, `${s.where} = 0x${s.value.toString(16)}`).toBe(1);
  });

  it("no two salts share a value", () => {
    const seen = new Map<number, string>();
    const clashes: string[] = [];
    for (const s of ALL) {
      const prior = seen.get(s.value);
      if (prior !== undefined) clashes.push(`${prior} and ${s.where} = 0x${s.value.toString(16)}`);
      else seen.set(s.value, s.where);
    }
    expect(clashes).toEqual([]);
  });
});
