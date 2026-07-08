# Resourcefulness Bonus Roll Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a Resourcer-exclusive Captain Talent pair that grants a chance at a second, independent
loot roll each extraction tick, and fix a stale UI text bug the Extraction Rework left behind.

**Architecture:** Two new `CaptainTalentEffect` types (`bonusRollChance`, `bonusRollChanceMult`) and two
new `CAPTAIN_TALENTS` entries drive a new `rollBonusExtractionTick` helper in `tick.ts`, called once per
whole extraction tick right after the existing `rollExtractionTick` primary roll. The bonus roll reuses
the primary roll's own `effectiveRareChance`/`effectiveUncommonChance` formulas but replaces the
guaranteed-common floor with a 30%-chance common check, so it can whiff. `App.svelte`'s mission-preview
popup gets both a bugfix (stale drop-rate text from before the Extraction Rework) and a new bonus-roll
display line.

**Tech Stack:** Vite + Svelte + TypeScript, Vitest (present but not executable in this environment -- no
Node/npm/tsc available; every task is verified by manual hand-trace, same as every prior feature this
session).

---

### Task 0: Set up git worktree

**REQUIRED SUB-SKILL:** Use superpowers:using-git-worktrees.

Create worktree at `.worktrees/feat-resourcefulness-bonus-roll` on new branch
`feat/resourcefulness-bonus-roll`, branched from `main` (confirm exact current commit via
`git log --oneline -1` before branching -- should be at or after `b81cef4`, the design-doc commit).
`.worktrees/` is already gitignored. No `npm install` step -- no usable Node/npm in this environment.

---

### Task 1: `model.ts` -- new effect types and talent nodes

