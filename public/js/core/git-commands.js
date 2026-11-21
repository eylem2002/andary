// Git commands that put other agents' uncommitted work at risk (docs/design/agent-health.md §6),
// read from the command line an agent runs (Bash or PowerShell): commands that sweep changes into
// a commit, whoever made them, and commands that throw changes away. core/conflicts.js decides
// whose work that is. Nothing is run, so aliases, scripts, `eval` and variables are not followed.
// Pure and defensive: any input, bounded work, never throws.
//
// Recognised (the first one on a line counts), each with what it acts on:
//   sweep    git add <pathspec>|-A|-u … and a git commit later on the line, or in a later call
//            (the agent's earlier adds, which core/conflicts.js keeps): what the add names (-A,
//            -u alone: the whole work tree); git commit -a (also -am): the whole work tree;
//            git commit <pathspec> (git commit ., git commit -m x src/): its pathspecs
//   discard  git stash, git stash push|save [-- <pathspec>]   (not list, show, pop, apply, drop…)
//            git checkout .|-- <pathspec>|-f, and git checkout <path> when the path is a file
//            agents changed (else it reads as a branch); git switch --discard-changes|-f,
//            git restore <pathspec> (not --staged alone), git reset --hard,
//            git clean -f… [<pathspec>] (not -n): the folder it runs in when no pathspec
// and which files: tracked ones (commit -a, add -u, stash without -u, checkout, restore, reset),
// untracked ones (clean), or both (add -A, a stash with -u).
// The line is split at &&, ||, ;, |, &, newlines and parentheses outside quotes, and a shell's
// `-c` script (`bash -lc '…'`, as Codex sends it) is read too, one level deep. `cd` (also chdir,
// Set-Location, sl), pushd and popd (Push-Location, Pop-Location), `env -C` and `git -C` move the
// folder, `cd "$(git rev-parse --show-toplevel)"` to the top of the work tree; quotes,
// backslashes, comments, redirections (2>&1, > file), $(…) and here-document bodies are read as a
// shell reads them, so a commit message that mentions a command is not that command. Variables,
// shell keywords (then, do…) and wrappers (sudo, env, nice, timeout 30, nohup, time…) before a
// command are skipped. Pathspecs are relative to the folder a command runs in, with git's magic
// (:/top, :!exclude, :(glob)…) read; past 64 of them a command counts as having none.
import { isInside, normalizePath, onDrive, workTreeOf } from './paths.js';
import { clip, own, shellWords } from './text.js';

/**
 * Where a line runs: the hook's folder, the crew's session folder (where it started), and the
 * top of the hook folder's work tree when the server found it on disk (core/paths.js workTreeOf).
 * @typedef {object} Place
 * @property {unknown} folder
 * @property {unknown} [sessionFolder]
 * @property {unknown} [root]
 */

/**
 * @typedef {object} ReadOptions
 * @property {boolean} [powershell]  backslashes are path separators, ` escapes
 * @property {readonly GitAdd[]} [staged]  what the agent's earlier calls staged, for a commit now
 * @property {(path: string) => boolean} [known]  whether agents changed this file, or one in this folder
 */

/** @typedef {'tracked'|'untracked'|'all'} FileSet  which files a command acts on */

/**
 * @typedef {object} GitHazard  a command that puts uncommitted work at risk
 * @property {string} command  what was recognised, in a few words: "git stash", "git add -A && git commit"
 * @property {'sweep'|'discard'} effect  sweep: commits changes, others' with them; discard: throws them away
 * @property {string} folder   the folder it runs in, absolute and normalised (core/paths.js)
 * @property {string} root     the top of the work tree it runs in
 * @property {boolean} exact   the root was found on disk, not guessed
 * @property {FileSet} files
 * @property {string[]} paths  what it acts on, absolute; none: the whole work tree
 */

