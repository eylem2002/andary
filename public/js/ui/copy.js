// Copy buttons: a command or a Markdown note to the clipboard, from inside the click handler so the
// clipboard API is allowed. When it is not (an insecure origin, permissions), the text is shown
// selected so the viewer can copy it by hand. Nothing is sent anywhere.
import { h } from './dom.js';
import { icon } from './icons.js';

/** @typedef {import('./types.js').HudContext} HudContext */

/** How long a button says "Copied" before it says its name again. */
const SAID_MS = 2500;

/**
 * Selects the text of an element (opening the <details> it sits in), for a copy by hand.
 * @param {HTMLElement} el
 */
function selectText(el) {
  const details = el.closest('details');
  if (details) details.open = true;
  const range = document.createRange();
  range.selectNodeContents(el);
  const selection = window.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
}

/**
 * Copies text; the button's last child (its label) says what happened for a moment.
 * @param {HudContext} ctx
 * @param {{ text: string, button: HTMLElement, shown: HTMLElement, spoken: string }} what
 *   shown: the element that holds the text on screen, selected when the clipboard refuses;
 *   spoken: what screen readers hear once it is copied ("Copied the resume command")
 */
export async function copyText(ctx, { text, button, shown, spoken }) {
  const label = /** @type {HTMLElement} */ (button.lastElementChild);
  const name = button.dataset.label ?? label.textContent ?? '';
  button.dataset.label = name;
  try {
    await navigator.clipboard.writeText(text);
    label.textContent = 'Copied';
    ctx.announcer.polite(spoken);
  } catch {
    selectText(shown);
    label.textContent = 'Press Ctrl+C';
    ctx.announcer.polite('Selected the text. Press Control C or Command C to copy it.');
  }
  setTimeout(() => {
    label.textContent = name;
  }, SAID_MS);
}

/**
 * A small "Copy …" button.
 * @param {string} label  its visible words
 * @param {Record<string, string>} [attrs]
 */
export function copyButton(label, attrs = {}) {
  return h('button', { type: 'button', class: 'hud-btn hud-btn--small', ...attrs }, icon('copy', { size: 16 }), h('span', { text: label }));
}
