# Talent Tree Visual Redesign Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Turn both flat talent-list panels (Captain Talents, Homeworld Talents) into real branching
trees with SVG connectors and hover/tap tooltips, and add a `credits` currency + full-reset respec
mechanism funded by it.

**Architecture:** A new `credits` `Decimal` field on `GameState`, earned via a new `creditsPerCycle`
field on `MissionDef` (mirrors `fleetAdminXpPerCycle`'s existing accumulate-then-apply shape in
`tickCaptainMission`/`tick()`). Two new full-reset functions (`respecCaptainTalents`,
`respecHomeworldTalents`) in `tick.ts`, both costing 50 credits, both excluding `unlockCaptainSlot` nodes
from Homeworld's refund. A new `flavor` field on both talent-def interfaces plus two
`describe*Effect` helpers turn raw effect values into readable text. `App.svelte`'s two talent panels are
rewritten to position nodes by depth-in-chain and draw SVG connector lines between them, with
hover/tap tooltips and Reset buttons behind a confirmation modal (reusing the existing DELETE SAVE
modal's `.modal-backdrop`/`Panel.modal-dialog` pattern).

**Tech Stack:** Vite + Svelte + TypeScript, Vitest (present but not executable in this environment -- no
Node/npm/tsc available; every task is verified by manual hand-trace, same as every prior feature this
session).

---

### Task 0: Set up git worktree

**REQUIRED SUB-SKILL:** Use superpowers:using-git-worktrees.

Create worktree at `.worktrees/feat-talent-tree-visual-redesign` on new branch
`feat/talent-tree-visual-redesign`, branched from `main` (confirm exact current commit via
`git log --oneline -1` before branching -- should be at or after `58acf50`). `.worktrees/` is already
gitignored. No `npm install` step -- no usable Node/npm in this environment.

---

### Task 1: `model.ts` — credits field, creditsPerCycle, flavor field + text

**Files:** Modify `src/lib/game/model.ts` (read the current file yourself first -- do not trust line
numbers here, they may have drifted).

**Step 1:** Add `credits: Decimal;` to the `GameState` interface (alongside `fleetAdminXp`/`adminPoints`
-- it's a fleet-wide currency like those two).

**Step 2:** Add `credits: new Decimal(0)` to `freshState()`'s returned object.

**Step 3:** Add `creditsPerCycle: number;` to the `MissionDef` interface, with a comment mirroring
`fleetAdminXpPerCycle`'s own comment style (flat award per completed cycle, launch placeholder). Set
`MISSIONS.shortOreRun.creditsPerCycle = 10` and `MISSIONS.longOreRun.creditsPerCycle = 20`.

**Step 4:** Add `flavor: string;` to both `CaptainTalentDef` and `HomeworldTalentDef` interfaces.

**Step 5:** Populate `flavor` on all 12 existing entries with this exact text (copied from the approved
design doc):

```ts
// CAPTAIN_TALENTS
commandExtractionI.flavor = "Standard doctrine trades finesse for throughput -- pull more common ore per cycle, no questions asked."
commandExtractionII.flavor = "Field engineers recalibrate the intake manifolds to favor uncommon deposits over raw volume."
resourcefulnessRareChanceI.flavor = "A trained eye catches what the sensors miss -- subtle mineral banding invisible to standard scans."
resourcefulnessRareChanceII.flavor = "Years of fieldwork sharpen instinct into something the manuals can't teach."
resourcefulnessBonusRollI.flavor = "Some captains just have a feel for where the good ore sits. Call it luck; call it experience."
resourcefulnessBonusRollII.flavor = "When the feeling's right twice in a row, it stops being coincidence."

// HOMEWORLD_TALENTS
fleetLogisticsSlot1.flavor = "Fleet Command approves a second commission -- the roster grows."
fleetLogisticsSlot2.flavor = "A third captain's chair, funded and ready. The fleet expands."
fleetLogisticsSlot3.flavor = "Four commands under one banner -- logistics finally caught up with ambition."
fleetLogisticsYield.flavor = "Standing orders redirect a share of every rare find straight back to the fleet's reserves."
industryBonusOutput.flavor = "New jigs and fixtures on the fabrication line mean every batch stretches a little further."
economyTrickle.flavor = "A quiet arrangement with independent traders keeps a slow, steady trickle of ore flowing home."
```

Add each as a new `flavor: "..."` field on its existing object literal in `CAPTAIN_TALENTS`/
`HOMEWORLD_TALENTS` -- do not change any other field on these entries.

**Step 6 -- verify by hand-trace:** Confirm `GameState`'s new `credits` field doesn't collide with
anything, confirm `freshState().credits.equals(0)` would pass, confirm both `MISSIONS` entries compile
with the new required field, confirm all 12 talent entries now have `flavor` (no entry missed).

**Step 7:** Commit.

```bash
git add src/lib/game/model.ts
git commit -m "feat: add credits currency and flavor text fields to model.ts"
```

---

### Task 2: `model.test.ts` — new assertions

**Files:** Modify `src/lib/game/model.test.ts`.

**Step 1:** Add a test confirming `freshState().credits.equals(0)` (find the existing
`freshState`/Fleet Admiral fields describe block and add this alongside the other freshState assertions).

**Step 2:** Add assertions for `MISSIONS.shortOreRun.creditsPerCycle === 10` and
`MISSIONS.longOreRun.creditsPerCycle === 20` (find the existing test asserting
`fleetAdminXpPerCycle` values and add alongside it, matching its style).

**Step 3:** Add a test confirming every `CAPTAIN_TALENTS`/`HOMEWORLD_TALENTS` entry has a non-empty
`flavor` string:

```ts
it("every CAPTAIN_TALENTS entry has non-empty flavor text", () => {
  for (const talent of Object.values(CAPTAIN_TALENTS)) {
    expect(talent.flavor.length).toBeGreaterThan(0);
  }
});

it("every HOMEWORLD_TALENTS entry has non-empty flavor text", () => {
  for (const talent of Object.values(HOMEWORLD_TALENTS)) {
    expect(talent.flavor.length).toBeGreaterThan(0);
  }
});
```

**Step 4:** Commit.

```bash
git add src/lib/game/model.test.ts
git commit -m "test: add model.test.ts coverage for credits/creditsPerCycle/flavor fields"
```

---

### Task 3: `tick.ts` — credits accumulation through tickCaptainMission/tick()

**Files:** Modify `src/lib/game/tick.ts` (read the current `tickCaptainMission`/`tick()` fully first --
both were modified twice already this session, in the Extraction Rework and Resourcefulness Bonus Roll
branches; the exact current shape matters).

**Step 1:** Inside `tickCaptainMission`, add a `creditsDelta` accumulator, same "collect locally, apply
once" pattern as `fleetAdminXpDelta`:

```ts
let creditsDelta = 0; // declare alongside fleetAdminXpDelta
```

Inside the cycle-completion branch (where `fleetAdminXpDelta += missionDef.fleetAdminXpPerCycle;`
already runs), add immediately after it:

```ts
creditsDelta += missionDef.creditsPerCycle;
```

Add `creditsDelta` to `tickCaptainMission`'s return object (alongside `fleetAdminXpDelta`), and update
its return type annotation to include `creditsDelta: number`.

**Step 2:** Inside `tick()`, add a `creditsDelta` accumulator (fleet-wide, same "accumulate locally,
apply once" shape as `fleetAdminXpDelta` there):

```ts
let creditsDelta = 0; // declare alongside fleetAdminXpDelta
```

Inside the `.map()` callback, destructure `creditsDelta: captainCreditsDelta` from `tickCaptainMission`'s
return alongside the existing `fleetAdminXpDelta: captainFleetAdminXpDelta`, and add
`creditsDelta += captainCreditsDelta;` alongside the existing `fleetAdminXpDelta += ...` line.

**Step 3:** Add `credits: state.credits.plus(creditsDelta)` to the state object `tick()` builds and hands
to `applyFleetAdminXp` -- credits has no leveling curve, so this is a flat `.plus()`, not a function call
like `applyFleetAdminXp`. Read the existing final `return applyFleetAdminXp({ ...state, captains, ... },
fleetAdminXpDelta)` call and add the `credits` field into that same object literal.

**Step 4 -- verify by hand-trace before committing:** Confirm a captain completing 1 full `shortOreRun`
cycle (149 ticks) awards `creditsDelta = 10` inside `tickCaptainMission`, and that `tick()` correctly
sums this into `state.credits` alongside the existing `fleetAdminXpDelta`/`homePlanetDelta` accumulation.
Confirm a captain with no mission or an incomplete cycle contributes `creditsDelta = 0` (unchanged from
today's behavior for anyone not yet earning credits).

**Step 5:** Commit.

```bash
git add src/lib/game/tick.ts
git commit -m "feat: accumulate credits per completed mission cycle in tickCaptainMission/tick()"
```

---

### Task 4: `tick.test.ts` — credits accumulation tests

**Files:** Modify `src/lib/game/tick.test.ts` (read the existing `fleetAdminXpDelta`/XP-award test
patterns in the "cycle completion, auto-repeat, and recall" describe block to match style).

**Step 1:** Add a test confirming `tickCaptainMission` returns the correct `creditsDelta` for a captain
completing exactly 1 `shortOreRun` cycle (149 ticks) -- expect `creditsDelta === 10`. Add a second test
for `longOreRun` expecting `creditsDelta === 20`. Add a third confirming a captain with NO completed
cycle within the call returns `creditsDelta === 0`.

**Step 2:** Add a `tick()`-level test confirming `state.credits` increases by the correct amount after a
captain completes a cycle via a full `tick()` call (mirror the existing Fleet Admiral XP `tick()`-level
test's structure).

**Step 3 -- verify by hand-trace:** Re-derive each expected `creditsDelta`/`state.credits` value against
the live `MISSIONS`/`tick.ts` code yourself before committing, don't transcribe blindly.

**Step 4:** Commit.

```bash
git add src/lib/game/tick.test.ts
git commit -m "test: add tick.test.ts coverage for credits accumulation"
```

---

### Task 5: `save.ts` — v13→v14 migration

**Files:** Modify `src/lib/game/save.ts` (read the current `MIGRATIONS` table's tail, `hydrateDecimals`,
and `SAVE_VERSION` yourself first -- current `SAVE_VERSION` is `13`).

**Step 1:** Bump `SAVE_VERSION` from `13` to `14`.

**Step 2:** Add a new `MIGRATIONS[13]` entry backfilling `credits` for saves from before this branch:

```ts
13: (state: any): GameState => ({
  ...state,
  credits: 0,
}),
```

(Matches the existing style of simple additive migrations like `MIGRATIONS[1]` for `tickDurationSeconds`
-- a plain number here, since `hydrateDecimals` below converts it to a real `Decimal` unconditionally.)

**Step 3:** Add `credits: toDecimal(state.credits)` to `hydrateDecimals`'s returned object (alongside the
existing `fleetAdminXp: toDecimal(state.fleetAdminXp)` line) -- this runs unconditionally for both
migrated AND already-current-version saves, per that function's own header comment.

**Step 4 -- verify by hand-trace:** Confirm a save at version 13 (or earlier, walking the whole chain)
ends up with `credits` as a live `Decimal` instance equal to `0` after `migrate()` runs. Confirm a
freshly-serialized v14 save (where `credits` round-trips through `JSON.stringify`/`toJSON()` as a plain
string) also correctly hydrates back into a `Decimal` via the unconditional `hydrateDecimals` call.

**Step 5:** Commit.

```bash
git add src/lib/game/save.ts
git commit -m "feat: save.ts v13->v14 migration backfilling credits"
```

---

### Task 6: `save.test.ts` — migration test

**Files:** Modify `src/lib/game/save.test.ts` (read the existing migration test for the prior version
bump -- e.g. the v12->v13 test from the Tick Granularity Rebalance branch -- to match its exact style).

**Step 1:** Add a test constructing a v13-shaped save object (no `credits` field), running it through
`migrate()`, and asserting the result has `credits` as a `Decimal` equal to `0`.

**Step 2 -- verify by hand-trace:** Confirm the test's input shape is a realistic v13 save (matching
what `serialize()` would have produced before this branch), not an invented shape.

**Step 3:** Commit.

```bash
git add src/lib/game/save.test.ts
git commit -m "test: add save.test.ts migration test for v13->v14 credits backfill"
```

---

### Task 7: `tick.ts` — respecCaptainTalents / respecHomeworldTalents

**Files:** Modify `src/lib/game/tick.ts` (read `buyCaptainTalent`/`buyHomeworldTalent`/`recallCaptain`
fully first -- these two new functions must match their exact `{ next: GameState; success: boolean }`
return-shape convention and "same state reference on failure" style).

**Step 1:** Add a shared constant near the other tunable constants in this file:

```ts
const RESPEC_COST_CREDITS = 50; // launch placeholder, not balance-tested, same spirit as MISSIONS/talent costs
```

**Step 2:** Add `respecCaptainTalents`:

```ts
// Full-reset only (no per-node refunds) -- refunds every statPoints this
// captain spent across their ENTIRE unlockedCaptainTalents list, then clears
// it. Costs RESPEC_COST_CREDITS credits, fleet-wide (credits aren't
// per-captain). Fails with the SAME state reference if the captain doesn't
// exist or credits are insufficient -- same convention as every other
// buy/action function in this file.
export function respecCaptainTalents(state: GameState, captainId: number): { next: GameState; success: boolean } {
  const idx = state.captains.findIndex((c) => c.id === captainId);
  if (idx === -1) return { next: state, success: false };
  if (state.credits.lt(RESPEC_COST_CREDITS)) return { next: state, success: false };

  const captain = state.captains[idx];
  const refund = captain.unlockedCaptainTalents.reduce((sum, key) => sum + CAPTAIN_TALENTS[key].cost, 0);

  const captains = [...state.captains];
  captains[idx] = {
    ...captain,
    statPoints: captain.statPoints + refund,
    unlockedCaptainTalents: [],
  };
  return { next: { ...state, captains, credits: state.credits.minus(RESPEC_COST_CREDITS) }, success: true };
}
```

**Step 3:** Add `respecHomeworldTalents`:

```ts
// Full-reset only, same as respecCaptainTalents, but EXCLUDES unlockCaptainSlot
// nodes entirely -- those stay permanently unlocked (no refund, not removed
// from unlockedHomeworldTalents) since undoing one would mean deleting an
// existing captain and everything on it (their own Captain Talents, any
// in-progress mission, cargo). Confirmed with the user rather than silently
// making resets destructive. Fails with the SAME state reference if credits
// are insufficient.
export function respecHomeworldTalents(state: GameState): { next: GameState; success: boolean } {
  if (state.credits.lt(RESPEC_COST_CREDITS)) return { next: state, success: false };

  const refundableKeys = state.unlockedHomeworldTalents.filter(
    (key) => HOMEWORLD_TALENTS[key].effect.type !== "unlockCaptainSlot"
  );
  const refund = refundableKeys.reduce((sum, key) => sum + HOMEWORLD_TALENTS[key].cost, 0);
  const survivingKeys = state.unlockedHomeworldTalents.filter(
    (key) => HOMEWORLD_TALENTS[key].effect.type === "unlockCaptainSlot"
  );

  return {
    next: {
      ...state,
      adminPoints: state.adminPoints + refund,
      unlockedHomeworldTalents: survivingKeys,
      credits: state.credits.minus(RESPEC_COST_CREDITS),
    },
    success: true,
  };
}
```

**Step 4 -- verify by hand-trace before committing:**
   (a) A captain with `unlockedCaptainTalents: ["commandExtractionI", "commandExtractionII"]` (costs 2
   and 4) and `state.credits = 50`: `respecCaptainTalents` should refund `2 + 4 = 6` statPoints, clear
   the array to `[]`, and leave `state.credits = 0`.
   (b) `state.credits = 49` (insufficient): `respecCaptainTalents` returns `{ next: state, success:
   false }` -- the EXACT same object reference, unchanged.
   (c) `state.unlockedHomeworldTalents: ["fleetLogisticsSlot1", "fleetLogisticsYield"]` (slot1 cost 3,
   is `unlockCaptainSlot`; yield cost 4, is `rareYieldMult`) with `state.credits = 50`:
   `respecHomeworldTalents` should refund only `4` adminPoints (yield's cost), leave
   `unlockedHomeworldTalents` as `["fleetLogisticsSlot1"]` (slot1 survives, untouched), and leave
   `state.credits = 0`.
   (d) Confirm neither function ever touches `captains` array length/identity beyond the one captain
   being respecced (for `respecCaptainTalents`) or not at all (for `respecHomeworldTalents` -- no
   captain is added or removed).

**Step 5:** Commit.

```bash
git add src/lib/game/tick.ts
git commit -m "feat: add respecCaptainTalents/respecHomeworldTalents full-reset functions"
```

---

### Task 8: `tick.test.ts` — respec tests

**Files:** Modify `src/lib/game/tick.test.ts` (find where `buyCaptainTalent`/`buyHomeworldTalent` are
tested for the existing describe-block style to mirror).

**Step 1:** Add a new describe block `"respecCaptainTalents / respecHomeworldTalents"` with tests
covering exactly the 4 hand-traced scenarios from Task 7 Step 4 above: successful captain respec with
correct refund math, insufficient-credits failure (same state reference), successful Homeworld respec
correctly excluding `unlockCaptainSlot` nodes from both the refund AND the removal, and a
Homeworld-respec insufficient-credits failure case.

**Step 2 -- verify by hand-trace:** Re-derive every expected refund/credits value against the live
`tick.ts` code and the live `CAPTAIN_TALENTS`/`HOMEWORLD_TALENTS` cost values yourself before committing.

**Step 3:** Commit.

```bash
git add src/lib/game/tick.test.ts
git commit -m "test: add tick.test.ts coverage for respecCaptainTalents/respecHomeworldTalents"
```

---

### Task 9: `tick.ts` — describe*Effect helpers + talentDepth

**Files:** Modify `src/lib/game/tick.ts` (add near the other pure-computation helpers, e.g. right after
`fleetRareYieldMult`).

**Step 1:** Read the CURRENT `CaptainTalentEffect`/`HomeworldTalentEffect` unions in `model.ts` for the
exact full list of member types (6 Captain Talent effect types, 4 Homeworld Talent effect types, per this
session's own recent additions -- do not assume the list from an earlier point in this session, re-read
live).

**Step 2:** Add `describeCaptainTalentEffect(effect: CaptainTalentEffect): string`, one branch per
union member, converting each into a short human-readable line, e.g.:

```ts
export function describeCaptainTalentEffect(effect: CaptainTalentEffect): string {
  switch (effect.type) {
    case "commonYieldMult": return `+${(effect.mult * 100).toFixed(0)}% Common Ore yield`;
    case "uncommonYieldMult": return `+${(effect.mult * 100).toFixed(0)}% Uncommon Material yield`;
    case "uncommonChanceMult": return `+${(effect.mult * 100).toFixed(0)}% Uncommon Material chance`;
    case "rareChanceMult": return `+${(effect.mult * 100).toFixed(0)}% Rare Material chance`;
    case "bonusRollChance": return `+${(effect.chance * 100).toFixed(0)}% chance/tick for a bonus roll`;
    case "bonusRollChanceMult": return `+${(effect.mult * 100).toFixed(0)}% to bonus roll chance`;
  }
}
```

**Step 3:** Add `describeHomeworldTalentEffect(effect: HomeworldTalentEffect): string`, one branch per
union member:

```ts
export function describeHomeworldTalentEffect(effect: HomeworldTalentEffect): string {
  switch (effect.type) {
    case "unlockCaptainSlot": return "Unlocks a new captain slot";
    case "rareYieldMult": return `+${(effect.mult * 100).toFixed(0)}% Rare Material yield (fleet-wide)`;
    case "recipeBonusOutput": return `+${effect.bonus} bonus output per craft`;
    case "passiveTrickle": return `+${effect.perTick}/tick passive ${effect.material}`;
  }
}
```

Adjust exact wording/rounding as feels natural, but keep the shape (one line per effect type, numbers
pulled live from the effect value, not hardcoded).

**Step 4 -- verify by hand-trace:** Confirm every current effect-type member (across both unions) has a
matching switch branch -- if TypeScript's exhaustiveness checking would flag a missing case (it should,
since these are discriminated unions with no default branch), use that as your check even without a
compiler available (manually enumerate every member and confirm one line each).

**Step 5:** Commit.

```bash
git add src/lib/game/tick.ts
git commit -m "feat: add describeCaptainTalentEffect/describeHomeworldTalentEffect helpers"
```

---

### Task 10: `App.svelte` — Captain Talents panel visual layout + connectors

**Files:** Modify `src/App.svelte` (read the current Captain Talents panel block fully -- search for
`<div class="panel-title">CAPTAIN TALENTS`). This is the largest, highest-risk task in this plan --
touches live UI markup and introduces new layout math. Read `app.css`'s existing color tokens
(`--color-accent`, `--color-accent-bright`, `--color-success`, `--color-accent-rgb`) before writing any
SVG stroke colors -- use these existing tokens, don't invent new ones.

**Step 1:** Add a `talentDepth` helper (script-side, in this file or a small shared util -- implementer's
judgment) computing a node's depth by walking its `requires` chain back to a root:

```ts
function talentDepth(key: string, table: Record<string, { requires: string | null }>): number {
  let depth = 0;
  let current = table[key].requires;
  while (current !== null) {
    depth += 1;
    current = table[current].requires;
  }
  return depth;
}
```

(Generic over both `CAPTAIN_TALENTS`/`HOMEWORLD_TALENTS` shapes since both have a `requires` field of the
same shape -- confirm this generality works for TypeScript's structural typing, or write two thin typed
wrappers if the compiler would complain without one available to check against; prefer the generic
version if it type-checks cleanly by inspection.)

**Step 2:** Rewrite the Captain Talents panel's per-branch node rendering to position each node
absolutely within its branch's column at `(depth-row)` -- e.g. a `position: relative` container per
branch with each node `position: absolute; top: {depth * ROW_HEIGHT}px`. Since every branch today is a
single linear chain (no siblings sharing a depth), a single column per branch suffices for now, but don't
hardcode an assumption that breaks if two nodes ever do share a depth (e.g. don't assume `nodes.length ===
maxDepth + 1` anywhere) -- lay out any same-depth siblings side-by-side within the same row if this ever
happens (future-proofing per the design doc, even though no current data exercises it).

**Step 3:** Add one inline `<svg>` per branch (positioned to overlay the branch's node column) drawing a
straight `<line>` from each non-root node's position to its `requires` prerequisite's position. Style: an
owned node's incoming connector uses `var(--color-success)` (or `var(--color-accent-bright)`, pick
whichever reads better against the existing owned-node border color at `.skill-node.owned`); a locked
node's incoming connector uses a dim variant (e.g. `rgba(var(--color-accent-rgb), 0.2)`).

**Step 4 -- verify by hand-trace:** Confirm `resourcefulnessRareChanceI → II → BonusRollI → II` (the
4-node chain) renders as 4 stacked nodes with 3 connector lines between them, and that `commandExtractionI
→ II` (the 2-node chain) renders as 2 stacked nodes with 1 connector line -- both within their own
column, independent of each other. Confirm an EMPTY branch (tactical/science/diplomacy, zero entries)
still renders its labeled column with no nodes/connectors, matching today's "Not yet available" behavior
(don't regress this).

**Step 5:** Commit.

```bash
git add src/App.svelte
git commit -m "feat: Captain Talents panel -- depth-based layout with SVG connectors"
```

---

### Task 11: `App.svelte` — Homeworld Talents panel visual layout + connectors

**Files:** Modify `src/App.svelte` (search for `<div class="panel-title">HOMEWORLD TALENTS`).

**Step 1:** Apply the exact same layout/connector treatment from Task 10 to the Homeworld Talents panel,
reusing the same `talentDepth` helper and the same per-branch column/connector-SVG approach (this panel's
`fleetLogistics` branch has a 3-node linear slot-unlock chain plus a separate `fleetLogisticsYield` root
node with `requires: null` -- confirm your depth-walk correctly treats `fleetLogisticsYield` as its OWN
depth-0 root, not conflated with the slot-unlock chain, since both share the `fleetLogistics` branch but
are otherwise independent -- this is your first real case of a branch with more than one depth-0 root,
good to verify explicitly).

**Step 2 -- verify by hand-trace:** Confirm `fleetLogisticsSlot1 → Slot2 → Slot3` renders as a 3-node
chain, `fleetLogisticsYield` renders as its own independent single node (depth 0, no connector to the
slot chain), both within the `fleetLogistics` branch's column without visually merging into one chain.
Confirm `industryBonusOutput`/`economyTrickle` (single-node branches, `industry`/`economy`) each render
correctly as one node with no connector (nothing to connect to).

**Step 3:** Commit.

```bash
git add src/App.svelte
git commit -m "feat: Homeworld Talents panel -- depth-based layout with SVG connectors"
```

---

### Task 12: `App.svelte` — tooltips (both panels)

**Files:** Modify `src/App.svelte` (both talent panel blocks).

**Step 1:** Add per-node tooltip state (e.g. a `let openTooltipKey: string | null = null;` script
variable, shared or duplicated per panel -- implementer's judgment) and tooltip content combining: the
node's `flavor` text, its numbers line via `describeCaptainTalentEffect`/`describeHomeworldTalentEffect`,
and its cost/requires (already shown inline elsewhere on the node -- repeated here for a self-contained
popup).

**Step 2:** Wire hover-to-show on desktop: `on:mouseenter={() => (openTooltipKey = key)}` /
`on:mouseleave={() => (openTooltipKey = null)}` on each node.

**Step 3:** Wire tap-to-toggle on touch: `on:click={() => (openTooltipKey = openTooltipKey === key ? null
: key)}` on each node -- confirm this doesn't conflict with the existing "Learn"/"Unlock" buy buttons
inside the same node (the tooltip toggle should be on the node's own container/label area, not
overlapping the buy button's click target).

**Step 4:** Render the tooltip content conditionally (`{#if openTooltipKey === key}`) near/over the node.

**Step 5 -- verify by hand-trace:** Confirm hovering one node and then a different node correctly swaps
`openTooltipKey` (only one tooltip open at a time). Confirm the buy button inside a node still works
without accidentally toggling the tooltip on the same click (event propagation -- may need
`on:click|stopPropagation` on the buy button specifically, or structure the click handlers so they don't
overlap).

**Step 6:** Commit.

```bash
git add src/App.svelte
git commit -m "feat: add hover/tap tooltips (flavor text + numbers) to both talent panels"
```

---

### Task 13: `App.svelte` — Reset buttons, confirmation modal, credits display

**Files:** Modify `src/App.svelte` (read the existing DELETE SAVE modal's full markup and script-side
state -- `deleteConfirmText`, the `.modal-backdrop`/`Panel.modal-dialog` structure -- to reuse the exact
same visual language, per this codebase's established convention).

**Step 1:** Add `state.credits` display near the existing Admin Points readout in the Homeworld Talents
panel (`<div class="research-cost">Admin Points: ...`) -- add a sibling line
`<div class="research-cost">Credits: {formatNumber(state.credits)}</div>`.

**Step 2:** Add a "Reset" button to the Homeworld Talents panel (fleet-wide) and one to the Captain
Talents panel (per-captain, scoped to `activeCaptain`). Each opens a confirmation modal (new
`.modal-backdrop`/`Panel.modal-dialog` instance, mirroring DELETE SAVE's structure) stating the cost (50
credits) and that it's irreversible, with Cancel/Confirm buttons -- Confirm calls
`doRespecCaptainTalents(activeCaptain.id)` / `doRespecHomeworldTalents()` (new script-side handler
functions wrapping `respecCaptainTalents`/`respecHomeworldTalents`, same `next`/`success` handling
pattern every other `do*` handler in this file already uses).

**Step 3:** Disable the Reset button (or show it but disable Confirm in the modal) when
`state.credits.lt(50)`, so the affordability is visible before the player commits to opening the
confirmation flow.

**Step 4 -- verify by hand-trace:** Confirm the confirmation modal's Confirm button actually calls the
right handler for the right scope (captain-specific vs fleet-wide) -- these are easy to accidentally
swap if both modals share too much boilerplate carelessly. Confirm the modal closes after a
successful respec (same pattern the DELETE SAVE modal uses to close itself after `confirmDelete()`).

**Step 5:** Commit.

```bash
git add src/App.svelte
git commit -m "feat: add Reset buttons, confirmation modal, and credits display to talent panels"
```

---

### Task 14: Docs + session log

**Files:** Modify `SESSION_LOG.md`. No new `KNOWN_ISSUES.md`/`SUGGESTIONS.md` entries needed -- the
Homeworld Market idea (the one thing explicitly deferred from this design) was already logged separately
in commit `58acf50`.

**Step 1:** Read the 2-3 most recent `SESSION_LOG.md` entries (Session 22, Session 23) to match format.
This would be Session 24.

**Step 2:** Append a new entry summarizing: the new `credits` currency (earned per completed mission
cycle, 10/20 for short/long runs), the full-reset respec mechanism (50 credits, excludes
`unlockCaptainSlot` nodes from Homeworld's refund to avoid ever deleting an existing captain), the visual
tree redesign (depth-based layout, SVG connectors re-themed via existing color tokens, generalized to
handle future forks/multiple-roots-per-branch even though today's data is all linear chains or single
roots), the new `flavor` field + `describe*Effect` helpers powering hover/tap tooltips, and the
`SAVE_VERSION` 13→14 migration. Note the deferred Homeworld Market (already logged separately).

**Step 3:** Commit.

```bash
git add SESSION_LOG.md
git commit -m "docs: session log for Talent Tree Visual Redesign"
```

Do NOT push -- origin/main triggers a live Vercel production redeploy; wait for explicit confirmation
before any push.

---

## After all tasks: final holistic review

Once all 14 tasks (plus Task 0's worktree setup) are committed and individually reviewed, dispatch one
final holistic review of the WHOLE branch before presenting merge options -- same pattern as every prior
feature this session. Specifically re-verify:

1. Grep the ENTIRE `src/` directory for any remaining hardcoded reference to old talent-node display
   patterns (flat-list-only markup) that might have been missed in one of the two panel rewrites.
2. Confirm `respecHomeworldTalents` genuinely never removes an `unlockCaptainSlot` key from
   `unlockedHomeworldTalents` under any input, and never refunds its cost -- re-read the function and
   confirm the filter logic is airtight, since this is the single most important regression-safety
   property of this whole branch (an accidental captain deletion via a talent reset would be severe).
3. Confirm `credits` hydration/migration is correct in BOTH directions -- a pre-v14 save backfills to
   `Decimal(0)`, and a fresh v14 save's `credits` round-trips through serialize/deserialize correctly.
4. Confirm the SVG connector rendering doesn't break for any EMPTY branch (tactical/science/diplomacy for
   Captain Talents; homelandDefense/citizenry for Homeworld) -- these must still render as labeled empty
   columns, not error out on `talentDepth` being called against an empty node list.
5. Confirm `describeCaptainTalentEffect`/`describeHomeworldTalentEffect` have a branch for every single
   current union member (6 + 4) -- re-grep both unions in `model.ts` one more time and cross off each one
   against the switch statements.
6. Re-read the design doc's flavor-text table one more time and confirm all 12 entries in `model.ts`
   match it (or note any deliberate edits made during implementation, if the user requested changes along
   the way).
7. Confirm nothing from prior branches' "out of scope" lists was accidentally built (no Homeworld Market,
   no per-node partial refunds, no ship-stat cargo, no third mission type).
