// The plugin files are static JSON; these tests keep them in step with the installer and the package.
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { ROOT_DIR } from '../../../server/config.mjs';
import { buildHooksConfig } from '../../../server/installer.mjs';

const readJson = (/** @type {string} */ path) => JSON.parse(readFileSync(join(ROOT_DIR, path), 'utf8'));

describe('Claude Code plugin packaging', () => {
  it('registers the same hooks as the installer, through ${CLAUDE_PLUGIN_ROOT}', () => {
    const expected = buildHooksConfig('node "${CLAUDE_PLUGIN_ROOT}/hooks/hook.mjs" # andary');
    assert.deepEqual(readJson('hooks/hooks.json'), { hooks: expected });
  });

  it('has a manifest with the package name and version', () => {
    const manifest = readJson('.claude-plugin/plugin.json');
    const pkg = readJson('package.json');
    assert.equal(manifest.name, 'andary');
    assert.equal(manifest.version, pkg.version);
    assert.equal(manifest.license, pkg.license);
    assert.ok(manifest.author?.name);
    assert.ok(!('hooks' in manifest), 'hooks/hooks.json loads by default; declaring it again would duplicate it');
  });

  it('lists the plugin in a marketplace rooted at this repository', () => {
    const marketplace = readJson('.claude-plugin/marketplace.json');
    assert.equal(marketplace.name, 'andary');
    assert.ok(marketplace.owner?.name);
    assert.deepEqual(
      marketplace.plugins.map((/** @type {any} */ p) => [p.name, p.source]),
      [['andary', './']],
    );
  });

  it('ships a /town command that starts the server in the background', () => {
    const command = readFileSync(join(ROOT_DIR, 'commands', 'town.md'), 'utf8');
    assert.match(command, /^---\n[\s\S]*?description: .+\n[\s\S]*?---\n/);
    assert.match(command, /disable-model-invocation: true/);
    assert.match(command, /!`node "\$\{CLAUDE_PLUGIN_ROOT\}\/cli\/andary\.mjs" start --detach`/);
  });

  it('pre-approves exactly the one command /town runs, with no wildcard', () => {
    const command = readFileSync(join(ROOT_DIR, 'commands', 'town.md'), 'utf8');
    const frontmatter = command.split('\n---\n')[0];
    const allowed = frontmatter.match(/^allowed-tools: (.+)$/m)?.[1];
    const injected = [...command.matchAll(/!`([^`]+)`/g)].map((m) => m[1]);
    assert.equal(injected.length, 1, 'one injected command');
    // Claude Code (2.1.0+) fills in ${CLAUDE_PLUGIN_ROOT} in the rule and the body alike, so the
    // rule matches that command exactly; an older one leaves it as written and matches nothing.
    assert.equal(allowed, `Bash(${injected[0]})`);
    assert.ok(!allowed.includes('*'), 'no wildcard: `node *` would approve any node command');
  });

  it('has no bin/ folder: Claude Code puts it on PATH and claude.ai refuses such plugins', () => {
    assert.ok(!existsSync(join(ROOT_DIR, 'bin')));
    const pkg = readJson('package.json');
    assert.equal(pkg.bin.andary, 'cli/andary.mjs');
    assert.ok(pkg.files.includes('cli'), 'the CLI is published');
    assert.ok(!pkg.files.includes('bin'));
    assert.match(readFileSync(join(ROOT_DIR, pkg.bin.andary), 'utf8'), /^#!\/usr\/bin\/env node\n/);
  });
});
