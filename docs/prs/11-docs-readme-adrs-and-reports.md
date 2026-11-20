# README, architecture decisions, owner setup and final report

Part 11 of 12 · base: `refactor/code-quality-review`

## What changed

Documentation only:

- **README.md**: what Andary is, screenshots (day, night, phone), quick start, the building
  guide, remote approvals, how it works (diagram), security and privacy, CLI, development
  commands, CI and the pre-push hook, deploying, project layout.
- **Architecture decision records** `docs/adr/0001`–`0012`: hooks rather than transcript files,
  no build step, a zero-dependency loopback server, the local authentication model, opt-in remote
  approvals, in-memory state (no database), the rendering approach, one shared simulation,
  `checkJs` typing, the stacked-PR workflow, dev-tool licences, and signed hook replies with
  safe approvals.
- **`docs/OWNER-SETUP.md`**: everything that needs the owner, in order.
- **`docs/ASSUMPTIONS.md`**: every decision made without asking, with its reason.
- **`docs/FINAL-REPORT.md`**: features, workflows, security findings and fixes, test results
  and scores, remaining risks.
- **`docs/prs/`**: these pull request descriptions and their merge order.
- **`docs/INTEGRATION.md`**: what `/andary:town` pre-approves, and the alternative.
- Screenshots in `docs/media/` (WebP, about 400 KB in total).

## Tests and results

Final verification from a fresh clone of the complete stack: see the table in
[`docs/FINAL-REPORT.md`](../FINAL-REPORT.md#4-test-results-and-scores).

## Open items

- The remaining risks are listed in the final report, each with what to do about it.
