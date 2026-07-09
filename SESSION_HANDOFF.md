# Session Handoff — Radial Skill Web Redesign (pre-brainstorm)

**Written:** 2026-07-08, end of the session that shipped the Talent Tree Visual Redesign feature
and its tooltip-stacking follow-up fix. This document exists so a **fresh conversation** can pick
up exactly where this one left off, per this project's CLAUDE.md Session Discipline rule (14d):
read this first, before anything else, when starting the next session on fleet-admiral.

## Immediate repo state (verify freshly, don't trust this if time has passed)

- Branch: `main`. Local `main` is **2 commits ahead of `origin/main`**, not yet pushed:
  - `762d11e` / `6e4c3b1` — a fix for tooltip stacking (see "Just-shipped context" below).
  - Pushing triggers a live Vercel production redeploy — **ask the user explicitly before pushing**,
    per this project's established practice all session.
- No uncommitted changes; working tree clean as of this writing.
- `SAVE_VERSION` is currently 14.

## Just-shipped context (for background — this is DONE, not part of the new work)

Two things shipped this session, in order:

1. **Talent Tree Visual Redesign** (`feat/talent-tree-visual-redesign`, merged + pushed to
   `origin/main` at commit `0017538`): added a `credits` currency, full-reset respec (50 credits)
   for both Captain and Homeworld talent trees, a revived "Captain Specialization" mechanic
   (`CaptainState.spec`, a `CAPTAIN_SPEC_BONUS` table), and a first-pass visual tree redesign —
   depth-based row layout with straight SVG connector lines between round `.skill-node` elements,
   replacing the old flat list. Docs: `docs/plans/2026-07-08-talent-tree-visual-redesign-design.md`
   and `-plan.md`.
2. **Tooltip stacking fix** (two local commits on `main`, not yet pushed): the user reported (with a
   mobile screenshot) that tooltips from step 1 rendered as an unreadable overlapping mess. Root
   cause: the tooltip was `position:absolute` relative to its own small talent node, so tall content
   spilled into the next node's row. Fixed by rendering tooltips as a single, shared, top-level
   `.tooltip-backdrop` overlay (full-screen dim + blur, exactly matching the existing
   `.modal-backdrop` pattern used by DELETE SAVE / respec confirmation modals) driven by a new
   `activeTooltipInfo` reactive value + `talentTooltipInfo()` lookup function in `App.svelte`. A
   first attempt at this fix nested the backdrop inside a `<Panel>`, which has its own
   `backdrop-filter` and therefore became an unwanted containing block for the `position:fixed`
   overlay (confirmed via review) — the corrected version renders the tooltip as a genuine top-level
   sibling, same as every `.modal-backdrop` usage.

**Right after this fix shipped**, the user said the *tooltip* fix looked right, but the *tree
structure itself* doesn't match what they actually envisioned — "some of it is right but needs
fixing... the structure of the talent tree doesn't match what I was after." What follows is the new
direction, worked out via a live mockup-driven conversation. **This new direction fully supersedes
the depth-based-rows-with-straight-connectors visual layout from step 1's Tasks 10/11** — expect to
replace that rendering approach, not extend it.

## The new direction: a pannable, radial "skill web" (not a top-down tree)

This evolved through several mockups in conversation (described in prose below since the actual
image files were pasted inline in chat, not saved to the repo — no file paths to hand off).

**Mockup 1 (starting point):** A classic WoW-style talent tree — square nodes, connector lines,
strictly top-down/vertically descending, multiple branches splitting off a single root at the top.
Feedback on this one, all still valid as general principles for whatever the final layout becomes:
- Connector/row spacing should be **responsive** — more breathing room on desktop, more compressed
  on mobile — rather than a fixed pixel gap.
- The tree column needs a **max-width** so it stays legible on both platforms; vertical scroll is
  fine, horizontal sprawl is not (this specific constraint gets superseded by the pannable-canvas
  idea below, but "stay legible/organized on mobile" remains the underlying goal).
