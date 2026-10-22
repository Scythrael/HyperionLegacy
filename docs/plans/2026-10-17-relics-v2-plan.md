# G3 "Relics v2" (0.14.0): PLAN

Status: PLAN for user review (2026-10-17). Doc only; no game code. Every name and number marked **[PROPOSAL]** is
mine and is the user's to accept, rename or reject. Mockup: `relics-v2-mockup.html` (scratchpad, 2026-10-09; its ten
open calls were never answered, so they are carried into section 5 below, merged with the calls this plan adds).
Branch `feat/crew-0.14.0`. Build order slot: after G2 expedition tiers and the gas giant study (15b), per the E-CREW
plan's 0.14.0 build order (`2026-10-02-crew-made-real-e-crew-plan.md` line 50).

Text rules for every slice: US English; no em dashes and no double hyphens; "install", never "fit"; "objective" in
player text; Roman numerals for every tier shown in the game; every graphic is SVG in `icons.ts` / `relicIcons.ts`
with `ICON_SEMANTICS`; the First Cause antagonists (DBDs) are never named in game, and no culture is ever them; the
Intact Data Core's easter-egg flavor line is never quoted, changed, or mentioned in patch notes or Discord.

## 1. The user's words (verbatim, with citations)

**1.1 The relics v2 datadump** (`2026-10-09-relics-v2-and-expedition-tiers-capture.md` lines 8 to 34; also the raw
chat message of 2026-10-09 20:53 UTC, which opens "Scope flag: What about if we handle it differently then? Actually,
this is a rock-solid way to handle it. Maybe. But it may be a bit of a redesign."):

> "Relics are basically blanks. Blanks of different rarity tiers and different tiers. Discovered and added to a pile.
> Different rarities. Unidentified Relics as the row in warehouse. When these are revealed through a research tab
> building, they are revealed as a general relic that falls within a number of buckets. Let's say 4 of each rarity up
> to radiant. However, (since they're mixed together by type. Perhaps a specific relic grouping. Groupings that might
> be common/uncommon/rare/extremely rare at archaelogical digs and so forth. Those then make up the general artifacts.
> (If we need more than 4 or more commons and less of other rarities, this is fine). All tiers that roll as the
> general relics will have different roll chances for the more lucrative options. If there are 16 standard relics,
> you have a chance to get one of any of those 16 relics, some far less than others. However, when you roll them, you
> have a rare chance to reveal an exceptional relic. Each tier has its own sets to find, and they are unique. Then
> from there the same set bonus and stat boost applies. However, since these don't stack with each other, make the
> stats each one gives pretty significant and the full set bonus a massive boost."

> "T1 of each would have their chances with the weakest commons as the highest tiers. Only has 1 or 2 bonuses to
> unlock, and the chance to unlock them is incredibly rare. If the flagging for a chat event is in the game yet (or
> you're keeping track) completing any set bonus should deserve a shoutout in the system chat."

> "T2 would have slightly higher roll chances for better relics, and its own relic tiers. All the way up to the
> highest tier available for unlockable long-range expeditions. Relics can drop from the shorter missions of course,
> but they won't drop as often. Incentive to clear long-range expeditions. That way, you can just keep gaining more
> and more relics. Relics might be an infinite system that have a special soft cap that stop impacting you when
> you're not in endless mode. We will have to balance where that is at. If you cap at 1000, the stats stop effecting
> the actual regular game to maintain balance, but your relic cap is unlimited and you can collect more, and that
> balance only affects you in endless mode. Plus, when you break that cap? You get an entirely new set of bonuses on
> that line that show up for endless mode only. Even if they're completely different. That way, it keeps lower level
> content relevant. So you might find yourself going back to farm a T3 mission in endgame because the relics that
> drop are incredible. Also, this would be a good option to impact with diminishing returns. That way, there's
> incentive to push low level stuff, but eventually, it's more worthwhile to move elsewhere."

**1.2 Ancient races and revealed names** (`2026-10-08-gas-giant-study-design.md` lines 50 to 58, user 2026-10-09):

> "with jump gates not going to every place, a lot of planets are unexplored. So we will want to have plenty of
> different ancient races. That as we learn more and more about them, we might change the names of artifacts. So at
> first it might be \"Relic Sample A34\" or something and as you get more lore and discoveries about the race that
> lived on that planet, the name will appear when the research into that culture identifies what the object is.
> Because there could be millions of different races that died out before humanity. But some of these relics would
> match the current pool. So one race relic type should be able to match up with another. Because most races will
> have their own version of a given thing. If it's a pottery shard, all races will have some form of pottery shard.
> Something like that. So that way, we're not pushing more unnecessary relic sets. Unless we should have more."

The ONLY names the user has given in this area: the warehouse row "Unidentified Relics", the placeholder form
"Relic Sample A34", the example type "pottery shard", and (2026-10-01, the approved Relic Museum mockup, "10/10, make
it so") the four sets and 17 relics in `relics.ts`, including the word "Precursor". No culture name, exceptional set
or exceptional piece name has been given. Everything else here is **[PROPOSAL]**.

**1.3 Research data and the ancient-race lab tab** (gas giant design lines 17 to 19 and 33 to 39):

> "different types of research data that can bestow research progress. Full on specific research data types. Plus
> some that can be fed into another tab within the research lab that would be used for studying data from an ancient
> race that can lead to special crafting blueprints being unlocked."

**1.4 Expedition tiers** (capture lines 90 to 91 and 115 to 117; G2 plan line 462):
- Relic odds (G2 call 9): "somewhere in the realm between \"don't give away the house\" and \"don't make this system
  feel like a chore, and reward the player enough to keep them coming back for more\"."
- 100% reward (G2 call 11): "based on the tier you get a roll with certain benefits to it. Let's say you finish a T1
  planet up, the bonus roll increases the chance of better relics or higher quality relics for completion. As well as
  the full planetary report that should 100% have a reward behind full completion."
- G16 tier rewards: "Haul x1 to x3.3 now (Recommended)": I 1 ... VII 3.3; "relic odds stay with Relics v2".
- Tiers I to VII, Tier VII the top, Roman numerals everywhere (gas giant design 1c, lines 62 to 68).

**1.5 Tutorial hooks** (`2026-10-15-safe-first-runs-plan.md` lines 601 to 613, user 2026-10-16): the repeatable
tutorial "will reward real actual loot (including guaranteed drops so we can show how specific systems work. Like at
least one or two general relics, and the very first exceptional relic." Plus the grant hook (line 596): "Yes, add it
now (Recommended)": one shared grant seam, unused until the tutorial / quests patch.

**1.6 Cross-cutting rulings that bind this plan**
- D23 (`2026-10-02-crew-made-real-e-crew-design.md` lines 143 to 147): "Diminishing returns will 100% come into play,
  but without removing the entire ability to push past a certain point."
- Everything wired (`2026-10-15-wiring-audit-and-safe-first-runs-capture.md` lines 36 to 38): "No placeholders. No
  non-functional systems."
- Event ledger (`2026-10-15-wiring-registry-and-audit-plan.md` lines 1361 to 1363): "The event ledger now
  (Recommended)": one notable-event ledger (first relic set, first Tier II run, captain milestones), absorbing G4.
- G3 scope note (E-CREW plan lines 30 to 33): "The endless-only bonus line waits for endless mode (deferred to
  0.14.x); 0.14.0 keeps counting past the cap."
- Precursor Lens first find: its module ships with E-MOD (exploration plan line 325; wiring audit line 456).
- Research Lab tiers (complement plan line 653): "Add tiers 3-7 now (Recommended)" (decided, not yet built).
- OC-G4 site flavor (wiring plan line 1356): better relic odds at Buried Vault and Subterranean sites (WR-11).

## 2. Reconciliation

| # | Source | What it says | Code today | This plan |
|:-|:-|:-|:-|:-|
| 1 | Datadump 1.1 | Finds are blanks with a rarity and a tier, a warehouse row | `relicVault: RelicVaultToken[]` (rarity in a field named `tier`, set, PoI); shown in Research > Relics | Vault stays the store; tokens gain an optional `regionTier`; the Warehouse shows a display row over the vault |
| 2 | Datadump 1.1 | Identification reveals a general relic from buckets, about 4 per rarity up to radiant | `identifyRelic(setId, rarity, seed)` picks WITHIN the PoI's set | A pool per band (standard / augmented / stellar / radiant); the set no longer decides identity (OC-1, OC-2) |
| 3 | Datadump 1.1 | Rare chance of an EXCEPTIONAL relic; each tier its own unique sets; big piece stats, massive set bonus; they do not stack | Nothing | New exceptional sets per tier (OC-5 to OC-7) |
| 4 | Datadump 1.1 | Tier I: weakest commons dominate; only 1 or 2 bonuses; incredibly rare | v1 skew weights (standard token 60/30/9/1) | Tier I keeps the v1 weights (already leaning on commons); Tier I exceptional = one small set (OC-5) |
| 5 | Datadump 1.1 | Higher tiers roll better, up to the top expedition tier | One tier (no regions yet) | Per-tier blank rarity and band odds (OC-13); Tier I byte-identical to today |
| 6 | Datadump 1.1 | Shorter missions drop relics, less often | Expeditions only | A tested seam for G1 Short-Range Missions at a fraction of the rate (OC-14) |
| 7 | Datadump 1.1, D23 | Unbounded collection; soft cap near 1000 stops regular-game effect; endless-only line past it; diminishing returns | Linear: +0.1% per copy, K-piece ladder 10/20/40/80/160 with a bottleneck | Per-tier `diminishing()` curve, a frozen snapshot at the cap (OC-3); no endless line until Endless Mode (OC-4) |
| 8 | D23 code note | `diminishing.ts` rejects `ln(1 + x / k)` because it "reads as a cap" | The mockup chart used `A ln(1 + n / 200)` | Use the shared `diminishing(x, knee)` (sqrt shape), not the mockup's ln |
| 9 | Everything wired vs the G3 scope note | No inert values vs "endless line waits" | n/a | Ship NO endless-line data in 0.14.0 (nothing inert); count past the cap and show it (OC-4) |
| 10 | Gas giant 1b item 6 | "Relic Sample A34" until the culture is studied; types shared across races | Every relic is named on identification | Identification reveals the TYPE and its stat; culture study reveals the name (OC-8 to OC-10) |
| 11 | Gas giant 1.3 (15b) | An ancient-race tab in the Research Lab unlocks special blueprints | Not built (15b designed only) | ONE Cultures tab serves both: relic finds and 15b ancient data both add study points (OC-9) |
| 12 | Mockup call 9 | Is "Precursor" one culture or the umbrella word? | Precursor Set, Precursor Lens, `precursorCircuit` | OC-11 (recommend umbrella word: keeps every approved name) |
| 13 | Approved 2026-10-01 | 4 sets, 17 relics, sources by PoI, 5 first-find unlocks | `RELIC_SETS`, `RELICS`, `relicDiscovered` gates 4 blueprints + Neural Backup | The 17 become Tier I's general pool by band, ids kept, so first finds and unlocks keep working (OC-1) |
| 14 | Mockup call 10 | Retire the copy ladder and bottleneck? | Ladder + bottleneck live (`setTierLevels`) | Retired for general relics (the D23 curve replaces it); exceptional sets use "the same set bonus" as flat piece + full-set bonuses |
| 15 | Wiring audit | Museum stats all 14 LIVE (transit everywhere via OC-D8, crewBonuses on officers via OC-E8, Science power on members via OC-H1); Precursor Lens unlock waits for E-MOD | `museumBonuses(state)` feeds every consumer | `museumBonuses` keeps its signature and its 14-stat Record; only the math behind it changes; no new stat in G3 |
| 16 | G2 G16 | Tier haul x1 to x3.3; relic odds stay G3 | Not built (G2-3) | The haul multiplier never touches the relic chance or relic count; tiers act through OC-13 tables |
| 17 | G2 call 11 | Finishing a planet gives a bonus roll toward better relics | Not built (G7) | G3 owns the roll function, G7 calls it (OC-15) |
| 18 | Ledger decision 2026-10-16 | One notable-event ledger; first relic set is an event | Not built, no owner slice yet | "relicSetCompleted" events; G3 builds the minimal ledger if it is not in yet (OC-16) |
| 19 | Safe first runs 1.5 | Tutorial grants 1 or 2 general relics and the very first exceptional | Grant seam decided, not built | Relic grant kinds added to the shared grant seam, tested, unused (R2-2) |
| 20 | Explorer talents (wiring answers) | Preservationist = 8% shorter relic study; Relic Hunter = +1 relic tier ceiling; Field Science = relicFindBonus +0.05 | Not built (WR-5 track) | The identification duration seam and the blank-roll rarity ceiling stay where those talents read them |
| 21 | OC-G4 (WR-11) | Vault and Subterranean sites have better relic odds | Not built | Multiplies the same chance draw; G3 adds the PoI type bias (OC-17) on top |
| 22 | Mockup sections | Tier colors t1 to t5, "Tier 1" labels, a derelict blank row | Blanks roll standard..radiant only (`SALVAGE_LOOT_POOLS.intactReactorCore`) | Seven tiers, Roman numerals; no derelict band (no derelict blank exists) |
| 23 | Lab tiers 3 to 7 | Decided for 0.14.0 | Lab tops at level 2 | Identification lanes grow with Lab level (OC-12); no Lab gate per tier recommended |
| 24 | Material Lines | Precursor Circuit and Intact Data Core stay reserved | `intactDataCore` consumed by Neural Backup only | Unchanged by G3 |

## 3. Data model, save impact, migration

### 3.1 Catalog (`relics.ts`, pure data; one-way import arrow kept)

- **General types** `RELIC_TYPES`: id, label, band (`standard | augmented | stellar | radiant`), museum stat(s),
  in-band weight, flavor. Tier I = the 17 approved relics, ids unchanged (OC-1, recommended mapping):
  - standard (common): Glyph Tablet, Hull Rivet, Spore Capsule, Geode Core
  - augmented (uncommon): Resonance Shard, Star-Chart Fragment, Flight Recorder, Bioluminescent Seed, Magma Pearl
  - stellar (rare): Precursor Lens, Ancient Drive Coil, Leviathan Scale, Deep-Vein Compass
  - radiant (extremely rare): Heart of the Archive, Captain's Sigil, Living Crystal, Tectonic Keystone
  That is 4 / 5 / 4 / 4, inside "4 of each rarity ... more commons is fine". Each type carries the stat its old set
  position granted (index 1 = the set's per-copy stat, index k = the k-piece tier's stat; the two-stat Precursor
  capstone keeps both at half weight) **[PROPOSAL]**, so all 14 Museum stats stay fed.
- **Band odds per tier** `RELIC_BAND_ODDS[tier][blankRarity]`: Tier I = today's `RELIC_RARITY_WEIGHTS_BY_TIER`
  (standard blank 60/30/9/1, augmented 40/35/20/5, stellar 20/30/35/15, radiant 10/20/40/30). Each tier above I moves
  weight up the table **[PROPOSAL]**: Tier IV standard blank 40/35/18/7, Tier VII standard blank 20/35/28/17, radiant
  blank at Tier VII 0/10/40/50; the rows between interpolate linearly and round to integers.
- **Exceptional sets** `EXCEPTIONAL_SETS`: id, tier, label, pieces (id, label, stat, value), full-set bonus (stats,
  values). Sizes per OC-5. Names come from a content sign-off sheet (R2-5); the mockup's Waystation, Hearthward,
  Deepcut, Lightkeeper and Shipwright's Choir sets and their pieces are all **[PROPOSAL]**.
- **Exceptional odds** `EXCEPTIONAL_PER_100K[tier][blankRarity]` **[PROPOSAL]**: Tier I 250 / 500 / 1000 / 1500
  (0.25% to 1.5%), times 1.25 per tier above I, rounded to integers.
- **Museum math** **[PROPOSAL numbers, all tunable]**: `MUSEUM_V2_PER_COPY[tier]` = 0.001 x (1, 1.5, 2.2, 3, 4, 5.2,
  6.6); `MUSEUM_V2_KNEE` 0.25; `RELIC_SOFT_CAP` 1000 per tier (OC-3). Exceptional piece values Tier I +3% rising to
  Tier VII +15%; full-set bonus five times one piece.
- **Cultures** `CULTURE_ROSTER[tier]`: id, display code (for example "Culture K-17"), revealed name, lore line.
  Codes are derived, names come from OC-10. `CULTURE_STUDY_POINTS` 10 **[PROPOSAL]**.
- **Wiring registry**: every new catalog (`RELIC_TYPES`, `RELIC_BAND_ODDS`, `EXCEPTIONAL_SETS`,
  `EXCEPTIONAL_PER_100K`, `MUSEUM_V2_*`, `CULTURE_ROSTER`) is added to `wiring/catalogs.ts` with a probe in
  `wiring/probes.ts`; the old `RELIC_SETS` tier sources retire from the registry in the same slice that retires them.

### 3.2 Persisted shapes (`model.ts`; all new fields OPTIONAL, read with a default)

- `RelicVaultToken` gains `regionTier?: RegionTier` (absent = I), `cultureId?: string` (absent = derived at read from
  the token id, see 3.4), `source?: "expedition" | "shortRange" | "completion" | "grant"` (absent = expedition).
  `setId` becomes optional (kept on old tokens as provenance; v2 tokens do not need it).
- `ExpeditionRelicToken` gains `regionTier?` and `cultureId?`, stamped at the roll.
- `museumV2?: MuseumV2` (absent = empty):
  - `general: Partial<Record<RegionTierKey, Record<RelicTypeId, number>>>` (copies per tier per type),
  - `exceptional: Record<PieceId, number>` (copies; duplicates counted, OC-7),
  - `frozen: Partial<Record<RegionTierKey, Record<RelicTypeId, number>>>` (the snapshot taken when a tier reached the
    soft cap, OC-3),
  - `cultures: Record<CultureId, { points: number; finds: Record<RelicTypeId, number> }>`,
  - `culturesNamed: CultureId[]` (in reveal order, appended once),
  - `setsCompleted: SetId[]` (in completion order, appended once; the ledger hook reads it).
- `relicQueue?: string[]`: vault token ids queued for identification, in order (OC-12).
- The `relicStudy` effect gains `v?: 2` (its PRESENCE is the v2 flag, the established pattern). A process without it
  resolves through the v1 roll (3.4).
- `relicDiscovered` stays exactly as is (first-find order); v2 appends general type ids and exceptional piece ids.
- `relicMuseum` retires (moved into `museumV2.general["1"]` by the migration). `relicSeed` and
  `nextRelicStudyIndex` stay.

### 3.3 Save version

SAVE_VERSION stays **70**: v70 has not reached staging (staging is on the 0.13.10 hotfix at SAVE 54, checked
2026-10-17), so the G3 step APPENDS to `MIGRATIONS[69]` and is documented beside the v70 list in `save.ts`, the rule
written there. If v70 reaches staging before R2-1 lands, R2-1 takes v71 instead (check `git show
origin/staging:src/lib/game/save.ts` first). Production (0.13.9) never had relics, so only branch and old staging
saves carry relic data.

### 3.4 How existing records migrate

- **Museum record:** `museumV2.general["1"] = { ...relicMuseum }` (every old copy is a Tier I copy; every existing
  expedition is Tier I because regions do not exist yet), `exceptional = {}`, `frozen = {}`, cultures empty, then
  `relicMuseum` is dropped. Ids are unchanged, so `relicDiscovered` and every relic-gated blueprint stay unlocked.
- **Museum bonuses move** for those saves (linear + ladder becomes the D23 curve). Acceptable: 0.14.0 is
  unreleased; R2-4 names the moved goldens. An empty museum stays all zeros (additive-neutral).
- **Vault tokens:** untouched by the migration. An old token reads `regionTier` I and `source` expedition; its
  culture is derived at read time as `cultureFor(relicSeed, token.id, tier I)` (a pure hash with
  `RELIC_CULTURE_SALT`, no stream draw), so it never needs storing.
- **In-flight relic studies:** a process without `v: 2` resolves through the v1 `identifyRelic` exactly as
  dispatched (the stored-record rule) and deposits into `museumV2.general["1"]`; the v1 result is always a valid
  Tier I type, because the ids did not change.
- **Fresh state == migrated state** for a save with no relics (asserted).
- An in-flight expedition carrying v1 relic tokens on its findings claims normally: deposit stamps the defaults.

## 4. Slices (R2-0 first; one commit each; gate = `npm run check` 0 errors and `npx vitest run` green)

Determinism rules for every slice: randomness only through `makeRng` keyed `seed ^ SALT ^ key`; integer draws only
(`nextInt`, `chance(n, d)`); every new salt exported, odd, 32-bit, distinct, and listed in `salts.test.ts`; never a
new draw on a shared stream; offline == live proved by one call == 997 s chunks == 1 s steps. New salts
**[PROPOSAL names]**: `RELIC_IDENTIFY_V2_SALT`, `RELIC_CULTURE_SALT`, `RELIC_SHORT_RANGE_SALT`,
`RELIC_COMPLETION_SALT`.

### R2-0: Goldens first (tests only)
Pin today's behavior before anything moves: `identifyRelic` over a grid (4 sets x 4 rarities x 64 seeds);
`rollRelicToken` over the Tier I fixture runs used by the G2-0 / SF-0 goldens; `depositExpeditionFindings` vault
output; `relicStudyDurationTicks` and `museumResearchDurationTicks`; `museumBonusesFromRecord` on five fixture
records (empty, one copy, a full set, a ladder level, 1000 copies); a v69 save holding a vault, a museum and an
in-flight study, migrated and ticked to completion, hashed through `stateHash`. Commit
`test(0.14.0): pre-relics-v2 goldens (R2-0)`.

**R2-0 carry note (2026-10-20, built on a9caa06):** `src/lib/game/relicsV2Goldens.test.ts`, 15 tests, as planned. The
`rollRelicToken` fixture runs are the G2-0 `PRE_G2_STORED_RUNS` (the flagged run yields six relic findings, the legacy
run none), so a grid of 64 seeds x 5 hazards x 5 PoIs x 2 find bonuses x 2 captains pins the roll as well (2,920 hits).
Golden 6 is a v69 save with two vault tokens, four museum types and a stellar study in flight (1,168 ticks), migrated
with fixed entropy and ticked through `stateHash`, plus one call == 1 s steps.

### R2-1: Catalog, data model, migration (engine, dormant)
Section 3 shapes; `RELIC_TYPES` Tier I; band and exceptional odds tables; the `MIGRATIONS[69]` step; wiring
registry entries (dormant until R2-3 reads them, registered as seams). Tests: catalog asserts (unique ids, bands
non-empty, weights positive, every stat in `MUSEUM_STATS`); migration (museum moved, `relicMuseum` gone, discovered
untouched, fresh == migrated); every R2-0 golden unchanged.

**R2-1 carry note (2026-10-20):**
- Catalog (end of `relics.ts`): `RELIC_TYPES` is built FROM `RELICS` (ids, names, flavors cannot drift), bands
  4 / 5 / 4 / 4; `RELIC_BAND_ODDS` reads Tier I straight from `RELIC_RARITY_WEIGHTS_BY_TIER` and interpolates to the
  Tier IV and VII anchors; `EXCEPTIONAL_PER_100K` is computed (Tier VII radiant 5,722); `EXCEPTIONAL_SET_SIZES` gives
  **14** sets and 54 pieces (call 5's sizes; "12" anywhere is a miscount), ids `exc-t<tier>-<a|b|c>` and
  `exc-t<tier>-<x>-p<n>`, every label `[PROPOSAL] ...`; `RELIC_SOFT_CAP` 1000; `CULTURE_ROSTER` 42 placeholder ids
  `culture-t<tier>-<n>`, no display names; `CULTURE_STUDY_POINTS` 10.
- [PROVISIONAL], one constant each: `RELIC_TYPE_STATS` (the plan's old-position rule, test-asserted),
  `RELIC_TYPE_WEIGHT` 1, `RELIC_BAND_ODDS_ANCHORS` (the rows the plan did not give: augmented and stellar at IV and VII,
  radiant at IV), `EXCEPTIONAL_PIECE_VALUE` (3% to 15% linear), `EXCEPTIONAL_FULL_SET_MULT` 5,
  `EXCEPTIONAL_PIECE_STAT_CYCLE` (pieces cycle the 14 Museum stats; a full set lands on its first piece's stat). R2-5's
  content sheet should present the last three with the names.
- Model: `museumV2: MuseumV2` REPLACES `relicMuseum` and is required, not optional as 3.2 says (it replaces a required
  field and the migration always writes it); freshState puts it at the old key position. Read and write only through
  `model.ts` `generalMuseumRecord` / `museumV2WithGeneral` / `withGeneralMuseumRecord`. Token `regionTier`,
  `cultureId`, `source`, the effect's `v?: 2` and `relicQueue?` are optional and unwritten. `setId` stays REQUIRED
  until R2-2 mints the first token without it (the Research panel and the dashboard read it).
- Migration: `withMuseumV2V70` appended to `MIGRATIONS[69]` and also run after the loop on every load (a pre-R2-1 v70
  dev save still holds `relicMuseum`). Frozen, idempotent (same reference), key position kept, counts sanitized.
- Goldens: no value moved. Every whole-state golden helper now hashes through `withV1Museum`
  (`firstRunsGoldens.fixture.ts`: `museumV2` shown as the v1 `relicMuseum` at its key position, only while it holds
  nothing v1 could not), including `stateHash` and `withoutRunCounts`; the G1-0 registry golden leaves out the new
  `relic:RELIC_TYPES:*` / `relic:EXCEPTIONAL_SETS:*` entries.
- Wiring: 17 + 68 new entries, all `pending` (owners R2-4, and R2-4 + R2-5); six constants listed in
  `UNREAD_CONSTANTS` with their owning slice; the Debug panel lists both catalogs as unmeasured (dormant).
- Left to their slices: `MUSEUM_V2_PER_COPY` / `MUSEUM_V2_KNEE` (R2-4), lanes by Lab level (R2-3), `cultureFor` and the
  new salts (R2-2 / R2-3). No `[PROPOSAL]` label may reach player text: R2-7 / R2-8 take the signed-off names.

### R2-2: Blanks by tier, sources, hooks (engine)
`rollRelicToken` keeps its two draws (chance, then rarity) and reads the run's tier (`exp.risk?.tier ?? 1`): Tier I
is byte-identical; Tier II and up pick rarity from the OC-13 table on the same draw. The token stamps `regionTier`
and `cultureId` (derived from the body: `RELIC_CULTURE_SALT ^ exp.seed ^ bodyIndex`, no draw). Deposit carries both.
New pure seams: `rollShortRangeRelicBlank(seed, tier)` (G1 calls it, OC-14), `rollCompletionRelicBlank(seed, tier)`
(G7 calls it, OC-15), and relic kinds on the shared grant seam (a general relic of a given type and tier; the first
exceptional piece of Tier I), logged, unused until the tutorial patch. The haul multiplier is asserted NOT to change
the relic chance. Tests: R2-0 Tier I goldens unchanged; tier tables honored over 10,000 seeds per tier within
tolerance; culture derivation pure and stable; each seam deterministic; grant kinds round-trip a save.

**R2-2 carry note (2026-10-21, built on 624b0c5):**
- New module `relicBlanks.ts` (relics.ts stays pure data). FLAG: `Expedition.relicBlanks: { version: 1 }`, stamped in
  `startExpedition` beside `region` / `voyage`; only a flagged run passes the blank stamp to `rollRelicToken`, so a run
  in flight at the update rolls and stores its tokens byte-identically (every R2-0 golden unchanged). Tier = the run's
  G2-2 `region.tier`, else `risk.tier`, else I. Tokens and deposits append `regionTier` and `cultureId` LAST.
- Blank rarity: `RELIC_BLANK_WEIGHTS[tier]`, Tier I = the `intactReactorCore` ladder rows exactly (1000/300/40/5), each
  tier above scales a rarity by how its band grew in `RELIC_BAND_ODDS[tier].standard` over Tier I (IV 667/350/80/35, VII
  333/350/124/85). Same single draw, same hazard ceiling (`relicBlankCeiling`, which gambit's `relicTierCeiling` now
  reads). The chance never reads the tier; the haul multiplier never touches the roll (tested).
- Culture: `cultureForBody(exp.seed, bodyIndex, tier)` on a fresh keyed stream (`RELIC_CULTURE_SALT`); an old token's
  culture is `legacyTokenCultureId(relicSeed, token.id)`; readers `vaultTokenRegionTier / vaultTokenCultureId /
  vaultTokenSource`.
- `setId` (and `poiId`) are now OPTIONAL on `RelicVaultToken`: expedition deposits still write both, so sited blanks
  identify by the v1 roll exactly; a blank with no set (hook or grant) identifies through `identifyGeneralRelic` (band
  from `RELIC_BAND_ODDS[tier][band]`, then type with the call 17 site bias, `generalTypeWeight`). R2-3: build v2 on that
  pick; note a v1 study still deposits into `general["1"]` whatever the token's tier (R2-3 owns per-tier deposit). UI
  reads "General" for a setless blank (RelicStudyPanel, Home, the log line).
- Hooks (pure, callers own the deposit via `withRelicBlanks`): `rollShortRangeRelicBlanks(seed, srTier, seconds, idPrefix)`
  for G1-5 (expected count linear in time: whole part + one chance on the remainder, salt `RELIC_SHORT_RANGE_SALT`);
  `planetCompletionRelicBlank(exp, bodyIndex)` / `rollCompletionRelicBlank` for G7 (the body's hazard roll, one step up,
  salt `RELIC_COMPLETION_SALT`). Grant seam: `GrantBundle.relics` (`general` by type, tier, count; `firstExceptional` =
  the first Tier I piece the save lacks), straight to `museumV2` + first finds, log line "an exceptional relic" (no
  `[PROPOSAL]` name reaches text).
- [PROVISIONAL], one constant each: `RELIC_BLANK_SHIFT_BAND` "standard" (whose band row the blank table follows),
  `EXPEDITION_RELIC_BLANKS_PER_HOUR` 0.5 (measured: rank 6 Orion / Aurora 0.53 to 0.57 per hour, board crew Eir 0.39),
  `SHORT_RANGE_RELIC_CEILING` 0 ("lowest-tier": standard rarity, Tier I).
- Goldens: `relicsV2BlanksGoldens.test.ts` (goldens-first commit). Moved, named: Tier VII seeds 23 and 37 (eight rows
  rarer, same tokens); Tier I and IV unchanged. `asPreFieldKitsDispatch` now composes `withoutRelicBlanks` (every
  "as pre-X dispatch" helper strips the flag); `fieldKitsRunGoldens` strips it by hand. Registry: five pending audit
  rows (`relic:audit:*`, owners G2-6, R2-6, G1-5, G7), held apart in every registry pin (`relicBlanks.fixture.ts`).

### R2-3: Identification v2, lanes and queue (engine)
New studies carry `v: 2`; the completion roll is keyed off `(relicSeed, RELIC_IDENTIFY_V2_SALT, studyIndex,
tokenId)` and draws exactly three integers in a fixed order (exceptional check per 100,000; then band or piece; then
type), the unused draw still taken so the count never varies. General: museum copy, culture point and find, first
find. Exceptional: piece copy (OC-7 rule), first find, set completion check. v1 processes keep the v1 path. Lanes
by Lab level (OC-12); the queue starts the next queued token at the completion tick inside `resolveProcesses`
(closed-form chain, so one big offline resolve equals live steps); Preservationist and the museum research speed
keep reading the duration seam at start. Tests: draw count fixed; outputs pure in stored values; v1 in-flight study
resolves to its R2-0 golden; queue parity (1 call == 997 s chunks == 1 s steps) across a ten-token chain; lane cap.

**R2-3 carry note (2026-10-21, built on 5b5011a):**
- New module `relicIdentify.ts`: `rollRelicIdentification(rng, input)` draws exactly three integers (the check out of
  100,000 at `EXCEPTIONAL_PER_100K[tier][band]`; the piece or the band; the type or an unused draw), keyed by
  `relicStudyV2Seed` (salt `RELIC_IDENTIFY_V2_SALT`); `identifyRelicV2` reads the Museum's exceptional copies at
  completion (call 7: missing pieces first; all held = a duplicate, counted, no stat); `applyRelicIdentification`
  deposits (a general type at its region tier, +1 culture point and find on the blank's culture, first find; an
  exceptional piece, first find, its set appended to `setsCompleted` once; the ledger event stays R2-5's).
- "Only one boost" read as: identification uses the blank's own rarity row of the band odds (`RELIC_IDENTIFY_BAND_TIER`
  1, the v1 skew 60/30/9/1 ...) at every tier; the tier acts only through the rarer blank and the exceptional chance
  (call 6's x1.25 per tier). Same seed and rarity at Tier I and VII reveal the same general type (tested).
- Lanes: `RELIC_STUDY_LANES_BY_LAB` (I 1, III 2, V 3, VII 4) read through OC-15's `model.ts labTier`; Lab I and II stay 1.
- Queue (tick.ts): `queueRelicStudy`, `queueAllRelicStudies`, `unqueueRelicStudy`, `moveRelicQueueEntry`,
  `pumpRelicQueue`; queued blanks stay in the vault until a lane takes them; `startRelicStudy` stamps `v: 2` and takes a
  queued blank out of the queue. Inside `resolveProcesses`, `resolveRelicStudies` walks every study completion and every
  Lab level-up in the window in TIME order (deposits, then queue starts at that instant, durations read then), so one
  resolve, 997 s chunks and 1 s steps land the same state (one big resolve keeps the resolver's array-order LOG
  convention when another kind completes beside the chain). Records carry the chain's id (`recordCompletion` relicId).
- v1 studies (no `v`) keep the v1 roll exactly; R2-3 fixes their deposit to the token's region tier (pre-R2-2 tokens
  read Tier I, so nothing in flight moves). `identifyStudiedRelic(state, token, index, v?, museum?)`; App passes `v` to
  its reveal hint (the reveal card for Tier II+ and exceptional pieces is R2-7).
- Not yet acting (owners already registered): Tier II+ general copies and exceptional pieces add no stat until R2-4's
  museum math reads them; culture names R2-6.
- Wiring: rows `relic:audit:identifyV2` LIVE (probe `content:relic:exceptionalReveals`, 600 real starts and resolves
  against the v1 roll), `relic:audit:identifyLanes` LIVE (`content:relic:lanes`, Lab VII vs Lab I),
  `relic:audit:identifyQueue` pending R2-7 (no UI). `RELIC_TYPES` band / siteSet / weight are now effect fields;
  `EXCEPTIONAL_PER_100K` left the unread list. Pins hold the three rows apart (`relicIdentify.fixture.ts`).
- Goldens: `relicsV2IdentifyGoldens.test.ts` (goldens-first commit; `startV1RelicStudy` fixture). Moved, named: golden 2
  (v1 Tier II / VII blanks now land in "2" / "7") and golden 4 (lanes at Lab III to VII). Every R2-0 golden unchanged.

### R2-4: Museum math v2 (engine)
`museumBonusesFromRecord` becomes the per-tier curve: for each tier and stat, `diminishing(copies x PER_COPY[tier],
KNEE)`, summed over tiers; exceptional pieces and full sets add flat values (they do not stack: OC-7). Soft cap: when
a tier's identified total first reaches 1000, its counts are snapshotted into `frozen`; the regular game reads the
snapshot from then on, while the counts keep growing and the UI shows them (OC-3, OC-4). `museumBonuses(state)` and
the E4b consumer map are unchanged; hazard resist still passes `effectiveHazardResist`. Retire `setTierLevels`, the
copy ladder and the bottleneck (OC-1, call 10 of the mockup). Tests: empty museum all zeros; monotone and concave per
tier; a farmed tier's next copy worth less than an early copy one tier up; frozen snapshot exact at the cap and stable
past it; every stat moves its consumer (wiring sensitivity test); moved goldens named in the commit with the reason.

**R2-4 carry note (2026-10-21, built on bc25a23):**
- Math (end of `relics.ts`, `museumBonusesFromMuseum`, which `museumBonuses` reads; signature and consumers unchanged):
  TIER I KEEPS THE V1 MATH EXACTLY (per-copy passive plus the set ladder and bottleneck) on the controller's ruling
  "Tier I veterans' bonuses must stay exactly what they are today", so `museumBonusesFromRecord`, `setTierLevels` and
  the RELIC_SETS / RELICS wiring rows stay, for Tier I only. This departs from the plan text above ("retire
  setTierLevels, the copy ladder and the bottleneck"): no tier above I ever had a ladder. Tiers II to VII: per stat,
  `diminishing(copies x share x MUSEUM_V2_PER_COPY[tier], MUSEUM_V2_KNEE)`, summed over tiers. Exceptional: each held
  piece once (duplicates nothing), a full set +5x one piece; flat, on top.
- Soft cap: a tier's identified total = its general copies plus its exceptional copies (duplicates count, call 7). At
  1000 the tier's whole record (types and its pieces, one map) is snapshotted into `frozen`; the regular game reads the
  snapshot (`museumActiveRecord`), counts keep growing (`museumTierTotal`, `museumTierFrozen` for R2-8). Every writer goes
  through `museumDepositGeneral` / `museumDepositExceptional` (identification v2, the v1 study deposit, the grant seam;
  a multi-copy grant is trimmed to the exact cap); the dev Museum control calls `withSoftCapSnapshot`. Load:
  `withSoftCapSnapshotV70` (MIGRATIONS[69] step 6 and every load, FROZEN inline cap) snapshots a dev save already past
  the cap at its current counts: same counts, same bonus.
- [PROVISIONAL], one constant each: `MUSEUM_V2_PER_COPY` (plan 0.001 x 1.5 ... 6.6 for II to VII), `MUSEUM_V2_KNEE` 0.25,
  `SOFT_CAP_FREEZES_EXCEPTIONAL` false (pieces and full sets always act, frozen tier or not; the snapshot holds them, so
  flipping needs no migration).
- Goldens: `relicsV2MuseumGoldens.test.ts` (goldens-first commit). Golden 1 (256 Tier I veterans) and 2 (past the cap
  through a load) UNCHANGED. Moved, named: golden 3 (Tier II+ copies and exceptional pieces now act) and the R2-1
  catalog test's "copies at another tier do not count yet". Every whole-state golden unchanged.
- Wiring: RELIC_TYPES (17) and EXCEPTIONAL_SETS (54 + 14) flipped LIVE on `museum:<stat>` (Tier II fixture through the
  diminishing curve; pieces flat; full set vs all but the last piece); added `relic:MUSEUM_V2_PER_COPY:2..7` and
  `relic:audit:softCap` (LIVE: 200 copies past the cap move cargo down by the curve's growth). Pins hold the move apart
  (`relicMuseumV2.fixture.ts`). The Debug panel now owns RELIC_TYPES, EXCEPTIONAL_SETS and MUSEUM_V2_PER_COPY; Tier I
  readers read the snapshot. Reaching Tier II or deeper is still G2-6's (`relic:audit:blankTiers`).
- For R2-8: the Museum panel still shows Tier I from the live `general["1"]` through the v1 readers; once a tier is
  frozen the page should read `museumActiveRecord` for bonuses and `museumTierTotal` for the shown count.
- Review follow-up (2026-10-22, integration): the Museum page's bonus numbers (tier levels, set bonuses, per-copy totals)
  now read `museumActiveRecord(state.museumV2, 1)`, so they match the engine once Tier I freezes; the tiles keep the live
  copy counts (call 4), a frozen tier reads "Lv N · held at the soft cap" with one line naming the cap, and one line
  totals what the higher tiers and the exceptional pieces add (`museumBeyondTierIBonuses`). The full v2 page stays
  R2-8's. The dev Museum control drops Tier I's snapshot before re-taking it (it SETS counts). A v69 save holding the
  old `relicMuseum` past the cap is pinned through `MIGRATIONS[69]` (relicsV2Museum.test.ts).
- For the user: the soft cap also caps Tier I veterans. Their bonus is kept exactly, but it stops growing at 1000 Tier I
  relics; with copies spread at random, Tier I tops out around ladder level 3 of 5 (the top rung needs 160 copies of each
  of 17 relics).

### R2-5: Exceptional sets content, set completion, ledger (engine + content sign-off)
Content sign-off first: one sheet with every exceptional set and piece name, stat and value for Tiers I to VII (OC-5).
Then: set completion appends to `setsCompleted` once and emits a `relicSetCompleted` ledger event (set id, tier,
in-game time; idempotent key) (OC-16). If the notable-event ledger is not in yet, this slice builds its minimal form
(append-only list on GameState, idempotent by key, no UI), per the 2026-10-16 decision. Tests: completion fires once
per set; replaying a save does not duplicate; duplicates follow OC-7; ledger survives a save round trip.

### R2-6: Cultures (engine + names sign-off)
`CULTURE_ROSTER` per tier (OC-10); study points from identified finds and from 15b ancient data (a `feedCultureData`
seam 15b calls, OC-9); at the threshold the culture's name is revealed, appended to `culturesNamed`, and every sample
from it reads with its real name; until then a general relic reads "Relic Sample" plus a code derived from
`(cultureId, typeId)` (no storage). Exceptional relics are named on reveal (OC-8). Tests: naming is a pure function
of stored state; threshold exact; renames apply to old finds; no culture name equals a reserved antagonist label
(a guard test over the roster).

### R2-7: UI A, the parts the mockup covers (needs the mockup's calls answered, no new layout sign-off)
Warehouse "Unidentified Relics" row with the tier x rarity matrix (mockup section 2); Research Lab Identification tab
replacing the Relics sub-tab: feed, queue, lanes, the reveal card, recent identifications (section 3); the exceptional
set cards by tier with Roman numeral tabs (section 4). Seven tier colors, Roman numerals, SVG glyphs only. One DOM,
CSS breakpoints, verified at 375 px.

### R2-8: UI B, needs a NEW mockup sign-off
The Museum v2 page (per-tier general shelves, culture samples under each type, the cap meter and frozen state, the
exceptional sets), the Cultures tab detail and its name-reveal moment, and the glyph plan for exceptional pieces
**[PROPOSAL]** one SVG glyph per set with its tier color, so the SVG work stays bounded (reviewed at 16 / 28 / 56 px).
The mockup's soft-cap chart is explanation only; it is not an in-game screen.

### R2-9: Help, text, QA, close-out
Help pages for relics, identification, cultures, the Museum curve and the soft cap; claim log lines for blanks by
tier; patch-note draft (never the Intact Data Core line, never a DBD name); the curated desktop + mobile QA sheet;
holistic review; staging only by the controller.

**Mockup coverage vs new sign-off**

| Need | Mockup | Status |
|:-|:-|:-|
| Warehouse row and matrix | section 2 | covered |
| Identification tab, lane, queue, reveal | section 3 | covered (calls open) |
| Cultures list with progress | section 3 | covered at list level |
| Culture detail and name reveal | none | NEW sign-off (R2-8) |
| Exceptional sets by tier | section 4 | covered (names [PROPOSAL]) |
| Museum v2 page, cap meter, frozen state | chart only | NEW sign-off (R2-8) |
| Ledger / chat | section 6 preview | no 0.14.0 screen (ledger owner) |
| Roman numerals, seven tiers | shows "Tier 1", five colors | fix in build |

## 5. OPEN CALLS (most important first; recommended option first)

1. **Today's 17 relics and 4 sets.** (A) They become Tier I's general pool by band (4 / 5 / 4 / 4), ids, names,
   flavors and first-find unlocks kept, the set ladder retired. (B) They become the Tier I and II exceptional sets.
   (C) Retire them and start over.
2. **General pools per tier.** (A) The same types at every tier, counted and curved per tier, better odds and bigger
   stats higher up. (B) Each tier its own 16 or so types (about 100 new names). (C) One pool, one count for all tiers.
3. **Soft cap scope.** (A) 1000 identified relics per tier; at the cap the tier's counts freeze for the regular game
   (the one flat line on the D23 curve, your stated exception). (B) 1000 across all relics. (C) 1000 per type.
4. **Past the cap in 0.14.0.** (A) Keep counting and show the count; no endless-line values until Endless Mode
   (nothing inert ships). (B) Define the endless line now, hidden until Endless Mode.
5. **Exceptional set sizes by tier.** (A) I: one set of 2; II: one of 3; III: two of 3; IV and V: two of 4; VI: three
   of 4; VII: three of 5 (54 pieces). (B) One set per tier, 2 to 8 pieces (35 pieces). (C) The mockup's sizes.
6. **Exceptional odds.** (A) Tier I 0.25% to 1.5% by blank rarity, x1.25 per tier up. (B) Half that. (C) Flat 1%.
7. **Exceptional duplicates ("they don't stack").** (A) The reveal prefers pieces you lack; a duplicate adds no stat
   but counts toward the tier total. (B) Uniform pick, a duplicate adds nothing. (C) A duplicate turns into five
   general copies of its tier.
8. **Identify vs name.** (A) Identification reveals the type and its stat; culture study reveals the real name;
   exceptional relics are named on reveal. (B) Everything waits for the culture study.
9. **Cultures.** (A) Tied to the planet a relic came from; +1 study point per identified find plus 15b ancient data;
   name at 10; ONE Cultures tab also serves 15b's special blueprints. (B) A random culture per find. (C) Culture study
   as its own timed Research project.
10. **Culture names.** (A) A curated roster of 6 per tier (42 names) on a sign-off sheet. (B) A syllable generator for
    unlimited names, syllables signed off. (C) You name them.
11. **"Precursor".** (A) The umbrella word for every long-dead maker (keeps Precursor Lens and Precursor Circuit);
    cultures are the specific races beneath it. (B) One culture among many.
12. **Identification time, cost, lanes.** (A) 10 minutes x rarity, free, a queue, lanes by Lab level (I 1, III 2, V 3,
    VII 4), no Lab gate per tier. (B) One lane, queue only. (C) Tier N blanks need Lab level N.
13. **Blank rarity per tier.** (A) Tier I exactly as today; each tier up shifts weight up the table (section 3.1); the
    relic chance and the haul multiplier untouched. (B) Also raise the relic chance per tier.
14. **"Shorter missions".** (A) G1 Short-Range Missions only, at one quarter of the expedition chance. (B) Also today's
    mining and salvage missions and patrols.
15. **Planet 100% bonus roll.** (A) G3 owns the roll (one extra blank, one rarity step up), G7 calls it. (B) G7 owns it.
16. **Set shoutout.** (A) Every exceptional set completion is a ledger event (your "any set"), G3 builds the minimal
    ledger if needed. (B) Only the first set ever.
17. **Site bias.** (A) A relic's source site doubles the weight of its old set's types (Deep Earth sites favor Geode
    Core). (B) The site does not affect identity.

## 6. Size (honest)

10 slices (R2-0 to R2-9). Heaviest: R2-3 (the queue chain inside `resolveProcesses` and its parity), R2-4 (the
curve, the freeze and every moved golden) and R2-8 (a new page plus glyphs). Rough estimate: 3,000 to 4,500 lines of
code and tests, about two to three working days of slices plus review loops, plus two content sign-offs (exceptional
names, culture names) and one mockup sign-off. Scope flag: call 2 (B) and call 5 (A) together mean about 150 new
names; (A) on call 2 keeps that near 54 + 42. Dependencies: G2-2 for real tiers (Tier I until then), the grant seam
(safe first runs), Lab tiers 3 to 7 (complement plan; lanes read whatever level exists), the ledger (decided, unowned),
15b for the ancient-data feed, G1 and G7 as callers of the two seams. Could move to 0.14.x without leaving anything
inert: culture names (finds keep their "Relic Sample" codes, honest Help), the R2-8 culture detail view.

## USER ANSWERS (2026-10-19)

- **Call 1 today's relics:** "Become Tier I pool (Recommended)": the 17 relics become Tier I's general pool by band
  (4 / 5 / 4 / 4); ids, names, flavors and first-find unlocks kept; the set ladder retired.
- **Call 2 general pools:** "Same types, scaled per tier (Recommended)".
- **Call 3 soft cap:** "1000 per tier (Recommended)".
- **Call 4 past the cap:** "Keep counting, show it (Recommended)".
- Note on call 14: G1's short-range relic rate was already answered on the short-range plan (2026-10-19: rare, per
  hour, Tier I 0.08x and Tier II 0.15x of the expedition rate); call 14 now only asks whether other missions drop too.
- **Call 5 set sizes:** "Growing sets, 54 pieces (Recommended)".
- **Call 6 exceptional odds:** "0.25% to 1.5%, x1.25/tier (Recommended)".
- **Call 7 duplicates:** "Prefer missing pieces (Recommended)".
- **Call 8 identify vs name:** "Type on identify, name via culture (Recommended)".
- **Call 9 cultures:** "Tied to source planet (Recommended)": +1 study point per identified find plus 15b ancient data;
  named at 10; ONE Cultures tab also serves 15b's special blueprints.
- **Call 10 culture names:** "Curated roster, 42 names (Recommended)": 6 per tier on a sign-off sheet.
- **Call 11 Precursor:** "Umbrella word (Recommended)".
- **Call 12 identification:** "Free, queued, lanes by Lab (Recommended)": 10 minutes x rarity, lanes I 1, III 2, V 3,
  VII 4, no Lab gate per tier.
- **Call 13 blank rarity:** "Better rarity only (Recommended)": relic chance and haul multiplier untouched.
- **Call 14 other drops:** "Short-Range only (Recommended)": mining, salvage and patrols stay relic-free.
- **Call 15 planet 100% bonus:** "Relics owns the roll (Recommended)": G3 owns it, G7 calls it.
- **Calls 16 + 17:** "Every set + site bias (Recommended)": every exceptional set completion is a ledger event; a
  relic's source site doubles the weight of its old set's types.
- ALL 17 calls answered. Still open: the name sign-offs (exceptional set names, 42 culture names), presented as a
  sign-off sheet before R2-8.

## USER IDEA (2026-10-22, open): compounding past the 1000-relic soft cap

After learning the secret game's Overclock compounds (x1.125 per level, multiplied): "I'm tempted to make that 1000
relic cap effect this too." Clarified by multiple choice: "Museum relics compound" (in the main game, relic copies
past the 1000 soft cap keep growing the Museum bonus in a compounding way, instead of freezing). OPEN: this conflicts
with the user's D23 rule (stacking bonuses use concave curves, never compounding) and with the soft cap design (calls
3 and 4: counts freeze for the regular game at 1000, the past-cap count is kept for a future Endless Mode). Awaiting the
user's pick of how (see the next USER ANSWERS block). The R2-4 provisional picks (MUSEUM_V2_PER_COPY, MUSEUM_V2_KNEE
0.25, SOFT_CAP_FREEZES_EXCEPTIONAL false) and the Tier I veteran flag are also still unanswered.
USER (2026-10-22, verbatim, answers the above): "That as you get more relics, the relics can all give a specific
multiplier. The soft cap for the relics affects endless mode, but ALSO affects the minigame HL. Scales generators,
overclock, talents, etc."
Reading: the soft cap still freezes the regular game at 1000; relics (the past-cap count, and possibly all of them)
each give a specific multiplier that feeds BOTH a future Endless Mode AND the secret minigame "Hyperion Legacy
v0.0000001a" (generators, Overclock, its skills/talents, and so on). So the main game's relics become a cross-link
into the minigame. Details (which relics, which stats, which patch) being settled by multiple choice.

## USER ANSWERS (2026-10-22): relics feed the minigame

1. Which relics: "Every relic, past-cap extra" (every identified relic gives the minigame a small multiplier; copies
   past a tier's 1000 cap give a bigger one: the cap stops helping the main game, so it pours into the minigame).
2. Mapping: "By relic type (Recommended)" (each relic kind maps to one minigame lever, for example generators,
   Overclock, skills; collecting variety matters). The exact kind-to-lever table is a [PROPOSAL] for sign-off.
3. Timing: "With 0.14.0 (Recommended)" (ships with Relics v2; the minigame shows a "Relic boosts" line).
4. Two-way: "Only via milestones" (the minigame never multiplies the main game; its milestones pay main-game rewards
   in a later patch, as already decided).
Notes for the build: compounding is allowed INSIDE the minigame (it is sealed from main-game balance; D23 still
governs the main game); the minigame pacing sim must be re-run with realistic relic counts so the finale stays 3 to 5
days and e1,000,000 about a month for a player WITHOUT relics, and the boost is reported for typical relic counts;
the past-cap count also stays recorded for Endless Mode. New 0.14.0 slice: "R2-10 relic boosts in the minigame".
