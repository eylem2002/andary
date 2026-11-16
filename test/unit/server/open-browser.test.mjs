import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { describe, it } from 'node:test';
import { openBrowser, openerFor } from '../../../server/open-browser.mjs';

const URL_ = 'http://127.0.0.1:4747/?token=abc-_DEF&demo=1';

describe('openBrowser', () => {
  it('picks the opener for each platform', () => {
    assert.deepEqual(openerFor(URL_, 'darwin').command, 'open');
    assert.deepEqual(openerFor(URL_, 'linux'), { command: 'xdg-open', args: [URL_], options: {} });
    const windows = openerFor(URL_, 'win32');
    assert.deepEqual(windows.args, ['/d', '/s', '/c', `start "" "${URL_}"`]);
    assert.equal(windows.options.windowsVerbatimArguments, true);
  });

  it('spawns detached and never throws, even when the opener is missing', () => {
    /** @type {any[]} */
    const calls = [];
    const fakeSpawn = /** @type {any} */ ((command, args, options) => {
      calls.push({ command, args, options });
      const child = Object.assign(new EventEmitter(), { unref: () => {} });
      setImmediate(() => child.emit('error', new Error('ENOENT')));
      return child;
    });
    assert.equal(openBrowser(URL_, { platform: 'linux', spawnImpl: fakeSpawn }), true);
    assert.equal(calls[0].options.detached, true);
    assert.equal(calls[0].options.stdio, 'ignore');
    const throwing = /** @type {any} */ (() => {
      throw new Error('spawn failed');
    });
    assert.equal(openBrowser(URL_, { platform: 'linux', spawnImpl: throwing }), false);
  });

  it('refuses anything that is not a plain local http URL', () => {
    const neverCalled = /** @type {any} */ (() => assert.fail('must not spawn'));
    for (const url of ['file:///etc/passwd', 'http://x/"&calc', 'javascript:alert(1)', 'http://127.0.0.1:1/ & calc']) {
      assert.equal(openBrowser(url, { platform: 'win32', spawnImpl: neverCalled }), false, url);
    }
  });
});
