import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createStore, ACHIEVEMENTS } from '../../../public/js/core/store.js';
import { CREW_COLORS } from '../../../public/js/core/catalog.js';
import { CWD, FIXTURES, SESSION, envelope, hook } from './helpers.mjs';

const MAIN = `${SESSION}:main`;

/**
 * A store plus a feeder that stamps increasing timestamps on each payload.
 * @param {Parameters<typeof createStore>[0]} [options]
 */
function setup(options = {}) {
  let t = 1_000_000;
  const store = createStore({ localHour: () => 12, now: () => t, ...options });
  /** @type {any[]} */
  const changes = [];
  store.subscribe((change) => changes.push(change));
  /** @param {Record<string, any>} payload @param {number} [ts] */
  const send = (payload, ts) => {
    t = ts ?? t + 10;
    return store.ingest(envelope(payload, t));
  };
  const state = () => store.getState();
  const unlocked = () => changes.filter((c) => c.type === 'achievement').map((c) => c.achievement.id);
  return { store, send, state, changes, unlocked, clock: { get now() { return t; } } };
}

/** @param {string} id @param {string} type */
const agent = (id, type) => ({ agent: { id, type } });

/** @param {string} tool @param {Record<string, any>} input @param {string} id @param {any} [who] */
const pre = (tool, input, id, who) => hook('PreToolUse', { tool_name: tool, tool_input: input, tool_use_id: id }, who);
/** @param {string} tool @param {Record<string, any>} input @param {string} id @param {any} [response] @param {any} [who] */
const post = (tool, input, id, response = {}, who = undefined) => hook('PostToolUse', { tool_name: tool, tool_input: input, tool_response: response, tool_use_id: id }, who);
/** @param {string} tool @param {Record<string, any>} input @param {string} id @param {string} error @param {any} [who] */
const fail = (tool, input, id, error, who) => hook('PostToolUseFailure', { tool_name: tool, tool_input: input, tool_use_id: id, error, is_interrupt: false }, who);
/** @param {string} type @param {string} description @param {string} id @param {Record<string, any>} [extra] */
const spawn = (type, description, id, extra = {}) => pre('Agent', { description, prompt: 'p', subagent_type: type, ...extra }, id);

