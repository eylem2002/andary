// Keyboard shortcuts. The mapping is a pure function of the key event and a little context, so it
// is unit-tested; installShortcuts wires it to the document.

/**
 * @typedef {'follow'|'escape'|'rotate-left'|'rotate-right'|'zoom-in'|'zoom-out'|'reset-view'|
 *   'cycle-time'|'toggle-sound'|'approvals'|'pause'|'help'|'director'|'toggle-panels'|'usage'|'leaderboard'|'place-names'|'needs-you'|'catch-up'|'review'|'walk-mode'|`crew-${number}`} ShortcutAction
 */

/**
 * The shortcut list shown in the help dialog (one entry per row).
 * @type {ReadonlyArray<{ keys: string[], label: string, demoOnly?: boolean }>}
 */
export const SHORTCUT_HELP = Object.freeze([
  { keys: ['C'], label: 'Director camera: follow the action by itself' },
  { keys: ['H'], label: 'Full-screen town: put the side boards away or bring them back' },
  { keys: ['F'], label: 'Follow the selected agent (or the busiest one)' },
  { keys: ['G'], label: 'Walk mode: walk your character (a team town, or the demo); on the town, arrows or W A S D take a step' },
  { keys: ['Esc'], label: 'Close the open panel, stop following' },
  { keys: ['[', ']'], label: 'Rotate the view' },
  { keys: ['+', '−'], label: 'Zoom in and out' },
  { keys: ['0'], label: 'Reset the view' },
  { keys: ['N'], label: 'Switch between day, sunset, night and the local clock' },
  { keys: ['P'], label: 'Place names: on the buildings where they fit, always, or off' },
  { keys: ['M'], label: 'Sound on or off' },
  { keys: ['U'], label: 'Usage: tokens and estimated cost, today and the last 14 days' },
  { keys: ['L'], label: 'Leaderboard: the town\'s growth, records and the busiest agents' },
  { keys: ['I'], label: 'Go to what needs you, most urgent first (again for the next one)' },
  { keys: ['W'], label: 'Catch me up: what your crews did since you last looked' },
  { keys: ['R'], label: 'Review: what each crew changed since you last marked it reviewed' },
  { keys: ['A'], label: 'Go to approvals' },
  { keys: ['1', '9'], label: 'Jump to crew 1 to 9' },
  { keys: ['Space'], label: 'Pause or resume the demo', demoOnly: true },
  { keys: ['?'], label: 'Show these shortcuts' },
]);

/** @type {Record<string, ShortcutAction>} */
const KEY_ACTIONS = {
  f: 'follow',
  F: 'follow',
  g: 'walk-mode',
  G: 'walk-mode',
  Escape: 'escape',
  '[': 'rotate-left',
  ']': 'rotate-right',
  '+': 'zoom-in',
  '=': 'zoom-in',
  '-': 'zoom-out',
  _: 'zoom-out',
  '0': 'reset-view',
  n: 'cycle-time',
  N: 'cycle-time',
  m: 'toggle-sound',
  M: 'toggle-sound',
  a: 'approvals',
  A: 'approvals',
  c: 'director',
  C: 'director',
  h: 'toggle-panels',
  H: 'toggle-panels',
  u: 'usage',
  U: 'usage',
  l: 'leaderboard',
  L: 'leaderboard',
  p: 'place-names',
  P: 'place-names',
  i: 'needs-you',
  I: 'needs-you',
  w: 'catch-up',
  W: 'catch-up',
  r: 'review',
  R: 'review',
  '?': 'help',
};

const TEXT_INPUT_TYPES = new Set(['text', 'search', 'email', 'number', 'password', 'url', 'tel', 'date', 'time']);
const ACTIVATES_ON_SPACE = new Set(['BUTTON', 'A', 'SUMMARY', 'SELECT']);

/**
 * @typedef {object} KeyLike
 * @property {string} key
 * @property {boolean} [ctrlKey]
 * @property {boolean} [metaKey]
 * @property {boolean} [altKey]
 * @property {boolean} [repeat]
 */

/**
 * @typedef {object} TargetLike
 * @property {string} [tagName]
 * @property {string} [type]
 * @property {boolean} [isContentEditable]
 * @property {string|null} [role]
 */

/**
 * Maps a key press to a HUD action, or null when the HUD should leave the key alone: modifier
 * chords (browser and OS shortcuts), typing in a text field, and Space on a control that Space
 * activates. Space only pauses in demo mode.
 * @param {KeyLike} event
 * @param {{ mode?: 'live'|'demo', target?: TargetLike|null }} [context]
 * @returns {ShortcutAction|null}
 */
export function shortcutFor(event, { mode = 'live', target = null } = {}) {
  if (event.ctrlKey || event.metaKey || event.altKey) return null;
  if (isTypingTarget(target)) return null;
  if (event.key === ' ' || event.key === 'Spacebar') {
    if (mode !== 'demo' || activatesOnSpace(target)) return null;
    return 'pause';
  }
  if (/^[1-9]$/.test(event.key)) return /** @type {ShortcutAction} */ (`crew-${event.key}`);
  return KEY_ACTIONS[event.key] ?? null;
}

/**
 * True when keys typed at this element are text input, not commands.
 * @param {TargetLike|null|undefined} target
 */
export function isTypingTarget(target) {
  if (!target) return false;
  if (target.isContentEditable) return true;
  const tag = (target.tagName ?? '').toUpperCase();
  if (tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (tag === 'INPUT') return TEXT_INPUT_TYPES.has((target.type ?? 'text').toLowerCase());
  return target.role === 'textbox' || target.role === 'combobox';
}

/** @param {TargetLike|null|undefined} target */
function activatesOnSpace(target) {
  if (!target) return false;
  const tag = (target.tagName ?? '').toUpperCase();
  if (ACTIVATES_ON_SPACE.has(tag)) return true;
  if (tag === 'INPUT') return true;
  return ['button', 'checkbox', 'switch', 'tab', 'radio', 'menuitem', 'option'].includes(target.role ?? '');
}

/**
 * Listens for shortcuts on the document. `handle` returns true when it used the key, which then
 * stops the browser's default (for example Space scrolling the page).
 * @param {{ getMode: () => 'live'|'demo', handle: (action: ShortcutAction, event: KeyboardEvent) => boolean }} options
 * @returns {() => void} removes the listener
 */
export function installShortcuts({ getMode, handle }) {
  /** @param {KeyboardEvent} event */
  const onKey = (event) => {
    // The 3D view handles its own keys (arrows, +/-, Q/E) and marks them as handled.
    if (event.defaultPrevented || event.isComposing) return;
    const target = /** @type {HTMLElement|null} */ (event.target instanceof HTMLElement ? event.target : null);
    const action = shortcutFor(event, { mode: getMode(), target: target && describeTarget(target) });
    if (action && handle(action, event)) event.preventDefault();
  };
  document.addEventListener('keydown', onKey);
  return () => document.removeEventListener('keydown', onKey);
}

/** @param {HTMLElement} el @returns {TargetLike} */
function describeTarget(el) {
  return {
    tagName: el.tagName,
    type: el instanceof HTMLInputElement ? el.type : undefined,
    isContentEditable: el.isContentEditable,
    role: el.getAttribute('role'),
  };
}
