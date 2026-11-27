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
  // IPv4 and IPv6, and a localized LISTENING (a listener has no foreign port); UDP and connections left out.
  const netstat = [
    '',
    '  Proto  Local Address  Foreign Address  State  PID',
    '  TCP    0.0.0.0:5173   0.0.0.0:0  LISTENING  4321',
    '  TCP    [::1]:5174     [::]:0     ABHÖREN    4322',
    '  TCP    10.0.0.2:5000  1.2.3.4:443  ESTABLISHED  99',
    '  UDP    0.0.0.0:5353   *:*  77',
  ].join('\r\n');
  assert.deepEqual(parseNetstat(netstat), [{ port: 5173, pid: 4321 }, { port: 5174, pid: 4322 }]);
});

const where = { platform: 'linux', self: 99, real: (/** @type {string} */ f) => f };

test('only a listener from inside the command\'s folder is the session\'s; your own server on the same port is not', () => {
  const listening = {
    lsof: true,
    listeners: [
      { port: 5173, pid: 11, cwd: '/work/app/web' },
      { port: 5173, pid: 11, cwd: '/work/app/web' },
      { port: 8000, pid: 12, cwd: '/elsewhere' },
      { port: 3001, pid: 15, cwd: '/home/me/other-project' },
      { port: 9229, pid: 13, cwd: '/work/application' },
      { port: 4747, pid: 99, cwd: '/work/app' },
    ],
  };
  const starts = [
    { command: 'npm run dev', port: null, background: true, folder: '/work/app' },
    { command: 'python -m http.server 8000', port: 8000, background: true, folder: '/work/app' },
    { command: 'npx vite --port 3001', port: 3001, background: true, folder: '/work/app' },
  ];
  assert.deepEqual(matchLeftovers(starts, listening, where), [
    { command: 'npm run dev', port: 5173, pid: 11, look: 'lsof -nP -iTCP:5173 -sTCP:LISTEN', kill: 'kill 11', sure: true },
  ], 'port 8000 and 3001 listen from other folders; /work/application is not inside /work/app; this server is never one');
  // Secrets in a command line are masked before it goes anywhere.
  const secret = matchLeftovers([{ command: 'API_KEY=abcdefghijklmnop12345 npm run dev', port: 5173, background: true, folder: '/work/app' }], listening, where);
  assert.doesNotMatch(secret[0].command, /abcdefghijklmnop12345/);
});

test('where the system does not say the folder, a remembered port is shown as maybe not the session\'s, with no stop command', () => {
  const procOnly = { lsof: false, listeners: [{ port: 5173, pid: null, cwd: null }, { port: 6000, pid: null, cwd: null }] };
  const starts = [
    { command: 'npx vite', port: 5173, background: true, folder: '/work/app' },
    { command: 'npm run dev', port: null, background: true, folder: '/work/app' },
  ];
  assert.deepEqual(matchLeftovers(starts, procOnly, where), [
    { command: 'npx vite', port: 5173, pid: null, look: "ss -ltnp 'sport = :5173'", kill: null, sure: false },
  ], 'an unknown port is never matched without a folder');
  const windows = { lsof: false, listeners: [{ port: 5173, pid: 40, cwd: null }] };
  assert.deepEqual(matchLeftovers([starts[0]], windows, { ...where, platform: 'win32' }), [
    { command: 'npx vite', port: 5173, pid: 40, look: 'Get-NetTCPConnection -LocalPort 5173 -State Listen', kill: null, sure: false },
  ]);
});

test('after a session ends, a moment later and once more to confirm, what the same process still holds goes to the town once', async () => {
  const clock = createFakeClock(1000);
  /** @type {any[]} */
  const found = [];
  let asked = 0;
  const leftovers = createLeftovers({
    onFound: (entry) => found.push(entry),
    listening: async () => {
      asked += 1;
      return { lsof: true, listeners: [{ port: 5173, pid: 7, cwd: '/work/app' }, { port: 6006, pid: asked === 1 ? 8 : 9, cwd: '/work/app' }] };
    },
    platform: 'linux',
    delayMs: 50,
    confirmMs: 50,
    now: clock.now,
  });
  leftovers.observe(started('npm test'));
  leftovers.observe(started('npx vite', { run_in_background: true }));
  leftovers.observe(started('npx storybook dev', { run_in_background: true }));
  leftovers.observe(hook('SessionEnd', { session_id: 'other', reason: 'exit' }));
  leftovers.observe(hook('SessionEnd', { reason: 'exit' }));
  assert.equal(asked, 0, 'not at once');
  await new Promise((resolve) => setTimeout(resolve, 250));
  assert.equal(asked, 2, 'only the session that started a server is looked at, twice');
  assert.deepEqual(found, [{ sessionId: 's1', at: 1000, items: [{ command: 'npx vite', port: 5173, pid: 7, look: 'lsof -nP -iTCP:5173 -sTCP:LISTEN', kill: 'kill 7', sure: true }] }], 'port 6006 changed hands between the two looks');
  assert.deepEqual(leftovers.snapshot(), found);
  // Ended once: a second SessionEnd looks at nothing.
  leftovers.observe(hook('SessionEnd', { reason: 'exit' }));
  await new Promise((resolve) => setTimeout(resolve, 200));
  assert.equal(asked, 2);
  leftovers.dispose();
});

test('nothing still listening: nothing to say', async () => {
  /** @type {any[]} */
  const found = [];
  const leftovers = createLeftovers({ onFound: (entry) => found.push(entry), listening: async () => ({ lsof: true, listeners: [] }), delayMs: 0, confirmMs: 0 });
  leftovers.observe(started('npm run dev -- --port 4000', { run_in_background: true }));
  leftovers.observe(hook('SessionEnd', { reason: 'exit' }));
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.deepEqual(found, []);
  leftovers.dispose();
});

test('a real listening port is found on this computer, from its folder, with the commands for it', { skip: process.platform === 'win32' }, async () => {
  const server = createServer(() => {});
  await new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(undefined)));
  const port = /** @type {import('node:net').AddressInfo} */ (server.address()).port;
  try {
    const listening = await systemListeners();
    assert.ok(listening.listeners.some((l) => l.port === port), `port ${port} listens`);
    /** @type {any[]} */
    const found = [];
    const leftovers = createLeftovers({ onFound: (entry) => found.push(entry), delayMs: 0, confirmMs: 0 });
    leftovers.observe(started(`node serve.js --port ${port} &`, {}));
    leftovers.observe(hook('SessionEnd', { reason: 'exit' }));
    for (let i = 0; i < 50 && !found.length; i += 1) await new Promise((resolve) => setTimeout(resolve, 30));
    // This test's own process listens there, and a server never reports itself.
    assert.deepEqual(found, []);
    const items = matchLeftovers([{ command: 'node serve.js', port, background: true, folder: process.cwd() }], listening, { platform: process.platform, self: -1 });
    assert.equal(items[0]?.port, port);
    if (listening.lsof) assert.deepEqual([items[0].sure, items[0].kill], [true, `kill ${process.pid}`]);
    // From another folder it is not the session's.
    const elsewhere = matchLeftovers([{ command: 'node serve.js', port, background: true, folder: '/nowhere/else' }], listening, { platform: process.platform, self: -1 });
    assert.deepEqual(elsewhere.filter((item) => item.sure), []);
    leftovers.dispose();
  } finally {
    server.close();
  }
});
