// WR-1 (0.14.0, plan docs/plans/2026-10-15-wiring-registry-and-audit-plan.md section 3.6): the PARITY between the
// wiring registry and the no-dead-stats liveness level it took over. The liveness level itself runs in
// no-dead-stats.test.ts (its probes live in wiring/liveness.testkit.ts); this file proves the hand-over lost nothing:
//   1. the registry's liveness entries carry EXACTLY the no-dead-stats ids (149 at the move);
//   2. every one that is not live was on the old PENDING_IN_RELEASE allow-list (no new dead stat slipped in at the
//      move), with the same owner, except where a user decision since names a new one (the Spacer ramp: T3).

import { describe, it, expect } from "vitest";
import { D26_GEAR_LINES, ENTRIES, FIELD_KITS_GEAR_LINES } from "./wiring/liveness.testkit";
import { CP_3, WIRING_REGISTRY } from "./wiring/registry";

// The PENDING_IN_RELEASE allow-list of no-dead-stats.test.ts as it stood when WR-1 moved it (id -> phase).
const ALLOW_LIST_AT_THE_MOVE: Readonly<Record<string, string>> = {
  "officer:officer.powerEfficiencyMult": "E-MOD power budget",
  "officer:officer.crewRetention": "Field Kits 16b: enemies inflict Fear (D26)",
  "crew:crew.powerEfficiency": "E-MOD power budget",
  "crew:crew.droneHandling": "E-CREW Task 23 (division pools + exclusive pool live, design 6.2)",
  "crew:crew.hullRepairRate": "E-CREW Task 23 (division pools + exclusive pool live, design 6.2)",
  "crew:crew.counterInfiltration": "E-CREW Task 23 (division pools + exclusive pool live, design 6.2)",
  "crew:crew.awayTeamProtection": "E-CREW Task 23 (division pools + exclusive pool live, design 6.2)",
  "crew:crew.surveyAptitude": "E-CREW Task 23 (division pools + exclusive pool live, design 6.2)",
  "crew:crew.triage": "E-CREW Task 23 (division pools + exclusive pool live, design 6.2)",
  "crew:crew.crewOutputMult": "E-CREW Task 23 (division pools + exclusive pool live, design 6.2)",
  "crew:crew.missionTurnaround": "E-CREW Task 23 (division pools + exclusive pool live, design 6.2)",
  "crew:crew.preventCrewLoss": "E-CREW Task 23 (division pools + exclusive pool live, design 6.2)",
  "crew:crew.crewEffectiveness": "Task 23: small boost to all complement buffs (D26)",
  "racial:martian": "E-MOD power budget",
  "racial:belter": "E-CREW Task 23 (division pools + exclusive pool live, design 6.2)",
  "racial:outerColony": "E-CREW Task 23 (division pools + exclusive pool live, design 6.2)",
  "racial:vael": "E-CREW Task 23 (division pools + exclusive pool live, design 6.2)",
  "racial:stheni": "E-CREW Task 23 (division pools + exclusive pool live, design 6.2)",
  "racial:earthBorn": "Task 23: small boost to all complement buffs (D26)",
  "racial:spacer": "Task 23: complement long-haul ramp (D26)",
  "gear:science:sidearm:groundPower": "Science gear line swap (D26): Science gear rolls fieldwork/hazard/find lines instead",
  "gear:science:sidearm:groundAccuracy": "Science gear line swap (D26): Science gear rolls fieldwork/hazard/find lines instead",
  "gear:science:sidearm:groundStatusChance": "Science gear line swap (D26): Science gear rolls fieldwork/hazard/find lines instead",
  "gear:science:fieldSuit:groundArmor": "Science gear line swap (D26): Science gear rolls fieldwork/hazard/find lines instead",
  "gear:science:fieldSuit:groundHp": "Science gear line swap (D26): Science gear rolls fieldwork/hazard/find lines instead",
  "gear:science:hazardSuit:groundArmor": "Science gear line swap (D26): Science gear rolls fieldwork/hazard/find lines instead",
  "gear:science:hazardSuit:groundHp": "Science gear line swap (D26): Science gear rolls fieldwork/hazard/find lines instead",
  "gear:security:cortexShield:groundStatusResist": "Field Kits 16b: Fear (D26) + stun resist covers Concussion [proposal, pending user]",
  "facet:pilot:cunning": "pending user decision (officerStats.ts CUNNING_PENDING_SEATS)",
};

