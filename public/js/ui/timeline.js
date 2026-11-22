// The timeline strip under the town (core/timeline.js has the model): each call coloured by its
// building, failed calls as red ticks, waits for you hatched, your prompts as pins and the turn's
// end as a cap, up to a "now" edge that moves with the clock. Compact by default: one lane per
// crew's lead, whose name opens its helpers' lanes; Taller shows every agent's lane, grouped by
// crew. Zoom: the last 15 minutes, the last hour, or today, never before what the town remembers.
// It is rebuilt when the store changes; the clock alone only moves the now edge.
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
/** The shortest window shown, when the town remembers less than the zoom asks for. */
const MIN_SPAN_MS = 2 * 60_000;
/** Room ahead of now, as a share of the window: the now edge moves into it before a rebuild. */
const HEADROOM = 0.05;

/**
 * The window a zoom shows, ending now: today starts at midnight on this computer's clock (an hour
 * at least). It starts no earlier than what the town remembers (`earliest`, its first moment), but
 * spans two minutes at least; `since` says it was cut so.
 * @param {Zoom} zoom @param {number} now @param {number} [earliest]
 * @returns {{ from: number, to: number, since: boolean }}
 */
export function zoomWindow(zoom, now, earliest = -Infinity) {
  const midnight = new Date(now);
  midnight.setHours(0, 0, 0, 0);
  // A day that has barely begun still shows its first hour.
  const from = zoom === '15m' ? now - 15 * 60_000 : zoom === '1h' ? now - 60 * 60_000 : Math.min(midnight.getTime(), now - 60 * 60_000);
  if (earliest <= from) return { from, to: now, since: false };
  return { from: Math.min(earliest, now - MIN_SPAN_MS), to: now, since: true };
}

/**
 * The lanes shown: every lane when tall; else each crew's lead, with its helpers when that crew is
 * opened. Each group also says how many helper lanes it has.
 * @param {import('../core/timeline.js').TimelineGroup[]} groups
 * @param {{ tall: boolean, opened: ReadonlySet<string> }} options
 * @returns {ShownGroup[]}
 */
export function visibleLanes(groups, { tall, opened }) {
  return groups.map((group) => {
    const helpers = group.lanes.filter((lane) => lane.role !== 'lead').length;
    const lead = group.lanes.filter((lane) => lane.role === 'lead');
    // A crew whose lead did nothing in the window still shows its helpers.
    const lanes = tall || opened.has(group.sessionId) || !lead.length ? group.lanes : lead;
    return { ...group, lanes, helpers };
  });
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
    tallToggle: h('button', { type: 'button', class: 'hud-btn hud-btn--small', 'aria-pressed': 'false', 'data-testid': 'timeline-tall-toggle' }, 'Taller'),
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
      parts.tallToggle,
      parts.listToggle,
      parts.close),
    h('div', { class: 'hud-timeline__body' }, parts.axis, parts.lanes, parts.list, parts.empty),
    parts.tip);
  return { el, ...parts };
}

