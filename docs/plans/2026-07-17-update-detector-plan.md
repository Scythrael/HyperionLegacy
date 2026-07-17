# Update Detector Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans / subagent-driven-development to implement this plan task-by-task.

**Goal:** A running client detects a fresh deploy and shows a dismissible "new version available" banner (Export Save / Refresh / snooze-Dismiss).

**Architecture:** Build injects a unique `__BUILD_ID__` and emits a fetchable `version.json`. A small poller module compares the booted id to the served id and flips a `writable` store; a banner component in `Root.svelte` reacts to it. No persisted-state change, no save migration.

**Tech Stack:** Vite `define` + inline emit plugin, Svelte 5 (legacy `$:`/stores), `svelte/store` `writable`, Vitest, `vercel.json` rewrites/headers.

**Design:** `docs/plans/2026-07-17-update-detector-design.md`

**Node:** every `npm`/`npx` needs `export PATH="/c/Program Files/nodejs:$PATH"` first. Gate each task with `npm run check` (expect "COMPLETED ... 0 ERRORS") + `npm test` (green).

**Branch:** `feat/update-detector` (off `staging`). Version target `0.10.1`.

---

### Task U1: Build id + `version.json` emit + vercel rewrite/cache fix

**Files:**
- Modify: `vite.config.ts`
- Modify: `src/vite-env.d.ts`
- Modify: `vercel.json`
- Test: `src/lib/buildId.test.ts` (pure helper)
- Create: `src/lib/buildId.ts` (pure helper, so the id rule is unit-testable)

**Step 1 — pure helper + failing test.**
Create `src/lib/buildId.ts`:
```ts
// buildId.ts -- pure resolution of the per-build id used by the update detector.
// Prefers Vercel's commit SHA (set on every deploy) so the id is meaningful;
// falls back to a timestamp for local/off-Vercel builds so it is NEVER empty
// (an empty id would make the client's "did the build change?" compare useless).
export function resolveBuildId(
  sha: string | undefined,
  now: number = Date.now(),
): string {
  return sha && sha.length > 0 ? sha : String(now);
}
```
`src/lib/buildId.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { resolveBuildId } from "./buildId";

describe("resolveBuildId", () => {
  it("uses the sha when present", () => {
    expect(resolveBuildId("abc123", 999)).toBe("abc123");
  });
  it("falls back to the timestamp when sha is undefined", () => {
    expect(resolveBuildId(undefined, 999)).toBe("999");
  });
  it("falls back to the timestamp when sha is empty", () => {
    expect(resolveBuildId("", 999)).toBe("999");
  });
});
```

**Step 2 — run test, expect fail (module/exports missing), then it passes once the file above exists.**
Run: `npm test -- buildId`

**Step 3 — wire the define + emit plugin in `vite.config.ts`.**
At top-level (config eval time) compute the id once and use it for BOTH the inlined
constant and the emitted file:
```ts
import { defineConfig } from 'vite'
import { svelte } from '@sveltejs/vite-plugin-svelte'
import { resolveBuildId } from './src/lib/buildId'

const BUILD_ID = resolveBuildId(process.env.VERCEL_GIT_COMMIT_SHA)

export default defineConfig({
  plugins: [
    svelte(),
    {
      // Emits dist/version.json = {"buildId": "<BUILD_ID>"} at build time so the
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
    __IS_PREVIEW_BUILD__: JSON.stringify(process.env.VERCEL_ENV === 'preview'),
    // Per-build id captured by the running client at load; compared against the
    // fetched version.json to detect a fresh deploy. See src/lib/updateDetector.ts.
    __BUILD_ID__: JSON.stringify(BUILD_ID),
  },
})
```

**Step 4 — declare the global in `src/vite-env.d.ts`.** Add next to `__IS_PREVIEW_BUILD__`:
```ts
declare const __BUILD_ID__: string;
```

**Step 5 — fix `vercel.json` (rewrite exclusion + no-cache header).**
```json
{
  "$schema": "https://openapi.vercel.sh/vercel.json",
  "rewrites": [
    {
      "source": "/((?!assets/|version.json).*)",
      "destination": "/index.html"
    }
  ],
  "headers": [
    {
      "source": "/version.json",
      "headers": [{ "key": "Cache-Control", "value": "no-cache" }]
    }
  ]
}
```
⚠️ The rewrite exclusion is load-bearing: without `|version.json` the SPA rewrite serves
`index.html` for `/version.json`, the client's `JSON.parse` throws, and detection silently dies.

