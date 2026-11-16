// Token bucket: allows short bursts (a busy session firing many hooks at once) while capping the
// sustained rate, so a runaway or hostile local client cannot flood the browsers.

/**
 * @typedef {object} TokenBucket
 * @property {(count?: number) => boolean} take  Spends `count` tokens if available.
 * @property {() => number} available            Tokens currently available (after refill).
 */

/**
 * @param {{ ratePerSecond: number, burst: number, now?: () => number }} options
 *   `now` returns milliseconds; injectable so tests can control time.
 * @returns {TokenBucket}
 */
export function createTokenBucket({ ratePerSecond, burst, now = () => performance.now() }) {
  let tokens = burst;
  let last = now();

  function refill() {
    const current = now();
    const elapsed = Math.max(0, current - last);
    last = current;
    tokens = Math.min(burst, tokens + (elapsed / 1000) * ratePerSecond);
  }

  return {
    take(count = 1) {
      refill();
      if (tokens < count) return false;
      tokens -= count;
      return true;
    },
    available() {
      refill();
      return tokens;
    },
  };
}
