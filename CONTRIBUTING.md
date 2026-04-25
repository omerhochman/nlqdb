# Contributing to nlqdb

## Setup (clean machine)

```bash
git clone git@github.com:nlqdb/nlqdb.git && cd nlqdb
scripts/bootstrap-dev.sh   # installs every tool, pulls Ollama models, seeds .envrc, wires hooks
scripts/login-cloud.sh     # CLI-based cloud provider logins + checklist for browser-only flows
```

See [IMPLEMENTATION §2.8](./IMPLEMENTATION.md#28-dev-toolchain-zero-config--scriptsbootstrap-devsh) for the full toolchain breakdown and [`scripts/bootstrap-dev.sh`](./scripts/bootstrap-dev.sh) for the exact steps.

## Dev loop

```bash
bun run fix          # biome format + lint with autofix (most issues)
bun run check        # biome check (no fixes) — what pre-push runs
bun run check:all    # biome + golangci-lint + ruff — what CI runs

bun run hooks:run    # run pre-commit hooks against staged files
```

Lefthook pre-commit hooks run automatically on every `git commit`. They are **fast-by-design** — if a hook takes more than ~2s, split it into a CI-only check.

## Branches & PRs

- **`main` is always deployable.** Never push directly; always PR.
- Branch naming: `feat/<scope>-<slug>`, `fix/<scope>-<slug>`, `docs/<slug>`, `chore/<slug>`.
- PR title uses the same Conventional Commits prefix as the merge commit.
- Require green CI + 1 review (enforced at the org level once `nlqdb` org is set up per IMPLEMENTATION §2.2).

## Commit messages — Conventional Commits

Enforced automatically by the `lefthook commit-msg` hook. Format:

```
<type>(<optional scope>)!?: <subject under 72 chars>

<optional body — wrap at 72 chars>

<optional footer: Refs / BREAKING CHANGE / Co-Authored-By>
```

Allowed types: `feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`, `build`, `ci`, `chore`, `revert`.

Examples:

- `feat(auth): add device-code flow`
- `fix(mcp): reject sk_mcp_* keys outside per-host scope`
- `docs(implementation): pin Cloudflare Free plan for both zones`
- `refactor(llm)!: drop OpenRouter from the default provider chain`

## Testing

- JS/TS: `bun test` (Bun has a built-in test runner; Jest-compatible API).
- Go: `go test ./...` from `cli/`.
- Python: `uv run pytest` (once a `pyproject.toml` lands).

CI runs the same commands. Don't skip hooks with `--no-verify` — if a hook is wrong, fix the hook, not the bypass.

## Monorepo layout

See [IMPLEMENTATION §3](./IMPLEMENTATION.md#3-phase-0--foundations) for the full tree. Workspaces are declared in `package.json#workspaces` and each package README names its phase.

## Filing issues

One issue per surface area. Include reproduction steps, expected vs. actual, and the shortest failing command you could get to.

See [SUPPORT.md](./SUPPORT.md) for the full support / help-channel rundown.

## Code of Conduct

This project adopts the [Contributor Covenant 2.1](./CODE_OF_CONDUCT.md). All community spaces — issues, PRs, discussions, future chat — are covered. Reports go to `conduct@nlqdb.com`.

## Contributor License Agreement

Before we can merge a contribution, you must sign nlqdb's [Contributor License Agreement](./CLA.md). It is the Apache Individual CLA with one addition: you grant the project the right to relicense your contribution. This preserves our ability to offer commercial licences for enterprise customers who can't accept [FSL-1.1-ALv2](./LICENSE) directly — a critical optionality given the source-available licence model.

You sign **once**. Our CLA bot will comment on your first PR with a link; reply with the exact phrase

```
I have read the CLA Document and I hereby sign the CLA
```

and you are done — for that PR and every future PR you submit.

Bots managed by the project (`dependabot[bot]`, `renovate[bot]`, `github-actions[bot]`) are exempt.

## Security

Don't open a public issue for a security bug. See [SECURITY.md](./SECURITY.md) for the disclosure path: GitHub Private Vulnerability Reporting, `security@nlqdb.com`, or Signal on request. Acknowledgement within 72 h, fix target 90 days, credit on the Hall of Fame (no paid bounty yet).

## Trademark

`nlqdb` is an unregistered trademark of the project's licensor. See [TRADEMARKS.md](./TRADEMARKS.md) for permitted/prohibited uses. tl;dr: factual references and unmodified redistribution are fine; naming a product/service/repo "nlqdb-anything" needs written permission.
