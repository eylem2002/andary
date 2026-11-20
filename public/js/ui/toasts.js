// Toasts for things worth a glance: a crew arriving, an approval waiting, an achievement.
// They are not live regions themselves; the HUD announces through the announcer so screen-reader
// users get one concise message instead of every toast's full text.
import { h } from './dom.js';
import { icon } from './icons.js';
import { roundel } from './parts.js';

/**
 * @typedef {object} ToastOptions
 * @property {'info'|'crew'|'approval'|'achievement'|'error'} [tone]
 * @property {string} title
 * @property {string} [body]
 * @property {boolean} [mono]          body is a command or path
 * @property {string} [icon]           icon name (ignored when `number` is given)
 * @property {number} [number]         crew number, shown as a roundel
 * @property {string} [color]          crew colour for the roundel
 * @property {{ label: string, run: () => void }} [action]
 * @property {string} [group]          a newer toast of the same group replaces this one (one crew
 *                                     arrival, one achievement on screen at a time: the panels keep the rest)
 */

/** Two at most: toasts sit over the town, and three cards hid a third of its top. */
const MAX_VISIBLE = 2;
const DURATION_MS = 6500;
/** A toast with a button waits longer, so there is time to reach it. */
const ACTION_DURATION_MS = 15_000;

export function createToasts() {
  const list = h('ol', { class: 'hud-toasts__list' });
  const el = h('section', { class: 'hud hud-toasts', 'aria-label': 'Notifications' }, list);

  /** @param {HTMLElement} toast */
  function dismiss(toast) {
    clearTimeout(Number(toast.dataset.timer));
    toast.remove();
  }

  /** @param {HTMLElement} toast */
  function arm(toast) {
    clearTimeout(Number(toast.dataset.timer));
    toast.dataset.timer = String(setTimeout(() => dismiss(toast), toast.dataset.action ? ACTION_DURATION_MS : DURATION_MS));
  }

  /** Toasts in the list, newest first, as pickEviction reads them. */
  function entries() {
    const toasts = /** @type {HTMLElement[]} */ ([...list.children]);
    return toasts.map((toast) => ({ toast, action: Boolean(toast.dataset.action), group: toast.dataset.group ?? '', held: toast.matches(':hover, :focus-within') }));
  }

  /** Makes room for a new toast (pickEviction says which goes); one under the hand stays. */
  function overflow() {
    while (list.children.length > MAX_VISIBLE) {
      const all = entries();
      const index = pickEviction(all);
      if (index < 0) return; // every toast is being read or used: let the list grow for now
      dismiss(all[index].toast);
    }
  }

  /**
   * @param {ToastOptions} options
   * @returns {boolean} whether the toast is on screen (a burst can push it straight out)
   */
  function show(options) {
    const toast = build(options, dismiss);
    // Reading a toast pauses its timer: hover or keyboard focus keeps it open.
    toast.addEventListener('pointerenter', () => clearTimeout(Number(toast.dataset.timer)));
    toast.addEventListener('pointerleave', () => arm(toast));
    toast.addEventListener('focusin', () => clearTimeout(Number(toast.dataset.timer)));
    toast.addEventListener('focusout', () => arm(toast));
    if (options.action) toast.dataset.action = 'true';
    if (options.group) {
      // The older toast of the group goes, unless the pointer or the keyboard is on it.
      for (const old of entries()) if (old.group === options.group && !old.held) dismiss(old.toast);
      toast.dataset.group = options.group;
    }
    list.prepend(toast);
    overflow();
    if (!toast.isConnected) return false;
    arm(toast);
    return true;
  }

  return { el, show };
}

/**
 * Which toast makes room for a newer one: never one the pointer or the keyboard is on; first the
 * oldest without a button, then the oldest crew arrival (the Crews panel has them all), and an
 * approval's toast last. -1 when every toast is held.
 * @param {ReadonlyArray<{ action: boolean, group: string, held: boolean }>} toasts  newest first
 * @returns {number}
 */
export function pickEviction(toasts) {
  const rank = (/** @type {{ action: boolean, group: string }} */ t) => (!t.action ? 0 : t.group ? 1 : 2);
  let pick = -1;
  for (let i = toasts.length - 1; i >= 0; i--) {
    const t = toasts[i];
    if (t.held) continue;
    if (pick < 0 || rank(t) < rank(toasts[pick])) pick = i;
  }
  return pick;
}

/**
 * @param {ToastOptions} options
 * @param {(toast: HTMLElement) => void} dismiss
 */
function build({ tone = 'info', title, body, mono, icon: iconName, number, color, action }, dismiss) {
  const badge = number
    ? roundel(number, color)
    : h('span', { class: 'hud-toast__badge', 'aria-hidden': 'true' }, icon(iconName ?? 'info', { size: 18 }));
  const close = h('button', { type: 'button', class: 'hud-iconbtn hud-toast__close', 'aria-label': 'Dismiss notification' }, icon('close', { size: 16 }));
  const actionButton = action
    ? h('button', { type: 'button', class: 'hud-btn hud-btn--small hud-toast__action' }, action.label)
    : null;
  const toast = h(
    'li',
    { class: `hud-toast hud-toast--${tone}` },
    badge,
    h('div', { class: 'hud-toast__text' },
      h('p', { class: 'hud-toast__title', text: title }),
      body ? h('p', { class: mono ? 'hud-toast__body hud-mono' : 'hud-toast__body', text: body }) : null),
    actionButton,
    close,
  );
  close.addEventListener('click', () => dismiss(toast));
  actionButton?.addEventListener('click', () => {
    dismiss(toast);
    action.run();
  });
  return toast;
}
