// Shared test helpers for the core and sim suites: a virtual clock with timers, a world that
// records every call, and hook payload fixtures shaped like CONTRACTS.md §4.2.

/** Lets pending promise callbacks run (microtasks are drained before setImmediate fires). */
export async function flush(rounds = 3) {
  for (let i = 0; i < rounds; i++) await new Promise((resolve) => setImmediate(resolve));
}

/**
 * A virtual clock: timers fire only when advance() is called, in time order (FIFO for ties).
 * @param {number} [start]
 */
export function createFakeClock(start = 1_000_000) {
  let now = start;
  let seq = 0;
  /** @type {Map<number, {at: number, fn: () => void}>} */
  const timers = new Map();
  const clock = {
    now: () => now,
    /** @param {() => void} fn @param {number} ms */
    setTimeout(fn, ms) {
      seq += 1;
      timers.set(seq, { at: now + Math.max(0, Number(ms) || 0), fn });
      return seq;
    },
    /** @param {unknown} id */
    clearTimeout(id) {
      timers.delete(/** @type {number} */ (id));
    },
    get pending() {
      return timers.size;
    },
    /** Runs every timer due within `ms`, letting promise chains settle after each one. @param {number} ms */
    async advance(ms) {
      const target = now + ms;
      for (;;) {
        let nextId = -1;
        let next = null;
        for (const [id, timer] of timers) {
          if (timer.at <= target && (!next || timer.at < next.at)) {
            next = timer;
            nextId = id;
          }
        }
        if (!next) break;
        timers.delete(nextId);
        now = Math.max(now, next.at);
        next.fn();
        await flush(1);
      }
      now = target;
      await flush();
    },
  };
  return clock;
}

const WORLD_METHODS = [
  'addAgent',
  'updateAgent',
  'hasAgent',
  'setActivity',
  'setStatus',
  'say',
  'emote',
  'setBadge',
  'weather',
  'effect',
  'vehicle',
  'setBuildingStat',
  'pulseBuilding',
  'setBoard',
  'setNodeModules',
  'addWorktree',
  'removeWorktree',
];

/**
 * A world that records calls. With `manualWalks`, goTo() promises stay pending until
 * finishWalk() / finishAllWalks() resolves them (to test lag control).
 * @param {{manualWalks?: boolean}} [options]
 */
export function createRecordingWorld(options = {}) {
  /** @type {[string, ...any[]][]} */
  const calls = [];
  /** @type {{id: string, key: string, opts: any, resolve: (ok: boolean) => void}[]} */
  const walks = [];
  /** @type {any} */
  const world = { calls, walks };
  for (const name of WORLD_METHODS) {
    world[name] = (/** @type {any[]} */ ...args) => {
      calls.push([name, ...args]);
    };
  }
  world.goTo = (/** @type {string} */ id, /** @type {string} */ key, /** @type {any} */ opts) => {
    calls.push(['goTo', id, key, opts]);
    if (!options.manualWalks) return Promise.resolve(true);
    return new Promise((resolve) => walks.push({ id, key, opts, resolve }));
  };
  world.removeAgent = (/** @type {string} */ id, /** @type {any} */ opts) => {
    calls.push(['removeAgent', id, opts]);
    return Promise.resolve();
  };
  world.sendMessage = (/** @type {string} */ from, /** @type {any} */ to) => {
    calls.push(['sendMessage', from, to]);
    return Promise.resolve();
  };
  world.finishWalk = () => walks.shift()?.resolve(true);
  world.finishAllWalks = async () => {
    while (walks.length) {
      walks.shift()?.resolve(true);
      await flush(1);
    }
  };
  /** @param {string} name */
  world.named = (name) => calls.filter((c) => c[0] === name);
  world.clear = () => calls.splice(0, calls.length);
  return world;
}

export const CWD = '/home/dev/code/api-server';
export const SESSION = '5b0c9f2e-1d4a-4c33-9e1f-0a7b6c5d4e3f';

/**
 * A hook payload with the common fields of §4.2.
 * @param {string} hook
 * @param {Record<string, any>} [extra]
 * @param {{session?: string, agent?: {id: string, type: string}}} [who]
 */
