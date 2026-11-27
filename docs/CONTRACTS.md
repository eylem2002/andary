# Andary — architecture and interface contracts

This file is the source of truth for how the parts of Andary fit together. Every module is
written against it. If you need to change a contract, change this file in the same commit.

## 1. What Andary is

A local web app that renders a living 3D miniature town (three.js, isometric diorama, tilt-shift
look). Every Claude Code session that runs on the machine shows up as a crew: a **Foreman** (the
main agent) plus **subagents** and **agent-team teammates**. Agents walk to the building that
matches the tool they are using (Read → Library, Bash → Terminal Works, …), play an animation
there, say funny but informative things in speech bubbles, and react to success, failure, waiting
for permission, compaction, model switches and so on.

It connects to Claude Code through **hooks**: a tiny forwarder script receives every hook event on
stdin and POSTs it to the local Andary server, which streams it to the browser over a
WebSocket. Permission requests can be approved or denied from the town ("approval round-trip").

Without a server (for example the hosted demo), the same UI runs a built-in **simulation** that
produces realistic hook events, so every feature can be seen without Claude Code.

The town is a sunset coast of pastel stucco blocks, palms, a beach and neon that comes on at
dusk, on a floating diorama plinth beside a turquoise sea.

## 2. Repository layout and ownership

```
cli/andary.mjs               CLI (start | demo | install | uninstall | team | status | doctor | replay | simulate);
                             not in bin/, because the repository root is also the plugin root and
                             Claude Code puts a plugin's bin/ on the PATH (claude.ai rejects it)
server/*.mjs                 HTTP + WebSocket server, auth, approvals, sanitizing, installer logic
server/ingest.mjs            The one pipeline every event enters through, with a policy per origin
server/adapters/             Source adapters: Claude Code (as is) and Codex → the town's event contract
server/clients.mjs           What differs between the agents Andary connects to (hooks file, events)
server/notes.mjs             The owner's notes waiting for their agents' next step (§4.15)
server/cli/                  One module per CLI command, plus argument parsing
hooks/hook.mjs               Hook forwarder copied to ~/.andary/hook.mjs by `install` (Claude Code and Codex)
hooks/hooks.json             Hook config used when Andary is installed as a Claude Code plugin
mods/andary-limits/          The opt-in andary-limits mod: a second plugin of the marketplace (§4.14)
.claude-plugin/              plugin.json + marketplace.json (plugin distribution; lists both plugins)
commands/town.md             /town slash command for the plugin
public/index.html            The app shell (import map, fonts, HUD markup roots)
public/css/*.css             HUD styles (app.css) and in-world overlay styles (world.css)
public/js/page.js            What the page was opened with (the town look), read once at load
public/js/core/              Pure logic, no DOM, no I/O: events (normalize), store (+ crews, changes,
                             store-model, store-dialogs), director (+ director-queue), catalog,
                             text, summaries, ids, dates, looks, prices, growth, records,
                             town-weather, humor, dialogs (open dialogs), waits, attention,
                             card-fields (what an approval card shows), permission-rules (what
                             "Allow always" may save), loops (when an agent seems stuck), shell
                             (shell command lines read as a shell reads them, for every rule),
                             conflicts (two agents on the same files, + git-commands, paths),
                             digest (what each crew did, for Catch me up), receipts (what each
                             lead's turn did), notes (notes to agents: which hooks carry them,
                             how they are cleaned), town-map (the town
                             plan: tiles, lots, home plots, routes; shared with the server),
                             profile (a team town person's look, validated; shared with the server)
public/js/sources/           Where events come from: live.js (WebSocket) and demo.js (simulation),
                             one TownSource shape (types.js)
public/js/world/layout.js    The town plan as the world uses it: core/town-map.js plus standing spots
public/js/world/env/         Environment: terrain, water, buildings, props, vehicles, sky, post-processing, camera rig
public/js/world/agents/      Characters, animation, walking, bubbles, effects
public/js/world/world.js     World facade (the only world module the app imports)
public/js/sim/               Simulation (demo scenarios) — pure ESM, no DOM, also used by `andary simulate`
public/js/ui/                HUD panels, inspector, toasts, approvals, settings, sound
public/js/main.js            Boot: picks live or demo mode, starts store + HUD, then world + director
public/vendor/               Vendored three.js and fonts (generated by scripts/vendor.mjs, never edited)
test/unit/<source path>      node:test unit suites, mirroring the source tree (test/unit/world/env/…)
test/integration             node:test suites against a real server and CLI
e2e/                         Playwright suites (*.spec.mjs) and helpers
scripts/                     vendor, check, lighthouse, licences, secrets scan, dead-code and boundary checks
docs/                        ADRs, QA and security reports, this file
```

## 3. Rules every module follows

- Plain ES modules, no bundler, no runtime npm dependencies. Browser code imports three.js as
  `import * as THREE from 'three'` and addons as `'three/addons/<path>.js'`; the import map in
  `public/index.html` resolves them to `public/vendor/three`. Available addons are listed in
  `scripts/vendor.mjs`.
- Server code uses Node built-ins only (`node:http`, `node:crypto`, `node:fs`, …). Node ≥ 20 at
  runtime; the test suites use Node ≥ 22.
- `npm run lint` (ESLint, zero warnings), `npm run typecheck` (tsc `checkJs`), `npm run deadcode`
  (no export that nothing imports or uses) and `npm run boundaries` (the layer rules in
  docs/ARCHITECTURE.md: core is pure, the server reuses only listed core modules, the HUD never
  imports the 3D world, the forwarder and the mod stand alone) must pass for every file you touch. Keep functions
  small (lint warns over 120 lines or complexity 20), names clear, comments explaining why rather
  than what. Use JSDoc types on exported functions.
- **Never render dynamic text as HTML.** Hook data comes from sessions that read untrusted
  repositories. `innerHTML`, `outerHTML`, `insertAdjacentHTML` and `document.write` are banned by
  lint. Build DOM with `document.createElement` + `textContent`.
- No inline `<script>` other than the import map and no inline event handlers (CSP).
- Accessibility (WCAG 2.2 AA): every control is a real `<button>`/`<input>` with an accessible name,
  visible focus, keyboard operable; text contrast ≥ 4.5:1; respect `prefers-reduced-motion`; the
  3D canvas is decorative-with-alternative: the HUD's crews list and activity log carry the same
  information as text.
- Performance: 60 fps on a mid-range laptop with 15 agents; aim for < 200 draw calls (instancing,
  merged static geometry); `quality: 'low'` disables bloom, tilt-shift and shadows and caps pixel
  ratio at 1.
- Tests mirror the source tree: the tests of `public/js/world/env/water.js` are in
  `test/unit/world/env/`, of `server/usage.mjs` in `test/unit/server/` (and end-to-end ones in
  `test/integration/…` and `e2e/`). Pure logic must have unit tests.
- Two styles, each where it fits: modules expose `create*()` factories that return plain objects
  (most of the code), and the 3D world uses classes for the things it has many of (agents,
  animators, batches). Anything that owns timers, listeners or GPU memory has `dispose()`.
- Limits shared across modules live in `server/config.mjs` (`LIMITS`); a limit only one module
  uses sits at the top of that module as a named constant (in CAPS) with a comment.

## 4. Claude Code (or Codex) → server: the hook pipeline

### 4.1 Hook registration (written by `andary install`)

Default scope is the user settings file `~/.claude/settings.json` so every session on the machine
reports to the town. `--scope project` writes `<dir>/.claude/settings.json`, `--scope local` writes
`<dir>/.claude/settings.local.json`. The installer copies `hooks/hook.mjs` to
`<ANDARY_HOME>/hook.mjs` (default `~/.andary/hook.mjs`) and registers:

| Event | Mode | Why |
| --- | --- | --- |
| SessionStart, UserPromptSubmit, PreToolUse, PostToolUse, PostToolUseFailure, PermissionDenied, Notification, SubagentStart, SubagentStop, Stop, StopFailure, TaskCreated, TaskCompleted, TeammateIdle, PreCompact, PostCompact, PostModelSwitch | `"async": true` | Observation only; never slows Claude down |
| PermissionRequest | synchronous, `"timeout": 150` | Can return an allow/deny decision from the town |
| SessionEnd | synchronous, `"timeout": 3` | Async hooks may be killed while the session exits |

Each entry is `{"type": "command", "command": "node \"<home>/hook.mjs\" # andary"}` (forward
slashes in the path on every OS). The `# andary` marker lets `uninstall` remove exactly our
entries. Tool events use no matcher (match everything).

Deliberately **not** registered: `WorktreeCreate`/`WorktreeRemove` (a hook there replaces git's
worktree behaviour), `MessageDisplay` (fires per streamed text chunk, 10 s timeout), `Elicitation*`,
`ConfigChange`, `FileChanged`, `Setup`.

**Codex** (`andary install codex`, `server/clients.mjs`): the same layout in `$CODEX_HOME/hooks.json`
(default `~/.codex/hooks.json`; `--scope project` writes `<dir>/.codex/hooks.json`; there is no
local scope). The command is `node "<home>/hook.mjs" codex # andary`. Registered: SessionStart,
UserPromptSubmit, PreToolUse, PostToolUse, SubagentStart, SubagentStop, Stop, PreCompact and
PostCompact async; PermissionRequest with `"timeout": 150`; SessionEnd and Interrupt with
`"timeout": 3` (Codex's maximum for those two). Codex asks the user to trust new or changed hooks
at its next start; untrusted hooks do not run. `inspectInstallations` reports both agents' scopes.

### 4.2 Hook payloads (from the official hooks reference, Nov 2026)

Common fields: `session_id`, `transcript_path`, `cwd`, `permission_mode`, `hook_event_name`, and
`agent_id` + `agent_type` **when the hook fires inside a subagent or an in-process teammate** (absent
for the main thread). `agent_type` may also appear on the main thread when the session runs with
`--agent`.

| Event | Extra fields |
| --- | --- |
| SessionStart | `source` (`startup`/`resume`/`clear`/`compact`/`fork`), `model?`, `agent_type?`, `session_title?` |
| SessionEnd | `reason` (`clear`/`resume`/`logout`/`prompt_input_exit`/`other`) |
| UserPromptSubmit | `prompt`, `session_title?` |
| PreToolUse | `tool_name`, `tool_input`, `tool_use_id`, `mcp_server?` |
| PostToolUse | `tool_name`, `tool_input`, `tool_response`, `tool_use_id`, `duration_ms?` |
| PostToolUseFailure | `tool_name`, `tool_input`, `tool_use_id`, `error` (first line like `Exit code 1`), `is_interrupt`, `duration_ms?` |
| PermissionRequest | `tool_name`, `tool_input`, `permission_suggestions?` — **no `tool_use_id`** |
| PermissionDenied | `tool_name`, `tool_input`, `tool_use_id`, `reason` (auto mode only) |
| Notification | `message`, `title?`, `notification_type` (`permission_prompt`, `idle_prompt`, `agent_needs_input`, `agent_completed`, …) |
| SubagentStart | `agent_id`, `agent_type` |
| SubagentStop | `agent_id`, `agent_type`, `agent_transcript_path`, `last_assistant_message`, `stop_hook_active` |
| Stop | `last_assistant_message`, `stop_hook_active`, `background_tasks`, `session_crons` |
| StopFailure | `error` (`rate_limit`, `overloaded`, `authentication_failed`, `billing_error`, `server_error`, `max_output_tokens`, `unknown`, …), `error_details?`, `last_assistant_message?` |
| TaskCreated / TaskCompleted | `task_id`, `task_subject`, `task_description?`, `teammate_name?`, `team_name?` (deprecated), `agent_id?` |
| TeammateIdle | `teammate_name`, `team_name?`, `agent_id?` |
| PreCompact | `trigger` (`manual`/`auto`), `custom_instructions` |
| PostCompact | `trigger`, `compact_summary` |
| PostModelSwitch | `from_model`, `to_model`, `requested_model`, `source` |

Useful `tool_input` shapes: Bash `{command, description?, timeout?, run_in_background?}`; Write
`{file_path, content}`; Edit `{file_path, old_string, new_string, replace_all}`; Read
`{file_path, offset?, limit?}`; Glob `{pattern, path?}`; Grep `{pattern, path?, glob?, output_mode?}`;
WebFetch `{url, prompt}`; WebSearch `{query}`; Agent (legacy name Task)
`{description, prompt, subagent_type, model?, name?, run_in_background?, isolation?}`; TodoWrite
`{todos: [{content, status, activeForm}]}`; TaskCreate `{subject, description?, activeForm?}`;
TaskUpdate `{taskId, status?, owner?, subject?}`; SendMessage `{to|recipient, message|content, summary?}`
(read defensively); Skill `{skill|command, args?}`; mcp tools `mcp__<server>__<tool>`.
PostToolUse for Agent: `tool_response.{status: 'completed'|'async_launched', agentId, content,
totalTokens, totalDurationMs, totalToolUseCount}`.

Hook-to-agent attribution: an event with `agent_id` belongs to that subagent/teammate; without it,
to the session's main agent. Subagent identity is announced by `SubagentStart`; its label comes
from an unmatched `PreToolUse` of the Agent/Task tool in the same session with the same
`subagent_type`. Until something proves the pairing, it is a guess: the earliest-started helper of
a type gets the oldest call, by the hooks' start times (`ts`), not by arrival order, and the
guesses are paired again whenever a helper or a call of that type arrives. The proof is the Agent
call's `PostToolUse` (`tool_response.agentId` with its `tool_use_id`; at once for background
agents, at the end for foreground ones) or a teammate's name in `TeammateIdle`/`Task*`; it wins
over any guess, also when it arrives before the subagent's `SubagentStart`, and is never undone.
Normalise ids by stripping a leading `agent-`. An event without `session_id` belongs to one shared
crew (`unknown`); no `SessionEnd` comes for it, so the store ends it once another crew's event
arrives 10 minutes after its last one.

Agent-team teammates in split panes (tmux, iTerm2) are separate Claude Code sessions with their
own `session_id`. No documented field of their hooks names the lead's session (`team_name`,
derived from the lead's session id, is deprecated and only on `TeammateIdle`/`Task*`), so each
shows up as a crew of its own.

### 4.3 The forwarder (`hooks/hook.mjs`)

1. Records `ts` first thing: the time its process started (`performance.timeOrigin`, whole ms),
   which no import or start-up work delays, so hooks started a moment apart keep their order
   (a clock read once Node is running would not: its start-up time varies by more than that).
2. Reads `<ANDARY_HOME>/server.json`; if missing, unreadable, or its `pid` is not a live process of
   the same user (a stale file whose port someone else may now hold), exits 0 immediately.
3. Reads stdin fully, parses JSON (on failure sends `{hook_event_name: 'Unknown', raw: <first 4000 chars>}`).
3a. Challenges the server before sending anything: `GET /api/proof` with
   `x-andary-nonce: <16 random bytes, base64url>` and nothing else (no secret). The server answers
   `200 {"ok":true}` with `x-andary-proof: base64url(HMAC-SHA256(responseKey, "andary-proof\n" +
   nonce))` (400 for a nonce that is not 16–128 base64url characters). Without a valid proof
   within 1.5 s the forwarder exits 0 having sent nothing: a recycled pid of a dead server whose
   port someone else now holds learns neither the event nor the secret.
4. `POST http://127.0.0.1:<port>/api/hook` with headers `x-andary-secret: <secret>` and
   `x-andary-nonce: <16 random bytes, base64url>` and body
   `{"v":1,"ts":<ts>,"caps":["truncated","updatedPermissions","interrupt","notes"],"event":<payload>}`;
   run with the argument `codex`, the body also has `"source":"codex"` (§4.12). `caps` says what
   this forwarder does (strings; the server ignores any it does not know): `truncated`, it marks a
   body it had to shorten (§4.6); `updatedPermissions`, it can pass a saved rule on (step 5);
   `interrupt`, it passes a deny's stop on to Claude Code (step 5; the server offers "Deny and
   stop" only then); `notes`, it hands the owner's notes to the agent (step 5a; the server queues
   none for a forwarder without it). The server
   holds a request for the town only from a forwarder that declares `truncated`, and offers "Allow
   always" only for a request whose body declares `updatedPermissions` (§4.5): an older copy, such
   as a plugin's own, prints a plain allow. `andary replay` and `andary simulate` post the same
   body, `truncated` included, as they never shorten one; only `andary simulate`, whose story
   keeps a saved rule, declares `updatedPermissions`. Codex reads the same PermissionRequest
   decision format, so step 5 is the same for both.
   Timeout 1.5 s, or `approvalTimeoutMs + 5000` for `PermissionRequest`.
5. Only for `PermissionRequest`: if the reply carries a valid `x-andary-signature`
   (`base64url(HMAC-SHA256(responseKey, nonce + "\n" + body))`) and its `output` is an allow or
   deny decision, prints that decision as JSON on stdout, rebuilt: `{behavior:'allow'}`,
   `{behavior:'deny', message}`, or an allow that saves one rule ("Allow always", §4.5):
   `{behavior:'allow', updatedPermissions:[s]}`. That last one only when the reply's
   `updatedPermissions` is an array of exactly one element that equals, whatever the order of
   keys, an element `s` of the hook's own stdin `permission_suggestions`, `s` is `addRules` with
   `behavior: 'allow'` and `destination` `localSettings` or `session` and no other field, and each
   of its rules is one the town offers (§4.5: one command, a Bash prefix, one web host or one MCP
   tool, with no other field). `s` is printed from the hook's own input, never from the reply. Any
   other `updatedPermissions` gives a plain allow. A deny whose reply has `interrupt: true` is
   printed with `interrupt: true` ("Deny and stop"), only when run for Claude Code: run as `codex`,
   the flag is dropped (Codex fails closed on it). Any other field is dropped.