**Files:** Modify `src/lib/game/model.ts` (read the current file yourself first -- do not trust line
numbers here, they may have drifted since this plan was written; as of this plan, `CaptainTalentEffect` is
at line 220 and `CAPTAIN_TALENTS`'s `resourcefulnessRareChanceII` entry ends around line 304).

**Step 1:** Add two new members to the `CaptainTalentEffect` union (currently 4 members: `commonYieldMult`,
`uncommonYieldMult`, `uncommonChanceMult`, `rareChanceMult`):

```ts
export type CaptainTalentEffect =
  | { type: "commonYieldMult"; mult: number }
  | { type: "uncommonYieldMult"; mult: number }
  | { type: "uncommonChanceMult"; mult: number }
  | { type: "rareChanceMult"; mult: number }
  | { type: "bonusRollChance"; chance: number }
  | { type: "bonusRollChanceMult"; mult: number };
```

**Step 2:** Add two new keys to the `CaptainTalentKey` union (find the existing union with
`commandExtractionI` / `commandExtractionII` / `resourcefulnessRareChanceI` / `resourcefulnessRareChanceII`):

```ts
export type CaptainTalentKey =
  | "commandExtractionI"
  | "commandExtractionII"
  | "resourcefulnessRareChanceI"
  | "resourcefulnessRareChanceII"
  | "resourcefulnessBonusRollI"
  | "resourcefulnessBonusRollII";
```

**Step 3:** Add two new entries to `CAPTAIN_TALENTS`, immediately after `resourcefulnessRareChanceII`:

```ts
  resourcefulnessBonusRollI: {
    branch: "resourcefulness",
    label: "Lucky Strike I",
    cost: 6,
    requires: "resourcefulnessRareChanceII",
    effect: { type: "bonusRollChance", chance: 0.02 },
  },
  resourcefulnessBonusRollII: {
    branch: "resourcefulness",
    label: "Lucky Strike II",
    cost: 8,
    requires: "resourcefulnessBonusRollI",
    effect: { type: "bonusRollChanceMult", mult: 1.0 },
  },
```

**Step 4 -- verify by hand-trace:** Confirm `resourcefulnessBonusRollI.requires` points to a valid
existing key (`resourcefulnessRareChanceII`), and `resourcefulnessBonusRollII.requires` points to the
new `resourcefulnessBonusRollI` key -- both same-branch, matching every other talent's prerequisite
convention. Confirm effective trigger chance with both unlocked: `0.02 * (1 + 1.0) = 0.04` (4%), and with
only node I: `0.02 * (1 + 0) = 0.02` (2%) -- matches the design doc's target exactly.

**Step 5:** Commit.

```bash
git add src/lib/game/model.ts
git commit -m "feat: add bonusRollChance/bonusRollChanceMult effect types and Resourcefulness nodes"
```

---

### Task 2: `model.test.ts` -- new coverage for the two new nodes

**Files:** Modify `src/lib/game/model.test.ts` (read it fresh -- it's short). As of this plan, the
`CAPTAIN_TALENTS — launch set` describe block (around line 176) only asserts branch-level counts
generically (e.g. `resourcefulness` branch has `> 0` nodes) -- there is no existing per-node
cost/requires/effect assertion pattern for individual Captain Talents to mirror. The closest precedent is
the `HOMEWORLD_TALENTS — launch set` block's `"Fleet Logistics has exactly 3 unlockCaptainSlot nodes"`
test (around line 197), which asserts a specific effect-type COUNT within a branch.

**Step 1:** Add a new test inside the `CAPTAIN_TALENTS — launch set` describe block, mirroring that
Homeworld Talents precedent's shape:

```ts
  it("Resourcefulness has exactly 1 bonusRollChance node and 1 bonusRollChanceMult node", () => {
    const bonusRollChanceNodes = Object.values(CAPTAIN_TALENTS).filter((t) => t.effect.type === "bonusRollChance");
    const bonusRollChanceMultNodes = Object.values(CAPTAIN_TALENTS).filter((t) => t.effect.type === "bonusRollChanceMult");
    expect(bonusRollChanceNodes).toHaveLength(1);
    expect(bonusRollChanceMultNodes).toHaveLength(1);
  });
```

**Step 2:** Add a second test confirming the exact new entries' shape (cost/requires/effect), since this
is new launch content, not just a count:

```ts
  it("resourcefulnessBonusRollI/II have the expected cost, prerequisite chain, and effect values", () => {
    expect(CAPTAIN_TALENTS.resourcefulnessBonusRollI.cost).toBe(6);
    expect(CAPTAIN_TALENTS.resourcefulnessBonusRollI.requires).toBe("resourcefulnessRareChanceII");
    expect(CAPTAIN_TALENTS.resourcefulnessBonusRollI.effect).toEqual({ type: "bonusRollChance", chance: 0.02 });

    expect(CAPTAIN_TALENTS.resourcefulnessBonusRollII.cost).toBe(8);
    expect(CAPTAIN_TALENTS.resourcefulnessBonusRollII.requires).toBe("resourcefulnessBonusRollI");
    expect(CAPTAIN_TALENTS.resourcefulnessBonusRollII.effect).toEqual({ type: "bonusRollChanceMult", mult: 1.0 });
  });
```

**Step 3:** Commit.

```bash
git add src/lib/game/model.test.ts
git commit -m "test: add model.test.ts coverage for the new Resourcefulness bonus-roll nodes"
```

---

### Task 3: `tick.ts` -- stacking helpers + bonus-roll algorithm

**Files:** Modify `src/lib/game/tick.ts` (read the current file yourself first -- do not trust line
numbers here, they may have drifted). As of this plan: `captainRareChanceMult` (the last of the 5 existing
per-captain stacking helpers) is at line 84; `rollExtractionTick` starts at line 170; `tickCaptainMission`'s
`bonuses` parameter type is at lines 217-226; `resolvedBonuses` is built at lines 249-255; the extraction
loop's primary roll call is `const delta = rollExtractionTick(missionDef, resolvedBonuses, rng);` at line
282, inside a `for (let i = 0; i < rollsThisStep; i++)` loop (line 281) that adds `delta`'s 3 fields onto
`mission.cargo` (lines 283-285); `tick()`'s own `bonuses` object (the per-captain summed-helpers object
passed into `tickCaptainMission`) is built at lines 420-426.

**Step 1: Add two new stacking helpers**, immediately after `captainRareChanceMult` (after line ~89, before
the `fleetRareYieldMult` function):

```ts
// Same additive-stacking, read-at-usage-time pattern as the helpers above,
// for the bonus-roll TRIGGER chance (the base value from resourcefulnessBonusRollI --
// NOT a multiplier on an existing mission-defined chance, since there is no
// mission-level "bonus roll chance" to scale; this creates the chance from
// nothing, so summing raw values is the only mechanically coherent stacking
// rule, same as every other additive helper in this file). Note this effect's
// field is named `chance`, not `mult` -- unlike every OTHER effect type in
// this file, since bonusRollChance is a base value, not itself a multiplier.
export function captainBonusRollChance(captain: CaptainState): number {
  return captain.unlockedCaptainTalents.reduce((sum, key) => {
    const effect = CAPTAIN_TALENTS[key].effect;
    return effect.type === "bonusRollChance" ? sum + effect.chance : sum;
  }, 0);
}

// Relative multiplier applied ON TOP of captainBonusRollChance's base value
// (resourcefulnessBonusRollII) -- same Math.min(1, base * (1 + mult)) shape
// every other chance-mult effect in this file already uses (see
// effectiveUncommonChance/effectiveRareChance in rollExtractionTick below).
export function captainBonusRollChanceMult(captain: CaptainState): number {
  return captain.unlockedCaptainTalents.reduce((sum, key) => {
    const effect = CAPTAIN_TALENTS[key].effect;
    return effect.type === "bonusRollChanceMult" ? sum + effect.mult : sum;
  }, 0);
}
```

**Field-name trap to watch for:** `bonusRollChance`'s effect member has a `chance` field (matching Task
1's union definition), while `bonusRollChanceMult`'s has a `mult` field like every other Mult-suffixed
effect in this file -- the two helpers above read different field names from their respective effect
types. Double-check this against the live `CaptainTalentEffect` union before committing, since it's an
easy copy/paste slip from the other 4 (all-`mult`) helpers.

**Step 2: Add a new `rollBonusExtractionTick` function**, immediately after `rollExtractionTick` (after its
closing brace, before the `tickCaptainMission` MUST-be-closed-form comment block):

```ts
// The bonus roll (Resourcefulness's Lucky Strike I/II) reuses the PRIMARY
// roll's own effectiveRareChance/effectiveUncommonChance formulas (so
// rareChanceMult/uncommonChanceMult talents boost the bonus roll too), but
// replaces the primary roll's guaranteed-common floor with a 30% CHANCE at
// common -- unlike rollExtractionTick, this roll can produce NOTHING. Called
// only when the separate bonus-roll TRIGGER check (captainBonusRollChance/
// captainBonusRollChanceMult, checked by the caller BEFORE this function is
// invoked) has already succeeded -- this function itself has no trigger
// check of its own, it IS the mini-sequence that runs once triggered.
//
// Up to 3 rng() calls (rare, then uncommon, then the 30% common check), same
// early-return-per-branch shape as rollExtractionTick, so the two functions'
// combined call count per whole tick stays easy to hand-trace: 1 (bonus
// trigger check, made by the caller) + up to 3 (this function) on top of
// rollExtractionTick's own 1-2, for a range of 3-6 total rng() calls per
// tick depending on outcomes.
const BONUS_ROLL_COMMON_CHANCE = 0.3;

function rollBonusExtractionTick(
  missionDef: MissionDef,
  bonuses: {
    commonYieldMult: number;
    uncommonYieldMult: number;
    uncommonChanceMult: number;
    rareYieldMult: number;
    rareChanceMult: number;
  },
  rng: () => number
): Record<LootMaterialKey, Decimal> {
  const effectiveUncommonChance = Math.min(1, missionDef.uncommonChance * (1 + bonuses.uncommonChanceMult));
  const effectiveRareChance = Math.min(1, missionDef.rareChance * (1 + bonuses.rareChanceMult));
  const baseAmount = new Decimal(missionDef.extractionRatePerTick);

  if (rng() < effectiveRareChance) {
    return { commonOre: new Decimal(0), uncommonMaterial: new Decimal(0), rareMaterial: baseAmount.times(1 + bonuses.rareYieldMult) };
  }
  if (rng() < effectiveUncommonChance) {
    return { commonOre: new Decimal(0), uncommonMaterial: baseAmount.times(1 + bonuses.uncommonYieldMult), rareMaterial: new Decimal(0) };
  }
  if (rng() < BONUS_ROLL_COMMON_CHANCE) {
    return { commonOre: baseAmount.times(1 + bonuses.commonYieldMult), uncommonMaterial: new Decimal(0), rareMaterial: new Decimal(0) };
  }
  return emptyLootTotals(); // all three missed -- the bonus roll produces nothing this tick
}
```

**Step 3: Extend `tickCaptainMission`'s `bonuses` parameter type** (lines 217-226) to add the 2 new
optional fields, and extend `resolvedBonuses` (lines 249-255) to resolve them with the same `?? 0`
fallback pattern as the existing 5:

```ts
  bonuses: {
    commonYieldMult?: number;
    uncommonYieldMult?: number;
    uncommonChanceMult?: number;
    rareYieldMult?: number;
    rareChanceMult?: number;
    bonusRollChance?: number;
    bonusRollChanceMult?: number;
  } = {}
```

```ts
  const resolvedBonuses = {
    commonYieldMult: bonuses.commonYieldMult ?? 0,
    uncommonYieldMult: bonuses.uncommonYieldMult ?? 0,
    uncommonChanceMult: bonuses.uncommonChanceMult ?? 0,
    rareYieldMult: bonuses.rareYieldMult ?? 0,
    rareChanceMult: bonuses.rareChanceMult ?? 0,
    bonusRollChance: bonuses.bonusRollChance ?? 0,
    bonusRollChanceMult: bonuses.bonusRollChanceMult ?? 0,
  };
```

**Step 4: Wire the bonus-roll check into the extraction loop.** Modify the `for` loop at line 281 (currently
only calls `rollExtractionTick` and adds its delta) to also run the bonus-roll trigger check and, if it
fires, call `rollBonusExtractionTick` and add ITS delta too:

```ts
      for (let i = 0; i < rollsThisStep; i++) {
        const delta = rollExtractionTick(missionDef, resolvedBonuses, rng);
        mission.cargo.commonOre = mission.cargo.commonOre.plus(delta.commonOre);
        mission.cargo.uncommonMaterial = mission.cargo.uncommonMaterial.plus(delta.uncommonMaterial);
        mission.cargo.rareMaterial = mission.cargo.rareMaterial.plus(delta.rareMaterial);

        // Bonus-roll trigger check runs every whole tick, independent of what
        // the primary roll above produced (see rollBonusExtractionTick's own
        // comment for why). 1 rng() call for the trigger itself; if it
        // fires, rollBonusExtractionTick makes up to 3 more.
        const effectiveBonusRollChance = Math.min(
          1,
          resolvedBonuses.bonusRollChance * (1 + resolvedBonuses.bonusRollChanceMult)
        );
        if (rng() < effectiveBonusRollChance) {
          const bonusDelta = rollBonusExtractionTick(missionDef, resolvedBonuses, rng);
          mission.cargo.commonOre = mission.cargo.commonOre.plus(bonusDelta.commonOre);
          mission.cargo.uncommonMaterial = mission.cargo.uncommonMaterial.plus(bonusDelta.uncommonMaterial);
          mission.cargo.rareMaterial = mission.cargo.rareMaterial.plus(bonusDelta.rareMaterial);
        }
      }
```

**Step 5: Wire the two new helpers into `tick()`'s own `bonuses` object** (lines 420-426) -- both are
per-captain (not fleet-wide, no Homeworld Talent grants either effect type today), same treatment as
`commonYieldMult`/`uncommonYieldMult`/`uncommonChanceMult`/`rareChanceMult`:

```ts
    const bonuses = {
      commonYieldMult: captainCommonYieldMult(captain),
      uncommonYieldMult: captainUncommonYieldMult(captain),
      uncommonChanceMult: captainUncommonChanceMult(captain),
      rareYieldMult: fleetRareYield,
      rareChanceMult: captainRareChanceMult(captain),
      bonusRollChance: captainBonusRollChance(captain),
      bonusRollChanceMult: captainBonusRollChanceMult(captain),
    };
```

**Step 6 -- verify by hand-trace before committing:** Confirm these scenarios against your actual new
code:
   (a) A captain with `resourcefulnessBonusRollI` only (chance 0.02) and a constant rng of `0.5` on
   shortOreRun (rareChance 0.001, uncommonChance 0.019): primary roll -- `0.5 < 0.001`? no, `0.5 < 0.019`?
   no -> common wins, amount 1. Bonus trigger check -- `effectiveBonusRollChance = 0.02 * (1+0) = 0.02`,
   `0.5 < 0.02`? no -> bonus roll never fires, no `rollBonusExtractionTick` call at all (only 3 total
   rng() calls this tick: 2 for the primary, 1 for the trigger check).
   (b) Same captain/mission, constant rng of `0.01`: primary roll -- `0.01 < 0.001`? no, `0.01 < 0.019`?
   yes -> uncommon wins, amount 1.5 if `uncommonYieldMult` were set (0 here, so 1). Bonus trigger check --
   `0.01 < 0.02`? yes -> fires. `rollBonusExtractionTick` runs: rare check `0.01 < 0.001`? no. uncommon
   check `0.01 < 0.019`? yes -> bonus uncommon wins too, amount 1. Total delivered this tick:
   `uncommonMaterial = 1 (primary) + 1 (bonus) = 2`, `commonOre = 0`, `rareMaterial = 0`. Confirm this is
   exactly what your code produces by tracing the actual function calls in order.
   (c) Confirm a captain with NO Resourcefulness bonus-roll talents unlocked (`bonusRollChance` and
   `bonusRollChanceMult` both resolve to `0` via the `?? 0` fallback) never triggers the bonus check
   regardless of rng value (`effectiveBonusRollChance` is always exactly `0`, and `rng() < 0` is never true
   for any rng() implementation returning `[0, 1)`) -- confirms this feature is fully inert for every
   existing captain/save with no behavior change unless the new talents are actually purchased.

**Step 7:** Commit.

```bash
git add src/lib/game/tick.ts
git commit -m "feat: add rollBonusExtractionTick and wire the bonus-roll trigger into tickCaptainMission/tick()"
```

---

### Task 4: `tick.test.ts` -- new hand-traced tests

**Files:** Modify `src/lib/game/tick.test.ts` (read the current "extraction loot rolls" describe block
fresh -- just rewritten in the Extraction Rework branch -- to match its established hand-trace comment
style and constant-rng conventions exactly).

**Step 1: Add tests for the 2 new stacking helpers**, in the same describe block as the existing 5 helper
tests (`captainCommonYieldMult`/`captainUncommonYieldMult`/`captainUncommonChanceMult`/
`captainRareChanceMult`/`fleetRareYieldMult` -- find this block and mirror its exact test shape):

```ts
  it("captainBonusRollChance sums bonusRollChance across unlocked talents", () => {
    const captain = freshCaptains(1)[0];
    expect(captainBonusRollChance(captain)).toBe(0);
    captain.unlockedCaptainTalents = ["resourcefulnessBonusRollI"];
    expect(captainBonusRollChance(captain)).toBe(0.02);
  });

  it("captainBonusRollChanceMult sums bonusRollChanceMult across unlocked talents", () => {
    const captain = freshCaptains(1)[0];
    expect(captainBonusRollChanceMult(captain)).toBe(0);
    captain.unlockedCaptainTalents = ["resourcefulnessBonusRollII"];
    expect(captainBonusRollChanceMult(captain)).toBe(1.0);
  });
```

**Step 2: Add a new describe block for the bonus-roll mechanic**, immediately after the "extraction loot
rolls" describe block, testing `tickCaptainMission` directly (same level as that block, not `tick()`, so
bonuses can be passed explicitly without needing talents unlocked on a captain object):

