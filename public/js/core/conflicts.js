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
// A file hazard is about one pair of agents and one file; a git hazard about one command. Times
// are the hooks' own, and hooks may arrive out of order: a change that arrives after a newer one
// it came before is judged the other way round. Each hazard ends when its agent finishes (a
// helper's SubagentStop, or its call ending without one; its crew leaving), when every other agent
// it names has, when the command is refused, or after 30 minutes. A helper that finishes leaves
// its changes to its lead: they sit in the tree until someone commits them. Agents of different
// crews count: several sessions in one repository is the common case. Two exceptions keep the
// usual work out: a helper's lead hands it what the lead changed before the helper started (only
// a command that throws changes away still counts those), and a commit that went through takes
// its committer's changes out of harm's way. Pure and bounded: the store feeds it (core/store.js)
// and keeps its hazards on StoreState.hazards, which core/attention.js turns into "needs you"
// items. Paths are compared as given, normalised; a worktree Claude Code makes inside a
// repository (…/.claude/worktrees/<name>) is a work tree of its own (core/paths.js).
import { inputKey } from './dialogs.js';
import { baseName, insideAny, isInside, nestedWorkTree, normalizePath } from './paths.js';
import { own, shortPath } from './text.js';

/** A change counts against another agent's for this long, and a hazard lasts as long. */
export const CONFLICT_MS = 30 * 60_000;
/** Files remembered at once; the one changed the longest ago is forgotten first. */
export const MAX_PATHS = 1000;
/** Agents remembered per file: the ones that changed it most recently. */
export const MAX_AGENTS_PER_PATH = 8;
/** Hazards kept at once; past it the oldest note gives way (a new one too), or else the oldest alert. */
export const MAX_HAZARDS = 100;
/** Git commands remembered for a change that arrives late; the oldest goes first. */
export const MAX_COMMANDS = 50;
/** Agents whose git adds are kept for their next commit, and adds kept for each. */
export const MAX_STAGING_AGENTS = 200;
export const MAX_ADDS_PER_AGENT = 16;

/** @typedef {'edit'|'write'|'git'} HazardKind */
/** @typedef {import('./git-commands.js').GitAdd} GitAdd */

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

/** @typedef {Actor & { tool: string, path: unknown, folder: unknown, created?: boolean }} ChangeInput  a successful file change; created: a new file, untracked until committed */
/**
 * @typedef {Actor & import('./git-commands.js').GitHazard & { toolUseId?: string|null, callKey?: string|null }} CommandInput
 *   a git command starting, with its call's ids so a refusal can end its alert
 */
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
 * @property {string|null} toolUseId  git: the call's id
 * @property {string|null} callKey    git: the server's key for the call's input, as its approval has it
 */

/**
 * One agent's latest change of one file.
 * @typedef {object} Mark
 * @property {string} agent
 * @property {string} session
 * @property {string} folder  the folder it worked in then
 * @property {number} at
 * @property {'edit'|'write'} kind
 * @property {string} tool
 * @property {boolean} created  it made the file: untracked until a commit takes it in
 * @property {string|null} lead  as its Actor: a helper's lead, and when the helper started
 * @property {number} since
 */

/** A git command remembered for changes that arrive after it, though made before. @typedef {CommandInput & { specs: Set<string> }} Command */

/**
 * The rules' memory: who changed which file lately, what each agent staged, the recent git
 * commands, and the hazards found. Bounded by MAX_PATHS files of MAX_AGENTS_PER_PATH agents each,
 * MAX_STAGING_AGENTS agents of MAX_ADDS_PER_AGENT adds, MAX_COMMANDS commands and MAX_HAZARDS
 * hazards.
 */
