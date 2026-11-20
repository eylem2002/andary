import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { readStateFile, writeStateFile } from '../../../server/state-file.mjs';
import { CANNOT_SYMLINK } from './helpers.mjs';

describe('writeStateFile', () => {
  it('writes server.json with mode 0600 and never through a file already in the folder', () => {
    const home = mkdtempSync(join(tmpdir(), 'tt-state-'));
    try {
      const victim = join(home, 'victim');
      writeFileSync(victim, 'keep me');
      // The temp name older versions used.
      if (!CANNOT_SYMLINK) symlinkSync(victim, join(home, `server.json.${process.pid}.tmp`));
      const state = { pid: process.pid, port: 4747, host: '127.0.0.1', secret: 's', uiToken: 'u', responseKey: 'r', version: '0', startedAt: 0, approvalTimeoutMs: 1 };
      writeStateFile(home, state);
      assert.equal(readFileSync(victim, 'utf8'), 'keep me');
      assert.deepEqual(readStateFile(home), state);
      if (process.platform !== 'win32') assert.equal(statSync(join(home, 'server.json')).mode & 0o777, 0o600);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });
});
