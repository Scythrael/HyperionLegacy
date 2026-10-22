# 2026-10-19 answers for the CP-2 / FKR-3 / WR-5b / WR-5c merge batch

Recorded verbatim from the user's multiple-choice answers on 2026-10-19. These bind the field kits plan
(`2026-10-14-field-kits-plan.md`, FKR-3 and FKR-7) and the wiring registry plan (`2026-10-15-wiring-registry-and-audit-plan.md`,
section 5.A captain nodes). Kept in their own file so the parallel integrator's carry notes do not collide.

- **Antitoxin price:** "Biomass + Titanium, 60 (Recommended)": recipe becomes 1 Purified Biomass + 1 Titanium Ingot,
  makes 2; priced like First Aid (60) with a different recipe.
- **Splint price:** "Raise to Tier 2 band (Recommended)": add a second ingredient (for example 1 refined Tier 1
  material) so the Splint lands near 100, between First Aid and Stim.
- **Recruiter (WR-5c):** "Best one counts (Recommended)": the fleet-wide boards use the highest Recruiter in the fleet;
  owning it twice adds nothing. Replaces the built compounding.
- **Point Defense (WR-5b aegis4):** "Divide enemy hit chance (Recommended)": incoming hit chance divided by 1.05, as built.

- **Wing Commander (WR-5b fleetOps4):** "+5% drone replenish (Recommended)", as built.
- **Alpha Strike (WR-5b gunnery5):** "Each weapon's first (Recommended)": each weapon's first shot of the battle, as built.
- **Field Science / Preservationist (WR-5c):** "As built (Recommended)": Field Science its own x1.05 factor;
  Preservationist study speed x1.08 (600 ticks become 556).
- **Away-Team Doctrine (WR-5c):** "Security only (Recommended)", as built.

- **Deep Scan (WR-5c):** "Keeps range (Recommended)", as built.

- **Drillmaster (WR-5c):** "Fractional, as built (Recommended)".

## Prospecting squads review calls (2026-10-19)

- **Hazard Suit ARM/HP on a Prospecting wearer:** "Give ARM/HP a dig meaning (Recommended)": Armor and HP reduce
  cave-in and retreat injuries for a Prospecting wearer, so every line acts for every wearer.
- **Prospecting recruit board slots:** "3, like the others (Recommended)".
- Builder calls accepted as built: the unlock takes effect immediately; PROSPECTING_BLUEPRINTS sit outside BLUEPRINTS
  until the quests patch. The Claim / Dig glyph stays [PROVISIONAL] and needs a mockup + SVG review before it is visible.


## FKR-4 / G2-2 review calls (2026-10-19)

- **Fear chance:** "20% per landed hit (Recommended)": FEAR_ON_HIT_PERMILLE 200, no longer provisional.
- **Flash grenade target:** "Squad's biggest threat (Recommended)": foeHighestThreat, no longer a proposal.
- **Bleed inflictor:** "Strikers on a normal hit (Recommended)": Strikers' landed normal hits can cause Bleed;
  Hemorrhage stays their Execute version.
- **Wolf 359 for veterans:** "Next list for veterans (Recommended)": any save that has never seen Wolf 359 gets it in
  its next Tier I list, once.
- **Hemorrhage timing:** "Execute hits, target survives (Recommended)", as built.
- **General perk on guest quarters:** "Whole total (Recommended)": base + modules x1.10 whenever any quarters module
  is installed on a General hull, as built.
- **Guest quarters display before Short-Range:** "Hide until Short-Range (Recommended)": the Ship Systems row appears
  once Short-Range Missions are in (G1-4 / G1-6 flips it).

## WR-6 placeholder talent sizes (2026-10-19, all Recommended; the [PROVISIONAL] tags can drop)

- **Hub talents:** "+5% each": TACTICIAN_HUB_WEAPON_DAMAGE 0.05 (OC-A40), EXPLORER_HUB_SCAN_RATE 0.05 (OC-A41).
- **Specs:** "+1% per point": TACTICAL_SPEC_WEAPON_DAMAGE 0.01 (ship weapons only, not drones), SCIENCE_SPEC_RELIC_FIND
  0.01 (OC-A42).
