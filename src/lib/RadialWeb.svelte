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
  //   paint on device — root-cause fixed via the HALF offset const). Each edge is
  //   an L-SHAPED ORTHOGONAL ELBOW <path> (a horizontal run then a vertical run
  //   meeting at a 90° corner — NOT a diagonal line), per the Checkpoint-A
  //   feedback correction. Lighting is classified by BOTH endpoints' ownership:
  //   an edge with BOTH endpoints owned is "powered" (a steady outer glow on the
  //   whole L PLUS a travelling pulse flowing hub-outward); every other edge is
  //   "dormant" (a dim dark line — topology only, no glow, no pulse). Pulse
  //   direction is hub-outward: a per-node BFS depth from the branch hub
  //   (`depthFromHub`) orders each edge shallow→deep so the elbow starts hub-side
  //   and the pulse flows away from the hub. See the `HALF` const, the
  //   `depthFromHub` BFS, the `visibleEdges` derivation, and the `.web-connectors`
  //   <svg> in the markup.
  //
  //   Task 10 (this addition): Pointer-Events pan + tap/drag disambiguation.
  //   A pointer drag on .web-viewport translates the world via (panX, panY); a
  //   near-stationary press is a TAP that (on a node) opens that node's tooltip.
  //   The two are told apart by movedDistance vs TAP_THRESHOLD_PX. Tap resolution
  //   happens in the viewport's OWN pointerup by reading the EVENT TARGET
  //   (`e.target.closest("[data-node-key]")`) — the node/child actually under the
  //   finger, bubbled up to the viewport handler by event delegation. (Checkpoint-A
  //   device fix: capture is now taken ONLY once a drag crosses the threshold, so a
  //   clean TAP never captures — `e.target` stays the real node, no coordinate math.
  //   The earlier build captured on every pointerdown and hit-tested the release
  //   point with document.elementFromPoint, which was unreliable on mobile under
  //   capture + the transform-panned world — it only resolved near the viewport
  //   center, so off-center taps silently failed to open.) Keyboard Enter/Space on
  //   a focused node is a separate, capture-free path handled by the button's
  //   on:keydown. See the "Pan + tap/drag disambiguation" block for the lifecycle.
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
    // Progression Pacing Rework (Task 10): OPTIONAL Fleet-Admiral-level wall on
    // this node, LAYERED on top of its adminPoint `cost` + graph adjacency. Only
    // the homeworld captain-slot unlocks set it (fleetLogisticsSlot1/2/3 = 1/5/25);
    // captain talents never do, so the requirement UI below is opt-in and simply
    // absent for any node that omits the field. buyHomeworldTalent (tick.ts)
    // already ENFORCES the wall; this component only SURFACES it in the tooltip.
    requiresFleetAdminLevel?: number;
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
  // `fleetAdminLevel` — the fleet's CURRENT Fleet Admiral level (Task 10). Read
  // ONLY to surface a node's `requiresFleetAdminLevel` wall in the tooltip:
  // met when fleetAdminLevel >= the node's required level, unmet (red) below it.
  // Defaulted to 0 so a parent that mounts a table WITHOUT level walls (the
  // captain talents — none carry requiresFleetAdminLevel) needn't pass it; the
  // requirement branch never evaluates for such nodes, so the default is inert
  // there. The homeworld mount passes state.fleetAdminLevel (see App.svelte).
  export let fleetAdminLevel: number = 0;

  // --- Pan offset (Task 10) -------------------------------------------------
  // The world is translated by (panX, panY). Task 10 drives these from a
  // Pointer-Events drag on .web-viewport. They start at 0 (hub centered — see
  // the `.web-world` centering note in the style block) and accumulate pointer deltas.
  let panX = 0;
  let panY = 0;

  // --- Pan + tap/drag disambiguation (Task 10) ------------------------------
  // Unified mouse+touch+stylus via the Pointer Events API. One .web-viewport
  // pointer gesture is EITHER a pan (world drags under the finger) OR a tap
  // (which, when it lands on a node <button>, opens that node's tooltip). We tell
  // them apart by how far the pointer moved during the gesture (movedDistance vs
  // TAP_THRESHOLD_PX).
  //
  // CAPTURE-ONLY-ON-DRAG (Checkpoint-A device fix — the crux of this component):
  // setPointerCapture is NOT called on pointerdown. It is taken lazily in
  // handlePointerMove the moment movedDistance first crosses TAP_THRESHOLD_PX —
  // i.e. only once the gesture has become a real DRAG. Consequences:
  //   * A TAP never captures. So `e.target` on the pointerup stays the ACTUAL node
  //     (or a child span) under the finger, and handlePointerUp resolves the tapped
  //     node via `e.target.closest("[data-node-key]")` (event delegation bubbles
  //     the node's event up to this viewport handler). No coordinate math, works
  //     off-center. This FIXES the Checkpoint-A mobile bug where the old build
  //     captured on every pointerdown and hit-tested the release point with
  //     document.elementFromPoint — unreliable on mobile under capture + the
  //     transform-panned world (only resolved near the viewport center, so
  //     off-center taps silently failed).
  //   * A DRAG captures as soon as it crosses the threshold, so panning keeps
  //     tracking even when the finger leaves the viewport (capture routes the
  //     remaining move/up events back to us). There is no tracking gap: below the
  //     threshold the finger is within ~8px of its start, still over the viewport,
  //     so its events fire normally; at/after the threshold capture is engaged.
  // Keyboard activation is a separate path (each node button's on:keydown handles
  // Enter/Space) — no pointer capture is involved there, so it reliably opens the
  // tooltip for accessibility.

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
  // `captured` — true once this gesture has crossed TAP_THRESHOLD_PX and taken
  // pointer capture (see handlePointerMove). It stays false for a pure TAP, which
  // is exactly why a tap's `e.target` remains the real node (no capture retarget).
  // handlePointerUp releases capture only when this is set, then resets it.
  let captured = false;

  // --- Gesture handlers -----------------------------------------------------

  /**
   * pointerdown — begin a gesture. Snapshots the start point and current pan,
   * arms `dragging`, zeroes the movement accumulator, and clears `captured`.
   *
   * NB: pointer capture is deliberately NOT taken here. Capturing on every
   * pointerdown retargets a clean tap's `e.target` (and the compatibility click)
   * to the viewport, which broke off-center taps on mobile (the Checkpoint-A bug).
   * Instead capture is taken lazily in handlePointerMove only once the gesture
   * crosses TAP_THRESHOLD_PX (i.e. becomes a real drag) — so a TAP never captures
   * and its `e.target` stays the actual node under the finger.
   */
  function handlePointerDown(e: PointerEvent) {
    dragging = true;
    startX = e.clientX;
    startY = e.clientY;
    panX0 = panX;
    panY0 = panY;
    movedDistance = 0;
    captured = false; // no capture yet; taken in handlePointerMove iff a drag starts
  }

  /**
   * pointermove — while a gesture is active, translate the world by the pointer
   * delta from the start point (absolute-from-start via panX0/panY0, so it never
   * accumulates rounding drift) and update movedDistance. movedDistance is the
   * sole tap-vs-pan discriminator, read once at pointerup: a release with
   * movedDistance < TAP_THRESHOLD_PX is a TAP (resolved from e.target), at or
   * beyond it is a PAN (no node opens). Ignored when not dragging (nothing held).
   *
   * CAPTURE-ON-DRAG: the first move that pushes movedDistance to/over
   * TAP_THRESHOLD_PX takes pointer capture (once — guarded by `captured`). That
   * makes this gesture a real drag: capture routes subsequent move/up back to the
   * viewport even after the finger leaves it, so an off-viewport pan keeps
   * tracking. A gesture that never crosses the threshold (a TAP) never captures,
   * so its pointerup `e.target` stays the actual node under the finger.
   */
  function handlePointerMove(e: PointerEvent) {
    if (!dragging) return;
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;
    panX = panX0 + dx;
    panY = panY0 + dy;
    movedDistance = Math.hypot(dx, dy);

    // Cross the tap/pan threshold → this is a drag → capture the pointer so pan
    // keeps tracking off-viewport. Done once (`!captured`). Guarded: capture is
    // best-effort — a failed capture only degrades off-element tracking, so it
    // must never break the pan (handled explicitly per Omega 14, not swallowed
    // invisibly). A TAP (below threshold) reaches neither branch, so it stays
    // capture-free and its e.target remains the tapped node.
    if (!captured && movedDistance >= TAP_THRESHOLD_PX) {
      const target = e.currentTarget;
      if (target instanceof Element) {
        try {
          target.setPointerCapture(e.pointerId);
          captured = true;
        } catch {
          // Non-fatal: capture unavailable → in-viewport drag still works. Leave
          // `captured` false so pointerup skips the release (nothing to release).
        }
      }
    }
  }

  /**
   * pointerup / pointercancel — end the gesture. Clears `dragging`, releases
   * pointer capture (only if this gesture actually took it), and — for a TAP —
   * resolves which node was tapped and opens its tooltip.
   *
   * Tap resolution reads the EVENT TARGET: `e.target.closest("[data-node-key]")`.
   * Because a tap never captured the pointer (capture is taken only once a drag
   * crosses the threshold — see handlePointerMove), `e.target` is the ACTUAL node
   * button (or a child span) under the finger, delivered here by event delegation
   * (the node's pointerup bubbles up to this viewport handler). So `.closest`
   * walks up to the owning node and yields its key with NO coordinate math — which
   * is what makes off-center taps work reliably on mobile AND desktop. This
   * replaced the old document.elementFromPoint hit-test, which was unreliable on
   * mobile under pointer capture + the transform-panned world (it only resolved
   * correctly near the viewport center — the Checkpoint-A bug).
   *
   * A pan (movedDistance >= TAP_THRESHOLD_PX) skips the resolution entirely, so no
   * node opens at the end of a drag. A tap on empty space has an e.target with no
   * [data-node-key] ancestor, so nothing opens. A pointercancel is treated like an
   * up: end cleanly (with touch-action:none the browser won't steal the gesture
   * for scroll, so cancels are rare).
   */
  function handlePointerUp(e: PointerEvent) {
    dragging = false;

    // A near-stationary gesture is a TAP. Resolve the tapped node in TWO steps:
    //
    //   1. Fast path — the EVENT TARGET. No capture happens on a tap (capture is
    //      taken only when a drag crosses the threshold), so e.target is normally
    //      the real node/child under the finger, bubbled here by event delegation.
    //      .closest walks up to the owning node button and yields its data-node-key.
    //
    //   2. Fallback — elementsFromPoint STACK-SEARCH. On mobile a transparent
    //      element with pointer-events:auto can sit OVER the nodes in the bottom
    //      band of the panel: pointer events still reach the viewport (so drag/pan
    //      works), but the tap's e.target is that overlay, whose .closest finds no
    //      node → the tooltip never opens. document.elementsFromPoint returns ALL
    //      elements at the tap point top-to-bottom (skipping pointer-events:none
    //      ones), so we scan that stack for the first that resolves to a node,
    //      seeing PAST the overlay. This is reliable precisely because a tap never
    //      captured the pointer — the client coords map straight to the real
    //      hit-stack (the earlier capture-time elementFromPoint approach was flaky
    //      for exactly the opposite reason: capture distorts the resolve).
    //
    // Tapping empty space resolves to no [data-node-key] in either step → opens
    // nothing, which is correct. A pan (movedDistance >= threshold) skips this
    // branch entirely.
    if (movedDistance < TAP_THRESHOLD_PX) {
      let nodeEl: Element | null =
        e.target instanceof Element ? e.target.closest("[data-node-key]") : null;
      if (!nodeEl && typeof document !== "undefined" && document.elementsFromPoint) {
        for (const el of document.elementsFromPoint(e.clientX, e.clientY)) {
          const hit = el.closest("[data-node-key]");
          if (hit) {
            nodeEl = hit;
            break;
          }
        }
      }
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

    // Release capture ONLY if this gesture took it (a drag that crossed the
    // threshold). A tap never captured, so there's nothing to release. Guarded by
    // hasPointerCapture too, and wrapped in try/catch — releasing is best-effort
    // and must never break gesture teardown. Reset `captured` for the next
    // gesture.
    if (captured) {
      const target = e.currentTarget;
      if (target instanceof Element && target.hasPointerCapture(e.pointerId)) {
        try {
          target.releasePointerCapture(e.pointerId);
        } catch {
          // Non-fatal: releasing an already-released/absent capture is harmless.
        }
      }
    }
    captured = false;
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
  // Task 10: `fleetAdminLevel` is ALSO referenced directly (in the levelMet math
  // below), so leveling up the Fleet Admiral while a walled node's tooltip is open
  // live-updates the requirement line (red→neutral) and re-enables Learn.
  $: tooltip =
    openTooltipKey !== null && table[openTooltipKey]
      ? (() => {
          const key = openTooltipKey as string;
          const def = table[key];
          // Explicit dependency touches so Svelte tracks ownedSet AND
          // fleetAdminLevel for this block: nodeState()/fleetAdminLevelMet() read
          // them from closure, but Svelte can't see inside a call, so without
          // these touches the tooltip would not refresh when the player learns a
          // node (ownedSet) or the Fleet Admiral levels past a wall
          // (fleetAdminLevel). No-op at runtime beyond registering the deps.
          void ownedSet;
          void fleetAdminLevel;
          const st = nodeState(key, def);
          // shortfall — how many more points are needed when unaffordable (>0
          // only for a not-owned, not-affordable node). Drives the "need N more"
          // hint on the disabled Learn button / cost line.
          const shortfall = st.owned ? 0 : Math.max(0, def.cost - points);
          // Task 10 — Fleet-Admiral-level wall, for the requirement line below.
          // `requiresLevel` is this node's required FA level (undefined => no
          // wall). `levelMet` reuses the SAME fleetAdminLevelMet helper nodeState
          // uses, so the square's .locked tint and this tooltip's red/neutral
          // line can never disagree about the wall.
          const requiresLevel = def.requiresFleetAdminLevel;
          const levelMet = fleetAdminLevelMet(def);
          return {
            key,
            label: def.label,
            // describeEffect is the parent's table-correct describer; def.effect
            // is passed through untouched (RadialWeb never interprets it).
            effectLine: describeEffect(def.effect),
            flavor: def.flavor,
            cost: def.cost,
            owned: st.owned,
            // Learn is enabled ONLY when learnable. As of Task 10, nodeState's
            // `learnable` ALREADY folds in the FA-level wall (it calls the same
            // fleetAdminLevelMet helper), so this needs no extra levelMet term —
            // the button disables for a walled node exactly the way it disables
            // for an unaffordable one.
            canLearn: st.learnable,
            shortfall,
            // Requirement-line inputs (Task 10). requiresLevel undefined => no
            // line is rendered (see the tooltip markup); levelMet drives met
            // (neutral) vs unmet (red) styling.
            requiresLevel,
            levelMet,
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

  // --- Derived: graph depth from the hub (pulse direction source) ------------
  // depthFromHub maps each node key in THIS branch to its BFS distance from the
  // branch's hub node (the def with isHub === true): hub = 0, the hub's direct
  // neighbours = 1, their neighbours = 2, and so on. It is the single source of
  // truth for "which end of an edge is closer to the hub", which the edge
  // derivation uses to orient every elbow shallow→deep so any pulse flows
  // OUTWARD from the hub (hub-side start → far end).
  //
  // WHY it depends only on table/branch (NOT ownership): the graph topology and
  // the hub don't change when the player learns a node, so depth is stable across
  // ownership changes. Svelte re-runs this block only when `table` or `branch`
  // change (the two vars it references directly), so the BFS is not recomputed on
  // every learn — just when the rendered branch/table actually changes.
  //
  // Scope: the BFS walks the WHOLE branch subgraph (every def with branch ===
  // branch), not just the currently-visible subset, so depths are correct even
  // for edges whose hub-side path runs through not-yet-visible nodes. Nodes
  // unreachable from the hub (or a branch with no hub) get no entry; the edge
  // derivation treats a missing depth as +Infinity so such edges still orient
  // deterministically (see the tie-break note there).
  $: depthFromHub = (() => {
    const depth = new Map<string, number>();

    // Find this branch's hub (the BFS root). A well-formed branch has exactly
    // one; if none exists, the map stays empty and edges fall back to the
    // key-string tie-break for a stable (if hub-agnostic) orientation.
    let hubKey: string | null = null;
    for (const key of Object.keys(table)) {
      const def = table[key];
      if (def && def.branch === branch && def.isHub === true) {
        hubKey = key;
        break;
      }
    }
    if (hubKey === null) return depth;

    // Standard breadth-first traversal over the bidirectional `neighbors` graph,
    // restricted to this branch. A FIFO queue + the depth map itself as the
    // visited set (a key is enqueued exactly once, when first assigned a depth)
    // guarantees each node gets its SHORTEST distance and the loop terminates.
    depth.set(hubKey, 0);
    const queue: string[] = [hubKey];
    let head = 0; // index-based dequeue (avoids O(n) Array.shift per step)
    while (head < queue.length) {
      const cur = queue[head++];
      const curDepth = depth.get(cur) as number;
      const curDef = table[cur];
      if (!curDef) continue; // defensive: dangling key
      for (const nb of curDef.neighbors) {
        const nbDef = table[nb];
        // Stay within this branch and skip already-visited nodes (those already
        // in `depth`), so each node is assigned its first/shortest depth once.
        if (!nbDef || nbDef.branch !== branch) continue;
        if (depth.has(nb)) continue;
        depth.set(nb, curDepth + 1);
        queue.push(nb);
      }
    }
    return depth;
  })();

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
  // One L-SHAPED ORTHOGONAL ELBOW is drawn per UNDIRECTED edge whose BOTH
  // endpoints are visible — a horizontal run from the shallow (hub-side) endpoint
  // then a vertical run up to the deep endpoint, meeting at a 90° corner (NOT a
  // diagonal). Derivation rules:
  //
  //   * Both-endpoints-visible: an edge is emitted ONLY when a AND b are both in
  //     `visible`. An elbow into a hidden node would leak fog-of-war info, so
  //     those are skipped entirely (never drawn).
  //   * Dedupe: `neighbors` is bidirectional by convention (A lists B and B lists
  //     A — see plan line 87), so every undirected edge shows up twice. We emit it
  //     exactly once by only taking the direction where `key < neighborKey`
  //     (lexicographic string compare). That single inequality both dedupes AND
  //     drops self-loops (key === key fails `<`), with no auxiliary Set needed.
  //
  //   * SHALLOW→DEEP ORIENTATION (drives hub-outward pulse direction). Each edge's
  //     two endpoints are ordered by their `depthFromHub` BFS depth: the SHALLOWER
  //     (smaller depth, hub-side) endpoint becomes the START (ax,ay), the DEEPER
  //     endpoint becomes the END (bx,by). The elbow path (H-then-V, corner at
  //     (bx,ay)) is drawn start→end, so a powered edge's travelling pulse (an
  //     animated stroke-dashoffset marching start→end) flows shallow→deep =
  //     OUTWARD from the hub. Ties (equal depth, or both missing from the BFS —
  //     e.g. a hub-less branch) are broken DETERMINISTICALLY by key string so the
  //     orientation is stable across renders (the smaller key starts).
  //
  //   * POWERED vs DORMANT LIGHTING (drives the look — see the markup / CSS).
  //     Classified purely by whether BOTH endpoints are owned:
  //       - "powered" (BOTH endpoints owned): the whole L is "engaged" — a soft
  //         STEADY outer glow on a base rail PLUS a bright travelling pulse
  //         flowing start→end (shallow→deep = hub-outward). This is the ONLY
  //         lit/animated state.
  //       - "dormant" (NOT both owned — one or both endpoints unlearned): a DIM,
  //         DARK line — low opacity, no glow, no pulse — just enough to show the
  //         connection topology.
  //     (This INVERTS the earlier owned↔learnable pulse behaviour: only a
  //     fully-learned link now lights up.)
  //
  // Coordinates carried through are the RAW web-space (x, y) of each endpoint —
  // the same values the nodes render at. The markup adds +HALF to each when
  // drawing (see HALF above) so, with the SVG shifted −HALF, endpoints land
  // exactly on node centers (works for negative coords too).
  //
  // Reactive on visibleNodes, ownedSet AND depthFromHub (all read directly, so
  // Svelte tracks each): visibleNodes covers visible/branch/table changes,
  // ownedSet drives the powered/dormant class, and depthFromHub drives the
  // shallow→deep ordering. Learning a node thus both re-reveals neighbours and
  // re-classifies its edges (dormant→powered) on the next tick.
  $: visibleEdges = (() => {
    // A fast membership set of visible keys so the neighbor scan is O(1) per
    // lookup instead of re-scanning visibleNodes. Built from visibleNodes (not
    // the raw `visible` set) so it already respects the branch filter applied
    // there — an edge is only drawn when both ends survive that same filter.
    const visibleKeys = new Set(visibleNodes.map((n) => n.key));

    // Depth lookup: a node absent from the BFS (unreachable / hub-less branch)
    // is treated as +Infinity so it always sorts as the DEEPER end, leaving the
    // key-string tie-break to decide orientation deterministically.
    const depthOf = (k: string) =>
      depthFromHub.has(k) ? (depthFromHub.get(k) as number) : Infinity;

    const edges: {
      ax: number; // START = shallower (hub-side) endpoint
      ay: number;
      bx: number; // END = deeper endpoint
      by: number;
      // "powered" (both endpoints owned → glow + hub-outward pulse) or "dormant"
      // (not both owned → dim dark line, no glow/pulse).
      lighting: "powered" | "dormant";
    }[] = [];

    for (const { key, def } of visibleNodes) {
      for (const neighborKey of def.neighbors) {
        // Skip edges into hidden nodes (fog-of-war) and, via the `<` test below,
        // the duplicate reverse direction + any self-loop.
        if (!visibleKeys.has(neighborKey)) continue;
        if (!(key < neighborKey)) continue; // emit each undirected pair once

        const neighborDef = table[neighborKey];
        if (!neighborDef) continue; // defensive: dangling neighbor ref

        // Lighting: powered ONLY when BOTH endpoints are owned; dormant otherwise.
        const bothOwned = ownedSet.has(key) && ownedSet.has(neighborKey);

        // Orient shallow→deep so the pulse flows hub-outward. Compare BFS depth;
        // on a tie (equal depth or both +Infinity), the smaller key string starts
        // — a deterministic, render-stable tie-break.
        const keyDepth = depthOf(key);
        const neighborDepth = depthOf(neighborKey);
        let start = def;
        let end = neighborDef;
        if (
          neighborDepth < keyDepth ||
          (neighborDepth === keyDepth && neighborKey < key)
        ) {
          // Neighbor is the shallower (hub-side) end → it starts the elbow.
          start = neighborDef;
          end = def;
        }

        edges.push({
          ax: start.x,
          ay: start.y,
          bx: end.x,
          by: end.y,
          lighting: bothOwned ? "powered" : "dormant",
        });
      }
    }
    return edges;
  })();

  // --- Fleet-Admiral-level wall (Task 10) — single source of truth -----------
  // Returns whether THIS node's FA-level wall is satisfied. undefined field =>
  // no wall => always met; otherwise the fleet must have reached the required
  // level. This is the ONE place the wall is evaluated: BOTH the node-square
  // classifier (nodeState, for the .locked/.learnable tint) AND the tooltip's
  // requirement line/Learn gate call it, so the square and the tooltip can never
  // disagree about whether a node is wall-blocked. It mirrors the gate enforced
  // in buyHomeworldTalent (tick.ts) so the UI's buyability read matches what the
  // buy action will actually allow.
  //
  // Reads the `fleetAdminLevel` prop from closure (like nodeState reads `points`/
  // `ownedSet`). INERT for the captain table: no captain talent carries
  // requiresFleetAdminLevel, so this always returns true there and the captain
  // squares/tooltips reduce to their pre-Task-10 cost-only behavior regardless of
  // the prop's default (0).
  function fleetAdminLevelMet(def: RadialNode): boolean {
    return (
      def.requiresFleetAdminLevel === undefined ||
      fleetAdminLevel >= def.requiresFleetAdminLevel
    );
  }

  // --- Per-node state classification ----------------------------------------
  // Exactly ONE of owned / learnable / locked applies to any visible node;
  // `.hub` is an ORTHOGONAL flag layered on top (a hub can itself be owned,
  // learnable, or locked). Rules (design §2.1 / §3.4, extended by Task 10):
  //   owned     — key ∈ owned.
  //   learnable — visible, NOT owned, affordable (cost <= points), AND its
  //               FA-level wall is met.
  //   locked    — visible, NOT owned, and NOT buyable — i.e. unaffordable
  //               (cost > points) OR wall-blocked (FA level too low).
  // "visible" is a given here (we only iterate visible nodes). Task 10 folds the
  // FA-level wall into this split so an affordable-but-walled slot renders
  // `.locked` (dimmed, cursor:not-allowed) exactly like an unaffordable one,
  // instead of the misleading bright `.learnable` accent that invited a tap the
  // buy would silently reject. INERT for the captain table (fleetAdminLevelMet is
  // always true there — no captain def carries the wall), so captain squares
  // render exactly as before. Returned as a plain object so the markup can spread
  // the boolean flags into class: directives.
  function nodeState(key: string, def: RadialNode) {
    const isOwned = ownedSet.has(key);
    const affordable = def.cost <= points; // TUNABLE: affordability is a pure cost<=points gate (no partial states)
    // buyable — not owned, cost met, AND FA-level wall met. learnable == buyable;
    // locked is its not-owned complement. This keeps the owned/learnable/locked
    // trichotomy exact (one and only one holds) while layering the wall on.
    const buyable = !isOwned && affordable && fleetAdminLevelMet(def);
    return {
      owned: isOwned,
      learnable: buyable,
      locked: !isOwned && !buyable,
      hub: def.isHub === true,
    };
  }
</script>

<!-- Escape-to-close for the Task 11 tooltip. handleKeydown is a no-op unless a
     tooltip is open, so this window listener never interferes with other keys. -->
<svelte:window on:keydown={handleKeydown} />

<!-- Viewport: the clipped window onto the world. Fills its parent. Task 10's
     pan gestures attach here via Pointer Events (unified mouse+touch+stylus).
     touch-action:none (in the style block) stops the browser hijacking touch-drags as
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
         .web-node that follows. DOM order already stacks later siblings on top;
         an explicit z-index (SVG z-index:0, .web-node z-index:1 — see the style block)
         makes that reliable so each opaque node covers its elbow's inner portion.
         pointer-events:none (set in the style block) so it never intercepts a node tap or
         a pan drag.

         COORDINATE ALIGNMENT — the one part that must be exactly right (Device
         Checkpoint A rework; see the HALF const in the script block for the full rationale
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

         Each edge is an L-SHAPED ORTHOGONAL ELBOW <path> (a horizontal run then a
         vertical run meeting at a 90° corner — NOT a diagonal). The path is
         "M {startX} {startY} H {cornerX} V {endY}": it starts at the SHALLOW
         (hub-side) endpoint (ax,ay), runs horizontally to the corner at
         (endX, startY) = (bx, ay), then runs vertically up to the DEEP endpoint
         (bx,by). start→end is shallow→deep, so a powered edge's travelling pulse
         (animated stroke-dashoffset) flows OUTWARD from the hub. Endpoints get
         +HALF (see the HALF const) so they land on node centers.

         The per-edge `lighting` class drives the look (see CSS):
           .powered  — TWO stacked <path>s (both owned): (1) a base RAIL with a
                       soft STEADY outer glow so the whole L reads as "engaged",
                       then (2) a bright glowing OVERLAY that travels along it
                       start→end (shallow→deep = hub-outward). This is the ONLY
                       lit/animated state.
           (default) — DORMANT (not both owned): a single dim, DARK path — no glow,
                       no pulse — just enough to show the connection topology. NO
                       overlay emitted.
         Only powered edges get the second (overlay) path, so dormant edges are
         never doubled. No fill; stroke only; no arrowheads. The node layer that
         follows paints OPAQUELY on top of these paths, hiding each elbow's inner
         portion so a link visually connects at a node's EDGE, not its center. -->
    <svg class="web-connectors" aria-hidden="true">
      {#each visibleEdges as e}
        <!-- Base elbow path for EVERY edge. Its `lighting` class sets the look:
             .powered = steady glow rail the pulse rides on; (default) = dim dark
             dormant line. H-then-V: start (ax,ay) → corner (bx,ay) → end (bx,by),
             each coord +HALF so it lands on node centers; shallow→deep order is
             baked into ax,ay/bx,by by visibleEdges. -->
        <path
          class="web-edge"
          class:powered={e.lighting === "powered"}
          d="M {e.ax + HALF} {e.ay + HALF} H {e.bx + HALF} V {e.by + HALF}"
        />
        <!-- Overlay path: ONLY for powered edges. Same elbow + shallow→deep order
             as the base, drawn ON TOP as a glowing travelling segment that flows
             start (ax,ay) → end (bx,by) = hub-outward via animated
             stroke-dashoffset. Emitted only for powered so dormant edges aren't
             doubled. -->
        {#if e.lighting === "powered"}
          <path
            class="web-edge-pulse-overlay"
            d="M {e.ax + HALF} {e.ay + HALF} H {e.bx + HALF} V {e.by + HALF}"
          />
        {/if}
      {/each}
    </svg>
    {#each visibleNodes as { key, def } (key)}
      {@const st = nodeState(key, def)}
      <!-- Locked (unaffordable) nodes stay tappable ON PURPOSE: Task 11's tooltip
           shows the node's cost/effect so the player learns WHY it's locked. Only
           the Learn action (Task 11) is affordability-gated -- do NOT add
           `disabled` here, which would swallow the tap and hide that tooltip.

           data-node-key is the tap-resolution anchor: handlePointerUp resolves a
           tap by e.target.closest("[data-node-key]") and reads this attribute to
           know which node was tapped. That works because a tap never captures the
           pointer (capture is taken only once a drag starts — see
           handlePointerMove), so e.target is the real node/child under the finger,
           bubbled to the viewport handler by event delegation. That pointerup path
           (not a click handler) opens the tooltip. on:keydown is the SEPARATE
           keyboard path (Enter/Space on a focused node) — no pointer capture is
           involved there either, so it opens the tooltip reliably, preserving
           accessibility. -->
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
     in the script block). The backdrop's flex centering places the card; the card has no
     position of its own.

     Dismiss paths:
       - Backdrop: on:POINTERUP|self closes ONLY when the release lands on the
         backdrop itself (not bubbled up from the card). It is deliberately
         pointerup, NOT click: a node tap opens the tooltip on its OWN pointerup,
         and the tap's trailing compatibility `click` then lands on the just-
         appeared backdrop. With on:click that trailing click closed the tooltip
         instantly — but ONLY for taps toward the edges, where the click missed the
         centered card and hit the backdrop (a center tap's click hit the card and
         survived). That was the mobile "edge/bottom taps don't register" bug: the
         tooltip opened and immediately self-closed. pointerup fixes it because the
         opening tap's pointerup fired on the NODE (before this backdrop existed),
         and the trailing compat `click` is not a pointerup — so it can't dismiss.
         A genuine dismiss tap (a fresh pointer press+release on the backdrop) still
         closes normally. This overlay is a body-level element over the whole
         viewport, so a backdrop release is intercepted here and can't leak to a
         node underneath.
       - × button: explicit close.
       - Escape: handled by the <svelte:window> keydown above.

     Colors are theme vars throughout; the only literal is the neutral black scrim
     opacity, matching App.svelte's .tooltip-backdrop / .modal-backdrop idiom. -->
{#if tooltip}
  <div
    class="web-tooltip-backdrop"
    use:portal
    on:pointerup|self={closeTooltip}
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

      <!-- Fleet-Admiral-level wall (Task 10). Rendered ONLY for a not-owned node
           that actually carries a requiresFleetAdminLevel (the homeworld captain-
           slot unlocks); every other node omits the field, so no line appears —
           the requirement UI is strictly opt-in. Owned nodes hide it too (the
           wall is already behind them), matching how the cost line hides once
           owned. Styling: the base line is the same neutral secondary look as
           .web-tooltip-cost (requirement MET). `class:unmet` flips it to the
           app's --color-danger red below the required level — a deliberately
           HARDER-gate signal than the cost line. Note both an unaffordable cost
           and an unmet wall disable the Learn button, but ONLY the wall turns
           red: the cost line NEVER reddens because adminPoints simply accumulate
           over time (a soft, self-resolving shortfall), whereas the FA-level wall
           is a hard gate you cannot buy your way past until you have leveled up —
           so red flags "blocked, and not by anything you can spend right now"
           (per design: unmet wall = red is intentional). -->
      {#if !tooltip.owned && tooltip.requiresLevel !== undefined}
        <p class="web-tooltip-requirement" class:unmet={!tooltip.levelMet}>
          Requires Fleet Admiral Level {tooltip.requiresLevel}
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
    /* TUNABLE (Checkpoint B): a BOUNDED, self-contained height so the pannable web
       is a fixed-size WINDOW that never overflows its panel. Was `height: 100%`,
       but the parent panel isn't a definite-height box, so 100% ballooned and the
       web spilled past the panel's bottom border on mobile (Checkpoint-B report).
       A clamped vh fits within the panel on phone and desktop; anything beyond the
       window is a pan away. Dial the exact vh/clamps on-device. */
    height: 46vh;
    min-height: 260px;
    max-height: 560px;
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
     node centers (see the HALF const in the script block for the arithmetic). NO
     viewBox → user units == CSS px, 1:1, un-scaled. pointer-events:none so taps
     and pan drags pass straight through to the nodes / world beneath.
     NOTE: HALF (5000) is mirrored here as 5000 / −5000 / 10000 because CSS can't
     read the JS const; keep these in sync with HALF if it is ever retuned. */
  .web-connectors {
    position: absolute;
    left: -5000px; /* = −HALF (keep in sync with the HALF const in the script block) */
    top: -5000px; /* = −HALF */
    width: 10000px; /* = 2*HALF */
    height: 10000px; /* = 2*HALF */
    z-index: 0; /* below .web-node (z-index:1) so opaque nodes cover each elbow's inner portion */
    pointer-events: none;
    overflow: visible; /* harmless belt-and-suspenders; canvas already spans the web */
  }
  /* Base elbow (DORMANT: not both endpoints owned): a dim, DARK line — visible
     just enough to show the connection topology, with NO glow and NO pulse. This
     is the resting look for every not-fully-learned link. It is ALSO the base
     RAIL under a powered edge's steady glow + travelling overlay (see
     .web-edge.powered and .web-edge-pulse-overlay). fill:none because an SVG
     <path> connector is stroke-only (the elbow must not fill its L-shaped
     interior). */
  .web-edge {
    fill: none;
    stroke: rgba(var(--color-accent-rgb), 0.14); /* TUNABLE: dormant-edge opacity (dim + dark) — Checkpoint B */
    stroke-width: 2; /* TUNABLE: dormant connector thickness (thin — topology only) — Checkpoint B */
    stroke-linecap: round;
    stroke-linejoin: round; /* soften the 90° elbow corner */
  }

  /* Powered edge BASE RAIL (BOTH endpoints owned): the "engaged" resting rail —
     a brighter accent stroke with a soft STEADY outer glow (drop-shadow) so the
     WHOLE L reads as live at all times, even between pulses. The bright travelling
     energy is a SEPARATE overlay path (.web-edge-pulse-overlay) drawn on top; this
     base never animates. Solid stroke (no dashes) so it's a continuous rail. Kept
     dimmer than the overlay so the travelling segment clearly "pops" above the
     resting rail (base vs pulse contrast). */
  .web-edge.powered {
    stroke: rgba(var(--color-accent-rgb), 0.4); /* TUNABLE: powered base-rail opacity (dimmer than the overlay) — Checkpoint B */
    stroke-width: 3; /* TUNABLE: powered base-rail thickness — Checkpoint B */
    filter: drop-shadow(0 0 3px rgba(var(--color-accent-rgb), 0.5)); /* TUNABLE: powered steady-glow strength — Checkpoint B */
  }

  /* Powered pathway TRAVELLING OVERLAY (powered edges only): the bright, glowing
     "energy" segment that flows FROM (ax,ay)=SHALLOW/hub-side end TOWARD
     (bx,by)=DEEP end — i.e. OUTWARD from the hub. Technique: a dashed stroke (one
     short bright dash + a long gap = a single lit segment on an otherwise-empty
     path) whose stroke-dashoffset is animated so that lit segment marches
     start→end along the elbow. Shallow→deep order is baked into ax,ay/bx,by in
     visibleEdges, so a NEGATIVE dashoffset ramp moves the segment hub-outward.
     A drop-shadow gives the glow that makes the motion pop above the base rail.
     Kept ambient (single travelling segment, long gap, ~2.4s loop) — bright but
     not seizure-y. Sits on top of the .web-edge.powered base rail at the same
     elbow, so it reads as "a lit rail with a pulse flowing along it". */
  .web-edge-pulse-overlay {
    fill: none;
    stroke: var(--color-accent-bright); /* TUNABLE: pulse color — Checkpoint B */
    stroke-width: 4; /* TUNABLE: pulse thickness (slightly heavier than the base rail so it pops) — Checkpoint B */
    stroke-linecap: round;
    stroke-linejoin: round; /* keep the pulse continuous around the 90° corner */
    /* Short bright dash + long gap = one travelling lit segment on a mostly-empty
       overlay. Measured along the ELBOW path length (H run + V run), so it works
       identically on the L as on a straight line. TUNABLE: dash size / gap (pulse
       length + spacing) — Checkpoint B. */
    stroke-dasharray: 18 130;
    filter: drop-shadow(0 0 5px rgba(var(--color-accent-rgb), 0.85)); /* TUNABLE: pulse glow strength — Checkpoint B */
    /* Ramp the offset by one full dash+gap period (18+130=148) per cycle so the
       motion is seamless (pattern repeats identically each period). A negative ramp
       moves the segment start→end (ax,ay → bx,by = shallow→deep = hub-outward).
       TUNABLE: pulse speed (cycle duration) — Checkpoint B. */
    animation: web-edge-pulse 2.4s linear infinite;
  }

  /* One pulse period: shift the dash pattern by a full period (148px) in the
     negative direction, which visually moves the lit segment from the start point
     (ax,ay = shallow/hub-side) toward the end point (bx,by = deep) along the elbow
     — hub-outward. Keep -148 in sync with the overlay's stroke-dasharray
     (18 + 130). */
  @keyframes web-edge-pulse {
    from {
      stroke-dashoffset: 0;
    }
    to {
      stroke-dashoffset: -148; /* = -(dash 18 + gap 130); keep in sync with stroke-dasharray */
    }
  }

  /* Accessibility: users who ask for reduced motion get NO travelling pulse. The
     overlay stops animating and becomes a STATIC solid glowing segment along the
     whole elbow (dashes dropped) so a powered pathway still reads as "live"
     (bright stroke + drop-shadow over the steady base rail) but nothing moves. */
  @media (prefers-reduced-motion: reduce) {
    .web-edge-pulse-overlay {
      animation: none;
      /* Solid bright overlay (drop the dash gaps) → a steady glowing link, not a
         dotted one, when motion is disabled. */
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
    /* Nodes paint ABOVE the .web-connectors SVG so each elbow's inner portion —
       from the node's edge to its center, where the path endpoint sits — is
       HIDDEN behind the OPAQUE node body. That makes a link visually connect at
       the node's EDGE, not pierce into its center. Two things make this reliable:
       (1) an explicit z-index above the connectors (which get z-index:0), belt-
       and-suspenders on top of the DOM order (nodes already follow the SVG), and
       (2) an OPAQUE background — --color-bg-deep is a solid theme colour, NOT the
       translucent --color-panel-bg-strong (6% alpha) used before, which would let
       the link bleed through the node body. */
    z-index: 1;
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
    background: var(--color-bg-deep); /* opaque so the link is hidden under the node body (not the translucent panel-bg) */
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
       owned     -> success-tinted + the prominent "powered" border/glow (see the
                    shared .web-node.owned, .web-node.hub rule below) so every
                    LEARNED node — not just the hub — reads as energized.
       learnable -> accent border (affordable, invites the click). NO big border.
       locked    -> dimmed (matches .skill-node.locked's opacity:0.5). NO big border.
       hub       -> the shared prominent border PLUS extra size, so it still reads
                    as the distinct seed/center node on top of the owned look. */

  /* Shared PROMINENT BORDER treatment for LEARNED (owned) nodes AND the hub.
     Factored here so a learned node gets the same thick border + double-ring the
     hub already had, WITHOUT duplicating the declarations. The box-shadow ring
     gives the "double border" read without changing the node's box size, so a
     node's center stays exactly on its (x,y). Learnable/locked nodes are excluded
     on purpose — they are NOT learned yet, so they keep the plain 1px border. */
  .web-node.owned,
  .web-node.hub {
    border-width: 2px; /* TUNABLE: prominent border thickness for learned/hub nodes — Checkpoint B */
    /* Inner panel-bg ring + outer accent ring = the "double border" read. */
    box-shadow: 0 0 0 3px var(--color-panel-bg-strong), 0 0 0 4px rgba(var(--color-accent-rgb), 0.45);
  }

  /* Owned (learned) node: success-tinted, and — layered on the shared prominent
     border above — an accent GLOW so it looks "powered", complementing the link
     pulse (node glow + link glow together read as power flowing node→node). The
     glow is a second, outer drop of the box-shadow ring; note box-shadow here
     REPLACES the shared rule's shadow for .owned (more specific match by cascade
     order — this rule comes AFTER the shared one), so it re-declares the same
     double-ring and APPENDS the outer accent bloom. */
  .web-node.owned {
    border-color: var(--color-success);
    color: var(--color-success);
    /* Double-ring (as shared) + an outer accent bloom = the powered glow.
       TUNABLE: owned-node glow strength/spread — Checkpoint B. */
    box-shadow:
      0 0 0 3px var(--color-panel-bg-strong),
      0 0 0 4px rgba(var(--color-accent-rgb), 0.45),
      0 0 12px 2px rgba(var(--color-accent-rgb), 0.55);
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
  /* Hub: the shared prominent border (above) PLUS extra SIZE so the seed/center
     node still stands out even among learned nodes now sharing that border. */
  .web-node.hub {
    width: 92px; /* TUNABLE: hub is larger than a normal node — Checkpoint A */
    height: 92px;
  }
  /* An OWNED HUB is both learned and the center: give it the owned success tint +
     powered glow AND the hub's extra size. This re-declares the owned glow ring so
     an owned hub keeps its bloom (the plain .web-node.hub above would otherwise, by
     source order, override .web-node.owned's box-shadow and drop the bloom). */
  .web-node.owned.hub {
    box-shadow:
      0 0 0 3px var(--color-panel-bg-strong),
      0 0 0 4px rgba(var(--color-accent-rgb), 0.45),
      0 0 12px 2px rgba(var(--color-accent-rgb), 0.55);
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
  /* FA-level requirement line (Task 10). Base look intentionally MATCHES
     .web-tooltip-cost (neutral secondary) so a MET requirement reads as calm,
     informational context — the same idiom as the cost line. The `.unmet`
     modifier is the ONLY visual escalation: it recolors to --color-danger, the
     app's existing cross-theme-stable red semantic token (app.css; constant
     across all 6 themes) — NOT a new colour. Weight bumps to 600 so the red
     "you can't buy this yet" state is unmissable, matching the emphasis the
     effect line already uses. */
  .web-tooltip-requirement {
    font-size: 12px;
    color: var(--color-text-secondary);
    margin: 0 0 8px;
  }
  .web-tooltip-requirement.unmet {
    color: var(--color-danger);
    font-weight: 600;
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
