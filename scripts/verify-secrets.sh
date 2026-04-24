#!/usr/bin/env bash
# nlqdb — verify every credential in .envrc by calling each provider's
# simplest "who am I" / "am I alive" endpoint. Outputs OK / FAIL per
# secret — NEVER prints the secret value itself.
#
# Run from repo root. direnv normally sources .envrc on cd, but we
# source it explicitly so the script works in non-direnv shells too.

set -u

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT" || exit 1

if [[ ! -f .envrc ]]; then
  echo "no .envrc at repo root — run scripts/bootstrap-dev.sh first"
  exit 1
fi
# shellcheck disable=SC1091
source .envrc 2>/dev/null || true

# --- display helpers ----------------------------------------------------

say()  { printf '\n\033[1;34m== %s ==\033[0m\n' "$*"; }
ok()   { printf '  \033[1;32m✓\033[0m %s\n' "$*"; }
fail() { printf '  \033[1;31m✗\033[0m %s  — %s\n' "$1" "$2"; }
skip() { printf '  \033[2m· skip %s (not set)\033[0m\n' "$*"; }

# check_present <var_name> [<min_len=16>]
#   Verifies the env var exists and has a plausible length. No network.
check_present() {
  local name="$1" min_len="${2:-16}"
  local val="${!name:-}"
  if [[ -z "$val" ]]; then skip "$name"; return; fi
  if (( ${#val} < min_len )); then
    fail "$name" "suspiciously short (${#val} chars)"
  else
    ok "$name present (${#val} chars)"
  fi
}

# check_http <var_name> <curl_args...> --match <regex>
#   Pipes response body through grep -qE; reports OK/FAIL based on match.
check_http() {
  local name="$1"; shift
  # Remaining args are curl flags/URL followed by `--match <regex>`.
  local args=() match=""
  while (( $# )); do
    if [[ "$1" == "--match" ]]; then match="$2"; shift 2; else args+=("$1"); shift; fi
  done
  local val="${!name:-}"
  if [[ -z "$val" ]]; then skip "$name"; return; fi

  local body status
  body=$(curl -s -m 10 -w '\n__HTTP_STATUS__%{http_code}' "${args[@]}" 2>&1 || true)
  status="${body##*__HTTP_STATUS__}"
  body="${body%__HTTP_STATUS__*}"

  if [[ -n "$match" ]] && echo "$body" | grep -qE "$match"; then
    ok "$name (HTTP $status)"
  else
    local snippet
    snippet=$(echo "$body" | tr -d '\n' | cut -c1-120)
    fail "$name" "HTTP $status — ${snippet:-<empty>}"
  fi
}

# --- checks -------------------------------------------------------------

say "Self-generated secrets"
check_present BETTER_AUTH_SECRET 32
check_present INTERNAL_JWT_SECRET 32

say "Cloudflare"
check_http CLOUDFLARE_API_TOKEN \
  -H "Authorization: Bearer ${CLOUDFLARE_API_TOKEN:-MISSING}" \
  "https://api.cloudflare.com/client/v4/user/tokens/verify" \
  --match '"status":"active"'
check_present CLOUDFLARE_ACCOUNT_ID 20
check_present CF_AI_TOKEN 20

say "Neon"
# /api/v2/users/me works for both personal and org-scoped API keys
# without needing an `org_id` query param. /api/v2/projects requires
# org_id when the key is org-scoped, which errors with HTTP 400.
check_http NEON_API_KEY \
  -H "Authorization: Bearer ${NEON_API_KEY:-MISSING}" \
  "https://console.neon.tech/api/v2/users/me" \
  --match '"email"|"id"|"name"'

if command -v psql >/dev/null 2>&1; then
  if [[ -n "${DATABASE_URL:-}" ]]; then
    if psql "$DATABASE_URL" -tAc 'select 1' 2>&1 | grep -q '^1$'; then
      ok "DATABASE_URL (psql select 1 = 1)"
    else
      fail "DATABASE_URL" "psql could not connect / select"
    fi
  else
    skip "DATABASE_URL"
  fi
else
  if [[ -n "${DATABASE_URL:-}" ]]; then
    printf '  \033[2m· DATABASE_URL present; install postgresql-client for live test\033[0m\n'
  else
    skip "DATABASE_URL"
  fi
fi

say "Fly.io"
check_http FLY_API_TOKEN \
  -H "Authorization: Bearer ${FLY_API_TOKEN:-MISSING}" \
  -H "Content-Type: application/json" \
  --data '{"query":"{ viewer { id email } }"}' \
  "https://api.fly.io/graphql" \
  --match '"email"'

say "Upstash Redis"
if [[ -n "${UPSTASH_REDIS_REST_URL:-}" && -n "${UPSTASH_REDIS_REST_TOKEN:-}" ]]; then
  check_http UPSTASH_REDIS_REST_TOKEN \
    -H "Authorization: Bearer ${UPSTASH_REDIS_REST_TOKEN}" \
    "${UPSTASH_REDIS_REST_URL}/ping" \
    --match '"PONG"'
else
  [[ -z "${UPSTASH_REDIS_REST_URL:-}"   ]] && skip UPSTASH_REDIS_REST_URL
  [[ -z "${UPSTASH_REDIS_REST_TOKEN:-}" ]] && skip UPSTASH_REDIS_REST_TOKEN
fi

say "LLM providers"
check_http GEMINI_API_KEY \
  "https://generativelanguage.googleapis.com/v1beta/models?key=${GEMINI_API_KEY:-MISSING}" \
  --match '"models"'

check_http GROQ_API_KEY \
  -H "Authorization: Bearer ${GROQ_API_KEY:-MISSING}" \
  "https://api.groq.com/openai/v1/models" \
  --match '"id"'

check_http OPENROUTER_API_KEY \
  -H "Authorization: Bearer ${OPENROUTER_API_KEY:-MISSING}" \
  "https://openrouter.ai/api/v1/auth/key" \
  --match '"data"'

echo ""
