// Plan limits in words, and the projection rule (public/js/core/limits.js). Times are built in the
// local time zone, as the town and the phone show them.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { asOfWords, busiestGauge, limitGauges, limitName, readAccounts, resetWords, runOutAt } from '../../../public/js/core/limits.js';

/** 21 Nov 2026 (a Saturday) at hh:mm, local time. */
const at = (/** @type {number} */ hh, /** @type {number} */ mm = 0, /** @type {number} */ day = 21) => new Date(2026, 10, day, hh, mm).getTime();
const NOW = at(14, 0);

describe('limit words', () => {
  it('names the limits Claude Code reports, and any it adds later', () => {
    assert.equal(limitName('five_hour'), '5-hour limit');
    assert.equal(limitName('seven_day'), 'Weekly limit');
    assert.equal(limitName('spend_limit'), 'Spend limit');
    assert.equal(limitName('seven_day_opus'), 'Seven day opus limit');
  });

  it('says when a limit resets and when it was read, by the clock and the day', () => {
    assert.equal(resetWords(at(15, 40), NOW), 'resets at 15:40');
    assert.equal(resetWords(at(0, 10, 22), NOW), 'resets tomorrow at 00:10');
    assert.equal(resetWords(at(9, 0, 24), NOW), 'resets on Tue at 09:00');
    assert.equal(resetWords(at(9, 0, 30), NOW), 'resets on 30 Nov at 09:00');
    assert.equal(asOfWords(at(13, 58), NOW), 'as of 13:58');
    assert.equal(asOfWords(at(23, 50, 20), NOW), 'as of yesterday 23:50');
    assert.equal(asOfWords(at(8, 5, 18), NOW), 'as of Wed 08:05');
  });
});

describe('runOutAt: the average pace since the window opened', () => {
  // A 5-hour window that resets at 17:00 opened at 12:00.
  const fiveHour = (/** @type {number} */ percentUsed, /** @type {number} */ readAt = NOW) => ({ kind: 'five_hour', percentUsed, resetsAt: at(17, 0), at: readAt });

  it('projects when the pace would use it up before it resets', () => {
    // 60% in two hours: 30% an hour, so 100% at 15:20, before 17:00.
    assert.equal(runOutAt(fiveHour(60), NOW), at(15, 20));
    assert.equal(limitGauges([fiveHour(60)], NOW)[0].projection, 'At this pace it runs out around 15:20, before it resets.');
  });

  it('says nothing when the pace lasts until the reset', () => {
    // 40% in two hours of five: 100% would come at 17:00, the reset itself.
    assert.equal(runOutAt(fiveHour(40), NOW), null);
    assert.equal(runOutAt(fiveHour(10), NOW), null);
  });

  it('says nothing early in a window, when used up, or once the run-out time has passed', () => {
    // 12:20 is under a tenth of the window: an early pace says little.
    assert.equal(runOutAt(fiveHour(30, at(12, 20)), at(12, 20)), null);
    assert.equal(runOutAt(fiveHour(100), NOW), null);
    assert.equal(runOutAt(fiveHour(0), NOW), null);
    // Read at 14:00 at a pace ending 15:20, but it is 15:30 and no newer reading came: it slowed.
    assert.equal(runOutAt(fiveHour(60), at(15, 30)), null);
  });

  it('projects weekly limits too, but never a spend limit, whose period is not reported', () => {
    // A week that resets Tue 09:00 opened Tue 17 Nov 09:00; 4 days 5 hours later 80% is used.
    const weekly = { kind: 'seven_day', percentUsed: 80, resetsAt: at(9, 0, 24), at: NOW };
    const runOut = runOutAt(weekly, NOW);
    assert.ok(runOut && runOut > NOW && runOut < weekly.resetsAt);
    assert.match(limitGauges([weekly], NOW)[0].projection ?? '', /^At this pace it runs out (tomorrow|Mon) around \d\d:\d\d, before it resets\.$/);
    assert.equal(runOutAt({ kind: 'spend_limit', percentUsed: 95, resetsAt: at(9, 0, 30), at: NOW }, NOW), null);
  });
});

describe('gauges', () => {
  const limits = [
    { kind: 'seven_day', percentUsed: 12.4, resetsAt: at(9, 0, 24), at: at(13, 50) },
    { kind: 'five_hour', percentUsed: 91.6, resetsAt: at(15, 40), at: at(13, 58) },
    { kind: 'five_hour_old', percentUsed: 99, resetsAt: at(13, 0), at: at(9, 0) },
  ];

  it('lists the limits that still apply, 5-hour first, with their words and level', () => {
    const gauges = limitGauges(limits, NOW);
    assert.deepEqual(gauges.map((g) => [g.name, g.used, g.asOf, g.resets, g.level]), [
      ['5-hour limit', '92% used', 'as of 13:58', 'resets at 15:40', 'high'],
      ['Weekly limit', '12% used', 'as of 13:50', 'resets on Tue at 09:00', 'ok'],
    ]);
    assert.equal(limitGauges([{ kind: 'five_hour', percentUsed: 100, resetsAt: at(15, 40), at: NOW }], NOW)[0].used, 'used up');
    assert.equal(limitGauges([{ kind: 'five_hour', percentUsed: 80, resetsAt: at(15, 40), at: NOW }], NOW)[0].level, 'warn');
  });

  it('puts the most used limit of any account on the Usage button', () => {
    const accounts = [
      { account: 'default', label: null, claudeVersion: '2.1.330', at: NOW, limits: [limits[0]] },
      { account: 'dir-x', label: '.claude-work', claudeVersion: null, at: NOW, limits: [limits[1]] },
    ];
    assert.equal(busiestGauge(accounts, NOW)?.percent, 92);
    assert.equal(busiestGauge([], NOW), null);
    assert.equal(busiestGauge([{ ...accounts[0], limits: [limits[2]] }], NOW), null);
  });

  it('reads the server message defensively', () => {
    const read = readAccounts({ accounts: [{ account: 'default', at: NOW, label: 7, limits: [limits[1], { kind: 'Bad Kind', percentUsed: 1, resetsAt: 1, at: 1 }, { kind: 'five_hour', percentUsed: 'x' }] }, { at: NOW }, 'junk'] });
    assert.deepEqual(read, [{ account: 'default', label: null, claudeVersion: null, at: NOW, limits: [limits[1]] }]);
    assert.deepEqual(readAccounts(null), []);
    assert.deepEqual(readAccounts({ accounts: 'x' }), []);
  });
});
