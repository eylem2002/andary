import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WATCH_DEFAULTS, createWatch, dollars, isEditCall, longTurnText, minutesWords, readWatchSettings, watchNoteText } from '../../../public/js/core/watch.js';

const MIN = 60_000;
const T0 = 10_000_000;

/** A watch with the defaults, and a helper for an agent's totals. @param {object} [settings] */
function watching(settings) {
  const watch = createWatch({ settings });
  /** @param {string} agentKey @param {number} costUsd @param {number} at @param {number} [tokens] */
  const usage = (agentKey, costUsd, at, tokens = costUsd * 100_000) => watch.record({ type: 'usage', sessionId: agentKey.split(':')[0], agentKey, costUsd, tokens, at });
  return { watch, usage };
}

test('settings are read field by field: a bad value is its default, 0 turns an alert off', () => {
  assert.deepEqual(readWatchSettings(null), WATCH_DEFAULTS);
  assert.deepEqual(readWatchSettings('nonsense'), WATCH_DEFAULTS);
  const read = readWatchSettings({ burnUsd: 0, burnMinutes: -3, turnUsd: 12.345, helpers: '9', longMinutes: 1e9, phone: true, extra: 1 });
  assert.equal(read.burnUsd, 0);
  assert.equal(read.burnMinutes, WATCH_DEFAULTS.burnMinutes);
  assert.equal(read.turnUsd, 12.35);
  assert.equal(read.helpers, WATCH_DEFAULTS.helpers);
  assert.equal(read.longMinutes, WATCH_DEFAULTS.longMinutes);
  assert.equal(read.phone, true);
  assert.equal('extra' in read, false);
  assert.equal(readWatchSettings({ burnMinutes: 0 }).burnMinutes, WATCH_DEFAULTS.burnMinutes, 'the window cannot be zero');
});

test('isEditCall: file tools and patches, and shell commands that write', () => {
  for (const tool of ['Edit', 'MultiEdit', 'Write', 'NotebookEdit', 'apply_patch']) assert.equal(isEditCall(tool, {}), true, tool);
  assert.equal(isEditCall('Read', { file_path: 'a' }), false);
  assert.equal(isEditCall('Bash', { command: 'npm test' }), false);
  assert.equal(isEditCall('Bash', { command: "sed -i 's/a/b/' src/a.js" }), true);
  assert.equal(isEditCall('Bash', { command: 'echo hi > notes.txt' }), true);
  assert.equal(isEditCall('Bash', {}), false);
  assert.equal(isEditCall('Bash', null), false);
});

test('spending fast with no files changed: one burn alert, in dollars and tokens', () => {
  const { watch, usage } = watching();
  assert.deepEqual(usage('s1:main', 40, T0), [], 'what it had spent before the watch heard of it is not counted');
  assert.deepEqual(usage('s1:main', 41, T0 + 2 * MIN), []);
  const started = usage('s1:main', 43.2, T0 + 6 * MIN);
  assert.equal(started.length, 1);
  assert.equal(started[0].kind, 'burn');
  assert.equal(started[0].text, '$3.20 (estimate, 320k tokens) in the last 10 min, no files changed');
  assert.equal(started[0].id, `burn:s1:${T0 + 6 * MIN}`);
  assert.deepEqual(watch.alerts().map((a) => a.kind), ['burn']);
  // Still spending: the same alert, no second one while it cools down.
  assert.deepEqual(usage('s1:main', 47, T0 + 8 * MIN), []);
  assert.equal(watch.alerts().length, 1);
});

test('a helper spending counts for its crew; spends older than the window do not', () => {
  const { usage } = watching();
  usage('s1:main', 1, T0);
  usage('s1:agent-a', 0, T0);
  usage('s1:main', 2.5, T0 + MIN);
  // 11 minutes later the first $1.50 has left the window.
  assert.deepEqual(usage('s1:agent-a', 2, T0 + 12 * MIN), []);
  const started = usage('s1:agent-a', 3.1, T0 + 13 * MIN);
  assert.equal(started[0]?.kind, 'burn');
  assert.match(started[0].text, /^\$3\.10 /);
});

