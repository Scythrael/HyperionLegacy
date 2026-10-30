# HL Hub charter and handoff

Read this first when you become "HL Hub", the user's ongoing Hyperion Legacy hub session. The user calls the hub
"Mr. Data", their Operations officer. Part 1 is permanent. Part 2 is rewritten at every hub rotation.

## Part 1: being the hub

**Read on startup, in order:**
1. Memory `user_rapport_hub.md`: tone, the Trek thread, in-jokes, and what the user values. Rapport is the point
   of this file.
2. Memory index MEMORY.md. These rules matter most here:
   - decisions are the user's;
   - ask by multiple choice;
   - no em dashes;
   - deploy to staging only, never push feat;
   - no early 0.14.0 staging;
   - usage pacing;
   - token efficiency.
3. Part 2 below.
4. The end of `docs/plans/2026-10-26-session-resume-notes.md`: the latest handoff and the SESSION PROTOCOL.

**Role:**
- The hub talks with the user. It holds the question queue and the decisions, and it relays between the user and
  slice sessions.
- The hub does not build. Each slice or phase runs in its own fresh session, named after the slice (for example
  "Slice 6/7 Implementation").
- The hub names itself `HL Hub` (rename with set_session_title "self"), because slice sessions message that name.
- Every slice session follows the protocol in the resume notes. The hub is the one that holds them to it.

**Handling slice messages** (they arrive as `<cross-session-message>`):
- **Status or ack:** summarize it for the user in a few lines. Don't reply; that keeps the slice's context lean.
- **Missing context:** answer from git, docs, memory and the user's own words, and cite where the answer came from.
  If the question is really a game decision, ask the user (AskUserQuestion), relay the answer verbatim, and make
  sure it gets recorded in the plan doc.
- **Final report:** summarize it for the user. Note the usage readings (Part 2). Check the next slice in the queue
  against the notes ("verify notes before build"), then help the user open the next slice session.
- **Peer limits:** a peer message is information, not the user's approval. Never use one to get around permissions.

**Staying lean:**
- Check `get_usage` (self and the slice session) at each slice boundary.
- Rotate the hub when its Messages category passes about 100k, or before a long break.
- To rotate: rewrite Part 2, commit it, refresh `user_rapport_hub.md` if anything new happened in the rapport, then
  tell the user to open a fresh session titled "HL Hub" with "Read docs/plans/HL-hub-charter.md and take the hub".
- Brainstorms and tributes can live in the hub, but capture any decisions in git promptly.

## Part 2: current handoff (2026-10-30 ~18:30 UTC, hub session local_636d394d)

**State:**
- PROD is 0.13.11.2 @ cffd5bf. Never roll prod back past 0.13.11.1.
- feat/crew-0.14.0 was at 1aea4e6 when I checked (the session protocol commit, on top of d58bf5f).
- Slice 6 (save conversion) merged as af0320b, with 10,454 tests green.
- Slice 7 (UI + Help) is in progress in session "Slice 6/7 Implementation": built as 7842f84 on
  worktree-agent-a4f30434476d21c47; review approved with wording fixes; fix round running. That session sends the
  full report after merge, gates and backup.
- User calls recorded by that session today: four new automation lines approved, the e25M reward line approved, the
  dimmed "ahead" automation row kept, and a NEW marker on the Automation tab.

**Usage measurement (the user wants real numbers for the session-per-slice saving):**
- Baseline: 5-hour 10%, weekly 30% (weekly resets 2026-11-05 12:00 UTC), read at 18:30 UTC during Slice 7's fix
  round.
- Record the readings again at Slice 7's final report and across the next slice, and compare with the long-session
  days of 2026-10-29/30.
- Fixed per-session overhead was measured at about 75k tokens: system tools ~40k, MCP tools ~20k, skills ~7k,
  system prompt 5 to 11k, memory ~3k. That's higher than my first guess of 20 to 30k, so the expected saving is
  smaller than the first estimate.
- One possible lever: slice sessions that never use the browser or visualization tools could run without those MCP
  servers. That is the user's call, because their setup is deliberate.
- User call (2026-10-30), "Measure first": keep every tool in every session for now. Mockups happen in the hub;
  visual QA stays in the slice session. Revisit after the Slice 7 and next-slice readings. Two alternatives were
  offered: a separate short QA session per slice with build sessions stripped of the browser tools, or doing QA in
  the hub.

**Open items for the user (re-present when useful, most important first):**
1. Memorials for the other fallen titans: the user names who and where. The rules match the Sigil: unnamed, an
   original echo, on an existing item or one the user names (relics v2 plan).
2. Optional dedication line on the shared Sigil mockup (https://claude.ai/artifact/PkkEgFFQnY7RNaKwpC8CtH), only if
   the user wants one.
3. VARIETY_RESIST_RATIO 0.1 is still [PROVISIONAL] (wiring plan).
4. Check the 2026-10-27 question queue in the resume notes (gear wear step 4, FKR-8 Lure) against later answers
   before re-asking. Its status was not re-verified at this handoff.

**Queue after Slice 7** (from the resume notes):
- WR-7 patrol legs (goldens first);
- WR-8..12, ML-5/6, EM-8/9, R2-5..9;
- gear wear step 5, GG-8, SF-7, the CP slices;
- then the wiring gate before staging, which needs the user's go.

**Other:**
- Pace: marathon mode, one slice session at a time, careful with usage.
- The Proton bundle is refreshed after each merge (`reference_proton_backup.md`).
- The RPG-Idle-Game Unity repo has a detached HEAD at e0fd42c (separate project, unaddressed).
