// The material the simulation tells its stories with: believable TypeScript and Python projects,
// their toolchains, and the goals a developer might give Claude Code in each.

export const HOME = '/home/dev';

/**
 * @typedef {object} Goal
 * @property {string} prompt   what the user asks
 * @property {string} done     Claude's closing message
 * @property {string[]} focus  files the work centres on (relative to the project root)
 * @property {string} search   what gets grepped first
 * @property {string} topic    what the work is about, in words ("rate limiting")
 * @property {string} [newFile] a file the work creates
 */

/**
 * @typedef {object} Toolchain
 * @property {string} test
 * @property {(file: string) => string} testFile
 * @property {string} lint
 * @property {string} typecheck
 * @property {string} build
 * @property {(pkg: string) => string} install
 * @property {string[]} packages
 * @property {(n: number) => string} passOutput
 * @property {(file: string) => string} failOutput
 */

/**
 * @typedef {object} Project
 * @property {string} name
 * @property {'ts'|'py'} lang
 * @property {string} branch
 * @property {string[]} files
 * @property {string[]} tests
 * @property {string[]} patterns
 * @property {Goal[]} goals
 */

/** @type {Readonly<Record<'ts'|'py', Toolchain>>} */
export const TOOLCHAINS = Object.freeze({
  ts: {
    test: 'npm test',
    testFile: (file) => `npx vitest run ${file}`,
    lint: 'npm run lint',
    typecheck: 'npx tsc --noEmit',
    build: 'npm run build',
    install: (pkg) => `npm install ${pkg}`,
    packages: ['zod', 'date-fns', 'msw', 'pino', 'nanoid', '@tanstack/react-query'],
    passOutput: (n) => ` ✓ ${Math.max(1, Math.round(n / 9))} test files passed\n      Tests  ${n} passed (${n})\n   Duration  ${(n / 18).toFixed(2)}s`,
    failOutput: (file) => `Exit code 1\n FAIL  ${file}\n AssertionError: expected 401 to be 200`,
  },
  py: {
    test: 'uv run pytest -q',
    testFile: (file) => `uv run pytest ${file} -q`,
    lint: 'uv run ruff check .',
    typecheck: 'uv run mypy src',
    build: 'uv build',
    install: (pkg) => `uv add ${pkg}`,
    packages: ['httpx', 'pydantic', 'rich', 'tenacity', 'polars', 'structlog'],
    passOutput: (n) => `${'.'.repeat(Math.min(n, 40))}\n${n} passed in ${(n / 30).toFixed(2)}s`,
    failOutput: (file) => `Exit code 1\nFAILED ${file}::test_happy_path - AssertionError: assert 41.99 == 42.0`,
  },
});

