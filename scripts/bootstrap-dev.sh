#!/usr/bin/env bash
# nlqdb — one-shot dev environment bootstrap.
#
# A developer cloning a clean machine runs this script and ends up with
# every local tool, every Ollama model, and a populated `.envrc`
# containing self-generated secrets and placeholders for provider keys.
# The script is idempotent: it re-checks every tool and only installs
# what's missing.
#
# Scope (§2 of IMPLEMENTATION.md):
#   - Runtimes:              Node 20+, Bun, Go 1.24+, Python 3.12+ (via uv).
#   - Cloud CLIs:             gh, wrangler (via Bun), flyctl, awscli, stripe.
#   - Formatter / linter:     Biome (JS/TS/JSON), gofumpt + golangci-lint (Go),
#                             ruff (Python). Git hooks run them via lefthook.
#   - Shell + extras:         direnv, jq.
#   - Ollama + local models:  llama3.2:3b, qwen2.5:7b (§2.4).
#   - Self-gen secrets:       BETTER_AUTH_SECRET, INTERNAL_JWT_SECRET (§2.5).
#   - `.envrc` seeded from `.env.example`, `direnv allow`-listed.
#   - Git hooks installed via lefthook.
#
# Manual follow-up (§2.3-§2.6 — humans + OAuth clicks required) is
# invoked via `scripts/login-cloud.sh`.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

say()  { printf '\033[1;34m==>\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m!! \033[0m %s\n' "$*"; }
ok()   { printf '\033[1;32m✓ \033[0m %s\n' "$*"; }

# --- 1. Platform / package manager --------------------------------------

case "$(uname -s)" in
  Darwin)
    if ! command -v brew >/dev/null 2>&1; then
      say "Homebrew missing — installing"
      /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
    fi
    ok "Homebrew: $(brew --version | head -1)"
    PKG="brew"
    ;;
  Linux)
    warn "Linux path is best-effort; prefer macOS for nlqdb dev."
    PKG="apt"
    sudo apt-get update -y
    ;;
  *)
    warn "Unsupported OS $(uname -s); continuing but YMMV."
    PKG="unknown"
    ;;
esac

# install_tool <binary-name> <brew-formula> [install-hint-if-not-brew]
#
# brew's link step is all-or-nothing: one stale-permissions error on a
# shell-completion file (e.g. fish vendor_conf.d owned by root from a
# long-past sudo install) aborts the whole formula link, leaving the
# binary in the Cellar but not on PATH. We guard against that by
# fallback-symlinking the binary from the Cellar if brew reports
# success-ish but the tool isn't on PATH afterwards.
install_tool() {
  local bin="$1" formula="$2" hint="${3:-}"
  if command -v "$bin" >/dev/null 2>&1; then
    ok "$bin already installed ($(command -v "$bin"))"
    return 0
  fi
  say "Installing $bin"
  if [[ "$PKG" == "brew" ]]; then
    brew install "$formula" || warn "brew install $formula exited non-zero; checking Cellar for binary"
  elif [[ -n "$hint" ]]; then
    eval "$hint"
  else
    warn "Don't know how to install $bin on this platform; do it manually and re-run."
    return 1
  fi

  if command -v "$bin" >/dev/null 2>&1; then
    ok "$bin installed"
    return 0
  fi

  # Fallback: brew installed to Cellar but the link step failed.
  # Symlink the binary directly from the Cellar into /usr/local/bin.
  local cellar_bin
  cellar_bin=$(find "$(brew --prefix)/Cellar/$formula" -maxdepth 3 -type f -name "$bin" 2>/dev/null | head -1)
  if [[ -n "$cellar_bin" ]] && [[ -w "$(brew --prefix)/bin" ]]; then
    ln -sfn "$cellar_bin" "$(brew --prefix)/bin/$bin"
    warn "$bin was installed to Cellar but brew link failed (usually a stale"
    warn "shell-completion dir owned by root). Symlinked binary manually."
    warn "To fix root cause once: sudo chown -R \"\$(whoami):admin\" /usr/local/share/fish"
    ok "$bin now on PATH"
    return 0
  fi

  warn "$bin not found on PATH after install — check manually."
  return 1
}

# --- 2. Runtimes --------------------------------------------------------
#
# Node is kept because several ecosystem tools still shell out to it
# (wrangler is a Node CLI). Bun is the primary package manager and
# runtime. Go powers the CLI. uv manages Python envs/tools.
command -v node >/dev/null 2>&1 || install_tool node node
install_tool bun  bun
install_tool uv   uv
command -v go   >/dev/null 2>&1 || install_tool go   go
command -v gh   >/dev/null 2>&1 || install_tool gh   gh

# --- 3. Cloud CLIs ------------------------------------------------------

# wrangler: install globally via Bun. Avoids brew's cloudflare-wrangler
# formula, which pulls a pinned Node runtime + 20 C/C++ deps (10 min+
# on a clean machine).
if ! command -v wrangler >/dev/null 2>&1; then
  say "Installing wrangler (bun global)"
  bun add -g wrangler
  # `bun add -g` installs into ~/.bun/bin which bun itself adds to PATH
  # via the shell init it writes on first install. Until the user opens
  # a new shell, expose the binary for the remainder of this script.
  export PATH="$HOME/.bun/bin:$PATH"
  ok "wrangler $(wrangler --version 2>&1 | head -1)"
else
  ok "wrangler already installed ($(command -v wrangler))"
fi

