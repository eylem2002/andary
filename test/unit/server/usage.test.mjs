import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { contextTokens, createUsageTracker, inSubfolder, isInside, readAppended, readCompactBoundary, readUsageLine, resolveInside, subagentTranscript } from '../../../server/usage.mjs';
import { resolveClaudeConfigDir } from '../../../server/config.mjs';
import { localDate as dayOf } from '../../../public/js/core/dates.js';
import { messageCost } from '../../../public/js/core/prices.js';
import { CANNOT_SYMLINK } from './helpers.mjs';

/** One assistant line as Claude Code writes it. */
const line = (/** @type {string} */ id, /** @type {Record<string, number>} */ usage, model = 'claude-opus-5-5', ts = '2026-11-20T10:00:00.000Z') =>
  `${JSON.stringify({ type: 'assistant', timestamp: ts, requestId: `req_${id}`, message: { id, model, role: 'assistant', usage } })}\n`;

test('messageCost uses the list price of each model, with cache reads and writes', () => {
  assert.equal(messageCost('claude-opus-5-5', { input_tokens: 1e6 }), 4);
  assert.equal(messageCost('claude-opus-5-5', { output_tokens: 1e6 }), 20);
  assert.equal(messageCost('claude-sonnet-5-5', { cache_read_input_tokens: 1e6 }), 0.1);
  assert.equal(messageCost('claude-opus-5-5', { cache_creation_input_tokens: 1e6 }), 5, '5-minute writes cost 1.25× input');
  assert.equal(messageCost('claude-opus-5-5', { cache_creation_input_tokens: 1e6, cache_creation: { ephemeral_1h_input_tokens: 1e6, ephemeral_5m_input_tokens: 0 } }), 8, '1-hour writes cost 2× input');
  assert.equal(messageCost('claude-haiku-5-5', { input_tokens: 1000, output_tokens: 1000 }), 0.0006);
  assert.equal(messageCost('claude-haiku-5-5', { input_tokens: 200_000 }), 0.1, 'long prompts on Haiku 5.5 cost more');
  assert.equal(messageCost('claude-fable-5-2', { output_tokens: 1e6 }), 40);
  assert.equal(messageCost('claude-sonnet-4-6', { input_tokens: 1e6 }), 3);
  assert.equal(messageCost('claude-opus-5', { input_tokens: 1e6 }), 5);
  assert.equal(messageCost('claude-opus-4-5-20251101', { output_tokens: 1e6 }), 25);
  assert.equal(messageCost('claude-opus-4-1-20250805', { output_tokens: 1e6 }), 75, 'Opus 4 and 4.1 kept their older price');
  assert.equal(messageCost('claude-opus-4-20250514', { cache_read_input_tokens: 1e6 }), 1.5);
  assert.equal(messageCost('claude-opus-5-5', { cache_creation_input_tokens: 1e6, cache_creation: {} }), 5, 'an empty breakdown falls back to the total');
  assert.equal(messageCost('some-other-model', { input_tokens: 5 }), null);
});

test('readUsageLine reads assistant messages only', () => {
  const seen = readUsageLine(line('m1', { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 100 }).trim());
  assert.equal(seen?.id, 'm1:req_m1');
  assert.deepEqual(seen?.tokens, { input: 10, output: 5, cacheRead: 100, cacheWrite: 0 });
  assert.equal(seen?.ts, Date.parse('2026-11-20T10:00:00.000Z'));
  assert.equal(readUsageLine(JSON.stringify({ type: 'user', message: { usage: {} } })), null);
  assert.equal(readUsageLine('{"usage": broken'), null);
  assert.equal(readUsageLine(line('x', { input_tokens: 1 }, '<synthetic>').trim()), null);
});

test('helpers: days, subagent paths, the config folder', () => {
  assert.match(dayOf(Date.now()), /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(subagentTranscript('/c/projects/p/s1.jsonl', 'agent-abc'), join('/c/projects/p/s1', 'subagents', 'agent-abc.jsonl'));
  assert.equal(resolveClaudeConfigDir({ CLAUDE_CONFIG_DIR: '/x' }), resolve('/x'));
});

/** A Claude config folder with one project. */
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'usage-test-'));
  after(() => rmSync(root, { recursive: true, force: true }));
  const claudeDir = join(root, 'claude');
  const project = join(claudeDir, 'projects', '-home-dev-app');
  mkdirSync(project, { recursive: true });
  return { root, claudeDir, project };
}

