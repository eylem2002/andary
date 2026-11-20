# Fixes from the independent code-quality review

Part 10 of 12 · base: `fix/qa-accessibility-performance`

## What changed

A reviewer who had not seen the code checked it against the owner's standard: no dead code, clear
names, small functions, comments that explain why, one consistent structure, and lint and
typecheck passing. **No behaviour changes**, apart from the consistency fixes at the end of this
list. Full report:
[`docs/reviews/code-quality-review-2026-11-17.md`](../reviews/code-quality-review-2026-11-17.md).

- **Dead code, now gated.** `scripts/find-unused-exports.mjs` finds exports that nothing imports,
  which neither ESLint nor `tsc` can see. Before → after:

  | Category | Before | After |
  | --- | --- | --- |
  | Dead exports | 4 | 0 |
  | Used only by tests | 6 | 0 |
  | Used only in their own file | 50 | 3 (deliberate) |

  It now runs in `npm run check`, the pre-push hook and CI (`npm run deadcode`).
- **Smaller functions.** The most complex functions were split into named steps: the WebSocket
  client's message handler, approval card building and updating, the CLI entry point, the store's
  approval handling, path shortening and server start-up. Functions above complexity 12 went
  from 22 to 17 (highest now 19). Procedural 3D geometry was left as straight-line code on
  purpose; the report explains why.
- **Consistency.** `error` everywhere instead of `err`; the lab-only stub environment moved next
  to the lab; 32 ESLint rules that already pass were switched on, among them `no-console` in
  browser code and a ban on TODO/FIXME comments.
- **Consistency fixes that change what you see.**
  - One model label for the whole app (`catalog.js`): speech bubbles said "Sonnet 20241022" where
    the HUD said "Sonnet 3.5".
  - Agent ids are normalised the same way on the server and in the browser, so an approval always
    finds its agent.
  - `andary doctor`'s probe no longer leaves a crew or unlocks an achievement in the town (the
    town ignores the reserved `andary-doctor-` session prefix), and it no longer carries the
    project's old working title.
  - `docs/INTEGRATION.md` no longer promises a deny reason the approval card cannot take.
- **Database**: there is none (ADR 0006), so nothing needs prepared statements, pooling or
  transactions; settings files are written atomically (temp file + rename).

## Tests and results

| Check | Result |
| --- | --- |
| `npm run check:fast` (now with the dead-code step) | pass, 678 / 678 tests |
| Playwright end-to-end and accessibility suites | 52 pass, 6 skipped by design |
| New tests | one model label for every id style, doctor probes leave no trace, server agent-id rule matches the browser's |

## Assumptions

- Three file-private helpers stay exported on purpose (`append` in `ui/dom.js`, `toHex` and
  `relativeLuminance` in `color.js`): they are the basic building blocks of those small modules.

## Open items

- 17 functions are still above complexity 12, mostly factories, 3D shape builders and security
  checks where splitting would hurt readability; listed in the report.
