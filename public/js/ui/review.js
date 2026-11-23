// The review queue (core/review.js): a dialog with one card per crew whose finished turns you have
// not reviewed, warnings first; the files they changed (each opens its diff when the town has
// it), the latest test and build, a git command to copy that shows the change, and "Mark
// reviewed". Opened with R or the toolbar's Review button, which carries how many crews wait.
// It says what to look at and where; it is no code editor.
//
// Your marks are kept in this browser (localStorage, per town, shared by its tabs); the demo's
// story has its own clock, so its marks last as long as the page.
import { createDialog } from './dialogs.js';
import { h, setHidden, setText } from './dom.js';
import { formatAgo, plural } from './format.js';
import { icon } from './icons.js';
import { roundel } from './parts.js';
import { copyButton, copyText } from './copy.js';
import { costWords, runWords } from '../core/receipts.js';
import { reviewMark, reviewQueue } from '../core/review.js';

/** @typedef {import('./types.js').HudContext} HudContext */
/** @typedef {import('./types.js').StoreState} StoreState */
/** @typedef {import('../core/review.js').ReviewCrew} ReviewCrew */

export const REVIEWED_KEY = 'andary:reviewed';
/** Marks kept; past this the oldest go (a crew gone that long has nothing left to review). */
const MAX_MARKS = 300;

