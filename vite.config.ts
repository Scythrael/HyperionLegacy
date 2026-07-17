import { defineConfig } from 'vite'
import { svelte } from '@sveltejs/vite-plugin-svelte'
import { resolveBuildId } from './src/lib/buildId.ts'

// Resolved ONCE at config eval so the same id backs BOTH the client-side define
// (__BUILD_ID__, captured at load) and the emitted version.json (the deployed
// build's id the client fetches to compare). Single source of truth = no drift.
const BUILD_ID = resolveBuildId(process.env.VERCEL_GIT_COMMIT_SHA)

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    svelte(),
    {
      // Emits dist/version.json = {"buildId":"<BUILD_ID>"} at build time so the
      // running client can fetch the DEPLOYED build's id and compare it to the one
      // it booted with. Build-only (no-op in dev); single source of truth = BUILD_ID.
      name: 'emit-version-json',
      generateBundle() {
        this.emitFile({
          type: 'asset',
          fileName: 'version.json',
          source: JSON.stringify({ buildId: BUILD_ID }),
        })
      },
    },
  ],
  define: {
    // Vercel sets VERCEL_ENV to 'production' | 'preview' | 'development' on EVERY
    // build automatically (no dashboard config needed). We inline it here as a
    // build-time boolean so the dev panel (App.svelte's DEV_MODE) auto-enables on
    // Preview deployments and is HARD-OFF on the Production build -- regardless of
    // which URL serves that build. Undefined off-Vercel (local builds) => false,
    // so local dev falls back to VITE_DEV_MODE. See src/vite-env.d.ts.
    __IS_PREVIEW_BUILD__: JSON.stringify(process.env.VERCEL_ENV === 'preview'),
    // Per-build id captured by the running client at load; compared against the
    // fetched version.json to detect a fresh deploy. See src/lib/updateDetector.ts.
    __BUILD_ID__: JSON.stringify(BUILD_ID),
  },
})
