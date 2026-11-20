# Code-quality review: 2026-11-17

An independent review against the owner's "clean code" standard: no dead code, clear names, small
functions, comments that explain why, one consistent structure, and clean lint and typecheck.
No behaviour was changed. Every gate stayed green throughout (see §9).

## 1. Scope and method

- **Scope:** every first-party ES module (`bin/`, `server/`, `hooks/`, `scripts/`,
  `public/js/**`, `test/`, `e2e/`), about 39,800 lines. `public/vendor/` and `node_modules/` are
  out of scope.
- **Order of work:** `docs/CONTRACTS.md` first (§3 rules and the store, world and env contracts),
  then area by area: server and core first, then UI, then world.
- **Tools:**
  - `scripts/find-unused-exports.mjs` for dead exports.
  - ESLint with stricter one-off thresholds (`max-lines-per-function` 60, `complexity` 12) to rank
    candidates. The unix formatter is gone in ESLint 10, so I summarised the JSON output instead.
  - A one-off espree script that measures each function's *own* body, with nested functions
    excluded. ESLint's length rule counts every closure inside a `createX()` factory as part of the
    factory, which overstates factory length in this codebase.
  - `tsc --noUnusedParameters` as a one-off probe.
  - Greps for `console.*`, `debugger`, TODO/FIXME, commented-out code, suppressions, stale file
    and identifier references in comments, naming and catch-variable conventions, and duplicated
    helpers.
- **Checks:** after each batch I ran `npx eslint . --max-warnings=0`, `npx tsc -p tsconfig.json`
  and `node --test "test/**/*.test.mjs"`. The Playwright suites ran once at the end.

## 2. Dead code

### 2.1 Detector results

| Category | Before | After |
| --- | --- | --- |
| Dead exports (never imported or used) | 4 | **0** |
| Exports used only by tests | 6 (4 were detector false positives) | **0** |
| Exports used only inside their own file | 50 | **3** (deliberate, §2.3) |

### 2.2 Removed

| Symbol | File | Why it was dead |
| --- | --- | --- |
| `SPAWN_TOOLS` | `public/js/core/catalog.js` | Spawn detection is table-driven in `events.js` (`DERIVE_ON_START`/`DERIVE_ON_END`). |
| `cachedGeometryCount` | `public/js/world/agents/figure.js` | Documented as "for tests and stats", but neither used it. |
| `restPosition`, `BONE_COUNT` | `public/js/world/agents/rig.js` | Never read. `REST_MATRICES` stays because it feeds the shared bind inverses. |
| `angleDelta` | `public/js/world/env/lane-path.js` | App-dead; only its own test kept it alive. It duplicated `wrapAngle` in `agents/easing.js`. The test was removed with it. |
| `pick` | `public/js/world/env/rand.js` | App-dead; only one assertion kept it alive. The assertion was removed with it. |
| `name` parameter of `commandHelp` | `server/cli/main.mjs` | Never read: `command.usage` already names the command. |

### 2.3 `export` dropped

47 symbols in 24 files were never imported, only used inside their own file:

- **core, sim, ui:** `catalog.js` `MODEL_HATS`; `sim/procedural.js` `proceduralTurn`;
  `ui/activity.js` `MAX_ROWS`; `ui/format.js` `STATUS_LABELS`.
- **world/agents:** `activities.js` (5), `animator.js`, `bubbles.js`, `figure.js` (3), `input.js`,
  `looks.js` (6), `particles.js`, `tags.js` (2).
- **world/env:** `atmosphere.js`.
- **scripts:** `scan-secrets.mjs` `RULES`.
- **server:** `auth.mjs`, `browsers.mjs`, `cli/replay.mjs` (2), `cli/simulate.mjs`,
  `cli/start.mjs`, `installer.mjs` (7), `routes.mjs` (2), `security.mjs` (2), `state-file.mjs`
  (2), `static.mjs`, `websocket.mjs`.

Lint (`no-unused-vars`) and tsc (`noUnusedLocals`) stayed clean afterwards. That also proves that
none of these symbols was "used" only inside a comment.

**Kept exported on purpose (3).** These are generic primitives of small utility modules. The
detector reports them but does not fail on them.