describe('store: sessions and the lead', () => {
  it('creates a crew lazily from any event, with a Foreman', () => {
    const { send, state } = setup();
    send(FIXTURES.PreToolUse);
    const [session] = state().sessions;
    assert.equal(session.id, SESSION);
    assert.equal(session.project, 'api-server');
    assert.equal(session.cwd, CWD);
    assert.equal(session.color, CREW_COLORS[0]);
    assert.equal(session.status, 'working');
    assert.deepEqual(session.agentKeys, [MAIN]);
    const lead = state().agents[MAIN];
    assert.equal(lead.name, 'Foreman');
    assert.equal(lead.role, 'lead');
    assert.equal(lead.hat, 'hardhat');
    assert.equal(lead.building, 'library');
    assert.equal(lead.activity, 'read');
    assert.equal(lead.currentTool, 'Read');
    assert.equal(lead.summary, 'Read src/auth/login.ts');
    assert.deepEqual(lead.files, ['src/auth/login.ts']);
    assert.equal(lead.toolCounts.Read, 1);
  });

  it('hands out crew colours round-robin and model hats to leads', () => {
    const { send, state } = setup();
    for (let i = 0; i < CREW_COLORS.length + 1; i++) send(hook('SessionStart', { source: 'startup', model: i === 1 ? 'claude-sonnet-5' : 'claude-opus-5-5' }, { session: `s${i}` }));
    const sessions = state().sessions;
    assert.deepEqual(
      sessions.map((s) => s.color),
      [...CREW_COLORS, CREW_COLORS[0]],
    );
    assert.equal(state().agents['s0:main'].hat, 'crown');
    assert.equal(state().agents['s1:main'].hat, 'beret');
    assert.equal(sessions[0].model, 'claude-opus-5-5');
  });

  it('keeps the latest prompt as the goal, trimmed', () => {
    const { send, state } = setup();
    send(FIXTURES.UserPromptSubmit);
    assert.equal(state().sessions[0].goal, 'Fix the flaky login test');
    assert.equal(state().agents[MAIN].status, 'working');
  });

  it('ends a session, removes its agents and drops late async hooks', () => {
    const { send, state } = setup();
    send(FIXTURES.SessionStart, 100);
    send(FIXTURES.SubagentStart, 110);
    send(FIXTURES.SessionEnd, 200);
    const [session] = state().sessions;
    assert.equal(session.status, 'ended');
    assert.equal(session.endedAt, 200);
    assert.deepEqual(session.agentKeys, []);
    assert.deepEqual(Object.keys(state().agents), []);
    // A Stop that fired before the end but arrived after it must not resurrect the crew.
    assert.deepEqual(send(FIXTURES.Stop, 150), []);
    assert.equal(state().sessions[0].status, 'ended');
    // Something genuinely new revives it.
    send(FIXTURES.UserPromptSubmit, 300);
    assert.equal(state().sessions[0].status, 'working');
    assert.ok(state().agents[MAIN]);
  });

  it('ignores unknown hooks and ends of sessions it never saw', () => {
    const { send, state } = setup();
    assert.deepEqual(send({ hook_event_name: 'Unknown', raw: '{' }), []);
    assert.deepEqual(send(FIXTURES.SessionEnd), []);
    assert.equal(state().sessions.length, 0);
    assert.equal(state().stats.events, 0);
  });

  it('keeps at most 10 ended sessions', () => {
    const { send, state } = setup();
    for (let i = 0; i < 13; i++) {
      send(hook('SessionStart', { source: 'startup' }, { session: `s${i}` }));
      send(hook('SessionEnd', { reason: 'other' }, { session: `s${i}` }));
    }
    send(hook('SessionStart', { source: 'startup' }, { session: 'live' }));
    const sessions = state().sessions;
    assert.equal(sessions.filter((s) => s.status === 'ended').length, 10);
    assert.equal(sessions[0].id, 's3');
    assert.equal(sessions.at(-1).id, 'live');
  });
});

