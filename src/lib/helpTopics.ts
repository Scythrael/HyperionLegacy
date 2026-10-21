// helpTopics.ts: the in-game HELP program's core-systems manual.
//
// A static, structured manual rendered by the Help program (App.svelte's
// activeTab === "help" region). Each entry is one core system explained from
// the PLAYER'S side: what it is, what it does, and how to use it, in the game's
// CURRENT nav terminology (0.13.9 sweep: the bottom-nav tabs Home, Crew, Ships,
// Facilities, Logistics, and Ops, plus their sub-tabs; the 0.11.x program names
// Foundry, Drydock, and Stores are retired and must not come back). Bodies are PLAIN strings rendered verbatim (no
// markdown processor, same discipline as patchNotes.ts): what you type here is
// exactly what the player reads. Keep them accurate to the shipped game, keep
// them concise, and use real punctuation only (colons, commas, periods,
// parentheses); no em dashes and no doubled-hyphen em-dash substitutes.
//
// Test-guarded required ids (helpTopics.test.ts): missions, refining,
// fabricating, research, shipyard, docks, storage, salvage, fuel. Additional
// topics (crew, operations, homeworld, shipSystems, combat, patrols, combatView,
// combatGear, queues, craftingLevels, autoSalvage, quartermaster, relics, and the 0.14.0 ground set:
// groundTeams, groundOperations, returnTrip, objectiveDifficulty, affixes, reinforcing, riskFactors,
// subspaceTelescope, scanEvents) are welcome and
// help orient a new player, but the nine above must always be present.
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
// ⚠️ AND ONE OF THOSE SIX STOPPED BEING A GUARANTEE (the 0.13.3.1 follow-up that made
// Standard-Issue baselines auto-salvageable). `baseline` is now CONDITIONAL on the player's
// rules reaching the piece, so the flat "never destroys a Standard-Issue baseline" clause this
// topic used to carry became exactly the kind of falsehood the paragraphs above were written
// about: a player would read the manual and trust a protection the engine had stopped applying.
// The clause is rewritten as the condition it now is, in the same change that made it one.
//
// ⚠️ NO DATA-OWNED NUMBERS IN THE PROSE. The grace default, the grace option list, the
// Terminal's lane count and the borrow window are all constants, and the quality-tier
// count is derived from QUALITY_TIERS; printing any of them here would let a retune turn
// this manual into a lie with no test to catch it. Describe the behavior, name the control,
// and let the console show the number.
//
// 0.14.0 GROUND OPERATIONS (GO-18, SQ-7 section 7.5): the user asked for the manual to state the real
// rules and times (cure times, legs, the loss streak, the detail ladder). So those topics never TYPE a
// number: every number in them is read from the engine constant that owns it (the template helpers
// below), which keeps the rule above (a retune cannot make the manual lie) while still printing values.
// Those topics are also laid out in short paragraphs and "- " lists separated by line breaks; the Help
// panel renders bodies with white-space: pre-line, so a body without line breaks reads exactly as before.
// Player text rules: "objective", never "task"; no em dashes; install, never fit; US English.

import { AFFIX_DEFS, IMPOSSIBLE_DIFFICULTY_NAME } from "./game/affixes";
import { THREAT_TIER_ORDER, threatAssessment, type ThreatAssessment, type ThreatTier } from "./game/combat/threatAssessment";
import { HELPER_MIN_TIER } from "./game/groundThreat";
import {
  DEPLOY_SECONDS,
  FIELD_REPAIR_DAMAGE_SHARE,
  FIELD_REPAIR_PLANET_TYPES,
  FIELD_REPAIR_TIME_MULT,
  GROUND_OPS_STUCK_TEXT,
  GROUND_STUCK_LOSSES,
  IN_SYSTEM_LEG_SECONDS,
  OFFLOAD_BASE_SECONDS,
  ORBIT_REPAIR_TIME_MULT,
  RELOAD_BASE_SECONDS,
  RETURN_SECONDS,
  SURVEY_AMBUSH_MAX_PER_TASK,
} from "./game/groundOps";
import { GROUND_CONDITIONS, STONESKIN_INJURY_MULT } from "./game/medicalBay";
import {
  AMBUSH_CHANCE_BY_GRADE,
  CLEARING_SITE_RULES,
  DIFFICULTY_NAMES,
  DIFFICULTY_WEIGHTS,
  FLORALESS_PLANET_TYPES,
  FLORA_WORK_SLOW_PER_GRADE,
  HOSTILE_SITE_RULES,
  LIFELESS_PLANET_TYPES,
  LIFE_SITES,
  RISK_FACTOR_NAMES,
  RISK_GRADE_NAMES,
  SAFE_NEEDS_MAX_TIER,
  riskRewardBonus,
} from "./game/riskFactors";
import { MUSEUM_HAZARD_RESIST_MAX } from "./game/relics";
import {
  REGION_TIER_NAMES,
  TELESCOPE_DETAIL_NAMES,
  TELESCOPE_LORE,
  TELESCOPE_SHIP_LIFT,
  TELESCOPE_SHIP_LIFT_SENSORS,
  regionTierNumeral,
} from "./game/telescope";
import { ODDS_RISKY_BELOW } from "./game/launchRecommendation";
import {
  BOARDING_ATTEMPT_CHANCE,
  BOARDING_CREDIT_LOSS_SHARE,
  BOARDING_PAUSE_SECONDS,
  CLOAKED_REPAIR_SECONDS,
  DEBRIS_DELAY_SECONDS,
  GHOST_CLOAKED_CHANCE,
  GHOST_RESCAN_SECONDS,
  PROBE_REPAIR_SECONDS,
  STORM_SLOW_SECONDS,
} from "./game/shipScanEvents";
import { getPlanetTypeById, groundSiteLabel } from "./game/expeditionContent";
import { BLIND_LAUNCH_WARNING } from "./expeditionDispatchDisplay";
import type { RegionTier } from "./game/model";
// Reactor fuel ladder (0.14.0): the Ship Systems topic reads each core's Deuterium Canister count off its recipe.
import { BLUEPRINTS } from "./game/model";
// WR-4 (OC-C1): the Fuel Depot's per-level fleet reach, read from the engine constant (no stale number).
import { FUEL_DEPOT_REACH_PER_RUNG } from "./game/model";

// ===== Derived-text helpers (0.14.0 topics; see the header) =====

