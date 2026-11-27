import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createDirector, recordChanges } from '../../../public/js/core/director.js';
import { modelLabel } from '../../../public/js/core/catalog.js';
import { createStore } from '../../../public/js/core/store.js';
import { CREW_COLORS } from '../../../public/js/core/catalog.js';
import { CWD, FIXTURES, SESSION, createFakeClock, createRecordingWorld, flush, hook } from './helpers.mjs';

const MAIN = `${SESSION}:main`;

/**
 * Store + director + recording world on one virtual clock. Quips are "[situation]" so the tests
 * can see which joke was asked for; random 0.1 makes bubbles informative, 0.9 makes them jokes.
 * @param {{manualWalks?: boolean, random?: () => number, world?: any, quiet?: () => boolean}} [options]
 */
function setup(options = {}) {
  const clock = createFakeClock();
  const store = createStore({ now: clock.now, localHour: () => 12 });
  const world = options.world ?? createRecordingWorld({ manualWalks: options.manualWalks });
  const humor = { quip: (/** @type {string} */ situation) => `[${situation}]` };
  const director = createDirector({
    world,
    store,
    humor,
    random: options.random ?? (() => 0.1),
    quiet: options.quiet,
    now: clock.now,
    setTimer: (fn, ms) => clock.setTimeout(fn, ms),
    clearTimer: (handle) => clock.clearTimeout(handle),
  });
  let id = 0;
  /** @param {Record<string, any>} payload @param {{age?: number}} [opts] */
  const send = async (payload, opts = {}) => {
    const ts = clock.now() - (opts.age ?? 0);
    id += 1;
    store.ingest({ id, ts, rx: ts, event: payload });
    await flush();
  };
  /** Session started and the Foreman settled at the hall, with a quiet log. */
  const ready = async () => {
    await send(FIXTURES.SessionStart);
    await world.finishAllWalks?.();
    await clock.advance(3000);
    world.clear();
  };
  /** @param {string} name */
  const calls = (name) => world.calls.filter((/** @type {any[]} */ c) => c[0] === name);
  /** @param {string} key */
  const says = (key = MAIN) => calls('say').filter((c) => c[1] === key).map((c) => c[2]);
  return { clock, store, world, director, send, ready, calls, says };
}

/** @param {string} tool @param {Record<string, any>} input @param {string} id @param {any} [who] */
const pre = (tool, input, id, who) => hook('PreToolUse', { tool_name: tool, tool_input: input, tool_use_id: id }, who);
/** @param {string} tool @param {Record<string, any>} input @param {string} id @param {any} [who] */
const post = (tool, input, id, who) => hook('PostToolUse', { tool_name: tool, tool_input: input, tool_response: {}, tool_use_id: id }, who);
/** @param {string} tool @param {Record<string, any>} input @param {string} id @param {string} error @param {any} [who] */
const fail = (tool, input, id, error, who) => hook('PostToolUseFailure', { tool_name: tool, tool_input: input, tool_use_id: id, error, is_interrupt: false }, who);
const read = (/** @type {string} */ id) => pre('Read', { file_path: `${CWD}/src/${id}.ts` }, id);
const readDone = (/** @type {string} */ id) => post('Read', { file_path: `${CWD}/src/${id}.ts` }, id);

