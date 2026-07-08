<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import Starfield from "./lib/Starfield.svelte";
  import Panel from "./lib/Panel.svelte";
  import SubTabs from "./lib/SubTabs.svelte";
  import {
    freshState,
    MISSIONS,
    requiredTicksForPhase,
    RECIPES,
    xpForNextLevel,
    xpForNextFleetAdminLevel,
    CAPTAIN_TALENTS,
    HOMEWORLD_TALENTS,
    type GameState,
    type MissionKey,
    type MissionPhase,
    type LootMaterialKey,
    type RecipeKey,
    type HomePlanetMaterialKey,
    type CaptainTalentBranch,
    type HomeworldTalentBranch,
    type CaptainTalentKey,
    type HomeworldTalentKey,
  } from "./lib/game/model";
  import {
    tick,
    tickCaptainMission,
    dispatchCaptainOnMission,
    recallCaptain,
    craftRecipe,
    recomputeFleetAdmin,
    buyCaptainTalent,
    buyHomeworldTalent,
    captainCommonYieldMult,
    captainUncommonYieldMult,
    captainUncommonChanceMult,
    captainRareChanceMult,
    fleetRareYieldMult, // consumed by both the live tick loop below and the captain-selection popup markup (Task 5) for its live drop-rate preview
    LOOT_MATERIAL_KEYS,
  } from "./lib/game/tick";
  import { formatNumber } from "./lib/game/format";
  import { saveToLocalStorage, loadFromLocalStorage, clearSave, exportRawSave, importRawSave } from "./lib/game/save";
  import { loadTheme, saveTheme, THEME_NAMES, THEME_PREVIEW_COLORS, type ThemeName } from "./lib/theme";

  // DEV_MODE — Vercel §9.5.3: true on Preview, false on Production. Locally,
  // set VITE_DEV_MODE=true in .env.local (see .env.example).
  const DEV_MODE_ENV = import.meta.env.VITE_DEV_MODE === "true";

  // Player-facing app version + patch notes, shown on the About sub-tab
  // (System tab). Distinct from SAVE_VERSION (save.ts) -- that's the save
  // SCHEMA version, bumped only when the save shape changes; this is a
  // human-readable release marker, bumped by hand whenever there's a
  // user-visible batch of changes worth calling out. Newest entry first.
  // Reset to a disciplined X.Y.Z scheme starting 2026-07-07 (Y bumps per
  // feature release, Z bumps per minor fix) -- the pre-reset 0.6.0-0.9.0
  // history above is left untouched (never rewrite patch-note history), so
  // this deliberately reads as "0.2.0 newer than 0.9.0" once, only here.
  const APP_VERSION = "0.2.0";
  const PATCH_NOTES: { version: string; summary: string }[] = [
    { version: "0.2.0", summary: "Reworked mission loot so uncommon and rare materials can both drop in the same tick instead of one replacing the others; talent bonuses now target a specific material tier each. Added Import Save. Version numbering restarts here -- 0.2.1/0.2.2 for small fixes, 0.3.0 for the next feature." },
    { version: "0.9.0", summary: "Widened the app to use most of the screen instead of a narrow centered column; retired the diagonal-corner panel look for a flatter style; moved the app's branding into this About tab." },
    { version: "0.8.0", summary: "Reworked scrolling so only the active tab's content scrolls, not the whole page; added \"Coming Soon\" locked placeholders for future sub-tabs and captain slots." },
    { version: "0.7.0", summary: "Rebuilt navigation: a global header with Fleet Admiral level/XP and a single fleet-wide tick, a dedicated Fleet Captain's tab, and a mission-first Fleet Operations tab." },
    { version: "0.6.0", summary: "Added Captain Talents and Homeworld Talents -- two talent trees plus Fleet Admiral leveling." },
  ];

  // Display-only phase labels for the MISSIONS panel's phase readout. Purely
  // a UI concern -- nothing outside this file needs to map a MissionPhase to
  // display text, so it lives here rather than in model.ts. Must stay in
  // sync with MissionPhase's literal union -- a new phase added there
  // without a matching entry here would silently render "undefined" instead
  // of a label.
  const MISSION_PHASE_LABEL: Record<MissionPhase, string> = {
    ordersReceived: "Orders Received",
    transitOut: "Transiting Out",
    extracting: "Extracting",
    transitBack: "Transiting Back",
    unloading: "Unloading",
  };

  let state: GameState = freshState();
  let createdAt = Date.now();
  let currentTheme: ThemeName = "cyan";
  let deleteModalOpen = false;
  let deleteConfirmText = "";

  // Import Save modal (Task 7, Loot Tier Rework -- see
  // docs/plans/2026-07-07-loot-tier-rework-plan.md) -- same
  // "state near deleteModalOpen, markup near the delete modal" pattern as
  // that existing flow. pendingImportRaw holds the SELECTED file's raw text
  // (already read off disk by the time the modal opens) so confirmImport has
  // no async work left to do -- only the file input's on:change handler
  // touches the filesystem/File API. importError surfaces a rejected
  // (corrupt/non-save) file inline in the modal without closing it, so the
  // user can immediately try a different file.
  let importModalOpen = false;
  let pendingImportRaw: string | null = null;
  let importError: string | null = null;

  // Fleet Operations captain-selection popup (2026-07-07 Fleet Operations
  // Mission UI) -- null missionPopupKey means the popup is closed. Selecting a
  // mission card opens it with no captain chosen yet (missionPopupCaptainId
  // null); picking a captain inside the popup recalculates the preview stats
  // but does NOT dispatch -- only the Dispatch button does that.
  let missionPopupKey: MissionKey | null = null;
  let missionPopupCaptainId: number | null = null;
  let speed = 1;
  let logEntries: string[] = [];
  let activeCaptainIndex = 0;
  let paused = false;

  // Outer bottom nav (Task 1, Phase 4; split from 5 to 6 tabs in the UI
  // Redesign, Task 7 -- see docs/plans/2026-07-07-ui-redesign-plan.md), no
  // router library (see design doc: single-page idle game, no deep-linking/
  // history need). Default lands on Fleet Captain's since captains/missions
  // are the core loop today.
  type TabKey = "homeworld" | "sectorSpace" | "fleetCaptains" | "fleetOperations" | "battlespace" | "system";
  let activeTab: TabKey = "fleetCaptains";

  // Fleet Captain's tab sub-tabs (UI Redesign, Task 8 -- see
  // docs/plans/2026-07-07-ui-redesign-plan.md). Overview holds the relocated
  // CAPTAIN LEVELING content; Talents holds the relocated CAPTAIN TALENTS
  // content. Defaults to Overview since level/XP is the more commonly
  // checked view.
  type FleetCaptainSubTab = "overview" | "talents";
  let activeFleetCaptainSubTab: FleetCaptainSubTab = "overview";

  // Homeworld tab sub-tabs (UI Redesign, Task 10 -- see
  // docs/plans/2026-07-07-ui-redesign-plan.md). Resources holds the
  // relocated HOME PLANET content; Refinery holds the relocated
  // Refinery/Fabrication RECIPES content; Talents holds the relocated
  // HOMEWORLD TALENTS content. Defaults to Resources as the most commonly
  // checked view.
  type HomeworldSubTab = "resources" | "refinery" | "talents";
  let activeHomeworldSubTab: HomeworldSubTab = "resources";

  // System tab sub-tabs (UI Redesign, Task 10; gained About in the layout-
  // width/panel-style fix -- see SESSION_LOG.md). Options holds the relocated
  // theme picker + Export/Delete Save content; Log holds the relocated LOG
  // panel; Debug holds the relocated dev debug panel (only reachable when
  // DEV_MODE_ENV is true -- see the <SubTabs> usage under the System tab
  // below, which omits the "debug" entry from its tabs array entirely when
  // DEV_MODE_ENV is false, so non-dev-mode players never see a Debug button
  // at all); About holds the app title/branding that used to be its own
  // always-visible header panel above the top bar -- retired in favor of
  // this out-of-the-way spot, per the user's own request, since the level/
  // XP/tick bar and the bottom nav ARE the header/footer now. Defaults to
  // Options since theme/save actions are the most commonly checked view.
  type SystemSubTab = "options" | "log" | "debug" | "about" | "patchNotes";
  let activeSystemSubTab: SystemSubTab = "options";

  // Fleet Operations mission-category buttons (2026-07-07 Fleet Operations
  // Mission UI). Only "resourceGathering" has real content today -- the other
  // 3 render locked/"Coming Soon", same pattern as locked captain-list slots
  // and locked sub-tabs. Confirmed with the user: Patrol needs combat
  // (Battlespace is still a stub), Surveying/Long-Term Exploration have no
  // backing mechanics yet.
  type MissionCategoryKey = "resourceGathering" | "patrol" | "surveying" | "longTermExploration";
  let activeMissionCategory: MissionCategoryKey = "resourceGathering";

  // Difficulty tiers within Resource-Gathering, reusing the SubTabs component's
  // existing locked-tab support. Tier I is real and contains BOTH launch
  // missions (see model.ts's MissionDef.tier field) -- confirmed with the
  // user neither shortOreRun nor longOreRun is meant to be a separate tier.
  // Tiers II-V are locked placeholders for future mission content.
  type MissionTierKey = "tierI" | "tierII" | "tierIII" | "tierIV" | "tierV";
  let activeMissionTier: MissionTierKey = "tierI";

  let tickHandle: ReturnType<typeof setInterval>;
  let saveHandle: ReturnType<typeof setInterval>;
  let lastPollTime = Date.now();

  // Fleet-wide tick cycle (collapsed from a per-captain-id-keyed map during
  // the UI Redesign, Task 4 -- see docs/plans/2026-07-07-ui-redesign-plan.md
  // and docs/plans/2026-07-07-ui-redesign-design.md). tickDurationSeconds is
  // now a single field on GameState (Task 1 of this same plan), so every
  // captain advances in lockstep on ONE shared cycle instead of each
  // captain owning its own independent barCycleStart/nowTick pair.
  let cycle: { barCycleStart: number; nowTick: number } = { barCycleStart: Date.now(), nowTick: Date.now() };

  function pushLog(msg: string) {
    logEntries = [msg, ...logEntries].slice(0, 8);
  }

  function doSave() {
    saveToLocalStorage(state, createdAt);
  }

  onMount(() => {
    // Browsers restore scroll position across reloads by default (an
    // absolute pixel offset from the LAST time this page was open). This
    // page's height changes as content is added (more captain tabs, new
    // panels like Skill Tree), so an old offset can land well below the top
    // on a reload -- confirmed live in production after the Skill Tree
    // panel shipped. This is a single-page app with no in-page anchors to
    // preserve, so we take control of scroll position ourselves instead of
    // trusting the browser's restoration.
    if ("scrollRestoration" in history) {
      history.scrollRestoration = "manual";
    }
    window.scrollTo(0, 0);

    currentTheme = loadTheme();
    document.documentElement.dataset.theme = currentTheme;

    const loadedSave = loadFromLocalStorage();
    if (loadedSave) {
      createdAt = loadedSave.createdAt;
      const offlineSeconds = Math.max(0, (Date.now() - loadedSave.lastSavedAt) / 1000);
      state = offlineSeconds > 5 ? tick(offlineSeconds, loadedSave.state) : loadedSave.state;
      if (offlineSeconds > 5) pushLog(`Welcome back. Advanced ${formatNumber(offlineSeconds)}s offline.`);
    } else {
      pushLog("New save initialized.");
    }
    lastPollTime = Date.now();
    cycle = { barCycleStart: lastPollTime, nowTick: lastPollTime };

    // Tick-bar loop — checks the ONE shared fleet-wide cycle's progress every
    // 100ms, firing tickCaptainMission (Phase 3a) for EVERY mission captain
    // in lockstep whenever that shared cycle completes on this poll (Task 4
    // of the UI Redesign plan collapsed this from a per-captain-cycle loop --
    // see docs/plans/2026-07-07-ui-redesign-plan.md -- since
    // tickDurationSeconds is fleet-wide now, per Task 1 of that same plan).
    // Idle captains (mission === null) have no passive economy anymore -- see
    // the Phase 4 comment on tick()'s loop body below -- so only mission
    // captains ever have anything to fire here. Fleet-wide gameTimeSeconds
    // advances continuously off real elapsed time every poll, decoupled from
    // the shared cycle's cadence (gameTimeSeconds is fleet bookkeeping; it
    // is never read by tickCaptainMission's production math, so this
    // decoupling cannot desync production from time).
    // barSeconds is floored at 1 real second so dev-speed presets never make
    // the shared bar flicker unreadably — multiple game-ticks just batch
    // into one visual cycle, which is still correct because
    // tickCaptainMission is closed-form.
    tickHandle = setInterval(() => {
      const now = Date.now();

      if (speed === 0) {
        paused = true;
        lastPollTime = now; // freeze the fleet clock too while paused
        return;
      }

      if (paused) {
        // Resuming: discard the paused wall-clock gap entirely for the fleet
        // clock AND the shared cycle, rather than letting it read as elapsed
        // time (which would fire unearned progress on resume).
        lastPollTime = now;
        cycle.barCycleStart = now;
        paused = false;
        return;
      }

      const realElapsedSeconds = (now - lastPollTime) / 1000;
      lastPollTime = now;
      state = { ...state, gameTimeSeconds: state.gameTimeSeconds + realElapsedSeconds * speed };

      // barSeconds/progress computed ONCE per poll now, from the fleet-wide
      // state.tickDurationSeconds -- not per-captain (there's only one cycle
      // to check now, not a map keyed by captain id).
      const barSeconds = Math.max(1, state.tickDurationSeconds / speed);
      cycle.nowTick = now;
      const progress = (now - cycle.barCycleStart) / 1000 / barSeconds;

      let captains = state.captains;
      let anyFired = false;

      // Mirrors tick()'s own homePlanetDelta accumulation in tick.ts: summed
      // locally across every captain whose mission advances THIS poll, then
      // merged into state.homePlanet.storage once below -- same "accumulate
      // locally, apply once" shape as gameTimeSeconds and captains itself.
      // Starts all-zero and stays that way (anyLootDelivered stays false) on
      // a poll where the shared cycle doesn't complete, or no captain on a
      // mission delivers loot this cycle, so the homePlanet merge below can
      // be skipped entirely on the (overwhelmingly common) no-op poll --
      // same reactivity-churn discipline as the existing anyFired guard.
      let anyLootDelivered = false;
      const homePlanetDelta: Record<LootMaterialKey, number> = { commonOre: 0, uncommonMaterial: 0, rareMaterial: 0 };

      if (progress >= 1) {
        const gameSecondsThisCycle = barSeconds * speed;
        // Same deltaSeconds -> ticksElapsed conversion tick() uses in
        // tick.ts (divide by the fleet's shared tickDurationSeconds) --
        // computed ONCE here and reused for every captain below, keeping the
        // live loop's mission cadence identical to the offline catch-up
        // path's, which is the whole point of this task.
        const ticksElapsed = gameSecondsThisCycle / state.tickDurationSeconds;

        // Fleet-wide Homeworld Talent bonus (same value for every captain
        // this poll) -- computed once here, mirroring tick.ts's tick(),
        // which this live loop otherwise duplicates rather than calls
        // directly (see the comment block above this setInterval). Without
        // this mirroring, talent points spent on extraction/loot-chance
        // Homeworld Talents would only ever take effect during the one-time
        // offline-catchup tick() call at load, never during live play --
        // exactly the bug this wiring pass exists to close. rareYieldMult is
        // the ONLY Homeworld Talent effect type tied to extraction (per
        // model.ts -- there is no captain-level rare-yield talent), same as
        // tick.ts's own tick().
        const fleetRareYield = fleetRareYieldMult(state);

        for (let i = 0; i < captains.length; i++) {
          const captain = captains[i];
          // Idle captains (mission === null) have no passive economy anymore
          // -- missions are the only way a captain does anything (mirrors
          // tick.ts's tick(), which returns idle captains completely
          // unchanged).
          if (captain.mission === null) continue;
          if (!anyFired) {
            captains = [...captains]; // copy on first write this poll
            anyFired = true;
          }
          // 5-field bonuses object (2026-07-07 Loot Tier Rework) -- mirrors
          // tick.ts's own tick() exactly: 4 captain-level helpers (read at
          // usage time off THIS captain's unlockedCaptainTalents) plus the
          // one fleet-wide helper (rareYieldMult only, computed once above,
          // outside this per-captain loop, since Homeworld Talents are
          // fleet-wide, not per-captain).
          const bonuses = {
            commonYieldMult: captainCommonYieldMult(captain),
            uncommonYieldMult: captainUncommonYieldMult(captain),
            uncommonChanceMult: captainUncommonChanceMult(captain),
            rareYieldMult: fleetRareYield,
            rareChanceMult: captainRareChanceMult(captain),
          };
          // Math.random passed explicitly (rather than omitted) since bonuses
          // is positional arg 4 -- omitting arg 3 here would pass bonuses AS rng.
          const { captain: updatedCaptain, homePlanetDelta: delta } = tickCaptainMission(
            ticksElapsed,
            captain,
            Math.random,
            bonuses
          );
          captains[i] = updatedCaptain;
          if (delta.commonOre !== 0 || delta.uncommonMaterial !== 0 || delta.rareMaterial !== 0) {
            anyLootDelivered = true;
            homePlanetDelta.commonOre += delta.commonOre;
            homePlanetDelta.uncommonMaterial += delta.uncommonMaterial;
            homePlanetDelta.rareMaterial += delta.rareMaterial;
          }
        }

        // passiveTrickle (Homeworld Talent economyTrickle): same fleet-wide,
        // mission-independent material generation tick.ts's tick() applies --
        // mirrored here for the same reason as fleetRareYield above. Applies
        // even with zero captains dispatched, so it's checked unconditionally
        // this cycle, not just inside the captains loop.
        for (const key of state.unlockedHomeworldTalents) {
          const effect = HOMEWORLD_TALENTS[key].effect;
          if (effect.type === "passiveTrickle" && (LOOT_MATERIAL_KEYS as string[]).includes(effect.material)) {
            anyLootDelivered = true;
            homePlanetDelta[effect.material as LootMaterialKey] += effect.perTick * ticksElapsed;
          }
        }

        // Reset once for the whole fleet, not per-captain -- there's only
        // one shared cycle now.
        cycle.barCycleStart = now;
      }

      if (anyFired) {
        state = { ...state, captains };
      }
      if (anyLootDelivered) {
        // Field-by-field, matching tick.ts's own homePlanet merge exactly --
        // added ONTO existing totals, never replacing them. The
        // `...state.homePlanet.storage` spread MUST come first, before the 3
        // named-field overwrites below -- otherwise this object literal would
        // silently drop any OTHER field on homePlanet.storage that this loop
        // doesn't itself touch (refinedMaterial, components, added by the
        // Homeworld crafting system) on every poll that delivers loot. This is
        // the exact class of bug tick.ts's own tick() function already
        // guards against (see its comment referencing the "prestige silently
        // dropped homePlanet" production incident) -- this live-loop poll path
        // is a second, independent place doing the same merge, and needed the
        // same fix. Do not remove this spread.
        state = {
          ...state,
          homePlanet: {
            storage: {
              ...state.homePlanet.storage,
              commonOre: state.homePlanet.storage.commonOre + homePlanetDelta.commonOre,
              uncommonMaterial: state.homePlanet.storage.uncommonMaterial + homePlanetDelta.uncommonMaterial,
              rareMaterial: state.homePlanet.storage.rareMaterial + homePlanetDelta.rareMaterial,
            },
          },
        };
      }

      // recomputeFleetAdmin (Task 3, Captain & Homeworld Talent Trees) --
      // same "both the pure tick() path and the live-loop path need the same
      // hook" pattern tickCaptainMission's own XP award already established
      // in Phase 4. Runs unconditionally every poll (not gated behind
      // anyFired/anyLootDelivered above) since it's a cheap no-op read of
      // `state` when the aggregate captain-level sum hasn't changed --
      // recomputeFleetAdmin itself returns the SAME state reference in that
      // case, so this line doesn't introduce any extra reactivity churn on
      // the overwhelmingly common poll where nobody just leveled up.
      state = recomputeFleetAdmin(state);
    }, 100);

    // Autosave every 30s — tech spec §6.
    saveHandle = setInterval(doSave, 30000);

    const onUnload = () => doSave();
    window.addEventListener("beforeunload", onUnload);
    return () => window.removeEventListener("beforeunload", onUnload);
  });

  onDestroy(() => {
    clearInterval(tickHandle);
    clearInterval(saveHandle);
  });

  function doDispatchCaptainOnMission(captainId: number, missionKey: MissionKey) {
    const captain = state.captains.find((c) => c.id === captainId)!;
    const { next, success } = dispatchCaptainOnMission(state, captainId, missionKey);
    if (!success) return;
    state = next;
    pushLog(`[${captain.label}] Dispatched on mission: ${MISSIONS[missionKey].label}.`);
    doSave();
  }

  function doRecallCaptain(captainId: number) {
    const captain = state.captains.find((c) => c.id === captainId)!;
    const missionLabel = MISSIONS[captain.mission!.missionKey].label; // captured before the state swap below, same pre-swap-capture idiom as doDispatchCaptainOnMission's `captain.label` above
    const { next, success } = recallCaptain(state, captainId);
    if (!success) return;
    state = next;
    pushLog(`[${captain.label}] Recall ordered — returning to base from: ${missionLabel}.`);
    doSave();
  }

  // Fleet Operations captain-selection popup handlers (2026-07-07 Fleet
  // Operations Mission UI) -- open/close just manage missionPopupKey/
  // missionPopupCaptainId (declared above near deleteModalOpen); the actual
  // dispatch is delegated to the existing doDispatchCaptainOnMission so this
  // popup can't drift from the flow the non-popup dispatch path already uses.
  function openMissionPopup(missionKey: MissionKey) {
    missionPopupKey = missionKey;
    missionPopupCaptainId = null;
  }

  function closeMissionPopup() {
    missionPopupKey = null;
    missionPopupCaptainId = null;
  }

  function doDispatchFromPopup() {
    if (missionPopupKey === null || missionPopupCaptainId === null) return;
    doDispatchCaptainOnMission(missionPopupCaptainId, missionPopupKey); // existing function, unchanged
    closeMissionPopup();
  }

  function simulateOffline(hours: number) {
    state = tick(hours * 3600, state); // fleet-wide: advances every captain, matches real offline catch-up
    pushLog(`[DEV] Simulated ${hours}h offline for the whole fleet.`);
  }

  function doCraftRecipe(recipeKey: RecipeKey) {
    const { next, success } = craftRecipe(state, recipeKey);
    if (!success) return;
    state = next;
    pushLog(`Crafted: ${RECIPES[recipeKey].label}.`);
    doSave();
  }

  // Captain Talents (Task 6) -- per-captain-scoped, like doDispatchCaptainOnMission
  // above (reads activeCaptain.id, spends THIS captain's own statPoints).
  // Same "same state reference on failure" convention as buyCaptainTalent
  // itself -- success is just checked and bailed on here, no extra validation
  // duplicated in the UI layer.
  function doBuyCaptainTalent(talentKey: CaptainTalentKey) {
    const captain = activeCaptain;
    const { next, success } = buyCaptainTalent(state, captain.id, talentKey);
    if (!success) return;
    state = next;
    pushLog(`[${captain.label}] Talent learned: ${CAPTAIN_TALENTS[talentKey].label}.`);
    doSave();
  }

  // Homeworld Talents (Task 6) -- fleet-wide, spends the shared adminPoints
  // pool. Unlike doBuyCaptainTalent above, this never touches state.captains
  // directly here (buyHomeworldTalent itself appends a new captain internally
  // for unlockCaptainSlot-effect nodes -- see tick.ts) -- App.svelte just
  // swaps in whatever `next` comes back, same as every other do* handler.
  function doBuyHomeworldTalent(talentKey: HomeworldTalentKey) {
    const { next, success } = buyHomeworldTalent(state, talentKey);
    if (!success) return;
    state = next;
    pushLog(`Homeworld talent unlocked: ${HOMEWORLD_TALENTS[talentKey].label}.`);
    doSave();
  }

  function doExportSave() {
    const raw = exportRawSave();
    if (!raw) return;
    const blob = new Blob([raw], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `fleet-admiral-save-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function resetSave() {
    clearSave();
    state = freshState();
    createdAt = Date.now();
    pushLog("Save reset.");
  }

  function confirmDelete() {
    if (deleteConfirmText !== "DELETE") return;
    resetSave();
    deleteModalOpen = false;
    deleteConfirmText = "";
  }

  function cancelDelete() {
    deleteModalOpen = false;
    deleteConfirmText = "";
  }

  // Import Save handlers (Task 7, Loot Tier Rework) -- mirror the
  // cancelDelete/confirmDelete pair above in shape, but there's no
  // typed-confirmation-word gate here: picking a file from the OS file
  // picker is already a deliberate action, so Cancel/Import buttons alone
  // are enough friction (confirmed against the plan doc -- Import
  // deliberately does NOT need a "type DELETE"-style gate).
  function onImportFileSelected(event: Event) {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    // `file` is captured into this local const BEFORE input.value is reset
    // below, so the reset (which only clears the <input> element's OWN
    // value) cannot affect the File object or the .text() promise already
    // in flight against it -- they're independent references.
    file.text().then((text) => {
      pendingImportRaw = text;
      importError = null;
      importModalOpen = true;
    }).catch(() => {
      // File.text() can reject (e.g. the file was deleted/became unreadable
      // between selection and read) -- surface this the same way a rejected
      // save would be, rather than silently doing nothing and leaving the
      // user with no feedback at all.
      pendingImportRaw = null;
      importError = "Couldn't read that file. Please try again.";
      importModalOpen = true;
    });
    input.value = ""; // allow re-selecting the same file later -- browsers don't fire `change` on an unchanged value otherwise
  }

  function cancelImport() {
    importModalOpen = false;
    pendingImportRaw = null;
    importError = null;
  }

  function confirmImport() {
    if (pendingImportRaw === null) return;
    const success = importRawSave(pendingImportRaw);
    if (!success) {
      importError = "That file isn't a valid Fleet Admiral save.";
      return; // modal stays open -- importError renders inline, user can pick a different file
    }
    // Simplest way to get every derived/init-time value (in-memory state,
    // createdAt, tick-loop timers) to reset cleanly from the just-imported
    // save -- matches the existing "load happens once, at mount" pattern
    // (see onMount above) rather than adding a second "hot-swap state
    // mid-session" code path.
    window.location.reload();
  }

  function setTheme(name: ThemeName) {
    currentTheme = name;
    document.documentElement.dataset.theme = name;
    saveTheme(name);
  }

  $: activeCaptain = state.captains[activeCaptainIndex];
  // Fleet-wide tick readout (collapsed from per-captain activeCycle/
  // activeBarSeconds/activeTickProgress/activeTickRemaining during the UI
  // Redesign, Task 4 -- see docs/plans/2026-07-07-ui-redesign-plan.md).
  // There's only ONE cycle to read now (the shared `cycle` object above), so
  // these are no longer scoped to activeCaptain at all -- consumed by the new
  // global header bar landing in Task 6 of that same plan.
  $: globalBarSeconds = Math.max(1, state.tickDurationSeconds / (speed || 1));
  $: globalTickProgress = Math.min(1, Math.max(0, (cycle.nowTick - cycle.barCycleStart) / 1000 / globalBarSeconds));
  $: globalTickRemaining = Math.max(0, globalBarSeconds * (1 - globalTickProgress));
</script>

<div class="root">
  <Starfield />
  <div class="frame">
    <div class="top-bar">
      <div class="top-bar-row">
        <span class="top-bar-label">Fleet Admiral · Level {state.fleetAdminLevel}</span>
        <span class="top-bar-value">{formatNumber(state.fleetAdminXp)} / {formatNumber(xpForNextFleetAdminLevel(state.fleetAdminLevel))} XP</span>
      </div>
      <div class="research-bar-track">
        <div class="research-bar-fill" style="width:{Math.min(100, (state.fleetAdminXp / xpForNextFleetAdminLevel(state.fleetAdminLevel)) * 100)}%"></div>
      </div>
      <div class="tick-bar-track">
        <div class="tick-bar-fill" style="width:{globalTickProgress * 100}%"></div>
      </div>
      <div class="tick-bar-readout">{globalTickRemaining.toFixed(1)}s</div>
    </div>

    <main class="tab-body">
      {#if activeTab === "homeworld"}
      <SubTabs
        tabs={[
          { key: "resources", label: "Resources" },
          { key: "refinery", label: "Refinery/Fabrication" },
          { key: "talents", label: "Homeworld Talents" },
          { key: "homeworldLocked1", label: "Coming Soon!", locked: true },
          { key: "homeworldLocked2", label: "Coming Soon!", locked: true },
        ]}
        active={activeHomeworldSubTab}
        onSelect={(key) => (activeHomeworldSubTab = key as HomeworldSubTab)}
      />

      <div class="tab-scroll-area">
      {#if activeHomeworldSubTab === "resources"}
      <Panel>
        <div class="panel-title">HOME PLANET</div>
        <div class="resource-grid resource-grid-3">
          <div class="resource-card">
            <div class="resource-label">Common Ore</div>
            <div class="resource-value">{formatNumber(state.homePlanet.storage.commonOre)}</div>
          </div>
          <div class="resource-card">
            <div class="resource-label">Uncommon Material</div>
            <div class="resource-value">{formatNumber(state.homePlanet.storage.uncommonMaterial)}</div>
          </div>
          <div class="resource-card">
            <div class="resource-label">Rare Material</div>
            <div class="resource-value">{formatNumber(state.homePlanet.storage.rareMaterial)}</div>
          </div>
        </div>
      </Panel>
      {/if}

      {#if activeHomeworldSubTab === "refinery"}
      <!-- Refinery/Fabrication (Task 8, Phase 4) -- one panel per RECIPES
           entry, fleet-wide (not per-captain -- Homeworld structures belong
           to the whole fleet, unlike the per-captain MISSIONS panel under
           Fleet Ops). Iterates RECIPES rather than hardcoding each recipe's
           markup twice, so a 3rd recipe added to RECIPES later (per that
           object's own header comment) picks up a panel automatically. -->
      {#each Object.entries(RECIPES) as [recipeKey, recipe]}
        {@const inputEntries = Object.entries(recipe.inputs) as [HomePlanetMaterialKey, number][]}
        {@const affordable = inputEntries.every(([key, amount]) => state.homePlanet.storage[key] >= amount)}
        <Panel>
          <div class="panel-title">{recipeKey === "refineUnobtainium" ? "REFINERY" : "FABRICATION"}</div>
          <div class="research-name">{recipe.label}</div>
          <div class="research-cost">
            Requires:
            {#each inputEntries as [key, amount], i}
              {formatNumber(amount)} {key}{i < inputEntries.length - 1 ? ", " : ""}
              (have {formatNumber(state.homePlanet.storage[key])})
            {/each}
          </div>
          <div class="research-cost">Produces: {formatNumber(recipe.output.amount)} {recipe.output.key}</div>
          <button class="buy-btn" disabled={!affordable} on:click={() => doCraftRecipe(recipeKey as RecipeKey)}>
            Craft · {recipe.label}
          </button>
        </Panel>
      {/each}
      {/if}

      {#if activeHomeworldSubTab === "talents"}
      <!-- Homeworld Talents (Task 6, Captain & Homeworld Talent Trees) --
           fleet-wide (not per-captain -- reads state.adminPoints /
           state.unlockedHomeworldTalents directly, never activeCaptain),
           placed after Refinery/Fabrication above. Same fixed-5-branch
           iteration pattern as the Captain Talents panel under Fleet Ops, so
           Homeland Defense/Citizenry (zero entries today, see model.ts)
           render as labeled, empty columns.

           Homeworld Talents are Fleet Admiral prestige, gated ENTIRELY on
           adminPoints -- deliberately independent of any individual
           captain's own level/statPoints (those only ever gate that
           captain's OWN Captain Talents, above under Fleet Ops). Confirmed
           with the user rather than inventing a captain-scoped gate for a
           fleet-wide purchase. -->
      <Panel>
        <div class="panel-title">HOMEWORLD TALENTS</div>
        <div class="research-cost">Admin Points: {formatNumber(state.adminPoints)}</div>
        {#each (["fleetLogistics", "homelandDefense", "citizenry", "economy", "industry"] as HomeworldTalentBranch[]) as branch}
          {@const nodes = Object.entries(HOMEWORLD_TALENTS).filter(([, def]) => def.branch === branch)}
          <div class="skill-branch">
            <div class="skill-branch-title">{branch}</div>
            {#if nodes.length === 0}
              <p class="prestige-text">Not yet available.</p>
            {:else}
              {#each nodes as [key, talent]}
                {@const owned = state.unlockedHomeworldTalents.includes(key as HomeworldTalentKey)}
                {@const locked = !owned && talent.requires !== null && !state.unlockedHomeworldTalents.includes(talent.requires)}
                {@const buyable = !owned && !locked && state.adminPoints >= talent.cost}
                <div class="skill-node" class:owned={owned} class:locked={locked}>
                  <div>
                    <div class="skill-node-label">{talent.label}</div>
                    <div class="skill-node-status">
                      {#if owned}
                        Owned
                      {:else if locked}
                        Requires: {HOMEWORLD_TALENTS[talent.requires!].label}
                      {:else}
                        Cost: {formatNumber(talent.cost)} Admin Points
                      {/if}
                    </div>
                  </div>
                  {#if !owned}
                    <button class="buy-btn" disabled={!buyable} on:click={() => doBuyHomeworldTalent(key as HomeworldTalentKey)}>
                      Unlock
                    </button>
                  {/if}
                </div>
              {/each}
            {/if}
          </div>
        {/each}
      </Panel>
      {/if}
      </div>
      {/if}

      {#if activeTab === "sectorSpace"}
      <div class="tab-scroll-area">
      <Panel>
        <div class="panel-title">SECTOR SPACE</div>
        <p class="locked-heading">🔒 Coming Soon!</p>
        <p class="prestige-text">Shipyard and Starbase are still under construction.</p>
      </Panel>
      </div>
      {/if}

      {#if activeTab === "fleetCaptains"}
      <SubTabs
        tabs={[
          { key: "overview", label: "Overview" },
          { key: "talents", label: "Talents" },
          { key: "fleetCaptainLocked1", label: "Coming Soon!", locked: true },
          { key: "fleetCaptainLocked2", label: "Coming Soon!", locked: true },
        ]}
        active={activeFleetCaptainSubTab}
        onSelect={(key) => (activeFleetCaptainSubTab = key as FleetCaptainSubTab)}
      />

      <div class="tab-scroll-area">
      <div class="fleet-captains-layout">
        <div class="captain-list">
          {#each state.captains as captain, i}
            <button class="captain-list-item" class:active={i === activeCaptainIndex} on:click={() => (activeCaptainIndex = i)}>
              {captain.label}
            </button>
          {/each}
          <!-- Locked slots up to a roadmap max of 10 captains -- a genuine future
               signal (more Fleet Logistics unlock tiers planned later), not a
               promise with nothing behind it. Today's ACTUAL mechanic only supports
               growing to 4 captains (see model.ts's HOMEWORLD_TALENTS
               fleetLogisticsSlot1/2/3) -- slots 5-10 have no unlock path yet; see
               KNOWN_ISSUES.md (Task 6 of this plan). Array.from({length: N}) is
               used (not a bare {length: N} object) since Svelte's {#each} needs a
               real iterable/array, not just an array-like object. -->
          {#each Array.from({ length: Math.max(0, 10 - state.captains.length) }) as _, j}
            <div class="captain-list-item locked" title="Coming soon — not yet unlockable">
              🔒 Coming Soon!
            </div>
          {/each}
        </div>

        <div class="fleet-captains-content">
          {#if activeFleetCaptainSubTab === "overview"}
            <!-- Captain Leveling (Task 8, Phase 4; relocated into the Fleet
                 Captain's tab's Overview sub-tab during the UI Redesign,
                 Task 8 -- see docs/plans/2026-07-07-ui-redesign-plan.md) --
                 per-captain-scoped (reads activeCaptain, not the whole
                 fleet), replacing the spot Captain Prestige used to occupy.
                 The old Unlock section here (spending a captain's own
                 level/statPoints/Components to add a new captain slot) was
                 removed in Task 4 of
                 docs/plans/2026-07-07-captain-homeworld-talent-trees-plan.md
                 -- captain slot growth is now purchased fleet-wide through
                 the Homeworld Talents panel's Fleet Logistics branch
                 instead. The "Currently: Idle" / "Currently on: ..." line
                 below is new in the UI Redesign -- the MISSIONS panel itself
                 (dispatch/recall UI) does NOT live here; it moved to the
                 Fleet Operations tab (Task 9) instead. -->
            <Panel>
              <div class="panel-title">CAPTAIN LEVELING</div>
              <div class="research-name">Level {activeCaptain.level}</div>
              <div class="research-bar-track">
                <div class="research-bar-fill" style="width:{Math.min(100, (activeCaptain.xp / xpForNextLevel(activeCaptain.level)) * 100)}%"></div>
              </div>
              <div class="research-readout">{formatNumber(activeCaptain.xp)} / {formatNumber(xpForNextLevel(activeCaptain.level))} XP</div>
              <div class="research-cost">Stat Points: {formatNumber(activeCaptain.statPoints)}</div>
              <div class="research-cost">
                {#if activeCaptain.mission === null}
                  Currently: Idle
                {:else}
                  Currently on: {MISSIONS[activeCaptain.mission.missionKey].label}
                {/if}
              </div>
            </Panel>
          {:else if activeFleetCaptainSubTab === "talents"}
            <!-- Captain Talents (Task 6, Captain & Homeworld Talent Trees;
                 relocated into the Fleet Captain's tab's Talents sub-tab
                 during the UI Redesign, Task 8) -- per-captain-scoped, like
                 Captain Leveling above (reads activeCaptain, not the whole
                 fleet) -- spends THIS captain's own statPoints, records the
                 unlock on THIS captain only
                 (activeCaptain.unlockedCaptainTalents), never touches any
                 other captain's state. Iterates the FIXED 5-branch list, not
                 Object.keys(CAPTAIN_TALENTS) -- so Tactical/Science/Diplomacy
                 (currently zero entries, see model.ts) still render as
                 labeled, empty columns rather than not appearing at all. -->
            <Panel>
              <div class="panel-title">CAPTAIN TALENTS — {activeCaptain.label}</div>
              {#each (["command", "tactical", "science", "resourcefulness", "diplomacy"] as CaptainTalentBranch[]) as branch}
                {@const nodes = Object.entries(CAPTAIN_TALENTS).filter(([, def]) => def.branch === branch)}
                <div class="skill-branch">
                  <div class="skill-branch-title">{branch}</div>
                  {#if nodes.length === 0}
                    <p class="prestige-text">Not yet available.</p>
                  {:else}
                    {#each nodes as [key, talent]}
                      {@const owned = activeCaptain.unlockedCaptainTalents.includes(key as CaptainTalentKey)}
                      {@const locked = !owned && talent.requires !== null && !activeCaptain.unlockedCaptainTalents.includes(talent.requires)}
                      {@const buyable = !owned && !locked && activeCaptain.statPoints >= talent.cost}
                      <div class="skill-node" class:owned={owned} class:locked={locked}>
                        <div>
                          <div class="skill-node-label">{talent.label}</div>
                          <div class="skill-node-status">
                            {#if owned}
                              Owned
                            {:else if locked}
                              Requires: {CAPTAIN_TALENTS[talent.requires!].label}
                            {:else}
                              Cost: {formatNumber(talent.cost)} Stat Points
                            {/if}
                          </div>
                        </div>
                        {#if !owned}
                          <button class="buy-btn" disabled={!buyable} on:click={() => doBuyCaptainTalent(key as CaptainTalentKey)}>
                            Learn
                          </button>
                        {/if}
                      </div>
                    {/each}
                  {/if}
                </div>
              {/each}
            </Panel>
          {/if}
        </div>
      </div>
      </div>
      {/if}

      {#if activeTab === "fleetOperations"}
      <div class="tab-scroll-area">
      <!-- Fleet Operations Mission UI (2026-07-07 --
           docs/plans/2026-07-07-fleet-operations-mission-ui-plan.md, Task 4) --
           replaces the old flat one-Panel-per-mission loop (UI Redesign, Task
           9) with a category-list + tier-tabs + mission-card flow, mirroring
           .fleet-captains-layout/.captain-list/.captain-list-item's visual
           language directly above under the "fleetCaptains" tab. Only
           "resourceGathering" has real content today (Patrol/Surveying/
           Long-Term Exploration are locked placeholders -- see
           activeMissionCategory's declaration comment above). Within
           Resource-Gathering, only Tier I is real (both shortOreRun and
           longOreRun -- see model.ts's MissionDef.tier field); Tiers II-V are
           locked SubTabs entries. Dispatch no longer happens inline here --
           clicking an available mission card calls openMissionPopup, which
           sets missionPopupKey/missionPopupCaptainId (declared near
           deleteModalOpen). The popup markup that consumes that state and
           performs the dispatch through the existing
           doDispatchCaptainOnMission lives near the DELETE SAVE modal,
           further down this same template (Task 5). -->
      <div class="fleet-ops-layout">
        <div class="mission-category-list">
          <button
            class="mission-category-item"
            class:active={activeMissionCategory === "resourceGathering"}
            on:click={() => (activeMissionCategory = "resourceGathering")}
          >
            Resource-Gathering
          </button>
          <div class="mission-category-item locked" title="Coming soon — combat isn't built yet">
            🔒 Patrol Missions
          </div>
          <div class="mission-category-item locked" title="Coming soon — not yet available">
            🔒 Surveying
          </div>
          <div class="mission-category-item locked" title="Coming soon — not yet available">
            🔒 Long-Term Exploration
          </div>
        </div>

        <div class="mission-category-content">
          {#if activeMissionCategory === "resourceGathering"}
            <SubTabs
              tabs={[
                { key: "tierI", label: "Tier I" },
                { key: "tierII", label: "Tier II", locked: true },
                { key: "tierIII", label: "Tier III", locked: true },
                { key: "tierIV", label: "Tier IV", locked: true },
                { key: "tierV", label: "Tier V", locked: true },
              ]}
              active={activeMissionTier}
              onSelect={(key) => (activeMissionTier = key as MissionTierKey)}
            />

            {#if activeMissionTier === "tierI"}
              <!-- tierIMissions/embarked mirror the OLD block's per-mission
                   embarked filter above, just scoped to Tier I's mission set
                   instead of iterating ALL of MISSIONS -- the embarked-
                   captains display below (progress bar, phase label,
                   cargo-so-far, Recall button) is otherwise byte-identical to
                   what this replaced, only its position in the markup moved. -->
              {@const tierIMissions = (Object.entries(MISSIONS) as [MissionKey, typeof MISSIONS[MissionKey]][]).filter(([, def]) => def.tier === "I")}
              {@const embarked = state.captains.filter((c) => c.mission !== null && tierIMissions.some(([key]) => key === c.mission!.missionKey))}

              {#if embarked.length > 0}
                <div class="panel-title">IN PROGRESS</div>
                {#each embarked as captain}
                  {@const mission = captain.mission!}
                  {@const missionDef = MISSIONS[mission.missionKey]}
                  {@const requiredTicks = requiredTicksForPhase(mission.phase, missionDef)}
                  {@const progress = Math.min(1, mission.phaseProgressTicks / requiredTicks)}
                  {@const remainingTicks = Math.max(0, requiredTicks - mission.phaseProgressTicks)}
                  <div class="mission-card">
                    <div class="research-name">{captain.label} — {missionDef.label}</div>
                    <div class="research-cost">Phase: {MISSION_PHASE_LABEL[mission.phase]}</div>
                    <div class="research-bar-track">
                      <div class="research-bar-fill" style="width:{progress * 100}%"></div>
                    </div>
                    <div class="research-readout">{remainingTicks.toFixed(1)} ticks remaining in phase</div>
                    <div class="research-cost">
                      Cargo so far: {formatNumber(mission.cargo.commonOre)} ore, {formatNumber(mission.cargo.uncommonMaterial)} uncommon,
                      {formatNumber(mission.cargo.rareMaterial)} rare
                    </div>
                    {#if mission.recalled}
                      <p class="prestige-text mission-recalled-text">Recall ordered — returning to base once the current cycle's unloading completes.</p>
                    {:else}
                      <button class="recall-btn" on:click={() => doRecallCaptain(captain.id)}>Recall Captain</button>
                    {/if}
                  </div>
                {/each}
              {/if}

              <div class="panel-title">AVAILABLE MISSIONS</div>
              <div class="mission-list">
                {#each tierIMissions as [missionKey, missionDef]}
                  <button class="mission-card mission-card-selectable" on:click={() => openMissionPopup(missionKey)}>
                    <div class="mission-portrait-frame" aria-hidden="true">🖼️</div>
                    <div class="mission-card-body">
                      <div class="research-name">{missionDef.label}</div>
                      <div class="research-cost">Cargo capacity: {formatNumber(missionDef.cargoCapacity)}</div>
                      <div class="research-cost">Common Ore: up to {formatNumber(missionDef.extractionRatePerTick)}/tick</div>
                      <div class="research-cost">Uncommon Material: 1-3/tick ({(missionDef.uncommonChance * 100).toFixed(1)}% chance/tick)</div>
                      <div class="research-cost">Rare Material: 1/tick ({(missionDef.rareChance * 100).toFixed(1)}% chance/tick)</div>
                    </div>
                  </button>
                {/each}
              </div>
            {/if}
          {/if}
        </div>
      </div>
      </div>
      {/if}

      {#if activeTab === "battlespace"}
      <div class="tab-scroll-area">
      <Panel>
        <div class="panel-title">BATTLESPACE</div>
        <p class="prestige-text">PvP and PvE fleet operations will live here.</p>
        <!-- Expanded from a single generic "Coming Soon" line to 4 named
             locked options (mid-plan extra task, 2026-07-07) -- reuses
             .captain-list-item.locked as-is (same class/markup as the locked
             captain slots under Fleet Captain's, above) rather than
             introducing .mission-category-item, since that class belongs to
             the separate, still-in-flight Fleet Operations mission-category
             rebuild and doesn't exist in this file yet. .captain-list-item
             has no standalone stacking/gap behavior of its own -- it normally
             relies on its usual parent .captain-list (display:flex;
             flex-direction:column; gap:2px) for that -- so .battlespace-
             locked-list below reproduces just that same flex/gap pairing
             as a tiny scoped class, without duplicating any of
             .captain-list-item's own visual rules. -->
        <div class="battlespace-locked-list">
          <div class="captain-list-item locked" title="Coming soon — not yet available">🔒 Fleet Skirmishes</div>
          <div class="captain-list-item locked" title="Coming soon — not yet available">🔒 Campaign</div>
          <div class="captain-list-item locked" title="Coming soon — not yet available">🔒 Fleet Exercises</div>
          <div class="captain-list-item locked" title="Coming soon — not yet available">🔒 Invasion</div>
        </div>
      </Panel>
      </div>
      {/if}

      {#if activeTab === "system"}
      <SubTabs
        tabs={[
          { key: "options", label: "Options" },
          { key: "log", label: "Log" },
          ...(DEV_MODE_ENV ? [{ key: "debug", label: "Debug" }] : []),
          { key: "about", label: "About" },
          { key: "patchNotes", label: "Patch Notes" },
          { key: "systemLocked1", label: "Coming Soon!", locked: true },
          { key: "systemLocked2", label: "Coming Soon!", locked: true },
        ]}
        active={activeSystemSubTab}
        onSelect={(key) => (activeSystemSubTab = key as SystemSubTab)}
      />

      <div class="tab-scroll-area">
      {#if activeSystemSubTab === "options"}
      <Panel>
        <div class="panel-title">OPTIONS</div>
        <div class="theme-row">
          {#each THEME_NAMES as name}
            <button
              class="theme-swatch"
              class:active={currentTheme === name}
              style="background:{THEME_PREVIEW_COLORS[name]}"
              title={name}
              aria-label={name}
              on:click={() => setTheme(name)}
            ></button>
          {/each}
        </div>
        <div class="dev-row">
          <button class="dev-btn" on:click={doExportSave}>Export Save</button>
          <!-- Label-wrapping-hidden-input is the standard way to skin a file
               input as a regular button (native file inputs can't be styled
               directly) -- clicking the visible "Import Save" text triggers
               the hidden input beneath it. Reuses .dev-btn as-is (no new CSS
               needed -- a <label> displays/cursors sensibly here the same as
               the <button> siblings either side of it). -->
          <label class="dev-btn">
            Import Save
            <input type="file" accept="application/json,.json" style="display:none" on:change={onImportFileSelected} />
          </label>
          <button class="dev-btn danger" on:click={() => (deleteModalOpen = true)}>Delete Save</button>
        </div>
      </Panel>
      {/if}

      {#if DEV_MODE_ENV && activeSystemSubTab === "debug"}
        <Panel class="dev-panel">
          <div class="panel-title dev-title">DEBUG PANEL (dev-only)</div>
          <div class="dev-row">
            <span class="dev-label">Speed</span>
            {#each [1, 10, 100, 1000, 0] as s}
              <button class="dev-btn" class:active={speed === s} on:click={() => (speed = s)}>
                {s === 0 ? "Pause" : `${s}x`}
              </button>
            {/each}
          </div>
          <div class="dev-row">
            <span class="dev-label">Offline sim</span>
            <button class="dev-btn" on:click={() => simulateOffline(1)}>+1h</button>
            <button class="dev-btn" on:click={() => simulateOffline(8)}>+8h</button>
            <button class="dev-btn" on:click={() => simulateOffline(24)}>+24h</button>
          </div>
          <div class="dev-row">
            <button class="dev-btn" on:click={doSave}>Save now</button>
            <button class="dev-btn danger" on:click={resetSave}>Reset save</button>
          </div>
        </Panel>
      {/if}

      {#if activeSystemSubTab === "log"}
      <Panel>
        <div class="panel-title">LOG</div>
        <div class="log-list">
          {#if logEntries.length === 0}
            <div class="log-empty">No events yet.</div>
          {/if}
          {#each logEntries as entry}
            <div class="log-entry">{entry}</div>
          {/each}
        </div>
      </Panel>
      {/if}

      {#if activeSystemSubTab === "about"}
      <Panel>
        <div class="panel-title">ABOUT THE APP</div>
        <div class="header-left">
          <span class="title">FLEET ADMIRAL</span>
          <span class="subtitle">prototype build · multi-captain · single sector</span>
        </div>
        <div class="research-cost">Version {APP_VERSION}</div>
        <p class="prestige-text">Contact info coming soon.</p>
      </Panel>
      {/if}

      {#if activeSystemSubTab === "patchNotes"}
      <Panel>
        <div class="panel-title">PATCH NOTES</div>
        <div class="log-list">
          {#each PATCH_NOTES as note}
            <div class="log-entry">
              <strong>{note.version}</strong> — {note.summary}
            </div>
          {/each}
        </div>
      </Panel>
      {/if}
      </div>
      {/if}
    </main>

    <div class="nav-tabs">
      <button class="nav-tab" class:active={activeTab === "homeworld"} on:click={() => (activeTab = "homeworld")}>Homeworld</button>
      <button class="nav-tab" class:active={activeTab === "sectorSpace"} on:click={() => (activeTab = "sectorSpace")}>Sector Space</button>
      <button class="nav-tab" class:active={activeTab === "fleetCaptains"} on:click={() => (activeTab = "fleetCaptains")}>Command</button>
      <button class="nav-tab" class:active={activeTab === "fleetOperations"} on:click={() => (activeTab = "fleetOperations")}>Operations</button>
      <button class="nav-tab" class:active={activeTab === "battlespace"} on:click={() => (activeTab = "battlespace")}>Battlespace</button>
      <button class="nav-tab" class:active={activeTab === "system"} on:click={() => (activeTab = "system")}>System</button>
    </div>
  </div>

  {#if missionPopupKey !== null}
    <!-- Captain-selection popup (2026-07-07 Fleet Operations Mission UI,
         Task 5) -- consumes missionPopupKey/missionPopupCaptainId (state) and
         openMissionPopup/closeMissionPopup/doDispatchFromPopup (handlers),
         all declared/implemented earlier in this file (Task 3). Reuses the
         exact .modal-backdrop/Panel.modal-dialog pattern the DELETE SAVE
         modal below already establishes, so both modals share one visual
         language. Two-step flow: no captain selected yet shows an idle-
         captain picker list; once missionPopupCaptainId is set, the SAME
         popup re-renders with the live drop-rate/timing preview and swaps in
         a Dispatch button. This preview's bonus math (2026-07-07 Loot Tier
         Rework: uncommonChanceMult/rareChanceMult/effectiveUncommonChance/
         effectiveRareChance/commonYieldMult/uncommonYieldMult/rareYieldMult,
         replacing the old single-mult/weighted-lootTable shape) is
         hand-traced against tick.ts's own rollExtractionTick to use the
         IDENTICAL formula shape (same Math.min(1, missionDef.X * (1 + mult))
         clamp, same which-mult-affects-which-tier mapping) -- so the numbers
         shown here are never misleading about what the real dispatched
         mission will actually do. -->
    {@const missionDef = MISSIONS[missionPopupKey]}
    {@const selectedCaptain = missionPopupCaptainId !== null ? state.captains.find((c) => c.id === missionPopupCaptainId) ?? null : null}
    {@const idleCaptains = state.captains.filter((c) => c.mission === null)}
    <div class="modal-backdrop">
      <Panel class="modal-dialog">
        <div class="panel-title">{missionDef.label.toUpperCase()}</div>

        {#if selectedCaptain === null}
          <p class="modal-instruction">Select a captain to preview mission stats.</p>
          {#if idleCaptains.length === 0}
            <p class="prestige-text">No eligible captains available.</p>
          {:else}
            <div class="modal-captain-list">
              {#each idleCaptains as captain}
                <button class="dev-btn" on:click={() => (missionPopupCaptainId = captain.id)}>{captain.label}</button>
              {/each}
            </div>
          {/if}
        {:else}
          <!-- Per-tier bonus math (2026-07-07 Loot Tier Rework) -- mirrors
               tick.ts's rollExtractionTick EXACTLY: same Math.min(1, ...)
               clamp on each tier's occurrence chance, same (1 + mult) yield
               scaling, same which-mult-affects-which-tier mapping.
               rareYieldMult is FLEET-WIDE ONLY (fleetLogisticsYield/Fleet
               Requisitions, a Homeworld Talent, is the ONLY source of
               rareYieldMult in the whole talent tree -- there is no
               captain-level rare-yield talent), so it reads
               fleetRareYieldMult(state) directly with NO captain-level
               contribution added, unlike commonYieldMult/uncommonYieldMult
               below which each sum ONLY this captain's own Captain Talents. -->
          {@const uncommonChanceMult = captainUncommonChanceMult(selectedCaptain)}
          {@const rareChanceMult = captainRareChanceMult(selectedCaptain)}
          {@const effectiveUncommonChance = Math.min(1, missionDef.uncommonChance * (1 + uncommonChanceMult))}
          {@const effectiveRareChance = Math.min(1, missionDef.rareChance * (1 + rareChanceMult))}
          {@const commonYieldMult = captainCommonYieldMult(selectedCaptain)}
          {@const uncommonYieldMult = captainUncommonYieldMult(selectedCaptain)}
          {@const rareYieldMult = fleetRareYieldMult(state)}
          {@const transitOutTicks = missionDef.transitOutTicks}
          {@const extractingTicks = requiredTicksForPhase("extracting", missionDef)}
          {@const transitBackTicks = missionDef.transitBackTicks}
          {@const unloadTicks = missionDef.unloadTicks}
          {@const totalTicks = transitOutTicks + extractingTicks + transitBackTicks + unloadTicks}

          <div class="research-name">Captain: {selectedCaptain.label}</div>

          <div class="panel-title">DROP RATES</div>
          <div class="research-cost">Common Ore: up to {formatNumber(missionDef.extractionRatePerTick * (1 + commonYieldMult))}/tick</div>
          <div class="research-cost">Uncommon Material: 1-3/tick, scaled by {(uncommonYieldMult * 100).toFixed(0)}% ({(effectiveUncommonChance * 100).toFixed(1)}% chance/tick)</div>
          <div class="research-cost">Rare Material: 1/tick, scaled by {(rareYieldMult * 100).toFixed(0)}% ({(effectiveRareChance * 100).toFixed(1)}% chance/tick)</div>

          <div class="panel-title">TIMING</div>
          <div class="research-cost">Transit out: {transitOutTicks} ticks ({(transitOutTicks * state.tickDurationSeconds).toFixed(1)}s)</div>
          <div class="research-cost">Extracting: {extractingTicks} ticks ({(extractingTicks * state.tickDurationSeconds).toFixed(1)}s)</div>
          <div class="research-cost">Transit back: {transitBackTicks} ticks ({(transitBackTicks * state.tickDurationSeconds).toFixed(1)}s)</div>
          <div class="research-cost">Unloading: {unloadTicks} ticks ({(unloadTicks * state.tickDurationSeconds).toFixed(1)}s)</div>
          <div class="research-cost"><strong>Total: {totalTicks} ticks ({(totalTicks * state.tickDurationSeconds).toFixed(1)}s)</strong></div>
        {/if}

        <div class="modal-row">
          <button class="dev-btn" on:click={closeMissionPopup}>Cancel</button>
          {#if selectedCaptain !== null}
            <button class="dev-btn" on:click={doDispatchFromPopup}>Dispatch</button>
          {/if}
        </div>
      </Panel>
    </div>
  {/if}

  {#if deleteModalOpen}
    <div class="modal-backdrop">
      <Panel class="modal-dialog">
        <div class="panel-title">DELETE SAVE</div>
        <p class="modal-warning">This will permanently erase your progress. This can't be undone.</p>
        <p class="modal-instruction">Type <strong>DELETE</strong> to confirm.</p>
        <input class="modal-input" type="text" bind:value={deleteConfirmText} aria-label="Type DELETE to confirm" />
        <div class="modal-row">
          <button class="dev-btn" on:click={cancelDelete}>Cancel</button>
          <button class="dev-btn danger" disabled={deleteConfirmText !== "DELETE"} on:click={confirmDelete}>Delete</button>
        </div>
      </Panel>
    </div>
  {/if}

  {#if importModalOpen}
    <!-- Import Save confirmation modal (Task 7, Loot Tier Rework) -- reuses
         the SAME .modal-backdrop/Panel.modal-dialog/.modal-warning/.modal-row
         structure as the DELETE SAVE modal directly above (and the
         mission-selection popup further up this file), so all 3 of this
         app's modals share one visual language. Deliberately has NO typed-
         confirmation-word input like Delete Save's .modal-input above --
         confirmed against the plan doc: selecting a file via the OS picker is
         already a deliberate action, so a plain Cancel/Import button pair is
         enough friction here. importError (set by confirmImport on a
         rejected file) renders as a second .modal-warning line WITHOUT
         closing the modal, so the user can immediately pick a different
         file from the same still-open dialog. -->
    <div class="modal-backdrop">
      <Panel class="modal-dialog">
        <div class="panel-title">IMPORT SAVE</div>
        <p class="modal-warning">This will REPLACE your current save. This can't be undone.</p>
        {#if importError}
          <p class="modal-warning">{importError}</p>
        {/if}
        <div class="modal-row">
          <button class="dev-btn" on:click={cancelImport}>Cancel</button>
          <button class="dev-btn danger" on:click={confirmImport}>Import</button>
        </div>
      </Panel>
    </div>
  {/if}
</div>

<style>
  .root {
    /* Was min-height: 100dvh -- now a HARD height, so this flex column never
       grows past the viewport. The ONE scrollable region below
       (.tab-scroll-area, per active tab) absorbs overflow instead of the
       whole page growing underneath the header/nav bars, which is the entire
       point of this change -- see docs/plans/2026-07-07-scroll-containment-
       locked-placeholders-design.md.
       100vh declared FIRST as a fallback, same cascade-order idiom this
       codebase already uses (app.css's html/body rules, and this rule's own
       prior min-height pair) -- on a browser without dvh support, the second
       line below is invalid CSS and gets ignored entirely, leaving 100vh in
       effect; browsers WITH dvh support apply the second line, overriding
       the first. Without this fallback, a dvh-unsupported browser would get
       NO height on .root at all (an unrecognized declaration is dropped, not
       degraded), collapsing the entire new scroll-containment shell -- a
       real, not hypothetical, regression a code-quality review caught. */
    height: 100vh;
    height: 100dvh;
    position: relative;
    overflow: hidden;
  }
  .frame {
    position: relative;
    z-index: 1;
    height: 100%; /* fills .root's fixed viewport height exactly */
    /* Was 720px (a mobile-first cap dating back to Phase 1, long logged in
       SUGGESTIONS.md as "full-width panels" -- a deferred idea until now),
       then 98%, then 100% with a max-width: 2400px pixel ceiling for
       ultrawide monitors. That pixel ceiling turned out to have the exact
       same problem TWICE now -- a fixed px value can never scale with an
       arbitrarily large screen, so on a real ultrawide monitor wider than
       2400px the app sat in a bounded box with black space on either side,
       the very thing the ceiling was trying to prevent at a smaller scale
       (this already happened once before with an even tighter 1400px
       value). No max-width at all now -- width: 100% already IS a
       percentage, so it scales correctly on any monitor by definition; a
       pixel-based ceiling on top of it can only ever fight that scaling,
       never help it. No separate mobile handling needed. margin:auto
       dropped -- it only centers when there's leftover space outside the
       element, and at width:100% there is none. */
    width: 100%;
    display: flex;
    flex-direction: column;
    overflow: hidden; /* only .tab-scroll-area (nested inside) actually scrolls */
    /* No horizontal padding here anymore (2026-07-07: moved to .tab-body,
       below) -- .top-bar and .nav-tabs are direct flex children of .frame
       with no horizontal padding of their own, so with .frame's own
       horizontal inset removed they now span the full 100% width edge to
       edge (their OWN internal padding still keeps their text/buttons off
       the true edge). Only the middle content area (.tab-body, containing
       the sub-tabs row and every tab's panels) keeps a small inset, so
       header and footer read as full-bleed while the panels still render
       fully inset from the edge. Top padding is still the ONLY place
       safe-area-inset-top is handled -- .top-bar is the very first element
       inside .frame now (the old standalone "FLEET ADMIRAL" title Panel
       above it was retired in favor of an About sub-tab under System, per
       the user's own request), so .frame's own top edge should sit flush
       against the real viewport edge on desktop, same as .nav-tabs already
       does at the bottom (bottom padding is 0 for the same reason). No
       extra flat px on top of the safe-area inset -- env() alone resolves
       to 0px on any device without a notch/status-bar, so this is flush on
       desktop and still clears real notches on devices that have one. */
    padding: env(safe-area-inset-top, 0px) 0 0;
  }
  .header-left { display: flex; flex-direction: column; }
  .title {
    font-family: var(--font-display);
    font-size: 15px;
    letter-spacing: 2px;
    color: var(--color-accent-bright);
  }
  .subtitle { font-size: 11px; color: var(--color-text-secondary); margin-top: 2px; }
  .stat-pill {
    padding: 6px 10px;
    border-radius: 8px;
    background: rgba(var(--color-accent-rgb), 0.08);
    border: 1px solid rgba(var(--color-accent-rgb), 0.2);
    text-align: right;
  }
  .stat-label { font-size: 9px; color: var(--color-text-secondary); text-transform: uppercase; }
  .stat-value { font-family: var(--font-mono); font-size: 13px; color: var(--color-accent); }
  .icon-btn {
    background: rgba(var(--color-accent-rgb), 0.1);
    border: 1px solid rgba(var(--color-accent-rgb), 0.25);
    border-radius: 8px;
    padding: 6px 10px;
    color: var(--color-accent);
    cursor: pointer;
  }
  .tab-body {
    /* Replaces the old .main rule (same class removed from the <main> tag in
       the template -- <main> becomes <main class="tab-body">). This is the
       ONE flexible region between the fixed top-bar and the fixed bottom nav
       -- flex:1 + min-height:0 is the standard flexbox idiom that lets a flex
       child actually SHRINK below its content's natural height (without
       min-height:0, a flex child defaults to min-height:auto, which would let
       its content push .frame taller than the viewport instead of triggering
       the inner scrollbar -- this is the single most common way this exact
       kind of layout silently breaks, so don't drop it). */
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    padding: 10px 11px 0; /* was 14px/16px, cut ~30% per the user's request for a slightly tighter inset. top: gap below .top-bar, whether the tab's first child is a <SubTabs> row or .tab-scroll-area directly. left/right: the horizontal inset moved here from .frame (2026-07-07) -- .top-bar/.nav-tabs are flush edge-to-edge now, only the middle content column (sub-tabs + panels) stays inset, so header/footer read as full-bleed while the panels still render fully inside their own margin. */
  }
  .tab-scroll-area {
    /* THE scrollable region -- every tab wraps its actual panel content in
       exactly one of these. Same flex:1 + min-height:0 idiom as .tab-body
       above, but this time paired with overflow-y:auto so IT (not the page)
       is what actually scrolls. Scrollbar hidden across engines (2026-07-07
       mobile pass) -- still fully scrollable via touch/wheel/drag, just no
       visible track/thumb cluttering the view, matching the app's general
       "no chrome you didn't ask for" feel. */
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    scrollbar-width: none; /* Firefox */
    -ms-overflow-style: none; /* old Edge/IE */
    display: flex;
    flex-direction: column;
    gap: 14px; /* preserves the old .main's gap:14px spacing between stacked panels, now scoped to just the scrollable region */
    padding-bottom: 10px; /* was 14px, cut ~30% to match .tab-body's tightened inset -- breathing room at the very bottom of scrolled content, above .nav-tabs */
  }
  .tab-scroll-area::-webkit-scrollbar { display: none; } /* Chrome/Safari/most mobile browsers */
  /* The very first element inside .frame now -- the old standalone "FLEET
     ADMIRAL" title Panel that used to sit above it was retired in favor of
     an About sub-tab under System (see the SystemSubTab comment above).
     Also a normal flex child now, not position:fixed (see .frame above). */
  .top-bar {
    background: var(--color-panel-bg-strong);
    border-bottom: 1px solid rgba(var(--color-accent-rgb), 0.3);
    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.35);
    padding: 10px 16px;
    flex-shrink: 0; /* never compresses, even if .tab-scroll-area's content is tall */
  }
  .top-bar-row { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 6px; }
  .top-bar-label { font-size: 11px; letter-spacing: 0.5px; color: var(--color-accent); text-transform: uppercase; }
  .top-bar-value { font-family: var(--font-mono); font-size: 11px; color: var(--color-text-secondary); }
  /* Outer nav (Task 1, Phase 4) -- now the LAST flex child inside .frame
     (Task 1 of this plan moved it here from being the first child of the old
     <main>), so it's the bottom-most thing in the flex column, visually
     identical to today's "pinned to the bottom of the screen" look, just via
     document flow instead of position:fixed. Deliberately distinct from
     .captain-tab below (solid panel-strength background, no rounded corners,
     uppercase+letter-spaced labels) so it reads as the OUTER shell nav rather
     than a second row of the same widget as the INNER captain switcher. */
  .nav-tabs {
    display: flex;
    gap: 2px; /* thin seam between tabs, most visible on the active tab's tinted background -- part of the app-wide "flat panel, thin gap" button pass */
    background: var(--color-panel-bg-strong);
    border-top: 1px solid rgba(var(--color-accent-rgb), 0.3);
    box-shadow: 0 -4px 16px rgba(0, 0, 0, 0.35);
    /* Devices with a gesture-nav home indicator reserve a safe area at the
       bottom of the screen -- still the flush-bottom element (now via
       document flow as .frame's last flex child, not position:fixed), still
       needs this. */
    padding-bottom: env(safe-area-inset-bottom, 0px);
    flex-shrink: 0;
  }
  .nav-tab {
    flex: 1;
    background: transparent;
    border: none;
    border-top: 2px solid transparent;
    padding: 12px 4px 10px;
    color: var(--color-text-secondary);
    font-size: 10px;
    letter-spacing: 0.5px;
    text-transform: uppercase;
    cursor: pointer;
  }
  .nav-tab.active {
    color: var(--color-accent-bright);
    border-top-color: var(--color-accent);
    background: rgba(var(--color-accent-rgb), 0.08);
  }
  .captain-tabs { display: flex; gap: 8px; }
  .captain-tab {
    flex: 1;
    background: rgba(var(--color-accent-rgb), 0.06);
    border: 1px solid rgba(var(--color-accent-rgb), 0.2);
    border-radius: 8px;
    padding: 8px 10px;
    color: var(--color-text-secondary);
    font-size: 12px;
    cursor: pointer;
  }
  .captain-tab.active {
    background: rgba(var(--color-accent-rgb), 0.15);
    color: var(--color-accent-bright);
    border-color: var(--color-accent);
  }
  /* Fleet Captain's tab layout (UI Redesign, Task 8) -- left-hand vertical
     captain list + right-hand content pane, replacing the old horizontal
     .captain-tabs row above (left in place for now; see this task's plan
     section and KNOWN_ISSUES.md re: whether it's still used anywhere once
     Task 11 does its final sweep). .captain-list-item now uses the flat,
     square-cornered "panel" look (2026-07-07 button-style pass) instead of
     the old rounded pill -- a thin 2px gap between items reveals the
     background behind, reading as a segmented banner rather than one solid
     strip, matching .nav-tabs/.sub-tab/etc. */
  .fleet-captains-layout { display: flex; gap: 12px; align-items: flex-start; }
  .captain-list { display: flex; flex-direction: column; gap: 2px; flex: 0 0 96px; }
  .captain-list-item {
    background: rgba(var(--color-accent-rgb), 0.06);
    border: 1px solid rgba(var(--color-accent-rgb), 0.2);
    padding: 10px 8px;
    color: var(--color-text-secondary);
    font-size: 12px;
    cursor: pointer;
    text-align: left;
  }
  .captain-list-item.active {
    background: rgba(var(--color-accent-rgb), 0.15);
    color: var(--color-accent-bright);
    border-color: var(--color-accent);
  }
  .captain-list-item.locked {
    opacity: 0.5;
    cursor: not-allowed;
  }
  .captain-list-item.locked:hover {
    border-color: rgba(var(--color-accent-rgb), 0.3);
  }
  /* Battlespace's 4 locked placeholders (mid-plan extra task, 2026-07-07)
     reuse .captain-list-item.locked verbatim but sit inside a Panel, not
     .captain-list -- this reproduces just that parent's flex/gap pairing so
     the reused items stack with the same thin 2px seam they'd get under
     .captain-list, without giving them .captain-list's fixed 96px width. */
  .battlespace-locked-list { display: flex; flex-direction: column; gap: 2px; }
  .fleet-captains-content { flex: 1; min-width: 0; }
  /* Fleet Operations tab layout (2026-07-07 Fleet Operations Mission UI,
     Task 6) -- mirrors .fleet-captains-layout/.captain-list/
     .captain-list-item directly above verbatim in spirit: flat,
     square-cornered panel look with a thin 2px gap between stacked items
     (2026-07-07 button-style pass), not a new visual language. Left-hand
     .mission-category-list is a bit wider (140px vs .captain-list's 96px)
     since "Long-Term Exploration" is a longer label than any captain name. */
  .fleet-ops-layout { display: flex; gap: 12px; align-items: flex-start; }
  .mission-category-list { display: flex; flex-direction: column; gap: 2px; flex: 0 0 140px; }
  .mission-category-item {
    background: rgba(var(--color-accent-rgb), 0.06);
    border: 1px solid rgba(var(--color-accent-rgb), 0.2);
    padding: 10px 8px;
    color: var(--color-text-secondary);
    font-size: 12px;
    cursor: pointer;
    text-align: left;
  }
  .mission-category-item.active {
    background: rgba(var(--color-accent-rgb), 0.15);
    color: var(--color-accent-bright);
    border-color: var(--color-accent);
  }
  .mission-category-item.locked {
    opacity: 0.5;
    cursor: not-allowed;
  }
  .mission-category-item.locked:hover {
    border-color: rgba(var(--color-accent-rgb), 0.3);
  }
  .mission-category-content { flex: 1; min-width: 0; }
  .panel-title {
    font-size: 11px;
    letter-spacing: 1.5px;
    color: var(--color-accent);
    margin-bottom: 12px;
    font-weight: 600;
  }
  /* minmax(0, 1fr), not a bare 1fr (2026-07-07 mobile pass): a bare `1fr`
     track can't shrink below its content's min-content width, so on a
     narrow screen a long formatted number (e.g. "1.23e15") forces the whole
     grid wider than .resource-grid's own container -- and since every
     ancestor up to .root uses overflow:hidden for scroll containment, that
     overflow doesn't scroll into view, it just gets silently clipped off
     the right edge. minmax(0, 1fr) lets the track shrink to fit; the
     overflow-wrap below on .resource-value then wraps the text onto a
     second line inside its own card if it still doesn't fit on one, instead
     of the whole grid overflowing the panel. */
  .resource-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 10px; }
  /* HOME PLANET has exactly 3 loot materials, not 4 -- reusing .resource-grid
     as-is would use its hardcoded repeat(4, 1fr) and leave an empty 4th
     column (uneven, oddly gapped), since that column count is a literal, not
     auto-fill/auto-fit. This modifier overrides just the column count; every
     other .resource-grid rule (gap) and all of .resource-card/-label/-value
     are reused unchanged. */
  .resource-grid-3 { grid-template-columns: repeat(3, minmax(0, 1fr)); }
  .resource-card {
    padding: 10px 8px;
    border-radius: 10px;
    background: var(--color-panel-bg-strong);
    border: 1px solid rgba(var(--color-accent-rgb), 0.14);
    text-align: center;
    min-width: 0; /* lets the card itself shrink to its grid track's width, same reason as the grid comment above */
  }
  .resource-label { font-size: 10px; color: var(--color-text-secondary); margin-bottom: 4px; }
  .resource-value { font-family: var(--font-mono); font-size: 16px; overflow-wrap: break-word; }
  .resource-value.locked { color: var(--color-text-dim); }
  .tick-bar-track {
    height: 10px;
    background: var(--color-panel-bg-strong);
    border: 1px solid rgba(var(--color-accent-rgb), 0.14);
    overflow: hidden;
    clip-path: polygon(
      4px 0,
      calc(100% - 4px) 0,
      100% 4px,
      100% calc(100% - 4px),
      calc(100% - 4px) 100%,
      4px 100%,
      0 calc(100% - 4px),
      0 4px
    );
  }
  .tick-bar-fill {
    height: 100%;
    background: var(--color-accent);
    transition: width 0.1s linear;
  }
  .tick-bar-readout {
    margin-top: 6px;
    font-family: var(--font-mono);
    font-size: 11px;
    color: var(--color-text-secondary);
    text-align: right;
  }
  .research-name { font-size: 13px; font-weight: 600; margin-bottom: 6px; }
  .research-cost { font-size: 12px; color: var(--color-text-secondary); margin-bottom: 10px; }
  .research-status { font-size: 13px; color: var(--color-success); margin: 0; }
  .research-bar-track {
    height: 10px;
    background: var(--color-panel-bg-strong);
    border: 1px solid rgba(var(--color-accent-rgb), 0.14);
    overflow: hidden;
    margin-bottom: 6px;
    clip-path: polygon(
      4px 0,
      calc(100% - 4px) 0,
      100% 4px,
      100% calc(100% - 4px),
      calc(100% - 4px) 100%,
      4px 100%,
      0 calc(100% - 4px),
      0 4px
    );
  }
  .research-bar-fill {
    height: 100%;
    background: var(--color-accent);
    transition: width 0.2s linear;
  }
  .research-readout { font-size: 11px; color: var(--color-text-secondary); text-align: right; }
  .mission-list { display: flex; flex-direction: column; gap: 10px; }
  .mission-card {
    padding: 12px;
    border-radius: 10px;
    background: var(--color-panel-bg-strong);
    border: 1px solid rgba(var(--color-accent-rgb), 0.12);
  }
  .mission-recalled-text { margin-top: 10px; margin-bottom: 0; }
  /* Selectable mission card (2026-07-07 Fleet Operations Mission UI, Task 6)
     -- an actual <button>, unlike the plain .mission-card div above (that one
     is a static in-progress readout, this one opens the captain-selection
     popup on click), so it resets button-default text-align/font/color via
     `text-align:left; color:inherit; font:inherit;` before laying out its own
     flat/thin-border look. Theme-aware via --color-accent-rgb/--color-accent
     only (no hardcoded hex) -- confirmed against app.css's 6
     [data-theme="..."] blocks, which all redefine these same custom
     properties, so this card (and its portrait-frame placeholder below)
     repaint correctly on every theme switch, same as every other themed
     element in this file. */
  .mission-card-selectable {
    display: flex;
    gap: 12px;
    align-items: flex-start;
    text-align: left;
    width: 100%;
    background: rgba(var(--color-accent-rgb), 0.06);
    border: 1px solid rgba(var(--color-accent-rgb), 0.2);
    padding: 12px;
    cursor: pointer;
    color: inherit;
    font: inherit;
  }
  .mission-card-selectable:hover {
    border-color: var(--color-accent);
  }
  /* Portrait-frame placeholder -- no ship/captain art asset exists yet (see
     the 🖼️ emoji placeholder in the template), so this is a dashed
     theme-tinted box rather than an <img>, sized to read clearly as "art
     goes here" without implying a real image failed to load. */
  .mission-portrait-frame {
    flex: 0 0 64px;
    height: 64px;
    border: 1px dashed rgba(var(--color-accent-rgb), 0.4);
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 24px;
    color: var(--color-text-secondary);
    background: rgba(var(--color-accent-rgb), 0.03);
  }
  .mission-card-body { flex: 1; min-width: 0; }
  /* No existing non-dev-panel "danger" button style to reuse -- .dev-btn.danger
     is scoped to the amber dev-panel look, and .prestige-btn's warning color
     is for a different semantic (fleet prestige), not "cancel an in-progress
     action." Shaped like .spec-btn (same padding/font-size, both flat-cornered
     since the 2026-07-07 button-style pass) but colored with --color-danger
     to read as a distinct, cautionary action. */
  .recall-btn {
    background: rgba(248, 113, 113, 0.1);
    border: 1px solid rgba(248, 113, 113, 0.4);
    padding: 8px 12px;
    color: var(--color-danger);
    font-size: 11px;
    cursor: pointer;
    margin-top: 10px;
  }
  .module-list { display: flex; flex-direction: column; gap: 10px; }
  .module-card {
    padding: 12px;
    border-radius: 10px;
    background: var(--color-panel-bg-strong);
    border: 1px solid rgba(var(--color-accent-rgb), 0.12);
  }
  .module-card.locked { opacity: 0.5; }
  .module-top { display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 8px; }
  .module-name { font-size: 13px; font-weight: 600; }
  .module-rate { font-size: 11px; color: var(--color-text-secondary); font-family: var(--font-mono); margin-top: 2px; }
  .buy-btn {
    background: rgba(var(--color-accent-rgb), 0.15);
    border: 1px solid var(--color-border-strong);
    padding: 8px 10px;
    color: var(--color-accent-bright);
    font-size: 12px;
    font-family: var(--font-mono);
    cursor: pointer;
  }
  .buy-btn:disabled { cursor: not-allowed; }
  .prestige-text { font-size: 12px; color: var(--color-text-secondary); line-height: 1.5; margin: 0 0 12px; }
  .locked-heading {
    font-size: 13px;
    font-weight: 600;
    color: var(--color-text-secondary);
    opacity: 0.7;
    margin: 0 0 6px;
  }
  .prestige-row { display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 10px; }
  .prestige-yield { font-size: 12px; }
  .prestige-btn {
    background: rgba(251, 191, 36, 0.15);
    border: 1px solid rgba(251, 191, 36, 0.5);
    color: var(--color-warning);
    padding: 10px 18px;
    font-size: 12px;
    letter-spacing: 1px;
    cursor: pointer;
  }
  .spec-current { font-size: 11px; color: var(--color-text-secondary); margin: 10px 0; }
  .spec-picker { display: flex; gap: 2px; flex-wrap: wrap; margin-top: 10px; }
  .spec-btn {
    background: rgba(var(--color-accent-rgb), 0.1);
    border: 1px solid rgba(var(--color-accent-rgb), 0.3);
    padding: 8px 12px;
    color: var(--color-accent-bright);
    font-size: 11px;
    cursor: pointer;
  }
  .spec-btn:disabled { cursor: not-allowed; }
  .skill-branch { margin-bottom: 14px; }
  .skill-branch:last-child { margin-bottom: 0; }
  .skill-branch-title {
    font-size: 10px;
    letter-spacing: 1px;
    text-transform: uppercase;
    color: var(--color-text-secondary);
    margin-bottom: 8px;
  }
  .skill-node {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 8px 10px;
    border-radius: 8px;
    background: var(--color-panel-bg-strong);
    border: 1px solid rgba(var(--color-accent-rgb), 0.12);
    margin-bottom: 6px;
    gap: 8px;
  }
  .skill-node:last-child { margin-bottom: 0; }
  .skill-node.owned { border-color: var(--color-success); }
  .skill-node.locked { opacity: 0.5; }
  .skill-node-label { font-size: 12px; font-weight: 600; }
  .skill-node-status { font-size: 11px; color: var(--color-text-secondary); }
  .theme-row { display: flex; gap: 8px; margin-bottom: 12px; }
  .theme-swatch {
    width: 28px;
    height: 28px;
    border-radius: 50%;
    border: 2px solid transparent;
    cursor: pointer;
    padding: 0;
  }
  .theme-swatch.active {
    border-color: var(--color-text-primary);
  }
  .dev-title { color: var(--color-warning) !important; }
  .dev-row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-bottom: 8px; }
  .dev-label { font-size: 11px; color: var(--color-text-secondary); width: 78px; }
  .dev-btn {
    background: rgba(251, 191, 36, 0.08);
    border: 1px solid rgba(251, 191, 36, 0.3);
    color: #fcd34d;
    padding: 6px 10px;
    font-size: 11px;
    cursor: pointer;
  }
  .dev-btn.active { background: rgba(251, 191, 36, 0.3); color: #fff; }
  .dev-btn.danger { color: var(--color-danger); }
  .dev-btn:disabled { opacity: 0.4; cursor: not-allowed; }
  .log-list { display: flex; flex-direction: column; gap: 6px; max-height: 140px; overflow-y: auto; }
  .log-empty { font-size: 12px; color: var(--color-text-dim); }
  .log-entry { font-size: 12px; color: #9fc4cc; font-family: var(--font-mono); }
  .modal-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.6);
    backdrop-filter: blur(6px);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 100;
    padding: 20px;
  }
  .modal-dialog {
    max-width: 360px;
    width: 100%;
  }
  .modal-warning { font-size: 13px; color: var(--color-danger); line-height: 1.5; margin: 0 0 10px; }
  .modal-instruction { font-size: 12px; color: var(--color-text-secondary); margin: 0 0 8px; }
  .modal-input {
    width: 100%;
    padding: 8px 10px;
    margin-bottom: 14px;
    background: var(--color-panel-bg-strong);
    border: 1px solid var(--color-border-strong);
    border-radius: 8px;
    color: var(--color-text-primary);
    font-family: var(--font-mono);
    font-size: 13px;
  }
  .modal-row { display: flex; justify-content: flex-end; gap: 2px; }
  /* Popup captain-picker list (2026-07-07 Fleet Operations Mission UI, Task 6)
     -- stacks the idle-captain buttons inside the captain-selection popup
     (Task 5) with the same thin 2px gap as .captain-list/.mission-category-list
     above. Reuses .dev-btn as-is for each individual captain button (already
     flat-cornered from the 2026-07-07 button-style pass) -- this class only
     supplies the container's flex/gap, no new button style needed. */
  .modal-captain-list { display: flex; flex-direction: column; gap: 2px; margin: 10px 0; }
</style>
