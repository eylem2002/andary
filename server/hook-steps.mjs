// How the server reads a hook for the dialog model (public/js/core/dialogs.js). Ingest stamps a
// call key on every tool hook as it arrives, before anything else reads it or the sanitizer cuts
// its input; the phone notes and the approval broker then read the same call, and the same step
// for afterHook(), from here, each at the hook's own time. The envelope keeps the stamp.
import { inputKey } from '../public/js/core/dialogs.js';
import { normalizeAgentId } from '../public/js/core/ids.js';

/** @typedef {import('../public/js/core/dialogs.js').Call} Call */
/** @typedef {import('../public/js/core/dialogs.js').HookStep} HookStep */

/** Hooks about one tool call: each carries `andary_key`, the call's key. */
export const KEYED_HOOKS = Object.freeze(new Set(['PermissionRequest', 'PreToolUse', 'PostToolUse', 'PostToolUseFailure', 'PermissionDenied']));

/**
 * A payload with its call key: inputKey() of the tool input as it arrived (before sanitizing, so
 * a request and its result match however long they are). A key is the server's own: the one an
 * adapter set for a call it renamed (from the call's original input) stays, as does a teammate's
 * server's; a forwarder's never gets this far (adapters/index.mjs drops it). A renamed call
 * without one has none (null): it goes by name.
 * @param {Record<string, any>} event  a town payload, before it is sanitized
 * @returns {Record<string, any>}
 */
export function withCallKey(event) {
  if (!KEYED_HOOKS.has(event.hook_event_name)) {
    if (!('andary_key' in event)) return event;
    const { andary_key: _dropped, ...rest } = event;
    return rest;
  }
  if (typeof event.andary_key === 'string') return event;
  return { ...event, andary_key: event.andary_tool ? null : inputKey(event.tool_input) };
}

/**
 * Read like the approval broker reads ids, so every reader places a call the same way.
 * @param {unknown} value
 */
const text = (value) => (typeof value === 'string' ? value : '');

/**
 * A stamped payload's tool call, as core/dialogs.js identifies it.
 * @param {Record<string, any>} event
 * @returns {Call}
 */
export function callOf(event) {
  return {
    sessionId: text(event.session_id),
    agentId: normalizeAgentId(event.agent_id),
    tools: [text(event.tool_name), text(event.andary_tool)].filter(Boolean),
    input: typeof event.andary_key === 'string' ? event.andary_key : null,
  };
}

/**
 * A hook's own time: when the agent sent it (the forwarder's `ts`), never later than now; its
 * arrival when it has none. A permission request is sent at once and a PreToolUse or a notice in
 * the background, so a later hook can arrive first: the dialog rules go by this time.
 * @param {unknown} ts @param {number} now
 * @returns {number}
 */
export function hookTime(ts, now) {
  return typeof ts === 'number' && Number.isFinite(ts) ? Math.min(ts, now) : now;
}

/**
 * A stamped payload as afterHook() reads it.
 * @param {Record<string, any>} event
 * @param {number} at  the hook's own time (hookTime)
 * @returns {HookStep}
 */
export function hookStep(event, at) {
  return {
    hook: text(event.hook_event_name),
    call: callOf(event),
    at,
    notice: text(event.notification_type),
    trigger: text(event.trigger),
    interrupted: event.stop_reason === 'interrupted',
  };
}
