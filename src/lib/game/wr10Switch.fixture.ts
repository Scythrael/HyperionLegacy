// Wiring WR-10 (docs/plans/2026-10-15-wiring-registry-and-audit-plan.md section 4 WR-10): the test-only switch golden
// files use to prove what WR-10 moved (the withWr11Off precedent). TEST-ONLY (imported by *.test.ts files only).
//
// WR-10 moves these things: a dispatch stamps the away rules (Expedition.awayRules), under which the run's ground fights
// bring Neural Backup's WEARER back (OC-F2), shield a member who falls back for that round (OC-F6) and let every enemy
// caster's hits leave a member Corroded (OC-F9), and its fieldwork counts each Science member's rank (OC-F7); and a
// Security hire starts with the account pair's program when the player changed it (OC-F12). With the switch OFF
// (model.ts WR10_SWITCH.live false, for one call or one file, restored after) none of these is written, so every run and
// hire made inside it is the pre-WR-10 game exactly.

import { afterAll } from "vitest";
import { WR10_SWITCH } from "./model";

export function withWr10Off<T>(run: () => T): T {
  const was = WR10_SWITCH.live;
  WR10_SWITCH.live = false;
  try {
    return run();
  } finally {
    WR10_SWITCH.live = was;
  }
}

// For a golden FILE captured before WR-10 whose pins are about another slice: the whole file runs with WR-10 off, and its
// pins keep proving that slice moved nothing else. Called once at the file's top level, restored after its last test.
export function wr10OffForThisFile(): void {
  const was = WR10_SWITCH.live;
  WR10_SWITCH.live = false;
  afterAll(() => {
    WR10_SWITCH.live = was;
  });
}
