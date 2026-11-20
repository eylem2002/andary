# More town looks

Part 21 of 26 · base: `feat/ambient-sound`

## What changed

Settings → **Town look** rebuilds the town in one of five looks (`public/js/world/env/look.js`):

- **Sunset coast** (default, as before);
- **Snowy village**: painted wooden houses with white trims, snowy ground and roofs, pines,
  warm fairy lights, an icy sea, snowmen instead of umbrellas, and the town's rain falls as
  drifting snow;
- **Neon city**: dark towers with bright neon, a violet haze by day, lights that never go
  out;
- **Desert oasis**: adobe walls, tiled teal accents, sand, palms and red rock;
- **Amman old town**: the first limestone look, with its own sky, sea and island sides.

Each look overrides the shared tones, each building's paint, the neon, the sea, the island's
strata, the trees and the beach (`look-palettes.js`); the sky keys are the coast's or Amman's,
tinted per look (`skyKeysFor` in `daynight.js`). The look is read when the page loads (`?look=`
or the saved `townLook`), so changing it reloads the page.

## Tests

- `test/unit/world-env/looks.test.mjs`: choosing the look, every look's paint covers every
  building with real neon names and no colliding shared tones, styles are complete, and every
  sky runs in order from midnight (and the neon city's lights stay on).
- `e2e/features.spec.mjs`: switching the look in Settings reloads into it and keeps it.
- Screenshots of all looks in `docs/media/andary-looks.webp`.
