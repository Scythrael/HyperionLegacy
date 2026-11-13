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
// subspaceTelescope, scanEvents, Field Kits FKR-11's enemyRanks and fieldKits, and Gas Giant Study GG-8's gasGiants,
// galileoProbe, gasCanisters, dataStudy, ancientData and surveyLog, Short-Range Missions G1-7's shortRange, Refugee Posts E5-7's refugees, Complement CP-17's personnelRosters, and the CP-21 close-out's complement,
// officerStats, recruitment, awayMembers and implants) are welcome and
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
import { OVERTIME_CREDITS_PER_MINUTE, OVERTIME_MAX_STEPS, OVERTIME_STEP_RATE, overtimeRate } from "./game/processSpeed";

// OT-UI (0.14.0, the 2026-11-10 Overtime buttons mockup): Overtime on every running job it is offered on, every number
// from the engine (processSpeed.ts): the step, the most a job reaches, the price rule (the job's whole length x its
// tier x the step, fixed for the job), the refusals and where each strip sits.
const OT_PCT = `${Math.round(OVERTIME_STEP_RATE * 100)}%`;
const OT_MAX_RATE = `${Math.round(overtimeRate(OVERTIME_MAX_STEPS) * 100) / 100}x`;
const OVERTIME_PARAGRAPHS: readonly string[] = [
  `Overtime pays credits to finish a running job sooner. It is always optional: every job runs at its normal speed on its own. Each step you buy speeds the job by ${OT_PCT} of its normal rate, up to ${OVERTIME_MAX_STEPS} steps, so a job runs at most ${OT_MAX_RATE} its normal rate: never double, never instant. Each step saves a little less time than the one before.`,
  `WHERE: a strip sits under the progress bar of every running job it is offered on: a hull build (the Shipyard's building card), a hull repair (the damaged banner on the ship's Ship Systems board), a blueprint project and a data study (the Research Lab), and a facility upgrade (every facility's in-flight row, including the Docks, the docking bays and the Systems Bay). One tap buys the next step; the button shows its exact price, and the line under it shows the new time. It is not offered on refining, crafting, salvage, relic study, missions, patrols or expeditions. Gear repair has its own Overtime on a docked ship's gear cards (see the Gear wear topic).`,
  `THE PRICE: step k costs ${OVERTIME_CREDITS_PER_MINUTE} credits for each minute of the job's whole length, times its tier, times k, rounded up. The whole length is the job's own, set when it started (never the time left), so a step costs the same whenever you buy it. The tier is the hull being built or repaired, the blueprint being researched, or the level being built (on the Docks, docking bays and Systems Bay, which have no level, the expansion's number: the first is Tier I); a data study is always Tier I.`,
  `WHEN IT IS OFF: a strip says why it cannot buy: you are short of credits (it shows exactly how many more you need), the job is already at its fastest, or a data study is paused because auto-study is off (it is not counting down, so turn auto-study back on first). On a job's last tick the strip is hidden: a step would buy nothing.`,
  `WHAT CHANGES: only the time left. The job's size, what it delivers and its Fleet Admiral XP stay the same. Its bar measures the work done, so a step never makes the bar jump; it just fills faster, and a rate chip ("1.25x") shows beside the time while it runs faster. Overtime belongs to one running job: the next job starts at the normal rate. Every purchase is written to the System Log, and the job's completion entry on Command Home reads both times, how long it took with Overtime and its length at the normal rate.`,
];
// Safe first runs SF-6: the training runs and the curve, every number read from its owner (no typed number).
import {
  FIRST_PATROL_WAVES,
  FIRST_RUN_ENEMY_SCALE,
  FIRST_RUN_MAX_ENEMIES,
  N_FULL,
  PATROL_RULES_RAMP_FLOOR,
  RAMP_FLOOR,
  RAMP_MAX_TIER,
  RAMP_ODDS_LAG,
  TIER_ENCOUNTER_HAZARD_CEILING,
  rampOddsFraction,
} from "./game/runDifficulty";
import { FULL_HOLD_FRACTION, SHIP_TYPES } from "./game/model";
import { TRAINING_RUN_CHIP } from "./trainingRunDisplay";
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
import { BLUEPRINTS, LAB_FABRICATOR_TOP_TIER } from "./game/model";
// WR-4 (OC-C1): the Fuel Depot's per-level fleet reach, read from the engine constant (no stale number).
import { FUEL_DEPOT_REACH_PER_RUNG } from "./game/model";
// Material Lines ML-7: the line names and the top quality, read from their owners (no stale list or number).
import { REFINERY_LINES } from "./ui/materialLinesDisplay";
import { MAX_MATERIAL_QUALITY } from "./game/materialQuality";

// "Structural, Heavy metals, Recovered tech, Organic and Volatiles".
const LINE_LABELS = REFINERY_LINES.map((l) => l.label);
const LINE_NAMES = LINE_LABELS.length > 1 ? `${LINE_LABELS.slice(0, -1).join(", ")} and ${LINE_LABELS[LINE_LABELS.length - 1]}` : LINE_LABELS.join("");
const TOP_Q = `Q${MAX_MATERIAL_QUALITY}`;
// E-MOD EM-10: the Power and modules topic reads the drive class multiplier, the combat floor and the module blueprints'
// first Lab tier from the engine (no typed number).
import { DRIVE_CLASS_POWER_DRAW_MULT, MODULE_BLUEPRINTS } from "./game/model";
import { POWER_SUPPLY_FLOOR_PERCENT } from "./game/combat/power";
import { PRECURSOR_LENS_NUMBERS } from "./game/shipModules";
// Field Kits FKR-11: the Field Kits and Enemy Ranks topics read every number, name and list from the engine (the kit
// catalog, the grenade varieties, the condition rows, the inflictors, the rank table and its placement) and every
// control name from the screen's own display module, so a retune or a relabel cannot make the manual lie.
import { EARLIER_FIGHT_LEAD, ENEMY_RANKS, ENEMY_RANK_IDS, FINAL_FIGHT_LEAD, type EnemyRank } from "./game/enemyRanks";
import {
  BASIC_DEBUFFS as KIT_BASIC_DEBUFFS,
  CODEBREAKER_DEVICE_BONUS,
  CONDITION_LINES,
  FIELD_DEVICE_MIN_PERCENT,
  FIELD_DEVICE_SPAN_PERCENT,
  FIELD_KITS,
  FIELD_KIT_IDS,
  FREE_BASIC_FIRST_AID_PER_MEMBER,
  KIT_CATEGORY_RULES,
  LURE_SALVAGE_PER_DIAL,
  SABOTEUR_GRENADE_BONUS,
  SPLINT_HEAL_ROUNDS,
} from "./game/fieldKits";
import { GRENADES, GRENADE_IDS } from "./game/fieldKitsGrenades";
import { defaultMemberPack } from "./game/fieldKitsRun";
import {
  BLEED_ON_HIT_PERMILLE,
  FEAR_ON_HIT_PERMILLE,
  FLASH_GRENADES_PER_STRIKER,
  HEAVY_HIT_FRACTION,
  NEUROTOXIN_FROM_GRADE,
} from "./game/fieldKitsConditions";
import {
  BLINDNESS_MIN_ROUNDS,
  BLINDNESS_ROUND_SPAN,
  GAMBIT_STATUSES,
  NEUROTOXIN_TURN_LOSS,
  STONESKIN_BATTLE_RESIST,
} from "./game/gambit";
import { AWAY_TRAITS, awayTraitEffectText } from "./game/awayTraits";
// Wiring WR-10 (OC-F9): the casters' Corroded chance.
import { CASTER_CORRODE_PERMILLE, casterCorrodePermille } from "./game/groundFight";
// WR-8b: the enemy torpedoes (every number from the engine).
import { PATROL_TORPEDO_HELP, SHIP_EVENT_TORPEDO_HELP } from "./enemyTorpedoDisplay";
import { EQUIPMENT_SLOTS, GRENADE_CARRY_PER_LINE, GRENADE_FUSE_MOVED_CLEAR_CHANCE, GRENADE_THROWS_PER_BATTLE } from "./game/model";
import { ACTION_LABEL, FALL_BACK_HINT, RANK_OPTIONS, SELECTOR_LABEL, SUPPRESS_HINT, mergeAddedKindsText } from "./gambitEditorDisplay";
import { kitEffectText } from "./fieldKitsDisplay";
// Gas Giant Study GG-8: the study, probe, canister, data study, ancient data and Survey Log topics read every number,
// name and list from the engine tables and the screens' display modules.
import {
  DEUTERIUM_BURNING_MILLI_J,
  GAS_CANISTER_IDS,
  GIANT_CLASSES,
  HYDROGEN_FUSION_MILLI_J,
  ITEM_BANDS,
  NEBULA_KINDS,
  RESEARCH_DATA_ITEM,
  RESEARCH_FAMILIES,
  canistersInBand,
  giantClassDisplayName,
  nebulaKindById,
  type BandOdds,
} from "./game/gasGiantContent";
import {
  FAMOUS_NEBULA_KIND,
  GALILEO_VARIETY,
  NEBULA_CANISTERS_MAX,
  NEBULA_CANISTERS_MIN,
  NEBULA_PERMILLE_BY_TIER,
  NEBULA_SWEEP_SECONDS,
  STUDY_BASE_SECONDS,
  STUDY_CANISTERS_MAX,
  STUDY_CANISTERS_MIN,
  STUDY_MIN_SECONDS,
  STUDY_RESEARCH_DATA_PERMILLE,
  STUDY_SURVEY_READOUT_PERMILLE,
  ancientFragmentPermille,
} from "./game/gasGiantStudy";
import { DATA_STUDY_LANES, DATA_STUDY_RECIPE_PERMILLE, DATA_STUDY_TICKS, researchBoostSpeed } from "./game/dataStudy";
import { GG7_NUMBERS, SPECIAL_BLUEPRINT_KEYS, SPECIAL_BLUEPRINT_TIER, type SpecialBlueprintKey } from "./game/specialBlueprints";
import { TIER_HAUL_MULT } from "./game/riskFactors";
import { DRIVE_CLASS_BLUEPRINTS, ITEMS, REFINE_RECIPES } from "./game/model";
import { FAMOUS_SYSTEMS } from "./game/starCatalog";
import { NEBULA_STAGES, SURVEY_LOG_HELP, archiveSubTabs, bandName, permilleText } from "./gasGiantStudyDisplay";
import { decodeLockText } from "./dataStudyDisplay";
// Expedition Tiers G2-7 (GO-19 item 4): the Expedition Tiers topic and the telescope, risk, difficulty and fuel lines
// read every number from its owner: the regions and homeworld placement (galaxy.ts), the candidates and bodies
// (expedition.ts), drive class, reach and frontier sensors (propulsion.ts), transit (voyage.ts), the haul and the enemy
// territory step (riskFactors.ts), and the refusal texts from the console's own text function.
import { ENEMY_SECTOR_WIDTH_PERMILLE, HOMEWORLD_MAX_FROM_SOL_LY, HOMEWORLD_MIN_FROM_SOL_LY, REGION_TIERS } from "./game/galaxy";
import { EXPEDITION_CANDIDATE_COUNT, FAMOUS_SYSTEM_ONE_IN, TIER_BODY_COUNT } from "./game/expedition";
import { DRIVE_CLASS_MAX, DRIVE_CLASS_REACH_MULT, buildableDriveClassMax, expeditionGateText, frontierSensorsNeeded, hullBaseDriveClass } from "./game/propulsion";
import { TIER_TRANSIT_HOURS, TUTORIAL_TRANSIT_SECONDS, VOYAGE_ANOMALY_DETOUR_PERMILLE, VOYAGE_BAND_SCALE_PERMILLE, VOYAGE_FLOOR_SECONDS, tierMinimumDriveClass, tierNominalSeconds } from "./game/voyage";
import { ENEMY_TERRITORY_COMBAT_STEP } from "./game/riskFactors";
import type { ShipTypeKey } from "./game/model";

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
// E-MOD EM-10: the lowest Research Lab tier any module blueprint sits on.
const FIRST_MODULE_TIER = Math.min(...Object.values(MODULE_BLUEPRINTS).map((bp) => bp.tier));
// E-MOD EM-8: the Precursor Lens's numbers (chance at Standard quality 0, power draw).
const LENS = PRECURSOR_LENS_NUMBERS;
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
// Safe first runs SF-6: the "Training runs and rising risk" paragraph (the Risk Factors topic; the Objective
// Difficulty topic points to it). Every number is read from runDifficulty.ts, the hull names from SHIP_TYPES.
const EXPLORER_NAMES = orList(Object.values(SHIP_TYPES).filter((d) => d.spec === "explorer").map((d) => d.label));
const QUICK_DRAW_TEXT = (() => {
  const t = AWAY_TRAITS.find((x) => x.id === "quickDraw");
  const e = t?.effects.find((x) => x.kind === "firstStrike");
  return e ? awayTraitEffectText(e) : "";
})();
const runsText = (n: number): string => (n === 1 ? "one run" : `${n} runs`);
// Wiring WR-10 fix round (OC-F9, user 2026-11-10 "Scale with the ramp"): the casters' Corroded chance on the odds ramp
// (groundFight.ts casterCorrodePermille at runDifficulty.ts rampOddsFraction, what a stamped run reads), sampled at the
// first ramped run, a middle step and the top. Every number from the engine.
const corrodeAfter = (completed: number): string => pctExact(casterCorrodePermille(rampOddsFraction(completed)) / 1000);
const CORRODE_FULL_AFTER = N_FULL - 1 + RAMP_ODDS_LAG;
// Wiring WR-10 and its fix round (OC-F4 "Chance to last longer", OC-F5 "Shrug off stun/fear once", OC-F6 "Brace for the
// round"): what a few protocol actions and traits do in a fight, from the editor's own hints and the trait catalog's text.
export const SECURITY_IN_A_FIGHT_PARAGRAPH = `IN A FIGHT: each Security member acts on their own Tactical Protocols (the Ops tab, under Exploration).
- ${ACTION_LABEL.fallBack}: ${FALL_BACK_HINT}
- ${ACTION_LABEL.suppress}: ${SUPPRESS_HINT} Status chance comes from the Debuff specialty, the Saboteur trait and gear.
- Quick Draw: ${QUICK_DRAW_TEXT}.
An expedition that was already underway when these rules arrived keeps the older ones: ${ACTION_LABEL.fallBack} holds, and status chance only works with gear that inflicts a status.`;
export const CORRODE_RAMP_TEXT = `The chance climbs with your runs, as affixes and ambushes do: at ${tier(RAMP_MAX_TIER)} ${corrodeAfter(0)} on the first run after the training run, ${corrodeAfter(4)} after 4 completed runs, ${corrodeAfter(7)} after 7, and ${pctExact(CASTER_CORRODE_PERMILLE / 1000)} from ${CORRODE_FULL_AFTER} completed runs on; from ${tier(RAMP_MAX_TIER + 1)} on, ${pctExact(CASTER_CORRODE_PERMILLE / 1000)} from the first run.`;
const HAZARD_CEILING_TEXT = (Object.entries(TIER_ENCOUNTER_HAZARD_CEILING) as [string, number][])
  .map(([t, c]) => `${pct(c)} at ${tier(Number(t))}`)
  .join(" and ");
// Safe first runs SF-7 (user OC-W9 "No wear on training"): which first runs leave the gear untouched, as the engine
// does it (expedition.ts: the training run is never wear-stamped; tick.ts: the training patrol cycle and a short-range
// template's training cycle record no wear, and gearWearEngine.ts gatheringTrainingStamp spares the first gathering
// run's first delivery). helpTopics.test.ts and gatheringTrainingWearGoldens.test.ts check each clause.
export const TRAINING_WEAR_SENTENCE =
  "Your gear takes no wear on a training run, nor on the first delivery of your first gathering mission. On Repeat, a patrol's later routes and a mission's later deliveries wear as usual.";
export const TRAINING_RUNS_PARAGRAPH = [
  `TRAINING RUNS AND RISING RISK: your first expedition from an explorer (${EXPLORER_NAMES}) at ${tier(RAMP_MAX_TIER)} is a training run, marked with the "${TRAINING_RUN_CHIP}" chip. It cannot fail: every objective is finished, its guards fight at ${pct(FIRST_RUN_ENEMY_SCALE)} strength with at most ${FIRST_RUN_MAX_ENEMIES === 1 ? "one enemy" : `${FIRST_RUN_MAX_ENEMIES} enemies`} per fight, no affixes or ambushes roll, every scan event check passes, and a fight the crew loses still clears its point. Your first patrol is a training run too: at most ${FIRST_PATROL_WAVES} waves of one ship each, the route's lightest, and a wave the ship would lose breaks off with no damage. The first job of each short-range mission type is its smallest, at any tier, and gathering missions can never be lost. ${TRAINING_WEAR_SENTENCE}`,
  `After the training run the risk rises slowly with each run you complete (the training run does not count). At ${tier(RAMP_MAX_TIER)}, expedition guards start at ${pct(RAMP_FLOOR)} of full strength (ordinary enemies weaker still) and patrol enemies at ${pct(PATROL_RULES_RAMP_FLOOR)}, climbing gently to full strength after ${N_FULL - 1} completed runs; affixes and ambushes reach full strength ${runsText(RAMP_ODDS_LAG)} later. A fight treats a world's hazard as at most ${HAZARD_CEILING_TEXT}; the scan and the risk grades keep the real hazard. From ${tier(RAMP_MAX_TIER + 1)} on, every expedition is at full strength from your first one there: the tier is the step. A save that flew expeditions or patrols before training runs existed is already at full strength for that run type.`,
].join("\n");

// ===== Expedition Tiers G2-7 (GO-19 item 4): regions, drive class, reach, frontier sensors, transit and recall =====
// Every number is read from its owner (see the imports above); the refusal lines are the console's own texts.
const numeral = (n: number): string => regionTierNumeral(Math.max(1, Math.min(7, Math.floor(n))) as RegionTier);
const mult = (n: number): string => `x${n}`;
// "2 hours", "1 day", "3 days".
function hoursText(h: number): string {
  if (h < 24 || h % 24 !== 0) return h === 1 ? "1 hour" : `${h} hours`;
  return h === 24 ? "1 day" : `${h / 24} days`;
}
// "Tier I 2 hours, Tier II 4 hours, ... and Tier VII 7 days".
const TRANSIT_LIST = andList(REGION_TIERS.map((t) => `${tier(t)} ${hoursText(TIER_TRANSIT_HOURS[t])}`));
const HAUL_FIRST = REGION_TIERS[0];
const HAUL_LAST = REGION_TIERS[REGION_TIERS.length - 1];
const SENSOR_TIERS = REGION_TIERS.filter((t) => frontierSensorsNeeded(t) > 0);
const NO_SENSOR_TIERS = REGION_TIERS.filter((t) => frontierSensorsNeeded(t) <= 0);
const SECTOR_TIERS = REGION_TIERS.filter((t) => ENEMY_SECTOR_WIDTH_PERMILLE[t] > 0);
const EXPLORER_KEYS = (Object.keys(SHIP_TYPES) as ShipTypeKey[]).filter((k) => SHIP_TYPES[k].spec === "explorer");
const EXPLORER_BASE_CLASSES = [...new Set(EXPLORER_KEYS.map((k) => hullBaseDriveClass(k)))].sort((a, b) => a - b);
const BUILDABLE_CLASS = buildableDriveClassMax();
const BAND_NEAR = VOYAGE_BAND_SCALE_PERMILLE.near / 1_000;
const BAND_FAR = VOYAGE_BAND_SCALE_PERMILLE.far / 1_000;
const CLASS_REACH_LIST = andList(
  Array.from({ length: DRIVE_CLASS_MAX }, (_, i) => i + 1).map((c) => `${mult(DRIVE_CLASS_REACH_MULT[c])} at Class ${numeral(c)}`),
);
// The console's own refusal words (the text before the numbers), read from its text function.
const gateWords = (reason: "outOfReach" | "driveClassUnavailable"): string =>
  expeditionGateText({ reason, tier: 7, driveClassNeeded: DRIVE_CLASS_MAX, driveClass: 1, sensorsNeeded: 0, sensors: 0, roundTripLy: 0, reachLy: 0 });
const OUT_OF_REACH_WORDS = gateWords("outOfReach").split(":")[0];
const UNAVAILABLE_TEXT = gateWords("driveClassUnavailable").split(". ")[1]?.replace(/\.$/, "") ?? "";

// The training run's line, only while its trip IS a Tier I trip (voyage.ts TUTORIAL_TRANSIT_SECONDS is set equal to the
// Tier I nominal for now; the tutorial patch shortens it, and then the line drops instead of going false). Pure.
export function trainingRunTransitSentence(tutorialSeconds: number = TUTORIAL_TRANSIT_SECONDS, tierOneSeconds: number = tierNominalSeconds(1)): string {
  return tutorialSeconds === tierOneSeconds ? ` Your training run flies the same trip an ordinary ${tier(1)} run to its system would.` : "";
}

