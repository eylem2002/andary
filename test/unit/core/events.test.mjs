import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { normalize } from '../../../public/js/core/events.js';
import { agentKeyOf, normalizeAgentId } from '../../../public/js/core/ids.js';
import { classifyCommand, classifyError, summarizeTool } from '../../../public/js/core/summaries.js';
import { hostPath, shortCommand, shortPath } from '../../../public/js/core/text.js';
import { CWD, FIXTURES, SESSION, envelope, hook } from './helpers.mjs';

const MAIN = agentKeyOf(SESSION, null);

/** @param {Record<string, any>} payload */
function one(payload) {
  const events = normalize(envelope(payload));
  assert.ok(events.length >= 1, 'at least one event');
  return events[0];
}

describe('normalize: one TownEvent per hook (CONTRACTS §4.2 → §5)', () => {
  const expected = {
    SessionStart: 'session.start',
    SessionEnd: 'session.end',
    UserPromptSubmit: 'prompt',
    PreToolUse: 'tool.start',
    PostToolUse: 'tool.end',
    PostToolUseFailure: 'tool.fail',
    PermissionRequest: 'permission.request',
    PermissionDenied: 'permission.denied',
    Notification: 'notify',
    SubagentStart: 'subagent.start',
    SubagentStop: 'subagent.stop',
    Stop: 'turn.stop',
    StopFailure: 'turn.fail',
    TaskCreated: 'task.created',
    TaskCompleted: 'task.completed',
    TeammateIdle: 'teammate.idle',
    PreCompact: 'compact.start',
    PostCompact: 'compact.end',
    PostModelSwitch: 'model.switch',
  };

  for (const [name, kind] of Object.entries(expected)) {
    it(`${name} → ${kind}`, () => {
      const env = envelope(FIXTURES[/** @type {keyof typeof FIXTURES} */ (name)], 5000);
      const [event] = normalize(env);
      assert.equal(event.kind, kind);
      assert.equal(event.id, String(env.id));
      assert.equal(event.ts, 5000);
      assert.equal(event.rx, 5003);
      assert.equal(event.sessionId, SESSION);
      assert.equal(event.cwd, CWD);
      assert.equal(typeof event.data, 'object');
    });
  }

  it('carries the common envelope fields and the agentKey of the main thread', () => {
    const event = one(FIXTURES.Stop);
    assert.equal(event.agentKey, MAIN);
    assert.equal(event.agentId, null);
    assert.equal(event.agentType, null);
    assert.deepEqual(event.data, { lastMessage: 'All done.', interrupted: false, stopHookActive: false, backgroundTasks: [], sessionCrons: [] });
  });

  it('attributes subagent events to the subagent, stripping the agent- prefix', () => {
    const start = one(FIXTURES.SubagentStart);
    assert.equal(start.agentId, 'a1b2c3');
    assert.equal(start.agentKey, `${SESSION}:a1b2c3`);
    assert.equal(start.agentType, 'Explore');
    const stop = one(FIXTURES.SubagentStop);
    assert.equal(stop.agentKey, `${SESSION}:a1b2c3`);
    assert.equal(stop.data.lastMessage, 'Found it in tokens.ts');
    assert.equal(stop.data.transcriptPath, '/t/agent-a1b2c3.jsonl');
  });

  it('reads session, prompt and model-switch fields', () => {
    assert.deepEqual(one(FIXTURES.SessionStart).data, { source: 'startup', model: 'claude-opus-5-5', title: null, agentType: null, permissionMode: 'default' });
    assert.equal(one(FIXTURES.SessionEnd).data.reason, 'prompt_input_exit');
    assert.equal(one(FIXTURES.UserPromptSubmit).data.prompt, 'Fix the flaky\nlogin test');
    assert.deepEqual(one(FIXTURES.PostModelSwitch).data, { from: 'claude-opus-5-5', to: 'claude-sonnet-5', requested: 'sonnet', source: 'user' });
    assert.deepEqual(one(FIXTURES.PreCompact).data, { trigger: 'auto', customInstructions: '' });
    assert.deepEqual(one(FIXTURES.PostCompact).data, { trigger: 'auto', summary: 'Summary of the work so far' });
    assert.deepEqual(one(FIXTURES.Notification).data, { message: 'Claude needs your permission to use Bash', title: 'Claude Code', notificationType: 'permission_prompt' });
    assert.deepEqual(one(FIXTURES.StopFailure).data, { error: 'rate_limit', errorDetails: '429 Too Many Requests', lastMessage: '' });
  });

  it('describes tool calls with building, activity and summary', () => {
    const start = one(FIXTURES.PreToolUse);
    assert.equal(start.data.toolUseId, 'toolu_read1');
    assert.equal(start.data.tool, 'Read');
    assert.equal(start.data.building, 'library');
    assert.equal(start.data.activity, 'read');
    assert.equal(start.data.summary, 'Read src/auth/login.ts');
    assert.equal(start.data.file, `${CWD}/src/auth/login.ts`);
    const end = one(FIXTURES.PostToolUse);
    assert.equal(end.data.building, 'terminal');
    assert.equal(end.data.commandKind, 'test');
    assert.equal(end.data.durationMs, 3120);
    assert.deepEqual(end.data.response, { stdout: 'ok', stderr: '', interrupted: false });
  });

  it('keeps the first error line and classifies failures', () => {
    const fail = one(FIXTURES.PostToolUseFailure);
    assert.equal(fail.data.error, 'Exit code 1');
    assert.equal(fail.data.isInterrupt, false);
    assert.equal(fail.data.errorKind, 'tests');
    const interrupted = one(hook('PostToolUseFailure', { tool_name: 'Read', tool_input: {}, tool_use_id: 'x', error: 'Interrupted', is_interrupt: true }));
    assert.equal(interrupted.data.errorKind, 'interrupted');
  });

  it('marks permission requests (no tool_use_id) and denials', () => {
    const request = one(FIXTURES.PermissionRequest);
    assert.equal(request.data.toolUseId, null);
    assert.equal(request.data.summary, '$ rm -rf dist');
    assert.equal(request.data.commandKind, 'rm-rf');
    assert.equal(request.data.suggestions.length, 1);
    const denied = one(FIXTURES.PermissionDenied);
    assert.equal(denied.data.toolUseId, 'toolu_bash3');
    assert.match(denied.data.reason, /remote scripts/);
  });

  it('reads task and teammate hooks', () => {
    assert.deepEqual(one(FIXTURES.TaskCreated).data, { taskId: '1', subject: 'Build the settings form', description: 'React form', teammateName: null, teamName: null });
    assert.equal(one(FIXTURES.TaskCompleted).data.teammateName, 'frontend');
    assert.deepEqual(one(FIXTURES.TeammateIdle).data, { teammateName: 'frontend', teamName: 'settings' });
  });

  it('reports MCP tools at the harbor with their server', () => {
    const event = one(hook('PreToolUse', { tool_name: 'mcp__github__create_issue', tool_input: { title: 'x' }, tool_use_id: 't', mcp_server: 'github' }));
    assert.equal(event.data.building, 'harbor');
    assert.equal(event.data.mcpServer, 'github');
    assert.equal(event.data.summary, 'github: create_issue');
    const inferred = one(hook('PreToolUse', { tool_name: 'mcp__linear__get_issue', tool_input: {}, tool_use_id: 't' }));
    assert.equal(inferred.data.mcpServer, 'linear');
  });
});

