# The 3D town environment

Part 4 of 23 · base: `feat/server-hooks-cli`

## What changed

The town itself, drawn with three.js from code (no model or texture downloads).

- **The place**: a limestone hill town by the sea on a floating diorama plinth with visible
  soil layers, golden domes, rooftop water tanks and solar heaters, palms, cypresses and round
  teal trees, a promenade with railings, a plaza with a fountain and string lights.
- **Fifteen buildings**, each recognisable at a glance and with its door on the street: Town Hall
  (golden dome, columns, portal arch), Library (giant open book), Workshop (sawtooth roof,
  forge), Terminal Works (smokestacks, big screen with a blinking prompt), Search Bureau
  (observatory and magnifier), Web Tower (lattice tower, turning dish), Goal Board (live
  billboard), Post Office (garage for the mail truck), MCP Harbor (warehouse, crane, containers,
  pier), Permit Office, Memory Spa (pool and steam), Skill Academy (clock tower), Café (awning
  and tables), Worktree Grove (a labelled tree per worktree), Bus Stop.
- **Small jokes**: a literal sandbox labelled "Sandbox" and a node_modules box pile that grows
  with every `npm install`.
- **Life**: cars on the ring road, a bus that comes and goes through tunnels, the mail truck,
  boats, drifting clouds, birds, smoke and steam.
- **Day and night** that follow the local clock: sun path, sky gradient, fog, lit windows,
  street lamps; bloom at night; tilt-shift for the miniature look.
- **Camera**: orthographic isometric view, damped drag-pan, wheel and pinch zoom, animated 90°
  rotation, focus and follow, keyboard support.
- **Signs**: white DOM pills above each building with a live counter ("42 reads"), clickable.
- **Performance**: static geometry merged per material, trees and boxes instanced. 54–61 draw
  calls on high quality, 25–29 on low (no shadows or post-processing, pixel ratio 1).
- **Lab page** `world-env-lab.html` with controls for every feature.

## How to try it

`python3 -m http.server --directory public`, then open `/world-env-lab.html`
(`?t=21` for night, `&q=low` for low quality).

## Tests and results

| Check | Result |
| --- | --- |
| Unit (`test/unit/world-env`, 6 files): day/night colour and sun maths, camera maths, board text wrapping, sign formatting, lane paths, grove slots, geometry | 50 pass |
| Lint, typecheck | pass |
| Visual check, day / golden hour / night, high and low, desktop and phone | done (screenshots in the docs PR) |

## Assumptions

- The sun follows a stylised winter arc so building fronts stay lit all day.
- `'auto'` quality means high here; the world facade (part 5) picks low on phones and small screens.

## Open items

- Cars do not know where agents stand, so they can drive through agents at the south-row doors.
- The grove holds 12 worktree trees at once; more worktrees wait for a free slot.
- Frame rates were measured only on a software renderer (no GPU in the build environment).
