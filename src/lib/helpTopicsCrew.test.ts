// CP-21 close-out (E-CREW Task 34): the Complement, Senior Staff, Recruiting, Away-Team Members and Implants Help
// topics, each number read back from the engine. The whole-manual text rules (helpTopics.test.ts) cover them too.
import { describe, expect, it } from "vitest";
import { CAPTAIN_TALENTS_PARAGRAPH, HELP_TOPICS, HOMEWORLD_HUBS_PARAGRAPH } from "./helpTopics";
import { TRANSPORT_BATCH_SIZE, TRANSPORT_WINDOW_SECONDS } from "./game/transports";
import {
  CAPTAIN_RACIAL_SCALE,
  CAPTAIN_SPEC_BONUS,
  CAPTAIN_TALENTS,
  CIVIC_CHARTER_TRANSPORT_CREW,
  EXPLORER_HUB_SCAN_RATE,
  HOME_GUARD_PATROL_SHIELD,
  NOTABLE_CREW_CAP,
  SCIENCE_SPEC_RELIC_FIND,
  SHIP_TYPES,
  TACTICAL_SPEC_WEAPON_DAMAGE,
  TACTICIAN_HUB_WEAPON_DAMAGE,
  WORKS_DIRECTORATE_BONUS_CHANCE,
  type ShipTypeKey,
} from "./game/model";
import { commandStructureForHull } from "./game/commandStructure";
import { CREW_RACES } from "./game/crewRaces";
import {
  OFFICER_PROMOTION_STATS_RAISED,
  OFFICER_PROMOTION_STAT_POINTS,
  OFFICER_ROSTER_WINDOW_SECONDS,
  OFFICER_STAT_INFO,
  OFFICER_STAT_ROLL_MAX,
  SENIOR_STAFF_SEATS,
} from "./game/seniorStaff";
import { OFFICER_STAT_NEUTRAL, XO_DEPARTMENT_SHARE } from "./game/officerStats";
import { STATUS_RESIST_CAP } from "./game/awayTeam";
import { UNASSIGNED_INTRO } from "./awayTeamDisplay";

const body = (id: string): string => {
  const t = HELP_TOPICS.find((x) => x.id === id);
  expect(t, id).toBeDefined();
  return t!.body;
};
const IDS = ["complement", "officerStats", "recruitment", "awayMembers", "implants"];
const pct = (v: number): string => `${Math.round(v * 10000) / 100}%`;

