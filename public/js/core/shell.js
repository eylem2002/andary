// A shell command line read as a shell reads it, for every rule that looks at what an agent ran:
// the stuck rules (core/loops.js), and any other reader of Bash and PowerShell calls. Pure,
// defensive (any input, bounded work, never throws), and shared with the server.
//
// A line is split into its simple commands (segments) at `&&`, `||`, `;`, `|`, `|&`, `&`,
// newlines and parentheses outside quotes, each with the separator after it. Quotes, escapes and
// `$'…'` are resolved as bash does (in PowerShell a backtick escapes, backslashes are path separators);
// comments are dropped; `$(…)` and backquotes stay whole inside their word, here-documents in
// them too, so `git commit -m "$(cat <<'EOF' … git push … EOF)"` runs no push. Redirections
// (`2>&1`, `> out.txt`, `<<'EOF'`, `<<<`) are kept apart from the words, with their targets and
// here-document bodies. A command's program is found behind what only starts it: `NAME=1`, shell
// keywords (`then`, `do`, `if`), wrappers with their own options (sudo, env, nice, timeout 30,
// nohup, time, stdbuf…) and launchers (npx, npm exec, uv run, python -m…); a shell's `-c` script
// (`bash -lc '…'`, as Codex sends every command) is read in its place, one level deep. Each command
// says what the line's exit status proves of it (pipes, `||`, `&`, `if`, `set -o pipefail`) and,
// given a starting folder, where it runs: cd, pushd and popd (Set-Location, sl, Push-Location,
// Pop-Location), `env -C`, and `cd "$(git rev-parse --show-toplevel)"`, up to MAX_MOVES moves.
import { shellWords } from './text.js';

/**
 * A redirection of a command.
 * @typedef {object} Redirect
 * @property {string} op        '>', '>>', '>|', '&>', '&>>', '<', '<>', '>&', '<&', '<<', '<<-' or '<<<'
 * @property {string} fd        the descriptor written just before it (`2>`), or ''
 * @property {string} target    the file, the descriptor (`2>&1`: '1'), a here-document's delimiter, or a here-string
 * @property {string|null} body a here-document's text, up to its delimiter; null for any other
 */

/**
 * One simple command of a line.
 * @typedef {object} Segment
 * @property {string} text       as written, without the separator, whitespace collapsed
 * @property {string[]} argv     its words, quotes and escapes resolved, without redirections and leading keywords
 * @property {string[]} words    the program it runs (file name, lower case) and its arguments (programOf)
 * @property {string} program    words[0], or ''
 * @property {Redirect[]} redirects
 * @property {string} separator  what follows it: '&&', '||', ';' (also a newline), '|', '|&', '&', or '' at the end
 * @property {number} pipeline   its pipeline's index on the line: commands joined by `|` share one
 * @property {boolean} condition it tests something (`if`, `while`, `until`, `!`): its failure is no failure
 * @property {boolean} succeeded the line succeeding proves this command succeeded
 * @property {boolean} decides   the line failing proves this command failed (every other one that must succeed is harmless)
 * @property {number} depth      1 inside a shell's `-c` script
 * @property {string|null} folder where it runs, when a starting folder was given; null when it cannot be told
 */

/**
 * @typedef {object} Shell
 * @property {Segment[]} segments
 * @property {boolean} pipefail   `set -o pipefail` is on at the end of the line
 * @property {boolean} truncated  the line was longer than MAX_SHELL_CHARS: only its start was read
 */

/**
 * @typedef {object} ShellOptions
 * @property {boolean} [powershell]  a backtick escapes, backslashes are path separators
 * @property {string|null} [folder]  where the line starts: each segment then says where it runs
 * @property {string|null|((from: string|null) => string|null)} [root]  the top of the work tree, for `$(git rev-parse --show-toplevel)`
 * @property {(from: string|null, target: string) => string|null} [resolve]  where a move to `target` leads (default: POSIX paths; `~`, `$VAR`: unknown)
 */

/** @typedef {{ words: string[], succeeded: boolean, decides: boolean }} ShellCommand */

/** Longest line read: the server cuts strings at 2,000 characters; a replay or the demo may not. */
export const MAX_SHELL_CHARS = 20_000;
/** Folder moves followed on one line; after them the folder is unknown, and every move stays cheap. */
export const MAX_MOVES = 64;