const wait = (/** @type {number} */ ms) => new Promise((r) => setTimeout(r, ms));

test('isInside accepts only .jsonl files under the projects folder, symlinks resolved', () => {
  const { root, claudeDir, project } = fixture();
  const inside = join(project, 's.jsonl');
  writeFileSync(inside, '');
  const outside = join(root, 'secret.jsonl');
  writeFileSync(outside, '');
  const sneaky = join(project, 'link.jsonl');
  const projects = join(claudeDir, 'projects');
  assert.equal(isInside(inside, projects), true);
  assert.equal(isInside(outside, projects), false);
  if (!CANNOT_SYMLINK) {
    symlinkSync(outside, sneaky);
    assert.equal(isInside(sneaky, projects), false);
  }
  assert.equal(isInside(join(project, '..', '..', '..', 'secret.jsonl'), projects), false);
  assert.equal(isInside('relative/s.jsonl', projects), false);
  assert.equal(isInside(join(project, 'notes.txt'), projects), false);
});

test('the tracker counts each message once, per agent and per day, reading only what was appended', async () => {
  const { root, claudeDir, project } = fixture();
  const transcript = join(project, 's1.jsonl');
  // One message split over two lines (same id), a user line, a half-written last line.
  writeFileSync(transcript, `${line('m1', { input_tokens: 1000, output_tokens: 100 }) + line('m1', { input_tokens: 1000, output_tokens: 100 })  }{"type":"user"}\n{"type":"assistant","mes`);
  /** @type {any[]} */
  const changes = [];
  const stateFile = join(root, 'usage.json');
  const tracker = createUsageTracker({ claudeDir, stateFile, throttleMs: 5, onChange: (record, days) => changes.push({ record: structuredClone(record), days }) });
  const event = { session_id: 's1', transcript_path: transcript, hook_event_name: 'PostToolUse' };
  tracker.observe(event);
  tracker.observe(event);
  await wait(40);
  assert.equal(changes.length, 1, 'two hooks in a row read once');
  assert.deepEqual(changes[0].record.tokens, { input: 1000, output: 100, cacheRead: 0, cacheWrite: 0 });
  assert.ok(Math.abs(changes[0].record.costUsd - 0.006) < 1e-12);
  appendFileSync(transcript, `sage":{}}\n${line('m2', { output_tokens: 50 }, 'mystery-model')}`);
  tracker.observe(event);
  await wait(40);
  const last = changes.at(-1).record;
  assert.equal(last.tokens.output, 150);
  assert.equal(last.unpriced, true);
  assert.equal(last.model, 'mystery-model');
  assert.equal(changes.at(-1).days.at(-1).date, dayOf(Date.parse('2026-11-20T10:00:00.000Z')));
  assert.equal(changes.at(-1).days.at(-1).tokens, 1150);
  // A subagent's own transcript, found next to the session's.
  const sub = subagentTranscript(transcript, 'abc');
  mkdirSync(join(project, 's1', 'subagents'), { recursive: true });
  writeFileSync(sub, line('m3', { input_tokens: 7 }, 'claude-haiku-5-5'));
  tracker.observe({ ...event, agent_id: 'agent-abc' });
  await wait(40);
  assert.equal(changes.at(-1).record.agentId, 'abc');
  assert.equal(tracker.snapshot().agents.length, 2);
  // Outside the projects folder: ignored.
  writeFileSync(join(root, 'elsewhere.jsonl'), line('m9', { input_tokens: 5 }));
  tracker.observe({ session_id: 's9', transcript_path: join(root, 'elsewhere.jsonl') });
  await wait(40);
  assert.equal(tracker.snapshot().agents.length, 2);
  tracker.dispose();
  const saved = JSON.parse(readFileSync(stateFile, 'utf8'));
  assert.equal(saved.days.at(-1).tokens, 1157);
  // After a restart the saved offsets stop it from counting the same lines again.
  const again = createUsageTracker({ claudeDir, stateFile, throttleMs: 5, onChange: () => assert.fail('nothing new to count') });
  again.observe(event);
  await wait(40);
  assert.equal(again.snapshot().days.at(-1).tokens, 1157);
  again.dispose();
  rmSync(root, { recursive: true, force: true });
});