// The owners renamed since the move: E-CREW Task 23 was split into the complement plan's CP-1 to CP-4, and the four
// Ground Ops consumers still pending belong to CP-3 (inert-racials slice, 0.14.0: the registry still named the task).
const OWNER_SINCE_THE_MOVE: Readonly<Record<string, string>> = {
  "crew:crew.counterInfiltration": CP_3,
  "crew:crew.awayTeamProtection": CP_3,
  "crew:crew.triage": CP_3,
  "crew:crew.preventCrewLoss": CP_3,
};

// Prospecting squads (0.14.0, built HIDDEN; user group 4, 2026-10-16): the 25 Prospecting gear lines came AFTER the
// move, each deferred to the prospecting quests patch on the user's word (no Prospecting member deploys in 0.14.0).
const PROSPECTING_OWNER = "prospecting quests patch";
const isProspectingDeferral = (e: (typeof WIRING_REGISTRY)[number]): boolean =>
  e.id.startsWith("gear:prospecting:") && e.status.kind === "deferred" && e.status.owner === PROSPECTING_OWNER;

describe("wiring registry parity with the no-dead-stats liveness level", () => {
  const liveness = WIRING_REGISTRY.filter((e) => e.liveness);

  it("the registry's liveness entries are exactly the no-dead-stats entries (same ids)", () => {
    const registryIds = liveness.map((e) => e.id).sort();
    const testkitIds = ENTRIES.map((e) => e.id).sort();
    expect(registryIds).toEqual(testkitIds);
    // 149 at the move, + the 25 hidden Prospecting gear lines, + Field Kits FKR-5's grenade lines (all live; 5 once
    // FIELD_KITS_PLAYER_LIVE, 3 until then: the Stun and Toxin carry lines wait for FKR-7)
    // The D26 line swap (0.14.0, user 2026-10-21): 9 lines retire (2 of them the Hazard Suit's Prospecting ARM / HP),
    // 3 Science lines arrive (D26_GEAR_LINES); 23 Prospecting lines remain.
    expect(testkitIds.length).toBe(149 + 25 + FIELD_KITS_GEAR_LINES + D26_GEAR_LINES);
    expect(liveness.filter(isProspectingDeferral)).toHaveLength(23);
  });

  it("every liveness entry that is not live was on the old allow-list, with the same owner (or a user deferral)", () => {
    for (const e of liveness) {
      if (e.status.kind === "live") continue;
      if (isProspectingDeferral(e)) continue; // the user's deferral, after the move (above)
      const before = ALLOW_LIST_AT_THE_MOVE[e.id];
      expect(before, `${e.id} is not live in the registry but was live under no-dead-stats`).toBeDefined();
      if (e.status.kind === "pending") expect(e.status.owner, e.id).toBe(OWNER_SINCE_THE_MOVE[e.id] ?? before);
      if (e.status.kind === "deferred") {
        expect(e.status.owner, e.id).toBe(before);
        expect(e.status.userRef.length, `${e.id}: a deferral names the user's words`).toBeGreaterThan(0);
      }
    }
  });

  it("every liveness entry that is not live keeps the allow-list's reason (its rationale, verbatim from the move)", () => {
    for (const e of liveness) {
      if (e.status.kind === "live" || e.status.kind === "held") continue;
      expect(e.reason, `${e.id}: the old PENDING_IN_RELEASE reason is missing`).toBeDefined();
      expect(e.reason!.length, e.id).toBeGreaterThan(10);
    }
    // Field Kits FKR-4: Morale Anchor and Cortex Shield's resist went live once a Field Kits run's enemies inflict Fear
    // and Concussion, so their old reasons are gone with their pending status.
    for (const id of ["officer:officer.crewRetention", "gear:security:cortexShield:groundStatusResist"]) {
      const e = liveness.find((x) => x.id === id)!;
      expect(e.status.kind, id).toBe("live");
      expect(e.reason, id).toBeUndefined();
    }
  });

  // The Spacer racial went live on the transit speed (user 2026-10-20 "+Transit speed"), so no race is inert; its
  // long-haul ramp (crew.endurance) stays 0.14.x (capture 2026-10-15 T3) and has no source in 0.14.0.
  it("every racial is live (user 2026-10-20: no selectable race does nothing)", () => {
    const racials = liveness.filter((e) => e.id.startsWith("racial:"));
    expect(racials.length).toBe(10);
    for (const e of racials) expect(e.status.kind, e.id).toBe("live");
  });
});
