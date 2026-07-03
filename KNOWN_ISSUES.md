# Known Issues

Things known to be broken or missing, deliberately deferred. Ops §8.E.7:
write it down so you don't relitigate it later.

- No offline-cap or offline-efficiency reduction yet — offline time is
  applied at full rate regardless of duration. Fine for prototype; revisit
  before any real playtest longer than a day.
- Refinery/Fabricator are priced in ore, not their own tier's precursor
  resource. Decoupled parallel producers, not a real consumption chain yet.
  Matches "many parallel small stacks" model from tech spec §3, but worth
  a deliberate look once missions/research complicate the economy.
- No captains, crew, ships, sectors, or bosses. This is the §10.5 minimal
  prototype scope on purpose.
- Corrupt-save handling doesn't yet surface a raw-export option to the
  player (tech spec §6 requirement) — currently just fails to load silently
  and starts fresh.
- Switching the dev panel's speed presets mid-cycle causes the tick bar to
  visibly jump, since `barCycleStart` isn't reset when `speed` changes.
  Dev-only control gated behind `DEV_MODE_ENV`, never seen by a normal
  player, so preserving fractional progress across a speed change isn't
  worth the added complexity.
- The delete-save confirmation modal (the first modal in this codebase)
  doesn't trap focus or move it to the input on open, and Escape doesn't
  close it — only the Cancel/Delete buttons do. Doesn't create a safety
  risk (the typed-"DELETE" gate to the actual deletion is unaffected
  either way), but a keyboard user can currently Tab past the backdrop
  into page content behind it. Worth fixing once this modal pattern gets
  reused for anything else, so the fix lands once instead of per-modal.
- Theme switching only affects the "primary"/accent color tokens — it does
  not recolor `.log-entry` text (`#9fc4cc`, hardcoded, predates the theme
  feature) or the Starfield's dots (`#bfe9f5`, same). Intentional scope
  limit per the design doc, not a bug, but worth writing down so "theme
  switching looks incomplete" doesn't get rediscovered as a surprise.
