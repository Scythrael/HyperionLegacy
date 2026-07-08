# Resourcefulness Bonus Roll — Design

## Motivation

During the Extraction Rework brainstorm (docs/plans/2026-07-08-extraction-rework-design.md), the user
proposed a Resourcer-exclusive bonus-roll captain talent: a second, independent chance at loot each tick,
on top of the primary sequential roll that branch shipped. The user explicitly required the drop-mechanic
redesign to ship fully on its own first — this design picks up the deferred talent work now that it has.

## Core mechanic: independent bonus-roll trigger, mini rare→uncommon→common(30%) sequence

After the primary roll (rare → uncommon → common, guaranteed) resolves for a tick, a **separate** trigger
check fires every tick, regardless of what the primary rolled:

1. `effectiveBonusRollChance = min(1, bonusRollChance * (1 + bonusRollChanceMult))` — 1 `rng()` call.
2. If it fires, a mini-sequence runs, reusing the mission's own rare/uncommon odds (same
   `effectiveRareChance`/`effectiveUncommonChance` formulas as the primary roll, so existing
   `rareChanceMult`/`uncommonChanceMult` talents affect the bonus roll too): rare check → if miss,
   uncommon check → if miss, a **30% chance** check for common (not guaranteed, unlike the primary). If
   all three miss, the bonus roll produces nothing this tick.
3. Whichever tier wins (if any) receives the **same full `extractionRatePerTick` amount**, scaled by that
   tier's own yieldMult — identical treatment to the primary roll, just via a second, independent draw.

A tick can consume 3 `rng()` calls (primary resolves in 2, bonus trigger check fails) up to 6 (primary 2 +
trigger 1 + bonus's own rare/uncommon/common-30% sequence all miss).

## Data model

Two new `CaptainTalentEffect` union members:

```ts
| { type: "bonusRollChance"; chance: number }
| { type: "bonusRollChanceMult"; mult: number }
```

Two new `CaptainTalentKey` entries, continuing the `resourcefulness` branch's existing chain:

```ts
resourcefulnessBonusRollI: {
  branch: "resourcefulness", label: "Lucky Strike I", cost: 6,
  requires: "resourcefulnessRareChanceII",
  effect: { type: "bonusRollChance", chance: 0.02 },
},
resourcefulnessBonusRollII: {
  branch: "resourcefulness", label: "Lucky Strike II", cost: 8,
  requires: "resourcefulnessBonusRollI",
  effect: { type: "bonusRollChanceMult", mult: 1.0 },
},
```

Effective trigger chance: `0.02` with only node I, `0.02 * (1 + 1.0) = 0.04` with both — 2%/4%,
matching the user's target (roughly 4 expected bonus procs per 100-tick extraction phase at 4%).

## Extraction algorithm (tick.ts)

Two new stacking helpers, same additive-sum, read-at-usage-time pattern as the existing five
(`captainCommonYieldMult`/`captainUncommonYieldMult`/`captainUncommonChanceMult`/`captainRareChanceMult`/
`fleetRareYieldMult`):

```ts
captainBonusRollChance(captain)      // sums "bonusRollChance" effect's chance field
captainBonusRollChanceMult(captain)  // sums "bonusRollChanceMult" effect's mult field
```

`resolvedBonuses` (computed once per `tickCaptainMission` call, unchanged closed-form guarantee) gains
these 2 fields alongside the existing 5. Inside the extraction loop, after the primary `rollExtractionTick`
call resolves and its delta is added to cargo, the bonus check described above runs and, if it produces a
nonzero delta, that delta is added to cargo too (same `.plus()` accumulation as the primary).

## UI (App.svelte)

Two changes, both in the mission-preview popup block (~line 1282-1285):

- Fix the stale drop-rate text, which still describes the OLD (pre-Extraction-Rework) mechanic
  ("Uncommon Material: 1-3/tick", "Rare Material: 1/tick") — this text was not updated when the Extraction
  Rework shipped and is now factually wrong (both tiers deliver the FULL `extractionRatePerTick` amount
  when they win, not a capped bucket/flat amount). Reword to describe the current mechanic.
- Add a new line showing the bonus-roll trigger chance when the selected captain has any
  `bonusRollChance`-granting talent unlocked, computed via `captainBonusRollChance`/
  `captainBonusRollChanceMult`, same display pattern as the existing chance lines.

The Captain Talents panel itself needs no markup changes — it already iterates `CAPTAIN_TALENTS` by
branch, so the two new `resourcefulness` nodes render automatically.

## Testing

`tick.test.ts` needs new hand-traced tests for: the bonus-roll trigger chance/mult helpers, the bonus
roll's own rare→uncommon→common(30%) mini-sequence (each branch of it, plus the "all three miss, no bonus
delta" case), and its interaction with the primary roll within one whole tick (both deltas accumulate).
`model.test.ts` needs new assertions for the two new `CAPTAIN_TALENTS` entries (cost, prerequisite chain,
effect shape).

## Save/schema impact

None. `unlockedCaptainTalents` is a plain string-key array; adding two new keys needs no migration, same
as every past Captain Talent addition.

## Explicitly out of scope for THIS design

Unchanged from the Extraction Rework's own deferral list: ships, ship-stat cargo capacity, and the third
"farming efficiency" mission type. None of those are touched by this branch.
