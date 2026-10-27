import { describe, it, expect } from "vitest";
import { HELP_TOPICS, TRAINING_RUNS_PARAGRAPH } from "./helpTopics";
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
import { CONDITION_LINES, FIELD_KITS, FIELD_KIT_IDS, FREE_BASIC_FIRST_AID_PER_MEMBER, KIT_CATEGORY_RULES, SABOTEUR_GRENADE_BONUS, SPLINT_HEAL_ROUNDS } from "./game/fieldKits";
import { GRENADES, GRENADE_IDS } from "./game/fieldKitsGrenades";
import { defaultMemberPack } from "./game/fieldKitsRun";
import { BLEED_ON_HIT_PERMILLE, FEAR_ON_HIT_PERMILLE, FLASH_GRENADES_PER_STRIKER, HEAVY_HIT_FRACTION, NEUROTOXIN_FROM_GRADE } from "./game/fieldKitsConditions";
import { BASIC_DEBUFFS, BLINDNESS_MIN_ROUNDS, BLINDNESS_ROUND_SPAN, GAMBIT_STATUSES, NEUROTOXIN_TURN_LOSS, STONESKIN_BATTLE_RESIST } from "./game/gambit";
import { EQUIPMENT_SLOTS, GRENADE_CARRY_PER_LINE, GRENADE_FUSE_MOVED_CLEAR_CHANCE, GRENADE_THROWS_PER_BATTLE } from "./game/model";
import { ACTION_LABEL, RANK_OPTIONS, SELECTOR_LABEL } from "./gambitEditorDisplay";
import { kitEffectText } from "./fieldKitsDisplay";

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
      expect(b).toContain(`${ACTION_LABEL.throwGrenade} gambit rule`);
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
      expect(b).toContain(`${pc(STONESKIN_BATTLE_RESIST)} more often`);
      expect(b).toContain("A training run's enemies cause none of these.");
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
      if (t.id !== "fuel") expect(retiredNames.test(t.body), `retired fuel facility named in: ${t.id}`).toBe(false);
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