describe('director: crews arrive, work and leave', () => {
  it('a session arrives by bus and walks to the Town Hall', async () => {
    const { send, clock, calls, says } = setup();
    await send(FIXTURES.SessionStart);
    assert.deepEqual(calls('vehicle')[0], ['vehicle', 'bus', 'arrive']);
    const [, spec] = calls('addAgent')[0];
    assert.deepEqual(spec, { id: MAIN, name: 'Foreman', color: CREW_COLORS[0], role: 'lead', type: 'main', hat: 'crown', spawnAt: 'station', entrance: 'bus' });
    assert.deepEqual(calls('goTo')[0], ['goTo', MAIN, 'hall', { pace: 'walk' }]);
    await clock.advance(1500);
    assert.ok(calls('setActivity').some((c) => c[1] === MAIN && c[2] === 'wave'));
    assert.ok(says().includes('[session.start]'));
    assert.ok(says().includes('[achievement]'), 'First Contact is celebrated');
    assert.ok(calls('effect').some((c) => c[1] === 'confetti' && c[2].building === 'hall'));
  });

  it('a prompt sends the Foreman to the hall with the goal', async () => {
    const { send, ready, says, calls, clock } = setup();
    await ready();
    await send(FIXTURES.UserPromptSubmit);
    await clock.advance(100);
    assert.ok(calls('emote').some((c) => c[1] === MAIN && c[2] === '📜'));
    assert.deepEqual(says(), ['On it: Fix the flaky login test']);
  });

  it('a quiet town tells no jokes, but still says the goal', async () => {
    const { send, clock, says } = setup({ random: () => 0.9, quiet: () => true });
    await send(FIXTURES.SessionStart);
    await clock.advance(3000);
    assert.deepEqual(says(), [], 'no arrival joke, no achievement cheer');
    await send(hook('UserPromptSubmit', { prompt: 'Fix it' }));
    await clock.advance(3000);
    assert.deepEqual(says(), ['On it: Fix it'], 'a short goal is said plainly, never as a quip');
  });

  it('"continue" is said as carrying on with the goal kept, never "On it: continue"', async () => {
    const { send, ready, says, clock } = setup();
    await ready();
    await send(hook('UserPromptSubmit', { prompt: 'continue' }));
    await clock.advance(3000);
    assert.deepEqual(says(), ['Carrying on']);
    await send(hook('UserPromptSubmit', { prompt: 'Fix the clock' }));
    await clock.advance(6000);
    await send(hook('UserPromptSubmit', { prompt: 'go on' }));
    await clock.advance(6000);
    assert.deepEqual(says().slice(1), ['On it: Fix the clock', 'Carrying on: Fix the clock']);
  });

  it('a long goal is never squeezed into a joke', async () => {
    const { send, ready, says, clock } = setup({ random: () => 0.9 });
    await ready();
    await send(hook('UserPromptSubmit', { prompt: 'Refactor the whole authentication module to use the new session store and add tests' }));
    await clock.advance(100);
    assert.match(says()[0], /^On it: Refactor the whole/);
  });

  it('a tool call: walk there, then activity, pulse, building effect and a bubble', async () => {
    const { send, ready, calls, says } = setup();
    await ready();
    await send(FIXTURES.PreToolUse);
    assert.deepEqual(calls('goTo')[0], ['goTo', MAIN, 'library', { pace: 'walk' }]);
    assert.deepEqual(calls('setActivity').at(-1), ['setActivity', MAIN, 'read']);
    assert.deepEqual(calls('pulseBuilding')[0], ['pulseBuilding', 'library', CREW_COLORS[0]]);
    assert.deepEqual(calls('effect')[0], ['effect', 'books', { building: 'library' }]);
    assert.deepEqual(says(), ['Read src/auth/login.ts']);
    assert.deepEqual(calls('setStatus').at(-1), ['setStatus', MAIN, 'working']);
  });

  it('jokes instead of facts about 40% of the time', async () => {
    const { send, ready, says } = setup({ random: () => 0.9 });
    await ready();
    await send(pre('Bash', { command: 'docker compose up -d' }, 'd1'));
    assert.deepEqual(says(), ['[cmd.docker]']);
  });

  it('tool results: check mark, building stat, combo badge for repeats', async () => {
    const { send, ready, calls, clock } = setup();
    await ready();
    for (const id of ['a', 'b', 'c']) {
      await send(read(id));
      await send(readDone(id));
      await clock.advance(1000);
    }
    assert.deepEqual(
      calls('setBuildingStat').map((c) => c[2]),
      ['1 read', '2 reads', '3 reads'],
    );
    assert.deepEqual(
      calls('setBadge').map((c) => c[2]),
      ['×2', '×3'],
    );
    assert.equal(calls('effect').filter((c) => c[1] === 'check').length, 1, 'repeats show the badge instead');
    await send(pre('Grep', { pattern: 'x' }, 'g'));
    await send(post('Grep', { pattern: 'x' }, 'g'));
    assert.deepEqual(calls('setBadge').at(-1), ['setBadge', MAIN, null]);
  });

  it('failures: cross, facepalm, a quip by error type, rain after two in a row, sun after a success', async () => {
    const { send, ready, calls, says, clock } = setup();
    await ready();
    await send(pre('Read', { file_path: 'gone.ts' }, 'r1'));
    await send(fail('Read', { file_path: 'gone.ts' }, 'r1', 'File does not exist.'));
    assert.ok(calls('effect').some((c) => c[1] === 'cross'));
    assert.deepEqual(calls('setActivity').at(-1), ['setActivity', MAIN, 'facepalm']);
    assert.deepEqual(calls('setStatus').at(-1), ['setStatus', MAIN, 'error']);
    await clock.advance(1500);
    assert.ok(says().includes('[fail.notfound]'));
    assert.equal(calls('weather').length, 0);
    await send(pre('Bash', { command: 'make' }, 'm1'));
    await send(fail('Bash', { command: 'make' }, 'm1', 'Exit code 2'));
    await clock.advance(1500);
    assert.deepEqual(calls('weather').at(-1), ['weather', MAIN, 'rain']);
    assert.ok(says().includes('[fail.repeated]'));
    await send(pre('Bash', { command: 'ls' }, 'l1'));
    await send(post('Bash', { command: 'ls' }, 'l1'));
    assert.deepEqual(calls('weather').at(-1), ['weather', MAIN, null]);
  });

  it('tests: smoke and rain when red, fireworks when green', async () => {
    const { send, ready, calls, says, clock } = setup();
    await ready();
    await send(pre('Bash', { command: 'npm test' }, 't1'));
    await send(fail('Bash', { command: 'npm test' }, 't1', 'Exit code 1'));
    assert.ok(calls('effect').some((c) => c[1] === 'smoke' && c[2].building === 'terminal'));
    assert.deepEqual(calls('weather').at(-1), ['weather', MAIN, 'rain']);
    await clock.advance(1500);
    assert.ok(says().includes('[fail.tests]'));
    await send(pre('Bash', { command: 'npm test' }, 't2'));
    await send(post('Bash', { command: 'npm test' }, 't2'));
    assert.ok(calls('effect').some((c) => c[1] === 'fireworks' && c[2].building === 'terminal'));
    assert.deepEqual(calls('weather').at(-1), ['weather', MAIN, null]);
    await clock.advance(1500);
    assert.ok(says().includes('[success.tests]'));
  });

  it('StopFailure: a storm and a quip for the error, cleared by the next prompt', async () => {
    const { send, ready, calls, says, clock } = setup();
    await ready();
    await send(FIXTURES.StopFailure);
    assert.deepEqual(calls('weather').at(-1), ['weather', MAIN, 'storm']);
    assert.deepEqual(says(), ['[stop.rate_limit]']);
    await clock.advance(1500);
    await send(FIXTURES.UserPromptSubmit);
    assert.deepEqual(calls('weather').at(-1), ['weather', MAIN, null]);
  });

  it('an agent that seems stuck has a storm over it until the alert ends, whatever else works meanwhile', async () => {
    const { send, ready, calls, store, clock, world } = setup();
    await ready();
    for (const id of ['t1', 't2']) {
      await send(pre('Bash', { command: 'npm test' }, id));
      await send(fail('Bash', { command: 'npm test' }, id, 'Exit code 1'));
      await clock.advance(1500);
    }
    assert.deepEqual(calls('weather').at(-1), ['weather', MAIN, 'rain'], 'two red runs: rain, not yet stuck');
    await send(pre('Bash', { command: 'npm test' }, 't3'));
    await send(fail('Bash', { command: 'npm test' }, 't3', 'Exit code 1'));
    assert.ok(store.getState().agents[MAIN].stuck);
    assert.deepEqual(calls('weather').at(-1), ['weather', MAIN, 'storm']);
    await clock.advance(1500);
    world.clear();
    await send(pre('Bash', { command: 'ls' }, 'l1'));
    await send(post('Bash', { command: 'ls' }, 'l1'));
    await clock.advance(1500);
    assert.ok(calls('effect').some((c) => c[1] === 'check' && c[2].agent === MAIN), 'the success was shown');
    assert.deepEqual(calls('weather'), [], 'another step working is no way out: the storm stays');
    // A helper's edit in the same folder is progress: the lead's alert ends, and its storm with it.
    const helper = { agent: { id: 'h1', type: 'general-purpose' } };
    await send(pre('Edit', { file_path: `${CWD}/src/a.ts` }, 'e1', helper));
    await send(post('Edit', { file_path: `${CWD}/src/a.ts`, old_string: 'a', new_string: 'b' }, 'e1', helper));
    assert.equal(store.getState().agents[MAIN].stuck, null);
    assert.deepEqual(calls('weather').filter((c) => c[1] === MAIN).at(-1), ['weather', MAIN, null]);
  });

  it("a failed turn's storm outlasts the stuck alert its end cleared", async () => {
    const { send, ready, calls, store } = setup();
    await ready();
    for (const id of ['t1', 't2', 't3']) await send(fail('Bash', { command: 'npm test' }, id, 'Exit code 1'));
    assert.deepEqual(calls('weather').at(-1), ['weather', MAIN, 'storm']);
    await send(FIXTURES.StopFailure);
    assert.equal(store.getState().agents[MAIN].stuck, null, 'the turn ended');
    assert.deepEqual(calls('weather').at(-1), ['weather', MAIN, 'storm'], 'the turn failing has its own storm');
    await send(FIXTURES.UserPromptSubmit);
    assert.deepEqual(calls('weather').at(-1), ['weather', MAIN, null]);
  });

  it('turn over: celebrate, then coffee at the café, then a nap after two idle minutes', async () => {
    const { send, ready, calls, says, clock, world } = setup();
    await ready();
    await send(FIXTURES.UserPromptSubmit);
    await clock.advance(2000);
    world.clear();
    await send(FIXTURES.Stop);
    assert.deepEqual(calls('setStatus').at(-1), ['setStatus', MAIN, 'idle']);
    assert.ok(calls('setActivity').some((c) => c[2] === 'celebrate'));
    assert.deepEqual(says(), ['All done.']);
    assert.deepEqual(calls('goTo').at(-1), ['goTo', MAIN, 'cafe', { pace: 'walk' }]);
    assert.deepEqual(calls('setActivity').at(-1), ['setActivity', MAIN, 'sip']);
    await clock.advance(119_000);
    assert.notEqual(calls('setActivity').at(-1)[2], 'sleep');
    await clock.advance(2000);
    assert.deepEqual(calls('setActivity').at(-1), ['setActivity', MAIN, 'sleep']);
    assert.ok(calls('effect').some((c) => c[1] === 'zzz'));
    assert.equal(says().at(-1), '[sleep]');
    await send(FIXTURES.UserPromptSubmit);
    assert.ok(calls('emote').some((c) => c[2] === '❗'));
    await clock.advance(1300);
    assert.ok(says().includes('[wake]'));
  });

  it('an idle-prompt notification also sends the agent to the café', async () => {
    const { send, ready, calls, clock } = setup();
    await ready();
    await send(hook('Notification', { message: 'Claude is waiting for your input', notification_type: 'idle_prompt' }));
    await clock.advance(1000);
    assert.deepEqual(calls('goTo').at(-1), ['goTo', MAIN, 'cafe', { pace: 'walk' }]);
  });

  it('the session leaves by bus; its helpers vanish', async () => {
    const { send, ready, calls, says, clock } = setup();
    await ready();
    await send(FIXTURES.SubagentStart);
    await clock.advance(1500);
    await send(FIXTURES.SessionEnd);
    assert.ok(says().includes('[session.end]'));
    assert.deepEqual(calls('goTo').at(-1), ['goTo', MAIN, 'station', { pace: 'walk' }]);
    assert.deepEqual(calls('vehicle').at(-1), ['vehicle', 'bus', 'depart']);
    assert.deepEqual(
      calls('removeAgent').map((c) => [c[1], c[2].exit]),
      [
        [`${SESSION}:a1b2c3`, 'poof'],
        [MAIN, 'bus'],
      ],
    );
    await send(FIXTURES.PreToolUse);
    assert.equal(calls('goTo').filter((c) => c[2] === 'library').length, 0, 'a departed crew gets no work');
  });
});