test('a message copied into another transcript (a forked session) or read by another name counts once', { skip: CANNOT_SYMLINK }, async () => {
  const { root, claudeDir, project } = fixture();
  const first = join(project, 's1.jsonl');
  const forked = join(project, 's2.jsonl');
  writeFileSync(first, line('m1', { input_tokens: 1000, output_tokens: 10 }));
  // The forked session starts with a copy of the old message, then a later line of it reports
  // more output, then a new message.
  writeFileSync(forked, line('m1', { input_tokens: 1000, output_tokens: 10 }) + line('m1', { input_tokens: 1000, output_tokens: 40 }) + line('m2', { output_tokens: 5 }));
  const alias = join(project, 'alias.jsonl');
  symlinkSync(first, alias);
  const stateFile = join(root, 'usage.json');
  const tracker = createUsageTracker({ claudeDir, stateFile, throttleMs: 5, onChange: () => {} });
  tracker.observe({ session_id: 's1', transcript_path: first });
  await wait(30);
  tracker.observe({ session_id: 'sA', transcript_path: alias });
  await wait(30);
  tracker.observe({ session_id: 's2', transcript_path: forked });
  await wait(30);
  const day = tracker.snapshot().days.at(-1);
  assert.equal(day?.tokens, 1000 + 40 + 5, 'm1 once with its final output, m2 once');
  tracker.dispose();
  // The ids survive a restart, so a forked copy read later is not counted again either.
  const later = join(project, 's3.jsonl');
  writeFileSync(later, line('m2', { output_tokens: 5 }));
  const again = createUsageTracker({ claudeDir, stateFile, throttleMs: 5, onChange: () => assert.fail('nothing new to count') });
  again.observe({ session_id: 's3', transcript_path: later });
  await wait(30);
  again.dispose();
  rmSync(root, { recursive: true, force: true });
});

// --- Context in use (CONTRACTS §4.8 UsageRecord.context) ------------------------------------

const NOW = Date.parse('2026-11-20T12:00:00.000Z');
const at = (/** @type {number} */ minutes) => new Date(NOW - 60 * 60_000 + minutes * 60_000).toISOString();

/**
 * An assistant line with every field Claude Code writes to a transcript: a turn deep into a
 * session, cache-heavy, so almost all of its context is read from the cache. `iterations` lists
 * the reply's sampling iterations (an advisor's, a fallback's), `unmetered` marks it unmetered.
 * @param {{ id?: string, model?: string, input?: number, write?: number, read?: number, output?: number, ts?: string, sidechain?: boolean, agentId?: string, iterations?: Record<string, unknown>[], unmetered?: boolean }} [fields]
 */
function realLine({ id = 'msg_01XFDUDYJgAACzvnptvVoYEL', model = 'claude-opus-5-5', input = 4, write = 1520, read = 180_816, output = 312, ts = at(0), sidechain = false, agentId, iterations, unmetered } = {}) {
  return `${JSON.stringify({
    parentUuid: '6f1c0d2e-5b7a-4c1e-9a43-0c2b8d7e1f90',
    isSidechain: sidechain,
    userType: 'external',
    cwd: '/home/dev/app',
    sessionId: 's1',
    version: '2.1.12',
    gitBranch: 'main',
    ...(agentId ? { agentId } : {}),
    ...(unmetered ? { isUnmetered: true } : {}),
    message: {
      id,
      type: 'message',
      role: 'assistant',
      model,
      content: [{ type: 'tool_use', id: 'toolu_01', name: 'Bash', input: { command: 'npm test' } }],
      stop_reason: 'tool_use',
      stop_sequence: null,
      usage: {
        input_tokens: input,
        cache_creation_input_tokens: write,
        cache_read_input_tokens: read,
        cache_creation: { ephemeral_5m_input_tokens: write, ephemeral_1h_input_tokens: 0 },
        output_tokens: output,
        service_tier: 'standard',
        ...(iterations ? { iterations } : {}),
      },
    },
    requestId: `req_${id}`,
    type: 'assistant',
    uuid: `u-${id}`,
    timestamp: ts,
  })}\n`;
}

