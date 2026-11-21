// The server's "Catch me up" (docs/design/agent-health.md §7): whether you were away, and what
// each of your crews did meanwhile. The server decides that you were away, because it sees every
// prompt and every decision you make in the town: away means nothing from you (a prompt, a
// /compact you ran, a session you started, resumed, cleared or left, a request decided in the
// town) in any local session for AWAY_MS or more while crews kept working (hooks that count,
// core/digest.js). The counts are core/digest.js's (the demo keeps them the same way), held here
// for this computer's crews only (server/ingest.mjs leaves teammates' out), in memory: they hold
// your agents' last messages, so like the history they never go to disk (ADR 0006).
import { createDigest, tallyOf } from '../public/js/core/digest.js';
import { isDoctorSession } from '../public/js/core/ids.js';

/** Nothing from you for this long, while crews worked: you were away. */
export const AWAY_MS = 20 * 60_000;

/** Sessions you start, resume or clear (SessionStart's `source`): an automatic compaction is not you. */
const YOUR_STARTS = new Set(['startup', 'resume', 'clear']);
/** Sessions you leave (SessionEnd's `reason`): typing /exit or Ctrl+D at the prompt, or /clear. */
const YOUR_ENDS = new Set(['prompt_input_exit', 'clear']);

/**
 * Something you did at a terminal: a prompt as the dialog model reads one (core/dialogs.js: what
 * you typed, or a `/compact` you ran; an automatic one is the agent's own), or a session you
 * started, resumed, cleared or left.
 * @param {Record<string, any>} event
 */
function isYou(event) {
  switch (event.hook_event_name) {
    case 'UserPromptSubmit':
      return true;
    case 'PreCompact':
      return event.trigger === 'manual';
    case 'SessionStart':
      return YOUR_STARTS.has(event.source);
    case 'SessionEnd':
      return YOUR_ENDS.has(event.reason);
    default:
      return false;
  }
}

/**
 * @typedef {object} Away  a time you were away while your crews worked (CONTRACTS §4.13)
 * @property {number} since        the last thing you did before it, or when the town started
 * @property {number|null} until   the first thing you did after it; null while you are still away
 */

/**
 * @typedef {object} AwayOptions
 * @property {number} [awayMs]  AWAY_MS; shorter for tests (ANDARY_AWAY_MS, server/cli/start.mjs)
 * @property {() => number} [now]
 * @property {(away: Away) => void} [onChange]  an absence began or ended
 * @property {(fn: () => void, ms: number) => any} [setTimer]
 * @property {(timer: any) => void} [clearTimer]
 */

/**
 * Whether you are away, and the latest time you were. An absence begins once AWAY_MS have passed
 * since you last did something and a hook that counts has arrived since then (on a timer, so an
 * open town hears of it at once, even when the crews finished long before); the next thing you
 * do ends it.
 * @param {AwayOptions} [options]
 */
export function createAwayWatch({ awayMs = AWAY_MS, now = Date.now, onChange = () => {}, setTimer = setTimeout, clearTimer = clearTimeout } = {}) {
  /** The last thing you did; before the first, when the town started. */
  let seen = now();
  /** A hook that counts has arrived since you were last seen: crews kept working. */
  let worked = false;
  /** @type {Away|null} */
  let latest = null;
  /** @type {any} */
  let timer = null;

  const ongoing = () => latest !== null && latest.until === null;

  function stopTimer() {
    if (timer !== null) clearTimer(timer);
    timer = null;
  }

  /** @param {Away} away */
  function change(away) {
    latest = away;
    onChange({ ...away });
  }

  /** You have been away since you were last seen. */
  function begin() {
    stopTimer();
    if (!ongoing()) change({ since: seen, until: null });
  }

  /** A hook from a crew at work. @param {number} at */
  function work(at) {
    if (ongoing()) return;
    worked = true;
    if (at - seen >= awayMs) begin();
    else if (timer === null) {
      timer = setTimer(begin, seen + awayMs - at);
      timer?.unref?.();
    }
  }

  /** Something you did: you are here, and an absence ends if you were away. @param {number} at */
  function present(at) {
    stopTimer();
    if (ongoing() || (worked && at - seen >= awayMs)) change({ since: seen, until: at });
    seen = at;
    worked = false;
  }

  return {
    /**
     * A local hook (ingest leaves teammates' out): you, or a crew at work when it adds to the
     * counts (an idle notification, a session starting on its own, is neither). The doctor's
     * probe is nobody.
     * @param {Record<string, any>} event
     * @param {number} [at]  when it arrived
     */
    observe(event, at = now()) {
      if (!event || isDoctorSession(event.session_id)) return;
      if (isYou(event)) present(at);
      else if (tallyOf(event)) work(at);
    },
    /**
     * An approval changed (the broker's onChange): a request allowed or denied in the town is you.
     * @param {{ status: string, decidedBy?: string }} approval
     */
    approvalChanged(approval) {
      if (approval.decidedBy === 'town' && (approval.status === 'allowed' || approval.status === 'denied')) present(now());
    },
    /** The latest absence, going on or over, or null. @returns {Away|null} */
    current() {
      return latest ? { ...latest } : null;
    },
    dispose: stopTimer,
  };
}

/**
 * The town's digest: this computer's hooks and the broker's answers, counted per crew
 * (core/digest.js) from the server's start, and the away watch. One per server.
 * @param {Omit<AwayOptions, 'onChange'> & { onAway?: (away: Away) => void }} [options]  onAway: an absence began or ended
 */
export function createTownDigest({ awayMs, now = Date.now, onAway, setTimer, clearTimer } = {}) {
  const counts = createDigest({ startedAt: now() });
  const away = createAwayWatch({ awayMs, now, onChange: onAway, setTimer, clearTimer });
  return {
    /**
     * A local town payload, sanitized: what is counted goes to browsers.
     * @param {Record<string, any>} event
     * @param {number} [at]  when it arrived
     */
    observe(event, at = now()) {
      away.observe(event, at);
      counts.observe(event, at);
    },
    /** Every change of an approval (the broker's onChange). @param {import('./approvals.mjs').Approval} approval */
    approvalChanged(approval) {
      away.approvalChanged(approval);
      counts.answered(approval, now());
    },
    /** The latest time you were away (for a browser's hello). */
    away: () => away.current(),
    /**
     * What each crew did from a time until now (a browser's `{ t: 'digest', since }`, CONTRACTS
     * §4.13). A time before the server started, or before the last day, gets what is kept, and the
     * digest says so (`limit`); one after now counts from now.
     * @param {number} since  milliseconds, the server's clock
     * @returns {import('../public/js/core/digest.js').Digest}
     */
    summary: (since) => counts.summary(since, now()),
    dispose: () => away.dispose(),
  };
}