describe('store: attribution', () => {
  it('labels parallel subagents FIFO by type and attributes their tool calls', () => {
    const { send, state } = setup();
    send(spawn('Explore', 'Find expiry', 't1'));
    send(spawn('Explore', 'Scan tests', 't2'));
    send(spawn('Plan', 'Plan the clock', 't3'));
    send(hook('SubagentStart', {}, agent('agent-p1', 'Plan')));
    send(hook('SubagentStart', {}, agent('e1', 'Explore')));
    send(hook('SubagentStart', {}, agent('e2', 'Explore')));
    const agents = state().agents;
    assert.deepEqual(
      ['p1', 'e1', 'e2'].map((id) => [agents[`${SESSION}:${id}`].name, agents[`${SESSION}:${id}`].description, agents[`${SESSION}:${id}`].role]),
      [
        ['Architect 1', 'Plan the clock', 'subagent'],
        ['Scout 1', 'Find expiry', 'subagent'],
        ['Scout 2', 'Scan tests', 'subagent'],
      ],
    );
    assert.equal(agents[`${SESSION}:e1`].hat, 'cap');
    const [event] = send(pre('Read', { file_path: `${CWD}/src/a.ts` }, 'r1', agent('e2', 'Explore')));
    assert.equal(event.agentKey, `${SESSION}:e2`);
    assert.equal(agents[`${SESSION}:e2`].toolCounts.Read, 1);
    assert.equal(agents[MAIN].toolCounts.Read, undefined);
    assert.equal(state().stats.subagents, 3);
  });

  it('corrects a FIFO guess when the Agent result names the real agent', () => {
    const { send, state } = setup();
    send(spawn('Explore', 'First job', 't1'));
    send(spawn('Explore', 'Second job', 't2'));
    send(hook('SubagentStart', {}, agent('x', 'Explore')));
    send(hook('SubagentStart', {}, agent('y', 'Explore')));
    assert.equal(state().agents[`${SESSION}:x`].description, 'First job');
    const [, result] = send(post('Agent', { description: 'First job', prompt: 'p', subagent_type: 'Explore' }, 't1', { status: 'completed', agentId: 'agent-y' }));
    assert.equal(result.kind, 'spawn.result');
    assert.equal(state().agents[`${SESSION}:y`].description, 'First job');
    assert.equal(state().agents[`${SESSION}:x`].description, 'Second job');
  });

  it('names teammates after their spawn name, with distinct hats, and renames on evidence', () => {
    const { send, state } = setup();
    send(FIXTURES.SessionStart);
    for (const [i, name] of ['frontend', 'backend', 'tester'].entries()) {
      send(spawn('general-purpose', `${name} work`, `tm${i}`, { name, run_in_background: true }));
    }
    // Parallel teammates of one type may start in any order: FIFO guesses, evidence corrects.
    send(hook('SubagentStart', {}, agent('b', 'general-purpose')));
    send(post('Agent', { name: 'backend', subagent_type: 'general-purpose', description: 'backend work', prompt: 'p' }, 'tm1', { status: 'async_launched', agentId: 'b' }));
    send(hook('SubagentStart', {}, agent('f', 'general-purpose')));
    send(hook('SubagentStart', {}, agent('t', 'general-purpose')));
    const agents = state().agents;
    assert.equal(agents[`${SESSION}:b`].name, 'backend');
    assert.equal(agents[`${SESSION}:f`].name, 'frontend');
    assert.equal(agents[`${SESSION}:t`].name, 'tester');
    for (const id of ['b', 'f', 't']) assert.equal(agents[`${SESSION}:${id}`].role, 'teammate');
    const hats = ['b', 'f', 't'].map((id) => agents[`${SESSION}:${id}`].hat);
    assert.equal(new Set(hats).size, 3);
    assert.ok(!hats.includes('crown'), 'teammates do not wear the lead hat');
  });

  it('attributes teammate hooks by name when they carry no agent_id', () => {
    const { send, state } = setup();
    send(spawn('general-purpose', 'UI', 'tm', { name: 'frontend' }));
    send(hook('SubagentStart', {}, agent('f', 'general-purpose')));
    const [idle] = send(FIXTURES.TeammateIdle);
    assert.equal(idle.agentKey, `${SESSION}:f`);
    assert.equal(state().agents[`${SESSION}:f`].status, 'idle');
    assert.equal(state().agents[`${SESSION}:f`].building, 'cafe');
    const [done] = send(FIXTURES.TaskCompleted);
    assert.equal(done.agentKey, `${SESSION}:f`);
  });

  it('renames an agent when TeammateIdle names it differently, and reports the relabel', () => {
    const { send, state } = setup();
    send(hook('SubagentStart', {}, agent('q', 'general-purpose')));
    assert.equal(state().agents[`${SESSION}:q`].name, 'Builder 1');
    const [idle] = send(hook('TeammateIdle', { teammate_name: 'researcher' }, agent('q', 'general-purpose')));
    assert.equal(state().agents[`${SESSION}:q`].name, 'researcher');
    assert.equal(state().agents[`${SESSION}:q`].role, 'teammate');
    assert.deepEqual(idle.data.relabels.map((r) => r.name), ['researcher']);
  });

  it('gives other agent types a Title Cased role name', () => {
    const { send, state } = setup();
    send(hook('SubagentStart', {}, agent('r', 'code-reviewer')));
    assert.equal(state().agents[`${SESSION}:r`].name, 'Code Reviewer 1');
  });

  it('ignores straggling hooks of a finished subagent', () => {
    const { send, state } = setup();
    send(FIXTURES.SubagentStart);
    send(FIXTURES.SubagentStop);
    assert.equal(state().agents[`${SESSION}:a1b2c3`].status, 'done');
    assert.deepEqual(send(post('Read', {}, 'late', {}, agent('a1b2c3', 'Explore'))), []);
    assert.equal(state().agents[`${SESSION}:a1b2c3`].status, 'done');
  });
});

