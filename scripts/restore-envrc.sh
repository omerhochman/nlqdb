#!/usr/bin/env bash
# nlqdb — decrypt the .envrc backup from iCloud Drive into this repo.
#
# Expected flow on a new macOS machine:
#   git clone git@github.com:nlqdb/nlqdb.git && cd nlqdb
#   scripts/bootstrap-dev.sh        # installs tools, creates stub .envrc
#   scripts/restore-envrc.sh        # overwrites stub with your real values
#   ./scripts/verify-secrets.sh     # should be all-green
#
# Expects the backup at
# ~/Library/Mobile Documents/com~apple~CloudDocs/nlqdb-backups/.envrc.age
# (the default iCloud Drive location, written by scripts/backup-envrc.sh).
# Override with NLQDB_BACKUP_DIR for non-Mac or custom sync folders.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

BACKUP_DIR="${NLQDB_BACKUP_DIR:-$HOME/Library/Mobile Documents/com~apple~CloudDocs/nlqdb-backups}"
BACKUP_FILE="${BACKUP_DIR}/.envrc.age"

say()  { printf '\n\033[1;34m==>\033[0m %s\n' "$*"; }
ok()   { printf '\033[1;32m✓ \033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m!! \033[0m %s\n' "$*"; }
fail() { printf '\033[1;31m✗ \033[0m %s\n' "$*"; exit 1; }

command -v age >/dev/null 2>&1 || fail "age not installed — run scripts/bootstrap-dev.sh first"

if [[ ! -f "$BACKUP_FILE" ]]; then
  warn "No backup at: $BACKUP_FILE"
  warn "If this is a new machine, wait for iCloud Drive to finish syncing the"
  warn "nlqdb-backups folder, or override with NLQDB_BACKUP_DIR."
  warn "If you never ran scripts/backup-envrc.sh, there is nothing to restore"
  warn "— populate .envrc by hand, then run scripts/backup-envrc.sh from the"
  warn "source machine to seed the backup for next time."
  exit 1
fi

# Preserve any current .envrc as a rollback in case decryption yields
# a bad file or the user wants to compare.
if [[ -f .envrc ]]; then
  ts=$(date -u +%Y%m%d-%H%M%SZ)
  mv .envrc ".envrc.pre-restore.${ts}"
  warn "Existing .envrc moved to .envrc.pre-restore.${ts} (gitignored)"
fi

say "Decrypting $BACKUP_FILE → .envrc"
if age -d -o .envrc "$BACKUP_FILE"; then
  chmod 600 .envrc
  ok "Restored .envrc ($(wc -l < .envrc) lines)"
  if command -v direnv >/dev/null 2>&1; then
    direnv allow . >/dev/null 2>&1 || true
    ok "direnv allow-listed for $REPO_ROOT"
  fi
  cat <<NEXT

Verify everything is live:
  ./scripts/verify-secrets.sh
NEXT
else
  fail "decryption failed — wrong passphrase? .envrc was not overwritten"
fi
