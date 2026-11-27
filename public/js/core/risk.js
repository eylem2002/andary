// Risk marks (the "tripwire"): what in a tool call deserves a second look before it runs, named
// in a few words ("deletes recursively", "rewrites remote history", "outside the project: ~/x",
// "reads .env"). The approval card shows them on a red band, the town counts a risky command
// that ran without asking you, and "Always hold risky commands for me" (server/hold.mjs) makes
// Claude Code ask for one even under an allow rule. A reading aid, not a sandbox: aliases,
// scripts, `eval` and variables are not followed, and nothing is ever blocked from here.
//
// The list is short on purpose (every false alarm teaches people to ignore the band):
//   shell (Bash, PowerShell, read by core/shell.js):
//     rm -r / Remove-Item -Recurse            deletes recursively
//     rm of a path outside the project        deletes outside the project: <path>
//     git push --force / -f / +ref / --mirror  rewrites remote history
//     git push --delete / :ref                deletes a remote branch
//     git reset --hard, checkout . / -- / -f, restore (not --staged alone), switch -f
//                                             throws away uncommitted changes
//     git clean -f (not -n)                   deletes untracked files
//     git branch -D (or -d --force)           force-deletes a branch
//     git stash drop / clear                  drops stashed work
//     git filter-branch / filter-repo         rewrites history
//     sudo / doas                             runs as root
//     chmod / chown / chgrp -R                changes permissions recursively
//     curl|wget … | sh (also bash <(curl …))  runs a downloaded script
//     DROP DATABASE|SCHEMA|TABLE, TRUNCATE TABLE, dropdb, redis FLUSHALL|FLUSHDB, db:drop,
//     db:reset, migrate reset                 drops database data
//     > / >> / tee / cp / mv into a path outside the project (not /dev, not a temp folder)
//                                             writes outside the project: <path>
//     a secrets file named (.env and .env.*, but .env.example and the like; *.pem, *.key,
//     id_rsa…, ~/.aws, ~/.ssh, .netrc, .npmrc, .pypirc, .git-credentials, credentials.json)
//                                             reads <file>, or writes <file> as a redirect target
//   Read of a secrets file                    reads <file>
//   Write, Edit, MultiEdit, NotebookEdit      edits <file> (a secrets file); writes outside the
//                                             project: <path>
//   apply_patch (Codex)                       the same, for each file its patch names
// "The project" is the top of the work tree the call runs in (core/paths.js workTreeOf: found
// on disk by the server, else the crew's folder): a path under `~` or $HOME is outside it; a path
// the browser cannot place (another variable) is not judged.
// Pure and defensive: any input, bounded work, never throws. Shared with the server.
import { baseName, isInside, normalizePath, onDrive, workTreeOf } from './paths.js';
import { programOf, readShell } from './shell.js';
import { clip, isObject, str } from './text.js';

/**
 * Where a call runs: the hook's folder, the crew's session folder, and the top of the hook
 * folder's work tree when the server found it on disk (`andary_root`).
 * @typedef {{ folder?: unknown, sessionFolder?: unknown, root?: unknown }} RiskPlace
 */

/**
 * What makes a call risky, in a few words each, most serious first. `quiet`: every reason is a
 * delete of a folder the project rebuilds (node_modules, dist, build…, inside the project): the
 * card shows a softer note, it never counts as "ran without asking", and it is never held.
 * @typedef {{ reasons: string[], quiet?: true }} Risk
 */

