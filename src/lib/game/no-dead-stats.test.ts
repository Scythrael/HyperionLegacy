// E-CREW 0.14.0 (Task 22): the "NO DEAD STATS" STANDING TEST, since WR-1 (0.14.0 wiring registry, plan
// docs/plans/2026-10-15-wiring-registry-and-audit-plan.md section 3.6) the LIVENESS LEVEL of the wiring registry.
//
// THE RULE IT GUARDS: nothing a player can see on a crew card, an officer card or a piece of member gear may do
// nothing. The probes, fingerprint and entry builders live in wiring/liveness.testkit.ts (moved there unchanged);
// whether each entry is EXPECTED to be live is now its wiring registry status (wiring/registry.ts), which replaced
// the PENDING_IN_RELEASE allow-list with the same ids and the same owners. The test FAILS when an effect the
// registry calls live is dead (give it a consumer, or give its entry a pending owner) AND when an effect the
// registry calls pending, deferred or held turns out to be live (flip its entry to live: the list cannot rot).
//
// THE RELEASE GATE (unchanged command): `RELEASE_GATE=1 npx vitest run src/lib/game/no-dead-stats.test.ts` fails
// while any liveness entry is pending (an entry the user DEFERRED past 0.14.0 carries the user's reference and
// does not block), and additionally runs the registry's own gate (no pending entry anywhere).

import { describe, it, expect } from "vitest";
import { EQUIPMENT_SLOTS, MEMBER_GROUND_STAT_KEYS, MEMBER_SLOT_TYPES, type MemberGroundStatKey } from "./model";
import { OFFICER_BONUSES_PENDING_IN_RELEASE } from "./crewOverlay";
import { CREW_PROFESSION_BUFFS, CREW_STAT_KEYS, SECOND_LEVEL_EXCLUSIVE } from "./crewBuffs";
import { CREW_RACES } from "./crewRaces";
import { SENIOR_STAFF_BONUSES } from "./seniorStaffBonuses";
import { OFFICER_STAT_KEYS } from "./seniorStaff";
import { CUNNING_PENDING_SEATS, DEPARTMENT_OF_SEAT } from "./officerStats";
import {
  ENTRIES,
  EXPECTED_COUNTS,
  GEAR_POINTS,
  ROLLABLE_EXCLUSIVE,
  SEATS,
  fp,
  liveVia,
  rollableKeys,
  wearOn,
  type Category,
  type StatEntry,
} from "./wiring/liveness.testkit";
import { releaseBlockers, wiringEntry } from "./wiring/registry";

// The registry status of a liveness entry, and the phase it names when it is not live.
function expectation(id: string): { live: boolean; phase?: string } {
  const e = wiringEntry(id);
  if (!e) throw new Error(`${id} has no wiring registry entry (wiring/registry.ts)`);
  const st = e.status;
  if (st.kind === "live") return { live: true };
  return { live: false, phase: st.kind === "held" ? `held: ${st.userRef}` : st.owner };
}

describe("no dead stats: every rollable or installable effect moves a derived value", () => {
  for (const category of ["officer", "crew", "racial", "gear", "facet"] as Category[]) {
    describe(category, () => {
      for (const entry of ENTRIES.filter((e) => e.category === category)) {
        it(entry.id, { timeout: 120_000 }, () => {
          const live = liveVia(entry);
          const want = expectation(entry.id);
          if (!want.live) {
            expect(
              live,
              `${entry.id} [${entry.label}] is not live in the wiring registry (${want.phase}) but is now LIVE via ${live}: flip its registry entry to live`,
            ).toBeNull();
          } else {
            expect(
              live,
              `${entry.id} [${entry.label}] moves no derived value: give it a consumer, or give its registry entry a pending owner`,
            ).not.toBeNull();
          }
        });
      }
    });
  }
});

