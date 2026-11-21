import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { closeBrowser, connectBrowser, hookPayload, postHook, startTown, waitForMessage } from './helpers.mjs';

describe('Token usage from transcripts', () => {
  /** @type {Awaited<ReturnType<typeof startTown>>} */
  let town;
  before(async () => {
    town = await startTown();
  });
  after(async () => {
    await town?.stop();
  });

  it('reads a transcript a hook points to and streams the totals, which come back in hello', async () => {
    const project = join(dirname(town.home), 'claude', 'projects', '-work-demo-app');
    mkdirSync(project, { recursive: true });
    const transcript = join(project, 'session-u.jsonl');
    const entry = { type: 'assistant', timestamp: new Date().toISOString(), message: { id: 'msg_1', model: 'claude-opus-5-5', usage: { input_tokens: 1000, output_tokens: 1000 } } };
    writeFileSync(transcript, `${JSON.stringify(entry)}\n`);
    const browser = await connectBrowser(town);
    const hello = await waitForMessage(browser, (m) => m?.t === 'hello');
    assert.deepEqual(hello.usage, { agents: [], days: [] });
    await postHook(town, hookPayload('Stop', { session_id: 'session-u', transcript_path: transcript, last_assistant_message: 'done', stop_hook_active: false }));
    const update = await waitForMessage(browser, (m) => m?.t === 'usage', 5000);
    assert.equal(update.u.sessionId, 'session-u');
    assert.equal(update.u.tokens.output, 1000);
    assert.ok(Math.abs(update.u.costUsd - 0.024) < 1e-9);
    assert.equal(update.days.at(-1).tokens, 2000);
    await closeBrowser(browser);
    const later = await connectBrowser(town);
    const again = await waitForMessage(later, (m) => m?.t === 'hello');
    assert.equal(again.usage.agents[0].tokens.output, 1000);
    await closeBrowser(later);
  });

  it('sends the context in use with the totals, drops it at a compaction, and has it in hello', async () => {
    const project = join(dirname(town.home), 'claude', 'projects', '-work-demo-app');
    mkdirSync(project, { recursive: true });
    const transcript = join(project, 'session-c.jsonl');
    const message = (/** @type {string} */ id, /** @type {Record<string, number>} */ usage, /** @type {string} */ timestamp) =>
      `${JSON.stringify({ type: 'assistant', isSidechain: false, sessionId: 'session-c', timestamp, requestId: `req_${id}`, message: { id, role: 'assistant', model: 'claude-opus-5-5', usage } })}\n`;
    const written = new Date(Date.now() - 60_000).toISOString();
    writeFileSync(transcript, message('msg_c1', { input_tokens: 4, cache_creation_input_tokens: 1520, cache_read_input_tokens: 180_816, output_tokens: 312 }, written));
    const browser = await connectBrowser(town);
    await waitForMessage(browser, (m) => m?.t === 'hello');
    const hook = (/** @type {string} */ name, /** @type {Record<string, unknown>} */ extra = {}) => postHook(town, hookPayload(name, { session_id: 'session-c', transcript_path: transcript, ...extra }));
    await hook('PostToolUse', { tool_name: 'Bash', tool_use_id: 'tu-1', tool_input: { command: 'npm test' }, tool_response: {} });
    const first = await waitForMessage(browser, (m) => m?.t === 'usage' && m.u.sessionId === 'session-c', 5000);
    assert.deepEqual(first.u.context, { tokens: 182_340, at: Date.parse(written) });
    assert.equal(first.u.compactedAt, null);
    // A compaction: unknown at once, before the next read of the transcript, and when it was.
    const before = Date.now();
    await hook('PostCompact', { trigger: 'manual', compact_summary: 'Fixed the flaky test.' });
    const compacted = await waitForMessage(browser, (m) => m?.t === 'usage' && m.u.sessionId === 'session-c' && m.u.context === null, 2000);
    assert.ok(compacted.u.compactedAt >= before && compacted.u.compactedAt <= Date.now());
    await new Promise((r) => setTimeout(r, 20));
    writeFileSync(transcript, message('msg_c2', { input_tokens: 9, cache_creation_input_tokens: 23_000, cache_read_input_tokens: 8000, output_tokens: 40 }, new Date().toISOString()), { flag: 'a' });
    await hook('Stop', { last_assistant_message: 'done', stop_hook_active: false });
    await waitForMessage(browser, (m) => m?.t === 'usage' && m.u.context?.tokens === 31_009, 5000);
    await closeBrowser(browser);
    const later = await connectBrowser(town);
    const hello = await waitForMessage(later, (m) => m?.t === 'hello');
    assert.equal(hello.usage.agents.find((/** @type {any} */ r) => r.sessionId === 'session-c')?.context?.tokens, 31_009);
    await closeBrowser(later);
  });

  it('ignores a transcript outside Claude Code\'s projects folder', async () => {
    const outside = join(town.home, '..', 'elsewhere.jsonl');
    writeFileSync(outside, `${JSON.stringify({ type: 'assistant', message: { id: 'x', model: 'claude-opus-5-5', usage: { input_tokens: 5 } } })}\n`);
    const browser = await connectBrowser(town);
    await waitForMessage(browser, (m) => m?.t === 'hello');
    await postHook(town, hookPayload('Stop', { session_id: 'session-x', transcript_path: outside }));
    await new Promise((r) => setTimeout(r, 1500));
    assert.equal(browser.messages.some((m) => m?.t === 'usage' && m.u.sessionId === 'session-x'), false);
    await closeBrowser(browser);
  });
});

describe('The town\'s growth', () => {
  /** @type {Awaited<ReturnType<typeof startTown>>} */
  let town;
  before(async () => {
    town = await startTown();
  });
  after(async () => {
    await town?.stop();
  });

  it('counts finished work and sends the progress to browsers, also in hello', async () => {
    const browser = await connectBrowser(town);
    const hello = await waitForMessage(browser, (m) => m?.t === 'hello');
    assert.deepEqual(hello.progress, { points: 0, days: [] });
    await postHook(town, hookPayload('Stop', { last_assistant_message: 'done', stop_hook_active: false }));
    const update = await waitForMessage(browser, (m) => m?.t === 'progress' && m.p.points === 1);
    assert.equal(update.p.days.length, 1);
    await closeBrowser(browser);
  });
});