/** @param {HudContext} ctx */
export function createTimeline(ctx) {
  const parts = createParts();
  const { el, lanes, list } = parts;
  const view = {
    /** @type {Zoom} */
    zoom: '15m',
    listView: false,
    /** the crew shown, or '' for all */
    crew: '',
    /** @type {Set<string>} crews whose helpers' lanes are open in the compact strip */
    opened: new Set(),
    /** @type {string|null} the item that holds the strip's one tab stop */
    focused: null,
    /** @type {TimelineLane[]} */
    shown: [],
    /** @type {Map<string, string>} lane key → who, in words */
    names: new Map(),
    /** the store changed since the last rebuild */
    dirty: true,
    /** the window drawn: items are placed in it; the now edge moves inside it */
    window: { from: 0, to: 0 },
  };
  ctx.store.subscribe(() => {
    view.dirty = true;
  });
  const redraw = () => {
    view.dirty = true;
    render(ctx.store.getState());
  };

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
  parts.tallToggle.addEventListener('click', () => {
    ctx.setPrefs({ timelineTall: !ctx.prefs.timelineTall });
    redraw();
    ctx.announcer.polite(ctx.prefs.timelineTall ? 'Taller timeline: a lane for every agent.' : 'Compact timeline: a lane for each crew.');
  });
  parts.close.addEventListener('click', () => ctx.run('timeline'));
  wireItems(parts, view, ctx, (sessionId) => toggleCrew(sessionId));

  /** Opens or closes a crew's helpers' lanes in the compact strip. @param {string} sessionId */
  function toggleCrew(sessionId) {
    if (view.opened.has(sessionId)) view.opened.delete(sessionId);
    else view.opened.add(sessionId);
    redraw();
  }

  /** Rebuilds when the store or a control changed, or when now has moved past the window. @param {StoreState} state */
  function render(state) {
    if (el.hidden) return;
    const now = Date.now();
    if (!view.dirty && now <= view.window.to) return;
    view.dirty = false;
    view.crew = renderCrews(parts.crews, state, view.crew);
    const firsts = Object.values(state.timeline.lanes).map((lane) => lane.first);
    const earliest = firsts.length ? Math.min(...firsts) : -Infinity;
    const window = zoomWindow(view.zoom, now, earliest);
    const minMs = ((window.to - window.from) / (lanes.clientWidth || 600)) * MIN_PX;
    const all = timelineView(state.timeline, { ...window, sessions: view.crew ? [view.crew] : null, order: state.sessions.map((s) => s.id), minMs });
    const tall = ctx.prefs.timelineTall;
    const groups = visibleLanes(all, { tall, opened: view.opened });
    view.window = { from: window.from, to: now + (now - window.from) * HEADROOM };
    view.shown = groups.flatMap((g) => g.lanes);
    view.names = laneNames(state, groups);
    for (const [id, button] of Object.entries(parts.zoomButtons)) setAttr(button, 'aria-pressed', String(id === view.zoom));
    setAttr(parts.listToggle, 'aria-pressed', String(view.listView));
    setAttr(parts.tallToggle, 'aria-pressed', String(tall));
    el.classList.toggle('is-tall', tall);
    setText(/** @type {HTMLElement} */ (parts.axis.firstElementChild), `${window.since ? 'since ' : ''}${formatClock(window.from)}`);
    const any = view.shown.length > 0;
    setHidden(parts.empty, any);
    setHidden(lanes, view.listView || !any);
    setHidden(parts.axis, view.listView || !any);
    setHidden(list, !view.listView || !any);
    if (view.listView) renderAsList(list, view.shown, view.names);
    else {
      renderLanes(lanes, state, groups, { window: view.window, names: view.names, tall, opened: view.opened });
      syncRoving(lanes, view.focused);
    }
    moveNow(now);
  }

  /** The now edge, where the clock is in the window drawn. @param {number} now */
  function moveNow(now) {
    const share = Math.min(1, (now - view.window.from) / (view.window.to - view.window.from || 1));
    el.style.setProperty('--tl-now', share.toFixed(4));
  }

  return {
    el,
    render,
    /** The clock moves the now edge; past the window drawn, it is drawn again. */
    tick() {
      if (el.hidden) return;
      const now = Date.now();
      if (now > view.window.to) render(ctx.store.getState());
      else moveNow(now);
    },
    /** @param {boolean} on */
    setShown(on) {
      setHidden(el, !on);
      document.documentElement.classList.toggle('hud-timeline-open', on);
      if (on) redraw();
    },
  };
}

/**
 * The items' pointer and keyboard: the tooltip on hover and focus, a click (or Enter) goes to the
 * moment, a lead's +N opens its crew's helpers, the arrow keys move between moments.
 * @param {ReturnType<typeof createParts>} parts
 * @param {{ shown: TimelineLane[], names: Map<string, string>, focused: string|null }} view
 * @param {HudContext} ctx
 * @param {(sessionId: string) => void} toggleCrew
 */
