// PR and CI status through the user's own GitHub CLI (CONTRACTS §4.16). After a crew pushes a
// branch or opens a pull request (core/pr-status.js pushSites, from this computer's hooks only),
// this asks `gh pr view --json …` in that repository's work tree, again and again with a growing
// pause, until the checks have finished, the pull request is merged or closed, or an hour has
// passed. Nothing else: Andary holds no token and makes no request of its own; `gh` uses the
// sign-in it already has, and only what it prints is read. It runs `gh` by its absolute path with
// execFile (never a shell), a timeout and no prompts, at most two at a time.
//
// Missing `gh`, or `gh` not signed in, is no error: the town gets a quiet hint once (`hint`), the
// log gets one line, and nothing more is tried until the next push. On by default when `gh` is on
// the PATH; `andary start --no-gh` or the town's Settings turn it off.
import { execFile } from 'node:child_process';
import { statSync } from 'node:fs';
import { win32 } from 'node:path';
import { GH_FIELDS, GITHUB_HOSTS, MAX_PR_SESSIONS, ciEpisode, isSettled, readGhView } from '../public/js/core/pr-status.js';
import { findProgram } from './programs.mjs';

/** @typedef {import('../public/js/core/pr-status.js').PrStatus} PrStatus */

/** The pauses before each look after a push: 30 s, then 1, 2 and 5 minutes, then every 5. */
export const POLL_DELAYS_MS = Object.freeze([30_000, 60_000, 120_000, 300_000]);
/** A push is followed this long at most. */
export const WATCH_MS = 60 * 60_000;
/** How long one `gh` may run. */
export const GH_TIMEOUT_MS = 15_000;
/** Repositories remembered at once; the one asked about longest ago gives way. */
const MAX_REPOS = 32;
/** `gh` processes at once; the others wait their turn. */
const MAX_RUNNING = 2;
/** A turn that waited for a free slot is tried again after this long. */
const BUSY_RETRY_MS = 5000;
/** Failed looks in a row (a timeout, an odd answer) before a push is given up on. */
const MAX_ERRORS = 3;
/** What `gh` may print at most. */
const MAX_OUTPUT_BYTES = 1024 * 1024;

/** @typedef {'missing'|'signin'|null} GhHint */

/**
 * What one run of `gh` came to.
 * @typedef {{ ok: true, stdout: string }|{ ok: false, code: string|number|null, stderr: string, timedOut?: boolean }} GhResult
 */

/**
 * @typedef {(bin: string, args: string[], options: { cwd: string, timeoutMs: number, signal?: AbortSignal }) => Promise<GhResult>} GhRunner
 */

/**
 * The real runner: execFile with the program's absolute path, no shell, no window on Windows, no
 * prompts and no colours, a timeout and an output cap. It never throws.
 * @type {GhRunner}
 */
export function runGh(bin, args, { cwd, timeoutMs, signal }) {
  const env = { ...process.env, GH_PROMPT_DISABLED: '1', GH_NO_UPDATE_NOTIFIER: '1', GH_SPINNER_DISABLED: '1', NO_COLOR: '1', CLICOLOR: '0' };
  return new Promise((resolve) => {
    execFile(bin, args, { cwd, env, signal, timeout: timeoutMs, maxBuffer: MAX_OUTPUT_BYTES, windowsHide: true, shell: false, encoding: 'utf8' }, (error, stdout, stderr) => {
      if (!error) resolve({ ok: true, stdout: String(stdout) });
      else resolve({ ok: false, code: /** @type {any} */ (error).code ?? null, stderr: String(stderr ?? ''), timedOut: Boolean(/** @type {any} */ (error).killed) });
    });
  });
}

/**
 * A work tree's top (forward slashes, as work-trees.mjs keeps them) as a folder to run in: on
 * Windows with its own separators (`C:/w/app` is `C:\w\app`, `//host/share` is `\\host\share`).
 * @param {string} root
 * @param {NodeJS.Platform} [platform]
 */
export function nativeDir(root, platform = process.platform) {
  return platform === 'win32' ? win32.normalize(root) : root;
}

