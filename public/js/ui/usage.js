// The cost meter: tokens and estimated cost per agent and per crew, and a "Usage" dialog with
// today's total, the last 14 days as a bar chart (with the same numbers in a table for screen
// readers) and today's crews. Costs are estimates at API list prices (core/prices.js).
// Also each agent's context in use, as tokens only: the window it fills is not known (today's
// default models run 1M, the user may move the compaction point), so there is no percentage.
import { createDialog } from './dialogs.js';
import { h, setHidden, setText } from './dom.js';
import { formatAgo } from './format.js';
import { localDateBefore } from '../core/dates.js';
import { agentKeyOf } from '../core/ids.js';

/** @typedef {import('./types.js').HudContext} HudContext */
/** @typedef {import('./types.js').StoreState} StoreState */
/** @typedef {import('./types.js').AgentUsage} AgentUsage */

/**
 * "$0.42", "$12", "<$0.01".
 * @param {number} usd
 */
export function formatCost(usd) {
  if (!Number.isFinite(usd) || usd <= 0) return '$0';
  if (usd < 0.01) return '<$0.01';
  if (usd < 10) return `$${usd.toFixed(2)}`;
  if (usd < 1000) return `$${usd.toFixed(1).replace(/\.0$/, '')}`;
  return `$${Math.round(usd).toLocaleString('en-US')}`;
}

/**
 * "950", "34k", "1.2M".
 * @param {number} n
 */