describe('director: helpers', () => {
  it('a subagent arrives through the portal at the hall and introduces itself', async () => {
    const { send, ready, calls, says } = setup();
    await ready();
    await send(pre('Agent', { description: 'Find expiry', prompt: 'p', subagent_type: 'Explore' }, 'sp'));
    await send(FIXTURES.SubagentStart);
    const key = `${SESSION}:a1b2c3`;
    const spec = calls('addAgent').at(-1)[1];
    assert.deepEqual(spec, { id: key, name: 'Scout 1', color: CREW_COLORS[0], role: 'subagent', type: 'Explore', hat: 'cap', spawnAt: 'hall', entrance: 'portal' });
    assert.ok(calls('effect').some((c) => c[1] === 'portal' && c[2].building === 'hall'));
    assert.deepEqual(says(key), ['[spawn.explore]']);
  });

  it('a finished subagent reports, celebrates, walks to the hall and leaves through the portal', async () => {
    const { send, ready, calls, says, clock } = setup();
    await ready();
    const key = `${SESSION}:a1b2c3`;
    const who = { agent: { id: 'agent-a1b2c3', type: 'Explore' } };
    await send(FIXTURES.SubagentStart);
    await send(pre('Read', { file_path: 'x.ts' }, 'r', who));
    await clock.advance(1500);
    await send(FIXTURES.SubagentStop);
    assert.deepEqual(calls('setStatus').at(-1), ['setStatus', key, 'done']);
    await clock.advance(1300);
    assert.ok(says(key).includes('Found it in tokens.ts'));
    assert.ok(calls('setActivity').some((c) => c[1] === key && c[2] === 'celebrate'));
    await clock.advance(1600);
    assert.deepEqual(calls('goTo').at(-1), ['goTo', key, 'hall', { pace: 'walk' }]);
    assert.deepEqual(calls('removeAgent').at(-1), ['removeAgent', key, { exit: 'portal' }]);
  });

  it('a helper finishing right after speaking still gets its last word in', async () => {
    const { send, ready, says, clock } = setup();
    await ready();
    const key = `${SESSION}:a1b2c3`;
    await send(FIXTURES.SubagentStart);
    await send(FIXTURES.SubagentStop);
    assert.deepEqual(says(key), ['[spawn.explore]']);
    await clock.advance(1300);
    assert.deepEqual(says(key), ['[spawn.explore]', 'Found it in tokens.ts']);
  });

  it('teammates are introduced as teammates and renamed when evidence arrives', async () => {
    const { send, ready, calls, says } = setup();
    await ready();
    await send(hook('SubagentStart', {}, { agent: { id: 'q', type: 'general-purpose' } }));
    await send(hook('TeammateIdle', { teammate_name: 'researcher' }, { agent: { id: 'q', type: 'general-purpose' } }));
    const rename = calls('updateAgent').at(-1);
    assert.equal(rename[1], `${SESSION}:q`);
    assert.equal(rename[2].name, 'researcher');
    assert.equal(rename[2].role, 'teammate');
    assert.deepEqual(says(`${SESSION}:q`), ['[spawn.general]']);
  });

  it('messages fly to the named recipient, or to the post office', async () => {
    const { send, ready, calls, clock } = setup();
    await ready();
    await send(pre('Agent', { description: 'API', prompt: 'p', subagent_type: 'general-purpose', name: 'backend' }, 'sp'));
    await send(hook('SubagentStart', {}, { agent: { id: 'b', type: 'general-purpose' } }));
    await clock.advance(1500);
    await send(pre('SendMessage', { to: 'backend', message: 'What shape?', summary: 'API shape' }, 'm1'));
    assert.deepEqual(calls('sendMessage').at(-1), ['sendMessage', MAIN, { agent: `${SESSION}:b` }]);
    assert.ok(calls('emote').some((c) => c[1] === `${SESSION}:b` && c[2] === '📨'));
    await send(pre('SendMessage', { to: 'team-lead', message: 'Done' }, 'm2', { agent: { id: 'b', type: 'general-purpose' } }));
    assert.deepEqual(calls('sendMessage').at(-1), ['sendMessage', `${SESSION}:b`, { agent: MAIN }]);
    await send(pre('SendMessage', { to: 'someone-else', message: '?' }, 'm3'));
    assert.deepEqual(calls('sendMessage').at(-1), ['sendMessage', MAIN, { building: 'post' }]);
  });

  it('isolated helpers and EnterWorktree plant trees in the grove, removed with the session', async () => {
    const { send, ready, calls } = setup();
    await ready();
    await send(pre('Agent', { description: 'Try a spike', prompt: 'p', subagent_type: 'general-purpose', isolation: 'worktree', name: 'spike' }, 'wt1'));
    await send(pre('EnterWorktree', { name: 'experiment' }, 'wt2'));
    assert.deepEqual(
      calls('addWorktree').map((c) => c.slice(1)),
      [
        [`${SESSION}:wt:wt1`, 'spike'],
        [`${SESSION}:wt:enter:experiment`, 'experiment'],
      ],
    );
    await send(FIXTURES.SessionEnd);
    assert.equal(calls('removeWorktree').length, 2);
  });
});

