import { describe, it, expect } from "vitest";
import { DEUTERIUM_CANISTER_USES, DEUTERIUM_DRIVE_MIN_CLASS, FIELD_DEVICES_PARAGRAPH, GAS_CANISTER_PARAGRAPHS, HELP_TOPICS, SELL_COUNTER_TEXT, TRAINING_RUNS_PARAGRAPH, TRAINING_WEAR_SENTENCE } from "./helpTopics";
import { gatheringTrainingStamp } from "./game/gearWearEngine";
import { OVERTIME_CREDITS_PER_MINUTE, OVERTIME_MAX_STEPS as OT_MAX, OVERTIME_STEP_RATE as OT_STEP } from "./game/processSpeed";

// OC-F12 control (user answers 2026-11-12): the Away-Team Members topic states Set for new hires and Clear as built.
describe("the new-hire default in the Away-Team Members topic (OC-F12)", () => {
  it("states Set for new hires, the merge, Clear and Balanced, and that nobody already hired changes", () => {
    const b = HELP_TOPICS.find((x) => x.id === "awayMembers")!.body;
    expect(b).toContain("NEW HIRES: a Security member you hire starts on the built-in default tactical protocols.");
    expect(b).toContain("pick a Security member with protocols of their own in Away-Team Tactical Protocols (the Ops tab, under Exploration) and press Set for new hires");
    expect(b).toContain("with the built-in cure, heal, brace and grenade rules they lack placed first");
    expect(b).toContain("Clear, or Set for new hires on a member running the Balanced preset, puts new hires back on the built-in default.");
    expect(b).toContain("Members already hired never change.");
    expect(b.includes(String.fromCharCode(0x2014)) || b.includes("-".repeat(2))).toBe(false);
  });
});

// OT-UI (0.14.0, the 2026-11-10 Overtime buttons mockup): the Overtime topic is truthful for every job kind, its numbers
// read from the engine (processSpeed.ts).
describe("the field repair order in the Scan Events topic (OC-F14)", () => {
  it("states the faster rule and the one-tap order and Cancel as built", () => {
    const b = HELP_TOPICS.find((x) => x.id === "scanEvents")!.body;
    expect(b).toContain("wherever finishes sooner");
    expect(b).toContain("a tie goes to orbit");
    expect(b).toContain("ORDERING A FIELD REPAIR");
    expect(b).toContain("Order field repair");
    expect(b).toContain("Cancel stops it with one tap");
    expect(b).toContain("keeping the share it already repaired");
    expect(b).toContain("it still flies back from a world it set down on");
    expect(b).toContain("it starts when the ship is back");
    expect(b).not.toContain("sets down on the nearest");
    expect(b.includes(String.fromCharCode(0x2014))).toBe(false);
    expect(b).not.toMatch(/-{2}|\bfit/);
  });
});