export function createConflicts() {
  /** @type {Memory} */
  const mem = { paths: new Map(), staging: new Map(), commands: [], hazards: [], latest: 0 };

  return {
    /**
     * A successful file change: remembered, and a hazard for each other active agent that changed
     * the same file in the last CONFLICT_MS (not what the agent's lead handed it). Arriving after
     * another agent's newer change, it is the other way round: that one is over this one.
     * @param {ChangeInput} input
     * @returns {Hazard[]} the hazards it started
     */
    changed(input) {
      const kind = own(FILE_TOOLS, input.tool);
      if (!kind) return [];
      const folder = normalizePath(input.folder);
      const path = normalizePath(input.path, folder);
      if (!path) return [];
      /** @type {Mark} */
      const mark = { agent: input.agent, session: input.session, folder, at: input.at, kind, tool: input.tool, created: input.created === true, lead: input.lead, since: input.since };
      /** @type {Hazard[]} */
      const started = [];
      const marks = [...(mem.paths.get(path)?.values() ?? [])];
      for (const theirs of marks.filter((other) => counts(other, input, false))) started.push(fileHazard(mem, asChange(mark, path), theirs));
      // Only a strictly later one: two changes at one time are judged once, the usual way.
      for (const later of marks.filter((other) => other.at > mark.at && counts(mark, other, false))) started.push(fileHazard(mem, asChange(later, path), mark));
      started.push(...lateForCommands(mem, path, mark));
      remember(mem, path, mark);
      return started.filter((hazard) => hazard !== null);
    },

    /**
     * A git command starting: one hazard naming every other active agent whose changes in the
     * last CONFLICT_MS it acts on (actsOn says which). It is remembered for changes that arrive
     * late.
     * @param {CommandInput} input
     * @returns {Hazard[]} the hazard it started, if any
     */
    command(input) {
      if (!input.folder || !input.command) return [];
      const call = { ...input, specs: new Set(input.paths) };
      mem.commands = [...mem.commands, call].slice(-MAX_COMMANDS);
      /** @type {Map<string, Mark[]>} */
      const byAgent = new Map();
      // Throwing changes away loses them whoever handed them on; sweeping them up does not.
      const handedOn = input.effect === 'discard';
      const tree = nestedWorkTree(input.folder);
      for (const [path, marks] of mem.paths) {
        const on = actsOnPath(input, path, call.specs, tree);
        if (on === false) continue;
        for (const mark of marks.values()) {
          if (!counts(mark, input, handedOn) || !takes(input, mark) || (on === null && !workedAbove(input, path, mark))) continue;
          const list = byAgent.get(mark.agent);
          if (list) list.push(mark);
          else byAgent.set(mark.agent, [mark]);
        }
      }
      const hazard = byAgent.size ? gitHazard(mem, input, byAgent) : null;
      return hazard ? [hazard] : [];
    },

    /**
     * A git command refused (PermissionDenied, or a denial in the town): it ran nothing, so its
     * alert ends. Found by its call's id, or else the agent's latest with the same input.
     * @param {{ agent: string, toolUseId?: string|null, callKey?: string|null }} input
     * @returns {boolean} whether any hazard ended
     */
    refused({ agent, toolUseId = null, callKey = null }) {
      const mine = mem.hazards.filter((h) => h.kind === 'git' && h.agentKey === agent);
      const hazard = (toolUseId ? mine.find((h) => h.toolUseId === toolUseId) : undefined) ?? (callKey ? mine.findLast((h) => h.callKey === callKey) : undefined);
      if (!hazard) return false;
      mem.commands = mem.commands.filter((call) => gitId(call) !== hazard.id);
      return drop(mem, (h) => h === hazard);
    },

    /**
     * A commit that went through: the committer's changes it took in are out of harm's way (with
     * -a, not the files it made: git tracks none of them yet), and what it had staged there is done.
     * @param {CommitInput} input
     */
    committed(input) {
      const specs = new Set(input.paths);
      forget(mem, (mark, path) => mark.agent === input.agent && !(input.tracked && mark.created) && within(input, path, specs));
      const entry = mem.staging.get(input.agent);
      if (entry && input.clears) entry.adds = entry.adds.filter((staged) => staged.root !== input.root);
    },

    /**
     * What a line that went through left staged, for the agent's next commit.
     * @param {string} agent @param {string} session @param {readonly GitAdd[]} adds
     */
    added(agent, session, adds) {
      for (const staged of adds) stage(mem, agent, session, staged);
    },

    /** What the agent staged since its last commit. @param {string} agent @returns {GitAdd[]} */
    staged(agent) {
      return mem.staging.get(agent)?.adds.slice() ?? [];
    },

    /**
     * Whether an agent changed this file lately, or a file in this folder: `git checkout <path>`
     * then reads as a path.
     * @param {string} path  normalised
     */
    knows(path) {
      if (mem.paths.has(path)) return true;
      for (const known of mem.paths.keys()) if (isInside(known, path)) return true;
      return false;
    },

    /**
     * An agent finished (a helper's SubagentStop, or its call ending without one): its hazards
     * end. A helper's changes and what it staged become its lead's (`lead`), and so do hazards
     * about them; without a lead its changes are forgotten.
     * @param {string} agent
     * @param {string|null} [lead]
     * @returns {boolean} whether any hazard changed
     */
    finished(agent, lead = null) {
      const heir = lead && lead !== agent ? lead : null;
      if (heir) bequeath(mem, agent, heir);
      else {
        forget(mem, (mark) => mark.agent === agent);
        mem.staging.delete(agent);
      }
      mem.commands = mem.commands.filter((call) => call.agent !== agent);
      return leave(mem, (h) => h.agentKey === agent, (other) => other.key === agent, heir);
    },

    /**
     * A crew left (its session ended): the same for every agent of it.
     * @param {string} session
     * @returns {boolean} whether any hazard changed
     */
    ended(session) {
      forget(mem, (mark) => mark.session === session);
      for (const [agent, entry] of mem.staging) if (entry.session === session) mem.staging.delete(agent);
      mem.commands = mem.commands.filter((call) => call.session !== session);
      return leave(mem, (h) => h.sessionId === session, (other) => other.sessionId === session);
    },

    /**
     * Forgets what is older than CONFLICT_MS at the newest time seen.
     * @param {number} at  a hook's time
     * @returns {boolean} whether any hazard ended
     */
    expire(at) {
      mem.latest = Math.max(mem.latest, at);
      // Files are kept least recently changed first: the first one still recent ends the search.
      for (const [path, marks] of mem.paths) {
        if (Math.max(...[...marks.values()].map((mark) => mark.at)) > mem.latest - CONFLICT_MS) break;
        mem.paths.delete(path);
      }
      mem.commands = mem.commands.filter((call) => mem.latest - call.at < CONFLICT_MS);
      return drop(mem, (h) => mem.latest - h.at >= CONFLICT_MS);
    },

    /** The hazards now, oldest first (a copy). @returns {Hazard[]} */
    list() {
      return mem.hazards.slice();
    },
  };
}

