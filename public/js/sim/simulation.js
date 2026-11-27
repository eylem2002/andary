// The demo's storyteller (CONTRACTS.md §7): seeded, deterministic, no DOM. It plays three scripted
// sessions (a flaky test fix with helpers, an agent team, a docs job with research, compaction, a
// model switch, a rate limit and a permit), then generated work forever, with sessions arriving
// and leaving so the town never empties. Payloads are raw hook payloads, exactly as Claude Code
// sends them (§4.2). Used by the UI's demo mode and by `andary simulate`.
//
// stop() pauses: every timer is cleared and nothing is emitted until start() resumes the story
// where it left off. Answers to PermissionRequest are awaited even while paused.

import { createClock } from './clock.js';
import { HOME, MODELS, PROCEDURAL_PROJECTS, PROJECTS } from './corpus.js';
import { Crew } from './crew.js';
import { disbandTeam, teamRounds, workSession } from './procedural.js';
import { createRandom } from './random.js';
import { apiServerScenario, docsSiteScenario, webAppTeamScenario } from './scenarios.js';

/**
 * The story's branch for a crew's folder (`<HOME>/code/<project>`), or null: the demo's made-up
 * git status (sources/demo-git.js) names it.
 * @param {string} cwd
 * @returns {string|null}
 */
export function demoBranch(cwd) {
  const prefix = `${HOME}/code/`;
  if (!cwd.startsWith(prefix)) return null;
  const name = cwd.slice(prefix.length);
  return Object.hasOwn(PROJECTS, name) ? PROJECTS[name].branch : null;
}

/** No decision on a PermissionRequest within this long (story time) → carry on as if allowed. */
export const PERMISSION_TIMEOUT_MS = 25_000;
/** Sessions in town at once; when one leaves, a new one arrives a little later. */
export const MAX_SESSIONS = 3;

/**
 * @typedef {object} SimulationOptions
 * @property {number} [seed]
 * @property {number} [speed]  1 = real time; 2 = twice as fast
 * @property {(payload: Record<string, any>) => void|Promise<{decision?: 'allow'|'deny', updatedPermissions?: unknown[]}|void>} emit
 *   an allow with updatedPermissions saved the request's suggested rule ("Allow always")
 * @property {import('./clock.js').Scheduler} [scheduler]  timers (tests inject a fake one)
 */

/**
 * @typedef {object} Simulation
 * @property {() => void} start      starts, or resumes after stop()
 * @property {() => void} stop       pauses; clears every timer
 * @property {(n: number) => void} setSpeed
 * @property {boolean} running
 */

/** @param {unknown} value */
function isThenable(value) {
  return value != null && typeof (/** @type {any} */ (value).then) === 'function';
}

/**
 * The answer to a permission request: 'always' is an allow that saved the suggested rule.
 * @param {unknown} answer
 * @returns {'allow'|'always'|'deny'|'none'}
 */
function decisionOf(answer) {
  const { decision, updatedPermissions } = /** @type {any} */ (answer) ?? {};
  if (decision === 'allow' && Array.isArray(updatedPermissions) && updatedPermissions.length > 0) return 'always';
  return decision === 'allow' || decision === 'deny' ? decision : 'none';
}

/**
 * @param {SimulationOptions} options
 * @returns {Simulation}
 */
export function createSimulation(options) {
  const emit = typeof options?.emit === 'function' ? options.emit : () => undefined;
  const clock = createClock({ scheduler: options?.scheduler, speed: options?.speed ?? 1 });
  const rng = createRandom(options?.seed);
  const census = { helpers: 0 };
  /** @type {Set<string>} projects with a session in town */
  const active = new Set();
  let begun = false;

  /** @param {Record<string, any>} payload */
  async function send(payload) {
    await clock.whenRunning();
    try {
      return await emit(payload);
    } catch {
      return undefined; // a failing receiver must not end the story
    }
  }

  /** @param {Record<string, any>} payload @returns {Promise<'allow'|'always'|'deny'|'none'>} */
  async function ask(payload) {
    await clock.whenRunning();
    let answer;
    try {
      answer = emit(payload);
    } catch {
      return 'none';
    }
    if (!isThenable(answer)) return decisionOf(answer);
    const timeout = clock.delay(PERMISSION_TIMEOUT_MS);
    const decided = Promise.resolve(answer).then(decisionOf, () => /** @type {'none'} */ ('none'));
    const result = await Promise.race([decided, timeout.promise.then(() => /** @type {'none'} */ ('none'))]);
    timeout.cancel();
    return result;
  }

  /** @type {import('./crew.js').SimRuntime} */
  const runtime = { rng, sleep: (ms) => clock.sleep(ms), send, ask, census, savedRules: new Set() };

  /** @param {() => Promise<void>} story */
  function run(story) {
    story().catch(() => {});
  }

  /**
   * One session from arrival to departure; when it leaves, another is on its way.
   * @param {string} projectName
   * @param {{model: string, permissionMode: string, member?: string}} setup
   * @param {(crew: Crew) => Promise<void>} story
   */
  async function session(projectName, setup, story) {
    active.add(projectName);
    try {
      const crew = new Crew(runtime, PROJECTS[projectName], setup);
      await story(crew);
      await crew.think(2, 5);
      await crew.end('prompt_input_exit');
    } finally {
      active.delete(projectName);
      scheduleArrival();
    }
  }

  function scheduleArrival() {
    run(async () => {
      await clock.sleep(rng.int(8000, 20000));
      if (active.size >= MAX_SESSIONS) return;
      const free = PROCEDURAL_PROJECTS.filter((name) => !active.has(name));
      const name = free.length ? rng.pick(free) : rng.pick(PROCEDURAL_PROJECTS);
      const setup = { model: rng.pick([MODELS.opus, MODELS.opus, MODELS.sonnet]), permissionMode: rng.pick(['default', 'acceptEdits', 'auto']) };
      await session(name, setup, async (crew) => {
        await crew.start();
        await workSession(crew, { turns: rng.int(4, 8) });
      });
    });
  }

  /** The three scripted sessions arrive a few seconds apart. */
  function begin() {
    run(async () => {
      await clock.sleep(400);
      await session('api-server', { model: MODELS.opus, permissionMode: 'acceptEdits' }, async (crew) => {
        await apiServerScenario(crew);
        await workSession(crew, { turns: rng.int(4, 7) });
      });
    });
    run(async () => {
      await clock.sleep(7000);
      // Shown as a teammate's crew, as in a team town (§4.11): its foreman carries her name.
      await session('web-app', { model: MODELS.opus, permissionMode: 'acceptEdits', member: 'Lina' }, async (crew) => {
        const team = await webAppTeamScenario(crew);
        await teamRounds(crew, team, 2);
        await disbandTeam(crew, team);
        await workSession(crew, { turns: rng.int(2, 4) });
      });
    });
    run(async () => {
      await clock.sleep(15000);
      await session('docs-site', { model: MODELS.opus, permissionMode: 'default' }, async (crew) => {
        await docsSiteScenario(crew);
        await workSession(crew, { turns: rng.int(2, 3) });
      });
    });
  }

  return {
    start() {
      if (!begun) {
        begun = true;
        begin();
      }
      clock.start();
    },
    stop() {
      clock.stop();
    },
    setSpeed(n) {
      clock.setSpeed(n);
    },
    get running() {
      return clock.running;
    },
  };
}

