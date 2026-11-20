# Fixes from the independent QA, accessibility and performance review

Part 9 of 13 · base: `fix/security-review`

## What changed

A QA reviewer who had not seen the code tested every feature for every role in a
production-like sandbox: the owner in a browser (live mode), an unauthenticated browser, a
hosted-demo visitor, the CLI operator and the plugin user. It ran several Lighthouse rounds, the
axe suite, a keyboard-only walkthrough and a five-minute memory check. **8 issues found, all
fixed; 6 have new tests that fail without the fix.** Full report:
[`docs/qa/checks-2026-11-17.md`](../qa/checks-2026-11-17.md).

| ID | Severity | Issue | Fix |
| --- | --- | --- | --- |
| C1 | Medium | Any CLI command piped into `head` crashed with an EPIPE stack trace and exit 1. | Output to a closed pipe is dropped quietly. |
| A1 | Medium | Pausing the demo did not stop a pending approval's countdown. | Pause freezes it. |
| P1 | Medium | On phones the toolbar jumped 450 px after the first paint (all of the 0.127 layout shift). | Measured before the first paint. |
| S1 | Medium | The publish script would push every branch before noticing missing PR descriptions. | It checks them all first; it also works from a clone of the delivered git bundle (repoints `origin`, recreates local branches). |
| — | Low | "Errors only" checkbox under 24 px; heading order on phones; the new-crew toast told phone users to press a number key; a wrong `?log=1` line in CONTRACTS.md. | Fixed (the toast now has a Show button). |

Also in this PR: CI installs its config linters into a throwaway virtualenv, because Ubuntu
runners refuse system-wide `pip install` (PEP 668), as both reviewers pointed out.

## Tests and results

| Check | Result |
| --- | --- |
| `npm run check:fast` (lint, config lint, typecheck, tests, licences, secrets) | pass, 679 / 679 tests |
| Playwright end-to-end and accessibility suites | 52 pass, 6 skipped by design |
| axe (WCAG 2.0/2.1/2.2 A + AA), every state tested, desktop and mobile | 0 violations |
| Memory, demo at 4× for 5 minutes | JS heap levels off at ≈ 11 MB, DOM at ≈ 4,000 nodes |

**Lighthouse** (performance · accessibility · best practices · SEO):

| Round | Desktop | Mobile |
| --- | --- | --- |
| Baseline | 46 · 100 · 100 · 100 | 31 · 98 · 100 · 100 |
| Final | 38 · 100 · 100 · 100 | 35 · 100 · 100 · 100 |

The performance column is held down by the build environment: with no GPU, Chrome draws the 3D
town on the CPU (SwiftShader), and the mobile preset adds 4× CPU throttling on top. Run-to-run
noise is about ±8 points, so judge the sub-metrics: layout shift fell from 0.127 to 0.034–0.056 on
mobile. On real hardware the WebGL frame loop runs on the GPU.

## Assumptions

- "Minify", "unused JavaScript" and "cache lifetime" advice is not applied: there is no build step
  by design (ADR 0002), and `vendor/` is cached for a day.

## Open items (for the owner, see the report)

- Check the 3D view on real GPU hardware with High quality while following an agent: the view
  went blank a few times on SwiftShader, with no app-level cause found.
- The plugin's `bin/` folder lands on Claude's `PATH`, and claude.ai/Cowork refuse plugins with
  a `bin/` folder; fixing it means changing the package layout.
- The demo and live view start only once the 3D world is ready, which delays the first content on
  slow devices (LCP).
