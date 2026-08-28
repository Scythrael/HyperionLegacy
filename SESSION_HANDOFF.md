# Session Handoff — The First Cause (fleet-admiral)

_Last updated: 2026-08-27. Read this, then CLAUDE.md, SUGGESTIONS.md, and any \*\_LOCKED / \*\_STATUS docs before working._

## Where things stand RIGHT NOW

- **Branch:** `feat/combat-0.13.0`. **Staging tip = `d23e174`** (pushed to `origin/staging` = devpreview). **PROD (`origin/main`) UNTOUCHED at `e282614`** (v30, 0.12.1).
- **SAVE_VERSION = 39.** Migrations `MIGRATIONS[37]`/`[38]` are on staging but NOT yet on prod, so still editable until the promotion. Once promoted, they freeze.
- **Gates green at the tip:** `npm run check` = 0 errors (2 pre-existing RadialWeb a11y warnings, unrelated), `npx vitest run -t "parit"` = 101, `npx vitest run` = 1872 passed / 72 files.

## What shipped to staging this session (the combat-defense epic)

1. **Hybrid combat-defense model** (commit `d5c47fb`): HULL is additive (`innateHullArmor + plating`, `SI_PLATING_HP=100`; an unplated ship keeps a nonzero bare frame, never 0). SHIELD + RECHARGE are multiplicative "Effectiveness %" (`installed x authored/REF`, `REF_SHIELD_CAPACITY=300`, `REF_SHIELD_RECHARGE=6`; no emitter = 0). Byte-identical for Standard-Issue ships (parity 101). Killed the old x3-x5 runaway shield compounding. Crafted first-tier still beats SI (plating ~109, cap 311, recharge 7).
2. **Offense gate** (commit `e66175e`): a capReached (60s) timeout can only be won by a team that actually reduced the other's hull. Weaponless ships can no longer false-win by out-tanking (sim + Threat Assessment both honest); closed a patrol-farm exploit.
3. **Renamable ships** (`df406e9`): click-to-edit name in the ShipSystemsPanel header; `renameShip` in tick.ts; `handleRenameShip` in App.svelte; additive `name?` field, no migration.
4. **Review + fix-pass** (commit `4e607d9`): 3-lens holistic review found NO blockers. Added a roster-wide SI byte-identity guard test + pre-freeze comment corrections.
5. **Tooltip opacity fix** (commit `3cf9c9e`): the recurring mobile "tooltip overlap" was root-caused (the threat tooltip used the 32%-opaque `--color-panel-bg`, so card content bled through; NOT position/z-index). Fixed with an opaque surface (same idiom as `.currency-tooltip`). Full opaque-tooltip-token standardization deferred to the 0.13.1 tooltip redesign (logged).

## QA status

- **User's on-device DELTA QA pass = PASSED (2026-08-27).** Only the two changed areas since the prior 100% run (offense gate + shield Effectiveness-% swap) needed re-checking; both confirmed good on-device. Delta checklist: https://claude.ai/code/artifact/00649e52-f05c-4762-a52e-14b3b699658b (full sheet, mostly redundant now: https://claude.ai/code/artifact/386d9489-faef-4271-98a9-2b9b656e3f19).
- Logic was PRE-VERIFIED by tests + the 3-lens review; the on-device pass confirmed the visual/interaction side.

## Remaining before prod promotion

- **Fable bug-check pass + Opus fix session: BOTH DONE (2026-08-27).** The Fable pass (`docs/plans/2026-08-27-fable-bugcheck-plan-of-attack.md`) found 1 blocker + 5 MAJORs + a ~15-item P2 ledger; the Opus session then fixed the ENTIRE ledger. 31 commits on staging (`b479c38` T1 through `d23e174`), each one-fix-one-commit and gated (check 0, parity EXACTLY 101, suite grew 1834 -> 1872), whole session "--"-clean.
  - **T1 BLOCKER FIXED (`b479c38`):** every patrol carry-state + forecast surface now folds installed gear via one shared helper `foldedPlayerDefense` (which calls `shipToCombatant`, the exact sim fold). Crafted plating/emitters finally work in patrols. SI byte-identical, so parity held.
  - **All 5 MAJORs fixed:** Delete-Save crash (`3eb8d0e`), Escape ownership via capture-phase (`0224325`), negative hull display clamp (`ed70732`), localStorage hardening via a shared `safeStorage` wrapper (`772fe8a`), last-ship salvage softlock guard (`38679fa`).
  - **All P2 items fixed** (tick.ts economy/hygiene x10, combat-sim rounding + mid-turn liveness, display/UI x8) EXCEPT the reactor gate (below). The 0.16.0 crafted-float deferral was pulled FORWARD and resolved (`d9bbf3b` rounds the fold to integers, so the "507.4" decimal is gone).
  - **Design decisions actioned:** EquipmentTooltip `df53dd5` BLESSED (stale "unchanged" comments corrected, `cfffc13`; the file itself stays as the user left it); "4 guns" -> "4 hardpoints" (`9abf53f`); crafted-vs-SI mass asymmetry accepted for the debut, magnitude tuning deferred to 0.16.0 (SUGGESTIONS).
- **ONE open item: reactor-gate direction (P2-3), awaiting the user's call.** The recovery trace confirmed extending the patrol reactor-block to extraction WOULD open a narrow softlock corner (single hull + empty reactor slot + no spare + empty wallet, with extraction being the only income). Claude recommends **(A) keep it patrol-only** (soften the rationale comment, zero behavior change, zero softlock risk); alternative **(B) extend + add an always-available "restore Standard-Issue reactor" action**. NOT built; A changes no behavior, so the promotion is not blocked on it.
- **Next:** user runs the on-device crafted-gear DELTA QA on staging (patrol combat WITH crafted defensive gear installed, the exact thing T1 fixed and which the earlier QA could not have caught), gives the reactor A/B call, then the **explicit go**, then ONE prod promotion (v30 -> v39). Nothing touches `main` until then.

## Known deferrals (already logged in SUGGESTIONS.md, do NOT re-litigate)

- **0.16.0** — offense-gate healing mask: end-vs-start damage proxy is masked by support-drone healing, so a weaponless support build may DRAW a timeout it should lose (never WINS; within envelope). Fix = a per-team damage-application latch.
- **0.16.0** — crafted shield stats are floats (e.g. 5.83/s); harmless + deterministic + parity-safe, but shows a decimal in the panel. Fix = round the crafted shield cap/recharge at the bridge fold.
- **0.13.1** — 4 UI-label reads in App.svelte use bare `blueprintKey === null` for DISPLAY (dev-only, non-destructive mislabel). Align to `isStandardIssueBaseline`.
- Full 0.13.1 QoL bundle + tooltip system, and the larger roadmap (0.14.0 online + flag ledger + analytics/mod panels; 0.14.1 narrative/tutorial engine; skinning deferred), are in SUGGESTIONS.md.

## Load-bearing invariants (do NOT break)

- Parity (offline == live) must stay EXACTLY 101; do not put "parit" in an `it()` title.
- The game must NEVER silently delete a player's item. Every destroy site is pooling or gated by `isStandardIssueBaseline` (`blueprintKey === null && rarity === "standard"`).
- Hull always has a bare frame (additive); only shields go to 0 without gear.
- Peace override: push back (unprompted) on anything that could lose player peace; risk is fine only when opt-in, recoverable, and never a softlock.
- No em dashes and no "--" in prose/code/docs (colons/periods/commas/parens). Say INSTALL/UNINSTALL, never fit/fitment.
- EquipmentTooltip.svelte is preserve-unchanged. model.ts must not import combat internals at runtime.
