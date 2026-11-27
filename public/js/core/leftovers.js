// What a session may have left running (CONTRACTS §4.16): dev servers and other listeners an agent
// started in the background. This module reads a shell command line (core/shell.js) for a server
// and the port it will listen on, and words the command that stops one. Pure and shared with the
// server, which checks after a session ends whether the port still listens (server/leftovers.mjs).
// Nothing is ever stopped by Andary: the town shows the command, you run it.
import { programOf, readShell } from './shell.js';
import { clip, isObject } from './text.js';

/**
 * @typedef {object} ServerStart  a command that starts a server
 * @property {string} command      the line as written, clipped
 * @property {number|null} port    where it listens, when the line says or the tool has a fixed default; null: unknown
 * @property {boolean} background  sent to the background (run_in_background, `&`, nohup, setsid)
 * @property {string|null} folder  where it runs, when known
 */

/**
 * @typedef {object} Leftover  something a session left listening
 * @property {string} command      what started it
 * @property {number} port
 * @property {number|null} pid     the process listening now, when the system says
 * @property {string} kill         a command that stops it, to copy
 */

const COMMAND_CHARS = 200;
const PACKAGE_MANAGERS = new Set(['npm', 'pnpm', 'yarn', 'bun']);
/** Package scripts that serve: `npm run dev`, `pnpm start`, `yarn preview`, `bun run serve:docs`. */
const SERVING_SCRIPT = /^(?:dev|start|serve|preview|develop)(?:$|[:-])/;
/** Programs (as programOf names them) that serve, with their default port when the line names none. */
const SERVERS = Object.freeze(/** @type {Record<string, number|null>} */ ({
  vite: 5173,
  next: 3000,
  nuxt: 3000,
  nuxi: 3000,
  astro: 4321,
  serve: 3000,
  'http-server': 8080,
  'live-server': 8080,
  'webpack-dev-server': 8080,
  'json-server': 3000,
  'http.server': 8000,
  uvicorn: 8000,
  gunicorn: 8000,
  hugo: 1313,
  jekyll: 4000,
  gatsby: 8000,
  wrangler: 8787,
  nodemon: null,
  'ts-node-dev': null,
  remix: 3000,
  storybook: 6006,
}));
/** Tools that serve only with one of these subcommands (`next dev`, `rails s`, `flask run`). */
const SUBCOMMANDS = Object.freeze(/** @type {Record<string, Record<string, number|null>>} */ ({
  vite: { dev: 5173, serve: 5173, preview: 4173 },
  next: { dev: 3000, start: 3000 },
  nuxt: { dev: 3000, preview: 3000 },
  nuxi: { dev: 3000, preview: 3000 },
  astro: { dev: 4321, preview: 4321 },
  hugo: { server: 1313, serve: 1313 },
  jekyll: { serve: 4000, s: 4000 },
  gatsby: { develop: 8000, serve: 9000 },
  wrangler: { dev: 8787 },
  remix: { dev: 3000 },
  storybook: { dev: 6006 },
  rails: { s: 3000, server: 3000 },
  flask: { run: 5000 },
  ng: { serve: 4200, s: 4200 },
  webpack: { serve: 8080 },
  'manage.py': { runserver: 8000 },
}));
/** @param {string[]} args */
const managePy = (args) => ({ serves: args[0] === 'manage.py' && args[1] === 'runserver', port: 8000 });
/** Programs read their own way: `php -S host:port`, `python manage.py runserver`. @type {Readonly<Record<string, (args: string[]) => { serves: boolean, port: number|null }>>} */
const SPECIAL = Object.freeze({ php: (args) => ({ serves: args.includes('-S'), port: null }), python: managePy, python3: managePy });
/** Tools whose bare name starts the server (with no subcommand, or options only). */
const BARE = new Set(['vite', 'serve', 'http-server', 'live-server', 'webpack-dev-server', 'json-server', 'http.server', 'uvicorn', 'gunicorn', 'nodemon', 'ts-node-dev']);
const PORT_OPTIONS = new Set(['--port', '-p', '--listen', '-l', '--http-port', '--server-port']);
const PORT_WITH_VALUE = /^--(?:port|listen|http-port|server-port)=(.+)$/;
const ADDRESS_PORT = /(?:^|[\s/@])(?:\[[0-9a-f:]+\]|[\w.-]*):(\d{2,5})(?:\/|$)/i;
const ASSIGNED_PORT = /^(?:PORT|[A-Z_]*_PORT)=(\d{2,5})$/;

/** @param {string} text @returns {number|null} */
function portNumber(text) {
  if (!/^\d{2,5}$/.test(text)) {
    const at = ADDRESS_PORT.exec(text);
    return at ? portNumber(at[1]) : null;
  }
  const n = Number(text);
  return n >= 1 && n <= 65_535 ? n : null;
}

/**
 * The port a command's words name: `--port 4000`, `--port=4000`, `-p 4000`, `PORT=4000`,
 * `--bind 0.0.0.0:8000`, `localhost:8000`, or python's `http.server 8000`.
 * @param {string[]} argv  as written, with assignments
 * @param {string[]} words  the program's words (programOf)
 * @returns {number|null}
 */
