# cli — the `nlq` binary (Go)

Static Go binary, 3-char name, distributed via curl-pipe-sh, Homebrew
tap, and an npm shim (`@nlqdb/cli`). Power-user surface for
devs/agents who don't want a browser.

Covers: `nlq new`, bare `nlq "…"`, `nlq db create|list`, `nlq query`,
`nlq chat`, `nlq login` (device-code), `nlq logout`, `nlq whoami`,
`nlq keys list|rotate|revoke`, `nlq mcp install`.

See DESIGN §3.3 and IMPLEMENTATION §5 for the full spec. Phase 2.

Not yet implemented — no `go.mod` yet, which is why CI's
`lint-go` job conditionally skips.