describe('store: status transitions', () => {
  it('working → waiting → working → error → working → idle', () => {
    const { send, state } = setup();
    const lead = () => state().agents[MAIN];
    const session = () => state().sessions[0];
    send(pre('Bash', { command: 'rm -rf dist' }, 'b1'));
    assert.equal(lead().status, 'working');
    send(FIXTURES.PermissionRequest);
    assert.equal(lead().status, 'waiting');
    assert.equal(lead().building, 'permits');
    assert.equal(session().status, 'waiting');
    send(post('Bash', { command: 'rm -rf dist' }, 'b1'));
    assert.equal(lead().status, 'working');
    send(fail('Bash', { command: 'npm test' }, 'b2', 'Exit code 1'));
    assert.equal(lead().status, 'error');
    assert.equal(lead().errors, 1);
    assert.equal(session().status, 'working', 'a failed tool does not end the turn');
    send(post('Bash', { command: 'ls' }, 'b3'));
    assert.equal(lead().status, 'error', 'error holds until the next tool.start');
    send(pre('Read', { file_path: 'x' }, 'r'));
    assert.equal(lead().status, 'working');
    send(FIXTURES.Stop);
    assert.equal(lead().status, 'idle');
    assert.equal(lead().building, 'cafe');
    assert.equal(lead().lastMessage, 'All done.');
    assert.equal(session().status, 'idle');
  });

  it('notifications: permission prompt waits, idle prompt idles', () => {
    const { send, state } = setup();
    send(FIXTURES.Notification);
    assert.equal(state().agents[MAIN].status, 'waiting');
    send(hook('Notification', { message: 'Claude is waiting for your input', notification_type: 'idle_prompt' }));
    assert.equal(state().agents[MAIN].status, 'idle');
  });

  it('StopFailure leaves the lead in error but the session idle', () => {
    const { send, state } = setup();
    send(FIXTURES.UserPromptSubmit);
    send(FIXTURES.StopFailure);
    assert.equal(state().agents[MAIN].status, 'error');
    assert.equal(state().sessions[0].status, 'idle');
    send(FIXTURES.UserPromptSubmit);
    assert.equal(state().sessions[0].status, 'working');
  });

  it('a working subagent keeps the session working while the lead idles', () => {
    const { send, state } = setup();
    send(FIXTURES.SubagentStart);
    send(FIXTURES.Stop);
    assert.equal(state().sessions[0].status, 'working');
    send(FIXTURES.SubagentStop);
    assert.equal(state().agents[`${SESSION}:a1b2c3`].status, 'done');
    assert.equal(state().agents[`${SESSION}:a1b2c3`].lastMessage, 'Found it in tokens.ts');
    assert.equal(state().sessions[0].status, 'idle');
  });

  it('compaction and model switches', () => {
    const { send, state } = setup();
    send(FIXTURES.SessionStart);
    send(FIXTURES.PreCompact);
    assert.equal(state().agents[MAIN].building, 'spa');
    send(FIXTURES.PostCompact);
    send(FIXTURES.PostModelSwitch);
    assert.equal(state().log.at(-1).text, 'Model: Opus 5.5 → Sonnet 5');
    assert.equal(state().sessions[0].model, 'claude-sonnet-5');
    assert.equal(state().agents[MAIN].hat, 'beret');
  });
});

