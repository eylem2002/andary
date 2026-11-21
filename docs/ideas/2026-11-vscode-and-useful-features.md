# A VS Code extension? And what would make Andary useful, not only fun (2026-11-21)

The owner asked two questions. Should Andary live inside VS Code, given that a 3D town in a small
panel may look bad and a big panel takes room from the code? And what do developers who run
coding agents actually need, beyond a fun view? A research agent read the VS Code extension
docs, the extensions and tools that already exist, and developers' own reports (listed at the
end). This is a proposal; nothing here is built yet.

## Part 1: VS Code

### What already exists

- **Pixel Agents** is a popular VS Code extension (thousands of GitHub stars). It shows Claude
  Code sessions as pixel-art office workers in a panel beside the terminal, and has a browser
  mode. It is Claude-only so far, and it cannot answer or steer anything. One critic called it
  reassurance rather than oversight. It is the closest thing to Andary, and it already owns
  "a cute office in a panel".
- **Claude Code's own VS Code extension** has a sessions list filtered by needs input, working
  and done. It shows a dot on its tab when a permission is pending, and has a status bar entry.
- **VS Code's Agent Sessions view and Agents window** list Copilot, Copilot CLI and Codex
  sessions in one place, with changes and approvals. Claude support there is experimental.
- **Smaller extensions** give a tile or a character per terminal. Some show a waiting/working dot
  and a context-window badge.

### What VS Code allows

- **Webviews** can be an editor tab, or a view in the sidebar or the bottom panel. The UX
  guidelines call them a last resort, ask that they follow the theme, and say they should never
  open by themselves. WebGL works in practice (3D model previews use three.js), though the
  docs do not promise it.
- **The status bar** fits one item. The warning colour is for rare, urgent cases.
- **Notifications** should be rare, one at a time, with "don't show again".
- **Tree views** can carry a count badge.
- **A hidden webview** either keeps running, which costs a lot of memory, or is rebuilt when it
  comes back. A 3D town in a side panel would be rebuilt or paused most of the day.
- **Cursor and Windsurf** install from Open VSX, so an extension is published there too.

### Recommendation: a thin "Andary companion", not the town in a sidebar

The 3D town needs room to be worth looking at. A sidebar is the worst place for it, and the
cute panel already exists. What an editor lacks is one place that says which agent needs you,
and that is where Andary is ahead (Codex too, team towns, phone approvals). So:

1. **One status bar item**, for example "3 working, 1 needs you". It turns to the warning colour
   only when an agent has waited too long. Clicking it opens a quick pick of what waits.
2. **A "Crews" view** in the sidebar: a list with a state dot, how long each agent has waited,
   context used and cost, and a count badge. Allow and Deny sit inline on a waiting request.
   Clicking a changed file opens it in **VS Code's own diff editor**, which only an extension can
   do.
3. **Approval notifications** with Allow and Deny, opt-in, and for nothing else.
4. **"Open the town"** on demand, in an editor tab or the browser. Rendering pauses when it is
   hidden.

All four talk to the Andary server that already runs on 127.0.0.1; the extension draws nothing
3D. For the town itself, two places suit a developer better than the editor:

- **A floating mini town.** The browser's picture-in-picture for pages (Chrome and Edge) can keep
  a small always-on-top town in a screen corner while you work in any app.
- **A second screen or a TV.** Full screen with the director camera, as an ambient view of the
  team's agents. This is what the 3D town is best at.

JetBrains can come later; its tool windows can host the same pages.

## Part 2: features that make Andary useful

Ranked by how often developers report the problem and how cheaply Andary can solve it. "Hooks"
means the Claude Code and Codex hooks Andary already uses.

