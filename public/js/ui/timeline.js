// The timeline strip under the town (core/timeline.js has the model): one lane per agent of the
// crew picked (or of every crew, grouped), with each call coloured by its building, failed calls
// as red ticks, waits for you hatched, your prompts as pins and the turn's end as a cap, up to a
// "now" edge that moves with the clock. Zoom: the last 15 minutes, the last hour, or today.
//
// Keyboard: the strip is one tab stop (roving focus): Left and Right move along a lane, Up and Down
// to the lane above or below (the item nearest in time), Home and End to a lane's ends, Enter goes
// to that moment (selects the agent, points the camera, opens the details: the diff when the town
// has it). Hover or focus shows what it was. The List view shows the same items as a plain list,
// for screen readers and anyone who prefers one.
import { timelineView } from '../core/timeline.js';
import { h, renderList, setAttr, setCrewColor, setHidden, setText } from './dom.js';
import { icon } from './icons.js';
import { formatClock, formatDuration } from './format.js';
import { findSession } from './parts.js';

/** @typedef {import('./types.js').HudContext} HudContext */
/** @typedef {import('./types.js').StoreState} StoreState */
/** @typedef {import('../core/timeline.js').TimelineItem} TimelineItem */
/** @typedef {import('../core/timeline.js').TimelineLane} TimelineLane */
/** @typedef {'15m'|'1h'|'today'} Zoom */

/** @type {ReadonlyArray<{ id: Zoom, label: string, name: string }>} */
const ZOOMS = Object.freeze([
  { id: '15m', label: '15 min', name: 'The last 15 minutes' },
  { id: '1h', label: '1 h', name: 'The last hour' },
  { id: 'today', label: 'Today', name: 'Today' },
]);
/** Calls narrower than this many pixels merge with their neighbours. */
const MIN_PX = 4;
/** Rows of the list view, newest first. */
const MAX_LIST = 300;

/**
 * The window a zoom shows, ending now. Today starts at midnight on this computer's clock.
 * @param {Zoom} zoom @param {number} now
 */
export function zoomWindow(zoom, now) {
  if (zoom === '15m') return { from: now - 15 * 60_000, to: now };
  if (zoom === '1h') return { from: now - 60 * 60_000, to: now };
  const midnight = new Date(now);
  midnight.setHours(0, 0, 0, 0);
  // A day that has barely begun still shows its first hour.
  return { from: Math.min(midnight.getTime(), now - 60 * 60_000), to: now };
}

/**
 * Where a key moves the focus from an item: along its lane, to the lane above or below (the item
 * nearest in time), or to a lane's ends. Null when the key does not move it.
 * @param {TimelineLane[]} lanes  as shown, top to bottom
 * @param {string} laneKey @param {string} itemId @param {string} key
 * @returns {TimelineItem|null}
 */
export function moveFrom(lanes, laneKey, itemId, key) {
  const row = lanes.findIndex((lane) => lane.key === laneKey);
  const items = lanes[row]?.items ?? [];
  const at = items.findIndex((item) => item.id === itemId);
  if (row < 0 || at < 0) return null;
  if (key === 'ArrowLeft') return items[at - 1] ?? null;
  if (key === 'ArrowRight') return items[at + 1] ?? null;
  if (key === 'Home') return items[0];
  if (key === 'End') return items[items.length - 1];
  if (key !== 'ArrowUp' && key !== 'ArrowDown') return null;
  const target = lanes[row + (key === 'ArrowUp' ? -1 : 1)];
  if (!target) return null;
  const time = items[at].start;
  return target.items.reduce((best, item) => (Math.abs(item.start - time) < Math.abs(best.start - time) ? item : best));
}

/**
 * The words for an item, with its time: "Read src/a.ts, 10:42 for 2s".
 * @param {TimelineItem} item @param {string} who
 */
export function itemWords(item, who) {
  const when = item.type === 'tool' || item.type === 'wait' ? `${formatClock(item.start)}, ${item.open ? 'for' : 'took'} ${formatDuration(item.end - item.start)}${item.open ? ' so far' : ''}` : formatClock(item.start);
  return `${who}: ${item.label}, ${when}`;
}