export function portOf(argv, words) {
  for (const word of argv) {
    const assigned = ASSIGNED_PORT.exec(word);
    if (assigned) return portNumber(assigned[1]);
  }
  for (let i = 0; i < words.length; i += 1) {
    const word = words[i];
    const valued = PORT_WITH_VALUE.exec(word);
    if (valued) return portNumber(valued[1]);
    if (PORT_OPTIONS.has(word) && words[i + 1]) return portNumber(words[i + 1]);
    if ((word === '--bind' || word === '-b' || word === '-S') && words[i + 1]) return portNumber(words[i + 1]);
    if (/^-b=?/.test(word) && word.includes(':')) return portNumber(word);
  }
  if (words[0] === 'http.server' || words.includes('runserver')) {
    const positional = words.slice(1).find((w) => /^(?:[\w.-]*:)?\d{2,5}$/.test(w));
    if (positional) return portNumber(positional);
  }
  return null;
}

/**
 * Whether a command's words start a server, and its port when the line names none (null: unknown).
 * @param {string[]} words  the program's words (programOf)
 * @returns {{ serves: boolean, port: number|null }}
 */
function serves(words) {
  const [name, ...args] = words;
  if (!name) return { serves: false, port: null };
  if (PACKAGE_MANAGERS.has(name)) {
    const script = args[0] === 'run' || args[0] === 'run-script' ? args[1] : args[0];
    // A package script's port is the script's business: never guessed.
    return { serves: SERVING_SCRIPT.test(script ?? ''), port: null };
  }
  const special = Object.hasOwn(SPECIAL, name) ? SPECIAL[name](args) : null;
  if (special) return special;
  const sub = args.find((arg) => !arg.startsWith('-'));
  const subs = Object.hasOwn(SUBCOMMANDS, name) ? SUBCOMMANDS[name] : null;
  if (subs && sub !== undefined && Object.hasOwn(subs, sub)) return { serves: true, port: subs[sub] };
  if (BARE.has(name) && (sub === undefined || !subs || name === 'serve' || name === 'http.server')) return { serves: true, port: Object.hasOwn(SERVERS, name) ? SERVERS[name] : null };
  return { serves: false, port: null };
}

/**
 * A server a shell call starts, or null: a dev server or other listener (`npm run dev`,
 * `vite`, `python -m http.server 8000`, `rails s`), or anything sent to the background that names
 * a port. Its port comes from the line, else the tool's fixed default; a package script's is
 * unknown (null), as the script decides.
 * @param {string} tool  Bash or PowerShell
 * @param {unknown} input  the tool's input: its command, and Claude Code's run_in_background
 * @param {string|null} [folder]  where it starts
 * @returns {ServerStart|null}
 */
export function serverStart(tool, input, folder = null) {
  if ((tool !== 'Bash' && tool !== 'PowerShell') || !isObject(input) || typeof input.command !== 'string') return null;
  const command = input.command;
  const { segments } = readShell(command, { powershell: tool === 'PowerShell', folder });
  const backgroundTool = input.run_in_background === true;
  for (const segment of segments) {
    const background = backgroundTool || segment.separator === '&' || /^(?:nohup|setsid)$/.test(segment.argv.find((w) => !w.includes('=')) ?? '');
    // setsid starts its command as nohup does; the shell reader keeps it as the program.
    const words = segment.words[0] === 'setsid' ? programOf(segment.words.slice(1)) : segment.words;
    const found = serves(words);
    const port = portOf(segment.argv, words);
    if (!found.serves && !(background && port !== null)) continue;
    return { command: clip(command.replace(/\s+/g, ' ').trim(), COMMAND_CHARS), port: port ?? found.port, background, folder: segment.folder ?? folder };
  }
  return null;
}

/**
 * A command that stops whatever listens on a port: found again when you run it, so a process that
 * took the old one's id is never hit. POSIX through lsof (macOS has it, most Linux too); Windows
 * through PowerShell. With no port tool, the process id the check saw.
 * @param {number} port
 * @param {{ platform?: string, pid?: number|null, lsof?: boolean }} [options]
 */
export function killCommand(port, { platform = 'linux', pid = null, lsof = true } = {}) {
  if (platform === 'win32') return `Stop-Process -Id (Get-NetTCPConnection -LocalPort ${port} -State Listen).OwningProcess`;
  if (lsof || pid === null) return `kill $(lsof -t -iTCP:${port} -sTCP:LISTEN)`;
  return `kill ${pid}`;
}

/**
 * Leftovers from the server, read defensively (they cross the network): one entry per session
 * that ended with something still listening.
 * @param {unknown} raw
 * @returns {{ sessionId: string, at: number, items: Leftover[] }|null}
 */
export function readLeftovers(raw) {
  if (!isObject(raw) || typeof raw.sessionId !== 'string' || !raw.sessionId || !Array.isArray(raw.items)) return null;
  /** @type {Leftover[]} */
  const items = [];
  for (const item of raw.items.slice(0, 20)) {
    if (!isObject(item) || typeof item.command !== 'string' || typeof item.kill !== 'string' || !Number.isInteger(item.port)) continue;
    items.push({ command: clip(item.command, COMMAND_CHARS), port: /** @type {number} */ (item.port), pid: Number.isInteger(item.pid) ? /** @type {number} */ (item.pid) : null, kill: clip(item.kill, 200) });
  }
  const at = typeof raw.at === 'number' && Number.isFinite(raw.at) ? raw.at : 0;
  return { sessionId: raw.sessionId, at, items };
}