describe("HELP_TOPICS: the crew topics (CP-21 close-out, Task 34)", () => {
  it("every topic exists once and follows the text rules", () => {
    for (const id of IDS) {
      expect(HELP_TOPICS.filter((t) => t.id === id).length, id).toBe(1);
      const t = HELP_TOPICS.find((x) => x.id === id)!;
      for (const text of [t.title, t.body]) {
        expect(text.includes(String.fromCharCode(0x2014)), id).toBe(false);
        expect(text, id).not.toMatch(/-{2}/);
        expect(text, id).not.toMatch(/\b(fit|fits|fitting|fitted|fitment|refit|unfit)\b/i);
        expect(text, id).not.toMatch(/\b(tier|tiers|class) \d/i);
        expect(text, id).not.toMatch(/\btasks?\b/i);
      }
    }
  });

  it("Complement: transports, berths per hull, over cap, auto-crew, transfers, the pool, notables, manifest, Unassigned", () => {
    const b = body("complement");
    expect(b).toContain(`a crew transport arrives every ${TRANSPORT_WINDOW_SECONDS / 60} minutes of game time with ${TRANSPORT_BATCH_SIZE} new crew`);
    for (const h of Object.keys(SHIP_TYPES) as ShipTypeKey[]) {
      expect(b).toContain(`${SHIP_TYPES[h].label} ${commandStructureForHull(h).total.toLocaleString("en-US")}`);
    }
    expect(b).toContain("Eir 900");
    expect(b).toContain("nobody is removed. It simply takes no new crew where it is over until it is back under");
    expect(b).toContain("Turn Auto-crew off and the ship is manual: it never fills on its own and takes only the crew you send it.");
    expect(b).toContain("auto-crew pauses (the toggle reads paused while out)");
    expect(b).toContain("Manual ships only: a ship on Auto-crew must be switched to manual first");
    expect(b).toContain("Personnel Rosters, in Facilities, has a Crew Pool tab");
    // Homeworld reserve (user 2026-11-12, "Homeworld reserve (Recommended)"), and its controls (2026-11-12 evening: the reserve controls mockup).
    expect(b).toContain(
      "The pool has no limit, but crew that no berth in your fleet can take move on to the Homeworld reserve, listed in its own section under the pool on the Crew Pool tab; they keep their ranks and racials, and Auto-crew ships draw from the reserve when the pool cannot fill a berth. Tick reserve groups to Send them to a manual ship, or to Recall them to the pool: Recall moves only the crew a berth in your fleet can seat, and the rest stay in the reserve. Before a Send that leaves crew waiting in the pool without a berth, the picker warns how many move to the reserve at the next tick.",
    );
    expect(b).toContain(`The fleet holds at most ${NOTABLE_CREW_CAP} notables, aboard a ship or not.`);
    expect(b).toContain("Send back unassigns a notable from the ship (they keep their name");
    expect(b).toContain("Retire lets a notable leave the fleet with your thanks");
    expect(b).toContain("The names are made up when you open it and never saved");
    expect(b).toContain("Unassigned list on every ship's Away Team tab");
    expect(b).toContain("CREW EFFECTIVENESS: a Medical crew buff and the Earth-born racial.");
    expect(b).toContain("Graph colors changes the colors of the rank bars on this device: Default, Color-blind safe and Monochrome.");
    // The notable band (user answers 2026-11-12: under the tab row, drift, favorites first, record with Send back and
    // Retire): one sentence in the Notable Crew paragraph.
    expect(b).toContain(
      "A band under the Crew tab's tabs lists every notable in the fleet, aboard a ship or not, favorites first and then in the order they graduated. It drifts slowly and holds still while you point at it, focus it or touch it, and always with Reduce motion on. Tap a name to open their record, with the same Send back and Retire; All lists everyone by ship.",
    );
    expect(b).not.toMatch(/ticker|marquee/i);
  });

  it("Complement: each racial line reads its race's own magnitudes", () => {
    const lines = body("complement").split("\n");
    for (const [race, words] of [
      ["belter", "Deck Handling"],
      ["spacer", "transit speed"],
      ["vael", "Survey Aptitude"],
      ["outerColony", "Survey Aptitude"],
      ["earthBorn", "Crew Effectiveness"],
      ["stheni", "Damage Control"],
    ] as const) {
      const r = CREW_RACES[race];
      const line = lines.find((l) => l.startsWith(`- ${r.label}: ${words}`));
      expect(line, race).toBeDefined();
      expect(line).toContain(`Each crew member adds ${pct(r.racialBonus.complement)}, an officer ${pct(r.racialBonus.seniorStaff)}.`);
    }
  });

  it("Senior Staff: seats, the stat rule, ranks and promotion from the engine", () => {
    const b = body("officerStats");
    expect(b).toContain(`has ${SENIOR_STAFF_SEATS.length} bridge seats, one officer each: Executive Officer, Pilot, Operations, Science, Tactical, Medical and Engineering.`);
    expect(b).toContain(`adds ${Math.round(XO_DEPARTMENT_SHARE * 100)}% of their own stats' effect to every department`);
    expect(b).toContain(`each rolled 1 to ${OFFICER_STAT_ROLL_MAX}. Only the points above ${OFFICER_STAT_NEUTRAL} count, 1% each`);
    for (const info of Object.values(OFFICER_STAT_INFO)) expect(b).toContain(`- ${info.label} (${info.facet}): ${info.effect}`);
    expect(b).toContain("Cadet, Ensign, Lieutenant, Lieutenant Commander and Commander. A new officer starts as a Cadet.");
    expect(b).toContain(`adds ${OFFICER_PROMOTION_STAT_POINTS} points to each of the officer's ${OFFICER_PROMOTION_STATS_RAISED} highest stats`);
    expect(b).toContain("Officer stats never affect away teams on a planet.");
    expect(b).toContain("cannot be hired, seated, unseated or dismissed. Promoting and favorites still work.");
  });

  it("Recruiting, Away-Team Members and Implants: the board, the trait ladder, the slots and the unique implant", () => {
    const r = body("recruitment");
    expect(r).toContain(`changes every ${OFFICER_ROSTER_WINDOW_SECONDS / 60} minutes of game time`);
    expect(r).toContain("Hiring is free: pick the ship and press Hire.");
    expect(r).toContain("(1 at ranks 1 to 2, 2 at ranks 3 to 6 and 3 at ranks 7 to 8)");
    expect(r).toContain("A member's rank never changes.");
    const a = body("awayMembers");
    expect(a).toContain(UNASSIGNED_INTRO);
    expect(a).toContain("comes home Injured for the bay time left");
    expect(a).toContain("Fire lets them go and returns their gear and implants to storage.");
    const i = body("implants");
    expect(i).toContain("Every member has 1 implant slot; Martian and Stheni members (augment affinity, shown on their card) have 2.");
    expect(i).toContain(`no resist goes past ${Math.round(STATUS_RESIST_CAP * 100)}%`);
    expect(i).toContain("Only one can be worn in the whole fleet");
  });
});