const SHELLS = new Set(['sh', 'bash', 'zsh', 'dash', 'ksh']);
const ASSIGNMENT = /^[A-Za-z_]\w*=/;
/** Words that only shape the commands around them: the command is what follows. */
const KEYWORDS = new Set(['then', 'do', 'else', 'fi', 'done', 'esac', '{', '}']);
/** Words that make what follows a condition: its failure is no failure of the line. */
const CONDITIONS = new Set(['if', 'elif', 'while', 'until', '!']);
/**
 * Wrappers that run the command after their own options, with the short options that take a value
 * (sudo -u bob, nice -n 10, timeout -k 5, env -C dir). `timeout` also takes a duration first.
 */
const WRAPPERS = Object.freeze({ sudo: 'ughpCDrtU', env: 'uCS', nice: 'n', timeout: 'ks', nohup: '', command: '', exec: 'a', time: 'fo', stdbuf: 'ioe', ionice: 'cnp' });
/** Wrappers' long options that take the next word as their value. */
const WRAPPER_VALUED_LONG = new Set(['--chdir', '--unset', '--user', '--group', '--host', '--signal', '--kill-after', '--format', '--output', '--adjustment', '--split-string']);
/** Programs that start the next word as the program, after their own options. */
const LAUNCHERS = new Set(['npx', 'pnpx', 'bunx']);
/** Two words that start the next word as the program. */
const TWO_WORD_LAUNCHERS = new Set(['npm exec', 'pnpm exec', 'pnpm dlx', 'yarn exec', 'yarn dlx', 'bun x', 'uv run', 'poetry run', 'pipenv run', 'pdm run', 'hatch run', 'bundle exec']);
const PYTHON = /^(?:python[\d.]*|py)$/;
/** Commands whose failure nobody would mistake for the line's. */
const HARMLESS = new Set(['cd', 'pushd', 'popd', 'export', 'unset', 'set', 'true', ':', 'echo', 'printf', 'tail', 'head', 'tee']);
const CD_COMMANDS = new Set(['cd', 'chdir', 'set-location', 'sl']);
const PUSH_COMMANDS = new Set(['pushd', 'push-location']);
const POP_COMMANDS = new Set(['popd', 'pop-location']);
/** Characters that end a word. */
const BLANKS = new Set([' ', '\t', '\r', '\n']);
/** Control operators, longest first so `&&` is never read as two `&`. */
const OPERATORS = ['&&', '||', '|&', ';;', '|', '&', ';'];
/** Redirection operators, longest first. */
const REDIRECTS = ['&>>', '<<<', '<<-', '&>', '>>', '>|', '>&', '<&', '<>', '<<', '>', '<'];
/** Inside double quotes a bash backslash escapes only these; elsewhere it stays. */
const DOUBLE_ESCAPES = new Set(['$', '`', '"', '\\', '\n']);
/** `<<EOF`, `<<-EOF`, `<<'EOF'`, `<< "EOF"`, `<<\EOF`. */
const HERE_DOC = /^<<(-?)[ \t]*(?:'([^'\n]*)'|"([^"\n]*)"|\\?([^\s;&|()<>'"]+))/;
/** `$(git rev-parse --show-toplevel)` (or in backquotes), maybe followed by more path. */
const TOP_LEVEL = /^(?:\$\(\s*git\s+rev-parse\s+--show-toplevel\s*\)|`\s*git\s+rev-parse\s+--show-toplevel\s*`)(.*)$/s;
const ABSOLUTE = /^(?:\/|[A-Za-z]:\/)/;

/**
 * A command line as its simple commands, with where each runs and what the line's exit status
 * proves of it.
 * @param {unknown} command  a string, or a list of arguments (Codex)
 * @param {ShellOptions} [options]
 * @returns {Shell}
 */
export function readShell(command, options = {}) {
  try {
    const whole = Array.isArray(command) ? shellWords(command) : typeof command === 'string' ? command : '';
    const text = whole.slice(0, MAX_SHELL_CHARS);
    const state = { pipefail: false };
    const walk = { folder: typeof options.folder === 'string' ? options.folder : null, stack: /** @type {(string|null)[]} */ ([]), moves: { count: 0 } };
    const segments = readLevel(text, options, state, walk, 0);
    numberPipelines(segments);
    return { segments, pipefail: state.pipefail, truncated: whole.length > text.length };
  } catch {
    return { segments: [], pipefail: false, truncated: false };
  }
}

