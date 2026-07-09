# Radial Skill Web — Design

**Date:** 2026-07-08
**Supersedes:** the depth-based-rows + straight-SVG-connector layout shipped in the Talent Tree
Visual Redesign (`docs/plans/2026-07-08-talent-tree-visual-redesign-design.md`, Tasks 10/11). That
feature's *non-visual* parts (the `credits` currency, full-reset respec, Captain Specialization
mechanic, per-node tooltips with flavor + numeric effects) all carry forward unchanged. Only the
**tree rendering approach** is being replaced.

This document absorbs and retires `SESSION_HANDOFF.md` (Radial Skill Web pre-brainstorm), whose open
questions are all resolved below.

## Motivation

After the Talent Tree Visual Redesign shipped, the user clarified that the depth-based row layout
(round `.skill-node` elements in prerequisite rows, straight diagonal SVG connectors) did not match
their intended structure. Via a live mockup-driven conversation they landed on a **pannable, radial
"skill web"** — nodes radiating outward from a central hub in all directions, similar in spirit to
Final Fantasy X's Sphere Grid, with progressive "fog of war" reveal so only the player's local
neighborhood is ever on screen. Two mockups were provided (see "Mockup reference" below).

## Scope decision (settled during brainstorming)

This feature is a **radial-web framework, not a content dump.** The user confirmed they want "lots of
talents" eventually, but the mechanical systems to give most talents real effects do not exist yet
(combat/Battlespace for the Tactician spec, a redefined Science mechanic for the Explorer spec; and
per `KNOWN_ISSUES.md`, 5 of 6 existing talent effects are still unwired). Authoring ~40 nodes per
tree now would create ~100+ mechanically-inert nodes.

Chosen scope: **build the framework + ship lean, honest content**, and grow node counts later per
spec as each underlying system comes online. Fog-of-war is the key enabler — because you only ever
see owned nodes + their immediate neighbors, even a lean real tree feels substantial (you never see
the whole graph at once).

## Two contexts, one radial mechanic

The same radial-web machinery serves two callers that differ only in card count, commit semantics,
and button label:

| | **Captain tree** | **Fleet Admiral (Homeworld) tree** |
|---|---|---|
| Selector cards | 3 specs: Prospector / Tactician / Explorer | 5 categories: Fleet Logistics / Homeland Defense / Citizenry / Economy / Industry |
| Commit button | **"Choose this spec"** — sets `CaptainState.spec`, respec-costed to change | **"View Tree"** — pure navigation, no lock-in, freely reversible |
| After entering | that spec's radial web | that category's radial web |
| Reveal | fog-of-war (hub-seeded) | fog-of-war (hub-seeded) |
| Points spent | that captain's `statPoints` | fleet-wide `adminPoints` |

Note the handoff's guess that "Homeworld = one unified web with 5 spokes" was **wrong** — it is 5
separate category webs, each entered via its own card, structurally identical to the captain flow
minus the lock-in.

## Mockup reference

The two mockup images were pasted inline in chat and are **not stored in the repo** (no file paths to
reference). Prose descriptions preserved here so intent survives regardless:

- **Mockup A — spec/category selection screen:** A row of cards (3 for captain: "Resourcer [name
  TBD]", "Tactician", "Explorer"; 5 for fleet admiral), each with a wireframe-art placeholder box.
  Below, one full-width description panel that swaps live to the currently-focused card: flavor text +
  bullet points + a "Do you want to select this spec?" prompt and a commit button.
- **Mockup B — the tree itself:** A dense web of square/rectangular nodes connected by lines,
  radiating from a central (double-bordered) hub node, filling and spilling past the panel edges. The
  sketch's diagonal connector lines are rough-draft only — the real connectors are clean orthogonal
  "elbow" routes. (The "Command" label in this sketch was placeholder scribble; it was drawn as a
  fleet-admiral example.)

*If the user later drops the PNGs into `docs/plans/assets/`, link them here.*

---

## Section 1 — Data model (the graph shift)

### 1.1 Linear chains → graph

Today each talent def encodes a single-parent chain via `requires: <one key | null>`. A radial web
needs a graph. Each `CaptainTalentDef` / `HomeworldTalentDef` gains:

- `x: number`, `y: number` — hand-authored coordinates in an abstract "web-space" with the hub at
  origin `(0, 0)`. Positive x = right, positive y = down (screen convention). Because positions are
  hand-authored, **what is typed is exactly what renders** — no layout algorithm that could silently
  produce overlaps we cannot see (there is no browser on this machine to verify one).