```ts
describe("tickCaptainMission — bonus roll (Resourcefulness Lucky Strike)", () => {
  it("bonus trigger check fails: only the primary roll's delta is added, no extra rng() calls consumed", () => {
    const base = freshCaptains(1)[0];
    base.mission = { ...missionCaptain(), phase: "extracting", phaseProgressTicks: 0 };
    // shortOreRun, rng constant 0.5: primary rare/uncommon both fail (0.5 < 0.001? no, 0.5 < 0.019? no)
    // -> common wins, amount 1. Bonus trigger: effectiveBonusRollChance = 0.02*(1+0) = 0.02, 0.5 < 0.02?
    // no -> bonus never fires. Total: commonOre 1, uncommon/rare both 0.
    const { captain } = tickCaptainMission(1, base, () => 0.5, { bonusRollChance: 0.02 });
    expect(captain.mission!.cargo.commonOre.equals(1)).toBe(true);
    expect(captain.mission!.cargo.uncommonMaterial.equals(0)).toBe(true);
    expect(captain.mission!.cargo.rareMaterial.equals(0)).toBe(true);
  });

  it("bonus trigger fires and its own mini-sequence lands on rare", () => {
    const base = freshCaptains(1)[0];
    base.mission = { ...missionCaptain(), phase: "extracting", phaseProgressTicks: 0 };
    // A constant rng of 0.0005 (shortOreRun rareChance 0.001): primary roll call 1 (rare) -- 0.0005 <
    // 0.001 -> true, primary rare wins, amount 1, only 1 rng() call for the primary. Bonus trigger check
    // (call 2): effectiveBonusRollChance = 0.02*(1+0) = 0.02, 0.0005 < 0.02 -> true, bonus fires. Bonus
    // mini-sequence call 3 (rare): 0.0005 < 0.001 -> true, bonus ALSO lands rare, amount 1. Total:
    // rareMaterial = 1 (primary) + 1 (bonus) = 2, commonOre/uncommonMaterial both 0.
    const { captain } = tickCaptainMission(1, base, () => 0.0005, { bonusRollChance: 0.02 });
    expect(captain.mission!.cargo.rareMaterial.equals(2)).toBe(true);
    expect(captain.mission!.cargo.commonOre.equals(0)).toBe(true);
    expect(captain.mission!.cargo.uncommonMaterial.equals(0)).toBe(true);
  });

  it("bonus trigger fires and its own mini-sequence lands on uncommon", () => {
    const base = freshCaptains(1)[0];
    base.mission = { ...missionCaptain(), phase: "extracting", phaseProgressTicks: 0 };
    // A constant rng of 0.01 (shortOreRun rareChance 0.001, uncommonChance 0.019): primary roll -- rare
    // 0.01 < 0.001? no. uncommon 0.01 < 0.019? yes -> primary uncommon wins, amount 1 (2 rng() calls).
    // Bonus trigger (call 3): 0.01 < 0.02 -> true, fires. Bonus mini-sequence -- rare (call 4) 0.01 <
    // 0.001? no. uncommon (call 5) 0.01 < 0.019? yes -> bonus ALSO lands uncommon, amount 1. Total:
    // uncommonMaterial = 1 (primary) + 1 (bonus) = 2, commonOre/rareMaterial both 0.
    const { captain } = tickCaptainMission(1, base, () => 0.01, { bonusRollChance: 0.02 });
    expect(captain.mission!.cargo.uncommonMaterial.equals(2)).toBe(true);
    expect(captain.mission!.cargo.commonOre.equals(0)).toBe(true);
    expect(captain.mission!.cargo.rareMaterial.equals(0)).toBe(true);
  });

  it("bonus trigger fires, its rare/uncommon checks both miss, and its 30% common check HITS", () => {
    const base = freshCaptains(1)[0];
    base.mission = { ...missionCaptain(), phase: "extracting", phaseProgressTicks: 0 };
    // A stateful rng sequence: primary roll (calls 1-2) both fail shortOreRun's rare (0.001) and uncommon
    // (0.019) checks using 0.5 -> primary common wins, amount 1. Bonus trigger (call 3) uses 0.02 (a
    // value comfortably below the 0.05 chance passed in) -> fires. Bonus mini-sequence: rare (call 4)
    // 0.5 fails, uncommon (call 5) 0.5 fails, common-30% check (call 6) uses 0.2 -> 0.2 < 0.3 -> true,
    // bonus lands common too. Total: commonOre = 1 (primary) + 1 (bonus) = 2.
    const values = [0.5, 0.5, 0.02, 0.5, 0.5, 0.2];
    let i = 0;
    const rng = () => values[i++];
    const { captain } = tickCaptainMission(1, base, rng, { bonusRollChance: 0.05 });
    expect(captain.mission!.cargo.commonOre.equals(2)).toBe(true);
    expect(captain.mission!.cargo.uncommonMaterial.equals(0)).toBe(true);
    expect(captain.mission!.cargo.rareMaterial.equals(0)).toBe(true);
  });

  it("bonus trigger fires but all 3 of its own checks miss: bonus delta is zero, only the primary's amount is delivered", () => {
    const base = freshCaptains(1)[0];
    base.mission = { ...missionCaptain(), phase: "extracting", phaseProgressTicks: 0 };
    // Same 6-call shape as the previous test, but the final common-30% check uses 0.9 (fails: 0.9 < 0.3?
    // no) -- all 3 of the bonus's own checks miss, so the bonus roll contributes NOTHING this tick.
    const values = [0.5, 0.5, 0.02, 0.5, 0.5, 0.9];
    let i = 0;
    const rng = () => values[i++];
    const { captain } = tickCaptainMission(1, base, rng, { bonusRollChance: 0.05 });
    expect(captain.mission!.cargo.commonOre.equals(1)).toBe(true); // primary only, bonus delivered 0
    expect(captain.mission!.cargo.uncommonMaterial.equals(0)).toBe(true);
    expect(captain.mission!.cargo.rareMaterial.equals(0)).toBe(true);
  });

  it("no bonus-roll talents unlocked: bonusRollChance/bonusRollChanceMult default to 0, bonus check never fires regardless of rng", () => {
    const base = freshCaptains(1)[0];
    base.mission = { ...missionCaptain(), phase: "extracting", phaseProgressTicks: 0 };
    // rng constant 0 -- would trigger EVERY check if any chance were nonzero (0 < any positive chance is
    // always true). With no bonuses arg at all, bonusRollChance/bonusRollChanceMult both resolve to 0 via
    // the ?? 0 fallback, so effectiveBonusRollChance is exactly 0, and 0 < 0 is false -- bonus never
    // fires even under the most favorable possible rng. Primary roll (rare checked first) DOES fire:
    // rare wins on rng()=0 (matches the existing ALWAYS_MIN_ROLL test in the primary describe block).
    const { captain } = tickCaptainMission(1, base, ALWAYS_MIN_ROLL);
    expect(captain.mission!.cargo.rareMaterial.equals(1)).toBe(true); // primary only
    expect(captain.mission!.cargo.commonOre.equals(0)).toBe(true);
    expect(captain.mission!.cargo.uncommonMaterial.equals(0)).toBe(true);
  });
});
```

