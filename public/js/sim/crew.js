// One simulated Claude Code session. It builds hook payloads shaped exactly like CONTRACTS.md §4.2
// and offers the moves a script needs: read a file, run a command, spawn helpers, run a team, …
// The lead agent is `null`; subagents and teammates are SimAgent handles.

import { HOME } from './corpus.js';

/**
 * @typedef {object} SimAgent
 * @property {string} id
 * @property {string} type
 * @property {string|null} name
 */

/**
 * What every crew of one simulation shares (built in simulation.js).
 * @typedef {object} SimRuntime
 * @property {import('./random.js').Random} rng
 * @property {(ms: number) => Promise<void>} sleep          story milliseconds
 * @property {(payload: Record<string, any>) => Promise<unknown>} send
 * @property {(payload: Record<string, any>) => Promise<'allow'|'deny'|'none'>} ask
 * @property {{helpers: number}} census                      live subagents + teammates, all crews
 */

/**
 * @typedef {object} HelperSpec
 * @property {string} type          subagent_type
 * @property {string} description
 * @property {string} prompt
 * @property {string} result        the helper's last message
 * @property {(agent: SimAgent) => Promise<void>} work
 * @property {string} [name]
 * @property {string} [model]
 * @property {'worktree'} [isolation]
 */

/**
 * @typedef {object} ToolOptions
 * @property {unknown} [response]   tool_response for PostToolUse (a plausible default otherwise)
 * @property {string} [error]       makes the call fail with PostToolUseFailure
 * @property {number} [duration]    story ms the tool runs
 * @property {boolean} [permission] ask for permission first
 */

/** @typedef {{ok: boolean, denied: boolean}} ToolResult */

const GERUNDS = Object.freeze({
  Add: 'Adding',
  Commit: 'Committing',
  Find: 'Finding',
  Fix: 'Fixing',
  Plan: 'Planning',
  Reproduce: 'Reproducing',
  Review: 'Reviewing',
  Run: 'Running',
  Update: 'Updating',
  Write: 'Writing',
  Understand: 'Understanding',
  Implement: 'Implementing',
  Read: 'Reading',
});

/** "Run the suite" → "Running the suite", for TodoWrite's activeForm. @param {string} content */
function activeForm(content) {
  const [verb, ...rest] = content.split(' ');
  const gerund = Object.hasOwn(GERUNDS, verb) ? GERUNDS[/** @type {keyof typeof GERUNDS} */ (verb)] : null;
  return gerund ? [gerund, ...rest].join(' ') : `Working on: ${content}`;
}

/** @param {string} path */
function fileSnippet(path) {
  const name = path.split('/').pop() ?? path;
  if (name.endsWith('.py')) return `"""${name}"""\nfrom __future__ import annotations\n\n# …`;
  if (name.endsWith('.md')) return `# ${name.replace(/\.md$/, '')}\n\n…`;
  if (/\.(ya?ml|json|toml)$/.test(name)) return '# configuration\n…';
  return `// ${name}\nexport {};\n// …`;
}

/** Plausible tool_response shapes, by tool. */
/** @type {Readonly<Record<string, (input: Record<string, any>) => unknown>>} */
const RESPONSES = Object.freeze({
  Read: (i) => ({
    type: 'text',
    file: { filePath: i.file_path, content: fileSnippet(i.file_path), numLines: 3, startLine: 1, totalLines: 120 },
  }),
  Edit: (i) => ({ filePath: i.file_path, oldString: i.old_string, newString: i.new_string, structuredPatch: [], userModified: false, replaceAll: false }),
  Write: (i) => ({ type: 'create', filePath: i.file_path, content: i.content, structuredPatch: [] }),
  Bash: () => ({ stdout: '', stderr: '', interrupted: false, isImage: false }),
  Grep: () => ({ mode: 'files_with_matches', filenames: [], numFiles: 0 }),
  Glob: () => ({ filenames: [], durationMs: 12, numFiles: 0, truncated: false }),
  WebSearch: (i) => ({ query: i.query, results: [], durationSeconds: 1.4 }),
  WebFetch: (i) => ({ bytes: 48213, code: 200, codeText: 'OK', result: 'Summary of the page.', durationMs: 900, url: i.url }),
  TodoWrite: (i) => ({ oldTodos: [], newTodos: i.todos }),
  TaskUpdate: (i) => ({ success: true, taskId: i.taskId, updatedFields: Object.keys(i).filter((k) => k !== 'taskId') }),
  TaskList: () => ({ tasks: [] }),
  SendMessage: (i) => ({ success: true, message: `Message sent to ${i.to}'s inbox` }),
  Skill: (i) => ({ success: true, commandName: i.skill }),
});

