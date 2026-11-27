// Finding the user's own programs on the PATH (cloudflared for --tunnel, gh for PR and CI status),
// the same way on every system. Andary runs what it finds by its absolute path with execFile or
// spawn and never through a shell, so on Windows only `<name>.exe` counts: a `.cmd` or `.bat`
// would need a shell (Node refuses to start one without it), and PATHEXT is not consulted.
import { accessSync, constants, statSync } from 'node:fs';
import { delimiter, isAbsolute, join, win32 } from 'node:path';

/** A Windows PATH entry that is absolute: a drive (`C:\`, `C:/`) or a share (`\\host\…`). */
const WINDOWS_ABSOLUTE = /^(?:[a-z]:[\\/]|\\\\)/i;

/**
 * A program on the PATH, or null: `<name>.exe` on Windows, an executable file elsewhere, and only
 * in absolute PATH entries (a relative one would depend on the current folder), first entry first.
 * @param {string} name  without extension
 * @param {NodeJS.ProcessEnv} [env]
 * @param {NodeJS.Platform} [platform]
 * @param {(file: string, platform: NodeJS.Platform) => boolean} [isProgram]  whether a file is a program there (tests)
 * @returns {string|null}
 */
export function findProgram(name, env = process.env, platform = process.platform, isProgram = isProgramFile) {
  const windows = platform === 'win32';
  // Windows spells it Path; a copy of the environment keeps whichever spelling it had.
  const path = env.PATH ?? env.Path ?? '';
  const file = windows ? `${name}.exe` : name;
  for (const dir of path.split(windows ? ';' : delimiter)) {
    if (!dir || !(windows ? WINDOWS_ABSOLUTE.test(dir) : isAbsolute(dir))) continue;
    const candidate = windows ? win32.join(dir, file) : join(dir, file);
    if (isProgram(candidate, platform)) return candidate;
  }
  return null;
}

/**
 * @param {string} file
 * @param {NodeJS.Platform} platform
 */
function isProgramFile(file, platform) {
  try {
    if (!statSync(file).isFile()) return false;
    if (platform !== 'win32') accessSync(file, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}