/**
 * @typedef {object} GitCommit  what a commit on a line took in
 * @property {string} folder
 * @property {string} root
 * @property {boolean} exact
 * @property {boolean} tracked  only files git already tracked (-a, a pathspec, git add -u)
 * @property {boolean} clears   it committed what was staged, so earlier adds there are done
 * @property {string[]} paths  absolute; none: everything in the work tree it saw
 */

/**
 * @typedef {object} GitAdd  what a git add staged, until a commit takes it in
 * @property {string} command  "git add -A"
 * @property {string} folder
 * @property {string} root
 * @property {boolean} exact
 * @property {FileSet} files
 * @property {string[]} paths  absolute; none: the whole work tree
 */

/** Longest command line read: the server cuts strings at 2,000 characters; a replay may not. */
const MAX_CHARS = 20_000;
/**
 * Folder moves (cd, pushd, popd, git -C) followed on one line; after them the folder is unknown.
 * Each normalises a path that may have grown with every move: a line of `cd x;` must stay cheap.
 */
const MAX_MOVES = 64;
/** Pathspecs read per command; past them it acts on its folder, or its whole work tree. */
export const MAX_SPECS = 64;
/** A recognised command's words are cut here (a path after `git checkout --` can be long). */
const LABEL_CHARS = 60;
/** Characters that end a simple command outside quotes. */
const SEPARATORS = new Set([';', '&', '|', '(', ')']);
/** Commands that change the folder for the rest of the line, and those that keep the old one to go back to. */
const CD_COMMANDS = new Set(['cd', 'chdir', 'set-location', 'sl']);
const PUSH_COMMANDS = new Set(['pushd', 'push-location']);
const POP_COMMANDS = new Set(['popd', 'pop-location']);
/** Shells whose `-c` script is read as well. */
const SHELLS = new Set(['sh', 'bash', 'zsh', 'dash', 'ksh']);
/** `NAME=value` before a command sets a variable for it. */
const ASSIGNMENT = /^[A-Za-z_]\w*=/;
/** Shell keywords that may stand before a command. */
const KEYWORDS = new Set(['if', 'then', 'else', 'elif', 'do', 'while', 'until', '!']);
/**
 * Wrappers that run the command after their own options, with the short options that take a value
 * (sudo -u bob, nice -n 10, timeout -k 5, env -C dir). `timeout` also takes a duration before the
 * command.
 */
