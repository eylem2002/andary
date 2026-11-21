// "Catch me up" (docs/design/agent-health.md §7): what your crews did since you last looked. The
// server decides when you were away and keeps the counts (server/digest.mjs; the demo plays its
// part); this module asks for them through the source, offers the dialog in the masthead's "need
// you" area when you come back, and shows one line per crew: crews that need you first, each
// linking to its item as the "need you" button does, then the crews that did something, then the
// quiet ones in one line.
//
// "Since you last looked" is kept in this browser (localStorage, per town): the end of the last
// summary you saw, in the server's time, so the two clocks never need to agree. You saw what
// happened before you left, so a time you were away starts the period too, whichever is later.
// The first look ever covers everything the town remembers (a day at most).
import { createDialog } from './dialogs.js';
import { h, setHidden, setText } from './dom.js';
import { formatAgo, listJoin, plural } from './format.js';
import { icon } from './icons.js';
import { roundel } from './parts.js';
import { projectName } from '../core/store-model.js';
import { stopWords } from '../core/waits.js';

/** @typedef {import('./types.js').HudContext} HudContext */
/** @typedef {import('./types.js').StoreState} StoreState */
/** @typedef {import('./types.js').Session} Session */
/** @typedef {import('../core/digest.js').Digest} Digest */
/** @typedef {import('../core/digest.js').CrewDigest} CrewDigest */
/** @typedef {import('../core/attention.js').AttentionItem} AttentionItem */
/** @typedef {{ since: number, until: number|null }} Away  the latest time you were away (server/digest.mjs) */
/** @typedef {'looked'|'left'|'all'} Reason  where a period starts: when you last looked, when you left, or as far back as the town remembers */

export const CAUGHT_UP_KEY = 'andary:caught-up';
/** After you come back, the masthead offers to catch you up for this long, or until you look. */
export const OFFER_MS = 30 * 60_000;
/** A summary that has not come by then will not: the dialog says so. */
const ANSWER_MS = 5000;
/** The numbers a crew's summary carries (core/digest.js CrewDigest). */
const COUNTS = Object.freeze(['turns', 'failures', 'commits', 'pushes', 'files', 'asked', 'answered', 'helpersStarted', 'helpersFinished', 'toolCalls']);

/**
 * Where a catch-up starts: when you last looked or when you left, whichever is later (you saw what
 * happened before you left); the first time ever, as far back as the town remembers.
 * @param {number|null} lastLooked
 * @param {Away|null} away
 * @returns {{ since: number, reason: Reason }}
 */
export function catchUpStart(lastLooked, away) {
  const left = away?.since ?? null;
  if (lastLooked !== null && (left === null || lastLooked >= left)) return { since: lastLooked, reason: 'looked' };
  if (left !== null) return { since: left, reason: 'left' };
  return { since: 0, reason: 'all' };
}

/**
 * Whether the masthead offers "Catch me up": you are away, or came back less than OFFER_MS ago,
 * and have not looked since you left.
 * @param {Away|null} away @param {number|null} lastLooked @param {number} now
 */
export function catchUpOffered(away, lastLooked, now) {
  if (!away || (lastLooked !== null && lastLooked >= away.since)) return false;
  return away.until === null || now - away.until < OFFER_MS;
}

/**
 * "3 permission requests (1 answered)", "2 helpers (all finished)", "1 helper finished" (one
 * started before the period).
 * @param {number} n @param {number} done @param {string} noun @param {string} doneWord
 */
function countAndDone(n, done, noun, doneWord) {
  if (!n) return done ? `${plural(done, noun)} ${doneWord}` : '';
  if (done >= n) return `${plural(n, noun)} (${n === 1 ? doneWord : `all ${doneWord}`})`;
  if (!done) return `${plural(n, noun)} (${n === 1 ? 'not' : 'none'} ${doneWord})`;
  return `${plural(n, noun)} (${done} ${doneWord})`;
}