/**
 * What a failed run means: `gh` missing, not signed in, no pull request for the branch, a folder
 * that is not a GitHub repository, or something passing (a timeout, the network).
 * @param {Extract<GhResult, { ok: false }>} result
 * @returns {'missing'|'signin'|'none'|'elsewhere'|'error'}
 */
export function classifyFailure(result) {
  if (result.code === 'ENOENT') return 'missing';
  const said = result.stderr;
  // gh exits with 4 when it needs a sign-in.
  if (result.code === 4 || /gh auth login|not logged in|authentication required|GH_TOKEN/i.test(said)) return 'signin';
  if (/no (?:pull requests|open pull requests) found/i.test(said)) return 'none';
  if (/not a git repository|none of the git remotes|no git remotes|could not determine|not a GitHub|unable to determine/i.test(said)) return 'elsewhere';
  return 'error';
}

/**
 * @typedef {object} Repo  one repository being followed
 * @property {string} root
 * @property {string[]} sessionIds  the crews that pushed there, newest last
 * @property {number} startedAt     the latest push
 * @property {number} polls         answers for that push
 * @property {number} errors        failed looks in a row
 * @property {any} timer
 * @property {boolean} running
 * @property {PrStatus|null} status
 * @property {Set<string>} noted    CI episodes that had their phone note
 * @property {string} branch        the branch gh named for this push: asked by name afterwards, so a checkout meanwhile does not swap pull requests
 */

/**
 * @typedef {object} PrWatchOptions
 * @property {boolean} [wanted]   false: --no-gh (default true)
 * @property {readonly number[]} [delaysMs]  the pauses between looks (POLL_DELAYS_MS; shorter for tests)
 * @property {GhRunner} [run]
 * @property {() => string|null} [findGh]  gh's absolute path, or null
 * @property {(dir: string) => boolean} [isDir]
 * @property {NodeJS.Platform} [platform]
 * @property {() => number} [now]
 * @property {(fn: () => void, ms: number) => any} [setTimer]
 * @property {(timer: any) => void} [clearTimer]
 * @property {(pr: PrStatus) => void} [onChange]   a repository's status changed (owners only)
 * @property {() => void} [onSettings]             on, available or the hint changed
 * @property {(pr: PrStatus) => void} [onFailing]  a pull request's CI started failing (once per head commit)
 * @property {(message: string) => void} [log]     lifecycle lines only: never a path, a branch or what gh said
 */

/**
 * @typedef {object} Watch  a PR watch's state and its fixed parts
 * @property {Required<PrWatchOptions>} o
 * @property {boolean} wanted
 * @property {string|null} bin   gh's absolute path (looked for at the start even when off, so Settings can tell "off" from "missing")
 * @property {GhHint} hint
 * @property {Set<string>} hinted  hints already given, so each is given once until the switch is turned on again
 * @property {Map<string, Repo>} repos  oldest push first
 * @property {number} running
 * @property {boolean} disposed
 * @property {AbortController} abort  stops every gh still running when the server stops
 * @property {readonly string[]} hosts  where a pull request's link may point: github.com, and gh's GH_HOST
 */

/** @param {PrWatchOptions} [options] */
export function createPrWatch(options = {}) {
  /** @type {Required<PrWatchOptions>} */
  const o = {
    wanted: true,
    delaysMs: POLL_DELAYS_MS,
    run: runGh,
    findGh: () => findProgram('gh'),
    isDir: isDirectory,
    platform: process.platform,
    now: Date.now,
    setTimer: setTimeout,
    clearTimer: clearTimeout,
    onChange: () => {},
    onSettings: () => {},
    onFailing: () => {},
    log: () => {},
    ...options,
  };
  /** @type {Watch} */
  const w = { o, wanted: o.wanted, bin: o.findGh(), hint: null, hinted: new Set(), repos: new Map(), running: 0, disposed: false, abort: new AbortController(), hosts: linkHosts(process.env.GH_HOST) };
  return {
    /** @returns {{ on: boolean, available: boolean, hint: GhHint }} */
    settings: () => ({ on: w.wanted && w.bin !== null, available: w.bin !== null, hint: w.hint }),
    /**
     * A crew pushed (or opened a pull request) from a work tree: follow its pull request from now.
     * @param {{ root: string, sessionId: string }} push
     */
    pushed: (push) => pushed(w, push),
    /**
     * The town's switch. Off stops every look (what is known stays); on looks for gh again (it may
     * have been installed meanwhile) and forgets the hints. The caller tells the browsers.
     * @param {boolean} on
     */
    setWanted(on) {
      w.wanted = on;
      if (!on) {
        stopAll(w);
        return;
      }
      w.bin = o.findGh();
      w.hint = null;
      w.hinted.clear();
    },
    /** Every repository's latest status, for a browser's hello. @returns {PrStatus[]} */
    list: () => [...w.repos.values()].flatMap((repo) => (repo.status ? [repo.status] : [])),
    dispose() {
      w.disposed = true;
      w.abort.abort();
      for (const repo of w.repos.values()) if (repo.timer !== null) o.clearTimer(repo.timer);
    },
  };
}

