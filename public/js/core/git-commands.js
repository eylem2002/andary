// Git commands that put other agents' uncommitted work at risk (docs/design/agent-health.md §6),
// read from the command line an agent runs (Bash or PowerShell): commands that sweep every change
// into a commit, and commands that throw changes away. core/conflicts.js decides whose work that
// is. Nothing is run, so aliases, scripts, `sh -c`, `eval` and variables are not followed. Pure and
// defensive: any input, bounded work, never throws.
//
// Recognised (the first one on a line counts):
//   git add -A | --all | -u | --update | . | :/ | *   and a git commit later on the same line
//   git commit -a | --all                              also grouped (-am)
//   git stash, git stash push | save                   not list, show, pop, apply, drop, clear…
//   git checkout . | -- <path>… | -f | --force         not a branch: git checkout main
//   git switch --discard-changes | -f | --force
//   git restore <path>…                                not --staged alone (the index only)
//   git reset --hard
//   git clean -f… | --force                            not with -n or --dry-run
// The line is split at &&, ||, ;, |, &, newlines and parentheses outside quotes. `cd <dir>` (or
// pushd, chdir, Set-Location) and `git -C <dir>` move the folder for what follows; quotes,
// backslashes, comments, redirections (2>&1, > file), $(…) and here-document bodies are read as a
// shell reads them, so a commit message that mentions a command is not that command. Variables,
// shell keywords (then, do…) and plain wrappers (sudo, env, time…) before a command are skipped.
import { normalizePath } from './paths.js';
import { clip, own, shellWords } from './text.js';

/**
 * @typedef {object} GitHazard
 * @property {string} command  what was recognised, in a few words: "git stash", "git add -A && git commit"
 * @property {string} folder   the folder it runs in, absolute and normalised (core/paths.js)
 */

/** Longest command line read: the server cuts strings at 2,000 characters; a replay may not. */
const MAX_CHARS = 20_000;
/** A recognised command's words are cut here (a path after `git checkout --` can be long). */
const LABEL_CHARS = 60;
/** Characters that end a simple command outside quotes. */
const SEPARATORS = new Set([';', '&', '|', '(', ')']);
/** Commands that change the folder for the rest of the line (PowerShell's too). */
const CD_COMMANDS = new Set(['cd', 'pushd', 'chdir', 'set-location']);
/** `NAME=value` before a command sets a variable for it. */
const ASSIGNMENT = /^[A-Za-z_]\w*=/;
/** Words that may stand before a command: shell keywords, and wrappers that run what follows. */
const PREFIXES = new Set(['if', 'then', 'else', 'elif', 'do', 'while', 'until', '!', 'sudo', 'env', 'command', 'exec', 'nohup', 'time']);
/** git's options before the subcommand that take the next word as their value. */
const GIT_VALUE_OPTIONS = new Set(['-c', '--git-dir', '--work-tree', '--namespace', '--super-prefix', '--config-env']);
/** Pathspecs that mean everything in the folder. */
const WHOLE_TREE = new Set(['.', './', ':/', ':/:', '*']);
/** Inside double quotes a bash backslash escapes only these; elsewhere it stays. */
const DOUBLE_ESCAPES = new Set(['$', '`', '"', '\\', '\n']);

// ---------------------------------------------------------------------------------------------
// The command line as words.

/**
 * @typedef {object} Lexer
 * @property {string} text
 * @property {number} at
 * @property {string} escape     the escape character: \ in bash, ` in PowerShell
 * @property {string[][]} commands
 * @property {string[]} words
 * @property {string} word
 * @property {boolean} open      a word has started (it may be empty: "")
 * @property {boolean} quoted    it holds quotes or escapes, so it is no file descriptor
 * @property {boolean} target    it is a redirection's target: dropped
 * @property {HereDoc[]} docs    here-documents whose bodies follow this line
 */

/** @typedef {{ delimiter: string, tabs: boolean, end: number }} HereDoc */

/**
 * A command line as its simple commands, each a list of words, in order. Quotes and escapes are
 * removed as the shell would; redirections, comments and here-document bodies are left out.
 * @param {unknown} command  a string, or a list of arguments (Codex)
 * @param {{ powershell?: boolean }} [options]  PowerShell: backslashes are path separators, ` escapes
 * @returns {string[][]}
 */