export class Crew {
  /**
   * @param {SimRuntime} sim
   * @param {import('./corpus.js').Project} project
   * @param {{model: string, permissionMode?: string, member?: string}} options  member: a teammate's crew in a team town
   */
  constructor(sim, project, options) {
    this.sim = sim;
    this.rng = sim.rng;
    this.project = project;
    this.sessionId = sim.rng.uuid();
    this.cwd = `${HOME}/code/${project.name}`;
    this.transcriptPath = `${HOME}/.claude/projects/${this.cwd.replace(/[/.]/g, '-')}/${this.sessionId}.jsonl`;
    this.model = options.model;
    this.permissionMode = options.permissionMode ?? 'default';
    /** In a team town the host's server tags a teammate's events with their name (CONTRACTS §4.11). */
    this.member = options.member ?? null;
    this.taskSeq = 0;
    /** @type {Map<string, number>} tool calls per helper, for the Agent tool's response */
    this.toolCalls = new Map();
  }

  /** @param {string} rel */
  path(rel) {
    return `${this.cwd}/${rel}`;
  }

  /** @param {SimAgent} agent */
  agentTranscript(agent) {
    return this.transcriptPath.replace(/\.jsonl$/, `/subagents/agent-${agent.id}.jsonl`);
  }

  /**
   * The fields every hook payload carries, plus agent_id/agent_type inside a helper.
   * @param {string} event
   * @param {SimAgent|null} agent
   */
  base(event, agent) {
    /** @type {Record<string, any>} */
    const payload = {
      session_id: this.sessionId,
      transcript_path: this.transcriptPath,
      cwd: this.cwd,
      permission_mode: this.permissionMode,
      hook_event_name: event,
    };
    if (agent) {
      payload.agent_id = agent.id;
      payload.agent_type = agent.type;
    }
    if (this.member) payload.andary_member = this.member;
    return payload;
  }

  /**
   * @param {string} event
   * @param {SimAgent|null} agent
   * @param {Record<string, any>} [extra]
   */
  emit(event, agent, extra = {}) {
    return this.sim.send({ ...this.base(event, agent), ...extra });
  }

  /** A pause between moves, in seconds (0.6–4 s by default). @param {number} [min] @param {number} [max] */
  think(min = 0.6, max = 4) {
    return this.sim.sleep(this.rng.float(min, max) * 1000);
  }

  // Session lifecycle -----------------------------------------------------------------------

  /** @param {string} [source] */
  start(source = 'startup') {
    return this.emit('SessionStart', null, { source, model: this.model });
  }

  /** @param {string} [reason] */
  end(reason = 'prompt_input_exit') {
    return this.emit('SessionEnd', null, { reason });
  }

  /** @param {string} text */
  prompt(text) {
    return this.emit('UserPromptSubmit', null, { prompt: text });
  }

  /** @param {string} message @param {SimAgent|null} [agent] */
  stop(message, agent = null) {
    return this.emit('Stop', agent, { last_assistant_message: message, stop_hook_active: false, background_tasks: [], session_crons: [] });
  }

  /** @param {string} error @param {string} details @param {string} [message] */
  stopFailure(error, details, message = '') {
    return this.emit('StopFailure', null, { error, error_details: details, last_assistant_message: message });
  }

  /** @param {string} type @param {string} message @param {SimAgent|null} [agent] */
  notify(type, message, agent = null) {
    return this.emit('Notification', agent, { message, title: 'Claude Code', notification_type: type });
  }

  /** PreCompact, a while in the spa, PostCompact, then the session restarts from the summary. */
  async compact(trigger = 'auto') {
    await this.emit('PreCompact', null, { trigger, custom_instructions: '' });
    await this.sim.sleep(this.rng.int(5000, 9000));
    const summary = `Working on ${this.project.name}: goal, files touched so far, decisions made and open todos.`;
    await this.emit('PostCompact', null, { trigger, compact_summary: summary });
    await this.emit('SessionStart', null, { source: 'compact', model: this.model });
  }

