# Loot Tier Rework, Talent Split, Import Save — Design

## Context

Today's mission extraction (`tickCaptainMission` in `tick.ts`) rolls ONE material per tick from a
weighted table (`MissionDef.lootTable`) — a tick either produces `extractionRatePerTick` units of
commonOre, OR uncommonMaterial, OR rareMaterial, mutually exclusive. The user wants independent
per-tier drops instead: uncommon and rare can both occur in the same tick, each replacing that many
units of common ore rather than being additive on top. Example: base rate 10/tick, uncommon rolls 2
+ rare rolls 1 → 7 common + 2 uncommon + 1 rare (still 10 total).

This also requires reworking how the two already-shipped talent bonuses (`extractionYieldMult`,
`rareLootChanceMult`) apply, since they were designed around the old mutually-exclusive mechanic.
Bundled into the same pass: an Import Save feature (the counterpart to the existing Export Save),
and a versioning-scheme reset. All four pieces touch overlapping files (`model.ts`, `tick.ts`,
`App.svelte`), so this is one design/plan/branch, not four separate ones.

Node.js/npm/tsc remain unavailable in this environment — every verification step is manual code
tracing/hand-tracing math, never live execution. This rewrites the extraction algorithm at the
center of the game's economy, so treat every task here with the same care as the original mission
system's build (`docs/plans/2026-07-06-home-planet-expeditions-plan.md`).

## 1. Independent per-tier extraction rolls

`MissionDef` drops `lootTable: LootTableEntry[]` entirely, replaced by two chance fields:

```ts
export interface MissionDef {
  label: string;
  transitOutTicks: number;
  transitBackTicks: number;
  unloadTicks: number;
  extractionRatePerTick: number; // baseline TOTAL units/tick before uncommon/rare amounts carve into it
  cargoCapacity: number;
  uncommonChance: number; // 0-1, independent per-tick chance uncommon material occurs
  rareChance: number; // 0-1, independent per-tick chance rare material occurs
  tier: MissionTier;
}
```

Converted from the existing weights (out of 1000): `shortOreRun` → `uncommonChance: 0.019, rareChance:
0.001` (98%/1.9%/0.1%); `longOreRun` → `uncommonChance: 0.08, rareChance: 0.02` (90%/8%/2%) — same
per-mission tuning as today, just expressed as independent chances instead of pick-weights.

**Per-tick roll algorithm** (replaces `rollLootTable`/the old `effectiveLootTable` mechanism
entirely — both get deleted):

