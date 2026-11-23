// The live-mode WebSocket client, driven with a fake socket, a fake /api/hello and mock timers.
import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, mock, test } from 'node:test';
import { backoffDelay, connectLive, fetchHello, parseMessage, socketUrl } from '../../../public/js/sources/live.js';

class FakeSocket {
  /** @type {FakeSocket[]} */
  static all = [];
  /** @param {string} url @param {string[]} [protocols] */
  constructor(url, protocols = []) {
    this.url = url;
    this.protocols = protocols;
    this.readyState = 0;
    /** @type {any[]} */
    this.sent = [];
    /** @type {Record<string, Function[]>} */
    this.listeners = {};
    FakeSocket.all.push(this);
  }
  addEventListener(type, fn) {
    (this.listeners[type] ??= []).push(fn);
  }
  send(data) {
    this.sent.push(JSON.parse(data));
  }
  close() {
    this.readyState = 3;
    this.fire('close', {});
  }
  open() {
    this.readyState = 1;
  }
  /** @param {unknown} message */
  receive(message) {
    this.fire('message', { data: typeof message === 'string' ? message : JSON.stringify(message) });
  }
  fire(type, event) {
    for (const fn of this.listeners[type] ?? []) fn(event);
  }
}

function fakeStore() {
  const calls = [];
  return {
    calls,
    reset: () => calls.push(['reset']),
    ingest: (e) => calls.push(['ingest', e.id]),
    setApproval: (a) => calls.push(['approval', a.id]),
  };
}

const flush = () => new Promise((resolve) => setImmediate(resolve));

