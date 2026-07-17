<script lang="ts">
  // Root.svelte -- top-level view router for the Crystalis Soft URL structure:
  //   crystalisoft.com/              -> (future) studio landing   [separate CSWebsite project]
  //   crystalisoft.com/game          -> (future) games hub        [CSWebsite project]
  //   /game/hl                       -> Hyperion Legacy's page (Landing.svelte -- hero, Play, news)
  //   /game/hl/play                  -> the playable game (App.svelte)
  //   /game/<other>[/play]           -> (future) other games, same shape
  //
  // For now the separate studio site doesn't exist, so "/" and "/game" (and any
  // unknown path) resolve to THIS game's landing (/game/hl); the legacy "/play"
  // resolves to the game. When the CSWebsite project is built it will own "/" and
  // "/game" via a Vercel cross-project domain rewrite, leaving /game/hl* to us.
  //
  // "Routing" is a single reactive `view` ("game" | "landing") derived from the
  // path. resolve() also yields the CANONICAL url so we can normalize/redirect
  // the address bar (replaceState -> no back-button trap). Deep-link/refresh on
  // any /game/hl* path is served index.html by vercel.json's SPA rewrite.
  import { onMount, onDestroy } from "svelte";
  import App from "./App.svelte";
  import Landing from "./Landing.svelte";
  import UpdateBanner from "./UpdateBanner.svelte";
  import { startUpdatePolling } from "./lib/updateDetector";

  const LANDING_ROUTE = "/game/hl";
  const GAME_ROUTE = "/game/hl/play";

  type View = "game" | "landing";

  // Map any pathname -> {what to render, its canonical url}. Trailing slashes tolerated.
  function resolve(pathname: string): { view: View; canonical: string } {
    const p = pathname.replace(/\/+$/, "") || "/";
    if (p === GAME_ROUTE || p === "/play") return { view: "game", canonical: GAME_ROUTE };
    // /game/hl, and (until the real studio site exists) "/", "/game", anything else.
    return { view: "landing", canonical: LANDING_ROUTE };
  }

  let path = window.location.pathname;
  let view: View = "landing";

  // Set the view for a path and normalize the address bar to its canonical url.
  function apply(pathname: string): void {
    const { view: v, canonical } = resolve(pathname);
    view = v;
    path = canonical;
    if (canonical !== pathname.replace(/\/+$/, "")) {
      history.replaceState({}, "", canonical);
    }
  }

  // Synchronous at init (before first render) so a non-canonical entry url never
  // flashes -- the first paint is already the resolved view.
  apply(path);

  // SPA navigation handed to child views (Landing's Play button; the game's back link).
  function navigate(to: string): void {
    if (resolve(to).canonical === path) return;
    history.pushState({}, "", to);
    apply(to);
  }

  // Browser Back/Forward changes the url without calling navigate() -- resync.
  function handlePopState(): void {
    apply(window.location.pathname);
  }

  onMount(() => {
    window.addEventListener("popstate", handlePopState);
    // Begin polling version.json for a newer deploy; flips the `updateAvailable`
    // store that UpdateBanner subscribes to. Idempotent -- safe to call once here.
    startUpdatePolling();
  });

  onDestroy(() => {
    window.removeEventListener("popstate", handlePopState);
  });
</script>

{#if view === "game"}
  <!-- The game runs inside a fixed-height shell so the update banner can take real
       layout space and push the app DOWN rather than overlay it (the banner covering
       the header was the problem). The banner renders nothing unless an update is
       available, so it has zero footprint until then. -->
  <div class="app-shell">
    <UpdateBanner />
    <!-- No in-game "back" affordance: it overlapped the player portrait, and the
         browser back button / editing the URL still return to the landing page.
         navigate() lives on for Landing's Play button (passed as a prop below). -->
    <App />
  </div>
{:else}
  <!-- On the landing page the banner is a normal-flow strip at the very top; the
       page scrolls beneath it as usual. -->
  <UpdateBanner />
  <Landing {navigate} />
{/if}

<style>
  /* The app's fixed-height shell -- relocated here from App.svelte's .root so the
     update banner can share the viewport and push the app down instead of overlaying
     it. 100vh is declared FIRST as the dvh fallback: a browser without dvh support
     drops the invalid 100dvh line and keeps 100vh; browsers WITH dvh support override
     with 100dvh. This fallback pair is load-bearing -- without it a dvh-unsupported
     browser would get no height and collapse the scroll-containment shell (a real
     regression caught before; see App.svelte's .root and the scroll-containment
     locked design doc). The banner is a flex-shrink:0 child; App.svelte's .root fills
     the remaining height via flex:1. overflow:hidden keeps the page from growing --
     the one scrollable region lives inside App (.tab-scroll-area). */
  .app-shell {
    height: 100vh;
    height: 100dvh;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }
</style>
