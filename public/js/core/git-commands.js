// Git commands that put other agents' uncommitted work at risk (docs/design/agent-health.md §6),
// read from the command line an agent runs (Bash or PowerShell): commands that sweep changes into
// a commit, whoever made them, and commands that throw changes away. core/conflicts.js decides
// whose work that is. Nothing is run, so aliases, scripts, `eval` and variables are not followed.
// Pure and defensive: any input, bounded work, never throws.
//
// Recognised (the first one on a line counts), each with what it acts on:
//   sweep    git add <pathspec>|-A|-u … and a git commit later on the line: what the add names
//            (-A, -u alone: the whole work tree); git commit -a (also -am): the whole work tree;
//            git commit <pathspec> (git commit ., git commit -m x src/): its pathspecs
//   discard  git stash, git stash push|save [-- <pathspec>]   (not list, show, pop, apply, drop…)
//            git checkout .|-- <pathspec>|-f, git switch --discard-changes|-f (not a branch alone)
//            git restore <pathspec> (not --staged alone), git reset --hard,
//            git clean -f… [<pathspec>] (not -n): the folder it runs in when no pathspec
// The line is split at &&, ||, ;, |, &, newlines and parentheses outside quotes, and a shell's
// `-c` script (`bash -lc '…'`, as Codex sends it) is read too, one level deep. `cd` (also chdir,
// Set-Location, sl), pushd and popd (Push-Location, Pop-Location) and `git -C` move the folder for
// what follows, `cd "$(git rev-parse --show-toplevel)"` to the top of the work tree; quotes,
// backslashes, comments, redirections (2>&1, > file), $(…) and here-document bodies are read as a
// shell reads them, so a commit message that mentions a command is not that command. Variables,
// shell keywords (then, do…) and wrappers (sudo, env, nice, timeout 30, nohup, time…) before a
// command are skipped. Pathspecs are relative to the folder a command runs in.
import { normalizePath, workTreeRoot } from './paths.js';
import { clip, own, shellWords } from './text.js';

/**
 * Where a line runs: the hook's folder, and the crew's session folder (where it started), from
 * which the top of its work tree is guessed (core/paths.js workTreeRoot).
 * @typedef {object} Place
 * @property {unknown} folder
 * @property {unknown} [sessionFolder]
 */

/**
 * @typedef {object} GitHazard  a command that puts uncommitted work at risk
 * @property {string} command  what was recognised, in a few words: "git stash", "git add -A && git commit"
 * @property {'sweep'|'discard'} effect  sweep: commits changes, others' with them; discard: throws them away
 * @property {string} folder   the folder it runs in, absolute and normalised (core/paths.js)
 * @property {string} root     the top of the work tree it runs in, as far as can be told
 * @property {string[]} paths  what it acts on, absolute; none: the whole work tree
 */

/**
 * @typedef {object} GitCommit  what a commit on a line took in
 * @property {string} folder
 * @property {string} root
 * @property {string[]} paths  absolute; none: everything in the work tree it saw
 */

/** Longest command line read: the server cuts strings at 2,000 characters; a replay may not. */
const MAX_CHARS = 20_000;
/**
 * Folder moves (cd, pushd, popd, git -C) followed on one line; after them the folder is unknown.
 * Each normalises a path that may have grown with every move: a line of `cd x;` must stay cheap.
 */
const MAX_MOVES = 64;
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
 * (sudo -u bob, nice -n 10, timeout -k 5). `timeout` also takes a duration before the command.
 */
