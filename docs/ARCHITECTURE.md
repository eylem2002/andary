# Architecture

How Andary is put together, and why. The exact interfaces (payloads, messages, APIs) are in
[CONTRACTS.md](CONTRACTS.md); the decisions behind them are in [adr/](adr/README.md).

## The system in one picture

```
 Your computer
 ┌──────────────────────────────────────────────────────────────────────────────────────────┐
 │                                                                                          │
 │  Claude Code ──┐  hook (JSON on stdin)                                                   │
 │                ├──▶ hooks/hook.mjs ──POST /api/hook──▶ ┌───────────── server/ ──────────┐ │
 │  Codex ────────┘    (one forwarder;    (secret +       │ routes  → authenticate, parse   │ │
 │                      `codex` argument)  signed reply)  │ adapters→ one event contract    │ │
 │                                                        │ ingest  → policy per origin:    │ │
 │  A teammate's Andary ──POST /api/team (member key)───▶ │   usage, growth, notifications, │ │
 │                                                        │   approvals, team relay         │ │
 │                                                        │ record  → sanitize, history,    │ │
 │                                                        │   recording, broadcast          │ │
 │                                                        └──────────────┬──────────────────┘ │
 │                                                       WebSocket /ws   │  (token sign-in)  │
 │                                                                       ▼                   │
 │  Browser ┌──────────── sources/ ─────────────┐   ┌──────── core/ (pure) ──────────────┐   │
 │          │ live.js (WebSocket)  or  demo.js  │──▶│ events: payload → TownEvents       │   │
 │          │ (the built-in simulation)         │   │ store: crews, agents, log, usage   │   │
 │          └───────────────────────────────────┘   │ director: choreography             │   │
 │                                                  └─────┬───────────────────┬──────────┘   │
 │                                                        ▼                   ▼              │
 │                                       ui/ (the HUD, reads the store)   world/world.js     │
 │                                                                        (3D facade)        │
 │                                                                        ├ env/ (the town)  │
 │                                                                        └ agents/ (people) │
 └──────────────────────────────────────────────────────────────────────────────────────────┘
```

Everything runs on your machine. The server listens on `127.0.0.1` unless you host a team town,
has no runtime dependencies, and keeps none of your prompts or commands on disk unless you ask it
to record.

## The design, part by part

**One event contract.** Every event in the town has the shape of a Claude Code hook payload
(CONTRACTS §4.2). Sources that speak differently are translated once, at the edge
(`server/adapters/`): Codex's `apply_patch` becomes one edit per file, `spawn_agent` an Agent call,
and so on. Everything after that (history, recordings, replay, the team relay, the demo, the
browser) reads one format. A new agent is one new adapter (ADR 0013).

**One ingest pipeline.** `server/ingest.mjs` is the only way an event enters the town. Routes
only authenticate and parse. What an event does besides appearing in the town is decided by where
it came from, in one table (`POLICIES`): a local event counts toward growth, notifications and
approvals and is relayed to a team host; a teammate's event grows the town and nothing else.
Token usage is read before the adapter, and only for Claude Code (its transcripts).

**Security at every boundary.** The forwarder only talks to a live server of yours that proves it
holds a key that never leaves `~/.andary`, and only obeys replies signed with it (ADR 0012). The server checks the `Host`
header (DNS rebinding) and the WebSocket `Origin`, signs browsers in with a per-start token the
page keeps for its own origin (ADR 0015; no cookie, which every port would see), sanitizes every
payload (secrets redacted, sizes capped) before anything is kept or sent, and never holds a
permission request it cannot show in full. A team town adds keys that are HMACs of one secret and a
view-only role that sees the town but cannot act.

**The browser has one store and one source.** `sources/live.js` (the WebSocket link) and
`sources/demo.js` (the simulation, which also plays the server's part for approvals, usage and
growth) share one `TownSource` shape; `main.js` holds exactly one. Both feed `core/store.js`,
the single source of truth: the HUD renders it, and the director turns its changes into
choreography for the 3D world. The store and the HUD start first, so the crews show while the 3D
world is still being built; the director then plays the changes it missed (CONTRACTS §5.1).

**Pure core.** `public/js/core/` has no DOM and no I/O, so it runs anywhere and is unit-tested in
Node. What the page was opened with (the town look, from the address or saved preferences) is read
once, in `page.js`, and the HUD and the town's environment take it from there. The server reuses the few core modules both sides must read the same way: identifiers,
dates, text helpers, prices, the growth rules, and when an agent is waiting for you (open dialogs).

**The world behind a facade.** The app talks to the 3D world only through `world/world.js`
(CONTRACTS §6). Inside it, the town (`env/`) and the people (`agents/`) never import each other;
the facade joins them. A fake world (`?world=fake`) records the calls for tests and HUD work.

## Layer rules

`npm run boundaries` (part of every check) enforces them; runtime imports only, JSDoc type
references may cross.

| Area | May import |
| --- | --- |
| `hooks/` | Node built-ins only (it is copied out and must stand alone) |
| `server/` | `server/`, and only the pure core modules `prices`, `growth`, `ids`, `dates`, `text`, `dialogs` |
| `server/cli/`, `cli/` | the server, those core modules, the simulation (for `andary simulate`) |
| `public/js/core/` | `core/` only |
| `public/js/sources/` | `sources/`, `core/` |
| `public/js/page.js` | `core/` only |
| `public/js/ui/` | `ui/`, `page.js`, `core/` (the world only as a JSDoc type) |
| `public/js/sim/` | `sim/` only |
| `public/js/world/world.js` | `agents/`, `env/environment.js`, `layout.js`, `core/`, three.js |
| `public/js/world/env/` | `env/`, `layout.js`, `page.js`, `core/`, three.js |
| `public/js/world/agents/` | `agents/`, `layout.js`, `core/`, three.js |
| `public/js/main.js` | anything in the app: it wires the parts together |

## Where to find things

| You want to change… | Look in |
| --- | --- |
| which agents can connect, and their hooks files | `server/clients.mjs`, `server/installer.mjs` |
| how another agent's events are translated | `server/adapters/` |
| what happens to an event on the server | `server/ingest.mjs` |
| who may connect, and what they may do | `server/auth.mjs`, `server/browsers.mjs`, `server/security.mjs` |
| the team town | `server/team.mjs`, `ingestTeam` in `server/ingest.mjs` |
| how a hook becomes town events | `public/js/core/events.js`, `summaries.js` |
| crews, agents, the log | `public/js/core/store.js`, `crews.js` |
| who walks where, and what they say | `public/js/core/director.js`, `director-queue.js`, `humor.js` |
| the HUD | `public/js/ui/` (`hud.js` composes it) |
| the town's buildings, sea, sky and looks | `public/js/world/env/`, `core/looks.js`, `page.js` |
| the people and their animations | `public/js/world/agents/` |
| the demo's story | `public/js/sim/` |

## Conventions

- Plain ES modules, no build step (ADR 0002); JavaScript with JSDoc types checked by `tsc`
  (ADR 0009).
- `create*()` factories returning plain objects for most modules; classes in the 3D world for the
  things it has many of. Anything that owns timers, listeners or GPU memory has `dispose()`.
- Every file starts with a comment saying what it is for and why it is shaped that way.
- Tests mirror the source tree (`test/unit/world/env/` tests `public/js/world/env/`).
- Limits: shared ones in `server/config.mjs` (`LIMITS`), single-use ones as named constants at the
  top of their module.
