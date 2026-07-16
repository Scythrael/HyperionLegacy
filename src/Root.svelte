<script lang="ts">
  // Root.svelte -- the app's top-level view router.
  //
  // Lightweight client-side path routing WITHOUT pulling in a router framework:
  //   /play (or /play/) -> the game (App.svelte)
  //   anything else      -> the public Landing page (Landing.svelte)
  //
  // "Routing" here is a single reactive `path` string. navigate() pushes a
  // history entry and reassigns `path` (the reassignment is what drives Svelte
  // to swap the rendered view); a popstate listener resyncs `path` when the
  // user hits the browser Back/Forward buttons. Deep-linking / refresh on
  // /play is handled at the hosting layer by vercel.json's SPA rewrite, which
  // serves index.html for any non-asset path so this router can run.
  import { onMount, onDestroy } from "svelte";
  import App from "./App.svelte";
  import Landing from "./Landing.svelte";

  // Only the exact game route (tolerating a trailing slash) renders the game.
  // Everything else -- "/", unknown paths -- falls back to the landing page.
  function isGameRoute(pathname: string): boolean {
    return pathname === "/play" || pathname === "/play/";
  }

  // Current route. Reassigning this is what re-renders the {#if} below.
  let path = window.location.pathname;

  // SPA navigation helper handed to child views (e.g. Landing's Play button).
  // pushState updates the URL without a full reload; the `path` reassignment
  // then swaps the view. No-ops if already on the target route so we don't
  // stack duplicate history entries.
  function navigate(to: string): void {
    if (to === path) return;
    history.pushState({}, "", to);
    path = to;
  }

  // Browser Back/Forward changes the URL but does NOT call navigate(), so we
  // resync `path` from the live location whenever popstate fires.
  function handlePopState(): void {
    path = window.location.pathname;
  }

  onMount(() => {
    window.addEventListener("popstate", handlePopState);
  });

  onDestroy(() => {
    window.removeEventListener("popstate", handlePopState);
  });
</script>

{#if isGameRoute(path)}
  <!-- The game, exactly as before -- now reachable at /play. -->
  <App />

  <!-- Unobtrusive escape hatch back to the marketing site. Tiny, translucent,
       pinned to the top-left corner (over the decorative portrait frame, not an
       interactive control); brightens on hover. z-index sits below the game's
       modals (z-index:100) so it never covers a dialog. -->
  <button
    class="site-link"
    on:click={() => navigate("/")}
    title="Back to Hyperion Legacy site"
  >
    &larr; Site
  </button>
{:else}
  <Landing {navigate} />
{/if}

<style>
  .site-link {
    position: fixed;
    top: 6px;
    left: 6px;
    z-index: 90;
    padding: 3px 9px;
    font-family: var(--font-mono);
    font-size: 0.68rem;
    letter-spacing: 0.06em;
    color: var(--color-text-secondary);
    background: rgba(6, 10, 18, 0.72);
    border: 1px solid var(--color-border);
    cursor: pointer;
    opacity: 0.55;
    transition:
      opacity 0.12s ease,
      color 0.12s ease,
      border-color 0.12s ease;
  }
  .site-link:hover {
    opacity: 1;
    color: var(--color-accent);
    border-color: var(--color-border-strong);
  }
</style>
