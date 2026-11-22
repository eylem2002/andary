import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { MAX_NOTES_PER_HOOK, MAX_QUEUED_PER_AGENT, NOTE_TTL_MS, createNoteDesk } from '../../../server/notes.mjs';

const CAPS = ['truncated', 'updatedPermissions', 'interrupt', 'notes'];

/** A desk with a fake clock; `changes` records every note it publishes. */
function setup() {
  let now = 1_000;
  /** @type {any[]} */
  const changes = [];
  const desk = createNoteDesk({ now: () => now, onChange: (note) => changes.push(note) });
  return { desk, changes, advance: (/** @type {number} */ ms) => (now += ms) };
}

/**
 * A forwarder body.
 * @param {string} hook
 * @param {Record<string, unknown>} [extra]
 * @param {{ caps?: string[], source?: 'claude'|'codex' }} [options]
 */
function body(hook, extra = {}, { caps = CAPS, source = 'claude' } = {}) {
  return { source, caps, event: { session_id: 's1', hook_event_name: hook, ...extra } };
}

/**
 * What a hook's reply carries, its reply sent.
 * @param {ReturnType<typeof createNoteDesk>} desk @param {any} hook
 */
function texts(desk, hook) {
  const taken = desk.take(hook);
  taken.sent(true);
  return taken.texts;
}

describe('the note desk', () => {
  it('queues a note for an agent it heard from, and hands it to that agent\'s next hook that can carry it', () => {
    const { desk, changes } = setup();
    desk.heard(body('SessionStart'));
    const sent = desk.send({ sessionId: 's1', text: 'Use the staging database' });
    assert.equal(sent.ok, true);
    assert.deepEqual(texts(desk, body('Stop')), [], 'a Stop cannot carry one');
    assert.deepEqual(texts(desk, body('PostToolUse', { agent_id: 'helper-1' })), [], 'a helper\'s hook is not the lead\'s');
    assert.deepEqual(texts(desk, body('PostToolUse')), ['Use the staging database']);
    assert.deepEqual(texts(desk, body('PostToolUse')), [], 'once');
    assert.deepEqual(changes.map((note) => [note.status, note.hook]), [['queued', undefined], ['delivered', 'PostToolUse']]);
  });

  it('gives a helper\'s note to that helper only, and expires it when the helper finishes', () => {
    const { desk, changes } = setup();
    desk.heard(body('SessionStart'));
    assert.match(/** @type {any} */ (desk.send({ sessionId: 's1', agentId: 'agent-h1', text: 'x' })).error, /not heard from this helper/);
    desk.heard(body('PreToolUse', { agent_id: 'agent-h1' }));
    assert.equal(desk.send({ sessionId: 's1', agentId: 'agent-h1', text: 'for the helper' }).ok, true);
    assert.equal(desk.send({ sessionId: 's1', agentId: 'h1', text: 'the same helper, its id normalised' }).ok, true);
    assert.deepEqual(texts(desk, body('PreToolUse')), []);
    assert.deepEqual(texts(desk, body('PreToolUse', { agent_id: 'h1' })), ['for the helper', 'the same helper, its id normalised']);
    desk.send({ sessionId: 's1', agentId: 'h1', text: 'too late' });
    desk.heard(body('SubagentStop', { agent_id: 'h1' }));
    assert.deepEqual(changes.at(-1), { ...changes.at(-1), status: 'expired', reason: 'the helper finished' });
    assert.match(/** @type {any} */ (desk.send({ sessionId: 's1', agentId: 'h1', text: 'x' })).error, /has finished/);
  });

  it('refuses a session it never heard from, one whose forwarder cannot hand notes over, and one that ended', () => {
    const { desk } = setup();
    assert.match(/** @type {any} */ (desk.send({ sessionId: 'Lina~s1', text: 'x' })).error, /only to agents on this computer/);
    desk.heard(body('SessionStart', {}, { caps: ['truncated'] }));
    assert.match(/** @type {any} */ (desk.send({ sessionId: 's1', text: 'x' })).error, /older version/);
    desk.heard(body('SessionStart'));
    assert.equal(desk.send({ sessionId: 's1', text: 'before the end' }).ok, true);
    desk.heard(body('SessionEnd'));
    assert.deepEqual(desk.list().map((note) => [note.status, note.reason]), [['expired', 'the session ended']]);
    assert.match(/** @type {any} */ (desk.send({ sessionId: 's1', text: 'x' })).error, /ended/);
  });

  it('never hands a note to a forwarder that does not declare it can', () => {
    const { desk } = setup();
    desk.heard(body('SessionStart'));
    desk.send({ sessionId: 's1', text: 'x' });
    assert.deepEqual(texts(desk, body('PostToolUse', {}, { caps: ['truncated'] })), []);
  });

  it('refuses an empty note, one too long, and a sixth waiting for the same agent', () => {
    const { desk } = setup();
    desk.heard(body('SessionStart'));
    assert.match(/** @type {any} */ (desk.send({ sessionId: 's1', text: ' \u200B ' })).error, /needs some text/);
    assert.match(/** @type {any} */ (desk.send({ sessionId: 's1', text: 'x'.repeat(2001) })).error, /at most 2,000/);
    assert.match(/** @type {any} */ (desk.send({ text: 'x' })).error, /needs the session/);
    for (let i = 0; i < MAX_QUEUED_PER_AGENT; i++) assert.equal(desk.send({ sessionId: 's1', text: `note ${i}` }).ok, true);
    assert.match(/** @type {any} */ (desk.send({ sessionId: 's1', text: 'one more' })).error, /already has 5 notes waiting/);
    assert.equal(texts(desk, body('UserPromptSubmit')).length, MAX_NOTES_PER_HOOK, 'one reply carries at most four');
    assert.deepEqual(texts(desk, body('UserPromptSubmit')), ['note 4']);
  });

  it('expires a note that waited too long, on its own or when a hook comes', () => {
    const { desk, changes, advance } = setup();
    desk.heard(body('SessionStart'));
    desk.send({ sessionId: 's1', text: 'first' });
    advance(NOTE_TTL_MS - 1);
    desk.sweep();
    desk.send({ sessionId: 's1', text: 'second' });
    advance(1);
    desk.sweep();
    assert.deepEqual(changes.at(-1), { ...changes.at(-1), text: 'first', status: 'expired', reason: 'the agent took no step in time' });
    advance(NOTE_TTL_MS);
    assert.deepEqual(texts(desk, body('PostToolUse')), [], 'the second expired as the hook came');
    assert.deepEqual(desk.list().map((note) => note.status), ['expired', 'expired']);
  });
});

