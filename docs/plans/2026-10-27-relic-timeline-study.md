# Relic timeline study: how long to the minigame's relic limit (main game rules, 2026-10-27)

Prestige redesign plan Slice 0, design section 3.7. Measured from the MAIN game's real rules on `feat/crew-0.14.0`
(795a2c1). No code changed. Status: for the user before Slice 5 tunes the 2.5x relic ceiling.

## Summary

| Goal | STEADY (1 explorer about 16 h a day, drive class = the tier, 2 Tier I short-range missions) | HEAVY (3 explorers on Repeat, Class VII drive, 4 Tier II short-range missions) |
|---|---|---|
| 1,000 identified, Tier I | 101 d | 15 d |
| 1,000 identified, Tier II (days at the tier, then cumulative) | 188 d (288 d) | 17 d (33 d) |
| 1,000 identified, Tier III | 208 d (497 d) | 17 d (49 d) |
| 1,000 identified, Tier IV | 236 d (733 d) | 21 d (70 d) |
| 1,000 identified, Tier V | 403 d (1,136 d) | 42 d (112 d) |
| 1,000 identified, Tier VI | 813 d (1,948 d) | 139 d (251 d) |
| 1,000 identified, Tier VII | 1,813 d (3,761 d, about 10.3 years) | 597 d (848 d, about 2.3 years) |
| First copy of all 17 types (the "last of the 16") | about 51 d, at Tier I | about 6 to 8 d |
| 10,000 RAW copies of every type (bottleneck: Living Crystal) | about 744 years | about 88 years |
| 10,000 WEIGHTED copies of every type (5x past a tier's cap, the minigame's count) | about 149 years | about 18 years |
| Rarest type after 1 year (raw / weighted) | about 13 / 50 | about 110 / 540 |

Read this first:
1. **No relic type is gated by tier today.** Identification reads the Tier I band row of the blank's own rarity at every
   tier ("Only one boost", `relicIdentify.ts:64`, `:150`), and that row lets even a standard blank reveal a radiant type
   1% of the time (`relics.ts:487`). So all 17 types turn up at Tier I in about seven weeks of steady play. The user's
   rule "You'll need to get into higher tier content to be able to even unlock the last of that 16" does NOT hold in the
   code. Whether to gate the radiant (or rarest) types by tier is the user's call.