  /** @param {string} to @param {string} requested */
  switchModel(to, requested) {
    const from = this.model;
    this.model = to;
    return this.emit('PostModelSwitch', null, { from_model: from, to_model: to, requested_model: requested, source: 'user' });
  }

  // Tools ----------------------------------------------------------------------------------

  /**
   * One tool call: PreToolUse, optionally a permission round-trip, the tool's run time, then
   * PostToolUse or PostToolUseFailure.
   * @param {SimAgent|null} agent
   * @param {string} name
   * @param {Record<string, any>} input
   * @param {ToolOptions} [options]
   * @returns {Promise<ToolResult>}
   */
  async tool(agent, name, input, options = {}) {
    const call = { tool_name: name, tool_input: input, tool_use_id: this.rng.toolUseId() };
    const mcp = name.startsWith('mcp__') ? { mcp_server: name.split('__')[1] } : {};
    if (agent) this.toolCalls.set(agent.id, (this.toolCalls.get(agent.id) ?? 0) + 1);
    await this.emit('PreToolUse', agent, { ...call, ...mcp });
    if (options.permission && (await this.askPermission(agent, name, input)) === 'deny') return { ok: false, denied: true };
    const duration = options.duration ?? this.rng.int(150, 1400);
    await this.sim.sleep(duration);
    if (options.error) {
      await this.emit('PostToolUseFailure', agent, { ...call, error: options.error, is_interrupt: false, duration_ms: duration });
      return { ok: false, denied: false };
    }
    const respond = Object.hasOwn(RESPONSES, name) ? RESPONSES[name] : null;
    const response = options.response ?? (respond ? respond(input) : [{ type: 'text', text: 'OK' }]);
    await this.emit('PostToolUse', agent, { ...call, tool_response: response, duration_ms: duration });
    return { ok: true, denied: false };
  }

  /**
   * PermissionRequest carries no tool_use_id. Without a decision from the town the terminal
   * asks instead (Notification), and the simulated user approves there after a moment.
   * @param {SimAgent|null} agent
   * @param {string} name
   * @param {Record<string, any>} input
   */
  async askPermission(agent, name, input) {
    const rule = name === 'Bash' ? input.command : name;
    const decision = await this.sim.ask({
      ...this.base('PermissionRequest', agent),
      tool_name: name,
      tool_input: input,
      permission_suggestions: [{ type: 'addRules', rules: [{ toolName: name, ruleContent: rule }], behavior: 'allow', destination: 'localSettings' }],
    });
    if (decision !== 'none') return decision;
    await this.notify('permission_prompt', `Claude needs your permission to use ${name}`, agent);
    await this.think(1.5, 4);
    return 'allow';
  }

  /**
   * Auto mode's classifier refuses a tool call: PreToolUse, then PermissionDenied, and the tool
   * never runs.
   * @param {SimAgent|null} agent
   * @param {string} name
   * @param {Record<string, any>} input
   * @param {string} reason
   */
  async refused(agent, name, input, reason) {
    const call = { tool_name: name, tool_input: input, tool_use_id: this.rng.toolUseId() };
    await this.emit('PreToolUse', agent, call);
    await this.sim.sleep(this.rng.int(150, 500));
    await this.emit('PermissionDenied', agent, { ...call, reason });
  }

  /** @param {SimAgent|null} agent @param {string} rel @param {ToolOptions} [options] */
  read(agent, rel, options) {
    return this.tool(agent, 'Read', { file_path: this.path(rel) }, options);
  }

  /** @param {SimAgent|null} agent @param {string} rel @param {string} before @param {string} after */
  edit(agent, rel, before, after) {
    return this.tool(agent, 'Edit', { file_path: this.path(rel), old_string: before, new_string: after, replace_all: false });
  }

  /** @param {SimAgent|null} agent @param {string} rel @param {string} content */
  write(agent, rel, content) {
    return this.tool(agent, 'Write', { file_path: this.path(rel), content });
  }