export function shellCommands(command, { powershell = false } = {}) {
  try {
    const text = (Array.isArray(command) ? shellWords(command) : typeof command === 'string' ? command : '').slice(0, MAX_CHARS);
    /** @type {Lexer} */
    const lx = { text, at: 0, escape: powershell ? '`' : '\\', commands: [], words: [], word: '', open: false, quoted: false, target: false, docs: [] };
    while (lx.at < text.length) step(lx);
    endCommand(lx);
    return lx.commands;
  } catch {
    return [];
  }
}

/** Reads one character, or one quoted string, substitution or operator. @param {Lexer} lx */
function step(lx) {
  const c = lx.text[lx.at];
  if (c === lx.escape) return escaped(lx);
  if (c === "'") return singleQuoted(lx);
  if (c === '"') return doubleQuoted(lx);
  if (c === '$' && lx.text[lx.at + 1] === '(') return append(lx, lx.text.slice(lx.at, substitutionEnd(lx.text, lx.at + 2, lx.escape)), false);
  if (c === '`') return append(lx, lx.text.slice(lx.at, closing(lx.text, lx.at + 1, '`')), false);
  if (c === ' ' || c === '\t' || c === '\r') return space(lx);
  if (c === '\n') return newline(lx);
  if (c === '#' && !lx.open) return comment(lx);
  if (c === '>' || c === '<' || (c === '&' && lx.text[lx.at + 1] === '>')) return redirection(lx);
  if (SEPARATORS.has(c)) {
    endCommand(lx);
    lx.at += 1;
    return;
  }
  append(lx, c, false);
}

/**
 * Adds text to the word being read and moves past it.
 * @param {Lexer} lx @param {string} raw  the source text it came from @param {boolean} quoted
 * @param {string} [value]  what it means, when not the text itself
 */
function append(lx, raw, quoted, value = raw) {
  lx.word += value;
  lx.open = true;
  lx.quoted ||= quoted;
  lx.at += raw.length;
}

/** @param {Lexer} lx */
function escaped(lx) {
  const next = lx.text[lx.at + 1] ?? '';
  // A backslash at the end of a line joins the next one.
  if (next === '\n') lx.at += 2;
  else append(lx, `${lx.escape}${next}`, true, next);
}

/** @param {Lexer} lx */
function singleQuoted(lx) {
  const close = lx.text.indexOf("'", lx.at + 1);
  // An unclosed quote runs to the end of the line, as far as this reading goes.
  const end = close < 0 ? lx.text.length : close;
  append(lx, lx.text.slice(lx.at, close < 0 ? end : end + 1), true, lx.text.slice(lx.at + 1, end));
}

/** @param {Lexer} lx */
function doubleQuoted(lx) {
  const { value, end } = readDouble(lx.text, lx.at + 1, lx.escape);
  append(lx, lx.text.slice(lx.at, end), true, value);
}

/** @param {Lexer} lx */
function space(lx) {
  endWord(lx);
  lx.at += 1;
}

/** The end of a line ends a command; the bodies of its here-documents follow it. @param {Lexer} lx */
function newline(lx) {
  endCommand(lx);
  lx.at = skipBodies(lx.text, lx.at + 1, lx.docs.splice(0));
}

/** @param {Lexer} lx */
function comment(lx) {
  const end = lx.text.indexOf('\n', lx.at);
  lx.at = end < 0 ? lx.text.length : end;
}

/**
 * A redirection (`> file`, `2>&1`, `<<EOF`): left out of the words, with its target. Digits just
 * before it name the file descriptor it redirects (2>), so they are no argument either.
 * @param {Lexer} lx
 */
function redirection(lx) {
  if (lx.open && !lx.quoted && /^\d+$/.test(lx.word)) {
    lx.word = '';
    lx.open = false;
  } else {
    endWord(lx);
  }
  const { text } = lx;
  const doc = text.startsWith('<<', lx.at) && text[lx.at + 2] !== '<' ? hereDocAt(text, lx.at) : null;
  if (doc) {
    lx.docs.push(doc);
    lx.at = doc.end;
    return;
  }
  let i = lx.at + 1;
  while (i < text.length && '<>|&'.includes(text[i])) i += 1;
  // `>&2`, `2>&1`, `>&-`: into another descriptor, so no file follows.
  if (text[i - 1] === '&' && /[\d-]/.test(text[i] ?? '')) {
    while (/[\d-]/.test(text[i] ?? '')) i += 1;
  } else {
    lx.target = true;
  }
  lx.at = i;
}