/**
 * The rules' memory (createConflicts).
 * @typedef {object} Memory
 * @property {Map<string, Map<string, Mark>>} paths  file → agent → its latest change; least recently changed first
 * @property {Map<string, { session: string, adds: GitAdd[] }>} staging  agent → what it staged since its last commit there
 * @property {Command[]} commands  oldest first
 * @property {Hazard[]} hazards  oldest first
 * @property {number} latest  the newest hook time seen
 */

/** @param {Memory} mem @param {Hazard} hazard @returns {Hazard|null} null: the oldest note, it gave way at once */
function add(mem, hazard) {
  mem.hazards.push(hazard);
  if (mem.hazards.length <= MAX_HAZARDS) return hazard;
  const note = mem.hazards.findIndex((h) => h.kind === 'edit');
  const [gone] = mem.hazards.splice(Math.max(note, 0), 1);
  return gone === hazard ? null : hazard;
}

/** @param {Memory} mem @param {(hazard: Hazard) => boolean} which @returns {boolean} whether any ended */
function drop(mem, which) {
  const before = mem.hazards.length;
  mem.hazards = mem.hazards.filter((hazard) => !which(hazard));
  return mem.hazards.length !== before;
}

/**
 * An agent or a crew left: the hazards of what it did end; those about it go on about the
 * others, or about `heir` (a helper's lead, who keeps its changes), or end.
 * @param {Memory} mem
 * @param {(hazard: Hazard) => boolean} did @param {(other: HazardOther) => boolean} gone
 * @param {string|null} [heir]
 * @returns {boolean} whether any changed
 */
function leave(mem, did, gone, heir = null) {
  let changed = false;
  mem.hazards = mem.hazards.flatMap((hazard) => {
    if (did(hazard)) {
      changed = true;
      return [];
    }
    if (!hazard.others.some(gone)) return [hazard];
    changed = true;
    const others = merged(hazard.others.flatMap((other) => (!gone(other) ? [other] : heir ? [{ ...other, key: heir }] : []))).filter((other) => other.key !== hazard.agentKey);
    return others.length ? [{ ...hazard, others }] : [];
  });
  return changed;
}

/** @param {Memory} mem @param {(mark: Mark, path: string) => boolean} which */
function forget(mem, which) {
  for (const [path, marks] of mem.paths) {
    for (const [agent, mark] of marks) if (which(mark, path)) marks.delete(agent);
    if (!marks.size) mem.paths.delete(path);
  }
}

/**
 * A helper's changes become its lead's: still in the tree, nobody has committed them. The
 * newer of two changes of one file stands; a file either of them made stays a new one.
 * @param {Memory} mem
 * @param {string} helper @param {string} lead
 */
function bequeath(mem, helper, lead) {
  for (const marks of mem.paths.values()) {
    const mark = marks.get(helper);
    if (!mark) continue;
    marks.delete(helper);
    const theirs = marks.get(lead);
    const newer = theirs && theirs.at >= mark.at ? theirs : mark;
    marks.delete(lead);
    marks.set(lead, { ...newer, agent: lead, lead: null, since: 0, created: mark.created || (theirs?.created ?? false) });
  }
  const left = mem.staging.get(helper);
  mem.staging.delete(helper);
  if (left) for (const staged of left.adds) stage(mem, lead, left.session, staged);
}

