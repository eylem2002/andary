// Reads the patches Codex's `apply_patch` tool writes (the "*** Begin Patch" format), so the town
// can show which files a Codex agent changed and how, like Claude Code's Edit and Write.
//
//   *** Begin Patch
//   *** Add File: path          then "+line" lines
//   *** Delete File: path
//   *** Update File: path       optionally "*** Move to: new path", then hunks:
//   @@ optional context         " line" (kept), "-line" (removed), "+line" (added)
//   *** End Patch

/**
 * @typedef {{ before: string, after: string }} PatchHunk
 * @typedef {object} PatchFile
 * @property {'add'|'delete'|'update'} op
 * @property {string} path
 * @property {string|null} moveTo
 * @property {PatchHunk[]} hunks  for add: one hunk with the new content
 */

const FILE_HEADER = /^\*\*\* (Add|Delete|Update) File: (.+)$/;
const MOVE_TO = /^\*\*\* Move to: (.+)$/;
const MAX_FILES = 50;
const MAX_HUNKS = 20;

/**
 * The files a patch touches, in order; [] for anything that is not a patch.
 * @param {unknown} text
 * @returns {PatchFile[]}
 */
export function parsePatch(text) {
  if (typeof text !== 'string' || !text.trimStart().startsWith('*** Begin Patch')) return [];
  /** @type {PatchFile[]} */
  const files = [];
  /** @type {{ before: string[], after: string[] }|null} */
  let hunk = null;
  const closeHunk = () => {
    const file = files.at(-1);
    if (file && hunk && (hunk.before.length || hunk.after.length) && file.hunks.length < MAX_HUNKS) {
      file.hunks.push({ before: hunk.before.join('\n'), after: hunk.after.join('\n') });
    }
    hunk = null;
  };
  for (const line of text.replace(/\r\n/g, '\n').split('\n')) {
    const header = FILE_HEADER.exec(line);
    if (header) {
      closeHunk();
      if (files.length >= MAX_FILES) break;
      files.push({ op: /** @type {PatchFile['op']} */ (header[1].toLowerCase()), path: header[2].trim(), moveTo: null, hunks: [] });
      if (header[1] === 'Add') hunk = { before: [], after: [] };
      continue;
    }
    if (line.startsWith('*** End Patch')) break;
    const file = files.at(-1);
    if (!file) continue;
    const move = MOVE_TO.exec(line);
    if (move) {
      file.moveTo = move[1].trim();
      continue;
    }
    if (line.startsWith('@@')) {
      if (file.op === 'update') {
        closeHunk();
        hunk = { before: [], after: [] };
      }
      continue;
    }
    if (line.startsWith('*** ')) continue; // "*** End of File" and the like
    if (!hunk && line.trim() === '') continue; // a blank line between files is not context
    hunk ??= { before: [], after: [] };
    addLine(hunk, line);
  }
  closeHunk();
  return files;
}

/**
 * @param {{ before: string[], after: string[] }} hunk
 * @param {string} line
 */
function addLine(hunk, line) {
  const mark = line[0];
  const rest = line.slice(1);
  if (mark === '+') hunk.after.push(rest);
  else if (mark === '-') hunk.before.push(rest);
  else {
    // Context (" line", or a bare empty line) is in both versions.
    hunk.before.push(mark === ' ' ? rest : line);
    hunk.after.push(mark === ' ' ? rest : line);
  }
}
