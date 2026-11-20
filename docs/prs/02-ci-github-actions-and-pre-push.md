# Free GitHub Actions CI, Dependabot and a pre-push gate

Part 2 of 13 · base: `chore/project-tooling`

## What changed

- **`.github/workflows/ci.yml`**, on pull requests, pushes to `main`, a weekly schedule and on
  demand:
  - job `checks` on Node 22 and 24: `npm ci`, `npm audit --audit-level=high`, lint, config lint
    (shellcheck, actionlint, yamllint), typecheck, unit + integration tests, licence gate and a
    secrets scan over the full history (`fetch-depth: 0`);
  - job `e2e` after it: installs Chromium and runs the Playwright end-to-end and axe accessibility
    suites on desktop and mobile; uploads the report only on failure, kept 7 days.
- **Kept inside the free tier**: Linux runners only, `timeout-minutes` on each job,
  `concurrency` with `cancel-in-progress`, npm cache. Free on public repositories; roughly 10 of
  the 2,000 free minutes per push on private ones.
- **Hardened**: `permissions: contents: read`, `persist-credentials: false`, every action pinned
  to a full commit SHA (checkout v7.0.1, setup-node v7.1.0, upload-artifact v7.0.2), linter
  versions pinned.
- **Dependabot**: weekly npm updates (grouped), monthly GitHub Actions updates.
- **`.githooks/pre-push`**: runs `npm run check:fast` (lint, config lint, typecheck, tests,
  licences, secrets) before every push. Enable once per clone with `npm run hooks:install`;
  skip once with `git push --no-verify`.

## Tests and results

| Check | Result |
| --- | --- |
| `actionlint .github/workflows/ci.yml` | pass |
| `yamllint -c .yamllint.yml .github` | pass |
| `shellcheck .githooks/pre-push scripts/publish-github.sh` | pass |
| `npm run check:fast` on this branch | pass (24 / 24 tests) |

The workflow itself can only run once the repository is on GitHub.

## Assumptions

- No paid services, no cloud resources: Actions minutes only, no deploy job.
- The full local equivalent of CI is `npm run check`.

## Open items

- Branch protection for `main` (require PRs and these checks) is a repository setting the owner
  turns on; see `docs/OWNER-SETUP.md`.
