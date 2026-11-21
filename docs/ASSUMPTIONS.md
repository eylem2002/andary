# Assumptions

The owner asked for autonomous work: every assumption made without asking is recorded here with
its reason, so it can be reviewed and reversed. Newest entries are added at the bottom of each
section.

## Product

1. **What to build.** The request was "build something like this" with a screenshot of agents
   working in an isometric town, connectable to Claude Code. Andary is a local web app that
   visualises real Claude Code sessions, subagents and agent-team teammates as characters in a 3D
   town, fed by Claude Code hooks, plus a built-in simulation for when no Claude session is running.
2. **Name.** The working title was "Token Town"; the product is named Andary after the owner's
   repository (see 18). The name lives in `package.json`, the CLI and the page title.
3. **Look.** A limestone hill town with golden domes and rooftop water tanks, inspired by the
   reference screenshot and by Amman (the owner's timezone is Asia/Amman). Tilt-shift "miniature
   diorama" rendering for a realistic toy-town feel.
4. **"Align with each Claude".** Read as: every Claude Code session on the machine (each terminal,
   each subagent, each teammate) must appear in the town. Hooks are installed in the *user*
   settings file by default so this works for every project without per-project setup.
5. **Approvals from the town are off by default.** Holding a permission prompt until someone clicks
   in a browser changes how Claude Code behaves, so it is opt-in (toggle in the UI or
   `--remote-approvals`). With it off, the town still shows approval cards, read-only.
6. **No recording by default.** Hook payloads contain prompts, commands and file paths (personal
   data). Nothing is written to disk unless `--record` is passed.
7. **Fonts and three.js are vendored**, so the app works offline and makes no third-party requests
   (privacy, and a strict CSP).

## Engineering

8. **No database.** The app keeps state in memory only. The database requirements in the brief
   (prepared statements, pooling, transactions) do not apply; this is recorded as an ADR.
9. **"User roles".** Andary is a single-user local tool. The roles that exist are: the owner in
   a browser (authenticated with the per-start UI token), Claude Code hooks (authenticated with
   the hook secret), a visitor with no token (sees only the login hint and the demo), and a
   visitor of the hosted demo (no server at all). Each is tested.
10. **"Each user sees only their own data"** maps to: the server binds to 127.0.0.1, checks the
    Host and Origin headers, requires a random token for the browser and a separate secret for
    hooks, and stores both in a file only the owner can read (mode 0600).
11. **Typecheck** uses TypeScript's `checkJs` over the JavaScript sources (non-strict mode), so the
    project keeps its no-build-step design while still getting a typecheck gate.
12. **Node versions.** Runtime needs Node ≥ 20 (built-ins only). The test tooling uses Node ≥ 22
    (global `WebSocket`, `node --test` globs). CI runs on Node 22 and 24.
13. **Hooks not registered:** `WorktreeCreate`/`WorktreeRemove` (registering them replaces git's
    worktree behaviour), `MessageDisplay` (fires for every streamed text chunk), `Elicitation*`,
    `ConfigChange`, `FileChanged`, `Setup` — not needed for the visualisation.

## Git and GitHub

14. **Commit identity.** The brief says "Commit as <Your Name> <your-email@example.com>", a
    placeholder that was not filled in. Commits are authored as the owner's GitHub account,
    `eylem2002 <eylem2002@users.noreply.github.com>` (GitHub's privacy-preserving address), and
    are not signed with this environment's key. No AI attribution lines are added.
15. **The `main` branch holds only an empty root commit** ("Initialize repository"), so that pull
    requests have a base. All project files arrive through feature-branch pull requests.
16. **The GitHub repository** is `eylem2002/andary`, created by the owner during the build (this
    environment could not create repositories). Pushing to it needs the Claude GitHub App to have
    access to the repository; see the final report for whether that was possible.
17. **Stacked pull requests.** Each feature branch builds on the previous one, and each PR targets
    the branch below it, so every PR shows only its own change. Merge them in order.
18. **Product name follows the repository: Andary.** The owner named the repository "Andary"
    after work had started under the working title "Token Town". The app, CLI (`andary`), config
    folder (`~/.andary`) and environment variables (`ANDARY_*`) were renamed to match; the town in
    the app is called Andary. Renaming again is a search-and-replace plus `npm test`.

## Made while building (collected from each part)

19. **Teammates.** An Agent call with a `name` (or `team_name`) is an agent-team teammate; unnamed
    helpers are numbered per session by role ("Scout 1", "Architect 2"). Teammates that run as
    separate split-pane processes have their own session id, so they appear as their own crew.
20. **Achievements.** "Rubber Stamp" counts approvals given in the town and in the terminal;
    "node_modules Black Hole" counts JavaScript package installs; "Polyglot" counts model
    families (opus, sonnet, haiku…).
21. **Demo story.** The simulation uses a fixed default seed, so the demo tells the same story each
    time (`?seed=` changes it). Demo approvals expire after 25 s of story time.
22. **Characters.** Figures are drawn 1.6× life size so they read as people at a glance;
    the Foreman is taller and wears a hard hat and hi-vis vest; everyone walks on the right.
    Default entrance is a pop, default exit a poof.
23. **Sun and sea.** The sun follows a stylised winter arc (south-east → south → south-west) so
    building fronts are lit all day; the sea extends north of the town; the south ring road
    enters tunnels at the plinth edges, which is where the bus comes and goes.
24. **Remote approvals switch** lives in Settings (the Approvals panel links to it). The global
    `A` shortcut focuses the Approvals tab, never a card, so pressing it twice cannot approve
    anything by accident.
25. **Install path.** The setup steps install the CLI with `npm install -g github:eylem2002/andary`
    (no npm publication needed; requires the repository to be public or the user to have access).
26. **Cache policy.** `vendor/` files are cached for a day; everything else is `no-cache` with an
    ETag so updates show up immediately.
27. **Uninstall keeps `~/.andary`** (the forwarder and install records); deleting it is safe.
28. **One private hosted demo, on request.** The brief says not to create cloud resources, so
    nothing was deployed on our own initiative. When you asked to see it running, the demo was
    published as a private claude.ai artifact (visible only to you until you share it; no
    account, server or cost on your side). `public/` runs the same demo on any static host (for
    example GitHub Pages, free for public repositories).
29. **Performance scores come from software rendering.** The build environment has no GPU, so
    Chrome drew the 3D town on the CPU (SwiftShader) and Lighthouse's mobile preset throttled the
    CPU 4× on top. Performance numbers are therefore far below what a laptop GPU gives; the other
    three Lighthouse categories and the layout-shift metric are unaffected.
30. **Delivery while GitHub push access is missing.** This session could read `eylem2002/andary`
    but not push to it (the Claude GitHub App has no access to that repository). The work is
    delivered as a git bundle with every branch, plus `scripts/publish-github.sh`, which scans
    for secrets, pushes the branches and opens the stacked pull requests from your machine.
31. **Fake credentials in tests are built at runtime**, and the secret scanner treats a private
    key as a secret only when it is a complete PEM block (as gitleaks does), so the scanner stays
    strict on real keys while the redaction tests can exist.
32. **`/andary:town` keeps `allowed-tools: Bash(node *)`.** No narrower pattern is safer
    (`node -e …` would match any pattern that allows the real command); the alternative,
    running `andary start` in a terminal, is documented.
33. **"Build" means packaging.** There is no build step (ADR 0002); the verification checks that
    the vendored files regenerate identically from `node_modules` and that the npm package
    installs and runs.
34. **The director camera is on by default, unless motion is reduced.** The town is most fun
    when the camera goes where the action is. Because it moves the view by itself, it starts off
    when the system or Settings asks for reduced motion; `C` or the toolbar button turns it on or
    off either way, and that choice is remembered (WCAG 2.2.2). It reacts only to events less than
    30 s old, so a reconnect that replays history does not send it flying; it only ever stops a
    follow it started itself; and after you select an agent or move the camera it waits 20 quiet
    seconds before taking over again.
35. **What counts as interesting.** Arrivals of subagents and crews, permission prompts and
    failures score highest, then handoffs, finished tasks and compactions, then routine tool
    calls. A shot lasts 5.5–11 s; only a strong moment cuts in before 11 s; every fourth shot is
    a wider one; phones zoom 1.5× further because zoom 1 shows less of the town there. It only
    films agents who are in the 3D town, so a helper that has left is never the subject.
36. **Full-screen town on a static host.** With no server the page is a demo for visitors, so the
    side boards start put away and the setup steps are offered in a toast (also announced to
    screen readers) after 8 s, instead of a dialog over the first view; the sign's "Use your own
    Claude Code" button and Settings have them all along. Locally the boards start shown, and `H`
    remembers your choice either way. Asking for a board tab (`A`, or Review on an approval
    toast) brings the boards back, because an approval must be reachable; if focus was inside a
    board when it goes, focus moves to the button that brings it back. If the 3D view cannot
    start, the boards always show and the two new buttons are not offered.
37. **The toolbar wraps.** On a phone the demo toolbar has ten buttons and wraps to a second row,
    and on a narrow window the full toolbar wraps too, rather than dropping controls or running
    off the screen. The caption, the side boards and the notices sit above whatever height it
    takes.
38. **"Make it look like that game" means the mood, not its assets.** The town takes on an
    original sunset-coast look (pastel stucco, palms, a beach, a pink-and-violet dusk and neon
    at night) in the spirit of a Miami-style coast. No logo, name, character, artwork, font or
    other material from any third-party game is copied or imitated. This replaces the limestone
    hill-town look of assumption 3; the layout, buildings and their meanings are unchanged.
39. **Each building gets its own paint.** Buildings still name shared materials ("stone",
    "gold"), and the kit repaints them per building (`PAINT` in `palette.js`), so a new building
    gets a colour by adding one line. Neon strips under the cornices light up from dusk.
40. **A sunset time setting.** `N` now cycles local clock → day → sunset → night, and sunset
    holds the town at 18:00 for the golden-hour look.
41. **The HUD follows the theme.** Pink-to-violet sign, warm paper boards and a plum dark mode;
    every text colour was checked for at least 4.5:1 contrast and the axe checks still pass.
42. **"Ask for ideas" is kept aside.** The owner meant "give me ideas here", not a feature, and
    did not tick it in the checklist. Its branch is kept as `archive/ask-ideas` (in the bundle,
    not in the pull request order), so it can come back without redoing it.
43. **The owner's checklist sets the next features.** Built in this order, one branch each:
    file diffs, cost meter, town weather, a growing town, leaderboard, notifications, ambient
    sound, theme switcher, team town.
44. **Diffs come from the tool call, not from git.** An Edit's old and new text (as Claude Code
    sent it to the hook, after redaction and the 2,000-character cut) is all Andary sees; it
    never reads your files. A Write shows the whole new content as added lines, since the old
    file is unknown. The last 20 changes per agent are kept in memory only.
45. **Cost is read from Claude Code's transcripts and priced at API list prices.** Hooks carry no
    token counts, but every hook names its transcript, where each assistant message records its
    usage. Prices (checked 2026-11-20) live in one file. On a subscription plan nobody pays per
    token, so the town says "estimated at API prices" and shows tokens when a model's price is
    unknown. Transcript format assumed: one JSON object per line, `type: "assistant"`,
    `message.id`, `message.model`, `message.usage`, `timestamp`; subagents in
    `<session>/subagents/agent-<id>.jsonl`.
46. **Two small files on disk.** To keep day totals across restarts without counting anything
    twice, `~/.andary/usage.json` holds day totals, how far each transcript was read and the ids
    of recent messages (numbers, ids and transcript paths, which name project folders; mode 0600). The promise "nothing on disk without `--record`" now reads
    "none of your prompts or commands on disk without `--record`".
47. **Usage is a dialog, not a fourth board tab.** `U`, the toolbar's coins button or a crew's
    cost opens it; the board stays at three tabs on a phone.
48. **Town weather rules.** Failures rain (test failures count double), the rain halves every
    minute; a failed turn (rate limit, overload) or a pile of failures brings a storm with
    lightning now and then; tests that pass again within ten minutes of failing bring a rainbow
    for half a minute and wash most of the rain away; a crew that has thought for more than 30
    seconds after a prompt without using a tool brings fog. Interrupts never rain. It is on by
    default and can be turned off in Settings.
49. **No flashes with reduced motion.** Lightning is a single short flash at most every five
    seconds (well under the three-flashes-a-second limit), and none at all with reduced motion,
    where the rain also stands still. Screen readers hear only storms and rainbows.
50. **What counts as work done.** A finished turn (`Stop`), a finished helper (`SubagentStop`)
    and a completed task (`TaskCompleted`) are one point each. Points never go down; the
    landmarks are original models (no real brands), placed where the town had room: the
    north avenue, the promenade, the lawn by the Workshop, a stretch of beach kept free of
    umbrellas for the wheel, the sky, and over the Town Hall's own dome.
51. **The demo starts at 92 points**, so a visitor sees the Ferris wheel rise within a few
    minutes; its count stays in that browser.
52. **Leaderboard records.** A "fix" runs from a crew's first failing test run to its next
    passing one (within two hours; interrupts don't count). Records cover the events the town
    still holds (the server keeps the last 2,000, and the page rebuilds them from those on every
    load or reconnect); the streak counts busy days ending today or yesterday. Agents are
    ranked by tool calls, then files changed, among those in town now. In a team town
    (feature 9) the same board covers everyone's crews.
53. **Phone notifications through ntfy.** "Phone notifications" with zero cost and no account
    means ntfy: a free, open-source push service with Android and iOS apps, where subscribing to
    a topic needs no sign-up. It is the only feature that sends anything off the computer, so it
    is off unless started with `--notify` or `--notify-url`, the topic is random (24 characters),
    and the messages carry no project, file or command. Owners who want nothing to leave the
    machine can run their own ntfy server and pass its URL.
54. **Notifications on this computer** use the browser's own permission and only fire while the
    town's tab is in the background; they may name the crew, since they stay on the computer.
55. **Ambient sound is synthesised and follows sound.** No audio files (nothing to license):
    noise loops for waves, hum and rain, short calls for gulls and crickets, and a pad of four
    slow chords. It plays only while sound is on (still off by default) and "Ambient sound" is on
    (on by default), and fades out while the tab is hidden. "Night" for the crickets is the
    town's clock (before 6:00 or from 19:30).
56. **Five looks, chosen at load.** The town's colours are baked into its geometry (vertex
    colours, one draw call per kind), so a look is chosen when the page loads (`?look=` or the
    saved preference) and changing it reloads the page; the HUD keeps its own colours. The
    looks are original: Sunset coast (default), Snowy village (painted wooden houses, pines,
    snowmen, snow instead of rain), Neon city (dark towers, neon on all day), Desert oasis
    (adobe and tiles, red rock) and Amman old town (the first limestone look, kept from
    before the sunset coast).
57. **The team town is a LAN feature over plain HTTP.** Zero cost rules out a relay service, so
    one teammate's Andary is the host and the others post to it directly. `--team` listens on
    every interface (with the usual warning) and the CLI suggests a private network such as
    Tailscale when people are not on the same network; there is no TLS of our own (until part 28:
    `--tls-cert`/`--tls-key`, see 74).
58. **Teammates share events, not money or control.** A member's server relays its already
    sanitized hook events. Token usage and costs stay on each person's own town, phone
    notifications fire only for your own crews, and a teammate's permission prompt is shown in
    the host's town but never held there: only they can answer it, in their own terminal or town.
59. **One view link per team.** Watching is view-only and the same link works for everyone the
    host gives it to; `andary team reset` revokes it together with every member key. Viewers
    see everything the town shows about every crew, the host's included: prompts, commands, file
    paths and edits, permission requests with what they ask for. They cannot answer prompts, and
    do not get the host's approval cards, costs, settings or ntfy topic. The invite and a
    sharing member's banner both say so. A team host answers to its network addresses (checked
    every 30 s) and to names given with `--team-host` (a VPN name), so the view link works there.
