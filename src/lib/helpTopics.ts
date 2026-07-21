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
// parentheses); no em dashes and no "--" as em-dash-style punctuation.
//
// Test-guarded required ids (helpTopics.test.ts): missions, refining,
// fabricating, research, shipyard, docks, storage, salvage, fuel. Additional
// topics (crew, operations, homeworld, shipSystems, combat) are welcome and
// help orient a new player, but the nine above must always be present.

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
    id: "refining",
    title: "Refining",
    body: "The Refinery, in the Foundry program, turns raw ore into the refined materials your Fabricator needs (for example Titanium Ore into Titanium Ingots, and Polysilicate Ore into Polysilicate Wafers). It runs as a set of independent production lines: each slot can be configured with its own tier, item, and amount, so several different refine jobs run at once. Starting a job reserves its ingredients up front so lines never double-spend the same stockpile, and each upgrade unlocks another line. You can queue a fixed batch or run continuously, and the status readout tells you why a line paused, whether it ran out of ingredients or the output storage is full.",
  },
  {
    id: "fabricating",
    title: "Fabricating",
    body: "The Fabricator, in the Foundry program, crafts real components and ship systems from the refined materials the Refinery produces, using the blueprints you have unlocked at the Research Lab. Like the Refinery it runs as independent per-slot production lines, each with its own recipe, tier, and amount, and starting a craft reserves its materials up front so concurrent lines never fight over the same parts. Your crafting skill levels up as you fabricate. Any material's tooltip breaks its count into Allocated (held by running crafts), Free (available to start something new), and Total, and cancelling an unstarted line refunds its reserved materials to your Free pool.",
  },
  {
    id: "research",
    title: "Research",
    body: "The Research Lab, in the Foundry program, is where you unlock blueprints. Each research project takes time and credits and permanently unlocks something you can build, from component recipes to ship-system blueprints. Projects are organized in tiers gated by the lab's own level, so upgrading the lab opens deeper research. Research is the front of the whole production chain: research a blueprint here, craft it at the Fabricator, then use the result to build or fit ships.",
  },
  {
    id: "shipyard",
    title: "Shipyard",
    body: "The Shipyard, in the Drydock program, is where new ships are built. Found it once (it costs credits and a Fleet-Admiral level), then build hulls from your fabricated components and credits over a timed construction. When a build finishes, the new hull parks in your fleet, ready to assign to a captain at the Docks. This is the only way to add ships now: the old instant credit purchase is retired, so every ship comes out of the research, refine, fabricate, and build pipeline.",
  },
  {
    id: "docks",
    title: "Docks",
    body: "The Docks, in the Drydock program, is where you manage your fleet of hulls: assign a ship to a captain so it can fly missions, and open a ship's Ship Systems screen to fit its equipment. Your docks have a capacity cap (it starts at 8 hulls) that a timed Expand Docks upgrade raises one ship at a time. When a docks slot is full and you no longer need a ship, salvaging one frees its slot immediately.",
  },
  {
    id: "shipSystems",
    title: "Ship Systems",
    body: "Every ship has four equipment slots (Cargo Bay, FTL Drive, Reactor Core, and a Spec Utility slot for the hull's specialization) and comes pre-fitted with a Standard-Issue baseline in each, so a bare ship is always ready to fly. Research ship-system blueprints at the Research Lab, craft them at the Fabricator, then open a ship's Ship Systems screen from the Docks to install them. Crafted systems are real upgrades over the baseline: each carries a quality grade (0 to 5), a rarity, and an item level that together set how much it boosts the ship. Install or uninstall in one tap and watch the ship's stats change; a live slot is never left empty, since uninstalling drops the baseline back into place.",
  },
  {
    id: "storage",
    title: "Storage",
    body: "The Warehouse, in the Stores program, holds your materials and systems. It is split into tabs (Raw, Refined, Component, Ship Systems, and Salvaged Materials), each with a fill-tile gauge showing how full it is. Storage has caps, so producers automatically pause when a material is full instead of wasting output, and you can raise a cap with a timed capacity upgrade. Your spare ship systems have their own storage cap you can raise with a timed Systems Bay upgrade.",
  },
  {
    id: "salvage",
    title: "Salvage",
    body: "Salvage lets you break down what you no longer need to recover part of what it cost. You can salvage a whole ship at the Docks: its installed systems return to your spare pool first (so you never lose crafted gear), you recover a share of the materials and credits that built the hull, and the docks slot frees up right away (a ship on an active mission cannot be scrapped, and salvaging asks for confirmation). You can also salvage a spare ship system in the Stores program to reclaim a share of the materials that built it, so a full systems bay never blocks you. The rare Damaged Reactor Housing can be broken down for a tiered roll at rarer materials, with better odds as your Fleet Admiral levels and with the Salvage Operations talent.",
  },
  {
    id: "fuel",
    title: "Fuel",
    body: "Fuel powers the round trip on most missions. It runs on its own economy: the Fuel Depot, in the Foundry program, automatically refines Deuterium Ice into fuel through processing pipelines you can expand (upgrade for more pipelines, more fuel per batch, and less ice per batch). Run the free Local Deuterium Skim to gather ice, refine it at the Depot, and you stay self-sufficient. Each ship has its own fuel capacity (how far it can range) and engine efficiency (how little it burns). If a captain is short at launch, the shortfall is auto-bought with credits as a pricey backup that adds a short refuel delay, and that only stops repeating if you also run out of credits. A gauge in the top bar shows at a glance whether you are producing more fuel than you are burning.",
  },
  {
    id: "homeworld",
    title: "Homeworld",
    body: "Homeworld is your home base program, where several core facilities live (the Refinery and the fuel and production infrastructure are grouped under your Homeworld and Fleet Sector). It is also where you spend talents that unlock and improve capabilities across the fleet, such as extra captain slots and better salvage odds. As you progress, more of your economy is anchored here.",
  },
  {
    id: "combat",
    title: "Battlespace",
    body: "Battlespace is where combat will live. The equipment system already builds toward it: the four ship-system slots on every hull are the foundation weapons and shields will plug into. Combat itself, including weapons, shields, and the systems those slots are designed for, arrives in a later update, so for now Battlespace is groundwork rather than a live battle screen.",
  },
];
