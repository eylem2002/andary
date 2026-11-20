// Pure helpers behind the HUD panels (no DOM needed).
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { entriesSince, iconForEntry, matchesFilter } from '../../../public/js/ui/activity.js';
import { summarizeActivity } from '../../../public/js/ui/announcer.js';
import { ANSWER_DELAY_MS, answerReady, pendingCount, resultText } from '../../../public/js/ui/approvals.js';
import { visibleAgents } from '../../../public/js/ui/crews.js';
import { busiestAgent, sameSelection } from '../../../public/js/ui/hud-actions.js';
import { effectFor, FRESH_MS } from '../../../public/js/ui/hud-effects.js';
import { noticeKind } from '../../../public/js/ui/hud.js';
import { topTools } from '../../../public/js/ui/inspector.js';
import { pageTitle, subtitleFor } from '../../../public/js/ui/masthead.js';

/**
 * Test data only needs the fields a helper reads.
 * @param {unknown} value
 * @returns {any}
 */
const fixture = (value) => value;

/** @param {Record<string, unknown>} fields @returns {any} */
function agent(fields) {
  return { key: 's:main', sessionId: 's', agentId: null, name: 'Foreman', role: 'lead', type: 'main', color: '#2457D6', status: 'working', building: 'hall', activity: 'idle', startedAt: 0, lastActivity: 0, toolCounts: {}, files: [], recent: [], errors: 0, ...fields };
}

describe('activity log', () => {
  const log = fixture([
    { id: 1, sessionId: 'a', level: 'info' },
    { id: 2, sessionId: 'b', level: 'error' },
    { id: 3, sessionId: 'a', level: 'success' },
  ]);

  test('entriesSince finds new entries by reference or id', () => {
    assert.deepEqual(entriesSince(log, null), log);
    assert.deepEqual(entriesSince(log, log[0]), [log[1], log[2]]);
    assert.deepEqual(entriesSince(log, fixture({ id: 2 })), [log[2]]);
    assert.deepEqual(entriesSince(log, log[2]), []);
  });

  test('entriesSince asks for a rebuild when the last seen entry is gone', () => {
    assert.equal(entriesSince(log, fixture({ id: 99 })), null);
    assert.equal(entriesSince([], fixture({ id: 1 })), null);
  });

  test('filters by crew and errors', () => {
    assert.equal(matchesFilter(log[0], { sessionId: '', errorsOnly: false }), true);
    assert.equal(matchesFilter(log[0], { sessionId: 'b', errorsOnly: false }), false);
    assert.equal(matchesFilter(log[1], { sessionId: 'b', errorsOnly: true }), true);
    assert.equal(matchesFilter(log[2], { sessionId: '', errorsOnly: true }), false);
  });

  test('icons come from the building or event, errors always warn', () => {
    assert.equal(iconForEntry({ kind: 'tool.start', icon: '📚', level: 'info' }), 'book');
    assert.equal(iconForEntry({ kind: 'tool.start', icon: '🏭', level: 'info' }), 'terminal');
    assert.equal(iconForEntry({ kind: 'tool.start', icon: 'library', level: 'info' }), 'book');
    assert.equal(iconForEntry({ kind: 'prompt', icon: '💬', level: 'info' }), 'message');
    assert.equal(iconForEntry({ kind: 'tool.fail', icon: '❌', level: 'error' }), 'warning');
    assert.equal(iconForEntry({ kind: 'achievement', icon: '🤷', level: 'success' }), 'medal');
    assert.equal(iconForEntry({ kind: 'mystery', icon: '', level: 'info' }), 'spark');
  });

  test('screen-reader summaries are short', () => {
    assert.equal(summarizeActivity([]), '');
    assert.equal(summarizeActivity([{ agentName: 'Scout', text: 'Read a.ts', level: 'info' }]), 'Scout: Read a.ts');
    assert.equal(
      summarizeActivity([
        { agentName: 'Scout', text: 'Read a.ts', level: 'info' },
        { agentName: 'Builder', text: 'npm test failed', level: 'error' },
        { agentName: 'Foreman', text: '$ git status', level: 'info' },
      ]),
      '3 new events, 1 failed. Latest: Foreman: $ git status',
    );
  });
});

