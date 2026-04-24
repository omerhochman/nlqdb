#!/usr/bin/env bash
# nlqdb — encrypt .envrc with a passphrase and write .envrc.age to the
# repo root, so `git add .envrc.age && git commit` makes the backup
# travel with the code. On a new machine:
#
#   git clone …
#   scripts/bootstrap-dev.sh        # installs tools, creates stub .envrc
#   scripts/restore-envrc.sh        # prompts passphrase, decrypts .envrc.age
#
# Uses `age` (installed by bootstrap-dev.sh) in passphrase mode — no
# keypair management across machines. age uses scrypt (cost 2^18) for
# key derivation; with a strong passphrase the ciphertext is safe to
# commit to a public repo.
#
# DEFINITION OF "STRONG":
#   - 20+ characters.
#   - Mixed upper / lower / digit / symbol.
#   - Not reused from any other service.
#   - Not a dictionary word or obvious phrase.
# If your passphrase doesn't meet all four, DON'T commit .envrc.age
# to a public repo — set NLQDB_BACKUP_DIR to a private location
# instead (e.g. iCloud Drive).

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

# Default: repo root. Override with NLQDB_BACKUP_DIR for iCloud Drive
# or any private location.
BACKUP_DIR="${NLQDB_BACKUP_DIR:-$REPO_ROOT}"
BACKUP_FILE="${BACKUP_DIR}/.envrc.age"

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

To restore on a new machine:
  git clone …
  scripts/bootstrap-dev.sh          # installs tools, creates stub .envrc
  scripts/restore-envrc.sh          # decrypts .envrc.age with your passphrase

If the backup is in the repo root, commit it now so it travels with the code:
  git add .envrc.age
  git commit -m "chore: refresh encrypted .envrc backup"

Override the default location with:
  NLQDB_BACKUP_DIR=/path/to/private/folder scripts/backup-envrc.sh
NEXT
else
  warn "age returned non-zero; restoring previous backup"
  [[ -f "${BACKUP_FILE}.prev" ]] && mv -f "${BACKUP_FILE}.prev" "$BACKUP_FILE"
  fail "encryption failed — .envrc untouched"
fi
