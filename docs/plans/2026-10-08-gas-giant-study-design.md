# Gas Giant Study (0.14.0, E-CREW Task 15b): DESIGN DRAFT

Status: DRAFT for user review (2026-10-08). Scope is "All of it in 0.14.0" (user, 2026-10-08). Every name and number
marked **[PROPOSAL]** is mine and is the user's to accept, rename or reject. Source decisions: D22 and D23 in
`2026-10-02-crew-made-real-e-crew-design.md`.

## 1. What the user decided (verbatim anchors)

- "Gas Giants are a bad idea for local landing. It should only be from the ship. Probably something like studying the
  gas giant, and analyzing it. Things like figuring out how close it got to becoming a star, etc."
- Rewards: "the first 3 are all good ideas. Perhaps you can get one from a pool of different rewards." (atmospheric
  samples, research data, a lore readout)
- Samples: "Canisters of compressed gases. Deuterium Ice would fit this as well. Processed into a canister-stored
  version. \"Gas Storage Canisters\" as the warehouse category. It's a whole new set of additional items for crafting.
  Perhaps you'll be able to pull a bunch of gas, and it just happens to be a few different types of gas that results in
  enough for a few different gas canisters depending on the location."
- Research data: "different types of research data that can bestow research progress. Full on specific research data
  types. Plus some that can be fed into another tab within the research lab that would be used for studying data from
  an ancient race that can lead to special crafting blueprints being unlocked."
- Lore home: a new **Survey Log** tab in the Archive.
- Probe: **Galileo-Class Probe**, faster and richer study, "Because it's durable enough to go deeper into the crushing
  gravity and can survive not being crushed by it. Could even involve larger and more dense gas giants, increasing that
  further."
- D23: diminishing returns, never hard caps.

## 1b. User answers, 2026-10-09 (verbatim anchors; these override the proposals below where they differ)

1. **Classes:** Ice Giant and Brown Dwarf are kept. "Are the middle 3 scientific classifications, or are they
   effectively ways of trying to squeeze what is effectively \"gas giant\" into additional categories? If so, perhaps
   we can consider other options in there. Replace that with the scientific description of what Saturn/Jupiter/
   Super-Jupiter classes represent, and add in other possible options. One being spacial phenomena like a nebula.
   Something real. Something you could gather gaseous clouds from."
2. (Answered as research-data processing.) "I was thinking the research facility could do so. Where the data is
   collected and returned. As that data is collected and returned, as each one completes (kinda like a set of items
   that you can have your team study) you gain various types of things to help you. Possibly learning a new recipe
   for crafting (rarely), and then something like some of those boosts to learning different types of research.
   Research may be expanded as well into different categories and so forth. Perhaps. Might need more fleshing out, or
   more condensing if I'm overcomplicating it." So: the SHIP collects and returns data; the RESEARCH LAB studies each
   data item (a study lane); each completed study grants research boosts by type and, rarely, a new crafting recipe.
