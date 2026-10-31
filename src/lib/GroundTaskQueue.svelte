<script lang="ts">
  // GroundTaskQueue.svelte: the per-planet TASK QUEUE screen (0.14.0, Ground Operations GO-13, mockup GO-M2) with
  // the task cards of the Squads design section 7.3 (mockup section 4), inside the expedition's in-progress view.
  //
  // One block per scanned body: its title and task count, "Default plan" and "Auto-assign randomly" (the user's
  // words), then a table: Task (the task card: name, difficulty pips + grade + "counts xN toward completion", the
  // squad requirement chips marked met / unmet, who covers it, the fight-point bar, the status), Fights, one odds
  // column per deployed team, Assigned (a crew select + Apply, Skip; a skipped task re-queues), Queue (its place in
  // the team's queue, up / down). The run-level stuck flag sits on top with its escape hatch: Skip, right there.
  //
  // POSTURE: pure presentation. Every display decision is in groundTaskQueueDisplay.ts (tested); every edit goes up
  // through `onEdit` to App.svelte doEditGroundOps (editGroundOps: advance to now, validate, apply). A select never
  // acts on change (WCAG 3.2.2): pick, then Apply. The handler validates on the click (canEditGroundOps advances a
  // copy of the run, so it is never called per rendered button) and returns the refusal text, shown in the status
  // line. The table scrolls inside its own wrapper when it is a little too wide, never the page; on a NARROW
  // container (480 px and below, GO-13 review) each row stacks as a card (the task card, then Fights and the odds
  // with their column names, then Assigned / Apply / Skip and the queue under it), so nothing scrolls sideways.
  // The result line is a live region that is always in the page (an empty one is only visually hidden), so the
  // next result is announced (GO-13 review).

  import type { Expedition, ShipInstance } from "./game/model";
  import type { GroundOpsEdit } from "./game/groundOps";
  import {
    AUTO_ASSIGN_LABEL,
    DEFAULT_PLAN_LABEL,
    GROUND_QUEUE_NOTE,
    createOddsMemo,
    crewEdit,
    defaultCrewPick,
    groundQueueView,
    type TaskRowView,
  } from "./groundTaskQueueDisplay";
  import { tick } from "svelte";
  import ObjectiveAffixes from "./ObjectiveAffixes.svelte";
  import Icon from "./ui/Icon.svelte";
  import TeamBadge from "./ui/TeamBadge.svelte";
  import ThreatChip from "./ui/ThreatChip.svelte";

  /** The run (the stored record; the tick keeps it current). */
  export let exp: Expedition;
  /** Its ship (team names), when still known. */
  export let ship: ShipInstance | null = null;
  /** Game time now (the progress bars interpolate along a work step). */
  export let now: number;
  /** Apply an edit; returns null when applied, else the refusal in plain words. */
  export let onEdit: (edit: GroundOpsEdit) => string | null = () => null;

  // The odds memo lives with the screen: a tick never re-reads a cell (see the display module's header).
  const memo = createOddsMemo();
  $: view = groundQueueView(exp, ship, now, memo);

  // The crew picked in each row's select (task id -> crew key), until Apply.
  let picks: Record<string, string> = {};
  // The last action's result line (applied, or why not).
  let message: { text: string; refused: boolean } | null = null;
  let root: HTMLElement;

  // The row's pick (`p` and `run` are passed so the template re-reads it when either changes).
  function pickOf(row: TaskRowView, p: Record<string, string> = picks, run: Expedition = exp): string {
    return p[row.id] ?? defaultCrewPick(row, findTask(run, row.id));
  }
  function findTask(run: Expedition, id: string) {
    for (const body of run.bodies) {
      const t = body.activities.find((a) => a.id === id);
      if (t) return t;
    }
    return undefined;
  }
  function setPick(row: TaskRowView, key: string): void {
    picks = { ...picks, [row.id]: key };
  }
  function clearPick(id: string): void {
    const next = { ...picks };
    delete next[id];
    picks = next;
  }

  // Send an edit, report the result, then put focus back where the player can carry on (the control may have
  // gone: a Skip becomes a Re-queue).
  async function send(edit: GroundOpsEdit, done: string, focusKey: string | null, fallbackKey: string | null = null): Promise<void> {
    const refusal = onEdit(edit);
    // Clear first, so the same words twice in a row are announced again by the live region.
    message = null;
    await tick();
    message = refusal === null ? { text: done, refused: false } : { text: `Not changed: ${refusal}.`, refused: true };
    await tick();
    for (const key of [focusKey, fallbackKey]) {
      if (key === null) continue;
      const el = root?.querySelector<HTMLElement>(`[data-qfocus="${CSS.escape(key)}"]`);
      if (el && !(el as HTMLButtonElement).disabled) {
        el.focus();
        return;
      }
    }
  }

  function apply(row: TaskRowView): void {
    const key = pickOf(row);
    const edit = crewEdit(row, key);
    if (!edit) return;
    const label = row.options.find((o) => o.key === key)?.crew ?? "";
    clearPick(row.id);
    const verb = edit.kind === "requeue" ? "re-queued for" : "assigned to";
    void send(edit, `${row.name} ${verb} ${label}.`, edit.kind === "requeue" ? `${row.id}:skip` : `${row.id}:apply`, `${row.id}:crew`);
  }
  function skip(row: { id: string; name: string }): void {
    clearPick(row.id);
    void send({ kind: "skip", taskId: row.id }, `Skipped ${row.name}.`, `${row.id}:apply`, `${row.id}:crew`);
  }
  function move(row: TaskRowView, delta: -1 | 1): void {
    if (!row.queue) return;
    const self = `${row.id}:${delta < 0 ? "up" : "down"}`;
    const other = `${row.id}:${delta < 0 ? "down" : "up"}`;
    void send({ kind: "reorder", teamIndex: row.queue.teamIndex, taskId: row.id, delta }, `${row.name} moved ${delta < 0 ? "earlier" : "later"}.`, self, other);
  }
  function replan(bodyIndex: number, kind: "defaultPlan" | "autoAssign", title: string): void {
    picks = {};
    const done = kind === "defaultPlan" ? `Default plan applied on ${title}.` : `Queued objectives on ${title} auto-assigned at random.`;
    void send({ kind, bodyIndex }, done, `body-${bodyIndex}:${kind}`);
  }