/** One sampling iteration of a reply, as `usage.iterations` lists it. */
const iteration = (/** @type {string} */ type, /** @type {number} */ input, /** @type {number} */ write, /** @type {number} */ read, /** @type {number} */ output, /** @type {string} */ model = '') =>
  ({ type, ...(model ? { model } : {}), input_tokens: input, cache_creation_input_tokens: write, cache_read_input_tokens: read, output_tokens: output });

/** The lines Claude Code writes where it compacted: the boundary, then the summary as a user turn. */
function compactionLines(/** @type {string} */ ts) {
  const common = { isSidechain: false, userType: 'external', cwd: '/home/dev/app', sessionId: 's1', version: '2.1.12', gitBranch: 'main', timestamp: ts };
  return `${JSON.stringify({ ...common, parentUuid: null, logicalParentUuid: 'u-last', type: 'system', subtype: 'compact_boundary', content: 'Conversation compacted', isMeta: false, uuid: 'u-boundary', level: 'info', compactMetadata: { trigger: 'auto', preTokens: 182_340 } })}\n${
    JSON.stringify({ ...common, parentUuid: 'u-boundary', type: 'user', isCompactSummary: true, isVisibleInTranscriptOnly: true, uuid: 'u-summary', message: { role: 'user', content: 'This session is being continued from a previous conversation that ran out of context.' } })}\n`;
}

/** A tracker over a fresh config folder, with every change it reports. */
function contextFixture() {
  const { claudeDir, project } = fixture();
  /** @type {any[]} */
  const changes = [];
  const tracker = createUsageTracker({ claudeDir, stateFile: null, throttleMs: 5, now: () => NOW, onChange: (record) => changes.push(structuredClone(record)) });
  after(() => tracker.dispose());
  const transcript = join(project, 's1.jsonl');
  const hook = (/** @type {string} */ name, /** @type {Record<string, unknown>} */ extra = {}) => ({ session_id: 's1', transcript_path: transcript, hook_event_name: name, ...extra });
  const recordOf = (/** @type {string} */ agentId = '') => tracker.snapshot().agents.find((r) => r.sessionId === 's1' && (r.agentId ?? '') === agentId);
  const contextOf = (/** @type {string} */ agentId = '') => recordOf(agentId)?.context;
  return { project, transcript, tracker, changes, hook, recordOf, contextOf };
}

test('the context in use is a message\'s input, cache writes and cache reads, as Claude Code\'s status line counts it', async () => {
  const seen = readUsageLine(realLine().trim());
  assert.ok(seen);
  // 4 + 1,520 + 180,816: the 312 output tokens are not in the context yet.
  assert.equal(seen.context, 182_340);
  assert.equal(contextTokens(seen.tokens), seen.context, 'a reply without iterations: its top level');
  const { transcript, tracker, changes, hook } = contextFixture();
  writeFileSync(transcript, realLine());
  tracker.observe(hook('PostToolUse'));
  await wait(40);
  assert.deepEqual(changes.at(-1).context, { tokens: 182_340, at: Date.parse(at(0)) });
});

test('a reply that consulted an advisor: the context is its last executor iteration, the cost every iteration at its own model', () => {
  // The top level adds up both executor iterations, each of which re-sent the whole conversation.
  const executor1 = iteration('message', 4, 1200, 149_702, 89);
  const advisor = iteration('advisor_message', 823, 0, 0, 1612, 'claude-opus-5-5');
  const executor2 = iteration('message', 6, 1694, 150_906, 442);
  const seen = readUsageLine(realLine({ model: 'claude-sonnet-5-5', input: 10, write: 2894, read: 300_608, output: 531, iterations: [executor1, advisor, executor2] }).trim());
  assert.ok(seen);
  assert.equal(seen.context, 152_606, 'not the 303,512 the top level adds up to');
  assert.deepEqual(seen.tokens, { input: 833, output: 2143, cacheRead: 300_608, cacheWrite: 2894 }, 'the advisor\'s tokens are not in the top level');
  const expected = /** @type {number} */ (messageCost('claude-sonnet-5-5', executor1)) + /** @type {number} */ (messageCost('claude-opus-5-5', advisor)) + /** @type {number} */ (messageCost('claude-sonnet-5-5', executor2));
  assert.ok(Math.abs(/** @type {number} */ (seen.cost) - expected) < 1e-12, 'the advisor at its own model\'s price');
  assert.ok(/** @type {number} */ (seen.cost) > /** @type {number} */ (messageCost('claude-sonnet-5-5', { input_tokens: 10, cache_creation_input_tokens: 2894, cache_read_input_tokens: 300_608, output_tokens: 531 })));
  const unknownAdvisor = readUsageLine(realLine({ iterations: [executor1, { ...advisor, model: 'mystery-advisor' }, executor2] }).trim());
  assert.equal(unknownAdvisor?.cost, null, 'an advisor model without a known price leaves the reply unpriced');
  // A line written while the executor waits for the advice: the advisor's iteration is not its context.
  assert.equal(readUsageLine(realLine({ iterations: [executor1, advisor] }).trim())?.context, 150_906);
});

