import { defineConfig } from 'vite'
import { svelte } from '@sveltejs/vite-plugin-svelte'

// https://vite.dev/config/
export default defineConfig({
  plugins: [svelte()],
  define: {
    // Vercel sets VERCEL_ENV to 'production' | 'preview' | 'development' on EVERY
    // build automatically (no dashboard config needed). We inline it here as a
    // build-time boolean so the dev panel (App.svelte's DEV_MODE) auto-enables on
    // Preview deployments and is HARD-OFF on the Production build -- regardless of
    // which URL serves that build. Undefined off-Vercel (local builds) => false,
    // so local dev falls back to VITE_DEV_MODE. See src/vite-env.d.ts.
    __IS_PREVIEW_BUILD__: JSON.stringify(process.env.VERCEL_ENV === 'preview'),
  },
})
