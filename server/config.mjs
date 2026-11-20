// Shared constants and path helpers for the server, the CLI and the installer.
// Limits that more than one module needs (request sizes, rates, connection counts) live in LIMITS;
// a limit only one module uses is a named constant at the top of that module (CONTRACTS.md §3).
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Repository (or installed package) root: the folder holding package.json, public/ and hooks/. */
export const ROOT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const PUBLIC_DIR = join(ROOT_DIR, 'public');
/** The forwarder that `install` copies to <ANDARY_HOME>/hook.mjs. */
export const HOOK_SOURCE = join(ROOT_DIR, 'hooks', 'hook.mjs');
export const CLI_PATH = join(ROOT_DIR, 'bin', 'andary.mjs');
export const SIMULATION_MODULE = join(PUBLIC_DIR, 'js', 'sim', 'simulation.js');

export const APP_ID = 'andary';
export const DEFAULT_PORT = 4747;
export const DEFAULT_HOST = '127.0.0.1';
export const DEFAULT_APPROVAL_TIMEOUT_MS = 120_000;
/**
 * The PermissionRequest hook is registered with a 150 s timeout. Claude Code kills the hook at
 * that point, so the town has to give its answer (or give up) a little before.
 */
export const MAX_APPROVAL_TIMEOUT_MS = 140_000;

export const LIMITS = Object.freeze({
  hookBodyBytes: 1024 * 1024,
  /** A teammate's batch: up to 200 events, each already trimmed by their own server. */
  teamBodyBytes: 2 * 1024 * 1024,
  hookRatePerSecond: 300,
  hookBurst: 600,
  wsClients: 16,
  wsMessageBytes: 64 * 1024,
  /** A browser that stops reading is cut off once this much output is queued for it. */
  wsBufferedBytes: 32 * 1024 * 1024,
  wsHeartbeatMs: 30_000,
  wsMessagesPerSecond: 20,
  wsMessageBurst: 60,
  historySize: 2000,
  /** History is also capped by size (JSON characters), so the hello message stays reasonable. */
  historyBytes: 32 * 1024 * 1024,
  pendingApprovals: 50,
  settledApprovals: 50,
  approvalMessageChars: 500,
  /** How long held approvals wait for a browser to come back (a page reload) before going to the terminal. */
  browserGraceMs: 5000,
});

/**
 * Andary's state folder: ANDARY_HOME or ~/.andary.
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {string}
 */
export function resolveHome(env = process.env) {
  return env.ANDARY_HOME ? resolve(env.ANDARY_HOME) : join(homedir(), '.andary');
}

/**
 * Claude Code's user config folder: CLAUDE_CONFIG_DIR or ~/.claude.
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {string}
 */
export function resolveClaudeConfigDir(env = process.env) {
  return env.CLAUDE_CONFIG_DIR ? resolve(env.CLAUDE_CONFIG_DIR) : join(homedir(), '.claude');
}

/** @type {string|undefined} */
let cachedVersion;

/**
 * The package version, read once from package.json.
 * @returns {string}
 */
export function readVersion() {
  if (cachedVersion === undefined) {
    try {
      cachedVersion = String(JSON.parse(readFileSync(join(ROOT_DIR, 'package.json'), 'utf8')).version);
    } catch {
      cachedVersion = '0.0.0';
    }
  }
  return cachedVersion;
}
