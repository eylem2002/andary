import { test } from 'node:test';
import assert from 'node:assert/strict';
import { areaOf, importsOf, violations } from '../../../scripts/check-boundaries.mjs';

test('files belong to the most specific area', () => {
  assert.equal(areaOf('server/cli/start.mjs'), 'cli');
  assert.equal(areaOf('server/adapters/codex.mjs'), 'server');
  assert.equal(areaOf('public/js/world/env/lab/lab.js'), 'lab');
  assert.equal(areaOf('public/js/world/env/water.js'), 'env');
  assert.equal(areaOf('public/js/world/world.js'), 'world');
  assert.equal(areaOf('test/unit/x.test.mjs'), null);
});

test('only runtime imports count: JSDoc type references may cross', () => {
  const text = [
    "import { a } from './a.js';",
    "export { b } from '../b.js';",
    "const c = await import('./c.js');",
    "/** @typedef {import('../ui/types.js').X} X */",
    " * @param {import('../world/world.js').World} world",
  ].join('\n');
  assert.deepEqual(importsOf(text), ['./a.js', '../b.js', './c.js']);
});

test('the rules catch the crossings the architecture forbids', () => {
  const found = violations([
    { file: 'public/js/ui/hud.js', text: "import { LOOK } from '../world/env/look.js';" },
    { file: 'public/js/core/store.js', text: "import { h } from '../ui/dom.js';" },
    { file: 'server/routes.mjs', text: "import { createStore } from '../public/js/core/store.js';\nimport { localDate } from '../public/js/core/dates.js';" },
    { file: 'hooks/hook.mjs', text: "import { x } from '../server/config.mjs';" },
    { file: 'public/js/world/world.js', text: "import { water } from './env/water.js';\nimport { createEnvironment } from './env/environment.js';" },
    { file: 'public/js/world/env/water.js', text: "import * as THREE from 'three';\nimport { Crowd } from '../agents/crowd.js';" },
  ]);
  assert.deepEqual(found.map((v) => `${v.file} ${v.spec}`), [
    'public/js/ui/hud.js ../world/env/look.js',
    'public/js/core/store.js ../ui/dom.js',
    'server/routes.mjs ../public/js/core/store.js',
    'hooks/hook.mjs ../server/config.mjs',
    'public/js/world/world.js ./env/water.js',
    'public/js/world/env/water.js ../agents/crowd.js',
  ]);
});

test('an import wrapped over several lines is still checked', () => {
  const text = "import {\n  createWorld,\n  disposeWorld,\n} from '../world/world.js';\nexport {\n  LOOK,\n} from '../world/env/look.js';";
  assert.deepEqual(importsOf(text), ['../world/world.js', '../world/env/look.js']);
  assert.equal(violations([{ file: 'public/js/ui/hud.js', text }]).length, 2);
});

test('a module the server shares may only bring other shared modules with it', () => {
  const found = violations([
    { file: 'public/js/core/text.js', text: "import { BUILDINGS } from './catalog.js';" },
    { file: 'public/js/core/growth.js', text: "import { localDate } from './dates.js';" },
  ]);
  assert.deepEqual(found.map((v) => `${v.file} ${v.spec}`), ['public/js/core/text.js ./catalog.js']);
});

test('the server runs the stuck rules the town runs (core/loops.js), and nothing they do not bring', () => {
  const found = violations([
    { file: 'server/notify.mjs', text: "import { createLoops } from '../public/js/core/loops.js';" },
    { file: 'public/js/core/loops.js', text: "import { clip } from './text.js';\nimport { describeTool } from './catalog.js';" },
  ]);
  assert.deepEqual(found.map((v) => `${v.file} ${v.spec}`), ['public/js/core/loops.js ./catalog.js']);
});

test('the page load is read in page.js: the HUD and the town may read it, core may not', () => {
  const found = violations([
    { file: 'public/js/ui/hud.js', text: "import { LOOK } from '../page.js';" },
    { file: 'public/js/world/env/palette.js', text: "import { LOOK } from '../../page.js';" },
    { file: 'public/js/core/store.js', text: "import { LOOK } from '../page.js';" },
  ]);
  assert.deepEqual(found.map((v) => v.file), ['public/js/core/store.js']);
});
