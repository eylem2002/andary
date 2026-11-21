// Tool calls in a few words ("Read src/auth/login.ts", "$ npm test"), and what a shell command or
// an error is about (tests, installs, pushes; not found, permission, timeout). Used by the event
// normaliser, the approvals and the director, and by the server's catch-up (core/digest.js), which
// reads a failed test run's error as the town does (a timeout is no red test). Pure, defensive,
// never throws.

import { clip, hostPath, isObject, listOf, oneLine, own, quoted, shortCommand, shortPath, str } from './text.js';

/** @typedef {'test'|'install'|'deps'|'git-commit'|'git-push'|'rm-rf'|'docker'|'curl'|'build'|'lint'} CommandKind */
/** @typedef {'tests'|'notfound'|'permission'|'timeout'|'interrupted'|'generic'} ErrorKind */

/** @param {Record<string, any>} input @param {string} cwd */
function grepScope(input, cwd) {
  if (input.path) return ` in ${shortPath(input.path, cwd, 32)}`;
  if (input.glob) return ` in ${clip(oneLine(input.glob), 24)}`;
  if (input.type) return ` in *.${clip(oneLine(input.type), 10)}`;
  return '';
}

/** @param {Record<string, any>} input */
export function recipientOf(input) {
  const to = input.to ?? input.recipient ?? input.target ?? input.teammate_name;
  return Array.isArray(to) ? to.map(oneLine).filter(Boolean).join(', ') : oneLine(to);
}

/** @param {unknown} todos */
function todoSummary(todos) {
  const list = listOf(todos);
  if (!list.length) return 'Clear the todo list';
  const done = list.filter((t) => isObject(t) && t.status === 'completed').length;
  return `Todos: ${done}/${list.length} done`;
}

/** @param {Record<string, any>} input */
function taskUpdateSummary(input) {
  const id = str(input.taskId ?? input.task_id ?? input.id) || '?';
  if (input.status) return `Task #${id} → ${oneLine(input.status).replace(/_/g, ' ')}`;
  if (input.owner) return `Task #${id} → ${oneLine(input.owner)}`;
  return `Update task #${id}`;
}

/** @param {Record<string, any>} input */
function spawnSummary(input) {
  const who = oneLine(input.name) || oneLine(input.subagent_type) || 'agent';
  const what = clip(oneLine(input.description), 44);
  return what ? `Spawn ${who}: ${what}` : `Spawn ${who}`;
}

/** @param {string} tool  "mcp__github__create_issue" → "github" */
export function mcpServerOf(tool) {
  if (!tool.startsWith('mcp__')) return null;
  return tool.split('__')[1] || null;
}

/** @type {Readonly<Record<string, (input: Record<string, any>, cwd: string) => string>>} */
const SUMMARIES = Object.freeze({
  Read: (i, cwd) => `Read ${shortPath(i.file_path, cwd) || 'a file'}`,
  NotebookRead: (i, cwd) => `Read ${shortPath(i.notebook_path, cwd) || 'a notebook'}`,
  Write: (i, cwd) => `Write ${shortPath(i.file_path, cwd) || 'a file'}`,
  Edit: (i, cwd) => `Edit ${shortPath(i.file_path, cwd) || 'a file'}`,
  MultiEdit: (i, cwd) => `Edit ${shortPath(i.file_path, cwd) || 'a file'}`,
  NotebookEdit: (i, cwd) => `Edit ${shortPath(i.notebook_path, cwd) || 'a notebook'}`,
  Bash: (i) => `$ ${shortCommand(i.command) || '…'}`,
  PowerShell: (i) => `PS> ${shortCommand(i.command) || '…'}`,
  BashOutput: () => 'Check a background shell',
  KillShell: () => 'Stop a background shell',
  KillBash: () => 'Stop a background shell',
  Monitor: (i) => (i.command ? `Watch $ ${shortCommand(i.command, 48)}` : 'Watch a background task'),
  Grep: (i, cwd) => `grep ${quoted(i.pattern)}${grepScope(i, cwd)}`,
  Glob: (i, cwd) => `glob ${clip(oneLine(i.pattern), 36) || '*'}${i.path ? ` in ${shortPath(i.path, cwd, 28)}` : ''}`,
  LS: (i, cwd) => `ls ${shortPath(i.path, cwd) || '.'}`,
  LSP: (i, cwd) => `LSP ${oneLine(i.operation) || 'lookup'}${i.filePath ? ` in ${shortPath(i.filePath, cwd, 32)}` : ''}`,
  ToolSearch: (i) => `Find a tool for ${quoted(i.query)}`,
  WebFetch: (i) => `Fetch ${hostPath(i.url) || 'a web page'}`,
  WebSearch: (i) => `Search the web for ${quoted(i.query, 40)}`,
  TodoWrite: (i) => todoSummary(i.todos),
  TaskCreate: (i) => `New task: ${clip(oneLine(i.subject), 48) || 'untitled'}`,
  TaskUpdate: (i) => taskUpdateSummary(i),
  TaskList: () => 'Check the task list',
  TaskGet: (i) => `Look at task #${str(i.taskId ?? i.task_id) || '?'}`,
  TaskStop: () => 'Stop a background task',
  TaskOutput: () => 'Read background task output',
  EnterPlanMode: () => 'Start planning',
  ExitPlanMode: () => 'Present the plan',
  SendMessage: (i) => `Message ${recipientOf(i) || 'the team'}`,
  AskUserQuestion: () => 'Ask you a question',
  Skill: (i) => `Use skill ${oneLine(i.skill ?? i.command) || '…'}`,
  SlashCommand: (i) => `Run ${clip(oneLine(i.command), 40) || 'a slash command'}`,
  EnterWorktree: (i) => `Enter worktree ${oneLine(i.name ?? i.path)}`.trim(),
  ExitWorktree: () => 'Leave the worktree',
  Agent: (i) => spawnSummary(i),
  Task: (i) => spawnSummary(i),
});