3. **Reward pool reshaped:** "100% gas cannisters (in a range) depending on what you're trying to get. Maybe the type
   of gas you can grab is where the % of chance to get something is (similar to regular mission drops of
   standard/augmented/stellar qualities. Gases can do this too. But in addition, you have the 40% chance of research
   data and the 15% survey readout." So: canisters ALWAYS (amount in a range), the gas TYPE rolls by quality band;
   plus independent 40% research data and 15% survey readout rolls.
4. **Six canisters by quality band:** "2 standard, 2 augmented, 1 stellar and 1 radiant. Yep, the first radiant
   quality option. Not a gas, but it will require its own specialized container to be able to store ... my thought
   for the radiant quality item makes sense: ANTIMATTER. The balancing patch will add in more options, but this is the
   first, and I like antimatter!" More gas types will be added later.
5. **Research data types:** the six work; open to more that fit prod and in-development systems.
6. **Ancient races (verbatim):** "with jump gates not going to every place, a lot of planets are unexplored. So we will
   want to have plenty of different ancient races. That as we learn more and more about them, we might change the
   names of artifacts. So at first it might be \"Relic Sample A34\" or something and as you get more lore and
   discoveries about the race that lived on that planet, the name will appear when the research into that culture
   identifies what the object is. Because there could be millions of different races that died out before humanity.
   But some of these relics would match the current pool. So one race relic type should be able to match up with
   another. Because most races will have their own version of a given thing. If it's a pottery shard, all races will
   have some form of pottery shard. Something like that. So that way, we're not pushing more unnecessary relic sets.
   Unless we should have more."

## 2. The science we build on (so every number has a real anchor)

- Gas giants have no surface. NASA's Galileo probe (Dec 1995) entered Jupiter at about 47 km/s, sent data for about
  58 minutes and reached roughly 22 bar and 150 C before it went silent; it was later crushed and vaporized. Juno
  (2016 onward) studies Jupiter from orbit with microwave sounding hundreds of km below the cloud tops.
- Layers (Jupiter): ammonia ice clouds on top, ammonium hydrosulfide below, water clouds deeper; winds above 600 km/h;
  pressure and heat climb without limit until hydrogen turns metallic (~2 million bar).
- Mass vs density: Saturn (0.3 Jupiter masses) is less dense than water (0.69 g/cm3); Jupiter is 1.33; heavier
  "super-Jupiters" stay about Jupiter's size, so they get much denser and their gravity much harsher.
- How close to a star: about **13 Jupiter masses** starts deuterium burning (a brown dwarf, the "failed star" line);
  about **75 to 80 Jupiter masses** starts hydrogen fusion (a true star). Jupiter is about 1/80 of the way.
- Real atmospheric gases: hydrogen and helium (bulk), methane, ammonia, water vapor, hydrogen sulfide, deuterium (as HD),
  helium-3 (trace), neon and argon (trace). Ice giants (Uranus, Neptune) carry far more methane, ammonia and water.

## 3. Gas giants lose all ground activity

- `assignDiscoveriesAndActivities` returns early for an orbital-only body: no PoIs, no discoveries. It gets ONE study
  activity instead (section 5). This also fixes the relic foreknowledge preview automatically.
- Scan encounters: the encounter chance is 0 on an orbital-only body, but the keyed roll is STILL TAKEN so the stream
  position is unchanged (expedition.ts note at `scanStepRoll`). **[PROPOSAL]** supply caches also stop on gas giants
  (they are ground caches).
- Content: gasGiant leaves every PoI's `planetWeights`; the non-empty pool assert in `POIS_BY_PLANET_TYPE` skips
  orbital-only types; `MATERIAL_BY_PLANET_TYPE.gasGiant` retires (the study has its own table).
- In-flight runs: expeditions are stored verbatim and resolve from the stored record, so a run already carrying gas
  giant PoIs finishes as it was dispatched. **[PROPOSAL]** no migration (only branch and staging saves can hold one).
- UI: the body card's "orbital ops" chip stays; the " · satellite" activity card becomes the study card.

## 4. Giant classes (size and density) [PROPOSAL, names and bands]

Each gas giant body rolls a CLASS and a MASS (in Jupiter masses) from its own keyed stream (a new salt; no draw added to
a shared stream). Density rises with mass, so heavier means harsher gravity and a deeper, richer dive.

| Class | Mass band (Jupiter masses) | Real analog | Weight | Depth factor |
|---|---|---|---|---|
| Ice Giant | 0.04 to 0.06 | Uranus, Neptune | 3 | 0.8 |
| Saturn-class | 0.2 to 0.5 | Saturn | 3 | 1.0 |
| Jupiter-class | 0.8 to 2 | Jupiter | 3 | 1.2 |
| Super-Jupiter | 2 to 13 | exoplanets like Tau Bootis b | 2 | 1.5 |
| Brown Dwarf | 13 to 75 | "failed stars" | 1 | 2.0 |

The readout shows "how close it came to becoming a star" as the mass's share of the deuterium line (13) and the fusion
line (~75 to 80). A Brown Dwarf crossed the first line, so it reads "it DID ignite, briefly". Whether a Brown Dwarf can
appear as a "planet" body at all is the user's call (it is not a planet by the science, but it is the best answer to
"how close it got to becoming a star").

## 5. The study

- One study activity per gas giant body, run in the activities phase like any task (so phase timing and offline parity
  are unchanged). No Security fight, no landing; it always succeeds.
- **Who does it [PROPOSAL]:** the ship (no party required, never a gate). The Science party's gas-giant fieldwork (the
  existing crew layer + gear, already on the D23 curve) speeds it like any task.
- **The probe:** a Science member wearing a Galileo-Class Probe drops it from orbit. Probe DEPTH (its tuned stat on gas
  giants) times the giant's depth factor enlarges the reward through `diminishing()` (D23), and a deeper dive is
  faster to a good reading. Without a probe the study still runs with orbital sounding only (Juno style).
- **Reward:** ONE pick from a weighted pool **[PROPOSAL weights]**: Gas Canisters 45, Research Data 40, Survey Readout
  15. Rolled from the activity's keyed stream. The probe raises the SIZE of the reward, never which bucket.
  - Gas Canisters: a MIX of 2 to 3 gas types weighted by the giant's class (below), a few canisters each.
  - Research Data: 1 to 3 typed data items (section 7). A deep probe dive **[PROPOSAL]** has a small chance to add one
    ancient data item (an old probe or station lost in the depths).
  - Survey Readout: a Survey Log entry for this giant (section 8).
- The Galileo-Class Probe keeps its id `atmoProbe` (stable, like `fieldMedic`); only the label, blueprint label and
  flavor change. **[PROPOSAL flavor]** "Hardened against the crush and the acid. It keeps talking long after Galileo
  would have gone quiet."

## 6. Gas Storage Canisters (new warehouse category)

- New `ItemCategory` "gasCanister", a new Materials section "Gas Storage Canisters" (also on the Quartermaster Sell
  shelf automatically). Items are processed goods, so they are a category, not a raw subCategory.
- **[PROPOSAL items]** five canisters, every one a real giant gas:

