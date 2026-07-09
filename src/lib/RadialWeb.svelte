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
  //     - Task 9 adds the SVG connectors behind the nodes (reworked to straight
  //       glowing links at Device Checkpoint A — see the Task 9 note below).
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
  //   Task 9 (reworked at Device Checkpoint A): an SVG connector layer is drawn
  //   INSIDE .web-world, BEHIND the nodes. It uses a REAL, non-zero SVG canvas
  //   centered on the world origin (the old 0×0 + overflow-visible SVG didn't
  //   paint on device — root-cause fixed via the HALF offset const) and draws a
  //   STRAIGHT line per edge (not an elbow). Each edge is classified by endpoint
  //   ownership: owned↔not-owned edges get a directional glowing pulse travelling
  //   toward the learnable node; owned↔owned get a steady glow; the rest are idle.
  //   See the `HALF` const, the `visibleEdges` derivation, and the
  //   `.web-connectors` <svg> in the markup.
  //
  //   Task 10 (this addition): Pointer-Events pan + tap/drag disambiguation.
  //   A pointer drag on .web-viewport translates the world via (panX, panY); a
  //   near-stationary press is a TAP that (on a node) opens that node's tooltip.
  //   The two are told apart by movedDistance vs TAP_THRESHOLD_PX. Tap resolution
  //   happens in the viewport's OWN pointerup via a document.elementFromPoint
  //   hit-test — NOT via the node button's native `click`. (Checkpoint-A device
  //   fix: setPointerCapture on the viewport retargets the compatibility `click`
  //   to the VIEWPORT, so a clean tap's click never reached the node button and
  //   the tooltip never opened. The hit-test reads the real node under the
  //   release point regardless of capture.) Keyboard Enter/Space on a focused
  //   node is a separate, capture-free path handled by the button's on:keydown.
  //   See the "Pan + tap/drag disambiguation" block for the gesture lifecycle.
  //
  //   Task 11 (this addition): node tooltip overlay + Learn action. A node tap
  //   now opens an INTERNAL tooltip (RadialWeb owns it — one component serves
  //   both the captain and homeworld panels, so owning the tooltip once here
  //   avoids duplicating it in the parent). The tooltip shows the node's label,
  //   a human-readable effect line (via the `describeEffect` PROP — see below),
  //   cost + affordability, and flavor, with a Learn button that calls
  //   `onLearn(key)` only when the node is learnable AND affordable. The overlay
  //   is PORTALED to <body> to escape a future Panel's backdrop-filter containing
  //   block (the known trap — see the `portal` action's comment). See the
  //   "Tooltip (Task 11)" state/handler block and the tooltip markup at the end.

  import { computeVisibleTalents } from "./game/talentWeb";

  // --- portal action (Task 11) ---------------------------------------------
  // Moves `node` to be a direct child of <body> on mount and removes it on
  // destroy. Used via `use:portal` on the tooltip overlay so the overlay is a
  // genuine top-level child of <body>, NOT a descendant of this component's
  // DOM subtree.
  //
  // WHY this exists (the known trap — do NOT remove without understanding it):
  //   In a later task RadialWeb is mounted INSIDE a <Panel> whose `.panel` sets
  //   `backdrop-filter`. Per the CSS spec, an element with `backdrop-filter`
  //   (like transform/filter/perspective) becomes the CONTAINING BLOCK for any
  //   `position: fixed` descendant — so a `position: fixed; inset: 0` "full
  //   screen" backdrop rendered inside that Panel would only ever cover the
  //   Panel's box, not the real viewport. This project already hit this exact
  //   bug once: App.svelte's `.tooltip-backdrop` was first nested inside the
  //   talent <Panel>, looked correct in isolation, but only dimmed that one
  //   Panel on mobile (see App.svelte's `.tooltip-backdrop` comment near line
  //   ~2375 and the talent-tree-visual-redesign notes). Rendering the overlay
  //   as a true <body> child sidesteps the trap entirely: <body> has no
  //   backdrop-filter/transform ancestor, so `position: fixed` is viewport-fixed
  //   again. SSR/teardown are guarded: we only touch the DOM if `document` and
  //   `document.body` exist, and destroy() only removes the node if it is still
  //   attached (so a double-teardown or an SSR no-mount is a harmless no-op).
  function portal(node: HTMLElement) {
    // SSR guard: no document at build/prerender time — do nothing, no crash.
    if (typeof document !== "undefined" && document.body) {
      document.body.appendChild(node);
    }
    return {
      destroy() {
        // Only remove what we actually attached; guard against a node already
        // detached by an earlier teardown (double-destroy is a no-op).
        if (node.parentNode) {
          node.parentNode.removeChild(node);
        }
      },
    };
  }

  // --- Types ----------------------------------------------------------------
  // Minimal structural shape this component reads off each talent def. Both
  // CAPTAIN_TALENTS (Record<CaptainTalentKey, CaptainTalentDef & {effect}>) and
  // HOMEWORLD_TALENTS (Record<HomeworldTalentKey, HomeworldTalentDef & {effect}>)
  // structurally satisfy `Record<string, RadialNode>`, so a single `table` prop
  // serves BOTH tables without importing either concrete key/def type. It reads
  // only what it renders (branch/label/cost/x/y) plus the two fields
  // computeVisibleTalents needs (neighbors/isHub).
  //
  // Task 11 additions: the tooltip also reads `effect` and `flavor`. `effect`
  // is typed `unknown` ON PURPOSE — RadialWeb must stay generic over BOTH the
  // captain and homeworld tables (whose effect unions differ), so it never
  // interprets `effect` itself. Instead the PARENT supplies a `describeEffect`
  // prop (the correct describe*TalentEffect for its table), and RadialWeb just
  // passes `def.effect` through to it. This keeps the component table-agnostic
  // (no captain/homeworld-specific import here).
  type RadialNode = {
    branch: string;
    label: string;
    cost: number;
    x: number;
    y: number;
    neighbors: string[];
    isHub?: boolean;
    effect: unknown;
    flavor: string;
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
  // `onLearn`   — parent-supplied buy callback. Wired (Task 11) to the tooltip's
  //            Learn button: the parent points it at buyCaptainTalent /
  //            buyHomeworldTalent. Called with the node key on a committed learn.
  // `onNodeTap` — OPTIONAL parent-supplied node-tap passthrough. The tooltip is
  //            now INTERNAL (Task 11 opens it locally on tap), so this is no
  //            longer required for the tooltip to work; it's kept as an optional
  //            notification hook (defaults to a no-op) in case a parent wants to
  //            observe taps. Node taps open the internal tooltip regardless.
  // `describeEffect` — parent-supplied effect describer (Task 11). The parent
  //            passes describeCaptainTalentEffect (captain) or
  //            describeHomeworldTalentEffect (homeworld) from tick.ts, so
  //            RadialWeb renders the right human-readable effect line WITHOUT
  //            importing either concrete function — keeping it generic over both
  //            tables. Defaulted to a safe stub so an un-wired parent doesn't
  //            crash the tooltip (it just shows no effect line).
  export let table: Record<string, RadialNode>;
  export let branch: string;
  export let owned: string[] = [];
  export let points: number = 0;
  export let pointsLabel: string = "";
  export let onLearn: (key: string) => void = () => {};
  export let onNodeTap: (key: string) => void = () => {};
  export let describeEffect: (effect: any) => string = () => "";

  // --- Pan offset (Task 10) -------------------------------------------------
  // The world is translated by (panX, panY). Task 10 drives these from a
  // Pointer-Events drag on .web-viewport. They start at 0 (hub centered — see
  // the `.web-world` centering note in <style>) and accumulate pointer deltas.
  let panX = 0;
  let panY = 0;

  // --- Pan + tap/drag disambiguation (Task 10) ------------------------------
  // Unified mouse+touch+stylus via the Pointer Events API. One .web-viewport
  // pointer gesture is EITHER a pan (world drags under the finger) OR a tap
  // (which, when it lands on a node <button>, opens that node's tooltip). We tell
  // them apart by how far the pointer moved during the gesture (movedDistance vs
  // TAP_THRESHOLD_PX). A tap is resolved in handlePointerUp by hit-testing the
  // release point with document.elementFromPoint — deliberately NOT via the node
  // button's native `click`. Why: pointerdown calls setPointerCapture on the
  // viewport (needed so an off-viewport drag keeps tracking), and pointer capture
  // retargets the compatibility `click` to the VIEWPORT, not the node button — so
  // a clean tap's click never reached the button (the Checkpoint-A tooltip bug).
  // The hit-test is capture-independent, so it finds the real node under the
  // release point every time. Keyboard activation is a separate path (each node
  // button's on:keydown handles Enter/Space) — no pointer capture is involved
  // there, so it reliably opens the tooltip for accessibility.

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

  // --- Gesture handlers -----------------------------------------------------

  /**
   * pointerdown — begin a gesture. Snapshots the start point and current pan,
   * arms `dragging`, and zeroes the movement accumulator. setPointerCapture
   * routes all subsequent move/up events for THIS pointer to the viewport even
   * if the pointer leaves the viewport mid-drag, so a pan that wanders off the
   * element still tracks smoothly. (That same capture retargets the trailing
   * `click` away from the node button — which is why tap resolution lives in
   * handlePointerUp's hit-test, not in a button click handler.)
   */
  function handlePointerDown(e: PointerEvent) {
    dragging = true;
    startX = e.clientX;
    startY = e.clientY;
    panX0 = panX;
    panY0 = panY;
    movedDistance = 0;
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
   * accumulates rounding drift) and update movedDistance. movedDistance is the
   * sole tap-vs-pan discriminator, read once at pointerup: a release with
   * movedDistance < TAP_THRESHOLD_PX is a TAP (hit-test resolves the node), at or
   * beyond it is a PAN (no node opens). Ignored when not dragging (nothing held).
   */
  function handlePointerMove(e: PointerEvent) {
    if (!dragging) return;
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;
    panX = panX0 + dx;
    panY = panY0 + dy;
    movedDistance = Math.hypot(dx, dy);
  }

  /**
   * pointerup / pointercancel — end the gesture. Clears `dragging`, releases
   * pointer capture, and — for a TAP — resolves which node was tapped and opens
   * its tooltip.
   *
   * Tap resolution is done HERE via a document.elementFromPoint hit-test at the
   * release coordinates, deliberately NOT via the node button's native `click`.
   * The reason is the Checkpoint-A device bug: pointerdown captured this pointer
   * to the viewport (setPointerCapture, needed for off-viewport drag tracking),
   * and pointer capture retargets the compatibility `click` to the VIEWPORT — so
   * a clean tap's click fires on the viewport, never on the node button, and the
   * button's handler never ran. elementFromPoint does a fresh hit-test at those
   * viewport coords that is independent of pointer capture, so it returns the
   * actual node button (or a child) under the finger even while captured.
   *
   * A pan (movedDistance >= TAP_THRESHOLD_PX) skips the hit-test entirely, so no
   * node opens at the end of a drag. A tap on empty space hit-tests to something
   * with no [data-node-key] ancestor, so nothing opens. A pointercancel is
   * treated like an up: end cleanly (with touch-action:none the browser won't
   * steal the gesture for scroll, so cancels are rare; if one does arrive after a
   * near-stationary press it simply resolves the node under the last point, which
   * is harmless).
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

    // A near-stationary gesture is a TAP. Resolve which node (if any) is under
    // the release point via a hit-test — NOT via the button's click, which
    // pointer capture retargets to the viewport (that was the Checkpoint-A
    // tooltip bug). elementFromPoint is capture-independent, so it returns the
    // real node button/child at those coords; .closest("[data-node-key]") walks
    // up to the owning node button and yields its key. Tapping empty space finds
    // no [data-node-key] ancestor → opens nothing, which is correct. A pan
    // (movedDistance >= threshold) skips this branch entirely.
    if (movedDistance < TAP_THRESHOLD_PX && typeof document !== "undefined") {
      const el = document.elementFromPoint(e.clientX, e.clientY);
      const nodeEl = el && (el as Element).closest("[data-node-key]");
      if (nodeEl) {
        const key = nodeEl.getAttribute("data-node-key");
        if (key !== null) {
          // Genuine tap: open THIS node's internal tooltip (Task 11) and fire the
          // optional onNodeTap passthrough notification.
          openTooltipKey = key;
          onNodeTap(key);
        }
      }
    }
  }

  // --- Tooltip (Task 11) ----------------------------------------------------
  // `openTooltipKey` is the single piece of tooltip state: the key of the node
  // whose tooltip is open, or null for "no tooltip". Kept as the KEY (not a
  // resolved snapshot) so the tooltip's contents stay reactive — if `points` or
  // `owned` change while it's open (e.g. the player learns the node), the Learn
  // gate and affordability line update live off the same nodeState logic the
  // nodes use, rather than showing a stale snapshot.
  let openTooltipKey: string | null = null;

  // Resolved tooltip view-model, derived reactively from the open key. Null when
  // nothing is open OR the key somehow doesn't resolve to a def (defensive — a
  // dangling key just closes the tooltip by rendering nothing).
  //
  // Reactivity note (deliberate): Svelte builds a reactive statement's
  // dependency list from the top-level variables it DIRECTLY references — it does
  // NOT trace into called functions. nodeState() reads `ownedSet` and `points`
  // internally, so to make this block re-run when EITHER changes we reference
  // both directly below (`points` in the shortfall math; `ownedSet` via the
  // explicit `void ownedSet;` touch). Without the ownedSet touch, learning/owning
  // a node while its tooltip is open would not refresh the Owned/Learn state.
  // `table`, `describeEffect`, and `openTooltipKey` are referenced directly too.
  $: tooltip =
    openTooltipKey !== null && table[openTooltipKey]
      ? (() => {
          const key = openTooltipKey as string;
          const def = table[key];
          // Explicit dependency touch so Svelte tracks ownedSet for this block
          // (nodeState reads it, but Svelte can't see inside the call). No-op at
          // runtime beyond registering the reactive dependency.
          void ownedSet;
          const st = nodeState(key, def);
          // shortfall — how many more points are needed when unaffordable (>0
          // only for a not-owned, not-affordable node). Drives the "need N more"
          // hint on the disabled Learn button / cost line.
          const shortfall = st.owned ? 0 : Math.max(0, def.cost - points);
          return {
            key,
            label: def.label,
            // describeEffect is the parent's table-correct describer; def.effect
            // is passed through untouched (RadialWeb never interprets it).
            effectLine: describeEffect(def.effect),
            flavor: def.flavor,
            cost: def.cost,
            owned: st.owned,
            // Learn is enabled ONLY when learnable (visible && !owned &&
            // affordable). nodeState.learnable already encodes exactly that
            // (visibility is implicit — only visible nodes are tappable).
            canLearn: st.learnable,
            shortfall,
          };
        })()
      : null;

  /** Close the tooltip (backdrop click, × button, Escape, or after a learn). */
  function closeTooltip() {
    openTooltipKey = null;
  }

  /**
   * Commit the Learn purchase for the open tooltip's node, then close.
   * Belt-and-suspenders: only fires onLearn when the derived view-model says the
   * node canLearn (learnable && affordable). The button is already `disabled` in
   * that state, but re-checking here means a stale/synthesized click can never
   * commit an un-learnable or unaffordable buy.
   */
  function learnFromTooltip() {
    if (tooltip && tooltip.canLearn) {
      onLearn(tooltip.key);
    }
    closeTooltip();
  }

  /**
   * Escape-to-close. Bound on <svelte:window>. Only acts when a tooltip is open,
   * so it never swallows Escape for anything else on the page.
   */
  function handleKeydown(e: KeyboardEvent) {
    if (e.key === "Escape" && openTooltipKey !== null) {
      closeTooltip();
    }
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

  // --- Connector SVG canvas offset (Device Checkpoint A rework) --------------
  // HALF sizes the real, non-zero SVG painting surface for the connector layer
  // and is the single offset that keeps that surface aligned to the node origin.
  //
  // WHY a named const (root-cause fix): the previous connector SVG was 0×0 with
  // overflow:visible and relied on strokes painting OUTSIDE a zero-size viewport.
  // That "overflow-visible on a 0×0 SVG" trick is unreliable — several real
  // browsers (confirmed on device at Checkpoint A) simply do NOT paint anything
  // outside a zero-area SVG viewport, so the connectors vanished. The robust fix
  // is a genuine, large, non-zero SVG canvas centered on .web-world's origin (see
  // the `.web-connectors` <svg> comment + CSS), with every drawn coordinate
  // shifted by +HALF to compensate for the SVG element itself being shifted by
  // −HALF. No overflow trick remains.
  //
  // ALIGNMENT ARITHMETIC (must be exactly right — this is what makes the lines
  // both appear AND land on node centers):
  //   * The SVG element is positioned at left:−HALF; top:−HALF relative to
  //     .web-world's origin, and is 2*HALF wide/tall — so its internal (0,0) sits
  //     at world-origin + (−HALF, −HALF), and its internal (2*HALF, 2*HALF) sits
  //     at world-origin + (+HALF, +HALF). The origin is dead-center of the canvas.
  //   * A node at web-coord (x, y) has its CENTER at world-origin + (x, y)
  //     (left:{x}; top:{y} + translate(-50%,-50%) — node layer is UNCHANGED).
  //   * We draw that endpoint at SVG-internal point (x+HALF, y+HALF). Its absolute
  //     position is:  world-origin + (−HALF, −HALF) + (x+HALF, y+HALF)
  //                 = world-origin + (x, y)  ✓  — exactly the node center.
  //   Negative web-coords land inside the canvas too, e.g. x=−320 → internal
  //   −320+5000 = 4680, comfortably within [0, 2*HALF]. No overflow needed.
  //
  // TUNABLE: 5000 gives a 10000×10000 px surface — ±5000 px from center each way,
  // generous for the current webs. If a future web authors nodes beyond ±5000 px
  // from the hub, their connectors would clip; bump HALF then (Checkpoint B).
  const HALF = 5000;

  // --- Derived: the visible edge list (connector layer) ----------------------
  // One STRAIGHT "laser link" line is drawn per UNDIRECTED edge whose BOTH
  // endpoints are visible — a direct segment from node A's center to node B's
  // center (replacing the old H-then-V elbow path). Derivation rules:
  //
  //   * Both-endpoints-visible: an edge is emitted ONLY when a AND b are both in
  //     `visible`. A line into a hidden node would leak fog-of-war info, so those
  //     are skipped entirely (never drawn).
  //   * Dedupe: `neighbors` is bidirectional by convention (A lists B and B lists
  //     A — see plan line 87), so every undirected edge shows up twice. We emit it
  //     exactly once by only taking the direction where `key < neighborKey`
  //     (lexicographic string compare). That single inequality both dedupes AND
  //     drops self-loops (key === key fails `<`), with no auxiliary Set needed.
  //
  //   * Per-edge OWNERSHIP CLASS (drives the directional pulse — see the markup /
  //     CSS). Each edge is classified by how many of its two endpoints are owned:
  //       - "learnable" (exactly ONE endpoint owned): an owned→not-owned pathway.
  //         Renders a subtle base line PLUS an animated glowing pulse travelling
  //         FROM the owned end TOWARD the not-owned (learnable) end, to draw the
  //         eye to "learn next". Direction matters, so we ORDER THE POINTS
  //         OWNED-FIRST: (ax,ay) = the owned endpoint, (bx,by) = the not-owned
  //         one. The pulse animation runs from point1 → point2 = owned → learnable.
  //       - "owned" (BOTH endpoints owned): a steady glow, NO pulse — both are
  //         learned, nothing to point toward. Point order is irrelevant here.
  //       - "idle" (NEITHER endpoint owned): a dim/idle base line, no pulse. This
  //         happens when two learnable nodes are mutual neighbours of a common
  //         owned node. Point order irrelevant.
  //
  // Coordinates carried through are the RAW web-space (x, y) of each endpoint —
  // the same values the nodes render at. The markup adds +HALF to each when
  // drawing (see HALF above) so, with the SVG shifted −HALF, endpoints land
  // exactly on node centers (works for negative coords too).
  //
  // Reactive on visibleNodes AND ownedSet (both are read directly in the block,
  // so Svelte tracks both): visibleNodes covers visible/branch/table changes, and
  // ownedSet drives the ownership class + owned-first ordering. Learning a node
  // thus both re-reveals neighbours and re-classifies its edges on the next tick.
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
      // Exactly one of: "owned" (both owned), "learnable" (exactly one owned,
      // pulse travels ax,ay→bx,by = owned→not-owned), "idle" (neither owned).
      ownership: "owned" | "learnable" | "idle";
    }[] = [];

    for (const { key, def } of visibleNodes) {
      for (const neighborKey of def.neighbors) {
        // Skip edges into hidden nodes (fog-of-war) and, via the `<` test below,
        // the duplicate reverse direction + any self-loop.
        if (!visibleKeys.has(neighborKey)) continue;
        if (!(key < neighborKey)) continue; // emit each undirected pair once

        const neighborDef = table[neighborKey];
        if (!neighborDef) continue; // defensive: dangling neighbor ref

        const keyOwned = ownedSet.has(key);
        const neighborOwned = ownedSet.has(neighborKey);

        // Classify by owned-endpoint count and, for the one-owned case, ORDER
        // THE POINTS OWNED-FIRST so the pulse (point1→point2) heads toward the
        // learnable (not-owned) node.
        if (keyOwned && neighborOwned) {
          // Both owned → steady glow, no pulse; point order irrelevant.
          edges.push({
            ax: def.x,
            ay: def.y,
            bx: neighborDef.x,
            by: neighborDef.y,
            ownership: "owned",
          });
        } else if (keyOwned || neighborOwned) {
          // Exactly one owned → learnable pathway. Put the OWNED endpoint first
          // (ax,ay) and the not-owned one second (bx,by) so the pulse travels
          // owned → not-owned = toward "learn next".
          const owned = keyOwned ? def : neighborDef;
          const other = keyOwned ? neighborDef : def;
          edges.push({
            ax: owned.x,
            ay: owned.y,
            bx: other.x,
            by: other.y,
            ownership: "learnable",
          });
        } else {
          // Neither owned → dim idle line, no pulse; point order irrelevant.
          edges.push({
            ax: def.x,
            ay: def.y,
            bx: neighborDef.x,
            by: neighborDef.y,
            ownership: "idle",
          });
        }
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

<!-- Escape-to-close for the Task 11 tooltip. handleKeydown is a no-op unless a
     tooltip is open, so this window listener never interferes with other keys. -->
<svelte:window on:keydown={handleKeydown} />

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
    <!-- Connector layer. Placed FIRST inside .web-world so it paints BEHIND every
         .web-node that follows in DOM order (no z-index needed — later siblings
         stack on top). pointer-events:none (set in <style>) so it never intercepts
         a node tap or a pan drag.

         COORDINATE ALIGNMENT — the one part that must be exactly right (Device
         Checkpoint A rework; see the HALF const in <script> for the full rationale
         and the .web-connectors CSS for the box geometry):
         The <svg> is a REAL, non-zero 2*HALF × 2*HALF canvas positioned at
         left:−HALF; top:−HALF relative to .web-world's origin (NOT the old 0×0 +
         overflow-visible trick, which real browsers refused to paint). Because the
         element is shifted −HALF, we draw every endpoint at SVG-internal coord
         (x+HALF, y+HALF). The net position is:
             world-origin + (−HALF,−HALF) + (x+HALF, y+HALF) = world-origin + (x,y)
         which is exactly where a node with left:{x}; top:{y} (+translate(-50%,-50%))
         centers itself. So a line endpoint at (x,y) lands dead-on that node's
         center — for negative coords too (e.g. x=−320 → internal 4680, inside the
         canvas). The node layer is UNCHANGED; only these internal SVG coords carry
         the +HALF offset.

         Each edge is a single STRAIGHT <line> (a direct "laser link" from node A's
         center to node B's center) — replacing the old H-then-V elbow path. The
         per-edge `ownership` class drives the directional glow (see CSS):
           .learnable — subtle base line + an animated pulse travelling from
                        (x1,y1)=OWNED end toward (x2,y2)=not-owned/learnable end
                        (points are ordered owned-first in visibleEdges).
           .owned     — steady brighter glow, no pulse (both endpoints owned).
           (default)  — dim idle line, no pulse (neither endpoint owned).
         No fill; stroke only; no arrowheads. -->
    <svg class="web-connectors" aria-hidden="true">
      {#each visibleEdges as e}
        <line
          class="web-edge"
          class:owned={e.ownership === "owned"}
          class:learnable={e.ownership === "learnable"}
          x1={e.ax + HALF}
          y1={e.ay + HALF}
          x2={e.bx + HALF}
          y2={e.by + HALF}
        />
      {/each}
    </svg>
    {#each visibleNodes as { key, def } (key)}
      {@const st = nodeState(key, def)}
      <!-- Locked (unaffordable) nodes stay tappable ON PURPOSE: Task 11's tooltip
           shows the node's cost/effect so the player learns WHY it's locked. Only
           the Learn action (Task 11) is affordability-gated -- do NOT add
           `disabled` here, which would swallow the tap and hide that tooltip.

           data-node-key is the hit-test anchor: handlePointerUp resolves a tap by
           document.elementFromPoint(...).closest("[data-node-key]") and reads this
           attribute to know which node was tapped. That pointerup path (not a
           click handler) opens the tooltip, because pointer capture on the
           viewport retargets the compatibility `click` away from this button (the
           Checkpoint-A bug). on:keydown is the SEPARATE keyboard path (Enter/Space
           on a focused node) — no pointer capture is involved there, so it opens
           the tooltip reliably, preserving accessibility. -->
      <button
        type="button"
        class="web-node"
        class:owned={st.owned}
        class:learnable={st.learnable}
        class:locked={st.locked}
        class:hub={st.hub}
        style="left: {def.x}px; top: {def.y}px;"
        data-node-key={key}
        on:keydown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            openTooltipKey = key;
            onNodeTap(key);
          }
        }}
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

<!-- Node tooltip overlay (Task 11). PORTALED to <body> via use:portal so it is a
     genuine top-level, viewport-fixed overlay even when RadialWeb is later
     mounted inside a <Panel> whose backdrop-filter would otherwise contain a
     position:fixed descendant (the known trap — see the `portal` action comment
     in <script>). The backdrop's flex centering places the card; the card has no
     position of its own.

     Dismiss paths:
       - Backdrop: on:click|self closes ONLY when the click lands on the backdrop
         itself (not bubbled up from the card). Because this overlay is a separate
         body-level element sitting over the whole viewport, a backdrop click is
         intercepted here and CANNOT leak through to a node underneath (the node
         is in a different subtree, behind the backdrop) — so backdrop-click never
         doubles as a node tap.
       - × button: explicit close.
       - Escape: handled by the <svelte:window> keydown above.

     Colors are theme vars throughout; the only literal is the neutral black scrim
     opacity, matching App.svelte's .tooltip-backdrop / .modal-backdrop idiom. -->
{#if tooltip}
  <div
    class="web-tooltip-backdrop"
    use:portal
    on:click|self={closeTooltip}
  >
    <div class="web-tooltip" role="dialog" aria-modal="true" aria-label={tooltip.label}>
      <!-- Header row: node label + explicit close (×). -->
      <div class="web-tooltip-header">
        <h3 class="web-tooltip-title">{tooltip.label}</h3>
        <button
          type="button"
          class="web-tooltip-close"
          aria-label="Close"
          on:click={closeTooltip}
        >×</button>
      </div>

      <!-- Human-readable effect line (from the describeEffect prop). Only shown
           when non-empty (an un-wired parent's stub returns "" → line hidden). -->
      {#if tooltip.effectLine}
        <p class="web-tooltip-effect">{tooltip.effectLine}</p>
      {/if}

      <!-- Cost + affordability. Owned nodes show no cost (nothing left to buy);
           unaffordable nodes append the shortfall so the player sees WHY Learn is
           disabled. `points` drives the comparison via the derived view-model. -->
      {#if !tooltip.owned}
        <p class="web-tooltip-cost">
          Cost: {tooltip.cost} {pointsLabel}{#if tooltip.shortfall > 0} (need {tooltip.shortfall} more){/if}
        </p>
      {/if}

      <!-- Flavor text. -->
      {#if tooltip.flavor}
        <p class="web-tooltip-flavor">{tooltip.flavor}</p>
      {/if}

      <!-- Action row. Owned → a static "Owned" state (nothing to buy). Otherwise
           a Learn button enabled ONLY when canLearn (learnable && affordable);
           disabled otherwise so an unaffordable/locked node shows the cost hint
           above but can't be bought. -->
      <div class="web-tooltip-action">
        {#if tooltip.owned}
          <span class="web-tooltip-owned">Owned</span>
        {:else}
          <button
            type="button"
            class="web-tooltip-learn"
            disabled={!tooltip.canLearn}
            on:click={learnFromTooltip}
          >Learn</button>
        {/if}
      </div>
    </div>
  </div>
{/if}

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

  /* --- Connector layer (Device Checkpoint A rework) ---------------------
     A REAL, non-zero SVG canvas centered on .web-world's origin — NOT the old
     0×0 + overflow:visible trick, which real browsers refused to paint (that
     was the root cause of the connectors not rendering on device). The box is
     2*HALF × 2*HALF px, offset by −HALF on each axis, so its INTERNAL origin
     (0,0) sits at world-origin + (−HALF,−HALF) and its center (HALF,HALF) sits
     exactly on world-origin. Endpoints are drawn at (x+HALF, y+HALF) in the
     markup, which — combined with this −HALF element shift — lands them on the
     node centers (see the HALF const in <script> for the arithmetic). NO
     viewBox → user units == CSS px, 1:1, un-scaled. pointer-events:none so taps
     and pan drags pass straight through to the nodes / world beneath.
     NOTE: HALF (5000) is mirrored here as 5000 / −5000 / 10000 because CSS can't
     read the JS const; keep these in sync with HALF if it is ever retuned. */
  .web-connectors {
    position: absolute;
    left: -5000px; /* = −HALF (keep in sync with the HALF const in <script>) */
    top: -5000px; /* = −HALF */
    width: 10000px; /* = 2*HALF */
    height: 10000px; /* = 2*HALF */
    pointer-events: none;
    overflow: visible; /* harmless belt-and-suspenders; canvas already spans the web */
  }
  /* Base edge (idle: neither endpoint owned): dim accent line. fill:none because
     an SVG <line> takes no fill, but set explicitly for clarity/safety. */
  .web-edge {
    fill: none;
    stroke: rgba(var(--color-accent-rgb), 0.22); /* TUNABLE: idle-edge opacity — Checkpoint B */
    stroke-width: 2; /* TUNABLE: connector thickness — Checkpoint B */
    stroke-linecap: round;
  }

  /* Fully-owned edge (both endpoints owned): a steady brighter "live" glow, no
     pulse. accent-bright matches owned-node coloring; the drop-shadow is the
     steady glow. */
  .web-edge.owned {
    stroke: var(--color-accent-bright);
    stroke-width: 2.5; /* TUNABLE: owned edges slightly heavier — Checkpoint B */
    filter: drop-shadow(0 0 3px rgba(var(--color-accent-rgb), 0.55)); /* TUNABLE: owned glow strength — Checkpoint B */
  }

  /* Learnable pathway (exactly one endpoint owned): a subtle base line PLUS a
     bright short dash that TRAVELS from (x1,y1)=owned end toward (x2,y2)=learnable
     end, drawing the eye to "learn next". Technique: a dashed stroke whose
     stroke-dashoffset is animated so the lit dash marches along the line. Point
     order (owned-first) is set in visibleEdges, so a negative dashoffset ramp
     moves the dash in the point1→point2 (owned→learnable) direction. The glow is
     a drop-shadow. Base visibility comes from the dim .web-edge stroke underneath
     the moving dash pattern (the same stroke is dashed, so between lit dashes the
     line reads as faint accent — subtle/ambient, not seizure-y). */
  .web-edge.learnable {
    stroke: var(--color-accent-bright);
    stroke-width: 2.5; /* TUNABLE: learnable edge thickness — Checkpoint B */
    /* Short bright dash + long gap = one travelling pulse, mostly-empty line.
       TUNABLE: dash size / gap (pulse length + spacing) — Checkpoint B. */
    stroke-dasharray: 14 120;
    filter: drop-shadow(0 0 4px rgba(var(--color-accent-rgb), 0.7)); /* TUNABLE: pulse glow strength — Checkpoint B */
    /* Animate the offset so the dash marches point1→point2 (owned→learnable).
       The offset ramps by one full dash+gap period (14+120=134) per cycle so the
       motion is seamless (the pattern repeats identically each period).
       TUNABLE: pulse speed (cycle duration) — Checkpoint B. */
    animation: web-edge-pulse 2.4s linear infinite;
  }

  /* One pulse period: shift the dash pattern by a full period (134px) in the
     negative direction, which visually moves the lit dash from the start point
     (x1,y1 = owned) toward the end point (x2,y2 = learnable). */
  @keyframes web-edge-pulse {
    from {
      stroke-dashoffset: 0;
    }
    to {
      stroke-dashoffset: -134; /* = -(dash 14 + gap 120); keep in sync with stroke-dasharray */
    }
  }

  /* Accessibility: users who ask for reduced motion get NO travelling pulse.
     Fall back to a static glow — the learnable edge still reads as "live" (bright
     stroke + drop-shadow) but nothing moves. */
  @media (prefers-reduced-motion: reduce) {
    .web-edge.learnable {
      animation: none;
      /* Solid bright line (drop the dash gaps) so, without motion, the pathway
         still stands out as a steady glowing link rather than a dotted line. */
      stroke-dasharray: none;
    }
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

  /* --- Tooltip overlay (Task 11) ----------------------------------------
     Full-screen dim+blur backdrop, matching App.svelte's .tooltip-backdrop /
     .modal-backdrop idiom (same fixed/inset/blur/flex-center/z-index recipe).
     Rendered as a <body> child via use:portal (see the `portal` action) so this
     position:fixed backdrop is truly viewport-fixed even inside a future Panel's
     backdrop-filter — the known trap this whole overlay is portaled to avoid.
     The scrim's rgba(0,0,0,...) is a deliberate neutral black, the ONE literal
     colour here (matching the existing backdrops); everything else is theme
     vars so the 6 themes reskin the card. */
  .web-tooltip-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.6);
    backdrop-filter: blur(6px);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 100;
    padding: 20px;
  }
  /* The centered content card. Modestly larger than the prior placeholder
     (280px/85vw) per design §4.4 — the mockup-1 feedback asked for a bump.
     TUNABLE: final size is a Checkpoint A item. */
  .web-tooltip {
    width: 340px; /* TUNABLE: tooltip width — was 280px placeholder; verify on phone at Checkpoint A */
    max-width: 88vw; /* TUNABLE: cap on narrow screens — Checkpoint A */
    padding: 16px 18px; /* TUNABLE: tooltip padding — Checkpoint A */
    background: var(--color-panel-bg-strong);
    border: 1px solid rgba(var(--color-accent-rgb), 0.35);
    border-radius: 8px;
    box-shadow: 0 4px 14px rgba(0, 0, 0, 0.35);
  }
  .web-tooltip-header {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 8px;
    margin-bottom: 8px;
  }
  .web-tooltip-title {
    font-family: var(--font-body);
    font-size: 15px; /* TUNABLE: title size — Checkpoint A */
    font-weight: 600;
    color: var(--color-text-primary);
    margin: 0;
    line-height: 1.2;
  }
  /* × close button: minimal, theme-tinted, hit-area-friendly. */
  .web-tooltip-close {
    flex: 0 0 auto;
    background: transparent;
    border: none;
    color: var(--color-text-secondary);
    font-size: 18px;
    line-height: 1;
    padding: 2px 6px;
    cursor: pointer;
  }
  .web-tooltip-close:hover {
    color: var(--color-text-primary);
  }
  .web-tooltip-effect {
    font-size: 13px; /* TUNABLE: effect line size — Checkpoint A */
    font-weight: 600;
    color: var(--color-success);
    margin: 0 0 8px;
    line-height: 1.35;
  }
  .web-tooltip-cost {
    font-size: 12px;
    color: var(--color-text-secondary);
    margin: 0 0 8px;
  }
  .web-tooltip-flavor {
    font-size: 12px;
    font-style: italic;
    color: var(--color-text-secondary);
    margin: 0 0 12px;
    line-height: 1.4;
  }
  .web-tooltip-action {
    display: flex;
    justify-content: flex-end;
  }
  /* Learn button: accent-bordered primary action (matches the learnable-node
     accent look). Disabled → dimmed + not-allowed (unaffordable/locked). */
  .web-tooltip-learn {
    padding: 8px 16px; /* TUNABLE: Learn button size — Checkpoint A */
    background: rgba(var(--color-accent-rgb), 0.12);
    border: 1px solid var(--color-accent);
    color: var(--color-accent-bright);
    font-family: var(--font-body);
    font-size: 13px;
    font-weight: 600;
    cursor: pointer;
    border-radius: 0; /* square, matching the node/panel chamfer idiom */
  }
  .web-tooltip-learn:hover:not(:disabled) {
    background: rgba(var(--color-accent-rgb), 0.22);
  }
  .web-tooltip-learn:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }
  /* Owned state: a static success-tinted label instead of a Learn button. */
  .web-tooltip-owned {
    padding: 8px 16px;
    font-size: 13px;
    font-weight: 600;
    color: var(--color-success);
  }
</style>
