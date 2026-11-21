import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { POLICIES, ingestHook, ingestTeam } from '../../../server/ingest.mjs';
import { inputKey } from '../../../public/js/core/dialogs.js';

/** A local hook at the clock's 10 s mark, so the small times below are kept as they are (hookTime). */
const HOUR = 60 * 60_000;
const ingestAt = (/** @type {any} */ ctx, /** @type {any} */ body) => ingestHook(ctx, body, 10_000);

/** A town context that records which observers saw what. */
function fakeContext() {
  /** @type {Record<string, any[]>} */
  const seen = { usage: [], growth: [], notify: [], broker: [], relay: [], broadcast: [], history: [] };
  const ctx = {
    counts: { events: 0 },
    usage: { observe: (/** @type {any} */ e, /** @type {number} */ ts) => seen.usage.push({ ...e, observedTs: ts }) },
    progress: { observe: (/** @type {any} */ e) => seen.growth.push(e) },
    notifier: { observe: (/** @type {any} */ e, /** @type {number} */ ts) => seen.notify.push({ ...e, ts }) },
    broker: { observe: (/** @type {any} */ e, /** @type {number} */ ts) => seen.broker.push({ ...e, ts }) },
    relay: { send: (/** @type {any} */ envelope) => seen.relay.push(envelope) },
    history: { push: (/** @type {any} */ envelope) => seen.history.push(envelope) },
    recorder: null,
    hub: { broadcastText: (/** @type {string} */ text) => seen.broadcast.push(JSON.parse(text)) },
    log: () => {},
  };
  return { ctx: /** @type {any} */ (ctx), seen };
}

const names = (/** @type {any[]} */ events) => events.map((e) => e.hook_event_name);

