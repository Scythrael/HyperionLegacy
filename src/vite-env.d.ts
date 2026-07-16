// Build-time constant injected by vite.config.ts's `define`, derived from
// Vercel's VERCEL_ENV. true ONLY on Vercel Preview deployments; false on the
// Production build and on any local/non-Vercel build. Gates the dev panel
// (see App.svelte's DEV_MODE) so preview builds get dev tools automatically
// while production ships none. Declared here so it type-checks app-wide.
declare const __IS_PREVIEW_BUILD__: boolean;