const WRAPPERS = Object.freeze({ sudo: 'ughpCDrtU', env: 'uC', nice: 'n', timeout: 'ks', nohup: '', command: '', exec: 'a', time: 'fo', stdbuf: 'ioe', ionice: 'cnp' });
/** Wrappers' long options that take the next word as their value. */
const WRAPPER_VALUED_LONG = new Set(['--chdir', '--unset', '--user', '--group', '--host', '--signal', '--kill-after', '--format', '--output', '--adjustment']);
/** `$(git rev-parse --show-toplevel)`, or the same in backquotes, then maybe more path: the top of the work tree. */
const TOP_LEVEL = /^(?:\$\(\s*git\s+rev-parse\s+--show-toplevel\s*\)|`\s*git\s+rev-parse\s+--show-toplevel\s*`)(.*)$/s;
/** git's options before the subcommand that take the next word as their value. */
const GIT_VALUE_OPTIONS = new Set(['-c', '--git-dir', '--work-tree', '--namespace', '--super-prefix', '--config-env']);
/** Pathspecs that name the top of the work tree. */
const TOP_SPECS = new Set([':/', ':/:', ':(top)']);
/** Pathspecs a checkout reads as paths, not as a branch, without a `--` before them. */
const CHECKOUT_PATHS = new Set(['.', './', '*', ...TOP_SPECS]);
/** A pathspec's last part from its first glob character on: the glob stands for its folder. */
const GLOB_TAIL = /(?:^|\/)[^/]*[*?[].*$/;
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
// The git commands on a line, and where each runs.

/**
 * @typedef {object} Walk  where the commands of a line run, as it is read
 * @property {string|null} folder    null: it cannot be told (cd ~, cd $DIR), so nothing there is judged
 * @property {string} session        the crew's session folder
 * @property {string} known          the top of the hook folder's work tree, found on disk, or ''
 * @property {(string|null)[]} stack the folders pushd left, for popd
 * @property {number} moves
 */

/** @typedef {{ folder: string, root: string, exact: boolean, sub: string, args: string[] }} GitCall */

/**
 * The git commands of a line, in order, each with the folder it runs in and the top of its work
 * tree. A git command whose folder cannot be told is left out.
 * @param {unknown} command @param {Place} place @param {ReadOptions} options
 * @returns {GitCall[]}
 */
function gitCalls(command, place, options) {
  const folder = normalizePath(place.folder);
  /** @type {Walk} */
  const walk = { folder: folder || null, session: normalizePath(place.sessionFolder), known: normalizePath(place.root), stack: [], moves: 0 };
  return callsIn(command, walk, options, 0);
}

/**
 * @param {unknown} command @param {Walk} walk @param {ReadOptions} options
 * @param {number} depth  1 inside a shell's -c script, which is not read any deeper
 * @returns {GitCall[]}
 */
function callsIn(command, walk, options, depth) {
  /** @type {GitCall[]} */
  const calls = [];
  for (const raw of shellCommands(command, options)) {
    const { at, chdir } = commandStart(raw);
    if (at < 0) continue;
    const words = raw.slice(at);
    const name = commandName(words[0]);
    if (chdir === undefined && moved(walk, name, words.slice(1))) continue;
    // `env -C dir` runs only its own command there.
    const here = chdir === undefined ? walk : { ...walk, folder: moveTo(walk, walk.folder, chdir), stack: [] };
    const script = depth === 0 && SHELLS.has(name) ? scriptOf(words) : null;
    if (script !== null) calls.push(...callsIn(script, here, { powershell: false }, depth + 1));
    else if (name === 'git') calls.push(...gitCall(words, here));
    if (here !== walk) walk.moves = here.moves;
  }
  return calls;
}

/**
 * Where the command itself starts, after variables (`NAME=value`), keywords (`then`) and wrappers
 * with their own options (`sudo -u bob`, `timeout 30`); -1 when there is none. `env -C dir` (also
 * --chdir) says where it runs.
 * @param {string[]} words
 * @returns {{ at: number, chdir: string|undefined }}
 */
function commandStart(words) {
  let i = 0;
  /** @type {string|undefined} */
  let chdir;
  while (i < words.length) {
    const wrapper = own(WRAPPERS, words[i]);
    if (ASSIGNMENT.test(words[i]) || KEYWORDS.has(words[i])) i += 1;
    else if (wrapper === undefined) return { at: i, chdir };
    else {
      if (words[i] === 'env') chdir = envFolder(words, i + 1) ?? chdir;
      i = afterOptions(words, i + 1, wrapper) + (words[i] === 'timeout' ? 1 : 0);
    }
  }
  return { at: -1, chdir };
}

/**
 * The index after a wrapper's options: `-n 10` takes the next word when its last letter takes a
 * value, and so do some long ones (`--chdir dir`); `--` ends them.
 * @param {string[]} words @param {number} from @param {string} valued
 */
function afterOptions(words, from, valued) {
  let i = from;
  while (i < words.length && words[i].length > 1 && words[i].startsWith('-')) {
    const word = words[i];
    i += 1;
    if (word === '--') break;
    if (WRAPPER_VALUED_LONG.has(word) || (!word.startsWith('--') && valued.includes(word[word.length - 1]))) i += 1;
  }
  return i;
}

/**
 * The folder `env` runs its command in: `-C dir`, `-Cdir`, `--chdir=dir` or `--chdir dir`.
 * @param {string[]} words @param {number} from
 * @returns {string|undefined}
 */
function envFolder(words, from) {
  /** @type {string|undefined} */
  let found;
  for (let i = from; i < words.length && words[i].length > 1 && words[i].startsWith('-') && words[i] !== '--'; i += 1) {
    const word = words[i];
    if (word.startsWith('--chdir')) found = word.includes('=') ? word.slice(word.indexOf('=') + 1) : words[++i];
    else if (WRAPPER_VALUED_LONG.has(word)) i += 1;
    else if (!word.startsWith('--')) {
      // The first letter that takes a value takes the rest of the group, or the next word.
      const j = [...word.slice(1)].findIndex((letter) => letter === 'C' || letter === 'u') + 1;
      if (j <= 0) continue;
      const value = j === word.length - 1 ? words[++i] : word.slice(j + 1);
      if (word[j] === 'C') found = value;
    }
  }
  return found;
}

/** A command's name as it is run: `/usr/bin/git`, `git.exe` and `Git` are git. @param {string} word */
function commandName(word) {
  return (word.split(/[/\\]/).pop() ?? '').toLowerCase().replace(/\.exe$/, '');
}

/**
 * The script of `bash -c '…'` (also -lc, -ec…), or null: another shell call runs a script file.
 * @param {string[]} words
 */
function scriptOf(words) {
  for (let i = 1; i < words.length - 1; i += 1) {
    const word = words[i];
    if (!word.startsWith('-') && !word.startsWith('+')) return null;
    if (!word.startsWith('--') && word.includes('c')) return words[i + 1];
    if (word === '-o' || word === '+o' || word === '-O' || word === '+O') i += 1;
  }
  return null;
}

/**
 * Follows a command that moves the folder (cd, pushd, popd), and says whether it was one.
 * @param {Walk} walk @param {string} name @param {string[]} args
 */
function moved(walk, name, args) {
  const target = args.find((word) => !word.startsWith('-'));
  if (CD_COMMANDS.has(name)) walk.folder = moveTo(walk, walk.folder, target);
  else if (PUSH_COMMANDS.has(name)) {
    walk.stack.push(walk.folder);
    walk.folder = moveTo(walk, walk.folder, target);
  } else if (POP_COMMANDS.has(name)) walk.folder = walk.stack.length ? (walk.stack.pop() ?? null) : null;
  else return false;
  return true;
}

/**
 * The folder after moving from `from` to `target`, or null when it cannot be told: home, the last
 * folder (`cd -`), a variable, or past MAX_MOVES moves. A Git Bash path (/c/Users) is read as
 * Windows writes it when the crew works on a drive.
 * @param {Walk} walk @param {string|null} from @param {string|undefined} target
 */
function moveTo(walk, from, target) {
  walk.moves += 1;
  if (walk.moves > MAX_MOVES || !target || target === '-') return null;
  const top = TOP_LEVEL.exec(target);
  if (top) {
    const { root } = workTreeOf(from ?? walk.session, walk.session, walk.known);
    const rest = top[1].replace(/^[/\\]+/, '');
    return (rest ? normalizePath(rest, root) : root) || null;
  }
  return normalizePath(onDrive(target.replace(/\\/g, '/'), from ?? walk.session), from ?? '') || null;
}

/**
 * A git call: its folder (after -C), the top of its work tree, subcommand and arguments; none
 * when its folder cannot be told.
 * @param {string[]} words @param {Walk} walk
 * @returns {GitCall[]}
 */
function gitCall(words, walk) {
  let folder = walk.folder;
  let i = 1;
  for (; i < words.length && words[i].startsWith('-'); i += 1) {
    if (words[i] === '-C') folder = moveTo(walk, folder, words[++i]);
    else if (GIT_VALUE_OPTIONS.has(words[i])) i += 1;
  }
  const sub = words[i];
  if (!sub || !folder) return [];
  return [{ folder, ...workTreeOf(folder, walk.session, walk.known), sub, args: words.slice(i + 1) }];
}

// ---------------------------------------------------------------------------------------------
// The commands among them.

/**
 * The first git command on a line that sweeps up or throws away uncommitted changes, where it
 * runs and what it acts on, or null. A commit counts what the agent's earlier calls staged there
 * too (`staged`).
 * @param {unknown} command  the shell tool's command line
 * @param {Place} place
 * @param {ReadOptions} [options]
 * @returns {GitHazard|null}
 */
export function gitHazardOf(command, place, options = {}) {
  /** @type {StagedAdd[]} what was staged before it: by earlier calls, then on the line */
  const adds = (options.staged ?? []).map((add) => ({ ...add, earlier: true }));
  for (const call of gitCalls(command, place, options)) {
    const sweep = call.sub === 'commit' ? commitScope(call, adds) : null;
    const discard = sweep ? null : (own(DISCARDS, call.sub)?.(call, options) ?? null);
    const found = sweep ?? discard;
    if (found) {
      return { command: clip(found.command, LABEL_CHARS), effect: sweep ? 'sweep' : 'discard', folder: call.folder, root: call.root, exact: call.exact, files: found.files, paths: found.paths };
    }
    const add = call.sub === 'add' ? addOf(call) : null;
    if (add) adds.push({ ...add, earlier: false });
  }
  return null;
}

/**
 * What the commits on a line took in: once the line has run without an error, the committer's
 * changes there are no longer at risk. A commit of whatever was staged before is known only from
 * the agent's earlier adds (`staged`); else it takes in nothing here.
 * @param {unknown} command @param {Place} place @param {ReadOptions} [options]
 * @returns {GitCommit[]}
 */
export function gitCommitsOf(command, place, options = {}) {
  return lineOf(command, place, options).commits;
}

/**
 * What a line that ran without an error left staged: its git adds after the last commit that
 * took in what was staged there. core/conflicts.js keeps them for the agent's next commit.
 * @param {unknown} command @param {Place} place @param {ReadOptions} [options]
 * @returns {GitAdd[]}
 */
export function gitAddsOf(command, place, options = {}) {
  return lineOf(command, place, options).adds;
}

/** @typedef {GitAdd & { earlier: boolean }} StagedAdd  an add, and whether an earlier call made it */

/**
 * The commits on a line and the adds it leaves staged.
 * @param {unknown} command @param {Place} place @param {ReadOptions} options
 * @returns {{ commits: GitCommit[], adds: GitAdd[] }}
 */
function lineOf(command, place, options) {
  /** @type {GitCommit[]} */
  const commits = [];
  /** @type {StagedAdd[]} */
  let adds = (options.staged ?? []).map((add) => ({ ...add, earlier: true }));
  for (const call of gitCalls(command, place, options)) {
    const add = call.sub === 'add' ? addOf(call) : null;
    if (add) adds.push({ ...add, earlier: false });
    if (call.sub !== 'commit') continue;
    const parts = commitParts(call, adds);
    if (!parts) continue;
    for (const part of parts.parts) commits.push({ folder: call.folder, root: call.root, exact: call.exact, tracked: part.files === 'tracked', clears: parts.clears, paths: part.paths });
    if (parts.clears) adds = adds.filter((staged) => staged.root !== call.root);
  }
  return { commits, adds: adds.filter((add) => !add.earlier).map(({ earlier: _earlier, ...add }) => add) };
}

/** @typedef {{ command: string, paths: string[], files: FileSet }} Scope  what a command does, in words, and what it acts on */

/**
 * What a commit takes in, as one scope (core/conflicts.js judges its hazard by it): the paths it
 * names, everything tracked with -a, or what was staged before it there.
 * @param {GitCall} call  a git commit
 * @param {readonly StagedAdd[]} adds
 * @returns {Scope|null}
 */
function commitScope(call, adds) {
  const found = commitParts(call, adds);
  if (!found) return null;
  const whole = found.parts.some((part) => part.paths.length === 0);
  const files = found.parts.some((part) => part.files === 'all') ? 'all' : 'tracked';
  return { command: found.command, paths: whole ? [] : capped(found.parts.flatMap((part) => part.paths), []), files };
}

/**
 * What a commit takes in, part by part: the paths it names (tracked files only: git refuses a new
 * one), everything tracked with -a (with what was staged), or what each add before it there
 * staged. `clears`: it committed what was staged.
 * @param {GitCall} call @param {readonly StagedAdd[]} adds
 * @returns {{ command: string, clears: boolean, parts: { paths: string[], files: FileSet }[] }|null}
 */
function commitParts(call, adds) {
  // -u[<mode>] and -S[<key>] take only a value written with them: -uall is not -a.
  const o = parse(call.args, { valued: 'mFCct', valuedLong: COMMIT_VALUED_LONG, attached: 'uS' });
  if (o.long.has('dry-run')) return null;
  const specs = [...o.operands, ...o.paths];
  if (specs.length) return { command: `git commit ${specs.join(' ')}`, clears: false, parts: [{ paths: resolve(specs, call, []), files: 'tracked' }] };
  const staged = adds.filter((add) => add.root === call.root);
  if (o.short.has('a') || o.long.has('all')) return { command: 'git commit -a', clears: true, parts: [{ paths: [], files: 'tracked' }, ...staged] };
  if (!staged.length) return null;
  const first = staged.find((add) => !add.earlier);
  const command = first ? `${first.command} && git commit` : `git commit after ${staged[0].command}`;
  return { command, clears: true, parts: staged };
}

/**
 * What a `git add` stages: its pathspecs, or the whole work tree for -A or -u alone; tracked files
 * only with -u. Null when it stages nothing (a dry run, or no pathspec).
 * @param {GitCall} call
 * @returns {GitAdd|null}
 */
function addOf(call) {
  const o = parse(call.args, { valuedLong: ['chmod', 'pathspec-from-file'] });
  if (o.short.has('n') || o.long.has('dry-run')) return null;
  const specs = [...o.operands, ...o.paths];
  const update = o.short.has('u') || o.long.has('update');
  const all = o.short.has('A') || o.long.has('all');
  const place = { folder: call.folder, root: call.root, exact: call.exact, files: /** @type {FileSet} */ (update ? 'tracked' : 'all') };
  if (specs.length) return { ...place, command: `git add ${specs.join(' ')}`, paths: resolve(specs, call, []) };
  return update || all ? { ...place, command: `git add -${update ? 'u' : 'A'}`, paths: [] } : null;
}

/** @type {Readonly<Record<string, (call: GitCall, options: ReadOptions) => Scope|null>>} commands that throw changes away */
const DISCARDS = Object.freeze({
  stash: stashScope,
  checkout: checkoutScope,
  switch: (call) => (discardsBySwitch(call.args) ? { command: 'git switch --discard-changes', paths: [], files: 'tracked' } : null),
  restore: restoreScope,
  reset: (call) => (parse(call.args).long.has('hard') ? { command: 'git reset --hard', paths: [], files: 'tracked' } : null),
  clean: cleanScope,
});

/**
 * Pathspecs as absolute paths, relative to the folder the command runs in (`:/x`, `:(top)x`: to
 * the top of its work tree); none (the whole work tree) when one names the top. A glob stands for
 * its folder (src/*.ts: src), and a path that cannot be placed ($DIR) for the command's folder.
 * Exclusions (`:!x`, `:^x`, `:(exclude)x`) are left out; when only they are given, or more than
 * MAX_SPECS, the command acts as without pathspecs: `fallback`, its folder or its whole tree.
 * @param {string[]} specs @param {GitCall} call @param {string[]} fallback
 * @returns {string[]}
 */
function resolve(specs, call, fallback) {
  const unique = [...new Set(specs)];
  if (unique.length > MAX_SPECS) return fallback;
  /** @type {string[]} */
  const paths = [];
  for (const spec of unique) {
    const read = magicOf(spec);
    if (read.exclude) continue;
    if (read.top && !read.pattern) return [];
    const plain = read.literal ? read.pattern : read.pattern.replace(GLOB_TAIL, '');
    paths.push(normalizePath(plain || '.', read.top ? call.root : call.folder) || call.folder);
  }
  return paths.length ? [...new Set(paths)] : fallback;
}

/** Paths, or `fallback` past MAX_SPECS of them. @param {string[]} paths @param {string[]} fallback */
function capped(paths, fallback) {
  const unique = [...new Set(paths)];
  return unique.length > MAX_SPECS ? fallback : unique;
}

/**
 * A pathspec's magic: `:(top,glob)src/*`, `:/src`, `:!vendor`, `:^vendor`, then its pattern.
 * @param {string} spec
 * @returns {{ exclude: boolean, top: boolean, literal: boolean, pattern: string }}
 */
function magicOf(spec) {
  const read = { exclude: false, top: false, literal: false, pattern: spec };
  if (!spec.startsWith(':')) return read;
  if (spec[1] === '(') {
    const close = spec.indexOf(')');
    if (close < 0) return read;
    for (const word of spec.slice(2, close).split(',')) {
      const name = word.trim().split(':')[0];
      read.exclude ||= name === 'exclude';
      read.top ||= name === 'top';
      read.literal ||= name === 'literal';
    }
    read.pattern = spec.slice(close + 1);
    return read;
  }
  let i = 1;
  for (; i < spec.length && '/!^'.includes(spec[i]); i += 1) {
    if (spec[i] === '/') read.top = true;
    else read.exclude = true;
  }
  read.pattern = spec.slice(spec[i] === ':' ? i + 1 : i);
  return read;
}

/**
 * @typedef {object} Parsed  a subcommand's arguments as git reads them
 * @property {Set<string>} short    short options, also from groups (-am: a and m)
 * @property {Set<string>} long     long options, without -- and =value
 * @property {string[]} operands    other words before --
 * @property {string[]} paths       the words after --
 */

/**
 * @typedef {object} Grammar  how a subcommand's options take values
 * @property {string} [valued]       short options that take the rest of their group or the next word
 * @property {readonly string[]} [valuedLong]  long options that take the next word when no = is given
 * @property {string} [attached]     short options whose value, if any, is the rest of their group
 */

/**
 * Reads a subcommand's arguments: short options may be grouped (-am), and an option that takes a
 * value takes the rest of its group or the next word (-m "-a" is a message); `--` ends options.
 * @param {string[]} args
 * @param {Grammar} [grammar]
 * @returns {Parsed}
 */
function parse(args, grammar = {}) {
  const { valued = '', valuedLong = [], attached = '' } = grammar;
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
    } else if (arg.startsWith('-') && arg.length > 1) i += shortGroup(arg, valued, attached, parsed.short);
    else parsed.operands.push(arg);
  }
  return parsed;
}

