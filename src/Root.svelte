<script lang="ts">
  // Root.svelte -- the app's top-level view router.
  //
  // For now the whole domain LEADS TO THE GAME. The game lives at its canonical
  // route /game/hl -- forward-compatible with the planned Crystalis Soft URL
  // structure:
  //   crystalisoft.com/          -> (future) the studio website  [separate CSWebsite project]
  //   crystalisoft.com/game      -> (future) the website's games hub  [CSWebsite project]
  //   crystalisoft.com/game/hl   -> Hyperion Legacy  [THIS project]
  //   crystalisoft.com/game/<x>  -> (future) other games
  // Serving "/" + "/game" from the CSWebsite project while /game/hl comes from
  // this one is a Vercel cross-project domain-rewrite set up LATER, once that
  // website actually exists. Until then, every non-game path here just redirects
  // to the game, so any entry point (root, /game, the legacy /play, a bookmark)
  // lands you in Hyperion Legacy.
  //
  // Landing.svelte (the marketing page built earlier) is PARKED -- kept in the
  // repo, no longer imported/bundled -- as a candidate basis for the future
  // CSWebsite studio landing, not deleted.
  //
  // Deep-linking / refresh on /game/hl is handled at the hosting layer by
  // vercel.json's SPA rewrite (serves index.html for any non-asset path so this
  // router can boot and resolve the route client-side).
  import { onMount, onDestroy } from "svelte";
  import App from "./App.svelte";

  const GAME_ROUTE = "/game/hl";

  // The game renders only on its canonical route (tolerating a trailing slash).
  function isGameRoute(pathname: string): boolean {
    return pathname === GAME_ROUTE || pathname === GAME_ROUTE + "/";
  }

  // Current route. Reassigning this re-renders the {#if} below.
  let path = window.location.pathname;

  // "Everything leads to the game" (interim). replaceState -- NOT pushState -- so
  // the redirect leaves no back-button trap between "/" and "/game/hl": hitting
  // Back from the game exits the site rather than bouncing through the redirect.
  function redirectToGameIfNeeded(): boolean {
    if (isGameRoute(path)) return false;
    history.replaceState({}, "", GAME_ROUTE);
    path = GAME_ROUTE;
    return true;
  }

  // Run SYNCHRONOUSLY at component init (before the first render) so a non-game
  // entry URL never flashes a blank frame -- the first paint is already the game.
  redirectToGameIfNeeded();

  // Browser Back/Forward changes the URL without calling our code, so resync
  // `path` from the live location -- and re-apply the redirect if it landed on a
  // non-game path (until the real website exists to own "/" and "/game").
  function handlePopState(): void {
    path = window.location.pathname;
    redirectToGameIfNeeded();
  }

  onMount(() => {
    window.addEventListener("popstate", handlePopState);
  });

  onDestroy(() => {
    window.removeEventListener("popstate", handlePopState);
  });
</script>

{#if isGameRoute(path)}
  <App />
{/if}