- `ui/dom.js` `append`: the DOM builder's documented sibling of `h`, taking the same `Child` type.
- `agents/color.js` `toHex`: the inverse of the exported `parseHex`.
- `agents/color.js` `relativeLuminance`: the WCAG primitive behind the exported `contrastRatio`.

### 2.4 Detector fixes

- **False positives.** `usesInOwnFile` discounted every line that *started* with `export` and
  mentioned the name. A constant used as a default parameter therefore looked unused, for
  example `export function truncateText(text, max = BUBBLE_MAX_CHARS)`. It now discounts only the
  declaration itself, plus the local declaration and list entry for names exported through
  `export { name }`. This removed 4 false "test-only" reports (`DEMO_APPROVAL_MS`,
  `BUBBLE_MAX_CHARS`, `BUBBLE_MIN_VISIBLE_MS`, `MAX_STRING_CHARS`) and changed nothing else.
- **Robustness.** The detector lists files with `git ls-files --cached`, so a file deleted or
  moved in the working tree but not yet staged made it crash on `readFileSync`. That would have
  broken `npm run check:fast` in the pre-push hook. Such paths are now skipped.

### 2.5 Other dead-code checks

- **`console.log` in browser code:** none.
  - The remaining `console.error`/`warn` calls report real failures (boot, director, store
    listeners, world calls).
  - `dev/fake-world.js` uses `console.debug`, only behind the documented `&log=1` option.
  - Lint now enforces this (§5).
- **Other leftovers:** no `debugger` statements and no commented-out code. No TODO/FIXME comments;
  every grep hit is simulation data or a humour line.
- **Suppressions:** two `eslint-disable-next-line no-control-regex`, both justified inline.
- **Unused parameters:** `tsc --noUnusedParameters` reported 39. All but one are uniform
  signatures in dispatch tables, which is the right shape for a table:
  - store handlers `(m, e, s, a)`
  - building builders `(kit, lot)`
  - `update(dt, elapsed)`
  - director `ARRIVAL_EXTRAS`

  The one exception was `commandHelp`'s `name` (§2.2).

### 2.6 Gate wiring

- `package.json`: `"deadcode": "node scripts/find-unused-exports.mjs"`.
- `scripts/check.mjs`: a "Dead code" step after Typecheck, in both fast and full runs. The summary
  column is now as wide as the longest step name; one name was longer than the old fixed width.
- `.github/workflows/ci.yml`: `- run: npm run deadcode` after `npm run typecheck`.
- `.githooks/pre-push` comment and `docs/CONTRACTS.md` (§2 layout, §3 rules) now list the gate.

## 3. Function size and complexity

### 3.1 Overall picture (app code; tests and e2e excluded)

| Measure | Before | After |
| --- | --- | --- |
| ESLint probe: functions over 60 lines (closures counted in the outer function) | 32 | 32 |
| ESLint probe: functions over complexity 12 | 22 | 17 |
| Highest complexity | 20 (`connection.js` `handle`) | 19 (`input.js` `keyAction`, a flat key switch) |
| Longest function by the ESLint measure | 120 (`createApprovalsPanel`) | 113 (`camera-rig.js` `attachInput`) |
| Own body over 60 lines (nested functions excluded) | 1 | 1 (`effect-shapes.js` `createEffectShapes`, geometry) |
| Own body over 40 lines | 6 | 5 |

The own-body measure shows that functions in this codebase are already mostly small. The 32
"long" functions in the ESLint list are almost all closure factories made of many short members.

### 3.2 Refactored functions

