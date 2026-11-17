// findRunningServer decides what `stop` signals and what `start`/`status` report, so it must not
// trust a stale server.json just because some Andary answers on that port.
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { findRunningServer, readStateFile } from '../../server/state-file.mjs';
import { startTown } from './helpers.mjs';

/** @type {Awaited<ReturnType<typeof startTown>>} */
let town;
/** @type {string} */
let scratch;

before(async () => {
  town = await startTown();
  scratch = mkdtempSync(join(tmpdir(), 'tt-state-'));
});

after(async () => {
  await town?.stop();
  rmSync(scratch, { recursive: true, force: true });
});

/** @param {string} name @param {Record<string, unknown>} patch */
function homeWith(name, patch) {
  const home = join(scratch, name);
  mkdirSync(home, { recursive: true });
  writeFileSync(join(home, 'server.json'), JSON.stringify({ ...readStateFile(town.home), ...patch }));
  return home;
}

describe('findRunningServer', () => {
  it('finds the server that wrote server.json', async () => {
    assert.equal((await findRunningServer(town.home))?.pid, town.pid);
  });

  it('ignores a file whose pid is gone or whose token the answering server does not know', async () => {
    assert.equal(await findRunningServer(homeWith('dead-pid', { pid: 2 ** 31 - 2 })), null);
    // Another Andary (or anything that says it is one) on the port of a server that is gone.
    assert.equal(await findRunningServer(homeWith('other-server', { pid: process.pid, uiToken: 'from-a-server-that-is-gone' })), null);
  });
});
