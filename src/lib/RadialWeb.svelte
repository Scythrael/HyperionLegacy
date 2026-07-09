<script lang="ts">
  // --- RadialWeb.svelte — static render of one branch's visible subgraph -----
  // Author: Radial Skill Web feature (Task 8)
  // Created: 2026-07-08 (docs/plans/2026-07-08-radial-skill-web-plan.md, Task 8)
  //
  // Description:
  //   Renders the fog-of-war VISIBLE subgraph (hub ∪ owned ∪ neighbors-of-owned,
  //   per computeVisibleTalents / design §2) for a single branch/category as a
  //   set of absolutely-positioned square nodes inside a pannable world
  //   container. This task is the STATIC render only:
  //     - Task 9 adds the SVG elbow connectors behind the nodes.
  //     - Task 10 adds Pointer-Events pan + tap/drag disambiguation (the
  //       `.web-viewport`'s `touch-action: none` and the `.web-world` translate
  //       placeholder below exist now so that task is a pure addition).
  //     - Task 11 adds the node tooltip + Learn overlay.
  //   So here every node is drawn at its hand-authored (x, y) web-space
  //   coordinate, tagged with exactly one of owned / learnable / locked, plus
  //   the orthogonal `.hub` flag, and fires a node-tap on click (gated — see
  //   Task 10 below). No layout/feel tuning is attempted here — that is deferred
  //   to the Task 12 device checkpoint (Checkpoint A). Tunables are marked
  //   TUNABLE below.
  //
  //   Task 9: an SVG elbow-connector layer is drawn INSIDE .web-world, BEHIND
  //   the nodes. See the `visibleEdges` derivation and the `.web-connectors`
  //   <svg> in the markup for the coordinate-alignment design.
  //
  //   Task 10 (this addition): Pointer-Events pan + tap/drag disambiguation.
  //   A pointer drag on .web-viewport translates the world via (panX, panY); a
  //   near-stationary press is a tap that (on a node) fires onNodeTap. The two
  //   are told apart by movedDistance vs TAP_THRESHOLD_PX, reconciled with the
  //   node buttons' native click via the `suppressClick` gate. See the "Pan +
  //   tap/drag disambiguation" block for the full gesture-state lifecycle.

  import { computeVisibleTalents } from "./game/talentWeb";

  // --- Types ----------------------------------------------------------------
  // Minimal structural shape this component reads off each talent def. Both
  // CAPTAIN_TALENTS (Record<CaptainTalentKey, CaptainTalentDef & {effect}>) and
  // HOMEWORLD_TALENTS (Record<HomeworldTalentKey, HomeworldTalentDef & {effect}>)
  // structurally satisfy `Record<string, RadialNode>`, so a single `table` prop
  // serves BOTH tables without importing either concrete key/def type. It reads
  // only what it renders (branch/label/cost/x/y) plus the two fields
  // computeVisibleTalents needs (neighbors/isHub) — nothing effect-specific, so
  // it stays table-agnostic. `effect` is intentionally NOT read here (that is
  // Task 11's tooltip concern).
  type RadialNode = {
    branch: string;
    label: string;
    cost: number;
    x: number;
    y: number;
    neighbors: string[];
    isHub?: boolean;
  };

  // --- Props ----------------------------------------------------------------
  // `table`  — a whole talent table (captain or homeworld). Typed structurally
  //            (see RadialNode) so one component renders either.
  // `branch` — which branch/category of `table` to render (e.g.
  //            "resourcefulness" for a captain, "fleetLogistics" for homeworld).
  // `owned`  — the keys the player currently owns for this branch (a captain's
  //            unlockedCaptainTalents or state.unlockedHomeworldTalents).
  // `points` — available currency for affordability styling (a captain's
  //            statPoints, or the fleet's adminPoints).
  // `pointsLabel` — human label for that currency ("Stat Points"/"Admin Points"),
  //            shown in the corner readout.
  // `onLearn`   — parent-supplied buy callback. DECLARED now, wired to the Learn
  //            button in Task 11; unused in this static render (see the
  //            reference-suppression line below so lint/tsc stay quiet).
  // `onNodeTap` — parent-supplied node-tap callback. Hooked to a bare node
  //            click here; the real tooltip it opens is Task 11.
  export let table: Record<string, RadialNode>;
  export let branch: string;
  export let owned: string[] = [];
  export let points: number = 0;
  export let pointsLabel: string = "";
  export let onLearn: (key: string) => void = () => {};
  export let onNodeTap: (key: string) => void = () => {};

  // onLearn is declared-but-unused until Task 11 wires the Learn button. Void it
  // so TS `noUnusedParameters`/lint doesn't flag the prop we must keep declared.
  void onLearn;

  // --- Pan offset (Task 10) -------------------------------------------------
  // The world is translated by (panX, panY). Task 10 drives these from a
  // Pointer-Events drag on .web-viewport. They start at 0 (hub centered — see
  // the `.web-world` centering note in <style>) and accumulate pointer deltas.
  let panX = 0;
  let panY = 0;

  // --- Pan + tap/drag disambiguation (Task 10) ------------------------------
  // Unified mouse+touch+stylus via the Pointer Events API. One .web-viewport
  // pointer gesture is EITHER a pan (world drags under the finger) OR a tap
  // (which, when it lands on a node <button>, selects that node). We tell them
  // apart by how far the pointer moved during the gesture (movedDistance vs
  // TAP_THRESHOLD_PX), and we reconcile that with the node buttons' own native
  // `click` event via the `suppressClick` gate (see handleNodeClick below).

  // TAP_THRESHOLD_PX — a gesture whose total pointer travel stays under this many
  // CSS px is treated as a TAP; at or beyond it, it's a PAN (and any trailing
  // node `click` is swallowed). TUNABLE: feel-tune constant; verify on device
  // (Checkpoint A) — too small = drags misfire as taps, too large = deliberate
  // short drags get eaten / taps feel mushy.
  const TAP_THRESHOLD_PX = 8;

  // Live gesture state. `dragging` gates pointermove work to an active gesture.
  // startX/startY are the pointerdown origin; panX0/panY0 snapshot the pan offset
  // at gesture start so move deltas are absolute-from-start (not incremental),
  // which avoids drift. movedDistance is the running straight-line distance from
  // the start point — the tap-vs-pan discriminator.
  let dragging = false;
  let startX = 0;
  let startY = 0;
  let panX0 = 0;
  let panY0 = 0;
  let movedDistance = 0;

  // suppressClick — the bridge between the viewport-level pan gesture and a node
  // <button>'s own `click`. A drag that STARTS on a node would, without this,
  // still fire that button's click on release and wrongly select the node. So
  // once a gesture crosses the pan threshold we set this true; the node's click
  // handler (handleNodeClick) then swallows exactly one click and clears it.
  //
  // CRITICAL lifecycle (hand-verify the ordering — see the trace in the task
  // report): it is RESET to false at the START of every pointerdown, and only
  // SET true mid-move once movedDistance >= TAP_THRESHOLD_PX. The reset is the
  // load-bearing safety: a touch/mouse drag that begins on a node but ends off
  // it may emit NO `click` at all (pointer capture retargets the gesture to the
  // viewport, so the button never sees a click to consume). That would leave
  // suppressClick stuck `true` and cause it to wrongly swallow the NEXT genuine
  // tap. Resetting on every fresh pointerdown guarantees a stuck flag can never
  // survive into the following gesture — the flag's lifetime is at most one
  // gesture. (We deliberately do NOT clear it on pointerup: a real click, when
  // it fires, arrives AFTER pointerup, so clearing there would defeat the
  // swallow. Clearing happens either in handleNodeClick, when the swallowed
  // click actually arrives, or at the next pointerdown otherwise.)
  let suppressClick = false;

  // --- Gesture handlers -----------------------------------------------------

  /**
   * pointerdown — begin a gesture. Snapshots the start point and current pan,
   * arms `dragging`, zeroes the movement accumulator, and clears any stale
   * suppressClick (see the lifecycle note above — this reset is what prevents a
   * previously-stuck flag from eating this gesture's tap). setPointerCapture
   * routes all subsequent move/up events for THIS pointer to the viewport even
   * if the pointer leaves the viewport mid-drag, so a pan that wanders off the
   * element still tracks smoothly.
   */
  function handlePointerDown(e: PointerEvent) {
    dragging = true;
    startX = e.clientX;
    startY = e.clientY;
    panX0 = panX;
    panY0 = panY;
    movedDistance = 0;
    // Fresh gesture: a new tap is now possible, so a prior gesture must not leave
    // the click gate armed. MUST happen every pointerdown (see lifecycle note).
    suppressClick = false;
    // Capture so an off-viewport drag keeps delivering move/up to us. Guarded:
    // setPointerCapture can throw if the pointer is already gone (rare); a failed
    // capture only degrades off-element tracking, so it must not break the pan.
    const target = e.currentTarget;
    if (target instanceof Element) {
      try {
        target.setPointerCapture(e.pointerId);
      } catch {
        // Non-fatal: capture unavailable → in-viewport drag still works. Handled
        // here (not swallowed silently elsewhere) per Omega 14 — the degraded
        // path is explicit and commented rather than an invisible failure.
      }
    }
  }

  /**
   * pointermove — while a gesture is active, translate the world by the pointer
   * delta from the start point (absolute-from-start via panX0/panY0, so it never
   * accumulates rounding drift) and update movedDistance. Once travel reaches the
   * tap threshold, arm suppressClick so a node click at the end of THIS drag is
   * swallowed. Ignored entirely when not dragging (no button/finger held).
   */
  function handlePointerMove(e: PointerEvent) {
    if (!dragging) return;
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;
    panX = panX0 + dx;
    panY = panY0 + dy;
    movedDistance = Math.hypot(dx, dy);
    // Past the threshold this gesture is a PAN, not a tap: pre-arm the gate so the
    // trailing node click (if the browser emits one) is treated as drag tail and
    // dropped. Only ever SET true here — never reset here (reset lives in down).
    if (movedDistance >= TAP_THRESHOLD_PX) {
      suppressClick = true;
    }
  }

  /**
   * pointerup / pointercancel — end the gesture. Clears `dragging` and releases
   * pointer capture. We do NOT decide tap-vs-selection here: the node button's
   * own `click` (which fires just AFTER pointerup for a real tap) drives node
   * selection through handleNodeClick, gated by suppressClick. For a pan, either
   * suppressClick is already true (so that click is swallowed) or, if the drag
   * ended off any node, no click comes at all — either way no node is selected.
   * A cancel (e.g. the OS stealing the pointer) is treated identically to an up:
   * just end the gesture cleanly; suppressClick is left as-is for the next
   * pointerdown to reset.
   */
  function handlePointerUp(e: PointerEvent) {
    dragging = false;
    // Release the capture taken in pointerdown. Only release what we actually
    // hold (hasPointerCapture guard) so a cancel that already dropped capture is
    // a no-op. Wrapped in try/catch defensively — releasing is best-effort and
    // must never break gesture teardown.
    const target = e.currentTarget;
    if (target instanceof Element && target.hasPointerCapture(e.pointerId)) {
      try {
        target.releasePointerCapture(e.pointerId);
      } catch {
        // Non-fatal: releasing an already-released/absent capture is harmless.
      }
    }
  }

  /**
   * handleNodeClick — the node <button>'s click handler, gating onNodeTap
   * through suppressClick so pan drags don't select nodes.
   *
   *   - If suppressClick is true, THIS click is the tail of a pan drag that
   *     started on (or passed over) the node: consume it — clear the flag and
   *     return WITHOUT selecting. (Clearing here is the normal path; the
   *     pointerdown reset is the backstop for when no click ever arrives.)
   *   - Otherwise it's a genuine selection: a real tap (movement stayed under
   *     the threshold, so suppressClick was never armed) OR a keyboard Enter/
   *     Space on a focused node (keyboard activation synthesizes a `click`
   *     WITHOUT any pointer gesture, so suppressClick is false) — call onNodeTap.
   *     This is how accessibility is preserved: keyboard users always reach
   *     onNodeTap because no drag ever arms the gate for them.
   */
  function handleNodeClick(key: string) {
    if (suppressClick) {
      // Swallow exactly one click — the trailing click of a pan — then re-open
      // the gate for the next gesture. No node selected.
      suppressClick = false;
      return;
    }
    onNodeTap(key);
  }

  // --- Derived: the visible subgraph ----------------------------------------
  // Reactive so the render follows ownership/branch/table changes (learning a
  // node reveals its neighbors on the next tick). computeVisibleTalents is the
  // single source of truth for fog-of-war — we render ONLY its members, never
  // the whole table.
  $: visible = computeVisibleTalents(table, branch, owned);

  // `owned` membership as a Set for O(1) per-node state classification below.
  $: ownedSet = new Set(owned);

  // The visible nodes, resolved to [key, def] pairs, filtered to this branch.
  // (computeVisibleTalents already restricts to `branch`; the `def.branch ===
  // branch` guard is belt-and-suspenders and also narrows the type.) Rendering
  // iterates THIS, so the fog-of-war invariant "hidden nodes are absent from the
  // DOM entirely" (design §2.1) holds by construction.
  $: visibleNodes = Array.from(visible)
    .map((key) => ({ key, def: table[key] }))
    .filter((n) => n.def && n.def.branch === branch);

  // --- Derived: the visible edge list (Task 9 connector layer) ---------------
  // One orthogonal "elbow" connector is drawn per UNDIRECTED edge whose BOTH
  // endpoints are visible. Derivation rules (design §3.3, Task 9):
  //
  //   * Both-endpoints-visible: an edge is emitted ONLY when a AND b are both in
  //     `visible`. A line into a hidden node would leak fog-of-war info, so those
  //     are skipped entirely (never drawn).
  //   * Dedupe: `neighbors` is bidirectional by convention (A lists B and B lists
  //     A — see plan line 87), so every undirected edge shows up twice. We emit it
  //     exactly once by only taking the direction where `key < neighborKey`
  //     (lexicographic string compare). That single inequality both dedupes AND
  //     drops self-loops (key === key fails `<`), with no auxiliary Set needed.
  //   * Owned-vs-not styling: `bothOwned` is precomputed here (both endpoints in
  //     ownedSet) so the markup can pick the brighter stroke for fully-owned
  //     edges vs the dimmer stroke for edges touching a not-yet-owned node.
  //
  // Coordinates carried through are the RAW web-space (x, y) of each endpoint —
  // the same values the nodes render at — so the SVG (whose origin coincides with
  // .web-world's origin) draws endpoints exactly on node centers. See the
  // `.web-connectors` <svg> comment in the markup for why that alignment holds,
  // including for negative coordinates.
  //
  // Reactive on visibleNodes AND ownedSet (both are read directly in the block,
  // so Svelte tracks both): visibleNodes covers visible/branch/table changes, and
  // ownedSet drives the bothOwned styling flag. Learning a node thus both
  // re-reveals neighbors and re-brightens now-fully-owned edges on the next tick.
  $: visibleEdges = (() => {
    // A fast membership set of visible keys so the neighbor scan is O(1) per
    // lookup instead of re-scanning visibleNodes. Built from visibleNodes (not
    // the raw `visible` set) so it already respects the branch filter applied
    // there — an edge is only drawn when both ends survive that same filter.
    const visibleKeys = new Set(visibleNodes.map((n) => n.key));

    const edges: {
      ax: number;
      ay: number;
      bx: number;
      by: number;
      bothOwned: boolean;
    }[] = [];

    for (const { key, def } of visibleNodes) {
      for (const neighborKey of def.neighbors) {
        // Skip edges into hidden nodes (fog-of-war) and, via the `<` test below,
        // the duplicate reverse direction + any self-loop.
        if (!visibleKeys.has(neighborKey)) continue;
        if (!(key < neighborKey)) continue; // emit each undirected pair once

        const neighborDef = table[neighborKey];
        if (!neighborDef) continue; // defensive: dangling neighbor ref

        edges.push({
          ax: def.x,
          ay: def.y,
          bx: neighborDef.x,
          by: neighborDef.y,
          bothOwned: ownedSet.has(key) && ownedSet.has(neighborKey),
        });
      }
    }
    return edges;
  })();

  // --- Per-node state classification ----------------------------------------
  // Exactly ONE of owned / learnable / locked applies to any visible node;
  // `.hub` is an ORTHOGONAL flag layered on top (a hub can itself be owned,
  // learnable, or locked). Rules (design §2.1 / §3.4):
  //   owned     — key ∈ owned.
  //   learnable — visible, NOT owned, and affordable (cost <= points).
  //   locked    — visible, NOT owned, and NOT affordable (cost > points).
  // "visible" is a given here (we only iterate visible nodes), so the split is
  // just owned? then affordable?. Returned as a plain object so the markup can
  // spread the boolean flags into class: directives.
  function nodeState(key: string, def: RadialNode) {
    const isOwned = ownedSet.has(key);
    const affordable = def.cost <= points; // TUNABLE: affordability is a pure cost<=points gate (no partial states)
    return {
      owned: isOwned,
      learnable: !isOwned && affordable,
      locked: !isOwned && !affordable,
      hub: def.isHub === true,
    };
  }
