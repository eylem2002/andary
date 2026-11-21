// Two agents on the same files (docs/design/agent-health.md §6). An Edit is safe against a stale
// file (it must match what is there), so the losses come from a Write over a file another agent
// changed, and from git commands that sweep up or throw away the changes another agent made in a
// work tree (core/git-commands.js tells which). This module remembers who changed which file, and
// finds the hazards:
//
//   edit   an agent edits a file another active agent changed in the last 30 minutes: a note
//   write  it writes the whole file over such a change (or deletes it, a Codex patch): an alert
//   git    it runs such a git command where other active agents changed files in the last 30
//          minutes: one alert naming them all, found when the command starts
//
// A file hazard is about one pair of agents and one file; a git hazard about one command. Each
// ends when its agent finishes (a helper's SubagentStop, or its call ending without one; its crew
// leaving), or when every other agent it names has, or after 30 minutes. Agents of different
// crews count: several sessions in one repository is the common case. Two exceptions keep the
// usual work out: a helper's lead hands it what the lead changed before the helper started (only
// a command that throws changes away still counts those), and a commit that went through takes
// its committer's changes out of harm's way. Pure and bounded: the store feeds it (core/store.js)
// and keeps its hazards on StoreState.hazards, which core/attention.js turns into "needs you"
// items. Paths are compared as given, normalised; a worktree Claude Code makes inside a
// repository (…/.claude/worktrees/<name>) is a work tree of its own (core/paths.js).
import { inputKey } from './dialogs.js';
import { baseName, isInside, normalizePath, sameWorkTree } from './paths.js';
import { own, shortPath } from './text.js';

