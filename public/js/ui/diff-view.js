// One diff hunk as DOM: the inspector's "Changes" dialog and the approval cards both show edits
// this way. + and − marks carry the meaning (screen readers hear "Added" / "Removed"); the tints
// only help the eye. Text only, never HTML.
import { lineDiff } from './diff.js';
import { h } from './dom.js';
import { revealHidden } from './format.js';

const OPS = { add: { mark: '+', label: 'Added' }, del: { mark: '−', label: 'Removed' }, same: { mark: ' ', label: '' } };

/**
 * @param {{ before: string, after: string, cut?: boolean }} hunk
 * @param {{ index?: number, count?: number, exact?: boolean, compact?: boolean }} [options]
 *   `exact` reveals hidden characters (approval cards: nothing may hide in what is approved);
 *   `compact` is the shorter box used inside a card.
 * @returns {HTMLElement}
 */
export function diffView(hunk, { index = 0, count = 1, exact = false, compact = false } = {}) {
  const shown = (/** @type {string} */ text) => (exact ? revealHidden(text) : text);
  const rows = lineDiff(hunk.before, hunk.after).map((line) => h('div', { class: `hud-diff__line hud-diff__line--${line.op}` },
    h('span', { class: 'hud-diff__mark', 'aria-hidden': 'true', text: OPS[line.op].mark }),
    OPS[line.op].label ? h('span', { class: 'hud-sr', text: `${OPS[line.op].label}: ` }) : null,
    h('span', { class: 'hud-diff__text', text: shown(line.text) || ' ' })));
  const title = count > 1 ? `Edit ${index + 1} of ${count}` : 'Edit';
  return h('section', { class: 'hud-diff__hunk', 'aria-label': title },
    count > 1 ? h('h3', { class: 'hud-diff__hunk-title', text: title }) : null,
    h('div', { class: `hud-diff__code hud-mono${compact ? ' hud-diff__code--compact' : ''}`, role: 'group', tabindex: '0', 'aria-label': 'Diff' },
      ...(rows.length ? rows : [h('div', { class: 'hud-diff__line', text: 'No text changed.' })])),
    hunk.cut ? h('p', { class: 'hud-dialog__note', text: 'Long edit: only its first 4,000 characters are shown.' }) : null);
}
