# Design: what needs you, and how your agents are doing (2026-11-21)

Status: **decided**, after an independent review (§10). This is the spec the pull requests follow.

The owner asked for seven things, from developers' own reports of running coding agents
(`docs/ideas/2026-11-vscode-and-useful-features.md`):

| # | Problem | Feature | Verdict after review |
|---|---------|---------|----------------------|
| 1 | Missing the moment an agent is waiting for you | **Needs you** | do, changed |
| 2 | Agents stuck repeating the same failing step | **Stuck** alerts | do, changed |
| 3 | Running out of context window | **Context** in tokens | do, much smaller |
| 4 | Hitting usage limits by surprise | **Limits** gauge, status-line bridge | do last, opt-in |
| 5 | Two agents editing the same file | **Same file** and git hazards | do, changed |
| 6 | Coming back and not knowing what happened | **Catch me up** | do, changed |
| 7 | Approving the same command again and again | **Allow always** | do, changed |

## 1. How people use Andary (what every feature is judged against)

- **Background tab** next to the editor: the developer looks when something pulls them there.
- **Second screen**: the town is "visible" all day, even when nobody looks at it.
- **Away from the desk**: phone notifications (ntfy, opt-in), which never name a project, file or
  command.
- **Coming back** after a meeting to three to six crews that went on without them.
- **Interactive use of one session** in the terminal: Andary must stay quiet about turns you are
  reading there.
- **Five or more sessions** at once: the case Andary is for.
- **Team town**: teammates' crews are not yours to answer; a view-only viewer can do nothing.

Claude Code itself now has some of this: the agent view lists background sessions, Remote
Control pushes "action required" to a phone, it warns at 85% of a usage limit, and `/context`
shows the context. Andary's place is **across sessions and tools** (terminal sessions, Codex, a
team), **in the browser and on a phone**, and it must not repeat a notice Claude Code just gave.

Principles:

1. **One attention model** for everything that needs you: one count, one set of rules for the
   desktop and the phone.
2. **Quiet by default**: specific, actionable signals only; anything counted can be dismissed and
   stays dismissed until the situation changes.
3. **In the town too** where a signal has a natural place there (a storm over a stuck agent).
4. **Nothing changes Claude Code's behaviour or settings without a visible, explicit choice.**
5. **Pure rules, tested**: detectors are pure modules in `public/js/core/` (no DOM, no I/O). One
   the server needs for a phone note is self-contained, so the server may use it.

## 2. First: two approval bugs and the phone (a small pull request of its own)

- **A held request that times out** (or is released) leaves the agent waiting at the terminal, but
  it drops out of every count. The count must follow the agent's wait, not the approval's status.
- **Plan approvals** (`ExitPlanMode`) raise a PermissionRequest that a plain allow cannot answer,
  yet the town holds it and shows Allow. Never hold them; the card says "answer in your terminal".
- **Hold only what the card shows** (CONTRACTS §4.5): every field of the input, as it is. One list,
  `core/card-fields.js`, says per tool what its card shows, so a field it leaves out (Bash's
  `dangerouslyDisableSandbox: true`) sends the request to the terminal, as a redacted or shortened
  input does; so does a request from a forwarder too old to say it marks a body it shortened. The
  card shows every space but the plain one and every character that draws nothing as a marker,
  and collapses lines that show nothing, so no padding hides the end of a command. A Codex
  command's card says that allowing may let it leave its sandbox: its request cannot say.
- **Phone notes follow the attention rules** (CONTRACTS §4.10), on one model of open dialogs
  (`core/dialogs.js`) that the approval broker and the town's "needs you" (§3) follow too, at each
  hook's own time (a permission request can arrive before its PreToolUse, a notice before the call
  started ahead of it):
  - no note for every finished turn: Claude Code's `idle_prompt`, 60 s later, covers an unanswered
    one. Codex has no `idle_prompt`, so the server waits the same 60 s after a Codex lead's turn,
    once per turn; Codex names no helper on its tool calls, so a tool running pauses the minute
    and only your prompt ends the wait;
  - a dialog per call (a permission request, a question, a plan, an MCP server's form): its note
    waits 10 seconds and is dropped only on proof of an answer: that call reporting back, your
    prompt (every dialog of the session but one the town holds), the agent's turn ending, a
    decision in the town, or a question or plan the agent asks again. A request that timed out or
    went back to the terminal still gets its note: the agent waits there. A yes in the terminal is
    seen only when the tool finishes and a "No" only at the next prompt, so those can still send
    one;
  - notes due together become one ("2 crews need your permission"; questions and plans have words
    of their own), and one held back by the 30 s limit goes out when the limit allows.

## 3. Needs you

**Model.** `public/js/core/attention.js` (pure): `attentionItems(state, now, dismissed)`.

```js
AttentionItem {
  id: string            // kind + agent + start time: a new episode is a new item
  kind: 'approval' | 'terminal' | 'question' | 'plan' | 'stopped' | 'stuck' | 'same-file' | 'finished'
  level: 'blocked' | 'stopped' | 'alert' | 'ready'
  sessionId: string, agentKey: string
  since: number, text: string, counted: boolean
}
```

| Level | Kinds | Counted |
|-------|-------|---------|
| blocked | approval (the town can answer), terminal (the terminal asks: not held, expired or released), question (`AskUserQuestion`, `agent_needs_input`, elicitation), plan (`ExitPlanMode`) | always |
| stopped | the turn ended in an error; several crews stopped by one rate limit are **one** item ("paused until 15:40, 6 crews") | always |
| alert | stuck; same file when a Write lands on another active agent's change | until dismissed |
| ready | a lead finished its turn and has had no prompt since | after Claude Code's `idle_prompt` (Codex: a minute with no prompt), for 30 minutes; never for agent-team teammates |

The store keeps the open dialogs (requests, questions, plans) in the model the phone shares
(`core/dialogs.js`, §2): one per call, closed only on proof of an answer, so parallel calls, a
helper's request held while you type to the lead, and a reconnect's replay never lose an agent
that waits. `AgentState.wait = { kind, since, text, idleAt, cause } | null` holds the rest
(finished, stopped); `attentionItems` only reads. Both go by each hook's own time (the event's
`ts`), as the phone and the broker do: a plan's request that overtook its PreToolUse stays one
item, and a hook sent before a wait began, arriving late, does not end it. Teammates' crews are left
out; a view-only viewer gets no attention items.

