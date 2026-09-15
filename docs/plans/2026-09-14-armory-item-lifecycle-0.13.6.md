# 0.13.6 — The Item Lifecycle: Blanks, the Armory, and the Archive

**Status:** design locked 2026-09-14 (build plan). Consolidates the scattered notes in `SUGGESTIONS.md` (the "0.13.6 Item Lifecycle Rework" entry) into one buildable plan, and records every decision made in the 2026-09-14 design pass. This is the canonical plan; where it disagrees with older notes, this wins.

**One system, not four features.** Crafting stops producing finished instances. Instead it produces stackable **Blanks**; you **inspect** a blank to roll it into a real item (the **Rolled Pool**); a rolled item is **committed** into a loadout that lives in the **Armory**; and a copy of your best result can be enshrined in the **Archive** for completion. It is a lifecycle with stages, not parallel inventories.

---

## 1. The core: crafting produces Blanks

- **Today:** crafting rolls everything immediately and produces a unique instance that eats a warehouse slot. Nothing stacks, so storage grows without bound and auto-salvage exists mainly to relieve it.
- **Proposed:** crafting produces a **BLANK**. A blank is not instantiated, so every blank of a type is identical, so **blanks STACK like raw ore**: one icon, one count, one slot for a thousand.
- **Counts are Decimal**, riding the existing inventory machinery (the user expects millions), not a parallel structure.
- **Why it matters (the real point):** it removes the ceiling on banked attempts. Bank a million blanks, open them when you choose. The storage saving is a side effect; the completionist loop is the point.

## 2. Inspect: the roll becomes a player action

- You **inspect** a blank to **instantiate** it, performing the rolls from your crafting capabilities with the same odds as today. The result moves to the Rolled Pool.
- **Crafting level is read at INSPECT time, not craft time.** This keeps blanks fungible and stackable. Accepted, deliberate consequence: banking blanks early and opening them at a higher level is optimal, which is a fine idle shape (bank now, open stronger later) as long as it is a choice, not a surprise.
- **The grace period moves to instantiation.** 0.13.3.1 stamps the auto-salvage grace window at craft; here crafting makes a blank and the real item appears at inspect, so the safe window must start at inspect. Whoever builds this moves the stamp.

### 2a. The rolling seed (anti-save-scum foundation, build it with this release)

- Moving the roll to a player action opens save-scumming: inspect, dislike, reload, re-roll. localStorage makes that a two-second exploit that would hollow out the rarity ladder.
- **FIX: a rolling seed on `GameState` that advances per inspect.** Reload and the next roll is identical (the seed has not advanced), and stacks stay intact. Close the "inspect a different blank to redirect the roll" hole by deriving the roll from **the seed AND the item type**, so redirecting gains nothing.
- Must stay a **pure function of the save**, the same property offline-equals-live depends on.
- ⭐ This is not a stopgap. A roll derived deterministically from saved state is one a server can later **recompute and verify** rather than trust, so it is the foundation for the eventual online anti-cheat, and it is cheap (a seed field plus an advance). Build it now regardless of the online timeline. (User confirmed 2026-09-11 that scumming otherwise goes away at 0.14.0 server-load and 0.16.0 wipe, but the seed is worth building now.)

## 3. The lifecycle stages

1. **BLANKS** (unrolled) — stackable, fungible, warehouse-side. Crafting deposits here.
2. **ROLLED POOL** (instantiated, uncommitted) — one slot each (no two rolls are alike). **This is the existing Ship Systems warehouse tab, repurposed.** From here an item can be auto-salvaged (after grace), donated (future reputation, deferred), or committed to a loadout.
3. **ARMORY** (committed) — an item committed into a loadout lives there and is **removed from the warehouse**.

- ✅ **Auto-salvage shrinks to the Rolled Pool ONLY.** Blanks are unrolled so they are not salvage targets; Armory items are committed so they are protected by being in a loadout. Auto-salvage stops being a pressure valve on everything and becomes a curator of exactly one stage.

## 4. The Armory (loadout storage)

The facility that holds committed gear, as **loadouts**. A loadout is a full ship's worth of equipment.