describe('store: todos, tasks, log, stats and caps', () => {
  it('replaces todos and tracks shared tasks through their whole life', () => {
    const { send, state } = setup();
    send(post('TodoWrite', { todos: [{ content: 'A', status: 'completed' }, { content: 'B', status: 'pending' }] }, 'tw'));
    assert.deepEqual(state().sessions[0].todos, [
      { text: 'A', status: 'completed' },
      { text: 'B', status: 'pending' },
    ]);
    // TaskCreate's response may not carry the id: the task is matched up by subject when
    // TaskCreated (which has the id) arrives.
    send(post('TaskCreate', { subject: 'Build the settings form' }, 'tc', { result: 'no id here' }));
    assert.equal(state().sessions[0].tasks.length, 1);
    send(FIXTURES.TaskCreated);
    assert.deepEqual(state().sessions[0].tasks, [{ id: '1', subject: 'Build the settings form', status: 'pending' }]);
    send(post('TaskUpdate', { taskId: '1', status: 'in_progress', owner: 'frontend' }, 'tu'));
    assert.deepEqual(state().sessions[0].tasks[0], { id: '1', subject: 'Build the settings form', status: 'in_progress', owner: 'frontend' });
    send(FIXTURES.TaskCompleted);
    assert.equal(state().sessions[0].tasks[0].status, 'completed');
    send(post('TaskUpdate', { taskId: '1', status: 'deleted' }, 'td'));
    assert.deepEqual(state().sessions[0].tasks, []);
  });

  it('writes log lines with icons and levels, capped, newest last', () => {
    const { send, state } = setup({ maxLog: 5 });
    send(FIXTURES.SessionStart);
    send(FIXTURES.PreToolUse);
    send(FIXTURES.PostToolUseFailure);
    send(FIXTURES.PermissionRequest);
    const log = state().log;
    const tail = log.slice(-3).map((l) => [l.icon, l.level, l.kind]);
    assert.deepEqual(tail, [
      ['📚', 'info', 'tool.start'],
      ['❌', 'error', 'tool.fail'],
      ['🛂', 'warn', 'permission.request'],
    ]);
    assert.equal(log.at(-1).text, 'Needs permission: $ rm -rf dist');
    for (let i = 0; i < 10; i++) send(pre('Read', { file_path: `f${i}` }, `r${i}`));
    assert.equal(state().log.length, 5);
    assert.ok(state().log.every((entry, i, all) => i === 0 || entry.id > all[i - 1].id));
    assert.equal(state().log.at(-1).agentName, 'Foreman');
    assert.equal(state().log.at(-1).color, CREW_COLORS[0]);
  });

  it('caps recent entries and files per agent at 30', () => {
    const { send, state } = setup();
    for (let i = 0; i < 40; i++) send(pre('Read', { file_path: `${CWD}/src/f${i}.ts` }, `r${i}`));
    send(pre('Read', { file_path: `${CWD}/src/f20.ts` }, 'again'));
    const lead = state().agents[MAIN];
    assert.equal(lead.recent.length, 30);
    assert.equal(lead.files.length, 30);
    assert.equal(lead.files.at(-1), 'src/f20.ts');
    assert.equal(new Set(lead.files).size, 30);
  });

  it('keeps at most 8 finished helpers per session', () => {
    const { send, state } = setup();
    for (let i = 0; i < 12; i++) {
      send(hook('SubagentStart', {}, agent(`h${i}`, 'Explore')));
      send(hook('SubagentStop', { last_assistant_message: 'ok', stop_hook_active: false, agent_transcript_path: 't' }, agent(`h${i}`, 'Explore')));
    }
    const helpers = Object.values(state().agents).filter((a) => a.role !== 'lead');
    assert.equal(helpers.length, 8);
    assert.equal(state().sessions[0].agentKeys.length, 9);
    assert.ok(!state().agents[`${SESSION}:h0`]);
  });

  it('counts events, tool calls, failures, approvals, helpers and visits per building', () => {
    const { send, state } = setup();
    send(FIXTURES.PreToolUse);
    send(pre('Bash', { command: 'npm test' }, 'b'));
    send(FIXTURES.PostToolUseFailure);
    send(FIXTURES.PermissionRequest);
    send(FIXTURES.SubagentStart);
    send(FIXTURES.StopFailure);
    const { stats } = state();
    assert.equal(stats.events, 6);
    assert.equal(stats.toolCalls, 2);
    assert.equal(stats.failures, 2);
    assert.equal(stats.approvals, 1);
    assert.equal(stats.subagents, 1);
    assert.equal(stats.byBuilding.library, 1);
    assert.equal(stats.byBuilding.terminal, 1);
    assert.equal(stats.byBuilding.spa, 0);
  });
});