/**
 * Reads a group of short options; returns 1 when its last one takes the next word as its value.
 * @param {string} arg @param {string} valued @param {string} attached @param {Set<string>} short
 */
function shortGroup(arg, valued, attached, short) {
  for (let j = 1; j < arg.length; j += 1) {
    short.add(arg[j]);
    if (attached.includes(arg[j])) return 0;
    if (valued.includes(arg[j])) return j === arg.length - 1 ? 1 : 0;
  }
  return 0;
}

const COMMIT_VALUED_LONG = Object.freeze(['message', 'file', 'reuse-message', 'reedit-message', 'fixup', 'squash', 'author', 'date', 'template', 'cleanup', 'trailer', 'pathspec-from-file']);

/**
 * `git stash` (push, save) takes changes out of the work tree: all of them, or those under the
 * pathspecs of `push` or after `--`; untracked files only with -u or -a. Its other subcommands
 * (list, show, pop, apply, drop, clear…) do not, and git refuses a word it does not know.
 * @param {GitCall} call
 * @returns {Scope|null}
 */
function stashScope(call) {
  const o = parse(call.args, { valued: 'm', valuedLong: ['message', 'pathspec-from-file'] });
  const [sub, ...rest] = o.operands;
  if (sub !== undefined && sub !== 'push' && sub !== 'save') return null;
  const untracked = o.short.has('u') || o.short.has('a') || o.long.has('include-untracked') || o.long.has('all');
  /** @type {FileSet} */
  const files = untracked ? 'all' : 'tracked';
  // `save` takes a message, `push` pathspecs.
  const specs = [...(sub === 'push' ? rest : []), ...o.paths];
  return specs.length ? { command: `git stash -- ${specs.join(' ')}`, paths: resolve(specs, call, []), files } : { command: 'git stash', paths: [], files };
}

