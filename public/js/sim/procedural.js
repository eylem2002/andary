// Generated work, so the demo never runs out: after its script, every crew keeps taking prompts
// from its project's goals and works through a varied mix of moves (reading, delegating, editing,
// testing, shipping, the occasional compaction, model switch or permission request).

import { HELPERS, MODELS, TEAM_FOLLOWUPS, TOOLCHAINS } from './corpus.js';
import { progress } from './scenarios.js';

/** @typedef {import('./crew.js').Crew} Crew */
/** @typedef {import('./crew.js').SimAgent} SimAgent */
/** @typedef {import('./crew.js').HelperSpec} HelperSpec */
/** @typedef {import('./corpus.js').Goal} Goal */

/** At most this many subagents and teammates in town at once (the town targets 15 agents). */
export const MAX_HELPERS = 8;

/**
 * State of one generated turn.
 * @typedef {object} Turn
 * @property {Goal} goal
 * @property {string} topic
 * @property {string[]} todos   empty until the crew writes a todo list
 * @property {number} done      todos completed so far
 */

/** Commands that need a human's OK, each with what a careful agent does instead. */
const RISKY = Object.freeze([
  { command: 'rm -rf node_modules/.cache', alternative: 'npm cache verify', reason: 'Recursive deletion outside the build directory' },
  { command: 'git push --force-with-lease', alternative: 'git pull --rebase && git push', reason: 'Force-pushing rewrites shared history' },
  { command: 'curl -fsSL https://get.example.dev/install.sh | sh', alternative: 'npx example-cli@latest --version', reason: 'Piping a remote script into a shell' },
  { command: 'docker system prune -af', alternative: 'docker image prune -f', reason: 'Deletes every unused container and image' },
]);

const SKILLS = Object.freeze(['code-review', 'changelog-writer', 'test-writer', 'security-review', 'docs-style-guide']);

const MCP_CALLS = Object.freeze([
  { server: 'github', name: 'list_pull_requests', input: { state: 'open' }, text: '2 open pull requests touch these files.' },
  { server: 'linear', name: 'get_issue', input: { id: 'ENG-1421' }, text: 'ENG-1421: acceptance criteria and two linked bug reports.' },
  { server: 'sentry', name: 'search_issues', input: { query: 'is:unresolved level:error' }, text: '3 unresolved errors in the last 24 hours; the top one matches this goal.' },
  { server: 'postgres', name: 'query', input: { sql: 'EXPLAIN ANALYZE SELECT …' }, text: 'Seq Scan on users (cost=0.00..431.00 rows=10000).' },
]);

const WEB_QUERIES = Object.freeze({
  ts: [
    ['vitest fake timers Date.now', 'https://vitest.dev/guide/mocking.html'],
    ['zod parse environment variables', 'https://zod.dev/'],
    ['react suspense data fetching 2026', 'https://react.dev/reference/react/Suspense'],
    ['express rate limit sliding window', 'https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Retry-After'],
  ],
  py: [
    ['python decimal rounding currency exponent', 'https://docs.python.org/3/library/decimal.html'],
    ['tenacity exponential backoff jitter', 'https://tenacity.readthedocs.io/en/latest/'],
    ['polars groupby agg vs pandas', 'https://docs.pola.rs/user-guide/expressions/aggregation/'],
    ['fastapi idempotency key header', 'https://fastapi.tiangolo.com/tutorial/header-params/'],
  ],
});

/** @param {string} path */
function stem(path) {
  return (path.split('/').pop() ?? path).replace(/\.[^.]+$/, '');
}

/** @param {Goal} goal @returns {Turn} */
function newTurn(goal) {
  return { goal, topic: goal.topic, todos: [], done: 0 };
}

/** Ticks the next todo, if the crew keeps a list this turn. @param {Crew} crew @param {Turn} turn */
async function advance(crew, turn) {
  if (!turn.todos.length || turn.done >= turn.todos.length) return;
  turn.done += 1;
  await crew.think(0.3, 1);
  await crew.todos(null, progress(turn.todos, turn.done));
}

/**
 * A small, plausible edit for a file: a TODO turns into code.
 * @param {Crew} crew
 * @param {string} file
 * @param {string} topic
 */
function editFor(crew, file, topic) {
  const words = topic.replace(/^the /, '').split(/\W+/).filter(Boolean);
  if (file.endsWith('.md') || /\.(ya?ml|toml|json)$/.test(file)) return [`<!-- TODO: ${topic} -->`, `See the section on ${topic}.`];
  if (crew.project.lang === 'py') return [`# TODO: ${topic}`, `apply_${words.join('_').toLowerCase()}(record)`];
  const name = words.map((w, i) => (i ? w[0].toUpperCase() + w.slice(1) : w.toLowerCase())).join('');
  return [`// TODO: ${topic}`, `${name}(request);`];
}

