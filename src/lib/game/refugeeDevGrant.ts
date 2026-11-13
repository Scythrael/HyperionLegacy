// E5-6b: the [DEV] refugee grant (Debug tab only, DEV_MODE builds), so QA can see arrivals, the arrival card, the toast
// and an echo refugee without flying fifty Evacuations. A RAW test grant: it bypasses the run, the taper and the log,
// but the person is minted by the real roll (rollRefugee on a real board roll), so every field is one the game itself
// would write, and an echo counts toward the save's once-per-save list exactly like an arrival.

import type { GameState } from "./model";
import { rollRefugee } from "./refugeeArrival";
import { refugeesOf, type RefugeeRecord } from "./refugees";
import { rollShortRangeJob } from "./shortRange";
import { shortRangeBoardSlots } from "./shortRangeBoard";

// One refugee joins the waiting list (and the arrival cards): `normal` the first board roll that brings a normal
// refugee, `echo` the first that brings an echo still to come. Null when no such roll is found (an echo once all have
// arrived). Pure.
export function devGrantRefugee(state: GameState, kind: "normal" | "echo"): { next: GameState; record: RefugeeRecord } | null {
  const refugees = refugeesOf(state);
  const slots = shortRangeBoardSlots(state);
  if (slots.length === 0) return null;
  const arrived = refugees.echoes ?? [];
  const at = Number.isFinite(state.gameTimeSeconds) ? Math.max(0, state.gameTimeSeconds) : 0;
  const from = refugees.nextId * 97;
  for (let i = 0; i < 20000; i++) {
    const slot = slots[i % slots.length];
    const roll = rollShortRangeJob(state, slot, from + Math.floor(i / slots.length));
    const record = rollRefugee(roll, refugees.nextId, at, arrived);
    if ((kind === "echo") !== (record.echo !== undefined)) continue;
    const next: GameState = {
      ...state,
      refugees: {
        ...refugees,
        list: [...refugees.list, record],
        nextId: refugees.nextId + 1,
        arrivedTotal: refugees.arrivedTotal + 1,
        greet: [...refugees.greet, record.id],
        ...(record.echo !== undefined ? { echoes: [...arrived, record.echo] } : {}),
      },
    };
    return { next, record };
  }
  return null;
}
