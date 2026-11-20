# Architecture decision records

Each record states the context, the decision and its consequences. Status is one of Proposed,
Accepted or Superseded. Add a new record (next number) instead of rewriting an accepted one.

| # | Decision | Status |
| --- | --- | --- |
| [0001](0001-hooks-integration.md) | Connect to Claude Code through hooks, not transcript files | Accepted |
| [0002](0002-no-build-step.md) | No bundler: plain ES modules, vendored three.js and fonts, import map | Accepted |
| [0003](0003-zero-dependency-local-server.md) | A zero-dependency Node server bound to loopback | Accepted |
| [0004](0004-local-auth-model.md) | Local authentication: UI token cookie, hook secret, Host and Origin checks | Accepted |
| [0005](0005-remote-approvals-opt-in.md) | Approving permission prompts from the town is opt-in and times out | Accepted |
| [0006](0006-in-memory-state.md) | In-memory state only; no database; recording is opt-in | Accepted |
| [0007](0007-rendering-approach.md) | three.js orthographic diorama with quality tiers | Accepted |
| [0008](0008-shared-simulation.md) | One simulation drives the demo and the `simulate` command | Accepted |
| [0009](0009-javascript-with-checkjs.md) | JavaScript sources typechecked with `tsc --checkJs` | Accepted |
| [0010](0010-git-workflow.md) | Stacked feature-branch pull requests; `main` starts empty | Accepted |
| [0011](0011-dev-tool-licences.md) | Lighthouse runs through npx to keep the dependency tree permissive | Accepted |
| [0012](0012-signed-hook-replies-and-safe-approvals.md) | Signed hook replies; approvals only for what the town can show | Accepted |
