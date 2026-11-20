// Calendar days in the viewer's (or server's) local time zone, as "YYYY-MM-DD". Shared by the
// usage chart, the town's busy days and the leaderboard, on the server and in the browser.

/**
 * The local calendar day of a moment.
 * @param {number|Date} at  milliseconds or a Date
 * @returns {string}
 */
export function localDate(at) {
  const d = new Date(at);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * The local calendar day `back` days before a moment: steps by calendar day, so a daylight-saving
 * change never skips or repeats one.
 * @param {number} at
 * @param {number} back
 * @returns {string}
 */
export function localDateBefore(at, back) {
  const d = new Date(at);
  d.setDate(d.getDate() - back);
  return localDate(d);
}
