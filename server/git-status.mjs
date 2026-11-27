// Each crew's branch and working tree (CONTRACTS §4.16): which branch a repository is on, whether
// it is a linked worktree, how far it is ahead of or behind its upstream, and how many files are
// changed. The browser cannot look at the disk, so the server asks git itself:
//
//   git --no-optional-locks -c core.fsmonitor=false -C <root> status --porcelain=v2 --branch
//
// Read-only (no optional locks, so not even the index's stat cache is written; no file-system
// monitor, a program a repository's config could name), run without a shell (execFile, the
// folder is one argument), cut off after TIMEOUT_MS, and at most once per MIN_INTERVAL_MS per
// repository: a hook inside that time asks for one more look when the time is up, so the last
// word is never older than that. What git said is kept per repository (at most MAX_REPOS) and
// sent to browsers only when it changed. Only counts and names leave this module, never a file
// name. A repository whose look timed out or said too much is looked at again without untracked
// files (`--untracked-files=no`), and says so (`untracked: null`), until it tries them again a
// few minutes later. A repository that showed a line and can no longer be read is said to be gone
// (`{ root, gone: true }`), so its line goes.
//
// What asks for a look: a local hook that may have changed the working tree or its branch (a
// session starting, a prompt, a turn or helper ending, a file tool or a shell command finishing),
// in the folder's work tree (server/work-trees.mjs). A teammate's hooks never do: their folders
// are on their computer.
import { execFile } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';

/** One look per repository at most this often. */
const MIN_INTERVAL_MS = 10_000;
/** A look that takes longer is stopped. */
const TIMEOUT_MS = 2000;
/** Repositories kept; the one looked at longest ago goes first. */
export const MAX_REPOS = 64;
/** git processes at once, for all repositories. */
const MAX_RUNNING = 2;
/** What a look may print; more means a huge working tree: looked at again without untracked files. */
const MAX_OUTPUT = 1024 * 1024;
/** A repository looked at without untracked files tries them again after this long. */
const SLOW_RETRY_MS = 5 * 60_000;
/** A branch or upstream name, as kept. */
const NAME_CHARS = 200;

/** Hooks after which the working tree or its branch may have changed. */
const TRIGGERS = new Set(['SessionStart', 'UserPromptSubmit', 'Stop', 'SubagentStop', 'PostToolUse', 'PostToolUseFailure']);
/** Tools whose end may have changed files or the branch. */
const TOOLS = new Set(['Bash', 'PowerShell', 'Edit', 'MultiEdit', 'Write', 'NotebookEdit', 'apply_patch']);

/**
 * @typedef {object} GitStatus  one repository, as browsers get it (`{ t: 'git', g }`)
 * @property {string} root        the top of the work tree (andary_root), forward slashes
 * @property {string|null} branch  null when detached (or on an unborn branch with no name)
 * @property {string|null} oid     the commit checked out, 7 characters; null before the first commit
 * @property {string|null} upstream  the branch it tracks, if any
 * @property {number} ahead       commits not on the upstream yet (0 without one)
 * @property {number} behind      upstream commits not here yet
 * @property {number} changed     tracked files changed, staged or not, and conflicts
 * @property {number|null} untracked  new files git does not track yet; null when not counted (a huge tree)
 * @property {string|null} worktree  a linked worktree's folder name; null for a main working tree
 * @property {number} at          when git said so (ms)
 */

/**
 * @typedef {{ stdout: string }|{ error: 'missing'|'timeout'|'too-much'|'failed' }} RunResult
 * @typedef {(root: string, options: { untracked: boolean, timeoutMs: number }) => Promise<RunResult>} Runner
 */

/**
 * What `git status --porcelain=v2 --branch` says, as counts and names (never a file name).
 * @param {string} stdout
 * @returns {Omit<GitStatus, 'root'|'worktree'|'at'|'untracked'> & { untracked: number }}
 */
export function parsePorcelain(stdout) {
  const out = { branch: /** @type {string|null} */ (null), oid: /** @type {string|null} */ (null), upstream: /** @type {string|null} */ (null), ahead: 0, behind: 0, changed: 0, untracked: 0 };
  for (const line of String(stdout).split('\n')) {
    if (line.startsWith('# branch.oid ')) {
      const oid = line.slice(13).trim();
      out.oid = /^[0-9a-f]{7,64}$/.test(oid) ? oid.slice(0, 7) : null;
    } else if (line.startsWith('# branch.head ')) {
      const head = line.slice(14).trim();
      out.branch = head && head !== '(detached)' ? head.slice(0, NAME_CHARS) : null;
    } else if (line.startsWith('# branch.upstream ')) out.upstream = line.slice(18).trim().slice(0, NAME_CHARS) || null;
    else if (line.startsWith('# branch.ab ')) {
      const ab = /^\+(\d+) -(\d+)$/.exec(line.slice(12).trim());
      if (ab) [out.ahead, out.behind] = [Number(ab[1]), Number(ab[2])];
    } else if (/^[12u] /.test(line)) out.changed += 1;
    else if (line.startsWith('? ')) out.untracked += 1;
  }
  return out;
}

