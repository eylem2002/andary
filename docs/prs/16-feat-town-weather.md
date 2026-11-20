# Weather from real events

Part 16 of 23 · base: `feat/cost-meter`

## What changed

The whole town's weather now follows the work.

- **Rules** (`public/js/core/town-weather.js`, pure): failures rain (test failures count
  double; the rain halves every minute), a pile of failures or a failed turn brings a storm,
  tests passing again within ten minutes of failing bring a rainbow for half a minute, and a
  crew thinking for over 30 s without a tool brings fog. Interrupts never rain.
- **Driver**: the HUD feeds it the store's events and sends the result to the world at most
  once a second, only when it changed; Settings → Town weather turns it off (saved).
- **Sky** (`public/js/world/env/weather-sky.js`, pure; `atmosphere.js`): grey, dimmer light,
  no stars, closer fog, eased so it never jumps.
- **Effects** (`public/js/world/env/town-weather-fx.js`): rain moved by the GPU (one draw call,
  fewer drops on low quality), a lightning bolt and flash now and then in a storm, a rainbow
  behind the town that turns with the camera. With reduced motion the rain stands still and
  there is no lightning.
- **World facade**: `setTownWeather(w)` (CONTRACTS §6). The environment lab takes
  `?weather=rain|storm|fog|rainbow`.
- Screen readers hear storms and rainbows (when "Read out activity" is on).

## Tests

- `test/unit/world-env/weather.test.mjs`: every rule, fading, the driver (changes only,
  turned off, reset) and the sky blend.
- `e2e/features.spec.mjs`: the demo's failing test brings weather; turning it off in Settings
  clears it and is saved (desktop and phone).
