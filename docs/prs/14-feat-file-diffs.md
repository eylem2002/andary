# Click a file to see its diff

Part 14 of 26 · base: `feat/sunset-coast-theme`

## What changed

The agent inspector has a new **Changes** section: every file the agent edited or wrote, newest
first, with a "+3 −1" count. Clicking one opens a diff of that change.

- **Store** (`public/js/core/store.js`): each finished Edit, MultiEdit, Write or NotebookEdit
  is kept on the agent as a `FileChange` (`changes`, last 20, newest last; CONTRACTS §5). The
  text comes from the tool call itself (after the server's redaction and 2,000-character cut);
  Andary never reads your files.
- **Diff** (`public/js/ui/diff.js`): a line diff (longest common subsequence; very long texts
  are shown as one changed block).
- **Dialog** (`public/js/ui/changes.js`): added and removed lines carry + and − marks as well
  as colour, and are read out as "Added:" and "Removed:"; Newer and Older step through the
  agent's changes. Escape closes it and leaves the inspector open.

## Tests

- `test/unit/ui/diff.test.mjs`: the diff, the counts, reading each editing tool, and the store
  keeping the last 20 changes with relative paths.
- `e2e/features.spec.mjs`: in the demo, an agent's change opens as a diff on desktop and phone,
  with no axe violations; Escape closes only the dialog.
