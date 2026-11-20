// The coding agents that can feed the town through their hooks (CONTRACTS §4.1): Claude Code and
// OpenAI Codex. Both run a command for each hook event with a JSON payload on stdin, and both use
// the same `{ "hooks": { "<Event>": [{ "hooks": [{ "type": "command", … }] }] } }` layout, so one
// installer and one forwarder serve them; what differs is kept here: where the hooks file lives,
// which events exist, and the argument that tells the forwarder who is calling.
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { resolveClaudeConfigDir } from './config.mjs';

/**
 * @typedef {{ event: string, async?: boolean, timeout?: number }} Registration
 * @typedef {object} HookClient
 * @property {'claude'|'codex'} id
 * @property {string} name                       for people: "Claude Code", "Codex"
 * @property {ReadonlyArray<string>} scopes      the first one is the default
 * @property {(scope: string, where: { dir: string, env: NodeJS.ProcessEnv }) => string|null} file
 *   the hooks file for a scope, or null for a scope this client does not have
 * @property {ReadonlyArray<Registration>} registrations
 * @property {string} argument                   passed to the forwarder ('' for Claude Code)
 * @property {string} applyHint                  what to do after a change, for the CLI
 */

/** Observation-only Claude Code events: async, so they never slow Claude down. */
const CLAUDE_ASYNC = Object.freeze([
  'SessionStart',
  'UserPromptSubmit',
  'PreToolUse',
  'PostToolUse',
  'PostToolUseFailure',
  'PermissionDenied',
  'Notification',
  'SubagentStart',
  'SubagentStop',
  'Stop',
  'StopFailure',
  'TaskCreated',
  'TaskCompleted',
  'TeammateIdle',
  'PreCompact',
  'PostCompact',
  'PostModelSwitch',
]);

/** Observation-only Codex events (Codex has no failure, notification or task events). */
const CODEX_ASYNC = Object.freeze([
  'SessionStart',
  'UserPromptSubmit',
  'PreToolUse',
  'PostToolUse',
  'SubagentStart',
  'SubagentStop',
  'Stop',
  'PreCompact',
  'PostCompact',
]);

/** @type {HookClient} */
const CLAUDE = Object.freeze({
  id: 'claude',
  name: 'Claude Code',
  scopes: Object.freeze(['user', 'project', 'local']),
  file(scope, { dir, env }) {
    if (scope === 'user') return join(resolveClaudeConfigDir(env), 'settings.json');
    if (scope === 'project') return join(resolve(dir), '.claude', 'settings.json');
    if (scope === 'local') return join(resolve(dir), '.claude', 'settings.local.json');
    return null;
  },
  registrations: Object.freeze([
    ...CLAUDE_ASYNC.map((event) => Object.freeze({ event, async: true })),
    // Synchronous so the town can answer; Claude Code cancels the hook after 150 s.
    Object.freeze({ event: 'PermissionRequest', timeout: 150 }),
    // Synchronous: async hooks may be killed while the session exits.
    Object.freeze({ event: 'SessionEnd', timeout: 3 }),
  ]),
  argument: '',
  applyHint: 'Claude Code reads hooks when a session starts: restart running sessions to apply this.',
});

/** @type {HookClient} */
const CODEX = Object.freeze({
  id: 'codex',
  name: 'Codex',
  scopes: Object.freeze(['user', 'project']),
  file(scope, { dir, env }) {
    if (scope === 'user') return join(resolveCodexHome(env), 'hooks.json');
    if (scope === 'project') return join(resolve(dir), '.codex', 'hooks.json');
    return null;
  },
  registrations: Object.freeze([
    ...CODEX_ASYNC.map((event) => Object.freeze({ event, async: true })),
    Object.freeze({ event: 'PermissionRequest', timeout: 150 }),
    // Codex gives these two at most 3 s.
    Object.freeze({ event: 'SessionEnd', timeout: 3 }),
    Object.freeze({ event: 'Interrupt', timeout: 3 }),
  ]),
  argument: 'codex',
  applyHint: 'Codex asks you to review new hooks when it starts: choose to trust them (or open /hooks), then start a new session.',
});

export const CLIENTS = Object.freeze({ claude: CLAUDE, codex: CODEX });

/** @typedef {keyof typeof CLIENTS} ClientId */

/**
 * @param {unknown} id
 * @returns {HookClient|null}
 */
export function clientById(id) {
  return typeof id === 'string' && Object.hasOwn(CLIENTS, id) ? CLIENTS[/** @type {ClientId} */ (id)] : null;
}

/**
 * Codex's home folder: CODEX_HOME or ~/.codex.
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {string}
 */
export function resolveCodexHome(env = process.env) {
  return env.CODEX_HOME ? resolve(env.CODEX_HOME) : join(homedir(), '.codex');
}