export const EXPEDITION_TIERS_PARAGRAPHS: readonly string[] = [
  `Expeditions fly to seven regions of the galaxy, from ${tier(1)} (the ${REGION_TIER_NAMES[1]}) out to ${tier(7)} (the ${REGION_TIER_NAMES[7]}). The expedition card (the Ops tab, under Exploration) has a tab for each region, and each region offers ${EXPEDITION_CANDIDATE_COUNT} candidate systems, nearest first, with the distance to each. The list stays the same until you launch to one of its systems; then a fresh one is drawn. Now and then a candidate is a real star (about 1 in ${FAMOUS_SYSTEM_ONE_IN}).`,
  `YOUR HOMEWORLD: every save places its homeworld at its own random spot in the ${REGION_TIER_NAMES[1]}, ${HOMEWORLD_MIN_FROM_SOL_LY} to ${HOMEWORLD_MAX_FROM_SOL_LY} light-years from Sol. Each region is a band of distances measured from it, so your distances, your telescope's range and your galaxy map differ from another player's.`,
  `DEEPER TIERS: a deeper tier rolls higher risk (see the Risk Factors topic), holds more bodies (${TIER_BODY_COUNT[HAUL_FIRST][0]} to ${TIER_BODY_COUNT[HAUL_FIRST][1]} at ${tier(HAUL_FIRST)}, ${TIER_BODY_COUNT[HAUL_LAST][0]} to ${TIER_BODY_COUNT[HAUL_LAST][1]} at ${tier(HAUL_LAST)}) and pays more: every objective's haul is multiplied by its tier, ${mult(TIER_HAUL_MULT[HAUL_FIRST])} at ${tier(HAUL_FIRST)} up to ${mult(TIER_HAUL_MULT[HAUL_LAST])} at ${tier(HAUL_LAST)}.`,
  `ENEMY TERRITORY: from ${tier(SECTOR_TIERS[0] ?? 2)} out, each region holds one fixed sector of enemy territory as seen from your homeworld, ${pct(ENEMY_SECTOR_WIDTH_PERMILLE[SECTOR_TIERS[0] ?? 2] / 1_000)} of its directions at ${tier(SECTOR_TIERS[0] ?? 2)} rising to ${pct(ENEMY_SECTOR_WIDTH_PERMILLE[HAUL_LAST] / 1_000)} at ${tier(HAUL_LAST)}. A system inside it adds ${ENEMY_TERRITORY_COMBAT_STEP === 1 ? "a step" : `${ENEMY_TERRITORY_COMBAT_STEP} steps`} of ${RISK_FACTOR_NAMES.combat}, and the Subspace Telescope's ${TELESCOPE_DETAIL_NAMES[2]} detail shows it.`,
  `WHAT A SHIP NEEDS: the region's tab shows the first gate a ship does not meet, in this order.\n- An explorer hull (${EXPLORER_NAMES}). No other hull can reach any expedition system.\n- A drive class at least the tier's number: Class ${numeral(tierMinimumDriveClass(1))} for ${tier(1)}, up to Class ${numeral(tierMinimumDriveClass(7))} for ${tier(7)}. A ship's class is its hull's own (${EXPLORER_BASE_CLASSES.length === 1 ? `Class ${numeral(EXPLORER_BASE_CLASSES[0])} for every explorer today` : `Class ${numeral(EXPLORER_BASE_CLASSES[0])} to ${numeral(EXPLORER_BASE_CLASSES[EXPLORER_BASE_CLASSES.length - 1])} for the explorers today`}) plus every class its installed FTL Drive has above Class I, at most Class ${numeral(DRIVE_CLASS_MAX)}.${BUILDABLE_CLASS < DRIVE_CLASS_MAX ? ` Today no ship can go past Class ${numeral(BUILDABLE_CLASS)}, so a deeper tier reads "${UNAVAILABLE_TEXT}".` : ""}\n- Frontier sensors to chart the region: ${andList(SENSOR_TIERS.map((t) => `${frontierSensorsNeeded(t)} at ${tier(t)}`))}, read off the ship's sensors with its crew. ${NO_SENSOR_TIERS.length > 0 ? `${andList(NO_SENSOR_TIERS.map((t) => tier(t)))} ask for none. ` : ""}A ship short of them is told the number it needs and the number it reads.\nThe Subspace Telescope never gates a launch: a system beyond its range is a Blind launch (see the Subspace Telescope topic).`,
  `REACH: each system must also be within the ship's deep-space reach. Its round trip, twice its distance from your homeworld, is measured against the ship's range (the same range missions and patrols use, installed gear included; see the Fuel topic) times its drive class's reach: ${CLASS_REACH_LIST}. On a long voyage, Engineering's Constitution stretches it further. A system out of reach reads "${OUT_OF_REACH_WORDS}" with the round trip and the ship's reach in light-years.`,
  `TRANSIT: the time each way is set by the tier, not by the light-years. At the tier's own drive class a leg takes ${TRANSIT_LIST}. Within a region, a system at the near edge of its band takes ${mult(BAND_NEAR)} of that and one at the far edge ${mult(BAND_FAR)}. Each drive class above the tier's halves the leg, and the ship's own speed shortens it further (its transit speed, ${crewBuffLabel("flight.transitOut")} crew on the way out, ${crewBuffLabel("flight.transitBack")} crew and the Flight Deck's Constitution on the way home). No leg is shorter than ${span(VOYAGE_FLOOR_SECONDS)}. A charted anomaly on the way out adds a detour of ${pct(VOYAGE_ANOMALY_DETOUR_PERMILLE / 1_000)} of the outbound leg.${trainingRunTransitSentence()}`,
  "RECALL: while a ship is on its way out or working a system, Recall brings it home after one confirm that names the time home. Before it arrives, it flies home only the share of the trip it has flown (an anomaly detour does not count). After it arrives, objectives under way stop with their progress kept, finished work comes home, the teams on the ground come up on one shared pickup, and the ship flies its full leg home. A ship already on its way home cannot be recalled.",
  "RESUME: a system recalled with at least one body charted and work still left stays open in its region's Resume list until you finish it or abandon it (one confirm). Any explorer can resume it: the trip is flown again, finished scans and studies stay done, objectives keep their progress, and a body whose scan was cut short is scanned again from the start. A system recalled before anything was charted becomes a candidate again, until the next fresh list is drawn.",
];

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
// The bay conditions a member can bring home, every row of GROUND_CONDITIONS (Field Kits FKR-11 widened it from the
// four of a run without kits: the seven Field Kits conditions arrive on a Field Kits run), under the engine's own
// labels, as the bay card shows them.
const CURE_IDS: readonly string[] = Object.keys(GROUND_CONDITIONS);
const CURE_LIST = CURE_IDS.map((id) => {
  const c = GROUND_CONDITIONS[id];
  return `- ${c.label}: ${span(c.cureSeconds)}${c.cls === "health" ? " (hit points lost in the fights)" : c.cls === "injury" ? " (an injury)" : ""}`;
}).join("\n");
const DIFFICULTY_LIST = DIFFICULTY_NAMES.map((n, i) => `${n} x${DIFFICULTY_WEIGHTS[i]}`).join(", ");
const DEADLY = DIFFICULTY_NAMES.length;
const FIRST_SKIPPING_TIER = SAFE_NEEDS_MAX_TIER + 1;
const REINFORCING_REQUIRED = DIFFICULTY_NAMES[(AFFIX_DEFS.reinforcing.requiredFromDifficulty ?? DEADLY) - 1];
const LIFT_TEXT = TELESCOPE_SHIP_LIFT === 1 ? "one level" : `${TELESCOPE_SHIP_LIFT} levels`;

// ===== Field Kits FKR-11: the Field Kits and Enemy Ranks topics (every number from its owner) =====

// "a, b and c".
function andList(items: readonly string[]): string {
  return items.length <= 1 ? items.join("") : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}
const statusLabel = (id: string): string => GAMBIT_STATUSES[id as keyof typeof GAMBIT_STATUSES]?.label ?? id;
const rankLabel = (r: EnemyRank): string => ENEMY_RANKS[r].label;
const article = (word: string): string => (/^[AEIOU]/i.test(word) ? "an" : "a");
const countWord = (n: number, one: string, many: string): string => (n === 1 ? `1 ${one}` : `${n} ${many}`);

// The kit list, each line the kit's own effect text (the dispatch pack screen and the Quartermaster rows print the same).
const KIT_LINES = FIELD_KIT_IDS.map((id) => `- ${FIELD_KITS[id].label}: ${kitEffectText(id)}`).join("\n");
const ANYONE_KITS = andList(FIELD_KIT_IDS.filter((id) => !KIT_CATEGORY_RULES[FIELD_KITS[id].category].requiresMedicalTraining).map((id) => FIELD_KITS[id].label));
const MEDIC_KITS = andList(FIELD_KIT_IDS.filter((id) => KIT_CATEGORY_RULES[FIELD_KITS[id].category].requiresMedicalTraining).map((id) => FIELD_KITS[id].label));
// N16 "1 of each usable kit": the default pack's count (the same for every kit a member can use).
const DEFAULT_PACK_EACH = Math.max(...Object.values(defaultMemberPack(true)).map((n) => n ?? 0));
// The bone line, lightest first ("Fracture, Broken Bone and Shattered Bone").
const BONE = CONDITION_LINES.bone.map((r) => r.label);
const BONE_CUTS = andList(CONDITION_LINES.bone.map((r) => `${pct(GAMBIT_STATUSES[r.id].magnitude)} at ${r.label}`));

// One grenade variety's line: its charges, its blast, its debuff and its fuse, read off its GrenadeTraits.
function grenadeLine(key: string): string {
  const g = GRENADES[key];
  const label = EQUIPMENT_SLOTS.memberTool.varieties.find((v) => v.key === key)?.label ?? key;
  const debuff = g.statusChance !== undefined ? `a ${pct(g.statusChance)} chance of ${statusLabel(g.status)}` : `${statusLabel(g.status)} at the thrower's status chance`;
  const fuse = g.fuse ? "a timed fuse" : "detonates on contact";
  return `- ${label}: ${countWord(g.charges.perObjective, "charge", "charges")}, ${pct(g.powerMult)} of the thrower's power to each foe of the target's group, ${debuff}, ${fuse}.`;
}
const GRENADE_LINES = GRENADE_IDS.map(grenadeLine).join("\n");

// Field Kits FKR-8: the field device roll and the devices' dials, read from the engine (fieldKits.ts, the varieties).
// "79.5%" (one decimal where the number has one).
function pctExact(fraction: number): string {
  return `${Number((fraction * 100).toFixed(1))}%`;
}
function deviceDial(key: string): number {
  return EQUIPMENT_SLOTS.memberTool.varieties.find((v) => v.key === key)?.member?.encounterBias ?? 0;
}
const DEVICE_MIN = FIELD_DEVICE_MIN_PERCENT / 100;
const DEVICE_MAX = (FIELD_DEVICE_MIN_PERCENT + FIELD_DEVICE_SPAN_PERCENT - 1) / 100;
const CODEBREAKER_MULT = 1 + CODEBREAKER_DEVICE_BONUS;
const SHROUD_DIAL = -deviceDial("shroudEmitter");
const LURE_DIAL = deviceDial("lureBeacon");
export const FIELD_DEVICES_PARAGRAPH = `FIELD DEVICES: the Shroud Emitter and the Lure Beacon are tools with no charges, and they work on the ground. Each time one acts, its strength is rolled fresh, from ${pctExact(DEVICE_MIN)} to ${pctExact(DEVICE_MAX)} (${pctExact(DEVICE_MIN * CODEBREAKER_MULT)} to ${pctExact(DEVICE_MAX * CODEBREAKER_MULT)} with a Codebreaker anywhere on the expedition). A Shroud Emitter makes an ambush on a quiet objective, and reinforcements on a Reinforcing one, less likely: ${pct(SHROUD_DIAL)} less at full strength, so ${pctExact(SHROUD_DIAL * DEVICE_MIN)} to ${pctExact(SHROUD_DIAL * DEVICE_MAX)} less each roll. A Lure Beacon makes them ${pctExact(LURE_DIAL * DEVICE_MIN)} to ${pctExact(LURE_DIAL * DEVICE_MAX)} more likely, and every ship battle won while the ship scans pays ${pctExact(LURE_DIAL * LURE_SALVAGE_PER_DIAL * DEVICE_MIN)} to ${pctExact(LURE_DIAL * LURE_SALVAGE_PER_DIAL * DEVICE_MAX)} more salvage. On the ground every device worn by the crew on that objective counts. Each extra device adds less than the one before, so a stack of Shroud Emitters never takes a chance all the way to zero, and a stack of Lure Beacons keeps raising the salvage, more slowly. A member downed on an objective stops counting until the team is healed in the medical bay. The salvage counts every Lure Beacon on the expedition. An expedition that was already underway when field devices moved to the ground keeps them on the scan events at full strength instead: scan events happen less often with a Shroud Emitter and more often with a Lure Beacon.`;
const TIMED_GRENADES = andList(GRENADE_IDS.filter((k) => GRENADES[k].fuse).map((k) => EQUIPMENT_SLOTS.memberTool.varieties.find((v) => v.key === k)?.label ?? k));

// The grades whose final (or earlier) fights a rank leads: "Challenging and Dangerous objectives end with an Elite".
function gradesLedBy(table: readonly (EnemyRank | null)[], rank: EnemyRank): string[] {
  return table.flatMap((r, i) => (r === rank ? [DIFFICULTY_NAMES[i]] : []));
}
const LEADS_FINAL = ENEMY_RANK_IDS.filter((r) => FINAL_FIGHT_LEAD.includes(r))
  .map((r) => `${andList(gradesLedBy(FINAL_FIGHT_LEAD, r))} objectives end with ${article(rankLabel(r))} ${rankLabel(r)}`)
  .join(", and ");
const LEADS_EARLIER = ENEMY_RANK_IDS.filter((r) => EARLIER_FIGHT_LEAD.includes(r))
  .map((r) => `every earlier fight point of ${andList(gradesLedBy(EARLIER_FIGHT_LEAD, r))} objectives is led by ${article(rankLabel(r))} ${rankLabel(r)} enemy`)
  .join("; ");
const UNLED_GRADES = andList(DIFFICULTY_NAMES.filter((_, i) => FINAL_FIGHT_LEAD[i] === null && EARLIER_FIGHT_LEAD[i] === null));
const FIRST_LED_GRADE = DIFFICULTY_NAMES[FINAL_FIGHT_LEAD.findIndex((r) => r !== null)];
const RANK_LIST = ENEMY_RANK_IDS.map((r) => `${rankLabel(r)} x${ENEMY_RANKS[r].mult}`).join(", ");
const RANK_ELITE_OPTION = RANK_OPTIONS.find((o) => o.value === "elite")?.label ?? "";
const RANK_BOSS_OPTION = RANK_OPTIONS.find((o) => o.value === "boss")?.label ?? "";

export const ENEMY_RANKS_PARAGRAPHS: readonly string[] = [
  `Every enemy in an expedition's ground fights has a rank: ${RANK_LIST}. The multiplier scales its HP, its power and its healing.`,
  `WHERE THEY STAND: ${LEADS_FINAL}; ${LEADS_EARLIER}. The leader is the fight's strongest enemy, and the rest of the fight is ordinary. ${UNLED_GRADES} objectives, ambushes and Reinforcing reinforcements have no leader. The hardest fight is usually the last one, so plan your grenades and kits for it.`,
  `TRAINING RUNS: a training run fields no ${rankLabel("elite")} and no ${rankLabel("boss")}; every enemy there is ${rankLabel("normal")}. On the runs after it at ${tier(RAMP_MAX_TIER)}, ordinary enemies start out ${rankLabel("weak")} and grow to ${rankLabel("normal")} with the difficulty curve (see the Risk Factors topic).`,
  `ON SCREEN: on an expedition with field kits, the expedition card and each team's supplies table show the current objective's final fight when ${article(rankLabel("elite"))} ${rankLabel("elite")} or ${article(rankLabel("boss"))} ${rankLabel("boss")} leads it ("Final fight: ${rankLabel("elite")}"), and the enemy too once that fight is met ("Final fight: ${rankLabel("elite")} Bruiser"). Tactical Protocol rules can single out ranks: "${RANK_ELITE_OPTION}" and "${RANK_BOSS_OPTION}" (see the Field Kits topic).`,
];

export const FIELD_KITS_PARAGRAPHS: readonly string[] = [
  "Field kits are the supplies your Security members carry into an expedition's ground fights. Research the kits at the Research Lab (its Field Kits section), craft them at the Fabricator (its Field Kits group) or buy them on the Quartermaster's Purchase tab; your stock shows in Logistics, under Ship Equipment. Grenades are not kits: they are tools installed in a member's Tool slot, with charges (below). Science squads never fight, so they carry nothing. Every expedition launched now carries field kits; one that was already underway when they arrived finishes under its old rules.",
  `THE KITS:\n${KIT_LINES}\n${ANYONE_KITS} work for anyone: at ${pct(KIT_CATEGORY_RULES.firstAid.untrained)} strength without Medical Training (they take only part of a condition's rounds off, heal less and inspire for less long) and ${pct(KIT_CATEGORY_RULES.firstAid.trained)} with it. ${statusLabel("inspired")} deals ${pct(GAMBIT_STATUSES.inspired.magnitude)} more damage. ${MEDIC_KITS} need a member with Medical Training. A kit's quality never changes what it does.`,
  `PACKS: every Security member packs their own kits. The expedition dispatch shows each member's pack, filled by default with ${DEFAULT_PACK_EACH === 1 ? "one" : DEFAULT_PACK_EACH} of each kit they can use; change it with the steppers, or let a member's Squad Loadout carry a pack. A kit a member cannot use is never packed. Packed kits leave the Warehouse at launch, lowest quality first. Unused kits come home when you claim the expedition, even past the Warehouse cap; spent ones do not.`,
  `THE FREE SET: on top of the pack, each Security member lands on every objective with a free set: ${countWord(FREE_BASIC_FIRST_AID_PER_MEMBER, "First Aid Kit", "First Aid Kits")}, and more the larger the ship's Medical and Operations crew (each extra kit takes more crew than the last, with no cap; set at launch). It refills every time the crew lands, at every objective and on every trip, and it never comes home. A member uses the free set first, then their packed kits.`,
  'TOP UP: each team has a "Top up from the Quartermaster at launch" switch at dispatch, off by default and remembered for that team. Switched on, the launch buys only what the team\'s packs are still short after the Warehouse, at the Quartermaster\'s prices, as far as your credits go; the dispatch shows what it would buy and the cost. A launch never waits on it.',
  `GRENADES AND CHARGES: a grenade in a Security member's Tool slot is thrown by a ${ACTION_LABEL.throwGrenade} tactical protocol rule, and each throw spends a charge. A member throws at most ${countWord(GRENADE_THROWS_PER_BATTLE, "grenade", "grenades")} per battle, and the charges reset to full every time the crew lands, at every objective and on every trip. Each Carry Capacity line rolled on a grenade adds ${countWord(GRENADE_CARRY_PER_LINE, "charge", "charges")}.\n${GRENADE_LINES}\nA timed fuse (the ${TIMED_GRENADES}) goes off at the start of the thrower's next turn: each foe of a group may move clear first (${pct(GRENADE_FUSE_MOVED_CLEAR_CHANCE)}), but a foe standing alone never does, and a grenade still waiting when the fight ends gives its charge back. A Saboteur's own throws get +${pct(SABOTEUR_GRENADE_BONUS)} on their blast and their debuff chance. The other tools have no charges (field devices: below). A member on the default protocols throws at the largest group and keeps one charge for an ${rankLabel("elite")} or a ${rankLabel("boss")}.`,
  FIELD_DEVICES_PARAGRAPH,
  `CONDITIONS: the enemies fight dirty:\n- Bruisers: a heavy hit (${pct(HEAVY_HIT_FRACTION)} or more of a member's max HP) causes a bone hit and ${article(statusLabel("concussion"))} ${statusLabel("concussion")}.\n- Strikers: a landed hit may cause ${statusLabel("bleed")} (${pct(BLEED_ON_HIT_PERMILLE / 1000)}), a finishing blow on a badly wounded member can cause ${statusLabel("hemorrhage")}, and each throws ${countWord(FLASH_GRENADES_PER_STRIKER, "flash grenade", "flash grenades")} a fight (${statusLabel("blindness")}).\n- Casters: ${statusLabel("neurotoxin")} in place of ${statusLabel("poison")} on ${DIFFICULTY_NAMES[NEUROTOXIN_FROM_GRADE - 1]} and harder objectives, and a landed hit may leave a member ${statusLabel("corroded")} (armor down ${pct(GAMBIT_STATUSES.corroded.magnitude)} for ${countWord(GAMBIT_STATUSES.corroded.duration, "round", "rounds")}). ${CORRODE_RAMP_TEXT}\n- Swarms, and every enemy at a hostile site: a landed hit may cause ${statusLabel("fear")} (${pct(FEAR_ON_HIT_PERMILLE / 1000)}).\nA training run's enemies cause none of these.`,
  `WHAT THEY DO:\n- ${andList(BONE)}: one bone condition in three severity ranks. A bone hit starts at ${BONE[0]}, and each further one worsens it a rank. Power and accuracy drop (${BONE_CUTS}). It lasts until a kit treats it or the medical bay mends it, and only the medical bay mends a ${BONE[BONE.length - 1]}.\n- ${statusLabel("hemorrhage")}: ${GAMBIT_STATUSES.hemorrhage.magnitude} damage a round for ${GAMBIT_STATUSES.hemorrhage.duration} rounds.\n- ${statusLabel("neurotoxin")}: ${GAMBIT_STATUSES.neurotoxin.magnitude} damage a round for ${GAMBIT_STATUSES.neurotoxin.duration} rounds, and a ${pct(NEUROTOXIN_TURN_LOSS)} chance to lose each turn.\n- ${statusLabel("concussion")}: a ${pct(GAMBIT_STATUSES.concussion.magnitude)} chance to lose each turn, for ${GAMBIT_STATUSES.concussion.duration} rounds.\n- ${statusLabel("blindness")}: attacks hit at ${pct(1 - GAMBIT_STATUSES.blindness.magnitude)} of their usual chance, for ${BLINDNESS_MIN_ROUNDS} or ${BLINDNESS_MIN_ROUNDS + BLINDNESS_ROUND_SPAN - 1} rounds.\nThe free Cure of a member with Medical Training clears basic debuffs only (${andList(KIT_BASIC_DEBUFFS.map(statusLabel))}). It never touches ${andList([statusLabel("hemorrhage"), statusLabel("neurotoxin"), statusLabel("concussion"), "the bone ranks"])}: those wait for their kit, run their course, or go to the medical bay. A ${BONE[0]} splinted in the fight heals in ${SPLINT_HEAL_ROUNDS} rounds and costs no ${BONE[0]} time in the bay. Cortex Shield's ${statusLabel("stun")} resist also covers ${statusLabel("concussion")}, and Iron Will and the XO's Morale Anchor resist ${statusLabel("fear")}. Stoneskin members (the Ossir) have physical conditions (${statusLabel("bleed")}, ${statusLabel("hemorrhage")}, ${statusLabel("concussion")} and the bone ranks) land on them ${pct(STONESKIN_BATTLE_RESIST)} less often, but the ones that land last longer.`,
  `KITS IN TACTICAL PROTOCOLS: kits are never used on their own. Add a ${ACTION_LABEL.useItem} rule to a member's Away-Team Tactical Protocols (the Ops tab, under Exploration) and pick its kit, or start from the Triage preset, which has kit rules ready. A rule fires only when the member carries that kit, can use it, and the target needs it; otherwise the next rule acts. "${SELECTOR_LABEL.allyDowned}" is the ${FIELD_KITS.injuryKit.label}'s target, and a ${ACTION_LABEL.useItem} rule with no kit picked uses a ${FIELD_KITS.firstAidKit.label}. A ${ACTION_LABEL.throwGrenade} rule skips when no charge is left or this battle's throw is spent.`,
  `SAVING FOR THE BOSS: a rule that targets a foe can ask for "${RANK_ELITE_OPTION}" or "${RANK_BOSS_OPTION}" (see the Enemy Ranks topic). A ${ACTION_LABEL.throwGrenade} or ${ACTION_LABEL.useItem} rule can also "Keep for a Boss" a number: it fires only while the member holds more than that many (charges, or of that kit), except against a ${rankLabel("boss")}, or, for a kit, while a ${rankLabel("boss")} is in the fight. The odds chips count each team's packs and charges, so packing better shows better odds.`,
];