describe('director: permits, compaction, models, board, shipping', () => {
  it('waits at the Permit Office until answered, with escalating impatience', async () => {
    const { send, ready, calls, says, clock } = setup();
    await ready();
    await send(pre('Bash', { command: 'rm -rf dist' }, 'b1'));
    await clock.advance(1500);
    await send(FIXTURES.PermissionRequest);
    assert.deepEqual(calls('setStatus').at(-1), ['setStatus', MAIN, 'waiting']);
    await clock.advance(1000);
    assert.deepEqual(calls('goTo').at(-1), ['goTo', MAIN, 'permits', { pace: 'walk' }]);
    assert.deepEqual(calls('setActivity').at(-1), ['setActivity', MAIN, 'wait']);
    assert.ok(says().includes('[permission.request]'));
    await clock.advance(15_000);
    assert.equal(says().at(-1), '[wait.1]');
    await clock.advance(25_000);
    assert.equal(says().at(-1), '[wait.2]');
    await clock.advance(40_000);
    assert.equal(says().at(-1), '[wait.3]');
    assert.ok(calls('emote').some((c) => c[2] === '⏳'));
    await clock.advance(70_000);
    assert.equal(says().at(-1), '[wait.4]');
    assert.equal(calls('say').at(-1)[3].tone, 'shout');
    const before = says().length;
    await send(post('Bash', { command: 'rm -rf dist' }, 'b1'));
    await clock.advance(300_000);
    assert.equal(says().filter((s) => s.startsWith('[wait.')).length, 4);
    assert.ok(says().length >= before);
  });

  it('a permit queued ahead of its tool: wait first, work after the answer', async () => {
    const { send, ready, world, calls, clock } = setup({ manualWalks: true });
    await ready();
    await send(pre('Read', { file_path: 'a.ts' }, 'r1'));
    await send(pre('Bash', { command: 'rm -rf dist' }, 'b1'));
    await send(FIXTURES.PermissionRequest);
    await world.finishAllWalks();
    await clock.advance(1000);
    await world.finishAllWalks();
    assert.deepEqual(
      calls('goTo').map((c) => c[2]),
      ['library', 'permits'],
    );
    await clock.advance(5000);
    assert.equal(calls('goTo').length, 2, 'held at the counter');
    await send(post('Bash', { command: 'rm -rf dist' }, 'b1'));
    await world.finishAllWalks();
    assert.deepEqual(calls('goTo').at(-1)[2], 'terminal');
    assert.ok(calls('effect').some((c) => c[1] === 'check'), 'the result plays on arrival');
  });

  it('a town decision releases the agent with a reaction', async () => {
    const { send, ready, store, says, clock, calls } = setup();
    await ready();
    await send(FIXTURES.PermissionRequest);
    await clock.advance(2000);
    const approval = { id: 'a1', status: 'pending', held: true, sessionId: SESSION, agentId: null, toolName: 'Bash', toolInput: {}, createdAt: 1, expiresAt: null };
    store.setApproval(/** @type {any} */ (approval));
    store.setApproval(/** @type {any} */ ({ ...approval, status: 'allowed' }));
    assert.ok(says().includes('[permission.allowed]'));
    assert.ok(calls('emote').some((c) => c[2] === '✅'));
    assert.deepEqual(calls('setStatus').at(-1), ['setStatus', MAIN, 'working']);
    await clock.advance(200_000);
    assert.ok(!says().some((s) => s.startsWith('[wait.')), 'no nagging once answered');
  });

  it('an expiry reacts once: the late proof that sends it again plays nothing', async () => {
    const { send, ready, store, says, calls, clock } = setup();
    await ready();
    await send(FIXTURES.PermissionRequest);
    await clock.advance(2000);
    const approval = { id: 'a1', status: 'pending', held: true, sessionId: SESSION, agentId: null, toolName: 'Bash', toolInput: {}, createdAt: 1, expiresAt: null };
    store.setApproval(/** @type {any} */ (approval));
    store.setApproval(/** @type {any} */ ({ ...approval, status: 'expired', held: false }));
    await clock.advance(5000);
    const expiries = () => [says().filter((s) => s === '[permission.expired]').length, calls('emote').filter((c) => c[2] === '⌛').length];
    assert.deepEqual(expiries(), [1, 1]);
    store.setApproval(/** @type {any} */ ({ ...approval, status: 'expired', held: false, proof: 'ran' }));
    await clock.advance(5000);
    assert.deepEqual(expiries(), [1, 1], 'no second ⌛ or quip after the tool ran');
  });

  it('compaction: a held visit to the spa, steam, then a bright idea', async () => {
    const { send, ready, calls, says, clock } = setup();
    await ready();
    await send(FIXTURES.PreCompact);
    assert.deepEqual(calls('goTo').at(-1), ['goTo', MAIN, 'spa', { pace: 'walk' }]);
    assert.deepEqual(calls('setActivity').at(-1), ['setActivity', MAIN, 'spa']);
    assert.ok(calls('effect').some((c) => c[1] === 'steam' && c[2].building === 'spa'));
    await clock.advance(1500);
    assert.deepEqual(says(), ['[achievement]', '[compact.start]'], 'Memory Lane first, then the spa quip in turn');
    await send(FIXTURES.PostCompact);
    assert.ok(calls('effect').some((c) => c[1] === 'bulb'));
    await clock.advance(1300);
    assert.ok(says().includes('[compact.end]'));
  });

  it('a model switch changes the hat and gets a quip', async () => {
    const { send, ready, calls, says } = setup();
    await ready();
    await send(FIXTURES.PostModelSwitch);
    assert.deepEqual(calls('updateAgent').at(-1), ['updateAgent', MAIN, { hat: 'beret' }]);
    assert.deepEqual(says(), ['[model.sonnet]']);
    assert.equal(modelLabel('claude-opus-5-5'), 'Opus 5.5');
    assert.equal(modelLabel('claude-haiku-4-5'), 'Haiku 4.5');
    assert.equal(modelLabel('sonnet'), 'Sonnet');
    assert.equal(modelLabel('mistral-x'), 'mistral-x');
  });

  it('todos and shared tasks go on the Goal Board', async () => {
    const { send, ready, calls, says, clock } = setup();
    await ready();
    const todos = [
      { content: 'Reproduce', status: 'completed', activeForm: 'Reproducing' },
      { content: 'Fix', status: 'in_progress', activeForm: 'Fixing' },
    ];
    await send(post('TodoWrite', { todos }, 'tw'));
    assert.deepEqual(calls('setBoard').at(-1), [
      'setBoard',
      [
        { text: 'Reproduce', status: 'completed' },
        { text: 'Fix', status: 'in_progress' },
      ],
      'api-server · todos',
    ]);
    assert.ok(says().includes('[todo.done]'));
    await clock.advance(1500);
    await send(post('TodoWrite', { todos: todos.map((t) => ({ ...t, status: 'completed' })) }, 'tw2'));
    assert.ok(says().includes('[todos.all]'));
    assert.ok(calls('effect').some((c) => c[1] === 'confetti' && c[2].building === 'board'));
    await send(FIXTURES.TaskCreated);
    assert.deepEqual(calls('setBoard').at(-1), ['setBoard', [{ text: 'Build the settings form', status: 'pending' }], 'api-server · tasks']);
  });

  it('installs grow the node_modules pile', async () => {
    const { send, ready, calls } = setup();
    await ready();
    await send(pre('Bash', { command: 'npm install zod' }, 'i1'));
    assert.ok(calls('effect').some((c) => c[1] === 'boxes' && c[2].building === 'terminal'));
    await send(post('Bash', { command: 'npm install zod' }, 'i1'));
    assert.deepEqual(calls('setNodeModules').at(-1), ['setNodeModules', 1]);
  });

  it('commits and pushes send the mail truck; MCP calls bring a boat', async () => {
    const { send, ready, calls, clock } = setup();
    await ready();
    await send(pre('Bash', { command: 'git commit -m "fix"' }, 'c1'));
    assert.deepEqual(calls('goTo').at(-1)[2], 'post');
    await send(post('Bash', { command: 'git commit -m "fix"' }, 'c1'));
    await send(pre('Bash', { command: 'git push' }, 'p1'));
    await send(post('Bash', { command: 'git push' }, 'p1'));
    assert.equal(calls('vehicle').filter((c) => c[1] === 'mailtruck').length, 1, 'the push plays when the agent gets there');
    await clock.advance(1000);
    assert.equal(calls('vehicle').filter((c) => c[1] === 'mailtruck' && c[2] === 'trip').length, 2);
    await clock.advance(1000);
    await send(pre('mcp__github__list_issues', {}, 'mcp1'));
    await clock.advance(1000);
    await send(pre('mcp__github__list_issues', {}, 'mcp2'));
    assert.equal(calls('vehicle').filter((c) => c[1] === 'boat').length, 1, 'boats are occasional');
  });
});