</script>

<section class="gq" bind:this={root} aria-label="Ground operations objective queues">
  <div class="gq-head">
    <span class="gq-tag">Ground operations · objective queues</span>
  </div>

  {#if view.stuck}
    <!-- User Q4: HOLD AND FLAG. The run keeps retrying; the escape hatch (Skip) is right here. -->
    <div class="gq-stuck" role="status">
      <div class="gq-stuck-text"><Icon name="warning" /> {view.stuck.text}.</div>
      <div class="gq-stuck-hint">{view.stuck.hint}</div>
      <div class="gq-stuck-tasks">
        {#each view.stuck.tasks as t (t.id)}
          <button type="button" class="gq-btn" disabled={view.locked !== null} on:click={() => skip(t)}>Skip {t.name}</button>
        {/each}
      </div>
    </div>
  {/if}

  {#if view.locked}
    <div class="gq-note" role="status"><Icon name="lock" /> {view.locked}</div>
  {/if}
  {#if view.emptyText}
    <div class="gq-note">{view.emptyText}</div>
  {/if}

  <div class="gq-msg" role="status" aria-live="polite">
    {#if message}<span class:refused={message.refused}>{message.text}</span>{/if}
  </div>

  {#each view.bodies as body (body.bodyIndex)}
    <div class="gq-body">
      <div class="gq-body-top">
        <div class="gq-body-id">
          <h4 class="gq-body-title">{body.title}</h4>
          <span class="gq-body-count">{body.countText}</span>
        </div>
        <div class="gq-body-actions">
          <button
            type="button"
            class="gq-btn"
            data-qfocus="body-{body.bodyIndex}:autoAssign"
            disabled={!body.canReplan}
            title={body.replanBlockedText ?? "Hand this body's queued objectives to the deployed teams at random"}
            on:click={() => replan(body.bodyIndex, "autoAssign", body.title)}>{AUTO_ASSIGN_LABEL}</button
          >
          <button
            type="button"
            class="gq-btn primary"
            data-qfocus="body-{body.bodyIndex}:defaultPlan"
            disabled={!body.canReplan}
            title={body.replanBlockedText ?? "Hardest objective to the strongest team, on down"}
            on:click={() => replan(body.bodyIndex, "defaultPlan", body.title)}>{DEFAULT_PLAN_LABEL}</button
          >
        </div>
      </div>

      <!-- GO-M2 `.tw`: the table scrolls sideways inside this wrapper on a phone; the page never does. -->
      <!-- svelte-ignore a11y_no_noninteractive_tabindex, INTENTIONAL: a scrollable region must take keyboard focus so a keyboard user can scroll it sideways (WCAG 2.1.1, axe scrollable-region-focusable); it is a named region. -->
      <div class="gq-tw" role="region" aria-label="{body.title} objectives" tabindex="0">
        <table class="gq-table">
          <thead>
            <tr>
              <th scope="col">Objective</th>
              <th scope="col">Fights</th>
              {#each view.teams as team (team.index)}
                <th scope="col" class="gq-th-team">
                  <span class="gq-th-team-in"><TeamBadge index={team.index} name={team.name} size="sm" /> {team.name}</span>
                  <span class="gq-th-kind">{team.kindName} · odds</span>
                </th>
              {/each}
              <th scope="col">Assigned</th>
              <th scope="col">Queue</th>
            </tr>
          </thead>
          <tbody>
            {#each body.rows as row (row.id)}
              <tr class="gq-row s-{row.status}">
                <th scope="row" class="gq-task">
                  <!-- SQ-7 7.3: the task card -->
                  <div class="gq-card">
                    <div class="gq-card-top">
                      <span class="gq-task-name">{row.name}</span>
                      <span class="gq-status s-{row.status}">{row.statusText}</span>
                    </div>
                    {#if row.flavor}<div class="gq-flavor">{row.flavor}</div>{/if}
                    {#if row.statusDetail}<div class="gq-detail">{row.statusDetail}</div>{/if}
                    {#if row.affixes}<ObjectiveAffixes view={row.affixes} />{/if}
                    {#if row.difficulty}
                      <div class="gq-diff">
                        <span class="gq-pips" aria-hidden="true">
                          {#each row.difficulty.pips as on, i (i)}<i class:on></i>{/each}
                        </span>
                        <span aria-hidden="true">{row.difficulty.name} · {row.difficulty.weightText}</span>
                        <span class="sr">{row.difficulty.ariaLabel}</span>
                      </div>
                    {/if}
                    <div class="gq-needs">
                      {#each row.needs.chips as chip (chip.type)}
                        <span class="gq-need {chip.type}" class:unmet={!chip.met}>
                          <Icon name={chip.type === "security" ? "security" : "research"} />
                          {chip.text}
                          <span class="gq-need-mark"><Icon name={chip.met ? "check" : "close"} /><span class="sr">{chip.met ? "met" : "not met"} by your deployed teams</span></span>
                        </span>
                      {/each}
                    </div>
                    <div class="gq-cover" class:no={!row.needs.covered}>
                      Needs: {row.needs.phrase}. {row.needs.covered ? `Covered by ${row.needs.coverText}.` : `${row.needs.coverText}.`}
                    </div>
                    <div class="gq-bar" role="img" aria-label={row.bar.ariaLabel}>
                      <div class="gq-bar-fill" style="width: {row.bar.progressPct}%;"></div>
                      {#each row.bar.pips as pip, i (i)}
                        <span class="gq-pip" class:won={pip.won} style="left: {pip.at}%;"></span>
                      {/each}
                    </div>
                    <div class="gq-bar-label">{row.bar.progressPct}% · {row.bar.label}</div>
                    {#if row.jointOdds}
                      <div class="gq-joint">Joint crew odds: <ThreatChip assessment={row.jointOdds} size="sm" context="{row.crewText} odds" /></div>
                    {/if}
                  </div>
                </th>
                <td class="gq-num" data-label="Fights"><span aria-hidden="true">{row.bar.fightsText}</span><span class="sr">{row.bar.label}</span></td>
                {#each row.odds as cell, ci (ci)}
                  <td class="gq-odds" data-label="{view.teams[ci]?.name ?? ''} odds">
                    {#if cell.kind === "chip"}
                      <ThreatChip assessment={cell.assessment} size="sm" context={cell.context} />
                    {:else if cell.kind === "partner"}
                      <span class="gq-partner">{cell.text}</span>
                    {:else}
                      <span class="gq-dim" aria-hidden="true">{cell.text}</span><span class="sr">No odds: nothing left to fight</span>
                    {/if}
                  </td>
                {/each}
                <td class="gq-assign" data-label="Assigned">
                  {#if row.status === "done"}
                    <span class="gq-dim">{row.crewText}</span>
                  {:else}
                    {#if row.canAssign || row.canRequeue}
                      <div class="gq-assign-row">
                        <select
                          class="gq-select"
                          data-qfocus="{row.id}:crew"
                          aria-label="Crew for {row.name}"
                          value={pickOf(row, picks, exp)}
                          disabled={view.locked !== null}
                          on:change={(e) => setPick(row, e.currentTarget.value)}
                        >
                          {#each row.options as o (o.key)}
                            <option value={o.key}>{o.label}</option>
                          {/each}
                        </select>
                        {#if row.status === "skipped"}
                          <button type="button" class="gq-btn" data-qfocus="{row.id}:apply" disabled={view.locked !== null} on:click={() => apply(row)}>Re-queue</button>
                        {:else}
                          <button
                            type="button"
                            class="gq-btn"
                            data-qfocus="{row.id}:apply"
                            disabled={view.locked !== null || pickOf(row, picks, exp) === row.crewKey}
                            aria-label="Apply the crew for {row.name}"
                            on:click={() => apply(row)}>Apply</button
                          >
                        {/if}
                      </div>
                    {:else if row.status === "skipped"}
                      <span class="gq-dim">No deployed crew covers it</span>
                    {/if}
                    {@const largerNote = row.options.find((o) => o.key === pickOf(row, picks, exp))?.note ?? null}
                    {#if largerNote}
                      <!-- AF-1: a larger crew's trade-off (user: more punch, half the throughput). -->
                      <div class="gq-larger">{largerNote}</div>
                    {/if}
                    {#if row.canSkip}
                      <button
                        type="button"
                        class="gq-btn subtle"
                        data-qfocus="{row.id}:skip"
                        disabled={view.locked !== null}
                        aria-label="Skip {row.name}"
                        on:click={() => skip(row)}>Skip</button
                      >
                    {/if}
                  {/if}
                </td>
                <td class="gq-queue" data-label="Queue">
                  {#if row.queue}
                    <div class="gq-queue-in">
                      <span class="gq-queue-text">{row.queue.text}</span>
                      <span class="gq-arrows">
                        <button
                          type="button"
                          class="gq-arrow"
                          data-qfocus="{row.id}:up"
                          disabled={view.locked !== null || !row.queue.canUp}
                          aria-label={row.queue.upLabel}
                          title={row.queue.upLabel}
                          on:click={() => move(row, -1)}><Icon name="chevronUp" /></button
                        >
                        <button
                          type="button"
                          class="gq-arrow"
                          data-qfocus="{row.id}:down"
                          disabled={view.locked !== null || !row.queue.canDown}
                          aria-label={row.queue.downLabel}
                          title={row.queue.downLabel}
                          on:click={() => move(row, 1)}><Icon name="chevronDown" /></button
                        >
                      </span>
                    </div>
                  {:else}
                    <span class="gq-dim">-</span>
                  {/if}
                </td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    </div>
  {/each}

  {#if view.bodies.length > 0}
    <div class="gq-note">{GROUND_QUEUE_NOTE}</div>
  {/if}
</section>

<style>
  .gq {
    container-type: inline-size;
    display: flex;
    flex-direction: column;
    gap: 10px;
    min-width: 0;
  }
  .gq-tag {
    font-family: var(--font-mono);
    font-size: var(--text-2xs);
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--color-text-dim);
  }
  .gq-note {
    font-size: var(--text-xs);
    color: var(--color-text-secondary);
    border-left: 2px solid rgba(var(--color-accent-rgb), 0.3);
    padding: 2px 0 2px 10px;
    display: flex;
    gap: 6px;
    align-items: center;
  }
  .gq-msg {
    font-size: var(--text-xs);
    color: var(--color-success);
    min-height: 0;
  }
  .gq-msg .refused {
    color: var(--color-warning);
  }
  /* An empty live region stays in the accessibility tree (display: none would drop it, and a region that appears
     with its text is often not announced); it is only visually hidden. */
  .gq-msg:empty {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip: rect(0 0 0 0);
  }
  .gq-stuck {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 8px 10px;
    border-radius: var(--corner);
    border: 1px solid rgba(var(--color-warning-rgb, 200, 150, 60), 0.5);
    background: rgba(var(--color-warning-rgb, 200, 150, 60), 0.12);
    color: var(--color-warning);
    font-size: var(--text-sm);
  }
  .gq-stuck-text {
    display: flex;
    gap: 6px;
    align-items: center;
    font-weight: 600;
  }
  .gq-stuck-hint {
    font-size: var(--text-xs);
    color: var(--color-text-secondary);
  }
  .gq-larger {
    max-width: 22em;
    margin: 2px 0 4px;
    font-size: var(--text-2xs);
    color: var(--color-text-secondary);
    white-space: normal;
  }
  .gq-stuck-tasks {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }

  .gq-body {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 10px;
    border: 1px solid rgba(var(--color-accent-rgb), 0.16);
    border-radius: var(--corner);
    background: rgba(var(--color-accent-rgb), 0.03);
    min-width: 0;
  }
  .gq-body-top {
    display: flex;
    flex-wrap: wrap;
    justify-content: space-between;
    align-items: flex-start;
    gap: 8px;
  }
  .gq-body-id {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }
  .gq-body-title {
    margin: 0;
    font-family: var(--font-display);
    font-size: var(--text-sm);
    font-weight: 600;
    color: var(--color-text-primary);
    overflow-wrap: anywhere;
  }
  .gq-body-count {
    font-size: var(--text-xs);
    color: var(--color-text-dim);
  }
  .gq-body-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }

  .gq-btn {
    padding: 5px 11px;
    border-radius: var(--corner);
    border: 1px solid rgba(var(--color-accent-rgb), 0.4);
    background: rgba(var(--color-accent-rgb), 0.1);
    color: var(--color-text-primary);
    font-size: var(--text-xs);
    font-family: inherit;
    cursor: pointer;
    white-space: nowrap;
    -webkit-tap-highlight-color: transparent;
  }
  .gq-btn.primary {
    background: var(--color-accent);
    border-color: var(--color-accent);
    color: var(--color-bg-deep);
  }
  .gq-btn.subtle {
    background: transparent;
    color: var(--color-text-secondary);
  }
  .gq-btn:disabled,
  .gq-arrow:disabled,
  .gq-select:disabled {
    opacity: 0.45;
    cursor: not-allowed;
  }
  .gq-btn:focus-visible,
  .gq-arrow:focus-visible,
  .gq-select:focus-visible,
  .gq-tw:focus-visible {
    outline: 2px solid var(--color-accent);
    outline-offset: 2px;
  }

  /* GO-M2 `.tw`: the sideways scroll lives here, never on the page. */
  .gq-tw {
    overflow-x: auto;
    max-width: 100%;
    -webkit-overflow-scrolling: touch;
  }
  .gq-table {
    width: 100%;
    min-width: 760px;
    border-collapse: collapse;
    font-size: var(--text-xs);
  }
  .gq-table th,
  .gq-table td {
    text-align: left;
    padding: 8px;
    border-bottom: 1px solid rgba(var(--color-accent-rgb), 0.1);
    vertical-align: top;
    position: relative;
  }
  .gq-table thead th {
    font-family: var(--font-mono);
    font-weight: 600;
    font-size: var(--text-2xs);
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--color-text-dim);
    vertical-align: bottom;
    white-space: nowrap;
  }
  .gq-th-team-in {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    text-transform: none;
    letter-spacing: 0;
    color: var(--color-text-secondary);
  }
  .gq-th-kind {
    display: block;
    margin-top: 2px;
  }
  .gq-task {
    font-weight: normal;
    min-width: 280px;
    width: 40%;
  }
  .gq-card {
    display: flex;
    flex-direction: column;
    gap: 5px;
  }
  .gq-card-top {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    gap: 8px;
  }
  .gq-task-name {
    font-size: var(--text-sm);
    color: var(--color-text-primary);
    font-weight: 600;
  }
  .gq-status {
    flex: none;
    font-size: var(--text-2xs);
    letter-spacing: 0.05em;
    text-transform: uppercase;
    padding: 1px 7px;
    border-radius: 999px;
    border: 1px solid rgba(var(--color-accent-rgb), 0.3);
    color: var(--color-text-secondary);
  }
  .gq-status.s-active {
    color: var(--color-accent-bright);
    border-color: var(--color-accent);
  }
  .gq-status.s-done {
    color: var(--color-success);
    border-color: var(--color-success);
  }
  .gq-status.s-skipped {
    color: var(--color-text-dim);
  }
  .gq-status.s-sentBack,
  .gq-status.s-stuck {
    color: var(--color-warning);
    border-color: var(--color-warning);
  }
  .gq-detail {
    font-size: var(--text-2xs);
    color: var(--color-text-secondary);
  }
  .gq-flavor {
    font-size: var(--text-2xs);
    font-style: italic;
    color: var(--color-text-secondary);
    overflow-wrap: anywhere;
  }
  .gq-diff {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: var(--text-2xs);
    color: var(--color-text-secondary);
  }
  .gq-pips {
    display: inline-flex;
    gap: 2px;
  }
  .gq-pips i {
    width: 6px;
    height: 11px;
    border-radius: 1px;
    border: 1px solid rgba(var(--color-accent-rgb), 0.3);
    background: transparent;
  }
  .gq-pips i.on {
    background: var(--color-warning);
    border-color: var(--color-warning);
  }
  .gq-needs {
    display: flex;
    flex-wrap: wrap;
    gap: 5px;
  }
  .gq-need {
    --need-hue: var(--color-danger);
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 1px 8px;
    border-radius: 999px;
    font-size: var(--text-2xs);
    color: var(--need-hue);
    border: 1px solid color-mix(in srgb, var(--need-hue) 50%, transparent);
    white-space: nowrap;
  }
  .gq-need.science {
    --need-hue: var(--color-accent-bright);
  }
  .gq-need-mark {
    display: inline-flex;
    color: var(--color-success);
  }
  .gq-need.unmet {
    border-style: dashed;
  }
  .gq-need.unmet .gq-need-mark {
    color: var(--color-warning);
  }
  .gq-cover {
    font-size: var(--text-2xs);
    color: var(--color-text-secondary);
  }
  .gq-cover.no {
    color: var(--color-warning);
  }
  .gq-bar {
    position: relative;
    height: 10px;
    margin: 4px 0 0;
    border-radius: 5px;
    background: var(--color-bg-mid);
    border: 1px solid rgba(var(--color-accent-rgb), 0.15);
  }
  .gq-bar-fill {
    position: absolute;
    inset: 0 auto 0 0;
    border-radius: 5px;
    background: linear-gradient(90deg, var(--color-accent-bright), var(--color-accent));
  }
  .gq-pip {
    position: absolute;
    top: -4px;
    width: 4px;
    height: 16px;
    border-radius: 2px;
    background: var(--color-danger);
    transform: translateX(-50%);
  }
  .gq-pip.won {
    background: var(--color-success);
  }
  .gq-pip {
    box-shadow: 0 0 0 1px var(--color-bg-deep);
  }
  .gq-bar-label {
    font-size: var(--text-2xs);
    color: var(--color-text-dim);
  }
  .gq-joint {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px;
    font-size: var(--text-2xs);
    color: var(--color-text-secondary);
  }
  .gq-num {
    font-family: var(--font-mono);
    white-space: nowrap;
    color: var(--color-text-primary);
  }
  .gq-odds {
    max-width: 150px;
  }
  .gq-partner {
    font-size: var(--text-2xs);
    color: var(--color-text-secondary);
    white-space: nowrap;
  }
  .gq-dim {
    color: var(--color-text-dim);
  }
  .gq-assign {
    min-width: 170px;
  }
  .gq-assign-row {
    display: flex;
    gap: 5px;
    margin-bottom: 5px;
  }
  .gq-select {
    min-width: 0;
    flex: 1 1 auto;
    padding: 4px 6px;
    font-size: var(--text-xs);
    font-family: inherit;
    color: var(--color-text-primary);
    background: var(--color-bg-mid);
    border: 1px solid rgba(var(--color-accent-rgb), 0.3);
    border-radius: var(--corner);
  }
  .gq-queue {
    min-width: 130px;
  }
  .gq-queue-in {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .gq-queue-text {
    font-size: var(--text-2xs);
    color: var(--color-text-secondary);
  }
  .gq-arrows {
    display: inline-flex;
    gap: 3px;
  }
  .gq-arrow {
    display: inline-grid;
    place-items: center;
    width: 28px;
    height: 28px;
    padding: 0;
    border-radius: var(--corner);
    border: 1px solid rgba(var(--color-accent-rgb), 0.3);
    background: rgba(var(--color-accent-rgb), 0.06);
    color: var(--color-text-primary);
    cursor: pointer;
  }
  .gq-row.s-done .gq-task-name,
  .gq-row.s-skipped .gq-task-name {
    color: var(--color-text-secondary);
  }
  /* GO-13 review: on a NARROW container each row is a card; the cells stack under the task card with their column
     names, so Assigned / Apply / Skip sit under it and nothing scrolls sideways. The table stays on wide screens. */
  @container (max-width: 480px) {
    .gq-tw {
      overflow-x: visible;
    }
    .gq-table {
      min-width: 0;
    }
    .gq-table thead {
      position: absolute;
      width: 1px;
      height: 1px;
      overflow: hidden;
      clip: rect(0 0 0 0);
    }
    .gq-table,
    .gq-table tbody {
      display: block;
    }
    .gq-table tr.gq-row {
      display: flex;
      flex-wrap: wrap;
      gap: 6px 12px;
      padding: 8px;
      margin-bottom: 8px;
      border: 1px solid rgba(var(--color-accent-rgb), 0.16);
      border-radius: var(--corner);
    }
    .gq-table tr.gq-row > th,
    .gq-table tr.gq-row > td {
      display: block;
      padding: 0;
      border-bottom: 0;
      min-width: 0;
      max-width: none;
    }
    .gq-table .gq-task,
    .gq-table .gq-assign,
    .gq-table .gq-queue {
      flex: 1 1 100%;
      width: auto;
    }
    .gq-table td[data-label]::before {
      content: attr(data-label);
      display: block;
      margin-bottom: 2px;
      font-family: var(--font-mono);
      font-size: var(--text-2xs);
      letter-spacing: 0.06em;
      text-transform: uppercase;
      color: var(--color-text-dim);
    }
    .gq-assign-row {
      flex-wrap: wrap;
    }
  }

  .sr {
    position: absolute;
    width: 1px;
    height: 1px;
    margin: -1px;
    padding: 0;
    overflow: hidden;
    clip: rect(0 0 0 0);
    white-space: nowrap;
    border: 0;
  }
</style>
