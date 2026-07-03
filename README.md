# Fleet Admiral [prototype]

A browser-based incremental idle game where you're a fleet admiral. This
repo is the §10.5 minimal prototype: one closed-form generator stack, one
prestige tier, versioned saves, a dev-only debug panel. See
`fleet_admiral_master_design.md` and `fleet_admiral_technical_spec.md` in
the parent design project for the full design and architecture.

## Run it locally

```bash
npm install
npm run dev
```

Opens at `http://localhost:5173`. Debug panel (gear icon, top right) is on
by default locally via `.env.local`.

## Test

```bash
npm run test
```

Runs the closed-form tick regression test — verifies that one big
offline-style jump produces the same result as many small ticks. This is
the property everything else (offline progression, speed multiplier)
depends on. Re-run this after touching anything in `src/lib/game/`.

## Build

```bash
npm run build
```

Output goes to `dist/`.

## Project structure

```
src/
  App.svelte           game shell: tick loop, autosave, UI
  app.css              theme tokens (CSS custom properties)
  lib/
    Starfield.svelte   ambient background
    game/
      model.ts         data model, module/resource definitions
      tick.ts           closed-form tick function + prestige
      tick.test.ts      closed-form regression test
      save.ts           versioned save/load, migration stub
      format.ts         the one number-formatting function
```

## Deploying to Vercel

1. Push this repo to GitHub (see steps below if you haven't yet).
2. Go to vercel.com, sign in with GitHub, "Add New Project", select this repo.
3. Vercel auto-detects Vite. Accept defaults.
4. In Project Settings → Environment Variables, add `VITE_DEV_MODE=true`
   scoped to **Preview only** (leave Production unset/false). This keeps
   the debug panel out of your public production build while keeping it
   available on every branch preview URL.
5. Push to `main` → deploys to production. Push to any other branch →
   deploys to its own preview URL, shareable with a playtester.

## Pushing to GitHub for the first time

```bash
git init
git add .
git commit -m "Fleet Admiral prototype: closed-form generator stack, tier 1 prestige, versioned saves"
git branch -M main
git remote add origin <your-empty-github-repo-url>
git push -u origin main
```

## Next steps (design doc §10.6)

Add one system at a time, playtesting after each:
1. Missions
2. Research
3. A second captain
4. Boss encounter prototype (design doc §5.1 — still an open question,
   needs an answer before it can be built)

See `SESSION_LOG.md`, `KNOWN_ISSUES.md`, and `CUT_FOR_SCOPE.md` — keep all
three updated as you go.