60. **"Their own neighbourhood" is their name, not a district.** The town is laid out by kind of
    work (the library, the terminal, the docks…), so a teammate's crew still walks to the same
    buildings. Their foreman carries their name on the name tag and in the log, and their crew
    has a name badge on the crews board.
61. **Hosting and sharing are exclusive** in one town, and the demo shows the web-app crew as
    Lina's so the feature can be seen without a second computer.
62. **Codex through its own hooks, not its session files.** Codex's hooks (on by default in
    recent versions) use Claude Code's event and field names and read the same permission
    decision, so the same forwarder serves both; a `codex` argument tells the server which
    adapter to use. Tailing `~/.codex/sessions` was the fallback and is not needed (ADR 0013).
63. **What Codex sends was taken from its documentation and third-party references**, not from
    a live Codex: no Codex account or API key is used here (zero cost). Unknowns are handled
    defensively: the patch text is read from `tool_input.command`, `.input` or `.patch`; an exit
    code from `exit_code`, `exitCode` or `metadata.exit_code`; `spawn_agent`'s task from
    `message`, `prompt`, `task` or `description`. Anything else passes through unchanged and shows
    as an ordinary tool call.
64. **Remote approvals for Codex use the same switch and the same card.** Codex reads the same
    `hookSpecificOutput.decision` shape, and the request is shown exactly as Codex sent it (a
    patch as its raw text). Like everything Codex-specific, this was tested with recorded
    payloads, not a live Codex.