describe('store: approvals, listeners, reset', () => {
  /**
   * @param {Record<string, any>} [extra]
   * @returns {import('../../../public/js/core/store.js').Approval}
   */
  const approval = (extra = {}) => ({
    id: 'ap1',
    status: 'pending',
    held: true,
    sessionId: SESSION,
    agentId: null,
    toolName: 'Bash',
    toolInput: { command: 'rm -rf dist' },
    cwd: CWD,
    createdAt: 10,
    expiresAt: 1000,
    ...extra,
  });

  it('upserts approvals, pending first, and logs decisions', () => {
    const { store, send, state, changes } = setup();
    send(FIXTURES.SessionStart);
    store.setApproval(approval());
    store.setApproval(approval({ id: 'ap2', status: 'pending', createdAt: 20 }));
    store.setApproval(approval({ id: 'old', status: 'resolved', createdAt: 30 }));
    assert.deepEqual(
      state().approvals.map((a) => a.id),
      ['ap2', 'ap1', 'old'],
    );
    assert.equal(state().agents[MAIN].status, 'waiting');
    store.setApproval(approval({ status: 'allowed', decidedBy: 'town' }));
    assert.equal(state().approvals.find((a) => a.id === 'ap1').status, 'allowed');
    assert.equal(state().log.at(-1).text, 'Approved: $ rm -rf dist');
    assert.equal(state().log.at(-1).level, 'success');
    store.setApproval(approval({ id: 'ap2', status: 'denied' }));
    assert.match(state().log.at(-1).text, /^Denied/);
    assert.equal(changes.filter((c) => c.type === 'approval').length, 5);
    store.setApproval(/** @type {any} */ ({ status: 'pending' }));
    assert.equal(state().approvals.length, 3, 'approvals without an id are ignored');
  });

  it('a throwing listener never breaks ingestion', () => {
    /** @type {unknown[]} */
    const reported = [];
    const store = createStore({ onError: (error) => reported.push(error) });
    store.subscribe(() => {
      throw new Error('boom');
    });
    let seen = 0;
    store.subscribe(() => (seen += 1));
    const events = store.ingest(envelope(FIXTURES.PreToolUse));
    assert.equal(events.length, 1);
    assert.ok(seen >= 1);
    assert.ok(reported.length >= 1);
  });

  it('unsubscribes and resets', () => {
    const { store, send, state, changes } = setup();
    send(FIXTURES.SessionStart);
    store.reset();
    assert.equal(changes.at(-1).type, 'reset');
    assert.deepEqual(state().sessions, []);
    assert.deepEqual(state().agents, {});
    assert.deepEqual(state().log, []);
    const before = changes.length;
    const off = store.subscribe(() => {});
    off();
    store.dispatch(/** @type {any} */ ({ not: 'an event' }));
    assert.equal(changes.length, before);
  });
});

