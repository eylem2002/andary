// Line diffs for the inspector's "Changes": what an Edit replaced and what it put in its place.
// A plain longest-common-subsequence over lines; inputs are small (the server cuts strings at
// 2,000 characters), and anything past MAX_LINES per side is compared as one changed block.

/** @typedef {{ op: 'same'|'add'|'del', text: string }} DiffLine */

const MAX_LINES = 400;

/**
 * @param {string} before
 * @param {string} after
 * @param {{ exact?: boolean }} [options]  exact: only a newline ends a line, so a carriage return
 *   stays in its line and an approval card can show it (the file gets it, not a line break)
 * @returns {DiffLine[]}
 */
export function lineDiff(before, after, { exact = false } = {}) {
  const a = splitLines(before, exact);
  const b = splitLines(after, exact);
  if (a.length > MAX_LINES || b.length > MAX_LINES) {
    return [...a.map((text) => ({ op: /** @type {const} */ ('del'), text })), ...b.map((text) => ({ op: /** @type {const} */ ('add'), text }))];
  }
  // lengths[i][j]: longest common subsequence of a[i..] and b[j..]
  const lengths = Array.from({ length: a.length + 1 }, () => new Uint16Array(b.length + 1));
  for (let i = a.length - 1; i >= 0; i -= 1) {
    for (let j = b.length - 1; j >= 0; j -= 1) {
      lengths[i][j] = a[i] === b[j] ? lengths[i + 1][j + 1] + 1 : Math.max(lengths[i + 1][j], lengths[i][j + 1]);
    }
  }
  /** @type {DiffLine[]} */
  const out = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      out.push({ op: 'same', text: a[i] });
      i += 1;
      j += 1;
    } else if (lengths[i + 1][j] >= lengths[i][j + 1]) {
      out.push({ op: 'del', text: a[i] });
      i += 1;
    } else {
      out.push({ op: 'add', text: b[j] });
      j += 1;
    }
  }
  while (i < a.length) out.push({ op: 'del', text: a[i++] });
  while (j < b.length) out.push({ op: 'add', text: b[j++] });
  return out;
}

/** @param {string} text @param {boolean} exact */
function splitLines(text, exact) {
  if (!text) return [];
  const lines = (exact ? String(text) : String(text).replace(/\r\n?/g, '\n')).split('\n');
  if (lines.at(-1) === '') lines.pop();
  return lines;
}

/**
 * How many lines a change adds and removes, over all its hunks.
 * @param {{ before: string, after: string }[]} hunks
 * @param {{ exact?: boolean }} [options]  as lineDiff's
 */
export function diffStats(hunks, options = {}) {
  let added = 0;
  let removed = 0;
  for (const hunk of hunks) {
    for (const line of lineDiff(hunk.before, hunk.after, options)) {
      if (line.op === 'add') added += 1;
      else if (line.op === 'del') removed += 1;
    }
  }
  return { added, removed };
}