/** @returns {Pick<Storage, 'getItem'|'setItem'>|null} */
function safeStorage() {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

/**
 * Marks read defensively: what another version (or a hand) left there may be any shape.
 * @param {string|null} raw
 * @returns {Record<string, number>}
 */
export function readMarks(raw) {
  try {
    const value = JSON.parse(raw ?? '{}');
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    /** @type {Record<string, number>} */
    const marks = {};
    for (const [id, at] of Object.entries(value)) if (typeof at === 'number' && Number.isFinite(at) && at > 0) marks[id] = at;
    return marks;
  } catch {
    return {};
  }
}

/**
 * Adds a mark, keeping the newest MAX_MARKS.
 * @param {Readonly<Record<string, number>>} marks @param {string} sessionId @param {number} at
 */
export function withMark(marks, sessionId, at) {
  const next = Object.entries({ ...marks, [sessionId]: at }).sort((a, b) => b[1] - a[1]).slice(0, MAX_MARKS);
  return Object.fromEntries(next);
}

/**
 * Your marks, per mode: the live town's kept in this browser and shared with its other tabs, the
 * demo's for this page only.
 * @param {Pick<Storage, 'getItem'|'setItem'>|null} storage
 * @param {() => void} onChange  another tab marked a crew
 */
function createMarks(storage, onChange) {
  const read = () => {
    try {
      return readMarks(storage?.getItem(REVIEWED_KEY) ?? null);
    } catch {
      return {};
    }
  };
  const marks = { live: read(), demo: /** @type {Record<string, number>} */ ({}) };
  globalThis.addEventListener?.('storage', (event) => {
    if (event.key !== REVIEWED_KEY) return;
    marks.live = read();
    onChange();
  });
  return {
    /** @param {boolean} live */
    get: (live) => (live ? marks.live : marks.demo),
    /** @param {boolean} live @param {string} sessionId @param {number} at */
    set(live, sessionId, at) {
      if (!live) {
        marks.demo = withMark(marks.demo, sessionId, at);
        return;
      }
      marks.live = withMark(marks.live, sessionId, at);
      try {
        storage?.setItem(REVIEWED_KEY, JSON.stringify(marks.live));
      } catch {
        // Not kept (storage full or disabled): remembered until the page reloads.
      }
    },
  };
}

/** "3 turns since you marked it reviewed 2h ago", "1 turn, 5m ago". @param {ReviewCrew} crew @param {number} now */
export function crewPeriod(crew, now) {
  const turns = plural(crew.turns, 'turn');
  if (crew.reviewedAt !== null) return `${turns} since you marked it reviewed ${formatAgo(crew.reviewedAt, now)}`;
  return `${turns}, the first ${formatAgo(crew.start, now)}; never marked reviewed`;
}

/**
 * The newest change to a path by any of the crew's agents, for its diff.
 * @param {StoreState} state @param {string} sessionId @param {string} path
 * @returns {{ agentKey: string, changeId: string }|null}
 */
function changeFor(state, sessionId, path) {
  let best = null;
  for (const agent of Object.values(state.agents)) {
    if (agent.sessionId !== sessionId) continue;
    for (const change of agent.changes ?? []) if (change.path === path && (!best || change.ts > best.ts)) best = { agentKey: agent.key, changeId: change.id, ts: change.ts };
  }
  return best && { agentKey: best.agentKey, changeId: best.changeId };
}

/**
 * The latest test and build, and the cost, as labelled lines; a crew that changed files without a
 * test says so.
 * @param {ReviewCrew} crew
 */
function runRows(crew) {
  /** @param {string} label @param {import('../core/receipts.js').ReceiptRun} run */
  const runRow = (label, run) => h('div', { class: 'hud-receipt__row', 'data-tone': run.result === 'passed' ? 'ok' : run.result === 'failed' ? 'error' : 'warn' },
    h('dt', { text: label }), h('dd', { class: 'hud-mono', text: runWords(run) }));
  const rows = [
    crew.test ? runRow('Last test', crew.test) : h('div', { class: 'hud-receipt__row', 'data-tone': crew.files.length ? 'warn' : null }, h('dt', { text: 'Tests' }), h('dd', { text: 'No test run in these turns' })),
    crew.build ? runRow('Last build', crew.build) : null,
    crew.costUsd !== null ? h('div', { class: 'hud-receipt__row' }, h('dt', { text: 'Cost' }), h('dd', { text: costWords(crew.costUsd) })) : null,
  ];
  return h('dl', { class: 'hud-receipt hud-review__runs' }, ...rows);
}

/**
 * The changed files, each opening its diff when the town has it, and what is not listed.
 * @param {HudContext} ctx @param {StoreState} state @param {ReviewCrew} crew
 */
function fileList(ctx, state, crew) {
  const files = crew.files.map((file) => {
    const change = changeFor(state, crew.sessionId, file.path);
    const parts = [h('span', { class: 'hud-change__path hud-mono', text: file.path }), h('span', { class: 'hud-change__stat', text: file.lines })];
    if (!change) return h('li', {}, h('span', { class: 'hud-change hud-review__file', title: file.path }, ...parts));
    return h('li', {}, h('button', { type: 'button', class: 'hud-change', title: file.path, 'aria-label': `Show changes to ${file.path}, ${file.lines}`, on: { click: () => ctx.showDiff(change.agentKey, change.changeId) } }, ...parts));
  });
  const more = [crew.moreFiles ? `and ${plural(crew.moreFiles, 'more file')}` : '', crew.shellEdits ? 'files may also have changed through the shell' : ''].filter(Boolean).join('; ');
  const words = !files.length && !crew.shellEdits ? 'No files changed in these turns.' : more ? `…${more}.` : '';
  return [files.length ? h('ul', { class: 'hud-changes hud-review__files' }, ...files) : null, words ? h('p', { class: 'hud-review__more', text: words }) : null];
}

/**
 * The git command that shows the change, to copy.
 * @param {HudContext} ctx @param {ReviewCrew} crew
 */
function diffBlock(ctx, crew) {
  const code = h('code', { class: 'hud-mono hud-steps__code', 'data-testid': 'review-diff', text: crew.diff });
  const copy = copyButton('Copy', { 'data-testid': 'review-copy-diff', 'aria-label': `Copy the git command for ${crew.name}` });
  copy.addEventListener('click', () => copyText(ctx, { text: crew.diff, button: copy, shown: code, spoken: `Copied ${crew.diff}` }));
  const words = crew.member
    ? `This crew's work tree is on ${crew.member}'s computer: they can run it there.`
    : 'Shows what changed in its work tree since then, committed or not (git\'s reflog of where the work tree was).';
  return [h('div', { class: 'hud-steps__command' }, code, copy), h('p', { class: 'hud-steps__note', text: words })];
}

/**
 * One crew's card.
 * @param {HudContext} ctx
 * @param {ReviewCrew} crew
 * @param {{ state: StoreState, now: number, onMark: (crew: ReviewCrew) => void, onOpen: (agentKey: string) => void }} options
 */
function crewCard(ctx, crew, { state, now, onMark, onOpen }) {
  const session = state.sessions.find((s) => s.id === crew.sessionId);
  const here = Boolean(session && session.status !== 'ended');
  const warnings = crew.warnings.length
    ? h('ul', { class: 'hud-review__warnings', 'data-testid': 'review-warnings' }, ...crew.warnings.map((text) => h('li', {}, icon('warning', { size: 16 }), h('span', { text }))))
    : h('p', { class: 'hud-review__ok', text: 'No warnings in these turns.' });
  const mark = h('button', { type: 'button', class: 'hud-btn hud-btn--primary hud-btn--small', 'data-testid': 'review-mark', on: { click: () => onMark(crew) } }, icon('check', { size: 16 }), h('span', { text: 'Mark reviewed' }));
  const lead = here ? session?.agentKeys.find((key) => state.agents[key]?.role === 'lead') : undefined;
  const openCrew = lead ? h('button', { type: 'button', class: 'hud-btn hud-btn--small', 'data-testid': 'review-open', on: { click: () => onOpen(lead) } }, 'Open its details') : null;
  const period = `${crewPeriod(crew, now)}${crew.working ? '. Working now: more may come' : ''}`;
  return h('li', { class: 'hud-review__crew', 'data-testid': 'review-crew', 'data-session-id': crew.sessionId, 'data-warn': crew.warnings.length ? 'true' : null },
    h('div', { class: 'hud-review__head' }, roundel(here ? session?.number ?? 0 : 0, session?.color),
      h('div', {}, h('h3', { class: 'hud-review__name', text: crew.name }), h('p', { class: 'hud-review__period', 'data-testid': 'review-period', text: period }))),
    warnings,
    runRows(crew),
    ...fileList(ctx, state, crew),
    ...diffBlock(ctx, crew),
    h('div', { class: 'hud-review__actions' }, mark, openCrew));
}

/**
 * The dialog and the count on the toolbar's button.
 * @param {HudContext} ctx
 * @param {{ storage?: Pick<Storage, 'getItem'|'setItem'>|null, now?: () => number }} [options]
 */
export function createReview(ctx, { storage = safeStorage(), now = Date.now } = {}) {
  const live = () => ctx.view.mode === 'live';
  const marks = createMarks(storage, () => ctx.refresh());
  const lead = h('p', { class: 'hud-dialog__lead', text: 'Each crew\'s finished turns since you last marked it reviewed: what deserves a second look first, then the files, the tests and a git command that shows the change.' });
  const list = h('ul', { class: 'hud-review__crews' });
  const empty = h('p', { class: 'hud-catchup__note', 'data-testid': 'review-empty', hidden: true });
  const note = h('p', { class: 'hud-dialog__note', text: 'Marks are kept in this browser. The town remembers the latest 60 turns across your crews.' });
  const dialog = createDialog({ id: 'hud-review', title: 'Review', scrollable: true, wide: true, body: [lead, list, empty, note] });
  const body = /** @type {HTMLElement} */ (dialog.el.querySelector('.hud-dialog__body'));
  dialog.el.setAttribute('data-testid', 'review');
  let drawn = '';

  /** @param {StoreState} state */
  const queue = (state) => reviewQueue(state, marks.get(live()));

  /** @param {ReviewCrew} crew */
  function markReviewed(crew) {
    const state = ctx.store.getState();
    const at = reviewMark(state, crew.sessionId);
    if (at === null) return;
    const cards = [...list.children];
    const index = cards.findIndex((card) => card.getAttribute('data-session-id') === crew.sessionId);
    marks.set(live(), crew.sessionId, at);
    ctx.announcer.polite(`Marked ${crew.name} reviewed.`);
    render();
    // Focus goes on to the next crew's button, or the dialog's body when none is left.
    const next = /** @type {HTMLElement|undefined} */ (list.children[Math.min(index, list.children.length - 1)]?.querySelector('[data-testid="review-mark"]'));
    (next ?? body).focus();
    ctx.refresh();
  }

  /** Closes the dialog, then opens the crew lead's details (focus goes back to the opener as it closes). @param {string} agentKey */
  function onOpen(agentKey) {
    dialog.el.addEventListener('close', () => ctx.select({ type: 'agent', id: agentKey }, { camera: true, focus: true }), { once: true });
    dialog.close();
  }

  function render() {
    if (!dialog.isOpen) return;
    const state = ctx.store.getState();
    const crews = queue(state);
    const at = now();
    // Times are shown to the minute: the cards are drawn again when anything they show changes.
    const key = JSON.stringify([crews.map((c) => [c.sessionId, c.turns, c.end, c.warnings, c.files.length, c.working, c.name, Math.floor((at - c.start) / 60_000)]), state.receipts.length]);
    if (key === drawn) return;
    drawn = key;
    const focused = document.activeElement instanceof HTMLElement && list.contains(document.activeElement)
      ? { id: document.activeElement.closest('.hud-review__crew')?.getAttribute('data-session-id'), test: document.activeElement.getAttribute('data-testid') }
      : null;
    list.replaceChildren(...crews.map((crew) => crewCard(ctx, crew, { state, now: at, onMark: markReviewed, onOpen })));
    if (focused?.id && focused.test) (/** @type {HTMLElement|null} */ (list.querySelector(`[data-session-id="${CSS.escape(focused.id)}"] [data-testid="${focused.test}"]`)) ?? body).focus();
    const none = state.receipts.length ? 'Nothing to review: every crew\'s finished turns are marked reviewed.' : 'Nothing to review yet: a crew\'s turn shows here once it ends.';
    setText(empty, none);
    setHidden(empty, crews.length > 0);
  }

  return {
    el: dialog.el,
    close: dialog.close,
    get isOpen() {
      return dialog.isOpen;
    },
    open() {
      drawn = '';
      dialog.open();
      render();
    },
    render,
    /** Crews with turns you have not reviewed, for the toolbar's badge. @param {StoreState} state */
    count: (state) => queue(state).length,
  };
}
