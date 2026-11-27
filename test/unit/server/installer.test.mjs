import assert from 'node:assert/strict';
import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { HOOK_SOURCE } from '../../../server/config.mjs';
import { ensureHome } from '../../../server/state-file.mjs';
import { CANNOT_SYMLINK } from './helpers.mjs';
import {
  SettingsError,
  applyHooksChange,
  buildHooksConfig,
  forwarderPath,
  holdCheckInstalled,
  hookCommand,
  inspectInstallations,
  isAndaryHook,
  planHooksChange,
  refreshForwarder,
  settingsPathFor,
  withAndaryHooks,
  withoutAndaryHooks,
} from '../../../server/installer.mjs';
import { CLIENTS } from '../../../server/clients.mjs';
import { describeScope } from '../../../server/cli/status.mjs';

/** Claude Code's registrations, the installer's default client. */
const HOOK_REGISTRATIONS = CLIENTS.claude.registrations;

/** @type {string} */
let dir;
/** @type {string} */
let home;
/** @type {NodeJS.ProcessEnv} */
let env;
/** @type {string} */
let userSettings;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'tt-install-'));
  home = join(dir, 'tt-home');
  env = { CLAUDE_CONFIG_DIR: join(dir, 'claude'), CODEX_HOME: join(dir, 'codex') };
  userSettings = join(dir, 'claude', 'settings.json');
});

afterEach(() => rmSync(dir, { recursive: true, force: true }));

/**
 * @param {'install'|'uninstall'} action
 * @param {string} [scope]
 */
function run(action, scope = 'user', now = new Date('2026-11-16T10:00:00.000Z')) {
  const plan = planHooksChange({ action, scope, dir: join(dir, 'project'), home, env });
  return { plan, ...applyHooksChange(plan, { now }) };
}

/**
 * @param {string} file
 * @param {unknown} value
 */
function writeJson(file, value, indent = 2) {
  mkdirSync(join(file, '..'), { recursive: true });
  writeFileSync(file, `${JSON.stringify(value, null, indent)}\n`);
}

const readJson = (/** @type {string} */ file) => JSON.parse(readFileSync(file, 'utf8'));
const backupsOf = (/** @type {string} */ file) => readdirSync(join(file, '..')).filter((name) => name.includes('.andary-backup-'));

describe('registration table', () => {
  it('matches CONTRACTS §4.1', () => {
    assert.equal(HOOK_REGISTRATIONS.filter((r) => r.async).length, 17);
    assert.deepEqual(HOOK_REGISTRATIONS.at(-3), { event: 'PermissionRequest', timeout: 150 });
    assert.deepEqual(HOOK_REGISTRATIONS.at(-2), { event: 'SessionEnd', timeout: 3 });
    assert.deepEqual(HOOK_REGISTRATIONS.at(-1), { event: 'PreToolUse', matcher: 'Bash|PowerShell', argument: 'hold', timeout: 5 });
    const config = buildHooksConfig('node "/h/hook.mjs" # andary');
    // Every tool, async; then the hold check for shell commands, synchronous, in a group of its own.
    assert.deepEqual(config.PreToolUse, [
      { hooks: [{ type: 'command', command: 'node "/h/hook.mjs" # andary', async: true }] },
      { matcher: 'Bash|PowerShell', hooks: [{ type: 'command', command: 'node "/h/hook.mjs" hold # andary', timeout: 5 }] },
    ]);
    assert.equal(config.PreToolUse[0].matcher, undefined);
    assert.deepEqual(Object.keys(buildHooksConfig('node "/h/hook.mjs" codex # andary', CLIENTS.codex)).filter((event) => event === 'PreToolUse'), ['PreToolUse']);
    assert.equal(buildHooksConfig('x # andary', CLIENTS.codex).PreToolUse.length, 1, 'Codex is never held');
    for (const event of ['WorktreeCreate', 'WorktreeRemove', 'MessageDisplay', 'ConfigChange', 'FileChanged', 'Setup']) {
      assert.equal(config[event], undefined, event);
    }
  });

  it('writes forward slashes and refuses paths that would break the shell command', () => {
    assert.equal(hookCommand('C:\\Users\\me\\.andary'), 'node "C:/Users/me/.andary/hook.mjs" # andary');
    assert.throws(() => hookCommand('/tmp/a"b'), SettingsError);
    assert.throws(() => hookCommand('/tmp/$HOME'), SettingsError);
  });

  it('resolves the settings file of each scope', () => {
    assert.equal(settingsPathFor('user', { env }), userSettings);
    // Paths are resolved: on Windows '/repo' is D:\\repo.
    assert.equal(settingsPathFor('project', { dir: '/repo', env }), join(resolve('/repo'), '.claude', 'settings.json'));
    assert.equal(settingsPathFor('local', { dir: '/repo', env }), join(resolve('/repo'), '.claude', 'settings.local.json'));
    assert.throws(() => settingsPathFor('global', { env }), SettingsError);
  });

  it('recognises our entries by marker or by forwarder path', () => {
    assert.ok(isAndaryHook({ type: 'command', command: 'node "/x/hook.mjs" # andary' }));
    assert.ok(isAndaryHook({ type: 'command', command: 'node /h/hook.mjs' }, '/h/hook.mjs'));
    assert.ok(!isAndaryHook({ type: 'command', command: 'echo "# andary-ish thing" && ls' }));
    assert.ok(!isAndaryHook({ type: 'command', command: 'node other.mjs' }, '/h/hook.mjs'));
    assert.ok(!isAndaryHook(null));
  });
});