/**
 * Every simple command a line runs, in order, with what the line's exit status proves of each:
 * readShell's segments in brief.
 * @param {unknown} command @param {ShellOptions} [options]
 * @returns {ShellCommand[]}
 */
export function shellCommands(command, options = {}) {
  return readShell(command, options).segments.map(({ words, succeeded, decides }) => ({ words, succeeded, decides }));
}

/**
 * The program a command runs and its arguments: behind assignments, wrappers with their options
 * and launchers, its file name lower case, without folder or `.exe` (`./node_modules/.bin/vitest`
 * is `vitest`, `Git.exe` is `git`).
 * @param {string[]} argv
 * @returns {string[]}
 */
export function programOf(argv) {
  let rest = argv;
  for (let guard = 0; guard < 8; guard += 1) {
    while (rest.length && ASSIGNMENT.test(rest[0])) rest = rest.slice(1);
    if (!rest.length) return rest;
    const name = commandName(rest[0]);
    const wrapper = Object.hasOwn(WRAPPERS, name) ? WRAPPERS[/** @type {keyof typeof WRAPPERS} */ (name)] : undefined;
    if (wrapper !== undefined) rest = rest.slice(afterOptions(rest, 1, wrapper) + (name === 'timeout' ? 1 : 0));
    else if (LAUNCHERS.has(name)) rest = withoutOptions(rest.slice(1));
    else if (TWO_WORD_LAUNCHERS.has(`${name} ${rest[1]}`)) rest = withoutOptions(rest.slice(2));
    else if (PYTHON.test(name) && rest[1] === '-m' && rest[2]) rest = rest.slice(2);
    else return [name, ...rest.slice(1)];
  }
  return rest;
}

const TEST_RUNNERS = new Set(['jest', 'vitest', 'mocha', 'ava', 'pytest', 'py.test', 'rspec', 'phpunit', 'tox', 'nox', 'unittest']);
const PACKAGE_MANAGERS = new Set(['npm', 'pnpm', 'yarn', 'bun']);
/** Tools whose `test` subcommand runs the tests. */
const TEST_SUBCOMMANDS = new Set(['go', 'cargo', 'deno', 'dotnet', 'mix', 'mvn', 'gradle', 'gradlew', 'make', 'playwright']);

/**
 * Whether a command (its program's words, programOf) runs tests: a test runner, a package's
 * `test` script (`npm test`, `pnpm run test:unit`), or a tool's `test` subcommand (`go test`).
 * @param {string[]} words
 */
export function isTestRun([name, ...args]) {
  if (TEST_RUNNERS.has(name)) return true;
  if (PACKAGE_MANAGERS.has(name)) {
    const script = args[0] === 'run' || args[0] === 'run-script' ? args[1] : args[0];
    return /^test(?:$|[:-])/.test(script ?? '') || TEST_RUNNERS.has(script ?? '');
  }
  if (TEST_SUBCOMMANDS.has(name)) return args[0] === 'test';
  return name === 'node' && args.includes('--test');
}

/** Arguments of a test command that runs no tests: it lists, collects, explains, or may find nothing. */
const NO_RUN_ARGS = new Set(['--no-run', '--collect-only', '--co', '-l', 'list', '--help', '-h', '--version', '--if-present']);

/**
 * A test command that runs no tests (its program's words, programOf): it lists or collects them,
 * only builds, explains itself, may find no script (`--if-present`), or is go's `-run`, which may
 * select none.
 * @param {string[]} words
 */
export function runsNoTests([name, ...args]) {
  return args.some((arg) => NO_RUN_ARGS.has(arg) || arg.startsWith('--list') || (name === 'go' && (arg === '-run' || arg.startsWith('-run='))));
}

/** Tools whose `build` subcommand builds the project. */
const BUILD_SUBCOMMANDS = new Set(['go', 'cargo', 'uv', 'dotnet', 'vite', 'next', 'astro', 'mkdocs', 'gradle', 'gradlew', 'docker', 'swift', 'zig']);

