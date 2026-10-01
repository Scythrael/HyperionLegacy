# Planned Features Inventory

**Snapshot:** 2026-09-30, branch `feat/crew-0.14.0` @ `43d822b` (prod = 0.13.8).
**Why this exists:** twice now a planned system was compressed while being consolidated into a design doc, and the build followed the compressed doc. Both times the user had to point it out after code shipped: the 0.11.2 shell, then the 0.14.0 away-team roster, which shipped as anonymous per-battle members. This file is the ledger of everything the planning record says should exist, checked against the code.

**Method:** six parallel reviewers read every planning source and verified each item against `src/`, one slice of the corpus each:

| Slice | Sources |
|---|---|
| 1 | `SUGGESTIONS.md` lines 1-650 |
| 2 | `SUGGESTIONS.md` lines 650-1305 |
| 3 | `SUGGESTIONS.md` tail, `KNOWN_ISSUES.md`, `SESSION_HANDOFF.md` |
| 4 | the three 0.14.0 docs (saga design, crew plan, exploration plan), the 2.0 doc, master design, tech spec, lore |
| 5 | July 2026 plans |
| 6 | Aug-Sep 2026 plans, audit, QA and patch-note docs |

The full row-level tables (about 860 rows, each with source file:line, target release, doc status, code status, flag and evidence) are in [`docs/inventory/2026-09-30/`](inventory/2026-09-30/). The row IDs below (S4-CP12, AR-10, ...) point into those tables.

**Flags:**
- **GAP:** planned and locked, not built, and no phase owns it.
- **DRIFT:** built or documented differently from the plan, with no recorded user decision.
- **DECIDE:** open question or contradiction that only the user can settle.
- **STALE:** the tracking text is wrong; the code already moved on.

Most rows (about 75%) are OK: built as planned, or superseded by a recorded decision.

---

## How to keep this from happening again (proposed process)

1. **Carry list per phase.** Before writing a phase plan, grep this inventory, `SUGGESTIONS.md` and older plan docs for the system's keywords **and synonyms**. Copy every hit into the phase plan under a "Carried items" heading, by row ID.
2. **No silent compression.** Any deferral, simplification or reinterpretation of a carried item needs a user decision. Record it in the plan's DECISIONS section with the date, then update the row here. An option that defers something already planned is never presented as neutral.
3. **Phase "done" means every carried row is resolved:** BUILT, or deferred by a recorded decision. Phase completion commits cite the row IDs they close.
4. **Re-inventory at each release gate,** before promotion, as a delta against this snapshot.
5. **No dormant player-visible effects.** A bonus a player can roll or see must either do something or be marked as inactive in the UI. Section A2 shows why: 11 of 16 officer bonuses currently do nothing. This is a proposal, so the user decides.

---

## A. Gaps inside 0.14.0 (the active release)

### A1. Away-team roster: older locked details the rework must carry
The roster itself is recorded (exploration plan "THE AWAY TEAM ROSTER"). These earlier details already answer several items on its OPEN list:

| Row | Detail | Source |
|---|---|---|
| S4-C06 | Ground crews are obtained **like Senior Staff**: an hourly-refresh candidate roster, fireable | saga C.0 (2026-09-17) |
| S4-C11 | Slot counts were locked per TEAM: Science 1 weapon + 4 tools; Security 2 weapons (long + short) + 2 tools; Armor per team. The 2026-10-01 plan moves gear to per-member, so the counts need re-confirming | saga :228-231 |
| S4-C12 | Tools tune to **planet type**; combat tools include an **encounter-rate dial** | saga :219-228 |
| S4-C09 | Gambits are **per-member** rules. Code has account-wide programs per role | saga :212-214 |
| S4-I19 | Higher-tier ships carry **multiple teams**, so tasks run simultaneously | saga :538-539 |
| S2-43 | **One shared loadout family** across Away Missions, Landing Party and Invasion | SUGG :1020-1032 |
| S79 | What happens to a dismissed or fallen member's **gear and implants**, plus Armory away-team loadouts with the same capacity derivation | SUGG :1736-1745 |
| S94 | The Quartermaster **free baseline** covers ground teams too ("every crewman takes the same baseline"), so there is no softlock once gear matters | SUGG :1810 |
| S4-D05 | DECIDE: away team as a separate roster vs drawn from ship crew. The 2026-10-01 answer was a separate named roster; the saga text still says "from SUGGESTIONS" | saga :367-368 |