- The **root/top node is inert/decorative** — not something granted for free the moment a spec is
  chosen. (Open question for the new radial design: does the *central hub* node play this same
  "decorative, not really a talent" role, or does the hub mean something different now? Needs
  re-confirming once the radial layout is nailed down.)
- Tooltips should render **a bit bigger** than the size shipped in the tooltip-stacking fix (that
  fix used `width: 280px; max-width: 85vw` — treat this as a placeholder to revisit, not a fixed
  target).

**Then a scope-expanding realization mid-conversation:** the mockup's node density (~20+ nodes,
real branching) is far beyond what's actually implemented today (each Captain Talent branch
currently has only 2-4 real nodes, e.g. Resourcefulness has just Keen Eye I/II + Lucky Strike I/II).
**Confirmed explicitly by the user: this is not just a visual mockup convention — they want to
actually flesh out substantially more real talent content ("I want lots of talents").** Any future
plan needs to treat "write a lot more real `CAPTAIN_TALENTS`/`HOMEWORLD_TALENTS` entries" as
in-scope work, not just a rendering change.

**Mockup 2 (the "no spec chosen yet" state):** Three side-by-side spec cards (labeled "Resourcer
(name TBD — alternatives floated: Salvager/Gatherer)", "Tactician", "Explorer" — these map to the
existing internal branch keys `resourcefulness`, `tactical`, `science` respectively; see "Data model
notes" below), each with a placeholder wireframe-art box. Below them, a single reactive description
panel showing flavor text + bullet points for whichever spec is currently being previewed/hovered
(not yet confirmed), plus a "Do you want to select this spec? [Accept]" confirmation action. The
whole description panel's content (bullets, art, confirm button) swaps live based on which of the 3
cards is currently highlighted, before any commitment happens.

**Confirmed reduction: only 3 Captain specs going forward** (`resourcefulness`→"Resourcer"/TBD-name,
`tactical`→"Tactician", `science`→"Explorer"). **`command` and `diplomacy` are being dropped as
spec options** — the user's words: "The others were just vague placeholders that didn't quite work
well." Open question for the next session: does this mean `command`/`diplomacy` get fully removed
from the `CaptainTalentBranch` union and `CAPTAIN_TALENTS` table, or just hidden/deprioritized as
unselectable while the branch data technically still exists? Not yet decided — ask explicitly before
touching `model.ts`.

**Homeworld gets the same visual pattern (card selector → tree view) but different semantics:**
no lock-in, no respec cost tied to it — a Homeworld category button just **navigates** you into that
section, it isn't a committed choice. **Homeworld keeps all 5 existing categories**
(`fleetLogistics`, `homelandDefense`, `citizenry`, `economy`, `industry` — unchanged from today).

**Mockup 3 (the actual "final" structural idea, confirmed as the direction to build toward):** Not a
top-down tree at all — a **radial/spoke web** radiating outward from **one shared central hub node**,
similar in spirit to Final Fantasy X's Sphere Grid. Take the branching wedge-shape from mockup 1 and
mirror/rotate copies of it outward in multiple directions from the same center point, so the whole
thing becomes one interconnected web with strands reaching out in several directions rather than one
single downward-branching tree. For Homeworld specifically: the 5 existing categories become **spokes
of one shared radial web** (not 5 fully separate isolated trees) — exact semantics still need
confirming (see open questions below).

Concrete behavior confirmed for this final design:
- The web **extends past the visible viewport** in multiple directions.
- **Drag-to-pan**: click-drag on desktop, tap-hold-drag on mobile, to move the visible window around
  the web.
- Tap/click a node → tooltip pops up (reusing whatever tooltip mechanism exists, upsized per the
  mockup-1 feedback above) → a "Learn" button commits the pick.
- **Progressive/incremental reveal ("fog of war"):** only nodes that are either already owned OR
  directly connected to an already-owned node are ever rendered. Start with a single visible node;
  learning it reveals the next layer of connected-but-previously-hidden nodes; the rest of the web
  stays completely invisible until reached. This is explicitly the answer to "how do we support
  'lots of talents' without the screen becoming unmanageable" — you only ever see your own local
  neighborhood, never the whole graph at once.
- **Connector style:** the user's own rough sketch used messy diagonal lines and explicitly asked
  for something prettier — **right-angle/orthogonal "elbow" connectors** (like circuit-board traces
  or flowchart connectors) instead of diagonal straight lines, so nodes appear to "evenly disperse
  outward" in a clean, organized way rather than a tangled web.

## Why this is a bigger build than anything shipped so far this session

Flagged explicitly in conversation and worth re-flagging to whoever picks this up: this is a
genuinely bigger technical undertaking than the straightforward CSS/flexbox layouts built all
session so far. It needs, at minimum:
- Real pan/drag gesture handling unified across mouse and touch (and possibly pinch/button zoom,
  though the final mockup emphasized pan over zoom — worth explicitly re-confirming whether zoom is
  still wanted at all, since the earlier "Sphere Grid" framing mentioned it but the final mockup's
  description didn't).
- A genuine 2D/radial graph layout algorithm (positioning nodes outward from a hub in multiple
  directions), not the simple depth-based row layout used today.
- Orthogonal ("elbow") connector routing between nodes positioned at arbitrary angles/distances from
  the center — this is a nontrivial diagramming/routing problem, not a simple straight-line SVG
  `<line>` per connector like the current shipped code uses.
- Progressive reveal logic: computing "which nodes are currently visible" (owned ∪
  neighbors-of-owned) as a first-class, probably-recomputed-on-every-purchase concept, replacing the
  current "render every node, dim the locked ones" approach entirely.
- **Node.js/npm/npx are still completely absent from this development machine** (re-verify at
  session start, but this has been true all session, across many sessions). This has been a
  survivable limitation for CSS/layout work verified via careful static reading, but it is a much
  bigger risk multiplier for gesture-driven, spatially-precise UI like this — "does the drag/pan
  feel right," "do the elbow connectors route without ugly overlaps," and "does progressive reveal
  feel satisfying" are all things that fundamentally cannot be confirmed by reading source code. Any
  plan built for this feature should budget for asking the user to test on a real device/browser at
  meaningful checkpoints, not just at the very end.

## Open questions to resolve before or during the next brainstorming pass

1. Final display name for the `resourcefulness`→spec-card (candidates floated: "Resourcer",
   "Salvager", "Gatherer" — undecided).
2. Are `command`/`diplomacy` fully removed from the data model, or just hidden as unselectable specs
   while the branch/data technically remains?
3. Homeworld's "one giant web" — is it truly one unified graph with no category grouping at all, or
   do the 5 existing categories become distinct spokes/wedges of one shared web (leaning toward the
   latter based on the radial-spoke description, but not explicitly confirmed)?
4. Is zoom (in addition to pan) still wanted, or has progressive reveal made zoom unnecessary since
   there's rarely much on screen at once?
5. Does the central hub node carry over the "inert/decorative, not a real granted talent" semantics
   from mockup 1's root node, or does it mean something different in the radial design (e.g., is it
   literally just a fixed camera anchor with no game-mechanical meaning at all)?
6. Exact tooltip sizing/style now that the layout itself is changing significantly — worth
   revisiting rather than assuming the tooltip-stacking fix's placeholder sizing is final.

## Suggested next steps for the fresh session

1. Read this file first, then confirm current repo state (`git status`, `git log`) hasn't changed
   from what's documented here.
2. Ask the user whether they want to resume brainstorming (the `superpowers:brainstorming` skill,
   since this is genuinely a new design that hasn't been formally presented/approved section-by-
   section yet) working through the open questions above, or whether they have more mockups/details
   to add first.
3. This will very likely warrant its own `docs/plans/YYYY-MM-DD-*-design.md` and `-plan.md`, and
   probably its own git worktree, given the scope — treat it as comparable in size to this session's
   largest prior features (UI Redesign, Talent Tree Visual Redesign), not a quick follow-on task.
4. Remember the 2 unpushed local commits on `main` (`762d11e`, `6e4c3b1`) — ask the user if they want
   those pushed before or independently of starting this new work; don't assume either way.