test('compaction and fallback iterations: a compaction is no context, a fallback model\'s iteration is; an empty list means the top level', () => {
  // As the compaction docs show it: the top level leaves the compaction's iteration out.
  const compaction = iteration('compaction', 180_000, 0, 0, 3500);
  const message = iteration('message', 23_000, 0, 0, 1000);
  const compacted = readUsageLine(realLine({ input: 23_000, write: 0, read: 0, output: 1000, iterations: [compaction, message] }).trim());
  assert.equal(compacted?.context, 23_000);
  assert.equal(compacted?.tokens.input, 203_000, 'the compaction is billed too, at the message\'s model');
  assert.ok(Math.abs(/** @type {number} */ (compacted?.cost) - /** @type {number} */ (messageCost('claude-opus-5-5', compaction)) - /** @type {number} */ (messageCost('claude-opus-5-5', message))) < 1e-12);
  const fallback = readUsageLine(realLine({ iterations: [iteration('message', 5, 0, 40_000, 10), iteration('fallback_message', 5, 0, 41_000, 300, 'claude-sonnet-5-5')] }).trim());
  assert.equal(fallback?.context, 41_005);
  assert.equal(readUsageLine(realLine({ iterations: [] }).trim())?.context, 182_340);
});

test('a line Claude Code marks unmetered counts nothing and is no reading', async () => {
  assert.equal(readUsageLine(realLine({ unmetered: true }).trim()), null);
  const { transcript, tracker, hook, contextOf } = contextFixture();
  writeFileSync(transcript, realLine({ id: 'm1' }) + realLine({ id: 'm2', read: 5000, ts: at(1), unmetered: true }));
  tracker.observe(hook('Stop'));
  await wait(40);
  assert.equal(contextOf()?.tokens, 182_340);
  assert.equal(tracker.snapshot().days.at(-1)?.tokens, 4 + 1520 + 180_816 + 312);
});

test('each agent keeps its newest reading; a helper\'s transcript counts for the helper, not its lead', async () => {
  const { project, transcript, tracker, changes, hook, contextOf } = contextFixture();
  writeFileSync(transcript, realLine({ id: 'm1', read: 100_000 }) + realLine({ id: 'm2', read: 120_000, ts: at(1) }));
  tracker.observe(hook('PostToolUse'));
  await wait(40);
  assert.equal(contextOf()?.tokens, 4 + 1520 + 120_000, 'the last message read is the newest');
  // A later line of the same message reports the same context: nothing new to tell.
  const before = changes.length;
  appendFileSync(transcript, realLine({ id: 'm2', read: 120_000, ts: at(1) }));
  tracker.observe(hook('PostToolUse'));
  await wait(40);
  assert.equal(changes.length, before);
  appendFileSync(transcript, realLine({ id: 'm3', read: 130_000, ts: at(2) }));
  tracker.observe(hook('Stop'));
  await wait(40);
  assert.equal(contextOf()?.tokens, 131_524);
  // The helper's own transcript: its context, and the lead's stays.
  mkdirSync(join(project, 's1', 'subagents'), { recursive: true });
  writeFileSync(subagentTranscript(transcript, 'abc'), realLine({ id: 'h1', read: 20_000, ts: at(3), sidechain: true, agentId: 'abc' }));
  tracker.observe(hook('SubagentStop', { agent_id: 'abc', agent_type: 'Explore' }));
  await wait(40);
  assert.equal(contextOf('abc')?.tokens, 21_524);
  assert.equal(contextOf()?.tokens, 131_524);
  // Older Claude Code wrote helpers' messages into the session's transcript: still not the lead's.
  appendFileSync(transcript, realLine({ id: 'h2', read: 9000, ts: at(4), sidechain: true }));
  tracker.observe(hook('PostToolUse'));
  await wait(40);
  assert.equal(contextOf()?.tokens, 131_524);
  assert.equal(changes.at(-1).tokens.cacheRead, 100_000 + 120_000 + 130_000 + 9000, 'its usage still counts');
});