// ===== Gas Giant Study GG-8: the gas giant, probe, canister, data study, ancient data and Survey Log topics =====
// Every number, name and list below is read from the engine table or the screen's display module that owns it, so a
// retune or a relabel cannot make the manual lie (helpTopics.test.ts pins each one against its owner).

// "30 minutes", "2 hours", "1 minute".
function longSpan(seconds: number): string {
  if (seconds % 3600 === 0) return seconds === 3600 ? "1 hour" : `${seconds / 3600} hours`;
  return span(seconds);
}
const GAS_GIANT = getPlanetTypeById("gasGiant")?.label ?? "Gas Giant";
const GALILEO = EQUIPMENT_SLOTS.memberTool.varieties.find((v) => v.key === GALILEO_VARIETY)?.label ?? GALILEO_VARIETY;
const bpName = (key: string): string => (BLUEPRINTS[key]?.label ?? key).replace(/ Blueprint$/, "");
const itemName = (id: string): string => ITEMS[id]?.label ?? id;
const labTier = (t: number): string => `Lab tier ${regionTierNumeral(t as RegionTier)}`;
// "x1 at Tier I up to x3.3 at Tier VII" (the region haul every study and sweep is multiplied by).
const HAUL_TIERS = Object.keys(TIER_HAUL_MULT).map(Number).sort((a, b) => a - b);
const HAUL_TEXT = `x${TIER_HAUL_MULT[HAUL_TIERS[0] as RegionTier]} at ${tier(HAUL_TIERS[0])} up to x${TIER_HAUL_MULT[HAUL_TIERS[HAUL_TIERS.length - 1] as RegionTier]} at ${tier(HAUL_TIERS[HAUL_TIERS.length - 1])}`;
// "66% Standard, 26% Augmented, 6% Stellar, 2% Radiant" (bands with no chance left out).
const oddsText = (odds: BandOdds): string =>
  ITEM_BANDS.filter((b) => odds[b] > 0)
    .map((b) => `${odds[b]}% ${bandName(b)}`)
    .join(", ");
export const GIANT_CLASS_ODDS_LINES = GIANT_CLASSES.map((c) => `- ${giantClassDisplayName(c)}: ${oddsText(c.bandOdds)}.`).join("\n");
export const NEBULA_KIND_ODDS_LINES = NEBULA_KINDS.map((k) => `- ${k.name}: ${oddsText(k.bandOdds)}.`).join("\n");
const NEBULA_NO_RADIANT = NEBULA_KINDS.every((k) => k.bandOdds.radiant === 0);
const RADIANT_CANISTER = canistersInBand("radiant").map(itemName);
const NEBULA_TIERS = Object.keys(NEBULA_PERMILLE_BY_TIER).map(Number).sort((a, b) => a - b);
const FAMOUS_NEBULAE = Object.keys(FAMOUS_NEBULA_KIND).map((id) => `the ${FAMOUS_SYSTEMS.find((s) => s.id === id)?.name ?? id}`);
const FAMOUS_NEBULA_KINDS = [...new Set(Object.values(FAMOUS_NEBULA_KIND))].map((k) => nebulaKindById(k)?.name.toLowerCase() ?? k);
// The Ancient Data Fragment's chance per study (gasGiantStudy.ts ancientFragmentPermille), from orbit and with the
// reference probe (relic rating 1), at a region tier.
const fragmentAt = (t: number, relicRating: number): string =>
  permilleText(ancientFragmentPermille({ region: { tier: t as RegionTier } } as unknown as Parameters<typeof ancientFragmentPermille>[0], relicRating));
const FIRST_TIER = HAUL_TIERS[0];
const LAST_TIER = HAUL_TIERS[HAUL_TIERS.length - 1];
// The research data types, by their item names ("Propulsion Data, ... and Sensors Data").
const DATA_TYPE_NAMES = andList(RESEARCH_FAMILIES.map((f) => itemName(RESEARCH_DATA_ITEM[f])));
const boostPct = (n: number): string => pct(researchBoostSpeed(n));
// Each canister's crafting uses: every blueprint whose recipe takes it, by name.
const canisterUses = (id: string): string[] =>
  Object.keys(BLUEPRINTS)
    .filter((k) => (BLUEPRINTS[k].recipe.inputs[id] ?? 0) > 0)
    .map(bpName);
export const CANISTER_LINES = GAS_CANISTER_IDS.map((id) => {
  const uses = canisterUses(id);
  const band = ITEMS[id]?.band;
  return `- ${itemName(id)} (${band ? bandName(band) : "Standard"}): sells for ${(ITEMS[id]?.sellValue ?? 0).toLocaleString("en-US")} credits${uses.length > 0 ? `; goes into the ${andList(uses)}` : ""}.`;
}).join("\n");
const DEUTERIUM_REFINE = REFINE_RECIPES.refineDeuteriumCanister;
const DEUTERIUM_ICE_PER_CANISTER = DEUTERIUM_REFINE ? Number(DEUTERIUM_REFINE.input.deuteriumIce?.toString() ?? 0) : 0;
// ML close-out (2026-11-11): the lowest FTL Drive class whose blueprint takes a Deuterium Canister (Class III today,
// G2-4's classed drives), read from the catalog, and the canister's two crafting uses as the manual words them.
export const DEUTERIUM_DRIVE_MIN_CLASS = Math.min(
  ...DRIVE_CLASS_BLUEPRINTS.filter((bp) => (bp.recipe.inputs.deuteriumCanister ?? 0) > 0).map((bp) => bp.driveClass ?? 1),
);
export const DEUTERIUM_CANISTER_USES = `Reactor Core blueprints and FTL Drive blueprints from Class ${numeral(DEUTERIUM_DRIVE_MIN_CLASS)} up`;
// ML close-out (2026-11-11): everything the Quartermaster's Sell tab buys (an item is sellable iff it carries a
// sellValue, quartermaster.ts canSell), the gas canisters named once as a group. Read from ITEMS, so it cannot drift.
export const SELL_COUNTER_TEXT = andList([
  ...Object.keys(ITEMS)
    .filter((id) => ITEMS[id].sellValue !== undefined && ITEMS[id].category !== "gasCanister")
    .map(itemName),
  "the gas canisters you hold",
]);
// The three special blueprints, each with its entry, its Lab tier and what it does (GG7_NUMBERS, the first-pass values).
const RAMSCOOP_BOOST = GG7_NUMBERS.ramscoopCollector.nebulaSweep;
const RESONANCE_LIFT = GG7_NUMBERS.resonanceSensorArray.canisterBandLift;
const specialInputs = (key: string): string => {
  const canisters = GAS_CANISTER_IDS.filter((id) => (BLUEPRINTS[key]?.recipe.inputs[id] ?? 0) > 0).map(itemName);
  return canisters.length > 0 ? ` Crafted with ${andList(canisters.map((c) => `${article(c)} ${c}`))}.` : "";
};
const SPECIAL_WHAT: Readonly<Record<SpecialBlueprintKey, string>> = {
  pressureForgedPlatingBp: "Hull Plating forged under crushing pressure, leaning into structure and kinetic dampening.",
  ramscoopCollectorBp: `A passive module that works on expeditions: in a system with a nebula, the sweep fills ${pct(RAMSCOOP_BOOST)} more canisters and finishes ${1 + RAMSCOOP_BOOST} times as fast. It draws ${GG7_NUMBERS.ramscoopCollector.powerDraw} power. A sweep never needs one.`,
  resonanceSensorArrayBp: `A sensor array: every gas giant study by a ship carrying it rolls its canisters with the Augmented and Stellar odds ${pct(RESONANCE_LIFT)} higher, the Standard odds giving way and the Radiant odds unchanged. It does not change a nebula sweep.`,
};
export const SPECIAL_BLUEPRINT_LINES = SPECIAL_BLUEPRINT_KEYS.map(
  (key) => `- ${bpName(key)}: entry ${BLUEPRINTS[key]?.requiresDecode ?? GG7_NUMBERS.decodeEntry[key]}, ${labTier(SPECIAL_BLUEPRINT_TIER[key])}. ${SPECIAL_WHAT[key]}${specialInputs(key)}`,
).join("\n");
const SURVEY_TAB = archiveSubTabs(true).find((t) => t.key === "surveyLog")?.label ?? "Survey Log";
const ARCHIVE_TABS = andList(archiveSubTabs(true).filter((t) => t.key !== "surveyLog").map((t) => t.label));

export const GAS_GIANT_PARAGRAPHS: readonly string[] = [
  `A ${GAS_GIANT} has no surface to land on, so your teams never go down to one. On an expedition, a ${GAS_GIANT} has no ground objectives, no hostile sites, no clearing objectives and no supply caches. The ship studies it from orbit instead: once it finishes scanning the giant, it holds orbit and studies it. A study needs no squad. The ship always does it, and your Science crew and a ${GALILEO} make it faster and richer (see the ${GALILEO} topic). An expedition that was already underway when gas giant studies arrived finishes under its old rules.`,
  `THE STUDY: a study takes ${longSpan(STUDY_BASE_SECONDS)} with no Science member aboard. The deployed Science squads' fieldwork pace on a ${GAS_GIANT} divides that time (a ${GALILEO}'s fieldwork line included, and each member's own fieldwork counts a little more at a higher rank), never below ${span(STUDY_MIN_SECONDS)}. While the ship studies, its scan of the next body waits, but your teams keep working the other bodies. The expedition heads home only after every study is done.`,
  `PICKUPS: when a team is ready to come back aboard while the ship is studying, the ship pauses the study, flies to pick the team up, then goes back and carries on where it left off, with the study's progress kept. It does this only when it brings the team aboard sooner than waiting, so a team ready near the end of a study just waits for it. A team whose Security members are all down is always fetched right away. A pause never changes what the study brings home.`,
  `WHAT A STUDY BRINGS HOME:\n- Gas Storage Canisters, always: ${STUDY_CANISTERS_MIN} to ${STUDY_CANISTERS_MAX}, more when a ${GALILEO} dives, times the region's haul (${HAUL_TEXT}). Each canister rolls its band by the giant's class, then its gas (see the Gas Storage Canisters topic).\n- Research data, ${permilleText(STUDY_RESEARCH_DATA_PERMILLE)} of the time: one item of a random research family (see the Research Data and Data Study topic).\n- A Survey Log readout, ${permilleText(STUDY_SURVEY_READOUT_PERMILLE)} of the time (see the Survey Log topic).\n- Now and then, an Ancient Data Fragment (see the Ancient Data and Special Blueprints topic).\nEverything comes home when you claim the expedition. The expedition card shows the canister range each study can return.`,
  `GIANT CLASSES: every gas giant is one of ${GIANT_CLASSES.length} classes, named by real science (the Sudarsky classes, sorted by their clouds, plus ice giants and brown dwarfs), and it has its own mass. A system's inner worlds lean to the hot classes and its outer worlds to the cold ones, though any class can turn up anywhere. The class sets the odds of each canister's band:\n${GIANT_CLASS_ODDS_LINES}\nA heavier, denser giant lets a probe dive deeper, for more canisters.`,
  `NEBULAE: some systems sit inside a nebula, ${permilleText(NEBULA_PERMILLE_BY_TIER[NEBULA_TIERS[0] as RegionTier])} of systems at ${tier(NEBULA_TIERS[0])}, rising to ${permilleText(NEBULA_PERMILLE_BY_TIER[NEBULA_TIERS[NEBULA_TIERS.length - 1] as RegionTier])} at ${tier(NEBULA_TIERS[NEBULA_TIERS.length - 1])}, and ${andList(FAMOUS_NEBULAE)} always hold ${article(FAMOUS_NEBULA_KINDS[0] ?? "")} ${andList(FAMOUS_NEBULA_KINDS)}. A nebula is one of ${NEBULA_KINDS.length} kinds: ${andList(NEBULA_KINDS.map((k) => k.name))}. Once the ship has scanned the last body (and finished any study under way), it sweeps the nebula: the sweep takes ${longSpan(NEBULA_SWEEP_SECONDS)}, needs no squad and no probe, and fills ${NEBULA_CANISTERS_MIN} to ${NEBULA_CANISTERS_MAX} canisters times the region's haul. It also brings research data ${permilleText(STUDY_RESEARCH_DATA_PERMILLE)} and a Survey Log readout ${permilleText(STUDY_SURVEY_READOUT_PERMILLE)} of the time, but never an Ancient Data Fragment${NEBULA_NO_RADIANT && RADIANT_CANISTER.length > 0 ? ` and never ${article(RADIANT_CANISTER[0])} ${andList(RADIANT_CANISTER)}: a nebula has no magnetic field to trap antimatter` : ""}. A Ramscoop Collector makes the sweep bigger and faster (see the Ancient Data and Special Blueprints topic). Pickups pause the sweep the same way they pause a study. The kind sets the odds of each canister's band:\n${NEBULA_KIND_ODDS_LINES}`,
  "BEFORE LAUNCH AND AFTER A RECALL: the expedition card's launch preview counts the ship studies and the nebula sweep a system holds, and none of them asks for a squad. A recalled expedition keeps what it finished: a giant studied on the first trip stays studied, and a study or sweep left unfinished is done when you resume the system.",
];

export const GALILEO_PARAGRAPHS: readonly string[] = [
  `The ${GALILEO} is a Science squad member's tool, built to dive into a gas giant and survive the crushing pressure and the corrosive gases on the way down. Research its blueprint at the Research Lab (a ${labTier(BLUEPRINTS.atmoProbeBp.tier)} blueprint), craft it at the Fabricator, then install it in a Science member's Tool slot on the ship's Away Team tab. It works on ${GAS_GIANT} studies only. Each of its three lines does one job there:\n- Fieldwork: speeds the study, like every Science member's fieldwork.\n- Hazard resist: its crush rating, how deep it dives. A deeper dive fills more canisters, more so on a heavier, denser giant. Each step adds a little less than the last, with no cap.\n- Relic find: the odds of an Ancient Data Fragment.`,
  `ONE PROBE PER DIVE: when several Science members carry one, the probe with the best hazard resist dives (the better relic find breaks a tie). The probe is chosen when the ship launches. Without a probe the study still runs, from orbit, and still fills its canisters. Each dive wears the probe like one step of fieldwork.`,
  `ANCIENT DATA ODDS: an Ancient Data Fragment comes home from about ${fragmentAt(FIRST_TIER, 0)} of studies at ${tier(FIRST_TIER)} with no probe, rising with the region's tier to about ${fragmentAt(LAST_TIER, 0)} at ${tier(LAST_TIER)}. A ${GALILEO} of item level 10, Standard and quality 0 lifts that to about ${fragmentAt(FIRST_TIER, 1)} at ${tier(FIRST_TIER)}, and a better probe lifts it further, each step a little less than the last.`,
];

export const GAS_CANISTER_PARAGRAPHS: readonly string[] = [
  `Gas Storage Canisters are the gases, and one antimatter cell, that your ships bring home from gas giant studies and nebula sweeps. They have their own section in Logistics, under Materials (Gas Storage Canisters), and the Warehouse cap applies to them like any material. Each canister belongs to a band, from Standard up to Radiant, and a study rolls the band of every canister it fills (see the Gas Giants and Nebulae topic):\n${CANISTER_LINES}`,
  `The ${itemName("deuteriumCanister")} goes into ${DEUTERIUM_CANISTER_USES}, and it can also be refined at the Refinery, from ${DEUTERIUM_ICE_PER_CANISTER} ${itemName("deuteriumIce")} each. Every canister sells at the Quartermaster's Sell tab.`,
];

export const DATA_STUDY_PARAGRAPHS: readonly string[] = [
  `Research data comes home from gas giant studies and nebula sweeps in ${RESEARCH_FAMILIES.length} types, one for each research family: ${DATA_TYPE_NAMES}. It has no Warehouse shelf: the Research Lab's Data study tab holds it and shows each type's count against its cap. A type at its cap says so, because more of it coming home is not kept.`,
  `THE LANE: from Research Lab level I, the Lab studies held data on its own lane (${DATA_STUDY_LANES === 1 ? "one study" : `${DATA_STUDY_LANES} studies`} at a time), apart from blueprint research and relic study, so it never holds either up. Each study takes ${longSpan(DATA_STUDY_TICKS)}. With Auto-study on (the default), the lane starts the oldest held data whenever it is idle. Switch Auto-study off to pause: nothing new starts and the running study holds its countdown. Nothing is lost, and switching it back on carries on where it was.`,
  `BANKED BOOSTS: each study of research data banks one boost for its family. The next research project of that family you start spends every boost banked for it and runs faster: one boost +${boostPct(1)}, two about +${boostPct(2)}, four about +${boostPct(4)}, each extra boost adding a little less, with no cap. The Data study tab lists the boosts banked for each family.`,
  `A RECIPE NOW AND THEN: each study of research data also has a ${permilleText(DATA_STUDY_RECIPE_PERMILLE)} chance to teach a recipe: one blueprint of its family, at or below the Lab's tier, that you have not researched and that is not waiting on a relic or an ancient entry, is researched at once. When none is left, nothing is learned.`,
  "FAMILIES: every blueprint belongs to one family. FTL drives and the other drive parts are Propulsion; shield emitters and hull plating are Defense; weapons and drone pods are Weapons; Reactor Cores, utility rigs and modules are Systems; hull blueprints, cargo bays, Bridge Modules and Crew Quarters are Hull Design; sensor arrays, the Survey Rig and the Pathfinder Suite are Sensors; squad gear and field kits are Field; materials are Materials.",
  "An Ancient Data Fragment is studied on the same lane (see the Ancient Data and Special Blueprints topic).",
];

export const ANCIENT_DATA_PARAGRAPHS: readonly string[] = [
  `An Ancient Data Fragment is a record left by an ancient culture. Only a ship's study of a gas giant finds one, never a nebula sweep, and the odds rise with the region's tier and with a ${GALILEO}'s relic find line (see the ${GALILEO} topic). It is studied on the Research Lab's data study lane like research data. Each study decodes the next entry of the fragment's own culture, the culture of the world it came from. The Data study tab shows how many entries the furthest culture has decoded. The cultures have no names yet.`,
  `SPECIAL BLUEPRINTS: three blueprints open only once one culture has decoded enough entries, and each also needs its Research Lab tier:\n${SPECIAL_BLUEPRINT_LINES}\nThe numbers are at Standard and quality 0; a better rarity and quality raise them, and wear lowers them.`,
  `The entries count for ONE culture: the blueprint marked entry N opens once a single culture has decoded N entries, and entries spread across several cultures do not add up. The Data study tab shows each special blueprint's card with the entry it waits on, and the Research list reads "${decodeLockText(2)}" (or the number it needs) until then.`,
  `The ${bpName("eliteQuartersBp")} blueprint (${labTier(BLUEPRINTS.eliteQuartersBp.tier)}) also takes canisters, but it needs no ancient entry.`,
];

