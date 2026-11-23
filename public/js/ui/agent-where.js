// The "Where" section of the agent's details: the folder its crew works in, its branch and
// working tree (core/git-status.js), the model it runs on, and its session id with a button that
// copies it (for `claude --resume <id>` or `codex resume <id>`). A teammate's session id is shown
// without the town's prefix for their name: it is the id their own agent knows.
import { h, renderList, setAttr, setHidden, setText } from './dom.js';
import { icon } from './icons.js';
import { modelLabel } from '../core/catalog.js';
import { gitOf, gitSentence } from '../core/git-status.js';

/** @typedef {import('./types.js').HudContext} HudContext */
/** @typedef {import('./types.js').StoreState} StoreState */
/** @typedef {import('./types.js').AgentState} AgentState */
/** @typedef {import('./types.js').Session} Session */

/** How long the button says "Copied". */
const COPIED_MS = 2500;

/**
 * The id the agent itself knows its session by: a teammate's has the town's `name~` prefix.
 * @param {Session} session
 */
export function ownSessionId(session) {
  return session.member && session.id.startsWith(`${session.member}~`) ? session.id.slice(session.member.length + 1) : session.id;
}

/**
 * "Opus 5.5 (claude-opus-5-5)", or the id alone when the town has no shorter name for it.
 * @param {string|undefined|null} id
 */
export function modelWords(id) {
  if (!id) return '';
  const label = modelLabel(id);
  return label && label !== id ? `${label} (${id})` : id;
}

/**
 * The section's rows: Folder, Branch, Model; the session id has a row of its own with its button.
 * @param {StoreState} state @param {AgentState} agent @param {Session|null|undefined} session
 * @returns {{ label: string, text: string, mono: boolean }[]}
 */
export function whereRows(state, agent, session) {
  /** @type {{ label: string, text: string, mono: boolean }[]} */
  const rows = [];
  if (session?.cwd) rows.push({ label: 'Folder', text: session.cwd, mono: true });
  const repo = session && !session.member ? gitOf(state.git, session) : null;
  if (repo) rows.push({ label: 'Branch', text: gitSentence(repo), mono: false });
  const model = modelWords(agent.model ?? session?.model);
  if (model) rows.push({ label: 'Model', text: model, mono: false });
  return rows;
}

/** @param {HudContext} ctx */
export function createWhereSection(ctx) {
  const list = h('dl', { class: 'hud-receipt', 'data-testid': 'agent-where' });
  const idText = h('code', { class: 'hud-where__id hud-mono', 'data-testid': 'agent-session-id' });
  const copyLabel = h('span', { text: 'Copy' });
  const copy = h('button', { type: 'button', class: 'hud-btn hud-btn--small', 'data-testid': 'copy-session-id' }, icon('copy', { size: 16 }), copyLabel);
  const idRow = h('div', { class: 'hud-receipt__row hud-where__session' }, h('dt', { text: 'Session' }), h('dd', {}, idText, copy));
  const el = h('div', { class: 'hud-where' }, list, h('dl', { class: 'hud-receipt' }, idRow));
  /** @type {ReturnType<typeof setTimeout>|undefined} */
  let reset;

  copy.addEventListener('click', async () => {
    const id = idText.textContent ?? '';
    if (!id) return;
    clearTimeout(reset);
    try {
      await navigator.clipboard.writeText(id);
      setText(copyLabel, 'Copied');
      ctx.announcer.polite('Copied the session id');
    } catch {
      // No clipboard here (an insecure origin, permissions): select it to copy by hand.
      const range = document.createRange();
      range.selectNodeContents(idText);
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
      setText(copyLabel, 'Press Ctrl+C');
      ctx.announcer.polite('Selected the session id. Press Control C or Command C to copy it.');
    }
    reset = setTimeout(() => setText(copyLabel, 'Copy'), COPIED_MS);
  });

  return {
    el,
    /**
     * @param {StoreState} state @param {AgentState} agent @param {Session|null|undefined} session
     * @returns {boolean} whether there is anything to show
     */
    update(state, agent, session) {
      const rows = whereRows(state, agent, session);
      renderList(list, rows, (row) => row.label, (row) => h('div', { class: 'hud-receipt__row' }, h('dt', { text: row.label }), h('dd', {})), (rowEl, row) => {
        const value = /** @type {HTMLElement} */ (rowEl.lastElementChild);
        setText(value, row.text);
        value.classList.toggle('hud-mono', row.mono);
      });
      setHidden(list, !rows.length);
      const id = session ? ownSessionId(session) : '';
      setText(idText, id);
      setAttr(copy, 'aria-label', id ? `Copy the session id ${id}` : null);
      setHidden(idRow, !id || id === 'unknown');
      return rows.length > 0 || Boolean(id);
    },
  };
}
