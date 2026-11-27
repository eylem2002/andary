// What an ended session left running (CONTRACTS §4.16). While a session works, its shell calls
// that start a server (core/leftovers.js serverStart: `npm run dev`, `vite`, a background command
// with a port) are remembered. When the session ends, the server looks once, a moment later,
// which TCP ports listen on this computer and who holds them, read-only (lsof; /proc/net/tcp on
// Linux without it; netstat on Windows), and again a few seconds later to confirm. A listener
// counts only when its working folder is inside the folder the command started in: whatever
// else listens on that port (your own vite on 5173 while the session's moved to 5174) is not the
// session's. Where the system does not say a listener's folder, a remembered port that listens is
// shown as one that may not be the session's, with a command to look and none to stop it.
// Leftovers go to signed-in browsers. Nothing is ever stopped here.
import { execFile } from 'node:child_process';
import { readFileSync, readlinkSync, realpathSync } from 'node:fs';
import { leftoverCommands, serverStart } from '../public/js/core/leftovers.js';
import { isObject } from '../public/js/core/text.js';
import { redactSecrets } from './sanitize.mjs';

/** @typedef {import('../public/js/core/leftovers.js').Leftover} Leftover */
/** @typedef {import('../public/js/core/leftovers.js').ServerStart} ServerStart */
/** @typedef {{ port: number, pid: number|null, cwd: string|null }} Listener */
/** @typedef {{ listeners: Listener[], lsof: boolean }} Listening */
/** @typedef {{ sessionId: string, at: number, items: Leftover[] }} Found */

/** A session's end is looked at this long after it: its own shells may be closing. */
export const CHECK_DELAY_MS = 1500;
/** A leftover is looked at again this long after: it counts only if the same process still listens. */
export const CONFIRM_MS = 5000;
const TOOL_TIMEOUT_MS = 4000;
const MAX_OUTPUT_BYTES = 1024 * 1024;
const MAX_STARTS_PER_SESSION = 20;
const MAX_SESSIONS = 200;
/** Ended sessions whose leftovers are kept for browsers that connect later. */
const MAX_FOUND = 20;
const SHELL_TOOLS = new Set(['Bash', 'PowerShell']);

/**
 * Runs a read-only system tool; resolves with what it printed (lsof exits 1 when it finds nothing),
 * or null when it could not run.
 * @param {string} file @param {string[]} args
 * @returns {Promise<string|null>}
 */
function run(file, args) {
  return new Promise((resolve) => {
    execFile(file, args, { timeout: TOOL_TIMEOUT_MS, maxBuffer: MAX_OUTPUT_BYTES, windowsHide: true }, (error, stdout) => {
      if (error && (/** @type {any} */ (error).code === 'ENOENT' || error.killed)) resolve(null);
      else resolve(typeof stdout === 'string' ? stdout : null);
    });
  });
}

/**
 * lsof's field output (`-F pn`): a `p<pid>` line, then that process's `n<address>` lines.
 * @param {string} text
 * @returns {{ port: number, pid: number }[]}
 */
export function parseLsof(text) {
  /** @type {{ port: number, pid: number }[]} */
  const out = [];
  let pid = 0;
  for (const line of text.split('\n')) {
    if (line.startsWith('p')) pid = Number(line.slice(1));
    else if (line.startsWith('n') && pid > 0) {
      const port = Number(/:(\d+)$/.exec(line)?.[1]);
      if (port > 0 && port < 65_536) out.push({ port, pid });
    }
  }
  return out;
}

/**
 * lsof's working folders (`-a -d cwd -F pn`): pid → folder.
 * @param {string} text
 * @returns {Map<number, string>}
 */
export function parseCwds(text) {
  const out = new Map();
  let pid = 0;
  for (const line of text.split('\n')) {
    if (line.startsWith('p')) pid = Number(line.slice(1));
    else if (line.startsWith('n') && pid > 0) out.set(pid, line.slice(1));
  }
  return out;
}

/**
 * Linux's own table of TCP sockets (/proc/net/tcp, tcp6): the ports in LISTEN (state 0A). No
 * process ids: those need every process's descriptors.
 * @param {string} text
 * @returns {number[]}
 */
export function parseProcNet(text) {
  /** @type {number[]} */
  const ports = [];
  for (const line of text.split('\n').slice(1)) {
    const fields = line.trim().split(/\s+/);
    if (fields[3] !== '0A') continue;
    const port = Number.parseInt(fields[1]?.split(':').at(-1) ?? '', 16);
    if (port > 0) ports.push(port);
  }
  return ports;
}

