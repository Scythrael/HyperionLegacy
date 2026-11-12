// CP-21 close-out (E-CREW Task 34): the Complement, Senior Staff, Recruiting, Away-Team Members and Implants Help
// topics, each number read back from the engine. The whole-manual text rules (helpTopics.test.ts) cover them too.
import { describe, expect, it } from "vitest";
import { HELP_TOPICS } from "./helpTopics";
import { TRANSPORT_BATCH_SIZE, TRANSPORT_WINDOW_SECONDS } from "./game/transports";
import { NOTABLE_CREW_CAP, SHIP_TYPES, type ShipTypeKey } from "./game/model";
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
    // Homeworld reserve (user 2026-11-12, "Homeworld reserve (Recommended)").
    expect(b).toContain(
      "The pool has no limit, but crew that no berth in your fleet can take move on to the Homeworld reserve, shown as a count on the Crew Pool tab; they keep their ranks and racials, and Auto-crew ships draw from the reserve when the pool cannot fill a berth.",
    );
    expect(b).toContain(`The fleet holds at most ${NOTABLE_CREW_CAP} notables, aboard a ship or not.`);
    expect(b).toContain("Send back unassigns a notable from the ship (they keep their name");
    expect(b).toContain("Retire lets a notable leave the fleet with your thanks");
    expect(b).toContain("The names are made up when you open it and never saved");
    expect(b).toContain("Unassigned list on every ship's Away Team tab");
    expect(b).toContain("CREW EFFECTIVENESS: a Medical crew buff and the Earth-born racial.");
    expect(b).toContain("Graph colors changes the colors of the rank bars on this device: Default, Color-blind safe and Monochrome.");
    // The notable ticker's placement waits for the user: the topic does not describe it.
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
