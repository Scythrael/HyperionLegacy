// Homeworld reserve controls in the transfer picker (user 2026-11-12 evening, docs/mockups/2026-11-12-homeworld-reserve-
// controls-mockup.html sections 3 to 5): every word and number the picker shows with the reserve as the source, read
// from the one engine preview. The engine rules themselves are src/lib/game/homeworldReserveControls.test.ts.
import { describe, expect, it } from "vitest";
import { freshState, shipDisplayLabel, type CrewBucket, type CrewProfession, type GameState } from "./game/model";
import { signatureKey } from "./game/crew";
import { CREW_POOL, HOMEWORLD_RESERVE, transferCrew } from "./game/crewTransfer";
import { CREW_PROFESSION_BUFFS } from "./game/crewBuffs";
import { remainingCapacityForSignature } from "./game/commandStructure";
import { transferDestinations, transferLogLine, transferPreview, transferResultView } from "./crewTransferDisplay";

function group(profession: CrewProfession, count: number, race: CrewBucket["race"] = "belter"): CrewBucket {
  return { profession, rarity: "standard", rank: 1, race, buff1Id: CREW_PROFESSION_BUFFS[profession][0].id, buff2Id: null, count };
}

// freshState's freighter, MANUAL and empty, with the given pool and reserve.
function fleet(pool: CrewBucket[], reserve: CrewBucket[]): GameState {
  const base = freshState();
  return {
    ...base,
    crewPool: pool,
    ...(reserve.length > 0 ? { homeworldReserve: reserve } : {}),
    ships: base.ships.map((sh) => ({ ...sh, complement: { buckets: [], mode: "active" as const } })),
  };
}
const ROOM = remainingCapacityForSignature({ buckets: [], mode: "active" }, freshState().ships[0].typeKey, group("operations", 1), 0);
const fmt = (n: number) => n.toLocaleString("en-US");

describe("the reserve's picker: Send to a ship", () => {
  it("rows read 'in reserve', a short row says the rest stay in the reserve, and the summary names the ship's berths", () => {
    const g = group("operations", ROOM + 5);
    const s = fleet([], [g]);
    const ship = s.ships[0];
    const name = shipDisplayLabel(s, ship);
    const p = transferPreview(s, HOMEWORLD_RESERVE, ship.id, [{ signatureKey: signatureKey(g), count: g.count }]);
    expect(p.rows[0].availableText).toBe(`${fmt(ROOM + 5)} in reserve`);
    expect(p.willMove).toBe(ROOM);
    expect(p.rows[0].noteText).toMatch(new RegExp(`^Room for ${fmt(ROOM)}: .*\\. The other 5 stay in the reserve\\.$`));
    expect(p.summary).toContain(`Moving ${fmt(ROOM + 5)} to ${name}: room for ${fmt(ROOM)}, 5 stay in the reserve.`);
    expect(p.buttonLabel).toBe(`Transfer ${fmt(ROOM)}`);
    expect(p.swapCount).toBe(0);
    expect(p.swapWarning).toBeNull();
    const res = transferCrew(s, HOMEWORLD_RESERVE, ship.id, [{ signatureKey: signatureKey(g), count: g.count }]);
    const view = transferResultView(s, HOMEWORLD_RESERVE, ship.id, res);
    expect(view.heading).toBe(`Moved ${fmt(ROOM)} of ${fmt(ROOM + 5)} to ${name}`);
    expect(view.footer).toBe("Logged to the fleet log. Nobody was lost: the 5 without room are still in the Homeworld reserve.");
    expect(transferLogLine(s, HOMEWORLD_RESERVE, ship.id, res)).toBe(`Transferred ${fmt(ROOM)} crew from the Homeworld reserve to ${name} (5 stayed: no room).`);
  });

  it("warns first: pool crew the Send leaves without a berth, and how many move to the reserve at the next tick", () => {
    const kept = group("operations", ROOM, "belter");
    const sent = group("operations", 4, "martian");
    const s = fleet([kept], [sent]);
    const ship = s.ships[0];
    const name = shipDisplayLabel(s, ship);
    const p = transferPreview(s, HOMEWORLD_RESERVE, ship.id, [{ signatureKey: signatureKey(sent), count: 4 }]);
    expect(p.swapCount).toBe(4);
    expect(p.swapWarning).toBe(
      `${fmt(ROOM)} of the Belter operations group at Crewman wait in the crew pool for open berths. After this, the fleet has ${fmt(ROOM - 4)} berths left that can seat them (${name}), so 4 of them move to the reserve at the next tick. Nobody is lost.`,
    );
    expect(p.shortSwapWarning).toBe("4 Belter operations crew at Crewman in the pool move to the reserve at the next tick.");
  });
});

