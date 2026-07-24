// ============================================================================
// combat/patrolLoot.ts -- seeded, deterministic PATROL WAVE LOOT roller (Combat
// 0.13.0, Phase 10, design S12 "Rewards and loot").
//
// WHY THIS EXISTS:
// A won patrol wave is a defeated enemy WRECK to loot. This module owns the pure,
// data-driven roll that turns one won wave (plus a per-wave seed) into a concrete
// reward: salvaged material + a small cargo mix + a credit bounty + flat XP awards.
// It is deliberately its OWN tiny module (mirroring enemyWave.ts / waveSchedule.ts)
// so the loot math is testable in isolation and stays out of the giant tick.ts.
//
// TWO HARD INVARIANTS this module is built to satisfy (both proven by tests):
//
//   1. DETERMINISM / offline == live (design S0). Every draw comes from makeRng
//      (the combat PRNG, rng.ts), NEVER Math.random. rollWaveLoot is a PURE
//      function of (table, seed): same inputs => byte-identical output, always.
//      The CALLER (tick.ts) derives each won wave's seed from the persisted
//      masterSeed + that wave's index via a DISTINCT loot salt, so a wave's loot
//      is fixed the instant the wave resolves and is identical whether the patrol
//      advanced as one big offline catch-up or many small live ticks.
//
//   2. NO FUNCTIONAL GEAR (design S12). The roller only ever emits MATERIAL item
//      ids (raw / refined / component / salvagedMaterial); it never mints an
//      equipment/weapon. This protects the crafting loop (combat FEEDS crafting,
//      it does not bypass it). The guard lives in the TABLES (they list only
//      material ids) and is locked by patrol-loot.test.ts, which asserts every
//      table id resolves to a non-gear ITEMS category.
//
// ⚠️ RESERVED, DEFERRED SLOT (design S12): the design wants a GUARANTEED
// "Damaged [System]" reverse-engineering component per wreck (the Damaged Reactor
// Housing idiom, e.g. a Damaged EMP Cannon that reverse-engineers into a weapon
// recipe). That is intentionally NOT emitted here yet: weapon crafting does not
// exist, so such an item would be DEAD inventory. PatrolLootTable carries a
// commented reserved field for it; wire it in (and its item + recipe) when weapon
// crafting lands. See tick.ts's PATROL_LOOT_TABLES for the same note.
// ============================================================================

import { makeRng } from "./rng";

// ----------------------------------------------------------------------------
// Table shapes. Data-driven ON PURPOSE (design S12: "all wreck loot modeled as
// TABLES so ship-class-specific + rare-enemy bounty tables slot in later"). A
// future richer table (per hull class, per rare enemy) is just another
// PatrolLootTable value; the roller below does not change.
// ----------------------------------------------------------------------------

// One weighted material line: which item, and the inclusive integer qty band a
// single draw of it yields. itemId MUST be a real ITEMS key AND a MATERIAL
// category (never shipModule/shipSystem/equipment); patrol-loot.test.ts enforces
// both so a typo or an accidental gear drop fails the suite.
export interface LootMaterialEntry {
  itemId: string; // a real ITEMS registry key (material category only)
  minQty: number; // inclusive floor of one roll
  maxQty: number; // inclusive ceiling of one roll (>= minQty)
}

