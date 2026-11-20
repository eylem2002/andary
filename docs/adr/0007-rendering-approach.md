# 0007 — three.js orthographic diorama with quality tiers

Status: Accepted

## Context

The brief asked for "realistic, good graphics, funny and interactive". Pixel-art office
visualisers already exist; a 3D miniature town is distinctive and matches the reference image.
It must still run smoothly on laptops without a discrete GPU and on phones.

## Decision

- three.js (WebGL 2) with an orthographic isometric camera, a single shadow-casting sun, MSAA or
  SMAA, subtle bloom and a tilt-shift pass that makes the town read as a miniature model.
- Everything is procedural geometry (no model or texture downloads); static geometry is merged
  and repeated props are instanced to keep draw calls low.
- Two quality tiers. `auto` picks low on touch devices, small screens or few CPU cores. Low
  turns off shadows, bloom and tilt-shift and caps the pixel ratio at 1.
- Text (names, bubbles, signs) is DOM overlay positioned by projection: crisp at any zoom,
  translatable, and cheap.

## Consequences

- No asset pipeline and nothing to license beyond three.js itself.
- WebGL is required for the 3D view; without it the HUD still works and explains why.