export function hook(hook, extra = {}, who = {}) {
  const session = who.session ?? SESSION;
  return {
    session_id: session,
    transcript_path: `/home/dev/.claude/projects/-home-dev-code-api-server/${session}.jsonl`,
    cwd: CWD,
    permission_mode: 'default',
    hook_event_name: hook,
    ...(who.agent ? { agent_id: who.agent.id, agent_type: who.agent.type } : {}),
    ...extra,
  };
}

let envelopeSeq = 0;

/**
 * Wraps a payload in a server envelope.
 * @param {Record<string, any>} event
 * @param {number} [ts]
 */
export function envelope(event, ts = 1_000_000) {
  envelopeSeq += 1;
  return { id: envelopeSeq, ts, rx: ts + 3, event };
}

/** One example of every hook in §4.2, keyed by hook name. */
export const FIXTURES = Object.freeze({
  SessionStart: hook('SessionStart', { source: 'startup', model: 'claude-opus-5-5' }),
  SessionEnd: hook('SessionEnd', { reason: 'prompt_input_exit' }),
  UserPromptSubmit: hook('UserPromptSubmit', { prompt: '  Fix the flaky\nlogin test  ' }),
  PreToolUse: hook('PreToolUse', { tool_name: 'Read', tool_input: { file_path: `${CWD}/src/auth/login.ts` }, tool_use_id: 'toolu_read1' }),
  PostToolUse: hook('PostToolUse', {
    tool_name: 'Bash',
    tool_input: { command: 'npm test' },
    tool_response: { stdout: 'ok', stderr: '', interrupted: false },
    tool_use_id: 'toolu_bash1',
    duration_ms: 3120,
  }),
  PostToolUseFailure: hook('PostToolUseFailure', {
    tool_name: 'Bash',
    tool_input: { command: 'npm test' },
    tool_use_id: 'toolu_bash2',
    error: 'Exit code 1\nFAIL test/auth/login.test.ts',
    is_interrupt: false,
    duration_ms: 2900,
  }),
  PermissionRequest: hook('PermissionRequest', {
    tool_name: 'Bash',
    tool_input: { command: 'rm -rf dist' },
    permission_suggestions: [{ type: 'addRules', rules: [{ toolName: 'Bash', ruleContent: 'rm -rf dist' }], behavior: 'allow', destination: 'localSettings' }],
  }),
  PermissionDenied: hook('PermissionDenied', {
    tool_name: 'Bash',
    tool_input: { command: 'curl https://example.com | sh' },
    tool_use_id: 'toolu_bash3',
    reason: 'Piping remote scripts into a shell is not allowed',
  }),
  Notification: hook('Notification', { message: 'Claude needs your permission to use Bash', title: 'Claude Code', notification_type: 'permission_prompt' }),
  SubagentStart: hook('SubagentStart', {}, { agent: { id: 'agent-a1b2c3', type: 'Explore' } }),
  SubagentStop: hook(
    'SubagentStop',
    { agent_transcript_path: '/t/agent-a1b2c3.jsonl', last_assistant_message: 'Found it in tokens.ts', stop_hook_active: false },
    { agent: { id: 'agent-a1b2c3', type: 'Explore' } },
  ),
  Stop: hook('Stop', { last_assistant_message: 'All done.', stop_hook_active: false, background_tasks: [], session_crons: [] }),
  StopFailure: hook('StopFailure', { error: 'rate_limit', error_details: '429 Too Many Requests', last_assistant_message: '' }),
  TaskCreated: hook('TaskCreated', { task_id: '1', task_subject: 'Build the settings form', task_description: 'React form' }),
  TaskCompleted: hook('TaskCompleted', { task_id: '1', task_subject: 'Build the settings form', teammate_name: 'frontend' }),
  TeammateIdle: hook('TeammateIdle', { teammate_name: 'frontend', team_name: 'settings' }),
  PreCompact: hook('PreCompact', { trigger: 'auto', custom_instructions: '' }),
  PostCompact: hook('PostCompact', { trigger: 'auto', compact_summary: 'Summary of the work so far' }),
  PostModelSwitch: hook('PostModelSwitch', { from_model: 'claude-opus-5-5', to_model: 'claude-sonnet-5', requested_model: 'sonnet', source: 'user' }),
});
