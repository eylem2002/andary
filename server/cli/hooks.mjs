// `andary install` and `andary uninstall`.
import { resolveHome } from '../config.mjs';
import { HOOK_REGISTRATIONS, applyHooksChange, buildHooksConfig, hookCommand, planHooksChange } from '../installer.mjs';
import { tildify } from './io.mjs';
import { parseScope } from './options.mjs';

export const HOOKS_OPTIONS = Object.freeze({
  scope: { type: 'string', short: 's' },
  dir: { type: 'string' },
  'dry-run': { type: 'boolean' },
  print: { type: 'boolean' },
});

/**
 * @param {Record<string, any>} values
 * @param {string[]} _positionals
 * @param {import('./io.mjs').CliIo} io
 * @returns {Promise<number>}
 */
export async function runInstall(values, _positionals, io) {
  return changeHooks('install', values, io);
}

/**
 * @param {Record<string, any>} values
 * @param {string[]} _positionals
 * @param {import('./io.mjs').CliIo} io
 * @returns {Promise<number>}
 */
export async function runUninstall(values, _positionals, io) {
  return changeHooks('uninstall', values, io);
}

/**
 * @param {'install'|'uninstall'} action
 * @param {Record<string, any>} values
 * @param {import('./io.mjs').CliIo} io
 * @returns {number}
 */
function changeHooks(action, values, io) {
  const scope = parseScope(values.scope);
  const home = resolveHome(io.env);
  if (values.print) {
    // For people who prefer to merge the JSON into their settings by hand.
    io.out(JSON.stringify({ hooks: buildHooksConfig(hookCommand(home)) }, null, 2));
    return 0;
  }
  let plan;
  try {
    plan = planHooksChange({ action, scope, dir: values.dir ?? io.cwd, home, env: io.env });
  } catch (error) {
    if (error.name !== 'SettingsError') throw error;
    io.err(error.message);
    return 1;
  }
  if (values['dry-run']) {
    describePlan(plan, io);
    return 0;
  }
  let backupPath;
  try {
    ({ backupPath } = applyHooksChange(plan));
  } catch (error) {
    if (error.code !== 'EUNSAFEHOME') throw error;
    io.err(error.message);
    return 1;
  }
  reportResult(plan, backupPath, io);
  return 0;
}

/**
 * @param {import('../installer.mjs').HooksPlan} plan
 * @param {import('./io.mjs').CliIo} io
 */
function describePlan(plan, io) {
  const where = `${tildify(plan.settingsPath)} (${plan.scope} scope)`;
  if (!plan.changed) {
    io.out(`Dry run: ${where} is already up to date; nothing would change.`);
    return;
  }
  io.out(`Dry run: this would update ${where}:`);
  if (plan.removed > 0) io.out(`  remove ${plan.removed} Andary hook entr${plan.removed === 1 ? 'y' : 'ies'}`);
  if (plan.deleteFile) io.out('  delete the file, which Andary created and which would now be empty');
  if (plan.added > 0) io.out(`  add ${plan.added} hook entries (${HOOK_REGISTRATIONS.map((r) => r.event).join(', ')})`);
  if (plan.exists) io.out('  and keep a timestamped backup of the current file next to it.');
  if (plan.action === 'install') io.out(`  It would also copy the hook forwarder to ${tildify(plan.hookPath)}.`);
  io.out('Nothing was written.');
}

/**
 * @param {import('../installer.mjs').HooksPlan} plan
 * @param {string|null} backupPath
 * @param {import('./io.mjs').CliIo} io
 */
function reportResult(plan, backupPath, io) {
  const where = `${tildify(plan.settingsPath)} (${plan.scope} scope)`;
  if (plan.action === 'install') {
    io.out(plan.changed ? `Andary hooks installed in ${where}.` : `Andary hooks are already installed in ${where}.`);
    io.out(`  Forwarder: ${tildify(plan.hookPath)}`);
  } else if (plan.changed) {
    io.out(`Removed ${plan.removed} Andary hook entr${plan.removed === 1 ? 'y' : 'ies'} from ${where}.`);
    if (plan.deleteFile) io.out('  The file only existed for Andary, so it was deleted.');
  } else {
    io.out(`No Andary hooks found in ${where}; nothing to remove.`);
  }
  if (backupPath) io.out(`  Backup of the previous file: ${tildify(backupPath)}`);
  if (plan.changed) io.out('  Claude Code reads hooks when a session starts: restart running sessions to apply this.');
  if (plan.action === 'uninstall' && plan.changed) {
    io.out(`  ${tildify(plan.home)} still holds the forwarder and any recordings; delete it to remove everything.`);
  }
}