/**
 * `git checkout` puts files back: after `--`, `.` and the like, a path agents changed (`known`:
 * else a word reads as a branch), or every changed file with -f.
 * @param {GitCall} call @param {ReadOptions} options
 * @returns {Scope|null}
 */
function checkoutScope(call, options) {
  const o = parse(call.args, { valued: 'bB', valuedLong: ['orphan', 'conflict', 'pathspec-from-file'] });
  if (o.paths.length) return { command: `git checkout -- ${o.paths.join(' ')}`, paths: resolve(o.paths, call, [call.folder]), files: 'tracked' };
  const known = options.known;
  const specs = o.operands.filter((arg) => CHECKOUT_PATHS.has(arg) || (known !== undefined && isPath(arg, call, known)));
  if (specs.length) return { command: `git checkout ${specs.join(' ')}`, paths: resolve(specs, call, [call.folder]), files: 'tracked' };
  return o.short.has('f') || o.long.has('force') ? { command: 'git checkout -f', paths: [], files: 'tracked' } : null;
}

/**
 * Whether a checkout's word is a path agents changed (or a folder holding one).
 * @param {string} word @param {GitCall} call @param {(path: string) => boolean} known
 */
function isPath(word, call, known) {
  const path = normalizePath(word, call.folder);
  return path !== '' && isInside(path, call.root) && known(path);
}