/**
 * Short human text for a tool call: "Read src/auth/login.ts", "$ npm test",
 * 'grep "TODO" in src', "Fetch docs.python.org/3/library".
 * @param {unknown} tool
 * @param {unknown} input
 * @param {unknown} [cwd]
 * @returns {string}
 */
export function summarizeTool(tool, input, cwd = '') {
  const name = str(tool) || 'Tool';
  const args = isObject(input) ? input : {};
  try {
    if (name.startsWith('mcp__')) {
      const [, server = 'mcp', ...rest] = name.split('__');
      return clip(`${server}: ${rest.join('__') || 'tool'}`, 80);
    }
    const summarize = own(SUMMARIES, name);
    return clip(summarize ? summarize(args, str(cwd)) : name, 80) || name;
  } catch {
    return name;
  }
}

// ---------------------------------------------------------------------------------------------
// Shell commands and errors: what kind of thing happened, so the town can react to it.

const TEST_COMMAND =
  /\b(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?test\b|\b(?:jest|vitest|mocha|ava|pytest|rspec|phpunit)\b|\bplaywright\s+test\b|\bpython3?\s+-m\s+(?:pytest|unittest)\b|\b(?:go|cargo|deno|dotnet|mix)\s+test\b|\bnode\s+--test\b|\b(?:tox|nox)\b|\b(?:mvn|gradlew?)\s+test\b|\bmake\s+test\b/;

/**
 * First match wins, so the order encodes priority ("git add && git commit && git push" ships).
 * 'install' is JavaScript packages (they land in node_modules); 'deps' is every other ecosystem.
 * @type {ReadonlyArray<[CommandKind, RegExp]>}
 */
const COMMAND_KINDS = Object.freeze([
  ['git-push', /\bgit\s+push\b/],
  ['git-commit', /\bgit\s+commit\b/],
  ['rm-rf', /\brm\s+(?:-\w+\s+)*-\w*(?:r\w*f|f\w*r)\w*\b/i],
  ['test', TEST_COMMAND],
  ['install', /\b(?:npm|pnpm|yarn|bun)\s+(?:install|i|add|ci)\b|^\s*(?:pnpm|yarn|bun)\s*$/],
  ['deps', /\b(?:pip3?|uv\s+pip)\s+install\b|\buv\s+(?:sync|add)\b|\bpoetry\s+(?:install|add)\b|\bcargo\s+(?:add|install)\b|\bgo\s+get\b|\b(?:bundle|gem)\s+install\b|\bcomposer\s+(?:install|require)\b/],
  ['docker', /\b(?:docker|podman)(?:-compose)?\b/],
  ['curl', /\b(?:curl|wget)\b/],
  ['build', /\b(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?build\b|\btsc\b|\b(?:cargo|go|uv)\s+build\b|\b(?:vite|next|mkdocs|astro)\s+build\b|\bmake\b|\bpython3?\s+-m\s+build\b/],
  ['lint', /\b(?:eslint|prettier|ruff|flake8|pylint|mypy|biome|stylelint)\b|\b(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?(?:lint|format|typecheck)\b/],
]);

/**
 * @param {unknown} command
 * @returns {CommandKind|null}
 */
export function classifyCommand(command) {
  const c = str(command);
  if (!c.trim()) return null;
  for (const [kind, pattern] of COMMAND_KINDS) {
    if (pattern.test(c)) return kind;
  }
  return null;
}

const TIMED_OUT = /timed?\s*out|timeout|etimedout/i;
const NO_PERMISSION = /permission denied|eacces|eperm|not permitted|access denied|operation not allowed/i;
const NOT_FOUND = /not found|no such file|enoent|does not exist|cannot find|could not find|unknown file/i;

/**
 * Why a tool failed, as far as its first error line tells. A test command failing for any reason
 * other than a timeout means "tests are red", whatever the runner printed.
 * @param {string} error
 * @param {boolean} isInterrupt
 * @param {CommandKind|null} commandKind
 * @returns {ErrorKind}
 */
export function classifyError(error, isInterrupt, commandKind) {
  if (isInterrupt) return 'interrupted';
  if (TIMED_OUT.test(error)) return 'timeout';
  if (commandKind === 'test') return 'tests';
  if (NO_PERMISSION.test(error)) return 'permission';
  if (NOT_FOUND.test(error)) return 'notfound';
  return 'generic';
}
