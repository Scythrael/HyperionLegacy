# Relic name sheets (0.14.0): DRAFT for sign-off

Status: DRAFT, 2026-11-02. Doc only; no code changed. Every name and flavor line below is **[PROPOSAL]** and is the
user's to accept, rename or reject. This is the sheet that closes "Still open: the name sign-offs" in
`2026-10-17-relics-v2-plan.md` (R2-5 exceptional names, R2-6 culture names), presented before R2-8.

## Counts (verified against the plan and `src/lib/game/relics.ts`)

| Group | Structure (source) | Names on this sheet |
|:-|:-|:-|
| Exceptional sets | `EXCEPTIONAL_SET_SIZES` (call 5 "Growing sets, 54 pieces"): I one set of 2; II one of 3; III two of 3; IV two of 4; V two of 4; VI three of 4; VII three of 5 | 14 set names |
| Exceptional pieces | same table: 2 + 3 + 6 + 8 + 8 + 12 + 15 | 54 piece names |
| Cultures | `CULTURE_ROSTER` (call 10 "Curated roster, 42 names"): 6 per region tier, 7 tiers | 42 culture names |
| **Total** | | **110 names** |

Ids are the stable ids already in `relics.ts` (a save stores them, so they do not change): sets `exc-t<tier>-<letter>`,
pieces `exc-t<tier>-<letter>-p<n>`, cultures `culture-t<tier>-<n>`. Only the labels change at sign-off.

Region tiers come from `galaxy.ts REGION_TIER_NAMES`: I Local Bubble, II Orion Arm, III Perseus Arm, IV Sagittarius
Arm, V Scutum-Centaurus Arm, VI Galactic Bulge, VII Galactic Core. Themes deepen with the tier: near and humble at I,
older, grander and stranger toward the Core.

