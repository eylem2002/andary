// Two agents on the same files (docs/design/agent-health.md §6). An Edit is safe against a stale
// file (it must match what is there), so the losses come from a Write over a file another agent
// changed, and from git commands that sweep up or throw away the changes another agent made in a
// folder (core/git-commands.js tells which). This module remembers who changed which file, and
// finds the hazards:
//
//   edit   an agent edits a file another active agent changed in the last 30 minutes: a note
//   write  it writes the whole file over such a change (or deletes it, a Codex patch): an alert
//   git    it runs such a git command in a folder where another active agent changed files in
//          the last 30 minutes: an alert, detected when the command starts
//
// One hazard per pair of agents and file (or git command); it ends when either agent finishes (a
// helper's SubagentStop, its crew leaving) or after 30 minutes. Agents of different crews count:
// several sessions in one repository is the common case. Pure and bounded: the store feeds it
// (core/store.js) and keeps its hazards on StoreState.hazards, which core/attention.js turns into
// "needs you" items. Paths are compared as given, normalised (core/paths.js).
import { inputKey } from './dialogs.js';
import { baseName, isInside, normalizePath } from './paths.js';
import { own, shortPath } from './text.js';

/** A change counts against another agent's for this long, and a hazard lasts as long. */
export const CONFLICT_MS = 30 * 60_000;
/** Files remembered at once; the one changed the longest ago is forgotten first. */
export const MAX_PATHS = 1000;
/** Agents remembered per file: the ones that changed it most recently. */
export const MAX_AGENTS_PER_PATH = 8;
/** Hazards kept at once; past it the oldest note gives way, or else the oldest alert. */
export const MAX_HAZARDS = 100;

/** @typedef {'edit'|'write'|'git'} HazardKind */

/**
 * Tools whose successful call changes a file, and how: an edit must match what is there, a write
 * replaces the whole file. Codex patches reach the town as Write, Edit and MultiEdit; a deleted
 * file stays `apply_patch` (CONTRACTS §4.12), and loses the other agent's work like a write.
 * @type {Readonly<Record<string, 'edit'|'write'>>}
 */
const FILE_TOOLS = Object.freeze({ Edit: 'edit', MultiEdit: 'edit', NotebookEdit: 'edit', Write: 'write', apply_patch: 'write' });

/**
 * A successful file change, as the store reports it.
 * @typedef {object} ChangeInput
 * @property {string} agent   its agent key
 * @property {string} session
 * @property {string} tool
 * @property {unknown} path   the file as the tool was given it
 * @property {unknown} folder the hook's folder (cwd): a relative path is relative to it
 * @property {number} at      the hook's time
 */

/**
 * A git command starting (core/git-commands.js recognised it).
 * @typedef {object} CommandInput
 * @property {string} agent
 * @property {string} session
 * @property {string} command  what it is, in a few words: "git stash"
 * @property {string} folder   where it runs
 * @property {number} at
 */

/**
 * Two agents on the same files: StoreState.hazards (CONTRACTS §5.1).
 * @typedef {object} Hazard
 * @property {string} id            one per episode: "<kind>:<agentKey>:<otherKey>:<at>", and a file's path hashed
 * @property {HazardKind} kind
 * @property {string} sessionId     the crew of the agent that did it
 * @property {string} agentKey      who changed the file or ran the command
 * @property {string} otherSessionId
 * @property {string} otherKey      whose recent change it concerns
 * @property {number} at            when it started (the hook's time)
 * @property {string} folder        where: the hook's folder, or the command's after `cd` or `git -C`
 * @property {string|null} path     edit, write: the file, absolute and normalised
 * @property {string|null} tool     edit, write: the tool that changed it
 * @property {string|null} command  git: what was recognised
 * @property {number} theirsAt      when the other agent last changed the file (git: a file there) before
 * @property {number} files         git: how many files the other agent changed there (else 1)
 */

/**
 * One agent's latest change of one file.
 * @typedef {object} Mark
 * @property {string} agent
 * @property {string} session
 * @property {string} folder  the folder it worked in then
 * @property {number} at
 */

/**
 * The rules' memory: who changed which file lately, and the hazards found. Bounded by
 * MAX_PATHS files of MAX_AGENTS_PER_PATH agents each, and MAX_HAZARDS hazards.
 */
