import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { after, before, describe, it } from 'node:test';
import { memberKey, personToken, teamSecret, viewToken } from '../../server/team.mjs';
import { defaultProfile } from '../../public/js/core/profile.js';
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

const cli = fileURLToPath(new URL('../../cli/andary.mjs', import.meta.url));

/** @param {string} home @param {string[]} args */
function team(home, args) {
  return spawnSync(process.execPath, [cli, 'team', ...args], { env: { ...process.env, ANDARY_HOME: home }, encoding: 'utf8' });
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
    // A short wait for an absence (tests only), so the host's absences can be seen.
    host = await startTown({ args: ['--team', '--name', 'Sam', '--host', '127.0.0.1', '--team-host', 'andary-host.tailnet.example'], env: { ANDARY_AWAY_MS: '300' } });
    secret = /** @type {string} */ (teamSecret(host.home, { create: false }));
    for (const name of ['Lina', 'Omar']) assert.equal(team(host.home, ['invite', name]).status, 0);
    // The key by environment, as the invite prints it.
    member = await startTown({ args: ['--share-to', host.baseUrl], env: { ANDARY_TEAM_KEY: memberKey(secret, 'Lina') } });
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
    assert.equal((await postTeam(host.port, batch, { 'x-andary-team': memberKey(secret, 'Mallory') })).status, 401, 'a valid key for a name not on the roster');
    // Only the team endpoint skips the Host check: the rest of the town still refuses other names.
    assert.equal((await rawRequest(host.port, { path: '/', headers: { host: `evil.example:${host.port}` } })).status, 403);
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
    // The link works at a --team-host name too (a VPN name).
    assert.equal((await rawRequest(host.port, { path: `/?view=${view}`, headers: { host: `andary-host.tailnet.example:${host.port}` } })).status, 302);
    const login = await rawRequest(host.port, { path: `/?view=${view}` });
    assert.equal(login.status, 302);
    assert.equal(login.headers.location, `/#view=${view}`);
    assert.equal(login.headers['set-cookie'], undefined);
    const hello = JSON.parse((await rawRequest(host.port, { path: '/api/hello', headers: { 'x-andary-view': view } })).text);
    assert.equal(hello.authenticated, true);

    const viewer = await connectBrowser(host, { protocols: `andary, andary.view.${view}` });
    const greeting = await waitForMessage(viewer, (m) => m?.t === 'hello');
    assert.equal(greeting.settings.team.role, 'viewer');
    assert.equal(greeting.settings.remoteApprovals, false);
    assert.equal(greeting.notifyUrl, null);
    assert.deepEqual(greeting.approvals, []);
    assert.ok(greeting.history.some((/** @type {any} */ e) => e.event.andary_member === 'Lina'));
    viewer.send(JSON.stringify({ t: 'settings', settings: { remoteApprovals: true } }));
    const refusal = await waitForMessage(viewer, (m) => m?.t === 'error');
    assert.match(refusal.message, /Viewers can only watch/);
    // Catch me up is the owner's: a viewer hears nothing of the owner's absences and cannot ask.
    assert.equal(greeting.away, null);
    viewer.send(JSON.stringify({ t: 'digest', since: 0 }));
    const errors = () => viewer.messages.filter((m) => m?.t === 'error');
    await waitForMessage(viewer, () => errors().length === 2);
    assert.match(errors()[1].message, /Viewers can only watch/);
    assert.ok(!viewer.messages.some((m) => m?.t === 'digest'));
    await closeBrowser(viewer);

    // The view link does nothing on a town that does not host a team.
    assert.equal((await rawRequest(member.port, { path: `/?view=${view}` })).status, 403);
  });

  it("leaves a teammate's crews out of the host's catch-up: they are theirs", async () => {
    const owner = await connectBrowser(host);
    await waitForMessage(owner, (m) => m?.t === 'hello');
    const relayed = waitForMessage(owner, (m) => m?.t === 'hook' && m.e.event.session_id === 'Lina~catch-up', 10_000);
    await postHook(member, { ...hookPayload('Stop', { last_assistant_message: 'Done on Lina\'s side' }), session_id: 'catch-up' });
    await relayed;
    await postHook(host, { ...hookPayload('Stop', { last_assistant_message: 'Done here' }), session_id: 'host-crew' });
    owner.send(JSON.stringify({ t: 'digest', since: 0 }));
    const { d: digest } = await waitForMessage(owner, (m) => m?.t === 'digest');
    const ids = digest.crews.map((/** @type {any} */ crew) => crew.sessionId);
    assert.ok(ids.includes('host-crew'), ids.join(', '));
    assert.ok(!ids.some((/** @type {string} */ id) => id.startsWith('Lina~')), ids.join(', '));
    await closeBrowser(owner);
  });

  it("tells only the host of their absences: never a viewer, and a teammate's prompt is not the host", async () => {
    const protocols = `andary, andary.view.${viewToken(secret)}`;
    const owner = await connectBrowser(host);
    const viewer = await connectBrowser(host, { protocols });
    await Promise.all([waitForMessage(owner, (m) => m?.t === 'hello'), waitForMessage(viewer, (m) => m?.t === 'hello')]);
    // The host is here (a prompt), then their crew works on alone: away 300 ms later.
    await postHook(host, { ...hookPayload('UserPromptSubmit', { prompt: 'Go on without me' }), session_id: 'host-away' });
    await postHook(host, { ...hookPayload('Stop', { last_assistant_message: 'Done' }), session_id: 'host-away' });
    const { away } = await waitForMessage(owner, (m) => m?.t === 'away' && m.away.until === null);
    // A teammate's prompt is theirs: the host is still away.
    const relayed = waitForMessage(owner, (m) => m?.t === 'hook' && m.e.event.session_id === 'Lina~away-test', 10_000);
    await postHook(member, { ...hookPayload('UserPromptSubmit', { prompt: 'Mine' }), session_id: 'away-test' });
    await relayed;
    await new Promise((resolve) => setTimeout(resolve, 100));
    assert.equal(owner.messages.filter((m) => m?.t === 'away' && m.away.since === away.since).length, 1, 'not ended by a teammate');
    // Joining now, the owner hears of it in hello; a viewer does not.
    const [ownerAgain, viewerAgain] = await Promise.all([connectBrowser(host), connectBrowser(host, { protocols })]);
    const [ownerHello, viewerHello] = await Promise.all([waitForMessage(ownerAgain, (m) => m?.t === 'hello'), waitForMessage(viewerAgain, (m) => m?.t === 'hello')]);
    assert.deepEqual(ownerHello.away, away);
    assert.equal(viewerHello.away, null);
    // The host's next prompt ends it, for owners only.
    await postHook(host, { ...hookPayload('UserPromptSubmit', { prompt: 'Back' }), session_id: 'host-away' });
    const back = await waitForMessage(ownerAgain, (m) => m?.t === 'away' && m.away.until !== null);
    assert.equal(back.away.since, away.since);
    await new Promise((resolve) => setTimeout(resolve, 100));
    for (const browser of [viewer, viewerAgain]) assert.ok(!browser.messages.some((m) => m?.t === 'away'), 'a viewer never hears of an absence');
    await Promise.all([owner, viewer, ownerAgain, viewerAgain].map(closeBrowser));
  });

  it('invites print the key for the environment, the personal link, and what the links show', () => {
    const run = team(host.home, ['invite', 'Omar', '--url', 'http://box.tailnet.example:4747']);
    assert.equal(run.status, 0, run.stderr);
    assert.match(run.stdout, /ANDARY_TEAM_KEY=Omar\.[\w-]{32} andary start --share-to http:\/\/box\.tailnet\.example:4747/);
    assert.ok(!run.stdout.includes('--team-key'), 'the key is not an argument');
    assert.ok(run.stdout.includes(`http://box.tailnet.example:4747/?me=${encodeURIComponent(personToken(secret, 'Omar'))}`));
    assert.doesNotMatch(run.stdout, /\?view=/, 'the view link has its own command');
    assert.match(run.stdout, /sees every crew's prompts/);
    assert.match(run.stdout, /3 of 6 homes taken/);
    assert.match(run.stdout, /--team-host box\.tailnet\.example/);
    assert.doesNotMatch(run.stdout, /not a team host/);
    const link = team(host.home, ['view-link', '--url', 'http://box.tailnet.example:4747']);
    assert.ok(link.stdout.includes(`http://box.tailnet.example:4747/?view=${viewToken(secret)}`));
    const plain = team(member.home, ['invite', 'Omar']);
    assert.match(plain.stdout, /The running town is not a team host/);
  });

  it('refuses a seventh person, and never removes the host', () => {
    for (const name of ['Rui', 'Ana', 'Kai']) assert.equal(team(host.home, ['invite', name]).status, 0);
    const seventh = team(host.home, ['invite', 'Zed']);
    assert.notEqual(seventh.status, 0);
    assert.match(seventh.stderr, /room for 6 people/);
    assert.match(team(host.home, ['remove', 'Sam']).stderr, /hosts the town/);
    for (const name of ['Rui', 'Ana', 'Kai']) assert.equal(team(host.home, ['remove', name]).status, 0);
  });

  it('signs a teammate in with their personal link: their character, nothing of the host\'s', async () => {
    const token = personToken(secret, 'Lina');
    assert.equal((await rawRequest(host.port, { path: `/?me=${encodeURIComponent(personToken(secret, 'Mallory'))}` })).status, 403);
    const login = await rawRequest(host.port, { path: `/?me=${encodeURIComponent(token)}` });
    assert.equal(login.status, 302);
    assert.equal(new URLSearchParams(String(login.headers.location).split('#')[1]).get('me'), token);
    const hello = JSON.parse((await rawRequest(host.port, { path: '/api/hello', headers: { 'x-andary-person': token } })).text);
    assert.equal(hello.authenticated, true);

    const viewer = await connectBrowser(host, { protocols: `andary, andary.view.${viewToken(secret)}` });
    const owner = await connectBrowser(host);
    const ownerHello = await waitForMessage(owner, (m) => m?.t === 'hello');
    assert.equal(ownerHello.me, 'Sam');
    assert.equal((await waitForMessage(viewer, (m) => m?.t === 'hello')).me, null);
    const lina = await connectBrowser(host, { protocols: `andary, andary.person.${token}` });
    const greeting = await waitForMessage(lina, (m) => m?.t === 'hello');
    assert.equal(greeting.me, 'Lina');
    assert.equal(greeting.settings.team.role, 'person');
    assert.equal(greeting.settings.remoteApprovals, false);
    assert.equal(greeting.notifyUrl, null);
    assert.deepEqual(greeting.approvals, []);
    assert.deepEqual(greeting.people.map((/** @type {any} */ p) => [p.name, p.slot, p.host, p.online]), [['Sam', 0, true, true], ['Lina', 1, false, true], ['Omar', 2, false, false]]);
    // Everyone hears that Lina came online.
    await waitForMessage(viewer, (m) => m?.t === 'people' && m.people.find((/** @type {any} */ p) => p.name === 'Lina').online);

    for (const message of [{ t: 'decide', id: 'x', decision: 'allow' }, { t: 'settings', settings: { remoteApprovals: true } }, { t: 'digest', since: 0 }, { t: 'notify-test' }]) {
      lina.send(JSON.stringify(message));
    }
    await waitForMessage(lina, () => lina.messages.filter((m) => m?.t === 'error').length === 4);
    for (const error of lina.messages.filter((m) => m?.t === 'error')) assert.match(error.message, /change their own character only/);

    // A profile: checked, saved, and broadcast to everyone, viewers included.
    lina.send(JSON.stringify({ t: 'profile', p: { ...defaultProfile(0), extra: 'cape' } }));
    assert.match((await waitForMessage(lina, (m) => m?.t === 'error' && /Profile not saved/.test(m.message))).message, /exactly v, color, house and look/);
    lina.send(JSON.stringify({ t: 'profile', p: { ...defaultProfile(2), look: { ...defaultProfile(2).look, extra: 'cape' } } }));
    const saved = await waitForMessage(lina, (m) => m?.t === 'profile');
    assert.deepEqual([saved.ok, saved.asked, saved.color], [true, 2, 3], 'Omar has pine: the next free colour');
    const broadcast = await waitForMessage(viewer, (m) => m?.t === 'people' && m.people.find((/** @type {any} */ p) => p.name === 'Lina').profile);
    assert.equal(broadcast.people.find((/** @type {any} */ p) => p.name === 'Lina').profile.look.extra, 'cape');
    lina.send(JSON.stringify({ t: 'profile', p: defaultProfile(5) }));
    assert.match((await waitForMessage(lina, (m) => m?.t === 'error' && /Wait/.test(m.message))).message, /Wait a few seconds/);
    // The viewer may not have a profile at all.
    viewer.send(JSON.stringify({ t: 'profile', p: defaultProfile(5) }));
    assert.match((await waitForMessage(viewer, (m) => m?.t === 'error')).message, /Viewers can only watch/);
    await Promise.all([owner, viewer, lina].map(closeBrowser));
  });

  it('team remove revokes one person at once: their open town, their link and their key', async () => {
    const lina = await connectBrowser(host, { protocols: `andary, andary.person.${personToken(secret, 'Omar')}` });
    await waitForMessage(lina, (m) => m?.t === 'hello');
    const closed = new Promise((resolve) => lina.once('close', resolve));
    assert.equal(team(host.home, ['remove', 'Omar']).status, 0);
    assert.equal(/** @type {any} */ (await closed).reason, 'Removed from the team');
    assert.equal((await rawRequest(host.port, { path: `/?me=${encodeURIComponent(personToken(secret, 'Omar'))}` })).status, 403);
    const batch = { v: 1, events: [{ ts: Date.now(), event: hookPayload('Stop') }] };
    assert.equal((await postTeam(host.port, batch, { 'x-andary-team': memberKey(secret, 'Omar') })).status, 401);
    assert.equal((await postTeam(host.port, batch, { 'x-andary-team': memberKey(secret, 'Lina') })).status, 200, 'the others still work');
  });
});
