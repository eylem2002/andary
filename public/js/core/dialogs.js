// Open dialogs: what each agent has asked you and not had an answer to yet (docs/design/
// agent-health.md §2, §3). One model for the phone notes (server/notify.mjs) and the town's
// "needs you" (core/store.js), so both agree on when an agent waits for you. Pure and bounded.
//
// A dialog opens with a permission request, a question or a plan (AskUserQuestion, ExitPlanMode),
// or a session's own "needs your permission" notice when nothing of that session is known to be
// open. It closes only on proof of an answer:
//   - the same call reporting back: a tool name in common and the same input (questions and plans
//     by name only: Claude Code adds your answer to their input);
//   - the town deciding the request it holds for it;
//   - your prompt (the lead's dialogs only: a helper's request held in the town does not stop you
//     typing), the agent's turn ending, or the session ending.
// A request that went back to the terminal (timed out, released) is no proof, and neither is a
// new request from the same agent: parallel tool calls each ask on their own.
import { isObject, shellWords } from './text.js';

/** Tools that stop the agent until you answer them in the terminal. */
export const INTERACTIVE_TOOLS = Object.freeze({ AskUserQuestion: 'question', ExitPlanMode: 'plan' });

/**
 * @typedef {'permission'|'question'|'plan'|'unknown'} DialogKind
 *   unknown: a session's notice that something asks for permission, without saying what
 */

/**
 * @typedef {object} Call  one tool call, as the caller identifies it
 * @property {string} sessionId
 * @property {string|null} agentId   normalised (core/ids.js); null for the lead
 * @property {readonly string[]} tools  its tool names (an adapter's renamed call keeps both)
 * @property {string|null} input     inputKey() of its input; null when it cannot be compared
 */

/**
 * @typedef {object} Dialog
 * @property {number} id
 * @property {string} sessionId
 * @property {string|null} agentId
 * @property {DialogKind} kind
 * @property {readonly string[]} tools
 * @property {string|null} input     null: any result of one of its tools answers it
 * @property {number} at             when it opened (the hook's time)
 * @property {string|null} approvalId  the town's request for it, once known
 * @property {string} text           what the caller wants to show for it ('' when nothing)
 */

/**
 * A short key for a tool input, equal for equal inputs. A command sent as an argument list
 * (Codex) is joined first, as the request and its result may differ in that alone.
 * @param {unknown} input
 * @returns {string}
 */
export function inputKey(input) {
  const same = isObject(input) && Array.isArray(input.command) ? { ...input, command: shellWords(input.command) } : input;
  return hash53(JSON.stringify(same ?? null));
}

/** The kind of dialog a call opens. @param {readonly string[]} tools @returns {DialogKind} */
function kindOf(tools) {
  for (const tool of tools) if (Object.hasOwn(INTERACTIVE_TOOLS, tool)) return INTERACTIVE_TOOLS[/** @type {keyof typeof INTERACTIVE_TOOLS} */ (tool)];
  return 'permission';
}

/** @param {Dialog} d @param {Call} call */
function sameAgent(d, call) {
  return d.kind !== 'unknown' && d.sessionId === call.sessionId && d.agentId === call.agentId && d.tools.some((t) => call.tools.includes(t));
}

/** A result answers a dialog only for the very same call. @param {Dialog} d @param {Call} call */
function answers(d, call) {
  return sameAgent(d, call) && (d.input === null || d.input === call.input);
}

/** A request or an approval belongs to a dialog unless their inputs differ. @param {Dialog} d @param {Call} call */
function fits(d, call) {
  return sameAgent(d, call) && (d.input === null || call.input === null || d.input === call.input);
}

/**
 * @param {{ max?: number }} [options]  max: open dialogs kept; the oldest give way
 */
