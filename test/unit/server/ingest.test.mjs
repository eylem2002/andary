import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { POLICIES, ingestHook, ingestTeam } from '../../../server/ingest.mjs';
import { inputKey } from '../../../public/js/core/dialogs.js';

/** A town context that records which observers saw what. */
function fakeContext() {
  /** @type {Record<string, any[]>} */
  const seen = { usage: [], growth: [], notify: [], broker: [], relay: [], broadcast: [], history: [] };
  const ctx = {
    counts: { events: 0 },
    usage: { observe: (/** @type {any} */ e) => seen.usage.push(e) },
    progress: { observe: (/** @type {any} */ e) => seen.growth.push(e) },
    notifier: { observe: (/** @type {any} */ e) => seen.notify.push(e) },
    broker: { observe: (/** @type {any} */ e) => seen.broker.push(e) },
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
    const [envelope] = ingestHook(ctx, { ts: 5, source: 'claude', event: { hook_event_name: 'Stop', session_id: 's', andary_member: 'Mallory' } });
    assert.deepEqual([envelope.id, envelope.ts, envelope.event.andary_member], [1, 5, undefined]);
    for (const key of ['usage', 'growth', 'notify', 'broker', 'relay', 'history', 'broadcast']) assert.equal(seen[key].length, 1, key);
    assert.equal(seen.broadcast[0].e.id, 1);
  });

  it('a permission request is left to the route: approvals do not observe it', () => {
    const { ctx, seen } = fakeContext();
    ingestHook(ctx, { ts: 1, source: 'claude', event: { hook_event_name: 'PermissionRequest', session_id: 's', tool_name: 'Bash' } });
    assert.equal(seen.broker.length, 0);
    assert.equal(seen.relay.length, 1);
  });

  it('a Codex hook goes through its adapter and never reaches the usage reader', () => {
    const { ctx, seen } = fakeContext();
    const patch = '*** Begin Patch\n*** Add File: a.ts\n+a\n*** Add File: b.ts\n+b\n*** End Patch';
    const envelopes = ingestHook(ctx, { ts: 1, source: 'codex', event: { hook_event_name: 'PostToolUse', session_id: 't', cwd: '/w', tool_name: 'apply_patch', tool_use_id: 'c', tool_input: { command: patch } } });
    assert.deepEqual(envelopes.map((e) => [e.id, e.event.tool_name, e.event.andary_source]), [[1, 'Write', 'codex'], [2, 'Write', 'codex']]);
    assert.equal(seen.usage.length, 0);
    assert.equal(seen.broker.length, 2);
  });

  it('stamps every tool hook with its call key, from the input as it arrived; one that came along is replaced', () => {
    const { ctx, seen } = fakeContext();
    const input = { command: `echo ${'x'.repeat(3000)}` };
    const [envelope] = ingestHook(ctx, { ts: 1, source: 'claude', event: { hook_event_name: 'PostToolUse', session_id: 's', tool_name: 'Bash', tool_input: input, andary_key: 'forged' } });
    const key = inputKey(input);
    assert.equal(seen.notify[0].andary_key, key, 'the notifier reads it');
    assert.equal(seen.broker[0].andary_key, key, 'the broker reads it');
    assert.equal(envelope.event.andary_key, key, 'the sanitizer keeps it for the browsers');
    assert.notEqual(inputKey(envelope.event.tool_input), key, 'the cut input would not give it back');
    for (const hook of ['PermissionRequest', 'PreToolUse', 'PostToolUseFailure', 'PermissionDenied']) {
      const [stamped] = ingestHook(ctx, { ts: 2, source: 'claude', event: { hook_event_name: hook, session_id: 's', tool_name: 'Bash', tool_input: input } });
      assert.equal(stamped.event.andary_key, key, hook);
    }
    const [stop] = ingestHook(ctx, { ts: 3, source: 'claude', event: { hook_event_name: 'Stop', session_id: 's', andary_key: 'forged' } });
    assert.equal('andary_key' in stop.event, false, 'only a tool hook has one');
  });

  it("Codex: a renamed call has no key, and a long list command's request and result share one", () => {
    const { ctx } = fakeContext();
    const command = ['bash', '-lc', `echo ${'y'.repeat(2500)}`];
    const [asked] = ingestHook(ctx, { ts: 1, source: 'codex', event: { hook_event_name: 'PermissionRequest', session_id: 't', tool_name: 'Bash', tool_input: { command } } });
    const [ran] = ingestHook(ctx, { ts: 2, source: 'codex', event: { hook_event_name: 'PostToolUse', session_id: 't', tool_name: 'Bash', tool_use_id: 'c', tool_input: { command }, tool_response: { exit_code: 0 } } });
    assert.equal(ran.event.andary_key, asked.event.andary_key);
    assert.notEqual(inputKey(ran.event.tool_input), inputKey(asked.event.tool_input), 'sanitized, a list and the line the adapter joined are cut differently');
    const patch = '*** Begin Patch\n*** Add File: a.ts\n+a\n*** End Patch';
    const [write] = ingestHook(ctx, { ts: 3, source: 'codex', event: { hook_event_name: 'PostToolUse', session_id: 't', cwd: '/w', tool_name: 'apply_patch', tool_use_id: 'p', tool_input: { command: patch } } });
    assert.deepEqual([write.event.tool_name, write.event.andary_key], ['Write', null], 'its input was rewritten: it goes by name');
  });

  it("a teammate's tool hook gets the host's call key, never its own", () => {
    const { ctx } = fakeContext();
    const [envelope] = ingestTeam(ctx, 'Sam', [{ ts: 1, event: { hook_event_name: 'PostToolUse', session_id: 'x', tool_name: 'Bash', tool_input: { command: 'ls' }, andary_key: 'forged' } }], 1);
    assert.equal(envelope.event.andary_key, inputKey({ command: 'ls' }));
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