/**
 * Remembers an agent's change of a file. A change that arrives after a newer one of the same
 * agent (hooks may come out of order) leaves the newer one standing.
 * @param {Memory} mem
 * @param {string} path @param {Mark} mark
 */
function remember(mem, path, mark) {
  const marks = mem.paths.get(path) ?? new Map();
  const before = marks.get(mark.agent);
  const created = mark.created || (before?.created ?? false);
  if (before && before.at > mark.at) {
    marks.set(mark.agent, { ...before, created });
    mem.paths.set(path, marks);
    return;
  }
  mem.paths.delete(path);
  marks.delete(mark.agent);
  marks.set(mark.agent, { ...mark, created });
  if (marks.size > MAX_AGENTS_PER_PATH) marks.delete(marks.keys().next().value);
  mem.paths.set(path, marks);
  if (mem.paths.size > MAX_PATHS) mem.paths.delete(mem.paths.keys().next().value);
}

/** @param {Memory} mem @param {string} agent @param {string} session @param {GitAdd} staged */
function stage(mem, agent, session, staged) {
  const entry = mem.staging.get(agent) ?? { session, adds: [] };
  mem.staging.delete(agent);
  entry.adds = [...entry.adds, staged].slice(-MAX_ADDS_PER_AGENT);
  mem.staging.set(agent, entry);
  if (mem.staging.size > MAX_STAGING_AGENTS) mem.staging.delete(mem.staging.keys().next().value);
}

/**
 * The same pair on the same file is one episode until the other agent changes the file again or
 * an edit turns into a write; then a new one replaces it. An alert stays counted until it ends.
 * @param {Memory} mem
 * @param {FileChange} change
 * @param {Mark} theirs
 * @returns {Hazard|null}
 */
function fileHazard(mem, change, theirs) {
  const same = mem.hazards.find((h) => h.kind !== 'git' && h.path === change.path && h.agentKey === change.agent && h.others[0]?.key === theirs.agent);
  if (same && !newEpisode(same, change.kind, theirs)) return null;
  if (same) drop(mem, (h) => h === same);
  return add(mem, {
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
    toolUseId: null,
    callKey: null,
  });
}

/**
 * A git command over other agents' changes: one hazard naming them all. Run again, the same
 * command in the same place alerts again only for changes newer than the last time: what it
 * swept up then was seen.
 * @param {Memory} mem
 * @param {CommandInput} call
 * @param {Map<string, Mark[]>} byAgent  the other agents' changes it acts on
 * @returns {Hazard|null}
 */
function gitHazard(mem, call, byAgent) {
  const before = mem.hazards.findLast((h) => h.kind === 'git' && h.agentKey === call.agent && h.folder === call.folder && h.command === call.command);
  /** @type {HazardOther[]} */
  const others = [];
  for (const [agent, marks] of byAgent) {
    const fresh = before ? marks.filter((mark) => mark.at > before.at) : marks;
    if (fresh.length) others.push({ key: agent, sessionId: fresh[0].session, files: fresh.length, at: Math.max(...fresh.map((mark) => mark.at)) });
  }
  if (!others.length) return null;
  others.sort((a, b) => b.files - a.files || b.at - a.at);
  return add(mem, { id: gitId(call), kind: 'git', sessionId: call.session, agentKey: call.agent, others, at: call.at, folder: call.folder, path: null, tool: null, command: call.command, toolUseId: call.toolUseId ?? null, callKey: call.callKey ?? null });
}

/**
 * A change that arrives after git commands that started later than it was made: each that acts
 * on it counts it too, in its hazard (or in a new one).
 * @param {Memory} mem
 * @param {string} path @param {Mark} mark
 * @returns {Hazard[]} hazards it started
 */
function lateForCommands(mem, path, mark) {
  /** @type {Hazard[]} */
  const started = [];
  const known = mem.paths.get(path)?.get(mark.agent);
  for (const call of mem.commands) {
    if (call.at <= mark.at || !counts(mark, call, call.effect === 'discard') || !takes(call, mark) || !actsOn(call, path, mark, call.specs)) continue;
    // This agent's newer change of the file was there already when the command started.
    if (known && known.at < call.at) continue;
    const index = mem.hazards.findIndex((h) => h.id === gitId(call));
    if (index < 0) {
      const hazard = gitHazard(mem, call, new Map([[mark.agent, [mark]]]));
      if (hazard) started.push(hazard);
      continue;
    }
    const hazard = mem.hazards[index];
    const others = merged([...hazard.others, { key: mark.agent, sessionId: mark.session, files: 1, at: mark.at }]);
    mem.hazards[index] = { ...hazard, others: others.sort((a, b) => b.files - a.files || b.at - a.at) };
  }
  return started;
}

