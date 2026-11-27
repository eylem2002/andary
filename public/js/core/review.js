// The review queue (docs/design/usefulness-study.md §4.4): per crew, what its turns did since you
// last marked that crew reviewed, rolled up from the turn receipts the store already keeps
// (core/receipts.js). What deserves a second look comes first: turns that said done without a
// test after the last edit, failed tests, another crew editing the same folder, turns stopped on
// an error, failed calls. It says what to look at and where, with a git command to see the change
// itself; it is not a code review tool. Pure: the HUD keeps the "reviewed" marks (ui/review.js).
//
// A mark is the end of the latest turn the crew had when you marked it, in the receipts' own
// times (the hooks' clock), so it is compared with nothing else.
import { fileLines, runWords } from './receipts.js';

/** @typedef {import('./receipts.js').Receipt} Receipt */
/** @typedef {import('./receipts.js').ReceiptFile} ReceiptFile */
/** @typedef {import('./receipts.js').ReceiptRun} ReceiptRun */
/** @typedef {import('./store.js').StoreState} StoreState */
/** @typedef {import('./store.js').Session} Session */

/** Files listed per crew; the rest are counted. */
export const MAX_REVIEW_FILES = 20;

/**
 * @typedef {object} ReviewFile
 * @property {string} path
 * @property {number} added
 * @property {number|null} removed  null when a file was written whole over something unknown
 * @property {boolean} approx
 * @property {boolean} deleted
 * @property {number} edits
 * @property {string} lines  "+12 −3", in the receipts' words
 */

/**
 * @typedef {object} ReviewCrew  one crew with turns you have not reviewed
 * @property {string} sessionId
 * @property {string} name
 * @property {string} cwd
 * @property {'claude'|'codex'} source
 * @property {string|null} member     a teammate's crew in a team town: its work tree is on their computer
 * @property {number} turns           unreviewed turns
 * @property {number} start           when the first of them started
 * @property {number} end             when the latest ended
 * @property {number|null} reviewedAt  your last mark, null when never marked
 * @property {string[]} warnings      what deserves a second look, most serious first
 * @property {ReviewFile[]} files     most recently changed first, at most MAX_REVIEW_FILES
 * @property {number} moreFiles       files changed beyond those (at least)
 * @property {boolean} shellEdits     a shell command may have changed files no tool named
 * @property {ReceiptRun|null} test   the latest test run
 * @property {ReceiptRun|null} build  the latest build
 * @property {number|null} costUsd    what the turns cost, as far as known (an estimate)
 * @property {boolean} working        the crew is working now: more may come
 * @property {string} diff            a git command that shows the change since then
 * @property {string} status          a git command that lists what is uncommitted and untracked
 */

/**
 * A word for a POSIX shell (bash, zsh, Git Bash): as it is when it holds nothing a shell reads,
 * else in single quotes.
 * @param {string} text
 */
