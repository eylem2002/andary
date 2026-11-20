// Registers the Andary hooks in a Claude Code settings file or a Codex hooks file (CONTRACTS
// §4.1) and removes them; what differs between the two lives in clients.mjs.
// Settings files belong to the user and often to other tools too, so the merge is conservative:
// unrelated settings and other hooks are kept as they are, a malformed file is never touched,
// a timestamped backup is written before every change, and running install twice changes nothing.
import { randomBytes } from 'node:crypto';
import {
  chmodSync,
  constants,
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { CLIENTS } from './clients.mjs';
import { HOOK_SOURCE } from './config.mjs';
import { ensureHome } from './state-file.mjs';
import { isObject } from '../public/js/core/text.js';

/** @typedef {import('./clients.mjs').HookClient} HookClient */
/** @typedef {import('./clients.mjs').Registration} Registration */

/** Every command we register ends with this, so uninstall can find exactly our entries. */
const HOOK_MARKER = '# andary';
const MARKER_AT_END = /(?:^|\s)#\s*andary\s*$/;

/** Claude Code's registrations (the default client throughout this module). */
export const HOOK_REGISTRATIONS = CLIENTS.claude.registrations;

/** A problem with a settings file; the message is meant for the user. Nothing was written. */
export class SettingsError extends Error {
  /** @param {string} message */
  constructor(message) {
    super(message);
    this.name = 'SettingsError';
  }
}

/**
 * The hooks file of a client for a scope.
 * @param {string} scope user | project | local (Claude Code only)
 * @param {{ dir?: string, env?: NodeJS.ProcessEnv, client?: HookClient }} [where]
 * @returns {string}
 */
export function settingsPathFor(scope, { dir = process.cwd(), env = process.env, client = CLIENTS.claude } = {}) {
  const file = client.scopes.includes(scope) ? client.file(scope, { dir, env }) : null;
  if (!file) throw new SettingsError(`Unknown scope "${scope}" for ${client.name}. Use ${client.scopes.join(' or ')}.`);
  return file;
}

/**
 * @param {string} home
 * @returns {string}
 */
export function forwarderPath(home) {
  return join(home, 'hook.mjs');
}

/**
 * @param {string} path
 * @returns {string}
 */
function forwardSlashes(path) {
  return path.replace(/\\/g, '/');
}

/**
 * The command the agent runs: `node "<home>/hook.mjs" # andary` for Claude Code and
 * `node "<home>/hook.mjs" codex # andary` for Codex, with forward slashes on every OS (they work
 * in sh, Git Bash and PowerShell alike).
 * @param {string} home
 * @param {HookClient} [client]
 * @returns {string}
 */
export function hookCommand(home, client = CLIENTS.claude) {
  const target = forwardSlashes(forwarderPath(home));
  // These characters would change the meaning of a double-quoted shell word.
  if (/["`$]/.test(target)) {
    throw new SettingsError(`The path ${target} contains " \` or $, which cannot be used in a hook command. Set ANDARY_HOME to a simpler folder.`);
  }
  return `node "${target}"${client.argument ? ` ${client.argument}` : ''} ${HOOK_MARKER}`;
}

/**
 * @param {string} command
 * @param {Registration} registration
 * @returns {Record<string, any>}
 */
function hookEntry(command, registration) {
  return {
    type: 'command',
    command,
    ...(registration.async ? { async: true } : {}),
    ...(registration.timeout ? { timeout: registration.timeout } : {}),
  };
}

/**
 * The `hooks` object Andary registers (also the content of the plugin's hooks/hooks.json).
 * Tool events have no matcher, so they match every tool.
 * @param {string} command
 * @param {HookClient} [client]
 * @returns {Record<string, Array<{ hooks: Array<Record<string, any>> }>>}
 */
export function buildHooksConfig(command, client = CLIENTS.claude) {
  return Object.fromEntries(client.registrations.map((r) => [r.event, [{ hooks: [hookEntry(command, r)] }]]));
}

/**
 * Ours if the command ends with the marker, or (entries from older versions) runs our forwarder.
 * @param {unknown} entry
 * @param {string} [hookPath]
 * @returns {boolean}
 */
export function isAndaryHook(entry, hookPath) {
  if (!isObject(entry) || typeof entry.command !== 'string') return false;
  if (MARKER_AT_END.test(entry.command)) return true;
  if (!hookPath) return false;
  return forwardSlashes(entry.command).toLowerCase().includes(forwardSlashes(hookPath).toLowerCase());
}

/**
 * Removes our entries from a `hooks` map. A matcher group or event list that becomes empty
 * because of that is dropped (we created it), unless its event is in `keepEvents`; containers
 * that were already empty stay.
 * @param {Record<string, any>} hooksMap
 * @param {(entry: unknown) => boolean} isOurs
 * @param {Set<string>} [keepEvents] event lists to keep in place even when emptied
 * @returns {{ hooks: Record<string, any>, removed: number }}
 */
function stripHooks(hooksMap, isOurs, keepEvents = new Set()) {
  let removed = 0;
  /** @type {Array<[string, any]>} */
  const kept = [];
  for (const [event, groups] of Object.entries(hooksMap)) {
    if (!Array.isArray(groups)) {
      kept.push([event, groups]);
      continue;
    }
    const keptGroups = [];
    for (const group of groups) {
      const result = stripGroup(group, isOurs);
      removed += result.removed;
      if (result.group !== null) keptGroups.push(result.group);
    }
    if (keptGroups.length > 0 || groups.length === 0 || keepEvents.has(event)) kept.push([event, keptGroups]);
  }
  // fromEntries defines own properties, so an event named "__proto__" stays plain data.
  return { hooks: Object.fromEntries(kept), removed };
}

/**
 * @param {unknown} group
 * @param {(entry: unknown) => boolean} isOurs
 * @returns {{ group: any, removed: number }}
 */
function stripGroup(group, isOurs) {
  if (!isObject(group) || !Array.isArray(group.hooks)) return { group, removed: 0 };
  const keptHooks = group.hooks.filter((entry) => !isOurs(entry));
  const removed = group.hooks.length - keptHooks.length;
  if (removed === 0) return { group, removed: 0 };
  return { group: keptHooks.length === 0 ? null : { ...group, hooks: keptHooks }, removed };
}

/**
 * Pure: the settings with our previous entries replaced by one fresh group per registered event.
 * @param {Record<string, any>} settings
 * @param {{ command: string, hookPath: string, client?: HookClient }} options
 * @returns {Record<string, any>}
 */
export function withAndaryHooks(settings, { command, hookPath, client = CLIENTS.claude }) {
  const current = settings.hooks ?? {};
  if (!isObject(current)) throw new SettingsError('"hooks" in the settings file is not an object; nothing was changed.');
  // Our event lists stay where they are while being refilled, so re-installing never reorders.
  const registered = new Set(client.registrations.map((r) => r.event));
  const { hooks } = stripHooks(current, (entry) => isAndaryHook(entry, hookPath), registered);
  for (const registration of client.registrations) {
    const groups = hooks[registration.event] ?? [];
    if (!Array.isArray(groups)) {
      throw new SettingsError(`"hooks.${registration.event}" in the settings file is not a list; nothing was changed.`);
    }
    hooks[registration.event] = [...groups, { hooks: [hookEntry(command, registration)] }];
  }
  // Spreading keeps "hooks" at its old position when it already existed.
  return { ...settings, hooks };
}

/**
 * What a settings file looked like before Andary first changed it. Uninstall uses it to
 * remove only the containers we created: lists and objects that were already there (empty)
 * stay, and a file we created is deleted again once nothing else is in it.
 * @typedef {object} OriginalShape
 * @property {boolean} createdFile
 * @property {boolean} emptyHooks     "hooks" existed as an empty object
 * @property {string[]} emptyEvents   event lists that existed and were empty
 */

/** @type {OriginalShape} */
const UNKNOWN_SHAPE = Object.freeze({ createdFile: false, emptyHooks: false, emptyEvents: [] });

/**
 * Pure: the settings without our entries, minus the containers we emptied (see OriginalShape).
 * @param {Record<string, any>} settings
 * @param {string} hookPath
 * @param {OriginalShape} [shape]
 * @returns {{ settings: Record<string, any>, removed: number }}
 */
export function withoutAndaryHooks(settings, hookPath, shape = UNKNOWN_SHAPE) {
  if (!isObject(settings.hooks)) return { settings, removed: 0 };
  const isOurs = (/** @type {unknown} */ entry) => isAndaryHook(entry, hookPath);
  const { hooks, removed } = stripHooks(settings.hooks, isOurs, new Set(shape.emptyEvents));
  if (removed === 0) return { settings, removed };
  const next = { ...settings, hooks };
  if (Object.keys(hooks).length === 0 && !shape.emptyHooks) delete next.hooks;
  return { settings: next, removed };
}

/**
 * @param {{ exists: boolean, settings: Record<string, any> }} file
 * @param {OriginalShape} [previous] recorded at an earlier install of the same file
 * @returns {OriginalShape}
 */
function originalShape(file, previous) {
  const hooks = file.settings.hooks;
  const emptyNow = isObject(hooks)
    ? Object.entries(hooks).filter(([, groups]) => Array.isArray(groups) && groups.length === 0).map(([event]) => event)
    : [];
  return {
    createdFile: previous ? previous.createdFile : !file.exists,
    emptyHooks: Boolean(previous?.emptyHooks) || (isObject(hooks) && Object.keys(hooks).length === 0),
    emptyEvents: [...new Set([...(previous?.emptyEvents ?? []), ...emptyNow])],
  };
}

const RECORD_FILE = 'installs.json';

/**
 * Original shapes of the settings files we changed, keyed by absolute path.
 * @param {string} home
 * @returns {Record<string, OriginalShape>}
 */
function readRecords(home) {
  try {
    const records = JSON.parse(readFileSync(join(home, RECORD_FILE), 'utf8'));
    return isObject(records) ? records : {};
  } catch {
    return {};
  }
}

/**
 * @param {string} home
 * @param {string} key
 * @param {OriginalShape|null} shape null forgets the entry
 */
function saveRecord(home, key, shape) {
  const records = readRecords(home);
  if (shape) records[key] = shape;
  else if (key in records) delete records[key];
  else return;
  ensureHome(home);
  writeFileAtomic(join(home, RECORD_FILE), `${JSON.stringify(records, null, 2)}\n`);
}

/**
 * Events that have at least one Andary entry.
 * @param {Record<string, any>} settings
 * @param {string} [hookPath]
 * @returns {string[]}
 */
function registeredEvents(settings, hookPath) {
  if (!isObject(settings.hooks)) return [];
  return Object.entries(settings.hooks)
    .filter(
      ([, groups]) =>
        Array.isArray(groups) &&
        groups.some((group) => isObject(group) && Array.isArray(group.hooks) && group.hooks.some((e) => isAndaryHook(e, hookPath))),
    )
    .map(([event]) => event);
}

/**
 * Whether these settings enable the Andary plugin (from any marketplace; Claude Code only).
 * @param {Record<string, any>} settings
 * @returns {boolean}
 */
function pluginEnabledIn(settings) {
  const enabled = settings.enabledPlugins;
  return isObject(enabled) && Object.entries(enabled).some(([id, on]) => id.startsWith('andary@') && on === true);
}

/**
 * Reads a settings file. A missing or blank file reads as {}. Malformed JSON throws
 * SettingsError without echoing the file's content (settings may hold API keys in "env").
 * @param {string} filePath
 * @returns {{ exists: boolean, text: string|null, settings: Record<string, any> }}
 */
function readSettingsFile(filePath) {
  let text;
  try {
    text = readFileSync(filePath, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return { exists: false, text: null, settings: {} };
    throw new SettingsError(`Cannot read ${filePath} (${error.code ?? 'error'}); nothing was changed.`);
  }
  if (text.trim() === '') return { exists: true, text, settings: {} };
  let settings;
  try {
    settings = JSON.parse(text.replace(/^\uFEFF/, ''));
  } catch (error) {
    throw new SettingsError(`${filePath} is not valid JSON${jsonErrorLocation(error)}. Fix it and run the command again; nothing was changed.`);
  }
  if (!isObject(settings)) throw new SettingsError(`${filePath} does not contain a JSON object; nothing was changed.`);
  return { exists: true, text, settings };
}

/**
 * Only the position from V8's message: newer versions also quote the offending text.
 * @param {Error} error
 * @returns {string}
 */
function jsonErrorLocation(error) {
  const lineColumn = /line (\d+) column (\d+)/.exec(error.message);
  if (lineColumn) return ` (line ${lineColumn[1]}, column ${lineColumn[2]})`;
  const position = /position (\d+)/.exec(error.message);
  return position ? ` (at character ${position[1]})` : '';
}

/**
 * Keeps the file's own indentation and line endings, so a re-write only shows real changes.
 * @param {string|null} text
 * @returns {{ indent: string, newline: string }}
 */
function detectFormat(text) {
  const indent = text ? /^([ \t]+)\S/m.exec(text)?.[1] ?? '  ' : '  ';
  return { indent: indent.slice(0, 10), newline: text?.includes('\r\n') ? '\r\n' : '\n' };
}

/**
 * @param {Record<string, any>} settings
 * @param {{ indent: string, newline: string }} format
 * @returns {string}
 */
function serialize(settings, format) {
  const json = JSON.stringify(settings, null, format.indent);
  return `${format.newline === '\n' ? json : json.replace(/\n/g, '\r\n')}${format.newline}`;
}

/**
 * @typedef {object} HooksPlan
 * @property {'install'|'uninstall'} action
 * @property {HookClient} client
 * @property {string} scope
 * @property {string} settingsPath
 * @property {string} home
 * @property {string} hookPath         the forwarder copy referenced by the hook commands
 * @property {boolean} exists          whether the settings file exists now
 * @property {boolean} changed         whether the settings file would change
 * @property {Record<string, any>} after
 * @property {string} output           the new file content
 * @property {number} removed          Andary entries removed (old ones on install)
 * @property {number} added            entries added
 * @property {OriginalShape} shape     the file's shape before Andary first changed it
 * @property {boolean} deleteFile      uninstall: the file was ours and is empty again
 */

/**
 * Works out a change without writing anything (used by --dry-run as well).
 * @param {{ action: 'install'|'uninstall', scope: string, dir?: string, home: string, env?: NodeJS.ProcessEnv, client?: HookClient }} options
 * @returns {HooksPlan}
 */
export function planHooksChange({ action, scope, dir, home, env, client = CLIENTS.claude }) {
  const settingsPath = settingsPathFor(scope, { dir, env, client });
  const hookPath = forwarderPath(home);
  const file = readSettingsFile(settingsPath);
  const recorded = readRecords(home)[resolve(settingsPath)];
  const shape = action === 'install' ? originalShape(file, recorded) : (recorded ?? UNKNOWN_SHAPE);
  const { settings: stripped, removed } = withoutAndaryHooks(file.settings, hookPath, shape);
  const after = action === 'install' ? withAndaryHooks(file.settings, { command: hookCommand(home, client), hookPath, client }) : stripped;
  return {
    action,
    client,
    scope,
    settingsPath,
    home,
    hookPath,
    exists: file.exists,
    changed: JSON.stringify(after) !== JSON.stringify(file.settings),
    after,
    output: serialize(after, detectFormat(file.text)),
    removed,
    added: action === 'install' ? client.registrations.length : 0,
    shape,
    deleteFile: action === 'uninstall' && file.exists && shape.createdFile && removed > 0 && Object.keys(after).length === 0,
  };
}

/**
 * Writes a planned change: backup first, then an atomic replace. On install the forwarder is
 * copied to <home>/hook.mjs as well (refreshing an older copy).
 * @param {HooksPlan} plan
 * @param {{ now?: Date }} [options]
 * @returns {{ backupPath: string|null, written: boolean }}
 */
export function applyHooksChange(plan, { now = new Date() } = {}) {
  let backupPath = null;
  if (plan.changed) {
    mkdirSync(dirname(plan.settingsPath), { recursive: true });
    // Settings are often symlinks into a dotfiles repo: write through the link, not over it.
    const target = plan.exists ? realpathSync(plan.settingsPath) : plan.settingsPath;
    if (plan.exists) backupPath = backupFile(target, now);
    if (plan.deleteFile) unlinkSync(target);
    else writeFileAtomic(target, plan.output);
  }
  const key = resolve(plan.settingsPath);
  if (plan.action === 'install') {
    copyForwarder(plan.home);
    saveRecord(plan.home, key, plan.shape);
  } else {
    saveRecord(plan.home, key, null);
  }
  return { backupPath, written: plan.changed };
}

/**
 * @param {string} filePath
 * @param {Date} now
 * @returns {string}
 */
function backupFile(filePath, now) {
  const stamp = now.toISOString().replace(/[:.]/g, '-');
  for (let attempt = 1; ; attempt += 1) {
    const candidate = `${filePath}.andary-backup-${stamp}${attempt > 1 ? `-${attempt}` : ''}`;
    try {
      copyFileSync(filePath, candidate, constants.COPYFILE_EXCL);
      return candidate;
    } catch (error) {
      if (error.code !== 'EEXIST' || attempt >= 100) throw error;
    }
  }
}

/**
 * @param {string} filePath
 * @param {string} text
 */
function writeFileAtomic(filePath, text) {
  const mode = existsSync(filePath) ? statSync(filePath).mode & 0o777 : 0o644;
  // A project's .claude/ folder comes from its repository, which may be hostile: a predictable
  // temp name could be a planted symlink that redirects this write (to ~/.bashrc, say). The name
  // is random and created exclusively ('wx' fails on anything already there, links included).
  const temp = `${filePath}.andary-${randomBytes(8).toString('hex')}.tmp`;
  writeFileSync(temp, text, { mode, flag: 'wx' });
  chmodSync(temp, mode);
  renameSync(temp, filePath);
}

/**
 * Copies hooks/hook.mjs to <home>/hook.mjs.
 * @param {string} home
 * @returns {string} the destination
 */
function copyForwarder(home) {
  ensureHome(home);
  const target = forwarderPath(home);
  copyFileSync(HOOK_SOURCE, target);
  return target;
}

/**
 * Re-copies the forwarder if an installed copy exists and differs from this version's.
 * @param {string} home
 * @returns {boolean} whether it was updated
 */
export function refreshForwarder(home) {
  const target = forwarderPath(home);
  try {
    if (readFileSync(target, 'utf8') === readFileSync(HOOK_SOURCE, 'utf8')) return false;
  } catch {
    return false;
  }
  copyFileSync(HOOK_SOURCE, target);
  return true;
}

/**
 * @typedef {object} ScopeReport
 * @property {HookClient} client
 * @property {string} scope
 * @property {string} settingsPath
 * @property {string[]} events     events that have an Andary entry
 * @property {boolean} complete    all registrations present
 * @property {boolean} plugin      this file enables the Andary plugin
 * @property {string|null} error   unreadable or malformed file
 */

/**
 * Where Andary is registered: each scope of each client for `dir`, plus the Claude Code plugin.
 * `scopes` lists Claude Code's scopes first, then Codex's.
 * @param {{ dir?: string, env?: NodeJS.ProcessEnv, home: string, clients?: HookClient[] }} options
 * @returns {{ scopes: ScopeReport[], plugin: boolean, installed: boolean }}
 */
export function inspectInstallations({ dir, env, home, clients = Object.values(CLIENTS) }) {
  const hookPath = forwarderPath(home);
  const seen = new Set();
  /** @type {ScopeReport[]} */
  const scopes = [];
  for (const client of clients) {
    for (const scope of client.scopes) {
      const settingsPath = settingsPathFor(scope, { dir, env, client });
      // In the home folder, the project file is the user file: report it once.
      if (seen.has(settingsPath)) continue;
      seen.add(settingsPath);
      scopes.push(inspectScope(client, scope, settingsPath, hookPath));
    }
  }
  const plugin = scopes.some((report) => report.plugin);
  return { scopes, plugin, installed: plugin || scopes.some((report) => report.events.length > 0) };
}

/**
 * @param {HookClient} client
 * @param {string} scope
 * @param {string} settingsPath
 * @param {string} hookPath
 * @returns {ScopeReport}
 */
function inspectScope(client, scope, settingsPath, hookPath) {
  try {
    const { settings } = readSettingsFile(settingsPath);
    const events = registeredEvents(settings, hookPath);
    const complete = client.registrations.every((r) => events.includes(r.event));
    return { client, scope, settingsPath, events, complete, plugin: client.id === 'claude' && pluginEnabledIn(settings), error: null };
  } catch (error) {
    return { client, scope, settingsPath, events: [], complete: false, plugin: false, error: error.message };
  }
}
