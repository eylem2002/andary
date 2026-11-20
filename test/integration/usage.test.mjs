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
