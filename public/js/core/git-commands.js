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
// The line is read by core/shell.js, the one reader of shell command lines: its commands, a
// shell's `-c` script (`bash -lc '…'`, as Codex sends it) one level deep, the program behind
// wrappers (sudo, env, nice, timeout 30, nohup, time…), and where each runs (cd, pushd, popd and
// PowerShell's forms, `env -C`, `cd "$(git rev-parse --show-toplevel)"`); quotes, comments,
// redirections, $(…) and here-document bodies are read as a shell reads them, so a commit message
// that mentions a command is not that command. `git -C` moves the folder here. Pathspecs are
// relative to the folder a command runs in, with git's magic (:/top, :!exclude, :(glob)…) read;
// past 64 of them a command counts as having none.
import { isInside, normalizePath, onDrive, workTreeOf } from './paths.js';
import { MAX_MOVES, readShell } from './shell.js';
import { clip, own } from './text.js';

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

/** Folder moves followed on one line (shell.js), and `git -C` moves on one git command. */
const MAX_GIT_MOVES = MAX_MOVES;
/** Pathspecs read per command; past them it acts on its folder, or its whole work tree. */
export const MAX_SPECS = 64;
/** A recognised command's words are cut here (a path after `git checkout --` can be long). */
const LABEL_CHARS = 60;
/** git's options before the subcommand that take the next word as their value. */
const GIT_VALUE_OPTIONS = new Set(['-c', '--git-dir', '--work-tree', '--namespace', '--super-prefix', '--config-env']);
/** Pathspecs that name the top of the work tree. */
const TOP_SPECS = new Set([':/', ':/:', ':(top)']);
/** Pathspecs a checkout reads as paths, not as a branch, without a `--` before them. */
const CHECKOUT_PATHS = new Set(['.', './', '*', ...TOP_SPECS]);
/** A pathspec's last part from its first glob character on: the glob stands for its folder. */
const GLOB_TAIL = /(?:^|\/)[^/]*[*?[].*$/;

// ---------------------------------------------------------------------------------------------
// The git commands on a line, and where each runs.

/** @typedef {{ folder: string, root: string, exact: boolean, sub: string, args: string[] }} GitCall */

/**
 * The git commands of a line, in order, each with the folder it runs in and the top of its work
 * tree. The line is read by core/shell.js, which follows cd, pushd, popd and `env -C` with this
 * module's path rules (core/paths.js: a Git Bash drive, the top found on disk or guessed); a git
 * command whose folder cannot be told is left out.
 * @param {unknown} command @param {Place} place @param {ReadOptions} options
 * @returns {GitCall[]}
 */
function gitCalls(command, place, options) {
  const session = normalizePath(place.sessionFolder);
  const known = normalizePath(place.root);
  /** @param {string|null} from @param {string} target */
  const resolve = (from, target) => normalizePath(onDrive(target.replace(/\\/g, '/'), from ?? session), from ?? '') || null;
  const { segments } = readShell(command, {
    powershell: options.powershell === true,
    folder: normalizePath(place.folder) || null,
    root: (from) => workTreeOf(from ?? session, session, known).root || null,
    resolve,
  });
  return segments.flatMap((segment) => (segment.program === 'git' && segment.folder ? gitCall(segment.words, segment.folder, { session, known, resolve }) : []));
}

/**
 * A git call: its folder (after -C), the top of its work tree, subcommand and arguments; none
 * when its folder cannot be told.
 * @param {string[]} words  the program's words (shell.js programOf): git first
 * @param {string} start  where the shell runs it
 * @param {{ session: string, known: string, resolve: (from: string|null, target: string) => string|null }} paths
 * @returns {GitCall[]}
 */
function gitCall(words, start, { session, known, resolve }) {
  /** @type {string|null} */
  let folder = start;
  let moves = 0;
  let i = 1;
  for (; i < words.length && words[i].startsWith('-'); i += 1) {
    if (words[i] === '-C') {
      moves += 1;
      const target = words[++i];
      folder = folder && target && moves <= MAX_GIT_MOVES ? resolve(folder, target) : null;
    } else if (GIT_VALUE_OPTIONS.has(words[i])) i += 1;
  }
  const sub = words[i];
  if (!sub || !folder) return [];
  return [{ folder, ...workTreeOf(folder, session, known), sub, args: words.slice(i + 1) }];
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
