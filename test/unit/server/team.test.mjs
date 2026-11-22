import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { browserRole } from '../../../server/auth.mjs';
import { createHub } from '../../../server/browsers.mjs';
import { parseShareTo, parseTeamHosts, parseTeamUrl } from '../../../server/cli/options.mjs';
import { allowedHostHeaders } from '../../../server/security.mjs';
import { TEAM_HEADER, cleanMemberName, createTeamHost, createTeamRelay, lanAddresses, memberKey, personToken, teamSecret, verifyMemberKey, verifyPersonToken, viewToken } from '../../../server/team.mjs';
import { createPeople, readRoster, writeRoster } from '../../../server/people.mjs';

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

test('a personal link names its person, and is never a member key (nor the other way round)', () => {
  const link = personToken(SECRET, 'Lina');
  assert.equal(verifyPersonToken(SECRET, link), 'Lina');
  assert.equal(verifyPersonToken(SECRET, personToken(SECRET, 'Zeynep Ç.')), 'Zeynep Ç.');
  assert.equal(verifyMemberKey(SECRET, link), null, 'a leaked link cannot post events');
  assert.equal(verifyPersonToken(SECRET, memberKey(SECRET, 'Lina')), null, 'a leaked key cannot drive a character');
  assert.equal(verifyPersonToken('another-secret-that-is-long-enough-12', link), null);
});

test('keys and links work only while their name is on the roster', () => {
  const home = join(temp, 'roster');
  const people = createPeople({ home, host: 'Sam' });
  writeRoster(home, { ...readRoster(home), people: { ...readRoster(home).people, Lina: { slot: 1, color: 1, nonce: '', profile: null } } });
  const team = createTeamHost({ secret: SECRET, people });
  assert.equal(team.memberOf(memberKey(SECRET, 'Lina')), 'Lina');
  assert.equal(team.personOf(personToken(SECRET, 'Lina')), 'Lina');
  assert.equal(team.memberOf(memberKey(SECRET, 'Omar')), null, 'a valid key for someone not invited');
  assert.equal(team.personOf(memberKey(SECRET, 'Lina')), null);
  const { Lina: _gone, ...rest } = readRoster(home).people;
  writeRoster(home, { ...readRoster(home), people: rest });
  assert.equal(team.memberOf(memberKey(SECRET, 'Lina')), null, 'removed: the key stops working');
  assert.equal(team.personOf(personToken(SECRET, 'Lina')), null, 'removed: the link stops working');
});

test('the team secret is made once, kept private, and replaced by a reset', () => {
  const home = join(temp, 'home');
  assert.equal(teamSecret(home, { create: false }), null);
  const first = teamSecret(home);
  assert.equal(teamSecret(home), first);
  // Windows has no POSIX modes; the user profile's permissions protect the file there.
  if (process.platform !== 'win32') assert.equal(statSync(join(home, 'team.json')).mode & 0o777, 0o600);
  const fresh = teamSecret(home, { fresh: true });
  assert.notEqual(fresh, first);
  assert.equal(teamSecret(home, { create: false }), fresh);
});

