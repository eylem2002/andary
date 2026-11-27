// The command palette (Ctrl-K, or ⌘-K on a Mac): one box to find a crew or an agent and go to
// it, or to do something (open Approvals, Catch me up, Settings, turn Quiet town on…) without
// hunting for its button. Fuzzy search (core/fuzzy.js) over what is in town now; the arrow keys
// move through the results and Enter runs one. It never answers a permission request: that takes
// the card's own Allow or Deny, so a stray Enter here can never approve anything.
//
// Accessibility: a modal <dialog> holding the ARIA combobox pattern: a text box (role combobox)
// that keeps the keyboard, with aria-activedescendant naming the highlighted option of the
// listbox under it, and a polite status saying how many results there are.
import { createDialog } from './dialogs.js';
import { h, setAttr, setHidden, setText, srOnly } from './dom.js';
import { doingText, plural, statusLabel, truncate } from './format.js';
import { kbd } from './parts.js';
import { rankMatches } from '../core/fuzzy.js';
import { arrangeCrews } from '../core/crew-board.js';
import { directorActive } from './cinema.js';

/** @typedef {import('./types.js').HudContext} HudContext */
/** @typedef {import('./types.js').StoreState} StoreState */

/**
 * @typedef {object} PaletteItem
 * @property {string} id
 * @property {'crew'|'agent'|'action'} kind
 * @property {string} label
 * @property {string} [detail]
 * @property {string} [keywords]  more words it is found by, never shown
 * @property {string} [key]       its keyboard shortcut, shown beside it
 * @property {() => void} run
 */

/** At most this many results are listed. */
const MAX_RESULTS = 40;
const KIND_WORDS = Object.freeze({ crew: 'Crew', agent: 'Agent', action: 'Action' });

/**
 * @typedef {object} PaletteHooks
 * @property {() => void} focusLogSearch  shows the Activity tab with the keyboard in its search box
 */

/**
 * Everything the palette offers now: the crews at work (most urgent first), their agents, then
 * the actions. With an empty query, the crews and the actions.
 * @param {HudContext} ctx
 * @param {PaletteHooks} hooks
 * @returns {PaletteItem[]}
 */
export function paletteItems(ctx, hooks) {
  const state = ctx.store.getState();
  const { live } = arrangeCrews(state.sessions, new Map());
  /** @type {PaletteItem[]} */
  const items = [];
  for (const session of live) {
    const lead = session.agentKeys.find((key) => state.agents[key]?.role === 'lead') ?? session.agentKeys[0];
    items.push({
      id: `crew:${session.id}`,
      kind: 'crew',
      label: session.title || session.project,
      detail: [`Crew ${session.number}`, session.goal ? truncate(session.goal, 80) : statusLabel(session.status)].join(' – '),
      keywords: `${session.project} ${session.cwd} ${session.member ?? ''} ${session.source === 'codex' ? 'codex' : ''}`,
      key: session.number <= 9 ? String(session.number) : undefined,
      run: () => goToAgent(ctx, session.id, lead),
    });
  }
  for (const session of live) {
    for (const key of session.agentKeys) {
      const agent = state.agents[key];
      if (!agent) continue;
      items.push({
        id: `agent:${key}`,
        kind: 'agent',
        label: agent.name,
        detail: [`Crew ${session.number}, ${session.project}`, statusLabel(agent.status), truncate(doingText(agent, undefined), 60)].filter(Boolean).join(' – '),
        keywords: `${agent.roleName ?? ''} ${agent.type} ${agent.description ?? ''}`,
        run: () => goToAgent(ctx, session.id, key),
      });
    }
  }
  return [...items, ...actionItems(ctx, hooks, state)];
}

/**
 * The actions, named for what they will do now ("Turn quiet town on").
 * @param {HudContext} ctx
 * @param {PaletteHooks} hooks
 * @param {StoreState} state
 * @returns {PaletteItem[]}
 */