/** "stopped (rate limited)", "stopped 3 times (rate limited and server error)". @param {Record<string, number>} stops */
function stopText(stops) {
  const kinds = Object.entries(stops).filter(([, n]) => n > 0);
  const total = kinds.reduce((sum, [, n]) => sum + n, 0);
  if (!total) return '';
  const why = listJoin(kinds.map(([kind]) => stopWords(kind)));
  return total === 1 ? `stopped (${why})` : `stopped ${total} times (${why})`;
}

/** "1 commit pushed", "2 commits, 1 push" (the latest commit is not pushed), "pushed". @param {CrewDigest} crew */
function shippedText({ commits, pushes, allPushed }) {
  if (commits && pushes) return allPushed ? `${plural(commits, 'commit')} pushed` : `${plural(commits, 'commit')}, ${plural(pushes, 'push', 'pushes')}`;
  if (commits) return plural(commits, 'commit');
  if (pushes) return pushes === 1 ? 'pushed' : `pushed ${pushes} times`;
  return '';
}

/** @param {CrewDigest['tests']} tests */
function testText(tests) {
  if (tests === 'passed') return 'tests passing';
  return tests === 'failed' ? 'tests failing' : '';
}

/**
 * What a crew did, in a few words: "3 turns, tests passing, 1 commit pushed, 2 files changed". A
 * crew that only used tools says how many.
 * @param {CrewDigest} crew
 */
export function crewWords(crew) {
  const parts = [
    crew.turns ? plural(crew.turns, 'turn') : '',
    stopText(crew.stops),
    testText(crew.tests),
    shippedText(crew),
    crew.files ? `${plural(crew.files, 'file')} changed` : '',
    crew.failures ? plural(crew.failures, 'failed tool call') : '',
    countAndDone(crew.asked, crew.answered, 'permission request', 'answered'),
    countAndDone(crew.helpersStarted, crew.helpersFinished, 'helper', 'finished'),
  ].filter(Boolean);
  if (!parts.length && crew.toolCalls) parts.push(plural(crew.toolCalls, 'tool call'));
  return parts.join(', ');
}

/**
 * The period a catch-up covers, in words: "Since you last looked, 25m ago.".
 * @param {Reason} reason @param {number} since @param {number} until
 */
export function periodText(reason, since, until) {
  if (reason === 'all') return 'Everything the town remembers, up to a day back.';
  const ago = formatAgo(since, until);
  return `${reason === 'left' ? 'Since you left' : 'Since you last looked'}, ${ago === 'just now' ? 'a moment ago' : ago}.`;
}

/** @param {unknown} value */
const count = (value) => (typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0);
/** @param {unknown} value */
const text = (value) => (typeof value === 'string' && value ? value : null);

/**
 * One crew's summary from the network, read defensively.
 * @param {any} raw
 * @returns {CrewDigest}
 */
function readCrew(raw) {
  const numbers = Object.fromEntries(COUNTS.map((name) => [name, count(raw[name])]));
  const stops = Object.entries(raw.stops && typeof raw.stops === 'object' ? raw.stops : {}).map(([kind, n]) => [kind, count(n)]);
  return /** @type {CrewDigest} */ ({
    ...numbers,
    sessionId: String(raw.sessionId),
    cwd: text(raw.cwd) ?? '',
    title: text(raw.title),
    lastAt: count(raw.lastAt),
    lastMessage: text(raw.lastMessage),
    stops: Object.fromEntries(stops),
    tests: raw.tests === 'passed' || raw.tests === 'failed' ? raw.tests : null,
    allPushed: raw.allPushed === true,
  });
}

/**
 * A summary from the network (`{ t: 'digest', d }`), or null when it is not one.
 * @param {unknown} raw
 * @returns {Digest|null}
 */
export function readDigest(raw) {
  const value = /** @type {any} */ (raw);
  if (!value || !Number.isFinite(value.since) || !Number.isFinite(value.until) || !Array.isArray(value.crews)) return null;
  const crews = value.crews.filter((/** @type {any} */ crew) => crew && typeof crew === 'object' && typeof crew.sessionId === 'string');
  return { since: value.since, until: value.until, crews: crews.map(readCrew) };
}

