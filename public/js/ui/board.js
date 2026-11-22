// The town board: tabs for Tasks, Activity and Approvals on the right of the screen. On phones it
// becomes a bottom sheet and the Crews panel moves into it as a fourth tab, so one sheet holds
// everything (the panels are re-parented rather than duplicated, keeping one set of ids).
import { h, setAttr, setHidden, setText } from './dom.js';
import { icon } from './icons.js';

/** @typedef {import('./types.js').HudContext} HudContext */

const TABS = [
  { id: 'crews', label: 'Crews', mobileOnly: true },
  { id: 'tasks', label: 'Tasks' },
  { id: 'activity', label: 'Activity' },
  { id: 'approvals', label: 'Approvals' },
];

/**
 * @param {HudContext} ctx
 * @param {{ crews: HTMLElement, tasks: HTMLElement, activity: HTMLElement, approvals: HTMLElement }} contents
 */
export function createBoard(ctx, contents) {
  const badgeCount = h('span', { class: 'hud-tab__count' });
  const badge = h('span', { class: 'hud-tab__badge', hidden: true }, badgeCount, h('span', { class: 'hud-sr', text: ' waiting' }));
  /** @type {Record<string, HTMLElement>} */
  const tabs = {};
  /** @type {Record<string, HTMLElement>} */
  const panels = {};
  for (const tab of TABS) {
    tabs[tab.id] = h('button', {
      type: 'button',
      role: 'tab',
      class: 'hud-tab',
      id: `hud-tab-${tab.id}`,
      'aria-controls': `hud-panel-${tab.id}`,
      'aria-selected': 'false',
      tabindex: '-1',
      'data-tab': tab.id,
    }, tab.label, tab.id === 'approvals' ? badge : null);
    panels[tab.id] = h('div', { role: 'tabpanel', class: 'hud-tabpanel', id: `hud-panel-${tab.id}`, 'aria-labelledby': `hud-tab-${tab.id}`, hidden: true });
  }
  // The Tasks panel is all text: it takes focus itself so it can be scrolled from the keyboard.
  panels.tasks.setAttribute('tabindex', '0');
  panels.tasks.append(contents.tasks);
  panels.activity.append(contents.activity);
  panels.approvals.append(contents.approvals);

  const tablist = h('div', { role: 'tablist', class: 'hud-tabs', 'aria-label': 'Town board' }, ...TABS.map((tab) => tabs[tab.id]));
  const handle = h('button', { type: 'button', class: 'hud-sheet-handle', 'aria-expanded': 'true', 'aria-controls': 'hud-board-panels', 'aria-label': 'Town board' },
    h('span', { class: 'hud-sheet-handle__grip', 'aria-hidden': 'true' }), icon('chevronDown', { size: 18 }));
  const panelWrap = h('div', { class: 'hud-board__panels', id: 'hud-board-panels' }, ...TABS.map((tab) => panels[tab.id]));
  const el = h('aside', { class: 'hud hud-board', 'aria-label': 'Town board' }, handle, tablist, panelWrap);
  const leftDock = h('div', { class: 'hud hud-left' }, contents.crews);

  tablist.addEventListener('click', (event) => {
    const tab = /** @type {HTMLElement} */ (event.target).closest('[role="tab"]');
    if (tab) select(/** @type {HTMLElement} */ (tab).dataset.tab, { focus: false, open: true });
  });
  tablist.addEventListener('keydown', (event) => onTabKey(event));
  handle.addEventListener('click', () => setSheetOpen(!ctx.view.sheetOpen));

  /** Arrow keys move between tabs and select them (automatic activation). @param {KeyboardEvent} event */
  function onTabKey(event) {
    const visible = TABS.filter((tab) => !tabs[tab.id].hidden).map((tab) => tab.id);
    const index = visible.indexOf(ctx.view.tab);
    const moves = { ArrowRight: index + 1, ArrowLeft: index - 1, Home: 0, End: visible.length - 1 };
    if (!(event.key in moves)) return;
    event.preventDefault();
    const next = visible[(moves[event.key] + visible.length) % visible.length];
    select(next, { focus: true, open: true });
  }

  /**
   * @param {string} id
   * @param {{ focus?: boolean, open?: boolean }} [options]
   */
  function select(id, { focus = false, open = false } = {}) {
    const target = tabs[id] && !tabs[id].hidden ? id : 'activity';
    ctx.view.tab = target;
    for (const tab of TABS) {
      const selected = tab.id === target;
      setAttr(tabs[tab.id], 'aria-selected', String(selected));
      setAttr(tabs[tab.id], 'tabindex', selected ? '0' : '-1');
      setHidden(panels[tab.id], !selected);
    }
    ctx.setPrefs({ tab: /** @type {any} */ (target) });
    if (open && ctx.view.mobile) setSheetOpen(true);
    if (focus) tabs[target].focus();
  }

  /** @param {boolean} open */
  function setSheetOpen(open) {
    ctx.view.sheetOpen = open;
    setAttr(handle, 'aria-expanded', String(open));
    handle.replaceChildren(h('span', { class: 'hud-sheet-handle__grip', 'aria-hidden': 'true' }), icon(open ? 'chevronDown' : 'chevronUp', { size: 18 }));
    document.documentElement.dataset.sheet = open ? 'open' : 'closed';
  }

  /** Moves the Crews panel between the left dock (desktop) and the sheet's Crews tab (phone). @param {boolean} mobile */
  function setMobile(mobile) {
    setHidden(tabs.crews, !mobile);
    const home = mobile ? panels.crews : leftDock;
    if (contents.crews.parentElement !== home) home.append(contents.crews);
    if (!mobile && ctx.view.tab === 'crews') select('activity');
    else select(ctx.view.tab);
    setSheetOpen(ctx.view.sheetOpen);
  }

  /** @param {number} pending */
  function setPendingApprovals(pending) {
    setHidden(badge, pending === 0);
    setText(badgeCount, String(pending));
  }

  return { el, leftDock, select, setMobile, setSheetOpen, setPendingApprovals, tabButton: (/** @type {string} */ id) => tabs[id] };
}