export function formatTokens(n) {
  if (!Number.isFinite(n) || n <= 0) return '0';
  if (n < 1000) return String(Math.round(n));
  if (n < 1e6) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0).replace(/\.0$/, '')}k`;
  return `${(n / 1e6).toFixed(n < 1e7 ? 1 : 0).replace(/\.0$/, '')}M`;
}

/** @param {AgentUsage['tokens']} tokens */
export function totalTokens(tokens) {
  return tokens.input + tokens.output + tokens.cacheRead + tokens.cacheWrite;
}

/**
 * True once anything was counted. A record can carry a context reading alone: a resumed
 * session's first messages are copies, already counted for the session they came from.
 * @param {AgentUsage} usage
 */
export function hasCounted(usage) {
  return usage.costUsd > 0 || totalTokens(usage.tokens) > 0;
}

/**
 * A crew's usage: the sum over its agents.
 * @param {StoreState} state
 * @param {string} sessionId
 * @returns {AgentUsage|null}
 */
export function crewUsage(state, sessionId) {
  /** @type {AgentUsage|null} */
  let sum = null;
  for (const [key, usage] of Object.entries(state.usage ?? {})) {
    if (!key.startsWith(`${sessionId}:`)) continue;
    // Each agent has a context of its own: there is no crew total of it.
    sum ??= { tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, costUsd: 0, unpriced: false, model: usage.model, context: null };
    sum.tokens.input += usage.tokens.input;
    sum.tokens.output += usage.tokens.output;
    sum.tokens.cacheRead += usage.tokens.cacheRead;
    sum.tokens.cacheWrite += usage.tokens.cacheWrite;
    sum.costUsd += usage.costUsd;
    sum.unpriced ||= usage.unpriced;
  }
  return sum;
}

/**
 * What a crew line shows: "$0.42", or the tokens when no price is known.
 * @param {AgentUsage|null} usage
 */
export function usageShort(usage) {
  if (!usage || !hasCounted(usage)) return '';
  if (usage.costUsd > 0) return formatCost(usage.costUsd);
  return `${formatTokens(totalTokens(usage.tokens))} tokens`;
}

/**
 * An agent's context reading while it can still be true. A finished helper's or an ended
 * crew's last reading describes a context that is gone, so it is not shown: a finished helper
 * stays listed for a while, an ended crew's agents leave the store. (A compaction drops the
 * reading where it is read, on the server or in the demo: none here is older than one.)
 * @param {StoreState} state
 * @param {string} agentKey
 * @returns {AgentUsage['context']}
 */
export function liveContext(state, agentKey) {
  const context = state.usage?.[agentKey]?.context ?? null;
  const agent = state.agents[agentKey];
  return context && agent && agent.status !== 'done' ? context : null;
}

/**
 * What a crew line shows under the model: its lead's context, "182k in context".
 * @param {StoreState} state
 * @param {string} sessionId
 */
export function crewContext(state, sessionId) {
  const context = liveContext(state, agentKeyOf(sessionId, null));
  return context ? `${formatTokens(context.tokens)} in context` : '';
}

/**
 * The inspector's sentence: the exact count and when the message that used it was written,
 * "182,340 tokens in context, read 2m ago."
 * @param {NonNullable<AgentUsage['context']>} context
 * @param {number} now
 */
export function contextSentence(context, now) {
  const count = `${context.tokens.toLocaleString('en-US')} ${context.tokens === 1 ? 'token' : 'tokens'}`;
  return `${count} in context, read ${formatAgo(context.at, now)}.`;
}

/**
 * The inspector's sentence about an agent's usage.
 * @param {AgentUsage} usage
 */
export function usageSentence(usage) {
  const parts = [`${formatTokens(usage.tokens.input + usage.tokens.cacheWrite)} tokens in`, `${formatTokens(usage.tokens.output)} out`];
  if (usage.tokens.cacheRead) parts.push(`${formatTokens(usage.tokens.cacheRead)} read from cache`);
  const cost = usage.costUsd > 0 ? `About ${formatCost(usage.costUsd)} at API prices${usage.unpriced ? ' (some of it from a model without a known price)' : ''}.` : 'No price is known for this model.';
  return `${parts.join(', ')}. ${cost}`;
}

/**
 * The last `count` days, oldest first, with empty days filled in.
 * @param {{ date: string, tokens: number, costUsd: number }[]} days
 * @param {number} todayMs
 * @param {number} [count]
 */
export function lastDays(days, todayMs, count = 14) {
  const byDate = new Map(days.map((day) => [day.date, day]));
  const out = [];
  for (let back = count - 1; back >= 0; back -= 1) {
    const date = localDateBefore(todayMs, back);
    out.push(byDate.get(date) ?? { date, tokens: 0, costUsd: 0 });
  }
  return out;
}

const SVG = 'http://www.w3.org/2000/svg';

/** @param {HudContext} ctx */
export function createUsageDialog(ctx) {
  const total = h('p', { class: 'hud-usage__total' });
  const note = h('p', { class: 'hud-dialog__note' });
  const chart = document.createElementNS(SVG, 'svg');
  chart.setAttribute('class', 'hud-usage__chart');
  chart.setAttribute('aria-hidden', 'true');
  // The chart's numbers, for everyone: a table behind a disclosure.
  const table = h('table', { class: 'hud-usage__table' });
  const numbers = h('details', { class: 'hud-usage__numbers' }, h('summary', { text: 'Numbers by day' }), table);
  const crews = h('ul', { class: 'hud-usage__crews' });
  const crewsBox = h('section', { class: 'hud-usage__section' }, h('h3', { class: 'hud-usage__heading', text: 'Crews in town' }), crews);
  const dialog = createDialog({
    id: 'hud-usage',
    title: 'Usage',
    body: [total, h('section', { class: 'hud-usage__section' }, h('h3', { class: 'hud-usage__heading', text: 'Last 14 days' }), chart, numbers), crewsBox, note],
  });

  function render() {
    const state = ctx.store.getState();
    const days = lastDays(state.usageDays ?? [], Date.now());
    const today = days.at(-1) ?? { tokens: 0, costUsd: 0 };
    setText(total, `Today: ${formatCost(today.costUsd)}, ${formatTokens(today.tokens)} tokens`);
    setText(note, ctx.view.mode === 'demo'
      ? 'The demo makes these numbers up. With your own Claude Code, Andary reads them from its transcripts on your computer.'
      : 'Estimated at API list prices from Claude Code\'s transcripts on this computer. On a Pro or Max plan you pay for the plan, not per token.');
    drawChart(chart, days);
    table.replaceChildren(h('caption', { class: 'hud-sr', text: 'Estimated cost per day' }), h('tbody', {}, ...days.slice().reverse().map((day) => h('tr', {}, h('th', { scope: 'row', text: day.date }), h('td', { text: `${formatCost(day.costUsd)}, ${formatTokens(day.tokens)} tokens` })))));
    const rows = state.sessions.filter((session) => session.status !== 'ended').map((session) => ({ session, usage: crewUsage(state, session.id) })).filter((row) => row.usage && hasCounted(row.usage));
    setHidden(crewsBox, !rows.length);
    crews.replaceChildren(...rows.map(({ session, usage }) => h('li', { class: 'hud-usage__crew' },
      h('span', { class: 'hud-usage__crew-name', text: session.title || session.project }),
      h('span', { class: 'hud-usage__crew-cost', text: `${usageShort(usage)}, ${formatTokens(totalTokens(/** @type {AgentUsage} */ (usage).tokens))} tokens` }))));
  }

  return {
    el: dialog.el,
    close: dialog.close,
    get isOpen() {
      return dialog.isOpen;
    },
    render() {
      if (dialog.isOpen) render();
    },
    open() {
      render();
      dialog.open();
    },
  };
}

/**
 * Fourteen bars, today's in the sign colour, with day initials under them.
 * @param {SVGSVGElement} svg
 * @param {{ date: string, costUsd: number }[]} days
 */
function drawChart(svg, days) {
  const width = 14 * 32;
  const height = 120;
  svg.setAttribute('viewBox', `0 0 ${width} ${height + 20}`);
  const max = Math.max(0.01, ...days.map((day) => day.costUsd));
  const nodes = days.map((day, i) => {
    const barHeight = Math.max(day.costUsd > 0 ? 2 : 0, (day.costUsd / max) * (height - 16));
    const bar = document.createElementNS(SVG, 'rect');
    bar.setAttribute('x', String(i * 32 + 6));
    bar.setAttribute('y', String(height - barHeight));
    bar.setAttribute('width', '20');
    bar.setAttribute('height', String(barHeight));
    bar.setAttribute('rx', '3');
    bar.setAttribute('class', i === days.length - 1 ? 'hud-usage__bar hud-usage__bar--today' : 'hud-usage__bar');
    const label = document.createElementNS(SVG, 'text');
    label.setAttribute('x', String(i * 32 + 16));
    label.setAttribute('y', String(height + 15));
    label.setAttribute('class', 'hud-usage__day');
    label.textContent = 'SMTWTFS'[new Date(`${day.date}T12:00:00`).getDay()];
    return [bar, label];
  });
  svg.replaceChildren(...nodes.flat());
}