- `neighbors: Key[]` — the nodes this node connects to. Bidirectional by convention (if A lists B, B
  lists A). This single field drives **both** connector rendering **and** fog-of-war reveal.
- `requires` is **removed** — adjacency + ownership replaces it. A node becomes learnable once *any*
  neighbor is owned (not a strict single-prerequisite chain).

### 1.2 Every tree gets a hub

One node per spec/category, flagged `isHub: true`, positioned at origin. It is the fog-of-war seed:
visible on entry, must be learned first, may carry a small starter effect. All other nodes have
`neighbors` that ultimately trace back toward the hub.

### 1.3 Branch enum + content changes

- `CaptainTalentBranch` reduces to `"resourcefulness" | "tactical" | "science"`. **`command` and
  `diplomacy` are removed entirely** (they were "vague placeholders that didn't work well").
- The two `command` extraction talents (Bulk Extraction → Refined Extraction, `commonYieldMult` /
  `uncommonYieldMult`) are **re-homed under `resourcefulness`** — extraction-yield effects fit the
  Prospector salvage/resource theme.
- `HomeworldTalentBranch` keeps all 5 categories unchanged.
- `CAPTAIN_SPEC_BONUS`: drop the `command` entry; keep `resourcefulness`. (Tactical/science remain
  absent from this table until their systems exist — same "not yet a real spec bonus" convention as
  today.)

Display name: the `resourcefulness` spec renders as **"Prospector"** (internal key stays
`resourcefulness`; display string only, cosmetic and changeable). Chosen over Salvager/Reclaimer/
Scavenger for its frontier resource-hunter connotation, which umbrellas wrecks + ore + organics via
"the pursuit of worth" rather than one material; branch/node names can carry the per-activity
specifics (Salvage / Mining / Foraging).

### 1.4 Ownership + currency unchanged

Captain talents still cost `statPoints` and record into `unlockedCaptainTalents`; Homeworld still
costs `adminPoints`. Fog-of-war is purely a *view* derived from existing ownership + the static
`neighbors` graph — **no new ownership storage.**

### 1.5 Save migration — `SAVE_VERSION` 14 → 15

