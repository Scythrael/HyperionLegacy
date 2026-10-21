// Quartermaster Standard-Issue member gear (0.14.0): the "turn it off" switch the golden tests use to prove what the
// change moved. TEST-ONLY (imported by *.test.ts files only); game code carries no switch.
//
// With the switch ON (for the duration of one call, restored after, nothing else touched), the catalog reads as it
// did before the change, the precedent of the other switch fixtures (they edit catalog data the same way):
//   - the Standard-Issue share table (model.ts STANDARD_ISSUE_MEMBER_SHARES) is empty, so a member baseline mints with
//     its zero signature lines, the every-load raise (save.ts withStandardIssueMemberLinesV70) has nothing to add, and
//     the crafted budget floor (model.ts craftedMemberFloorImplicits: its total is 0 with no rows) is off;
//   - unless `scienceLines: false`, the Sidearm, Field Suit and Hazard Suit carry their pre-D26 lines and pools again
//     (the line swap of the same change).
// A fixture computed inside it is the pre-change fixture exactly. (The load remap of pre-swap pieces,
// SCIENCE_LINE_REMAP, only moves held equipment, never a frozen run, so no fixture here needs it reverted.)

import { EQUIPMENT_SLOTS, STANDARD_ISSUE_MEMBER_SHARES, type EquipmentVarietyDef } from "./model";

type Lines = Pick<EquipmentVarietyDef, "implicitStats" | "affixPool" | "statRatios">;

// The three varieties as they stood before the D26 line swap.
const PRE_SWAP: Readonly<Record<string, readonly [string, Lines]>> = {
  sidearm: ["memberWeapon", { implicitStats: undefined, affixPool: undefined, statRatios: { groundPower: 0.45, groundAccuracy: 0.45, groundStatusChance: 0.1 } }],
  fieldSuit: [
    "memberArmor",
    {
      implicitStats: undefined,
      affixPool: [
        { stat: "groundFieldwork", weight: 3 },
        { stat: "groundArmor", weight: 2 },
        { stat: "groundHp", weight: 2 },
      ],
      statRatios: { groundFieldwork: 0.5, groundArmor: 0.3, groundHp: 0.2 },
    },
  ],
  hazardSuit: [
    "memberArmor",
    {
      implicitStats: ["groundHazardResist"],
      affixPool: [
        { stat: "groundHazardResist", weight: 4 },
        { stat: "groundArmor", weight: 2 },
        { stat: "groundHp", weight: 2 },
      ],
      statRatios: { groundHazardResist: 0.6, groundArmor: 0.2, groundHp: 0.2 },
    },
  ],
};

// The variety `key` of `slot` as it stood before the swap: a copy with the old lines, never an edit of the catalog's
// own object (the original goes back in its place after the call, so nothing about it changes).
function preSwap(v: EquipmentVarietyDef, lines: Lines): EquipmentVarietyDef {
  const out = { ...v } as Partial<EquipmentVarietyDef>;
  for (const k of ["implicitStats", "affixPool", "statRatios"] as const) {
    if (lines[k] === undefined) delete out[k];
    else (out as Record<string, unknown>)[k] = lines[k];
  }
  return out as EquipmentVarietyDef;
}

export function withSiMemberGearOff<T>(run: () => T, opts: { scienceLines?: boolean } = {}): T {
  const shares = STANDARD_ISSUE_MEMBER_SHARES as Record<string, unknown>;
  const savedShares = { ...shares };
  const swap = opts.scienceLines !== false;
  const slots = Object.entries(PRE_SWAP).map(([key, [slot, lines]]) => {
    const list = EQUIPMENT_SLOTS[slot].varieties;
    const index = list.findIndex((x) => x.key === key);
    if (index < 0) throw new Error(`withSiMemberGearOff: no variety ${key}`);
    return { list, index, original: list[index], lines };
  });
  try {
    for (const k of Object.keys(shares)) delete shares[k];
    if (swap) for (const { list, index, original, lines } of slots) list[index] = preSwap(original, lines);
    return run();
  } finally {
    Object.assign(shares, savedShares);
    if (swap) for (const { list, index, original } of slots) list[index] = original;
  }
}