// WR-12 (0.14.0 wiring close-out): the effects WR-6 made live, each named in Help with its size read back from the
// constant the engine reads (the captain specializations and hubs, the captain's racial, the three Homeworld hubs).
describe("HELP_TOPICS: the WR-6 effects named in Help (WR-12 close-out)", () => {
  const rules = (text: string): void => {
    expect(text.includes(String.fromCharCode(0x2014))).toBe(false);
    expect(text).not.toMatch(/-{2}/);
    expect(text).not.toMatch(/\b(fit|fits|fitting|fitted|fitment|refit|unfit)\b/i);
    expect(text).not.toMatch(/\btasks?\b/i);
  };

  it("Crew and Captains: the specialization bonuses and the two captain hubs, from the engine", () => {
    const b = body("crew");
    rules(b);
    expect(b).toContain(CAPTAIN_TALENTS_PARAGRAPH);
    expect(CAPTAIN_SPEC_BONUS.resourcefulness).toEqual({ type: "bonusRollChance", chance: 0.01 });
    expect(CAPTAIN_SPEC_BONUS.tactical).toEqual({ type: "weaponDamageMult", mult: TACTICAL_SPEC_WEAPON_DAMAGE });
    expect(CAPTAIN_SPEC_BONUS.science).toEqual({ type: "relicFindMult", mult: SCIENCE_SPEC_RELIC_FIND });
    expect(b).toContain("Prospector a +1% chance each tick of a bonus roll while extracting");
    expect(b).toContain(`Tactician +${TACTICAL_SPEC_WEAPON_DAMAGE * 100}% damage from the ship's weapons (not its drones)`);
    expect(b).toContain(`Explorer +${SCIENCE_SPEC_RELIC_FIND * 100}% relic find chance`);
    expect(b).toContain(`${CAPTAIN_TALENTS.tacticianHub.label} +${TACTICIAN_HUB_WEAPON_DAMAGE * 100}% weapon damage`);
    expect(b).toContain(`${CAPTAIN_TALENTS.explorerHub.label} +${EXPLORER_HUB_SCAN_RATE * 100}% expedition scan rate`);
    expect(b).toContain("Every talent does what its text says, on the ship its captain commands.");
  });

  it("Complement: the commanding captain carries a racial too, at the officer size", () => {
    expect(CAPTAIN_RACIAL_SCALE).toBe(1);
    expect(body("complement")).toContain("and so does the captain in command of the ship (the same as an officer)");
  });

  it("Homeworld: Home Guard, Civic Charter and Works Directorate, each with its size", () => {
    const b = body("homeworld");
    rules(b);
    expect(b).toContain(HOMEWORLD_HUBS_PARAGRAPH);
    expect(b).toContain(`Home Guard gives +${HOME_GUARD_PATROL_SHIELD * 100}% shield capacity and recharge on patrols`);
    expect(b).toContain(`Civic Charter adds ${CIVIC_CHARTER_TRANSPORT_CREW} crew to every crew transport`);
    expect(b).toContain(`Works Directorate gives each Fabricator job a ${WORKS_DIRECTORATE_BONUS_CHANCE * 100}% chance to deliver one more of its output`);
    expect(b).toContain("Works Directorate is also needed for the Refinery's upgrades to levels 3 and 4.");
  });
});
