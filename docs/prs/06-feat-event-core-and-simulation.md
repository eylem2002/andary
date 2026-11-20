# Hook normalisation, store, director, humour and simulation

Part 6 of 11 · base: `feat/agents-and-world`

## What changed

The brain between the hooks and the town: what happened, who did it, and what the town should
show. Pure modules without DOM access, so they run in Node tests and in the CLI.

- **`events.js`** turns every documented Claude Code hook payload into town events and derives
  more from tool calls: todo lists, team tasks, subagent spawns and results, messages between
  agents. Tool summaries are short and human ("Read src/auth/login.ts", "$ npm test",
  `grep "TODO" in src`). Never throws on odd input.
- **`store.js`** keeps crews (sessions), agents, tasks and todos, approvals, the activity log,
  stats and achievements, with hard caps on everything. Attribution follows the `agent_id`
  field; subagents get their labels from the matching spawn, teammates their own names.
- **`director.js`** choreographs the world: the bus brings new sessions, agents walk to the right
  building and animate, failing tests bring a rain cloud, rate limits a storm, passing tests
  fireworks, `git push` sends the mail truck, compaction sends agents to the spa. A per-agent
  queue makes agents run, then teleport, when tool calls arrive faster than they can walk;
  history replayed to a newly opened tab only places agents, without effects.
- **`humor.js`**: 86 situations of developer humour filled with real details (file, command,
  host, model), mixed about 60/40 with plain status lines, never repeating recent lines.
- **Achievements**: First Contact, Delegator, Swarm, Red to Green, Bookworm, Night Shift,
  node_modules Black Hole, Rubber Stamp, Memory Lane, Ship It, Clean Sweep, Polyglot, Teamwork.
- **Simulation** (`public/js/sim`, ADR 0008): a seeded story of three projects (fixing a flaky
  login test with parallel Explore subagents; an agent team building a settings page with
  tasks and messages; a docs site with web research, MCP, skills, compaction, a model switch, a
  rate limit and a permission request), then endless procedurally generated work. It powers the
  demo and `andary simulate`, and emits payloads shaped exactly like Claude Code's.

## Tests and results

| Suite | Result |
| --- | --- |
| events (every hook type, odd inputs, summaries) | 91 pass |
| store (attribution with parallel subagents and teammates, transitions, caps, achievements) | 41 pass |
| director (choreography per event, lag control, bounded queues, bubble throttling) | 37 pass |
| simulation (determinism by seed, payload shapes, allow and deny, no leftover timers) | 24 pass |
| humour, random/clock, achievements | 21 pass |
| Lint, typecheck | pass |

## Assumptions

- An Agent call with a `name` is a teammate; unnamed helpers are numbered per session ("Scout 1").
- "Rubber Stamp" counts approvals in the town and in the terminal; "Polyglot" counts model families.
- The demo uses a fixed seed, so it tells the same story each time (`?seed=` changes it).

## Open items

- Split-pane teammates run as separate processes with their own session id, so they appear as
  their own crew.
- Two helpers of the same type started at the same moment can swap labels briefly, until their
  results name them.
- Humour is English only.