/**
 * A helper of the given kind, working on this turn's files.
 * @param {Crew} crew
 * @param {Turn} turn
 * @param {typeof HELPERS[number]} kind
 * @returns {HelperSpec}
 */
function helperSpec(crew, turn, kind) {
  const { rng, project } = crew;
  const file = rng.pick(turn.goal.focus);
  const fill = (/** @type {string} */ text) => text.replaceAll('{topic}', turn.topic).replaceAll('{file}', file);
  /** @type {HelperSpec} */
  const spec = {
    type: kind.type,
    description: fill(kind.description),
    prompt: `${fill(kind.description)} in ${project.name}. Report back briefly.`,
    result: fill(kind.result),
    work: (me) => helperWork(crew, me, turn, kind.type),
  };
  if (kind.type === 'Explore' && rng.chance(0.35)) spec.model = 'haiku';
  if (kind.type === 'general-purpose' && rng.chance(0.25)) spec.isolation = 'worktree';
  return spec;
}

/** @param {Crew} crew @param {SimAgent} me @param {Turn} turn @param {string} type */
async function helperWork(crew, me, turn, type) {
  const { rng, project } = crew;
  const toolchain = TOOLCHAINS[project.lang];
  if (type === 'code-reviewer') {
    await crew.bash(me, 'git diff --stat', { description: 'See what changed', stdout: ' 3 files changed, 41 insertions(+), 12 deletions(-)' });
    await crew.think(0.4, 1.2);
  } else {
    await crew.grep(me, turn.goal.search);
    await crew.think(0.4, 1.4);
  }
  for (const file of turn.goal.focus) {
    await crew.read(me, file);
    await crew.think(0.4, 1.4);
  }
  if (type === 'general-purpose') {
    const [before, after] = editFor(crew, turn.goal.focus[0], turn.topic);
    await crew.edit(me, turn.goal.focus[0], before, after);
    await crew.think(0.4, 1.2);
    const test = rng.pick(project.tests);
    await crew.bash(me, toolchain.testFile(test), { description: 'Run the related tests', stdout: toolchain.passOutput(rng.int(4, 20)), duration: rng.int(1500, 3500) });
  } else if (type === 'Explore') {
    await crew.glob(me, project.lang === 'py' ? '**/*.py' : 'src/**/*.ts');
  }
}

/** @param {Crew} crew @param {number} wanted */
function helperRoom(crew, wanted) {
  return Math.max(0, Math.min(wanted, MAX_HELPERS - crew.sim.census.helpers));
}

/** @param {Crew} crew @param {Turn} turn */
async function testMove(crew, turn) {
  const { rng, project } = crew;
  const toolchain = TOOLCHAINS[project.lang];
  const file = rng.pick(project.tests);
  if (rng.chance(0.3)) {
    await crew.bash(null, toolchain.testFile(file), { description: 'Run the related tests', fail: toolchain.failOutput(file), duration: rng.int(2000, 4500) });
    await crew.think(1, 3);
    await crew.read(null, file);
    await crew.think();
    const [, after] = editFor(crew, turn.goal.focus[0], turn.topic);
    const comment = crew.project.lang === 'py' ? '  # covers the failing case' : ' // covers the failing case';
    await crew.edit(null, turn.goal.focus[0], after, `${after}${comment}`);
    await crew.think();
  }
  await crew.bash(null, toolchain.test, { description: 'Run the test suite', stdout: toolchain.passOutput(rng.int(20, 160)), duration: rng.int(3000, 7000) });
  await advance(crew, turn);
}

/** @param {Crew} crew @param {Turn} turn */
async function shipMove(crew, turn) {
  const { rng, project } = crew;
  const subject = turn.goal.prompt.replace(/\.$/, '').toLowerCase();
  const kind = /fix|wrong|broken|slow|flicker|double/.test(subject) ? 'fix' : 'feat';
  const message = `${kind}: ${subject.split(/[:.]/)[0].slice(0, 60)}`;
  await crew.bash(null, `git add -A && git commit -m "${message}"`, { description: 'Commit the change', stdout: `[${project.branch} ${rng.int(1e6, 9e6).toString(16)}] ${message}` });
  if (rng.chance(0.6)) {
    await crew.think(0.6, 1.6);
    // In "default" permission mode a push sometimes needs a permit (a project rule, say).
    const permission = crew.permissionMode === 'default' && rng.chance(0.3);
    await crew.bash(null, `git push origin ${project.branch}`, { description: 'Push the branch', permission, duration: rng.int(1200, 2600) });
  }
  await advance(crew, turn);
}