/**
 * Whether a command (its program's words, programOf) builds the project: a package's `build`
 * script (`npm run build`, `pnpm build:types`), the TypeScript compiler, a tool's `build`
 * subcommand (`cargo build`, `vite build`), `make` (its default target, `all` or `build`), or
 * `python -m build`.
 * @param {string[]} words
 */
export function isBuildRun([name, ...args]) {
  if (PACKAGE_MANAGERS.has(name)) {
    const script = args[0] === 'run' || args[0] === 'run-script' ? args[1] : args[0];
    return /^build(?:$|[:-])/.test(script ?? '');
  }
  if (name === 'tsc' || name === 'build') return true;
  if (name === 'make') return args.filter((arg) => !arg.startsWith('-')).every((arg) => arg === 'all' || arg === 'build' || arg.includes('='));
  return BUILD_SUBCOMMANDS.has(name) && args[0] === 'build';
}

/** git's options before its subcommand that take the next word as their value. */
const GIT_VALUE_OPTIONS = new Set(['-C', '-c', '--git-dir', '--work-tree', '--namespace', '--super-prefix', '--config-env']);

/**
 * Whether a git command commits or pushes (not a dry run); git's own options may come first.
 * @param {string[]} words  the program's words (programOf)
 * @returns {'commit'|'push'|null}
 */
export function gitAction([name, ...args]) {
  if (name !== 'git') return null;
  let i = 0;
  while (i < args.length && args[i].startsWith('-')) i += GIT_VALUE_OPTIONS.has(args[i]) ? 2 : 1;
  const rest = args.slice(i + 1);
  if (rest.includes('--dry-run')) return null;
  if (args[i] === 'commit') return 'commit';
  // A short option cluster with n is push's dry run: `-n`, `-nf`.
  return args[i] === 'push' && !rest.some((arg) => /^-[a-zA-Z]*n[a-zA-Z]*$/.test(arg)) ? 'push' : null;
}

// ---------------------------------------------------------------------------------------------
// One level of a line: its segments, a shell's -c script read in its place.

/**
 * @typedef {object} Walk
 * @property {string|null} folder
 * @property {(string|null)[]} stack  the folders pushd left, for popd
 * @property {{ count: number }} moves shared by a line and its scripts
 */

/**
 * @param {string} text @param {ShellOptions} options @param {{ pipefail: boolean }} state
 * @param {Walk} walk @param {number} depth
 * @returns {Segment[]}
 */
function readLevel(text, options, state, walk, depth) {
  const raw = lex(text, options.powershell === true && depth === 0);
  proveStatus(raw, state);
  /** @type {Segment[]} */
  const out = [];
  for (const seg of raw) {
    seg.depth = depth;
    const chdir = envFolder(seg.argv);
    seg.folder = chdir === undefined ? walk.folder : moveTo(walk, walk.folder, chdir, options);
    const script = depth === 0 ? scriptOf(seg.words) : null;
    if (script === null) {
      out.push(seg);
      if (chdir === undefined) moved(walk, seg, options);
      continue;
    }
    // The script runs in a shell of its own: its moves stay there.
    const inner = readLevel(script, options, { pipefail: false }, { folder: seg.folder, stack: [], moves: walk.moves }, depth + 1);
    inner.forEach((one, i) => {
      one.succeeded &&= seg.succeeded;
      one.decides &&= seg.decides;
      if (i === inner.length - 1) one.separator = seg.separator;
      out.push(one);
    });
  }
  return out;
}

/** @param {Segment[]} segments */
function numberPipelines(segments) {
  let pipeline = 0;
  segments.forEach((seg, i) => {
    if (i > 0 && !['|', '|&'].includes(segments[i - 1].separator)) pipeline += 1;
    seg.pipeline = pipeline;
  });
}

/**
 * What the line's exit status proves of each command, in place. Items are the commands between
 * `;`, `&` and newlines; only the last item's status is the line's. Within it every pipeline must
 * succeed (no `||`), and a pipeline's status is its last command's, or any one's with pipefail.
 * @param {Segment[]} segments @param {{ pipefail: boolean }} state
 */
