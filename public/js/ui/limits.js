// Plan limits in the HUD (CONTRACTS §4.14): the gauge on the Usage button, which shows the most
// used limit, and the "Plan limits" list at the top of the Usage dialog, one meter per limit
// with its percent, when it was read, when it resets and, when the pace would run it out
// first, around when. The words come from core/limits.js, which the phone note shares. The
// limits are not counted in "needs you": Claude Code warns at 85% itself.
import { h, setAttr, setHidden, setText } from './dom.js';
import { busiestGauge, limitGauges } from '../core/limits.js';

/** @typedef {import('./types.js').HudContext} HudContext */
/** @typedef {import('../core/limits.js').Gauge} Gauge */
/** @typedef {import('../core/limits.js').AccountLimits} AccountLimits */

/**
 * What a gauge says in one line: "5-hour limit 42% used, resets at 15:40".
 * @param {Gauge} gauge
 */
export function gaugeLine(gauge) {
  return `${gauge.name} ${gauge.used}, ${gauge.resets}`;
}

/**
 * The Usage button's name and tooltip, with the busiest limit when there is one.
 * @param {AccountLimits[]} accounts
 * @param {number} now
 * @returns {{ gauge: Gauge|null, name: string, tip: string }}
 */
export function usageButtonWords(accounts, now) {
  const gauge = busiestGauge(accounts, now);
  if (!gauge) return { gauge: null, name: 'Usage and cost', tip: 'Usage and cost' };
  return { gauge, name: `Usage and cost. ${gaugeLine(gauge)}`, tip: `Usage · ${gauge.name} ${gauge.percent}%` };
}

/**
 * A meter's bar: the fill carries the level, the track stays the same.
 * @param {string} testId
 */
export function meter(testId) {
  const fill = h('span', { class: 'hud-gauge__fill' });
  const el = h('span', { class: 'hud-gauge', 'data-testid': testId, 'aria-hidden': 'true' }, fill);
  return {
    el,
    /** @param {Gauge|null} gauge */
    update(gauge) {
      setHidden(el, !gauge);
      if (!gauge) return;
      setAttr(el, 'data-level', gauge.level);
      setAttr(el, 'data-percent', String(gauge.percent));
      // A custom property from script: the page's CSP forbids style attributes, not CSSOM.
      fill.style.setProperty('--gauge', `${Math.max(gauge.percent, 2)}%`);
    },
  };
}

/** What the dialog says when there is no reading, by why. */
const NO_READING = Object.freeze({
  demo: 'The demo makes these limits up.',
  viewer: 'Only the town\'s host sees plan limits.',
  none: 'Your 5-hour and weekly limits can show here: add the andary-limits mod to Claude Code (/plugin install andary-limits@andary, from the andary marketplace). It sends them after each turn.',
  empty: 'No plan limits reported. Claude Code reports them on a Pro or Max plan after its first answer, or a gateway\'s spend limit.',
});

/**
 * What the dialog says under the limits, or '' when they speak for themselves.
 * @param {{ mode: string, serverSettings: { team?: { role: string }|null } }} view
 * @param {number} accounts  accounts that reported
 * @param {number} shown     accounts with a limit that still applies
 */
export function limitsNote(view, accounts, shown) {
  // A teammate watching with the view link gets no limits (they are the host's): no hint to install anything.
  if (['viewer', 'person'].includes(view.serverSettings.team?.role)) return NO_READING.viewer;
  if (view.mode === 'demo') return NO_READING.demo;
  if (!accounts) return NO_READING.none;
  return shown ? '' : NO_READING.empty;
}

/**
 * One limit's row: its name and figure, the meter, and the words under it.
 * @param {Gauge} gauge
 */
function gaugeRow(gauge) {
  const bar = meter('limit-meter');
  bar.update(gauge);
  return h('li', { class: 'hud-limit', 'data-testid': 'limit-gauge', 'data-kind': gauge.kind, 'data-level': gauge.level },
    h('p', { class: 'hud-limit__head' }, h('span', { class: 'hud-limit__name', text: gauge.name }), h('span', { class: 'hud-limit__figure', text: gauge.used })),
    bar.el,
    h('p', { class: 'hud-limit__when', text: `${gauge.asOf}, ${gauge.resets}` }),
    gauge.projection ? h('p', { class: 'hud-limit__projection', text: gauge.projection }) : null);
}

/**
 * The "Plan limits" section of the Usage dialog.
 * @param {HudContext} ctx
 */
export function createLimitsSection(ctx) {
  const list = h('div', { class: 'hud-limits' });
  const note = h('p', { class: 'hud-dialog__note', 'data-testid': 'limits-note' });
  const el = h('section', { class: 'hud-usage__section', 'aria-labelledby': 'hud-limits-title' }, h('h3', { class: 'hud-usage__heading', id: 'hud-limits-title', text: 'Plan limits' }), list, note);
  return {
    el,
    /** @param {number} now */
    render(now) {
      const accounts = ctx.view.limits ?? [];
      const shown = accounts.map((account) => ({ account, gauges: limitGauges(account.limits, now) })).filter((row) => row.gauges.length > 0);
      // Two Claude accounts on this computer: each list is headed by its config folder's name.
      list.replaceChildren(...shown.map(({ account, gauges }) => h('div', { class: 'hud-limits__account' },
        shown.length > 1 ? h('h4', { class: 'hud-limits__label', text: account.label ?? 'Default Claude folder' }) : null,
        h('ul', { class: 'hud-limits__list' }, ...gauges.map(gaugeRow)))));
      const words = limitsNote(ctx.view, accounts.length, shown.length);
      setText(note, words);
      setHidden(note, !words);
    },
  };
}
