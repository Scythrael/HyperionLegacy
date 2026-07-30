// ============================================================================
// captainName.ts -- captain custom-name validation seam (Combat 0.13.0, Task 1.4)
//
// ⚠️ CLIENT-SIDE COURTESY ONLY. This is a deliberately MINIMAL, fully
// BYPASSABLE gate. It runs in the player's browser to give immediate, friendly
// feedback while they type a captain name; a determined user can trivially
// route around it (edit save, hit any future API directly). It is NOT a
// security boundary and must never be treated as one.
//
// WHY it exists anyway: it is the SINGLE CHOKEPOINT every rename flows through
// (renameCaptain in tick.ts calls exactly this function), so when REAL
// moderation lands SERVER-SIDE in the 0.14.0 online/admin work it plugs into
// THIS same signature -- the client keeps calling validateCaptainName, the
// server runs the authoritative version, and the shapes already match. Keeping
// one seam now avoids a scatter of ad-hoc checks later.
//
// SCOPE, on purpose:
//   - Profanity is the ONLY auto-block target, and the list is TINY + obvious
//     (below). Violence, slurs-by-context, and every other nuance are HAND
//     MODERATED later, not encoded here. A big client-side blocklist is both a
//     maintenance sink and a false-positive machine, so we do not ship one.
//   - The Scunthorpe problem (innocent words that merely CONTAIN a rude
//     substring, e.g. "Scunthorpe", "Assumption") is avoided by matching
//     profanity on TOKEN BOUNDARIES against a lowercased copy, never as a bare
//     substring. A benign name is never rejected for a coincidental substring.
//   - NO external dependency. Zero third-party blocklists, zero network. The
//     attack surface is a handful of string ops on one input.
// ============================================================================

// Max length of a captain name, measured AFTER trimming surrounding whitespace.
// Named so no magic number leaks into the checks (or into the UI, which imports
// this to size its input / show a counter).
export const MAX_CAPTAIN_NAME = 24;

// The entire auto-block list. Kept TINY and unmistakable on purpose (see header):
// these are matched as whole tokens only, case-insensitively. Anything subtler
// is a human-moderation concern, not a client regex concern. Extend with extreme
// reluctance; every entry is a potential false-positive on some real name.
const PROFANITY: string[] = ["fuck", "shit", "cunt", "ass", "bitch", "dick"];

// Allowed characters: ASCII letters, digits, spaces, and a SMALL safe
// punctuation set (. ' - _) that covers real naming needs (Jean-Luc, O'Neil,
// Capt. Vex, Unit_7) without opening the door to markup, control, or lookalike
// characters. Anchored to match the WHOLE string; any stray character fails.
const ALLOWED_CHARSET = /^[A-Za-z0-9 .'\-_]+$/;

// Splits a lowercased name into tokens on the same delimiters we allow between
// words (whitespace + the safe punctuation), so profanity is compared token vs
// token. "captain shit" -> ["captain", "shit"]; "scunthorpe" -> ["scunthorpe"]
// (one token, never equal to "cunt"). The trailing filter drops empty tokens
// produced by adjacent delimiters (e.g. an internal double space).
function tokenize(lowerName: string): string[] {
  return lowerName.split(/[\s.'\-_]+/).filter((token) => token.length > 0);
}

// The one validation chokepoint. Returns a discriminated union so callers
// branch on `.ok` and, on success, use the CLEANED `.value` rather than the raw
// input. Checks run in a fixed order (empty, tooLong, charset, noAlphanumeric,
// profanity) so the reported reason is the FIRST thing wrong, and each reason is
// independently testable by feeding an input that trips only that check.
export function validateCaptainName(
  raw: string,
):
  | { ok: true; value: string }
  | { ok: false; reason: "empty" | "tooLong" | "charset" | "noAlphanumeric" | "profanity" } {
  // Trim surrounding whitespace, then COLLAPSE internal whitespace runs to a single
  // space. A name is a display LABEL, not a canvas for spacing tricks; collapsing also
  // blocks "A          B" layout abuse and padding-based impersonation once names show to
  // other players (chat / leaderboards). The cleaned value is what gets stored + compared.
  const trimmed = raw.trim();

  // 1) empty: nothing (or only whitespace) left after trimming.
  if (trimmed.length === 0) {
    return { ok: false, reason: "empty" };
  }

  const cleaned = trimmed.replace(/\s+/g, " ");

  // 2) tooLong: measured on the CLEANED value, so surrounding + collapsed spaces never
  //    count against the player's budget.
  if (cleaned.length > MAX_CAPTAIN_NAME) {
    return { ok: false, reason: "tooLong" };
  }

  // 3) charset: any character outside the allowed set rejects the whole name.
  if (!ALLOWED_CHARSET.test(cleaned)) {
    return { ok: false, reason: "charset" };
  }

  // 4) noAlphanumeric: require at least one letter or digit, so a punctuation-only name
  //    ("....", "----", "_-_") is rejected. A real name always has a letter or number;
  //    this is a cheap impersonation / layout-noise guard for the cross-player display.
  if (!/[A-Za-z0-9]/.test(cleaned)) {
    return { ok: false, reason: "noAlphanumeric" };
  }

  // 5) profanity: whole-token, case-insensitive match against the tiny list.
  //    Token boundaries are what keep innocent substrings (the Scunthorpe
  //    problem) from tripping this.
  const tokens = tokenize(cleaned.toLowerCase());
  if (tokens.some((token) => PROFANITY.includes(token))) {
    return { ok: false, reason: "profanity" };
  }

  // All checks passed: hand back the cleaned value for the caller to store.
  return { ok: true, value: cleaned };
}
