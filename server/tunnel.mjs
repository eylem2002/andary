// A public HTTPS address for a team town with no account, domain or VPN (ADR 0019): a Cloudflare
// Quick Tunnel. `andary start --team --tunnel` runs the user's own `cloudflared` (found on the
// PATH; Andary never downloads or installs it) as a child, pointed at a loopback port that only
// the tunnel uses, reads the random https://<words>.trycloudflare.com address it prints, and
// stops it with the server. Everything that arrives that way is a request from the internet
// (auth.isTunnelled): it needs a member key or the view token, never the owner's sign-in.
import { spawn, spawnSync } from 'node:child_process';
import { accessSync, constants, existsSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { delimiter, isAbsolute, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Runs cloudflared and stops it when the town's end closes its stdin (tunnel-watchdog.mjs). */
const WATCHDOG = fileURLToPath(new URL('./tunnel-watchdog.mjs', import.meta.url));

/** How long cloudflared may take to print its address. */
export const TUNNEL_TIMEOUT_MS = 30_000;
/** Lines of cloudflared's output kept for an error message. */
const KEPT_LINES = 8;
/** Names under trycloudflare.com that are Cloudflare's own, never a tunnel (api: the request endpoint). */
const RESERVED = new Set(['api', 'www']);
const TUNNEL_URL = /https:\/\/([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)\.trycloudflare\.com(?![\w.\-/])/gi;

/**
 * The quick tunnel's address in cloudflared's output, or null. It prints the address in a box
 * ("|  https://seasonal-deck-organisms-sf.trycloudflare.com  |"); the same output can name
 * https://api.trycloudflare.com/tunnel in an error, which is not it.
 * @param {string} text
 * @returns {string|null} e.g. https://seasonal-deck-organisms-sf.trycloudflare.com
 */
export function parseTunnelUrl(text) {
  for (const match of String(text).matchAll(TUNNEL_URL)) {
    const label = match[1].toLowerCase();
    if (!RESERVED.has(label)) return `https://${label}.trycloudflare.com`;
  }
  return null;
}

/**
 * The cloudflared program on the PATH, or null: `cloudflared.exe` on Windows (never a script),
 * and only in absolute PATH entries (a relative one would depend on the current folder).
 * @param {NodeJS.ProcessEnv} [env]
 * @param {NodeJS.Platform} [platform]
 * @returns {string|null}
 */
export function findCloudflared(env = process.env, platform = process.platform) {
  const path = env.PATH ?? env.Path ?? '';
  const name = platform === 'win32' ? 'cloudflared.exe' : 'cloudflared';
  const absolute = platform === 'win32' ? (/** @type {string} */ dir) => /^(?:[a-z]:[\\/]|\\\\)/i.test(dir) : isAbsolute;
  for (const dir of path.split(platform === 'win32' ? ';' : delimiter)) {
    if (!dir || !absolute(dir)) continue;
    const candidate = join(dir, name);
    if (isProgram(candidate, platform)) return candidate;
  }
  return null;
}

/**
 * @param {string} file
 * @param {NodeJS.Platform} platform
 */
function isProgram(file, platform) {
  try {
    if (!statSync(file).isFile()) return false;
    if (platform !== 'win32') accessSync(file, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * How to install cloudflared, for the message when it is missing.
 * @param {NodeJS.Platform} [platform]
 * @returns {string[]}
 */
export function installHelp(platform = process.platform) {
  const lines = ['--tunnel needs Cloudflare\'s free cloudflared program on your PATH (Andary does not install it). Install it with:'];
  if (platform === 'darwin') lines.push('  brew install cloudflared');
  else if (platform === 'win32') lines.push('  winget install --id Cloudflare.cloudflared');
  else lines.push('  Debian/Ubuntu and other Linux: the package repository at https://pkg.cloudflare.com/', '  or a binary from https://github.com/cloudflare/cloudflared/releases');
  lines.push('  (every system: https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/downloads/)');
  lines.push('Then open a new terminal, check that "cloudflared --version" works, and start again.');
  return lines;
}

/** Where cloudflared looks for a configuration file when none is named (its own list). */
const SYSTEM_CONFIG_DIRS = ['/etc/cloudflared', '/usr/local/etc/cloudflared'];

/**
 * A cloudflared configuration file that stops Quick Tunnels from starting, or could send the
 * tunnel somewhere else, or null. Cloudflare's guide: Quick Tunnels are not supported while
 * ~/.cloudflared/config.yml (or .yaml) exists; cloudflared also reads ~/.cloudflare-warp,
 * ~/cloudflare-warp, /etc/cloudflared and /usr/local/etc/cloudflared.
 * @param {string} [home]
 * @param {string[]} [systemDirs]
 * @returns {string|null}
 */
export function blockingConfig(home = homedir(), systemDirs = process.platform === 'win32' ? [] : SYSTEM_CONFIG_DIRS) {
  const dirs = [join(home, '.cloudflared'), join(home, '.cloudflare-warp'), join(home, 'cloudflare-warp'), ...systemDirs];
  for (const dir of dirs) {
    for (const name of ['config.yml', 'config.yaml']) {
      const file = join(dir, name);
      if (existsSync(file)) return file;
    }
  }
  return null;
}

/**
 * Whether this cloudflared can restrict a Quick Tunnel to email addresses (--allowed-mail, from
 * cloudflared 2026.9.3): its `tunnel --help` lists the flag.
 * @param {string} bin
 * @param {{ run?: typeof spawnSync }} [deps]
 * @returns {boolean}
 */
export function supportsAllowedMail(bin, { run = spawnSync } = {}) {
  const result = run(bin, ['tunnel', '--help'], { encoding: 'utf8', timeout: 10_000, windowsHide: true });
  return /--allowed-mail\b/.test(`${result.stdout ?? ''}${result.stderr ?? ''}`);
}

/**
 * --tunnel-allowed-mail: addresses or `*@domain` wildcards, comma-separated or repeated.
 * @param {string[]|undefined} values
 * @returns {string[]|null} null when no address was given; throws a message for a bad one
 */
export function parseAllowedMail(values) {
  if (!values || values.length === 0) return null;
  const addresses = values.flatMap((value) => value.split(',')).map((value) => value.trim()).filter(Boolean);
  for (const address of addresses) {
    if (!/^(?:\*|[^\s@,*]+)@[a-z0-9-]+(?:\.[a-z0-9-]+)+$/i.test(address)) {
      throw new Error(`--tunnel-allowed-mail takes email addresses or *@domain, comma-separated (got "${address}").`);
    }
  }
  if (addresses.length === 0) throw new Error('--tunnel-allowed-mail needs at least one email address.');
  return addresses;
}

/**
 * The arguments for one Quick Tunnel to a loopback port.
 * @param {number} port
 * @param {string[]|null} [allowedMail]
 * @returns {string[]}
 */
export function tunnelArgs(port, allowedMail = null) {
  const args = ['tunnel', '--no-autoupdate', '--url', `http://127.0.0.1:${port}`];
  for (const address of allowedMail ?? []) args.push('--allowed-mail', address);
  return args;
}

/**
 * @typedef {object} QuickTunnel
 * @property {string} url             https://<words>.trycloudflare.com
 * @property {number} pid             cloudflared's
 * @property {(listener: (code: number|null, signal: string|null) => void) => void} onExit
 *   called if cloudflared ends while the town runs (the address stops working)
 * @property {() => Promise<void>} stop
 */

/**
 * cloudflared's environment: the town's, without Andary's own secrets (a team key, an ntfy
 * topic) and without cloudflared's TUNNEL_* settings, which would change what the tunnel does.
 * @param {NodeJS.ProcessEnv} env
 * @returns {NodeJS.ProcessEnv}
 */
export function tunnelEnv(env) {
  return Object.fromEntries(Object.entries(env).filter(([name]) => !/^(?:ANDARY|TUNNEL)_/i.test(name)));
}

/**
 * Starts cloudflared through the watchdog (tunnel-watchdog.mjs: it stops cloudflared when this
 * process ends, however it ends) and resolves once it printed the tunnel's address. Rejects with
 * a clear message (and cloudflared stopped) if it cannot start, ends first, or prints nothing in
 * time.
 * @param {{ bin: string, port: number, allowedMail?: string[]|null, timeoutMs?: number, env?: NodeJS.ProcessEnv, spawnImpl?: typeof spawn }} options
 * @returns {Promise<QuickTunnel>}
 */
export function startQuickTunnel({ bin, port, allowedMail = null, timeoutMs = TUNNEL_TIMEOUT_MS, env = process.env, spawnImpl = spawn }) {
  const child = spawnImpl(process.execPath, [WATCHDOG, bin, ...tunnelArgs(port, allowedMail)], { stdio: ['pipe', 'pipe', 'pipe'], env: tunnelEnv(env), windowsHide: true });
  // The pipe stays open while the town runs; an error on it means the watchdog is gone.
  child.stdin?.on('error', () => {});
  /** @type {string[]} */
  const lines = [];
  let pending = '';
  let exited = false;
  /** @type {number|null} */
  let pid = null;
  /** @type {string|null} */
  let url = null;
  /** @type {((code: number|null, signal: string|null) => void)[]} */
  const exitListeners = [];
  const exitedPromise = new Promise((resolve) => child.once('exit', resolve));

  const stop = async () => {
    if (exited) return;
    // Closing the pipe asks the watchdog to stop cloudflared (SIGTERM, then SIGKILL after 3 s).
    child.stdin?.end();
    const force = setTimeout(() => {
      child.kill('SIGKILL');
      if (pid) killQuietly(pid, 'SIGKILL');
    }, 5000);
    force.unref();
    await exitedPromise;
    clearTimeout(force);
  };

  return new Promise((resolve, reject) => {
    let settled = false;
    const fail = (/** @type {string} */ message) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      void stop();
      const tail = lines.slice(-KEPT_LINES).map((line) => `  ${line}`);
      reject(new Error(tail.length ? `${message}\ncloudflared said:\n${tail.join('\n')}` : message));
    };
    const timer = setTimeout(() => fail(`cloudflared printed no trycloudflare.com address within ${Math.ceil(timeoutMs / 1000)} s. Quick Tunnels have no uptime guarantee; a firewall that blocks outbound port 7844 also stops them. Try again later.`), timeoutMs);
    const settle = () => {
      if (settled || !url || !pid) return;
      settled = true;
      clearTimeout(timer);
      resolve({ url, pid, onExit: (listener) => exitListeners.push(listener), stop });
    };

    /** @param {string} line */
    const readLine = (line) => {
      const marker = /^andary-tunnel-(pid|error) (.+)$/.exec(line.trim());
      if (marker?.[1] === 'pid') {
        pid = Number(marker[2]);
      } else if (marker) {
        fail(`Could not run cloudflared (${marker[2]}).`);
        return;
      } else {
        if (line.trim()) lines.push(line.slice(0, 300));
        if (lines.length > KEPT_LINES * 4) lines.splice(0, lines.length - KEPT_LINES);
        url ??= parseTunnelUrl(line);
      }
      settle();
    };
    const read = (/** @type {Buffer|string} */ chunk) => {
      // Read on after the address too, or cloudflared would block on a full pipe.
      pending += chunk.toString();
      const parts = pending.split(/\r?\n/);
      pending = parts.pop() ?? '';
      if (pending.length > 4096) pending = pending.slice(-4096);
      for (const line of parts) readLine(line);
    };
    child.stdout?.on('data', read);
    child.stderr?.on('data', read);
    child.once('error', (/** @type {NodeJS.ErrnoException} */ error) => {
      exited = true;
      fail(`Could not run cloudflared (${error.code ?? error.message}).`);
    });
    child.once('exit', (code, signal) => {
      exited = true;
      if (!settled) {
        fail(`cloudflared stopped before it printed an address (exit code ${code ?? signal}).`);
        return;
      }
      for (const listener of exitListeners) listener(code, signal);
    });
  });
}

/**
 * @param {number} pid
 * @param {NodeJS.Signals} signal
 */
function killQuietly(pid, signal) {
  try {
    process.kill(pid, signal);
  } catch {
    // already gone
  }
}

/**
 * A process's command line, best effort: /proc on Linux, `ps` on other Unix systems, CIM on
 * Windows. Null when it cannot be read.
 * @param {number} pid
 * @param {{ platform?: NodeJS.Platform, run?: typeof spawnSync, readFile?: (path: string) => Buffer }} [deps]
 * @returns {string|null}
 */
export function commandLineOf(pid, { platform = process.platform, run = spawnSync, readFile = (path) => readFileSync(path) } = {}) {
  if (!Number.isSafeInteger(pid) || pid <= 0) return null;
  try {
    if (platform === 'linux') return readFile(`/proc/${pid}/cmdline`).toString('utf8').split('\0').join(' ').trim() || null;
    const result =
      platform === 'win32'
        ? run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `(Get-CimInstance Win32_Process -Filter "ProcessId=${pid}").CommandLine`], { encoding: 'utf8', timeout: 10_000, windowsHide: true })
        : run('ps', ['-o', 'args=', '-p', String(pid)], { encoding: 'utf8', timeout: 10_000 });
    return result.status === 0 ? String(result.stdout).trim() || null : null;
  } catch {
    return null;
  }
}

/**
 * Whether a command line is cloudflared running the town's tunnel to `port`.
 * @param {string|null} commandLine
 * @param {number} port
 */
export function isTunnelCommand(commandLine, port) {
  if (!commandLine) return false;
  return /(?:^|[\s"'/\\])cloudflared(?:\.exe)?(?=["'\s]|$)/i.test(commandLine) && commandLine.split(/[\s"']+/).includes(`http://127.0.0.1:${port}`);
}

/**
 * @typedef {{ status: 'none' } | { status: 'stopped'|'unverified'|'failed', pid: number }} OrphanResult
 */

/**
 * Stops a cloudflared left behind by a town that did not stop cleanly (killed, crashed): its
 * public address would still point at the old tunnel port, and whatever takes that port later
 * would be on the internet. Only when server.json's town is gone, its tunnel's pid is alive, and
 * that pid's command line is cloudflared for that port; a pid that cannot be checked is left
 * alone ('unverified').
 * @param {import('./state-file.mjs').ServerState|null} state  server.json, of a town that is not running
 * @param {{ alive: (pid: unknown) => boolean, commandLine?: (pid: number) => string|null, kill?: (pid: number, signal: NodeJS.Signals) => void, waitMs?: number }} deps
 * @returns {Promise<OrphanResult>}
 */
export async function stopOrphanTunnel(state, { alive, commandLine = (pid) => commandLineOf(pid), kill = killQuietly, waitMs = 3000 }) {
  const pid = state?.tunnel?.pid;
  const port = state?.tunnel?.port;
  if (!state || !pid || alive(state.pid) || !alive(pid)) return { status: 'none' };
  if (!port || !isTunnelCommand(commandLine(pid), port)) return { status: 'unverified', pid };
  for (const signal of /** @type {const} */ (['SIGTERM', 'SIGKILL'])) {
    kill(pid, signal);
    for (let waited = 0; waited < waitMs; waited += 50) {
      if (!alive(pid)) return { status: 'stopped', pid };
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }
  return { status: 'failed', pid };
}

/**
 * What to say about stopOrphanTunnel's result, or null when there was nothing to do.
 * @param {OrphanResult} result
 * @returns {{ status: 'ok'|'warn'|'fail', text: string }|null}
 */
export function describeOrphan(result) {
  if (result.status === 'none') return null;
  if (result.status === 'stopped') return { status: 'ok', text: `Stopped a cloudflared (pid ${result.pid}) left behind by a town that did not stop cleanly: its old internet address no longer reaches this computer.` };
  if (result.status === 'failed') return { status: 'fail', text: `A cloudflared (pid ${result.pid}) left behind by an earlier town did not stop. Stop it yourself: its old internet address may still reach this computer.` };
  return { status: 'warn', text: `Process ${result.pid} was an earlier town's cloudflared and is still running, but could not be confirmed to be it, so it was left alone. If it is cloudflared, stop it: its old internet address may still reach this computer.` };
}
