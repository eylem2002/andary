// A public HTTPS address for a team town with no account, domain or VPN (ADR 0018): a Cloudflare
// Quick Tunnel. `andary start --team --tunnel` runs the user's own `cloudflared` (found on the
// PATH; Andary never downloads or installs it) as a child, pointed at a loopback port that only
// the tunnel uses, reads the random https://<words>.trycloudflare.com address it prints, and
// stops it with the server. Everything that arrives that way is a request from the internet
// (auth.isTunnelled): it needs a member key or the view token, never the owner's sign-in.
import { spawn, spawnSync } from 'node:child_process';
import { accessSync, constants, existsSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { delimiter, join } from 'node:path';

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
 * The cloudflared program on the PATH, or null. On Windows the PATHEXT extensions are tried.
 * @param {NodeJS.ProcessEnv} [env]
 * @param {NodeJS.Platform} [platform]
 * @returns {string|null}
 */
export function findCloudflared(env = process.env, platform = process.platform) {
  const path = env.PATH ?? env.Path ?? '';
  const extensions = platform === 'win32' ? (env.PATHEXT ?? '.EXE;.CMD;.BAT').split(';').filter(Boolean) : [''];
  for (const dir of path.split(platform === 'win32' ? ';' : delimiter)) {
    if (!dir) continue;
    for (const extension of extensions) {
      const candidate = join(dir, `cloudflared${extension.toLowerCase()}`);
      if (isProgram(candidate, platform)) return candidate;
    }
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

/**
 * A cloudflared configuration file that stops Quick Tunnels from starting, or null. Cloudflare's
 * guide: Quick Tunnels are not supported while ~/.cloudflared/config.yml (or .yaml) exists.
 * @param {string} [home]
 * @returns {string|null}
 */
export function blockingConfig(home = homedir()) {
  for (const name of ['config.yml', 'config.yaml']) {
    const file = join(home, '.cloudflared', name);
    if (existsSync(file)) return file;
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
 * @property {number|undefined} pid   cloudflared's
 * @property {(listener: (code: number|null, signal: string|null) => void) => void} onExit
 *   called if cloudflared ends while the town runs (the address stops working)
 * @property {() => Promise<void>} stop
 */

/**
 * Starts cloudflared and resolves once it printed the tunnel's address. Rejects with a clear
 * message (and cloudflared stopped) if it cannot start, ends first, or prints nothing in time.
 * @param {{ bin: string, port: number, allowedMail?: string[]|null, timeoutMs?: number, env?: NodeJS.ProcessEnv, spawnImpl?: typeof spawn }} options
 * @returns {Promise<QuickTunnel>}
 */
export function startQuickTunnel({ bin, port, allowedMail = null, timeoutMs = TUNNEL_TIMEOUT_MS, env = process.env, spawnImpl = spawn }) {
  // Andary's own secrets (a team key, an ntfy topic) are none of cloudflared's business.
  const childEnv = Object.fromEntries(Object.entries(env).filter(([name]) => !name.startsWith('ANDARY_')));
  const child = spawnImpl(bin, tunnelArgs(port, allowedMail), { stdio: ['ignore', 'pipe', 'pipe'], env: childEnv, windowsHide: true });
  /** @type {string[]} */
  const lines = [];
  let pending = '';
  let exited = false;
  /** @type {((code: number|null, signal: string|null) => void)[]} */
  const exitListeners = [];
  const exitedPromise = new Promise((resolve) => child.once('exit', resolve));
  const killOnExit = () => child.kill('SIGTERM');
  process.once('exit', killOnExit);

  const stop = async () => {
    process.off('exit', killOnExit);
    if (exited) return;
    child.kill('SIGTERM');
    const force = setTimeout(() => child.kill('SIGKILL'), 3000);
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

    const read = (/** @type {Buffer|string} */ chunk) => {
      // Read on after the address too, or cloudflared would block on a full pipe.
      pending += chunk.toString();
      const parts = pending.split(/\r?\n/);
      pending = parts.pop() ?? '';
      if (pending.length > 4096) pending = pending.slice(-4096);
      for (const line of parts) {
        if (line.trim()) lines.push(line.slice(0, 300));
        if (lines.length > KEPT_LINES * 4) lines.splice(0, lines.length - KEPT_LINES);
        const url = settled ? null : parseTunnelUrl(line);
        if (url) {
          settled = true;
          clearTimeout(timer);
          resolve({ url, pid: child.pid, onExit: (listener) => exitListeners.push(listener), stop });
        }
      }
    };
    child.stdout?.on('data', read);
    child.stderr?.on('data', read);
    child.once('error', (/** @type {NodeJS.ErrnoException} */ error) => {
      exited = true;
      fail(`Could not run cloudflared (${error.code ?? error.message}).`);
    });
    child.once('exit', (code, signal) => {
      exited = true;
      process.off('exit', killOnExit);
      if (!settled) {
        fail(`cloudflared stopped before it printed an address (exit code ${code ?? signal}).`);
        return;
      }
      for (const listener of exitListeners) listener(code, signal);
    });
  });
}