describe('connectLive', () => {
  beforeEach(() => {
    FakeSocket.all = [];
    mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  });
  afterEach(() => mock.timers.reset());

  test('hello rebuilds the store from history, then hooks and approvals stream in', () => {
    const store = fakeStore();
    const statuses = [];
    const settings = [];
    const errors = [];
    connectLive({ store, WebSocketImpl: /** @type {any} */ (FakeSocket), url: 'ws://x/ws', onStatus: (s) => statuses.push(s), onSettings: (s) => settings.push(s), onError: (m) => errors.push(m) });
    const socket = FakeSocket.all[0];
    assert.equal(socket.url, 'ws://x/ws');
    socket.open();
    socket.receive({ t: 'hello', version: '1', serverTime: 1, settings: { remoteApprovals: true }, history: [{ id: 1 }, { id: 2 }], approvals: [{ id: 'a1' }] });
    socket.receive({ t: 'hook', e: { id: 3 } });
    socket.receive({ t: 'approval', a: { id: 'a1' } });
    socket.receive({ t: 'settings', settings: { remoteApprovals: false } });
    socket.receive({ t: 'error', message: 'Too many browsers' });
    socket.receive('not json');
    socket.receive([1, 2]);
    assert.deepEqual(store.calls, [['reset'], ['ingest', 1], ['ingest', 2], ['approval', 'a1'], ['ingest', 3], ['approval', 'a1']]);
    assert.deepEqual(statuses, ['live']);
    assert.deepEqual(settings, [{ remoteApprovals: true, team: null, notifyUrl: null }, { remoteApprovals: false }]);
    assert.deepEqual(errors, ['Too many browsers']);
  });

  test('a team town\'s people come before the history, then as they change; a profile is sent and answered', () => {
    const store = fakeStore();
    /** @type {any[]} */
    const seen = [];
    /** @type {any[]} */
    const saved = [];
    const live = connectLive({
      store,
      WebSocketImpl: /** @type {any} */ (FakeSocket),
      url: 'ws://x/ws',
      onPeople: (people, me) => {
        seen.push([people.length, me]);
        store.calls.push(['people']);
      },
      onProfile: (answer) => saved.push(answer),
    });
    const socket = FakeSocket.all[0];
    socket.open();
    socket.receive({ t: 'hello', history: [{ id: 1 }], approvals: [], people: [{ name: 'Sam' }, { name: 'Lina' }], me: 'Lina' });
    assert.deepEqual(store.calls, [['reset'], ['people'], ['ingest', 1]], 'crews take their colours as the history replays');
    socket.receive({ t: 'people', people: [{ name: 'Sam' }] });
    socket.receive({ t: 'people', people: 'junk' });
    assert.deepEqual(seen, [[2, 'Lina'], [1, 'Lina'], [0, 'Lina']]);
    assert.equal(live.saveProfile(/** @type {any} */ ({ v: 1 })), true);
    assert.deepEqual(socket.sent.at(-1), { t: 'profile', p: { v: 1 } });
    socket.receive({ t: 'profile', ok: true, color: 3, asked: 2 });
    socket.receive({ t: 'profile', ok: false });
    assert.deepEqual(saved, [{ color: 3, asked: 2 }]);
    socket.receive({ t: 'hello', history: [], approvals: [] });
    assert.deepEqual(seen.at(-1), [0, null], 'a town that is no team host has no people');
  });

  test('walks, emotes, phrases and "come look" (§4.11): what comes in, and what this person can ask', () => {
    /** @type {any[]} */
    const seen = [];
    const live = connectLive({
      store: fakeStore(),
      WebSocketImpl: /** @type {any} */ (FakeSocket),
      url: 'ws://x/ws',
      onPeople: (people, me, offset) => seen.push(['people', me, offset]),
      onPresence: (people) => seen.push(['presence', people]),
      onSaid: (said) => seen.push(['said', said]),
      onLookAsk: (ask) => seen.push(['look', ask]),
    });
    const socket = FakeSocket.all[0];
    socket.open();
    const serverTime = Date.now() + 5000;
    socket.receive({ t: 'hello', history: [], approvals: [], people: [], me: 'Lina', serverTime });
    const [, , offset] = seen[0];
    assert.ok(Math.abs(offset - 5000) < 1000, 'walks are timed on the server\'s clock');
    seen.length = 0;
    socket.receive({ t: 'presence', people: [{ name: 'Sam', tile: [2, 3] }] });
    socket.receive({ t: 'presence', people: 'junk' });
    socket.receive({ t: 'emote', name: 'Sam', id: 2 });
    socket.receive({ t: 'phrase', name: 'Sam', id: 1 });
    socket.receive({ t: 'phrase', name: 'Sam', id: 'x' });
    socket.receive({ t: 'look-ask', from: 'Sam', at: { building: 'library' } });
    socket.receive({ t: 'look-ask', at: { building: 'library' } });
    assert.deepEqual(seen, [
      ['presence', [{ name: 'Sam', tile: [2, 3] }]],
      ['said', { kind: 'emote', name: 'Sam', id: 2 }],
      ['said', { kind: 'phrase', name: 'Sam', id: 1 }],
      ['look', { from: 'Sam', at: { building: 'library' } }],
    ]);
    assert.equal(live.walk([4, 9]), true);
    assert.equal(live.say('emote', 3), true);
    assert.equal(live.lookAsk('Sam', { agent: 'a1' }), true);
    assert.deepEqual(socket.sent.filter((m) => m.t !== 'ping'), [{ t: 'walk', to: [4, 9] }, { t: 'emote', id: 3 }, { t: 'look', to: 'Sam', at: { agent: 'a1' } }]);
  });

  test('one bad event does not stop the stream', () => {
    const errorLog = mock.method(console, 'error', () => {});
    const store = { ...fakeStore(), ingest: (e) => {
      if (e.id === 2) throw new Error('boom');
      store.calls.push(['ingest', e.id]);
    } };
    connectLive({ store, WebSocketImpl: /** @type {any} */ (FakeSocket), url: 'ws://x/ws' });
    const socket = FakeSocket.all[0];
    socket.open();
    socket.receive({ t: 'hello', history: [{ id: 1 }, { id: 2 }, { id: 3 }], approvals: [] });
    assert.deepEqual(store.calls, [['reset'], ['ingest', 1], ['ingest', 3]]);
    assert.equal(errorLog.mock.callCount(), 1);
    errorLog.mock.restore();
  });

  test('plan limits reach the HUD whole: from the hello (empty after a restart) and from each limits message', () => {
    /** @type {unknown[]} */
    const seen = [];
    connectLive({ store: fakeStore(), WebSocketImpl: /** @type {any} */ (FakeSocket), url: 'ws://x/ws', onLimits: (limits) => seen.push(limits) });
    const socket = FakeSocket.all[0];
    socket.open();
    const limits = { accounts: [{ account: 'default', at: 1, limits: [] }], contexts: {} };
    socket.receive({ t: 'hello', history: [], approvals: [], limits });
    socket.receive({ t: 'limits', limits: { accounts: [], contexts: {} } });
    socket.receive({ t: 'hello', history: [], approvals: [] });
    assert.deepEqual(seen, [limits, { accounts: [], contexts: {} }, null]);
  });

  test("each repository's branch reaches the store: from the hello and from each git message", () => {
    const store = { ...fakeStore(), setGit: (/** @type {any} */ g) => store.calls.push(['git', g.root]) };
    connectLive({ store, WebSocketImpl: /** @type {any} */ (FakeSocket), url: 'ws://x/ws' });
    const socket = FakeSocket.all[0];
    socket.open();
    socket.receive({ t: 'hello', history: [], approvals: [], git: [{ root: '/w/a' }] });
    socket.receive({ t: 'git', g: { root: '/w/b' } });
    socket.receive({ t: 'hello', history: [], approvals: [], git: 'nonsense' });
    assert.deepEqual(store.calls.filter((c) => c[0] === 'git'), [['git', '/w/a'], ['git', '/w/b']]);
  });

  test('decide and settings are sent only on an open socket', () => {
    const link = connectLive({ store: fakeStore(), WebSocketImpl: /** @type {any} */ (FakeSocket), url: 'ws://x/ws' });
    const socket = FakeSocket.all[0];
    assert.equal(link.decide('a1', 'allow'), false);
    socket.open();
    assert.equal(link.decide('a1', 'allow'), true);
    assert.equal(link.decide('a2', 'deny', 'x'.repeat(600)), true);
    assert.equal(link.setRemoteApprovals(true), true);
    assert.equal(link.decide('a3', 'allow', undefined, 0), true);
    assert.deepEqual(socket.sent[0], { t: 'decide', id: 'a1', decision: 'allow' });
    assert.equal(socket.sent[1].message.length, 500);
    assert.deepEqual(socket.sent[2], { t: 'settings', settings: { remoteApprovals: true } });
    assert.deepEqual(socket.sent[3], { t: 'decide', id: 'a3', decision: 'allow', always: 0 }, '"Allow always" names the suggestion by its index');
  });

  test('notes and stops: a note goes out with its ref, the answer comes back with it, and a stop rides on a deny', () => {
    /** @type {unknown[]} */
    const replies = [];
    const link = connectLive({ store: fakeStore(), WebSocketImpl: /** @type {any} */ (FakeSocket), url: 'ws://x/ws', onNoteReply: (reply) => replies.push(reply) });
    const socket = FakeSocket.all[0];
    assert.equal(link.sendNote('s1', null, 'hi', 'r1'), false, 'not before the socket is open');
    socket.open();
    assert.equal(link.sendNote('s1', null, 'hi', 'r1'), true);
    assert.equal(link.sendNote('s1', 'h7', 'for the helper', 'r2'), true);
    assert.equal(link.decide('a1', 'deny', undefined, undefined, true), true);
    assert.deepEqual(socket.sent, [
      { t: 'note', ref: 'r1', sessionId: 's1', text: 'hi' },
      { t: 'note', ref: 'r2', sessionId: 's1', agentId: 'h7', text: 'for the helper' },
      { t: 'decide', id: 'a1', decision: 'deny', stop: true },
    ]);
    socket.receive({ t: 'note-reply', ref: 'r1', ok: true, id: 'n1' });
    socket.receive({ t: 'note-reply', ref: 'r2', ok: false, error: 'The note was not sent: This helper has finished.' });
    socket.receive({ t: 'note-reply', ref: 7, ok: 'yes' });
    assert.deepEqual(replies, [
      { ref: 'r1', ok: true },
      { ref: 'r2', ok: false, error: 'The note was not sent: This helper has finished.' },
      { ref: null, ok: false },
    ]);
  });

  test('catch me up: the request goes out on an open socket; the answer and your absences come back, with the server\'s clock', () => {
    const digests = [];
    const aways = [];
    const link = connectLive({ store: fakeStore(), WebSocketImpl: /** @type {any} */ (FakeSocket), url: 'ws://x/ws', onDigest: (d) => digests.push(d), onAway: (a, offset) => aways.push([a, Math.round(offset / 60_000)]) });
    const socket = FakeSocket.all[0];
    assert.equal(link.requestDigest(1000), false, 'not yet open');
    socket.open();
    assert.equal(link.requestDigest(1000), true);
    assert.deepEqual(socket.sent, [{ t: 'digest', since: 1000 }]);
    // Every hello says, so an absence from before a restart is not offered again.
    socket.receive({ t: 'hello', history: [], approvals: [], away: { since: 5, until: 9 }, serverTime: Date.now() + 10 * 60_000 });
    socket.receive({ t: 'hello', history: [], approvals: [], serverTime: Date.now() - 3 * 60_000 });
    socket.receive({ t: 'away', away: { since: 20, until: null } });
    socket.receive({ t: 'digest', d: { since: 0, until: 30, crews: [] } });
    // The offset (in minutes here) is the latest hello's: the server's clock ahead of this one.
    assert.deepEqual(aways, [[{ since: 5, until: 9 }, 10], [null, -3], [{ since: 20, until: null }, -3]]);
    assert.deepEqual(digests, [{ since: 0, until: 30, crews: [] }]);
    // A message type the page does not know, or one named like a property of every object, is ignored.
    socket.receive({ t: 'constructor' });
    socket.receive({ t: 'launch' });
    assert.equal(digests.length, 1);
  });

  test('pings while live', () => {
    connectLive({ store: fakeStore(), WebSocketImpl: /** @type {any} */ (FakeSocket), url: 'ws://x/ws' });
    const socket = FakeSocket.all[0];
    socket.open();
    socket.receive({ t: 'hello', history: [], approvals: [] });
    mock.timers.tick(25_000);
    assert.deepEqual(socket.sent, [{ t: 'ping' }]);
  });

  test('a dropped connection says why it is not live, then reconnects', async () => {
    const statuses = [];
    /** @type {any[]} */
    const answers = [null, { app: 'andary', authenticated: false }, { app: 'andary', authenticated: true }];
    const hello = async () => answers.shift();
    connectLive({ store: fakeStore(), WebSocketImpl: /** @type {any} */ (FakeSocket), url: 'ws://x/ws', hello, onStatus: (s) => statuses.push(s) });
    FakeSocket.all[0].open();
    FakeSocket.all[0].receive({ t: 'hello', history: [], approvals: [] });
    FakeSocket.all[0].close();
    assert.deepEqual(statuses, ['live', 'connecting']);
    mock.timers.tick(1000);
    await flush();
    assert.deepEqual(statuses, ['live', 'connecting', 'offline']);
    mock.timers.tick(2000);
    await flush();
    assert.deepEqual(statuses, ['live', 'connecting', 'offline', 'signin']);
    mock.timers.tick(4000);
    await flush();
    assert.deepEqual(statuses, ['live', 'connecting', 'offline', 'signin', 'connecting']);
    assert.equal(FakeSocket.all.length, 2);
  });

  test('the socket offers the andary subprotocol and the sign-in, read afresh for each connection', () => {
    let token = 'first-token-abcdef';
    connectLive({ store: fakeStore(), WebSocketImpl: /** @type {any} */ (FakeSocket), url: 'ws://x/ws', credentials: () => ({ token, view: null }) });
    assert.deepEqual(FakeSocket.all[0].protocols, ['andary', 'andary.token.first-token-abcdef']);
    token = 'second-token-abcdef';
    FakeSocket.all[0].close();
    connectLive({ store: fakeStore(), WebSocketImpl: /** @type {any} */ (FakeSocket), url: 'ws://x/ws', credentials: () => ({ token: null, view: 'viewer-token-abcdef' }) });
    assert.deepEqual(FakeSocket.all.at(-1).protocols, ['andary', 'andary.view.viewer-token-abcdef']);
  });

  test('starting signed out waits for a valid sign-in before opening the socket', async () => {
    const statuses = [];
    const hello = async () => ({ app: 'andary', authenticated: true });
    const link = connectLive({ store: fakeStore(), authenticated: false, WebSocketImpl: /** @type {any} */ (FakeSocket), url: 'ws://x/ws', hello, onStatus: (s) => statuses.push(s) });
    assert.equal(link.status, 'signin');
    assert.equal(FakeSocket.all.length, 0);
    mock.timers.tick(4000);
    await flush();
    assert.equal(FakeSocket.all.length, 1);
    assert.deepEqual(statuses, ['connecting']);
  });

  test('close() stops for good', async () => {
    let probes = 0;
    const link = connectLive({ store: fakeStore(), WebSocketImpl: /** @type {any} */ (FakeSocket), url: 'ws://x/ws', hello: async () => (probes++, null) });
    FakeSocket.all[0].open();
    link.close();
    mock.timers.tick(60_000);
    await flush();
    assert.equal(probes, 0);
    assert.equal(FakeSocket.all.length, 1);
  });
});