test('an edit in the window means progress: no burn alert', () => {
  const { watch, usage } = watching();
  usage('s1:main', 0, T0);
  watch.record({ type: 'edit', sessionId: 's1', at: T0 + 4 * MIN });
  assert.deepEqual(usage('s1:main', 5, T0 + 5 * MIN), []);
  // Ten minutes after the edit, spending with nothing changed again.
  assert.equal(usage('s1:main', 9, T0 + 15 * MIN)[0]?.kind, 'burn');
});

test('the cooldown: a crew gets one alert of a kind per cooldown, then another', () => {
  const { watch, usage } = watching({ cooldownMinutes: 30 });
  usage('s1:main', 0, T0);
  assert.equal(usage('s1:main', 4, T0 + MIN).length, 1);
  assert.equal(usage('s1:main', 8, T0 + 20 * MIN).length, 0);
  const again = usage('s1:main', 12, T0 + 32 * MIN);
  assert.equal(again.length, 1);
  assert.equal(watch.alerts().length, 1, 'the newer alert replaces the older one of its kind');
  assert.equal(watch.alerts()[0].id, again[0].id);
});

test('a prompt starts a turn: the turn cost alert counts from there, once per turn', () => {
  const { watch, usage } = watching({ burnUsd: 0, turnUsd: 5 });
  usage('s1:main', 100, T0);
  watch.record({ type: 'prompt', sessionId: 's1', at: T0 + MIN });
  assert.deepEqual(usage('s1:main', 104, T0 + 10 * MIN), []);
  const started = usage('s1:main', 105.5, T0 + 20 * MIN);
  assert.equal(started[0]?.kind, 'turn-cost');
  assert.equal(started[0].text, 'This turn has cost $5.50 (estimate, 550k tokens)');
  // Cost that comes in after the Stop is still that turn's; no second alert for it.
  watch.record({ type: 'stop', sessionId: 's1', at: T0 + 21 * MIN });
  assert.deepEqual(usage('s1:main', 120, T0 + 22 * MIN), []);
  assert.equal(watch.turns().s1.usd, 20);
});

test('a turn the watch joined midway says "at least"; with no turn known, no turn cost', () => {
  const { watch, usage } = watching({ burnUsd: 0, turnUsd: 1 });
  usage('s1:main', 0, T0);
  assert.deepEqual(usage('s1:main', 2, T0 + MIN), [], 'no turn is known without a prompt or work seen');
  // A helper starting is work of a turn whose prompt the watch missed.
  watch.record({ type: 'helper', sessionId: 's1', at: T0 + 2 * MIN });
  const started = usage('s1:main', 3.5, T0 + 3 * MIN);
  assert.equal(started[0]?.text, 'This turn has cost at least $1.50 (estimate, 150k tokens)');
});

test('fan-out: the helpers alert at the threshold, once per turn; a prompt clears the alerts', () => {
  const { watch } = watching({ helpers: 3 });
  const helper = (/** @type {number} */ at) => watch.record({ type: 'helper', sessionId: 's1', at });
  watch.record({ type: 'prompt', sessionId: 's1', at: T0 });
  assert.deepEqual(helper(T0 + 1), []);
  assert.deepEqual(helper(T0 + 2), []);
  const started = helper(T0 + 3);
  assert.equal(started[0]?.text, 'Started 3 helpers this turn');
  assert.deepEqual(helper(T0 + 4), []);
  assert.equal(watch.alerts().length, 1);
  watch.record({ type: 'prompt', sessionId: 's1', at: T0 + MIN });
  assert.deepEqual(watch.alerts(), []);
});

