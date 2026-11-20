// "Changes": what an agent's edits did to a file, as a line diff in a dialog. Added and removed
// lines are marked with + and − as well as colour, and each line is read out with its kind.
import { createDialog } from './dialogs.js';
import { diffStats } from './diff.js';
import { diffView } from './diff-view.js';
import { h, setHidden, setText } from './dom.js';
import { formatAgo } from './format.js';
import { icon } from './icons.js';

/** @typedef {import('./types.js').HudContext} HudContext */
/** @typedef {NonNullable<import('./types.js').AgentState['changes']>[number]} FileChange */

/**
 * "+3 −1", for a change's button and the dialog's subtitle.
 * @param {FileChange} change
 */
export function changeSummary(change) {
  const { added, removed } = diffStats(change.hunks);
  return change.whole ? `${added} lines written` : `+${added} −${removed}`;
}

/** @param {HudContext} ctx */
export function createDiffDialog(ctx) {
  const subtitle = h('p', { class: 'hud-dialog__lead hud-diff__subtitle' });
  const body = h('div', { class: 'hud-diff__body' });
  const previous = h('button', { type: 'button', class: 'hud-btn' }, icon('chevronUp', { size: 18 }), h('span', { text: 'Newer change' }));
  const next = h('button', { type: 'button', class: 'hud-btn' }, icon('chevronDown', { size: 18 }), h('span', { text: 'Older change' }));
  const nav = h('div', { class: 'hud-dialog__actions' }, previous, next);
  const dialog = createDialog({ id: 'hud-diff', title: 'Changes', body: [subtitle, body, nav], wide: true });
  const title = /** @type {HTMLElement} */ (dialog.el.querySelector('.hud-dialog__title'));
  // Focus can land on the title when both Newer and Older are gone.
  title.tabIndex = -1;
  /** @type {{ agentKey: string, id: string }|null} */
  let current = null;

  /** @returns {FileChange[]} newest first */
  function changesOf(/** @type {string} */ agentKey) {
    return [...(ctx.store.getState().agents[agentKey]?.changes ?? [])].reverse();
  }

  function render() {
    if (!current) return;
    const agent = ctx.store.getState().agents[current.agentKey];
    const list = changesOf(current.agentKey);
    const index = list.findIndex((change) => change.id === current?.id);
    const change = list[index];
    if (!agent || !change) {
      setText(subtitle, 'This change is no longer kept.');
      body.replaceChildren();
      return;
    }
    setText(title, `Changes to ${change.path.split('/').pop()}`);
    setText(subtitle, `${change.path}: ${changeSummary(change)}, by ${agent.name} with ${change.tool}, ${formatAgo(change.ts, Date.now())}.`);
    body.replaceChildren(...change.hunks.map((hunk, index) => diffView(hunk, { index, count: change.hunks.length })));
    setHidden(previous, index <= 0);
    setHidden(next, index >= list.length - 1);
    previous.onclick = () => step(list[index - 1]?.id, previous);
    next.onclick = () => step(list[index + 1]?.id, next);
  }

  /** @param {string} agentKey @param {string|undefined} id */
  function show(agentKey, id) {
    if (!id) return;
    current = { agentKey, id };
    render();
  }

  /**
   * Newer/Older: shows the other change, says which one it is, and keeps the focus on a button
   * (the one pressed hides at the end of the list).
   * @param {string|undefined} id
   * @param {HTMLElement} pressed
   */
  function step(id, pressed) {
    show(current?.agentKey ?? '', id);
    ctx.announcer.polite(`${title.textContent ?? ''}. ${subtitle.textContent ?? ''}`);
    if (!pressed.hidden) return;
    const other = pressed === previous ? next : previous;
    (other.hidden ? title : other).focus();
  }

  return {
    el: dialog.el,
    open: dialog.open,
    close: dialog.close,
    // A getter, not a copy: spreading the dialog would freeze isOpen at false.
    get isOpen() {
      return dialog.isOpen;
    },
    /**
     * @param {string} agentKey
     * @param {string} changeId
     */
    show(agentKey, changeId) {
      show(agentKey, changeId);
      dialog.open();
    },
  };
}
