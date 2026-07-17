// Build-time constant injected by vite.config.ts's `define`, derived from
// Vercel's VERCEL_ENV. true ONLY on Vercel Preview deployments; false on the
// Production build and on any local/non-Vercel build. Gates the dev panel
// (see App.svelte's DEV_MODE) so preview builds get dev tools automatically
// while production ships none. Declared here so it type-checks app-wide.
declare const __IS_PREVIEW_BUILD__: boolean;

// Build-time constant injected by vite.config.ts's `define`, derived from
// Vercel's VERCEL_GIT_COMMIT_SHA (or a timestamp fallback off-Vercel). The
// running client captures this at load and compares it against the fetched
// version.json to detect a fresh deploy. See src/lib/buildId.ts.
declare const __BUILD_ID__: string;
