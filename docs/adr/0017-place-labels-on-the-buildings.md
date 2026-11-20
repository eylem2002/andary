# 0017 — Place labels on the buildings, and agents first

Status: Accepted

## Context

Every building had a white name pill floating above its roof, always on. On an isometric view the
space above a roof is the street behind it, which is where the next building's agents stand, so
fifteen pills covered the very people the town exists to show. Any DOM label covers the 3D
canvas under it, whatever it looks like; what matters is where it sits and when it gives way.

Options considered:

- **3D signboards painted on the facades.** Depth-tested, so agents would pass in front of them
  naturally. Rejected: at the whole-town view the text is a few pixels tall and slanted; several
  places have no walls to hang a sign on (the grove, the harbour pier, the bus stop, the
  node_modules pile); and turning the camera puts half the signs on the far side.
- **Icon-only markers with names on hover.** Clean, but the names are never on screen, so the town
  teaches nothing until you point at every building.
- **Labels on the buildings themselves, in screen space, with rules** (chosen).

## Decision

- A building's label sits inside its own outline: about two thirds up its front, centred on it.
  It never floats over the street behind.
- In `auto` (the default) the name shows only when it fits on the building at the current zoom
  (a share of the lot's width on screen); otherwise the label is the building's icon alone. Zoom
  in and the names appear.
- Agents come first. A figure standing in front of a label (its feet on the near side of the
  building, its body across the label) fades the label to 10% and takes the clicks. Figures
  behind a building are hidden by the building itself, so they do not fade its label.
- When labels collide the one nearer the camera keeps its place; the farther one shrinks to its
  icon, and hides if even that collides. Nothing moves up.
- The hovered and the selected building always show their name, whatever the mode. Worktree tags
  (data, not place names) always show.
- `P` and Settings → Place names switch between `auto`, `always` (every name, nearer on top)
  and `off` (no labels until you point at a building). The choice is saved with the other
  preferences.
- The look is a small dark plate, like a shop sign, instead of a bright white pill with a
  pointer: it reads on light and dark buildings by day and night without glaring.
- The rules are pure (`env/sign-layout.js`) and unit-tested; `env/signs.js` projects, measures
  and writes only what changed. The facade passes the crowd's screen boxes in
  (`setFigures`), as it already did for vehicles (`setPedestrians`): env/ and agents/ still do
  not import each other.

## Consequences

- The whole-town view shows names on the larger buildings and icons on the small ones; the help
  dialog's building list and the HUD carry every name as text, as before.
- A label can blink out while someone walks past it. The fade is a short transition (none with
  reduced motion), and only figures in front count.
- Labels are measured once (and again after a font load or a stat change), so the per-frame cost
  is projection and a few comparisons for fifteen buildings and a handful of tags.
