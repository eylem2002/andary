// Open dialogs: what each agent has asked you and not had an answer to yet (docs/design/
// agent-health.md §2). One model for the phone notes (server/notify.mjs) and the approval broker
// (server/approvals.mjs), so both agree on when an agent waits for you. Pure and bounded.
//
// A dialog opens with a permission request, a question or a plan (AskUserQuestion, ExitPlanMode),
// or a session's own notice: "needs your permission" when nothing of that session is known to be
// open, or an MCP server's form (a question). It closes only on proof of an answer:
//   - the same call reporting back: a tool name in common and the same call key (questions and
//     plans by name only, as Claude Code adds your answer to their input; a side with no key by
//     name);
//   - the town deciding the request it holds for it;
//   - your prompt or /compact: every dialog of the session the town is not holding right now,
//     whoever asked (nobody can type while a dialog shows in the terminal); the agent's turn
//     ending (also in an error, or a teammate going idle); the session ending;
//   - for a question or a plan, the same agent starting another one: it cannot ask again while
//     one waits, and a "No, keep planning" sends nothing else.
// A request that went back to the terminal (timed out, released) is no proof, and neither is a
// new request from the same agent: parallel tool calls each ask on their own. A session's notice
// (whose dialog is unknown) closes when the lead starts a new call, never on a tool result.
// Hooks may arrive out of order (a permission request is sent at once, a PreToolUse or a
// notice in the background), so every rule goes by the hook's own time: a question's request
// that overtook its PreToolUse is joined by it, and a notice is closed only by a call started
// after it. Two hooks sent a moment apart may still carry their times the wrong way round (each
// forwarder is its own process), so "before" and "after" leave ORDER_SLACK_MS between them.
// afterHook() is the table of which hook does what; every consumer follows it.
import { isObject, shellWords } from './text.js';

/** Tools that stop the agent until you answer them in the terminal. */
export const INTERACTIVE_TOOLS = Object.freeze({ AskUserQuestion: 'question', ExitPlanMode: 'plan' });

/**
 * How far apart two hooks' times must be to count as one before the other. Each hook's forwarder
 * stamps its own time, so a PreToolUse and its own request may carry theirs a few milliseconds the
 * wrong way round. Nothing that proves an answer comes this soon: asking again takes your answer
 * and a model turn.
 */
export const ORDER_SLACK_MS = 250;

/** Notification types for an MCP server's form, which waits for you like a question. */
export const FORM_NOTICES = Object.freeze(['elicitation_dialog', 'elicitation_url_dialog', 'agent_needs_input']);

/**
 * @typedef {'permission'|'question'|'plan'|'unknown'} DialogKind
 *   unknown: a session's notice that something asks for permission, without saying what
 */

/**
 * @typedef {object} Call  one tool call, as the caller identifies it
 * @property {string} sessionId
 * @property {string|null} agentId   normalised (core/ids.js); null for the lead
 * @property {readonly string[]} tools  its tool names (an adapter's renamed call keeps both)
 * @property {string|null} input     its call key (inputKey() of its input); null when it has none
 */

/**
 * @typedef {object} Dialog
 * @property {number} id
 * @property {string} sessionId
 * @property {string|null} agentId
 * @property {DialogKind} kind
 * @property {readonly string[]} tools  none for a session's notice
 * @property {string|null} input     null: any result of one of its tools answers it
 * @property {number} at             when it opened (the hook's time)
 * @property {string|null} approvalId  the town's request for it, once known
 * @property {boolean} held          the town holds its request right now (so no prompt answered it)
 * @property {boolean} requested     its permission request came (a question's or plan's joins it once)
 * @property {boolean} begun         its PreToolUse came (a question's or plan's; its request may come first)
 * @property {string} text           what the caller wants to show for it ('' when nothing)
 */

/**
 * @typedef {{ dialog: Dialog, opened: boolean, closed: Dialog[] }} Asked
 *   opened: a new dialog (not one joined); closed: dialogs it showed were answered
 */

/**
 * Tools whose `description` only labels the call: it changes nothing that runs, and Codex sends
 * one with a request only, not with the call's PreToolUse or result. Any other tool's (an MCP
 * tool's) may be what it acts on.
 */
const LABELLED_TOOLS = Object.freeze(['Bash', 'PowerShell']);

/**
 * A short key for a tool input, equal for equal inputs. A command sent as an argument list
 * (Codex) is joined first, as the request and its result may differ in that alone, and a
 * command's `description` is left out (LABELLED_TOOLS).
 * @param {unknown} input
 * @param {unknown} [tool]  the tool's name
 * @returns {string}
 */
