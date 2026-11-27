// The Activity log: one row per log entry, newest at the bottom. Rendering is incremental (only
// new entries are appended) and capped at 200 rows; filtering by crew or to errors rebuilds it.
// The list is one tab stop: arrow keys move between rows, Enter points the camera at the agent.
// Auto-scroll pauses while the pointer or keyboard focus is in the log so a row never moves away
// from someone reading it.
import { BUILDINGS } from '../core/catalog.js';
import { h, setCrewColor, setHidden, setText, srOnly } from './dom.js';
import { BUILDING_ICONS, icon } from './icons.js';
import { formatAgo, isCommandText } from './format.js';

/** @typedef {import('./types.js').HudContext} HudContext */
/** @typedef {import('./types.js').StoreState} StoreState */
/** @typedef {import('./types.js').LogEntry} LogEntry */

const MAX_ROWS = 200;

/** @type {Record<string, string>} */
const KIND_ICONS = {
  'session.start': 'bus',
  'session.end': 'bus',
  prompt: 'message',
  'tool.fail': 'warning',
  'turn.fail': 'warning',
  'permission.request': 'shield',
  'permission.denied': 'shield',
  notify: 'bell',
  'subagent.start': 'users',
  'subagent.stop': 'check',
  'spawn.request': 'users',
  'spawn.result': 'users',
  'turn.stop': 'flag',
  'task.created': 'list',
  'task.completed': 'list',
  'task.upsert': 'list',
  'todos.set': 'list',
  'teammate.idle': 'cup',
  'compact.start': 'steam',
  'compact.end': 'steam',
  'model.switch': 'swap',
  'message.send': 'mail',
  approval: 'shield',
  achievement: 'medal',
  stuck: 'repeat',
  // Two agents on the same files (core/conflicts.js).
  conflict: 'users',
  // A lead's turn ended: what it did (core/receipts.js).
  receipt: 'list',
  // A push while the crew's last test run had failed (core/pushes.js).
  pushed: 'warning',
};

/** The store marks log lines with emoji (a building's sign emoji for tool calls). */
const BUILDING_BY_EMOJI = Object.fromEntries(Object.values(BUILDINGS).map((building) => [building.icon, building.key]));

/** @type {Record<string, string>} */
const EMOJI_ICONS = {
  '🚌': 'bus',
  '👋': 'bus',
  '💬': 'message',
  '⏹️': 'stop',
  '🚫': 'shield',
  '🔔': 'bell',
  '🤝': 'users',
  '✨': 'users',
  '🏁': 'flag',
  '✅': 'check',
  '✔️': 'check',
  '👍': 'check',
  '🙅': 'cross',
  '📌': 'list',
  '🧠': 'steam',
  '🎩': 'swap',
  '✉️': 'mail',
  '🚚': 'mail',
  '📦': 'box',
  '⌛': 'hourglass',
  '🏆': 'medal',
};

/**
 * The icon for a log row: errors always get the warning triangle; otherwise the line's emoji
 * (a building's, or an event's) translated to the HUD's line icons, then its kind.
 * @param {Pick<LogEntry, 'kind'|'icon'|'level'>} entry
 */
export function iconForEntry(entry) {
  if (entry.level === 'error') return 'warning';
  const building = BUILDING_BY_EMOJI[entry.icon] ?? (BUILDING_ICONS[entry.icon] ? entry.icon : null);
  if (building) return BUILDING_ICONS[building];
  return EMOJI_ICONS[entry.icon] ?? KIND_ICONS[entry.kind] ?? 'spark';
}

/**
 * @typedef {object} LogFilter
 * @property {string} sessionId   '' for every crew
 * @property {boolean} errorsOnly
 */

/**
 * @param {LogEntry} entry
 * @param {LogFilter} filter
 */
export function matchesFilter(entry, filter) {
  if (filter.sessionId && entry.sessionId !== filter.sessionId) return false;
  if (filter.errorsOnly && entry.level !== 'error') return false;
  return true;
}

/**
 * The entries appended to `log` since `last` (an entry object previously seen), or null when `last`
 * is gone (the log was reset or rotated past it) and the caller must rebuild.
 * @param {LogEntry[]} log
 * @param {LogEntry|null} last
 * @returns {LogEntry[]|null}
 */
