import { describe, it, expect } from "vitest";
import { HELP_TOPICS } from "./helpTopics";
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