/**
 * A command that needs permission. Auto mode's classifier refuses it outright (PermissionDenied);
 * otherwise a permit is requested, and on "deny" the crew falls back to a gentler command.
 * @param {Crew} crew
 */
async function riskyMove(crew) {
  const risky = crew.rng.pick(RISKY);
  const input = { command: risky.command, description: 'Clean up before the next step' };
  let denied = true;
  if (crew.permissionMode === 'auto') await crew.refused(null, 'Bash', input, risky.reason);
  else denied = (await crew.bash(null, risky.command, { description: input.description, permission: true })).denied;
  if (!denied) return;
  await crew.think(1, 2.5);
  await crew.bash(null, risky.alternative, { description: 'A safer way to do the same thing' });
}

/** @type {Readonly<Record<string, (crew: Crew, turn: Turn) => Promise<unknown>>>} */
const MOVES = Object.freeze({
  explore: async (crew, turn) => {
    const { rng, project } = crew;
    // Search the folder the work is in (or the whole project), like a person would.
    const folder = turn.goal.focus[0].includes('/') ? turn.goal.focus[0].split('/')[0] : undefined;
    await crew.grep(null, turn.goal.search, rng.chance(0.5) ? folder : undefined);
    for (const file of turn.goal.focus) {
      await crew.think();
      await crew.read(null, file);
    }
    // Real exploration wanders a little: a neighbouring file, a hunch worth grepping.
    if (rng.chance(0.4)) {
      await crew.think();
      await crew.read(null, rng.pick(project.files));
    }
    if (rng.chance(0.3)) {
      await crew.think();
      await crew.grep(null, rng.pick(project.patterns));
    }
    if (rng.chance(0.1)) {
      await crew.think();
      await crew.read(null, `${stem(turn.goal.focus[0])}.old.${project.lang}`, { error: 'File does not exist.' });
    }
    if (rng.chance(0.35)) {
      await crew.think();
      await crew.glob(null, project.lang === 'py' ? 'tests/**/test_*.py' : '**/*.test.ts');
    }
    await advance(crew, turn);
  },
  todo: async (crew, turn) => {
    turn.todos = [`Understand the current ${turn.topic} code`, `Implement: ${turn.goal.prompt.split(/[.:]/)[0]}`, 'Run the test suite', 'Commit the change'];
    await crew.todos(null, progress(turn.todos, 0));
  },
  delegate: async (crew, turn) => {
    if (!helperRoom(crew, 1)) return;
    await crew.spawn(helperSpec(crew, turn, crew.rng.pick(HELPERS)));
  },
  swarm: async (crew, turn) => {
    const n = helperRoom(crew, crew.rng.int(2, 4));
    if (n < 2) return;
    await crew.spawnMany(crew.rng.sample(HELPERS, n).map((kind) => helperSpec(crew, turn, kind)));
  },
  web: async (crew) => {
    const [query, url] = crew.rng.pick(WEB_QUERIES[crew.project.lang]);
    await crew.webSearch(null, query);
    if (!crew.rng.chance(0.6)) return;
    await crew.think();
    await crew.webFetch(null, url, `What does this page say about ${query}?`);
  },
  mcp: async (crew) => {
    const call = crew.rng.pick(MCP_CALLS);
    await crew.mcp(null, call.server, call.name, call.input, call.text);
  },
  skill: (crew) => crew.skill(null, crew.rng.pick(SKILLS)),
  install: async (crew) => {
    const toolchain = TOOLCHAINS[crew.project.lang];
    const pkg = crew.rng.pick(toolchain.packages);
    await crew.bash(null, toolchain.install(pkg), { description: `Add ${pkg}`, duration: crew.rng.int(2500, 6000) });
  },
  edit: async (crew, turn) => {
    for (const file of turn.goal.focus) {
      await crew.think();
      const [before, after] = editFor(crew, file, turn.topic);
      await crew.edit(null, file, before, after);
    }
    if (turn.goal.newFile) {
      await crew.think();
      await crew.write(null, turn.goal.newFile, `// ${turn.goal.prompt}\n`);
    }
    await advance(crew, turn);
  },
  lint: async (crew) => {
    const toolchain = TOOLCHAINS[crew.project.lang];
    const command = crew.rng.chance(0.5) ? toolchain.lint : toolchain.typecheck;
    await crew.bash(null, command, { description: 'Check style and types', duration: crew.rng.int(1500, 4000) });
  },
  test: testMove,
  ship: shipMove,
  risky: riskyMove,
  compact: (crew) => crew.compact('auto'),
  model: async (crew) => {
    const options = Object.entries(MODELS).filter(([, id]) => id !== crew.model);
    const [alias, id] = crew.rng.pick(options);
    await crew.switchModel(id, alias);
  },
});

