<script lang="ts">
  // ============================================================================
  // GambitEditorPanel.svelte
  // Author: Claude (Opus 4.8) | Exploration 0.14.0 phase E3b (Away-Team Gambits)
  //
  // The player-facing GAMBIT RULE EDITOR, rendered as the "Away-Team Gambits" section of the Exploration
  // Ops tab (right under the Expedition Console). It realizes the approved "Away-Team Gambits" mockup:
  // per-role (Security / Science) tabs over an ordered, first-match TARGET -> ACTION rule list, with an
  // inline param editor (a granular HP-threshold slider, a status picker), reorder + add + remove, the 6
  // locked presets, and live validation.
  //
  // POSTURE (mirrors ExpeditionPanel / SeniorStaffPanel / PersonnelRostersPanel exactly):
  //   - PURE PRESENTATION + INTERACTION. It READS live state (state.gambitPrograms, the account-level pair)
  //     + the gambit.ts pure catalogs/validators, and NEVER mutates state: every edit bubbles UP to the
  //     host (App.svelte) via callbacks, which write state.gambitPrograms[role] + doSave in one place. When
  //     the host reassigns `state`, every derived value below recomputes.
  //   - RESPONSIVE the container-query way (ONE shared DOM, split by CSS only, NO isMobile JS): the wrap is
  //     an inline-size container; a wide container lays each rule row as [target] -> [action] side by side,
  //     a narrow one (<= 559px, e.g. 375px phones) stacks the target block above the action block. Works at
  //     375px.
  //
  // The programs are ACCOUNT-LEVEL. D19 (user, 2026-10-06): NO battle reads them any more. Each Security
  // member runs their own program, else the built-in DEFAULT_MEMBER_GAMBIT (no automatic kit use), so an
  // edit here changes no member; a notice line says so. The stored pair is kept (and still editable) until
  // the per-member editor (E-CREW Task 17) replaces this surface. The engine + interpreter live in gambit.ts;
  // this panel owns only the editing surface.
  // ============================================================================

  import type {
    GameState,
    GambitRole,
    GambitRule,
    GambitProgram,
    GambitTargetSelector,
    GambitActionId,
    GambitStatusId,
  } from "./game/model";
  import {
    GAMBIT_PRESETS,
    GAMBIT_STATUSES,
    isActionLegalForRole,
    validateGambitProgram,
  } from "./game/gambit";

  // --- Props ------------------------------------------------------------------
  export let state: GameState;
  // Replace the rule at `index` for `role` with `rule`. Host: write state.gambitPrograms[role][index] -> doSave.
  export let onSetRule: (role: GambitRole, index: number, rule: GambitRule) => void;
  // Append a rule to `role`'s program. Host: push -> doSave.
  export let onAddRule: (role: GambitRole, rule: GambitRule) => void;
  // Remove the rule at `index`. Host: splice -> doSave.
  export let onRemoveRule: (role: GambitRole, index: number) => void;
  // Move the rule at `index` one step in `dir` (reorder == priority). Host: swap -> doSave.
  export let onMoveRule: (role: GambitRole, index: number, dir: "up" | "down") => void;
  // Load a preset's program PAIR into state.gambitPrograms. Host: gambitPresetPrograms(presetId) -> doSave.
  export let onApplyPreset: (presetId: string) => void;

  // --- Local UI state ---------------------------------------------------------
  let activeRole: GambitRole = "security";

  // --- Static vocabulary (readable labels, grouped for the dropdowns) ---------
  const SELECTOR_GROUPS: { label: string; ids: GambitTargetSelector[] }[] = [
    {
      label: "Foe",
      ids: [
        "foeNearest",
        "foeFarthest",
        "foeHighestHp",
        "foeLowestHp",
        "foeHighestThreat",
        "foeIsHealer",
        "foeIsCaster",
        "foeHasStatus",
        "foeLargestGroup",
      ],
    },
    { label: "Ally / Self", ids: ["allyLowestHp", "allyHpBelow", "allyHasStatus", "self", "selfHpBelow", "selfHasStatus"] },
    { label: "Conditions", ids: ["openingRound", "outnumbered"] },
  ];
  const SELECTOR_LABEL: Record<GambitTargetSelector, string> = {
    foeNearest: "Foe: nearest",
    foeFarthest: "Foe: farthest",
    foeHighestHp: "Foe: highest HP",
    foeLowestHp: "Foe: lowest HP",
    foeHighestThreat: "Foe: highest threat",
    foeIsHealer: "Foe: is healer",
    foeIsCaster: "Foe: is caster",
    foeHasStatus: "Foe: has status",
    foeLargestGroup: "Foe: largest group",
    allyLowestHp: "Ally: lowest HP",
    allyHpBelow: "Ally: HP below",
    allyHasStatus: "Ally: has status",
    self: "Self",
    selfHpBelow: "Self: HP below",
    selfHasStatus: "Self: has status",
    openingRound: "Opening round",
    outnumbered: "Outnumbered",
  };

  // The full action list in a stable order; the editor FILTERS it by role via isActionLegalForRole so a
  // Security rule can never pick a Science-only action (and vice-versa).
  const ALL_ACTIONS: GambitActionId[] = [
    "attack",
    "suppress",
    "taunt",
    "execute",
    "brace",
    "cure",
    "aidHeal",
    "shieldAlly",
    "analyze",
    "secureObjective",
    "takeCover",
    "useItem",
    "fallBack",
    "hold",
  ];
  const ACTION_LABEL: Record<GambitActionId, string> = {
    attack: "Attack",
    suppress: "Suppress",
    taunt: "Taunt",
    execute: "Execute",
    brace: "Brace",
    cure: "Cure",
    aidHeal: "Aid Heal",
    shieldAlly: "Shield Ally",
    analyze: "Analyze",
    secureObjective: "Secure Objective",
    takeCover: "Take Cover",
    useItem: "Use Item",
    fallBack: "Fall Back",
    hold: "Hold",
  };
  const ALL_STATUSES: GambitStatusId[] = Object.keys(GAMBIT_STATUSES) as GambitStatusId[];

  // A sensible per-role default for a freshly added rule.
  const DEFAULT_RULE: Record<GambitRole, GambitRule> = {
    security: { target: "foeNearest", action: "attack" },
    science: { target: "allyLowestHp", action: "aidHeal" },
  };

  // --- Predicates (which controls a rule needs) -------------------------------
  const HAS_STATUS_SELECTORS: GambitTargetSelector[] = ["foeHasStatus", "allyHasStatus", "selfHasStatus"];
  const HP_THRESHOLD_SELECTORS: GambitTargetSelector[] = ["allyHpBelow", "selfHpBelow"];
  function needsThreshold(rule: GambitRule): boolean {
    return HP_THRESHOLD_SELECTORS.includes(rule.target);
  }
  function needsStatus(rule: GambitRule): boolean {
    return HAS_STATUS_SELECTORS.includes(rule.target) || rule.action === "cure" || rule.action === "useItem";
  }
  // Whether the status picker may offer "(any debuff)": every status-needing case except foeHasStatus (which
  // must name a concrete status to match a foe).
  function statusAllowsAny(rule: GambitRule): boolean {
    return rule.target !== "foeHasStatus";
  }

  // Strip params the rule no longer needs, so a stored rule stays minimal (and matches the preset shapes).
  function normalizeRule(rule: GambitRule): GambitRule {
    const params: { hpThreshold?: number; statusId?: GambitStatusId } = {};
    if (needsThreshold(rule)) params.hpThreshold = rule.params?.hpThreshold ?? 0.5;
    if (needsStatus(rule)) {
      if (rule.params?.statusId) params.statusId = rule.params.statusId;
      // foeHasStatus MUST name a concrete status to match a foe (an "any" foe-status is inert); default it.
      else if (rule.target === "foeHasStatus") params.statusId = ALL_STATUSES[0];
    }
    const hasParams = Object.keys(params).length > 0;
    return hasParams ? { target: rule.target, action: rule.action, params } : { target: rule.target, action: rule.action };
  }

  // --- Derived reads ----------------------------------------------------------
  $: program = (state.gambitPrograms[activeRole] ?? []) as GambitProgram;
  $: legalActions = ALL_ACTIONS.filter((a) => isActionLegalForRole(activeRole, a));
  $: issues = validateGambitProgram(activeRole, program);
  $: illegalIndexes = new Set(issues.map((i) => i.index));

  // Which preset (if any) the CURRENT account pair matches, so the player sees their starting point. Uses a
  // structural compare (not JSON, which is key-order fragile).
  function ruleEq(a: GambitRule, b: GambitRule): boolean {
    return (
      a.target === b.target &&
      a.action === b.action &&
      (a.params?.hpThreshold ?? null) === (b.params?.hpThreshold ?? null) &&
      (a.params?.statusId ?? null) === (b.params?.statusId ?? null)
    );
  }
  function progEq(a: GambitProgram, b: GambitProgram): boolean {
    return a.length === b.length && a.every((r, i) => ruleEq(r, b[i]));
  }
  // E-CREW (Task 13): presets are Security-only and nothing executes a Science program, so the match reads
  // the Security program alone (an old save's leftover Science program must not hide its preset).
  $: matchedPreset =
    GAMBIT_PRESETS.find((p) => progEq(p.programs.security, state.gambitPrograms.security)) ?? null;

  // --- Edit helpers (build a rule + route to the host; NO local mutation) -----
  function patchRule(index: number, patch: Partial<GambitRule>): void {
    const current = program[index];
    if (!current) return;
    onSetRule(activeRole, index, normalizeRule({ ...current, ...patch, params: { ...current.params, ...patch.params } }));
  }
  function onSelectorChange(index: number, value: string): void {
    patchRule(index, { target: value as GambitTargetSelector });
  }
  function onActionChange(index: number, value: string): void {
    patchRule(index, { action: value as GambitActionId });
  }
  function onThresholdChange(index: number, pctValue: number): void {
    const clamped = Math.max(5, Math.min(95, Math.round(pctValue)));
    patchRule(index, { params: { hpThreshold: clamped / 100 } });
  }
  function onStatusChange(index: number, value: string): void {
    patchRule(index, { params: { statusId: value === "" ? undefined : (value as GambitStatusId) } });
  }
  function addRule(): void {
    onAddRule(activeRole, { ...DEFAULT_RULE[activeRole] });
  }

  // Display helpers.
  function thresholdPct(rule: GambitRule): number {
    return Math.round((rule.params?.hpThreshold ?? 0.5) * 100);
  }
  function statusValue(rule: GambitRule): string {
    return rule.params?.statusId ?? "";
  }
