// Planting spots for worktree trees in the Worktree Grove, relative to the lot centre (+z = south,
// towards the gate). The big old "main" tree stands in the middle; worktrees grow around it, front
// row first so new trees appear where the default camera can see them. Pure, unit-tested.

/** @type {ReadonlyArray<Readonly<{x: number, z: number}>>} */
export const GROVE_SLOTS = Object.freeze([
  { x: -3.3, z: 2.7 },
  { x: 3.9, z: 2.5 },
  { x: -4.6, z: -0.3 },
  { x: 4.7, z: -0.5 },
  { x: -1.9, z: 4.7 },
  { x: -3.1, z: -3.5 },
  { x: 3.3, z: -3.6 },
  { x: 0.1, z: -4.9 },
  { x: -5.1, z: 4.9 },
  { x: 5.1, z: 5 },
  { x: -5.1, z: -5 },
  { x: 5.1, z: -5 },
]);

/**
 * First free slot, or -1 when the grove is full.
 * @param {ReadonlyArray<boolean>} occupied  index → taken
 */
export function nextFreeSlot(occupied) {
  for (let i = 0; i < GROVE_SLOTS.length; i++) {
    if (!occupied[i]) return i;
  }
  return -1;
}

/**
 * Short label for a worktree sign: keeps the tail of long branch-like names, where the
 * distinguishing part usually is ("…/fix-login").
 * @param {unknown} label
 * @param {number} [max]
 */
export function worktreeLabel(label, max = 18) {
  const text = typeof label === 'string' ? label.replace(/\s+/g, ' ').trim() : '';
  if (!text) return 'worktree';
  const chars = Array.from(text);
  return chars.length > max ? `…${chars.slice(chars.length - (max - 1)).join('')}` : text;
}