- **Captain race:** "Same as an officer": CAPTAIN_RACIAL_SCALE 1 (OC-A43).
- **Homeworld rungs:** "Approve all": WORKS_DIRECTORATE_BONUS_CHANCE 0.05 (OC-B2), HOME_GUARD_PATROL_SHIELD 0.05 and
  CIVIC_CHARTER_TRANSPORT_CREW 1 (OC-B3).
- **Bleed chance:** "15% per landed hit (Recommended)": BLEED_ON_HIT_PERMILLE 150, confirmed.

## Provisional numbers confirmed (2026-10-19, all Recommended; tags can drop)

- **Hull guest quarters:** "Approve": HULL_GUEST_QUARTERS Eir 80, Orion 40, Aurora 40, General Freighter 20, others 0.
- **Guest Wing:** "4 per point, 4 crew": GUEST_QUARTERS_PER_POINT 4, GUEST_WING_CREW_CAPACITY 4.
- **Crew Effectiveness knee:** "Knee 0.2" (CP-2).
- **Famous star rate:** "1 in 12" (G2-2).

## G2-3 / FKR-5 provisional picks (2026-10-20)

- **Voyage band scale:** "x0.8 to x1.2 (Recommended)" (NOT the built x0.75 to x1.25): tiers never overlap; the
  farthest Tier III just meets the nearest Tier IV at 9.6 h. VOYAGE_BAND_SCALE_PERMILLE changes to 800..1200.
- **Anomaly detour:** "25% of outbound (Recommended)": VOYAGE_ANOMALY_DETOUR_PERMILLE 250, as built.
- **Stun / Toxin grenade damage:** "Half damage (Recommended)", option text "Stun/Toxin hit for 0.5x; Impact is the
  damage grenade at 1.5x": SPECIALIZED_GRENADE_POWER_MULT 0.5 as built (0.5x power, i.e. one third of the Impact).
- **Impact Grenade recipe:** "Approve (Recommended)": 1 Titanium Ingot + 1 Polysilicate Wafer + 1 Power Coupling, Tier 1,
  700 credits research.

## G1-2 provisional picks (2026-10-20, all Recommended; tags can drop)

- **Short-range Range:** "90 / 130 ly": real light-years, round trip, Tier I / Tier II.
- **Security sheet and prisoner groups:** "Approve": Security 1 at Tier I, 4 at Tier II; groups 20 to 40 and 40 to 70.
- **Reward materials:** "Approve": Supply Pickup pays Titanium Ore (commonOre), Phenomenon Survey pays Iridium Ore
  (rareMaterial).
- **Names:** "Approve": template key prisonerTransport, label "Prisoner Transport"; mockup placeholder designations
  and phenomenon names for destinations.
- **Overtime on expeditions:** "No, not expeditions (Recommended)": expeditions stay fixed; the free time skip seam
  still applies.
- **Field Kits before FKR-7:** "Hide until kits are live (Recommended)": the Impact Grenade blueprint and the +1 Carry
  Capacity craft line stay hidden until FKR-7 wires kits into runs.
- **Prospecting dig safety knee:** "Knee 1 (Recommended)": DIG_SAFETY_KNEE 1, confirmed.
- **Hotfix 0.13.10:** user tested it on staging: "Tested OK, promote it" (2026-10-20).
- **Power efficiency knee (EM-1):** "As built (Recommended)": POWER_EFFICIENCY_KNEE 0.25 (one Overdrive officer about
  8%, 0.5 total about 24%), confirmed (2026-10-20).

## Relics v2 constants and Spacer (2026-10-20)

- **Spacer racial:** "Wire a simple racial now (Recommended)": Spacer gets a small working racial in 0.14.0 so no race is
  inert; the full Spacer ramp stays 0.14.x (T3). Belter (CP-4, faster drone replenish) and Outer Colony / Vael (CP-3,
  faster scans) are wired by their CP slices in 0.14.0.
- **RELIC_TYPE_STATS + RELIC_TYPE_WEIGHT:** "Approve (Recommended)": each relic keeps its old set-position stat; equal
  weight in a band before site bias.
- **RELIC_BAND_ODDS_ANCHORS:** "Approve (Recommended)": Tier I unchanged; Tier IV and VII anchor rows as built,
  interpolated between.