/** @type {Readonly<Record<string, Project>>} */
export const PROJECTS = Object.freeze({
  'api-server': {
    name: 'api-server',
    lang: 'ts',
    branch: 'fix/flaky-login-test',
    files: [
      'src/auth/login.ts',
      'src/auth/session.ts',
      'src/auth/tokens.ts',
      'src/auth/reset.ts',
      'src/db/users.ts',
      'src/routes/auth.ts',
      'src/routes/users.ts',
      'src/middleware/rateLimit.ts',
      'src/lib/clock.ts',
      'src/lib/logger.ts',
      'src/config.ts',
      'src/server.ts',
      'package.json',
      'vitest.config.ts',
    ],
    tests: ['test/auth/login.test.ts', 'test/auth/session.test.ts', 'test/routes/auth.test.ts', 'test/db/users.test.ts'],
    patterns: ['Date.now', 'expiresAt', 'TODO', 'useFakeTimers', 'jwt.sign', 'process.env', 'router.post'],
    goals: [
      {
        prompt: 'Add rate limiting to POST /auth/login: 5 attempts per minute per IP.',
        done: 'Added a sliding-window rate limiter in src/middleware/rateLimit.ts and applied it to POST /auth/login. New tests check that the sixth attempt gets a 429 with a Retry-After header.',
        focus: ['src/routes/auth.ts', 'src/middleware/rateLimit.ts'],
        search: 'router.post',
        topic: 'rate limiting',
      },
      {
        prompt: 'GET /users is slow with many users. Find out why and speed it up.',
        done: 'GET /users ran one query per user to load roles. It now loads them with a single join in src/db/users.ts; the benchmark p95 dropped from about 900 ms to 60 ms.',
        focus: ['src/db/users.ts', 'src/routes/users.ts'],
        search: 'findMany',
        topic: 'the users query',
      },
      {
        prompt: 'Replace the hand-written config parsing with zod validation.',
        done: 'src/config.ts now validates the environment with a zod schema and fails fast with readable errors. Added tests for missing and malformed values.',
        focus: ['src/config.ts', 'src/server.ts'],
        search: 'process.env',
        topic: 'config validation',
      },
      {
        prompt: 'Add structured logging with a request id on every log line.',
        done: 'Each request gets an id in src/middleware/requestId.ts and every log line carries it through pino child loggers.',
        focus: ['src/lib/logger.ts', 'src/server.ts'],
        search: 'console.log',
        topic: 'request logging',
        newFile: 'src/middleware/requestId.ts',
      },
      {
        prompt: 'Write tests for the password reset flow.',
        done: 'Added 9 tests for password reset (expiry, reuse, unknown email) in test/auth/reset.test.ts, and fixed an off-by-one in the expiry check they caught.',
        focus: ['src/auth/reset.ts'],
        search: 'resetToken',
        topic: 'password reset',
        newFile: 'test/auth/reset.test.ts',
      },
    ],
  },
  'web-app': {
    name: 'web-app',
    lang: 'ts',
    branch: 'feat/settings-page',
    files: [
      'src/pages/Settings.tsx',
      'src/pages/Profile.tsx',
      'src/components/Toggle.tsx',
      'src/components/Form.tsx',
      'src/api/client.ts',
      'src/hooks/useSettings.ts',
      'server/routes/settings.ts',
      'server/routes/profile.ts',
      'server/app.ts',
      'package.json',
    ],
    tests: ['src/pages/Settings.test.tsx', 'e2e/settings.spec.ts', 'e2e/profile.spec.ts'],
    patterns: ['useEffect', 'fetchSettings', 'aria-', 'TODO', 'useState'],
    goals: [
      {
        prompt: 'The settings page flickers on first load. Fix it.',
        done: 'The flicker came from rendering defaults before the saved settings arrived. useSettings now suspends until the first fetch resolves, so the page renders once with real values.',
        focus: ['src/hooks/useSettings.ts', 'src/pages/Settings.tsx'],
        search: 'useEffect',
        topic: 'the settings loader',
      },
      {
        prompt: 'Make the profile form accessible: labels, focus order and error messages.',
        done: 'Every field in the profile form has a visible label, errors are announced with aria-live and linked with aria-describedby, and focus moves to the first invalid field on submit.',
        focus: ['src/pages/Profile.tsx', 'src/components/Form.tsx'],
        search: 'aria-',
        topic: 'form accessibility',
      },
      {
        prompt: 'Add optimistic updates to the settings form.',
        done: 'Settings changes now apply instantly and roll back with a toast if the PATCH fails. Covered by two new tests.',
        focus: ['src/hooks/useSettings.ts', 'src/api/client.ts'],
        search: 'fetchSettings',
        topic: 'optimistic updates',
      },
    ],
  },
  'docs-site': {
    name: 'docs-site',
    lang: 'py',
    branch: 'docs/webhooks-guide',
    files: [
      'mkdocs.yml',
      'docs/index.md',
      'docs/api/index.md',
      'docs/guides/quickstart.md',
      'docs/guides/webhooks.md',
      'scripts/gen_api_docs.py',
      'scripts/check_links.py',
      'src/docs_site/plugins.py',
      'pyproject.toml',
    ],
    tests: ['tests/test_links.py', 'tests/test_plugins.py'],
    patterns: ['nav:', 'webhook', 'TODO', 'def on_page_markdown', 'href'],
    goals: [
      {
        prompt: 'Fix the broken links the link checker reports.',
        done: 'Fixed 7 broken links: 5 pointed at pages renamed in the last restructure and 2 at an old API host. check_links.py is clean.',
        focus: ['docs/guides/quickstart.md', 'docs/api/index.md'],
        search: 'href',
        topic: 'broken links',
      },
      {
        prompt: 'Add a FAQ page and link it from the home page.',
        done: 'Added docs/faq.md with the 12 most common questions from the issue tracker and linked it from the home page and the nav.',
        focus: ['docs/index.md', 'mkdocs.yml'],
        search: 'nav:',
        topic: 'the FAQ page',
        newFile: 'docs/faq.md',
      },
    ],
  },
  'billing-service': {
    name: 'billing-service',
    lang: 'py',
    branch: 'fix/tax-rounding',
    files: [
      'src/billing/invoices.py',
      'src/billing/payments.py',
      'src/billing/models.py',
      'src/billing/api.py',
      'src/billing/tax.py',
      'src/billing/webhooks.py',
      'pyproject.toml',
    ],
    tests: ['tests/test_invoices.py', 'tests/test_payments.py', 'tests/test_tax.py'],
    patterns: ['round\\(', 'Decimal', 'idempotency', 'TODO', 'def create_payment'],
    goals: [
      {
        prompt: 'Invoices round tax wrongly for currencies without cents. Fix it.',
        done: 'Tax was rounded to two decimals for every currency. tax.py now rounds with Decimal to the currency exponent (0 for JPY and KRW); added cases for JPY, KWD and EUR.',
        focus: ['src/billing/tax.py', 'src/billing/invoices.py'],
        search: 'round\\(',
        topic: 'tax rounding',
      },
      {
        prompt: 'Add idempotency keys to POST /payments.',
        done: 'POST /payments accepts an Idempotency-Key header; repeats within 24 hours return the original response instead of charging twice.',
        focus: ['src/billing/api.py', 'src/billing/payments.py'],
        search: 'def create_payment',
        topic: 'idempotency keys',
      },
      {
        prompt: 'Retry failed webhook deliveries with exponential backoff.',
        done: 'Webhook deliveries retry up to 6 times with exponential backoff and jitter (tenacity); permanent 4xx failures are not retried.',
        focus: ['src/billing/webhooks.py'],
        search: 'def deliver',
        topic: 'webhook retries',
      },
    ],
  },
  'mobile-app': {
    name: 'mobile-app',
    lang: 'ts',
    branch: 'fix/cart-total',
    files: [
      'src/screens/Home.tsx',
      'src/screens/Checkout.tsx',
      'src/components/CartItem.tsx',
      'src/store/cart.ts',
      'src/api/orders.ts',
      'src/utils/currency.ts',
      'app.json',
      'package.json',
    ],
    tests: ['__tests__/cart.test.ts', '__tests__/currency.test.ts'],
    patterns: ['reduce\\(', 'toFixed', 'RefreshControl', 'TODO', 'Intl.NumberFormat'],
    goals: [
      {
        prompt: 'The cart total is wrong after removing an item. Fix it.',
        done: 'removeItem filtered the items but kept the old subtotal in the store. The total is now derived from the items, never stored; added a regression test.',
        focus: ['src/store/cart.ts', 'src/components/CartItem.tsx'],
        search: 'reduce\\(',
        topic: 'the cart total',
      },
      {
        prompt: "Format prices with the user's locale instead of always using dollars.",
        done: "Prices go through Intl.NumberFormat with the device locale and the order's currency; the old toFixed(2) formatting is gone.",
        focus: ['src/utils/currency.ts', 'src/screens/Checkout.tsx'],
        search: 'toFixed',
        topic: 'price formatting',
      },
    ],
  },
  'data-pipeline': {
    name: 'data-pipeline',
    lang: 'py',
    branch: 'fix/refund-double-count',
    files: ['pipeline/extract.py', 'pipeline/transform.py', 'pipeline/load.py', 'pipeline/schemas.py', 'dags/daily_sales.py', 'pyproject.toml'],
    tests: ['tests/test_transform.py', 'tests/test_load.py'],
    patterns: ['refund', 'groupby', 'merge\\(', 'TODO', 'customer_id'],
    goals: [
      {
        prompt: 'The daily sales job double-counts refunds. Find and fix it.',
        done: 'Refunds were joined once per line item, so multi-item orders counted them twice. transform.py now aggregates refunds per order before the merge; yesterday’s totals match the ledger.',
        focus: ['pipeline/transform.py', 'dags/daily_sales.py'],
        search: 'refund',
        topic: 'refund totals',
      },
      {
        prompt: 'Add data-quality checks for null customer ids.',
        done: 'The load step now rejects batches with null customer_id above 0.1% and logs the offending rows; covered by tests.',
        focus: ['pipeline/load.py', 'pipeline/schemas.py'],
        search: 'customer_id',
        topic: 'data-quality checks',
      },
    ],
  },
});