5a. Only for a hook that can carry notes (§4.15: `PreToolUse`, `PostToolUse`,
   `PostToolUseFailure`, `UserPromptSubmit`; for Codex not `PostToolUseFailure`): if the reply is
   signed as in step 5 and has `notes`, an array of 1 to 4 strings, each of which is still non-empty
   and at most 2,000 characters once cleaned as `noteText()` in `public/js/core/notes.js` cleans
   it, prints `{"hookSpecificOutput":{"hookEventName":<this hook's name>,"additionalContext":<text>}}`,
   where `<text>` is, for each note, `The user (<user>) sent you this message from Andary while you
   work:\n<note>` (`noteHeader()`: factual words, as text framed as a system command can trip
   Claude's prompt-injection defences), joined by a blank line. `<user>` is the user
   the forwarder runs as (letters, digits, `.`, `_`, `-`, at most 40; else `the owner`). If any note
   fails, nothing is printed. The reply's own `output` is never printed for these hooks. Nothing
   else is ever printed.
6. **Always exits 0** and never prints anything else. Any error → exit 0 silently.

### 4.4 Server (`server/`)

- Binds `127.0.0.1` by default; port `4747` (`--port`, `ANDARY_PORT`; `0` picks a free port).
- Home dir `ANDARY_HOME` or `~/.andary`. On start writes `server.json` (mode 0600):
  `{pid, port, host, secret, uiToken, responseKey, version, startedAt, approvalTimeoutMs}`; removes
  it on exit if the pid is still ours. `secret` authenticates hooks; `uiToken` authenticates
  browsers; `responseKey` signs the replies to hooks and never travels over the wire. All three
  are 32 random bytes, base64url. The home folder must belong to the user (otherwise the server
  refuses to start) and is made 0700.
- Every request: reject unless the `Host` header is `127.0.0.1:<port>`, `localhost:<port>` or
  `[::1]:<port>` (DNS-rebinding defence). Security headers on every response: strict CSP
  (`default-src 'self'`; `script-src 'self' 'sha256-<importmap>'`; `style-src 'self'`;
  `font-src 'self'`; `img-src 'self' data: blob:`; `connect-src 'self'`; `object-src 'none'`;
  `base-uri 'none'`; `frame-ancestors 'none'`; `form-action 'none'`), `X-Content-Type-Options:
  nosniff`, `Referrer-Policy: no-referrer`, `X-Frame-Options: DENY`, `Cross-Origin-Opener-Policy:
  same-origin`, `Cross-Origin-Resource-Policy: same-origin`, `Permissions-Policy` (camera, mic,
  geolocation off). The import-map hash is computed from `public/index.html` at startup.
- Tunnelled requests (§4.11, ADR 0019): every request on a team host's tunnel port, and on any
  port one with a `cf-connecting-ip`, `cf-ray`, `cf-visitor` or `cf-ipcountry` header or a
  `cdn-loop` naming `cloudflare` (`auth.isTunnelled`). Their `Host` (and a WebSocket's
  `Origin`, which must then be exactly `https://<host>`, never absent) must be the tunnel's own
  host, bare or with `:443` (nothing before the tunnel has an address; `/api/team` gets no Host
  exception). The UI token never counts for them; `GET
  /?token=…` answers a `403` page; only `/api/health`, `/api/hello` and `/api/team` answer, every
  other `/api/` route `403 {"error":"Not available through the tunnel"}`; their `/api/hello`
  reports `remoteApprovals`, `notify` and `notifyLimits` as `false`, and leaves out `version` and
  `settings.approvalTimeoutMs` unless the request carries the view token (`x-andary-view`) or a
  member key (`x-andary-team`).
- Routes:
  - `GET /?token=<uiToken>[&…]` → `302` to the same URL without `token` (other query params
    kept) and with `#signin=<uiToken>`; `Cache-Control: no-store`, no cookie. Wrong token → `403`
    page. The page keeps the token in `localStorage["andary:signin"]` (`{token, view}`), removes
    the fragment, and sends it as `x-andary-token` on `fetch` and as the WebSocket subprotocol
    `andary.token.<uiToken>` (ADR 0015). No cookie is set or read.
  - `GET /` and static files from `public/` (no auth: they contain no data). gzip when accepted.
    Path traversal is impossible (resolve + prefix check), dotfiles are not served.
  - `GET /api/health` → `{"ok":true}` (no auth).
  - `GET /api/hello` → `{"app":"andary","version","authenticated":bool,"settings":{...}}`
    (no auth; tells the UI whether it is in live mode and whether its `x-andary-token` /
    `x-andary-view` header signs it in).
  - `POST /api/hook` → requires `x-andary-secret` (constant-time compare), JSON ≤ 1 MiB,
    rate-limited (token bucket ~300 req/s, burst 600 → `429`). Responds `{"output": object|null}`,
    plus `"notes": string[]` when notes wait for the hook's agent and the hook can carry them
    (§4.15), signed in `x-andary-signature` when the request has an `x-andary-nonce` (see §4.3).
    `POST /api/team` never answers with notes.
  - `POST /api/limits` → the andary-limits mod's report (§4.14): the same secret and the same
    token bucket (`401` before anything else), JSON ≤ 16 KiB (`413`), `400` for a body that is
    not `{"v":1,…}`. Responds `{"ok":true}`.
  - `GET /ws` → WebSocket upgrade; requires the subprotocol `andary.token.<uiToken>` (or
    `andary.view.<token>` on a team host) and an `Origin` matching the server's own origin (or
    absent); when the client offers `andary`, the answer confirms it (never a credential). Max 16 clients; client messages ≤ 64 KiB.
- Sanitising before anything leaves the server or is recorded: strings longer than 2,000 chars are
  cut (`…[+N chars]`), arrays to 50 items, objects to 100 keys (plus `"…": "[+N keys]"`), keys to
  200 chars, depth to 8; secrets are redacted to `[redacted]`, in keys too
  (private-key blocks, `sk-…`, `ghp_…`/`github_pat_…`, `xox?-…`, `AKIA…`, `Bearer …`, and
  `NAME=value` where NAME contains KEY, SECRET, TOKEN or PASSWORD).
- Keeps the last 2,000 envelopes (at most 32 Mi characters of JSON) in memory for late-joining
  browsers. Writing them to disk happens
  only with `--record` (they contain prompts and commands).
- Logs to the console only lifecycle and counts — never payload content, the secret or the token.
  The startup line prints the login URL (it contains the token: that is the point of it).

### 4.5 WebSocket protocol

Server → browser:

```js
{ t: 'hello', version, serverTime, settings: { remoteApprovals, approvalTimeoutMs, notify, notifyLimits }, history: Envelope[], approvals: Approval[], notes: Note[] /* §4.15; [] for a viewer */, usage: { agents: UsageRecord[], days: UsageDay[] }, limits: LimitsSnapshot /* §4.14 */, progress: { points, days }, notifyUrl: string|null, away: Away|null,
  people: Person[] /* §4.11, [] off a team host */, me: string|null /* the person this browser plays */ }
{ t: 'hook', e: Envelope }
{ t: 'approval', a: Approval }          // sent on create and on every status change
{ t: 'note', n: Note }                  // §4.15, owners only: on queue and on every status change
{ t: 'note-reply', ref: string|null, ok: boolean, id?: string /* the queued note */, error?: string }   // §4.15, to the sender of a note only
{ t: 'settings', settings: {...} }
{ t: 'usage', u: UsageRecord, days: UsageDay[] }   // §4.8, when an agent's totals change
{ t: 'progress', p: { points, days: string[] } }   // §4.9, when a point or a busy day is added
{ t: 'limits', limits: LimitsSnapshot }            // §4.14, owners only, after each report of the mod
{ t: 'notify-test', ok: boolean }                  // §4.10, the answer to a test
{ t: 'away', away: Away }                          // §4.13, owners: an absence began or ended
{ t: 'digest', d: Digest }                         // §4.13, the answer to a digest request
{ t: 'people', people: Person[] }                  // §4.11, everyone: someone came online or left, saved a profile, was invited or removed
{ t: 'profile', ok: true, color: number, asked: number }  // §4.11, to the sender: the colour they got (another may hold the one asked)
{ t: 'presence', people: ({ name } & Presence)[] }  // §4.11, everyone: where some people are now (at most 10 a second)
{ t: 'emote', name, id: 0–7 }                      // §4.11, everyone: one of the set emotes (core/presence.js EMOTES)
{ t: 'phrase', name, id: 0–9 }                     // §4.11, everyone: one of the set phrases (PHRASES)
{ t: 'look-ask', from, at: { agent: string }|{ building: BuildingKey } }  // §4.11, to the asked person's browsers only
{ t: 'error', message }
// Person = { name, slot: 0–5 /* their home */, color: 0–7 /* CREW_COLORS index */, host: boolean, profile: Profile|null /* core/profile.js */ } & Presence
// Presence = { tile: [col, row], walk: { path: [col, row][], at: number /* server ms */ }|null, online: boolean,
//              away: null|'porch'|'inside', duty: 'free'|'work'|'needs', lights: boolean }
// Envelope = { id: number /* server sequence */, ts: number /* hook start, ms, never after rx nor more than an hour before it (a teammate's: §7) */, rx: number /* server receive */, event: object /* sanitized payload */ }
// Approval = { id, status: 'pending'|'allowed'|'denied'|'expired'|'resolved', held: boolean, sessionId, agentId: string|null,
//              toolName, toolInput, callKey: string|null /* the request's andary_key, §4.6 */, source: 'claude'|'codex',
//              cwd, createdAt, expiresAt: number|null, decidedBy?: 'town'|'terminal'|'timeout', proof?: 'ran'|'denied'|'stopped', message?,
//              suggestions: { index, rules: { toolName, ruleContent? }[], destination: 'localSettings'|'session' }[],
//              always?: { rules, destination, at } /* the rule an "Allow always" asked Claude Code to save, and when (server time) */,
//              canStop: boolean /* a deny may also stop the agent ("Deny and stop") */, stopNote?: string /* why not, when not */,
//              stopped?: true /* denied from the town with a stop */ }
```

Browser → server:

```js
{ t: 'decide', id, decision: 'allow'|'deny', message?: string /* ≤ 500 chars */, always?: number /* allow only: a suggestion's index */, stop?: true /* deny only: "Deny and stop" */ }
{ t: 'note', ref?: string /* the sender's own id, [\w-]{1,64}, echoed in note-reply */, sessionId, agentId?: string /* a helper; absent for the lead */, text: string /* ≤ 2,000 chars once cleaned */ }   // §4.15
{ t: 'settings', settings: { remoteApprovals: boolean } }
{ t: 'notify-test' }   // sends a test phone notification (rate limits apply)
{ t: 'digest', since: number }   // §4.13: what each crew did since then (ms, the server's clock; 0: all kept)
{ t: 'profile', p: Profile }     // §4.11: the sender's own profile (a person, or the owner as the host); at most one per 10 s
{ t: 'walk', to: [col, row] }    // §4.11: the sender's character walks there (person or owner)
{ t: 'emote', id } / { t: 'phrase', id }   // §4.11: a set emote (one per 2 s) or phrase (one per 5 s)
{ t: 'look', to: string, at: { agent }|{ building } }   // §4.11: asks a teammate to come look (one per 30 s per pair)
{ t: 'ping' }
```

Approval flow: on `PermissionRequest` the server creates an Approval. If `remoteApprovals` is on
and at least one browser is connected, the HTTP response to the hook is **held** (`held: true`)
until a `decide` arrives or `approvalTimeoutMs` (default 120 s) passes; it then answers with
`{"output":{"hookSpecificOutput":{"hookEventName":"PermissionRequest","decision":{"behavior":"allow"}}}}`
or `{"behavior":"deny","message":"Denied from Andary"}`, or `{"output":null}` on timeout (the
normal terminal prompt then appears). If remote approvals are off, the server answers at once with
`null` and broadcasts the approval with `held: false` ("answer in your terminal"). Every request is
a dialog in the broker's own tracker (§4.6, at most 500): a non-held pending approval becomes
`resolved` (`decidedBy: 'terminal'`) when its dialog closes, and `proof` says what showed it:
`'ran'` (its `PostToolUse` or `PostToolUseFailure`), `'denied'` (its `PermissionDenied`) or
`'stopped'` (anything else: your prompt, the turn or the session ending, the same agent asking a
new question or plan). A held approval is not resolved by the terminal while the town holds it.
Released, it waits in the terminal like any other and is resolved when its dialog closes, or at
once if its dialog closed while it was held (its turn or session ended; `proof` says by what). An
expired one stays expired, but its dialog shows in the terminal now, so your next prompt answers
it; when its dialog then closes on `'ran'` or `'denied'` (answered in the terminal after all) it
gets that `proof`, once, and is broadcast again. `callKey` is the request's call key (§4.6): the
phone notes and the town find the approval's own dialog by it (§4.10, §5.1), as a parallel call
of the same tool may be open beside it. At most 50 pending.
`ExitPlanMode` and `AskUserQuestion` requests are never held: a plain allow or deny cannot approve
a plan or answer a question, so they are answered with `null` at once (`held: false`) and their
`message` always says they are answered in the terminal. A request is held only when its card
shows every field of its `tool_input` as the agent will receive it, so never one whose
`tool_input` is missing or not an object, was changed by sanitising (a value redacted or cut), or
that the forwarder had to shorten (`truncated`, §4.6). `public/js/core/card-fields.js` lists, per
tool with a view of its own on the card (Bash, PowerShell, Write, Edit, MultiEdit, NotebookEdit,
Read, WebFetch, WebSearch), the fields that view shows, with the values it shows as they are,
and the fields the card adds as `name: value` lines below it, with the values they may hold there
(such as Bash's `description`, `timeout`, `run_in_background`, and `dangerouslyDisableSandbox`
when `false`); a field it does not list (an option a later Claude Code adds), a value the view or
a line would not show as it is (`dangerouslyDisableSandbox: true`, an edit with a field the diff
leaves out), or a view with nothing to show (a MultiEdit with no edits) keeps the request from
being held. The card of any other tool lists every field. Such a request is answered at once with
`null`; when the town would otherwise have held it (remote approvals on, a browser signed in), its
approval has `held: false` and `message: "The town cannot show this request in full (…)"`. Nor is
a request held from a forwarder that does not declare `caps: ["truncated"]` (§4.3; an older copy):
its `message` asks to run `andary install` or update the plugin. A Codex command's card
(`source: 'codex'`, Bash or PowerShell) adds a line its request cannot carry, as Codex does not
say whether it asks to leave its sandbox: "Codex did not say what this needs: allowing may let it
run outside its sandbox, with network access." (`cardNote()`, `core/card-fields.js`). The card
shows the request as the agent will receive it (`revealHidden()`, `core/text.js`): every space but
the plain one and every character that draws nothing (controls, format characters such as
bidirectional overrides and zero-width characters, private-use characters, every default-ignorable
code point, assigned or not, the Braille blank, Hangul fillers, the Khitan filler U+16FE4,
variation selectors) as a marker such as `⟨U+00A0⟩`; a run of them as one marker naming them (at
most three, then "N more") and its length (`⟨U+00A0 ×1900⟩`, `⟨U+00A0 U+3000 ×2000⟩`); more than
three combining marks on one base as `⟨N combining marks⟩`; and three or more lines in a row that
show nothing (blank, or only spaces, tabs, such characters and combining marks) as one
`⟨N blank lines with U+00A0⟩` marker (`… and combining marks` when they hold any), in the command
and in a diff alike. A run that holds a character some reader takes for a line break is followed
by a line break (one per run), so the lines on the card are the lines it reads: U+2028 and U+2029
(line breaks in JavaScript and in Python's `str.splitlines()`), NEL (in `splitlines()` and some
editors, not in JavaScript), and a carriage return that is neither part of a CRLF nor the last
character of its line (a line break in JavaScript, in Python source and in most editors:
`// note\rconsole.log("RAN")` runs its second line). In a diff only a newline ends a row, so a
carriage return in file content is shown as `⟨U+000D⟩`, and a run of blank-looking rows is
collapsed whatever its rows' kinds; a run of more than one kind counts each
(`⟨120 blank lines: 80 added, 40 removed⟩`). In the browser, Allow, Allow always and Deny ignore
pointer clicks for 1 s after a card appears or moves on the page: its place in the list changed, a
card above it changed size (it was answered or went back to the terminal), or the panel was shown
after it arrived (its tab opened, or the side boards came back on screen).

**Allow always.** `Approval.suggestions` lists the request's `permission_suggestions` the town
offers to save, each with its `index` in that list: `addRules` with `behavior: 'allow'`,
`destination` `localSettings` (this project, only you) or `session` (until the session ends), and
a non-empty `rules` of `{toolName, ruleContent?}` objects, with no field the town does not know on
the suggestion or its rules, each one the card can say exactly in words: one command (Bash or
PowerShell, no `*`: "only this command"), commands starting with a prefix (Bash only, `npm test:*`
or `npm test *`: "commands starting with “npm test”"), fetches from one host (WebFetch
`domain:example.com`, no wildcard: "only fetches from “example.com”") or one MCP tool
(`mcp__<server>__<tool>`, no content: "every use of this tool"). Never an empty content (Claude
Code saves it as the bare tool), `*`, a whole built-in tool, any other wildcard, a PowerShell prefix
(its matching ignores case and expands aliases), a path rule (Read, Edit, Write, Glob, Notebook…,
Cd: Claude Code reads it as a gitignore pattern, so `Edit(src)` covers every file under any
`src/`), an MCP rule with content, or a rule of any other tool. Only suggestions sanitising left
unchanged are offered, only when the hook's body declares `updatedPermissions` in `caps` (§4.3),
and none for Codex, `ExitPlanMode` or `AskUserQuestion` (`public/js/core/permission-rules.js`,
`offeredSuggestions` in `server/approvals.mjs`). The suggestions themselves stay on the server.
`decide` with `always` is accepted only for a held, pending approval, with `decision: 'allow'` and
the `index` of one of its suggestions; anything else answers `{t:'error'}` and changes nothing.

**Deny and stop.** `Approval.canStop` is true for a Claude Code request whose body declares
`interrupt` in `caps` (§4.3). Otherwise `stopNote` says why: Codex ("Codex cannot be stopped from a
hook yet …", as Codex fails closed on `interrupt`) or an older forwarder ("… run andary install …").
`decide` with `stop` is accepted only as `stop: true` with `decision: 'deny'` on a held, pending
approval whose `canStop` is true; anything else answers `{t:'error'}` (the `stopNote` when there
is one) and changes nothing. The hook then gets `{"behavior":"deny","message":…,"interrupt":true}`
and the approval `stopped: true`. On a card that can be answered, "Deny and stop" sits on its own
row under Allow and Deny, after a line saying it also ends the agent's turn, has no key of its
own, and waits out the same 1 s click delay; a card that cannot stop shows the `stopNote` line
instead.
The hook then gets
`{"hookSpecificOutput":{"hookEventName":"PermissionRequest","decision":{"behavior":"allow","updatedPermissions":[<that suggestion, exactly as it arrived>]}}}`,
which the forwarder checks again against its own input (§4.3), and the approval records
`always: { rules, destination, at }`. Whether Claude Code saved the rule is not known, so the card
says what happened: "Allowed; asked Claude Code to save Bash(npm test) for this project, only
you". The card offers one suggestion (the first `localSettings` one, else the first `session`
one): under Allow and Deny, a line says "Allow always asks Claude Code to save the rule …" with
the rule as Claude Code writes it (a backslash and parentheses escaped with a backslash, hidden
characters revealed), what it allows in words and where it is kept, and then, set apart, the
**Allow always** button, which has no key of its own. A short hint says how often the same rule was
allowed today in the same project (allowed in the town, or resolved with `proof: 'ran'`), or that
a rule asked to be saved for this project came back in the same session (the rule may not have
taken) (`public/js/ui/approval-rules.js`). The demo does the same (`sources/demo.js`).