export function shellQuote(text) {
  if (text && /^[\w@%+=:,./-]+$/.test(text)) return text;
  return `'${text.replace(/'/g, `'\\''`)}'`;
}

/** A Windows folder (`C:\…`, `C:/…` or `\\server\share`): its commands are for cmd or PowerShell. @param {string} path */
export const isWindowsPath = (path) => /^[A-Za-z]:[\\/]|^\\\\/.test(path);

/**
 * A word quoted for the shell a folder's commands run in: double quotes on Windows (cmd and
 * PowerShell both read them; a Windows path holds no `"`), else shellQuote.
 * @param {string} text @param {boolean} windows
 */
export function quoteFor(text, windows) {
  if (!windows) return shellQuote(text);
  return /^[\w@%+=:,./\\-]+$/.test(text) && !text.includes('@{') ? text : `"${text.replace(/"/g, '')}"`;
}

/**
 * The git command that shows what changed in a work tree since a time: the commit the work tree
 * was on then (git's reflog, `HEAD@{…}`) against the work tree now. Uncommitted edits made before
 * that time show again, and new files show only once git knows them (`git add -N`). Times are UTC,
 * which git reads whatever the computer's time zone.
 * @param {string} cwd
 * @param {number} since
 */
export function diffCommand(cwd, since) {
  const windows = isWindowsPath(cwd);
  const at = new Date(Math.max(0, Math.floor(since / 1000) * 1000)).toISOString().replace('.000Z', 'Z');
  const where = cwd ? `-C ${quoteFor(cwd, windows)} ` : '';
  return `git ${where}diff ${quoteFor(`HEAD@{${at}}`, windows)}`;
}

/** The git command that lists what is uncommitted and untracked in a work tree. @param {string} cwd */
export function statusCommand(cwd) {
  return `git ${cwd ? `-C ${quoteFor(cwd, isWindowsPath(cwd))} ` : ''}status --short`;
}

/** A crew's name, as the HUD writes it. @param {Session|undefined} session @param {string} sessionId */
function crewName(session, sessionId) {
  return session?.title || session?.project || sessionId;
}

/**
 * Each receipt's files, merged by path: the latest turn's files first.
 * @param {Receipt[]} receipts  oldest first
 */
function mergeFiles(receipts) {
  /** @type {Map<string, ReceiptFile>} */
  const files = new Map();
  let more = 0;
  for (const r of [...receipts].reverse()) {
    more = Math.max(more, r.moreFiles);
    for (const f of r.files) {
      const seen = files.get(f.path);
      if (!seen) {
        files.set(f.path, { ...f });
        continue;
      }
      seen.added += f.added;
      seen.removed = seen.removed === null || f.removed === null ? null : seen.removed + f.removed;
      seen.approx ||= f.approx;
      seen.edits += f.edits;
    }
  }
  const list = [...files.values()].map((f) => ({ ...f, lines: fileLines(f) }));
  return { files: list.slice(0, MAX_REVIEW_FILES), moreFiles: Math.max(0, list.length - MAX_REVIEW_FILES) + more };
}

/** The latest of the receipts' runs of one kind. @param {Receipt[]} receipts @param {'test'|'build'} kind */
function latestRun(receipts, kind) {
  /** @type {ReceiptRun|null} */
  let latest = null;
  for (const r of receipts) {
    const run = r[kind];
    if (run && (!latest || run.at >= latest.at)) latest = run;
  }
  return latest;
}

/** "Said done, but … (2 turns)". @param {string} text @param {number} n */
const times = (text, n) => (n > 1 ? `${text} (${n} turns)` : text);

/**
 * What deserves a second look across the turns, most serious first, each said once.
 * @param {Receipt[]} receipts
 * @param {ReceiptRun|null} test  the latest test run
 */
export function reviewWarnings(receipts, test) {
  /** @type {Map<string, number>} */
  const flags = new Map();
  let others = 0;
  let errors = 0;
  let interrupted = 0;
  let failures = 0;
  for (const r of receipts) {
    if (r.flag) flags.set(r.flag, (flags.get(r.flag) ?? 0) + 1);
    if (r.othersEdited) others += 1;
    if (r.ended === 'error') errors += 1;
    if (r.ended === 'interrupted') interrupted += 1;
    failures += r.failures;
  }
  /** @type {string[]} */
  const warnings = [];
  if (test?.result === 'failed') warnings.push(`The latest test run failed: ${runWords(test)}`);
  for (const [flag, n] of flags) warnings.push(times(flag, n));
  if (others) warnings.push(times('Another crew edited files in this folder', others));
  if (errors) warnings.push(errors === 1 ? 'A turn stopped on an error' : `${errors} turns stopped on an error`);
  if (interrupted) warnings.push(interrupted === 1 ? 'A turn was interrupted' : `${interrupted} turns were interrupted`);
  if (failures) warnings.push(`${failures} failed call${failures === 1 ? '' : 's'}`);
  return warnings;
}

/**
 * One crew's unreviewed turns, rolled up.
 * @param {Session|undefined} session @param {string} sessionId @param {Receipt[]} receipts  oldest first, at least one
 * @param {number|null} reviewedAt
 * @returns {ReviewCrew}
 */
function rollUp(session, sessionId, receipts, reviewedAt) {
  const test = latestRun(receipts, 'test');
  const costs = receipts.map((r) => r.costUsd).filter((c) => c !== null);
  const start = Math.min(...receipts.map((r) => r.start));
  const cwd = session?.cwd ?? '';
  return {
    sessionId,
    name: crewName(session, sessionId),
    cwd,
    source: session?.source ?? receipts[0].source,
    member: session?.member ?? null,
    turns: receipts.length,
    start,
    end: Math.max(...receipts.map((r) => r.end)),
    reviewedAt,
    warnings: reviewWarnings(receipts, test),
    ...mergeFiles(receipts),
    shellEdits: receipts.some((r) => r.shellEdits > 0),
    test,
    build: latestRun(receipts, 'build'),
    costUsd: costs.length ? costs.reduce((a, b) => a + /** @type {number} */ (b), 0) : null,
    working: session?.status === 'working',
    diff: diffCommand(cwd, reviewedAt ?? start),
    status: statusCommand(cwd),
  };
}

/**
 * Every crew with turns that ended after your last mark: crews with warnings first, then the most
 * recently finished.
 * @param {Pick<StoreState, 'sessions'|'receipts'>} state
 * @param {Readonly<Record<string, number>>} reviewed  sessionId → your mark
 * @returns {ReviewCrew[]}
 */
export function reviewQueue(state, reviewed) {
  const sessions = new Map(state.sessions.map((s) => [s.id, s]));
  /** @type {Map<string, Receipt[]>} */
  const bySession = new Map();
  for (const r of state.receipts) {
    const mark = Object.hasOwn(reviewed, r.sessionId) ? reviewed[r.sessionId] : null;
    if (mark !== null && r.end <= mark) continue;
    const list = bySession.get(r.sessionId) ?? [];
    list.push(r);
    bySession.set(r.sessionId, list);
  }
  const crews = [...bySession].map(([sessionId, receipts]) => rollUp(sessions.get(sessionId), sessionId, receipts, Object.hasOwn(reviewed, sessionId) ? reviewed[sessionId] : null));
  return crews.sort((a, b) => Number(b.warnings.length > 0) - Number(a.warnings.length > 0) || b.end - a.end);
}

/**
 * The mark for a crew now: the end of its latest turn (null when it has none).
 * @param {Pick<StoreState, 'receipts'>} state @param {string} sessionId
 */
export function reviewMark(state, sessionId) {
  let mark = null;
  for (const r of state.receipts) if (r.sessionId === sessionId && (mark === null || r.end > mark)) mark = r.end;
  return mark;
}
