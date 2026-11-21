// Open dialogs: what each agent has asked you and not had an answer to yet (docs/design/
// agent-health.md §2, §3). One model for the phone notes (server/notify.mjs) and the town's
// "needs you" (core/store.js), so both agree on when an agent waits for you. Pure and bounded.
//
// A dialog opens with a permission request, a question or a plan (AskUserQuestion, ExitPlanMode),
// or a session's own "needs your permission" notice when nothing of that session is known to be
// open. It closes only on proof of an answer:
//   - the same call reporting back: a tool name in common and the same input (questions and plans
//     by name only, as Claude Code adds your answer to their input; a call an adapter renamed by
//     name too, as its input was rewritten);
//   - the town deciding the request it holds for it;
//   - your prompt or /compact (the lead's dialogs only: a helper's request held in the town does
//     not stop you typing), the agent's turn ending (also in an error, or a teammate going idle),
//     or the session ending.
// A request that went back to the terminal (timed out, released) is no proof, and neither is a
// new request from the same agent: parallel tool calls each ask on their own. A session's notice
// (whose dialog is unknown) closes when the lead starts a new call, never on a tool result.
// afterHook() is the table of which hook does what; every consumer follows it.
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

/**
 * A call belongs to a dialog unless their inputs differ: the same agent, a tool name in common,
 * and the same input where both are known. A side without one (a question or plan; a call an
 * adapter renamed, its input rewritten) goes by the name.
 * @param {Dialog} d @param {Call} call
 */
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

    /** A tool call reported back: the oldest open dialog it fits. @param {Call} call @returns {Dialog[]} */
    result(call) {
      const dialog = open.find((d) => fits(d, call));
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

    /**
     * The lead started a new tool call: a session's notice that came before it was answered (an
     * agent waiting on a dialog starts nothing). Tool results prove nothing for such a dialog: a
     * parallel call may finish while it still waits.
     * @param {string} sessionId @param {number} at @returns {Dialog[]}
     */
    movedOn(sessionId, at) {
      return close((d) => d.sessionId === sessionId && d.kind === 'unknown' && d.at <= at);
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

    /** Open dialogs, oldest first (a copy). @returns {Dialog[]} */
    list() {
      return open.slice();
    },
  };
}

/** @typedef {ReturnType<typeof createDialogs>} Dialogs */

/**
 * @typedef {object} HookStep  one hook as the dialog rules read it
 * @property {string} hook          its name: PermissionRequest, PostToolUse, …
 * @property {Call} call            whose and which call (tools and input when it has any)
 * @property {number} at            the hook's time
 * @property {string} [text]        what a dialog it opens is about
 * @property {string} [notice]      Notification: its notification_type
 * @property {string} [trigger]     PreCompact: manual or auto
 * @property {boolean} [interrupted]  Stop: Codex's interrupt
 */

/** @typedef {{ opened: Dialog|null, closed: Dialog[] }} HookChange */

/** @type {HookChange} */
const NO_CHANGE = Object.freeze({ opened: null, closed: [] });

/** @param {{ dialog: Dialog, opened: boolean }} asked @returns {HookChange} */
const opening = (asked) => ({ opened: asked.opened ? asked.dialog : null, closed: [] });
/** @param {Dialog[]} closed @returns {HookChange} */
const closing = (closed) => ({ opened: null, closed });

/** @type {Readonly<Record<string, (d: Dialogs, step: HookStep) => HookChange>>} */
const HOOK_RULES = Object.freeze({
  PermissionRequest: (d, s) => opening(d.ask(s.call, s.at, s.text)),
  PreToolUse: toolStarted,
  Notification: (d, s) => {
    if (s.notice !== 'permission_prompt') return NO_CHANGE;
    return { opened: d.notice(s.call.sessionId, s.at, s.text), closed: [] };
  },
  PostToolUse: (d, s) => closing(d.result(s.call)),
  PostToolUseFailure: (d, s) => closing(d.result(s.call)),
  PermissionDenied: (d, s) => closing(d.result(s.call)),
  // You typed (a prompt, or /compact): the lead's dialogs were answered.
  UserPromptSubmit: (d, s) => closing(d.prompted(s.call.sessionId)),
  PreCompact: (d, s) => (s.trigger === 'manual' ? closing(d.prompted(s.call.sessionId)) : NO_CHANGE),
  // Codex's interrupt arrives as an interrupted Stop: you are at that session's terminal.
  Stop: (d, s) => closing(s.interrupted ? d.closeSession(s.call.sessionId) : d.stopped(s.call.sessionId, s.call.agentId)),
  SubagentStop: (d, s) => closing(d.stopped(s.call.sessionId, s.call.agentId)),
  StopFailure: (d, s) => closing(d.stopped(s.call.sessionId, s.call.agentId)),
  // One without an agent id cannot be placed: it must not close the lead's.
  TeammateIdle: (d, s) => (s.call.agentId === null ? NO_CHANGE : closing(d.stopped(s.call.sessionId, s.call.agentId))),
  SessionEnd: (d, s) => closing(d.closeSession(s.call.sessionId)),
});

/**
 * A question or a plan stops the agent until you answer, permission or not. Any other call the
 * lead starts means it got past a dialog its session only told of.
 * @param {Dialogs} d @param {HookStep} s @returns {HookChange}
 */
function toolStarted(d, s) {
  if (kindOf(s.call.tools) !== 'permission') return opening(d.ask(s.call, s.at, s.text));
  return s.call.agentId === null ? closing(d.movedOn(s.call.sessionId, s.at)) : NO_CHANGE;
}

/**
 * What one hook does to the dialogs: the one table the phone notes, the approval broker and the
 * town all follow, so they agree on when an agent waits for you.
 * @param {Dialogs} dialogs
 * @param {HookStep} step
 * @returns {HookChange}
 */
export function afterHook(dialogs, step) {
  const rule = Object.hasOwn(HOOK_RULES, step.hook) ? HOOK_RULES[step.hook] : null;
  return rule ? rule(dialogs, step) : NO_CHANGE;
}

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
