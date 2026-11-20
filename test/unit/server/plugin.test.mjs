// The plugin files are static JSON; these tests keep them in step with the installer and the package.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
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
    assert.match(command, /!`node "\$\{CLAUDE_PLUGIN_ROOT\}\/bin\/andary\.mjs" start --detach`/);
  });
});
