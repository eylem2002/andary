// Console I/O for the CLI, behind a small interface so commands can be tested without a terminal.
import { homedir } from 'node:os';
import { createInterface } from 'node:readline/promises';
import { CLI_PATH } from '../config.mjs';

/**
 * @typedef {object} CliIo
 * @property {(line?: string) => void} out
 * @property {(line?: string) => void} err
 * @property {NodeJS.ProcessEnv} env
 * @property {string} cwd
 * @property {boolean} interactive          a person is at the keyboard (stdin and stdout are TTYs)
 * @property {(question: string) => Promise<string>} ask
 */

let pipesGuarded = false;

/**
 * A reader that stops early (`andary status | head -1`) closes the pipe, and Node turns the next
 * write into an unhandled EPIPE error with a stack trace. Nobody is reading any more, so the
 * output is dropped quietly instead; any other stream error still surfaces.
 */
function guardPipes() {
  if (pipesGuarded) return;
  pipesGuarded = true;
  for (const stream of [process.stdout, process.stderr]) {
    stream.on('error', (/** @type {NodeJS.ErrnoException} */ error) => {
      if (error?.code !== 'EPIPE') throw error;
    });
  }
}

const TERMINAL_CONTROLS =
  // eslint-disable-next-line no-control-regex -- removing terminal control characters is the point
  /[\u0000-\u0008\u000B-\u001F\u007F-\u009F]/g;

/**
 * Shows control characters as \xNN. CLI output includes paths (the current folder, settings
 * files) and error text, and a folder name from an unpacked archive can hold escape sequences that
 * would retitle the terminal, rewrite earlier lines or set the clipboard (OSC 52).
 * @param {unknown} text
 * @returns {string}
 */
export function printable(text) {
  return String(text).replace(TERMINAL_CONTROLS, (ch) => `\\x${ch.charCodeAt(0).toString(16).padStart(2, '0')}`);
}

/** @returns {CliIo} */
export function processIo() {
  guardPipes();
  return {
    out: (line = '') => process.stdout.write(`${printable(line)}\n`),
    err: (line = '') => process.stderr.write(`${printable(line)}\n`),
    env: process.env,
    cwd: process.cwd(),
    interactive: Boolean(process.stdin.isTTY && process.stdout.isTTY),
    async ask(question) {
      const rl = createInterface({ input: process.stdin, output: process.stdout });
      // readline swallows Ctrl+C while it waits for an answer: pass it on to the process.
      rl.on('SIGINT', () => {
        rl.close();
        process.emit('SIGINT', 'SIGINT');
      });
      try {
        return await rl.question(question);
      } catch {
        return '';
      } finally {
        rl.close();
      }
    },
  };
}

/**
 * Shortens paths under the home folder to ~ for display.
 * @param {string} path
 * @returns {string}
 */
export function tildify(path) {
  const home = homedir();
  return path === home || path.startsWith(`${home}/`) || path.startsWith(`${home}\\`) ? `~${path.slice(home.length)}` : path;
}

/**
 * How the user should invoke the CLI in printed hints: `andary` when it came from a package
 * bin on the PATH, `npx andary` from npx, otherwise `node "<path to bin/andary.mjs>"`.
 * @param {string} [argv1]
 * @returns {string}
 */
export function cliInvocation(argv1 = process.argv[1] ?? '') {
  if (/[\\/]_npx[\\/]/.test(argv1)) return 'npx andary';
  // Split on both separators: the npm shim on Windows is andary.cmd in a backslash path.
  const name = (argv1.split(/[\\/]/).pop() ?? '').replace(/\.(cmd|ps1|exe)$/i, '');
  if (name === 'andary') return 'andary';
  return `node "${CLI_PATH}"`;
}

/**
 * @param {number} ms
 * @returns {Promise<void>}
 */
export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