function actionItems(ctx, hooks, state) {
  const pending = state.approvals.filter((a) => a.status === 'pending').length;
  const onOff = (/** @type {boolean} */ on) => (on ? 'off' : 'on');
  /** @type {Array<Omit<PaletteItem, 'kind'> & { when?: boolean }>} */
  const actions = [
    { id: 'needs-you', label: 'Go to what needs you', detail: 'Most urgent first', keywords: 'waiting attention next', key: 'I', run: () => ctx.run('needs-you') },
    { id: 'approvals', label: 'Open approvals', detail: pending ? `${plural(pending, 'request')} waiting` : 'Nothing waiting', keywords: 'permission allow deny requests', key: 'A', run: () => ctx.showTab('approvals', { focus: true }) },
    { id: 'catch-up', label: 'Catch me up', detail: 'What your crews did while you were away', keywords: 'digest summary away', key: 'W', run: () => ctx.run('catch-up') },
    { id: 'log-search', label: 'Search the activity log', keywords: 'find filter history', run: () => hooks.focusLogSearch() },
    { id: 'tasks', label: 'Show goals and todo lists', keywords: 'tasks todos plan', run: () => ctx.showTab('tasks', { focus: true }) },
    { id: 'usage', label: 'Usage: tokens and cost', keywords: 'money spend limits plan', key: 'U', run: () => ctx.run('usage') },
    { id: 'leaderboard', label: 'Leaderboard', keywords: 'records growth achievements', key: 'L', run: () => ctx.run('leaderboard') },
    { id: 'settings', label: 'Settings', keywords: 'preferences options notifications', run: () => ctx.openDialog('settings') },
    { id: 'help', label: 'Shortcuts and help', keywords: 'keys keyboard', key: '?', run: () => ctx.run('help') },
    { id: 'quiet', label: `Turn quiet town ${onOff(ctx.prefs.quietTown)}`, detail: 'No joke bubbles, no achievement toasts', keywords: 'jokes noise toasts calm', run: () => toggleQuiet(ctx) },
    { id: 'sound', label: `Turn sound ${onOff(ctx.sound.enabled)}`, keywords: 'audio mute', key: 'M', run: () => ctx.run('toggle-sound') },
    { id: 'director', label: `Turn the director camera ${onOff(directorActive(ctx))}`, keywords: 'cinema follow action', key: 'C', run: () => ctx.run('director') },
    { id: 'panels', label: 'Full-screen town on or off', keywords: 'hide panels boards', key: 'H', run: () => ctx.run('toggle-panels') },
    { id: 'follow', label: 'Follow the selected agent', keywords: 'camera track', key: 'F', run: () => ctx.run('follow') },
    { id: 'time', label: 'Next time of day', keywords: 'night day sunset clock', key: 'N', run: () => ctx.run('cycle-time') },
    { id: 'place-names', label: 'Next place names setting', keywords: 'labels buildings', key: 'P', run: () => ctx.run('place-names') },
    { id: 'weather', label: `Turn town weather ${onOff(ctx.prefs.weather)}`, keywords: 'rain storm rainbow', run: () => ctx.setPrefs({ weather: !ctx.prefs.weather }) },
    { id: 'reset-view', label: 'Reset the view', keywords: 'camera zoom', key: '0', run: () => ctx.run('reset-view') },
    { id: 'pause', label: ctx.view.paused ? 'Resume the demo' : 'Pause the demo', keywords: 'stop play', key: 'Space', when: ctx.view.mode === 'demo', run: () => ctx.run('pause') },
  ];
  return actions.filter((a) => a.when !== false).map(({ when: _when, ...a }) => ({ ...a, id: `action:${a.id}`, kind: 'action' }));
}

/** @param {HudContext} ctx */
function toggleQuiet(ctx) {
  ctx.setPrefs({ quietTown: !ctx.prefs.quietTown });
  ctx.announcer.polite(ctx.prefs.quietTown ? 'Quiet town on: no joke bubbles and no achievement toasts.' : 'Quiet town off.');
}

/**
 * Selects an agent of a crew and points the camera at it, as its number key or its row does.
 * @param {HudContext} ctx @param {string} sessionId @param {string|undefined} agentKey
 */
function goToAgent(ctx, sessionId, agentKey) {
  if (!agentKey) return;
  ctx.revealCrew?.(sessionId);
  ctx.select({ type: 'agent', id: agentKey }, { camera: true, focus: true });
}

/** The text an item is found by. @param {PaletteItem} item */
export function searchText(item) {
  return `${item.label} · ${item.detail ?? ''} · ${KIND_WORDS[item.kind]} ${item.keywords ?? ''}`;
}

/**
 * @param {HudContext} ctx
 * @param {PaletteHooks} hooks
 */
