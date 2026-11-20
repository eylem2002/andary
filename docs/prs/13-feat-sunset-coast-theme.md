# The sunset-coast look

Part 13 of 26 · base: `feat/game-view-director-camera`

## What changed

The town trades its limestone hill-town look for an original sunset coast: pastel stucco, palms,
a beach, a pink-and-violet dusk and neon at night. Nothing is taken from any game; it is our own
palette and models (`docs/ASSUMPTIONS.md` 38).

- **Paint per building** (`palette.js` `PAINT`, `paintMap`, `shade`; `kit.js`). Buildings keep
  naming shared materials and the kit repaints them per building: a white Town Hall with a
  turquoise dome, a mint Library, a yellow Skill Academy, a peach Workshop and so on.
- **Details.** Eyebrow sunshades over windows, neon strips under cornices that glow at night,
  rooftop AC units, vents and dishes instead of water tanks, a smooth stucco texture in the town
  shader, and a few windows lit cyan or pink.
- **Beach** (`beach.js`). A sloping strip of sand west of the harbour with umbrellas, loungers,
  towels, a lifeguard tower, palms and a rock groyne; the sea's foam follows its waterline.
- **Sea and sky.** Turquoise shallows, an azure day, a golden-to-hot-pink dusk and violet nights
  (`daynight.js`), with pink and cyan light streaks on the water at night.
- **Colour grade** (`grade.js`, `post.js`). Slightly richer saturation and contrast, cool shadows
  and warm highlights by day, violet shadows at night, folded into the tilt-shift pass.
- **Sunset setting.** `N` cycles local clock → day → sunset → night; sunset holds 18:00.
- **HUD.** Pink-to-violet sign, warm paper boards, plum dark mode; contrast checked.
- More palms on the rim, neon string lights over the plaza, pink and teal cars.

## Tests

- New `test/unit/world-env/theme.test.mjs`: paint for every building, `shade`, `paintMap`,
  the beach slope and waterline, the day/night grade blend.
- `npm run check:fast` passes; end-to-end 60 passed, 12 skipped (both projects), axe included.
- README screenshots regenerated.
