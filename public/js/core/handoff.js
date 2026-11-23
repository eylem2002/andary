// Resume and hand off (docs/design/usefulness-study.md §4.7 and §4.11): the command that resumes a
// crew's session in its folder, a Markdown handoff of what the crew is doing (to paste into another
// agent, a pull request or a teammate's chat), and a Markdown standup from Catch me up. Everything
// comes from what the town already holds (the session, its turn receipts, its to-dos, what needs
// you); nothing is summarised by a model, and nothing leaves the browser but through your clipboard.
import { durationWords, runWords } from './receipts.js';
import { shellQuote } from './review.js';
import { oneLine } from './text.js';

/** @typedef {import('./store.js').StoreState} StoreState */
/** @typedef {import('./store.js').Session} Session */
/** @typedef {import('./receipts.js').Receipt} Receipt */

/** Turns whose last words a handoff quotes, newest first. */
export const HANDOFF_TURNS = 3;
/** Files a handoff lists; the rest are counted. */
const HANDOFF_FILES = 25;

/**
 * Inline code that survives backquotes in the text (a longer fence, padded when it starts or ends
 * with one).
 * @param {string} text
 */
export function codeSpan(text) {
  const value = oneLine(text);
  const longest = Math.max(0, ...(value.match(/`+/g) ?? []).map((run) => run.length));
  const fence = '`'.repeat(longest + 1);
  const pad = value.startsWith('`') || value.endsWith('`') ? ' ' : '';
  return `${fence}${pad}${value}${pad}${fence}`;
}

/**
 * The command that resumes a session where it ran: `claude --resume <id>`, or `codex resume <id>`
 * for Codex, after a `cd` into its folder. Null without a session id.
 * @param {Pick<Session, 'id'|'cwd'|'source'>} session
 */
export function resumeCommand(session) {
  if (!session.id || session.id === 'unknown') return null;
  const resume = session.source === 'codex' ? `codex resume ${shellQuote(session.id)}` : `claude --resume ${shellQuote(session.id)}`;
  return session.cwd ? `cd ${shellQuote(session.cwd)} && ${resume}` : resume;
}

/** "- [x] text". @param {{ text?: string, subject?: string, status: string }} item */
function checkbox(item) {
  const mark = item.status === 'completed' ? 'x' : ' ';
  const doing = item.status === 'in_progress' ? ' (in progress)' : '';
  return `- [${mark}] ${oneLine(item.text ?? item.subject ?? '')}${doing}`;
}

/** Every file a crew's kept turns changed, the latest first, with lines added and removed summed. @param {Receipt[]} receipts  newest first */
function filesOf(receipts) {
  /** @type {Map<string, { added: number, removed: number|null, deleted: boolean }>} */
  const files = new Map();
  let more = 0;
  for (const r of receipts) {
    more = Math.max(more, r.moreFiles);
    for (const f of r.files) {
      const seen = files.get(f.path);
      if (!seen) files.set(f.path, { added: f.added, removed: f.removed, deleted: f.deleted });
      else {
        seen.added += f.added;
        seen.removed = seen.removed === null || f.removed === null ? null : seen.removed + f.removed;
      }
    }
  }
  return { files: [...files], more };
}

/**
 * @typedef {object} HandoffInput
 * @property {Session} session
 * @property {Receipt[]} receipts  the crew's kept turn receipts, any order
 * @property {string[]} warnings   what needs you or deserves a second look, in words
 * @property {string|null} [lastMessage]  the lead's last message, when no turn has ended yet
 */

/** One changed file as a list item. @param {[string, { added: number, removed: number|null, deleted: boolean }]} file */
function fileItem([path, f]) {
  const lines = f.deleted ? 'deleted' : f.removed === null ? `+${f.added}, written whole` : `+${f.added} −${f.removed}`;
  return `- ${codeSpan(path)} (${lines})`;
}

/** The files section's lines. @param {Receipt[]} turns  newest first */
function filesSection(turns) {
  const { files, more } = filesOf(turns);
  if (!files.length) return [turns.some((r) => r.shellEdits) ? 'No file edits seen; files may have changed through the shell.' : 'No file changes seen.'];
  const lines = files.slice(0, HANDOFF_FILES).map(fileItem);
  const beyond = Math.max(0, files.length - HANDOFF_FILES) + more;
  if (beyond) lines.push(`- …and ${beyond} more`);
  return lines;
}

/** The tests section's lines. @param {Receipt[]} turns  newest first */
function testsSection(turns) {
  const test = turns.find((r) => r.test)?.test ?? null;
  const build = turns.find((r) => r.build)?.build ?? null;
  const lines = [test ? `- Last test: ${runWords(test)}` : '', build ? `- Last build: ${runWords(build)}` : ''].filter(Boolean);
  return lines.length ? lines : ['No test or build run seen.'];
}

/** The last messages section's lines. @param {Receipt[]} turns  newest first @param {string|null} lastMessage */
function messagesSection(turns, lastMessage) {
  const said = turns.filter((r) => r.said).slice(0, HANDOFF_TURNS);
  const lines = said.map((r) => `- ${new Date(r.end).toISOString().slice(0, 16).replace('T', ' ')} UTC (${durationWords(r.end - r.start)} turn): ${oneLine(r.said)}`);
  if (lines.length) return lines;
  return [lastMessage ? `- ${oneLine(lastMessage)}` : 'No finished turn seen.'];
}

/**
 * A Markdown handoff of one crew: its goal, where it works and how to resume it, the files its
 * turns changed, the latest test and build, open warnings, its to-dos and the last words of its
 * latest turns. Built from what the town holds; it quotes your prompt and the agent's words.
 * @param {HandoffInput} input
 */
export function handoffMarkdown({ session, receipts, warnings, lastMessage = null }) {
  const turns = [...receipts].sort((a, b) => b.end - a.end);
  const resume = resumeCommand(session);
  const todos = [...session.todos.map(checkbox), ...session.tasks.map(checkbox)];
  const lines = [
    `# Handoff: ${oneLine(session.title || session.project || session.id)}`,
    '',
    `- Agent: ${session.source === 'codex' ? 'Codex' : 'Claude Code'}, session ${codeSpan(session.id)}`,
    session.cwd ? `- Folder: ${codeSpan(session.cwd)}` : null,
    resume ? `- Resume: ${codeSpan(resume)}` : null,
    '', '## Goal', '', oneLine(session.goal) || oneLine(session.title) || '(no prompt seen by the town)',
    '', '## Files touched', '', ...filesSection(turns),
    '', '## Tests', '', ...testsSection(turns),
    '', '## Open warnings', '', ...(warnings.length ? warnings.map((w) => `- ${oneLine(w)}`) : ['None.']),
    ...(todos.length ? ['', '## To-dos', '', ...todos] : []),
    '', '## Last messages', '', ...messagesSection(turns, lastMessage),
  ];
  return `${lines.filter((line) => line !== null).join('\n')}\n`;
}

/**
 * @typedef {object} StandupCrew
 * @property {string} name
 * @property {string} words      what it did ("3 turns, tests passing, …"); '' for nothing new
 * @property {string|null} said  its latest finished turn's last message
 * @property {string|null} need  what it needs you for
 * @property {number|null} costUsd  what the crew has cost so far (an estimate)
 */

/**
 * A standup or end-of-day note in Markdown, from Catch me up's lines.
 * @param {{ title: string, period: string, crews: StandupCrew[], quiet: string[] }} input
 */
export function standupMarkdown({ title, period, crews, quiet }) {
  const lines = [`# ${title}`, '', period];
  for (const crew of crews) {
    lines.push('', `## ${oneLine(crew.name)}`, '', `- ${crew.words || 'Nothing new'}`);
    if (crew.said) lines.push(`- Last turn: ${oneLine(crew.said)}`);
    if (crew.need) lines.push(`- Needs you: ${oneLine(crew.need)}`);
    if (crew.costUsd !== null && crew.costUsd > 0) lines.push(`- Cost so far: $${crew.costUsd.toFixed(2)} (estimate)`);
  }
  if (!crews.length) lines.push('', 'No crew did anything in that time.');
  if (quiet.length) lines.push('', `Quiet: ${quiet.map(oneLine).join(', ')}.`);
  return `${lines.join('\n')}\n`;
}
