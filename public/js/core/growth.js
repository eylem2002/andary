// The town grows with the work done in it (CONTRACTS §4.9): every finished turn, finished
// helper and completed task is a point, and points unlock landmarks. Shared by the server,
// which keeps the count across restarts, and the browser, which builds what is unlocked.

/**
 * @typedef {object} Milestone
 * @property {string} id
 * @property {number} points   unlocked at this many points
 * @property {string} name     "a Ferris wheel"
 * @property {string} where    "on the beach"
 */

/** @type {ReadonlyArray<Readonly<Milestone>>} */
export const MILESTONES = Object.freeze([
  Object.freeze({ id: 'bunting', points: 10, name: 'Bunting', where: 'over the north avenue' }),
  Object.freeze({ id: 'icecream', points: 25, name: 'An ice-cream cart', where: 'on the promenade' }),
  Object.freeze({ id: 'statue', points: 50, name: 'A statue of a curly brace', where: 'by the Workshop' }),
  Object.freeze({ id: 'wheel', points: 100, name: 'A Ferris wheel', where: 'on the beach' }),
  Object.freeze({ id: 'balloon', points: 200, name: 'A hot-air balloon', where: 'over the town' }),
  Object.freeze({ id: 'golden', points: 500, name: 'A golden dome', where: 'on the Town Hall' }),
]);

/** Hook events that count as work done. */
const POINT_EVENTS = new Set(['Stop', 'SubagentStop', 'TaskCompleted']);

/**
 * Whether a hook event earns a point.
 * @param {Record<string, any>|null|undefined} event  a raw hook payload
 */
export function earnsPoint(event) {
  return POINT_EVENTS.has(event?.hook_event_name);
}

/**
 * The landmarks unlocked at a number of points, in order.
 * @param {number} points
 * @returns {string[]}
 */
export function unlockedAt(points) {
  return MILESTONES.filter((m) => points >= m.points).map((m) => m.id);
}

/**
 * The next landmark and how many points it still needs, or null when everything is built.
 * @param {number} points
 * @returns {{ milestone: Readonly<Milestone>, left: number }|null}
 */
export function nextMilestone(points) {
  const milestone = MILESTONES.find((m) => points < m.points);
  return milestone ? { milestone, left: milestone.points - points } : null;
}
