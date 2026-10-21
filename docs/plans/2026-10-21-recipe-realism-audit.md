# Recipe realism audit: every recipe, what the item is, and a fix that keeps every player item useful (0.14.0)

Status: AUDIT for user sign-off (2026-10-21). Doc only; no game code changes with this file. Branch `feat/crew-0.14.0`.
Source of the task: the user's answer "1. Definitely." (audit now, fix in 0.14.0) in
`2026-10-21-reactor-fuel-and-recipe-realism-capture.md` section 5.

**Markers:** `(user)` = the user's decision. **[PROPOSAL]** = mine; every new item, name and number so marked is the
user's to accept, change or reject, and no [PROPOSAL] entity exists until approved. Verdicts and fixes are proposals too;
nothing here is decided until the calls in section 14 are answered.

Sources read for this audit: the capture doc above; `2026-10-17-material-lines-and-emod-plan.md` (USER ANSWERS, the ML-1
carry note, ML-2 scope); `2026-10-02-material-lines-0.14.0-design.md` sections 1, 3b to 3f (the ML-2 recipe themes
the user approved through L2); `2026-10-17-gas-giant-study-plan.md` (canisters, call 7 uses, GG-7, the 2026-10-21
datadump); `2026-10-14-field-kits-plan.md` (call 3 kit recipes); `2026-10-14-expedition-tiers-g2-plan.md` (G2-4 drive
classes); `2026-10-14-complement-and-acquisition-plan.md` (CP-11); and the code as of `0dca5f2`: `model.ts` `ITEMS` (38),
`REFINE_RECIPES` (11), `BLUEPRINTS` (78), `FIELD_KITS_HIDDEN_BLUEPRINTS` (1), `SHIP_TYPES` build recipes (10),
`SALVAGE_LOOT_POOLS`, facility and storage rungs; `prospecting.ts` `PROSPECTING_BLUEPRINTS` (8); `crewModules.ts`
(catalog only, no blueprints yet); `model.test.ts` (the no-raw rule for equipment). Tables were dumped from the live
modules, not read by hand.


## 0. Scope (honest, read first)

| Count | What |
|:-|:-|
| **103** | Built recipes audited: 11 Refinery, 3 component blueprints, 33 ship equipment, 32 ground gear (1 hidden), 6 field kits, 8 Prospecting (hidden), 10 Shipyard hulls. The 5 hull unlock blueprints have no recipe. |
| **83 OK / 13 odd / 7 wrong** | Verdicts on today's recipes. "Wrong" = nothing in the recipe can do what the item does (a reactor with no fuel, a toxin grenade with no toxin). "Odd" = defensible but thin, or the flavor text promises a part the recipe lacks. |
| **13** | Recipe input changes this audit recommends for 0.14.0: the 7 wrong rows, Power Coupling, Composite Plating, Ballistic Weave, Field Suit, Hazard Suit, Galileo-Class Probe. |
| **13 (4 amended)** | ML-2's already-approved reworks (cargo, FTL, reactor, utility, shields, plating). This audit re-checked them: 9 hold, **4 fail realism** (Prospector Hold from biomass, Ablative Plating from metal, Capacitor Bank with an osmium plate, Composite Plating with no ablative layer) and need the user's re-call (call 5). |
| **2** | Odd weapon rows deferred to 0.16.0 with the weapon theming the user already placed there (L2). |
| **8** | Item text fixes with no recipe change (flavor or hint promises a part or a source that is not real). |
| **36** | Planned recipes not built yet (Deuterium Canister refine, 6 drive classes, 16 crew modules, 3 gas giant specials plus the 0.14.x Annihilation Core, 9 E-MOD modules) get realism guidance here so they are authored right the first time. |
| **0** | Items that become useless. **0** save migrations. **0** new items required (two optional [PROPOSAL] items in call 6). |

**Push-back (standing rule):** the realism pass itself is small in code (data rows plus a few text lines, folded into
the ML-2 slice that already rewrites the same blueprints), but it has two hard dependencies the release must respect:
the Reactor Core fuel change needs GG-1 (the Deuterium Canister item and its refine) AND the Cometary Ice Harvest
mission in the same build, or every Reactor Core recipe is walled. The 36 planned rows add nothing to scope; they are
guidance for slices already planned.


## 1. The rule this audit applies

The user (2026-10-21, verbatim): "crafting recipes should make sense for every item. A light bulb shouldn't require
antimatter, and an antimatter wouldn't require a scoop of ice cream in its actual component structure. So we'd have to
ensure we are keeping things real. IF that requires adjusting items as well, then so be it. Just don't do it in a way
that turns player items into broken useless items like we did with fuel v1 that just got sold to a vendor."

Applied as four tests per row:
1. **What is it physically?** Name the real parts (structure, conductor, electronics, optics, fiber, fuel, agent).
2. **Does every needed part have an input?** A missing part is "wrong" when it is the item's whole function (fuel in a
   reactor), "odd" when it is secondary (a housing).
3. **Does any input make no sense?** A hull strut in an eye implant, biomass in a cargo hold.
4. **Never useless.** Every fix keeps each held item working and keeps every input material with at least one consumer
   (section 13). Antimatter and Helium-3 stay harvest-only: no recipe ever makes them (the "ice cream" half of the rule).

Standing constraints kept: the no-wall rule (every slot keeps a non-relic variety whose inputs bottom out in the
open early missions); the no-raw rule for ordinary equipment blueprints (`model.test.ts`: raw inputs only on
discovery-gated blueprints); Material Lines items stay in their lines; CP-11's "components only" for tier 1 and 2 crew
modules (L2); weapons and drones theme in 0.16.0 (L2).

**Save impact key.** "Unchanged" = no recipe change. "Future crafts only" = every installed, stored or banked piece
keeps its rolled stats and its blueprint stays researched; an order already started completes off its stored effect; a
standing line on a changed recipe waits for the new input and resumes when stocked (the ML-2 in-flight rule, patch
note). "Gains a use" = a held stack that had little or no use gets one. No row needs conversion.

