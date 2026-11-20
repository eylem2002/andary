// The live-mode WebSocket client, driven with a fake socket, a fake /api/hello and mock timers.
import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, mock, test } from 'node:test';
import { backoffDelay, connectLive, fetchHello, parseMessage, socketUrl } from '../../../public/js/core/connection.js';

class FakeSocket {
  /** @type {FakeSocket[]} */
  static all = [];
  /** @param {string} url */
  constructor(url) {
    this.url = url;
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

  test('decide and settings are sent only on an open socket', () => {
    const link = connectLive({ store: fakeStore(), WebSocketImpl: /** @type {any} */ (FakeSocket), url: 'ws://x/ws' });
    const socket = FakeSocket.all[0];
    assert.equal(link.decide('a1', 'allow'), false);
    socket.open();
    assert.equal(link.decide('a1', 'allow'), true);
    assert.equal(link.decide('a2', 'deny', 'x'.repeat(600)), true);
    assert.equal(link.setRemoteApprovals(true), true);
    assert.deepEqual(socket.sent[0], { t: 'decide', id: 'a1', decision: 'allow' });
    assert.equal(socket.sent[1].message.length, 500);
    assert.deepEqual(socket.sent[2], { t: 'settings', settings: { remoteApprovals: true } });
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

  test('starting signed out waits for a valid cookie before opening the socket', async () => {
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
});
