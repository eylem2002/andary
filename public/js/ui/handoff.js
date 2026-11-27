// The agent details' "Hand off" section (core/handoff.js): copy the command that resumes the crew's
// session in its folder, and copy a Markdown handoff of the crew (its goal, files touched, tests,
// open warnings, to-dos and the last words of its latest turns) to paste into another agent, a pull
// request or a teammate's chat. Built from what the town holds when you click; nothing is sent.
import { h, setHidden, setText } from './dom.js';
import { copyButton, copyText } from './copy.js';
import { handoffMarkdown, resumeCommand } from '../core/handoff.js';
import { reviewWarnings } from '../core/review.js';

/** @typedef {import('./types.js').HudContext} HudContext */
/** @typedef {import('./types.js').StoreState} StoreState */
/** @typedef {import('./types.js').Session} Session */
/** @typedef {import('./types.js').AgentState} AgentState */

/**
 * What a handoff lists as open: what the crew needs you for now (not a turn that merely finished), and what its latest turn left to
 * look at again (a missing test, a failed one, another crew in the folder…), each once.
 * @param {HudContext} ctx @param {StoreState} state @param {Session} session
 */
function openWarnings(ctx, state, session) {
  // A finished turn waiting for your next prompt is no warning.
  const needs = ctx.needsYou.items(state)
    .filter((item) => item.kind !== 'finished' && (item.sessionId === session.id || item.agentKeys.some((key) => state.agents[key]?.sessionId === session.id)))
    .map((item) => item.text);
  const latest = state.receipts.findLast((r) => r.sessionId === session.id);
  const turn = latest ? reviewWarnings([latest], latest.test) : [];
  return [...new Set([...needs, ...turn])];
}

/**
 * The crew's handoff as Markdown, now.
 * @param {HudContext} ctx @param {StoreState} state @param {Session} session
 */
export function crewHandoff(ctx, state, session) {
  const lead = session.agentKeys.map((key) => state.agents[key]).find((agent) => agent?.role === 'lead');
  return handoffMarkdown({
    session,
    receipts: state.receipts.filter((r) => r.sessionId === session.id),
    warnings: openWarnings(ctx, state, session),
    lastMessage: lead?.lastMessage ?? null,
  });
}

/** @param {HudContext} ctx */
export function createHandoffSection(ctx) {
  const command = h('code', { class: 'hud-mono hud-steps__code', 'data-testid': 'handoff-resume' });
  const copyResume = copyButton('Copy', { 'data-testid': 'handoff-copy-resume', 'aria-label': 'Copy the resume command' });
  const resumeRow = h('div', { class: 'hud-steps__command' }, command, copyResume);
  const copyHandoff = copyButton('Copy handoff', { 'data-testid': 'handoff-copy' });
  const preview = h('pre', { class: 'hud-handoff__preview hud-mono', 'data-testid': 'handoff-preview' });
  const details = /** @type {HTMLDetailsElement} */ (h('details', { class: 'hud-handoff__details' }, h('summary', { text: 'Show the handoff' }), preview));
  const el = h('div', { class: 'hud-handoff' },
    resumeRow,
    h('p', { class: 'hud-handoff__note', text: 'The handoff quotes your prompt and the agent\'s words. It goes to your clipboard only.' }),
    h('div', { class: 'hud-handoff__actions' }, copyHandoff),
    details);
  /** @type {Session|null} */
  let session = null;

  const now = () => (session ? crewHandoff(ctx, ctx.store.getState(), session) : '');
  copyResume.addEventListener('click', () => {
    const text = command.textContent ?? '';
    if (text) copyText(ctx, { text, button: copyResume, shown: command, spoken: 'Copied the resume command.' });
  });
  copyHandoff.addEventListener('click', () => {
    const text = now();
    setText(preview, text);
    if (text) copyText(ctx, { text, button: copyHandoff, shown: preview, spoken: 'Copied the handoff as Markdown.' });
  });
  details.addEventListener('toggle', () => details.open && setText(preview, now()));

  return {
    el,
    /**
     * @param {StoreState} state @param {Session|null|undefined} next
     * @returns {boolean} whether there is a crew to hand off
     */
    update(state, next) {
      session = next ?? null;
      if (!session) return false;
      // A teammate's session resumes on their computer, not this one.
      const resume = session.member ? null : resumeCommand(session);
      setText(command, resume ?? '');
      setHidden(resumeRow, !resume);
      if (details.open) setText(preview, crewHandoff(ctx, state, session));
      return true;
    },
  };
}
