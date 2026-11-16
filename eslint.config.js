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
    rules: shared,
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
    // Test files describe scenarios in long blocks; function length is not a useful signal there.
    files: ['test/**/*.mjs', 'e2e/**/*.mjs'],
    rules: { 'max-lines-per-function': 'off', 'max-params': 'off' },
  },
];