describe('store: achievements', () => {
  /** @param {(ctx: ReturnType<typeof setup>) => void} play @param {Parameters<typeof createStore>[0]} [options] */
  function unlocks(play, options) {
    const ctx = setup(options);
    play(ctx);
    return ctx.unlocked();
  }

  it('defines thirteen achievements with titles', () => {
    assert.equal(ACHIEVEMENTS.length, 13);
    for (const a of ACHIEVEMENTS) assert.ok(a.id && a.title && a.description && a.icon);
  });

  it('First Contact: the first session in town, once', () => {
    const ctx = setup();
    ctx.send(FIXTURES.SessionStart);
    ctx.send(hook('SessionStart', { source: 'startup' }, { session: 'other' }));
    assert.deepEqual(ctx.unlocked(), ['first-contact']);
    assert.equal(ctx.state().achievements[0].title, 'First Contact');
    assert.equal(ctx.state().log.at(-2).text, 'Achievement unlocked: First Contact');
  });

  it('Delegator: three helpers working for one lead at once', () => {
    const ids = unlocks(({ send }) => {
      send(hook('SubagentStart', {}, agent('a', 'Explore')));
      send(hook('SubagentStart', {}, agent('b', 'Explore')));
      send(hook('SubagentStop', { last_assistant_message: '', stop_hook_active: false }, agent('b', 'Explore')));
      send(hook('SubagentStart', {}, agent('c', 'Explore')));
    });
    assert.ok(!ids.includes('delegator'));
    const yes = unlocks(({ send }) => ['a', 'b', 'c'].forEach((id) => send(hook('SubagentStart', {}, agent(id, 'Plan')))));
    assert.ok(yes.includes('delegator'));
  });

  it('Swarm: eight agents in town at once', () => {
    const ids = unlocks(({ send }) => {
      for (let s = 0; s < 2; s++) {
        for (let i = 0; i < 3; i++) send(hook('SubagentStart', {}, { session: `s${s}`, agent: { id: `x${i}`, type: 'Explore' } }));
      }
    });
    assert.ok(ids.includes('swarm'), 'two leads + six helpers');
  });

  it('Red to Green: a failing test run, then a passing one', () => {
    const ids = unlocks(({ send }) => {
      send(post('Bash', { command: 'npm test' }, 'p0'));
      send(fail('Bash', { command: 'npm test' }, 'f1', 'Exit code 1'));
      send(post('Bash', { command: 'npm test' }, 'p1'));
    });
    assert.ok(ids.includes('red-to-green'));
  });

  it('Bookworm: fifty reads', () => {
    const ids = unlocks(({ send, unlocked }) => {
      for (let i = 0; i < 49; i++) send(pre('Read', { file_path: `f${i}` }, `r${i}`));
      assert.ok(!unlocked().includes('bookworm'));
      send(pre('Read', { file_path: 'last' }, 'r49'));
    });
    assert.ok(ids.includes('bookworm'));
  });

  it('Night Shift: activity between midnight and five', () => {
    assert.ok(unlocks(({ send }) => send(FIXTURES.PreToolUse), { localHour: () => 3 }).includes('night-shift'));
    assert.ok(!unlocks(({ send }) => send(FIXTURES.PreToolUse), { localHour: () => 5 }).includes('night-shift'));
  });

  it('node_modules Black Hole: five JavaScript installs', () => {
    const ids = unlocks(({ send }) => {
      for (let i = 0; i < 4; i++) send(pre('Bash', { command: `npm install pkg${i}` }, `i${i}`));
      send(pre('Bash', { command: 'uv add httpx' }, 'py'));
      send(pre('Bash', { command: 'pnpm add zod' }, 'i5'));
    });
    assert.ok(ids.includes('black-hole'));
  });

  it('Rubber Stamp: five approvals, from the town or the terminal, counted once each', () => {
    const ctx = setup();
    for (let i = 0; i < 3; i++) {
      ctx.send(pre('Bash', { command: 'rm -rf dist' }, `b${i}`));
      ctx.send(FIXTURES.PermissionRequest);
      ctx.store.setApproval({ id: `a${i}`, status: 'pending', held: true, sessionId: SESSION, agentId: null, toolName: 'Bash', toolInput: {}, createdAt: i, expiresAt: null });
      ctx.store.setApproval({ id: `a${i}`, status: 'allowed', held: true, sessionId: SESSION, agentId: null, toolName: 'Bash', toolInput: {}, createdAt: i, expiresAt: null });
      ctx.send(post('Bash', { command: 'rm -rf dist' }, `b${i}`));
    }
    assert.ok(!ctx.unlocked().includes('rubber-stamp'));
    for (let i = 3; i < 5; i++) {
      ctx.send(FIXTURES.PermissionRequest);
      ctx.send(post('Bash', { command: 'rm -rf dist' }, `b${i}`)); // approved in the terminal
    }
    assert.ok(ctx.unlocked().includes('rubber-stamp'));
  });

  it('Memory Lane: the first compaction', () => {
    assert.ok(unlocks(({ send }) => send(FIXTURES.PreCompact)).includes('memory-lane'));
  });

  it('Ship It: a successful git push', () => {
    const ids = unlocks(({ send }) => {
      send(fail('Bash', { command: 'git push' }, 'g1', 'rejected'));
      send(post('Bash', { command: 'git push origin main' }, 'g2'));
    });
    assert.ok(ids.includes('ship-it'));
  });

  it('Clean Sweep: every item done on a list of three or more', () => {
    const done = [{ content: 'a', status: 'completed' }, { content: 'b', status: 'completed' }];
    assert.ok(!unlocks(({ send }) => send(post('TodoWrite', { todos: done }, 't'))).includes('clean-sweep'));
    const all = [...done, { content: 'c', status: 'completed' }];
    assert.ok(unlocks(({ send }) => send(post('TodoWrite', { todos: all }, 't'))).includes('clean-sweep'));
    const tasks = unlocks(({ send }) => {
      for (const id of ['1', '2', '3']) send(hook('TaskCreated', { task_id: id, task_subject: `T${id}` }));
      for (const id of ['1', '2', '3']) send(hook('TaskCompleted', { task_id: id, task_subject: `T${id}` }));
    });
    assert.ok(tasks.includes('clean-sweep'));
  });

  it('Polyglot: three model families', () => {
    const ids = unlocks(({ send }) => {
      send(FIXTURES.SessionStart);
      send(FIXTURES.PostModelSwitch);
      send(spawn('Explore', 'x', 'h', { model: 'haiku' }));
    });
    assert.ok(ids.includes('polyglot'));
  });

  it('Teamwork: the first message between agents', () => {
    assert.ok(unlocks(({ send }) => send(pre('SendMessage', { to: 'backend', message: 'hi' }, 'm'))).includes('teamwork'));
  });

  it('emits every achievement once, after the event that earned it', () => {
    const ctx = setup();
    ctx.send(FIXTURES.SessionStart);
    ctx.send(FIXTURES.PreCompact);
    ctx.send(FIXTURES.PostCompact);
    const types = ctx.changes.map((c) => (c.type === 'achievement' ? c.achievement.id : c.event?.kind ?? c.type));
    assert.deepEqual(types, ['session.start', 'first-contact', 'compact.start', 'memory-lane', 'compact.end']);
  });
});