/**
 * Windows' `netstat -ano`: the TCP ports listening, IPv4 and IPv6 (`[::1]:5173`), and their
 * process ids. A listening socket has no foreign port (`0.0.0.0:0`, `[::]:0`), whatever word a
 * localized Windows uses for LISTENING.
 * @param {string} text
 * @returns {{ port: number, pid: number }[]}
 */
export function parseNetstat(text) {
  /** @type {{ port: number, pid: number }[]} */
  const out = [];
  for (const line of text.split(/\r?\n/)) {
    const fields = line.trim().split(/\s+/);
    if (fields[0] !== 'TCP' || !(fields[3] === 'LISTENING' || /:0$/.test(fields[2] ?? ''))) continue;
    const port = Number(/:(\d+)$/.exec(fields[1])?.[1]);
    const pid = Number(fields[4]);
    if (port > 0) out.push({ port, pid: pid > 0 ? pid : 0 });
  }
  return out;
}

/**
 * What listens on this computer now, with each process's working folder where the system says.
 * @param {NodeJS.Platform} [platform]
 * @returns {Promise<Listening>}
 */
export async function systemListeners(platform = process.platform) {
  if (platform === 'win32') {
    const text = await run('netstat', ['-ano']);
    return { listeners: parseNetstat(text ?? '').map(({ port, pid }) => ({ port, pid: pid || null, cwd: null })), lsof: false };
  }
  const text = await run('lsof', ['-nP', '-iTCP', '-sTCP:LISTEN', '-F', 'pn']);
  if (text === null) return { listeners: procListeners(platform), lsof: false };
  const found = parseLsof(text);
  const pids = [...new Set(found.map((f) => f.pid))];
  const cwds = pids.length ? parseCwds((await run('lsof', ['-a', '-p', pids.join(','), '-d', 'cwd', '-F', 'pn'])) ?? '') : new Map();
  if (platform === 'linux') for (const pid of pids) if (!cwds.has(pid)) cwds.set(pid, linkOrNull(`/proc/${pid}/cwd`));
  return { listeners: found.map(({ port, pid }) => ({ port, pid, cwd: cwds.get(pid) ?? null })), lsof: true };
}

/** @param {NodeJS.Platform} platform @returns {Listener[]} */
function procListeners(platform) {
  if (platform !== 'linux') return [];
  const ports = ['/proc/net/tcp', '/proc/net/tcp6'].flatMap((file) => {
    try {
      return parseProcNet(readFileSync(file, 'utf8'));
    } catch {
      return [];
    }
  });
  return [...new Set(ports)].map((port) => ({ port, pid: null, cwd: null }));
}

/** @param {string} path */
function linkOrNull(path) {
  try {
    return readlinkSync(path);
  } catch {
    return null;
  }
}

/** Whether a folder is `top` or inside it (forward slashes, no trailing one). @param {string} folder @param {string} top */
function inside(folder, top) {
  const a = folder.replace(/\\/g, '/').replace(/\/+$/, '');
  const b = top.replace(/\\/g, '/').replace(/\/+$/, '');
  return Boolean(b) && (a === b || a.startsWith(`${b}/`));
}

/** A folder as the system names it (`/tmp` is `/private/tmp` on macOS), else as given. @param {string} folder */
function realOrSame(folder) {
  try {
    return realpathSync(folder);
  } catch {
    return folder;
  }
}

/**
 * The leftovers among what listens. A listener is the session's only when its working folder is
 * inside the folder its command started in (for a remembered port, on that port; for a package
 * script's unknown port, on any). A remembered port that listens where the system does not say
 * the folder (Linux without lsof, Windows, another user's process) may not be the session's: it
 * is shown with a command to look and none to stop it. This server itself is never one.
 * @param {ServerStart[]} starts
 * @param {Listening} listening
 * @param {{ platform: string, self: number, real?: (folder: string) => string }} where
 * @returns {Leftover[]}
 */