/** Reasons kept for one call: the band stays one or two lines. */
const MAX_REASONS = 4;
/** A path in a reason is cut here. */
const PATH_CHARS = 48;
const SHELL_TOOLS = new Set(['Bash', 'PowerShell']);
const FILE_EDIT_TOOLS = new Set(['Write', 'Edit', 'MultiEdit', 'NotebookEdit']);
/** git's options before the subcommand that take the next word as their value. */
const GIT_VALUE_OPTIONS = new Set(['-C', '-c', '--git-dir', '--work-tree', '--namespace', '--super-prefix', '--config-env']);
const FETCHERS = new Set(['curl', 'wget', 'iwr', 'irm', 'invoke-webrequest', 'invoke-restmethod']);
/** Programs that run a script they read from their input. */
const RUNNERS = /^(?:sh|bash|zsh|dash|ksh|fish|pwsh|powershell|iex|invoke-expression|node|perl|ruby|php|python[\d.]*)$/;
const COPIERS = new Set(['tee', 'cp', 'mv', 'copy-item', 'move-item']);
const REMOVERS = new Set(['rm', 'remove-item', 'ri', 'del', 'erase', 'rd', 'rmdir']);
/** cmd.exe's removers, whose options are `/s`, `/q`: never a path. */
const CMD_REMOVERS = new Set(['del', 'erase', 'rd', 'rmdir']);
/** Folders a project rebuilds (dependencies, build output, caches): deleting one inside the project is ordinary. */
const REBUILDABLE = new Set(['node_modules', 'dist', '.next', 'coverage', '.cache', '__pycache__']);
const REBUILDABLE_REASON = 'deletes a rebuildable folder';
/** PowerShell cmdlets that write a file, and their parameters that name it. */
const PS_WRITERS = new Set(['out-file', 'set-content', 'add-content', 'sc', 'ac']);
const PS_PATH_PARAMS = new Set(['-filepath', '-path', '-literalpath', '-pspath']);
/** xargs's options that take the next word as their value. */
const XARGS_VALUED = new Set(['-I', '-n', '-P', '-L', '-d', '-s', '-E', '-a', '--arg-file', '--delimiter', '--max-args', '--max-procs', '--max-lines', '--max-chars', '--replace', '--eof']);
/** Database clients whose arguments (or input) may be SQL. */
const SQL_CLIENTS = new Set(['psql', 'mysql', 'mariadb', 'sqlite3', 'sqlcmd', 'duckdb', 'clickhouse-client', 'cockroach']);
const PERMISSIONS = new Set(['chmod', 'chown', 'chgrp']);
const ROOT_WRAPPERS = new Set(['sudo', 'doas']);
const WRITE_REDIRECTS = new Set(['>', '>>', '>|', '&>', '&>>']);
/** SQL that throws a database's data away, given to a database client. */
const DROPS_SQL = /\b(?:drop\s+(?:database|schema|table)|truncate\s+table)\b/i;
const DROP_WORDS = new Set(['db:drop', 'db:reset', 'db:schema:load', 'flushall', 'flushdb']);
/** Temporary and device paths: writing there is not writing outside the project. */
const SCRATCH = /^(?:\/dev(?:\/|$)|\/tmp(?:\/|$)|\/var\/tmp(?:\/|$)|\/private\/(?:tmp|var\/folders)(?:\/|$)|[A-Za-z]:\/(?:Windows\/)?Temp(?:\/|$)|\/proc\/self\/)/i;
/** The home folder as a shell writes it. */
const HOME = /^(?:~|\$HOME|\$\{HOME\}|\$env:USERPROFILE|%USERPROFILE%)(?=[\\/]|$)/i;
/** A secrets file by its name (examples and templates are not secrets). */
const SECRET_NAMES = [
  /^\.env(?:\.(?!(?:example|sample|template|dist|defaults?|schema)$)[\w.-]+)?$/i,
  /\.(?:pem|key|p12|pfx|jks|keystore)$/i,
  /^id_(?:rsa|dsa|ecdsa|ed25519)$/,
  /^(?:\.netrc|\.npmrc|\.pypirc|\.git-credentials|credentials\.json|\.htpasswd)$/i,
];
/** A secrets folder anywhere in the path. */
const SECRET_FOLDERS = /(?:^|[\\/])\.(?:aws|ssh|gnupg)(?:[\\/]|$)/;
/** The files a Codex patch names: `*** Add File: path`. */
const PATCH_FILE = /^\*\*\* (Add|Update|Delete) File: (.+)$/gm;