function proveStatus(segments, state) {
  /** @type {Segment[][]} */
  const items = [[]];
  for (const seg of segments) {
    items[items.length - 1].push(seg);
    if ([';', '&', ''].includes(seg.separator)) items.push([]);
  }
  const filled = items.filter((item) => item.length);
  filled.forEach((item, index) => {
    const last = item[item.length - 1];
    const counts = index === filled.length - 1 && !item.some((seg) => seg.separator === '||') && last.separator !== '&';
    let pipefail = state.pipefail;
    for (const seg of item) {
      const endsPipe = !['|', '|&'].includes(seg.separator);
      seg.succeeded = counts && !seg.condition && (pipefail || endsPipe);
      state.pipefail = pipefailOf(seg.words) ?? state.pipefail;
      if (endsPipe) pipefail = state.pipefail;
    }
    const risky = item.filter((seg) => seg.succeeded && !HARMLESS.has(seg.program));
    for (const seg of item) seg.decides = seg.succeeded && risky.every((other) => other === seg);
  });
}

/** `set -o pipefail` (also `-eo pipefail`) turns it on, `set +o pipefail` off; null: no change. @param {string[]} words */
function pipefailOf([name, ...args]) {
  if (name !== 'set') return null;
  const at = args.indexOf('pipefail');
  if (at < 1) return null;
  if (/^-[a-z]*o$/.test(args[at - 1])) return true;
  return args[at - 1] === '+o' ? false : null;
}

/** The script of `bash -c '…'` (also -lc, -ec, `-o pipefail -c`), or null. @param {string[]} words */
function scriptOf([name, ...args]) {
  if (!SHELLS.has(name ?? '')) return null;
  for (let i = 0; i < args.length - 1; i += 1) {
    const word = args[i];
    if (!word.startsWith('-') && !word.startsWith('+')) return null;
    if (!word.startsWith('--') && word.includes('c')) return args[i + 1];
    if (word === '-o' || word === '+o' || word === '-O' || word === '+O') i += 1;
  }
  return null;
}

/** A command's name as it is run: `/usr/bin/git`, `git.exe` and `Git` are git. @param {string} word */
function commandName(word) {
  return (word.split(/[/\\]/).pop() ?? '').toLowerCase().replace(/\.exe$/, '');
}