export function entriesSince(log, last) {
  if (!last) return log.slice();
  for (let i = log.length - 1; i >= 0; i--) {
    if (log[i] === last || log[i].id === last.id) return log.slice(i + 1);
  }
  return null;
}

/** @param {HudContext} ctx */
export function createActivityPanel(ctx) {
  const filter = { sessionId: '', errorsOnly: ctx.prefs.errorsOnly };
  const crewSelect = h('select', { class: 'hud-select', id: 'hud-log-crew' }, h('option', { value: '', text: 'All crews' }));
  const errorsBox = h('input', { type: 'checkbox', class: 'hud-check', id: 'hud-log-errors', checked: filter.errorsOnly });
  const paused = h('span', { class: 'hud-log__paused', hidden: true }, icon('pause', { size: 14 }), 'Paused while you read');
  const empty = h('p', { class: 'hud-empty' });
  const list = h('ol', { class: 'hud-log', tabindex: '0', 'aria-label': 'Activity log, newest at the bottom' });
  const el = h('div', { class: 'hud-activity', 'data-testid': 'activity-log' },
    h('h2', { class: 'hud-sr', text: 'Activity' }),
    h('div', { class: 'hud-filters' },
      // Labels hold only their text: a control inside a label would add its value to the name.
      h('div', { class: 'hud-field' }, h('label', { class: 'hud-field__label', for: 'hud-log-crew', text: 'Crew' }), crewSelect),
      h('label', { class: 'hud-toggle', for: 'hud-log-errors' }, errorsBox, h('span', { text: 'Errors only' })),
      paused),
    empty,
    list);

  /** @type {LogEntry|null} */
  let lastSeen = null;
  let reading = false;
  let scrollPending = false;
  let hovered = false;
  let focused = false;

  crewSelect.addEventListener('change', () => {
    filter.sessionId = /** @type {HTMLSelectElement} */ (crewSelect).value;
    rebuild(ctx.store.getState());
    settle();
  });
  errorsBox.addEventListener('change', () => {
    filter.errorsOnly = /** @type {HTMLInputElement} */ (errorsBox).checked;
    ctx.setPrefs({ errorsOnly: filter.errorsOnly });
    rebuild(ctx.store.getState());
    settle();
  });
  list.addEventListener('pointerenter', () => setReading({ hover: true }));
  list.addEventListener('pointerleave', () => setReading({ hover: false }));
  list.addEventListener('focusin', () => setReading({ focus: true }));
  list.addEventListener('focusout', (event) => {
    if (!list.contains(/** @type {Node|null} */ (event.relatedTarget))) setReading({ focus: false });
  });
  list.addEventListener('keydown', (event) => moveFocus(list, event));

  /** @param {{ hover?: boolean, focus?: boolean }} change */
  function setReading(change) {
    hovered = change.hover ?? hovered;
    focused = change.focus ?? focused;
    reading = hovered || focused;
    setHidden(paused, !reading);
    if (!reading) scrollToEnd();
  }

  function scrollToEnd() {
    list.scrollTop = list.scrollHeight;
  }

  /** @param {LogEntry[]} entries */
  function appendRows(entries) {
    const fresh = entries.filter((entry) => matchesFilter(entry, filter)).slice(-MAX_ROWS);
    if (!fresh.length) return;
    const fragment = document.createDocumentFragment();
    for (const entry of fresh) fragment.append(createRow(ctx, entry));
    list.append(fragment);
    let excess = list.children.length - MAX_ROWS;
    while (excess-- > 0) list.firstElementChild?.remove();
    // Scrolling reads layout: it waits for settle(), after every panel has written this frame.
    scrollPending = !reading;
  }

  /** @param {StoreState} state */
  function rebuild(state) {
    list.replaceChildren();
    lastSeen = state.log[state.log.length - 1] ?? null;
    appendRows(state.log.filter((entry) => matchesFilter(entry, filter)).slice(-MAX_ROWS));
    updateEmpty(state);
  }

  /** @param {StoreState} state */
  function updateEmpty(state) {
    const nothing = list.children.length === 0;
    setHidden(empty, !nothing);
    setText(empty, state.log.length && nothing ? 'No entries match these filters.' : 'Every tool call, prompt and result appears here as it happens.');
  }

  /** @param {StoreState} state */
  function updateCrewOptions(state) {
    const options = [{ id: '', label: 'All crews' }, ...state.sessions.map((session) => ({ id: session.id, label: `${session.number}. ${session.project}` }))];
    const select = /** @type {HTMLSelectElement} */ (crewSelect);
    if (select.options.length === options.length && options.every((option, i) => select.options[i].value === option.id && select.options[i].text === option.label)) return;
    select.replaceChildren(...options.map((option) => h('option', { value: option.id, text: option.label })));
    if (!options.some((option) => option.id === filter.sessionId)) filter.sessionId = '';
    select.value = filter.sessionId;
  }

  /**
   * Appends what is new since the last render and returns those entries (for announcements).
   * @param {StoreState} state
   * @returns {LogEntry[]}
   */
  function render(state) {
    updateCrewOptions(state);
    const fresh = entriesSince(state.log, lastSeen);
    if (fresh === null) {
      rebuild(state);
      return [];
    }
    if (fresh.length) {
      lastSeen = fresh[fresh.length - 1];
      appendRows(fresh);
    }
    updateEmpty(state);
    return fresh;
  }

  /** Keeps the newest row in view, unless someone is reading. Call after all DOM writes. */
  function settle() {
    if (scrollPending && !reading) scrollToEnd();
    scrollPending = false;
  }

  /** Clears the log after a store reset. */
  function reset() {
    lastSeen = null;
    list.replaceChildren();
  }

  /** @param {number} now */
  function tick(now) {
    for (const item of list.children) {
      const time = /** @type {HTMLElement} */ (item).querySelector('time');
      if (time) setText(time, formatAgo(Number(/** @type {HTMLElement} */ (item).dataset.ts), now, { short: true }));
    }
  }

  return { el, render, settle, reset, tick };
}