| Item | Rarity | Richest at | Real basis |
|---|---|---|---|
| Hydrogen Canister | common | Saturn / Jupiter-class | bulk gas of every giant |
| Methane Canister | common | Ice Giant | gives Uranus and Neptune their blue |
| Ammonia Canister | uncommon | Ice Giant / Jupiter-class | the top cloud deck |
| Helium-3 Canister | rare | Jupiter-class / Super-Jupiter | trace isotope, classic fusion fuel |
| Deuterium Canister | rare | Super-Jupiter / Brown Dwarf | heavy hydrogen; also refined from Deuterium Ice |

- Refinery recipe **[PROPOSAL numbers]**: Deuterium Ice x10 -> Deuterium Canister x1 (gives the dead Deuterium Ice
  stock a use).
- **Crafting uses: OPEN.** They must not be dead stock. **[PROPOSAL]** add canisters as recipe inputs to propulsion and
  power blueprints (Hydrogen, Deuterium, Helium-3: FTL drive, reactor, thrusters) and to sensor / life-support style
  blueprints (Methane, Ammonia: coolant and chemistry). This overlaps the Material Lines draft; the user may prefer to
  place them there.
- Glyph: a new SVG canister icon in `icons.ts` + `ICON_SEMANTICS` (not emoji). Note: today's warehouse glyphs are emoji
  per category (`warehouseCategoryGlyph`); converting the rest is out of scope and logged.

## 7. Research Data (typed) and the ancient-data tab

**Typed research data [PROPOSAL names and mapping]:** one item per research family, matched by what the blueprint
outputs.

| Data item | Speeds blueprints that output |
|---|---|
| Propulsion Data | FTL drive, reactor core, thrusters, propellant tanks |
| Defense Data | shield emitters, hull plating |
| Weapons Data | weapons, drone pods |
| Systems Data | cargo bay, utility, sensor, bridge, quarters, materials |
| Field Data | away-team member gear and implants |
| Hull Design Data | hull unlocks (unlock-only blueprints) |

- Use: in the Research Lab, on a RUNNING project, "Apply data" consumes one matching item and removes **[PROPOSAL]**
  10% of that project's full duration. Repeat applications on the same project follow the D23 curve (each worth a bit
  less, never blocked). A new pure action lowers the process's `remainingTicks` (nothing does that today).
- They can be queued: no. They act only on a running project.

**Ancient data and the new Research Lab tab [PROPOSAL, needs the user]:**
- The only in-game name for an ancient race today is **"Precursor"** (the Precursor relic set, Precursor Lens,
  `precursorCircuit`). Is the user's "ancient race" the Precursors? If yes, the item could be "Precursor Data Fragment"
  and the tab "Decryption". If not, the user names both.
- Mechanics, modeled on Relic Study: the tab has its own lane. Feed N fragments to start a decryption project (timed);
  completing one decodes the next entry in a fixed sequence, and certain entries unlock SPECIAL blueprints
  (`requiresDecode`, mirroring `requiresRelicDiscovery`).
- **The special blueprints are the user's to name.** I will not invent them. Candidate DIRECTIONS only: a precursor
  variant of an existing ship system, a gas-giant-rated hull plating, a canister-fed engine.
- Sources: deep probe dives (above). **[PROPOSAL]** also a rare find at ancient PoIs (Ancient Ruins, Subterranean
  Civilization) on rocky bodies, so it is not gas-giant-only.

## 8. Survey Log (new Archive tab)

- `ArchiveSubTab` gains "surveyLog" next to Archive and Museum; component pattern follows `MuseumPanel.svelte`.
- An entry per studied giant (from a Survey Readout reward): system and body name, class, mass in Jupiter masses,
  density, a "how close to a star" bar with the 13 and ~78 lines marked, dominant gases, and one storm / feature line.
- Grouped by class with a count; first entry of each class is marked. Every number is derived from the body's stored
  roll, so an entry is a pure function of (seed, body).
- **[PROPOSAL]** a small reward for each class's first entry is NOT included (no new bonus unless the user asks).

## 9. Save, tests, help

- SAVE_VERSION 65 -> 66: new optional body fields (class, mass), `surveyLog`, the decryption state and lane, the new
  items (inventory is open-keyed). Old bodies without a class read as Jupiter-class only for display.
- Tests: orbital bodies get no PoIs and no encounter chance (stream position unchanged), class/mass determinism, study
  reward determinism and pool weights, probe depth on the D23 curve, research data cut and repeat curve, decryption
  lane, refinery recipe, item census tests (model.test.ts counts), parity (offline == live).
- Help: gas giants, the probe, canisters, research data, Decryption, Survey Log.

## 10. OPEN CALLS for the user

1. Giant classes: names, bands, and whether Brown Dwarfs appear (section 4).
2. Who runs the study (ship, no party required) and supply caches stop on gas giants (sections 3, 5).
3. Reward pool weights 45 / 40 / 15 (section 5).
4. The five canister names (section 6) and their crafting uses (here or in Material Lines).
5. The six research data types and the 10% cut (section 7).
6. Is the ancient race the Precursors? Names for the data item and the tab (section 7).
7. The special blueprints: what they are (section 7).
8. Ancient data sources beyond deep dives (section 7).