2. **Tier barely changes the type mix, transit dominates.** Radiant blanks roll only on Toxic bodies (hazard 0.9, the only
   planet type whose ceiling reaches index 3), so the rarest type's share only climbs from 0.40% (Tier I) to 0.78%
   (Tier VII), while a Tier VII round trip is 336 h of transit. Per hour, higher tiers pay fewer copies of every type
   (the heavy player's best tier for the rarest type is Tier III, barely ahead of Tier I).
3. **10,000 of every type is out of reach.** The rarest type is 0.40% of identified relics, so 10,000 of it is about
   2.5 million relics. With the 5x past-cap weight it is still about 18 years for a heavy player. A ceiling "about
   reached with 10,000 copies of every type" would never be approached by anyone. Slice 5 needs either a knee set
   against reachable counts (for example the heavy player's count after 1 to 3 years) or higher drop rates; the
   user decides which (Decisions are the user's).
4. **The Lab never gates.** One study lane reads about 5.5 blanks an hour (mean 11 to 12.6 min a blank); the steady
   player finds 0.41 an hour, the heavy player 2.8. Four lanes (Lab VII) clear about 19 an hour, about 20 explorers.

## Method

Expected-value math from the real constants, run once as a throwaway vitest script that imported the shipping tables
(not committed; every number below is reproducible from the formulas), plus one measured check of the Tier I rate.

1. **Type mix per blank, per region tier (exact).** For each of the 8 planet types (uniform, `expedition.ts:603`) and
   each relic-bearing PoI in its surface and underground pools (`expeditionContent.ts:289`, `relics.ts:404`):
   finds = 3.5 attempts (`expedition.ts:259-260`) x pool odds (0.5 + the type's pool bias, `expedition.ts:261`,
   `:1974`) x the PoI's pool weight share x the relic chance 35% + 40% x hazard (`gambit.ts:2343-2344`, `:2410`).
   The blank's rarity rolls `RELIC_BLANK_WEIGHTS[tier]` (`relicBlanks.ts:67-80`) up to the hazard ceiling
   round(3 x hazard) (`relicBlanks.ts:89-92`; hazards `expeditionContent.ts:49-55`, `:203-220`). Identification
   (`relicIdentify.ts:133-156`): the exceptional check `EXCEPTIONAL_PER_100K[tier][band]` (`relics.ts:919-931`; it
   counts toward the tier total but is none of the 17 types), else the band from the Tier I row
   (`relics.ts:487-492`), else a type in the band, its PoI's old set doubled (`relics.ts:821`, `relicBlanks.ts:249`).
2. **Blanks per explorer-hour, per tier.** Tier I: `EXPEDITION_RELIC_BLANKS_PER_HOUR` 0.5 (`relicBlanks.ts:181`,
   measured 2026-10-21 for a rank 6 crew). Re-checked here with the WR-2 simulated player (`sim/simPlayer.ts`,
   policy allAuto: weakest crew, Orion, seeds 0 to 2, 72 h): completed Tier I runs took 7.0 to 9.0 h and found 0.5
   to 0.65 relics an hour; the weakest crew stalls a run in two of three seeds (left out). Backed out: 2 bodies, 2 h
   on site and 2 relics per body, 2 h legs. Deeper tiers keep 2 h and 2 relics per body (the relic chance never reads
   the tier, user call 13), with more bodies (`TIER_BODY_COUNT` midpoints 2, 2, 2.5, 3, 3, 4, 4, `expedition.ts:422`)
   and longer legs: `TIER_TRANSIT_HOURS` 2, 4, 8, 12, 24, 72, 168 h one way (`voyage.ts:33`), band scale 1.0 on
   average, halved per drive class above the tier, never under 30 min (`voyage.ts:35`, `:74-85`).

| Tier | Drive class = tier: run, relics/h | Class VII: run, relics/h | Rarest type share | Radiant band | Exceptional |
|---|---|---|---|---|---|
| I | 8 h, 0.500 | 5 h, 0.800 | 0.400% | 1.83% | 0.30% |
| II | 12 h, 0.333 | 5 h, 0.800 | 0.444% | 2.03% | 0.39% |
| III | 21 h, 0.238 | 6 h, 0.833 | 0.487% | 2.22% | 0.51% |
| IV | 30 h, 0.200 | 9 h, 0.667 | 0.543% | 2.48% | 0.66% |
| V | 54 h, 0.111 | 18 h, 0.333 | 0.607% | 2.76% | 0.86% |
| VI | 152 h, 0.053 | 80 h, 0.100 | 0.685% | 3.11% | 1.14% |
| VII | 344 h, 0.023 | 344 h, 0.023 | 0.778% | 3.53% | 1.52% |

The rarest type is Living Crystal at every tier (radiant, and its old set, Xenobiology, is sourced by one PoI only,
Xeno-Flora Bloom, so the site bias favors it least); then Captain's Sigil, Heart of the Archive, Tectonic Keystone.
The commonest is Geode Core (about 16%).

3. **Short-range missions** (`relicBlanks.ts:185-214`): 0.5 x 0.08 = 0.04 blanks an hour (Tier I mission), 0.075
   (Tier II), always a Tier I standard blank with no site (`:189`), so 60/30/9/1 by band (Living Crystal 0.25%).
4. **The goals.** (a) 1,000 identified per tier = `museumTierTotal` (general plus exceptional copies,
   `relics.ts:1115`) reaching `RELIC_SOFT_CAP` 1,000 (`relics.ts:1044`), the player farming one tier at a time from
   the day it opens, short-range feeding Tier I only. (b) Copies per type summed over every tier, the way the minigame
   reads them (`secret/relicBoosts.ts:30-45`): raw, and weighted (a copy past its tier's cap counts 5x,
   `secret/config.ts:181`; the 18 and 149 year figures count every copy at 5x, slightly optimistic), at the tier that
   gives the most of the rarest type per day. (c) The expected time until every one of the 17 types has at least one
   copy: E[max] of the 17 types' exponential waits, integrated numerically.

## The players (every assumption)

- **STEADY** (the R2-10 typical, `docs/plans/2026-10-17-relics-v2-plan.md` R2-10 carry note, and
  `secret/relicCollections.ts`): one explorer out about 16 h a day while a run is 16 h or shorter; on longer runs out
  all the time except an average 4 h wait for the next check-in between runs. Two Tier I short-range missions around
  the clock (1.92 blanks a day). Drive class equal to the tier (the first ship that can enter it).
- **HEAVY**: all three explorer hulls (Orion, Aurora, Eir, `model.ts:1374`, `:1401`, `:1429`) out on Repeat, 24 h a
  day, each with a Class VII drive (the most any ship can have, `propulsion.ts:32`, `:55-64`), all at the same tier.
  Four Tier II short-range missions around the clock (7.2 blanks a day). Each extra explorer adds its share linearly.
- Not modeled, each only shortens the times and none changes their order of magnitude: Museum relic find chance
  (Precursor Lens), the captain's Field Science and Relic Hunter, the harder-task find bonus (`riskFactors.ts:406`,
  about +47% on the hardest grade), transit speed, sensor arrays, the planet 100% bonus blank (still pending G7), and fights a
  deeper tier's crew loses (that one lengthens them). The relic chance tops out at a certain find (1,000 permille), so
  even a doubled find rate leaves the 10,000-of-each goal at decades for the heavy player.

## Where tier access gates the timeline

- **Entry:** a tier needs an explorer hull, a drive of class at least the tier (`voyage.ts:52`, `propulsion.ts:135-153`)
  and frontier sensors 0, 10, 20, 30, 40, 55, 65 (`propulsion.ts:93`). Every explorer hull starts at Class I
  (`propulsion.ts:38-41`); Class II to VII drives are researched and crafted (`model.ts:10881-10887`: 2,400 to 96,000
  credits, Class VI and VII also antimatter cells) behind Research Lab and Fabricator tiers. The study counts days at a
  tier from the day the player can enter it; the gear climb before that is extra.
- **Transit is the real gate:** Tier VI and VII legs are 72 and 168 h even at the class that just enters them, and no
  Class VIII exists (`propulsion.ts:32`), so a Tier VII round trip is two weeks for everyone. Tier VII alone is 5 years
  (steady) or 1.6 years (heavy) to 1,000.
- **Types are not gated** (see Summary point 1): the tier only shifts the blank rarity table, and only Toxic bodies can
  roll a radiant blank anyway.

## Side finding for the controller

`secret/relicCollections.ts` `bandShares` (the R2-10 heavy collection's Tier II and III copies) reads
`RELIC_BAND_ODDS[tier]` for the revealed band, but identification reads the Tier I row at every tier ("Only one boost",
`relicIdentify.ts:62-64`). The test helper applies the tier boost twice, so the pinned heavy collection holds a little
more of the rare types than the real game would give. Test-only, but Slice 5 tunes against these collections.