**HUD, first version (simpler than a new panel):**

- The **Crews panel** shows, on each agent waiting for you, how long and why ("waiting 4 min:
  asks to run `rm -rf dist`"), coloured by level.
- The masthead button (the "approvals waiting for you" button of PR #35) becomes **"3 need you"**,
  yellow when something is blocked. A click **goes to the most urgent** (approval cards open in
  Approvals; everything else selects the agent and points the camera); the next click goes to the
  next one. `I` does the same.
- The tab title is "(3) Andary".
- Dismiss (alerts, stops and finished turns; a dialog the town does not hold once it has waited
  five minutes, as it may be stale) is on the agent's row and in the inspector;
  dismissals are kept in local storage.
- **Desktop notifications** (opt-in) follow the model: one per new counted item, never for
  replayed history, and no "finished" notice while only one local crew is active (you are
  probably at its terminal).

**Decision:** do. Size: medium.

## 4. Stuck alerts

`public/js/core/loops.js` (pure, self-contained, also run by the server for the phone).

**Step key** per tool call: the shell command with whitespace collapsed, a leading `cd <dir> &&`
and a trailing `2>&1`, `| tail …`, `| head …`, `| grep …` dropped; file tools by tool and path
(Read adds offset and limit); searches by tool, pattern and path; anything else by tool and its
input, stable-stringified and clipped.

**A change** (progress) is a successful Edit, MultiEdit, Write, NotebookEdit or patch by **any
agent working in the same folder** (helpers share the tree), or a successful shell command that
edits files in place (`sed -i`, `perl -i`, formatters with `--write`/`--fix`, `git checkout`,
`git apply`, `git stash`, `git reset`).

**Rules**, per agent:

1. **Same failure, nothing changed**: the same step failed 3 times with no change in between.
2. **Same step, nothing changed**: the identical step ran 5 times with no change in between,
   whatever its exit code (`npm test 2>&1 | tail -40` exits with tail's status, so failures can hide).
3. **Keeps failing the same way**: the same step failed 6 times within 20 minutes with the same
   first error line, changes or not.

A failure is `PostToolUseFailure` or `PermissionDenied`. The alert ends when the step succeeds
(rules 1, 3), a change happens (1, 2), the turn ends, you send a prompt, or the agent finishes.

**Where it shows:** an alert item, a storm over the agent in the town, a log line, and a phone note
("A crew seems stuck: the same step keeps failing").

**Decision:** do. Size: small–medium.

## 5. Context, in tokens

The server already reads each assistant message's usage; the context in use is that message's
`input + cache_creation + cache_read` tokens (the formula Claude Code's status line uses). The
usage tracker keeps the newest per agent: `UsageRecord.context = { tokens, at }`.

**No percentage from the estimate, and no alert:** today's default models run a 1M window with no
`[1m]` in the model id, the compaction point can be set by the user, and `/context` exists. So the
Crews panel shows "182k in context" beside the model, the inspector the exact count and when it
was read, and a compaction resets it. A percentage appears only with exact data from the status
line (§9).

**Decision:** do, small.

## 6. Same file, and git hazards

Edit is already safe against a stale file: it must match the current content, and Claude is told
when a file changed under it. The real losses come from **Write** over a file another agent
changed, and from **git commands in a folder another agent is working in** (`git add -A` with a
commit, `git stash`, `git checkout .`, `git reset --hard`).

`public/js/core/conflicts.js` (pure):

- Every successful file change records its absolute path (normalised), agent, folder and time.
- **Same file**: agent A changes a path that agent B changed in the last 30 minutes while both are
  active. An Edit makes it an uncounted note (visible on both rows); a **Write** over B's change is
  a counted alert. It ends when either agent finishes or after 30 minutes.
- **Git hazard**: one of those git commands runs in a folder where another active agent has
  changed files in the last 30 minutes: a counted alert naming both.

Paths are compared as given, normalised (separators, `.` and `..`); the browser cannot resolve
symbolic links or know whether a disk ignores case, so those can be missed (written down).

**Decision:** do. Size: small–medium.

## 7. Catch me up

**When you were away** is decided by the server, which sees every prompt and every answer you
give: away means no prompt and no decision from you in any local session for 20 minutes or more
while crews kept working.

**What**: `server/digest.mjs` keeps per-crew counters in five-minute buckets for the last 24 hours
(turns finished with the last message, failures and stops, approvals asked and answered, files
changed, the last test result, commits and pushes, helpers started and finished), so a summary for
any period survives a page reload and does not depend on the history the server keeps for late
tabs. The browser asks `{ t: 'digest', since }` and shows it.

**Where**: when you come back (your first prompt or decision after an absence, or opening the town
after one), the inbox button offers "Catch me up"; `W` opens it any time, for the period since you
last looked. One line per quiet crew; crews that need you first.

**Decision:** do, after the others that feed it. Size: medium.

## 8. Allow always

`PermissionRequest` carries `permission_suggestions`, the permission updates Claude Code proposes;
a hook's decision may echo one as `updatedPermissions`. This is not always the same as the
terminal's options (the file-edit dialog ignores the list, and a managed setting can hide saving
rules while the suggestion stays), so the card is worded honestly.

- The card offers **Allow always** for an `addRules` + `allow` suggestion whose destination is
  `localSettings` (this project, only you) or `session` (until the session ends); never
  `projectSettings` (committed, changes your teammates' prompts) or `userSettings`, never
  `setMode` or directories. It shows the literal rule (`Bash(npm test:*)`) and where it is saved.
- The browser sends `decide { decision: 'allow', always: <index> }`; the server adds that one
  suggestion from the original request as `updatedPermissions`.
- **The forwarder passes it on only if it equals one suggestion in its own input** (compared without
  regard to key order), and only one; anything else becomes a plain allow.
- Not offered when sanitising changed the suggestion, on plan approvals, or for Codex (it sends no
  suggestions).
- If the same request comes back after an "allow always", its card says so: the rule did not take
  (a managed setting may forbid saved rules).
- A count on the card ("allowed 4 times today") when it would help.

**Decision:** do. Size: small–medium.

## 9. Limits gauge and the status-line bridge (last)

The 5-hour and weekly limits reach exactly one place: the status line command's input
(`rate_limits.five_hour`, `.seven_day`, and `spend_limit` behind a gateway), for Pro and Max, after
the first response. Before building the bridge, check whether Claude Code's newer extension points
can read them without taking over the user's status line.

If the bridge is still the way: `andary install --statusline` points `statusLine` at the forwarder
in a status mode. It sends numbers only (limits, exact context, session id, model), never waits on
the server, and runs **the previous status line command from the same settings file** with the
same input (only that one, never a project's; killed when Claude Code cancels it; quoted correctly
on Windows); with no server it only runs that command. Uninstall restores it. `andary doctor`
warns when a project's own `statusLine` overrides the bridge. The cost: Claude Code hides some
footer hints when any status line is set.

Shown as a gauge on the Usage button and in the usage dialog, with "as of" and the reset time, a
projection when the pace runs out before the reset, and an optional phone note at 90%. Not counted
in "needs you": Claude Code already warns at 85%.

**Decision:** do last, opt-in, after the check. Size: medium.

## 10. Review outcome

An independent reviewer, who had not seen the proposal, studied it against the code and the docs.
What it changed:

- **Wrong facts in the proposal:** a 200k context window is not the default any more (today's
  models run 1M with no `[1m]`); `permission_suggestions` is not an exact copy of the terminal's
  options; `idle_prompt` fires 60 s after a turn even while you read it (so "ready" notices are
  held back when you are probably at the terminal).
- **Bugs found:** the count lost requests that went back to the terminal; plan approvals were held
  with an Allow that cannot answer them.
- **Simpler where possible:** status on the crew rows and a button that jumps to the most urgent,
  instead of a new panel; context as tokens instead of a guessed percentage; no counted alerts at
  90% of context or limits.
- **Sharper rules:** a stuck rule that ignores exit codes, changes by any agent in the folder,
  the same error text for the "keeps failing" rule; same-file alerts counted only for a Write, plus
  git hazards; "away" decided by your own prompts and answers, with counters on the server.
- **Allow always:** local destinations only, the literal rule shown, one suggestion compared
  without key order.

## 11. Order of work

0. Approval bugs and the phone (§2).
1. Needs you (§3).
2. Stuck alerts (§4).
3. Allow always (§8), in parallel with 2.
4. Context in tokens (§5).
5. Same file and git hazards (§6).
6. Catch me up (§7).
7. The limits gauge (§9), after the check.

Each is its own branch and pull request, with tests, docs (CONTRACTS, ASSUMPTIONS, README) and a
review by someone who has not seen the work.
