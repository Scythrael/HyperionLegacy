# Session Handoff — Hyperion Legacy (fleet-admiral)

**Written:** 2026-07-17, end of a long session. Purpose: let the next session resume with zero context loss. Read this FIRST, then the memory files and the docs it points to.

---

## 0. TL;DR (read this, then the sections you need)

- **Production (crystalisoft.com) is at 0.10.1.** **Staging (devpreview.crystalisoft.com) is at 0.10.2**, already vetted and green, **NOT yet promoted to prod**. Promoting is a trivial fast-forward (see Section 3).
- This session shipped: the **update-detector** (0.10.1), a full **em-dash / "--" to real-punctuation** cleanup, and the **0.10.2 minor patch** (theme completeness, orphaned-CSS cleanup, modal a11y, corrupt-save recovery).
- **Next big feature is 0.11.0: ship equipment slots + T1 gear crafting.** Not started. See Section 5.
- The user hates losing context across sessions. The memory files + this doc are the safety net. Trust them.

---

## 1. How this project is run (the workflow the user ALWAYS wants)

See memory `feedback_fleet_admiral_workflow` for the authoritative version. In short, for every feature:

1. **Brainstorm** (superpowers:brainstorming) then a **design doc** then a **plan doc** (superpowers:writing-plans) in `docs/plans/`, then a **branch**, then **subagent-driven-development**: one implementer subagent per task, then a spec-compliance reviewer, then a code-quality reviewer. Even small tasks.
2. **Independently verify subagent claims** before trusting them, especially high-risk seams (parity, data safety). The controller (you) re-reads the critical code and re-runs gates. The user values this and has seen it catch real bugs.
3. After all tasks: a **holistic review** of the whole branch, then merge to **staging**, gate-green, push.
4. **Production is NOT frozen.** Ship vetted work to `origin/staging` (devpreview) freely. Promote to `origin/main` (prod, public) ONLY with fresh explicit user confirmation each time. Keep `main` a clean fast-forward ancestor of `staging` (never commit directly to main).
5. **Branch before building, always.** Gate every task with `npm run check` (expect "COMPLETED ... 0 ERRORS") and `npm test`.
6. Genuine design ambiguity: ask the user (AskUserQuestion), do not let a subagent guess.
7. Deferred ideas go to `SUGGESTIONS.md`, not into current scope.

**Reviewer prompts must say "static review only, no WebSearch/WebFetch, keep it fast and bounded"** (a review once hung 18 minutes on a network call).

---

## 2. Environment and hard conventions (do not rediscover these)

- **Node is NOT on the default PATH.** Before EVERY npm/npx command: `export PATH="/c/Program Files/nodejs:$PATH"` in the SAME Bash line. Scripts: `npm run check` (svelte-check + tsc), `npm test` (vitest, currently **688 passing, 27 files**), `npm run build`.
- **Windows + Git Bash.** Git shows LF/CRLF autocrlf warnings on commit; harmless.
- **NO EM DASHES and NO "--" as punctuation. Anywhere.** Rendered game text, code strings, code comments, docs, commit messages, and chat replies. Use colons, periods, commas, parentheses. The user rejected "--" as a substitute explicitly (it took three passes to get this right). The ONLY legitimate "--" is CSS custom properties (`var(--color-x)`, `--wh-rc:`), which are required syntax and are never surrounded by spaces. See memory `feedback_no_em_dashes`. All of `src/` was swept to punctuation on 2026-07-17; markdown docs still contain some (sweep on request).
- **Deploy topology:** `origin/main` = production = crystalisoft.com (public). `origin/staging` = devpreview.crystalisoft.com. Vercel auto-builds both. `VERCEL_ENV` and `VERCEL_GIT_COMMIT_SHA` are available at build time.
- **devpreview is behind Vercel authentication.** An automated browser cannot fetch it (it redirects to a Vercel login). Live verification of staging must be done by the USER in their logged-in browser, or after promoting to prod (prod is public). Note in memory `reference_browser_preview_rooted_primary_dir`: local `preview_start` reads launch.json from the OTHER project dir (RPG-Idle-Game), so it is unreliable for fleet-admiral; verify live via staging/prod instead.
- **The user tests on mobile (Brave) and PC (Brave).** Brave disables `backdrop-filter` (frosted glass), so never rely on blur for legibility; use opaque or near-opaque backgrounds.

---

## 3. Exact state of the repo right now

