import js from '@eslint/js';
import globals from 'globals';

// Dynamic text in the UI comes from Claude Code sessions, which read untrusted repositories.
// Rendering it as HTML would let a crafted file name run script in the dashboard, so the HTML
// sinks are banned outright; build DOM with createElement + textContent instead.
const htmlSinkBans = [
  {
    selector: "AssignmentExpression[left.property.name='innerHTML']",
    message: 'innerHTML is banned: build nodes with createElement/textContent (see CONTRACTS.md §Security).',
  },
  {
    selector: "AssignmentExpression[left.property.name='outerHTML']",
    message: 'outerHTML is banned: build nodes with createElement/textContent.',
  },
  {
    selector: "CallExpression[callee.property.name='insertAdjacentHTML']",
    message: 'insertAdjacentHTML is banned: build nodes with createElement/textContent.',
  },
  {
    selector: "CallExpression[callee.object.name='document'][callee.property.name='write']",
    message: 'document.write is banned.',
  },
];

const shared = {
  ...js.configs.recommended.rules,
  'no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' }],
  'no-var': 'error',
  'prefer-const': 'error',
  eqeqeq: ['error', 'always', { null: 'ignore' }],
  'no-eval': 'error',
  'no-implied-eval': 'error',
  'no-new-func': 'error',
  'no-restricted-syntax': ['error', ...htmlSinkBans],
  // Redundant or dead code, and work-in-progress markers left in comments.
  'no-useless-assignment': 'error',
  'no-useless-call': 'error',
  'no-useless-computed-key': 'error',
  'no-useless-constructor': 'error',
  'no-useless-rename': 'error',
  'no-useless-return': 'error',
  'no-unused-expressions': 'error',
  'no-unreachable-loop': 'error',
  'no-lone-blocks': 'error',
  'no-lonely-if': 'error',
  'no-else-return': 'error',
  'no-unneeded-ternary': 'error',
  'no-undef-init': 'error',
  'no-warning-comments': ['error', { terms: ['todo', 'fixme', 'xxx', 'hack'], location: 'start' }],
  'array-callback-return': 'error',
  'default-case-last': 'error',
  'no-constructor-return': 'error',
  'no-return-assign': 'error',
  'no-self-compare': 'error',
  'no-throw-literal': 'error',
  'prefer-promise-reject-errors': 'error',
  radix: 'error',
  // One idiom for each of these across the codebase.
  'dot-notation': 'error',
  'logical-assignment-operators': 'error',
  'object-shorthand': 'error',
  'operator-assignment': 'error',
  'prefer-object-has-own': 'error',
  'prefer-object-spread': 'error',
  'prefer-rest-params': 'error',
  'prefer-spread': 'error',
  'prefer-template': 'error',
  'max-depth': ['warn', 4],
  complexity: ['warn', 20],
  'max-lines-per-function': ['warn', { max: 120, skipBlankLines: true, skipComments: true }],
  'max-params': ['warn', 5],
};

export default [
  {
    ignores: [
      'node_modules/**',
      'public/vendor/**',
      'playwright-report/**',
      'test-results/**',
      'coverage/**',
      'dist/**',
      '.tmp/**',
    ],
  },
  {
    files: ['public/js/**/*.js'],
    languageOptions: { ecmaVersion: 2023, sourceType: 'module', globals: { ...globals.browser } },
    // Browser code reports real failures (warn/error); debug output stays behind `&log=1`.
    rules: { ...shared, 'no-console': ['error', { allow: ['warn', 'error', 'debug'] }] },
  },
  {
    files: ['**/*.mjs', '*.js'],
    languageOptions: { ecmaVersion: 2023, sourceType: 'module', globals: { ...globals.node } },
    rules: shared,
  },
  {
    // Playwright specs run page callbacks inside the browser.
    files: ['e2e/**/*.mjs'],
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
  },
  {
    // A Claude Code mod's hooks module runs in Claude Code's sandbox: plain JavaScript and a few web
    // APIs, no Node.js, no timers, no fetch (it reaches files and the network through `$`).
    files: ['mods/**/*.js'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: Object.fromEntries(['AbortController', 'AbortSignal', 'TextEncoder', 'TextDecoder', 'URL', 'URLSearchParams', 'atob', 'btoa', 'structuredClone', 'crypto', 'performance'].map((name) => [name, 'readonly'])),
    },
    rules: shared,
  },
  {
    // Test files describe scenarios in long blocks; function length is not a useful signal there.
    files: ['test/**/*.mjs', 'e2e/**/*.mjs'],
    rules: { 'max-lines-per-function': 'off', 'max-params': 'off' },
  },
];
