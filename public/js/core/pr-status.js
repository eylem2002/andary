// Pull requests and their CI, as the user's own GitHub CLI reports them (CONTRACTS §4.16). Pure,
// shared by the server (server/pr-watch.mjs: when to ask `gh`, and what its answer says) and the
// browser (the store's copy, the crew row's badge and the "need you" item). Andary never talks to
// GitHub itself and never handles a token: `gh pr view` runs in the repository a crew pushed from,
// with the sign-in `gh` already has.
//
//   pushSites(event)       where a hook's command pushed a branch or opened a pull request
//   readGhView(json, …)    `gh pr view --json …` as a PrStatus, checks summed up
//   readPrStatus(raw)      a PrStatus that crossed the network, read defensively
//   badgeText(pr)          "PR #123 · CI failing (2)"   ciText(pr): the "need you" line
import { gitAction, readShell } from './shell.js';
import { clip, isObject, oneLine, str } from './text.js';

/** The fields Andary asks `gh pr view` for: nothing else is read. */
export const GH_FIELDS = 'number,url,state,statusCheckRollup,reviewDecision,headRefName,headRefOid';

/** Failed check names kept per pull request (for the badge's tooltip). */
const MAX_FAILED_NAMES = 3;
/** Repositories the town keeps a status for; the one reported longest ago gives way. */
export const MAX_PRS = 32;
/** Sessions remembered per repository: the crews that pushed there, newest last. */
export const MAX_PR_SESSIONS = 8;

/** A check run's conclusions that mean it failed (GitHub's CheckConclusionState). */
const FAILED_CONCLUSIONS = new Set(['FAILURE', 'TIMED_OUT', 'ACTION_REQUIRED', 'STARTUP_FAILURE']);
/** A commit status's states that mean it failed (GitHub's StatusState). */
const FAILED_STATES = new Set(['FAILURE', 'ERROR']);
/** A commit status's states that mean it has not finished. */
const PENDING_STATES = new Set(['PENDING', 'EXPECTED']);
const PR_STATES = new Set(['OPEN', 'MERGED', 'CLOSED']);
const REVIEWS = new Set(['APPROVED', 'CHANGES_REQUESTED', 'REVIEW_REQUIRED']);
const CHECK_STATES = new Set(['passing', 'failing', 'pending', 'none']);
const SHELL_TOOLS = new Set(['Bash', 'PowerShell']);
/** Git's options before the subcommand that take the next word, besides -C. */
const GIT_VALUED = new Set(['-c', '--git-dir', '--work-tree', '--namespace', '--super-prefix', '--config-env']);

/**
 * @typedef {object} Checks
 * @property {'passing'|'failing'|'pending'|'none'} state  failing as soon as one failed, even while others run
 * @property {number} total
 * @property {number} failing
 * @property {number} pending
 * @property {string[]} failed  the first few failed checks' names
 */

/**
 * @typedef {object} PrStatus  one repository's pull request, as `gh` last reported it
 * @property {string} root          the top of the work tree a crew pushed from (its id)
 * @property {string[]} sessionIds  the crews that pushed there, newest last
 * @property {number|null} number   null: no pull request for the branch (yet)
 * @property {string|null} url      https only
 * @property {'OPEN'|'MERGED'|'CLOSED'|null} state
 * @property {'APPROVED'|'CHANGES_REQUESTED'|'REVIEW_REQUIRED'|null} review
 * @property {string} branch
 * @property {string} sha           the head commit the checks ran on ('' when unknown)
 * @property {Checks} checks
 * @property {number} at            when `gh` was last asked
 * @property {number|null} failingSince  when its checks were first seen failing on this head commit
 * @property {boolean} watching     Andary will ask again
 */

/** @returns {Checks} */
const noChecks = () => ({ state: 'none', total: 0, failing: 0, pending: 0, failed: [] });

/**
 * One item of statusCheckRollup: a check run (`status`, `conclusion`) or a commit status (`state`).
 * @param {Record<string, any>} item
 * @returns {'failed'|'pending'|'ok'}
 */
function checkResult(item) {
  if (typeof item.state === 'string' && !('conclusion' in item)) {
    if (FAILED_STATES.has(item.state)) return 'failed';
    return PENDING_STATES.has(item.state) ? 'pending' : 'ok';
  }
  if (str(item.status) && item.status !== 'COMPLETED') return 'pending';
  // Neutral, skipped, cancelled (often a newer push) and stale are no failure.
  return FAILED_CONCLUSIONS.has(str(item.conclusion)) ? 'failed' : 'ok';
}