**Step 6 — verify build emits it.**
Run: `npm run build` then confirm `dist/version.json` exists and contains a `buildId`
(`cat dist/version.json`). Run `npm run check` (0 errors) + `npm test` (green).

**Step 7 — commit.** `feat: inject per-build id + emit version.json (+ vercel rewrite/cache fix)`

---

### Task U2: Update-detector store + poller (pure core unit-tested)

**Files:**
- Create: `src/lib/updateDetector.ts`
- Test: `src/lib/updateDetector.test.ts`

**Step 1 — failing tests for the pure core.**
`src/lib/updateDetector.test.ts` covers:
- `isNewer(boot, fetched)`: equal → false; different (both non-empty) → true; empty/undefined
  `fetched` → false (never nag on a bad fetch); equal-empty → false.
- snooze scheduling with `vi.useFakeTimers()`: after `updateAvailable` is true, `dismissUpdate()`
  sets the store to false; advancing time by `SNOOZE_MS` re-sets it to true **only if** a
  "still on old build" predicate holds; advancing less than `SNOOZE_MS` does not.

**Step 2 — run, expect fail.** `npm test -- updateDetector`

**Step 3 — implement.**
```ts
// updateDetector.ts -- detects a fresh deploy while the tab is open and drives the
// "new version available" banner. Pure compare (isNewer) is unit-tested; the fetch +
// timers are the thin untested shell. No persisted state; a real reload resets it all.
import { writable } from "svelte/store";

export const updateAvailable = writable(false);

const POLL_MS = 3 * 60 * 1000;      // ~3 min while visible
const SNOOZE_MS = 3 * 60 * 60 * 1000; // re-nag after ~3h if still not updated

// True only when we have two real, differing ids. A missing/empty fetched id (offline,
// 404 in dev, HTML from a misconfigured rewrite) must NEVER nag.
export function isNewer(bootId: string, fetchedId: string | null | undefined): boolean {
  if (!fetchedId) return false;
  if (!bootId) return false;
  return fetchedId !== bootId;
}

async function fetchDeployedBuildId(): Promise<string | null> {
  try {
    const res = await fetch(`/version.json?t=${Date.now()}`, { cache: "no-store" });
    if (!res.ok) return null;
    const data = (await res.json()) as { buildId?: unknown };
    return typeof data.buildId === "string" ? data.buildId : null;
  } catch {
    return null; // offline/transient/parse -- swallow, retry next cycle
  }
}

let started = false;

// Call once on app mount. `bootId` defaults to the build's baked-in __BUILD_ID__.
export function startUpdatePolling(bootId: string = __BUILD_ID__): void {
  if (started) return;
  started = true;

  let dismissed = false;
  let stopped = false;

  async function check(): Promise<void> {
    if (stopped) return;
    const deployed = await fetchDeployedBuildId();
    if (isNewer(bootId, deployed)) {
      if (!dismissed) updateAvailable.set(true);
      // else: snoozed -- the snooze timer will re-raise it.
    }
  }

  // dismissUpdate is exposed to the banner via the module-level hook below.
  dismissHook = () => {
    dismissed = true;
    updateAvailable.set(false);
    setTimeout(() => {
      dismissed = false;
      void check(); // re-nag only if STILL a new build is out there
    }, SNOOZE_MS);
  };

  const interval = setInterval(() => void check(), POLL_MS);
  const onVisible = () => {
    if (document.visibilityState === "visible") void check();
  };
  document.addEventListener("visibilitychange", onVisible);
  window.addEventListener("focus", onVisible);

  void check(); // immediate first check

  // (No teardown needed: the poller lives for the page's lifetime; a reload clears it.)
  void interval;
}

let dismissHook: (() => void) | null = null;
export function dismissUpdate(): void {
  dismissHook?.();
}
```
Note for implementer: the snooze test drives `dismissUpdate()` + fake timers; to keep the pure
core testable without a real `__BUILD_ID__`/DOM, the tests may call `startUpdatePolling("boot")`
with a stubbed `globalThis.fetch` and stubbed `document`/`window` listeners (jsdom provides them),
OR — preferred — factor the snooze timing into a tiny pure helper the test calls directly. Keep
`isNewer` and the snooze re-raise logic covered; the `fetch`/listener plumbing may stay uncovered.

