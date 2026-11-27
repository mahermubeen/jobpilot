#!/usr/bin/env bash
# ai-repo-kit: managed file. Claude Code Stop hook.
# Runs scripts/check.sh (fast) when the working tree changed since the last
# passing run. On failure it exits 2, which makes Claude keep working with the
# failure output instead of ending its turn. Gives up after 3 blocks in a row
# so a check Claude cannot fix never traps the session; the human sees why.
set -uo pipefail
input=$(cat)
cd "${CLAUDE_PROJECT_DIR:-$(pwd)}" || exit 0
[ -x scripts/check.sh ] || exit 0
GITDIR=$(git rev-parse --git-dir 2>/dev/null) || exit 0
STATE="$GITDIR/ai-repo-kit"
mkdir -p "$STATE"

# Fingerprint of all uncommitted work: tracked diff plus untracked file contents.
fp=$( { git diff HEAD 2>/dev/null; git ls-files -o --exclude-standard -z | xargs -0 shasum 2>/dev/null; } | shasum | cut -d' ' -f1)
[ "$fp" = "$(cat "$STATE/last-pass" 2>/dev/null)" ] && exit 0
# Nothing uncommitted at all: nothing to check.
[ -z "$(git status --porcelain 2>/dev/null)" ] && exit 0

blocks=$(cat "$STATE/blocks" 2>/dev/null || echo 0)
case "$input" in *'"stop_hook_active":true'*|*'"stop_hook_active": true'*) ;; *) blocks=0 ;; esac

if out=$(scripts/check.sh --fast 2>&1); then
  echo "$fp" > "$STATE/last-pass"
  echo 0 > "$STATE/blocks"
  exit 0
fi

if [ "$blocks" -ge 3 ]; then
  echo 0 > "$STATE/blocks"
  echo "scripts/check.sh still failing after 3 attempts; stopping. Tell the user exactly which checks fail and why." >&2
  exit 0
fi
echo $((blocks + 1)) > "$STATE/blocks"
{
  echo "scripts/check.sh --fast FAILED. Fix the cause (do not disable, skip or weaken the check), then finish."
  echo "If a failure is pre-existing and unrelated to your change, say so explicitly to the user instead."
  echo
  echo "$out" | tail -n 80
} >&2
exit 2