Because talent keys and structure change, a new numbered migration entry is required (never edit a
shipped migration body — the project's hard save-schema rule):

- Any captain whose `spec` is `command` or `diplomacy` → reset `spec` to `null`.
- For **all** captains: reset `unlockedCaptainTalents` and refund spent `statPoints` (the tree they
  bought into no longer exists in the same shape) — a clean, visible refund, not a silent wipe.
- Homeworld talents surviving by key (the Fleet Logistics slot unlocks) are preserved; any removed
  keys are refunded to `adminPoints`.
- **This matters because there are live testers.** The migration hand-trace against a sample save is
  a required verification step (Section 7).

---

## Section 2 — Fog-of-war reveal

### 2.1 Three node states

| State | Condition | Rendered? | Appearance |
|---|---|---|---|
| **Owned** | key ∈ owned set | Yes | solid / lit |
| **Learnable** | not owned, but ≥1 neighbor owned | Yes | outlined; affordable vs. too-expensive styling |
| **Hidden** | not owned, no owned neighbor | **No — absent from the DOM entirely** | invisible |

Visible set = `owned ∪ (direct neighbors of owned)`. Hidden nodes are genuinely not rendered, not
merely dimmed — a clean break from today's "render everything, gray the locked ones."

### 2.2 The seed

On first entry the owned set is empty, so by the rule above nothing would show. The **hub is the one
bootstrap exception**: always in the visible set even at zero owned nodes. Learn the hub → its
neighbors become Learnable and appear → learn one of those → *its* neighbors appear → outward from
there. (This overrides the earlier mockup-1 "root is inert/decorative, not granted" note — settled
directly with the user: the hub is the first node you must learn.)

### 2.3 Visibility vs. affordability are independent

A Learnable node renders even when unaffordable (you can see and save toward what's next); the
`cost > points` case only styles it as not-yet-purchasable and disables its Learn action. Visibility
= graph adjacency; purchasability = points.

### 2.4 Connectors follow the same rule

An elbow connector is drawn only when *both* endpoints are currently visible — no lines dangling into
hidden space.

### 2.5 Reactivity

The visible set is a derived (Svelte `$:`) value over the owned set + static `neighbors` graph,
recomputed on every purchase. No manual show/hide bookkeeping.

### 2.6 Edge case (device-checkpoint item)

A newly-revealed node may appear off the current pan viewport. v1 does nothing special (it is
adjacent to the just-clicked node, so it is right there); auto-recenter-on-learn is deferred to
SUGGESTIONS.md and flagged as a feel-check for device testing.

---

## Section 3 — Layout & rendering

### 3.1 Coordinate space

Each node's authored `{x, y}` is in abstract web-space, hub at `(0, 0)`, 1:1 with pixels at rest (no
zoom in v1). Authoring a tree = choosing these numbers.

### 3.2 Render stack (three layers, translated together by pan offset)

1. **Viewport** div — fixed size, `overflow: hidden`, clips the web (the "window"). Sized to the
   available panel space via the existing `.tab-scroll-area` sizing.
2. **World** container — translated by `transform: translate(panX, panY)`. Everything spatial lives
   here and moves as one unit when panning.
3. Within the world: one **SVG layer** for connectors (drawn first, underneath) + **absolutely-
   positioned node squares** on top (`left: x, top: y`, centered via transform).

Panning updates `panX / panY` (one transform on the world container); nodes and connectors move in
lockstep with no per-element repositioning.

### 3.3 Elbow connectors

For each visible edge, draw an orthogonal SVG path (single elbow: horizontal from A to B's x, then
vertical to B — `<path d="M ax ay H bx V by">`), with a consistent bend direction so the web reads as
tidy circuit-trace routing. **No obstacle-avoiding router in v1** — since positions are hand-placed,
author coordinates that route cleanly; if a specific pair looks bad, nudge a coordinate rather than
build a routing engine. Smart routing → SUGGESTIONS.md.

### 3.4 Node shape & states

Square nodes (per mockup), fixed pixel size, hub visually distinct (larger / double-border). Owned =
filled; Learnable-affordable = outlined-bright; Learnable-too-expensive = outlined-dim.

### 3.5 Responsive behavior

The *viewport* flexes to available space (desktop bigger, mobile smaller); web-space coordinates stay
fixed. Small screens simply see less at once and pan more — which fog-of-war already assumes.

---

## Section 4 — Gesture handling (pan + tap)

### 4.1 Unified input via Pointer Events

Use `pointerdown / pointermove / pointerup` (Pointer Events API) — one code path for mouse, touch,
and stylus. This is the single most important choice for keeping the (untestable-here) gesture code
small and correct. `touch-action: none` on the viewport disables the browser's native scroll/pan so
it does not fight the drag on mobile.

### 4.2 Pan

On `pointerdown` on the web background: record start point + current `panX / panY`. On `pointermove`
while down: `panX / panY = start + (current − down)`. On `pointerup`: release.

### 4.3 Tap vs. drag disambiguation

Track total movement between down and up. Under a small threshold (~**8px**) and quick → **tap** on
the node under the pointer → open tooltip. Over the threshold → **pan**, no tooltip. The 8px value is
a feel-tune constant, clearly commented and flagged as a device-checkpoint item.

### 4.4 Tooltip = Learn action

Tap on a Learnable/Owned node opens the top-level tooltip overlay (reusing the full-screen
dim+blur `.tooltip-backdrop` pattern from the recent tooltip-stacking fix, upsized per mockup-1
feedback), showing flavor + numeric effect + cost, with a **Learn** button that commits the purchase
(disabled when unaffordable). Hidden nodes cannot be tapped (absent from DOM); empty web-space taps do
nothing (or begin a pan).

### 4.5 Deferred (SUGGESTIONS.md)

No pan momentum/inertia in v1. Desktop niceties included: `cursor: grab` / `grabbing`. No scroll-wheel
binding (zoom-adjacent, deferred).

---

## Section 5 — Selector screens (spec cards vs. category cards)

### 5.1 Shared layout (mockup A)

A row of cards (3 captain, 5 fleet admiral), each a title + wireframe-art box; on narrow screens the
row wraps/scrolls rather than sprawling horizontally. Below, one description panel that swaps live to
the currently-focused card (tap on mobile / click or hover on desktop): flavor + bullet list + commit
button. Nothing commits until the button is pressed.

### 5.2 Captain flow

`spec === null` → show 3 spec cards (Prospector / Tactician / Explorer). Focus a card → description
updates → **"Choose this spec"** sets `CaptainState.spec`; thereafter the captain's Talents sub-tab
renders that spec's web. Changing later = the existing 50-credit respec (clears `spec` + refunds),
returning to the 3-card screen.

### 5.3 Fleet Admiral flow

Always show 5 category cards (no `spec` field, no lock-in). Focus a card → description updates →
**"View Tree"** navigates into that category's web. Inside a category web, a **"← Categories"** back
control returns to the 5-card screen. Switching categories is free and reversible.

### 5.4 One component, two configs

The card grid, live description panel, and web-underneath are identical machinery. Implement as one
parameterized selector component (card source list, commit behavior, button label) rather than two
parallel implementations — the captain and fleet-admiral panels already risk drifting apart today.

### 5.5 Card description data

New small static tables — `specCards` (3 entries) + `categoryCards` (5 entries), each
`{ title, flavor, bullets[] }` — feeding the live description panel. Authored as data, editable as
text, not baked into markup.

---

## Section 6 — Content this build ships (lean, honest)

All costs/effects are launch placeholders (same convention as `MISSIONS` / `RECIPES`), explicitly
tunable, not balance-tested.

### 6.1 Prospector (`resourcefulness`) — the richest tree

- **Hub** — starter node (small cost, small effect: a modest loot/extraction nudge, or a pure
  gateway).
- Re-homed **Bulk Extraction → Refined Extraction** (ex-`command` extraction-yield talents).
- Existing **Keen Eye I/II** (uncommon/rare chance) and **Lucky Strike I/II** (bonus roll).
- Hand-placed radial spread from the hub with simple L-elbow connectors. The one tree that feels like
  a web at launch, and every node here has a working effect.

### 6.2 Tactician (`tactical`) & Explorer (`science`) — lean

- **Hub only, or hub + 1–2 nodes.** Their real effects depend on combat / science systems that do not
  exist, so no inert filler is authored. The hub may carry a tiny generic effect or be a pure gateway
  so it is not literally nothing. These trees grow via follow-up features when their systems land.
- Both still render correctly (hub visible, "learn me first") for a consistent UX — just short.

### 6.3 Fleet Admiral categories

- **Fleet Logistics** — real content: the 3 slot-unlock tiers + the yield talent, laid out radially
  with a hub.
- **Homeland Defense / Citizenry / Economy / Industry** — lean (hub + existing sparse entries where
  they exist, e.g. Industry / Economy have one entry each today). Grown later.

---

## Section 7 — Verification strategy

**Hard constraint:** Node / npm / tsc are absent from this machine (re-confirmed at session start).
Nothing here is run — no dev server, no tests, no type-checker. Two tracks:

### Track A — verifiable by static reading (subagent + independent re-check)

- Data-model consistency: every `neighbors` reference resolves to a real key; adjacency is symmetric;
  every non-hub node has a path back to its hub; no orphan nodes.
- Reveal derivation correct by hand-trace: seed = hub, `owned ∪ neighbors-of-owned`, recomputed on
  purchase.
- Save migration v14→v15 hand-traced against a sample save: command/diplomacy specs reset, statPoints
  refunded correctly, surviving Homeworld keys preserved, no dangling keys. **The refund arithmetic is
  re-derived independently, not taken from a subagent's self-report** (per this project's workflow,
  which has caught real subagent-missed bugs before).