65. **Codex costs are not counted yet.** The usage reader reads Claude Code transcripts only;
    a Codex crew shows its model but no cost. Reading Codex rollouts is a possible follow-up.
66. **No session id prefix for Codex.** Codex and Claude Code both use random session ids, so they
    cannot collide; the crew's "Codex" badge comes from `andary_source`, not from the id.

67. **A command given as a list is shown with shell quoting.** Codex may send `Bash`'s command as
    an argument list. Joining it with spaces would make `['rm', 'a b']` and `['rm', 'a', 'b']`
    look the same on an approval card, so each argument that needs it is quoted the way a POSIX
    shell would (`rm 'a b'`), both in the town's events and on the card.
68. **A renamed tool keeps Codex's name in `andary_tool`.** The town calls an `apply_patch` an Edit
    or Write, but Codex asked permission for `apply_patch`; the approval settles when either name
    runs. Every `andary_` field is the server's to set and is dropped from what a hook sends.
69. **An interrupted turn earns no growth point.** Codex's Interrupt becomes a Stop for the crews
    board, but the town grows only for finished work.
70. **The page's look is read in `public/js/page.js`.** `core/` stays free of browser state; the
    HUD and the town's environment read the look from one small module that does nothing else.
71. **The sign-in lives in page storage, not a cookie (ADR 0015).** A cookie for `127.0.0.1` is
    sent to every port; `localStorage` belongs to one origin, port included. The trade-off is
    that the town's own page script could read it; the page runs only its own scripts under a
    strict CSP and never renders event text as HTML, so that was judged the smaller risk. Old
    cookies are simply ignored; signing in again takes the link once.
