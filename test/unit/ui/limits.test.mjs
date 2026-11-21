// What the Usage button and the Usage dialog say about plan limits (public/js/ui/limits.js).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { gaugeLine, usageButtonWords } from '../../../public/js/ui/limits.js';
import { demoLimits } from '../../../public/js/sources/demo-limits.js';
import { limitGauges } from '../../../public/js/core/limits.js';

const at = (/** @type {number} */ hh, /** @type {number} */ mm = 0) => new Date(2026, 10, 21, hh, mm).getTime();
const NOW = at(14, 0);

test('the Usage button names the most used limit, with its reset time, or just itself', () => {
  const accounts = [{ account: 'default', label: null, claudeVersion: null, at: NOW, limits: [
    { kind: 'five_hour', percentUsed: 42, resetsAt: at(15, 40), at: NOW },
    { kind: 'seven_day', percentUsed: 12, resetsAt: at(9, 0) + 3 * 86_400_000, at: NOW },
  ] }];
  const words = usageButtonWords(accounts, NOW);
  assert.equal(words.name, 'Usage and cost. 5-hour limit 42% used, resets at 15:40');
  assert.equal(words.tip, 'Usage · 5-hour limit 42%');
  assert.equal(words.gauge?.level, 'ok');
  assert.deepEqual(usageButtonWords([], NOW), { gauge: null, name: 'Usage and cost', tip: 'Usage and cost' });
  // A window that reset says nothing about the next: no gauge from it.
  assert.equal(usageButtonWords(accounts, at(16, 0)).gauge?.kind, 'seven_day');
});

test('the demo makes up a 5-hour limit whose pace runs out before it resets', () => {
  const now = at(12, 0);
  const [fiveHour, weekly] = limitGauges(demoLimits(now).accounts[0].limits, now);
  assert.equal(gaugeLine(fiveHour), '5-hour limit 64% used, resets at 14:30');
  // The window opened at 09:30 (five hours before 14:30): 64% in 2 h 28 min runs out at 13:21.
  assert.match(fiveHour.projection ?? '', /^At this pace it runs out around 13:21, before it resets\.$/);
  assert.equal(weekly.projection, null);
});
