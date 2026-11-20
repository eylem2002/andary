# 0010 — Stacked feature-branch pull requests; `main` starts empty

Status: Accepted

## Context

The owner's rules: never commit to `main`, one branch per feature, pull requests with full
descriptions, no merging without an explicit "merge".

## Decision

- `main` contains a single empty root commit ("Initialize repository") so pull requests have a
  base; it holds no project files.
- Each feature is one branch, built on the previous one, in dependency order. Each pull request
  targets the branch below it, so its diff shows only that feature. Merge them in order; GitHub
  retargets the next PR to `main` when its base branch is merged and deleted.
- PR descriptions are kept in `docs/prs/` as well, so they survive outside GitHub.

## Consequences

- Reviews are small and focused. Merging out of order would pull in the earlier branches' changes.