describe('approvals', () => {
  test('result wording', () => {
    assert.equal(resultText(fixture({ status: 'allowed', decidedBy: 'town' }), 'live'), 'Allowed from the town');
    assert.equal(resultText(fixture({ status: 'denied', decidedBy: 'terminal' }), 'live'), 'Denied in the terminal');
    assert.equal(resultText(fixture({ status: 'expired' }), 'demo'), 'No answer in time, so the demo carried on');
    assert.equal(resultText(fixture({ status: 'expired' }), 'live'), 'No answer in time, so the terminal asked instead');
    assert.equal(resultText(fixture({ status: 'denied', decidedBy: 'town', message: 'use the staging db' }), 'live'), 'Denied from the town: “use the staging db”');
    assert.equal(resultText(fixture({ status: 'resolved' }), 'live'), 'Answered in the terminal');
    assert.equal(resultText(fixture({ status: 'pending' }), 'live'), '');
  });

  test('result wording for "Allow always" names the rule it saved and where', () => {
    const always = { rules: [{ toolName: 'Bash', ruleContent: 'npm test:*' }], destination: 'localSettings', at: 1 };
    assert.equal(resultText(fixture({ status: 'allowed', decidedBy: 'town', always }), 'live'), 'Allowed always from the town: Bash(npm test:*) for this project, only you');
    assert.equal(resultText(fixture({ status: 'allowed', decidedBy: 'town', always: { ...always, destination: 'session' } }), 'demo'), 'Allowed always from the town: Bash(npm test:*) until this session ends');
  });

  test('pending count', () => {
    assert.equal(pendingCount(fixture({ approvals: [{ status: 'pending' }, { status: 'allowed' }, { status: 'pending' }] })), 2);
  });
});

describe('crews', () => {
  test('finished agents beyond the latest three fold away', () => {
    const agents = {
      'a:main': agent({ key: 'a:main', status: 'working' }),
      'a:1': agent({ key: 'a:1', status: 'done', lastActivity: 1 }),
      'a:2': agent({ key: 'a:2', status: 'done', lastActivity: 2 }),
      'a:3': agent({ key: 'a:3', status: 'done', lastActivity: 3 }),
      'a:4': agent({ key: 'a:4', status: 'done', lastActivity: 4 }),
      'a:5': agent({ key: 'a:5', status: 'waiting' }),
    };
    const session = fixture({ agentKeys: ['a:main', 'a:1', 'a:2', 'a:3', 'a:4', 'a:5', 'a:gone'] });
    const state = fixture({ agents });
    assert.deepEqual(visibleAgents(session, state, false).map((a) => a.key), ['a:main', 'a:2', 'a:3', 'a:4', 'a:5']);
    assert.equal(visibleAgents(session, state, true).length, 6);
  });
});

describe('selection helpers', () => {
  test('sameSelection', () => {
    assert.equal(sameSelection(null, null), true);
    assert.equal(sameSelection({ type: 'agent', id: 'x' }, { type: 'agent', id: 'x' }), true);
    assert.equal(sameSelection({ type: 'agent', id: 'x' }, { type: 'agent', id: 'y' }), false);
    assert.equal(sameSelection({ type: 'building', key: 'library' }, { type: 'building', key: 'library' }), true);
    assert.equal(sameSelection({ type: 'building', key: 'library' }, { type: 'agent', id: 'library' }), false);
    assert.equal(sameSelection(null, { type: 'agent', id: 'x' }), false);
  });

  test('busiestAgent prefers the latest working agent', () => {
    const state = fixture({
      agents: {
        a: agent({ key: 'a', status: 'idle', lastActivity: 50 }),
        b: agent({ key: 'b', status: 'working', lastActivity: 10 }),
        c: agent({ key: 'c', status: 'working', lastActivity: 20 }),
        d: agent({ key: 'd', status: 'done', lastActivity: 99 }),
      },
    });
    assert.equal(busiestAgent(state), 'c');
    assert.equal(busiestAgent(fixture({ agents: { a: state.agents.a, d: state.agents.d } })), 'a');
    assert.equal(busiestAgent(fixture({ agents: {} })), null);
  });
});

