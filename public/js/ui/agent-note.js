// "Send a note" in the agent inspector (CONTRACTS §4.15): the owner writes a note for this agent,
// which the server keeps until the agent's next step and the agent then reads with it (never in
// the terminal). Under the field, this agent's latest notes and where each is: queued, handed to
// the agent with the hook that carried it, or expired. Only in a live town, for the owner, and
// only for agents on this computer: never a teammate's crew in a team town.
import { h, renderList, setHidden, setText } from './dom.js';
import { icon } from './icons.js';
import { formatAgo } from './format.js';
import { MAX_NOTE_CHARS, noteStateText } from '../core/notes.js';
import { agentKeyOf } from '../core/ids.js';

/** @typedef {import('./types.js').HudContext} HudContext */
/** @typedef {import('./types.js').StoreState} StoreState */
/** @typedef {import('./types.js').AgentState} AgentState */
/** @typedef {import('../core/notes.js').Note} Note */

const NOTES_SHOWN = 3;
/** How long a sent note waits for the server's answer before the field is given back. */
const REPLY_TIMEOUT_MS = 10_000;

/**
 * Whether the inspector offers a note to this agent, and if not, why (null: say nothing).
 * @param {import('./types.js').ViewState} view
 * @param {AgentState} agent
 * @param {import('./types.js').Session|undefined} session
 * @returns {{ ok: boolean, why: string|null }}
 */
export function noteOffer(view, agent, session) {
  if (view.mode !== 'live' || view.serverSettings.team?.role === 'viewer') return { ok: false, why: null };
  if (session?.member) return { ok: false, why: `Notes go only to your own agents: this crew is ${session.member}'s.` };
  if (agent.status === 'done' || session?.status === 'ended') return { ok: false, why: 'This agent has finished: a note would not reach it.' };
  return { ok: true, why: null };
}

/**
 * What to know about a note to this agent ('' for nothing): when Codex takes it (its docs), or
 * that a helper's delivery is not confirmed.
 * @param {AgentState} agent
 * @param {import('./types.js').Session|undefined} session
 */
export function noteCaution(agent, session) {
  if (session?.source === 'codex') return 'Codex adds a note at its next safe point, or with the next turn when it is idle; a note still waiting when the session ends is dropped.';
  if (agent.agentId !== null) return 'A helper may not read notes yet: Andary has not confirmed that a helper’s background hooks pass them on.';
  return '';
}