/** @param {Lexer} lx */
function endWord(lx) {
  if (lx.open && lx.target) lx.target = false;
  else if (lx.open) lx.words.push(lx.word);
  lx.word = '';
  lx.open = false;
  lx.quoted = false;
}

/** @param {Lexer} lx */
function endCommand(lx) {
  endWord(lx);
  // `{ …; }` groups commands: the braces are words of their own.
  const words = lx.words.filter((word) => word !== '{' && word !== '}');
  if (words.length) lx.commands.push(words);
  lx.words = [];
  lx.target = false;
}

/**
 * The index after the quote that closes one opened before `from` (or the end of the text).
 * @param {string} text @param {number} from @param {string} quote
 */
function closing(text, from, quote) {
  const end = text.indexOf(quote, from);
  return end < 0 ? text.length : end + 1;
}

/**
 * A double-quoted string from just after its opening quote: what it means, and the index after
 * its closing quote. A $(…) inside it may hold quotes of its own.
 * @param {string} text @param {number} from @param {string} escape
 * @returns {{ value: string, end: number }}
 */
function readDouble(text, from, escape) {
  let value = '';
  let i = from;
  while (i < text.length && text[i] !== '"') {
    const next = text[i + 1] ?? '';
    if (text[i] === escape && (escape === '`' || DOUBLE_ESCAPES.has(next))) {
      value += next;
      i += 2;
    } else if (text[i] === '$' && next === '(') {
      const end = substitutionEnd(text, i + 2, escape);
      value += text.slice(i, end);
      i = end;
    } else {
      value += text[i];
      i += 1;
    }
  }
  return { value, end: Math.min(i + 1, text.length) };
}

/**
 * The index after the `)` that closes a $( opened just before `from`. Quotes, nested $(…) and
 * here-documents inside it are skipped whole: Claude Code writes commit messages that way, as
 * `git commit -m "$(cat <<'EOF' … EOF)"`, and a message may hold anything.
 * @param {string} text @param {number} from @param {string} escape
 */
function substitutionEnd(text, from, escape) {
  let depth = 1;
  /** @type {HereDoc[]} */
  const docs = [];
  let i = from;
  while (i < text.length) {
    const c = text[i];
    const doc = c === '<' && text.startsWith('<<', i) && text[i + 2] !== '<' ? hereDocAt(text, i) : null;
    if (c === escape) i += 2;
    else if (c === "'") i = closing(text, i + 1, "'");
    else if (c === '"') i = readDouble(text, i + 1, escape).end;
    else if (doc) {
      docs.push(doc);
      i = doc.end;
    } else if (c === '\n' && docs.length) i = skipBodies(text, i + 1, docs.splice(0));
    else if (c === '(' || c === ')') {
      depth += c === '(' ? 1 : -1;
      i += 1;
      if (depth === 0) return i;
    } else i += 1;
  }
  return text.length;
}

/** `<<EOF`, `<<-EOF`, `<<'EOF'`, `<< "EOF"`: the delimiter that ends the body, and the index after it. */
const HERE_DOC = /^<<(-?)[ \t]*(?:'([^'\n]*)'|"([^"\n]*)"|\\?([^\s;&|()<>'"]+))/;

/** @param {string} text @param {number} at  where its `<<` is @returns {HereDoc|null} */
function hereDocAt(text, at) {
  const match = HERE_DOC.exec(text.slice(at, at + 200));
  if (!match) return null;
  return { delimiter: match[2] ?? match[3] ?? match[4], tabs: match[1] === '-', end: at + match[0].length };
}

/**
 * Skips the bodies of here-documents, in order, from the start of the line after their command.
 * @param {string} text @param {number} from @param {HereDoc[]} docs
 * @returns {number} where the line after the last body starts
 */
function skipBodies(text, from, docs) {
  let at = from;
  for (const doc of docs) {
    while (at < text.length) {
      const end = text.indexOf('\n', at);
      const stop = end < 0 ? text.length : end;
      const line = text.slice(at, stop).replace(/\r$/, '');
      at = stop + 1;
      if ((doc.tabs ? line.replace(/^\t+/, '') : line) === doc.delimiter) break;
    }
  }
  return Math.min(at, text.length);
}

