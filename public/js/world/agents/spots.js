// Standing-spot bookkeeping. Each building has a fixed number of spots in front of its door
// (layout.workSpots); agents who arrive when all are taken join a queue (layout.queueSpot) and
// move up when someone leaves. Pure data, so the rules are unit-tested; the crowd turns slots
// into world positions and walks agents there.

/** @typedef {{key: string, kind: 'spot'|'queue', index: number}} Slot */
/** @typedef {{id: string, key: string, kind: 'spot'|'queue', index: number}} SlotMove */

/**
 * @param {(key: string) => number} capacity  number of standing spots at a building
 */
export function createSpotAllocator(capacity) {
  /** @type {Map<string, {spots: (string|null)[], queue: string[]}>} */
  const lots = new Map();
  /** @type {Map<string, string>} agent id → building key */
  const where = new Map();

  /** @param {string} key */
  function lot(key) {
    let entry = lots.get(key);
    if (!entry) {
      entry = { spots: new Array(Math.max(1, capacity(key))).fill(null), queue: [] };
      lots.set(key, entry);
    }
    return entry;
  }

  /**
   * Where an agent stands now, or null.
   * @param {string} id
   * @returns {Slot|null}
   */
  function slotOf(id) {
    const key = where.get(id);
    if (key === undefined) return null;
    const entry = lot(key);
    const spot = entry.spots.indexOf(id);
    if (spot >= 0) return { key, kind: 'spot', index: spot };
    return { key, kind: 'queue', index: entry.queue.indexOf(id) };
  }

  /**
   * Frees whatever the agent holds. Returns the agents who move up as a result (the first in
   * the queue takes the freed spot; everyone behind shuffles forward).
   * @param {string} id
   * @returns {SlotMove[]}
   */
  function release(id) {
    const key = where.get(id);
    if (key === undefined) return [];
    where.delete(id);
    const entry = lot(key);
    /** @type {SlotMove[]} */
    const moves = [];
    const spot = entry.spots.indexOf(id);
    let shiftFrom = 0;
    if (spot >= 0) {
      entry.spots[spot] = null;
      const next = entry.queue.shift();
      if (next === undefined) return moves;
      entry.spots[spot] = next;
      moves.push({ id: next, key, kind: 'spot', index: spot });
    } else {
      shiftFrom = entry.queue.indexOf(id);
      entry.queue.splice(shiftFrom, 1);
    }
    for (let i = shiftFrom; i < entry.queue.length; i++) {
      moves.push({ id: entry.queue[i], key, kind: 'queue', index: i });
    }
    return moves;
  }

  /**
   * Takes the nearest free spot at a building, or the back of its queue. Claiming the building
   * the agent already holds keeps its place.
   * @param {string} key
   * @param {string} id
   * @returns {{slot: Slot, moves: SlotMove[]}}
   */
  function claim(key, id) {
    const current = slotOf(id);
    if (current && current.key === key) return { slot: current, moves: [] };
    const moves = release(id);
    const entry = lot(key);
    const free = entry.spots.indexOf(null);
    if (free >= 0) entry.spots[free] = id;
    else entry.queue.push(id);
    where.set(id, key);
    return { slot: slotOf(id), moves };
  }

  /**
   * Snapshot of a building's spots and queue (copies, for tests and debugging).
   * @param {string} key
   */
  function occupancy(key) {
    const entry = lot(key);
    return { spots: entry.spots.slice(), queue: entry.queue.slice() };
  }

  return { claim, release, slotOf, occupancy };
}