/** @typedef {{ agent: string, session: string, at: number, kind: 'edit'|'write', path: string, folder: string, tool: string }} FileChange */

/** A remembered change as the change that did it. @param {Mark} mark @param {string} path @returns {FileChange} */
function asChange(mark, path) {
  return { agent: mark.agent, session: mark.session, at: mark.at, kind: mark.kind, path, folder: mark.folder, tool: mark.tool };
}

/** A git hazard's id: one per command. @param {Actor} call */
function gitId(call) {
  return `git:${call.agent}:${call.at}`;
}

/**
 * Agents named more than once, as one: their files added up, their latest change kept.
 * @param {HazardOther[]} others
 * @returns {HazardOther[]}
 */
function merged(others) {
  /** @type {Map<string, HazardOther>} */
  const byKey = new Map();
  for (const other of others) {
    const before = byKey.get(other.key);
    byKey.set(other.key, before ? { ...before, files: before.files + other.files, at: Math.max(before.at, other.at) } : other);
  }
  return [...byKey.values()];
}

/**
 * Whether another agent's change came before the actor's, within CONFLICT_MS. What a helper's
 * lead changed before the helper started was handed to the helper (a draft to rewrite, edits to
 * commit): it counts only when `handedOn` says so.
 * @param {Mark} mark
 * @param {Pick<Actor, 'agent'|'at'|'lead'|'since'>} actor
 * @param {boolean} handedOn  count what the lead handed on too
 */
function counts(mark, actor, handedOn) {
  if (mark.agent === actor.agent || mark.at > actor.at || actor.at - mark.at > CONFLICT_MS) return false;
  return handedOn || !(mark.agent === actor.lead && mark.at < actor.since);
}

/**
 * Whether a git command acts on a file of that kind: tracked files (a stash, a checkout), files
 * an agent made and nobody committed yet (git clean), or both.
 * @param {import('./git-commands.js').GitHazard} call @param {Mark} mark
 */
function takes(call, mark) {
  if (call.files === 'tracked') return !mark.created;
  if (call.files === 'untracked') return mark.created;
  return true;
}

/**
 * Whether a git command acts on a file another agent changed. Only within one work tree (a
 * worktree Claude Code made is one of its own): under the command's pathspecs, or anywhere in its
 * work tree when it has none. When the server did not find the top of that on disk it is a guess
 * (core/paths.js workTreeOf), so the folder the other agent worked in counts too when the command
 * runs inside it.
 * @param {import('./git-commands.js').GitHazard} call
 * @param {string} path
 * @param {Mark} mark
 * @param {ReadonlySet<string>} specs  the command's paths
 */
function actsOn(call, path, mark, specs) {
  return actsOnPath(call, path, specs, nestedWorkTree(call.folder)) ?? workedAbove(call, path, mark);
}

/**
 * Whether a git command acts on a file, as far as the file alone tells: null when that depends
 * on where the agent that changed it worked (workedAbove).
 * @param {import('./git-commands.js').GitHazard} call @param {string} path
 * @param {ReadonlySet<string>} specs @param {string} tree  the worktree Claude Code made that the command runs in, or ''
 * @returns {boolean|null}
 */
function actsOnPath(call, path, specs, tree) {
  if (nestedWorkTree(path) !== tree || (call.exact && !isInside(path, call.root))) return false;
  if (specs.size) return insideAny(path, specs);
  return isInside(path, call.root) || (call.exact ? false : null);
}

/**
 * With a guessed top, a command run inside the folder an agent worked in acts on that agent's
 * files there too: git acts on the whole work tree from a subfolder.
 * @param {import('./git-commands.js').GitHazard} call @param {string} path @param {Mark} mark
 */
function workedAbove(call, path, mark) {
  return isInside(call.folder, mark.folder) && isInside(path, mark.folder);
}

/**
 * Whether a commit took in a file: under its paths, or anywhere in its work tree when it took in
 * everything.
 * @param {import('./git-commands.js').GitCommit} commit
 * @param {string} path
 * @param {ReadonlySet<string>} specs  the commit's paths
 */
function within(commit, path, specs) {
  if (nestedWorkTree(path) !== nestedWorkTree(commit.folder)) return false;
  return specs.size ? insideAny(path, specs) : isInside(path, commit.root);
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