- Current branch: `staging`. `main` and `staging` diverge: **staging is ahead by the 0.10.2 commits; main (prod) is at 0.10.1.** `main` is a clean ancestor of `staging`.
- Latest staging commit: `879352c` (chore: bump to 0.10.2 + patch note).
- **To promote 0.10.2 to production** (only after the user says go):
  ```
  export PATH="/c/Program Files/nodejs:$PATH"
  git checkout main
  git merge --ff-only staging
  npm run check   # expect 0 ERRORS
  git push origin main
  git checkout staging
  ```
  Then confirm `git rev-list --count main..staging` is 0 (main == staging).
- `SAVE_VERSION` is **25** (`save.ts`). No migration was added this session (nothing changed the save shape). `APP_VERSION` is **"0.10.2"** (`src/lib/patchNotes.ts`).

---

## 4. What this session built (so you know what exists)

### 4a. Update-detector (shipped to prod as 0.10.1)
- **How it works:** `vite.config.ts` injects a unique `__BUILD_ID__` (`VERCEL_GIT_COMMIT_SHA` or a timestamp fallback, resolved in `src/lib/buildId.ts`) and an inline plugin emits `dist/version.json = {"buildId": ...}`. `vercel.json` excludes `/version.json` from the SPA rewrite and serves it `no-cache`. `src/lib/updateDetector.ts` polls `version.json` every ~3 min (plus on tab refocus), compares to the booted `__BUILD_ID__`, and flips a `writable` store `updateAvailable`. `src/UpdateBanner.svelte` shows a banner (Export save / Refresh / Dismiss-snooze-3h) when true.
- **CRITICAL mental model for testing the banner:** a tab renders the banner using the code IT is running, not the deployed code. To see banner CHANGES, the tab must be running the build that HAS them, then detect a newer build. So: reload both tabs to load the new build, then push one more build to trigger.
- **The banner PUSHES the app down, it does not overlay.** The hard `100vh/100dvh` viewport height was relocated from `App.svelte`'s `.root` up to a new `.app-shell` flex column in `Root.svelte`; the banner is a flex-shrink:0 child and App's `.root` fills the rest via `flex:1; min-height:0`. This preserves the LOCKED scroll-containment invariant (see `docs/plans/2026-07-07-scroll-containment-locked-placeholders-design.md`).
- Design/plan: `docs/plans/2026-07-17-update-detector-design.md` (§8 has the 0.11.0 seed), `...-plan.md`.

### 4b. Em-dash cleanup (on prod via 0.10.1's follow-up commits, and 0.10.2)
- All `src/` em dashes and "--" punctuation converted to real punctuation. Patch notes hand-rewritten. See Section 2.