test('the team host rate-limits each member and announces each new member once', () => {
  /** @type {string[][]} */
  const announced = [];
  const people = createPeople({ home: join(temp, 'limits'), host: null });
  const team = createTeamHost({ secret: SECRET, people, onMember: (members) => announced.push(members), ratePerSecond: 1, burst: 3 });
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
  /** @type {{ url: string, headers: any, body: any, redirect: string }[]} */
  const calls = [];
  let up = false;
  /** @type {any} */
  const fetchImpl = async (/** @type {string} */ url, /** @type {any} */ init) => {
    calls.push({ url, headers: init.headers, body: JSON.parse(init.body), redirect: init.redirect });
    if (!up) throw new Error('connect ECONNREFUSED');
    return { ok: true, status: 200, json: async () => ({ ok: true }) };
  };
  const logs = /** @type {string[]} */ ([]);
  const relay = createTeamRelay({ url: 'http://192.168.1.20:4747', key: 'Lina.key', fetchImpl, log: (m) => logs.push(m), flushMs: 60_000 });
  for (let i = 0; i < 1005; i += 1) relay.send({ ts: i, event: { hook_event_name: 'Stop', n: i } });
  assert.equal(relay.pending, 1000);
  await relay.flush();
  assert.equal(calls[0].url, 'http://192.168.1.20:4747/api/team');
  assert.equal(calls[0].headers[TEAM_HEADER], 'Lina.key');
  assert.equal(calls[0].redirect, 'error', 'a redirect never carries the key elsewhere');
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

test('browsers are the owner, a person, a viewer, or nobody', () => {
  const req = (/** @type {string} */ protocols) => /** @type {any} */ ({ headers: { 'sec-websocket-protocol': protocols } });
  const team = { view: 'view-token', personOf: (/** @type {string|null} */ t) => verifyPersonToken(SECRET, t) };
  assert.equal(browserRole(req('andary, andary.token.owner-token'), 'owner-token', team)?.role, 'owner');
  assert.deepEqual(browserRole(req(`andary, andary.person.${personToken(SECRET, 'j.doe')}`), 'owner-token', team), { role: 'person', person: 'j.doe' });
  assert.equal(browserRole(req('andary, andary.view.view-token'), 'owner-token', team)?.role, 'viewer');
  assert.equal(browserRole(req('andary, andary.view.view-token'), 'owner-token', null), null);
  assert.equal(browserRole(req('andary, andary.view.wrong'), 'owner-token', team), null);
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
  hub.add(fake(), 'person', 'Lina');
  assert.equal(hub.full('person', 'Lina'), false, 'people may use the owner\'s reserve');
  hub.add(fake(), 'person', 'Lina');
  assert.equal(hub.full('person', 'Lina'), true, 'two connections per person');
  assert.equal(hub.full('person', 'Omar'), false);
  assert.equal(hub.online('Lina'), true);
  assert.equal(hub.online('Omar'), false);
  hub.add(fake(), 'person', 'Omar');
  assert.equal(hub.full('person', 'Rui'), true, 'six of six places taken');
});

test('a team host on every interface also answers to its network addresses', () => {
  const allowed = allowedHostHeaders(4747, '0.0.0.0', ['192.168.1.20']);
  assert.ok(allowed.has('192.168.1.20:4747'));
  assert.ok(allowed.has('127.0.0.1:4747'));
  assert.ok(!allowedHostHeaders(4747, '0.0.0.0').has('192.168.1.20:4747'));
});

test('the relay cuts batches by size, skips huge events and doctor probes, and only trusts {ok:true}', async () => {
  /** @type {any[]} */
  const bodies = [];
  let answer = { ok: false };
  /** @type {any} */
  const fetchImpl = async (/** @type {string} */ _url, /** @type {any} */ init) => {
    bodies.push(JSON.parse(init.body));
    return { ok: true, status: 200, json: async () => answer };
  };
  const logs = /** @type {string[]} */ ([]);
  const relay = createTeamRelay({ url: 'http://host:4747', key: 'k', fetchImpl, log: (m) => logs.push(m), flushMs: 60_000 });
  relay.send({ ts: 1, event: { session_id: 'andary-doctor-123', hook_event_name: 'Stop' } });
  assert.equal(relay.pending, 0, 'doctor probes stay home');
  relay.send({ ts: 1, event: { session_id: 's', blob: 'x'.repeat(1_600_000) } });
  assert.equal(relay.pending, 0, 'an event too big for any batch is dropped');
  assert.match(logs[0], /too big/);
  for (let i = 0; i < 5; i += 1) relay.send({ ts: i, event: { session_id: 's', n: i, blob: 'y'.repeat(400_000) } });
  await relay.flush();
  assert.equal(bodies[0].events.length, 3, 'about 1.5 MB per request');
  assert.equal(relay.pending, 5, 'a 200 without {ok:true} (a captive portal, say) is not delivery');
  answer = { ok: true };
  await relay.flush();
  await relay.flush();
  assert.equal(relay.pending, 0);
  assert.deepEqual(bodies.slice(-2).map((b) => b.events.map((/** @type {any} */ e) => e.event.n)), [[0, 1, 2], [3, 4]]);
  relay.dispose();
  relay.send({ ts: 9, event: { session_id: 's' } });
  assert.equal(relay.pending, 0, 'nothing is queued after dispose');
});

test('network addresses: private ranges first, container bridges last', () => {
  const nic = (/** @type {string} */ address) => [{ address, family: 'IPv4', internal: false }];
  /** @type {any} */
  const interfaces = { docker0: nic('172.17.0.1'), lo: [{ address: '127.0.0.1', family: 'IPv4', internal: true }], tailscale0: nic('100.101.1.2'), eth0: nic('192.168.1.20'), v6: [{ address: 'fe80::1', family: 'IPv6', internal: false }] };
  assert.deepEqual(lanAddresses(interfaces), ['192.168.1.20', '100.101.1.2', '172.17.0.1']);
});

test('--team-host takes host names without a port', () => {
  assert.deepEqual(parseTeamHosts(['Box.tailnet.ts.net', 'studio']), ['box.tailnet.ts.net', 'studio']);
  assert.deepEqual(parseTeamHosts(undefined), []);
  for (const bad of ['box:4747', 'http://box', 'a..b', '-x']) assert.throws(() => parseTeamHosts([bad]), /host name without a port/);
});
