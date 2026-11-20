# Fixes from the independent security review

Part 8 of 26 · base: `feat/hud-and-app-shell`

## What changed

A reviewer who had not seen the code attacked it in a sandbox: malicious web pages, other users
on the same machine, untrusted repository content flowing through hooks, hostile processes, the
installer, the approval flow, logging and the supply chain. It found **10 problems (2 high,
5 medium, 3 low). All 10 are fixed, and each has a test that fails without its fix.** Full report:
[`docs/reviews/security-review-2026-11-17.md`](../reviews/security-review-2026-11-17.md).

| ID | Severity | Finding | Fix |
| --- | --- | --- | --- |
| SR-01 | High | The hook forwarder trusted the port in a stale `server.json`: whoever took the port got every prompt and the hook secret, and could make the forwarder print rewritten commands, permanent allow rules or injected context. | The forwarder only contacts a live server process of the same user, and only prints decisions signed with a per-start `responseKey` (HMAC over a per-request nonce), rebuilt as a plain allow or deny. |
| SR-02 | High | New approval cards appear at the top, so a click aimed at one card could approve another. | Allow/Deny ignore pointer clicks for 1 s after a card appears or moves; keyboard answers are not delayed. |
| SR-03 | Medium | Redaction and truncation could hide code in an approval (`TOKEN="$(curl …\|sh)"` shown as `TOKEN=[redacted]`). | Requests whose input was changed by sanitising are never held; the terminal shows them in full. |
| SR-04 | Medium | Approval cards shortened paths, showed one field for MCP tools, and passed invisible or text-reversing characters through. | Cards show the exact request with such characters made visible. |
| SR-05 | Medium | Unbounded object keys; greeting a new browser could crash the server. | Key limits, a history size cap, a crash-proof greeting. |
| SR-06 | Medium | The installer followed symlinks planted in a project's `.claude/` folder (it overwrote a stand-in `~/.bashrc` in testing). | Symlinked settings paths are refused. |
| SR-07 | Medium | A state folder owned by another user, or writable by others, was used as is. | The folder must belong to the user and is made 0700. |
| SR-08 | Low | `stop` could signal a recycled process id. | It checks the process is still the server first. |
| SR-09 | Low | WebSocket frame and half-close limits. | Limits added. |
| SR-10 | Low | Terminal escape sequences in CLI output (paths, errors). | Control characters are printed escaped. |

Also: `docs/CONTRACTS.md` and `docs/INTEGRATION.md` describe the new forwarder protocol, and a
fake-key fixture in the tests is now built at runtime so the secrets scan stays clean.

## Tests and results

| Check | Result |
| --- | --- |
| New tests: 22 unit and integration tests (4 new files, 11 extended) plus one end-to-end test of the click race on desktop and mobile | all fail without the fixes, pass with them |
| `npm run check:fast` on this branch (lint, config lint, typecheck, tests, licences, secrets) | pass, 674 / 674 tests |
| Full end-to-end run by the reviewer | 46 pass, 6 skipped by design |

## Assumptions

- The 1 s answer delay applies to pointer clicks only, so keyboard users are never slowed down.
- A forwarder from this version ignores unsigned answers from an older server; prompts then fall
  back to the terminal, which is safe. `andary start` refreshes the installed forwarder.

## Open items (residual risks, see the report)

- The sign-in cookie is sent to every port on `127.0.0.1` (cookies ignore ports): on a shared
  machine, a local web server run by another user could capture it. Closing this needs a change
  to ADR 0004 (for example an origin-scoped token sent as a WebSocket subprotocol).
- `/andary:town` pre-approves `node` commands for its turn. A narrower pattern would not help
  (`node -e …` matches any pattern that allows the real command), so the safe alternative is
  documented: run `andary start` in a terminal.
- Write/Edit approval cards show the exact path but not the content; the terminal shows the diff.
