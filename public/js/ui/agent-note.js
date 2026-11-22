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
 * A caution for agents whose hooks have not been seen to deliver a note yet ('' for none).
 * @param {AgentState} agent
 * @param {import('./types.js').Session|undefined} session
 */
export function noteCaution(agent, session) {
  const helper = agent.agentId !== null;
  const codex = session?.source === 'codex';
  if (!helper && !codex) return '';
  return `${codex ? 'Codex' : 'A helper'} may not read notes yet: Andary has not confirmed that ${codex ? 'its' : 'a helper’s'} background hooks pass them on.`;
}

/** @param {HudContext} ctx */
export function createNoteSection(ctx) {
  const id = 'hud-agent-note';
  const field = /** @type {HTMLTextAreaElement} */ (h('textarea', { class: 'hud-input hud-note-field', id, rows: '3', maxlength: String(MAX_NOTE_CHARS), spellcheck: 'true', 'aria-describedby': `${id}-help`, 'data-testid': 'send-note-input' }));
  const help = h('p', { class: 'hud-note-help', id: `${id}-help`, text: 'It arrives at the agent’s next step (its next tool call or your next prompt), not in your terminal. Andary keeps it for 30 minutes.' });
  const caution = h('p', { class: 'hud-note-help', 'data-testid': 'send-note-caution', hidden: true });
  const send = h('button', { type: 'button', class: 'hud-btn hud-btn--small', 'data-testid': 'send-note' }, icon('mail', { size: 16 }), 'Send note');
  const why = h('p', { class: 'hud-note-help', 'data-testid': 'send-note-why', hidden: true });
  const list = h('ul', { class: 'hud-note-list', 'data-testid': 'sent-notes' });
  const form = h('div', { class: 'hud-note-form' }, h('label', { for: id, text: 'Note for this agent' }), field, help, caution, send);
  const el = h('div', {}, form, why, list);
  /** @type {{ sessionId: string, agentId: string|null }|null} */
  let target = null;

  function submit() {
    const text = field.value.trim();
    if (!target || !text) return;
    if (!ctx.controls.sendNote(target.sessionId, target.agentId, text)) {
      ctx.toasts.show({ tone: 'error', icon: 'warning', title: 'Not connected to Andary', body: 'The note was not sent.' });
      return;
    }
    field.value = '';
    ctx.announcer.polite('Note sent. It reaches the agent at its next step.');
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
