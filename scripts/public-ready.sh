#!/usr/bin/env bash
# ai-repo-kit: managed file. Re-running install.sh updates it.
#
# "Is this repo safe to make public?" audit. Read-only: it changes nothing.
#   scripts/public-ready.sh
# FAIL = must fix before publishing. WARN = a human must look. INFO = for the record.
# Exit code: 1 if anything FAILED.
#
# Allow-list known, intentional hits (one extended regex per line) in .public-ready-allow,
# e.g. a security contact address:  ^SECURITY\.md:.*you@example\.com

set -uo pipefail
ROOT=$(git rev-parse --show-toplevel 2>/dev/null) || { echo "not a git repo" >&2; exit 2; }
cd "$ROOT" || exit 2

if [ -t 1 ]; then R=$'\033[31m'; G=$'\033[32m'; Y=$'\033[33m'; B=$'\033[1m'; N=$'\033[0m'; else R=""; G=""; Y=""; B=""; N=""; fi
FAILS=0; WARNS=0
fail() { FAILS=$((FAILS + 1)); printf '%sFAIL%s %s\n' "$R" "$N" "$1"; }
warn() { WARNS=$((WARNS + 1)); printf '%sWARN%s %s\n' "$Y" "$N" "$1"; }
ok()   { printf '%s ok %s %s\n' "$G" "$N" "$1"; }
info() { printf 'INFO %s\n' "$1"; }
indent() { sed 's/^/       /' | head -n "${1:-15}"; }
allow() { if [ -f .public-ready-allow ]; then grep -vEf <(grep -v '^#' .public-ready-allow | grep -v '^$') || true; else cat; fi; }

EXCL=(':!package-lock.json' ':!yarn.lock' ':!pnpm-lock.yaml' ':!*.lock' ':!*.svg' ':!*.min.js' ':!.public-ready-allow')

printf '%s== 1. secrets ==%s\n' "$B" "$N"
if command -v gitleaks >/dev/null 2>&1; then
  if out=$(gitleaks git -v --redact --no-banner . 2>&1); then ok "gitleaks: no secrets in any commit of the history"
  else fail "gitleaks found secrets in git history. Rotate the key FIRST, then rewrite history (git filter-repo) or start a fresh repo."; echo "$out" | indent 30; fi
  if out=$(gitleaks dir -v --redact --no-banner . 2>&1); then ok "gitleaks: no secrets in the working tree"
  else
    found=$(echo "$out" | sed -n 's/^File: *//p' | sort -u)
    shown=$(echo "$found" | while IFS= read -r f; do [ -n "$f" ] && ! git check-ignore -q "$f" && echo "$f"; done)
    ignored=$(echo "$found" | grep -c . ); ignored=$((ignored - $(echo "$shown" | grep -c .)))
    if [ -n "$shown" ]; then warn "gitleaks found secrets in files that are NOT gitignored (one commit away from leaking):"; echo "$shown" | indent 20
    else ok "gitleaks: no secrets in committable files"; fi
    [ "$ignored" -gt 0 ] && info "$ignored gitignored file(s) contain secrets (expected for .env, local data, build output)"
  fi
else
  fail "gitleaks not installed: history cannot be scanned (brew install gitleaks)"
fi

bad=$(git ls-files | grep -E '(^|/)(\.env(\.[^/]*)?|id_rsa|id_ed25519|[^/]*\.(pem|p12|pfx|key|keystore|jks|sqlite|sqlite3|db)|credentials\.json|service-account[^/]*\.json|\.npmrc|\.pypirc|\.netrc)$' | grep -vE '\.(example|sample|template)$')
if [ -n "$bad" ]; then fail "sensitive file types are tracked:"; echo "$bad" | indent
else ok "no .env, key, keystore, database or credential files tracked"; fi

hist=$(git log --all --diff-filter=A --name-only --format= | sort -u | grep -E '(^|/)(\.env(\.[^/]*)?|id_rsa|[^/]*\.(pem|p12|key)|credentials\.json)$' | grep -vE '\.(example|sample|template)$')
if [ -n "$hist" ]; then fail "sensitive files existed in an OLD commit (deleted now, still in history):"; echo "$hist" | indent
else ok "no sensitive files anywhere in history"; fi

printf '\n%s== 2. personal and internal data ==%s\n' "$B" "$N"
emails=$(git grep -nIoE '[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}' -- . "${EXCL[@]}" \
  | grep -viE '@([a-z0-9-]+\.)*(example|test|invalid|localhost)(\.[a-z]+)?$|@users\.noreply\.github\.com|@noreply\.|@anthropic\.com|@[0-9]x\.|\.(png|jpe?g|gif|svg|webp|avif|ico)$' \
  | grep -vE '@[0-9]+\.[0-9]+|@(types|babel|vitejs|testing-library|tanstack|radix-ui|next|react-native|expo|tailwindcss|eslint|vitest|playwright)/' | allow)