| # | Feature | The developer's problem | What it would be | Size | Needs |
|---|---------|-------------------------|------------------|------|-------|
| 1 | **"Needs you" inbox** | A missed prompt costs many minutes, plus getting back into the task | One queue across all crews: approvals, agents idle waiting for a prompt, questions, failures, finished work to review. Each shows how long it has waited and why, with jump-to and answer. Feeds the waiting button, the phone, the status bar | small | hooks |
| 2 | **Stuck and loop alerts** | Agents repeat the same failing command, sometimes hundreds of times, and burn the limit | An alert (and a storm over that crew) after N similar failures, or no file change for M minutes | small–medium | hooks |
| 3 | **Context meter** | Compaction arrives mid-task without warning | A ring per crew showing context used, a warning at 70–80%, compactions marked on the timeline | small | statusline script + hooks |
| 4 | **Limit gauge and budgets** | Usage limits run out unexpectedly; background helpers burn the quota | 5-hour and weekly bars with a predicted run-out time, cost per crew and per task, alerts at a threshold | medium | statusline script or OTel |
| 5 | **Same-file warnings** | Two agents edit the same file, or share a working tree and commit each other's work | The two crews flash and a warning names the file | small | hooks + git |
| 6 | **"While you were away"** | Coming back to five sessions and not knowing what happened | Per crew: what changed, what is blocked, what is uncommitted, the last test result | medium | hooks + git |
| 7 | **Allow-rule suggestions** | Approval fatigue: almost every prompt is allowed anyway | "You allowed `npm test` 14 times: add an allow rule?" It writes the rule only when you confirm | small–medium | hooks + settings |
| 8 | **Timeline and replay** | Understanding what ran, in what order, and why | A scrubbable history per crew, linked to diffs and failing commands | medium | hooks (transcripts for full text) |
| 9 | **Review queue** | Review is the bottleneck when agents work in parallel | A card per branch: diff size, tests, PR and CI state, time waiting for review | medium | git + gh |
| 10 | **"Said done, tests red"** | Agents report success when tests fail | A flag on the crew when the last test run failed | small | hooks |
| 11 | **Status for terminals** | Many people watch a tmux status line | `andary status --json` and a short line for tmux or a shell prompt | small | — |
| 12 | **Webhooks** | Phone pings are not enough for some teams | Slack, Discord or any URL, for the inbox and alerts | small | — |
| 13 | **OpenTelemetry in** | Andary's costs are estimates | Read Claude Code's and Codex's own OTel metrics when the user turns them on | medium | user's OTel config |

Several of these are the GTA ideas in work clothes. The "needs you" inbox is the wanted level.
Stuck alerts are random-event blips. The timeline is the replay editor. The review queue is
"mission passed". So the two lists point the same way.

## Suggested order

1. The **inbox** (1) and **stuck alerts** (2). The waiting button just shipped (PR #35) and is
   the start of the inbox.
2. The **context meter** (3) and **same-file warnings** (5).
3. The **VS Code companion**: status bar item, Crews view, approvals, diffs in the editor.
4. **"While you were away"** (6) and **allow-rule suggestions** (7).
5. The **limit gauge** (4), the **timeline** (8) and the **review queue** (9).

## Sources

- Pixel Agents: https://github.com/pablodelucca/pixel-agents
- A critical take on Pixel Agents: https://ucstrategies.com/news/this-viral-ai-tool-does-nothing-but-developers-cant-stop-watching-it/
- Claude Code in VS Code: https://code.claude.com/docs/en/vs-code
- Claude Code agent view: https://code.claude.com/docs/en/agent-view
- Claude Code hooks: https://code.claude.com/docs/en/hooks
- Claude Code status line: https://code.claude.com/docs/en/statusline
- Claude Code monitoring (OpenTelemetry): https://code.claude.com/docs/en/monitoring-usage
- VS Code 1.106 release notes: https://code.visualstudio.com/updates/v1_106
- VS Code Agents window: https://code.visualstudio.com/docs/copilot/agents/agents-window
- VS Code webview API: https://code.visualstudio.com/api/extension-guides/webview
- VS Code UX guidelines: webviews https://code.visualstudio.com/api/ux-guidelines/webviews, status bar https://code.visualstudio.com/api/ux-guidelines/status-bar, sidebars https://code.visualstudio.com/api/ux-guidelines/sidebars, notifications https://code.visualstudio.com/api/ux-guidelines/notifications, views https://code.visualstudio.com/api/ux-guidelines/views
- Cursor moves to Open VSX: https://forum.cursor.com/t/extension-marketplace-changes-transition-to-openvsx/109138
- JetBrains embedded browser: https://plugins.jetbrains.com/docs/intellij/embedded-browser-jcef.html
- Document Picture-in-Picture: https://developer.chrome.com/docs/web-platform/document-picture-in-picture
- Product Hunt discussions on waiting agents and parallel sessions: https://www.producthunt.com/p/vibecoding/your-ai-agent-is-waiting-for-you-your-attention-isn-t-how-much-time-do-you-lose-to-this and https://www.producthunt.com/p/vibecoding/running-3-4-claude-code-codex-sessions-at-once-what-breaks-first-for-you
- Josh Morony on attention across agents: https://www.joshmorony.com/effectively-manage-attention-across-multiple-coding-agents/
- Simon Willison on parallel agents: https://simonwillison.net/2025/oct/5/parallel-coding-agents/
- Merge debt with parallel agents: https://heyvaldemar.com/merge-debt-2026-parallel-ai-agents/
- Claude Code issues on loops, limits and compaction: https://github.com/anthropics/claude-code/issues/38405, https://github.com/anthropics/claude-code/issues/63863, https://github.com/anthropics/claude-code/issues/93911, https://github.com/anthropics/claude-code/issues/65290
- Anthropic on approval fatigue (auto mode): https://anthropic.com/engineering/claude-code-auto-mode
- ccusage: https://github.com/ryoppippi/ccusage
- claude-code-viewer: https://github.com/d-kimuson/claude-code-viewer
