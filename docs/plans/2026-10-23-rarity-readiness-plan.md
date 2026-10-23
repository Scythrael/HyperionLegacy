# 0.14.0 Rarity and quality readiness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan slice by slice. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every planned gear rarity and ascension tier (Derelict, Standard to Radiant, the Luminous and Constellar legendaries, Nova and Celestial ascension, Constellar set bonuses) exists in code and works end to end, so any of them can be switched on during balancing, while every live Standard to Radiant piece stays bit-identical and nothing new reaches a player's drops.

**Architecture:** Pure readers first: one total rarity vocabulary (normalize on load, total `rarityIndex` / `affixCount` / `computeBudget`), then a per-rarity PROFILE table that the three generators read instead of `RARITY_MULT ** rarityIndex` plus the `affixCount` switch (live rows derived from today's constants so the doubles are identical), then ascension, the Luminous legendary affix catalog and ONE shared set engine that counts installed pieces (derived from the install authorities, never stored, so uninstall and loadout checkout recount for free). The only producer is the DEV_MODE Debug minter; `CRAFTED_RARITY_PRODUCIBLE` stays false for every new band (answer 4).

**Tech Stack:** Svelte 5 (legacy syntax as in App.svelte), TypeScript, Vitest, break_infinity.js `Decimal` (untouched here).

**Spec:** `docs/plans/2026-10-22-rarity-quality-readiness-capture.md` (the user's request verbatim, the read-only audit, USER ANSWERS 1 to 12). Design source: `docs/plans/2026-07-17-ship-equipment-combat-epic-design.md` section 3 (:126-166 rarity model and affix richness), :215 (budget stage 5: +20% legendary, +25% Nova) and :491 (naming registry).

## Global Constraints

- Standard, Augmented, Stellar and Radiant output is BIT-IDENTICAL in every slice: same stat lines, same doubles, same rng draw count and order (the offline == live contract; `mintCraftedPiece` draws quality #1, rarity #2, affixes #3..). RR-0's LIVE goldens are asserted in every later slice and may never move.
- Reserved bands (Derelict, Luminous, Constellar) and every non-"none" ascension are pinned too, in a separate RESERVED group; a slice may move a RESERVED pin only on purpose, with the move named in its commit message and carry note.
- No producer beyond the dev mint (answer 4): `CRAFTED_RARITY_PRODUCIBLE` keeps luminous / constellar / derelict false, `rollCraftedRarity` is untouched, no talent proc, no drop source. Ascension: plumbing only (answer 3).
- Live tiers unchanged (answers 5 and 6): secondaries only on Luminous and Constellar; Stellar and Radiant keep 3 affixes and no secondary.
- Constellar stays rose `#f472b6` (answer 8). Crew cap stays `"stellar"` (answer 7). Derelict is never produced and reads as the Standard-Issue floor in item readers (answer 9); CREW derelict is a live crew band (crewGeneration.ts GEN_RARITIES) and is NOT touched.
- Ships and field kits quality are OUT (answer 11b, a 0.16.0 release gate).
- SAVE_VERSION stays 70. Value normalization runs on every load (the withHomeworldV70 / dropRetiredDurabilityV70 posture: idempotent, the SAME reference for a clean save). A real schema step, if one is ever needed, appends to MIGRATIONS[69].
- Determinism: any new draw is an integer draw on a `makeRng` stream with a fresh ODD salt registered in salts.test.ts, drawn AFTER every existing draw of the same mint so live pieces keep their stream.
- Everything wired (user ruling): no inert value. Every new catalog row gets a wiring registry entry (src/lib/game/wiring/registry.ts) with a real sensitivity probe. Stacking bonuses use diminishing curves (D23), never hard caps.
- Text rules: no em dashes and no double-hyphen substitutes anywhere; US English; "install" never "fit / fitting / fitment" in new text; graphics only as SVG via icons.ts + ICON_SEMANTICS; never emoji.
- Every new number is marked [PROVISIONAL] on ONE named constant; every new named entity (legendary affix names, test set names) is marked [PROPOSAL] and listed for the user.
- Gates per slice: `npx vitest run --maxWorkers=4 --testTimeout=60000` green and `npm run check` 0 errors (the 2 old RadialWeb warnings are fine). No dev servers.

## Review Focus

The five failure modes most likely to bite a real player, each pinned by a test in the owning slice:

1. **A live piece silently changes** (a Radiant weapon loses a point, an inspect re-rolls differently after reload, offline catch-up drifts from live because a new draw slid in front of the affix picks). Pinned in RR-0 by `rarityGoldens.test.ts` LIVE group: every generator over every live slot, variety, weapon and drone role at Standard to Radiant, three qualities, three item levels, with the rng draw count; plus the real inspect path (`inspectBlank` for every gear blueprint at eight seeds) and `previewCraftOutcome` for every gear blueprint. Asserted unchanged by RR-1 through RR-8.
2. **A hand-edited, corrupt or newer-build save carries a rarity string this build does not know** and the result is NaN (a NaN stat poisons the ship fold, a NaN salvage duration occupies a bay forever, a NaN sort key scrambles the reveal list) or a crash in a `switch` with no default. Pinned in RR-1 by `rarityHardening.test.ts`: "Radiant", "mythic", 7, null and a missing field load as known bands; `rarityIndex`, `affixCount`, `computeBudget`, `craftedDefensiveImplicit`, `moduleEffectScale`, `itemScore`, `salvageDurationTicks`, `sortRolledPieces` and `equipmentStatMods` stay finite for every junk value.
3. **Legendary or ascension math leaks into live gear** (secondaries appear on Stellar or Radiant, a stray "nova" on a Radiant piece boosts it, the +20% legendary step is applied to Radiant). Pinned in RR-3 (`rarityProfiles.test.ts`: the live rows equal `RARITY_MULT ** rarityIndex` exactly, zero secondaries, the same affix counts and draw counts as the old switch) and RR-4 (`ascension.test.ts`: an ascension on a non-legendary band is ignored by every reader and normalized off by the dev mint).
4. **Set bonuses go stale or double count** (a bonus survives an uninstall or a loadout check-in, a piece in storage counts, a ship piece and a member piece of the same set add up, the Celestial minus-1 applies twice). Pinned in RR-6 (`gearSets.test.ts`: install, uninstall, loadout check-out and check-in, member wear and remove, a stored piece, ship plus member split, two Celestial pieces in one set).
5. **A later switch-on regresses a neighbor** (raising the crew cap makes Radiant crew weaker than Stellar; adding a legendary salvage tier reshapes relic blank odds; the warehouse ignores the color-blind palette). Pinned in RR-7 (`crewRarity.test.ts` monotonic over the whole ladder with the cap lifted in the test; `relicBlanks.test.ts` keeps every blank golden with a fifth tier injected into a copy of the salvage pool; a source test that every warehouse rarity color is a `var(--item-rarity-*)` token defined in both palettes).

---

## Decisions the plan makes (within the user's answers)

Each is recorded so the reviewer can check it against the answers. Numbers carry [PROVISIONAL], names [PROPOSAL].

- **Unknown rarity normalizes to "standard"** (RR-1, `RARITY_LOAD_FALLBACK` [PROVISIONAL]): the Standard-Issue floor of answer 9. Matching is case and whitespace tolerant first ("Radiant " reads radiant), so only a truly unknown string falls back. Unknown ascension normalizes to "none". An ascension on a band that cannot carry it is NOT stripped on load (no data loss); every reader ignores it instead (RR-4).
- **Load normalization covers gear** (state.equipment and an in-flight expedition's frozen `groundOps.shipEventProfile.battle.installedGear`, the two places EquipmentInstances live in the save). Crew rarities, relic token tiers and archive entries are protected by TOTAL readers instead (a total `rarityIndex`; `crewRarityMultiplier`, `skewTierOf` and `relicStudyDurationTicks` already fall back), so no crew or relic data is rewritten.
- **The profile table is derived, not retyped** (RR-3): the live rows' `budgetMult` is computed as `RARITY_MULT ** rarityIndex(band)` so the double is identical, and `computeBudget` keeps its left-to-right multiplication order. Luminous and Constellar start at `LEGENDARY_BUDGET_STEP = 1.2` [PROVISIONAL] times Radiant (answer 5, the design's +20%), replacing today's unproduced 1.15 step.
- **Secondaries** (RR-3, answer 6): extra rolled lines on Luminous (2) and Constellar (1, the second is replaced by the set bonus, design :164), drawn AFTER the affix picks from the same pool WITH replacement (so a secondary may stack onto a line the piece already has [PROVISIONAL], a reading put to the user), each worth `SECONDARY_BUDGET_SHARE = 0.15` [PROVISIONAL] of the piece's budget, and ADDED into `rolledStats`. SEED SOURCE (review of RR-0 to RR-2): the extras run on their own `makeRng` stream with a fresh ODD salt registered in salts.test.ts (`RARITY_EXTRAS_SALT`), keyed by the piece's existing mint stream: ONE draw taken on the mint's own rng right after the affix picks, scaled to a 32-bit integer and XORed with the salt. A band with no extras (every live band) never takes that draw. Secondaries land in `rolledStats` so every existing fold, the tooltip, salvage and the combat bridge read them with no new consumer. Artisan (design :163): `ARTISAN_CHANCE = 0.25` [PROVISIONAL] on Luminous and Constellar, one random rolled line times `ARTISAN_LINE_MULT = 1.25` [PROVISIONAL] (today's rolls have no min / max range, so the design's "+50% min, +25% max" is folded into one multiplier; flagged for the user).
- **Ascension** (RR-4, answer 3): `NOVA_BUDGET_MULT = 1.25` [PROVISIONAL] (design :215) and `CELESTIAL_BUDGET_MULT = 1.4` [PROVISIONAL] (the design says only "its own"). Nova guarantees the Artisan line, Celestial also adds one secondary [PROVISIONAL, a reading put to the user] (the design's "Luminous-effect stats guaranteed"). Labels "Nova Luminous", "Celestial Constellar" (design naming registry :491). The SWITCH is producibility only [PROVISIONAL, a reading put to the user]: `ASCENSION_PRODUCIBLE = false`; no player path mints an ascension, so nothing reads it yet (its reader is the later producer; listed in UNREAD_CONSTANTS); the math is live for any piece that carries a valid ascension (so a dev-minted Nova piece measurably acts and nothing is inert).
- **Legendary affix** (RR-5, answer 1): a catalog `LUMINOUS_AFFIXES` of build-defining lines per slot family, stamped on the piece as `legendaryAffixId` (display and uniqueness) with its value added into `rolledStats` under an EXISTING fold stat key, so it acts through today's folds. One legendary affix per piece. A unique-equipped rule (at most one equipped per ship per id, the shape E-CREW uses) is a NEW rule the user has not approved: [PROPOSAL], NOT built in RR-5 until the user answers. Names [PROPOSAL].
- **Sets** (RR-6, answer 2): ONE engine `gearSets.ts` for gear and E-MOD modules. A piece's set is `setId` on the instance (a Constellar gear piece, stamped at mint) or its catalog `UniversalModuleDef.setId` (a set-category module). Pieces count per SHIP (equippedFor) and per AWAY-TEAM MEMBER (memberEquipment), separately, never summed. Thresholds 2 / 3 / 5. Celestial minus-1: when at least one counted piece of the set is Celestial Constellar, every threshold of that set drops by 1, once. Bonuses fold through `equipmentStatMods` (ship) and `snapshotMember` (member). Two test sets [PROPOSAL]: `testSetSurvey` "Survey Cadre" (ship: cargoBay, ftlDrive, sensor, reactorCore, specUtility) and `testSetField` "Field Cadre" (member: armor, weapon, tool, implant). EM-7 later adds module sets to the same catalog.
- **Derelict unified** (RR-7, answer 9): one rule, `isDerelictFloor`: in every item VALUE reader (budget, module scale, salvage, relic band, archive score) Derelict reads as Standard; in every ORDER reader (sort, keep-best) it sorts just below Standard. Never produced.

---

## File structure

| File | Responsibility |
|---|---|
| `src/lib/game/rarityGoldens.fixture.ts` (RR-0) | The sweep builders and the frozen pre-change pins (LIVE and RESERVED groups). |
| `src/lib/game/rarityGoldens.test.ts` (RR-0) | Asserts every pin; `RR_CAPTURE` env var re-captures to a file (the GW_CAPTURE pattern). |
| `src/lib/game/model.ts` | `normalizeEquipmentRarity`, `normalizeEquipmentAscension`, total `rarityIndex`, `EQUIPMENT_ASCENSIONS`, `ascensionAllowedFor` (RR-1, RR-2). |
| `src/lib/game/itemgen.ts` | Total `computeBudget` / `affixCount` / `craftedDefensiveImplicit` (RR-1); profile-driven generators (RR-3, RR-4, RR-5). |
| `src/lib/game/save.ts` | `withNormalizedGearRaritiesV70`, run on every load in `migrate` (RR-1). |
| `src/lib/game/devMint.ts` | `DEV_MINT_RARITIES`, `DEV_MINT_ASCENSIONS`, `devMintAscension`, `ascension` arg (RR-2); `setId` arg (RR-6). |
| `src/App.svelte` | Debug "Mint gear" row: full ladder, ascension picker (RR-2); set picker (RR-6); warehouse tokens (RR-7). |
| `src/lib/game/rarityProfiles.ts` (RR-3) | `RARITY_PROFILES`, `rarityProfile`, legendary constants. Leaf: imports model.ts types and constants only. |
| `src/lib/game/ascension.ts` (RR-4) | `ascensionBudgetMult`, `effectiveAscension`, `ascensionLabel`, `ASCENSION_PRODUCIBLE`. |
| `src/lib/game/legendaryAffixes.ts` (RR-5) | `LUMINOUS_AFFIXES` catalog and its validator. |
| `src/lib/game/gearSets.ts` (RR-6) | `GEAR_SETS`, `setPieceCounts`, `activeSetBonuses`, the Celestial hook. |
| `src/lib/game/crewRarity.ts`, `relicBlanks.ts`, `relics.ts`, `salvage.ts`, `src/app.css` (RR-7) | The trap fixes. |
| `src/lib/game/wiring/registry.ts` | A live row with a probe for every new catalog row (RR-3 to RR-7). |

---

### Slice RR-0: goldens first

**Files:**
- Create: `src/lib/game/rarityGoldens.fixture.ts`, `src/lib/game/rarityGoldens.test.ts`

**Interfaces:**
- Produces: `RARITY_GOLDENS_LIVE: Record<string, string>`, `RARITY_GOLDENS_RESERVED: Record<string, string>` (fnv hashes through `hash` from firstRunsGoldens.fixture.ts), and the sweep builders `generatorSweep(bands)`, `inspectSweep()`, `previewSweep()`, `readerSweep(bands)`, `loadRoundTrip()`.

- [ ] **Step 1: Write the sweep builders.** A counting rng wrapper (an lcg plus a draw counter) so every pin records the draws consumed. Sweeps:
  - generators: every live `EQUIPMENT_SLOTS` slot and variety (`generateEquipment`), every `WEAPON_DEFS` id (`generateWeapon`), every `ROLE_TEMPLATE` role (`generateDronePod`); quality 0 / 3 / 5; iLevel 1 / 20 / 40; one seed per cell; blueprintKey a real key where the slot needs one (member floor) and null otherwise.
  - primitives: `rarityIndex` per band, `affixCount` value and draw count per band, `computeBudget` over iLevel {1, 10, 20, 40} x quality 0..5 x index 0..5, `craftedDefensiveImplicit` for the three defensive curves, `moduleEffectScale` per band and quality.
  - mint path: `inspectBlank` for every blueprint where `blueprintMintsEquipmentInstance` holds, on a fresh state with one blank, at inspectSeed 0..7.
  - preview: `previewCraftOutcome` for every gear blueprint at crafting level 1 and 40.
  - dev mint: `devMintFromBlueprint` for every gear blueprint at every ladder band, quality 5, iLevel 40.
  - readers: `itemScore`, `salvageDurationTicks`, `crewRarityMultiplier`, `clampCrewRarity`, `relicBandOf`, `relicStudyDurationTicks`, `equipmentRarityLabel` per band; `sortRolledPieces` over a mixed list; `RELIC_BLANK_WEIGHTS`; `SALVAGE_CEILING_THRESHOLDS`.
  - load: a v70 save holding one piece per band and ascension, through `serialize` / `deserialize` / `migrate`, equipment compared.
- [ ] **Step 2: Split the pins.** LIVE = everything at Standard to Radiant with ascension "none", plus the mint path and preview (both only ever see live bands). RESERVED = Derelict, Luminous, Constellar and every non-"none" ascension, each pin named by the slice expected to move it (RR-3 the legendary budget and secondaries, RR-4 ascension, RR-7 Derelict and crew rows).
- [ ] **Step 3: Capture** on the unchanged engine: `RR_CAPTURE=<scratch path> npx vitest run src/lib/game/rarityGoldens.test.ts`, paste the record into the fixture. Add a vacuity guard (the sweep really covers every slot, weapon, role and gear blueprint, and at least one piece per band has more than one rolled line).
- [ ] **Step 4: Run** `npx vitest run src/lib/game/rarityGoldens.test.ts`; expect PASS. Full gates.
- [ ] **Step 5: Commit** `test(0.14.0): rarity readiness goldens captured before any engine change (RR-0)`.

### Slice RR-1: hardening (no NaN anywhere)

**Files:**
- Modify: `src/lib/game/model.ts` (rarityIndex ~2044, new normalizers next to it, `equipmentRarityLabel` ~6209), `src/lib/game/itemgen.ts` (`computeBudget` ~233, `affixCount` ~251, `craftedDefensiveImplicit` ~190), `src/lib/game/save.ts` (`migrate` ~2958, new `withNormalizedGearRaritiesV70`)
- Test: `src/lib/game/rarityHardening.test.ts`

**Interfaces:**
- Produces: `normalizeEquipmentRarity(raw: unknown): EquipmentRarity`, `normalizeEquipmentAscension(raw: unknown): EquipmentAscension`, `isEquipmentRarity(x: unknown): x is EquipmentRarity`, `RARITY_LOAD_FALLBACK` [PROVISIONAL "standard"], `withNormalizedGearRaritiesV70(state: any): any`.

- [ ] **Step 1: Failing tests:** each junk value ("Radiant", " stellar ", "mythic", "", 7, null, undefined, {}) normalizes to a known band; junk ascension to "none"; `rarityIndex` / `affixCount` (and its draw count: zero) / `computeBudget` (NaN, Infinity, negative inputs) / `craftedDefensiveImplicit` / `moduleEffectScale` / `itemScore` / `salvageDurationTicks` / `equipmentRarityLabel` finite or a string for junk; a save with junk rarities loads with known bands, every piece's budget-derived fold finite, an in-flight expedition's frozen gear normalized; a clean save returns the SAME state reference from the pass (identity) and SAVE_VERSION is 70.
- [ ] **Step 2: Run** the file; expect FAIL.
- [ ] **Step 3: Implement.** Defaults that return the Standard reading on every switch; finite guards that are the identity for every finite input (so LIVE goldens cannot move); the every-load pass runs right after the migration loop, BEFORE `withStandardIssueMemberLinesV70` and the other every-load passes, so they all read known bands. Known side effect on a CORRUPT save only: a junk-rarity piece with `blueprintKey` null normalizes to "standard" and so reads as a Standard-Issue baseline (isStandardIssueBaseline), which means a member piece of that shape gets its lines RAISED to the Quartermaster catalog values (never lowered) and an economy piece of that shape is treated as declutter-salvageable. A clean save is untouched.
- [ ] **Step 4: Run** the file and `rarityGoldens.test.ts`; expect PASS with no pin moved. Full gates.
- [ ] **Step 5: Commit** `fix(0.14.0): total rarity readers and rarity normalization on load (RR-1)`.

### Slice RR-2: dev mint for every tier

**Files:**
- Modify: `src/lib/game/model.ts` (`EQUIPMENT_ASCENSIONS`, `ascensionAllowedFor`), `src/lib/game/devMint.ts`, `src/App.svelte` (Debug "Mint gear" row ~19660 and `devMintGear` ~4991)
- Test: `src/lib/game/devMint.test.ts` (extend or create), a source test on App.svelte (`?raw`, the completionLog.test.ts idiom)

**Interfaces:**
- Produces: `EQUIPMENT_ASCENSIONS: readonly EquipmentAscension[]` (derived from a total record, the AUTO_SALVAGE_RARITIES_NONE pattern), `ascensionAllowedFor(rarity): boolean` (luminous and constellar only, design :149), `DEV_MINT_RARITIES` (every ladder band), `DEV_MINT_ASCENSIONS`, `devMintAscension(rarity, ascension): EquipmentAscension` (the requested ascension when allowed, else "none"), and `devMintFromBlueprint({ ..., ascension? })`.

- [ ] **Step 1: Failing tests:** the dev mint offers all seven bands and all three ascensions; a Luminous or Constellar mint stamps the chosen ascension; a Nova request on Radiant (or any non-legendary) mints "none"; omitting `ascension` is byte-identical to today (RR-0 dev mint pins); App's picker reads `DEV_MINT_RARITIES` and `DEV_MINT_ASCENSIONS`, passes `ascension` through `devMintAscension`, sits inside the `{#if DEV_MODE && activeSystemSubTab === "debug"}` block, and the player-facing producibility list (`PRODUCIBLE_EQUIPMENT_RARITIES`) is unchanged.
- [ ] **Step 2: Run;** expect FAIL.
- [ ] **Step 3: Implement.** Picker options show `equipmentRarityLabel`; the ascension select is disabled unless `ascensionAllowedFor(devMintRarity)`; the log line names the ascension.
- [ ] **Step 4: Run** the tests and the goldens; expect PASS, no pin moved. Full gates.
- [ ] **Step 5: Commit** `feat(0.14.0): Debug minter for every rarity and ascension (RR-2)`.

### Slice RR-3: per-rarity profile table

**Files:** Create `src/lib/game/rarityProfiles.ts` (+ test). Modify `itemgen.ts` (the three generators and `previewCraftOutcome` read the profile), `wiring/registry.ts`.

**Interfaces:** `interface RarityProfile { budgetMult; affixes; extraAffixChance; secondaries; extraSecondaryChance; artisanChance; legendaryAffix: boolean; setBonus: boolean }`, `RARITY_PROFILES: Record<EquipmentRarity, RarityProfile>`, `rarityProfile(rarity)`, `LEGENDARY_BUDGET_STEP` [PROVISIONAL 1.2], `SECONDARY_BUDGET_SHARE` [PROVISIONAL 0.15], `ARTISAN_CHANCE` [PROVISIONAL 0.25], `ARTISAN_LINE_MULT` [PROVISIONAL 1.25], `RARITY_EXTRAS_SALT` (fresh odd, salts.test.ts; the seed source is described under Decisions).

- [ ] Failing tests: live rows equal `RARITY_MULT ** rarityIndex` and today's affix counts and draw counts; zero secondaries below Luminous; Luminous budget = Radiant x 1.2; Luminous rolls 2 secondaries, Constellar 1, both after the affix picks on a separate salted stream so the shared stream advances exactly as before; Artisan fires at the expected rate over a seed sweep; monotonic budget over the ladder.
- [ ] Implement; LIVE goldens unchanged; RESERVED legendary pins move (named in the commit); registry rows for the legendary budget step, secondaries and Artisan with probes (a dev-minted Luminous piece's fold vs a Radiant one).
- [ ] Commit `feat(0.14.0): per-rarity profile table, legendary budget and secondaries (RR-3)`.

### Slice RR-4: ascension plumbing behind the switch

**Files:** Create `src/lib/game/ascension.ts` (+ test). Modify `itemgen.ts`, `inspectSort.ts`, `salvage.ts` (`autoSalvageIsBetter` tie-break), `EquipmentTooltip.svelte` only through an exported label helper (its presentation is under a do-not-touch constraint: header text only, reviewed), `wiring/registry.ts`.

**Interfaces:** `ASCENSION_PRODUCIBLE = false`, `effectiveAscension(piece)`, `ascensionBudgetMult(rarity, ascension)`, `NOVA_BUDGET_MULT` [PROVISIONAL 1.25], `CELESTIAL_BUDGET_MULT` [PROVISIONAL 1.4], `ascensionLabel(rarity, ascension)` ("Nova Luminous"), `ascensionOrder(ascension)`.

- [ ] Failing tests: Nova and Celestial raise a legendary's budget by their multipliers; any ascension on a non-legendary band is ignored by budget, label and sort; sort puts Celestial above Nova above none within a band; auto-salvage never sweeps a Celestial piece, manual salvage stays allowed [PROPOSAL, design "cannot be sold"; a reading put to the user]; no player path mints an ascension (grep test on tick.ts mints: "none" literals stay).
- [ ] Implement; LIVE goldens unchanged; RESERVED ascension pins move. Commit `feat(0.14.0): Nova and Celestial ascension plumbing (RR-4)`.

### Slice RR-5: Luminous legendary affix catalog

**Files:** Create `src/lib/game/legendaryAffixes.ts` (+ test). Modify `itemgen.ts`, `model.ts` (`EquipmentInstance.legendaryAffixId?: string`, optional and additive, no migration), `devMint.ts` + App picker (choose an affix or random), `wiring/registry.ts`.

**Interfaces:** `interface LegendaryAffixDef { id; label [PROPOSAL]; slotTypes; stat (an existing fold key); budgetShare [PROVISIONAL] }`, `LUMINOUS_AFFIXES`, `legendaryAffixesFor(slotType)`, `validateLegendaryAffixDef`.

- [ ] Failing tests: every live slot family has at least one affix; each stat key is read by a live fold (validator against the fold vocabulary); a Luminous mint carries exactly one, a Constellar or live mint none; the line measurably moves the fold (probe). (No unique-equipped rule: [PROPOSAL], awaiting the user.)
- [ ] Proposed v1 names [PROPOSAL], one per family (as built in RR-5; each on a line its slot already rolls and a live fold reads): Weapon "Starfall Lance" (weaponYield), Drone pod "Hivemind Relay" (droneHp), Shield emitter "Aegis Lattice" (shieldCapacity), Hull plating "Bulwark of Sol" (hullStrength), Cargo bay "Bottomless Hold" (cargoCapacity), FTL drive "Endless Wake" (fuelCapacity; transitSpeedMult runs on a diminishing curve and is pending at patrols), Reactor core "Heart of a Star" (powerOutput), Spec utility "Transmuter's Seal" (materialQualityChance, read on every variety; the scan and hazard lines are suite-only), Quarters "Grand Concourse" (colonistCapacity), Member weapon "Oathkeeper" (groundPower), Member armor "Last Stand Weave" (groundArmor), Member tool "Master's Touch" (groundRelicFind), Implant "Second Sight" (groundHp). NO affix (no inert line): Bridge (crewEfficiency is read by nothing yet), Sensor (the sensors line is deferred; "Far Watcher" dropped), Module (EM-7). The user names or replaces them before any ship.
- [ ] Commit `feat(0.14.0): Luminous legendary affix catalog (RR-5)`.

### Slice RR-6: one shared set engine

**Files:** Create `src/lib/game/gearSets.ts` (+ test). Modify `model.ts` (`EquipmentInstance.setId?: string`, optional; `equipmentStatMods` folds active set bonuses), `awayTeam.ts` (`snapshotMember` folds member set bonuses), `shipModules.ts` (`MODULE_ENGINE_KEYS.set`, so EM-7 can add set modules), `itemgen.ts` / `devMint.ts` (a Constellar mint stamps a set whose slots include the piece's), App picker, `wiring/registry.ts`.

**Interfaces:** `interface GearSetDef { id; label [PROPOSAL]; scope: "ship" | "member"; slotTypes; tiers: { pieces: 2 | 3 | 5; stat; magnitude [PROVISIONAL] }[] }`, `GEAR_SETS`, `pieceSetId(piece)` (instance setId, else a set module's catalog setId), `setPieceCounts(pieces)`, `activeSetBonuses(pieces)`, `CELESTIAL_SET_REDUCTION = 1`.

- [ ] Failing tests: the five recount cases of Review Focus 4; thresholds 2 / 3 / 5 exactly; Celestial minus-1 once per set however many Celestial pieces; a module with a catalog setId counts through the same engine; bonuses read through the existing fold keys and move the probe.
- [ ] Test sets [PROPOSAL]: "Survey Cadre" (ship) and "Field Cadre" (member), dev mint only.
- [ ] Commit `feat(0.14.0): shared gear and module set engine with two test sets (RR-6)`.

### Slice RR-7: the traps

**Files:** `crewRarity.ts`, `relicBlanks.ts`, `relics.ts`, `salvage.ts`, `src/app.css`, `App.svelte` (`warehouseRarityColor` ~2298), `model.ts` (Derelict rule), the set shoutout (App log + a pure helper beside `relicIdentify.ts`).

- [ ] Crew (answer 7): `CREW_RARITY_MULTIPLIER` becomes a TOTAL record: radiant [PROVISIONAL 1.55], luminous = constellar = `CREW_LEGENDARY_MULTIPLIER` [PROVISIONAL 1.8]; cap stays "stellar"; test monotonic with the cap lifted in the test only. Live crew (derelict..stellar) unchanged.
- [ ] Warehouse: `warehouseRarityColor` returns `var(--item-rarity-*)`; new tokens in `:root` with today's exact defaults and cbsafe overrides in `[data-palette="cbsafe"]`; source test.
- [ ] Relic blanks (answer 10): `RELIC_BLANK_LADDER_I` is its own frozen table (today's four rows), no longer `SALVAGE_LOOT_POOLS.intactReactorCore`; relic goldens unchanged; a fifth salvage tier injected in a test changes no blank.
- [ ] Salvage ceiling: a fifth `SALVAGE_CEILING_THRESHOLDS` row `{ minFleetAdminLevel: 20 [PROVISIONAL], maxTierIndex: 4 }`, clamped to each pool's real top, so no live roll changes; test with a five-tier pool.
- [ ] Set shoutout: `setCompletionLines(prev, next)` reads `museumV2.setsCompleted` (and gear set first completions from RR-6) and the App logs each new completion once (the chat-event hook, relics plan call 16).
- [ ] Derelict unified (answer 9): one `isDerelictFloor` rule in the value readers; RESERVED Derelict pins move (named).
- [ ] Commit `fix(0.14.0): rarity traps (crew rows, warehouse tokens, relic blank ladder, salvage ceiling, set shoutout, Derelict floor) (RR-7)`.

### Slice RR-8: close-out

- [ ] Wiring registry: every new row live with a probe (no deferred row without a named owner); progress card counts the new system (33 total, capture doc).
- [ ] Holistic review against Review Focus 1 to 5; delta QA sheet (desktop and mobile: the Debug minter, a minted Luminous / Constellar / Nova / Celestial piece's tooltip, a set completing on a ship and a member, the warehouse in the cbsafe palette).
- [ ] Commit `docs(0.14.0): rarity readiness close-out (RR-8)`.

---

## Carry notes

(Each builder appends a short note under its slice here.)

**RR-0 (2026-10-23, on feat @ b579a1f):** `rarityGoldens.fixture.ts` + `rarityGoldens.test.ts`. 217 LIVE pins (60 generator
groups: 13 equipment slots with varieties plus weapon and drone, per live band; 71 inspect, 71 preview, 4 dev mint, primitives, readers,
load, relic blank weights, salvage ceiling) and 117 RESERVED pins (Derelict / Luminous / Constellar generators, the four
legendary x ascension sweeps, primitives at index 0 and 5, readers, dev mint, a load round trip of all 21 band and
ascension pairs, the mixed reveal sort). Every generator cell records its draw count. Mutation checks on the capture:
a Luminous affix-count change fails RESERVED only; an extra draw on Stellar (same lines) fails LIVE. Some preview pins
share a hash on purpose (same-tier weapons and drive classes preview identically). `RR_CAPTURE=<path>` re-captures.

**RR-1 (2026-10-23):** model.ts `isEquipmentRarity` / `isEquipmentAscension` (own-property checks, so "constructor" and
"__proto__" never pass), `normalizeEquipmentRarity` / `normalizeEquipmentAscension` (case and whitespace tolerant, else
`RARITY_LOAD_FALLBACK` [PROVISIONAL "standard"] / "none"), total `rarityIndex` (default 1), total `equipmentRarityLabel`,
finite-guarded `moduleEffectScale`; itemgen.ts `computeBudget` and `craftedDefensiveImplicit` read non-finite input as
0 / 0 / the Standard index (identity for finite input, same multiplication order), `affixCount` default = Standard (2,
zero draws); archive.ts `itemScore`, crewRarity.ts `crewRarityMultiplier` and relics.ts `relicStudyDurationTicks`
guarded (the last two read a FUNCTION off the prototype for "constructor", a NaN found while writing the tests).
save.ts `withNormalizedGearRaritiesV70` runs on every load right after the migration loop (state.equipment and an
in-flight run's frozen battle gear), identity on a clean save; SAVE_VERSION stays 70, no migration step. One existing
test updated on purpose: save.test.ts "preserves already-present equipment fields" hand-builds a piece with NO rarity
or ascension, which now loads as standard / none. `EQUIPMENT_ASCENSIONS` moved to RR-2 (its first reader). Goldens:
none moved (LIVE and RESERVED). Gates: 309 files / 8634 tests passed, check 0 errors.

**RR-2 (2026-10-23):** model.ts `EQUIPMENT_ASCENSIONS` (derived from the total ascension record) and
`ascensionAllowedFor` (a total `ASCENSION_BANDS` record: luminous and constellar only, design :149); devMint.ts
`DEV_MINT_RARITIES` (= `EQUIPMENT_RARITY_LADDER`, all seven bands), `DEV_MINT_ASCENSIONS`, `devMintAscension` (the
requested ascension on a legendary band, else "none"; junk never leaks), and an optional `ascension` arg on
`devMintFromBlueprint` (absent mints exactly what it did before). App.svelte Debug "Mint gear" row: the rarity select
lists every band by `equipmentRarityLabel`, a new Ascension select (None / Nova / Celestial) is disabled unless the band
allows one, the mint routes through `devMintAscension`, and the log line names a non-"none" ascension. Player paths
untouched: `PRODUCIBLE_EQUIPMENT_RARITIES` still Standard to Radiant (asserted), Fabricator mints still stamp "none".
Note for RR-4: a dev-minted Nova or Celestial piece carries the field but no reader acts on it until RR-4 wires the
budget, label and sort (the Debug minter is its only source, so nothing reaches a player meanwhile). Tests:
devMintLadder.test.ts (the rule, the lists, every band on three generators, the omitted-ascension identity, and an
App.svelte source test that the row reads the full lists inside the DEV_MODE Debug block). Goldens: none moved. Gates:
310 files / 8644 tests passed, check 0 errors.

**RR-0 to RR-2 review fixes (2026-10-23, on the RR-2 engine, before any RR-3 edit):** (1) LIVE values no longer hide in
RESERVED pins: new LIVE `reader:crew:derelict` (crew Derelict is a live crew band), `reader:sort:live` and
`reader:keepBest:live` (salvage.ts `autoSalvageIsBetter` exported for it); the RESERVED Derelict reader carries item
readers only. (2) Every RESERVED key starts with its owner slice(s) (`rr3:`, `rr4:`, `rr7:`, `rr3+rr4:`, `rr4+rr7:`);
the mixed `prim:*:reserved`, `load:all` and `reader:sort` pins are split by owner, and a test asserts every RESERVED key
names an owner and no LIVE key does. (6) Member slots mint off their real blueprint in the generator sweep (the crafted
member floor applies), and a vacuity test asserts every band but Derelict mints pieces with more than one rolled line.
Re-captured on the unchanged RR-2 engine: 220 LIVE / 124 RESERVED; every pin common to the old record is unchanged
except the member-slot generator pins (now with a blueprint key) and the per-band reader pins (field order), both
definition changes, not engine moves. (3) devMintLadder.test.ts searches the markup with comments stripped and checks
the row sits before the real Debug gate's closing `{/if}` (verified: removing `DEV_MODE` from the real gate fails it).
(4) `rarityIndex` and `affixCount` keep compile-time exhaustiveness (`const unhandled: never`) beside the runtime
fallback. (5) The RR-1 step text now says the normalization runs BEFORE `withStandardIssueMemberLinesV70` and names the
corrupt-save side effect. Plan: the RR-3 extras seed source is specified; the RR-5 unique-equipped rule is [PROPOSAL],
not built; the four design readings put to the user are marked.

**RR-3 (2026-10-23):** new leaf `rarityProfiles.ts` (imports model.ts only): `RARITY_PROFILES` (TOTAL over the ladder;
fields budgetMult, affixes, extraAffixChance, secondaries, artisanPermille), `rarityProfile` (unknown = the Standard
row), `RARITY_MULT` (moved from itemgen.ts, re-exported there), `LEGENDARY_BUDGET_STEP` [PROVISIONAL 1.2],
`SECONDARY_BUDGET_SHARE` [PROVISIONAL 0.15], `ARTISAN_CHANCE_PERMILLE` [PROVISIONAL 250], `ARTISAN_LINE_MULT`
[PROVISIONAL 1.25, the design's min / max folded into one multiplier, flagged], `RARITY_EXTRAS_SALT` (0x3e5a9c71,
registered in salts.test.ts). Live rows are DERIVED (`RARITY_MULT ** rarityIndex`), so the doubles are identical.
itemgen.ts: `rarityBudget` / `budgetAtMult` / `craftedDefensiveImplicitAt` (same multiplication order), `affixCount`
reads the row (exhaustiveness now lives in the total record), `rollRarityExtras` (Artisan first on one affix line, then
the secondaries, with replacement, never on the grenade carry line, added into rolledStats before the physicals fold;
ONE shared-stream draw after the picks seeds the salted stream, zero draws for any band without extras). All three
generators and `previewCraftOutcome` read the profile. Plan deviations: the interface's `extraSecondaryChance` is not
added (answer 6 gives Stellar / Radiant none, and no legendary row uses one), and the `legendaryAffix` / `setBonus` flags
arrive with RR-5 / RR-6, their first readers (no inert field). Registry: 7 `ship:RARITY_PROFILES:<band>` rows (catalogs.ts
enumerates them; panelOwnership.ts lists RARITY_PROFILES as content): live rows install the band's signature line and
move the sheet cargo EXACTLY by the implicit difference to the band below (linearAbsolute); the legendary rows install
the whole mint against Radiant (event, at least the implicit difference); Standard is the reference (notApplicable). The
older registry snapshot pins hold the new ids apart through `rarityRegistry.fixture.ts` RR_ADDED_ENTRY_IDS
(shortRangeGoldens RR_SLICE, emodGoldens filters). Goldens: LIVE none moved; RESERVED 93 moved, every one owned by
rr3 (30 `rr3:gen:*` Luminous / Constellar, 60 `rr3+rr4:gen:*` legendary x ascension, `rr3:devMint:luminous`,
`rr3:devMint:constellar`, `rr3+rr4:load:legendary`); the `rr3:prim:*` pins did not move (computeBudget and affixCount
values are unchanged at index 5). Gates: 311 files / 8664 tests passed, check 0 errors.

**RR-4 (2026-10-23):** new leaf `ascension.ts` (imports model.ts and rarityProfiles.ts): `ASCENSION_PRODUCIBLE = false`
(the switch, a [PROVISIONAL] reading: producibility only; listed in fieldRoles.ts UNREAD_CONSTANTS with its owner, the
later producer, since no player path mints an ascension and the test pins every tick.ts mint stamping "none"),
`NOVA_BUDGET_MULT` [PROVISIONAL 1.25], `CELESTIAL_BUDGET_MULT` [PROVISIONAL 1.4], the total `ASCENSION_BUDGET_MULT` and
`ASCENSION_EXTRAS` (Nova: guaranteed Artisan; Celestial: guaranteed Artisan plus one secondary [PROVISIONAL, put to the
user]), `effectiveAscension` (Luminous / Constellar only; a stray value reads "none" everywhere, never stripped),
`ascendedProfile` (returns the band's OWN row object for "none" and every stray value, so live mints are untouched),
`ascensionLabel` ("Nova Luminous", "Celestial Constellar"), `ascensionOrder`, `isCelestialPiece`. Wired: all three
generators roll by `ascendedProfile` (`rarityBudget` gained an optional ascension); `inspectSort.ts` ranks the ascension
right after the band; salvage.ts `autoSalvageIsBetter` compares it after band, before the id; a new auto-salvage
protection reason "celestial" (after "locked", before "graceWindow"; manual salvage stays allowed [PROPOSAL, put to the
user]) with its App.svelte sentence; EquipmentTooltip.svelte's grade text reads `ascensionLabel` (the same string as
before for every piece without a valid ascension; header text only). Registry: 3 `ship:ASCENSION_BUDGET_MULT:<asc>` rows
("none" the reference; Nova and Celestial install a Luminous cargo bay's signature line against the plain Luminous one,
the sheet cargo moving by EXACTLY the implicit difference, linearAbsolute), held apart from the old snapshot pins by
`rarityRegistry.fixture.ts`. One existing test updated on purpose: salvage.test.ts's declared protection order gains
"celestial". Goldens: LIVE none moved; RESERVED 63 moved, every one rr4-owned: the 60 `rr3+rr4:gen:*` legendary x
ascension pins, `rr3+rr4:load:legendary`, `rr4+rr7:reader:sort:all`, `rr4+rr7:reader:keepBest:all`;
`rr4:load:liveAscended` did NOT move (a stray ascension on a live band is ignored), which is the rule working. Gates:
312 files / 8677 tests passed, check 0 errors.

**RR-5 (2026-10-23):** new leaf `legendaryAffixes.ts`: `LUMINOUS_AFFIXES` (13 rows, names [PROPOSAL], listed in the RR-5
step above), `LEGENDARY_AFFIX_BUDGET_SHARE` [PROVISIONAL 0.25 of the piece's budget, added on top],
`LEGENDARY_AFFIX_EXCLUDED` (bridge, sensor, module, each with why; listed in UNREAD_CONSTANTS as bookkeeping),
`legendaryAffixesFor`, `legendaryAffixDef`. `RarityProfile.legendaryAffix` (Luminous only; Constellar untouched until
RR-6; an ascension keeps it). itemgen.ts `rollRarityExtras` draws the row LAST on the private extras stream (the Artisan
and secondary draws stay RR-3's; still one shared draw), adds `legendaryAffixLineValue` onto the row's stat line and
returns the id; all three generators stamp `EquipmentInstance.legendaryAffixId` (optional, additive, no migration). NO
per-ship or per-member limit ([PROPOSAL], not built; a test pins that two pieces with the same affix are allowed). The App
Debug mint log names the affix. Registry: 13 LUMINOUS_AFFIXES rows (9 ship, 4 away), each through its line's own seam
(LINE_SEAMS or gearSeam) evaluated at the row's value at the reference Luminous roll, exact curves; Transmuter's Seal
shares the material quality line's short-range out-of-scope reason. Goldens: the legendary pins were relabeled to their
real owners (Luminous `rr3+rr5` / `rr3+rr4+rr5`, Constellar `rr3+rr6` / `rr3+rr4+rr6`, `rr3+rr4+rr5+rr6:load:legendary`;
RESERVED_OWNER accepts rr3 to rr7). LIVE none moved; RESERVED 41 moved, every one rr5-owned: 39 Luminous generator pins
(13 families with an affix x none / Nova / Celestial; the bridge and sensor pins did not move),
`rr3+rr5:devMint:luminous`, `rr3+rr4+rr5+rr6:load:legendary`; no Constellar pin moved. Gates: 313 files / 8700 tests passed, check 0 errors.

**RR-3 / RR-4 review fixes (2026-10-23, after RR-5):** (1) `rollRarityExtras` takes a context (slot, variety statRatios,
base mass and draw): secondaries draw by pool weight x statRatios as integer weights on the extras stream, and neither a
secondary nor Artisan ever targets a mass / draw reduction the slot's base cannot absorb (bridge, quarters and sensor
have base mass 0; a Reactor Core draws 1), so no extra is thrown away on the mint's floor. A Luminous / Constellar BRIDGE
module's extras (and part of a QUARTERS module's) still ride crewEfficiency / crewStations, which nothing reads yet
(LINE_PENDING, WR-7 OC-D3): registered as the pending audit row `ship:audit:rrCrewModuleExtras` with that owner.
(2) `moduleEffectScale(rarity, quality, ascension = "none")` reads a TOTAL `MODULE_RARITY_FACTOR` (model.ts; Derelict to
Radiant the same expression as before, bit-identical; Luminous / Constellar = Radiant's x LEGENDARY_BUDGET_STEP, was one
more 12% step) and the ascension (x ASCENSION_BUDGET_MULT on a legendary only). `LEGENDARY_BUDGET_STEP`,
`NOVA_BUDGET_MULT`, `CELESTIAL_BUDGET_MULT` and `ASCENSION_BUDGET_MULT` moved to model.ts (rarityProfiles.ts and
ascension.ts re-export them: one source, no cycle). Every call site passes the piece's ascension (combat/bridge.ts,
crewModules.ts x3, expedition.ts, model.ts, sensorArrays.ts x3, tick.ts; a source test pins it). Registry: 7
`ship:MODULE_RARITY_FACTOR:<band>` rows and `ship:ASCENSION_BUDGET_MULT:<nova|celestial>:modules`, exact (a Utilitarian
Quarters module's bonusRelative on the unload speed). (3) The two legendary RARITY_PROFILES rows are now exact
(signature line, linearAbsolute) like the live rows; `rarityReviewFixes.test.ts` pins that a legendary weapon's lines
equal its picks plus `rollRarityExtras` on the next draw, exactly. Nits: stale computeBudget comments fixed and
computeBudget marked live-bands-only; the plan's ASCENSION_PRODUCIBLE wording fixed; ascension.test.ts also checks
model.ts and App.svelte stamps; `rarityProfiles.ts RARITY_EXTRAS_SALT` added to the salts.test.ts expected names.
Goldens: LIVE none moved; RESERVED 89 moved, every one rr3-owned (the legendary generator, dev mint and load pins, and
`rr3:prim:moduleScale:legendary`); no rr7 or rr4-only pin moved. Gates: 314 files / 8718 tests passed, check 0 errors.
