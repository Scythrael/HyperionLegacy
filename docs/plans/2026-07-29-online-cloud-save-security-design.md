# Online + Cloud Save: Security Design Memo (2026-07-29)

Status: DESIGN-TIME (Omega Rule 13, "know the minefield before building"). Nothing here is built. This memo maps the security boundary that appears the moment Clerk accounts + cloud save land, so the online work is designed against it rather than patched after. Authored during the 2026-07-29 autonomous security pass; folds in findings from the save-hostile-input and UGC/XSS hunters (see the marked sections). Cross-refs: `docs/projectdocs/fleet_admiral_technical_spec.md` sec. 9.5-9.7, `KNOWN_ISSUES.md`, SUGGESTIONS.md "Clerk-based auth".

Decided direction (user, 2026-07-29): **Clerk for auth (account creation), then cloud saving.**

---

## 1. The trust boundary moves (the whole point)

Today the game is 100% client-side and single-player: the client computes the entire economy, owns the save in `localStorage`, and only ever shows the player their own data. In that world there is no meaningful attacker (cheating hurts only yourself), which is why the current "trust the save" posture is fine.

Cloud save + accounts change three things at once:
1. The save blob travels client -> server -> client. A blob the client loads may have been crafted by an attacker (shared save, a tampered cloud row, a malicious import file).
2. User text (captain names, planned ship names) is stored server-side and, with any future multiplayer/leaderboard, shown to OTHER players. It becomes untrusted content crossing a trust boundary.
3. Identity exists. Authorization (who may read/write WHICH save) becomes a thing that can be violated.

Everything below follows from those three.

---

## 2. Core principle: the client is never authoritative

The server must treat every uploaded save as UNTRUSTED. It must NOT "just store and return" a client blob if that blob confers anything competitive, purchasable, or shown to others without validation.

- For a PvE, single-player game, an honor-system cloud save (server stores an opaque per-user blob) is an ACCEPTABLE, explicitly-documented risk: the only person a cheater harms is themselves. This matches the tech spec's "do not over-engineer anti-piracy" (sec. 9.5.2) and the single-player-first philosophy.
- The instant a feature makes one player's numbers affect another (PvP, leaderboards, shared/traded items, competitive events), the honor-system model is INSUFFICIENT and the server must validate or re-simulate. Gate every such feature behind server-side validation; never let it read an unvalidated client blob.

### What is already GOOD (leverage it)
- The combat sim is deterministic + seeded + headless (`resolveBattle(participants, seed) -> outcome`, pure). A server can RE-SIMULATE a battle to verify a claimed result.
- The economy is closed-form + offline-tickable. A server can independently advance / bounds-check progression rather than trusting client-reported totals.
- These two properties are the anti-cheat foundation. The seams are already in place (they keep online additive). Do NOT break determinism or the offline==live invariant, they are load-bearing for server-side validation.

RECOMMENDATION: ship cloud save as honor-system first (per-user opaque blob, validated only for well-formedness + sane bounds, see sec. 4), and keep the save schema versioned + the sim deterministic so authoritative validation can be ADDED for competitive features without a rewrite.

---

## 3. Clerk auth: the standard pitfalls, up front

1. **Key hygiene.** Publishable key only in the client bundle. The Clerk SECRET key lives server-side (Vercel serverless env var) and NEVER ships to the client or the repo. (Confirmed 2026-07-29: no secrets in the repo today. Keep it that way, env vars only, add `.env*` to gitignore before any key exists.)
2. **Authentication != authorization.** Verifying "a valid Clerk session exists" is NOT enough. Every cloud-save read/write endpoint must:
   - Verify the Clerk session/JWT SERVER-SIDE (Clerk backend SDK / JWKS), on every request. Never trust a client assertion that it is logged in.
   - Derive the user id from the VERIFIED session, and key the save row by THAT id. Never accept a client-supplied `user_id`/email/row-id to select which save to load or write. This is the IDOR trap: without it, user A requests user B's save id and reads/overwrites it.