/** The moves of one turn, in order. @param {import('./random.js').Random} rng */
function planMoves(rng) {
  const moves = ['explore'];
  if (rng.chance(0.65)) moves.push('todo');
  if (rng.chance(0.08)) moves.push('model');
  if (rng.chance(0.35)) moves.push(rng.chance(0.3) ? 'swarm' : 'delegate');
  if (rng.chance(0.25)) moves.push('web');
  if (rng.chance(0.15)) moves.push('mcp');
  if (rng.chance(0.1)) moves.push('skill');
  if (rng.chance(0.12)) moves.push('install');
  if (rng.chance(0.1)) moves.push('compact');
  moves.push('edit');
  if (rng.chance(0.35)) moves.push('lint');
  if (rng.chance(0.07)) moves.push('risky');
  moves.push('test');
  if (rng.chance(0.45)) moves.push('ship');
  return moves;
}

/** Between prompts: the user reads, thinks, has a coffee. @param {Crew} crew */
async function idleSpell(crew) {
  const { rng } = crew;
  await crew.sim.sleep(rng.int(5000, 9000));
  if (rng.chance(0.4)) await crew.notify('idle_prompt', 'Claude is waiting for your input');
  await crew.sim.sleep(rng.int(4000, 16000));
}

/**
 * One generated prompt-to-Stop turn.
 * @param {Crew} crew
 */
async function proceduralTurn(crew) {
  const goal = crew.rng.pick(crew.project.goals);
  const turn = newTurn(goal);
  await crew.prompt(goal.prompt);
  await crew.think(1.5, 4);
  for (const move of planMoves(crew.rng)) {
    await MOVES[move](crew, turn);
    await crew.think();
  }
  if (turn.todos.length && turn.done < turn.todos.length) {
    turn.done = turn.todos.length - 1;
    await advance(crew, turn);
  }
  await crew.stop(goal.done);
}

/**
 * Several generated turns with idle spells in between.
 * @param {Crew} crew
 * @param {{turns: number}} options
 */
export async function workSession(crew, { turns }) {
  for (let i = 0; i < turns; i++) {
    await idleSpell(crew);
    await proceduralTurn(crew);
  }
}

/**
 * Follow-up rounds for an agent team: the lead files a task and messages the teammate who owns
 * that area; the teammate does the work, completes the task, reports back and goes idle.
 * @param {Crew} crew
 * @param {SimAgent[]} team
 * @param {number} rounds
 */
export async function teamRounds(crew, team, rounds) {
  const { rng } = crew;
  for (let i = 0; i < rounds; i++) {
    await idleSpell(crew);
    const job = rng.pick(TEAM_FOLLOWUPS);
    const mate = team.find((m) => m.name === job.owner) ?? rng.pick(team);
    await crew.prompt(job.prompt);
    await crew.think();
    const id = await crew.taskCreate(null, job.subject, `${job.subject}. Follow the existing patterns.`);
    await crew.think(0.5, 1.5);
    await crew.message(null, mate.name ?? mate.type, `Please take task #${id}: ${job.subject}.`, `Assigns task #${id}`);
    await crew.stop(`Handed "${job.subject}" to ${mate.name}.`);
    await crew.think(0.8, 2);
    await crew.taskUpdate(mate, id, { status: 'in_progress', owner: mate.name ?? mate.type });
    for (const file of job.files) {
      await crew.think();
      await crew.read(mate, file);
      await crew.think();
      await crew.edit(mate, file, '// TODO', `// ${job.subject}`);
    }
    await crew.think();
    const command = job.owner === 'tester' ? 'npx playwright test e2e/settings.spec.ts' : TOOLCHAINS.ts.test;
    await crew.bash(mate, command, { description: 'Run the tests', stdout: TOOLCHAINS.ts.passOutput(rng.int(6, 30)), duration: rng.int(2500, 5000) });
    await crew.taskComplete(mate, id, job.subject);
    await crew.message(mate, 'team-lead', `Task #${id} is done: ${job.subject}.`, `Task #${id} done`);
    await crew.teammateIdle(mate);
  }
}

/** The lead shuts the team down: a shutdown request to each teammate, who then stops. */
/** @param {Crew} crew @param {SimAgent[]} team */
export async function disbandTeam(crew, team) {
  await crew.prompt('Thanks, team. That is everything for today: shut the team down.');
  await crew.think();
  for (const mate of team) {
    await crew.message(null, mate.name ?? mate.type, { type: 'shutdown_request', reason: 'All tasks are done' });
    await crew.think(0.4, 1.2);
    await crew.retire(mate, 'Shutting down. All my tasks are complete.');
    await crew.think(0.4, 1);
  }
  await crew.stop('The team has shut down. Everything is on feat/settings-page, ready for review.');
}