### A2. Crew systems that exist on screen but do nothing (verified in code)
- **S4-CP12:** **11 of 16 Senior Staff bonus stats are dormant** (`crewOverlay.ts:85-95`). Both Tactical bonuses, Discovery Instinct, Fleet Triage, Rapid Recovery, Command Presence, Morale Anchor, Evasive Command, Reactor Overdrive and both "any" bonuses roll and display but change nothing. A Tactical officer contributes zero.
- **S4-CP04 / CP05:** the Complement buff pools for Security, Science, Medical, Flight Deck and Engineering, plus the second-level-exclusive pool, are **no-ops**. Exploration now provides consumers for several of them (fieldwork, rare finds, triage).
- **S4-C24:** **Notable crew can never be created.** Nothing ever adds to `notableCrew`. The Complement panel tells players to "graduate" standouts with no way to do it. Sort and mass-action are also missing.
- **S4-C18:** Complement **Active mode** only freezes the crew; the player cannot assign anyone.
- Smaller crew gaps:
  - S4-C25: lazy manifest view.
  - S1-62: crew allocation does not lock at mission start.
  - S4-CP16: no upgrade raises the candidate roster size.
  - S4-CP19: soft captain level cap.
  - S4-CP20: warning before the final (5th) retirement.
  - S4-CP21: Hall of Command honor.
  - S4-CP38: load a roster from the ship's personnel screen.
  - S4-CP39: the linked Armory loadout does not travel with the roster.
  - S4-CP36: player graph-palette option.
  - S4-C03: some officer skills should roll far rarer than others.
- **Crew size and shape:**
  - S1-04 / S4-C19 / C26 / CP08: the command structure is **per spec, not per hull**. Every explorer caps at 750, so Eir = Orion = Aurora.
  - The **1,017-crew explorer flagship** and the "explorers in the thousands" band are not built and no phase owns them.
- **S1-68 / S4-C33:** officer stats (Strength / Integrity / Cunning / Constitution), traits, stations, the **Recruiter's Office**, and weapon-type specialization were dropped without a record. Officers have 2 rolled bonuses plus a racial.

### A3. Crew modules cannot be obtained (S4-CP23)
Bridge (3) and Quarters (9) module catalogs and effects are built, but **no blueprint mints them and there is no install tile**. This also blocks S4-CP17: officer power keying off hull stats only works through the Focused Command bridge module.

### A4. Exploration and reach
- **E0 was committed as done without:**
  - **S4-A03:** the shared power / mass budget trade between reach and weapons, shields, cargo and sensors. The helpers exist but only tests call them.
  - **S4-A05:** deuterium as the crafting input for reach. `deuteriumIce` is sell-only, and its hint still says to refine it at the Fuel Depot.
  - **S4-B04:** high base sensors on explorer hulls. There is no sensors field on the hull.
- **S4-C15 / C16:** reach never touches expeditions. Expeditions have one fixed transit time, no distance or difficulty tiers, no multi-day runs, and **no recall**.
- **S4-I20:** the player cannot choose which activities to run; every discovered activity auto-runs.
- **S4-I18:** there are no enemy-drop or random-event drop layers; every task forces a battle.
- **S2-65:** **persistent per-planet completion %** (+0.002% per survey) was meant to gate relic rarity (uncommon at 35%, rare at 75%) with a per-type cap. The E4 decisions say "the union, nothing dropped", but this layer is missing.
- **S4-E05:** explorer hulls were meant to be **found in the field** (an E0 code comment points to E4). E4 omits it.
- **S4-I08:** the transport supply run only spends credits. The crafted-supplies loop is not built.
- **S4-B02:** explorer weapons were meant to be utility/science ("phaser as drill"). Explorers get a default autocannon.