// "1 minute", "20 minutes", "45 seconds".
function span(seconds: number): string {
  if (seconds % 60 === 0) return seconds === 60 ? "1 minute" : `${seconds / 60} minutes`;
  return `${seconds} seconds`;
}
// "25%".
function pct(fraction: number): string {
  return `${Math.round(fraction * 100)}%`;
}
// "a, b or c".
function orList(items: readonly string[]): string {
  return items.length <= 1 ? items.join("") : `${items.slice(0, -1).join(", ")} or ${items[items.length - 1]}`;
}
function tier(t: number): string {
  return `Tier ${regionTierNumeral(t as RegionTier)}`;
}
function site(id: string): string {
  return groundSiteLabel(id) ?? id;
}
// "Barren, Volcanic or Gas Giant" (the content catalog's planet labels).
function planets(ids: readonly string[]): string {
  return orList(ids.map((id) => getPlanetTypeById(id)?.label ?? id));
}
// The first risk grade at which a per-grade chance table can roll ("Moderate").
function firstRollingGrade(permille: readonly number[]): string {
  const i = permille.findIndex((p) => p > 0);
  return RISK_GRADE_NAMES[i >= 0 ? i : RISK_GRADE_NAMES.length - 1];
}
// The seven threat tiers, read from threatAssessment (the one table that owns their names and phrases).
const THREAT_BY_TIER = new Map<ThreatTier, ThreatAssessment>();
for (let wins = 100; wins >= 0; wins -= 1) {
  const a = threatAssessment(wins, 100);
  if (!THREAT_BY_TIER.has(a.tier)) THREAT_BY_TIER.set(a.tier, a);
}
function tierName(t: ThreatTier): string {
  return THREAT_BY_TIER.get(t)?.name ?? t;
}
const THREAT_LIST = THREAT_TIER_ORDER.map((t) => {
  const a = THREAT_BY_TIER.get(t);
  return a ? `- ${a.name}: ${a.fuzzyRange.charAt(0).toLowerCase()}${a.fuzzyRange.slice(1)}.` : "";
}).join("\n");
// The bay conditions a member can bring home today (the rest of GROUND_CONDITIONS arrive with Field Kits), under
// the engine's own labels, as the bay card shows them.
const CURE_IDS: readonly string[] = ["health", "poison", "bleed", "downed"];
const CURE_LIST = CURE_IDS.map((id) => {
  const c = GROUND_CONDITIONS[id];
  return `- ${c.label}: ${span(c.cureSeconds)}${c.cls === "health" ? " (hit points lost in the fights)" : c.cls === "injury" ? " (an injury)" : ""}`;
}).join("\n");
const DIFFICULTY_LIST = DIFFICULTY_NAMES.map((n, i) => `${n} x${DIFFICULTY_WEIGHTS[i]}`).join(", ");
const DEADLY = DIFFICULTY_NAMES.length;
const FIRST_SKIPPING_TIER = SAFE_NEEDS_MAX_TIER + 1;
const REINFORCING_REQUIRED = DIFFICULTY_NAMES[(AFFIX_DEFS.reinforcing.requiredFromDifficulty ?? DEADLY) - 1];
const LIFT_TEXT = TELESCOPE_SHIP_LIFT === 1 ? "one level" : `${TELESCOPE_SHIP_LIFT} levels`;

export interface HelpTopic {
  id: string;
  title: string;
  body: string;
}