test('a threshold of 0 turns its alert off; the session end forgets the crew', () => {
  const { watch, usage } = watching({ burnUsd: 0, turnUsd: 0, helpers: 0 });
  watch.record({ type: 'prompt', sessionId: 's1', at: T0 });
  usage('s1:main', 0, T0);
  assert.deepEqual(usage('s1:main', 500, T0 + MIN), []);
  for (let i = 0; i < 50; i += 1) assert.deepEqual(watch.record({ type: 'helper', sessionId: 's1', at: T0 + i }), []);
  watch.setSettings({ helpers: 2 });
  watch.record({ type: 'end', sessionId: 's1', at: T0 + 2 * MIN });
  assert.deepEqual(watch.turns(), {});
  // A crew with the same id later starts from nothing: its first total is not spending.
  assert.deepEqual(usage('s1:main', 900, T0 + 3 * MIN), []);
});

test('Codex reports no cost: only the helpers alert can start', () => {
  const { watch } = watching({ helpers: 2 });
  watch.record({ type: 'prompt', sessionId: 'thr_1', at: T0 });
  watch.record({ type: 'helper', sessionId: 'thr_1', at: T0 + 1 });
  assert.equal(watch.record({ type: 'helper', sessionId: 'thr_1', at: T0 + 2 })[0]?.kind, 'fan-out');
});

test('long turns: a note once a turn has run long with no edit for a while', () => {
  const settings = readWatchSettings({ longMinutes: 30, quietMinutes: 20 });
  const turn = { start: T0, sawStart: true, lastEditAt: null, open: true, helpers: 0, usd: 0, tokens: 0 };
  assert.equal(longTurnText(turn, settings, T0 + 29 * MIN), null);
  assert.equal(longTurnText(turn, settings, T0 + 42 * MIN), 'Working 42 min, no edits yet');
  assert.equal(longTurnText({ ...turn, lastEditAt: T0 + 17 * MIN }, settings, T0 + 42 * MIN), 'Working 42 min, no edits for 25 min');
  assert.equal(longTurnText({ ...turn, lastEditAt: T0 + 30 * MIN }, settings, T0 + 42 * MIN), null, 'an edit 12 minutes ago');
  assert.equal(longTurnText({ ...turn, sawStart: false }, settings, T0 + 75 * MIN), 'Working at least 1 h 15 min, no edits yet');
  assert.equal(longTurnText({ ...turn, open: false }, settings, T0 + 99 * MIN), null);
  assert.equal(longTurnText(turn, readWatchSettings({ longMinutes: 0 }), T0 + 99 * MIN), null);
  assert.equal(longTurnText(undefined, settings, T0), null);
});

test('the watch keeps each turn: its start, its last edit, whether it is open', () => {
  const { watch } = watching();
  watch.record({ type: 'prompt', sessionId: 's1', at: T0 });
  watch.record({ type: 'edit', sessionId: 's1', at: T0 + MIN });
  assert.deepEqual(watch.turns().s1, { start: T0, sawStart: true, lastEditAt: T0 + MIN, open: true, helpers: 0, usd: 0, tokens: 0 });
  watch.record({ type: 'stop', sessionId: 's1', at: T0 + 2 * MIN });
  assert.equal(watch.turns().s1.open, false);
  // A late edit after the Stop opens no turn.
  watch.record({ type: 'edit', sessionId: 's1', at: T0 + 3 * MIN });
  assert.equal(watch.turns().s1.open, false);
});

test('words: dollars, minutes, and phone notes that name nothing of the project', () => {
  assert.equal(dollars(0.004), 'under $0.01');
  assert.equal(dollars(3.1), '$3.10');
  assert.equal(minutesWords(42 * MIN + 59_000), '42 min');
  assert.equal(minutesWords(125 * MIN), '2 h 05 min');
  const base = { id: 'x', sessionId: 's', since: 0, text: '' };
  assert.equal(watchNoteText({ ...base, kind: 'burn', usd: 3.1, helpers: 0 }), 'A crew spent $3.10 (estimate) in a few minutes with no files changed.');
  assert.equal(watchNoteText({ ...base, kind: 'turn-cost', usd: 12, helpers: 0 }), "A crew's turn has cost $12.00 so far (estimate).");
  assert.equal(watchNoteText({ ...base, kind: 'fan-out', usd: 0, helpers: 12 }), 'A crew started 12 helpers in one turn.');
});
