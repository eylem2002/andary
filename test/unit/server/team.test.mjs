import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { browserRole } from '../../../server/auth.mjs';
import { createHub } from '../../../server/browsers.mjs';
import { parseShareTo, parseTeamUrl } from '../../../server/cli/options.mjs';
import { allowedHostHeaders } from '../../../server/security.mjs';
import { TEAM_HEADER, cleanMemberName, createTeamHost, createTeamRelay, memberKey, teamSecret, verifyMemberKey, viewToken } from '../../../server/team.mjs';

// A made-up team secret for these tests only.
const SECRET = 'test-only-'.repeat(4);
const temp = mkdtempSync(join(tmpdir(), 'team-'));
after(() => rmSync(temp, { recursive: true, force: true }));

test('member names keep letters, digits, spaces, dots, dashes and underscores, at most 24', () => {
  assert.equal(cleanMemberName('  Lina  '), 'Lina');
  assert.equal(cleanMemberName('Zeynep Ç.'), 'Zeynep Ç.');
  assert.equal(cleanMemberName('<b>Omar</b>'), 'bOmarb');
  assert.equal(cleanMemberName('a'.repeat(40)), 'a'.repeat(24));
  assert.equal(cleanMemberName('!!!'), null);
  assert.equal(cleanMemberName(42), null);
});

test('a member key names its member and only works with its own secret', () => {
  const key = memberKey(SECRET, 'Lina');
  assert.equal(verifyMemberKey(SECRET, key), 'Lina');
  assert.equal(verifyMemberKey('another-secret-that-is-long-enough-12', key), null);
  assert.equal(verifyMemberKey(SECRET, key.replace('Lina', 'Omar')), null);
  assert.equal(verifyMemberKey(SECRET, `${key.slice(0, -1)}x`), null);
  // A dot in a name cannot be confused with the separator.
  assert.equal(verifyMemberKey(SECRET, memberKey(SECRET, 'j.doe')), 'j.doe');
  for (const bad of [undefined, '', 'nodot', '.abc', '%E0%A4%A.abc', 'x'.repeat(300)]) assert.equal(verifyMemberKey(SECRET, bad), null);
  assert.notEqual(viewToken(SECRET), viewToken('another-secret-that-is-long-enough-12'));
  assert.equal(viewToken(SECRET), viewToken(SECRET));
});

test('the team secret is made once, kept private, and replaced by a reset', () => {
  const home = join(temp, 'home');
  assert.equal(teamSecret(home, { create: false }), null);
  const first = teamSecret(home);
  assert.equal(teamSecret(home), first);
  assert.equal(statSync(join(home, 'team.json')).mode & 0o777, 0o600);
  const fresh = teamSecret(home, { fresh: true });
  assert.notEqual(fresh, first);
  assert.equal(teamSecret(home, { create: false }), fresh);
});

test('the team host rate-limits each member and announces each new member once', () => {
  /** @type {string[][]} */
  const announced = [];
  const team = createTeamHost({ secret: SECRET, onMember: (members) => announced.push(members), ratePerSecond: 1, burst: 3 });
  assert.equal(team.view, viewToken(SECRET));
  assert.equal(team.limiter('Lina').take(3), true);
  assert.equal(team.limiter('Lina').take(1), false);
  assert.equal(team.limiter('Omar').take(1), true);
  team.seen('Lina');
  team.seen('Lina');
  team.seen('Omar');
  assert.deepEqual(announced, [['Lina'], ['Lina', 'Omar']]);
  assert.deepEqual(team.members(), ['Lina', 'Omar']);
});