describe('effects', () => {
  const now = 10_000_000;
  test('fresh events toast or sound, history does not', () => {
    const seen = new Set();
    assert.deepEqual(effectFor(fixture({ type: 'event', event: { kind: 'session.start', ts: now - 1000, sessionId: 's' } }), seen, now), { type: 'session', sessionId: 's' });
    assert.equal(effectFor(fixture({ type: 'event', event: { kind: 'session.start', ts: now - FRESH_MS - 1, sessionId: 's' } }), seen, now), null);
    assert.deepEqual(effectFor(fixture({ type: 'event', event: { kind: 'tool.fail', ts: now, sessionId: 's' } }), seen, now), { type: 'sound', name: 'buzz' });
    assert.equal(effectFor(fixture({ type: 'event', event: { kind: 'tool.start', ts: now, sessionId: 's' } }), seen, now), null);
    assert.equal(effectFor({ type: 'reset' }, seen, now), null);
  });

  test('a question or a plan is no permission to grant: no approval toast (needs-you tells of it)', () => {
    const seen = new Set();
    for (const toolName of ['AskUserQuestion', 'ExitPlanMode']) {
      assert.equal(effectFor({ type: 'approval', approval: fixture({ id: toolName, status: 'pending', toolName, createdAt: now }) }, seen, now), null);
    }
  });

  test('each pending approval is announced once', () => {
    const seen = new Set();
    const approval = fixture({ id: 'x', status: 'pending', createdAt: now - 1000 });
    assert.equal(effectFor({ type: 'approval', approval }, seen, now)?.type, 'approval');
    assert.equal(effectFor({ type: 'approval', approval }, seen, now), null);
    assert.equal(effectFor({ type: 'approval', approval: { ...approval, id: 'y', status: 'allowed' } }, seen, now), null);
  });

  test('achievements only when just unlocked', () => {
    const fresh = { id: 'a', title: 'T', description: 'D', icon: 'spark', unlockedAt: now - 10 };
    assert.equal(effectFor({ type: 'achievement', achievement: fresh }, new Set(), now)?.type, 'achievement');
    assert.equal(effectFor({ type: 'achievement', achievement: { ...fresh, unlockedAt: 0 } }, new Set(), now), null);
  });
});

describe('inspector and masthead', () => {
  test('topTools sorts and scales against the most used tool', () => {
    assert.deepEqual(topTools({ Read: 4, Bash: 2, Edit: 0, Grep: 2 }), [
      { tool: 'Read', count: 4, ratio: 1 },
      { tool: 'Bash', count: 2, ratio: 0.5 },
      { tool: 'Grep', count: 2, ratio: 0.5 },
    ]);
    assert.deepEqual(topTools({}), []);
    assert.equal(topTools({ a: 1, b: 1, c: 1 }, 2).length, 2);
  });

  test('subtitle counts active crews and agents', () => {
    const view = fixture({ mode: 'live', connection: 'live' });
    const state = fixture({
      sessions: [{ id: 's', status: 'working' }, { id: 'old', status: 'ended' }],
      agents: { a: agent({ sessionId: 's' }), b: agent({ sessionId: 's', status: 'done' }), c: agent({ sessionId: 'old' }) },
      stats: { toolCalls: 12 },
    });
    assert.equal(subtitleFor(state, view), '1 crew, 1 agent and 12 tool calls');
    assert.equal(subtitleFor(fixture({ sessions: [], agents: {}, stats: { toolCalls: 0 } }), fixture(view)), 'Waiting for Claude Code');
    assert.equal(subtitleFor(fixture({ sessions: [], agents: {}, stats: { toolCalls: 0 } }), fixture({ mode: 'live', connection: 'signin' })), 'Sign in to see your crews');
    assert.equal(subtitleFor(fixture({ sessions: [], agents: {}, stats: { toolCalls: 0 } }), fixture({ mode: 'demo', connection: 'demo' })), 'The demo crews are on their way');
  });

  test('the page title says how many things need you', () => {
    assert.equal(pageTitle(0), 'Andary');
    assert.equal(pageTitle(2), '(2) Andary');
  });

  test('notices: sign in, waiting for Claude Code, or nothing', () => {
    const empty = fixture({ sessions: [] });
    assert.equal(noticeKind(fixture({ mode: 'live', connection: 'signin' }), empty), 'signin');
    assert.equal(noticeKind(fixture({ mode: 'live', connection: 'live' }), empty), 'waiting');
    assert.equal(noticeKind(fixture({ mode: 'live', connection: 'live' }), fixture({ sessions: [{}] })), null);
    assert.equal(noticeKind(fixture({ mode: 'live', connection: 'connecting' }), empty), null);
    assert.equal(noticeKind(fixture({ mode: 'demo', connection: 'demo' }), empty), null);
  });
});

describe('approval answer delay', () => {
  test('a pointer answer needs the card to have stayed in place for ANSWER_DELAY_MS', () => {
    assert.equal(answerReady(1000, 1000), false);
    assert.equal(answerReady(1000, 1000 + ANSWER_DELAY_MS - 1), false);
    assert.equal(answerReady(1000, 1000 + ANSWER_DELAY_MS), true);
    assert.ok(ANSWER_DELAY_MS >= 500, 'long enough for a human to notice the change');
  });
});
