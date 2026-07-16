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
  });

  onDestroy(() => {
    window.removeEventListener("popstate", handlePopState);
  });
</script>

{#if view === "game"}
  <!-- No in-game "back" affordance: it overlapped the player portrait, and the
       browser back button / editing the URL still return to the landing page.
       navigate() lives on for Landing's Play button (passed as a prop below). -->
  <App />
{:else}
  <Landing {navigate} />
{/if}