export function matchLeftovers(starts, { listeners, lsof }, { platform, self, real = realOrSame }) {
  /** @type {Map<number, Leftover>} */
  const byPort = new Map();
  const add = (/** @type {ServerStart} */ start, /** @type {Listener} */ listener, /** @type {boolean} */ sure) => {
    const before = byPort.get(listener.port);
    if ((before && (before.sure || !sure)) || listener.pid === self) return;
    const { look, kill } = leftoverCommands(listener.port, { platform, pid: listener.pid, lsof });
    byPort.set(listener.port, { command: redactSecrets(start.command), port: listener.port, pid: listener.pid, look, kill: sure ? kill : null, sure });
  };
  for (const start of starts) {
    const folders = start.folder ? [...new Set([start.folder, real(start.folder)])] : [];
    const ours = (/** @type {Listener} */ l) => Boolean(l.cwd) && folders.some((folder) => inside(/** @type {string} */ (l.cwd), folder));
    for (const listener of listeners) {
      if (start.port !== null && listener.port !== start.port) continue;
      if (ours(listener)) add(start, listener, true);
      else if (start.port !== null && !listener.cwd) add(start, listener, false);
    }
  }
  return [...byPort.values()].sort((a, b) => a.port - b.port);
}

/**
 * @typedef {object} LeftoversOptions
 * @property {(found: Found) => void} onFound  a session ended with something still listening
 * @property {() => Promise<Listening>} [listening]  what listens now (tests)
 * @property {string} [platform]
 * @property {number} [delayMs]
 * @property {number} [confirmMs]  the second look's wait
 * @property {() => number} [now]
 */

/** @param {LeftoversOptions} options */
export function createLeftovers({ onFound, listening = () => systemListeners(), platform = process.platform, delayMs = CHECK_DELAY_MS, confirmMs = CONFIRM_MS, now = Date.now }) {
  /** @type {Map<string, ServerStart[]>} sessionId → the servers its shells started, oldest first */
  const starts = new Map();
  /** @type {Found[]} */
  const found = [];
  /** @type {Set<NodeJS.Timeout>} */
  const timers = new Set();
  let disposed = false;

  /** @param {string} sessionId @param {ServerStart[]} list */
  async function check(sessionId, list) {
    let items;
    try {
      const first = matchLeftovers(list, await listening(), { platform, self: process.pid });
      if (!first.length || disposed) return;
      // A second look: only what the same process still holds (a server shutting down, or a
      // port another process took meanwhile, is left out).
      await new Promise((resolve) => {
        const timer = setTimeout(() => {
          timers.delete(timer);
          resolve(undefined);
        }, confirmMs);
        timer.unref?.();
        timers.add(timer);
      });
      if (disposed) return;
      const again = matchLeftovers(list, await listening(), { platform, self: process.pid });
      // What the second look says, of the ports the first saw held by the same process.
      items = again.filter((item) => first.some((f) => f.port === item.port && (f.pid === item.pid || f.pid === null || item.pid === null)));
    } catch {
      return;
    }
    if (disposed || !items.length) return;
    const entry = { sessionId, at: now(), items };
    found.push(entry);
    if (found.length > MAX_FOUND) found.shift();
    onFound(entry);
  }

  return {
    /**
     * A local town payload (after its adapter): remembers servers a shell call started, and looks
     * after a session's end.
     * @param {Record<string, any>} event
     */
    observe(event) {
      if (disposed || !isObject(event)) return;
      const sessionId = typeof event.session_id === 'string' ? event.session_id : '';
      if (!sessionId) return;
      const name = event.hook_event_name;
      if (name === 'PostToolUse' && SHELL_TOOLS.has(event.tool_name)) {
        const start = serverStart(event.tool_name, event.tool_input, typeof event.cwd === 'string' ? event.cwd : null);
        if (!start) return;
        const list = starts.get(sessionId) ?? [];
        starts.delete(sessionId);
        starts.set(sessionId, [...list, start].slice(-MAX_STARTS_PER_SESSION));
        if (starts.size > MAX_SESSIONS) starts.delete(/** @type {string} */ (starts.keys().next().value));
        return;
      }
      if (name !== 'SessionEnd') return;
      const list = starts.get(sessionId);
      starts.delete(sessionId);
      if (!list?.length) return;
      const timer = setTimeout(() => {
        timers.delete(timer);
        void check(sessionId, list);
      }, delayMs);
      timer.unref?.();
      timers.add(timer);
    },
    /** What ended sessions left running, oldest first, for a browser that just connected. */
    snapshot: () => [...found],
    dispose() {
      disposed = true;
      for (const timer of timers) clearTimeout(timer);
      timers.clear();
    },
  };
}
