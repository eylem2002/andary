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
22. **Characters.** Figures are drawn 1.3× life size so they read next to doors and lamp posts;
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
28. **No hosted demo.** The brief says not to create cloud resources, so the demo was not
    published anywhere. `public/` runs the demo on any static host if you want one (for example
    GitHub Pages, free for public repositories).
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
