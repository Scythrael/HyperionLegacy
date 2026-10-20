<script lang="ts">
  // ============================================================================
  // GambitEditorPanel.svelte
  // Author: Claude (Opus 4.8) | Exploration 0.14.0 phase E3b (Away-Team Gambits)
  // Reworked: Ground Operations GO-16 (absorbs E-CREW Task 17's editor): PER-MEMBER programs by ground team.
  //
  // The player-facing GAMBIT RULE EDITOR, rendered as the "Away-Team Gambits" section of the Exploration
  // Ops tab (right under the Expedition Console). The player picks a SHIP, one of its GROUND TEAMS (Alpha /
  // Bravo / Charlie, or the custom name), then a SECURITY MEMBER of that team, and edits that member's own
  // ordered, first-match TARGET -> ACTION rule list (design D16: gambits are per member, Security only). An
  // inline param editor (a granular HP-threshold slider, a status picker), reorder + add + remove, "Apply
  // preset" (the six locked titles), "Use default" (D19: back to the built-in program) and "Copy to squad"
  // (the member's own Security squad). The Science tab is gone: Science never fights (design D2).
  //
  // The old ACCOUNT-LEVEL pair (state.gambitPrograms) stays stored but hidden (plan Q21): no battle reads it
  // (D19). A one-line notice says so, only when the player had set it up (gambitEditorDisplay.ts).
  //
  // POSTURE (mirrors ExpeditionPanel / AwayTeamPanel):
  //   - PURE PRESENTATION + INTERACTION. It READS live state through gambitEditorDisplay.ts (tested) + the
  //     gambit.ts catalogs/validators, and NEVER mutates state: every edit bubbles UP to the host (App.svelte)
  //     do* handlers, which call the pure memberGambits.ts actions + doSave. The pick (ship / team / member)
  //     is local UI state; the view falls back when a pick no longer applies (a member moved, a ship sold).
  //   - RESPONSIVE the container-query way (ONE shared DOM, split by CSS only, NO isMobile JS): a wide
  //     container lays each rule row as [target] -> [action] side by side, a narrow one (<= 559px, e.g.
  //     375px phones) stacks them. Works at 375px.
  // Programs are frozen into the roster snapshot at launch, so an edit never changes a run in flight.
  // ============================================================================

  import type {
    GameState,
    GambitRule,
    GambitTargetSelector,
    GambitActionId,
    GambitStatusId,
  } from "./game/model";
  import { GAMBIT_PRESETS, GAMBIT_STATUSES, isActionLegalForRole, validateGambitProgram } from "./game/gambit";
  import { FIELD_KIT_STATUS_IDS } from "./game/fieldKits";
  import { ACCOUNT_PAIR_NOTICE, accountPairNoticeShown, gambitEditorView } from "./gambitEditorDisplay";
  import { nameList } from "./groundTeamDisplay";
  import Icon from "./ui/Icon.svelte";
  import TeamBadge from "./ui/TeamBadge.svelte";

  // Props
  export let state: GameState;
  // Replace rule `index` of the member's program. Host: setMemberGambitRule -> doSave.
  export let onSetRule: (memberId: string, index: number, rule: GambitRule) => void;
  // Append a rule. Host: addMemberGambitRule -> doSave.
  export let onAddRule: (memberId: string, rule: GambitRule) => void;
  // Remove rule `index`. Host: removeMemberGambitRule -> doSave.
  export let onRemoveRule: (memberId: string, index: number) => void;
  // Move rule `index` one step (reorder == priority). Host: moveMemberGambitRule -> doSave.
  export let onMoveRule: (memberId: string, index: number, dir: "up" | "down") => void;
  // Give the member a copy of a preset's program. Host: applyMemberGambitPreset -> doSave.
  export let onApplyPreset: (memberId: string, presetId: string) => void;
  // Clear the member's own program (back to the built-in default). Host: resetMemberGambit -> doSave.
  export let onReset: (memberId: string) => void;
  // Copy the member's program to the rest of their Security squad. Host: copyMemberGambitToSquad -> doSave.
  export let onCopyToSquad: (shipId: string, memberId: string) => void;

  // Local UI state (the pick)
  let pickShipId: string | null = null;
  let pickTeamIndex: number | null = null;
  let pickMemberId: string | null = null;

  $: view = gambitEditorView(state, { shipId: pickShipId, teamIndex: pickTeamIndex, memberId: pickMemberId });
  // The picked ship fell back to another (sold, gone): drop the old ship's team and member picks too. A
  // function, so the writes are not a reactive cycle (view reads the picks); the view converges next flush.
  function syncPickToView(shipId: string | null): void {
    if (pickShipId === null || shipId === pickShipId) return;
    pickShipId = shipId;
    pickTeamIndex = null;
    pickMemberId = null;
  }
  $: syncPickToView(view.shipId);
  $: member = view.member;
  $: showAccountNotice = accountPairNoticeShown(state);

  function pickShip(id: string): void {
    pickShipId = id;
    pickTeamIndex = null;
    pickMemberId = null;
  }
  function pickTeam(index: number): void {
    pickTeamIndex = index;
    pickMemberId = null;
  }

  // Static vocabulary (readable labels, grouped for the dropdowns)
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
    // Field Kits FKR-6: the Injury Kit's target. Not in SELECTOR_GROUPS yet: the editor's Field Kits pass (FKR-10)
    // offers it with the kit picker; no fight a player can launch carries kits before then.
    allyDowned: "Ally: downed",
  };

  // The full action list in a stable order, FILTERED to Security's legal set (isActionLegalForRole), so a rule
  // can never pick an action a Security member cannot perform.
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
    // Field Kits FKR-4: an enemy-only action (never legal for Security, so never offered).
    flashGrenade: "Flash Grenade",
    // Field Kits FKR-5: legal for Security, but the editor offers it with the Field Kits pass (FKR-10, its "Skips when no
    // charge is left" hint); no fight a player can launch arms a grenade before then.
    throwGrenade: "Throw Grenade",
  };
  // Field Kits FKR-4: the Field Kits conditions stay out of the picker until the editor's Field Kits pass (FKR-10) offers
  // them with their severity; no fight a player can launch inflicts them before then.
  const ALL_STATUSES: GambitStatusId[] = (Object.keys(GAMBIT_STATUSES) as GambitStatusId[]).filter(
    (id) => !(FIELD_KIT_STATUS_IDS as readonly string[]).includes(id),
  );
  const LEGAL_ACTIONS = ALL_ACTIONS.filter((a) => isActionLegalForRole("security", a));

  // A sensible default for a freshly added rule.
  const NEW_RULE: GambitRule = { target: "foeNearest", action: "attack" };

  // Predicates (which controls a rule needs)
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

  // Derived reads
  $: program = member?.program ?? [];
  $: issues = validateGambitProgram("security", program);
  $: illegalIndexes = new Set(issues.map((i) => i.index));
  $: matchedPresetId = member?.presetId ?? null;

  // Edit helpers (build a rule + route to the host; NO local mutation)
  function patchRule(index: number, patch: Partial<GambitRule>): void {
    const current = program[index];
    if (!current || !member) return;
    onSetRule(member.id, index, normalizeRule({ ...current, ...patch, params: { ...current.params, ...patch.params } }));
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

  // Display helpers.
  function thresholdPct(rule: GambitRule): number {
    return Math.round((rule.params?.hpThreshold ?? 0.5) * 100);
  }
  function statusValue(rule: GambitRule): string {
    return rule.params?.statusId ?? "";
  }
</script>

<div class="ge">
  <!-- PICK: ship, ground team, Security member -->
  {#if view.ships.length > 0}
    <div class="ge-pick">
      <label class="ge-field">
        <span class="ge-part-tag">Ship</span>
        <select class="ge-select" value={view.shipId} on:change={(e) => pickShip(e.currentTarget.value)}>
          {#each view.ships as s (s.id)}
            <option value={s.id}>{s.name}</option>
          {/each}
        </select>
      </label>
      <div class="ge-field">
        <span class="ge-part-tag" id="ge-team-tag">Ground team</span>
        <div class="ge-chips" role="group" aria-labelledby="ge-team-tag">
          {#each view.teams as t (t.index)}
            <button
              type="button"
              class="ge-chip ge-team"
              class:active={view.teamIndex === t.index}
              aria-pressed={view.teamIndex === t.index}
              on:click={() => pickTeam(t.index)}
            >
              <TeamBadge index={t.index} kind={t.kind} name={t.name} size="sm" />
              <span class="ge-chip-name">{t.name}</span>
              <span class="ge-chip-sub">{t.securityMembers} Security</span>
              {#if view.teamIndex === t.index}<span class="ge-chip-mark"><Icon name="check" size={14} /></span>{/if}
            </button>
          {/each}
        </div>
      </div>
    </div>
  {/if}

  {#if view.launchedText}
    <p class="ge-launched" role="note"><Icon name="lock" size={14} /> {view.launchedText}</p>
  {/if}

  {#if view.squads.length > 0}
    <div class="ge-squads">
      {#each view.squads as q (q.label)}
        <div class="ge-field">
          <span class="ge-part-tag ge-squad-tag"><Icon name="security" size={12} /> {q.label}</span>
          {#if q.members.length === 0}
            <span class="ge-chip-sub">Nobody slotted.</span>
          {:else}
            <div class="ge-chips" role="group" aria-label={`${q.label} members`}>
              {#each q.members as m (m.id)}
                <button
                  type="button"
                  class="ge-chip"
                  class:active={member?.id === m.id}
                  aria-pressed={member?.id === m.id}
                  on:click={() => (pickMemberId = m.id)}
                >
                  <span class="ge-chip-name">{m.name}</span>
                  <span class="ge-chip-sub">{m.programLabel}</span>
                  {#if member?.id === m.id}<span class="ge-chip-mark"><Icon name="check" size={14} /></span>{/if}
                </button>
              {/each}
            </div>
          {/if}
        </div>
      {/each}
    </div>
  {/if}

  {#if member === null}
    {#if view.emptyText}<div class="ge-empty">{view.emptyText}</div>{/if}
  {:else}
    <div class="ge-member-hd">
      <span class="ge-member-name">{member.name}</span>
      <span class="ge-current">
        {#if member.hasOwn}Own program: <b>{member.programLabel}</b>{:else}Runs the <b>built-in default</b>{/if}
      </span>
    </div>

    <p class="ge-intro">
      Rules run <b>top to bottom</b>: each round {member.name} takes the <b>first</b> rule whose condition holds.
      Reorder to set priority.{#if !member.hasOwn}{" "}Editing a rule gives {member.name} their own copy of the default.{/if}
    </p>

    <!-- RULE LIST -->
    {#if program.length === 0}
      <div class="ge-empty">
        No rules: {member.name} <b>holds</b> every round (does nothing). Add a rule or apply a preset below.
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

            <span class="ge-arrow" aria-hidden="true"><Icon name="chevronRight" size={18} /></span>

            <!-- ACTION block (Security's legal set) -->
            <div class="ge-part ge-action">
              <span class="ge-part-tag">Action</span>
              <select
                class="ge-select"
                class:bad={illegalIndexes.has(i)}
                aria-label={`Rule ${i + 1} action`}
                value={rule.action}
                on:change={(e) => onActionChange(i, e.currentTarget.value)}
              >
                {#if !LEGAL_ACTIONS.includes(rule.action)}
                  <!-- A stored illegal action: show it so the select is not blank. -->
                  <option value={rule.action}>{ACTION_LABEL[rule.action]} (illegal)</option>
                {/if}
                {#each LEGAL_ACTIONS as a}
                  <option value={a}>{ACTION_LABEL[a]}</option>
                {/each}
              </select>
            </div>

            <!-- ROW CONTROLS -->
            <div class="ge-ctrls">
              <button type="button" aria-label={`Move rule ${i + 1} up`} disabled={i === 0} on:click={() => member && onMoveRule(member.id, i, "up")}><Icon name="chevronUp" size={14} /></button>
              <button type="button" aria-label={`Move rule ${i + 1} down`} disabled={i === program.length - 1} on:click={() => member && onMoveRule(member.id, i, "down")}><Icon name="chevronDown" size={14} /></button>
              <button type="button" class="ge-remove" aria-label={`Remove rule ${i + 1}`} on:click={() => member && onRemoveRule(member.id, i)}><Icon name="close" size={14} /></button>
            </div>
          </div>
        {/each}
      </div>
    {/if}

    <!-- VALIDATION -->
    {#if issues.length > 0}
      <div class="ge-issue">
        {issues.length} rule{issues.length === 1 ? "" : "s"} use an action Security cannot perform: it is skipped in battle. Pick a legal action.
      </div>
    {/if}

    <button type="button" class="ge-add" on:click={() => member && onAddRule(member.id, { ...NEW_RULE })}>Add rule</button>

    <!-- PRESETS + SQUAD -->
    <div class="ge-presets">
      <div class="ge-presets-hd">
        <span class="ge-section-tag">Apply preset</span>
      </div>
      <div class="ge-preset-row">
        {#each GAMBIT_PRESETS as p (p.id)}
          <button
            type="button"
            class="ge-preset"
            class:active={matchedPresetId === p.id}
            aria-pressed={matchedPresetId === p.id}
            on:click={() => member && onApplyPreset(member.id, p.id)}
          >{#if matchedPresetId === p.id}<Icon name="check" size={12} /> {/if}{p.title}</button>
        {/each}
      </div>
      <p class="ge-note">
        A preset replaces {member.name}'s rules. Programs are frozen at launch, so nothing changes an expedition
        already in flight.
      </p>
      <div class="ge-squad-row">
        <button
          type="button"
          class="ge-action-btn"
          disabled={member.copyBlockedText !== null}
          on:click={() => member && view.shipId && onCopyToSquad(view.shipId, member.id)}
        >{member.copyLabel}</button>
        <span class="ge-note">
          {#if member.copyBlockedText}{member.copyBlockedText}{:else}Gives {nameList(member.copyTargets)} a copy of this program.{/if}
        </span>
      </div>
      <div class="ge-squad-row">
        <button type="button" class="ge-action-btn" disabled={!member.hasOwn} on:click={() => member && onReset(member.id)}>Use default</button>
        <span class="ge-note">
          {member.hasOwn
            ? "Back to the built-in default: full targeting, attack and defense, no automatic kit use."
            : `${member.name} runs the built-in default: full targeting, attack and defense, no automatic kit use.`}
        </span>
      </div>
    </div>
  {/if}

  {#if showAccountNotice}
    <p class="ge-notice" role="note">{ACCOUNT_PAIR_NOTICE}</p>
  {/if}
</div>

<style>
  .ge {
    container-type: inline-size;
    display: flex;
    flex-direction: column;
    gap: 10px;
    min-width: 0;
  }

  /* Visible keyboard focus on every control. */
  .ge button:focus-visible,
  .ge select:focus-visible,
  .ge input:focus-visible {
    outline: 2px solid var(--color-accent);
    outline-offset: 2px;
  }

  /* PICK */
  .ge-pick,
  .ge-squads {
    display: flex;
    flex-wrap: wrap;
    gap: 10px 16px;
    align-items: flex-start;
  }
  .ge-field {
    display: flex;
    flex-direction: column;
    gap: 4px;
    min-width: 0;
    max-width: 100%;
  }
  .ge-field .ge-select {
    min-width: 180px;
    max-width: 100%;
  }
  .ge-chips {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }
  .ge-chip {
    display: inline-flex;
    align-items: center;
    gap: 7px;
    padding: 6px 10px;
    min-height: 34px;
    max-width: 100%;
    background: rgba(var(--color-accent-rgb), 0.05);
    border: 1px solid rgba(var(--color-accent-rgb), 0.16);
    border-radius: var(--corner);
    color: var(--color-text-secondary);
    font-size: var(--text-sm);
    cursor: pointer;
    -webkit-tap-highlight-color: transparent;
  }
  .ge-chip:hover {
    border-color: rgba(var(--color-accent-rgb), 0.4);
  }
  /* Selected: border + background + bold name + a check glyph (never color alone). */
  .ge-chip.active {
    border-color: var(--color-accent);
    background: rgba(var(--color-accent-rgb), 0.14);
    color: var(--color-text-primary);
  }
  .ge-chip.active .ge-chip-name {
    font-weight: 700;
  }
  .ge-chip-name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .ge-chip-sub {
    font-size: var(--text-2xs);
    color: var(--color-text-dim);
    white-space: nowrap;
  }
  .ge-chip-mark {
    display: inline-flex;
    color: var(--color-accent-bright);
  }
  .ge-squad-tag {
    display: inline-flex;
    align-items: center;
    gap: 5px;
  }
  .ge-launched {
    margin: 0;
    display: flex;
    gap: 6px;
    align-items: flex-start;
    font-size: var(--text-xs);
    color: var(--color-text-secondary);
    line-height: 1.5;
  }

  .ge-member-hd {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 6px 12px;
    padding-top: 8px;
    border-top: 1px solid rgba(var(--color-accent-rgb), 0.12);
  }
  .ge-member-name {
    font-family: var(--font-display);
    font-weight: 700;
    font-size: var(--text-md);
    color: var(--color-text-primary);
  }

  .ge-intro {
    margin: 0;
    font-size: var(--text-xs);
    color: var(--color-text-secondary);
    line-height: 1.5;
  }
  /* Q21: the old account-level pair is stored but never read; one plain line says so. */
  .ge-notice {
    margin: 0;
    padding: 8px 10px;
    border-radius: 6px;
    font-size: var(--text-xs);
    line-height: 1.5;
    color: var(--color-text-secondary);
    border: 1px dashed rgba(var(--color-accent-rgb), 0.3);
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
  /* NARROW (stacked) row: the arrow takes its own line between Target and Action and points DOWN, so the
     stacked row still reads target, then arrow, then action. The wide container query turns it back. */
  .ge-arrow {
    flex: 1 0 100%;
    display: inline-flex;
    justify-content: center;
    color: var(--color-accent-bright);
    align-self: center;
    transform: rotate(90deg);
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
    width: calc(28px * var(--ui-scale));
    height: calc(28px * var(--ui-scale));
    display: inline-flex;
    align-items: center;
    justify-content: center;
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

  .ge-add,
  .ge-action-btn {
    align-self: flex-start;
    flex: 0 0 auto;
    padding: 7px 14px;
    font-size: var(--text-sm);
    color: var(--color-text-primary);
    background: rgba(var(--color-accent-rgb), 0.1);
    border: 1px solid rgba(var(--color-accent-rgb), 0.4);
    border-radius: var(--corner);
    cursor: pointer;
    -webkit-tap-highlight-color: transparent;
  }
  .ge-add {
    border-style: dashed;
  }
  .ge-add:hover,
  .ge-action-btn:hover:not(:disabled) {
    background: rgba(var(--color-accent-rgb), 0.16);
  }
  .ge-action-btn:disabled {
    opacity: 0.45;
    cursor: not-allowed;
  }

  /* PRESETS + SQUAD */
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
  .ge-current b {
    color: var(--color-text-primary);
  }
  .ge-preset-row {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }
  .ge-preset {
    display: inline-flex;
    align-items: center;
    gap: 4px;
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
    font-weight: 700;
  }
  .ge-squad-row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px 10px;
  }
  .ge-note {
    margin: 0;
    font-size: var(--text-2xs);
    color: var(--color-text-dim);
    line-height: 1.5;
    min-width: 0;
  }

  /* WIDE container: lay target -> action side by side; keep the arrow inline. On a narrow container the
     row wraps (flex-wrap) so the target block, the arrow, and the action block stack, staying usable at
     375px. */
  @container (min-width: 560px) {
    .ge-part {
      flex: 1 1 40%;
    }
    .ge-arrow {
      flex: 0 0 auto;
      transform: none;
    }
  }
</style>
