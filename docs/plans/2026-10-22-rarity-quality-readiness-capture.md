# 0.14.0: every planned rarity and quality ready to implement and balance (capture)

Status: CAPTURE (2026-10-22). Audit pending. Branch `feat/crew-0.14.0`.

## User request (verbatim, 2026-10-22)

"Oh, and one thing as well. Not for this minigame, but something we must ensure is ready to go. All of the planned
rarity and qualities for items of all types will need to be ready to implement and balance. So the set item and
legendary equivalents. Even the secondary tier past those as well. The secondary tier likely won't be used yet. Maybe
even legendaries and sets might go unused. But we want to ensure that if we decide to bring them in during this pass,
that they work."

Reading: for the 0.14.0 balancing pass, every planned rarity and quality tier (for every item type), including set
items, legendary equivalents and the tier past those, must exist in code and work end to end, so any of them can be
switched on during balancing. They may stay unused (hidden or not dropping) in the release.

## Audit result (2026-10-22, read-only, feat @ ffcc3aa)

Summary. LIVE end to end: the gear ladder Standard to Radiant for every equipment family (ship slots, weapons, drones,
member gear, crew modules, sensors, E-MOD modules); gear quality Q0 to Q5; material rarity common to legendary;
material quality Q0 to Q5; Relics v2 exceptional sets (engine, placeholder names). SAFE BUT HOLLOW: Luminous and
Constellar (type, tokens, labels, auto-salvage, sort, archive, salvage and save all handle them; a minted piece is
valid) but (1) nothing produces them (no talent proc, no equipment drop source, the dev picker cannot mint them),
(2) they are numerically identical (both rarityIndex 5: "Radiant plus 15%" in two colors), (3) their defining
mechanics do not exist (Luminous unique legendary affix, Artisan, the secondaries, Constellar set bonuses). GEAR SETS
DO NOT EXIST (no catalog, no set id on a piece, no piece counting, no bonus fold; the E-MOD "set" module category has
a type and setId but its engine EM-7 is unbuilt). THE TIER PAST LEGENDARY (Nova and Celestial ascension) is a stored,
inert field (always "none", nothing reads it; Celestial is drop-only and equipment has no drop path).

Silent-malfunction traps: crew above Stellar falls back to x1.0 (crewRarity.ts:38-41, so raising the cap makes Radiant
crew weaker than Stellar); legendary relic blanks fold to Radiant (relics.ts:464-476, 765-772); an unknown rarity
string gives NaN; warehouse tile colors bypass the rarity tokens (App.svelte:2290-2302, misses the cbsafe palette).

Planned ladder (epic design docs/plans/2026-07-17-ship-equipment-combat-epic-design.md:126-166, :491;
equipment-0.11.0-design.md:94-101; SUGGESTIONS.md:175-176): Derelict, Standard, Augmented, Stellar, Radiant; legendary
class at the same power tier: Luminous (gold, a UNIQUE legendary affix, 2 secondaries, 25% Artisan chance) and
Constellar (red, set bonuses 2/3/5-piece, ~18 sets across 9 hulls + generics; 2nd secondary replaced by sets);
ascension on Luminous/Constellar only: Nova (crafted via a talent proc plus higher-quality materials, +25% budget) and
Celestial (drop-only, cannot be crafted or sold; Celestial Constellar sets need 1 fewer piece). Quality 0 to 5 on
every item (epic section 4).

