import { test } from 'node:test';
import assert from 'node:assert/strict';
import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { claudeConfigDir, createUsageTracker, dayOf, isInside, readUsageLine, subagentTranscript } from '../../../server/usage.mjs';
import { messageCost } from '../../../public/js/core/prices.js';

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
  assert.equal(messageCost('some-other-model', { input_tokens: 5 }), null);
});

test('readUsageLine reads assistant messages only', () => {
  const seen = readUsageLine(line('m1', { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 100 }).trim());
  assert.equal(seen?.id, 'm1');
  assert.deepEqual(seen?.tokens, { input: 10, output: 5, cacheRead: 100, cacheWrite: 0 });
  assert.equal(seen?.ts, Date.parse('2026-11-20T10:00:00.000Z'));
  assert.equal(readUsageLine(JSON.stringify({ type: 'user', message: { usage: {} } })), null);
  assert.equal(readUsageLine('{"usage": broken'), null);
  assert.equal(readUsageLine(line('x', { input_tokens: 1 }, '<synthetic>').trim()), null);
});

test('helpers: days, subagent paths, the config folder', () => {
  assert.match(dayOf(Date.now()), /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(subagentTranscript('/c/projects/p/s1.jsonl', 'agent-abc'), join('/c/projects/p/s1', 'subagents', 'agent-abc.jsonl'));
  assert.equal(claudeConfigDir({ CLAUDE_CONFIG_DIR: '/x' }), '/x');
});

/** A Claude config folder with one project. */
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'usage-test-'));
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
  symlinkSync(outside, sneaky);
  const projects = join(claudeDir, 'projects');
  assert.equal(isInside(inside, projects), true);
  assert.equal(isInside(outside, projects), false);
  assert.equal(isInside(sneaky, projects), false);
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
  const tracker = createUsageTracker({ claudeDir, stateFile, debounceMs: 5, onChange: (record, days) => changes.push({ record: structuredClone(record), days }) });
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
  const again = createUsageTracker({ claudeDir, stateFile, debounceMs: 5, onChange: () => assert.fail('nothing new to count') });
  again.observe(event);
  await wait(40);
  assert.equal(again.snapshot().days.at(-1).tokens, 1157);
  again.dispose();
});
