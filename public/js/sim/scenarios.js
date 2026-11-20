// The three scripted stories the demo opens with (CONTRACTS.md §7). Each takes a Crew and plays
// one session from its first prompt to its last message; generated work takes over afterwards.

import { MODELS, TOOLCHAINS } from './corpus.js';

/** @typedef {import('./crew.js').Crew} Crew */
/** @typedef {import('./crew.js').SimAgent} SimAgent */
/** @typedef {import('./crew.js').HelperSpec} HelperSpec */

/**
 * A todo list where the first `done` items are completed and the next one is in progress.
 * @param {readonly string[]} items
 * @param {number} done
 * @returns {[string, 'pending'|'in_progress'|'completed'][]}
 */
export function progress(items, done) {
  return items.map((text, i) => [text, i < done ? 'completed' : i === done ? 'in_progress' : 'pending']);
}

/** A one-shot signal between teammates working in parallel. */
function signal() {
  /** @type {() => void} */
  let fire = () => {};
  const promise = new Promise((resolve) => {
    fire = () => resolve(undefined);
  });
  return { promise, fire };
}

// (a) api-server: fix a flaky login test -------------------------------------------------------

const API_TODOS = Object.freeze([
  'Reproduce the flaky login test',
  'Find the root cause',
  'Fix the expiry check',
  'Run the full test suite',
  'Commit and push the fix',
]);

/** @param {Crew} crew @returns {HelperSpec} */
function apiScout(crew) {
  return {
    type: 'Explore',
    description: 'Find the token expiry logic',
    prompt: 'Find where login tokens are created and where their expiry is checked. Report file paths and line numbers.',
    result:
      'Token expiry is checked in src/auth/tokens.ts:42 with Date.now(); session.ts reuses it. src/lib/clock.ts exists but nothing uses it. The test fakes timers only after the token is created, so the result depends on the wall clock.',
    work: async (me) => {
      await crew.grep(me, 'Date.now', 'src/auth');
      await crew.think(0.4, 1.5);
      await crew.read(me, 'src/auth/tokens.ts');
      await crew.think(0.4, 1.5);
      await crew.read(me, 'src/auth/session.ts');
      await crew.think(0.4, 1.2);
      await crew.glob(me, 'src/**/*clock*');
      await crew.read(me, 'src/lib/clock.ts');
    },
  };
}

/** Sometimes the lead sends a whole squad: the scout plus two to four more helpers. */
/** @param {Crew} crew @returns {HelperSpec[]} */
function apiSquad(crew) {
  /** @type {HelperSpec[]} */
  const extras = [
    {
      type: 'Explore',
      description: 'Look for other time-dependent tests',
      prompt: 'List tests that depend on the current time or on timers.',
      model: 'haiku',
      result: 'Three other tests read the real clock: session.test.ts (2) and users.test.ts (1). None of them fail today.',
      work: async (me) => {
        await crew.grep(me, 'Date.now|setTimeout|useFakeTimers', 'test');
        await crew.think(0.4, 1.2);
        await crew.read(me, 'test/auth/session.test.ts');
      },
    },
    {
      type: 'Explore',
      description: 'Check how CI runs the tests',
      prompt: 'Read the CI workflow and report how tests run (parallelism, time zone, retries).',
      result: 'CI runs vitest with 4 threads in UTC and no retries; local runs use your time zone, which hides the bug.',
      work: async (me) => {
        await crew.read(me, '.github/workflows/ci.yml');
        await crew.think(0.4, 1.2);
        await crew.read(me, 'vitest.config.ts');
      },
    },
    {
      type: 'Plan',
      description: 'Plan a deterministic clock',
      prompt: 'Propose the smallest change that makes token expiry testable with a fixed clock.',
      result: 'Plan: export a clock from src/lib/clock.ts, inject it into tokens.ts, and give the login test a fixed clock.',
      work: async (me) => {
        await crew.read(me, 'src/lib/clock.ts');
        await crew.think(0.4, 1.2);
        await crew.grep(me, 'clock', 'src');
      },
    },
    {
      type: 'general-purpose',
      description: 'Review the session store',
      prompt: 'Check whether the session store has the same expiry bug.',
      result: 'The session store compares expiresAt with the database clock, so it is not affected.',
      work: async (me) => {
        await crew.read(me, 'src/auth/session.ts');
        await crew.think(0.4, 1.2);
        await crew.read(me, 'src/db/users.ts');
      },
    },
  ];
  return [apiScout(crew), ...crew.rng.sample(extras, crew.rng.int(2, 4))];
}

/**
 * (a) "api-server": a prompt, reading and grepping, a todo list, an Explore scout (or a squad of
 * 3–5 parallel helpers), edits, a failing test run then a passing one, commit, push, done.
 * @param {Crew} crew
 */
