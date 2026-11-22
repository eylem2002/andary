// The floating toolbar at the bottom of the town: camera, time of day, quality, sound, demo
// controls and help. It is one tab stop (arrow keys move inside it, as ARIA toolbars do); every
// button shows a tooltip with its name and shortcut on hover and on keyboard focus.
import { h, setAttr, setHidden, setText } from './dom.js';
import { icon } from './icons.js';
import { directorActive } from './cinema.js';
import { panelsHidden } from './hud-actions.js';
import { kbd } from './parts.js';
import { meter, usageButtonWords } from './limits.js';

/** @typedef {import('./types.js').HudContext} HudContext */

/**
 * @typedef {object} Tool
 * @property {string} id         action name passed to ctx.run
 * @property {string} label      visible tooltip text; the accessible name starts with it
 * @property {string} [key]      shortcut shown in the tooltip
 * @property {string} [keyName]  aria-keyshortcuts value
 * @property {'demo'} [only]
 * @property {boolean} [compact] kept on phones (the rest move to Settings or gestures)
 */

/** @type {(Tool|'|')[]} */
const TOOLS = [
  { id: 'director', label: 'Director camera', key: 'C', keyName: 'C', compact: true },
  { id: 'toggle-panels', label: 'Full-screen town', key: 'H', keyName: 'H', compact: true },
  { id: 'follow', label: 'Follow', key: 'F', keyName: 'F', compact: true },
  '|',
  { id: 'rotate-left', label: 'Rotate left', key: '[', keyName: '[', compact: true },
  { id: 'rotate-right', label: 'Rotate right', key: ']', keyName: ']', compact: true },
  { id: 'zoom-in', label: 'Zoom in', key: '+', keyName: '+' },
  { id: 'zoom-out', label: 'Zoom out', key: '−', keyName: '-' },
  { id: 'reset-view', label: 'Reset view', key: '0', keyName: '0', compact: true },
  '|',
  { id: 'cycle-time', label: 'Time of day', key: 'N', keyName: 'N', compact: true },
  { id: 'toggle-quality', label: 'High quality' },
  { id: 'toggle-sound', label: 'Sound', key: 'M', keyName: 'M', compact: true },
  { id: 'usage', label: 'Usage and cost', key: 'U', keyName: 'U', compact: true },
  { id: 'leaderboard', label: 'Leaderboard', key: 'L', keyName: 'L', compact: true },
  '|',
  { id: 'pause', label: 'Pause demo', key: 'Space', keyName: 'Space', only: 'demo', compact: true },
  { id: 'cycle-speed', label: 'Demo speed', only: 'demo', compact: true },
  '|',
  { id: 'help', label: 'Help and shortcuts', key: '?', keyName: 'Shift+?' },
];

const TIME_WORDS = { auto: 'follows your clock', day: 'day', sunset: 'sunset', night: 'night' };