if [ -n "$emails" ]; then warn "real-looking email addresses in tracked files (use @example.com in code, fixtures and docs):"; echo "$emails" | indent
else ok "no real email addresses"; fi

phones=$(git grep -nIE '(\+[1-9][0-9]{0,2}[ -]?)?\(?[0-9]{3}\)?[ -][0-9]{3}[ -][0-9]{4}' -- . "${EXCL[@]}" ':!*.csv' | grep -vE '555[ -]?01[0-9]{2}' | allow)
if [ -n "$phones" ]; then warn "phone-number-like strings (use +1 555 01xx for fakes):"; echo "$phones" | indent
else ok "no phone numbers"; fi

paths=$(git grep -nIE '(/Users/[A-Za-z0-9._-]+/|/home/[A-Za-z0-9._-]+/|C:\\\\Users\\\\)' -- . "${EXCL[@]}" | allow)
if [ -n "$paths" ]; then warn "absolute home-directory paths (leak your username and machine layout):"; echo "$paths" | indent
else ok "no absolute home paths"; fi

ips=$(git grep -nIE '\b(10\.[0-9]{1,3}|192\.168|172\.(1[6-9]|2[0-9]|3[01]))\.[0-9]{1,3}\.[0-9]{1,3}\b' -- . "${EXCL[@]}" | allow)
if [ -n "$ips" ]; then warn "private IP addresses (internal infrastructure?):"; echo "$ips" | indent
else ok "no private IP addresses"; fi

hosts=$(git grep -nIiE 'https?://[a-z0-9.-]*\b(internal|corp|staging|intranet|vpn|jenkins|gitlab\.[a-z]+\.[a-z]+)\b' -- . "${EXCL[@]}" | allow)
if [ -n "$hosts" ]; then warn "internal/staging hostnames:"; echo "$hosts" | indent
else ok "no internal hostnames"; fi

authors=$(git log --all --format='%an <%ae>' | sort -u)
info "commit author identities that will become public:"; echo "$authors" | indent 10

printf '\n%s== 3. repository hygiene ==%s\n' "$B" "$N"
for f in README.md LICENSE .gitignore; do
  if ls "$f"* >/dev/null 2>&1; then ok "$f present"; else fail "$f missing"; fi
done
if [ -f SECURITY.md ] || [ -f .github/SECURITY.md ]; then ok "SECURITY.md present"; else warn "SECURITY.md missing (how to report a vulnerability, risks considered)"; fi
if git grep -qIE 'process\.env|import\.meta\.env|os\.environ|os\.getenv|getenv\(|ENV\[' -- . "${EXCL[@]}"; then
  if [ -f .env.example ] || [ -f .env.sample ] || [ -f .env.template ]; then ok "code reads env vars and an .env example exists"
  else fail "code reads env vars but there is no .env.example listing them"; fi
fi
if [ -f .gitignore ] && grep -qE '^\.env|^/?\.env\*?$|\.env\*' .gitignore; then ok ".gitignore covers .env"; else fail ".gitignore does not ignore .env files"; fi

big=$(git ls-files -z | xargs -0 du -k 2>/dev/null | awk '$1 > 5120 {print $1 " KB  " $2}')
if [ -n "$big" ]; then warn "tracked files over 5 MB (use Git LFS or remove):"; echo "$big" | indent; else ok "no tracked files over 5 MB"; fi

junk=$(git ls-files | grep -E '(^|/)(node_modules|\.next|dist|build|__pycache__|\.venv|venv|coverage|\.DS_Store|Thumbs\.db|\.idea|\.vscode/settings\.json)(/|$)' | head)
if [ -n "$junk" ]; then warn "build output, dependencies or editor files tracked:"; echo "$junk" | indent; else ok "no build output or editor junk tracked"; fi

todo=$(git grep -nIE '\b(TODO|FIXME|HACK|XXX)\b' -- . "${EXCL[@]}" ':!*.md' | wc -l | tr -d ' ')
info "$todo TODO/FIXME/HACK markers in code"

if [ -d .github/workflows ]; then ok "CI workflows present"; else warn "no CI workflow (.github/workflows)"; fi

echo
if [ "$FAILS" -gt 0 ]; then printf '%sNOT READY%s: %d fail, %d warn\n' "$R" "$N" "$FAILS" "$WARNS"; exit 1; fi
printf '%sREADY%s with %d warning(s) for a human to review\n' "$G" "$N" "$WARNS"