export async function apiServerScenario(crew) {
  const { rng } = crew;
  await crew.start();
  await crew.think(1.5, 3);
  await crew.prompt('The login test in test/auth/login.test.ts fails randomly in CI. Find out why and fix it.');
  await crew.think(1.5, 3);
  await crew.read(null, 'test/auth/login.test.ts');
  await crew.think();
  await crew.grep(null, 'expiresAt', 'src');
  await crew.think();
  await crew.todos(null, progress(API_TODOS, 0));
  await crew.think();
  await (rng.chance(0.5) ? crew.spawnMany(apiSquad(crew)) : crew.spawn(apiScout(crew)));
  await crew.think();
  await crew.todos(null, progress(API_TODOS, 2));
  await crew.read(null, 'src/auth/tokens.ts');
  await crew.think();
  await crew.edit(null, 'src/auth/tokens.ts', 'const now = Date.now();', 'const now = clock.now();');
  await crew.think();
  await crew.edit(null, 'test/auth/login.test.ts', "it('rejects expired tokens', () => {", "it('rejects expired tokens', () => {\n    const clock = fixedClock('2026-01-01T00:00:00Z');");
  await crew.think();
  const failure = 'Exit code 1\n FAIL  test/auth/login.test.ts > login > rejects expired tokens\n TypeError: clock.now is not a function';
  await crew.bash(null, 'npm test -- test/auth/login.test.ts', { description: 'Run the login tests', fail: failure, duration: rng.int(2500, 4500) });
  await crew.think(1.5, 3.5);
  await crew.read(null, 'src/lib/clock.ts');
  await crew.edit(null, 'src/lib/clock.ts', 'export const clock = Date;', 'export const clock = { now: () => Date.now() };');
  await crew.think();
  await crew.bash(null, 'npm test', { description: 'Run the whole suite', stdout: TOOLCHAINS.ts.passOutput(48), duration: rng.int(3500, 6000) });
  await crew.todos(null, progress(API_TODOS, 4));
  await crew.think();
  const message = 'fix(auth): inject a clock so the login expiry test is deterministic';
  await crew.bash(null, `git add -A && git commit -m "${message}"`, { description: 'Commit the fix', stdout: `[fix/flaky-login-test 3f9c2e1] ${message}\n 3 files changed, 18 insertions(+), 6 deletions(-)` });
  await crew.think(0.8, 2);
  await crew.bash(null, 'git push -u origin fix/flaky-login-test', { description: 'Push the branch', duration: rng.int(1200, 2500) });
  await crew.todos(null, progress(API_TODOS, API_TODOS.length));
  await crew.think();
  await crew.stop(
    'Fixed the flaky login test. The expiry check called Date.now() directly while the test faked timers only after creating the token. I injected a clock into src/auth/tokens.ts, gave the test a fixed clock and pushed fix/flaky-login-test. All 48 tests pass.',
  );
}

// (b) web-app: an agent team builds the settings page ------------------------------------------

const TEAM = Object.freeze([
  {
    name: 'frontend',
    description: 'Settings page UI',
    prompt: 'You are the frontend teammate. Build the settings form in src/pages/Settings.tsx.',
    subject: 'Build the settings form',
    detail: 'React form for theme, language, email notifications and time zone.',
  },
  {
    name: 'backend',
    description: 'Settings API',
    prompt: 'You are the backend teammate. Add GET and PATCH /api/settings with validation.',
    subject: 'Add GET/PATCH /api/settings',
    detail: 'Express routes with validation; store settings per user.',
  },
  {
    name: 'tester',
    description: 'Settings end-to-end tests',
    prompt: 'You are the tester. Write Playwright tests for loading, saving and validation errors.',
    subject: 'End-to-end tests for settings',
    detail: 'Playwright tests: load, save, validation errors.',
  },
]);

/** @param {Crew} crew @param {SimAgent} me @param {string} taskId @param {Promise<unknown>} apiReady @param {() => void} done */
async function frontendWork(crew, me, taskId, apiReady, done) {
  await crew.think(0.6, 1.5);
  await crew.taskUpdate(me, taskId, { status: 'in_progress', owner: 'frontend' });
  await crew.read(me, 'src/pages/Profile.tsx');
  await crew.think();
  await crew.message(me, 'backend', 'What does GET /api/settings return? I need the field names for the form.', 'Asks for the settings API shape');
  await crew.write(me, 'src/pages/Settings.tsx', 'export function Settings() {\n  const fields = [];\n  // …\n}\n');
  await apiReady;
  await crew.think();
  await crew.edit(me, 'src/pages/Settings.tsx', 'const fields = [];', "const fields = ['theme', 'language', 'emailNotifications', 'timezone'];");
  await crew.think();
  await crew.bash(me, 'npx vitest run src/pages/Settings.test.tsx', { description: 'Run the settings page tests', stdout: TOOLCHAINS.ts.passOutput(6), duration: crew.rng.int(2000, 3500) });
  await crew.taskComplete(me, taskId, TEAM[0].subject);
  await crew.message(me, 'team-lead', 'Settings form done: fields are wired to /api/settings and the component tests pass.', 'Settings form done');
  done();
  await crew.teammateIdle(me);
}