const WRAPPERS = Object.freeze({ sudo: 'ughpCDrtU', env: 'uC', nice: 'n', timeout: 'ks', nohup: '', command: '', exec: 'a', time: 'fo', stdbuf: 'ioe', ionice: 'cnp' });
/** `$(git rev-parse --show-toplevel)`, or the same in backquotes: the top of the work tree. */
const TOP_LEVEL = /^(?:\$\(|`)\s*git\s+rev-parse\s+--show-toplevel\s*(?:\)|`)$/;
/** git's options before the subcommand that take the next word as their value. */
const GIT_VALUE_OPTIONS = new Set(['-c', '--git-dir', '--work-tree', '--namespace', '--super-prefix', '--config-env']);
/** Pathspecs that name the top of the work tree. */
const TOP_SPECS = new Set([':/', ':/:', ':(top)']);
/** Pathspecs a checkout reads as paths, not as a branch, without a `--` before them. */
const CHECKOUT_PATHS = new Set(['.', './', '*', ...TOP_SPECS]);
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
 * @property {(string|null)[]} stack the folders pushd left, for popd
 * @property {number} moves
 */

/** @typedef {{ folder: string, root: string, sub: string, args: string[] }} GitCall */

/**
 * The git commands of a line, in order, each with the folder it runs in and the top of its work
 * tree. A git command whose folder cannot be told is left out.
 * @param {unknown} command @param {Place} place @param {{ powershell?: boolean }} options
 * @returns {GitCall[]}
 */
function gitCalls(command, place, options) {
  /** @type {Walk} */
  const walk = { folder: normalizePath(place.folder) || null, session: normalizePath(place.sessionFolder), stack: [], moves: 0 };
  return callsIn(command, walk, options, 0);
}

/**
 * @param {unknown} command @param {Walk} walk @param {{ powershell?: boolean }} options
 * @param {number} depth  1 inside a shell's -c script, which is not read any deeper
 * @returns {GitCall[]}
 */
function callsIn(command, walk, options, depth) {
  /** @type {GitCall[]} */
  const calls = [];
  for (const raw of shellCommands(command, options)) {
    const start = commandStart(raw);
    if (start < 0) continue;
    const words = raw.slice(start);
    const name = commandName(words[0]);
    if (moved(walk, name, words.slice(1))) continue;
    const script = depth === 0 && SHELLS.has(name) ? scriptOf(words) : null;
    if (script !== null) calls.push(...callsIn(script, walk, {}, depth + 1));
    else if (name === 'git') calls.push(...gitCall(words, walk));
  }
  return calls;
}

/**
 * Where the command itself starts, after variables (`NAME=value`), keywords (`then`) and wrappers
 * with their own options (`sudo -u bob`, `timeout 30`); -1 when there is none.
 * @param {string[]} words
 */
function commandStart(words) {
  let i = 0;
  while (i < words.length) {
    const wrapper = own(WRAPPERS, words[i]);
    if (ASSIGNMENT.test(words[i]) || KEYWORDS.has(words[i])) i += 1;
    else if (wrapper === undefined) return i;
    else i = afterOptions(words, i + 1, wrapper) + (words[i] === 'timeout' ? 1 : 0);
  }
  return -1;
}

/**
 * The index after a wrapper's options: `-n 10` takes the next word when its last letter takes a
 * value; `--` ends them.
 * @param {string[]} words @param {number} from @param {string} valued
 */
function afterOptions(words, from, valued) {
  let i = from;
  while (i < words.length && words[i].length > 1 && words[i].startsWith('-')) {
    const word = words[i];
    i += 1;
    if (word === '--') break;
    if (!word.startsWith('--') && valued.includes(word[word.length - 1])) i += 1;
  }
  return i;
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
 * folder (`cd -`), a variable, or past MAX_MOVES moves.
 * @param {Walk} walk @param {string|null} from @param {string|undefined} target
 */
function moveTo(walk, from, target) {
  walk.moves += 1;
  if (walk.moves > MAX_MOVES || !target || target === '-') return null;
  if (TOP_LEVEL.test(target)) return workTreeRoot(from ?? walk.session, walk.session) || null;
  return normalizePath(target, from ?? '') || null;
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
  return sub && folder ? [{ folder, root: workTreeRoot(folder, walk.session), sub, args: words.slice(i + 1) }] : [];
}

// ---------------------------------------------------------------------------------------------
// The commands among them.

/**
 * The first git command on a line that sweeps up or throws away uncommitted changes, where it
 * runs and what it acts on, or null.
 * @param {unknown} command  the shell tool's command line
 * @param {Place} place
 * @param {{ powershell?: boolean }} [options]
 * @returns {GitHazard|null}
 */
export function gitHazardOf(command, place, options = {}) {
  /** @type {GitCall[]} the git adds before it on the line */
  const adds = [];
  for (const call of gitCalls(command, place, options)) {
    const sweep = call.sub === 'commit' ? commitScope(call, adds) : null;
    const discard = sweep ? null : (own(DISCARDS, call.sub)?.(call) ?? null);
    const found = sweep ?? discard;
    if (found) return { command: clip(found.command, LABEL_CHARS), effect: sweep ? 'sweep' : 'discard', folder: call.folder, root: call.root, paths: found.paths };
    if (call.sub === 'add') adds.push(call);
  }
  return null;
}

/**
 * What the commits on a line took in: once the line has run without an error, the committer's
 * changes there are no longer at risk. A commit of whatever was staged before the line is not
 * known, so it takes in nothing here.
 * @param {unknown} command @param {Place} place @param {{ powershell?: boolean }} [options]
 * @returns {GitCommit[]}
 */
export function gitCommitsOf(command, place, options = {}) {
  /** @type {GitCommit[]} */
  const commits = [];
  /** @type {GitCall[]} */
  let adds = [];
  for (const call of gitCalls(command, place, options)) {
    if (call.sub === 'add') adds.push(call);
    if (call.sub !== 'commit') continue;
    const scope = commitScope(call, adds);
    if (scope) commits.push({ folder: call.folder, root: call.root, paths: scope.paths });
    adds = [];
  }
  return commits;
}

/** @typedef {{ command: string, paths: string[] }} Scope  what a command does, in words, and what it acts on */

/**
 * What a commit takes in, or null: the paths it names, everything tracked with -a, or what the
 * git adds before it on the line staged.
 * @param {GitCall} call  a git commit
 * @param {GitCall[]} adds
 * @returns {Scope|null}
 */
function commitScope(call, adds) {
  const o = parse(call.args, 'mFCct', COMMIT_VALUED_LONG);
  if (o.long.has('dry-run')) return null;
  const specs = [...o.operands, ...o.paths];
  if (specs.length) return { command: `git commit ${specs.join(' ')}`, paths: resolve(specs, call) };
  if (o.short.has('a') || o.long.has('all')) return { command: 'git commit -a', paths: [] };
  const staged = adds.map(addScope).filter((scope) => scope !== null);
  if (!staged.length) return null;
  const whole = staged.some((scope) => scope.paths.length === 0);
  return { command: `${staged[0].command} && git commit`, paths: whole ? [] : staged.flatMap((scope) => scope.paths) };
}

/**
 * What a `git add` stages: its pathspecs, or the whole work tree for -A or -u alone; null when it
 * stages nothing (a dry run, or no pathspec).
 * @param {GitCall} call
 * @returns {Scope|null}
 */
function addScope(call) {
  const o = parse(call.args, '', ['chmod', 'pathspec-from-file']);
  if (o.short.has('n') || o.long.has('dry-run')) return null;
  const specs = [...o.operands, ...o.paths];
  if (specs.length) return { command: `git add ${specs.join(' ')}`, paths: resolve(specs, call) };
  const all = [['A', 'all'], ['u', 'update']].find(([short, long]) => o.short.has(short) || o.long.has(long));
  return all ? { command: `git add -${all[0]}`, paths: [] } : null;
}

/** @type {Readonly<Record<string, (call: GitCall) => Scope|null>>} commands that throw changes away */
const DISCARDS = Object.freeze({
  stash: stashScope,
  checkout: checkoutScope,
  switch: (call) => (discardsBySwitch(call.args) ? { command: 'git switch --discard-changes', paths: [] } : null),
  restore: restoreScope,
  reset: (call) => (parse(call.args).long.has('hard') ? { command: 'git reset --hard', paths: [] } : null),
  clean: cleanScope,
});

/**
 * Pathspecs as absolute paths, relative to the folder the command runs in; none (the whole work
 * tree) when one names its top (:/). A glob stands for its folder (src/*.ts: src), and a path that
 * cannot be placed ($DIR) for the command's folder.
 * @param {string[]} specs @param {GitCall} call
 * @returns {string[]}
 */
function resolve(specs, call) {
  if (specs.some((spec) => TOP_SPECS.has(spec))) return [];
  return specs.map((spec) => normalizePath(spec.replace(/(?:^|\/)[^/]*[*?[].*$/, '') || '.', call.folder) || call.folder);
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

const COMMIT_VALUED_LONG = Object.freeze(['message', 'file', 'reuse-message', 'reedit-message', 'fixup', 'squash', 'author', 'date', 'template', 'cleanup', 'trailer', 'pathspec-from-file']);

/**
 * `git stash` (push, save) takes changes out of the work tree: all of them, or those under the
 * pathspecs of `push` or after `--`. Its other subcommands (list, show, pop, apply, drop, clear…)
 * do not, and git refuses a word it does not know.
 * @param {GitCall} call
 * @returns {Scope|null}
 */
function stashScope(call) {
  const o = parse(call.args, 'm', ['message', 'pathspec-from-file']);
  const [sub, ...rest] = o.operands;
  if (sub !== undefined && sub !== 'push' && sub !== 'save') return null;
  // `save` takes a message, `push` pathspecs.
  const specs = [...(sub === 'push' ? rest : []), ...o.paths];
  return specs.length ? { command: `git stash -- ${specs.join(' ')}`, paths: resolve(specs, call) } : { command: 'git stash', paths: [] };
}

/** @param {GitCall} call @returns {Scope|null} */
function checkoutScope(call) {
  const o = parse(call.args, 'bB', ['orphan', 'conflict', 'pathspec-from-file']);
  if (o.paths.length) return { command: `git checkout -- ${o.paths.join(' ')}`, paths: resolve(o.paths, call) };
  const specs = o.operands.filter((arg) => CHECKOUT_PATHS.has(arg));
  if (specs.length) return { command: `git checkout ${specs.join(' ')}`, paths: resolve(specs, call) };
  return o.short.has('f') || o.long.has('force') ? { command: 'git checkout -f', paths: [] } : null;
}

/** @param {string[]} args */
function discardsBySwitch(args) {
  const o = parse(args, 'cC', ['orphan']);
  return o.short.has('f') || o.long.has('force') || o.long.has('discard-changes');
}

/**
 * `git restore` puts files back as committed, unless it only unstages them (--staged).
 * @param {GitCall} call
 * @returns {Scope|null}
 */
function restoreScope(call) {
  const o = parse(call.args, 's', ['source', 'pathspec-from-file']);
  const specs = [...o.operands, ...o.paths];
  const staged = o.short.has('S') || o.long.has('staged');
  const worktree = o.short.has('W') || o.long.has('worktree');
  if (!specs.length || (staged && !worktree)) return null;
  return { command: `git restore ${specs.join(' ')}`, paths: resolve(specs, call) };
}

/**
 * `git clean -f` deletes untracked files in the folder it runs in, or under its pathspecs.
 * @param {GitCall} call
 * @returns {Scope|null}
 */
function cleanScope(call) {
  const o = parse(call.args, 'e', ['exclude']);
  const force = o.short.has('f') || o.long.has('force');
  if (!force || o.short.has('n') || o.long.has('dry-run')) return null;
  const specs = [...o.operands, ...o.paths];
  const flags = ['d', 'x', 'X'].filter((letter) => o.short.has(letter)).join('');
  if (!specs.length) return { command: `git clean -f${flags}`, paths: [call.folder] };
  return { command: `git clean -f${flags} ${specs.join(' ')}`, paths: resolve(specs, call) };
}