- No references to deleted `requires` / `command` / `diplomacy` remain anywhere (App.svelte, tick.ts,
  save.ts, tests).
- TypeScript *reasoning* (not compilation): union changes propagate; exhaustive switches updated.

### Track B — only the user's device can confirm (unverifiable here)

1. Pan feel (smooth vs. sticky; the 8px tap/drag threshold).
2. Elbow connectors — do the hand-placed coordinates route cleanly, or do specific pairs cross/overlap?
3. Fog-of-war reveal feel — is a newly-appearing (possibly off-screen) node satisfying or confusing?
4. Mobile touch — tap-hold-drag, `touch-action: none`, node hitbox sizes on a real phone.
5. Selector + tooltip sizing — cards on narrow screens, tooltip upsizing.

### Device checkpoints

Explicit checkpoints in the plan, not one reveal at the end — most usefully (a) after the render+pan
skeleton works (before content authoring) and (b) after the first real tree (Prospector) is
populated. The user loads it on desktop + phone, reports back, coordinates/thresholds get adjusted.
Budget 1–2 such round-trips. Static review does not substitute for these (per the project's own
observability rules).

---

## Deferred → SUGGESTIONS.md

- Zoom (pinch on mobile / scroll or ± buttons on desktop).
- Pan momentum / inertia (flick-to-glide).
- Smart obstacle-avoiding orthogonal connector routing.
- Auto-recenter the view on a freshly-learned node.
- The full "lots of talents" density expansion + wiring the currently-inert talent effects, per spec,
  as each underlying system (combat, science, etc.) ships.

## Open items intentionally left to the plan / later

- Exact hub cost + whether hubs carry a real starter effect vs. pure gateway (balance detail).
- Final tooltip pixel sizing (the tooltip-stacking fix's `280px / 85vw` was a placeholder).
- Precise hand-authored coordinates for every node (produced during implementation, adjusted at the
  device checkpoint).
