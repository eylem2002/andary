// Notes to agents (CONTRACTS §4.15): what the owner may send an agent from the town, which hooks
// can carry one, and how the town words a note's progress. Pure, shared by the server (which
// checks and queues notes) and the HUD (which shows them). The forwarder, which stands alone,
// checks a note again with its own copy of noteText (hooks/hook.mjs).

/** The longest note, in characters. */
export const MAX_NOTE_CHARS = 2000;

/**
 * The hooks whose reply may carry notes, per agent: their output may hold
 * `hookSpecificOutput.additionalContext`, which the agent reads at its next step. Async hooks
 * deliver it on the next turn of the conversation; a PermissionRequest takes a decision only, and
 * a session's start and end carry nothing.
 * @type {Readonly<Record<'claude'|'codex', ReadonlySet<string>>>}
 */
export const NOTE_HOOKS = Object.freeze({
  claude: Object.freeze(new Set(['PreToolUse', 'PostToolUse', 'PostToolUseFailure', 'UserPromptSubmit'])),
  codex: Object.freeze(new Set(['PreToolUse', 'PostToolUse', 'UserPromptSubmit'])),
});

/**
 * Whether a hook of this agent can carry a note.
 * @param {unknown} source  'claude' or 'codex'
 * @param {unknown} hook    the hook's own event name, as the agent sent it
 */
export function carriesNotes(source, hook) {
  const hooks = source === 'codex' ? NOTE_HOOKS.codex : NOTE_HOOKS.claude;
  return typeof hook === 'string' && hooks.has(hook);
}

/**
 * A note as the agent may read it: line breaks kept (CR LF and lone CR become LF), tabs as a
 * space, every other control or format character (bidirectional overrides, zero-width
 * characters) and lone surrogates removed, more than one blank line in a row made one, spaces at
 * the ends of lines and of the note trimmed. '' for anything that is not a string or holds
 * nothing; null when it is longer than MAX_NOTE_CHARS once cleaned (refused, never cut: the agent
 * must read what the owner wrote, not part of it).
 * @param {unknown} raw
 * @returns {string|null}
 */
export function noteText(raw) {
  if (typeof raw !== 'string') return '';
  const text = raw
    .replace(/\r\n?/g, '\n')
    .replace(/\t/g, ' ')
    // eslint-disable-next-line no-control-regex -- removing control characters is the point
    .replace(/[\u0000-\u0009\u000B-\u001F\u007F-\u009F]|\p{Cf}|\p{Cs}/gu, '')
    .replace(/[^\S\n]+$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return text.length > MAX_NOTE_CHARS ? null : text;
}

/**
 * @typedef {object} Note  CONTRACTS §4.15 (read defensively: it crosses the network)
 * @property {string} id
 * @property {'queued'|'delivered'|'expired'} status
 * @property {string} sessionId
 * @property {string|null} agentId  normalised; null for the crew's lead
 * @property {string} text
 * @property {number} createdAt
 * @property {number} expiresAt
 * @property {number} [deliveredAt]
 * @property {string} [hook]    the hook whose reply carried it
 * @property {string} [reason]  why it expired
 */

/**
 * The words for a note's state, for the activity log and the inspector.
 * @param {Pick<Note, 'status'|'hook'|'reason'>} note
 */
export function noteStateText(note) {
  switch (note.status) {
    case 'queued':
      return "Note queued for the agent's next step";
    case 'delivered':
      return note.hook ? `Note handed to the agent with its ${note.hook} hook` : 'Note handed to the agent';
    case 'expired':
      return note.reason ? `Note expired: ${note.reason}` : 'Note expired before the agent took another step';
    default:
      return '';
  }
}