describe("the reserve's picker: Recall to the pool", () => {
  it("each row's room is the fleet's open berths less what of the group waits in the pool; the summary says what waits for whom", () => {
    const waiting = group("operations", 3);
    const g = group("operations", ROOM + 10);
    const s = fleet([waiting], [g]);
    const name = shipDisplayLabel(s, s.ships[0]);
    const p = transferPreview(s, HOMEWORLD_RESERVE, CREW_POOL, [{ signatureKey: signatureKey(g), count: g.count }]);
    expect(p.willMove).toBe(ROOM - 3);
    expect(p.rows[0].noteText).toBe(
      `Room for ${fmt(ROOM - 3)}: the fleet has ${fmt(ROOM)} open Operations berths (${name} ${fmt(ROOM)}) and 3 of this group already wait in the pool. The other 13 stay in the reserve.`,
    );
    expect(p.rows[0].shortNoteText).toBe(`Room for ${fmt(ROOM - 3)}. The other 13 stay.`);
    expect(p.summary).toBe(
      `Recalling ${fmt(ROOM - 3)} of ${fmt(ROOM + 10)} to the crew pool; 13 stay in the reserve. In the pool they wait for ${name} (manual: send them on from the pool).`,
    );
    expect(p.buttonLabel).toBe(`Recall ${fmt(ROOM - 3)}`);
    const res = transferCrew(s, HOMEWORLD_RESERVE, CREW_POOL, [{ signatureKey: signatureKey(g), count: g.count }]);
    const view = transferResultView(s, HOMEWORLD_RESERVE, CREW_POOL, res);
    expect(view.heading).toBe(`Recalled ${fmt(ROOM - 3)} of ${fmt(ROOM + 10)} to the crew pool`);
    expect(view.rows[0].why).toBe("No more berths in the fleet can seat that crew.");
  });

  it("no ship with room: Recall reads 0 and the picker says why (mockup section 5)", () => {
    const g = group("operations", 1847);
    const s = { ...fleet([], [g]), ships: [] };
    const cards = transferDestinations(s, HOMEWORLD_RESERVE);
    expect(cards.map((c) => c.id)).toEqual([CREW_POOL]);
    const p = transferPreview(s, HOMEWORLD_RESERVE, CREW_POOL, [{ signatureKey: signatureKey(g), count: g.count }]);
    expect(p.willMove).toBe(0);
    expect(p.buttonLabel).toBe("Recall 0");
    expect(p.rows[0].noteText).toBe("No room: no berth in the fleet is open for Operations at Crewman. All 1,847 stay in the reserve.");
    expect(p.summary).toBe(
      "No ship can take crew from the reserve right now: every manual ship is full, and the rest are on auto-crew or out. Room opens when a new ship joins, a quarters module goes in, or you send crew back from a manual ship.",
    );
  });

  it("an auto-crew ship's open berths are named as taking from the pool before the reserve", () => {
    const g = group("operations", 5);
    const base = fleet([], [g]);
    const s = { ...base, ships: base.ships.map((sh) => ({ ...sh, complement: { buckets: [], mode: "passive" as const } })) };
    const p = transferPreview(s, HOMEWORLD_RESERVE, CREW_POOL, [{ signatureKey: signatureKey(g), count: 5 }]);
    expect(p.willMove).toBe(5);
    expect(p.summary).toBe(`Recalling 5 to the crew pool. In the pool they wait for ${shipDisplayLabel(s, s.ships[0])} (auto-crew: takes from the pool before the reserve).`);
  });
});