/** @param {Watch} w @param {{ root: string, sessionId: string }} push */
function pushed(w, { root, sessionId }) {
  if (w.disposed || !w.wanted || !root) return;
  if (!w.bin) {
    // Installed since the last look, perhaps.
    w.bin = w.o.findGh();
    if (!w.bin) {
      giveHint(w, 'missing');
      return;
    }
    w.hint = null;
    w.o.onSettings();
  }
  const repo = w.repos.get(root) ?? { root, sessionIds: [], startedAt: 0, polls: 0, errors: 0, timer: null, running: false, status: null, noted: new Set(), branch: '' };
  w.repos.delete(root);
  w.repos.set(root, repo);
  if (w.repos.size > MAX_REPOS) forget(w, /** @type {Repo} */ (w.repos.values().next().value));
  repo.sessionIds = [...repo.sessionIds.filter((id) => id !== sessionId), sessionId].slice(-MAX_PR_SESSIONS);
  repo.startedAt = w.o.now();
  // A new push may be from another branch: gh picks the one checked out now.
  repo.branch = '';
  repo.polls = 0;
  repo.errors = 0;
  schedule(w, repo, w.o.delaysMs[0]);
}

/** Stops every look and says why, once. @param {Watch} w @param {Exclude<GhHint, null>} kind */
function giveHint(w, kind) {
  stopAll(w);
  if (w.hinted.has(kind)) return;
  w.hinted.add(kind);
  w.hint = kind;
  w.o.log(kind === 'missing' ? 'PR and CI status: the GitHub CLI (gh) was not found on the PATH' : 'PR and CI status: gh is not signed in (gh auth login)');
  w.o.onSettings();
}

/** No more looks for this push; its status says so. @param {Watch} w @param {Repo} repo */
function stop(w, repo) {
  if (repo.timer !== null) w.o.clearTimer(repo.timer);
  repo.timer = null;
  if (repo.status?.watching) {
    repo.status = { ...repo.status, watching: false };
    w.o.onChange(repo.status);
  }
}

/** @param {Watch} w */
function stopAll(w) {
  for (const repo of w.repos.values()) stop(w, repo);
}

/** @param {Watch} w @param {Repo} repo */
function forget(w, repo) {
  if (repo.timer !== null) w.o.clearTimer(repo.timer);
  w.repos.delete(repo.root);
}

/** @param {Watch} w @param {Repo} repo @param {number} ms */
function schedule(w, repo, ms) {
  if (repo.timer !== null) w.o.clearTimer(repo.timer);
  repo.timer = w.o.setTimer(() => {
    repo.timer = null;
    void look(w, repo);
  }, ms);
  repo.timer?.unref?.();
}

/** The pause before the next look, or null when the push has been followed long enough. @param {Watch} w @param {Repo} repo */
function nextDelay(w, repo) {
  if (w.o.now() - repo.startedAt >= WATCH_MS) return null;
  const delays = w.o.delaysMs;
  return delays[Math.min(repo.polls + repo.errors, delays.length - 1)];
}

