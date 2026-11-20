# Andary: final report

Date: 2026-11-17; game view, sunset coast and nine more features added 2026-11-20; Codex
support, an architecture refactor, a usage guide and fixes for the remaining risks added the same
day ·
Repository: `eylem2002/andary` · Licence: MIT

Andary is a local web app that shows every Claude Code or OpenAI Codex session on your machine
as a crew of tiny workers in a living 3D town. Agents walk to the building for the tool they are
using, talk about what they are doing, and queue at the Permit Office when they need your
approval, which you can give from the town. It connects through the agents' own hooks, runs only
on your machine, and has no runtime dependencies.

## 1. Features

### The town
- A sunset coast on a floating diorama plinth: pastel stucco blocks each in their own paint,
  palms, a beach with umbrellas and a lifeguard tower, neon that comes on at dusk, a plaza with
  a fountain, a sandbox labelled "Sandbox" and a node_modules box pile that grows with every
  install.
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

### The nine features you picked (2026-11-20, parts 14–22)
- **File diffs**: an agent's finished edits are listed in its inspector; each opens as a diff.
- **Cost and tokens**: each crew shows what it has cost, estimated at API list prices from
  Claude Code's own transcripts; `U` opens today's total and a 14-day chart.
- **Weather**: rain when commands fail, a storm when they keep failing, a rainbow when tests
  pass again, fog while a crew thinks for long.
- **The town grows**: finished work earns points, and points build six landmarks, from
  bunting to a golden dome on the Town Hall.
- **Leaderboard** (`L`): the town's growth, the busy-day streak, records and the busiest agents.
- **Notifications**: on this computer while the tab is in the background, and on your phone
  through the free ntfy app (`--notify`, no account); phone messages never name your project.
- **Ambient sound**: waves, gulls or crickets, a city hum and soft chords that follow the work,
  all synthesised.
- **Five town looks**: sunset coast, snowy village, neon city, desert oasis, Amman old town.
- **Team town**: `andary start --team` hosts; `andary team invite <name>` gives each teammate a
  key to share their sessions and a view-only link; their crews carry their name.

### Connecting Claude Code
- `andary install` registers a tiny forwarder for 19 hook events in the user (or project, or
  local) settings, keeping other hooks and settings; `andary uninstall` removes only its own.
- Also packaged as a Claude Code plugin with its own hooks and an `/andary:town` command.
- Remote approvals (opt-in): answer Claude Code's permission prompts from the town, with a
  timeout that hands the prompt back to the terminal.
- `andary doctor` checks the whole pipeline; `simulate`, `replay` and `--record` help testing.
- A built-in simulation of three projects powers the demo, so the town also works without
  Claude Code (and on any static host).

### Connecting Codex (part 24)
- `andary install codex` registers the same forwarder in Codex's `hooks.json` (user or project
  scope); Codex asks you to trust the hooks once. Its events are translated on the server into
  the town's one event format (ADR 0013), so every board, building and animation works the same.
- `apply_patch` edits become one Write or Edit per file, with diffs; `spawn_agent` brings a
  helper; failed commands bring rain; Codex crews carry a "Codex" badge and GPT model labels.