describe("the Overtime topic (OT-UI)", () => {
  it("names every job kind it is offered on, the engine's price rule and its refusals", () => {
    const t = HELP_TOPICS.find((x) => x.id === "overtime");
    expect(t).toBeDefined();
    const b = t!.body;
    expect(b).toContain(`${Math.round(OT_STEP * 100)}% of its normal rate, up to ${OT_MAX} steps`);
    expect(b).toContain(`${OVERTIME_CREDITS_PER_MINUTE} credits for each minute of the job's whole length`);
    for (const where of ["hull build", "hull repair", "blueprint project", "data study", "facility upgrade", "the Docks", "docking bays", "Systems Bay"]) {
      expect(b, where).toContain(where);
    }
    expect(b).toContain("auto-study is off");
    expect(b).toContain("last tick");
    expect(b).toContain("at the normal rate");
    expect(b.includes(String.fromCharCode(0x2014))).toBe(false);
    expect(b).not.toMatch(/-{2}|\bfit/);
  });
});
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
  runDifficultyAt,
} from "./game/runDifficulty";
import { freshState } from "./game/model";
import { TRAINING_RUN_CHIP } from "./trainingRunDisplay";
import { threatAssessment } from "./game/combat/threatAssessment";
import { HELPER_MIN_TIER } from "./game/groundThreat";
import {
  FIELD_REPAIR_DAMAGE_SHARE,
  GROUND_OPS_STUCK_TEXT,
  GROUND_STUCK_LOSSES,
  IN_SYSTEM_LEG_SECONDS,
  OFFLOAD_BASE_SECONDS,
  RELOAD_BASE_SECONDS,
} from "./game/groundOps";
import { GROUND_CONDITIONS, STONESKIN_INJURY_MULT } from "./game/medicalBay";
import { DIFFICULTY_NAMES, DIFFICULTY_WEIGHTS, RISK_FACTOR_NAMES, RISK_GRADE_NAMES, SAFE_NEEDS_MAX_TIER } from "./game/riskFactors";
import { TELESCOPE_DETAIL_NAMES, TELESCOPE_SHIP_LIFT_SENSORS, regionTierNumeral } from "./game/telescope";
import { BOARDING_CREDIT_LOSS_SHARE, BOARDING_PAUSE_SECONDS } from "./game/shipScanEvents";
import { BLIND_LAUNCH_WARNING } from "./expeditionDispatchDisplay";
import type { RegionTier } from "./game/model";
import { AFFIX_DEFS, IMPOSSIBLE_DIFFICULTY_NAME } from "./game/affixes";
import { CLEARING_SITE_RULES, FLORALESS_PLANET_TYPES, HOSTILE_SITE_RULES, LIFELESS_PLANET_TYPES, riskRewardBonus } from "./game/riskFactors";
import { TELESCOPE_SHIP_LIFT } from "./game/telescope";
import { FIELD_REPAIR_PLANET_TYPES } from "./game/groundOps";
import { getPlanetTypeById } from "./game/expeditionContent";
// Field Kits FKR-11.
import { ENEMY_RANKS, ENEMY_RANK_IDS, fightLeadRank } from "./game/enemyRanks";
import { CODEBREAKER_DEVICE_BONUS, CONDITION_LINES, FIELD_DEVICE_MIN_PERCENT, FIELD_DEVICE_SPAN_PERCENT, FIELD_KITS, FIELD_KIT_IDS, FREE_BASIC_FIRST_AID_PER_MEMBER, KIT_CATEGORY_RULES, LURE_SALVAGE_PER_DIAL, SABOTEUR_GRENADE_BONUS, SPLINT_HEAL_ROUNDS } from "./game/fieldKits";
import { GRENADES, GRENADE_IDS } from "./game/fieldKitsGrenades";
import { defaultMemberPack } from "./game/fieldKitsRun";
import { BLEED_ON_HIT_PERMILLE, FEAR_ON_HIT_PERMILLE, FLASH_GRENADES_PER_STRIKER, HEAVY_HIT_FRACTION, NEUROTOXIN_FROM_GRADE } from "./game/fieldKitsConditions";
import { BASIC_DEBUFFS, BLINDNESS_MIN_ROUNDS, BLINDNESS_ROUND_SPAN, GAMBIT_STATUSES, NEUROTOXIN_TURN_LOSS, STONESKIN_BATTLE_RESIST } from "./game/gambit";
import { EQUIPMENT_SLOTS, GRENADE_CARRY_PER_LINE, GRENADE_FUSE_MOVED_CLEAR_CHANCE, GRENADE_THROWS_PER_BATTLE } from "./game/model";
import { ACTION_LABEL, RANK_OPTIONS, SELECTOR_LABEL } from "./gambitEditorDisplay";
import { kitEffectText } from "./fieldKitsDisplay";
// Gas Giant Study GG-8.
import { DEUTERIUM_BURNING_MILLI_J, GAS_CANISTER_IDS, GIANT_CLASSES, HYDROGEN_FUSION_MILLI_J, NEBULA_KINDS, RESEARCH_DATA_ITEM, RESEARCH_FAMILIES, giantClassDisplayName } from "./game/gasGiantContent";
import {
  FAMOUS_NEBULA_KIND,
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
import { DATA_STUDY_LANES, DATA_STUDY_RECIPE_PERMILLE, DATA_STUDY_TICKS, RESEARCH_BOOST_PER, RESEARCH_FAMILY_BY_SLOT, RESEARCH_FAMILY_OVERRIDE, researchBoostSpeed } from "./game/dataStudy";
import { GG7_NUMBERS, SPECIAL_BLUEPRINT_KEYS, SPECIAL_BLUEPRINT_TIER } from "./game/specialBlueprints";
import { TIER_HAUL_MULT } from "./game/riskFactors";
import { BLUEPRINTS, DRIVE_CLASS_BLUEPRINTS, ITEMS, REFINE_RECIPES } from "./game/model";
import { NEBULA_STAGES, SURVEY_LOG_HELP, archiveSubTabs } from "./gasGiantStudyDisplay";
import { decodeLockText } from "./dataStudyDisplay";
// Short-Range Missions G1-7.
import { SHORT_RANGE_CATEGORIES, SHORT_RANGE_CREW_RATING, SHORT_RANGE_SHEETS, SHORT_RANGE_TEMPLATES, SHORT_RANGE_TEMPLATE_KEYS, SHORT_RANGE_WORK, shortRangeTemplateUses } from "./game/shortRange";
import { SHORT_RANGE_BASE_SLOT_TIERS } from "./game/shortRangeBoard";
import { SHORT_RANGE_CATEGORY_VIEW, SHORT_RANGE_TRAINING_NOTE } from "./shortRangeBoardDisplay";
import { FULL_HOLD_FRACTION, GENERAL_QUARTERS_GUEST_PERK, HULL_GUEST_QUARTERS, MISSIONS, MISSION_CONTROL_BOARD_RUNGS, SECONDARY_CAPTAIN_TALENTS, SHIP_TYPES } from "./game/model";
import { LY_PER_TICK } from "./game/fuel";
import { PILOT_CUNNING_RETURN_CUT_TICKS } from "./game/officerStats";
import { crewBuffLabel } from "./game/crewBuffs";
import { SENIOR_STAFF_BONUSES } from "./game/seniorStaffBonuses";
import { EXPEDITION_RELIC_BLANKS_PER_HOUR, SHORT_RANGE_RELIC_RATE_MULT } from "./game/relicBlanks";
import { wiringEntry } from "./game/wiring/registry";
// Refugee Posts E5-7.
import { REFUGEE_BACKGROUNDS, REFUGEE_BACKGROUND_KEYS, REFUGEE_MATCH_SHARE_PER_SKILL, REFUGEE_OFF_MATCH_RATIO, REFUGEE_POSTS_EVERY, REFUGEE_SKILL_SPANS, refugeePostsAt, refugeeShare } from "./game/refugees";
import { REFUGEE_TAPER_K, refugeeArrivalChance } from "./game/refugeeArrival";
import { REFUGEE_FACILITY_LABELS } from "./refugeeDisplay";
import { REFUGEE_BUFF_HELP } from "./helpTopics";
// Expedition Tiers G2-7.
import { ENEMY_SECTOR_WIDTH_PERMILLE, HOMEWORLD_MAX_FROM_SOL_LY, HOMEWORLD_MIN_FROM_SOL_LY, REGION_TIERS, REGION_TIER_NAMES } from "./game/galaxy";
import { EXPEDITION_CANDIDATE_COUNT, FAMOUS_SYSTEM_ONE_IN, TIER_BODY_COUNT, recallBlockText } from "./game/expedition";
import { DRIVE_CLASS_MAX, DRIVE_CLASS_REACH_MULT, buildableDriveClassMax, frontierSensorsNeeded } from "./game/propulsion";
import { TIER_TRANSIT_HOURS, TUTORIAL_TRANSIT_SECONDS, VOYAGE_ANOMALY_DETOUR_PERMILLE, VOYAGE_BAND_SCALE_PERMILLE, VOYAGE_FLOOR_SECONDS, tierMinimumDriveClass, tierNominalSeconds } from "./game/voyage";
import { trainingRunTransitSentence } from "./helpTopics";
import { ENEMY_TERRITORY_COMBAT_STEP } from "./game/riskFactors";
const articleFor = (word: string): string => (/^[AEIOU]/i.test(word) ? "an" : "a");
const officer = (id: string): string => SENIOR_STAFF_BONUSES.find((x) => x.id === id)!.label;

describe("HELP_TOPICS", () => {
  it("covers the core systems", () => {
    const ids = HELP_TOPICS.map((t) => t.id);
    for (const sys of ["missions", "refining", "fabricating", "research", "shipyard", "docks", "storage", "salvage", "fuel"]) {
      expect(ids, `missing help topic: ${sys}`).toContain(sys);
    }
  });
  // 0.14.0 objective affixes: the affix system and Reinforcing each have an entry, and the manual says
  // "objective" for ground work, never "task" (user 2026-10-14: "I like objectives over tasks honestly").
  it("explains affixes and Reinforcing, and says objectives, never tasks (0.14.0)", () => {
    const ids = HELP_TOPICS.map((t) => t.id);
    expect(ids).toContain("affixes");
    expect(ids).toContain("reinforcing");
    const affixes = HELP_TOPICS.find((t) => t.id === "affixes")!;
    expect(affixes.body).toMatch(/green is Positive/);
    expect(affixes.body).toMatch(/yellow is Neutral/);
    expect(affixes.body).toMatch(/red is Negative/);
    const reinforcing = HELP_TOPICS.find((t) => t.id === "reinforcing")!;
    expect(reinforcing.body).toMatch(/Impossible/);
    expect(reinforcing.body).toMatch(/countdown/);
    expect(reinforcing.body).toMatch(/Heightened Senses/);
    for (const t of HELP_TOPICS) {
      expect(/\btasks?\b/i.test(t.body), `"task" wording in: ${t.id}`).toBe(false);
      expect(/\u2014|-{2}/.test(t.body), `em dash or double hyphen in: ${t.id}`).toBe(false);
    }
  });
  // 0.14.0 Ground Operations (GO-18) and the squads / telescope manual (SQ-7 section 7.5). Every number the prose
  // states is read from the engine constant that owns it, so these pin that the right constants reach the text.
  describe("Ground Operations, scan events, squads and telescope (0.14.0 GO-18, SQ-7.5)", () => {
    const topic = (id: string) => {
      const t = HELP_TOPICS.find((x) => x.id === id);
      expect(t, `missing help topic: ${id}`).toBeDefined();
      return t!;
    };
    const span = (s: number) => (s % 60 === 0 ? (s === 60 ? "1 minute" : `${s / 60} minutes`) : `${s} seconds`);

    it("has the new topics", () => {
      const ids = HELP_TOPICS.map((t) => t.id);
      for (const id of ["groundTeams", "groundOperations", "returnTrip", "objectiveDifficulty", "riskFactors", "subspaceTelescope", "scanEvents"]) {
        expect(ids, `missing help topic: ${id}`).toContain(id);
      }
      expect(new Set(ids).size, "duplicate topic ids").toBe(ids.length);
    });

    it("team types and squads: the three kinds, the minimum, the reserve, the deploy rule, the help toggle", () => {
      const b = topic("groundTeams").body;
      for (const s of ["Ground", "Strike", "Survey", "Alpha", "Bravo", "reserve", "at least one Security and one Science squad", "When done, help other teams"]) {
        expect(b).toContain(s);
      }
      // GO-18 review 7: the help setting can change while the ship is out, from the next launch
      expect(b).toMatch(/renaming and the help setting still work/);
    });

    it("ground operations: queues, persistence, odds tiers, helpers, wipes, back of the line, Stuck and Skip", () => {
      const b = topic("groundOperations").body;
      for (const s of ["Default plan", "Auto-assign randomly", "Skip", "Re-queue", "progress", "relic", GROUND_OPS_STUCK_TEXT]) {
        expect(b).toContain(s);
      }
      // the seven threat tiers by their in-game names, and what a tier means
      for (const w of [10, 8, 6, 4, 2, 1, 0]) expect(b).toContain(threatAssessment(w, 10).name);
      expect(b).toMatch(/in one go/);
      // the helper floor is the engine's tier, by name
      const floor = [10, 8, 6, 4, 2, 1, 0].map((w) => threatAssessment(w, 10)).find((a) => a.tier === HELPER_MIN_TIER)!;
      expect(b).toContain(`${floor.name} or better`);
      expect(b).toContain(`${span(IN_SYSTEM_LEG_SECONDS)} each way`);
      // GO-18 review 2: only the wiped teams of ONE crew share a pickup
      expect(b).toMatch(/one crew/);
      expect(b).not.toMatch(/Teams wiped together on one body share/);
      expect(b).toContain(`${GROUND_STUCK_LOSSES} losses in a row`);
      expect(b).toContain("Return Trip and Medical Bay topic");
      expect(b).toContain("Reinforcing");
    });

    it("return trip: step times, what speeds each, the cure table and Stoneskin, from the engine", () => {
      const b = topic("returnTrip").body;
      expect(b).toContain(`Offload (${span(OFFLOAD_BASE_SECONDS)})`);
      expect(b).toContain(`Reload (${span(RELOAD_BASE_SECONDS)})`);
      for (const s of ["Efficient Unloading", "Rapid Loadout", "Efficient Stowage", "Rapid Recovery", "Reduced Crew Losses", "Stoneskin"]) {
        expect(b).toContain(s);
      }
      for (const id of ["health", "poison", "bleed", "downed"]) {
        const c = GROUND_CONDITIONS[id];
        expect(b).toContain(`- ${c.label}: ${span(c.cureSeconds)}`); // the engine's label, as on the bay card
      }
      expect(b).toContain(`${Math.round((STONESKIN_INJURY_MULT - 1) * 100)}% longer`);
      // GO-18 review 5: the Medical officer's stats the bay reads (medicalBay.ts BAYCARE MAPPING), by name
      expect(b).toMatch(/Medical officer's Constitution and Cunning/);
      expect(b).toMatch(/Integrity/);
      expect(b).not.toMatch(/traits/);
    });

    it("objective difficulty: the five grades with their completion weights", () => {
      const b = topic("objectiveDifficulty").body;
      DIFFICULTY_NAMES.forEach((name, i) => expect(b).toContain(`${name} x${DIFFICULTY_WEIGHTS[i]}`));
      expect(b).toContain("Reinforcing");
      // GO-18 review 4: Reinforcing's required grade and the Impossible name come from affixes.ts
      const required = DIFFICULTY_NAMES[(AFFIX_DEFS.reinforcing.requiredFromDifficulty as number) - 1];
      expect(b).toContain(`${required} combat objectives always carry the Reinforcing affix`);
      expect(b).toContain(`at ${IMPOSSIBLE_DIFFICULTY_NAME} it is held`);
      // GO-18 review 6: one amount, two places: the haul and the relic find bonus
      const deadly = Math.round(riskRewardBonus(DIFFICULTY_NAMES.length) * 100);
      expect(b).toContain(`+${deadly}% at ${DIFFICULTY_NAMES[DIFFICULTY_NAMES.length - 1]}`);
      expect(b).toMatch(/haul/);
      expect(b).toMatch(/same amount is added to its relic find bonus/);
    });

    it("risk factors: the four factors, the five grades, hazard resist combines before the curve", () => {
      const b = topic("riskFactors").body;
      for (const n of Object.values(RISK_FACTOR_NAMES)) expect(b).toContain(n);
      for (const g of RISK_GRADE_NAMES) expect(b).toContain(g);
      expect(b).toMatch(/added together before/);
      // GO-18 review 8: the Science officer's Integrity (Hazard Steady) is a source too
      expect(b).toMatch(/Science officer's Integrity/);
      // GO-18 review 4: grade thresholds and world lists come from riskFactors.ts
      const firstGrade = (permille: readonly number[]) => RISK_GRADE_NAMES[permille.findIndex((p) => p > 0)];
      expect(b).toContain(`At ${firstGrade(CLEARING_SITE_RULES.clearHostiles.permilleByGrade)} or worse it can add a Clear the Hostiles`);
      expect(b).toContain(`At ${firstGrade(CLEARING_SITE_RULES.secureLandingZone.permilleByGrade)} or worse it can add a Secure the Landing Zone`);
      expect(b).toContain(`a body at ${firstGrade(HOSTILE_SITE_RULES.enemyColony.permilleByCombat)} ${RISK_FACTOR_NAMES.combat} or worse can hold an Enemy Colony`);
      expect(b).toContain(`a body at ${firstGrade(HOSTILE_SITE_RULES.enemyFortification.permilleByCombat)} ${RISK_FACTOR_NAMES.combat} or worse can hold an Enemy Fortification`);
      for (const id of [...LIFELESS_PLANET_TYPES, ...FLORALESS_PLANET_TYPES]) expect(b).toContain(getPlanetTypeById(id)!.label);
    });

    // Safe first runs SF-6: the "Training runs and rising risk" paragraph, every number read from runDifficulty.ts.
    it("training runs and rising risk: the training run, the safe patrol and the curve, from the constants", () => {
      const b = topic("riskFactors").body;
      expect(b).toContain(TRAINING_RUNS_PARAGRAPH);
      const p = TRAINING_RUNS_PARAGRAPH;
      const pc = (f: number) => `${Math.round(f * 100)}%`;
      expect(p).toMatch(/^TRAINING RUNS AND RISING RISK: /);
      for (const hull of ["Orion", "Aurora", "Eir"]) expect(p).toContain(hull);
      expect(p).toContain(`"${TRAINING_RUN_CHIP}" chip`);
      expect(p).toContain(`its guards fight at ${pc(FIRST_RUN_ENEMY_SCALE)} strength with at most ${FIRST_RUN_MAX_ENEMIES === 1 ? "one enemy" : FIRST_RUN_MAX_ENEMIES} per fight`);
      expect(p).toContain(`at most ${FIRST_PATROL_WAVES} waves of one ship each`);
      expect(p).toContain(`expedition guards start at ${pc(RAMP_FLOOR)} of full strength`);
      expect(p).toContain(`patrol enemies at ${pc(PATROL_RULES_RAMP_FLOOR)}`);
      expect(p).toContain(`full strength after ${N_FULL - 1} completed runs`);
      expect(p).toContain(`reach full strength ${RAMP_ODDS_LAG === 1 ? "one run" : `${RAMP_ODDS_LAG} runs`} later`);
      for (const [t, c] of Object.entries(TIER_ENCOUNTER_HAZARD_CEILING)) expect(p).toContain(`${pc(c!)} at Tier ${regionTierNumeral(Number(t) as RegionTier)}`);
      expect(p).toContain(`At Tier ${regionTierNumeral(RAMP_MAX_TIER)}, expedition guards`);
      // Review fix: the Tier II claim matches the engine. An expedition above Tier I is never the training run and reads
      // full strength from its first run; a short-range template keeps its training run at Tier II (its smallest roll),
      // so the sentence names expeditions only, and the short-range line says "at any tier".
      const fresh = freshState();
      const t2 = (RAMP_MAX_TIER + 1) as RegionTier;
      expect(runDifficultyAt(fresh, "expedition", t2, "orion")).toMatchObject({ firstRun: false, ramp: 1 });
      expect(runDifficultyAt(fresh, "shortRange", t2, "telescopeRepair").firstRun).toBe(true);
      expect(p).toContain(`From Tier ${regionTierNumeral(t2)} on, every expedition is at full strength from your first one there`);
      expect(p).not.toMatch(/every run is at full strength/);
      expect(p).toContain("short-range mission type is its smallest, at any tier");
      expect(TIER_ENCOUNTER_HAZARD_CEILING[t2]).toBeDefined(); // Tier II still caps the hazard: the paragraph prints it
      // Veteran status is per run type (veteranRunCountsV70).
      expect(p).toContain("already at full strength for that run type");
      // The Objective Difficulty topic points to it.
      expect(topic("objectiveDifficulty").body).toMatch(/see the Risk Factors topic, under Training runs and rising risk/);
    });

    // Safe first runs SF-7 (user OC-W9 "No wear on training"): the wear sentence, each clause read against the engine
    // (the live proofs: gearWearEngine.test.ts expedition and short-range training, gearWearCombat.test.ts the training
    // patrol cycle, gatheringTrainingWearGoldens.test.ts the first gathering delivery).
    it("training runs and wear: the sentence is in the paragraph and the first gathering dispatch is marked", () => {
      expect(TRAINING_RUNS_PARAGRAPH).toContain(TRAINING_WEAR_SENTENCE);
      expect(TRAINING_WEAR_SENTENCE).toMatch(/no wear on a training run, nor on the first delivery of your first gathering mission/);
      expect(gatheringTrainingStamp(freshState(), { version: 1 })).toEqual({ version: 1, training: 1 });
      expect(TRAINING_WEAR_SENTENCE).not.toMatch(/\u2014|-{2}|\bfit/);
    });

    it("telescope: every detail level, the ship's lift, blind launches, the ghost caveat", () => {
      const b = topic("subspaceTelescope").body;
      for (const n of TELESCOPE_DETAIL_NAMES.slice(1)) expect(b).toContain(n);
      expect(b).toContain(BLIND_LAUNCH_WARNING);
      expect(b).toContain(`${TELESCOPE_SHIP_LIFT_SENSORS} or more`);
      expect(b).toContain(`Tier ${regionTierNumeral((SAFE_NEEDS_MAX_TIER + 1) as RegionTier)}`);
      expect(b).toMatch(/sensor ghost/i);
      expect(b).toContain(`lift the reading ${TELESCOPE_SHIP_LIFT === 1 ? "one level" : `${TELESCOPE_SHIP_LIFT} levels`}`);
      // GO-18 review 1: the current composition's shortfall is on the Recommendation line; the Forecast is of the
      // recommended composition (expedition.ts launchForecast(rec.kinds))
      const line = (name: string) => b.split(/\r?\n/).find((l) => l.startsWith(`- ${name}:`)) ?? "";
      expect(line(TELESCOPE_DETAIL_NAMES[4])).toMatch(/current composition would leave unfinished/);
      expect(line(TELESCOPE_DETAIL_NAMES[5])).toMatch(/recommended composition/);
      expect(line(TELESCOPE_DETAIL_NAMES[5])).not.toMatch(/current composition/);
    });

    it("scan events: the four events, the cloaked vessel, supply caches, boarding and field repair", () => {
      const b = topic("scanEvents").body;
      for (const s of ["Debris field", "Hostile probe", "Sensor ghost", "Cloaked vessel", "Radiation storm", "Supply cache", "Boarding Defense"]) {
        expect(b).toContain(s);
      }
      expect(b).toContain(`${Math.round(BOARDING_CREDIT_LOSS_SHARE * 100)}% of the credits`);
      expect(b).toContain(`${span(BOARDING_PAUSE_SECONDS)}`);
      expect(b).toContain(`${Math.round(FIELD_REPAIR_DAMAGE_SHARE * 100)}%`);
      for (const id of FIELD_REPAIR_PLANET_TYPES) expect(b).toContain(getPlanetTypeById(id)!.label);
    });

    it("keeps the cross-links between the new topics and the affix topics", () => {
      expect(topic("groundOperations").body).toContain("Objective Affixes topic");
      expect(topic("objectiveDifficulty").body).toContain("Reinforcing (affix) topic");
      expect(topic("subspaceTelescope").body).toContain("Risk Factors topic");
      expect(topic("scanEvents").body).toContain("Subspace Telescope topic");
      expect(topic("groundTeams").body).toContain("Ground Operations topic");
      // every "the X topic" reference in the manual names a topic that exists
      const titles = new Set(HELP_TOPICS.map((t) => t.title));
      for (const t of HELP_TOPICS) {
        for (const m of t.body.matchAll(/(?:the|see) ([A-Z][A-Za-z() -]+?) topic\b/g)) {
          expect(titles.has(m[1]), `"${m[1]}" in ${t.id} is not a topic title`).toBe(true);
        }
      }
    });
  });

  // Field Kits FKR-11: the Field Kits and Enemy Ranks topics, and the Field Kits lines in the older topics. Every number
  // and name is read from the engine constant (or the screen's label) that owns it, so these pin that the right ones
  // reach the text, and each claim below was checked against the engine that enforces it.
  describe("Field Kits and Enemy Ranks (0.14.0 FKR-11)", () => {
    const topic = (id: string) => {
      const t = HELP_TOPICS.find((x) => x.id === id);
      expect(t, `missing help topic: ${id}`).toBeDefined();
      return t!;
    };
    const pc = (f: number) => `${Math.round(f * 100)}%`;
    const span = (s: number) => (s % 60 === 0 ? (s === 60 ? "1 minute" : `${s / 60} minutes`) : `${s} seconds`);

    it("has both topics, cross-linked to each other and from the topics they touch", () => {
      expect(topic("enemyRanks").title).toBe("Enemy Ranks");
      expect(topic("fieldKits").title).toBe("Field Kits");
      expect(topic("enemyRanks").body).toContain("see the Field Kits topic");
      expect(topic("fieldKits").body).toContain("see the Enemy Ranks topic");
      expect(topic("objectiveDifficulty").body).toContain("see the Enemy Ranks topic");
      for (const id of ["returnTrip", "quartermaster", "storage", "fabricating"]) expect(topic(id).body, id).toContain("see the Field Kits topic");
    });

    it("enemy ranks: every rank's multiplier, the leads by grade, and no Elite or Boss on a training run", () => {
      const b = topic("enemyRanks").body;
      for (const r of ENEMY_RANK_IDS) expect(b).toContain(`${ENEMY_RANKS[r].label} x${ENEMY_RANKS[r].mult}`);
      expect(b).toMatch(/HP, its power and its healing/);
      // The engine's placement (fightLeadRank) for each grade's final and earlier fight points, as the text states it.
      const lead = (grade: number, pointIndex: number) => fightLeadRank({ grade, pointIndex, fightPointCount: 3, kind: "point", trainingRun: false });
      expect([1, 2, 3, 4, 5].map((g) => lead(g, 2))).toEqual(["normal", "normal", "elite", "elite", "boss"]);
      expect([1, 2, 3, 4, 5].map((g) => lead(g, 0))).toEqual(["normal", "normal", "normal", "strong", "normal"]);
      expect(b).toContain(`${DIFFICULTY_NAMES[2]} and ${DIFFICULTY_NAMES[3]} objectives end with an Elite, and ${DIFFICULTY_NAMES[4]} objectives end with a Boss`);
      expect(b).toContain(`every earlier fight point of ${DIFFICULTY_NAMES[3]} objectives is led by a Strong enemy`);
      expect(b).toContain(`${DIFFICULTY_NAMES[0]} and ${DIFFICULTY_NAMES[1]} objectives, ambushes and Reinforcing reinforcements have no leader`);
      for (const kind of ["surprise", "reinforcement"] as const) expect(fightLeadRank({ grade: 5, pointIndex: 2, fightPointCount: 3, kind, trainingRun: false })).toBe("normal");
      // The training run: every fight Normal (the guard's lead), the claim the user asked for.
      expect(b).toContain("a training run fields no Elite and no Boss");
      for (let g = 1; g <= 5; g += 1) expect(fightLeadRank({ grade: g, pointIndex: 2, fightPointCount: 3, kind: "point", trainingRun: true })).toBe("normal");
      expect(b).toContain(`"${RANK_OPTIONS.find((o) => o.value === "elite")!.label}"`);
      expect(b).toContain(`"${RANK_OPTIONS.find((o) => o.value === "boss")!.label}"`);
    });

    it("field kits: every kit's effect line, the Medical Training gate and the effectiveness from the catalog", () => {
      const b = topic("fieldKits").body;
      for (const id of FIELD_KIT_IDS) expect(b).toContain(`- ${FIELD_KITS[id].label}: ${kitEffectText(id)}`);
      expect(b).toContain(`${pc(KIT_CATEGORY_RULES.firstAid.untrained)} strength without Medical Training`);
      expect(b).toContain(`${pc(KIT_CATEGORY_RULES.firstAid.trained)} with it`);
      expect(b).toContain("Splint, Trauma Kit and Injury Kit need a member with Medical Training");
      expect(b).toContain(`Inspired deals ${pc(GAMBIT_STATUSES.inspired.magnitude)} more damage`);
    });

    it("field kits: per-member packs, the free set, the top-up and the claim", () => {
      const b = topic("fieldKits").body;
      expect(b).toContain("every Security member packs their own kits");
      expect(defaultMemberPack(false)).toEqual({ firstAidKit: 1, antitoxin: 1, combatStim: 1 }); // "one of each kit they can use"
      expect(b).toContain("one of each kit they can use");
      expect(b).toContain(`${FREE_BASIC_FIRST_AID_PER_MEMBER === 1 ? "1 First Aid Kit" : `${FREE_BASIC_FIRST_AID_PER_MEMBER} First Aid Kits`}, and more the larger the ship's Medical and Operations crew`);
      expect(b).toMatch(/refills every time the crew lands, at every objective and on every trip/);
      expect(b).toContain('"Top up from the Quartermaster at launch" switch at dispatch, off by default');
      expect(b).toMatch(/buys only what the team's packs are still short/);
      expect(b).toMatch(/even past the Warehouse cap; spent ones do not/);
      expect(b).toMatch(/Science squads never fight, so they carry nothing/);
    });

    it("field kits: grenade charges, the throw per battle, the carry line, the fuse and Saboteur from the varieties", () => {
      const b = topic("fieldKits").body;
      expect(GRENADE_IDS.length).toBeGreaterThan(0);
      for (const key of GRENADE_IDS) {
        const g = GRENADES[key];
        const label = EQUIPMENT_SLOTS.memberTool.varieties.find((v) => v.key === key)!.label;
        expect(g.charges.perBattle, key).toBe(GRENADE_THROWS_PER_BATTLE); // the text states one per-battle limit for all
        expect(b).toContain(`- ${label}: ${g.charges.perObjective} charges, ${pc(g.powerMult)} of the thrower's power`);
        expect(b).toContain(`${label}: `);
      }
      expect(b).toContain(`at most ${GRENADE_THROWS_PER_BATTLE === 1 ? "1 grenade" : `${GRENADE_THROWS_PER_BATTLE} grenades`} per battle`);
      expect(b).toContain(`Each Carry Capacity line rolled on a grenade adds ${GRENADE_CARRY_PER_LINE === 1 ? "1 charge" : `${GRENADE_CARRY_PER_LINE} charges`}`);
      expect(b).toContain(`(${pc(GRENADE_FUSE_MOVED_CLEAR_CHANCE)}), but a foe standing alone never does`);
      expect(b).toContain(`+${pc(SABOTEUR_GRENADE_BONUS)} on their blast and their debuff chance`);
      expect(b).toContain(`${ACTION_LABEL.throwGrenade} tactical protocol rule`);
    });

    it("field kits: the conditions, their severity ranks, their numbers and their inflictors", () => {
      const b = topic("fieldKits").body;
      expect(b).toContain("Fracture, Broken Bone and Shattered Bone: one bone condition in three severity ranks");
      for (const r of CONDITION_LINES.bone) expect(b).toContain(`${pc(GAMBIT_STATUSES[r.id].magnitude)} at ${r.label}`);
      expect(b).toContain("only the medical bay mends a Shattered Bone");
      expect(b).toContain(`Hemorrhage: ${GAMBIT_STATUSES.hemorrhage.magnitude} damage a round for ${GAMBIT_STATUSES.hemorrhage.duration} rounds`);
      expect(b).toContain(`${pc(NEUROTOXIN_TURN_LOSS)} chance to lose each turn`);
      expect(b).toContain(`Concussion: a ${pc(GAMBIT_STATUSES.concussion.magnitude)} chance to lose each turn, for ${GAMBIT_STATUSES.concussion.duration} rounds`);
      expect(b).toContain(`${pc(1 - GAMBIT_STATUSES.blindness.magnitude)} of their usual chance, for ${BLINDNESS_MIN_ROUNDS} or ${BLINDNESS_MIN_ROUNDS + BLINDNESS_ROUND_SPAN - 1} rounds`);
      expect(b).toContain(`a heavy hit (${pc(HEAVY_HIT_FRACTION)} or more`);
      expect(b).toContain(`Bleed (${pc(BLEED_ON_HIT_PERMILLE / 1000)})`);
      expect(b).toContain(`Fear (${pc(FEAR_ON_HIT_PERMILLE / 1000)})`);
      expect(b).toContain(`on ${DIFFICULTY_NAMES[NEUROTOXIN_FROM_GRADE - 1]} and harder objectives`);
      expect(b).toContain(`${FLASH_GRENADES_PER_STRIKER === 1 ? "1 flash grenade" : `${FLASH_GRENADES_PER_STRIKER} flash grenades`} a fight`);
      // Cure's basic list is the battle's own.
      expect(b).toContain(`clears basic debuffs only (${BASIC_DEBUFFS.map((id) => GAMBIT_STATUSES[id].label).slice(0, -1).join(", ")} and ${GAMBIT_STATUSES[BASIC_DEBUFFS[BASIC_DEBUFFS.length - 1]].label})`);
      for (const id of ["hemorrhage", "neurotoxin", "concussion", "fracture", "brokenBone", "shatteredBone"] as const) expect(BASIC_DEBUFFS, id).not.toContain(id);
      expect(b).toContain(`heals in ${SPLINT_HEAL_ROUNDS} rounds and costs no Fracture time in the bay`);
      expect(b).toContain(`land on them ${pc(STONESKIN_BATTLE_RESIST)} less often`);
      expect(b).not.toMatch(/work every battle/);
      expect(b).not.toMatch(/scan events happen less often with a Shroud Emitter and more often with a Lure Beacon while the ship scans/);
      expect(b).toContain("A training run's enemies cause none of these.");
    });

    it("field devices (FKR-8): the per-use roll, Codebreaker, the ground chances and the Lure's salvage, from the engine", () => {
      const b = topic("fieldKits").body;
      const hi = FIELD_DEVICE_MIN_PERCENT + FIELD_DEVICE_SPAN_PERCENT - 1;
      const n = (x: number) => `${Number(x.toFixed(1))}%`;
      expect(b).toContain(FIELD_DEVICES_PARAGRAPH);
      expect(b).toContain(`rolled fresh, from ${FIELD_DEVICE_MIN_PERCENT}% to ${hi}% (${n(FIELD_DEVICE_MIN_PERCENT * (1 + CODEBREAKER_DEVICE_BONUS))} to ${n(hi * (1 + CODEBREAKER_DEVICE_BONUS))} with a Codebreaker anywhere on the expedition)`);
      expect(FIELD_DEVICES_PARAGRAPH).toContain("from 50% to 75% (53% to 79.5% with a Codebreaker");
      expect(FIELD_DEVICES_PARAGRAPH).toContain("40% less at full strength, so 20% to 30% less each roll");
      expect(FIELD_DEVICES_PARAGRAPH).toContain(`pays ${n(40 * LURE_SALVAGE_PER_DIAL * 0.5)} to ${n(40 * LURE_SALVAGE_PER_DIAL * 0.75)} more salvage`);
      expect(FIELD_DEVICES_PARAGRAPH).toMatch(/ambush on a quiet objective, and reinforcements on a Reinforcing one/);
      // D23 stacking and the downed rule as the engine does them (fieldKits.ts STACKING; groundOps.ts healTeam).
      expect(FIELD_DEVICES_PARAGRAPH).toContain("Each extra device adds less than the one before");
      expect(FIELD_DEVICES_PARAGRAPH).toContain("stops counting until the team is healed in the medical bay");
      expect(FIELD_DEVICES_PARAGRAPH).not.toMatch(/they add up/);
      expect(topic("scanEvents").body).toContain("A Lure Beacon on the expedition raises the salvage of a won ship battle");
    });

    it("field kits: Use Item, Ally downed, the rank conditions and the Boss reserve by their editor names", () => {
      const b = topic("fieldKits").body;
      expect(b).toContain(`Add a ${ACTION_LABEL.useItem} rule`);
      expect(b).toContain(`"${SELECTOR_LABEL.allyDowned}" is the Injury Kit's target`);
      expect(b).toContain('"Keep for a Boss" a number: it fires only while the member holds more than that many');
      expect(b).toMatch(/Triage preset, which has kit rules ready/);
      expect(b).toMatch(/odds chips count each team's packs and charges/);
    });

    it("the older topics: the full bay table, the Purchase tab and Ship Equipment's field kits", () => {
      const rt = topic("returnTrip").body;
      for (const c of Object.values(GROUND_CONDITIONS)) expect(rt).toContain(`- ${c.label}: ${span(c.cureSeconds)}`);
      expect(rt).toMatch(/splinted in the fight costs no Fracture time/);
      expect(rt).toContain(`${pc(STONESKIN_BATTLE_RESIST)} less often in the fights`);
      const qm = topic("quartermaster").body;
      expect(qm).not.toMatch(/Coming Soon/i);
      expect(qm).toMatch(/Purchase tab sells field kits for credits/);
      expect(topic("storage").body).not.toMatch(/reserved for later/);
    });
  });

  // Gas Giant Study GG-8: the six topics and the gas giant lines in the older topics. Every number and name is read from
  // the engine table (or the screen's display module) that owns it, so these pin that the right ones reach the text,
  // and each claim was checked against the engine that enforces it.
  describe("Gas giant study (0.14.0 GG-8)", () => {
    const topic = (id: string) => {
      const t = HELP_TOPICS.find((x) => x.id === id);
      expect(t, `missing help topic: ${id}`).toBeDefined();
      return t!;
    };
    const permille = (p: number) => `${Math.round(p) / 10}%`;
    const pc = (f: number) => `${Math.round(f * 100)}%`;

    it("has the six topics, each cross-linked from the topics it touches", () => {
      expect(topic("gasGiants").title).toBe("Gas Giants and Nebulae");
      expect(topic("galileoProbe").title).toBe("Galileo-Class Probe");
      expect(topic("gasCanisters").title).toBe("Gas Storage Canisters");
      expect(topic("dataStudy").title).toBe("Research Data and Data Study");
      expect(topic("ancientData").title).toBe("Ancient Data and Special Blueprints");
      expect(topic("surveyLog").title).toBe("Survey Log");
      const gg = topic("gasGiants").body;
      for (const t of ["Galileo-Class Probe", "Gas Storage Canisters", "Research Data and Data Study", "Survey Log", "Ancient Data and Special Blueprints"]) expect(gg).toContain(`see the ${t} topic`);
      for (const id of ["groundOperations", "riskFactors"]) expect(topic(id).body, id).toContain("see the Gas Giants and Nebulae topic");
      for (const id of ["research", "storage"]) expect(topic(id).body, id).toContain("see the Research Data and Data Study topic");
      expect(topic("scanEvents").body).toContain("Supply cache: a small find, no check needed (never at a Gas Giant)");
      expect(topic("groundOperations").body).toContain("every ship study is done");
      expect(topic("storage").body).toContain("Gas Storage Canisters");
    });

    it("the study: no ground work, its length, the pickup pause and its rewards, from gasGiantStudy.ts", () => {
      const b = topic("gasGiants").body;
      expect(getPlanetTypeById("gasGiant")!.label).toBe("Gas Giant");
      expect(b).toContain("no ground objectives, no hostile sites, no clearing objectives and no supply caches");
      expect(b).toContain(`a study takes ${STUDY_BASE_SECONDS / 60} minutes with no Science member aboard`);
      expect(b).toContain(`never below ${STUDY_MIN_SECONDS === 60 ? "1 minute" : `${STUDY_MIN_SECONDS} seconds`}`);
      expect(b).toContain(`${STUDY_CANISTERS_MIN} to ${STUDY_CANISTERS_MAX}, more when a Galileo-Class Probe dives`);
      expect(b).toContain(`(x${TIER_HAUL_MULT[1]} at Tier I up to x${TIER_HAUL_MULT[7]} at Tier VII)`);
      expect(b).toContain(`Research data, ${permille(STUDY_RESEARCH_DATA_PERMILLE)} of the time`);
      expect(b).toContain(`A Survey Log readout, ${permille(STUDY_SURVEY_READOUT_PERMILLE)} of the time`);
      // the user's pickup pause (2026-10-23) and its pays-off rule (GG-6 pause review)
      expect(b).toMatch(/pauses the study, flies to pick the team up, then goes back and carries on where it left off/);
      expect(b).toMatch(/only when it brings the team aboard sooner than waiting/);
      expect(b).toContain("A pause never changes what the study brings home.");
      expect(b).toContain("An expedition that was already underway when gas giant studies arrived finishes under its old rules.");
    });

    it("giant classes and nebulae: every class's and kind's band odds, the nebula chance and the sweep, from the tables", () => {
      const b = topic("gasGiants").body;
      const odds = (o: Record<string, number>) =>
        (["standard", "augmented", "stellar", "radiant"] as const)
          .filter((k) => o[k] > 0)
          .map((k) => `${o[k]}% ${k[0].toUpperCase()}${k.slice(1)}`)
          .join(", ");
      for (const c of GIANT_CLASSES) expect(b).toContain(`- ${giantClassDisplayName(c)}: ${odds(c.bandOdds)}.`);
      for (const k of NEBULA_KINDS) expect(b).toContain(`- ${k.name}: ${odds(k.bandOdds)}.`);
      expect(b).toContain(`one of ${GIANT_CLASSES.length} classes`);
      expect(b).toContain(`${permille(NEBULA_PERMILLE_BY_TIER[1])} of systems at Tier I, rising to ${permille(NEBULA_PERMILLE_BY_TIER[7])} at Tier VII`);
      expect(b).toContain("the Orion Nebula, the Lagoon Nebula and the Eagle Nebula always hold an emission nebula");
      for (const kind of Object.values(FAMOUS_NEBULA_KIND)) expect(kind).toBe("emissionNebula");
      expect(NEBULA_SWEEP_SECONDS).toBe(7200);
      expect(b).toContain(`the sweep takes 2 hours, needs no squad and no probe, and fills ${NEBULA_CANISTERS_MIN} to ${NEBULA_CANISTERS_MAX} canisters`);
      // Radiant 0 on every kind (no antimatter) and no fragment from a sweep (rollNebulaReward rolls none).
      for (const k of NEBULA_KINDS) expect(k.bandOdds.radiant).toBe(0);
      expect(b).toContain("never an Ancient Data Fragment and never an Antimatter Containment Cell");
      expect(b).toContain("Pickups pause the sweep the same way they pause a study.");
    });

    it("the probe: its three lines, one probe per dive, the ancient data odds from ancientFragmentPermille", () => {
      const b = topic("galileoProbe").body;
      expect(b).toContain(`a Lab tier ${regionTierNumeral(BLUEPRINTS.atmoProbeBp.tier as RegionTier)} blueprint`);
      for (const s of ["- Fieldwork: speeds the study", "- Hazard resist: its crush rating", "- Relic find: the odds of an Ancient Data Fragment", "Tool slot", "with no cap"]) expect(b).toContain(s);
      expect(b).toContain("the probe with the best hazard resist dives (the better relic find breaks a tie)");
      expect(b).toContain("Without a probe the study still runs, from orbit, and still fills its canisters.");
      const at = (t: number, r: number) => permille(ancientFragmentPermille({ region: { tier: t as RegionTier } } as unknown as Parameters<typeof ancientFragmentPermille>[0], r));
      expect(b).toContain(`about ${at(1, 0)} of studies at Tier I with no probe`);
      expect(b).toContain(`to about ${at(7, 0)} at Tier VII`);
      expect(b).toContain(`lifts that to about ${at(1, 1)} at Tier I`);
      expect(at(1, 1)).not.toBe(at(1, 0));
    });

    it("canisters: every canister's band, price and every recipe that takes it, from ITEMS and BLUEPRINTS", () => {
      const b = topic("gasCanisters").body;
      for (const id of GAS_CANISTER_IDS) {
        const item = ITEMS[id];
        const line = b.split("\n").find((l) => l.startsWith(`- ${item.label} (`)) ?? "";
        expect(line, id).toContain(`sells for ${item.sellValue!.toLocaleString("en-US")} credits`);
        expect(line, id).toContain(`(${item.band![0].toUpperCase()}${item.band!.slice(1)})`);
        const uses = Object.keys(BLUEPRINTS).filter((k) => (BLUEPRINTS[k].recipe.inputs[id] ?? 0) > 0);
        expect(uses.length, `${id} has a consumer`).toBeGreaterThan(0);
        for (const k of uses) expect(line, `${id} in ${k}`).toContain(BLUEPRINTS[k].label.replace(/ Blueprint$/, ""));
      }
      expect(b).toContain(`from ${REFINE_RECIPES.refineDeuteriumCanister.input.deuteriumIce!.toString()} Deuterium Ice each`);
      expect(b).toContain("Quartermaster's Sell tab");
    });

    it("the data study lane: types, lane, Auto-study, boosts, the recipe chance and the families, from dataStudy.ts", () => {
      const b = topic("dataStudy").body;
      for (const f of RESEARCH_FAMILIES) expect(b).toContain(ITEMS[RESEARCH_DATA_ITEM[f]].label);
      expect(b).toContain(`in ${RESEARCH_FAMILIES.length} types`);
      expect(DATA_STUDY_LANES).toBe(1);
      expect(b).toContain("one study at a time");
      expect(b).toContain(`Each study takes ${DATA_STUDY_TICKS / 60} minutes`);
      expect(b).toMatch(/Auto-study on \(the default\), the lane starts the oldest held data whenever it is idle/);
      expect(b).toMatch(/the running study holds its countdown/);
      expect(b).toContain(`one boost +${pc(researchBoostSpeed(1))}, two about +${pc(researchBoostSpeed(2))}, four about +${pc(researchBoostSpeed(4))}`);
      expect(pc(researchBoostSpeed(1))).toBe(pc(RESEARCH_BOOST_PER));
      expect(b).toContain(`${permille(DATA_STUDY_RECIPE_PERMILLE)} chance to teach a recipe`);
      // the family map as the text states it (dataStudy.ts RESEARCH_FAMILY_BY_SLOT and the overrides)
      expect(RESEARCH_FAMILY_BY_SLOT).toMatchObject({ ftlDrive: "propulsion", shieldEmitters: "defense", hullPlating: "defense", weapon: "weapons", droneBay: "weapons", reactorCore: "systems", specUtility: "systems", module: "systems", cargoBay: "hullDesign", bridge: "hullDesign", quarters: "hullDesign", sensor: "sensors", memberTool: "field" });
      expect(RESEARCH_FAMILY_OVERRIDE).toMatchObject({ surveyRigBp: "sensors", pathfinderSuiteBp: "sensors" });
      expect(b).toContain("sensor arrays, the Survey Rig and the Pathfinder Suite are Sensors");
    });

    it("ancient data and the special blueprints: the decode gate, each blueprint's entry, tier and numbers", () => {
      const b = topic("ancientData").body;
      for (const key of SPECIAL_BLUEPRINT_KEYS) {
        const name = BLUEPRINTS[key].label.replace(/ Blueprint$/, "");
        expect(b).toContain(`- ${name}: entry ${BLUEPRINTS[key].requiresDecode}, Lab tier ${regionTierNumeral(SPECIAL_BLUEPRINT_TIER[key] as RegionTier)}.`);
        expect(BLUEPRINTS[key].tier).toBe(SPECIAL_BLUEPRINT_TIER[key]);
      }
      expect(b).toContain(`the sweep fills ${pc(GG7_NUMBERS.ramscoopCollector.nebulaSweep)} more canisters and finishes ${1 + GG7_NUMBERS.ramscoopCollector.nebulaSweep} times as fast`);
      expect(b).toContain(`It draws ${GG7_NUMBERS.ramscoopCollector.powerDraw} power`);
      expect(b).toContain(`Augmented and Stellar odds ${pc(GG7_NUMBERS.resonanceSensorArray.canisterBandLift)} higher`);
      expect(b).toContain("Crafted with a Methane Canister");
      expect(b).toContain("Crafted with a Helium-3 Canister");
      expect(b).toContain(decodeLockText(2));
      expect(b).toContain("never a nebula sweep");
      expect(b).toContain("the next entry of the fragment's own culture");
      expect(b).toContain("entries spread across several cultures do not add up");
      expect(BLUEPRINTS.eliteQuartersBp.requiresDecode).toBeUndefined();
      expect(b).toContain(`The Elite Quarters blueprint (Lab tier ${regionTierNumeral(BLUEPRINTS.eliteQuartersBp.tier as RegionTier)})`);
    });

    it("the Survey Log says one place leaves its own entry once, without naming it (G2-7)", () => {
      const b = topic("surveyLog").body;
      expect(b).toContain("One place in the galaxy also leaves an entry of its own, once, when you claim the first expedition that reached it");
      expect(b).not.toMatch(/Wolf|derelict/i);
    });

    it("the Survey Log: the Archive tab, the readout odds, the groups, the star lines and the nebula stages", () => {
      const b = topic("surveyLog").body;
      expect(archiveSubTabs(true).map((t) => t.label)).toEqual(["Archive", "Museum", "Survey Log"]);
      expect(b).toContain("a tab of the Archive, beside the Archive and Museum tabs");
      expect(b).toContain(SURVEY_LOG_HELP);
      expect(b).toContain(`${permille(STUDY_SURVEY_READOUT_PERMILLE)} of the time`);
      expect(b).toContain(`deuterium-burning line (${DEUTERIUM_BURNING_MILLI_J / 1000} Jupiter masses`);
      expect(b).toContain(`hydrogen-fusion line (about ${HYDROGEN_FUSION_MILLI_J / 1000} Jupiter masses`);
      for (const s of NEBULA_STAGES) expect(b).toContain(s);
      expect(b).toMatch(/On a phone, the card of the selected entry shows first/);
    });
  });

  describe("Short-Range Missions (0.14.0 G1-7)", () => {
    const topic = (id: string) => {
      const t = HELP_TOPICS.find((x) => x.id === id);
      expect(t, `missing help topic: ${id}`).toBeDefined();
      return t!;
    };
    const b = () => topic("shortRange").body;
    const lines = () => b().split("\n");
    const whole = (n: number) => Math.round(n).toLocaleString("en-US");
    const tierName = (t: 1 | 2) => `Tier ${t === 1 ? "I" : "II"}`;

    it("has the topic, linked from Operations", () => {
      expect(topic("shortRange").title).toBe("Short-Range Missions");
      expect(topic("operations").body).toContain("see the Short-Range Missions topic");
      expect(topic("operations").body).toContain("open more Short-Range slots");
      expect(b()).toContain("run from the Ops tab under Short-Range");
      expect(b()).toContain("A job can never fail.");
    });

    it("the board: the base slots and each Mission Control rung's slot, gate and price, from the engine", () => {
      expect(SHORT_RANGE_BASE_SLOT_TIERS).toEqual([1, 1]);
      expect(b()).toContain("every save starts with two Tier I slots");
      MISSION_CONTROL_BOARD_RUNGS.forEach((rung, i) => {
        const slot = "addShortRangeSlot" in rung.effect ? rung.effect.addShortRangeSlot : 0;
        const line = lines().find((l) => l.startsWith(`- Mission Control level ${i + 2} opens a ${tierName(slot as 1 | 2)} slot.`)) ?? "";
        expect(line, `rung ${i}`).toContain(`for ${whole(rung.credits?.toNumber() ?? 0)} credits.`);
        for (const [key, n] of Object.entries(rung.requiresMissionCompletions ?? {})) {
          expect(line).toContain(MISSIONS[key as keyof typeof MISSIONS].label);
          expect(line).toContain(`${whole(n as number)} times each`);
        }
      });
      expect(b()).toContain("pre-picks the ready captain whose ship meets the sheet by the widest margin");
    });

    it("the sheet: every tier's six numbers in the board's own names, and the crew rating curve", () => {
      for (const t of [1, 2] as const) {
        const sheet = SHORT_RANGE_SHEETS[t];
        const line = lines().find((l) => l.startsWith(`- ${tierName(t)}: `)) ?? "";
        for (const c of SHORT_RANGE_CATEGORIES) expect(line, `${t} ${c}`).toContain(`${SHORT_RANGE_CATEGORY_VIEW[c].label} ${whole(sheet[c])}${SHORT_RANGE_CATEGORY_VIEW[c].unit}`);
      }
      expect(b()).toContain(`${SHORT_RANGE_CREW_RATING.perDoubling} x log2(1 + strength / ${SHORT_RANGE_CREW_RATING.referenceStrength})`);
      expect(b()).toContain("a ship must meet all of it, even the parts a job does not use");
    });

    it("guest quarters: the hull bases, the Guest Wing, the General perk", () => {
      for (const [k, n] of Object.entries(HULL_GUEST_QUARTERS)) expect(b()).toContain(`${SHIP_TYPES[k as keyof typeof SHIP_TYPES].label} ${n}`);
      expect(b()).toContain("Guest Wing");
      expect(b()).toContain(`installed they rise ${Math.round(GENERAL_QUARTERS_GUEST_PERK * 100)}%`);
      expect(b()).toContain("Guests are not crew and take no crew stations.");
    });

    it("the jobs: every template's label, the categories it uses, its sizes and its pay, from the catalog", () => {
      for (const key of SHORT_RANGE_TEMPLATE_KEYS) {
        const def = SHORT_RANGE_TEMPLATES[key];
        const line = lines().find((l) => l.startsWith(`- ${def.label} (uses `)) ?? "";
        expect(line, key).not.toBe("");
        for (const c of shortRangeTemplateUses(key)) expect(line, `${key} ${c}`).toContain(SHORT_RANGE_CATEGORY_VIEW[c].short);
        for (const size of ["guests", "units", "scan", "engineering", "security"] as const) {
          for (const t of [1, 2] as const) {
            const span = def.rolls[t][size];
            if (span) expect(line, `${key} ${size} ${t}`).toContain(span[0] === span[1] ? `${span[0]}` : `${span[0]} to ${span[1]}`);
          }
        }
        const r = def.reward;
        if (r.kind === "supplyLoop") expect(line).toContain(`${Math.round(r.margin * 100)}% margin`);
        if (r.kind === "contract") expect(line).toContain(`${r.credits[1]} at Tier I, ${r.credits[2]} at Tier II credits`);
        if (r.kind === "pickup" || r.kind === "survey") expect(line).toContain(ITEMS[r.material].label);
      }
      const d1 = SHORT_RANGE_TEMPLATES.refugeeRelocation.rolls[1].distanceLy;
      expect(b()).toContain(`flying ${d1[0]} to ${d1[1]} ly at Tier I`);
    });

    it("a cycle: the travel rate, the scan and work references, the berth", () => {
      expect(b()).toContain(`(${1 / LY_PER_TICK} ticks a lightyear before its transit speed)`);
      expect(b()).toContain(`1 + Sensors / ${SHORT_RANGE_WORK.sensorsReference}`);
      expect(b()).toContain(`1 + rating / ${SHORT_RANGE_WORK.engineeringReference}`);
      expect(b()).toContain("uses a transit berth like a mission unload");
    });

    it("Repeat, Recall and the waits say what the engine does", () => {
      expect(b()).toContain("Repeat until recalled is on by default");
      expect(b()).toContain("a run that has not left home yet ends at once and spends nothing");
      expect(b()).toContain(`a Supply Pickup waits while its ${ITEMS.commonOre.label} is at its Warehouse cap`);
      expect(b()).toContain("nothing is lost while it waits");
    });

    it("training runs and the slow start: the board's own note, the chip, the training run excluded", () => {
      expect(b()).toContain(SHORT_RANGE_TRAINING_NOTE);
      expect(b()).toContain(`"${TRAINING_RUN_CHIP}" chip`);
      expect(b()).toContain("the training run does not count");
    });

    it("what helps: every bonus it names is live on a short-range run in the wiring registry, and what it rules out is out of scope there", () => {
      const live = (id: string) => {
        const e = wiringEntry(id);
        expect(e, id).toBeDefined();
        expect(e!.status.kind, id).toBe("live");
        expect(e!.contexts, id).toContain("mission:shortRange");
      };
      const named: [string, string][] = [
        ["crew:audit:pilotCunningReturn", "The Pilot's Cunning"],
        ["officer:officer.shipOutputMult", officer("xo.commandOutput")],
        ["crew:crew.crewOutputMult", crewBuffLabel("excl.crewOutputMult")],
        ["captain:SECONDARY_CAPTAIN_TALENTS:trade1", SECONDARY_CAPTAIN_TALENTS.trade1.label],
        ["captain:SECONDARY_CAPTAIN_TALENTS:trade2:shortRange", SECONDARY_CAPTAIN_TALENTS.trade2.label],
        ["captain:SECONDARY_CAPTAIN_TALENTS:trade3", SECONDARY_CAPTAIN_TALENTS.trade3.label],
        ["captain:SECONDARY_CAPTAIN_TALENTS:extraction4", SECONDARY_CAPTAIN_TALENTS.extraction4.label],
        ["captain:SECONDARY_CAPTAIN_TALENTS:extraction5", SECONDARY_CAPTAIN_TALENTS.extraction5.label],
        ["captain:SECONDARY_CAPTAIN_TALENTS:commandCrew3", "promotion progress"],
      ];
      for (const [id, words] of named) {
        live(id);
        expect(b(), id).toContain(words);
      }
      expect(b()).toContain(`runs ${PILOT_CUNNING_RETURN_CUT_TICKS === 1 ? "one tick" : `${PILOT_CUNNING_RETURN_CUT_TICKS} ticks`} shorter`);
      for (const k of ["extraction2", "extraction3"] as const) {
        const e = wiringEntry(`captain:SECONDARY_CAPTAIN_TALENTS:${k}`)!;
        expect(e.outOfScope?.some((o) => o.context === "mission:shortRange"), k).toBe(true);
        expect(b()).toContain(SECONDARY_CAPTAIN_TALENTS[k].label);
      }
      for (const id of ["officer:officer.rareFindMult", "crew:crew.rareFindChance"]) expect(wiringEntry(id)!.outOfScope?.some((o) => o.context === "mission:shortRange"), id).toBe(true);
      for (const id of ["flight.transitOut", "flight.transitBack", "ops.unloadSpeed"]) expect(b()).toContain(crewBuffLabel(id));
      expect(b()).toContain(officer("any.veteranInstincts"));
      expect(b()).toContain(`at least ${Math.round(FULL_HOLD_FRACTION * 100)}% full`);
    });

    it("relics: the per-hour rate per tier, from relicBlanks.ts", () => {
      for (const t of [1, 2] as const) {
        const hours = Math.round(1 / (EXPEDITION_RELIC_BLANKS_PER_HOUR * SHORT_RANGE_RELIC_RATE_MULT[t]));
        expect(b()).toContain(`1 every ${hours} hours of mission time at ${tierName(t)}`);
      }
      expect(b()).toContain("see the Relics and the Museum topic");
    });
  });

  describe("Refugees (0.14.0 E5-7)", () => {
    const topic = (id: string) => {
      const t = HELP_TOPICS.find((x) => x.id === id);
      expect(t, `missing help topic: ${id}`).toBeDefined();
      return t!;
    };
    const b = () => topic("refugees").body;
    const lines = () => b().split("\n");
    const tierName = (t: 1 | 2) => `Tier ${t === 1 ? "I" : "II"}`;
    const onePct = (f: number) => `${Number((f * 100).toFixed(1))}%`;

    it("has the topic, linked from the Short-Range and Homeworld (Facilities) topics", () => {
      expect(topic("refugees").title).toBe("Refugees");
      expect(b()).toContain("on the Crew tab under Refugees, which appears once the first person arrives");
      expect(b()).toContain("nobody is ever lost");
      expect(topic("shortRange").body).toContain("see the Refugees topic");
      expect(topic("homeworld").body).toContain("see the Refugees topic");
      expect(topic("homeworld").body).toContain("each facility shows a Posts row");
    });

    it("the Short-Range topic lists eight jobs and says an evacuation can bring someone home", () => {
      expect(SHORT_RANGE_TEMPLATE_KEYS.length).toBe(8);
      const jobLines = topic("shortRange").body.split("\n").filter((l) => SHORT_RANGE_TEMPLATE_KEYS.some((k) => l.startsWith(`- ${SHORT_RANGE_TEMPLATES[k].label} (uses `)));
      expect(jobLines.length).toBe(8);
      expect(topic("shortRange").body).toContain("evacuate people from a nearby world");
      expect(topic("shortRange").body).toContain("an evacuation can bring one named refugee home");
    });

    it("evacuations: the training run, the pay, and each tier's skill span from REFUGEE_SKILL_SPANS", () => {
      const label = SHORT_RANGE_TEMPLATES.evacuation.label;
      expect(b()).toContain(`The first ${label} is a training run and always brings someone.`);
      expect(b()).toContain("it pays the board's normal credits and XP either way");
      for (const t of [1, 2] as const) {
        const [lo, hi] = REFUGEE_SKILL_SPANS[t];
        expect(b(), `tier ${t}`).toContain(`${lo} to ${hi} from a ${tierName(t)} evacuation`);
      }
    });

    it("the taper in words, its halving and quartering read from REFUGEE_TAPER_K and true of the curve", () => {
      expect(b()).toContain("while there are at least as many open posts as people waiting, an evacuation always brings someone home");
      expect(b()).toContain(`${REFUGEE_TAPER_K} more people waiting than open posts halve it, ${3 * REFUGEE_TAPER_K} more quarter it, and it never reaches zero`);
      expect(refugeeArrivalChance(REFUGEE_TAPER_K, 0)).toBe(0.5);
      expect(refugeeArrivalChance(3 * REFUGEE_TAPER_K, 0)).toBe(0.25);
      expect(refugeeArrivalChance(5, 5)).toBe(1);
      expect(refugeeArrivalChance(1e6, 0)).toBeGreaterThan(0);
      expect(b()).toContain("is not a failure");
    });

    it("backgrounds and matches: every background's label, facility and stat, the share per skill and the off-match ratio", () => {
      for (const bg of REFUGEE_BACKGROUND_KEYS) {
        const def = REFUGEE_BACKGROUNDS[bg];
        const line = lines().find((l) => l.startsWith(`- ${def.label}: `)) ?? "";
        expect(line, bg).toContain(`matches ${def.facility === "missionControl" ? "" : "the "}${REFUGEE_FACILITY_LABELS[def.facility]} (${def.statLabel})`);
        expect(line, bg).toContain(REFUGEE_BUFF_HELP[bg]);
      }
      expect(b()).toContain(`a refugee gives ${onePct(REFUGEE_MATCH_SHARE_PER_SKILL)} per point of skill (skill 42 gives +${onePct(42 * REFUGEE_MATCH_SHARE_PER_SKILL)})`);
      expect(refugeeShare({ background: "refiner", skill: 42 }, "refinery")).toBeCloseTo(42 * REFUGEE_MATCH_SHARE_PER_SKILL, 12);
      expect(b()).toContain(`they give ${Math.round(REFUGEE_OFF_MATCH_RATIO * 100)}% of that to the facility they are at`);
    });

    it("every buff the topic names is LIVE in the wiring registry (matched and off match)", () => {
      for (const bg of REFUGEE_BACKGROUND_KEYS) {
        const e = wiringEntry(`facility:REFUGEE_BACKGROUNDS:${bg}`);
        expect(e, bg).toBeDefined();
        expect(e!.status.kind, bg).toBe("live");
        const f = REFUGEE_BACKGROUNDS[bg].facility;
        const off = wiringEntry(`facility:REFUGEE_OFF_MATCH:${f}`);
        expect(off, f).toBeDefined();
        expect(off!.status.kind, f).toBe("live");
      }
    });

    it("posts by facility level from refugeePostsAt, the curve with no cap, and where the rows live", () => {
      const levels: number[] = [];
      for (let lv = 1; levels.length < 4; lv++) if (refugeePostsAt(lv) > refugeePostsAt(lv - 1)) levels.push(lv);
      expect(refugeePostsAt(0)).toBe(0);
      expect(b()).toContain(`opens one post at Level ${levels[0]} and one more every ${REFUGEE_POSTS_EVERY} levels after it (Levels ${levels.slice(0, -1).join(", ")} and ${levels[levels.length - 1]} open the first four)`);
      expect(b()).toContain("A facility that is not built yet has no posts.");
      expect(b()).toContain("Mission Control's posts are on the Ops tab under Mission Control");
      expect(b()).toContain("there is never a cap");
    });

    it("moving is free, swaps pick who, relocations take only the waiting, posted people stay", () => {
      const reloc = SHORT_RANGE_TEMPLATES.refugeeRelocation.label;
      expect(b()).toContain("no cost, no cooldown and no timer");
      expect(b()).toContain("Posting at a full facility is a swap, and you pick who goes back to the waiting list.");
      expect(b()).toContain("Move here");
      expect(b()).toContain("Leave all on the waiting list");
      expect(b()).toContain(`${articleFor(reloc)} ${reloc} job takes one person from the waiting list along to lead the new camp, the one who has waited longest`);
      expect(b()).toContain("With nobody waiting it runs exactly as before.");
      expect(b()).toContain("POSTED PEOPLE ALWAYS STAY: nothing ever takes a posted refugee away.");
    });

    it("says match, never fit, and has no em dash or double hyphen", () => {
      for (const id of ["refugees", "shortRange", "homeworld"]) {
        expect(/\b(fit|fits|fitting|fitted)\b/i.test(topic(id).body), id).toBe(false);
        expect(/—|–|-{2}/.test(topic(id).body), id).toBe(false);
      }
      expect(b()).toContain("a match counts");
    });
  });

  // Expedition Tiers G2-7 (GO-19 item 4): the new topic and the telescope, risk, difficulty and fuel lines, every number
  // read against its engine owner.
  describe("Expedition Tiers (0.14.0 G2-7)", () => {
    const topic = (id: string) => {
      const t = HELP_TOPICS.find((x) => x.id === id);
      expect(t, `missing help topic: ${id}`).toBeDefined();
      return t!;
    };
    const T = (t: number) => `Tier ${regionTierNumeral(t as RegionTier)}`;
    const b = () => topic("expeditionTiers").body;

    it("has the topic, once, cross-linked from the telescope, risk, difficulty and fuel topics", () => {
      expect(HELP_TOPICS.filter((t) => t.id === "expeditionTiers")).toHaveLength(1);
      expect(topic("expeditionTiers").title).toBe("Expedition Tiers");
      for (const id of ["subspaceTelescope", "riskFactors", "objectiveDifficulty", "fuel"]) expect(topic(id).body, id).toContain("Expedition Tiers topic");
    });

    it("regions and the homeworld: every region name, the candidates, real stars and the placement, from the engine", () => {
      for (const t of REGION_TIERS) expect(b()).toContain(T(t));
      expect(b()).toContain(`from ${T(1)} (the ${REGION_TIER_NAMES[1]}) out to ${T(7)} (the ${REGION_TIER_NAMES[7]})`);
      expect(b()).toContain(`each region offers ${EXPEDITION_CANDIDATE_COUNT} candidate systems, nearest first`);
      expect(b()).toContain(`about 1 in ${FAMOUS_SYSTEM_ONE_IN}`);
      expect(b()).toContain(`${HOMEWORLD_MIN_FROM_SOL_LY} to ${HOMEWORLD_MAX_FROM_SOL_LY} light-years from Sol`);
      // The telescope topic names where to upgrade and the per-player homeworld.
      const tel = topic("subspaceTelescope").body;
      expect(tel).toContain("Upgrade it from its card under Facilities");
      expect(tel).toContain(`${HOMEWORLD_MIN_FROM_SOL_LY} to ${HOMEWORLD_MAX_FROM_SOL_LY} light-years from Sol`);
      expect(tel).toMatch(/galaxy map is centered on your homeworld/);
    });

    it("deeper tiers: bodies, the haul and enemy territory, from the tables", () => {
      expect(b()).toContain(`${TIER_BODY_COUNT[1][0]} to ${TIER_BODY_COUNT[1][1]} at ${T(1)}, ${TIER_BODY_COUNT[7][0]} to ${TIER_BODY_COUNT[7][1]} at ${T(7)}`);
      expect(b()).toContain(`x${TIER_HAUL_MULT[1]} at ${T(1)} up to x${TIER_HAUL_MULT[7]} at ${T(7)}`);
      const first = REGION_TIERS.find((t) => ENEMY_SECTOR_WIDTH_PERMILLE[t] > 0)!;
      expect(b()).toContain(`${Math.round(ENEMY_SECTOR_WIDTH_PERMILLE[first] / 10)}% of its directions at ${T(first)} rising to ${Math.round(ENEMY_SECTOR_WIDTH_PERMILLE[7] / 10)}% at ${T(7)}`);
      expect(ENEMY_TERRITORY_COMBAT_STEP).toBe(1);
      expect(b()).toContain(`adds a step of ${RISK_FACTOR_NAMES.combat}`);
      expect(topic("riskFactors").body).toContain(`a system in enemy territory adds a step of ${RISK_FACTOR_NAMES.combat}`);
    });

    it("the gates: explorer hulls, drive class per tier, frontier sensors (CP-14: no Tier II gate) and reach, from propulsion.ts", () => {
      for (const hull of ["Orion", "Aurora", "Eir"]) expect(b()).toContain(hull);
      for (const t of REGION_TIERS) expect(tierMinimumDriveClass(t)).toBe(t);
      expect(b()).toContain(`Class I for ${T(1)}, up to Class VII for ${T(7)}`);
      // CP-14 retired the Tier II gate: Tiers I and II ask for none; III to VII ask for their numbers.
      expect(frontierSensorsNeeded(1)).toBe(0);
      expect(frontierSensorsNeeded(2)).toBe(0);
      expect(b()).toContain(`${T(1)} and ${T(2)} ask for none`);
      const gated = REGION_TIERS.filter((t) => frontierSensorsNeeded(t) > 0);
      expect(gated).toEqual([3, 4, 5, 6, 7]);
      for (const t of gated) expect(b()).toContain(`${frontierSensorsNeeded(t)} at ${T(t)}`);
      for (let c = 1; c <= DRIVE_CLASS_MAX; c++) expect(b()).toContain(`x${DRIVE_CLASS_REACH_MULT[c]} at Class ${regionTierNumeral(c as RegionTier)}`);
      expect(b()).toContain('"Beyond this ship\'s reach"');
      // The buildable ceiling sentence appears exactly when a class cannot be built today.
      expect(b().includes("None can be built yet")).toBe(buildableDriveClassMax() < DRIVE_CLASS_MAX);
      expect(b()).toMatch(/never gates a launch/);
    });

    it("transit: every tier's hours, the band scale, halving, the floor and the detour, from voyage.ts", () => {
      const hours = (h: number) => (h < 24 ? `${h} hours` : h === 24 ? "1 day" : `${h / 24} days`);
      for (const t of REGION_TIERS) expect(b()).toContain(`${T(t)} ${hours(TIER_TRANSIT_HOURS[t])}`);
      expect(b()).toContain(`x${VOYAGE_BAND_SCALE_PERMILLE.near / 1000} of that and one at the far edge x${VOYAGE_BAND_SCALE_PERMILLE.far / 1000}`);
      expect(b()).toContain("Each drive class above the tier's halves the leg");
      expect(b()).toContain(`No leg is shorter than ${VOYAGE_FLOOR_SECONDS / 60} minutes`);
      expect(b()).toContain(`${VOYAGE_ANOMALY_DETOUR_PERMILLE / 10}% of the outbound leg`);
    });

    it("the training run's line shows only while its trip equals the Tier I nominal (voyage.ts)", () => {
      const line = `Your training run flies the same trip an ordinary ${T(1)} run to its system would.`;
      expect(trainingRunTransitSentence(tierNominalSeconds(1), tierNominalSeconds(1))).toBe(` ${line}`);
      expect(trainingRunTransitSentence(5, tierNominalSeconds(1))).toBe("");
      expect(b().includes(line)).toBe(TUTORIAL_TRANSIT_SECONDS === tierNominalSeconds(1));
    });

    it("the telescope topic says the map hatches enemy territory once in range, Tier II out (G2-7 shading)", () => {
      const first = REGION_TIERS.find((t) => ENEMY_SECTOR_WIDTH_PERMILLE[t] > 0)!;
      const tel = topic("subspaceTelescope").body;
      expect(tel).toContain(`From ${T(first)} out, once the range reaches a region, the map hatches that region's enemy territory sector`);
      expect(tel).toContain('reads "part enemy"; a region beyond range shows none');
    });

    it("recall and resume: the 1:1 rule, the pickup, the refusal and the Resume list", () => {
      expect(b()).toMatch(/flies home only the share of the trip it has flown \(an anomaly detour does not count\)/);
      expect(b()).toMatch(/The list stays the same until you launch to one of its systems/);
      expect(b()).toMatch(/one shared pickup/);
      expect(b()).toMatch(/already on its way home cannot be recalled/);
      expect(recallBlockText("returning")).toBe("The ship is already on its way home");
      expect(b()).toMatch(/Resume list until you finish it or abandon it/);
      expect(b()).toMatch(/recalled before anything was charted becomes a candidate again, until the next fresh list is drawn/);
    });

    it("the fuel topic gains deep-space reach and the depot's reach covers expeditions too", () => {
      const f = topic("fuel").body;
      expect(f).toContain("DEEP-SPACE REACH");
      expect(f).toContain(`x${DRIVE_CLASS_REACH_MULT[1]} at Class I up to x${DRIVE_CLASS_REACH_MULT[DRIVE_CLASS_MAX]} at Class VII`);
      expect(f).toContain("missions, patrols and expeditions alike");
    });

    it("follows the text rules: no em dash or double hyphen, no fit, no task, no warp, Roman numerals for every tier", () => {
      for (const id of ["expeditionTiers", "subspaceTelescope", "riskFactors", "objectiveDifficulty", "fuel"]) {
        const text = topic(id).body;
        expect(text, id).not.toMatch(/—|–|-{2}/);
        expect(text, id).not.toMatch(/\b(fit|fits|fitting|fitted|fitment)\b/i);
        expect(text, id).not.toMatch(/\btasks?\b/i);
        expect(text, id).not.toMatch(/\bwarp\b/i);
        expect(text, id).not.toMatch(/\b(Tier|Tiers|Class) \d/);
      }
      expect(b()).not.toMatch(/Wolf/); // the nod stays a surprise
    });
  });

  // Player-facing text rules (user, standing): objective never task; no em dash or double hyphen; install never fit;
  // never name the DBDs; never the Impossible-tier intent line or the Intact Data Core easter egg.
  it("follows the text rules in every title and body", () => {
    for (const t of HELP_TOPICS) {
      for (const text of [t.title, t.body]) {
        expect(/\btasks?\b/i.test(text), `"task" wording in: ${t.id}`).toBe(false);
        expect(/—|–|-{2}/.test(text), `em/en dash or double hyphen in: ${t.id}`).toBe(false);
        expect(/\b(fit|fits|fitting|fitted|fitment|refit|unfit)\b/i.test(text), `fit wording in: ${t.id}`).toBe(false);
        expect(/\bDBDs?\b|First Cause|going to die|Intact Data Core/i.test(text), `forbidden lore line in: ${t.id}`).toBe(false);
        expect(/\bcolour|armour|favour|honour|centre|defence|licence\b/i.test(text), `British spelling in: ${t.id}`).toBe(false);
      }
    }
  });
  it("every topic has a non-empty title and body", () => {
    for (const t of HELP_TOPICS) {
      expect(t.title.length).toBeGreaterThan(0);
      expect(t.body.length).toBeGreaterThan(0);
    }
  });
  // Task 15 (0.11.2): player-facing vocabulary is INSTALL ship systems, never the
  // old fit/fitment/fitted/unfit wording. Word-boundary matches so this stays
  // non-fragile (it never trips on unrelated words like "outfit" or "benefit").
  it("uses install vocabulary, never fit/fitment/fitted/unfit", () => {
    const banned = /\b(fitment|fitted|unfit|unfitted)\b/i;
    for (const t of HELP_TOPICS) {
      expect(banned.test(t.title), `stale fit-wording in title: ${t.id}`).toBe(false);
      expect(banned.test(t.body), `stale fit-wording in body: ${t.id}`).toBe(false);
    }
  });
  // 0.13.9: 0.13.6 turned fuel into REACH (lightyears, free instant refuel) and retired the Fuel
  // Depot and the Local Deuterium Skim, but the manual kept describing the old fuel economy. Only
  // the fuel topic may name the retired pieces (to say they are retired); no topic may describe
  // fuel as something you burn, refine, or buy.
  it("describes fuel as reach, never the retired fuel economy (0.13.9)", () => {
    const retiredNames = /fuel depot|deuterium skim/i;
    const oldEconomy = /burns? (round-trip )?fuel|fuel cost|refines? deuterium|auto-bought|fuel gauge|gauge in the top bar/i;
    for (const t of HELP_TOPICS) {
      // The Fuel Depot came back as a reach facility (the fuel topic says so), and the Refugees topic names it as
      // the Fuel handler's match; the retired skim stays banned there too.
      if (t.id === "refugees") expect(/deuterium skim/i.test(t.body), t.id).toBe(false);
      else if (t.id !== "fuel") expect(retiredNames.test(t.body), `retired fuel facility named in: ${t.id}`).toBe(false);
      expect(oldEconomy.test(t.body), `old fuel-economy wording in: ${t.id}`).toBe(false);
    }
    const fuel = HELP_TOPICS.find((t) => t.id === "fuel")!;
    expect(fuel.body).toMatch(/lightyears/i);
    expect(fuel.body).toMatch(/retired/i);
  });
  // 0.13.9: the manual still sent players to the 0.11.x programs (Foundry, Drydock, Stores) long
  // after the 0.12.0 console nav and the 0.13.2 Ships tab replaced them. Only current names now.
  it("uses the current nav names, never the retired Foundry / Drydock / Stores programs (0.13.9)", () => {
    const retiredNav = /\b(Foundry|Drydock|Stores)\b|\bprogram\b/;
    for (const t of HELP_TOPICS) {
      expect(retiredNav.test(t.body), `retired nav name in: ${t.id}`).toBe(false);
    }
  });
  // 0.13.9 final review: three more stale facts. Since 0.13.6 the admiral portrait opens Crew >
  // Admiral and the System window's settings tab is labeled Settings (opened by the top-bar gear);
  // and since "every hull is combat-capable" any hull can patrol (only a missing reactor blocks).
  it("never repeats the retired portrait / Options / combat-hull-only claims (0.13.9)", () => {
    const stale = /admiral portrait|from Options|Only a combat hull/i;
    for (const t of HELP_TOPICS) {
      expect(stale.test(t.body), `stale claim in: ${t.id}`).toBe(false);
    }
  });
});

// 0.14.0 Complement CP-16: the retirement and Hall of Command topic, from the engine's constants.
describe("HELP_TOPICS: retirement and the Hall of Command (CP-16)", () => {
  it("names the retire rules, the final warning, the Hall's lines and the notables, true to the engine", async () => {
    const { MAX_CAPTAIN_RETIREMENTS, RETIREMENT_EXP_PER, RETIRE_LEVEL_GATE, lockedInRetirementXpPercent } = await import("./game/captainRetirement");
    const { LEVEL_MILESTONE_EVERY } = await import("./game/captainNotables");
    const t = HELP_TOPICS.find((x) => x.id === "hallOfCommand");
    expect(t).toBeDefined();
    const b = t!.body;
    expect(b).toContain(`level ${RETIRE_LEVEL_GATE} or higher`);
    expect(b).toContain(`retire ${MAX_CAPTAIN_RETIREMENTS} times`);
    expect(b).toContain(`(${MAX_CAPTAIN_RETIREMENTS} of ${MAX_CAPTAIN_RETIREMENTS})`);
    expect(b).toContain(`every ${LEVEL_MILESTONE_EVERY}th level`);
    for (const first of ["first expedition", "first relic found", "first Tier II or deeper run", "first refugee rescued"]) expect(b).toContain(first);
    expect(b).toMatch(/patrol route and short-range cycle/);
    // A lost patrol route counts too (user 2026-11-06 "Count it too").
    expect(b).toContain("a patrol route counts whether it was won or lost");
    // The final retirement stops the slot's share of the fleet-wide captain XP bonus (retirementExpMultiplier).
    expect(b).toContain("its share of the fleet-wide captain XP bonus stops growing");
    expect(b).toContain(`adds ${Math.round(RETIREMENT_EXP_PER * 100)}% to the captain XP`);
    expect(b).toContain(`keeps giving +${lockedInRetirementXpPercent()}%`);
    expect(b).not.toMatch(/\u2014|-{2}|\bfit/);
  });
});

// Complement plan CP-4's rest (user 2026-11-10 "Build it"): the patrol topic names Deck Handling's drone rebuild and the
// Flight Deck's Integrity lift below half hull, both set per patrol cycle; fix round (user 2026-11-11 "Flight Deck's own
// only"): the lift is on the Flight Deck's own Deck Handling.
describe("Combat Patrols: the drone rebuild between waves", () => {
  it("names Deck Handling and the Flight Deck's Integrity below half hull", () => {
    const b = HELP_TOPICS.find((t) => t.id === "patrols")!.body;
    expect(b).toContain("lost drones rebuild between waves");
    expect(b).toContain("while the hull is below half, the Flight Deck's Integrity");
    expect(b).toContain("makes the Flight Deck's own Deck Handling stronger");
    expect(b).not.toMatch(/\u2014|-{2}|\bfit/);
  });
});
// G2-9 close-out (user 2026-11-11 "Everything"): every tier the player reads is a Roman numeral, so no Help text may
// write a tier as an Arabic number ("tier 1", "tier-1", "Tier 3").
describe("Roman numerals for every tier in Help", () => {
  it("no Help paragraph writes a tier as an Arabic number", () => {
    const all = JSON.stringify(HELP_TOPICS);
    expect(all.match(/\btier[- ]\d/gi) ?? []).toEqual([]);
  });
});

// Material Lines close-out (2026-11-11, fix ledger item 3): the Deuterium chain and the Sell counter, told truthfully.
// Every claim is read back from the catalog that enforces it (DRIVE_CLASS_BLUEPRINTS' recipes, ITEMS' sellValue and
// quartermaster.ts canSell), so a recipe or price change that makes the text wrong fails here.
describe("ML close-out: the Deuterium Canister's drive use and everything the Sell tab buys", () => {
  const body = (id: string) => HELP_TOPICS.find((t) => t.id === id)!.body;

  it("the canister's lowest drive class is read from the drive recipes: Class III today, none below it", () => {
    const takers = DRIVE_CLASS_BLUEPRINTS.filter((bp) => (bp.recipe.inputs.deuteriumCanister ?? 0) > 0);
    expect(takers.length).toBeGreaterThan(0);
    expect(DEUTERIUM_DRIVE_MIN_CLASS).toBe(3);
    for (const bp of DRIVE_CLASS_BLUEPRINTS) expect((bp.recipe.inputs.deuteriumCanister ?? 0) > 0, bp.key).toBe((bp.driveClass ?? 1) >= DEUTERIUM_DRIVE_MIN_CLASS);
    expect(DEUTERIUM_CANISTER_USES).toBe("Reactor Core blueprints and FTL Drive blueprints from Class III up");
  });

  it("the Deuterium Ice hint, the Fuel topic and the canister paragraph all name the Class III and higher drives", () => {
    expect(ITEMS.deuteriumIce.unlockHint).toContain("Reactor Core blueprints and Class III and higher FTL Drive blueprints");
    expect(body("fuel")).toContain(`presses it into Deuterium Canisters for ${DEUTERIUM_CANISTER_USES}`);
    expect(GAS_CANISTER_PARAGRAPHS[1]).toContain(`${ITEMS.deuteriumCanister.label} goes into ${DEUTERIUM_CANISTER_USES}`);
  });

  it("the Quartermaster topic lists every item the Sell tab buys, and nothing else", () => {
    const qm = body("quartermaster");
    const sellable = Object.keys(ITEMS).filter((id) => ITEMS[id].sellValue !== undefined);
    // Every canister is sellable, so the group name covers them all.
    for (const id of GAS_CANISTER_IDS) expect(sellable, id).toContain(id);
    const named = sellable.filter((id) => ITEMS[id].category !== "gasCanister");
    expect(named).toEqual(["deuteriumIce", "salvagedCircuitry", "precursorCircuit"]);
    expect(qm).toContain("Its Sell tab buys stock back for credits (today Deuterium Ice, Salvaged Circuitry, Precursor Circuit and the gas canisters you hold)");
    for (const id of named) expect(SELL_COUNTER_TEXT, id).toContain(ITEMS[id].label);
    expect(qm).not.toMatch(/\u2014|-{2}|\bfit/);
  });
});