describe('install', () => {
  it('creates the settings file and copies the forwarder when nothing exists', () => {
    const { plan, backupPath, written } = run('install');
    assert.ok(written);
    assert.equal(backupPath, null);
    const settings = readJson(userSettings);
    assert.deepEqual(Object.keys(settings.hooks), [...new Set(HOOK_REGISTRATIONS.map((r) => r.event))]);
    assert.match(settings.hooks.PreToolUse[1].hooks[0].command, / hold # andary$/);
    assert.equal(settings.hooks.PermissionRequest[0].hooks[0].timeout, 150);
    assert.equal(settings.hooks.SessionEnd[0].hooks[0].timeout, 3);
    assert.equal(settings.hooks.SessionEnd[0].hooks[0].async, undefined);
    assert.equal(readFileSync(forwarderPath(home), 'utf8'), readFileSync(HOOK_SOURCE, 'utf8'));
    assert.equal(plan.added, HOOK_REGISTRATIONS.length);
  });

  it('keeps unrelated settings and other people\'s hooks, in place', () => {
    const theirs = { type: 'command', command: 'prettier --write' };
    writeJson(userSettings, {
      model: 'opus',
      hooks: { PostToolUse: [{ matcher: 'Write|Edit', hooks: [theirs] }], Notification: [] },
      env: { FOO: '1' },
    });
    run('install');
    const settings = readJson(userSettings);
    assert.deepEqual(Object.keys(settings), ['model', 'hooks', 'env']);
    assert.equal(settings.model, 'opus');
    assert.deepEqual(settings.env, { FOO: '1' });
    assert.deepEqual(settings.hooks.PostToolUse[0], { matcher: 'Write|Edit', hooks: [theirs] });
    assert.ok(isAndaryHook(settings.hooks.PostToolUse[1].hooks[0]));
    assert.equal(settings.hooks.Notification.length, 1);
  });

  it('is idempotent: a second run changes nothing and writes no backup', () => {
    writeJson(userSettings, { hooks: { Stop: [{ hooks: [{ type: 'command', command: 'say done' }] }] }, after: true });
    run('install');
    const once = readFileSync(userSettings, 'utf8');
    const backups = backupsOf(userSettings).length;
    const second = run('install');
    assert.equal(second.written, false);
    assert.equal(readFileSync(userSettings, 'utf8'), once);
    assert.equal(backupsOf(userSettings).length, backups);
  });

  it('stays idempotent when an empty event list came before other keys', () => {
    writeJson(userSettings, { hooks: { Stop: [], PostToolUse: [{ hooks: [{ type: 'command', command: 'lint' }] }] } });
    run('install');
    const once = readFileSync(userSettings, 'utf8');
    assert.equal(run('install').written, false);
    assert.equal(readFileSync(userSettings, 'utf8'), once);
    assert.deepEqual(Object.keys(readJson(userSettings).hooks).slice(0, 2), ['Stop', 'PostToolUse']);
  });

  it('replaces entries from older installs instead of adding duplicates', () => {
    writeJson(userSettings, {
      hooks: {
        PreToolUse: [{ hooks: [{ type: 'command', command: `node "${forwarderPath(home)}"` }] }],
        Stop: [{ hooks: [{ type: 'command', command: 'node "/old/place/hook.mjs" # andary', async: true }] }],
      },
    });
    const { plan } = run('install');
    assert.equal(plan.removed, 2);
    const settings = readJson(userSettings);
    // Ours: every tool (async), and the hold check for shell commands.
    assert.equal(settings.hooks.PreToolUse.length, 2);
    assert.equal(settings.hooks.Stop.length, 1);
    // The command names the forwarder with forward slashes on every system.
    assert.match(settings.hooks.Stop[0].hooks[0].command, new RegExp(home.replaceAll('\\', '/').replace(/[\\^$.*+?()[\]{}|]/g, '\\$&')));
  });

  it('writes a timestamped backup of the previous file before changing it', () => {
    writeJson(userSettings, { model: 'sonnet' });
    const { backupPath } = run('install');
    assert.ok(backupPath?.endsWith('settings.json.andary-backup-2026-11-16T10-00-00-000Z'));
    assert.deepEqual(readJson(/** @type {string} */ (backupPath)), { model: 'sonnet' });
    // Same timestamp again: a second backup gets a suffix rather than overwriting the first.
    writeJson(userSettings, { model: 'haiku' });
    assert.ok(run('install').backupPath?.endsWith('-2'));
  });

  it('keeps the file\'s indentation and permissions', () => {
    writeJson(userSettings, { model: 'opus' }, 4);
    chmodSync(userSettings, 0o600);
    run('install');
    assert.match(readFileSync(userSettings, 'utf8'), /^\{\n {4}"model"/);
    if (process.platform !== 'win32') assert.equal(statSync(userSettings).mode & 0o777, 0o600);
  });

  it('writes through a symlinked settings file instead of replacing the link', { skip: process.platform === 'win32' }, () => {
    const real = join(dir, 'dotfiles', 'settings.json');
    writeJson(real, { model: 'opus' });
    mkdirSync(join(dir, 'claude'), { recursive: true });
    symlinkSync(real, userSettings);
    run('install');
    assert.ok(lstatSync(userSettings).isSymbolicLink());
    assert.ok(readJson(real).hooks);
  });

  it('aborts without writing when the file is not valid JSON, and does not echo its content', () => {
    mkdirSync(join(dir, 'claude'), { recursive: true });
    const broken = '{ "env": { "API_KEY": "sk-should-not-be-printed" }, }';
    writeFileSync(userSettings, broken);
    assert.throws(
      () => planHooksChange({ action: 'install', scope: 'user', home, env }),
      (error) => error instanceof SettingsError && /not valid JSON/.test(error.message) && !error.message.includes('sk-should'),
    );
    assert.equal(readFileSync(userSettings, 'utf8'), broken);
    assert.equal(backupsOf(userSettings).length, 0);
    assert.ok(!existsSync(forwarderPath(home)));
  });

  it('aborts when the JSON is not an object or hooks has the wrong shape', () => {
    writeJson(userSettings, ['not', 'an', 'object']);
    assert.throws(() => planHooksChange({ action: 'install', scope: 'user', home, env }), SettingsError);
    writeJson(userSettings, { hooks: { Stop: 'nope' } });
    assert.throws(() => planHooksChange({ action: 'install', scope: 'user', home, env }), /hooks.Stop/);
    writeJson(userSettings, { hooks: [] });
    assert.throws(() => planHooksChange({ action: 'install', scope: 'user', home, env }), /not an object/);
  });

  it('treats an empty file as empty settings', () => {
    mkdirSync(join(dir, 'claude'), { recursive: true });
    writeFileSync(userSettings, '  \n');
    run('install');
    assert.ok(readJson(userSettings).hooks.SessionStart);
  });

  it('dry runs plan without writing anything', () => {
    writeJson(userSettings, { model: 'opus' });
    const before = readFileSync(userSettings, 'utf8');
    const plan = planHooksChange({ action: 'install', scope: 'user', home, env });
    assert.ok(plan.changed);
    assert.equal(readFileSync(userSettings, 'utf8'), before);
    assert.ok(!existsSync(forwarderPath(home)));
  });

  it('installs into project and local scopes under --dir', () => {
    run('install', 'project');
    run('install', 'local');
    assert.ok(readJson(join(dir, 'project', '.claude', 'settings.json')).hooks.Stop);
    assert.ok(readJson(join(dir, 'project', '.claude', 'settings.local.json')).hooks.Stop);
  });
});

describe('uninstall', () => {
  it('removes only our entries and the containers we emptied', () => {
    const theirs = { type: 'command', command: 'prettier --write' };
    writeJson(userSettings, {
      model: 'opus',
      hooks: { PostToolUse: [{ matcher: 'Write', hooks: [theirs] }], Stop: [] },
    });
    run('install');
    const { plan } = run('uninstall');
    assert.equal(plan.removed, HOOK_REGISTRATIONS.length);
    // The pre-existing empty Stop list stays: we did not create it.
    assert.deepEqual(readJson(userSettings), { model: 'opus', hooks: { PostToolUse: [{ matcher: 'Write', hooks: [theirs] }], Stop: [] } });
  });

  it('keeps a pre-existing empty hooks object', () => {
    writeJson(userSettings, { hooks: {} });
    run('install');
    run('uninstall');
    assert.deepEqual(readJson(userSettings), { hooks: {} });
  });

  it('deletes the settings file again if install created it and nothing else was added', () => {
    run('install');
    assert.ok(existsSync(join(home, 'installs.json')));
    const { backupPath } = run('uninstall', 'user', new Date('2026-11-16T12:00:00.000Z'));
    assert.ok(!existsSync(userSettings));
    assert.ok(backupPath && existsSync(backupPath));
    assert.deepEqual(readJson(join(home, 'installs.json')), {});
  });

  it('keeps a file install created once someone else wrote to it', () => {
    run('install');
    writeJson(userSettings, { ...readJson(userSettings), model: 'opus' });
    run('uninstall');
    assert.deepEqual(readJson(userSettings), { model: 'opus' });
  });

  it('falls back to dropping every container it emptied when the record is gone', () => {
    writeJson(userSettings, { hooks: { Stop: [] } });
    run('install');
    rmSync(join(home, 'installs.json'));
    run('uninstall');
    assert.deepEqual(readJson(userSettings), {});
  });

  it('drops the hooks object when only our entries were in it', () => {
    writeJson(userSettings, { model: 'opus' });
    run('install');
    run('uninstall');
    assert.deepEqual(readJson(userSettings), { model: 'opus' });
  });

  it('keeps someone else\'s hook that shares a group with ours', () => {
    const settings = withAndaryHooks({}, { command: hookCommand(home), hookPath: forwarderPath(home) });
    settings.hooks.Stop[0].hooks.push({ type: 'command', command: 'say done' });
    const { settings: after } = withoutAndaryHooks(settings, forwarderPath(home));
    assert.deepEqual(after.hooks, { Stop: [{ hooks: [{ type: 'command', command: 'say done' }] }] });
  });

  it('does nothing (and creates nothing) when there is nothing to remove', () => {
    const { written } = run('uninstall');
    assert.equal(written, false);
    assert.ok(!existsSync(userSettings));
    writeJson(userSettings, { hooks: {} });
    assert.equal(run('uninstall').written, false);
    assert.deepEqual(readJson(userSettings), { hooks: {} });
  });

  it('backs up before removing', () => {
    run('install');
    const { backupPath } = run('uninstall', 'user', new Date('2026-11-16T11:00:00.000Z'));
    assert.ok(backupPath && readJson(backupPath).hooks.SessionStart);
  });
});

describe('inspection helpers', () => {
  it('reports each scope and the plugin', () => {
    run('install');
    writeJson(join(dir, 'project', '.claude', 'settings.local.json'), { enabledPlugins: { 'andary@andary': true } });
    const report = inspectInstallations({ dir: join(dir, 'project'), env, home });
    const byScope = Object.fromEntries(report.scopes.filter((s) => s.client.id === 'claude').map((s) => [s.scope, s]));
    assert.ok(byScope.user.complete);
    assert.equal(byScope.project.events.length, 0);
    assert.equal(byScope.local.plugin, true);
    assert.ok(report.plugin && report.installed);
    assert.equal(report.limitsMod, false);
  });

  it('notices the andary-limits mod, which is no hooks of its own', () => {
    writeJson(join(dir, 'project', '.claude', 'settings.json'), { enabledPlugins: { 'andary-limits@andary': true, 'andary@andary': false } });
    const report = inspectInstallations({ dir: join(dir, 'project'), env, home });
    assert.equal(report.limitsMod, true);
    assert.equal(report.plugin, false, 'the mod is not the andary plugin');
    assert.equal(report.installed, false, 'it sends limits, not events');
  });

  it('an install from before the hold check is not a whole one, and says how to fix it', () => {
    run('install');
    assert.equal(holdCheckInstalled({ dir: join(dir, 'project'), env, home }), true);
    const settings = readJson(userSettings);
    settings.hooks.PreToolUse = settings.hooks.PreToolUse.filter((/** @type {any} */ group) => !group.matcher);
    writeJson(userSettings, settings);
    const report = inspectInstallations({ dir: join(dir, 'project'), env, home });
    const user = report.scopes.find((s) => s.client.id === 'claude' && s.scope === 'user');
    assert.ok(user);
    assert.equal(user.complete, false);
    assert.equal(user.holdMissing, true);
    assert.match(describeScope(user), /installed, but the hold check is missing .*; run install again$/);
    assert.equal(holdCheckInstalled({ dir: join(dir, 'project'), env, home }), false);
  });

  it('counts the plugin as holding only when its installed copy registers the hold check', () => {
    writeJson(userSettings, { enabledPlugins: { 'andary@andary': true } });
    const where = { dir: join(dir, 'project'), env, home };
    assert.equal(holdCheckInstalled(where), false, 'no installed copy found');
    const copy = (/** @type {string} */ version, /** @type {object} */ hooks) => writeJson(join(dir, 'claude', 'plugins', 'cache', 'andary', 'andary', version, 'hooks', 'hooks.json'), { hooks });
    const plain = { PreToolUse: [{ hooks: [{ type: 'command', command: 'node "${CLAUDE_PLUGIN_ROOT}/hooks/hook.mjs" # andary', async: true }] }] };
    copy('0.1.0', plain);
    assert.equal(holdCheckInstalled(where), false, 'an older copy has no hold check');
    copy('0.2.0', buildHooksConfig('node "${CLAUDE_PLUGIN_ROOT}/hooks/hook.mjs" # andary'));
    assert.equal(holdCheckInstalled(where), true);
  });

  it('flags partial installs and unreadable files', () => {
    writeJson(userSettings, { hooks: { Stop: [{ hooks: [{ type: 'command', command: 'node x # andary' }] }] } });
    mkdirSync(join(dir, 'project', '.claude'), { recursive: true });
    writeFileSync(join(dir, 'project', '.claude', 'settings.json'), '{oops');
    const report = inspectInstallations({ dir: join(dir, 'project'), env, home });
    const byScope = Object.fromEntries(report.scopes.filter((s) => s.client.id === 'claude').map((s) => [s.scope, s]));
    assert.deepEqual(byScope.user.events, ['Stop']);
    assert.equal(byScope.user.complete, false);
    assert.match(byScope.project.error ?? '', /not valid JSON/);
  });

  it('refreshes an outdated forwarder copy only when one exists', () => {
    assert.equal(refreshForwarder(home), false);
    mkdirSync(home, { recursive: true });
    writeFileSync(forwarderPath(home), '// old version');
    assert.equal(refreshForwarder(home), true);
    assert.equal(readFileSync(forwarderPath(home), 'utf8'), readFileSync(HOOK_SOURCE, 'utf8'));
    assert.equal(refreshForwarder(home), false);
  });
});

describe('hostile folders', () => {
  it('does not write through a symlink planted at a temp-file name in the project', { skip: CANNOT_SYMLINK }, () => {
    const settings = join(dir, 'project', '.claude', 'settings.local.json');
    writeJson(settings, { note: '$(touch /tmp/pwned)' });
    const victim = join(dir, 'victim-bashrc');
    writeFileSync(victim, 'alias ll="ls -l"\n');
    // The names older versions used; a repository can ship links for a whole range of pids.
    for (const pid of [process.pid, process.pid + 1]) symlinkSync(victim, `${settings}.andary-${pid}.tmp`);
    run('install', 'local');
    assert.equal(readFileSync(victim, 'utf8'), 'alias ll="ls -l"\n');
    assert.ok(readJson(settings).hooks.PermissionRequest, 'the settings file itself was updated');
  });

  it('makes an existing home folder private again and refuses one owned by someone else', { skip: process.platform === 'win32' }, () => {
    mkdirSync(home, { recursive: true });
    chmodSync(home, 0o777);
    run('install');
    assert.equal(statSync(home).mode & 0o777, 0o700);
    const owner = statSync(home).uid;
    assert.throws(() => ensureHome(home, { uid: owner + 1 }), (/** @type {any} */ error) => error.code === 'EUNSAFEHOME' && /another user/.test(error.message));
  });
});

describe('Codex', () => {
  const codex = CLIENTS.codex;
  const codexHooks = () => join(dir, 'codex', 'hooks.json');

  it('writes its hooks to CODEX_HOME/hooks.json (or the project .codex/hooks.json) with the codex argument', () => {
    assert.equal(settingsPathFor('user', { env, client: codex }), codexHooks());
    assert.equal(settingsPathFor('project', { dir: '/repo', env, client: codex }), join(resolve('/repo'), '.codex', 'hooks.json'));
    assert.throws(() => settingsPathFor('local', { env, client: codex }), /Use user or project/);
    assert.equal(hookCommand('/h', codex), 'node "/h/hook.mjs" codex # andary');
    const plan = planHooksChange({ action: 'install', scope: 'user', home, env, client: codex });
    applyHooksChange(plan);
    const written = readJson(codexHooks());
    assert.deepEqual(Object.keys(written.hooks), codex.registrations.map((r) => r.event));
    assert.deepEqual(written.hooks.PermissionRequest, [{ hooks: [{ type: 'command', command: hookCommand(home, codex), timeout: 150 }] }]);
    assert.deepEqual(written.hooks.Interrupt[0].hooks[0].timeout, 3);
    assert.equal(written.hooks.PreToolUse[0].hooks[0].async, true);
    assert.ok(!('PostToolUseFailure' in written.hooks), 'only events Codex has');
  });

  it('keeps other Codex hooks, and uninstall removes only ours', () => {
    writeJson(codexHooks(), { hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'python3 ~/.codex/hooks/policy.py' }] }] } });
    applyHooksChange(planHooksChange({ action: 'install', scope: 'user', home, env, client: codex }));
    assert.equal(readJson(codexHooks()).hooks.PreToolUse.length, 2);
    const plan = planHooksChange({ action: 'uninstall', scope: 'user', home, env, client: codex });
    applyHooksChange(plan);
    assert.deepEqual(readJson(codexHooks()).hooks, { PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'python3 ~/.codex/hooks/policy.py' }] }] });
  });

  it('is reported next to Claude Code', () => {
    applyHooksChange(planHooksChange({ action: 'install', scope: 'user', home, env, client: codex }));
    const report = inspectInstallations({ dir: join(dir, 'project'), env, home });
    const codexUser = report.scopes.find((s) => s.client.id === 'codex' && s.scope === 'user');
    assert.ok(codexUser?.complete);
    assert.equal(codexUser?.plugin, false);
    assert.ok(report.installed);
    assert.ok(report.scopes.filter((s) => s.client.id === 'claude').every((s) => s.events.length === 0));
  });
});