describe('normalize: derived events', () => {
  it('TodoWrite (PostToolUse) → todos.set with clean items', () => {
    const todos = [
      { content: 'Reproduce', status: 'completed', activeForm: 'Reproducing' },
      { content: '', activeForm: 'Fixing', status: 'in_progress' },
      { content: 'Ship', status: 'weird' },
      'not an object',
    ];
    const events = normalize(envelope(hook('PostToolUse', { tool_name: 'TodoWrite', tool_input: { todos }, tool_response: {}, tool_use_id: 't1' })));
    assert.deepEqual(
      events.map((e) => [e.id.split('.').length, e.kind]),
      [
        [1, 'tool.end'],
        [2, 'todos.set'],
      ],
    );
    assert.deepEqual(events[1].data.todos, [
      { text: 'Reproduce', status: 'completed' },
      { text: 'Fixing', status: 'in_progress' },
      { text: 'Ship', status: 'pending' },
    ]);
    assert.equal(events[1].id, `${events[0].id}.1`);
  });

  it('TaskCreate takes its id from the response; TaskUpdate from its input', () => {
    const created = normalize(
      envelope(hook('PostToolUse', { tool_name: 'TaskCreate', tool_input: { subject: 'Build the form', description: 'd' }, tool_response: { task: { id: 7, subject: 'Build the form' } }, tool_use_id: 't2' })),
    )[1];
    assert.equal(created.kind, 'task.upsert');
    assert.deepEqual(created.data, { taskId: '7', subject: 'Build the form', description: 'd', status: 'pending', owner: null, source: 'TaskCreate' });
    const updated = normalize(envelope(hook('PostToolUse', { tool_name: 'TaskUpdate', tool_input: { taskId: '7', status: 'in_progress', owner: 'frontend' }, tool_response: {}, tool_use_id: 't3' })))[1];
    assert.deepEqual(updated.data, { taskId: '7', subject: null, description: null, status: 'in_progress', owner: 'frontend', source: 'TaskUpdate' });
    const deleted = normalize(envelope(hook('PostToolUse', { tool_name: 'TaskUpdate', tool_input: { taskId: '7', status: 'deleted' }, tool_response: {}, tool_use_id: 't4' })))[1];
    assert.equal(deleted.data.status, 'deleted');
  });

  it('Agent and legacy Task: spawn.request at PreToolUse, spawn.result at PostToolUse', () => {
    for (const tool of ['Agent', 'Task']) {
      const input = { description: 'Find expiry', prompt: 'Look', subagent_type: 'Explore', name: 'scout', model: 'haiku', run_in_background: true, isolation: 'worktree' };
      const [start, request] = normalize(envelope(hook('PreToolUse', { tool_name: tool, tool_input: input, tool_use_id: 'tu' })));
      assert.equal(start.data.building, 'hall');
      assert.equal(request.kind, 'spawn.request');
      assert.deepEqual(request.data, {
        toolUseId: 'tu',
        subagentType: 'Explore',
        description: 'Find expiry',
        prompt: 'Look',
        name: 'scout',
        teamName: null,
        model: 'haiku',
        background: true,
        isolation: 'worktree',
      });
      const response = { status: 'completed', agentId: 'agent-77', content: [{ type: 'text', text: 'Done.' }], totalTokens: 10, totalDurationMs: 20, totalToolUseCount: 3 };
      const [, result] = normalize(envelope(hook('PostToolUse', { tool_name: tool, tool_input: input, tool_response: response, tool_use_id: 'tu' })));
      assert.equal(result.kind, 'spawn.result');
      assert.equal(result.data.agentId, '77');
      assert.equal(result.data.content, 'Done.');
      assert.equal(result.data.totalToolUseCount, 3);
    }
  });

  it('SendMessage → message.send, reading recipient and text defensively', () => {
    const shapes = [
      [{ to: 'backend', message: 'What shape?', summary: 'API question' }, 'backend', 'What shape?', 'API question'],
      [{ recipient: 'frontend', content: 'Here it is' }, 'frontend', 'Here it is', null],
      [{ to: 'tester', message: { type: 'shutdown_request', reason: 'done' } }, 'tester', 'shutdown request', null],
      [{ to: ['a', 'b'], message: [{ type: 'text', text: 'hi' }] }, 'a, b', 'hi', null],
      [{}, null, '', null],
    ];
    for (const [input, to, message, summary] of shapes) {
      const [start, sent] = normalize(envelope(hook('PreToolUse', { tool_name: 'SendMessage', tool_input: input, tool_use_id: 'm' })));
      assert.equal(start.data.building, 'post');
      assert.equal(sent.kind, 'message.send');
      assert.equal(sent.data.to, to);
      assert.equal(sent.data.message, message);
      assert.equal(sent.data.summary, summary);
    }
  });

  it('derives nothing for other tools or other hooks', () => {
    assert.equal(normalize(envelope(FIXTURES.PreToolUse)).length, 1);
    assert.equal(normalize(envelope(hook('PostToolUseFailure', { tool_name: 'TodoWrite', tool_input: { todos: [] }, tool_use_id: 'x', error: 'no' }))).length, 1);
  });
});

