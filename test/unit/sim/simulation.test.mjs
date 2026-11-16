import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import { createSimulation, MAX_SESSIONS, PERMISSION_TIMEOUT_MS } from '../../../public/js/sim/simulation.js';
import { MAX_HELPERS } from '../../../public/js/sim/procedural.js';
import { createStore } from '../../../public/js/core/store.js';
import { createDirector } from '../../../public/js/core/director.js';
import { createFakeClock, createRecordingWorld } from '../core/helpers.mjs';

const MINUTE = 60_000;

/**
 * Runs a simulation on a virtual clock and records what it emits.
 * @param {{seed?: number, minutes?: number, speed?: number, decide?: (payload: any) => any, emit?: (payload: any) => any}} [options]
 */
async function record(options = {}) {
  const clock = createFakeClock(0);
  /** @type {{at: number, p: Record<string, any>}[]} */
  const payloads = [];
  const decide = options.decide ?? (() => Promise.resolve({ decision: 'allow' }));
  const sim = createSimulation({
    seed: options.seed ?? 1,
    speed: options.speed ?? 1,
    scheduler: clock,
    emit: (payload) => {
      payloads.push({ at: clock.now(), p: structuredClone(payload) });
      if (options.emit) return options.emit(payload);
      return payload.hook_event_name === 'PermissionRequest' ? decide(payload) : undefined;
    },
  });
  sim.start();
  await clock.advance((options.minutes ?? 10) * MINUTE);
  sim.stop();
  return { payloads, sim, clock, events: payloads.map((x) => x.p) };
}

const COMMON = ['session_id', 'transcript_path', 'cwd', 'permission_mode', 'hook_event_name'];

/** Fields CONTRACTS.md §4.2 requires per hook, with a type check for each. */
const REQUIRED = {
  SessionStart: { source: 'string', model: 'string' },
  SessionEnd: { reason: 'string' },
  UserPromptSubmit: { prompt: 'string' },
  PreToolUse: { tool_name: 'string', tool_input: 'object', tool_use_id: 'string' },
  PostToolUse: { tool_name: 'string', tool_input: 'object', tool_response: 'any', tool_use_id: 'string', duration_ms: 'number' },
  PostToolUseFailure: { tool_name: 'string', tool_input: 'object', tool_use_id: 'string', error: 'string', is_interrupt: 'boolean' },
  PermissionRequest: { tool_name: 'string', tool_input: 'object', permission_suggestions: 'object' },
  PermissionDenied: { tool_name: 'string', tool_input: 'object', tool_use_id: 'string', reason: 'string' },
  Notification: { message: 'string', notification_type: 'string' },
  SubagentStart: { agent_id: 'string', agent_type: 'string' },
  SubagentStop: { agent_id: 'string', agent_type: 'string', agent_transcript_path: 'string', last_assistant_message: 'string', stop_hook_active: 'boolean' },
  Stop: { last_assistant_message: 'string', stop_hook_active: 'boolean', background_tasks: 'object', session_crons: 'object' },
  StopFailure: { error: 'string' },
  TaskCreated: { task_id: 'string', task_subject: 'string' },
  TaskCompleted: { task_id: 'string', task_subject: 'string' },
  TeammateIdle: { teammate_name: 'string' },
  PreCompact: { trigger: 'string', custom_instructions: 'string' },
  PostCompact: { trigger: 'string', compact_summary: 'string' },
  PostModelSwitch: { from_model: 'string', to_model: 'string', requested_model: 'string', source: 'string' },
};

/** @type {Awaited<ReturnType<typeof record>>} */
let long;

before(async () => {
  long = await record({ seed: 11, minutes: 60 });
});