72. **A denial's reason is one line.** Typed by you for the agent to read: whitespace and control
    characters become single spaces, at most 500 characters. Enter in the field denies.
73. **The forwarder's challenge costs one more local request per event.** Loopback round trips
    take about a millisecond, observation hooks are asynchronous, and nothing (not even the hook
    secret) is sent to a program that cannot prove it holds the key.
74. **HTTPS is for other computers; loopback stays plain (ADR 0016).** Local clients would not
    match a certificate issued for a network name, and their traffic never leaves the machine.
    Plain HTTP from the network is refused once a certificate is given. Andary does not make
    certificates: `tailscale cert` (free) or your own CA does.
75. **CI's linters are pinned by hash; Lighthouse by lockfile.** Hashes come from actionlint's
    published checksums and PyPI's published digests at the time of pinning; bumping a version
    means regenerating them.
76. **Two remaining risks are accepted, not fixed.** A local denial of service (flooding the
    port) needs an account on the computer and cannot read or change anything; phone
    notifications through ntfy.sh are opt-in and never name a project, file or command.
77. **A sign-in from a link is a candidate until the server accepts it.** Anyone can link to
    `…/#signin=junk`; that must not replace a working sign-in. The page tries the new token on
    its own first and keeps it only if `/api/hello` accepts it.