/** @param {HudContext} ctx */
export function createNoteSection(ctx) {
  const id = 'hud-agent-note';
  const field = /** @type {HTMLTextAreaElement} */ (h('textarea', { class: 'hud-input hud-note-field', id, rows: '3', maxlength: String(MAX_NOTE_CHARS), spellcheck: 'true', 'aria-describedby': `${id}-help`, 'data-testid': 'send-note-input' }));
  const help = h('p', { class: 'hud-note-help', id: `${id}-help`, text: 'It arrives at the agent’s next step (its next tool call or your next prompt), not in your terminal. Andary keeps it for 30 minutes. Ctrl+Enter (⌘+Enter on a Mac) sends it.' });
  const caution = h('p', { class: 'hud-note-help', 'data-testid': 'send-note-caution', hidden: true });
  const send = /** @type {HTMLButtonElement} */ (h('button', { type: 'button', class: 'hud-btn hud-btn--small', 'data-testid': 'send-note' }, icon('mail', { size: 16 }), 'Send note'));
  const why = h('p', { class: 'hud-note-help', 'data-testid': 'send-note-why', hidden: true });
  // While a note waits for the server's answer, and why it was refused: the text stays until it is queued.
  const status = h('p', { class: 'hud-note-help hud-note-status', 'data-testid': 'send-note-status', hidden: true });
  const list = h('ul', { class: 'hud-note-list', 'data-testid': 'sent-notes' });
  const form = h('div', { class: 'hud-note-form' }, h('label', { for: id, text: 'Note for this agent' }), field, help, caution, send, status);
  const el = h('div', {}, form, why, list);
  /** @type {{ sessionId: string, agentId: string|null }|null} */
  let target = null;
  /** The note waiting for the server's answer. @type {{ ref: string, timer: ReturnType<typeof setTimeout> }|null} */
  let pending = null;
  let sent = 0;

  /** @param {string} text @param {boolean} [error] */
  function showStatus(text, error = false) {
    setText(status, text);
    status.classList.toggle('is-error', error);
    setHidden(status, !text);
  }

  /** Ends the wait: the field can be edited and sent again. */
  function settle() {
    if (pending) clearTimeout(pending.timer);
    pending = null;
    field.readOnly = false;
    send.disabled = false;
  }

  function submit() {
    const text = field.value.trim();
    if (!target || !text || pending) return;
    sent += 1;
    const ref = `note-${Date.now().toString(36)}-${sent}`;
    if (!ctx.controls.sendNote(target.sessionId, target.agentId, text, ref)) {
      showStatus('Not connected to Andary: the note was not sent. Your text is kept.', true);
      return;
    }
    field.readOnly = true;
    send.disabled = true;
    showStatus('Sending…');
    pending = { ref, timer: setTimeout(() => {
      settle();
      showStatus('Andary did not answer: the note may not have been sent. Your text is kept.', true);
    }, REPLY_TIMEOUT_MS) };
  }
  send.addEventListener('click', submit);
  // Ctrl or Cmd + Enter sends; Enter alone is a new line.
  field.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey) && !event.isComposing) {
      event.preventDefault();
      submit();
    }
  });

  return {
    el,
    /**
     * The server's answer to the note being sent: queued (the field empties) or refused (the
     * text stays, with the reason). Answers to other notes are ignored.
     * @param {{ ref: string|null, ok: boolean, error?: string }} answer
     */
    reply(answer) {
      if (!pending || answer.ref !== pending.ref) return;
      settle();
      if (answer.ok) {
        field.value = '';
        showStatus('');
        ctx.announcer.polite('Queued: it reaches the agent at its next step.');
        return;
      }
      const why = answer.error ?? 'The note was not sent.';
      showStatus(`${why} Your text is kept.`, true);
      ctx.announcer.polite(why);
    },
    /**
     * @param {StoreState} state @param {AgentState} agent @param {import('./types.js').Session|undefined} session
     * @returns {boolean} whether the section shows anything
     */
    update(state, agent, session) {
      const offer = noteOffer(ctx.view, agent, session);
      target = offer.ok ? { sessionId: agent.sessionId, agentId: agent.agentId } : null;
      if (!offer.ok && form.contains(document.activeElement)) field.blur();
      setHidden(form, !offer.ok);
      setText(why, offer.why ?? '');
      setHidden(why, !offer.why);
      const cautionText = offer.ok ? noteCaution(agent, session) : '';
      setText(caution, cautionText);
      setHidden(caution, !cautionText);
      const notes = (state.notes ?? []).filter((note) => agentKeyOf(note.sessionId, note.agentId) === agent.key).slice(-NOTES_SHOWN).reverse();
      renderList(list, notes, (note) => note.id, noteItem, updateNoteItem);
      setHidden(list, !notes.length || ctx.view.mode !== 'live');
      return offer.ok || Boolean(offer.why) || notes.length > 0;
    },
    /** @param {number} now */
    tick(now) {
      for (const item of list.children) {
        const time = item.querySelector('time');
        if (time) setText(time, formatAgo(Number(/** @type {HTMLElement} */ (item).dataset.ts), now, { short: true }));
      }
    },
  };
}

/** @param {Note} note */
function noteItem(note) {
  const item = h('li', { class: 'hud-note-item', 'data-testid': 'sent-note' },
    h('span', { class: 'hud-note-item__state' }),
    h('span', { class: 'hud-note-item__text', text: note.text }),
    h('time', { class: 'hud-recent__time' }));
  updateNoteItem(item, note);
  return item;
}

/** @param {HTMLElement} item @param {Note} note */
function updateNoteItem(item, note) {
  item.dataset.status = note.status;
  const at = note.deliveredAt ?? note.createdAt;
  item.dataset.ts = String(at);
  setText(/** @type {HTMLElement} */ (item.querySelector('.hud-note-item__state')), noteStateText(note));
  const time = /** @type {HTMLElement} */ (item.querySelector('time'));
  time.setAttribute('datetime', new Date(at).toISOString());
  setText(time, formatAgo(at, Date.now(), { short: true }));
}
