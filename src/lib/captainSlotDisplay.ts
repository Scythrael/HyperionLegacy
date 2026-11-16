// FR-C R3 (QA 2026-11-14 R3-1): a locked captain slot on the Captain Roster names what unlocks it, not only "Recruit via
// Homeworld Talents -> Fleet Logistics". Read from the talent table (HOMEWORLD_TALENTS' unlockCaptainSlot nodes, in table
// order: the 2nd captain's node first), so a retuned cost or level wall changes this text with it. Pure.
import { HOMEWORLD_TALENTS, type HomeworldTalentKey } from "./game/model";

const SLOT_NODES: readonly HomeworldTalentKey[] = (Object.keys(HOMEWORLD_TALENTS) as HomeworldTalentKey[]).filter(
  (k) => HOMEWORLD_TALENTS[k].effect.type === "unlockCaptainSlot",
);

export interface LockedCaptainSlotRequirement {
  talentKey: HomeworldTalentKey;
  talentLabel: string;
  adminPoints: number;
  fleetAdminLevel: number | null; // null: no Fleet Admiral level wall
  text: string;                   // the roster line
}

// The requirement for the captain numbered `captainNumber` (2 is the first recruit), or null for a slot no talent opens
// yet (the "Coming Soon" slots) or the starting captain.
export function lockedCaptainSlotRequirement(captainNumber: number): LockedCaptainSlotRequirement | null {
  const key = SLOT_NODES[captainNumber - 2];
  if (key === undefined) return null;
  const def = HOMEWORLD_TALENTS[key];
  const level = def.requiresFleetAdminLevel ?? null;
  const parts = [`${def.cost} Admin Point${def.cost === 1 ? "" : "s"}`];
  if (level !== null) parts.push(`Fleet Admiral level ${level}`);
  return {
    talentKey: key,
    talentLabel: def.label,
    adminPoints: def.cost,
    fleetAdminLevel: level,
    text: `Homeworld Talents, Fleet Logistics: ${def.label}. Needs ${parts.join(" and ")}.`,
  };
}
