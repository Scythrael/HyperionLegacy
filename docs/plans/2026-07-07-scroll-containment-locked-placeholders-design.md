# Scroll Containment & Locked Placeholders — Design

## Context

Follow-up to the just-merged UI Redesign. The user shared a screenshot of the live site
(hyperion-legacy.vercel.app) with a hand-drawn mockup showing two things they want changed:

1. Today's whole-page scroll (the `.frame` div scrolls under the fixed `.top-bar`/`.nav-tabs`, using
   padding-clearance estimates like `calc(90px + env(safe-area-inset-top, 0px))`) should become a
   fixed-height app shell where the header, top bar, bottom nav, captain list, and sub-tabs all stay
   visually pinned — only the actual panel content scrolls, contained within its own box.
2. A "locked, grayed-out, 🔒 Coming Soon!" placeholder pattern, applied to: extra sub-tab slots
   beyond each tab's real set, captain-list slots beyond the current roster (up to a roadmap max of
   10, even though only 4 captains are unlockable via any mechanic that exists today), and a restyle
   of Sector Space/Battlespace's existing plain-text placeholders to match.

This is pure layout/UI work on top of already-working functionality — no new game mechanics, one
exception: the captain-list slot cap (5-10) reflects a genuine future roadmap intent (more Fleet
Logistics tiers planned later), not a functional feature being built now. Node.js/npm/tsc remain
unavailable in this environment — all verification during implementation is manual code tracing,
not live rendering.

## 1. App shell restructuring (scroll containment)

`.root` changes from `min-height: 100dvh` to `height: 100dvh` (a hard height) with
`display: flex; flex-direction: column; overflow: hidden`. The `FLEET ADMIRAL` header `Panel` and
`.top-bar` stay visually at the top; `.nav-tabs` stays at the bottom — all three drop
`position: fixed` and become normal flex children with `flex-shrink: 0`. A new `.tab-body` wrapper
(replacing today's flat `.main`) becomes `flex: 1; min-height: 0; display: flex;
flex-direction: column; overflow: hidden` and holds whichever tab is active.

Inside `.tab-body`, each tab's `<SubTabs>` row (where it has one) stays `flex-shrink: 0`; a new
`.tab-scroll-area` wrapper (`flex: 1; min-height: 0; overflow-y: auto`) holds the actual panel
content underneath it — the ONE scrollable region, for every tab, including tabs with no sub-tabs
(Sector Space, Battlespace) and the mission-list-only Fleet Operations tab. `.frame`'s fragile
padding-clearance estimates (`90px`/`96px` guesses) are removed entirely — flex sizing replaces them,
so there's no pixel-guessing left to verify on a live device for this specific concern (the
`.top-bar`/`.nav-tabs` short-viewport z-index collision risk already logged in `KNOWN_ISSUES.md`
still applies and isn't resolved by this change, since it's about total chrome height vs. viewport
height, not about scroll mechanics).

`Starfield` (the animated background) stays a fixed/absolute-positioned child of `.root`, unaffected
by this restructuring — it's decorative and already independent of document flow.

## 2. Locked placeholder pattern

A consistent, non-interactive visual state — grayed text (reusing `.skill-node.locked`/
`.module-card.locked`'s existing `opacity: 0.5` treatment), a 🔒 lock icon (plain Unicode, no new
icon-library dependency, matching this codebase's zero-dependency convention), and a "Coming Soon!"
label. Every locked element gets a `title` attribute (native hover tooltip) and a subtle `:hover` CSS
accent (border brightens slightly, same spirit as `.buy-btn:disabled { cursor: not-allowed; }`) so
hovering clearly registers, but no click/select action ever fires.

Applied to:

- **Extra locked sub-tabs.** `SubTabs.svelte`'s `tabs` prop items gain an optional `locked?: boolean`
  flag. Each of the 3 `<SubTabs>` call sites (Fleet Captain's, Homeworld, System) appends exactly 2
  `{ key: ..., label: "Coming Soon!", locked: true }` entries after its real tabs. A locked tab
  renders grayed/non-clickable (no `onSelect` call fires), with the hover tooltip/accent above.
- **Captain-list slots up to 10.** The captain list always renders 10 rows: real captains first (from
  `state.captains`, unchanged click-to-select behavior), then locked/grayed "🔒 Coming Soon!" slots
  for every remaining index up to 10. This is a genuine future-roadmap signal (more Fleet Logistics
  tiers planned later per the user), not a promise with nothing behind it — logged in
  `KNOWN_ISSUES.md` that slots 5-10 have no unlock mechanic in `HOMEWORLD_TALENTS` yet.
- **Sector Space / Battlespace restyle.** Their existing plain-text placeholders (`"Shipyard and
  Starbase are still under construction."` / `"PvP and PvE fleet operations will live here."`) gain
  a 🔒 "Coming Soon!" heading above the existing descriptive sentence, using the same visual language
  as the other two bullets — these are single full-tab placeholders, not sub-tabs or list slots, but
  should look consistent with them.

## Testing approach

No Node/npm/tsc/dev-server in this environment — every verification step during implementation is
manual code tracing (reading the template/CSS, hand-checking class bindings and flex math), not live
rendering. The `.top-bar` height estimate that `.frame`'s old padding needed is no longer relevant
after Part 1's restructuring (flex sizing replaces it), but the overall visual result — does the
scroll genuinely stay contained, do the locked slots look right, does hover feel right on a touch
device (no real `:hover` there) — needs a live-device/browser check once deployed, flagged the same
way every other CSS change has been in this environment.
