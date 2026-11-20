# The town grows with you

Part 17 of 22 · base: `feat/town-weather`

## What changed

Finished work earns points and points build landmarks.

- **Points** (`public/js/core/growth.js`, `server/progress.mjs`, CONTRACTS §4.9): every
  finished turn, finished helper and completed task is a point; every day with any work is a
  busy day. Kept in `~/.andary/progress.json` (numbers and dates, 0600) and sent to browsers
  (`progress`, and in `hello`).
- **Landmarks** (`public/js/world/env/landmarks.js`): bunting over the north avenue (10), an
  ice-cream cart on the promenade (25), a curly-brace statue by the Workshop (50), a Ferris
  wheel on the beach that turns (100), a hot-air balloon drifting over the town (200) and a
  golden dome on the Town Hall (500). New ones rise into place with a toast and an
  announcement; with reduced motion they just appear and stand still. A stretch of beach is
  kept free for the wheel.
- **Demo**: starts at 92 points, kept in the browser.
- World facade `setLandmarks(ids, { grow })`; the environment lab takes `?grow=all`.

## Tests

- `test/unit/server/progress.test.mjs`: milestones, points and days, saving and loading
  (including bad files), the demo's count.
- `test/integration/usage.test.mjs`: a `Stop` hook adds a point that reaches the browser.
- `e2e/features.spec.mjs`: at 99 points, the next finished work brings the Ferris wheel with a
  toast (desktop and phone).
