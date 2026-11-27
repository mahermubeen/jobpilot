#!/usr/bin/env bash
# ai-repo-kit: managed file. Re-running install.sh updates it; put project settings in .checkrc.
#
# Universal quality gate. Detects every stack in the repo and runs its
# format, lint, type, test, build, audit and secret checks.
#
#   scripts/check.sh            fast mode (default): secrets, format, lint, types, unit tests
#   scripts/check.sh --full     + build, dependency audit, SAST, e2e (if a script exists), history secret scan
#   scripts/check.sh --list     show detected stacks and exit
#
# A tool that is not installed is reported as SKIPPED, never as passed.
# Exit code: 0 when nothing failed, 1 otherwise.
#
# Project overrides go in .checkrc (sourced as bash), for example:
#   NPM_AUDIT_LEVEL=critical        # npm audit threshold (default: high)
#   CHECK_SKIP="docker shell"       # stacks to skip
#   CHECK_EXTRA_FAST="npm run check:i18n"   # extra commands, run in fast and full
#   CHECK_EXTRA_FULL="npm run test:e2e"     # extra commands, full mode only

set -uo pipefail

MODE=fast
for arg in "$@"; do
  case "$arg" in
    --fast) MODE=fast ;;
    --full) MODE=full ;;
    --list) MODE=list ;;
    -h|--help) sed -n '2,20p' "$0"; exit 0 ;;
    *) echo "unknown option: $arg" >&2; exit 2 ;;
  esac
done

ROOT=$(git rev-parse --show-toplevel 2>/dev/null || pwd)
cd "$ROOT" || exit 2

NPM_AUDIT_LEVEL=high
CHECK_SKIP=""
CHECK_EXTRA_FAST=""
CHECK_EXTRA_FULL=""
# shellcheck disable=SC1091
[ -f .checkrc ] && . ./.checkrc

PASSED=0
FAILED_LIST=""
SKIPPED_LIST=""
LOG=$(mktemp "${TMPDIR:-/tmp}/check.XXXXXX")
trap 'rm -f "$LOG"' EXIT

if [ -t 1 ]; then B=$'\033[1m'; R=$'\033[31m'; G=$'\033[32m'; Y=$'\033[33m'; N=$'\033[0m'; else B=""; R=""; G=""; Y=""; N=""; fi

have() { command -v "$1" >/dev/null 2>&1; }
skipped() { SKIPPED_LIST="${SKIPPED_LIST}  - $1: $2"$'\n'; printf '%s~ %s%s (skipped: %s)\n' "$Y" "$1" "$N" "$2"; }

# run <label> <command...>
run() {
  local label=$1; shift
  printf '%s> %s%s\n' "$B" "$label" "$N"
  if "$@" >"$LOG" 2>&1; then
    PASSED=$((PASSED + 1))
    printf '%s  ok%s\n' "$G" "$N"
  else
    FAILED_LIST="${FAILED_LIST}  - ${label}"$'\n'
    printf '%s  FAILED%s (last 40 lines):\n' "$R" "$N"
    tail -n 40 "$LOG" | sed 's/^/    /'
  fi
}

# run_sh <label> <shell string>
run_sh() { local label=$1; shift; run "$label" bash -c "$1"; }

# tracked or untracked-but-not-ignored files matching a pattern
files_matching() { git ls-files -co --exclude-standard 2>/dev/null | grep -E "$1"; }
has_file() { [ -n "$(files_matching "$1" | head -n 1)" ]; }
skipping() { case " $CHECK_SKIP " in *" $1 "*) return 0 ;; esac; return 1; }

# ---------------------------------------------------------------- detection
STACKS=""
add() { skipping "$1" || STACKS="$STACKS $1"; }
[ -f package.json ] && add node
if [ -f package.json ] && grep -qE '"(react-native|expo)"' package.json; then add mobile; fi
{ [ -f pyproject.toml ] || [ -f setup.py ] || ls requirements*.txt >/dev/null 2>&1; } && add python
[ -f go.mod ] && add go
[ -f Cargo.toml ] && add rust
{ [ -f pom.xml ] || [ -f build.gradle ] || [ -f build.gradle.kts ]; } && add jvm
has_file '\.(sln|csproj|fsproj)$' && add dotnet
[ -f composer.json ] && add php
[ -f Gemfile ] && add ruby
[ -f pubspec.yaml ] && add dart
has_file '(^|/)Dockerfile[^/]*$' && add docker
has_file '\.sh$' && add shell
has_file '\.tf$' && add terraform
add secrets

