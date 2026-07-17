# Update Detector ("New version available — Refresh") — Design

**Date:** 2026-07-17
**Feature:** Client-side detection of a fresh deploy + a dismissible "new version available" banner.
**Version:** ships as `0.10.1` (patch — QoL/infra, not equipment/combat). Staging → prod after fresh go-ahead.
**Save impact:** NONE. `SAVE_VERSION` untouched, no migration.

---

## 1. Why

`0.10.0` just went to production. When we deploy a fix, players sitting on an already-open
tab keep running the stale bundle until they happen to hard-reload. This feature makes the
running client *notice* a new deploy and *nudge* the player to refresh — so bug fixes (and the
"refresh to recover if you're stuck" safety net) actually reach live players promptly.

The feature only helps players who **already have it loaded**, so it's most valuable on prod as
early as possible — hence shipping it as a small `0.10.1` and promoting soon.

---

## 2. Detection mechanism

### 2.1 The build id (the trigger)

`APP_VERSION` is the wrong trigger: two `0.10.x` deploys share the same version string, so a
same-version bugfix push would go undetected. We need a value that is **unique per build**.

- Inject `__BUILD_ID__` at build time via a Vite `define` (mirrors the existing
  `__IS_PREVIEW_BUILD__` pattern in `vite.config.ts`).
- Value: `process.env.VERCEL_GIT_COMMIT_SHA` when present (Vercel sets it on every deploy),
  falling back to a build timestamp (`String(Date.now())`) for local/off-Vercel builds so the
  define is always a non-empty string.
- The running client captures this as its **booted build id** at module load.

**Accepted tradeoff:** a git-SHA id means a *rare* same-commit Vercel rebuild (redeploy with no
new commit) would not trigger a nag. Accepted because our flow is push-driven — every real deploy
is a new commit — and "nothing changed → no nag" is arguably correct. (If we ever want *every*
rebuild to trigger, append a timestamp to the id; not doing so now.)

### 2.2 The fetchable marker

The client can't read another build's `__BUILD_ID__` (it's baked into that build's JS). So the
build also emits a tiny **`version.json`** the client can fetch at runtime:

```json
{ "buildId": "<same value as __BUILD_ID__>" }
```

Written by a small inline Vite plugin (`generateBundle`/`writeBundle` hook) into the build output
root, so there is a single source of truth for the id (the define value) and no committed
placeholder file to drift.

### 2.3 ⚠️ Rewrite/caching seam (critical — do not skip)

`vercel.json` currently rewrites everything except `/assets/` to `index.html`:

```json
"source": "/((?!assets/).*)"
```

This pattern **matches `/version.json`** and would rewrite it to `index.html` — so
`fetch('/version.json')` returns HTML, `JSON.parse` throws, and detection is a silent no-op.

Fix, both parts required:
1. Exclude it from the rewrite: `"source": "/((?!assets/|version.json).*)"`.
2. Serve it uncached: a `headers` rule setting `Cache-Control: no-cache` (or `no-store`) on
   `/version.json`, so the CDN always revalidates.

Client also cache-busts the request: `fetch('/version.json?t=' + Date.now())`.

**This seam is verified on the staging build** (fetch `/version.json` from devpreview, confirm the
response is JSON with a `buildId`, not HTML) before we trust the feature.

---

## 3. Polling

A small module owns a Svelte store `updateAvailable` (boolean).

- On load: `bootBuildId = __BUILD_ID__`.
- Poll `GET /version.json?t=<now>` every **~3 min** while the tab is visible.
- **Also** poll immediately on tab-refocus (`document.visibilitychange` → visible, and window
  `focus`) — cheaply catches "left open overnight, deploy happened, came back".
- Compare fetched `buildId` to `bootBuildId`. Different (and both present) → `updateAvailable = true`.
- Fetch/parse errors (offline, transient) are swallowed and retried next cycle — no console spam,
  no false positive.
- Once `updateAvailable` is true we can stop polling (the answer won't change until reload).

**Pure, unit-tested core:** the compare (`isNewer(bootId, fetchedId)` → boolean) and the snooze
scheduling are pure functions with no DOM/network, tested directly. The `fetch`/`setInterval`
wiring is the thin untested shell.

---

## 4. The banner (UI)

Mounted in `Root.svelte` so it overlays **both** the landing page and the game. Subscribes to
`updateAvailable`. Visual → **mockup-gated**: a dark-theme mockup is approved before build.

Slim top strip: *"A new version of Hyperion Legacy is available."* Three actions:

- **Export Save** — reuses the **existing** export-save code path (the same one the in-game
  Export Save button uses; do not fork a second export). Downloads the save file. **Does NOT
  close the banner** — it's a "grab a backup before I reload" safety action.
- **Refresh** — `location.reload()`.
- **Dismiss (×)** — **snooze, not kill.** Hides the banner and re-shows it after
  `SNOOZE_MS` (~3 hours) *if still on the old build*. In-memory only (not persisted) — an actual
  reload clears everything naturally, and we deliberately don't want a dismiss to permanently
  silence future, different deploys.

Rationale for the three actions: reload is already data-safe (the game auto-saves), but an
explicit "export first" reduces player anxiety and gives a real backup; snooze respects players
who are mid-session without letting the nudge vanish forever.

---

## 5. Versioning / deploy

- `APP_VERSION` → `"0.10.1"`.
- One short line merged into the patch-note history (its own `0.10.1` entry above `0.10.0`).
- **No** `SAVE_VERSION` bump, **no** migration (no persisted-state shape change).
- Build + verify on `staging` (devpreview) → then request **fresh explicit confirmation** before
  the `main` fast-forward to production.

---

## 6. Testing

- **Unit:** `isNewer(bootId, fetchedId)` truth table (same → false; different → true; missing
  either → false/no-nag). Snooze scheduler (dismiss sets a re-show, re-show only fires if still
  mismatched).
- **Build/integration (manual on staging):** `version.json` is served as JSON (not HTML) and its
  `buildId` matches the deployed commit; banner appears after a subsequent staging deploy.
- `npm run check` (0 errors) + `npm test` green gate every task.

---

## 7. Out of scope (explicitly)

- No service worker / PWA. Deliberately avoided — a poll + banner is far simpler and sufficient.
- No forced/auto reload (user chose dismissible banner + manual refresh).
- No persistence of the snooze across reloads.

---

## 8. Next up (captured, NOT built here)

Immediately after this ships: **0.11.0 — equipment slots on ships + T1 gear crafting.** Ships
carry a baseline/"standard" gear grade built in; crafted **T1** gear is a *slight* active upgrade
over that baseline. First step toward equipment → ship systems/modules → Combat. Logged so it
survives; design happens in its own brainstorm when we get there.
