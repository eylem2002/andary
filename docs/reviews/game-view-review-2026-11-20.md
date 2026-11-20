# Independent review of the game view — 2026-11-20

Scope: commit `8a8d1bf` on `feat/game-view-director-camera` (the director camera, the full-screen
town, bigger figures). The reviewer had not seen the work. They read the code, ran lint,
typecheck, the dead-code check and the unit tests in their own worktree, and confirmed the
behavioural findings with throwaway Playwright scripts against the static server. Fixes are in
`cd79519`, each with a test.

Summary: 3 must-fix, 4 should-fix and 3 groups of nits; all fixed except the two-row phone toolbar,
which is kept on purpose (assumption 37). Security: nothing found.

| # | Severity | Finding | Fix | Test |
| --- | --- | --- | --- | --- |
| 1 | Must | With the boards put away, `A` and an approval toast's Review button focused a tab inside the inert board; focus fell to the page and the approval was unreachable. | Asking for a board tab brings the boards back first (`showTab` in `hud.js`). | e2e: "A reaches the approvals even with the boards put away" |
| 2a | Must | When the director stood back (a click on the town, a toolbar zoom, a selection) its own follow kept tracking the old subject. | The director's state machine stops a follow it started whenever it stands back. | unit: "when the viewer takes the camera…", "a selection makes it stand back…" |
| 2b | Must | Turning the director off stopped the viewer's own follow (F, then C). | It never stops a follow the viewer started. | unit: "never stops a follow the viewer started" |
| 3 | Must (WCAG 2.4.3) | Pressing `H` with focus in a board sent focus to the top of the page. | Focus moves to the button that brings the boards back. | e2e: "putting the boards away while focus is in them…" |
| 4 | Should | Without WebGL, a saved "hidden" choice hid the only view; `C` showed a caption that never updated. | Boards always show when the 3D view failed; the director needs a started view; both new buttons are hidden. | e2e: `no-webgl.spec.mjs` |
| 5 | Should | The caption could name a helper who had already left the 3D town; `Home` and `Escape` in the view did not count as using the camera; `Ctrl+-` did. | Subjects must be in the 3D town (`world.hasAgent`); `Home`/`Escape` added; modified keys and right-clicks ignored. | unit: "the subject is gone from the caption as soon as it leaves the town" |
| 6 | Should | The director ignored reduced motion. | Preference is `auto`/`on`/`off`; `auto` is off when motion is reduced. | unit: `directorOn`; e2e: "with reduced motion the director camera starts off…" |
| 7 | Should (WCAG 4.1.3) | The setup offer on a static host was a toast only, which screen readers do not hear. | Also announced, saying where the steps live. | covered by the static-host e2e flow |
| 8 | Nit | The director came back within 0.5 s of a selection ending. | It waits 20 quiet seconds, as documented. | unit: "a selection makes it stand back…" |
| 9 | Nit | Between 641 and ~710 px the toolbar ran off the screen; two places still used the fixed toolbar height. | The toolbar wraps on narrow windows; everything above it uses `--tools-h`. The two-row phone toolbar stays (assumption 37). | screenshots at 660, 800 and 375 px |
| 10 | Nit | Moments were never pruned; a duplicate of `HISTORIC_MS`; the contract did not list `zoom`; `HudContext.cinema` typed as never null; `aria-hidden` on the only text about the shot in full-screen mode; right-click paused the director. | All addressed (`forget()`, shared constant, contract row, documented cast, plain-text caption, primary button only). | unit: `forget`, `isNews` |

Test gaps the reviewer listed and how they are covered now: the director's state machine moved
into `shots.js` (no DOM) and has 9 unit tests; end-to-end tests cover approvals with the boards
put away, `H` with focus inside a board, the no-WebGL path with a saved "hidden" choice, and
reduced motion. The phone caption above a two-row toolbar was checked on screenshots only.

Checks that passed in review: caption contrast 15.6:1 and 10.4:1 (light), 15.7:1 and 9.4:1 (dark);
targets 42–44 px; `inert` plus delayed `visibility` on the hidden boards; extending the
reduced-motion CSS to the HUD roots is safe (no script waits for animation events); session text
reaches the DOM only as text, building keys go through `Object.hasOwn`, nothing new is sent to the
server.