test('a forked session\'s copy of a message counts nothing again but tells the new session\'s context', async () => {
  const { project, transcript, tracker } = contextFixture();
  writeFileSync(transcript, realLine({ id: 'm1', read: 50_000 }));
  tracker.observe({ session_id: 's1', transcript_path: transcript, hook_event_name: 'Stop' });
  await wait(40);
  // `claude --resume … --fork-session` starts a new session whose transcript copies the old one.
  const forked = join(project, 's2.jsonl');
  writeFileSync(forked, realLine({ id: 'm1', read: 50_000 }));
  tracker.observe({ session_id: 's2', transcript_path: forked, hook_event_name: 'SessionStart', source: 'fork' });
  await wait(40);
  const session = (/** @type {string} */ id) => tracker.snapshot().agents.find((r) => r.sessionId === id);
  assert.equal(session('s2')?.tokens.cacheRead, 0, 'counted once, for the first session');
  assert.equal(session('s2')?.context?.tokens, 51_524);
  assert.equal(session('s1')?.context?.tokens, 51_524);
});

test('a compaction makes the context unknown until the next message, even with an older message still to read', async () => {
  const { transcript, tracker, changes, hook, recordOf, contextOf } = contextFixture();
  writeFileSync(transcript, realLine({ id: 'm1' }));
  tracker.observe(hook('PostToolUse'));
  await wait(40);
  assert.equal(contextOf()?.tokens, 182_340);
  // PreCompact proves nothing yet: another hook can still stop the compaction.
  tracker.observe(hook('PreCompact', { trigger: 'auto', custom_instructions: '' }), Date.parse(at(1)));
  await wait(40);
  assert.equal(contextOf()?.tokens, 182_340);
  // The turn's last message is written, and the compaction ends before anything read it.
  appendFileSync(transcript, realLine({ id: 'm2', read: 190_000, ts: at(2) }));
  tracker.observe(hook('PostCompact', { trigger: 'auto', compact_summary: 'Fixed the login test.' }), Date.parse(at(3)));
  assert.equal(changes.at(-1).context, null, 'dropped at once, before the next read');
  assert.equal(changes.at(-1).compactedAt, Date.parse(at(3)));
  await wait(40);
  assert.equal(contextOf(), null, 'the read the hook scheduled brings back nothing from before it');
  assert.equal(changes.at(-1).tokens.cacheRead, 180_816 + 190_000, 'its usage still counts');
  appendFileSync(transcript, realLine({ id: 'm3', input: 9, write: 23_000, read: 8000, ts: at(4) }));
  tracker.observe(hook('PostToolUse'));
  await wait(40);
  assert.deepEqual(contextOf(), { tokens: 31_009, at: Date.parse(at(4)) });
  // The session restarting from the summary is a compaction too.
  tracker.observe(hook('SessionStart', { source: 'compact' }), Date.parse(at(5)));
  assert.equal(contextOf(), null);
  assert.equal(recordOf()?.compactedAt, Date.parse(at(5)));
});

test('a compaction hook dated in the future is taken as now, so later messages still give a reading', async () => {
  const { transcript, tracker, hook, recordOf, contextOf } = contextFixture();
  writeFileSync(transcript, realLine({ id: 'm1', ts: new Date(NOW + 60_000).toISOString() }));
  // The first hook the tracker sees for this agent: its record starts knowing of the compaction.
  tracker.observe(hook('PostCompact', { trigger: 'manual', compact_summary: '' }), NOW + 3_600_000);
  await wait(40);
  assert.equal(contextOf()?.tokens, 182_340);
  assert.equal(recordOf()?.compactedAt, NOW);
});

