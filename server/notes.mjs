// Notes to agents (CONTRACTS §4.15, ADR 0018): the owner types a note for one of the agents on
// this computer; it waits here until that agent's next hook that can carry one (core/notes.js),
// whose signed reply hands it to the forwarder, which gives it to the agent as
// `additionalContext`. A note that waits too long, or whose agent finished, expires.
//
// Only agents this computer's forwarder told the server about can get a note: a teammate's
// (relayed through /api/team) never comes through here, so it can never be one. A forwarder that
// does not declare the `notes` capability (an older copy) would drop a note, so its agents get
// none, and the town says why.
import { randomUUID } from 'node:crypto';
import { carriesNotes, noteText } from '../public/js/core/notes.js';
import { normalizeAgentId } from '../public/js/core/ids.js';

/** The capability a forwarder declares when it can hand a note to its agent (CONTRACTS §4.3). */
export const NOTES_CAP = 'notes';
/** How long a note waits for its agent's next step. */
export const NOTE_TTL_MS = 30 * 60_000;
/** Notes waiting for one agent; past this, new ones are refused. */
export const MAX_QUEUED_PER_AGENT = 5;
/** Notes one hook's reply carries at most: the rest wait for the next. */
export const MAX_NOTES_PER_HOOK = 4;
const MAX_QUEUED = 100;
const MAX_SETTLED = 50;
const MAX_SESSIONS = 500;
const MAX_AGENTS_PER_SESSION = 100;

/** @typedef {import('../public/js/core/notes.js').Note} Note */

/**
 * What the server knows of a session from this computer's forwarder.
 * @typedef {object} Reach
 * @property {'claude'|'codex'} source
 * @property {boolean} notes        its forwarder declares the `notes` capability
 * @property {boolean} ended        SessionEnd came
 * @property {Map<string, boolean>} agents  helpers heard from (by normalised id): true once finished
 */

const OLD_FORWARDER = "This agent's Andary hook is from an older version and would drop the note: run andary install (or update the plugin), then restart the session";

/**
 * @param {unknown} value
 * @returns {string}
 */
const text = (value) => (typeof value === 'string' ? value : '');

/**
 * @typedef {object} NoteDeskOptions
 * @property {(note: Note) => void} [onChange]  a copy, on queue and on every change
 * @property {() => number} [now]
 * @property {number} [ttlMs]
 */

/**
 * @param {NoteDeskOptions} [options]
 */
