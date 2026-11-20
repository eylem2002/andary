import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { memberKey, teamSecret, viewToken } from '../../server/team.mjs';
import { closeBrowser, connectBrowser, hookPayload, postHook, rawRequest, startTown, waitForMessage } from './helpers.mjs';

/**
 * @param {number} port
 * @param {unknown} body
 * @param {Record<string, string>} [headers]
 */
function postTeam(port, body, headers = {}) {
  const text = JSON.stringify(body);
  return rawRequest(port, { method: 'POST', path: '/api/team', headers: { 'content-type': 'application/json', 'content-length': String(Buffer.byteLength(text)), ...headers }, body: text });
}

describe('Team town', () => {
  /** @type {Awaited<ReturnType<typeof startTown>>} */
  let host;
  /** @type {Awaited<ReturnType<typeof startTown>>} */
  let member;
  /** @type {string} */
  let secret;

  before(async () => {
    // --host keeps the test off the network; a real host leaves it out and listens on the LAN.
    host = await startTown({ args: ['--team', '--host', '127.0.0.1'] });
    secret = /** @type {string} */ (teamSecret(host.home, { create: false }));
    member = await startTown({ args: ['--share-to', host.baseUrl, '--team-key', memberKey(secret, 'Lina')] });
  });
  after(async () => {
    await member?.stop();
    await host?.stop();
  });

  it('shows a teammate\'s sessions in the host\'s town, tagged with their name', async () => {
    assert.match(host.output(), /Team town: on/);
    assert.match(member.output(), /Sharing your sessions with the team town at .* as Lina/);
    const owner = await connectBrowser(host);
    await waitForMessage(owner, (m) => m?.t === 'hello');
    const relayed = waitForMessage(owner, (m) => m?.t === 'hook' && m.e.event.andary_member === 'Lina', 10_000);
    const team = waitForMessage(owner, (m) => m?.t === 'settings' && m.settings.team, 10_000);
    const answer = await postHook(member, hookPayload('UserPromptSubmit', { prompt: 'Add the settings page' }));
    assert.equal(answer.status, 200);
    const message = await relayed;
    assert.equal(message.e.event.session_id, 'Lina~session-1');
    assert.equal(message.e.event.prompt, 'Add the settings page');
    assert.deepEqual((await team).settings.team, { role: 'owner', members: ['Lina'] });
    await host.waitForOutput(/Lina is sharing now/);
    await closeBrowser(owner);
  });

  it('refuses wrong keys, answers teammates by any host name, and strips forged tags from local hooks', async () => {
    const batch = { v: 1, events: [{ ts: Date.now(), event: hookPayload('Stop') }] };
    assert.equal((await postTeam(host.port, batch)).status, 401);
    assert.equal((await postTeam(host.port, batch, { 'x-andary-team': `${memberKey('another-secret-another-secret-123', 'Lina')}` })).status, 401);
    assert.equal((await postTeam(host.port, batch, { 'x-andary-team': memberKey(secret, 'Omar'), host: 'andary-host.tailnet.example:4747' })).status, 200);
    assert.equal((await postTeam(host.port, { v: 2 }, { 'x-andary-team': memberKey(secret, 'Omar') })).status, 400);
    // Only the team endpoint skips the Host check: the rest of the town still refuses other names.
    assert.equal((await rawRequest(host.port, { path: '/', headers: { host: 'andary-host.tailnet.example:4747' } })).status, 403);
    // A town that does not host a team has no team endpoint.
    assert.equal((await postTeam(member.port, batch, { 'x-andary-team': memberKey(secret, 'Lina') })).status, 404);

    const owner = await connectBrowser(host);
    await waitForMessage(owner, (m) => m?.t === 'hello');
    const local = waitForMessage(owner, (m) => m?.t === 'hook' && m.e.event.session_id === 'local-forged');
    await postHook(host, { ...hookPayload('Stop'), session_id: 'local-forged', andary_member: 'Mallory' });
    assert.equal((await local).e.event.andary_member, undefined);
    await closeBrowser(owner);
  });

  it('lets teammates watch with the view link, but not answer prompts or see the owner\'s settings', async () => {
    const view = viewToken(secret);
    assert.equal((await rawRequest(host.port, { path: '/?view=wrong' })).status, 403);
    const login = await rawRequest(host.port, { path: `/?view=${view}` });
    assert.equal(login.status, 302);
    assert.equal(login.headers.location, '/');
    assert.match(String(login.headers['set-cookie']), /^andary_view=.*HttpOnly; SameSite=Strict/);
    const cookie = `andary_view=${view}`;
    const hello = JSON.parse((await rawRequest(host.port, { path: '/api/hello', headers: { cookie } })).text);
    assert.equal(hello.authenticated, true);

    const viewer = await connectBrowser(host, { cookie });
    const greeting = await waitForMessage(viewer, (m) => m?.t === 'hello');
    assert.equal(greeting.settings.team.role, 'viewer');
    assert.equal(greeting.settings.remoteApprovals, false);
    assert.equal(greeting.notifyUrl, null);
    assert.deepEqual(greeting.approvals, []);
    assert.ok(greeting.history.some((/** @type {any} */ e) => e.event.andary_member === 'Lina'));
    viewer.send(JSON.stringify({ t: 'settings', settings: { remoteApprovals: true } }));
    const refusal = await waitForMessage(viewer, (m) => m?.t === 'error');
    assert.match(refusal.message, /Viewers can only watch/);
    await closeBrowser(viewer);

    // The view link does nothing on a town that does not host a team.
    assert.equal((await rawRequest(member.port, { path: `/?view=${view}` })).status, 403);
  });
});
