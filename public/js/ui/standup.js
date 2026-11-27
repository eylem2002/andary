// Catch me up as a standup or end-of-day note (core/handoff.js standupMarkdown): the dialog's
// lines, with what each crew has cost so far, copied as Markdown. "Today" asks the town for
// everything since midnight on this computer's clock. Nothing is sent: it goes to your clipboard.
import { h, setHidden, setText } from './dom.js';
import { copyButton, copyText } from './copy.js';
import { standupMarkdown } from '../core/handoff.js';

/** @typedef {import('./types.js').HudContext} HudContext */
/** @typedef {import('./types.js').StoreState} StoreState */
/** @typedef {import('./catch-up.js').CatchUpRow} CatchUpRow */

/**
 * Local midnight today, on this computer's clock.
 * @param {number} now
 */
export function startOfDay(now) {
  const day = new Date(now);
  day.setHours(0, 0, 0, 0);
  return day.getTime();
}

/**
 * What a crew has cost so far, all its agents together (an estimate), or null when unknown.
 * @param {StoreState} state @param {string} sessionId
 */
export function crewCost(state, sessionId) {
  let total = 0;
  let known = false;
  for (const [key, usage] of Object.entries(state.usage ?? {})) {
    if (!key.startsWith(`${sessionId}:`) || !Number.isFinite(usage.costUsd)) continue;
    total += usage.costUsd;
    known = true;
  }
  return known ? total : null;
}

/**
 * The note's Markdown from the dialog's lines.
 * @param {StoreState} state
 * @param {{ rows: CatchUpRow[], quiet: string[] }} lines
 * @param {{ today: boolean, period: string, now: number }} options
 */
export function standupText(state, { rows, quiet }, { today, period, now }) {
  const date = new Date(now).toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
  return standupMarkdown({
    title: today ? `Standup: ${date}` : `What my crews did (${date})`,
    period,
    crews: rows.map((row) => ({ name: row.name, words: row.words, said: row.said, need: row.item?.text ?? null, costUsd: crewCost(state, row.sessionId) })),
    quiet,
  });
}

/**
 * The dialog's foot: the two periods to choose from, and the copy button with a preview.
 * @param {HudContext} ctx
 * @param {{ onScope: (today: boolean) => void }} options
 */
export function createStandup(ctx, { onScope }) {
  const looked = h('button', { type: 'button', class: 'hud-btn hud-btn--primary hud-btn--small', 'data-testid': 'catch-up-scope-looked', 'aria-pressed': 'true', on: { click: () => onScope(false) } }, 'Since I last looked');
  const today = h('button', { type: 'button', class: 'hud-btn hud-btn--primary hud-btn--small', 'data-testid': 'catch-up-scope-today', 'aria-pressed': 'false', on: { click: () => onScope(true) } }, 'Today');
  const copy = copyButton('Copy as Markdown', { 'data-testid': 'catch-up-copy' });
  const preview = h('pre', { class: 'hud-handoff__preview hud-mono', 'data-testid': 'catch-up-markdown' });
  const details = h('details', { class: 'hud-handoff__details' }, h('summary', { text: 'Show the Markdown' }), preview);
  const foot = h('div', { class: 'hud-catchup__foot', hidden: true },
    h('div', { class: 'hud-handoff__actions' }, h('div', { class: 'hud-handoff__actions', role: 'group', 'aria-label': 'Period' }, looked, today), copy),
    details,
    h('p', { class: 'hud-handoff__note', text: 'For a standup or the end of the day: it goes to your clipboard only.' }));
  copy.addEventListener('click', () => {
    const text = preview.textContent ?? '';
    if (text) copyText(ctx, { text, button: copy, shown: preview, spoken: 'Copied the summary as Markdown.' });
  });
  return {
    el: foot,
    /** @param {boolean} isToday */
    setScope(isToday) {
      looked.setAttribute('aria-pressed', String(!isToday));
      today.setAttribute('aria-pressed', String(isToday));
    },
    /** The Markdown for what is on show; '' hides the copy. @param {string} text */
    show(text) {
      setText(preview, text);
      setHidden(foot, !text);
    },
  };
}