/** Projects used for sessions that arrive after the scripted ones. */
export const PROCEDURAL_PROJECTS = Object.freeze(['billing-service', 'mobile-app', 'data-pipeline', 'api-server', 'web-app', 'docs-site']);

export const MODELS = Object.freeze({ opus: 'claude-opus-5-5', sonnet: 'claude-sonnet-5', haiku: 'claude-haiku-4-5' });

/** Follow-up work the agent-team lead hands out after the first scripted round. */
export const TEAM_FOLLOWUPS = Object.freeze([
  {
    prompt: 'Ask the team to add a dark-mode toggle to the settings page.',
    subject: 'Dark-mode toggle on the settings page',
    owner: 'frontend',
    files: ['src/components/Toggle.tsx', 'src/pages/Settings.tsx'],
  },
  {
    prompt: 'Have the team record an audit log entry for every settings change.',
    subject: 'Audit log for settings changes',
    owner: 'backend',
    files: ['server/routes/settings.ts', 'server/app.ts'],
  },
  {
    prompt: 'Have the tester cover the error states of the settings page.',
    subject: 'End-to-end tests for settings errors',
    owner: 'tester',
    files: ['e2e/settings.spec.ts'],
  },
]);

/** Kinds of helpers procedural turns delegate to, with what they say when done. */
export const HELPERS = Object.freeze([
  { type: 'Explore', description: 'Map the code around {topic}', result: 'The {topic} logic lives in {file}; two other modules call into it and neither is covered by tests.' },
  { type: 'Plan', description: 'Plan the change to {topic}', result: 'Plan: 1) extract the {topic} logic from {file}, 2) add tests around the current behaviour, 3) make the change behind the existing interface.' },
  { type: 'general-purpose', description: 'Update the tests for {topic}', result: 'Updated the tests around {topic} in {file}; they pass locally.' },
  { type: 'code-reviewer', description: 'Review the {topic} change', result: 'Looks good. One suggestion: {file} swallows an error in the fallback branch; log it at warn level.' },
]);
