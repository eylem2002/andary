// The leaderboard: how far the town has grown and what it builds next, the busy-day streak, the
// day's records (fastest fix, most test runs turned green) and the busiest agents in town.
import { nextMilestone, MILESTONES } from '../core/growth.js';
import { busiestAgents, createRecords, streakOf } from '../core/records.js';
import { createDialog } from './dialogs.js';
import { h, setAttr, setHidden, setText } from './dom.js';
import { formatDuration, plural } from './format.js';
import { roundel } from './parts.js';

/** @typedef {import('./types.js').HudContext} HudContext */
/** @typedef {import('./types.js').StoreState} StoreState */

/**
 * The town section's words: points and what comes next.
 * @param {number} points
 */
export function growthText(points) {
  const next = nextMilestone(points);
  if (!next) return `${plural(points, 'point')}: every landmark is built.`;
  const name = next.milestone.name.charAt(0).toLowerCase() + next.milestone.name.slice(1);
  return `${plural(points, 'point')}. Next: ${name} ${next.milestone.where}, in ${plural(next.left, 'point')}.`;
}

/**
 * "Builder 1 in api-server", or a fallback for an agent who has left.
 * @param {StoreState} state
 * @param {string} agentKey
 */
export function holderName(state, agentKey) {
  const agent = state.agents[agentKey];
  if (!agent) return 'an agent who has gone home';
  const session = state.sessions.find((s) => s.id === agent.sessionId);
  return session ? `${agent.name} in ${session.title || session.project}` : agent.name;
}

/** @param {HudContext} ctx */
export function createLeaderboard(ctx) {
  let records = createRecords();
  ctx.store.subscribe((change) => {
    if (change.type === 'reset') records = createRecords();
    if (change.type === 'event') records.observe(/** @type {any} */ (change.event));
  });

  const growth = h('p', { class: 'hud-board__growth', 'data-testid': 'growth-text' });
  const bar = h('div', { class: 'hud-board__bar', role: 'progressbar', 'aria-label': 'Points to the next landmark', 'aria-valuemin': '0' }, h('span', { class: 'hud-board__fill' }));
  const streak = h('p', { class: 'hud-board__streak' });
  const fastest = h('dd', {});
  const greens = h('dd', {});
  const facts = h('dl', { class: 'hud-board__facts' },
    h('div', {}, h('dt', { text: 'Fastest fix' }), fastest),
    h('div', {}, h('dt', { text: 'Most test runs turned green' }), greens));
  const ranks = h('ol', { class: 'hud-board__ranks', 'data-testid': 'leaderboard-ranks' });
  const noRanks = h('p', { class: 'hud-board__empty', text: 'Nobody has used a tool yet.' });
  const dialog = createDialog({
    id: 'hud-leaderboard',
    title: 'Leaderboard',
    body: [
      h('section', { class: 'hud-board__section', 'aria-labelledby': 'hud-board-town' }, h('h3', { class: 'hud-board__heading', id: 'hud-board-town', text: 'Your town' }), growth, bar, streak),
      h('section', { class: 'hud-board__section', 'aria-labelledby': 'hud-board-records' }, h('h3', { class: 'hud-board__heading', id: 'hud-board-records', text: 'Records since Andary started' }), facts),
      h('section', { class: 'hud-board__section', 'aria-labelledby': 'hud-board-busy' }, h('h3', { class: 'hud-board__heading', id: 'hud-board-busy', text: 'Busiest agents in town' }), ranks, noRanks),
    ],
  });

  function render() {
    const state = ctx.store.getState();
    const points = ctx.view.progress?.points ?? 0;
    setText(growth, growthText(points));
    const next = nextMilestone(points);
    const previous = [...MILESTONES].reverse().find((m) => m.points <= points)?.points ?? 0;
    const span = next ? next.milestone.points - previous : 1;
    const done = next ? points - previous : 1;
    setAttr(bar, 'aria-valuemax', String(span));
    setAttr(bar, 'aria-valuenow', String(done));
    setAttr(bar, 'aria-valuetext', next ? `${done} of ${span}` : 'All built');
    /** @type {HTMLElement} */ (bar.firstElementChild).style.transform = `scaleX(${Math.min(1, done / span).toFixed(3)})`;
    const days = streakOf(ctx.view.progress?.days ?? [], Date.now());
    setText(streak, days ? `Busy ${plural(days, 'day')} in a row.` : 'No busy days yet.');
    const snapshot = records.snapshot();
    setText(fastest, snapshot.fastest ? `${formatDuration(snapshot.fastest.ms)}, by ${holderName(state, snapshot.fastest.agentKey)}` : 'No failing tests fixed yet');
    const [top] = snapshot.greens;
    setText(greens, top ? `${holderName(state, top[0])}, ${plural(top[1], 'time')}` : 'None yet');
    const rows = busiestAgents(state);
    setHidden(noRanks, rows.length > 0);
    ranks.replaceChildren(...rows.map(({ agent, calls, changes }, i) => {
      const session = state.sessions.find((s) => s.id === agent.sessionId);
      const number = state.sessions.indexOf(/** @type {any} */ (session)) + 1;
      return h('li', { class: 'hud-board__rank' },
        h('span', { class: 'hud-board__place', text: String(i + 1) }),
        roundel(number, session?.color ?? agent.color),
        h('span', { class: 'hud-board__who' }, h('strong', { text: agent.name }), h('span', { text: session ? ` in ${session.title || session.project}` : '' })),
        h('span', { class: 'hud-board__score', text: `${plural(calls, 'tool call')}${changes ? `, ${plural(changes, 'file change')}` : ''}` }));
    }));
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
