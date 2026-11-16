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
 */

const MAX_VISIBLE = 3;
const DURATION_MS = 6500;

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
    toast.dataset.timer = String(setTimeout(() => dismiss(toast), DURATION_MS));
  }

  /** @param {ToastOptions} options */
  function show(options) {
    const toast = build(options, dismiss);
    // Reading a toast pauses its timer: hover or keyboard focus keeps it open.
    toast.addEventListener('pointerenter', () => clearTimeout(Number(toast.dataset.timer)));
    toast.addEventListener('pointerleave', () => arm(toast));
    toast.addEventListener('focusin', () => clearTimeout(Number(toast.dataset.timer)));
    toast.addEventListener('focusout', () => arm(toast));
    list.prepend(toast);
    while (list.children.length > MAX_VISIBLE) dismiss(/** @type {HTMLElement} */ (list.lastElementChild));
    arm(toast);
  }

  return { el, show };
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