describe("the entry list and the registry statuses stay honest", () => {
  it("covers every rollable officer bonus, complement buff, racial, member gear line and seat facet", () => {
    const ids = new Set(ENTRIES.map((e) => e.id));
    expect(ids.size).toBe(ENTRIES.length);
    for (const def of SENIOR_STAFF_BONUSES) expect(ids.has(`officer:${def.statKey}`), def.id).toBe(true);
    for (const def of [...Object.values(CREW_PROFESSION_BUFFS).flat(), ...ROLLABLE_EXCLUSIVE]) expect(ids.has(`crew:${def.statKey}`), def.id).toBe(true);
    for (const race of Object.keys(CREW_RACES)) expect(ids.has(`racial:${race}`), race).toBe(true);
    for (const slotType of MEMBER_SLOT_TYPES) {
      for (const v of EQUIPMENT_SLOTS[slotType].varieties) {
        if (!v.member) continue;
        for (const team of v.member.teamTypes) {
          for (const key of rollableKeys(slotType, v)) expect(ids.has(`gear:${team}:${v.key}:${key}`), `${v.key} ${team} ${key}`).toBe(true);
        }
      }
    }
    for (const key of MEMBER_GROUND_STAT_KEYS as readonly MemberGroundStatKey[]) {
      expect(ENTRIES.some((e) => e.category === "gear" && e.id.endsWith(`:${key}`)), key).toBe(true);
    }
    for (const seat of SEATS) for (const stat of OFFICER_STAT_KEYS) expect(ids.has(`facet:${seat}:${stat}`), `${seat} ${stat}`).toBe(true);
    const count = (c: Category) => ENTRIES.filter((e) => e.category === c).length;
    expect({
      officer: count("officer"),
      crew: count("crew"),
      racial: count("racial"),
      gear: count("gear"),
      facet: count("facet"),
    }).toEqual(EXPECTED_COUNTS);
  });

  it("Craft Duplicate is held (D14) and is the only buff left out", () => {
    expect(SECOND_LEVEL_EXCLUSIVE.length - ROLLABLE_EXCLUSIVE.length).toBe(1);
    expect(ENTRIES.some((e) => e.id === `crew:${CREW_STAT_KEYS.craftDuplicateChance}`)).toBe(false);
    expect(wiringEntry(`crew:${CREW_STAT_KEYS.craftDuplicateChance}`)?.status.kind).toBe("held");
  });

  it("every entry that is not live names an owner, and none is UNPLANNED (D26)", () => {
    for (const entry of ENTRIES) {
      const want = expectation(entry.id);
      if (want.live) continue;
      expect((want.phase ?? "").length > 0, entry.id).toBe(true);
      expect(/UNPLANNED/.test(want.phase ?? ""), entry.id).toBe(false);
    }
  });

  it("Reactor Overdrive comes from crewOverlay.ts and the Pilot's Cunning from CUNNING_PENDING_SEATS", () => {
    for (const statKey of Object.keys(OFFICER_BONUSES_PENDING_IN_RELEASE)) expect(expectation(`officer:${statKey}`).live, statKey).toBe(false);
    // Every seat with no over-delivery of its own: its Cunning is dead unless the XO's 0.4 share reaches the other
    // departments' over-deliveries (the XO's Cunning is live that way; its OWN edge is the pending part).
    for (const seat of CUNNING_PENDING_SEATS) {
      if (DEPARTMENT_OF_SEAT[seat] === "all") expect(expectation(`facet:${seat}:cunning`).live, seat).toBe(true);
      else expect(expectation(`facet:${seat}:cunning`).live, seat).toBe(false);
    }
  });

  it("the effect-piece filler lines are inert on a Security wearer (so balancing an effect hides nothing)", { timeout: 120_000 }, () => {
    // A Security piece WITHOUT an effect, carrying only a filler line, must move nothing at all.
    for (const filler of ["groundOrganicsYield", "groundVaultYield"]) {
      const entry: StatEntry = {
        id: `filler:${filler}`,
        category: "gear",
        label: filler,
        variants: [
          {
            label: `memberArmor/ballisticWeave + ${filler}`,
            baseKey: "filler-bare",
            base: wearOn("security", "memberArmor", "ballisticWeave", {}),
            with: wearOn("security", "memberArmor", "ballisticWeave", { [filler]: GEAR_POINTS }),
          },
        ],
      };
      expect(liveVia(entry), filler).toBeNull();
    }
  });

  it("a NaN or an Infinity in a fingerprint throws instead of reading as null", () => {
    expect(() => fp({ a: Number.NaN })).toThrow(/non-finite/);
    expect(() => fp([1, Number.POSITIVE_INFINITY])).toThrow(/non-finite/);
    expect(fp({ a: 1 })).toBe('{"a":1}');
  });
});

// The 0.14.0 CLOSE-OUT gate (plan Task 35, wiring plan WR-12): `RELEASE_GATE=1 npx vitest run
// src/lib/game/no-dead-stats.test.ts`. The release may ship only when no liveness entry is pending (a deferred entry
// carries the user's own words and does not block), and no registry entry anywhere is pending.
const RELEASE_GATE = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env?.RELEASE_GATE;

describe.runIf(Boolean(RELEASE_GATE))("release gate: 0.14.0 ships with no dead stats", () => {
  it("no liveness entry is pending", () => {
    const blocking = ENTRIES.map((e) => wiringEntry(e.id)!)
      .filter((e) => e.status.kind === "pending")
      .map((e) => `${e.id} (${e.status.kind === "pending" ? e.status.owner : ""})`);
    expect(blocking, "dead stats still pending for 0.14.0: wire them or get the user to defer their phase").toEqual([]);
  });

  it("no wiring registry entry is pending", () => {
    expect(releaseBlockers().map((e) => e.id)).toEqual([]);
  });
});
