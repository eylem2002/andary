// Fuzzy matching for the command palette (ui/palette.js): every word typed must be found in an
// item's text, as a run of letters ("bill" in "billing-api") or, failing that, as letters in order
// ("bapi" in "billing-api"). Runs, word starts and early matches score higher. Pure, no DOM.

/**
 * @param {string} text
 * @param {number} i
 */
function atWordStart(text, i) {
  return i === 0 || /[\s/\\._:·,()-]/.test(text[i - 1]);
}

/**
 * One typed word against lower-case text: a score, or -1 when it is not there.
 * @param {string} word  lower case, no spaces
 * @param {string} text  lower case
 */
function wordScore(word, text) {
  const at = text.indexOf(word);
  if (at >= 0) {
    let start = at;
    // Prefer an occurrence at a word start ("api" in "billing-api" rather than in "rapid").
    for (let i = at; i >= 0 && i < text.length; i = text.indexOf(word, i + 1)) {
      if (atWordStart(text, i)) {
        start = i;
        break;
      }
    }
    return 100 + word.length * 4 + (start === 0 ? 30 : atWordStart(text, start) ? 20 : 0) - Math.min(start, 40) * 0.25;
  }
  let from = 0;
  let previous = -2;
  let score = 0;
  for (const ch of word) {
    const i = text.indexOf(ch, from);
    if (i < 0) return -1;
    score += 1 + (i === previous + 1 ? 5 : 0) + (atWordStart(text, i) ? 4 : 0);
    previous = i;
    from = i + 1;
  }
  return score;
}

/**
 * How well a query matches a text: higher is better, 0 for an empty query (everything matches),
 * -1 when a word of the query is missing.
 * @param {string} query
 * @param {string} text
 */
export function fuzzyScore(query, text) {
  const words = String(query ?? '').toLowerCase().split(/\s+/).filter(Boolean);
  const haystack = String(text ?? '').toLowerCase();
  let total = 0;
  for (const word of words) {
    const score = wordScore(word, haystack);
    if (score < 0) return -1;
    total += score;
  }
  return total;
}

/**
 * The items matching a query, best first; equal scores keep the items' own order. An empty
 * query keeps them all, in order.
 * @template T
 * @param {string} query
 * @param {readonly T[]} items
 * @param {(item: T) => string} textOf
 * @param {number} [limit]
 * @returns {T[]}
 */
export function rankMatches(query, items, textOf, limit = Infinity) {
  const scored = [];
  for (const [index, item] of items.entries()) {
    const score = fuzzyScore(query, textOf(item));
    if (score >= 0) scored.push({ item, score, index });
  }
  scored.sort((a, b) => b.score - a.score || a.index - b.index);
  return scored.slice(0, limit).map((entry) => entry.item);
}
