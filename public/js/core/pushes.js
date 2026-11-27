// "Pushed while the last test run failed" (CONTRACTS §5.1): a crew that pushed with git while its
// latest test run had failed. Pure: the store feeds it the events it applied.
//
// A crew's latest test result is any of its agents' (the lead's or a helper's), read as Catch me
// up reads it (core/digest.js testOutcome): only a proven result counts, so `npm test | tail`
// proves nothing either way and leaves the last proven result standing, and a run that timed out
// is no failure. A push is one a shell call sent and
// that must have succeeded (core/digest.js pushesSent: not a dry run, a deletion, or "Everything
// up-to-date"); from Codex only when its exit code was found. Tests and a push on one line are
// read in that order, so `npm test && git push` never counts.
//
// The warning stays until you set it aside, until the crew pushes again after a test run that
// passed, or until the crew leaves. A teammate's crew (a team town) is theirs: it is not followed.
import { pushesSent, testOutcome } from './digest.js';
import { shellCommands } from './shell.js';
import { clip, oneLine, str } from './text.js';

/**
 * @typedef {object} RedPush
 * @property {string} id
 * @property {string} sessionId
 * @property {string} agentKey   who pushed
 * @property {number} at         when the push finished
 * @property {string} test       the failed test run's command, clipped
 * @property {number} testAt     when that run finished
 * @property {string} push       the push's command line, clipped
 */

/** @typedef {import('./events.js').TownEvent} TownEvent */

const SHELL_TOOLS = new Set(['Bash', 'PowerShell']);
const COMMAND_CHARS = 160;

/**
 * How many pushes a finished shell call sent, as far as it proves: none from one sent to the
 * background (only started) or from Codex without its exit code.
 * @param {TownEvent} e
 */
function pushesOf(e) {
  const d = e.data;
  if (e.kind !== 'tool.end' || d.input?.run_in_background === true || (e.source === 'codex' && d.exitKnown !== true)) return 0;
  return pushesSent(shellCommands(d.input?.command, { powershell: d.tool === 'PowerShell' }), d.response);
}

/**
 * What a finished shell call proves of its tests, as Catch me up reads it.
 * @param {TownEvent} e
 */
function testResultOf(e) {
  const d = e.data;
  return testOutcome({
    tool: d.tool,
    command: d.input?.command,
    background: d.input?.run_in_background === true,
    error: e.kind === 'tool.fail' ? str(d.errorText) || str(d.error) : null,
    interrupted: d.isInterrupt === true,
    exitUnknown: e.source === 'codex' && d.exitKnown !== true,
  });
}

export function createPushChecks() {
  /** @type {Map<string, { test: { result: string, command: string, at: number }|null, red: RedPush|null }>} by session */
  const crews = new Map();

  /** @param {string} sessionId */
  const crewOf = (sessionId) => {
    let crew = crews.get(sessionId);
    if (!crew) {
      crew = { test: null, red: null };
      crews.set(sessionId, crew);
    }
    return crew;
  };

  return {
    /**
     * One applied event. Returns whether the crews' warnings changed, and the warning it raised.
     * @param {TownEvent} e
     * @param {{ member?: boolean }} [options]  member: a teammate's crew
     * @returns {{ changed: boolean, raised: RedPush|null }}
     */
    record(e, { member = false } = {}) {
      if (e.kind === 'session.end') {
        const had = Boolean(crews.get(e.sessionId)?.red);
        crews.delete(e.sessionId);
        return { changed: had, raised: null };
      }
      if (member || (e.kind !== 'tool.end' && e.kind !== 'tool.fail') || !SHELL_TOOLS.has(e.data.tool)) return { changed: false, raised: null };
      const crew = crewOf(e.sessionId);
      // Only a proven result counts: one that proves nothing leaves the last proven one standing.
      const result = testResultOf(e);
      if (result) crew.test = { result, command: clip(oneLine(e.data.input?.command), COMMAND_CHARS), at: e.ts };
      if (!pushesOf(e)) return { changed: false, raised: null };
      if (crew.test?.result !== 'failed') {
        const had = Boolean(crew.red);
        // Pushed again after a run that passed: what was pushed red has been pushed over.
        if (crew.test?.result === 'passed') crew.red = null;
        return { changed: had && !crew.red, raised: null };
      }
      // Named by the crew and the time of the push, so a reload names it the same (a set-aside holds).
      crew.red = { id: `${e.sessionId}@${e.ts}`, sessionId: e.sessionId, agentKey: e.agentKey, at: e.ts, test: crew.test.command, testAt: crew.test.at, push: clip(oneLine(e.data.input?.command), COMMAND_CHARS) };
      return { changed: true, raised: crew.red };
    },
    /** The crews' warnings now, oldest first. @returns {RedPush[]} */
    list() {
      return [...crews.values()].map((crew) => crew.red).filter((red) => red !== null).sort((a, b) => a.at - b.at);
    },
  };
}
