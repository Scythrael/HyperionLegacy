# Fable Bug-Check Pass: Findings + Plan of Attack

**Author:** Claude (Fable 5), 2026-08-27
**Scope:** full-codebase pre-promotion bug hunt at tip `8b38577` (branch `feat/combat-0.13.0`, SAVE_VERSION 39).
**Method:** five parallel subsystem reviews (combat engine, tick/economy, model/save/migrations, App.svelte + live loop, UI components + helpers), every MAJOR-or-worse claim then independently re-verified against the source by the coordinating session. Findings below are tagged **[verified]** (re-checked line-by-line in this session) or **[agent-reported]** (precise cite from the subsystem review, not independently re-read; each fix task re-verifies before touching code).
**Gates at tip, independently re-run this session:** `npm run check` 0 errors (2 known RadialWeb warnings), vitest 1834/1834, parity exactly 101.

## Verdict and promotion recommendation

The two highest-stakes areas for the v30 to v39 promotion are **clean**:

- **Migration chain 30 to 39: CLEAN.** Traced end to end against the current GameState shape; frozen migrations diffed against prod `e282614` and untouched; fresh-game shape matches post-migration shape; chain is deterministic and idempotent.
- **Live loop vs tick() drift: CLEAN.** Both paths route every per-tick effect through the same `economyTick`; only the three known intentional deltas exist (offline cap, 5s absence ignore, display-only gameTimeSeconds restore).

However, one **BLOCKER** was found (independently by two reviews, then verified): patrol carry-state ignores installed defensive gear, silently negating the headline "crafted gear drives the sim" feature of the 1.0 epic. **Recommendation: HOLD the promotion until P0 (and ideally the cheap P1 fixes) land**, then re-run gates plus a short on-device delta QA of patrol combat with crafted defensive gear installed. Everything else can ship in this window or immediately after at the user's discretion.

All fixes go on `feat/combat-0.13.0` (prod is untouched and will be replaced wholesale by this promotion; no hotfix branch needed unless the promotion is deliberately held for a long period, in which case the last-ship salvage guard (P1-T6) is the one pre-existing-in-prod item that would qualify for the hotfix workflow).

**Standing rules for the fix session:** one fix, one commit (Omega 15c). Re-run `npm run check` + full vitest + `npx vitest run -t "parit"` (must stay exactly 101) after every task. Parity means offline == live == replay agree; several fixes below deliberately change battle OUTCOMES, which is fine as long as all paths change together and SI byte-identity holds. No em dashes anywhere. Say INSTALL, never fit.

---

## P0: BLOCKER (fix before promotion)

### T1. Patrol carry-state and forecast seeds ignore installed defensive gear [verified]

**Defect:** the in-battle combatant is built from the installed-gear fold (`bridge.ts:681-697`: `hullMax = innateHullArmor + plating.hullStrength`, `shieldMax = emitterCap x effectiveness`), but every persistent carry surface uses the raw authored `SHIP_TYPES` stats:

- `tick.ts:3204-3205` (`freshPatrolMission`): seeds `playerHull: shipDef.hullIntegrity`, `playerShield: shipDef.shieldCapacity`. (The drone seed directly below it DOES use installed gear, which is the pattern these two lines should follow.)
- `tick.ts:1905-1909` (between-wave recovery): `regenPatrolShield(shipDef.shieldCapacity, ..., shipDef.shieldRecharge)`, both authored.
- `tick.ts:1892`: `limpDamage = shipDef.hullIntegrity - Math.max(0, mission.playerHull)`, which goes NEGATIVE for a crafted-plated ship that loses a timeout with hull above authored (a negative `repairDamage` follow-on).
- `combat/patrolReplay.ts:260, 426-427`: the display replay uses the same authored values (which is why parity holds: all paths are consistently wrong together).
- `combat/patrolWave.ts:162`: the `Math.min(shieldCapacity, ...)` clamp strips shield a crafted emitter legitimately recharged above authored cap.
- `App.svelte:2289-2290` (Threat Assessment forecast): `startHull`/`startShield` seeded from the same authored stats.
- `App.svelte:2277` (forecast, same fix surface): `defaultSystemDurabilityForHull(hullType, shipDef)` omits the `installedGear` third argument that the live seed (`tick.ts:3212`) and replay (`patrolReplay.ts:432`) both pass. A crafted quality-4/5 weapon (durabilityMax 180/200) is clamped to the hull-default 100 in every forecast sample, reads as Degraded (100/180 = 55% under the 60% threshold), and fires at 75% damage in the forecast while the real patrol fires at full. `bridge.ts:514-521` documents this exact bug as already audit-fixed on the live path; the forecast call site was missed.