printf '%sstacks:%s%s   mode: %s\n\n' "$B" "$N" "$STACKS" "$MODE"
[ "$MODE" = list ] && exit 0

# ---------------------------------------------------------------- secrets (always)
check_secrets() {
  if have gitleaks; then
    if git rev-parse --git-dir >/dev/null 2>&1; then
      # uncommitted work, staged and unstaged
      run "secrets: uncommitted changes (gitleaks)" gitleaks git --pre-commit --redact --no-banner .
      run "secrets: staged changes (gitleaks)" gitleaks git --pre-commit --staged --redact --no-banner .
      if [ -n "$(git ls-files -o --exclude-standard | head -n 1)" ]; then
        run_sh "secrets: new untracked files (gitleaks)" \
          "git ls-files -o --exclude-standard -z | xargs -0 cat 2>/dev/null | gitleaks stdin --redact --no-banner"
      fi
      [ "$MODE" = full ] && run "secrets: full git history (gitleaks)" gitleaks git --redact --no-banner .
    else
      run "secrets: directory (gitleaks)" gitleaks dir --redact --no-banner .
    fi
  else
    skipped "gitleaks" "not installed, using pattern fallback (brew install gitleaks)"
    run_sh "secrets: pattern scan of tracked files" \
      "! git grep -nIE 'AKIA[0-9A-Z]{16}|sk-ant-[A-Za-z0-9_-]{20,}|sk-(proj-)?[A-Za-z0-9]{32,}|gh[pousr]_[A-Za-z0-9]{36}|xox[baprs]-[A-Za-z0-9-]{10,}|AIza[0-9A-Za-z_-]{35}|-----BEGIN (RSA |EC |OPENSSH |)PRIVATE KEY-----' -- . ':!*.lock' ':!package-lock.json'"
  fi
  run_sh "secrets: no real .env or key files tracked" \
    "! git ls-files | grep -E '(^|/)(\.env(\.[^/]*)?|id_rsa|id_ed25519|.*\.pem|.*\.p12|.*\.pfx|.*\.key|credentials\.json|service-account.*\.json)$' | grep -vE '\.(example|sample|template)$'"
  run_sh "no merge-conflict markers" "! git grep -nIE '^(<<<<<<<|>>>>>>>) ' -- . ':!*.md'"
}

# ---------------------------------------------------------------- node / typescript
check_node() {
  local pm=npm
  [ -f pnpm-lock.yaml ] && pm=pnpm
  [ -f yarn.lock ] && pm=yarn
  { [ -f bun.lockb ] || [ -f bun.lock ]; } && pm=bun
  have "$pm" || { skipped "node" "$pm not installed"; return; }
  [ -d node_modules ] || { skipped "node" "node_modules missing, run $pm install"; return; }

  has_script() { node -e "process.exit(require('./package.json').scripts?.['$1'] ? 0 : 1)" 2>/dev/null; }
  runs() { if [ "$pm" = npm ]; then echo "npm run --silent $1"; else echo "$pm run $1"; fi; }

  if has_script format:check; then run_sh "node: format" "$(runs format:check)"
  elif [ -f .prettierrc ] || [ -f .prettierrc.json ] || [ -f prettier.config.js ] || [ -f prettier.config.mjs ]; then run "node: format (prettier)" npx --no-install prettier --check .
  fi

  if has_script lint; then run_sh "node: lint" "$(runs lint)"
  else skipped "node: lint" "no \"lint\" script in package.json"; fi

  if has_script typecheck; then run_sh "node: typecheck" "$(runs typecheck)"
  elif [ -f tsconfig.json ]; then run "node: typecheck (tsc)" npx --no-install tsc --noEmit
  fi

  if has_script test; then run_sh "node: tests" "CI=1 $(runs test)"
  else skipped "node: tests" "no \"test\" script in package.json"; fi

  if [ "$MODE" = full ]; then
    if has_script build; then run_sh "node: build" "NEXT_TELEMETRY_DISABLED=1 $(runs build)"; fi
    for s in test:e2e e2e test:a11y; do has_script "$s" && run_sh "node: $s" "CI=1 $(runs "$s")"; done
    case "$pm" in
      npm) run "node: dependency audit (npm audit, level $NPM_AUDIT_LEVEL)" npm audit --omit=dev --audit-level="$NPM_AUDIT_LEVEL" ;;
      pnpm) run "node: dependency audit (pnpm audit)" pnpm audit --prod --audit-level "$NPM_AUDIT_LEVEL" ;;
      yarn) run "node: dependency audit (yarn npm audit)" yarn npm audit --environment production --severity "$NPM_AUDIT_LEVEL" ;;
      bun) skipped "node: dependency audit" "bun has no audit; run npx audit-ci or rely on Dependabot" ;;
    esac
  fi
}