- **EXCEPTIONAL_PIECE_VALUE / EXCEPTIONAL_FULL_SET_MULT:** "Approve (Recommended)": +3% at Tier I to +15% at Tier VII
  per piece; full set 5x one piece. EXCEPTIONAL_PIECE_STAT_CYCLE stays a placeholder until the name sign-off sheet
  assigns stats with the names.

## Spacer bonus, FKR-6 and G1-3 picks (2026-10-20)

- **Spacer racial:** "+Transit speed (Recommended)": a small travel-speed racial at the usual officer racial size.
- **Default grenade reserve (FKR-6):** "Save for Elite or Boss (Recommended)": the kept grenade goes on an Elite or a
  Boss, whichever shows up (not Boss only).
- **Short-Range board rungs (G1-3):** "Approve (Recommended)": level 2 = 2,500 credits / 120 ticks (Tier II slot behind
  the 50-completion gate), level 3 = 6,000 credits / 240 ticks, fourth slot Tier II, no completion gate.
- **Kit rules (FKR-6):** "Approve all (Recommended)": basics before extras; Combat Stim rounds scale with skill (min 1);
  "on a Boss" = while a Boss stands; one Injury Kit per downed member per battle; Triage preset kit rules as built.

## FKR-7 run rules (2026-10-20)

- **Kit packing and cap rules:** "Approve both (Recommended)": a kit a member cannot use is never packed or bought; a
  Quartermaster purchase is refused if it would go over the warehouse cap, but kits returning from a run may go over it.
- **Pack screen mockup:** "Yes, mockup now (Recommended)": draft the FKR-9 dispatch packing screen for sign-off so kits
  can go live in 0.14.0.
- **Kits switch-on timing:** "Yes, with the pack screen (Recommended)": FIELD_KITS_RUNS_LIVE and FIELD_KITS_PLAYER_LIVE
  flip together in the pack screen slice (FKR-9/10), still 0.14.0.
- **Free First Aid Kit curve (FKR-2):** "Approve (Recommended)": Medical + Operations headcount 0-4 = 1, 5 = 2, 15 = 3,
  27 = 4, 41 = 5, 57 = 6, diminishing, no cap.
- **Short-Range engine rules (G1-4):** "Approve all (Recommended)": extraction-roll talents out of scope for short-range;
  one log entry per run end; a recall while still at home ends at once and returns the training run.

## 2026-10-21 calls

- **Comet economy bug:** "Cut ice to ~4 credits (Recommended)": Deuterium Ice sells for about 4 credits (a crafting
  input, not a money run); the Deuterium Canister still sells for 450.
- **Training run vs Field Kits conditions:** "Approve (Recommended)": the training run's enemies skip the field kits
  conditions; ordinary runs unchanged.
- **Timed grenades fuse:** "1 round later (Recommended)": Impact Grenade is the default and explodes on contact; Stun and
  Toxin grenades detonate at the start of the thrower's next turn (enemies may move out of a cluster first).
- **Mockups to start now:** all four: Short-Range board; Expedition dispatch console; gas giant study screens; Relics v2
  culture view + Material Lines Refinery layout + Modules row and power bar.

## Mockups published 2026-10-21 (awaiting sign-off)

- Short-Range board (G1-6): https://claude.ai/artifact/HhEA9ARvKjjfAhbnZBSdg3
- Expedition dispatch console (G2-6): https://claude.ai/artifact/AnWvt9kfqAUJo1sCMkTpMC
- Gas giant study v3 (GG-6): https://claude.ai/artifact/RR2pwa3wQmTGPm2ZHQeGEN
- Relics v2 + Refinery + Modules (R2-8, ML-7, EM-10): https://claude.ai/artifact/6Pat4nwfbWzsUsqKUdMpKo

## Mockup sign-off (2026-10-21, verbatim): "I approve all 4 mockups as is. They all look excellent!"