**Player-visible failures:** crafted Radiant plating (up to ~377 hull vs SI 100) never exists at wave start; a crafted emitter (cap up to ~1090 vs SI 300) opens wave 1 at authored cap, and shield recharged above authored in-battle is clamped away on the first quiet route tick; crafted recharge is ignored between waves; the dispatch band is systematically pessimistic for crafted weapons. SI gear recomposes byte-identically to authored stats, which is exactly why all 1834 tests pass and QA missed it.

**Fix shape:** derive the carry-state pools from the geared fold (the same composition `buildPatrolPlayerCombatant`/bridge uses) at every surface listed above, in ONE change so live/replay/forecast stay in lockstep. SI byte-identity keeps existing tests green by construction. `limpDamage` should be computed against the geared hullMax.

**Verification:** new tests: (a) a crafted-plating ship opens wave 1 at folded hullMax; (b) a crafted-emitter ship's between-wave regen targets folded shieldMax/recharge and is not clamped to authored; (c) limpDamage is non-negative and computed against folded hullMax; (d) forecast durability seed matches the live seed for crafted weapons; (e) existing SI byte-identity roster guard still passes. Then gates + parity 101, and a short on-device patrol QA with crafted defense installed.

**Display alignment note (same theme, decide scope during T1):** the dispatch card (`App.svelte:8081-8084`) and `fuelFlowSummary` (`tick.ts:6159/6222/6235`, see P2-13) also read authored/unfolded stats. Aligning the dispatch card's hull/shield readout with the folded values can ride T1 or the 0.13.1 tooltip pass; do not let it silently stay inconsistent.

---

## P1: MAJOR

### T2. Delete Save crashes the app when captain 2+ is selected [verified]

`App.svelte:3825` (`resetSave`) and `:3909` (`startFreshFromCorrupt`) swap in a fresh 1-captain state but never reset `activeCaptainIndex` (only written at init `:744` and selection `:7271`). `$: activeCaptain = state.captains[activeCaptainIndex]` (`:3926`) goes `undefined`, and the Personnel detail view dereferences `activeCaptain.label`/`.level`/`.xp` unguarded (`:7360, :7373-7379`), white-screening the app until manual reload. Scenario: select captain #2, open Personnel detail, System > Delete Save > type DELETE > Confirm. Fix: reset `activeCaptainIndex = 0` and `personnelRosterView = "grid"` (and close any captain-scoped modals) in `resetSave()`; mirror in `startFreshFromCorrupt()` for hygiene (safe today only because corrupt-load happens at page load when the index is still 0).

### T3. Escape double-handling closes the whole modal instead of the inner control [verified]

`focusTrap` listens for keydown on the backdrop node (`focusTrap.ts:118`) and closes on Escape (`:81`). Two inner Escape handlers `preventDefault()` but do NOT `stopPropagation()`, so one keystroke does both:

- Ship rename input (`ShipSystemsPanel.svelte:301-311` `onNameKeydown`): Escape cancels the edit AND closes the entire Ship Systems panel (backdrop at `App.svelte:9213`).
- Combat pip tooltip (`CombatView.svelte:695-697` `onWindowKeydown`): the documented "Escape closes the pinned tooltip" never works as intended; the whole Combat View closes (backdrop at `App.svelte:9233`).
- Same pattern latent for RadialWeb's node-tooltip Escape (`RadialWeb.svelte:496-500`) inside the focus-trapped talent modals (`App.svelte:7146/7466`).

Fix: `stopPropagation()` in the inner handlers when they actually consume the Escape (tooltip open / edit active), so Escape falls through to the trap only when the inner control has nothing to close. Audit all three sites in one pass (one concern: Escape ownership).