check_mobile() {
  [ "$MODE" = full ] || return
  if grep -q '"expo"' package.json; then
    run "mobile: expo-doctor" npx --yes expo-doctor
  fi
}

# ---------------------------------------------------------------- python
py_tool() {  # resolve a python tool: venv, PATH, then uvx
  local t=$1
  for v in .venv venv; do [ -x "$v/bin/$t" ] && { echo "$v/bin/$t"; return; }; done
  have "$t" && { echo "$t"; return; }
  have uvx && { echo "uvx $t"; return; }
  return 1
}
check_python() {
  local t
  if t=$(py_tool ruff); then
    run_sh "python: format (ruff)" "$t format --check ."
    run_sh "python: lint (ruff)" "$t check ."
  else skipped "python: lint" "ruff not installed (pip install ruff)"; fi

  if [ -f mypy.ini ] || grep -qs '\[tool.mypy\]' pyproject.toml setup.cfg; then
    if t=$(py_tool mypy); then run_sh "python: types (mypy)" "$t ."; else skipped "python: types" "mypy not installed"; fi
  elif grep -qs '\[tool.pyright\]' pyproject.toml || [ -f pyrightconfig.json ]; then
    if t=$(py_tool pyright); then run_sh "python: types (pyright)" "$t"; else skipped "python: types" "pyright not installed"; fi
  else skipped "python: types" "no mypy/pyright config"; fi

  if has_file '(^|/)(test_[^/]*|[^/]*_test)\.py$' || [ -d tests ]; then
    local py=python3; for v in .venv venv; do [ -x "$v/bin/python" ] && py="$v/bin/python"; done
    if "$py" -c 'import pytest' 2>/dev/null; then run "python: tests (pytest)" "$py" -m pytest -q
    else skipped "python: tests" "pytest not importable in $py"; fi
  fi

  if [ "$MODE" = full ]; then
    if t=$(py_tool bandit); then run_sh "python: SAST (bandit)" "$t -q -r . -x ./.venv,./venv,./node_modules,./tests -ll"
    else skipped "python: SAST" "bandit not installed (pip install bandit)"; fi
    if t=$(py_tool pip-audit); then run_sh "python: dependency audit (pip-audit)" "$t"
    else skipped "python: dependency audit" "pip-audit not installed"; fi
  fi
}

# ---------------------------------------------------------------- go
check_go() {
  have go || { skipped "go" "go not installed"; return; }
  run_sh "go: format (gofmt)" 'test -z "$(gofmt -l . | grep -v /vendor/)" || { gofmt -l .; exit 1; }'
  run "go: vet" go vet ./...
  if have staticcheck; then run "go: staticcheck" staticcheck ./...; fi
  run "go: tests (race)" go test -race ./...
  if [ "$MODE" = full ]; then
    if have govulncheck; then run "go: vulnerabilities (govulncheck)" govulncheck ./...
    else skipped "go: vulnerabilities" "go install golang.org/x/vuln/cmd/govulncheck@latest"; fi
  fi
}

# ---------------------------------------------------------------- rust
check_rust() {
  have cargo || { skipped "rust" "cargo not installed"; return; }
  run "rust: format" cargo fmt --all -- --check
  run "rust: clippy" cargo clippy --all-targets --all-features -- -D warnings
  run "rust: tests" cargo test --all-features
  if [ "$MODE" = full ]; then
    if cargo audit --version >/dev/null 2>&1; then run "rust: dependency audit" cargo audit
    else skipped "rust: dependency audit" "cargo install cargo-audit"; fi
  fi
}

# ---------------------------------------------------------------- java / kotlin
check_jvm() {
  if [ -f pom.xml ]; then
    local mvn=mvn; [ -x ./mvnw ] && mvn=./mvnw
    have "$mvn" || [ -x "$mvn" ] || { skipped "jvm" "maven not installed"; return; }
    if [ "$MODE" = full ]; then run "jvm: maven verify" "$mvn" -B -q verify; else run "jvm: maven test" "$mvn" -B -q test; fi
  else
    local gr=gradle; [ -x ./gradlew ] && gr=./gradlew
    have "$gr" || [ -x "$gr" ] || { skipped "jvm" "gradle not installed"; return; }
    if [ "$MODE" = full ]; then run "jvm: gradle build" "$gr" build; else run "jvm: gradle check" "$gr" check; fi
  fi
}

