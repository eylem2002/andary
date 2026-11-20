# Pull request order

Each branch builds on the one above it and each pull request targets it. Merge from top to
bottom; after a merge GitHub retargets the next pull request to `main`.

- `chore/project-tooling` — toolchain, shared contracts, vendored libraries, quality scripts
- `ci/github-actions-and-pre-push` — free GitHub Actions CI, Dependabot, pre-push checks
- `feat/server-hooks-cli` — local server, hook forwarder, CLI, installer, Claude Code plugin
- `feat/town-environment` — the 3D town: buildings, sea, sky, day/night, camera, signs
- `feat/agents-and-world` — characters, animation, walking, bubbles, effects, world facade
- `feat/event-core-and-simulation` — hook normalisation, store, director, humour, simulation
- `feat/hud-and-app-shell` — the app: HUD, approvals, live/demo boot, end-to-end suites
- `fix/security-review` — fixes from the independent security review, with tests
- `fix/qa-accessibility-performance` — fixes from QA: accessibility, performance, mobile
- `refactor/code-quality-review` — fixes from the independent code-quality review
- `docs/readme-adrs-and-reports` — README, ADRs, owner setup, QA and final reports
- `feat/game-view-director-camera` — director camera close-ups and the full-screen town
- `feat/sunset-coast-theme` — the sunset-coast look: paint, neon, beach, sky, grade and HUD
- `feat/file-diffs` — click a file in the agent inspector to see its diff