describe('the note budget', () => {
  it('is asked last, so a note refused for what it is costs nothing', () => {
    const { desk } = setup();
    desk.heard(body('SessionStart'));
    let asked = 0;
    const budget = () => ++asked <= 1;
    assert.equal(desk.send({ sessionId: 's1', text: '' }, budget).ok, false);
    assert.equal(asked, 0);
    assert.equal(desk.send({ sessionId: 's1', text: 'first' }, budget).ok, true);
    assert.match(/** @type {any} */ (desk.send({ sessionId: 's1', text: 'second' }, budget)).error, /Too many notes at once/);
    assert.equal(desk.list().length, 1);
  });
});

describe('a reply that never reached its forwarder', () => {
  it('puts its notes back in the queue, in order, and keeps them from other hooks meanwhile', () => {
    const { desk, changes } = setup();
    desk.heard(body('SessionStart'));
    desk.send({ sessionId: 's1', text: 'first' });
    const taken = desk.take(body('PostToolUse'));
    assert.deepEqual(taken.texts, ['first']);
    desk.send({ sessionId: 's1', text: 'second' });
    assert.deepEqual(texts(desk, body('PreToolUse')), ['second'], 'the first is on its way');
    taken.sent(false);
    taken.sent(true);
    assert.deepEqual(changes.map((note) => [note.text, note.status]), [['first', 'queued'], ['second', 'queued'], ['second', 'delivered']]);
    assert.deepEqual(texts(desk, body('PostToolUse')), ['first']);
  });

  it('expires them instead when their session ended meanwhile', () => {
    const { desk } = setup();
    desk.heard(body('SessionStart'));
    desk.send({ sessionId: 's1', text: 'late' });
    const taken = desk.take(body('PostToolUse'));
    desk.heard(body('SessionEnd'));
    taken.sent(false);
    assert.deepEqual(desk.list().map((note) => [note.status, note.reason]), [['expired', 'This session has ended']]);
  });
});