/**
 * Runs git status in a folder: no shell, the folder one argument, nothing written, cut off in time.
 * @type {Runner}
 */
export function runGit(root, { untracked, timeoutMs }) {
  const args = ['--no-optional-locks', '-c', 'core.fsmonitor=false', '-C', root, 'status', '--porcelain=v2', '--branch', `--untracked-files=${untracked ? 'normal' : 'no'}`];
  const env = { ...withoutRepoOverrides(process.env), GIT_OPTIONAL_LOCKS: '0', GIT_TERMINAL_PROMPT: '0', LC_ALL: 'C' };
  return new Promise((resolve) => {
    execFile('git', args, { timeout: timeoutMs, maxBuffer: MAX_OUTPUT, windowsHide: true, env, encoding: 'utf8' }, (error, stdout) => {
      if (!error) resolve({ stdout });
      else if (/** @type {any} */ (error).code === 'ENOENT') resolve({ error: 'missing' });
      else if (/** @type {any} */ (error).killed || /** @type {any} */ (error).signal) resolve({ error: 'timeout' });
      else if (/** @type {any} */ (error).code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER') resolve({ error: 'too-much' });
      else resolve({ error: 'failed' });
    });
  });
}

/**
 * Variables that would point git at another repository, index or config than the folder asked
 * about (inherited from whatever started Andary, a git hook for one): left out.
 */
const REPO_OVERRIDES = ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_COMMON_DIR', 'GIT_OBJECT_DIRECTORY', 'GIT_ALTERNATE_OBJECT_DIRECTORIES', 'GIT_CONFIG_PARAMETERS', 'GIT_CONFIG_COUNT', 'GIT_NAMESPACE', 'GIT_CEILING_DIRECTORIES'];

/** @param {NodeJS.ProcessEnv} env @returns {NodeJS.ProcessEnv} */
export function withoutRepoOverrides(env) {
  const out = { ...env };
  for (const name of REPO_OVERRIDES) delete out[name];
  for (const name of Object.keys(out)) if (/^GIT_CONFIG_(KEY|VALUE)_\d+$/.test(name)) delete out[name];
  return out;
}

/**
 * A linked worktree's folder name, or null: its `.git` is a file that points into another
 * repository's `worktrees/` (a submodule's points into `modules/`).
 * @param {string} root
 * @returns {string|null}
 */
export function worktreeName(root) {
  const dotGit = root.endsWith('/') ? `${root}.git` : `${root}/.git`;
  try {
    if (!statSync(dotGit).isFile()) return null;
    const pointer = readFileSync(dotGit, 'utf8').slice(0, 4096);
    if (!/^gitdir: .*[\\/]worktrees[\\/][^\\/]+\s*$/m.test(pointer)) return null;
    return root.replace(/\/+$/, '').split('/').pop() || null;
  } catch {
    return null;
  }
}

/**
 * @typedef {object} Repo
 * @property {GitStatus|null} status
 * @property {number} lastRun
 * @property {boolean} running
 * @property {boolean} again       a hook came while it ran: look once more
 * @property {boolean} slow        untracked files are left out (a look timed out or said too much)
 * @property {number} slowAt       when it became so: SLOW_RETRY_MS later it counts them again
 * @property {string|null|undefined} worktree  undefined until looked up
 * @property {ReturnType<typeof setTimeout>|null} timer
 */

/**
 * @param {object} options
 * @param {(status: GitStatus) => void} options.onChange
 * @param {(root: string) => void} [options.onGone]  a repository that showed a line can no longer be read
 * @param {import('./work-trees.mjs').WorkTrees} [options.workTrees]  finds a hook's work tree when it has no andary_root
 * @param {Runner} [options.run]
 * @param {(root: string) => string|null} [options.worktreeOf]
 * @param {() => number} [options.now]
 * @param {number} [options.minIntervalMs]
 * @param {number} [options.timeoutMs]
 * @param {(message: string) => void} [options.log]
 */
export function createGitStatus({ onChange, onGone = () => {}, workTrees, run = runGit, worktreeOf = worktreeName, now = Date.now, minIntervalMs = MIN_INTERVAL_MS, timeoutMs = TIMEOUT_MS, log = () => {} }) {
  /** @type {Map<string, Repo>} the one asked about longest ago first */
  const repos = new Map();
  /** Repositories waiting for a free git process, in order. @type {Set<string>} */
  const queued = new Set();
  let running = 0;
  let missing = false;
  let disposed = false;

  /** @param {string} root @returns {Repo} */
  function repoOf(root) {
    const repo = repos.get(root) ?? { status: null, lastRun: -Infinity, running: false, again: false, slow: false, slowAt: 0, worktree: undefined, timer: null };
    repos.delete(root);
    repos.set(root, repo);
    while (repos.size > MAX_REPOS) {
      const [oldest, gone] = /** @type {[string, Repo]} */ (repos.entries().next().value);
      if (gone.timer) clearTimeout(gone.timer);
      queued.delete(oldest);
      repos.delete(oldest);
    }
    return repo;
  }

  /** @param {string} root */
  function request(root) {
    if (missing || disposed) return;
    const repo = repoOf(root);
    if (repo.running) {
      repo.again = true;
      return;
    }
    const wait = repo.lastRun + minIntervalMs - now();
    if (wait > 0) {
      repo.timer ??= setTimeout(() => {
        repo.timer = null;
        if (repos.get(root) === repo) request(root);
      }, wait);
      repo.timer.unref?.();
      return;
    }
    if (running >= MAX_RUNNING) {
      queued.add(root);
      return;
    }
    void look(root, repo);
  }

  /** @param {string} root @param {Repo} repo */
  async function look(root, repo) {
    running += 1;
    repo.running = true;
    repo.lastRun = now();
    // A tree that was too big may have shrunk (a build folder cleaned, a .gitignore added).
    if (repo.slow && repo.lastRun - repo.slowAt >= SLOW_RETRY_MS) repo.slow = false;
    const untracked = !repo.slow;
    const result = await run(root, { untracked, timeoutMs });
    running -= 1;
    repo.running = false;
    if (!disposed) settle(root, repo, result, untracked);
    next();
  }

  /** @param {string} root @param {Repo} repo @param {RunResult} result @param {boolean} untracked */
  function settle(root, repo, result, untracked) {
    if ('error' in result) {
      if (result.error === 'missing') {
        missing = true;
        log('git was not found: crews show no branch');
      } else if (result.error === 'failed' && repo.status) {
        // No longer readable (removed, no longer a repository, refused): its line goes.
        repo.status = null;
        onGone(root);
      } else if (untracked && (result.error === 'timeout' || result.error === 'too-much')) {
        // A huge working tree: look again at once, without untracked files.
        repo.slow = true;
        repo.slowAt = now();
        repo.lastRun = -Infinity;
        repo.again = true;
      }
    } else {
      if (repo.worktree === undefined) repo.worktree = worktreeOf(root);
      const parsed = parsePorcelain(result.stdout);
      /** @type {GitStatus} */
      const status = { root, ...parsed, untracked: untracked ? parsed.untracked : null, worktree: repo.worktree, at: now() };
      const changed = !repo.status || JSON.stringify({ ...repo.status, at: 0 }) !== JSON.stringify({ ...status, at: 0 });
      repo.status = status;
      if (changed) onChange(status);
    }
    if (repo.again && repos.get(root) === repo) {
      repo.again = false;
      request(root);
    }
  }

  function next() {
    while (running < MAX_RUNNING && queued.size && !disposed) {
      const root = /** @type {string} */ (queued.values().next().value);
      queued.delete(root);
      const repo = repos.get(root);
      if (repo && !repo.running) void look(root, repo);
    }
  }

  return {
    /**
     * A local hook (already stamped with andary_root where it is a tool hook): asks for a look at
     * its work tree when it may have changed it.
     * @param {Record<string, any>} event
     */
    observe(event) {
      const hook = event?.hook_event_name;
      if (!TRIGGERS.has(hook)) return;
      if ((hook === 'PostToolUse' || hook === 'PostToolUseFailure') && !TOOLS.has(event.tool_name)) return;
      const root = typeof event.andary_root === 'string' && event.andary_root ? event.andary_root : (workTrees?.rootOf(event.cwd) ?? null);
      if (root) request(root);
    },
    /** What git last said of each repository, for hello. @returns {GitStatus[]} */
    snapshot() {
      return [...repos.values()].map((repo) => repo.status).filter((status) => status !== null);
    },
    dispose() {
      disposed = true;
      for (const repo of repos.values()) if (repo.timer) clearTimeout(repo.timer);
      queued.clear();
    },
  };
}
