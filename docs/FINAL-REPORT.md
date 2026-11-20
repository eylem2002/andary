# Andary: final report

Date: 2026-11-17, game view added 2026-11-20 · Repository: `eylem2002/andary` · Licence: MIT

Andary is a local web app that shows every Claude Code session on your machine as a crew of
tiny workers in a living 3D town. Agents walk to the building for the tool they are using, talk
about what they are doing, and queue at the Permit Office when they need your approval, which
you can give from the town. It connects through Claude Code hooks, runs only on your machine,
and has no runtime dependencies.

## 1. Features

### The town
- A sunset coast on a floating diorama plinth: pastel stucco blocks each in their own paint,
  palms, a beach with umbrellas and a lifeguard tower, neon that comes on at dusk, a plaza with
  a fountain, a sandbox labelled "Sandbox" and
  a node_modules box pile that grows with every install.
- Fifteen buildings, one per kind of work: Town Hall, Library, Workshop, Terminal Works, Search
  Bureau, Web Tower, Goal Board, Post Office, MCP Harbor, Permit Office, Memory Spa, Skill
  Academy, Café, Worktree Grove, Bus Stop. Signs show live counters ("42 reads").
- Cars, a bus, a mail truck and boats; day, sunset and night (or your clock); tilt-shift and
  bloom for the miniature look; a low-quality tier for phones and weak GPUs.

### The agents
- One crew per Claude Code session: a Foreman (main agent) plus every subagent and agent-team
  teammate, each a toy figure in the crew's colour. Hats show the model (crown for Opus, beret
  for Sonnet, sun hat for Haiku, wizard hat for Fable/Mythos); kit shows the agent type.
- Every tool call becomes a walk to the right building and an animation there (reading,
  hammering, typing, searching…). Bursts of tool calls make agents run, then teleport, so the
  town never falls behind.
- Speech bubbles mix real details (file names, commands, hosts) with developer humour from 86
  situations. Failing tests bring a rain cloud, rate limits a storm, passing tests fireworks;
  `git push` sends the mail truck; compaction sends agents to the spa; idle agents sip coffee and
  fall asleep. Messages between teammates fly as paper planes.
- Thirteen achievements, from First Contact to node_modules Black Hole.

### The interface
- A director camera that follows whoever is doing the most interesting thing (an arrival, a
  permission prompt, a failure, a handoff) in close-up, with a caption saying who is on screen
  and what they are doing; it stands back while you use the camera. `H` puts the side boards
  away so the town fills the screen, the way a demo on a static host opens.
- Crews panel (crews drawn as metro lines), Tasks (goals, todos, team tasks), Activity log with
  filters, Approvals with countdowns, an agent inspector and building cards.
- Toolbar and keyboard shortcuts for the camera, time of day, quality, sound and the demo.
- Light and dark themes, a phone layout with a bottom sheet, screen-reader announcements,
  reduced motion, synthesised sound effects (off by default).

### Connecting Claude Code
- `andary install` registers a tiny forwarder for 19 hook events in the user (or project, or
  local) settings, keeping other hooks and settings; `andary uninstall` removes only its own.
- Also packaged as a Claude Code plugin with its own hooks and an `/andary:town` command.
- Remote approvals (opt-in): answer Claude Code's permission prompts from the town, with a
  timeout that hands the prompt back to the terminal.
- `andary doctor` checks the whole pipeline; `simulate`, `replay` and `--record` help testing.
- A built-in simulation of three projects powers the demo, so the town also works without
  Claude Code (and on any static host).

## 2. Workflows

1. **First run**: `npm install -g github:eylem2002/andary`, `andary install`, `andary start`. The
   browser opens signed in; run `claude` in any project and the bus brings the crew.
2. **Watching work**: click a crew or agent to follow it; the inspector shows its tools, files
   and last message; the activity log and tasks show the same information as text.
3. **Approving from the town**: turn on Remote approvals in Settings; a permission request shows
   an Allow/Deny card with the exact command and a countdown; the decision goes straight back to
   Claude Code. Without an answer the normal terminal prompt appears.
4. **Demo**: `andary demo`, or open the app on a static host; Settings → "Leave the demo"
   returns to the live town.
