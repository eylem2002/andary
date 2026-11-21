// What an approval card shows of a request's tool input (CONTRACTS §4.5). A tool with a view of
// its own shows the fields that view renders (a command, a path, a diff), then its other known
// fields as "name: value" lines; any other tool is shown generically, every field. The town may
// hold a request only when its card shows every field of the input as it is: a field the card
// would not show (Bash's sandbox override, an option nobody listed here) sends the request to the
// terminal. Some requests cannot say what allowing them grants (a Codex command may leave its
// sandbox): their card says so in a line of its own. Pure, so the card (ui/format.js) and the
// route (server/routes.mjs) read one list.
import { isObject } from './text.js';

/** @typedef {(value: unknown) => boolean} Shown  whether the tool's own view shows this value as it is */

/** @type {Shown} */
const text = (value) => typeof value === 'string';
/** @type {Shown} */
const flag = (value) => typeof value === 'boolean';
/** A command as one line, or an argument list (Codex) each argument of which is quoted. @type {Shown} */
const command = (value) => text(value) || (Array.isArray(value) && value.every(text));
/** @type {Shown} */
const editMode = (value) => value === 'replace' || value === 'insert' || value === 'delete';
/** A line shows any value as it is. @type {Shown} */
const any = () => true;
/** Only as it is by default: the line may say `false`, never that the sandbox is off. @type {Shown} */
const off = (value) => value === false;
const EDIT_FIELDS = Object.freeze(['old_string', 'new_string', 'replace_all']);
/** A MultiEdit's edits, each one in the diff: nothing in them the diff would leave out, and at least one. @type {Shown} */
const edits = (value) =>
  Array.isArray(value) &&
  value.length > 0 &&
  value.every((edit) => isObject(edit) && Object.keys(edit).every((key) => EDIT_FIELDS.includes(key)) && text(edit.old_string) && text(edit.new_string) && (edit.replace_all === undefined || flag(edit.replace_all)));
const SHELL_LINES = Object.freeze({ description: any, timeout: any, run_in_background: any, dangerouslyDisableSandbox: off });

/**
 * Per tool with a view of its own: `view`, the fields that view renders, each with what its value
 * must be to show as it is; `needs`, the fields without which the view shows none of the others
 * (an Edit with no diff cannot say that it replaces every occurrence); `lines`, the fields the
 * card adds as "name: value" lines, each with the values it may hold there.
 * @type {Readonly<Record<string, { view: Readonly<Record<string, Shown>>, needs: readonly string[], lines: Readonly<Record<string, Shown>> }>>}
 */
export const CARD_FIELDS = Object.freeze({
  Bash: { view: { command }, needs: [], lines: SHELL_LINES },
  PowerShell: { view: { command }, needs: [], lines: SHELL_LINES },
  Write: { view: { file_path: text, content: text }, needs: [], lines: {} },
  Edit: { view: { file_path: text, old_string: text, new_string: text, replace_all: flag }, needs: ['old_string', 'new_string'], lines: {} },
  MultiEdit: { view: { file_path: text, edits }, needs: ['edits'], lines: {} },
  NotebookEdit: { view: { notebook_path: text, new_source: text, edit_mode: editMode, cell_id: text }, needs: ['new_source'], lines: { cell_type: any } },
  Read: { view: { file_path: text }, needs: [], lines: { offset: any, limit: any } },
  WebFetch: { view: { url: text }, needs: [], lines: { prompt: any } },
  WebSearch: { view: { query: text }, needs: [], lines: { allowed_domains: any, blocked_domains: any } },
});

/** What a Codex command's card says: its request does not say whether it leaves the sandbox. */
export const CODEX_SHELL_NOTE = 'Codex did not say what this needs: allowing may let it run outside its sandbox, with network access.';

/**
 * The fields a tool's card shows as "name: value" lines below its own view; [] for a tool shown
 * generically (every field is a line there).
 * @param {string} toolName
 * @returns {readonly string[]}
 */
export function cardLines(toolName) {
  return Object.hasOwn(CARD_FIELDS, toolName) ? Object.keys(CARD_FIELDS[toolName].lines) : [];
}

/**
 * A line the card shows beside the input, for a request whose input cannot say what allowing it
 * grants; '' for any other.
 * @param {string} source  the agent that asked: 'claude' or 'codex'
 * @param {string} toolName
 * @returns {string}
 */
export function cardNote(source, toolName) {
  return source === 'codex' && (toolName === 'Bash' || toolName === 'PowerShell') ? CODEX_SHELL_NOTE : '';
}

/**
 * Whether the approval card shows every field of this input as it is.
 * @param {string} toolName
 * @param {unknown} input
 * @returns {boolean}
 */
export function cardShowsAll(toolName, input) {
  if (!isObject(input)) return false;
  if (!Object.hasOwn(CARD_FIELDS, toolName)) return true;
  const { view, needs, lines } = CARD_FIELDS[toolName];
  if (!needs.every((key) => Object.hasOwn(input, key))) return false;
  return Object.entries(input).every(([key, value]) => {
    if (Object.hasOwn(view, key)) return view[key](value);
    return Object.hasOwn(lines, key) && lines[key](value);
  });
}
