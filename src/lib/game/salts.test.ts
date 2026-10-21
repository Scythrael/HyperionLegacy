// Ground Operations (GO-4): THE SALT REGISTRY. Every keyed stream in the engine is makeRng((seed ^ SALT ^ key)
// >>> 0); two purposes sharing a salt would share a stream (the same rolls under two names), so every
// exported `*_SALT` constant of the modules below must be DISTINCT, ODD and a 32-bit unsigned value. The test
// collects the salts from the module namespaces, so a new exported salt in any listed module is checked
// automatically. Ground Ops modules join the list as they land (groundFight.ts at GO-5, groundThreat.ts at
// GO-6, groundOps.ts at Squads SQ-3 with its first salt, the ambush roll, and GO-7d's Auto-assign stream; riskFactors.ts at Squads SQ-4, the risk
// profile; affixes.ts at AF-1, the objective affix stamping roll and the per-landing reinforcement roll; telescope.ts at Squads SQ-5, the display-only system distance; galaxy.ts at G2-1, the homeworld placement and the enemy sectors; shipScanEvents.ts at GO-8; fieldKits.ts at Field Kits FKR-2, the per-use field device roll). A salt
// that is not exported is invisible here: keep engine salts exported.
// GO-5 (GO-4 review) exported and registered the four that were not: tick.ts MISSION_OUTPUT_ROUNDING_SALT,
// relics.ts RELIC_STUDY_SALT, salvage.ts SALVAGE_ROUNDING_SEED_SALT, seniorStaff.ts OFFICER_STAT_SEED_SALT.

import { describe, it, expect } from "vitest";
import * as expedition from "./expedition";
import * as gambit from "./gambit";
import * as groundTasks from "./groundTasks";
import * as groundFight from "./groundFight";
import * as groundThreat from "./groundThreat";
import * as groundOps from "./groundOps";
import * as riskFactors from "./riskFactors";
import * as affixes from "./affixes";
import * as telescope from "./telescope";
import * as galaxy from "./galaxy";
import * as shipScanEvents from "./shipScanEvents";
import * as fieldKits from "./fieldKits";
import * as relics from "./relics";
import * as salvage from "./salvage";
import * as seniorStaff from "./seniorStaff";
import * as tick from "./tick";
import * as officerStats from "./officerStats";
import * as captainSecondaryEffects from "./captainSecondaryEffects";
import * as waveSeed from "./combat/waveSeed";
import * as model from "./model";
import * as awayTeam from "./awayTeam";
import * as crewGraduation from "./crewGraduation";
import * as shortRange from "./shortRange";
import * as relicBlanks from "./relicBlanks";

// The modules whose salts must be distinct AND odd.
const MODULES: Record<string, Record<string, unknown>> = {
  "expedition.ts": expedition,
  "gambit.ts": gambit,
  "groundTasks.ts": groundTasks,
  "groundFight.ts": groundFight,
  "groundThreat.ts": groundThreat,
  "groundOps.ts": groundOps,
  "riskFactors.ts": riskFactors,
  "affixes.ts": affixes,
  "telescope.ts": telescope,
  "galaxy.ts": galaxy,
  "shipScanEvents.ts": shipScanEvents,
  "fieldKits.ts": fieldKits,
  "officerStats.ts": officerStats,
  "captainSecondaryEffects.ts": captainSecondaryEffects, // WR-5a: MOTHERLODE_SALT
  "relics.ts": relics,
  "salvage.ts": salvage,
  "tick.ts": tick,
  "combat/waveSeed.ts": waveSeed,
  // Prospecting squads (hidden): the recruit board's separate Prospecting slots.
  "awayTeam.ts": awayTeam,
  // Complement CP-8: the graduate and manifest name seeds.
  "crewGraduation.ts": crewGraduation,
  // G1-2: the short-range board seed, the roll and the whole-unit rounding.
  "shortRange.ts": shortRange,
  // Relics v2 R2-2: a blank's culture, the short-range relic hook and the planet completion hook.
  "relicBlanks.ts": relicBlanks,
};

