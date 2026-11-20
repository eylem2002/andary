# Characters, animation and the world facade

Part 5 of 27 · base: `feat/town-environment`

## What changed

The people of the town, and the single API the app uses to drive the 3D world.

- **Characters**: chunky toy figures with crew-coloured clothes, varied skin tones and faces.
  Hats show the role or model (hard hat and hi-vis vest for the Foreman, crown for Opus, beret
  for Sonnet, sun hat for Haiku, wizard hat for Fable/Mythos, caps for helpers), and each agent
  type carries its kit (Explore a magnifier, Plan a blueprint roll, general-purpose a toolbox,
  teammates a backpack).
- **Animation** for every activity: walk, run, read, type, hammer, search, think, wait (with
  growing impatience), celebrate, facepalm, sleep, sip coffee, carry, wave, spa, write.
- **Walking**: routes on the street network, free work spots at each building and a queue when
  they are full, lanes so crowds don't overlap, teleport when the town has to catch up.
  Working agents turn three-quarters to the camera so you see faces, not backs.
- **Entrances and exits**: through the Town Hall portal, by bus, or with a pop.
- **Overlay**: crew-coloured name pills with a status dot that differs in shape as well as
  colour; speech, thought, shout and code bubbles that stay readable and move out of each
  other's way; emotes. In a crowd, lower-priority pills shrink to their dot so names stay legible.
- **Effects**: sparks, smoke, confetti, fireworks, flying books, portal swirls and more (pooled);
  personal rain clouds and storms; paper planes for messages between agents.
- **World facade** `world.js`: owns the renderer and frame loop (paused in hidden tabs),
  picking, the keyboard camera (arrows, +/−, Q/E, Esc), quality and reduced motion. One draw call
  per agent, no allocations in the frame loop.
- **Lab page** `world-lab.html` with scenarios for every hat, activity, effect, bubble and queue.

## How to try it

`python3 -m http.server --directory public`, then open
`/world-lab.html?scenario=lineup` (also `activities`, `bubbles`, `effects`, `crowd`, `queue`,
`weather`, `entrances`).

## Tests and results

| Check | Result |
| --- | --- |
| Unit (`test/unit/world-agents`): spot allocation and queues, route planning, bubble truncation and de-overlap, crowded-pill selection, animation state machine, easing, input mapping, looks | 78 pass |
| Lint, typecheck | pass |
| Every World method exercised in the browser against the real environment | no console errors |
| 20 agents | 46 draw calls (low), 96 (high) |

## Assumptions

- Figures are drawn 1.3× life size so they read next to doors and lamps; everyone walks on the right.
- The bus takes about 6 s to pull in; the facade waits that long before passengers step out.

## Open items

- A signal from the environment when the bus has arrived would replace that fixed wait.
- 60 fps was not measurable in the build environment (software rendering only).
