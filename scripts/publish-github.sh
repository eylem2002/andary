#!/usr/bin/env bash
# Publishes this repository to GitHub exactly as the owner's brief requires:
#   1. scans the working tree and the full git history for secrets (stops if anything is found),
#   2. creates the repository (private first) with description and topics,
#   3. pushes main (empty root commit) and every feature branch,
#   4. opens one pull request per branch, stacked in order, with the prepared descriptions,
#   5. re-scans, then makes the repository public.
# Requirements: git, Node >= 22, the GitHub CLI logged in (`gh auth login`).
# Usage: scripts/publish-github.sh [owner/name]        (default: eylem2002/andary)
# Set KEEP_PRIVATE=1 to skip step 5. Nothing is ever merged.
set -euo pipefail

REPO="${1:-eylem2002/andary}"
DESCRIPTION="A living 3D town where your Claude Code and Codex sessions, subagents and agent teams work as tiny characters, live through hooks."
TOPICS="claude-code,claude,codex,ai-agents,multi-agent,hooks,visualization,threejs,developer-tools,observability"

cd "$(dirname "$0")/.."
command -v gh >/dev/null || { echo "Install the GitHub CLI first: https://cli.github.com"; exit 1; }
gh auth status >/dev/null 2>&1 || { echo "Run 'gh auth login' first."; exit 1; }

echo "1/5 Scanning the working tree and full history for secrets…"
if ! node scripts/scan-secrets.mjs; then
  echo "Possible secrets found. Stopping before anything is pushed. Review the findings above."
  exit 1
fi

# Branches in merge order; each PR targets the branch before it (see docs/adr/0010-git-workflow.md).
# The backticks are literal Markdown code marks in ORDER.md, not command substitution.
# shellcheck disable=SC2016
mapfile -t BRANCHES < <(sed -n 's/^- `\([^`]*\)`.*/\1/p' docs/prs/ORDER.md)
[ "${#BRANCHES[@]}" -gt 0 ] || { echo "docs/prs/ORDER.md lists no branches"; exit 1; }

# Each pull request needs its prepared description; check them all before anything is pushed, so a
# missing one cannot leave the repository half published.
pr_body() { printf 'docs/prs/%02d-%s.md' "$(($1 + 1))" "${BRANCHES[$1]//\//-}"; }
for i in "${!BRANCHES[@]}"; do
  [ -f "$(pr_body "$i")" ] || { echo "Missing pull request description: $(pr_body "$i")"; exit 1; }
done

echo "2/5 Creating $REPO (private for now)…"
if ! gh repo view "$REPO" >/dev/null 2>&1; then
  gh repo create "$REPO" --private --description "$DESCRIPTION" --disable-wiki
fi
gh repo edit "$REPO" --add-topic "$TOPICS" --description "$DESCRIPTION"

# A clone of the delivered bundle has `origin` pointing at the bundle file and only one local
# branch: point origin at GitHub and recreate the other branches from their remote-tracking refs.
url="https://github.com/$REPO.git"
if ! git remote get-url origin >/dev/null 2>&1; then
  git remote add origin "$url"
elif [ "$(git remote get-url origin)" != "$url" ]; then
  echo "Pointing origin at $url (was $(git remote get-url origin))"
  git remote set-url origin "$url"
fi
for branch in main "${BRANCHES[@]}"; do
  git rev-parse --verify --quiet "refs/heads/$branch" >/dev/null && continue
  git rev-parse --verify --quiet "refs/remotes/origin/$branch" >/dev/null || { echo "Branch $branch not found"; exit 1; }
  git branch --quiet "$branch" "origin/$branch"
done

echo "3/5 Pushing main and ${#BRANCHES[@]} feature branches…"
git push -u origin main
for branch in "${BRANCHES[@]}"; do git push -u origin "$branch"; done

echo "4/5 Opening stacked pull requests…"
base="main"
for i in "${!BRANCHES[@]}"; do
  branch="${BRANCHES[$i]}"
  body="$(pr_body "$i")"
  title="$(head -n 1 "$body" | sed 's/^# //')"
  if ! gh pr view "$branch" --repo "$REPO" >/dev/null 2>&1; then
    gh pr create --repo "$REPO" --base "$base" --head "$branch" --title "$title" --body-file "$body"
  fi
  base="$branch"
done

echo "5/5 Final secrets check before going public…"
node scripts/scan-secrets.mjs
if [ "${KEEP_PRIVATE:-0}" = "1" ]; then
  echo "KEEP_PRIVATE=1: leaving the repository private."
else
  gh repo edit "$REPO" --visibility public --accept-visibility-change-consequences
  echo "Repository is public: https://github.com/$REPO"
fi
gh pr list --repo "$REPO"