export function inputKey(input, tool) {
  if (!isObject(input)) return hash53(JSON.stringify(input ?? null));
  const { description: _label, ...rest } = input;
  const kept = typeof tool === 'string' && LABELLED_TOOLS.includes(tool) ? rest : input;
  return hash53(JSON.stringify(Array.isArray(kept.command) ? { ...kept, command: shellWords(kept.command) } : kept));
}

/** The kind of dialog a call opens. @param {readonly string[]} tools @returns {DialogKind} */
function kindOf(tools) {
  for (const tool of tools) if (Object.hasOwn(INTERACTIVE_TOOLS, tool)) return INTERACTIVE_TOOLS[/** @type {keyof typeof INTERACTIVE_TOOLS} */ (tool)];
  return 'permission';
}

/** A session's notice: no tool, so no call can be matched to it. @param {Dialog} d */
const isNotice = (d) => d.tools.length === 0;

/** @param {Dialog} d @param {Call} call */
function sameAgent(d, call) {
  return !isNotice(d) && d.sessionId === call.sessionId && d.agentId === call.agentId && d.tools.some((t) => call.tools.includes(t));
}

/**
 * A call belongs to a dialog unless their inputs differ: the same agent, a tool name in common,
 * and the same key where both have one. A side without one (a question or plan; a call nobody
 * keyed) goes by the name.
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

  /** @param {Omit<Dialog, 'id'|'approvalId'|'held'>} fields */
  function add(fields) {
    seq += 1;
    const dialog = { id: seq, approvalId: null, held: false, ...fields };
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

  /**
   * That agent's questions or plans of a kind opened before `at` (by more than ORDER_SLACK_MS):
   * answered, as it cannot ask again while one waits.
   * @param {Call} call @param {DialogKind} kind @param {number} at
   */
  function closeOlder(call, kind, at) {
    return close((d) => !isNotice(d) && d.kind === kind && d.sessionId === call.sessionId && d.agentId === call.agentId && d.at < at - ORDER_SLACK_MS);
  }

  /**
   * A new question or plan from an agent: a dialog of its own, closing its older ones of the kind.
   * @param {Call} call @param {DialogKind} kind @param {number} at @param {string} text
   * @param {{ requested: boolean, begun: boolean }} came  which of its hooks opened it
   * @returns {Asked}
   */
  function askAgain(call, kind, at, text, came) {
    const closed = closeOlder(call, kind, at);
    const dialog = add({ sessionId: call.sessionId, agentId: call.agentId, kind, tools: [...call.tools], input: null, at, text, ...came });
    return { dialog, opened: true, closed };
  }

  return {
    /**
     * A permission request: opens a dialog. The one Claude Code sends for a question or plan joins
     * the newest of that agent's it has not joined yet (else it starts one).
     * @param {Call} call @param {number} at @param {string} [text]
     * @returns {Asked}
     */
    ask(call, at, text = '') {
      const kind = kindOf(call.tools);
      if (kind === 'permission') {
        const dialog = add({ sessionId: call.sessionId, agentId: call.agentId, kind, tools: [...call.tools], input: call.input, at, text, requested: true, begun: false });
        return { dialog, opened: true, closed: [] };
      }
      const waiting = open.findLast((d) => d.kind === kind && !d.requested && fits(d, call));
      if (!waiting) return askAgain(call, kind, at, text, { requested: true, begun: false });
      waiting.requested = true;
      return { dialog: waiting, opened: false, closed: [] };
    },

    /**
     * A question or a plan starting (its PreToolUse): a dialog matched by name, as your answer
     * changes its input. Its own request may have come first (a PreToolUse is sent in the
     * background): the newest of that agent's of the kind not begun yet, opened at or after this
     * hook's time (less ORDER_SLACK_MS), is this one. Either way it closes that agent's older ones
     * of the kind (opened before it, by more than ORDER_SLACK_MS).
     * @param {Call} call @param {number} at @param {string} [text]
     * @returns {Asked}
     */
    begin(call, at, text = '') {
      const kind = kindOf(call.tools);
      const own = open.findLast((d) => d.kind === kind && !d.begun && d.at >= at - ORDER_SLACK_MS && fits(d, call));
      if (!own) return askAgain(call, kind, at, text, { requested: false, begun: true });
      own.begun = true;
      return { dialog: own, opened: false, closed: closeOlder(call, kind, at) };
    },

    /**
     * The session says something waits for you, without saying whose: a permission dialog
     * ('unknown', a dialog of its own only when nothing of that session is known to be open), or
     * an MCP server's form ('question', unless one is already open).
     * @param {string} sessionId @param {number} at @param {string} [text] @param {DialogKind} [kind]
     * @returns {Dialog|null} the new dialog
     */
    notice(sessionId, at, text = '', kind = 'unknown') {
      const known = kind === 'unknown' ? open.some((d) => d.sessionId === sessionId) : open.some((d) => d.sessionId === sessionId && isNotice(d) && d.kind === kind);
      if (known) return null;
      return add({ sessionId, agentId: null, kind, tools: [], input: null, at, text, requested: false, begun: false });
    },

    /**
     * Attaches the town's request to its dialog (the newest open one for that call without one),
     * and says whether the town holds it. Linking again changes only that.
     * @param {Call} call @param {string} approvalId @param {boolean} [held]
     * @returns {Dialog|null}
     */
    link(call, approvalId, held = false) {
      const dialog = open.find((d) => d.approvalId === approvalId) ?? open.findLast((d) => d.approvalId === null && fits(d, call)) ?? null;
      if (dialog) {
        dialog.approvalId = approvalId;
        dialog.held = held;
      }
      return dialog;
    },

    /**
     * The town handed its request back to the terminal (released, or timed out): it shows there
     * now, so your next prompt answers it.
     * @param {string} approvalId @returns {Dialog|null}
     */
    toTerminal(approvalId) {
      const dialog = open.find((d) => d.approvalId === approvalId) ?? null;
      if (dialog) dialog.held = false;
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

    /**
     * You sent a prompt: nothing showed in the terminal, so every dialog of the session was
     * answered, whoever asked, except those the town holds right now.
     * @param {string} sessionId @returns {Dialog[]}
     */
    prompted(sessionId) {
      return close((d) => d.sessionId === sessionId && !d.held);
    },

    /**
     * An agent's turn ended (the lead's Stop, a helper's SubagentStop): its dialogs; the lead's
     * take the session's notices with them.
     * @param {string} sessionId @param {string|null} agentId @returns {Dialog[]}
     */
    stopped(sessionId, agentId) {
      return close((d) => d.sessionId === sessionId && d.agentId === agentId);
    },

    /**
     * The lead started a new tool call: a session's notice that came before it (by ORDER_SLACK_MS
     * at least) was answered (an agent waiting on a dialog starts nothing). Tool results prove
     * nothing for such a dialog: a parallel call may finish while it still waits.
     * @param {string} sessionId @param {number} at @returns {Dialog[]}
     */
    movedOn(sessionId, at) {
      return close((d) => d.sessionId === sessionId && isNotice(d) && d.at <= at - ORDER_SLACK_MS);
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
 * @property {number} at            the hook's own time (when the agent sent it), not its arrival
 * @property {string} [text]        what a dialog it opens is about
 * @property {string} [notice]      Notification: its notification_type
 * @property {string} [trigger]     PreCompact: manual or auto
 * @property {boolean} [interrupted]  Stop: Codex's interrupt
 */

/** @typedef {{ opened: Dialog|null, closed: Dialog[] }} HookChange */

/** @type {HookChange} */
const NO_CHANGE = Object.freeze({ opened: null, closed: [] });

/** @param {Asked} asked @returns {HookChange} */
const opening = (asked) => ({ opened: asked.opened ? asked.dialog : null, closed: asked.closed });
/** @param {Dialog[]} closed @returns {HookChange} */
const closing = (closed) => ({ opened: null, closed });

/** @type {Readonly<Record<string, (d: Dialogs, step: HookStep) => HookChange>>} */
const HOOK_RULES = Object.freeze({
  PermissionRequest: (d, s) => opening(d.ask(s.call, s.at, s.text)),
  PreToolUse: toolStarted,
  Notification: (d, s) => {
    const kind = s.notice === 'permission_prompt' ? 'unknown' : FORM_NOTICES.includes(s.notice ?? '') ? 'question' : null;
    return kind ? { opened: d.notice(s.call.sessionId, s.at, s.text, kind), closed: [] } : NO_CHANGE;
  },
  PostToolUse: (d, s) => closing(d.result(s.call)),
  PostToolUseFailure: (d, s) => closing(d.result(s.call)),
  PermissionDenied: (d, s) => closing(d.result(s.call)),
  // You typed (a prompt, or /compact): what showed in the terminal was answered.
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
  if (kindOf(s.call.tools) !== 'permission') return opening(d.begin(s.call, s.at, s.text));
  return s.call.agentId === null ? closing(d.movedOn(s.call.sessionId, s.at)) : NO_CHANGE;
}

/**
 * What one hook does to the dialogs: the one table the phone notes and the approval broker both
 * follow, so they agree on when an agent waits for you. Give each hook its own time (`at`), not
 * its arrival: hooks may arrive out of order.
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