/** The strip's parts: its header controls and its body. */
function createParts() {
  const zoomButtons = /** @type {Record<Zoom, HTMLButtonElement>} */ (Object.fromEntries(ZOOMS.map((zoom) => [zoom.id, h('button', { type: 'button', class: 'hud-btn hud-btn--small', 'aria-label': zoom.name, 'data-zoom': zoom.id, text: zoom.label })])));
  const parts = {
    crews: /** @type {HTMLSelectElement} */ (h('select', { class: 'hud-select hud-timeline__crews', 'aria-label': 'Crews shown', 'data-testid': 'timeline-crews' })),
    zoomButtons,
    listToggle: h('button', { type: 'button', class: 'hud-btn hud-btn--small', 'aria-pressed': 'false', 'data-testid': 'timeline-list-toggle' }, 'List'),
    close: h('button', { type: 'button', class: 'hud-iconbtn', 'aria-label': 'Close the timeline' }, icon('close')),
    axis: h('div', { class: 'hud-timeline__axis', 'aria-hidden': 'true' }, h('span', { class: 'hud-timeline__from' }), h('span', { class: 'hud-timeline__now', text: 'now' })),
    lanes: h('div', { class: 'hud-timeline__lanes', 'data-testid': 'timeline-lanes' }),
    list: h('ol', { class: 'hud-timeline__list', 'data-testid': 'timeline-list', 'aria-label': 'Timeline, newest first', hidden: true }),
    empty: h('p', { class: 'hud-timeline__empty', text: 'Nothing happened in this window yet.' }),
    tip: h('div', { class: 'hud-timeline__tip', 'aria-hidden': 'true', hidden: true }),
  };
  const el = h('section', { class: 'hud hud-timeline', 'data-testid': 'timeline', 'aria-labelledby': 'hud-timeline-title', hidden: true },
    h('div', { class: 'hud-timeline__head' },
      h('h2', { class: 'hud-timeline__title', id: 'hud-timeline-title', text: 'Timeline' }),
      parts.crews,
      h('div', { class: 'hud-timeline__zooms', role: 'group', 'aria-label': 'Zoom' }, ...Object.values(zoomButtons)),
      parts.listToggle,
      parts.close),
    h('div', { class: 'hud-timeline__body' }, parts.axis, parts.lanes, parts.list, parts.empty),
    parts.tip);
  return { el, ...parts };
}

/** @param {HudContext} ctx */
export function createTimeline(ctx) {
  const parts = createParts();
  const { el, lanes, list, tip } = parts;
  const view = {
    /** @type {Zoom} */
    zoom: '15m',
    listView: false,
    /** the crew shown, or '' for all */
    crew: '',
    /** @type {string|null} the item that holds the strip's one tab stop */
    focused: null,
    /** @type {TimelineLane[]} */
    shown: [],
    /** @type {Map<string, string>} lane key → who, in words */
    names: new Map(),
  };
  const redraw = () => render(ctx.store.getState());

  parts.crews.addEventListener('change', () => {
    view.crew = parts.crews.value;
    redraw();
  });
  for (const [id, button] of Object.entries(parts.zoomButtons)) {
    button.addEventListener('click', () => {
      view.zoom = /** @type {Zoom} */ (id);
      redraw();
      ctx.announcer.polite(`Timeline: ${ZOOMS.find((z) => z.id === id)?.name.toLowerCase()}.`);
    });
  }
  parts.listToggle.addEventListener('click', () => {
    view.listView = !view.listView;
    redraw();
    ctx.announcer.polite(view.listView ? 'Timeline as a list.' : 'Timeline as lanes.');
  });
  parts.close.addEventListener('click', () => ctx.run('timeline'));
  const itemOf = (/** @type {EventTarget|null} */ target) => findItem(view.shown, itemButton(target));
  const showTip = (/** @type {EventTarget|null} */ target) => {
    const item = itemOf(target);
    if (item) placeTip(tip, el, /** @type {HTMLElement} */ (itemButton(target)), itemWords(item, view.names.get(item.laneKey) ?? ''));
  };
  const hideTip = () => setHidden(tip, true);
  const go = (/** @type {Event} */ event) => {
    const item = itemOf(event.target);
    if (item) ctx.goToMoment(item);
  };
  lanes.addEventListener('pointerover', (event) => showTip(event.target));
  lanes.addEventListener('focusin', (event) => showTip(event.target));
  lanes.addEventListener('pointerout', hideTip);
  lanes.addEventListener('focusout', hideTip);
  lanes.addEventListener('click', go);
  list.addEventListener('click', go);
  lanes.addEventListener('keydown', (event) => {
    const button = itemButton(event.target);
    const next = button ? moveFrom(view.shown, button.dataset.lane ?? '', button.dataset.item ?? '', event.key) : null;
    if (!next) return;
    event.preventDefault();
    view.focused = next.id;
    syncRoving(lanes, view.focused);
    /** @type {HTMLElement|null} */ (lanes.querySelector(`[data-item="${next.id}"]`))?.focus();
  });

  /** @param {StoreState} state */
  function render(state) {
    if (el.hidden) return;
    view.crew = renderCrews(parts.crews, state, view.crew);
    const window = zoomWindow(view.zoom, Date.now());
    const minMs = ((window.to - window.from) / (lanes.clientWidth || 600)) * MIN_PX;
    const groups = timelineView(state.timeline, { ...window, sessions: view.crew ? [view.crew] : null, order: state.sessions.map((s) => s.id), minMs });
    view.shown = groups.flatMap((g) => g.lanes);
    view.names = laneNames(state, groups);
    for (const [id, button] of Object.entries(parts.zoomButtons)) setAttr(button, 'aria-pressed', String(id === view.zoom));
    setAttr(parts.listToggle, 'aria-pressed', String(view.listView));
    setText(/** @type {HTMLElement} */ (parts.axis.firstElementChild), formatClock(window.from));
    const any = view.shown.length > 0;
    setHidden(parts.empty, any);
    setHidden(lanes, view.listView || !any);
    setHidden(parts.axis, view.listView || !any);
    setHidden(list, !view.listView || !any);
    if (view.listView) renderAsList(list, view.shown, view.names);
    else {
      renderLanes(lanes, state, groups, window, view.names);
      syncRoving(lanes, view.focused);
    }
  }

  return {
    el,
    render,
    /** Moves the "now" edge with the clock. */
    tick() {
      if (!el.hidden) redraw();
    },
    /** @param {boolean} on */
    setShown(on) {
      setHidden(el, !on);
      document.documentElement.classList.toggle('hud-timeline-open', on);
      if (on) redraw();
    },
  };
}