/**
 * What makes a tool call risky, or null when nothing on the list applies.
 * @param {unknown} toolName
 * @param {unknown} input  the tool's input (read defensively)
 * @param {RiskPlace} [place]
 * @returns {Risk|null}
 */
export function riskOf(toolName, input, place = {}) {
  try {
    const tool = str(toolName);
    const where = placeOf(place);
    /** @type {string[]} */
    let reasons = [];
    if (SHELL_TOOLS.has(tool)) reasons = shellRisks(isObject(input) ? input.command : input, where, tool === 'PowerShell');
    else if (tool === 'Read') reasons = secretRisk(isObject(input) ? input.file_path : '', 'reads');
    else if (FILE_EDIT_TOOLS.has(tool)) reasons = fileRisks(isObject(input) ? input.file_path ?? input.notebook_path : '', where);
    else if (tool === 'apply_patch') reasons = patchRisks(input, where);
    const unique = [...new Set(reasons)].slice(0, MAX_REASONS);
    if (!unique.length) return null;
    return unique.every((reason) => reason.startsWith(REBUILDABLE_REASON)) ? { reasons: unique, quiet: true } : { reasons: unique };
  } catch {
    return null;
  }
}

/**
 * @typedef {object} Where
 * @property {string} folder  where the call runs, normalised ('' when unknown)
 * @property {string} root    the top of its work tree ('' when unknown)
 */

/** @param {RiskPlace} place @returns {Where} */
function placeOf(place) {
  const folder = normalizePath(place.folder);
  const session = normalizePath(place.sessionFolder);
  const known = normalizePath(place.root);
  const start = folder || session;
  return { folder: start, root: start ? workTreeOf(start, session, known).root : '' };
}

// ---------------------------------------------------------------------------------------------
// Paths.

/**
 * Where a path written in a command or a tool's input lies, when it lies outside the project:
 * the path as written (cut short), else ''. A temp or device path never counts.
 * @param {string} written
 * @param {string|null} folder  where it is relative to
 * @param {string} root
 */
function outside(written, folder, root) {
  const text = written.trim();
  if (!text || text.startsWith('-') || !root) return '';
  if (HOME.test(text)) return clip(text, PATH_CHARS);
  const path = normalizePath(onDrive(text.replace(/\\/g, '/'), root), folder ?? '');
  if (!path || SCRATCH.test(path) || inside(path, root)) return '';
  // Where it lands, as a path of its own: `cd .. && rm -r x` reads as /home/me/x, not x.
  return clip(path, PATH_CHARS);
}

/** A drive letter's path: Windows ignores case, so C:/Work/App and c:/work/app are one folder. */
const ON_DRIVE = /^[A-Za-z]:\//;

/** Whether a normalised path lies in a folder, without regard to case on a Windows drive. @param {string} path @param {string} folder */
function inside(path, folder) {
  return ON_DRIVE.test(path) && ON_DRIVE.test(folder) ? isInside(path.toLowerCase(), folder.toLowerCase()) : isInside(path, folder);
}

/**
 * The rebuildable folder (node_modules, dist…) a delete target lies in, inside the project, or ''.
 * Without a known project, a plain relative path (no `..`, `~` or variable) counts as inside it.
 * @param {string} written @param {string|null} folder @param {string} root
 */
