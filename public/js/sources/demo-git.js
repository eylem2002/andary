// Made-up branch lines for the demo (CONTRACTS §4.16), so each crew shows its branch and working
// tree without a repository: the server reads them with git status, the demo counts them from the
// story's own steps. A crew's files edited since its last commit are its changed files; a commit
// is one more commit ahead of its upstream, a push sends them all.
import { gitAction, shellCommands } from '../core/shell.js';

const EDITS = new Set(['Edit', 'MultiEdit', 'Write', 'NotebookEdit']);

/**
 * @param {{ setGit?: (status: unknown) => void }} store
 * @param {() => number} now
 * @param {(cwd: string) => string|null} branchOf  the story's branch for a crew's folder
 */
export function createDemoGit(store, now, branchOf) {
  /** @type {Map<string, { branch: string, files: Set<string>, ahead: number }>} by folder */
  const repos = new Map();

  /** @param {string} cwd */
  function send(cwd) {
    const repo = repos.get(cwd);
    if (!repo) return;
    store.setGit?.({ root: cwd, branch: repo.branch, oid: null, upstream: `origin/${repo.branch}`, ahead: repo.ahead, behind: 0, changed: repo.files.size, untracked: 0, worktree: null, at: now() });
  }

  /** @param {any} payload */
  return function observe(payload) {
    const cwd = typeof payload?.cwd === 'string' ? payload.cwd : '';
    if (!cwd) return;
    let repo = repos.get(cwd);
    if (!repo) {
      const branch = branchOf(cwd);
      if (!branch) return;
      repo = { branch, files: new Set(), ahead: 0 };
      repos.set(cwd, repo);
      send(cwd);
    }
    if (payload.hook_event_name !== 'PostToolUse') return;
    const file = payload.tool_input?.file_path;
    if (EDITS.has(payload.tool_name) && typeof file === 'string') {
      const before = repo.files.size;
      repo.files.add(file);
      if (repo.files.size !== before) send(cwd);
      return;
    }
    if (payload.tool_name !== 'Bash') return;
    const actions = shellCommands(payload.tool_input?.command).map((c) => gitAction(c.words));
    if (actions.includes('commit')) {
      repo.files.clear();
      repo.ahead += 1;
    }
    if (actions.includes('push')) repo.ahead = 0;
    if (actions.some(Boolean)) send(cwd);
  };
}
