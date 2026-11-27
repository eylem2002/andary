// "Always hold risky commands for me" (CONTRACTS §4.3 step 4b, §4.5): when it is on, a risky
// shell command (public/js/core/risk.js) asks you in Claude Code even when an allow rule, an
// earlier "don't ask again" or a permission mode would have let it run. Claude Code runs the
// forwarder synchronously for Bash and PowerShell before each call (`hook.mjs hold`, registered
// in clients.mjs); it asks POST /api/hold, and prints a PreToolUse `ask` when this says so. The
// permission prompt that follows reaches the town as any other request, with its red band.
//
// The switch lives in a file of its own in ANDARY_HOME (`hold-risky`), so it outlasts a restart
// and the forwarder can see at once, without a request, that it is off (the usual case): a
// missing file costs the agent one file lookup per shell command. Off by default. Not a sandbox:
// what risk.js does not recognise runs as before, and Codex is never held (its PreToolUse hook
// cannot ask).
import { existsSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { riskOf } from '../public/js/core/risk.js';
import { MAX_SHELL_CHARS } from '../public/js/core/shell.js';

/** The file whose presence means "hold risky commands". */
export const HOLD_FILE = 'hold-risky';
/** The tools the hold hook is registered for (clients.mjs): shell commands only. */
export const HOLD_TOOLS = Object.freeze(['Bash', 'PowerShell']);
/** The longest reason passed on to Claude Code (the forwarder cuts there too). */
export const MAX_HOLD_REASON_CHARS = 300;

/** @param {string} home */
export function holdFilePath(home) {
  return join(home, HOLD_FILE);
}

/**
 * Whether the switch is on: the file is there.
 * @param {string|null} file
 */
export function readHoldRisky(file) {
  return Boolean(file) && existsSync(/** @type {string} */ (file));
}

/**
 * Turns the switch on (writes the file, private to the user) or off (removes it). Returns false
 * when the file could not be changed; the setting then still holds while the server runs.
 * @param {string|null} file
 * @param {boolean} on
 */
export function writeHoldRisky(file, on) {
  if (!file) return true;
  try {
    if (on) writeFileSync(file, 'Andary holds risky commands for you. Delete this file (or turn it off in the town) to stop.\n', { mode: 0o600 });
    else if (existsSync(file)) unlinkSync(file);
    return true;
  } catch {
    return false;
  }
}

/**
 * The PreToolUse answer for a hook: `ask`, with why, for a risky shell command from Claude Code;
 * null for anything else (the agent goes on as it would have).
 * @param {Record<string, any>} event  the hook's payload, as the forwarder sent it
 * @param {{ source: string, root: string|null }} where  who sent it; the top of its folder's work tree
 * @returns {{ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'ask', permissionDecisionReason: string } }|null}
 */
export function holdOutput(event, { source, root }) {
  if (source === 'codex' || event.hook_event_name !== 'PreToolUse' || !HOLD_TOOLS.includes(event.tool_name)) return null;
  const command = event.tool_input?.command;
  // Longer than Andary reads (or cut on the way): what it cannot read in full, it holds.
  const long = event.truncated === true || (typeof command === 'string' && command.length > MAX_SHELL_CHARS);
  const risk = riskOf(event.tool_name, event.tool_input, { folder: event.cwd, root });
  // A rebuildable folder (rm -rf dist) is ordinary work: never held.
  const reasons = long ? ['the command is too long for Andary to read in full'] : risk && !risk.quiet ? risk.reasons : [];
  if (!reasons.length) return null;
  const reason = `Andary holds risky commands for you: ${reasons.join('; ')}`.slice(0, MAX_HOLD_REASON_CHARS);
  return { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'ask', permissionDecisionReason: reason } };
}