The "stat" column is what the code assigns TODAY (`EXCEPTIONAL_PIECE_STAT_CYCLE`, marked [PROVISIONAL] in code: the 14
Museum stats in order, cycling across all 54 pieces; a full set lands on its first piece's stat). Names were chosen to
fit those stats where it reads naturally. Values are `EXCEPTIONAL_PIECE_VALUE` (I +3% rising to VII +15%), full set 5x
one piece, both user-approved 2026-10-20.

## Rules checked

- All names original. No real people. Nothing lifted from Star Trek or any other franchise (checked against the
  usual suspects: no Preservers, Progenitors, Iconians, Forerunners, Ancients, Builders, Krell and the like).
- The Captain's Sigil is untouched and not echoed: no "sigil", "flute", "inner light" or "lifetime in an hour" anywhere.
- No name or flavor line names or describes the First Cause antagonists; no culture is them.
- Avoided words already owned by existing relics or lore: Precursor, Archive, Leviathan, Lens, Rivet, Shipwright,
  Scythrael, First (as in First Cause).
- No duplicates with the 17 general relics or the four v1 sets, and none inside this sheet.
- US English, no em dashes, no double hyphens.

## Structural questions the docs do not answer

1. **Piece stats.** The code's stat cycle is provisional ("the R2-5 content sheet assigns them"). Keep the cycle as is
   (names below were fitted to it), or reassign stats by theme (for example every Deepcut piece on mining stats)?
2. **Mockup set names.** Plan 3.1 lists the mockup's Waystation, Hearthward, Deepcut, Lightkeeper and Shipwright's
   Choir sets as [PROPOSAL]; their piece names were never captured (the mockup lived in a scratchpad). Four are reused
   here. "Shipwright's Choir" is renamed **Keelsong** so it cannot be confused with the v1 Shipwright Set.
3. **Culture name display form.** Show the revealed name as "the Halvessi" or bare "Halvessi"? This sheet writes the
   bare name; the UI can add "the". The plan's derived display code ("Culture K-17") stays until the reveal.
4. **Culture lore line.** Plan 3.1 gives each culture "revealed name, lore line". The flavor column below is that lore
   line. Keep them, or ship names only and write lore with 0.15.0 story/quests?
5. **Which cultures appear where.** The roster is per region tier, so each culture below is themed to its region. If a
   culture should span regions, say which.

---

## Part A: Exceptional sets (14 sets, 54 pieces)

### Tier I, Local Bubble (1 set of 2, +3% per piece)

**exc-t1-a Waystation Set** [PROPOSAL]. Theme: a chain of humble rest stops where long-ago travelers left gifts for the
next ones through.

| id | name | stat | flavor |
|:-|:-|:-|:-|
| exc-t1-a | Waystation Set | full set: researchSpeed | Someone kept these lights on for strangers, for centuries. |
| exc-t1-a-p1 | Waystation Lantern | researchSpeed | Kept lit for travelers who never came back. It still lights when someone needs it. |
| exc-t1-a-p2 | Waystation Guestbook | craftingQuality | Thousands of signatures in hundreds of hands, every one of them saying thank you. |

### Tier II, Orion Arm (1 set of 3, +5% per piece)

**exc-t2-a Hearthward Set** [PROPOSAL]. Theme: the household wards of a colony home, the things a family carried
from world to world.

| id | name | stat | flavor |
|:-|:-|:-|:-|
| exc-t2-a | Hearthward Set | full set: relicFindChance | Wherever they settled, these came out of the crate first. |
| exc-t2-a-p1 | Hearthward Doorstone | relicFindChance | Worn smooth in one spot by countless hands touched to it on the way out. |
| exc-t2-a-p2 | Hearthward Kettle | cargoCapacity | Dented, mended, and somehow it always held enough for one more guest. |
| exc-t2-a-p3 | Hearthward Weathervane | transitSpeed | It does not point with the wind. It points home. |

### Tier III, Perseus Arm (2 sets of 3, +7% per piece)

**exc-t3-a Lightkeeper Set** [PROPOSAL]. Theme: the tenders of beacons along a dangerous lane, who watched the dark so
others could cross it.

| id | name | stat | flavor |
|:-|:-|:-|:-|
| exc-t3-a | Lightkeeper Set | full set: salvageYield | No wrecks on their lane for four hundred years. Then the keepers left. |
| exc-t3-a-p1 | Lightkeeper's Wick | salvageYield | Trimmed every night by the same careful hand, down to the last thread. |
| exc-t3-a-p2 | Lightkeeper's Beacon Glass | sensors | Hold it to the sky and faint ships appear that are not there anymore. |
| exc-t3-a-p3 | Lightkeeper's Watch Log | scanSpeed | Every passing ship, every night, in tidy columns. The last page is blank. |

**exc-t3-b Deepcut Set** [PROPOSAL]. Theme: a deep-mining guild that followed one seam through half a world.

| id | name | stat | flavor |
|:-|:-|:-|:-|
| exc-t3-b | Deepcut Set | full set: scienceTeamPower | They dug for a thousand years and never once lost the vein. |
| exc-t3-b-p1 | Deepcut Plumb Line | scienceTeamPower | Drop it anywhere and it hangs true, even where down is a matter of opinion. |
| exc-t3-b-p2 | Deepcut Shift Bell | crewBonuses | Rung at the end of every shift so the whole crew came up together. |
| exc-t3-b-p3 | Deepcut Drill Crown | miningYield | Its teeth are still sharp. The rock it was made for is long gone. |

### Tier IV, Sagittarius Arm (2 sets of 4, +9% per piece)

**exc-t4-a Stormglass Set** [PROPOSAL]. Theme: weather readers on a storm world, who learned to harvest what the sky
threw at them.

| id | name | stat | flavor |
|:-|:-|:-|:-|
| exc-t4-a | Stormglass Set | full set: rareMaterialChance | They did not fear the storms. They waited for them. |
| exc-t4-a-p1 | Stormglass Vial | rareMaterialChance | Crystals bloom inside it a day before anything rare comes to the surface. |
| exc-t4-a-p2 | Stormglass Siphon | extractionSpeed | Built to drink lightning and pour it out slowly. |
| exc-t4-a-p3 | Stormglass Mantle | hazardResist | The rain runs off it, and so does almost everything else. |
| exc-t4-a-p4 | Stormglass Almanac | researchSpeed | Three thousand years of forecasts. Most of them were right. |

**exc-t4-b Keelsong Set** [PROPOSAL; the mockup's "Shipwright's Choir", renamed]. Theme: shipbuilders who sang each
hull true as they laid it down.

| id | name | stat | flavor |
|:-|:-|:-|:-|
| exc-t4-b | Keelsong Set | full set: craftingQuality | A hull built to their song would ring for as long as it flew. |
| exc-t4-b-p1 | Keelsong Tuning Fork | craftingQuality | Strike it against a hull plate and you will hear exactly where it is weak. |
| exc-t4-b-p2 | Keelsong Hymnal | relicFindChance | Each verse names a ship and the place it was last seen. |
| exc-t4-b-p3 | Keelsong Hold Drum | cargoCapacity | They beat it while loading, and somehow the cargo always fit. |
| exc-t4-b-p4 | Keelsong Launch Horn | transitSpeed | One long note for every ship that left the yard. It still has breath in it. |

### Tier V, Scutum-Centaurus Arm (2 sets of 4, +11% per piece)

**exc-t5-a Tidewright Set** [PROPOSAL]. Theme: navigators of a world-wide ocean who read currents, stars and depths as
one map.

| id | name | stat | flavor |
|:-|:-|:-|:-|
| exc-t5-a | Tidewright Set | full set: salvageYield | They charted a sea with no shore and never once got lost. |
| exc-t5-a-p1 | Tidewright Net Float | salvageYield | Whatever it was tied to, it always came back with something. |
| exc-t5-a-p2 | Tidewright Sounding Shell | sensors | Put it to your ear and you hear the depth of whatever lies below you. |
| exc-t5-a-p3 | Tidewright Spyglass | scanSpeed | It shows the horizon a few hours from now. |
| exc-t5-a-p4 | Tidewright Star Table | scienceTeamPower | The stars and the tides on one carved slab, and they agree with each other. |

**exc-t5-b Ember Court Set** [PROPOSAL]. Theme: the regalia of a forge-kingdom whose rulers had to prove themselves at
the anvil.

| id | name | stat | flavor |
|:-|:-|:-|:-|
| exc-t5-b | Ember Court Set | full set: crewBonuses | No one wore the crown who had not first worked the forge. |
| exc-t5-b-p1 | Ember Court Banner | crewBonuses | Scorched at every edge, never once lowered. |
| exc-t5-b-p2 | Ember Court Crucible | miningYield | Ore went in common and came out worth a province. |
| exc-t5-b-p3 | Ember Court Coronet | rareMaterialChance | Every gem in it was found by the one who wore it. |
| exc-t5-b-p4 | Ember Court Bellows | extractionSpeed | One breath from it and the coals remember how to burn. |

### Tier VI, Galactic Bulge (3 sets of 4, +13% per piece)

**exc-t6-a Veilward Set** [PROPOSAL]. Theme: wardens who lived among the crowded, burning old stars of the Bulge and
learned to stand in their glare.

| id | name | stat | flavor |
|:-|:-|:-|:-|
| exc-t6-a | Veilward Set | full set: hazardResist | Where the sky was too bright to live under, they lived anyway. |
| exc-t6-a-p1 | Veilward Shroud | hazardResist | Woven so fine the starlight forgets to pass through. |
| exc-t6-a-p2 | Veilward Codex | researchSpeed | Written in shadow-ink that only shows in the brightest light. |
| exc-t6-a-p3 | Veilward Gauntlet | craftingQuality | It lets a careful hand work metal that is still glowing. |
| exc-t6-a-p4 | Veilward Divining Rod | relicFindChance | It dips toward anything older than itself, and that is a short list. |

**exc-t6-b Starwake Set** [PROPOSAL]. Theme: a nomad caravan fleet that drifted between ancient stars for longer than
most worlds have existed.

| id | name | stat | flavor |
|:-|:-|:-|:-|
| exc-t6-b | Starwake Set | full set: cargoCapacity | Their whole civilization fit in the holds, and there was room to spare. |
| exc-t6-b-p1 | Starwake Strongbox | cargoCapacity | Far larger inside than out. Nobody has found the bottom yet. |
| exc-t6-b-p2 | Starwake Sail Spar | transitSpeed | It catches a wind that blows between the stars. |
| exc-t6-b-p3 | Starwake Salvage Hook | salvageYield | The caravan wasted nothing. This hook is why. |
| exc-t6-b-p4 | Starwake Lookout Glass | sensors | The last lookout etched one word on the rim: "clear". |

**exc-t6-c Grand Orrery Set** [PROPOSAL]. Theme: pieces of a station-sized clockwork model of the Bulge, built to track
every star in it.

| id | name | stat | flavor |
|:-|:-|:-|:-|
| exc-t6-c | Grand Orrery Set | full set: scanSpeed | Wind it, and it shows the Bulge as it was. Wind it further and it shows it as it will be. |
| exc-t6-c-p1 | Orrery Sun-Gear | scanSpeed | A thousand teeth, each cut for one star. |
| exc-t6-c-p2 | Orrery Measuring Arm | scienceTeamPower | Accurate to a hair across a light-year. |
| exc-t6-c-p3 | Orrery Keeper's Chair | crewBonuses | Generations sat here winding it. The seat is worn into a gentle curve. |
| exc-t6-c-p4 | Orrery Counterweight | miningYield | Cast from a single nugget of an ore no survey has found since. |

### Tier VII, Galactic Core (3 sets of 5, +15% per piece)

**exc-t7-a Dawnmaker Set** [PROPOSAL]. Theme: the oldest makers near the Core, said to have tended young stars the way
a gardener tends seedlings.

| id | name | stat | flavor |
|:-|:-|:-|:-|
| exc-t7-a | Dawnmaker Set | full set: rareMaterialChance | Some of the stars you navigate by may have been planted. |
| exc-t7-a-p1 | Dawnmaker Seedstone | rareMaterialChance | Heavy beyond its size, and warm, as if something inside is waiting to begin. |
| exc-t7-a-p2 | Dawnmaker Ladle | extractionSpeed | Built to pour something hotter than metal. |
| exc-t7-a-p3 | Dawnmaker Heat Veil | hazardResist | Worn close to a newborn star. It has never been singed. |
| exc-t7-a-p4 | Dawnmaker Pattern Scroll | researchSpeed | A diagram of a sun, drawn before the sun was lit. |
| exc-t7-a-p5 | Dawnmaker Hammer | craftingQuality | Light in the hand. Every blow lands exactly where it should. |

**exc-t7-b Kinring Set** [PROPOSAL]. Theme: a ring of worlds around the Core that kept faith with each other across
every distance, and never let a member world go dark alone.

| id | name | stat | flavor |
|:-|:-|:-|:-|
| exc-t7-b | Kinring Set | full set: relicFindChance | Not one world in the ring was ever left behind. |
| exc-t7-b-p1 | Kinring Wayfinder | relicFindChance | It always points toward the nearest friend. |
| exc-t7-b-p2 | Kinring Gift Chest | cargoCapacity | Each world added one thing and passed it on. It is still full. |
| exc-t7-b-p3 | Kinring Gate Key | transitSpeed | It opens a gate that no longer exists, and the route is still shorter for it. |
| exc-t7-b-p4 | Kinring Mending Thread | salvageYield | It mends anything it is drawn through, given time. |
| exc-t7-b-p5 | Kinring Listening Horn | sensors | Made to hear a call for help from the far side of the ring. |

**exc-t7-c Long Vigil Set** [PROPOSAL]. Theme: watchers at the heart of the galaxy who kept a patient watch for longer
than any record knows. What they watched for is left unsaid.

| id | name | stat | flavor |
|:-|:-|:-|:-|
| exc-t7-c | Long Vigil Set | full set: scanSpeed | They watched for a very long time. Their records do not say what for. |
| exc-t7-c-p1 | Vigil Eye | scanSpeed | It has not blinked in an age, and it is not going to start now. |
| exc-t7-c-p2 | Vigil Star Atlas | scienceTeamPower | Every star near the Core, and a careful note beside each one. |
| exc-t7-c-p3 | Vigil Roll of Names | crewBonuses | Every watcher who stood the watch, in order. The list just stops. |
| exc-t7-c-p4 | Vigil Core Auger | miningYield | It bored straight down through a world to reach something they needed. |
| exc-t7-c-p5 | Vigil Coreglass | rareMaterialChance | Formed under a pressure that only exists in one place in the galaxy. |

---

## Part B: Cultures (42 names, 6 per region tier)

Each culture is a specific vanished race beneath the umbrella word "Precursor" (call 11). Until a culture reaches 10
study points its finds read "Relic Sample" plus a derived code; at 10 the name below is revealed. The flavor column is
the plan's per-culture "lore line" (see structural question 4).

### Tier I, Local Bubble. Theme: near neighbors, small and humble; potters, farmers, storytellers.

| id | name | flavor |
|:-|:-|:-|
| culture-t1-1 | Halvessi | Potters and storytellers. Half their shards carry a fingerprint pressed in on purpose. |
| culture-t1-2 | Corrimel | Terrace farmers who left their hillsides better than they found them. |
| culture-t1-3 | Teshvar | They counted in songs, and the songs still add up. |
| culture-t1-4 | Ambrinth | Weavers whose patterns double as maps of their valleys. |
| culture-t1-5 | Lowmarch | A border folk who kept the peace between two larger neighbors for a thousand years. |
| culture-t1-6 | Quillane | Letter writers. They seem to have written to everyone, including the future. |

### Tier II, Orion Arm. Theme: settlers and seafarers who spread between neighboring stars.

| id | name | flavor |
|:-|:-|:-|
| culture-t2-1 | Selvane | Mariners first, star sailors later, and they kept the same knots for both. |
| culture-t2-2 | Ithrae | Colonists who carried a handful of home soil to every world they settled. |
| culture-t2-3 | Garrowin | Builders of small, sturdy ships. Some of their hulls are still airtight. |
| culture-t2-4 | Oruveth | Record keepers who copied everything twice and stored the copies a world apart. |
| culture-t2-5 | Kestrani | Traders whose coins are found on worlds they never seem to have visited. |
| culture-t2-6 | Mirrowen | Gardeners of other worlds. Some of their orchards still bear fruit. |

### Tier III, Perseus Arm. Theme: delvers and fortress builders on hard, mineral-rich worlds.

| id | name | flavor |
|:-|:-|:-|
| culture-t3-1 | Throndal | Delvers who carved whole cities into the walls of a single canyon. |
| culture-t3-2 | Uskareth | Their fortresses were never taken. They were simply, one day, empty. |
| culture-t3-3 | Vohrim | Smiths who signed every tool with a mark for the miner it was made for. |
| culture-t3-4 | Calderin | They built their homes inside dormant volcanoes and kept them warm for ages. |
| culture-t3-5 | Ennisk | Surveyors whose boundary stones still agree to the meter. |
| culture-t3-6 | Brakkaval | Haulers and road builders. Their roads outlasted everything that used them. |

### Tier IV, Sagittarius Arm. Theme: cartographers and singers among the bright star nurseries.

| id | name | flavor |
|:-|:-|:-|
| culture-t4-1 | Aurenni | Cartographers who mapped the nebulae by the color of their light. |
| culture-t4-2 | Cirrhavel | Cloud dwellers who never set foot on the ground of their own world. |
| culture-t4-3 | Nalumbra | They named every star they could see, and they could see a great many. |
| culture-t4-4 | Orrisande | A choral people. Their buildings were tuned to a single chord. |
| culture-t4-5 | Wennoch | Patient astronomers who left instructions for the next astronomers. |
| culture-t4-6 | Zaelith | Glassmakers whose windows bend starlight into readable script. |

### Tier V, Scutum-Centaurus Arm. Theme: the great vanished powers; courts, leagues and long-lived houses.

| id | name | flavor |
|:-|:-|:-|
| culture-t5-1 | Kaltheon | A concord of a hundred worlds that settled every dispute with a shared meal. |
| culture-t5-2 | Merovant | Ruling houses whose family trees are carved down the sides of mountains. |
| culture-t5-3 | Imbrasi | A league of free ports with one law: no ship turned away. |
| culture-t5-4 | Sarrowmere | Old families who measured wealth in what they had given away. |
| culture-t5-5 | Dhuvessa | Engineers of an empire so orderly that its ruins are still in neat rows. |
| culture-t5-6 | Pellamyr | Lawgivers. Their courts handed down mercy more often than sentence. |

### Tier VI, Galactic Bulge. Theme: very old peoples of the crowded, ancient stars; stranger and harder to read.

| id | name | flavor |
|:-|:-|:-|
| culture-t6-1 | Ouvrenne | Their writing reads in a spiral, and the end of each spiral is the beginning of the next. |
| culture-t6-2 | Xantheru | They lived under a sky so full of stars it was never night. |
| culture-t6-3 | Ilvaroth | Shapers of whole moons. Several still hold the shapes they were given. |
| culture-t6-4 | Moirrin | Nobody knows what they looked like. They left only tools, and very fine ones. |
| culture-t6-5 | Quorrish | Their every surviving artifact has a twin, made somewhere else. |
| culture-t6-6 | Andevaal | Nomads of the Bulge whose camps are spread across a dozen star systems. |

### Tier VII, Galactic Core. Theme: the oldest of all, at the edge of what can be understood.

| id | name | flavor |
|:-|:-|:-|
| culture-t7-1 | Aeluun | So old that their relics predate the stars around them. |
| culture-t7-2 | Seyrith | They seem to have known the shape of the galaxy before it finished forming. |
| culture-t7-3 | Ommerane | Their artifacts answer questions nobody has thought to ask yet. |
| culture-t7-4 | Tirrhae | Makers of instruments for measuring something no living science can name. |
| culture-t7-5 | Caeldrun | Builders near the Core whose halls are larger than some moons. |
| culture-t7-6 | Yssembrel | The last name the oldest records agree on. After them, the records simply stop. |

## USER ANSWERS (2026-11-02): sheet structure calls

- Piece stats: "Match stats to themes (Recommended)": reassign each exceptional piece's stat to fit its name, still
  covering all 14 Museum stats evenly; values unchanged (I +3% to VII +15%, full set 5x).
- "Keelsong" replaces the mockup's "Shipwright's Choir": "Yes, Keelsong (Recommended)".
- Culture name display: "\"the Halvessi\" in prose (Recommended)": prose uses "the <Name>", lists and the ledger use
  the bare name.
- Culture lore lines: "Ship in 0.14.0 (Recommended)": shown once a culture is identified, no gameplay effect.
- The names themselves: AWAITING the user's read (approve all, rename some, or partial).

## USER (2026-11-02, verbatim): the names, lore and homages

"The name and lore of the relics are actually pretty amazing. I love them. I was actually thinking of the Keelsong
concept a little bit. A nice bit of an homage to the Ogier in Wheel of Time. Treesongs. If we do go with the ember court
set, I have an idea for that. It's a reference to the same thing in WoW. So we should 100% have a few references for
that. The Shadowlands feature. Perhaps we can make mention of the Ember Court teapot and so forth. I think that'd be
neat."
Reading: the user loves the sheet. Keelsong stays and leans into the treesinging homage (shipwrights who sing hulls into
shape, the way the Ogier sing wood). The Ember Court set stays and its flavor lines get a few affectionate nods to the
WoW Shadowlands Ember Court (e.g. a teapot with opinions, guests, a party that must go just right). These are homages
the USER chose, kept to flavor text (no copied text, no gameplay copied). Exact new flavor lines go back to the user
for sign-off. NOTE for the general rule: the user decides when a franchise nod is welcome; the drafting default stays
"original".
STILL OPEN from this exchange (unanswered, built behavior holds until answered): gear wear use floor (built 60% vs
"no floor" said 2026-11-02) and Quick Service (Oct 16 "paid rush" vs "None, always automatic" said 2026-11-02).

## HOMAGE DRAFT (2026-11-13) for the user's sign-off: Keelsong and Ember Court flavor lines

User direction (verbatim in docs/plans/2026-10-17-relics-v2-plan.md, 2026-11-13): Ember Court honors the WoW Ember
Court (the weekly Venthyr party: guests RSVP and bring gifts, entertainment, refreshments, security against party
crashers, an atmosphere tuned to each guest); Keelsong honors the Ogier of The Wheel of Time (treesingers who sing wood
into shape, the stedding, the Longing for home), "especially the one who is most Loial to our taveren heroes".
Names and stats stay as approved; only the flavor lines change. Original wording; no franchise names in game text.

Keelsong (theme unchanged: shipbuilders who sang each hull true):
| id | name | new flavor |
|:-|:-|:-|
| exc-t4-b | Keelsong Set | They never cut a timber. They sang it into the shape it wanted, and it held for a thousand years. |
| exc-t4-b-p1 | Keelsong Tuning Fork | Hum the right note and the grain of the hull turns to follow it. |
| exc-t4-b-p2 | Keelsong Hymnal | Kept by a young scholar who left home far too early to follow three friends, and wrote down every word. |
| exc-t4-b-p3 | Keelsong Hold Drum | Sized for hands twice as large as yours. Its beat still makes a crowded hold feel roomy. |
| exc-t4-b-p4 | Keelsong Launch Horn | However far its ships sailed, they came home sooner than they meant to. The yard was always calling. |

Ember Court (theme becomes: a court famous for the grand weekly gatherings its host threw in a hall of embers):
| id | name | new flavor |
|:-|:-|:-|
| exc-t5-b | Ember Court Set | The invitations went out every week, and every guest who came was back for the next one. |
| exc-t5-b-p1 | Ember Court Banner | Hung over the door on party nights. Nobody who walked beneath it went home unhappy. |
| exc-t5-b-p2 | Ember Court Crucible | The court's punch was brewed in it once. Nobody speaks of that night, but the ore it melts comes out richer. |
| exc-t5-b-p3 | Ember Court Coronet | The host wore it to greet each guest by name, and somehow every guest arrived bearing a gift. |
| exc-t5-b-p4 | Ember Court Bellows | It kept the hearth roaring through the longest gala, and blew out a party crasher or two. |