/**
 * The latest time you were away, from the server, or null.
 * @param {unknown} raw
 * @returns {Away|null}
 */
export function readAway(raw) {
  const value = /** @type {any} */ (raw);
  if (!value || !Number.isFinite(value.since)) return null;
  return { since: value.since, until: Number.isFinite(value.until) ? value.until : null };
}

/**
 * @typedef {object} CatchUpRow  one crew's line
 * @property {string} sessionId
 * @property {string} name
 * @property {string} words      what it did; '' when nothing since then
 * @property {string|null} said  its latest finished turn's last message
 * @property {AttentionItem|null} item  what it needs you for, if anything
 * @property {number} number     its roundel's number; 0 once it has left town
 * @property {string} [color]
 */

/** A crew's name, as the rest of the HUD writes it. @param {Session} session */
const sessionName = (session) => session.title || session.project;

/**
 * Each crew's most urgent counted item, for its own agent (one stop by a shared rate limit stands
 * for several crews: each links to its own agent).
 * @param {StoreState} state @param {AttentionItem[]} items  most urgent first
 * @returns {Map<string, AttentionItem>}
 */
function needsBySession(state, items) {
  /** @type {Map<string, AttentionItem>} */
  const needs = new Map();
  for (const item of items) {
    if (!item.counted) continue;
    for (const agentKey of item.agentKeys) {
      const sessionId = state.agents[agentKey]?.sessionId ?? item.sessionId;
      if (!needs.has(sessionId)) needs.set(sessionId, { ...item, sessionId, agentKey });
    }
  }
  return needs;
}

/**
 * The dialog's lines: crews that need you first (the most urgent first), then crews that did
 * something (the most recently active first; one that has left town too), and the names of your
 * quiet crews. Teammates' crews are theirs: the server counts none, and none is called quiet.
 * @param {StoreState} state
 * @param {Digest} digest
 * @param {AttentionItem[]} items  what needs you, without what you set aside (ui/needs-you.js)
 * @returns {{ rows: CatchUpRow[], quiet: string[] }}
 */
export function catchUpRows(state, digest, items) {
  const sessions = new Map(state.sessions.map((s) => [s.id, s]));
  const crews = new Map(digest.crews.map((crew) => [crew.sessionId, crew]));
  const needs = needsBySession(state, items);
  /** @param {string} sessionId @param {AttentionItem|null} item @returns {CatchUpRow} */
  const row = (sessionId, item) => {
    const session = sessions.get(sessionId);
    const crew = crews.get(sessionId);
    const name = session ? sessionName(session) : crew ? crew.title || projectName(crew.cwd, sessionId) : sessionId;
    const here = session && session.status !== 'ended';
    return { sessionId, name, words: crew ? crewWords(crew) : '', said: crew?.lastMessage ?? null, item, number: here ? session.number : 0, color: session?.color };
  };
  const rows = [...needs].map(([sessionId, item]) => row(sessionId, item));
  for (const crew of digest.crews) if (!needs.has(crew.sessionId)) rows.push(row(crew.sessionId, null));
  const quiet = state.sessions.filter((s) => s.status !== 'ended' && !s.member && !needs.has(s.id) && !crews.has(s.id)).map(sessionName);
  return { rows, quiet };
}