export const HELP_TOPICS: HelpTopic[] = [
  {
    id: "crew",
    title: "Crew and Captains",
    body: "Crew is your roster of captains, found on the Crew tab under Captain Roster. Each captain commands one ship and earns XP every tick while out on a mission, so leveling is steady rather than only paying out at the end of a run. Your Fleet Admiral level rises alongside them, and it climbs faster the more captains you have working at once. Some captain slots start locked and open up once you have both the required talent and a high enough Fleet Admiral level. A captain needs a ship assigned (from the ship's page on the Ships tab) before it can be dispatched on missions.",
  },
  {
    id: "missions",
    title: "Missions",
    body: "Missions are the timed runs your captains fly to bring back resources. You launch them from the Ops tab under Gathering: pick an available mission and a ready captain, and the ship makes the round trip on a timer. Every mission lists its rewards, the XP it grants per tick, and its dispatch requirements up front (captain level, cargo space, and the trip's distance), with a clear reason spelled out whenever you cannot launch yet. A ship can only fly a mission whose round-trip distance is within its reach (see the Fuel topic). Tougher runs such as Salvage and Forage ask for a more experienced captain before they will launch. The Cometary Ice Harvest is open from day one: it mines a passing comet for Deuterium Ice, with Titanium Ore and the odd Iridium Ore strike, and the Refinery presses that ice into the Deuterium Canisters every Reactor Core blueprint is crafted with.",
  },
  {
    id: "operations",
    title: "Operations and Mission Control",
    body: "Operations, the Ops tab, is where you run missions. Gathering and Combat Patrols are where you send captains out, the Overview shows every mission in progress, and Mission Control is the facility that tracks which missions are available and how many times you have completed each one. New missions unlock through Mission Control as you progress, so check back there as your fleet grows.",
  },
  {
    id: "patrols",
    title: "Combat Patrols",
    body: "Combat Patrols are the first combat mission type, run from the Ops tab under Combat Patrols. A patrol sends one captain and their assigned ship to sweep a pirate faction's territory: the ship transits out, fights a short series of enemy waves, and transits back. You do not pick a ship here (assign that on the Ships tab); you pick the captain and their assigned hull comes with them, shown read-only. Any hull can patrol: freighters and prospectors carry a light Standard-Issue combat set, but a purpose-built warship (a destroyer, battleship, or carrier) is far stronger. The only gear a patrol requires is a Reactor Core, because with no reactor the ship has no power to set a course. A ship with no weapon installed can still launch, but the dispatch card warns you that it will not be able to return fire. Two patrols are available: the entry Crimson-Reaver Sweep, a short local sweep any warship can win, and the tougher Crimson-Reaver Warband, a real fight where hull choice, your crafted gear, and a carrier's drone screen all matter. Before you commit, the dispatch card shows two advisory readouts: your ship's Battle Rating (a single how-geared-am-I number that rises as you install better gear) and a Threat Assessment (a named band, from Guaranteed Victory down through the middle to Impossible, forecasting the fight against that patrol's enemies). Both are guidance only: you can dispatch regardless of what they say, and the exact win percentage is deliberately not shown. Choose a stance (Aggressive closes to short range, Balanced holds at medium, Standoff fights at long) and whether to dispatch once or repeatedly, then launch; like any mission, the round trip must be within your hull's reach. Your hull's damage carries across the waves of a run while shields recover between them, and the in-progress readout shows the phase, waves won and lost, and live hull and shield bars. Win and the ship returns ready to go again; lose and it limps home flagged damaged and must be repaired before it can patrol again.",
  },
  {
    id: "combatView",
    title: "Combat View",
    body: "The Combat View is the watch-the-fight screen, opened with the View Combat Log button on an in-progress patrol in the Ops tab's Overview. It plays the patrol's current battle round by round so you can follow the whole fight as it unfolds; the pace follows your Combat Log speed setting (a relaxed, readable cadence by default, with a faster skim option in Settings). It is a display only: watching or closing it changes nothing about the run. Two modes share the same fight, chosen with the Mode toggle. Log-Guided narrates the battle as a scrolling combat log: round dividers and one line per event, marked for crits, damage over time, evasions, shield bleed-through, and kills. Visual plays the fight as animated damage numbers that pop over the ships, with a short tracer tinted by the firing weapon's family and the number shown in red for a critical hit or a kill. The Arena, shared by both modes, shows each ship with hull and shield bars, small square status pips (red for damage-over-time such as Plasma Fire, amber for disruptions such as Targeting Drift, green for buffs, hover for the name and rank), and ship-system condition pips per weapon, reactor, and drive reading Nominal, Degraded, Disrupted, or Offline as durability wears (hover for the label); a carrier also shows one pip per drone. Between the ships, a range track marks the current distance across the Short, Medium, and Long ranges with the current weapons range and engagement phase called out, since your chosen stance decides the range you try to hold. You can tune the log from Settings (the gear in the top bar): switch the default flavor narration to a Simplified damage report, color-code shield and hull damage, set the stream speed, and turn auto-scroll on or off.",
  },
  {
    id: "refining",
    title: "Refining",
    body: "The Refinery, in Facilities, turns raw ore into the refined materials your Fabricator needs (for example Titanium Ore into Titanium Ingots, and Polysilicate Ore into Polysilicate Wafers). It runs as a set of independent production lines: each slot can be configured with its own tier, item, and amount, so several different refine jobs run at once. Starting a job reserves its ingredients up front so lines never double-spend the same stockpile, and each upgrade unlocks another line. You can queue a fixed batch or run continuously, and the status readout tells you why a line paused, whether it ran out of ingredients or the output storage is full.",
  },
  {
    id: "fabricating",
    title: "Fabricating",
    body: "The Fabricator, in Facilities, crafts real components, ship systems, and combat gear (weapons, shield emitters, hull plating, and drone pods) from the refined materials the Refinery produces, using the blueprints you have unlocked at the Research Lab. Combat gear is craftable alongside components and ship systems: research a weapon, shield, plating, or drone-pod blueprint, then fabricate it here just like any other system, and the finished piece lands in your spare pool, ready to install onto a ship from its Ship Systems screen. Like the Refinery it runs as independent per-slot production lines, each with its own recipe, tier, and amount, and starting a craft reserves its materials up front so concurrent lines never fight over the same parts. Your crafting skill levels up as you fabricate, and the Fabricator's own Crafting Level panel shows what that skill is currently worth (see the Crafting Levels topic). Any material's tooltip breaks its count into Allocated (held by running crafts AND by orders waiting in the queue), Free (available to start something new), and Total, which is why Free drops the moment you queue an order rather than when that order starts. Canceling an unstarted line refunds its reserved materials to your Free pool, and removing a waiting order releases everything it had reserved.",
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
    body: "The Research Lab, in Facilities, is where you unlock blueprints. Each research project takes time and credits and permanently unlocks something you can build, from component recipes to ship-system and combat-gear blueprints (weapons, shield emitters, hull plating, and drone pods). Combat gear is researched here just like other ship systems: unlock a weapon, shield, plating, or drone-pod blueprint, then craft it at the Fabricator. Projects are organized in tiers gated by the lab's own level, so upgrading the lab opens deeper research. Research is the front of the whole production chain: research a blueprint here, craft it at the Fabricator, then use the result to build ships or install their systems, combat gear included.",
  },
  {
    // Exploration 0.14.0 (E4c). No ladder thresholds or bonus sizes in the prose (they are tunable
    // constants in relics.ts; the Museum tab prints the live numbers), per the rule at the top.
    id: "relics",
    title: "Relics and the Museum",
    body: "Relics are recovered by your away teams on expeditions. A team that wins an objective at a relic-bearing site may bring one home, and the Expedition Console names which relic sets a system's sites can yield once your sensors are strong enough. Relics arrive unidentified: claiming a finished expedition puts them in the Relic Vault on the Research Lab's Relics tab. Study a relic there to reveal which relic of its set it is. A study takes time and runs on its own lane, so it never blocks blueprint research. A relic's tier (from the away-team roll) matters: a higher tier makes the rarer relics of its set more likely. The first time you identify a relic type is a first find, a new discovery for your collection. Every identified copy goes to the Museum, on the Archive's Museum tab, and grants a small permanent bonus of its set's per-copy stat. Each set is also a collection: owning relics 1 through K of a set unlocks its K-piece set bonus, and that bonus levels up as you collect more copies. A level needs every required relic at the next copy threshold, so a tier is only as strong as its least-collected relic, and the Museum highlights the bottleneck relic holding a tier back.",
  },
  {
    // 0.14.0 Squads (SQ-7 section 7.5, "Team types and squads"). Every hull fields two teams of two squads today.
    id: "groundTeams",
    title: "Team Types and Squads",
    body: [
      "Every ship carries its own ground crew, set up on the ship's Away Team tab (open the ship on the Ships tab). The crew is organized into squads: Security squads fight, and Science squads do the fieldwork, which sets how fast an objective goes, how much it yields and how well the crew copes with a world's hazards. Science never fights.",
      "TEAMS: squads are paired into teams, named Alpha and Bravo by default. Rename a team any time, even while the ship is out. Each team has a type:\n- Ground: one Security and one Science squad (the default).\n- Strike: two Security squads.\n- Survey: two Science squads.",
      'The ship must always keep at least one Security and one Science squad, so a type that would break that is refused, with the reason shown. Choose a type, then apply it with its "Change to" button; the panel names who moves first. Members of a squad the change drops go to the reserve, and a new squad fills from the reserve.',
      "THE RESERVE: members aboard who are not slotted. They stay on the ship and never deploy, but they still count toward the crew limit. Slot one into an empty slot, or swap them with a slotted member. A new hire is slotted into the first empty slot of their squad type.",
      "DEPLOYING: a team goes down only when each of its squads has at least one slotted member and every slotted member is ready. An injured member keeps their team aboard until they recover; nobody stands in automatically. To launch, at least one team must deploy, and the deploying teams together need a ready Security member and a ready Science member. While the ship is out, slots and team types are locked; renaming and the help setting still work.",
      'HELPING: each team\'s "When done, help other teams" setting decides whether it borrows other teams\' objectives once its own queue is empty. Change it any time, even while the ship is out; it takes effect from the next launch. See the Ground Operations topic.',
    ].join("\n\n"),
  },
  {
    // 0.14.0 Ground Operations (GO-18). Numbers read from groundOps.ts / groundThreat.ts (see the header).
    id: "groundOperations",
    title: "Ground Operations",
    body: [
      "Ground Operations is how your ground teams work a system on an expedition (the Ops tab, under Exploration). The ship scans the system's bodies from orbit, one at a time. When a body's scan finishes, its objectives appear, already assigned to your teams by the default plan, and the teams start on them while the ship scans the rest. The expedition heads home once every body is scanned, no objective is left and every team is back aboard.",
      'OBJECTIVES: each objective has a progress bar marked with fight points. Science fieldwork moves the bar, and at each fight point the team\'s Security members must win a fight to go on. An objective with no fight points is quiet survey work, though a crew can still be ambushed there (see the Risk Factors topic). An objective that needs more squads than one team brings reads "Needs a partner": two teams work it together as one crew, fight as one side, and it pays once. Objectives can also carry affixes (see the Objective Affixes topic).',
      `PROGRESS IS KEPT: a lost fight sends the team back to the ship, but the objective keeps its progress, and the team resumes at the fight that stopped it, against a fresh enemy. Each finished stretch of the bar banks its share of the haul, kept even if a later fight is lost, so nothing is earned twice. A relic, if the site holds one, is rolled only when the objective reaches 100%. Within one trip the survivors carry their wounds from fight to fight, and a member who goes down sits out the rest of that objective until the medical bay (see the Return Trip and Medical Bay topic).`,
      "THE QUEUES: the expedition card lists each body's objectives, with a column of odds for each team.\n- Assigned: pick a crew, then Apply.\n- Queue: move an objective up or down its team's queue.\n- Skip: set an objective aside with its progress kept; Re-queue brings it back.\n- Default plan: the hardest objective to the strongest team, on down. A team working alone takes its objectives easiest first.\n- Auto-assign randomly: hands the body's queued objectives out at random.\nEdits apply from now on: nothing already resolved changes. You can also pick a larger crew than an objective needs (for example Alpha and Bravo together on a hard one): more punch and more fieldwork, but the ship then works one objective where it could work two, so the run goes slower. The plan never picks one for you.",
      `ODDS: each odds chip names one of seven tiers, the chance that crew wins every fight left on the objective in one go, from where it stands now:\n${THREAT_LIST}\nOdds never change a fight. Because progress is kept between trips, an objective that reads ${tierName("extreme")} or even ${tierName("impossible")} can still fall over several trips. An objective's difficulty rating is a different reading (see the Objective Difficulty topic).`,
      `HELPERS: a team set to help other teams, once its own queue is empty, borrows another team's queued objective that it can cover alone and rates ${tierName(HELPER_MIN_TIER)} or better. A helper's win finishes the objective. A helper's loss hands it back to its owner with its progress kept, and that helper does not borrow it again.`,
      `WIPES: if every Security member of a team goes down, the team cannot shuttle up on its own. The ship breaks off its scan and flies to them, ${span(IN_SYSTEM_LEG_SECONDS)} each way, and the scan makes no progress meanwhile. When the teams of one crew (working a shared objective) are wiped together, they share one trip; otherwise each wiped team waits for its own, and the ship makes one trip at a time. Once the scan is done, the ship still comes for them.`,
      `BACK OF THE LINE: after ${GROUND_STUCK_LOSSES} losses in a row on an objective without clearing a new fight point, it moves to the back of its team's queue, so easier objectives get done first. It comes around again later with its progress kept. A lost surprise fight (an ambush, or reinforcements from the Reinforcing affix) counts as a loss too. When the teams have nothing else left, the queue shows "${GROUND_OPS_STUCK_TEXT}". The teams keep trying and never give up on their own: send a stronger crew, or Skip the objective so the run can move on. A Reinforcing objective can also be held for a while after setbacks (see the Reinforcing (affix) topic).`,
    ].join("\n\n"),
  },
  {
    // 0.14.0 Ground Operations (GO-18): the return trip, split from groundOperations so each reads in one screen.
    id: "returnTrip",
    title: "Return Trip and Medical Bay",
    body: [
      `After every trip to an objective, won or lost, a team comes back to the ship before its next one:\n- Shuttle up (${span(RETURN_SECONDS)}), or wait for the ship after a wipe (see the Ground Operations topic).\n- Offload (${span(OFFLOAD_BASE_SECONDS)}): the haul banked on the trip goes into the hold. Skipped when nothing new was banked.\n- Medical bay: everyone heals (below).\n- Reload (${span(RELOAD_BASE_SECONDS)}), then the drop to the next objective (${span(DEPLOY_SECONDS)}).`,
      "WHAT SPEEDS EACH STEP:\n- Offload: the crew's Efficient Unloading and the Veteran Instincts officer bonus.\n- Reload: the crew's Rapid Loadout and the captain's Efficient Stowage talent.\n- Medical bay: the Medical crew's Reduced Crew Losses, the Rapid Recovery officer bonus, and the Medical officer's Constitution and Cunning (plus Integrity, for injuries), with a share of the XO's.\nThese are set when the ship launches. Each bonus divides the time, so every bit helps, each a little less than the last, and a cure never drops to nothing.",
      `THE MEDICAL BAY: every condition a member picked up on the trip cures on its own clock, and they all tick down at once. A member waits for their longest condition, and the team waits for its longest member. Times before any bonus:\n${CURE_LIST}\nOther battle effects, such as stuns and fear, end with the fight. Each team's bay card shows who is waiting on what.`,
      `STONESKIN: Ossir crew members have Stoneskin. Their injuries take ${pct(STONESKIN_INJURY_MULT - 1)} longer to mend in the bay.`,
    ].join("\n\n"),
  },
  {
    // 0.14.0 Squads (SQ-7 section 7.5, "Task difficulty", named for objectives). Weights from riskFactors.ts.
    id: "objectiveDifficulty",
    title: "Objective Difficulty",
    body: [
      `Every objective on a risk-rated system carries a difficulty rating, shown on its card as pips and a name. The five grades, and how much each counts toward the system's completion: ${DIFFICULTY_LIST}. The card says how much its objective counts ("counts x${DIFFICULTY_WEIGHTS[DEADLY - 1]} toward completion" on a ${DIFFICULTY_NAMES[DEADLY - 1]} one).`,
      "WHAT SETS IT: the number of fight points, the world's hazard, every squad the objective needs beyond the first, and the body's Combat risk.",
      `THE GREATER THE RISK, THE GREATER THE REWARD: a harder objective's haul is multiplied up: about +${pct(riskRewardBonus(2))} at ${DIFFICULTY_NAMES[1]}, up to about +${pct(riskRewardBonus(DEADLY))} at ${DIFFICULTY_NAMES[DEADLY - 1]}, on a curve that keeps rising but more slowly. The same amount is added to its relic find bonus.`,
      `NEEDS: the card's requirement chips show the squads an objective needs, marked met or unmet by your deployed teams. Up to ${tier(SAFE_NEEDS_MAX_TIER)}, no objective asks for more than one squad of each type, so your teams can always take it. From ${tier(FIRST_SKIPPING_TIER)} on, an objective can need two, and one your deployed squads cannot cover is left unfinished (the Subspace Telescope can warn you before launch).`,
      `${REINFORCING_REQUIRED} combat objectives always carry the Reinforcing affix. While an objective is on alert its rating rises, and at ${IMPOSSIBLE_DIFFICULTY_NAME} it is held until the alert wears off (see the Reinforcing (affix) topic).`,
    ].join("\n\n"),
  },
  {
    // 0.14.0 objective affixes (docs/plans/2026-10-14-objective-affixes-capture.md). Player-facing text says
    // "objective", never "task" (user 2026-10-14). No rank tables or chances in the prose (they are tunable
    // constants in affixes.ts; the pill's tooltip prints the live numbers), per the rule at the top.
    id: "affixes",
    title: "Objective Affixes",
    body: "Affixes are traits an objective can carry during an expedition's ground operations. Each one shows as a pill on the objective's card, in the objective queues and on the progress cards, colored by its alignment with the alignment also written on it: green is Positive (it works in your favor), yellow is Neutral (it affects both sides alike), red is Negative (it works against you). Some affixes only ever roll one way; others can roll more than one alignment, but each one carries exactly one. Affixes have ranks, such as Reinforcing I, II and III: a higher rank is a stronger version, and the high ranks are rare. Some affixes are required at certain difficulty ratings (every Deadly combat objective carries Reinforcing); others roll by chance, more often on harder objectives and in farther regions, and seldom on early planets. An objective's affixes are set once its body's scan finishes and stay for the run. Hover, tap or focus a pill to read what it does. Before you launch, the Subspace Telescope's forecast marks a Deadly hardest fight with the Reinforcing pill.",
  },
  {
    id: "reinforcing",
    title: "Reinforcing (affix)",
    body:
      AFFIX_DEFS.reinforcing.help +
      " While an objective is on alert, its card shows the alert level, the Heightened Senses stacks, how many more enemies each fight fields and when the alert clears. While it is held at Impossible, the card shows a live countdown to the reset instead, and your teams carry on with their other objectives.",
  },
  {
    // 0.14.0 Squads (SQ-7 section 7.5, "Risk factors"). Grades, chances and site tiers from riskFactors.ts.
    id: "riskFactors",
    title: "Risk Factors",
    body: [
      `Every expedition system is rated on four risk factors, each graded ${orList(RISK_GRADE_NAMES)}. Farther regions roll higher grades, and known enemy territory adds a step of ${RISK_FACTOR_NAMES.combat}. Each body has its own grades: the system's, or one step lower.`,
      `- ${RISK_FACTOR_NAMES.combat}: more fight points on every objective (fewer at ${RISK_GRADE_NAMES[0]} and ${RISK_GRADE_NAMES[1]}). At ${firstRollingGrade(CLEARING_SITE_RULES.clearHostiles.permilleByGrade)} or worse it can add a ${site("clearHostiles")} objective, Security work only.\n- ${RISK_FACTOR_NAMES.fauna}: more fight points at life sites (${LIFE_SITES.map(site).join(", ")}). At ${firstRollingGrade(CLEARING_SITE_RULES.secureLandingZone.permilleByGrade)} or worse it can add a ${site("secureLandingZone")} objective, also Security work only. ${planets(LIFELESS_PLANET_TYPES)} worlds hold no life.\n- ${RISK_FACTOR_NAMES.flora}: slows the fieldwork (${pct(FLORA_WORK_SLOW_PER_GRADE)} longer per grade) and puts Poison on the enemies' attacks in that body's fights. Thick growth also brings more ${site("xenoFloraBloom")} sites. It reads ${RISK_GRADE_NAMES[0]} on lifeless worlds and on ${planets(FLORALESS_PLANET_TYPES)} ones.\n- ${RISK_FACTOR_NAMES.hazard}: the body's own hazard. It slows scans and fieldwork, and a very hazardous world adds a fight point to its objectives.`,
      `AMBUSHES: an objective with no fight points can still be ambushed, more often where ${RISK_FACTOR_NAMES.combat} or ${RISK_FACTOR_NAMES.fauna} runs high (${pct(AMBUSH_CHANCE_BY_GRADE[1])} a trip at ${RISK_GRADE_NAMES[1]}, up to ${pct(AMBUSH_CHANCE_BY_GRADE[AMBUSH_CHANCE_BY_GRADE.length - 1])} at ${RISK_GRADE_NAMES[RISK_GRADE_NAMES.length - 1]}; at most ${SURVEY_AMBUSH_MAX_PER_TASK} times per objective). A crew with a Security member standing fights where it stands: a win and the work goes on, a loss counts like any other. A crew with no Security member retreats with light injuries, keeps its progress and comes back after the medical bay.`,
      `HOSTILE SITES: from ${tier(HOSTILE_SITE_RULES.enemyColony.minTier)}, a body at ${firstRollingGrade(HOSTILE_SITE_RULES.enemyColony.permilleByCombat)} ${RISK_FACTOR_NAMES.combat} or worse can hold an ${site("enemyColony")}, and from ${tier(HOSTILE_SITE_RULES.enemyFortification.minTier)} a body at ${firstRollingGrade(HOSTILE_SITE_RULES.enemyFortification.permilleByCombat)} ${RISK_FACTOR_NAMES.combat} or worse can hold an ${site("enemyFortification")}. A hostile site becomes an objective only when your deployed squads can take it on and still keep a Science squad.`,
      `HAZARD RESIST: it comes from relics in the Museum, installed ship systems, your Science squads' fieldwork, Hazard Resist on Security gear (for objective work only) and, for the scan only, the Science officer's Integrity with a share of the XO's. Every source is added together before the diminishing curve, so several sources come to slightly less than their separate readouts suggest, and a hazardous world always keeps over ${pct(1 - MUSEUM_HAZARD_RESIST_MAX)} of its hazard. Resist makes the work easier; it never makes the haul poorer.`,
    ].join("\n\n"),
  },
  {
    // 0.14.0 Squads (SQ-7 section 7.5, "Subspace Telescope"). Detail names, the lift and the lore from telescope.ts.
    id: "subspaceTelescope",
    title: "Subspace Telescope",
    body: [
      `The Subspace Telescope is a homeworld facility that surveys systems before you launch. Select a system on the expedition card (the Ops tab, under Exploration) and its Subspace Telescope block shows what the telescope reads. Upgrade it from its card under Facilities. ${TELESCOPE_LORE}`,
      `REGIONS AND RANGE: every system names its region, from ${tier(1)} (the ${REGION_TIER_NAMES[1]}) out to ${tier(7)} (the ${REGION_TIER_NAMES[7]}), and its distance from your homeworld in light-years. Farther regions roll higher risk (see the Risk Factors topic). Systems within the telescope's range are surveyed. Anything beyond it is a Blind launch: you see only its name, region and distance, and Launch asks first: "${BLIND_LAUNCH_WARNING}"`,
      `DETAIL: how much the telescope reads, the same across its whole range:\n- ${TELESCOPE_DETAIL_NAMES[1]}: which risk factors are present.\n- ${TELESCOPE_DETAIL_NAMES[2]}: each factor's grade for the system (its worst body), and whether it is known enemy territory.\n- ${TELESCOPE_DETAIL_NAMES[3]}: each body's grades, and how many objectives will need Security or Science squads.\n- ${TELESCOPE_DETAIL_NAMES[4]}: the team composition that suits the system best and why, what your current composition would leave unfinished, a button to set it, and who would move.\n- ${TELESCOPE_DETAIL_NAMES[5]}: a launch with the recommended composition, forecast: how many objectives to expect by difficulty, anything it would still leave unfinished, and the odds on the hardest fight.\nThe launching ship's own sensors, crew included, at ${TELESCOPE_SHIP_LIFT_SENSORS} or more lift the reading ${LIFT_TEXT}, never past ${TELESCOPE_DETAIL_NAMES[5]} and never beyond range. Hazard can be revealed by either the telescope or the ship's sensors; the higher reading wins.`,
      `THE RECOMMENDATION: it ranks the compositions your hull allows by how much of the system's work they cover (weighted by difficulty), then how much one team can take alone, then the balance of Security and Science, then the fewest changes from what you have. From ${tier(FIRST_SKIPPING_TIER)} on, where an objective can need more than one squad of a type, it also weighs the fight odds: when its pick reads below ${tierName(ODDS_RISKY_BELOW)}, a mix that covers as much with better odds takes its place. It is advice only; you can launch with any composition.`,
      "DISPLAY ONLY: the telescope never changes the expedition. It reads the same system the ship will find. One thing it cannot foresee: a sensor ghost read true during the scan adds a bonus discovery (see the Scan Events topic).",
    ].join("\n\n"),
  },
  {
    // 0.14.0 Ground Operations (GO-18): the ship-side scan events, boarding (GO-9) and field repair (GO-8b).
    id: "scanEvents",
    title: "Scan Events",
    body: [
      "While the ship scans a body from orbit, things happen. Nobody is on the ground for these: the ship and its officers deal with them, and each shows as a pip on that body's scan track (hover, tap or focus it to read what happened).",
      `- Debris field: the pilot's evasion steers through. A miss costs a detour of ${span(DEBRIS_DELAY_SECONDS)} and light hull damage.\n- Hostile probe: a quick ship battle, fought with the ship's installed combat gear and its officers. Tougher on hazardous worlds, softened by your Security officer's Cunning. Win: salvage. Loss: the scan pauses ${span(PROBE_REPAIR_SECONDS)} for repairs, with light hull damage.\n- Sensor ghost: the ship's sensors (the Science officer and crew included) read it. A true read finds a bonus discovery on this body; a false one costs a re-scan of ${span(GHOST_RESCAN_SECONDS)}.\n- Cloaked vessel: ${pct(GHOST_CLOAKED_CHANCE)} of sensor ghosts are a cloaked ship, a tougher fight than a probe. Good sensors let the ship strike first; poor ones let it strike you first. Win: richer salvage. Loss: a repair pause of ${span(CLOAKED_REPAIR_SECONDS)} and more hull damage.\n- Radiation storm: shields and Engineering ride it out. If they do not, the scan slows for ${span(STORM_SLOW_SECONDS)}.\n- Supply cache: a small find, no check needed.\nA better ship and crew raise every check, each step a little less than the last, but nothing is ever certain.`,
      `BOARDING: a hostile probe or cloaked vessel may try to board (${pct(BOARDING_ATTEMPT_CHANCE)} of those encounters). Boarding Defense, from the Security crew and the Ossir, decides whether the crew repels them. Repelled: nothing is lost. Not repelled: the scan pauses ${span(BOARDING_PAUSE_SECONDS)} more, and the boarders take ${pct(BOARDING_CREDIT_LOSS_SHARE)} of the credits the expedition has found so far, never from your bank.`,
      `HULL DAMAGE AND FIELD REPAIR: light hull damage adds up over the run. Once it reaches ${pct(FIELD_REPAIR_DAMAGE_SHARE)} of the hull, the ship sets down on the nearest ${planets(FIELD_REPAIR_PLANET_TYPES)} world to repair (${FIELD_REPAIR_TIME_MULT === 2 ? "twice" : `${FIELD_REPAIR_TIME_MULT} times`} the Shipyard's time), or repairs in orbit where there is none (${ORBIT_REPAIR_TIME_MULT === 3 ? "three times" : `${ORBIT_REPAIR_TIME_MULT} times`}). The repair pauses the scan, as a pickup does, while your teams keep working. Any damage left when the ship gets home goes to the Shipyard, and a damaged ship cannot launch another expedition until it is repaired.`,
      "The Subspace Telescope cannot forecast a sensor ghost's bonus discovery (see the Subspace Telescope topic).",
    ].join("\n\n"),
  },
  {
    id: "shipyard",
    title: "Shipyard",
    body: "The Shipyard, in Facilities, is where new ships are built. Found it once (it costs credits and a Fleet-Admiral level), then build hulls from your fabricated components and credits over a timed construction. When a build finishes, the new hull parks in your fleet, ready to assign to a captain from the Ships tab. This is the only way to add ships now: the old instant credit purchase is retired, so every ship comes out of the research, refine, fabricate, and build pipeline. Most hulls are buildable as soon as the Shipyard is founded, but the heavier warships (the battleship and the carrier) each stay locked until you research their hull blueprint at the Research Lab.",
  },
  {
    id: "docks",
    title: "Docks",
    body: "The Docks, in Facilities, sets how many hulls your fleet can hold: the capacity cap starts at 8 hulls, and a timed Expand Docks upgrade raises it one ship at a time. Managing the ships themselves happens on the Ships tab: open a ship to assign it to a captain, install its ship systems, or salvage it. When the docks are full and you no longer need a ship, salvaging one frees its slot immediately.",
  },
  {
    id: "shipSystems",
    title: "Ship Systems",
    body: `Every ship has four equipment slots (Cargo Bay, FTL Drive, Reactor Core, and a Spec Utility slot for the hull's specialization) and comes pre-installed with a Standard-Issue baseline in each, so a bare ship is always ready to fly. Research ship-system blueprints at the Research Lab, craft them at the Fabricator, then open the ship on the Ships tab, where its Ship Systems board lets you install them. Crafted systems are real upgrades over the baseline: each carries a quality grade (0 to 5), a rarity, and an item level that together set how much it boosts the ship. A Reactor Core is crafted with its fuel: every Reactor Core blueprint takes Deuterium Canisters (${BLUEPRINTS.balancedCoreBp.recipe.inputs.deuteriumCanister} for a Balanced Core, ${BLUEPRINTS.efficientCoreBp.recipe.inputs.deuteriumCanister} for an Efficient Core and ${BLUEPRINTS.highOutputCoreBp.recipe.inputs.deuteriumCanister} for a High-Output Core), and a core you already crafted keeps running without them. Install or uninstall in one tap and watch the ship's stats change. Uninstalling leaves that slot EMPTY and returns the piece to your spares, so nothing is ever lost and you can put it back (or install something else) whenever you like. If a baseline ever does leave your hands (you salvage it yourself, or the auto-salvage rules take one), a replacement Standard-Issue is free: the Quartermaster, in Facilities, issues one for any slot at no cost, so an empty slot is an errand rather than a dead end. The same Ship Systems board also holds a combat hull's combat slots (weapon hardpoints, a shield slot, a hull-plating slot, and, on a carrier, drone bays); see the Combat Gear topic for installing those.`,
  },
  {
    id: "combatGear",
    title: "Combat Gear",
    body: "Combat gear is the weapons, shield emitters, hull plating, and drone pods that decide how a warship fights. All four are craftable ship systems: research a blueprint at the Research Lab, fabricate it at the Fabricator, then install it onto a ship. Every ship starts with a free Standard-Issue set in each combat slot, so a hull is never unarmed even before you craft anything. You install combat gear on the ship's Ship Systems board (open the ship on the Ships tab), the same board used for the Cargo, FTL, Reactor, and Spec Utility slots. Every hull has weapon hardpoints (how many depends on the hull; purpose-built warships carry the most), one shield slot, one hull-plating slot, and, on a carrier only, drone bays for its drone pods. To install a piece, tap an empty slot, hardpoint, or bay, then tap a spare from the pool that opens; tap an installed piece to uninstall it, which leaves that slot bare and returns the piece to your spares (this is the same for every slot on the ship, combat and economy alike). Crafted gear is a real upgrade over the Standard-Issue floor: each piece carries a quality grade, a rarity, and an item level, and by the middle item levels good crafted weapons, shields, plating, and drone pods clearly outclass the baseline, raising both your survivability and your firepower.",
  },
  {
    id: "quartermaster",
    title: "Quartermaster",
    body: "The Quartermaster, in Facilities, is the fleet's supply counter. Its Requisition tab issues Standard-Issue patterns free, one row per slot that has a baseline: the four economy slots (Cargo Bay, FTL Drive, Reactor Core, Prospecting Rig) and the combat slots (a weapon, a shield emitter, hull plating, and a drone pod). Take one and it lands in your spare systems, ready to install from a ship's Ship Systems board. It costs nothing and takes no time, because the point of the counter is that an empty slot can always be filled: a ship missing a weapon, a shield emitter, or hull plating cannot launch a patrol, so a free replacement turns that from a dead end into an errand. What you get is the FLOOR and never more. An economy baseline is stat-neutral (a ship carrying one performs exactly as a bare hull does), and a combat baseline restores the hull's own starting numbers rather than adding to them, so nobody gains power by visiting: you only get back to where a new ship starts. The weapon issued here is the same workhorse gun every hull is built with, not a pick from the weapon roster. Real gains come from researching and crafting your own systems. The counter issues one spare of each pattern at a time; install it and it will issue another, and a spare already queued for salvage, or sitting in an Armory loadout, does not count against you. The Quartermaster has no level and nothing to upgrade, so there is nothing to found and nothing to buy. Its Sell tab buys stock back for credits (today Deuterium Ice and the gas canisters you hold), and buying is marked Coming Soon.",
  },
  {
    id: "storage",
    title: "Storage",
    body: "Your stock lives on the Logistics tab. Materials holds your raw ores, refined goods, components, and salvaged materials, grouped into themed sections (Ores and Metals, Volatiles, Organic Compounds, Recovered Tech, Refined, Components, and Salvaged Materials) and split by tier. Ship Equipment holds your spare ship systems, crafted combat gear such as weapons and drone pods included, with Modules and Consumables reserved for later, and Crafted Blanks holds unrolled crafts waiting to be inspected. Each item shows a fill gauge for how full its cap is. Storage has caps, so producers automatically pause when a material is full instead of wasting output, and you can raise a cap with a timed upgrade at the Warehouse, in Facilities. Your spare ship systems have their own cap, shown at the top of Ship Equipment, which you raise with a timed Systems Bay upgrade. Gear in an Armory loadout does not count against it.",
  },
  {
    id: "salvage",
    title: "Salvage",
    body: "Salvage lets you break down what you no longer need to recover part of what it cost. You can salvage a whole ship from its page on the Ships tab: its installed systems return to your spare pool first (so you never lose crafted gear), you recover a share of the materials and credits that built the hull, and the docks slot frees up right away (a ship on an active mission cannot be scrapped, and salvaging asks for confirmation). The Salvage Bay, in Facilities, is where you break down spare systems and salvaged materials: salvage a spare ship system to reclaim a share of the materials that built it (so a full systems bay never blocks you), or break down the rare Damaged Reactor Housing for a tiered roll at rarer materials, with better odds as your Fleet Admiral levels and with the Salvage Operations talent. Salvaging at the bay is a TIMED job and is never instant: choosing Salvage adds an order to the bay's queue, the order reserves its target straight away so nothing else can claim it, and the teardown then runs on a countdown that keeps going while the game is closed. The bay runs one teardown per salvage bay it has, bought on its own Upgrades tab, and anything beyond that waits in the queue (see the Order Queues topic). Salvaged materials can be queued in batches, in which case the units start one at a time as bays free up. AUTO-SALVAGE HAS ITS OWN SEPARATE BAY, the Auto-Salvage Terminal, shown under the salvage queue: orders the rules create run there instead of in your salvage bays, they never use your queue slots, and there is no limit on how many can line up. The Terminal may also borrow one of your salvage bays when it has been sitting idle for a while, which keeps bought capacity working instead of standing empty; your own orders always have priority and claim the bay back as soon as the borrowed teardown finishes. You can also choose which item qualities ask for confirmation first, on the bay's Rules tab, so a tier you are happy to scrap goes into the queue without a dialog. Salvaging a whole ship is the exception: it is not queued, and it still resolves the moment you confirm.",
  },
  {
    id: "autoSalvage",
    title: "Auto-Salvage",
    body: "Auto-salvage is an opt-in set of rules that queues spare ship systems for you, set up on the Salvage Bay's Rules tab. It is off by default, and even switched on it never destroys anything itself: it only ever ADDS ORDERS, and the teardown is the ordinary timed salvage job that order runs afterwards (see the Salvage topic). Turning the rules back off clears every order still waiting, though one already being broken down finishes. THREE RULES do the selecting and you can run any combination of them: a QUALITY rule that takes every spare at a chosen quality tier or below, a RARITY rule that takes every spare in the rarity bands you tick (one box per band rather than a threshold, so choosing one band can never sweep another), and a DUPLICATES rule that keeps the best copy of each blueprint in each slot (ranked by item level, then quality, then rarity) and takes the rest. They add together rather than compete, so a spare any one rule points at is queued, and choosing none means nothing is ever queued. SIX PROTECTIONS then have the last word, whatever a rule concluded. Five of them are unconditional: the rules will never touch a system installed on a ship, never queue something already queued or already being broken down, never take a quality tier you have set to ask you first, never take a system you have favorited (the Favorite button on a spare's tile in the Salvage Bay), and never take a system still inside its grace window. The sixth is STANDARD-ISSUE GEAR, and it is the one that answers to your own settings: the spare Standard-Issue systems your ships come with are left alone unless a rule you switched on actually reaches them, which the quality rule does at Q0 and the rarity rule does in the Standard band. Once a rule reaches them they are queued like any other spare, and they recover nothing when they are broken down. That is worth knowing before you set it, because uninstalling a system leaves that slot empty and a ship with an empty required slot cannot fly until you install something else, so clearing out the spare Standard-Issue gear can leave a ship waiting on a replacement you still have to craft. The other five protections cover a Standard-Issue system exactly as they cover a crafted one, so favoriting one keeps the rules off it for good. The confirm interlock is the one to know about first: a quality tier you have checked under Confirm before salvaging can NEVER be auto-salvaged, because the rules will not answer a confirmation on your behalf, and the shipped default asks for confirmation on every tier. So a fresh save that turns auto-salvage on will correctly do nothing until you uncheck a tier there. The GRACE WINDOW starts when a piece is crafted and starts again every time one is uninstalled, and it runs for a length you pick on the Rules tab (down to no grace at all, which keeps a warning on screen while it is selected), so a gear swap can never destroy the piece you have just taken off while you are still deciding whether to put it back. Everything the rules queue runs at the AUTO-SALVAGE TERMINAL, the automation's own bay shown under the salvage queue: it keeps its own waiting list with no limit on how many orders can line up, so it never uses your queue depth and never takes a salvage bay your own orders need. The Terminal will borrow one of your salvage bays that has been sitting idle for a while, which keeps bought capacity working instead of standing empty, and your own orders take priority and claim that bay back as soon as the borrowed teardown finishes.",
  },
  {
    id: "fuel",
    title: "Fuel",
    body: `Fuel is no longer something you mine, refine, or buy. Refueling is instant and free, so the only thing fuel decides is REACH: how far a ship can fly on one round trip, measured in lightyears (LY). Each hull has its own reach, set by its fuel capacity and engine efficiency, and an installed FTL Drive with Fuel Capacity or Fuel Efficiency stats extends it. Every mission and patrol has a round-trip distance in LY, and a ship can only be dispatched on a trip its reach covers. Mission and patrol cards show the trip distance, the dispatch windows show it next to the ship's range (installed gear included), and a trip beyond a ship's reach is flagged before you send it, with the reason. The old fuel tank, Buy Fuel and the Local Deuterium Skim run are retired, and Deuterium Ice is no longer FTL fuel: the Cometary Ice Harvest brings it in, the Refinery presses it into Deuterium Canisters for Reactor Core blueprints, and it still sells at the Quartermaster's Sell counter. The Fuel Depot, in Facilities, now extends REACH instead: every level it is upgraded adds ${Math.round(FUEL_DEPOT_REACH_PER_RUNG * 100)}% to the reach of every ship in the fleet, missions and patrols alike.`,
  },
  {
    id: "homeworld",
    title: "Homeworld",
    body: "Homeworld talents are your fleet-wide upgrades, opened with the Talents button on the Crew tab's Admiral page. They unlock and improve capabilities across the whole fleet, such as extra captain slots, deeper order queues, and better salvage odds. Your production facilities (the Refinery, Fabricator, and Research Lab) live in Facilities. As the game grows, more of your empire management will be anchored at the Homeworld.",
  },
  {
    id: "combat",
    title: "Battlespace",
    body: "Battlespace is the home of ship combat. Combat runs today as Combat Patrols, launched from the Ops tab: you send a captain and their assigned ship (any hull can patrol, though a purpose-built destroyer, battleship, or carrier is far stronger) to sweep a pirate faction's territory, fight a short series of seeded enemy waves, and return with loot and bounty. How a ship performs is driven by the combat gear you install on it, its weapons, shield emitter, hull plating, and (on a carrier) drone pods, rather than by fixed per-hull numbers, so crafting and installing better gear directly makes your ships hit harder and last longer (see the Combat Gear topic). You can open the Combat View to watch a patrol fight live, or let it resolve on its own while you are away and read the recap when you get back. Ships wear down in a fight, weapons, reactor, and drive lose durability, and a lost patrol limps home flagged damaged, to be repaired at the Shipyard before it can fight again. See the Combat Patrols and Combat View topics for the details. The reserved Battlespace (PvE) and Battlespace (PvP) tabs in Ops are the future home of a deeper, interactive turn-based battle mode.",
  },
];
