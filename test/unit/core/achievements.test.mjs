import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ACHIEVEMENTS, achievementFor, createAchievementTracker, modelFamily } from '../../../public/js/core/achievements.js';

/** @param {string} kind @param {Record<string, any>} [data] @param {number} [ts] */
function event(kind, data = {}, ts = 0) {
  return /** @type {any} */ ({ id: '1', ts, rx: ts, kind, sessionId: 's', agentKey: 's:main', agentId: null, agentType: null, cwd: '', data });
}

const VIEW = { activeHelpers: () => 0, activeAgents: () => 1, session: () => undefined };

describe('achievement tracker', () => {
  it('unlocks each achievement only once', () => {
    const tracker = createAchievementTracker({ localHour: () => 12 });
    assert.deepEqual(tracker.observe(event('session.start'), VIEW), ['first-contact']);
    assert.deepEqual(tracker.observe(event('session.start'), VIEW), []);
    assert.ok(tracker.isUnlocked('first-contact'));
    tracker.reset();
    assert.ok(!tracker.isUnlocked('first-contact'));
  });

  it('counts approvals for Rubber Stamp outside the event stream', () => {
    const tracker = createAchievementTracker();
    for (let i = 0; i < 4; i++) assert.deepEqual(tracker.approvalAllowed(), []);
    assert.deepEqual(tracker.approvalAllowed(), ['rubber-stamp']);
    assert.deepEqual(tracker.approvalAllowed(), []);
  });

  it('a passing run clears the red flag, so red-to-green needs a new failure', () => {
    const tracker = createAchievementTracker({ localHour: () => 12 });
    tracker.observe(event('session.start'), VIEW);
    assert.deepEqual(tracker.observe(event('tool.end', { commandKind: 'test' }), VIEW), []);
    tracker.observe(event('tool.fail', { commandKind: 'test' }), VIEW);
    assert.deepEqual(tracker.observe(event('tool.end', { commandKind: 'test' }), VIEW), ['red-to-green']);
  });

  it('reduces model ids to families for Polyglot', () => {
    assert.equal(modelFamily('claude-opus-5-5'), 'opus');
    assert.equal(modelFamily('Sonnet'), 'sonnet');
    assert.equal(modelFamily('gpt-9'), 'gpt-9');
    assert.equal(modelFamily(undefined), '');
    const tracker = createAchievementTracker({ localHour: () => 12 });
    tracker.observe(event('session.start', { model: 'claude-opus-5-5' }), VIEW);
    assert.deepEqual(tracker.observe(event('model.switch', { from: 'opus', to: 'claude-opus-4-1' }), VIEW), []);
    assert.deepEqual(tracker.observe(event('spawn.request', { model: 'haiku' }), VIEW), []);
    assert.deepEqual(tracker.observe(event('model.switch', { from: 'haiku', to: 'claude-sonnet-5' }), VIEW), ['polyglot']);
  });

  it('builds unlocked achievements from definitions', () => {
    const shipIt = achievementFor('ship-it', 99);
    assert.deepEqual(shipIt, { ...ACHIEVEMENTS.find((a) => a.id === 'ship-it'), unlockedAt: 99 });
    assert.equal(achievementFor('nope', 1), null);
    assert.ok(Object.isFrozen(ACHIEVEMENTS[0]));
  });
});