describe('simulation: payloads exactly as §4.2 describes them', () => {
  it('emits every hook the town understands', () => {
    const seen = new Set(long.events.map((p) => p.hook_event_name));
    for (const name of Object.keys(REQUIRED)) assert.ok(seen.has(name), `${name} never emitted`);
  });

  it('every payload has the common fields and the fields of its hook', () => {
    for (const p of long.events) {
      for (const field of COMMON) assert.equal(typeof p[field], 'string', `${p.hook_event_name} lacks ${field}`);
      assert.ok(p.cwd.startsWith('/home/dev/code/'), p.cwd);
      assert.match(p.session_id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
      const required = REQUIRED[/** @type {keyof typeof REQUIRED} */ (p.hook_event_name)];
      assert.ok(required, `unexpected hook ${p.hook_event_name}`);
      for (const [field, type] of Object.entries(required)) {
        assert.ok(field in p, `${p.hook_event_name} lacks ${field}`);
        if (type !== 'any') assert.equal(typeof p[field], type, `${p.hook_event_name}.${field}`);
      }
      assert.equal('agent_id' in p, 'agent_type' in p, 'agent_id and agent_type travel together');
    }
  });

  it('PermissionRequest carries no tool_use_id', () => {
    const requests = long.events.filter((p) => p.hook_event_name === 'PermissionRequest');
    assert.ok(requests.length > 0);
    for (const p of requests) assert.ok(!('tool_use_id' in p));
  });

  it('every tool result answers an earlier PreToolUse of the same tool and session', () => {
    /** @type {Map<string, string>} */
    const started = new Map();
    for (const p of long.events) {
      if (p.hook_event_name === 'PreToolUse') {
        assert.ok(!started.has(p.tool_use_id), 'tool_use_id is unique');
        started.set(p.tool_use_id, `${p.session_id}/${p.tool_name}`);
      }
      if (['PostToolUse', 'PostToolUseFailure', 'PermissionDenied'].includes(p.hook_event_name)) {
        assert.equal(started.get(p.tool_use_id), `${p.session_id}/${p.tool_name}`);
      }
    }
  });

  it('subagents start before they work and never work after they stop', () => {
    /** @type {Map<string, 'live'|'done'>} */
    const helpers = new Map();
    for (const p of long.events) {
      if (!p.agent_id) continue;
      const key = `${p.session_id}/${p.agent_id}`;
      if (p.hook_event_name === 'SubagentStart') {
        assert.ok(!helpers.has(key));
        helpers.set(key, 'live');
      } else {
        assert.equal(helpers.get(key), 'live', `${p.hook_event_name} from a helper that is not live`);
        if (p.hook_event_name === 'SubagentStop') helpers.set(key, 'done');
      }
    }
  });

  it('sessions open with SessionStart and say nothing after SessionEnd', () => {
    /** @type {Map<string, 'open'|'closed'>} */
    const sessions = new Map();
    for (const p of long.events) {
      const state = sessions.get(p.session_id);
      if (p.hook_event_name === 'SessionStart' && !state) sessions.set(p.session_id, 'open');
      else assert.equal(state, 'open', `${p.hook_event_name} outside an open session`);
      if (p.hook_event_name === 'SessionEnd') sessions.set(p.session_id, 'closed');
    }
  });

  it('file paths live inside the project, with believable TypeScript and Python names', () => {
    for (const p of long.events) {
      const path = p.tool_input?.file_path;
      if (typeof path !== 'string') continue;
      assert.ok(path.startsWith(`${p.cwd}/`), path);
      assert.match(path, /\.(ts|tsx|py|md|yml|ya?ml|json|toml)$/, path);
    }
    const commands = long.events.filter((p) => p.tool_name === 'Bash').map((p) => p.tool_input.command);
    assert.ok(commands.some((c) => c.startsWith('npm test')));
    assert.ok(commands.some((c) => c.startsWith('uv run pytest')));
    assert.ok(commands.every((c) => typeof c === 'string' && c.length > 1 && c.length < 200));
  });

  it('stays within the town’s budget: ≤ 3 sessions and ≤ 8 helpers at once', () => {
    let sessions = 0;
    let helpers = 0;
    for (const p of long.events) {
      if (p.hook_event_name === 'SessionStart' && p.source !== 'compact') sessions += 1;
      if (p.hook_event_name === 'SessionEnd') sessions -= 1;
      if (p.hook_event_name === 'SubagentStart') helpers += 1;
      if (p.hook_event_name === 'SubagentStop') helpers -= 1;
      assert.ok(sessions <= MAX_SESSIONS, `${sessions} sessions`);
      assert.ok(helpers <= MAX_HELPERS, `${helpers} helpers`);
    }
  });

  it('never runs dry: new sessions keep arriving and work keeps flowing', () => {
    const late = long.payloads.filter((x) => x.at > 50 * MINUTE);
    assert.ok(late.length > 100, `${late.length} payloads in the last 10 minutes`);
    const arrivals = long.payloads.filter((x) => x.p.hook_event_name === 'SessionStart' && x.p.source === 'startup' && x.at > 20 * MINUTE);
    assert.ok(arrivals.length >= 1);
  });

  it('paces tool calls like a person watching: mostly 0.6–4 s apart', () => {
    /** @type {Map<string, number>} */
    const lastStart = new Map();
    const gaps = [];
    for (const { at, p } of long.payloads) {
      if (p.hook_event_name !== 'PreToolUse' || p.agent_id || p.tool_name === 'Agent') continue;
      const previous = lastStart.get(p.session_id);
      if (previous !== undefined) gaps.push(at - previous);
      lastStart.set(p.session_id, at);
    }
    gaps.sort((a, b) => a - b);
    const median = gaps[Math.floor(gaps.length / 2)];
    assert.ok(median >= 900 && median <= 6000, `median gap ${median} ms`);
    assert.ok(gaps[Math.floor(gaps.length * 0.05)] >= 150, 'hardly anything back to back');
  });
});

describe('simulation: the scripted stories', () => {
  it('(a) api-server: helpers, a red then green test run, commit, push, a closing message', () => {
    const api = long.events.filter((p) => p.cwd.endsWith('/api-server'));
    const first = api[0].session_id;
    const story = api.filter((p) => p.session_id === first);
    assert.match(story.find((p) => p.hook_event_name === "UserPromptSubmit").prompt, /fails randomly in CI/);
    assert.ok(story.some((p) => p.hook_event_name === 'SubagentStart' && p.agent_type === 'Explore'));
    const spawn = story.find((p) => p.hook_event_name === 'PostToolUse' && p.tool_name === 'Agent');
    assert.equal(spawn.tool_response.status, 'completed');
    assert.equal(typeof spawn.tool_response.agentId, 'string');
    const tests = story.filter((p) => p.tool_input?.command?.startsWith('npm test'));
    assert.equal(tests.find((p) => p.hook_event_name === 'PostToolUseFailure').error.split('\n')[0], 'Exit code 1');
    const order = story.map((p) => `${p.hook_event_name}:${p.tool_input?.command ?? ''}`);
    assert.ok(order.indexOf('PostToolUseFailure:npm test -- test/auth/login.test.ts') < order.indexOf('PostToolUse:npm test'));
    assert.ok(story.some((p) => p.hook_event_name === 'PostToolUse' && /git push/.test(p.tool_input?.command ?? '')));
    assert.ok(story.some((p) => p.hook_event_name === 'PreToolUse' && p.tool_name === 'TodoWrite'));
    assert.match(story.find((p) => p.hook_event_name === 'Stop').last_assistant_message, /flaky login test/);
  });

  it('(b) web-app: a team with shared tasks, named teammates and messages between them', () => {
    const team = long.events.filter((p) => p.cwd.endsWith('/web-app'));
    const spawns = team.filter((p) => p.hook_event_name === 'PreToolUse' && p.tool_name === 'Agent' && p.tool_input.name);
    assert.deepEqual(
      spawns.slice(0, 3).map((p) => p.tool_input.name),
      ['frontend', 'backend', 'tester'],
    );
    assert.equal(team.filter((p) => p.hook_event_name === 'TaskCreated').length >= 3, true);
    const ids = new Map(team.filter((p) => p.hook_event_name === 'SubagentStart').map((p, i) => [p.agent_id, spawns[i]?.tool_input.name]));
    const between = team.filter((p) => p.hook_event_name === 'PreToolUse' && p.tool_name === 'SendMessage' && p.agent_id && p.tool_input.to !== 'team-lead');
    assert.ok(between.length >= 2, 'teammates message each other');
    const completed = team.filter((p) => p.hook_event_name === 'TaskCompleted');
    assert.ok(completed.length >= 3);
    for (const p of completed) assert.equal(p.teammate_name, ids.get(p.agent_id));
    const idle = team.filter((p) => p.hook_event_name === 'TeammateIdle');
    assert.ok(idle.every((p) => p.teammate_name === ids.get(p.agent_id)));
    const updates = team.filter((p) => p.hook_event_name === 'PreToolUse' && p.tool_name === 'TaskUpdate');
    assert.ok(updates.some((p) => p.tool_input.status === 'in_progress' && p.tool_input.owner));
    assert.ok(team.some((p) => p.hook_event_name === 'SubagentStop' && /Shutting down/.test(p.last_assistant_message)), 'the team is shut down later');
  });

  it('(c) docs-site: web, MCP, a skill, compaction, a model switch and a rate limit', () => {
    const docs = long.events.filter((p) => p.cwd.endsWith('/docs-site'));
    const first = docs.filter((p) => p.session_id === docs[0].session_id);
    const tools = new Set(first.filter((p) => p.hook_event_name === 'PreToolUse').map((p) => p.tool_name));
    for (const tool of ['WebSearch', 'WebFetch', 'Skill', 'mcp__github__search_issues']) assert.ok(tools.has(tool), tool);
    assert.equal(first.find((p) => p.tool_name === 'mcp__github__search_issues').mcp_server, 'github');
    const kinds = first.map((p) => p.hook_event_name);
    assert.ok(kinds.indexOf('PreCompact') < kinds.indexOf('PostCompact'));
    assert.equal(first[kinds.indexOf('PostCompact') + 1].source, 'compact');
    const switched = first.find((p) => p.hook_event_name === 'PostModelSwitch');
    assert.match(switched.from_model, /opus/);
    assert.match(switched.to_model, /sonnet/);
    const failure = first.find((p) => p.hook_event_name === 'StopFailure');
    assert.equal(failure.error, 'rate_limit');
    assert.equal(first[kinds.indexOf('StopFailure') + 1].prompt, 'continue');
  });
});

describe('simulation: permission round-trip', () => {
  /** @param {(payload: any) => any} decide */
  async function docsRun(decide) {
    const { events, payloads } = await record({ seed: 3, minutes: 8, decide });
    const docs = payloads.filter((x) => x.p.cwd.endsWith('/docs-site'));
    const at = docs.findIndex((x) => x.p.hook_event_name === 'PermissionRequest' && x.p.tool_input.command === 'rm -rf dist');
    assert.ok(at > 0, 'the rm -rf dist permit was requested');
    return { events, docs, at };
  }

  it('allow: the deletion runs and the build goes on', async () => {
    const { docs, at } = await docsRun(() => Promise.resolve({ decision: 'allow' }));
    const before = docs[at - 1].p;
    assert.equal(before.hook_event_name, 'PreToolUse');
    assert.equal(before.tool_input.command, 'rm -rf dist');
    const after = docs.slice(at + 1).map((x) => x.p);
    const done = after.find((p) => p.tool_use_id === before.tool_use_id);
    assert.equal(done.hook_event_name, 'PostToolUse');
    assert.ok(after.some((p) => p.tool_input?.command === 'uv run mkdocs build --site-dir dist'));
  });

  it('deny: nothing is deleted and the agent picks an alternative', async () => {
    const { docs, at } = await docsRun(() => Promise.resolve({ decision: 'deny' }));
    const before = docs[at - 1].p;
    const after = docs.slice(at + 1).map((x) => x.p);
    assert.ok(!after.some((p) => p.tool_use_id === before.tool_use_id), 'no result for the denied call');
    const next = after.find((p) => p.hook_event_name === 'PreToolUse');
    assert.equal(next.tool_input.command, 'uv run mkdocs build --clean --site-dir dist');
  });

  it('no decision within 25 s: the terminal asks, and the work carries on as allowed', async () => {
    const { docs, at } = await docsRun(() => new Promise(() => {}));
    const asked = docs.slice(at + 1).find((x) => x.p.hook_event_name === 'Notification');
    assert.equal(asked.p.notification_type, 'permission_prompt');
    assert.ok(asked.at - docs[at].at >= PERMISSION_TIMEOUT_MS);
    const before = docs[at - 1].p;
    assert.ok(docs.slice(at + 1).some((x) => x.p.tool_use_id === before.tool_use_id && x.p.hook_event_name === 'PostToolUse'));
  });

  it('an answer without a decision also falls back to the terminal', async () => {
    const { docs, at } = await docsRun(() => Promise.resolve({}));
    const next = docs[at + 1];
    assert.equal(next.p.hook_event_name, 'Notification');
    assert.ok(next.at - docs[at].at < 1000, 'no need to wait for the timeout');
  });
});

describe('simulation: control', () => {
  it('is deterministic for a seed and different across seeds', async () => {
    const a = await record({ seed: 42, minutes: 6 });
    const b = await record({ seed: 42, minutes: 6 });
    const c = await record({ seed: 43, minutes: 6 });
    assert.deepEqual(a.payloads, b.payloads);
    assert.notDeepEqual(
      a.events.map((p) => p.session_id),
      c.events.map((p) => p.session_id),
    );
  });

  it('stop() leaves no timers and emits nothing; start() resumes where it paused', async () => {
    const clock = createFakeClock(0);
    const seen = [];
    const sim = createSimulation({ seed: 5, scheduler: clock, emit: (p) => void seen.push(p.hook_event_name === 'SessionStart' ? `arrival:${p.source}` : p.hook_event_name) });
    assert.equal(sim.running, false);
    sim.start();
    assert.equal(sim.running, true);
    await clock.advance(30_000);
    const count = seen.length;
    assert.ok(count > 0);
    sim.stop();
    assert.equal(sim.running, false);
    assert.equal(clock.pending, 0, 'every timer cleared');
    await clock.advance(10 * MINUTE);
    assert.equal(seen.length, count, 'nothing while stopped');
    sim.start();
    sim.start();
    await clock.advance(30_000);
    assert.ok(seen.length > count, 'the story continues');
    assert.equal(seen.filter((name) => name === 'arrival:startup').length, 3, 'resuming does not restart the scripts');
    sim.stop();
    assert.equal(clock.pending, 0);
  });

  it('a decision that arrives while paused is acted on only after start()', async () => {
    const clock = createFakeClock(0);
    /** @type {{at: number, name: string}[]} */
    const seen = [];
    /** @type {(value: any) => void} */
    let answer = () => {};
    const sim = createSimulation({
      seed: 3,
      scheduler: clock,
      emit: (p) => {
        seen.push({ at: clock.now(), name: p.hook_event_name });
        if (p.hook_event_name === 'PermissionRequest') return new Promise((resolve) => (answer = resolve));
        return undefined;
      },
    });
    sim.start();
    while (!seen.some((s) => s.name === 'PermissionRequest')) await clock.advance(5000);
    sim.stop();
    const count = seen.length;
    answer({ decision: 'allow' });
    await clock.advance(MINUTE);
    assert.equal(seen.length, count);
    sim.start();
    await clock.advance(10_000);
    assert.ok(seen.length > count);
    sim.stop();
  });

  it('runs faster at a higher speed, telling the same story', async () => {
    const normal = await record({ seed: 9, minutes: 6 });
    const fast = await record({ seed: 9, minutes: 3, speed: 2 });
    const n = fast.payloads.length;
    assert.ok(n > 50);
    assert.deepEqual(
      fast.events,
      normal.events.slice(0, n),
    );
    assert.ok(Math.abs(fast.payloads[n - 1].at * 2 - normal.payloads[n - 1].at) < 5);
  });

  it('setSpeed changes the pace of a running story', async () => {
    const clock = createFakeClock(0);
    let count = 0;
    const sim = createSimulation({ seed: 2, scheduler: clock, emit: () => void (count += 1) });
    sim.start();
    await clock.advance(MINUTE);
    const slow = count;
    sim.setSpeed(4);
    await clock.advance(MINUTE);
    const fast = count - slow;
    assert.ok(fast > slow * 2, `${slow} then ${fast}`);
    sim.setSpeed(-1);
    sim.setSpeed(Number.NaN);
    sim.stop();
    assert.equal(clock.pending, 0);
  });

  it('keeps going when the receiver throws, and tolerates a missing emit', async () => {
    let calls = 0;
    const { clock } = await record({
      minutes: 2,
      emit: () => {
        calls += 1;
        throw new Error('receiver down');
      },
    });
    assert.ok(calls > 20);
    assert.equal(clock.pending, 0);
    const silent = createSimulation(/** @type {any} */ ({ scheduler: createFakeClock(0) }));
    silent.start();
    silent.stop();
  });
});

describe('simulation → store → director', () => {
  it('drives a whole town for 20 minutes without an error', async () => {
    const clock = createFakeClock(0);
    const errors = [];
    const store = createStore({ now: clock.now, localHour: () => 12, onError: (e) => errors.push(e) });
    const world = createRecordingWorld();
    const original = console.error;
    console.error = (...args) => errors.push(args);
    try {
      createDirector({ world, store, now: clock.now, setTimer: (fn, ms) => clock.setTimeout(fn, ms), clearTimer: (h) => clock.clearTimeout(h) });
      let id = 0;
      const sim = createSimulation({
        seed: 4,
        scheduler: clock,
        emit: (payload) => {
          id += 1;
          store.ingest({ id, ts: clock.now(), rx: clock.now(), event: payload });
          return payload.hook_event_name === 'PermissionRequest' ? Promise.resolve({ decision: 'allow' }) : undefined;
        },
      });
      sim.start();
      await clock.advance(20 * MINUTE);
      sim.stop();
    } finally {
      console.error = original;
    }
    assert.deepEqual(errors, []);
    const state = store.getState();
    const unlocked = state.achievements.map((a) => a.id);
    for (const id of ['first-contact', 'teamwork', 'memory-lane', 'ship-it', 'red-to-green', 'polyglot']) assert.ok(unlocked.includes(id), id);
    assert.ok(state.log.length > 100);
    assert.ok(world.calls.length > 1000);
    assert.ok(Object.values(state.agents).some((a) => a.role === 'teammate') || state.log.some((l) => l.text.startsWith('Joined the crew')));
  });
});
