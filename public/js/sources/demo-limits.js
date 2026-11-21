// Made-up plan limits for the demo, so the Usage button's gauge and the "Plan limits" list have
// something to show without Claude Code and its andary-limits mod (CONTRACTS §4.14): a 5-hour
// window two and a half hours in, used fast enough that the pace would run it out before it
// resets, and a quiet week. The same shape the server sends.
const HOUR_MS = 3_600_000;

/**
 * @param {number} now
 * @returns {{ accounts: import('../core/limits.js').AccountLimits[] }}
 */
export function demoLimits(now) {
  const read = now - 2 * 60_000;
  return {
    accounts: [{
      account: 'default',
      label: null,
      claudeVersion: null,
      at: read,
      limits: [
        { kind: 'five_hour', percentUsed: 64, resetsAt: now + 2.5 * HOUR_MS, at: read },
        { kind: 'seven_day', percentUsed: 23, resetsAt: now + 4 * 24 * HOUR_MS, at: read },
      ],
    }],
  };
}