/** One `gh pr view` in the repository, when a slot is free. @param {Watch} w @param {Repo} repo */
async function look(w, repo) {
  if (w.disposed || !w.wanted || !w.bin || w.repos.get(repo.root) !== repo) return;
  if (w.running >= MAX_RUNNING) {
    schedule(w, repo, BUSY_RETRY_MS);
    return;
  }
  const cwd = nativeDir(repo.root, w.o.platform);
  // A work tree removed since (a worktree cleaned up): nothing to ask, and gh would say "missing".
  if (!w.o.isDir(cwd)) {
    forget(w, repo);
    return;
  }
  w.running += 1;
  repo.running = true;
  let result;
  try {
    result = await w.o.run(w.bin, ghArgs(repo.branch), { cwd, timeoutMs: GH_TIMEOUT_MS, signal: w.abort.signal });
  } finally {
    w.running -= 1;
    repo.running = false;
  }
  // Turned off, or a newer push, while gh ran: this answer starts nothing.
  if (w.disposed || !w.wanted || w.repos.get(repo.root) !== repo) return;
  if (result.ok) answered(w, repo, result.stdout);
  else failed(w, repo, result);
}

/** @param {Watch} w @param {Repo} repo @param {string} stdout */
function answered(w, repo, stdout) {
  let json;
  try {
    json = JSON.parse(stdout);
  } catch {
    failed(w, repo, { ok: false, code: null, stderr: '' });
    return;
  }
  repo.polls += 1;
  repo.errors = 0;
  if (w.hint === 'signin') {
    // Signed in since: the hint no longer applies.
    w.hint = null;
    w.o.onSettings();
  }
  const status = readGhView(json, { root: repo.root, sessionIds: repo.sessionIds, at: w.o.now(), previous: repo.status, hosts: w.hosts });
  if (status.branch && !status.branch.startsWith('-')) repo.branch = status.branch;
  const delay = isSettled(status, repo.polls, repo.status) ? null : nextDelay(w, repo);
  repo.status = { ...status, watching: delay !== null };
  w.o.onChange(repo.status);
  if (status.checks.state === 'failing' && status.state === 'OPEN' && !repo.noted.has(ciEpisode(status))) {
    repo.noted.add(ciEpisode(status));
    w.o.onFailing(repo.status);
  }
  if (delay !== null) schedule(w, repo, delay);
}

/** @param {Watch} w @param {Repo} repo @param {Extract<GhResult, { ok: false }>} result */
function failed(w, repo, result) {
  const kind = classifyFailure(result);
  if (kind === 'missing' || kind === 'signin') {
    if (kind === 'missing') w.bin = null;
    giveHint(w, kind);
    return;
  }
  if (kind === 'elsewhere') {
    forget(w, repo);
    return;
  }
  if (kind === 'none') {
    // A pull request may still be opened for the branch: keep looking, quietly.
    repo.polls += 1;
    repo.errors = 0;
  } else {
    repo.errors += 1;
    if (repo.errors === MAX_ERRORS) w.o.log(`PR and CI status: gh did not answer ${MAX_ERRORS} times in a row (${result.timedOut ? 'timed out' : `exit ${result.code ?? 'unknown'}`}); waiting for the next push`);
  }
  const delay = repo.errors >= MAX_ERRORS ? null : nextDelay(w, repo);
  if (delay === null) stop(w, repo);
  else schedule(w, repo, delay);
}

/**
 * `gh pr view`'s arguments: the branch checked out now, or once gh has named it, that branch.
 * @param {string} branch
 */
export function ghArgs(branch) {
  return ['pr', 'view', ...(branch ? [branch] : []), '--json', GH_FIELDS];
}

/**
 * Where a pull request's link may point: github.com, and the host gh is told to use (GH_HOST).
 * @param {string|undefined} ghHost
 * @returns {readonly string[]}
 */
export function linkHosts(ghHost) {
  const host = typeof ghHost === 'string' ? ghHost.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/[/:].*$/, '') : '';
  return host && host !== 'github.com' ? [...GITHUB_HOSTS, host] : GITHUB_HOSTS;
}

/** @param {string} dir */
function isDirectory(dir) {
  try {
    return statSync(dir).isDirectory();
  } catch {
    return false;
  }
}
