# README: a guide to using Andary, connecting Claude Code or Codex, and sharing it

Part 26 of 30 · base: `refactor/architecture`

## What changed

- **README rewritten as a guide**, in the order people need it: install; connect Claude Code
  (scopes, plugin, dry run); connect Codex (`andary install codex`, trusting the hooks, what you
  get and what is not covered yet); check it works (`status`, `doctor`); use the town (the
  buildings, the keyboard, approvals, costs, weather, growth, looks, sound, notifications);
  **share it** (a team town step by step with what is and is not shared, a static demo anyone can
  open, recordings, the project itself); security; a troubleshooting table; the command
  reference; how it works (with Codex and the team relay in the diagram); development and the
  project layout.
- docs/INTEGRATION.md covers Codex (files, trust, events, translation, troubleshooting,
  uninstall) and no longer suggests `npx andary` (the package is not on npm, so `npx` could run
  someone else's package of that name).
- The in-app setup steps mention `andary install codex`.
- Fixed a wrong instruction: GitHub Pages can only publish a branch's root or `docs/` folder, so
  hosting the demo from `public/` needs a Pages workflow (README, OWNER-SETUP).

## Tests

Docs only, apart from the setup dialog's text; `e2e/a11y.spec.mjs` and `demo.spec.mjs` still
open it. Every command and flag in the README was checked against `andary --help` and the CLI
tests.