/** @param {Crew} crew @param {SimAgent} me @param {string} taskId @param {() => void} replied */
async function backendWork(crew, me, taskId, replied) {
  await crew.think(0.8, 1.8);
  await crew.taskUpdate(me, taskId, { status: 'in_progress', owner: 'backend' });
  await crew.read(me, 'server/routes/profile.ts');
  await crew.think();
  await crew.write(me, 'server/routes/settings.ts', "router.get('/', getSettings);\nrouter.patch('/', validate(settingsSchema), updateSettings);\n");
  await crew.think();
  await crew.message(me, 'frontend', 'GET /api/settings returns { theme, language, emailNotifications, timezone }; PATCH accepts any subset.', 'Settings API shape');
  replied();
  await crew.edit(me, 'server/app.ts', "app.use('/api/profile', profile);", "app.use('/api/profile', profile);\napp.use('/api/settings', settings);");
  await crew.think();
  await crew.bash(me, 'npm test -- server/routes', { description: 'Run the API route tests', stdout: TOOLCHAINS.ts.passOutput(14), duration: crew.rng.int(2500, 4000) });
  await crew.taskComplete(me, taskId, TEAM[1].subject);
  await crew.message(me, 'team-lead', 'Settings API is live: GET and PATCH /api/settings with validation; route tests pass.', 'Settings API done');
  await crew.teammateIdle(me);
}

/** @param {Crew} crew @param {SimAgent} me @param {string} taskId @param {Promise<unknown>} ready */
async function testerWork(crew, me, taskId, ready) {
  await crew.think(1, 2);
  await crew.taskUpdate(me, taskId, { status: 'in_progress', owner: 'tester' });
  await crew.read(me, 'e2e/profile.spec.ts');
  await crew.think();
  await crew.write(me, 'e2e/settings.spec.ts', "test('saves settings', async ({ page }) => {\n  await page.getByLabel('Theme').selectOption('dark');\n});\n");
  await ready;
  await crew.think();
  const run = 'npx playwright test e2e/settings.spec.ts';
  const failure = "Exit code 1\n  1) e2e/settings.spec.ts:4:1 › saves settings: locator getByLabel('Theme') resolved to 0 elements";
  await crew.bash(me, run, { description: 'Run the settings end-to-end tests', fail: failure, duration: crew.rng.int(4000, 7000) });
  await crew.think();
  await crew.message(me, 'frontend', "The Theme select has no label, so my test can't find it. Could you add one?", 'Theme select needs a label');
  await crew.think();
  await crew.edit(me, 'e2e/settings.spec.ts', "getByLabel('Theme')", "getByRole('combobox', { name: 'Theme' })");
  await crew.bash(me, run, { description: 'Run the settings end-to-end tests', stdout: '  3 passed (8.1s)', duration: crew.rng.int(4000, 7000) });
  await crew.taskComplete(me, taskId, TEAM[2].subject);
  await crew.message(me, 'team-lead', 'All green: three end-to-end tests cover loading, saving and validation errors.', 'End-to-end tests pass');
  await crew.teammateIdle(me);
}

/**
 * (b) "web-app": an agent team. Shared tasks (TaskCreate/TaskCreated), three named teammates,
 * their tool calls (with agent_id), messages between them, TaskUpdate/TaskCompleted, TeammateIdle.
 * @param {Crew} crew
 * @returns {Promise<SimAgent[]>} the teammates, still alive for later rounds
 */
export async function webAppTeamScenario(crew) {
  await crew.start();
  await crew.think(1, 2);
  await crew.prompt('Create an agent team to build the new settings page: one teammate for the UI, one for the API and one for end-to-end tests.');
  await crew.think(1.5, 3);
  const ids = [];
  for (const member of TEAM) {
    ids.push(await crew.taskCreate(null, member.subject, member.detail));
    await crew.think(0.4, 1);
  }
  const team = [];
  for (const member of TEAM) {
    team.push(await crew.launchTeammate(member));
    await crew.think(0.5, 1.2);
  }
  await crew.stop('The team is on it: frontend builds the settings form, backend adds the API and tester writes the end-to-end tests. I will review when they report back.');
  const api = signal();
  const ui = signal();
  await Promise.all([
    frontendWork(crew, team[0], ids[0], api.promise, ui.fire),
    backendWork(crew, team[1], ids[1], api.fire),
    testerWork(crew, team[2], ids[2], Promise.all([api.promise, ui.promise])),
  ]);
  await crew.think(1.5, 3);
  await crew.tool(null, 'TaskList', {}, { duration: 120 });
  await crew.read(null, 'src/pages/Settings.tsx');
  await crew.think();
  await crew.bash(null, 'npm run build', { description: 'Build the app', stdout: 'vite v7.1.3 building for production...\n✓ built in 4.21s', duration: crew.rng.int(3000, 5000) });
  await crew.stop('The settings page is done: the form (frontend), GET/PATCH /api/settings (backend) and three end-to-end tests (tester). The production build passes.');
  return team;
}

