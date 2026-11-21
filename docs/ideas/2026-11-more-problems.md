# More problems Andary could solve (2026-11-21)

The owner asked for more real problems that developers have with coding agents, beyond the
seven now being built (needs-you inbox, stuck alerts, context meter, limits, same-file warnings,
"while you were away", allow always). A research agent read GitHub issues on Claude Code and
Codex, Hacker News, press reports, vendor blogs and similar tools (sources at the end). This is a
backlog, ranked by pain, evidence and fit; nothing here is being built yet.

Where Andary stands: Claude Code's own Agent View and desktop app now list sessions and their
state, and Pixel Agents shows waiting bubbles for Claude Code. Andary's edge is everything around
that: safety, who spent what, git awareness, and doing it for Claude Code and Codex alike, on a
phone and for a team.

| # | Problem | What Andary could do | Size | Verdict |
|---|---------|----------------------|------|---------|
| 1 | **Destructive commands, or work outside the project** (a Codex issue among the most upvoted ever; home folders wiped; `git reset --hard` losing unpushed work) | A tripwire on every command before it runs: `rm -r`, `reset --hard`, `push --force`, `sudo`, `DROP`, paths outside the project. A red flare on the crew, a phone push, a danger log; opt-in "ask" or "deny" through the permission hook | medium | fits well; it is a tripwire, not a sandbox |
| 2 | **No undo for changes made by shell commands or helpers** (`/rewind` skips them; requests for undo with hundreds of votes) | Opt-in restore points: at each prompt and before risky commands, a snapshot of the working tree to a private git ref (the staging area untouched), shown on the crew's timeline | medium–large | fits well, opt-in; large repos and ignored files are the limits |
| 3 | **Tokens burned where nobody looks** (one task spawned 74 helpers; hidden calls and cache regressions found only by digging through transcripts) | A helper tree per crew with tokens and cost per child; alerts on bursts of helpers and on heavy spending with no file changes | medium | fits well |
| 4 | **Secrets read, printed and kept in transcripts** (`.env` read despite ignore files; most secrets in agent histories come from tool output) | Flag reads of `.env*`, keys and cloud credentials; scan tool output for key patterns. Andary already redacts what it keeps; that must hold everywhere | medium | fits well |
| 5 | **"Done" without checking** (agents report work verified that never ran) | A receipt per turn: files changed, the last test or build command and its result, and whether it ran after the last edit; "claims done, tests not re-run" on the crew | medium | fits well; it checks the process, not the code |
| 6 | **Dev servers and background processes left running** (an orphaned dev server past 8 GB; port clashes; zombie processes) | The processes and ports each crew started, listed beside it; leftovers after a session ends, with a stop button | medium | fits well; stopping the wrong process is the risk |
| 7 | **Which branch or worktree each agent is on** (one agent committing another's half-done change) | Each crew shows its branch and its unsaved changes; a warning when a crew commits while another live crew has changes in the same tree | small–medium | fits well; overlaps same-file warnings |
| 8 | **Diffs too big to review** (review is the bottleneck with parallel agents) | The diffs Andary already keeps, grouped by turn (prompt → files → lines), riskiest first, with "since you last looked" | medium | fits well; must not grow into a review tool |
| 9 | **Slow or failing tools and MCP servers** (unnamed MCP failures, hangs) | A per-crew "time sinks" view and an MCP table: calls, slowest, failures, last error | small | fits well |
| 10 | **Model or effort changing silently** (fallbacks and lowered effort) | A model and effort badge on each crew and helper, and a notice when it changes | small | fits well |
| 11 | **Hooks or permission rules quietly not working** | A doctor view: sessions seen in transcripts but not in hooks (dead hooks), hook errors | small–medium | fits well |
| 12 | **Cost per pull request or feature** | Each turn's cost tagged with its branch, added up per PR | medium | fits, later |
| 13 | **An audit trail** | A local, append-only record of commands, file writes and approvals | medium | fits later, as a personal record, not "compliance" |

Two notes for the features being built:

- Both Claude Code and Codex now answer an unanswered question by themselves after a while. The
  needs-you inbox should also list questions an agent answered for you.
- Playfulness is welcome: a request to bring back Claude Code's April Fools' companion has over a
  thousand votes.

Also considered: prompt history and reuse (later), handing a session to someone else (later, as an
export of the "while you were away" summary), a text-only view for screen readers (fits, small),
onboarding (no evidence a monitor helps).

## Suggested next batch, after the seven

1. Destructive-command tripwire (1): the highest stakes, built on the hooks Andary has.
2. Model and effort badge (10) and MCP/time-sinks table (9): small, clear value.
3. Branch and worktree awareness (7), with the same-file warnings.
4. Turn receipts, "done without checking" (5).

## Sources

- Codex issues (https://github.com/openai/codex/issues/N): 59060, 9203, 11626, 38989, 46023,
  13733, 28058, 2847, 12491, 12862, 31814, 28969, 12564.
- Claude Code issues (https://github.com/anthropics/claude-code/issues/N): 83058, 34327, 77268,
  46829, 86879, 46076, 21151, 63861, 99761, 97890, 33979, 43944, 9780, 26725, 23622, 33932, 31888,
  18127, 16837, 1935, 28986, 30726, 83510, 36793, 46808, 18547, 27040, 28240, 60591, 73125, 45596.
- Claude Code docs: https://code.claude.com/docs/en/checkpointing,
  https://code.claude.com/docs/en/hooks, https://code.claude.com/docs/en/monitoring-usage
- Docker, coding agent horror stories: https://www.docker.com/blog/coding-agent-horror-stories-the-rm-rf-incident/
- Tom's Hardware, a 700 GB home folder: https://tomshardware.com/tech-industry/artificial-intelligence/claude-nukes-a-developers-700-gb-home-directory-while-testing-a-script-to-ensure-it-wouldnt-do-so-automatic-model-downgrade-may-have-contributed-to-the-screw-up
- The Register, Claude Code and secrets files: https://www.theregister.com/2026/01/28/claude_code_ai_secrets_files/
- Backslash, secrets in agent session history: https://www.backslash.security/blog/secrets-in-ai-agent-session-history
- Simon Willison, parallel coding agents: https://simonwillison.net/2025/Oct/5/parallel-coding-agents/
- Armin Ronacher, agentic coding recommendations: https://lucumr.pocoo.org/2025/6/12/agentic-coding/
- incident.io, developer experience for coding agents: https://incident.io/blog/ai-developer-tools
- Pragmatic Engineer, incident.io's AI spend: https://blog.pragmaticengineer.com/the-pulse-details-of-incident-ios-ai-spend/
- Fortune, a database wiped by a coding agent: https://fortune.com/2025/07/23/ai-coding-tool-replit-wiped-database-called-it-a-catastrophic-failure/
- Tools: Conductor https://www.conductor.build/, Claude Squad https://github.com/smtg-ai/claude-squad,
  Pixel Agents https://github.com/pablodelucca/pixel-agents, claude-code-viewer
  https://github.com/d-kimuson/claude-code-viewer, ccusage https://github.com/ryoppippi/ccusage,
  Langfuse https://langfuse.com/resources/engineering/coding-agent-tracing
