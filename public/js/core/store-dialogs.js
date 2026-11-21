// The store's open dialogs (core/dialogs.js, the model the phone notes share): fed by every event
// the store applies and every approval change, and kept on StoreState.dialogs for "needs you"
// (core/attention.js). Each dialog's text is what it is about, without a prefix: the attention
// list words it by kind ("Needs permission: …", "Answer in your terminal: …", "Asks: …").
import { INTERACTIVE_TOOLS, inputKey } from './dialogs.js';
import { normalizeAgentId } from './ids.js';
import { isObject, own, str } from './text.js';

/** @typedef {import('./dialogs.js').Call} Call */
/** @typedef {import('./dialogs.js').Dialogs} Dialogs */
/** @typedef {import('./events.js').TownEvent} TownEvent */

/**
 * The call an event is about, for the agent the store gave it to.
 * @param {TownEvent} e
 * @param {string|null} agentId
 * @returns {Call}
 */
function callOf(e, agentId) {
  const sourceTool = str(e.data.sourceTool);
  const tools = [str(e.data.tool), sourceTool].filter(Boolean);
  // A call an adapter renamed (Codex's apply_patch as an Edit) had its input rewritten too.
  return { sessionId: e.sessionId, agentId, tools, input: sourceTool ? null : inputKey(isObject(e.data.input) ? e.data.input : {}) };
}

/** The first question of an AskUserQuestion call, read defensively. @param {unknown} input */
function questionOf(input) {
  const first = isObject(input) && Array.isArray(input.questions) ? input.questions[0] : null;
  return isObject(first) ? str(first.question) : '';
}

/** What a dialog for this call is about. @param {Call} call @param {TownEvent} e */
function aboutCall(call, e) {
  const kind = call.tools.map((tool) => own(INTERACTIVE_TOOLS, tool)).find(Boolean);
  if (kind === 'question') return questionOf(e.data.input);
  if (kind === 'plan') return '';
  return str(e.data.summary) || str(e.data.tool);
}

/** @type {Readonly<Record<string, (d: Dialogs, e: TownEvent, call: Call) => void>>} */
const ON_EVENT = Object.freeze({
  'permission.request': (d, e, call) => void d.ask(call, e.ts, aboutCall(call, e)),
  'tool.start': (d, e, call) => {
    if (call.tools.some((tool) => own(INTERACTIVE_TOOLS, tool))) d.ask(call, e.ts, aboutCall(call, e));
  },
  'tool.end': (d, _e, call) => void d.result(call),
  'tool.fail': (d, _e, call) => void d.result(call),
  'permission.denied': (d, _e, call) => void d.result(call),
  prompt: (d, e) => void d.prompted(e.sessionId),
  'turn.stop': (d, e, call) => void d.stopped(e.sessionId, call.agentId),
  'subagent.stop': (d, e, call) => void d.stopped(e.sessionId, call.agentId),
  'session.end': (d, e) => void d.closeSession(e.sessionId),
  notify: (d, e) => {
    if (e.data.notificationType === 'permission_prompt') d.notice(e.sessionId, e.ts, str(e.data.message));
  },
});

/**
 * Updates the dialogs after an applied event.
 * @param {Dialogs} dialogs
 * @param {TownEvent} e
 * @param {string|null} agentId  the agent the store gave the event to
 * @returns {boolean} whether the event could have changed them
 */
export function dialogsAfterEvent(dialogs, e, agentId) {
  const handler = own(ON_EVENT, e.kind);
  if (!handler) return false;
  handler(dialogs, e, callOf(e, agentId));
  return true;
}

/**
 * Updates the dialogs after an approval change: a request links to its dialog (one it has no
 * dialog for, such as a request older than the history kept, opens one); a decision in the town
 * closes it. A request sent back to the terminal (expired, released) keeps it: the agent waits
 * there. Nor is the broker's "answered in the terminal" proof: it goes by the tool's name alone,
 * while the call reporting back closes the right dialog.
 * @param {Dialogs} dialogs
 * @param {import('./store.js').Approval} approval
 * @param {string} about  what the request is about (its summary)
 */
export function dialogsAfterApproval(dialogs, approval, about) {
  const sessionId = str(approval.sessionId);
  const call = {
    sessionId,
    agentId: normalizeAgentId(approval.agentId),
    tools: [str(approval.toolName)].filter(Boolean),
    input: inputKey(isObject(approval.toolInput) ? approval.toolInput : {}),
  };
  const linked = dialogs.link(call, approval.id);
  if (!linked && approval.status === 'pending') {
    const kind = own(INTERACTIVE_TOOLS, call.tools[0] ?? '');
    const text = kind === 'question' ? questionOf(approval.toolInput) : kind === 'plan' ? '' : about;
    dialogs.ask(call, Number(approval.createdAt) || 0, text);
    dialogs.link(call, approval.id);
  }
  if (approval.status === 'allowed' || approval.status === 'denied') dialogs.decided(approval.id);
}