### 4c. 0.10.2 patch (on staging, pending prod)
- **P1 theme completeness:** `--color-starfield` token per theme in `app.css` (subtle mostly-white tint of each theme hue; default `#bfe9f5`). `Starfield.svelte` uses it. `.log-entry` uses `--color-text-secondary`. **IMPORTANT user directive:** this tint is DEFAULT-starfield-only; the FUTURE selectable background styles (sub-light streak, warp jump) keep their OWN fixed proper colors and must NOT theme-shift. Documented in both files.
- **P2 orphaned CSS cleanup:** deleted 18 svelte-check-confirmed dead rules in `App.svelte`. Unused-selector warnings went from 18 to 0. (2 warnings remain: pre-existing RadialWeb pointer-handler a11y notes.)
- **P3 modal a11y:** new `src/lib/focusTrap.ts` shared Svelte action (focus-in on open, Tab/Shift+Tab trap, Escape calls the component's close handler, focus restore on destroy). Applied to all 8 `.modal-backdrop` modals with `role="dialog"`, `aria-modal`, `aria-label`.
- **P4 corrupt-save recovery:** `hasRawSave()` in `save.ts` distinguishes "no save" from "corrupt save". On corrupt, `App.svelte` sets `suppressSave = true` (so no autosave overwrites the corrupt raw), shows a recovery modal (raw text in a readonly textarea, Download backup, Start fresh game). `startFreshFromCorrupt()` is the only path that clears `suppressSave`. The recovery modal's Escape is a deliberate no-op (nothing safe to return to).
- Plan: `docs/plans/2026-07-17-patch-0.10.2-plan.md`.

---

## 5. NEXT: 0.11.0 — ship equipment slots + T1 gear (NOT STARTED)

The agreed next feature. User's framing (2026-07-17):
- Ships have **equipment slots**. Each ship ships with a built-in **baseline ("standard") gear grade** already fitted, so a bare ship is functional.
- Crafted **T1 gear** is a **slight** active upgrade over that baseline (deliberately small; the ladder climbs from there).
- Craft at least T1 items to fit those slots. This is the first step of the arc: **equipment then ship systems/modules then Combat.**
- Prereqs already built: the research then fabricate then shipyard pipeline, the material-allocation model, `ShipInstance` in the fleet, and inert `moduleSlots`/`equipmentSlots` on `SHIP_TYPES` (forward hooks, see `docs/plans/2026-07-09-ships-stats-foundation-design.md`).
- Do a fresh **brainstorm then design then plan** for it. Bump `APP_VERSION` to `"0.11.0"` when it starts. Seed is also in `SUGGESTIONS.md` (top entry) and `docs/plans/2026-07-17-update-detector-design.md` §8.

---

## 6. Open follow-ups and small items (not urgent, logged so they are not lost)

- **Pre-existing:** `loadFromLocalStorage` calls `migrate(save)` outside any try/catch, so a valid-but-unmigratable save would throw out of `onMount` rather than reach the new corrupt-save recovery modal. Hardening it (wrap migrate, route failures to the recovery modal) is a good small follow-up.
- **0.10.2 candidates NOT built** (from the SUGGESTIONS/KNOWN_ISSUES review): the tick-bar poll drops mission extraction cycles (and their loot) when the tab is backgrounded (real bug, needs a careful closed-form-parity pass, NOT a quick patch); locked sub-tabs are not keyboard-discoverable (native `disabled` removes them from tab order); the two bottom-nav "Fleet ..." labels are hard to tell apart (copy/visual tweak, wait for feedback).
- **Stale SUGGESTIONS entries to clean up:** "Full-width panels" (already shipped, `.frame` is width:100% no max-width), the old Home Planet material-display (superseded by the Warehouse), "unify all consumers on free" (resolved in Shipyard S2). Housekeeping only.
- **Markdown docs** still contain em dashes (design docs, SUGGESTIONS.md, KNOWN_ISSUES.md). Offered to sweep, not done. `src/` is clean.
- **2 pre-existing RadialWeb a11y warnings** (pointer handlers, lines 792/952) are known and left; they are the only `npm run check` warnings.

---

## 7. Where things live (orientation)

- **Engine:** `src/lib/game/tick.ts` (closed-form timed-process engine + offline `tick()`; live loop in `App.svelte` mirrors it, the two-path divergence risk is logged in KNOWN_ISSUES). `src/lib/game/model.ts` (all data: MISSIONS, SHIP_TYPES, FACILITIES, BLUEPRINTS, REFINE_RECIPES, ITEMS). `src/lib/game/save.ts` (SAVE_VERSION, migrations, load/save, corrupt handling). `src/lib/game/allocation.ts` (material free/allocated model).
- **UI:** `src/App.svelte` (the game, huge; legacy Svelte `$:` reactivity, NOT runes). `src/Root.svelte` (router + `.app-shell` + banner mount). `src/Landing.svelte`. `src/lib/` components (Panel, Starfield, RadialWeb, SubTabs, TreeSelector, UpdateBanner, focusTrap).
- **Version/notes:** `src/lib/patchNotes.ts` (`APP_VERSION` + `PATCH_NOTES`, read by both the in-game tab and the Landing page; no markdown processor, so the string is exactly what renders).
- **Docs:** `docs/plans/*` (design + plan docs per feature). `KNOWN_ISSUES.md` (actual bugs/gaps, many "deliberately deferred / not a bug"). `SUGGESTIONS.md` (future ideas). `SESSION_LOG.md` (session history).
- **Memory (auto-loads each session):** `MEMORY.md` index plus `feedback_fleet_admiral_workflow`, `project_fleet_admiral`, `feedback_no_em_dashes`, `feedback_visual_ui_needs_mockup`, `reference_browser_preview_rooted_primary_dir`, `project_fuel_runway_measured_locked`, `user_context`.

---

## 8. Working style the user likes (from this session)

- Momentum. The user says "continue", "go", "hit it" and wants you to proceed, not stall. But still gate, verify, and confirm before anything outward-facing (prod pushes).
- Visual/spatial UI is MOCKUP-GATED: show a mockup before building layouts (memory `feedback_visual_ui_needs_mockup`). The inline visualize widget did NOT render for the user this session; send an HTML file via SendUserFile (display: render) instead, or publish an Artifact.
- Push back with truth when warranted (Intellectual Sparring Partner), and explain tradeoffs, per `CLAUDE.md`.
- The user controls when to start a new conversation. Do not lose their context; that is what this doc is for.
