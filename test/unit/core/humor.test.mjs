import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { SITUATIONS, createHumor, quip } from '../../../public/js/core/humor.js';
import { mulberry32 } from '../../../public/js/sim/random.js';

const FULL = Object.freeze({
  file: 'login.ts',
  cmd: 'npm test',
  pattern: 'TODO',
  host: 'docs.python.org',
  query: 'vitest fake timers',
  n: 3,
  agent: 'Scout 1',
  project: 'api-server',
  model: 'Opus 5.5',
  tool: 'Bash',
  server: 'github',
  skill: 'pdf',
  name: 'spike',
  to: 'backend',
  title: 'Ship It',
  goal: 'fix the login test',
  error: 'rate limit',
  type: 'code-reviewer',
});

/** Fails on anything a bubble must never show. @param {string} text */
function assertClean(text) {
  assert.equal(typeof text, 'string');
  assert.ok(text.trim().length > 0, 'non-empty');
  assert.doesNotMatch(text, /undefined|null|NaN|\[object/);
  assert.doesNotMatch(text, /\{\w+\}/, `unfilled placeholder in "${text}"`);
}

describe('humor', () => {
  it('covers every situation the brief asks for', () => {
    const required = [
      'session.start',
      'session.end',
      'prompt',
      'arrive.library',
      'arrive.workshop',
      'arrive.write',
      'arrive.terminal',
      'arrive.detective',
      'arrive.web',
      'arrive.board',
      'arrive.post',
      'arrive.harbor',
      'arrive.permits',
      'arrive.spa',
      'arrive.academy',
      'arrive.cafe',
      'arrive.grove',
      'arrive.station',
      'arrive.hall',
      'success.tests',
      'fail.tests',
      'fail.notfound',
      'fail.permission',
      'fail.timeout',
      'fail.interrupted',
      'fail.repeated',
      'wait.1',
      'wait.2',
      'wait.3',
      'wait.4',
      'idle',
      'sleep',
      'compact.start',
      'compact.end',
      'model.opus',
      'model.sonnet',
      'model.haiku',
      'model.other',
      'spawn.explore',
      'spawn.plan',
      'spawn.general',
      'spawn.teammate',
      'spawn.other',
      'subagent.done',
      'stop.rate_limit',
      'stop.overloaded',
      'cmd.install',
      'cmd.git-commit',
      'cmd.git-push',
      'success.commit',
      'success.push',
      'cmd.rm-rf',
      'cmd.docker',
      'cmd.curl',
      'todo.done',
      'todos.all',
      'message.send',
      'worktree',
      'mcp.boat',
      'achievement',
    ];
    for (const situation of required) assert.ok(SITUATIONS.includes(situation), situation);
  });

  it('every situation has a line with no context and with a full context, never with holes', () => {
    const humor = createHumor({ memory: 0 });
    for (const situation of SITUATIONS) {
      assertClean(humor.quip(situation, {}));
      for (let i = 0; i < 12; i++) assertClean(humor.quip(situation, FULL, mulberry32(i)));
    }
  });

  it('fills placeholders with real details, on one line and clipped', () => {
    const humor = createHumor();
    const seen = new Set();
    for (let i = 0; i < 60; i++) seen.add(humor.quip('arrive.library', { file: 'src/auth/login.ts' }, mulberry32(i)));
    assert.ok([...seen].some((line) => line.includes('src/auth/login.ts')));
    const long = humor.quip('fail.notfound', { file: `${'x'.repeat(200)}\nsecond line` }, () => 0);
    assert.ok(long.length < 160);
    assert.doesNotMatch(long, /\n/);
    assert.match(humor.quip('fail.repeated', { n: 4 }, () => 0), /4|Again|Persistence|bug/);
  });

  it('skips lines whose details are missing instead of leaving holes', () => {
    const humor = createHumor({ memory: 0 });
    for (let i = 0; i < 40; i++) {
      const line = humor.quip('message.send', { to: '' }, mulberry32(i));
      assert.equal(line, 'Paper plane, away!');
    }
  });

  it('avoids repeating recent lines', () => {
    const humor = createHumor({ memory: 4 });
    const random = mulberry32(7);
    const lines = Array.from({ length: 30 }, () => humor.quip('success.tests', FULL, random));
    for (let i = 1; i < lines.length; i++) {
      const window = lines.slice(Math.max(0, i - 4), i);
      assert.ok(!window.includes(lines[i]), `"${lines[i]}" repeated within 4`);
    }
  });

  it('falls back to the parent situation, then to a generic line', () => {
    const humor = createHumor();
    assertClean(humor.quip('fail.something-new', {}));
    assertClean(humor.quip('arrive.moon', { tool: 'Teleport' }));
    assertClean(humor.quip('not.a.situation', {}));
    assertClean(humor.quip(/** @type {any} */ (undefined), /** @type {any} */ (null)));
  });

  it('tolerates a random source that misbehaves', () => {
    const humor = createHumor();
    for (const random of [() => 1, () => -5, () => NaN, () => 0.9999999]) assertClean(humor.quip('idle', {}, random));
  });

  it('the shared quip() works with the default random source', () => {
    assertClean(quip('session.start', { project: 'api-server' }));
  });

  it('keeps the house style: no profanity or put-downs', () => {
    const banned = /\b(stupid|dumb|idiot|crazy|insane|lame|hate|damn|hell|crap|suck|kill|guys)\b/i;
    const humor = createHumor({ memory: 0 });
    for (const situation of SITUATIONS) {
      for (let i = 0; i < 20; i++) assert.doesNotMatch(humor.quip(situation, FULL, mulberry32(i * 31)), banned);
    }
  });
});