### 4.6 Implementation notes (server)

Settled during implementation; they refine §4.3–§4.5.

- CLI extras: `andary stop`, and `start`/`demo --detach` (the `/town` plugin command starts the
  server in the background). `--approval-timeout` is capped at 140 s because Claude Code kills the
  hook at 150 s. An explicit `--host` address is added to the Host allowlist. A sign-in link
  opened on another `/<page>.html` (the lab pages, which do not read the fragment) only loses its
  token: the redirect has no `#signin=`. `andary simulate` also declares `updatedPermissions` in
  `caps` (its story keeps a rule allowed always, §7); `andary replay` declares only `truncated`.
- HTTPS (ADR 0016, `server/listener.mjs`): with `--tls-cert`/`--tls-key` one port takes both;
  a connection whose first byte is `0x16` (a TLS handshake) gets HTTPS (TLS 1.2 or newer,
  10 s handshake limit), any other gets plain HTTP only from this computer (a loopback peer, or a
  peer connecting from the very address it connected to: a local client of `--host <address>`)
  and a `400` otherwise, after which the server closes the connection within 2 s. `server.json`
  then has `"tls": true` and, on a team host, `"teamHosts"`; local clients keep plain HTTP at
  `serverOrigin` (the bound address, or `127.0.0.1` for a wildcard). With `--host`, `start` also
  prints an `https://` sign-in link for other computers. WebSocket `Origin` may be `http://` or
  `https://` with an allowed host. Stopping ends every connection, stalled ones included.
- The forwarder shrinks payloads over 1 MiB instead of dropping them (strings to 2,000 characters,
  lists to 50 items, 8 levels deep; if that is not enough, only the top-level fields that are not
  objects) and marks such a body `truncated: true` (after either step), so the server never holds
  what it was not sent in full; every body declares so (`caps`, §4.3). It also looks for
  `server.json` next to itself (plugin installs).
- **Call keys** (`server/hook-steps.mjs`): in ingest, before anything reads it, every
  PermissionRequest, PreToolUse, PostToolUse, PostToolUseFailure and PermissionDenied payload gets
  `andary_key`: `inputKey()` (`core/dialogs.js`) of its `tool_input` as it arrived, before
  sanitising, so a request and its result match however long they are. The key leaves out the
  `description` of every Codex call (`andary_source: "codex"`, whatever the tool: Codex adds its
  reason for asking to a request only, never to the call's `PreToolUse` or result) and of a
  Claude Code `Bash` or `PowerShell` call (it changes nothing that runs); any other Claude Code
  tool's, such as an MCP tool's, is part of the call. It reads a command given as an argument
  list as one line. An adapter that renames a call (`andary_tool`,
  §4.12) sets the key itself, from the original call's input, on every payload it makes of it; a
  key from a teammate's server is kept (§4.11). A forwarder's never arrives (its `andary_` fields
  are dropped, §4.12). A renamed call without a key (from an older teammate's server) gets null and
  goes by name. Other hooks lose any `andary_key`. Sanitising keeps it: envelopes carry it.
- **Work-tree tops** (`server/work-trees.mjs`): in ingest, the same tool hooks from this computer
  get `andary_root`, the top of the git work tree their `cwd` is in: the nearest folder up that
  holds `.git` (a folder, or a linked worktree's or submodule's file), looked up again after five
  minutes, kept for at most 256 folders; none when the `cwd` is in no repository or not absolute.
  Any `andary_root` that arrived is dropped first, and a teammate's hooks get none (their folders
  are on their computer). The town's git rules use it (§5.1), and guess without it.
- **Open dialogs** (`public/js/core/dialogs.js`): what an agent has asked you and had no answer to,
  one dialog per call. The phone notes (§4.10), the approval broker (§4.5) and the town (§5.1)
  each keep their own tracker and follow one table, `afterHook()`, at each hook's own time (`hookTime()`,
  `server/hook-steps.mjs`): the forwarder's `ts` (the envelope's), kept between an hour before
  its arrival (`MAX_HOOK_AGE_MS`; an older stamp counts as `arrival − 1 h`) and its arrival. The
  stamp is this computer's own clock, and a computer that sleeps or suspends can hold a hook back
  for minutes, which must still find its own dialog. A
  `PermissionRequest` is sent at once and a `PreToolUse` or a `Notification` in the background, so
  a later hook can arrive first. Each forwarder stamps its own `ts`, so two hooks sent a moment
  apart may carry theirs the wrong way round: "before" and "after" leave `ORDER_SLACK_MS` (250 ms,
  `core/dialogs.js`) between them, as below. Nothing that proves an answer comes that soon (asking
  again takes your answer and a model turn).
  - A dialog opens with a `PermissionRequest`, or with the `PreToolUse` of a question
    (`AskUserQuestion`) or a plan (`ExitPlanMode`), whose own `PermissionRequest` then joins it
    (the newest of that agent's it has not joined yet; with none, it opens one). A request that
    overtook its `PreToolUse` opened the dialog itself: the `PreToolUse` joins it (the newest of
    that agent's of the kind it has not joined yet, opened no more than `ORDER_SLACK_MS` before the
    `PreToolUse`'s time, or after it). A new question or plan closes that agent's older ones of its
    kind (opened more than `ORDER_SLACK_MS` before it): it cannot ask again while one waits, and a
    "No, keep planning" sends nothing else. Known limit: when a plan's or question's request never
    reaches the town (a 429, a failed proof, a restart) and the next one's request overtakes its
    `PreToolUse`, that request joins the older dialog and its `PreToolUse` then closes it: the
    broker resolves the new request `stopped` while it still waits in the terminal (it was never
    held, so only its card goes early); the phone notes still send the new one's note, for the
    dialog its `PreToolUse` opened. A `Notification` (`permission_prompt`) opens one,
    naming no tool, only when nothing of its session is open (its request never reached the town: a
    429, a failed proof, a restart). An MCP server's form (`Notification` with
    `elicitation_dialog`, `elicitation_url_dialog` or `agent_needs_input`) opens a question naming
    no tool, unless the session has one open. Neither opens when it was sent `ORDER_SLACK_MS` or
    more before the newest call the session's lead has started (its newest non-question, non-plan
    `PreToolUse` time; each tracker keeps it for as many sessions as it keeps dialogs, the least
    recent giving way, and forgets it when the session ends or is interrupted): it arrived after
    the call that showed it was answered.
  - It closes only on proof of an answer: that very call reporting back (`PostToolUse`,
    `PostToolUseFailure` or `PermissionDenied` from the same agent, with a tool name in common and
    the same call key; a side without one, a question or a plan, goes by name);
    the town deciding the request it held for it; your prompt or `/compact` (`UserPromptSubmit`, a
    manual `PreCompact`: every dialog of the session, whoever asked, except one whose request the
    town holds right now: nobody can type while a dialog shows in the terminal, and a held one is
    not there); the agent's turn ending (`Stop` for the lead and the session's notices;
    `SubagentStop`, `StopFailure`, or `TeammateIdle` with an agent id for that agent); the session
    ending (`SessionEnd`) or a Codex interrupt (the `Stop` with `stop_reason: "interrupted"`). A
    session's notice or form also closes when the lead starts a new call after it (one whose
    `PreToolUse` was sent `ORDER_SLACK_MS` or more after it, whenever it arrives), never on a tool
    result.
  - Each tracker knows which requests the town holds: `link(call, approvalId, held)` with the
    approval's `held` when it is created, and `toTerminal(approvalId)` when it goes back to the
    terminal (released or expired), after which your next prompt answers it and no later call of
    the same tool takes it for its own.
  - No proof: a new request (parallel calls each ask on their own; a question or plan aside,
    above), a request that expired or was released (the agent waits in its terminal), any tool
    result for a dialog that names no tool.
  - Codex names a helper only on `SubagentStart` and `SubagentStop`, never on its tool calls
    (§4.12), so Codex's dialogs cannot be told apart by agent: a helper's request is the lead's to
    the model, and the lead's `Stop` closes it too.
- Approvals: approval `agentId` has no `agent-` prefix. A held approval goes back to the terminal
  (`held: false`, still pending) when remote approvals are switched off, no browser has been
  connected for 5 s, the hook disconnects, or the server shuts down. Beyond 50 pending, the oldest
  expires. A deny with a typed reason reads "Denied from Andary: <reason>".
- Redaction covers more than §4.4 lists (including fields named like `password`/`api_key`); every
  pattern is length-bounded so a 1 MiB payload cannot trigger quadratic regex time.
- The installer records each settings file's state in `<ANDARY_HOME>/installs.json`, so
  `uninstall` removes only what it added and deletes a settings file it created if it ends up empty.