5. **Development**: `npm ci`, `npm run check` (everything), `npm run hooks:install` (fast checks
   before each push); CI runs the same gates on GitHub for free.

## 3. Security findings and fixes

Three independent reviewers who had not seen the code looked at security, QA and code quality.
The security review attacked a sandboxed install (malicious web pages, other local users,
untrusted repository content in hook payloads, hostile processes, the installer, the approval
flow, logging, dependencies and CI) and found **10 problems; all 10 are fixed, each with a test
that fails without its fix** ([full report](reviews/security-review-2026-11-17.md)).

| ID | Severity | Finding | Fix |
| --- | --- | --- | --- |
| SR-01 | High | A stale `server.json` let whoever took the old port receive every prompt and the hook secret, and steer Claude Code through the forwarder's output. | Forwarder only talks to a live server of the same user and only obeys replies signed with a per-start key (HMAC), rebuilt as plain allow/deny (ADR 0012). |
| SR-02 | High | A new approval card could take a click meant for another. | Pointer clicks ignored for 1 s after a card appears or moves; keyboard unaffected. |
| SR-03 | Medium | Masking or truncation could hide code in an approval. | Such requests go to the terminal, never held in the town. |
| SR-04 | Medium | Cards shortened paths, hid MCP arguments, passed hidden/bidi characters. | Exact request shown, hidden characters made visible. |
| SR-05 | Medium | Unbounded object keys; a crash path when greeting a browser. | Key limits, history size cap, crash-proof greeting. |
| SR-06 | Medium | The installer followed symlinks planted in a project's `.claude/`. | Symlinked settings paths refused. |
| SR-07 | Medium | A state folder owned by someone else, or world-writable, was used. | Must belong to the user; made 0700. |
| SR-08 | Low | `stop` could signal a recycled pid. | Checks the process first. |
| SR-09 | Low | WebSocket frame and half-close limits. | Added. |
| SR-10 | Low | Terminal escape sequences in CLI output. | Printed escaped. |

Already in place before the review and confirmed by it: loopback-only binding, `Host` and
`Origin` checks, per-start UI token in an `HttpOnly`, `SameSite=Strict` cookie, separate hook
secret, 0600 state file, constant-time comparisons, strict CSP and hardening headers, rate and
size limits, secret redaction before anything is stored or sent, no payload content in logs,
nothing on disk without `--record`, and a lint rule that bans HTML sinks in the UI.

The QA review fixed 8 issues (CLI crash on closed pipes, the demo countdown running while
paused, a 450 px layout jump on phones, a publish-script ordering bug, and four accessibility
details) ([report](qa/checks-2026-11-17.md)). The code-quality review removed all dead exports,
split the most complex functions and gated dead code in CI
([report](reviews/code-quality-review-2026-11-17.md)). The game view had its own independent
review: 3 must-fix problems (approvals unreachable with the boards put away, the director holding
on to a follow, focus lost when the boards hide), 4 should-fix and a few nits, all fixed with
tests; no security findings ([report](reviews/game-view-review-2026-11-20.md)).

## 4. Test results and scores

Final verification, 2026-11-20, from a fresh clone of the complete stack (12 branches) with a
clean `npm ci` (Node 22.23, npm 10.9, Linux, Chrome 153 with software WebGL):

| Check | Result |
| --- | --- |
| Dependency audit (`npm audit --audit-level=high`) | 0 vulnerabilities |
| Lint (ESLint, zero warnings allowed; HTML sinks banned) | pass |
| Config lint (JSON, shellcheck, actionlint, yamllint) | pass |
| Typecheck (`tsc --checkJs`) | 0 errors |
| Dead code (`npm run deadcode`) | 0 dead exports |
| Unit + integration tests (`node:test`) | **710 / 710 pass**, 120 suites |
| End-to-end + accessibility (Playwright, desktop and mobile) | **60 pass**, 12 skipped by design (keyboard-only cases on the phone profile) |
| axe, WCAG 2.0/2.1/2.2 A and AA (main view light and dark, inspector, help, settings, setup, approval card) | 0 violations |
| Licences (98 installed packages, vendored three.js and fonts) | all on the allow-list |
| Secrets (working tree and full git history) | none found |
| Build: vendored files regenerated from `node_modules` | identical |
| Build: `npm pack` → global install → `andary install`, `start`, `doctor`, `stop`, `uninstall` | all pass; `doctor` confirms hook → server → town |
| Publishing: `scripts/publish-github.sh` from a clone of the bundle, against a stand-in GitHub | 13 branches pushed unchanged, 12 stacked pull requests, public only after a second secrets scan |
| Each branch checked out on its own (pre-push gate) | all 12 pass |