/**
 * One log row: when, who (in the crew's colour), what kind of thing (icon) and what happened.
 * @param {HudContext} ctx
 * @param {LogEntry} entry
 */
function createRow(ctx, entry) {
  const error = entry.level === 'error';
  const who = h('span', { class: 'hud-log__who', text: entry.agentName });
  setCrewColor(who, entry.color);
  const row = h('button', { type: 'button', class: 'hud-log__row', tabindex: '-1' },
    h('time', { class: 'hud-log__time', datetime: new Date(entry.ts).toISOString(), title: new Date(entry.ts).toLocaleTimeString() }, formatAgo(entry.ts, Date.now(), { short: true })),
    who,
    icon(iconForEntry(entry), { size: 16, className: 'hud-log__icon' }),
    h('span', { class: isCommandText(entry.text) ? 'hud-log__text hud-mono' : 'hud-log__text' }, error ? srOnly('Error: ') : null, entry.text));
  // Focus stays in the log so a keyboard user can keep reading after looking at the agent.
  row.addEventListener('click', () => ctx.select({ type: 'agent', id: entry.agentKey }, { camera: true }));
  const item = h('li', { class: 'hud-log__item', 'data-testid': 'log-entry', 'data-level': entry.level }, row);
  item.dataset.ts = String(entry.ts);
  return item;
}

/**
 * Roving focus inside the log: arrows move between rows, Home/End jump, Escape returns to the list.
 * @param {HTMLElement} list
 * @param {KeyboardEvent} event
 */
function moveFocus(list, event) {
  const rows = /** @type {HTMLElement[]} */ (Array.from(list.querySelectorAll('.hud-log__row')));
  if (!rows.length) return;
  const index = rows.indexOf(/** @type {HTMLElement} */ (document.activeElement));
  const last = rows.length - 1;
  /** @type {Record<string, number>} */
  const targets = {
    ArrowDown: index < 0 ? last : Math.min(last, index + 1),
    ArrowUp: index < 0 ? last : Math.max(0, index - 1),
    Home: 0,
    End: last,
    PageDown: index < 0 ? last : Math.min(last, index + 10),
    PageUp: index < 0 ? last : Math.max(0, index - 10),
  };
  if (event.key === 'Escape' && index >= 0) {
    event.preventDefault();
    event.stopPropagation();
    list.focus();
    return;
  }
  if (!(event.key in targets)) return;
  event.preventDefault();
  rows[targets[event.key]].focus();
}
