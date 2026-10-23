// codes.ts: the gift code seam behind Settings > Codes (0.13.11).
//
// 0.13.11 ships with an EMPTY code table (user, answer 10: "Box only, no codes yet"), so every
// code answers "not recognized". The redeem path is still a real seam: a later patch adds entries
// to CODE_TABLE (normalized code -> gift id) and handles the "redeemed" result. No reward plumbing
// exists yet, and codes are never logged anywhere.

export type RedeemResult = { kind: "empty" } | { kind: "unknown" } | { kind: "redeemed"; giftId: string };

// Normalized code (trimmed, uppercase) -> gift id. Empty on purpose in 0.13.11.
export const CODE_TABLE: ReadonlyMap<string, string> = new Map();

export function normalizeCode(raw: string): string {
  return raw.trim().toUpperCase();
}

export function redeemCode(raw: string, table: ReadonlyMap<string, string> = CODE_TABLE): RedeemResult {
  const code = normalizeCode(raw);
  if (code.length === 0) return { kind: "empty" };
  const giftId = table.get(code);
  return giftId === undefined ? { kind: "unknown" } : { kind: "redeemed", giftId };
}

export function redeemMessage(result: RedeemResult): string {
  switch (result.kind) {
    case "empty":
      return "Type a code first.";
    case "unknown":
      return "That code isn't recognized.";
    case "redeemed":
      return "Gift claimed.";
  }
}
