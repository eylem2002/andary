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
79. **Blank-line runs on an approval card collapse into a marker.** Three or more lines in a row
    that show nothing (blank, or only spaces, tabs, characters that draw nothing, such as
    no-break or ideographic spaces and the Braille blank, and combining marks, which on such a line
    sit on nothing that shows) show as "⟨N blank lines⟩", naming any such characters ("with
    U+00A0", "and combining marks": to a shell such a line is a word, not a blank), and the note
    gives the line counts, so padding cannot push the rest of a request or a change out of sight;
    two such lines are shown as they are. The same three-line rule holds in the command and in a
    diff, where a run is collapsed whatever its lines' kinds and a mixed one counts each ("⟨120
    blank lines: 80 added, 40 removed⟩"; a run of one kind keeps its + or −). Every other space
    but the plain one, and every character that draws nothing, shows as a marker too: every
    default-ignorable code point, assigned or not, since browsers draw an unassigned one (U+2065,
    U+E0080) with no width, as well as controls, format characters, private-use characters (a font
    may draw them as anything, or nothing), separators, the Braille blank, the Hangul fillers and
    the Khitan filler (U+16FE4). A run of them is one marker naming them (three at most, then "N more")
    with its length ("⟨U+00A0 ×1900⟩", "⟨U+00A0 U+3000 ×2000⟩"), so a million of them make one
    marker. A run holding a character that some reader takes for a line break also breaks the line
    after its marker (once per run), so the lines you read are the ones it reads: U+2028 and U+2029
    (JavaScript, Python's `str.splitlines()`), NEL (`splitlines()` and some editors, though not
    JavaScript), and a carriage return that is neither part of a CRLF nor the last character of its
    line (JavaScript, Python source and most editors: `// note\rconsole.log("RAN")` runs its second
    line; a shell reads it as part of a word, so a break there shows more than bash sees, never
    less). In a diff only a newline ends a row, so a carriage return in a file's content is marked
    (⟨U+000D⟩) rather than drawn as a line break. Markers make the text longer (about 4.5 times
    for single hidden characters each between plain ones, 5 for lone carriage returns or line
    separators, which also break the line); that stays linear and is bounded by the request's own size (1 MiB), so it is
    left as it is. More than
    three combining marks on one base become "⟨N combining marks⟩": no script needs more than
    three in common text, and a taller stack paints over the lines around it. Right-to-left
    letters (Hebrew, Arabic) are left as they are: they reorder what they touch but hide nothing,
    and the characters that override that order (bidirectional controls) are marked.
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
86. **The page title counts what needs you.** "(2) Andary" counts the same items as the "need
    you" button (93): what blocks an agent, a stopped turn, a finished turn nobody answered.
    (It first counted approvals only; a question or a plan blocks an agent just as much.)
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
    back (the same tool and call key, taken from the input as it arrived, before anything is cut,
    without the `description` of any Codex call, which Codex adds, its reason for asking, to a
    request of any tool and never to the call's start or result, nor of a Claude Code command
    (Bash, PowerShell), which runs nothing; any other Claude Code tool's description counts, as an
    MCP tool's may be what it acts on, so two calls that differ only in it are told apart; for a
    call Codex's adapter renamed, from the original call; questions and plans by name, since your
    answer changes their input), your prompt or `/compact`, the agent's turn ending (in an
    error too, or a teammate going idle) or the session ending, or a decision in the town. Your
    prompt answers every dialog of the session, whoever asked, since nobody can type while a dialog
    shows in the terminal; except a request the town holds right now, which is not in the terminal
    and does not stop you typing to the lead. A session's notice or form, which names no tool, also
    closes when the lead starts its next call, and is not opened at all when it arrives after a
    call the lead started 250 ms or more after it was sent (each tracker remembers every session's
    lead's newest call start, for as many sessions as it keeps dialogs). A new request from the same agent is no proof,
    because parallel calls each ask on their own (a question or a plan aside, 88); nor is a request
    that timed out in the town or went back to the terminal: the agent still waits there, and your
    next prompt answers it. Each hook counts at the time it was sent, not when it arrived: a
    permission request is sent at once and a PreToolUse or a notice in the background, so a
    question's request can arrive before its own start, and a notice before the call started ahead
    of it. That time is when the forwarder's process started (`performance.timeOrigin`), which no
    start-up work delays: with a clock read once Node runs, of two hooks started 1 ms apart the
    later one came first in 8 pairs of 40. It is kept between an hour before its arrival (an older
    stamp counts as an hour old) and its arrival: the stamp is this computer's own clock, and a
    computer that sleeps or suspends can hold a forwarder back for minutes, after which a
    question's start must still find its own dialog. Two processes' times
    may still be a few milliseconds the wrong way round, so a hook counts as before or after
    another only 250 ms (`ORDER_SLACK_MS`) apart: a question's or plan's start joins its own request
    stamped after it or no more than 250 ms before it, a question or plan closes only those opened more than 250 ms
    before it, and a notice is closed only by a call started 250 ms or more after it. Nothing that
    shows an answer comes that soon: asking again takes your answer and a model turn. Known limit:
    if a plan's or question's request never reaches the town (a 429, a failed proof, a restart)
    and the next one's request overtakes its own start, that request joins the older dialog, which
    its start then closes: the broker resolves the waiting request as answered, early (it was not
    held, so the terminal still asks), while the phone still notes the new one. The approval broker
    follows the same table, so the town's cards and the phone agree on what the terminal
    answered.
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
    starting or ending, ends the wait (at most 100 sessions are waited on at once). For the same
    reason Codex's dialogs cannot be told apart by agent: a helper's request counts as the lead's,
    and the lead's Stop answers it too. Andary cannot see you typing in Codex, so a reply that
    takes you over a minute to write still sends the note.
92. **The waiting note names no agent.** "A crew is waiting for your next prompt." fits Claude Code
    and Codex alike, as the notes for permission requests, questions and plans do.
93. **"Needs you" counts what blocks an agent, a stopped turn, and a finished turn nobody
    answered.** A request, a question or a plan counts until the same proof of an answer the phone
    waits for (89), so the town and the phone never disagree. A finished turn counts only once
    Claude Code's `idle_prompt` says nobody answered (about a minute later), and for 30 minutes at
    most: by then the crew is probably done for now. Teammates' crews and ended sessions never
    count. A session's own notice that something asks for permission counts only when nothing of
    that session is known to be open: it does not say whose it is.
94. **A finished Codex turn counts after a minute without a prompt.** Codex sends no
    `idle_prompt`; a minute matches Claude Code's, and the phone's Codex note waits as long.
95. **Crews stopped by one rate limit within ten minutes are one item.** One cause, one thing to
    do: "Rate limited: 3 crews stopped". It takes two crews: a lead and its helper stopped by the
    same limit are one crew's two stops.
96. **Stops and finished turns can be set aside, until the situation changes and for a day at
    most; a request, question or plan only once it has waited five minutes, and never while the
    town holds it.** A waiting dialog blocks the agent, so it stays until answered, unless it may
    be stale: an interrupted helper sends no hook at all, and only you can tell. An item's id
    carries the time it started, so a new stop is a new item; dismissals are kept in this
    browser's local storage and forgotten after 24 hours.
97. **Desktop notifications are for news only.** An item pops up once, only while the town is in
    a background tab, and only if it started to count within the last two minutes: a reconnect or
    a page opened in the background shows older items in the town without popping them up.
    Changes that arrive together (a reconnect's history) are checked once, so a request asked and
    answered within them is no news. A permission request waits until its request reaches the town
    (it follows its hook within milliseconds; three seconds at most), so it says the right place to
    answer. They name the crew by its title or folder, never a request's command or file: they can
    show on a locked screen. Screen readers hear of new questions, plans and stops the same way;
    approvals are announced with their cards, and finished turns would be too chatty.
98. **No "Turn finished" notification while only one of your crews is in town.** You are probably
    at its terminal.
99. **`I` goes to what needs you.** It is free in the page (no browser uses a bare `I`), and reads
    as "inbox". A request the town can answer opens its card in Approvals; anything else is
    answered in the terminal, so the agent is selected and the camera points at it.
100. **A hook sent before an agent's wait began, or before it last moved on, is stale.** Every hook
    but a permission request reaches the town on its own, in the background, so a late
    `PreToolUse` of a finished turn does not end its wait, and a `Stop` that arrives after the
    prompt you queued behind it starts none. The town goes by each hook's own time, as the phone
    notes and the broker do; the clock is the agent's machine, the same one for all its hooks.
101. **"Allow always" saves only rules that stay with you.** The town offers an allow rule for this
    project and only you (`.claude/settings.local.json`) or until the session ends; never one for
    the committed project settings (it would change your teammates' prompts) or for every project,
    never a mode or folders, and never a rule that allows more than it reads (108). The forwarder
    enforces the same rules on its own.
102. **A suggestion the town cannot show exactly is not offered.** One with a field the town does not
    know, on the suggestion or on a rule, or one that sanitising changed (a secret masked, a long
    value cut) gets no "Allow always": the card must show the very rule it saves.
103. **One rule per card, and no key for it.** The card offers the first suggestion kept for this
    project, else the first kept for the session. `A` stays a plain allow, so saving a rule always
    takes its own button, with the same one-second click delay as Allow and Deny.
104. **"You allowed this N times today" counts what this town saw, in one project.** Earlier
    requests for the same rule from the same folder, on the viewer's calendar day, among the requests
    the page knows (the last 100; a new tab gets the server's last 50 settled ones): those allowed in
    the town, and those answered in the terminal whose tool then ran. One the terminal settled
    because the agent or session stopped is not counted: it may have been a denial.
105. **The town says what it asked for, not what was saved.** Claude Code does not report whether
    it saved a rule, so a card answered with "Allow always" reads "Allowed; asked Claude Code to
    save …". A rule asked to be saved for this project that comes back in the same session, after
    the choice, gets a neutral hint: the rule may not have taken. The town cannot tell why (it may
    not have been saved, or another setting may still ask), so it does not guess. Rules kept for the
    session are not judged, since `claude --continue` keeps the session id but not its session
    rules, and other sessions may have started before the rule was saved.
106. **The forwarder compares suggestions as JSON with sorted keys.** Key order means nothing in
    JSON. A value it cannot compare (nested too deeply) saves nothing: the answer is a plain allow.
107. **The demo keeps a rule allowed always for its project.** Its suggestions are for this project
    (`localSettings`), so later demo sessions of the same project do not ask for it either, as
    Claude Code would not.
108. **A rule is offered only when the card can say what it allows.** The town lists what it
    offers rather than what it refuses: one Bash or PowerShell command with no `*` ("only this
    command"); Bash commands starting with a prefix, written `npm test:*` or `npm test *` (Claude
    Code reads the two alike, and its permission dialog now writes the second), said in words
    ("commands starting with “npm test”"); WebFetch from one host with no wildcard
    (`domain:example.com`, "only fetches from “example.com”"); or one MCP tool with no content, the
    narrowest rule there is for it ("every use of this tool"). Anything else is refused, among them
    a whole built-in tool (no content, an empty content, which Claude Code saves as the bare tool,
    or `*`), a wildcard anywhere else (`rm -f *.log` also allows `rm -f -r ~ x.log`), a
    PowerShell prefix (its matching ignores letter case and expands aliases, so it covers more than
    it reads), any rule for Read, Edit, Write, Glob, the notebook tools or Cd (Claude Code reads
    their content as a gitignore pattern, so even `Edit(src)` covers every file under any `src/`,
    and a folder rule such as `Read(/project/**)` a whole tree), and an MCP rule with content
    (Claude Code skips those). The terminal still offers all of them.
109. **"Allow always" needs a forwarder that can pass the rule on.** The plugin runs its own copy of
    the forwarder, and `andary start` refreshes only `<home>/hook.mjs`, so an older copy may answer
    for the town; it would print a plain allow. Each body says what its forwarder does (`caps`),
    and a request whose body does not declare `updatedPermissions` offers no rule (one that does
    not declare `truncated` is not held at all).
110. **Rules are written the way Claude Code writes them.** A backslash and each parenthesis in a
    rule's content get a backslash (Claude Code's own settings writer does this), so
    `Bash(echo \), Bash\(ls)` cannot read as two rules. Hidden characters are revealed on the card
    and in the log, as for commands.
111. **"The same step" is judged from the call alone.** Shell commands are read by `core/shell.js`
    as a shell reads them (quotes, here-documents and their bodies, redirections, comments;
    PowerShell's in its own mode). A shell command is read as the command inside a
    shell it was handed to (one level of `bash`/`sh`/`zsh -c` or `-lc '…'`: Codex sends
    every command so), its whitespace collapsed, without a leading `sleep N &&` (or `;`) and
    without a trailing `2>&1`, `| tail …` or `| head …` (only a single pipe: `|| true` stays). A
    trailing `| grep …` is dropped only after a test or build run (`npm test`, `npm run build`,
    `pytest`, `cargo test`, `go test`, `make`, `tsc` and the like), so `npm test 2>&1 | grep FAIL`
    is `npm test` while `git log | grep fix` and `git log | grep feat` are two steps. Leading
    `cd <dir> &&` (or `;`) are followed to the folder they lead to, from the hook's cwd, and that
    folder is part of the step: `cd packages/a && npm test` and `cd packages/b && npm test` are two
    steps, `cd . && npm test` or a `cd` into the cwd itself is `npm test`, and `npm test` run from
    `packages/a` is `cd packages/a && npm test` run from the project. A `cd ~/x` or `cd $DIR` is
    kept as written. The alert shows such a step with its `cd`, relative to the cwd. File tools go
    by tool and path (Read with its offset and limit), so three failed Edits of one file with
    different text are the same step; Grep and Glob by pattern and path; anything else by its input
    as JSON with sorted keys. Keys are cut at 300 characters.
112. **A change is judged by what the call says it did, and can be wrong both ways.** Andary cannot
    see the disk, so besides a successful Edit, MultiEdit, Write, NotebookEdit or Codex patch, a
    successful shell command (read inside one level of `bash -lc '…'`, as in 111) is a change when
    it reads like one: `sed -i`, `perl -i`, a `--write`, `--fix` or `-w` flag (not grep's, curl's,
    wc's, diff's or git's `-w`), `ruff format`, `black`, `cargo fmt`, `go fmt`, an npm, pnpm, yarn
    or bun script whose name has `format`, `fix`, `codegen` or `generate` in it (`lint:fix`, not
    `test:fixtures`) or is `build:types`, `node scripts/…` or `python scripts/…`, `patch`, `rm`,
    `mv`, `cp`, `mkdir`, `touch` (also after a `(` or a quote opening a `-c` script), a package
    install or removal, the git commands that rewrite the work tree or the index (`checkout`,
    `switch`, `restore`, `reset`, `stash` but not `list` or `show`, `apply`, `am`, `merge`,
    `rebase`, `pull`, `cherry-pick`, `revert` and `commit`: after a commit, `git status` has
    something new to say), output or a here-document written with `>`, `>>`, `tee` or `tee -a` to
    a path that is not a log or temporary file (`*.log`, `*.out`, `/tmp/…`, `/dev/…` do not count),
    and a script given to python, node, ruby, perl or a shell inline (a here-document, `-c`, `-e`)
    that opens a file for writing (`open(…, 'w')` or `'a'`) or calls `writeFile`, `appendFile`,
    `write_text` or `write_bytes` (a shell's here-document is read as a command line itself).
    Wrongly taken for a change: test output kept in a file that is not a log
    (`npm test | tee results.txt`), a script that only reads, a `-w` that means something else, a
    word in a grep pattern (`grep "git commit"`). Each can hide a loop, never invent one. Missed: a
    change made in a way not listed (a script under another folder, a code generator by another
    name, a tool the agent calls through MCP), which can invent a loop that is not one; the list
    goes far enough that this needs an unusual command.
113. **Whose change counts.** A change counts for the agent that made it, for every agent of any
    crew working in the same folder (compared as given, with forward slashes and no trailing
    slash), and for every agent whose folder holds the changed file (a helper that went into a
    package of the project). A shell command names no file, so its change counts for its folder
    only. An edit in a worktree inside the project's folder (`.claude/worktrees/…`) also counts for
    the agents in the project folder: that can hide a loop, never invent one.
114. **Steps that wait by nature are not counted under any rule, not only rule 2.** Waiting for CI
    or a server often fails until it is over (`gh pr checks` exits 8 while checks are pending, a
    health check fails until the server is up), and a wait that changes nothing is no loop. The
    list: the tools `BashOutput`, `TaskOutput` (removed in Claude Code 2.1.277), `Monitor`,
    `ScheduleWakeup`, `WaitForMcpServers`, `TaskList` and `TaskGet`; a Read of a background task's
    output file (Claude Code writes it to
    `<temp>/claude-<uid>/<project>/<session>/tasks/<id>.output` and has Claude read it with Read
    since TaskOutput went), or a shell command that reads one; a shell command that loops with
    `sleep`; and a shell command (read inside `bash -lc '…'`, as in 111) whose every pipeline, between
    `&&`, `||`, `;` and `&`, waits, besides any `cd`, `echo`, `printf`, `true` or `date`: `sleep`
    (`Start-Sleep`, `Get-Job`, `Wait-Job`, `Receive-Job` in PowerShell), `watch`, CI and deployment
    checks (`gh run watch|view|list`, `gh pr checks|status`, `gh pr view --json
    statusCheckRollup`, `gh workflow view`, `gh api` on runs, check runs, check suites or statuses,
    `glab ci|pipeline status|view|list|trace`, `kubectl rollout status`, `kubectl wait`, `kubectl
    get pods`), health checks (`curl` of a `/health` path, `curl -f` or `wget` of localhost),
    looking at logs and processes (`tail … *.log`, `ps`, `pgrep`, `docker ps`, `docker compose
    ps`, `lsof -i`). So `sleep 5 && npm test` is the test run, not a wait. A wait that changes files
    (`sleep 5 && git pull`) is still a change. Codex polls a running command through `write_stdin`,
    which fires no hooks, so it needs no entry.
115. **An interrupt is no failure.** A tool call you stopped with Esc arrives as
    PostToolUseFailure with `is_interrupt`; you are at the terminal, so the agent starts afresh, as
    after a prompt.
116. **Starting afresh forgets everything about the agent.** A prompt, the turn ending (Stop,
    StopFailure, a Codex interrupt), the agent finishing (SubagentStop, a teammate's TeammateIdle),
    its session starting again (startup, resume, clear) or ending (every agent of the session, in
    the town and on the server) all clear the counts too, not just the alert: a loop is judged
    within a stretch of work. A compaction carries on with the same work, so it keeps them. A
    TeammateIdle the store could not match to a teammate lands on the lead and is not its turn
    ending; on the server, one without an `agent_id` resets nobody.
117. **One alert per agent, one episode while it lasts.** While any of its steps meets a rule the
    episode goes on, keeping the time it started (its id, so a dismissal holds) and showing the
    step run most recently, its count updated. When several rules hold, the words follow rule 1,
    then 3, then 2: "nothing changed" says the most, and rule 2 only speaks for a step that does
    not visibly fail. A success of the step restarts its failure count but not its run count, so a
    flaky test run over and over with nothing changed still meets rule 2.
118. **A stuck alert stands beside a wait.** An agent that asks you something while it is stuck has
    both items, the question first: the loop is still there once you answer.
119. **The stuck rules remember a bounded amount.** 200 agents (the one quiet the longest is
    forgotten first, and its alert ends), 64 steps each (past that, the step run the longest ago
    with no failure counting towards rule 1 or 3 goes first, so reads between attempts never push
    out a failing step; with every step failing, the one run the longest ago goes, and its alert
    ends), 12 failures per step. The server keeps its own copy, for this computer's events only,
    and only while phone notes are on.
120. **One phone note per episode, through the usual limits.** The note goes out when an episode
    starts, at default priority (the agent is not blocked). One held back by the 30 s limit (two
    crews stuck within half a minute) is dropped, not sent later: the town shows both.
121. **The desktop and phone words follow the rule that started the episode, and name no step.**
    Rules 1 and 3: "A crew seems stuck: the same step keeps failing"; rule 2, whose step may
    succeed every time: "A crew seems stuck: it keeps repeating the same step" (desktop: "<crew>
    seems stuck: …"). A note goes out once, so if the episode moves on to another rule its words
    stay; the town's own words always name the rule. Screen readers hear of a new alert in the
    town's words without the backticks that mark the command on screen, as of a new question, plan
    or stop: a stuck agent's storm is in the town only.
122. **In the town, the storm lasts as long as the alert.** Another step succeeding meanwhile does
    not clear it (it used to clear an agent's rain), and a failed turn's storm, which comes with
    the turn ending the alert, stays until the next prompt as before. The activity log gets one
    line, level warn, when an episode starts.
123. **Rule 3's "same error" is the first line that says something about the failure.** The whole
    error text is read (as far as the server passes strings on, 2,000 characters), skipping blank
    lines, lines that only say a command failed (`Exit code 1`, `Error`, `command failed`, `exit
    status 1`), the command echoed back (`> pkg@1.0.0 test`, `> node --test`, `$ jest`, `+ npm
    test`, or the command itself), npm's, pnpm's, yarn's and make's lines about a script failing
    (`npm ERR! code ELIFECYCLE`, `npm error Lifecycle script … failed`, its code, path, workspace,
    command and log lines, `ELIFECYCLE`, `ERR_PNPM_…`, `error Command failed with exit code 1`,
    `make: *** …`), CI's `Process completed with exit code 1`, rules and banners (`=====`, `===
    test session starts ===`), passing tests (`✔`, `✓`, `ok 1`, `PASS`), node's `▶` suite lines and
    test runners' headers (vitest's `RUN v…`, pytest's platform, rootdir, configfile, plugins and
    collected lines). Times in the line (`(1.2ms)`, `12ms`) are left out, as they differ from run to
    run. A failure with no such line (Claude Code's bare `Exit code 1`, Codex's npm stderr) is left
    out of rule 3; rules 1 and 2 still count it. Six red runs while writing tests rarely share
    their first such line, since a different test fails; a TypeError that keeps coming back does.
    The list goes past the design's "first error line" on the quiet side: a skipped line can hide a
    loop from rule 3, never invent one.
124. **The rules go by when each call happened.** Hooks reach Andary out of order, so each call
    carries its hook's own time (the town's `e.ts`, the server's `hookTime`). Each agent keeps the
    time of the latest change that counted for it; a call made before that and arriving after it
    is not counted by rules 1 and 2 (and a late success does not restart a count), though rule 3,
    which holds whatever changed, still takes its failure. Rule 3's failures are kept in time
    order and its 20 minutes run back from the latest. A change arriving after failures made later
    than it still clears them, which can hide a loop. An agent first seen after a change in its
    folder knows nothing of it, so its calls made before that change count: that could invent a
    loop, but only if its very first hooks arrive after another agent's later edit.
125. **The context in use is shown in tokens, never as a share of a window, and raises no alert.**
    It is what the newest reply's last executor iteration read (input, cache writes and cache
    reads), as Claude Code's status line reads it: an advisor's or a compaction's iteration is not
    the context, and neither is the top level, which adds up every executor iteration. Today's
    default models run a 1M window with no `[1m]` in the model id and the user can move the
    compaction point, so the window cannot be told from what Andary sees: a percentage would be a
    guess. `/context` in Claude Code gives the whole picture; a percentage waits for exact numbers
    from the status line (design §9).
126. **The newest reading is the last message read from the agent's own transcript.** Lines are
    written in order, so file order is time order; timestamps are not compared, since a clock
    change could reorder them. A helper's transcript gives the helper's reading. A line marked
    `isSidechain` in a lead's transcript (older Claude Code wrote helpers' messages there) is not
    the lead's, and a message that read no tokens is no reading. A forked session's
    (`--fork-session`) copy of an earlier message gives that session's reading though its usage
    is not counted again (the new conversation holds it); a record with a reading and nothing
    counted shows no cost, rather than "0 tokens".
127. **A compaction makes the context unknown until the next message, cut at the hook's start
    time.** `PostCompact` and `SessionStart` with `source: "compact"` drop the reading at once and
    say when. `PreCompact` changes nothing: another hook can still stop the compaction then, and
    the old count holds while it runs. The transcript is read a moment after a hook, so a message
    written before the compaction may still be waiting: messages written before the latest
    compaction hook started give no reading (their usage still counts). Both times come from this
    computer's clock (the forwarder's start time, Claude Code's timestamps); a hook dated after the
    server's clock counts as now. The first message after a compaction comes an API round trip
    after `PostCompact`; should a hook start later than it, that one reading is skipped and the
    next message brings one. A `compact_boundary` line in the transcript drops the reading too, at
    its own time, for setups without those hooks.
128. **A reading that no longer holds is hidden, or says what happened.** A finished helper's or
    an ended crew's last reading describes a context that is gone, so it is hidden. After a
    compaction the lead's row says "context compacted" and the inspector when, until the next
    reading: a blank would look like a fault. The browser also treats a reading older than the last
    compaction as gone, however it arrived. A lead that finished its turn keeps its reading: its
    conversation is still there, and that is when the number helps most, before the next prompt.
    "As of 2m ago" is how old the message that used it is; Andary reads it about a second after the
    hook that follows it.
129. **No context for Codex.** Andary reads no Codex usage yet (65), so there is nothing to count.
    When its rollouts are read, the sum needs its own check: OpenAI's usage counts cached input
    inside the input tokens, Claude's counts it apart.
130. **After a restart, the context shows again with the next message.** Readings are not kept in
    `usage.json`, like agent totals, and the tracker reads each transcript only from where it
    stopped, so it does not see the last message again.
131. **The crew's context sits on its lead's row, under the time.** In the crew's heading it shared
    an auto-width column with the model and cost, so its width came off every crew's name (141 →
    103 px at a 268 px panel). Under the time it widens only the time: the doing line below keeps
    its width, and the lead with a reading is always the Foreman (a teammate's or a Codex crew has
    no usage), whose name keeps its room at 268 px, beside a set-aside button too.
132. **The demo's context is made up apart from its costs.** It starts at 18k (system prompt and
    tools), grows by 0.6k–3.6k a step, starts again at 26k after a compaction (`PostCompact`), and
    stops at 950k: a demo crew can go a long time without compacting, and Claude Code would compact
    before a 1M window filled. The demo's costs are unchanged.
133. **A reply's iterations are counted one by one, each at its own model's price.** The top level
    of a reply's usage adds up its executor iterations alone. An advisor's iteration names its
    model and is billed at that model's price, and a compaction's is billed at the message's model
    (Anthropic's advisor tool and compaction documentation), so the tokens and cost add up every
    listed iteration; a fallback model's iteration is priced at its own model when it names one. If
    one of those models has no known price, the whole reply is unpriced, as a message from an
    unknown model already was. A line Claude Code marks `isUnmetered` counts nothing. As before, a
    later line of a split message adds only its extra output to the token totals (the cost
    difference in full), so a reply whose later lines add iterations can count less input than it
    used.
134. **A helper's transcript may sit one folder down in `subagents/`.** When `agent-<id>.jsonl` is
    not directly in its session's `subagents/` folder, the first folder there (of at most 50, links
    not followed) that holds that name is read.
135. **Two agents on the same files are compared by path, as written.** A path is made absolute
    and tidied (backslashes become slashes, `.` and `..` are resolved, a relative path is joined
    to the hook's folder, a drive letter is read in capitals), and nothing more: the browser
    cannot resolve a symbolic link, a hard link or a mounted folder, or ask whether a disk ignores
    case, so `src/App.ts` and `src/app.ts` stay two files and a conflict through a link is
    missed. A path under `~` or a variable is not placed at all. Worktrees: a file in one is never
    the same file as in another (other paths); for git commands, a worktree Claude Code makes
    inside the repository (`<repo>/.claude/worktrees/<name>`, from `claude --worktree`, a helper's
    `isolation: worktree` or the desktop app's parallel sessions) is a work tree of its own both
    ways, though its folder is inside the checkout's. A worktree git makes elsewhere is just
    another folder. Other nested worktree layouts are not known.
136. **A file change is a successful file tool call: Edit, MultiEdit, NotebookEdit, Write, and a
    Codex patch.** A Codex patch that deletes a file loses the other agent's work like a Write, so
    it is an alert too ("deleted …"). Files changed by shell commands (`sed -i`, `rm`, formatters,
    scripts, code generators) are not seen: a command line does not say which files it touched.
    A failed call changes nothing.
137. **"Active" means still in town; a helper's work outlives it.** A helper until its
    SubagentStop, or, when it was interrupted and sends none, until the Agent call that started it
    ends (a call launched in the background ends at once, so that one does not count) or its
    lead's turn is interrupted (Codex says so; Claude Code sends nothing when you press Esc, so
    such a helper stays until its half hour ends). A lead until its session ends: a lead whose turn
    ended is still active, as its changes sit uncommitted in the tree. When a helper finishes, its
    changes are not forgotten, as the design has it, but become its lead's: they sit uncommitted
    in the tree, and most edits are helpers'. Of two changes of one file the newer stands, with
    its time; a file either of them made stays a new one (145); what the helper staged waits for
    the lead's commit; a hazard about the helper's changes now names the lead, and one the lead did
    over them ends. A later helper of the same lead is handed them like the lead's own (138), and
    the lead's own changes over them are silent. The hazards the helper did end, even a counted
    alert you have not seen yet. A crew's changes are forgotten when its session ends. Teammates'
    crews (a team town) are left out entirely: their files are on their own computers.
138. **Any two agents count, also a lead and its own helper, except for what the lead handed on.**
    Helpers share the lead's tree and may run in parallel, so a helper's Write over a change its
    lead made while it worked can lose it. What the lead changed before the helper started
    (SubagentStart) was handed to it, a draft to rewrite or edits to commit: the helper's edits,
    writes and sweeping commands (`git add`/`git commit`) over it are no conflict, though a
    command that throws changes away still counts it. The design names Writes; edits are left out
    too, as the note would only say the hand-off happened. One hazard per pair of agents and file:
    it goes on while the agent changes the file again, and becomes a new one when the other agent
    changes it again or an edit turns into a write (the write replaces the note); a counted Write
    alert is never turned back into a note. The order of two changes is that of their hooks' times,
    whichever arrives first (147).
139. **An edit's note is shown beside what the agents do, never instead of it, and cannot be set
    aside.** It may last half an hour while both agents keep working, so on the crew row it is a
    line of its own under what the agent is doing (and under Now in the inspector); it never
    counts, pops up or is announced, and ends by itself. Every hazard's words name who did it,
    with its crew's number, and the other agents, with theirs when of another crew ("Foreman
    (crew 2) edited src/app.ts, which Foreman (crew 1) changed 4 min ago"), so each row, the
    inspector, the button's "Next:" and the announcements read right. "4 min ago" is counted from
    now, so the HUD redraws when the clock alone changes those words.
140. **Git hazards are read from the command line, when the command starts.** Recognised, as
    sweeping changes up: `git add <pathspec>|-A|-u|.` with a `git commit` later on the same line or
    in a later call (144), `git commit -a` (also `-am`; not `-uall` or `-S<key>`, whose value is
    written with them), `git commit <pathspec>` (`git commit .`, `git commit -m x src/`); as
    throwing them away: `git stash` (also `push` and `save`, with or without a pathspec; not
    `list`, `show`, `pop`, `apply`, `drop`, `clear`…), `git checkout .`, `git checkout [<tree>] --
    <pathspec>`, `git checkout -f`, `git checkout <path>` without `--` when an agent changed that
    file, or one in that folder, in the last half hour (else the word reads as a branch),
    `git switch --discard-changes`/`-f`, `git restore <pathspec>` (not `--staged` alone), `git
    reset --hard` and `git clean -f…` (not `-n`). Each counts only the changes under its
    pathspecs (146), or in the whole work tree (`git clean` without one: its folder), and only
    the files it touches (145). A `git add <file> && git commit` of your own files alerts only
    when another agent changed those files too. Still missed: `git pull --autostash` and `git
    rebase --autostash`, `git stash` inside a script, aliases (`git co`),
    `--work-tree`/`--git-dir`, PowerShell's `pwsh -Command`, and anything run through `eval`, a
    script, `make`, `xargs` or a shell two levels deep. A command refused before it ran (a
    PermissionDenied hook, or Deny in the town) ends its alert, found by its call's id or its
    input; one you deny in the terminal keeps it until you set it aside: Andary cannot see a "No"
    there.
141. **Which changes a git command acts on: the work tree the server finds on disk.** The browser
    cannot look at the disk, so the server finds, for each tool hook from this computer, the top
    of the work tree its folder is in: the nearest folder up that holds `.git` (a folder, or the
    file of a linked worktree or a submodule), kept five minutes for each of at most 256 folders,
    and sends it with the hook (`andary_root`). A command then counts what lies in that work tree,
    and nothing outside it: a workspace of several repositories, sibling repositories and
    worktrees anywhere are told apart. A folder the command moves to inside it keeps it (but a
    worktree Claude Code made there, which is its own); a repository nested inside it (a
    submodule) is not told apart. Elsewhere (a `cd` out of it, a teammate's hooks, an older
    server, a folder in no repository) it is a guess, as before: a command with no pathspec takes
    in the crew's session folder (where it started) when that holds the folder the command runs
    in, else that folder, and also another agent's changes in the folder that agent worked in when
    the command runs inside it. One alert per command names every other agent with changes there,
    and how many files. The same command run again by the same agent in the same folder alerts
    again only for changes made after the last time: what it swept up was seen.
142. **Reading a command line.** It is read by `core/shell.js`, the reader every rule about what
    an agent ran goes through. It is split at `&&`, `||`, `;`, `|`, `&`, newlines and
    parentheses outside quotes; quotes, backslash escapes (a backtick in PowerShell, where a
    backslash is a path separator), comments, redirections and their targets (`2>&1`, `> log`),
    `$(…)` and here-document bodies are read as a shell would, so a commit message or a file
    written with `cat <<'EOF'` that mentions `git reset --hard` is not that command. A shell's
    `-c` script (`sh`, `bash`, `zsh`, `dash`, `ksh`; `bash -lc '…'` is how Codex sends commands)
    is read one level deep. `NAME=value`, shell keywords (`if`, `then`, `do`…) and wrappers with
    their own options (`sudo -u bob`, `env -i X=1`, `nice -n 10`, `timeout -k 5 30`, `nohup`,
    `time`, `command`, `exec`, `stdbuf`, `ionice`) before a command are skipped. `cd`, `chdir`,
    `pushd`/`popd` and PowerShell's `Set-Location`, `sl`, `Push-Location`, `Pop-Location` move the
    folder, and `env -C dir` (also `--chdir`) for its own command only; `cd "$(git rev-parse
    --show-toplevel)"` goes to the top of the work tree (141), and `…/src` after it on from there.
    Beside a folder on a drive, Git Bash's `/c/Users/…` is read as `C:/Users/…`. A `cd` to `~`,
    `-` or a variable leaves the folder unknown and the commands after it
    unjudged (an absolute `cd` places it again), and so do more than 64 moves on one line, which
    keeps a long line of `cd x;` cheap; so do more than 64 `git -C` on one call. A subshell's
    `cd` in parentheses is taken to last past the subshell; a `cd` inside a shell's `-c` script
    stays in that shell (`bash -c 'cd web' && git stash` stashes where the line started), as
    the shared reader has it. Only the first 20,000 characters are read.
143. **The desktop notification says only "Two agents in one folder" and the crew, by name and
    number.** "api-server (crew 2) may be undoing another agent's work." fits a Write over another
    agent's change and a git command about to run alike, names no file, command or other agent
    (it can show on a locked screen), and the number tells apart crews that share a project
    folder. The HUD shows the file or the command. An item's id is a notification's tag, so a
    hazard's id carries the file's path hashed, as a dialog's carries its input.
144. **A commit that went through takes its committer's changes out of harm's way.** When a
    command line holding a `git commit` ends without an error, the committer's changes it took in
    are forgotten: all of them in that work tree for `-a` or a whole-tree `git add`, else those
    under the paths named by the commit or the `git add` before it. They then count neither for
    git commands nor for another agent's Write. Only the committer's own are forgotten: another
    agent's changes swept into the same commit still count, so a later command may name them again
    (its alert for the commit already showed). A `git add` in one call and the `git commit` in a
    later one count as one: each agent's successful adds are kept until its next commit in that
    work tree that takes in what was staged (`git commit <path>` leaves the rest staged), at most
    16 for each of 200 agents, so Claude Code's usual `git commit -m "$(cat <<'EOF' …)"` after a
    `git add` both warns about another agent's work it sweeps up and takes the committer's own out.
    What was staged otherwise (by you, before the town opened, or unstaged again by `git reset` or
    `git restore --staged`, which are not followed) is not known. `git commit -a` leaves the
    committer's new files in harm's way: git does not track them yet (145).
145. **A file an agent made is untracked until a commit takes it in.** A Write that made the file
    (Claude Code reports `type: "create"`) or a Codex patch that adds one marks it new, and so it
    stays while agents change it again. `git clean` counts only such files; a stash without `-u`
    or `-a`, a checkout, a restore, a switch, `git reset --hard`, `git commit -a`, `git add -u` and
    `git commit <path>` only the others; `git add -A`, `.` or a path, and a stash with `-u`, both.
    A new file another agent committed still reads as new, so a later `git clean` may name it; a
    file made by a shell command is not seen at all (136).
146. **Pathspecs are read with git's magic, up to 64 a command.** `:/x` and `:(top)x` are from the
    top of the work tree. Exclusions (`:!x`, `:^x`, `:(exclude)x`) are left out: a command with
    only exclusions counts as one without pathspecs (the whole work tree; for `git clean`,
    `checkout` and `restore`, the folder it runs in), and one with paths and exclusions as the paths
    alone. `glob`, `icase` and `literal` are read off; a glob stands for its folder, and a path under
    `icase` is compared as written. The same path written twice counts once, and past 64 different
    ones a command counts as having none, so a long line costs no more than a short one: each
    remembered file is matched by its own folders.
147. **Hooks that arrive out of order are judged by their own times.** Hooks reach the town on
    their own, in the background, so a later one can arrive first. A change that arrives after
    another agent's newer change of the file is judged the other way round: an older edit arriving
    after a newer Write is that Write's alert. A change that arrives after a git command that
    started later than it was made counts for that command too, in its alert or in a new one: the
    last 50 commands are kept for half an hour (a refused one is dropped). Two changes at the same
    time are judged once, in the order they arrive. An agent's older change arriving late leaves
    its newer one standing.
148. **Away counts only what is surely you, and only counted work as your crews working.** You are a
     prompt, a `/compact` you ran (as "needs you" reads one, 89), a session you start, resume or
     clear (`SessionStart` with `source` `startup`, `resume` or `clear`) or leave (`SessionEnd` with
     `reason` `prompt_input_exit` or `clear`), a Codex turn you interrupted (its `Interrupt`, an
     interrupted Stop), a request allowed or denied in the town, and one answered in the terminal
     (resolved there, with proof that its tool ran or was denied). A request the agent moved on from
     (`stopped`), an expiry or a release is nobody's answer, and a Claude Code interrupt arrives as
     a failed tool, so none of them counts. "Crews kept working" means a local hook that adds to the
     catch-up's counts (154 to 158) arrived after you were last seen (the doctor's probe aside): an
     idle notification, an automatic compaction or a session ending on its own is not work. One turn
     that finished just after you left is enough, so coming back to it offers a catch-up too. Until
     you first do something, when the town started counts as when you were last seen.
149. **An absence begins at the 20-minute mark, on a timer.** Not only at your return, so a town
     left open on a second screen offers "Catch me up" before you type anything. Reading a long
     answer for 20 minutes without typing counts as away too: the offer is a quiet button, not a
     pop-up, and costs nothing to ignore.
150. **The offer stays 30 minutes after you come back, or until you look.** Like a finished turn
     (93), it would only be noise after that; `W` still works. When you last looked is kept per
     browser (151), so the offer goes once this browser has opened Catch me up since you left (in
     another tab, say); looking from your phone does not take it away on your computer. A button
     that was offered when the dialog opened stays while it is open, so focus can go back to it, and
     goes when it closes. Screen readers hear "Welcome back…" once per absence in each browser: the
     absence announced is kept (`andary:welcomed-back`), so a reload does not say it again, and with
     several tabs open each writes its claim there and only the tab whose claim is still there 150
     ms later says it.
151. **"Since you last looked" is the end of the last summary you saw, on the server's clock.** It
     is kept in this browser per town (`andary:caught-up`) and shared by its tabs, and only ever
     compared with the server's times. The offer's half hour is timed on the server's clock too: the
     page adds the difference between the clocks it measured at `hello` (`serverTime`, the network's
     delay ignored) to its own. You saw what happened before you left, so a period starts when you
     last looked or when you left, whichever is later. The first look ever starts when you left if
     the server knows of an absence, and otherwise covers everything it keeps: since it started, a
     day at most.
152. **Turns and rare things are counted to the moment; frequent ones by five minutes, and then
     everything is counted from there.** Turns, failures, permissions asked and answered, commits,
     pushes and stopped turns keep each one's time (the latest 200 of each kind per crew), and so do
     the latest test result, the latest turn's words and each changed file: a period counts exactly
     those since the time asked for, so a second look a moment after the first shows only what is
     new, or "Nothing new since you last looked". Tool calls and helpers are counted in five-minute
     buckets that know when they last counted something. When a bucket that began before the time
     asked for counted something since, the whole summary counts from that bucket's start, exact
     things too, so its counts are never mixed, and the period says so ("Since about 10:00 (you last
     looked 3m ago)."). The server never counts before it started nor more than a day back; when you
     ask for earlier, it answers from where it remembers and the dialog says so ("The town only
     remembers since 09:12 (it restarted)." or "…the last day."), and with nothing to show after a
     restart it says "No crew did anything since it restarted.". Hooks are timed by when they
     reached the server, so one that arrives late is never lost between two looks.
153. **Files changed are distinct files, kept per crew rather than per bucket.** A count per
     bucket would make a file edited ten times ten files, and a set of paths per bucket would cost
     far more memory. Each crew keeps up to 200 files (a short key of the path) with the time of
     their latest change, which is exact for any period that ends now, as every summary does.
     Files a shell command changes (`sed -i`, a formatter) cannot be known and are not counted.
154. **"Tests passing" or "failing" is the latest test run's, only when the command's exit status is
     that run's.** A `Bash` or `PowerShell` command line (or a Codex argument list, read as the line
     it stands for) is read by the shared reader (142): quoted strings, heredoc bodies, comments and
     redirections are text, a substitution stays whole inside its word (`echo $(git push)` runs no
     push), and a test runner counts only in command position: at the start of a command after `&&`,
     `||`, `;`, `&`, a pipe or a newline, behind `cd x &&`, assignments (`CI=1`), wrappers and
     launchers such as `env`, `time`, `timeout`, `npx`, `npm exec`, `uv run`, `poetry run`, `bundle
     exec` and `python -m` (core/shell.js lists them), or inside a shell's `-c` script, one level
     deep (`bash -c 'bash -c "npm test"'` runs no test the catch-up sees). Program names are
     compared in lower case. So `rg -n "vitest" package.json`, `npm install -D vitest`, `pip install
     pytest`, `cat jest.config.js` and `sed -n '1,80p' tox.ini` run no tests. The runners are the
     test runners (jest, vitest, mocha, ava, pytest, rspec, phpunit, tox, nox, `python -m
     unittest`), a package's `test` script (`npm test`, `pnpm run test:unit`), a tool's `test`
     subcommand (`go`, `cargo`, `deno`, `dotnet`, `mix`, `mvn`, `gradle`, `make`, `playwright`) and
     `node --test`. Only the last item of the line (after its last `;`, `&` or newline) sets its
     status, with no `||` in it; there every `&&` step must succeed, and a pipeline reports its last
     command, or any command after `set -o pipefail`. Tests passed when the command succeeded and
     every test run in it must have; they failed when it failed and a test run is the only thing
     whose failure could show (besides commands that do not fail in practice: `cd`, `export`, `set`,
     `echo`, `tail`, `head`, `tee` and a few more), with an error the town does not call a timeout.
     So `npm test 2>&1 | tail -20` gives no result (its status is tail's), `npm test && git push`
     passing is green tests but failing says nothing, and a timed-out run is no red tests. A test
     command that may run no tests gives no result either way: one that lists or collects them
     (`--list`, `--listTests`, `--list-…`, `-l`, a `list` argument, `--collect-only`, `--co`), only
     builds them (`--no-run`), explains itself (`--help`, `-h`, `--version`), may find no script
     (`--if-present`), or is `go test -run …`, which may select none and still pass. Other name
     filters (`-k`, `-t`, `--grep`, `--testNamePattern`) still run tests, and most runners fail when
     they match none, so they keep their result. A Codex command proves a result, a commit or a push
     only when Codex reported its exit code (the adapter marks it `andary_exit_known`; a hook cannot
     set any `andary_` field itself). The town's weather still reads a command by its strongest kind
     (core/summaries.js); the catch-up is stricter because it states a result. A command sent to the
     background has only started when its hook comes (its output is read later, by tools that do not
     name it), so it brings no test result, commit or push: "tests passing" is never a guess.
155. **A commit or a push is a `git commit` or `git push` that must have succeeded.** Read the same
     way (154): git in command position, after its own options (`git -C repo commit`, `git -c
     commit.gpgsign=false commit`, `--git-dir`, `--work-tree`…); not a dry run (`--dry-run`, or
     push's `-n`), not an amend (`--amend` rewrites the last commit), and not a push that deletes
     (`--delete`, `-d`, `:branch`) or that said "Everything up-to-date" (one less push for each time
     it says so); each one counts, so `git commit -m a && git commit -m b` is two. A commit before a
     `;` is not counted (it may have had nothing to commit while the line still succeeded), and
     `echo "… git push later"` or `grep -rn "git commit" docs/` is neither. Commits read as pushed
     ("1 commit pushed") only when a push came after the latest one; otherwise both are counted ("2
     commits, 1 push").
156. **Failed tool calls are counted; stopped turns keep their kind.** Agents fail and retry all
     the time, red tests have words of their own (the test result) and an interrupt is you, so a
     failed call only adds to a number. A stopped turn's kind (rate limit, overload, billing) says
     what to do, so it is named: "stopped (rate limited)". Auto mode's `PermissionDenied` is not a
     failure here.
157. **"Permissions asked" leaves out questions and plans.** `AskUserQuestion` and `ExitPlanMode`
     raise a PermissionRequest too, but they want an answer, not a permission, and "needs you"
     already shows any that wait. A request counts as answered when it is allowed or denied in the
     town, or when it ran or was denied in the terminal (its call's `PostToolUse`,
     `PostToolUseFailure` or `PermissionDenied`: the broker's `proof` `ran` or `denied`), also after
     it expired in the town. One resolved because the agent moved on (`proof: 'stopped'`: your
     prompt, the turn or the session ending) may have been abandoned, so it is not counted, and a
     turn or session ending after an expiry proves no answer either; neither does anything once the
     broker has forgotten the request (it keeps the latest 50 settled ones).
158. **A crew that only used tools still did something.** Its line says how many tool calls
     ("14 tool calls") when nothing else counted. A crew with nothing counted in the period is
     quiet; one that left town after doing something is still listed, by its folder.
159. **Bounded, and in memory only.** 100 crews (the one quiet for longest is forgotten), a day of
     five-minute buckets, 200 changed files and the latest 200 times of each rare count per crew,
     and one last message per crew, cut to 200 characters on one line; it, the crew's id, folder
     (1,000 characters at most) and title are copied, so the long strings they came from are not
     kept alive. Measured at the very worst (100 crews busy in every bucket of a day, every list
     full, a 2 KB message each turn): 8.7 MB. It holds your agents' last messages, which ADR 0006
     keeps off the disk, so a restart forgets it, as it forgets the history.
160. **Catch me up works in the demo.** The counting is a pure core module the demo shares, so `W`
     tells the story's crews; nobody is ever away in a demo, so it is never offered there, and
     what you looked at there is not kept.
161. **In a team town, Catch me up is the host's.** A viewer is told nothing of the host's absences
     and is told that only the host can catch up; teammates' crews are left out of the host's
     counts, and their prompts never count as the host being here.
162. **The open dialog follows "needs you", not the counts.** The crews that need you follow the
     town as it changes (answered elsewhere, the button goes, and focus stays on the same crew's
     line); the counts stay those the server gave when the dialog opened.
163. **`W` opens Catch me up, any time.** It is free in the page: no browser uses a bare `W`, and
     the 3D view's own keys are arrows, `+`/`-`, `Q`/`E`. Screen readers in browse mode keep
     letters for themselves, as they do for the town's other shortcuts; the masthead's button
     (while it is offered) and the help dialog's list of shortcuts lead there too.
164. **Plan limits come from a Claude Code mod, not a status-line bridge.** Mods (v2.1.287+) read
     `$.session.usage()` without touching the status line; a bridge would hide some of Claude
     Code's footer hints in every session and would have to run the user's own status line for
     them. Older Claude Code versions get no gauge (design §9).
165. **The mod is a second plugin of the same marketplace (`andary-limits@andary`).** A mod runs
     inside Claude Code with the user's rights, so it is opt-in: installing Andary (the plugin or
     `andary install`) never brings it. It has no settings hooks, so it works beside either and
     never sends an event twice. Its version follows the package's.
166. **The mod proves the server as the forwarder does, with HMAC built on SHA-256.** Read in Claude
     Code 2.1.330 itself: the hooks sandbox's `crypto.subtle` has `digest()` only (no `importKey`,
     `sign`, `verify`), plus `crypto.getRandomValues`. So the mod builds HMAC-SHA256 (RFC 2104) on
     `digest`, and the tests check it against the server's own `proveServer`. Running the
     forwarder through `$.process.run` was the alternative; it would need `node` on the PATH, a
     process per turn, and stdin, which `$.process.run` does not offer.
167. **Limits are sent with the hook secret, after the server's proof.** The same `server.json`
     (0600), the same challenge, the same secret, the same rate limit: a local web page cannot read
     the file, nor send the header without a preflight the server never answers. The server's
     answer is not signed: the mod takes no decision from it.
168. **The hook does not wait for Andary.** `$.http.fetch` cannot be cut short from a mod (no
     timers, no abort; Claude Code stops it after 30 s), so the hook starts the report and returns
     `next(e)` at once. Readings that come while one report is on its way make one more report,
     of the newest numbers. `$` may not be stored (Claude Code's static check refuses it), so
     that report reuses the `$` of the one in flight, which stays valid, as timers' `$` does.
169. **An account is a Claude config folder.** Limits belong to an account, and nothing a mod can
     read names the account in a documented way (`$.session.identity()` exists but is not in the
     reference). Two accounts on one computer almost always mean two `CLAUDE_CONFIG_DIR`s, so the
     server keys limits by a hash of the folder and labels them by its name; the path itself is
     not kept. No `CLAUDE_CONFIG_DIR`, or one that names `~/.claude` (the folder Claude Code uses
     without it), is one account, "default". Two other folders signed in to one account show
     twice; one folder that switches accounts shows the newest window's readings.
170. **A report without limits keeps the account's, and a lower one within a window does not
     replace a higher one.** Each session reports what it saw at its last answer, so a quiet
     session can report 40% after a busy one reported 60%; use only grows within a window, so the
     higher reading stands (with its own "as of") until a reading with a reset time an hour or
     more away starts a new window. A session before its first answer, or one
     on an API key, reports no limits; it must not wipe what another session of that account
     reported. Each limit keeps its own "as of", and disappears once its reset time passes (as in
     Claude Code).
171. **Limits are kept in memory only.** A restart forgets them until the next turn of any
     session (the mod reports after each turn); no file in `~/.andary` holds them
     (`limit-notes.json` keeps only which windows had their phone note, 182).
172. **The projection is the average pace since the window opened.** A window opens one length
     before it resets (5 hours, 7 days); pace = percent used ÷ time since it opened, as of the
     reading; run-out = when that pace reaches 100%. Shown only before the reset and after now,
     after the first tenth of the window (an early pace says little), and never for a spend
     limit, whose period is not reported. It needs no history, so it survives a reload; a burst
     of work late in a window shows as a faster pace only gradually.
173. **Gauge levels: warn from 75%, high from 90%.** 90% is the phone note's mark; 75% gives a
     warning colour before Claude Code's own warning at 85%. The colour is never alone: the
     button's name and the dialog say the percent.
174. **The Usage button shows the most used limit of any account.** The first limit to run out is
     the one that stops work. The dialog lists every limit, headed by the config folder's name
     when there are two accounts.
175. **Clock times are 24-hour, in this computer's time zone, in English.** "resets at 15:40",
     "tomorrow", a weekday within the week, else "28 Nov"; the phone note says the same, from the
     same shared module (`core/limits.js`, now shared with the server).
176. **The 90% phone note is opt-in (`--notify-limits`), once per window, per kind of limit.** Each
     kind has its own 30 s turn so the 5-hour and weekly notes never hold each other back; the
     hour's limit counts them. Reset times under an hour apart are one window (a window lasts five
     hours at least). It needs `--notify` or `--notify-url`, else the start fails with a message.
177. **The exact context the mod sends is kept, not shown yet.** The town's context reading
     (design §5, 125–132) comes from the transcripts, with no window and so no percentage; showing
     the mod's exact count and window beside it is more than a one-line hookup (which reading wins,
     how old each is), so it is left for later. The server keeps each session's newest exact count
     and window and sends it to owners, so that change only adds the display. Assumed: the id from
     `$.session.id()` is the hooks' `session_id`.
178. **The doctor reads limits from the hello.** It already connects as the owner for its round
     trip; a reading since the town started is "ok", an enabled mod with none is a warning, no
     mod is "ok (optional)" with how to add it.
179. **The demo makes up limits** (a 5-hour window whose pace runs out before it resets, a quiet
     week), so the hosted demo shows the gauge; the dialog says they are made up.
180. **The mod folder carries a `claude plugin test` file.** It runs the module in Claude Code's own
     engine (no session, no network); the repository's checks use node:test, which does not need
     Claude Code.
181. **Figures are rounded down, with one decimal from 99.** 89.5% reads "89% used" and the
     "warn" level, since the 90% note stays quiet for it; levels and the busiest limit go by the
     reported percent. "Used up" only at 100: 99.5% leaves something.
182. **The 90% note's windows survive a restart** (`limit-notes.json`, at most 64, windows that
     reset are dropped on load), and with two accounts or more the note names the account by its
     folder ("default folder" for the default one): a folder name is no project.
183. **The mod reports only to a town on this computer.** It uses server.json's `host` only when it
     is a loopback address, `localhost` or a wildcard (then 127.0.0.1). A town bound to a network
     address alone (`--host 192.168.…`) gets no limits; plan limits never leave the computer.
184. **The mod finds the town through Claude Code's own `ANDARY_HOME`, else `~/.andary`.** The
     forwarder can also look next to its installed copy; the mod has no such folder. Claude Code
     inherits `ANDARY_HOME` only from where it was started, so the README and `andary doctor` say
     to set it in the shell profile.
185. **A team viewer is not told to install the mod.** Limits are the host's and never reach a
     viewer; their Usage dialog says only the host sees them.
186. **"The town goes dark" was a blank canvas, not only a dim night.** The portal beam's top ring
     sits at y = 3.2000000477 in float32, so its vertex alpha was `Math.pow(negative, 1.4)` = NaN.
     In high quality (a MacBook's default) bloom blurred those NaN pixels over the whole HDR frame
     and the canvas came out empty, showing the page behind it (dark at night). It happened each
     time an agent arrived through the Town Hall portal, hence "sometimes". The beam is fixed, and
     every post pass now reads the frame through a NaN/Inf guard, so one bad pixel can never blank
     the town again. Low quality (phones, few cores) had no bloom and never showed it.
187. **Night has a floor.** Whatever the hour, look or weather, the hemisphere fill keeps a linear
     luminance of at least 0.2 and the full-night moon at least 0.42 (daynight.js `NIGHT_FLOOR`,
     applied after the weather); exposure rises from 1.1 by day to 1.3 at night; night fog keeps
     half its grey and is up to 40% thinner; at most 40% of windows go dark in the small hours.
     The sky, stars, lit windows and lamps still read as night.
188. **A brightness guard reads the finished frame every 4 s** (seven 8×8 patches in the middle,
     where the town is) and lifts the exposure up to 1.8× when their mean sRGB luma is below 62,
     easing back once bright. It skips lightning flashes and only judges settled frames. It should
     stay idle with the floor in place; it covers what nobody foresaw (a blank reflection map,
     a driver). One small read stall per 4 s fits the phone's frame budget.
189. **A lost WebGL context (a Mac waking from sleep, a GPU switch) pauses the town** and, once the
     browser restores it, redraws the reflection map, which lived only on the GPU; before, the town
     came back without its reflections. If the browser never restores it, the page has to reload.
190. **The e2e night check measures a screenshot, not the WebGL buffer**: the mean sRGB luma of the
     middle half of the town view at 23:00 in Asia/Amman must stay ≥ 45 in a night storm with
     portal arrivals and in thick fog at 02:00 (healthy: 70–95; blank canvas: ~17). Desktop forces
     high quality, as a MacBook picks, since test machines with few cores would pick low.

## Notes to agents and Deny and stop (feat/agent-notes)

191. **A note arrives at the agent's next step, not at once.** Andary's hooks run in the
     background (`async: true`); Claude Code delivers an async hook's `additionalContext` "on the
     next conversation turn", as context the terminal does not show (hooks reference, "How async
     hooks execute"). In practice that is the next model call after the hook that carried it
     finished: after the agent's next tool call, or with your next prompt. An idle session reads it
     only once you type. The town says "sent with its <hook> hook", never "read".
192. **The hooks that carry notes** are PreToolUse, PostToolUse, PostToolUseFailure and
     UserPromptSubmit for Claude Code, and PreToolUse, PostToolUse and UserPromptSubmit for Codex
     (whose docs list `additionalContext` for those). Not SessionStart (Claude Code skips repeated
     async SessionStart text), not Stop or SubagentStop (their context keeps a turn going), not
     PermissionRequest (a decision only). Claude Code honoured this from an async hook in 2.1.330.
193. **Codex documents it; helpers are not verified.** Codex's hooks docs say a background hook's
     output is added at the next safe point, waits for the next turn when none is active, and is
     dropped when the session ends; the inspector says that for a Codex agent. It was not tried
     with a live Codex here. A note for a helper (subagent) is sent with that helper's own hooks;
     whether Claude Code gives a subagent's async hook output to that subagent, or to the lead,
     was not tested. The inspector says so.
194. **"Delivered" means sent in the reply** ("sent with its <hook> hook" in the town): nothing
     confirms the agent read it. The server takes notes out of the queue for a reply and puts them
     back when the forwarder is gone: its socket ended or closed by the time the server has polled
     it once more after the request (two event-loop turns), or the response closed before it
     finished. A forwarder that gives up after that point, in the instant the reply is written,
     still loses its notes, as does a `-p` run that ends before Claude Code delivers async output;
     the owner can send it again.
195. **The sender's name is the forwarder's user name** (`os.userInfo().username`, letters, digits,
     `.`, `_`, `-`, at most 40; otherwise "the owner"). Only the owner can send notes, and only to
     agents of this computer, so the user running the forwarder is the person who wrote the note.
     The server sends no name, so a reply cannot claim another sender.
196. **Bounds.** 2,000 characters a note (refused, never cut), 5 waiting per agent, 100 waiting in
     all, 4 per hook reply, 30 minutes before a note expires (checked every 15 s and when a hook
     comes), notes expire when the session ends or the helper finishes (SubagentStop). 12 notes a
     minute with bursts of 5, counted only for notes that would be queued.
197. **Line breaks are kept** in a note (it is the owner's own text; U+2028 and U+2029 become line
     breaks), while controls, format characters (bidirectional overrides, zero-width characters),
     variation selectors, the Hangul fillers and lone surrogates are removed
     and blank lines collapsed. The server and the forwarder clean a note the same way
     (`noteText`, one table through both).
198. **Notes are not shown in the demo**: the simulation has no agent to reach. The note field is
     hidden there.
199. **Deny and stop is Claude Code only.** Claude Code's PermissionRequest deny takes
     `interrupt: true` ("stops Claude"); Codex reserves `interrupt` and "fails closed today", so a
     Codex card offers Deny only and says why, the server refuses a stop for it, and the forwarder
     never prints the flag when run as Codex. A forwarder that does not declare `interrupt` (an
     older copy) would drop the flag, so its cards say to update instead.
200. **Deny and stop needs no confirmation.** It is labelled and explained on the card, placed on
     its own row under Deny with its line first (a tap that falls short of Deny lands on words),
     and waits out the card's one-second click delay like Allow and Deny. Stopping is not
     destructive: the agent waits for you in the terminal.
201. **Follow-up: the cross-session inbox socket.** Claude Code 2.1.224 and later expose
     `CLAUDE_CODE_MESSAGING_SOCKET` (cross-session messaging), which could put a note between tool
     calls or start a turn in an idle session. Its message format was not tested, so it is not
     built; a later change can deliver notes through it when it is known, falling back to hooks.
202. **The note's header is factual.** The Claude Code hooks docs warn that context framed as an
     out-of-band system command can trigger Claude's prompt-injection defences: Claude then shows
     it to the user instead of acting on it. The header says plainly what the text is: "The user
     (<name>) sent you this message from Andary while you work:". Whether Claude acts on a note,
     or asks in the terminal first, was not tested with a live Claude Code here; the README says an
     agent may ask you to confirm.
203. **The browser keeps a note's text until the server answers.** Each note carries a `ref` of the
     browser's own; the server answers only that browser with `note-reply` (queued or refused, with
     the reason), so a refused note is never lost. Without an answer in 10 s the field is given
     back and says the note may not have been sent.
204. **Four notes always fit.** Claude Code keeps at most 10,000 characters of `additionalContext`;
     four notes of 2,000 characters with their headers (a 40-character name) come to about 8,400.
## Turn receipts (2026-11-22)

205. **A turn's work is the crew's.** Helpers' files, failures and tests count for their lead's turn
     (they work for it); agent-team teammates have turns of their own and are left out.
206. **An edit is a file tool's change or a shell command that may change files.** "Tests not
## Team town on the internet (`--tunnel`, ADR 0019)

207. **cloudflared keeps the visitor's Host.** A Quick Tunnel forwards requests with
     `Host: <words>.trycloudflare.com` (cloudflared's default when no `httpHostHeader` is set),
     and browsers send `Origin: https://<words>.trycloudflare.com`. The tunnel port accepts only
     that name (bare or `:443`). Not checked against the live service: the sandbox could not
     reach Cloudflare (see the PR notes); the address parsing was checked against the output of
     cloudflared 2026.11.1.
208. **Cloudflare's headers mark the internet.** Cloudflare's edge adds `Cf-Connecting-IP` and
     `Cf-Ray` to every request it forwards, and a client cannot remove them. Any request with
     them (or `Cf-Visitor`, `Cf-IPCountry`, `CDN-Loop: cloudflare`) is tunnelled on every port.
     `X-Forwarded-For` is not a marker: other local proxies add it, and a request with it but
     none of Cloudflare's headers is not Cloudflare's.
209. **The static app stays open through the tunnel.** It is the public code (the same as the
     hosted demo) and holds no data; everything with data needs the view token or a member key.
     Requiring a token for the page itself would need a cookie, which ADR 0015 ruled out.
210. **Rate limits are the network's.** Member keys keep their token bucket and the 4-upload cap,
     viewers their connection cap and message limit; tokens are 256-bit (view and keys 192-bit),
     so there is no guessing to slow down, and Cloudflare allows 200 requests in flight.
211. **The town binds 127.0.0.1 with `--tunnel`.** Teammates come through the tunnel, so the
     town is not also put on the LAN; `--host 0.0.0.0` puts it back for people nearby.
212. **cloudflared runs with Andary's environment minus `ANDARY_*`,** so a team key or an ntfy
     topic in the environment stays with Andary; `--no-autoupdate` keeps it from restarting
     itself under the town.
213. **The 30 s limit for the address** covers a slow edge; past it the town stops and the start
     fails (exit 1), rather than run with no address. A tunnel that ends later is logged, marked
     down in `server.json`, and reported by the doctor; it is not restarted (a restart is a new
     address, which the invitees would not know).
214. **`--tunnel-allowed-mail` is checked against `cloudflared tunnel --help`,** which lists
     `--allowed-mail` from 2026.9.3 on, instead of parsing version numbers. Cloudflare's guide
     says email sign-in needs an interactive browser, so a teammate's Andary cannot pass it; the
     CLI says that with this flag teammates can watch, not share.
215. **The doctor does not connect to the tunnel.** It reads `server.json` and checks that
     cloudflared's pid is alive: reaching the public address would be a network call from the
     doctor to Cloudflare, and a failure there says little about the town.
216. **The watchdog is a Node process, not a signal trick.** Linux's "die with the parent" needs a
     native call Node does not offer, and macOS and Windows have none. A pipe the town holds
     closes on any death, `kill -9` included, so the watchdog that reads it stops cloudflared the
     same way everywhere. If the watchdog itself is killed with SIGKILL, the next start or doctor
     catches the cloudflared left behind.
217. **A cloudflared left behind is stopped only after its command line is checked.** It must name
     `cloudflared` and `http://127.0.0.1:<the recorded port>`, and the town in `server.json` must
     be gone. A pid that may have been reused by another program, or a command line that cannot
     be read, gets a warning naming the pid, never a signal.
218. **Other cloudflared configuration folders are refused, not overridden.** Pointing `--config`
     at an empty file might also stop a Quick Tunnel, which was not tested live. Refusing a
     `config.yml` in any folder cloudflared reads (and `TUNNEL_*` variables, which it reads as
     flags) keeps the tunnel to the flags Andary passes.
## Turn receipts (2026-11-22)

219. **A turn's work is the crew's.** Helpers' files, failures and tests count for their lead's turn
     (they work for it); agent-team teammates have turns of their own and are left out.
220. **An edit is a file tool's change or a shell command that may change files.** "Tests not
     re-run since the last edit" compares the last test run's start with the last Edit, MultiEdit,
     Write, NotebookEdit, Codex patch, or shell command that `changesFiles` (the stuck rules' reader)
     says may change files: `sed -i`, heredocs, formatters, installs. git's bookkeeping, test runs and
     builds are not edits (a commit or a report file changes no source). The town cannot tell which
     files a shell edit touched, so the receipt says "may have changed" and names none.
221. **Lines from the hook's own text.** Added and removed lines per hunk are what is left once the
     lines both texts start and end with are set aside: exact for a typical Edit, approximate for a
     hunk that moves lines around. Text longer than the town keeps marks the counts "≥". A Write
     over an existing file has no "removed": the hook does not carry the old content.
222. **A build** is a package's `build`/`build:…` script, `tsc`, a `build` subcommand of the common
     tools, `make` with no target (or `all`/`build`) and `python -m build`, in `core/shell.js` beside
     `isTestRun`. `runsNoTests` moved there from the digest, so both read tests the same way.
223. **A turn's cost is a difference of running totals.** Usage arrives after the hooks, so the
     receipt of a crew's latest turn takes new usage until your next prompt; usage that arrives
     later counts for the next turn. With no reading from before the turn (and no fresh session
     start seen), the cost is left out rather than guessed.
224. **A Stop hook that keeps the turn going is the same turn.** Work between a Stop and a Stop with
     `stop_hook_active` joins the receipt of the turn before; a Stop without it after work with no
     prompt is a new turn that started before the town saw it ("at least").
225. **A receipt's log line is written again when a Stop hook updates it**, with the newer words;
     the inspector shows the latest.
226. **Another crew's edits are judged by folder.** An edit by another crew inside this crew's
     session folder while its turn is open is reported, naming no file: the receipt cannot prove
     which of its files it touched. A teammate's crew in a team town works on another computer and
     is left out.
227. **A test run "selects" tests** when a name filter or a test file or folder is on its line; a pass
228. **Lines from the hook's own text.** Added and removed lines per hunk are what is left once the
     lines both texts start and end with are set aside: exact for a typical Edit, approximate for a
     hunk that moves lines around. Text longer than the town keeps marks the counts "≥". A Write
     over an existing file has no "removed": the hook does not carry the old content.
229. **A build** is a package's `build`/`build:…` script, `tsc`, a `build` subcommand of the common
     tools, `make` with no target (or `all`/`build`) and `python -m build`, in `core/shell.js` beside
     `isTestRun`. `runsNoTests` moved there from the digest, so both read tests the same way.
230. **A turn's cost is a difference of running totals.** Usage arrives after the hooks, so the
     receipt of a crew's latest turn takes new usage until your next prompt; usage that arrives
     later counts for the next turn. With no reading from before the turn (and no fresh session
     start seen), the cost is left out rather than guessed.
231. **A Stop hook that keeps the turn going is the same turn.** Work between a Stop and a Stop with
     `stop_hook_active` joins the receipt of the turn before; a Stop without it after work with no
     prompt is a new turn that started before the town saw it ("at least").
232. **A receipt's log line is written again when a Stop hook updates it**, with the newer words;
     the inspector shows the latest.
233. **Another crew's edits are judged by folder.** An edit by another crew inside this crew's
     session folder while its turn is open is reported, naming no file: the receipt cannot prove
     which of its files it touched. A teammate's crew in a team town works on another computer and
     is left out.
234. **A test run "selects" tests** when a name filter or a test file or folder is on its line; a pass
     then reads "selected tests passed", as the rest may not have run.

## People of a team town and walking (feat/org-people, feat/org-walk)

230. **The town grew south by six rows (26 × 26 → 26 × 32 tiles, +23 %), not west.** The owner asked
     for a modestly bigger, livelier town; the org-town design had squeezed the six homes onto the
     west strip, facing east. A quarter of their own south of the ring road keeps every door facing
     south (the default camera sees them all, as before, so no east-facing exception is needed) and
     sits nearest the camera. Tile (13, 13)'s corner stays the world's origin, so every older
     building, route, lamp and vehicle path keeps its coordinates; the plinth, the shadow box and the
     camera's framing (depth 66 → 78, home 1.5 m further south) grew to fit.
231. **The quarter's plan:** six 2 × 2 home plots (`h`) on row 24–25 with a garden column (`g`)
     between neighbours, Home Street on row 26 joined to the west and east ring roads, and a park
     (`k` lawns, a paved `P` square, an `f` fountain) on rows 27–30, with a row of trees at the
     front edge. Each home's door tile is the west half of its plot's street frontage.
232. **Park life is cheap and quiet:** a dog trotting round the square, five pigeons pecking by the
     fountain, two kites over the east lawn only in clear or rainbow weather by day, and balloons
     tied to the food cart (static). Three small meshes, nothing allocated per frame; reduced motion
     sits the dog down and holds the pigeons and kites still. The gardens, mailboxes, benches, cart,
     lamps and fountain stone are in the town batch.
233. **An unowned home is a plain cottage in the town's own look**, door in wood, no flag, no name
     plate and dark windows, so a town without a team still looks lived in. All six homes are one
     mesh, rebuilt when one changes.
234. **A member key now needs its name on the roster (`people.json`).** The design asks for
     `team remove` to revoke one person; that needs both checks to look the name up. A team that
     invited people before this change runs `andary team invite <name>` once more for each: the key
     printed is the same, so their relays keep working with no change on their side.
235. **The host is named "Host" until `--name` says otherwise**, never the computer's user name (it
     shows on a name plate to everyone). A later `--name` renames the host's entry and keeps its home,
     colour and profile; a name a teammate already has is refused at start.
236. **The roster file is shared by the CLI and the running host under a lock.** `team invite`,
     `team remove` and the host's profile saves each read, change and write people.json while
     holding `people.lock` (an exclusive create, retried every 20 ms for up to 2 s; a lock older
     than 5 s is taken to be left by a process that died). The host also re-reads the file every 2 s
     and before every key or link check, and announces any change it sees once (a microtask), so a
     key check that notices a removal first still closes the removed person's town.
237. **A teammate never takes the host's home.** Before the host has started once, five invites fill
     the roster; the sixth place is the host's.
238. **Every profile key is required, not only known ones.** "Unknown keys rejected" is read as an
     exact key set: a profile missing a field is as malformed as one with an extra, and the browser
     always sends whole profiles.
239. **A colour asked for and taken goes to the next free one in order, wrapping round,** and a
     person's own colour counts as free to them. The browser greys out colours others hold in the
     "You" dialog (with whose they are), so this mostly happens when two people save at once.
240. **The palettes are fixed in `core/profile.js`:** 8 skin tones, 9 hair colours (black to teal),
     10 cloth colours, each named for screen readers; `'theme'` tops wear the person's colour.
     Indices, not hex, cross the wire, so a later palette tweak changes everyone's look the same way.
241. **The preview in the "You" dialog is a flat SVG drawing, not the 3D figure.** The HUD may not
     reach into the 3D world (layer rules), a second WebGL renderer would cost a phone its frame
     budget, and SVG works where WebGL does not. It is drawn from the same profile and palettes.
242. **In PR 1 a person stands on their porch while online and is not drawn while offline**; the
     60 s porch and 10 min inside timers, walking, and lights from a relay that posted in the last
     2 min come with presence (PR 2). Lights are on while any browser plays the person (the owner's
     browser plays the host).
243. **The owner may save the host's profile too** (`{t:'profile'}` from the owner's browser), since
     the host is a person of the town like the others.
244. **A person counts as view-only in the HUD** (no Needs you for others' prompts, no plan limits,
     no catch-up, no remote approvals or phone settings), exactly like a viewer, besides their own
     character.
245. **Each person may hold 2 connections, and people may use the 4 connections kept for the
     owner**; viewers still cannot. The design lists this under PR 2's abuse cover; it is a few
     lines and closes a way for one link to fill the town, so it came now.
246. **The demo is a small team town:** "You" (the host, slot 0, cobalt, the coast cottage) and Lina
     (slot 1, raspberry, a desert house: curly hair, round eyes, glasses, a hoodie, headphones), both
     online, so it shows two lit homes and two people. The "You" dialog works in the demo and keeps
     your look in this browser; a saved look asking for Lina's colour starts on the next free one.
     Every local crew is yours, so the demo's own crews now share your colour, told apart by number.
247. **A home's door tile is the west half of its plot's frontage**, and a person stands on the
     street side of it, facing south. Home Street has no traffic, so nobody stands in a lane.
248. **The frame budget is checked with `world-lab.html?scenario=people&quality=low` at 390 × 844**:
     six people at home plus 24 helpers walking about (30 figures), every home lived in. This
     container renders with SwiftShader on the CPU, so its frames per second say nothing about a
     phone; what it does show is that the quarter adds 6 to 7 draw calls to the same 20-figure crowd
     (44 → 49–50: the homes, the park's pool, dog, pigeons and two kites; its gardens, lamps and
     props are in the town batch) and the same frame rate as `main` there, so the 30 fps target on a
     phone is as near as it was. A person costs one figure geometry and one draw call like any
     helper.
249. **A nonce per person makes a removal final.** Keys and links are HMACs of the name and a
     random 16-character nonce kept in people.json; inviting someone already on the roster keeps
     it (the same lines print again), inviting them after a removal makes a new one. People from
     before nonces have an empty one, which signs exactly as before.
250. **The host is told which old keys it refuses**, once per name, and a member's relay words a 401
     as "key refused by the host", so a team upgrading from a town without rosters is not left
     guessing (README "Upgrading").
251. **With no `--name` and a teammate called "Host", the host becomes "Host 2"** (then 3…), with a
     line in the log, rather than refusing to start.
252. **The creator has no dropdowns.** Every choice is a radio group of picture tiles (the option
     drawn on the character and cropped to the part it changes; colours as round chips), with a
     legend that names the current choice, in six tabbed sections (Body, Hair, Face, Clothes,
     Accessories, Home and names). Only the open section's tiles are drawn, so a change redraws at
     most a few dozen small SVGs. The two names are text fields, the only typed input.
253. **Profile v1 grew in place** (nothing was released): 25 look fields, the two names, and a cap
     of 1,152 bytes (was 512): the longest look takes 526 bytes, and two names of 20 four-byte
     letters with two three-byte marks each take 400 more (926 measured, test-checked). The
     palettes grew to 12 skins, 12 hair colours and 12 cloth colours; `face` became `facialHair`,
     `glasses` and `cheeks`. Each tile, the preview and the 3D figure use the same palettes and the
     same shading (`mix` towards white or black), so a cap or a beanie's pompom looks alike in both.
254. **"Detailed" is modelled, not textured.** Patterns, seams, collars, hoods and glasses are small
     shapes in the person's one figure geometry, coloured per vertex: no texture or atlas, nothing
     new to load, still one draw call per person. A pet walks at the person's heel on the body
     bone (it moves with them, it does not wander), a bird sits on the shoulder.
255. **Undo goes back through the last 30 changes of this opening of the dialog**; outfits replace
     only clothes and accessories, keeping the person's body, hair and face.
256. **The agents' name numbers a crew's helpers in the order they joined**, in each crew
     separately ("Pixel 1" may be in two crews, told apart by crew number), and a lead takes the
     name alone until PR 3 lets the person's character play their lead. Teammates of an agent team
     take it too. Log lines written before a rename keep the name they had.
257. **A name that could pass for another person's is refused by the host**, for both the
     character's name and the agents' name: equal to another person's roster, character or agents'
     name after NFKC, case folding, dropping marks and separators, and folding Cyrillic and Greek
     look-alikes (a small fixed table, not the whole Unicode confusables list), or to one of those
     with a number added; also the town's own words (You, Host, Foreman, Scout, Builder, Lead,
     Andary) with or without a number. The demo applies the same rule. Up to two combining marks
     per letter are kept (Vietnamese, Devanagari), more are dropped; marks do not count towards 20.

258. **A new walk carries on from where the figure is.** Mid-step it first finishes the step it is
     on and the walk's start time is set back by the part already walked, so every screen sees
     the figure turn rather than jump back to the tile it was leaving. Keys step from the tile
     being entered, so a held key never walks back.
259. **A held key repeats at most four times a second; a different key goes at once.** The walk
     itself moves 2.2 tiles a second, so a held key keeps a step ahead of the figure rather than
     piling up walks; the host's own 250 ms limit (latest wins) is the backstop.
260. **Walk mode zooms the camera in (2.2×) and follows your character**; under reduced motion
     the follow cuts instead of easing. Turning walk mode off stops the follow and leaves the
     view where it is. Each walk asks the director camera to stand back, as a pan does.
261. **The "Walk to…" list offers teammates who are out, by where they are going**, not a live
     follow (following or teleporting to a teammate stays out, as the design says). Homes are
     listed by whose they are; empty plots are not offered.
262. **The live region speaks once per walk**: "Walking to …" for a walk longer than one step and
     "You are at …" on arrival (a door, a home, or "the street"), not every tile. A teammate's
     emote or phrase is read out by name ("Lina: Wave").
263. **On a phone the step pad shows in walk mode** (Settings can hide it), the emotes fold into
     the phrases' disclosure so the panel leaves the town in view, and walk mode folds the board's
     sheet away.
264. **"Come look" asks about the current selection** (an agent or a building), from the Walk
     panel; the note's Go selects it (and so moves the camera), Not now and the close button only
     dismiss it. Notes can be turned off in Settings; asks are still rate limited on the host.
     In the demo the ask is accepted but Lina does not answer.
265. **"Show me as away" and walking up to an agent to open it** (design §2 and §6) are not in this
     pull request: online status follows connections only, and an agent opens by click or from the
     crews board as before.
266. **Only notifications that need the person block their walking**: `permission_prompt`,
     `elicitation_dialog` (and a question). Claude Code's `idle_prompt`, a minute after Stop, is
     not a reason to keep a character at work. A duty lapses to free after 10 minutes with no
     event from that person (their relay going quiet counts), so a lost Stop cannot pin them.
267. **"Come look" at an agent names one the host has seen**: the host remembers the newest 2,000
     agent keys from the town's events, so a look never carries an invented key to a teammate.
268. **Six detailed people on a phone, measured**: world-lab `?scenario=people&quality=low` at
     390×844 (×3) draws six people in their most detailed looks (pet, hat, glasses, striped top,
     backpack, cup, beard, earrings) plus 24 helpers in 55–57 draw calls, one per figure as
     before. Frame rate is not meaningful under the software renderer here; on a phone it is
     bound by those draw calls, unchanged from PR 1's 58–60.