/** @param {HudContext} ctx */
export function createToolbar(ctx) {
  /** @type {Record<string, HTMLButtonElement>} */
  const buttons = {};
  /** @type {Record<string, HTMLElement>} */
  const tips = {};
  // The Usage button's gauge: the most used plan limit, when the andary-limits mod reports them.
  const gauge = meter('usage-gauge');
  const children = TOOLS.map((tool) => (tool === '|' ? h('span', { class: 'hud-toolbar__sep', 'aria-hidden': 'true' }) : makeButton(tool)));
  const el = h('div', { class: 'hud hud-toolbar', role: 'toolbar', 'aria-label': 'Town controls' }, ...children);

  /** @param {Tool} tool */
  function makeButton(tool) {
    const tip = h('span', { class: 'hud-tip', 'aria-hidden': 'true' }, h('span', { class: 'hud-tip__text', text: tool.label }), tool.key ? kbd(tool.key) : null);
    const button = /** @type {HTMLButtonElement} */ (h('button', {
      type: 'button',
      class: tool.compact ? 'hud-tool' : 'hud-tool hud-tool--wide-only',
      'data-tool': tool.id,
      'aria-keyshortcuts': tool.keyName,
      tabindex: '-1',
    }, h('span', { class: 'hud-tool__face' }), tool.id === 'usage' ? gauge.el : null, tip));
    button.addEventListener('click', () => {
      ctx.run(tool.id);
      setRoving(button);
    });
    buttons[tool.id] = button;
    tips[tool.id] = tip;
    return button;
  }

  el.addEventListener('keydown', (event) => {
    const visible = Object.values(buttons).filter((b) => !b.hidden && b.offsetParent !== null);
    const index = visible.indexOf(/** @type {HTMLButtonElement} */ (document.activeElement));
    const moves = { ArrowRight: index + 1, ArrowDown: index + 1, ArrowLeft: index - 1, ArrowUp: index - 1, Home: 0, End: visible.length - 1 };
    if (index < 0 || !(event.key in moves)) return;
    event.preventDefault();
    const next = visible[(moves[event.key] + visible.length) % visible.length];
    setRoving(next);
    next.focus();
  });

  /** @param {HTMLButtonElement} active */
  function setRoving(active) {
    for (const button of Object.values(buttons)) setAttr(button, 'tabindex', button === active ? '0' : '-1');
  }

  /** @param {string} id @param {string} iconName @param {string} name @param {boolean|null} pressed */
  function setButton(id, iconName, name, pressed) {
    const button = buttons[id];
    const face = /** @type {HTMLElement} */ (button.firstElementChild);
    if (face.dataset.icon !== iconName) {
      face.dataset.icon = iconName;
      face.replaceChildren(iconName.startsWith('text:') ? h('span', { class: 'hud-tool__text', text: iconName.slice(5) }) : icon(iconName));
    }
    setAttr(button, 'aria-label', name);
    setAttr(button, 'aria-pressed', pressed == null ? null : String(pressed));
  }

  function render() {
    const { view, prefs } = ctx;
    const demo = view.mode === 'demo';
    for (const tool of TOOLS) if (tool !== '|' && tool.only === 'demo') setHidden(buttons[tool.id], !demo);
    // Without a 3D view there is no camera to direct and no town to fill the screen with.
    setHidden(buttons.director, view.worldFailed);
    setHidden(buttons['toggle-panels'], view.worldFailed);
    for (const sep of el.querySelectorAll('.hud-toolbar__sep')) {
      // The separator before the demo group disappears with it.
      const next = /** @type {HTMLElement|null} */ (sep.nextElementSibling);
      setHidden(/** @type {HTMLElement} */ (sep), Boolean(next?.hidden));
    }
    setButton('director', 'video', 'Director camera', directorActive(ctx));
    setButton('toggle-panels', 'panels', 'Full-screen town', panelsHidden(ctx));
    setButton('follow', 'follow', 'Follow the selected agent', view.follow);
    setButton('rotate-left', 'rotateLeft', 'Rotate left', null);
    setButton('rotate-right', 'rotateRight', 'Rotate right', null);
    setButton('zoom-in', 'zoomIn', 'Zoom in', null);
    setButton('zoom-out', 'zoomOut', 'Zoom out', null);
    setButton('reset-view', 'resetView', 'Reset view', null);
    const timeIcon = { auto: 'clock', day: 'sun', sunset: 'sunset', night: 'moon' }[prefs.timeMode];
    setButton('cycle-time', timeIcon, `Time of day: ${TIME_WORDS[prefs.timeMode]}`, null);
    setText(/** @type {HTMLElement} */ (tips['cycle-time'].firstElementChild), `Time of day: ${TIME_WORDS[prefs.timeMode]}`);
    setButton('toggle-quality', 'quality', 'High quality graphics', prefs.quality !== 'low');
    setButton('toggle-sound', ctx.sound.enabled ? 'soundOn' : 'soundOff', 'Sound', ctx.sound.enabled);
    setButton('pause', view.paused ? 'play' : 'pause', 'Pause demo', view.paused);
    setButton('cycle-speed', `text:${prefs.speed}×`, `Demo speed: ${prefs.speed}×`, null);
    setText(/** @type {HTMLElement} */ (tips['cycle-speed'].firstElementChild), `Demo speed: ${prefs.speed}×`);
    setButton('help', 'help', 'Help and shortcuts', null);
    const usage = usageButtonWords(view.limits ?? [], Date.now());
    setButton('usage', 'coins', usage.name, null);
    setText(/** @type {HTMLElement} */ (tips.usage.firstElementChild), usage.tip);
    gauge.update(usage.gauge);
    setButton('leaderboard', 'trophy', 'Leaderboard', null);
    // Keep the toolbar's one tab stop on a button that is actually shown in this layout.
    const current = Object.values(buttons).find((b) => b.getAttribute('tabindex') === '0');
    if (!current || current.hidden || (view.mobile && current.classList.contains('hud-tool--wide-only'))) setRoving(buttons.follow);
  }

  /**
   * Moves keyboard focus to a tool, keeping it the toolbar's one tab stop.
   * @param {string} id
   */
  function focusTool(id) {
    const button = buttons[id];
    if (!button || button.hidden) return;
    setRoving(button);
    button.focus();
  }

  return { el, render, focusTool };
}
