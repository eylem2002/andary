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
    It is the newest message's input, cache writes and cache reads, as Claude Code's status line
    counts it. Today's default models run a 1M window with no `[1m]` in the model id and the user
    can move the compaction point, so the window cannot be told from what Andary sees: a percentage
    would be a guess. `/context` in Claude Code gives the whole picture; a percentage waits for
    exact numbers from the status line (design §9).
126. **The newest reading is the last message read from the agent's own transcript.** Lines are
    written in order, so file order is time order; timestamps are not compared, since a clock
    change could reorder them. A helper's transcript gives the helper's reading. A line marked
    `isSidechain` in a lead's transcript (older Claude Code wrote helpers' messages there) is not
    the lead's, and a message that read no tokens is no reading. A resumed session's copy of an
    earlier message gives that session's reading though its usage is not counted again (the
    resumed conversation holds it); a record with a reading and nothing counted shows no cost,
    rather than "0 tokens".
127. **A compaction makes the context unknown until the next message, cut at the hook's start
    time.** `PreCompact`, `PostCompact` and `SessionStart` with `source: "compact"` drop the
    reading at once. The transcript is read a moment after a hook, so a message written before the
    compaction may still be waiting: messages written before the latest compaction hook started
    give no reading (their usage still counts). Both times come from this computer's clock (the
    forwarder's start time, Claude Code's timestamps). The first message after a compaction comes
    an API round trip after `PostCompact`; should a hook start later than it, that one reading is
    skipped and the next message brings one. A `compact_boundary` line in the transcript drops the
    reading too, for setups without those hooks.
128. **A reading that no longer holds is hidden, not labelled.** A finished helper's or an ended
    crew's last reading describes a context that is gone, and a crew line has no room for
    "(old)". A lead that finished its turn keeps its reading: its conversation is still there, and
    that is when the number helps most, before the next prompt. The browser does not judge
    compactions itself: the server and the demo drop the reading at the compaction hook, before the
    town shows it. "Read 2m ago" is when the message was written; Andary reads it about a second
    after the hook that follows it.
129. **No context for Codex.** Andary reads no Codex usage yet (65), so there is nothing to count.
    When its rollouts are read, the sum needs its own check: OpenAI's usage counts cached input
    inside the input tokens, Claude's counts it apart.
130. **After a restart, the context shows again with the next message.** Readings are not kept in
    `usage.json`, like agent totals, and the tracker reads each transcript only from where it
    stopped, so it does not see the last message again.
131. **The crew line shows the context on its own line under the model.** "Opus 5.5 · 182k in
    context" on one line would take room from the crew's name in a 268–320 px panel.
132. **The demo's context is made up apart from its costs.** It starts at 18k (system prompt and
    tools), grows by 0.6k–3.6k a step, starts again at 26k after a compaction, and stops at 950k: a
    demo crew can go a long time without compacting, and Claude Code would compact before a 1M
    window filled. The demo's costs are unchanged.