export const SURVEY_LOG_PARAGRAPHS: readonly string[] = [
  `The ${SURVEY_TAB} is a tab of the Archive, beside the ${ARCHIVE_TABS} tabs. ${SURVEY_LOG_HELP} An entry is added when you claim the expedition that brought it home. One place in the galaxy also leaves an entry of its own, once, when you claim the first expedition that reached it; it is listed after the nebulae.`,
  "THE LIST: entries are grouped by class (gas giants by class, then nebulae by kind), each group with its count and its newest entry first, and the first entry of each class is marked as the first of its class. Pick an entry to open its card. On a phone, the card of the selected entry shows first and the list follows it.",
  `A GAS GIANT'S CARD: its mass, radius, density, cloud-top gravity, main gases and a feature, and a bar showing how close it came to becoming a star: its mass against the deuterium-burning line (${DEUTERIUM_BURNING_MILLI_J / 1000} Jupiter masses, where a brown dwarf begins) and the hydrogen-fusion line (about ${HYDROGEN_FUSION_MILLI_J / 1000} Jupiter masses, a true star).`,
  `A NEBULA'S CARD: its main gases, a feature, a real example, and where it sits in the life cycle of stars (${andList([...NEBULA_STAGES])}).`,
  "The Survey Log is a record: it changes nothing in play.",
];

// ===== Short-Range Missions (0.14.0 G1-7, docs/plans/2026-10-17-short-range-missions-plan.md) =====
// The board, the sheets, the jobs, a cycle, Repeat and Recall, the waits, the training run and the slow start, and every
// bonus that acts on a short-range run (the registry's mission:shortRange sweep, wiring/registry.ts, and WR-9's Pilot
// Cunning). Every number, name and label is read from its owner, never typed.
import {
  SHORT_RANGE_CREW_RATING,
  SHORT_RANGE_SHEETS,
  SHORT_RANGE_TEMPLATES,
  SHORT_RANGE_TEMPLATE_KEYS,
  SHORT_RANGE_WORK,
  shortRangeTemplateUses,
  type ShortRangeTier,
} from "./game/shortRange";
import { SHORT_RANGE_BASE_SLOT_TIERS } from "./game/shortRangeBoard";
import { SHORT_RANGE_CATEGORY_VIEW, SHORT_RANGE_TRAINING_NOTE, shortRangeTierNumeral } from "./shortRangeBoardDisplay";
import { GENERAL_QUARTERS_GUEST_PERK, HULL_GUEST_QUARTERS, MISSIONS, MISSION_CONTROL_BOARD_RUNGS, SECONDARY_CAPTAIN_TALENTS, type ShipSpec } from "./game/model";
// Complement CP-13: the hull-family module bonus catalog (the Hull bonuses Help topic reads every number from it).
import { BRIDGE_MODULES, HULL_FAMILY_MODULE_BONUS, HULL_ROLE_SEATS, type HullFamilyBridgeStat } from "./game/crewModules";
// Complement CP-14: the Sensors topic reads the Science lifts and the officer rank factors from the engine.
import { SCIENCE_SEAT_SENSOR_LIFT, scienceCrewSensorLift } from "./game/crewOverlay";
import { OFFICER_RANK_ORDER, officerRankLabel, officerRankMagnitudeFactor } from "./game/seniorStaff";
import { LY_PER_TICK } from "./game/fuel";
import { DEPARTMENT_LABEL, PILOT_CUNNING_RETURN_CUT_TICKS } from "./game/officerStats";
import { crewBuffLabel } from "./game/crewBuffs";
import { SENIOR_STAFF_BONUSES } from "./game/seniorStaffBonuses";
import { EXPEDITION_RELIC_BLANKS_PER_HOUR, SHORT_RANGE_RELIC_RATE_MULT } from "./game/relicBlanks";
// Whole numbers with thousands separators ("2,500"), never the abbreviated "2.50K".
const formatWhole = (n: number): string => Math.round(n).toLocaleString("en-US");