78. **"This computer" for plain HTTP includes a peer that connects from the address it connected
    to.** That is how a local client of `--host <address>` arrives; TCP addresses cannot be forged
    that way from another computer. A local reverse proxy counts as this computer, as before.
79. **Blank-line runs on an approval card collapse into a marker.** Three or more blank lines in a
    row show as "⟨N blank lines⟩", and the note gives the line counts, so padding cannot push the
    rest of a change out of sight.
80. **A name "fits" when it takes at most 64% of its lot's width on screen (ADR 0017).** Lots
    have yards and pavements around the building, so the whole lot would be too generous. At the
    whole-town view on a laptop the names take 34–82% of their lots, with a clear gap between
    61% and 68%: 64% sits in that gap, so nine names show steadily and six buildings show icons,
    instead of names flipping with a pixel of zoom.
81. **Only figures in front of a building fade its label, for at least 600 ms.** "In front" is
    judged on screen: the figure's feet are below the building's ground point under the label.
    A figure behind the building is hidden by the building itself, so fading the label for it
    would look like a glitch. One ground point is approximate at the edges of a wide label; the
    minimum fade time keeps a figure on that edge from making the label blink.
82. **`always` lets names overlap.** It is the viewer's explicit choice, so every name is written,
    the nearer on top, rather than shrinking some to icons and calling that "always".
