#!/usr/bin/env bash
# nlqdb — encrypt .envrc with a passphrase and write .envrc.age to a
# private sync folder (iCloud Drive by default). On a new machine:
#
#   git clone …
#   scripts/bootstrap-dev.sh        # installs tools, creates stub .envrc
#   scripts/restore-envrc.sh        # prompts passphrase, decrypts .envrc.age
#
# Uses `age` (installed by bootstrap-dev.sh) in passphrase mode — no
# keypair management across machines. age uses scrypt (cost 2^18) for
# key derivation.
#
# .envrc.age is gitignored and must NEVER live in the repo. The repo
# history was rewritten on 2026-04-25 to remove a previously-committed
# .envrc.age; do not re-introduce one.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

# Default: iCloud Drive. Override with NLQDB_BACKUP_DIR for any other
# private sync location (Dropbox, USB stick, etc). The repo root is
# explicitly rejected.
BACKUP_DIR="${NLQDB_BACKUP_DIR:-$HOME/Library/Mobile Documents/com~apple~CloudDocs/nlqdb-backups}"
BACKUP_FILE="${BACKUP_DIR}/.envrc.age"

if [[ "$BACKUP_DIR" == "$REPO_ROOT" ]]; then
  printf '\033[1;31m✗ \033[0m %s\n' "NLQDB_BACKUP_DIR cannot be the repo root — .envrc.age must never live in git." >&2
  exit 1
fi

say()  { printf '\n\033[1;34m==>\033[0m %s\n' "$*"; }
ok()   { printf '\033[1;32m✓ \033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m!! \033[0m %s\n' "$*"; }
fail() { printf '\033[1;31m✗ \033[0m %s\n' "$*"; exit 1; }

command -v age >/dev/null 2>&1 || fail "age not installed — run scripts/bootstrap-dev.sh first"
[[ -f .envrc ]] || fail ".envrc not found in $REPO_ROOT — nothing to back up"

mkdir -p "$BACKUP_DIR"

# Rotate any existing backup so we keep the last successful one as
# .envrc.age.prev. If encryption fails mid-stream we still have a
# recoverable version.
if [[ -f "$BACKUP_FILE" ]]; then
  mv -f "$BACKUP_FILE" "${BACKUP_FILE}.prev"
fi

say "Encrypting .envrc → $BACKUP_FILE (age, passphrase mode)"
say "You will be prompted for a passphrase. Use 15+ characters."
if age -p -o "$BACKUP_FILE" .envrc; then
  chmod 600 "$BACKUP_FILE"
  ok "Backup written: $BACKUP_FILE"
  ok "Size: $(wc -c < "$BACKUP_FILE") bytes"
  if [[ -f "${BACKUP_FILE}.prev" ]]; then
    ok "Previous backup kept at ${BACKUP_FILE}.prev"
  fi
  cat <<NEXT

To restore on a new machine (same iCloud account):
  git clone …
  scripts/bootstrap-dev.sh          # installs tools, creates stub .envrc
  scripts/restore-envrc.sh          # decrypts .envrc.age with your passphrase

Override the default location with:
  NLQDB_BACKUP_DIR=/path/to/private/folder scripts/backup-envrc.sh
NEXT
else
  warn "age returned non-zero; restoring previous backup"
  [[ -f "${BACKUP_FILE}.prev" ]] && mv -f "${BACKUP_FILE}.prev" "$BACKUP_FILE"
  fail "encryption failed — .envrc untouched"
fi
