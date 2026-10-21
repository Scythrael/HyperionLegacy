// Quartermaster Standard-Issue member gear stats (0.14.0): the "turn it off" switch the golden tests use to prove what
// the stats moved. TEST-ONLY (imported by *.test.ts files only).
//
// With the switch ON (for the duration of one call, restored after, nothing else touched) the Standard-Issue points
// are 0 (model.ts STANDARD_ISSUE_MEMBER_GEAR), so: a member baseline mints with its zero signature lines, exactly
// the piece the Quartermaster issued before; the every-load re-stat (save.ts withStandardIssueMemberLinesV70) changes
// nothing; and the crafted member-gear floor (itemgen.ts craftedItemLevelFloor) is off. A fixture computed inside it
// is the pre-change fixture exactly.

import { STANDARD_ISSUE_MEMBER_GEAR } from "./model";

export function withSiMemberGearOff<T>(run: () => T): T {
  const saved = STANDARD_ISSUE_MEMBER_GEAR.points;
  try {
    STANDARD_ISSUE_MEMBER_GEAR.points = 0;
    return run();
  } finally {
    STANDARD_ISSUE_MEMBER_GEAR.points = saved;
  }
}
