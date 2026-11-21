import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { createServer as createNetServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { startTownServer } from '../../server/app.mjs';
import { closeBrowser, connectBrowser, hookPayload, postHook, rawRequest, startTown, waitForMessage } from './helpers.mjs';

/** @typedef {{ path: string, body: string, headers: import('node:http').IncomingHttpHeaders, at: number }} Post */

/**
 * A stand-in for ntfy that keeps every post.
 * @param {Post[]} received
 * @returns {Promise<{ server: import('node:http').Server, port: number }>}
 */
async function fakeNtfy(received) {
  const server = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      received.push({ path: String(req.url), body, headers: req.headers, at: Date.now() });
      res.end('{}');
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', () => r(undefined)));
  return { server, port: /** @type {any} */ (server.address()).port };
}

describe('Phone notifications', () => {
  /** @type {Awaited<ReturnType<typeof startTown>>} */
  let town;
  /** @type {Post[]} */
  const received = [];
  /** @type {import('node:http').Server} */
  let ntfy;
  before(async () => {
    const fake = await fakeNtfy(received);
    ntfy = fake.server;
    town = await startTown({ args: ['--notify-url', `http://127.0.0.1:${fake.port}/my-topic`] });
  });
  after(async () => {
    await town?.stop();
    ntfy?.close();
  });

  it('posts a short note when a crew waits for you, offers a test, and keeps the topic from signed-out pages', async () => {
    // (Permission notes wait ten seconds: they are tested below, with a short wait.)
    await postHook(town, hookPayload('Notification', { notification_type: 'idle_prompt', message: 'Claude is waiting for your input in deploy-prod' }));
    for (let i = 0; i < 50 && received.length === 0; i += 1) await new Promise((r) => setTimeout(r, 50));
    assert.equal(received[0].body, 'A crew is waiting for your next prompt.');
    assert.ok(!JSON.stringify(received[0]).includes('deploy-prod'), 'the note never names the project');
    const hello = JSON.parse((await rawRequest(town.port, { path: '/api/hello' })).text);
    assert.equal(hello.settings.notify, true);
    assert.ok(!JSON.stringify(hello).includes('my-topic'));
    const browser = await connectBrowser(town);
    const greeting = await waitForMessage(browser, (m) => m?.t === 'hello');
    assert.match(greeting.notifyUrl, /\/my-topic$/);
    browser.send(JSON.stringify({ t: 'notify-test' }));
    const answer = await waitForMessage(browser, (m) => m?.t === 'notify-test');
    assert.equal(answer.ok, true);
    assert.equal(received.at(-1).body, 'This is a test notification from your town.');
    assert.match(town.output(), /Phone notifications: on/);
    await closeBrowser(browser);
  });
});

describe('Phone notes for open dialogs, through the real server', () => {
  /** How long a dialog's note waits here (ten seconds in real use). */
  const DELAY_MS = 1000;
  /** @type {Post[]} */
  const received = [];
  /** @type {import('node:http').Server} */
  let ntfy;
  let ntfyPort = 0;
  /** @type {{ stop: () => Promise<void>, root: string }[]} */
  const towns = [];
  before(async () => {
    const fake = await fakeNtfy(received);
    ntfy = fake.server;
    ntfyPort = fake.port;
  });
  after(async () => {
    for (const { stop, root } of towns) {
      await stop();
      rmSync(root, { recursive: true, force: true });
    }
    ntfy?.close();
  });

  /**
   * A server in this process (the wait is a server option, not a flag), posting to its own topic:
   * each has its own 30 s limit.
   * @param {string} topic
   * @param {import('../../server/app.mjs').ServerOptions} [options]
   */
  async function townPosting(topic, options = {}) {
    const root = mkdtempSync(join(tmpdir(), 'andary-notify-'));
    const server = await startTownServer({
      port: 0,
      home: join(root, 'home'),
      claudeDir: join(root, 'claude'),
      writeState: false,
      notifyUrl: `http://127.0.0.1:${ntfyPort}/${topic}`,
      notifyDelayMs: DELAY_MS,
      ...options,
    });
    towns.push({ stop: server.stop, root });
    return { port: server.port, secret: server.secret, uiToken: server.uiToken, baseUrl: server.origin };
  }

  /** @param {string} topic */
  const postsTo = (topic) => received.filter((post) => post.path === `/${topic}`);

  /** @param {string} topic */
  async function firstPostTo(topic) {
    for (let waited = 0; waited < 5 * DELAY_MS; waited += 25) {
      const [post] = postsTo(topic);
      if (post) return post;
      await new Promise((r) => setTimeout(r, 25));
    }
    throw new Error(`Nothing was posted to /${topic}`);
  }

  /** @param {string} sessionId */
  const request = (sessionId) => hookPayload('PermissionRequest', { session_id: sessionId, tool_name: 'Bash', tool_input: { command: 'deploy --prod' } });

  it('posts "A crew needs your permission." once the wait is over, naming nothing', async () => {
    const town = await townPosting('asked');
    const asked = Date.now();
    const answer = await postHook(town, request('crew-asked'));
    assert.equal(JSON.parse(answer.text).output, null, 'nobody is watching the town: the terminal asks');
    const post = await firstPostTo('asked');
    assert.ok(post.at - asked >= DELAY_MS - 50, `posted after ${post.at - asked} ms`);
    assert.equal(post.body, 'A crew needs your permission.');
    assert.equal(post.headers.priority, 'high');
    assert.ok(!JSON.stringify(post).includes('deploy'), 'the note never names the command');
  });

  it('posts "A crew has a question for you." for a question nobody answered', async () => {
    const town = await townPosting('question');
    const asked = { session_id: 'crew-question', tool_name: 'AskUserQuestion', tool_input: { questions: [{ question: 'Which port?' }] } };
    await postHook(town, hookPayload('PreToolUse', asked));
    // Claude Code asks for permission too: the town leaves a question to the terminal.
    assert.equal(JSON.parse((await postHook(town, hookPayload('PermissionRequest', asked))).text).output, null);
    const post = await firstPostTo('question');
    assert.deepEqual([post.body, post.headers.priority], ['A crew has a question for you.', 'high']);
    assert.ok(!JSON.stringify(post).includes('port'), 'the note never quotes the question');
  });

  it('posts nothing for a request decided in the town within the wait', async () => {
    const town = await townPosting('decided', { remoteApprovals: true });
    const browser = await connectBrowser(town);
    await waitForMessage(browser, (m) => m?.t === 'hello');
    const hook = postHook(town, request('crew-decided'));
    const pending = await waitForMessage(browser, (m) => m?.t === 'approval' && m.a.status === 'pending' && m.a.held);
    browser.send(JSON.stringify({ t: 'decide', id: pending.a.id, decision: 'allow' }));
    assert.equal(JSON.parse((await hook).text).output.hookSpecificOutput.decision.behavior, 'allow');
    await new Promise((r) => setTimeout(r, DELAY_MS + 1000));
    assert.deepEqual(postsTo('decided'), []);
    await closeBrowser(browser);
  });

  it('still posts one for a held request that timed out: the agent waits in its terminal', async () => {
    const town = await townPosting('expired', { remoteApprovals: true, approvalTimeoutMs: 200 });
    const browser = await connectBrowser(town);
    await waitForMessage(browser, (m) => m?.t === 'hello');
    const answer = await postHook(town, request('crew-expired'));
    assert.equal(JSON.parse(answer.text).output, null, 'no answer from the town in time');
    assert.equal((await firstPostTo('expired')).body, 'A crew needs your permission.');
    await closeBrowser(browser);
  });

  it('posts nothing while the server stops, even when stopping takes a while', async () => {
    // A team host that never answers: stopping waits 1.5 s for the last events to reach it.
    /** @type {Set<import('node:net').Socket>} */
    const sockets = new Set();
    const silent = createNetServer((socket) => sockets.add(socket));
    await new Promise((r) => silent.listen(0, '127.0.0.1', () => r(undefined)));
    const shareTo = { url: `http://127.0.0.1:${/** @type {any} */ (silent.address()).port}`, key: 'member.key' };
    try {
      const town = await townPosting('stopping', { shareTo, notifyDelayMs: 300 });
      await postHook(town, request('crew-stopping'));
      const started = Date.now();
      await towns.at(-1)?.stop();
      assert.ok(Date.now() - started > 1000, 'stopping waited for the team host');
      assert.deepEqual(postsTo('stopping'), [], 'whoever stops the server is at the computer');
    } finally {
      for (const socket of sockets) socket.destroy();
      silent.close();
    }
  });
});