function wireItems({ el, lanes, list, tip }, view, ctx, toggleCrew) {
  const itemOf = (/** @type {EventTarget|null} */ target) => findItem(view.shown, itemButton(target));
  const showTip = (/** @type {EventTarget|null} */ target) => {
    const item = itemOf(target);
    if (item) placeTip(tip, el, /** @type {HTMLElement} */ (itemButton(target)), itemWords(item, view.names.get(item.laneKey) ?? ''));
  };
  const hideTip = () => setHidden(tip, true);
  lanes.addEventListener('pointerover', (event) => showTip(event.target));
  lanes.addEventListener('focusin', (event) => showTip(event.target));
  lanes.addEventListener('pointerout', hideTip);
  lanes.addEventListener('focusout', hideTip);
  const onClick = (/** @type {Event} */ event) => {
    const opener = event.target instanceof Element ? /** @type {HTMLElement|null} */ (event.target.closest('[data-open-crew]')) : null;
    if (opener) return toggleCrew(opener.dataset.openCrew ?? '');
    const item = itemOf(event.target);
    if (item) ctx.goToMoment(item);
  };
  lanes.addEventListener('click', onClick);
  list.addEventListener('click', onClick);
  lanes.addEventListener('keydown', (event) => {
    const button = itemButton(event.target);
    const next = button ? moveFrom(view.shown, button.dataset.lane ?? '', button.dataset.item ?? '', event.key) : null;
    if (!next) return;
    event.preventDefault();
    view.focused = next.id;
    syncRoving(lanes, view.focused);
    /** @type {HTMLElement|null} */ (lanes.querySelector(`[data-item="${next.id}"]`))?.focus();
  });
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
 * @param {ShownGroup[]} groups
 * @param {{ window: { from: number, to: number }, names: Map<string, string>, tall: boolean, opened: ReadonlySet<string> }} options
 */
function renderLanes(lanes, state, groups, { window, names, tall, opened }) {
  renderList(lanes, groups, (g) => g.sessionId, createGroup, (groupEl, group) => {
    const session = findSession(state, group.sessionId);
    setCrewColor(groupEl, session?.color);
    const crewName = session ? `${session.number} · ${session.project}` : 'A crew that left';
    const heading = /** @type {HTMLElement} */ (groupEl.firstElementChild);
    setText(heading, crewName);
    // Compact: the lead's lane carries the crew's name instead of a row of its own.
    setHidden(heading, !tall);
    setAttr(groupEl, 'aria-label', `Crew ${crewName}`);
    renderList(/** @type {HTMLElement} */ (groupEl.lastElementChild), group.lanes, (lane) => lane.key, createLane, (laneEl, lane) => {
      const who = names.get(lane.key) ?? lane.name;
      setAttr(laneEl, 'aria-label', who);
      const [label, opener] = /** @type {HTMLElement[]} */ ([...laneEl.firstElementChild.children]);
      const leadOfCompact = !tall && lane.role === 'lead';
      setText(label, leadOfCompact ? crewName : lane.name);
      laneEl.classList.toggle('is-helper', lane.role !== 'lead');
      const open = opened.has(group.sessionId);
      setHidden(opener, !leadOfCompact || !group.helpers);
      opener.dataset.openCrew = group.sessionId;
      setText(opener, open ? '−' : `+${group.helpers}`);
      setAttr(opener, 'aria-expanded', String(open));
      setAttr(opener, 'aria-label', `${open ? 'Hide' : 'Show'} ${group.helpers} helper${group.helpers === 1 ? '' : 's'} of crew ${crewName}`);
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

/** @typedef {import('../core/timeline.js').TimelineGroup & { helpers: number }} ShownGroup */

/** @param {ShownGroup} _group */
function createGroup(_group) {
  return h('div', { class: 'hud-timeline__crew', role: 'group' }, h('p', { class: 'hud-timeline__crewname' }), h('div', { class: 'hud-timeline__crewlanes' }));
}

/** @param {TimelineLane} _lane */
function createLane(_lane) {
  return h('div', { class: 'hud-timeline__lane', role: 'group' },
    h('div', { class: 'hud-timeline__who' },
      h('span', { class: 'hud-timeline__name', 'aria-hidden': 'true' }),
      h('button', { type: 'button', class: 'hud-timeline__open', hidden: true })),
    h('div', { class: 'hud-timeline__track' }));
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