### T4. Negative hull text renders on overkill kills [verified]

The sim deliberately leaves hull negative (`resolveBattle.ts:564-571`, callers read `alive`), the fold stores it verbatim (`patrolReplay.ts:596`), and CombatView's `num()` (`CombatView.svelte:838-841`) rounds but does not clamp, so a destroyed ship reads "Hull -13 / 120" in the arena and mobile roster (render sites `:1318, :1413, :1547, :1653`); `flavor.ts:558` interpolates the same unclamped value into log lines. Fix: display-side clamp (`Math.max(0, ...)` in `num()` and the flavor interpolation). Do NOT clamp in the engine (the "hull may go negative" contract is load-bearing for the death check; see the in-code comment).

### T5. Bare localStorage access can crash the app where site data is blocked [verified pattern]

Every preference module touches `localStorage` unguarded: `combatLogPreference.ts` (all loaders/setters, e.g. `:34, :40, :51, :55, :72, :76`), `theme.ts:30,35`, `tickBarPreference.ts:8,13`, `tickReadoutPreference.ts:14,19`, `refineConfirmPreference.ts:16,21`, `salvageConfirmPreference.ts:20,35` (its JSON.parse IS guarded; the accessor is not). In browsers where site data is blocked, touching `window.localStorage` throws SecurityError: CombatView crashes at mount (top-level `loadCombat*()` initializers, `CombatView.svelte:126-133`); in Safari private mode `setItem` throws QuotaExceeded from the Options toggles. Honest scope note: `save.ts:1636-1710` shares the bare posture, so the app cannot fully run saveless in those environments anyway; decide in this task whether to harden save.ts's accessor too (recommended: one shared try/catch storage wrapper, used by all pref modules + save.ts, defaulting sanely on failure). This is exactly the wrapped-storage posture the Artifact/localStorage guidance in this project's own UI code comments already claims to follow.

### T6. Nothing prevents salvaging the fleet's only hull (practical softlock) [verified]

`salvage.ts:473+` (`salvageShip`) guards only `shipNotFound` and `shipOnMission`. A fresh-save player can salvage their only ship (the confirm warns about the orphaned captain but does not block), recovering ~30-40% of a ~500-credit build, then faces a 2000-credit + FA-level-3 Shipyard founding with all mission income stopped. Pre-existing in prod since 0.11.1 (not a promotion regression), but it violates the peace-override invariant, and 0.11.1 itself was an emergency softlock fix in this exact subsystem. Fix: a `lastShip` block reason in `salvageShip` when `state.ships.length === 1` (engine-level guard, mirrored in the UI with a clear message). Decide whether a dev-mode escape hatch is wanted; default no.

---

## P2: MINOR ledger (fix opportunistically, in this window or after)