describe('normalize: odd input never throws', () => {
  const odd = [
    undefined,
    null,
    0,
    'PreToolUse',
    [],
    {},
    { event: null },
    { event: 'string' },
    { event: [] },
    { event: { hook_event_name: 42 } },
    { event: { hook_event_name: 'PreToolUse', tool_name: 7, tool_input: 'not an object', tool_use_id: {} } },
    { event: { hook_event_name: 'PostToolUse', tool_name: 'constructor', tool_input: null } },
    { event: { hook_event_name: '__proto__' } },
    { event: { hook_event_name: 'PreToolUse', tool_name: 'toString', tool_input: { file_path: 5 } } },
    { event: { hook_event_name: 'PostToolUse', tool_name: 'TodoWrite', tool_input: { todos: 'nope' } } },
    { event: { hook_event_name: 'PostToolUse', tool_name: 'Agent', tool_input: {}, tool_response: 'text' } },
    { event: { hook_event_name: 'Unknown', raw: '{not json' } },
    { id: 'abc', ts: 'yesterday', event: { hook_event_name: 'Stop', last_assistant_message: { nested: { deeper: [1, 2] } } } },
  ];
  for (const [i, input] of odd.entries()) {
    it(`case ${i}`, () => {
      const events = normalize(input);
      assert.ok(Array.isArray(events));
      for (const e of events) {
        assert.equal(typeof e.kind, 'string');
        assert.equal(typeof e.sessionId, 'string');
        assert.ok(e.agentKey.includes(':'));
        assert.ok(!Number.isNaN(e.ts));
      }
    });
  }

  it('maps unknown hooks to an unknown event and tools named like Object members to a real building', () => {
    const [unknown] = normalize({ event: { hook_event_name: 'Elicitation', session_id: 's' } });
    assert.equal(unknown.kind, 'unknown');
    assert.equal(unknown.data.hookEventName, 'Elicitation');
    const [weird] = normalize({ event: { hook_event_name: 'PreToolUse', tool_name: 'constructor', tool_input: {}, session_id: 's' } });
    assert.equal(weird.data.building, 'workshop');
    assert.equal(weird.data.summary, 'constructor');
  });

  it('survives a circular tool_input', () => {
    /** @type {any} */
    const input = { file_path: '/x/a.ts' };
    input.self = input;
    const events = normalize({ event: { hook_event_name: 'PreToolUse', tool_name: 'Read', tool_input: input, session_id: 's' } });
    assert.equal(events[0].data.summary, 'Read /x/a.ts');
  });

  it('accepts a bare hook payload and falls back to the injected clock', () => {
    const [event] = normalize(FIXTURES.Stop, { now: () => 42 });
    assert.equal(event.kind, 'turn.stop');
    assert.equal(event.ts, 42);
    assert.equal(event.rx, 42);
    assert.match(event.id, /^local-\d+$/);
  });
});