// (c) docs-site: web research, MCP, a skill, compaction, a model switch, a rate limit, a permit ---

/** @param {Crew} crew */
async function researchWebhooks(crew) {
  await crew.skill(null, 'docs-style-guide');
  await crew.think();
  await crew.webSearch(null, 'webhook signature verification HMAC SHA-256 best practices');
  await crew.think();
  await crew.webFetch(
    null,
    'https://docs.github.com/en/webhooks/using-webhooks/validating-webhook-deliveries',
    'How should a receiver verify webhook signatures and handle retries?',
  );
  await crew.think();
  const issues = 'Found 3 open issues: #212 "Document webhook retries", #198 "Explain the signature header", #187 "Webhook event list is outdated".';
  await crew.mcp(null, 'github', 'search_issues', { owner: 'acme', repo: 'docs-site', query: 'webhooks is:open' }, issues);
  await crew.think();
}

/** Builds into dist; the old output needs `rm -rf dist`, which asks for permission. @param {Crew} crew */
async function rebuildDist(crew) {
  const removal = await crew.bash(null, 'rm -rf dist', { description: 'Remove the stale build output', permission: true });
  await crew.think();
  if (removal.denied) {
    // Plan B: let the build tool clean its own output instead of deleting it by hand.
    await crew.bash(null, 'uv run mkdocs build --clean --site-dir dist', { description: 'Rebuild into dist cleanly instead', duration: crew.rng.int(2500, 4000) });
  } else {
    await crew.bash(null, 'uv run mkdocs build --site-dir dist', { description: 'Build the site into dist', duration: crew.rng.int(2500, 4000) });
  }
}

/**
 * (c) "docs-site": WebSearch/WebFetch, an MCP tool, a skill, PreCompact/PostCompact, a model
 * switch, a permission request for `rm -rf dist` (allow → continue; deny → an alternative) and a
 * StopFailure for a rate limit, after which the user says "continue".
 * @param {Crew} crew
 */
export async function docsSiteScenario(crew) {
  const { rng } = crew;
  await crew.start();
  await crew.think(1, 2);
  await crew.prompt('Add a webhooks guide to the docs and refresh the API reference.');
  await crew.think(1.5, 3);
  await researchWebhooks(crew);
  await crew.read(null, 'mkdocs.yml');
  await crew.read(null, 'docs/api/index.md');
  await crew.think();
  await crew.write(null, 'docs/guides/webhooks.md', '# Webhooks\n\nVerify every delivery with the X-Acme-Signature header before trusting it.\n');
  await crew.think();
  await crew.edit(null, 'mkdocs.yml', '  - Quickstart: guides/quickstart.md', '  - Quickstart: guides/quickstart.md\n  - Webhooks: guides/webhooks.md');
  await crew.think();
  await crew.compact('auto');
  await crew.think(1, 2);
  await crew.switchModel(MODELS.sonnet, 'sonnet');
  await crew.think();
  await crew.bash(null, 'uv run python scripts/gen_api_docs.py --spec openapi.yaml --out docs/api', { description: 'Regenerate the API reference', stdout: 'Wrote 42 pages to docs/api' });
  await crew.think();
  await crew.bash(null, 'uv run mkdocs build --strict', { description: 'Build the site in strict mode', stdout: 'INFO - Documentation built in 3.12 seconds', duration: rng.int(2500, 4000) });
  await crew.think();
  await rebuildDist(crew);
  await crew.think();
  await crew.stopFailure('rate_limit', '429 Too Many Requests: rate limit reached for this organization; retry after 30 seconds', 'Running the link checker next…');
  await crew.sim.sleep(rng.int(7000, 11000));
  await crew.prompt('continue');
  await crew.think();
  await crew.bash(null, 'uv run python scripts/check_links.py dist', { description: 'Check every link in the built site', stdout: 'Checked 418 links: all OK', duration: rng.int(2000, 3500) });
  await crew.think();
  await crew.stop(
    'Added docs/guides/webhooks.md (signature verification, retries and the event list), linked it in the nav, regenerated the API reference and rebuilt dist. The strict build and the link checker pass.',
  );
}