function rebuildable(written, folder, root) {
  const text = written.trim().replace(/\\/g, '/');
  // A variable, a command substitution or %VAR% anywhere can lead anywhere: no quiet note then.
  if (!text || /^~|[$`]|%[^%]*%/.test(text)) return '';
  const path = folder || root ? normalizePath(text, folder ?? root) : '';
  const base = root || folder || '';
  let rest;
  if (path && base) {
    if (!inside(path, base) || path.length === base.length) return '';
    rest = path.slice(base.length).split('/').filter(Boolean);
  } else {
    if (text.startsWith('/') || text.split('/').includes('..')) return '';
    rest = text.split('/').filter((part) => part && part !== '.');
  }
  return rest.find((part) => REBUILDABLE.has(part)) ?? '';
}

/**
 * The secrets file a path names, as its name (".env", "~/.aws/credentials"), or ''.
 * @param {unknown} written
 */
function secretName(written) {
  const text = str(written).trim();
  if (!text || text.startsWith('-')) return '';
  const name = baseName(text.replace(/\\/g, '/'));
  if (SECRET_NAMES.some((pattern) => pattern.test(name))) return clip(name, PATH_CHARS);
  return SECRET_FOLDERS.test(text) ? clip(text, PATH_CHARS) : '';
}

/** @param {unknown} path @param {'reads'|'writes'|'edits'} verb */
function secretRisk(path, verb) {
  const name = secretName(path);
  return name ? [`${verb} ${name}`] : [];
}

/** @param {unknown} path @param {Where} where */
function fileRisks(path, where) {
  const text = str(path);
  const away = outside(text, where.folder || null, where.root);
  return [...secretRisk(text, 'edits'), ...(away ? [`writes outside the project: ${away}`] : [])];
}

/** The files a Codex patch names, from any string in its input. @param {unknown} input @param {Where} where */
function patchRisks(input, where) {
  const texts = typeof input === 'string' ? [input] : isObject(input) ? Object.values(input).flatMap((v) => (Array.isArray(v) ? v : [v])) : [];
  /** @type {string[]} */
  const reasons = [];
  for (const text of texts.filter((t) => typeof t === 'string').slice(0, 8)) {
    for (const [, action, path] of text.matchAll(PATCH_FILE)) {
      const away = outside(path, where.folder || null, where.root);
      reasons.push(...secretRisk(path, 'edits'));
      if (away) reasons.push(`${action === 'Delete' ? 'deletes' : 'writes'} outside the project: ${away}`);
    }
  }
  return reasons;
}

// ---------------------------------------------------------------------------------------------
// Shell commands.

/**
 * @param {unknown} command @param {Where} where @param {boolean} powershell
 * @returns {string[]}
 */
function shellRisks(command, where, powershell) {
  /** @param {string|null} from @param {string} target */
  const resolve = (from, target) => normalizePath(onDrive(target.replace(/\\/g, '/'), from ?? where.root), from ?? '') || null;
  const { segments } = readShell(command, { powershell, folder: where.folder || null, root: where.root || null, resolve });
  /** @type {string[]} */
  const reasons = [];
  for (const segment of segments) {
    const context = { folder: segment.folder, root: where.root };
    reasons.push(...segmentRisks(segment, context));
  }
  const text = typeof command === 'string' ? command : Array.isArray(command) ? command.join(' ') : '';
  reasons.push(...pipedScripts(segments, text.slice(0, 20_000)), ...pipedSql(segments));
  return order(reasons);
}

/** Most serious first: deletions and history, then the rest in the order found. @param {string[]} reasons */
function order(reasons) {
  const rank = (/** @type {string} */ reason) => (/^(?:deletes|rewrites|force|throws|drops)/.test(reason) ? 0 : /^runs/.test(reason) ? 1 : 2);
  return reasons.map((reason, i) => ({ reason, i })).sort((a, b) => rank(a.reason) - rank(b.reason) || a.i - b.i).map(({ reason }) => reason);
}

/**
 * @typedef {object} Context
 * @property {string|null} folder  where the command runs
 * @property {string} root
 */

/**
 * The risks of one simple command.
 * @param {import('./shell.js').Segment} segment @param {Context} context
 * @returns {string[]}
 */
function segmentRisks(segment, context) {
  const [name, ...args] = segment.words[0] === 'xargs' ? xargsCommand(segment.words.slice(1)) : segment.words;
  /** @type {string[]} */
  const reasons = [];
  if (ROOT_WRAPPERS.has(firstProgram(segment.argv))) reasons.push('runs as root (sudo)');
  if (REMOVERS.has(name)) reasons.push(...removeRisks(name, args, context));
  else if (name === 'find') reasons.push(...findRisks(args));
  else if (name === 'git') reasons.push(...gitRisks(args));
  else if (PERMISSIONS.has(name) && args.some(isRecursiveFlag)) reasons.push('changes permissions recursively');
  else if (dropsData(name, args, segment)) reasons.push('drops database data');
  const written = writtenPaths(name, args);
  reasons.push(...copyRisks(written, context), ...redirectRisks(segment, context));
  if (!REMOVERS.has(name)) for (const arg of args) reasons.push(...secretRisk(arg, written.includes(arg) ? 'writes' : 'reads'));
  return reasons;
}

/**
 * The command xargs runs, behind xargs's own options (`xargs -0 -n 1 rm -rf`).
 * @param {string[]} args  xargs's arguments
 */
function xargsCommand(args) {
  let i = 0;
  while (i < args.length && args[i].startsWith('-')) i += XARGS_VALUED.has(args[i]) ? 2 : 1;
  return programOf(args.slice(i));
}

/**
 * `find … -delete`, and `find … -exec rm -r {} +`: deletes what it finds, folders and all.
 * @param {string[]} args
 */
function findRisks(args) {
  if (args.includes('-delete')) return ['deletes recursively (find -delete)'];
  for (const [i, arg] of args.entries()) {
    if (arg !== '-exec' && arg !== '-execdir' && arg !== '-ok' && arg !== '-okdir') continue;
    const [program, ...rest] = programOf(args.slice(i + 1));
    if (REMOVERS.has(program) && rest.some(isRecursiveFlag)) return ['deletes recursively (find -exec rm)'];
  }
  return [];
}

/**
 * A database's data thrown away: dropdb, FLUSHALL, rails db:drop, migrate reset, or SQL that
 * drops or truncates handed to a database client (an argument, a here-document, a here-string).
 * `grep -r "DROP TABLE"` is not one.
 * @param {string} name @param {string[]} args @param {import('./shell.js').Segment} segment
 */
function dropsData(name, args, segment) {
  if (name === 'dropdb' || args.some((arg) => DROP_WORDS.has(arg.toLowerCase())) || (args[0] === 'migrate' && args[1] === 'reset')) return true;
  if (!SQL_CLIENTS.has(name)) return false;
  return args.some((arg) => DROPS_SQL.test(arg)) || segment.redirects.some((r) => DROPS_SQL.test(r.body ?? (r.op === '<<<' ? r.target : '')));
}

/** SQL echoed into a database client: `echo "DROP TABLE x" | psql`. @param {import('./shell.js').Segment[]} segments */
function pipedSql(segments) {
  for (const [i, segment] of segments.entries()) {
    if (!DROPS_SQL.test(segment.text) || SQL_CLIENTS.has(segment.program)) continue;
    if (segments.slice(i + 1).some((later) => later.pipeline === segment.pipeline && SQL_CLIENTS.has(later.program))) return ['drops database data'];
  }
  return [];
}

/** Files a command's write redirects name. @param {import('./shell.js').Segment} segment @param {Context} context */
function redirectRisks(segment, context) {
  /** @type {string[]} */
  const reasons = [];
  for (const redirect of segment.redirects) {
    if (!WRITE_REDIRECTS.has(redirect.op) || /^\d*$|^-$/.test(redirect.target)) continue;
    const away = outside(redirect.target, context.folder, context.root);
    if (away) reasons.push(`writes outside the project: ${away}`);
    reasons.push(...secretRisk(redirect.target, 'writes'));
  }
  return reasons;
}

/** The first word that is not an assignment, lower case. @param {string[]} argv */
function firstProgram(argv) {
  const word = argv.find((w) => !/^[A-Za-z_]\w*=/.test(w)) ?? '';
  return baseName(word.replace(/\\/g, '/')).toLowerCase();
}

/** -r, -R, -rf, -fR, --recursive, PowerShell's -Recurse (not -Force). @param {string} arg */
function isRecursiveFlag(arg) {
  return /^--?recurs(?:e|ive)$/i.test(arg) || (/^-[a-zA-Z]{1,4}$/.test(arg) && /[rR]/.test(arg));
}

/**
 * A delete: recursive, outside the project, of a secrets file, or of a folder the project
 * rebuilds (quieter). cmd.exe's `del /s /q` takes `/s` as an option, not a drive.
 * @param {string} name @param {string[]} args @param {Context} context
 */
function removeRisks(name, args, context) {
  const cmd = CMD_REMOVERS.has(name);
  const isOption = (/** @type {string} */ arg) => arg.startsWith('-') || (cmd && /^\/[a-zA-Z]$/.test(arg));
  const end = args.indexOf('--');
  const options = (end < 0 ? args : args.slice(0, end)).filter(isOption);
  const targets = end < 0 ? args.filter((arg) => !isOption(arg)) : [...args.slice(0, end).filter((arg) => !isOption(arg)), ...args.slice(end + 1)];
  const recursive = options.some((arg) => isRecursiveFlag(arg) || (cmd && /^\/s$/i.test(arg)));
  /** @type {string[]} */
  const reasons = [];
  /** @type {string[]} */
  const ordinary = [];
  for (const target of targets.slice(0, 64)) {
    const away = outside(target, context.folder, context.root);
    if (away) reasons.push(`deletes outside the project: ${away}`);
    const secret = secretName(target);
    if (secret) reasons.push(`deletes ${secret}`);
    const folder = away || secret ? '' : rebuildable(target, context.folder, context.root);
    if (folder) ordinary.push(folder);
  }
  if (recursive && targets.length && ordinary.length === Math.min(targets.length, 64)) return [...reasons, `${REBUILDABLE_REASON} (${[...new Set(ordinary)].join(', ')})`];
  return recursive ? ['deletes recursively', ...reasons] : reasons;
}

/**
 * Where a command writes: tee's files, cp's and mv's last path, and the file of PowerShell's
 * Out-File, Set-Content and Add-Content (its -FilePath or -Path, else its first word).
 * @param {string} name @param {string[]} args
 */
function writtenPaths(name, args) {
  if (PS_WRITERS.has(name)) {
    const at = args.findIndex((arg) => PS_PATH_PARAMS.has(arg.toLowerCase()));
    const path = at >= 0 ? args[at + 1] : args.find((arg) => !arg.startsWith('-'));
    return path ? [path] : [];
  }
  if (!COPIERS.has(name)) return [];
  const paths = args.filter((arg) => !arg.startsWith('-'));
  return name === 'tee' ? paths : paths.slice(-1);
}

/** @param {string[]} written @param {Context} context */
function copyRisks(written, context) {
  /** @type {string[]} */
  const reasons = [];
  for (const path of written.slice(0, 64)) {
    const away = outside(path, context.folder, context.root);
    if (away) reasons.push(`writes outside the project: ${away}`);
  }
  return reasons;
}

/**
 * The risks of a git command: its options before the subcommand skipped, as git reads them.
 * @param {string[]} words  git's arguments
 * @returns {string[]}
 */
function gitRisks(words) {
  let i = 0;
  while (i < words.length && words[i].startsWith('-')) i += GIT_VALUE_OPTIONS.has(words[i]) ? 2 : 1;
  const sub = words[i];
  const args = words.slice(i + 1);
  const rule = sub && Object.hasOwn(GIT_RULES, sub) ? GIT_RULES[sub] : null;
  if (!rule) return [];
  const has = (/** @type {RegExp} */ pattern) => args.some((arg) => pattern.test(arg));
  const reason = rule(args, has);
  return Array.isArray(reason) ? reason : reason ? [reason] : [];
}

/**
 * Each risky git subcommand: its reason when its arguments make it risky, else ''.
 * @type {Readonly<Record<string, (args: string[], has: (pattern: RegExp) => boolean) => string|string[]>>}
 */
const GIT_RULES = Object.freeze({
  push: (args) => pushRisks(args),
  reset: (args) => (args.includes('--hard') ? 'throws away uncommitted changes (reset --hard)' : ''),
  clean: (args, has) => (has(/^(?:-[a-zA-Z]*f[a-zA-Z]*|--force)$/) && !has(/^(?:-[a-zA-Z]*n[a-zA-Z]*|--dry-run)$/) ? 'deletes untracked files (clean -f)' : ''),
  checkout: (args, has) => (args.includes('.') || args.includes('--') || has(/^(?:-f|--force)$/) ? 'throws away uncommitted changes (checkout)' : ''),
  restore: (args, has) => (!args.includes('--staged') || has(/^(?:-W|--worktree)$/) ? 'throws away uncommitted changes (restore)' : ''),
  switch: (args, has) => (has(/^(?:-f|--force|--discard-changes)$/) ? 'throws away uncommitted changes (switch)' : ''),
  branch: (args, has) => (has(/^-[a-zA-Z]*D[a-zA-Z]*$/) || (has(/^(?:-d|--delete)$/) && has(/^(?:-f|--force)$/)) ? 'force-deletes a branch' : ''),
  stash: (args) => (args[0] === 'drop' || args[0] === 'clear' ? 'drops stashed work' : ''),
  'filter-branch': () => 'rewrites history',
  'filter-repo': () => 'rewrites history',
});

/** @param {string[]} args */
function pushRisks(args) {
  /** @type {string[]} */
  const reasons = [];
  const dryRun = args.some((arg) => arg === '--dry-run' || /^-[a-zA-Z]*n[a-zA-Z]*$/.test(arg));
  if (dryRun) return reasons;
  const positional = args.filter((arg) => !arg.startsWith('-'));
  const force = args.some((arg) => /^--force(?:-with-lease)?(?:=|$)/.test(arg) || arg === '--mirror' || /^-[a-zA-Z]*f[a-zA-Z]*$/.test(arg));
  if (force || positional.slice(1).some((ref) => ref.startsWith('+'))) reasons.push('rewrites remote history (force push)');
  if (args.includes('--delete') || args.some((arg) => /^-[a-zA-Z]*d[a-zA-Z]*$/.test(arg)) || positional.slice(1).some((ref) => ref.startsWith(':'))) reasons.push('deletes a remote branch');
  return reasons;
}

/** A shell given a download to run: `bash <(curl …)`, `sh -c "$(curl …)"`, `source <(curl …)`, `eval "$(curl …)"`. */
const SHELL_FED = /\b(?:sh|bash|zsh|dash|ksh)\b[^|;&\n]*?(?:<\(|\$\(|`)\s*(?:curl|wget)\b|(?:^|[\s;&|(])(?:source|\.)\s+<\(\s*(?:curl|wget)\b|\beval\b[^|;&\n]*?(?:\$\(|`)\s*(?:curl|wget)\b/;
/** PowerShell running what it downloads: `iex (iwr …)`, `Invoke-Expression (New-Object Net.WebClient).DownloadString(…)`. */
const PS_RUNS = /\b(?:iex|invoke-expression)\b/i;
const PS_DOWNLOADS = /\b(?:iwr|irm|invoke-webrequest|invoke-restmethod)\b|\.downloadstring\s*\(/i;

/**
 * A download piped into something that runs it: `curl … | sh`, `wget -O- … | bash`, `iwr … |
 * iex`, or a shell fed a download through `<(curl …)` or `"$(curl …)"`.
 * @param {import('./shell.js').Segment[]} segments
 * @param {string} text  the whole line
 * @returns {string[]}
 */
function pipedScripts(segments, text) {
  if (SHELL_FED.test(text)) return ['runs a downloaded script'];
  if (text.split(/\r?\n/).some((line) => PS_RUNS.test(line) && PS_DOWNLOADS.test(line))) return ['runs a downloaded script'];
  for (const [i, segment] of segments.entries()) {
    if (!FETCHERS.has(segment.program)) continue;
    const runner = segments.slice(i + 1).find((later) => later.pipeline === segment.pipeline && RUNNERS.test(later.program));
    if (runner) return ['runs a downloaded script'];
  }
  return [];
}