// ---------------------------------------------------------------------------------------------
// The commands among them.

/**
 * The first git command on a line that sweeps up or throws away uncommitted changes, and the
 * folder it runs in, or null. The folder starts as the hook's and follows `cd` and `git -C`; once
 * it cannot be told (`cd ~`, `cd $DIR`), commands after it are not judged.
 * @param {unknown} command  the shell tool's command line
 * @param {unknown} folder   the hook's folder (cwd)
 * @param {{ powershell?: boolean }} [options]
 * @returns {GitHazard|null}
 */
export function gitHazardOf(command, folder, options = {}) {
  let where = normalizePath(folder) || null;
  /** @type {string|null} the words of a `git add` of the whole tree earlier on the line */
  let staged = null;
  for (const raw of shellCommands(command, options)) {
    // `then git …`, `sudo git …`, `NAME=value git …`: the command is the word after those.
    const start = raw.findIndex((word) => !ASSIGNMENT.test(word) && !PREFIXES.has(word));
    if (start < 0) continue;
    const words = raw.slice(start);
    if (CD_COMMANDS.has(words[0].toLowerCase())) {
      where = moveTo(where, words.slice(1).find((word) => !word.startsWith('-')));
      continue;
    }
    const git = gitCall(words, where);
    if (!git) continue;
    const found = recognise(git, staged);
    if (found) return { command: clip(found, LABEL_CHARS), folder: git.folder };
    if (git.sub === 'add') staged = wholeTreeAdd(git.args) ?? staged;
  }
  return null;
}

/**
 * The folder after a `cd` (or `git -C`) to `target`, or null when it cannot be told.
 * @param {string|null} where @param {string|undefined} target
 */
function moveTo(where, target) {
  if (!target || target === '-') return null;
  return normalizePath(target, where ?? '') || null;
}

/** @param {string} word */
function isGit(word) {
  const name = word.split(/[/\\]/).pop()?.toLowerCase();
  return name === 'git' || name === 'git.exe';
}

/**
 * A git call: its folder (after -C), subcommand and arguments; null for another command, or a
 * git call whose folder cannot be told.
 * @param {string[]} words @param {string|null} where
 * @returns {{ folder: string, sub: string, args: string[] }|null}
 */
function gitCall(words, where) {
  if (!isGit(words[0])) return null;
  let folder = where;
  let i = 1;
  for (; i < words.length && words[i].startsWith('-'); i += 1) {
    if (words[i] === '-C') folder = moveTo(folder, words[++i]);
    else if (GIT_VALUE_OPTIONS.has(words[i])) i += 1;
  }
  const sub = words[i];
  return sub && folder ? { folder, sub, args: words.slice(i + 1) } : null;
}

/** @type {Readonly<Record<string, (args: string[]) => string|null>>} */
const RULES = Object.freeze({
  commit: (args) => (commitsAll(args) ? 'git commit -a' : null),
  stash: (args) => (stashes(args) ? 'git stash' : null),
  checkout: discardsByCheckout,
  switch: (args) => (discardsBySwitch(args) ? 'git switch --discard-changes' : null),
  restore: restores,
  reset: (args) => (parse(args).long.has('hard') ? 'git reset --hard' : null),
  clean: cleans,
});

/**
 * What a git call does to uncommitted work, in a few words, or null.
 * @param {{ sub: string, args: string[] }} git
 * @param {string|null} staged  a whole-tree `git add` earlier on the line
 */
function recognise(git, staged) {
  if (git.sub === 'commit' && staged && !commitOptions(git.args).long.has('dry-run')) return `git add ${staged} && git commit`;
  return own(RULES, git.sub)?.(git.args) ?? null;
}

/**
 * @typedef {object} Parsed  a subcommand's arguments as git reads them
 * @property {Set<string>} short    short options, also from groups (-am: a and m)
 * @property {Set<string>} long     long options, without -- and =value
 * @property {string[]} operands    other words before --
 * @property {string[]} paths       the words after --
 */

/**
 * Reads a subcommand's arguments: short options may be grouped (-am), and an option that takes a
 * value takes the rest of its group or the next word (-m "-a" is a message); `--` ends options.
 * @param {string[]} args
 * @param {string} [valued]  short options that take a value
 * @param {readonly string[]} [valuedLong]  long options that take the next word when no = is given
 * @returns {Parsed}
 */