export function createNoteDesk({ onChange = () => {}, now = Date.now, ttlMs = NOTE_TTL_MS } = {}) {
  /** @type {Map<string, Reach>} sessions by id, least recently heard from first */
  const sessions = new Map();
  /** @type {Note[]} oldest first */
  const queued = [];
  /** @type {Note[]} oldest first */
  const settled = [];

  const publish = (/** @type {Note} */ note) => onChange({ ...note });
  const forAgent = (/** @type {string} */ sessionId, /** @type {string|null} */ agentId) => (note) => note.sessionId === sessionId && note.agentId === agentId;

  /**
   * @param {Note} note
   * @param {Partial<Note>} patch
   */
  function settle(note, patch) {
    const index = queued.indexOf(note);
    if (index >= 0) queued.splice(index, 1);
    Object.assign(note, patch);
    settled.push(note);
    if (settled.length > MAX_SETTLED) settled.splice(0, settled.length - MAX_SETTLED);
    publish(note);
  }

  /**
   * @param {(note: Note) => boolean} match
   * @param {string} reason
   */
  function expireWhere(match, reason) {
    for (const note of queued.filter(match)) settle(note, { status: 'expired', reason });
  }

  /**
   * The session a hook came from, as the server last heard of it.
   * @param {string} id
   * @param {'claude'|'codex'} source
   * @param {boolean} notes
   */
  function reach(id, source, notes) {
    const known = sessions.get(id);
    sessions.delete(id);
    const session = known ?? { source, notes, ended: false, agents: new Map() };
    session.source = source;
    session.notes = notes;
    sessions.set(id, session);
    for (const old of [...sessions.keys()].slice(0, Math.max(0, sessions.size - MAX_SESSIONS))) {
      sessions.delete(old);
      expireWhere((note) => note.sessionId === old, 'Andary stopped following this session');
    }
    return session;
  }

  /**
   * @param {Reach} session @param {string} agentId @param {boolean} finished
   */
  function heardAgent(session, agentId, finished) {
    if (!session.agents.has(agentId) && session.agents.size >= MAX_AGENTS_PER_SESSION) return;
    session.agents.set(agentId, finished || session.agents.get(agentId) === true);
  }

  /**
   * Why a note cannot go to this agent, or '' when it can.
   * @param {Reach|undefined} session @param {string|null} agentId
   */
  function refusal(session, agentId) {
    if (!session) return 'Notes go only to agents on this computer that Andary has heard from';
    if (!session.notes) return OLD_FORWARDER;
    if (session.ended) return 'This session has ended';
    if (agentId === null) return '';
    const finished = session.agents.get(agentId);
    if (finished === undefined) return 'Andary has not heard from this helper on this computer';
    return finished ? 'This helper has finished' : '';
  }

  return {
    /**
     * A hook from this computer's forwarder (never a teammate's): who can get notes now.
     * @param {{ source: 'claude'|'codex', caps: string[], event: Record<string, any> }} body
     */
    heard(body) {
      const id = text(body.event.session_id);
      if (!id) return;
      const session = reach(id, body.source, body.caps.includes(NOTES_CAP));
      const hook = text(body.event.hook_event_name);
      const agentId = normalizeAgentId(body.event.agent_id);
      if (agentId !== null) heardAgent(session, agentId, hook === 'SubagentStop');
      if (hook === 'SessionEnd') {
        session.ended = true;
        expireWhere((note) => note.sessionId === id, 'the session ended');
      } else if (hook === 'SessionStart') {
        session.ended = false;
      }
      if (agentId !== null && hook === 'SubagentStop') expireWhere(forAgent(id, agentId), 'the helper finished');
      if (!session.notes) expireWhere((note) => note.sessionId === id, OLD_FORWARDER);
    },

    /**
     * A note from the owner's browser. `budget` is asked last, for a note that would be queued
     * (one refused for what it is costs nothing): false refuses it.
     * @param {{ sessionId?: unknown, agentId?: unknown, text?: unknown }} message
     * @param {() => boolean} [budget]
     * @returns {{ ok: true, note: Note } | { ok: false, error: string }}
     */
    send(message, budget = () => true) {
      const sessionId = text(message.sessionId);
      const agentId = message.agentId === undefined || message.agentId === null ? null : normalizeAgentId(message.agentId);
      if (!sessionId || (message.agentId != null && agentId === null)) return { ok: false, error: 'A note needs the session and, for a helper, its agent id' };
      const body = noteText(message.text);
      if (body === null) return { ok: false, error: 'A note can be at most 2,000 characters' };
      if (!body) return { ok: false, error: 'A note needs some text' };
      const why = refusal(sessions.get(sessionId), agentId);
      if (why) return { ok: false, error: why };
      if (queued.filter(forAgent(sessionId, agentId)).length >= MAX_QUEUED_PER_AGENT) return { ok: false, error: `This agent already has ${MAX_QUEUED_PER_AGENT} notes waiting` };
      if (queued.length >= MAX_QUEUED) return { ok: false, error: 'Too many notes are waiting' };
      if (!budget()) return { ok: false, error: 'Too many notes at once: wait a moment and send it again' };
      const at = now();
      /** @type {Note} */
      const note = { id: randomUUID(), status: 'queued', sessionId, agentId, text: body, createdAt: at, expiresAt: at + ttlMs };
      queued.push(note);
      publish(note);
      return { ok: true, note: { ...note } };
    },

    /**
     * The notes the reply to this hook carries (oldest first, at most MAX_NOTES_PER_HOOK); none
     * when it can carry none (its hook, or its forwarder). They leave the queue, so no other hook
     * takes them, until `sent` says whether the reply went out: true marks them delivered (sent
     * with this hook; nothing confirms the agent read them), false puts them back in the queue
     * (the forwarder had gone), or expires them if their agent can no longer get one.
     * @param {{ source: 'claude'|'codex', caps: string[], event: Record<string, any> }} body
     * @returns {{ texts: string[], sent: (ok: boolean) => void }}
     */
    take(body) {
      const hook = text(body.event.hook_event_name);
      if (!body.caps.includes(NOTES_CAP) || !carriesNotes(body.source, hook)) return { texts: [], sent: () => {} };
      this.sweep();
      const due = queued.filter(forAgent(text(body.event.session_id), normalizeAgentId(body.event.agent_id))).slice(0, MAX_NOTES_PER_HOOK);
      for (const note of due) queued.splice(queued.indexOf(note), 1);
      let done = false;
      return {
        texts: due.map((note) => note.text),
        sent(ok) {
          if (done) return;
          done = true;
          const at = now();
          if (ok) {
            for (const note of due) settle(note, { status: 'delivered', deliveredAt: at, hook });
            return;
          }
          queued.push(...due);
          queued.sort((a, b) => a.createdAt - b.createdAt);
          for (const note of due) {
            const why = refusal(sessions.get(note.sessionId), note.agentId);
            if (why) settle(note, { status: 'expired', reason: why });
          }
        },
      };
    },

    /** Expires the notes that waited too long. */
    sweep() {
      const at = now();
      expireWhere((note) => note.expiresAt <= at, 'the agent took no step in time');
    },

    /**
     * Queued notes (oldest first), then settled ones (oldest first), for a browser that joins.
     * @returns {Note[]}
     */
    list() {
      return [...queued, ...settled].map((note) => ({ ...note }));
    },
  };
}

/** @typedef {ReturnType<typeof createNoteDesk>} NoteDesk */