</script>

<!-- Viewport: the clipped window onto the world. Fills its parent. Task 10's
     pan gestures attach here via Pointer Events (unified mouse+touch+stylus).
     touch-action:none (in <style>) stops the browser hijacking touch-drags as
     page scroll so our pointermove pan is the sole consumer. class:grabbing
     swaps the cursor to "grabbing" while a drag is live (desktop nicety;
     harmless on touch). The pointercancel handler mirrors pointerup so an
     OS-stolen pointer still ends the gesture cleanly. -->
<div
  class="web-viewport"
  class:grabbing={dragging}
  on:pointerdown={handlePointerDown}
  on:pointermove={handlePointerMove}
  on:pointerup={handlePointerUp}
  on:pointercancel={handlePointerUp}
>
  <!-- World: the pan-transformed coordinate space. Anchored at the viewport's
       CENTER (left/top 50%), so web-space (0,0) — the hub — lands mid-viewport.
       Each node then re-centers ITSELF on its own (x,y) via translate(-50%,-50%)
       (see .web-node). The translate(panX,panY) here is the Task 10 pan hook;
       at panX=panY=0 the world sits exactly centered. -->
  <div class="web-world" style="transform: translate({panX}px, {panY}px);">
    <!-- Connector layer (Task 9). Placed FIRST inside .web-world so it paints
         BEHIND every .web-node that follows in DOM order (no z-index needed —
         later siblings stack on top). pointer-events:none (set in <style>) so it
         never intercepts a node tap or a Task-10 pan drag.

         COORDINATE ALIGNMENT — the one part that must be exactly right:
         The <svg> sits at .web-world's origin (left:0; top:0; width:0; height:0)
         and has NO viewBox, so its user-coordinate system is 1:1 CSS pixels with
         its (0,0) exactly on .web-world's (0,0) — the same origin every .web-node
         measures from. A path point like `M -320 -200` therefore lands on the
         identical pixel as a node rendered at left:-320px; top:-200px (whose own
         center is pinned there by translate(-50%,-50%)). overflow:visible lets
         strokes at negative or large coordinates paint OUTSIDE the nominal 0×0
         SVG box, so the full web renders even though the SVG has zero size.

         Each edge is one single-elbow path: `M ax ay H bx V by` — move to A, draw
         horizontally to B's x, then vertically to B. Consistent H-then-V for every
         edge gives the tidy circuit-trace routing (routing cleanliness itself is a
         Checkpoint A visual item). No fill; stroke only; no arrowheads. -->
    <svg class="web-connectors" aria-hidden="true">
      {#each visibleEdges as e}
        <path
          class="web-edge"
          class:both-owned={e.bothOwned}
          d="M {e.ax} {e.ay} H {e.bx} V {e.by}"
        />
      {/each}
    </svg>
    {#each visibleNodes as { key, def } (key)}
      {@const st = nodeState(key, def)}
      <!-- Locked (unaffordable) nodes stay tappable ON PURPOSE: Task 11's tooltip uses
           onNodeTap to show the node's cost/effect so the player learns WHY it's locked.
           Only the Learn action (Task 11) is affordability-gated -- do NOT add `disabled`
           here, which would swallow the tap and hide that tooltip. -->
      <button
        type="button"
        class="web-node"
        class:owned={st.owned}
        class:learnable={st.learnable}
        class:locked={st.locked}
        class:hub={st.hub}
        style="left: {def.x}px; top: {def.y}px;"
        on:click={() => handleNodeClick(key)}
        title={def.label}
      >
        <span class="web-node-label">{def.label}</span>
        <span class="web-node-cost">{def.cost}</span>
      </button>
    {/each}
  </div>

  <!-- Corner readout: always-visible currency so the player sees affordability
       context. Sits outside .web-world so pan never moves it. -->
  {#if pointsLabel}
    <div class="web-points">{pointsLabel}: {points}</div>
  {/if}
</div>

<style>
  /* --- Viewport ---------------------------------------------------------
     Fills its parent (the panel gives it a height). overflow:hidden clips
     the pannable world; position:relative anchors both the absolutely-placed
     .web-world and the corner readout. touch-action:none is for Task 10's
     pointer drag (no effect on the static render). */
  .web-viewport {
    position: relative;
    width: 100%;
    height: 100%;
    min-height: 320px; /* TUNABLE: fallback height so the web has room even if the parent doesn't size it; revisit at Checkpoint A */
    overflow: hidden;
    touch-action: none;
    background: var(--color-panel-bg-strong);
    border: 1px solid var(--color-border);
    cursor: grab; /* Task 10: desktop affordance — the viewport is draggable. */
  }
  /* While a pan drag is live (class:grabbing bound to `dragging`), show the
     closed-hand cursor. Touch/stylus ignore cursor, so this is desktop-only. */
  .web-viewport.grabbing {
    cursor: grabbing;
  }

  /* --- World ------------------------------------------------------------
     Zero-size anchor at the viewport center. Because it has no dimensions,
     "left:50%; top:50%" places its origin (0,0) at the viewport's center
     WITHOUT any JS measurement — nodes position relative to that origin, so
     the hub at web (0,0) renders dead-center. transform is Task 10's pan
     handle. */
  .web-world {
    position: absolute;
    left: 50%;
    top: 50%;
    width: 0;
    height: 0;
    /* transform set inline (translate(panX,panY)); Task 10 animates it. */
  }

  /* --- Connector layer (Task 9) -----------------------------------------
     Zero-size SVG pinned to .web-world's origin so its (0,0) coincides with
     web-space (0,0). NO viewBox -> user units == CSS px, 1:1, un-scaled, so
     path coordinates equal node coordinates (endpoints land on node centers).
     overflow:visible is LOAD-BEARING: the box is 0×0, so without it every
     stroke (all of which live outside a 0×0 box) would be clipped away. It
     also lets negative-coordinate edges paint. pointer-events:none so taps and
     Task-10 pan drags pass straight through to the nodes / world beneath. */
  .web-connectors {
    position: absolute;
    left: 0;
    top: 0;
    width: 0;
    height: 0;
    overflow: visible;
    pointer-events: none;
  }
  /* Base edge: dimmer accent — an edge touching a not-yet-owned node. fill:none
     because a path with a vertical segment would otherwise get area-filled. */
  .web-edge {
    fill: none;
    stroke: rgba(var(--color-accent-rgb), 0.3); /* TUNABLE: dim-edge opacity — Checkpoint A */
    stroke-width: 2; /* TUNABLE: connector thickness — Checkpoint A */
    stroke-linejoin: miter; /* crisp right-angle corner at the elbow */
  }
  /* Fully-owned edge (both endpoints owned): brighter so earned links read as
     "live". Uses the theme's accent-bright, matching owned-node coloring. */
  .web-edge.both-owned {
    stroke: var(--color-accent-bright);
    stroke-width: 2.5; /* TUNABLE: owned edges slightly heavier — Checkpoint A */
  }

  /* --- Node -------------------------------------------------------------
     Square node (per the mockup) centered ON its (x,y): left/top set inline
     to the coordinate, translate(-50%,-50%) shifts the node's own center onto
     that point. Colors come entirely from theme vars so the 6 themes reskin
     it. Default (learnable-ish) look; state classes below override. */
  .web-node {
    position: absolute;
    transform: translate(-50%, -50%); /* node's own center lands on (x,y) */
    width: 76px; /* TUNABLE: node size — verify legibility on phone at Checkpoint A */
    height: 76px;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 4px;
    padding: 6px;
    box-sizing: border-box;
    background: var(--color-panel-bg-strong);
    border: 1px solid rgba(var(--color-accent-rgb), 0.35);
    color: var(--color-text-primary);
    font-family: var(--font-body);
    cursor: pointer;
    text-align: center;
    /* square corners to match the mockup's chamfered-panel node look */
    border-radius: 0;
  }
  .web-node-label {
    font-size: 11px; /* TUNABLE: label size — Checkpoint A */
    font-weight: 600;
    line-height: 1.15;
    /* Long labels are simply clipped for now so a node stays square-ish; a real
       two-line clamp (-webkit-line-clamp) is a Checkpoint A tuning item. */
    overflow: hidden;
  }
  .web-node-cost {
    font-size: 10px;
    color: var(--color-text-secondary);
  }

  /* --- State classes (design §2.1 / §3.4) -------------------------------
     Exactly one of owned/learnable/locked per node; .hub is orthogonal.
     Same theme-var conventions App.svelte's .skill-node already uses:
       owned     -> success-tinted border (matches .skill-node.owned).
       learnable -> accent border (affordable, invites the click).
       locked    -> dimmed (matches .skill-node.locked's opacity:0.5).
       hub       -> larger + double border to read as the seed/center node. */
  .web-node.owned {
    border-color: var(--color-success);
    color: var(--color-success);
  }
  .web-node.learnable {
    border-color: var(--color-accent);
    color: var(--color-accent-bright);
  }
  .web-node.locked {
    opacity: 0.5; /* affordability gate — cost > points */
    cursor: not-allowed;
    border-color: rgba(var(--color-accent-rgb), 0.2);
  }
  /* Hub: visually distinct center node (design §3.4 — "double-border / larger").
     A ring via box-shadow gives the double-border read without changing the
     node's box size (so its center stays exactly on (0,0)). */
  .web-node.hub {
    width: 92px; /* TUNABLE: hub is larger than a normal node — Checkpoint A */
    height: 92px;
    border-width: 2px;
    box-shadow: 0 0 0 3px var(--color-panel-bg-strong), 0 0 0 4px rgba(var(--color-accent-rgb), 0.45);
  }

  /* --- Corner currency readout -----------------------------------------
     Unobtrusive overlay pinned to the viewport corner; unaffected by pan. */
  .web-points {
    position: absolute;
    top: 8px;
    right: 10px;
    font-family: var(--font-mono);
    font-size: 11px;
    color: var(--color-text-secondary);
    background: rgba(0, 0, 0, 0.35);
    padding: 2px 8px;
    border: 1px solid var(--color-border);
    pointer-events: none; /* purely informational; never intercept pan/tap */
  }
</style>