**Step 3 -- verify by hand-trace before committing:** Re-derive every rng() value sequence above against
the ACTUAL live code (not just transcribing this plan) -- in particular confirm `ALWAYS_MIN_ROLL`'s
existing import/definition is in scope for the new describe block (it's a top-of-file constant, already
used elsewhere in this file), and confirm `captainBonusRollChance`/`captainBonusRollChanceMult` are
imported/available in this test file's import block (add them to the existing `tick.ts` import list if
not already present).

**Step 4:** Commit.

```bash
git add src/lib/game/tick.test.ts
git commit -m "test: add tick.test.ts coverage for the bonus-roll stacking helpers and mechanic"
```

---

### Task 5: `App.svelte` -- fix stale drop-rate text + add bonus-roll display

**Files:** Modify `src/App.svelte` (read the current mission-preview popup block fresh -- search for the
`DROP RATES` panel-title; as of this plan it's around line 1282, inside a block that starts with
`{@const uncommonChanceMult = captainUncommonChanceMult(selectedCaptain)}` around line 1267).

**Step 1: Fix the stale drop-rate lines.** Currently (lines ~1283-1285):

```svelte
          <div class="research-cost">Common Ore: up to {formatNumber(missionDef.extractionRatePerTick * (1 + commonYieldMult))}/tick</div>
          <div class="research-cost">Uncommon Material: 1-3/tick, scaled by {(uncommonYieldMult * 100).toFixed(0)}% ({(effectiveUncommonChance * 100).toFixed(1)}% chance/tick)</div>
          <div class="research-cost">Rare Material: 1/tick, scaled by {(rareYieldMult * 100).toFixed(0)}% ({(effectiveRareChance * 100).toFixed(1)}% chance/tick)</div>
```

