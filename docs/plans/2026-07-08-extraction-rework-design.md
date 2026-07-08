# Extraction Rework — Design

## Motivation

The Tick Granularity Rebalance (`tickDurationSeconds` 10→1) shipped `extractionRatePerTick` unchanged
at `10` and only grew `cargoCapacity` to `900`. This preserved per-tick roll math but got the wrong
axis: since ticks now fire 10x more often per real second, the real-time common-ore income rate
quietly became ~10x what it was before the whole tick-granularity change (10 units/tick × 10
ticks/second vs. the original 10 units/tick × 1 tick/10-seconds). While investigating this, the user
also wanted to redesign the underlying loot-tier mechanic itself: today's independent uncommon/rare
rolls (both can occur in the same tick, whatever hits is subtracted from a shared pool, common absorbs
the leftover) caps uncommon at 1-3 units and rare at a flat 1 unit regardless of the mission's actual
per-tick rate — an artificial ceiling the user wants removed.

## Core mechanic: single sequential-priority roll, no per-tier amount cap

Replace `rollExtractionTick`'s independent-and-subtractive mechanic with a sequential, mutually
exclusive roll every tick:

1. Roll for rare first (`rng() < effectiveRareChance`, same formula as today). If it hits, award the
   **full per-tick base amount** (`extractionRatePerTick`, scaled by `rareYieldMult`) in rare material.
   Stop — no common, no uncommon this tick.
2. If rare missed, roll for uncommon (`rng() < effectiveUncommonChance`, same formula as today). If it
   hits, award the full per-tick base amount (scaled by `uncommonYieldMult`) in uncommon material. Stop.
3. If both missed, award the full per-tick base amount (scaled by `commonYieldMult`) in common ore —
   guaranteed, no roll needed for this branch on the primary roll.

This removes the old 1-3-unit uncommon cap and the flat-1 rare cap entirely — whichever tier wins gets
the same full amount common would have gotten. `effectiveUncommonChance`/`effectiveRareChance` reuse
today's exact formulas (`missionDef.uncommonChance * (1 + uncommonChanceMult)`, clamped to 1, same for
rare) — no change to `MISSIONS`' `uncommonChance`/`rareChance` config values needed; at these small
magnitudes, "roll rare, then uncommon conditional on rare missing, else common" produces the same
effective odds as a true normalized three-way categorical split, without needing to renormalize
anything.

## Scaling fix

`extractionRatePerTick` drops from `10` to `1`, and `cargoCapacity` drops from `900` to `90` for both
missions (both divided by 10, keeping `requiredTicksForPhase("extracting", ...)` at exactly 90 ticks —
the mission-duration rebalance from the prior branch stays intact). With the new mechanic's guaranteed-
full-amount-per-tick shape, expected value per tick becomes `1 × (P(rare) + P(uncommon) + P(common)) =
1 × 1.0 = 1` — restoring the original ~1 unit/real-second baseline exactly, without needing to also
divide `uncommonChance`/`rareChance` (an earlier proposal, now unnecessary under this mechanic).

## Explicitly out of scope for THIS design (sequenced deliberately, per the user)

The user wants the drop-mechanic redesign shipped and settled on its own before any talent work layers
on top of it — two separate phases, not one combined branch:

- **This design covers only** the sequential-priority roll mechanic and the `extractionRatePerTick`/
  `cargoCapacity` scaling fix above.
- **Deferred to a follow-up design** (not lost, just sequenced after this ships): the new Resourcefulness
  branch bonus-roll talent (`{ type: "bonusRollChance"; chance: number }`, a second independent roll
  using the same rare/uncommon odds but only a 30% chance of common, so — unlike the guaranteed primary
  roll — it can genuinely whiff), plus whatever else the user means by "fully fleshed talent changes."
  Revisit once this extraction mechanic is live and settled.
- Cargo capacity becoming a real per-ship stat (tied to the not-yet-built Ships feature) — already
  logged to `SUGGESTIONS.md`.
- A third "farming efficiency" mission type with no transit/unload phases and an RNG-dependent stopping
  time (runs until cargo hold is full) — already logged to `SUGGESTIONS.md`, needs its own design pass
  for the closed-form/offline-catchup implications.

## Save/schema impact

None. `MISSIONS`' config values change (not persisted — no save migration needed, same as any past
`MISSIONS` tuning change). `CAPTAIN_TALENTS` gains one new key (talent-unlock lists are plain string-key
arrays; adding a new key needs no migration, same as every past talent addition). `mission.cargo`'s
shape (3 `Decimal` keys) is unchanged — only how it's computed changes.

## Testing note

`tick.test.ts`'s existing extraction-roll tests hand-trace exact rng() call sequences and expected
amounts against today's mechanic — all of those need rewriting for the new sequential-priority roll
(fewer possible rng() call counts per tick: 1 call if rare hits, 2 if it doesn't, plus 1 more for the
bonus-trigger check and up to 3 more if the bonus actually triggers). This is comparable in scope to the
tick.test.ts rewrites from the Loot Tier Rework and the Tick Granularity Rebalance branches.
