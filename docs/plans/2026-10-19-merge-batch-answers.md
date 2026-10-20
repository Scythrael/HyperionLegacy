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