Contradictions: Derelict meaning (drop-only vs decay state vs junk tier); Constellar color (red in the doc vs rose
#f472b6 in app.css); legendary budget (+20% in the doc vs a 1.15 step in code); producers (proc "defined so the data
supports it" but no node or function; Celestial drop-only with no drop source); three unreconciled set concepts
(Constellar gear sets, E-MOD set modules, relic sets); ships have quality in the epic but nowhere else.

Suggested slices: (1) hardening (normalize unknown rarity/ascension on load; total-safe rarityIndex, affixCount,
computeBudget; round-trip tests); (2) dev tooling (devMint and the ?dev picker offer the full ladder plus ascension);
(3) a per-rarity profile table (budgetMult, affixes, extra chance, secondaries) with Standard to Radiant goldens
bit-identical; (4) ascension seam (multiplier, validity, label, sort); (5) Luminous legendary affix catalog;
(6) one shared set engine (GEAR_SETS, 2/3/5 thresholds, piece counting per ship and member, Celestial minus-1 hook;
EM-7 reuses it); (7) producibility switch (flag or talent proc, offline == live); (8) small traps (crew multiplier
rows, warehouse tokens, relic blanks decoupled, 5th salvage ceiling row, set-complete chat shoutout).

## USER ANSWERS (2026-10-22), round 1

1. Legendaries: "As designed (Recommended)" (Luminous carries a unique legendary affix; Constellar carries set bonuses
   2/3/5-piece, per the July epic design).
2. Sets: "Engine + test sets (Recommended)" (one shared set engine for gear and E-MOD modules, proven with 1 or 2 test
   sets; real set content only if balancing wants it).
3. Ascension: "Plumbing only (Recommended)" (Nova and Celestial get real data, budget boost, the Luminous/Constellar
   only rule, labels and sorting, behind a switch; no way to obtain them yet).
4. Producer: "Dev mint now, proc later (Recommended)" (a Debug minter for every tier for balancing; the real
   crafting-talent proc is designed when the user decides to ship them).

Still open (next round): legendary budget step (+20% doc vs 1.15 code vs per-rarity table), secondaries (Stellar and
up, would change live pieces), Derelict meaning, crew multiplier rows above Stellar, relic blanks at legendary tiers,
quality on ships and field kits, Constellar color (red doc vs rose code).

## USER ANSWERS (2026-10-22), round 2

5. Budget step: "Per-rarity table (Recommended)" (each rarity gets a tunable row: power, affix count, extras;
   legendaries start at the design's +20% over Radiant; live tiers stay exactly as they are).
6. Secondaries: "Legendary and up only (Recommended)" (only Luminous/Constellar get them; live Stellar and Radiant gear
   unchanged).
7. Crew tiers: "Yes, same for both (Recommended)" (add multiplier rows Radiant to Constellar so higher crew are always
   stronger; Luminous and Constellar crew share one value; the cap stays at Stellar until the user raises it).
8. Constellar color: "Keep rose" (#f472b6).

Still open: Derelict meaning; relic blanks at legendary tiers; quality on ships and field kits.

## USER ANSWERS (2026-10-22), round 3

9. Derelict: "Unify, keep unmade (Recommended)" (still never produced; one consistent rule everywhere, treated as the
   Standard-Issue floor, so it cannot misbehave if it ever appears).
10. Relic blanks: "Decouple them (Recommended)" (separate the relic blank ladder from the salvage pool so legendary
    salvage later neither creates nor flattens legendary relic blanks).
11. Quality on ships and field kits: "Out for 0.14.0 (Recommended)" (logged for a later patch; field-kits call 16
    stays "kits ignore quality").

All readiness calls answered. Build: the eight audit slices as scoped by answers 1 to 11 (hardening; dev mint for
every tier incl. ascension; per-rarity profile table, legendaries +20% start, secondaries legendary-only; ascension
plumbing behind a switch; Luminous legendary affix catalog; one shared set engine with 1 or 2 test sets, EM-7 reuses
it; no producer beyond dev mint; traps: crew rows Radiant to Constellar sharing one legendary value, warehouse tokens,
relic blanks decoupled, salvage ceiling row, set-complete shoutout, Derelict unified). Counts as a NEW system on the
progress card (33 total).

## USER ANSWERS (2026-10-22), round 4 (supersedes answer 11)

User: "Build in 0.14.0 or make absolutely sure that it's implemented in time for the balancing patch (0.16.0). We also
need online in a subpatch right after this one, and the tutorial/story/quest patch too. So keep that in mind as well."

11b. Ship and field-kit quality: "Due before 0.16.0 (Recommended)": NOT in 0.14.0; a must-land roadmap item built in
     the patch before balancing, with a RELEASE GATE: 0.16.0 cannot start without it.
12.  Roadmap order: "0.14.1 online, 0.15 story, 0.16 balance" (0.14.1 or 0.14.x = online subpatch right after
     0.14.0; 0.15.0 = tutorial/story/quests; 0.16.0 = balancing). This supersedes the older order in
     docs/plans/2026-09-15-exploration-crew-saga-0.14.0-design.md:31 and :590-591.

## OPEN CALLS for the user (2026-10-23, from the RR plan and its review; building continues on [PROVISIONAL] defaults)

1. Artisan: the design's "+50% min / +25% max" has no roll range to apply to today; default folds it into one random
   rolled line x1.25 on Luminous/Constellar at 25% chance.
2. Legendary affix names [PROPOSAL]: Starfall Lance (weapon), Hivemind Relay (drone pod), Aegis Lattice (shield),
   Bulwark of Sol (plating), Bottomless Hold (cargo), Fold Engine (FTL), Heart of a Star (reactor), Far Watcher
   (sensor), Last Stand Weave (member armor), Oathkeeper (member weapon), Master's Touch (member tool), Second Sight
   (implant).
3. Test set names [PROPOSAL]: "Survey Cadre" (ship) and "Field Cadre" (member), dev mint only.
4. Numbers [PROVISIONAL]: legendary 1.2x Radiant; Nova 1.25x; Celestial 1.4x; crew Radiant 1.55, legendary 1.8; salvage
   5th tier at FA level 20; secondaries 0.15 of budget each.
5. "Unique legendary affix": one-of-a-kind line only (default), or ALSO an equip limit (at most one per ship per id)?
   The equip limit is NOT built until the user says so.
6. Nova guarantees the Artisan line and Celestial adds one secondary (reading of the design's "Luminous-effect stats
   guaranteed").
7. The ascension "switch" = producibility only (no player can get Nova/Celestial; the math acts for dev-minted pieces).
8. Secondaries are drawn with replacement and can stack onto an existing affix line.
9. Celestial "cannot be sold": blocked from auto-salvage only; manual salvage allowed.
10. The member test set's 5-piece tier is reachable only with 2 implant slots (augment affinity) or Celestial minus-1.
11. RR-5 built (56009f9): the affix list changed from item 2 above. Now 13 [PROPOSAL] names: Starfall Lance
    (weapon), Hivemind Relay (drone pod), Aegis Lattice (shield), Bulwark of Sol (plating), Bottomless Hold (cargo),
    Endless Wake (fuel, replaces "Fold Engine" because transit speed is still pending at patrols), Heart of a Star
    (reactor), Transmuter's Seal (spec utility, material quality chance), Grand Concourse (colonist capacity),
    Oathkeeper (member weapon), Last Stand Weave (member armor), Master's Touch (member tool, relic find), Second
    Sight (implant). Each worth 0.25 of the piece's budget [PROVISIONAL]. Bridge, sensor and universal modules get NO
    legendary affix for now, because their only stat lines are read by nothing yet (an affix there would be inert).
12. Luminous and Constellar modules (bridge, quarters, sensors, E-MOD) are now Radiant x1.2 like gear; Nova and
    Celestial multiply that.
CORRECTION to open call 11 (2026-10-23, from the RR-5/RR-6 review): the sensor exclusion was based on a false reason.
The sensors line IS live (survey yield, the expedition sensor gate, region charting, scan events, short-range work),
so the sensor slot GETS a legendary affix: "Far Watcher" (sensors) [PROPOSAL], as originally drafted. Bridge
(crewEfficiency pending, WR-7) and universal modules (empty pool) stay excluded, honestly. The "Fold Engine" drop was
also misexplained: transit speed is live on the sheet and in expeditions, just like cargo and fuel are partly pending
elsewhere. OPEN CALL 13: the FTL drive's legendary affix: "Fold Engine" (transit speed) or "Endless Wake" (fuel
capacity, built now)? OPEN CALL 14: set bonuses and gear wear: default being built = set tiers scale with the mean wear
efficiency of their counted pieces (a fully worn set gives 75%), consistent with how worn gear works; alternative =
set bonuses never wear. OPEN CALL 15: set tier magnitudes are flat (not scaled by item level), so they are large at low
item level; [PROVISIONAL] for balancing.

## MERGED into feat (e4246d5, 2026-10-23) after the holistic review ("merge"). Logged for later

- Archive score and salvage time ignore ascension (a Nova Luminous scores like a plain Luminous): revisit when Nova or
  Celestial becomes producible.
- MUST ANSWER BEFORE LEGENDARIES CAN DROP: keep-best ranks item level first, so the duplicates auto-salvage rule can
  queue a non-Celestial Luminous or set spare behind a higher-iLevel Standard of the same blueprint (salvage.ts
  ~1664-1699); only Celestial is protected.
- 0.14.0 RELEASE HAZARD (predates this work): production writes SAVE_VERSION 54; a v70 save exported from staging and
  imported into production is written back stamped v54, and importing it back to staging re-runs migrations 54 to 69
  over v70-shaped data. Guard the import/export path before 0.14.0 ships.
- Optional: skip gearSetBonusLines in equipmentStatMods when no piece is Constellar or a module (fold ~40% slower per
  call; a 6-hour tick run ~3 to 4% slower).