const SR_TIERS = Object.keys(SHORT_RANGE_SHEETS).map(Number) as ShortRangeTier[];
const srTier = (t: ShortRangeTier): string => `Tier ${shortRangeTierNumeral(t)}`;
const NUMBER_WORDS = ["no", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"];
const countWords = (n: number): string => NUMBER_WORDS[n] ?? String(n);
const officerLabel = (id: string): string => SENIOR_STAFF_BONUSES.find((b) => b.id === id)?.label ?? id;
const talentLabel = (k: keyof typeof SECONDARY_CAPTAIN_TALENTS): string => SECONDARY_CAPTAIN_TALENTS[k].label;
const itemLabel = (id: string): string => ITEMS[id]?.label ?? id;
const GUEST_WING = EQUIPMENT_SLOTS.quarters.varieties.find((v) => v.key === "quartersGuestWing")?.label ?? "Guest Wing";
const QUARTERS_SLOT = EQUIPMENT_SLOTS.quarters.label;
const GENERAL_HULLS = orList(Object.values(SHIP_TYPES).filter((d) => d.spec === "general").map((d) => d.label));

// Complement CP-13 (OC-13 "One catalog, by hull"): the hull-family module bonuses, every number and name read from the
// catalog (crewModules.ts HULL_FAMILY_MODULE_BONUS) and the hull table, so a retune changes the text with it.
const HULL_FAMILY_ORDER: readonly ShipSpec[] = ["general", "prospector", "tactician", "explorer"];
const HULL_FAMILY_NAME: Readonly<Record<ShipSpec, string>> = { general: "General", prospector: "Prospector", tactician: "Tactician", explorer: "Explorer" };
const BRIDGE_LINE_NAME: Readonly<Record<HullFamilyBridgeStat, string>> = {
  transitSpeed: "FTL transit speed",
  unloadSpeed: "unload speed",
  extractionYield: "extraction yield",
  weaponDamage: "weapon damage",
  sensors: "sensors",
};
const familyHulls = (spec: ShipSpec): string => andList(Object.values(SHIP_TYPES).filter((d) => d.spec === spec).map((d) => d.label));
const familyBridgeText = (spec: ShipSpec): string =>
  andList((Object.entries(HULL_FAMILY_MODULE_BONUS[spec].bridge) as [HullFamilyBridgeStat, number][]).map(([k, v]) => `+${pctExact(v)} ${BRIDGE_LINE_NAME[k]}`));
function familyPerkText(spec: ShipSpec): string {
  const q = HULL_FAMILY_MODULE_BONUS[spec].quarters;
  switch (q.perk) {
    case "guestQuarters":
      return `guest quarters +${pctExact(q.perkSize)}`;
    case "rareFind":
      return `+${pctExact(q.perkSize)} rare finds on mining and survey hauls`;
    case "injuryRecovery":
      return `injured crew recover ${pctExact(q.perkSize)} faster in the medical bay`;
    case "bayTime":
      return `ground-team medical bay time ${pctExact(q.perkSize)} shorter`;
  }
}
const HULL_BONUS_BRIDGE_TEXT = HULL_FAMILY_ORDER.map((s) => `${HULL_FAMILY_NAME[s]} hulls (${familyHulls(s)}) ${familyBridgeText(s)}`).join("; ");
const HULL_BONUS_QUARTERS_TEXT = HULL_FAMILY_ORDER.map((s) => {
  const q = HULL_FAMILY_MODULE_BONUS[s].quarters;
  return `${HULL_FAMILY_NAME[s]}: ${andList(q.divisions.map((d) => DEPARTMENT_LABEL[d]))} crew +${pctExact(q.divisionLift)}, and ${familyPerkText(s)}`;
}).join("; ");
export const HULL_BONUS_HELP = [
  `HULL BONUSES: a Bridge Module lifts the officers seated on the ship and ${QUARTERS_SLOT} lift its complement, and each one ALSO gives a hull bonus that depends on the family of the hull it is installed on. Move a module to another ship and its bonus changes with the hull. The Ships tab shows it on the module's tile, and the Ship Systems readout lists it as Hull bonus under each stat it moves there.`,
  `Bridge Module: ${HULL_BONUS_BRIDGE_TEXT}.`,
  `${QUARTERS_SLOT}: the family's two signature divisions work better, and one perk. ${HULL_BONUS_QUARTERS_TEXT}.`,
  `These are the sizes on a Standard, quality 0 module. Rarity, quality and the module's Crew Stations and Crew Efficiency lines raise every one of them (the guest quarters perk included) exactly as they raise its own effect. Wear lowers a hull bonus only where it lowers the module's own effect: the ship stats a mission, short-range run or expedition flies on. On a patrol (its weapon damage included), in the rare-find roll, in mission output and in the medical bay, the module's own effect and its hull bonus both work at full strength whatever the module's condition.`,
  `The two medical bay perks are care: they join the ship's other medical care (such as its Medical crew and Medical officer), and the bay divides its time by all of it together, so the more care a ship already has, the less time each perk saves. The sizes above are what they do alone; the module's tile shows what they do on that ship now.`,
  `A hull bonus never adds crew berths. An expedition keeps the hull bonuses its ship had when it set out. A mission, short-range run or patrol keeps reading them as it goes; its modules stay installed while it is out, so only their wear (as above) can move them.`,
].join("\n\n");
// Complement CP-14 (OC-16, OC-20, OC-21): the Sensors topic, every number read from the engine (the hulls' base sensors,
// the Science crew curve, the Science seat by rank and Focused Command's amp).
const SENSOR_HULLS = (Object.keys(SHIP_TYPES) as (keyof typeof SHIP_TYPES)[])
  .filter((k) => (SHIP_TYPES[k].baseSensors ?? 0) > 0)
  .sort((a, b) => (SHIP_TYPES[b].baseSensors ?? 0) - (SHIP_TYPES[a].baseSensors ?? 0))
  .map((k) => `${SHIP_TYPES[k].label} ${SHIP_TYPES[k].baseSensors}`);
const SENSORLESS_HULLS = andList((Object.keys(SHIP_TYPES) as (keyof typeof SHIP_TYPES)[]).filter((k) => !((SHIP_TYPES[k].baseSensors ?? 0) > 0)).map((k) => SHIP_TYPES[k].label));
const SCIENCE_CREW_SAMPLES = andList([25, 100, 750].map((n) => `${n} Science crew +${pctExact(scienceCrewSensorLift(n))}`));
const SCIENCE_SEAT_BY_RANK = andList(OFFICER_RANK_ORDER.map((r) => `${officerRankLabel(r)} +${pctExact(SCIENCE_SEAT_SENSOR_LIFT * officerRankMagnitudeFactor(r))}`));
const FOCUSED_AMP = BRIDGE_MODULES.find((m) => m.kind === "focused")?.amp ?? 0;
const SCIENCE_ROLE_FAMILIES = andList((Object.keys(HULL_ROLE_SEATS) as ShipSpec[]).filter((s) => HULL_ROLE_SEATS[s].includes("science")).map((s) => HULL_FAMILY_NAME[s].toLowerCase()));
export const SENSORS_HELP = [
  `SENSORS: how well a ship scans. Short-range jobs ask for them and scan faster and bring more home with them, a survey mission's haul grows with them, and an expedition reads what lies ahead and scans with them. The Ship Systems readout shows a ship's Sensors and, when you tap the number, every source.`,
  `THE HULL: some hulls carry sensors of their own: ${andList(SENSOR_HULLS)}. The ${SENSORLESS_HULLS} have none, so their sensors come only from an installed Sensor Suite. On any hull, a Sensor Suite adds its points to the hull's.`,
  `SCIENCE: the ship's Science division multiplies its sensors, more with every head and never capped, each head worth a little less: ${SCIENCE_CREW_SAMPLES}. A Science officer multiplies them too, more with rank: ${SCIENCE_SEAT_BY_RANK}. A Bridge Module lifts the Science officer like any officer it lifts: Focused Command by ${pct(FOCUSED_AMP)} on ${SCIENCE_ROLE_FAMILIES} hulls, where Science is a role seat (sizes on a Standard, quality 0 module). These two lifts stand alone: the Science crew lift that Crew Quarters give, Crew Effectiveness and the museum's crew bonuses make the Science division work better at its other jobs, but they do not raise its sensor lift.`,
  `STACKING: the hull's sensors and the Sensor Suite's add up first. The Science crew, the Science officer, the museum, an officer's Inspiring Leader, a Bridge Module on an Explorer hull and a captain's Keen Sensors then each multiply that total, so they all grow together. A ship with no sensors at all stays at 0 whatever its crew.`,
  `TIMING: an expedition keeps the sensors its ship had when it set out. A survey mission or short-range run does not freeze them: it keeps reading its ship's sensors as it flies. The ship's crew and gear stay locked while it is out, but anything else that moves its sensors meanwhile (a Science officer's promotion, a museum find) is picked up as the run goes on.`,
].join("\n\n");
const HULL_GUESTS = andList(
  (Object.entries(HULL_GUEST_QUARTERS) as [keyof typeof SHIP_TYPES, number][])
    .sort((a, b) => b[1] - a[1])
    .map(([k, n]) => `${SHIP_TYPES[k].label} ${n}`),
);
// The base slots by tier ("two Tier I slots"), and each board rung's slot, level, gate and price.
const BASE_SLOTS_TEXT = andList(
  SR_TIERS.filter((t) => SHORT_RANGE_BASE_SLOT_TIERS.includes(t)).map((t) => {
    const n = SHORT_RANGE_BASE_SLOT_TIERS.filter((x) => x === t).length;
    return `${countWords(n)} ${srTier(t)} slot${n === 1 ? "" : "s"}`;
  }),
);
const RUNG_LINES = MISSION_CONTROL_BOARD_RUNGS.map((rung, i) => {
  const effect = rung.effect;
  const slotTier = "addShortRangeSlot" in effect ? effect.addShortRangeSlot : null;
  const gate = rung.requiresMissionCompletions
    ? Object.entries(rung.requiresMissionCompletions).map(([key, n]) => ({ label: MISSIONS[key as keyof typeof MISSIONS]?.label ?? key, n }))
    : [];
  const gateText = gate.length > 0 ? ` once you have completed ${andList(gate.map((g) => `${g.label}`))} ${formatWhole(gate[0].n)} times each,` : "";
  return `- Mission Control level ${i + 2} opens a ${slotTier !== null ? srTier(slotTier as ShortRangeTier) : "new"} slot. The upgrade can be built${gateText} for ${formatWhole(rung.credits?.toNumber() ?? 0)} credits.`;
}).join("\n");
// One sheet line per tier, in the board's own category names and units.
const SHEET_LINES = SR_TIERS.map((t) => {
  const s = SHORT_RANGE_SHEETS[t];
  const parts = (Object.keys(SHORT_RANGE_CATEGORY_VIEW) as (keyof typeof SHORT_RANGE_CATEGORY_VIEW)[]).map((c) => `${SHORT_RANGE_CATEGORY_VIEW[c].label} ${formatWhole(s[c])}${SHORT_RANGE_CATEGORY_VIEW[c].unit}`);
  return `- ${srTier(t)}: ${parts.join(", ")}.`;
}).join("\n");
// A span across tiers: "15 to 45 at Tier I, 30 to 65 at Tier II".
const spanText = (get: (t: ShortRangeTier) => readonly [number, number] | undefined, unit = ""): string =>
  SR_TIERS.map((t) => {
    const s = get(t);
    return s ? `${s[0] === s[1] ? `${s[0]}` : `${s[0]} to ${s[1]}`}${unit} at ${srTier(t)}` : null;
  })
    .filter((x): x is string => x !== null)
    .join(", ");
// "3 credits a unit" when every tier pays the same, else "50 at Tier I, 80 at Tier II" before the unit.
const byTier = (r: Readonly<Record<ShortRangeTier, number>>, unit: string): string =>
  new Set(SR_TIERS.map((t) => r[t])).size === 1 ? `${formatWhole(r[SR_TIERS[0]])} ${unit}` : `${SR_TIERS.map((t) => `${formatWhole(r[t])} at ${srTier(t)}`).join(", ")} ${unit}`;
const DISTANCES = new Set(SHORT_RANGE_TEMPLATE_KEYS.map((k) => SR_TIERS.map((t) => SHORT_RANGE_TEMPLATES[k].rolls[t].distanceLy.join("-")).join("/")));
const DISTANCE_TEXT = DISTANCES.size === 1 ? spanText((t) => SHORT_RANGE_TEMPLATES[SHORT_RANGE_TEMPLATE_KEYS[0]].rolls[t].distanceLy, " ly") : "set by the job";
function jobLine(key: (typeof SHORT_RANGE_TEMPLATE_KEYS)[number]): string {
  const def = SHORT_RANGE_TEMPLATES[key];
  const uses = shortRangeTemplateUses(key).map((c) => SHORT_RANGE_CATEGORY_VIEW[c].short);
  const r = def.reward;
  const rolls = (k: "guests" | "units" | "scan" | "engineering" | "security", unit = "") => spanText((t) => def.rolls[t][k], unit);
  let what: string;
  switch (r.kind) {
    case "passengers":
      what = `carries people in guest quarters (${rolls("guests", " people")})${def.rolls[SR_TIERS[0]].security ? `, needs a Security crew rating (${rolls("security")})` : ""}, and is paid by the headcount and the distance, plus captain XP${key === "evacuation" ? ", and may bring one named refugee home" : ""}`;
      break;
    case "supplyLoop":
      what = `buys supplies as it leaves (${rolls("units", " units")}, ${byTier(r.supplyCostPerUnit, "credits a unit")}) and is paid that back on delivery with a ${pct(r.margin)} margin`;
      break;
    case "pickup":
      what = `brings home ${itemLabel(r.material)} for the Warehouse (${rolls("units", " units")}), plus credits`;
      break;
    case "survey":
      what = `scans a nearby phenomenon (the scan needs Sensors of ${rolls("scan")}) for credits and ${itemLabel(r.material)}, more of it with stronger Sensors`;
      break;
    case "contract":
      what = `hauls parts (${rolls("units", " units")}), needs an Engineering crew rating (${rolls("engineering")}), and pays a flat fee (${byTier(r.credits, "credits")}) plus captain XP`;
      break;
  }
  return `- ${def.label} (uses ${andList(uses)}): ${what}.`;
}
const JOB_LINES = SHORT_RANGE_TEMPLATE_KEYS.map(jobLine).join("\n");
const relicHours = (t: ShortRangeTier): number => Math.round(1 / (EXPEDITION_RELIC_BLANKS_PER_HOUR * SHORT_RANGE_RELIC_RATE_MULT[t]));
const RELIC_TEXT = SR_TIERS.map((t) => `1 every ${relicHours(t)} hours of mission time at ${srTier(t)}`).join(" and ");
const CUT_TEXT = PILOT_CUNNING_RETURN_CUT_TICKS === 1 ? "one tick" : `${PILOT_CUNNING_RETURN_CUT_TICKS} ticks`;
const TICKS_PER_LY = 1 / LY_PER_TICK;

export const SHORT_RANGE_HELP_PARAGRAPHS: readonly string[] = [
  `Short-Range Missions are set-and-forget jobs close to home, run from the Ops tab under Short-Range. Each job is different: bring refugees to a new camp, evacuate people from a nearby world, drop off or pick up supplies, survey a phenomenon, repair a space telescope, build a comm booster, or move prisoners. A job can never fail.`,
  `THE BOARD: every save starts with ${BASE_SLOTS_TEXT}. Mission Control adds more:\n${RUNG_LINES}\nA slot is flown by one captain and their assigned ship (the captain is busy while it runs). The board shows each free slot's next job before you send it, and pre-picks the ready captain whose ship meets the sheet by the widest margin: Send dispatches them, or Choose captain opens the picker.`,
  `THE SHEET: each tier has one requirement sheet, and a ship must meet all of it, even the parts a job does not use. Every job a slot draws stays inside its sheet, so a ship that qualifies once can take any job that slot rolls.\n${SHEET_LINES}\nRange is the round trip the ship can reach. The Engineering and Security crew ratings come from the strength of the ship's Engineering crew (with its Engineering officer) and its Security crew: ${SHORT_RANGE_CREW_RATING.perDoubling} x log2(1 + strength / ${SHORT_RANGE_CREW_RATING.referenceStrength}), so each doubling of the crew adds about ${SHORT_RANGE_CREW_RATING.perDoubling}. The board's bars show your ship against the sheet, with the categories this job uses highlighted.`,
  `GUEST QUARTERS carry people: refugees and prisoners ride in them, never in the cargo hold, and goods never ride in guest quarters. Guests are not crew and take no crew stations. A ship's guest quarters come from its hull (${HULL_GUESTS}), from a ${GUEST_WING} or a guest quarters line on ${QUARTERS_SLOT}, and on a ${GENERAL_HULLS} with ${QUARTERS_SLOT} installed they rise ${pct(GENERAL_QUARTERS_GUEST_PERK)} with a Standard module, more with a better one. Ship Systems shows the line once a ship has any.`,
  `THE JOBS: every cycle the slot rolls a new job of any type, flying ${DISTANCE_TEXT} each way (Range on the sheet is the longest round trip).\n${JOB_LINES}`,
  `A CYCLE: the ship flies out (${TICKS_PER_LY} ticks a lightyear before its transit speed), does the job on site, flies home, and turns around at home, where it uses a transit berth like a mission unload. On site, passengers and goods take longer the more there are; a scan is shorter with stronger Sensors (the scan divides by 1 + Sensors / ${SHORT_RANGE_WORK.sensorsReference}) and a repair or a build is shorter with a better Engineering crew rating (1 + rating / ${SHORT_RANGE_WORK.engineeringReference}). The pay arrives when the ship is home, and the captain and your Fleet Admiral earn XP for every tick the run is underway.`,
  `REPEAT AND RECALL: Repeat until recalled is on by default, so the slot runs job after job. Turn Repeat off and the ship finishes this cycle and stops; turn it back on before then and it carries on. Recall does the same, and a run that has not left home yet ends at once and spends nothing.`,
  `WAITING AT HOME: a Supply Pickup waits while its ${itemLabel("commonOre")} is at its Warehouse cap, and a Supply Drop-off waits until the fleet has the credits for its load. Either leaves on its own once it can, and nothing is lost while it waits.`,
  `TRAINING RUNS AND THE SLOW START: ${SHORT_RANGE_TRAINING_NOTE} A job's training run is marked with the "${TRAINING_RUN_CHIP}" chip. The slow start counts the completed jobs of each type on its own; the training run does not count.`,
  `WHAT HELPS: the bonuses that speed or grow a mission work here too.\n- The ship's transit speed, ${crewBuffLabel("flight.transitOut")} crew on the leg out, and ${crewBuffLabel("flight.transitBack")} crew or the Flight Deck's Constitution on the leg home.\n- The Pilot's Cunning: each cycle, the Flight Deck's Cunning is the chance that the leg home runs ${CUT_TEXT} shorter. The chance is set when the ship is sent, so a new Pilot counts from the next dispatch.\n- ${crewBuffLabel("ops.unloadSpeed")} crew and the ${officerLabel("any.veteranInstincts")} officer bonus speed the passengers and goods on site and the turnaround at home; the Operations officer's Integrity speeds a hold at least ${pct(FULL_HOLD_FRACTION)} full.\n- ${officerLabel("xo.commandOutput")} and the ${crewBuffLabel("excl.crewOutputMult")} grow the credits and materials a job pays.\n- ${talentLabel("trade1")} and ${talentLabel("trade3")} raise a Supply Drop-off's margin, and ${talentLabel("trade2")} cuts the price of its load.\n- ${talentLabel("extraction4")} raises the quality of the ore a job brings home, and ${talentLabel("extraction5")} can double it.\n- Officers aboard earn promotion progress for their hours out, as on any mission.\nTalents that act on extracting (the Prospector tree's extraction talents, ${talentLabel("extraction2")} and ${talentLabel("extraction3")}) and rare-find bonuses do not act here: a job pays what it rolled.`,
  `REFUGEES: an evacuation can bring one named refugee home to work at your facilities, and a relocation takes one waiting refugee along to lead the new camp; see the Refugees topic.`,
  `RELICS: a short-range mission turns up an unidentified relic now and then, about ${RELIC_TEXT}, rarer than on expeditions. Finds go to your vault as the job is delivered; see the Relics and the Museum topic.`,
];

// ===== Refugee Posts (0.14.0 E5-7, docs/plans/2026-11-02-refugee-posts-e5-plan.md) =====
// Evacuations, arrivals and the taper (in words), backgrounds and matches, posts by facility level, moving and swaps,
// relocation leaders, and the guarantee that posted people stay. Every number, name and label is read from its owner
// (refugees.ts, refugeeArrival.ts, refugeeDisplay.ts, the short-range catalog), never typed, and every buff the topic
// names is a LIVE wiring registry row (facility:REFUGEE_BACKGROUNDS:<background>, helpTopics.test.ts holds it).
import {
  REFUGEE_BACKGROUNDS,
  REFUGEE_BACKGROUND_KEYS,
  REFUGEE_MATCH_SHARE_PER_SKILL,
  REFUGEE_OFF_MATCH_RATIO,
  REFUGEE_POSTS_EVERY,
  REFUGEE_SKILL_SPANS,
  refugeePostsAt,
  type RefugeeBackground,
} from "./game/refugees";
import { REFUGEE_TAPER_K } from "./game/refugeeArrival";
import { REFUGEE_FACILITY_LABELS } from "./refugeeDisplay";

// What each background's buff does at its match, in the player's words (the consumer seams of refugeeBuffs.ts; the
// stat names are REFUGEE_BACKGROUNDS' own statLabel).
export const REFUGEE_BUFF_HELP: Readonly<Record<RefugeeBackground, string>> = {
  refiner: "each refine job has a chance to deliver one extra batch",
  fuelHandler: "every ship's reach grows, read live, so a move acts at once",
  dispatcher: "every phase of a short-range cycle runs shorter, set when the cycle starts; partial ticks carry over to the next phase, so even a small buff acts over time",
  scholar: "blueprint research and relic study run faster, set when each one starts",
  machinist: "Fabricator crafts run faster, set when each one starts",
  shipwright: "Shipyard builds run faster, set when each one starts",
  salvager: "more materials come back from every salvage",
  stargazer: "raises the odds an expedition finds something on the surface and underground, set when the ship is sent",
};
const REFUGEE_EXAMPLE_SKILL = 42;
// "+4.2%": one decimal, the readout the Posts strip shows.
const sharePct = (fraction: number): string => `${Number((fraction * 100).toFixed(1))}%`;
const REFUGEE_SKILL_TEXT = SR_TIERS.map((t) => `${REFUGEE_SKILL_SPANS[t][0]} to ${REFUGEE_SKILL_SPANS[t][1]} from a ${srTier(t)} evacuation`).join(" and ");
// The first four levels that open a post (1, 4, 7, 10 with REFUGEE_POSTS_EVERY 3), found by walking refugeePostsAt.
const REFUGEE_POST_LEVELS: number[] = [];
for (let level = 1; REFUGEE_POST_LEVELS.length < 4 && level < 1000; level++) {
  if (refugeePostsAt(level) > refugeePostsAt(level - 1)) REFUGEE_POST_LEVELS.push(level);
}
// "the Refinery", but "Mission Control" (a proper name, no article).
const facilityName = (f: keyof typeof REFUGEE_FACILITY_LABELS): string => (f === "missionControl" ? REFUGEE_FACILITY_LABELS[f] : `the ${REFUGEE_FACILITY_LABELS[f]}`);
const REFUGEE_BACKGROUND_LINES = REFUGEE_BACKGROUND_KEYS.map((bg) => {
  const def = REFUGEE_BACKGROUNDS[bg];
  return `- ${def.label}: matches ${facilityName(def.facility)} (${def.statLabel}): ${REFUGEE_BUFF_HELP[bg]}.`;
}).join("\n");
const EVACUATION_LABEL = SHORT_RANGE_TEMPLATES.evacuation.label;
const RELOCATION_LABEL = SHORT_RANGE_TEMPLATES.refugeeRelocation.label;

export const REFUGEES_HELP_PARAGRAPHS: readonly string[] = [
  `Refugees are named people your ${EVACUATION_LABEL} runs bring home. Each one has a name, a background and a skill, all fixed when they arrive (there is no leveling). Post them at a facility and they make it better. They never fly, fight or take a crew seat, they cost nothing to keep, and nobody is ever lost. You find them on the Crew tab under Refugees, which appears once the first person arrives.`,
  `EVACUATIONS: ${article(EVACUATION_LABEL)} ${EVACUATION_LABEL} is one of the short-range board's jobs, drawn at random like the others (see the Short-Range Missions topic). Each one delivered can bring one person home, and it pays the board's normal credits and XP either way. The first ${EVACUATION_LABEL} is a training run and always brings someone. Harder evacuations bring more capable people: skill ${REFUGEE_SKILL_TEXT}.`,
  `ARRIVALS AND THE TAPER: while there are at least as many open posts as people waiting, an evacuation always brings someone home. Once more people wait than there are open posts, the chance falls smoothly: ${REFUGEE_TAPER_K} more people waiting than open posts halve it, ${3 * REFUGEE_TAPER_K} more quarter it, and it never reaches zero. Upgrading facilities opens posts and raises it again. An evacuation that brings nobody home is not a failure: everyone aboard reached the camps, and the log says so.`,
  `ARRIVING: a new arrival shows a card on the short-range board that offers a one-tap post at their best open post (Choose a post when every post is full), or leaves them on the waiting list; with several cards queued (after time away, for example), Leave all on the waiting list answers every card at once. On a phone, a short notice shows for a few seconds and then tucks into the Refugees tab's count, where the arrival waits for you. Offline time brings people home exactly as if you had been watching.`,
  `BACKGROUNDS AND MATCHES: each background matches one facility. Posted at their match, a refugee gives ${sharePct(REFUGEE_MATCH_SHARE_PER_SKILL)} per point of skill (skill ${REFUGEE_EXAMPLE_SKILL} gives +${sharePct(REFUGEE_EXAMPLE_SKILL * REFUGEE_MATCH_SHARE_PER_SKILL)}). Posted anywhere else, they give ${pct(REFUGEE_OFF_MATCH_RATIO)} of that to the facility they are at, so a match counts, but nobody is wasted.\n${REFUGEE_BACKGROUND_LINES}`,
  `POSTS: a facility opens one post at Level ${REFUGEE_POST_LEVELS[0]} and one more every ${REFUGEE_POSTS_EVERY} levels after it (Levels ${andList(REFUGEE_POST_LEVELS.map(String))} open the first ${countWords(REFUGEE_POST_LEVELS.length)}). A facility that is not built yet has no posts. The Posts row under each facility on the Facilities tab shows who is posted there, each person's share and the facility's total; Mission Control's posts are on the Ops tab under Mission Control. Several people at one facility stack on a diminishing curve: each one adds a little less than the last, but there is never a cap.`,
  `MOVING IS FREE, ANY TIME: post, move or return anyone to the waiting list with no cost, no cooldown and no timer. Pick a filled post to move that person or send them back to waiting. The picker lists the people waiting, sorted by what they would add here, and the people posted elsewhere, with Move here. Posting at a full facility is a swap, and you pick who goes back to the waiting list. A buff that times a job is set when the job starts, so a move changes the next job, never one already running.`,
  `RELOCATION LEADERS: a ${RELOCATION_LABEL} job takes one person from the waiting list along to lead the new camp, the one who has waited longest, and the log says goodbye. With nobody waiting it runs exactly as before.`,
  "POSTED PEOPLE ALWAYS STAY: nothing ever takes a posted refugee away. Relocations take only people who are waiting, and a refugee never leaves on their own.",
];

// HOTFIX 0.13.11.3: the offline topic names the cap, so it is built FROM the constant (never typed
// as a number), which keeps the rule above: a retune of the cap changes this text with it.
import { OFFLINE_CAP_SECONDS_BASE } from "./game/offlineCap";
import { formatOfflineCap } from "./game/offlineSummary";

export interface HelpTopic {
  id: string;
  title: string;
  body: string;
}

// 0.14.0 Complement CP-16: the retirement and Hall of Command topic, from the engine's constants.
import { MAX_CAPTAIN_RETIREMENTS, RETIREMENT_EXP_PER, RETIRE_LEVEL_GATE, lockedInRetirementXpPercent } from "./game/captainRetirement";
import { LEVEL_MILESTONE_EVERY } from "./game/captainNotables";
const HALL_OF_COMMAND_PARAGRAPHS: readonly string[] = [
  `RETIRING A CAPTAIN: a captain at level ${RETIRE_LEVEL_GATE} or higher, idle at home, with an Executive officer seated aboard their ship can retire from the Prestige tab. The Executive officer succeeds them and takes the captaincy; the slot goes back to level 1 with its base talents refunded, keeps its prestige talents and gains one prestige point. Each slot can retire ${MAX_CAPTAIN_RETIREMENTS} times.`,
  `THE FINAL RETIREMENT: when a slot is on its last retirement (${MAX_CAPTAIN_RETIREMENTS} of ${MAX_CAPTAIN_RETIREMENTS}), the retire confirm says so before you commit. After it the captaincy locks in: it can never retire again, so it earns no more prestige points, and its share of the fleet-wide captain XP bonus stops growing. Every retirement adds ${Math.round(RETIREMENT_EXP_PER * 100)}% to the captain XP all your captains earn, so a slot that has retired ${MAX_CAPTAIN_RETIREMENTS} times keeps giving +${lockedInRetirementXpPercent()}%, and only your other slots' retirements can raise the bonus further.`,
  `THE HALL OF COMMAND: every retirement adds an entry to the Hall of Command, a section of the Archive that appears once your first captain retires. Each entry shows the name the captain served under, the level they retired at, which retirement it was, how many missions they flew (each delivered mission cycle, patrol route and short-range cycle counts, and a patrol route counts whether it was won or lost) and the in-game day they retired.`,
  `NOTABLE MOMENTS: each entry also lists the captain's notable moments with the in-game day of each: every ${LEVEL_MILESTONE_EVERY}th level they reached, and their ship's first expedition, first relic found, first Tier II or deeper run and first refugee rescued while they were in command. The successor starts a fresh record. Missions and notables count from this update on, so a retirement before it has no entry.`,
];

// 0.14.0 Complement CP-17: the Personnel Rosters topic, true to applyRoster (personnelRosters.ts) and the ship
// screen's roster picker (ShipRosterBar.svelte, shipRosterDisplay.ts).
const PERSONNEL_ROSTERS_PARAGRAPHS: readonly string[] = [
  "SAVED ROSTERS: Personnel Rosters, in Facilities, saves a ship's people as a named roster: the officer you pin to each bridge seat and the notable crew you pin, in a priority order. A roster can also link an Armory ship loadout and one squad loadout per ground team. Only a roster with Include Senior Staff & Complement turned on can be applied.",
  "APPLYING: a roster seats its pinned officers (an officer already in that seat goes back to unassigned, and seats the roster does not pin keep their officer), brings its pinned notable crew aboard in priority order up to the ship's caps, then fills the remaining berths from the crew pool. Those fill-in crew are not written back to the roster, and no crew already aboard is sent away. A pinned officer or notable crew member serving on another idle ship moves to this one: Apply first names each of them and the ship they would leave, you can cancel, and the log records the move. A linked loadout goes on first, so the caps reflect its gear; a loadout worn by another ship stays on that ship, and one for another hull type or over the ship's power stays in the Armory.",
  "FROM THE SHIP: a ship's Senior Staff and Complement tabs carry a roster picker. Choosing a roster changes nothing until you press Apply. When the ship's officers and notable crew match no saved roster and the roster would take an officer out of a seat, Apply first warns that the unsaved configuration will be lost, and you can cancel. When a roster's linked loadout is for another hull type, both the picker and the facility say the gear stays in the Armory before you apply. Apply waits while the ship is out on a mission, patrol or short-range run, or until its expedition is claimed, and while a pinned person is aboard a ship that is out.",
  personnelRostersBoardHelpText(),
];

// Complement CP-19: how big the candidate boards are and how to grow them, in the engine's own numbers
// (model.ts PERSONNEL_ROSTERS_LEVELS, SENIOR_STAFF_ROSTER_BASE; captainExplorerEffects.ts for the Recruiter).
import { PERSONNEL_ROSTERS_LEVELS, PERSONNEL_ROSTERS_SLOTS_PER_RUNG, SENIOR_STAFF_ROSTER_BASE } from "./game/model";
export function personnelRostersBoardHelpText(): string {
  const bought = PERSONNEL_ROSTERS_LEVELS.filter((r) => r.credits > 0 || r.durationTicks > 0);
  const top = SENIOR_STAFF_ROSTER_BASE + PERSONNEL_ROSTERS_LEVELS.reduce((sum, r) => sum + r.boardSlots, 0);
  const topLevel = PERSONNEL_ROSTERS_LEVELS[PERSONNEL_ROSTERS_LEVELS.length - 1].level;
  const prices = bought.map((r) => r.credits.toLocaleString("en-US"));
  const priceList = prices.length > 1 ? `${prices.slice(0, -1).join(", ")} and ${prices[prices.length - 1]}` : prices.join("");
  const recruiter = SECONDARY_CAPTAIN_TALENTS.commandCrew4;
  const recruiterSlots = recruiter.effect.type === "flatAdd" ? recruiter.effect.amount : 0;
  return `CANDIDATE BOARDS: the officer board and the away-team recruit board each show ${SENIOR_STAFF_ROSTER_BASE} candidates at Personnel Rosters Level 1, where every save starts. The facility's Upgrades tab grows both boards: each level adds ${PERSONNEL_ROSTERS_SLOTS_PER_RUNG} candidate slots to each board, up to ${top} at Level ${topLevel}, and costs credits (${priceList}) and a build time shown on the card. New slots add candidates without changing the ones already on the board: existing candidates keep their places. A captain with the ${recruiter.label} talent adds ${recruiterSlots} more candidate slot${recruiterSlots === 1 ? "" : "s"} to each board at every level (the best one in the fleet counts; a second adds nothing).`;
}

// Complement CP-18: the soft captain level cap, in the engine's own numbers.
import { CAPTAIN_SOFT_CAP_GROWTH, CAPTAIN_SOFT_CAP_LEVEL } from "./game/model";
export const CAPTAIN_SOFT_CAP_TEXT = `Captain levels never stop: there is no top level. Each level costs more experience than the one before it, and past level ${CAPTAIN_SOFT_CAP_LEVEL} each level also costs ${Math.round((CAPTAIN_SOFT_CAP_GROWTH - 1) * 100)}% more on top of that, compounding, so the climb slows the higher a captain goes.`;

// 0.14.0 GEAR WEAR step 5: the "How gear wear works" topic (design doc section 8 and the approved mockup, Quick Service
// dropped by the user 2026-11-09), every number read from the engine (gearWear.ts, gearWearDisplay.ts bands), so a
// retune changes this text with it. gearWearStep5.test.ts checks each clause against the engine.
import { REPAIR_RATES as GEAR_REPAIR_RATES, USE_WEAR_FLOOR as GEAR_USE_FLOOR, WEAR_EFFICIENCY_DEPTH } from "./game/gearWear";
import { WEAR_BANDS, ratePercentText } from "./gearWearDisplay";
const wearPct = (perMille: number): string => `${perMille / 10}%`;
const WEAR_BAND_LINE = WEAR_BANDS.map((b, i) => {
  if (i === 0) return `${b.name} (${wearPct(b.min)} and up)`;
  const upTo = WEAR_BANDS[i - 1].min / 10 - 1;
  return b.min > 0 ? `${b.name} (${wearPct(b.min)} to ${upTo}%)` : `${b.name} (below ${wearPct(WEAR_BANDS[i - 1].min)})`;
}).join(", ");
export const GEAR_WEAR_PARAGRAPHS: readonly string[] = [
  `EVERYTHING WEARS IN ITS OWN WAY: cargo bays by hauls, FTL drives by distance, reactor cores and crew modules by time out on a mission, short-range run or expedition, universal modules by time underway on those runs too, sensors by scans, utility gear by its own job, member gear by fights, fieldwork and time on the ground, and weapons, shields, plating and drone pods by battle. A patrol wears its gear only through battle damage; a Damage Control Suite's wear when it patches a patrol wave counts as combat wear. ${TRAINING_WEAR_SENTENCE}`,
  `CONDITION: a piece's card shows its condition as a bar, its band and a percent: ${WEAR_BAND_LINE}. Ordinary use stops at ${wearPct(GEAR_USE_FLOOR)}; only battle damage takes a piece lower. Wear never breaks, salvages or uninstalls anything and never blocks a run.`,
  `WHAT WEAR DOES: a worn piece's own stat lines work a little weaker, on a smooth curve: almost nothing when lightly worn, ${Math.round((1 - WEAR_EFFICIENCY_DEPTH * (1 - GEAR_USE_FLOOR / 1000) ** 2) * 100)}% at ${wearPct(GEAR_USE_FLOOR)}, and never below ${Math.round((1 - WEAR_EFFICIENCY_DEPTH) * 100)}% even at 0. A weapon and the Reactor Core open each fight at their true condition instead (the reactor's power output always stays full). The FTL drive does both: its transit speed works a little weaker, and it opens each fight at its true condition. Reach, the power budget, crew stations and equip requirements always read a piece as new.`,
  `REPAIR IS AUTOMATIC: it never needs you. Repair itself is always free. Gear recovers ${ratePercentText(GEAR_REPAIR_RATES.home)} at home (a docked ship, every spare in storage, a Repeat patrol paused to repair), ${ratePercentText(GEAR_REPAIR_RATES.shipyardBay)} while its hull is in a Shipyard repair bay (kept until the gear is full, even after the hull is done), ${ratePercentText(GEAR_REPAIR_RATES.fieldRepair)} while set down on an expedition field repair, and ${ratePercentText(GEAR_REPAIR_RATES.underway)} out on a run. Officer repair speed and a Damage Control Suite speed up every rate, the same way they shorten a hull repair. On a docked ship you may pay for Overtime from a piece's gear card: each step speeds all of that ship's gear repair by ${Math.round(OVERTIME_STEP_RATE * 100)}% of the normal rate, up to ${OVERTIME_MAX_STEPS} steps, priced by the whole repair job. It only ever speeds the repair, which stays free, and it ends when the gear is full or the ship leaves on a run (a Repeat patrol that repairs first before it leaves keeps it until it heads out). It works during a Repeat patrol's repair pause too (the ship is home): it speeds the pause, and the patrol heads back out as soon as its combat gear is full.`,
  "WHERE TO SEE IT: tap a piece for its card (its band, what the wear does and when it is back to full). The Ship Systems board shows a small meter on every slot and a Gear chip in its header. Command Home shows one quiet Fleet care section while any gear is worn or a hull is damaged: ships recovering at home or in a Shipyard bay, worn ships out on patrol or on a run, and hulls waiting for a free Shipyard bay.",
];

// ============================================================================
// CP-21 close-out (E-CREW Task 34): the Complement, Senior Staff, Recruiting, Implants and Away-Team Members topics,
// every number read from the engine (transports.ts, commandStructure.ts, crewRaces.ts, seniorStaff.ts, officerStats.ts,
// awayTeam.ts), every rule true to the code that enforces it (crewLock.ts, crewTransfer.ts, crewGraduation.ts,
// crewOverlay.ts resolveCrew, salvage.ts, memberEquipment.ts).
// ============================================================================
import { TRANSPORT_BATCH_SIZE, TRANSPORT_WINDOW_SECONDS } from "./game/transports";
import { CIVIC_CHARTER_TRANSPORT_CREW, HOMEWORLD_TALENTS, NOTABLE_CREW_CAP } from "./game/model";
import { CREW_PROFESSIONS, commandStructureForHull } from "./game/commandStructure";
import { CREW_RACES } from "./game/crewRaces";
import { GRAPH_PALETTE_IDS, GRAPH_PALETTE_LABELS } from "./graphPalettePreference";
import {
  OFFICER_PROMOTION_STATS_RAISED,
  OFFICER_PROMOTION_STAT_POINTS,
  OFFICER_ROSTER_WINDOW_SECONDS,
  OFFICER_STAT_INFO,
  OFFICER_STAT_KEYS,
  OFFICER_STAT_ROLL_MAX,
  SENIOR_STAFF_SEATS,
} from "./game/seniorStaff";
import { OFFICER_FACET_PER_POINT, OFFICER_STAT_NEUTRAL, XO_DEPARTMENT_SHARE } from "./game/officerStats";
import { AUGMENT_AFFINITY_RACES, STATUS_RESIST_CAP, implantSlotsFor } from "./game/awayTeam";
import { buffCountForRank } from "./game/crewRank";
import { UNASSIGNED_INTRO } from "./awayTeamDisplay";
import type { CrewRace } from "./game/model";

const listAnd = (items: readonly string[]): string =>
  items.length > 1 ? `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}` : items.join("");
// A share (0.0005) as a short percent ("0.05%"), never more than two decimals.
const crewSharePct = (v: number): string => `${Math.round(v * 10000) / 100}%`;
const raceLabel = (r: CrewRace): string => CREW_RACES[r].label;
const TRANSPORT_MINUTES = TRANSPORT_WINDOW_SECONDS / 60;
const CIVIC_CHARTER_LABEL = Object.values(HOMEWORLD_TALENTS).find((t) => t.effect?.type === "transportCrewBonus")?.label ?? "Civic Charter";
const OFFICER_BOARD_MINUTES = OFFICER_ROSTER_WINDOW_SECONDS / 60;

// Every hull's berths, in SHIP_TYPES order ("General Freighter 30").
export const HULL_BERTHS_LINE = listAnd(
  (Object.keys(SHIP_TYPES) as ShipTypeKey[]).map((h) => `${SHIP_TYPES[h].label} ${commandStructureForHull(h).total.toLocaleString("en-US")}`),
);

// The six racials the Complement topic explains, each read from its race (per crew member and per officer).
const RACIAL_WHAT: readonly { race: CrewRace; what: string }[] = [
  { race: "belter", what: "Deck Handling: the ship's drone squadrons rebuild faster on a patrol" },
  { race: "spacer", what: "transit speed: both legs of a mission and an expedition's voyage go faster" },
  { race: "vael", what: "Survey Aptitude: faster scans on an expedition, set when the ship launches" },
  { race: "outerColony", what: "Survey Aptitude, as the Vael" },
  { race: "earthBorn", what: "Crew Effectiveness (above)" },
  { race: "stheni", what: "Damage Control: faster hull repairs, at the Shipyard and on an expedition's field repair" },
];
export const COMPLEMENT_RACIAL_LINES: readonly string[] = RACIAL_WHAT.map(({ race, what }) => {
  const rb = CREW_RACES[race].racialBonus;
  return `- ${raceLabel(race)}: ${what}. Each crew member adds ${crewSharePct(rb.complement)}, an officer ${crewSharePct(rb.seniorStaff)}.`;
});

// The Crew tab's notable band (NotableTicker.svelte, user answers 2026-11-12): true to notableTickerDisplay.ts (the
// order) and ui/marquee.ts (the drift and its pauses).
export const NOTABLE_BAND_LINE =
  "A band under the Crew tab's tabs lists every notable in the fleet, aboard a ship or not, favorites first and then in the order they graduated. It drifts slowly and holds still while you point at it, focus it or touch it, and always with Reduce motion on. Tap a name to open their record, with the same Send back and Retire; All lists everyone by ship.";

export const COMPLEMENT_PARAGRAPHS: readonly string[] = [
  `WHERE CREW COME FROM: a crew transport arrives every ${TRANSPORT_MINUTES} minutes of game time with ${TRANSPORT_BATCH_SIZE} new crew (the ${CIVIC_CHARTER_LABEL} Homeworld talent adds ${CIVIC_CHARTER_TRANSPORT_CREW} more), and they wait in the crew pool. Open a ship on the Ships tab: its Complement tab shows who serves aboard, in ${CREW_PROFESSIONS.length} divisions (${listAnd(CREW_PROFESSIONS.map((p) => DEPARTMENT_LABEL[p]))}), each with its ranks. Crew with the same origin, division, rank, rarity and buffs travel together as one group.`,
  `BERTHS: every hull has a fixed number of crew berths: ${HULL_BERTHS_LINE}. Each division and each rank has its own share of them. Crew Quarters add berths (the Elite Quarters add none), and the Complement tab shows the base and the module's share. A notable crew member aboard holds a berth too.`,
  "OVER CAP: when a ship holds more crew than its berths, for example after its Crew Quarters come off or are swapped for fewer berths, nobody is removed. It simply takes no new crew where it is over until it is back under, and the Complement tab says Over capacity, or marks the division Over cap.",
  "AUTO-CREW AND MANUAL: with Auto-crew on (the default), the ship fills itself from the pool: its specialty divisions first, then the highest ranks first, within its caps. Turn Auto-crew off and the ship is manual: it never fills on its own and takes only the crew you send it. While a ship is out on a mission, patrol or short-range run, or until its expedition is claimed, auto-crew pauses (the toggle reads paused while out) and every crew change is locked; it fills again on the first tick after it is home. Favorites and the Manifest still work while it is out.",
  "TRANSFERS: pick crew groups on a ship's Complement tab and press Transfer to move them to another ship or back to the crew pool, or send crew from the Crew Pool tab to a ship. Manual ships only: a ship on Auto-crew must be switched to manual first, and the picker offers it. A ship takes only what its berths allow; the picker shows how many each row will move and names the cap that stops a short row.",
  "THE CREW POOL: Personnel Rosters, in Facilities, has a Crew Pool tab: how many crew are waiting, per division, with the same table of groups and a Manifest. Crew sent back from a ship and the crew of a salvaged hull land there too. The pool has no limit, but crew that no berth in your fleet can take move on to the Homeworld reserve, shown as a count on the Crew Pool tab; they keep their ranks and racials, and Auto-crew ships draw from the reserve when the pool cannot fill a berth.",
  `NOTABLE CREW: Graduate one turns one crew member of a group into a named notable, assigned to the same ship. It is identity only: the ship's caps and buffs do not change. The fleet holds at most ${NOTABLE_CREW_CAP} notables, aboard a ship or not. Send back unassigns a notable from the ship (they keep their name, and a Personnel roster can assign them again). Retire lets a notable leave the fleet with your thanks: no penalty, it frees a notable slot, and it cannot be undone. ${NOTABLE_BAND_LINE}`,
  "THE MANIFEST: lists every crew member aboard (or in the pool) by name, a page at a time. The names are made up when you open it and never saved; a crew member keeps the same name while they stay in their group.",
  `UNASSIGNED: salvaging a hull never loses anyone. Its crew go back to the pool, its officers wait under Available Officers, its notables are unassigned, and its away-team members appear in the Unassigned list on every ship's Away Team tab: ${UNASSIGNED_INTRO}`,
  "CREW EFFECTIVENESS: a Medical crew buff and the Earth-born racial. It makes every other crew buff on the ship stronger, each bit worth a little less than the last, with no cap. It never boosts itself, the officers' own bonuses, or the Science crew's and Science officer's sensor lifts.",
  ["RACIALS: every crew member and officer carries a small bonus from their origin. Among them:", ...COMPLEMENT_RACIAL_LINES].join("\n"),
  `GRAPH COLORS: Settings, UI, Accessibility, Graph colors changes the colors of the rank bars on this device: ${listAnd(GRAPH_PALETTE_IDS.map((id) => GRAPH_PALETTE_LABELS[id]))}. While the Color-blind palette setting is on, Default shows the color-blind safe colors; Monochrome still overrides it.`,
];

const SEAT_NAMES: Readonly<Record<(typeof SENIOR_STAFF_SEATS)[number], string>> = {
  executive: "Executive Officer",
  pilot: "Pilot",
  operations: "Operations",
  science: "Science",
  tactical: "Tactical",
  medical: "Medical",
  engineering: "Engineering",
};
export const OFFICER_STATS_PARAGRAPHS: readonly string[] = [
  `SEATS: a ship's Senior Staff tab has ${SENIOR_STAFF_SEATS.length} bridge seats, one officer each: ${listAnd(SENIOR_STAFF_SEATS.map((s) => SEAT_NAMES[s]))}. An officer serves only in the seat of their own type. Each seat heads a department: Tactical heads Security, the Pilot heads the Flight Deck, and the others head their namesake. The Executive Officer adds ${Math.round(XO_DEPARTMENT_SHARE * 100)}% of their own stats' effect to every department.`,
  `HIRING: an empty seat lists the officer candidates for it, and Hire seats one at once, free. The candidates change every ${OFFICER_BOARD_MINUTES} minutes of game time (the Personnel Rosters topic says how big the board is). Hired officers without a seat wait under Available Officers, ready to assign. Dismiss lets an officer go for good.`,
  "BONUSES: each officer brings two different bonuses, rolled when they first appear, from their seat's own list and a list any seat can roll; the rarer bonuses roll less often. They act on the ship the officer is seated on, and a Bridge Module, some captain talents and the Museum make them stronger.",
  [
    `STATS: ${listAnd(OFFICER_STAT_KEYS.map((k) => OFFICER_STAT_INFO[k].label))}, each rolled 1 to ${OFFICER_STAT_ROLL_MAX}. Only the points above ${OFFICER_STAT_NEUTRAL} count, ${Math.round(OFFICER_FACET_PER_POINT * 100)}% each, and a stat at ${OFFICER_STAT_NEUTRAL} or lower costs nothing. Each shapes the department the officer heads:`,
    ...OFFICER_STAT_KEYS.map((k) => `- ${OFFICER_STAT_INFO[k].label} (${OFFICER_STAT_INFO[k].facet}): ${OFFICER_STAT_INFO[k].effect}`),
    "Officer stats never affect away teams on a planet.",
  ].join("\n"),
  `RANKS AND PROMOTION: ${listAnd(OFFICER_RANK_ORDER.map((r) => officerRankLabel(r)))}. A new officer starts as a ${officerRankLabel(OFFICER_RANK_ORDER[0])}. The officer's card lists what the next rank needs (missions completed, hours on runs, hostile ships destroyed, and at the last step an objective completed by the ship's squads); once every line is met, Promote. A promotion makes both bonuses stronger and adds ${OFFICER_PROMOTION_STAT_POINTS} points to each of the officer's ${OFFICER_PROMOTION_STATS_RAISED} highest stats.`,
  "ORIGIN: an officer carries their origin's racial bonus at the officer's size (the Complement and the Crew Pool topic lists the racials).",
  "WHILE THE SHIP IS OUT: on a mission, patrol or short-range run, or until its expedition is claimed, its officers cannot be hired, seated, unseated or dismissed. Promoting and favorites still work.",
];

const traitRanks = (): string => {
  const groups: { count: number; from: number; to: number }[] = [];
  for (let r = 1; r <= 8; r += 1) {
    const n = buffCountForRank(r as Parameters<typeof buffCountForRank>[0]);
    const last = groups[groups.length - 1];
    if (last && last.count === n) last.to = r;
    else groups.push({ count: n, from: r, to: r });
  }
  return listAnd(groups.map((g) => `${g.count} at ${g.from === g.to ? `rank ${g.from}` : `ranks ${g.from} to ${g.to}`}`));
};
export const RECRUITMENT_PARAGRAPHS: readonly string[] = [
  `THE RECRUITMENT BOARD: every ship's Away Team tab has it. It lists candidates for Security and Science squads and changes every ${OFFICER_BOARD_MINUTES} minutes of game time; it is as big as the officer board (the Personnel Rosters topic says how to grow both). Hiring is free: pick the ship and press Hire. A hired candidate leaves the board and is slotted into the first empty slot of their squad type.`,
  `CANDIDATES: a card shows the name, rank, origin, squad and specialty, each trait with what it does, and the implant slots. Higher ranks are rarer and carry more traits (${traitRanks()}). A member's rank never changes.`,
  "LIMITS: a ship holds as many members as its squad slots and reserve berths. When Hire cannot go ahead, it says why: the ship is out on a run, the squad type is full along with the reserve, or the candidate is gone.",
];

const AFFINITY = listAnd([...AUGMENT_AFFINITY_RACES].map(raceLabel));
export const IMPLANTS_PARAGRAPHS: readonly string[] = [
  `Implants are away-team gear worn by a member, never by an officer. Every member has ${implantSlotsFor({ race: "earthBorn" })} implant slot; ${AFFINITY} members (augment affinity, shown on their card) have ${implantSlotsFor({ race: [...AUGMENT_AFFINITY_RACES][0] })}.`,
  "GETTING ONE: research an implant's blueprint at the Research Lab, then craft it at the Fabricator. Each implant names the squad type that can use it.",
  `INSTALLING: tap an implant chip on the member's card on the Away Team tab. When every slot is full, choose which implant it replaces. An implant's lines raise the member's stats or their resist to a status; no resist goes past ${Math.round(STATUS_RESIST_CAP * 100)}%.`,
  "THE NEURAL BACKUP: a unique implant. Only one can be worn in the whole fleet (spares can wait in storage). Once per battle it may revive its wearer.",
  "Firing a member returns their gear and implants to storage. Implants, like all member gear, stay as they are while the ship is out on a run.",
];

export const AWAY_MEMBERS_PARAGRAPHS: readonly string[] = [
  "MEMBERS: each member's card on a ship's Away Team tab shows their specialty, traits, gear (one Armor, one Weapon and one Tool) and implants. Install gear from a cell; installing into a full cell sends the old piece back to storage. Move sends a member to another ship, wearing their gear. Fire lets them go and returns their gear and implants to storage.",
  "INJURIES: a member still in the medical bay when the expedition is claimed comes home Injured for the bay time left. They cannot deploy until they recover, and their card shows the time left. Their gear stays on them.",
  `UNASSIGNED: members with no ship, for example after their hull was salvaged, are listed on every ship's Away Team tab. ${UNASSIGNED_INTRO}`,
  "WHILE THE SHIP IS OUT: on a mission, patrol or short-range run, or until its expedition is claimed, its members cannot be hired, fired or moved, and their gear and implants cannot change.",
  // OC-F12 control (user answers 2026-11-12, Option A; Balanced "Treat as no default"; Clear "Security only"): the editor's
  // Set for new hires and Clear (memberGambits.ts), the merge's kinds read from the engine (mergeWithBuiltInDefault).
  `NEW HIRES: a Security member you hire starts on the built-in default tactical protocols. To change that, pick a Security member with protocols of their own in Away-Team Tactical Protocols (the Ops tab, under Exploration) and press Set for new hires: each Security member hired after that starts with a copy of their protocols, with the built-in ${mergeAddedKindsText([])} rules they lack placed first. Clear, or Set for new hires on a member running the Balanced preset, puts new hires back on the built-in default. Members already hired never change.`,
  "The Team Types and Squads topic covers squads, the reserve and deploying; the Recruiting topic covers the board.",
];

export const HELP_TOPICS: HelpTopic[] = [
  {
    id: "crew",
    title: "Crew and Captains",
    body: `Crew is your roster of captains, found on the Crew tab under Captain Roster. Each captain commands one ship and earns XP every tick while out on a mission, so leveling is steady rather than only paying out at the end of a run. ${CAPTAIN_SOFT_CAP_TEXT} Your Fleet Admiral level rises alongside them, and it climbs faster the more captains you have working at once. Some captain slots start locked and open up once you have both the required talent and a high enough Fleet Admiral level. A captain needs a ship assigned (from the ship's page on the Ships tab) before it can be dispatched on missions.`,
  },
  {
    // 0.14.0 Complement CP-16: retirement's final warning and the Archive's Hall of Command (captainRetirement.ts,
    // captainNotables.ts, hallOfCommandDisplay.ts), built from the engine's constants.
    id: "hallOfCommand",
    title: "Retirement and the Hall of Command",
    body: HALL_OF_COMMAND_PARAGRAPHS.join("\n\n"),
  },
  {
    // 0.14.0 Complement CP-17: Personnel Rosters and the roster picker on a ship's Senior Staff and Complement tabs
    // (personnelRosters.ts applyRoster, shipRosterDisplay.ts). Before CP-17 rosters had no topic.
    id: "personnelRosters",
    title: "Personnel Rosters",
    body: PERSONNEL_ROSTERS_PARAGRAPHS.join("\n\n"),
  },
  {
    // CP-21 close-out (E-CREW Task 34, "Complement Active Mode" and the rest of the complement slices CP-5 to CP-10, CP-20).
    id: "complement",
    title: "Complement and the Crew Pool",
    body: COMPLEMENT_PARAGRAPHS.join("\n\n"),
  },
  {
    // CP-21 close-out (E-CREW Task 34, "Officer Stats").
    id: "officerStats",
    title: "Senior Staff and Officer Stats",
    body: OFFICER_STATS_PARAGRAPHS.join("\n\n"),
  },
  {
    // CP-21 close-out (E-CREW Task 34, "Recruitment").
    id: "recruitment",
    title: "Recruiting",
    body: RECRUITMENT_PARAGRAPHS.join("\n\n"),
  },
  {
    // CP-21 close-out (E-CREW Task 34, "Away Teams": the members; Team Types and Squads covers the squads).
    id: "awayMembers",
    title: "Away-Team Members",
    body: AWAY_MEMBERS_PARAGRAPHS.join("\n\n"),
  },
  {
    // CP-21 close-out (E-CREW Task 34, "Implants").
    id: "implants",
    title: "Implants",
    body: IMPLANTS_PARAGRAPHS.join("\n\n"),
  },
  {
    id: "missions",
    title: "Missions",
    body: "Missions are the timed runs your captains fly to bring back resources. You launch them from the Ops tab under Gathering: pick an available mission and a ready captain, and the ship makes the round trip on a timer. Every mission lists its rewards, the XP it grants per tick, and its dispatch requirements up front (captain level, cargo space, and the trip's distance), with a clear reason spelled out whenever you cannot launch yet. A ship's cargo hold counts on missions only: it sets how much a mission brings home, while expeditions and patrols do not use it. A ship can only fly a mission whose round-trip distance is within its reach (see the Fuel topic). Tougher runs such as Salvage and Forage ask for a more experienced captain before they will launch. The Cometary Ice Harvest is open from day one: it mines a passing comet for Deuterium Ice, with Titanium Ore and the odd Iridium Ore strike, and the Refinery presses that ice into the Deuterium Canisters every Reactor Core blueprint is crafted with.",
  },
  {
    id: "operations",
    title: "Operations and Mission Control",
    body: "Operations, the Ops tab, is where you run missions. Gathering, Combat Patrols, Exploration and Short-Range are where you send captains out (see the Short-Range Missions topic), the Overview shows every mission in progress, and Mission Control is the facility that tracks which missions are available and how many times you have completed each one. New missions unlock through Mission Control as you progress, and its upgrades open more Short-Range slots, so check back there as your fleet grows.",
  },
  {
    // 0.14.0 G1-7: Short-Range Missions (SHORT_RANGE_HELP_PARAGRAPHS above; every number read from the engine).
    id: "shortRange",
    title: "Short-Range Missions",
    body: SHORT_RANGE_HELP_PARAGRAPHS.join("\n"),
  },
  {
    // 0.14.0 E5-7: Refugee Posts (REFUGEES_HELP_PARAGRAPHS above; every number read from the engine).
    id: "refugees",
    title: "Refugees",
    body: REFUGEES_HELP_PARAGRAPHS.join("\n"),
  },
  {
    id: "patrols",
    title: "Combat Patrols",
    body: "Combat Patrols are the first combat mission type, run from the Ops tab under Combat Patrols. A patrol sends one captain and their assigned ship to sweep a pirate faction's territory: the ship transits out, fights a short series of enemy waves, and transits back. The ship's transit speed sets how long each transit leg takes (a fast ship flies them in fewer ticks, a slow one takes more), and Fast Departure crew shorten the leg out while Fast Return crew shorten the leg home, all fixed when each patrol cycle starts; the trip's distance, and the reach it needs, stay the same. You do not pick a ship here (assign that on the Ships tab); you pick the captain and their assigned hull comes with them, shown read-only. Any hull can patrol: freighters and prospectors carry a light Standard-Issue combat set, but a purpose-built warship (a destroyer, battleship, or carrier) is far stronger. The only gear a patrol requires is a Reactor Core, because with no reactor the ship has no power to set a course. A ship with no weapon installed can still launch, but the dispatch card warns you that it will not be able to return fire. Two patrols are available: the entry Crimson-Reaver Sweep, a short local sweep any warship can win, and the tougher Crimson-Reaver Warband, a real fight where hull choice, your crafted gear, and a carrier's drone screen all matter. Before you commit, the dispatch card shows two advisory readouts: your ship's Battle Rating (a single how-geared-am-I number that rises as you install better gear) and a Threat Assessment (a named band, from Guaranteed Victory down through the middle to Impossible, forecasting the fight against that patrol's enemies). Both are guidance only: you can dispatch regardless of what they say, and the exact win percentage is deliberately not shown. Choose a stance (Aggressive closes until every gun fires; Balanced holds where most of its firepower reaches; Defensive holds at its longest gun's reach, takes less damage and deals a little less, puts its shields first, and turns its point defense and drones on enemy drones first, and its point defense shoots down some incoming torpedoes; only a faster ship can open the range on its target, so at equal speed the fight closes; a ship closing in before its guns reach is harder to hit) and whether to dispatch once or repeatedly, then launch; like any mission, the round trip must be within your hull's reach. Your hull's damage carries across the waves of a run while shields recover between them. A carrier's lost drones rebuild between waves too: Deck Handling crew rebuild them faster, and while the hull is below half, the Flight Deck's Integrity (the Pilot's, with a share of the XO's) makes the Flight Deck's own Deck Handling stronger (its crew and the Pilot; Deck Handling from other seats, other departments, or the captain is not lifted), both fixed when each patrol cycle starts. Deck Handling, and the Flight Deck lift below half hull, also speed a drone pod's In-Combat Replenish during a wave. The in-progress readout shows the phase, waves won and lost, and live hull and shield bars. Win and the ship returns ready to go again; lose and it limps home flagged damaged and must be repaired before it can patrol again.\n\n" + PATROL_TORPEDO_HELP,
  },
  {
    id: "combatView",
    title: "Combat View",
    body: "The Combat View is the watch-the-fight screen, opened with the View Combat Log button on an in-progress patrol in the Ops tab's Overview. It plays the patrol's current battle round by round so you can follow the whole fight as it unfolds; the pace follows your Combat Log speed setting (a relaxed, readable cadence by default, with a faster skim option in Settings). It is a display only: watching or closing it changes nothing about the run. Two modes share the same fight, chosen with the Mode toggle. Log-Guided narrates the battle as a scrolling combat log: round dividers and one line per event, marked for crits, damage over time, evasions, shield bleed-through, and kills. Visual plays the fight as animated damage numbers that pop over the ships, with a short tracer tinted by the firing weapon's family and the number shown in red for a critical hit or a kill. The Arena, shared by both modes, shows each ship with hull and shield bars, small square status pips (red for damage-over-time such as Plasma Fire, amber for disruptions such as Targeting Drift, green for buffs, hover for the name and rank), and ship-system condition pips per weapon, reactor, and drive reading Nominal, Degraded, Disrupted, or Offline as durability wears (hover for the label); a carrier also shows one pip per drone. Between the ships, a range track marks the current distance across the Short, Medium, and Long ranges with the current weapons range and engagement phase called out, since your chosen stance decides the range you try to hold. You can tune the log from Settings (the gear in the top bar): switch the default flavor narration to a Simplified damage report, color-code shield and hull damage, set the stream speed, and turn auto-scroll on or off.",
  },
  {
    id: "refining",
    title: "Refining",
    body: "The Refinery, in Facilities, turns raw ore into the refined materials your Fabricator needs (for example Titanium Ore into Titanium Ingots, and Polysilicate Ore into Polysilicate Wafers). It runs as a set of independent production lines: each slot can be configured with its own tier, item, and amount, so several different refine jobs run at once. Starting a job reserves its ingredients up front so lines never double-spend the same stockpile, and each upgrade unlocks another line. You can queue a fixed batch or run continuously, and the status readout tells you why a line paused, whether it ran out of ingredients or the output storage is full. The Production tab lists every recipe grouped by material line, with the stock you hold of each; Order on a recipe opens a free line's form on it, or the queue's form when every line is busy (see Material lines and quality).",
  },
  {
    id: "materialQuality",
    title: "Material lines and quality",
    body: `Every material you hold has a quality, from Q0 to ${TOP_Q}. Most stock is Q0. A mission delivery or a finished craft rolls its quality, and a ship carrying Material Quality gives each unit it delivers a chance to arrive one quality higher. Material Quality comes from the Prospecting Rig: the Refinery-Feed Rig is built for it, the Yield and Survey Rigs carry a little, and any Prospecting Rig can roll it as an extra line.

The Refinery's Production tab groups its recipes into material lines by where their raws come from: ${LINE_NAMES}. A compound sits with the line of its main raw (Cobalt Coil under Heavy metals, for example). Each recipe shows how much of its output you hold, split by quality, and each raw opens to show its own split. The same split is on every material's tooltip under Logistics, Materials (hover a tile, or tap it on a phone).

Quality carries into what you refine and into everything you fabricate, equipment included. Each run of an order works out the average quality of everything it used, weighted by units and rounded down, and its output starts at that quality; the usual quality roll can then lift it further, never above ${TOP_Q}. An order spends your lowest quality stock first, so your good stock is saved. Turn on Use best materials on an order to spend the highest quality first and carry more quality into the output; the switch starts off every time you open the form.

On the order form, This order uses lists the qualities the order will draw, and Carried quality shows the average and the quality the next run starts from. Each run is its own job, so a long order on mixed stock can carry a different quality on its later runs (the form says so), and another line drawing the same material at the same time can change which stock is left.

Fabricated equipment keeps its quality too. A crafted blank holds the quality its run carried, and Crafted Blanks under Logistics shows each blank's count split by quality. Inspecting always takes your highest quality blank of that type first: the piece starts at the blank's quality, then the usual quality roll can lift it further, never above ${TOP_Q}.`,
  },
  {
    id: "fabricating",
    title: "Fabricating",
    body: "The Fabricator, in Facilities, crafts real components, ship systems, and combat gear (weapons, shield emitters, hull plating, and drone pods) from the refined materials the Refinery produces, using the blueprints you have unlocked at the Research Lab. Combat gear is craftable alongside components and ship systems: research a weapon, shield, plating, or drone-pod blueprint, then fabricate it here just like any other system, and the finished piece lands in your spare pool, ready to install onto a ship from its Ship Systems screen. Like the Refinery it runs as independent per-slot production lines, each with its own recipe, tier, and amount, and starting a craft reserves its materials up front so concurrent lines never fight over the same parts. Your crafting skill levels up as you fabricate, and the Fabricator's own Crafting Level panel shows what that skill is currently worth (see the Crafting Levels topic). Any material's tooltip breaks its count into Allocated (held by running crafts AND by orders waiting in the queue), Free (available to start something new), and Total, which is why Free drops the moment you queue an order rather than when that order starts. Canceling an unstarted line refunds its reserved materials to your Free pool, and removing a waiting order releases everything it had reserved. Field kits for your away teams are crafted here too, in their own Field Kits group (see the Field Kits topic).",
  },
  {
    id: "queues",
    title: "Order Queues",
    body: "Timed work can be lined up in advance instead of started by hand. The Refinery, the Fabricator, the Research Lab, the Salvage Bay and the Shipyard each keep their own order queue: set a job up, choose Add to queue, and it starts on its own as soon as that facility has room, including while the game is closed. TWO SEPARATE NUMBERS decide how much you can line up, and they are never added together or multiplied. LANES are how many jobs a facility runs AT ONCE: refining lines, fabrication lines, research slots, salvage bays, shipyard bays. You buy lanes with that facility's own upgrades, and each facility's lanes are its own. QUEUE DEPTH is how many orders may WAIT behind the running work. It starts at 1, it applies to every queue-capable facility SEPARATELY (a depth of 3 means three waiting orders at the Refinery and another three at the Salvage Bay, not three shared between them), and it is bought only with Homeworld talents under Fleet Logistics (Standing Orders), never with a facility upgrade. An order reserves what it needs the moment you queue it, not when it starts: the materials for a craft, or the exact spare system or units of salvaged material for a salvage. That is why your Free stock drops as soon as you add an order, and it is what stops two queued orders from claiming the same parts. Remove a waiting order and everything it had reserved comes straight back. Orders start in the order you added them, and one that cannot start yet (short on materials, or its output storage is full) is skipped so the ones behind it are not held up, with the reason shown on its own row. If a talent respec ever leaves you holding more orders than your current depth, nothing is lost: the extra orders drain normally, and no new one can be added until you are back under the cap.",
  },
  {
    id: "craftingLevels",
    title: "Crafting Levels",
    body: "Your Crafting level is the skill behind everything the Fabricator mints, and it has its own panel on the Fabricator with a live XP bar. Completed refine jobs, fabricate jobs and ship builds all award crafting XP, but deliberately not at the same rate: refining pays the lowest rate of the three, fabricating materials pays several times more, and fabricating equipment more again, scaling with the blueprint's tier, so crafting the gear you actually want is the fastest way to level and grinding ore is not a shortcut. Salvaging awards no crafting XP at all. What the level BUYS is item level: a freshly crafted piece is minted at your crafting level, plus any bonus from Homeworld talents under Industry (Tooling Upgrade), and then capped by a HARD CEILING set by the blueprint's own tier. The ceiling is the part worth remembering, because it is the one number that makes progress appear to stop: a Tier I blueprint can never mint above its Tier I ceiling no matter how high your crafting level climbs, and the talent reaches that ceiling sooner rather than lifting it. Once a tier reads as at the ceiling, the only way to mint higher is a higher-tier blueprint: research it at the Research Lab, then raise the Fabricator's level to craft it. Levels earned past every ceiling currently available are not wasted, they bank until higher-tier blueprints exist. The Crafting Level panel shows all of this per tier, so you can see exactly which of your gear tiers are still climbing and which are finished.",
  },
  {
    id: "research",
    title: "Research",
    body: `The Research Lab, in Facilities, is where you unlock blueprints. Each research project takes time and credits and permanently unlocks something you can build, from component recipes to ship-system and combat-gear blueprints (weapons, shield emitters, hull plating, and drone pods). Combat gear is researched here just like other ship systems: unlock a weapon, shield, plating, or drone-pod blueprint, then craft it at the Fabricator. Projects are organized in tiers gated by the lab's own level, so upgrading the lab opens deeper research. The lab and the Fabricator each upgrade to level ${LAB_FABRICATOR_TOP_TIER}: every upgrade adds one more research or craft slot, and a tier N blueprint needs the lab at level N to research it and the Fabricator at level N to craft it. Research is the front of the whole production chain: research a blueprint here, craft it at the Fabricator, then use the result to build ships or install their systems, combat gear included. The Lab's Data study tab studies the research data your expeditions bring home on a lane of its own, banking boosts that speed up research (see the Research Data and Data Study topic).`,
  },
  {
    // Exploration 0.14.0 (E4c). No ladder thresholds or bonus sizes in the prose (they are tunable
    // constants in relics.ts; the Museum tab prints the live numbers), per the rule at the top.
    id: "relics",
    title: "Relics and the Museum",
    body: "Relics are recovered by your away teams on expeditions. A team that wins an objective at a relic-bearing site may bring one home, and the Expedition Console names which relic sets a system's sites can yield once your sensors are strong enough. Short-Range Missions turn one up now and then too: a small chance for every hour a mission is underway, so they are rarer there than on expeditions. Relics arrive unidentified: claiming a finished expedition puts them in the Relic Vault on the Research Lab's Relics tab, and a short-range find goes there as its mission is delivered. Study a relic there to reveal which relic of its set it is. A study takes time and runs on its own lane, so it never blocks blueprint research. A relic's tier (from the away-team roll) matters: a higher tier makes the rarer relics of its set more likely. Some relic types only start turning up in higher-tier regions: they are found once your expeditions reach deeper tiers. The first time you identify a relic type is a first find, a new discovery for your collection. Every identified copy goes to the Museum, on the Archive's Museum tab, and grants a small permanent bonus of its set's per-copy stat. Each set is also a collection: owning relics 1 through K of a set unlocks its K-piece set bonus, and that bonus levels up as you collect more copies. A level needs every required relic at the next copy threshold, so a tier is only as strong as its least-collected relic, and the Museum highlights the bottleneck relic holding a tier back.",
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
      SECURITY_IN_A_FIGHT_PARAGRAPH,
      "SHIP CREW SUPPORT: the ship's crew backs its ground teams, set when the ship launches.\n- Away-Team Protection (Security crew): every Security member has more max HP.\n- Counter-Infiltration (Security crew): Security members shrug off the debuffs enemies inflict more often. It adds to a member's own resists, each bit worth a little less than the last, but never lifts one to 90%, so a member who already resists a lot gains little.\n- Triage (Medical crew): a medic heals more and every Security member's first aid works better, on top of the Fleet Triage officer bonus.\n- Prevent a Crew Loss (a rarer crew buff): injuries mend faster in the medical bay (see the Return Trip and Medical Bay topic).",
    ].join("\n\n"),
  },
  {
    // 0.14.0 Ground Operations (GO-18). Numbers read from groundOps.ts / groundThreat.ts (see the header).
    id: "groundOperations",
    title: "Ground Operations",
    body: [
      "Ground Operations is how your ground teams work a system on an expedition (the Ops tab, under Exploration). The ship scans the system's bodies from orbit, one at a time. When a body's scan finishes, its objectives appear, already assigned to your teams by the default plan, and the teams start on them while the ship scans the rest. The expedition heads home once every body is scanned, no objective is left, every ship study is done and every team is back aboard. A Gas Giant has no ground objectives: the ship studies it from orbit (see the Gas Giants and Nebulae topic).",
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
      `WHAT SPEEDS EACH STEP:\n- Offload: the crew's Efficient Unloading and the Veteran Instincts officer bonus, plus the Operations officer's Integrity when the team brings home at least ${pct(FULL_HOLD_FRACTION)} of an objective's haul at once.\n- Reload: the crew's Rapid Loadout (this reload is the only step it speeds: missions have no load step) and the captain's Efficient Stowage talent.\n- Medical bay: the Medical crew's Reduced Crew Losses, the Rapid Recovery officer bonus, and the Medical officer's Constitution and Cunning (plus Integrity and the crew's Prevent a Crew Loss, for injuries), with a share of the XO's.\nThese are set when the ship launches. Each bonus divides the time, so every bit helps, each a little less than the last, and a cure never drops to nothing.`,
      `THE MEDICAL BAY: every condition a member picked up on the trip cures on its own clock, and they all tick down at once. A member waits for their longest condition, and the team waits for its longest member. Times before any bonus:\n${CURE_LIST}\nOther battle effects, such as stuns and fear, end with the fight. Each team's bay card shows who is waiting on what. On an expedition with field kits, a ${BONE[0]} splinted in the fight costs no ${BONE[0]} time, and ${article(FIELD_KITS.injuryKit.label)} ${FIELD_KITS.injuryKit.label} used on a downed member shortens that member's bay time (see the Field Kits topic).`,
      `STONESKIN: Ossir crew members have Stoneskin. Their injuries take ${pct(STONESKIN_INJURY_MULT - 1)} longer to mend in the bay. On an expedition with field kits, physical conditions land on them ${pct(STONESKIN_BATTLE_RESIST)} less often in the fights, and the ones that land last ${pct(STONESKIN_INJURY_MULT - 1)} longer.`,
    ].join("\n\n"),
  },
  {
    // 0.14.0 Field Kits FKR-11: enemy ranks (enemyRanks.ts), every number and grade read from the rank table.
    id: "enemyRanks",
    title: "Enemy Ranks",
    body: ENEMY_RANKS_PARAGRAPHS.join("\n\n"),
  },
  {
    // 0.14.0 Field Kits FKR-11: kits, packs, the free set, the top-up, grenade charges, conditions and their severity,
    // the gambit rules and the Boss reserve. Every number from its engine constant, every control name from its screen.
    id: "fieldKits",
    title: "Field Kits",
    body: FIELD_KITS_PARAGRAPHS.join("\n\n"),
  },
  {
    // 0.14.0 Squads (SQ-7 section 7.5, "Task difficulty", named for objectives). Weights from riskFactors.ts.
    id: "objectiveDifficulty",
    title: "Objective Difficulty",
    body: [
      `Every objective on a risk-rated system carries a difficulty rating, shown on its card as pips and a name. The five grades, and how much each counts toward the system's completion: ${DIFFICULTY_LIST}. The card says how much its objective counts ("counts x${DIFFICULTY_WEIGHTS[DEADLY - 1]} toward completion" on a ${DIFFICULTY_NAMES[DEADLY - 1]} one).`,
      `WHAT SETS IT: the number of fight points, the world's hazard, every squad the objective needs beyond the first, and the body's ${RISK_FACTOR_NAMES.combat}. The region's tier is not one of them, but deeper tiers roll higher ${RISK_FACTOR_NAMES.combat} grades, which add fight points and count on their own (see the Risk Factors and Expedition Tiers topics).`,
      `THE GREATER THE RISK, THE GREATER THE REWARD: a harder objective's haul is multiplied up: about +${pct(riskRewardBonus(2))} at ${DIFFICULTY_NAMES[1]}, up to about +${pct(riskRewardBonus(DEADLY))} at ${DIFFICULTY_NAMES[DEADLY - 1]}, on a curve that keeps rising but more slowly. The same amount is added to its relic find bonus.`,
      `NEEDS: the card's requirement chips show the squads an objective needs, marked met or unmet by your deployed teams. Up to ${tier(SAFE_NEEDS_MAX_TIER)}, no objective asks for more than one squad of each type, so your teams can always take it. From ${tier(FIRST_SKIPPING_TIER)} on, an objective can need two, and one your deployed squads cannot cover is left unfinished (the Subspace Telescope can warn you before launch). ${tier(FIRST_SKIPPING_TIER)} asks for a Class ${numeral(tierMinimumDriveClass(FIRST_SKIPPING_TIER as RegionTier))} drive${frontierSensorsNeeded(FIRST_SKIPPING_TIER as RegionTier) > 0 ? ` and sensors ${frontierSensorsNeeded(FIRST_SKIPPING_TIER as RegionTier)}` : ""} (see the Expedition Tiers topic).`,
      `${REINFORCING_REQUIRED} combat objectives always carry the Reinforcing affix. While an objective is on alert its rating rises, and at ${IMPOSSIBLE_DIFFICULTY_NAME} it is held until the alert wears off (see the Reinforcing (affix) topic).`,
      `ENEMY RANKS: from ${FIRST_LED_GRADE} up, an objective's final fight is led by an ${rankLabel("elite")} or a ${rankLabel("boss")} (see the Enemy Ranks topic).`,
      "TRAINING RUNS: your first explorer expedition is a training run that cannot fail, and the guards on the runs after it start weaker and grow to full strength slowly (see the Risk Factors topic, under Training runs and rising risk).",
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
      `Every expedition system is rated on four risk factors, each graded ${orList(RISK_GRADE_NAMES)}. Deeper tiers roll higher grades, and a system in enemy territory adds ${ENEMY_TERRITORY_COMBAT_STEP === 1 ? "a step" : `${ENEMY_TERRITORY_COMBAT_STEP} steps`} of ${RISK_FACTOR_NAMES.combat} (see the Expedition Tiers topic). Each body has its own grades: the system's, or one step lower.`,
      `- ${RISK_FACTOR_NAMES.combat}: more fight points on every objective (fewer at ${RISK_GRADE_NAMES[0]} and ${RISK_GRADE_NAMES[1]}). At ${firstRollingGrade(CLEARING_SITE_RULES.clearHostiles.permilleByGrade)} or worse it can add a ${site("clearHostiles")} objective, Security work only.\n- ${RISK_FACTOR_NAMES.fauna}: more fight points at life sites (${LIFE_SITES.map(site).join(", ")}). At ${firstRollingGrade(CLEARING_SITE_RULES.secureLandingZone.permilleByGrade)} or worse it can add a ${site("secureLandingZone")} objective, also Security work only. ${planets(LIFELESS_PLANET_TYPES)} worlds hold no life.\n- ${RISK_FACTOR_NAMES.flora}: slows the fieldwork (${pct(FLORA_WORK_SLOW_PER_GRADE)} longer per grade) and puts Poison on the enemies' attacks in that body's fights. Thick growth also brings more ${site("xenoFloraBloom")} sites. It reads ${RISK_GRADE_NAMES[0]} on lifeless worlds and on ${planets(FLORALESS_PLANET_TYPES)} ones.\n- ${RISK_FACTOR_NAMES.hazard}: the body's own hazard. It slows scans and fieldwork, and a very hazardous world adds a fight point to its objectives.`,
      `AMBUSHES: an objective with no fight points can still be ambushed, more often where ${RISK_FACTOR_NAMES.combat} or ${RISK_FACTOR_NAMES.fauna} runs high (${pct(AMBUSH_CHANCE_BY_GRADE[1])} a trip at ${RISK_GRADE_NAMES[1]}, up to ${pct(AMBUSH_CHANCE_BY_GRADE[AMBUSH_CHANCE_BY_GRADE.length - 1])} at ${RISK_GRADE_NAMES[RISK_GRADE_NAMES.length - 1]}; at most ${SURVEY_AMBUSH_MAX_PER_TASK} times per objective). A crew with a Security member standing fights where it stands: a win and the work goes on, a loss counts like any other. A crew with no Security member retreats with light injuries, keeps its progress and comes back after the medical bay. A Shroud Emitter or a Lure Beacon on the crew changes the chance (see the Field Kits topic).`,
      `HOSTILE SITES: from ${tier(HOSTILE_SITE_RULES.enemyColony.minTier)}, a body at ${firstRollingGrade(HOSTILE_SITE_RULES.enemyColony.permilleByCombat)} ${RISK_FACTOR_NAMES.combat} or worse can hold an ${site("enemyColony")}, and from ${tier(HOSTILE_SITE_RULES.enemyFortification.minTier)} a body at ${firstRollingGrade(HOSTILE_SITE_RULES.enemyFortification.permilleByCombat)} ${RISK_FACTOR_NAMES.combat} or worse can hold an ${site("enemyFortification")}. A hostile site becomes an objective only when your deployed squads can take it on and still keep a Science squad. A ${GAS_GIANT} never holds a hostile site or a clearing objective (see the Gas Giants and Nebulae topic).`,
      `HAZARD RESIST: it comes from relics in the Museum, installed ship systems, your Science squads' fieldwork, Hazard Resist on Security gear (for objective work only) and, for the scan only, the Science officer's Integrity with a share of the XO's. Every source is added together before the diminishing curve, so several sources come to slightly less than their separate readouts suggest, and a hazardous world always keeps over ${pct(1 - MUSEUM_HAZARD_RESIST_MAX)} of its hazard. Resist makes the work easier; it never makes the haul poorer.`,
      TRAINING_RUNS_PARAGRAPH,
    ].join("\n\n"),
  },
  {
    // 0.14.0 Expedition Tiers G2-7 (GO-19 item 4): regions, the homeworld, drive class, reach, frontier sensors,
    // transit, recall and resume. Every number from its owner (EXPEDITION_TIERS_PARAGRAPHS).
    id: "expeditionTiers",
    title: "Expedition Tiers",
    body: EXPEDITION_TIERS_PARAGRAPHS.join("\n\n"),
  },
  {
    // 0.14.0 Squads (SQ-7 section 7.5, "Subspace Telescope"). Detail names, the lift and the lore from telescope.ts.
    id: "subspaceTelescope",
    title: "Subspace Telescope",
    body: [
      `The Subspace Telescope is a homeworld facility that surveys systems before you launch. Select a system on the expedition card (the Ops tab, under Exploration) and its Subspace Telescope block shows what the telescope reads. Upgrade it from its card under Facilities. ${TELESCOPE_LORE}`,
      `REGIONS AND RANGE: every system names its region, from ${tier(1)} (the ${REGION_TIER_NAMES[1]}) out to ${tier(7)} (the ${REGION_TIER_NAMES[7]}), and its distance from your homeworld in light-years. Deeper tiers roll higher risk (see the Risk Factors topic). Systems within the telescope's range are surveyed. Anything beyond it is a Blind launch: you see only its name, region and distance, and Launch asks first: "${BLIND_LAUNCH_WARNING}"`,
      `YOUR HOMEWORLD: every save places its homeworld at its own spot in the ${REGION_TIER_NAMES[1]}, ${HOMEWORLD_MIN_FROM_SOL_LY} to ${HOMEWORLD_MAX_FROM_SOL_LY} light-years from Sol, and the telescope measures from there: its range, every system's distance and the regions it reaches. The card's galaxy map is centered on your homeworld, with each region's badge inside that region's band of distances from it, the solid ring at your range now and a dashed ring at the next level's (when that level adds range). From ${tier(SECTOR_TIERS[0] ?? 2)} out, once the range reaches a region, the map hatches that region's enemy territory sector (a slice of its band, with a dashed edge) and the region's row in the key reads "part enemy"; a region beyond range shows none (see the Expedition Tiers topic). Each level raises the range, the detail or both; the card under Facilities lists every level's cost and time. The telescope never gates a launch (see the Expedition Tiers topic).`,
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
      `- Debris field: the pilot's evasion steers through. A miss costs a detour of ${span(DEBRIS_DELAY_SECONDS)} and light hull damage.\n- Hostile probe: a quick ship battle, fought with the ship's installed combat gear and its officers. Tougher on hazardous worlds, softened by your Security officer's Cunning. Win: salvage. Loss: the scan pauses ${span(PROBE_REPAIR_SECONDS)} for repairs, with light hull damage.\n- Sensor ghost: the ship's sensors (the Science officer and crew included) read it. A true read finds a bonus discovery on this body; a false one costs a re-scan of ${span(GHOST_RESCAN_SECONDS)}.\n- Cloaked vessel: ${pct(GHOST_CLOAKED_CHANCE)} of sensor ghosts are a cloaked ship, a tougher fight than a probe. Good sensors let the ship strike first; poor ones let it strike you first. Win: richer salvage. Loss: a repair pause of ${span(CLOAKED_REPAIR_SECONDS)} and more hull damage.\n- Radiation storm: shields and Engineering ride it out. If they do not, the scan slows for ${span(STORM_SLOW_SECONDS)}.\n- Supply cache: a small find, no check needed (never at a ${GAS_GIANT}).\nA better ship and crew raise every check, each step a little less than the last, but nothing is ever certain. A Lure Beacon on the expedition raises the salvage of a won ship battle (see the Field Kits topic).`,
      SHIP_EVENT_TORPEDO_HELP,
      `BOARDING: a hostile probe or cloaked vessel may try to board (${pct(BOARDING_ATTEMPT_CHANCE)} of those encounters). Boarding Defense, from the Security crew and the Ossir, decides whether the crew repels them. Repelled: nothing is lost. Not repelled: the scan pauses ${span(BOARDING_PAUSE_SECONDS)} more, and the boarders take ${pct(BOARDING_CREDIT_LOSS_SHARE)} of the credits the expedition has found so far, never from your bank.`,
      `HULL DAMAGE AND FIELD REPAIR: light hull damage adds up over the run. Once it reaches ${pct(FIELD_REPAIR_DAMAGE_SHARE)} of the hull, the ship repairs on its own, wherever finishes sooner: on the nearest ${planets(FIELD_REPAIR_PLANET_TYPES)} world (${FIELD_REPAIR_TIME_MULT === 2 ? "twice" : `${FIELD_REPAIR_TIME_MULT} times`} the Shipyard's time, plus ${span(IN_SYSTEM_LEG_SECONDS)} each way when that world is not the body it is at), or in orbit where it is (${ORBIT_REPAIR_TIME_MULT === 3 ? "three times" : `${ORBIT_REPAIR_TIME_MULT} times`}); a tie goes to orbit. The repair pauses the scan, as a pickup does, while your teams keep working. Any damage left when the ship gets home goes to the Shipyard, and a damaged ship cannot launch another expedition until it is repaired.`,
      `ORDERING A FIELD REPAIR: you need not wait for ${pct(FIELD_REPAIR_DAMAGE_SHARE)}. While the ground operations run and the hull is damaged, the Ship lane of the expedition's team timelines shows the hull and an Order field repair button, with where the ship would repair and for how long before you tap. One tap orders it, free, for all the damage the ship carries then; if the ship is away on a pickup, it starts when the ship is back. Until the repair is done, Cancel stops it with one tap: the ship comes back to the scan keeping the share it already repaired (it still flies back from a world it set down on), and you can order it again.`,
      "The Subspace Telescope cannot forecast a sensor ghost's bonus discovery (see the Subspace Telescope topic).",
    ].join("\n\n"),
  },
  {
    // 0.14.0 Gas Giant Study GG-8: the ship-side study, the nebula sweep and the giant classes (gasGiantStudy.ts).
    id: "gasGiants",
    title: "Gas Giants and Nebulae",
    body: GAS_GIANT_PARAGRAPHS.join("\n\n"),
  },
  {
    // 0.14.0 Gas Giant Study GG-8: the probe's three lines on a study (gasGiantStudy.ts studyProbe, the dive).
    id: "galileoProbe",
    title: GALILEO,
    body: GALILEO_PARAGRAPHS.join("\n\n"),
  },
  {
    // 0.14.0 Gas Giant Study GG-8: the six canisters, their bands, prices and recipes (ITEMS, BLUEPRINTS).
    id: "gasCanisters",
    title: "Gas Storage Canisters",
    body: GAS_CANISTER_PARAGRAPHS.join("\n\n"),
  },
  {
    // 0.14.0 Gas Giant Study GG-8: research data and the Research Lab's data study lane (dataStudy.ts).
    id: "dataStudy",
    title: "Research Data and Data Study",
    body: DATA_STUDY_PARAGRAPHS.join("\n\n"),
  },
  {
    // 0.14.0 Gas Giant Study GG-8: the Ancient Data Fragment, the decode gate and the special blueprints (GG-7).
    id: "ancientData",
    title: "Ancient Data and Special Blueprints",
    body: ANCIENT_DATA_PARAGRAPHS.join("\n\n"),
  },
  {
    // 0.14.0 Gas Giant Study GG-8: the Archive's Survey Log tab (SurveyLogPanel, gasGiantStudyDisplay.ts).
    id: "surveyLog",
    title: "Survey Log",
    body: SURVEY_LOG_PARAGRAPHS.join("\n\n"),
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
    // OT-UI (0.14.0): Overtime on running jobs (OVERTIME_PARAGRAPHS above).
    id: "overtime",
    title: "Overtime",
    body: OVERTIME_PARAGRAPHS.join("\n\n"),
  },
  {
    id: "shipSystems",
    title: "Ship Systems",
    body: `Every ship has four equipment slots (Cargo Bay, FTL Drive, Reactor Core, and a Spec Utility slot for the hull's specialization) and comes pre-installed with a Standard-Issue baseline in each, so a bare ship is always ready to fly. Research ship-system blueprints at the Research Lab, craft them at the Fabricator, then open the ship on the Ships tab, where its Ship Systems board lets you install them. Crafted systems are real upgrades over the baseline: each carries a quality grade (0 to 5), a rarity, and an item level that together set how much it boosts the ship. A Reactor Core is crafted with its fuel: every Reactor Core blueprint takes Deuterium Canisters (${BLUEPRINTS.balancedCoreBp.recipe.inputs.deuteriumCanister} for a Balanced Core, ${BLUEPRINTS.efficientCoreBp.recipe.inputs.deuteriumCanister} for an Efficient Core and ${BLUEPRINTS.highOutputCoreBp.recipe.inputs.deuteriumCanister} for a High-Output Core), and a core you already crafted keeps running without them. Install or uninstall in one tap and watch the ship's stats change. Uninstalling leaves that slot EMPTY and returns the piece to your spares, so nothing is ever lost and you can put it back (or install something else) whenever you like. If a baseline ever does leave your hands (you salvage it yourself, or the auto-salvage rules take one), a replacement Standard-Issue is free: the Quartermaster, in Facilities, issues one for any slot at no cost, so an empty slot is an errand rather than a dead end. The same Ship Systems board also holds a combat hull's combat slots (weapon hardpoints, a shield slot, a hull-plating slot, and, on a carrier, drone bays); see the Combat Gear topic for installing those. Its Power bar and Modules row are covered in the Power and modules topic.`,
  },
  {
    // Complement CP-13 (OC-13): the bridge and quarters modules' hull-family bonuses, every number from the catalog.
    id: "hullBonuses",
    title: "Hull bonuses",
    body: HULL_BONUS_HELP,
  },
  {
    // Complement CP-14 (OC-16, OC-20, OC-21): the hulls' base sensors and the Science amplification, numbers from the engine.
    id: "sensors",
    title: "Sensors",
    body: SENSORS_HELP,
  },
  {
    // E-MOD EM-10 (0.14.0): the power budget (EM-1 to EM-4) and the universal modules (EM-5 to EM-7), as the Ship
    // Systems board shows them (the signed-off mockup's Power bar and Modules row).
    id: "powerAndModules",
    title: "Power and modules",
    body: [
      "Every ship has a power budget. Its Ship Systems board (open the ship on the Ships tab) shows it as the Power bar: Power N / M is the net draw against the output.",
      "- Output is the hull's own power, plus a crafted Reactor Core, plus any module that adds power (the Auxiliary Capacitor). The legend under the bar lists each part.",
      `- Draw is what every installed system uses. An FTL drive draws x${DRIVE_CLASS_POWER_DRAW_MULT} more for each drive class above Class I, and its tile shows that draw.`,
      "- Power efficiency (a Reactor Overdrive Engineering officer, Power Discipline, Martian crew) cuts the net draw. The cut is the hatched part of the bar.",
      "- Reactor Core power the systems leave unused is the shaded end of the bar. It speeds the drive, and a Reactor Core never makes a ship slower than the Standard-Issue one.",
      "An install that would put the ship over its output is refused, and the reason names the power it still needs. If a ship ends up over budget anyway (an Engineering officer left, a Reactor Core came off), nothing is switched off or removed. The bar turns amber, the chip shows how far over it is and the strength it fights at, and in combat its weapons and shield recharge run weaker: gently, growing with the shortfall, never below " +
        `${POWER_SUPPLY_FLOOR_PERCENT}%. Only installs that would make the shortfall worse are refused, so you can always climb back.`,
      `Modules are small accessories. Research their blueprints at the Research Lab (from ${tier(FIRST_MODULE_TIER)}), craft them at the Fabricator (its Modules group), and find them in Logistics under Ship Equipment (Modules). A hull's module slots are shared with its Spec Utility, which shows as the first tile in the Modules row; the Bridge Module, Crew Quarters and Sensor Suite keep their own slots.`,
      "- Install a module from an empty tile in the Modules row, or with Install on... from the piece itself. Remove takes one off and leaves the slot empty.",
      "- A ship carries one of each module, and its modules change only while it is home, like all ship gear.",
      "- Passive modules are always on. A Proc has a chance each time its trigger happens (a hit taken, an extraction cycle). A Conditional acts while its condition holds (the hull running low). An Active casts itself by its one preset rule, with no editor. A Set acts while both pieces of its pair are installed on the same ship.",
      // E-MOD EM-8: the Special (the Precursor Lens), every number read from the engine.
      `- A Special is a discovery's payoff. Identifying a Precursor Lens relic opens the Precursor Lens blueprint (crafted with a Precursor Circuit). Installed, it gives each body an expedition scans a ${pct(LENS.chance)} chance to uncover one extra hidden discovery; better rarity and quality raise that chance. It draws ${LENS.powerDraw} power.`,
      "- Tap a module tile for what it does, when it acts and its power draw.",
    ].join("\n"),
  },
  {
    id: "combatGear",
    title: "Combat Gear",
    body: "Combat gear is the weapons, shield emitters, hull plating, and drone pods that decide how a warship fights. All four are craftable ship systems: research a blueprint at the Research Lab, fabricate it at the Fabricator, then install it onto a ship. Every ship starts with a free Standard-Issue set in each combat slot, so a hull is never unarmed even before you craft anything. You install combat gear on the ship's Ship Systems board (open the ship on the Ships tab), the same board used for the Cargo, FTL, Reactor, and Spec Utility slots. Every hull has weapon hardpoints (how many depends on the hull; purpose-built warships carry the most), one shield slot, one hull-plating slot, and, on a carrier only, drone bays for its drone pods. To install a piece, tap an empty slot, hardpoint, or bay, then tap a spare from the pool that opens; tap an installed piece to uninstall it, which leaves that slot bare and returns the piece to your spares (this is the same for every slot on the ship, combat and economy alike). Crafted gear is a real upgrade over the Standard-Issue floor: each piece carries a quality grade, a rarity, and an item level, and by the middle item levels good crafted weapons, shields, plating, and drone pods clearly outclass the baseline, raising both your survivability and your firepower.",
  },
  {
    // 0.14.0 gear wear step 5: how gear wears and recovers (GEAR_WEAR_PARAGRAPHS above).
    id: "gearWear",
    title: "Gear wear",
    body: GEAR_WEAR_PARAGRAPHS.join("\n\n"),
  },
  {
    id: "quartermaster",
    title: "Quartermaster",
    body: `The Quartermaster, in Facilities, is the fleet's supply counter. Its Requisition tab issues Standard-Issue patterns free, one row per slot that has a baseline: the four economy slots (Cargo Bay, FTL Drive, Reactor Core, Prospecting Rig) and the combat slots (a weapon, a shield emitter, hull plating, and a drone pod). Take one and it lands in your spare systems, ready to install from a ship's Ship Systems board. It costs nothing and takes no time, because the point of the counter is that an empty slot can always be filled: a ship missing a weapon, a shield emitter, or hull plating cannot launch a patrol, so a free replacement turns that from a dead end into an errand. What you get is the FLOOR and never more. An economy baseline is stat-neutral (a ship carrying one performs exactly as a bare hull does), and a combat baseline restores the hull's own starting numbers rather than adding to them, so nobody gains power by visiting: you only get back to where a new ship starts. The weapon issued here is the same workhorse gun every hull is built with, not a pick from the weapon roster. Real gains come from researching and crafting your own systems. The counter issues one spare of each pattern at a time; install it and it will issue another, and a spare already queued for salvage, or sitting in an Armory loadout, does not count against you. The Quartermaster has no level and nothing to upgrade, so there is nothing to found. Its Sell tab buys stock back for credits (today ${SELL_COUNTER_TEXT}), and its Purchase tab sells field kits for credits (see the Field Kits topic). A purchase never goes over the Warehouse cap.`,
  },
  {
    id: "storage",
    title: "Storage",
    body: "Your stock lives on the Logistics tab. Materials holds your raw ores, refined goods, components, and salvaged materials, grouped into themed sections (Ores and Metals, Volatiles, Organic Compounds, Recovered Tech, Refined, Components, Gas Storage Canisters, and Salvaged Materials) and split by tier. Research data has no shelf here: the Research Lab's Data study tab holds it (see the Research Data and Data Study topic). Ship Equipment holds your spare ship systems (crafted combat gear such as weapons and drone pods, and crafted modules, included) and your field kits (see the Field Kits topic), and Crafted Blanks holds unrolled crafts waiting to be inspected. Each item shows a fill gauge for how full its cap is. Storage has caps, so producers automatically pause when a material is full instead of wasting output, and you can raise a cap with a timed upgrade at the Warehouse, in Facilities. Your spare ship systems have their own cap, shown at the top of Ship Equipment, which you raise with a timed Systems Bay upgrade. Gear in an Armory loadout does not count against it.",
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
    body: `Fuel is no longer something you mine, refine, or buy. Refueling is instant and free, so the only thing fuel decides is REACH: how far a ship can fly on one round trip, measured in lightyears (LY). Each hull has its own reach, set by its fuel capacity and engine efficiency, and an installed FTL Drive with Fuel Capacity or Fuel Efficiency stats extends it. Every mission and patrol has a round-trip distance in LY, and a ship can only be dispatched on a trip its reach covers. Mission and patrol cards show the trip distance, the dispatch windows show it next to the ship's range (installed gear included), and a trip beyond a ship's reach is flagged before you send it, with the reason. The old fuel tank, Buy Fuel and the Local Deuterium Skim run are retired, and Deuterium Ice is no longer FTL fuel: the Cometary Ice Harvest brings it in, the Refinery presses it into Deuterium Canisters for ${DEUTERIUM_CANISTER_USES}, and it still sells at the Quartermaster's Sell counter. The Fuel Depot, in Facilities, now extends REACH instead: every level it is upgraded adds ${Math.round(FUEL_DEPOT_REACH_PER_RUNG * 100)}% to the reach of every ship in the fleet, missions, patrols and expeditions alike.\n\nDEEP-SPACE REACH: an expedition measures reach the same way, then multiplies it by the ship's drive class (${mult(DRIVE_CLASS_REACH_MULT[1])} at Class I up to ${mult(DRIVE_CLASS_REACH_MULT[DRIVE_CLASS_MAX])} at Class ${numeral(DRIVE_CLASS_MAX)}), so an explorer reaches far past its mission range. Each system's round trip (twice its distance from your homeworld) must be within it; Engineering's Constitution stretches it on long voyages. See the Expedition Tiers topic.`,
  },
  {
    id: "offline",
    title: "Offline Progress",
    body: `Your fleet keeps working while the game is closed, the tab is in the background, or your device is asleep. When you come back, the time you were away is paid exactly as if you had been watching: missions finish, queues run, and captains earn XP. Offline progress pays up to ${formatOfflineCap(OFFLINE_CAP_SECONDS_BASE)} per absence; anything past that is not counted, so check in at least that often to keep everything running. After a longer absence, the While You Were Away recap shows how long your fleet actually ran, names the cap, and tells you plainly when the cap was reached. The game also checks the time with the server, so a device clock set forward pays nothing extra: any time it cannot confirm yet is held and paid once the clock is confirmed, still within the same cap.`,
  },
  {
    id: "homeworld",
    title: "Homeworld",
    body: "Homeworld talents are your fleet-wide upgrades, opened with the Talents button on the Crew tab's Admiral page. They unlock and improve capabilities across the whole fleet, such as extra captain slots, deeper order queues, and better salvage odds. Your production facilities (the Refinery, Fabricator, and Research Lab) live in Facilities. Once your first refugee arrives, each facility shows a Posts row where the people your evacuations bring home work to make it better (see the Refugees topic). As the game grows, more of your empire management will be anchored at the Homeworld.",
  },
  {
    id: "combat",
    title: "Battlespace",
    body: "Battlespace is the home of ship combat. Combat runs today as Combat Patrols, launched from the Ops tab: you send a captain and their assigned ship (any hull can patrol, though a purpose-built destroyer, battleship, or carrier is far stronger) to sweep a pirate faction's territory, fight a short series of seeded enemy waves, and return with loot and bounty. How a ship performs is driven by the combat gear you install on it, its weapons, shield emitter, hull plating, and (on a carrier) drone pods, rather than by fixed per-hull numbers, so crafting and installing better gear directly makes your ships hit harder and last longer (see the Combat Gear topic). You can open the Combat View to watch a patrol fight live, or let it resolve on its own while you are away and read the recap when you get back. Ships wear down in a fight, weapons, reactor, and drive lose durability, and a lost patrol limps home flagged damaged, to be repaired at the Shipyard before it can fight again. See the Combat Patrols and Combat View topics for the details. The reserved Battlespace (PvE) and Battlespace (PvP) tabs in Ops are the future home of a deeper, interactive turn-based battle mode.",
  },
];