Replace with text that accurately describes the CURRENT (post-Extraction-Rework) mechanic -- each tier
delivers the FULL per-tick amount when it wins the sequential roll, not a capped/partial amount:

```svelte
          <div class="research-cost">Common Ore: {formatNumber(missionDef.extractionRatePerTick * (1 + commonYieldMult))}/tick when no other tier wins ({(100 - effectiveRareChance * 100 - effectiveUncommonChance * 100).toFixed(1)}% chance/tick)</div>
          <div class="research-cost">Uncommon Material: {formatNumber(missionDef.extractionRatePerTick * (1 + uncommonYieldMult))}/tick when it wins ({(effectiveUncommonChance * 100).toFixed(1)}% chance/tick)</div>
          <div class="research-cost">Rare Material: {formatNumber(missionDef.extractionRatePerTick * (1 + rareYieldMult))}/tick when it wins ({(effectiveRareChance * 100).toFixed(1)}% chance/tick)</div>
```

`uncommonYieldMult` is already computed as a `{@const}` binding two lines above this block (line ~1272) --
confirm it's in scope; it was already being read for the OLD text's `(uncommonYieldMult * 100).toFixed(0)}%`
display, so no new binding is needed. The common-tier chance display (`100 - rare% - uncommon%`) makes
explicit that common is whatever's left over, not its own independent roll -- accurately reflecting the
sequential mechanic's guaranteed-fallback shape.

