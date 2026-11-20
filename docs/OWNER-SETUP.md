# What the owner must set up

Andary costs nothing: no accounts beyond your existing GitHub, no billing, no cloud resources,
no paid services. These are the only steps that need you, in order.

## 1. Publish the code to `eylem2002/andary`

The repository exists but is still empty: this session could read it but GitHub refused its
pushes (the Claude GitHub App has no access to it). Pick one:

**A. Publish from your computer (works now).** You need git, Node.js 22+ and the GitHub CLI.

```sh
gh auth login                          # once: GitHub.com, HTTPS
git clone andary.bundle andary         # the bundle delivered with this work
cd andary
scripts/publish-github.sh              # secrets scan → push all branches → stacked PRs → public
```

The script stops before pushing anything if it finds a possible secret. It pushes `main` (an
empty first commit) and the 11 feature branches, opens the 11 pull requests in merge order, scans
again, and only then makes the repository public. `KEEP_PRIVATE=1 scripts/publish-github.sh`
keeps it private. It never merges anything.

**B. Let Claude push.** Open https://github.com/apps/claude/installations/select_target,
choose your account → **Configure** → *Repository access* → add **andary** → **Save**. (If you see
no installation, reconnect GitHub at
https://claude.ai/customize/connectors?auth_start=github&auth_start_force=1.) Then ask Claude to
push the branches and open the pull requests.

## 2. Review and merge the pull requests, in order

They are stacked: each targets the one before it (order in `docs/prs/ORDER.md`). Merge from part
1 to part 11. After each merge GitHub retargets the next pull request to `main`. Nothing is merged
until you decide.

## 3. Optional repository settings (free)

- **Settings → Branches → Add rule** for `main`: require a pull request and the `CI` checks.
- **Settings → Code security**: turn on Dependabot alerts and security updates (the update
  schedule is already in `.github/dependabot.yml`).
- **Settings → Pages**, only if you want the demo online: deploy from a branch, folder `public/`.
  Without a server the page runs the built-in demo. Not done for you: the brief said no cloud
  resources.

## 4. Use it

Needs Node.js 20+ (22 LTS recommended) and Claude Code. From the clone:

```sh
node bin/andary.mjs install     # adds hooks to ~/.claude/settings.json (a backup is made)
node bin/andary.mjs start       # opens the town; then run `claude` in any project
```

Once the pull requests are merged into `main`, anyone can install the command directly:
`npm install -g github:eylem2002/andary`, then `andary install` and `andary start`.
`andary uninstall` removes exactly the hooks Andary added. To see agent-team teammates, enable
Claude Code's experimental teams: `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`.

Before relying on remote approvals, read "Remaining risks" in `docs/FINAL-REPORT.md`.

## 5. For development

```sh
npm ci                                  # dev tools only; the app has no runtime dependencies
npx playwright install chromium         # browser for the end-to-end tests
npm run hooks:install                   # fast checks before every git push
npm run check                           # everything: audit, lint, types, dead code, tests, e2e, a11y
```
