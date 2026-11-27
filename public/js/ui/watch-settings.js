// Settings → Cost and long-turn alerts (core/watch.js): when a crew that spends fast with nothing
// changed, a costly turn or a turn with many helpers counts in "need you", when a long turn with
// no edits gets a note on its row, how long a crew waits between two alerts of a kind, and
// whether the server's phone notes (andary start --notify) include them. In the live town the
// server keeps them (its phone notes follow them too); in the demo, this browser does.
import { WATCH_RANGES, readWatchSettings } from '../core/watch.js';
import { h, setAttr, setHidden } from './dom.js';

/** @typedef {import('./types.js').HudContext} HudContext */
/** @typedef {import('../core/watch.js').WatchSettings} WatchSettings */

/** The number fields, in the order shown: [setting, label, unit, step]. @type {[keyof WatchSettings, string, string, string][]} */
const FIELDS = [
  ['burnUsd', 'Spending alert', '$ estimated…', '0.5'],
  ['burnMinutes', '…within', 'minutes, no files changed', '1'],
  ['turnUsd', 'One turn costs more than', '$ estimated', '1'],
  ['helpers', 'One turn starts', 'helpers or more', '1'],
  ['longMinutes', 'Long-turn note after', 'minutes working…', '5'],
  ['quietMinutes', '…with no edits for', 'minutes', '5'],
  ['cooldownMinutes', 'Between two alerts of a kind, a crew waits', 'minutes', '5'],
];

/**
 * The settings now: the server's in the live town, else this browser's.
 * @param {HudContext} ctx
 * @returns {WatchSettings}
 */
export function currentWatch(ctx) {
  return readWatchSettings(ctx.view.mode === 'live' ? ctx.view.serverSettings.watch : ctx.prefs.watch);
}

/** @param {keyof WatchSettings} key @param {number} value */
function clampTo(key, value) {
  const [min, max] = WATCH_RANGES[/** @type {keyof typeof WATCH_RANGES} */ (key)];
  return Math.min(max, Math.max(min, value));
}

/** @param {HudContext} ctx */
export function watchBlock(ctx) {
  /** @type {Map<keyof WatchSettings, HTMLInputElement>} */
  const inputs = new Map();
  const rows = FIELDS.map(([key, label, unit, step]) => {
    const id = `hud-set-watch-${key}`;
    const [min, max] = WATCH_RANGES[/** @type {keyof typeof WATCH_RANGES} */ (key)];
    const input = /** @type {HTMLInputElement} */ (h('input', { type: 'number', class: 'hud-input hud-watch__number', id, min: String(min), max: String(max), step, inputmode: 'decimal', 'data-testid': `watch-${key}` }));
    input.addEventListener('change', () => apply());
    inputs.set(key, input);
    return h('div', { class: 'hud-setting__row hud-watch__row' },
      h('label', { class: 'hud-watch__label', for: id, text: label }),
      h('span', { class: 'hud-watch__value' }, input, h('span', { class: 'hud-watch__unit', text: unit })));
  });
  const phone = /** @type {HTMLInputElement} */ (h('input', { type: 'checkbox', class: 'hud-switch', id: 'hud-set-watch-phone', role: 'switch', 'data-testid': 'watch-phone' }));
  phone.addEventListener('change', () => apply());
  const phoneRow = h('div', { class: 'hud-setting__row' }, h('label', { class: 'hud-setting__name', for: 'hud-set-watch-phone', text: 'Also on your phone' }), phone);
  const el = h('div', { class: 'hud-setting', 'data-testid': 'watch-settings' },
    h('p', { class: 'hud-setting__name', text: 'Cost and long-turn alerts' }),
    h('p', { class: 'hud-setting__help', id: 'hud-set-watch-help', text: 'A spending, cost or helpers alert shows on the crew and counts in "need you" until you set it aside or give the crew a prompt. 0 turns one off. Costs are estimates at API list prices (on a Pro or Max plan a measure of value, not a bill); Codex reports none, so its crews get the helpers alert only.' }),
    ...rows,
    phoneRow);
  for (const input of inputs.values()) setAttr(input, 'aria-describedby', 'hud-set-watch-help');

  function apply() {
    /** @type {Record<string, unknown>} */
    const raw = { ...currentWatch(ctx), phone: phone.checked };
    // A number out of range takes the nearest allowed one, not the default.
    for (const [key, input] of inputs) if (input.value !== '' && Number.isFinite(Number(input.value))) raw[key] = clampTo(key, Number(input.value));
    const settings = readWatchSettings(raw);
    if (ctx.view.mode === 'live') ctx.controls.setWatch(settings);
    else {
      ctx.setPrefs({ watch: settings });
      ctx.store.setWatchSettings(settings);
    }
    sync();
  }

  function sync() {
    const settings = ctx.view.mode === 'live' && !ctx.view.serverSettings.watch ? null : currentWatch(ctx);
    const live = ctx.view.mode === 'live';
    const viewer = ['viewer', 'person'].includes(ctx.view.serverSettings.team?.role ?? '');
    setHidden(el, viewer || (live && !settings));
    for (const [key, input] of inputs) {
      // The field being typed in keeps what is typed.
      if (settings && document.activeElement !== input) input.value = String(settings[key]);
      input.disabled = live && ctx.view.connection !== 'live';
    }
    phone.checked = Boolean(settings?.phone);
    phone.disabled = live && ctx.view.connection !== 'live';
    setHidden(phoneRow, !live || !ctx.view.serverSettings.notify);
  }

  return { el, sync };
}