3. **Never trust client-sent identity/role/entitlement.** Supporter/paid flags, user id, and any entitlement must be derived server-side from the verified session + a server-side entitlement check (tech spec sec. 9.5.2's `checkEntitlements` hook), not read from the save or a client claim.
4. **Transport + CORS.** HTTPS only; lock CORS to the game's own origin(s); no wildcard.
5. **Abuse limits.** Rate-limit save writes per user; enforce a hard server-side max save size (tech spec says <100KB, enforce it, reject oversized). Prevents storage-abuse + write-flood DoS.
6. **Privacy/PII.** Auth email + save data are PII: privacy policy required (tech spec sec. 9.5.5), do not log save contents, support account/data deletion.

---

## 4. Save blob as hostile input (present-code hardening)

Before the migrate/hydrate pipeline ingests a save that came from the server or a shared file, it must be robust against a maliciously-crafted (not just accidentally-corrupt) blob. The pipeline was written assuming a self-produced, trusted save.

FIXED this session (the client-side hardening the hunter rated fix-now; all no-ops on a valid save):
- `deserialize()` structurally validates (integer version + non-null object `state`), rejecting malformed blobs to corrupt-recovery (commit `1f793e1`). A well-formedness check, not a full validity check.
- `loadFromLocalStorage` wraps `migrate()` in try/catch (commit `e97d0b0`): a wrong-typed FIELD (captains a string, a mission missing `cargo`, `lifetimeStats` null) that throws in `hydrateDecimals` now routes to corrupt-recovery instead of white-screening on every reload. Highest-leverage single fix, it turns every type-confusion brick into a recoverable corrupt-save.
- `tickDurationSeconds` reset to 1 if non-finite/non-positive (`e97d0b0`): a crafted 0 made the offline-catch-up divisor Infinity, `for (i < Infinity)` hard tab HANG. A throw-guard cannot catch a hang, so this is a value check.
- `hydrateDecimalMap`/`hydrateInventoryBuckets` skip `__proto__`/`constructor`/`prototype` keys and fail-open on a non-object map (`e97d0b0`): prototype-pollution defense-in-depth on the dynamic-key copy loops. (Hunter verified NO path pollutes `Object.prototype` today, spread-only copies, fresh accumulators, but the guard blocks the class the moment any future deep-merge/"merge two saves" routine lands.)
- `MIGRATIONS[30]` uses `reduce` instead of `Math.max(0, ...captainIds)` (`e97d0b0`): a huge `captains` array would blow the argument-spread limit (RangeError). A decompression-bomb angle, LZString expands a small repetitive blob into a huge array.

STILL DESIGN-TIME (the server must own these, cannot be done client-side):
- **The client guard is a SHAPE check, not a VALIDITY check.** Before `migrate()` runs on any blob that did NOT originate from this client's own `serialize()` (i.e. a cloud download or shared import), run a STRICT schema validator (e.g. zod) that asserts every field's type, that Decimal-string fields parse to FINITE magnitudes within a sane bound, that array lengths (`captains`, `ships`, `equipment`, `activeProcesses`, inventory key count) are under hard caps, and that numeric fields used as loop bounds/cadence/ids are finite and in range. The per-field `??` guards in migrations were written for OUR OWN prior shapes, not adversarial input.
- **Decompression-bomb limits:** enforce a max COMPRESSED size AND a max DECOMPRESSED-JSON size before `JSON.parse`. A tiny LZString blob can expand to tens of MB (repetitive arrays, or a giant Decimal digit-string that `new Decimal()` parses O(n)).
- **Decimal magnitude bounds:** attacker Decimal strings (`credits:"1e1000000000"`) hydrate to `Infinity`/`NaN` Decimals that silently poison comparisons/formatting (low impact locally, but must be rejected before entering a cloud-shared economy).
- **`created_at`/`last_saved_at` are attacker-controlled** and drive `offlineSeconds`; the only thing bounding offline catch-up work is `offlineCapTicks`, which is itself divided by the (now-guarded) `tickDurationSeconds`. The SERVER should stamp/validate timestamps rather than trusting the blob.
- **The server must re-validate and re-simulate, never store-and-serve verbatim.** If shared-save links ever exist, `importRawSave` becomes a remote brick/hang vector against OTHER users; treat every downloaded save as hostile.

---

## 5. User-generated content: names now, more later

Today: captain names are self-viewed and rendered as auto-escaped Svelte text (a prior pass found no `{@html}` on names). Ship names (renamable, backlogged) will be the same shape. Safe in single-player.

Online flips names into untrusted content stored server-side and shown to OTHER players (multiplayer/leaderboards/chat).

HUNTER VERDICT: XSS/injection surface is CLEAN today and captain-name validation is already strong. Findings:
- **No injection sink.** No `{@html}`/`innerHTML`; every name renders as auto-escaped Svelte text interpolation (combat/event log, rename modal, CombatView, Simplified-log tokens). No name reaches a `title`/`aria-label`/`style`/`href`/`src`/URL sink (those all carry static/game-defined constants). The only `fetch` is `updateDetector.ts` `/version.json`, no user string. Svelte escapes attribute expressions too.
- **`validateCaptainName` (`captainName.ts`) is robust:** trimmed length cap 24, ASCII-only charset `^[A-Za-z0-9 .'\-_]+$` (rejects `< > & "` and, being ASCII-only, ALL control / zero-width / RTL-override / homoglyph unicode outright), empty/whitespace blocked. Single chokepoint is `renameCaptain`.

SAFE TO FIX NOW (minor, deferred as low-value, noted for the user, not auto-applied):
- (A1) The charset still admits punctuation-only (`"...."`) and many internal spaces. Cosmetic in single-player; mild layout/impersonation fodder once public. Optional fix: collapse internal whitespace + require >=1 alphanumeric.

DESIGN-TIME (before names sync/display to others; ordered by the hunter's priority):
- **(B2, most important pre-cloud) Save-import bypasses name validation entirely.** Captain `label` is carried VERBATIM through `deserialize`/`hydrateDecimals` (the `...c` spread); the structural guard checks shape, not label content. Import Save is a second ingestion path that never calls `validateCaptainName`. Harmless today (self-imported, escaped render), but a cloud/attacker blob can persist an overlong / non-ASCII / RTL / homoglyph label defeating every client check, then shown to others. FIX: the server must re-validate EVERY persisted name field on store AND load (re-run `validateCaptainName` over `state.captains[].label` after deserialize), not only on the rename action.
- **(B1) No server-side validation exists; the client gate is bypassable by design.** The authoritative `validateCaptainName` must run SERVER-SIDE on the rename RPC, rejection enforced there.
- **(B3) Impersonation:** nothing enforces name uniqueness; case/spacing variants collide. Split an IMMUTABLE unique handle (server-assigned or case-folded-unique) from the mutable display name; render the handle alongside the display name in cross-player contexts.
- **(B5) Profanity filter is courtesy-only** (tiny token list, bypassable by leetspeak/spacing). Real moderation is server-side (normalize before matching, report/flag + human review); keep the client list as instant UX feedback only.
- **(B4) Keep ASCII-only** unless internationalizing; if the charset relaxes (accents, renamable ship names with more chars), reopen with NFC normalization + bidi-control stripping + confusable-skeleton checks.
- **(B6) Wire ship-rename (when it lands) through a shared `validateDisplayName`** (same signature); confirm the combat log stays escaped for ship-name tokens.
- **(B7)** Log lines that embed names inherit the name's trust level; preserve escape-at-render if logs/replays are ever shared.

---

## 6. Real-time chat, whispers, system messages, notifications (NEW scope, user 2026-07-29)

Planned for the patch after combat: chat rendered above the bottom tab row (global chat + whispers + system messages + global notifications for super-rare drops), with username colors/styling and chat badges; all users can chat. Nothing exists in code yet; this is design-time, and it is the LARGEST new attack surface because it is UGC delivered to EVERY connected user in real time. Requirements:

1. **XSS is the top risk (wormable, stored, hits everyone).** A chat message renders on every other client. Svelte text interpolation auto-escapes, so `{message.text}` is safe. HARD RULE: chat messages, usernames, and every styled fragment render as ESCAPED TEXT, NEVER `{@html}`/`innerHTML`. For rich formatting (bold, emoji), use a whitelisted STRUCTURED renderer (parse to a token list, render each as an element), never an HTML string. One `{@html}` on a chat field is stored XSS against every online player at once.
2. **Username COLOR / styling = a constrained palette, never free CSS.** A user-supplied color/style string interpolated into `style=` is CSS injection (layout attacks, `url()` de-anonymization). Allow only a SERVER-VALIDATED enum of color/style tokens mapped client-side to CSS vars; never a raw user CSS string. Same for any font/animation.
3. **Badges must be SERVER-AUTHORIZED.** A badge asserts an achievement / supporter / role. The client must never decide its own badges, the server issues the badge set (derived from server-side entitlement/achievement state) with each message or on the user record. Otherwise anyone forges a "developer"/"supporter" badge.
4. **System messages + rare-drop GLOBAL notifications must be SERVER-MINTED.** "Player X found a super-rare drop" is a claim about game state; a client cannot be trusted to announce its own loot (trivial to forge). The server validates the drop (it already needs authoritative or re-simulatable drop logic, ties to the SUGGESTIONS server-mint-hash idea at SUGGESTIONS.md:116) and mints the broadcast. Client-originated "system" messages must be impossible by protocol (a distinct server-only message type/channel the client cannot send).
5. **Whispers are private -> authorization, not client-side filtering.** Only sender + named recipient receive a whisper; the server routes it to exactly those two sockets and must NOT broadcast-then-filter. Enforce block-lists server-side.
6. **Spam / flood / DoS:** per-user rate limits (messages/sec + burst), server-enforced max message length, max whisper fan-out, connection limits, slow-mode. Prevents chat-flood DoS + oversize-message abuse.
7. **Moderation + safety:** server-side profanity/slur filtering (client filter is UX only), report/block/mute, mod tooling, audit log; applies to names AND messages. Consider new-account restrictions.
8. **Transport:** the realtime channel (WebSocket/SSE) authenticates from the verified Clerk session; a socket cannot self-assert identity, the server binds it. Validate every inbound frame as hostile input (same posture as save blobs).
9. **Privacy:** chat payloads carry the display HANDLE only, never email/user-id; retention + deletion policy for logs.

Sequencing: chat should ship AFTER cloud save + accounts are solid, because it sits on the SAME foundation (verified session + server authority + hostile-input validation). Build that layer once; cloud save, rare-drop broadcasts, and chat all reuse it.

## 7. The tech spec's sec. 9.7 preparations were NOT built (retrofit debt)

Sec. 9.7 lists five "cheap in v1, painful to retrofit" preparations. Grep on 2026-07-29 found only ONE exists:
- BUILT: theme/palette CSS-variable abstraction.
- MISSING: (a) nullable `user_id` field in the save from v1; (b) auth-touching code behind an interface (v1 stub returns "no user"); (c) feature flags (`if (features.cloudSave)`); (d) `checkEntitlements()` hook.

They are still cheaper to add BEFORE online than during it. Concretely, before/with the online work:
- Add a nullable `user_id` (or `cloud: { userId }`) to the save at the next SAVE_VERSION bump, so the anonymous-local -> authenticated-cloud migration is a field populate, not a schema rewrite.
- Introduce an `authService` interface with a v1 "no user" implementation, so consumers do not couple to Clerk directly (portability / Tool Lock-In, Omega 9).
- Add a feature-flag object so cloud-save code paths can land dark and flip on.

---

## 8. Pre-online security checklist (prioritized)

Cloud save + accounts (before ANY save leaves the device or any name is shown to another player):
1. [server] Verify the Clerk session server-side on EVERY save endpoint; key saves by the verified user id; reject client-supplied ids (anti-IDOR).
2. [server] Clerk SECRET key server-only; HTTPS; CORS locked to origin; rate-limit + hard size-cap writes.
3. [client, PARTLY DONE] Strict schema validator + depth/size caps + Decimal-magnitude bounds in front of migrate/hydrate for non-local saves. Done this session: try/catch backstop, tickDurationSeconds guard, prototype-pollution key filter, huge-array reduce (sec. 4). Still needed: the full field-level schema validator + decompression-bomb size caps (server-side + on import).
4. [client] Optional rename hardening now (A1); server-side re-validation of names on store AND load (B2/B1) + moderation before names are public.
5. [decision] Honor-system cloud save first (documented accepted risk for a PvE game); server-side validation/re-simulation REQUIRED before any competitive feature (PvP/leaderboard/shared drops). Keep determinism + offline==live intact so validation stays addable.
6. [prep] Add save `user_id`, an auth-service interface, and feature flags (sec. 7 retrofit) at the next save bump.
7. [legal] Privacy policy + ToS before money/PII (tech spec sec. 9.5.5).

Chat + notifications (the patch after, sec. 6, sits on the same session/authority layer):
8. [client] Chat text + usernames render as ESCAPED TEXT only, never `{@html}`; rich formatting via a whitelisted structured renderer.
9. [server] Username colors from a validated palette enum (never raw CSS); badges server-issued from entitlement/achievement state; rare-drop/system broadcasts SERVER-MINTED (client cannot announce its own loot); whispers routed server-side to the two parties only.
10. [server] Per-user rate limits + max message length + realtime-frame validation as hostile input; server-side moderation + report/block/mute + audit log.

---

## 9. Present-code fixes applied from this pass

Tracked in `KNOWN_ISSUES.md` (2026-07-29). Security-relevant: the `deserialize` structural guard (`1f793e1`) and the save-load hostile-input hardening (`e97d0b0`, sec. 4) + the `npm audit` postcss fix (`c6e27f5`). Others (format rollover, combat findings) are correctness/balance, not security.
