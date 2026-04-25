# CLI-only

No frontend at all. Four commands ship a working data tool.

```bash
nlq login                                              # one click, browser, done
nlq new "an orders tracker — customer, drink, total"
nlq "add an order: alice, latte, 5.50, just now"
nlq "how many orders today, by drink"
```

See [`walkthrough.sh`](./walkthrough.sh) for the same flow with annotated expected output.

## When to use the CLI

- Quick analysis on a CSV or live DB without writing a query.
- Cron jobs that ingest events (no client code required, just `nlq …`).
- Pipelines: `nlq "orders this week" --csv | duckdb …`.
- CI: `NLQDB_API_KEY=sk_live_… nlq "regression rows since last release"`.

## Power-user paths

```bash
nlq db create finance --engine postgres --region us-east  # explicit form
nlq connection finance                                     # raw Postgres URL
nlq export finance --csv > finance.csv
```

DESIGN §14.3 covers all of them.