/** @param {EventTarget|null} target @returns {HTMLElement|null} */
function itemButton(target) {
  return target instanceof Element ? /** @type {HTMLElement|null} */ (target.closest('[data-item]')) : null;
}

/** @param {TimelineLane[]} shown @param {HTMLElement|null} button */
function findItem(shown, button) {
  if (!button) return null;
  return shown.find((lane) => lane.key === button.dataset.lane)?.items.find((item) => item.id === button.dataset.item) ?? null;
}

/**
 * Shows the tooltip above an item, kept inside the strip.
 * @param {HTMLElement} tip @param {HTMLElement} host @param {HTMLElement} button @param {string} text
 */
function placeTip(tip, host, button, text) {
  setText(tip, text);
  setHidden(tip, false);
  const box = button.getBoundingClientRect();
  const frame = host.getBoundingClientRect();
  const left = Math.min(Math.max(0, box.left - frame.left + box.width / 2 - 140), Math.max(0, frame.width - 280));
  tip.style.left = `${Math.round(left)}px`;
  tip.style.top = `${Math.round(box.top - frame.top - 8)}px`;
}

/**
 * Keeps one item the strip's tab stop: the one focused last, else the newest of the first lane.
 * @param {HTMLElement} lanes @param {string|null} focused
 */
function syncRoving(lanes, focused) {
  const buttons = /** @type {HTMLElement[]} */ ([...lanes.querySelectorAll('[data-item]')]);
  const current = buttons.find((b) => b.dataset.item === focused) ?? buttons.filter((b) => b.dataset.lane === buttons[0]?.dataset.lane).at(-1);
  for (const button of buttons) setAttr(button, 'tabindex', button === current ? '0' : '-1');
}

/**
 * The crew picker: every crew with something on the timeline. Returns the crew still shown ('' for
 * all when the one picked is gone).
 * @param {HTMLSelectElement} select @param {StoreState} state @param {string} crew
 */
function renderCrews(select, state, crew) {
  const laneSessions = new Set(Object.values(state.timeline.lanes).map((lane) => lane.sessionId));
  const sessions = state.sessions.filter((s) => laneSessions.has(s.id));
  const picked = sessions.some((s) => s.id === crew) ? crew : '';
  const options = [{ id: '', label: 'All crews' }, ...sessions.map((s) => ({ id: s.id, label: `${s.number} · ${s.project}${s.member ? ` (${s.member})` : ''}` }))];
  renderList(select, options, (o) => o.id || 'all', (o) => h('option', { value: o.id }), (option, o) => setText(option, o.label));
  if (select.value !== picked) select.value = picked;
  return picked;
}