install_tool flyctl   flyctl
install_tool direnv   direnv
install_tool aws      awscli
install_tool stripe   stripe-cli
install_tool jq       jq

# --- 3a. Formatter / linter / git hooks --------------------------------

install_tool biome         biome
install_tool lefthook      lefthook
install_tool golangci-lint golangci-lint
install_tool gofumpt       gofumpt
install_tool ruff          ruff
install_tool shellcheck    shellcheck

# --- 4. Ollama + local models (§2.4) ------------------------------------

install_tool ollama ollama

# Start Ollama and wait until its HTTP API responds. A 2s sleep is not
# enough on a cold boot — on first run the daemon can take 10s+ to come
# up, which made `ollama pull` race and fail with "could not connect".
if ! curl -s --max-time 1 http://127.0.0.1:11434/api/version >/dev/null 2>&1; then
  say "Starting Ollama daemon"
  if [[ "$PKG" == "brew" ]]; then
    brew services start ollama >/dev/null 2>&1 || true
  fi
  # Regardless of brew-services, fall through to a background serve as
  # a safety net — brew-services returns success even when the launchd
  # plist is staged but the process isn't live yet.
  if ! pgrep -x ollama >/dev/null 2>&1; then
    ollama serve >/tmp/ollama-bootstrap.log 2>&1 &
  fi

  say "Waiting for Ollama HTTP API"
  for _ in $(seq 1 30); do
    if curl -s --max-time 1 http://127.0.0.1:11434/api/version >/dev/null 2>&1; then
      ok "Ollama API responding"
      break
    fi
    sleep 1
  done
  if ! curl -s --max-time 1 http://127.0.0.1:11434/api/version >/dev/null 2>&1; then
    warn "Ollama daemon never came up; check /tmp/ollama-bootstrap.log and re-run."
    exit 1
  fi
else
  ok "Ollama daemon already running"
fi

pull_model() {
  local model="$1"
  if ollama list 2>/dev/null | awk '{print $1}' | grep -qx "$model"; then
    ok "Ollama model $model already present"
  else
    say "Pulling Ollama model $model (this can take a few minutes)"
    ollama pull "$model"
  fi
}
pull_model "llama3.2:3b"
pull_model "qwen2.5:7b"

# --- 5. Workspace install + git hooks ----------------------------------

if [[ -f package.json ]]; then
  say "Installing workspace dev dependencies (bun install)"
  bun install
  ok "bun install complete"
fi

if command -v lefthook >/dev/null 2>&1 && [[ -f lefthook.yml ]]; then
  say "Installing git hooks (lefthook)"
  lefthook install >/dev/null
  ok "lefthook hooks installed in .git/hooks"
fi

# --- 6. Self-generated secrets + .envrc --------------------------------

if [[ ! -f .env.example ]]; then
  warn ".env.example not found — re-run after syncing the repo."
  exit 1
fi

if [[ ! -f .envrc ]]; then
  say "Creating .envrc from .env.example with freshly-generated secrets"
  # direnv format: every line is `export KEY=value`.
  BETTER_AUTH_SECRET=$(bun -e 'console.log(require("crypto").randomBytes(48).toString("base64url"))')
  INTERNAL_JWT_SECRET=$(bun -e 'console.log(require("crypto").randomBytes(48).toString("base64url"))')

  awk -v s1="$BETTER_AUTH_SECRET" -v s2="$INTERNAL_JWT_SECRET" '
    /^#/ { print "# " $0; next }
    /^[[:space:]]*$/ { print ""; next }
    {
      split($0, kv, "=")
      key = kv[1]
      val = ""
      if (key == "BETTER_AUTH_SECRET")  val = s1
      if (key == "INTERNAL_JWT_SECRET") val = s2
      print "export " key "=" val
    }
  ' .env.example > .envrc

  ok "Wrote .envrc with self-generated BETTER_AUTH_SECRET + INTERNAL_JWT_SECRET"
else
  ok ".envrc already exists — leaving self-generated secrets alone"
fi

if command -v direnv >/dev/null 2>&1; then
  direnv allow . >/dev/null 2>&1 || true
  ok "direnv allow-listed for $REPO_ROOT"
fi

# --- 7. What's left for the human --------------------------------------

cat <<'NEXT'

===========================================================================
Local tools + self-generated secrets are ready.

Still to do — cloud provider accounts & keys (IMPLEMENTATION.md §2.3–§2.6):

  1.  Cloudflare        — `wrangler login`  → CLOUDFLARE_API_TOKEN, CF_AI_TOKEN
  2.  Neon              — https://console.neon.tech/app/settings/api-keys
  3.  Upstash           — https://console.upstash.com/account/api
  4.  Fly.io            — `fly auth signup` or `fly auth login` → FLY_API_TOKEN
  5.  Resend            — https://resend.com/api-keys (verify nlqdb.com DNS)
  6.  Sentry            — https://sentry.io/settings/account/api/auth-tokens/
  7.  Grafana Cloud     — https://grafana.com/orgs/<org>/api-keys
  8.  Stripe (test)     — `stripe login` → STRIPE_SECRET_KEY et al.
  9.  Gemini / Groq     — https://aistudio.google.com/app/apikey ; https://console.groq.com/keys
  10. OAuth apps        — GitHub + Google (see README / DESIGN.md §4.3)

Run:  scripts/login-cloud.sh
It will drive the CLI-based logins (Cloudflare, Fly, Stripe, gh) and
print URLs for the ones that require browser clicks. Paste resulting
tokens into .envrc.
===========================================================================
NEXT