function parse(args, valued = '', valuedLong = []) {
  /** @type {Parsed} */
  const parsed = { short: new Set(), long: new Set(), operands: [], paths: [] };
  let dashes = false;
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (dashes) parsed.paths.push(arg);
    else if (arg === '--') dashes = true;
    else if (arg.startsWith('--')) {
      const [name] = arg.slice(2).split('=');
      parsed.long.add(name);
      if (!arg.includes('=') && valuedLong.includes(name)) i += 1;
    } else if (arg.startsWith('-') && arg.length > 1) i += shortGroup(arg, valued, parsed.short);
    else parsed.operands.push(arg);
  }
  return parsed;
}

/**
 * Reads a group of short options; returns 1 when its last one takes the next word as its value.
 * @param {string} arg @param {string} valued @param {Set<string>} short
 */
function shortGroup(arg, valued, short) {
  for (let j = 1; j < arg.length; j += 1) {
    short.add(arg[j]);
    if (valued.includes(arg[j])) return j === arg.length - 1 ? 1 : 0;
  }
  return 0;
}

const COMMIT_VALUED_LONG = Object.freeze(['message', 'file', 'reuse-message', 'reedit-message', 'fixup', 'squash', 'author', 'date', 'template', 'cleanup', 'trailer']);

/** @param {string[]} args */
function commitOptions(args) {
  return parse(args, 'mFCct', COMMIT_VALUED_LONG);
}

/** `git commit -a`: every change to a tracked file, whoever made it. @param {string[]} args */
function commitsAll(args) {
  const o = commitOptions(args);
  return (o.short.has('a') || o.long.has('all')) && !o.long.has('dry-run');
}

/**
 * A `git add` that stages the whole folder: its pathspec or option as written ("-A", "."), or null.
 * @param {string[]} args
 */
function wholeTreeAdd(args) {
  const o = parse(args, '', ['chmod', 'pathspec-from-file']);
  if (o.short.has('n') || o.long.has('dry-run')) return null;
  const pathspecs = [...o.operands, ...o.paths];
  const whole = pathspecs.find((spec) => WHOLE_TREE.has(spec));
  if (whole) return whole;
  if (pathspecs.length) return null;
  if (o.short.has('A')) return '-A';
  if (o.long.has('all')) return '--all';
  if (o.short.has('u')) return '-u';
  return o.long.has('update') ? '--update' : null;
}

/**
 * `git stash` (push, save) takes every change out of the work tree. Its other subcommands (list,
 * show, pop, apply, drop, clear…) do not, and git refuses a word it does not know.
 * @param {string[]} args
 */
function stashes(args) {
  const [sub] = parse(args, 'm', ['message', 'pathspec-from-file']).operands;
  return sub === undefined || sub === 'push' || sub === 'save';
}

/** @param {string[]} args */
function discardsByCheckout(args) {
  const o = parse(args, 'bB', ['orphan', 'conflict', 'pathspec-from-file']);
  if (o.paths.length) return `git checkout -- ${o.paths[0]}`;
  if (o.operands.some((arg) => WHOLE_TREE.has(arg))) return 'git checkout .';
  return o.short.has('f') || o.long.has('force') ? 'git checkout -f' : null;
}

/** @param {string[]} args */
function discardsBySwitch(args) {
  const o = parse(args, 'cC', ['orphan']);
  return o.short.has('f') || o.long.has('force') || o.long.has('discard-changes');
}

/** `git restore` puts files back as committed, unless it only unstages them (--staged). @param {string[]} args */
function restores(args) {
  const o = parse(args, 's', ['source', 'pathspec-from-file']);
  const paths = [...o.operands, ...o.paths];
  const staged = o.short.has('S') || o.long.has('staged');
  const worktree = o.short.has('W') || o.long.has('worktree');
  return paths.length && (worktree || !staged) ? `git restore ${paths[0]}` : null;
}

/** @param {string[]} args */
function cleans(args) {
  const o = parse(args, 'e', ['exclude']);
  const force = o.short.has('f') || o.long.has('force');
  if (!force || o.short.has('n') || o.long.has('dry-run')) return null;
  return `git clean -f${['d', 'x', 'X'].filter((letter) => o.short.has(letter)).join('')}`;
}