</script>

<div class="ge">
  <!-- ROLE TABS -->
  <div class="ge-tabs" role="tablist" aria-label="Away-team role">
    {#each [{ id: "security", label: "Security" }, { id: "science", label: "Science" }] as t (t.id)}
      <button
        type="button"
        class="ge-tab"
        class:active={activeRole === t.id}
        role="tab"
        aria-selected={activeRole === t.id}
        on:click={() => (activeRole = t.id as GambitRole)}
      >
        {t.label}
        <span class="ge-tab-count">{(state.gambitPrograms[t.id as GambitRole] ?? []).length}</span>
      </button>
    {/each}
  </div>

  <p class="ge-notice" role="note">
    Away-team members now fight with <b>their own</b> program, or the built-in default (full targeting,
    attack and defense, no automatic kit use). The rules on this page are saved but do not change any
    battle until per-member editing arrives.
  </p>

  <p class="ge-intro">
    Rules run <b>top to bottom</b>: a member running a program takes the <b>first</b> rule whose condition
    holds, every round. Reorder to set priority.
  </p>

  <!-- RULE LIST -->
  {#if program.length === 0}
    <div class="ge-empty">
      No rules: this role <b>holds</b> every round (does nothing). Add a rule or load a preset below.
    </div>
  {:else}
    <div class="ge-rules">
      {#each program as rule, i (i)}
        <div class="ge-rule" class:illegal={illegalIndexes.has(i)}>
          <span class="ge-ord">#{i + 1}</span>

          <!-- TARGET block (selector + its params) -->
          <div class="ge-part ge-target">
            <span class="ge-part-tag">Target</span>
            <select
              class="ge-select"
              aria-label={`Rule ${i + 1} target`}
              value={rule.target}
              on:change={(e) => onSelectorChange(i, e.currentTarget.value)}
            >
              {#each SELECTOR_GROUPS as grp}
                <optgroup label={grp.label}>
                  {#each grp.ids as sid}
                    <option value={sid}>{SELECTOR_LABEL[sid]}</option>
                  {/each}
                </optgroup>
              {/each}
            </select>
            {#if needsThreshold(rule)}
              <div class="ge-param ge-thresh">
                <input
                  type="range"
                  min="5"
                  max="95"
                  step="5"
                  aria-label={`Rule ${i + 1} HP threshold`}
                  value={thresholdPct(rule)}
                  on:input={(e) => onThresholdChange(i, +e.currentTarget.value)}
                />
                <span class="ge-thresh-val">&lt; {thresholdPct(rule)}%</span>
              </div>
            {/if}
            {#if needsStatus(rule)}
              <select
                class="ge-select ge-param"
                aria-label={`Rule ${i + 1} status`}
                value={statusValue(rule)}
                on:change={(e) => onStatusChange(i, e.currentTarget.value)}
              >
                {#if statusAllowsAny(rule)}<option value="">Any debuff</option>{/if}
                {#each ALL_STATUSES as sid}
                  <option value={sid}>{GAMBIT_STATUSES[sid].label}</option>
                {/each}
              </select>
            {/if}
          </div>

          <span class="ge-arrow" aria-hidden="true">→</span>

          <!-- ACTION block (role-filtered) -->
          <div class="ge-part ge-action">
            <span class="ge-part-tag">Action</span>
            <select
              class="ge-select"
              class:bad={illegalIndexes.has(i)}
              aria-label={`Rule ${i + 1} action`}
              value={rule.action}
              on:change={(e) => onActionChange(i, e.currentTarget.value)}
            >
              {#if !legalActions.includes(rule.action)}
                <!-- A stored illegal action (e.g. from a preset swap): show it so the select is not blank. -->
                <option value={rule.action}>{ACTION_LABEL[rule.action]} (illegal)</option>
              {/if}
              {#each legalActions as a}
                <option value={a}>{ACTION_LABEL[a]}</option>
              {/each}
            </select>
          </div>

          <!-- ROW CONTROLS -->
          <div class="ge-ctrls">
            <button type="button" aria-label={`Move rule ${i + 1} up`} disabled={i === 0} on:click={() => onMoveRule(activeRole, i, "up")}>▲</button>
            <button type="button" aria-label={`Move rule ${i + 1} down`} disabled={i === program.length - 1} on:click={() => onMoveRule(activeRole, i, "down")}>▼</button>
            <button type="button" class="ge-remove" aria-label={`Remove rule ${i + 1}`} on:click={() => onRemoveRule(activeRole, i)}>✕</button>
          </div>
        </div>
      {/each}
    </div>
  {/if}

  <!-- VALIDATION -->
  {#if issues.length > 0}
    <div class="ge-issue">
      {issues.length} rule{issues.length === 1 ? "" : "s"} use an action {activeRole === "security" ? "Security" : "Science"} cannot perform: it is skipped in battle. Pick a legal action.
    </div>
  {/if}

  <button type="button" class="ge-add" on:click={addRule}>+ Add rule</button>

  <!-- PRESETS -->
  <div class="ge-presets">
    <div class="ge-presets-hd">
      <span class="ge-section-tag">Presets</span>
      <span class="ge-current">Current: {matchedPreset ? matchedPreset.title : "Custom"}</span>
    </div>
    <div class="ge-preset-row">
      {#each GAMBIT_PRESETS as p (p.id)}
        <button
          type="button"
          class="ge-preset"
          class:active={matchedPreset?.id === p.id}
          on:click={() => onApplyPreset(p.id)}
        >{p.title}</button>
      {/each}
    </div>
    <p class="ge-note">
      A preset loads both roles at once, overwriting the rules above. Members' programs are snapshotted at
      dispatch, so nothing changes an expedition already in flight.
    </p>
  </div>
</div>

<style>
  .ge {
    container-type: inline-size;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  /* ROLE TABS */
  .ge-tabs {
    display: flex;
    gap: 6px;
  }
  .ge-tab {
    display: inline-flex;
    align-items: center;
    gap: 7px;
    padding: 7px 14px;
    background: rgba(var(--color-accent-rgb), 0.05);
    border: 1px solid rgba(var(--color-accent-rgb), 0.16);
    border-radius: var(--corner);
    color: var(--color-text-secondary);
    font-size: var(--text-sm);
    cursor: pointer;
    -webkit-tap-highlight-color: transparent;
  }
  .ge-tab:hover {
    border-color: rgba(var(--color-accent-rgb), 0.4);
  }
  .ge-tab.active {
    border-color: var(--color-accent);
    background: rgba(var(--color-accent-rgb), 0.14);
    color: var(--color-text-primary);
  }
  .ge-tab-count {
    font-size: var(--text-2xs);
    padding: 0 7px;
    border-radius: 999px;
    background: rgba(var(--color-accent-rgb), 0.16);
    color: var(--color-accent-bright);
  }

  .ge-intro {
    margin: 0;
    font-size: var(--text-xs);
    color: var(--color-text-secondary);
    line-height: 1.5;
  }
  /* D19: these account-level rules no longer drive any battle; say so plainly. */
  .ge-notice {
    margin: 0;
    padding: 8px 10px;
    border-radius: 6px;
    font-size: var(--text-xs);
    line-height: 1.5;
    color: var(--color-warning);
    border: 1px solid rgba(var(--color-warning-rgb, 200, 150, 60), 0.45);
    background: rgba(var(--color-warning-rgb, 200, 150, 60), 0.12);
  }

  .ge-empty {
    font-size: var(--text-sm);
    color: var(--color-text-dim);
    padding: 12px;
    border: 1px dashed rgba(var(--color-accent-rgb), 0.24);
    border-radius: var(--corner);
    line-height: 1.5;
  }

  /* RULE LIST */
  .ge-rules {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .ge-rule {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
    padding: 9px 10px;
    background: rgba(var(--color-accent-rgb), 0.05);
    border: 1px solid rgba(var(--color-accent-rgb), 0.14);
    border-radius: var(--corner);
  }
  .ge-rule.illegal {
    border-color: var(--color-warning);
    background: rgba(var(--color-warning-rgb, 200, 150, 60), 0.08);
  }
  .ge-ord {
    font-family: var(--font-mono);
    font-size: var(--text-2xs);
    color: var(--color-accent-bright);
    flex: 0 0 auto;
  }
  .ge-part {
    display: flex;
    flex-direction: column;
    gap: 3px;
    min-width: 0;
    flex: 1 1 180px;
  }
  .ge-part-tag {
    font-family: var(--font-mono);
    font-size: calc(9px * var(--ui-scale));
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--color-text-dim);
  }
  .ge-arrow {
    flex: 0 0 auto;
    color: var(--color-accent-bright);
    font-size: var(--text-md);
    align-self: center;
    padding-top: 12px;
  }
  .ge-select {
    width: 100%;
    padding: 6px 8px;
    font-size: var(--text-xs);
    color: var(--color-text-primary);
    background: var(--color-bg-deep, rgba(0, 0, 0, 0.25));
    border: 1px solid rgba(var(--color-accent-rgb), 0.28);
    border-radius: var(--corner);
    -webkit-tap-highlight-color: transparent;
  }
  .ge-select.bad {
    border-color: var(--color-warning);
    color: var(--color-warning);
  }
  .ge-param {
    margin-top: 4px;
  }
  .ge-thresh {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .ge-thresh input[type="range"] {
    flex: 1 1 auto;
    min-width: 0;
    accent-color: var(--color-accent);
  }
  .ge-thresh-val {
    flex: 0 0 auto;
    font-size: var(--text-2xs);
    color: var(--color-text-secondary);
    white-space: nowrap;
    min-width: 44px;
    text-align: right;
  }

  /* ROW CONTROLS */
  .ge-ctrls {
    display: flex;
    align-items: center;
    gap: 4px;
    flex: 0 0 auto;
    margin-left: auto;
    align-self: center;
  }
  .ge-ctrls button {
    width: calc(26px * var(--ui-scale));
    height: calc(26px * var(--ui-scale));
    display: inline-flex;
    align-items: center;
    justify-content: center;
    font-size: var(--text-xs);
    color: var(--color-text-secondary);
    background: rgba(var(--color-accent-rgb), 0.08);
    border: 1px solid rgba(var(--color-accent-rgb), 0.2);
    border-radius: var(--corner);
    cursor: pointer;
    -webkit-tap-highlight-color: transparent;
  }
  .ge-ctrls button:hover:not(:disabled) {
    border-color: rgba(var(--color-accent-rgb), 0.5);
    color: var(--color-text-primary);
  }
  .ge-ctrls button:disabled {
    opacity: 0.35;
    cursor: not-allowed;
  }
  .ge-remove:hover:not(:disabled) {
    border-color: var(--color-warning) !important;
    color: var(--color-warning) !important;
  }

  .ge-issue {
    font-size: var(--text-2xs);
    color: var(--color-warning);
    line-height: 1.5;
    padding: 7px 10px;
    background: rgba(var(--color-warning-rgb, 200, 150, 60), 0.1);
    border: 1px solid rgba(var(--color-warning-rgb, 200, 150, 60), 0.3);
    border-radius: var(--corner);
  }

  .ge-add {
    align-self: flex-start;
    padding: 7px 14px;
    font-size: var(--text-sm);
    color: var(--color-text-primary);
    background: rgba(var(--color-accent-rgb), 0.1);
    border: 1px dashed rgba(var(--color-accent-rgb), 0.4);
    border-radius: var(--corner);
    cursor: pointer;
    -webkit-tap-highlight-color: transparent;
  }
  .ge-add:hover {
    background: rgba(var(--color-accent-rgb), 0.16);
  }

  /* PRESETS */
  .ge-presets {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding-top: 8px;
    border-top: 1px solid rgba(var(--color-accent-rgb), 0.12);
  }
  .ge-presets-hd {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 8px;
  }
  .ge-section-tag {
    font-family: var(--font-mono);
    font-size: var(--text-2xs);
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: var(--color-accent-bright);
  }
  .ge-current {
    font-size: var(--text-2xs);
    color: var(--color-text-dim);
  }
  .ge-preset-row {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }
  .ge-preset {
    padding: 6px 12px;
    font-size: var(--text-xs);
    color: var(--color-text-secondary);
    background: rgba(var(--color-accent-rgb), 0.06);
    border: 1px solid rgba(var(--color-accent-rgb), 0.18);
    border-radius: 999px;
    cursor: pointer;
    -webkit-tap-highlight-color: transparent;
  }
  .ge-preset:hover {
    border-color: rgba(var(--color-accent-rgb), 0.45);
    color: var(--color-text-primary);
  }
  .ge-preset.active {
    border-color: var(--color-accent);
    background: rgba(var(--color-accent-rgb), 0.16);
    color: var(--color-text-primary);
  }
  .ge-note {
    margin: 0;
    font-size: var(--text-2xs);
    color: var(--color-text-dim);
    line-height: 1.5;
  }

  /* WIDE container: lay target -> action side by side; keep the arrow inline. On a narrow container the
     row wraps (flex-wrap) so the target block, the arrow, and the action block stack, staying usable at
     375px. */
  @container (min-width: 560px) {
    .ge-part {
      flex: 1 1 40%;
    }
    .ge-arrow {
      padding-top: 0;
    }
  }
</style>
