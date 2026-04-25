#!/usr/bin/env bash
# nlqdb — apply D1 migrations to the `nlqdb-app` database.
#
# Wrapper around `wrangler d1 migrations apply` that:
#   • forwards `local` / `remote` as the only argument (no flags to memorize),
#   • runs from `apps/api/` so wrangler picks up the migrations_dir from
#     wrangler.toml (`apps/api/migrations/`),
#   • is idempotent — wrangler tracks applied versions in the
#     `d1_migrations` table inside the D1 DB itself.
#
# Usage:
#   scripts/migrate-d1.sh local   # ~/.wrangler local SQLite (no auth needed)
#   scripts/migrate-d1.sh remote  # production D1 (needs CLOUDFLARE_*)

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
API_DIR="$REPO_ROOT/apps/api"
D1_DATABASE="nlqdb-app"

target="${1:-}"
case "$target" in
  local)  flag="--local"  ;;
  remote) flag="--remote" ;;
  *)
    printf 'usage: %s {local|remote}\n' "$0" >&2
    exit 2
    ;;
esac

[[ -f "$API_DIR/wrangler.toml" ]] || {
  printf 'migrate-d1: %s/wrangler.toml not found\n' "$API_DIR" >&2
  exit 1
}
command -v wrangler >/dev/null 2>&1 || {
  printf 'migrate-d1: wrangler not installed — run scripts/bootstrap-dev.sh\n' >&2
  exit 1
}

if [[ "$target" == "remote" ]]; then
  [[ -n "${CLOUDFLARE_API_TOKEN:-}" ]] || {
    printf 'migrate-d1: CLOUDFLARE_API_TOKEN not set — source .envrc first\n' >&2
    exit 1
  }
  [[ -n "${CLOUDFLARE_ACCOUNT_ID:-}" ]] || {
    printf 'migrate-d1: CLOUDFLARE_ACCOUNT_ID not set — source .envrc first\n' >&2
    exit 1
  }
fi

cd "$API_DIR"
exec wrangler d1 migrations apply "$D1_DATABASE" "$flag"