/** Who each lane is, in words: "Foreman (crew 2)". @param {StoreState} state @param {import('../core/timeline.js').TimelineGroup[]} groups */
function laneNames(state, groups) {
  const names = new Map();
  for (const group of groups) {
    const session = findSession(state, group.sessionId);
    for (const lane of group.lanes) names.set(lane.key, session ? `${lane.name} (crew ${session.number})` : lane.name);
  }
  return names;
}

/**
 * @param {HTMLElement} lanes @param {StoreState} state
 * @param {import('../core/timeline.js').TimelineGroup[]} groups
 * @param {{ from: number, to: number }} window @param {Map<string, string>} names
 */
function renderLanes(lanes, state, groups, window, names) {
  renderList(lanes, groups, (g) => g.sessionId, createGroup, (groupEl, group) => {
    const session = findSession(state, group.sessionId);
    setCrewColor(groupEl, session?.color);
    const crewName = session ? `${session.number} · ${session.project}` : 'A crew that left';
    setText(/** @type {HTMLElement} */ (groupEl.firstElementChild), crewName);
    setAttr(groupEl, 'aria-label', `Crew ${crewName}`);
    renderList(/** @type {HTMLElement} */ (groupEl.lastElementChild), group.lanes, (lane) => lane.key, createLane, (laneEl, lane) => {
      const who = names.get(lane.key) ?? lane.name;
      setAttr(laneEl, 'aria-label', who);
      setText(/** @type {HTMLElement} */ (laneEl.firstElementChild), lane.name);
      renderList(/** @type {HTMLElement} */ (laneEl.lastElementChild), lane.items, (item) => item.id, createItem, (itemEl, item) => updateItem(itemEl, item, window, who));
    });
  });
}

/** The same items as a list, newest first. @param {HTMLElement} list @param {TimelineLane[]} shown @param {Map<string, string>} names */
function renderAsList(list, shown, names) {
  const items = shown.flatMap((lane) => lane.items).sort((a, b) => b.start - a.start).slice(0, MAX_LIST);
  renderList(list, items, (item) => item.id, (item) => h('li', {}, h('button', { type: 'button', class: 'hud-timeline__row', 'data-item': item.id, 'data-lane': item.laneKey })), (row, item) => {
    const button = /** @type {HTMLElement} */ (row.firstElementChild);
    setText(button, itemWords(item, names.get(item.laneKey) ?? ''));
    button.classList.toggle('is-failed', item.fails > 0);
  });
}

/** @param {import('../core/timeline.js').TimelineGroup} _group */
function createGroup(_group) {
  return h('div', { class: 'hud-timeline__crew', role: 'group' }, h('p', { class: 'hud-timeline__crewname' }), h('div', { class: 'hud-timeline__crewlanes' }));
}

/** @param {TimelineLane} _lane */
function createLane(_lane) {
  return h('div', { class: 'hud-timeline__lane', role: 'group' }, h('span', { class: 'hud-timeline__name', 'aria-hidden': 'true' }), h('div', { class: 'hud-timeline__track' }));
}

/** @param {TimelineItem} item */
function createItem(item) {
  return h('button', { type: 'button', class: 'hud-timeline__item', 'data-item': item.id, 'data-lane': item.laneKey, 'data-type': item.type, tabindex: '-1' });
}

/**
 * @param {HTMLElement} el @param {TimelineItem} item @param {{ from: number, to: number }} window @param {string} who
 */
function updateItem(el, item, window, who) {
  const span = window.to - window.from;
  const start = Math.max(item.start, window.from);
  const left = ((start - window.from) / span) * 100;
  const width = ((Math.min(item.end, window.to) - start) / span) * 100;
  el.style.left = `${left.toFixed(3)}%`;
  el.style.width = item.type === 'tool' || item.type === 'wait' ? `${Math.max(0, width).toFixed(3)}%` : '';
  setAttr(el, 'data-building', item.building);
  setAttr(el, 'data-wait', item.wait);
  setAttr(el, 'data-ended', item.ended);
  el.classList.toggle('is-failed', item.fails > 0);
  el.classList.toggle('is-open', item.open);
  setAttr(el, 'aria-label', itemWords(item, who));
}
