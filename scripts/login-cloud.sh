#!/usr/bin/env bash
# nlqdb — sign into every cloud provider that has a CLI, and print a
# checklist of the ones that require a browser click.
#
# Run this AFTER scripts/bootstrap-dev.sh has installed the CLIs.
# The script is interactive; each step pauses so you can approve the
# browser OAuth prompt, then continues. Idempotent: re-running is safe.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

say()  { printf '\n\033[1;34m==>\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m!! \033[0m %s\n' "$*"; }
ok()   { printf '\033[1;32m✓ \033[0m %s\n' "$*"; }
pause(){ printf '\033[2m   press ENTER when done (or Ctrl-C to skip)\033[0m'; read -r _; }

# --- 1. gh (GitHub) ------------------------------------------------------
say "GitHub CLI"
if gh auth status >/dev/null 2>&1; then
  ok "Already signed in as $(gh api user -q .login)"
else
  gh auth login --hostname github.com --git-protocol https --web
fi

# --- 2. Cloudflare (wrangler) -------------------------------------------
say "Cloudflare (wrangler)"
if wrangler whoami >/dev/null 2>&1; then
  ok "Already signed in: $(wrangler whoami 2>&1 | grep -m1 email || true)"
else
  echo "Opening Cloudflare OAuth in your browser…"
  wrangler login
fi
echo "After approving, grab CLOUDFLARE_API_TOKEN + CLOUDFLARE_ACCOUNT_ID:"
echo "  Account ID: https://dash.cloudflare.com — right sidebar"
echo "  API Token:  https://dash.cloudflare.com/profile/api-tokens"
echo "Scope: Account > (Workers Scripts:Edit, Workers KV:Edit, Workers R2:Edit,"
echo "       D1:Edit, Pages:Edit, Queues:Edit, AI:Read), Zone > (DNS:Edit, Cache Purge:Purge)."
pause

# --- 3. Fly.io -----------------------------------------------------------
say "Fly.io"
if fly auth whoami >/dev/null 2>&1; then
  ok "Already signed in as $(fly auth whoami 2>&1)"
else
  echo "If you don't have a Fly account, this starts signup. Otherwise it logs in."
  fly auth login || fly auth signup
fi
# `fly tokens create deploy` is *per-app* and fails before any Fly app
# exists. We want an *org-scoped* token so future Phase 2 apps
# (Listmonk, Plausible, Lago) can deploy off the same key without
# re-minting per app.
echo "Mint FLY_API_TOKEN: fly tokens create org --name nlqdb-phase0-token"
echo "(If you have >1 org, add '-o <org-slug>' — 'personal' is the default for new accounts.)"
echo "Paste the FULL output including the 'FlyV1' prefix into .envrc."
echo ""
echo "Verify the token works (after pasting + direnv reload):"
echo "  curl -sH \"Authorization: Bearer \$FLY_API_TOKEN\" https://api.machines.dev/v1/apps | jq ."
echo "Expected: HTTP 200 with {\"apps\": []} or {\"apps\": null}. 401 = bad token or 'FlyV1 ' prefix dropped."
pause

# --- 4. Stripe -----------------------------------------------------------
say "Stripe (test mode)"
if stripe config --list 2>/dev/null | grep -q live_mode=false; then
  ok "Stripe CLI already paired (test mode)"
else
  echo "Opening Stripe OAuth (make sure the Stripe dashboard is in TEST mode first)."
  stripe login
fi
echo "Dashboard → Developers → API keys: copy STRIPE_{SECRET,PUBLISHABLE}_KEY (test)."
echo "Dashboard → Developers → Webhooks: add endpoint, copy STRIPE_WEBHOOK_SECRET."
pause

# --- 5. AWS (SES fallback) ----------------------------------------------
say "AWS (SES fallback — optional for Phase 0)"
if aws sts get-caller-identity >/dev/null 2>&1; then
  ok "AWS CLI already configured"
else
  warn "Skipping — run 'aws configure' when ready (needs AWS account)."
fi

# --- 6. Manual / browser-only flows -------------------------------------

cat <<'MANUAL'

===========================================================================
The following providers have no CLI token flow. Open each link, create the
resource, paste the resulting value into .envrc.

  Neon           https://console.neon.tech  →  Account settings → API keys
                 → NEON_API_KEY (key is shown ONCE — copy immediately)

  Upstash        https://console.upstash.com  →  create a Redis DB,
                 then open the DB page → REST API section, copy token.
                 → UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN

  Resend         https://resend.com/api-keys
                 → RESEND_API_KEY. Separately: add nlqdb.com as a domain
                 and configure SPF/DKIM/DMARC per Resend's wizard.

  Sentry         Create a Worker/Node project, then:
                 https://<org>.sentry.io/settings/projects/<proj>/keys/
                 → SENTRY_DSN (the Client Key / DSN, NOT an auth token)
                 For CI release uploads: Settings → Developer Settings
                 → Organization Auth Tokens (separate value, optional).

  Grafana Cloud  https://grafana.com/orgs/<your-org>/access-policies
                 → create an access policy + token (the legacy API-keys
                 page is deprecated).
                 OTLP endpoint is per-stack: Cloud Portal → your stack
                 → "Send data" → OpenTelemetry.
                 → GRAFANA_CLOUD_API_KEY + GRAFANA_OTLP_ENDPOINT

  Gemini         https://aistudio.google.com/apikey   → GEMINI_API_KEY
                 (free tier ~1,500 RPD on Gemini 2.0 Flash, 15 RPM)
  Groq           https://console.groq.com/keys        → GROQ_API_KEY
                 (free tier: 14,400 RPD 8B, 1,000 RPD 70B, 30 RPM global)
  OpenRouter     https://openrouter.ai/settings/keys  → OPENROUTER_API_KEY

  GitHub OAuth   https://github.com/organizations/nlqdb/settings/applications/new
                 Homepage:    https://nlqdb.com
                 Callback:    https://app.nlqdb.com/auth/callback/github
                              (one URL per app — separate nlqdb-web-dev
                              for localhost when auth code lands)
                 → OAUTH_GITHUB_CLIENT_ID, OAUTH_GITHUB_CLIENT_SECRET

  Google OAuth   https://console.cloud.google.com/apis/credentials
                 Same callback set as GitHub.
                 → GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET

After populating .envrc, run `direnv allow` and you're good for local dev.
For CI, mirror every value into GitHub Actions secrets (org + repo).
For runtime, set every value as a Cloudflare Workers secret.
===========================================================================
MANUAL