/** @returns {Pick<Storage, 'getItem'|'setItem'>|null} */
function safeStorage() {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

/**
 * When you last looked, per mode: the live town's is kept in this browser and shared with its
 * other tabs; the demo's story has its own clock and nobody to catch up, so its is not kept.
 * @param {Pick<Storage, 'getItem'|'setItem'>|null} storage
 * @param {() => void} onChange  another tab of this town caught up
 */
function createLooked(storage, onChange) {
  const read = () => {
    try {
      const value = Number(storage?.getItem(CAUGHT_UP_KEY) ?? Number.NaN);
      return Number.isFinite(value) && value > 0 ? value : null;
    } catch {
      return null;
    }
  };
  const looked = { live: read(), demo: /** @type {number|null} */ (null) };
  globalThis.addEventListener?.('storage', (event) => {
    if (event.key !== CAUGHT_UP_KEY) return;
    looked.live = read();
    onChange();
  });
  return {
    /** @param {boolean} live */
    get: (live) => (live ? looked.live : looked.demo),
    /** You have seen what happened until then (the server's time); never earlier than before. @param {boolean} live @param {number} until */
    set(live, until) {
      if (!live) {
        looked.demo = until;
        return;
      }
      looked.live = Math.max(looked.live ?? 0, until);
      try {
        storage?.setItem(CAUGHT_UP_KEY, String(looked.live));
      } catch {
        // storage full or disabled: remembered until the page reloads
      }
    },
  };
}

/**
 * One crew's line: its name and what it did, the button to what it needs you for, and what its
 * latest turn said.
 * @param {CatchUpRow} row
 * @param {(item: AttentionItem) => void} onGo
 */
function rowElement(row, onGo) {
  const { item } = row;
  const line = h('p', { class: 'hud-catchup__line' }, h('strong', { text: row.name }), `: ${row.words || 'nothing new'}`);
  const need = item
    ? h('button', { type: 'button', class: 'hud-btn hud-btn--small hud-catchup__need', 'data-level': item.level, 'data-testid': 'catch-up-need', on: { click: () => onGo(item) } },
      icon('hourglass', { size: 16 }), h('span', { text: item.text }), h('span', { class: 'hud-sr', text: ', go there' }))
    : null;
  const said = row.said ? h('p', { class: 'hud-catchup__said', text: `Last turn: ${row.said}` }) : null;
  return h('li', { class: 'hud-catchup__crew', 'data-testid': 'catch-up-crew', 'data-session-id': row.sessionId },
    roundel(row.number, row.color), h('div', { class: 'hud-catchup__what' }, line, need, said));
}

/**
 * The dialog's crew lines, its "nothing happened" note and the quiet line. They are drawn again
 * only when they change (the HUD renders on every event), and the crew whose button had focus
 * keeps it.
 * @param {(item: AttentionItem) => void} onGo
 */
function createLines(onGo) {
  const list = h('ul', { class: 'hud-catchup__crews' });
  const empty = h('p', { class: 'hud-catchup__note', text: 'No crew did anything in that time.', hidden: true });
  const quiet = h('p', { class: 'hud-catchup__note', 'data-testid': 'catch-up-quiet', hidden: true });
  let drawn = '';
  return {
    els: [list, empty, quiet],
    clear() {
      list.replaceChildren();
      drawn = '';
      setHidden(empty, true);
      setHidden(quiet, true);
    },
    /**
     * @param {{ rows: CatchUpRow[], quiet: string[] }} lines
     * @param {HTMLElement|null} fallback  takes focus when the focused crew no longer needs you
     */
    draw({ rows, quiet: names }, fallback) {
      const key = JSON.stringify([rows.map((r) => [r.sessionId, r.name, r.words, r.said, r.item?.id, r.number]), names]);
      if (key === drawn) return;
      drawn = key;
      const active = document.activeElement;
      const focusedId = active instanceof HTMLElement && list.contains(active) ? active.closest('.hud-catchup__crew')?.getAttribute('data-session-id') : null;
      list.replaceChildren(...rows.map((row) => rowElement(row, onGo)));
      if (focusedId) (/** @type {HTMLElement|null} */ (list.querySelector(`[data-session-id="${CSS.escape(focusedId)}"] button`)) ?? fallback)?.focus();
      setHidden(empty, rows.length > 0);
      setText(quiet, names.length ? `Quiet: ${listJoin(names)}.` : '');
      setHidden(quiet, names.length === 0);
    },
  };
}

/**
 * The dialog, the masthead's offer and what the town said about your absences.
 * @param {HudContext} ctx
 * @param {{ storage?: Pick<Storage, 'getItem'|'setItem'>|null, now?: () => number }} [options]
 */
export function createCatchUp(ctx, { storage = safeStorage(), now = Date.now } = {}) {
  /** @type {Away|null} */
  let away = null;
  /** The period asked for, until its summary comes. @type {{ since: number, reason: Reason }|null} */
  let asked = null;
  /** The summary on show, with the period it was asked for. @type {{ digest: Digest, since: number, reason: Reason }|null} */
  let shown = null;
  /** @type {ReturnType<typeof setTimeout>|undefined} */
  let answerTimer;
  /** @type {ReturnType<typeof setTimeout>|undefined} */
  let offerTimer;

  const live = () => ctx.view.mode === 'live';
  const viewOnly = () => ctx.view.serverSettings.team?.role === 'viewer';
  const looked = createLooked(storage, () => ctx.refresh());

  const period = h('p', { class: 'hud-dialog__lead', 'data-testid': 'catch-up-period' });
  const lines = createLines((item) => {
    // The dialog gives focus back to what opened it as it closes: go there after that.
    dialog.el.addEventListener('close', () => ctx.goToNeed(item), { once: true });
    dialog.close();
  });
  const content = h('div', { class: 'hud-catchup' }, period, ...lines.els);
  const dialog = createDialog({ id: 'hud-catchup', title: 'Catch me up', scrollable: true, body: [content] });
  const body = /** @type {HTMLElement|null} */ (dialog.el.querySelector('.hud-dialog__body'));
  dialog.el.setAttribute('data-testid', 'catch-up');
  dialog.el.addEventListener('close', () => {
    clearTimeout(answerTimer);
    asked = null;
  });

  /** @param {string} words */
  function showProblem(words) {
    clearTimeout(answerTimer);
    asked = null;
    content.removeAttribute('aria-busy');
    setText(period, words);
  }

  function render() {
    if (!dialog.isOpen || !shown) return;
    const state = ctx.store.getState();
    setText(period, periodText(shown.reason, shown.since, shown.digest.until));
    lines.draw(catchUpRows(state, shown.digest, ctx.needsYou.items(state)), body);
    content.removeAttribute('aria-busy');
  }

  /** The offer ends OFFER_MS after you came back, with no event to redraw the masthead then. */
  function scheduleOfferEnd() {
    clearTimeout(offerTimer);
    if (away?.until == null) return;
    const left = away.until + OFFER_MS - now();
    if (left > 0) offerTimer = setTimeout(() => ctx.refresh(), left + 1000);
  }

  return {
    el: dialog.el,
    close: dialog.close,
    get isOpen() {
      return dialog.isOpen;
    },
    render,
    /** Opens the dialog and asks the town what happened since you last looked. */
    open() {
      const start = catchUpStart(looked.get(live()), live() ? away : null);
      asked = start;
      shown = null;
      content.setAttribute('aria-busy', 'true');
      setText(period, 'Counting what your crews did…');
      lines.clear();
      dialog.open();
      if (live() && viewOnly()) showProblem('Only the person who hosts this town can catch up on its crews.');
      else if (!ctx.controls.requestDigest(start.since)) showProblem('The town is not connected right now. Try again once it says Live.');
      else {
        clearTimeout(answerTimer);
        answerTimer = setTimeout(() => showProblem('The town did not answer. Try again in a moment.'), ANSWER_MS);
      }
    },
    /** The town's answer: shown if the dialog still waits for it, and then you have seen it. @param {unknown} raw */
    showDigest(raw) {
      const digest = readDigest(raw);
      if (!digest || !asked || !dialog.isOpen) return;
      clearTimeout(answerTimer);
      shown = { digest, ...asked };
      asked = null;
      render();
      looked.set(live(), digest.until);
      ctx.refresh();
    },
    /** The latest time you were away, from the server (none in the demo). @param {unknown} raw */
    setAway(raw) {
      const next = live() ? readAway(raw) : null;
      const back = next?.until != null && (next.since !== away?.since || next.until !== away?.until);
      away = next;
      scheduleOfferEnd();
      if (back && catchUpOffered(away, looked.get(true), now())) ctx.announcer.polite('Welcome back. Catch me up, or press W, to see what your crews did while you were away.');
      ctx.refresh();
    },
    /** Whether the masthead offers to catch you up now. */
    offered() {
      return live() && !viewOnly() && catchUpOffered(away, looked.get(true), now());
    },
  };
}