export function createConflicts() {
  /** @type {Map<string, Map<string, Mark>>} file → agent → its latest change; least recently changed first */
  const paths = new Map();
  /** @type {Hazard[]} oldest first */
  let hazards = [];
  let latest = 0;

  /** @param {Hazard} hazard */
  function add(hazard) {
    hazards.push(hazard);
    if (hazards.length > MAX_HAZARDS) {
      const note = hazards.findIndex((h) => h.kind === 'edit' && h !== hazard);
      hazards.splice(Math.max(note, 0), 1);
    }
    return hazard;
  }

  /** @param {(hazard: Hazard) => boolean} which @returns {boolean} whether any ended */
  function drop(which) {
    const before = hazards.length;
    hazards = hazards.filter((hazard) => !which(hazard));
    return hazards.length !== before;
  }

  /** @param {(mark: Mark) => boolean} which */
  function forget(which) {
    for (const [path, marks] of paths) {
      for (const [agent, mark] of marks) if (which(mark)) marks.delete(agent);
      if (!marks.size) paths.delete(path);
    }
  }

  /** @param {string} path @param {Mark} mark */
  function remember(path, mark) {
    const marks = paths.get(path) ?? new Map();
    paths.delete(path);
    marks.delete(mark.agent);
    marks.set(mark.agent, mark);
    if (marks.size > MAX_AGENTS_PER_PATH) marks.delete(marks.keys().next().value);
    paths.set(path, marks);
    if (paths.size > MAX_PATHS) paths.delete(paths.keys().next().value);
  }

  /**
   * The same pair on the same file goes on as one episode, until the other agent changes the
   * file again or an edit turns into a write; then a new one replaces it.
   * @param {ChangeInput & { kind: 'edit'|'write', path: string, folder: string }} change
   * @param {Mark} theirs
   * @returns {Hazard|null}
   */
  function fileHazard(change, theirs) {
    const same = hazards.find((h) => h.kind !== 'git' && h.path === change.path && h.agentKey === change.agent && h.otherKey === theirs.agent);
    if (same && theirs.at <= same.at && !(same.kind === 'edit' && change.kind === 'write')) return null;
    if (same) drop((h) => h === same);
    return add({
      // The path goes in hashed, as a dialog's input does: ids end up in notification tags.
      id: `${change.kind}:${change.agent}:${theirs.agent}:${change.at}:${inputKey(change.path)}`,
      kind: change.kind,
      sessionId: change.session,
      agentKey: change.agent,
      otherSessionId: theirs.session,
      otherKey: theirs.agent,
      at: change.at,
      folder: change.folder,
      path: change.path,
      tool: change.tool,
      command: null,
      theirsAt: theirs.at,
      files: 1,
    });
  }

  /**
   * A git command over another agent's changes. Run again, the same command alerts again only
   * for changes newer than the last time: what it swept up then was seen.
   * @param {CommandInput & { folder: string }} call
   * @param {Mark[]} theirs  that agent's changes there
   * @returns {Hazard|null}
   */
  function gitHazard(call, theirs) {
    const other = theirs[0];
    const before = hazards.findLast((h) => h.kind === 'git' && h.agentKey === call.agent && h.otherKey === other.agent && h.folder === call.folder && h.command === call.command);
    const fresh = before ? theirs.filter((mark) => mark.at > before.at) : theirs;
    if (!fresh.length) return null;
    return add({
      id: `git:${call.agent}:${other.agent}:${call.at}`,
      kind: 'git',
      sessionId: call.session,
      agentKey: call.agent,
      otherSessionId: other.session,
      otherKey: other.agent,
      at: call.at,
      folder: call.folder,
      path: null,
      tool: null,
      command: call.command,
      theirsAt: Math.max(...fresh.map((mark) => mark.at)),
      files: fresh.length,
    });
  }

  return {
    /**
     * A successful file change: remembered, and a hazard for each other active agent that changed
     * the same file in the last CONFLICT_MS.
     * @param {ChangeInput} input
     * @returns {Hazard[]} the hazards it started
     */
    changed(input) {
      const kind = own(FILE_TOOLS, input.tool);
      if (!kind) return [];
      const folder = normalizePath(input.folder);
      const path = normalizePath(input.path, folder);
      if (!path) return [];
      const change = { ...input, kind, path, folder };
      const started = [];
      for (const theirs of recent(paths.get(path), input.agent, input.at)) {
        const hazard = fileHazard(change, theirs);
        if (hazard) started.push(hazard);
      }
      remember(path, { agent: input.agent, session: input.session, folder, at: input.at });
      return started;
    },

    /**
     * A git command starting: a hazard for each other active agent that changed files in its
     * folder in the last CONFLICT_MS (changesIn says which files count).
     * @param {CommandInput} input
     * @returns {Hazard[]} the hazards it started
     */
    command(input) {
      const folder = normalizePath(input.folder);
      if (!folder || !input.command) return [];
      const call = { ...input, folder };
      return [...changesIn(paths, folder, input.agent, input.at).values()].map((theirs) => gitHazard(call, theirs)).filter((hazard) => hazard !== null);
    },

    /**
     * An agent finished (a helper's SubagentStop): its changes are forgotten and its hazards end.
     * @param {string} agent
     * @returns {boolean} whether any hazard ended
     */
    finished(agent) {
      forget((mark) => mark.agent === agent);
      return drop((h) => h.agentKey === agent || h.otherKey === agent);
    },

    /**
     * A crew left (its session ended): the same for every agent of it.
     * @param {string} session
     * @returns {boolean} whether any hazard ended
     */
    ended(session) {
      forget((mark) => mark.session === session);
      return drop((h) => h.sessionId === session || h.otherSessionId === session);
    },

    /**
     * Forgets what is older than CONFLICT_MS at the newest time seen.
     * @param {number} at  a hook's time
     * @returns {boolean} whether any hazard ended
     */
    expire(at) {
      latest = Math.max(latest, at);
      // Files are kept least recently changed first: the first one still recent ends the search.
      for (const [path, marks] of paths) {
        if (Math.max(...[...marks.values()].map((mark) => mark.at)) > latest - CONFLICT_MS) break;
        paths.delete(path);
      }
      return drop((h) => latest - h.at >= CONFLICT_MS);
    },

    /** The hazards now, oldest first (a copy). @returns {Hazard[]} */
    list() {
      return hazards.slice();
    },
  };
}

