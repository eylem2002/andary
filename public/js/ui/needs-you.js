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
 * @param {{ storage?: Pick<Storage, 'getItem'|'setItem'>|null, now?: () => number, viewOnly?: () => boolean }} [options]
 *   viewOnly: the viewer only watches (a team town's view link), so nothing needs them
 */
export function createNeedsYou({ storage = safeStorage(), now = Date.now, viewOnly = () => false } = {}) {
  /** @type {Map<string, number>} id → when the dismissal is forgotten */
  const dismissed = loadDismissed(storage, now());
  /** The item the button went to last: the next click goes on from there. */
  let cursor = '';

  return {
    /**
     * Everything that needs the viewer, most urgent first, without what they dismissed.
     * @param {StoreState} state
     * @param {number} [at]
     */
    items(state, at = now()) {
      if (viewOnly()) return [];
      return attentionItems(state, at, { dismissed: new Set(dismissed.keys()) });
    },
    /** @param {string} id */
    dismiss(id) {
      dismissed.set(id, now() + DISMISS_FOR_MS);
      saveDismissed(storage, dismissed, now());
    },
    /**
     * The counted item after the one the button went to last (the first after the end).
     * @param {AttentionItem[]} items
     * @returns {AttentionItem|null}
     */
    next(items) {
      const counted = countedItems(items);
      if (!counted.length) return null;
      const at = counted.findIndex((item) => item.id === cursor);
      const item = counted[(at + 1) % counted.length];
      cursor = item.id;
      return item;
    },
  };
}

/**
 * The button's words: "3 need you", and what the first one is, for screen readers.
 * @param {AttentionItem[]} counted
 */
export function needsYouLabel(counted) {
  const n = counted.length;
  const first = counted[0];
  const count = `${n} ${n === 1 ? 'thing needs' : 'things need'} you`;
  return first ? `${count}. Next: ${first.text}` : count;
}

/**
 * How long an item has waited, for its crew row: "4m 05s", with words for screen readers.
 * @param {AttentionItem} item
 * @param {number} now
 */
export function waitedText(item, now) {
  const waited = formatDuration(now - item.since);
  return { short: waited, long: item.kind === 'finished' ? `finished ${waited} ago` : `waiting for ${waited}` };
}

/** @param {StoreState} state @param {ReturnType<typeof createNeedsYou>} needsYou @param {number} now */
export function itemsByAgent(state, needsYou, now) {
  /** @type {Map<string, AttentionItem>} */
  const byAgent = new Map();
  for (const item of needsYou.items(state, now)) {
    if (!byAgent.has(item.agentKey)) byAgent.set(item.agentKey, item);
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