1. **Bucket-0 negative quality balance on over-cap re-clamp** [verified]. `tick.ts:2235-2239`: when `priorTotal > cap` (reachable: salvage deposits via `addItemQuality` bypass the clamp, `salvage.ts:264/412/545`), the negative delta lands on bucket 0, which can hold less than the delta, leaving a permanently negative per-quality readout (total stays == cap so `clampInventoryToCaps` never heals it). Fix: drain via `removeItemLowestFirst` semantics instead of a raw bucket-0 write.
2. **Dispatch at material cap burns a round-trip's fuel for nothing** [verified]. `canDispatch` has no `materialAtCap` gate; economyTick's auto-stop (`tick.ts:2477-2484`) nulls the mission post-dispatch with no fuel refund. Fix: gate dispatch (a new `DispatchBlockReason`) or refund on the ordersReceived cap-stop. Gate is cleaner and player-legible.
3. **Reactor gate inconsistency: extraction vs patrol** [verified]. Patrol dispatch hard-blocks an empty reactorCore (`tick.ts:3441`, "no power = cannot set a course"); extraction dispatch has no such reason (`tick.ts:2933-2942`). Same powerless ship flies ore runs. USER DECISION: extend the gate to extraction (stricter, consistent) or soften the patrol rationale comment. Note: extending it can strand existing reactor-less loadouts mid-progression; if extended, verify no save can be soft-locked by it (the SI baseline reactor makes this unlikely, confirm).
4. **Docks capacity exceedable (9/8)** [agent-reported]. Storage gated at build START only (`tick.ts:4578`); completion parks unconditionally (`:6588-6604`); `buyHomeworldTalent` grants a Freighter regardless of capacity (`:6952-6956`). Build in flight + slot-talent purchase = over cap. No softlock; cap invariant visibly violated.
5. **Mid-turn liveness: corpses absorb salvos, reflect-killed attackers keep firing** [verified mechanism]. `resolveBattle.ts`: target selected once per turn (`:1797`), never re-checked in the weapon (`:1836-2074`) or drone (`:2090-2230`) loops; an attacker killed by its own reflected shot keeps firing its remaining salvo (contradicting the comment at `:1788`), and a support pulse can heal a dead ship's hull above 0 with `alive` false. Deterministic and parity-safe, but wrong in multi-ship/reflect fights. CAUTION: fixing changes battle outcomes; all paths change together (they share the resolver), parity stays, but expect reward/test-fixture churn. Its own commit, carefully.
6. **Fractional hull leaks through a float shield break** [agent-reported]. `bridge.ts:688-697` produces float shieldMax/recharge for crafted emitters on non-reference hulls; `applyProjectileDamage` (`resolveBattle.ts:529-534, :570`) then passes fractional overflow into hull un-floored, and `advanceShieldRegen` (`:346`) silently floors fractional recharge (6.9/s regens as 6/s). Beyond the known "UI decimals" deferral: this puts floats in carry-state and the offense-gate comparison. Ties into the 0.16.0 crafted-float rounding deferral; consider pulling that rounding decision (round at the bridge fold) forward since T1 already touches these seams.
7. **Stale pinned pip tooltip on effect expiry** [agent-reported]. `CombatView.svelte:1799` renders on `selectedPipKey !== null && tipData` without checking the pip still exists (contradicts the comment at `:547`); an expired effect leaves the tooltip stuck, and `reflowPipTip` measures the detached anchor (snaps to viewport corner). Clear the selection when the pip key no longer resolves.
8. **CombatView auto-close never fires on patrol end** [agent-reported]. `App.svelte:2740-2766`: the guard nulls only when the CAPTAIN disappears (captains are never removed); when a watched patrol completes, the view stays open on dead wave pointers (null-guards prevent a crash). Close (or show a "patrol complete" terminal state) when `captain.mission` goes null.
9. **Ship-switch during open rename edit commits the old draft onto the new ship** [agent-reported, latent]. `ShipSystemsPanel.svelte:225-233` reset block clears pickers but not `editingName`/`nameDraft`. Hard to reach today (modal blocks switching); add the two fields to the reset block.
10. **Unguarded renders on malformed state** [agent-reported, latent]. `CombatView.svelte:779-780` reads `state.equipment` unguarded (ShipSystemsPanel defends the same read at `:240` with `?? []` + rationale); `App.svelte:6682/6699/6733/6754/7285` read `SHIP_TYPES[ship.typeKey].label` unguarded where sibling sites use `?.label ?? x`. Align with the defensive idiom.
11. **TARGET marker can disagree with the sim's focus-fire target** [agent-reported]. `combatView.ts:192-210` picks lowest HULL; the sim (`positioning.ts:206-281`) picks lowest shield+hull, in-range preferred. Display-only. Reuse the sim's selector.
12. **Replay pip fold drops a re-applied effect** [agent-reported]. `patrolReplay.ts:641-659`: removals run after all additions per round, so expire-then-reproc within one round deletes a genuinely active pip. Display-only; process events in tick order or track per-effect last-event.
13. **fuelFlowSummary uses unfolded hull stats** [agent-reported]. `tick.ts:6159/6222/6235`: burn/net computed at baseline while the engine burns folded (drive efficiency / mass drag, up to 10x): the top bar can read "sufficient" while the tank drains. Display-only (EMA runway unaffected). Same theme as T1's display note.
14. **Limp-home `progressTicks` exceeds route length** [agent-reported]. `tick.ts:1746, :1766-1776`: the limp branch continues past the completion check while progress advances; a >100% progress bar is the worst outcome.
15. **Latent engine hygiene, document-or-fix** [agent-reported]: (a) shrinking a phase's `requiredTicksForPhase` between versions makes `ticksToApply` negative (`tick.ts:1110-1133, :1176-1177`), silently corrupting that call's XP/time accounting; floor at 0 or clamp stored progress on load. (b) a removed/renamed `patrolKey`/`missionKey` in a save hard-crashes every tick (`tick.ts:1677-1680, :2380, :2477`); adopt the `lineJobSpec` unknown-key inert posture or null the mission on load. (c) the trailing fractional `economyTick` call runs once-per-call process passes on a sub-tick span (`tick.ts:2910-2913`), up to ~1 tick early vs live cadence; known-legacy precision, document it next to the parity guarantee. (d) theoretical 1-ULP negative fuel from Decimal/number netting at dispatch (`tick.ts:3081-3110, :3524-3551`); a `Decimal.max(0, ...)` floor closes it. (e) `inhibit` is a dead status-effect registry row (`statusEffects.ts:313-321`, nothing procs or reads it); remove or wire before future content procs a no-op pip. (f) `enemyEnd` id-sort diverges from label arrays at 10+ enemies per wave (`patrolReplay.ts:314`, lexicographic `e10 < e2`); unreachable with current defs, use numeric-aware ordering.