- `CLAUDE_CONFIG_DIR` is honoured. `vendor/` is cached for a day; everything else is `no-cache`
  with an ETag. The server does not answer `{t:'ping'}` (the socket's own ping/pong keeps it alive).

### 4.8 Token usage and cost

`server/usage.mjs`. Every hook's `transcript_path` (and, for a subagent, `agent_transcript_path`
or `<transcript without .jsonl>/subagents/agent-<id>.jsonl`, else the first folder of `subagents/`
that holds that file name) is read 0.8 s after the first hook
that asks for it (later hooks in that window share the read: a throttle, not a debounce), from
where the last read of that file stopped (at most 16 MB at a time, whole lines only; a single
line longer than that is skipped). Only regular `.jsonl` files whose real path is inside
`<CLAUDE_CONFIG_DIR or ~/.claude>/projects` are read, opened without following links or blocking,
and offsets are kept per real path. Each `type: "assistant"` line's `message.usage` is counted
once per `message.id` + `requestId` across all transcripts (Claude Code splits one message over
several lines, and a forked session, `--fork-session`, copies earlier messages into its new
file); a later line of the same message reporting more output tokens adds the difference. A line
with `isUnmetered: true` counts nothing (Claude Code skips it too). It is priced with
`public/js/core/prices.js` (API list prices; 5-minute cache writes 1.25× input, 1-hour 2×,
Haiku 5.5's long-prompt rate over 100,000 tokens) and added to its agent and to the local day of
its `timestamp`. A reply that lists its sampling iterations (`usage.iterations`) is counted as
their sum, each priced at the model it names (an advisor's) or else the message's: the top level
adds up the executor's iterations (`message`, `fallback_message`) alone, leaving out an advisor's
(`advisor_message`, billed at its own model's price) and a compaction's (`compaction`). One with
a model without a known price makes the whole reply unpriced. Day totals (last 30), read offsets
by transcript path and the newest 4,000
message ids are kept in `<ANDARY_HOME>/usage.json` (mode 0600; numbers, ids and transcript paths,
which name your project folders) so a restart counts nothing twice; agent totals live in memory.

```js
UsageRecord { sessionId, agentId: string|null, tokens: { input, output, cacheRead, cacheWrite },
              costUsd /* estimated */, unpriced: boolean /* a model without a known price */, model,
              context: { tokens, at /* ms: when that message was written */ } | null,
              compactedAt: number|null /* when it last compacted, as far as the tracker saw */ }
UsageDay { date: 'YYYY-MM-DD', tokens, costUsd }
```

**Context in use** (docs/design/agent-health.md §5). A message's context is what its last
executor iteration read, `input_tokens + cache_creation_input_tokens + cache_read_input_tokens`
(output is not in it yet), as Claude Code's status line reads it: the last `message` or
`fallback_message` entry of `usage.iterations`, never an `advisor_message` or a `compaction`, and
the top level when the list is missing or empty (the top level alone would be twice too high
after a reply that consulted an advisor: each executor iteration re-sends the whole context).
`context` is the agent's newest reading: the last message read from its own transcript (lines
are read in the order they were written, so a later line wins), its `timestamp` as `at`. A
subagent's transcript gives the subagent's reading. Not a reading: a message whose three counts
add up to 0, an unmetered line, and, for a lead, a line with `isSidechain: true` (older Claude
Code wrote helpers' messages into the session's transcript). A message counted before still gives
one: a forked session's copies are its context. A compaction makes it `null` until the agent's
next message and sets `compactedAt`: a `PostCompact` or a `SessionStart` with
`source: "compact"` hook does so at once (a `usage` message goes out), and messages written
before the latest such hook started (its `ts`, §4.3, at most the server's clock) give no reading,
so a read already due cannot bring an old one back; a `type: "system", subtype: "compact_boundary"`
line in the transcript does so too, at its `timestamp`. `PreCompact` changes nothing: another hook
can still stop the compaction then. No window size is assumed, so there is no percentage and no
alert: today's default models run a 1M window with no `[1m]` in the model id, and the user may
move the compaction point. Readings are not kept in `usage.json`: after a restart an agent has one
again from its next message. Codex sends no usage the tracker reads (§4.12), so its crews have
none.

The browser store keeps `usage` (agentKey → totals, `context` read defensively: a positive token
count and a positive time, else `null`; `compactedAt` a positive time or `null`) and `usageDays`;
the demo makes up repeatable numbers (`public/js/sources/demo-usage.js`), and a context that grows
with each step and is `null`, with `compactedAt`, from a `PostCompact` to the next step. The HUD
shows a context only while it can still be true (`liveContext`, `public/js/ui/usage.js`): not for
a finished helper, nor for an ended crew, whose agents leave the store; a reading from before
`compactedAt` shows as "context compacted" until the next one. The lead's row in Crews shows it
under its time, where it takes no room from the crew's name ("182k in context",
`[data-testid="crew-context"]`); the inspector's Usage section shows any agent's exact count and
how old the message that used it is ("182,340 tokens in context, as of 2m ago.", or "Context
compacted 1m ago; the new count comes with the next message.", `[data-testid="agent-context"]`). A
record with a reading but nothing counted shows no cost.

### 4.9 The town's growth

`server/progress.mjs` with `public/js/core/growth.js`. Every `Stop`, `SubagentStop` and
`TaskCompleted` hook is a point; every local day with any hook is a busy day (the last 400 are
kept). Both live in `<ANDARY_HOME>/progress.json` (0600). Points unlock `MILESTONES` (bunting 10,
icecream 25, statue 50, wheel 100, balloon 200, golden 500); the HUD hands the unlocked ids to
`world.setLandmarks(ids, { grow })` (§6), with `grow` only for ones unlocked while watching. The
demo keeps its points in `localStorage['andary:demo-progress']`, starting at 92.

### 4.10 Notifications

Phone (`server/notify.mjs`), opt-in: `--notify` uses a random ntfy.sh topic kept in
`<ANDARY_HOME>/notify.json` (0600); `--notify-url <url>` or `ANDARY_NOTIFY_URL` names any http(s)
ntfy topic (no credentials in the URL). The body never names a project, file, command or tool. At
most one note of a kind per 30 s and 30 an hour (test notes aside); a failed post is logged once.
`settings.notify` (also in the unauthenticated `/api/hello`) is a boolean; the topic URL is only in
the WebSocket `hello`. Only this computer's events count (§4.11).

- **Open dialogs** follow the one table of §4.6 (`core/dialogs.js`, `afterHook()`). The notifier
  keeps its own tracker (at most 100), reads each call by its `andary_key`, and links the town's
  requests to their dialogs by `callKey` as the broker reports them, with whether the town holds
  them (a release reports `held: false`; an expiry hands it back too). Only the town's decision
  (`allowed`, `denied`) closes a dialog from the broker: `resolved` follows from the same events,
  which the notifier has already seen.
- **Dialog notes** (priority high): due 10 s after the dialog opens (when its hook was sent), sent
  if it is still open: "A crew needs your permission.", "A crew has a question for you." (an MCP
  server's form too) or "A crew has a plan for you to approve." (a revised plan has a note of its
  own). Dialogs due together make one note with a crew count ("3 crews need your permission."; of
  mixed kinds "3 crews need you."), and a note covers every dialog its crews have open then. One
  30 s limit holds for all dialog notes: while it holds one back, the dialogs wait and go out when
  it allows; past the hour's limit they count as noted, unsent. A noted dialog stays open until its
  proof, at most 30 minutes after it opened (a crashed session sends no `SessionEnd`), so a later
  `permission_prompt` for it sends nothing. At most 100 dialogs are kept; the oldest give way.

  What cannot be seen: a yes in the terminal shows only when the tool finishes (approve a 30 s
  `npm test` in 1 s and the note still goes out); a "No" sends no event before your next prompt or
  the agent's turn ending; a diff you change in your IDE before accepting it reports back with
  another input, so it is not taken for the answer. Any of these can still send a note.
- **Waiting**: "A crew is waiting for your next prompt.", for Claude Code's `idle_prompt`. Codex
  sends no `Notification` events: a Codex lead's `Stop` (an interrupt too) starts a 60 s wait
  (`CODEX_IDLE_MS`) that ends in the same note, once per `Stop`. Codex marks no helper on its tool
  calls, so the session's tools pause the minute while they run: a `PreToolUse` or
  `PermissionRequest` pauses it; a `PostToolUse`, `PostToolUseFailure`, `PermissionDenied`,
  `SubagentStop` or the lead's next `Stop` starts it again; only `UserPromptSubmit`,
  `SessionStart` or `SessionEnd` ends the wait, or its note: the session is then forgotten until
  the lead's next `Stop`. At most 100 sessions wait at once; the oldest gives way. Andary cannot
  see you typing in Codex, so a reply that takes over a minute still sends the note.
- **Stopped**: `StopFailure` posts a limit or an error note.
- **Stuck**: "A crew seems stuck: the same step keeps failing." (rules 1 and 3) or "A crew seems
  stuck: it keeps repeating the same step." (rule 2), by the rule that started the episode, once
  per episode of the stuck rules (§5.1, `public/js/core/loops.js`, `stuckWords`), which the
  notifier runs on this computer's events, at each hook's own time (`hookTime`), with a memory of
  its own: the note goes out when an episode starts, through the usual limits. One held back by
  the 30 s limit is dropped, not sent later, and the episode sends nothing more.
- **Plan limits** (§4.14), only with `--notify-limits` (off by default; it needs `--notify` or
  `--notify-url`): when the mod reports a limit at 90% or more, "Claude's 5-hour limit is 91%
  used. It resets at 15:40." (priority default), once per window: an account's limit of one kind
  until its reset time (reset times less than an hour apart are one window), remembered across
  restarts in `<ANDARY_HOME>/limit-notes.json` (0600, at most 64 windows); with two accounts or
  more the note names the account by its folder ("5-hour limit (.claude-work)"). Each kind of limit
  has its own 30 s turn (`limit-high:<kind>`) and the hour's limit counts them; a note the rate
  limits hold back goes out with a later report. `settings.notifyLimits` says whether it is on.
- A finished turn posts nothing by itself. Stopping the server drops every note still waiting.

This computer (`public/js/ui/notifications.js`), opt-in in Settings (`prefs.desktopNotify`, after
the browser's permission), follows "needs you" (§5.1): while the page is hidden, each new counted
item becomes one system notification naming the crew (its title, or its project's folder), never
a command or a file, a request's, a stuck step's or another agent's ("Permission needed",
"Question for you", "Plan to approve", "Turn stopped", "Crews stopped", "Seems stuck", "Two agents
in one folder", "Turn finished"; a stuck crew's says "<crew> seems stuck: the same step keeps
failing." or, for rule 2, "<crew> seems stuck: it keeps repeating the same step."). Two agents on
the same files (a Write over another agent's change, or a git command over others' changes)
read "<crew> (crew 2) may be undoing another agent's work." (crews in one folder share a project
name, so the number tells which); an Edit's note is not counted, so it never pops up. An item's id is the notification's tag, so no id holds a path or a command: a file goes in
hashed. An item the viewer could already see (the page in front, or notifications off) never pops
up later, nor one that started to count more than two minutes ago (a reconnect or a page opened
in the background); changes that arrive together (a reconnect's history) are checked once. A
permission request waits until its request reaches the town (or three seconds), so it is worded
right the first time. No "Turn finished" while only one of your crews is in town, and nothing for
someone watching a team town with its view link. The same watcher keeps the page title's count
current in a background tab, redraws the HUD when the clock alone changes what the list says (a
note's "4 min ago" too), and tells screen readers of new questions, plans, stops, stuck agents and
agents on the same files, in the item's words without backticks.

### 4.11 Team town

`server/team.mjs`, `server/people.mjs`. One person hosts: `andary start --team [--name <name>]`
(listens on `0.0.0.0` unless `--host` says otherwise) keeps a team secret in
`<ANDARY_HOME>/team.json` (0600) and its people in `<ANDARY_HOME>/people.json` (0600). On the
host, `andary team invite <name> [--url <address>]` adds a teammate and prints their member key
and personal link; `andary team remove <name>` takes one off; `andary team view-link [--url]`
prints the view link; `andary team reset` makes a new secret, which revokes every key and link.

- **People** (`people.json`): `{ v: 1, host: <name>, people: { <name>: { slot, color, nonce, profile } } }`,
  at most 6 (the host and 5 teammates; a seventh invite is refused, and a teammate never takes
  the last place before the host has one). `slot` (0–5) is their home in the residential quarter
  (`core/town-map.js` `HOMES`) and `color` (0–7) an index into `CREW_COLORS`, both the first free
  one on joining and never shared. `--name` names the host (default `Host`; a later `--name`
  renames the host's entry, keeping its home, colour and profile; a teammate's name is refused).
  The host cannot be removed, nor invited as a teammate; with no `--name` and a teammate called
  Host, the host becomes "Host 2" (and the log says so). `nonce` (16 random base64url characters)
  is part of the person's key and link: inviting someone already on the roster prints the same
  key and link, and inviting them again after `team remove` makes new ones, so a removed key or
  link never works again. Every read-modify-write of the file (the CLI's invite and remove, the
  host's profile saves) holds `<ANDARY_HOME>/people.lock` (created exclusively; waited for up to
  2 s; one older than 5 s is taken over). A running host reads the file again within 2 s of a
  change and before every key or link check; any change it sees is announced once (the removed
  person's connections close, everyone gets `{t:'people'}`). A hand-edited file is read
  defensively: malformed entries are dropped, a bad profile cleared.
- **Profile** (`public/js/core/profile.js`, shared with the server): version 1,
  `{ v: 1, color: 0–7, house: 'coast'|'snow'|'neon'|'desert'|'amman', name, agents, look }`.
  `name` is the name the character shows (its name pill and home plate; '' for the roster name)
  and `agents` one name for all the person's agents ('' for role names): each up to 20 letters or
  digits of any script (each with at most 2 combining marks, which do not count), spaces, dots,
  dashes or underscores, already clean (`cleanDisplayName`: NFC, single inner spaces, no control
  or invisible characters), shown as text only. The host refuses a `name` or `agents` that
  `nameProblem` refuses: one equal, compared by `nameKey` (NFKC, case-folded, without marks or
  separators, Cyrillic and Greek look-alikes folded to Latin), to another person's roster name,
  chosen name or agents' name (or to one of those plus a number: "Pixel 2" when someone's agents
  are Pixel), or a word the town uses (You, Host, Foreman, Scout, Builder, Lead, Andary, with or
  without a number). Where a chosen name differs from the roster name, details show both
  ("Ali (alice)": the crews badge, the inspector's "…'s crew", the "You" dialog's taken colours,
  `nameWithRoster`). `look`
  holds exactly: `skin` 0–11, `height` short|medium|tall, `build` slim|regular|broad, `hair`
  short|side|quiff|spiky|straight|wavy|ponytail|pigtails|bun|braids|afro|curly|mohawk|buzz|bald,
  `hairColor` 0–11, `hairStreak` 'none'|0–11, `eyes` dot|round|happy|sleepy|lashes|wink, `brows`
  none|thin|thick|arched, `mouth` smile|grin|neutral|open, `facialHair`
  none|stubble|beard|goatee|moustache, `glasses` none|round|square|sunglasses|goggles, `cheeks`
  none|freckles|blush|both, `earrings` none|studs|hoops, `top`
  tee|longsleeve|hoodie|zip|denim|bomber|blazer|shirt|polo|tank|sweater|cardigan|vest|labcoat|overalls|dress|kimono,
  `topPattern` plain|stripes|checks|dots|emblem, `topColor` and `patternColor` 'theme'|0–11,
  `bottom` trousers|jeans|cargo|shorts|skirt|longskirt|joggers, `bottomColor` 0–11, `shoes`
  sneakers|hightops|boots|sandals|loafers|slippers, `shoesColor` 0–11, `hat`
  none|cap|beanie|beret|sunhat|wizard|crown|hardhat|bucket|headband|bandana|flowers|viking|tophat|chef|halo,
  `extra` none|cape|scarf|backpack|headphones|tie|bowtie|necklace|watch|satchel|wings, `pet`
  none|cat|dog|bird, `hand` none|laptop|coffee|book. Colours are indices into fixed palettes
  (`SKIN_TONES`, `HAIR_COLORS`, `CLOTH_COLORS`; `'theme'` is the person's colour). Every key is
  required; an unknown or missing key, a value out of range, or more than 1,152 bytes of JSON
  rejects the whole profile. `{t:'profile', p}` is validated, saved (at most once per 10 s per
  person, else `{t:'error'}`), answered with `{t:'profile', ok, color, asked}` and broadcast as
  `{t:'people'}`. `color` asks for a colour: when another person has it, the next free one in
  order is given and the browser says so. The browser keeps its own profile in its storage
  (`andary:profile`) once the host saved it, and sends it again when the host has none for it
  (after a fresh `people.json`); the demo starts with it too.
- **Presence** (`server/presence.mjs`, `public/js/core/presence.js`; never stored or recorded:
  after a restart everyone starts at their door). Every `Person` carries where they are: `tile`,
  their last `walk` (`path` from tile to tile on the town plan's walking grid, `at` on the
  host's clock), `online` (a connection plays them), `away` (no connection: `porch` after 60 s,
  dimmed on their porch and back at their door; `inside` after 10 min, not shown),
  `duty` (from their own events: a prompt `work`; a permission request, a failed turn or a
  `permission_prompt`, `elicitation_dialog` or question notification `needs` (an `idle_prompt`
  changes nothing); Stop or SessionEnd `free`; and `free` again after 10 min without an event
  from them, their relay's included) and `lights` (online, or their relay posted in
  the last 2 min). Changes go out as `{t:'presence'}` at most ten times a second.
  `{t:'walk', to}` comes from a person or the owner, for the character the connection plays
  (never a name from the message): the tile must be walkable and reachable in at most 60 steps,
  it is refused while `duty` is not `free` ("Your character is at work"), and a walk asked less
  than 250 ms after the last waits for its turn (the latest wins; if it can no longer start, the
  person's browsers get `{t:'error', message:'Walk dropped: …'}`). A new walk carries on from
  where the figure is (`continueWalk`: mid-step it finishes the step first, `at` set back by the
  part walked), so it never jumps. Every browser places the figure with `positionAt(path, at,
  now + offset)` at 2.2 tiles a second (offset: `hello.serverTime` against its own clock).
  `emote` and `phrase` are indices into fixed lists (no free text reaches another screen), at
  most one emote per 2 s and one phrase per 5 s per person, broadcast with the sender's name.
  `look` names a teammate and an agent key the host has seen in the town's events (the newest
  2,000) or a building; at most one per 30 s per pair, sent
  as `look-ask` to that person's browsers only. A viewer's walk, emote, phrase or look gets the
  viewer error. `ANDARY_PORCH_MS` and `ANDARY_INSIDE_MS` shorten the away times (tests).
- **Walking in the browser** (`ui/walk.js`): walk mode is the toolbar's Walk button or **G**
  (shown to whoever plays a person, and to you in the demo). While it is on the camera follows
  your character (it cuts instead of easing under reduced motion), a click or tap on the ground
  walks to the nearest walkable tile (agents and buildings are still picked first), and on the
  focused town the arrows or WASD take one step a press, from the tile being entered (a held
  key repeats four times a second) while Shift+arrows pan; W and A are not Catch me up and
  Approvals then. The Walk panel above the toolbar has a "Walk to…" list (every building door,
  every home, the teammates who are out), a status line that is a polite live region ("Walking
  to the Library door…", "You are at the Library door."), the eight emotes and ten phrases (on
  a phone the emotes fold away with the phrases), "Ask to come look" (at the selected agent or
  building), and on phones a four-button step pad with 44 px targets (Settings can hide it). A
  `look-ask` is a note with **Go** (selects it; only then does the camera move) and **Not
  now**; Settings → "Come look" notes turns them off. On a phone, walk mode folds the board's
  sheet away. The demo does the same with you and Lina (who strolls and waves now and then).
- **Agents' names**: with `agents` set ("Pixel"), every crew of that person names its lead
  "Pixel" and its helpers "Pixel 1", "Pixel 2"… in the order they joined (`core/crews.js`
  `nameCrew`), in the crews board, the log, the inspector, notifications and the town; the role
  name stays as `AgentState.roleName` and shows beside it ("Pixel 2 · Scout 1") in the inspector
  and the row's tooltip. A member's crews take their own person's name; local crews the host's.
- **Member key**: `encodeURIComponent(name) + "." + HMAC-SHA256(secret, "member:" + name + ":" + nonce)`
  (base64url, first 32 characters). Names keep letters, digits, spaces and `._-`, at most 24.
- **Personal link**: `encodeURIComponent(name) + "." + HMAC-SHA256(secret, "person:" + name + ":" + nonce)`
  (base64url, first 32 characters): separate from the member key, so a leaked link cannot post
  events and a leaked key cannot drive a character. `GET /?me=<token>` (pages only) redirects to
  the same page with `#me=<token>` (percent-encoded), which the page keeps like the sign-in
  (`x-andary-person`, subprotocol `andary.person.<token>`). A member key and a personal link work
  only while their name is on the roster with that nonce: `team remove` stops both at once (a
  person's open connections close with "Removed from the team"), and their `POST /api/team`
  answers 401. A key signed for a name not on the roster (a team from before rosters) is refused
  with one log line per name ("Refused <name>'s key: not on the roster. Run: andary team invite
  <name>"); the member's relay logs "key refused by the host".
- **View token**: `HMAC-SHA256(secret, "view")`, same length. `GET /?view=<token>` (pages only)
  redirects to the same page with `#view=<token>`, which the page keeps like the sign-in (§4.4;
  `x-andary-view`, subprotocol `andary.view.<token>`); a wrong token answers 403.
- **Host names**: a team host answers to loopback names, to `--team-host <name>` (repeatable;
  for a VPN or local DNS name) and, listening on every interface, to its IPv4 network addresses
  (read again every 30 s). `team invite` prints the private-range address first.
- **Sharing**: `andary start --share-to <address>` with the key in `ANDARY_TEAM_KEY` (what the
  invite prints: an argument would show in `ps`) or `--team-key <key>`; `ANDARY_SHARE_TO` works
  too; both or neither; not together with `--team`. A detached server gets the key, and the ntfy
  topic, through its environment. After its own `/api/hook` ingest, the member's server queues
  the **sanitized** envelope (not `andary doctor`'s `andary-doctor-…` sessions; an event over
  1.5 MB is dropped) and posts batches to `POST <address>/api/team` with header
  `x-andary-team: <key>` and body `{"v":1,"events":[{"ts":<ms>,"event":{...}}]}` (at most 100
  events and 1.5 MB per post, every 500 ms; redirects are refused; a batch counts as delivered
  only on a `{"ok":true}` answer; the newest 1,000 wait while the host is away, retried after 1,
  2, 4… up to 30 s).
- **`POST /api/team`** on the host: 404 unless hosting; 401 for a missing or wrong key. It is the
  one route that skips the Host check (the key authenticates it; browsers cannot send the
  header cross-site without a preflight we never answer). Body ≤ 2 MB, at most 200 events used;
  a token bucket per member (300 events/s, burst 600; one token is taken before the body is
  read) and at most 4 bodies read at once answer 429. Each event is ingested like
  a hook (sanitized again) with `andary_member: <name>` and `session_id: "<name>~<id>"`, its
  `ts` kept within the last hour and not in the future; it counts towards the town's growth
  (§4.9) but not usage, notifications, approvals or the catch-up (§4.13): a teammate answers
  their own prompts.
  A local `/api/hook` event never keeps an `andary_member` field.
- **Browsers** are `owner` (the UI token; on a team host the host's own person), `person` (a
  personal link on the roster) or `viewer` (the view token), the last two on team hosts only; the
  owner's sign-in wins over the others. `/api/hello` reports `authenticated: true` for all three.
  A person is treated like a viewer below, except that it may also send `{t:'profile'}`,
  `walk`, `emote`, `phrase` and `look` for itself; its `decide`, `settings`, `digest` and `notify-test` get
  `{t:'error', message:'Teammates can change their own character only…'}`. Each person may hold
  2 connections, and people may use the connections kept for the owner. Every browser gets
  `hello.people` and `{t:'people'}` (a person is `online` while any connection plays them); `me` is
  the person a browser plays (the host's name for the owner, null for a viewer). A viewer's `hello` has no
  approvals, empty usage, empty limits, `notifyUrl: null`, `away: null` and `remoteApprovals: false`;
  `approval`, `usage`, `limits`, `away` and `settings` broadcasts go to owners only (a team host
  never receives a member's limits: they are not events); a viewer's messages other than `ping` get
  `{t:'error', message:'Viewers can only watch…'}`. Viewers never use the last 4 connections, and
  held prompts wait only while an owner is connected. On a team host `settings.team` is
  `{ role, members }` (role `owner`, `person` or `viewer`; members: names seen since start); when a new member's first batch
  arrives every browser gets `{t:'settings', settings:{team}}`.
- **Tunnel** (`server/tunnel.mjs`, ADR 0019): `andary start --team --tunnel
  [--tunnel-allowed-mail <emails>]` (`--tunnel` needs `--team`; the mail list needs `--tunnel`,
  addresses or `*@domain`, comma-separated or repeated; exit code 2 otherwise). Before anything
  starts, a `server.json` whose town is gone is checked: a live `tunnel.pid` whose command line
  is cloudflared for `tunnel.port` is stopped (SIGTERM, SIGKILL after 3 s) with a note, one that
  cannot be confirmed gets a warning naming the pid and is left running (`andary doctor` does
  the same when no town answers). Then exit code 1 with a message when `cloudflared` is not on
  the PATH (absolute entries only, `cloudflared.exe` on Windows; with how to install it per
  system; nothing is downloaded), when `config.yml` or `config.yaml` exists in
  `~/.cloudflared`, `~/.cloudflare-warp`, `~/cloudflare-warp`, `/etc/cloudflared` or
  `/usr/local/etc/cloudflared`, or when a mail list is given and `cloudflared tunnel --help` does not list
  `--allowed-mail`. The host binds `127.0.0.1` unless `--host` is given, plus a plain-HTTP
  listener on `127.0.0.1:<random>` for the tunnel, then runs `node server/tunnel-watchdog.mjs
  <cloudflared> tunnel --no-autoupdate --url http://127.0.0.1:<tunnel port> [--allowed-mail
  <address>]…` with its environment minus `ANDARY_*` and `TUNNEL_*`. The watchdog prints
  `andary-tunnel-pid <pid>` (or `andary-tunnel-error <code>`) and stops cloudflared when its
  stdin, which the town holds open, closes. The first `https://<label>.trycloudflare.com` in its stdout or
  stderr (not `api` or `www`, not followed by more of a name or a path) is the address; with
  none within 30 s, or if cloudflared ends first, the town stops and the start exits 1 with
  cloudflared's last lines. `server.json` gets `tunnel: {url, pid, port}` (cloudflared's pid); if it ends later,
  `tunnel: {url: null, port, error}` and the tunnel's Host names are dropped. Stopping the town closes the
  watchdog's stdin first (SIGKILL to both after 5 s). `team invite` uses `tunnel.url` for both
  lines when no `--url` is given; `andary doctor` reports the tunnel as on, down, gone (its pid
  is not alive) or off, from `server.json` only. A detached start (`--detach`) passes the flags
  on and waits until `server.json` has `tunnel`.
- **Browser**: `TownEvent.member` (from `andary_member`, one line, ≤ 24 characters) →
  `Session.member`; a member's lead agent is named after them, and the crews board shows a
  `crew-member` badge. Every crew of a person takes their colour (`store.setPeople`, from
  `hello.people` before its history and from `{t:'people'}`; a member's crews are theirs, local
  ones the host's; crews of anyone else take turns as before), and changes with it. Each person's
  home in the residential quarter shows their house style, their colour on the door and flag, a
  name plate, and lit windows while `lights`; their figure stands where they are, walks their
  walks, sits dimmed on their porch while `away` is `porch` and is gone while `inside`
  (`ui/town-people.js`, World `setHome`, `placePerson` and an `AgentSpec` with `role: 'person'`). Settings shows
  a "Team town" note for every role, a "You" block with **Your character** for whoever plays a
  person (the "You" dialog, `ui/character.js`), and hides remote approvals and phone
  notifications from viewers and people. Notifications on this computer skip
  teammates' crews, and a viewer gets none. `hello` always sets `settings.team` (null when not
  a team host). `server.json` records `team: true` on a host, so `team invite` can warn when the
  running town is not one.

### 4.12 Source adapters (Codex)

Every agent's payloads are translated on the server, before ingest, into the one event contract
the rest of the town reads: the Claude Code hook payload (§4.2). `server/adapters/index.mjs`
picks the adapter by the body's `source` (`claude` when absent) and drops every `andary_` field
from what arrived (`andary_member`, `andary_source`, `andary_tool`, `andary_key`: only the server
sets them).

- **Claude Code**: unchanged.
- **Codex** (`server/adapters/codex.mjs`): Codex's hooks use Claude Code's event and field names,
  so payloads pass through with `andary_source: "codex"` added, except:
  - `PreToolUse`/`PostToolUse` of `apply_patch`: the patch (`tool_input.command`, `.input` or
    `.patch`; the `*** Begin Patch` format, `server/adapters/apply-patch.mjs`) becomes one event
    per file: an added file `Write {file_path, content}`, an updated file `Edit {file_path,
    old_string, new_string}` (one hunk) or `MultiEdit {file_path, edits}` (several; a move uses
    the new path), a deleted file stays `apply_patch {command, file_path}`. Paths are joined to
    `cwd`. The first keeps the `tool_use_id`, the others get `<id>#2`, `<id>#3`…
  - `spawn_agent` becomes `Agent {description, prompt, subagent_type}`.
  - Both keep Codex's own tool name in `andary_tool` (`apply_patch`, `spawn_agent`) and the call
    key of the original call's input in `andary_key` (on every payload made of it, §4.6): a
    permission request asked under that name settles when the renamed call runs (§4.5), and the
    browser's `ToolData.sourceTool` carries the name.
  - `Bash` with `tool_input.command` as a list: joined with spaces, each argument quoted the way a
    shell would need it (`['rm', 'a b']` → `rm 'a b'`). The approval card quotes a list the same way. A `PostToolUse` whose
    `tool_response` (or the payload) has a non-zero `exit_code`/`exitCode`/`metadata.exit_code`
    becomes `PostToolUseFailure` with `error` (stderr, output or "Exit code N", ≤ 500 characters).
  - `Interrupt` becomes `Stop` with `stop_reason: "interrupted"` (it earns no growth point).
  - An event it already translated passes through unchanged, so `andary replay` sends a recorded
    Codex event (one with `andary_source: "codex"`) as Codex's again and it keeps its mark.
  - `PermissionRequest` is never split or rewritten: the town shows exactly what it would approve.
    It does not say whether the command asks to leave Codex's sandbox or reach the network, so the
    card says that allowing may (§4.5). Its `tool_input` may carry a `description`, Codex's reason for asking, for any tool,
    which the call's `PreToolUse` and `PostToolUse` do not: every Codex call's key leaves it out
    (§4.6).
  - Codex names a helper (`agent_id`) only on `SubagentStart` and `SubagentStop`: its other
    events, tool calls included, read as the lead's (§4.6, §4.10).
- Token usage is read from Claude Code transcripts only (Codex rollouts are not read yet), so a
  Codex crew shows no cost and no context in use (§4.8).
- The browser reads `andary_source` into `TownEvent.source` and `Session.source`
  (`'claude'|'codex'`); a Codex crew has a `crew-agent` badge, OpenAI model ids get a cap and a
  label such as "GPT-5.3 Codex", and `apply_patch`/`spawn_agent` map to the Workshop/Town Hall.

### 4.13 Catch me up

`server/digest.mjs` with `public/js/core/digest.js` and `public/js/core/shell.js`
(docs/design/agent-health.md §7). Only this computer's hooks count (ingest's policy: a teammate's
crews are theirs, and so are their prompts), and only owners hear of it: a viewer's `hello` has
`away: null`, gets no `away` message, and a `digest` request gets the viewer error (§4.11). All of
it is kept in memory, never on disk (it holds your agents' last messages); a restart forgets it.

- **Away** (`createAwayWatch`): nothing from you in any local session for `AWAY_MS` (20 minutes)
  or more, while crews kept working. You are a prompt (`UserPromptSubmit`, or a manual
  `PreCompact`, as the dialog model reads your prompt, §4.6), a `SessionStart` with `source`
  `startup`, `resume` or `clear`, a `SessionEnd` with `reason` `prompt_input_exit` or `clear`, an
  interrupted `Stop` (Codex's `Interrupt`), a decision (an approval `allowed` or `denied` with
  `decidedBy: 'town'`), and an answer in the terminal (an approval `resolved` with
  `decidedBy: 'terminal'` and `proof` `'ran'` or `'denied'`). Crews kept working: a
  hook that adds to the counts below (`tallyOf` is not null) arrived since you were last seen (the
  doctor's probe aside). Before you first do something, the town's start counts as when you were
  last seen. An absence begins at the 20-minute mark (on a timer) or with the first counted hook
  after it, and the next thing you do ends it. A request the agent moved on from
  (`proof: 'stopped'`), an expiry and a release are not counted as you.

  ```js
  Away { since /* the last thing you did before it */, until: number|null /* the first thing after it; null while away */ }
  ```

  `hello.away` is the latest absence, going on or over (null when there has been none), and owners
  get `{ t: 'away', away }` when one begins and when it ends.
- **Counts** (`createDigest({ startedAt })`; the demo keeps its own the same way): per crew, timed by
  when each hook arrived (`envelope.rx`), from the sanitized payload, for the last 24 hours
  (`KEEP_MS`) and never before the server started.

  | Hook | Counts as |
  | --- | --- |
  | `Stop` | a finished turn (`turns`, by its time), and the latest turn's `last_assistant_message`, one line, ≤ 200 characters (`lastMessage`, null when that turn said nothing); not with `stop_reason: "interrupted"`; with `stop_hook_active: true` its words only, as the same turn goes on |
  | `StopFailure` | a stop, by its `error` (`stops: { rate_limit: 2 }`) |
  | `PreToolUse` | a tool call (`toolCalls`); a Codex patch's later files (`andary_tool: 'apply_patch'`, `tool_use_id` ending in `#2`, `#3`…) are the same call |
  | `PostToolUseFailure` | a failed tool call (`failures`), unless `is_interrupt`; a test run that alone could have failed it and runs tests, with an error that is not a timeout (`classifyError`): `tests: 'failed'` |
  | `PostToolUse` | a file changed (`files`: distinct paths of `Edit`, `MultiEdit`, `Write`, `NotebookEdit`, and a Codex `apply_patch` that deletes one); test runs that all must have succeeded and run tests: `tests: 'passed'`; each new commit and each push that sends something, that must have succeeded; from Codex (`andary_source: 'codex'`), these only with `andary_exit_known` (its adapter found the exit code) |
  | `PermissionRequest` | a permission asked for (`asked`); not for `AskUserQuestion` or `ExitPlanMode` |
  | `SubagentStart`, `SubagentStop` | a helper started (`helpersStarted`), finished (`helpersFinished`) |
  | an approval settling `allowed` or `denied`, or `resolved` or `expired` with `proof` `'ran'` or `'denied'` (the broker's `onChange`; `'stopped'` is not an answer) | a permission answered (`answered`) |

  A `Bash` or `PowerShell` command (a line, or a Codex argument list) is read by `shellCommands`
  (core/shell.js, the shared reader) as a shell runs it: quoted strings, heredoc bodies, comments
  and redirections are text, and a substitution stays whole in its word; each simple command's
  program (lower case) is found behind assignments, wrappers and launchers (`cd x &&` is a command
  of its own; `env`, `time`, `timeout`, `npx`, `npm exec`, `uv run`, `poetry run`, `bundle exec`,
  `python -m`…), and a shell's `-c` script is read inside, one level deep. Each command `succeeded`
  when the line succeeding proves it (it is in the line's last item, with no `||` and not sent off
  with `&`, and is the last of its pipeline, or any of it after `set -o pipefail`), and `decides`
  when the line failing proves it failed (it succeeded in that sense and every other such command
  is one that does not fail in practice: `cd`, `export`, `set`, `echo`, `tail`, `head`, `tee`…). A
  test run is `isTestRun` (a runner, a package's `test` script, a tool's `test` subcommand); it runs
  no tests with `--no-run`, `--collect-only`, `--co`, `--list…`, `-l`, a `list` argument, `--help`,
  `-h`, `--version`, `--if-present`, or as `go test -run`, and then gives no result. A commit or a
  push is `gitAction` (git in command position after its own options such as `-C` and `-c`; not
  `--dry-run` or push's `-n`); a commit with `--amend` is not a new one, a push with `--delete`,
  `-d` or a `:branch` refspec sends nothing, and each "Everything up-to-date" in the tool's output
  is one push less. `allPushed` says a push came after the latest commit. A
  command sent to the background (`run_in_background`) has only started when its hook comes, so it
  is a tool call and nothing more.

  Tool calls and helpers are kept in five-minute buckets (`BUCKET_MS`), each with the time of the
  latest thing it counted; turns, failures, permissions asked and answered, commits, pushes and
  stops keep each one's time (the latest 200 of each per crew), and changed files (200 per crew,
  by a short key of the path), the latest message and the latest test result keep theirs. Bounds:
  100 crews (the one quiet for longest gives way), a day of buckets each.
- **The request** `{ t: 'digest', since }`: `since` must be a number ≥ 0 (otherwise
  `{ t: 'error', message: 'digest.since must be a time in milliseconds' }`). The answer goes to the
  browser that asked only. The period starts at `since`, or later when the town remembers no
  further back (`max(server start, now − 24 h)`, and `limit` says which); one after now counts from
  now. Everything is counted from `from`: `since`, or the start of the bucket `since` falls in when
  any crew's bucket began before `since` and counted something since then (up to five minutes
  earlier), so the counts are never mixed:

  ```js
  Digest { since /* the period's start */, from /* where every count starts: since, or a bucket's start before it */,
           until /* now, the server's clock */, limit: 'started'|'day'|null /* why since is later than asked */,
           crews: CrewDigest[] /* those that did something, the most recently active first */ }
  CrewDigest { sessionId, cwd, title: string|null, lastAt /* its latest hook */, turns, lastMessage: string|null,
               stops: Record<string, number>, failures, tests: 'passed'|'failed'|null, commits, pushes,
               allPushed: boolean, files, asked, answered, helpersStarted, helpersFinished, toolCalls }
  ```

### 4.14 Plan limits: the andary-limits mod

The 5-hour and weekly limits (and a gateway's spend limit) reach no hook. Claude Code (v2.1.287 and
later) gives them to **mods**: plugins whose `hooks/hooks.json` names a JavaScript hooks module
that runs inside Claude Code. `mods/andary-limits/` is one, offered as a second plugin of this
repository's marketplace (`andary-limits@andary`), so nobody who installs Andary gets a mod
without choosing it. It has no settings hooks of its own and works beside the `andary` plugin or
`andary install` alike. No status-line bridge: it would hide some of Claude Code's footer hints and
would have to run the user's own status line (design §9).

**The mod** (`hooks/register.js`, ES module, `register(on)`): one hook, on `session.measure`
("after each turn, and when a plan limit's percent used changes"). It starts a report and returns
`next(e)` at once (the report never holds the session up; the hook's 10 s limit is far away), and
nothing it does can throw into the session. A report: read `<ANDARY_HOME or $HOME/.andary>/server.json`
with `$.fs.read` (none: stop; ANDARY_HOME as Claude Code's own environment has it: unlike the
forwarder the mod has no install folder to look in); use its `host` only when it is a loopback
address, `localhost` or a wildcard (127.0.0.1), else send nothing; challenge `GET /api/proof` exactly as the forwarder does (§4.3) and
check the proof with HMAC-SHA256 built on `crypto.subtle.digest` (the hooks sandbox has `digest`,
`getRandomValues` and `randomUUID`, but no `importKey`, `sign` or `verify`); read
`$.session.usage()`, `$.session.id()`, `$.session.version()` and `$.env.get('CLAUDE_CONFIG_DIR')`;
`POST /api/limits` with `x-andary-secret` and

```js
{ v: 1, sessionId: string|null, claudeVersion: string|null /* "2.1.330" */, configDir: string|null,
  limits: [{ kind /* five_hour, seven_day, spend_limit */, percentUsed: number, resetsAt: string /* ISO */ }],
  context: { tokens: number, window: number } | null /* null before the first answer */ }
```

Numbers and identifiers only (no cost, nothing of the conversation). Readings that come while a
report is on its way make one more report, of the newest numbers; the flight is freed in the step
that finds no newer reading. `$` is never stored (Claude
Code's static check refuses that), so that report reuses the `$` of the one in flight.
`claude plugin validate mods/andary-limits` lists exactly `$.env.get` (ANDARY_HOME,
CLAUDE_CONFIG_DIR, HOME, USERPROFILE), `$.fs.read`, `$.http.fetch`, `$.session.id`,
`$.session.usage` and `$.session.version`; `claude plugin test mods/andary-limits` runs its tests
in Claude Code's own engine.

**The server** (`server/limits.mjs`): validates defensively (`kind` `/^[a-z][a-z0-9_]{0,39}$/`, a
kind once, at most 8; `percentUsed` clamped to 0–100, one decimal; `resetsAt` no more than a day
past and at most 32 days ahead; `sessionId` `[\w.:-]{1,200}`; `claudeVersion` `\d+.\d+.\d+…` ≤ 64;
`context` whole numbers ≤ 100,000,000, window ≥ 1; anything else dropped or null). **Accounts**:
limits belong to a Claude account, told apart by the config folder (`account: "default"`
without `CLAUDE_CONFIG_DIR` or when it names `~/.claude` itself, else `"dir-" + base64url(sha256(folder))[0..16]`, `label` the folder's
name; the path itself is not kept). A report updates the kinds it carries, each with its own
`at` (arrival time); within one window (reset times less than an hour apart) a lower reading
does not replace a higher one, as each session reports what it saw last; one that carries none (an API key, a session before its first answer) keeps
the account's. At most 8 accounts and the exact context of 100 sessions are kept, newest first,
in memory only (a restart forgets them until the next turn). Limits whose `resetsAt` has passed
are left out of every snapshot.

```js
LimitsSnapshot { accounts: AccountLimits[] /* newest first */,
                 contexts: Record<sessionId, { tokens, window, at }> /* not shown yet: design §5 */ }
AccountLimits { account, label: string|null, claudeVersion: string|null, at: number,
                limits: [{ kind, percentUsed, resetsAt: number, at: number }] }
```

**The town** (`public/js/core/limits.js`, shared with the server for the phone note;
`ui/limits.js`): the Usage button carries a gauge (`usage-gauge`) of the most used limit of any
account, and its name says it ("Usage and cost. 5-hour limit 42% used, resets at 15:40"). The Usage
dialog opens with "Plan limits": per limit (`limit-gauge`) its name, "42% used" (rounded down;
one decimal from 99, "99.5% used"; "used up" only at 100), a meter, "as of 14:02, resets at 15:40" (24-hour, this computer's time zone; "tomorrow", a weekday
within the week, else a date), and a projection when the pace would run it out first. Levels, from
the reported percent: `ok`, `warn` from 75%, `high` from 90%. Projection words: "around 15:20",
"tomorrow around 09:10", "on Mon around 12:00". **Projection rule** (`runOutAt`): the average pace since
the window opened, as of the reading; a window opens one length before it resets (5 hours, 7
days; a spend limit's period is not reported, so it gets none). Run-out = opened + (reading time −
opened) × 100 / percent used, shown only when it falls before the reset and after now, the
reading came after the first tenth of the window, and the limit is neither at 0 nor used up. Not
counted in "needs you": Claude Code warns at 85% itself. With no reading the dialog says how to
add the mod (`limits-note`), except to a team viewer: "Only the town's host sees plan limits."; the demo makes a reading up (`sources/demo-limits.js`).

**Doctor**: from the hello's `limits`, "the andary-limits mod reported 4 min ago from Claude Code
2.1.330"; a warning when a settings file enables `andary-limits@…` but nothing came since the
town started (with `ANDARY_HOME` set, that Claude Code must be started with the same one);
otherwise how to add it (optional).

### 4.15 Notes to agents

The owner can send an agent a note from its details; the agent reads it at its next step, never
in the terminal (ADR 0018). `server/notes.mjs` keeps them, `public/js/core/notes.js` holds the
rules both sides share.

```js
Note = { id, status: 'queued'|'delivered'|'expired', sessionId, agentId: string|null /* normalised; null: the lead */,
         text /* cleaned */, createdAt, expiresAt /* createdAt + 30 min */, deliveredAt?, hook? /* the hook whose reply carried it */,
         reason? /* why it expired */ }
```

- **Who may send.** Only a browser signed in as the owner (a viewer gets "Viewers can only
  watch"). A note is accepted only for a session this computer's forwarder posted to `/api/hook`
  (never one from `/api/team`, whatever its id), whose latest body declared `notes` in `caps`
  ("… older version … andary install …" otherwise), that has not ended (`SessionEnd`), and for a
  helper whose hooks came with that `agent_id` and that has not finished (`SubagentStop`). The
  server remembers at most 500 sessions and 100 helpers each. The sender gets
  `{t:'note-reply', ref, ok: true, id}` once the note is queued, or
  `{t:'note-reply', ref, ok: false, error: 'The note was not sent: <why>.'}`, with the `ref` it
  sent (`null` for none or a malformed one).
- **Text.** `noteText()`: CR LF, a lone CR, U+2028 and U+2029 become LF, a tab a space, other
  control and format characters, variation selectors, the Hangul fillers (U+115F, U+1160, U+3164,
  U+FFA0) and lone surrogates are removed, trailing spaces of each line and more than one blank
  line in a row go, then the ends are trimmed. Empty is refused; longer than 2,000 characters is
  refused, never cut.
- **Bounds.** At most 5 queued per agent and 100 in all; 12 notes a minute with bursts of 5, from
  all browsers together, charged only for a note that would otherwise be queued.
- **Delivery.** A hook's reply carries the queued notes of its own session and agent (`agent_id`,
  normalised), oldest first, at most 4, when its body declares `notes` and its hook (as the agent
  named it) is one of `PreToolUse`, `PostToolUse`, `PostToolUseFailure`, `UserPromptSubmit`
  (Claude Code) or `PreToolUse`, `PostToolUse`, `UserPromptSubmit` (Codex) (`carriesNotes()`).
  They leave the queue while the reply is on its way, and are marked `delivered` with that `hook`
  once the reply is written out ("sent with its <hook> hook": nothing confirms the agent read
  them); the forwarder prints them (§4.3 step 5a). They go back in the queue, oldest first, when
  the forwarder is gone: its socket ended or closed once the server has polled it after the request,
  or the response closes before it finishes (or they expire, if their agent can no longer get one).
  The hooks run in the background, so the agent reads them at its next step: its next model call,
  or with your next prompt when it is idle. Codex adds a background hook's output at its next safe
  point, or with the next turn when none is active, and drops it when the session ends.
- **Expiry.** A note expires after 30 minutes (checked every 15 s and when a hook comes), when its
  session ends ("the session ended"), when its helper finishes ("the helper finished"), when the
  session's forwarder stops declaring `notes`, or when the server forgets the session. The server
  keeps the last 50 settled notes for `hello`.
- **Browser.** `store.setNote(note)` keeps each note's latest state (at most 100) in
  `StoreState.notes`, with a log line (`kind: 'note'`) per new state: `noteStateText()` and the
  note's text. The director shows an envelope on the agent's name badge while notes wait (`✉`,
  `✉2` …, before a combo chip). The inspector's "Send a note" section (`ui/agent-note.js`) shows in
  a live town for the owner, not for a teammate's crew (it says why) or a finished agent, with the
  explanation "It arrives at the agent's next step …, not in your terminal" (and that Ctrl/Cmd+Enter
  sends), a line for a Codex agent (when Codex takes it) or a helper (delivery not confirmed), and
  the agent's last 3 notes with their state. A sent note stays in the field, read-only, until its
  `note-reply`: queued empties it ("Queued: it reaches the agent at its next step"), refused keeps
  it with the reason (`[data-testid="send-note-status"]`), and no answer within 10 s gives it back.
  The demo has no notes.

## 5. Browser: events, store, director

`public/js/core/events.js` turns an Envelope into zero or more **TownEvents**:
`{ id, ts, kind, sessionId, agentKey, agentId|null, agentType|null, cwd, data }` where
`agentKey = sessionId + ':' + (agentId ?? 'main')`. Kinds: `session.start`, `session.end`, `prompt`,
`tool.start`, `tool.end`, `tool.fail`, `permission.request`, `permission.denied`, `notify`,
`subagent.start`, `subagent.stop`, `turn.stop`, `turn.fail`, `task.created`, `task.completed`,
`teammate.idle`, `compact.start`, `compact.end`, `model.switch`, `todos.set`, `task.upsert`,
`spawn.request`, `spawn.result`, `message.send`, `unknown`. `tool.start` carries
`{toolUseId, tool, input, building, activity, summary, callKey, root}` where `summary` is a short
human string ("Read src/auth/login.ts", "$ npm test", "grep \"TODO\" in src"), `callKey` the
server's key for the call's input (`andary_key`, §4.6), or null, and `root` the top of the hook
folder's work tree as the server found it (`andary_root`, §4.6), or null. `tool.fail` adds
`error` (its first line) and `errorText` (every line, up to 2,000 characters, for the stuck
rules). `tool.end` adds `response`, `durationMs` and `exitKnown` (a Codex command's adapter found
its exit code, `andary_exit_known`, §4.12: only then does its success prove anything). `turn.stop`
carries `interrupted` (Codex's interrupt).

`store.js` keeps sessions (crews), agents, tasks/todos, approvals, the activity log (ring buffer)
and stats, and emits change notifications. `director.js` turns TownEvents into world calls and
keeps a per-agent action queue so a burst of fast tool calls never builds unbounded lag: more than
3 queued visits → run; more than 6 → teleport and collapse duplicates. `humor.js` supplies quips.

Agent names: the main agent is "Foreman"; subagents use their spawn `name` if given, otherwise a
role name by type plus a number: Explore → Scout, Plan → Architect, general-purpose → Builder,
other types → Title Case of the type. Teammates use their teammate name.

### 5.1 Store API (`public/js/core/store.js`), consumed by the HUD

The store's types are defined once, in `core/store.js`; `ui/types.js` re-exports them. Inside the
store, `store-model.js` holds its working memory, `crews.js` creates sessions and attributes each
event to an agent, and `changes.js` keeps the files and edits each agent made.

```js
export function createStore(options?: { maxLog?: number /* default 500 */ }): Store
Store {
  ingest(envelope: Envelope): TownEvent[]        // normalize (events.js) + apply; returns the events
  dispatch(event: TownEvent): void               // apply one already-normalized event
  setApproval(approval: Approval): void          // from the server, or created by demo mode
  setUsage(record: UsageRecord|null, days?: UsageDay[]): void  // §4.8; null record: days only
  setNote(note: Note): void                      // §4.15, from the server; junk and repeats are ignored
  subscribe(listener: (change: StoreChange) => void): () => void
  getState(): StoreState                         // plain objects; treat as read-only
  reset(): void
}
StoreChange = { type: 'event', event: TownEvent } | { type: 'approval', approval: Approval }
            | { type: 'achievement', achievement: Achievement } | { type: 'usage', agentKey: string }
            | { type: 'note', note: Note } | { type: 'reset' }
StoreState {
  sessions: Session[]                            // in order first seen
  agents: Record<agentKey, AgentState>
  approvals: Approval[]                          // pending first, then most recent
  dialogs: Dialog[]                              // open: asked and not answered yet, oldest first
  hazards: Hazard[]                              // two agents on the same files now, oldest first
  log: LogEntry[]                                // newest last, capped at maxLog
  stats: { events, toolCalls, failures, approvals, subagents, byBuilding: Record<BuildingKey, number> }
  achievements: Achievement[]
  usage: Record<agentKey, AgentUsage>            // §4.8
  usageDays: UsageDay[]
  notes: Note[]                                  // §4.15, oldest first
  receipts: Receipt[]                            // a receipt per lead's turn that ended, newest last, ≤ 60
}
AgentUsage { tokens: { input, output, cacheRead, cacheWrite }, costUsd, unpriced: boolean, model: string|null,
             context: { tokens, at } | null /* §4.8: the newest reading; null when unknown */,
             compactedAt: number|null /* §4.8: when it last compacted */ }
Session { id, number /* the crew's number: the lowest no crew still in town holds when it arrived; kept while it works; free again once it ends (an ended crew is shown without it); a crew that comes back takes a free one if another crew holds its own */,
          project /* cwd basename */, cwd, title?, color, model?, permissionMode?,
          member?: string|null /* §4.11 */, source?: 'claude'|'codex' /* §4.12 */,
          status: 'working'|'waiting'|'idle'|'ended', goal? /* latest meaningful prompt, trimmed: one that only says to go on ("continue", "yes", "2"; core/goals.js) keeps the goal before it, and is logged as "Prompt: …" */,
          startedAt, lastActivity, agentKeys: string[],
          todos: { text, status: 'pending'|'in_progress'|'completed' }[],
          tasks: { id, subject, status: 'pending'|'in_progress'|'completed', owner? }[] }
AgentState { key, sessionId, agentId: string|null, name, role: 'lead'|'subagent'|'teammate', type,
             color, hat, status: 'working'|'waiting'|'idle'|'error'|'done', building, activity,
             currentTool?, summary?, description?, startedAt, lastActivity,
             toolCounts: Record<string, number>, files: string[] /* recent unique, ≤ 30 */,
             changes: FileChange[] /* finished Edit/MultiEdit/Write/NotebookEdit, ≤ 20, newest last */,
             recent: LogEntry[] /* ≤ 30 */, errors: number, lastMessage?,
             wait: Wait|null /* what it waits for you on, below */,
             movedAt /* hook time it last moved on: a prompt, a tool call… */,
             stuck: Stuck|null /* why it seems stuck, below */ }
Wait { kind: 'finished'|'stopped', since /* hook time */, text /* one line */,
       idleAt: number|null /* finished: when idle_prompt said nobody answered */,
       cause: string|null /* stopped: StopFailure's error code */ }
Dialog { id, sessionId, agentId: string|null, kind: 'permission'|'question'|'plan'|'unknown',
         tools: string[], input: string|null /* inputKey() of the call */, at /* hook time */,
         approvalId: string|null, held: boolean /* the town holds its request now */,
         requested: boolean /* its permission request came */,
         begun: boolean /* its PreToolUse came */, text /* what it is about */ }
         // StoreState.dialogs: open ones
Stuck { rule: 1|2|3, step /* short, for display: "npm test" */,
        since /* when the episode started */, count /* failures (rules 1, 3) or runs (rule 2) */,
        text /* "Seems stuck: `npm test` failed 3 times, nothing changed" */ }
Hazard { id /* one per episode: kind:agentKey:at, and for a file the other's key and the path hashed */,
         kind: 'edit'|'write'|'git', sessionId, agentKey /* who changed the file or ran the command */,
         others: { key, sessionId, files /* how many of its changed files */, at /* its latest */ }[]
           /* whose changes it is about: one for a file, one or more for a command */,
         at /* hook time */, folder /* where: the hook's cwd, or the command's after cd or git -C */,
         path: string|null /* edit, write: the file, absolute */, tool: string|null /* edit, write */,
         command: string|null /* git: "git stash", "git add -A && git commit" */,
         toolUseId: string|null, callKey: string|null /* git: the call's ids, to end it when refused */ }
LogEntry { id, ts, sessionId, agentKey, agentName, color, kind /* a TownEvent kind, 'approval',
           'achievement', 'stuck', 'conflict' or 'receipt' */, icon, text, level: 'info'|'success'|'warn'|'error',
           receiptId? /* a 'receipt' line: its Receipt's id */ }
Achievement { id, title, description, icon, unlockedAt }
FileChange { id, path /* relative to the crew's folder */, tool, ts, whole: boolean /* Write */,
             hunks: { before: string, after: string }[] /* from tool_input, ≤ 4,000 characters each */ }
```

**Needs you** (`core/dialogs.js`, `core/waits.js`, `core/attention.js`, all pure;
docs/design/agent-health.md §3). `StoreState.dialogs` lists what agents asked you and had no answer
to, in the model the phone notes and the broker share (§4.6, `core/dialogs.js`, whose `afterHook`
table says what each hook does, at the event's own `ts`, as hooks may arrive out of order): a dialog
per call, opened by a `PermissionRequest`, an `AskUserQuestion` or `ExitPlanMode` call (the
permission request Claude Code sends for one joins it, whichever arrives first; asking again closes
the older one), an MCP server's form (`elicitation_dialog`, `elicitation_url_dialog`,
`agent_needs_input`), or a session's `permission_prompt` notice when nothing of that session is
known to be open; closed only by that very call reporting back (same tool and input; questions and
plans by name), the town deciding its request, your prompt or a manual `/compact` (every dialog of
the session the town is not holding: nothing showed in your terminal if you could type), the agent's
turn ending (also in an error, or a teammate going idle) or the session ending; a notice or a form
closes when the lead starts a new call after it. A request sent back to the terminal, a new request
and guesses are no proof. `core/store-dialogs.js` feeds it from events (with the server's `callKey`
when it sent one) and approval changes: an approval links to its dialog by its `callKey` and says
whether the town holds it; one with no dialog (older than the history kept) opens one; `allowed`,
`denied` and `resolved` close it (the broker resolves by the same table). A teammate's crew keeps no
dialogs.
`AgentState.wait` is the rest: a lead's finished turn or a failed turn. A prompt, a tool call, a new
session, a helper finishing or a manual `/compact` ends it; `TeammateIdle` ends only a teammate's
own. A hook sent before the wait began, or before the agent last moved on (`movedAt`: its newest
prompt, tool call, new session or helper finishing), changes nothing when it arrives late: a
`PreToolUse` of the turn does not end the wait, and a `Stop` that arrives after the prompt you
queued behind it starts none.
`attentionItems(state, now, { dismissed? }) → AttentionItem[]`, most urgent first:

```js
AttentionItem { id /* one per episode: dialog:agentKey:at:input, kind:agentKey:since, limit:since,
                      conflict:<Hazard id> */,
                kind: 'approval'|'terminal'|'question'|'plan'|'stopped'|'stuck'|'conflict'|'finished',
                level: 'blocked'|'stopped'|'alert'|'ready', sessionId, agentKey,
                agentKeys: string[] /* everyone it stands for */,
                approvalId: string|null /* a request the town holds */, since, countedSince,
                text, counted: boolean, dismissable: boolean, crews: number,
                settled: boolean /* false: a permission dialog whose request has not reached the town yet */ }
```

A permission dialog is an `approval` item while the town holds its request, else `terminal`;
its id stays the same either way. A dialog the town does not hold can be set aside once it has
waited `STALE_DIALOG_MS` (five minutes): it may be stale, as an interrupted helper sends nothing. An
agent's `stuck` is a `stuck` item of its own (level `alert`, counted, dismissable, settled; its id
carries the episode's start), also while the agent waits for you on something else. A finished turn
is listed at once and counted from `idle_prompt` (Codex: `CODEX_IDLE_MS`, a minute) for `READY_MS`
(30 minutes). Stops by one rate limit (`cause: 'rate_limit'`) within ten minutes merge into one
item for all their agents (two crews at least: a lead and its helper are one crew). A hazard
(below) is a `conflict` item of level `alert`, listed for every agent it names (`agentKeys`: the
one who did it, then the others): a `write` or `git` hazard is counted and dismissable, an `edit`
one is a note, neither counted nor dismissable. It is left out once `CONFLICT_MS` (30 minutes) old,
or when the crew or agent that did it is gone or done; others that are, are left out of it. Ended
sessions and teammates' crews are left out. `ui/needs-you.js` adds the viewer's dismissals (stops, stuck alerts, finished turns and
conflicts, kept in `localStorage["andary:dismissed"]` for a day and shared with the town's other
tabs; someone watching a team town with its view link gets no items, as they can answer nothing)
and drives the masthead button (its name: the visible words, then where a click goes), the `I`
key, the page title, the crew rows, the inspector and the desktop notifications. A note
(`isNote`: an alert that is not counted) never takes the place of what an agent does: the crew row
shows it on a line of its own under it (`[data-testid="agent-note"]`), the inspector under its Now
line. A crew row says how long: "waiting for 4m 05s", "finished 4m 05s ago", "stuck for 4m 05s",
and "4m 05s ago" for a conflict.

**Shell** (`core/shell.js`, pure, shared with the server): the one reader of Bash and
PowerShell command lines. `readShell(command, { powershell?, folder?, root?, resolve? }) →
{ segments, pipefail, truncated }` reads a string or a Codex argument list (at most
`MAX_SHELL_CHARS`, 20,000) into segments, one per simple command, each `{ text, argv, words,
program, redirects, separator, pipeline, condition, succeeded, decides, depth, folder }`: its text
as written; its words with quotes resolved, redirections and leading keywords left out; its program
behind assignments, wrappers and launchers (`programOf`); its redirections `{ op, fd, target,
body }` with here-document bodies; the separator after it (`&&`, `||`, `;`, `|`, `|&`, `&`, '');
its pipeline; what the line's exit status proves of it (pipes, `||`, `&`, conditions, `set -o
pipefail`); 1 inside a shell's `-c` script, which is read in its place one level deep; and, given a
starting folder, where it runs after `cd`, `pushd`/`popd` (`Set-Location`, `sl`, `Push-Location`,
`Pop-Location`), `env -C` and `cd "$(git rev-parse --show-toplevel)"` (with `root`), unknown
(`null`) for `~`, `$VAR`, `cd -` or past `MAX_MOVES` (64) moves. `shellCommands(command, options)
→ { words, succeeded, decides }[]` is the short form; `isTestRun(words)` and `gitAction(words)`
read a program's words, and so do `runsNoTests(words)` (a test command that lists, collects or
explains instead: `--list…`, `--collect-only`, `--no-run`, `--if-present`, go's `-run`…) and
`isBuildRun(words)` (a package's `build` or `build:…` script, `tsc`, a `build` subcommand of go,
cargo, uv, dotnet, vite, next, astro, mkdocs, gradle, docker, swift or zig, `make` with no target
but `all` or `build`, `python -m build`); `normalizedPath(path)` drops `.` and `..`. It never
throws.

**Stuck** (`core/loops.js`, pure; docs/design/agent-health.md §4). The store runs it after each
event and keeps the result on `AgentState.stuck` (and a `stuck` log line, level `warn`, when an
episode starts); the server's notifier runs the same module for its phone note (§4.10), and the
boundary check lists it among the core modules the server may import. Each side maps its events
to the module's own input: a finished call `{ agent, folder, tool, input, ok, error, at }`
(PostToolUse; PostToolUseFailure and PermissionDenied are failures; shell commands are read
through `core/shell.js`, PowerShell's in its mode; `error` is the whole error
text, `tool.fail`'s `data.errorText` in the town, or a refusal's reason; `at` is the hook's own
time, `e.ts` in the town, `hookTime` on the server) or a fresh start, `reset(agent)`, and
`resetAll(belongs)` when a session ends.

- **The same step**: a shell command read inside one level of `bash|sh|zsh -c|-lc '…'`, with
  whitespace collapsed, a leading `sleep N &&` and a trailing `2>&1`, `| tail …`, `| head …`
  dropped, and a trailing `| grep …` too after a test or build run; leading `cd <dir> &&` are
  followed, from the hook's cwd, to the folder the command runs in, which is part of the step
  (`cd packages/a && npm test` is not `cd packages/b && npm test`; a `cd` into the cwd or `.` is
  nothing); file tools by tool and path (`Read` adds offset and limit); `Grep`/`Glob` by tool,
  pattern and path; anything else by tool and its input as JSON with sorted keys; each key cut at
  300 characters.
- **A change** (progress): a successful Edit, MultiEdit, Write, NotebookEdit or `apply_patch`, or
  a successful shell command that changes files, judged by the command (`sed -i`, `perl -i`,
  `--write`/`--fix`/`-w`, formatters, scripts named for format, fix, codegen, generate or
  `build:types`, `node|python scripts/…`, git commands that rewrite the work tree or the index,
  `patch`, package installs, `rm`/`mv`/`cp`/`mkdir`/`touch`, `>`/`>>`/`tee` to a file that is not
  a log or temporary one, an inline python/node/ruby/perl/shell script that writes a file). It
  counts for the agent that made it, every agent of any crew working in the same folder, and every
  agent whose folder holds the changed file.
- **Rules**, per agent: (1) the same step failed 3 times with no change in between; (2) the
  identical step ran 5 times with no change in between, whatever its exit code; (3) the same step
  failed 6 times within 20 minutes with the same error, changes or not: its first line that says
  something (`errorSignature`: not blank, not `Exit code N`, not the command echoed back, not
  npm's, pnpm's, yarn's, make's or CI's lines about a script failing, not a banner, a passing test
  or a runner's header; times left out); a failure with no such line is left out of rule 3. A
  success of the step ends 1 and 3, a change ends 1 and 2. When several hold, the words follow 1,
  then 3, then 2.
- **Order**: hooks arrive out of order, so each agent keeps the time of the latest change that
  counted for it; a call made before it counts for rule 3 only; rule 3's window is in time order,
  20 minutes back from the latest failure.
- **A fresh start** forgets everything about the agent and ends its alert: a prompt, the turn
  ending (`Stop`, `StopFailure`, a Codex interrupt), an interrupt (`is_interrupt`: you are at the
  terminal, so it is no failure), the agent finishing (`SubagentStop`, a teammate's
  `TeammateIdle`), its session starting again (not after a compaction) or ending.
- **Steps that wait or poll by nature** are never counted, under any rule: `BashOutput`,
  `TaskOutput`, `Monitor`, `ScheduleWakeup`, `WaitForMcpServers`, `TaskList`, `TaskGet`; a `Read`
  (or a shell command) of a background task's output file (`…/tasks/<id>.output`); shell commands
  that loop with `sleep`; and shell commands (read inside `bash -lc '…'`) whose every part waits,
  besides `cd` and `echo`: `sleep`, `watch`, CI and deployment checks (`gh run watch|view|list`,
  `gh pr checks|status`, `gh pr view --json statusCheckRollup`, `gh api` on runs and checks,
  `glab ci`, `kubectl rollout status|wait`, `kubectl get pods`), health checks (`curl …/health`,
  `curl -f` or `wget` of localhost), logs and processes (`tail … *.log`, `ps`, `pgrep`, `docker
  ps`, `docker compose ps`, `lsof -i`). `sleep 5 && npm test` is the test run.
- **One alert per agent**: while any of its steps stays stuck the episode goes on (`since` kept,
  the step run most recently shown, its count updated). Memory is bounded: 200 agents (the one
  quiet the longest goes first, its alert ending with it), 64 steps each (one that has not failed
  goes first, else the one run the longest ago), 12 failures per step.

**Same files** (`core/conflicts.js` with `core/git-commands.js` and `core/paths.js`, all pure;
docs/design/agent-health.md §6). The store keeps their memory in its model, runs them after each
event and keeps what they find on `StoreState.hazards`, with a `conflict` log line (`warn`, or
`info` for an edit) when one starts. Its words name who did it with its crew's number, and the
others with theirs when of another crew (every lead is a Foreman), so every row, the inspector,
the button's "Next:" and the announcements read right: "Foreman (crew 2) wrote over src/auth.ts,
which Foreman (crew 1) changed 4 min ago" (the time counted from now), "… edited …", "…
deleted …", "Builder 1 (crew 2) runs git stash in api-server, where Foreman (crew 1) and Scout 1
have changed 5 files" (two names, or the first and "N others").

- **A file change** is a successful (`PostToolUse`) Edit, MultiEdit, NotebookEdit or Write, or a
  Codex patch: an added file is a Write, an updated one an Edit or MultiEdit, a deleted one stays
  `apply_patch` and counts as a write ("deleted"). It is remembered by its path, normalised
  (`normalizePath`: backslashes to slashes, `.` and `..` resolved, a relative path joined to the
  hook's `cwd`, a drive letter in capitals, Git Bash's `/c/…` as `C:/…` beside a folder on a drive;
  nothing else, so case and links are compared as given; a path under `~` or a variable is not
  placed), with its agent, crew, folder (the `cwd`), time, kind (edit or write) and whether it made
  the file (`created`: a Write whose `tool_response.type` is `create`, or a Codex patch adding it),
  which stays so until a commit takes it in. An agent's older change arriving late leaves its newer
  one standing.
- **Same file**: an agent changes a path another agent changed at most 30 minutes before. An Edit
  (also MultiEdit, NotebookEdit) is an `edit` hazard, a Write (or a deletion) a `write` one. One
  per pair of agents and file: the episode goes on while the agent changes it again; a new one
  replaces it when the other changes it again or an edit turns into a write. A `write` stays
  counted until it ends: an edit after it adds nothing. A change that arrives after another
  agent's strictly newer change of the file is judged the other way round (that one is over it).
- **Git hazard**: when a Bash or PowerShell call starts (`PreToolUse`, so it shows while the
  command asks for permission or runs), `gitHazardOf(command, { folder, sessionFolder, root },
  { staged, known })` reads its line for the first command that sweeps changes up (`effect:
  'sweep'`: `git add …` and a `git commit` later on the line, or a `git commit` after the agent's
  earlier adds there (`staged`), `git commit -a`, `git commit <pathspec>`) or throws them away
  (`'discard'`: `git stash` [push|save] [`--` pathspec], `git checkout .|-- <pathspec>|-f`, `git
  checkout <path>` when `known(path)` says an agent changed it or a file in it, `git switch
  --discard-changes|-f`, `git restore <pathspec>` (not `--staged` alone), `git reset --hard`,
  `git clean -f…` (not `-n`)), with what it acts on: its pathspecs made absolute (`:/x` from the
  top; exclusions left out; a glob stands for its folder; only exclusions, or more than 64
  different ones, count as none), or with none the whole work tree (`git clean`, `checkout`,
  `restore`: the folder), and which files (`files`: `tracked` for stash without `-u`, checkout,
  switch, restore, reset, `commit -a`, `add -u`, `commit <path>`; `untracked` for clean; else
  `all`). The line is read by `readShell` (**Shell**, below): a segment whose program is `git` is a
  git call, in the segment's `folder`, given the hook's folder, `root` (the top of the work tree,
  for `cd "$(git rev-parse --show-toplevel)[/more]"`) and `resolve` (`core/paths.js`: Git Bash's
  `/c/…` as `C:/…` beside a folder on a drive; `~` or a variable: unknown, and that call is not
  judged). `git -C` then moves the folder, up to 64 times a call.
- **The work tree** (`core/paths.js` `workTreeOf`): the top the server found for the hook's folder
  (`root`, from `andary_root`, §4.6) holds for any folder inside it, but a worktree Claude Code
  makes inside a repository (`…/.claude/worktrees/<name>`), which is one of its own, both ways
  (`exact: true`). Otherwise the top is guessed as that worktree, else the crew's session folder
  (where it started) when that holds the command's folder, else that folder (`exact: false`). A
  command counts another agent's change only in the same work tree and of the files it takes:
  under its pathspecs (each file matched by its own folders against them), or, with none, under
  that top, or, with a guessed top, in the folder the other agent worked in when the command runs
  inside it. One `git` hazard per command names every other agent with such changes in the last
  30 minutes. The same command in the same place by the same agent is a new hazard only for newer
  changes. The last 50 commands are kept for half an hour: a change that arrives after one that
  started later counts for it too, in its hazard or a new one.
- **Refused**: a `PermissionDenied` for the call (by `toolUseId`), or its approval denied in the
  town (by `callKey`), ends the command's hazard.
- **Committed work**: when a Bash or PowerShell call succeeds (`PostToolUse`), `gitCommitsOf`
  says what each `git commit` on it took in, and the committer's changes there are forgotten: all
  of them in that work tree for `-a` or a whole-tree add, else those under the paths it or the
  `git add` before it named, on the line or in the agent's earlier calls; with `-a`, `add -u` or a
  pathspec (`tracked`), not the files it made. `gitAddsOf` says what the line left staged, kept
  for the agent (`staged`, at most 16 for each of 200 agents) until a commit there takes it in.
- **A hand-off**: what a helper's lead changed before the helper started (its `SubagentStart`) does
  not count for the helper's file changes or its sweeping commands; a command that throws changes
  away still counts it.
- **Active** agents only: a crew leaving (`SessionEnd`) forgets its changes and ends its hazards
  (a git hazard about several goes on without it). A helper finishing ends the hazards it did, and
  leaves its changes and what it staged to its lead (`finished(helper, lead)`): the newer of two
  changes of one file stands, a file either made stays new, and hazards about them name the lead
  (one the lead did over them ends). A helper finishes with its
  `SubagentStop`, with the end of the Agent call that started it (`PostToolUseFailure`, or a
  `PostToolUse` not `async_launched`), or with its lead's interrupted `Stop`; a lead whose turn
  ended is still at work. A hazard ends 30 minutes after it started. Teammates' crews (a team
  town) are left out: their files are on their computers. Agents of different crews in one folder
  count, and so do a lead and its own helper.
- **Bounds**: 1,000 files (the one changed the longest ago goes first), 8 agents per file (the
  latest), 100 hazards (the oldest note gives way, a new note too, else the oldest alert), 50
  commands, 16 adds for each of 200 agents, 64 pathspecs a command; a command line is read up to
  20,000 characters.

**Turn receipts** (`core/receipts.js`, pure). The store runs `createReceipts().record(event, who,
{ costs: state.usage, cwd, member })` after each event and keeps its receipts on `StoreState.receipts`,
with a `receipt` log line (level `warn` when it has a `flag`, `othersEdited` or the last test failed, else `info`)
when one is made or updated.

```js
Receipt { id, sessionId, agentKey /* the lead's */, source: 'claude'|'codex', start, end,
          sawStart /* the town saw the prompt */, ended: 'done'|'error'|'interrupted', said /* last message, ≤ 200 */,
          files: { path, added, removed: number|null /* a file written whole over an old one */,
                   approx /* an edit's text was cut */, deleted, edits }[] /* newest first, ≤ 12 */, moreFiles,
          test: ReceiptRun|null, build: ReceiptRun|null, lastEditAt: number|null,
          shellEdits /* shell commands that may have changed files */,
          othersEdited: 'after-test'|'during'|null, testedAfterEdit: boolean|null /* null: no edit */, flag: string|null,
          failures, failed: string[] /* ≤ 3 */, helpers: string[], costUsd: number|null /* an estimate */ }
ReceiptRun { kind: 'test'|'build', command, at /* its PreToolUse, else its end */,
             result: 'passed'|'failed'|'unproven'|'started'|'interrupted', why: string|null,
             some /* only some tests: shell.js selectsTests */, by: string|null /* the helper that ran it */ }
```

- **A turn** of a crew starts at its lead's `prompt`; work with no turn open (the town joined midway,
  or work after a turn ended with no prompt seen) starts one with `sawStart: false`. It ends at the
  lead's `turn.stop` or `turn.fail` (`ended`: `error` for a StopFailure, `interrupted` for an
  interrupted Stop); a Stop with `stop_hook_active` ends the same turn again and updates its
  receipt, with what came since. Helpers' events count for their lead's turn; teammates' are left
  out. A session's end forgets its turn.
- **Files**: each successful Edit, MultiEdit, Write, NotebookEdit (Codex patches arrive as these) by
  its path relative to the crew's folder, with lines from the hook's own text (`changeHunks`): per
  hunk, the lines left once those both texts start and end with are set aside (`lineDelta`). A Write
  that made the file (`tool_response.type: 'create'`, or a Codex patch adding it) removed nothing; one
  over an old file, or a notebook cell, removed what the hook does not show (`removed: null`). A Codex
  patch deleting a file is `deleted`. Each is an edit for `lastEditAt` (its PostToolUse time).
- **Shell edits**: a successful Bash or PowerShell call with a command on its line that may change
  files (`core/loops.js` `changesFiles`, per command, with its here-documents: `sed -i`, a heredoc or
  `>` to a file, formatters, `--fix`, `rm`, `mv`, installs…), but not git's bookkeeping (`add`,
  `commit`, `push`, `tag`, `fetch`, `status`, `log`, `diff`, `show`), a test run or a build, counts
  in `shellEdits` and is an edit for `lastEditAt`; the town cannot say which files, so Files adds
  "files may have changed through the shell" ("no file edits seen; …" when it is the only kind).
- **Other crews**: a file tool's edit, or a shell edit (its folder), by another crew (not a
  teammate's crew in a team town) inside this turn's crew folder (normalised, `isInside`) while the
  turn is open: `othersEdited` is `after-test` when it came after the last test started, `during`
  when there was no test, and the row says "Another crew edited files in this folder after the last
  test" (or "during this turn"), naming no file.
- **Test and build runs**: a Bash or PowerShell call (finished or failed) whose line runs tests
  (`isTestRun` and not `runsNoTests`) or a build (`isBuildRun`), read by `shellCommands`, as the
  catch-up reads it: `passed` when every such command must have succeeded for the line to (a Codex
  command only with `exitKnown`, else `unproven`: "Codex did not report the exit code"); `failed`
  when the line's failure can only be one of them (`decides`; `why` is the failure's line that says
  something, `errorSignature`); `unproven` otherwise ("the exit status shown is another
  command's", "the line failed, maybe not here"); `started` for one sent to the background;
  `interrupted`. The latest of each kind, by when it started. `some` when every test command of the
  line selects tests (`selectsTests`: `-k`, `-t`, `-g`, `-m`, `--grep`, `--filter`,
  `--testNamePattern`, `--testPathPattern`, go's `-run`, or a test file or folder named): a pass
  reads "selected tests passed". A helper's run says who ran it ("npm test (by Scout 1): passed").
- **Flag**: with edits, "No test ran this turn after the edits", "Tests were not re-run since the
  last edit" (the last test started before the last edit), "The last test run after the edits
  failed", each after "Said done, but " when the turn ended normally; "The test run after the last
  edit proves nothing: …" for a result that is not `passed`. None without edits.
- **Failures**: `tool.fail` that is not an interrupt; the first three in words. **Helpers**: the
  names of the helpers with events in the turn (≤ 12).
- **Cost** (`costUsd`, Claude Code's transcripts, §4.8): the sum, over the lead and the helpers that
  worked in the turn, of their cost now less their cost when the turn started (a helper that started
  in it: 0; a lead whose session the town saw start, `startup` or `clear`, with no usage yet: 0).
  Null when that cannot be told: a turn joined midway, an agent whose earlier cost is unknown, an
  unpriced model, a Codex crew (no usage), a teammate's crew (costs stay on each computer), or
  nothing counted yet. `priced(sessionId, costs)`, run by `setUsage`, updates the receipt of the
  crew's latest turn until your next prompt starts another.
- Words (`receiptLine` for the log: "Turn receipt: 3 files changed (+40 −12), tests passed, 1
  helper, 4m 10s. Said done, but …"; `receiptRows` for the inspector's **Last turn** section of a
  lead: Took, Files, Last test, Last build, Check, Others, Failed, Helpers, and Cost as "$0.42
  (estimate)"). A turn joined midway says "at least" for its time and "since the town joined" for its
  files.

**Catch me up** (`ui/catch-up.js`, §4.13). The source asks
(`TownSource.requestDigest(since) → boolean`: live sends `{ t: 'digest', since }`; the demo answers
from its own `createDigest({ startedAt })`) and the answer comes back through the source's
`onDigest`; live's `onAway(away, offset)` also gives the server's clock minus the page's, measured
at `hello` (`serverTime`). A period starts when you last looked (the `until` of the last summary
shown, in the server's time, kept in `localStorage["andary:caught-up"]` and shared with the town's
other tabs) or when you left (`away.since`), whichever is later: the first look ever (nothing kept)
asks for `away.since` when an absence is known, and `since: 0` (everything kept) otherwise. The
period's words follow the answer: "Since you last looked, 25m ago."; "Since about 10:00 (you last
looked 3m ago)." when `from` is before `since` (every count is from `from`); "Nothing new since you
last looked, …" when no crew did anything since; "… The town only remembers since 09:12 (it
restarted)." or "… the last day." when `limit` is set, with "No crew did anything since it
restarted." under it when `limit` is `'started'` and no crew did anything (times of day on this
computer's clock, from the server's times and the offset); the first look: "Everything the town
remembers: since 09:12, when it started." (or "the last day"). The masthead's "need you" area
offers **Catch me up** while you are away and for `OFFER_MS` (30 minutes, on the server's clock)
after you came back, unless this browser has looked since you left, and keeps it while the dialog
is open if it was offered when it opened; when it goes, focus on it moves to the "need you" button,
or else the toolbar's. Screen readers hear "Welcome back…" once per absence in a browser: each tab
that hears of your return writes its claim (`<since>:<tab>`) in
`localStorage["andary:welcomed-back"]`, and only the one whose claim is still there 150 ms later
says it; a tab that finds that absence's `since` already there says nothing. `W` opens it any time.
One line per crew ("api-server: 3 turns, tests passing, 1 commit pushed, 2 files changed", then
"Last turn:" and the latest turn's words, when it said something): crews with a counted "needs you"
item first, the most urgent first, each with a button that goes to that item as the "need you"
button does; then the crews that did something, the most recently active first (one that has left
town too, named by its folder); then your other crews in one line ("Quiet: web-app and
docs-site."). Someone watching a team town with its view link is told that only the host can catch
up.

`director.js`: `createDirector({ world, store, backlog?, humor?, random?, quiet? }) → { dispose() }` (`quiet()` true: Quiet town, no quips; plain lines such as "On it: …" stay)
subscribes to the store and drives the world. `recordChanges(store) → { stop() }` keeps the
store's changes until the director starts: `main.js` starts the source, the store and the HUD
first and builds the 3D world once their first content is drawn, then passes `stop()`'s backlog
to the director, which plays it in order (crews that arrived meanwhile still come in by bus).
Without a backlog (none recorded, or more than 5,000 changes) the director places the store's
agents where they are, without ceremony. `humor.js`: `quip(situation, context, random?) → string`.

### 5.2 Implementation notes (core)

- TownEvents also carry `rx` (server receive time). Events more than 30 s old when they arrive
  (history replayed to a newly opened tab) only place agents: they teleport, with no effects or
  bubbles, so a late tab is not flooded with stale animation.
- Extra fields: `Session.endedAt`/`endReason`, `AgentState.model`, `Achievement.icon`; when the
  store corrects a subagent's label the event carries `data.relabels`.
- The store keeps at most 8 finished helpers per session and ignores hooks that arrive for an
  ended session or a finished subagent.
- Injection points for tests: `createStore({ now, localHour, onError })`,
  `createDirector({ setTimer, clearTimer })`, `createSimulation({ scheduler })`.
- An Agent call with `name` (or `team_name`) creates a teammate; unnamed helpers are numbered per
  session ("Scout 1").

## 6. World facade (`public/js/world/world.js`)

The app talks to the 3D world only through this API. Ids are agentKeys. Unknown ids are ignored
(never throw). All methods are synchronous unless they return a Promise. The town's look
(`core/looks.js`) is chosen when the page loads, from `?look=` or
the saved preference (`page.js` reads it once), and the environment builds with it;
changing it reloads the page, so the facade has no method for it.

```js
export async function createWorld(container: HTMLElement, options?: {
  quality?: 'auto'|'high'|'low', reducedMotion?: boolean, timeOfDay?: number|'auto',
  placeNames?: 'auto'|'always'|'off',
  envFactory?: (args) => Env   // testing only: inject a stub environment
}): Promise<World>

World {
  dispose(): void
  setPaused(paused: boolean): void
  setQuality(q: 'high'|'low'): void
  setTimeOfDay(h: number|'auto'): void           // hours 0–24; 'auto' follows the local clock
  getTimeOfDay(): number
  setReducedMotion(on: boolean): void
  setPlaceNames(mode: 'auto'|'always'|'off'): void // labels on the buildings (ADR 0017); also an option of createWorld

  focusAgent(id, opts?: { follow?: boolean, zoom?: number }): void  // zoom: eases there (1 = whole town)
  setLandmarks(ids: string[], opts?: { grow?: boolean }): void  // landmarks earned (§4.9); grow: rise into place
  setTownWeather(w: { kind: 'clear'|'rain'|'storm'|'fog'|'rainbow', rain, overcast, fog, rainbow /* 0–1 */, storm: boolean }): void
    // core/town-weather.js decides it from the store's events (rules in that file); the HUD's
    // driver sends it at most once a second, only when it changed, and clear when Settings turns it off
  focusBuilding(key: BuildingKey): void
  stopFollow(): void
  resetCamera(): void
  rotateCamera(dir: 1|-1): void                   // 90° steps, animated
  zoomBy(factor: number): void                     // > 1 zooms in

  setBuildingStat(key, text: string|null): void   // stat chip on the building's label, e.g. "42 reads"
  pulseBuilding(key, color?: string): void
  setBoard(items: {text: string, status: 'pending'|'in_progress'|'completed'}[], title?: string): void
  setNodeModules(level: number): void              // 0–5: size of the node_modules box pile
  addWorktree(id: string, label: string): void     // grows a labelled tree in the grove
  removeWorktree(id: string): void
  setHome(slot: 0–5, home: { name: string, color: string /* hex */, style: LookId, lights?: boolean }|null): void
    // who lives in a home of the residential quarter (§4.11); null: an empty cottage

  addAgent(spec: AgentSpec): void
  updateAgent(id, patch: Partial<AgentSpec>): void
  removeAgent(id, opts?: { exit?: 'portal'|'bus'|'poof' }): Promise<void>
  hasAgent(id): boolean
  goTo(id, key: BuildingKey, opts?: { pace?: 'walk'|'run'|'teleport' }): Promise<boolean> // false if superseded
  setActivity(id, activity: Activity): void        // see catalog.js
  setStatus(id, status: 'working'|'waiting'|'idle'|'error'|'done'): void
  say(id, text: string, opts?: { ms?: number, tone?: 'speech'|'thought'|'shout'|'code' }): void
  emote(id, emoji: string): void
  setBadge(id, text: string|null): void            // chip beside the name, e.g. "×4"
  weather(id, kind: 'rain'|'storm'|null): void     // personal cloud over an agent: the director
    // sends rain after failures, and a storm for a failed turn or while the agent seems stuck
    // (AgentState.stuck; another step succeeding meanwhile does not clear it)

  effect(kind: EffectKind, at: {agent: string}|{building: BuildingKey}, opts?: { color?: string }): void
  sendMessage(fromId: string, to: {agent: string}|{building: BuildingKey}): Promise<void>  // paper plane
  vehicle(kind: 'mailtruck'|'boat'|'bus', action?: 'arrive'|'depart'|'trip'): void

  placePerson(id, where: { tile?: [col, row], walk?: { path: [col, row][], at: number /* this browser's ms */ }|null, dim?: boolean }): void
    // a person (§4.11): follows a timed walk (core/presence.js positionAt), or stands on a tile
    // (on their porch when it is their door); dim while they are away
  setWalkMode(on: boolean): void                   // walk mode: a ground click emits 'ground', arrows/WASD on the town emit 'step'
  screenStep(right: -1|0|1, up: -1|0|1): [dc, dr]   // the grid step for a screen direction under the current camera
  on(event: 'select'|'hover', cb: (sel: {type:'agent', id}|{type:'building', key}|null) => void): () => void
  on(event: 'ground', cb: (tile: [col, row]) => void): () => void   // walk mode: the walkable tile nearest a click on the ground
  on(event: 'step', cb: (step: [dc, dr]) => void): () => void       // walk mode: an arrow or WASD key, turned onto the grid
  select(sel: {type:'agent', id}|{type:'building', key}|null): void
  getScreenPosition(id): { x: number, y: number, visible: boolean } | null
  stats(): { fps: number, agents: number, drawCalls: number }
}

AgentSpec { id, name, color /* crew hex; a person's own colour */, role: 'lead'|'subagent'|'teammate'|'person', type?: string,
            hat?: 'hardhat'|'cap'|'crown'|'beret'|'sunhat'|'wizard'|'beanie'|'none',
            person?: PersonLook /* role 'person': the look of core/profile.js, each field checked, a bad one replaced */,
            home?: 0–5 /* role 'person': stands on that home's porch */,
            spawnAt?: BuildingKey /* default hall */, entrance?: 'portal'|'bus'|'pop'|'none' }
EffectKind = 'sparks'|'smoke'|'confetti'|'fireworks'|'books'|'magnify'|'signal'|'portal'|'poof'|'steam'
           | 'check'|'cross'|'hearts'|'zzz'|'bulb'|'boxes'
```

Character models face +z at yaw 0 (yaw π faces north, toward building doors). The facade owns the
renderer, the frame loop, the DOM overlay for name pills / bubbles / emotes (`aria-hidden="true"`)
and pointer picking. The canvas container is focusable (`tabindex="0"`, `role="application"`,
`aria-label`); arrow keys pan, `+`/`-` zoom, `Q`/`E` rotate; in walk mode arrows and WASD take a
step and Shift+arrows pan.

### 6.1 Environment (`public/js/world/env/environment.js`), used only by the facade

```js
export function createEnvironment({ renderer, container, quality, reducedMotion,
  onSelectBuilding? /* (key) => void, called when a building sign is clicked */ }): Env
Env {
  scene: THREE.Scene, camera: THREE.OrthographicCamera,
  update(dt: number, elapsed: number): void        // water, vehicles, clouds, lamps, smoke, day/night
  render(): void                                   // scene through post-processing
  resize(width: number, height: number): void
  setQuality(q), setReducedMotion(on), setTimeOfDay(h|'auto'), getTimeOfDay(): number
  focus(point: {x,y,z}, opts?: { zoom?: number, follow?: () => ({x,y,z}|null) }): void
  stopFollow(), resetCamera(), rotateCamera(dir), zoomBy(f), panBy(dx, dz)
  buildings: Record<BuildingKey, { key, center: THREE.Vector3, height: number, root: THREE.Object3D, signAnchor: THREE.Vector3 }>
  anchor(key: BuildingKey, name?: string): THREE.Vector3   // named effect anchors, e.g. terminal 'chimney', web 'dish', hall 'portal', post 'garage', harbor 'pier', station 'bus'
  pickBuilding(raycaster: THREE.Raycaster): BuildingKey|null
  highlightBuilding(key: BuildingKey|null): void  // the selection: lit up, and its label shows its name
  hoverBuilding(key: BuildingKey|null): void      // under the pointer: its label shows its name
  setPlaceNames(mode: 'auto'|'always'|'off'): void
  setBuildingStat, pulseBuilding, setBoard, setNodeModules, addWorktree, removeWorktree  // as in World
  vehicle(kind, action): void
  setPedestrians(occupied: (x, z, reach) => boolean): void  // the crowd's query, from the facade:
                                                  // cars and the mail truck wait for people in their lane
  setFigures(figures: () => {x, y, feet, half}[]): void  // the crowd's screen boxes (px, last frame):
                                                  // a label with a figure in front of it fades
  setHome(slot: 0–5, home: { name: string, color: number /* sRGB hex */, style: LookId, lights: boolean }|null): void
                                                  // who lives in a home of the quarter: house style, door and
                                                  // flag colour, name plate, lit windows; null: an empty cottage
  dispose(): void
}
```

Place labels are DOM elements the environment keeps in an overlay it appends to `container`
(ADR 0017): a small dark plate on each building, inside its outline, showing the building's icon
and, when it fits at the current zoom (or the mode says so), its name and stat chip. The rules
(fit, nearer wins, figures first) live in `env/sign-layout.js`.

### 6.2 Implementation notes (world)

- `panBy(dx, dz)` is screen-relative: `dx` moves right, `dz` towards the viewer. The facade's
  arrow keys use it that way.
- `focus` zoom is relative to the framing that fits the whole town (1 = whole town, max 9).
- `buildings[key].center` is the middle of the building's volume, not a ground point.
- `anchor(key, name)` falls back to the door anchor for unknown names. Named anchors include
  `portal`, `chimney`, `dish`, `garage`, `pier`, `bus`, `forge`, `steam`, `cup`, `telescope`,
  `top` and `door`.
- The environment configures the renderer (ACES tone mapping, shadow map, pixel ratio 1 on low)
  and accepts an optional `timeOfDay`. three r187 removed `PCFSoftShadowMap`; soft shadows use
  `PCFShadowMap` with `shadow.radius`. Low quality skips the post chain and tone-maps in the shaders.
- A drag suppresses the click that follows it, and a user drag stops follow mode.
- Vehicles drive 0.5 either side of a road's centre line. At a door on a road, agents stand on
  the kerb by the building and on the centre line (`layout.workSpots`, `queueSpot`), clear of
  both lanes; cars and the mail truck stop for anyone in their lane ahead (agents crossing to a
  door, or walking along the road). The bus keeps its timetable, which the crowd's bus arrivals
  are timed to.
- `world.debugPlace(id, x, z, yaw)` exists for the lab pages only.
- The town plan (`core/town-map.js`) is 26 × 32 tiles: the original 26 × 26 town, whose centre
  stays at the world's origin, and south of the ring road a residential quarter: six 2 × 2 home
  plots (`HOMES`, doors south onto Home Street like every other door) with a garden and a mailbox
  each, and a park with a fountain, benches, a food cart with balloons, a dog, pigeons, and kites
  on clear days. Static parts are in the town batch; the homes are one mesh, the park's life three.
- Each agent is one skinned mesh (one draw call, two on high with the shadow pass); blob shadows
  are one instanced call for everyone; each effect type costs one call while active.
- A person (`role: 'person'`) is drawn from their whole look by `agents/figure-person.js`: build
  and height (0.92, 1 or 1.08 of 1.3× a helper), every top with its details (hood, collar, zip,
  lapels, buttons, bib, sash) and pattern, bottoms with seams and pockets, shoes, hair styles with
  a streak (volume hidden under hats that cover the crown), eyes, brows, mouth, cheeks, facial
  hair, glasses, earrings, hats, extras, a pet at their heel (on the body bone) or a bird on the
  shoulder, and an item in the right hand. All of it is in the geometry cache key and one skinned
  mesh: each person costs one geometry and one draw call. A house before the name on their pill.
  Helpers keep their plain figure (`figure-body.js`).

## 7. Simulation (`public/js/sim/simulation.js`)

Pure ESM, no DOM, deterministic with a seed. Used by the UI's demo mode and by
`andary simulate` (which posts the payloads to `/api/hook`).

```js
export function createSimulation({ seed?: number, speed?: number,
  emit: (payload: object /* raw hook payload */) => void | Promise<{decision?: 'allow'|'deny', updatedPermissions?: object[]} | void>
}): { start(): void, stop(): void, setSpeed(n: number): void, running: boolean }
```

`emit` receives raw hook payloads exactly as Claude Code would send them (§4.2). For
`PermissionRequest` the simulation awaits the promise and continues according to the decision
(no decision within 25 s at speed 1 → treated as allow). An allow with `updatedPermissions` saved
the request's suggested rule: like Claude Code, the project's crews do not ask for it again.

### 7.1 Implementation notes (simulation)

`stop()` pauses and `start()` resumes the same story (the HUD's pause button uses them).
`createSimulation` also accepts a `scheduler` for tests. The default seed is fixed, so the demo
tells the same story each time unless `?seed=` is given. A permission request answered without a
decision is treated as "answered in the terminal" and the story carries on as allowed.

## 8. Testing

- `npm test` runs every `test/**/*.test.mjs` with `node:test`.
- `npm run test:e2e` runs Playwright. In containers without Playwright's browser set
  `CHROME_PATH=/usr/bin/google-chrome`.
- `e2e/helpers/town.mjs`:
  `startTown({ remoteApprovals?, args?, env? }) → { baseUrl, loginUrl, port, home, secret, uiToken,
  sendHook(payload) → Promise<{code, stdout}>, stop() }` — starts a real server on a free port with
  a temporary `ANDARY_HOME`; `sendHook` runs the real `hooks/hook.mjs` with the payload on stdin.
- `ANDARY_AWAY_MS` (tests only, read by `andary start`; not a setting): how long without you
  counts as away (§4.13), a whole number of milliseconds from 100 on, so a test can start an
  absence in a second.
- `ANDARY_TUNNEL_TIMEOUT_MS` (tests only, read by `andary start`; not a setting): how long
  cloudflared may take to print its address (§4.11), a whole number of milliseconds from 100 on.
  `test/integration/tunnel.test.mjs` puts a fake `cloudflared` script first on the PATH; no test
  uses the network.
- `node scripts/shot.mjs <url> <out.png> [--wait=ms] [--size=WxH]` takes a screenshot with WebGL
  enabled, for visual checks.
- Pages: `public/index.html` (the app), `public/world-lab.html` (full world + scripted scenario;
  `?scenario=people&quality=low` is a full team town, the phone frame-budget case),
  `public/world-env-lab.html` (environment only). Every page uses the **byte-identical** import map
  from `index.html` (the server whitelists it in the CSP by hash). Each lab page loads its script
  with `<script type="module" src="…">`. `index.html` links `css/env.css`, `css/world.css` and
  `css/app.css`; each is owned by the module that renders those elements.
- Demo mode: `/?demo=1` forces the simulation even when a server is running. The app picks live
  mode when `GET ./api/hello` answers `{"app":"andary"}`; otherwise demo mode.
- The app exposes `window.__andary = { mode, store, world, hud }` for tests and debugging (it
  holds no secrets; `hud` lets a test hand the HUD what a server would, such as a `look-ask`).

### 8.1 Stable test ids (the HUD renders these; e2e suites rely on them)

| Selector | Element |
| --- | --- |
| `[data-testid="world"]` | world container |
| `[data-testid="connection-status"]` | status pill; text contains `Live`, `Demo`, `Connecting`, `Offline` or `Sign in` |
| `[data-testid="login-hint"]` | shown when a server is running but the browser has no valid token |
| `[data-testid="demo-button"]` | starts the simulation (shown when there is nothing live to watch) |
| `[data-testid="crew-list"]` | crews panel; children `[data-testid="crew"][data-session-id]`, crews at work first (most urgent first), ended crews under `[data-testid="crews-ended-toggle"]` ("Ended (n)", `aria-expanded`); `[data-testid="crew-count"]` ("n active"), `[data-testid="crew-goal"]`, `[data-testid="crew-finished"]` ("+n finished" helpers) |
| `[data-testid="palette"]` | the command palette (Ctrl-K, ⌘-K, or `[data-testid="palette-button"]`): `[data-testid="palette-input"]` (a combobox), `[data-testid="palette-results"]` with `[data-testid="palette-option"][data-id]` (`aria-selected` on the highlighted one) |
| `[data-testid="log-search"]` | the activity log's search box |
| `[data-testid="quiet-town-toggle"]` | Settings' Quiet town switch |
| `[data-testid="agent-row"][data-agent-key]` | one row per agent; contains the agent name; click selects; `data-need` is the level of what it needs you for; a lead's row holds its context in use in `[data-testid="crew-context"]` (hidden without one, §4.8); `[data-testid="agent-note"]` inside it, a note (an edit of a file another agent changed) |
| `[data-testid="agent-inspector"]` | details drawer for the selected agent; `[data-testid="inspector-dismiss"]` sets its finished turn, stop, stuck alert or conflict aside; `[data-testid="agent-context"]` holds the exact context in use (§4.8); `[data-testid="inspector-note"]`, its newest note; `[data-testid="send-note-input"]` and `[data-testid="send-note"]` send a note to the agent (§4.15), `[data-testid="send-note-why"]` says why it cannot, `[data-testid="send-note-status"]` that it is being sent or why it was refused, `[data-testid="send-note-caution"]` that delivery is not confirmed, and `[data-testid="sent-notes"]` lists its notes, `[data-testid="sent-note"][data-status]` |
| `[data-testid="waiting-for-you"]` | the masthead's "N need you" button (`data-level` is the most urgent level); click goes to the next item |
| `[data-testid="dismiss-need"]` | on an agent row: sets a finished turn, a stop, a stuck alert or a conflict aside |
| `[data-testid="catch-up-button"]` | the masthead's "Catch me up", offered after time away (`W` opens the dialog any time) |
| `[data-testid="catch-up"]` | the Catch me up dialog: `[data-testid="catch-up-period"]`, one `[data-testid="catch-up-crew"][data-session-id]` per crew (with `[data-testid="catch-up-need"]` when it needs you), `[data-testid="catch-up-quiet"]` |
| `[data-testid="activity-log"]` | log; children `[data-testid="log-entry"]` |
| `[data-testid="tasks-panel"]` | goals/tasks; children `[data-testid="task-item"]` |
| `[data-testid="approvals"]` | approvals panel; children `[data-testid="approval-card"][data-approval-id]` with buttons `[data-testid="approve"]` and `[data-testid="deny"]`, and, when a rule can be saved, `[data-testid="approve-always"]` with the rule in `[data-testid="approve-always-rule"]`; `[data-testid="deny-stop"]` ("Deny and stop") with its line, or why the agent cannot be stopped, in `[data-testid="deny-stop-note"]`; a hint in `[data-testid="approval-hint"]` |
| `[data-testid="remote-approvals-toggle"]` | checkbox/switch for remote approvals (live mode) |
| `[data-testid="settings-button"]` | opens the settings dialog (holds the remote approvals switch) |
| `[data-testid="walk-panel"]` | the Walk panel, shown in walk mode (§4.11) |
| `[data-testid="walk-to"]` | its "Walk to…" list |
| `[data-testid="walk-where"]` | its status line (a polite live region): where your character is going or is |
| `[data-testid="open-character"]` | Settings' **Your character** button, shown when this browser plays a person (§4.11; the demo's "You") |
| `[data-testid="character-dialog"]` | the "You" dialog; `[data-testid="character-random"]`, `[data-testid="character-save"]`, `[data-testid="character-status"]` (a live status line) |
| `[data-testid="usage-gauge"]` | the plan-limit gauge on the Usage button (`data-level`, `data-percent`); hidden without a reading |
| `[data-testid="limit-gauge"][data-kind]` | one plan limit in the Usage dialog; `[data-testid="limits-note"]` says why there is none |
| `[data-testid="agent-receipt"]` | in the inspector: the receipt of a lead's last turn |
| `[data-testid="director-caption"]` | the director camera's caption (plain text, not a live region); shown while it has a shot, hidden while you hold the camera or an agent is selected |

### 8.2 URL options

`?demo=1` forces demo mode; `&speed=1|2|4` and `&seed=N` control the simulation; `&world=fake`
swaps the 3D world for a recording no-op (for tests and browsers without WebGL); with it,
`&log=1` logs the stand-in world's calls to the console. The lab pages take their own options, listed at the top of their
scripts.