describe('store: team town members (§4.11)', () => {
  it('marks a teammate\'s session and names its foreman after them', () => {
    const ctx = setup();
    ctx.send(hook('SessionStart', { source: 'startup', model: 'claude-opus-4-7', andary_member: 'Lina' }, { session: 'Lina~s1' }));
    ctx.send(hook('SessionStart', { source: 'startup', model: 'claude-opus-4-7' }));
    const [theirs, mine] = ctx.state().sessions;
    assert.equal(theirs.member, 'Lina');
    assert.equal(ctx.state().agents['Lina~s1:main'].name, 'Lina');
    assert.equal(mine.member, null);
    assert.equal(ctx.state().agents[MAIN].name, 'Foreman');
  });

  it('keeps a member name to one short line', () => {
    const ctx = setup();
    ctx.send(hook('UserPromptSubmit', { prompt: 'hi', andary_member: `Lina\n${'x'.repeat(40)}` }, { session: 'Lina~s2' }));
    const member = ctx.state().sessions[0].member ?? '';
    assert.ok(!member.includes('\n'));
    assert.ok(member.length <= 24);
  });
});

describe('store: Codex crews (§4.12)', () => {
  it('marks a session that came from Codex', () => {
    const ctx = setup();
    ctx.send(hook('SessionStart', { source: 'startup', model: 'gpt-5.3-codex', andary_source: 'codex' }, { session: 'thr_1' }));
    ctx.send(hook('SessionStart', { source: 'startup', model: 'claude-opus-5-5' }));
    const [codexCrew, claudeCrew] = ctx.state().sessions;
    assert.equal(codexCrew.source, 'codex');
    assert.equal(claudeCrew.source, 'claude');
    assert.equal(ctx.state().agents['thr_1:main'].hat, 'cap');
  });
});