---

## Design decisions for the user (not code fixes; do not build without a call)

- **EquipmentTooltip.svelte WAS modified on this branch** despite the preserve-unchanged constraint: commit `df53dd5` (user-authored, 2026-08-26, openly declared in its message) extended the name derivation so weapon/drone blueprints resolve display names (`EquipmentTooltip.svelte:178-192`). Low-risk and fully optional-chained, and it looks like a knowing exception made during the defense-blueprint work, but the constraint and the code now disagree, and ShipSystemsPanel's "EquipmentTooltip is UNCHANGED" claims (`:27, :79`) are stale. ASK: bless the change (update the constraint + fix the stale comments) or revert it.
- **SI combat gear is mass 0; crafted combat gear carries real mass** (weapon 12, emitter 8, plating 20, pod 14: `itemgen.ts:479/528/586/642`), so upgrading a free SI weapon to crafted drops transit speed ~19% and bites fuel efficiency via mass drag. The mass-vs-thrust fold is deliberate; the SI-0-vs-crafted asymmetry partially works against "first crafted tier is always worth making". ASK: conscious sign-off now, or fold into the 0.16.0 balance pass.
- **"4 guns" observation RESOLVED, wording tweak optional:** the dispatch line (`App.svelte:8083`) reads `weaponHardpoints` (hull mount CAPACITY), so "4 guns" next to "No weapon installed" is capacity-vs-installed phrasing, not a bug. Suggest "4 hardpoints".
- **Reactor gate direction** (P2-3 above) needs a user call before code moves.

## Explicitly verified clean (for the record)

Migration chain 30 to 39 (field coverage, Decimal revival, idempotence, frozen bodies untouched, fresh-game parity); live loop vs tick() (no field drift); determinism (no Math.random/Date.now in sim paths; seeded streams isolated); no silent item deletion (every destroy site pooled or gated by `isStandardIssueBaseline`); bare-frame hull invariant; model.ts combat imports all type-only; offense gate correct beyond the two logged deferrals; wave scheduling collision-free; durability clamps; XP folding (no double-award/lost-XP); fuel/credit budgets (no double-spend); rename seams (ship + captain); import/export/corrupt-save flow; dev panel build-time gated; timers/listeners torn down; threat-band tier guards; salvage confirm routing; threat-tooltip opacity fix.

## Suggested execution order for the Opus session

1. T1 (blocker; largest, touches tick/replay/forecast/patrolWave together; new tests).
2. T2, T3, T4 (small, isolated, user-facing crashes/annoyances).
3. T6 (peace-override guard), T5 (storage hardening).
4. P2 items as approved, each its own commit; design-decision items only after the user's calls.
5. Gates after every commit: `npm run check`, full vitest, parity exactly 101. Then refresh SESSION_HANDOFF.md, delta QA on-device (patrol combat with crafted defense gear), and the user's explicit go before the single v30 to v39 promotion.
