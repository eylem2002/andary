import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createLeftovers, matchLeftovers, parseCwds, parseLsof, parseNetstat, parseProcNet, systemListeners } from '../../../server/leftovers.mjs';
import { createFakeClock } from '../core/helpers.mjs';

/** @param {string} name @param {Record<string, any>} [extra] */
const hook = (name, extra = {}) => ({ hook_event_name: name, session_id: 's1', cwd: '/work/app', ...extra });
/** @param {string} command @param {Record<string, any>} [input] */
const started = (command, input = {}) => hook('PostToolUse', { tool_name: 'Bash', tool_input: { command, ...input }, tool_response: {} });

test('the system tools\' output is read: lsof, its working folders, /proc/net/tcp, netstat', () => {
  assert.deepEqual(parseLsof('p101\nn*:5173\nn[::1]:5173\np202\nn127.0.0.1:8080\nnjunk\n'), [{ port: 5173, pid: 101 }, { port: 5173, pid: 101 }, { port: 8080, pid: 202 }]);
  assert.deepEqual([...parseCwds('p101\nfcwd\nn/work/app/web\np202\nn/home/me\n')], [[101, '/work/app/web'], [202, '/home/me']]);
  const proc = [
    '  sl  local_address rem_address   st tx_queue rx_queue tr tm->when retrnsmt   uid  timeout inode',
    '   0: 0100007F:1435 00000000:0000 0A 00000000:00000000 00:00000000 00000000  1000        0 1',
    '   1: 0100007F:9C40 0100007F:1435 01 00000000:00000000 00:00000000 00000000  1000        0 2',
  ].join('\n');
  assert.deepEqual(parseProcNet(proc), [5173]);
  const netstat = '\r\n  Proto  Local Address  Foreign Address  State  PID\r\n  TCP    0.0.0.0:5173   0.0.0.0:0  LISTENING  4321\r\n  TCP    10.0.0.2:5000  1.2.3.4:443  ESTABLISHED  99\r\n';
  assert.deepEqual(parseNetstat(netstat), [{ port: 5173, pid: 4321 }]);
});

test('a remembered port that still listens is a leftover; an unknown one is found by its folder', () => {
  const listening = {
    lsof: true,
    listeners: [
      { port: 5173, pid: 11, cwd: '/work/app/web' },
      { port: 5173, pid: 11, cwd: '/work/app/web' },
      { port: 8000, pid: 12, cwd: '/elsewhere' },
      { port: 9229, pid: 13, cwd: '/work/application' },
      { port: 4747, pid: 99, cwd: '/work/app' },
    ],
  };
  const starts = [
    { command: 'npm run dev', port: null, background: true, folder: '/work/app' },
    { command: 'python -m http.server 8000', port: 8000, background: true, folder: '/work/app' },
    { command: 'npx vite --port 3001', port: 3001, background: true, folder: '/work/app' },
  ];
  const found = matchLeftovers(starts, listening, { platform: 'linux', self: 99 });
  assert.deepEqual(found, [
    { command: 'npm run dev', port: 5173, pid: 11, kill: 'kill $(lsof -t -iTCP:5173 -sTCP:LISTEN)' },
    { command: 'python -m http.server 8000', port: 8000, pid: 12, kill: 'kill $(lsof -t -iTCP:8000 -sTCP:LISTEN)' },
  ], 'one per port; /work/application is not inside /work/app; this server is never one');
  // Secrets in a command line are masked before it goes anywhere.
  const secret = matchLeftovers([{ command: 'API_KEY=abcdefghijklmnop12345 npm run dev', port: 5173, background: true, folder: null }], listening, { platform: 'linux', self: 0 });
  assert.doesNotMatch(secret[0].command, /abcdefghijklmnop12345/);
});

test('after a session ends, a moment later, what still listens goes to the town once', async () => {
  const clock = createFakeClock(1000);
  /** @type {any[]} */
  const found = [];
  let asked = 0;
  const leftovers = createLeftovers({
    onFound: (entry) => found.push(entry),
    listening: async () => {
      asked += 1;
      return { lsof: false, listeners: [{ port: 5173, pid: 7, cwd: null }] };
    },
    platform: 'linux',
    delayMs: 100,
    now: clock.now,
  });
  leftovers.observe(started('npm test'));
  leftovers.observe(started('npx vite', { run_in_background: true }));
  leftovers.observe(hook('SessionEnd', { session_id: 'other', reason: 'exit' }));
  leftovers.observe(hook('SessionEnd', { reason: 'exit' }));
  assert.equal(asked, 0, 'not at once');
  await new Promise((resolve) => setTimeout(resolve, 200));
  assert.equal(asked, 1, 'only the session that started a server is looked at');
  assert.deepEqual(found, [{ sessionId: 's1', at: 1000, items: [{ command: 'npx vite', port: 5173, pid: 7, kill: 'kill 7' }] }]);
  assert.deepEqual(leftovers.snapshot(), found);
  // Ended once: a second SessionEnd looks at nothing.
  leftovers.observe(hook('SessionEnd', { reason: 'exit' }));
  await new Promise((resolve) => setTimeout(resolve, 200));
  assert.equal(asked, 1);
  leftovers.dispose();
});

test('nothing still listening: nothing to say', async () => {
  /** @type {any[]} */
  const found = [];
  const leftovers = createLeftovers({ onFound: (entry) => found.push(entry), listening: async () => ({ lsof: true, listeners: [] }), delayMs: 0 });
  leftovers.observe(started('npm run dev -- --port 4000', { run_in_background: true }));
  leftovers.observe(hook('SessionEnd', { reason: 'exit' }));
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.deepEqual(found, []);
  leftovers.dispose();
});

test('a real listening port is found on this computer, with the command to stop it', { skip: process.platform === 'win32' }, async () => {
  const server = createServer(() => {});
  await new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(undefined)));
  const port = /** @type {import('node:net').AddressInfo} */ (server.address()).port;
  try {
    const listening = await systemListeners();
    assert.ok(listening.listeners.some((l) => l.port === port), `port ${port} listens`);
    /** @type {any[]} */
    const found = [];
    const leftovers = createLeftovers({ onFound: (entry) => found.push(entry), delayMs: 0 });
    leftovers.observe(started(`node serve.js --port ${port} &`));
    leftovers.observe(hook('SessionEnd', { reason: 'exit' }));
    for (let i = 0; i < 100 && !found.length; i += 1) await new Promise((resolve) => setTimeout(resolve, 30));
    // This test's own process listens there, and a server never reports itself.
    assert.deepEqual(found, []);
    const items = matchLeftovers([{ command: 'node serve.js', port, background: true, folder: null }], listening, { platform: process.platform, self: -1 });
    assert.equal(items[0]?.port, port);
    leftovers.dispose();
  } finally {
    server.close();
  }
});