**Step 2: Add a new bonus-roll display line**, immediately after the 3 drop-rate lines above, shown only
when the selected captain has a nonzero bonus-roll chance (otherwise this UI would show a misleading "0%"
line for every captain without the talent, which is more noise than signal):

```svelte
          {@const bonusRollChance = captainBonusRollChance(selectedCaptain)}
          {@const bonusRollChanceMult = captainBonusRollChanceMult(selectedCaptain)}
          {@const effectiveBonusRollChance = Math.min(1, bonusRollChance * (1 + bonusRollChanceMult))}
          {#if effectiveBonusRollChance > 0}
            <div class="research-cost">Bonus Roll: {(effectiveBonusRollChance * 100).toFixed(1)}% chance/tick for a second independent roll (Lucky Strike)</div>
          {/if}
```

Place these `{@const}` bindings alongside the existing ones (near line ~1267-1273, in the same
`{@const ...}` block), not inside the `{#if}` -- Svelte requires `{@const}` at the same block level as
sibling markup, consistent with how `commonYieldMult`/`uncommonYieldMult`/etc. are already declared there.

**Step 3: Add the 2 new helper imports** to this file's existing `tick.ts` import list (find the line
importing `captainUncommonYieldMult`/`captainRareChanceMult`/etc. -- add `captainBonusRollChance` and
`captainBonusRollChanceMult` alongside them).