describe('agent ids', () => {
  it('strips one leading "agent-" and keys agents by session', () => {
    assert.equal(normalizeAgentId('agent-abc'), 'abc');
    assert.equal(normalizeAgentId('abc'), 'abc');
    assert.equal(normalizeAgentId('agent-'), 'agent-');
    assert.equal(normalizeAgentId(''), null);
    assert.equal(normalizeAgentId(undefined), null);
    assert.equal(normalizeAgentId(12), '12');
    assert.equal(agentKeyOf('s', null), 's:main');
    assert.equal(agentKeyOf('s', 'abc'), 's:abc');
  });
});

describe('summarizeTool', () => {
  const cases = [
    ['Read', { file_path: `${CWD}/src/auth/login.ts` }, 'Read src/auth/login.ts'],
    ['Read', { file_path: '/home/dev/notes/todo.md' }, 'Read ~/notes/todo.md'],
    ['Read', { file_path: '/Users/sam/x.ts' }, 'Read ~/x.ts'],
    ['Write', { file_path: `${CWD}/src/new.ts`, content: '…' }, 'Write src/new.ts'],
    ['Edit', { file_path: `${CWD}/package.json` }, 'Edit package.json'],
    ['NotebookEdit', { notebook_path: `${CWD}/analysis.ipynb` }, 'Edit analysis.ipynb'],
    ['Bash', { command: 'npm test' }, '$ npm test'],
    ['Bash', { command: `cd ${CWD} && npm run build` }, '$ npm run build'],
    ['Bash', { command: 'cat <<EOF > x\nhello\nEOF' }, '$ cat <<EOF > x …'],
    ['Grep', { pattern: 'TODO', path: `${CWD}/src` }, 'grep "TODO" in src'],
    ['Grep', { pattern: 'useEffect', glob: '*.tsx' }, 'grep "useEffect" in *.tsx'],
    ['Grep', { pattern: 'x', type: 'py' }, 'grep "x" in *.py'],
    ['Glob', { pattern: 'src/**/*.ts' }, 'glob src/**/*.ts'],
    ['LS', { path: CWD }, 'ls .'],
    ['WebFetch', { url: 'https://docs.python.org/3/library/asyncio.html?x=1#top', prompt: 'p' }, 'Fetch docs.python.org/3/library/asyncio.html'],
    ['WebFetch', { url: 'not a url' }, 'Fetch not a url'],
    ['WebSearch', { query: 'vitest fake timers' }, 'Search the web for "vitest fake timers"'],
    ['TodoWrite', { todos: [{ status: 'completed' }, { status: 'pending' }] }, 'Todos: 1/2 done'],
    ['TodoWrite', { todos: [] }, 'Clear the todo list'],
    ['TaskCreate', { subject: 'Build it' }, 'New task: Build it'],
    ['TaskUpdate', { taskId: '3', status: 'in_progress' }, 'Task #3 → in progress'],
    ['TaskUpdate', { taskId: '3', owner: 'frontend' }, 'Task #3 → frontend'],
    ['Agent', { subagent_type: 'Explore', description: 'Find the expiry logic' }, 'Spawn Explore: Find the expiry logic'],
    ['Task', { subagent_type: 'Plan' }, 'Spawn Plan'],
    ['Agent', { name: 'frontend', subagent_type: 'general-purpose', description: 'UI' }, 'Spawn frontend: UI'],
    ['SendMessage', { to: 'backend', message: 'hi' }, 'Message backend'],
    ['SendMessage', { recipient: 'team-lead' }, 'Message team-lead'],
    ['Skill', { skill: 'pdf' }, 'Use skill pdf'],
    ['Skill', { command: 'review' }, 'Use skill review'],
    ['mcp__github__create_issue', { title: 'x' }, 'github: create_issue'],
    ['EnterWorktree', { name: 'spike' }, 'Enter worktree spike'],
    ['AskUserQuestion', {}, 'Ask you a question'],
    ['SomethingNew', {}, 'SomethingNew'],
  ];
  for (const [tool, input, text] of cases) {
    it(`${tool} → ${text}`, () => assert.equal(summarizeTool(tool, input, CWD), text));
  }

  it('shortens long paths and commands', () => {
    const deep = `${CWD}/packages/frontend/src/components/settings/forms/AdvancedSettingsForm.tsx`;
    const summary = summarizeTool('Read', { file_path: deep }, CWD);
    assert.equal(summary, 'Read …/forms/AdvancedSettingsForm.tsx');
    const command = summarizeTool('Bash', { command: `npx vitest run ${'test/very/long/path/'.repeat(5)}` });
    assert.ok(command.length <= 62, command);
    assert.ok(command.endsWith('…'));
    assert.equal(shortPath('C:\\Users\\sam\\code\\app\\src\\a.ts', 'C:\\Users\\sam\\code\\app'), 'src/a.ts');
    assert.equal(shortCommand('  echo   hi  '), 'echo hi');
    assert.equal(hostPath('https://example.com/'), 'example.com');
  });

  it('never throws and never returns an empty string', () => {
    for (const [tool, input] of [[undefined, undefined], ['', null], ['Read', 'x'], ['Bash', { command: 42 }], ['Grep', { pattern: null }]]) {
      const text = summarizeTool(tool, input);
      assert.equal(typeof text, 'string');
      assert.ok(text.length > 0);
    }
  });
});