### A5. Sensors
- **S4-I12:** **no early sensor path.** The Wide-Beam, Focused-Beam and Balanced arrays have no blueprint. The only sensor blueprint is the relic-gated Bio-Resonance Array, so new players cannot get sensors or reach the expedition foreknowledge threshold.
- **S4-I29 / I30 / I31:** none of these sensor roles is built, and no phase owns them:
  - frontier gating
  - day-one combat cloak and threat detection in patrols
  - Science officers and the Science division amplifying sensors

### A6. Captain identity (E-CAP) is missing its foundation
- **S4-EX30 / S4-MD13 / S1-23:** **there is no achievement system at all.** E-CAP needs a Personnel achievement tier, and no phase builds the framework.
- **S19:** the **milestone ledger** (append-only, so achievements complete retroactively) was user-confirmed for 0.14.0 and is in neither plan.
- **S1-22:** the medals details dropped in compression:
  - limited active-bonus slots
  - the medals-rack display
  - the open question of whether medals survive the founder wipe
- **S4-CP47:** the captain racial bonus is not applied.
- **S2-28 note:** the tier-locked commendation currency is not carried into E-CAP.

### A7. Item provenance (online seam)
- **S02 / S100:** there is no item `origin` field (SUGGESTIONS :1832 wrongly calls it an existing seam).
- **S03:** the `signature` "bones" are not built either.

Either way, 0.14.0 is adding new item classes with no provenance: relics, implants, the unique Neural Backup, and ground gear. See D1 for the roadmap question this depends on.

### A8. In-game Help
- **FR-6 / S1-35:** the `fuel` Help topic **is wrong in prod**. It describes the Fuel Depot, credit auto-buy and the top-bar fuel gauge, all retired in 0.13.6 (`helpTopics.ts:159`).
- The Homeworld topic still lists the Fuel Depot.
- There are no topics for Senior Staff, Complement, rosters, surveys, transports, expeditions, gambits or relics.

---

## B. Shipped releases with missing pieces

