#!/usr/bin/env bash
# nlqdb — mirror cloud-provider credentials from .envrc to GitHub
# Actions secrets in nlqdb/nlqdb. Idempotent (gh secret set
# overwrites). Never logs values; only secret names + lengths +
# OK/skip status.
#
# This is the ONLY supported path for setting GH Actions secrets.
# Pasting values into the GH UI directly is forbidden: observed
# 2026-04-27 that UI-pasted CLOUDFLARE_API_TOKEN / _ACCOUNT_ID
# drifted silently from `.envrc` and broke deploys with misleading
# errors (`code: 6111` Invalid auth header on D1, `code: 7003`
# Could not route on Workers Versions). Likely cause: invisible
# whitespace/newline added by browser paste. This script writes
# values via `gh secret set --body -` (stdin), so the byte-exact
# `.envrc` value is what GH stores.
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

# Defensive minimum: if a real secret is below this length, treat it
# as suspicious — almost certainly truncation or .envrc corruption,
# not a real value. Forces a stop instead of overwriting with garbage.
# Real-world floors: shortest legit secret in our stack is the LogSnag
# project slug (~6 chars), but we never want a 1-2 char "secret" — that
# was the 2026-04-27 incident (`--body -` writing literal dash).
SUSPICIOUSLY_SHORT=4

set_count=0
skip_count=0
fail_count=0
suspicious_count=0

for name in "${SECRETS[@]}"; do
  val="${!name:-}"
  if [[ -z "$val" ]]; then
    skip "$name"
    skip_count=$((skip_count + 1))
    continue
  fi
  # Refuse to push a value shorter than SUSPICIOUSLY_SHORT chars.
  # Catches: env var got truncated, .envrc file has a stub, a previous
  # corruption hasn't been cleaned up. Loud failure beats silent
  # downstream auth errors.
  if [[ ${#val} -lt $SUSPICIOUSLY_SHORT ]]; then
    fail "$name" "value is only ${#val} chars — refusing to push (looks truncated; check .envrc)"
    suspicious_count=$((suspicious_count + 1))
    continue
  fi
  # `gh secret set` reads from stdin when --body is OMITTED entirely.
  # NEVER use `--body -` — gh CLI v2.x interprets the dash literally
  # and stores "-" (1 char) instead of reading stdin. That bug wiped
  # 29 GHA secrets to "-" on 2026-04-27; CI silently broke for hours.
  # Stdin path keeps the value out of argv / ps / shell history.
  if printf '%s' "$val" | gh secret set "$name" --repo "$REPO" >/dev/null 2>&1; then
    ok "$name (${#val} chars)"
    set_count=$((set_count + 1))
  else
    fail "$name" "gh secret set failed"
    fail_count=$((fail_count + 1))
  fi
done

# Post-push self-verify: if CLOUDFLARE_API_TOKEN was just pushed, we
# can't read it back from GH (secrets are write-only) — but we CAN
# verify the local value still works against the same Cloudflare API
# that GH-Actions runs will hit. If THIS fails, GH-side is also
# broken (same value source). Fail loudly so the operator notices
# before the next CI run does.
if [[ $set_count -gt 0 ]] && [[ -n "${CLOUDFLARE_API_TOKEN:-}" ]]; then
  echo ""
  say "Self-verify: local CLOUDFLARE_API_TOKEN against api.cloudflare.com"
  verify_status=$(curl -s -o /dev/null -w '%{http_code}' \
    "https://api.cloudflare.com/client/v4/user/tokens/verify" \
    -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" || echo "000")
  if [[ "$verify_status" == "200" ]]; then
    ok "token verified (HTTP 200) — same value is now in GH secrets"
  else
    fail "self-verify" "CF token returns HTTP $verify_status — fix .envrc and re-run, the GH-side push is also broken"
    fail_count=$((fail_count + 1))
  fi
fi

echo ""
say "Done"
ok "$set_count secrets mirrored"
[[ $skip_count -gt 0 ]] && printf '  \033[2m· %d skipped (empty in .envrc — provision later)\033[0m\n' "$skip_count"
[[ $suspicious_count -gt 0 ]] && printf '  \033[1;31m✗ %d refused (value < %d chars — looks truncated)\033[0m\n' "$suspicious_count" "$SUSPICIOUSLY_SHORT"
[[ $fail_count -gt 0 ]] && printf '  \033[1;31m✗ %d failed — check gh auth status, repo permissions, token scope\033[0m\n' "$fail_count"
echo ""
echo "Verify with: gh secret list -R $REPO"
[[ $fail_count -gt 0 || $suspicious_count -gt 0 ]] && exit 1
exit 0
