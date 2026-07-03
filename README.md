# Hyperion Legacy [prototype]

A browser-based incremental idle game where you're a fleet admiral. This
repo is the §10.5 minimal prototype: one closed-form generator stack, one
prestige tier, versioned saves, a dev-only debug panel. See
`fleet_admiral_master_design.md` and `fleet_admiral_technical_spec.md` in
`docs/projectdocs/` for the full design and architecture. ("Fleet Admiral"
was the working title during design; the project is now named Hyperion
Legacy — see design doc §8.E.10.)

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

Already set up: this repo lives at `github.com/Scythrael/HyperionLegacy` and
is connected to Vercel. Push to `main` → deploys to production. Push to any
other branch → deploys to its own preview URL, shareable with a playtester
(e.g. https://scythrael-hl-test-crystalis.vercel.app/).

`VITE_DEV_MODE=true` is scoped to **Preview only** in Project Settings →
Environment Variables (leave Production unset/false). This keeps the debug
panel out of the public production build while keeping it available on
every branch preview URL.

## Next steps (design doc §10.6)

Add one system at a time, playtesting after each:
1. Missions
2. Research
3. A second captain
4. Boss encounter prototype (design doc §5.1 — still an open question,
   needs an answer before it can be built)

See `SESSION_LOG.md`, `KNOWN_ISSUES.md`, and `CUT_FOR_SCOPE.md` — keep all
three updated as you go.