83. **`P` is free in the page.** No browser uses a bare `P`, and the 3D view's own keys are
    arrows, `+`/`-`, `Q`/`E`. Screen readers may (JAWS: next paragraph in its virtual cursor),
    but in browse mode they keep the key for themselves, as they already do for `N`, `M`, `H`
    and `L`; the setting is also in Settings.
84. **Four speech bubbles on screen at once, two over one spot.** More buried the agents saying
    them (six stacked over the plaza in the demo). The selected or pointed-at agent keeps its
    bubble first, then agents that wait for you or are failing, then whoever has been seen
    talking least recently, so every agent gets turns. A bubble that appears keeps its place for
    four seconds, time to read most lines. The others are muted, not lost: they show when room
    frees up, or run out unseen (a line with under a second left stays unseen rather than flash).
    The events behind them are in the log.
85. **Two toasts at most, one per kind.** A newer crew arrival replaces the older one's toast, and
    a newer achievement the older's; the Crews panel and the leaderboard keep them all. A toast
    under the pointer or the keyboard is never replaced or pushed out. When one must go, the
    oldest without a button goes first, then a crew arrival, and an approval's toast last.
86. **The page title counts approvals only.** "(2) Andary" is for things that block an agent
    until you answer; failures and finished work do not change the title.
87. **A phone note for a dialog waits ten seconds.** Most prompts are answered within a few seconds
    by someone at the computer; a note that arrives after you answered is noise. Each dialog (a
    permission request, a question, a plan, a form an MCP server asks you to fill in) has its own
    ten seconds. Dialogs whose seconds run out together become one note, which also covers the
    other dialogs their crews have open, since parallel calls ask a moment apart. A finished turn
    sends nothing by itself: Claude Code's `idle_prompt`, a minute later, covers a turn nobody came
    back to.
