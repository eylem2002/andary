import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { isFollowUp, nextGoal } from '../../../public/js/core/goals.js';

describe('goals: follow-up prompts', () => {
  it('knows the prompts that only say to go on', () => {
    for (const prompt of ['continue', 'Continue.', 'go on', 'Go ahead!', 'yes', 'y', 'ok', 'OK, continue please', 'keep going', 'carry on',
      'proceed', 'resume', 'yes please', 'sounds good', 'lgtm', 'do it', 'try again', 'thanks!', '1', '2', '...', 'next']) {
      assert.equal(isFollowUp(prompt), true, prompt);
    }
  });

  it('keeps any prompt with a task of its own', () => {
    for (const prompt of ['', 'continue with the login form', 'yes, but rename the file first', 'fix the failing test', 'go to the docs folder',
      'deploy', '42 things', 'ok ok ok ok ok ok ok', 'no', 'stop']) {
      assert.equal(isFollowUp(prompt), false, prompt);
    }
    assert.equal(isFollowUp('continue '.repeat(10)), false, 'long prompts are always instructions');
  });

  it('nextGoal keeps the goal before a follow-up', () => {
    assert.equal(nextGoal('Add dark mode', 'continue'), 'Add dark mode');
    assert.equal(nextGoal(undefined, 'continue'), undefined);
    assert.equal(nextGoal('Add dark mode', 'Write the release notes'), 'Write the release notes');
    assert.equal(nextGoal('Add dark mode', ''), 'Add dark mode');
  });
});
