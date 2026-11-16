// Opens a URL in the default browser. Best effort: a missing opener (a server without a desktop,
// a container) must never stop Andary, so every failure is swallowed.
import { spawn } from 'node:child_process';

/**
 * The opener command for a platform.
 * @param {string} url
 * @param {NodeJS.Platform} platform
 * @returns {{ command: string, args: string[], options: import('node:child_process').SpawnOptions }}
 */
export function openerFor(url, platform) {
  if (platform === 'darwin') return { command: 'open', args: [url], options: {} };
  if (platform === 'win32') {
    // `start` is a cmd built-in. The empty "" is the window title; the quotes keep "&" in the
    // URL from splitting the command. Verbatim arguments stop Node re-quoting the line.
    return {
      command: process.env.ComSpec || 'cmd.exe',
      args: ['/d', '/s', '/c', `start "" "${url}"`],
      options: { windowsVerbatimArguments: true, windowsHide: true },
    };
  }
  return { command: 'xdg-open', args: [url], options: {} };
}

/**
 * @param {string} url an http:// URL we built ourselves
 * @param {{ platform?: NodeJS.Platform, spawnImpl?: typeof spawn }} [options]
 * @returns {boolean} whether an opener was started
 */
export function openBrowser(url, { platform = process.platform, spawnImpl = spawn } = {}) {
  if (!/^http:\/\/[\w.:[\]-]+\/[\w./?=&%-]*$/.test(url)) return false;
  const { command, args, options } = openerFor(url, platform);
  try {
    const child = spawnImpl(command, args, { ...options, detached: true, stdio: 'ignore' });
    child.on('error', () => {});
    child.unref();
    return true;
  } catch {
    return false;
  }
}