/** A change counts against another agent's for this long, and a hazard lasts as long. */
export const CONFLICT_MS = 30 * 60_000;
/** Files remembered at once; the one changed the longest ago is forgotten first. */
export const MAX_PATHS = 1000;
/** Agents remembered per file: the ones that changed it most recently. */
export const MAX_AGENTS_PER_PATH = 8;
/** Hazards kept at once; past it the oldest note gives way (a new one too), or else the oldest alert. */
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
 * The agent that did something, as the store reports it.
 * @typedef {object} Actor
 * @property {string} agent         its agent key
 * @property {string} session
 * @property {number} at            the hook's time
 * @property {string|null} lead     its crew's lead when it is a helper, else null
 * @property {number} since         when it started (a helper's SubagentStart)
 */

/** @typedef {Actor & { tool: string, path: unknown, folder: unknown }} ChangeInput  a successful file change */
/** @typedef {Actor & import('./git-commands.js').GitHazard} CommandInput  a git command starting */
/** @typedef {{ agent: string } & import('./git-commands.js').GitCommit} CommitInput  a commit that went through */

/**
 * An agent whose recent changes a hazard is about.
 * @typedef {object} HazardOther
 * @property {string} key
 * @property {string} sessionId
 * @property {number} files   how many of its changed files (a file hazard: 1)
 * @property {number} at      when it last changed one of them
 */

/**
 * Two agents on the same files: StoreState.hazards (CONTRACTS §5.1).
 * @typedef {object} Hazard
 * @property {string} id            one per episode: "<kind>:<agentKey>:<at>", and for a file the other agent's key and the path hashed
 * @property {HazardKind} kind
 * @property {string} sessionId     the crew of the agent that did it
 * @property {string} agentKey      who changed the file or ran the command
 * @property {HazardOther[]} others whose changes it is about: one for a file, one or more for a command
 * @property {number} at            when it started (the hook's time)
 * @property {string} folder        where: the hook's folder, or the command's after `cd` or `git -C`
 * @property {string|null} path     edit, write: the file, absolute and normalised
 * @property {string|null} tool     edit, write: the tool that changed it
 * @property {string|null} command  git: what was recognised
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

  /** @param {Hazard} hazard @returns {Hazard|null} null: the oldest note, it gave way at once */
  function add(hazard) {
    hazards.push(hazard);
    if (hazards.length <= MAX_HAZARDS) return hazard;
    const note = hazards.findIndex((h) => h.kind === 'edit');
    const [gone] = hazards.splice(Math.max(note, 0), 1);
    return gone === hazard ? null : hazard;
  }

  /** @param {(hazard: Hazard) => boolean} which @returns {boolean} whether any ended */
  function drop(which) {
    const before = hazards.length;
    hazards = hazards.filter((hazard) => !which(hazard));
    return hazards.length !== before;
  }

  /**
   * An agent or a crew left: the hazards of what it did end, and so do those about it alone; one
   * that names others too goes on without it.
   * @param {(hazard: Hazard) => boolean} did @param {(other: HazardOther) => boolean} gone
   * @returns {boolean} whether any changed
   */
  function leave(did, gone) {
    let changed = false;
    hazards = hazards.flatMap((hazard) => {
      const others = did(hazard) ? [] : hazard.others.filter((other) => !gone(other));
      if (others.length === hazard.others.length) return [hazard];
      changed = true;
      return others.length ? [{ ...hazard, others }] : [];
    });
    return changed;
  }

  /** @param {(mark: Mark, path: string) => boolean} which */
  function forget(which) {
    for (const [path, marks] of paths) {
      for (const [agent, mark] of marks) if (which(mark, path)) marks.delete(agent);
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
   * The same pair on the same file is one episode until the other agent changes the file again or
   * an edit turns into a write; then a new one replaces it. An alert stays counted until it ends.
   * @param {ChangeInput & { kind: 'edit'|'write', path: string, folder: string }} change
   * @param {Mark} theirs
   * @returns {Hazard|null}
   */
  function fileHazard(change, theirs) {
    const same = hazards.find((h) => h.kind !== 'git' && h.path === change.path && h.agentKey === change.agent && h.others[0]?.key === theirs.agent);
    if (same && !newEpisode(same, change.kind, theirs)) return null;
    if (same) drop((h) => h === same);
    return add({
      // The path goes in hashed, as a dialog's input does: ids end up in notification tags.
      id: `${change.kind}:${change.agent}:${change.at}:${theirs.agent}:${inputKey(change.path)}`,
      kind: change.kind,
      sessionId: change.session,
      agentKey: change.agent,
      others: [{ key: theirs.agent, sessionId: theirs.session, files: 1, at: theirs.at }],
      at: change.at,
      folder: change.folder,
      path: change.path,
      tool: change.tool,
      command: null,
    });
  }

  /**
   * A git command over other agents' changes: one hazard naming them all. Run again, the same
   * command in the same place alerts again only for changes newer than the last time: what it
   * swept up then was seen.
   * @param {CommandInput} call
   * @param {Map<string, Mark[]>} byAgent  the other agents' changes it acts on
   * @returns {Hazard|null}
   */
  function gitHazard(call, byAgent) {
    const before = hazards.findLast((h) => h.kind === 'git' && h.agentKey === call.agent && h.folder === call.folder && h.command === call.command);
    /** @type {HazardOther[]} */
    const others = [];
    for (const [agent, marks] of byAgent) {
      const fresh = before ? marks.filter((mark) => mark.at > before.at) : marks;
      if (fresh.length) others.push({ key: agent, sessionId: fresh[0].session, files: fresh.length, at: Math.max(...fresh.map((mark) => mark.at)) });
    }
    if (!others.length) return null;
    others.sort((a, b) => b.files - a.files || b.at - a.at);
    return add({ id: `git:${call.agent}:${call.at}`, kind: 'git', sessionId: call.session, agentKey: call.agent, others, at: call.at, folder: call.folder, path: null, tool: null, command: call.command });
  }

  return {
    /**
     * A successful file change: remembered, and a hazard for each other active agent that changed
     * the same file in the last CONFLICT_MS (not what the agent's lead handed it).
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
      /** @type {Hazard[]} */
      const started = [];
      for (const theirs of recent(paths.get(path), input, false)) {
        const hazard = fileHazard(change, theirs);
        if (hazard) started.push(hazard);
      }
      remember(path, { agent: input.agent, session: input.session, folder, at: input.at });
      return started;
    },

    /**
     * A git command starting: one hazard naming every other active agent whose changes in the
     * last CONFLICT_MS it acts on (actsOn says which).
     * @param {CommandInput} input
     * @returns {Hazard[]} the hazard it started, if any
     */
    command(input) {
      if (!input.folder || !input.command) return [];
      /** @type {Map<string, Mark[]>} */
      const byAgent = new Map();
      for (const [path, marks] of paths) {
        // Throwing changes away loses them whoever handed them on; sweeping them up does not.
        for (const mark of recent(marks, input, input.effect === 'discard').filter((m) => actsOn(input, path, m))) {
          byAgent.set(mark.agent, (byAgent.get(mark.agent) ?? []).concat(mark));
        }
      }
      const hazard = byAgent.size ? gitHazard(input, byAgent) : null;
      return hazard ? [hazard] : [];
    },

    /**
     * A commit that went through: the committer's changes it took in are out of harm's way.
     * @param {CommitInput} input
     */
    committed(input) {
      forget((mark, path) => mark.agent === input.agent && within(input, path));
    },

    /**
     * An agent finished (a helper's SubagentStop, or its call ending without one): its changes are
     * forgotten, and its hazards end.
     * @param {string} agent
     * @returns {boolean} whether any hazard changed
     */
    finished(agent) {
      forget((mark) => mark.agent === agent);
      return leave((h) => h.agentKey === agent, (other) => other.key === agent);
    },

    /**
     * A crew left (its session ended): the same for every agent of it.
     * @param {string} session
     * @returns {boolean} whether any hazard changed
     */
    ended(session) {
      forget((mark) => mark.session === session);
      return leave((h) => h.sessionId === session, (other) => other.sessionId === session);
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
 * Other agents' changes of one file that came before the actor's, within CONFLICT_MS. What a
 * helper's lead changed before the helper started was handed to the helper (a draft to rewrite,
 * edits to commit): it counts only when `handedOn` says so.
 * @param {Map<string, Mark>|undefined} marks
 * @param {Actor} actor
 * @param {boolean} handedOn  count what the lead handed on too
 * @returns {Mark[]}
 */
function recent(marks, actor, handedOn) {
  return [...(marks?.values() ?? [])].filter((mark) => {
    if (mark.agent === actor.agent || mark.at > actor.at || actor.at - mark.at > CONFLICT_MS) return false;
    return handedOn || !(mark.agent === actor.lead && mark.at < actor.since);
  });
}

/**
 * Whether a git command acts on a file another agent changed. Only within one work tree (a
 * worktree Claude Code made is one of its own): under the command's pathspecs, or anywhere in its
 * work tree when it has none; the top of that is a guess (core/paths.js workTreeRoot), so the
 * folder the other agent worked in counts too when the command runs inside it.
 * @param {import('./git-commands.js').GitHazard} call
 * @param {string} path
 * @param {Mark} mark
 */
function actsOn(call, path, mark) {
  if (!sameWorkTree(path, call.folder)) return false;
  if (call.paths.length) return call.paths.some((spec) => isInside(path, spec));
  return isInside(path, call.root) || (isInside(call.folder, mark.folder) && isInside(path, mark.folder));
}

/**
 * Whether a commit took in a file: under its paths, or anywhere in its work tree when it took in
 * everything.
 * @param {import('./git-commands.js').GitCommit} commit
 * @param {string} path
 */
function within(commit, path) {
  if (!sameWorkTree(path, commit.folder)) return false;
  return commit.paths.length ? commit.paths.some((spec) => isInside(path, spec)) : isInside(path, commit.root);
}

/**
 * Whether a change by the same pair on the same file starts a new episode: a write over a note,
 * or any change over the other agent's newer change. An edit after an alert adds nothing.
 * @param {Hazard} same @param {'edit'|'write'} kind @param {Mark} theirs
 */
function newEpisode(same, kind, theirs) {
  if (same.kind === 'write' && kind === 'edit') return false;
  return (same.kind === 'edit' && kind === 'write') || theirs.at > same.at;
}

// ---------------------------------------------------------------------------------------------
// In words.

/**
 * A hazard in words for the HUD (the crew rows, the inspector, the activity log), which may show
 * paths and commands. It names who did it, with its crew's number, and the others, with theirs
 * when it is another crew (every crew's lead is a Foreman): "Foreman (crew 2) wrote over
 * src/auth.ts, which Foreman (crew 1) changed 4 min ago", "Builder 1 (crew 2) runs git stash in
 * api-server, where Foreman (crew 1) and Scout 1 have changed 5 files" (Scout 1 of crew 2).
 * @param {Hazard} hazard
 * @param {Pick<import('./store.js').StoreState, 'agents'|'sessions'>} state
 * @param {number} now  for "4 min ago"
 */
export function hazardText(hazard, state, now) {
  const actor = agentName(state, hazard.agentKey, null) ?? 'An agent';
  const others = hazard.others.map((other) => agentName(state, other.key, hazard.sessionId) ?? 'another agent');
  if (hazard.kind === 'git') {
    const files = hazard.others.reduce((sum, other) => sum + other.files, 0);
    return `${actor} runs ${hazard.command} in ${baseName(hazard.folder)}, where ${listed(others)} ${others.length === 1 ? 'has' : 'have'} changed ${files === 1 ? '1 file' : `${files} files`}`;
  }
  const verb = hazard.kind === 'edit' ? 'edited' : hazard.tool === 'apply_patch' ? 'deleted' : 'wrote over';
  return `${actor} ${verb} ${shortPath(hazard.path, hazard.folder)}, which ${others[0]} changed ${ago(now - hazard.others[0].at)}`;
}

/**
 * An agent's name, with its crew's number unless it is of the crew `beside` (null: always).
 * @param {Pick<import('./store.js').StoreState, 'agents'|'sessions'>} state
 * @param {string} key
 * @param {string|null} beside
 * @returns {string|null} null when the agent is gone
 */
function agentName(state, key, beside) {
  const agent = state.agents[key];
  if (!agent) return null;
  const crew = agent.sessionId === beside ? null : state.sessions.find((s) => s.id === agent.sessionId);
  return crew ? `${agent.name} (crew ${crew.number})` : agent.name;
}

/** "Scout 1", "Scout 1 and Builder 2", "Scout 1 and 2 others". @param {string[]} names */
function listed(names) {
  if (names.length <= 2) return names.join(' and ');
  return `${names[0]} and ${names.length - 1} others`;
}

/** @param {number} ms */
function ago(ms) {
  return ms < 60_000 ? 'just now' : `${Math.floor(ms / 60_000)} min ago`;
}
