# Radial Skill Web Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

> **⚠️ PLAN REVISION (2026-07-08, mid-execution) — read "## Plan revision" at the bottom before Phase 2.** Device testing is via **Vercel preview deployments of the pushed branch** (no local Node), so the branch MUST fully compile before any checkpoint. Phase 2/3 sequencing is amended: a **minimal buildable integration** (remove the old App.svelte panels, mount RadialWeb directly, no selector) precedes **Checkpoint A**; the TreeSelector + full spec/category wiring then layers on top before **Checkpoint B**. Task 7 also fixes real production code in `tick.ts` (`captainCommonYieldMult`'s removed-`command` spec-bonus fold-in), not just test references.

**Goal:** Replace the depth-based-row talent-tree rendering with a pannable, hub-seeded radial "skill web" (fog-of-war reveal, hand-authored node positions, orthogonal elbow connectors), for both the Captain (3 committing spec cards) and Fleet Admiral (5 non-committing category cards) contexts.

**Architecture:** Talent data shifts from linear `requires` chains to a graph (`x`/`y` + `neighbors[]` + `isHub`). A reusable `RadialWeb.svelte` renders the visible subgraph (owned ∪ neighbors-of-owned ∪ hub) inside a pan-transformed world container, with a reusable `TreeSelector.svelte` fronting it (cards + live description panel). Buy-gating, respec, and a save migration adapt to the new shape. Content ships lean (Prospector rich; Tactician/Explorer/most-Homeworld = hub-led stubs).

**Tech Stack:** Vite + Svelte + TypeScript, `break_infinity.js` `Decimal`, LZString save compression, Pointer Events API for gestures. **No Node/npm/tsc on this machine** — see "Working environment" below.

**Design doc:** `docs/plans/2026-07-08-radial-skill-web-design.md` (read it first).

---

## Working environment (READ BEFORE EXECUTING)

Node / npm / tsc / vitest are **absent from this machine** (re-verified 2026-07-08). The "run the test" steps below **cannot be executed here**. Adapt every TDD cycle to:

1. **Write the failing test** (real `*.test.ts` alongside existing ones — they DO get run later in a real Node env, and are the durable spec).
2. **Verify-fail = hand-trace**, not execution. State the expected failure reason in the commit/notes.
3. **Implement.**
4. **Verify-pass = hand-trace + static re-read** of the changed function (per the project's Anti-Regression rule): no references to deleted symbols, types propagate, arithmetic re-derived independently.
5. **Commit.**

Tasks that touch **rendering/gestures (Phase 2–3)** cannot be verified even by hand-trace for *feel*. They gate on **device checkpoints** (explicit tasks below): the user loads the branch on desktop + phone and reports back.

Per the project workflow: this plan is executed via **subagent-driven-development** (one implementer subagent per task → spec-compliance reviewer → code-quality reviewer), in a **git worktree** cut from `main`. Every reviewer prompt must say "static review only, no WebSearch/WebFetch, keep it fast and bounded." Reviewers touching an intentionally-incomplete intermediate state (e.g. data model changed before buy-gating catches up) must be told so explicitly.

---

## Phase 0 — Worktree

### Task 0: Create the implementation worktree

**Not a code task.** From `main` (which already has both design + plan docs committed):

```bash
git worktree add ../fleet-admiral-radial-web -b feat/radial-skill-web
```

Verify `git status` in the worktree shows branch `feat/radial-skill-web`, clean, and that both `docs/plans/2026-07-08-radial-skill-web-{design,plan}.md` are present. All subsequent tasks run in that worktree.

---

## Phase 1 — Data model + pure logic (fully static-verifiable)

### Task 1: Extend talent def types; drop `requires`

**Files:**
- Modify: `src/lib/game/model.ts` (the `CaptainTalentDef` / `HomeworldTalentDef` interfaces, ~lines 252–266; the `CaptainTalentBranch` union ~line 226)

**Step 1 — write the failing test.** In `src/lib/game/model.test.ts`, add a structural test asserting the new fields exist and `requires` is gone:

```ts
import { CAPTAIN_TALENTS, HOMEWORLD_TALENTS } from "./model";

test("every talent def carries graph fields (x, y, neighbors) and no requires", () => {
  for (const def of Object.values(CAPTAIN_TALENTS)) {
    expect(typeof def.x).toBe("number");
    expect(typeof def.y).toBe("number");
    expect(Array.isArray(def.neighbors)).toBe(true);
    expect("requires" in def).toBe(false);
  }
  for (const def of Object.values(HOMEWORLD_TALENTS)) {
    expect(typeof def.x).toBe("number");
    expect(typeof def.y).toBe("number");
    expect(Array.isArray(def.neighbors)).toBe(true);
  }
});
```

**Step 2 — verify-fail (hand-trace).** Fields don't exist yet → type error / undefined. Expected fail.

**Step 3 — implement.** Update the interfaces:

```ts
export type CaptainTalentBranch = "resourcefulness" | "tactical" | "science";

export interface CaptainTalentDef {
  branch: CaptainTalentBranch;
  label: string;
  cost: number; // statPoints
  x: number;    // web-space coordinate; hub at (0,0)
  y: number;
  neighbors: CaptainTalentKey[]; // bidirectional by convention; drives BOTH connectors and fog-of-war
  isHub?: boolean;               // exactly one per branch; the fog-of-war seed (always visible, learn first)
  flavor: string;
}

export interface HomeworldTalentDef {
  branch: HomeworldTalentBranch;
  label: string;
  cost: number; // adminPoints
  x: number;
  y: number;
  neighbors: HomeworldTalentKey[];
  isHub?: boolean;
  flavor: string;
}
```

Remove the `requires` field from both interfaces. (The data tables in Tasks 2–3 supply the new fields; this task will leave the tables temporarily red — that's expected and the reviewer must be told Tasks 2–3 fix it.)

**Step 4 — verify-pass (hand-trace + static).** Interfaces compile in isolation; `requires` references now dangle in `tick.ts` (fixed in Task 5) and in the data tables (fixed in Tasks 2–3). Note these as known intermediate breakage.

**Step 5 — commit.** `git commit -m "feat(model): add graph fields to talent defs, drop requires"`

---

### Task 2: Rewrite `CAPTAIN_TALENTS` as graph data

**Files:**
- Modify: `src/lib/game/model.ts` (`CaptainTalentKey` ~283–289, `CAPTAIN_TALENTS` ~291–344, `CAPTAIN_SPEC_BONUS` ~356–359)

**Step 1 — write the failing test** (`model.test.ts`): graph integrity for captain talents.

```ts
import { CAPTAIN_TALENTS, CaptainTalentKey } from "./model";

test("captain talents: exactly one hub per branch, symmetric adjacency, all neighbors resolve", () => {
  const keys = Object.keys(CAPTAIN_TALENTS) as CaptainTalentKey[];
  const branches = new Set(Object.values(CAPTAIN_TALENTS).map((d) => d.branch));
  for (const branch of branches) {
    const hubs = keys.filter((k) => CAPTAIN_TALENTS[k].branch === branch && CAPTAIN_TALENTS[k].isHub);
    expect(hubs.length).toBe(1); // one seed per branch
  }
  for (const k of keys) {
    for (const n of CAPTAIN_TALENTS[k].neighbors) {
      expect(CAPTAIN_TALENTS[n]).toBeDefined();                 // resolves
      expect(CAPTAIN_TALENTS[n].branch).toBe(CAPTAIN_TALENTS[k].branch); // same branch
      expect(CAPTAIN_TALENTS[n].neighbors).toContain(k);        // symmetric
    }
  }
});
```

**Step 2 — verify-fail (hand-trace).** Old table has `requires`, no hub, no coords → fails.

**Step 3 — implement.** Replace the union + table. Prospector (`resourcefulness`) is rich; re-home the two ex-`command` extraction talents into it; keep Keen Eye / Lucky Strike. Tactician/Explorer get a hub only. Example shape (coordinates are the hand-authored placement — tune at the device checkpoint):

```ts
export type CaptainTalentKey =
  // resourcefulness ("Prospector")
  | "prospectorHub"
  | "prospectorBulkExtraction"    // ex-commandExtractionI
  | "prospectorRefinedExtraction" // ex-commandExtractionII
  | "prospectorKeenEyeI"
  | "prospectorKeenEyeII"
  | "prospectorLuckyStrikeI"
  | "prospectorLuckyStrikeII"
  // tactical ("Tactician") — lean stub until combat exists
  | "tacticianHub"
  // science ("Explorer") — lean stub until a science mechanic exists
  | "explorerHub";

export const CAPTAIN_TALENTS: Record<CaptainTalentKey, CaptainTalentDef & { effect: CaptainTalentEffect }> = {
  prospectorHub: {
    branch: "resourcefulness", label: "Prospector's Instinct", cost: 1, x: 0, y: 0, isHub: true,
    neighbors: ["prospectorBulkExtraction", "prospectorKeenEyeI"],
    effect: { type: "commonYieldMult", mult: 0.05 },
    flavor: "The nose for value that separates a prospector from a tourist.",
  },
  prospectorBulkExtraction: {
    branch: "resourcefulness", label: "Bulk Extraction", cost: 2, x: -180, y: -120,
    neighbors: ["prospectorHub", "prospectorRefinedExtraction"],
    effect: { type: "commonYieldMult", mult: 0.1 },
    flavor: "Standard doctrine trades finesse for throughput -- pull more common ore per cycle.",
  },
  prospectorRefinedExtraction: {
    branch: "resourcefulness", label: "Refined Extraction", cost: 4, x: -320, y: -200,
    neighbors: ["prospectorBulkExtraction"],
    effect: { type: "uncommonYieldMult", mult: 0.15 },
    flavor: "Field engineers recalibrate the intake manifolds to favor uncommon deposits.",
  },
  prospectorKeenEyeI: {
    branch: "resourcefulness", label: "Keen Eye I", cost: 2, x: 180, y: -120,
    neighbors: ["prospectorHub", "prospectorKeenEyeII"],
    effect: { type: "uncommonChanceMult", mult: 0.25 },
    flavor: "A trained eye catches what the sensors miss.",
  },
  prospectorKeenEyeII: {
    branch: "resourcefulness", label: "Keen Eye II", cost: 4, x: 320, y: -200,
    neighbors: ["prospectorKeenEyeI", "prospectorLuckyStrikeI"],
    effect: { type: "rareChanceMult", mult: 0.5 },
    flavor: "Years of fieldwork sharpen instinct into something the manuals can't teach.",
  },
  prospectorLuckyStrikeI: {
    branch: "resourcefulness", label: "Lucky Strike I", cost: 6, x: 300, y: 40,
    neighbors: ["prospectorKeenEyeII", "prospectorLuckyStrikeII"],
    effect: { type: "bonusRollChance", chance: 0.02 },
    flavor: "Some captains just have a feel for where the good ore sits.",
  },
  prospectorLuckyStrikeII: {
    branch: "resourcefulness", label: "Lucky Strike II", cost: 8, x: 420, y: 120,
    neighbors: ["prospectorLuckyStrikeI"],
    effect: { type: "bonusRollChanceMult", mult: 1.0 },
    flavor: "When the feeling's right twice in a row, it stops being coincidence.",
  },
  tacticianHub: {
    branch: "tactical", label: "Combat Readiness", cost: 1, x: 0, y: 0, isHub: true,
    neighbors: [],
    effect: { type: "commonYieldMult", mult: 0.0 }, // pure gateway until combat exists; see design §6.2
    flavor: "Discipline first. The rest of the doctrine comes when there's a war to fight.",
  },
  explorerHub: {
    branch: "science", label: "Survey Doctrine", cost: 1, x: 0, y: 0, isHub: true,
    neighbors: [],
    effect: { type: "commonYieldMult", mult: 0.0 }, // pure gateway until a science mechanic exists
    flavor: "Every uncharted system is a question. Answering it starts here.",
  },
};

export const CAPTAIN_SPEC_BONUS: Partial<Record<CaptainTalentBranch, CaptainTalentEffect>> = {
  resourcefulness: { type: "bonusRollChance", chance: 0.01 },
  // command dropped; tactical/science remain absent until their systems exist.
};
```

> **Note for the implementer:** a `mult: 0.0` gateway effect is intentional (visible node, learn-me-first, no mechanical effect yet). If a genuinely-null effect reads cleaner, add a `{ type: "none" }` union member instead — but do NOT leave a dangling non-effect. Confirm with the reviewer which is cleaner given `describeCaptainTalentEffect` (model.ts:205) must render it.

**Step 4 — verify-pass (hand-trace).** Walk the integrity test by hand: one hub per branch (✓ 3 hubs), every neighbor symmetric (check each pair), all resolve. Confirm `describeCaptainTalentEffect` handles every effect type present.

**Step 5 — commit.** `git commit -m "feat(model): CAPTAIN_TALENTS as radial graph; Prospector content; drop command/diplomacy"`

---

### Task 3: Rewrite `HOMEWORLD_TALENTS` as graph data

**Files:**
- Modify: `src/lib/game/model.ts` (`HomeworldTalentKey` ~367–373, `HOMEWORLD_TALENTS` ~375+)

**Key constraint:** **keep every existing homeworld key string unchanged** (`fleetLogisticsSlot1/2/3`, `fleetLogisticsYield`, `industryBonusOutput`, `economyTrickle`) so existing saves' `unlockedHomeworldTalents` stay valid (no homeworld refund needed in the migration). Only **add** new hub keys + the `x`/`y`/`neighbors` fields.

**Step 1 — write the failing test** (`model.test.ts`): same integrity shape as Task 2 but for `HOMEWORLD_TALENTS`, plus assert the 5 category hubs exist and all pre-existing keys still exist.

```ts
test("homeworld talents: all v14 keys preserved + one hub per category", () => {
  for (const k of ["fleetLogisticsSlot1","fleetLogisticsSlot2","fleetLogisticsSlot3","fleetLogisticsYield","industryBonusOutput","economyTrickle"]) {
    expect((HOMEWORLD_TALENTS as any)[k]).toBeDefined();
  }
  const cats = ["fleetLogistics","homelandDefense","citizenry","economy","industry"];
  for (const cat of cats) {
    const hubs = Object.values(HOMEWORLD_TALENTS).filter((d) => d.branch === cat && d.isHub);
    expect(hubs.length).toBe(1);
  }
  // symmetric adjacency + neighbors resolve (same loop as captain test)
});
```

**Step 2 — verify-fail (hand-trace).** No hubs, no coords yet.

**Step 3 — implement.** Add 5 hub entries (`fleetLogisticsHub`, `homelandDefenseHub`, `citizenryHub`, `economyHub`, `industryHub`), give each existing node coords + neighbors wiring back toward its category hub. Fleet Logistics is the rich category: hub → Slot1 → Slot2 → Slot3, plus `fleetLogisticsYield` off the hub. Homeland Defense / Citizenry are hub-only. Economy hub → `economyTrickle`; Industry hub → `industryBonusOutput`. (Coordinates hand-authored; tune at device checkpoint.)

**Step 4 — verify-pass (hand-trace).** 5 hubs; all v14 keys present; symmetry holds.

**Step 5 — commit.** `git commit -m "feat(model): HOMEWORLD_TALENTS as radial graph; category hubs; keys preserved"`

---

### Task 4: Fog-of-war visible-set derivation (pure function)

**Files:**
- Create: `src/lib/game/talentWeb.ts`
- Test: `src/lib/game/talentWeb.test.ts`

**Step 1 — write the failing test.**

```ts
import { computeVisibleTalents } from "./talentWeb";
import { CAPTAIN_TALENTS } from "./model";

test("hub is visible with zero owned; nothing else is", () => {
  const vis = computeVisibleTalents(CAPTAIN_TALENTS, "resourcefulness", []);
  expect(vis.has("prospectorHub")).toBe(true);
  expect(vis.has("prospectorBulkExtraction")).toBe(false);
});

test("owning the hub reveals its direct neighbors only", () => {
  const vis = computeVisibleTalents(CAPTAIN_TALENTS, "resourcefulness", ["prospectorHub"]);
  expect(vis.has("prospectorBulkExtraction")).toBe(true); // neighbor of hub
  expect(vis.has("prospectorKeenEyeI")).toBe(true);       // neighbor of hub
  expect(vis.has("prospectorRefinedExtraction")).toBe(false); // 2 hops out, still hidden
});
```

**Step 2 — verify-fail (hand-trace).** Function doesn't exist.

**Step 3 — implement.**

```ts
// Fog-of-war: the visible set is (hub) ∪ (owned) ∪ (direct neighbors of owned),
// restricted to a single branch/category. Hidden nodes are absent entirely.
// Generic over both talent tables (see design §2).
export function computeVisibleTalents<K extends string>(
  table: Record<K, { branch: string; neighbors: K[]; isHub?: boolean }>,
  branch: string,
  owned: K[]
): Set<K> {
  const ownedSet = new Set(owned);
  const visible = new Set<K>();
  for (const key of Object.keys(table) as K[]) {
    const def = table[key];
    if (def.branch !== branch) continue;
    if (def.isHub) visible.add(key);                 // hub is the always-visible seed
    if (ownedSet.has(key)) visible.add(key);         // owned
  }
  for (const key of ownedSet) {                      // + direct neighbors of owned
    const def = table[key];
    if (!def || def.branch !== branch) continue;
    for (const n of def.neighbors) visible.add(n);
  }
  return visible;
}
```

**Step 4 — verify-pass (hand-trace both tests against the Task 2 data).**

**Step 5 — commit.** `git commit -m "feat(game): computeVisibleTalents fog-of-war derivation + tests"`

---

### Task 5: Adapt buy-gating from `requires` to adjacency

**Files:**
- Modify: `src/lib/game/tick.ts` (`buyCaptainTalent` 843–866, `buyHomeworldTalent` 872–902)
- Test: `src/lib/game/tick.test.ts`

**Step 1 — write the failing test.** A neighbor-gated purchase: buying a node adjacent to an owned node succeeds; buying a non-adjacent node fails; buying a hub with nothing owned succeeds.

```ts
test("buyCaptainTalent gates on adjacency, not requires", () => {
  let s = /* fresh state, captain 1, plenty of statPoints */;
  expect(buyCaptainTalent(s, 1, "prospectorBulkExtraction").success).toBe(false); // not adjacent to anything owned, not a hub
  s = buyCaptainTalent(s, 1, "prospectorHub").next;                               // hub: always buyable
  expect(buyCaptainTalent(s, 1, "prospectorBulkExtraction").success).toBe(true);  // now adjacent to owned hub
});
```

**Step 2 — verify-fail (hand-trace).** Current code checks `talent.requires` (now removed) → won't compile / wrong gate.

**Step 3 — implement.** Replace the `requires` check in both functions with an adjacency+hub check:

```ts
// buyCaptainTalent — replace the `if (talent.requires ...)` block:
const isLearnable =
  talent.isHub || talent.neighbors.some((n) => captain.unlockedCaptainTalents.includes(n));
if (!isLearnable) return { next: state, success: false };
```

```ts
// buyHomeworldTalent — same pattern against state.unlockedHomeworldTalents:
const isLearnable =
  talent.isHub || talent.neighbors.some((n) => state.unlockedHomeworldTalents.includes(n));
if (!isLearnable) return { next: state, success: false };
```

Update the buy-function comments (they describe "prerequisite (if any) already unlocked" → now "hub, or adjacent to an already-unlocked node").

**Step 4 — verify-pass (hand-trace).** Re-read both functions: no `talent.requires` references remain; adjacency logic matches `computeVisibleTalents`' learnable rule; unlockCaptainSlot side-effect path untouched.

**Step 5 — commit.** `git commit -m "feat(game): gate talent purchases on graph adjacency instead of requires"`

---

### Task 6: Save migration v14 → v15

**Files:**
- Modify: `src/lib/game/save.ts` (`SAVE_VERSION` line 9 → 15; add `MIGRATIONS[14]` in the block ending ~408)
- Test: `src/lib/game/save.test.ts`

**Step 1 — write the failing test.** A crafted v14 save with a captain that has `spec: "command"` and owns old command talents → after migrate, `spec` is `null`, `unlockedCaptainTalents` is `[]`, and `statPoints` increased by exactly the frozen refund (2 + 4 = 6 for the two command talents, etc.). A captain with `spec: "resourcefulness"` keeps that spec. `unlockedHomeworldTalents` is unchanged.

**Step 2 — verify-fail (hand-trace).** No `MIGRATIONS[14]`; `SAVE_VERSION` still 14.

**Step 3 — implement.** Bump `SAVE_VERSION` to 15. Add the migration with a **frozen v14 cost snapshot** (self-contained — never reference the current `CAPTAIN_TALENTS`, which no longer holds the old keys):

```ts
// v14 -> v15: Radial Skill Web. Captain talent tree fully restructured
// (linear `requires` chains -> radial graph; command/diplomacy specs removed;
// command's extraction talents re-homed to resourcefulness). Old captain
// talent KEYS no longer exist in CAPTAIN_TALENTS, so we refund from a FROZEN
// snapshot of the v14 costs (never reference the live table for removed keys)
// and clear every captain's unlockedCaptainTalents. spec === "command" is
// cleared to null (command was the only other selectable spec besides
// resourcefulness; diplomacy was never selectable). Homeworld keys are all
// preserved (Task 3 kept every v14 key), so unlockedHomeworldTalents is left
// untouched here.
14: (state: any): GameState => {
  const V14_CAPTAIN_TALENT_COSTS: Record<string, number> = {
    commandExtractionI: 2, commandExtractionII: 4,
    resourcefulnessRareChanceI: 2, resourcefulnessRareChanceII: 4,
    resourcefulnessBonusRollI: 6, resourcefulnessBonusRollII: 8,
  };
  return {
    ...state,
    captains: state.captains.map((c: any) => {
      const refund = (c.unlockedCaptainTalents ?? []).reduce(
        (sum: number, key: string) => sum + (V14_CAPTAIN_TALENT_COSTS[key] ?? 0),
        0
      );
      return {
        ...c,
        statPoints: (c.statPoints ?? 0) + refund,
        unlockedCaptainTalents: [],
        spec: c.spec === "command" ? null : c.spec, // diplomacy never selectable; resourcefulness kept
      };
    }),
  };
},
```

**Step 4 — verify-pass (hand-trace the sample save independently).** Re-derive the refund arithmetic by hand (do NOT trust a subagent's self-report — this is the flagged high-risk step). Confirm: command-spec captain → null + correct refund; resourcefulness-spec captain unchanged spec; homeworld untouched; `hydrateDecimals()` still runs unconditionally after.

**Step 5 — commit.** `git commit -m "feat(save): v14->v15 migration for radial talent restructure (frozen-cost refund)"`

---

### Task 7: Purge dangling `requires`/`command`/`diplomacy` references

**Files:** repo-wide sweep (`src/App.svelte`, `src/lib/game/tick.ts`, any `*.test.ts`, `model.ts`)

**Step 1 — search.** Grep for `requires`, `"command"`, `"diplomacy"`, `commandExtraction`, `resourcefulnessRareChance`, `resourcefulnessBonusRoll` (old keys). Every hit outside the frozen migration snapshot must be gone or updated.

**Step 2 — verify-fail (hand-trace).** List every remaining reference.

**Step 3 — implement.** Update/remove each. Update `describeCaptainTalentEffect` if any effect type changed. Remove old talent-panel references that will be superseded in Phase 3 (coordinate with those tasks — do not delete markup Phase 3 still needs as an anchor; leave a clearly-commented stub if so).

**Step 4 — verify-pass.** Re-grep: zero stale references (except the intentional frozen snapshot in save.ts).

**Step 5 — commit.** `git commit -m "chore: purge stale requires/command/diplomacy references"`

---

## Phase 2 — Rendering & gestures (device-checkpoint gated)

### Task 8: `RadialWeb.svelte` — render the visible subgraph in a pan container

**Files:**
- Create: `src/lib/RadialWeb.svelte`

Props: `table` (talent table), `branch`, `owned` (key[]), `points` (number — statPoints or adminPoints), `pointsLabel`, and callbacks `onLearn(key)` / `onNodeTap(key)`. Internally: derive `visible = computeVisibleTalents(table, branch, owned)` reactively. Render a fixed-size `.web-viewport` (`overflow:hidden`, `touch-action:none`) containing a `.web-world` translated by `transform: translate(panX, panY)`. Place each visible node as an absolutely-positioned `.web-node` at `left:{x}px; top:{y}px` (centered via `translate(-50%,-50%)`), with the hub centered on first mount (initial `panX/panY` = half the viewport size, so `(0,0)` sits mid-viewport). No connectors yet, no drag yet — static render only.

Node state classes: `.owned`, `.learnable` (affordable), `.locked` (learnable but `cost > points`), `.hub`.

**Verification:** hand-read only (no runner). Structural correctness: only `visible` nodes render; hub centered. **Feel/layout deferred to Checkpoint A.**

**Commit:** `git commit -m "feat(ui): RadialWeb static render of visible subgraph"`

---

### Task 9: Orthogonal elbow connectors

**Files:** Modify `src/lib/RadialWeb.svelte`

Add an SVG layer inside `.web-world` (behind nodes). For each unordered visible edge `(a,b)` where both endpoints ∈ `visible`, draw `<path d="M {ax} {ay} H {bx} V {by}">` (single elbow, consistent H-then-V). Dedupe edges (each pair once). Style stroke to theme accent; owned-to-owned edges brighter than edges touching a not-yet-owned node.

**Verification:** hand-read (edges only between visible nodes; deduped). **Routing cleanliness deferred to Checkpoint A.**

**Commit:** `git commit -m "feat(ui): elbow SVG connectors between visible nodes"`

---

### Task 10: Pan + tap/drag disambiguation (Pointer Events)

**Files:** Modify `src/lib/RadialWeb.svelte`

On `.web-viewport`: `pointerdown` records `{startX,startY,panX0,panY0}` and sets dragging; `pointermove` (while dragging) sets `panX = panX0 + (e.clientX-startX)`, `panY = panY0 + (e.clientY-startY)` and accumulates total movement; `pointerup` ends dragging and, **if total movement < `TAP_THRESHOLD_PX` (const = 8) and duration short**, treats it as a tap → if the target resolves to a node, call `onNodeTap(key)`. `cursor: grab`/`grabbing`. `setPointerCapture` on down so a drag that leaves the viewport still tracks.

Mark `TAP_THRESHOLD_PX` with a comment: "feel-tune constant; verify on device (Checkpoint A)."

**Verification:** hand-read the handler logic. **Actual feel is Checkpoint A** — cannot be verified here at all.

**Commit:** `git commit -m "feat(ui): pointer-events pan with tap/drag disambiguation"`

---

### Task 11: Node tooltip overlay + Learn action

**Files:** Modify `src/lib/RadialWeb.svelte` and reuse the existing top-level tooltip backdrop pattern in `src/App.svelte` (the `.tooltip-backdrop` / `activeTooltipInfo` mechanism from the tooltip-stacking fix).

On `onNodeTap(key)`: open the shared tooltip overlay showing `label`, `describe*Effect(effect)`, cost + affordability, flavor. Include a **Learn** button, enabled only when the node is `learnable` (in `visible`, not owned) **and** affordable; clicking calls `onLearn(key)` (which the parent wires to `buyCaptainTalent`/`buyHomeworldTalent`) then closes the tooltip. Upsize the tooltip per design §4.4 (the `280px/85vw` from the stacking fix was a placeholder — bump modestly; final size is a Checkpoint item).

**Verification:** hand-read wiring (Learn only for learnable+affordable; buy call correct). **Sizing/interaction feel deferred to Checkpoint A/B.**

**Commit:** `git commit -m "feat(ui): node tooltip + Learn action wired to buy functions"`

---

### ✅ Task 12 — DEVICE CHECKPOINT A (user action required)

**Not a code task.** Temporarily mount `RadialWeb` against the Prospector tree (a throwaway harness or the real captain panel with hardcoded props) so the user can load the branch on **desktop + phone** and report:
1. Pan feel (smooth? the 8px threshold — accidental taps while dragging, or missed taps?).
2. Elbow connectors — do the Task-2/3 coordinates route cleanly, or do specific pairs cross/overlap?
3. Fog-of-war reveal — learning a node reveals neighbors correctly; off-screen reveals feel OK?
4. Node/tooltip sizing on a real phone.

Apply coordinate/threshold/size adjustments from the feedback before Phase 3. **Do not proceed past this checkpoint without the user's report.**

---

## Phase 3 — Selectors & integration

### Task 13: `TreeSelector.svelte` — cards + live description panel

**Files:**
- Create: `src/lib/TreeSelector.svelte`
- Create/add data: `specCards` (3) + `categoryCards` (5) description tables in `model.ts`, each `{ title, flavor, bullets: string[] }`.

Props: `cards` (array of `{key, title, flavor, bullets}`), `commitLabel` (`"Choose this spec"` | `"View Tree"`), `onCommit(key)`. Render the card row (wraps on narrow screens) + a live description panel bound to the focused card (tap/click; hover on desktop) + the commit button. Purely presentational; commit semantics live in the parent.

**Test:** `TreeSelector` is presentational, but add a `model.test.ts` assertion that `specCards` has 3 entries keyed to the 3 branches and `categoryCards` has 5 keyed to the 5 categories.

**Verification:** hand-read + the data test. **Card layout on device = Checkpoint B.**

**Commit:** `git commit -m "feat(ui): TreeSelector card+description component and card data"`

---

### Task 14: Wire the Captain Talents panel

**Files:** Modify `src/App.svelte` (the Captain Talents panel region — the block that currently renders the depth-row captain tree)

Behavior: for the selected captain, if `captain.spec === null` → render `<TreeSelector cards={specCards} commitLabel="Choose this spec" onCommit={chooseSpec}/>` where `chooseSpec(branch)` sets the spec (via `respecCaptainTalents(state, id, branch)` if a spec-set-with-reset is the agreed path, or a lighter dedicated setter if the captain had no spec — confirm which against the design; a first-time choice from `null` should NOT cost a respec). If `spec !== null` → render `<RadialWeb table={CAPTAIN_TALENTS} branch={captain.spec} owned={captain.unlockedCaptainTalents} points={captain.statPoints} pointsLabel="Stat Points" onLearn={(k)=>buyCaptainTalent(...)} />`. Delete the old depth-row captain-tree markup + its now-orphaned CSS.

> **Design clarification to confirm during execution:** first-time spec choice from `null` is free (you're not resetting anything); only *changing* an existing spec routes through the 50-credit respec. `respecCaptainTalents`' `newSpec` arg already supports the change path; the free first-pick may want a dedicated tiny setter or a `credits`-skipping branch. Flag to the user if ambiguous (do not let a subagent guess — project workflow rule 6).

**Verification:** hand-read the conditional + prop wiring; confirm no orphaned references to deleted markup. **Full flow = Checkpoint B.**

**Commit:** `git commit -m "feat(ui): captain talents panel uses TreeSelector + RadialWeb"`

---

### Task 15: Wire the Fleet Admiral (Homeworld) Talents panel

**Files:** Modify `src/App.svelte` (the Homeworld Talents panel region)

Behavior: local `selectedCategory` state (not persisted — pure navigation). If `selectedCategory === null` → `<TreeSelector cards={categoryCards} commitLabel="View Tree" onCommit={(cat)=>selectedCategory=cat}/>`. Else → `<RadialWeb table={HOMEWORLD_TALENTS} branch={selectedCategory} owned={state.unlockedHomeworldTalents} points={state.adminPoints} pointsLabel="Admin Points" onLearn={(k)=>buyHomeworldTalent(...)} />` plus a **"← Categories"** button that sets `selectedCategory = null`. Delete the old depth-row homeworld-tree markup + orphaned CSS.

**Verification:** hand-read; confirm `selectedCategory` is view-only (never saved); no orphaned refs.

**Commit:** `git commit -m "feat(ui): homeworld talents panel uses TreeSelector + RadialWeb"`

---

### ✅ Task 16 — DEVICE CHECKPOINT B (user action required)

**Not a code task.** User loads the full branch on desktop + phone and exercises: choosing a Prospector spec (and confirming a first pick is free), learning nodes outward, respec, the 5 Fleet Admiral category cards → View Tree → back, tooltip Learn on each. Report layout/feel issues; apply fixes. **Do not merge before this passes.**

---

## Phase 4 — Cleanup, docs, review

### Task 17: Dead-code + orphaned-CSS sweep

**Files:** `src/App.svelte` (CSS), anywhere the old `.skill-node` depth-row styling lived.

Remove CSS/classes orphaned by Tasks 14–15 (per the standing KNOWN_ISSUES note about orphaned `.captain-tabs` etc., verify nothing else still uses a class before deleting). One concern per commit.

**Commit:** `git commit -m "chore: remove talent depth-row dead code and orphaned CSS"`

### Task 18: Docs — SESSION_LOG, KNOWN_ISSUES, PATCH_NOTES

**Files:** `SESSION_LOG.md` (append one entry), `KNOWN_ISSUES.md` (update the inert-talent-effects item to reflect the new lean stubs + gateway hubs; note the Tactician/Explorer/most-Homeworld stubs), `src/App.svelte` PATCH_NOTES entry (new version line).

**Commit:** `git commit -m "docs: session log, known issues, patch notes for Radial Skill Web"`

### Task 19: Final holistic review + merge

Per project workflow: dispatch **one final holistic review** of the whole branch (cross-task integration — migration ↔ data ↔ buy-gating ↔ reveal ↔ UI wiring — not per-task re-litigation; static only, no WebSearch/WebFetch). Apply small doc/comment fixes directly. Then **ask the user** before merging to `main` and before any push (push = live Vercel redeploy — never without fresh explicit confirmation). Merge locally, remove the worktree/branch.

---

## Done =
- All Phase 1 tests pass (when run in a real Node env) and hand-trace clean now.
- Both talent panels render the radial web with fog-of-war, pan, elbow connectors, and Learn-from-tooltip.
- Captain spec cards commit (first pick free, change = respec); Fleet Admiral category cards navigate.
- Save migration v14→v15 refunds cleanly (hand-verified independently), no dangling keys, testers keep their points.
- Device Checkpoints A + B passed on desktop + phone.
- Deferred items in SUGGESTIONS.md; KNOWN_ISSUES/SESSION_LOG/PATCH_NOTES updated.

---

## Plan revision (2026-07-08, mid-execution, after Task 5)

Discovered while executing: **device testing is via Vercel *preview* deployments of the pushed feature branch** (the dev machine has no Node, so there is no local dev server). A preview only exists if the branch **compiles end-to-end**. The original Phase 2/3 ordering put Checkpoint A *before* the App.svelte rewiring (Tasks 14/15), but App.svelte's old depth-row panels reference the now-removed talent shape (`.requires` walks in `talentDepth`, a `Record<CaptainTalentBranch,…>` label map with `command`/`diplomacy` keys, hardcoded branch arrays) and therefore will not compile until those panels are replaced. So Checkpoint A as originally sequenced could not produce a buildable preview.

**User decisions (2026-07-08):** (1) testing = Vercel preview from the branch (separate URL, does NOT touch production `main`/hyperion-legacy.vercel.app); (2) keep TWO checkpoints, minimal-integration first.

**Amended sequencing (supersedes the Phase 2/3 task ordering above where they conflict):**

- **Task 7 (revised scope):** the purge also fixes **real production code**: `captainCommonYieldMult` in `tick.ts` (~lines 62–89) folds in `CAPTAIN_SPEC_BONUS.command` / `captain.spec === "command"`, both removed in Task 2 — this must be reverted to just the talent sum (the `resourcefulness` spec bonus via `captainSpecBonusRollChance` stays). Task 7 fixes `tick.ts` production + `tick.test.ts` (~48 stale refs). Task 7 does **NOT** touch App.svelte's talent panels (they're removed in the integration task below).
- **Tasks 8–11 (unchanged):** build `RadialWeb.svelte` as a standalone component (compiles on its own).
- **NEW Task 11b — Minimal buildable integration (Checkpoint A prep):** In `App.svelte`, DELETE the old depth-row talent-panel rendering + the `talentDepth` helper + the `CAPTAIN_TALENT_BRANCH_LABEL` map + the branch-array `{#each}` blocks + all `.requires` template references. Mount `<RadialWeb>` directly in BOTH talent panels with a **hardcoded** branch (captain → `"resourcefulness"` / Prospector, defaulting when `spec` is null; homeworld → `"fleetLogistics"`), NO TreeSelector yet. Goal: the branch COMPILES and builds on Vercel. This is the first buildable milestone.
- **Task 12 — DEVICE CHECKPOINT A:** push the branch → open the Vercel **preview** URL on desktop + phone → verify pan feel, elbow connectors, fog-of-war reveal, node/tooltip sizing. (Ask the user before pushing; it's a preview, not production, but confirm anyway.)
- **Task 13 (unchanged):** `TreeSelector.svelte` + `specCards`/`categoryCards` data.
- **Tasks 14–15 (reframed):** LAYER the TreeSelector selection UX *in front of* the already-mounted RadialWeb. Captain: `spec === null` → selector (first pick free — CONFIRM with user, see Task 14 note), else the captain's spec web. Fleet Admiral: 5 category cards → "View Tree" → that category's web + "← Categories". Replaces the hardcoded branches from Task 11b.
- **Task 16 — DEVICE CHECKPOINT B:** full flow on the Vercel preview.
- **Tasks 17–19 (unchanged):** cleanup, docs, holistic review + merge.

The end product is identical to the original plan; only the intermediate build/checkpoint ordering changed to respect the compile-before-preview constraint.