- **Where a committed item lives:** in its loadout. If the loadout is **checked out** to a ship, its items are equipped to that ship; otherwise it rests in the Armory and takes **no warehouse space**. Committed gear is never in the warehouse. There is **no separate "personal"/"loadout storage" container**: loadouts are the storage, and you browse loadouts to see committed gear.
- **A loadout is pinned to a SHIP TYPE.** That single choice sets the loadout's slots: the normal ship slots, the specialty-utility slot if that hull has one, and exactly that hull's hardpoints. Captain spec is deliberately NOT a loadout dimension (it affects a captain's bonuses, not a ship's slot layout). Because a loadout exposes only its hull's slots, you can never over-arm it; an unfilled hardpoint simply stays empty.
- **Count: a flat pool of 25 loadout slots**, spent however the player likes (25 destroyer builds is allowed). **More come from talents.** The 25 is a single tunable number, **derived, never hardcoded** (see the content-driven rule); future ship types do not change it, and unlocking loadout-count talents raises it.
- **Capacity is emergent:** total Armory item capacity is the sum of each loadout's chosen-hull slot count, so there is no fixed ceiling to reason about, and a carrier loadout naturally holds more than a freighter loadout.
- **A possible "armory loadout tool":** in lore, a system that auto-swaps your equipment while docked. Optional flavor; not load-bearing.
- **Away-team (crew) loadouts** follow the same shape later, pinned to a crew type instead of a ship type. (Crew is 0.15.0; log the parallel now.)
- ⚠️ **Checked-out slot when a ship is SALVAGED:** the slot releases and its gear returns to the Rolled Pool. **HARD INVARIANT: the release is atomic** so the gear can neither be lost nor duplicated (the user's explicit condition). Never leave an orphaned binding, never drop gear silently (the never-silently-delete rule).

### 4a. Favorite and Lock (two separate controls, Rolled Pool)

- **FAVORITE** is organizational only: moves the item to the TOP of the ship-systems warehouse, shows a star icon (SVG graphic soon).
- **LOCK** is hard protection: the item cannot be salvaged, sold, destroyed, or augmented (any future "reworking") in any way. Shows a lock icon on the tile and in the tooltip. Star + lock means pinned to the top and uneditable until unlocked.
- ⚠️ **LOCK ALSO APPLIES TO SHIPS:** a locked ship cannot be salvaged, sold, or altered.
- **Auto-salvage skips BOTH favorited and locked items**, so nothing anyone favorited for safety under the old (0.13.3.1) behavior becomes eligible when this ships. Lock is the hard guarantee; favorite keeps its soft auto-salvage exemption for continuity.

## 5. The Archive (completion display; formerly "Museum")

A completionist display of your finest work, graded. Not storage. Likely the future home of achievements and completion tracking.

- **One slot per craftable item**, derived from the item table (never a hardcoded list).
- **Slotting CONSUMES the item.** The Archive records a SCORE, not a live instance, so nothing has to be kept alive in the save or database. A better craft later simply overwrites the score. Enshrinement is permanent, not a loan.
- **Score = (rarityIndex + 1) x (qualityIndex + 1) x iLevel x 10** (the 1-indexed form, so a Q0/derelict item scores something instead of a broken-looking zero). Rolls and durability deliberately do not count.
- **The completion denominator is the ABSOLUTE tier ceiling**, not the player's current crafting cap, so completion percentage moves as you COLLECT, not as you LEVEL.
- **Luminous and constellar score identically** (they share a rarity index; deliberate parallel flavors). Accepted: they are lateral variants with different reasons to hold them, and both climb to higher rarities over time.

## 6. Data-model discipline (applies throughout)

- **Content-driven UI:** new content appears by being added to DATA, never by editing UI. Loadout count, Archive slots, and everything else derive from the data (`SHIP_TYPES`, the item table, spec counts) or fail to compile.
- **Exhaustive `Record`s over unions** are the enforcement (as with `QUEUE_ADAPTERS`, `PROCESS_XP_AWARDS`, the protection-reason record, `IconName`). A new rarity, hull, item, or process kind must be a build failure if unanswered, not a silently missing option.

## 7. Build sequence (phased; may span the release)

1. **Blanks** — crafting outputs stackable Decimal blanks; inventory + UI integration; the rolled-vs-blank split in the warehouse.
2. **Inspect + rolling seed** — the inspect action instantiates a blank; the seed on GameState (derive from seed + item type); move the grace stamp to instantiation; auto-salvage narrows to the Rolled Pool.
3. **The Armory** — the facility; the 25-loadout flat pool pinned to ship types; commit / check-out / release (atomic); capacity from data; favorite + lock (incl. ships); the auto-salvage favorite+lock skip.
4. **The Archive** — the per-item display from the item table; consume-and-score; the 1-indexed formula against the absolute ceiling; completion percentage.

⚠️ This is large; the user has said it "earns its own release." Expect it to fill 0.13.6, and be willing to split a phase into a point release if scope demands.

## 7a. Phase 1 build state + the flip's turnkey implementation

**✅ Increment 1 (DONE, gated, committed local on `feat/item-lifecycle-0.13.6`):** the dormant foundation. `GameState.blanks: Record<string, Decimal>` + `GameState.inspectSeed: number`, freshState seeds, `save.ts` SAVE_VERSION 48->49 + `MIGRATIONS[48]` backfill + `hydrateDecimals` revives blank counts. Changes no behavior. 2751 tests green.

**⏭ Increment 2 (NEXT, the craft->blank + inspect FLIP). PARITY-CRITICAL, do as a focused pass.** Every seam is located:

- **Craft stops rolling.** `startFabricateLine`/fabricate effect selection at `tick.ts:9586-9589` currently picks `{type:"addEquipment", blueprintKey}` for `blueprintMintsEquipmentInstance(bp)`. Change that to a NEW effect `{type:"addBlank", blueprintKey}`.
- **New `ProcessEffect` `addBlank`.** It is an exhaustive union, so the compiler will force handling in every switch: `completionYieldFor` (tick.ts ~1264, add a "blanks"/subject case), the apply switch (below), and any policy/reward Record. That is the content-driven safety net working as intended.
- **Apply handler for `addBlank`:** increment `state.blanks[blueprintKey]` by 1. **Draws NO rng.** This is the key parity consequence: equipment completions no longer draw from the tick's threaded stream, which SIMPLIFIES parity (fewer draws) but CHANGES the post-state of any offline==live fixture that crafted equipment (now a blank, not an instance). Update those fixtures.
- **Relocate the mint into `inspectBlank(state, blueprintKey)`.** Move the mint logic verbatim from the `addEquipment` apply branch (`tick.ts:10400-10560`, the equipment/weapon/drone trichotomy) into a new player-action function. Changes from the original:
  - **rng source:** NOT the tick's threaded rng. Build `const rng = makeRng(inspectRollSeed(state.inspectSeed, blueprintKey))` where `makeRng` is `src/lib/game/combat/rng.ts:151` and `inspectRollSeed` hashes `inspectSeed` together with the `blueprintKey`. Deriving from BOTH the seed AND the item type is what closes the "reload and inspect a DIFFERENT blank to redirect the roll" hole (design section 2a): a given blank at a given seed always rolls the same thing, and switching which blank you open first cannot launder the seed toward a better item.
  - **draw order UNCHANGED:** `rollQuality(rng)` #1, `rollCraftedRarity(rng)` #2, then `generate{Equipment,Weapon,DronePod}(..., rng)` #3.., so the roll DISTRIBUTION is identical to today, only the rng SOURCE moved.
  - **crafting level read AT INSPECT** (`state.craftingLevel` at inspect time), per the locked design.
  - **grace stamp stays** (`startAutoSalvageGrace(minted, state.gameTimeSeconds)`), now firing at inspect = the design's "grace moves to instantiation."
  - consume 1 blank, push the instance to `state.equipment`, advance `nextEquipmentId`, and advance `inspectSeed` by 1 (only on a committed inspect, so a reload before inspecting re-rolls identically).
- **Auto-salvage:** it scans `state.equipment` spares, and blanks live in `state.blanks`, so blanks are already outside its reach (verify, likely a no-op) = the "auto-salvage shrinks to the rolled pool" outcome for free.
- **UI (App.svelte):** a Blanks view in the Ship Systems warehouse (list `state.blanks` keyed by blueprint, name via `BLUEPRINTS[key]`, count) + an Inspect action per blank that dispatches `inspectBlank`; the rolled instance then appears in the existing Ship Systems (rolled-pool) tab.
- **TEST STRATEGY (wide, delicate):** (a) every crafting-completion test asserting an `EquipmentInstance` appears on fabricate completion flips to asserting `blanks[key]` incremented and NO instance; (b) new tests: `inspectBlank` mints + consumes a blank + advances the seed; reload-determinism (same seed -> same roll); redirect-proof (re-inspecting the same blank after a seed-preserving reload is identical; a different blueprint differs); grace stamped at inspect; (c) the offline==live parity fixtures that crafted equipment get their expected post-state updated to blanks. The itemgen anti-drift tests are UNAFFECTED (`generate*` unchanged).
- ⚠️ Keep it LOCAL until the UI lands (a blank with no inspect UI is a non-functional craft); push to staging only once craft->blank->inspect->gear works end to end.

## 8. Deferred / open

- **Donation** to a future reputation system: named only, not this release.
- **Dedicated salvage lane for equippable gear:** logged for the exploration patch or a release between 0.14.0 and 0.15.0 (note: equipment salvage is ALREADY timed/queued since 0.13.3; only the dedicated lane is new).
- **Save-scum window before 0.14.0:** one release exists where the exploit is live; single-player with no leaderboards makes it mostly self-harm, but 0.14.0's one-time local-save import means a scummed inventory could carry into the online era until the 0.16.0 wipe. Accepted by the user; the rolling seed narrows it.
- **The Archive as an achievements hub:** the user floated it; revisit when achievements are designed.
