// The andary-limits mod and a real server (CONTRACTS §4.14): who may send limits, what is kept,
// and who sees them.
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { teamSecret, viewToken } from '../../server/team.mjs';
import { measureWithMod } from '../../e2e/helpers/mod.mjs';
import { closeBrowser, connectBrowser, rawRequest, startTown, waitForMessage } from './helpers.mjs';

const HOUR = 3_600_000;

/**
 * @param {{ port: number }} town
 * @param {string} body
 * @param {Record<string, string>} [headers]
 */
function postLimits(town, body, headers = {}) {
  return rawRequest(town.port, { method: 'POST', path: '/api/limits', headers: { 'content-type': 'application/json', 'content-length': String(Buffer.byteLength(body)), ...headers }, body });
}

const report = (/** @type {number} */ percentUsed) => JSON.stringify({ v: 1, sessionId: 's1', claudeVersion: '2.1.330', limits: [{ kind: 'five_hour', percentUsed, resetsAt: new Date(Date.now() + 3 * HOUR).toISOString() }], context: { tokens: 1000, window: 200_000 } });

describe('Plan limits from the andary-limits mod', () => {
  /** @type {Awaited<ReturnType<typeof startTown>>} */
  let town;
  before(async () => {
    town = await startTown({ args: ['--team', '--host', '127.0.0.1'] });
  });
  after(() => town?.stop());

  it('refuses anything without the hook secret: a local web page cannot send limits', async () => {
    // What a page can send without a preflight: no custom header, a text/plain body.
    assert.equal((await postLimits(town, report(50), { 'content-type': 'text/plain' })).status, 401);
    assert.equal((await postLimits(town, report(50), { 'x-andary-secret': 'guessed' })).status, 401);
    assert.equal((await postLimits(town, report(50), { 'x-andary-secret': town.secret, host: `evil.example:${town.port}` })).status, 403);
    assert.equal((await rawRequest(town.port, { path: '/api/limits' })).status, 405);
    const greeting = await connectBrowser(town);
    assert.deepEqual((await waitForMessage(greeting, (m) => m?.t === 'hello')).limits.accounts, []);
    await closeBrowser(greeting);
  });

  it('refuses a malformed or oversized report', async () => {
    const secret = { 'x-andary-secret': town.secret };
    assert.equal((await postLimits(town, 'not json', secret)).status, 400);
    assert.equal((await postLimits(town, JSON.stringify({ v: 2 }), secret)).status, 400);
    assert.equal((await postLimits(town, JSON.stringify({ v: 1, pad: 'x'.repeat(20_000) }), secret)).status, 413);
  });

  it('takes the mod\'s report and shows it to owners only, never to a team viewer', async () => {
    const owner = await connectBrowser(town);
    await waitForMessage(owner, (m) => m?.t === 'hello');
    const view = viewToken(/** @type {string} */ (teamSecret(town.home, { create: false })));
    const viewer = await connectBrowser(town, { protocols: `andary, andary.view.${view}` });
    await waitForMessage(viewer, (m) => m?.t === 'hello');
    /** @type {any[]} */
    const seenByViewer = [];
    viewer.on('message', (/** @type {string} */ text) => seenByViewer.push(JSON.parse(text)));

    const broadcast = waitForMessage(owner, (m) => m?.t === 'limits');
    // The mod's real code: it finds server.json, checks the proof, then sends the secret and numbers.
    await measureWithMod({
      env: { ANDARY_HOME: town.home, CLAUDE_CONFIG_DIR: '/home/u/.claude-work' },
      usage: { context: { tokens: 182_340, window: 1_000_000, percent: 18 }, rateLimits: [{ kind: 'five_hour', percentUsed: 42, resetsAt: new Date(Date.now() + 2 * HOUR).toISOString() }], cost: { usd: 1 } },
      sessionId: 'mod-session',
    });
    const { limits } = await broadcast;
    assert.equal(limits.accounts.length, 1);
    assert.equal(limits.accounts[0].label, '.claude-work');
    assert.equal(limits.accounts[0].claudeVersion, '2.1.330');
    assert.deepEqual(limits.accounts[0].limits.map((/** @type {any} */ l) => [l.kind, l.percentUsed]), [['five_hour', 42]]);
    assert.deepEqual({ ...limits.contexts['mod-session'], at: 0 }, { tokens: 182_340, window: 1_000_000, at: 0 });

    // A newly connected owner gets them in its hello; a viewer gets none, and heard nothing.
    const late = await connectBrowser(town);
    assert.equal((await waitForMessage(late, (m) => m?.t === 'hello')).limits.accounts[0].limits[0].percentUsed, 42);
    const lateViewer = await connectBrowser(town, { protocols: `andary, andary.view.${view}` });
    assert.deepEqual((await waitForMessage(lateViewer, (m) => m?.t === 'hello')).limits, { accounts: [], contexts: {} });
    assert.ok(!seenByViewer.some((m) => m.t === 'limits'));
    for (const connection of [owner, viewer, late, lateViewer]) await closeBrowser(connection);
  });

  it('sends nothing to a port whose server cannot prove it wrote server.json', async () => {
    const other = await startTown();
    try {
      const owner = await connectBrowser(other);
      await waitForMessage(owner, (m) => m?.t === 'hello');
      /** @type {any[]} */
      const seen = [];
      owner.on('message', (/** @type {string} */ text) => seen.push(JSON.parse(text)));
      // server.json of one town, the key of another: as a stale file whose port someone else took.
      const { writeFileSync, readFileSync } = await import('node:fs');
      const file = `${other.home}/server.json`;
      const state = JSON.parse(readFileSync(file, 'utf8'));
      writeFileSync(file, JSON.stringify({ ...state, responseKey: 'not-the-key-of-this-server' }));
      await measureWithMod({ env: { ANDARY_HOME: other.home }, usage: { rateLimits: [{ kind: 'five_hour', percentUsed: 10, resetsAt: new Date(Date.now() + HOUR).toISOString() }] } });
      await new Promise((resolve) => setTimeout(resolve, 200));
      assert.ok(!seen.some((m) => m.t === 'limits'));
      await closeBrowser(owner);
    } finally {
      await other.stop();
    }
  });
});