| Function | Own lines | Complexity | Change |
| --- | --- | --- | --- |
| `core/connection.js` `handle` | 20 → 9 | 20 → ≤12 | One early return replaces five `message?.` checks; the `hello` snapshot, the only handler with real logic, is now `applyHello`. |
| `ui/approvals.js` `updateCard` | 30 → 9 | 19 → ≤12 | Split into `describeRequest` (who asks, in which crew, to run what) and `showAnswerState` (which controls the card shows). |
| `ui/approvals.js` `createCard` / panel | 25 → 8; panel 120 → 99 (ESLint) | n/a | The card markup moved to module-level `buildCard`, so `createCard` holds only behaviour. The listeners capture the parts object directly; it is set once per card and never replaced. |
| `server/cli/main.mjs` `main` | 35 → 25 | 18 → 13 | `--version`/`--help` aliases are lookup lists. Parsing, per-command help and the run moved to `runCommand`, which is still awaited inside `main`'s `try`, so usage errors are handled as before. |
| `core/store.js` `approvalChanged` | 21 → 16 | 17 → ≤12 | The agent's waiting/working transition is now `waitForAnswer`. |
| `ui/format.js` `shortenPath` | 18 → 5 | 14 → ≤12 | Its two documented steps are now `crewRelativePath` and `collapseMiddle`, and the reassigned `let text` is gone. Every caller passes a constant positive `max`, so the dropped empty-string guard changes nothing reachable. |
| `server/app.mjs` `startTownServer` | 44 → 33 | 14 → ≤12 | Option defaults are now `withDefaults`; the HTTP server and its time limits are `createHttpServer`. |

### 3.3 Remaining over the probe thresholds (all below the lint gate of 120 lines / 20)

| Complexity | Function | Why it stays (see §6) |
| --- | --- | --- |
| 19 | `world/agents/input.js` `keyAction` | Flat key → action switch. |
| 18 | `ui/hud-actions.js` `select` | 19 readable lines; the count comes from `?.` and three default parameters. |
| 17 | `ui/format.js` `describeApproval` | Already table-driven (`APPROVAL_WORDING`); 13 lines. |
| 16 | `world/agents/effects.js` `emit` | Validation guard plus a recipe lookup. |
| 15, 13 | `server/ws-frame.mjs` `encodeFrame`, `readHeader` | RFC 6455 rules, in order. |
| 14 | `hooks/hook.mjs` `decisionFrom` | Security check: signature, then a rebuild of two allowed shapes. |
| 14 | `core/director.js` `contextFor` | One object literal of `??` fallbacks. |
| 14, 13 | `core/store.js` `upsertTask`, `relabel` | 10–17 readable lines each. |
| 14 | `ui/shortcuts.js` `shortcutFor`, `world/env/vehicles.js` `stepCargo`, `world/lab/lab.js` `main` | Small key tables, an animation step, and a lab boot. |
| 13 | `sim/procedural.js` `planMoves`, `ui/hud-actions.js` `handleShortcut`, `ui/hud-effects.js` `effectFor`, `server/cli/main.mjs` `main` | Short guard chains. |

## 4. Changes by theme

- **Dead code (§2):** `catalog.js`, `figure.js`, `rig.js`, `lane-path.js`, `rand.js`,
  `server/cli/main.mjs`, 47 dropped `export`s in 24 files, and two test files
  (`test/unit/world-env/lane-path.test.mjs`, `misc-helpers.test.mjs`).
- **Smaller functions (§3.2):** `core/connection.js`, `core/store.js`, `ui/approvals.js`,
  `ui/format.js`, `server/app.mjs`, `server/cli/main.mjs`.
- **Names:**
  - The new helper in `ui/format.js` is `crewRelativePath`, not `relativePath`, because
    `core/events.js` already exports a different `relativePath`: that one converts backslashes
    and returns `"."`.
  - Catch variables: `err` was used only in `world/world.js` and `world/lab/lab.js`, and is now
    `error`, as at the other 25 sites.
- **Comments:**
  - `core/events.js` `own()` now says why it exists: a prototype-safe lookup, so hook data named
    `constructor` or `__proto__` cannot reach `Object.prototype`.
  - In `main.js`, a comment repeated the "would only log a 404" reason from the line above; it now
    describes its own line.
  - A scan of every file and identifier named in comments found no stale references.
- **Structure:** `world/agents/dev/stub-env.js` moved to `world/lab/stub-env.js`, with its imports
  fixed. It stubs the environment, not the agents, and only the lab page uses it; all other lab
  code lives in `world/lab/`.
- **Idioms (made uniform, then enforced by lint):**
  - `Object.hasOwn` instead of `Object.prototype.hasOwnProperty.call` (`activities.js`,
    `effects.js`).
  - `??=` (`tags.js`).
  - Template literals (`server/cli/start.mjs`, `scripts/check-licenses.mjs`).
