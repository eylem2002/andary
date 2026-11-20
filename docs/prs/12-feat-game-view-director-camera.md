# Director camera and the full-screen town

Part 12 of 12 · base: `docs/readme-adrs-and-reports` · merge last

## What changed

The town now plays like a game you watch: the agents are big enough to read as people, and the
camera goes to wherever the action is.

- **Director camera** (`public/js/ui/shots.js`, `public/js/ui/cinema.js`). It scores every event
  (a subagent or crew arriving, a permission prompt and a failure score highest; handoffs,
  finished tasks and compactions next; routine tool calls lowest), lets each score fade over
  9 s, and follows the agent with the strongest pull in close-up. A shot lasts 5.5–11 s and only
  a strong moment cuts in early; every fourth shot is a wider one. A caption names who is on
  screen, their role, the building and what they are doing. It stands back while you select an
  agent or move the camera, and carries on after 20 quiet seconds. `C` or the toolbar button
  turns it off and on (on by default, off by default when motion is reduced).
- **Full-screen town.** `H` or the toolbar button slides the side boards out and makes them inert
  (out of the tab order and the accessibility tree); your choice is remembered. A demo on a static
  host opens this way, and offers the setup steps in a toast after 8 s (also announced) instead
  of a dialog over the first view. Asking for a board tab (`A`, or Review on an approval toast)
  brings the boards back; focus inside them moves to the panels button when they go. If the 3D
  view cannot start, the boards always stay.
- **Bigger people.** Figures are drawn 1.6× life size (was 1.3×).
- **Phones.** The sheets are measured again when the boards hide, the toolbar settles at the
  bottom clear of the home indicator, and the caption rides on the toolbar's real height (it
  wraps to two rows in the demo). Shots zoom 1.5× further, because zoom 1 shows less of the town
  on an upright phone.
- **World facade**: `focusAgent(id, { follow, zoom })` takes an optional zoom
  (`docs/CONTRACTS.md` §6); new test id `director-caption` (§8.1).
- **Independent review.** A reviewer who had not seen the work found 3 must-fix problems
  (approvals unreachable with the boards put away, the director holding on to a follow it should
  have dropped, focus lost when the boards hide), 4 should-fix and some nits; all fixed in the
  second commit, each with a test
  ([`docs/reviews/game-view-review-2026-11-20.md`](../reviews/game-view-review-2026-11-20.md)).
  The director's state machine now lives in `shots.js` without the DOM and is unit-tested; the
  preference is `auto`/`on`/`off`, where `auto` is off when motion is reduced.
- **Docs**: README section and screenshot, assumptions 34–37, final report, QA notes for this
  change ([`docs/qa/checks-2026-11-20.md`](../qa/checks-2026-11-20.md)).

## Tests and results

| Check | Result |
| --- | --- |
| `npm run check:fast` | pass, 710 / 710 tests |
| Playwright end-to-end and accessibility suites | 60 pass, 12 skipped by design (keyboard-only cases on the phone profile) |
| axe (WCAG 2.2 A/AA) on every scanned view | 0 violations |
| New unit tests | the director (`test/unit/ui/shots.test.mjs`, 31 tests): interest, fading, minimum and maximum shot length, strong moments, agents who left, wide shots, standing back and resuming, never stopping the viewer's follow, reduced motion, history replays; prefs and shortcuts |
| New end-to-end tests | close-ups and the caption, `C` on and off, standing back on a selection, `H` and the boards leaving the tab order, focus handed to the panels button, approvals with the boards put away, reduced motion, toolbar buttons on desktop and phone, the static-host start, a browser without WebGL |

## Assumptions

Listed in `docs/ASSUMPTIONS.md`, 34–37: director on by default and when it stands back, what
counts as interesting, the full-screen start on a static host, the wrapping phone toolbar.

## Open items

- Smoothness of the camera between shots was only seen with software rendering (2–3 fps here,
  recorded with a slowed clock); check on real hardware.
