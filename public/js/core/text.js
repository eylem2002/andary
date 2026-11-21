// Small defensive readers and text helpers for hook data (CONTRACTS §5): values from sessions
// working in untrusted repositories may be any shape, so every reader here accepts anything and
// never throws. Shared by the event normaliser, the summaries, the store, the director and humour.
// Tables are plain objects, so lookups go through own() to keep a tool named "constructor" or
// "__proto__" from reaching Object.prototype.

/**
 * A table's own entry for a key from hook data. Inherited keys are ignored, so a tool or event
 * named "constructor" or "__proto__" cannot reach Object.prototype.
 * @template T
 * @param {Readonly<Record<string, T>>} table
 * @param {unknown} key
 * @returns {T|undefined}
 */
export function own(table, key) {
  return typeof key === 'string' && Object.hasOwn(table, key) ? table[key] : undefined;
}

/**
 * @param {unknown} value
 * @returns {value is Record<string, any>}
 */
export function isObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** @param {unknown} value  strings pass through, finite numbers are stringified, the rest is '' */
export function str(value) {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return '';
}

/** @param {unknown} value */
export function finite(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/** @param {unknown} value  collapses whitespace so a value fits on one line of a bubble or log row */
export function oneLine(value) {
  return str(value).replace(/\s+/g, ' ').trim();
}

/**
 * Cuts text to `max` characters, ending in an ellipsis when cut.
 * @param {unknown} text
 * @param {number} max
 */
export function clip(text, max) {
  const s = str(text);
  return s.length > max ? `${s.slice(0, Math.max(0, max - 1)).trimEnd()}…` : s;
}

/**
 * Text from a string, an array of content blocks ([{type: 'text', text}]) or a structured
 * message ({type: 'shutdown_request', …}); payload fields like these vary between versions.
 * @param {unknown} value
 * @param {number} [depth]
 * @returns {string}
 */
export function textOf(value, depth = 0) {
  if (typeof value === 'string') return value;
  if (value == null || depth > 3) return '';
  if (Array.isArray(value)) return value.map((item) => textOf(item, depth + 1)).filter(Boolean).join('\n');
  if (!isObject(value)) return str(value);
  for (const key of ['text', 'content', 'message', 'summary']) {
    const text = textOf(value[key], depth + 1);
    if (text) return text;
  }
  // A structured message such as {type: 'shutdown_request'} is best described by its type.
  return typeof value.type === 'string' && !('text' in value) ? value.type.replace(/_/g, ' ') : '';
}

/** @param {unknown} value */
export function listOf(value) {
  return Array.isArray(value) ? value : [];
}

// ---------------------------------------------------------------------------------------------
// Paths, commands and URLs, shortened for bubbles, the log and the inspector.

const HOME_PREFIX = /^(?:[A-Za-z]:)?\/(?:home|Users)\/[^/]+(?=\/|$)/;

/**
 * A path relative to the session's cwd (or "~/…" under a home folder), without clipping.
 * @param {unknown} path
 * @param {unknown} [cwd]
 */
export function relativePath(path, cwd = '') {
  const p = str(path).trim().replace(/\\/g, '/');
  if (!p) return '';
  const base = str(cwd).trim().replace(/\\/g, '/').replace(/\/+$/, '');
  if (base && p === base) return '.';
  if (base && p.startsWith(`${base}/`)) return p.slice(base.length + 1);
  return p.replace(HOME_PREFIX, '~');
}

/**
 * Like relativePath, then shortened to its last segments so it fits in a speech bubble.
 * @param {unknown} path
 * @param {unknown} [cwd]
 * @param {number} [max]
 */
export function shortPath(path, cwd = '', max = 44) {
  const rel = relativePath(path, cwd);
  if (rel.length <= max) return rel;
  const parts = rel.split('/').filter(Boolean);
  const tail = parts.slice(-2).join('/');
  if (tail.length + 2 <= max) return `…/${tail}`;
  const last = parts[parts.length - 1] ?? rel;
  return last.length + 2 <= max ? `…/${last}` : `…${last.slice(-(max - 1))}`;
}

/**
 * First line of a shell command, without a leading "cd somewhere &&", at most `max` chars.
 * @param {unknown} command
 * @param {number} [max]
 */
export function shortCommand(command, max = 60) {
  const lines = str(command).trim().split('\n');
  let first = oneLine(lines[0]).replace(/^cd\s+\S+\s*&&\s*/, '');
  if (lines.length > 1) first += ' …';
  return clip(first, max);
}

/**
 * "host/path" of a URL; anything unparsable is just clipped.
 * @param {unknown} url
 * @param {number} [max]
 */
export function hostPath(url, max = 50) {
  const raw = oneLine(url);
  if (!raw) return '';
  try {
    const parsed = new URL(raw);
    return clip(parsed.host + parsed.pathname.replace(/\/+$/, ''), max);
  } catch {
    return clip(raw, max);
  }
}

/** @param {unknown} url */
export function hostOf(url) {
  try {
    return new URL(oneLine(url)).host;
  } catch {
    return '';
  }
}

/** Shell words that need no quotes. */
const PLAIN_WORD = /^[\w@%+=:,./-]+$/;

/**
 * A shell command as one line. An argument list (Codex may send one) is joined with each argument
 * quoted the way a shell would need it, so ['rm', 'a b'] and ['rm', 'a', 'b'] never read the same.
 * @param {unknown} command
 * @returns {string}
 */
export function shellWords(command) {
  if (!Array.isArray(command)) return typeof command === 'string' ? command : String(command ?? '');
  return command.map((word) => {
    const text = String(word);
    return PLAIN_WORD.test(text) ? text : `'${text.replaceAll("'", `'\\''`)}'`;
  }).join(' ');
}

/** @param {unknown} text @param {number} [max] */
export function quoted(text, max = 32) {
  return `"${clip(oneLine(text), max)}"`;
}

// ---------------------------------------------------------------------------------------------
// Hidden characters, for text judged by eye: the approval card shows a request as the agent will
// receive it, so nothing in it may hide or push the rest out of view.

/**
 * Characters that change how text looks without being seen: controls, format characters
 * (bidirectional overrides and isolates, "Trojan Source"; zero-width characters; Unicode tags),
 * private-use characters (whatever a font draws for them), line and paragraph separators, spaces,
 * every default-ignorable code point, assigned or not (browsers draw an unassigned one, such as
 * U+2065 or U+E0080, with no width), and characters that draw nothing though Unicode gives them a
 * glyph (the Khitan filler, the Braille blank; the Hangul fillers and the tags are
 * default-ignorable too, but named). The combining ones that draw nothing (variation selectors,
 * the combining grapheme joiner, the Mongolian free variation selectors, the Khmer inherent
 * vowels) come with Default_Ignorable_Code_Point: named in a class after another character, they
 * would read as joined to it, which is why the Khitan filler, a combining mark, is named first.
 * One class, so a long run of them is read one way only and costs no backtracking. The plain
 * space, tab and newline are left out where they are no secret.
 */
const UNSEEN_CHARS = String.raw`\u{16FE4}\p{Cc}\p{Cf}\p{Co}\p{Z}\p{Default_Ignorable_Code_Point}\u115F\u1160\u2800\u3164\uFFA0\u{E0000}-\u{E007F}`;
const UNSEEN = `[${UNSEEN_CHARS}]`;
/** One hidden character: any of those but the plain space, the tab and the newline. */
const HIDDEN = String.raw`(?![\t\n ])${UNSEEN}`;
/** Every hidden character. */
const HIDDEN_CHAR = new RegExp(HIDDEN, 'gu');
/** A combining mark that draws (the hidden ones, such as variation selectors, are HIDDEN). */
const MARK = String.raw`(?!${UNSEEN})\p{M}`;
/** Whether text holds a combining mark. */
const HAS_MARK = /\p{M}/u;
/** More combining marks on one base than any script needs: a stack that paints over other lines. */
const MAX_MARKS = 3;
/**
 * What revealHidden marks: a run of hidden characters (group 1), or a stack of combining marks.
 * The two start with different characters, so neither can take the other's place.
 */
const UNSEEN_RUN = new RegExp(`((?:${HIDDEN})+)|(?:${MARK}){${MAX_MARKS + 1},}`, 'gu');
/**
 * Characters other than the newline that some readers take for a line break: U+2028 and U+2029
 * end a line in JavaScript and in Python's str.splitlines(); NEL (U+0085) in splitlines() and in
 * some editors, not in JavaScript. Their marker breaks the line too.
 */
const LINE_BREAK = /[\u0085\u2028\u2029]/u;
/**
 * A carriage return that is not part of a CRLF, nor the last character of its line or text: it
 * ends a line in JavaScript, in Python source and in most editors, so its marker breaks the line.
 */
const LONE_CR = /\r(?!$)/u;
/**
 * One character of a line that shows nothing: a space, a tab, a hidden character or a combining
 * mark (on such a line it has nothing to sit on that shows). One class: no backtracking.
 */
const BLANK_CHAR = String.raw`(?:(?!\n)[${UNSEEN_CHARS}\p{M}])`;
/** A line that shows nothing. */
const BLANK_LINE = new RegExp(String.raw`^${BLANK_CHAR}*$`, 'u');
/** Lines that show nothing in a row, from this many on, become one marker line. */
export const BLANK_RUN_LINES = 3;
/** BLANK_RUN_LINES or more lines in a row that show nothing, with the line breaks around them. */
const BLANK_RUN = new RegExp(String.raw`\n(?:${BLANK_CHAR}*\n){${BLANK_RUN_LINES},}`, 'gu');
/** At most this many characters are named in a marker; the rest are counted. */
const MAX_NAMES = 3;

/** @param {string} ch @returns {string} */
const codeOf = (ch) => `U+${(ch.codePointAt(0) ?? 0).toString(16).toUpperCase().padStart(4, '0')}`;

/**
 * The code points of the distinct characters in `chars`, in order: at most MAX_NAMES, then
 * "N more".
 * @param {Iterable<string>} chars
 * @returns {string[]}
 */
function namesOf(chars) {
  const codes = [...new Set(chars)].map(codeOf);
  return codes.length > MAX_NAMES ? [...codes.slice(0, MAX_NAMES), `${codes.length - MAX_NAMES} more`] : codes;
}

/** How many code points `text` holds. @param {string} text */
function codePoints(text) {
  let count = 0;
  for (const _ of text) count += 1;
  return count;
}

/** "a", "a and b", "a, b and c". @param {string[]} items */
function sentence(items) {
  return items.length <= 1 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

/**
 * Whether a line shows nothing (only spaces, tabs, hidden characters and combining marks), so
 * that a run of such lines is collapsed where text is judged by eye (see blankLines).
 * @param {string} line
 */
export function looksBlank(line) {
  return BLANK_LINE.test(line);
}

/**
 * The one marker line that stands for `count` lines that show nothing, naming the hidden
 * characters they hold (to a shell a line of no-break spaces is a word, not a blank), and any
 * combining marks, and, after a colon, any `parts` the caller counts ("80 added", "40 removed").
 * @param {number} count
 * @param {string} text  those lines
 * @param {string[]} [parts]
 * @returns {string}
 */
export function blankLines(count, text, parts = []) {
  const named = namesOf(Array.from(text.matchAll(HIDDEN_CHAR), ([ch]) => ch));
  if (HAS_MARK.test(text.replace(HIDDEN_CHAR, ''))) named.push('combining marks');
  const held = named.length ? ` with ${sentence(named)}` : '';
  return `⟨${count} blank lines${held}${parts.length ? `: ${parts.join(', ')}` : ''}⟩`;
}

/**
 * The marker for a run of hidden characters: the ones it holds and its length (⟨U+00A0 ×1900⟩,
 * ⟨U+00A0 U+3000 ×2000⟩), followed by a line break when the run holds one that a reader may take
 * for a line break (LINE_BREAK, LONE_CR), so the lines you read are the lines it reads.
 * @param {string} run
 * @param {string} next  the character after the run ('' at the end of the text)
 * @returns {string}
 */
function hiddenMarker(run, next) {
  const count = codePoints(run);
  const marker = `⟨${namesOf(run).join(' ')}${count > 1 ? ` ×${count}` : ''}⟩`;
  const lone = LONE_CR.test(run) || (run.endsWith('\r') && next !== '' && next !== '\n');
  return lone || LINE_BREAK.test(run) ? `${marker}\n` : marker;
}

/**
 * Makes text safe to judge by eye: runs of lines that show nothing (which can push the end of a
 * command out of view) are collapsed into one marker line, every run of hidden characters becomes
 * one visible marker such as ⟨U+202E⟩ or ⟨U+00A0 ×1900⟩ (breaking the line after one that a
 * reader takes for a line break), and a stack of more than three combining marks on one base,
 * which paints over the lines around it, becomes ⟨N combining marks⟩. Used where the viewer
 * approves exactly what they read. Linear in the text's length.
 * @param {unknown} text
 * @returns {string}
 */
export function revealHidden(text) {
  return String(text ?? '')
    .replace(BLANK_RUN, (run) => `\n${blankLines(run.split('\n').length - 2, run)}\n`)
    .replace(UNSEEN_RUN, (run, hidden, offset, whole) => (hidden ? hiddenMarker(run, whole.charAt(offset + run.length)) : `⟨${codePoints(run)} combining marks⟩`));
}
