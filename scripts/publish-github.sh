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
DESCRIPTION="A living 3D town where your Claude Code sessions, subagents and agent teams work as tiny characters, live through hooks."
TOPICS="claude-code,claude,ai-agents,multi-agent,hooks,visualization,threejs,developer-tools,observability"

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
mapfile -t BRANCHES < <(sed -n 's/^- `\(.*\)`.*/\1/p' docs/prs/ORDER.md)
[ "${#BRANCHES[@]}" -gt 0 ] || { echo "docs/prs/ORDER.md lists no branches"; exit 1; }

echo "2/5 Creating $REPO (private for now)…"
if ! gh repo view "$REPO" >/dev/null 2>&1; then
  gh repo create "$REPO" --private --description "$DESCRIPTION" --disable-wiki
fi
gh repo edit "$REPO" --add-topic "$TOPICS" --description "$DESCRIPTION"
git remote get-url origin >/dev/null 2>&1 || git remote add origin "https://github.com/$REPO.git"

echo "3/5 Pushing main and ${#BRANCHES[@]} feature branches…"
git push -u origin main
for branch in "${BRANCHES[@]}"; do git push -u origin "$branch"; done

echo "4/5 Opening stacked pull requests…"
base="main"
for i in "${!BRANCHES[@]}"; do
  branch="${BRANCHES[$i]}"
  body="docs/prs/$(printf '%02d' $((i + 1)))-${branch//\//-}.md"
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