/** @param {string[]} args */
function discardsBySwitch(args) {
  const o = parse(args, { valued: 'cC', valuedLong: ['orphan'] });
  return o.short.has('f') || o.long.has('force') || o.long.has('discard-changes');
}

/**
 * `git restore` puts files back as committed, unless it only unstages them (--staged).
 * @param {GitCall} call
 * @returns {Scope|null}
 */
function restoreScope(call) {
  const o = parse(call.args, { valued: 's', valuedLong: ['source', 'pathspec-from-file'] });
  const specs = [...o.operands, ...o.paths];
  const staged = o.short.has('S') || o.long.has('staged');
  const worktree = o.short.has('W') || o.long.has('worktree');
  if (!specs.length || (staged && !worktree)) return null;
  return { command: `git restore ${specs.join(' ')}`, paths: resolve(specs, call, [call.folder]), files: 'tracked' };
}

/**
 * `git clean -f` deletes untracked files in the folder it runs in, or under its pathspecs.
 * @param {GitCall} call
 * @returns {Scope|null}
 */
function cleanScope(call) {
  const o = parse(call.args, { valued: 'e', valuedLong: ['exclude'] });
  const force = o.short.has('f') || o.long.has('force');
  if (!force || o.short.has('n') || o.long.has('dry-run')) return null;
  const specs = [...o.operands, ...o.paths];
  const flags = ['d', 'x', 'X'].filter((letter) => o.short.has(letter)).join('');
  if (!specs.length) return { command: `git clean -f${flags}`, paths: [call.folder], files: 'untracked' };
  return { command: `git clean -f${flags} ${specs.join(' ')}`, paths: resolve(specs, call, [call.folder]), files: 'untracked' };
}
