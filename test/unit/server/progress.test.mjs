import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createProgress } from '../../../server/progress.mjs';
import { MILESTONES, earnsPoint, nextMilestone, unlockedAt } from '../../../public/js/core/growth.js';
import { createDemoProgress, DEMO_PROGRESS_KEY } from '../../../public/js/sources/demo-progress.js';

test('milestones are in order, and points unlock them', () => {
  const points = MILESTONES.map((m) => m.points);
  assert.deepEqual(points, [...points].sort((a, b) => a - b));
  assert.equal(new Set(MILESTONES.map((m) => m.id)).size, MILESTONES.length);
  assert.deepEqual(unlockedAt(0), []);
  assert.deepEqual(unlockedAt(25), ['bunting', 'icecream']);
  assert.deepEqual(nextMilestone(25), { milestone: MILESTONES[2], left: 25 });
  assert.equal(nextMilestone(10_000), null);
  assert.equal(earnsPoint({ hook_event_name: 'Stop' }), true);
  assert.equal(earnsPoint({ hook_event_name: 'SubagentStop' }), true);
  assert.equal(earnsPoint({ hook_event_name: 'TaskCompleted' }), true);
  assert.equal(earnsPoint({ hook_event_name: 'PreToolUse' }), false);
  assert.equal(earnsPoint({ hook_event_name: 'Stop', stop_reason: 'interrupted' }), false, 'an interrupted Codex turn is not finished work');
  assert.equal(earnsPoint(null), false);
});

test('progress counts points and busy days, and survives a restart', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'progress-'));
  after(() => rmSync(dir, { recursive: true, force: true }));
  const file = join(dir, 'progress.json');
  let now = new Date('2026-11-19T10:00:00').getTime();
  /** @type {any[]} */
  const changes = [];
  const progress = createProgress({ stateFile: file, onChange: (p) => changes.push(p), now: () => now });
  progress.observe({ hook_event_name: 'PreToolUse' });
  progress.observe({ hook_event_name: 'PreToolUse' });
  assert.equal(changes.length, 1, 'only the first event of the day changes the days');
  progress.observe({ hook_event_name: 'Stop' });
  now = new Date('2026-11-20T10:00:00').getTime();
  progress.observe({ hook_event_name: 'TaskCompleted' });
  assert.deepEqual(progress.snapshot(), { points: 2, days: ['2026-11-19', '2026-11-20'] });
  progress.dispose();
  assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')), { v: 1, points: 2, days: ['2026-11-19', '2026-11-20'] });
  const again = createProgress({ stateFile: file, onChange: () => {}, now: () => now });
  assert.equal(again.snapshot().points, 2);
  writeFileSync(file, '{"points": -4, "days": ["nope", "2026-01-01"]}');
  assert.deepEqual(createProgress({ stateFile: file, onChange: () => {} }).snapshot(), { points: 0, days: ['2026-01-01'] });
  writeFileSync(file, 'garbage');
  assert.equal(createProgress({ stateFile: file, onChange: () => {} }).snapshot().points, 0);
});

test('the demo starts near the Ferris wheel, counts points and keeps them in the browser', () => {
  const kept = new Map();
  const storage = { getItem: (k) => kept.get(k) ?? null, setItem: (k, v) => kept.set(k, v) };
  /** @type {any[]} */
  const seen = [];
  const observe = createDemoProgress((p) => seen.push(p), () => new Date('2026-11-20T12:00:00').getTime(), storage);
  assert.equal(seen[0].points, 92);
  assert.equal(seen[0].days.length, 9);
  assert.equal(seen[0].days.at(-1), '2026-11-20');
  observe({ hook_event_name: 'PostToolUse' });
  observe({ hook_event_name: 'Stop' });
  assert.equal(seen.at(-1).points, 93);
  assert.equal(kept.get(DEMO_PROGRESS_KEY), '93');
  const back = [];
  createDemoProgress((p) => back.push(p), Date.now, storage);
  assert.equal(back[0].points, 93);
});