All four mockups above are signed off AS DRAWN: every open question on each page resolves to the option shown (as
drawn). Recorded picks so far: G1-6 (pre-pick + one-tap Send; Home shows waiting slots; job types collapsed on the board;
Repeat toggle on by default; shortRange and commBooster glyphs approved); G2-6 (tabs with the map as the alternative;
dimmed preview of locked tiers; resumables in their own region; a pre-arrival recall returns the system to ordinary
candidates; "None can be built yet" wording; Launch in a bar under the candidates; the four new glyphs drive / reach /
recall / resume approved for icons.ts review); GG-6 (as drawn: decode the next entry of the fragment's own culture; data
study as its own Research Lab tab; oldest held data first; no research-data warehouse shelf; nebula sweep on the ship
lane); R2-8 / ML-7 / EM-10 (as drawn: shelves by rarity band per tier; hatched past-cap bar; culture samples under each
type; inline reveal card; compounds with their main raw's line; no "more recipes" note; per-quality chips visible;
"Use best materials" starts lowest-first; spec utility as a tile in the Modules row; one power bar with hatched cut and
shaded surplus; over-budget flag on this screen; one-line Active rule text).

## Timed grenade review calls (2026-10-21, all Recommended)

- Fight ends before detonation: "Refund it": the charge comes back; the log says the fight ended before it went off
  (also for a final-round throw).
- Moved clear: "20%, lone targets can't dodge": GRENADE_FUSE_MOVED_CLEAR_CHANCE 0.2 for groups; a lone target always gets hit.
- Enemy flash grenade: "Keep instant".

## Session limit hit 2026-10-21 (resets 11:30am PT): builders to resume by message (work saved in their worktrees)

- SI member gear (worktree-agent-a0c138af05f2fe43b): was writing its carry note after the budget-floor + Science lines fixes.
- G1-6 Short-Range board UI (worktree-agent-a2e17115cd2c2d705): was adding a registry probe.
- G2-4 + G2-5 drives and recall (worktree-agent-a3054ed1c11c3e8a6): was retiring STANDARD_DRIVE_CLASS in voyage.ts / expedition.ts.
- ML-2 recipe rework + realism (worktree-agent-aa99b63d3da94ac06): was about to run full gates.
- R2-2 relic blanks by tier (worktree-agent-a5102d2e70f9ddf8c): was adding the registry-additions pin.
- EM-2 install gate (worktree-agent-a61ef58ebc7a78f74): built and reviewed; needs the follow-ups recorded in the Material
  Lines / E-MOD plan ("EM-2 non-worsening installs") before merge.

## 2026-10-21 calls (late)

- ML-2 salvage windfall (salvage returns the current recipe; five old pieces salvage above their old cost, one time):
  "Accept the windfall (Recommended)".
- Old Science Sidearm / Field Suit line remap on load (power to fieldwork; accuracy and status chance to relic find; armor
  and HP to hazard resist): "Approve (Recommended)".
- Lab / Fabricator tier 3+ rungs (complement plan OC-15 Lab tiers) so Class III+ drives and Tiers III+ are reachable:
  "Build them in 0.14.0 (Recommended)". NEW SLICE, owner to assign (was unowned).
- G2-4 picks: "Approve (Recommended)": hull base drive class = hull tier minus 1 (never below I); reach multipliers I 4,
  II 24, III 62, IV 68, V 105, VI 200, VII 240; Class II drive recipe 3 Power Coupling + 3 Wafer + 2 Titanium Ingot.
- Note for the quests patch: no Prospecting gear rolls Armor / HP any more, so dig safety has no gear source; old Hazard
  Suits keep their lines.
- LY_PER_TICK not rescaled (G2-4 deviation; reach multipliers carry the deep-space scale): "Approve (Recommended)".
- Recalled-before-arrival candidates: "No limit, refresh normally (Recommended)": an ordinary candidate again.
- Relics v2 R2-3 tier boost: "Only one boost (Recommended)": the rarer blank IS the tier boost; identification uses the
  blank's own rarity, no second band-odds boost.
- Lab / Fabricator tier III to VII rungs: "Costs OK, +1 slot each (Recommended)": LAB_FABRICATOR_TIER_RUNGS as built
  (III 20,000 / 240 ticks / FA 6; IV 50,000 / 420 / 9; V 125,000 / 720 / 12; VI 300,000 / 1,200 / 15; VII 750,000 /
  1,800 / 18), each rung +1 research or craft slot and its tier's blueprints.
- ML-3 climb curve: "Approve (Recommended)": MATERIAL_QUALITY_CURVE (about 8.5% at 10 points, 15% at 20, 21% at 30).
- ML-3 roll count: "Per item type (Recommended)": one rounding draw per delivered item type, as built.