describe('director: lag control and speech', () => {
  it('runs when more than 3 visits wait, teleports and merges repeats when more than 6 do', async () => {
    const { send, ready, world, calls } = setup({ manualWalks: true });
    await ready();
    await send(pre('Bash', { command: 'ls' }, 'start'));
    for (let i = 0; i < 4; i++) await send(read(`r${i}`));
    await world.finishWalk();
    await flush();
    assert.deepEqual(calls('goTo').map((c) => c[3].pace), ['walk', 'run']);
    for (let i = 4; i < 9; i++) await send(read(`r${i}`));
    assert.ok(calls('goTo').some((c) => c[3].pace === 'teleport'), 'the walk in progress is cut short');
    const pulsesBefore = calls('pulseBuilding').length;
    await world.finishAllWalks();
    assert.ok(calls('pulseBuilding').length - pulsesBefore <= 3, 'nine library visits were merged into a few');
    for (let i = 0; i < 9; i++) await send(readDone(`r${i}`));
    assert.deepEqual(calls('setBadge').at(-1), ['setBadge', MAIN, '×9']);
  });

  it('caps the queue: a flood of calls never leaves more than 10 visits behind', async () => {
    const { send, ready, world, calls } = setup({ manualWalks: true });
    await ready();
    const buildings = [
      ['Read', { file_path: 'a' }],
      ['Bash', { command: 'ls' }],
      ['Grep', { pattern: 'x' }],
      ['WebSearch', { query: 'q' }],
    ];
    for (let i = 0; i < 40; i++) {
      const [tool, input] = buildings[i % buildings.length];
      await send(pre(/** @type {string} */ (tool), /** @type {any} */ (input), `f${i}`));
    }
    await world.finishAllWalks();
    const walks = calls('goTo');
    assert.ok(walks.length <= 12, `${walks.length} walks`);
    assert.ok(walks.slice(2).every((c) => c[3].pace === 'teleport'));
  });

  it('dwells briefly at each building before moving on', async () => {
    const { send, ready, calls, clock } = setup();
    await ready();
    await send(read('a'));
    await send(pre('Grep', { pattern: 'x' }, 'g'));
    assert.equal(calls('goTo').length, 1);
    await clock.advance(950);
    assert.equal(calls('goTo').length, 2);
  });

  it('throttles bubbles to one per 1.2 s per agent; important ones wait their turn', async () => {
    const { send, ready, says, clock } = setup();
    await ready();
    await send(read('a'));
    await send(fail('Read', { file_path: `${CWD}/src/a.ts` }, 'a', 'File does not exist.'));
    await send(FIXTURES.PreCompact);
    assert.deepEqual(says(), ['Read src/a.ts'], 'important lines wait for the gap');
    await clock.advance(1250);
    assert.deepEqual(says(), ['Read src/a.ts', '[fail.notfound]']);
    await clock.advance(1250);
    assert.deepEqual(says(), ['Read src/a.ts', '[fail.notfound]', '[achievement]'], 'queued lines keep their order');
    await clock.advance(5000);
    const spoken = says().length;
    await send(pre('Grep', { pattern: 'x' }, 'g'));
    await send(pre('Glob', { pattern: '*' }, 'h'));
    await clock.advance(1000);
    assert.equal(says().length, spoken + 1, 'a second ordinary bubble within 1.2 s is dropped');
  });

  it('replayed history places agents without any show', async () => {
    const { send, calls } = setup();
    const old = { age: 60_000 };
    await send(FIXTURES.SessionStart, old);
    await send(FIXTURES.PreToolUse, old);
    await send(FIXTURES.PostToolUseFailure, old);
    await send(FIXTURES.SubagentStart, old);
    assert.equal(calls('vehicle').length, 0);
    assert.equal(calls('say').length, 0);
    assert.equal(calls('effect').length, 0);
    assert.ok(calls('addAgent').every((c) => c[1].entrance === 'none'));
    assert.ok(calls('goTo').every((c) => c[3].pace === 'teleport'));
    assert.deepEqual(calls('setStatus').find((c) => c[2] === 'error'), ['setStatus', MAIN, 'error']);
  });
});

