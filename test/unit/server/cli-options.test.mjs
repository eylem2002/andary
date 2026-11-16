import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { cliInvocation, tildify } from '../../../server/cli/io.mjs';
import { UsageError, parseApprovalTimeout, parsePort, parseScope, parseSeed, parseSpeed } from '../../../server/cli/options.mjs';
import { formatDuration } from '../../../server/cli/status.mjs';
import { homedir } from 'node:os';
import { join } from 'node:path';

describe('option parsing', () => {
  it('reads the port from the flag, then ANDARY_PORT, then the default', () => {
    assert.equal(parsePort('5000', {}), 5000);
    assert.equal(parsePort(undefined, { ANDARY_PORT: '6000' }), 6000);
    assert.equal(parsePort(undefined, {}), 4747);
    assert.equal(parsePort('0', {}), 0);
    for (const bad of ['-1', '65536', '12.5', 'abc']) assert.throws(() => parsePort(bad, {}), UsageError, bad);
  });

  it('converts the approval timeout to ms and caps it below the hook timeout', () => {
    /** @type {string[]} */
    const warnings = [];
    assert.equal(parseApprovalTimeout(undefined, (w) => warnings.push(w)), undefined);
    assert.equal(parseApprovalTimeout('1.5', (w) => warnings.push(w)), 1500);
    assert.equal(parseApprovalTimeout('600', (w) => warnings.push(w)), 140_000);
    assert.equal(warnings.length, 1);
    for (const bad of ['0', '-3', 'soon']) assert.throws(() => parseApprovalTimeout(bad, () => {}), UsageError, bad);
  });

  it('validates speed, seed and scope', () => {
    assert.equal(parseSpeed(undefined), 1);
    assert.equal(parseSpeed('4'), 4);
    for (const bad of ['0', '-1', 'fast', '5000']) assert.throws(() => parseSpeed(bad), UsageError, bad);
    assert.equal(parseSeed('42'), 42);
    assert.equal(parseSeed(undefined), undefined);
    assert.throws(() => parseSeed('4.2'), UsageError);
    assert.equal(parseScope(undefined), 'user');
    assert.equal(parseScope('local'), 'local');
    assert.throws(() => parseScope('machine'), UsageError);
  });
});

describe('display helpers', () => {
  it('shortens paths under the home folder', () => {
    assert.equal(tildify(join(homedir(), '.andary')), join('~', '.andary'));
    assert.equal(tildify('/opt/elsewhere'), '/opt/elsewhere');
  });

  it('suggests the right way to run the CLI', () => {
    assert.equal(cliInvocation('/usr/local/bin/andary'), 'andary');
    assert.equal(cliInvocation('C:\\npm\\andary.cmd'), 'andary');
    assert.equal(cliInvocation('/home/me/.npm/_npx/abc/node_modules/.bin/andary'), 'npx andary');
    assert.match(cliInvocation('/repo/bin/andary.mjs'), /^node ".*andary\.mjs"$/);
  });

  it('formats uptimes', () => {
    assert.equal(formatDuration(12_000), '12s');
    assert.equal(formatDuration(4 * 60_000), '4m');
    assert.equal(formatDuration((3 * 60 + 12) * 60_000), '3h 12m');
    assert.equal(formatDuration(50 * 3_600_000), '2d 2h');
  });
});
