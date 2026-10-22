// WR-8 (docs/plans/2026-10-15-wiring-registry-and-audit-plan.md section 4 WR-8): the registry read-back the golden
// files whose registry snapshots were pinned before WR-8 apply, so those pins keep proving their own slices were their
// only moves. TEST-ONLY (imported by *.test.ts files only).
//
// WR-8 ADDED entries (the nine resist and drone pod gear lines, the nine pirate hull mitigation fields, and the WR-8
// audit rows that split the old combat rows) and FLIPPED the rows below as they stood before it (status, no contexts,
// no probe): the five statuses, the three pirate stances and the combat audit rows went live, the inert descriptors
// row became a seam (OC-C4), and the member slot physicals row lost its WR-8 owner. Nothing was removed and the
// registry order of every older row is unchanged. combatDescriptorGoldens.test.ts and the wiring sensitivity tests pin
// the new rows themselves.

import type { WiringEntry, WiringStatus } from "./wiring/registry";
import type { ContextId, ProbeId } from "./wiring/probes";

export const WR8_ADDED_ENTRY_IDS: ReadonlySet<string> = new Set<string>([
  "ship:gearLine:damageResist_kinetic",
  "ship:gearLine:damageResist_particle",
  "ship:gearLine:damageResist_ew",
  "ship:gearLine:disruptionResist_kinetic",
  "ship:gearLine:disruptionResist_particle",
  "ship:gearLine:disruptionResist_ew",
  "ship:gearLine:droneInCombatReplenish",
  "ship:gearLine:droneRapidCharge",
  "ship:gearLine:droneSmartReflect",
  "ship:PIRATE_HULLS:raider:ablativeArmor",
  "ship:PIRATE_HULLS:raider:kineticDampening",
  "ship:PIRATE_HULLS:raider:evasion",
  "ship:PIRATE_HULLS:marauder:ablativeArmor",
  "ship:PIRATE_HULLS:marauder:kineticDampening",
  "ship:PIRATE_HULLS:marauder:evasion",
  "ship:PIRATE_HULLS:corsairCarrier:ablativeArmor",
  "ship:PIRATE_HULLS:corsairCarrier:kineticDampening",
  "ship:PIRATE_HULLS:corsairCarrier:evasion",
  "ship:wr8:weaponRange",
  "ship:wr8:droneRange",
  "ship:wr8:stance",
  "ship:wr8:speedKite",
  "ship:wr8:sensorDrainActs",
  "ship:wr8:coolantLeakActs",
  "ship:wr8:manifoldOverheatActs",
  "ship:wr8:powerInCombat",
  "ship:wr8:voltaicChain",
  "ship:wr8:vsDronesColumn",
  "ship:wr8:statusPersistence",
  "ship:wr8:inhibitSource",
  "ship:wr8:inhibitReader",
  "ship:wr8:overchargeSource",
  "ship:wr8:enemyMitigation",
  "ship:wr8:ambushInPatrols",
]);

const WR8_BEFORE: Readonly<Record<string, readonly [WiringStatus, readonly ContextId[], ProbeId | null]>> = {
  "ship:PIRATE_HULLS:raider:stance": [{"kind": "pending", "owner": "WR-8, OC-D9 (every ship sits at position 0, so stance changes nothing, B3)"}, [], null],
  "ship:PIRATE_HULLS:marauder:stance": [{"kind": "pending", "owner": "WR-8, OC-D9 (every ship sits at position 0, so stance changes nothing, B3)"}, [], null],
  "ship:PIRATE_HULLS:corsairCarrier:stance": [{"kind": "pending", "owner": "WR-8, OC-D9 (every ship sits at position 0, so stance changes nothing, B3)"}, [], null],
  "ship:STATUS_EFFECT_DEFS:sensorPowerDrain": [{"kind": "pending", "owner": "WR-8, OC-D9 (range: every ship sits at position 0, B3)"}, [], null],
  "ship:STATUS_EFFECT_DEFS:manifoldOverheat": [{"kind": "pending", "owner": "WR-8, OC-D12 (maneuver: enemy evasion is always 0)"}, [], null],
  "ship:STATUS_EFFECT_DEFS:coolantLeak": [{"kind": "pending", "owner": "WR-8, OC-D9 (speed: every ship sits at position 0, B3)"}, [], null],
  "ship:STATUS_EFFECT_DEFS:inhibit": [{"kind": "pending", "owner": "WR-8, OC-D12 (no source applies it; nothing reads droneAttackRate)"}, [], null],
  "ship:STATUS_EFFECT_DEFS:overchargedCapacitors": [{"kind": "pending", "owner": "WR-8, OC-D12 (no source applies the buff)"}, [], null],
  "ship:audit:combatPositions": [{"kind": "pending", "owner": "WR-8, OC-D9"}, [], null],
  "ship:audit:ftlSpeedPenalty": [{"kind": "pending", "owner": "WR-8, OC-D9"}, [], null],
  "ship:audit:torpedoArmorPen": [{"kind": "pending", "owner": "WR-8, OC-D12"}, [], null],
  "ship:audit:qualityDurabilityMax": [{"kind": "pending", "owner": "gear wear step 4 (combat: true-condition pools, battle wear, reactor and FTL from the installed piece)"}, [], null],
  "ship:audit:rapidChargeAfterAmbush": [{"kind": "pending", "owner": "WR-8, OC-D12"}, [], null],
  "ship:audit:inCombatReplenishPercent": [{"kind": "pending", "owner": "WR-8, OC-D12"}, [], null],
  "ship:audit:antiDrone": [{"kind": "pending", "owner": "WR-8, OC-D12"}, [], null],
  "ship:audit:smartReflect": [{"kind": "pending", "owner": "WR-8, OC-D12"}, [], null],
  "ship:audit:droneDisrupted": [{"kind": "pending", "owner": "WR-8, OC-D12"}, [], null],
  "ship:audit:familyResists": [{"kind": "pending", "owner": "WR-8, OC-D12"}, [], null],
  "ship:audit:installedSystems": [{"kind": "pending", "owner": "WR-8, OC-D12"}, [], null],
  "ship:audit:derivedStatsInCombat": [{"kind": "pending", "owner": "WR-8, OC-D12"}, [], null],
  "ship:audit:commentOnlyRules": [{"kind": "pending", "owner": "WR-8, OC-D12"}, [], null],
  "ship:audit:inertDescriptors": [{"kind": "pending", "owner": "WR-8, OC-D12"}, [], null],
  "ship:audit:partialCombat": [{"kind": "pending", "owner": "WR-8, OC-D9 / OC-D12"}, [], null],
  "away:audit:memberSlotPhysicals": [{"kind": "pending", "owner": "WR-8, OC-D14 (durability: gear wear step 3 (use wear sources, repair contexts and settling at events))"}, [], null],
};

// `entries` as they stood before WR-8: its added entries left out, its flipped rows read back in place. Pure.
export function wr8ReadBack(entries: readonly WiringEntry[]): WiringEntry[] {
  return entries
    .filter((e) => !WR8_ADDED_ENTRY_IDS.has(e.id))
    .map((e) => {
      const before = WR8_BEFORE[e.id];
      return before ? ({ ...e, status: before[0], contexts: [...before[1]], probe: before[2] ?? undefined } as WiringEntry) : e;
    });
}

// The ids WR-8 flipped (the read-back above restores them), for a pin that checks the move itself.
export const WR8_FLIPPED_ENTRY_IDS: ReadonlySet<string> = new Set<string>(Object.keys(WR8_BEFORE));