describe('helpers', () => {
  test('backoff doubles to a cap, with jitter', () => {
    assert.equal(backoffDelay(0, () => 0.5), 500);
    assert.equal(backoffDelay(1, () => 0.5), 1000);
    assert.equal(backoffDelay(3, () => 0.5), 4000);
    assert.equal(backoffDelay(10, () => 0.5), 10_000);
    assert.equal(backoffDelay(0, () => 0), 400);
    assert.equal(backoffDelay(0, () => 1), 600);
  });

  test('socket URL follows the page origin', () => {
    assert.equal(socketUrl('http://127.0.0.1:4747/?demo=1#x'), 'ws://127.0.0.1:4747/ws');
    assert.equal(socketUrl('https://town.example/app/index.html'), 'wss://town.example/app/ws');
  });

  test('messages must be JSON objects', () => {
    assert.deepEqual(parseMessage('{"t":"hook"}'), { t: 'hook' });
    assert.equal(parseMessage('[]'), null);
    assert.equal(parseMessage('null'), null);
    assert.equal(parseMessage('{oops'), null);
  });

  test('fetchHello recognises only an Andary server', async () => {
    const reply = (status, body) => async () => ({ ok: status === 200, json: async () => body });
    const base = 'http://127.0.0.1:4747/';
    assert.deepEqual(await fetchHello({ base, fetchImpl: /** @type {any} */ (reply(200, { app: 'andary', authenticated: 'yes' })) }), { app: 'andary', authenticated: false });
    assert.equal((await fetchHello({ base, fetchImpl: /** @type {any} */ (reply(200, { app: 'andary', authenticated: true })) }))?.authenticated, true);
    assert.equal(await fetchHello({ base, fetchImpl: /** @type {any} */ (reply(404, null)) }), null);
    assert.equal(await fetchHello({ base, fetchImpl: /** @type {any} */ (reply(200, { app: 'something-else' })) }), null);
    const failing = async () => {
      throw new TypeError('network');
    };
    assert.equal(await fetchHello({ base, fetchImpl: /** @type {any} */ (failing) }), null);
  });

  test('fetchHello tries a sign-in from the link on its own, and keeps it only if accepted', async () => {
    /** @type {string[]} */
    const sent = [];
    /** @type {boolean[]} */
    const settled = [];
    const fetchImpl = async (/** @type {unknown} */ _url, /** @type {any} */ init) => {
      sent.push(init.headers['x-andary-token'] ?? 'none');
      return { ok: true, json: async () => ({ app: 'andary', authenticated: init.headers['x-andary-token'] === 'good-token-abcdefghij' }) };
    };
    const ask = (/** @type {string} */ candidate) => fetchHello({
      base: 'http://127.0.0.1:4747/',
      fetchImpl: /** @type {any} */ (fetchImpl),
      credentials: () => ({ token: 'good-token-abcdefghij', view: null, candidate: { token: candidate, view: null } }),
      confirm: (accepted) => settled.push(accepted),
    });
    assert.equal((await ask('junk-token-abcdefghij'))?.authenticated, true, 'the stored sign-in still works');
    assert.deepEqual(sent, ['junk-token-abcdefghij', 'good-token-abcdefghij']);
    assert.deepEqual(settled, [false]);
    sent.length = 0;
    assert.equal((await ask('good-token-abcdefghij'))?.authenticated, true);
    assert.deepEqual([sent, settled], [['good-token-abcdefghij'], [false, true]]);
  });

  test('fetchHello sends the sign-in as a header, never as a cookie', async () => {
    /** @type {any} */
    let sent = null;
    const fetchImpl = async (/** @type {unknown} */ _url, /** @type {any} */ init) => {
      sent = init;
      return { ok: true, json: async () => ({ app: 'andary', authenticated: true }) };
    };
    await fetchHello({ base: 'http://127.0.0.1:4747/', fetchImpl: /** @type {any} */ (fetchImpl), credentials: () => ({ token: 'tok-abcdefghijklmnop', view: null }) });
    assert.equal(sent.headers['x-andary-token'], 'tok-abcdefghijklmnop');
    assert.equal(sent.credentials, undefined);
  });
});