describe('ingest', () => {
  it('policies: local events reach every observer, a teammate\'s only grow the town', () => {
    assert.deepEqual(POLICIES.local, { growth: true, notify: true, approvals: true, relay: true });
    assert.deepEqual(POLICIES.team, { growth: true, notify: false, approvals: false, relay: false });
    assert.ok(Object.isFrozen(POLICIES) && Object.isFrozen(POLICIES.local));
  });

  it('a local Claude Code hook: usage, growth, notifications, relay and approvals, then the browsers', () => {
    const { ctx, seen } = fakeContext();
    const [envelope] = ingestAt(ctx, { ts: 5, source: 'claude', event: { hook_event_name: 'Stop', session_id: 's', andary_member: 'Mallory' } });
    assert.deepEqual([envelope.id, envelope.ts, envelope.event.andary_member], [1, 5, undefined]);
    for (const key of ['usage', 'growth', 'notify', 'broker', 'relay', 'history', 'broadcast']) assert.equal(seen[key].length, 1, key);
    assert.equal(seen.broadcast[0].e.id, 1);
    // The usage reader gets the hook's start time: a compaction then drops older context readings.
    assert.equal(seen.usage[0].observedTs, 5);
  });

  it("the phone notes and the approval broker get each hook's own time: hooks may arrive out of order", () => {
    const { ctx, seen } = fakeContext();
    ingestAt(ctx, { ts: 1_234, source: 'claude', event: { hook_event_name: 'PreToolUse', session_id: 's', tool_name: 'ExitPlanMode', tool_input: { plan: 'x' } } });
    assert.deepEqual([seen.notify[0].ts, seen.broker[0].ts, seen.broadcast[0].e.ts], [1_234, 1_234, 1_234]);
  });

  it('every reader gets the same kept time: never later than its arrival, nor more than an hour before it', () => {
    const { ctx, seen } = fakeContext();
    const stop = { hook_event_name: 'Stop', session_id: 's' };
    const now = 10 * HOUR;
    ingestHook(ctx, { ts: now + 400_000, source: 'claude', event: stop }, now);
    ingestHook(ctx, { ts: 1, source: 'claude', event: stop }, now);
    const times = (/** @type {any[]} */ list) => list.map((x) => x.ts ?? x.e.ts);
    assert.deepEqual(times(seen.notify), [now, now - HOUR]);
    assert.deepEqual(times(seen.broker), [now, now - HOUR]);
    assert.deepEqual(times(seen.broadcast), [now, now - HOUR], 'the town reads the time the notes and the broker go by');
  });

  it('a permission request is left to the route: approvals do not observe it', () => {
    const { ctx, seen } = fakeContext();
    ingestAt(ctx, { ts: 1, source: 'claude', event: { hook_event_name: 'PermissionRequest', session_id: 's', tool_name: 'Bash' } });
    assert.equal(seen.broker.length, 0);
    assert.equal(seen.relay.length, 1);
  });

  it('a Codex hook goes through its adapter and never reaches the usage reader', () => {
    const { ctx, seen } = fakeContext();
    const patch = '*** Begin Patch\n*** Add File: a.ts\n+a\n*** Add File: b.ts\n+b\n*** End Patch';
    const envelopes = ingestAt(ctx, { ts: 1, source: 'codex', event: { hook_event_name: 'PostToolUse', session_id: 't', cwd: '/w', tool_name: 'apply_patch', tool_use_id: 'c', tool_input: { command: patch } } });
    assert.deepEqual(envelopes.map((e) => [e.id, e.event.tool_name, e.event.andary_source]), [[1, 'Write', 'codex'], [2, 'Write', 'codex']]);
    assert.equal(seen.usage.length, 0);
    assert.equal(seen.broker.length, 2);
  });

  it('stamps every tool hook with its call key, from the input as it arrived; one that came along is replaced', () => {
    const { ctx, seen } = fakeContext();
    const input = { command: `echo ${'x'.repeat(3000)}` };
    const [envelope] = ingestAt(ctx, { ts: 1, source: 'claude', event: { hook_event_name: 'PostToolUse', session_id: 's', tool_name: 'Bash', tool_input: input, andary_key: 'forged' } });
    const key = inputKey(input);
    assert.equal(seen.notify[0].andary_key, key, 'the notifier reads it');
    assert.equal(seen.broker[0].andary_key, key, 'the broker reads it');
    assert.equal(envelope.event.andary_key, key, 'the sanitizer keeps it for the browsers');
    assert.notEqual(inputKey(envelope.event.tool_input), key, 'the cut input would not give it back');
    for (const hook of ['PermissionRequest', 'PreToolUse', 'PostToolUseFailure', 'PermissionDenied']) {
      const [stamped] = ingestAt(ctx, { ts: 2, source: 'claude', event: { hook_event_name: hook, session_id: 's', tool_name: 'Bash', tool_input: input } });
      assert.equal(stamped.event.andary_key, key, hook);
    }
    const [stop] = ingestAt(ctx, { ts: 3, source: 'claude', event: { hook_event_name: 'Stop', session_id: 's', andary_key: 'forged' } });
    assert.equal('andary_key' in stop.event, false, 'only a tool hook has one');
  });

  it("Codex: a renamed call keeps its own call's key, and a long list command's request and result share one", () => {
    const { ctx } = fakeContext();
    const command = ['bash', '-lc', `echo ${'y'.repeat(2500)}`];
    const [asked] = ingestAt(ctx, { ts: 1, source: 'codex', event: { hook_event_name: 'PermissionRequest', session_id: 't', tool_name: 'Bash', tool_input: { command } } });
    const [ran] = ingestAt(ctx, { ts: 2, source: 'codex', event: { hook_event_name: 'PostToolUse', session_id: 't', tool_name: 'Bash', tool_use_id: 'c', tool_input: { command }, tool_response: { exit_code: 0 } } });
    assert.equal(ran.event.andary_key, asked.event.andary_key);
    assert.notEqual(inputKey(ran.event.tool_input), inputKey(asked.event.tool_input), 'sanitized, a list and the line the adapter joined are cut differently');
    // A two-file patch: both edits it becomes carry the key the request was asked with.
    const patch = '*** Begin Patch\n*** Add File: a.ts\n+a\n*** Add File: b.ts\n+b\n*** End Patch';
    const [request] = ingestAt(ctx, { ts: 3, source: 'codex', event: { hook_event_name: 'PermissionRequest', session_id: 't', tool_name: 'apply_patch', tool_input: { command: patch } } });
    const writes = ingestAt(ctx, { ts: 4, source: 'codex', event: { hook_event_name: 'PostToolUse', session_id: 't', cwd: '/w', tool_name: 'apply_patch', tool_use_id: 'p', tool_input: { command: patch }, andary_key: 'forged' } });
    assert.deepEqual(writes.map((e) => [e.event.tool_name, e.event.andary_key]), [['Write', request.event.andary_key], ['Write', request.event.andary_key]]);
    const [helper] = ingestAt(ctx, { ts: 5, source: 'codex', event: { hook_event_name: 'PreToolUse', session_id: 't', tool_name: 'spawn_agent', tool_input: { message: 'look around' } } });
    assert.deepEqual([helper.event.tool_name, helper.event.andary_key], ['Agent', inputKey({ message: 'look around' })]);
  });

  it("a teammate's tool hook keeps the key its own server stamped; one without is keyed here", () => {
    const { ctx } = fakeContext();
    const [theirs, unkeyed, renamed] = ingestTeam(ctx, 'Sam', [
      { ts: 1, event: { hook_event_name: 'PostToolUse', session_id: 'x', tool_name: 'Bash', tool_input: { command: 'ls' }, andary_key: 'from-their-server' } },
      { ts: 1, event: { hook_event_name: 'PostToolUse', session_id: 'x', tool_name: 'Bash', tool_input: { command: 'ls' } } },
      // From an older server: a call its adapter renamed, with no key. Its input was rewritten,
      // so it has none here either and goes by name.
      { ts: 1, event: { hook_event_name: 'PostToolUse', session_id: 'x', tool_name: 'Edit', andary_tool: 'apply_patch', tool_input: { file_path: '/a', old_string: 'a', new_string: 'b' } } },
    ], 1);
    assert.deepEqual([theirs.event.andary_key, unkeyed.event.andary_key, renamed.event.andary_key], ['from-their-server', inputKey({ command: 'ls' }), null]);
  });

  it("a local tool hook gets the top of its folder's work tree; a stamp from elsewhere is dropped, and a teammate's hooks get none", () => {
    const { ctx } = fakeContext();
    /** @type {string[]} */
    const asked = [];
    ctx.workTrees = { rootOf: (/** @type {unknown} */ folder) => (asked.push(String(folder)), folder === '/w/app/src' ? '/w/app' : null) };
    const tool = { hook_event_name: 'PreToolUse', session_id: 's', cwd: '/w/app/src', tool_name: 'Bash', tool_input: { command: 'git stash' } };
    const [local] = ingestHook(ctx, { ts: 1, source: 'claude', event: { ...tool, andary_root: '/forged' } });
    const [outside] = ingestHook(ctx, { ts: 1, source: 'claude', event: { ...tool, cwd: '/tmp' } });
    const [stop] = ingestHook(ctx, { ts: 1, source: 'claude', event: { hook_event_name: 'Stop', session_id: 's', cwd: '/w/app/src' } });
    assert.deepEqual([local.event.andary_root, 'andary_root' in outside.event, 'andary_root' in stop.event], ['/w/app', false, false]);
    assert.deepEqual(asked, ['/w/app/src', '/tmp'], 'only tool hooks are looked up');
    const [theirs] = ingestTeam(ctx, 'Sam', [{ ts: 1, event: { ...tool, andary_root: '/their/app' } }], 1);
    assert.equal('andary_root' in theirs.event, false, 'their folders are on their computer');
    assert.equal(asked.length, 2);
  });

  it("a teammate's batch: named, sessions prefixed, dated within the last hour, and kept to themselves", () => {
    const { ctx, seen } = fakeContext();
    const now = 10 * 60 * 60 * 1000;
    const envelopes = ingestTeam(ctx, 'Sam', [
      { ts: now - 1000, event: { hook_event_name: 'Stop', session_id: 'x', andary_member: 'Mallory' } },
      { ts: 0, event: { hook_event_name: 'PreToolUse', session_id: 'y' } },
      { ts: now + 60_000, event: { hook_event_name: 'PermissionRequest' } },
    ], now);
    assert.deepEqual(envelopes.map((e) => [e.event.andary_member, e.event.session_id]), [['Sam', 'Sam~x'], ['Sam', 'Sam~y'], ['Sam', 'Sam~unknown']]);
    assert.deepEqual(envelopes.map((e) => e.ts), [now - 1000, now - 60 * 60 * 1000, now]);
    assert.deepEqual(names(seen.growth), ['Stop', 'PreToolUse', 'PermissionRequest']);
    for (const key of ['usage', 'notify', 'broker', 'relay']) assert.equal(seen[key].length, 0, key);
    assert.equal(seen.broadcast.length, 3);
  });
});