1. Roll whether uncommon occurs this tick: `rng() < effectiveUncommonChance`.
2. If it occurs, roll its base amount: 75% chance of 1, 20% chance of 2, 5% chance of 3.
3. Roll whether rare occurs this tick: `rng() < effectiveRareChance` (independent of step 1 — both,
   either, or neither can occur in the same tick, matching the user's own worked example).
4. If it occurs, its base amount is always 1.
5. `commonOre = max(0, extractionRatePerTick - uncommonAmount - rareAmount)`.

Each of the 3 rng() calls (uncommon-occurrence, uncommon-amount-if-occurred, rare-occurrence) happens
in a fixed, documented order — this matters for anyone hand-tracing a deterministic test rng, and
for preserving the closed-form "one big tick == many small ticks" guarantee (tests must use a
CONSTANT rng function, not a stateful/sequence-consuming one, so the exact call count per chunking
doesn't matter — same convention this codebase's existing closed-form tests already use).

## 2. Talent bonuses split by tier

The single `rareLootChanceMult`/`extractionYieldMult` effect types are replaced by 5 tier-specific
ones:

```ts
export type CaptainTalentEffect =
  | { type: "commonYieldMult"; mult: number }
  | { type: "uncommonYieldMult"; mult: number }
  | { type: "uncommonChanceMult"; mult: number }
  | { type: "rareChanceMult"; mult: number };

export type HomeworldTalentEffect =
  | { type: "unlockCaptainSlot" }
  | { type: "rareYieldMult"; mult: number }
  | { type: "recipeBonusOutput"; recipeKey: RecipeKey; bonus: number }
  | { type: "passiveTrickle"; material: HomePlanetMaterialKey; perTick: number };
```

**Existing node re-mapping** (confirmed with the user — these are the SAME 3 already-shipped nodes,
retargeted, not new nodes):
- **Command Efficiency I** (`commandExtractionI`): `extractionYieldMult 0.10` → `commonYieldMult 0.10`.
- **Command Efficiency II** (`commandExtractionII`): `extractionYieldMult 0.15` → `uncommonYieldMult 0.15`.
- **Keen Eye I** (`resourcefulnessRareChanceI`): `rareLootChanceMult 0.25` → `uncommonChanceMult 0.25`.
- **Keen Eye II** (`resourcefulnessRareChanceII`): `rareLootChanceMult 0.5` → `rareChanceMult 0.5`.
- **Fleet Requisitions** (`fleetLogisticsYield`, Homeworld): `fleetExtractionYieldMult 0.05` →
  `rareYieldMult 0.05`.

No new talent nodes are added — same tree shape, same costs, same prerequisites, just different
`effect.type`/target. Every existing `unlockedCaptainTalents`/`unlockedHomeworldTalents` save data is
unaffected (those arrays store KEYS, not effect shapes — a player who already unlocked Keen Eye I
keeps it unlocked, it just does something different now).

**Applying the bonuses** (replaces `captainExtractionYieldMult`/`captainRareLootChanceMult`/
`fleetExtractionYieldMult`/`applyRareLootChanceMult` in `tick.ts` with 5 new helper functions, one
per effect type, same additive-stacking/read-at-usage-time pattern as today):

- `uncommonChance`/`rareChance` (mission baseline) are each multiplied by `(1 + chanceMult)`, clamped
  to a max of 1.0 (100%) — a chance can never exceed certain.
- `commonYieldMult` scales the LEFTOVER common amount (step 5 above) — i.e. it can push total
  per-tick delivery above `extractionRatePerTick`, intentionally (this is what "more efficient common
  extraction" should feel like).
- `uncommonYieldMult`/`rareYieldMult` scale their own tier's rolled amount, only when that tier
  actually occurred this tick (no occurrence, no amount to scale).

## 3. Import Save

Counterpart to the existing Export Save button (Options). New `save.ts` function:

```ts
export function importRawSave(raw: string): boolean {
  const save = deserialize(raw);
  if (!save) return false;
  try {
    localStorage.setItem(SAVE_KEY, raw);
    localStorage.setItem(`${SAVE_KEY}_created_at`, String(save.created_at));
    return true;
  } catch {
    return false;
  }
}
```

Validates the file actually deserializes (rejects garbage/corrupt input) before writing anything.
Writes the RAW string as-is (same LZ-compressed-base64 shape Export produces) rather than
re-serializing, avoiding any risk of the migrate/re-serialize round-trip silently changing the
save's shape before it's even loaded.

**UI**: a file input next to Export Save. Selecting a file reads its text, then opens a confirmation
modal (reusing the existing `.modal-backdrop`/`Panel.modal-dialog` pattern — same shape as Delete
Save, but a plain Cancel/Import confirm, no typed-safety-word gate, since this is a deliberate
file-pick action, not an irreversible in-place delete with no other recovery path). On confirm,
`importRawSave()` runs; on success, `window.location.reload()` — the simplest way to get every
derived/init-time value (in-memory `state`, `createdAt`, tick-loop timers) to reset cleanly from the
just-imported save, matching the existing "load happens once, at mount" pattern rather than adding a
second "hot-swap state mid-session" code path. On failure (corrupt/invalid file), the modal shows an
inline error instead of closing.

## 4. Versioning reset

`APP_VERSION` resets to `0.2.0` for this release (existing `0.6.0`-`0.9.0` `PATCH_NOTES` history
stays untouched, per the established "don't rewrite patch-note history" rule). Going forward:
minor/fix-only releases bump the last digit (`0.2.1`, `0.2.2`, ...), feature releases bump the middle
digit (`0.3.0`, ...). Flagged to the user and accepted: this produces a one-time visual oddity where
`0.2.0` (newest, top of the list) sits above `0.9.0` (older, per the existing "newest entry first"
convention) — an intentional reset marker, not a bug.

## Testing approach

No Node/npm/tsc/dev-server in this environment. The ENTIRE existing `"tickCaptainMission —
extraction loot rolls"` test block exercises the mechanic being replaced and will be rewritten from
scratch, not patched — the underlying algorithm no longer exists in the same shape. New tests use
constant (non-stateful) rng functions per scenario, hand-traced against the exact call-order
documented in section 1, so deterministic outcomes can be reasoned about by a human reader without
running the suite. A live-device/browser check of the mission-card and captain-popup preview numbers
is needed once deployed, same as every other UI change this session.