describe('classifyCommand and classifyError', () => {
  it('recognises what a shell command does', () => {
    const table = [
      ['npm test', 'test'],
      ['npm run test:unit', 'test'],
      ['npx vitest run src/a.test.ts', 'test'],
      ['uv run pytest -q', 'test'],
      ['python -m pytest tests/', 'test'],
      ['go test ./...', 'test'],
      ['cargo test', 'test'],
      ['node --test test/', 'test'],
      ['npx playwright test e2e/a.spec.ts', 'test'],
      ['npm install zod', 'install'],
      ['pnpm i', 'install'],
      ['yarn add react', 'install'],
      ['bun install', 'install'],
      ['npm ci', 'install'],
      ['uv add httpx', 'deps'],
      ['pip install requests', 'deps'],
      ['git commit -m "fix npm test"', 'git-commit'],
      ['git add -A && git commit -m x && git push', 'git-push'],
      ['git push origin main', 'git-push'],
      ['rm -rf dist', 'rm-rf'],
      ['rm -fr node_modules', 'rm-rf'],
      ['rm -Rf build', 'rm-rf'],
      ['docker compose up -d', 'docker'],
      ['curl -s https://api.example.com', 'curl'],
      ['wget https://x', 'curl'],
      ['npm run build', 'build'],
      ['npx tsc --noEmit', 'build'],
      ['uv run ruff check .', 'lint'],
      ['npm run lint', 'lint'],
      ['ls -la', null],
      ['', null],
    ];
    for (const [command, kind] of table) assert.equal(classifyCommand(command), kind, command);
  });

  it('says why a tool failed', () => {
    assert.equal(classifyError('anything', true, null), 'interrupted');
    assert.equal(classifyError('Command timed out after 2m', false, 'test'), 'timeout');
    assert.equal(classifyError('Exit code 1', false, 'test'), 'tests');
    assert.equal(classifyError('EACCES: permission denied', false, null), 'permission');
    assert.equal(classifyError('File does not exist.', false, null), 'notfound');
    assert.equal(classifyError('ENOENT: no such file', false, null), 'notfound');
    assert.equal(classifyError('Exit code 2', false, null), 'generic');
  });
});

describe('andary doctor probes', () => {
  it('leave no trace in the town: no crew, no log entry, no achievement', () => {
    const probe = { session_id: 'andary-doctor-1b2c', cwd: CWD, hook_event_name: 'Notification', notification_type: 'andary_doctor', message: 'probe' };
    assert.deepEqual(normalize(envelope(probe)), []);
    assert.deepEqual(normalize(envelope({ ...probe, hook_event_name: 'SessionEnd', reason: 'other' })), []);
    assert.ok(normalize(envelope({ ...probe, session_id: SESSION })).length > 0, 'ordinary sessions still count');
  });
});
