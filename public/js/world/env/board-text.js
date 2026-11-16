// Text layout for the Goal Board: wraps task text into lines that fit the board, caps each item at
// two lines and the board at a line budget, and summarises progress. Pure: the caller passes a
// `measure(text) => width` function (a canvas context in the browser, character counts in tests).

/** @typedef {'pending'|'in_progress'|'completed'} BoardStatus */
/** @typedef {{text: string, status: BoardStatus}} BoardItem */
/**
 * @typedef {object} BoardRow
 * @property {BoardStatus} status
 * @property {string[]} lines
 */
/**
 * @typedef {object} BoardLayout
 * @property {string} title
 * @property {string} summary   e.g. "2 of 5 done"
 * @property {BoardRow[]} rows
 * @property {number} more      items that did not fit
 */

const STATUSES = new Set(['pending', 'in_progress', 'completed']);
const MAX_TEXT = 240;

/**
 * Collapses whitespace and strips control characters from untrusted task text.
 * @param {unknown} text
 */
export function cleanText(text) {
  if (typeof text !== 'string') return '';
  let out = '';
  for (const ch of text.slice(0, MAX_TEXT * 2)) {
    const code = ch.codePointAt(0) ?? 0;
    out += code < 32 || (code >= 127 && code < 160) ? ' ' : ch;
  }
  return out.replace(/\s+/g, ' ').trim().slice(0, MAX_TEXT);
}

/**
 * Greedy word wrap. Words longer than a line are split by character.
 * @param {string} text
 * @param {number} maxWidth
 * @param {(s: string) => number} measure
 * @returns {string[]}
 */
export function wrapText(text, maxWidth, measure) {
  const words = cleanText(text).split(' ').filter(Boolean);
  /** @type {string[]} */
  const lines = [];
  let line = '';
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (measure(candidate) <= maxWidth) {
      line = candidate;
      continue;
    }
    if (line) lines.push(line);
    const pieces = splitLongWord(word, maxWidth, measure);
    lines.push(...pieces.slice(0, -1));
    line = pieces[pieces.length - 1];
  }
  if (line) lines.push(line);
  return lines;
}

/**
 * @param {string} word
 * @param {number} maxWidth
 * @param {(s: string) => number} measure
 * @returns {string[]} pieces; every piece but the last fills a line
 */
function splitLongWord(word, maxWidth, measure) {
  if (measure(word) <= maxWidth) return [word];
  /** @type {string[]} */
  const pieces = [];
  let piece = '';
  for (const ch of word) {
    if (piece && measure(piece + ch) > maxWidth) {
      pieces.push(piece);
      piece = '';
    }
    piece += ch;
  }
  pieces.push(piece);
  return pieces;
}

/**
 * Cuts lines to a maximum count, ending the last kept line with an ellipsis that still fits.
 * @param {string[]} lines
 * @param {number} maxLines
 * @param {number} maxWidth
 * @param {(s: string) => number} measure
 */
export function clampLines(lines, maxLines, maxWidth, measure) {
  if (lines.length <= maxLines) return lines;
  const kept = lines.slice(0, maxLines);
  let last = kept[maxLines - 1];
  while (last.length > 0 && measure(`${last}…`) > maxWidth) last = last.slice(0, -1).trimEnd();
  kept[maxLines - 1] = `${last}…`;
  return kept;
}

/**
 * Lays out the board: rows in the given order, each up to `linesPerItem` lines, until the line
 * budget runs out (one line is kept free for "+N more" when needed).
 * @param {BoardItem[]} items
 * @param {{title?: string, maxWidth: number, maxLines: number, linesPerItem?: number, measure: (s: string) => number}} opts
 * @returns {BoardLayout}
 */
export function layoutBoard(items, opts) {
  const list = Array.isArray(items) ? items.filter((it) => it && cleanText(it.text)) : [];
  const done = list.filter((it) => it.status === 'completed').length;
  const linesPerItem = opts.linesPerItem ?? 2;
  /** @type {BoardRow[]} */
  const rows = [];
  let used = 0;
  for (let i = 0; i < list.length; i++) {
    const status = STATUSES.has(list[i].status) ? list[i].status : 'pending';
    const wrapped = clampLines(wrapText(list[i].text, opts.maxWidth, opts.measure), linesPerItem, opts.maxWidth, opts.measure);
    const remainingAfter = list.length - i - 1;
    const budget = opts.maxLines - (remainingAfter > 0 ? 1 : 0);
    if (used + wrapped.length > budget) break;
    rows.push({ status, lines: wrapped });
    used += wrapped.length;
  }
  return {
    title: cleanText(opts.title) || 'Goals',
    summary: list.length ? `${done} of ${list.length} done` : 'No goals yet',
    rows,
    more: list.length - rows.length,
  };
}
