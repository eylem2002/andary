// One diff hunk as DOM: the inspector's "Changes" dialog and the approval cards both show edits
// this way. + and − marks carry the meaning (screen readers hear "Added" / "Removed"); the tints
// only help the eye. Text only, never HTML.
import { BLANK_RUN_LINES } from '../core/text.js';
import { lineDiff } from './diff.js';
import { h } from './dom.js';
import { blankLines, looksBlank, revealHidden } from './format.js';

const OPS = { add: { mark: '+', label: 'Added' }, del: { mark: '−', label: 'Removed' }, same: { mark: ' ', label: '' } };

/**
 * @param {{ before: string, after: string, cut?: boolean }} hunk
 * @param {{ index?: number, count?: number, exact?: boolean, compact?: boolean }} [options]
 *   `exact` reveals hidden characters, a carriage return too (approval cards: nothing may hide in
 *   what is approved);
 *   `compact` is the shorter box used inside a card.
 * @returns {HTMLElement}
 */
export function diffView(hunk, { index = 0, count = 1, exact = false, compact = false } = {}) {
  const shown = (/** @type {string} */ text) => (exact ? revealHidden(text) : text);
  /** @type {(import('./diff.js').DiffLine & { gap?: boolean })[]} */
  const lines = exact ? collapseBlankRuns(lineDiff(hunk.before, hunk.after, { exact })) : lineDiff(hunk.before, hunk.after);
  const rows = lines.map((line) => h('div', { class: `hud-diff__line hud-diff__line--${line.op}${line.gap ? ' hud-diff__line--gap' : ''}` },
    h('span', { class: 'hud-diff__mark', 'aria-hidden': 'true', text: OPS[line.op].mark }),
    OPS[line.op].label ? h('span', { class: 'hud-sr', text: `${OPS[line.op].label}: ` }) : null,
    h('span', { class: 'hud-diff__text', text: line.gap ? line.text : shown(line.text) || ' ' })));
  const title = count > 1 ? `Edit ${index + 1} of ${count}` : 'Edit';
  return h('section', { class: 'hud-diff__hunk', 'aria-label': title },
    count > 1 ? h('h3', { class: 'hud-diff__hunk-title', text: title }) : null,
    h('div', { class: `hud-diff__code hud-mono${compact ? ' hud-diff__code--compact' : ''}`, role: 'group', tabindex: '0', 'aria-label': 'Diff' },
      ...(rows.length ? rows : [h('div', { class: 'hud-diff__line', text: 'No text changed.' })])),
    hunk.cut ? h('p', { class: 'hud-dialog__note', text: 'Long edit: only its first 4,000 characters are shown.' }) : null);
}

/** What a marker row calls each kind of line it stands for. */
const KIND_WORDS = Object.freeze({ add: 'added', del: 'removed', same: 'unchanged' });

/**
 * Runs of BLANK_RUN_LINES or more lines that show nothing (blank, or only spaces and hidden
 * characters such as no-break spaces or the Braille blank), whatever their kind, which could push
 * the rest of a change out of sight in a small box, become one marker row saying how many there
 * are and what they hold.
 * @param {import('./diff.js').DiffLine[]} lines
 * @returns {(import('./diff.js').DiffLine & { gap?: boolean })[]}
 */
export function collapseBlankRuns(lines) {
  /** @type {(import('./diff.js').DiffLine & { gap?: boolean })[]} */
  const out = [];
  for (let i = 0; i < lines.length; ) {
    let end = i;
    while (end < lines.length && looksBlank(lines[end].text)) end += 1;
    if (end === i) out.push(lines[i++]);
    else {
      const run = lines.slice(i, end);
      if (run.length >= BLANK_RUN_LINES) out.push(gapRow(run));
      else out.push(...run);
      i = end;
    }
  }
  return out;
}

/**
 * The marker row for a run of lines that show nothing. A run of one kind keeps it (its + or −
 * says it); a mixed one counts each kind: ⟨120 blank lines: 80 added, 40 removed⟩.
 * @param {import('./diff.js').DiffLine[]} run
 * @returns {import('./diff.js').DiffLine & { gap: boolean }}
 */
function gapRow(run) {
  const counts = { add: 0, del: 0, same: 0 };
  for (const line of run) counts[line.op] += 1;
  const kinds = /** @type {(keyof typeof counts)[]} */ (Object.keys(counts)).filter((op) => counts[op] > 0);
  const parts = kinds.length > 1 ? kinds.map((op) => `${counts[op]} ${KIND_WORDS[op]}`) : [];
  const text = blankLines(run.length, run.map((line) => line.text).join('\n'), parts);
  return { op: kinds.length === 1 ? kinds[0] : 'same', text, gap: true };
}