// Legacy salts checked for DISTINCTNESS only. model.ts AWAY_RECRUIT_SEED_SALT (0x5a17c0de) predates the odd
// rule and is even; changing it would reroll every recruit offer, so it stays (it still must not collide).
// seniorStaff.ts OFFICER_STAT_SEED_SALT (0x3c6ef372) is EVEN for the same reason: changing it would reroll
// every officer's stats. Registered at GO-5, distinct-only.
const DISTINCT_ONLY: Record<string, Record<string, unknown>> = {
  "model.ts": model,
  "seniorStaff.ts": seniorStaff,
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
      "expedition.ts SYSTEM_NAME_SALT",
      "expedition.ts CANDIDATE_BEARING_SALT",
      "expedition.ts FAMOUS_SYSTEM_SALT",
      "expedition.ts BODY_COUNT_SALT",
      "gambit.ts COMBAT_SALT",
      "gambit.ts REWARD_SALT",
      "gambit.ts SCAN_BATTLE_SALT",
      "gambit.ts SCAN_DROP_SALT",
      "gambit.ts SUPPLY_CACHE_SALT",
      "gambit.ts NEURAL_BACKUP_SALT",
      "groundFight.ts GROUND_FIGHT_SALT",
      "groundThreat.ts GROUND_THREAT_SALT",
      "groundOps.ts GROUND_AMBUSH_SALT",
      "groundOps.ts AUTO_ASSIGN_SALT",
      "riskFactors.ts RISK_SALT",
      "affixes.ts AFFIX_ROLL_SALT",
      "affixes.ts REINFORCEMENT_SALT",
      "telescope.ts SYSTEM_DISTANCE_SALT",
      "galaxy.ts HOMEWORLD_PLACEMENT_SALT",
      "galaxy.ts ENEMY_SECTOR_SALT",
      "shipScanEvents.ts SHIP_EVENT_SALT",
      "shipScanEvents.ts PROBE_BATTLE_SALT",
      "shipScanEvents.ts PROBE_SALVAGE_SALT",
      "shipScanEvents.ts GHOST_FIND_SALT",
      "fieldKits.ts FIELD_DEVICE_SALT",
      "relics.ts RELIC_STUDY_SALT",
      "salvage.ts SALVAGE_ROUNDING_SEED_SALT",
      "tick.ts MISSION_OUTPUT_ROUNDING_SALT",
      "officerStats.ts CUNNING_SALT",
      "combat/waveSeed.ts WAVE_ENEMY_SEED_SALT",
      "combat/waveSeed.ts WAVE_BATTLE_SEED_SALT",
      "combat/waveSeed.ts RELAUNCH_SEED_SALT",
      "combat/waveSeed.ts WAVE_LOOT_SEED_SALT",
      "combat/waveSeed.ts WAVE_OUTPUT_ROUNDING_SEED_SALT",
      "crewGraduation.ts NOTABLE_NAME_SALT",
      "crewGraduation.ts MANIFEST_NAME_SALT",
      "shortRange.ts SHORT_RANGE_BOARD_SALT",
      "shortRange.ts SHORT_RANGE_ROLL_SALT",
      "shortRange.ts SHORT_RANGE_ROUNDING_SALT",
      "shortRange.ts SHORT_RANGE_OUTPUT_SALT",
      "relicBlanks.ts RELIC_CULTURE_SALT",
      "relicBlanks.ts RELIC_SHORT_RANGE_SALT",
      "relicBlanks.ts RELIC_COMPLETION_SALT",
    ]) {
      expect(names).toContain(expected);
    }
    // groundTasks.ts adds no salt: its only roll is the reused legacy task reward stream (gambit.ts REWARD_SALT).
    expect(names.filter((n) => n.startsWith("groundTasks.ts"))).toEqual([]);
    // The legacy even salts are on the distinct-only list.
    const legacy = ALL.filter((s) => !STRICT.includes(s)).map((s) => s.where);
    expect(legacy.sort()).toEqual(["model.ts AWAY_RECRUIT_SEED_SALT", "seniorStaff.ts OFFICER_STAT_SEED_SALT"]);
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
