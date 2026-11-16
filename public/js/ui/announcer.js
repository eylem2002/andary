// Screen-reader announcements. The activity log itself is not a live region (a busy session logs
// several events a second); instead a separate region reads a short summary at most once per
// interval. Approvals and other one-off messages use their own polite region.
import { h } from './dom.js';
import { truncate } from './format.js';

/**
 * Summary of a burst of log entries: "Scout: Read src/a.ts" or
 * "5 new events, 1 failed. Latest: Scout: Read src/a.ts".
 * @param {{ agentName?: string, text?: string, level?: string }[]} entries
 */
export function summarizeActivity(entries) {
  if (!entries.length) return '';
  const latest = entries[entries.length - 1];
  const line = `${latest.agentName ?? 'Agent'}: ${truncate(latest.text, 120)}`;
  if (entries.length === 1) return line;
  const failed = entries.filter((entry) => entry.level === 'error').length;
  return `${entries.length} new events${failed ? `, ${failed} failed` : ''}. Latest: ${line}`;
}

/**
 * @param {{ interval?: number }} [options]
 */
export function createAnnouncer({ interval = 5000 } = {}) {
  const politeRegion = h('div', { class: 'hud-sr', role: 'status', 'aria-live': 'polite' });
  const activityRegion = h('div', { class: 'hud-sr', 'aria-live': 'polite', 'aria-atomic': 'true' });
  /** @type {any[]} */
  let pending = [];
  let lastAnnounced = -Infinity;
  /** @type {ReturnType<typeof setTimeout>|null} */
  let timer = null;
  let enabled = true;

  function flushActivity() {
    timer = null;
    if (!enabled || !pending.length) return;
    const text = summarizeActivity(pending);
    pending = [];
    lastAnnounced = Date.now();
    activityRegion.textContent = text;
  }

  return {
    elements: [politeRegion, activityRegion],
    /** Announces now; repeating the same text is still read because the region is cleared first. @param {string} text */
    polite(text) {
      politeRegion.textContent = '';
      requestAnimationFrame(() => {
        politeRegion.textContent = text;
      });
    },
    /** Queues log entries for the next throttled summary. @param {any[]} entries */
    activity(entries) {
      if (!enabled || !entries.length) return;
      pending.push(...entries);
      if (pending.length > 50) pending = pending.slice(-50);
      if (timer) return;
      const wait = Math.max(0, lastAnnounced + interval - Date.now());
      timer = setTimeout(flushActivity, wait);
    },
    /** @param {boolean} on */
    setActivityEnabled(on) {
      enabled = on;
      if (!on) {
        pending = [];
        activityRegion.textContent = '';
      }
    },
  };
}
