// What an ended crew left running (CONTRACTS §4.16), under its line in Crews: each server still
// listening, the command that started it, and a command to copy that would stop it. Andary never
// stops anything itself, and says so. "Set aside" hides the block, like any other set-aside item.
import { copyCommand } from './dialogs.js';
import { h, setHidden } from './dom.js';
import { icon } from './icons.js';

/** @typedef {import('./types.js').HudContext} HudContext */
/** @typedef {import('./types.js').StoreState} StoreState */
/** @typedef {StoreState['leftovers'][number]} Found */

/** The id a set-aside block is remembered by (needs-you.js keeps it for a day). @param {Found} found */
export const leftoverId = (found) => `leftover:${found.sessionId}:${found.at}`;

/**
 * The block for one crew line; `update` shows what its session left, if anything.
 * @param {HudContext} ctx
 */
export function createLeftoversBlock(ctx) {
  const list = h('ul', { class: 'hud-leftovers__list' });
  const aside = h('button', { type: 'button', class: 'hud-btn hud-btn--small', 'data-testid': 'leftovers-dismiss' }, icon('close', { size: 16 }), h('span', { text: 'Set aside' }));
  const el = h('div', { class: 'hud-leftovers', 'data-testid': 'crew-leftovers', hidden: true },
    h('p', { class: 'hud-leftovers__title', text: 'Left running after the session ended' }),
    list,
    h('p', { class: 'hud-leftovers__note', text: 'Andary never stops anything itself. Check that it is yours before you run a command.' }),
    aside);
  /** @type {string} */
  let shown = '';
  /** @type {Found|null} */
  let current = null;
  aside.addEventListener('click', () => {
    if (!current) return;
    ctx.needsYou.dismiss(leftoverId(current));
    ctx.announcer.polite('Set aside what the crew left running');
    ctx.refresh();
  });

  return {
    el,
    /** @param {Found|undefined} found  what the crew's session left, if anything */
    update(found) {
      const visible = Boolean(found?.items.length) && !ctx.needsYou.isDismissed(leftoverId(/** @type {Found} */ (found)));
      setHidden(el, !visible);
      current = visible ? /** @type {Found} */ (found) : null;
      const key = current ? leftoverId(current) : '';
      // Built once per finding: a rebuild would take the keyboard off a Copy button.
      if (!current || key === shown) return;
      shown = key;
      list.replaceChildren(...current.items.map((item) => itemRow(ctx, item)));
    },
  };
}

/**
 * @param {HudContext} ctx
 * @param {import('../core/leftovers.js').Leftover} item
 */
function itemRow(ctx, item) {
  const code = h('code', { class: 'hud-mono hud-steps__code', text: item.kill });
  const copy = h('button', { type: 'button', class: 'hud-btn hud-btn--small', 'data-testid': 'leftover-copy', 'aria-label': `Copy the command that stops port ${item.port}` }, icon('copy', { size: 16 }), h('span', { text: 'Copy' }));
  copy.addEventListener('click', () => copyCommand(item.kill, code, copy, ctx));
  const pid = item.pid ? `, process ${item.pid}` : '';
  return h('li', { class: 'hud-leftovers__item', 'data-testid': 'leftover', 'data-port': String(item.port) },
    h('p', {}, h('code', { class: 'hud-mono', text: item.command }), h('span', { text: ` on port ${item.port}${pid}` })),
    h('div', { class: 'hud-steps__command' }, code, copy));
}
