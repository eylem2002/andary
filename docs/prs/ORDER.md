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
- `feat/cost-meter` — tokens and estimated cost per crew and agent, and a 14-day usage chart
- `feat/town-weather` — rain, storms, fog and rainbows from what the crews go through
- `feat/town-growth` — finished work earns points, and points build landmarks
- `feat/leaderboard` — the town's growth, records and the busiest agents
- `feat/notifications` — notifications on your phone (ntfy, opt-in) and on this computer
- `feat/ambient-sound` — waves, gulls, crickets, city hum and soft chords that follow the work
- `feat/town-looks` — five town looks: coast, snowy village, neon city, desert oasis, Amman
- `feat/team-town` — teammates' sessions in one shared town over your network, with a view-only link
- `fix/feature-review` — fixes from the independent review of the nine features
- `feat/codex` — connect OpenAI Codex: `andary install codex`, a server-side adapter, a Codex badge
- `refactor/architecture` — one ingest pipeline, shared core rules, smaller modules, enforced layer boundaries
