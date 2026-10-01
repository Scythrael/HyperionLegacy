// relicReveal.ts: the IDENTIFICATION REVEAL view model (Exploration 0.14.0, E4c).
//
// The Research facility's Relics sub-tab shows a reveal card for the most recently completed relic
// study. App.svelte feeds it through an OBSERVER (the same posture as the Salvage Bay's last-salvage
// readout): it watches relicStudy processes enter, and when one LEAVES it reads the COMPLETED-EVENTS
// RECORD the resolver wrote (state.completionLog, kind "relicStudy", subjectKey = the identified relic
// id). It is NEVER an inventory diff of the museum: a diff across the completing update is not
// attributable (a dev grant or a second lane could move the same counts), the record is authored by the
// code that actually granted the copy.
//
// The two pure helpers below are the observer's whole decision surface, kept out of App.svelte so they
// are unit-testable:
//   - pickRelicStudyRecord: which record belongs to a study that just left.
//   - buildRelicReveal: the card's view model, from that record + the post-completion state.

import type { CompletionLogEntry, GameState, RelicSetId, EquipmentRarity } from "./game/model";
import { getRelicById, getRelicSetById, relicCopies, setCompletion, type RelicRarity } from "./game/relics";

export interface RelicReveal {
  recordId: string; // the completion record this reveal was read from (stable key for the card)
  relicId: string;
  relicLabel: string;
  flavor: string;
  rarity: RelicRarity;
  setId: RelicSetId;
  setLabel: string;
  index: number; // 1-based K-piece position
  setSize: number; // relics in the set
  tokenTier: EquipmentRarity | null; // the studied token's tier (provenance), when the observer saw it
  firstFind: boolean; // the first identified copy of this relic type (the discovery moment)
  copyNumber: number; // this copy's number in the Museum (the museum count right after it landed)
  setCollected: number; // distinct relics of the set now held
}

// The relicStudy completion records in the log that are NOT in `seenIds` (the ids that already existed
// when the study was first watched), oldest first. Pure.
export function unseenRelicStudyRecords(
  log: readonly CompletionLogEntry[],
  seenIds: ReadonlySet<string>,
): CompletionLogEntry[] {
  return log.filter((e) => e.kind === "relicStudy" && e.reward === "relic" && e.subjectKey !== null && !seenIds.has(e.id));
}

// Which unseen record belongs to a study that just left. When the observer knows the study's token, it
// passes `expectedRelicId` (the relic the engine's keyed roll derives for that study, the same derivation
// the resolver wrote the record from), and ONLY a record naming that relic is accepted: two studies
// finishing in one update can never swap reveals, and a save swapped out from under a watched study (an
// import / reset) cannot borrow an unrelated record. With no expectation (a malformed process), the OLDEST
// unseen record is taken. null when nothing matches (a log that evicted it, or an unknown-set no-op that
// wrote reward "nothing"). Pure.
export function pickRelicStudyRecord(
  unseen: readonly CompletionLogEntry[],
  expectedRelicId: string | null,
): CompletionLogEntry | null {
  if (expectedRelicId !== null) return unseen.find((e) => e.subjectKey === expectedRelicId) ?? null;
  return unseen[0] ?? null;
}

// The reveal card's view model. `state` is the POST-completion state (the copy has landed), so the copy
// number and the set's collected count read the museum as the player now holds it. `firstFind` is
// decided by the observer (was the relic absent from the discovered registry when the study started).
// null for a record naming an unknown relic (a tampered save). Pure.
export function buildRelicReveal(
  state: GameState,
  record: CompletionLogEntry,
  firstFind: boolean,
  tokenTier: EquipmentRarity | null,
): RelicReveal | null {
  const relicId = record.subjectKey;
  if (relicId === null) return null;
  const def = getRelicById(relicId);
  if (!def) return null;
  const set = getRelicSetById(def.setId);
  const museum = state.relicMuseum ?? {};
  return {
    recordId: record.id,
    relicId,
    relicLabel: def.label,
    flavor: def.flavor,
    rarity: def.rarity,
    setId: def.setId,
    setLabel: set?.label ?? def.setId,
    index: def.index,
    setSize: set?.relicIds.length ?? 0,
    tokenTier,
    firstFind,
    copyNumber: Math.max(1, relicCopies(museum, relicId)),
    setCollected: setCompletion(museum, def.setId).collected,
  };
}
