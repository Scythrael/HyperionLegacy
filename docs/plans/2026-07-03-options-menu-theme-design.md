# Options Menu — Theme Switcher + Delete Save — Design

*Approved 2026-07-03.*

## Purpose

Add a player-facing options menu with two capabilities requested after the
panel-chamfer redesign: switching the app's accent color between 6 fixed
theme presets, and an in-game "delete save" option (previously only
available as a dev-only, unconfirmed button).

## Scope

- New, always-visible gear icon (⚙) in the header, distinct from the
  existing dev-only debug toggle (which gets relabeled from "⚙" to plain
  text "Dev" so the two don't compete for the same icon/affordance).
- 6 theme presets: cyan (current/default), green, blue, red, white, gray.
  Only "primary"/accent colors change — semantic colors (`--color-warning`,
  `--color-danger`, `--color-success`) and backgrounds stay constant across
  themes, matching what the user actually asked for.
- Theme choice persists in a separate localStorage key
  (`fleet_admiral_theme`), independent of the save file — it's a display
  preference, not game state, and should survive a "delete save."
- Delete-save gets a typed confirmation ("type DELETE") before it fires —
  a real modal, the first one in this codebase.

## The Hardcoded-Color Problem (must fix as part of this feature)

`App.svelte`'s own `<style>` block has several accent-tinted
backgrounds/borders written as literal `rgba(103, 232, 249, X)` values
(`.stat-pill`, `.icon-btn`, `.resource-card`, `.module-card`, `.buy-btn`)
rather than referencing the `--color-accent` custom property. Swapping
`--color-accent`'s value alone would not repaint these — they'd stay cyan
regardless of the selected theme, producing a visibly broken/inconsistent
result.

**Decision:** add `--color-accent-rgb: 103, 232, 249;` to `app.css`
(a comma-separated RGB triplet, not a hex value), and rewrite every
hardcoded `rgba(103, 232, 249, X)` spot to `rgba(var(--color-accent-rgb), X)`.
CSS's `rgba()` function accepts a custom property standing in for the full
R,G,B triplet — this is standard, well-supported syntax. Once done, every
themed color repaints correctly from a single source of truth, in native
CSS, no JavaScript re-render required beyond setting one `data-theme`
attribute.

## Theme Mechanism

Six theme blocks added to `app.css`, each scoped under
`[data-theme="..."]` and overriding exactly 5 tokens: `--color-accent`,
`--color-accent-bright`, `--color-accent-rgb`, `--color-border`,
`--color-border-strong`. Example shape:

```css
[data-theme="green"] {
  --color-accent: #67f9a8;
  --color-accent-bright: #a0ffce;
  --color-accent-rgb: 103, 249, 168;
  --color-border: rgba(103, 249, 168, 0.18);
  --color-border-strong: rgba(103, 249, 168, 0.4);
}
```

Switching themes at runtime is one line:
`document.documentElement.dataset.theme = themeName;` — the browser's
native CSS cascade handles repainting everything, no manual DOM
traversal or component re-render needed.

Exact hex values for green/blue/red/white/gray are a reasoned starting
point (matching cyan's existing brightness/saturation "feel," just
hue-shifted) and may need visual tuning once viewable in a browser — same
caveat as prior features built this session.

## Persistence

A small set of functions (added to `src/lib/game/save.ts`, since that's
where localStorage access already lives, or a new small `theme.ts` if
that reads cleaner during implementation):

- `loadTheme(): string` — reads `fleet_admiral_theme` from localStorage,
  validates it against the 6 known theme names, returns `"cyan"` if
  missing or invalid.
- `saveTheme(name: string): void` — writes it.

This validation logic is genuinely unit-testable (pure function, no DOM
dependency beyond `localStorage`, which Vitest can exercise) — unlike the
CSS/visual parts of this feature.

## Options Panel UI

Reuses the existing `Panel` component for visual consistency. Contents:
a row of 6 small swatch buttons (one per theme, highlighting the
currently-active one), and a "Delete Save" button. Toggled open/closed by
the new gear icon, same pattern as the existing `devPanelOpen` boolean for
the dev panel.

## Delete Confirmation Modal

First modal in this codebase. A fixed-position dark backdrop with a
centered `Panel`-styled dialog box:

- Heading: "This will permanently erase your progress. This can't be
  undone."
- A text input.
- A "Delete" button, disabled until the input's value exactly equals
  `"DELETE"` (case-sensitive).
- A "Cancel" button that closes the modal without doing anything.

Confirming calls the existing `resetSave()` function in `App.svelte`
(already used by the dev panel's "Reset save" button) and closes the
modal. No new save-clearing logic — this just adds a confirmed, player-
facing entry point to the same existing function.

## Testing

- `loadTheme()`/`saveTheme()` validation logic gets real unit tests
  (invalid/missing localStorage value falls back to `"cyan"`, valid names
  round-trip correctly) — same as this session's earlier data-model work.
- Everything else (the 6 theme color values, the modal's visual layout,
  the gear icon placement) is CSS/markup with no automated test story,
  verified by manual code review only, same limitation as the tick-bar
  and panel-chamfer features. **Node.js/npm remains unavailable in this
  environment** (confirmed again before writing this design) — no dev
  server, no build, no way to actually view this before it's pushed.

## Explicitly Out of Scope

- More than 6 theme presets, or user-customizable/arbitrary colors.
- Cloud-synced or multi-slot save data (theme and save remain single-slot,
  local-only, matching current architecture).
- Any change to what "delete save" actually does — it reuses the existing
  `resetSave()` function verbatim, only adding a confirmation gate in
  front of it.
