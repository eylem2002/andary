// Made-up pull requests for the demo, so a pushed branch's PR and CI (CONTRACTS §4.16) can be seen
// without gh: when a story's crew pushes, its work tree gets a pull request whose checks run for a
// while, then fail (every other one) or pass. The same shape the server sends; no link, since the
// pull requests do not exist.
import { pushSites } from '../core/pr-status.js';

/** How long the made-up checks run, in story time at 1×. */
const CHECKS_MS = 20_000;
const FAILED_CHECKS = Object.freeze(['test (ubuntu-latest)', 'lint']);

/** @param {string} command */
function branchOf(command) {
  const match = /git\s+push(?:\s+-\S+)*\s+\S+\s+([\w./-]+)/.exec(command);
  return match ? match[1] : 'main';
}

/**
 * @param {{ setPr?: (pr: unknown) => void }} store
 * @param {() => number} now
 * @param {{ speed: () => number, setTimer?: (fn: () => void, ms: number) => any, clearTimer?: (timer: any) => void }} options
 * @returns {{ observe: (payload: any) => void, stop: () => void }}
 */
export function createDemoPrs(store, now, { speed, setTimer = setTimeout, clearTimer = clearTimeout }) {
  /** @type {Map<string, { number: number, timer: any }>} work tree → its pull request */
  const prs = new Map();
  let count = 0;

  /** @param {string} root @param {string} sessionId @param {number} number @param {string} branch @param {'pending'|'failing'|'passing'} state */
  function set(root, sessionId, number, branch, state) {
    const failing = state === 'failing' ? FAILED_CHECKS.length : 0;
    store.setPr?.({
      root,
      sessionIds: [sessionId],
      number,
      url: null,
      state: 'OPEN',
      review: state === 'passing' ? 'APPROVED' : 'REVIEW_REQUIRED',
      branch,
      sha: `demo${number}`,
      checks: { state, total: 4, failing, pending: state === 'pending' ? 4 : 0, failed: state === 'failing' ? [...FAILED_CHECKS] : [] },
      at: now(),
      failingSince: state === 'failing' ? now() : null,
      watching: state === 'pending',
    });
  }

  return {
    observe(payload) {
      for (const root of pushSites(payload)) {
        const sessionId = String(payload.session_id ?? '');
        const branch = branchOf(String(payload.tool_input?.command ?? ''));
        const known = prs.get(root);
        if (known) clearTimer(known.timer);
        count += 1;
        const number = known?.number ?? 140 + count;
        set(root, sessionId, number, branch, 'pending');
        const outcome = count % 2 === 1 ? 'failing' : 'passing';
        const timer = setTimer(() => set(root, sessionId, number, branch, outcome), CHECKS_MS / Math.max(1, speed()));
        prs.set(root, { number, timer });
      }
    },
    stop() {
      for (const pr of prs.values()) clearTimer(pr.timer);
    },
  };
}
