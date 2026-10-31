// Wiring WR-11 (the expedition, relic, mission and salvage leftovers): the wiring registry READ-BACK the registry golden
// chains apply, since their pins were taken before it. TEST-ONLY.
//
// WR-11 changes the registry three ways (wiring/registry.ts):
//   flipped : the Salvage Operations top-tier reach (its pending salvage:topTier context now live), the nine PoI flavor
//             rows (pending, no probe: now rendered, read by content:poiFlavor) and fourteen audit rows (pending, no
//             probe: now live, or deferred with the user's words for the unused factions).
//   added   : the PoI reward rows (two relicOddsMult, four materialMult), Ocean's surfaceWorkMult, the two new sellValue
//             rows (Salvaged Circuitry, Precursor Circuit) and relic:audit:scienceTeamPowerMembers.
//   removed : the ten mission:MISSIONS:<key>:cargoCapacity rows (OC-I1 deleted the field), each pending on WR-11.
// wr11ReadBack puts each flipped row's status, contexts and probe back as they stood, drops the added rows and puts the
// removed rows back in their places (right after their mission's other field rows), so a pin taken before WR-11 is
// reproduced exactly.

import { MISSIONS } from "./model";
import type { WiringEntry } from "./wiring/registry";

const pending = (owner: string, contexts?: string[]): WiringEntry["status"] =>
  (contexts ? { kind: "pending", owner, contexts } : { kind: "pending", owner }) as WiringEntry["status"];

const POI_IDS = ["ancientRuins", "crashedShip", "xenoFloraBloom", "mineralOutcrop", "derelictOutpost", "caveNetwork", "buriedVault", "subterraneanCivilization", "geothermalChamber"];

export const WR11_ADDED_IDS: ReadonlySet<string> = new Set([
  "expedition:POI_CATALOG:buriedVault:relicOddsMult",
  "expedition:POI_CATALOG:subterraneanCivilization:relicOddsMult",
  "expedition:POI_CATALOG:crashedShip:materialMult",
  "expedition:POI_CATALOG:xenoFloraBloom:materialMult",
  "expedition:POI_CATALOG:derelictOutpost:materialMult",
  "expedition:POI_CATALOG:geothermalChamber:materialMult",
  "expedition:PLANET_TYPES:ocean:surfaceWorkMult",
  "facility:ITEMS:salvagedCircuitry:sellValue",
  "facility:ITEMS:precursorCircuit:sellValue",
  "relic:audit:scienceTeamPowerMembers",
]);

type Before = { status: WiringEntry["status"]; contexts: string[]; probe: string | undefined };
const audit = (owner: string): Before => ({ status: pending(owner), contexts: [], probe: undefined });
export const WR11_FLIPPED_BEFORE: Readonly<Record<string, Before>> = {
  "fleetAdmiral:HOMEWORLD_TALENTS:fleetLogisticsSalvage:ceiling": {
    status: pending("WR-11, OC-J1 (the +1 tier is clamped and wasted from FA 15, B16)", ["salvage:topTier"]),
    contexts: ["salvage"],
    probe: "salvageTalentCeiling",
  },
  ...Object.fromEntries(POI_IDS.map((id) => [`expedition:POI_CATALOG:${id}:flavor`, audit("WR-11, OC-G4 (never rendered; relic odds and haul do not vary by PoI)")])),
  "ship:audit:statusColor": audit("WR-11 (use in the combat view or delete; no call)"),
  "expedition:audit:siteFlavor": audit("WR-11 (render; no call)"),
  "expedition:audit:anomalyFinding": audit("WR-11, OC-G3"),
  "expedition:audit:anomalySensors": audit("WR-11, OC-G3"),
  "expedition:audit:relicSignature": audit("WR-11 (delete or render; no call)"),
  "expedition:audit:shipEventProfileFields": audit("WR-11, OC-G5"),
  "expedition:audit:planetComments": audit("OC-G6"),
  "mission:audit:unusedFactions": audit("WR-11, OC-I2"),
  "salvage:audit:rolledNarration": audit("WR-11, OC-J2"),
  "salvage:audit:lootTierNames": audit("WR-11, OC-J2"),
  "salvage:audit:deadEndDrops": audit("WR-11, OC-J3"),
  "salvage:audit:affixCountBranches": audit("WR-11, OC-J4"),
  "facility:audit:precursorCircuit": audit("WR-10, OC-J3"),
};
export const WR11_FLIPPED_IDS: ReadonlySet<string> = new Set(Object.keys(WR11_FLIPPED_BEFORE));

const CARGO_BEFORE = pending("WR-11, OC-I1 (overwritten by the hull hold, model.ts:3733)");

export function wr11ReadBack(entries: readonly WiringEntry[]): WiringEntry[] {
  const out: WiringEntry[] = entries
    .filter((e) => !WR11_ADDED_IDS.has(e.id))
    .map((e) => {
      const before = WR11_FLIPPED_BEFORE[e.id];
      return before ? ({ ...e, status: before.status, contexts: before.contexts, probe: before.probe } as unknown as WiringEntry) : e;
    });
  // The removed cargoCapacity rows, each right after its mission's own field rows (the order missionEntries pushed them).
  // The Cometary Ice Harvest's rows are an RX addition every chain holds apart (reactorFuelGoldens.fixture.ts
  // RX_ADDED_ENTRY_IDS, read off today's registry), so its deleted row is not put back.
  for (const key of Object.keys(MISSIONS).filter((k) => k !== "cometIceHarvest")) {
    const prefix = `mission:MISSIONS:${key}:`;
    let at = out.findIndex((e) => e.id.startsWith(prefix));
    if (at < 0) throw new Error(`wr11ReadBack: no rows for mission ${key}`);
    while (at < out.length && out[at].id.startsWith(prefix)) at += 1;
    out.splice(at, 0, { id: `${prefix}cargoCapacity`, status: CARGO_BEFORE, contexts: [], probe: undefined } as unknown as WiringEntry);
  }
  return out;
}
