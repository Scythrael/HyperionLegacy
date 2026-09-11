// helpTopics.ts: the in-game HELP program's core-systems manual.
//
// A static, structured manual rendered by the Help program (App.svelte's
// activeTab === "help" region). Each entry is one core system explained from
// the PLAYER'S side: what it is, what it does, and how to use it, in the game's
// CURRENT nav terminology (Crew, Operations, Foundry, Drydock, Stores,
// Homeworld, Battlespace). Bodies are PLAIN strings rendered verbatim (no
// markdown processor, same discipline as patchNotes.ts): what you type here is
// exactly what the player reads. Keep them accurate to the shipped game, keep
// them concise, and use real punctuation only (colons, commas, periods,
// parentheses); no em dashes and no doubled-hyphen em-dash substitutes.
//
// Test-guarded required ids (helpTopics.test.ts): missions, refining,
// fabricating, research, shipyard, docks, storage, salvage, fuel. Additional
// topics (crew, operations, homeworld, shipSystems, combat, patrols, combatView,
// combatGear, queues, craftingLevels, autoSalvage) are welcome and help orient a
// new player, but the nine above must always be present.
//
// ⚠️ THIS MANUAL IS PART OF A RELEASE, NOT A ONE-TIME WRITE-UP. Crafting 0.13.3
// shipped order queues, crafting levels, timed and batch salvage and auto-salvage
// without touching this file, which turned two shipped topics into falsehoods (a
// "trivial salvage can go instantly" that the timed salvage job had retired, and an
// "Allocated (held by running crafts)" that had quietly gained queued orders). Both
// are corrected above, and the three new topics (queues, craftingLevels,
// autoSalvage) cover what the release added. When a system changes shape, the topic
// that describes it changes in the same release.
//
// ⚠️ AND IT HAPPENED AGAIN, HALF-WAY, IN 0.13.3.1. That release updated the `salvage`
// topic for the Auto-Salvage Terminal and left the `autoSalvage` topic on its 0.13.3 text,
// which by then named two selecting rules instead of three, omitted favorites and the
// grace window entirely, and still described the shared-queue headroom rule that the
// Terminal removed. A manual that states a safety guarantee WRONGLY is worse than one
// that omits it, because a player reads it and then trusts the wrong thing. The topic is
// rewritten above against the engine: the three rules (selectAutoSalvageTargets), the six
// protections (AUTO_SALVAGE_PROTECTIONS, salvage.ts, which is the total record and
// therefore the checkable list), and the Terminal's own unbounded queue and lane
// (autoSalvageOrders + salvageLaneUsage, tick.ts).
//
// ⚠️ NO DATA-OWNED NUMBERS IN THE PROSE. The grace default, the grace option list, the
// Terminal's lane count and the borrow window are all constants, and the quality-tier
// count is derived from QUALITY_TIERS; printing any of them here would let a retune turn
// this manual into a lie with no test to catch it. Describe the behavior, name the control,
// and let the console show the number.

export interface HelpTopic {
  id: string;
  title: string;
  body: string;
}

