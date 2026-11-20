# HUD, approvals, live/demo boot and end-to-end suites

Part 7 of 30 · base: `feat/event-core-and-simulation` · the app works end to end from here

## What changed

The interface around the town, and the boot logic that ties everything together.

- **Boot** (`main.js`): asks `/api/hello`; if an Andary server answers, connects live over the
  WebSocket (with reconnect and backoff), otherwise plays the demo. `?demo=1` forces the demo;
  `andary demo` opens it that way and Settings then offers "Leave the demo". If WebGL fails, the
  HUD keeps working and says why.
- **Design**: the brand is a green street sign; crews are drawn as metro lines with a numbered
  roundel (also their 1–9 shortcut) and agents as stations; every status has its own shape as
  well as colour. Paper-board panels; dark theme at night or on request.
- **Panels**: Crews (goal, agents, what each is doing, for how long); Tasks (goal, todos and team
  tasks with progress); Activity (filter by crew, errors only, pauses scrolling while you read);
  Approvals (agent, tool, the exact command or file, countdown, Allow/Deny, or "answer in your
  terminal" when remote approvals are off). Agent inspector (tools used, recent files and
  activity, last message, Follow) and building cards.
- **Toolbar and shortcuts**: follow, rotate, zoom, reset, day/night/auto, quality, sound, pause
  and speed in the demo, help. Keys: F, Esc, [ ], + −, 0, N, M, A, 1–9, Space, ?.
- **Dialogs**: settings (remote approvals, theme, motion, quality, volume, announcements), help,
  and a setup guide with copyable commands for visitors of a hosted demo.
- **Accessibility**: landmarks, labelled controls, visible focus, real dialogs, polite live
  region (at most one summary every 5 s), reduced motion, reflow on phones with a bottom sheet
  and 44 px targets. **Sound** is synthesised in the browser and off by default.
- **Safety**: all text set with `textContent` through a tiny `h()` builder; no inline handlers or
  styles, so the strict CSP holds.

## Tests and results

| Suite | Result |
| --- | --- |
| Unit (`test/unit/ui`): formatting, countdowns, path shortening, filters, shortcut mapping, prefs | 70 pass |
| `e2e/demo.spec.mjs`: crews, log, tasks, inspector, demo approval, toolbar, hosted setup, leaving a forced demo | pass, desktop + mobile |
| `e2e/hud.spec.mjs`: keyboard navigation and shortcuts, building cards, sign-in hint | pass (keyboard-only cases skipped on mobile) |
| `e2e/live.spec.mjs`: sign-in, hook events to rows and log, approval round trip allow and deny | pass, desktop + mobile |
| `e2e/a11y.spec.mjs` (axe, WCAG 2.0/2.1/2.2 A + AA): main view light and dark, inspector, help, settings, setup, approval card | 0 violations, desktop + mobile |
| All unit + integration tests on this branch | 652 pass |
| Playwright total | 44 pass, 6 skipped by design |

## Assumptions

- The remote-approvals switch lives in Settings; the global A shortcut only focuses the
  Approvals tab, so pressing it twice can never approve anything.
- The setup guide installs with `npm install -g github:eylem2002/andary` (no npm publication).
- Phones open on the Crews tab; the setup guide shows once per browser.

## Open items

- Crew numbers can shift when ended sessions are pruned.
- Without WebGL the camera buttons have nothing to move.