test('a compaction boundary in the transcript drops the reading when no hook said so', async () => {
  const { transcript, tracker, hook, recordOf, contextOf } = contextFixture();
  assert.deepEqual(readCompactBoundary(compactionLines(at(1)).split('\n')[0]), { at: Date.parse(at(1)) });
  assert.equal(readCompactBoundary(compactionLines(at(0)).split('\n')[1]), null, 'the summary is a user turn');
  assert.equal(readCompactBoundary(JSON.stringify({ type: 'assistant', message: { content: '"subtype":"compact_boundary"' } })), null);
  writeFileSync(transcript, realLine({ id: 'm1' }) + compactionLines(at(1)));
  tracker.observe(hook('Stop'));
  await wait(40);
  assert.equal(contextOf(), null);
  assert.equal(recordOf()?.compactedAt, Date.parse(at(1)));
  appendFileSync(transcript, realLine({ id: 'm2', read: 12_000, ts: at(2) }) + compactionLines(at(3)) + realLine({ id: 'm3', read: 15_000, ts: at(4) }));
  tracker.observe(hook('Stop'));
  await wait(40);
  assert.equal(contextOf()?.tokens, 16_524, 'what follows the last boundary');
  assert.equal(recordOf()?.compactedAt, Date.parse(at(3)));
});

test('a helper\'s transcript one folder down in subagents/ is found too', async () => {
  const { project, transcript, tracker, hook, contextOf } = contextFixture();
  const folder = join(project, 's1', 'subagents', 'workflow-1');
  mkdirSync(folder, { recursive: true });
  writeFileSync(join(folder, 'agent-def.jsonl'), realLine({ id: 'h1', read: 30_000, sidechain: true, agentId: 'def' }));
  const projects = join(project, '..');
  assert.equal(inSubfolder(join(project, 's1', 'subagents', 'agent-none.jsonl'), projects), null);
  tracker.observe(hook('PostToolUse', { agent_id: 'def', agent_type: 'general-purpose' }));
  await wait(40);
  assert.equal(contextOf('def')?.tokens, 31_524);
  assert.equal(subagentTranscript(transcript, 'def'), join(project, 's1', 'subagents', 'agent-def.jsonl'), 'where it is looked for first');
});

test('a message that read nothing is no reading', async () => {
  const { transcript, tracker, hook, contextOf } = contextFixture();
  writeFileSync(transcript, realLine({ id: 'm1' }) + realLine({ id: 'm2', input: 0, write: 0, read: 0, output: 5, ts: at(1) }));
  tracker.observe(hook('Stop'));
  await wait(40);
  assert.equal(contextOf()?.tokens, 182_340);
});

test('reading skips a line longer than 16 MB, never blocks on a FIFO, and keeps a half-written line for later', () => {
  const { root, claudeDir, project } = fixture();
  const projects = join(claudeDir, 'projects');
  const big = join(project, 'big.jsonl');
  writeFileSync(big, `${'x'.repeat(17 * 1024 * 1024)}\n${line('m1', { output_tokens: 1 })}`);
  const state = { offset: 0 };
  const real = /** @type {string} */ (resolveInside(big, projects));
  assert.equal(readAppended(real, state), null);
  assert.equal(state.offset, 16 * 1024 * 1024, 'the giant line is skipped, not read again forever');
  // Next time: the giant line's tail (not JSON, so ignored), then the message after it.
  assert.match(readAppended(real, state) ?? '', /\n.*"m1"/);
  const partial = join(project, 'partial.jsonl');
  writeFileSync(partial, '{"half":');
  const half = { offset: 0 };
  assert.equal(readAppended(/** @type {string} */ (resolveInside(partial, projects)), half), null);
  assert.equal(half.offset, 0);
  if (process.platform !== 'win32') {
    const fifo = join(project, 'pipe.jsonl');
    execFileSync('mkfifo', [fifo]);
    assert.equal(isInside(fifo, projects), false);
    assert.equal(readAppended(fifo, { offset: 0 }), null);
  }
  rmSync(root, { recursive: true, force: true });
});