describe('director: lifecycle and robustness', () => {
  it('places agents that were already in the store, without ceremony', async () => {
    const clock = createFakeClock();
    const store = createStore({ now: clock.now });
    store.ingest({ id: 1, ts: clock.now(), rx: clock.now(), event: FIXTURES.PreToolUse });
    store.ingest({ id: 2, ts: clock.now(), rx: clock.now(), event: hook('PostToolUse', { tool_name: 'TodoWrite', tool_input: { todos: [{ content: 'A', status: 'pending' }] }, tool_response: {}, tool_use_id: 't' }) });
    const world = createRecordingWorld();
    createDirector({ world, store, now: clock.now, setTimer: (fn, ms) => clock.setTimeout(fn, ms), clearTimer: (h) => clock.clearTimeout(h) });
    const [, spec] = world.named('addAgent')[0];
    assert.equal(spec.spawnAt, 'library');
    assert.equal(spec.entrance, 'none');
    assert.deepEqual(world.named('setBoard')[0], ['setBoard', [{ text: 'A', status: 'pending' }], 'api-server · todos']);
  });

  it('a director that starts after the store plays its backlog, exactly as if it had listened all along', async () => {
    const story = [FIXTURES.SessionStart, FIXTURES.UserPromptSubmit, FIXTURES.PreToolUse, FIXTURES.SubagentStart];
    /** @param {boolean} late  start the director after the events (the world was still loading) */
    const run = async (late) => {
      const clock = createFakeClock();
      const store = createStore({ now: clock.now, localHour: () => 12 });
      const world = createRecordingWorld();
      const options = {
        world,
        store,
        humor: { quip: (/** @type {string} */ situation) => `[${situation}]` },
        random: () => 0.1,
        now: clock.now,
        setTimer: (/** @type {() => void} */ fn, /** @type {number} */ ms) => clock.setTimeout(fn, ms),
        clearTimer: (/** @type {unknown} */ h) => clock.clearTimeout(h),
      };
      const backlog = late ? recordChanges(store) : null;
      if (!late) createDirector(options);
      story.forEach((event, i) => store.ingest({ id: i + 1, ts: clock.now(), rx: clock.now(), event }));
      if (late) createDirector({ ...options, backlog: backlog?.stop() });
      await flush();
      await clock.advance(10_000);
      return world.calls;
    };
    const late = await run(true);
    const early = await run(false);
    // Listening from the start, it first clears the board of the empty store (a no-op on a new world).
    assert.deepEqual(early[0], ['setBoard', [], undefined]);
    assert.deepEqual(late, early.slice(1));
    const arrival = late.find((c) => c[0] === 'addAgent');
    assert.equal(arrival?.[1].entrance, 'bus', 'the first crew still arrives by bus');
  });

  it('records no backlog for a store that already had sessions, or past its limit', () => {
    const store = createStore();
    const small = recordChanges(store, 2);
    for (const [i, event] of [FIXTURES.SessionStart, FIXTURES.UserPromptSubmit].entries()) store.ingest({ id: i + 1, ts: 1, event });
    const kept = recordChanges(store);
    store.ingest({ id: 3, ts: 1, event: FIXTURES.PreToolUse });
    assert.equal(small.stop(), null, 'too many changes: the director catches up from the state instead');
    assert.equal(kept.stop(), null, 'sessions from before the record began would be missing from it');
    const fresh = createStore();
    const recorder = recordChanges(fresh);
    fresh.ingest({ id: 1, ts: 1, event: FIXTURES.SessionStart });
    const backlog = recorder.stop();
    fresh.ingest({ id: 2, ts: 1, event: FIXTURES.UserPromptSubmit });
    assert.deepEqual(
      backlog?.map((c) => c.type),
      ['event', 'achievement'],
      'stop() ends the record',
    );
  });

  it('reset clears the town', async () => {
    const { send, ready, store, calls } = setup();
    await ready();
    await send(FIXTURES.SubagentStart);
    store.reset();
    assert.deepEqual(
      calls('removeAgent').map((c) => [c[1], c[2].exit]),
      [
        [MAIN, 'poof'],
        [`${SESSION}:a1b2c3`, 'poof'],
      ],
    );
    assert.deepEqual(calls('setBoard').at(-1), ['setBoard', [], undefined]);
    assert.deepEqual(calls('setNodeModules').at(-1), ['setNodeModules', 0]);
    await send(FIXTURES.SessionStart);
    assert.equal(calls('addAgent').at(-1)[1].id, MAIN, 'the town fills again after a reset');
  });

  it('dispose stops all reactions and timers', async () => {
    const { send, ready, director, world, clock } = setup();
    await ready();
    await send(FIXTURES.Stop);
    director.dispose();
    const before = world.calls.length;
    await send(FIXTURES.PreToolUse);
    await clock.advance(300_000);
    assert.equal(world.calls.length, before);
    assert.equal(clock.pending, 0);
    director.dispose();
  });

  it('survives a world that lacks methods or throws', async () => {
    const clock = createFakeClock();
    const store = createStore({ now: clock.now });
    const errors = [];
    const original = console.error;
    console.error = (...args) => errors.push(args);
    try {
      const world = {
        addAgent() {
          throw new Error('no WebGL');
        },
        goTo: () => Promise.reject(new Error('lost')),
      };
      createDirector({ world, store, now: clock.now, setTimer: (fn, ms) => clock.setTimeout(fn, ms), clearTimer: (h) => clock.clearTimeout(h) });
      for (const payload of Object.values(FIXTURES)) {
        store.ingest({ id: 1, ts: clock.now(), rx: clock.now(), event: payload });
        await flush();
      }
      await clock.advance(200_000);
    } finally {
      console.error = original;
    }
    assert.ok(errors.length >= 1, 'world errors are reported, not thrown');
  });

  it('every hook in §4.2 drives the world without errors', async () => {
    const { send, ready, world, clock } = setup();
    await ready();
    for (const payload of Object.values(FIXTURES)) {
      await send(payload);
      await clock.advance(700);
    }
    await clock.advance(200_000);
    assert.ok(world.calls.length > 20);
  });

  it('AskUserQuestion and agents needing input show they are waiting', async () => {
    const { send, ready, calls } = setup();
    await ready();
    await send(pre('AskUserQuestion', { questions: [] }, 'q'));
    assert.deepEqual(calls('setStatus').at(-1), ['setStatus', MAIN, 'waiting']);
    assert.ok(calls('emote').some((c) => c[2] === '❓'));
    await send(hook('Notification', { message: 'Input needed', notification_type: 'agent_needs_input' }));
    assert.ok(calls('emote').some((c) => c[2] === '🙋'));
  });
});