- **Gates:** `package.json`, `scripts/check.mjs`, `.github/workflows/ci.yml`, `.githooks/pre-push`,
  `eslint.config.js` and `docs/CONTRACTS.md`.

## 5. Typecheck and lint tightening

`eslint.config.js` gained 32 rules. Each one already passed, or passed after the trivial fixes
listed in §4.

- **Redundant or dead code:** `no-useless-assignment` (dead stores), `no-useless-call`,
  `-computed-key`, `-constructor`, `-rename`, `-return`, `no-unused-expressions`,
  `no-unreachable-loop`, `no-lone-blocks`, `no-lonely-if`, `no-else-return`,
  `no-unneeded-ternary`, `no-undef-init`.
- **Work-in-progress markers:** `no-warning-comments` (comments starting with TODO, FIXME, XXX or
  HACK).
- **Correctness:** `array-callback-return`, `default-case-last`, `no-constructor-return`,
  `no-return-assign`, `no-self-compare`, `no-throw-literal`, `prefer-promise-reject-errors`,
  `radix`.
- **One idiom each:** `dot-notation`, `logical-assignment-operators`, `object-shorthand`,
  `operator-assignment`, `prefer-object-has-own`, `prefer-object-spread`, `prefer-rest-params`,
  `prefer-spread`, `prefer-template`.
- **Browser code only:** `no-console`, allowing `warn`, `error` and `debug`. This enforces "no
  `console.log` in browser code".

Probed but not adopted:

- **Deliberate in tests:** `no-template-curly-in-string` (plugin fixtures), `no-useless-concat`
  (secret strings split so the secrets scanner does not flag them), `no-proto`
  (prototype-pollution tests).
- **False positive:** `no-unmodified-loop-condition`. In `waitForServer` an event listener sets
  `exited` between awaits.
- **Too many style edits for this pass:** `no-sequences`, `consistent-return` (11),
  `no-shadow` (11), `prefer-exponentiation-operator` (11), `no-nested-ternary` (22),
  `no-await-in-loop` (81, mostly deliberate sequencing).

tsconfig is unchanged. `noUnusedParameters` would flag the uniform table signatures listed in
§2.5.

## 6. Judgement calls

- **Closure factories kept whole.** `createApprovalBroker` (103 lines in the ESLint count), `connectLive`,
  `createStore`, `createSimulation` and the HUD panels are factories of ten or so small, named
  members. Splitting them would move shared closure state into parameters without making any
  member shorter. `createHud` and `boot` are composition roots: they wire parts that are already
  separate functions.
- **Short functions over the complexity probe kept.** ESLint 9+ counts every `?.`, `??`, default
  parameter and `case` as a branch. A 19-line `select` or a flat `keyAction` switch reads better as
  it is (§3.3).
- **Protocol and security code kept linear.** `ws-frame.mjs` (RFC 6455 framing),
  `hook.mjs` `decisionFrom` and `routes.mjs` `handleRequest` keep their checks in one ordered,
  readable sequence. In `handleRequest` the host check must come first (DNS-rebinding defence).
  Splitting these would scatter rules a reviewer should see together.
- **Procedural geometry kept as sequences.** Examples: `effect-shapes.js` `createEffectShapes`
  (66 lines, the longest body in the codebase), the building builders in
  `env/buildings/*.js`, and `createPile`, `createGrove` and `createPuffs`. A run of `kit.box(…)`
  calls under a comment such as "Flag pole on the west wing" is clearer than a dozen helpers with
  long parameter lists. The short section comments there are kept: they name what a run of
  shape calls builds.
- **Terse handler parameters kept.** Core uses `m`/`s`/`a`/`e` and `d`/`rt` across about 160
  table handlers. The convention is consistent and typed (the `Apply` typedef). Renaming would be
  a mechanical diff of about 400 lines with no change in meaning.
- **`own()` documented, not renamed.** The name mirrors `Object.hasOwn`, and it has 22 call
  sites.
- **Three exports kept on purpose** (§2.3).

## 7. What remains, and why

Each of these items would change behaviour, or is a structural change beyond "small and safe".