# ---------------------------------------------------------------- .net
check_dotnet() {
  have dotnet || { skipped "dotnet" "dotnet not installed"; return; }
  run "dotnet: format" dotnet format --verify-no-changes
  run "dotnet: tests" dotnet test --nologo
  [ "$MODE" = full ] && run_sh "dotnet: vulnerable packages" \
    '! dotnet list package --vulnerable --include-transitive 2>&1 | grep -E "Critical|High"'
}

# ---------------------------------------------------------------- php
check_php() {
  have composer || { skipped "php" "composer not installed"; return; }
  run "php: composer validate" composer validate --strict --no-check-publish
  [ -x vendor/bin/php-cs-fixer ] && run "php: format" vendor/bin/php-cs-fixer fix --dry-run --diff
  [ -x vendor/bin/phpstan ] && run "php: static analysis (phpstan)" vendor/bin/phpstan analyse --no-progress
  if [ -x vendor/bin/pest ]; then run "php: tests (pest)" vendor/bin/pest
  elif [ -x vendor/bin/phpunit ]; then run "php: tests (phpunit)" vendor/bin/phpunit; fi
  [ "$MODE" = full ] && run "php: dependency audit" composer audit
}

# ---------------------------------------------------------------- ruby
check_ruby() {
  have bundle || { skipped "ruby" "bundler not installed"; return; }
  bundle exec rubocop --version >/dev/null 2>&1 && run "ruby: lint (rubocop)" bundle exec rubocop
  if [ -d spec ]; then run "ruby: tests (rspec)" bundle exec rspec
  elif [ -d test ]; then run "ruby: tests" bundle exec rake test; fi
  if [ "$MODE" = full ]; then
    bundle exec brakeman --version >/dev/null 2>&1 && run "ruby: SAST (brakeman)" bundle exec brakeman -q --no-pager
    bundle exec bundle-audit version >/dev/null 2>&1 && run "ruby: dependency audit" bundle exec bundle-audit check --update
  fi
}

# ---------------------------------------------------------------- dart / flutter
check_dart() {
  if grep -q 'flutter:' pubspec.yaml && have flutter; then
    run "flutter: analyze" flutter analyze
    run "flutter: tests" flutter test
  elif have dart; then
    run "dart: format" dart format --output=none --set-exit-if-changed .
    run "dart: analyze" dart analyze
    run "dart: tests" dart test
  else skipped "dart" "dart/flutter not installed"; fi
}

# ---------------------------------------------------------------- docker
check_docker() {
  local f
  for f in $(files_matching '(^|/)Dockerfile[^/]*$'); do
    if have hadolint; then run "docker: lint $f (hadolint)" hadolint "$f"
    else skipped "docker: lint $f" "hadolint not installed"; fi
    run_sh "docker: $f runs as non-root" "grep -qE '^USER +[^r0]' '$f' || { echo 'no non-root USER line in $f'; exit 1; }"
  done
}

# ---------------------------------------------------------------- shell
check_shell() {
  if have shellcheck; then
    run_sh "shell: shellcheck" "git ls-files -co --exclude-standard '*.sh' | xargs shellcheck -S warning"
  else skipped "shell" "shellcheck not installed (brew install shellcheck)"; fi
}

# ---------------------------------------------------------------- terraform
check_terraform() {
  have terraform && run "terraform: format" terraform fmt -check -recursive
  if [ "$MODE" = full ]; then
    if have trivy; then run "terraform: misconfig (trivy)" trivy config --exit-code 1 --severity HIGH,CRITICAL .
    elif have tflint; then run "terraform: lint (tflint)" tflint --recursive
    else skipped "terraform: misconfig scan" "install trivy or tflint"; fi
  fi
}

# ---------------------------------------------------------------- run
for s in $STACKS; do "check_$s"; done

[ -n "$CHECK_EXTRA_FAST" ] && run_sh "extra: $CHECK_EXTRA_FAST" "$CHECK_EXTRA_FAST"
[ "$MODE" = full ] && [ -n "$CHECK_EXTRA_FULL" ] && run_sh "extra: $CHECK_EXTRA_FULL" "$CHECK_EXTRA_FULL"

echo
printf '%s==== summary (%s) ====%s\n' "$B" "$MODE" "$N"
printf 'passed:  %d\n' "$PASSED"
if [ -n "$SKIPPED_LIST" ]; then printf '%sskipped (not verified):%s\n%s' "$Y" "$N" "$SKIPPED_LIST"; fi
if [ -n "$FAILED_LIST" ]; then
  printf '%sfailed:%s\n%s' "$R" "$N" "$FAILED_LIST"
  exit 1
fi
printf '%sall checks passed%s\n' "$G" "$N"
