import { it } from "vitest";
import { rampRun, rampSeed, tally } from "./safeFirstRamp.fixture";
import { withWr10Off } from "./wr10Switch.fixture";
import { writeFileSync } from "node:fs";
const KS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
for (const crew of ["d18", "rank1", "rank1si"] as const) {
  it(`off ${crew}`, { timeout: 3_600_000 }, () => {
    const cells = KS.map((k) => {
      const t = withWr10Off(() => tally(Array.from({ length: 200 }, (_, i) => rampRun("orion", crew, k, rampSeed(i)))));
      return `${t.stalled}/${t.anyLost}/${t.lostFights}/${t.vaultWon}:${t.vaultSites}`;
    });
    writeFileSync(`C:/Users/berga/AppData/Local/Temp/claude/3faaebaf867e9695/98207591-ca65-4871-8a5d-83c699d63043/scratchpad/off-${crew}.json`, JSON.stringify(cells));
  });
}