| ID | Item | Promised in | Notes |
|---|---|---|---|
| AR-10 / S82 | **Ship lock** (a locked ship cannot be salvaged, sold or altered); lock and favorite on loadouts | 0.13.6 (locked) | Not built, no deferral recorded |
| S46 / PR-20 / SH02 | **Emoji to SVG sweep**: credits sigil (17 sites), padlocks (the user's own example; the 0.13.6 Lock UI added more), stopwatch, check, facility glyphs, the 5 Home glyphs | 0.13.5 (user ruling D8) | The 0.14.0 plan only covers the equipment-icon pass |
| S48 | Accessible labels on icon-only tiles | 0.13.5, moved to 0.13.6 | Not built |
| S57 / PR-23 | Colon house style for progress rows ("Docking Bay: Slot Expansion") | 0.13.5 (user decision) | Silently dropped |
| S65 | Visible button for every tap-the-text control (**ship rename** was the headline example) | 0.13.5 | Captain rename fixed, ship rename not |
| S64 | Auto-salvage rules reachable from the Salvage Bay too ("also, not instead") | 0.13.5 | Rules were moved, not mirrored; `jumpToSalvageRules` is never called |
| S2-97 | Ships "No ships match" empty state styled success-green | flagged 2026-09-01 | Small bug |
| S2-56 | Renamed ships still show captain + hull class in the combat view | combat polish | Small |
| S2-49 | Shipyard: a hull's default stats beside Build | 0.13.2 | Only cargo + spec shown |
| S108 | System tabs: About goes last | 0.13.5 era | Not done |
| S45 | rgba to color-mix tint sweep | 0.13.5 | Partial |
| IN-5 | Captain cap to 10 (7 more `unlockCaptainSlot` nodes) | 0.13.4 ("logged as its own work") | The berth track and the "Coming soon" slots assume it |
| S80 | Bigger Ship Systems storage once the Armory absorbs committed gear | 0.13.6 | Ladder unchanged |
| S2-36 | Queue **facility upgrades** (the user's rule: "queues are universal") | post-0.13.3 | Engine ready, no UI, no owner |
| S2-59 | **Free Pride themes** (Trans, LGBT) | user value, no release | Theme system ready |
| S1-46 | Facility explainer text moved into one `?` help per facility | 0.13.6 | Only Salvage Bay + Shipyard done |
| S1-44 | Captain pickers show Level; matching empty-state wording; lock cue on tier buttons | QoL batch | User never assigned a batch |
| AR-6 | More Armory loadouts unlocked by talents | 0.13.6 design | Flat 25 stub |
| PR-24, PR-25, S24 | Tick-bar pulse style; about 45 internal "fitting" comments; baseline-label alignment (dev only) | various | Low |

---

## C. Built or documented differently, with no recorded decision (ratify or revert)

| ID | What the plan said | What exists |
|---|---|---|
| AR-11 | Auto-salvage skips favorited **and** locked items | Favorite is display-only; only Lock protects. Old favorites were migrated to locks |
| AR-8 | A salvaged ship's loadout gear returns to the rolled pool | The loadout auto-checks-in and the gear stays committed (safe, but different) |
| S01 / S2-87 | Tooltips: 6 templates (Compact / Normal / Verbose x desktop / mobile) + two density options | 3 role templates, no density setting |
| S2-113 | iLevel: the crafting level sets a cap, the item rolls within a range, a talent narrows it | Still `min(level + boosts, tierCap)` |
| S4-EX08 | The gambit resolver reuses `combat/` (no second battle engine) | `gambit.ts` is a separate engine |
| IN-8 / IN-9 | One completion-log entry per order; the migration converts lines to orders | Logs one per lane; the migration seeds without converting (implementer's call) |
| S54 | Mystery repairable components: per-source variants, exclusive / unique bands, set iLevel, pity floor | E-MOD keeps only "repair, chance at an exclusive module" |
| S4-MD07 | Master design: relics unique and non-farmable | Relics stack as Museum copies (the user approved the Museum, so likely a doc fix) |
| S4-MD08 / S2-07 | Cybernetics on captains (master design) / on crew for ship bonuses (2026-07-09) | Revived 2026-10-01 for away-team members; the **crew plan still calls it the conscious cut** |
| S4-T02 | "The incident" story intro in 0.14.0 (2.0 doc) | The I.7 roadmap puts storytelling in 0.15.0 |
| S4-I05 | Endless mode considered for 0.14.x | The master design rejected an endless game |
| S2-45 | Home "game news" strip | Dropped from the 0.13.1 spec without a note |

---

## D. Decisions owed (grouped by topic)

**D1. Roadmap and online (blocks several others)**
- S112: the saga header puts accounts at 0.15.1 and online at 0.16.0; its own I.7 roadmap puts online in 0.14.x. These depend on the answer:
  - S21: retarget the privacy / legal launch gate.
  - S03: crypto "bones" now or with online.
  - KI73 / S4-TS14: the `user_id` retrofit that was promised "at the next SAVE_VERSION bump".
  - KI64: a downgrade guard for future-version saves.
  - S2-86: the dev-panel spin-out.

**D2. Fuel and reach**
- S4-A02: delete the vestigial fuel economy?
- S1-58 / S4-A06 / KI37: multiple fuel types vs drive-tech tiers, and the fuel-refill consumable.
- S4-A07: auto fuel gathering becomes deuterium sourcing.
- S4-A08: round-trip vs stranding.
- S4-A04: the relativity curve.
- S4-A10: maneuverability.
- S4-B05: power allocation as a preset vs active reroute.
- S12: split FTL / fuel / range into a universal band (needs a band name).

**D3. Hulls, crew and missions**
- S4-B07: the full hull roster.
- S4-C01: the ground crews' home slot.
- S4-C07: boarding party.
- S4-CP24: 3 vs 9 bridge modules.
- S4-CP26: quarters morale and attrition.
- S2-09: ship max capacity, passengers, and evacuation / colony missions.
- S4-I09: prisoner transport.
- S1-88: **captain death / ship loss.** The notes contradict each other: "explicitly does NOT want captain death" vs a planned prerequisite vs 2.0 high-difficulty death.
- S4-EX28: should E-CAP / E-MOD land earlier?
- S2-17: name the remaining 6 Spec Utility roles.
- S4-D06: Leviathans (sensors flag them in I.6 and a Leviathan Scale relic exists).
- S1-10: capture the MAGIC crew member idea against the rarity axis.
- S4-L06: confirm the "Scythrael" callsign.

**D4. Systems and UI**
- Achievements and compendium:
  - S4-MD13: achievements framework scope (needed for E-CAP).
  - S4-MD14: compendium.
  - S4-TS07: capability gates (a natural fit for frontier and hazard gating).
- S4-MD00: retire, annotate or reconcile the master design + tech spec, which have not been updated since the build began.
- Items and crafting:
  - S2-30: "ever owned" vs "currently own" completion.
  - S2-116: the cascading rarity model.
  - S1-89: the loot-rarity range rework.
  - S5-016: the July Energy resource (keep or cut).
  - CR-13: retune CRAFT_XP when tier-3 blueprints land.
  - CR-5: salvage XP was shipped on my recommendation and never ruled on.
- Equipment and ships:
  - S2-111: auto-unequip at drydock.
  - ST-7: ship favorites are stored per device, equipment favorites in the save.
  - CD-9 / CD-10: random and special per-ship innates.
- UI and presentation:
  - S2-01 / S2-02: console fades and glows as free base UX or paid cosmetics.
  - S1-53: uniform tiles.
  - S2-93: Ships roster shows condensed vs specific activity.
  - S2-98: amber meaning several things, plus other UI-checkpoint leftovers.
  - S2-72: per-item material icons.
  - S98: `data-tour` anchors while 0.14.0 adds screens.
  - PR-5: batch-confirm and no-grace-warning toggles.
  - HD-6 / HD-9: Home inline setup and richer activity detail.
- Game rename and events:
  - S08: rename the game to "The First Cause" (target 0.13.1 passed, and the folder question is open).
  - S41: Unscannable Vessel reward model.
- Throughput and facilities:
  - S53: Shipyard construction vs repair berths.
  - S91: terminal lane track + salvage speed talents.
  - IN-13: Salvage Bay throughput.
  - S2-71: offline bonus-tick pool.
- Other:
  - S4-CP45: fleet fabrication perks.
  - S4-I06: a balancing meta tool.
  - S4-MD09: two-tier prestige.
  - S4-T06 / T11: 2.0 open forks.

---

## E. Stale tracking (doc-only cleanup, no decision needed)

- `KNOWN_ISSUES.md`: **45 entries are already fixed or superseded** (slice 3 STALE rows). Examples: focus traps, theme starfield, orphaned CSS, live-loop unification, the combat cooldown burst, intra-tick liveness.
- `SESSION_HANDOFF.md` is three releases old (it still says 0.13.4 prod / SAVE_VERSION 48).
- `SUGGESTIONS.md:1384`: the reactor gate is still listed as "pending" (it was decided patrol-only).
- The 0.13.4 design and plan still say "Transit Berth" (renamed Docking Bays).
- Saga :599 still says fuel-to-reach is "not a 0.13.6 stopgap" (it shipped in 0.13.6).
- Crew plan:
  - :34-37 still lists cybernetics as cut.
  - :153 says the retirement boost is multiplicative (the code is additive, per the scaling rule).
  - :361-363 mandates separate view layers (the user chose one DOM on 2026-09-25).
- 0.13.5 QA sheets I2 / M2 say existing ships were not auto-filled. The F5 migration did fill their weapons.