1. **Two `modelLabel` functions disagree.** One is in `core/events.js` (used for quips and quip
   context), the other in `ui/format.js` (used by the HUD). For `claude-3-5-sonnet-20241022` core
   says "Sonnet 20241022" while the HUD says "Sonnet 3.5"; for `claude-3-7-sonnet-latest` core says
   "Sonnet" and the HUD says "Sonnet 3.7". Recommendation: keep the HUD's version in core and
   import it in both places. This changes user-visible text, so it was not done here.
2. **Three `normalizeAgentId` copies differ in edge cases.**
   - Copies: `core/events.js`, plus `ui/demo-mode.js` and `server/approvals.mjs` (these two
     mirror each other: in demo mode the HUD plays the server's part).
   - Differences: the core copy trims, accepts numbers and keeps a bare `"agent-"`.
   - Stale claim: the server comment says "Same rule as the browser", which is not quite true.
   - Impact: identical for real ids. The demo copy could import core's only if the edge cases are
     accepted.
3. **Duplicated helpers across subsystem boundaries.**
   - `hashString` is the same FNV-1a in `world/agents/easing.js` and `world/env/rand.js`. Agents
     and env never import each other, so sharing it needs a `world/shared` module.
   - Two different `offsetPolyline`/`rightOf` implementations exist, in `world/agents/routes.js`
     and `world/env/lane-path.js`. Merging them needs geometry tests first.
   - `isObject` is defined twice in `server/` (`cli/replay.mjs`, `routes.mjs`).
   - The server/browser/hook copies of small helpers are intentional: the hook forwarder is
     standalone, and the server uses Node built-ins only.
4. **Large but cohesive modules.** `core/director.js` (1,394 lines) and `core/store.js`
   (1,117) are organised by section headers and their functions are small. Splitting them into
   sub-modules would be a structural change.
5. **The lint size thresholds stay at 120 lines / complexity 20.** ESLint's length rule counts
   closures inside factories, so tightening it would mostly flag healthy factories. If a stricter
   gate is wanted, measure own-body length with a script like this review's.
6. **Not covered by e2e.** The lab pages are not covered by the e2e suites; I smoke-checked them
   by hand (§9).
7. **The stub-env move is not staged.** It shows in `git status` as a deletion plus an untracked
   file. Commit it with `git add -A` so git records the rename. No state-changing git commands
   were run during this review.

## 8. Database statement

**Andary has no database** (ADR `docs/adr/0006-in-memory-state.md`), and the code confirms it.

- **No database code.** No module imports a database driver, and there is no SQL, no pool and no
  transaction anywhere. The only "pool" hits are particle and object pools and the Memory Spa's
  swimming pool.
- **No runtime dependencies.** `dependencies` is empty.
- **What does persist:**
  - Server state is kept in memory, in a bounded ring buffer of 2,000 envelopes, capped at 32 Mi
    characters.
  - `server.json` and the Claude Code settings files, plus `installs.json`, are written
    atomically: a temp file is created with `flag: 'wx'` and mode 0600, then renamed into place.
    This is the file-level equivalent of a transaction.
  - Recordings are appended to a JSONL file only with `--record`.
  - Viewer preferences are kept in browser `localStorage`.

Nothing needs prepared statements, connection pooling or transactions.

## 9. Verification

| Command | Result |
| --- | --- |
| `npx eslint . --max-warnings=0` | exit 0, with the 32 added rules |
| `npx tsc -p tsconfig.json` | exit 0 |
| `node --test "test/**/*.test.mjs"` | 678 / 678 pass. The baseline was 679; one test went with `angleDelta`, and the removed `pick` assertion was inside another test. |
| `npm run deadcode` | 0 dead, 0 test-only, 3 private (deliberate); exit 0 |
| `npm run lint:config` | passes (JSON, shell and workflows, including the edited `ci.yml`) |
| `npm run check:fast` | all 7 steps pass, including the new "Dead code" step |
| `CHROME_PATH=/usr/bin/google-chrome npx playwright test` | **52 passed, 6 skipped** (6.5 min), as expected |
| Lab smoke check with `node scripts/shot.mjs`: `world-lab.html?env=stub&scenario=lineup`, `world-lab.html?scenario=effects`, `world-env-lab.html` | Rendered, with no console errors or page errors (only SwiftShader "GPU stall" performance warnings). The stub-env screenshot shows all 11 agents on the stub town. |
