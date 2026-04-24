#!/usr/bin/env bash
# nlqdb — deploy apps/coming-soon to Cloudflare Pages.
#
# Idempotent. Safe to re-run; every deploy is a new Pages deployment,
# the production alias is promoted after successful upload. The first
# run of this script creates the Pages project (`nlqdb-coming-soon`);
# subsequent runs push a new deployment to the same project.
#
# Custom-domain attachment (to nlqdb.com) happens ONCE via the
# dashboard — Pages auto-writes DNS records into the (pending) zone.
# After the GoDaddy nameserver flip, Cloudflare provisions the SSL
# cert and the site goes live.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

PROJECT="nlqdb-coming-soon"
SRC_DIR="apps/coming-soon"

say()  { printf '\n\033[1;34m==>\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m!! \033[0m %s\n' "$*"; }
ok()   { printf '\033[1;32m✓ \033[0m %s\n' "$*"; }

if ! command -v wrangler >/dev/null 2>&1; then
  warn "wrangler missing — run scripts/bootstrap-dev.sh first."
  exit 1
fi

# --- 1. Cloudflare auth -------------------------------------------------

if ! wrangler whoami >/dev/null 2>&1; then
  say "You are not signed in to Cloudflare. Running 'wrangler login'."
  say "A browser tab will open — approve, then return here."
  wrangler login
fi
ok "Cloudflare auth: $(wrangler whoami 2>&1 | grep -E '^ You are logged in|email' | head -1 || echo 'ok')"

# --- 2. Ensure Pages project exists ------------------------------------

if wrangler pages project list 2>/dev/null | awk 'NR>2 {print $1}' | grep -qx "$PROJECT"; then
  ok "Pages project '$PROJECT' already exists"
else
  say "Creating Pages project '$PROJECT' (production branch: main)"
  wrangler pages project create "$PROJECT" \
    --production-branch main \
    --compatibility-date "$(date -u +%Y-%m-%d)"
fi

# --- 3. Deploy ----------------------------------------------------------

say "Deploying $SRC_DIR to Pages project '$PROJECT'"
wrangler pages deploy "$SRC_DIR" \
  --project-name "$PROJECT" \
  --branch main \
  --commit-dirty=true

# --- 4. Next steps for the human ---------------------------------------

cat <<'NEXT'

===========================================================================
Coming-soon page deployed. Deployment URL + *.pages.dev alias printed
above.

To attach to nlqdb.com (do this ONCE, in the dashboard):

  1. https://dash.cloudflare.com → Workers & Pages → nlqdb-coming-soon
  2. Custom domains → Set up a custom domain → enter 'nlqdb.com'
  3. Repeat for 'www.nlqdb.com'
  4. Cloudflare auto-writes CNAME records into the (pending) zone.
     These go live the moment GoDaddy nameservers flip.

Then, and only then, perform the GoDaddy NS flip (see IMPLEMENTATION
§2.1): disable DNSSEC first, change NS to jeremy.ns.cloudflare.com +
kiki.ns.cloudflare.com, save. Cloudflare provisions the cert and the
site is live in 5-30 min.

Re-deploy any time with:  bun --cwd apps/coming-soon run deploy
===========================================================================
NEXT