export const HELP_TOPICS: HelpTopic[] = [
  {
    id: "crew",
    title: "Crew and Captains",
    body: "Crew is your roster of captains, found under the Crew program. Each captain commands one ship and earns XP every tick while out on a mission, so leveling is steady rather than only paying out at the end of a run. Your Fleet Admiral level rises alongside them, and it climbs faster the more captains you have working at once. Some captain slots start locked and open up once you have both the required talent and a high enough Fleet Admiral level. A captain needs a ship assigned (done at the Docks) before it can be dispatched on missions.",
  },
  {
    id: "missions",
    title: "Missions",
    body: "Missions are the timed runs your captains fly to bring back resources and fuel. You launch them from Operations under Dispatch: pick an available mission and a ready captain, and the ship makes the round trip on a timer. Every mission lists its rewards, the XP it grants per tick, and its dispatch requirements up front (captain level, cargo space, and fuel), with a clear reason spelled out whenever you cannot launch yet. Most missions burn fuel for the round trip, though the Local Deuterium Skim gathers fuel-grade ice at no fuel cost. Tougher runs such as Salvage and Forage ask for a more experienced captain before they will launch.",
  },
  {
    id: "operations",
    title: "Operations and Mission Control",
    body: "Operations is the program where you run missions. It has two parts: Dispatch, where you send captains out and watch their progress, and Mission Control, the facility that tracks which missions are available and how many times you have completed each one. New missions unlock through Mission Control as you progress, so check back there as your fleet grows.",
  },
  {
    id: "patrols",
    title: "Combat Patrols",
    body: "Combat Patrols are the first combat mission type, run from Operations under Combat Patrols. A patrol sends one captain and their assigned warship to sweep a pirate faction's territory: the ship transits out, fights a short series of enemy waves, and transits back. You do not pick a ship here (assign that at the Docks); you pick the captain and their assigned hull comes with them, shown read-only. Only a combat hull (a destroyer, battleship, or carrier) can patrol, so a captain flying a freighter or prospector is blocked with a clear reason until you assign a combat hull. Your hull also needs its combat gear installed to launch: a patrol is blocked until the ship has at least one weapon, a shield emitter, and hull plating installed (with no hull plating your ship would not survive the fight), and the dispatch card names whatever is still missing. Two patrols are available: the entry Crimson-Reaver Sweep, a short local sweep any combat hull can win, and the tougher Crimson-Reaver Warband, a real fight where hull choice, your crafted gear, and a carrier's drone screen all matter. Before you commit, the dispatch card shows two advisory readouts: your ship's Battle Rating (a single how-geared-am-I number that rises as you install better gear) and a Threat Assessment (a named band, from Guaranteed Victory down through the middle to Impossible, forecasting the fight against that patrol's enemies). Both are guidance only: you can dispatch regardless of what they say, and the exact win percentage is deliberately not shown. Choose a stance (Aggressive closes to short range, Balanced holds at medium, Standoff fights at long) and whether to dispatch once or repeatedly, then launch; each run burns round-trip fuel like any mission. Your hull's damage carries across the waves of a run while shields recover between them, and the in-progress readout shows the phase, waves won and lost, and live hull and shield bars. Win and the ship returns ready to go again; lose and it limps home flagged damaged and must be repaired before it can patrol again.",
  },
  {
    id: "combatView",
    title: "Combat View",
    body: "The Combat View is the watch-the-fight screen, opened with the View Combat Log button on an in-progress patrol in Operations. It plays the patrol's current battle round by round so you can follow the whole fight as it unfolds; the pace follows your Combat Log speed setting (a relaxed, readable cadence by default, with a faster skim option in Options). It is a display only: watching or closing it changes nothing about the run. Two modes share the same fight, chosen with the Mode toggle. Log-Guided narrates the battle as a scrolling combat log: round dividers and one line per event, marked for crits, damage over time, evasions, shield bleed-through, and kills. Visual plays the fight as animated damage numbers that pop over the ships, with a short tracer tinted by the firing weapon's family and the number shown in red for a critical hit or a kill. The Arena, shared by both modes, shows each ship with hull and shield bars, small square status pips (red for damage-over-time such as Plasma Fire, amber for disruptions such as Targeting Drift, green for buffs, hover for the name and rank), and ship-system condition pips per weapon, reactor, and drive reading Nominal, Degraded, Disrupted, or Offline as durability wears (hover for the label); a carrier also shows one pip per drone. Between the ships, a range track marks the current distance across the Short, Medium, and Long ranges with the current weapons range and engagement phase called out, since your chosen stance decides the range you try to hold. You can tune the log from Options (opened from your admiral portrait): switch the default flavor narration to a Simplified damage report, color-code shield and hull damage, set the stream speed, and turn auto-scroll on or off.",
  },
  {
    id: "refining",
    title: "Refining",
    body: "The Refinery, in the Foundry program, turns raw ore into the refined materials your Fabricator needs (for example Titanium Ore into Titanium Ingots, and Polysilicate Ore into Polysilicate Wafers). It runs as a set of independent production lines: each slot can be configured with its own tier, item, and amount, so several different refine jobs run at once. Starting a job reserves its ingredients up front so lines never double-spend the same stockpile, and each upgrade unlocks another line. You can queue a fixed batch or run continuously, and the status readout tells you why a line paused, whether it ran out of ingredients or the output storage is full.",
  },
  {
    id: "fabricating",
    title: "Fabricating",
    body: "The Fabricator, in the Foundry program, crafts real components, ship systems, and combat gear (weapons, shield emitters, hull plating, and drone pods) from the refined materials the Refinery produces, using the blueprints you have unlocked at the Research Lab. Combat gear is craftable alongside components and ship systems: research a weapon, shield, plating, or drone-pod blueprint, then fabricate it here just like any other system, and the finished piece lands in your spare pool, ready to install onto a ship from its Ship Systems screen. Like the Refinery it runs as independent per-slot production lines, each with its own recipe, tier, and amount, and starting a craft reserves its materials up front so concurrent lines never fight over the same parts. Your crafting skill levels up as you fabricate, and the Fabricator's own Crafting Level panel shows what that skill is currently worth (see the Crafting Levels topic). Any material's tooltip breaks its count into Allocated (held by running crafts AND by orders waiting in the queue), Free (available to start something new), and Total, which is why Free drops the moment you queue an order rather than when that order starts. Cancelling an unstarted line refunds its reserved materials to your Free pool, and removing a waiting order releases everything it had reserved.",
  },
  {
    id: "queues",
    title: "Order Queues",
    body: "Timed work can be lined up in advance instead of started by hand. The Refinery, the Fabricator, the Research Lab, the Salvage Bay and the Shipyard each keep their own order queue: set a job up, choose Add to queue, and it starts on its own as soon as that facility has room, including while the game is closed. TWO SEPARATE NUMBERS decide how much you can line up, and they are never added together or multiplied. LANES are how many jobs a facility runs AT ONCE: refining lines, fabrication lines, research slots, salvage bays, shipyard bays. You buy lanes with that facility's own upgrades, and each facility's lanes are its own. QUEUE DEPTH is how many orders may WAIT behind the running work. It starts at 1, it applies to every queue-capable facility SEPARATELY (a depth of 3 means three waiting orders at the Refinery and another three at the Salvage Bay, not three shared between them), and it is bought only with Homeworld talents under Fleet Logistics (Standing Orders), never with a facility upgrade. An order reserves what it needs the moment you queue it, not when it starts: the materials for a craft, or the exact spare system or units of salvaged material for a salvage. That is why your Free stock drops as soon as you add an order, and it is what stops two queued orders from claiming the same parts. Remove a waiting order and everything it had reserved comes straight back. Orders start in the order you added them, and one that cannot start yet (short on materials, or its output storage is full) is skipped so the ones behind it are not held up, with the reason shown on its own row. If a talent respec ever leaves you holding more orders than your current depth, nothing is lost: the extra orders drain normally, and no new one can be added until you are back under the cap.",
  },
  {
    id: "craftingLevels",
    title: "Crafting Levels",
    body: "Your Crafting level is the skill behind everything the Fabricator mints, and it has its own panel on the Fabricator with a live XP bar. Completed refine jobs, fabricate jobs and ship builds all award crafting XP, but deliberately not at the same rate: refining pays the lowest rate of the three, fabricating materials pays several times more, and fabricating equipment more again, scaling with the blueprint's tier, so crafting the gear you actually want is the fastest way to level and grinding ore is not a shortcut. Salvaging awards no crafting XP at all. What the level BUYS is item level: a freshly crafted piece is minted at your crafting level, plus any bonus from Homeworld talents under Industry (Tooling Upgrade), and then capped by a HARD CEILING set by the blueprint's own tier. The ceiling is the part worth remembering, because it is the one number that makes progress appear to stop: a tier-1 blueprint can never mint above its tier-1 ceiling no matter how high your crafting level climbs, and the talent reaches that ceiling sooner rather than lifting it. Once a tier reads as at the ceiling, the only way to mint higher is a higher-tier blueprint: research it at the Research Lab, then raise the Fabricator's level to craft it. Levels earned past every ceiling currently available are not wasted, they bank until higher-tier blueprints exist. The Crafting Level panel shows all of this per tier, so you can see exactly which of your gear tiers are still climbing and which are finished.",
  },
  {
    id: "research",
    title: "Research",
    body: "The Research Lab, in the Foundry program, is where you unlock blueprints. Each research project takes time and credits and permanently unlocks something you can build, from component recipes to ship-system and combat-gear blueprints (weapons, shield emitters, hull plating, and drone pods). Combat gear is researched here just like other ship systems: unlock a weapon, shield, plating, or drone-pod blueprint, then craft it at the Fabricator. Projects are organized in tiers gated by the lab's own level, so upgrading the lab opens deeper research. Research is the front of the whole production chain: research a blueprint here, craft it at the Fabricator, then use the result to build ships or install their systems, combat gear included.",
  },
  {
    id: "shipyard",
    title: "Shipyard",
    body: "The Shipyard, in the Drydock program, is where new ships are built. Found it once (it costs credits and a Fleet-Admiral level), then build hulls from your fabricated components and credits over a timed construction. When a build finishes, the new hull parks in your fleet, ready to assign to a captain at the Docks. This is the only way to add ships now: the old instant credit purchase is retired, so every ship comes out of the research, refine, fabricate, and build pipeline. Most hulls are buildable as soon as the Shipyard is founded, but the heavier warships (the battleship and the carrier) each stay locked until you research their hull blueprint at the Research Lab.",
  },
  {
    id: "docks",
    title: "Docks",
    body: "The Docks, in the Drydock program, is where you manage your fleet of hulls: assign a ship to a captain so it can fly missions, and open a ship's Ship Systems screen to install its ship systems. Your docks have a capacity cap (it starts at 8 hulls) that a timed Expand Docks upgrade raises one ship at a time. When a docks slot is full and you no longer need a ship, salvaging one frees its slot immediately.",
  },
  {
    id: "shipSystems",
    title: "Ship Systems",
    body: "Every ship has four equipment slots (Cargo Bay, FTL Drive, Reactor Core, and a Spec Utility slot for the hull's specialization) and comes pre-installed with a Standard-Issue baseline in each, so a bare ship is always ready to fly. Research ship-system blueprints at the Research Lab, craft them at the Fabricator, then open a ship's Ship Systems screen from the Docks to install them. Crafted systems are real upgrades over the baseline: each carries a quality grade (0 to 5), a rarity, and an item level that together set how much it boosts the ship. Install or uninstall in one tap and watch the ship's stats change. Uninstalling leaves that slot EMPTY and returns the piece to your spares, so nothing is ever lost and you can put it back (or install something else) whenever you like. The same Ship Systems screen also holds a combat hull's combat slots (weapon hardpoints, a shield slot, a hull-plating slot, and, on a carrier, drone bays); see the Combat Gear topic for installing those.",
  },
  {
    id: "combatGear",
    title: "Combat Gear",
    body: "Combat gear is the weapons, shield emitters, hull plating, and drone pods that decide how a warship fights. All four are craftable ship systems: research a blueprint at the Research Lab, fabricate it at the Fabricator, then install it onto a ship. Every ship starts with a free Standard-Issue set in each combat slot, so a hull is never unarmed even before you craft anything. You install combat gear on the ship's Ship Systems screen (opened from the Docks), the same screen used for the Cargo, FTL, Reactor, and Spec Utility slots. A combat hull has weapon hardpoints (how many depends on the hull), one shield slot, one hull-plating slot, and, on a carrier only, drone bays for its drone pods. To install a piece, tap an empty slot, hardpoint, or bay, then tap a spare from the pool that opens; tap an installed piece to uninstall it, which leaves that slot bare and returns the piece to your spares (this is the same for every slot on the ship, combat and economy alike). Crafted gear is a real upgrade over the Standard-Issue floor: each piece carries a quality grade, a rarity, and an item level, and by the middle item levels good crafted weapons, shields, plating, and drone pods clearly outclass the baseline, raising both your survivability and your firepower.",
  },
  {
    id: "storage",
    title: "Storage",
    body: "The Warehouse, in the Stores program, holds your materials and finished goods across two inventory tabs. Materials holds your raw ores, refined goods, components, and salvaged materials, grouped into themed sections (Ores and Metals, Volatiles, Organic Compounds, Recovered Tech, Refined, Components, and Salvaged Materials) and split by tier. Finished Goods holds your spare Ship Systems, your crafted combat Weapons, and your crafted combat Drone Pods (all researched and fabricated like any other ship system), with Modules and Consumables reserved for later. Each item shows a fill gauge for how full its cap is. Storage has caps, so producers automatically pause when a material is full instead of wasting output, and you can raise a cap with a timed capacity upgrade. Your spare ship systems have their own storage cap you can raise with a timed Systems Bay upgrade.",
  },
  {
    id: "salvage",
    title: "Salvage",
    body: "Salvage lets you break down what you no longer need to recover part of what it cost. You can salvage a whole ship at the Docks (in the Drydock program): its installed systems return to your spare pool first (so you never lose crafted gear), you recover a share of the materials and credits that built the hull, and the docks slot frees up right away (a ship on an active mission cannot be scrapped, and salvaging asks for confirmation). The Salvage Bay, in the Stores program, is where you break down spare systems and salvaged materials: salvage a spare ship system to reclaim a share of the materials that built it (so a full systems bay never blocks you), or break down the rare Damaged Reactor Housing for a tiered roll at rarer materials, with better odds as your Fleet Admiral levels and with the Salvage Operations talent. Salvaging at the bay is a TIMED job and is never instant: choosing Salvage adds an order to the bay's queue, the order reserves its target straight away so nothing else can claim it, and the teardown then runs on a countdown that keeps going while the game is closed. The bay runs one teardown per salvage bay it has, bought on its own Upgrades tab, and anything beyond that waits in the queue (see the Order Queues topic). Salvaged materials can be queued in batches, in which case the units start one at a time as bays free up. AUTO-SALVAGE HAS ITS OWN SEPARATE BAY, the Auto-Salvage Terminal, shown under the salvage queue: orders the rules create run there instead of in your salvage bays, they never use your queue slots, and there is no limit on how many can line up. The Terminal may also borrow one of your salvage bays when it has been sitting idle for a while, which keeps bought capacity working instead of standing empty; your own orders always have priority and claim the bay back as soon as the borrowed teardown finishes. You can also choose which item qualities ask for confirmation first, on the bay's Rules tab, so a tier you are happy to scrap goes into the queue without a dialog. Salvaging a whole ship at the Docks is the exception: it is not queued, and it still resolves the moment you confirm.",
  },
  {
    id: "autoSalvage",
    title: "Auto-Salvage",
    body: "Auto-salvage is an opt-in set of rules that queues spare ship systems for you, set up on the Salvage Bay's Rules tab. It is off by default, and even switched on it never destroys anything itself: it only ever ADDS ORDERS, and the teardown is the ordinary timed salvage job that order runs afterwards (see the Salvage topic). Turning the rules back off clears every order still waiting, though one already being broken down finishes. THREE RULES do the selecting and you can run any combination of them: a QUALITY rule that takes every spare at a chosen quality tier or below, a RARITY rule that takes every spare in the rarity bands you tick (one box per band rather than a threshold, so choosing one band can never sweep another), and a DUPLICATES rule that keeps the best copy of each blueprint in each slot (ranked by item level, then quality, then rarity) and takes the rest. They add together rather than compete, so a spare any one rule points at is queued, and choosing none means nothing is ever queued. SIX PROTECTIONS then have the last word, whatever a rule concluded: the rules will never touch a system installed on a ship, never destroy a Standard-Issue baseline (those return nothing, so removing one stays a deliberate manual choice), never queue something already queued or already being broken down, never take a quality tier you have set to ask you first, never take a system you have favorited (the Favorite button on a spare's tile in the Salvage Bay), and never take a system still inside its grace window. The confirm interlock is the one to know about first: a quality tier you have checked under Confirm before salvaging can NEVER be auto-salvaged, because the rules will not answer a confirmation on your behalf, and the shipped default asks for confirmation on every tier. So a fresh save that turns auto-salvage on will correctly do nothing until you uncheck a tier there. The GRACE WINDOW starts when a piece is crafted and starts again every time one is uninstalled, and it runs for a length you pick on the Rules tab (down to no grace at all, which keeps a warning on screen while it is selected), so a gear swap can never destroy the piece you have just taken off while you are still deciding whether to put it back. Everything the rules queue runs at the AUTO-SALVAGE TERMINAL, the automation's own bay shown under the salvage queue: it keeps its own waiting list with no limit on how many orders can line up, so it never uses your queue depth and never takes a salvage bay your own orders need. The Terminal will borrow one of your salvage bays that has been sitting idle for a while, which keeps bought capacity working instead of standing empty, and your own orders take priority and claim that bay back as soon as the borrowed teardown finishes.",
  },
  {
    id: "fuel",
    title: "Fuel",
    body: "Fuel powers the round trip on most missions. It runs on its own economy: the Fuel Depot, in the Foundry program, automatically refines Deuterium Ice into fuel through processing pipelines you can expand (upgrade for more pipelines, more fuel per batch, and less ice per batch). Run the free Local Deuterium Skim to gather ice, refine it at the Depot, and you stay self-sufficient. Each ship has its own fuel capacity (how far it can range) and engine efficiency (how little it burns). If a captain is short at launch, the shortfall is auto-bought with credits as a pricey backup that adds a short refuel delay, and that only stops repeating if you also run out of credits. A gauge in the top bar shows at a glance whether you are producing more fuel than you are burning.",
  },
  {
    id: "homeworld",
    title: "Homeworld",
    body: "Homeworld is your home base program, and today it is your administration hub. It is where you spend Homeworld talents that unlock and improve capabilities across the whole fleet, such as extra captain slots and better salvage odds. Your production facilities (the Refinery, Fabricator, Research Lab, and Fuel Depot) live in the Foundry program, not here. As the game grows, more of your empire management will be anchored at the Homeworld.",
  },
  {
    id: "combat",
    title: "Battlespace",
    body: "Battlespace is the home of ship combat. Combat runs today as Combat Patrols, launched from Operations: you send a captain and their assigned warship (a destroyer, battleship, or carrier) to sweep a pirate faction's territory, fight a short series of seeded enemy waves, and return with loot and bounty. How a ship performs is driven by the combat gear you install on it, its weapons, shield emitter, hull plating, and (on a carrier) drone pods, rather than by fixed per-hull numbers, so crafting and installing better gear directly makes your ships hit harder and last longer (see the Combat Gear topic). You can open the Combat View to watch a patrol fight live, or let it resolve on its own while you are away and read the recap when you get back. Ships wear down in a fight, weapons, reactor, and drive lose durability, and a lost patrol limps home flagged damaged, to be repaired at the Shipyard before it can fight again. See the Combat Patrols and Combat View topics for the details. The reserved Battlespace tabs are the future home of a deeper, interactive turn-based battle mode.",
  },
];