/**
 * Other agents' changes of one file that came before `at`, within CONFLICT_MS.
 * @param {Map<string, Mark>|undefined} marks
 * @param {string} agent  whose own changes do not count
 * @param {number} at
 * @returns {Mark[]}
 */
function recent(marks, agent, at) {
  return [...(marks?.values() ?? [])].filter((mark) => mark.agent !== agent && mark.at <= at && at - mark.at <= CONFLICT_MS);
}

/**
 * Other agents' recent changes that a git command in `folder` acts on, by agent: the files in
 * that folder, and, when it runs inside the folder another agent worked in, that agent's files in
 * its folder (a command in a repository's subfolder acts on the whole work tree).
 * @param {Map<string, Map<string, Mark>>} paths
 * @param {string} folder
 * @param {string} agent  who runs the command
 * @param {number} at
 * @returns {Map<string, Mark[]>}
 */
function changesIn(paths, folder, agent, at) {
  /** @type {Map<string, Mark[]>} */
  const byAgent = new Map();
  for (const [path, marks] of paths) {
    for (const mark of recent(marks, agent, at)) {
      const below = isInside(folder, mark.folder) && isInside(path, mark.folder);
      if (!below && !isInside(path, folder)) continue;
      const theirs = byAgent.get(mark.agent) ?? [];
      theirs.push(mark);
      byAgent.set(mark.agent, theirs);
    }
  }
  return byAgent;
}

// ---------------------------------------------------------------------------------------------
// In words.

/**
 * A hazard in words for the HUD (the crew rows, the inspector, the activity log), which may show
 * paths and commands: "Wrote over api/auth.ts, which Scout 1 changed 4 min ago", "git stash in
 * api-server, where Builder 1 has changed 3 files". The other agent's crew is named when it is
 * not the same: every crew's lead is a Foreman.
 * @param {Hazard} hazard
 * @param {Pick<import('./store.js').StoreState, 'agents'|'sessions'>} state
 * @param {number} now  for "4 min ago"
 */
export function hazardText(hazard, state, now) {
  const other = agentName(state, hazard.otherKey, hazard.sessionId);
  if (hazard.kind === 'git') {
    const files = hazard.files === 1 ? '1 file' : `${hazard.files} files`;
    return `${hazard.command} in ${baseName(hazard.folder)}, where ${other} has changed ${files}`;
  }
  const verb = hazard.kind === 'edit' ? 'Edited' : hazard.tool === 'apply_patch' ? 'Deleted' : 'Wrote over';
  return `${verb} ${shortPath(hazard.path, hazard.folder)}, which ${other} changed ${ago(now - hazard.theirsAt)}`;
}

/**
 * An agent's name, with its crew's number when it is not of the crew the line is about.
 * @param {Pick<import('./store.js').StoreState, 'agents'|'sessions'>} state
 * @param {string} key
 * @param {string} sessionId
 */
function agentName(state, key, sessionId) {
  const agent = state.agents[key];
  if (!agent) return 'another agent';
  const crew = agent.sessionId === sessionId ? null : state.sessions.find((s) => s.id === agent.sessionId);
  return crew ? `${agent.name} (crew ${crew.number})` : agent.name;
}

/** @param {number} ms */
function ago(ms) {
  return ms < 60_000 ? 'just now' : `${Math.floor(ms / 60_000)} min ago`;
}
