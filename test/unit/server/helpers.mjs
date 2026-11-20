// Shared helpers for the server suites: what the operating system lets the tests do.
import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * Why tests that plant symbolic links cannot run here, or false when they can. Windows allows
 * links only with Developer Mode or admin rights; without them those tests are skipped.
 * @type {string|false}
 */
export const CANNOT_SYMLINK = (() => {
  const dir = mkdtempSync(join(tmpdir(), 'tt-link-'));
  try {
    writeFileSync(join(dir, 'target'), '');
    symlinkSync(join(dir, 'target'), join(dir, 'link'));
    return false;
  } catch {
    return 'this system does not allow symbolic links (Windows without Developer Mode or admin rights)';
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
})();