**Short names:** Ti Ingot = Titanium Ingot; Wafer = Polysilicate Wafer; Coupling = Power Coupling; Frame = Frame
Segment; Assembly = Structural Assembly. "ML-2 plan" = the approved E-MAT 3c/3d theme not yet built.


## 2. Refinery (`REFINE_RECIPES`, 11 built + 1 planned)

| Item | Current inputs | What it physically is | Verdict | Proposed fix | Save impact |
|:-|:-|:-|:-|:-|:-|
| Titanium Ingot | Titanium Ore 20 | Smelted titanium bar | OK | None | Unchanged |
| Polysilicate Wafer | Polysilicate Ore 5 | Purified silicon wafer, the electronics substrate | OK | None | Unchanged |
| Reclaimed Alloy | Scrap Alloy 10 | Re-smelted wreck alloy | OK | None | Unchanged |
| Purified Biomass | Fibrous Biomass 6 | Clean plant feedstock | OK | None. Text: widen its flavor to "fiber, carbon and medicine feedstock" if call 6 (a) | Unchanged; gains uses |
| Ferrite Ingot | Ferrite 20 | Iron bar (lunar iron is real: ilmenite and native iron grains) | OK | None (the RAW item's flavor calls an ore an "alloy"; text fix T5) | Unchanged |
| Reclaimed Circuit | Salvaged Circuitry 5 | Cleaned, re-traced circuit boards | OK | None | Unchanged (reserved, hidden) |
| Iridium Catalyst | Iridium Ore 3 | Iridium mesh. Real iridium is a catalyst AND the cladding on spacecraft radioisotope fuel | OK | None. Text: flavor names both uses (T2), so its Reactor Core use reads true | Unchanged (reserved, hidden) |
| Cobalt Coil | Cobalt Ore 3 + Ti Ingot 1 | A magnetic field coil | Odd (text) | Keep inputs. Flavor says "cobalt wire around a titanium core": backwards, titanium is not magnetic. Reword to "a cobalt magnetic core in a titanium housing" (T1) | Unchanged (reserved, hidden) |
| Osmium Plate | Osmium Ore 2 + Ferrite Ingot 2 | Dense osmium facing on an iron backing | OK | None | Unchanged (reserved, hidden) |
| Photonic Gel | Wafer 1 + Volatile Resin 3 | Light-guiding resin set in a silicon lattice | OK | None | Unchanged (reserved, hidden) |
| Biocatalyst | Purified Biomass 2 + Exotic Spore Cluster 1 | A living enzyme culture | OK | None | Unchanged (reserved, hidden) |
| *Planned (GG-1):* Deuterium Canister | Deuterium Ice 10 | Compressed deuterium gas. Real: heavy water ice is electrolyzed, the deuterium compressed | OK | Build as planned | Deuterium Ice players still hold from fuel v1 **gains a real use** (call 4) |

Not refinable, by design (the "ice cream" test): Hydrogen, Methane, Ammonia, Helium-3 Canisters and the Antimatter
Containment Cell are harvested only (gas giant study). No recipe makes them. Correct.


## 3. Components (Fabricator material blueprints, 3)

| Item | Current inputs | What it physically is | Verdict | Proposed fix | Save impact |
|:-|:-|:-|:-|:-|:-|
| Frame Segment | Ti Ingot 4 | A load-bearing strut | OK | None. Text: flavor widened to "a standard strut, cut to size for anything from a hull to a tool chassis" (T3), since tools and drones use it too | Unchanged |
| Power Coupling | Wafer 4 | A shielded power junction (power electronics plus a conductor and housing) | Odd | **Wafer 3 + Ti Ingot 1** [PROPOSAL]: silicon power electronics in a metal housing; same count, a common input replaces an uncommon one (call 8) | Future crafts only. Every hull, blueprint and rung that takes Couplings is untouched; only the Coupling's own recipe moves |
| Structural Assembly | Frame 2 + Coupling 1 + Ti Ingot 2 | Struts and junctions joined into a hull spine | OK | None | Unchanged |


## 4. Ship equipment by slot (33 built)

### 4.1 Cargo Bay (3)

| Item | Current inputs | What it physically is | Verdict | Proposed fix | Save impact |
|:-|:-|:-|:-|:-|:-|
| Balanced Hold (anchor) | Frame 2 + Ti Ingot 4 | A braced metal hold | OK | None (ML-2 keeps it) | Unchanged |
| Prospector Hold | Frame 2 + Ti Ingot 3 | A large, lightly braced hold | OK today. **ML-2 plan wrong**: Frame 2 + Purified Biomass 3 builds a hold out of plant feedstock | Replace the ML-2 row with **Frame 2 + Ti Ingot 1 + Reclaimed Alloy 2** [PROPOSAL]: light recovered-alloy panels, still distinct from Balanced (call 5) | Future crafts only |
| Hauler Hold | Frame 3 + Assembly 1 | A heavy hold on a full sub-structure | OK. ML-2 plan (Assembly 1 + Ferrite Ingot 2 + Reclaimed Alloy 2) OK | ML-2 as approved | Future crafts only (ML-2) |

### 4.2 FTL Drive (3 built + 6 planned classes)

| Item | Current inputs | What it physically is | Verdict | Proposed fix | Save impact |
|:-|:-|:-|:-|:-|:-|
| Balanced Drive (anchor) | Coupling 2 + Wafer 2 + Ti Ingot 1 | Field generator: power, control electronics, housing | OK | None | Unchanged |
| Sprint Drive | Coupling 2 + Wafer 3 | A high-output field generator | OK. ML-2 plan (Coupling 2 + Cobalt Coil 2) OK and better: field coils | ML-2 as approved | Future crafts only (ML-2) |
| Economy Drive | Coupling 2 + Ti Ingot 3 | A thrifty drive; thrift comes from control, not metal | Odd | ML-2 plan (Coupling 2 + Reclaimed Circuit 3) fixes it: efficiency from control circuitry | Future crafts only (ML-2) |
| *Planned (G2-4):* Class II to VII drives | none yet | Ever stronger field generators; Class III+ burn real fuel | n/a | [PROPOSAL] Class II: Coupling 3 + Cobalt Coil 2 + Wafer 2. Class III to V: the same plus Deuterium Canister 1 / 2 / 3. Class VI and VII: plus Antimatter Containment Cell 1 / 2 (GG call 7 (user)). Amounts are the balancing patch's | None (new rows) |

### 4.3 Reactor Core (3 built), with the fuel ladder

The user's rule (2026-10-21): every Reactor Core recipe takes a fuel canister; early and mid cores Deuterium, high-tier
cores Helium-3, Antimatter Containment Cells for the future antimatter reactors; the transitional tech is
antimatter-catalyzed fusion. All three built cores sit on Lab tiers 1 and 2 of 7, so all three are early or mid.

| Item | Current inputs | What it physically is | Verdict | Proposed fix | Save impact |
|:-|:-|:-|:-|:-|:-|
| Balanced Core (anchor) | Coupling 2 + Wafer 2 + Ti Ingot 1 | A fusion reactor: confinement, power conversion, housing, and a fuel load | **Wrong** (no fuel) | **+ Deuterium Canister 1** (call 1). Needs the Cometary Ice Harvest open from day one so the anchor does not wall (call 2) | Future crafts only. Crafted cores players hold keep their output and need no fuel |
| Efficient Core | Coupling 2 + Wafer 3 | A lean, low-draw fusion core | **Wrong** (no fuel) | ML-2 plan (Coupling 2 + Cobalt Coil 1 + Reclaimed Circuit 2) **+ Deuterium Canister 1** | Future crafts only |
| High-Output Core | Coupling 3 + Assembly 1 | A high-output fusion core | **Wrong** (no fuel) | ML-2 plan (Coupling 3 + Iridium Catalyst 1 + Osmium Plate 1) **+ Deuterium Canister 2**. Iridium as fuel cladding and Osmium as dense shielding both read true with text T2 | Future crafts only |
| Standard-Issue Reactor Core | not crafted | The hull's stock reactor | OK | None (no recipe) | Unchanged |

The ladder (the foundation the user approved as "Data model + hooks"; no new reactors in 0.14.0):

| Band | Reactor tech | Fuel canister in its recipe | The real or theorized science | When |
|:-|:-|:-|:-|:-|
| Lab tiers 1 and 2 (today's three cores) | Fusion (deuterium-deuterium) | Deuterium Canister | D-D fusion needs no tritium, which the game does not have; deuterium is real in comet and moon ice | 0.14.0 |
| Lab tiers 3 and 4 [PROPOSAL] | Fusion, larger cores | Deuterium Canister, more per core | The same reaction at higher power | Balancing patch (seam now) |
| Lab tiers 5 and 6 [PROPOSAL] | Deuterium-Helium-3 fusion | Helium-3 Canister (with Deuterium) | D-He3 releases mostly charged particles, far fewer neutrons: less shielding, direct power conversion. Helium-3 is a real gas giant resource | Balancing patch |
| Transitional (user) | Antimatter-catalyzed fusion | Helium-3 Canister 2 + Antimatter Containment Cell 1 [PROPOSAL amounts] | A small antiproton pulse ignites a fusion pellet (the Penn State ICAN-II and AIMStar studies) | Balancing patch |
| Tier VII hull power (user) | Antimatter reactor | Antimatter Containment Cell 3 [PROPOSAL amount] | Matter-antimatter annihilation, antiprotons held in a magnetic trap (real lab traps hold them today) | Balancing patch; "overburn" open (user) |
| 0.14.x with the burn | Annihilation Core | Antimatter Containment Cell 1 + Osmium Plate 2 + Cobalt Coil 2 + Iridium Catalyst 1 [PROPOSAL] | As above; the burn's reactor | 0.14.x |

Two plan conflicts this creates (no call needed, recorded): GG-7 said canister uses go only on new blueprints "so no
existing recipe moves"; the user's fuel-in-every-core rule supersedes that for Reactor Cores. Material Lines L8's
"Local Deuterium Skim returns" is superseded by the Cometary Ice Harvest (capture section 5).

### 4.4 Spec Utility (5 built)

| Item | Current inputs | What it physically is | Verdict | Proposed fix | Save impact |
|:-|:-|:-|:-|:-|:-|
| Yield Rig (anchor) | Frame 2 + Wafer 2 | A mining rig: chassis plus sensors | OK | None | Unchanged |
| Survey Rig | Coupling 2 + Wafer 2 | A survey sensor rig | OK. ML-2 plan (Coupling 2 + Photonic Gel 2) OK: optics | ML-2 as approved | Future crafts only (ML-2) |
| Refinery-Feed Rig | Ti Ingot 5 | An ore-sorting rig (flavor) that improves feed quality | Odd: a sorter of pure titanium, no sensing | ML-2 plan (Ti Ingot 2 + Biocatalyst 2) is real if the rig is a bioleaching pre-treatment (microbes upgrading ore is real mining). Flavor rewritten to match (T6) | Future crafts only (ML-2) |
| Damage Control Suite (relic) | Anomalous Alloy 2 + Ti Ingot 3 + Coupling 2 + Reclaimed Alloy 2 | Patch rig built on a shape-memory alloy (user-specified) | OK | None | Unchanged |
| Pathfinder Suite (relic) | Ti Ingot 4 + Wafer 3 + Frame 1 | A ground-reading survey package | OK | None | Unchanged |

### 4.5 Weapons (9) and drone pods (3)

L2 (user) moved weapon and drone theming to 0.16.0; only "wrong" rows would justify an earlier change, and none are.

| Item | Current inputs | What it physically is | Verdict | Proposed fix | Save impact |
|:-|:-|:-|:-|:-|:-|
| Plasma Cannon | Wafer 2 + Coupling 2 | Magnetically contained plasma bolt: power, coils, emitter housing | Odd (no coil, no housing) | 0.16.0: Coupling 2 + Wafer 1 + Cobalt Coil 1 [PROPOSAL] (call 10) | Unchanged in 0.14.0 |
| Graviton Emitter | Wafer 4 + Coupling 2 | Exotic field projector | OK (exotic; E-MAT's Cobalt Coil theme suits 0.16.0) | None now | Unchanged |
| Voltaic Discharger | Wafer 3 + Coupling 3 | Arc weapon: capacitors and switching | OK | None | Unchanged |
| Autocannon | Ti Ingot 3 + Frame 1 | Kinetic gun: barrel and mechanism | OK | None | Unchanged |
| Railgun | Ti Ingot 4 + Frame 2 + Coupling 1 | Conductive rails plus a power feed | OK | None now | Unchanged |
| Concussion Torpedo | Ti Ingot 3 + Frame 2 + Assembly 1 | A launcher | OK | None | Unchanged |
| Point-Defense Array | Wafer 3 + Coupling 1 | Tracking guns firing "fast rounds" (flavor): needs barrels | Odd (no metal) | 0.16.0: Wafer 2 + Coupling 1 + Ti Ingot 1 [PROPOSAL] (call 10) | Unchanged in 0.14.0 |
| EMP Cannon | Wafer 3 + Coupling 2 | Pulse electronics | OK | None | Unchanged |
| Tachyon Burst Emitter | Wafer 4 + Coupling 2 | Exotic emitter | OK | None | Unchanged |
| Attack Drone Pod | Wafer 3 + Coupling 2 + Frame 1 | Drones: electronics on frames | OK | None | Unchanged |
| Defense Drone Pod | Wafer 4 + Coupling 2 + Frame 1 | Interceptor drones | OK | None | Unchanged |
| Support Drone Pod | Wafer 3 + Coupling 2 + Frame 2 | Repair drones | OK. Note for 0.16.0: E-MAT's "Purified Biomass as repair foam" is weak; Reclaimed Alloy (patch stock) is the real match | None now | Unchanged |

### 4.6 Shield Emitters (3)

| Item | Current inputs | What it physically is | Verdict | Proposed fix | Save impact |
|:-|:-|:-|:-|:-|:-|
| Balanced Emitter (anchor) | Coupling 2 + Wafer 2 + Ti Ingot 1 | Field emitter: power, electronics, housing | OK | None | Unchanged |
| Recharge Array | Coupling 2 + Wafer 3 | A fast-cycling emitter | OK. ML-2 plan (Coupling 2 + Wafer 1 + Cobalt Coil 2) OK | ML-2 as approved | Future crafts only (ML-2) |
| Capacitor Bank | Coupling 3 + Wafer 3 + Assembly 1 | A capacitor stack. Real capacitors: a dielectric (titanate ceramics, silicon) between conductors | OK today. **ML-2 plan odd**: adds an Osmium Plate, a dense armor plate, to a capacitor | **Keep today's recipe** (drop the ML-2 change); Osmium Plate keeps its other consumers (call 5) | Unchanged |

### 4.7 Hull Plating (3)

| Item | Current inputs | What it physically is | Verdict | Proposed fix | Save impact |
|:-|:-|:-|:-|:-|:-|
| Reinforced Plating (anchor) | Ti Ingot 3 + Frame 1 | Thick metal armor | OK. ML-2 plan (Ferrite Ingot 2 + Ti Ingot 1 + Frame 1) OK: iron armor | ML-2 as approved | Future crafts only (ML-2) |
| Ablative Plating | Ti Ingot 2 + Frame 2 | A layer that "boils away under fire" (flavor). Real ablators are carbon-phenolic composites (NASA's PICA) | **Wrong** (metal does not ablate). **ML-2 plan also wrong** (Reclaimed Alloy is metal) | **Frame 2 + Ti Ingot 1 + Purified Biomass 2** [PROPOSAL]: carbon from biomass (early carbon fiber was made from plant cellulose) over a metal backing (calls 5, 6) | Future crafts only |
| Composite Plating | Ti Ingot 3 + Frame 2 + Assembly 1 | Layered: hull, ablative layer, kinetic dampening (flavor) | Odd (no ablative layer). ML-2 plan still has none | ML-2 plan with **Purified Biomass 1 in place of Reclaimed Alloy 1**: Ti Ingot 1 + Frame 2 + Assembly 1 + Osmium Plate 1 + Purified Biomass 1 (call 5) | Future crafts only |

### 4.8 Sensor Arrays (1 built + 3 planned)

| Item | Current inputs | What it physically is | Verdict | Proposed fix | Save impact |
|:-|:-|:-|:-|:-|:-|
| Bio-Resonance Array (relic) | Purified Biomass 2 + Volatile Resin 6 + Exotic Spore Cluster 2 + Wafer 2 | A living sensing membrane (user-specified) | OK | None | Unchanged |
| *Planned (CP-11):* Balanced Array, Wide-Beam Array, Focused-Beam Array | none yet | Antennas and receivers | n/a | Components only (L2, user): Balanced Wafer 3 + Coupling 1 + Frame 1; Wide-Beam Wafer 4 + Frame 2 (a wide aperture); Focused-Beam Wafer 3 + Coupling 2 [PROPOSAL] | None (new rows) |


## 5. Crew modules (CP-11, 13 planned, not built)

No blueprint exists yet (`crewModules.ts` holds the catalog only). L2 (user): tier 1 and 2 modules use existing
components only. Realistic component mixes [PROPOSAL, every amount]:

| Module | Proposed inputs | What it physically is | Realism note |
|:-|:-|:-|:-|
| Balanced Command | Frame 1 + Coupling 2 + Wafer 2 | Consoles, displays, a frame | OK |
| Focused Command | Frame 1 + Coupling 2 + Wafer 3 | A denser console suite | OK |
| Flag Command | Assembly 1 + Coupling 3 + Wafer 3 | A full command deck | OK |
| Utilitarian Quarters | Frame 2 + Ti Ingot 2 + Coupling 1 | Bunks plus life support | OK |
| Efficient Quarters | Frame 2 + Ti Ingot 1 + Coupling 2 | Compact bunks, more life support | OK |
| Elite Quarters | Assembly 1 + Ti Ingot 2 + Coupling 2 | Larger cabins | OK |
| Security Quarters | Frame 2 + Ti Ingot 3 | Bunks and an armory locker | OK |
| Engineering Quarters | Frame 2 + Coupling 2 + Ti Ingot 1 | Bunks and a workshop | OK |
| Science Quarters | Frame 2 + Wafer 2 + Coupling 1 | Bunks and a lab bench | OK |
| Medical Quarters | Frame 2 + Wafer 1 + Ti Ingot 1 | Bunks and a sickbay | Odd under components only: a sickbay with no medical stock. Call 13 asks whether one Purified Biomass is allowed |
| Operations Quarters | Frame 2 + Wafer 2 + Coupling 1 | Bunks and an ops room | OK |
| Flight-Deck Quarters | Frame 3 + Coupling 1 | Bunks beside a hangar | OK |
| Guest Wing | Frame 2 + Ti Ingot 2 + Coupling 1 | Passenger cabins | OK |

Lab tier 3+ modules take gas canisters (GG call 7 (user): Hydrogen, Methane, Ammonia in sensor and quarters modules).
Realistic placement (call 14): **Quarters** Ammonia (the coolant in real station heat loops) and Hydrogen (water
recovery: hydrogen plus exhaled carbon dioxide gives water, as on the ISS); **Sensors** Hydrogen (cryogenic cooling of
infrared detectors) and Methane (diamond sensor windows grown from methane).


## 6. Ground gear (32 built, 1 hidden)

### 6.1 Member weapons (4)

| Item | Current inputs | What it physically is | Verdict | Proposed fix | Save impact |
|:-|:-|:-|:-|:-|:-|
| Pulse Rifle | Ti Ingot 3 + Coupling 1 | Energy rifle: body plus power cell | OK | None | Unchanged |
| Scattergun | Ti Ingot 4 + Frame 1 | Kinetic shotgun | OK | None | Unchanged |
| Shock Baton | Ti Ingot 2 + Coupling 2 + Wafer 1 | Charged baton | OK | None | Unchanged |
| Sidearm | Ti Ingot 2 + Coupling 1 | Light pistol | OK | None | Unchanged |

### 6.2 Member armor (4)

Standard-Issue ground armor covers day one, so a Forage input on a crafted tier 1 armor is not a wall.

| Item | Current inputs | What it physically is | Verdict | Proposed fix | Save impact |
|:-|:-|:-|:-|:-|:-|
| Ballistic Weave | Ti Ingot 3 + Wafer 1 | "Light layered armor" (flavor). Real body armor is woven fiber with hard inserts | Odd (all metal, no weave) | **Ti Ingot 1 + Wafer 1 + Purified Biomass 2** [PROPOSAL] (fiber weave, one hard insert) (call 9) | Future crafts only |
| Assault Hardsuit | Ti Ingot 4 + Assembly 1 | Powered armor on an exoskeleton | OK | None | Unchanged |
| Field Suit | Ti Ingot 2 + Wafer 2 | A padded work suit with sensor cuffs | Odd (no fabric) | **Ti Ingot 1 + Wafer 2 + Purified Biomass 1** [PROPOSAL] (call 9) | Future crafts only |
| Hazard Suit | Ti Ingot 3 + Wafer 2 + Frame 1 | A sealed environment suit | Odd (a strut, no seal layer) | **Ti Ingot 3 + Wafer 2 + Purified Biomass 1** [PROPOSAL]: the seal and insulation layer replaces the strut (call 9) | Future crafts only |

### 6.3 Member tools (10 + 1 hidden)

| Item | Current inputs | What it physically is | Verdict | Proposed fix | Save impact |
|:-|:-|:-|:-|:-|:-|
| Stun Grenade | Wafer 2 + Coupling 1 | Electronic flash and sound charge | OK | None | Unchanged |
| Toxin Grenade | Wafer 3 + Coupling 1 + Ti Ingot 1 | "A canister of something that lingers" | **Wrong** (no agent) | **Ti Ingot 1 + Coupling 1 + Biocatalyst 1** [PROPOSAL]: a cultured agent in a metal canister (raw Volatile Resin is barred by the no-raw rule; call 6 (c) offers a refined resin instead) (call 7) | Future crafts only |
| Med Kit (tool) | Wafer 2 + Ti Ingot 1 | "Field dressings, stims, and a diagnostic wand" | **Wrong** (no medical stock) | **Wafer 1 + Ti Ingot 1 + Purified Biomass 2** [PROPOSAL], matching the First Aid Kit's materials (call 7) | Future crafts only |
| Shroud Emitter | Wafer 3 + Coupling 2 | Light and sound bending emitter | OK | None | Unchanged |
| Lure Beacon | Wafer 2 + Coupling 2 + Frame 1 | A broadcast beacon on a mast | OK | None | Unchanged |
| Flora Scanner | Wafer 3 + Coupling 1 | Handheld bio scanner | OK | None | Unchanged |
| Thermal Rig | Wafer 2 + Ti Ingot 2 | Heat exchanger plus controls | OK | None | Unchanged |
| Core Drill | Ti Ingot 3 + Coupling 1 | Powered drill | OK | None | Unchanged |
| Decryptor | Wafer 4 + Coupling 1 | Computing device | OK | None | Unchanged |
| Galileo-Class Probe (`atmoProbe`) | Wafer 2 + Frame 1 + Coupling 1 | A probe dropped into a gas giant on a tether: it needs a pressure shell (it has a crush rating) | Odd (no pressure shell) | **Wafer 2 + Coupling 1 + Ti Ingot 2** [PROPOSAL] (call 9) | Future crafts only; ids and stat ratios unchanged (GG call 6 (user)) |
| Impact Grenade (hidden) | Ti Ingot 1 + Wafer 1 + Coupling 1 (user-approved 2026-10-20) | "Let the blast do the arguing": no explosive | Odd | Keep the recipe; flavor states the blast is the Coupling's stored charge dumped at once (T7) (call 11) | Unchanged (hidden, no player holds one) |

### 6.4 Implants (13)

Implants are biocompatible electronics; titanium is the real implant metal, so Wafer, Ti Ingot and Coupling mixes are
sound.

| Item | Current inputs | What it physically is | Verdict | Proposed fix | Save impact |
|:-|:-|:-|:-|:-|:-|
| Dermal Weave | Ti Ingot 2 + Wafer 2 | Subdermal titanium mesh | OK | None | Unchanged |
| Reflex Booster | Wafer 3 + Coupling 1 | Neural electronics | OK | None | Unchanged |
| Targeting Optic | Wafer 3 + Coupling 1 | Ocular overlay | OK | None | Unchanged |
| Adrenal Surge | Wafer 2 + Coupling 2 | Electronic gland regulator | OK | None | Unchanged |
| Med-Nanite Swarm | Wafer 4 + Coupling 1 | Silicon micro-machines | OK | None | Unchanged |
| Toxin Filters | Wafer 2 + Ti Ingot 2 | Blood filters | OK | None | Unchanged |
| Cortex Shield | Wafer 3 + Ti Ingot 1 | Neural dampener | OK | None | Unchanged |
| Synaptic Accelerator | Wafer 3 + Coupling 1 | Neural electronics | OK | None | Unchanged |
| Archaeo-Scanner | Wafer 4 + Frame 1 | A retinal overlay | **Wrong** (a load-bearing strut in an eye implant) | **Wafer 4 + Coupling 1** [PROPOSAL] (call 7) | Future crafts only |
| Environmental Adaptation | Wafer 2 + Ti Ingot 2 | Thermoregulation implant | OK | None | Unchanged |
| Cipher Wetware | Wafer 4 + Coupling 1 | Pattern-matching neural implant | OK | None | Unchanged |
| Bio-Analyzer | Wafer 3 + Ti Ingot 1 | In-body assay lab | OK | None | Unchanged |
| Neural Backup (relic) | Intact Data Core 1 + Wafer 3 + Coupling 2 | Cortical recorder built on the data core | OK | None | Unchanged |


## 7. Field kits (6)

| Item | Current inputs (makes) | What it physically is | Verdict | Proposed fix | Save impact |
|:-|:-|:-|:-|:-|:-|
| First Aid Kit | Purified Biomass 1 + Wafer 1 (2) | Dressings plus a diagnostic strip | OK | None | Unchanged |
| Antitoxin | Purified Biomass 1 + Ti Ingot 1 (2) | Antitoxin in a titanium injector | OK | None | Unchanged |
| Splint | Ti Ingot 1 + Fibrous Biomass 1 + Purified Biomass 2 (2) | Titanium brace with fiber wraps | OK | None | Unchanged |
| Combat Stim | Volatile Resin 1 + Purified Biomass 1 (2) | A stimulant in an auto-injector | Odd (minor: no injector body, while the Antitoxin has one) | Keep (call 11); adding Ti Ingot would move its derived price | Unchanged |
| Trauma Kit | Purified Biomass 2 + Exotic Spore Cluster 1 + Wafer 1 (1) | Clotting foam, blockers, bone set | OK | None | Unchanged |
| Injury Kit | Purified Biomass 2 + Wafer 1 + Coupling 1 (1) | Powered stabilizer cuff | OK | None | Unchanged |


## 8. Prospecting gear (8, hidden until the prospecting quests patch)

| Item | Current inputs | What it physically is | Verdict | Proposed fix | Save impact |
|:-|:-|:-|:-|:-|:-|
| Plasma Cutter | Ti Ingot 2 + Coupling 2 | Cutting torch | OK | None | Unchanged (hidden) |
| Rock Breaker | Ti Ingot 4 + Frame 1 | Percussion hammer on a chassis | OK | None | Unchanged (hidden) |
| Sampling Lance | Ti Ingot 2 + Wafer 2 + Coupling 1 | Coring tool with sensors | OK | None | Unchanged (hidden) |
| Excavator Suit | Ti Ingot 3 + Wafer 1 | Braced work suit | OK | None | Unchanged (hidden) |
| Assay Scanner | Wafer 2 + Coupling 1 | Handheld spectrometer | OK | None | Unchanged (hidden) |
| Seismic Mapper | Wafer 3 + Frame 1 | Thumper and listener | OK | None | Unchanged (hidden) |
| Ore-Sense Optic | Wafer 4 + Coupling 1 | Retinal overlay | OK | None | Unchanged (hidden) |
| Myo-Lift Frame | Ti Ingot 2 + Coupling 2 | Powered tendons | OK | None | Unchanged (hidden) |


## 9. Gas giant (planned, GG-1 and GG-7)

| Item | Planned inputs | What it physically is | Verdict | Proposed fix | Save impact |
|:-|:-|:-|:-|:-|:-|
| Deuterium Canister | Deuterium Ice 10 (GG-1) | Compressed deuterium | OK | Build as planned | New item; Deuterium Ice gains a use |
| Hydrogen, Methane, Ammonia, Helium-3 Canisters; Antimatter Containment Cell | harvested only | Gases from the giant | OK (never crafted) | None | New items |
| Ramscoop Collector | not set | A magnetic field scoop that gathers gas (the real Bussard ramscoop idea) | n/a | Cobalt Coil 2 + Coupling 2 + Frame 2 [PROPOSAL] | None (new row) |
| Pressure-Forged Plating | not set | Plating hardened the way giant planets make diamond from methane under pressure (real lab result) | n/a | Osmium Plate 2 + Ferrite Ingot 2 + Frame 1 + Methane Canister 1 [PROPOSAL] | None (new row) |
| Resonance Sensor Array | not set | A deep sensor; Helium-3 is the real gas for neutron detectors and ultra-cold cooling | n/a | Photonic Gel 2 + Wafer 2 + Coupling 1 + Helium-3 Canister 1 [PROPOSAL]. This gives Helium-3 a 0.14.0 consumer while high-tier reactors wait (call 3) | None (new row) |


## 10. E-MOD universal modules (planned, EM-7 and EM-8; M7 (user) = Material Lines items)

| Module | Proposed inputs [PROPOSAL] | What it physically is |
|:-|:-|:-|
| Auxiliary Capacitor | Coupling 2 + Reclaimed Circuit 2 + Wafer 1 | Extra power storage and conversion |
| Structural Bracing | Ferrite Ingot 2 + Frame 2 | Added hull bracing |
| Arc Discharger | Cobalt Coil 2 + Coupling 1 | A charged coil that arcs back |
| Prospector's Echo | Photonic Gel 1 + Reclaimed Circuit 2 | An ore-sensing package |
| Last Stand Protocol | Reclaimed Circuit 2 + Wafer 2 | Control circuitry |
| Shield Surge | Coupling 2 + Cobalt Coil 1 + Reclaimed Circuit 1 | A stored-charge shield boost |
| Long-Baseline Array (set) | Photonic Gel 2 + Frame 1 | A long optical receiver |
| Signal Integrator (set) | Reclaimed Circuit 2 + Wafer 1 | Signal processing |
| Precursor Lens (discovery) | Precursor Circuit 1 + Photonic Gel 2 + Iridium Catalyst 1 | Optics on an ancient circuit |


## 11. Shipyard hulls (10)

| Item | Current inputs | What it physically is | Verdict | Proposed fix | Save impact |
|:-|:-|:-|:-|:-|:-|
| General Freighter | Frame 4 + Coupling 2, 500 credits | A hull: struts and power runs | OK | None | Unchanged |
| Hauler | Frame 8 + Coupling 5 + Assembly 2, 1,400 | Large hull | OK | None | Unchanged |
| Runner | Frame 4 + Coupling 4 + Assembly 1, 900 | Light hull | OK | None | Unchanged |
| Prospector | Frame 6 + Coupling 4 + Assembly 1, 1,100 | Mining hull | OK | None | Unchanged |
| Destroyer | Frame 6 + Coupling 5 + Assembly 2, 2,000 | Warship hull | OK | None | Unchanged |
| Battleship | Frame 14 + Coupling 10 + Assembly 5, 5,000 | Capital hull | OK | None | Unchanged |
| Carrier | Frame 12 + Coupling 10 + Assembly 4, 4,800 | Drone platform hull | OK | None | Unchanged |
| Orion | Frame 10 + Coupling 8 + Assembly 3, 4,200 | Explorer hull | OK | None | Unchanged |
| Aurora | Frame 9 + Coupling 8 + Assembly 3, 3,900 | Survey hull | OK | None | Unchanged |
| Eir | Frame 12 + Coupling 8 + Assembly 4, 4,600 | Medical transport hull | OK | None | Unchanged |

Hulls launch with Standard-Issue systems, so no fuel input belongs here.

**Outside crafting (not counted, no change proposed):** facility and storage rungs take bulk Titanium Ore, Titanium
Ingots, Dense Ore and Structural Assemblies (ore as bulk construction aggregate reads fine); Material salvage pools
break a reactor housing and a weapon system into plausible parts. These are progression costs, not recipes, and moving
them would move progression balance.


## 12. Item text fixes (no recipe change, no save impact)

| # | Item | Fix |
|:-|:-|:-|
| T1 | Cobalt Coil | "A cobalt magnetic core in a titanium housing, the field coil drives and emitters run on." |
| T2 | Iridium Catalyst | Name both real uses: a catalyst, and the heat-proof cladding that holds a reactor's fuel. |
| T3 | Frame Segment | "A standard strut, cut to size for anything from a hull to a tool chassis." |
| T4 | Purified Biomass | Widen to a fiber, carbon and medicine feedstock (only if call 6 (a)). |
| T5 | Ferrite (raw) | "An iron-rich ore" (it is called an alloy today). |
| T6 | Refinery-Feed Rig | A bioleaching pre-treatment rig, matching its ML-2 Biocatalyst recipe. |
| T7 | Impact Grenade | The blast is a Coupling's stored charge released at once (only if call 11 (a)). |
| T8 | Deuterium Ice | Hint points at the Cometary Ice Harvest and the Deuterium Canister refine; flavor drops "the fleet no longer burns". |


## 13. Consumer check (no item becomes useless)

- Every input that loses a consumer keeps others: Frame Segment loses three small uses (Hazard Suit, Archaeo-Scanner,
  Galileo-Class Probe) and keeps about twenty plus every hull; Reclaimed Alloy loses ML-2's two plating rows but gains
  the Prospector Hold, and keeps the Hauler Hold and the Damage Control Suite; Wafer and Ti Ingot keep dozens.
- Gains: Deuterium Ice (the fuel v1 stock, sell-only today) gains the canister refine and through it every Reactor
  Core; Purified Biomass gains plating, armor and the Med Kit; Biocatalyst gains the Toxin Grenade; Helium-3 gets a
  0.14.0 consumer (call 3).
- Held pieces: every crafted piece keeps its rolled stats, every researched blueprint stays researched, and nothing is
  evicted or refunded. No save step; no `MIGRATIONS[69]` append.
- Tests to carry (the ML-2 slice): the sink test (every item has a consumer or a typed reserve), the no-wall walker
  (counting the Cometary Ice Harvest as an open early mission, call 2), the no-raw rule, the in-flight rule (a standing
  line on a changed recipe waits, never throws), and a new realism guard [PROPOSAL]: every Reactor Core blueprint has a
  fuel canister input, so a future core cannot ship without one.


## 14. CALLS (multiple-choice ready; recommended first; most important first)

**Group A: reactor fuel**
1. **Deuterium per core.** (a) Balanced 1, Efficient 1, High-Output 2 Deuterium Canisters (Recommended). (b) 1 each.
   (c) 1, 2, 3.
2. **Cometary Ice Harvest gate.** (a) Open from day one like the Local Asteroid and Lunar Mine runs, so the anchor
   Balanced Core never walls; the no-wall walker counts it (Recommended). (b) Behind captain level 2; the Standard-Issue
   reactor and hull base power cover until then. (c) Leave the Balanced Core unfueled (breaks your "all cores" rule).
3. **Helium-3 in 0.14.0** (no high-tier reactor ships yet). (a) The Resonance Sensor Array takes 1 Helium-3 Canister
   (its real use: neutron detection and ultra-cold cooling), reactors take it in the balancing patch (Recommended).
   (b) A typed reserve until the high-tier reactors; sellable meanwhile. (c) The High-Output Core takes it now (breaks
   the ladder: it is a mid core).
4. **Old Deuterium Ice stock.** (a) Keep its Quartermaster sell price AND add the refine use; rewrite its hint (T8)
   (Recommended). (b) Remove the sell price once it has a use.

**Group B: realism fixes to approved plans and wrong rows**
5. **ML-2 amendments.** (a) All four: Prospector Hold Frame 2 + Ti Ingot 1 + Reclaimed Alloy 2; Ablative Plating
   Frame 2 + Ti Ingot 1 + Purified Biomass 2; Composite Plating swaps Reclaimed Alloy for Purified Biomass; Capacitor
   Bank keeps today's recipe (Recommended). (b) Some (say which). (c) Build ML-2 as first approved.
6. **Fiber and carbon stand-in.** (a) Purified Biomass serves as fiber, carbon and polymer feedstock, flavor widened
   (T4), no new item (Recommended). (b) [PROPOSAL] a new refined "Biofiber" from Fibrous Biomass for armor, suits and
   plating. (c) (b) plus [PROPOSAL] "Resin Distillate" from Volatile Resin for seals, toxins and explosives.
7. **The three wrong ground rows** (Toxin Grenade, Med Kit, Archaeo-Scanner). (a) Fix now as tabled (Recommended).
   (b) Fix in 0.16.0.
8. **Power Coupling.** (a) Wafer 3 + Ti Ingot 1 (Recommended). (b) Keep Wafer 4; flavor says silicon power electronics.

**Group C: odd rows and text**
9. **Ground odd rows** (Ballistic Weave, Field Suit, Hazard Suit, Galileo-Class Probe). (a) Fix now as tabled
   (Recommended). (b) Leave as they are.
10. **Weapon odd rows** (Plasma Cannon, Point-Defense Array). (a) Fix in 0.16.0 with the weapon theming (L2)
    (Recommended). (b) Fix now.
11. **Impact Grenade and Combat Stim.** (a) Keep both recipes; the grenade's flavor names an energy charge (T7)
    (Recommended). (b) Add a charge input to the grenade and Ti Ingot to the stim (moves the stim's price).
12. **Text fixes T1 to T8.** (a) Apply all (Recommended). (b) Show me each first.

**Group D: planned content**
13. **CP-11 crew modules.** (a) The component mixes in section 5, Medical Quarters takes 1 Purified Biomass as its one
    exception (Recommended). (b) Components only, Medical Quarters included. (c) Other amounts.
14. **Canisters in Lab tier 3+ modules.** (a) Quarters: Ammonia and Hydrogen; Sensors: Hydrogen and Methane (section 5)
    (Recommended). (b) Other placement.
15. **Reactor ladder seam.** (a) As tabled in 4.3: fusion on Deuterium, Deuterium-Helium-3 fusion, antimatter-catalyzed
    fusion (Helium-3 plus a cell), antimatter reactors on cells (Recommended). (b) Adjust a band.
16. **Build order.** (a) One data slice inside ML-2 (same blueprint rows), after GG-1 and the Cometary Ice Harvest,
    with the realism guard test (Recommended). (b) A separate slice after ML-2.

## USER ANSWERS (2026-10-21)

**Group A (reactor fuel), all Recommended:**
1. Deuterium per core: "1 / 1 / 2": Balanced 1, Efficient 1, High-Output 2 Deuterium Canisters.
2. Cometary Ice Harvest gate: "Open from day one": like the Local Asteroid and Lunar Mine runs; the no-wall walker counts it.
3. Helium-3 in 0.14.0: "Resonance Sensor Array": it takes 1 Helium-3 Canister; reactors take it in the balancing patch.
4. Old Deuterium Ice stock: "Keep sell price + refine use": hint rewritten (T8).

**Group B (realism fixes):**
5. ML-2 amendments: "All four (Recommended)": Prospector Hold Frame 2 + Ti Ingot 1 + Reclaimed Alloy 2; Ablative Plating
   Frame 2 + Ti Ingot 1 + (fiber layer, see 6); Composite Plating swaps Reclaimed Alloy for (fiber, see 6); Capacitor
   Bank keeps today's recipe.
6. Fiber and carbon: "Biofiber + Resin Distillate" (NOT the recommendation): two new refined items: [PROPOSAL names
   accepted] Biofiber (refined from Fibrous Biomass) for armor, suits and plating; Resin Distillate (from Volatile Resin)
   for seals, toxins and explosives. Ratios and which recipes take them asked next.
7. Three wrong ground rows: "Fix now (Recommended)".
8. Power Coupling: "3 Wafers + 1 Ti Ingot (Recommended)".
