# Third-party notices

Andary has **no runtime npm dependencies**. The browser app ships these third-party files,
copied unmodified from npm packages by `scripts/vendor.mjs`:

| Component | Version | Licence | Location | Licence text |
| --- | --- | --- | --- | --- |
| three.js (core and the addons listed in `scripts/vendor.mjs`) | 0.187.0 | MIT | `public/vendor/three/` | `public/vendor/three/LICENSE` |
| Overpass (latin, weights 400–800), via @fontsource/overpass | 5.3.0 | SIL Open Font License 1.1 | `public/vendor/fonts/` | `public/vendor/fonts/overpass.LICENSE` |
| Overpass Mono (latin, weights 400–600), via @fontsource/overpass-mono | 5.3.0 | SIL Open Font License 1.1 | `public/vendor/fonts/` | `public/vendor/fonts/overpass-mono.LICENSE` |

All other visuals (buildings, characters, effects, icons) and all sounds are generated in code
by this project; there are no third-party images, models or audio files.

Development-only tools (ESLint, TypeScript, Playwright, axe-core, Lighthouse via npx) are not
distributed. `npm run licenses` checks every installed package against the allow-list in
`scripts/check-licenses.mjs`.