**Lighthouse 13.6** (`npm run perf`, demo page):

| | Performance | Accessibility | Best practices | SEO | First paint | Layout shift |
| --- | --- | --- | --- | --- | --- | --- |
| Desktop | 42 | **100** | **100** | **100** | 0.2 s | 0.01 |
| Mobile | 35 | **100** | **100** | **100** | 1.1 s | 0.035 |

The performance score is held down by the test machine, not the page: with no GPU, Chrome draws
the 3D town on the CPU (SwiftShader), so the frame loop shows up as Total Blocking Time (31 s on
desktop, 152 s on mobile with Lighthouse's 4× CPU throttling). First paint and layout shift,
which do not depend on the GPU, are good. QA rounds: mobile accessibility 98 → 100, mobile
layout shift 0.127 → 0.034–0.06; on 2026-11-17 desktop performance was 47, within the spread of a
CPU-drawn page.

**Other measurements**: a 5-minute demo at 4× speed levels off at ≈ 11 MB of JavaScript heap and
≈ 4,000 DOM nodes (no leak); the town draws 54–61 calls per frame on high quality and 25–29 on
low, and each agent adds one.

## 5. Remaining risks

Each item says what to do about it. None blocks normal use on a personal machine.

**Security**

1. **The sign-in cookie goes to every port on `127.0.0.1`** (browsers scope cookies by host, not
   port). On a shared machine, a local web server run by another user that you open in the same
   browser could capture it. Don't open other users' local services in that browser; the fix is
   an origin-scoped token (a change to ADR 0004).
2. **`/andary:town` pre-approves `node` commands during its turn.** Prefer `andary start` in a
   terminal if you would rather approve nothing in advance.
3. **Write/Edit approval cards show the exact path but not the new content.** Answer file
   changes in the terminal (which shows the diff) unless you trust the change.
4. **Pid reuse**: a recycled pid of the same user could still receive payloads; signed replies
   stop it from steering Claude Code.
5. **Local denial of service** needs local access (connection count, ping flood); nothing can be
   read or changed that way.
6. **`--host` other than loopback** sends secrets in clear; the CLI warns, keep the default.
7. **Dev tooling**: CI installs two linters by pinned version without hashes; `npm run perf`
   fetches Lighthouse through `npx` (pinned top-level version).

**Product**

8. **Real GPUs were not available here.** Frame rate was measured only with software rendering;
   once, the view went blank on High quality while following an agent there. Check on real
   hardware (High quality, follow an agent for 30 s), and watch the director camera for a minute:
   its moves between shots were only seen with software rendering and a slowed clock.
9. **The plugin's `bin/` folder lands on Claude's `PATH`**, and claude.ai/Cowork reject plugins
   with a `bin/` folder; the CLI install route is unaffected. Fixing it means moving the CLI.
10. **No field for a deny reason** in the approval card (the protocol supports one).
11. **First content waits for the 3D world** on slow devices (LCP); the store could start first.
12. **Minor edge cases**: crew numbers shift when ended crews are pruned; an event without a
    session id makes a crew that never ends; split-pane teammates appear as their own crew; two
    subagents of the same type started together can swap labels briefly; cars can pass through
    agents at the south-row doors.
13. **Only tested on Linux.** Windows and macOS paths (opening the browser, `stop`) and the
    `/andary:town` command inside a live Claude Code session were not exercised.
14. **CI has not run on GitHub yet**, because nothing could be pushed from here; the same checks
    pass locally (`npm run check`).

## 6. What you need to do

See [OWNER-SETUP.md](OWNER-SETUP.md): publish the code (one script, or give Claude's GitHub App
access), merge the 13 pull requests in order, optionally turn on branch protection and
Dependabot alerts, then `node bin/andary.mjs install && node bin/andary.mjs start`.

