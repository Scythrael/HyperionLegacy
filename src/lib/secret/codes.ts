// codes.ts: the gift code table behind Settings > Codes (0.13.11, real codes from 0.13.11.1).
//
// A code is normalized (uppercase, spaces and dashes removed) and compared by its SHA-256, so the
// client never carries a code in plain text (design 0.13.11.1 section 2). Codes are never logged.
// The reward itself is paid by accountExtras.redeemGift through App's do* handler; this file only
// knows which gift a code names, and the "already redeemed" humor lines.

import { sha256Hex } from "./sha256";

export type GiftId = "leetCredits";

export interface GiftDef {
  credits: number;
}

export const GIFTS: Readonly<Record<GiftId, GiftDef>> = {
  // The first real code (user, 2026-10-23): 1,337 credits, once per account.
  leetCredits: { credits: 1337 },
};

// SHA-256 of the normalized code -> gift id.
export const CODE_TABLE: ReadonlyMap<string, GiftId> = new Map([
  ["60ea0be87ffa310c1c237f2e84ab22646d6e2eaca9d3acccd456dd75d57b195c", "leetCredits"],
]);

export type LookupResult = { kind: "empty" } | { kind: "unknown" } | { kind: "gift"; giftId: GiftId };

export function normalizeCode(raw: string): string {
  return raw.toUpperCase().replace(/[\s-]+/g, "");
}

export function lookupCode(raw: string, table: ReadonlyMap<string, GiftId> = CODE_TABLE): LookupResult {
  const code = normalizeCode(raw);
  if (code.length === 0) return { kind: "empty" };
  const giftId = table.get(sha256Hex(code));
  return giftId === undefined ? { kind: "unknown" } : { kind: "gift", giftId };
}

// The 40 approved "already redeemed" lines (docs/plans/2026-10-23-code-redeemed-joke-lines.md, user
// 2026-10-23: "I LOVE THE MD FILE"). From the third re-entry in a row one is added at random, never
// the same one twice running. Ids are 1-based positions in this list and are stored in the save,
// so the list is append-only: never reorder or remove a line.
export const JOKE_LINES: readonly string[] = [
  "Why won't you leave any for us, Fleet Admiral? Space orphans are out there starving.",
  "The quartermaster has started labeling the credit vault 'Not For The Admiral.'",
  "Accounting would like a word. Several words, actually.",
  "Sensors detect a 1,337-credit-shaped hole in the budget. It has your name on it.",
  "This code has been redeemed. Also re-redeemed. Also re-re-redeemed. The paperwork is getting tall.",
  "Fleet Command reminds you that credits do not grow back if you stare at them.",
  "Your crew has started a betting pool on how many times you'll try this.",
  "The code vault is empty. We checked. Twice. You were watching.",
  "Somewhere, a junior ensign is filling out Form 27-B in triplicate because of you.",
  "Attempting to redeem this again has been logged under 'Admiral, Persistent.'",
  "The economy of three star systems just flinched.",
  "Even the salvage drones think this is a bit much.",
  "Your reflection in the viewport looks disappointed. It's not angry. Just disappointed.",
  "The galaxy is vast, cold and indifferent. The credit vault is all three, plus locked.",
  "We admire your optimism. We do not reward it.",
  "Fun fact: repeated code entry burns more calories than a full patrol shift. Not by much.",
  "The Museum has requested a plaque for your dedication. It will not include credits.",
  "Your officers have quietly hidden the coffee budget.",
  "Error 1337: Admiral greed exceeds known parameters.",
  "A freighter captain three sectors over just felt their wallet tremble.",
  "The code has been redeemed. The code remembers you. The code is tired.",
  "This is the part of the story where the hero learns that enough is enough. Any minute now.",
  "Long-range scans show no new credits in this code. Short-range scans agree.",
  "The space orphans have formed a union. They have demands.",
  "Your Engineering officer suggests rerouting your ambition to the shield array.",
  "We have alerted the Bureau of Interstellar Generosity. They laughed.",
  "Credits, like hull integrity, are best not spent twice.",
  "Your persistence has been noted, filed, cross-referenced and gently ignored.",
  "Even a black hole knows when to stop. Actually, no, it doesn't. Bad example.",
  "Please hold. Your request is important to us. It is also impossible.",
  "The Archive has added a new entry: 'Admiral, repeated attempts, see also: greed, endless.'",
  "Morale report: crew is fine. Admiral is clicking the same button again.",
  "If you redeem it one more time, it still won't work, but the button will feel appreciated.",
  "Your fleet's chaplain has begun a sermon on contentment. You are the example.",
  "The universe is expanding. Your credit balance, from this code, is not.",
  "Somewhere a reactor core whispers: 'let it go.'",
  "The quartermaster has changed the vault code. It is now 'NOPE.'",
  "Breaking news: local Admiral still trying. More at eleven.",
  "We're starting to think you just like the sound of the Redeem button.",
  "Congratulations! You've unlocked... nothing. Again. Impressive consistency, though.",
];

// A random line id (1 to 40), never `lastShown`: one of the other 39, uniformly.
export function pickJokeLine(lastShown: number | null, rng: () => number): number {
  const n = JOKE_LINES.length;
  const pool = lastShown !== null && lastShown >= 1 && lastShown <= n ? n - 1 : n;
  const r = Math.min(pool - 1, Math.max(0, Math.floor(rng() * pool)));
  const id = r + 1;
  return lastShown !== null && pool === n - 1 && id >= lastShown ? id + 1 : id;
}