**Step 4 -- verify by hand-trace:** Confirm the new common-tier display formula
(`100 - effectiveRareChance*100 - effectiveUncommonChance*100`) produces a sensible percentage for
shortOreRun with no talents unlocked: `100 - 0.1 - 1.9 = 98.0%` -- matches the original design
conversation's own "98%/1.9%/0.1%" framing. Confirm the `{#if effectiveBonusRollChance > 0}` guard
correctly hides the line for every captain without any Lucky Strike talent unlocked (the overwhelmingly
common case today, since these are brand-new nodes).

**Step 5:** Commit.

```bash
git add src/App.svelte
git commit -m "fix: correct stale drop-rate preview text and add bonus-roll display line"
```

---

### Task 6: Docs + session log

**Files:** Modify `SESSION_LOG.md`. No new `KNOWN_ISSUES.md`/`SUGGESTIONS.md` entries needed -- the design
doc's "Explicitly out of scope" section already covers what's deferred (ships, ship-stat cargo, third
mission type), and the stale-UI-text bug is being FIXED in this branch, not deferred.

**Step 1:** Read the 2-3 most recent `SESSION_LOG.md` entries (Session 21, Session 22) to match the
established format exactly. This would be Session 23.

**Step 2:** Append a new entry summarizing: the Resourcefulness Lucky Strike I/II talent pair (bonus-roll
trigger chance 2%/4%, reusing the primary roll's rare/uncommon odds but with only a 30% chance of landing
common instead of a guaranteed floor, so it can whiff), the new `rollBonusExtractionTick` function and its
up-to-3-rng()-call mini-sequence, the 2 new stacking helpers, and the bundled fix for the stale
mission-preview drop-rate text that the Extraction Rework branch left behind (found during this feature's
own brainstorming, folded into this branch per the user's explicit choice rather than a separate hotfix).

**Step 3:** Commit.

```bash
git add SESSION_LOG.md
git commit -m "docs: session log for Resourcefulness Bonus Roll"
```

Do NOT push -- origin/main triggers a live Vercel production redeploy; wait for explicit confirmation
before any push, per this project's established practice.

---

## After all tasks: final holistic review

Once all 6 tasks (plus Task 0's worktree setup) are committed and individually reviewed, dispatch one
final holistic review of the WHOLE branch before presenting merge options -- same pattern as every prior
feature this session. Specifically re-verify:

1. Grep the ENTIRE `src/` directory for any remaining reference to the OLD stale drop-rate text
   ("1-3/tick", "scaled by" in the old shape) to confirm the App.svelte fix is complete.
2. Confirm `rollBonusExtractionTick` never makes more than 3 `rng()` calls, and its 4 possible outcomes
   (rare, uncommon, common-via-30%, nothing) are mutually exclusive -- no code path returns more than one
   nonzero field, and the "nothing" path returns all-zero via `emptyLootTotals()`.
3. Confirm a captain with NO bonus-roll talents unlocked is BEHAVIORALLY IDENTICAL to a pre-this-branch
   captain -- `effectiveBonusRollChance` resolves to exactly 0 and the bonus check never fires, regardless
   of rng value. This is the single most important regression check for this branch, since it touches the
   shared `tickCaptainMission` extraction loop that EVERY mission-running captain executes.
4. Confirm `CAPTAIN_TALENTS`' 2 new keys' `requires` chain resolves correctly (`resourcefulnessBonusRollI`
   requires `resourcefulnessRareChanceII`, `resourcefulnessBonusRollII` requires
   `resourcefulnessBonusRollI`) and that `buyCaptainTalent` (unmodified by this branch) correctly gates
   purchase on that chain being unlocked in order, same as every other multi-node branch.
5. Confirm nothing from the design doc's "Explicitly out of scope" section was accidentally built (no
   ship-stat cargo capacity, no third mission type, no new `CaptainTalentBranch`/`shipType` gating beyond
   what already exists).