  /** @param {SimAgent|null} agent @param {string} pattern @param {string} [rel] */
  grep(agent, pattern, rel) {
    const input = rel ? { pattern, path: this.path(rel), output_mode: 'files_with_matches' } : { pattern, output_mode: 'files_with_matches' };
    return this.tool(agent, 'Grep', input, { duration: this.rng.int(80, 600) });
  }

  /** @param {SimAgent|null} agent @param {string} pattern */
  glob(agent, pattern) {
    return this.tool(agent, 'Glob', { pattern }, { duration: this.rng.int(40, 300) });
  }

  /**
   * @param {SimAgent|null} agent
   * @param {string} command
   * @param {{description?: string, fail?: string, stdout?: string, duration?: number, permission?: boolean}} [options]
   */
  bash(agent, command, options = {}) {
    const input = options.description ? { command, description: options.description } : { command };
    return this.tool(agent, 'Bash', input, {
      error: options.fail,
      duration: options.duration,
      permission: options.permission,
      response: { stdout: options.stdout ?? '', stderr: '', interrupted: false, isImage: false },
    });
  }

  /** @param {SimAgent|null} agent @param {[string, 'pending'|'in_progress'|'completed'][]} items */
  todos(agent, items) {
    const todos = items.map(([content, status]) => ({ content, status, activeForm: activeForm(content) }));
    return this.tool(agent, 'TodoWrite', { todos }, { duration: this.rng.int(40, 160) });
  }

  /** @param {SimAgent|null} agent @param {string} query */
  webSearch(agent, query) {
    return this.tool(agent, 'WebSearch', { query }, { duration: this.rng.int(1200, 3000) });
  }

  /** @param {SimAgent|null} agent @param {string} url @param {string} prompt */
  webFetch(agent, url, prompt) {
    return this.tool(agent, 'WebFetch', { url, prompt }, { duration: this.rng.int(900, 2500) });
  }

  /**
   * @param {SimAgent|null} agent
   * @param {string} server
   * @param {string} name
   * @param {Record<string, any>} input
   * @param {string} text
   */
  mcp(agent, server, name, input, text) {
    return this.tool(agent, `mcp__${server}__${name}`, input, { response: [{ type: 'text', text }], duration: this.rng.int(500, 1800) });
  }

  /** @param {SimAgent|null} agent @param {string} name */
  skill(agent, name) {
    return this.tool(agent, 'Skill', { skill: name }, { duration: this.rng.int(200, 600) });
  }

  /**
   * @param {SimAgent|null} agent
   * @param {string} to
   * @param {string|Record<string, any>} message
   * @param {string} [summary]
   */
  message(agent, to, message, summary) {
    return this.tool(agent, 'SendMessage', summary ? { to, message, summary } : { to, message }, { duration: this.rng.int(60, 200) });
  }

  // Shared tasks (agent teams) -------------------------------------------------------------

  /** TaskCreate fires TaskCreated between its Pre and Post hooks. @param {SimAgent|null} agent @param {string} subject @param {string} description */
  async taskCreate(agent, subject, description) {
    this.taskSeq += 1;
    const id = String(this.taskSeq);
    const call = { tool_name: 'TaskCreate', tool_input: { subject, description, activeForm: activeForm(subject) }, tool_use_id: this.rng.toolUseId() };
    await this.emit('PreToolUse', agent, call);
    await this.sim.sleep(this.rng.int(60, 200));
    await this.emit('TaskCreated', agent, { task_id: id, task_subject: subject, task_description: description, ...(agent?.name ? { teammate_name: agent.name } : {}) });
    await this.emit('PostToolUse', agent, { ...call, tool_response: { task: { id, subject } }, duration_ms: this.rng.int(60, 200) });
    return id;
  }

  /** @param {SimAgent|null} agent @param {string} taskId @param {Record<string, string>} patch */
  taskUpdate(agent, taskId, patch) {
    return this.tool(agent, 'TaskUpdate', { taskId, ...patch }, { duration: this.rng.int(40, 160) });
  }

