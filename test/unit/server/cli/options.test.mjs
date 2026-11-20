import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { cliInvocation, printable, tildify } from '../../../../server/cli/io.mjs';
import { UsageError, parseApprovalTimeout, parseClient, parsePort, parseScope, parseSeed, parseSpeed, parseTls } from '../../../../server/cli/options.mjs';
import { formatDuration } from '../../../../server/cli/status.mjs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

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
    const codex = parseClient('codex');
    assert.equal(codex.name, 'Codex');
    assert.equal(parseClient(undefined).id, 'claude');
    assert.equal(parseClient('Claude').id, 'claude');
    assert.throws(() => parseClient('gemini'), /claude or codex/);
    assert.equal(parseScope(undefined, codex), 'user');
    assert.throws(() => parseScope('local', codex), /--scope for Codex must be user, project/);
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
    assert.match(cliInvocation('/repo/cli/andary.mjs'), /^node ".*andary\.mjs"$/);
  });

  it('formats uptimes', () => {
    assert.equal(formatDuration(12_000), '12s');
    assert.equal(formatDuration(4 * 60_000), '4m');
    assert.equal(formatDuration((3 * 60 + 12) * 60_000), '3h 12m');
    assert.equal(formatDuration(50 * 3_600_000), '2d 2h');
  });
});

describe('printable', () => {
  it('shows terminal control characters instead of sending them to the terminal', () => {
    const folder = '/work/evil\u001B]52;c;Y3VybCBldmlsIHwgc2g=\u0007\u001B[2J\r';
    assert.equal(printable(folder), '/work/evil\\x1b]52;c;Y3VybCBldmlsIHwgc2g=\\x07\\x1b[2J\\x0d');
    assert.equal(printable('tabs\tand ✔ symbols stay'), 'tabs\tand ✔ symbols stay');
    assert.equal(printable('\u009B31m'), '\\x9b31m', 'C1 CSI too');
  });
});

describe('--tls-cert and --tls-key', () => {
  // parseTls resolves the paths it is given (on Windows '/c.pem' is D:\\c.pem).
  /** @type {Record<string, Buffer>} */
  const files = { [resolve('/c.pem')]: Buffer.from('CERT'), [resolve('/k.pem')]: Buffer.from('KEY') };
  const readFile = (/** @type {string} */ path) => {
    const file = files[path];
    if (!file) throw new Error('ENOENT');
    return file;
  };

  it('are both given or neither, and are read and checked at once', () => {
    assert.equal(parseTls(undefined, undefined), null);
    assert.throws(() => parseTls('/c.pem', undefined), /needs both --tls-cert <file> and --tls-key <file>/);
    assert.throws(() => parseTls('/c.pem', '/missing.pem', { readFile, check: () => {} }), /Cannot read the key file \/missing\.pem/);
    assert.throws(() => parseTls('/c.pem', '/k.pem', { readFile, check: () => { throw new Error('mismatch'); } }), /could not be used together/);
    const tls = parseTls('/c.pem', '/k.pem', { readFile, check: () => {} });
    assert.deepEqual([String(tls?.cert), String(tls?.key), tls?.certPath, tls?.keyPath], ['CERT', 'KEY', resolve('/c.pem'), resolve('/k.pem')]);
    assert.ok(new UsageError('x') instanceof Error);
  });
});
