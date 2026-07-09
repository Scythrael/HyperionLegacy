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
  //   the orthogonal `.hub` flag, and (optionally) fires onNodeTap on click.
  //   No layout/feel tuning is attempted here — that is deferred to the Task 12
  //   device checkpoint (Checkpoint A). Tunables are marked TUNABLE below.
  //
  //   Task 9 (this addition): an SVG elbow-connector layer is drawn INSIDE
  //   .web-world, BEHIND the nodes. See the `visibleEdges` derivation and the
  //   `.web-connectors` <svg> in the markup for the coordinate-alignment design.

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

  // --- Pan offset (Task 10 placeholder) -------------------------------------
  // The world is translated by (panX, panY). Task 10 will drive these from
  // Pointer-Events drag; for the static render they stay at 0. Centering the
  // hub does NOT rely on these — see the `.web-world` centering note in <style>.
  let panX = 0;
  let panY = 0;

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
     pan gestures attach here; touch-action:none is set now (harmless while
     static) so the browser won't hijack touch-drags as scroll then. -->
<div class="web-viewport">
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
        on:click={() => onNodeTap(key)}
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