  /** A teammate marks its task done: TaskUpdate with TaskCompleted in between. @param {SimAgent} agent @param {string} taskId @param {string} subject */
  async taskComplete(agent, taskId, subject) {
    const call = { tool_name: 'TaskUpdate', tool_input: { taskId, status: 'completed' }, tool_use_id: this.rng.toolUseId() };
    await this.emit('PreToolUse', agent, call);
    await this.sim.sleep(this.rng.int(60, 200));
    await this.emit('TaskCompleted', agent, { task_id: taskId, task_subject: subject, teammate_name: agent.name ?? agent.type });
    const response = { success: true, taskId, updatedFields: ['status'] };
    await this.emit('PostToolUse', agent, { ...call, tool_response: response, duration_ms: this.rng.int(60, 200) });
  }

  /** @param {SimAgent} agent */
  teammateIdle(agent) {
    return this.emit('TeammateIdle', agent, { teammate_name: agent.name ?? agent.type });
  }

  // Helpers --------------------------------------------------------------------------------

  /** @param {HelperSpec} spec */
  spawn(spec) {
    return this.spawnMany([spec]);
  }

  /**
   * Several Agent calls in one message: every PreToolUse first, then the helpers work in
   * parallel; each one's PostToolUse arrives when it finishes.
   * @param {HelperSpec[]} specs
   */
  async spawnMany(specs) {
    const launches = [];
    for (const spec of specs) {
      const input = {
        description: spec.description,
        prompt: spec.prompt,
        subagent_type: spec.type,
        ...(spec.name ? { name: spec.name } : {}),
        ...(spec.model ? { model: spec.model } : {}),
        ...(spec.isolation ? { isolation: spec.isolation } : {}),
      };
      const call = { tool_name: 'Agent', tool_input: input, tool_use_id: this.rng.toolUseId() };
      await this.emit('PreToolUse', null, call);
      launches.push({ spec, call, agent: { id: this.rng.agentId(), type: spec.type, name: spec.name ?? null } });
    }
    await Promise.all(launches.map((launch, i) => this.runHelper(launch, i)));
  }

  /**
   * @param {{spec: HelperSpec, call: Record<string, any>, agent: SimAgent}} launch
   * @param {number} index  staggers parallel helpers so they start in spawn order
   */
  async runHelper({ spec, call, agent }, index) {
    await this.sim.sleep(250 + index * 350);
    this.sim.census.helpers += 1;
    await this.emit('SubagentStart', agent);
    await spec.work(agent);
    await this.think(0.4, 1.2);
    await this.emit('SubagentStop', agent, { agent_transcript_path: this.agentTranscript(agent), last_assistant_message: spec.result, stop_hook_active: false });
    this.sim.census.helpers -= 1;
    await this.sim.sleep(this.rng.int(120, 400));
    const response = {
      status: 'completed',
      agentId: agent.id,
      content: [{ type: 'text', text: spec.result }],
      totalTokens: this.rng.int(9000, 64000),
      totalDurationMs: this.rng.int(20000, 140000),
      totalToolUseCount: this.toolCalls.get(agent.id) ?? 0,
    };
    await this.emit('PostToolUse', null, { ...call, tool_response: response, duration_ms: response.totalDurationMs });
  }

  /**
   * A named teammate: spawned in the background, so the Agent call returns at once.
   * @param {{name: string, description: string, prompt: string}} spec
   * @returns {Promise<SimAgent>}
   */
  async launchTeammate(spec) {
    const input = { description: spec.description, prompt: spec.prompt, subagent_type: 'general-purpose', name: spec.name, run_in_background: true };
    const call = { tool_name: 'Agent', tool_input: input, tool_use_id: this.rng.toolUseId() };
    await this.emit('PreToolUse', null, call);
    const agent = { id: this.rng.agentId(), type: 'general-purpose', name: spec.name };
    await this.sim.sleep(this.rng.int(200, 500));
    this.sim.census.helpers += 1;
    await this.emit('SubagentStart', agent);
    await this.sim.sleep(this.rng.int(80, 240));
    const response = { status: 'async_launched', agentId: agent.id, name: spec.name, description: spec.description };
    await this.emit('PostToolUse', null, { ...call, tool_response: response, duration_ms: this.rng.int(300, 700) });
    return agent;
  }

  /** @param {SimAgent} agent @param {string} message */
  async retire(agent, message) {
    await this.emit('SubagentStop', agent, { agent_transcript_path: this.agentTranscript(agent), last_assistant_message: message, stop_hook_active: false });
    this.sim.census.helpers -= 1;
  }
}
