import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { approvalRisk, approvalSections, differentFolders, groupRisk, requestKey } from '../../../public/js/ui/approval-groups.js';

/** @param {Record<string, unknown>} fields @returns {any} */
const approval = (fields) => ({ id: 'a', status: 'pending', held: true, sessionId: 's1', agentId: null, toolName: 'Bash', toolInput: { command: 'git push --force-with-lease' }, cwd: '/w/app', createdAt: 1, expiresAt: 100, ...fields });

const state = /** @type {any} */ ({
  sessions: [
    { id: 's1', cwd: '/w/app', project: 'app', number: 1 },
    { id: 's2', cwd: '/w/api', project: 'api', number: 2 },
  ],
  agents: {},
});

describe('approval cards', () => {
  it('groups requests that ask exactly the same thing, whatever the order of their keys', () => {
    const a = approval({ id: 'a', createdAt: 1, expiresAt: 300 });
    const b = approval({ id: 'b', sessionId: 's2', createdAt: 2, expiresAt: 200 });
    const c = approval({ id: 'c', toolInput: { command: 'npm test' }, createdAt: 3 });
    const d = approval({ id: 'd', toolName: 'Write', toolInput: { content: 'x', file_path: 'a' }, createdAt: 4 });
    const e = approval({ id: 'e', toolName: 'Write', toolInput: { file_path: 'a', content: 'x' }, createdAt: 5 });
    const { live, earlier } = approvalSections([a, b, c, d, e]);
    assert.deepEqual(live.map((entry) => entry.members.map((one) => one.id)), [['a', 'b'], ['c'], ['d', 'e']]);
    assert.equal(live[0].lead.id, 'b', 'the card shows the one that runs out first');
    assert.deepEqual(earlier, []);
    assert.equal(requestKey(d), requestKey(e));
  });

  it('keeps a card per request waiting in the terminal, and folds settled ones into Earlier', () => {
    const waiting = approval({ id: 'w1', held: false, expiresAt: null });
    const waiting2 = approval({ id: 'w2', held: false, expiresAt: null });
    const done = approval({ id: 'd1', status: 'expired' });
    const answered = approval({ id: 'd2', status: 'allowed' });
    const { live, earlier } = approvalSections([waiting, waiting2, done, answered]);
    assert.deepEqual(live.map((entry) => entry.key), ['one:w1', 'one:w2']);
    assert.deepEqual(earlier.map((one) => one.id), ['d1', 'd2']);
  });

  it('keeps a card\'s key while requests join it', () => {
    const one = approvalSections([approval({ id: 'a' })]).live[0].key;
    const two = approvalSections([approval({ id: 'a' }), approval({ id: 'b', sessionId: 's2' })]).live[0].key;
    assert.equal(one, two);
  });

  it('marks a risky request, for each folder it runs in', () => {
    assert.deepEqual(approvalRisk(approval({}), state)?.reasons, ['rewrites remote history (force push)']);
    assert.equal(approvalRisk(approval({ toolInput: { command: 'npm test' } }), state), null);
    const here = approval({ id: 'a', toolInput: { command: 'rm ../shared/x' } });
    const there = approval({ id: 'b', sessionId: 's2', cwd: '/w/api/src', toolInput: { command: 'rm ../shared/x' } });
    assert.deepEqual(groupRisk([here, there], state), { reasons: ['deletes outside the project: /w/shared/x'], quiet: false });
    assert.deepEqual(groupRisk([approval({ toolInput: { command: 'rm -rf dist' } })], state), { reasons: ['deletes a rebuildable folder (dist)'], quiet: true });
    assert.equal(differentFolders([here, there]), true);
    assert.equal(differentFolders([here, approval({ id: 'c' })]), false);
  });
});