/**
 * The checks of a pull request's head commit, summed up.
 * @param {unknown} rollup  statusCheckRollup
 * @returns {Checks}
 */
export function summarizeChecks(rollup) {
  const checks = noChecks();
  for (const item of Array.isArray(rollup) ? rollup : []) {
    if (!isObject(item)) continue;
    checks.total += 1;
    const result = checkResult(item);
    if (result === 'pending') checks.pending += 1;
    if (result !== 'failed') continue;
    checks.failing += 1;
    const name = clip(oneLine(str(item.name) || str(item.context)), 80);
    if (name && checks.failed.length < MAX_FAILED_NAMES) checks.failed.push(name);
  }
  if (checks.failing) checks.state = 'failing';
  else if (checks.pending) checks.state = 'pending';
  else if (checks.total) checks.state = 'passing';
  return checks;
}

/** Hosts a pull request's link may point at, unless the server names more (gh's GH_HOST). */
export const GITHUB_HOSTS = Object.freeze(['github.com']);

/**
 * A pull request's link, or null: https, at most 500 characters, nothing a URL parser would
 * rewrite (no spaces, quotes or angle brackets), and, when `hosts` is given, on one of them.
 * @param {unknown} url
 * @param {readonly string[]|null} [hosts]
 */
function httpsUrl(url, hosts = null) {
  if (typeof url !== 'string' || url.length > 500 || /[\s"'<>`\\]/.test(url)) return null;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password) return null;
    if (hosts && !hosts.includes(parsed.hostname.toLowerCase())) return null;
    return parsed.href;
  } catch {
    return null;
  }
}

/**
 * `gh pr view --json GH_FIELDS` for a repository, as a PrStatus.
 * @param {unknown} json  its parsed output
 * @param {{ root: string, sessionIds: string[], at: number, previous?: PrStatus|null, watching?: boolean, hosts?: readonly string[] }} where
 *   hosts: where its link may point (GITHUB_HOSTS by default)
 * @returns {PrStatus}
 */
export function readGhView(json, { root, sessionIds, at, previous = null, watching = true, hosts = GITHUB_HOSTS }) {
  const view = isObject(json) ? json : {};
  const number = Number.isInteger(view.number) && view.number > 0 ? view.number : null;
  const checks = number === null ? noChecks() : summarizeChecks(view.statusCheckRollup);
  const sha = clip(str(view.headRefOid), 64);
  const sameHead = previous !== null && previous.number === number && previous.sha === sha;
  const failingSince = checks.state !== 'failing' ? null : sameHead && previous.failingSince ? previous.failingSince : at;
  return {
    root,
    sessionIds: sessionIds.slice(-MAX_PR_SESSIONS),
    number,
    url: number === null ? null : httpsUrl(view.url, hosts),
    state: PR_STATES.has(view.state) ? view.state : null,
    review: REVIEWS.has(view.reviewDecision) ? view.reviewDecision : null,
    branch: clip(oneLine(str(view.headRefName)), 200),
    sha,
    checks,
    at,
    failingSince,
    watching,
  };
}

/**
 * Whether there is nothing more to wait for: the pull request is closed or merged, its checks
 * failed with none still running, or they passed on two looks in a row at the same head commit
 * (checks that start late, a second workflow, are not missed). A branch with no checks at all is
 * settled once `gh` has said so a few times.
 * @param {PrStatus} pr
 * @param {number} polls  how many times `gh` answered for this push
 * @param {PrStatus|null} [previous]  the look before
 */
export function isSettled(pr, polls, previous = null) {
  if (pr.state === 'MERGED' || pr.state === 'CLOSED') return true;
  if (pr.checks.state === 'none') return pr.number !== null && polls >= 3;
  if (pr.checks.state === 'passing') return previous?.checks.state === 'passing' && previous.sha === pr.sha && previous.number === pr.number;
  return pr.checks.state === 'failing';
}

/**
 * The episode a failing CI is: one pull request's head commit. A new push is a new episode.
 * @param {PrStatus} pr
 */
export const ciEpisode = (pr) => `ci:${pr.root}:${pr.number ?? 0}:${pr.sha}`;

/**
 * A PrStatus that crossed the network (or came from the demo), or null.
 * @param {unknown} raw
 * @returns {PrStatus|null}
 */
export function readPrStatus(raw) {
  if (!isObject(raw) || typeof raw.root !== 'string' || !raw.root) return null;
  const checks = isObject(raw.checks) ? raw.checks : {};
  const count = (/** @type {unknown} */ n) => (Number.isInteger(n) && /** @type {number} */ (n) >= 0 ? /** @type {number} */ (n) : 0);
  const time = (/** @type {unknown} */ n) => (typeof n === 'number' && Number.isFinite(n) && n > 0 ? n : null);
  return {
    root: clip(raw.root, 1000),
    sessionIds: (Array.isArray(raw.sessionIds) ? raw.sessionIds : []).filter((id) => typeof id === 'string').slice(-MAX_PR_SESSIONS),
    number: Number.isInteger(raw.number) && raw.number > 0 ? raw.number : null,
    url: httpsUrl(raw.url),
    state: PR_STATES.has(raw.state) ? raw.state : null,
    review: REVIEWS.has(raw.review) ? raw.review : null,
    branch: clip(oneLine(str(raw.branch)), 200),
    sha: clip(str(raw.sha), 64),
    checks: {
      state: CHECK_STATES.has(checks.state) ? checks.state : 'none',
      total: count(checks.total),
      failing: count(checks.failing),
      pending: count(checks.pending),
      failed: (Array.isArray(checks.failed) ? checks.failed : []).filter((name) => typeof name === 'string').slice(0, MAX_FAILED_NAMES).map((name) => clip(oneLine(name), 80)),
    },
    at: time(raw.at) ?? 0,
    failingSince: time(raw.failingSince),
    watching: raw.watching === true,
  };
}

/** What the checks say, in a few words: "CI failing (2)", "CI running", "CI passed". @param {Checks} checks */
export function checksWords(checks) {
  switch (checks.state) {
    case 'failing':
      return `CI failing (${checks.failing})`;
    case 'pending':
      return 'CI running';
    case 'passing':
      return 'CI passed';
    default:
      return 'No CI checks';
  }
}

/** @param {PrStatus} pr */
function reviewWords(pr) {
  if (pr.state === 'MERGED') return 'merged';
  if (pr.state === 'CLOSED') return 'closed';
  if (pr.review === 'APPROVED') return 'approved';
  if (pr.review === 'CHANGES_REQUESTED') return 'changes requested';
  return '';
}

/**
 * The crew row's badge, in words: "PR #123 · CI failing (2) · changes requested".
 * @param {PrStatus} pr
 * @returns {{ pr: string, checks: string, review: string }}
 */
export function badgeParts(pr) {
  return { pr: pr.number === null ? '' : `PR #${pr.number}`, checks: pr.number === null ? '' : checksWords(pr.checks), review: reviewWords(pr) };
}

/** @param {PrStatus} pr */
export function badgeText(pr) {
  const parts = badgeParts(pr);
  return [parts.pr, parts.checks, parts.review].filter(Boolean).join(' · ');
}

/**
 * The "need you" line for failing CI: "CI failed on feat/login (PR #123): test, lint".
 * @param {PrStatus} pr
 */
export function ciText(pr) {
  const on = pr.branch ? ` on ${pr.branch}` : '';
  const which = pr.number ? ` (PR #${pr.number})` : '';
  const names = pr.checks.failed.length ? `: ${pr.checks.failed.join(', ')}${pr.checks.failing > pr.checks.failed.length ? '…' : ''}` : '';
  return `CI failed${on}${which}${names}`;
}

/**
 * The activity log's line for a change of a pull request's CI, or null when nothing worth a line
 * changed: a pull request found, CI failing, CI passing again, merged or closed.
 * @param {PrStatus|null} previous
 * @param {PrStatus} pr
 * @returns {{ icon: string, text: string, level: 'info'|'success'|'warn' }|null}
 */
export function prLogDraft(previous, pr) {
  if (pr.number === null) return null;
  const was = previous?.number === pr.number ? previous : null;
  const name = `PR #${pr.number}${pr.branch ? ` (${pr.branch})` : ''}`;
  if (pr.state !== 'OPEN' && pr.state !== null && was?.state !== pr.state) return { icon: '🔀', text: `${name} ${pr.state === 'MERGED' ? 'merged' : 'closed'}`, level: 'info' };
  if (pr.checks.state === was?.checks.state && pr.sha === was?.sha) return null;
  if (pr.checks.state === 'failing') return { icon: '❌', text: ciText(pr), level: 'warn' };
  if (pr.checks.state === 'passing' && was) return { icon: '✅', text: `CI passed on ${name}`, level: 'success' };
  return was ? null : { icon: '🔀', text: `${name}: ${checksWords(pr.checks)}`, level: 'info' };
}

/**
 * The pull request a crew pushed last, or null: the newest that names the crew and has a number.
 * @param {readonly PrStatus[]} prs
 * @param {string} sessionId
 * @returns {PrStatus|null}
 */
export function prOfSession(prs, sessionId) {
  let best = null;
  for (const pr of prs) {
    if (pr.number !== null && pr.sessionIds.includes(sessionId) && (!best || pr.at > best.at)) best = pr;
  }
  return best;
}

/** A push that sends something (not `--delete`, `-d` or `:branch`). @param {string[]} words */
const isSendingPush = (words) => gitAction(words) === 'push' && !words.some((word) => word === '--delete' || word === '-d' || word.startsWith(':'));
/** `gh pr create`: a pull request opened for the branch. @param {string[]} words */
const isPrCreate = (words) => words[0] === 'gh' && words[1] === 'pr' && words[2] === 'create';

/**
 * Whether a command ran, as far as the line can tell, and was not known to fail: it is no
 * condition (`if git push`), not on either side of `||` (its failure is allowed there, or it ran
 * only after another failed), unless the line succeeding proves it succeeded. A command whose
 * result the line does not show (`git push 2>&1 | tail -3`, `git push; echo done`) counts.
 * @param {import('./shell.js').Segment[]} segments @param {number} i
 */
function mayHaveRun(segments, i) {
  const segment = segments[i];
  if (segment.succeeded) return true;
  return !segment.condition && segment.separator !== '||' && segments[i - 1]?.separator !== '||';
}

/**
 * Where a git command works: its folder, moved by each leading `-C <dir>` (relative to the one
 * before). Null when a `-C` cannot be followed (`~`, a variable).
 * @param {string[]} words  git's words
 * @param {string} folder
 * @returns {string|null}
 */
export function gitFolder(words, folder) {
  let at = folder;
  for (let i = 1; i < words.length && words[i].startsWith('-'); i += 1) {
    if (words[i] !== '-C') {
      // Git's other options that take the next word (core/shell.js reads them the same way).
      if (GIT_VALUED.has(words[i])) i += 1;
      continue;
    }
    const dir = words[i + 1];
    if (dir === undefined || /^[~$%]/.test(dir)) return null;
    at = joinFolder(at, dir);
    i += 1;
  }
  return at;
}

/** A folder `dir` read from `from`, with forward slashes, `.` and `..` resolved. @param {string} from @param {string} dir */
function joinFolder(from, dir) {
  const target = dir.replace(/\\/g, '/');
  const absolute = /^(?:\/|[A-Za-z]:\/)/.test(target);
  const whole = absolute ? target : `${from.replace(/\\/g, '/').replace(/\/+$/, '')}/${target}`;
  const drive = /^[A-Za-z]:/.exec(whole)?.[0] ?? '';
  /** @type {string[]} */
  const parts = [];
  for (const part of whole.slice(drive.length).split('/')) {
    if (part === '..') parts.pop();
    else if (part && part !== '.') parts.push(part);
  }
  return `${drive}/${parts.join('/')}`;
}

/**
 * The folders where a hook's shell command pushed a branch or opened a pull request (PostToolUse
 * only; a Codex command only when its exit code was found), unless that command is known to have
 * failed or ran only on a condition (mayHaveRun). Each is where that command ran (after `cd`, and
 * git's own `-C`), or the hook's folder.
 * @param {unknown} event  a hook payload
 * @returns {string[]}
 */
export function pushSites(event) {
  if (!isObject(event) || event.hook_event_name !== 'PostToolUse' || !SHELL_TOOLS.has(str(event.tool_name))) return [];
  if (event.andary_source === 'codex' && event.andary_exit_known !== true) return [];
  const input = isObject(event.tool_input) ? event.tool_input : {};
  if (input.run_in_background === true) return [];
  const cwd = str(event.cwd);
  const { segments } = readShell(input.command, { folder: cwd || null, powershell: event.tool_name === 'PowerShell' });
  const sites = new Set();
  segments.forEach((segment, i) => {
    const folder = segment.folder ?? cwd;
    if (!mayHaveRun(segments, i)) return;
    if (isSendingPush(segment.words)) sites.add(folder && gitFolder(segment.words, folder));
    else if (isPrCreate(segment.words)) sites.add(folder);
  });
  return [...sites].filter((site) => typeof site === 'string' && site !== '');
}
