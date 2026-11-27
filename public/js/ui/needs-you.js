// "Needs you" in the HUD (docs/design/agent-health.md §3): the attention list from core/attention.js
// with the viewer's dismissals, the button's words, and which item the button goes to next. The
// HUD parts read it: the masthead button and page title, the crew rows, the notifications.
import { attentionItems, countedItems } from '../core/attention.js';
import { formatDuration } from './format.js';

/** @typedef {import('../core/attention.js').AttentionItem} AttentionItem */
/** @typedef {import('./types.js').StoreState} StoreState */

export const DISMISSED_KEY = 'andary:dismissed';
/** A dismissal is forgotten after a day: by then its episode is long over. */
const DISMISS_FOR_MS = 24 * 60 * 60 * 1000;

/**
 * @param {{ storage?: Pick<Storage, 'getItem'|'setItem'>|null, now?: () => number, viewOnly?: () => boolean, onChange?: () => void }} [options]
 *   viewOnly: the viewer only watches (a team town's view link), so nothing needs them;
 *   onChange: dismissals changed in another tab of this town
 */
export function createNeedsYou({ storage = safeStorage(), now = Date.now, viewOnly = () => false, onChange = () => {} } = {}) {
  /** @type {Map<string, number>} id → when the dismissal is forgotten */
  let dismissed = loadDismissed(storage, now());
  /** The item the button went to last: the next click goes on from there. */
  let cursor = '';
  // Another tab set something aside: so does this one.
  globalThis.addEventListener?.('storage', (event) => {
    if (event.key !== DISMISSED_KEY) return;
    dismissed = loadDismissed(storage, now());
    onChange();
  });

  /** @param {AttentionItem[]} items @param {string} from */
  const after = (items, from) => {
    const counted = countedItems(items);
    if (!counted.length) return null;
    const at = counted.findIndex((item) => item.id === from);
    return counted[(at + 1) % counted.length];
  };

  return {
    /**
     * Everything that needs the viewer, most urgent first, without what they set aside.
     * @param {StoreState} state
     * @param {number} [at]
     */
    items(state, at = now()) {
      if (viewOnly()) return [];
      const kept = new Set([...dismissed].filter(([, until]) => until > at).map(([id]) => id));
      return attentionItems(state, at, { dismissed: kept });
    },
    /** @param {string} id */
    dismiss(id) {
      dismissed.set(id, now() + DISMISS_FOR_MS);
      saveDismissed(storage, dismissed, now());
    },
    /**
     * Where the button goes next, without going there: for its label.
     * @param {AttentionItem[]} items
     * @returns {AttentionItem|null}
     */
    peek(items) {
      return after(items, cursor);
    },
    /**
     * Goes on to the counted item after the one the button went to last (the first after the end).
     * @param {AttentionItem[]} items
     * @returns {AttentionItem|null}
     */
    next(items) {
      const item = after(items, cursor);
      if (item) cursor = item.id;
      return item;
    },
  };
}

/**
 * The button's name: its visible words first ("3 need you"), then where a click goes.
 * @param {AttentionItem[]} counted
 * @param {AttentionItem|null} next
 */
export function needsYouLabel(counted, next) {
  const words = `${counted.length} ${counted.length === 1 ? 'needs' : 'need'} you`;
  return next ? `${words}. Next: ${next.text}` : words;
}

/**
 * How long an item has waited, for its crew row: "4m 05s", with words for screen readers.
 * @param {AttentionItem} item
 * @param {number} now
 */
export function waitedText(item, now) {
  const waited = formatDuration(now - item.since);
  return { short: waited, long: WAITED_WORDS[item.kind]?.(waited) ?? `waiting for ${waited}` };
}

/** Words for the time of the items that are not a wait for you. @type {Partial<Record<AttentionItem['kind'], (waited: string) => string>>} */
const WAITED_WORDS = {
  finished: (waited) => `finished ${waited} ago`,
  // A stuck agent is not waiting for you: it has been going round for that long.
  stuck: (waited) => `stuck for ${waited}`,
  // Two agents on the same files: it happened that long ago, nobody waits.
  conflict: (waited) => `${waited} ago`,
  // A push while the tests were red: it happened that long ago.
  pushed: (waited) => `pushed ${waited} ago`,
};

/**
 * A note counts for nothing and blocks nobody: an alert that is not counted (an edit of a file
 * another agent changed, core/conflicts.js). A crew row shows it beside what the agent does, not
 * instead of it, as it may last half an hour.
 * @param {AttentionItem} item
 */
export function isNote(item) {
  return item.level === 'alert' && !item.counted;
}

/**
 * Each agent's most urgent item, notes aside (an item for several crews or agents counts for each
 * of them).
 * @param {StoreState} state @param {ReturnType<typeof createNeedsYou>} needsYou @param {number} now
 */
export function itemsByAgent(state, needsYou, now) {
  /** @type {Map<string, AttentionItem>} */
  const byAgent = new Map();
  for (const item of needsYou.items(state, now)) {
    if (isNote(item)) continue;
    for (const key of item.agentKeys) if (!byAgent.has(key)) byAgent.set(key, item);
  }
  return byAgent;
}

/**
 * Each agent's newest note (isNote), for the line under what it does.
 * @param {StoreState} state @param {ReturnType<typeof createNeedsYou>} needsYou @param {number} now
 */
export function notesByAgent(state, needsYou, now) {
  /** @type {Map<string, AttentionItem>} */
  const byAgent = new Map();
  for (const item of needsYou.items(state, now)) {
    if (!isNote(item)) continue;
    for (const key of item.agentKeys) if ((byAgent.get(key)?.since ?? -Infinity) < item.since) byAgent.set(key, item);
  }
  return byAgent;
}

/**
 * @param {Pick<Storage, 'getItem'>|null} storage
 * @param {number} now
 * @returns {Map<string, number>}
 */
function loadDismissed(storage, now) {
  /** @type {Map<string, number>} */
  const map = new Map();
  try {
    const saved = JSON.parse(storage?.getItem(DISMISSED_KEY) ?? '{}');
    for (const [id, until] of Object.entries(saved ?? {})) {
      if (typeof until === 'number' && until > now) map.set(id, until);
    }
  } catch {
    // unreadable: nothing dismissed
  }
  return map;
}

/**
 * @param {Pick<Storage, 'setItem'>|null} storage
 * @param {Map<string, number>} dismissed
 * @param {number} now
 */
function saveDismissed(storage, dismissed, now) {
  for (const [id, until] of dismissed) if (until <= now) dismissed.delete(id);
  try {
    storage?.setItem(DISMISSED_KEY, JSON.stringify(Object.fromEntries(dismissed)));
  } catch {
    // storage full or disabled: dismissals last until the page reloads
  }
}

function safeStorage() {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}