export function createDialogs({ max = 200 } = {}) {
  /** @type {Dialog[]} oldest first */
  let open = [];
  let seq = 0;

  /** @param {Omit<Dialog, 'id'|'approvalId'>} fields */
  function add(fields) {
    seq += 1;
    const dialog = { id: seq, approvalId: null, ...fields };
    open.push(dialog);
    if (open.length > max) open.shift();
    return dialog;
  }

  /** @param {(d: Dialog) => boolean} which @returns {Dialog[]} */
  function close(which) {
    const closed = open.filter(which);
    if (closed.length) open = open.filter((d) => !which(d));
    return closed;
  }

  return {
    /**
     * A permission request, or a question or plan starting: opens a dialog. The permission
     * request Claude Code sends for an open question or plan joins it instead.
     * @param {Call} call @param {number} at @param {string} [text]
     * @returns {{ dialog: Dialog, opened: boolean }}
     */
    ask(call, at, text = '') {
      const kind = kindOf(call.tools);
      const already = kind === 'permission' ? null : open.find((d) => d.kind === kind && fits(d, call));
      if (already) return { dialog: already, opened: false };
      // Questions and plans match by name: your answer changes their input.
      const input = kind === 'permission' ? call.input : null;
      return { dialog: add({ sessionId: call.sessionId, agentId: call.agentId, kind, tools: [...call.tools], input, at, text }), opened: true };
    },

    /**
     * The session says a permission dialog is showing, without saying whose: a dialog of its own
     * only when nothing of that session is known to be open.
     * @param {string} sessionId @param {number} at @param {string} [text]
     * @returns {Dialog|null} the new dialog
     */
    notice(sessionId, at, text = '') {
      if (open.some((d) => d.sessionId === sessionId)) return null;
      return add({ sessionId, agentId: null, kind: 'unknown', tools: [], input: null, at, text });
    },

    /**
     * Attaches the town's request to its dialog: the newest open one for that call without one.
     * @param {Call} call @param {string} approvalId
     * @returns {Dialog|null}
     */
    link(call, approvalId) {
      const linked = open.find((d) => d.approvalId === approvalId);
      if (linked) return linked;
      const dialog = open.findLast((d) => d.approvalId === null && fits(d, call)) ?? null;
      if (dialog) dialog.approvalId = approvalId;
      return dialog;
    },

    /** The town decided the request it held. @param {string} approvalId @returns {Dialog[]} */
    decided(approvalId) {
      return close((d) => d.approvalId === approvalId);
    },

    /** A tool call reported back: the oldest dialog for that very call. @param {Call} call @returns {Dialog[]} */
    result(call) {
      const dialog = open.find((d) => answers(d, call));
      return dialog ? close((d) => d === dialog) : [];
    },

    /** You sent a prompt: the lead's dialogs, and the session's notice. @param {string} sessionId @returns {Dialog[]} */
    prompted(sessionId) {
      return close((d) => d.sessionId === sessionId && d.agentId === null);
    },

    /**
     * An agent's turn ended (the lead's Stop, a helper's SubagentStop): its dialogs; the lead's
     * take the session's notice with them.
     * @param {string} sessionId @param {string|null} agentId @returns {Dialog[]}
     */
    stopped(sessionId, agentId) {
      return close((d) => d.sessionId === sessionId && d.agentId === agentId);
    },

    /** The session ended or was interrupted: all of its dialogs. @param {string} sessionId @returns {Dialog[]} */
    closeSession(sessionId) {
      return close((d) => d.sessionId === sessionId);
    },

    /** Forgets one dialog (the caller's own limits). @param {number} id @returns {Dialog[]} */
    forget(id) {
      return close((d) => d.id === id);
    },

    /** @param {number} id */
    has(id) {
      return open.some((d) => d.id === id);
    },

    /** Open dialogs, oldest first. Read-only. @returns {readonly Dialog[]} */
    list() {
      return open;
    },
  };
}

/** @typedef {ReturnType<typeof createDialogs>} Dialogs */

/**
 * cyrb53: a fast 53-bit string hash (public domain, bryc). Equal inputs give equal keys; unequal
 * ones collide about once in 9e15 pairs, which is no concern for telling calls apart.
 * @param {string} text
 * @returns {string}
 */
function hash53(text) {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}