test('the relay sends batches with the key, keeps the newest 1,000 and retries when the host is away', async () => {
  /** @type {{ url: string, headers: any, body: any }[]} */
  const calls = [];
  let up = false;
  /** @type {any} */
  const fetchImpl = async (/** @type {string} */ url, /** @type {any} */ init) => {
    calls.push({ url, headers: init.headers, body: JSON.parse(init.body) });
    if (!up) throw new Error('connect ECONNREFUSED');
    return { ok: true, status: 200 };
  };
  const logs = /** @type {string[]} */ ([]);
  const relay = createTeamRelay({ url: 'http://192.168.1.20:4747', key: 'Lina.key', fetchImpl, log: (m) => logs.push(m), flushMs: 60_000 });
  for (let i = 0; i < 1005; i += 1) relay.send({ ts: i, event: { hook_event_name: 'Stop', n: i } });
  assert.equal(relay.pending, 1000);
  await relay.flush();
  assert.equal(calls[0].url, 'http://192.168.1.20:4747/api/team');
  assert.equal(calls[0].headers[TEAM_HEADER], 'Lina.key');
  assert.equal(calls[0].body.v, 1);
  assert.equal(calls[0].body.events.length, 100);
  assert.equal(calls[0].body.events[0].event.n, 5, 'the oldest five were dropped');
  assert.equal(relay.pending, 1000, 'nothing is lost while the host is away');
  assert.match(logs[0], /Could not reach the team town/);
  up = true;
  await relay.flush();
  assert.equal(relay.pending, 900);
  assert.match(logs.at(-1) ?? '', /Sharing with the team town again/);
  relay.dispose();
});

test('--share-to and --team-key go together and must look right', () => {
  const key = memberKey(SECRET, 'Lina');
  assert.equal(parseShareTo(undefined, undefined), null);
  assert.deepEqual(parseShareTo('http://192.168.1.20:4747/', key), { url: 'http://192.168.1.20:4747', key, member: 'Lina' });
  assert.throws(() => parseShareTo('http://192.168.1.20:4747', undefined), /needs both/);
  assert.throws(() => parseShareTo(undefined, key), /needs both/);
  assert.throws(() => parseShareTo('http://192.168.1.20:4747', 'Lina.short'), /does not look like a key/);
  assert.throws(() => parseShareTo('ftp://host', key), /team town's address/);
  assert.throws(() => parseTeamUrl('http://user:pass@host:1', '--url'), /team town's address/);
});

test('browsers are the owner, a viewer, or nobody', () => {
  const req = (/** @type {string} */ cookie) => /** @type {any} */ ({ headers: { cookie } });
  assert.equal(browserRole(req('andary_ui=owner-token'), 'owner-token', 'view-token'), 'owner');
  assert.equal(browserRole(req('andary_view=view-token'), 'owner-token', 'view-token'), 'viewer');
  assert.equal(browserRole(req('andary_view=view-token'), 'owner-token', null), null);
  assert.equal(browserRole(req('andary_view=wrong'), 'owner-token', 'view-token'), null);
});

test('viewers can never take the owner\'s last connections', () => {
  const hub = createHub(6);
  /** @type {any[]} */
  const fakes = [];
  const fake = () => {
    /** @type {any} */
    const connection = { sent: /** @type {string[]} */ ([]), send(/** @type {string} */ t) { this.sent.push(t); }, once() {} };
    fakes.push(connection);
    return connection;
  };
  hub.add(fake(), 'viewer');
  hub.add(fake(), 'viewer');
  assert.equal(hub.full('viewer'), true, 'two of six places are the most viewers get');
  assert.equal(hub.full('owner'), false);
  hub.add(fake(), 'owner');
  assert.equal(hub.owners, 1);
  hub.broadcastOwners({ t: 'approval' });
  assert.deepEqual(fakes.map((f) => f.sent.length), [0, 0, 1]);
});

test('a team host on every interface also answers to its network addresses', () => {
  const allowed = allowedHostHeaders(4747, '0.0.0.0', ['192.168.1.20']);
  assert.ok(allowed.has('192.168.1.20:4747'));
  assert.ok(allowed.has('127.0.0.1:4747'));
  assert.ok(!allowedHostHeaders(4747, '0.0.0.0').has('192.168.1.20:4747'));
});