**Step 4 — run tests green.** `npm test -- updateDetector`
**Step 5 — `npm run check` (0 errors).**
**Step 6 — commit.** `feat: update-detector store + poller (version.json compare + snooze)`

---

### Task U3: Shared save-download helper (de-dupe export glue)

**Files:**
- Modify: `src/lib/game/save.ts` (add `downloadRawSave()`)
- Modify: `src/App.svelte` (`doExportSave` delegates to it)

**Step 1 — add the helper in `save.ts`** (next to `exportRawSave`):
```ts
// Browser-side convenience: export the raw save AND trigger a file download.
// Single source of truth for the download glue so both the in-game Export Save
// button and the update-banner's Export Save use identical behavior. Returns
// false if there is no save to export. DOM-dependent (no-op under SSR/tests).
export function downloadRawSave(): boolean {
  const raw = exportRawSave();
  if (!raw) return false;
  const blob = new Blob([raw], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `fleet-admiral-save-${Date.now()}.json`;
  a.click();
  URL.revokeObjectURL(url);
  return true;
}
```

**Step 2 — refactor `App.svelte`'s `doExportSave`** to delegate (import `downloadRawSave`,
replace the body with `downloadRawSave();`). Keep the function name/callsite unchanged.

**Step 3 — `npm run check` (0 errors) + `npm test` (green — nothing should regress).**
**Step 4 — commit.** `refactor: extract downloadRawSave shared helper`

---

### Task U4: Update banner component + mount (MOCKUP-GATED)

> **CONTROLLER GATE:** before dispatching this task, produce a dark-theme banner mockup
> (visualize) and get user approval. The implementer builds to the approved mockup.

**Files:**
- Create: `src/UpdateBanner.svelte`
- Modify: `src/Root.svelte` (mount banner + start polling)

**Step 1 — `src/UpdateBanner.svelte`.** Subscribes to `updateAvailable`; renders nothing when
false. Slim fixed-top strip, theme-aware (use existing CSS vars: `--color-panel-bg`,
`--color-accent`, `--color-text-primary/secondary`). Three actions:
- **Export Save** → `downloadRawSave()` (from `save.ts`). Does NOT change `updateAvailable`.
- **Refresh** → `location.reload()`.
- **Dismiss (×)** → `dismissUpdate()` (from `updateDetector.ts`).
Copy: "A new version of Hyperion Legacy is available." Match the approved mockup.

**Step 2 — mount in `Root.svelte`.** Import the component + `startUpdatePolling`; render
`<UpdateBanner />` above the `{#if view}` block so it overlays both views; call
`startUpdatePolling()` inside the existing `onMount`.

**Step 3 — `npm run check` (0 errors) + `npm test` (green).**
**Step 4 — manual smoke (dev):** load `/game/hl/play`; confirm no banner normally; temporarily
force `updateAvailable.set(true)` (or stub `isNewer`) to confirm the banner renders + each button
behaves (Export downloads + banner stays; Dismiss hides; Refresh reloads). Revert the stub.
**Step 5 — commit.** `feat: update-available banner + poller mount in Root`

---

### Task U5: Version bump `0.10.1` + patch note

**Files:**
- Modify: `src/lib/patchNotes.ts`

**Step 1 —** `APP_VERSION = "0.10.1"`. Add ABOVE the `0.10.0` entry:
```ts
{ version: "0.10.1", summary: "The game now notices when a new version has been deployed and shows a slim 'a new version is available' banner so you can refresh to get the latest fixes -- with a one-click Export Save right in the banner to grab a backup first. Dismiss it and it'll quietly remind you again later if you still haven't updated. (No forced reloads; your progress auto-saves either way.)" },
```
No `SAVE_VERSION` change, no migration.

**Step 2 — `npm run check` (0 errors) + `npm test` (green).**
**Step 3 — commit.** `chore: bump to 0.10.1 (update-detector) + patch note`

---

## After all tasks
- Final holistic review of the whole branch (integration seams: version.json served as JSON, banner
  mount, no save-shape change, export helper de-dupe).
- Merge `feat/update-detector` → `staging`, gate-green, push to `staging` (devpreview).
- **Verify on staging:** fetch `https://devpreview.crystalisoft.com/version.json` → JSON w/ buildId;
  after a subsequent staging deploy, confirm the banner appears.
- Then request **fresh explicit go-ahead** before fast-forwarding `main` → production.
