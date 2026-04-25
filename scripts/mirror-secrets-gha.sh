#!/usr/bin/env bash
# nlqdb — mirror cloud-provider credentials from .envrc to GitHub
# Actions secrets in nlqdb/nlqdb. Idempotent (gh secret set
# overwrites). Never logs values; only secret names + lengths +
# OK/skip status.
#
# Run on the source machine after any .envrc rotation. CI workflows
# read these via ${{ secrets.NAME }}; the canonical name list lives
# in .env.example. Two intentional omissions:
#
#   BETTER_AUTH_SECRET / INTERNAL_JWT_SECRET — LOCAL DEV ONLY. CI
#     should generate fresh ephemeral values per workflow run;
#     sharing dev values to CI would let CI compromise live dev
#     sessions.
#
# Prereqs: gh authenticated, admin/maintainer access to nlqdb/nlqdb.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

REPO="nlqdb/nlqdb"

say()  { printf '\n\033[1;34m== %s ==\033[0m\n' "$*"; }
ok()   { printf '  \033[1;32m✓\033[0m %s\n' "$*"; }
fail() { printf '  \033[1;31m✗\033[0m %s — %s\n' "$1" "$2"; }
skip() { printf '  \033[2m· skip %s (not set in .envrc)\033[0m\n' "$*"; }

# --- preflight ----------------------------------------------------------
[[ -f .envrc ]] || { fail "preflight" ".envrc not found at $REPO_ROOT — run scripts/bootstrap-dev.sh first"; exit 1; }
command -v gh >/dev/null 2>&1 || { fail "preflight" "gh not installed — run scripts/bootstrap-dev.sh first"; exit 1; }
gh auth status >/dev/null 2>&1 || { fail "preflight" "gh not authenticated — run: gh auth login"; exit 1; }
gh repo view "$REPO" >/dev/null 2>&1 || { fail "preflight" "no access to $REPO — check token scope"; exit 1; }

# Source .envrc without echoing.
set -a
# shellcheck disable=SC1091
source .envrc
set +a

# --- canonical mirror list ----------------------------------------------
# Order = .env.example for easy diff. Add new secrets here AND in
# .env.example simultaneously; CI references must use these exact names.
SECRETS=(
  CLOUDFLARE_ACCOUNT_ID
  CLOUDFLARE_API_TOKEN
  CF_AI_TOKEN
  NEON_API_KEY
  DATABASE_URL
  UPSTASH_REDIS_REST_URL
  UPSTASH_REDIS_REST_TOKEN
  FLY_API_TOKEN
  GEMINI_API_KEY
  GROQ_API_KEY
  OPENROUTER_API_KEY
  OAUTH_GITHUB_CLIENT_ID
  OAUTH_GITHUB_CLIENT_SECRET
  OAUTH_GITHUB_CLIENT_ID_DEV
  OAUTH_GITHUB_CLIENT_SECRET_DEV
  GOOGLE_CLIENT_ID
  GOOGLE_CLIENT_SECRET
  RESEND_API_KEY
  STRIPE_SECRET_KEY
  STRIPE_PUBLISHABLE_KEY
  STRIPE_WEBHOOK_SECRET
  SENTRY_DSN
  GRAFANA_OTLP_ENDPOINT
  GRAFANA_CLOUD_INSTANCE_ID
  GRAFANA_CLOUD_API_KEY
  LOGSNAG_TOKEN
  LOGSNAG_PROJECT
  POSTHOG_API_KEY
  POSTHOG_HOST
)

say "Mirroring .envrc → GitHub Actions secrets in $REPO"

set_count=0
skip_count=0
fail_count=0

for name in "${SECRETS[@]}"; do
  val="${!name:-}"
  if [[ -z "$val" ]]; then
    skip "$name"
    skip_count=$((skip_count + 1))
    continue
  fi
  # `--body -` reads from stdin so the value never appears in argv,
  # ps listings, or shell history.
  if printf '%s' "$val" | gh secret set "$name" --repo "$REPO" --body - >/dev/null 2>&1; then
    ok "$name (${#val} chars)"
    set_count=$((set_count + 1))
  else
    fail "$name" "gh secret set failed"
    fail_count=$((fail_count + 1))
  fi
done

echo ""
say "Done"
ok "$set_count secrets mirrored"
[[ $skip_count -gt 0 ]] && printf '  \033[2m· %d skipped (empty in .envrc — provision later)\033[0m\n' "$skip_count"
[[ $fail_count -gt 0 ]] && printf '  \033[1;31m✗ %d failed — check gh auth status, repo permissions, token scope\033[0m\n' "$fail_count"
echo ""
echo "Verify with: gh secret list -R $REPO"
