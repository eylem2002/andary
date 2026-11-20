import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { after, before, describe, it } from 'node:test';
import { closeBrowser, connectBrowser, hookPayload, postHook, rawRequest, startTown, waitForMessage } from './helpers.mjs';

describe('Phone notifications', () => {
  /** @type {Awaited<ReturnType<typeof startTown>>} */
  let town;
  /** @type {{ body: string, headers: import('node:http').IncomingHttpHeaders }[]} */
  const received = [];
  /** @type {import('node:http').Server} */
  let ntfy;
  before(async () => {
    ntfy = createServer((req, res) => {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        received.push({ body, headers: req.headers });
        res.end('{}');
      });
    });
    await new Promise((r) => ntfy.listen(0, '127.0.0.1', () => r(undefined)));
    const port = /** @type {any} */ (ntfy.address()).port;
    town = await startTown({ args: ['--notify-url', `http://127.0.0.1:${port}/my-topic`] });
  });
  after(async () => {
    await town?.stop();
    ntfy?.close();
  });

  it('posts a short note when Claude waits for you, offers a test, and keeps the topic from signed-out pages', async () => {
    // (A permission note is held back for ten seconds: its rules are unit-tested in notify.test.mjs.)
    await postHook(town, hookPayload('Notification', { notification_type: 'idle_prompt', message: 'Claude is waiting for your input in deploy-prod' }));
    for (let i = 0; i < 50 && received.length === 0; i += 1) await new Promise((r) => setTimeout(r, 50));
    assert.equal(received[0].body, 'Claude is waiting for your next prompt.');
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