describe('director: a team town\'s people (§4.11)', () => {
  it('repaints a person\'s crew in the town when they pick another colour', async () => {
    const { store, ready, calls } = setup();
    store.setPeople([{ name: 'Sam', color: 2, host: true }]);
    await ready();
    assert.equal(store.getState().sessions[0].color, CREW_COLORS[2], 'local crews are the host\'s');
    store.setPeople([{ name: 'Sam', color: 4, host: true }]);
    assert.deepEqual(calls('updateAgent').at(-1), ['updateAgent', MAIN, { color: CREW_COLORS[4], name: 'Foreman' }]);
    // One name for all their agents: the lead takes it.
    store.setPeople([{ name: 'Sam', color: 4, host: true, profile: { agents: 'Pixel' } }]);
    assert.deepEqual(calls('updateAgent').at(-1), ['updateAgent', MAIN, { color: CREW_COLORS[4], name: 'Pixel' }]);
  });
});

describe('director: notes to agents', () => {
  it('shows an envelope on the badge while notes wait, beside a combo, until they are delivered', async () => {
    const { store, send, ready, calls, clock } = setup();
    await ready();
    const note = (/** @type {string} */ id, /** @type {string} */ status) => ({ id, status, sessionId: SESSION, agentId: null, text: 'hi', createdAt: 1, expiresAt: 2 });
    store.setNote(note('n1', 'queued'));
    store.setNote(note('n2', 'queued'));
    assert.deepEqual(calls('setBadge').map((c) => c[2]), ['✉', '✉2']);
    for (const id of ['a', 'b']) {
      await send(read(id));
      await send(readDone(id));
      await clock.advance(1000);
    }
    assert.deepEqual(calls('setBadge').at(-1), ['setBadge', MAIN, '✉2 ×2']);
    store.setNote(note('n1', 'delivered'));
    store.setNote(note('n2', 'expired'));
    assert.deepEqual(calls('setBadge').at(-1), ['setBadge', MAIN, '×2']);
  });
});
