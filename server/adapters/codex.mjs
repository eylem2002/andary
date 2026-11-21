// Codex → town (CONTRACTS §4.12). Codex's hooks use Claude Code's event names and field names
// (session_id, transcript_path, cwd, hook_event_name, tool_name, tool_input, tool_response…), so
// most events pass through as they are. What differs is translated here, at the edge, so that
// everything after the server's ingest (history, recordings, the team relay, the browser) sees one
// event contract:
//   - `apply_patch` becomes one Write, Edit or MultiEdit per file it touches, so the town shows
//     the files and their diffs (deletes stay `apply_patch`);
//   - `spawn_agent` becomes an `Agent` call (a helper joins the crew);
//   - a shell command that ends with a non-zero exit code becomes PostToolUseFailure (Codex has no
//     failure event), so failures still bring rain; one whose exit code was found is marked
//     `andary_exit_known`, as only then does its PostToolUse prove it succeeded;
//   - `Interrupt` becomes `Stop`.
// A renamed tool call keeps Codex's own name in `andary_tool` and the call key of its original
// input in `andary_key` (ingest keys every other call), so the approval it may have needed, asked
// under that name and input, settles when exactly that call runs. Permission requests are never
// rewritten: the town must show exactly what it would approve.
import { isAbsolute, join } from 'node:path';
import { inputKey } from '../../public/js/core/dialogs.js';
import { shellWords } from '../../public/js/core/text.js';
import { parsePatch } from './apply-patch.mjs';

/** @typedef {Record<string, any>} Payload */

const ERROR_PREVIEW_CHARS = 500;

/**
 * One Codex hook payload as town payloads (one, or one per file for a multi-file patch). Each is
 * marked `andary_source: 'codex'`.
 * @param {Payload} payload
 * @returns {Payload[]}
 */
export function fromCodex(payload) {
  const base = { ...payload, andary_source: 'codex' };
  switch (payload.hook_event_name) {
    case 'Interrupt':
      return [{ ...base, hook_event_name: 'Stop', stop_reason: 'interrupted' }];
    case 'PreToolUse':
    case 'PostToolUse':
      return toolEvents(base);
    default:
      return [base];
  }
}

/**
 * @param {Payload} event
 * @returns {Payload[]}
 */
function toolEvents(event) {
  // Keyed before its input is rewritten: each payload made from it keeps the call's own key.
  if (event.tool_name === 'apply_patch') return patchEvents({ ...event, andary_tool: 'apply_patch', andary_key: inputKey(event.tool_input, { tool: event.tool_name, source: 'codex' }) });
  if (event.tool_name === 'spawn_agent') return [spawnEvent({ ...event, andary_tool: 'spawn_agent', andary_key: inputKey(event.tool_input, { tool: event.tool_name, source: 'codex' }) })];
  const shell = event.tool_name === 'Bash' ? withExitKnown(withShellCommand(event)) : event;
  return [failed(shell) ?? shell];
}

/**
 * A patch as one event per file. Paths in a patch are relative to the session's folder.
 * @param {Payload} event
 * @returns {Payload[]}
 */
function patchEvents(event) {
  const input = event.tool_input ?? {};
  const files = parsePatch(input.command ?? input.input ?? input.patch);
  if (files.length === 0) return [event];
  const id = String(event.tool_use_id ?? 'patch');
  return files.map((file, index) => {
    const filePath = absolute(event.cwd, file.moveTo ?? file.path);
    const toolUseId = index === 0 ? id : `${id}#${index + 1}`;
    if (file.op === 'delete') return { ...event, tool_use_id: toolUseId, tool_input: { command: `*** Delete File: ${file.path}`, file_path: filePath } };
    if (file.op === 'add') return { ...event, tool_use_id: toolUseId, tool_name: 'Write', tool_input: { file_path: filePath, content: file.hunks[0]?.after ?? '' } };
    if (file.hunks.length === 1) {
      const [hunk] = file.hunks;
      return { ...event, tool_use_id: toolUseId, tool_name: 'Edit', tool_input: { file_path: filePath, old_string: hunk.before, new_string: hunk.after } };
    }
    const edits = file.hunks.map((hunk) => ({ old_string: hunk.before, new_string: hunk.after }));
    return { ...event, tool_use_id: toolUseId, tool_name: 'MultiEdit', tool_input: { file_path: filePath, edits } };
  });
}

/**
 * @param {Payload} event
 * @returns {Payload}
 */
function spawnEvent(event) {
  const input = event.tool_input ?? {};
  const task = [input.message, input.prompt, input.task, input.description].find((value) => typeof value === 'string' && value.trim()) ?? '';
  const description = typeof input.description === 'string' && input.description.trim() ? input.description : task.split('\n')[0].slice(0, 80);
  const subagentType = [input.agent_type, input.subagent_type, input.agent_role, input.role].find((value) => typeof value === 'string' && value) ?? 'general-purpose';
  return { ...event, tool_name: 'Agent', tool_input: { ...input, description: description || 'A helper', prompt: task, subagent_type: subagentType } };
}

/**
 * Codex may pass a shell command as an argument list; the town reads it as one line, each argument
 * quoted as a shell would need it.
 * @param {Payload} event
 * @returns {Payload}
 */
function withShellCommand(event) {
  const command = event.tool_input?.command;
  if (!Array.isArray(command)) return event;
  return { ...event, tool_input: { ...event.tool_input, command: shellWords(command) } };
}

/**
 * A finished command's exit code, when Codex said it.
 * @param {Payload} event
 * @returns {number|undefined}
 */
function exitCodeOf(event) {
  const response = event.tool_response;
  return [response?.exit_code, response?.exitCode, response?.metadata?.exit_code, event.exit_code].find((value) => Number.isInteger(value));
}

/**
 * A finished command whose exit code was found, marked so: the catch-up states a test result, a
 * commit or a push from a Codex command only then.
 * @param {Payload} event
 * @returns {Payload}
 */
function withExitKnown(event) {
  return event.hook_event_name === 'PostToolUse' && exitCodeOf(event) !== undefined ? { ...event, andary_exit_known: true } : event;
}

/**
 * A finished command with a non-zero exit code, as PostToolUseFailure; null otherwise.
 * @param {Payload} event
 * @returns {Payload|null}
 */
function failed(event) {
  if (event.hook_event_name !== 'PostToolUse') return null;
  const response = event.tool_response;
  const code = exitCodeOf(event);
  if (code === undefined || code === 0) return null;
  const output = [response?.stderr, response?.output, response?.stdout].find((value) => typeof value === 'string' && value.trim());
  const error = (output ?? `Exit code ${code}`).slice(0, ERROR_PREVIEW_CHARS);
  return { ...event, hook_event_name: 'PostToolUseFailure', error, is_interrupt: false };
}

/**
 * @param {unknown} cwd
 * @param {string} path
 * @returns {string}
 */
function absolute(cwd, path) {
  if (isAbsolute(path) || typeof cwd !== 'string' || !cwd) return path;
  return join(cwd, path);
}