export function createPalette(ctx, hooks) {
  const input = /** @type {HTMLInputElement} */ (h('input', {
    type: 'text',
    class: 'hud-input hud-palette__input',
    role: 'combobox',
    'aria-expanded': 'true',
    'aria-controls': 'hud-palette-list',
    'aria-autocomplete': 'list',
    'aria-label': 'Find a crew, an agent or an action',
    placeholder: 'Find a crew, an agent or an action…',
    autocomplete: 'off',
    spellcheck: 'false',
    'data-testid': 'palette-input',
  }));
  const list = h('ul', { class: 'hud-palette__list', id: 'hud-palette-list', role: 'listbox', 'aria-label': 'Results', 'data-testid': 'palette-results' });
  const none = h('p', { class: 'hud-empty hud-palette__none', hidden: true });
  const status = h('p', { class: 'hud-sr', role: 'status' });
  const hint = h('p', { class: 'hud-palette__hint', 'aria-hidden': 'true' }, kbd('↑'), ' ', kbd('↓'), ' move  ', kbd('Enter'), ' go  ', kbd('Esc'), ' close');
  const dialog = createDialog({ id: 'hud-palette', title: 'Go to or do', body: [input, list, none, status, hint] });
  dialog.el.classList.add('hud-palette');
  dialog.el.setAttribute('data-testid', 'palette');

  /** @type {PaletteItem[]} */
  let results = [];
  let active = 0;
  /** @type {PaletteItem|null} chosen, run once the dialog has closed and given focus back */
  let chosen = null;

  function refresh() {
    results = rankMatches(input.value, paletteItems(ctx, hooks), searchText, MAX_RESULTS);
    if (!input.value.trim()) results = results.filter((item) => item.kind !== 'agent');
    active = Math.min(active, Math.max(0, results.length - 1));
    list.replaceChildren(...results.map((item, i) => option(item, i)));
    setHidden(none, results.length > 0);
    setText(none, `Nothing matches “${input.value.trim()}”.`);
    setText(status, results.length ? `${plural(results.length, 'result')}.` : 'No results.');
    highlight();
  }

  /** @param {PaletteItem} item @param {number} i */
  function option(item, i) {
    const el = h('li', { class: `hud-palette__option hud-palette__option--${item.kind}`, role: 'option', id: `hud-palette-opt-${i}`, 'aria-selected': 'false', 'data-testid': 'palette-option', 'data-id': item.id },
      h('span', { class: 'hud-palette__kind', text: KIND_WORDS[item.kind] }),
      h('span', { class: 'hud-palette__text' },
        h('span', { class: 'hud-palette__label', text: item.label }),
        item.detail ? h('span', { class: 'hud-palette__detail' }, srOnly(', '), item.detail) : null),
      item.key ? h('span', { class: 'hud-palette__key' }, srOnly(', shortcut '), kbd(item.key)) : null);
    el.addEventListener('pointermove', () => {
      if (active === i) return;
      active = i;
      highlight();
    });
    el.addEventListener('click', () => choose(i));
    return el;
  }

  function highlight() {
    for (const [i, el] of [...list.children].entries()) setAttr(el, 'aria-selected', String(i === active));
    const current = list.children[active];
    setAttr(input, 'aria-activedescendant', current ? current.id : null);
    current?.scrollIntoView({ block: 'nearest' });
  }

  /** @param {number} i */
  function choose(i) {
    const item = results[i];
    if (!item) return;
    chosen = item;
    dialog.close();
  }

  input.addEventListener('input', () => {
    active = 0;
    refresh();
  });
  input.addEventListener('keydown', (event) => {
    const n = results.length;
    /** @type {Record<string, () => void>} */
    const keys = {
      ArrowDown: () => { active = n ? (active + 1) % n : 0; },
      ArrowUp: () => { active = n ? (active - 1 + n) % n : 0; },
      PageDown: () => { active = Math.min(Math.max(0, n - 1), active + 5); },
      PageUp: () => { active = Math.max(0, active - 5); },
      Enter: () => choose(active),
    };
    const run = keys[event.key];
    if (!run || event.isComposing) return;
    event.preventDefault();
    run();
    if (event.key !== 'Enter') highlight();
  });
  // After the dialog's own close handler has given focus back to what opened it: the chosen item
  // may move it on (into an agent's details, Approvals, another dialog).
  dialog.el.addEventListener('close', () => {
    const item = chosen;
    chosen = null;
    if (item && !dialog.el.open) item.run();
  });

  return {
    el: dialog.el,
    close: dialog.close,
    get isOpen() {
      return dialog.isOpen;
    },
    open() {
      input.value = '';
      active = 0;
      chosen = null;
      refresh();
      dialog.open();
      input.focus();
    },
  };
}
