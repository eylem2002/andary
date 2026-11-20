import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CLIENTS } from '../../../../server/clients.mjs';
import { describeScope } from '../../../../server/cli/status.mjs';

test('a partly installed scope names the exact command that completes it', () => {
  /** @param {any} client @param {string} scope */
  const partly = (client, scope) => describeScope(/** @type {any} */ ({ client, scope, settingsPath: '/x/hooks.json', events: ['Stop'], complete: false, plugin: false, error: null }));
  assert.match(partly(CLIENTS.claude, 'user'), /run install again$/);
  assert.match(partly(CLIENTS.claude, 'local'), /run install --scope local again$/);
  assert.match(partly(CLIENTS.codex, 'project'), /^Codex, project scope: partly installed, 1 of \d+ events .*run install codex --scope project again$/);
});
