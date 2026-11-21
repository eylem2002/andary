// The store's open dialogs (core/dialogs.js): every applied event goes through the model's one
// table of what each hook does (afterHook), and every approval change links or closes the
// dialog it belongs to. Kept on StoreState.dialogs for "needs you" (core/attention.js). Each
// dialog's text is what it is about, without a prefix: the attention list words it by kind
// ("Needs permission: …", "Answer in your terminal: …", "Asks: …").
import { INTERACTIVE_TOOLS, afterHook, inputKey } from './dialogs.js';
import { HOOK_BY_KIND } from './events.js';
import { normalizeAgentId } from './ids.js';
import { isObject, own, str } from './text.js';

/** @typedef {import('./dialogs.js').Call} Call */
/** @typedef {import('./dialogs.js').Dialogs} Dialogs */
/** @typedef {import('./events.js').TownEvent} TownEvent */

/** Events whose call a dialog may be about. */
const CALL_KINDS = new Set(['permission.request', 'tool.start', 'tool.end', 'tool.fail', 'permission.denied']);

/**
 * The call an event is about, for the agent the store gave it to. The server's key for its
 * input is used when it sent one: it read the input before sanitising cut anything.
 * @param {TownEvent} e
 * @param {string|null} agentId
 * @returns {Call}
 */
function callOf(e, agentId) {
  const sourceTool = str(e.data.sourceTool);
  const tools = CALL_KINDS.has(e.kind) ? [str(e.data.tool), sourceTool].filter(Boolean) : [];
  // A call an adapter renamed (Codex's apply_patch as an Edit) had its input rewritten too.
  const input = !tools.length || sourceTool ? null : str(e.data.callKey) || inputKey(isObject(e.data.input) ? e.data.input : {}, { tool: tools[0], source: e.source });
  return { sessionId: e.sessionId, agentId, tools, input };
}

/** The first question of an AskUserQuestion call, read defensively. @param {unknown} input */
function questionOf(input) {
  const first = isObject(input) && Array.isArray(input.questions) ? input.questions[0] : null;
  return isObject(first) ? str(first.question) : '';
}

/** What a dialog opened by this event would be about. @param {Call} call @param {TownEvent} e */
function aboutEvent(call, e) {
  if (e.kind === 'notify') return str(e.data.message);
  const kind = call.tools.map((tool) => own(INTERACTIVE_TOOLS, tool)).find(Boolean);
  if (kind === 'question') return questionOf(e.data.input);
  if (kind === 'plan') return '';
  return str(e.data.summary) || str(e.data.tool);
}

/**
 * Updates the dialogs after an applied event.
 * @param {Dialogs} dialogs
 * @param {TownEvent} e
 * @param {string|null} agentId  the agent the store gave the event to
 * @returns {boolean} whether any dialog opened or closed
 */
export function dialogsAfterEvent(dialogs, e, agentId) {
  const hook = own(HOOK_BY_KIND, e.kind);
  if (!hook) return false;
  const call = callOf(e, agentId);
  const { opened, closed } = afterHook(dialogs, {
    hook,
    call,
    at: e.ts,
    text: aboutEvent(call, e),
    notice: str(e.data.notificationType),
    trigger: str(e.data.trigger),
    interrupted: e.data.interrupted === true,
  });
  return Boolean(opened) || closed.length > 0;
}

/**
 * Updates the dialogs after an approval changes (its status, or whether the town holds it). A
 * request links to its dialog and says whether the town holds it (one with no dialog, such as a
 * request older than the history kept, opens one); a request sent back to the terminal (expired,
 * released) keeps its dialog, no longer held, so your next prompt answers it; the town deciding
 * it, or the broker proving it answered in the terminal (by the same table, server/approvals.mjs),
 * closes it.
 * @param {Dialogs} dialogs
 * @param {import('./store.js').Approval} approval
 * @param {string} about  what the request is about (its summary)
 */
export function dialogsAfterApproval(dialogs, approval, about) {
  const tools = [str(approval.toolName)].filter(Boolean);
  const call = {
    sessionId: str(approval.sessionId),
    agentId: normalizeAgentId(approval.agentId),
    tools,
    input: str(approval.callKey) || inputKey(isObject(approval.toolInput) ? approval.toolInput : {}, { tool: tools[0], source: approval.source }),
  };
  const held = approval.status === 'pending' && approval.held === true;
  const linked = dialogs.link(call, approval.id, held);
  if (!linked && approval.status === 'pending') {
    const kind = own(INTERACTIVE_TOOLS, tools[0] ?? '');
    const text = kind === 'question' ? questionOf(approval.toolInput) : kind === 'plan' ? '' : about;
    dialogs.ask(call, Number(approval.createdAt) || 0, text);
    dialogs.link(call, approval.id, held);
  }
  if (approval.status === 'allowed' || approval.status === 'denied' || approval.status === 'resolved') dialogs.decided(approval.id);
}