// The full per-wave loot definition for one patrol (or, later, one hull class /
// rare enemy). Every amount here is FIRST-PASS TUNABLE (see tick.ts's tables for
// the concrete launch values + rationale).
export interface PatrolLootTable {
  // GUARANTEED salvaged-material drop every won wave (an existing salvagedMaterial
  // item: the wreck stripped for parts). One qty roll off this band.
  salvage: LootMaterialEntry;
  // The wreck's CARGO HOLD: a small pool of raw / refined / component materials the
  // cargo roll draws from. Non-empty by contract (the roller indexes into it).
  cargoPool: LootMaterialEntry[];
  // How many INDEPENDENT cargo picks the roll makes (each pick indexes cargoPool
  // uniformly, then rolls that entry's qty). 1..2 keeps a wreck's cargo "a small
  // roll" (design S12). cargoPicksMin <= cargoPicksMax.
  cargoPicksMin: number;
  cargoPicksMax: number;
  // Credit BOUNTY band for the wave (one inclusive roll). creditsMin <= creditsMax.
  creditsMin: number;
  creditsMax: number;
  // Flat XP awards per WON wave (NOT per tick). These ride the EXISTING captain +
  // Fleet Admiral XP tracks in tick.ts; there is no standalone combat XP bar.
  // Flat (no draw) so they stay trivially closed-form under batching.
  captainXpPerWave: number;
  fleetAdminXpPerWave: number;
  // RESERVED (DEFERRED, design S12): a guaranteed "Damaged [System]"
  // reverse-engineering component, e.g.
  //   damagedSystem?: LootMaterialEntry;
  // OMITTED until weapon crafting exists (the item + its reverse-engineer recipe do
  // not exist yet, so emitting it would be dead inventory). Add the field + a draw
  // in rollWaveLoot when that lands.
}

// The concrete reward one won wave produced. materials is itemId -> INTEGER qty
// (the caller wraps these in Decimal at the inventory boundary, matching how
// extraction loot is represented). credits is an integer bounty; the two XP fields
// are the flat per-wave awards copied from the table.
export interface WaveLoot {
  materials: Record<string, number>;
  credits: number;
  captainXp: number;
  fleetAdminXp: number;
}

// ----------------------------------------------------------------------------
// The roller. PURE function of (table, seed). Draw order is FIXED and documented
// so the sequence is hand-traceable and stable (reordering draws would silently
// change every seeded reward and break replay/parity).
// ----------------------------------------------------------------------------
export function rollWaveLoot(table: PatrolLootTable, seed: number): WaveLoot {
  // One fresh combat-PRNG stream seeded off THIS wave's loot seed. Because the seed
  // is a pure function of (masterSeed, waveIndex) with a distinct loot salt (caller
  // side), this stream is fully decorrelated from the enemy-gen and battle streams
  // of the same wave, so loot does not correlate with which enemies spawned or how
  // the fight played out.
  const rng = makeRng(seed);

  // Accumulate into a plain integer map; the caller converts to Decimal once, at the
  // homePlanetDelta boundary, exactly like extraction loot.
  const materials: Record<string, number> = {};

  // --- Draw 1: the guaranteed salvaged-material qty. ---------------------------
  const salvageQty = rng.nextRange(table.salvage.minQty, table.salvage.maxQty);
  materials[table.salvage.itemId] = (materials[table.salvage.itemId] ?? 0) + salvageQty;

  // --- Draw 2: how many cargo picks this wreck yields (a "small roll"). --------
  const picks = rng.nextRange(table.cargoPicksMin, table.cargoPicksMax);
  // --- Draws 3..: per pick, an index into the pool then that entry's qty. ------
  // Two draws per pick, in this order, so the count of rng steps is a pure function
  // of `picks` (predictable for hand-tracing). A repeated itemId simply stacks.
  for (let i = 0; i < picks; i++) {
    const entry = table.cargoPool[rng.nextInt(table.cargoPool.length)];
    const qty = rng.nextRange(entry.minQty, entry.maxQty);
    materials[entry.itemId] = (materials[entry.itemId] ?? 0) + qty;
  }

  // --- Final draw: the credit bounty. ------------------------------------------
  const credits = rng.nextRange(table.creditsMin, table.creditsMax);

  // XP is flat (copied from the table, no draw), so it is trivially identical
  // whether one wave or many resolve in a call.
  return {
    materials,
    credits,
    captainXp: table.captainXpPerWave,
    fleetAdminXp: table.fleetAdminXpPerWave,
  };
}