- Permission prompts can be answered from the town, in Codex's own reply format.
- Not yet: Codex costs (Andary reads Claude Code's transcripts only).

### Clean structure (part 25)
- An independent architecture review found 2 must-fix and 6 should-fix problems; all are done:
  one ingest pipeline with a policy table per origin (ADR 0014), pure core modules shared by the
  browser and the server, smaller store and director modules, event sources in one folder,
  tests that mirror the source tree.
- Layer rules are now enforced: `npm run boundaries` fails the build when, say, the HUD imports
  the 3D world or the CLI imports more than the pure core. See
  [ARCHITECTURE.md](ARCHITECTURE.md).

### The usage guide (part 26)
- The README is now a guide: install, connect Claude Code, connect Codex, use the town, share it
  (team town, a static demo, recordings), security, troubleshooting, every command, how it works
  and how to develop it. The in-app setup steps mention Codex too.

### The risks list, fixed (parts 28–29, 2026-11-20)
- **Sign-in per origin, no cookie** (ADR 0015): a cookie for 127.0.0.1 reached every port on it;
  the page now keeps the token in its own storage and sends it with each request.
- **Approval cards show a file change in full** (a new file's content, an edit's diff, hidden
  characters revealed) and take an optional **reason for a denial**, which the agent reads.
- **The forwarder makes the server prove itself** before sending anything, so a recycled pid of a
  dead server learns neither the events nor the hook secret.
- **HTTPS for other computers** with your own certificate (`--tls-cert`, `--tls-key`; ADR 0016):
  the network gets HTTPS only, this computer keeps plain HTTP on loopback.
- **CI's linters and Lighthouse pinned by hash**.
- **The plugin has no `bin/` folder** (the CLI moved to `cli/`), and `/andary:town` pre-approves
  exactly its one command instead of every `node` command.
- **First content no longer waits for the 3D world**: crews and the log show at once, and the town
  replays what happened when it is ready.
- **Edge cases**: crew numbers stay fixed for a crew's life; a crew without a session id ends after
  10 idle minutes; two helpers of the same type keep their own labels; cars stop for people in
  their lane (agents now stand on the kerb at road doors).
- **CI on macOS and Windows** for the unit and integration tests, with the fixes Windows needs
  (`andary stop` removes server.json itself; POSIX-only tests skip there with a reason).

## 2. Workflows

1. **First run**: `npm install -g github:eylem2002/andary`, `andary install` (and
   `andary install codex` for Codex), `andary start`. The browser opens signed in; run `claude`
   or `codex` in any project and the bus brings the crew.
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
| SR-06 | Medium | A link planted at the installer's temporary file name in a project's `.claude/` let a hostile repository overwrite another file of yours. | Temporary files get random names and are created exclusively, so a planted link is never followed. |
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

The sunset coast had its own review (3 should-fix, all fixed;
[report](reviews/sunset-theme-review-2026-11-20.md)). The nine features were reviewed by two
more reviewers who had not seen them: features 1–4 had no must-fix and 12 should-fix; features
5–9 had **2 must-fix** (the team town's view link refused at a VPN name, and one oversized batch
stalling a teammate's relay) and 7 should-fix. All are fixed in part 23 with tests
([report](reviews/feature-review-2026-11-20.md)). The team town's core held up: keys and the
view link cannot be forged, only the team endpoint skips the Host check, teammates cannot fake
their name, their events never reach the usage reader, the approval broker or the phone
notifier, and viewers get nothing of the owner's.

The architecture was reviewed before the clean-up (2 must-fix, 6 should-fix, all done in part 25;
[report](reviews/architecture-review-2026-11-20.md)). Codex support, the clean-up and the new
README were then reviewed by another reviewer who had not seen them: no must-fix, 7 should-fix
(the clearest: a Codex command sent as an argument list could look like a different command on an
approval card; approvals for Codex patches answered in the terminal did not settle) and several
nits, all fixed in part 27 with tests ([report](reviews/codex-architecture-review-2026-11-20.md)).
Spoofing the source, the member or the approval match from a hook is not possible.

The fixes for the remaining risks (parts 28–29: the sign-in, approval cards, the forwarder's
challenge, HTTPS, the product edge cases) were reviewed by one more reviewer who had not seen them:
**2 must-fix**, both in the new HTTPS listener (with `--host <address>` and a certificate, local
clients were refused; with TLS on, request time limits were off and stopping could hang on
stalled connections), 2 should-fix (a demo opened from a sign-in link kept the token in the
address; blank-line padding could push a change below the card's fold) and 5 nits. All are fixed
in part 30 with tests ([report](reviews/hardening-review-2026-11-20.md)).

## 4. Test results and scores

Final verification, 2026-11-20, from a fresh clone of the complete stack (30 branches) with a
clean `npm ci` (Node 22.23, npm 10.9, Linux, Chrome 153 with software WebGL):

| Check | Result |
| --- | --- |
| Dependency audit (`npm audit --audit-level=high`) | 0 vulnerabilities |
| Lint (ESLint, zero warnings allowed; HTML sinks banned) | pass |
| Config lint (JSON, shellcheck, actionlint, yamllint) | pass |
| Typecheck (`tsc --checkJs`) | 0 errors |
| Dead code (`npm run deadcode`) | 0 dead exports |
| Layer boundaries (`npm run boundaries`, 16 rules, 202 files) | none crossed |
| Unit + integration tests (`node:test`) | **858 / 858 pass**, 138 suites (710 before the nine features, 782 after them, 822 after Codex and the clean-up) |
| End-to-end + accessibility (Playwright, desktop and mobile) | **94 pass**, 12 skipped by design (keyboard-only cases on the phone profile) |
| axe, WCAG 2.0/2.1/2.2 A and AA (main view light and dark, inspector, help, settings, setup, approval cards for a command and for a file edit with its diff and reason field, diff, usage and leaderboard dialogs) | 0 violations |
| Licences (98 installed packages, vendored three.js and fonts) | all on the allow-list |
| Secrets (working tree and full git history) | none found |
| Build: vendored files regenerated from `node_modules` | identical |
| Build: `npm pack` → global install (the CLI now in `cli/`) → `andary install`, `install codex`, `start`, `doctor`, `stop`, `uninstall` (and `team invite` at part 23) | all pass; `doctor` confirms both agents' hooks and hook → server → town |
| Publishing: `scripts/publish-github.sh` from a clone of the bundle, against a stand-in GitHub | main and 30 branches pushed unchanged, 30 stacked pull requests with their prepared descriptions, public only after a second secrets scan. An earlier rehearsal stopped before pushing: part 24's line in ORDER.md broke the script's branch list; fixed in part 27, with a test |
| Each branch checked out on its own (pre-push gate) | all 30 pass (24 to 858 tests as the stack grows) |

**Lighthouse 13.6** (`npm run perf`, demo page, measured on the final version):

| | Performance | Accessibility | Best practices | SEO | First paint | Layout shift |
| --- | --- | --- | --- | --- | --- | --- |
| Desktop | 35 | **100** | **100** | **100** | 0.3 s | 0.022 |
| Mobile | 34 | **100** | **100** | **100** | 1.1 s | 0.067 |

The performance score is held down by the test machine, not the page: with no GPU, Chrome draws
the 3D town on the CPU (SwiftShader), so the frame loop shows up as Total Blocking Time (29 s on
desktop, 139 s on mobile with Lighthouse's 4× CPU throttling). First paint and layout shift,
which do not depend on the GPU, are good. The largest paint (about 10 s) is a later entry in the
demo's activity log, which keeps growing; the crews and the log now show before the 3D world
(part 29), and the longest main-thread task while the demo loads is about 2 s, before and after
that change. On this machine Lighthouse itself is flaky (the page is nearly always busy); its
lockfile pins the dependency versions that ran reliably. QA rounds: mobile accessibility 98 → 100, mobile
layout shift 0.127 → 0.034–0.06; desktop performance has measured 35–47 across runs (42 before
the nine features, 35 after, with the same blocking time), the spread of a CPU-drawn page.

**Other measurements**: a 5-minute demo at 4× speed levels off at ≈ 11 MB of JavaScript heap and
≈ 4,000 DOM nodes (no leak); the town draws 54–61 calls per frame on high quality and 25–29 on
low, and each agent adds one.

## 5. Remaining risks

Parts 28 and 29 fixed most of the earlier list (the fixes are in section 1). What is left, and
what to do about it. None blocks normal use on a personal machine.

**Security**

1. **HTTPS needs a certificate you provide.** Without `--tls-cert`/`--tls-key`, a team town and
   `--host` are plain HTTP (the CLI says so and how to fix it): keys, events and the view link
   cross the network unencrypted. Use `tailscale cert` (free) or keep it to a network you trust,
   and run `andary team reset` if a link or key gets out.
2. **The sign-in is readable by the town's own page** (the price of not using a cookie, which
   every port on 127.0.0.1 would receive; ADR 0015). The page runs only its own scripts under a
   strict CSP and never renders event text as HTML, so nothing from a hook can run there.
3. **Local denial of service** (flooding the port) needs an account on the computer; nothing can
   be read or changed that way. Accepted.
4. **Phone notifications go through ntfy.sh** when you turn them on; anyone who learns the random
   topic can read them, but they never name a project, file or command. `--notify-url` points at
   your own server. Accepted.

**Product**

5. **Codex was not available here.** The connection follows Codex's published hook format and is
   tested with recorded-style payloads. If a Codex crew looks wrong, `andary doctor` and
   `--record` show what arrived (ASSUMPTIONS 63).
6. **Real GPUs were not available here.** The blank view once seen on High quality could not be
   reproduced in 60–90 s runs checked frame by frame; a lost WebGL context blanks the town and
   recovers by itself (about 38 s on High with software rendering, under 8 s on Low). Check on
   real hardware, and watch the director camera for a minute.
7. **Split-pane teammates appear as their own crew.** Their hooks carry no documented field that
   links them to their lead (README explains it).
8. **macOS and Windows** now run the unit and integration tests in CI, but CI has not run yet;
   the Windows job is marked `continue-on-error` until it has passed once. The `/andary:town`
   command's narrowed permission relies on Claude Code 2.1.0 or newer filling in
   `${CLAUDE_PLUGIN_ROOT}`; older versions ask (or refuse) instead of pre-approving, which is
   safe. Ambient sound and notifications were checked in headless Chrome, not by ear or on a
   phone; the team town on two towns on one machine, not across two computers.
9. **CI has not run on GitHub yet**, because nothing could be pushed from here; the same checks
   pass locally (`npm run check`).

## 6. What you need to do

See [OWNER-SETUP.md](OWNER-SETUP.md): publish the code (one script, or give Claude's GitHub App
access), merge the 30 pull requests in order, optionally turn on branch protection and
Dependabot alerts, then `node cli/andary.mjs install && node cli/andary.mjs start`.