/** Leading options (`-y`, `--frozen`) of a launcher. @param {string[]} words */
function withoutOptions(words) {
  let i = 0;
  while (i < words.length && words[i].startsWith('-')) i += 1;
  return words.slice(i);
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
 * The folder `env` runs its command in (`-C dir`, `-Cdir`, `--chdir=dir`, `--chdir dir`), or
 * undefined. `env` may come after assignments and other wrappers' words only as the program.
 * @param {string[]} argv
 * @returns {string|undefined}
 */
function envFolder(argv) {
  let i = 0;
  while (i < argv.length && ASSIGNMENT.test(argv[i])) i += 1;
  if (commandName(argv[i] ?? '') !== 'env') return undefined;
  /** @type {string|undefined} */
  let found;
  for (i += 1; i < argv.length && argv[i].length > 1 && argv[i].startsWith('-') && argv[i] !== '--'; i += 1) {
    const word = argv[i];
    if (word.startsWith('--chdir')) found = word.includes('=') ? word.slice(word.indexOf('=') + 1) : argv[++i];
    else if (WRAPPER_VALUED_LONG.has(word)) i += 1;
    else if (!word.startsWith('--')) {
      // The first letter that takes a value takes the rest of the group, or the next word.
      const j = [...word.slice(1)].findIndex((letter) => letter === 'C' || letter === 'u' || letter === 'S') + 1;
      if (j <= 0) continue;
      const value = j === word.length - 1 ? argv[++i] : word.slice(j + 1);
      if (word[j] === 'C') found = value;
    }
  }
  return found;
}

/**
 * Follows a command that moves the folder for the rest of the line (cd, pushd, popd).
 * @param {Walk} walk @param {Segment} seg @param {ShellOptions} options
 */
function moved(walk, seg, options) {
  const target = seg.words.slice(1).find((word) => !word.startsWith('-') || word === '-');
  if (CD_COMMANDS.has(seg.program)) walk.folder = moveTo(walk, walk.folder, target, options);
  else if (PUSH_COMMANDS.has(seg.program)) {
    walk.stack.push(walk.folder);
    walk.folder = moveTo(walk, walk.folder, target, options);
  } else if (POP_COMMANDS.has(seg.program)) walk.folder = walk.stack.length ? (walk.stack.pop() ?? null) : null;
}

/**
 * The folder after a move from `from` to `target`, or null when it cannot be told: home, the last
 * folder (`cd -`), a variable, an unknown top of the work tree, or past MAX_MOVES moves.
 * @param {Walk} walk @param {string|null} from @param {string|undefined} target @param {ShellOptions} options
 */
function moveTo(walk, from, target, options) {
  walk.moves.count += 1;
  if (walk.moves.count > MAX_MOVES || !target || target === '-') return null;
  const top = TOP_LEVEL.exec(target);
  if (top) {
    const root = typeof options.root === 'function' ? options.root(from) : (options.root ?? null);
    const rest = top[1].replace(/^[/\\]+/, '');
    if (!root) return null;
    return rest ? (options.resolve ?? resolveFolder)(root, rest) : root;
  }
  return (options.resolve ?? resolveFolder)(from, target);
}

/**
 * Where a move leads, as POSIX paths go (backslashes read as slashes): null from an unknown
 * folder, or to home or a variable.
 * @param {string|null} from @param {string} target
 * @returns {string|null}
 */
function resolveFolder(from, target) {
  const path = target.replace(/\\/g, '/');
  if (/^[~$%]/.test(path)) return null;
  if (ABSOLUTE.test(path)) return normalizedPath(path);
  return from === null ? null : normalizedPath(from ? `${from}/${path}` : path);
}

/**
 * A path without `.` and `..` segments, doubled slashes or a trailing slash.
 * @param {string} path
 */
export function normalizedPath(path) {
  /** @type {string[]} */
  const parts = [];
  for (const [i, part] of path.split('/').entries()) {
    if (part === '.' || (part === '' && i > 0)) continue;
    if (part === '..' && parts.length > 0 && !['', '..'].includes(parts[parts.length - 1])) parts.pop();
    else parts.push(part);
  }
  const joined = parts.join('/');
  return joined === '' && path.startsWith('/') ? '/' : joined || '.';
}

// ---------------------------------------------------------------------------------------------
// The lexer.

/**
 * @typedef {object} Lexer
 * @property {string} text
 * @property {number} at
 * @property {string} escape     \ in bash, ` in PowerShell
 * @property {boolean} powershell
 * @property {Segment[]} segments
 * @property {RawSegment} seg
 * @property {string} word
 * @property {boolean} open      a word has started (it may be empty: "")
 * @property {boolean} quoted    it holds quotes or escapes, so it is no file descriptor
 * @property {Redirect|null} pending  a redirection whose target is the next word
 * @property {{ redirect: Redirect, tabs: boolean }[]} docs  here-documents whose bodies follow this line
 */

/** @typedef {{ start: number, end: number, words: string[], redirects: Redirect[] }} RawSegment */

/** @param {number} at @returns {RawSegment} */
const rawSegment = (at) => ({ start: at, end: at, words: [], redirects: [] });

/**
 * The segments of one level of a line, before scripts are read and folders followed.
 * @param {string} text @param {boolean} powershell
 * @returns {Segment[]}
 */
function lex(text, powershell) {
  /** @type {Lexer} */
  const lx = { text, at: 0, escape: powershell ? '`' : '\\', powershell, segments: [], seg: rawSegment(0), word: '', open: false, quoted: false, pending: null, docs: [] };
  while (lx.at < text.length) step(lx);
  endSegment(lx, '');
  return lx.segments;
}

/** Reads one character, or one quoted string, substitution or operator. @param {Lexer} lx */
function step(lx) {
  const { text, at } = lx;
  const c = text[at];
  if (c === lx.escape) return escaped(lx);
  if (c === "'") return singleQuoted(lx);
  if (c === '"') return doubleQuoted(lx);
  if (c === '$' || c === '`') return dollar(lx);
  if (BLANKS.has(c)) return space(lx);
  if (c === '#' && !lx.open) return comment(lx);
  const redirect = '<>&'.includes(c) ? REDIRECTS.find((op) => text.startsWith(op, at)) : undefined;
  if (redirect) return redirection(lx, redirect);
  if (c === '(' || c === ')') return parenthesis(lx, c);
  const op = OPERATORS.find((o) => text.startsWith(o, at));
  if (!op) return append(lx, c, false);
  endSegment(lx, op === ';;' ? ';' : op);
  lx.at += op.length;
  lx.seg = rawSegment(lx.at);
}

/** Blanks end a word; a newline ends a command, and the bodies of its here-documents follow it. @param {Lexer} lx */
function space(lx) {
  if (lx.text[lx.at] === '\n') {
    endSegment(lx, ';');
    lx.at = readBodies(lx.text, lx.at + 1, lx.docs.splice(0));
    lx.seg = rawSegment(lx.at);
    return;
  }
  endWord(lx);
  lx.at += 1;
}

/** `$'…'`, `$(…)` and backquotes; a `$` alone is a character. @param {Lexer} lx */
function dollar(lx) {
  const { text, at } = lx;
  if (text[at] === '`') return append(lx, text.slice(at, closing(text, at + 1, '`')), false);
  if (text[at + 1] === "'" && !lx.powershell) return ansiQuoted(lx);
  if (text[at + 1] === '(') return append(lx, text.slice(at, substitutionEnd(text, at + 2, lx.escape)), false);
  append(lx, '$', false);
}

/** @param {Lexer} lx */
function comment(lx) {
  const end = lx.text.indexOf('\n', lx.at);
  lx.at = end < 0 ? lx.text.length : end;
}

/**
 * `( … )` groups commands: a command before `(` ends there, one before `)` waits for the
 * separator after it.
 * @param {Lexer} lx @param {string} c
 */
function parenthesis(lx, c) {
  if (c === '(' && (lx.open || lx.seg.words.length)) endSegment(lx, ';');
  else endWord(lx);
  lx.at += 1;
  if (c === '(' && !lx.seg.words.length) lx.seg = rawSegment(lx.at);
}

/**
 * Adds text to the word being read and moves past it.
 * @param {Lexer} lx @param {string} raw  the source text @param {boolean} quoted @param {string} [value]  what it means
 */
function append(lx, raw, quoted, value = raw) {
  if (!lx.open && !lx.seg.words.length && !lx.seg.redirects.length && !lx.pending) lx.seg.start = lx.at;
  lx.word += value;
  lx.open = true;
  lx.quoted ||= quoted;
  lx.at += raw.length;
  lx.seg.end = lx.at;
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

/** `$'…'`: an escape stands for the character after it. @param {Lexer} lx */
function ansiQuoted(lx) {
  let value = '';
  let i = lx.at + 2;
  while (i < lx.text.length && lx.text[i] !== "'") {
    value += lx.text[i] === '\\' ? (lx.text[i + 1] ?? '') : lx.text[i];
    i += lx.text[i] === '\\' ? 2 : 1;
  }
  append(lx, lx.text.slice(lx.at, Math.min(i + 1, lx.text.length)), true, value);
}

/**
 * A redirection: kept apart from the words, with its target. Digits just before it name the
 * descriptor it redirects (`2>`), so they are no argument.
 * @param {Lexer} lx @param {string} op
 */
function redirection(lx, op) {
  let fd = '';
  if (lx.open && !lx.quoted && /^\d+$/.test(lx.word)) {
    fd = lx.word;
    lx.word = '';
    lx.open = false;
  } else {
    endWord(lx);
  }
  if (!lx.seg.words.length && !lx.seg.redirects.length) lx.seg.start = lx.at - fd.length;
  const { text } = lx;
  if (op === '<<' || op === '<<-') {
    const match = HERE_DOC.exec(text.slice(lx.at, lx.at + 200));
    if (match) {
      /** @type {Redirect} */
      const redirect = { op, fd, target: match[2] ?? match[3] ?? match[4], body: '' };
      lx.seg.redirects.push(redirect);
      lx.docs.push({ redirect, tabs: match[1] === '-' });
      lx.at += match[0].length;
      lx.seg.end = lx.at;
      return;
    }
  }
  lx.at += op.length;
  // `>&2`, `2>&1`, `>&-`: into another descriptor, so no file follows.
  const descriptor = (op === '>&' || op === '<&') && /^[\d-]+/.exec(text.slice(lx.at, lx.at + 12));
  /** @type {Redirect} */
  const redirect = { op, fd, target: descriptor ? descriptor[0] : '', body: null };
  lx.seg.redirects.push(redirect);
  if (descriptor) lx.at += descriptor[0].length;
  else lx.pending = redirect;
  lx.seg.end = lx.at;
}

/** @param {Lexer} lx */
function endWord(lx) {
  if (lx.open && lx.pending) {
    lx.pending.target = lx.word;
    lx.pending = null;
  } else if (lx.open) lx.seg.words.push(lx.word);
  lx.word = '';
  lx.open = false;
  lx.quoted = false;
}

/**
 * Ends the command being read. Leading keywords are dropped (`if` and `!` make it a condition); a
 * command of keywords alone (`fi`, `done`) hands its separator to the one before.
 * @param {Lexer} lx @param {string} separator
 */
function endSegment(lx, separator) {
  endWord(lx);
  lx.pending = null;
  const { seg } = lx;
  let i = 0;
  let condition = false;
  while (i < seg.words.length && (KEYWORDS.has(seg.words[i]) || CONDITIONS.has(seg.words[i]))) {
    condition ||= CONDITIONS.has(seg.words[i]);
    i += 1;
  }
  const argv = seg.words.slice(i).filter((word) => word !== '{' && word !== '}');
  const previous = lx.segments[lx.segments.length - 1];
  if (!argv.length && !seg.redirects.length) {
    if (seg.words.length && previous) previous.separator = separator;
    return;
  }
  const words = programOf(argv);
  lx.segments.push({
    text: lx.text.slice(seg.start, seg.end).replace(/\s+/g, ' ').trim(),
    argv,
    words,
    program: words[0] ?? '',
    redirects: seg.redirects,
    separator,
    pipeline: 0,
    condition,
    succeeded: false,
    decides: false,
    depth: 0,
    folder: null,
  });
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
      value += next === '\n' ? '' : next;
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
 * here-documents inside it are skipped whole: agents write commit messages as
 * `git commit -m "$(cat <<'EOF' … EOF)"`, and a message may hold anything.
 * @param {string} text @param {number} from @param {string} escape
 */
function substitutionEnd(text, from, escape) {
  let depth = 1;
  /** @type {{ redirect: Redirect, tabs: boolean }[]} */
  const docs = [];
  let i = from;
  while (i < text.length) {
    const c = text[i];
    const doc = c === '<' && text.startsWith('<<', i) && text[i + 2] !== '<' ? HERE_DOC.exec(text.slice(i, i + 200)) : null;
    if (c === escape) i += 2;
    else if (c === "'") i = closing(text, i + 1, "'");
    else if (c === '"') i = readDouble(text, i + 1, escape).end;
    else if (doc) {
      docs.push({ redirect: { op: '<<', fd: '', target: doc[2] ?? doc[3] ?? doc[4], body: '' }, tabs: doc[1] === '-' });
      i += doc[0].length;
    } else if (c === '\n' && docs.length) i = readBodies(text, i + 1, docs.splice(0));
    else if (c === '(' || c === ')') {
      depth += c === '(' ? 1 : -1;
      i += 1;
      if (depth === 0) return i;
    } else i += 1;
  }
  return text.length;
}

/**
 * Reads the bodies of here-documents, in order, from the start of the line after their command:
 * each runs to a line that is its delimiter alone (leading tabs allowed for `<<-`).
 * @param {string} text @param {number} from @param {{ redirect: Redirect, tabs: boolean }[]} docs
 * @returns {number} where the line after the last body starts
 */
function readBodies(text, from, docs) {
  let at = from;
  for (const { redirect, tabs } of docs) {
    /** @type {string[]} */
    const lines = [];
    while (at < text.length) {
      const end = text.indexOf('\n', at);
      const stop = end < 0 ? text.length : end;
      const line = text.slice(at, stop).replace(/\r$/, '');
      at = stop + 1;
      if ((tabs ? line.replace(/^\t+/, '') : line) === redirect.target) break;
      lines.push(tabs ? line.replace(/^\t+/, '') : line);
    }
    redirect.body = lines.join('\n');
  }
  return Math.min(at, text.length);
}