88. **Plans and questions are never held in the town.** A plain allow cannot approve a plan
    (`ExitPlanMode`) or answer a question (`AskUserQuestion`); both wait in the terminal, and the card
    always says so, also when remote approvals are off. On the phone they have notes of their own
    ("A crew has a question for you."). An agent cannot ask again while one waits, so its next
    question or plan shows the older one was answered: "No, keep planning" sends nothing, and the
    revised plan is a dialog, and a note, of its own. An MCP server's form (Claude Code's
    `elicitation_dialog`, `elicitation_url_dialog` and `agent_needs_input` notices) is a question
    too; it names no tool, so it closes like a session's notice (below).
89. **A dialog's note is dropped only on proof of an answer.** Proof is that very call reporting
    back (the same tool and call key, taken from the input as it arrived, before anything is cut;
    for a call Codex's adapter renamed, from the original call; questions and plans by name, since
    your answer changes their input), your prompt or `/compact`, the agent's turn ending (in an
    error too, or a teammate going idle) or the session ending, or a decision in the town. Your
    prompt answers every dialog of the session, whoever asked, since nobody can type while a dialog
    shows in the terminal; except a request the town holds right now, which is not in the terminal
    and does not stop you typing to the lead. A session's notice or form, which names no tool, also
    closes when the lead starts its next call. A new request from the same agent is no proof,
    because parallel calls each ask on their own (a question or a plan aside, 88); nor is a request
    that timed out in the town or went back to the terminal: the agent still waits there, and your
    next prompt answers it. The approval broker follows the same table, so the town's cards and the
    phone agree on what the terminal answered.
    Andary sees a yes in the terminal only when the tool finishes, a "No" only at your next prompt,
    and a diff you change in your IDE not at all (its result has another input), so a note can
    come after you answered: one note too many is better than none for an agent that waits. A tool
    result too big for the forwarder (over 1 MiB) arrives shortened; if its input was cut, it no
    longer matches its request.
90. **A dialog that has had its note is remembered for 30 minutes at most.** Until its proof it
    sends no second note, not even for Claude Code's own `permission_prompt` about it. A crashed
    session sends no SessionEnd, so after 30 minutes its dialogs are forgotten. Claude Code sends
    that notice once per dialog, so in practice a forgotten dialog brings no second note. At most
    100 dialogs are kept; the oldest give way.
91. **Codex gets its "waiting" note after a minute.** Codex sends no Notification events, so no
    `idle_prompt`. After a Codex lead's Stop (an interrupt too), Andary waits the same 60 seconds
    as Claude Code, and sends one note per Stop. Codex names a helper only when it starts and ends,
    so a helper's tool calls look like the lead's: a tool starting pauses the minute; its result, a
    helper ending or the lead's next Stop starts it again; only your prompt, or the session
    starting or ending, ends the wait. For the same reason Codex's dialogs cannot be told apart by
    agent: a helper's request counts as the lead's, and the lead's Stop answers it too. Andary
    cannot see you typing in Codex, so a reply that takes you over a minute to write still sends
    the note.
92. **The waiting note names no agent.** "A crew is waiting for your next prompt." fits Claude Code
    and Codex alike, as the notes for permission requests, questions and plans do.
