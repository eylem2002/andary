import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { after, before, describe, it } from 'node:test';
import { personToken, teamSecret, viewToken } from '../../server/team.mjs';
import { closeBrowser, connectBrowser, hookPayload, postHook, startTown, waitForMessage } from './helpers.mjs';
import { HOMES } from '../../public/js/core/town-map.js';
import { readRoster } from '../../server/people.mjs';

const cli = fileURLToPath(new URL('../../cli/andary.mjs', import.meta.url));

describe('Team town presence', () => {
  /** @type {Awaited<ReturnType<typeof startTown>>} */
  let host;
  /** @type {string} */
  let secret;
  /** @param {string} name */
  const as = (name) => connectBrowser(host, { protocols: `andary, andary.person.${personToken(secret, name, readRoster(host.home).people[name]?.nonce ?? '')}` });

  before(async () => {
    host = await startTown({ args: ['--team', '--name', 'Sam', '--host', '127.0.0.1'], env: { ANDARY_PORCH_MS: '400', ANDARY_INSIDE_MS: '900' } });
    secret = /** @type {string} */ (teamSecret(host.home, { create: false }));
    for (const name of ['Lina', 'Omar']) spawnSync(process.execPath, [cli, 'team', 'invite', name], { env: { ...process.env, ANDARY_HOME: host.home } });
  });
  after(async () => {
    await host?.stop();
  });

  it('two people see the same walk, timed on the host\'s clock; a viewer sees it and cannot walk', async () => {
    const [lina, omar, viewer] = [await as('Lina'), await as('Omar'), await connectBrowser(host, { protocols: `andary, andary.view.${viewToken(secret)}` })];
    await Promise.all([lina, omar, viewer].map((c) => waitForMessage(c, (m) => m?.t === 'hello')));
    lina.send(JSON.stringify({ t: 'walk', to: [10, 26] }));
    const seen = (/** @type {any} */ c) => waitForMessage(c, (m) => m?.t === 'presence' && m.people.some((/** @type {any} */ p) => p.name === 'Lina' && p.walk));
    const [a, b, c] = await Promise.all([seen(lina), seen(omar), seen(viewer)]);
    const walkOf = (/** @type {any} */ m) => m.people.find((/** @type {any} */ p) => p.name === 'Lina').walk;
    assert.deepEqual(walkOf(a), walkOf(b));
    assert.deepEqual(walkOf(a), walkOf(c));
    assert.deepEqual(walkOf(a).path[0], HOMES[1].door);
    assert.deepEqual(walkOf(a).path.at(-1), [10, 26]);
    viewer.send(JSON.stringify({ t: 'walk', to: [7, 26] }));
    assert.match((await waitForMessage(viewer, (m) => m?.t === 'error')).message, /Viewers can only watch/);
    lina.send(JSON.stringify({ t: 'walk', to: [0, 0] }));
    assert.match((await waitForMessage(lina, (m) => m?.t === 'error')).message, /streets and squares/);

    // Emotes and phrases go to everyone; free text does not exist.
    omar.send(JSON.stringify({ t: 'emote', id: 2 }));
    assert.deepEqual(await waitForMessage(viewer, (m) => m?.t === 'emote'), { t: 'emote', name: 'Omar', id: 2 });
    omar.send(JSON.stringify({ t: 'phrase', id: 'Hello!' }));
    assert.match((await waitForMessage(omar, (m) => m?.t === 'error')).message, /set phrases/);
    // "Come look" reaches only the person asked.
    omar.send(JSON.stringify({ t: 'look', to: 'Lina', at: { building: 'library' } }));
    assert.deepEqual(await waitForMessage(lina, (m) => m?.t === 'look-ask'), { t: 'look-ask', from: 'Omar', at: { building: 'library' } });
    await new Promise((resolve) => setTimeout(resolve, 200));
    assert.ok(!viewer.messages.some((m) => m?.t === 'look-ask'));
    assert.ok(!omar.messages.some((m) => m?.t === 'look-ask'));
    await Promise.all([lina, omar, viewer].map(closeBrowser));
  });

  it('at work, a character stays put; after a Stop it may walk again', async () => {
    const sam = await connectBrowser(host);
    await waitForMessage(sam, (m) => m?.t === 'hello');
    await postHook(host, hookPayload('UserPromptSubmit', { prompt: 'Fix it' }));
    await waitForMessage(sam, (m) => m?.t === 'presence' && m.people.some((/** @type {any} */ p) => p.name === 'Sam' && p.duty === 'work'));
    sam.send(JSON.stringify({ t: 'walk', to: [7, 26] }));
    assert.match((await waitForMessage(sam, (m) => m?.t === 'error')).message, /at work/);
    await postHook(host, hookPayload('Stop'));
    await waitForMessage(sam, (m) => m?.t === 'presence' && m.people.some((/** @type {any} */ p) => p.name === 'Sam' && p.duty === 'free'));
    sam.send(JSON.stringify({ t: 'walk', to: [7, 26] }));
    await waitForMessage(sam, (m) => m?.t === 'presence' && m.people.some((/** @type {any} */ p) => p.name === 'Sam' && p.walk));
    await closeBrowser(sam);
  });

  it('gone: on the porch, then inside with the lights off; a reconnect brings them back', async () => {
    const watcher = await connectBrowser(host, { protocols: `andary, andary.view.${viewToken(secret)}` });
    await waitForMessage(watcher, (m) => m?.t === 'hello');
    const omar = await as('Omar');
    await waitForMessage(omar, (m) => m?.t === 'hello');
    await closeBrowser(omar);
    const state = (/** @type {string|null} */ away) => waitForMessage(watcher, (m) => m?.t === 'presence' && m.people.some((/** @type {any} */ p) => p.name === 'Omar' && p.away === away), 5000);
    const porch = (await state('porch')).people.find((/** @type {any} */ p) => p.name === 'Omar');
    assert.deepEqual(porch.tile, HOMES[2].door);
    assert.equal(porch.lights, false);
    await state('inside');
    const again = await as('Omar');
    const hello = await waitForMessage(again, (m) => m?.t === 'hello');
    const back = hello.people.find((/** @type {any} */ p) => p.name === 'Omar');
    assert.deepEqual([back.online, back.away, back.lights], [true, null, true]);
    await Promise.all([again, watcher].map(closeBrowser));
  });
  it('the cost alerts\' settings and leftovers are the owner\'s: a teammate or a viewer gets neither and cannot change them', async () => {
    const lina = await as('Lina');
    const viewer = await connectBrowser(host, { protocols: `andary, andary.view.${viewToken(secret)}` });
    const owner = await connectBrowser(host);
    const [linaHello, viewerHello, ownerHello] = await Promise.all([lina, viewer, owner].map((c) => waitForMessage(c, (m) => m?.t === 'hello')));
    for (const hello of [linaHello, viewerHello]) {
      assert.equal('watch' in hello.settings, false);
      assert.deepEqual(hello.leftovers, []);
    }
    assert.equal(ownerHello.settings.watch.helpers, 10);
    lina.send(JSON.stringify({ t: 'settings', settings: { watch: { helpers: 2 } } }));
    assert.match((await waitForMessage(lina, (m) => m?.t === 'error')).message, /Teammates can change their own character only/);
    viewer.send(JSON.stringify({ t: 'settings', settings: { watch: { helpers: 2 } } }));
    assert.match((await waitForMessage(viewer, (m) => m?.t === 'error')).message, /Viewers can only watch/);
    // Only the owner's change is taken.
    owner.send(JSON.stringify({ t: 'settings', settings: { watch: { helpers: 12 } } }));
    const changed = await waitForMessage(owner, (m) => m?.t === 'settings' && m.settings.watch);
    assert.equal(changed.settings.watch.helpers, 12);
    await Promise.all([lina, viewer, owner].map(closeBrowser));
  });
});
